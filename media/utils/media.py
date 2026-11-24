"""Close MoviePy readers and their pipes even if FFmpeg exited before close()."""
from contextlib import contextmanager

@contextmanager
def managed_media(clip):
    def processes():
        result = []
        for owner in (clip, getattr(clip, "audio", None)):
            reader = getattr(owner, "reader", None)
            process = getattr(reader, "proc", None)
            if process is not None: result.append(process)
        return result
    opened = processes()
    try:
        yield clip
    finally:
        opened += processes()
        try:
            clip.close()
        finally:
            for process in opened:
                for stream in (process.stdin, process.stdout, process.stderr):
                    if stream is not None and not stream.closed: stream.close()
