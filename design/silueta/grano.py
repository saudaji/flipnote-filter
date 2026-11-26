# Grano de la piel INTERFAZ: ruido fino y nítido, de píxel, parejo en toda la superficie (como el
# grano de una película tendido sobre la pantalla). No es el grano de la piel OBJETO (relieve de
# plástico) ni motas sueltas «de arena» ni manchas suaves.
# Es ruido de paso alto (sin grumos: a un ruido blanco se le resta su versión suavizada, envuelta
# para que no haya costura) pintado en dos tintas y SIN velo: cada píxel por debajo de la media es
# una mota de tinta oscura y cada píxel por encima una mota de marfil, con una opacidad proporcional
# a lo que se aparta. Así el negro sigue siendo negro y el crema sigue siendo crema (un velo parejo
# los agrisaba: subía el negro de la banda de 13 a 35 de luminancia) y el grano se ve igual de denso
# sobre los dos: sobre lo claro lo dibujan las motas oscuras; sobre lo oscuro, las claras.
# Se compone sin modos de fusión y se pinta sin interpolar (image-rendering: pixelated) a un número
# ENTERO de píxeles físicos por punto (silueta.js calcula el tamaño según la pantalla), para que no
# se doblen filas ni columnas. La interfaz lo pone ENCIMA de todo menos de la imagen.
#   python3 design/silueta/grano.py [salida=docs/brand/silueta/grano.webp] [lado=256] [oscuro=0.115] [claro=0.1] [tope=0.34]
import os
import random
import sys
from PIL import Image, ImageFilter

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'docs', 'brand', 'silueta', 'grano.webp')
side = int(sys.argv[2]) if len(sys.argv) > 2 else 256
k_dark = float(sys.argv[3]) if len(sys.argv) > 3 else 0.115
k_light = float(sys.argv[4]) if len(sys.argv) > 4 else 0.1
cap = float(sys.argv[5]) if len(sys.argv) > 5 else 0.34
DARK, LIGHT = (24, 26, 46), (255, 248, 236)
random.seed(27)

base = [max(0, min(255, int(128 + random.gauss(0, 36)))) for _ in range(side * side)]
tile = Image.new('L', (side, side))
tile.putdata(base)
field = Image.new('L', (side * 3, side * 3))
for ty in range(3):
    for tx in range(3):
        field.paste(tile, (tx * side, ty * side))
blur = list(field.filter(ImageFilter.GaussianBlur(0.85)).crop((side, side, side * 2, side * 2)).get_flattened_data())
high = [base[i] - blur[i] for i in range(side * side)]
mean = sum(high) / len(high)
std = (sum((v - mean) ** 2 for v in high) / len(high)) ** 0.5

pixels = []
for v in high:
    n = (v - mean) / std
    ink, k = (DARK, k_dark) if n < 0 else (LIGHT, k_light)
    alpha = round(min(cap, abs(n) * k) * 255 / 4) * 4          # pasos de 4: comprime mejor y no se nota
    pixels.append(ink + (alpha,))
image = Image.new('RGBA', (side, side))
image.putdata(pixels)
os.makedirs(os.path.dirname(out), exist_ok=True)
image.save(out, lossless=True, quality=100, method=6)
print('grano:', os.path.relpath(out), os.path.getsize(out), 'bytes')
