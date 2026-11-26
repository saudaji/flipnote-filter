# Alisa la sombra de contacto de una pieza renderizada.
# El plano de sombra de Blender sale con ruido cuando la pieza es grande y lustrosa (la mascota):
# el quitarruido deja huecos transparentes en mitad de la sombra, que sobre la carcasa se ven como
# manchas claras. Aquí la sombra (los píxeles negros translúcidos) se separa de la pieza, se
# desenfoca y se vuelve a poner debajo. La pieza no se toca.
# El desenfoque no cuenta lo que hay bajo la pieza (ahí no se sabe cuánta sombra hay): así el canto
# no se aclara ni aparece un halo donde no había sombra.
#   python3 design/camera-body/sombra.py <png> [<png> …]     (reescribe cada archivo)
import sys
from PIL import Image, ImageFilter, ImageChops, ImageMath

RADIUS = 7          # px a la escala del render (4 por píxel de diseño)
divide = getattr(ImageMath, 'lambda_eval', None)
for path in sys.argv[1:]:
    im = Image.open(path).convert('RGBA')
    r, g, b, a = im.split()
    dark = Image.eval(ImageChops.add(ImageChops.add(r, g), b), lambda v: 255 if v < 12 else 0)   # negro puro: sombra
    shadow = ImageChops.multiply(a, dark)
    piece = ImageChops.multiply(a, ImageChops.invert(dark))
    free = piece.point(lambda v: 255 if v < 128 else 0)
    num = ImageChops.multiply(shadow, free).filter(ImageFilter.GaussianBlur(RADIUS))
    den = free.filter(ImageFilter.GaussianBlur(RADIUS))
    if divide:
        smooth = divide(lambda args: args['convert'](args['min'](args['num'] * 255 / args['max'](args['den'], 20), 255), 'L'), num=num, den=den)
    else:
        smooth = ImageMath.eval("convert(min(num * 255 / max(den, 20), 255), 'L')", num=num, den=den)
    base = Image.new('RGBA', im.size, (0, 0, 0, 0))
    base.putalpha(smooth)
    top = im.copy()
    top.putalpha(piece)
    Image.alpha_composite(base, top).save(path)
    print('sombra alisada:', path)
