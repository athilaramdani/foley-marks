# FoleyMarks media runtime

The production release launches independently replaceable FFmpeg and FFprobe executables (FFmpeg 9.1 with libx264). The codec tools use GPLv2 or later. The release's media-sources.zip contains the corresponding source archives, configure logs, compiler package versions, notices, and the Linux cross-build script. The checksum manifest identifies the exact executables. [FFmpeg](https://ffmpeg.org/) · [x264](https://www.videolan.org/developers/x264.html)

Developer preparation without a built codec directory uses the Gyan FFmpeg 9.1 essentials edition (GPLv3), identified by FFmpeg-README.txt in the installed notices. [Upstream build and notices](https://github.com/GyanD/codexffmpeg/releases/tag/9.1)

The isolated 64-bit CPython interpreter retains its PSF license. NumPy, OpenCV headless, Pillow, and their bundled libraries retain their wheel notices and license texts in the runtime. The Python package lock includes every wheel's SHA-256. Video decoding, PCM mixing, and encoding use the supplied command-line codecs. The auxiliary OpenCV FFmpeg DLL is omitted. [CPython](https://www.python.org/downloads/release/python-31410/) · [NumPy](https://numpy.org/) · [OpenCV](https://opencv.org/) · [Pillow](https://python-pillow.org/)

FoleyMarks uses OpenCV optical flow for motion candidates. Pose analysis requires a separately configured MediaPipe installation and a local pose model. No user content is a build input.
