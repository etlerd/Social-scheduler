#!/usr/bin/env bash
# Generates test media with ffmpeg.
set -euo pipefail
cd "$(dirname "$0")" && mkdir -p fixtures && cd fixtures
ffmpeg -loglevel error -y -f lavfi -i "testsrc2=size=1080x1920:rate=30" -t 6 -c:v libx264 -pix_fmt yuv420p vertical.mp4
ffmpeg -loglevel error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30" -t 5 -c:v libx264 -pix_fmt yuv420p landscape.mp4
ffmpeg -loglevel error -y -f lavfi -i "gradients=size=1080x1080:c0=0xff5f6d:c1=0x5f2cff" -frames:v 1 square.png
ffmpeg -loglevel error -y -f lavfi -i "gradients=size=1080x1350:c0=0x00c9ff:c1=0x92fe9d" -frames:v 1 portrait.jpg
ffmpeg -loglevel error -y -f lavfi -i "testsrc2=size=4032x3024,noise=alls=40:allf=t" -frames:v 1 -q:v 2 photo-large.jpg
