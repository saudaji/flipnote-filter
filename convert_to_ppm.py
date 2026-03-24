#!/usr/bin/env python3
"""
Convert video to Flipnote Studio DSi PPM format.

Usage: python3 convert_to_ppm.py <video> [fps] [output.ppm]

PPM format spec: https://github.com/Flipnote-Collective/flipnote-studio-docs/wiki/PPM-format
"""

import subprocess, struct, os, sys, time, json
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'Pillow', 'numpy', '-q'])
    from PIL import Image
    import numpy as np

# Resolve ffmpeg binary: prefer system, fall back to imageio-ffmpeg bundle
def _find_ffmpeg():
    import shutil
    if shutil.which('ffmpeg'):
        return 'ffmpeg', 'ffprobe'
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        fp = ff.replace('ffmpeg', 'ffprobe')
        import os
        if not os.path.exists(fp):
            fp = ff  # some bundles only ship ffmpeg; ffprobe may not exist
        return ff, fp
    except ImportError:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'imageio-ffmpeg', '-q'])
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        return ff, ff

FFMPEG, FFPROBE = _find_ffmpeg()

# ── Constants ─────────────────────────────────────────────────────────────────
WIDTH, HEIGHT = 256, 192
THUMB_W, THUMB_H = 64, 48
MAX_FRAMES = 999
MAX_ANIM_BYTES = 736_800   # DSi hard limit for animation section

# Speed byte ↔ fps (Flipnote Studio DSi)
# Source: Flipnote-Collective/flipnote-studio-docs
SPEED_FPS = {1: 0.5, 2: 1.0, 3: 2.0, 4: 4.0, 5: 6.0, 6: 8.0, 7: 12.0, 8: 20.0}
FPS_SPEED = {v: k for k, v in SPEED_FPS.items()}

def best_speed(target_fps):
    """Return (actual_fps, speed_byte) closest to target_fps."""
    best = min(FPS_SPEED, key=lambda f: abs(f - target_fps))
    return best, FPS_SPEED[best]

# ── ffmpeg helpers ─────────────────────────────────────────────────────────────
def get_duration(path):
    """Get video duration by parsing ffmpeg stderr."""
    import re
    r = subprocess.run([FFMPEG, '-i', path], capture_output=True, text=True)
    m = re.search(r'Duration:\s*(\d+):(\d+):([\d.]+)', r.stderr)
    if not m:
        raise ValueError(f"Could not read duration from {path}")
    h, mn, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mn * 60 + s

def extract_frames(video, fps, out_dir):
    """Extract grayscale frames, letterboxed to 256×192."""
    os.makedirs(out_dir, exist_ok=True)
    vf = (
        f"fps={fps},"
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,"
        "setsar=1"
    )
    subprocess.run([
        FFMPEG, '-i', video, '-vf', vf,
        '-pix_fmt', 'gray', '-y',
        os.path.join(out_dir, 'frame_%04d.png')
    ], check=True)
    return sorted(Path(out_dir).glob('frame_*.png'))

# ── Image processing ───────────────────────────────────────────────────────────
def dither_frame(path):
    """Load PNG, apply Floyd-Steinberg dithering → bool[H,W] (True = black ink)."""
    img = Image.open(path).convert('L')
    # PIL's built-in Floyd-Steinberg dithering
    img_1bit = img.convert('1', dither=Image.FLOYDSTEINBERG)
    arr = np.array(img_1bit)
    # PIL mode '1': True = white, False = black → invert for ink (True = black)
    return ~arr

def make_thumbnail(px):
    """
    Create 64×48 thumbnail, 4bpp, 8×8 tiles.
    Palette: index 0 = white, index 1 = dark (black).
    px: bool[H,W], True = black ink
    """
    img = Image.fromarray((~px * 255).astype(np.uint8))   # white=255, black=0
    img = img.resize((THUMB_W, THUMB_H), Image.LANCZOS)
    pal = (np.array(img) < 128).astype(np.uint8)           # 0=white, 1=black

    out = bytearray(THUMB_W * THUMB_H // 2)                # 1536 bytes
    i = 0
    for ty in range(THUMB_H // 8):   # 6 vertical tile rows
        for tx in range(THUMB_W // 8):  # 8 horizontal tile cols
            for py in range(8):
                for px2 in range(0, 8, 2):
                    lo = int(pal[ty*8+py, tx*8+px2])
                    hi = int(pal[ty*8+py, tx*8+px2+1])
                    out[i] = lo | (hi << 4)
                    i += 1
    return bytes(out)

# ── PPM frame encoding ─────────────────────────────────────────────────────────
def encode_layer(px):
    """
    Encode one 256×192 layer.
    px: bool[H,W], True = ink.
    Line types: 0 = skip (blank), 3 = raw 32 bytes.
    Returns (flags: bytes[48], pixel_data: bytes).
    """
    flags = bytearray(48)
    data  = bytearray()

    for row in range(HEIGHT):
        row_px = px[row]
        if not np.any(row_px):
            lt = 0   # skip — line is all-white (paper)
        else:
            lt = 3   # raw — store 32 bytes uncompressed
            for col in range(0, WIDTH, 8):
                b = 0
                for k, ink in enumerate(row_px[col:col+8]):
                    if ink:
                        b |= 0x80 >> k
                data.append(b)
        # Pack 2-bit line type into flags byte: 4 lines per byte, LSB first
        flags[row >> 2] |= lt << ((row & 3) * 2)

    return bytes(flags), bytes(data)

def encode_frame(px):
    """
    Encode a complete PPM frame.
    Frame header byte 0x0C:
      bits[1:0] = 0  → paper = white
      bits[3:2] = 3  → layer 1 color = inverted paper (black)
      bits[5:4] = 0  → layer 2 color = none (invisible)
      bit  6    = 0  → no differential encoding
    """
    l1_flags, l1_data = encode_layer(px)
    l2_flags, l2_data = encode_layer(np.zeros((HEIGHT, WIDTH), dtype=bool))
    return bytes([0x0C]) + l1_flags + l2_flags + l1_data + l2_data

# ── PPM file assembly ──────────────────────────────────────────────────────────
def build_ppm(all_px, fps):
    n = len(all_px)
    actual_fps, spd = best_speed(fps)

    print(f"  Encoding {n} frames @ {actual_fps} fps (speed byte={spd})…")
    enc = []
    for i, px in enumerate(all_px):
        enc.append(encode_frame(px))
        if (i + 1) % 50 == 0:
            print(f"    {i+1}/{n}")

    # Frame offset table — offsets relative to start of frame data (after table)
    offsets, off = [], 0
    for f in enc:
        offsets.append(off)
        off += len(f)
    ftable = struct.pack(f'<{n}I', *offsets)
    fdata  = b''.join(enc)

    # Animation section (starts at file offset 0x06A0):
    #   8-byte header | frame offset table | frame data
    anim_hdr       = bytes(8)   # all zeros: no loop, default flags
    anim_data_size = len(anim_hdr) + len(ftable) + len(fdata)

    if anim_data_size > MAX_ANIM_BYTES:
        print(f"  ⚠  Animation data = {anim_data_size:,} bytes exceeds DSi limit "
              f"({MAX_ANIM_BYTES:,}). File may not load on hardware.")

    # Sound section — no audio, just the 18-byte size header
    # Format: BGM(u32) SE1(u32) SE2(u32) SE3(u32) frame_speed(u8) bgm_speed(u8)
    snd = struct.pack('<IIIIBB', 0, 0, 0, 0, spd, spd)

    # ── Fixed-size header block (0x0000–0x06A7 = 1704 bytes) ──────────────────
    buf = bytearray(0x06A8)

    # 0x0000 – Main header (16 bytes)
    # Frame count stored as (actual - 1) per PPM spec
    struct.pack_into('<4sIIHH', buf, 0x00,
                    b'PARA',
                    anim_data_size,
                    len(snd),
                    n - 1,          # stored as actual_count - 1
                    0x0024)         # version

    # 0x0010 – Metadata (144 bytes, 0x10–0x9F)
    struct.pack_into('<HH', buf, 0x10, 0, 0)   # lock=0, thumb_frame=0
    name = "VideoConvert"[:11].encode('utf-16-le')   # max 22 bytes (11 chars)
    buf[0x14:0x14+len(name)] = name   # root author name
    buf[0x2A:0x2A+len(name)] = name   # parent author name
    buf[0x40:0x40+len(name)] = name   # current author name
    ts = max(0, int(time.time()) - 946_684_800)   # seconds since 2000-01-01
    struct.pack_into('<I', buf, 0x94, ts)

    # 0x00A0 – Thumbnail (1536 bytes, 0x00A0–0x069F)
    buf[0x00A0:0x06A0] = make_thumbnail(all_px[0])

    # 0x06A0 – Animation section header (8 bytes) — already zeroed

    # ── Assemble final file ───────────────────────────────────────────────────
    return (bytes(buf)    # 0x0000 – 0x06A7  (fixed header)
            + ftable      # 0x06A8 – …       (frame offset table)
            + fdata       #                  (frame data)
            + snd         #                  (sound section)
            + b'\x00' * 160)   # RSA-1024 signature placeholder (160 bytes)

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print("Usage: python3 convert_to_ppm.py <video> [fps=8] [output.ppm]")
        sys.exit(1)

    video      = sys.argv[1]
    target_fps = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0
    out_name   = sys.argv[3] if len(sys.argv) > 3 else Path(video).stem + '.ppm'
    frames_dir = 'frames_tmp'

    # Auto-reduce fps if video is too long for MAX_FRAMES
    print(f"Probing {video}…")
    duration = get_duration(video)
    print(f"  Duration: {duration:.1f}s")

    if duration * target_fps > MAX_FRAMES:
        target_fps = MAX_FRAMES / duration
        actual_fps, _ = best_speed(target_fps)
        print(f"  Adjusting fps to {actual_fps} to stay within {MAX_FRAMES}-frame limit")
        target_fps = actual_fps

    actual_fps, _ = best_speed(target_fps)
    max_frames = min(MAX_FRAMES, int(duration * actual_fps) + 1)
    print(f"  Will extract up to {max_frames} frames @ {actual_fps} fps")

    print(f"\nStep 1/3 – Extracting frames…")
    frame_paths = extract_frames(video, actual_fps, frames_dir)
    if len(frame_paths) > MAX_FRAMES:
        frame_paths = frame_paths[:MAX_FRAMES]
        print(f"  Truncated to {MAX_FRAMES} frames")
    print(f"  Got {len(frame_paths)} frames")

    print(f"\nStep 2/3 – Dithering (Floyd-Steinberg)…")
    all_px = []
    for i, fp in enumerate(frame_paths):
        all_px.append(dither_frame(fp))
        if (i + 1) % 50 == 0:
            print(f"  {i+1}/{len(frame_paths)}")

    print(f"\nStep 3/3 – Building PPM…")
    ppm = build_ppm(all_px, actual_fps)

    with open(out_name, 'wb') as f:
        f.write(ppm)

    import shutil
    shutil.rmtree(frames_dir, ignore_errors=True)

    print(f"\n✓ Done!  →  {out_name}")
    print(f"   Frames : {len(all_px)}")
    print(f"   Size   : {len(ppm):,} bytes ({len(ppm)/1024:.1f} KB)")
    print(f"   FPS    : {actual_fps}")

if __name__ == '__main__':
    main()
