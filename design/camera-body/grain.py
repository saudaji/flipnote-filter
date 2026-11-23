# El grano de molde de la carcasa: una tesela que casa por los cuatro lados, con el relieve
# iluminado desde arriba a la izquierda (claros en blanco, sombras en pardo, todo translúcido).
#   <python con numpy> design/camera-body/grain.py <salida.rgba>   →   256×256 RGBA en bruto
# (el Python de Blender trae numpy; luego se pasa a WebP sin pérdida, ver body.sh)
import sys
import numpy as np
N = 256
rng = np.random.default_rng(27)
fy = np.fft.fftfreq(N)[:, None]
fx = np.fft.fftfreq(N)[None, :]


def blur(a, sigma):
    """Desenfoque gaussiano envolvente, en el dominio de Fourier."""
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))))


fine = blur(rng.normal(size=(N, N)), 0.7)
coarse = blur(rng.normal(size=(N, N)), 2.6)
relief = fine / fine.std() * 0.9 + coarse / coarse.std() * 0.22
light = np.roll(relief, (1, 1), (0, 1)) - np.roll(relief, (-1, -1), (0, 1))
light /= np.abs(light).max()
light = np.sign(light) * np.abs(light) ** 0.9
strength = float(sys.argv[2]) if len(sys.argv) > 2 else 0.12
out = np.zeros((N, N, 4), np.uint8)
out[..., 0] = np.where(light > 0, 255, 58)
out[..., 1] = np.where(light > 0, 255, 48)
out[..., 2] = np.where(light > 0, 255, 28)
out[..., 3] = (np.clip(np.abs(light) * strength, 0, 1) * 255).round().astype(np.uint8)
out.tofile(sys.argv[1])
print('grano', out.shape, float(out[..., 3].mean()))
