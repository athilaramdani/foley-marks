"""Content identities and editable matching hints, kept beside each local sound library."""
import copy
import hashlib
from pathlib import Path
from functools import lru_cache
from services.metadata_service import atomic_json, number
import json
from utils.helpers import sound_duration, sound_files


@lru_cache(maxsize=2048)
def _hash(path, mtime, size):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
    return h.hexdigest()


def fingerprint(path):
    p = Path(path).resolve()
    stat = p.stat()
    return _hash(str(p), stat.st_mtime_ns, stat.st_size)


def infer_events(category, name):
    name = name.lower()
    if "ngerem" in name: return ["sudden_stop"]
    if "boing" in name or "boink" in name: return ["jump", "bounce_motion", "landing", "motion_accent"]
    if "naik" in name: return ["hand_raising", "upward_motion", "direction_change", "motion_accent"]
    if any(token in name for token in ("tuing", "wiuktaktungtok", "comedy wiw", "mbull", "kowewewe")):
        return ["motion_accent"]
    if "lari" in name or "running" in category.lower(): return ["running"]
    if category.lower().endswith("gerak"):
        return ["fast_motion", "fast_hand_motion", "direction_change"]
    return []


class SoundLibrary:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.path = self.root / ".sfx-metadata.json"
        self.data = {"schema_version": 1, "sounds": {}}
        if self.path.exists() and self.path.resolve().parent == self.root:
            self.data = json.loads(self.path.read_text(encoding="utf-8"))
            if self.data.get("schema_version") != 1 or not isinstance(self.data.get("sounds"), dict):
                raise ValueError("Schema metadata pustaka belum didukung")

    def scan(self, progress=None, cancelled=lambda: False, only=None):
        files = sound_files(self.root)
        if only is not None: files = [p for p in files if p.relative_to(self.root).as_posix() == only]
        result = []
        for i, path in enumerate(files):
            if cancelled(): raise InterruptedError("Analisis dibatalkan")
            digest = fingerprint(path)
            rel = path.relative_to(self.root).as_posix()
            category = path.parent.relative_to(self.root).as_posix()
            if category == ".": category = "General"
            stored = self.data["sounds"].get(digest, {})
            entry = {"sound_id": digest, "asset_hash": digest, "file_path": rel, "filename": path.name,
                "category": category, "tags": [], "event_compatibility": infer_events(category, path.stem),
                "duration": sound_duration(str(path)), "intensity": "medium", "style": "cartoon",
                "accent_offset": 0.0, "playback_type": "one_shot", "priority": 1.0,
                "notes": "", "metadata_source": "filename_inference_unreviewed"}
            entry.update(copy.deepcopy(stored))
            entry.update(sound_id=digest, asset_hash=digest, file_path=rel, filename=path.name, duration=sound_duration(str(path)))
            self.validate(entry)
            result.append(entry)
            if progress: progress(i + 1, len(files))
        return result

    @staticmethod
    def validate(entry):
        for key in ("tags", "event_compatibility"):
            if not isinstance(entry.get(key), list) or not all(isinstance(s, str) for s in entry[key]):
                raise ValueError(f"{key} harus berupa list teks")
        for key in ("category", "notes", "style", "intensity"):
            if not isinstance(entry.get(key), str): raise ValueError(f"{key} harus teks")
        number(entry["accent_offset"], "accent_offset", 0, entry["duration"])
        number(entry["priority"], "priority", 0, 100)
        if entry.get("playback_type") not in ("one_shot", "trim_to_event"):
            raise ValueError("playback_type: one_shot / trim_to_event")

    def save(self, entry):
        self.validate(entry)
        data = copy.deepcopy(self.data)
        item = copy.deepcopy(entry)
        item["metadata_source"] = "user"
        data["sounds"][entry["sound_id"]] = item
        atomic_json(self.path, data, backup=True)
        self.data = data

    @staticmethod
    def relink_plan(model, old_root, new_root):
        by_hash = {}
        for p in Path(new_root).rglob("*"):
            if p.is_file() and p.suffix.lower() in (".wav", ".mp3"):
                by_hash.setdefault(fingerprint(p), []).append(p)
        result = {}
        from utils.helpers import find_sound_path
        for track in model.get_audio_tracks():
            for clip in track.clips:
                old = find_sound_path(old_root, clip.file_path or clip.name, clip.category)
                digest = clip.extra.get("asset_hash") or (fingerprint(old) if old else None)
                matches = by_hash.get(digest, [])
                if not matches: raise FileNotFoundError(f"SFX identik tidak ditemukan: {clip.name}")
                result[clip.clip_id] = (sorted(matches)[0].relative_to(new_root).as_posix(), digest)
        return result
