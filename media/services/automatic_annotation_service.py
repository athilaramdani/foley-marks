import copy
from collections import Counter
from pathlib import Path
from services.timeline_service import TimelineService
from services.metadata_service import now
from services.video_analysis_service import DEFAULTS


def same_event(a, b, tolerance=0.45):
    return a.get("event_type") == b.get("event_type") and abs(a["peak_time"]-b["peak_time"]) <= tolerance


def propose(events, sounds, duration, settings, existing=()):
    settings = {**DEFAULTS, **settings}
    spacing = max(settings["minimum_spacing"], {"low": 2.0, "medium": 0.8, "high": 0.3}[settings["density"]])
    existing = list(existing)
    selected, history = [], [c["sound_id"] for c in existing if c.get("sound_id")]
    usage = Counter(history)
    for event in sorted(events, key=lambda e: e["peak_time"]):
        if event["confidence"] < settings["min_confidence"]: continue
        candidates = []
        for sound in sounds:
            if settings["allowed_categories"] and sound["category"] not in settings["allowed_categories"]: continue
            accent = (settings["density"] == "high" and settings["style"] == "cartoon"
                and event["event_type"] in ("fast_motion", "fast_hand_motion", "direction_change", "hand_raising")
                and "motion_accent" in sound["event_compatibility"])
            if event["event_type"] not in sound["event_compatibility"] and not accent: continue
            score = sound["priority"] + (1 if sound["style"] == settings["style"] else 0)
            score += min(len(set(sound["tags"]) & {event["event_type"]}), 1)
            level = "high" if event.get("intensity", 0) > .5 else "medium"
            score += .5 if sound["intensity"] == level else 0
            score -= abs(sound["duration"] - (event["end_time"]-event["start_time"])) * .1
            if settings["avoid_repetition"]:
                score -= usage[sound["sound_id"]] * 3
                if sound["sound_id"] in history[-8:]: score -= 4
            candidates.append((score, sound["file_path"], sound))
        if not candidates: continue
        placed = existing + selected
        for _, _, sound in sorted(candidates, reverse=True, key=lambda s: (s[0], s[1])):
            ideal = event["peak_time"] - sound["accent_offset"]
            start, offset = max(0, ideal), max(0, -ideal)
            length = min(sound["duration"]-offset, duration-start)
            if sound["playback_type"] == "trim_to_event": length = min(length, event["end_time"]-start)
            if length <= 0: continue
            if any(abs(c["start_time"]-start) < spacing for c in placed): continue
            points = [start] + [c["start_time"] for c in placed if start < c["start_time"] < start+length]
            if any(sum(c["start_time"] <= t < c["start_time"]+c["duration"] for c in placed) >= settings["max_overlap"] for t in points): continue
            break
        else:
            continue
        selected.append({"name": sound["filename"], "file_path": sound["file_path"], "category": sound["category"],
            "start_time": start, "duration": length, "source_offset": offset, "sound_id": sound["sound_id"],
            "asset_hash": sound["asset_hash"], "event_id": event["event_id"], "event_type": event["event_type"],
            "event_peak": event["peak_time"], "confidence": event["confidence"], "origin": "automatic",
            "review_status": "auto-generated", "volume": 0.55 if settings["protect_original"] else 1.0,
            "match_reason": "event_compatibility + style/intensity/duration/priority; accent aligned",
            "alternatives": [s[2]["file_path"] for s in sorted(candidates, reverse=True, key=lambda s:(s[0],s[1]))[:5]]})
        history.append(sound["sound_id"])
        usage[sound["sound_id"]] += 1
    return selected


def merge_analysis(model, analysis, sounds, settings, strategy="update_auto", selected_ids=()):
    if strategy not in ("keep", "merge", "update_auto", "replace_selected", "full_regenerate"):
        raise ValueError("Strategi merge tidak didukung")
    incoming = copy.deepcopy(analysis["events"])
    start, end = analysis.get("segment", [0, model.duration])
    events = copy.deepcopy(model.events)
    matched = 0
    unmatched = list(events)
    for event in incoming:
        old = min((e for e in unmatched if same_event(e, event)),
            key=lambda e: abs(e["peak_time"]-event["peak_time"]), default=None)
        if old:
            unmatched.remove(old)
            matched += 1
            event["event_id"] = old["event_id"]
            event["status"] = old.get("status", "detected")
            if strategy != "keep": old.update(event)
        else: events.append(event)
    protected = []
    replaceable = []
    for track in model.get_audio_tracks():
        for clip in track.clips:
            replace = (strategy == "update_auto" and clip.extra.get("review_status") == "auto-generated"
                or strategy == "full_regenerate" or strategy == "replace_selected" and clip.clip_id in selected_ids)
            if replace and not track.is_locked and not track.is_muted and start <= clip.extra.get("event_peak", clip.start_time) <= end:
                replaceable.append((track, clip))
            else: protected.append(clip)
    protected_events = {c.extra.get("event_id") for c in protected}
    rejected = {e["event_id"] for e in events if e.get("status") == "rejected"}
    eligible = [e for e in incoming if e["event_id"] not in protected_events | rejected]
    if strategy == "replace_selected":
        eligible = [e for e in eligible if any(c.start_time-.45 <= e["peak_time"] <= c.start_time+c.duration+.45 for _,c in replaceable)]
    proposals = [] if strategy == "keep" else propose(eligible, sounds, model.duration, settings,
        [c.to_dict() for c in protected if not c.extra.get("is_muted")])
    for track, clip in replaceable: track.remove_clip(clip.clip_id)
    for item in proposals:
        clip = TimelineService.add_audio_clip(model, item["name"], item["start_time"], item["duration"],
            item["file_path"], item["category"], item["source_offset"])
        clip.extra.update({k: v for k, v in item.items() if k not in clip.to_dict()})
    model.events = events
    model.analysis_settings = copy.deepcopy(settings)
    model.metadata["analysis"] = {k: copy.deepcopy(v) for k, v in analysis.items() if k != "events"}
    model.metadata["automatic_suggestions"] = copy.deepcopy(proposals)
    model.corrections.append({"action": "analysis_merge", "at": now(), "strategy": strategy,
        "detected": len(incoming), "matched": matched, "placed": len(proposals), "preserved": len(protected),
        "replaced_clips": [c.to_dict() for _,c in replaceable]})
    if proposals or replaceable: model.render_dirty = True
    TimelineService.cleanup_empty_tracks(model)
    return {"detected": len(incoming), "matched": matched, "placed": len(proposals), "preserved": len(protected),
        "replaced": len(replaceable)}
