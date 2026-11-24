"""Bounded-memory renderer. Frame/sample boundaries reference absolute timeline positions."""
from contextlib import contextmanager, ExitStack
from fractions import Fraction
from pathlib import Path
import subprocess

import numpy as np

from services.video_transform_service import transform_frame, output_size, is_active_transform
from services.visual_effect_service import composite_frame
from utils.tools import binary
from utils.helpers import find_sound_path

RATE = 48000
CHANNELS = 2
CHUNK = 4096


def clock(seconds, rate):
    return round(float(seconds) * float(rate))


@contextmanager
def process(args, *, reading):
    with subprocess.Popen([binary("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error", *args],
                          stdin=subprocess.DEVNULL if reading else subprocess.PIPE,
                          stdout=subprocess.PIPE if reading else subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW) as proc:
        pipe = proc.stdout if reading else proc.stdin
        try:
            yield pipe
            pipe.close()
            if reading:
                # Rounding a segment to a timeline boundary can leave one extra source frame.
                if proc.poll() is None:
                    proc.kill()
                proc.wait()
            elif proc.wait():
                raise ValueError("FFmpeg failed to encode media. Check destination storage.")
        finally:
            if proc.poll() is None:
                proc.kill()
            pipe.close()
            proc.wait()


def write_audio(target, video, segments, annotations, root, duration, info, muted, volume, check):
    items = []
    if info["hasAudio"] and not muted and volume > 0:
        items.extend((seg["start_time"], seg["duration"], video, seg["source_offset"], volume) for seg in segments)
    for ann in annotations:
        ref = find_sound_path(root, ann.get("file_path") or ann["sound_name"], ann.get("category", ""))
        items.append((ann["timestamp"], ann["duration"], ref, ann.get("source_offset", 0), ann.get("volume", 1)))
    if not items:
        return False
    sources = sorted((clock(start, RATE), clock(start + length, RATE), i, path, offset, gain)
                     for i, (start, length, path, offset, gain) in enumerate(items))
    encoder = ["-f", "f32le", "-ar", str(RATE), "-ac", "2", "-i", "pipe:0",
               "-c:a", "aac", "-b:a", "192k", str(target)]
    active = []
    next_source = 0
    total = clock(duration, RATE)
    try:
        with process(encoder, reading=False) as output:
            for pos in range(0, total, CHUNK):
                check()
                end = min(pos + CHUNK, total)
                block = np.zeros((end - pos, CHANNELS), dtype="<f4")
                while next_source < len(sources) and sources[next_source][0] < end:
                    start, stop, _, path, offset, gain = sources[next_source]
                    next_source += 1
                    if stop <= start:
                        continue
                    args = ["-protocol_whitelist", "file,pipe", "-ss", str(offset), "-i", str(path),
                            "-map", "0:a:0", "-ac", "2", "-ar", str(RATE), "-f", "f32le", "pipe:1"]
                    reader = process(args, reading=True)
                    pipe = reader.__enter__()
                    active.append((start, stop, gain, pipe, reader))
                for entry in active.copy():
                    start, stop, gain, pipe, reader = entry
                    left, right = max(pos, start), min(end, stop)
                    size = right - left
                    buf = pipe.read(size * CHANNELS * 4)
                    if not buf and left == start:
                        raise ValueError("Audio source cannot be decoded at the requested offset")
                    decoded = np.frombuffer(buf, dtype="<f4").reshape(-1, CHANNELS)
                    block[left-pos:left-pos+len(decoded)] += decoded * gain
                    if stop <= end:
                        reader.__exit__(None, None, None)
                        active.remove(entry)
                output.write(np.clip(block, -1, 1).tobytes())
    finally:
        for _, _, _, _, reader in active:
            reader.__exit__(None, None, None)
    return True


def render(stage, video, segments, annotations, root, visuals, transform, info, muted, volume, check, progress):
    duration = sum(segment["duration"] for segment in segments)
    audio = stage / "mix.m4a"
    has_audio = write_audio(audio, video, segments, annotations, root, duration, info, muted, volume, check)
    fps = Fraction(str(info["fps"])).limit_denominator(100000)
    width, height = info["width"], info["height"]
    out_width, out_height = output_size(width, height, transform)
    apply_transform = is_active_transform(transform) or (width, height) != (out_width, out_height)
    frame_size = width * height * 3
    args = ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{out_width}x{out_height}",
            "-r", str(fps), "-i", "pipe:0"]
    if has_audio:
        args.extend(["-i", str(audio), "-map", "0:v:0", "-map", "1:a:0", "-c:a", "copy"])
    args.extend(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
                 "-movflags", "+faststart", str(stage / "edited.mp4")])
    total = max(1, clock(duration, fps))
    with process(args, reading=False) as output:
        for segment in segments:
            start = clock(segment["start_time"], fps)
            end = clock(segment["start_time"] + segment["duration"], fps)
            if segment is segments[-1]:
                end = total
            count = end - start
            if count <= 0:
                continue
            # Seeking happens once per edit. Every segment writes exactly the delta of
            # its two absolute frame boundaries to avoid cumulative rounding drift.
            decode = ["-protocol_whitelist", "file,pipe", "-ss", str(segment["source_offset"]),
                      "-i", video, "-map", "0:v:0", "-an", "-sn", "-vf",
                      f"fps={fps},scale={width}:{height}", "-pix_fmt", "rgb24", "-frames:v", str(count),
                      "-f", "rawvideo", "pipe:1"]
            with process(decode, reading=True) as frames:
                previous = None
                for index in range(start, end):
                    check()
                    data = frames.read(frame_size)
                    if not data and previous is not None:
                        data = previous
                    if len(data) != frame_size:
                        raise ValueError("Source video failed to decode at the selected edit")
                    previous = data
                    if visuals or apply_transform:
                        frame = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
                        if visuals:
                            frame = composite_frame(frame, float(index / fps), visuals)
                        if apply_transform:
                            frame = transform_frame(frame, transform)
                        data = np.ascontiguousarray(frame).tobytes()
                    output.write(data)
                    if index % max(1, round(float(fps))) == 0:
                        progress(35 + round(60 * index / total), "Rendering video")
    if has_audio:
        audio.unlink()
    return duration
