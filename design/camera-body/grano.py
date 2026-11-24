# El grano mate: dos teselas de ruido fino, la mitad motas oscuras y la mitad claras, que la interfaz
# tiende encima de cada superficie (nunca del visor) para que el plástico, las teclas y el logo
# tengan la textura de algo impreso o aerografiado y no de un color plano de pantalla.
#   python3 design/camera-body/grano.py [salida=docs/body/grano.webp] [lado=256] [fuerza=1.0]
# Cada mota es blanca o negra y lo que varía es su opacidad: así pesa poco y se compone sin modos
# de fusión (que obligarían a recomponer la pantalla entera en cada cuadro de la cámara).
import os
import random
import sys
from PIL import Image, ImageFilter

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'docs', 'body', 'grano.webp')
side = int(sys.argv[2]) if len(sys.argv) > 2 else 256
gain = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
random.seed(27)
# Ruido gaussiano, apenas suavizado para que las motas tengan cuerpo (no un píxel suelto), y
# envuelto en los bordes para que la tesela no tenga costura.
field = Image.new('L', (side * 3, side * 3))
base = [min(255, max(0, int(random.gauss(128, 46)))) for _ in range(side * side)]
tile = Image.new('L', (side, side)); tile.putdata(base)
for ty in range(3):
    for tx in range(3):
        field.paste(tile, (tx * side, ty * side))
soft = field.filter(ImageFilter.GaussianBlur(0.55)).crop((side, side, side * 2, side * 2))
values = list(soft.getdata())
mean = sum(values) / len(values)
spread = (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5
def write(path, signed, dark, light):
    """signed: una mota por píxel, en desviaciones típicas (negativa oscurece, positiva aclara)."""
    pixels = []
    for n in signed:
        if n < 0:
            pixels.append(dark[:3] + (round(min(1.0, -n * dark[3] * gain) * 255 / 8) * 8,))
        else:
            pixels.append(light[:3] + (round(min(1.0, n * light[3] * gain) * 255 / 8) * 8,))
    image = Image.new('RGBA', (side, side)); image.putdata(pixels)
    image.save(path, lossless=True, quality=100, method=6) if path.endswith('.webp') else image.save(path)
    print('grano:', os.path.relpath(path), os.path.getsize(path), 'bytes')


signed = [(v - mean) / spread for v in values]
# 1 · Grano de película: para lo impreso y lo que se ve en un cristal (el logo, la página).
write(out, signed, (18, 14, 26, 0.115), (255, 248, 236, 0.095))
# 2 · Grano con relieve: para el plástico. Es el mismo ruido visto como una superficie rugosa con
#     la luz arriba a la izquierda: cada mota tiene su lado claro y su lado en sombra, y por eso
#     se lee como textura que se puede tocar y no como ruido de pantalla.
at = lambda x, y: signed[(y % side) * side + (x % side)]
relief = [at(x, y) - at(x + 1, y + 1) for y in range(side) for x in range(side)]
scale = (sum(v * v for v in relief) / len(relief)) ** 0.5
write(out.replace('grano.', 'grano-relieve.'), [v / scale for v in relief], (58, 46, 28, 0.105), (255, 252, 244, 0.125))
