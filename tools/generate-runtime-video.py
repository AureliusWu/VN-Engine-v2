"""Rebuild the silent solid-colour WebM fixture used by runtime tests (requires ffmpeg/libvpx)."""
from pathlib import Path
import subprocess

target = Path(__file__).resolve().parents[1] / 'examples/runtime/assets/test-video.webm'
subprocess.run([
    'ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=c=0x315c51:s=160x90:r=10:d=2', '-an', '-c:v', 'libvpx',
    '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '80k',
    '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1',
    '-y', str(target),
], check=True)
