from typing import List, Optional
import copy
from config.settings import SNAPPING_ENABLED
from config.constants import DEFAULT_ZOOM
from models.track_model import TrackModel
from models.clip_model import ClipModel

class TimelineModel:
    def __init__(self):
        self.duration = 0.0
        self.current_time = 0.0
        self.zoom_level = DEFAULT_ZOOM
        self.snapping_enabled = SNAPPING_ENABLED
        self.looping_enabled = False
        self.video_volume = 0.8
        self.metadata = {}
        self.events = []
        self.corrections = []
        self.analysis_settings = {}
        self.render_dirty = False
        
        # Ordered list of Track Models
        # Always starts with one video track and at least one audio track
        self.tracks: List[TrackModel] = [
            TrackModel("video_track_0", "Video 1", "video"),
            TrackModel("audio_track_0", "Audio 1", "audio")
        ]

        # Selections
        self.selected_clip_id: Optional[str] = None
        self.selected_track_id: Optional[str] = None

    def get_video_tracks(self) -> List[TrackModel]:
        return [t for t in self.tracks if t.media_type == "video"]

    def get_audio_tracks(self) -> List[TrackModel]:
        return [t for t in self.tracks if t.media_type == "audio"]

    def get_selected_clip(self) -> Optional[ClipModel]:
        if not self.selected_clip_id:
            return None
        for track in self.tracks:
            for clip in track.clips:
                if clip.clip_id == self.selected_clip_id:
                    return clip
        return None

    def clear_selection(self):
        self.selected_clip_id = None
        self.selected_track_id = None
        for track in self.tracks:
            for clip in track.clips:
                clip.is_selected = False

    def select_clip(self, clip_id: str):
        self.clear_selection()
        self.selected_clip_id = clip_id
        for track in self.tracks:
            for clip in track.clips:
                if clip.clip_id == clip_id:
                    clip.is_selected = True
                    self.selected_track_id = track.track_id
                    break

    def select_track(self, track_id: str):
        self.clear_selection()
        self.selected_track_id = track_id

    def get_all_clips(self) -> List[ClipModel]:
        clips = []
        for track in self.tracks:
            clips.extend(track.clips)
        return clips

    def get_annotations(self) -> List[dict]:
        """Convert all audio clips across all audio tracks to annotation items"""
        annotations = []
        for track in self.get_audio_tracks():
            for clip in track.clips:
                annotations.append({
                    **copy.deepcopy(clip.extra),
                    "clip_id": clip.clip_id,
                    "track_id": track.track_id,
                    "duration": clip.duration,
                    "source_offset": clip.source_offset,
                    "file_path": clip.file_path,
                    "is_muted": track.is_muted or clip.extra.get("is_muted", False),
                    "timestamp": clip.start_time,
                    "sound_name": clip.name,
                    "category": clip.category
                })
        annotations.sort(key=lambda x: x["timestamp"])
        return annotations

    def snapshot(self):
        return copy.deepcopy({"tracks": [t.to_dict() for t in self.tracks], "duration": self.duration,
            "metadata": self.metadata, "events": self.events, "corrections": self.corrections,
            "analysis_settings": self.analysis_settings, "render_dirty": self.render_dirty,
            "video_volume": self.video_volume, "zoom_level": self.zoom_level,
            "snapping_enabled": self.snapping_enabled, "looping_enabled": self.looping_enabled})

    def restore(self, state):
        state = copy.deepcopy(state)
        self.tracks = [TrackModel.from_dict(t) for t in state.pop("tracks")]
        for key, value in state.items(): setattr(self, key, value)
        self.clear_selection()
