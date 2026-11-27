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
  // Una referencia «fotografiada»: lo que le pasa a una imagen cuando se la retrata con un teléfono.
  //   light: [a, b]  luz desigual, de a× (arriba a la izquierda) a b× (abajo a la derecha)
  //   glare: true    un reflejo que quema una mancha
  //   blur: σ        desenfoque, en píxeles
  //   noise: σ       ruido de sensor (0…255), sin correlación entre puntos
  //   jpeg: q        compresión JPEG de verdad (calidad 0…1)
  //   rot: grados    giro (se recorta el centro para que no asomen esquinas)
  //   size: px       remuestreo a otro tamaño (los bloques dejan de caer en píxeles enteros)
  window.clonDegrade = async function (canvas, o = {}) {
    let c = canvas;
    const copy = (w, h, draw) => { const n = document.createElement('canvas'); n.width = w; n.height = h; const x = n.getContext('2d', { willReadFrequently: true }); draw(x, n); return n; };
    if (o.size) c = copy(o.size, o.size, x => { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, o.size, o.size); });
    if (o.rot) { const src = c, a = o.rot * Math.PI / 180, k = Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)); c = copy(src.width, src.height, x => { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.translate(src.width / 2, src.height / 2); x.rotate(a); x.scale(k, k); x.drawImage(src, -src.width / 2, -src.height / 2); }); }
    if (o.blur) { const src = c; c = copy(src.width, src.height, x => { x.filter = 'blur(' + o.blur + 'px)'; x.drawImage(src, 0, 0); x.filter = 'none'; }); }
    if (o.light || o.noise || o.glare) {
      const src = c;
      c = copy(src.width, src.height, x => {
        x.drawImage(src, 0, 0);
        const im = x.getImageData(0, 0, src.width, src.height), d = im.data, w = src.width, h = src.height;
        seed = 91;
        const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;
        for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
          const i = 4 * (y * w + xx), gain = o.light ? o.light[0] + (o.light[1] - o.light[0]) * (xx / w + y / h) / 2 : 1;
          const flare = o.glare ? 150 * Math.exp(-(((xx / w - 0.68) ** 2 + (y / h - 0.3) ** 2) / 0.012)) : 0;
          for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, d[i + k] * gain + flare + (o.noise ? gauss() * o.noise : 0)));
        }
        x.putImageData(im, 0, 0);
      });
    }
    if (o.jpeg) {
      const blob = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', o.jpeg)), bmp = await createImageBitmap(blob);
      c = copy(bmp.width, bmp.height, x => x.drawImage(bmp, 0, 0));
    }
    return c;
  };
  window.clonRefs = {
    // Una figura sobre fondo absoluto (negro o blanco). «fill» puede ser un color, o una función que
    // devuelve un degradado (recibe el contexto).
    silueta(n = 512, ground = '#000', fill = '#19d3e6') {
      const c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d'), k = n / 512;
      x.fillStyle = ground; x.fillRect(0, 0, n, n);
      x.fillStyle = typeof fill === 'function' ? fill(x, k) : fill;
      x.beginPath(); x.ellipse(256 * k, 170 * k, 70 * k, 86 * k, 0, 0, 7); x.fill();
      x.beginPath(); x.ellipse(256 * k, 420 * k, 150 * k, 170 * k, 0, Math.PI, 0); x.fill(); x.fillRect(236 * k, 240 * k, 40 * k, 40 * k);
      return c;
    },
    // Un resplandor sobre negro absoluto: blanco en el centro, rosa, azul, y se apaga.
    resplandor(n = 512) {
      const c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d'), k = n / 512;
      x.fillStyle = '#000'; x.fillRect(0, 0, n, n);
      const g = x.createRadialGradient(256 * k, 250 * k, 0, 256 * k, 250 * k, 230 * k);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, '#ff7ad1'); g.addColorStop(0.45, '#2b7bff'); g.addColorStop(0.8, '#06103a'); g.addColorStop(1, '#000000');
      x.fillStyle = g; x.fillRect(0, 0, n, n);
      return c;
    },
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
    // Foto con grano de película: color continuo y un grano con tamaño (grumos redondos de unos «clump»
    // puntos, sin rejilla), que es lo que lo distingue del ruido de un sensor (que no tiene tamaño: cada
    // punto va por su cuenta). Los grumos salen de emborronar ruido blanco y devolverle su fuerza.
    grainy(size = 400, amount = 34, clump = 2) {
      seed = 11;
      let field = new Float32Array(size * size);
      for (let i = 0; i < field.length; i++) field[i] = rnd() - 0.5;
      if (clump > 1) {
        const r = clump / 2, taps = [];
        for (let k = -Math.ceil(r * 2); k <= Math.ceil(r * 2); k++) taps.push([k, Math.exp(-k * k / (2 * r * r * 0.5))]);
        for (const axis of [1, size]) {
          const out = new Float32Array(size * size);
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            let v = 0, w = 0;
            for (const [k, g] of taps) { const xx = axis === 1 ? x + k : x, yy = axis === 1 ? y : y + k; if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue; v += field[yy * size + xx] * g; w += g; }
            out[y * size + x] = v / w;
          }
          field = out;
        }
        let e = 0;
        for (let i = 0; i < field.length; i++) e += field[i] * field[i];
        const gain = 0.2887 / Math.sqrt(e / field.length);            // (la desviación del ruido de partida: 1/√12)
        for (let i = 0; i < field.length; i++) field[i] *= gain;
      }
      return make(size, (x, y, s) => { const t = tone(x / s, y / s), n = amount ? field[y * size + x] * amount : 0; return [60 + 150 * t + n, 80 + 90 * (1 - t) * (x / s) + 60 * t + n, 120 + 90 * (y / s) * (1 - t) + n].map(v => Math.max(0, Math.min(255, v))); });
    },
    // La misma foto, limpia.
    clean(size = 400) { return this.grainy(size, 0); },
    // La misma foto, posterizada: cada canal en «levels» escalones (color continuo ya no, pero tampoco tintas contadas).
    banded(size = 400, levels = 4) {
      const c = this.grainy(size, 0), x = c.getContext('2d'), im = x.getImageData(0, 0, size, size), d = im.data, q = 255 / (levels - 1);
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.round(Math.round(d[i + k] / q) * q);
      x.putImageData(im, 0, 0);
      return c;
    },
    // Una escena con COSAS que se repiten (las teclas de un teclado, girado): no es una trama ni un píxel gordo.
    keyboard(size = 400, keys = 9, deg = 28) {
      const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      return make(size, (x, y, s) => {
        const u = (x * ca + y * sa) / s * keys, v = (-x * sa + y * ca) / s * keys, fu = u - Math.floor(u), fv = v - Math.floor(v);
        const edge = Math.min(fu, 1 - fu, fv, 1 - fv), key = Math.max(0, Math.min(1, (edge - 0.1) / 0.06)), t = tone(x / s, y / s);
        const base = [38 + 60 * t, 36 + 50 * t, 52 + 70 * t], top = [70 + 80 * t, 66 + 74 * t, 88 + 90 * t];
        return base.map((b, k) => b + (top[k] - b) * key * (0.75 + 0.25 * fv));
      });
    },
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
