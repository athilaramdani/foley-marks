"""Fixed binaries supplied by the desktop host."""
import array
import json
import math
import os
from fractions import Fraction
from pathlib import Path
import subprocess


def binary(name):
    folder = Path(os.environ["FOLEYMARKS_TOOL_DIR"]).resolve(strict=True)
    installed = folder / (name + ".exe")
    return str(installed if installed.exists() else folder / (name + "-x86_64-pc-windows-msvc.exe"))


def probe(path):
    args = [binary("ffprobe"), "-v", "error", "-protocol_whitelist", "file,pipe",
            "-show_entries", "stream=codec_type,avg_frame_rate,width,height,duration:format=duration",
            "-of", "json", str(Path(path).resolve(strict=True))]
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True,
                            timeout=45, creationflags=subprocess.CREATE_NO_WINDOW)
    parsed = json.loads(result.stdout)
    streams = parsed.get("streams", [])
    video = next((stream for stream in streams if stream["codec_type"] == "video"), {})
    audio = next((stream for stream in streams if stream["codec_type"] == "audio"), {})
    # A container can have audio extending beyond the video stream.
    durations = [video.get("duration"), parsed.get("format", {}).get("duration"), audio.get("duration")]
    duration = next((float(d) for d in durations if d not in (None, "N/A") and float(d) > 0), 0)
    if not math.isfinite(duration) or duration <= 0 or not (video or audio):
        raise ValueError("Unsupported file or invalid media duration")
    rate = video.get("avg_frame_rate", "0")
    return {"duration": duration, "width": video.get("width", 0), "height": video.get("height", 0),
            "fps": float(Fraction(rate)) if rate not in ("0/0", "N/A") else 0, "hasAudio": bool(audio)}


def waveform(path, bins):
    if type(bins) is not int or not 16 <= bins <= 8192:
        raise ValueError("Waveform resolution must be between 16 and 8192 bins")
    info = probe(path)
    peaks = [0.0] * bins
    if not info["hasAudio"]:
        return {"peaks": peaks}
    rate = 8000
    total = max(1, round(rate * info["duration"]))
    args = [binary("ffmpeg"), "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
            "-i", str(Path(path).resolve(strict=True)), "-map", "0:a:0", "-ac", "1", "-ar", str(rate),
            "-f", "s16le", "pipe:1"]
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          creationflags=subprocess.CREATE_NO_WINDOW) as proc:
        pos = 0
        while data := proc.stdout.read(65536):
            samples = array.array("h", data)
            i = 0
            while i < len(samples):
                index = min(bins - 1, pos * bins // total)
                count = min(len(samples) - i, max(1, math.ceil((index + 1) * total / bins) - pos))
                if index == bins - 1:
                    count = len(samples) - i
                chunk = samples[i:i+count]
                peaks[index] = max(peaks[index], max(abs(min(chunk)), abs(max(chunk))) / 32768)
                pos += count
                i += count
        if proc.wait():
            raise ValueError("Waveform decoding failed")
    return {"peaks": peaks}
