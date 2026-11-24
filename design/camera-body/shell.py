# Parte la carcasa renderizada (build.py shell) en las piezas que usa la interfaz:
#   shell-top     la tapa de arriba, con las esquinas redondeadas
#   shell-bottom  la de abajo, con la rejilla, los tornillos y la serigrafía
#   shell-mid     una tira del centro, que se estira en vertical entre las dos
#   shell-foot    el pie liso (del render sin detalles) para lanzador y visor
# Las tapas se desvanecen hacia el centro para casar con la tira sin costura. Así la carcasa vale
# para cualquier alto de pantalla sin deformar nada.
#   python3 design/camera-body/shell.py <shell.png> <shell-liso.png> <docs/body> [escala=4] [sufijo]
# Necesita Pillow y cwebp.
import os
import subprocess
import sys
import tempfile
from PIL import Image

src, plain, out = sys.argv[1], sys.argv[2], sys.argv[3]
scale = int(sys.argv[4]) if len(sys.argv) > 4 else 4
suffix = sys.argv[5] if len(sys.argv) > 5 else ''          # p. ej. -oscuro
TOP, BOTTOM, FOOT, FADE, MID = 56, 110, 40, 24, 8        # en píxeles CSS del diseño (406 de ancho)


def fade(piece, towards_bottom):
    """Desvanece FADE px del lado que mira al centro."""
    px = piece.load()
    n = FADE * scale
    for i in range(n):
        y = piece.size[1] - 1 - i if towards_bottom else i
        k = (i + 0.5) / n
        k = k * k * (3 - 2 * k)
        for x in range(piece.size[0]):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, int(round(a * k)))
    return piece


def save(piece, name):
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
        piece.save(tmp.name)
    subprocess.run(['cwebp', '-quiet', '-q', '92', '-alpha_q', '100', '-m', '6', tmp.name, '-o', os.path.join(out, name + suffix + '.webp')], check=True)
    os.unlink(tmp.name)


im = Image.open(src).convert('RGBA')
w, h = im.size
save(fade(im.crop((0, 0, w, TOP * scale)), True), 'shell-top')
save(fade(im.crop((0, h - BOTTOM * scale, w, h)), False), 'shell-bottom')
save(im.crop((0, h // 2 - MID * scale // 2, w, h // 2 + MID * scale // 2)), 'shell-mid')
flat = Image.open(plain).convert('RGBA')
save(fade(flat.crop((0, flat.size[1] - FOOT * scale, w, flat.size[1])), False), 'shell-foot')
print('carcasa en piezas', w, h)
