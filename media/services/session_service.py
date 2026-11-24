import math
import os
import uuid
import copy
from pathlib import Path
from models.timeline_model import TimelineModel
from models.track_model import TrackModel
from services.timeline_service import TimelineService
from utils.helpers import find_sound_path, sound_duration, asset_reference

class SessionService:

    @staticmethod
    def apply_data(model, data, sound_dir, allow_missing=False):
        """Validate a temporary model completely before replacing the current session."""
        temp = TimelineModel()
        from services.metadata_service import validate_document
        validate_document(data)
        missing = []
        version = data.get("schema_version", 1)
        if version >= 2:
            temp.tracks = [TrackModel.from_dict(t) for t in data["tracks"]]
            if len(temp.get_video_tracks()) != 1 or not temp.get_audio_tracks(): raise ValueError("Struktur track tidak valid")
        else:
            for ann in data.get("annotations", []):
                path = find_sound_path(sound_dir, ann.get("file_path") or ann["sound_name"], ann.get("category", ""))
                if not path:
                    if not allow_missing: raise FileNotFoundError(ann["sound_name"])
                    # A placeholder duration is explicitly marked unknown, never used for render.
                    clip = TimelineService.add_audio_clip(temp, ann["sound_name"], float(ann["timestamp"]),
                        float(ann.get("duration", 1)), ann.get("file_path") or ann["sound_name"])
                    clip.extra.update(missing_media=True, duration_unknown="duration" not in ann)
                else:
                    clip = TimelineService.add_audio_clip(temp, Path(path).name, float(ann["timestamp"]),
                        float(ann.get("duration", sound_duration(path))), asset_reference(sound_dir, path),
                        Path(asset_reference(sound_dir, path)).parent.as_posix(), float(ann.get("source_offset", 0)))
                core = {"timestamp", "sound_name", "file_path", "category", "duration", "source_offset", "track_id", "clip_id"}
                clip.extra.update(copy.deepcopy({k:v for k,v in ann.items() if k not in core}))
                if ann.get("clip_id"): clip.clip_id = ann["clip_id"]
        by_id = {a.get("clip_id"): a for a in data.get("annotations", []) if isinstance(a, dict) and a.get("clip_id")}
        track_ids, clip_ids = set(), set()
        for track in temp.tracks:
            if track.media_type not in ("audio", "video", "visual"): raise ValueError("Tipe track tidak valid")
            if track.track_id in track_ids: track.track_id = uuid.uuid4().hex
            track_ids.add(track.track_id)
            for clip in track.clips:
                annotation = by_id.get(clip.clip_id, {})
                structural = {"timestamp", "sound_name", "file_path", "category", "duration", "source_offset", "track_id", "clip_id", "is_muted", "effective_duration", "session_duration"}
                for key, value in annotation.items():
                    if key not in structural and key not in clip.extra: clip.extra[key] = copy.deepcopy(value)
                if clip.media_type != track.media_type: raise ValueError("Tipe klip tidak cocok dengan track")
                if clip.clip_id in clip_ids: clip.clip_id = uuid.uuid4().hex
                clip_ids.add(clip.clip_id)
                if not all(math.isfinite(v) and v >= 0 for v in (clip.start_time, clip.duration, clip.source_offset)):
                    raise ValueError("Waktu/durasi sesi tidak valid")
                if clip.media_type == "audio":
                    path = find_sound_path(sound_dir, clip.file_path or clip.name, clip.category)
                    if not path:
                        if not allow_missing: raise FileNotFoundError(clip.name)
                        clip.extra["missing_media"] = True
                        missing.append(clip.file_path or clip.name)
                        continue
                    from services.library_service import fingerprint
                    if clip.extra.get("asset_hash") and fingerprint(path) != clip.extra["asset_hash"]:
                        if not allow_missing: raise ValueError(f"Isi SFX berubah: {clip.name}")
                        clip.extra["missing_media"] = True
                        missing.append(clip.file_path or clip.name)
                        continue
                    clip.extra.pop("missing_media", None)
                    if clip.duration <= 0 or clip.source_offset + clip.duration > sound_duration(path) + 0.1:
                        raise ValueError(f"Potongan audio melampaui durasi sumber: {clip.name}")
                    canonical = asset_reference(sound_dir, path)
                    if clip.file_path != canonical:
                        parent = Path(canonical).parent.as_posix()
                        clip.category = "General" if parent == "." else parent
                    clip.file_path = canonical
                    clip.name = Path(path).name
        zoom = float(data.get("zoom_level", 40))
        if not math.isfinite(zoom): raise ValueError("Zoom tidak valid")
        volume = float(data.get("video_volume", 0.8))
        if not math.isfinite(volume): raise ValueError("Volume tidak valid")
        video_clips = [clip for track in temp.get_video_tracks() for clip in track.clips]
        timeline_duration = sum(clip.duration for clip in video_clips)
        model.video_volume = max(0.0, min(volume, 1.0))
        model.tracks = temp.tracks
        if video_clips or data.get("video_edit_empty", False):
            model.duration = timeline_duration
        model.zoom_level = max(5, min(zoom, 200))
        model.snapping_enabled = bool(data.get("snapping_enabled", True))
        model.looping_enabled = bool(data.get("looping_enabled", False))
        owned = {"tracks", "annotations", "schema_version", "zoom_level", "video_volume", "snapping_enabled", "looping_enabled",
                 "detected_events", "correction_history", "analysis_settings", "render_dirty"}
        model.metadata = copy.deepcopy({k: v for k, v in data.items() if k not in owned})
        if version < 3:
            model.metadata.setdefault("migration", {"from_version": version, "to_version": 3})
        model.events = copy.deepcopy(data.get("detected_events", []))
        model.corrections = copy.deepcopy(data.get("correction_history", []))
        model.analysis_settings = copy.deepcopy(data.get("analysis_settings", {}))
        model.render_dirty = bool(data.get("render_dirty", False))
        model.clear_selection()
        return missing
