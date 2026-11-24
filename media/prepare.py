"""Prepare pinned, offline Windows runtime and Tauri sidecars using a build-host Python."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.request import Request, urlopen
from zipfile import ZipFile

SOURCE = Path(__file__).resolve().parent
TAURI = SOURCE.parent / "src-tauri"
CACHE = Path(tempfile.gettempdir()) / "foleymarks-media-build"
RUNTIME = TAURI / "resources/media-runtime"
LICENSES = TAURI / "resources/media-licenses"
TOOLS = TAURI / "binaries"
TARGET = "x86_64-pc-windows-msvc"
PYTHON_URL = "https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip"
PYTHON_HASH = "90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159"
FF_URL = "https://github.com/GyanD/codexffmpeg/releases/download/9.1/ffmpeg-9.1-essentials_build.zip"
FF_HASH = "b9bbbb3acece000cbeec994f856649354e52c773807841e78908374b24d658fd"


def checksum(path):
    with path.open("rb") as source:
        h = hashlib.sha256()
        for block in iter(lambda: source.read(1048576), b""):
            h.update(block)
        return h.hexdigest()


def fetch(name, url, digest):
    path = CACHE / name
    if path.exists() and checksum(path) == digest:
        return path
    with tempfile.NamedTemporaryFile(dir=CACHE, delete=False) as temp:
        with urlopen(Request(url, headers={"User-Agent": "FoleyMarks build/1"}), timeout=120) as response:
            shutil.copyfileobj(response, temp)
    if checksum(Path(temp.name)) != digest:
        raise ValueError("Unexpected hash for " + name)
    os.replace(temp.name, path)
    return path


def install_wheels():
    wheels = CACHE / "wheels"
    wheels.mkdir(exist_ok=True)
    # Pip resolves against the embedded interpreter's ABI, independently of the host.
    subprocess.run([sys.executable, "-m", "pip", "download", "--disable-pip-version-check", "--no-deps",
                    "--require-hashes", "--only-binary=:all:", "--platform", "win_amd64",
                    "--python-version", "3.14", "--implementation", "cp", "--abi", "cp314",
                    "-r", str(SOURCE / "requirements-win64.lock"), "-d", str(wheels)], check=True)
    allowed = {line.split("sha256:")[1].strip() for line in
               (SOURCE / "requirements-win64.lock").read_text(encoding="utf-8-sig").splitlines() if "sha256:" in line}
    # This directory is generated solely by this script under the staging root.
    packages = RUNTIME / "packages"
    if packages.exists():
        if packages.is_symlink() or packages.resolve() != (TAURI.resolve() / "resources/media-runtime/packages"):
            raise ValueError("Unexpected runtime staging directory")
        shutil.rmtree(packages)
    found = set()
    for wheel in wheels.glob("*.whl"):
        digest = checksum(wheel)
        if digest not in allowed:
            continue
        found.add(digest)
        with ZipFile(wheel) as archive:
            for member in archive.infolist():
                if Path(member.filename).name.startswith("opencv_videoio_ffmpeg") and member.filename.endswith(".dll"):
                    continue
                if ".data/scripts/" in member.filename or member.is_dir():
                    continue
                archive.extract(member, RUNTIME / "packages")
                if ".dist-info/" in member.filename and any(
                    token in member.filename.split(".dist-info/", 1)[1].lower()
                    for token in ("license", "copying", "notice")):
                    archive.extract(member, LICENSES / "wheels")
    if found != allowed:
        raise RuntimeError("One or more pinned wheels are missing")


def main():
    if sys.platform != "win32":
        raise SystemExit("Run the media preparation on Windows x64")
    for path in [CACHE, RUNTIME, LICENSES, TOOLS]:
        path.mkdir(parents=True, exist_ok=True)
    with ZipFile(fetch("python.zip", PYTHON_URL, PYTHON_HASH)) as archive:
        archive.extractall(RUNTIME)
    shutil.copy2(RUNTIME / "LICENSE.txt", LICENSES / "CPython.txt")
    (RUNTIME / "python314._pth").write_text("python314.zip\n.\npackages\n", encoding="ascii")
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--codec-dir', type=Path)
    codecs = parser.parse_args().codec_dir
    if codecs:
        expected_files = {'ffmpeg.exe', 'ffprobe.exe', 'media-sources.zip'}
        sums = dict(line.strip().split(None, 1)[::-1] for line in (codecs / 'SHA256SUMS').read_text().splitlines())
        if set(sums) != expected_files or any(checksum(codecs / f) != sums[f] for f in expected_files):
            raise ValueError('Invalid production codec artifacts')
        for name in ('ffmpeg', 'ffprobe'):
            shutil.copy2(codecs / (name + '.exe'), TOOLS / f'{name}-{TARGET}.exe')
        for name in ('FFmpeg-GPLv2.txt','x264-COPYING.txt','mingw-copyright.txt','toolchain.txt','SHA256SUMS'):
            shutil.copy2(codecs / name, LICENSES / name)
        for name in ('FFmpeg-LICENSE', 'FFmpeg-README.txt'):
            (LICENSES / name).unlink(missing_ok=True)
    else:
        with ZipFile(fetch("ffmpeg.zip", FF_URL, FF_HASH)) as archive:
            for name in ("ffmpeg", "ffprobe"):
                member = next(s for s in archive.namelist() if s.endswith("/bin/" + name + ".exe"))
                with archive.open(member) as src, (TOOLS / f"{name}-{TARGET}.exe").open("wb") as dst:
                    shutil.copyfileobj(src, dst)
            for name in ("LICENSE", "README.txt"):
                member = next(s for s in archive.namelist() if s.endswith("/" + name))
                (LICENSES / ("FFmpeg-" + name)).write_bytes(archive.read(member))
    install_wheels()
    # Remove superseded OpenCV video plugins from previously prepared dev trees.
    for dll in (RUNTIME / "packages/cv2").glob("opencv_videoio_ffmpeg*.dll"):
        dll.unlink()
    for name in ("config", "models", "services", "utils"):
        shutil.copytree(SOURCE / name, RUNTIME / name, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copy2(SOURCE / "worker.py", RUNTIME / "worker.py")
    shutil.copy2(SOURCE / "THIRD-PARTY.md", LICENSES / "THIRD-PARTY.md")
    print("Embedded media runtime and codecs prepared", flush=True)


if __name__ == "__main__":
    main()
