// Códigos QR hechos aquí, sin bibliotecas: versiones 1 a 40, corrección de errores baja (L: el código
// se lee de una pantalla, no de un papel arrugado, y así cabe más en menos cuadritos).
//
//   flipQR.make([{ mode: 'byte', text }, { mode: 'alnum', text }, …])  →  { size, version, dark(x, y) }  (null si no cabe)
//   flipQR.paint(lienzo, qr, px?)                                      lo pinta negro sobre blanco, con su margen
//
// Un código puede llevar tramos de distinto tipo: «byte» vale para cualquier texto (8 bits por letra)
// y «alnum» solo para 0-9, A-Z y «espacio $ % * + - . / :» (5,5 bits por letra). Un enlace largo sale
// bastante más pequeño si la dirección va en «byte» y la carga, escrita con ese alfabeto, en «alnum».
const flipQR = (() => {
  'use strict';
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  // Por versión (1…40), en corrección L: bytes de corrección por bloque y número de bloques.
  const ECC = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
  const BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25];
  // Reed-Solomon sobre GF(2^8), polinomio 0x11D.
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
  function divisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    for (let i = 0, root = 1; i < degree; i++, root = mul(root, 2)) for (let j = 0; j < degree; j++) { r[j] = mul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1]; }
    return r;
  }
  function remainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); for (let i = 0; i < div.length; i++) r[i] ^= mul(div[i], f); }
    return r;
  }
  const rawModules = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const a = Math.floor(v / 7) + 2; r -= (25 * a - 10) * a - 55; if (v >= 7) r -= 36; } return r; };
  const dataBytes = v => Math.floor(rawModules(v) / 8) - ECC[v - 1] * BLOCKS[v - 1];
  const countBits = (mode, v) => (mode === 'alnum' ? [9, 11, 13] : [8, 16, 16])[v < 10 ? 0 : v < 27 ? 1 : 2];

  function make(parts) {
    const segs = [];
    for (const p of parts) {
      const text = String(p.text);
      if (!text) continue;
      if (p.mode === 'alnum') { for (const ch of text) if (!ALNUM.includes(ch)) return null; segs.push({ mode: 'alnum', n: text.length, text }); }
      else { const bytes = new TextEncoder().encode(text); segs.push({ mode: 'byte', n: bytes.length, bytes }); }
    }
    let v = 0;
    for (let ver = 1; ver <= 40 && !v; ver++) {
      let bits = 0;
      for (const s of segs) bits += 4 + countBits(s.mode, ver) + (s.mode === 'alnum' ? Math.floor(s.n / 2) * 11 + (s.n % 2) * 6 : s.n * 8);
      if (bits <= dataBytes(ver) * 8) v = ver;
    }
    if (!v) return null;
    // Los datos, bit a bit: cada tramo con su tipo y su cuenta; luego el cierre y el relleno.
    const bb = [], put = (val, len) => { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); };
    for (const s of segs) {
      put(s.mode === 'alnum' ? 2 : 4, 4); put(s.n, countBits(s.mode, v));
      if (s.mode === 'alnum') for (let i = 0; i < s.n; i += 2) { if (i + 1 < s.n) put(ALNUM.indexOf(s.text[i]) * 45 + ALNUM.indexOf(s.text[i + 1]), 11); else put(ALNUM.indexOf(s.text[i]), 6); }
      else for (const b of s.bytes) put(b, 8);
    }
    const cap = dataBytes(v) * 8;
    put(0, Math.min(4, cap - bb.length)); put(0, (8 - bb.length % 8) % 8);
    for (let pad = 0xEC; bb.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bb.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bb[i + j]; data.push(b); }
    // La corrección de errores, por bloques, y todo entrelazado.
    const nb = BLOCKS[v - 1], el = ECC[v - 1], rawBytes = Math.floor(rawModules(v) / 8), nShort = nb - rawBytes % nb, shortLen = Math.floor(rawBytes / nb), div = divisor(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = remainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) all.push(b[i]); });
    // El dibujo: lo fijo (guías, las tres esquinas, los alineadores, formato y versión) y luego los datos.
    const size = v * 4 + 17, mod = new Uint8Array(size * size), fixed = new Uint8Array(size * size);
    const set = (x, y, dark) => { mod[y * size + x] = dark ? 1 : 0; fixed[y * size + x] = 1; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const corner = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); } };
    corner(3, 3); corner(size - 4, 3); corner(3, size - 4);
    const at = [];
    if (v > 1) { const n = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2; for (let pos = size - 7; at.length < n - 1; pos -= step) at.unshift(pos); at.unshift(6); }
    at.forEach((ay, i) => at.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === at.length - 1) || (i === at.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const format = mask => {
      const d = (1 << 3) | mask;                                   // (1 = corrección L)
      let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const bits = ((d << 10) | r) ^ 0x5412, bit = i => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    format(0);
    if (v >= 7) {
      let r = v;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const bits = (v << 12) | r;
      for (let i = 0; i < 18; i++) { const dark = ((bits >>> i) & 1) !== 0, a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, dark); set(b, a, dark); }
    }
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fixed[y * size + x] && k < all.length * 8) { mod[y * size + x] = (all[k >>> 3] >>> (7 - (k & 7))) & 1; k++; }
      }
    }
    // La máscara: de las ocho, la que deja el dibujo más fácil de leer (menos rachas, bloques y falsas esquinas).
    const MASKS = [(x, y) => (x + y) % 2, (x, y) => y % 2, (x, y) => x % 3, (x, y) => (x + y) % 3, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2, (x, y) => (x * y) % 2 + (x * y) % 3, (x, y) => ((x * y) % 2 + (x * y) % 3) % 2, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2];
    const flip = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y * size + x] && MASKS[m](x, y) === 0) mod[y * size + x] ^= 1; };
    const penalty = () => {
      let p = 0, dark = 0;
      for (let turn = 0; turn < 2; turn++) for (let a = 0; a < size; a++) {
        let run = 0, last = -1, line = '';
        for (let b = 0; b < size; b++) {
          const c = turn ? mod[b * size + a] : mod[a * size + b];
          line += c;
          if (c === last) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { last = c; run = 1; }
        }
        for (const pat of ['10111010000', '00001011101']) for (let from = line.indexOf(pat); from >= 0; from = line.indexOf(pat, from + 1)) p += 40;
      }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = mod[y * size + x]; if (c === mod[y * size + x + 1] && c === mod[(y + 1) * size + x] && c === mod[(y + 1) * size + x + 1]) p += 3; }
      for (let i = 0; i < mod.length; i++) dark += mod[i];
      return p + Math.max(0, Math.ceil(Math.abs(dark * 20 - mod.length * 10) / mod.length) - 1) * 10;
    };
    let best = 0, least = Infinity;
    for (let m = 0; m < 8; m++) { flip(m); format(m); const p = penalty(); if (p < least) { least = p; best = m; } flip(m); }
    flip(best); format(best);
    return { size, version: v, mask: best, dark: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mod[y * size + x] === 1 };
  }
  // Negro sobre blanco y con cuatro cuadritos de margen: un lector no entiende otra cosa.
  function paint(canvas, qr, px) {
    const s = Math.max(1, Math.round(px || 8)), side = (qr.size + 8) * s, c = canvas.getContext('2d');
    canvas.width = canvas.height = side;
    c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, side, side);
    c.fillStyle = '#000000';
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
      if (!qr.dark(x, y)) continue;
      let run = 1;
      while (qr.dark(x + run, y)) run++;
      c.fillRect((x + 4) * s, (y + 4) * s, run * s, s);
      x += run - 1;
    }
    return canvas;
  }
  return { make, paint, ALNUM };
})();
