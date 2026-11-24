"""Decode sampled images with their real presentation timestamps from the bundled FFmpeg."""
import os
import queue
import re
import subprocess
import threading
from contextlib import contextmanager

import numpy as np

from utils.tools import binary

STAMP = re.compile(rb"\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:([-0-9.eE+]+)")


@contextmanager
def sampled_frames(path, info, start, end, rate):
    width = min(info["width"], 384)
    height = max(2, round(info["height"] * width / info["width"]))
    select = f"select='gte(t,{start:.9f})*(isnan(prev_selected_t)+gte(t-prev_selected_t,{1/rate-.001:.9f}))'"
    filters = f"{select},scale={width}:{height},showinfo"
    args = [binary("ffmpeg"), "-nostdin", "-loglevel", "info", "-protocol_whitelist", "file,pipe",
            "-to", str(end), "-i", str(path), "-map", "0:v:0", "-an", "-sn", "-vf", filters,
            "-fps_mode", "passthrough", "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1"]
    stamps = queue.Queue()
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          creationflags=subprocess.CREATE_NO_WINDOW) as proc:
        def collect():
            for line in proc.stderr:
                match = STAMP.search(line)
                if match:
                    stamps.put(float(match[1]))
            stamps.put(None)
        thread = threading.Thread(target=collect, daemon=True)
        thread.start()

        def frames():
            size = width * height * 3
            seen = False
            while data := proc.stdout.read(size):
                stamp = stamps.get(timeout=30)
                if stamp is None or len(data) != size:
                    raise ValueError("Invalid decoded frame or timestamp")
                seen = True
                yield stamp, np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
            if proc.wait() or (not seen and start == 0):
                raise ValueError("Could not decode video for analysis")

        try:
            yield frames()
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.stdout.close()
            proc.wait()
            thread.join(timeout=5)
