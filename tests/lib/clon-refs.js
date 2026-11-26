// Referencias sintéticas para CLON: imágenes de las que se sabe exactamente qué look llevan.
// Se cargan en la página (window.clonRefs). Cada una devuelve un lienzo.
(function () {
  const tone = (x, y) => {                    // una «escena» suave: dos manchas y un degradado, 0…1
    const a = Math.exp(-((x - 0.34) ** 2 + (y - 0.4) ** 2) / 0.05), b = Math.exp(-((x - 0.7) ** 2 + (y - 0.66) ** 2) / 0.035);
    return Math.max(0, Math.min(1, 0.16 + 0.5 * x * 0.6 + 0.62 * a + 0.5 * b - 0.18 * y));
  };
  const make = (size, fn) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'), im = ctx.createImageData(size, size), d = im.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const rgb = fn(x, y, size), o = 4 * (y * size + x); d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255; }
    ctx.putImageData(im, 0, 0);
    return c;
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  window.clonRefs = {
    // Trama de puntos: tinta rosa sobre crema, «cells» celdas a lo ancho, girada «deg» grados.
    dots(size = 400, cells = 40, deg = 30) {
      const ink = [226, 62, 120], paper = [244, 236, 214], a = deg * Math.PI / 180;
      return make(size, (x, y, s) => {
        const u = x / s, v = y / s, r1 = (Math.cos(a) * u + Math.sin(a) * v) * cells * 2 * Math.PI, r2 = (-Math.sin(a) * u + Math.cos(a) * v) * cells * 2 * Math.PI;
        return tone(u, v) < 0.5 + 0.25 * (Math.cos(r1) + Math.cos(r2)) ? ink : paper;
      });
    },
    // Trama de líneas horizontales: tinta azul sobre blanco hueso.
    lines(size = 400, cells = 50) {
      const ink = [24, 44, 110], paper = [240, 238, 228];
      return make(size, (x, y, s) => (tone(x / s, y / s) < 0.5 + 0.5 * Math.cos(y / s * cells * 2 * Math.PI) ? ink : paper));
    },
    // Píxel art: cuatro tintas, «cells» bloques a lo ancho, con tramado ordenado.
    pixel(size = 400, cells = 40) {
      const pal = [[20, 28, 54], [30, 122, 124], [214, 168, 96], [246, 238, 210]];
      return make(size, (x, y, s) => {
        const b = s / cells, cx = Math.floor(x / b), cy = Math.floor(y / b), t = tone((cx + 0.5) / cells, (cy + 0.5) / cells) * 3;
        const lo = Math.min(2, Math.floor(t)), f = t - lo;
        return pal[f > (BAYER[(cy & 3) * 4 + (cx & 3)] + 0.5) / 16 ? lo + 1 : lo];
      });
    },
    // Duotono suave: del azul noche al amarillo, sin textura.
    duotone(size = 400) {
      const a = [18, 26, 92], b = [250, 214, 80];
      return make(size, (x, y, s) => { const t = tone(x / s, y / s); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; });
    },
    // Foto con grano: color continuo y ruido fino.
    grainy(size = 400, amount = 34) {
      seed = 11;
      return make(size, (x, y, s) => { const t = tone(x / s, y / s), n = (rnd() - 0.5) * amount; return [60 + 150 * t + n, 80 + 90 * (1 - t) * (x / s) + 60 * t + n, 120 + 90 * (y / s) * (1 - t) + n].map(v => Math.max(0, Math.min(255, v))); });
    },
    // La misma foto, limpia.
    clean(size = 400) { return this.grainy(size, 0); },
    // Cartel: tres tintas planas y líneas negras.
    poster(size = 400) {
      const pal = [[236, 84, 52], [248, 206, 70], [38, 110, 168]], black = [16, 16, 20];
      return make(size, (x, y, s) => {
        const u = x / s, v = y / s, t = tone(u, v), band = t < 0.34 ? 2 : t < 0.62 ? 0 : 1;
        const near = Math.min(Math.abs(t - 0.34), Math.abs(t - 0.62));
        return near < 0.012 ? black : pal[band];
      });
    },
  };
})();
