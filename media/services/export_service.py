"""Cancellable export: a session directory is published only after a complete render."""
import copy
import json
import shutil
import uuid
from pathlib import Path
from datetime import datetime
from utils.tools import probe
from services.render_service import render
from services.metadata_service import effective_annotations
from services.video_transform_service import normalize_transform, is_active_transform, transform_frame, output_size

class ExportCancelled(Exception): pass

class ExportJob:

    def __init__(self, video_path, sound_dir, annotations, tracks=None, video_muted=False, video_volume=1.0, metadata=None, legacy=False, *, output_dir, progress=lambda percent, message: None, cancelled=lambda: False):
        self.output_dir, self.progress, self.cancelled = output_dir, progress, cancelled
        self.video_path, self.sound_dir = video_path, sound_dir
        self.annotations = copy.deepcopy(annotations)
        self.tracks = copy.deepcopy(tracks)
        self.video_muted, self.video_volume = video_muted, video_volume
        self.result = None
        self.metadata = copy.deepcopy(metadata or {})
        self.legacy = legacy

    def check_cancelled(self):
        if self.cancelled(): raise ExportCancelled("Ekspor dibatalkan")

    def copy_file(self, source, target):
        with open(source, "rb") as src, open(target, "wb") as dst:
            while chunk := src.read(1024 * 1024):
                self.check_cancelled()
                dst.write(chunk)

    def run(self):
        base = None
        stage = None
        token = uuid.uuid4().hex[:10]
        try:
            empty_edit = self.metadata.get("video_edit_empty", False)
            if type(empty_edit) is not bool:
                raise ValueError("video_edit_empty harus boolean")
            if empty_edit:
                if any(track.get("media_type") == "video" and track.get("clips") for track in (self.tracks or [])):
                    raise ValueError("Penanda video kosong tidak cocok dengan potongan video dalam timeline")
                self.result = (False, "Timeline video kosong. Tambahkan video atau gunakan Undo sebelum mengekspor.", "")
                return
            base = Path(self.output_dir).resolve()
            base.mkdir(parents=True, exist_ok=True)
            stage = base / (".partial-" + token)
            final = base / (datetime.now().strftime("dataset_export_%Y-%m-%d_%H-%M-%S_") + token)
            stage.mkdir()
            self.check_cancelled()
            self.progress(5, "Memvalidasi sumber media...")
            transform = normalize_transform(self.metadata.get("video_transform"))
            if self.legacy and is_active_transform(transform):
                raise ValueError("Ekspor schema v2 tidak mendukung transformasi video. Gunakan schema v3 agar ukuran, rotasi, dan flip tetap tersimpan saat dibuka ulang.")
            if self.legacy and any(a.get("volume", 1) != 1 or a.get("is_muted") and not any(t.get("is_muted") and t.get("track_id") == a.get("track_id") for t in (self.tracks or [])) or a.get("review_status") == "rejected" for a in self.annotations):
                raise ValueError("Schema v2 tidak mendukung volume/mute per klip atau status rejected. Gunakan schema v3 untuk menjaga hasil saat dibuka ulang.")
            from services.video_edit_service import video_segments, is_identity_edit
            info = probe(self.video_path)
            source_duration = info["duration"]
            if not info["width"] or not info["height"] or not info["fps"]:
                raise ValueError("The selected file contains no playable video")
            segments = video_segments(self.tracks, source_duration, self.video_path)
            if self.legacy and not is_identity_edit(segments, source_duration):
                raise ValueError("Export edited video as schema v3")
            duration = sum(segment["duration"] for segment in segments)
            effective = effective_annotations(self.annotations, duration, self.sound_dir)
            visuals = [copy.deepcopy(c) for t in (self.tracks or []) if t["media_type"] == "visual"
                       and not t.get("is_muted") and t.get("is_visible", True) for c in t["clips"]
                       if not c.get("is_muted") and c.get("review_status") != "rejected"
                       and c.get("opacity", 1) > 0 and c["start_time"] < duration]
            if self.legacy and visuals:
                raise ValueError("Export visual tracks as schema v3")
            rendered_width, rendered_height = output_size(info["width"], info["height"], transform)
            raw_name = "raw" + Path(self.video_path).suffix.lower()
            self.copy_file(self.video_path, stage / raw_name)
            render(stage, self.video_path, segments, effective, self.sound_dir, visuals, transform, info,
                   self.video_muted, self.video_volume, self.check_cancelled, self.progress)
            self.check_cancelled()
            metadata = {**self.metadata, "schema_version": (2 if self.legacy else 3) if self.tracks is not None else 1,
                "original_video": Path(self.video_path).name, "raw_file": raw_name,
                "sounds_directory": self.sound_dir, "export_time": datetime.now().isoformat(),
                "video_volume": self.video_volume, "video_muted": self.video_muted,
                "annotations": effective,
                "session_annotations": self.annotations, "rendered_annotations": effective,
                "video_path": raw_name, "sound_dir": self.sound_dir,
                "render_dirty": False, "video_duration": duration,
                "video_transform": transform,
                "video_info": {**self.metadata.get("video_info", {}), "width": info["width"],
                    "height": info["height"], "duration": source_duration, "fps": info["fps"]},
                "rendered_video_info": {"width": rendered_width, "height": rendered_height,
                    "duration": duration, "fps": info["fps"]}}
            metadata["annotations_role"] = "rendered"
            if self.tracks is not None: metadata["tracks"] = copy.deepcopy(self.tracks)
            if metadata.get("tracks"):
                for track in metadata["tracks"]:
                    for clip in track["clips"]:
                        if clip["media_type"] == "video": clip["file_path"] = raw_name
                        if clip["media_type"] == "visual" and clip.get("effect") == "sticker":
                            source = Path(clip["file_path"])
                            asset = Path("assets/visual_effects") / (uuid.uuid4().hex + source.suffix.lower())
                            (stage / asset).parent.mkdir(parents=True, exist_ok=True)
                            self.copy_file(source, stage / asset)
                            clip["file_path"] = asset.as_posix()
                            for visual in visuals:
                                if visual["clip_id"] == clip["clip_id"]: visual["file_path"] = asset.as_posix()
                if self.legacy: metadata["tracks"] = [t for t in metadata["tracks"] if t["media_type"] != "visual"]
            metadata["rendered_visuals"] = [{**c, "effective_duration": min(c["duration"], duration-c["start_time"])} for c in visuals]
            (stage / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
            (stage / "metadata.txt").write_text("".join(f"{a['timestamp']:.3f}\t{a.get('file_path') or a['sound_name']}\n" for a in effective), encoding="utf-8")
            self.check_cancelled()
            stage.rename(final)
            self.result = (True, "Dataset berhasil diekspor.", str(final))
            self.progress(100, "Ekspor selesai")
        except ExportCancelled:
            self.result = (False, "Ekspor dibatalkan. Sesi edit tetap tersimpan.", "")
        except Exception as error:
            self.result = (False, str(error), "")
        finally:
            # Only this worker's unique staging directory may be removed.
            if stage is not None and stage.exists() and stage.resolve().parent == base and stage.name == ".partial-" + token:
                try:
                    shutil.rmtree(stage)
                except OSError as exc:
                    self.result = (False, f"{self.result[1]}\nBerkas sementara belum bisa dibersihkan: {stage} ({exc})", "")
