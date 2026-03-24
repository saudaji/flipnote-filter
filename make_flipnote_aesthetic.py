#!/usr/bin/env python3
"""
Convierte video a estética Flipnote Studio DSi:
  - B&W 1-bit con dithering Floyd-Steinberg
  - Resolución DSi 256x192 → escalada a 1080p con nearest-neighbor
  - Scanlines visibles
  - MP4 listo para Instagram (1080x1350, H.264 AAC)

Uso: python3 make_flipnote_aesthetic.py <video> [fps] [salida.mp4]
"""

import subprocess, struct, os, sys, shutil, json
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'Pillow', 'numpy', '-q'])
    from PIL import Image
    import numpy as np

# ── ffmpeg ─────────────────────────────────────────────────────────────────────
def find_ffmpeg():
    import shutil as sh
    if sh.which('ffmpeg'):
        return 'ffmpeg'
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'imageio-ffmpeg', '-q'])
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()

FFMPEG = find_ffmpeg()

# ── Parámetros ─────────────────────────────────────────────────────────────────
DSI_W,  DSI_H  = 256, 192       # resolución DSi
SCALE          = 4              # factor entero de upscale  →  1024×768
UP_W,   UP_H   = DSI_W * SCALE, DSI_H * SCALE   # 1024×768
OUT_W,  OUT_H  = 1080, 1350     # Instagram 4:5 portrait

PAD_X = (OUT_W - UP_W) // 2    # 28 px cada lado
PAD_Y = (OUT_H - UP_H) // 2    # 291 px arriba/abajo

# Intensidad scanlines: 0.0 = negro puro, 1.0 = sin efecto
SCANLINE_INTENSITY = 0.35       # los "surcos" quedan al 35% de brillo

# Paleta Game Boy DMG original
INK_COLOR   = np.array([ 15,  56,  15], dtype=np.float32)  # #0F380F verde oscuro (tinta)
PAPER_COLOR = np.array([155, 188,  15], dtype=np.float32)  # #9BBC0F verde claro  (papel)
BG_COLOR    = np.array([155, 188,  15], dtype=np.uint8)    # igual que PAPER_COLOR (canvas)

# ── Extracción de frames ────────────────────────────────────────────────────────
def get_duration(path):
    import re
    r = subprocess.run([FFMPEG, '-i', path], capture_output=True, text=True)
    m = re.search(r'Duration:\s*(\d+):(\d+):([\d.]+)', r.stderr)
    if not m:
        raise ValueError("No se pudo leer la duración del video.")
    h, mn, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mn * 60 + s

def extract_frames(video, fps, out_dir):
    """
    Extrae frames en escala de grises a 256x192, respetando la rotación del iPhone.
    Usa letterbox para mantener la relación de aspecto.
    """
    os.makedirs(out_dir, exist_ok=True)
    vf = (
        f"fps={fps},"
        f"scale={DSI_W}:{DSI_H}:force_original_aspect_ratio=decrease,"
        f"pad={DSI_W}:{DSI_H}:(ow-iw)/2:(oh-ih)/2,"
        "setsar=1"
    )
    subprocess.run([
        FFMPEG, '-i', video, '-vf', vf,
        '-pix_fmt', 'gray', '-y',
        os.path.join(out_dir, 'frame_%05d.png')
    ], check=True)
    return sorted(Path(out_dir).glob('frame_*.png'))

# ── Procesado de frame ──────────────────────────────────────────────────────────
def build_scanline_mask(h, w):
    """
    Pre-calcula una máscara de scanlines (float32, shape HxW).
    Cada inicio de bloque de SCALE filas se oscurece.
    Adicionalmente, oscurece levemente cada fila impar (efecto CRT suave).
    """
    mask = np.ones((h, w), dtype=np.float32)

    # Efecto CRT suave: fila impar → 80% de brillo
    mask[1::2] = 0.80

    # Borde de cada "pixel DSi" → oscurecido fuerte (scanline principal)
    for y in range(0, h, SCALE):
        mask[y] = SCANLINE_INTENSITY

    return mask

# Generamos la máscara una sola vez (es la misma para todos los frames)
_SCANLINE_MASK = build_scanline_mask(UP_H, UP_W)          # shape (768, 1024)
_SCANLINE_MASK_3 = np.stack([_SCANLINE_MASK] * 3, axis=-1) # shape (768, 1024, 3)

def process_frame(path):
    """
    Carga un frame en gris 256x192, aplica dithering Floyd-Steinberg,
    escala 4x con nearest-neighbor, añade scanlines y coloca en canvas 1080x1350.
    Devuelve PIL Image RGB lista para guardar.
    """
    # 1. Cargar y dithering → 1-bit
    img_gray  = Image.open(path).convert('L')
    img_1bit  = img_gray.convert('1', dither=Image.FLOYDSTEINBERG)

    # 2. Upscale 4x con nearest-neighbor (pixelado limpio)
    img_up    = img_1bit.resize((UP_W, UP_H), Image.NEAREST)

    # 3. Mapear 1-bit → paleta Game Boy  (True = papel, False = tinta)
    mask = np.array(img_up, dtype=bool)                              # True = blanco
    arr  = np.where(mask[:, :, None], PAPER_COLOR, INK_COLOR)        # float32 RGB

    # 4. Aplicar máscara de scanlines
    arr *= _SCANLINE_MASK_3
    arr  = arr.clip(0, 255).astype(np.uint8)

    # 5. Pegar en canvas con color de fondo (Game Boy verde claro)
    canvas = np.full((OUT_H, OUT_W, 3), BG_COLOR, dtype=np.uint8)
    canvas[PAD_Y : PAD_Y + UP_H, PAD_X : PAD_X + UP_W] = arr

    return Image.fromarray(canvas)

# ── Ensamblado ─────────────────────────────────────────────────────────────────
def encode_video(frames_dir, audio_source, output, fps):
    """
    Ensambla los frames procesados con el audio original.
    Configuración optimizada para Instagram: H.264, AAC 128k, faststart.
    """
    # Instagram recomienda: H.264 high profile, yuv420p, 30fps máx
    # Usamos -r dos veces: una para entrada (frames) y otra para salida
    subprocess.run([
        FFMPEG,
        '-framerate', str(fps),
        '-i', os.path.join(frames_dir, 'out_%05d.png'),
        '-i', audio_source,
        '-map', '0:v',
        '-map', '1:a',
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-level', '4.0',
        '-crf', '16',            # calidad alta (menor = mejor)
        '-preset', 'slow',
        '-r', str(fps),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',             # recorta al más corto (video o audio)
        '-movflags', '+faststart',  # streaming web / Instagram
        '-y', output
    ], check=True)

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    video  = sys.argv[1] if len(sys.argv) > 1 else 'IMG_9931.MOV'
    fps    = float(sys.argv[2]) if len(sys.argv) > 2 else 12.0
    output = sys.argv[3] if len(sys.argv) > 3 else Path(video).stem + '_instagram.mp4'

    raw_dir = '_flipnote_raw'
    out_dir = '_flipnote_out'
    os.makedirs(out_dir, exist_ok=True)

    print(f"Video : {video}")
    print(f"FPS   : {fps}  (estética Flipnote)")
    print(f"Output: {output}  ({OUT_W}×{OUT_H}, Instagram 4:5)")
    print(f"Escala: {SCALE}x  →  {DSI_W}×{DSI_H}  →  {UP_W}×{UP_H}")
    print()

    # ── Paso 1: Extraer frames ────────────────────────────────────────────────
    print("[ 1 / 3 ]  Extrayendo frames…")
    duration = get_duration(video)
    frame_paths = extract_frames(video, fps, raw_dir)
    n = len(frame_paths)
    print(f"  → {n} frames  ({duration:.1f}s  @  {fps}fps)\n")

    # ── Paso 2: Procesar cada frame ───────────────────────────────────────────
    print("[ 2 / 3 ]  Dithering  +  scanlines…")
    for i, fp in enumerate(frame_paths):
        img = process_frame(fp)
        img.save(os.path.join(out_dir, f'out_{i+1:05d}.png'))
        if (i + 1) % 30 == 0 or (i + 1) == n:
            pct = (i + 1) / n * 100
            print(f"  {i+1:>4}/{n}  ({pct:.0f}%)")
    print()

    # ── Paso 3: Ensamblar MP4 ─────────────────────────────────────────────────
    print("[ 3 / 3 ]  Codificando MP4…")
    encode_video(out_dir, video, output, fps)

    # Limpiar temporales
    shutil.rmtree(raw_dir, ignore_errors=True)
    shutil.rmtree(out_dir, ignore_errors=True)

    size_mb = os.path.getsize(output) / 1024 / 1024
    print(f"\n✓  Listo  →  {output}")
    print(f"   Tamaño : {size_mb:.1f} MB")
    print(f"   Frames : {n}  @  {fps}fps")
    print(f"   Canvas : {OUT_W}×{OUT_H}  (Instagram 4:5)")

if __name__ == '__main__':
    main()
