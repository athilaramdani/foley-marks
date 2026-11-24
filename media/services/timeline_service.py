import math
import uuid
import copy
from models.track_model import TrackModel
from models.clip_model import ClipModel

class TimelineService:
    @staticmethod
    def locate(timeline, clip_id):
        for track in timeline.tracks:
            for clip in track.clips:
                if clip.clip_id == clip_id:
                    return track, clip
        return None, None

    @staticmethod
    def detect_collision(track, start_time, duration, exclude_clip_id=None):
        return any(c.clip_id != exclude_clip_id and max(start_time, c.start_time) < min(start_time + duration, c.start_time + c.duration) for c in track.clips)

    @classmethod
    def get_or_create_non_colliding_track(cls, timeline, start_time, duration, exclude_clip_id=None):
        for track in timeline.get_audio_tracks():
            if not track.is_locked and not track.is_muted and not cls.detect_collision(track, start_time, duration, exclude_clip_id):
                return track
        numbers = [int(t.name.split()[-1]) for t in timeline.get_audio_tracks() if t.name.split()[-1].isdigit()]
        track = TrackModel("audio_" + uuid.uuid4().hex, f"Audio {max(numbers, default=0) + 1}", "audio")
        timeline.tracks.append(track)
        return track

    @classmethod
    def add_audio_clip(cls, timeline, name, start_time, duration, file_path="", category="", source_offset=0.0):
        if not all(math.isfinite(v) for v in (start_time, duration, source_offset)) or start_time < 0 or duration <= 0 or source_offset < 0:
            raise ValueError("Waktu/durasi klip tidak valid")
        clip = ClipModel(name, start_time, duration, "audio", file_path, category, source_offset)
        cls.get_or_create_non_colliding_track(timeline, start_time, duration).add_clip(clip)
        return clip

    @classmethod
    def move_audio_clip(cls, timeline, clip_id, new_start_time):
        track, clip = cls.locate(timeline, clip_id)
        if clip and clip.media_type == "video":
            from services.video_edit_service import reorder_video
            return bool(reorder_video(timeline, clip_id, new_start_time))
        if not clip or clip.media_type not in ("audio", "visual") or track.is_locked or not math.isfinite(new_start_time):
            return False
        new_start_time = max(0.0, min(new_start_time, timeline.duration)) if timeline.duration else max(0.0, new_start_time)
        clip.start_time = new_start_time
        if clip.media_type == "audio" and cls.detect_collision(track, new_start_time, clip.duration, clip_id):
            target = cls.get_or_create_non_colliding_track(timeline, new_start_time, clip.duration, clip_id)
            if target is not track:
                track.remove_clip(clip_id)
                target.add_clip(clip)
        track.sort_clips()
        cls.cleanup_empty_tracks(timeline)
        return True

    @staticmethod
    def cleanup_empty_tracks(timeline):
        audio = timeline.get_audio_tracks()
        timeline.tracks = timeline.get_video_tracks() + [t for i,t in enumerate(audio) if i == 0 or t.clips or t.is_locked or t.is_muted] + [t for t in timeline.tracks if t.media_type == "visual"]

    @classmethod
    def split_clip(cls, timeline, clip_id, split_time):
        track, clip = cls.locate(timeline, clip_id)
        if clip and clip.media_type == "video":
            from services.video_edit_service import split_video
            return bool(split_video(timeline, clip_id, split_time))
        if not clip or clip.media_type != "audio" or track.is_locked or not clip.start_time < split_time < clip.start_time + clip.duration:
            return False
        first_duration = split_time - clip.start_time
        tail = ClipModel(clip.name, split_time, clip.duration - first_duration, "audio", clip.file_path, clip.category, clip.source_offset + first_duration)
        tail.extra = copy.deepcopy(clip.extra)
        if clip.extra.get("origin") == "automatic":
            clip.extra["review_status"] = tail.extra["review_status"] = "modified"
        clip.duration = first_duration
        track.add_clip(tail)
        return True
