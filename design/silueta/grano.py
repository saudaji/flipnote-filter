# Grano de la piel INTERFAZ: ruido FINO, de película, parejo. Cada punto de la tesela es un punto físico
# de la pantalla (silueta.js pinta la tesela de 256 a 256 / densidad px CSS, y silueta.css la pinta sin
# interpolar): a 3× de densidad el cristal mide un tercio de px CSS. Sin grumos (no lleva ningún
# suavizado: cada punto es independiente) y sin «arena de píxel gordo» (nunca dos puntos físicos por
# punto de la tesela). No es el grano de la piel OBJETO (relieve de plástico).
# Monocromo, pintado en dos tintas y SIN velo: cada punto por debajo de la media es una mota de tinta
# oscura y cada punto por encima una mota de marfil, con una opacidad proporcional a lo que se aparta.
# Así el negro sigue siendo negro y el crema sigue siendo crema (un velo parejo los agrisaba) y el grano
# se ve sobre los dos. La tesela va con la amplitud MARCADA; silueta.css la baja con la opacidad de la
# capa (--si-grano-op: suave .55, medio .75, marcado 1) y con tope, para que no queden motas sueltas
# sobre la letra. Se compone sin modos de fusión, encima de todo menos de la imagen, y no se mueve nunca.
# El canto horneado de las formas (silueta.js) usa este mismo ruido: borde y superficie, un material.
#   python3 design/silueta/grano.py [salida=docs/brand/silueta/grano.webp] [lado=256] [oscuro=0.105] [claro=0.125] [tope=0.34]
import os
import random
import sys
from PIL import Image

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'docs', 'brand', 'silueta', 'grano.webp')
side = int(sys.argv[2]) if len(sys.argv) > 2 else 256
k_dark = float(sys.argv[3]) if len(sys.argv) > 3 else 0.105
k_light = float(sys.argv[4]) if len(sys.argv) > 4 else 0.125
cap = float(sys.argv[5]) if len(sys.argv) > 5 else 0.34
DARK, LIGHT = (24, 26, 48), (255, 247, 234)
random.seed(27)

# Ruido blanco gaussiano: cada punto, independiente de sus vecinos (una tesela de ruido blanco se repite
# sin costura por sí sola: no hay nada que envolver).
noise = [random.gauss(0, 1) for _ in range(side * side)]
mean = sum(noise) / len(noise)
std = (sum((v - mean) ** 2 for v in noise) / len(noise)) ** 0.5

pixels = []
for v in noise:
    n = (v - mean) / std
    ink, k = (DARK, k_dark) if n < 0 else (LIGHT, k_light)
    alpha = round(min(cap, abs(n) * k) * 255)
    pixels.append(ink + (alpha,))
image = Image.new('RGBA', (side, side))
image.putdata(pixels)
os.makedirs(os.path.dirname(out), exist_ok=True)
image.save(out, lossless=True, quality=100, method=6)
print('grano:', os.path.relpath(out), os.path.getsize(out), 'bytes')
