# Pasa a plástico oscuro los marcos hundidos (visor, bandeja, pantallita) que se renderizaron en
# crema: la pared conserva su sombra y lo que en crema era el brillo del canto queda como reflejo.
# El bisel y el cristal, que ya eran oscuros, no se tocan.
#   python3 design/camera-body/oscuro.py <entrada.webp> <salida.png> [#crema] [#oscuro]
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
hexa = lambda h: tuple(int(h.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))
cream = hexa(sys.argv[3] if len(sys.argv) > 3 else '#E7E0CF')
dark = hexa(sys.argv[4] if len(sys.argv) > 4 else '#232946')
lum = lambda c: c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114
step = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1.0, max(0.0, (x - a) / (b - a))))
base = lum(cream)
im = Image.open(src).convert('RGBA')
px = im.load()
for y in range(im.size[1]):
    for x in range(im.size[0]):
        r, g, b, a = px[x, y]
        if not a:
            continue
        f = lum((r, g, b)) / base
        d = ((r - cream[0] * f) ** 2 + (g - cream[1] * f) ** 2 + (b - cream[2] * f) ** 2) ** 0.5
        w = (1 - step(14, 40, d)) * step(0.38, 0.62, f)
        if w <= 0:
            continue
        # La pared iluminada del crema pasa de su tono base: se toma ese tope como «plena luz».
        lit = f / 1.08
        shade = min(1.0, lit) ** 1.3
        shine = max(0.0, lit - 0.97) * 250
        px[x, y] = tuple(int(round(min(255, c * (1 - w) + (k * shade + shine) * w))) for c, k in zip((r, g, b), dark)) + (a,)
im.save(out)
