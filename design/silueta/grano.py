# Grano de la piel INTERFAZ: ruido fino y nítido, de píxel, parejo en toda la superficie (como una
# textura de grano de película tendida sobre la pantalla). No es el grano de la piel OBJETO (relieve
# de plástico) ni motas sueltas «de arena» ni manchas suaves. Es un velo: TODOS los píxeles de la
# tesela llevan la misma opacidad baja y lo que cambia de uno a otro es su gris, sin suavizar. Así,
# sea cual sea el color de abajo (crema, tinta o verde), le suma el mismo grano denso y le quita un
# punto de contraste (aclara lo oscuro, apaga lo claro): aspecto mate. Se compone sin modos de fusión
# y se pinta sin interpolar (image-rendering: pixelated), para que no se emborrone al escalarlo.
# La interfaz lo pone ENCIMA de todo —barras, teclas, disparador, rótulos— menos de la imagen.
#   python3 design/silueta/grano.py [salida=docs/brand/silueta/grano.webp] [lado=256] [velo=0.16] [contraste=100]
import os
import random
import sys
from PIL import Image

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'docs', 'brand', 'silueta', 'grano.webp')
side = int(sys.argv[2]) if len(sys.argv) > 2 else 256
veil = float(sys.argv[3]) if len(sys.argv) > 3 else 0.16
contrast = float(sys.argv[4]) if len(sys.argv) > 4 else 100
random.seed(27)


# Un valor por píxel, sin suavizar (ruido blanco: no necesita envolverse para no tener costura).
# Gris medio algo claro: sobre el crema apenas apaga y sobre la tinta levanta lo justo.
alpha = round(veil * 255)
pixels = []
for _ in range(side * side):
    grey = max(0, min(255, round(160 + random.gauss(0, 1) * contrast)))
    pixels.append((grey, grey, grey, alpha))
image = Image.new('RGBA', (side, side))
image.putdata(pixels)
os.makedirs(os.path.dirname(out), exist_ok=True)
image.save(out, lossless=True, quality=100, method=6)
print('grano:', os.path.relpath(out), os.path.getsize(out), 'bytes')
