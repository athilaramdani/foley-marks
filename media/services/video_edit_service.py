"""A contiguous single-source edit list and linked timeline operations."""
import copy
import math
import uuid
from pathlib import Path
from models.clip_model import ClipModel
from models.timeline_model import TimelineModel

EPSILON = 1e-6


def _clips(value):
    if hasattr(value, "get_video_tracks"):
        value = value.get_video_tracks()
    if isinstance(value, dict): value = value.get("tracks", [])
    result = []
    for item in value or []:
        if hasattr(item, "to_dict"): item = item.to_dict()
        if "clips" in item:
            if item.get("media_type") == "video": result.extend(item["clips"])
        elif item.get("media_type", "video") == "video": result.append(item)
    return result


def video_segments(value, source_duration=None, source_path=None):
    clips = sorted(_clips(value), key=lambda c: c.get("start_time", 0))
    explicitly_empty = (getattr(value, "metadata", {}).get("video_edit_empty", False)
        or isinstance(value, dict) and value.get("video_edit_empty", False))
    if not clips and source_duration and source_duration > 0 and not explicitly_empty:
        clips = [{"start_time": 0, "duration": source_duration, "source_offset": 0,
                  "file_path": source_path or "", "media_type": "video"}]
    cursor, result, paths = 0.0, [], set()
    for clip in clips:
        segment = copy.deepcopy(clip)
        for key, default in (("start_time", 0), ("source_offset", 0), ("duration", 0)):
            number = segment.get(key, default)
            if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or number < 0:
                raise ValueError(f"Waktu potongan video tidak valid: {key}")
            segment[key] = float(number)
        if segment["duration"] <= EPSILON: raise ValueError("Durasi potongan video harus positif")
        if abs(segment["start_time"]-cursor) > .001:
            raise ValueError("Potongan video harus berurutan tanpa celah atau tumpang tindih")
        if source_duration is not None and segment["source_offset"]+segment["duration"] > source_duration+.15:
            raise ValueError("Potongan video melampaui durasi sumber")
        path = str(segment.get("file_path", "")).replace("\\", "/")
        if path:
            paths.add(path.casefold())
            if source_path:
                expected = str(source_path).replace("\\", "/")
                if path.casefold() != expected.casefold() and not (
                        "/" not in path and Path(path).name.casefold() == Path(expected).name.casefold()):
                    raise ValueError("Semua potongan harus berasal dari video sumber yang sama")
        segment["start_time"] = cursor
        cursor += segment["duration"]
        result.append(segment)
    if len(paths) > 1:
        basenames = {Path(p).name for p in paths}
        if not source_path or len(basenames) != 1:
            raise ValueError("Semua potongan harus berasal dari video sumber yang sama")
    return result


def timeline_to_source(segments, seconds):
    if not segments: return max(0.0, seconds)
    seconds = max(0.0, min(float(seconds), sum(s["duration"] for s in segments)))
    segment = next((s for s in segments if seconds < s["start_time"]+s["duration"]-EPSILON), segments[-1])
    return segment["source_offset"]+max(0.0, min(seconds-segment["start_time"], segment["duration"]))


def source_to_timeline(segments, seconds, segment_index=None):
    if not segments: return max(0.0, seconds)
    candidates = [segments[segment_index]] if segment_index is not None else segments
    segment = next((s for s in candidates if s["source_offset"]-EPSILON <= seconds < s["source_offset"]+s["duration"]-EPSILON), None)
    if segment is None:
        segment = min(candidates, key=lambda s: min(abs(seconds-s["source_offset"]), abs(seconds-s["source_offset"]-s["duration"])))
    return segment["start_time"]+max(0.0, min(seconds-segment["source_offset"], segment["duration"]))


def is_identity_edit(segments, source_duration=None):
    if not segments: return True
    return all(abs(s["start_time"]-s["source_offset"]) < .001 for s in segments) and (
        source_duration is None or abs(sum(s["duration"] for s in segments)-source_duration) < .15)


def _clone(model):
    candidate = TimelineModel()
    candidate.restore(model.snapshot())
    candidate.duration, candidate.current_time = model.duration, model.current_time
    return candidate


def _owner(segments, seconds):
    return next((s for s in segments if seconds < s["start_time"]+s["duration"]-EPSILON), segments[-1])


def _tracking(points, start, end, delta):
    if not points: return []
    points = sorted(copy.deepcopy(points), key=lambda p: p["time"])
    def sample(stamp):
        left = next((p for p in reversed(points) if p["time"] <= stamp), points[0])
        right = next((p for p in points if p["time"] >= stamp), points[-1])
        value = copy.deepcopy(left)
        fraction = (stamp-left["time"])/(right["time"]-left["time"]) if right["time"] > left["time"] else 0
        for key in ("x", "y"):
            if key in left and key in right: value[key] = left[key]+fraction*(right[key]-left[key])
        value["time"] = stamp+delta
        return value
    return [sample(start)] + [{**p, "time": p["time"]+delta} for p in points if start < p["time"] < end] + ([sample(end)] if end > start else [])


def _events(events, segments, deltas, removed_ids=()):
    result, identities = [], {}
    for event in events:
        ownership_time = min(event["peak_time"], event["end_time"]-2*EPSILON) if event["end_time"] > event["start_time"] else event["peak_time"]
        peak_owner = _owner(segments, ownership_time)["clip_id"]
        available = [s for s in segments if s["clip_id"] not in removed_ids
            and min(event["end_time"], s["start_time"]+s["duration"])-max(event["start_time"], s["start_time"]) > EPSILON]
        if peak_owner in removed_ids and available:
            peak_owner = min(available, key=lambda s:min(abs(event["peak_time"]-s["start_time"]), abs(event["peak_time"]-s["start_time"]-s["duration"])))["clip_id"]
        for segment in segments:
            if segment["clip_id"] in removed_ids: continue
            start = max(event["start_time"], segment["start_time"])
            end = min(event["end_time"], segment["start_time"]+segment["duration"])
            if end < start or end-start <= EPSILON and event["end_time"] > event["start_time"]: continue
            if event["end_time"] == event["start_time"] and segment["clip_id"] != peak_owner: continue
            delta = deltas[segment["clip_id"]]
            fragment = copy.deepcopy(event)
            if segment["clip_id"] != peak_owner: fragment["event_id"] = uuid.uuid4().hex
            fragment.update(start_time=start+delta, end_time=end+delta,
                peak_time=max(start, min(event["peak_time"], end))+delta, linked_video_id=segment["clip_id"])
            if event.get("tracking"): fragment["tracking"] = _tracking(event["tracking"], start, end, delta)
            identities[(event["event_id"], segment["clip_id"])] = fragment
            result.append(fragment)
    return sorted(result, key=lambda e: e["peak_time"]), identities


def _pieces(value, segments, deltas, identities):
    start, end = value["start_time"], value["start_time"]+value["duration"]
    cuts = [start] + [s["start_time"] for s in segments if start+EPSILON < s["start_time"] < end-EPSILON] + [end]
    result = []
    for index, (lo, hi) in enumerate(zip(cuts, cuts[1:])):
        owner = _owner(segments, lo+EPSILON)
        delta = deltas[owner["clip_id"]]
        piece = copy.deepcopy(value)
        if index: piece["clip_id"] = str(uuid.uuid4())
        piece.update(start_time=lo+delta, duration=hi-lo,
            source_offset=value.get("source_offset", 0)+lo-start, linked_video_id=owner["clip_id"])
        event = identities.get((value.get("event_id"), owner["clip_id"]))
        if event:
            piece.update(event_id=event["event_id"], event_peak=event["peak_time"])
        elif "event_peak" in piece:
            piece["event_peak"] = max(owner["start_time"], min(piece["event_peak"], owner["start_time"]+owner["duration"]))+delta
        if piece.get("tracking"): piece["tracking"] = _tracking(piece["tracking"], lo, hi, delta)
        if value.get("media_type") == "visual":
            piece["animation_offset"] = value.get("animation_offset", value.get("source_offset", 0))+lo-start
            piece["animation_duration"] = value.get("animation_duration", value["duration"])
            if value.get("tracking_mode") == "body_follow" and value.get("tracking"):
                piece["tracking_visible_start"] = value.get("tracking_visible_start", value["tracking"][0]["time"]-.4)+delta
                piece["tracking_visible_end"] = value.get("tracking_visible_end", value["tracking"][-1]["time"]+.4)+delta
        if value.get("origin") == "automatic" and (len(cuts) > 2 or abs(delta) > EPSILON):
            piece["review_status"] = "modified"
        result.append(piece)
    return result


def _remap_linked(model, old_segments, deltas, removed_ids=()):
    events, identities = _events(model.events, old_segments, deltas, removed_ids)
    changed = []
    for track in model.tracks:
        if track.media_type not in ("audio", "visual"): continue
        clips = []
        for clip in track.clips:
            pieces = [p for p in _pieces(clip.to_dict(), old_segments, deltas, identities)
                if p["linked_video_id"] not in removed_ids]
            needs_change = len(pieces) != 1 or any(abs(pieces[0][key]-getattr(clip, key)) > EPSILON
                for key in ("start_time", "duration", "source_offset"))
            if track.is_locked and needs_change:
                raise ValueError("Buka kunci track audio/visual yang terkait sebelum mengedit video")
            if track.is_locked:
                clips.append(clip)
                continue
            clips.extend(ClipModel.from_dict(p) for p in pieces)
            if needs_change: changed.append(clip.clip_id)
        track.clips = sorted(clips, key=lambda c: c.start_time)
    model.events = events
    if model.metadata.get("automatic_suggestions"):
        model.metadata.setdefault("source_automatic_suggestions", copy.deepcopy(model.metadata["automatic_suggestions"]))
        model.metadata["automatic_suggestions"] = [piece for value in model.metadata["automatic_suggestions"]
            for piece in _pieces(value, old_segments, deltas, identities) if piece["linked_video_id"] not in removed_ids]
    return changed


def _commit(model, candidate):
    model.restore(candidate.snapshot())
    model.duration = candidate.duration
    model.current_time = max(0, min(model.current_time, candidate.duration))


def split_video(model, clip_id, split_time):
    if not isinstance(split_time, (int, float)) or not math.isfinite(split_time): return False
    candidate = _clone(model)
    tracks = candidate.get_video_tracks()
    if len(tracks) != 1: raise ValueError("Editor membutuhkan satu track video")
    track = tracks[0]
    clip = next((c for c in track.clips if c.clip_id == clip_id), None)
    if not clip or not clip.start_time+EPSILON < split_time < clip.start_time+clip.duration-EPSILON: return False
    if track.is_locked: raise ValueError("Track video terkunci")
    video_segments(candidate)
    first_duration = split_time-clip.start_time
    tail = ClipModel.from_dict(clip.to_dict())
    tail.clip_id = str(uuid.uuid4())
    tail.start_time, tail.duration = split_time, clip.duration-first_duration
    tail.source_offset += first_duration
    clip.duration = first_duration
    track.add_clip(tail)
    segments = video_segments(candidate)
    linked = _remap_linked(candidate, segments, {s["clip_id"]: 0 for s in segments})
    candidate.render_dirty = True
    candidate.metadata.pop("video_edit_empty", None)
    _commit(model, candidate)
    return {"linked_clip_ids": linked, "new_video_clip_id": tail.clip_id}


def reorder_video(model, clip_id, target_time):
    if not isinstance(target_time, (int, float)) or not math.isfinite(target_time): return False
    candidate = _clone(model)
    tracks = candidate.get_video_tracks()
    if len(tracks) != 1: raise ValueError("Editor membutuhkan satu track video")
    track = tracks[0]
    old = video_segments(candidate)
    clip = next((c for c in track.clips if c.clip_id == clip_id), None)
    if not clip or len(old) < 2: return False
    if track.is_locked: raise ValueError("Track video terkunci")
    remaining = [c for c in sorted(track.clips, key=lambda c:c.start_time) if c.clip_id != clip_id]
    boundaries, cursor = [0.0], 0.0
    for item in remaining:
        cursor += item.duration
        boundaries.append(cursor)
    index = min(range(len(boundaries)), key=lambda i: (abs(boundaries[i]-target_time), i))
    reordered = remaining[:index]+[clip]+remaining[index:]
    if [c.clip_id for c in reordered] == [s["clip_id"] for s in old]: return False
    cursor, deltas = 0.0, {}
    for item in reordered:
        deltas[item.clip_id] = cursor-item.start_time
        item.start_time = cursor
        cursor += item.duration
    track.clips = reordered
    linked = _remap_linked(candidate, old, deltas)
    candidate.duration = cursor
    candidate.render_dirty = True
    candidate.metadata.pop("video_edit_empty", None)
    video_segments(candidate)
    _commit(model, candidate)
    return {"linked_clip_ids": linked, "video_order": [c.clip_id for c in reordered]}


def delete_video(model, clip_id):
    candidate = _clone(model)
    tracks = candidate.get_video_tracks()
    if len(tracks) != 1: raise ValueError("Editor membutuhkan satu track video")
    track = tracks[0]
    old = video_segments(candidate)
    clip = next((c for c in track.clips if c.clip_id == clip_id), None)
    if clip is None: return False
    if track.is_locked: raise ValueError("Track video terkunci")
    remaining = [c for c in sorted(track.clips, key=lambda c:c.start_time) if c.clip_id != clip_id]
    cursor, deltas = 0.0, {clip_id: 0.0}
    for item in remaining:
        deltas[item.clip_id] = cursor-item.start_time
        item.start_time = cursor
        cursor += item.duration
    track.clips = remaining
    linked = _remap_linked(candidate, old, deltas, {clip_id})
    candidate.duration = cursor
    candidate.render_dirty = True
    if remaining:
        candidate.metadata.pop("video_edit_empty", None)
        video_segments(candidate)
    else:
        candidate.metadata["video_edit_empty"] = True
        candidate.events = []
        candidate.metadata["automatic_suggestions"] = []
    _commit(model, candidate)
    return {"linked_clip_ids": linked, "deleted_video_clip_id": clip_id,
        "removed_duration": clip.duration, "video_order": [c.clip_id for c in remaining]}
