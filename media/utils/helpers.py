"""Shared library lookup. Relative paths identify assets; aliases support old datasets."""
import json
from pathlib import Path
from functools import lru_cache
from utils.tools import probe

AUDIO_EXTENSIONS = frozenset({".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".aif", ".aiff", ".opus", ".wma"})
allowed_files = frozenset()

def sound_files(root):
    if not root or not Path(root).is_absolute() or not Path(root).is_dir():
        return []
    root = Path(root).resolve()
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in AUDIO_EXTENSIONS
                  and p.resolve().is_relative_to(root) and p.is_file())


@lru_cache(maxsize=16)
def _index(sound_dir):
    root = Path(sound_dir)
    files = {f.relative_to(root).as_posix(): str(f.resolve())
             for f in sound_files(root)}
    aliases = {}
    manifest = root.parent / "sound_aliases.json"
    if manifest.exists() and manifest.resolve().parent == root.parent:
        aliases = json.loads(manifest.read_text(encoding="utf-8")).get("aliases", {})
    return files, aliases

def refresh_sound_index():
    _index.cache_clear()

def scan_sound_directory(sound_dir):
    refresh_sound_index()
    files, _ = _index(str(Path(sound_dir).resolve()))
    root = Path(sound_dir)
    result = {p.relative_to(root).as_posix(): [] for p in root.rglob("*") if p.is_dir()}
    for rel in sorted(files):
        f = Path(rel)
        result.setdefault(f.parent.as_posix() if f.parent.as_posix() != "." else "General", []).append(f.name)
    return result

def find_sound_path(sound_dir, sound_name, category=""):
    if not sound_name:
        return None
    entered = Path(sound_name)
    if entered.is_absolute() and entered in allowed_files and entered.suffix.lower() in AUDIO_EXTENSIONS and entered.is_file():
        return str(entered)
    if not sound_dir or not Path(sound_dir).is_absolute():
        return None
    root = Path(sound_dir).resolve()
    files, aliases = _index(str(root))
    key = str(sound_name).replace("\\", "/")
    if Path(key).is_absolute():
        try:
            key = Path(key).resolve().relative_to(root).as_posix()
        except ValueError:
            # Recover paths into the former root sounds directory as well.
            key = key.split("/sounds/", 1)[-1] if "/sounds/" in key else Path(key).name
    candidates = ([category.replace("\\", "/") + "/" + key] if category and category != "General" and "/" not in key else []) + [key]
    for candidate in candidates:
        candidate = aliases.get(candidate, candidate)
        if candidate in files:
            return files[candidate]
    matches = {files[aliases.get(old, old)] for old in set(files) | set(aliases)
               if Path(old).name == Path(key).name and aliases.get(old, old) in files}
    if len(matches) == 1:
        return matches.pop()
    if len(matches) > 1:
        raise ValueError(f"Nama suara ambigu: {sound_name}. Pilih kategori/path yang lengkap.")
    return None

@lru_cache(maxsize=512)
def _duration(path, modified_ns, size):
    return probe(path)["duration"]

def sound_duration(path):
    if not path:
        raise FileNotFoundError("File suara tidak ditemukan")
    file = Path(path)
    stat = file.stat()
    return _duration(str(file.resolve()), stat.st_mtime_ns, stat.st_size)

def asset_reference(sound_dir, path):
    path = Path(path).resolve()
    if sound_dir and path.is_relative_to(Path(sound_dir).resolve()):
        return path.relative_to(Path(sound_dir).resolve()).as_posix()
    if path in allowed_files:
        return str(path)
    raise ValueError("Select the referenced audio file or its library")
