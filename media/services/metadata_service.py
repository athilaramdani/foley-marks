"""Versioned session documents; unknown fields survive import and subsequent edits."""
import copy
import json
import math
import os
import tempfile
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 3
STATUSES = {"auto-generated", "reviewed", "approved", "modified", "rejected", "manual"}


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, data, backup=False):
    payload = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".metadata-", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        if backup and target.exists():
            shutil.copy2(target, target.with_name(target.name + "." + uuid.uuid4().hex[:10] + ".bak"))
        os.replace(name, target)
    finally:
        if os.path.exists(name): os.unlink(name)


def number(value, field, minimum=0, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{field} harus berupa angka finite")
    if value < minimum or maximum is not None and value > maximum:
        raise ValueError(f"{field} di luar rentang")
    return value


def validate_document(data):
    if not isinstance(data, dict): raise ValueError("Metadata harus berupa object")
    version = data.get("schema_version", 1)
    if type(version) is not int or version not in (1, 2, 3):
        raise ValueError(f"Schema {version} belum didukung; file asli tidak diubah")
    json.dumps(data, allow_nan=False)
    for key in ("detected_events", "correction_history"):
        if key in data and not isinstance(data[key], list): raise ValueError(f"{key} harus list")
    if "analysis_settings" in data and not isinstance(data["analysis_settings"], dict):
        raise ValueError("analysis_settings harus object")
    if "analysis_settings" in data:
        from services.video_analysis_service import validate_settings
        validate_settings(data["analysis_settings"])
    if "video_transform" in data:
        from services.video_transform_service import normalize_transform
        normalize_transform(data["video_transform"])
    if "video_edit_empty" in data and type(data["video_edit_empty"]) is not bool:
        raise ValueError("video_edit_empty harus boolean")
    for event in data.get("detected_events", []):
        if not isinstance(event, dict): raise ValueError("Event harus object")
        for key in ("start_time", "end_time", "peak_time"): number(event.get(key), key)
        if not event["start_time"] <= event["peak_time"] <= event["end_time"]:
            raise ValueError("Urutan timestamp event tidak valid")
        number(event.get("confidence"), "confidence", 0, 1)
        if not isinstance(event.get("event_id"), str) or not isinstance(event.get("event_type"), str):
            raise ValueError("Identitas event tidak valid")
    ids = set()
    tracks = data.get("tracks", [])
    if not isinstance(tracks, list): raise ValueError("tracks harus list")
    for track in tracks:
        if not isinstance(track, dict) or track.get("media_type") not in ("audio", "video", "visual"):
            raise ValueError("Track tidak valid")
        for field in ("is_locked", "is_muted", "is_visible"):
            if field in track and type(track[field]) is not bool: raise ValueError(f"{field} harus boolean")
        if not isinstance(track.get("clips", []), list): raise ValueError("clips harus list")
        for clip in track.get("clips", []):
            if not isinstance(clip, dict): raise ValueError("Clip harus object")
            if clip.get("media_type", "audio") != track["media_type"]: raise ValueError("Tipe klip berbeda dengan track")
            for field in ("start_time", "duration", "source_offset"):
                number(clip.get(field, 0), field)
            if clip.get("media_type") != "video" and clip.get("duration", 0) <= 0:
                raise ValueError("Durasi klip harus positif")
            for field in ("name", "file_path", "category"):
                if field in clip and not isinstance(clip[field], str): raise ValueError(f"{field} harus teks")
            if "clip_id" in clip:
                if not isinstance(clip["clip_id"], str) or not clip["clip_id"]: raise ValueError("ID klip tidak valid")
                if clip["clip_id"] in ids: raise ValueError("ID klip duplikat")
                ids.add(clip["clip_id"])
            number(clip.get("volume", 1), "volume", 0, 1)
            if "confidence" in clip and clip["confidence"] is not None: number(clip["confidence"], "confidence", 0, 1)
            if clip.get("review_status", "manual") not in STATUSES: raise ValueError("Status review tidak valid")
            if "is_muted" in clip and type(clip["is_muted"]) is not bool: raise ValueError("Mute harus boolean")
            if clip.get("media_type") == "visual":
                from services.visual_effect_service import validate_visual
                validate_visual(clip)
    has_video_clips = any(track["media_type"] == "video" and track.get("clips") for track in tracks)
    if data.get("video_edit_empty") and has_video_clips:
        raise ValueError("Penanda video kosong tidak cocok dengan potongan video dalam timeline")
    if has_video_clips:
        from services.video_edit_service import video_segments
        source_duration = data.get("video_info", {}).get("duration")
        if source_duration is not None:
            number(source_duration, "video_info.duration")
        video_segments(tracks, source_duration=source_duration)
    return data


def read_metadata(path):
    path = Path(path)
    if path.suffix.lower() == ".txt":
        annotations = []
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if not line.strip(): continue
            stamp, ref = line.split("\t", 1)
            annotations.append({"timestamp": float(stamp), "sound_name": ref, "file_path": ref})
        return {"schema_version": 1, "annotations": annotations,
            "import_notes": "TXT: durasi diambil dari sumber; source offset/track/mute/history asli tidak tersedia."}
    return validate_document(json.loads(path.read_text(encoding="utf-8-sig")))


def document(model, video_path="", sound_dir=""):
    data = copy.deepcopy(model.metadata)
    data.update(schema_version=SCHEMA_VERSION, schema_name="video_sfx_annotation",
        video_path=video_path, sound_dir=sound_dir, sounds_directory=sound_dir,
        tracks=[t.to_dict() for t in model.tracks], annotations=model.get_annotations(),
        zoom_level=model.zoom_level, video_volume=model.video_volume,
        snapping_enabled=model.snapping_enabled, looping_enabled=model.looping_enabled,
        detected_events=copy.deepcopy(model.events), correction_history=copy.deepcopy(model.corrections),
        analysis_settings=copy.deepcopy(model.analysis_settings), render_dirty=model.render_dirty)
    data["annotations_role"] = "session"
    if model.render_dirty:
        for key in ("rendered_annotations", "rendered_visuals"):
            if key in data: data["last_" + key] = data.pop(key)
    return validate_document(data)


def effective_annotations(annotations, video_duration, sound_dir):
    from utils.helpers import find_sound_path, sound_duration
    result = []
    for item in annotations:
        if item.get("is_muted") or item.get("review_status") == "rejected" or item.get("volume", 1) <= 0: continue
        start = number(item["timestamp"], "timestamp")
        if start >= video_duration: continue
        path = find_sound_path(sound_dir, item.get("file_path") or item["sound_name"], item.get("category", ""))
        if not path: raise FileNotFoundError(item.get("file_path") or item["sound_name"])
        from services.library_service import fingerprint
        if item.get("asset_hash") and fingerprint(path) != item["asset_hash"]:
            raise ValueError(f"Isi SFX berubah; relink diperlukan: {path}")
        offset = number(item.get("source_offset", 0), "source_offset")
        duration = number(item.get("duration", sound_duration(path) - offset), "duration")
        effective = min(duration, video_duration - start, sound_duration(path) - offset)
        if effective <= 0: raise ValueError(f"Potongan sumber kosong: {path}")
        ann = copy.deepcopy(item)
        ann.update(duration=effective, session_duration=duration, effective_duration=effective)
        result.append(ann)
    return sorted(result, key=lambda a: a["timestamp"])


def save_revision(path, model, video_path, sound_dir):
    target = Path(path)
    data = document(model, video_path, sound_dir)
    data["revision_id"] = uuid.uuid4().hex
    data["saved_at"] = now()
    atomic_json(target, data, backup=True)
    return target
