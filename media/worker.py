"""One request on stdin, one response on stdout. Paths are capabilities supplied by Rust."""
import contextlib
import json
import os
from pathlib import Path
import sys

from utils.tools import binary, probe, waveform


def add_generated_visuals(model, threshold):
    from models.clip_model import ClipModel
    from models.track_model import TrackModel
    mapping = {"running": "dust", "jump": "jump_puff", "sudden_reaction": "exclamation"}
    existing = {c.extra.get("event_id") for c in model.get_all_clips() if c.media_type == "visual"}
    track = next((t for t in model.tracks if t.media_type == "visual" and not t.is_locked), None)
    for event in model.events:
        kind = mapping.get(event["event_type"])
        start = event["peak_time"]
        if (not kind or event["event_id"] in existing or not event.get("subject_id") or
                event.get("status") == "rejected" or event["confidence"] < threshold or start >= model.duration):
            continue
        if track is None:
            from uuid import uuid4
            track = TrackModel(uuid4().hex, "Visual", "visual")
            model.tracks.append(track)
        x, y = event["anchor"]
        clip = ClipModel(kind, start, min(0.8, model.duration - start), "visual")
        clip.extra.update(effect=kind, x=max(0, min(1, x)), y=max(0, min(1, y)), scale=.18,
                          tracking_mode="spawn_release", event_id=event["event_id"], origin="automatic",
                          review_status="auto-generated")
        track.add_clip(clip)
        existing.add(event["event_id"])
        model.render_dirty = True


def check_allowed(value, allowed):
    path = Path(value)
    if not path.is_absolute() or path not in allowed or not path.is_file():
        raise ValueError("Media unavailable. Relink the original file in FoleyMarks.")
    return str(path)


def handle(request):
    op = request["op"]
    if op in ("probe", "waveform"):
        path = request["path"]
        if not Path(path).is_absolute():
            raise ValueError("Select a local media file")
        return probe(path) if op == "probe" else waveform(path, request.get("bins", 256))
    if op not in ("edit", "normalize", "analyze", "export"):
        raise ValueError("Unknown media operation")
    from models.timeline_model import TimelineModel
    from models.clip_model import ClipModel
    from services.session_service import SessionService
    from services.metadata_service import document
    from services import video_edit_service as edits
    from utils import helpers

    project = request["project"]
    allowed = helpers.allowed_files = frozenset(Path(p) for p in request.get("allowedFiles", []) if Path(p).is_absolute())
    root = request.get("soundDir") or ""
    if root and not Path(root).is_absolute():
        raise ValueError("Select the SFX library folder")
    video = project.get("video_path") or ""
    info = project.get("video_info", {})
    model = TimelineModel()
    model.duration = float(info.get("duration", 0))
    SessionService.apply_data(model, project, root, allow_missing=True)
    if video and not model.get_video_tracks()[0].clips and not project.get("video_edit_empty"):
        if Path(video) in allowed and Path(video).is_file():
            info = probe(video)
        if info.get("duration", 0) > 0:
            model.metadata["video_info"] = info
            model.duration = info["duration"]
            model.get_video_tracks()[0].add_clip(ClipModel(Path(video).name, 0, model.duration, "video", video))
    if op == "edit":
        action, clip_id = request["action"], request["clipId"]
        if action == "split":
            edits.split_video(model, clip_id, request["time"])
        elif action == "reorder":
            edits.reorder_video(model, clip_id, request["time"])
        elif action == "delete":
            edits.delete_video(model, clip_id)
        else:
            raise ValueError("Unknown editing operation")
    if op in ("export", "analyze"):
        if model.metadata.get("video_edit_empty"):
            raise ValueError("The video track is empty")
        check_allowed(video, allowed)
    if op == "analyze":
        from services.video_analysis_service import VideoAnalyzer, validate_settings
        from services.automatic_annotation_service import merge_analysis
        from services.analysis_timeline_service import analysis_for_timeline
        from services.library_service import SoundLibrary
        settings = validate_settings({**model.analysis_settings, **(request.get("settings") or {})})
        if settings["pose_model"]:
            check_allowed(settings["pose_model"], allowed)
        segments = edits.video_segments(model, source_path=video)
        start, end = request.get("segment") or (0, model.duration)
        if not 0 <= start < end <= model.duration + 1e-6:
            raise ValueError("Invalid analysis time range")
        identity = edits.is_identity_edit(segments, info.get("duration"))
        analysis = VideoAnalyzer().analyze(video, settings, segment=(start, end) if identity else None)
        if not identity:
            analysis = analysis_for_timeline(analysis, segments, start, end)
        sounds = SoundLibrary(root).scan() if root and Path(root).is_dir() else []
        merge_analysis(model, analysis, sounds, settings, request.get("strategy") or "update_auto", request.get("selectedIds") or [])
        if settings["visual_enabled"]:
            add_generated_visuals(model, settings["min_confidence"])
    model.metadata["video_duration"] = model.duration
    result = document(model, video, root)
    if op != "export":
        return result

    from services.export_service import ExportJob
    for track in result["tracks"]:
        for clip in track["clips"]:
            if clip["media_type"] == "visual" and clip.get("effect") == "sticker":
                check_allowed(clip["file_path"], allowed)
    target = request["outputDir"]
    if not Path(target).is_absolute():
        raise ValueError("Select an export directory")
    job = ExportJob(video, root, model.get_annotations(), result["tracks"], model.get_video_tracks()[0].is_muted,
                    model.video_volume, result, output_dir=target)
    job.run()
    success, message, directory = job.result
    if not success:
        raise ValueError(message)
    return {"directory": directory}


def configure():
    binary("ffmpeg")  # Fail fast if the native host supplied no trusted codec directory.


def main():
    try:
        configure()
        payload = sys.stdin.buffer.read(32*1024*1024 + 1)
        if len(payload) > 32*1024*1024:
            raise ValueError("Project exceeds the worker request limit")
        with contextlib.redirect_stdout(sys.stderr):
            result = handle(json.loads(payload.decode("utf-8-sig")))
        response = {"ok": True, "result": result}
    except Exception as exc:
        response = {"ok": False, "error": str(exc)[:4096] or type(exc).__name__}
    sys.stdout.buffer.write(json.dumps(response, ensure_ascii=False, allow_nan=False).encode("utf-8"))


if __name__ == "__main__":
    main()
