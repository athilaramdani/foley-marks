#!/usr/bin/env bash
# Build the exact Windows binaries distributed by a production release.
set -euo pipefail
dest=$(realpath -m "${1:?provide an output directory}")
here=$(cd "$(dirname "$0")" && pwd)
build=$(mktemp -d)
trap 'cd / && rm -rf -- "$build"' EXIT
mkdir -p "$dest" "$build/sources" "$build/x264" "$build/ffmpeg"
cd "$build"
ffrev=74e4393595cf2b5857f0da925c4e0dd74ea306e5
xrev=31e19f92f00c7003fa115047ce50978bc98c3a0d
fetch() {
    local name=$1 url=$2 hash=$3
    if [[ -n "${FOLEYMARKS_CODEC_CACHE:-}" && -f "$FOLEYMARKS_CODEC_CACHE/$name" ]]; then
        cp "$FOLEYMARKS_CODEC_CACHE/$name" "sources/$name"
    else
        curl --fail --location --retry 3 "$url" -o "sources/$name"
    fi
    echo "$hash  sources/$name" | sha256sum --check
}
fetch ffmpeg-src.tar.gz "https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/$ffrev" 4ae3618b0d38a14bb8f86a6b90de63c4b6b55d4de8e812a4900d07d2188b54de
fetch x264-src.tar.gz "https://codeload.github.com/mirror/x264/tar.gz/$xrev" d053c9d86988d6bc78237ca5205865c5ddf99c98ef4cd9927eec8f6d388f6dd9
tar -xf sources/ffmpeg-src.tar.gz -C ffmpeg --strip-components=1
tar -xf sources/x264-src.tar.gz -C x264 --strip-components=1
cp "$here/build-codecs.sh" sources/
cp ffmpeg/COPYING.GPLv2 sources/FFmpeg-GPLv2.txt
cp x264/COPYING sources/x264-COPYING.txt
target=x86_64-w64-mingw32
jobs=${FOLEYMARKS_BUILD_JOBS:-$(nproc)}
cd "$build/x264"
./configure --host="$target" --cross-prefix="$target-" --prefix="$build/prefix" --disable-cli --bit-depth=8 \
    --enable-static --disable-opencl --disable-avs --disable-ffms --disable-gpac --disable-lavf
make -j"$jobs"
make install-lib-static
cd "$build/ffmpeg"
export PKG_CONFIG_LIBDIR="$build/prefix/lib/pkgconfig"
# Local files and pipes only. No third-party codec libraries beyond x264.
# Restrict demuxers to supported local media containers to exclude playlist readers.
./configure --arch=x86_64 --target-os=mingw32 --cross-prefix="$target-" --enable-cross-compile \
    --pkg-config=pkg-config --pkg-config-flags=--static --disable-autodetect --disable-debug \
    --disable-doc --disable-network --disable-ffplay --disable-shared --enable-static \
    --enable-gpl --enable-libx264 --disable-protocols --enable-protocol=file,pipe \
    --disable-devices --enable-indev=lavfi --disable-demuxers \
    --enable-demuxer=mov,matroska,avi,asf,mpegps,mpegts,mp3,wav,flac,ogg,aac,aiff,flv,ac3,eac3,rawvideo,pcm_s16le,pcm_s32le,pcm_f32le,image2,image2pipe \
    --disable-muxers --enable-muxer=mp4,mov,matroska,webm,wav,adts,rawvideo,image2,image2pipe,pcm_s16le,pcm_s32le,pcm_f32le,null,ipod \
    --disable-decoders --enable-decoder=h264,hevc,av1,vp8,vp9,mpeg1video,mpeg2video,mpeg4,msmpeg4v2,msmpeg4v3,wmv1,wmv2,wmv3,vc1,prores,dnxhd,mjpeg,h263,flv,png,gif,bmp,rawvideo,aac,aac_latm,mp3,mp3float,mp2,flac,vorbis,opus,ac3,eac3,alac,wmav1,wmav2,wmapro,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_u8 \
    --disable-encoders --enable-encoder=libx264,aac,rawvideo,pcm_s16le,pcm_s32le,pcm_f32le \
    --extra-ldflags="-static -L$build/prefix/lib" --extra-cflags="-I$build/prefix/include"
make -j"$jobs" ffmpeg.exe ffprobe.exe
for tool in ffmpeg ffprobe; do
    "$target-strip" "$tool.exe"
    cp "$tool.exe" "$dest/$tool.exe"
done
cd "$build"
dpkg-query -W gcc-mingw-w64-x86-64-posix mingw-w64-x86-64-dev binutils-mingw-w64-x86-64 nasm make pkg-config > sources/toolchain.txt
# Windows thread support is part of mingw-w64; retain the notices, distribution
# source revisions, compiler and link flags with the precise source tarballs.
cp ffmpeg/ffbuild/config.log sources/ffmpeg-config.log
cp x264/config.log sources/x264-config.log
cp /usr/share/doc/mingw-w64-x86-64-dev/copyright sources/mingw-copyright.txt
(cd sources && zip -q -0 "$dest/media-sources.zip" *)
cp sources/{FFmpeg-GPLv2.txt,x264-COPYING.txt,mingw-copyright.txt,toolchain.txt} "$dest"
(cd "$dest" && sha256sum ffmpeg.exe ffprobe.exe media-sources.zip > SHA256SUMS)
