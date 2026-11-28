// La cámara CHISPA (brillantina LENTEJA y mar de destellos MAREA). Con escenas dibujadas aquí,
// pasadas por el motor en un lienzo propio, se comprueba con números:
//   · las zonas, solo por luz y color: el cielo oscuro queda liso; la nube clara y sin color sale
//     con granos de todos los matices; el prado verde conserva su matiz y lleva una fracción de
//     chispas cálidas cercana a la pedida;
//   · las cruces «+»: pocas a la vez, dentro del rango;
//   · el pulso: un grano dura encendido lo que dura su pulso (no cambia a cada cuadro); LENTEJA
//     avanza a saltos de ~9 por segundo y MAREA en continuo; y NO es estática de televisión (la
//     misma medida, sobre ruido de televisión de verdad, falla);
//   · el anclaje: con la escena desplazándose, el patrón de granos se desplaza con ella; con
//     anclaje 0 se queda pegado a la pantalla; y el flujo medido es el desplazamiento real;
//   · MAREA pone los destellos sobre las crestas y no en zonas planas;
//   · tamaño relativo: en una foto grande los granos miden lo mismo respecto al cuadro;
//   · persona, sonido, costo por cuadro, soltar la gráfica; y, si la app ya la tiene registrada,
//     la cámara en el visor y su foto.
//   FLIP_URL=http://127.0.0.1:8760 node tests/chispa.cjs [--shots carpeta]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip, pickCamera, saveDataUrl } = require('./lib/harness.cjs');

const at = process.argv.indexOf('--shots');
const shots = at >= 0 ? path.resolve(process.argv[at + 1]) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

// En la página: escenas dibujadas (mundos más anchos que el cuadro, para desplazarlos) y medidas.
const KIT = () => {
  const rng = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 8) / 16777216; };
  const worlds = new Map();
  function world(name, w, h) {
    const key = name + w + 'x' + h;
    if (worlds.has(key)) return worlds.get(key);
    const W = w * 2, c = document.createElement('canvas'); c.width = W; c.height = h;
    const g = c.getContext('2d'), r = rng(7), u = Math.min(w, h) / 576;
    if (name === 'nubes') {
      // cielo #081448 (oscuro), nubes grises neutras con algo de textura, prado #1E7A22 con hierba
      g.fillStyle = '#081448'; g.fillRect(0, 0, W, h);
      for (let k = 0; k < 16; k++) {
        const cx = r() * W, cy = h * (0.12 + 0.42 * r()), s = Math.min(w, h) * (0.08 + 0.08 * r());
        for (let b = 0; b < 9; b++) {
          const v = 170 + Math.round(r() * 30);
          g.fillStyle = `rgb(${v},${v},${v})`;
          g.beginPath(); g.ellipse(cx + (r() - 0.5) * s * 3, cy + (r() - 0.5) * s * 0.9, s * (0.6 + r() * 0.6), s * (0.45 + r() * 0.4), 0, 0, 7); g.fill();
        }
      }
      g.fillStyle = '#1E7A22'; g.fillRect(0, h * 0.66, W, h);
      for (let k = 0; k < W * h * 0.004; k++) {
        const x = r() * W, y = h * 0.66 + r() * h * 0.34, v = r();
        g.strokeStyle = v < 0.5 ? '#186a1c' : '#25902a'; g.lineWidth = (1 + r() * 1.5) * u;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4 * u, y - (3 + r() * 6) * u); g.stroke();
      }
    } else if (name === 'mar') {
      const sky = g.createLinearGradient(0, 0, 0, h * 0.55);
      sky.addColorStop(0, '#0b1a2a'); sky.addColorStop(1, '#16304a');
      g.fillStyle = sky; g.fillRect(0, 0, W, h);
      for (let k = 0; k < 12; k++) {
        const cx = r() * W, cy = h * (0.1 + 0.3 * r()), s = Math.min(w, h) * (0.06 + 0.06 * r());
        g.fillStyle = r() < 0.5 ? '#c99aae' : '#9fb3c4';
        g.filter = 'blur(' + Math.round(3 * u) + 'px)';
        for (let b = 0; b < 6; b++) { g.beginPath(); g.ellipse(cx + (r() - 0.5) * s * 3, cy + (r() - 0.5) * s, s * (0.5 + r() * 0.5), s * (0.35 + r() * 0.3), 0, 0, 7); g.fill(); }
        g.filter = 'none';
      }
      g.fillStyle = '#123247'; g.fillRect(0, h * 0.55, W, h);
      for (let k = 0; k < 9; k++) {
        const y0 = h * (0.6 + 0.045 * k), amp = (4 + k * 1.5) * u, len = (60 + k * 10) * u;
        g.strokeStyle = 'rgb(190,240,245)'; g.lineWidth = (1.5 + k * 0.25) * u;
        g.beginPath();
        for (let x = 0; x <= W; x += 4) { const y = y0 + Math.sin(x / len + k) * amp; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
      }
      // manchas claras y lisas (la luna y su doble): sin crestas por dentro
      g.fillStyle = '#b8c4cc';
      for (const fx of [0.3, 0.8]) { g.beginPath(); g.ellipse(W * fx, h * 0.27, h * 0.12, h * 0.12, 0, 0, 7); g.fill(); }
    } else if (name === 'jardin') {
      // jardín de noche: cielo, nubes de borde claro, una luna lisa, espuma con textura y un macizo
      // de flores rosas (lo claro con textura donde deben salir campos de destellos)
      const sky = g.createLinearGradient(0, 0, 0, h * 0.45);
      sky.addColorStop(0, '#0b1a2a'); sky.addColorStop(1, '#16304a');
      g.fillStyle = sky; g.fillRect(0, 0, W, h);
      for (let k = 0; k < 8; k++) {
        const cx = r() * W, cy = h * (0.08 + 0.22 * r()), s = Math.min(w, h) * (0.05 + 0.05 * r());
        g.fillStyle = r() < 0.5 ? '#c99aae' : '#9fb3c4';
        for (let b = 0; b < 6; b++) { g.beginPath(); g.ellipse(cx + (r() - 0.5) * s * 3, cy + (r() - 0.5) * s, s * (0.5 + r() * 0.5), s * (0.35 + r() * 0.3), 0, 0, 7); g.fill(); }
      }
      g.fillStyle = '#b8c4cc';
      for (const fx of [0.3, 0.8]) { g.beginPath(); g.ellipse(W * fx, h * 0.2, h * 0.08, h * 0.08, 0, 0, 7); g.fill(); }
      g.fillStyle = '#14425a'; g.fillRect(0, h * 0.45, W, h * 0.17);
      for (let k = 0; k < W * h * 0.0016; k++) { const v = r(); g.fillStyle = v < 0.5 ? '#9fe6ef' : v < 0.8 ? '#d6fbff' : '#5fc4d6'; g.beginPath(); g.arc(r() * W, h * (0.46 + 0.15 * r()), (1.5 + r() * 4) * u, 0, 7); g.fill(); }
      g.fillStyle = '#123327'; g.fillRect(0, h * 0.62, W, h * 0.38);
      for (let k = 0; k < W * h * 0.0022; k++) { const v = r(); g.fillStyle = v < 0.4 ? '#e88aa8' : v < 0.75 ? '#f4b6c8' : '#c25a7a'; g.beginPath(); g.arc(r() * W, h * (0.64 + 0.35 * r()), (2.5 + r() * 7) * u, 0, 7); g.fill(); }
    } else if (name === 'textura') {
      // manchas suaves de muchos tamaños, como las de una foto: textura en todas partes, para
      // medir el movimiento (un ruido de píxeles sueltos no lo tiene ninguna cámara)
      g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, W, h);
      for (let k = 0; k < W * h / 900; k++) {
        const v = Math.round(40 + r() * 210), x = r() * W, y = r() * h, rad = (5 + r() * 26) * u;
        const col = `${v},${Math.round(v * (0.7 + 0.5 * r()))},${Math.round(v * (0.7 + 0.5 * r()))}`;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(0.6, `rgba(${col},0.85)`); gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
      }
    }
    worlds.set(key, c);
    return c;
  }
  // Un interior corriente, claro y con poco color, con una ventana al cielo: la escena de casi
  // todas las fotos de una cámara de verdad.
  function ventana(g, w, h) {
    const u = Math.min(w, h) / 576, wall = g.createLinearGradient(0, 0, w, h);
    wall.addColorStop(0, '#d6cfc2'); wall.addColorStop(1, '#a39b8f');
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    const wx = w * 0.5, wy = h * 0.1, ww = w * 0.42, wh = h * 0.36, sky = g.createLinearGradient(0, wy, 0, wy + wh);
    sky.addColorStop(0, '#86b9e6'); sky.addColorStop(1, '#d4e9f7');
    g.fillStyle = sky; g.fillRect(wx, wy, ww, wh);
    g.fillStyle = '#ffffff';
    for (const [fx, fy, s] of [[0.62, 0.2, 1], [0.8, 0.3, 0.8]]) for (let b = 0; b < 4; b++) { g.beginPath(); g.ellipse(w * fx + (b - 1.5) * 18 * u * s, h * fy + (b % 2) * 6 * u, 22 * u * s, 13 * u * s, 0, 0, 7); g.fill(); }
    g.strokeStyle = '#f2efe8'; g.lineWidth = 9 * u; g.strokeRect(wx, wy, ww, wh);
    g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.moveTo(wx, wy + wh / 2); g.lineTo(wx + ww, wy + wh / 2); g.stroke();
    g.fillStyle = '#6b4e37'; g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = '#5a6a7e'; g.beginPath(); g.roundRect ? g.roundRect(w * 0.04, h * 0.57, w * 0.5, h * 0.22, 14 * u) : g.rect(w * 0.04, h * 0.57, w * 0.5, h * 0.22); g.fill();
    g.fillStyle = '#4b596b'; g.fillRect(w * 0.04, h * 0.66, w * 0.5, h * 0.13);
    g.fillStyle = '#2d2d2d'; g.fillRect(w * 0.1, h * 0.2, w * 0.22, h * 0.17);
    g.fillStyle = '#c9a24a'; g.fillRect(w * 0.115, h * 0.21, w * 0.19, h * 0.15);
    g.fillStyle = '#b5653e'; g.fillRect(w * 0.7, h * 0.66, w * 0.12, h * 0.12);
    g.fillStyle = '#3f8a3a';
    for (let k = 0; k < 9; k++) { g.beginPath(); g.ellipse(w * 0.76 + Math.cos(k * 0.7) * 30 * u, h * 0.6 - Math.abs(Math.sin(k * 1.3)) * 40 * u, 9 * u, 24 * u, k * 0.7, 0, 7); g.fill(); }
    g.fillStyle = '#efe3c4'; g.beginPath(); g.moveTo(w * 0.05, h * 0.5); g.lineTo(w * 0.14, h * 0.5); g.lineTo(w * 0.12, h * 0.42); g.lineTo(w * 0.07, h * 0.42); g.closePath(); g.fill();
  }
  // Las dos referencias, redibujadas con su composición (para comparar recorte contra recorte):
  // brillantina — cielo azul muy oscuro, nubes claras (alguna delante de la loma) y un prado verde;
  // mar de destellos — noche azul petróleo, una franja de nubes grises con borde claro y algo de
  // rosa, el mar con una ola de cresta clara y un macizo de flores rosas delante. Suave, como video.
  function lamina(name, g, w, h) {
    const u = Math.min(w, h) / 540, r = rng(name === 'brillo' ? 11 : 23);
    const cloud = (cx, cy, s, light, dark) => {
      for (let k = 0; k < 7; k++) {
        const x = cx + (k - 3) * s * 0.42 + (r() - 0.5) * s * 0.2, y = cy - Math.sin((k + 0.5) / 7 * Math.PI) * s * 0.32 + (r() - 0.5) * s * 0.1, rad = s * (0.22 + 0.16 * Math.sin((k + 0.5) / 7 * Math.PI));
        const gr = g.createRadialGradient(x - rad * 0.3, y - rad * 0.4, rad * 0.1, x, y, rad);
        gr.addColorStop(0, light); gr.addColorStop(1, dark);
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
      }
      g.fillStyle = dark; g.fillRect(cx - s * 1.45, cy - s * 0.02, s * 2.9, s * 0.12);
    };
    if (name === 'brillo') {
      const sky = g.createLinearGradient(0, 0, 0, h * 0.48); sky.addColorStop(0, '#020540'); sky.addColorStop(1, '#081a72');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      for (const [fx, fy, fs] of [[0.27, 0.1, 0.14], [0.56, 0.22, 0.12], [0.2, 0.33, 0.16], [0.92, 0.3, 0.13]]) cloud(w * fx, h * fy, w * fs, '#ffffff', '#c6c1cf');
      g.fillStyle = '#2c7a24'; g.beginPath(); g.moveTo(0, h * 0.47); g.quadraticCurveTo(w * 0.45, h * 0.38, w, h * 0.46); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
      for (let k = 0; k < w * h * 0.003; k++) { const x = r() * w, y = h * (0.42 + 0.58 * r()); g.fillStyle = r() < 0.5 ? '#246b1d' : '#36902b'; g.fillRect(x, y, 2 * u, 3 * u); }
      for (const [fx, fy, fs] of [[0.86, 0.53, 0.13], [0.07, 0.6, 0.11], [0.6, 0.77, 0.15], [0.13, 0.9, 0.13]]) cloud(w * fx, h * fy, w * fs, '#ffffff', '#c6c1cf');
    } else {
      const sky = g.createLinearGradient(0, 0, 0, h * 0.45); sky.addColorStop(0, '#0c1722'); sky.addColorStop(1, '#172a3c');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      // nubes: muchas manchas suaves y alargadas, de borde superior claro; rosadas a la derecha
      for (let k = 0; k < 260; k++) {
        const x = w * r() * 1.1 - w * 0.05, band = h * (0.06 + 0.3 * Math.pow(r(), 0.8)), rx = (14 + r() * 40) * u, ry = rx * (0.28 + 0.2 * r());
        const pink = x > w * 0.62 && r() < 0.6, top = r() < 0.4;
        const col = pink ? (top ? '240,196,212' : '178,136,156') : (top ? '196,204,214' : '104,116,130');
        const gr = g.createRadialGradient(x, band, 0, x, band, rx);
        gr.addColorStop(0, 'rgba(' + col + ',0.8)'); gr.addColorStop(0.6, 'rgba(' + col + ',0.45)'); gr.addColorStop(1, 'rgba(' + col + ',0)');
        g.save(); g.translate(x, band); g.scale(1, ry / rx); g.translate(-x, -band); g.fillStyle = gr; g.beginPath(); g.arc(x, band, rx, 0, 7); g.fill(); g.restore();
      }
      g.fillStyle = '#0f2430'; g.fillRect(0, h * 0.44, w, h * 0.56);
      // la ola: un lomo azulado que sube hacia la derecha, con espuma en la cresta
      const wave = g.createLinearGradient(0, h * 0.55, 0, h * 0.82); wave.addColorStop(0, '#9cc8d8'); wave.addColorStop(0.5, '#5d93aa'); wave.addColorStop(1, '#1d4a5c');
      g.fillStyle = wave; g.beginPath(); g.moveTo(w * 0.2, h * 0.8); g.quadraticCurveTo(w * 0.42, h * 0.53, w * 0.66, h * 0.58); g.quadraticCurveTo(w * 0.86, h * 0.62, w, h * 0.7); g.lineTo(w, h * 0.85); g.lineTo(w * 0.2, h * 0.85); g.closePath(); g.fill();
      for (let k = 0; k < 520; k++) { const t = r(), x = w * (0.28 + 0.72 * t), y = h * (0.58 + 0.1 * Math.abs(t - 0.45) + 0.22 * r() * r()); g.fillStyle = 'rgba(214,244,248,' + (0.3 + 0.5 * r()).toFixed(2) + ')'; g.beginPath(); g.ellipse(x, y, (3 + r() * 9) * u, (1 + r() * 2) * u, 0, 0, 7); g.fill(); }
      // flores: racimos rosas apretados delante, más altos a la izquierda
      for (let k = 0; k < w * h * 0.0024; k++) {
        const x = r() * w, edge = h * (0.6 + 0.32 * Math.pow(x / w, 0.7)), y = edge + r() * (h - edge) * 1.05, rad = (4 + r() * 9) * u;
        const v = r(), gr = g.createRadialGradient(x - rad * 0.3, y - rad * 0.35, 1, x, y, rad);
        gr.addColorStop(0, v < 0.45 ? '#ffd0de' : '#f7a3bd'); gr.addColorStop(0.7, v < 0.45 ? '#e3789a' : '#c9567c'); gr.addColorStop(1, 'rgba(70,16,36,0.9)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
      }
    }
  }
  function scene(name, w, h, off, into) {
    const c = into || document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    if (name === 'cuarto') { FlipScenes.draw(g, w, h, 'roomLit', 0); return c; }
    if (name === 'retrato') { FlipScenes.draw(g, w, h, 'portrait', 0); return c; }
    if (name === 'ventana') { ventana(g, w, h); return c; }
    if (name === 'brillo' || name === 'nocturno') {
      lamina(name, g, w, h);
      // (suave como el video de la referencia)
      if ('filter' in g) { const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').drawImage(c, 0, 0); g.filter = 'blur(' + (Math.min(w, h) / 540).toFixed(2) + 'px)'; g.drawImage(t, 0, 0); g.filter = 'none'; }
      return c;
    }
    g.drawImage(world(name, w, h), -Math.round(off || 0) - Math.round(w * 0.25), 0);
    return c;
  }
  // Pasa «frames» cuadros por el motor a 30 por segundo; con «shift», la escena se desplaza.
  function run(name, variant, W, H, { frames = 6, opts = {}, start = 1000, shift = 0, keep = [], src = null } = {}) {
    const source = src || scene(name, W, H, 0);
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    const kept = {};
    for (let i = 0; i < frames; i++) {
      if (shift) scene(name, W, H, i * shift, source);
      renderChispa(source, source.width, source.height, ctx, false, variant, { now: start + i * 33.333, ...opts });
      if (keep.includes(i)) { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(out, 0, 0); kept[i] = c; }
    }
    return { out, kept, source };
  }
  const px = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const lumaOf = c => { const d = px(c), n = d.length / 4, L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]; return L; };
  function hsv(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 0) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, mx ? d / mx : 0, mx / 255];
  }
  // Máscara de zonas sacada de la escena de origen (misma medida que la salida), recortada hacia dentro.
  function zones(src, erode) {
    const w = src.width, h = src.height, d = px(src), z = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = d[4 * i], g = d[4 * i + 1], b = d[4 * i + 2];
      z[i] = r === 8 && g === 20 && b === 72 ? 1 : r === g && g === b && r > 150 ? 2 : g > r + 30 && g > b + 30 ? 3 : 0;
    }
    const out = new Uint8Array(w * h);
    for (let y = erode; y < h - erode; y++) for (let x = erode; x < w - erode; x++) {
      const k = z[y * w + x];
      if (!k) continue;
      let ok = true;
      for (let dy = -erode; dy <= erode && ok; dy += Math.max(1, erode >> 2)) for (let dx = -erode; dx <= erode; dx += Math.max(1, erode >> 2)) if (z[(y + dy) * w + x + dx] !== k) { ok = false; break; }
      if (ok) out[y * w + x] = k;
    }
    return out;
  }
  function corr(a, b) {
    const n = a.length; let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return sab / Math.sqrt(saa * sbb + 1e-9);
  }
  // Correlación entre B y A desplazada s píxeles en x (zona central, para no tocar los bordes).
  function shiftCorr(A, B, w, h, s) {
    const a = [], b = [], m = 40;
    for (let y = m; y < h - m; y += 2) for (let x = m; x < w - m; x += 2) { b.push(B[y * w + x]); a.push(A[y * w + x - s]); }
    return corr(a, b);
  }
  // Lo que queda al quitar lo suave: el campo de destellos.
  function highpass(L, w, h, r = 4) {
    const out = new Float32Array(w * h), row = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += L[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { row[y * w + x] = s / (2 * r + 1); s += L[y * w + Math.min(w - 1, x + r + 1)] - L[y * w + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += row[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { out[y * w + x] = L[y * w + x] - s / (2 * r + 1); s += row[Math.min(h - 1, y + r + 1) * w + x] - row[Math.max(0, y - r) * w + x]; } }
    return out;
  }
  // Manchas blancas (centros de cruz o de cuadro) por relleno.
  function blobs(c) {
    const w = c.width, h = c.height, d = px(c), seen = new Uint8Array(w * h);
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (seen[i] || d[4 * i] < 128) continue;
      n++; const stack = [i]; seen[i] = 1;
      while (stack.length) { const k = stack.pop(), x = k % w, y = (k / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy, j = yy * w + xx; if (xx >= 0 && yy >= 0 && xx < w && yy < h && !seen[j] && d[4 * j] >= 128) { seen[j] = 1; stack.push(j); } } }
    }
    return n;
  }
  // Largo medio de los tramos de un mismo gris a lo largo de las filas (tamaño del grano).
  function runLength(c) {
    const w = c.width, h = c.height, d = px(c);
    let runs = 0, cells = 0;
    for (let y = 4; y < h - 4; y += 3) for (let x = 5; x < w - 4; x++) { cells++; if (x === 5 || Math.abs(d[4 * (y * w + x)] - d[4 * (y * w + x - 1)]) > 2) runs++; }
    return cells / runs;
  }
  // Lo que el motor deja como estaba: la escena (con el mismo realce de color que pone de base).
  function smoothMask(src, out) {
    const a = px(src), b = px(out), n = a.length / 4, m = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = a[4 * i], g = a[4 * i + 1], bl = a[4 * i + 2], l = 0.299 * r + 0.587 * g + 0.114 * bl, k = 1.18;
      const er = Math.min(255, Math.max(0, l + (r - l) * k)), eg = Math.min(255, Math.max(0, l + (g - l) * k)), eb = Math.min(255, Math.max(0, l + (bl - l) * k));
      const lo = 0.299 * b[4 * i] + 0.587 * b[4 * i + 1] + 0.114 * b[4 * i + 2];
      m[i] = Math.abs(lo - l) < 8 && Math.abs(b[4 * i] - er) < 16 && Math.abs(b[4 * i + 1] - eg) < 16 && Math.abs(b[4 * i + 2] - eb) < 16 ? 1 : 0;
    }
    return m;
  }
  window.CK = { scene, run, px, lumaOf, hsv, zones, corr, shiftCorr, highpass, blobs, runLength, world, smoothMask };
};

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { boot: false, desktop: true });
    await page.waitForFunction(() => document.readyState === 'complete');
    // Si la app todavía no carga el motor, se carga aquí.
    if (await page.evaluate(() => typeof window.renderChispa) !== 'function') await page.addScriptTag({ path: path.join(__dirname, '..', 'docs', 'chispa.js') });
    await page.evaluate(KIT);
    assert.ok(await page.evaluate(() => typeof renderChispa === 'function' && !!window.flipChispa), 'el motor expone renderChispa y flipChispa');

    // ── 1 · Zonas por luz y color (LENTEJA) ──
    const zonas = await page.evaluate(() => {
      const W = 1024, H = 576, { out, source } = CK.run('nubes', 'LENTEJA', W, H, { frames: 6 });
      const z = CK.zones(source, 20), d = CK.px(out);
      const sky = [], hues = new Array(12).fill(0), prado = { n: 0, green: 0, warm: 0 };
      let nubeSat = 0, nube = 0;
      for (let i = 0; i < W * H; i++) {
        const r = d[4 * i], g = d[4 * i + 1], b = d[4 * i + 2], [hh, s, v] = CK.hsv(r, g, b);
        if (z[i] === 1) sky.push(0.299 * r + 0.587 * g + 0.114 * b);
        else if (z[i] === 2) { nube++; if (s > 0.35 && v > 0.25) { nubeSat++; hues[Math.floor(hh / 30) % 12]++; } }
        else if (z[i] === 3 && s > 0.35 && v > 0.2) { prado.n++; if (hh > 80 && hh < 160) prado.green++; }
      }
      // las chispas del prado se cuentan grano a grano: cada grano es un máximo local de luz
      const L = CK.lumaOf(out);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, l = L[i];
        if (z[i] !== 3 || l < 40 || l < L[i - 1] || l < L[i + 1] || l < L[i - W] || l < L[i + W] || l < L[i - W - 1] || l < L[i - W + 1] || l < L[i + W - 1] || l < L[i + W + 1]) continue;
        const [hh, s] = CK.hsv(d[4 * i], d[4 * i + 1], d[4 * i + 2]);
        if (s < 0.3) continue;
        prado.granos = (prado.granos || 0) + 1;
        if (hh < 50 || hh > 345) prado.warm++;
      }
      const mean = sky.reduce((a, x) => a + x, 0) / sky.length, sd = Math.sqrt(sky.reduce((a, x) => a + (x - mean) ** 2, 0) / sky.length);
      const share = hues.map(x => +(x / Math.max(1, nubeSat)).toFixed(3));
      return { cielo: { n: sky.length, media: +mean.toFixed(1), desv: +sd.toFixed(2) }, nube: { n: nube, conColor: +(nubeSat / nube).toFixed(2), matices: share, sectores: share.filter(x => x >= 0.02).length, mayor: Math.max(...share) },
        prado: { n: prado.n, verde: +(prado.green / prado.n).toFixed(3), granos: prado.granos, calidas: +(prado.warm / prado.granos).toFixed(3) }, img: out.toDataURL('image/png') };
    });
    if (shots) saveDataUrl(path.join(shots, 'chispa-zonas.png'), zonas.img); delete zonas.img;
    assert.ok(zonas.cielo.n > 20000 && zonas.cielo.desv < 2.5, 'el cielo oscuro queda liso: ' + JSON.stringify(zonas.cielo));
    // (repartidos como en la referencia: mucho naranja y azul, poco verde; ella tiene 10 de 12 tramos por encima del 2 %)
    assert.ok(zonas.nube.conColor > 0.3 && zonas.nube.sectores >= 9 && zonas.nube.mayor < 0.25, 'la nube clara y sin color sale con matices por todo el círculo: ' + JSON.stringify(zonas.nube));
    assert.ok(zonas.prado.verde > 0.6, 'el prado conserva su matiz: ' + JSON.stringify(zonas.prado));
    // (la misma cuenta, grano a grano, sobre el prado de la referencia da 6,3 % de chispas cálidas)
    assert.ok(zonas.prado.calidas > 0.03 && zonas.prado.calidas < 0.16, 'el prado lleva chispas cálidas sueltas, como la referencia (6,3 %): ' + JSON.stringify(zonas.prado));
    step('zonas: cielo liso, nube arcoíris, prado verde con chispas cálidas', zonas);

    // ── 1a · LENTEJA contra la referencia (lámina con su composición): el reparto de matices de
    //         las nubes, su saturación y sus platas, su luz (media y percentiles 10/50/90/95, puntos
    //         casi negros), las estrellitas naranjas del prado y el borde sin contorno. Los números de
    //         la referencia salen de su recorte (efectos-hoja-4, 448 × 448).
    const REF = { matices: [0.177, 0.155, 0.06, 0.023, 0.011, 0.029, 0.074, 0.197, 0.119, 0.044, 0.044, 0.067], saturacion: 0.41, blancos: 0.115, naranjasPrado: 32, luz: { media: 118, p: [83, 118, 154, 166], oscuros: 0.001 } };
    const lamina = await page.evaluate(REF => {
      const W = 540, H = 540, src = CK.scene('brillo', W, H, 0), sd = CK.px(src);
      const { out } = CK.run('brillo', 'LENTEJA', W, H, { frames: 8, src }), d = CK.px(out), L = CK.lumaOf(out);
      const kind = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) { const r = sd[4 * i], g = sd[4 * i + 1], b = sd[4 * i + 2]; kind[i] = r > 150 && g > 150 && b > 150 ? 1 : b > r * 2 && b > g * 1.5 ? 2 : g > r * 1.3 && g > b * 1.3 ? 3 : 0; }
      const dist = (i, k, rad) => { const x = i % W, y = (i / W) | 0; for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && kind[yy * W + xx] === k) return true; } return false; };
      const hues = new Array(12).fill(0); let n = 0, sat = 0, white = 0, cnt = 0;
      for (let i = 0; i < W * H; i += 2) {
        if (kind[i] !== 1 || dist(i, 2, 4) || dist(i, 3, 4)) continue;
        const [h, sv, v] = CK.hsv(d[4 * i], d[4 * i + 1], d[4 * i + 2]); cnt++;
        if (sv < 0.2 && v > 0.55) white++;
        if (sv > 0.25 && v > 0.25) { n++; sat += sv; hues[Math.floor(h / 30) % 12]++; }
      }
      const matices = hues.map(x => x / n), l1 = matices.reduce((a, x, k) => a + Math.abs(x - REF.matices[k]), 0);
      const lums = []; for (let i = 0; i < W * H; i += 2) if (kind[i] === 1 && !dist(i, 2, 4) && !dist(i, 3, 4)) lums.push(L[i]);
      lums.sort((p, q) => p - q);
      const luz = { media: Math.round(lums.reduce((a, x) => a + x, 0) / lums.length), p: [0.1, 0.5, 0.9, 0.95].map(q => Math.round(lums[Math.floor(q * (lums.length - 1))])), oscuros: +(lums.filter(v => v < 40).length / lums.length).toFixed(3) };
      // el borde: en el cielo, un anillo de 1 a 3 px junto a la nube frente a otro de 9 a 12 px
      // (medianas: los granos que se salen son sueltos y no la mueven; un contorno, sí)
      // (y restando lo que ya trae la escena: su borde suave ya aclara el cielo junto a la nube)
      // tres anillos en el cielo (1–3, 4–6 y 10–14 px de la nube): un resplandor cae poco a poco;
      // un contorno sería una raya clara en el primero que se corta en el segundo
      const L0 = CK.lumaOf(src), rings = [[], [], []], rings0 = [[], [], []]; let spill = 0;
      for (let i = 0; i < W * H; i += 1) {
        if (kind[i] !== 2) continue;
        const k = dist(i, 1, 3) ? 0 : dist(i, 1, 6) ? 1 : dist(i, 1, 14) && !dist(i, 1, 9) ? 2 : -1;
        if (k < 0) continue;
        rings[k].push(L[i]); rings0[k].push(L0[i]);
        if (k === 0 && L[i] > L0[i] + 40) spill++;
      }
      const med = a => a.sort((p, q) => p - q)[a.length >> 1], ring = rings.map((r, k) => med(r) - med(rings0[k])), near = ring[0], far = ring[2], nn = rings[0].length;
      // las estrellitas naranjas del prado (sus centros, con el modo de depuración)
      const { kept } = CK.run('brillo', 'LENTEJA', W, H, { frames: 30, src, opts: { debug: 'estrellitas' }, keep: [9, 19, 29] });
      const stars = Object.values(kept).map(c => CK.blobs(c));
      return { matices: matices.map(x => +x.toFixed(3)), distanciaMatices: +l1.toFixed(3), luz, saturacion: +(sat / n).toFixed(2), blancos: +(white / cnt).toFixed(3),
        borde: { anillos: ring.map(v => +v.toFixed(1)), granosFuera: +(spill / nn).toFixed(3) }, estrellitasPrado: stars, img: out.toDataURL('image/png') };
    }, REF);
    if (shots) saveDataUrl(path.join(shots, 'chispa-lamina-brillo.png'), lamina.img); delete lamina.img;
    assert.ok(lamina.distanciaMatices < 0.2, 'el reparto de matices de las nubes es el de la referencia (distancia L1 sobre doce tramos): ' + JSON.stringify(lamina));
    assert.ok(Math.abs(lamina.saturacion - REF.saturacion) < 0.08 && lamina.blancos > 0.05 && lamina.blancos < 0.22, 'saturación y platas como la referencia (' + REF.saturacion + ', ' + REF.blancos + '): ' + JSON.stringify(lamina));
    const lp = lamina.luz.p;
    assert.ok(Math.abs(lamina.luz.media - REF.luz.media) < 15 && lp.every((v, k) => Math.abs(v - REF.luz.p[k]) < 20) && lamina.luz.oscuros < 0.02, 'la nube tiene la luz de la referencia (media y percentiles 10/50/90/95; casi nada negro): ' + JSON.stringify(lamina.luz));
    const [r1, r2, r3] = lamina.borde.anillos;
    assert.ok(r2 >= 0.35 * r1 && r3 < r1 && lamina.borde.granosFuera > 0.02, 'el borde no tiene contorno: la luz se sale y cae poco a poco, y algunos granos se salen: ' + JSON.stringify(lamina.borde));
    assert.ok(Math.min(...lamina.estrellitasPrado) >= 25, 'el prado suelta decenas de estrellitas naranjas (la referencia: ' + REF.naranjasPrado + ' en su recorte): ' + JSON.stringify(lamina.estrellitasPrado));
    step('LENTEJA contra la referencia', { ...lamina, referencia: REF });

    // ── 1b · La compuerta va contra la escena: en un interior claro y sin color queda lisa la
    //         mitad más oscura (y umbral sigue mandando: 0 todo brilla, alto solo lo más claro) ──
    const relativo = await page.evaluate(() => {
      const W = 540, H = 960, out = {};
      // (lisa: donde la compuerta no deja poner granos; se lee con el modo de depuración «compuerta»)
      const frac = (name, opts, w = W, h = H) => {
        const src = CK.scene(name, w, h, 0), { out: o } = CK.run(name, 'LENTEJA', w, h, { frames: 4, src, opts: { ...opts, debug: 'compuerta' } }), d = CK.px(o), L = CK.lumaOf(src);
        let n = 0, ls = 0, lg = 0;
        for (let i = 0; i < L.length; i++) { if (d[4 * i] < 13) { n++; ls += L[i]; } else lg += L[i]; }
        const m = { length: L.length };
        return { lisa: +(n / m.length).toFixed(3), luzLisa: Math.round(ls / Math.max(1, n)), luzBrilla: Math.round(lg / Math.max(1, m.length - n)), umbralEscena: flipChispa._umbral().thr };
      };
      for (const name of ['ventana', 'cuarto']) out[name] = frac(name, {});
      out.cuartoApaisado = frac('cuarto', {}, 1024, 768);
      out.ventanaApaisada = frac('ventana', {}, 1024, 768);
      out.ventanaUmbral0 = frac('ventana', { umbral: 0 });
      out.ventanaUmbralAlto = frac('ventana', { umbral: 0.65 });
      return out;
    });
    // (la compuerta se pega al salto de luz más cercano a la mitad: una pared entera queda dentro o
    // fuera; por eso lo liso va de casi la mitad a cuatro quintos según dónde caiga la pared)
    for (const name of ['ventana', 'cuarto', 'cuartoApaisado', 'ventanaApaisada']) assert.ok(relativo[name].lisa >= 0.4 && relativo[name].lisa <= 0.9 && relativo[name].luzLisa < relativo[name].luzBrilla, name + ': queda lisa más o menos la mitad más oscura del cuadro (o algo más), y brilla lo más claro: ' + JSON.stringify(relativo[name]));
    assert.ok(relativo.ventanaUmbral0.lisa < 0.12 && relativo.ventanaUmbralAlto.lisa > 0.85, 'umbral sigue mandando (0: todo brilla; alto: solo lo más claro): ' + JSON.stringify([relativo.ventanaUmbral0, relativo.ventanaUmbralAlto]));
    step('compuerta relativa a la escena', relativo);

    // ── 1c · …y se sigue despacio: un corte de escena no la hace saltar de golpe ──
    const despacio = await page.evaluate(() => {
      const W = 540, H = 960, a = CK.scene('nubes', W, H, 0), b = CK.scene('ventana', W, H, 0), c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'), seq = [];
      for (let i = 0; i < 90; i++) { renderChispa(i < 30 ? a : b, W, H, ctx, false, 'LENTEJA', { now: 700000 + i * 33.333 }); seq.push(flipChispa._umbral().thr); }
      const v0 = seq[29], v1 = seq[89], jump = Math.abs(v1 - v0);
      let maxStep = 0; for (let i = 31; i < 90; i++) maxStep = Math.max(maxStep, Math.abs(seq[i] - seq[i - 1]));
      return { antes: v0, despues: v1, salto: +jump.toFixed(3), primerPaso: +(Math.abs(seq[34] - v0) / jump).toFixed(2), alSegundo: +(Math.abs(seq[60] - v0) / jump).toFixed(2), mayorPaso: +(maxStep / jump).toFixed(2) };
    });
    assert.ok(despacio.salto > 0.08 && despacio.primerPaso < 0.5 && despacio.mayorPaso < 0.35 && despacio.alSegundo > 0.85, 'el umbral de la escena se sigue despacio, sin saltos: ' + JSON.stringify(despacio));
    step('compuerta suavizada en el tiempo', despacio);

    // ── 1d · La piel: iluminador, no costra (poco de la cara cubierto por granos encendidos) ──
    const piel = await page.evaluate(() => {
      const W = 540, H = 960, src = CK.scene('retrato', W, H, 0), sd = CK.px(src), L0 = CK.lumaOf(src), face = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) { const [hh, s, v] = CK.hsv(sd[4 * i], sd[4 * i + 1], sd[4 * i + 2]); face[i] = hh > 8 && hh < 42 && s > 0.25 && s < 0.65 && v > 0.45 ? 1 : 0; }
      const inside = i => { const x = i % W, y = (i / W) | 0; if (x < 10 || y < 10 || x > W - 11 || y > H - 11) return false; for (const d of [10, -10, 10 * W, -10 * W]) if (!face[i + d]) return false; return true; };
      const shots = [];
      for (const t of [0, 7, 15]) {
        const { out } = CK.run('retrato', 'LENTEJA', W, H, { frames: 3, src, start: 760000 + t * 333 }), L = CK.lumaOf(out);
        let n = 0, changed = 0, lit = 0;
        for (let i = 0; i < W * H; i += 2) if (face[i] && inside(i)) { n++; const d = L[i] - L0[i]; if (Math.abs(d) > 20) changed++; if (d > 25) lit++; }
        shots.push({ cambiada: +(changed / n).toFixed(3), encendida: +(lit / n).toFixed(3) });
      }
      return { n: shots.length, instantes: shots, peor: Math.max(...shots.map(x => x.encendida)), cambiadaMax: Math.max(...shots.map(x => x.cambiada)) };
    });
    assert.ok(piel.peor <= 0.4 && piel.peor >= 0.02, 'en un retrato, la cara cubierta por granos encendidos no pasa del 40 % (y algo brilla): ' + JSON.stringify(piel));
    step('piel: iluminador, no costra', piel);

    // ── 2 · Cruces: pocas a la vez ──
    const cruces = await page.evaluate(() => {
      const counts = [];
      const { kept } = CK.run('nubes', 'LENTEJA', 540, 960, { frames: 60, opts: { debug: 'cruces' }, keep: [6, 12, 18, 24, 30, 36, 42, 48, 54, 59] });
      for (const c of Object.values(kept)) counts.push(CK.blobs(c));
      return { counts, media: +(counts.reduce((a, x) => a + x, 0) / counts.length).toFixed(1) };
    });
    assert.ok(cruces.media >= 15 && cruces.media <= 35 && Math.max(...cruces.counts) <= 50, 'las cruces van de 15 a 35 a la vez: ' + JSON.stringify(cruces));
    step('cruces «+» escasas', cruces);

    // ── 3 · Pulso: dura lo que su pulso; LENTEJA a saltos, MAREA continuo; no es estática ──
    const pulso = await page.evaluate(() => {
      const W = 540, H = 960, src = CK.scene('nubes', W, H, 0);
      const changes = variant => {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        let prev = null, n = 0;
        for (let i = 0; i < 61; i++) {
          renderChispa(src, W, H, ctx, false, variant, { now: 50000 + i * 33.333 });
          const d = ctx.getImageData(0, 0, W, H).data;
          if (prev) { let diff = 0; for (let k = 0; k < d.length; k += 16) diff += d[k] !== prev[k] || d[k + 1] !== prev[k + 1]; if (diff > 20) n++; }
          prev = d;
        }
        return n;
      };
      const lenteja = changes('LENTEJA'), marea = changes('MAREA');
      // encendidos: el pulso de cada grano, cuadro a cuadro, en 400 puntos de la nube
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const z = CK.zones(src, 6), pts = [];
      for (let i = 0; i < W * H && pts.length < 400; i += 997) if (z[i] === 2) pts.push(i);
      const seq = pts.map(() => []);
      for (let i = 0; i < 90; i++) {
        renderChispa(src, W, H, ctx, false, 'LENTEJA', { now: 90000 + i * 33.333, debug: 'pulso' });
        const d = ctx.getImageData(0, 0, W, H).data;
        pts.forEach((p, k) => seq[k].push(d[4 * p] / 255));
      }
      const runs = []; let on = 0, total = 0;
      for (const s of seq) { let r = 0; for (const v of s) { total++; if (v > 0.25) { on++; r++; } else if (r) { runs.push(r); r = 0; } } }
      runs.sort((a, b) => a - b);
      // estática: autocorrelación del campo de destellos a un píxel y de un paso al siguiente,
      // en la brillantina y en ruido de televisión de verdad (la misma medida tiene que fallar)
      const field = (variant, now) => { renderChispa(src, W, H, ctx, false, variant, { now }); return CK.highpass(CK.lumaOf(c), W, H); };
      const zoneIdx = []; for (let i = 0; i < W * H; i += 3) if (z[i] === 2 && (i % W) < W - 2) zoneIdx.push(i);
      const lag1 = F => CK.corr(zoneIdx.map(i => F[i]), zoneIdx.map(i => F[i + 1]));
      const tcorr = (A, B) => CK.corr(zoneIdx.map(i => A[i]), zoneIdx.map(i => B[i]));
      const a = field('LENTEJA', 200000), b = field('LENTEJA', 200000 + 112);
      const tv = () => { const n = document.createElement('canvas'); n.width = W; n.height = H; const g = n.getContext('2d'); const im = g.createImageData(W, H); for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); return CK.highpass(CK.lumaOf(n), W, H); };
      const tv1 = tv(), tv2 = tv();
      return { cambiosPorSegundo: { LENTEJA: +(lenteja / 2).toFixed(1), MAREA: +(marea / 2).toFixed(1) },
        encendido: { fraccion: +(on / total).toFixed(3), mediana: runs[runs.length >> 1], tramos: runs.length },
        estatica: { brillantina: { vecino: +lag1(a).toFixed(2), siguientePaso: +tcorr(a, b).toFixed(2) }, televisión: { vecino: +lag1(tv1).toFixed(2), siguientePaso: +tcorr(tv1, tv2).toFixed(2) } } };
    });
    assert.ok(pulso.cambiosPorSegundo.LENTEJA >= 7.5 && pulso.cambiosPorSegundo.LENTEJA <= 10.5, 'LENTEJA avanza a saltos de ~9 por segundo: ' + JSON.stringify(pulso.cambiosPorSegundo));
    assert.ok(pulso.cambiosPorSegundo.MAREA >= 28, 'MAREA avanza en continuo (cambia en cada cuadro): ' + JSON.stringify(pulso.cambiosPorSegundo));
    assert.ok(pulso.encendido.mediana >= 3 && pulso.encendido.mediana <= 12 && pulso.encendido.fraccion > 0.08 && pulso.encendido.fraccion < 0.3, 'un grano dura encendido lo que su pulso (de 100 a 400 ms), no un cuadro: ' + JSON.stringify(pulso.encendido));
    const est = pulso.estatica, isStatic = m => m.vecino < 0.3 || m.siguientePaso < 0.35;
    assert.ok(isStatic(est.televisión), 'la medida de estática reconoce el ruido de televisión: ' + JSON.stringify(est.televisión));
    assert.ok(!isStatic(est.brillantina), 'la brillantina NO es estática: granos de más de un píxel que siguen ahí al paso siguiente: ' + JSON.stringify(est));
    step('pulso: a saltos (LENTEJA) o continuo (MAREA), dura lo que dura, y no es estática', pulso);

    // ── 4 · Anclaje: los granos viajan con la imagen ──
    const anclaje = await page.evaluate(() => {
      const W = 1024, H = 576, N = 3, out = {};
      for (const [name, opts] of [['pegado', { anclaje: 1 }], ['fabrica', {}], ['pantalla', { anclaje: 0 }]]) {
        const { kept } = CK.run('textura', 'LENTEJA', W, H, { frames: 15, shift: N, start: 300000, keep: [10, 14], opts: { debug: 'facetas', ...opts } });
        const A = CK.lumaOf(kept[10]), B = CK.lumaOf(kept[14]);
        let best = -1, at = 0;
        const curve = {};
        for (let s = -2; s <= 18; s++) { const c = CK.shiftCorr(A, B, W, H, -s); curve[s] = +c.toFixed(2); if (c > best) { best = c; at = s; } }
        // (el patrón se mueve hacia la izquierda, como la escena: s es cuánto)
        out[name] = { mejor: at, corr: +best.toFixed(2), quieto: curve[0], esperado: name === 'pantalla' ? 0 : 4 * N * (opts.anclaje ?? flipChispa.FABRICA.LENTEJA.anclaje), flujo: name === 'pantalla' ? null : flipChispa._flow() };
      }
      return out;
    });
    const fl = anclaje.pegado.flujo;
    assert.ok(Math.abs(fl.vx + 3) < 0.6 && Math.abs(fl.vy) < 0.5, 'el flujo medido es el desplazamiento real (−3 px por cuadro): ' + JSON.stringify(fl));
    assert.ok(Math.abs(anclaje.pegado.mejor - 12) <= 1 && anclaje.pegado.corr > 0.6 && anclaje.pegado.quieto < 0.25, 'con anclaje 1 el patrón se desplaza con la escena: ' + JSON.stringify(anclaje.pegado));
    assert.ok(Math.abs(anclaje.fabrica.mejor - anclaje.fabrica.esperado) <= 1.5 && anclaje.fabrica.corr > 0.45, 'de fábrica (0,85) viaja al 85 %: ' + JSON.stringify(anclaje.fabrica));
    assert.ok(anclaje.pantalla.mejor === 0 && anclaje.pantalla.quieto > 0.8, 'con anclaje 0 se queda pegado a la pantalla: ' + JSON.stringify(anclaje.pantalla));
    step('anclaje: los granos viajan con la escena', anclaje);

    // ── 4b · Movimiento desigual (una mano que saluda delante de la pared): arrastrar el anclaje
    //         lo cizalla; los granos no se vuelven remolinos ni rayas. Se mide sobre el mapa de
    //         granos (cada grano, un gris) la coherencia local (cuánto se alinea el detalle en una
    //         dirección): granos sueltos ≈ la de la pared quieta; un remolino la sube.
    const cizalla = await page.evaluate(() => {
      const W = 540, H = 720, src = document.createElement('canvas'); src.width = 960; src.height = 1280;
      const g = src.getContext('2d'), c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const map = document.createElement('canvas'); map.width = W; map.height = H;
      const mctx = map.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i < 75; i++) {
        FlipScenes.draw(g, 960, 1280, 'roomLit', i / 30);
        renderChispa(src, 960, 1280, mctx, false, 'LENTEJA', { now: 500000 + i * 33.333, debug: 'facetas' });
      }
      // (y la imagen de verdad, para mirarla: mismo recorrido)
      for (let i = 0; i < 75; i++) { FlipScenes.draw(g, 960, 1280, 'roomLit', i / 30); renderChispa(src, 960, 1280, ctx, false, 'LENTEJA', { now: 600000 + i * 33.333 }); }
      const L = CK.lumaOf(map);
      const coh = (fx0, fy0, fx1, fy1) => {
        let sum = 0, n = 0;
        for (let y0 = Math.round(fy0 * H); y0 < fy1 * H - 12; y0 += 12) for (let x0 = Math.round(fx0 * W); x0 < fx1 * W - 12; x0 += 12) {
          let xx = 0, yy = 0, xy = 0;
          for (let y = y0; y < y0 + 12; y++) for (let x = x0; x < x0 + 12; x++) { const i = y * W + x, gx = L[i + 1] - L[i - 1], gy = L[i + W] - L[i - W]; xx += gx * gx; yy += gy * gy; xy += gx * gy; }
          sum += Math.sqrt((xx - yy) ** 2 + 4 * xy * xy) / (xx + yy + 1e-6); n++;
        }
        return +(sum / n).toFixed(3);
      };
      return { mano: coh(0.5, 0.42, 0.87, 0.78), pared: coh(0.04, 0.3, 0.37, 0.58), img: c.toDataURL('image/png') };
    });
    if (shots) saveDataUrl(path.join(shots, 'chispa-mano.png'), cizalla.img); delete cizalla.img;
    assert.ok(cizalla.mano < cizalla.pared * 1.3 + 0.02, 'con una mano que saluda, los granos siguen sueltos (sin remolinos ni rayas): ' + JSON.stringify(cizalla));
    step('movimiento desigual sin remolinos', cizalla);

    // ── 5 · MAREA: destellos en las crestas, no en lo plano ──
    const crestas = await page.evaluate(() => {
      const W = 1024, H = 576, src = CK.scene('mar', W, H, 0), sd = CK.px(src);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const seen = new Uint8Array(W * H);
      for (let i = 0; i < 45; i++) {
        renderChispa(src, W, H, ctx, false, 'MAREA', { now: 400000 + i * 33.333, debug: 'destellos' });
        const d = ctx.getImageData(0, 0, W, H).data;
        for (let k = 0; k < W * H; k++) if (d[4 * k] + d[4 * k + 1] + d[4 * k + 2] > 180) seen[k] = 1;
      }
      // crestas: las líneas de espuma del mar (± 3 px); plano: el mar a más de 10 px de una línea; la luna por dentro
      const line = new Uint8Array(W * H), moon = new Uint8Array(W * H);
      for (let k = 0; k < W * H; k++) { const r = sd[4 * k], g = sd[4 * k + 1], b = sd[4 * k + 2], y = (k / W) | 0; if (y > H * 0.57 && b > 150 && g > 150) line[k] = 1; if (r === 184 && g === 196 && b === 204) moon[k] = 1; }
      const near = (mask, k, r) => { const x = k % W, y = (k / W) | 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && mask[yy * W + xx]) return true; } return false; };
      const st = { cresta: [0, 0], plano: [0, 0], luna: [0, 0] };
      for (let k = 0; k < W * H; k += 3) {
        const y = (k / W) | 0, x = k % W;
        if (x < 20 || x > W - 20) continue;
        if (y > H * 0.62 && y < H * 0.97) { if (near(line, k, 3)) { st.cresta[0]++; st.cresta[1] += seen[k]; } else if (!near(line, k, 10)) { st.plano[0]++; st.plano[1] += seen[k]; } }
        if (moon[k] && (() => { for (const [dx, dy] of [[14, 0], [-14, 0], [0, 14], [0, -14]]) if (!moon[k + dy * W + dx]) return false; return true; })()) { st.luna[0]++; st.luna[1] += seen[k]; }
      }
      const f = ([n, s]) => +(s / Math.max(1, n)).toFixed(4);
      return { cresta: f(st.cresta), plano: f(st.plano), luna: f(st.luna), n: st };
    });
    assert.ok(crestas.cresta > 0.08 && crestas.cresta > 8 * crestas.plano && crestas.luna < 0.01, 'MAREA pone los destellos en las crestas y no en lo plano: ' + JSON.stringify(crestas));
    step('MAREA: destellos sobre las crestas', crestas);

    // ── 5b · MAREA: campos de destellos sueltos en lo claro con textura, con el color de la zona;
    //         y la base de noche oscura pero saturada ──
    const campos = await page.evaluate(() => {
      const W = 540, H = 960, src = CK.scene('jardin', W, H, 0), sd = CK.px(src);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const seen = new Uint8Array(W * H), rs = new Float32Array(W * H), bs = new Float32Array(W * H);
      for (let i = 0; i < 45; i++) {
        renderChispa(src, W, H, ctx, false, 'MAREA', { now: 800000 + i * 33.333, debug: 'destellos' });
        const d = ctx.getImageData(0, 0, W, H).data;
        for (let k = 0; k < W * H; k++) { const s = d[4 * k] + d[4 * k + 1] + d[4 * k + 2]; if (s > 180) { seen[k] = 1; rs[k] += d[4 * k]; bs[k] += d[4 * k + 2]; } }
      }
      const zone = { flores: [0, 0, 0, 0], espuma: [0, 0, 0, 0], luna: [0, 0, 0, 0] };
      const kind = k => { const r = sd[4 * k], g = sd[4 * k + 1], b = sd[4 * k + 2], y = (k / W) | 0; return r === 184 && g === 196 && b === 204 ? 'luna' : y > H * 0.66 && y < H * 0.97 ? 'flores' : y > H * 0.47 && y < H * 0.6 ? 'espuma' : null; };
      for (let k = 0; k < W * H; k += 2) {
        const x = k % W; if (x < 16 || x > W - 16) continue;
        const z = kind(k); if (!z) continue;
        if (z === 'luna' && [14, -14, 14 * W, -14 * W].some(d => kind(k + d) !== 'luna')) continue;
        zone[z][0]++; zone[z][1] += seen[k]; if (seen[k]) { zone[z][2] += rs[k]; zone[z][3] += bs[k]; }
      }
      const f = ([n, s, r, b]) => ({ destellos: +(s / Math.max(1, n)).toFixed(3), rojoMenosAzul: s ? Math.round((r - b) / s) : 0 });
      // saturación de la base: la cara del retrato y las flores, antes y después
      const sat = (name, sel) => {
        const s2 = CK.scene(name, W, H, 0), a = CK.px(s2), { out } = CK.run(name, 'MAREA', W, H, { frames: 3, src: s2, start: 820000 }), b = CK.px(out);
        let n = 0, sa = 0, sb = 0, la = 0, lb = 0;
        for (let i = 0; i < W * H; i += 3) { const [hh, s, v] = CK.hsv(a[4 * i], a[4 * i + 1], a[4 * i + 2]); if (!sel(hh, s, v, i)) continue; n++; sa += s; la += v; const [, s3, v3] = CK.hsv(b[4 * i], b[4 * i + 1], b[4 * i + 2]); sb += s3; lb += v3; }
        return { saturacion: [+(sa / n).toFixed(2), +(sb / n).toFixed(2)], luz: [+(la / n).toFixed(2), +(lb / n).toFixed(2)] };
      };
      return { flores: f(zone.flores), espuma: f(zone.espuma), luna: f(zone.luna),
        base: { cara: sat('retrato', (h, s, v) => h > 8 && h < 42 && s > 0.25 && s < 0.65 && v > 0.45), flores: sat('jardin', (h, s, v, i) => ((i / W) | 0) > H * 0.66 && s > 0.3 && v > 0.5) } };
    });
    assert.ok(campos.flores.destellos > 0.04 && campos.espuma.destellos > 0.04 && campos.luna.destellos < 0.01, 'MAREA siembra destellos sueltos en lo claro con textura y no en lo liso: ' + JSON.stringify(campos));
    assert.ok(campos.flores.rojoMenosAzul > 10 && campos.espuma.rojoMenosAzul < -10, 'los destellos toman el color de su zona (rosados en las flores, cian en la espuma): ' + JSON.stringify(campos));
    for (const [k, v] of Object.entries(campos.base)) assert.ok(v.saturacion[1] >= v.saturacion[0] * 0.9 && v.luz[1] <= v.luz[0] * 0.9, 'la noche oscurece sin lavar el color (' + k + '): ' + JSON.stringify(v));
    step('MAREA: campos de destellos con color y noche saturada', campos);

    // ── 5c · MAREA contra la referencia (lámina nocturna): la base a bloques de baja resolución,
    //         y sobre la ola los destellos son rayitas a lo largo de la cresta (más alineadas que
    //         los de las flores) ──
    const nocturna = await page.evaluate(() => {
      const W = 624, H = 448, src = CK.scene('nocturno', W, H, 0);
      const { out } = CK.run('nocturno', 'MAREA', W, H, { frames: 6, src }), L = CK.lumaOf(out);
      // bloques: en el cielo (sin destellos), la luz no cambia dentro de cada bloque
      const B = Math.max(2, Math.round(Math.sqrt(W * H) * 0.011));
      let inside = 0, n = 0;
      for (let by = 0; by < Math.floor(H * 0.04 / B) + 1; by++) for (let bx = 0; bx < Math.floor(W / B); bx++) {
        let s = 0, s2 = 0, c = 0;
        for (let y = by * B; y < by * B + B && y < H; y++) for (let x = bx * B; x < bx * B + B; x++) { const v = L[y * W + x]; s += v; s2 += v * v; c++; }
        inside += Math.sqrt(Math.max(0, s2 / c - (s / c) ** 2)); n++;
      }
      // rayitas: coherencia local del mapa de destellos (acumulado) en la ola y en las flores
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true }), acc = new Float32Array(W * H);
      for (let i = 0; i < 20; i++) { renderChispa(src, W, H, ctx, false, 'MAREA', { now: 880000 + i * 33.333, debug: 'destellos' }); const d = CK.lumaOf(c); for (let k = 0; k < acc.length; k++) acc[k] = Math.max(acc[k], d[k]); }
      const coh = (x0, y0, x1, y1) => { let sum = 0, m = 0; for (let yy = y0; yy < y1 - 12; yy += 12) for (let xx = x0; xx < x1 - 12; xx += 12) { let a = 0, b = 0, e = 0, en = 0; for (let y = yy; y < yy + 12; y++) for (let x = xx; x < xx + 12; x++) { const i = y * W + x, gx = acc[i + 1] - acc[i - 1], gy = acc[i + W] - acc[i - W]; a += gx * gx; b += gy * gy; e += gx * gy; en += acc[i]; } if (en < 12 * 12 * 8) continue; sum += Math.sqrt((a - b) ** 2 + 4 * e * e) / (a + b + 1e-6); m++; } return { coherencia: +(sum / Math.max(1, m)).toFixed(3), ventanas: m }; };
      return { bloque: B, dentroDelBloque: +(inside / n).toFixed(2), ola: coh(Math.round(W * 0.45), Math.round(H * 0.55), Math.round(W * 0.95), Math.round(H * 0.72)), flores: coh(Math.round(W * 0.05), Math.round(H * 0.85), Math.round(W * 0.6), H - 2), img: out.toDataURL('image/png') };
    });
    if (shots) saveDataUrl(path.join(shots, 'chispa-lamina-nocturno.png'), nocturna.img); delete nocturna.img;
    assert.ok(nocturna.bloque >= 5 && nocturna.dentroDelBloque < 1.5, 'la base de MAREA va a bloques de baja resolución: ' + JSON.stringify(nocturna));
    assert.ok(nocturna.ola.ventanas > 4 && nocturna.ola.coherencia > nocturna.flores.coherencia + 0.05, 'sobre la ola los destellos son rayitas alineadas con la cresta: ' + JSON.stringify(nocturna));
    step('MAREA contra la referencia: bloques y rayitas', nocturna);

    // ── 6 · Tamaño relativo: la foto grande es el visor ampliado ──
    const tam = await page.evaluate(() => {
      const r = (W, H) => CK.runLength(CK.run('nubes', 'LENTEJA', W, H, { frames: 2, opts: { debug: 'facetas', path: 'capture' } }).out);
      const a = r(540, 960), b = r(1080, 1920);
      return { visor: +a.toFixed(2), doble: +b.toFixed(2), razon: +(b / a).toFixed(2) };
    });
    assert.ok(tam.razon > 1.7 && tam.razon < 2.3 && tam.visor >= 2.2, 'en la foto al doble los granos miden el doble (mismo tamaño relativo): ' + JSON.stringify(tam));
    step('tamaño relativo', tam);

    // ── 7 · Persona: con la máscara, brillantina solo en la persona (o solo detrás) ──
    const persona = await page.evaluate(() => {
      const W = 512, H = 288, src = CK.scene('nubes', W, H, 0);
      const mask = { data: new Float32Array(64 * 36), width: 64, height: 36 };
      for (let y = 0; y < 36; y++) for (let x = 0; x < 32; x++) mask.data[y * 64 + x] = 1;     // la «persona» es la mitad izquierda
      const sat = (opts) => {
        const { out } = CK.run('nubes', 'LENTEJA', W, H, { frames: 3, src, opts });
        const d = CK.px(out), z = CK.zones(src, 8); let l = [0, 0], r = [0, 0];
        for (let i = 0; i < W * H; i++) if (z[i] === 2) { const [, s] = CK.hsv(d[4 * i], d[4 * i + 1], d[4 * i + 2]); const side = (i % W) < W / 2 - 20 ? l : (i % W) > W / 2 + 20 ? r : null; if (side) { side[0]++; side[1] += s > 0.35; } }
        return [+(l[1] / l[0]).toFixed(2), +(r[1] / r[0]).toFixed(2)];
      };
      return { persona: sat({ mask, persona: 'PERSONA' }), fondo: sat({ mask, persona: 'FONDO' }), estado: flipChispa.state().persona };
    });
    assert.ok(persona.persona[0] > 0.2 && persona.persona[1] < 0.05 && persona.fondo[0] < 0.05 && persona.fondo[1] > 0.2, 'PERSONA: brillantina solo en la persona; FONDO: solo detrás: ' + JSON.stringify(persona));
    step('persona', persona);

    // ── 7b · El espejo es espejo ──
    const espejo = await page.evaluate(() => {
      const W = 512, H = 288, src = CK.scene('nubes', W, H, 0), coarse = (c, flip) => { const L = CK.lumaOf(c), out = []; for (let by = 0; by < H / 16; by++) for (let bx = 0; bx < W / 16; bx++) { let s = 0; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) s += L[(by * 16 + y) * W + (flip ? W - 1 - (bx * 16 + x) : bx * 16 + x)]; out.push(s); } return out; };
      const a = document.createElement('canvas'); a.width = W; a.height = H; renderChispa(src, W, H, a.getContext('2d'), false, 'LENTEJA', { now: 650000 });
      const b = document.createElement('canvas'); b.width = W; b.height = H; renderChispa(src, W, H, b.getContext('2d'), true, 'LENTEJA', { now: 650000 });
      return { espejado: +CK.corr(coarse(b, false), coarse(a, true)).toFixed(3), igual: +CK.corr(coarse(b, false), coarse(a, false)).toFixed(3) };
    });
    assert.ok(espejo.espejado > 0.95 && espejo.igual < 0.9, 'el espejo voltea la imagen: ' + JSON.stringify(espejo));
    step('espejo', espejo);

    // ── 8 · Sonido: el bajo acelera la cadencia; el golpe enciende cruces ──
    const sonido = await page.evaluate(() => {
      const W = 540, H = 960, src = CK.scene('nubes', W, H, 0);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const rate = audio => { let prev = null, n = 0; for (let i = 0; i < 61; i++) { renderChispa(src, W, H, ctx, false, 'LENTEJA', { now: 600000 + i * 33.333, audio }); const d = ctx.getImageData(0, 0, W, H).data; if (prev) { let diff = 0; for (let k = 0; k < d.length; k += 16) diff += d[k] !== prev[k]; if (diff > 20) n++; } prev = d; } return n / 2; };
      const quiet = rate(null), bass = rate({ bass: 1, mid: 0, treble: 0, beat: 0 });
      const stars = beat => { let s = 0; for (let i = 0; i < 12; i++) { renderChispa(src, W, H, ctx, false, 'LENTEJA', { now: 700000 + i * 111.2, debug: 'cruces', audio: { bass: 0, mid: 0, treble: 0, beat } }); s += CK.blobs(c); } return s / 12; };
      return { cadencia: { sin: quiet, bajo: bass }, cruces: { sin: +stars(0).toFixed(1), golpe: +stars(1).toFixed(1) } };
    });
    assert.ok(sonido.cadencia.bajo > sonido.cadencia.sin * 1.4, 'el bajo acelera la cadencia GIF: ' + JSON.stringify(sonido.cadencia));
    assert.ok(sonido.cruces.golpe > sonido.cruces.sin * 1.5, 'el golpe enciende una oleada de cruces: ' + JSON.stringify(sonido.cruces));
    step('sonido', sonido);

    // ── 9 · Costo por cuadro, foto a resolución pedida, soltar y rehacer ──
    const costo = await page.evaluate(() => {
      const out = {};
      for (const [W, H] of [[540, 960], [1024, 576]]) for (const v of ['LENTEJA', 'MAREA']) {
        const src = CK.scene('textura', W, H, 0), c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        for (let i = 0; i < 5; i++) renderChispa(src, W, H, ctx, false, v, { now: 800000 + i * 33.3 });
        ctx.getImageData(0, 0, 1, 1);
        const t0 = performance.now();
        for (let i = 0; i < 40; i++) { CK.scene('textura', W, H, i * 2, src); renderChispa(src, W, H, ctx, false, v, { now: 801000 + i * 33.3 }); }
        ctx.getImageData(0, 0, 1, 1);                       // espera a que la gráfica termine
        out[v + ' ' + W + '×' + H] = +((performance.now() - t0) / 40).toFixed(2);
      }
      const big = document.createElement('canvas'); big.width = 2560; big.height = 1440;
      const okBig = renderChispa(CK.scene('nubes', 1280, 720, 0), 1280, 720, big.getContext('2d'), false, 'LENTEJA', { path: 'capture', outW: 2560, outH: 1440, now: 900000 });
      const before = flipChispa.state().gl;
      flipChispa.release();
      const released = flipChispa.state().gl;
      const again = renderChispa(CK.scene('nubes', 512, 288, 0), 512, 288, document.createElement('canvas').getContext('2d'), false, 'MAREA', { now: 900100 });
      return { msPorCuadro: out, foto2560: okBig, suelta: [before, released, flipChispa.state().gl, again] };
    });
    assert.ok(costo.foto2560, 'pinta una foto de 2560 × 1440');
    assert.deepEqual(costo.suelta, [true, false, true, true], 'la gráfica se suelta y se rehace al volver a pintar');
    assert.ok(Object.values(costo.msPorCuadro).every(ms => ms < 120), 'costo por cuadro razonable: ' + JSON.stringify(costo.msPorCuadro));
    step('costo, foto grande, soltar y rehacer', costo);

    // ── 10 · Hoja de contacto (con --shots): cada tirada sobre cuatro escenas ──
    if (shots) {
      const sheet = await page.evaluate(() => {
        const W = 540, H = 960, names = ['brillo', 'nocturno', 'nubes', 'jardin', 'cuarto', 'ventana', 'retrato'], sheet = document.createElement('canvas');
        sheet.width = W * names.length; sheet.height = H * 3;
        const g = sheet.getContext('2d');
        names.forEach((n, i) => {
          const src = CK.scene(n, W, H, 0);
          g.drawImage(src, i * W, 0);
          g.drawImage(CK.run(n, 'LENTEJA', W, H, { frames: 8, src }).out, i * W, H);
          g.drawImage(CK.run(n, 'MAREA', W, H, { frames: 8, src }).out, i * W, 2 * H);
        });
        return sheet.toDataURL('image/png');
      });
      saveDataUrl(path.join(shots, 'chispa-hoja.png'), sheet);
    }

    // ── 11 · En la app (si ya está registrada): la cámara en el visor y su foto ──
    const wired = await page.evaluate(() => typeof CAM_FAMILIES !== 'undefined' && !!CAM_FAMILIES.CHISPA);
    if (!wired) console.log('· (la app todavía no registra CAM_FAMILIES.CHISPA: el paso dentro de la app queda escrito y sin correr)');
    else {
      const app = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
      await app.page.evaluate(KIT);
      await pickCamera(app.page, 'CHISPA');
      await app.page.waitForFunction(() => camFamily === 'CHISPA' && flipChispa.state().frames > 10, null, { timeout: 15000 });
      await app.page.waitForTimeout(600);
      const visor = await app.page.evaluate(() => {
        const d = CK.px(display), hues = new Array(12).fill(0); let sat = 0;
        for (let i = 0; i < d.length; i += 16) { const [h, s, v] = CK.hsv(d[i], d[i + 1], d[i + 2]); if (s > 0.4 && v > 0.3) { sat++; hues[Math.floor(h / 30) % 12]++; } }
        return { st: flipChispa.state(), color: +(sat / (d.length / 16)).toFixed(3), sectores: hues.filter(x => x > sat * 0.03).length };
      });
      if (shots) await app.page.screenshot({ path: path.join(shots, 'chispa-app.png') });
      assert.ok(visor.st.gl && visor.color > 0.05 && visor.sectores >= 4, 'el visor pinta con CHISPA: ' + JSON.stringify({ color: visor.color, sectores: visor.sectores, ms: visor.st.ms }));
      const [download] = await Promise.all([app.page.waitForEvent('download', { timeout: 20000 }), app.page.locator('#deckShutter').click()]);
      const photo = await app.page.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
        return { size: [bitmap.width, bitmap.height], capture: flipChispa.state().size };
      }, fs.readFileSync(await download.path()).toString('base64'));
      assert.ok(photo.size[0] >= 540, 'la foto sale a su tamaño: ' + JSON.stringify(photo));
      step('en la app: visor y foto con CHISPA', { visor: { color: visor.color, sectores: visor.sectores }, foto: photo });
      assert.deepEqual(app.errors, [], 'sin errores de página en la app: ' + app.errors.join(' | '));
      await app.context.close();
    }

    assert.deepEqual(errors, [], 'sin errores de página: ' + errors.join(' | '));
    console.log('\nCHISPA: todo en orden');
  } finally { await browser.close(); }
})().catch(error => { console.error('\n✗ ' + (error && error.stack || error)); process.exit(1); });
