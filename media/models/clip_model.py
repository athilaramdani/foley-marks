import uuid
import copy

class ClipModel:
    def __init__(self, name: str, start_time: float, duration: float, media_type: str, file_path: str = "", category: str = "", source_offset: float = 0.0):
        self.clip_id = str(uuid.uuid4())
        self.name = name
        self.start_time = start_time
        self.duration = duration
        self.media_type = media_type  # 'video' or 'audio'
        self.file_path = file_path
        self.category = category
        self.source_offset = source_offset
        self.extra = {}

        # UI States
        self.is_selected = False
        self.is_hovered = False

    def to_dict(self) -> dict:
        return {
            **copy.deepcopy(self.extra),
            "clip_id": self.clip_id,
            "name": self.name,
            "start_time": self.start_time,
            "duration": self.duration,
            "media_type": self.media_type,
            "file_path": self.file_path,
            "category": self.category,
            "source_offset": self.source_offset
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'ClipModel':
        clip = cls(
            name=data.get("name", "Unnamed Clip"),
            start_time=data.get("start_time", 0.0),
            duration=data.get("duration", 1.5),
            media_type=data.get("media_type", "audio"),
            file_path=data.get("file_path", ""),
            category=data.get("category", ""),
            source_offset=data.get("source_offset", 0.0)
        )
        if "clip_id" in data:
            clip.clip_id = data["clip_id"]
        known = {"clip_id", "name", "start_time", "duration", "media_type", "file_path", "category", "source_offset"}
        clip.extra = copy.deepcopy({k: v for k, v in data.items() if k not in known})
        return clip
