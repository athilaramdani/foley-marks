from typing import List
import copy
from models.clip_model import ClipModel

class TrackModel:
    def __init__(self, track_id: str, name: str, media_type: str):
        self.track_id = track_id
        self.name = name
        self.media_type = media_type  # 'video' or 'audio'
        self.extra = {}
        
        # Track states
        self.is_locked = False
        self.is_visible = True
        self.is_muted = False
        
        self.clips: List[ClipModel] = []

    def add_clip(self, clip: ClipModel):
        self.clips.append(clip)
        self.sort_clips()

    def remove_clip(self, clip_id: str) -> bool:
        for idx, clip in enumerate(self.clips):
            if clip.clip_id == clip_id:
                self.clips.pop(idx)
                return True
        return False

    def sort_clips(self):
        self.clips.sort(key=lambda c: c.start_time)

    def to_dict(self) -> dict:
        return {
            **copy.deepcopy(self.extra),
            "track_id": self.track_id,
            "name": self.name,
            "media_type": self.media_type,
            "is_locked": self.is_locked,
            "is_visible": self.is_visible,
            "is_muted": self.is_muted,
            "clips": [clip.to_dict() for clip in self.clips]
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'TrackModel':
        track = cls(
            track_id=data.get("track_id", "default_track"),
            name=data.get("name", "Track"),
            media_type=data.get("media_type", "audio")
        )
        track.is_locked = data.get("is_locked", False)
        track.is_visible = data.get("is_visible", True)
        track.is_muted = data.get("is_muted", False)
        known = {"track_id", "name", "media_type", "is_locked", "is_visible", "is_muted", "clips"}
        track.extra = copy.deepcopy({k: v for k, v in data.items() if k not in known})
        
        for clip_data in data.get("clips", []):
            track.add_clip(ClipModel.from_dict(clip_data))
            
        return track
