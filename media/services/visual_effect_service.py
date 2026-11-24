"""The same RGBA compositor is used for preview and export."""
from functools import lru_cache
from pathlib import Path
import math
import numpy as np
from PIL import Image, ImageDraw, ImageSequence
from services.metadata_service import number

KINDS = ("dust", "jump_puff", "exclamation", "fart_smoke", "sticker")
MODES = ("screen_fixed", "body_follow", "spawn_release")


def validate_visual(clip):
    if clip.get("effect", "dust") not in KINDS: raise ValueError("Jenis visual tidak didukung")
    if clip.get("tracking_mode", "screen_fixed") not in MODES: raise ValueError("Mode tracking tidak valid")
    for key, default, lo, hi in (("x", .5, 0, 1), ("y", .5, 0, 1), ("scale", .2, .01, 2),
            ("opacity", 1, 0, 1), ("rotation", 0, -360, 360), ("direction", 1, -1, 1),
            ("playback_speed", 1, .1, 10), ("layer", 0, -100, 100)):
        number(clip.get(key, default), key, lo, hi)
    for key in ("anchor_dx", "anchor_dy"): number(clip.get(key, 0), key, -1, 1)
    number(clip.get("animation_offset", 0), "animation_offset")
    if "animation_duration" in clip:
        number(clip["animation_duration"], "animation_duration", .001)
    for key in ("tracking_visible_start", "tracking_visible_end"):
        if key in clip: number(clip[key], key, -math.inf)
    if clip.get("tracking_visible_start", -math.inf) > clip.get("tracking_visible_end", math.inf):
        raise ValueError("Batas waktu tracking tidak valid")
    if clip.get("tracking_mode") == "body_follow" and not clip.get("tracking"):
        raise ValueError("Body Follow membutuhkan keyframe tracking; pilih Screen Fixed jika belum tersedia")
    last = -1
    for key in clip.get("tracking", []):
        number(key.get("time"), "tracking.time")
        if key["time"] < last: raise ValueError("Tracking harus diurutkan")
        last = key["time"]
        number(key.get("x"), "tracking.x", 0, 1)
        number(key.get("y"), "tracking.y", 0, 1)
    if clip.get("effect") == "sticker" and Path(clip.get("file_path", "")).suffix.lower() not in (".png", ".gif", ".webp"):
        raise ValueError("Stiker mendukung PNG, GIF, dan WebP")


@lru_cache(maxsize=24)
def sticker_frames(path, modified):
    frames, times, elapsed = [], [], 0.0
    with Image.open(path) as source:
        if source.width * source.height > 16000000: raise ValueError("Stiker terlalu besar (maks. 16 megapixel)")
        for i, frame in enumerate(ImageSequence.Iterator(source)):
            if i >= 240: raise ValueError("Stiker maksimal 240 frame")
            image = frame.convert("RGBA")
            image.thumbnail((512, 512))
            frames.append(image.copy())
            elapsed += max(.02, frame.info.get("duration", 100) / 1000)
            times.append(elapsed)
    return frames, times


def sprite(clip, elapsed):
    kind = clip.get("effect", "dust")
    speed = clip.get("playback_speed", 1)
    phase = min(1, elapsed / max(clip.get("animation_duration", clip["duration"]), .001))
    if kind == "sticker":
        path = Path(clip["file_path"])
        frames, times = sticker_frames(str(path.resolve()), path.stat().st_mtime_ns)
        t = elapsed * speed % times[-1]
        return frames[next((i for i, end in enumerate(times) if t < end), len(frames)-1)].copy()
    img = Image.new("RGBA", (192, 192))
    draw = ImageDraw.Draw(img)
    if kind == "exclamation":
        draw.rounded_rectangle((81, 15, 111, 126), radius=10, fill=(255, 223, 70, 255), outline=(50, 38, 20, 255), width=5)
        draw.ellipse((81, 143, 111, 173), fill=(255, 223, 70, 255), outline=(50, 38, 20, 255), width=4)
    else:
        color = (190, 205, 140) if kind == "fart_smoke" else (224, 211, 185)
        alpha = round(210 * (1-phase))
        for i, (x, y) in enumerate(((65, 115), (110, 115), (93, 80), (133, 83), (54, 76))):
            radius = (20 + 18*phase) * (1 + .1*math.sin(elapsed*speed*8+i))
            draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=(*color, alpha), outline=(100, 94, 73, alpha), width=2)
    return img


def anchor(clip, time):
    x, y = clip.get("x", .5), clip.get("y", .5)
    tracking = clip.get("tracking", [])
    mode = clip.get("tracking_mode", "screen_fixed")
    if mode == "body_follow" and tracking:
        if time < clip.get("tracking_visible_start", tracking[0]["time"]-.4) or time > clip.get("tracking_visible_end", tracking[-1]["time"]+.4): return None
        before = next((k for k in reversed(tracking) if k["time"] <= time), tracking[0])
        after = next((k for k in tracking if k["time"] >= time), tracking[-1])
        fraction = (time-before["time"]) / max(.001, after["time"]-before["time"])
        fraction = max(0, min(1, fraction))
        x = before["x"] + fraction * (after["x"]-before["x"]) + clip.get("anchor_dx", 0)
        y = before["y"] + fraction * (after["y"]-before["y"]) + clip.get("anchor_dy", 0)
    elif mode == "spawn_release":
        age = (time-clip["start_time"]+clip.get("animation_offset", clip.get("source_offset", 0)))/clip.get("animation_duration", clip["duration"])
        x += .18 * age * clip.get("direction", 1)
        y -= .08 * age
    return x, y


def visual_clips(tracks):
    return [c.to_dict() for t in tracks if t.media_type == "visual" and not t.is_muted and t.is_visible
        for c in t.clips if not c.extra.get("is_muted") and c.extra.get("review_status") != "rejected"]


def composite_frame(frame, time, clips):
    visible = [c for c in clips if c["start_time"] <= time < c["start_time"]+c["duration"] and c.get("opacity", 1) > 0]
    if not visible: return frame
    base = Image.fromarray(np.asarray(frame, dtype=np.uint8)).convert("RGBA")
    for clip in sorted(visible, key=lambda c:c.get("layer", 0)):
        point = anchor(clip, time)
        if point is None: continue
        overlay = sprite(clip, time-clip["start_time"] + clip.get("animation_offset", clip.get("source_offset", 0)))
        size = max(1, round(base.width * clip.get("scale", .2)))
        overlay = overlay.resize((size, max(1, round(size*overlay.height/overlay.width))), Image.Resampling.LANCZOS)
        overlay = overlay.rotate(clip.get("rotation", 0), expand=True)
        overlay.putalpha(overlay.getchannel("A").point(lambda v:round(v*clip.get("opacity", 1))))
        base.alpha_composite(overlay, (round(point[0]*base.width-overlay.width/2), round(point[1]*base.height-overlay.height/2)))
    return np.asarray(base.convert("RGB"))
