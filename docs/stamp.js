'use strict';

// STAMP — sello postal calcográfico. Tres capas con origen distinto:
//   grabado    líneas talladas a buril: paralelas, onduladas a mano, que engordan con la
//              sombra, se cruzan en los oscuros y se rompen en rayas cortas en las luces
//   impresión  la tinta rellena el surco: bordes más o menos blandos, velo de plancha,
//              masas llenas cuando hay mucha carga
//   papel      fibra, tono y grano fijos al soporte; el blanco se reserva sin tinta
// La trama es una pantalla de líneas calculada una vez por tamaño: no se mueve con la
// escena y se define en proporción al cuadro, así que una foto en alta conserva la
// misma escala que el visor.
//   ENGR   la plancha: línea fina y limpia, cruzado en sombras, contorno marcado
//   INK    estampa cargada: línea gruesa y rugosa, masas de tinta, velo de plancha
//   ISSUE  el sello emitido: trama fina de ondas paralelas, papel con más tono y dentado
const STAMP_PALETTES = {
  POSTAL: { paper:[234,226,204], fiber:[214,201,176], ink:[58,116,74], deep:[26,63,37], accent:[145,164,111], second:[176,56,40] },
  COBALT: { paper:[238,232,221], fiber:[219,206,190], ink:[56,93,154], deep:[24,44,92], accent:[145,171,212], second:[192,126,26] },
  SEPIA:  { paper:[229,216,194], fiber:[207,190,163], ink:[91,66,45], deep:[44,28,19], accent:[151,118,84], second:[132,38,30] },
  OXIDE:  { paper:[238,221,194], fiber:[215,196,169], ink:[154,83,35], deep:[92,44,18], accent:[214,154,86], second:[38,76,96] },
  NOIR:   { paper:[239,233,223], fiber:[217,208,197], ink:[50,49,45], deep:[16,16,14], accent:[131,126,118], second:[166,30,34] },
};
// lines: líneas principales por alto de imagen · angle/cross/third: dirección de cada pantalla (rad)
// crossAt/thirdAt: sombra a partir de la cual aparece cada cruzado · c1: grosor máximo de la línea
// solid: sombra que se llena de tinta · wobble/wave: pulso de la mano y ondas paralelas
// rough: rotura de la línea fina · soft: nitidez del borde · plate: velo de plancha · contour: perfilado
const STAMP_VARIANTS = {
  ENGR:  { lines:104, angle:-0.26, cross:0.98, third:-1.15, crossAt:0.44, thirdAt:0.72, c1:0.74, solid:2, wobble:0.28, wave:0, rough:30, soft:1, plate:0, contour:1 },
  INK:   { lines:62, angle:0.14, cross:-0.9, third:0, crossAt:0.58, thirdAt:2, c1:0.86, solid:0.8, wobble:0.5, wave:0, rough:54, soft:0.55, plate:12, contour:1.5 },
  ISSUE: { lines:128, angle:0, cross:1.5708, third:0.78, crossAt:0.5, thirdAt:0.8, c1:0.62, solid:2, wobble:0.1, wave:0.42, rough:22, soft:0.9, plate:5, contour:0.6 },
};
const STAMP_GRID_W = 256;
const STAMP_WORK_SCALE = 0.75;
// Márgenes de la ventana de imagen en unidades de sello (u = lado corto / 100): cada diseño
// reserva arriba y abajo el sitio de su rótulo y su valor.
const STAMP_LAYOUT = {
  ENGR:  { l: 9.2, r: 9.2, t: 14.2, b: 13.2 },
  INK:   { l: 8.6, r: 8.6, t: 15.0, b: 12.8 },
  ISSUE: { l: 7.2, r: 7.2, t: 11.6, b: 12.4 },
};

function _getStampCaptureSampleDims() {
  return { sampleW: DSI_W, sampleH: DSI_H };
}
function _getStampPalette() {
  return STAMP_PALETTES[stampPaletteMode] || STAMP_PALETTES.POSTAL;
}
function _stampHash(x, y, seed) {
  let n = Math.imul(x + 11 ^ seed, 0x2c1b3c6d) ^ Math.imul(y + 23 ^ (seed >>> 5), 0x297a2d39);
  n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}
// Ruido suave por interpolación bilineal de una retícula de valores.
function _stampSmooth(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = _stampHash(xi, yi, seed), b = _stampHash(xi + 1, yi, seed);
  const c = _stampHash(xi, yi + 1, seed), d = _stampHash(xi + 1, yi + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

const _stampScreenCache = new Map();
// Tres pantallas de líneas: 0 en el eje de cada línea, 255 a media separación.
function _stampScreens(key, variant, workW, workH, imageH, engrave, seed) {
  const id = [key, workW, workH, imageH, engrave, seed].join(':');
  let screens = _stampScreenCache.get(id);
  if (screens) return screens;
  if (_stampScreenCache.size > 6) _stampScreenCache.clear();
  const pitch = imageH / (variant.lines * (0.72 + engrave * 0.56));
  const make = (angle, spacing, salt, rough) => {
    const out = new Uint8Array(workW * workH);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (let y = 0, p = 0; y < workH; y++) {
      for (let x = 0; x < workW; x++, p++) {
        const along = (x * cos + y * sin) / spacing, across = (-x * sin + y * cos) / spacing;
        // Pulso de la mano: cada línea se desvía despacio; en ISSUE todas ondulan a la vez.
        let q = across + (_stampSmooth(along / 9, across / 5, seed + salt) - 0.5) * variant.wobble * 2;
        if (variant.wave) q += Math.sin(along / 3.4) * variant.wave * 0.5;
        const frac = q - Math.floor(q);
        let s = Math.abs(2 * frac - 1) * 255;
        // La línea fina se rompe en rayas cortas: el buril no deja un trazo continuo en las luces.
        s += (_stampSmooth(along * 1.7, Math.floor(q) * 3.1, seed + salt + 7) - 0.35) * rough;
        out[p] = s < 0 ? 0 : s > 255 ? 255 : s;
      }
    }
    return out;
  };
  screens = {
    pitch,
    s1: make(variant.angle, pitch, 1, variant.rough),
    s2: make(variant.cross, pitch * 1.12, 2, variant.rough * 0.6),
    s3: make(variant.third, pitch * 1.05, 3, variant.rough * 0.5),
  };
  _stampScreenCache.set(id, screens);
  return screens;
}

const _stampPaperCache = new Map();
// Papel fijo al soporte: tono irregular, grano y fibras cortas en coordenadas del cuadro.
function _stampPaper(paletteKey, palette, workW, workH, amount, variantKey, seed) {
  const id = [paletteKey, workW, workH, amount, variantKey, seed].join(':');
  let paper = _stampPaperCache.get(id);
  if (paper) return paper;
  if (_stampPaperCache.size > 6) _stampPaperCache.clear();
  const canvas = document.createElement('canvas');
  canvas.width = workW; canvas.height = workH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(' + palette.paper.join(',') + ')';
  ctx.fillRect(0, 0, workW, workH);
  const strength = (variantKey === 'ISSUE' ? 1.5 : 1) * (0.35 + amount * 1.3);
  ctx.strokeStyle = 'rgba(' + palette.fiber.join(',') + ',' + Math.min(0.9, 0.34 * strength).toFixed(3) + ')';
  ctx.lineWidth = Math.max(0.6, workH / 900);
  ctx.lineCap = 'round';
  const fibers = Math.round(260 * (0.4 + amount));
  for (let k = 0; k < fibers; k++) {
    const x = _stampHash(k, 1, seed) * workW, y = _stampHash(k, 2, seed) * workH;
    const angle = _stampHash(k, 3, seed) * Math.PI, length = (0.012 + _stampHash(k, 4, seed) * 0.03) * workH;
    const bend = (_stampHash(k, 5, seed) - 0.5) * length * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(angle) * length * 0.5 - Math.sin(angle) * bend, y + Math.sin(angle) * length * 0.5 + Math.cos(angle) * bend,
      x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }
  const image = ctx.getImageData(0, 0, workW, workH);
  const data = image.data;
  const tone = 5 * strength, grain = 2.2 * strength;
  for (let y = 0, i = 0; y < workH; y++) {
    for (let x = 0; x < workW; x++, i += 4) {
      const shade = (_stampSmooth(x / workH * 7, y / workH * 7, seed + 91) - 0.5) * tone + (_stampHash(x, y, seed + 17) - 0.5) * grain;
      data[i] += shade; data[i + 1] += shade; data[i + 2] += shade * 1.15;
    }
  }
  paper = new Uint32Array(image.data.buffer.slice(0));
  _stampPaperCache.set(id, paper);
  return paper;
}

// ── El sello como objeto: marco grabado, rótulos, dentado y matasellos ──────────────────
// Todo lo que no es la imagen se dibuja una vez en una capa y se compone encima en cada cuadro.
//   ENGR  · definitivo calcográfico: cenefa de guilloché, rosetas, rótulo en reserva sobre fondo rayado
//   INK   · tipográfico a dos tintas: bloques planos con gótica calada y registro desplazado
//   ISSUE · conmemorativo dentado con matasellos de primer día
let _stampFontEpoch = 0;
const _stampFrameCache = new Map();
// Suelta los marcos guardados (su memoria se libera ya, sin esperar al recolector).
function _stampRelease() {
  for (const frame of _stampFrameCache.values()) if (frame && frame.canvas) { frame.canvas.width = 0; frame.canvas.height = 0; }
  _stampFrameCache.clear();
}
if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
  const refresh = () => { _stampFontEpoch++; _stampFrameCache.clear(); };
  Promise.all([document.fonts.load('700 24px Cinzel'), document.fonts.load('24px Canterbury')]).then(refresh, refresh);
}
const _stampRgb = (c, a = 1) => a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const STAMP_ROMAN = 'Cinzel, "Trajan Pro", "Times New Roman", Georgia, serif';
const STAMP_GOTHIC = 'Canterbury, "Old English Text MT", Georgia, serif';

function _stampText(ctx, text, x, y, size, family, fill, options = {}) {
  ctx.save();
  ctx.font = `${options.weight || 700} ${size.toFixed(2)}px ${family}`;
  ctx.textAlign = options.align || 'center';
  ctx.textBaseline = 'alphabetic';
  const spacing = (options.spacing || 0) * size;
  if (options.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = options.strokeWidth || size * 0.09; ctx.strokeStyle = options.stroke; }
  ctx.fillStyle = fill;
  if (spacing && !('letterSpacing' in ctx)) {
    // Safari anterior a 18.4 no espacia las letras en el lienzo: se ponen una a una.
    const chars = Array.from(String(text)), widths = chars.map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((sum, w) => sum + w, 0) + spacing * (chars.length - 1), align = options.align || 'center';
    let at = align === 'center' ? x - total / 2 : align === 'right' || align === 'end' ? x - total : x;
    ctx.textAlign = 'left';
    for (let i = 0; i < chars.length; i++) { if (options.stroke) ctx.strokeText(chars[i], at, y); at += widths[i] + spacing; }
    at -= total + spacing;
    for (let i = 0; i < chars.length; i++) { ctx.fillText(chars[i], at, y); at += widths[i] + spacing; }
    ctx.restore();
    return;
  }
  try { ctx.letterSpacing = spacing.toFixed(2) + 'px'; } catch (_) {}
  const cx = options.align && options.align !== 'center' ? x : x + spacing * 0.5;
  if (options.stroke) ctx.strokeText(text, cx, y);
  ctx.fillText(text, cx, y);
  ctx.restore();
}
// Fondo rayado del buril: tinta con líneas finas de papel en reserva.
function _stampRuled(ctx, x, y, w, h, ink, paper, pitch, vertical = false) {
  ctx.save();
  ctx.fillStyle = ink;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = paper;
  ctx.lineWidth = Math.max(0.6, pitch * 0.3);
  ctx.beginPath();
  if (vertical) for (let p = x + pitch * 0.5; p < x + w; p += pitch) { ctx.moveTo(p, y); ctx.lineTo(p, y + h); }
  else for (let p = y + pitch * 0.5; p < y + h; p += pitch) { ctx.moveTo(x, p); ctx.lineTo(x + w, p); }
  ctx.stroke();
  ctx.restore();
}
// Cenefa de guilloché: tres ondas entrelazadas, la cadena de un billete.
function _stampGuilloche(ctx, x0, y0, x1, y1, amplitude, wavelength, color, width) {
  const length = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / length, uy = (y1 - y0) / length;
  const waves = Math.max(2, Math.round(length / wavelength)), k = (Math.PI * 2 * waves) / length;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let strand = 0; strand < 3; strand++) {
    const phase = (strand * Math.PI * 2) / 3;
    for (let t = 0; t <= length; t += Math.max(1, wavelength / 14)) {
      const off = amplitude * Math.sin(k * t + phase);
      const px = x0 + ux * t - uy * off, py = y0 + uy * t + ux * off;
      if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.restore();
}
// Roseta de torno geométrico para las esquinas.
function _stampRosette(ctx, cx, cy, radius, ink, paper, width) {
  ctx.save();
  ctx.fillStyle = paper;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 1.08, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [lobes, depth, scale] of [[8, 0.2, 1], [8, -0.2, 1], [12, 0.16, 0.66], [12, -0.16, 0.66], [6, 0.26, 0.36]]) {
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * 6.2832, r = radius * scale * (1 - Math.abs(depth) + depth * Math.cos(lobes * a));
      const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  }
  ctx.moveTo(cx + radius * 1.04, cy); ctx.arc(cx, cy, radius * 1.04, 0, 6.2832);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 0.1, 0, 6.2832); ctx.fill();
  ctx.restore();
}
// Dentado: las perforaciones muerden el borde y dejan ver el fondo oscuro; un filo de sombra da grosor al papel.
function _stampPerforation(ctx, outW, outH, u) {
  const radius = u * 1.12, inset = u * 0.36;
  ctx.save();
  const along = (length, place) => {
    const count = Math.max(4, Math.round(length / (radius * 3.05)));
    for (let k = 0; k <= count; k++) place((k / count) * length);
  };
  const holes = (draw) => {
    along(outW, t => { draw(t, inset); draw(t, outH - inset); });
    along(outH, t => { draw(inset, t); draw(outW - inset, t); });
  };
  ctx.fillStyle = 'rgba(40,30,16,.26)';
  ctx.beginPath(); holes((x, y) => { ctx.moveTo(x + radius * 1.16, y + u * 0.14); ctx.arc(x + u * 0.1, y + u * 0.14, radius * 1.16, 0, 6.2832); }); ctx.fill();
  ctx.fillStyle = '#131109';
  ctx.beginPath(); holes((x, y) => { ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, 6.2832); }); ctx.fill();
  ctx.fillRect(0, 0, outW, inset); ctx.fillRect(0, outH - inset, outW, inset);
  ctx.fillRect(0, 0, inset, outH); ctx.fillRect(outW - inset, 0, inset, outH);
  ctx.restore();
}
// Matasellos de primer día: doble corona con la fecha y las ondas del rodillo, con la tinta desigual.
function _stampPostmark(ctx, cx, cy, radius, lines, seed) {
  const ink = 'rgba(26,24,22,.8)';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.21);
  ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineCap = 'round';
  ctx.lineWidth = radius * 0.055;
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, 6.2832); ctx.stroke();
  ctx.lineWidth = radius * 0.03;
  ctx.beginPath(); ctx.arc(0, 0, radius * 0.66, 0, 6.2832); ctx.stroke();
  // Rótulo en corona.
  const ringText = (text, start, sign, size) => {
    ctx.font = `700 ${size.toFixed(2)}px ${STAMP_ROMAN}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const step = (size * 0.86) / (radius * 0.83);
    let angle = start - (sign * step * (text.length - 1)) / 2;
    for (const ch of text) {
      ctx.save();
      ctx.rotate(angle);
      ctx.translate(0, -sign * radius * 0.83);
      if (sign < 0) ctx.rotate(Math.PI);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      angle += sign * step;
    }
  };
  ringText(lines[0], 0, 1, radius * 0.17);
  ringText(lines[1], Math.PI, -1, radius * 0.14);
  ctx.font = `700 ${(radius * 0.25).toFixed(2)}px ${STAMP_ROMAN}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(lines[2], 0, -radius * 0.13);
  ctx.font = `700 ${(radius * 0.19).toFixed(2)}px ${STAMP_ROMAN}`;
  ctx.fillText(lines[3], 0, radius * 0.2);
  // Ondas del rodillo hacia la izquierda.
  ctx.lineWidth = radius * 0.06;
  ctx.beginPath();
  for (let row = -2; row <= 2; row++) {
    const y = row * radius * 0.3;
    for (let x = -radius * 1.12; x >= -radius * 3.3; x -= radius * 0.06) {
      const py = y + Math.sin(x / (radius * 0.2)) * radius * 0.085;
      if (x === -radius * 1.12) ctx.moveTo(x, py); else ctx.lineTo(x, py);
    }
  }
  ctx.stroke();
  // Tinta desigual: se le comen motas.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) {
    const h1 = _stampHash(i, 7, seed), h2 = _stampHash(i, 19, seed), h3 = _stampHash(i, 31, seed);
    ctx.globalAlpha = 0.35 + h3 * 0.5;
    ctx.beginPath();
    ctx.arc((h1 * 4.6 - 3.4) * radius, (h2 * 2.3 - 1.15) * radius, radius * (0.012 + h3 * 0.035), 0, 6.2832);
    ctx.fill();
  }
  ctx.restore();
}

function _stampFrame(variantKey, paletteKey, palette, outW, outH, seed) {
  const today = new Date();
  const day = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const key = [variantKey, paletteKey, outW, outH, _stampFontEpoch, day].join(':');
  let frame = _stampFrameCache.get(key);
  if (frame) return frame;
  // Dos marcos como mucho (visor y foto): cada uno es un lienzo del tamaño de la imagen.
  if (_stampFrameCache.size > 1) _stampRelease();
  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext('2d');
  const u = Math.min(outW, outH) / 100, L = STAMP_LAYOUT[variantKey];
  const win = { x: L.l * u, y: L.t * u, w: outW - (L.l + L.r) * u, h: outH - (L.t + L.b) * u };
  const paper = _stampRgb(palette.paper), ink = _stampRgb(palette.ink), deep = _stampRgb(palette.deep);
  const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const roman = n => { let out = ''; for (const [v, r] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (n >= v) { out += r; n -= v; } return out; };
  const rect = (inset, width, color) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.strokeRect(inset, inset, outW - inset * 2, outH - inset * 2); };
  ctx.lineJoin = 'miter';
  // Pátina: el papel se tuesta hacia los bordes y junta alguna mota de óxido.
  for (const [x0, y0, x1, y1] of [[0, 0, 0, 7 * u], [0, outH, 0, outH - 7 * u], [0, 0, 7 * u, 0], [outW, 0, outW - 7 * u, 0]]) {
    const tone = ctx.createLinearGradient(x0, y0, x1, y1);
    tone.addColorStop(0, 'rgba(118,82,38,.16)');
    tone.addColorStop(1, 'rgba(118,82,38,0)');
    ctx.fillStyle = tone;
    ctx.fillRect(0, 0, outW, outH);
  }
  for (let i = 0; i < 22; i++) {
    const h1 = _stampHash(i, 41, seed), h2 = _stampHash(i, 53, seed), h3 = _stampHash(i, 67, seed);
    const spot = ctx.createRadialGradient(h1 * outW, h2 * outH, 0, h1 * outW, h2 * outH, u * (0.5 + h3 * 1.5));
    spot.addColorStop(0, `rgba(126,84,36,${(0.05 + h3 * 0.07).toFixed(3)})`);
    spot.addColorStop(1, 'rgba(126,84,36,0)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, outW, outH);
  }
  ctx.clearRect(win.x, win.y, win.w, win.h);

  if (variantKey === 'ENGR') {
    const band = 5.2 * u;
    rect(3.3 * u, 0.44 * u, deep);
    // Cenefa: fondo de líneas finas y la cadena entrelazada encima.
    for (const [x0, y0, x1, y1] of [[band, band, outW - band, band], [band, outH - band, outW - band, outH - band], [band, band, band, outH - band], [outW - band, band, outW - band, outH - band]]) {
      _stampGuilloche(ctx, x0, y0, x1, y1, 1.02 * u, 3.3 * u, ink, Math.max(0.7, 0.17 * u));
      _stampGuilloche(ctx, x0, y0, x1, y1, 0.5 * u, 1.65 * u, _stampRgb(palette.ink, 0.7), Math.max(0.5, 0.1 * u));
    }
    rect(7.0 * u, 0.22 * u, deep);
    for (const [cx, cy] of [[band, band], [outW - band, band], [band, outH - band], [outW - band, outH - band]]) _stampRosette(ctx, cx, cy, 2.55 * u, deep, paper, Math.max(0.6, 0.13 * u));
    // Columnas laterales rayadas, pegadas a la ventana.
    _stampRuled(ctx, 7.4 * u, win.y, win.x - 8.0 * u, win.h, ink, paper, 0.52 * u);
    _stampRuled(ctx, win.x + win.w + 0.6 * u, win.y, win.x - 8.0 * u, win.h, ink, paper, 0.52 * u);
    // Rótulo: letras en reserva sobre fondo rayado.
    const top = { x: 7.4 * u, y: 7.6 * u, w: outW - 14.8 * u, h: win.y - 8.5 * u };
    _stampRuled(ctx, top.x, top.y, top.w, top.h, deep, _stampRgb(palette.paper, 0.5), 0.46 * u);
    _stampText(ctx, 'FLIP', outW / 2, top.y + top.h * 0.5 + 1.75 * u, 4.9 * u, STAMP_ROMAN, paper, { spacing: 0.34, stroke: deep, strokeWidth: 0.5 * u });
    const side = Math.min(1.9 * u, top.w * 0.034);
    _stampText(ctx, 'CÁMARA', top.x + 1.6 * u, top.y + top.h * 0.5 + side * 0.36, side, STAMP_ROMAN, paper, { align: 'left', spacing: 0.22, stroke: deep, strokeWidth: 0.3 * u });
    _stampText(ctx, 'POSTAL', top.x + top.w - 1.6 * u, top.y + top.h * 0.5 + side * 0.36, side, STAMP_ROMAN, paper, { align: 'right', spacing: 0.22, stroke: deep, strokeWidth: 0.3 * u });
    // Pie: valor en dos tablillas y la leyenda entre filetes.
    const foot = { y: win.y + win.h + 0.9 * u, h: outH - 7.6 * u - (win.y + win.h + 0.9 * u) };
    for (const fx of [7.4 * u, outW - 7.4 * u - foot.h * 1.5]) {
      _stampRuled(ctx, fx, foot.y, foot.h * 1.5, foot.h, deep, _stampRgb(palette.paper, 0.5), 0.46 * u);
      _stampText(ctx, '27', fx + foot.h * 0.75, foot.y + foot.h * 0.5 + foot.h * 0.27, foot.h * 0.76, STAMP_ROMAN, paper, { stroke: deep, strokeWidth: 0.34 * u });
    }
    ctx.strokeStyle = deep; ctx.lineWidth = 0.16 * u;
    ctx.beginPath();
    for (const fy of [foot.y + 0.3 * u, foot.y + foot.h - 0.3 * u]) { ctx.moveTo(7.4 * u + foot.h * 1.5 + 1.2 * u, fy); ctx.lineTo(outW - 7.4 * u - foot.h * 1.5 - 1.2 * u, fy); }
    ctx.stroke();
    _stampText(ctx, 'CORREOS · ' + roman(today.getFullYear()), outW / 2, foot.y + foot.h * 0.5 + 0.62 * u, 1.75 * u, STAMP_ROMAN, deep, { spacing: 0.3 });
    // Filete de la ventana y cantoneras.
    ctx.strokeStyle = deep; ctx.lineWidth = 0.3 * u;
    ctx.strokeRect(win.x - 0.15 * u, win.y - 0.15 * u, win.w + 0.3 * u, win.h + 0.3 * u);
    ctx.fillStyle = deep;
    const corner = 2.6 * u;
    for (const [cx, cy, sx, sy] of [[win.x, win.y, 1, 1], [win.x + win.w, win.y, -1, 1], [win.x, win.y + win.h, 1, -1], [win.x + win.w, win.y + win.h, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + sx * corner, cy); ctx.quadraticCurveTo(cx, cy, cx, cy + sy * corner); ctx.closePath(); ctx.fill();
    }
    _stampPerforation(ctx, outW, outH, u);
  } else if (variantKey === 'INK') {
    // Segunda tinta: bloques planos con el registro corrido respecto a la tinta de la imagen.
    const second = palette.second || palette.accent, flat = _stampRgb(second), dx = 0.34 * u, dy = 0.24 * u;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.fillStyle = flat;
    ctx.beginPath();
    ctx.rect(3.0 * u, 3.0 * u, outW - 6.0 * u, outH - 6.0 * u);
    ctx.rect(win.x - 0.9 * u, win.y - 0.9 * u, win.w + 1.8 * u, win.h + 1.8 * u);
    ctx.fill('evenodd');
    // Gótica calada en el bloque superior, valor en discos al pie.
    const topH = win.y - 0.9 * u - 3.0 * u;
    _stampText(ctx, 'Flip Post', outW / 2, 3.0 * u + topH * 0.5 + 2.5 * u, 7.4 * u, STAMP_GOTHIC, paper, { weight: 400 });
    const footY = win.y + win.h + 0.9 * u, footH = outH - 3.0 * u - footY, disc = footH * 0.36;
    for (const cx of [3.0 * u + footH * 0.62, outW - 3.0 * u - footH * 0.62]) {
      ctx.fillStyle = paper;
      ctx.beginPath(); ctx.arc(cx, footY + footH * 0.5, disc, 0, 6.2832); ctx.fill();
      _stampText(ctx, '27', cx, footY + footH * 0.5 + disc * 0.42, disc * 1.2, STAMP_ROMAN, flat);
    }
    _stampText(ctx, 'CORREO ORDINARIO', outW / 2, footY + footH * 0.5 + 0.72 * u, 2.0 * u, STAMP_ROMAN, paper, { spacing: 0.28 });
    // Tinta tipográfica: motas de papel dentro del plano y el borde algo más cargado.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) {
      const h1 = _stampHash(i, 3, seed), h2 = _stampHash(i, 11, seed), h3 = _stampHash(i, 23, seed);
      ctx.globalAlpha = 0.25 + h3 * 0.6;
      ctx.beginPath(); ctx.arc(h1 * outW, h2 * outH, u * (0.05 + h3 * 0.16), 0, 6.2832); ctx.fill();
    }
    ctx.restore();
    // Tinta de la llave (la de la imagen): filetes finos, en su sitio.
    ctx.strokeStyle = deep; ctx.lineWidth = 0.26 * u;
    ctx.strokeRect(win.x - 0.2 * u, win.y - 0.2 * u, win.w + 0.4 * u, win.h + 0.4 * u);
    ctx.lineWidth = 0.18 * u;
    ctx.strokeRect(2.1 * u, 2.1 * u, outW - 4.2 * u, outH - 4.2 * u);
  } else {
    rect(4.5 * u, 0.3 * u, deep);
    rect(5.2 * u, 0.14 * u, deep);
    const baseTop = win.y - 1.9 * u;
    _stampText(ctx, 'FLIP', 6.6 * u, baseTop, 4.0 * u, STAMP_ROMAN, deep, { align: 'left', spacing: 0.26 });
    _stampText(ctx, '27', outW - 6.6 * u - 2.4 * u, baseTop, 4.0 * u, STAMP_ROMAN, deep, { align: 'right' });
    _stampText(ctx, 'c', outW - 6.6 * u, baseTop, 2.6 * u, STAMP_ROMAN, deep, { align: 'right' });
    _stampText(ctx, 'EMISIÓN CONMEMORATIVA', outW / 2, baseTop - 0.9 * u, Math.min(1.25 * u, outW * 0.014), STAMP_ROMAN, ink, { spacing: 0.34 });
    const footY = win.y + win.h;
    ctx.strokeStyle = deep; ctx.lineWidth = 0.22 * u;
    ctx.strokeRect(win.x - 0.2 * u, win.y - 0.2 * u, win.w + 0.4 * u, win.h + 0.4 * u);
    const dated = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;
    _stampText(ctx, 'PRIMER DÍA DE EMISIÓN', outW / 2, footY + 3.3 * u, 1.7 * u, STAMP_ROMAN, deep, { spacing: 0.32 });
    _stampText(ctx, dated + '  ·  CÁMARA FL-27', outW / 2, footY + 5.7 * u, 1.25 * u, STAMP_ROMAN, ink, { spacing: 0.3 });
    _stampPerforation(ctx, outW, outH, u);
    _stampPostmark(ctx, outW - 15.5 * u, 17.5 * u, 8.6 * u, ['FLIP · CORREOS', 'PRIMER DÍA', `${today.getDate()} ${months[today.getMonth()]}`, String(today.getFullYear())], seed);
  }
  // Solo se componen las franjas que tienen dibujo: los cuatro lados y, si lo hay, el matasellos.
  const strips = [[0, 0, outW, Math.ceil(win.y)], [0, Math.floor(win.y + win.h), outW, outH - Math.floor(win.y + win.h)],
    [0, Math.ceil(win.y), Math.ceil(win.x), Math.floor(win.h)], [Math.floor(win.x + win.w), Math.ceil(win.y), outW - Math.floor(win.x + win.w), Math.floor(win.h)]];
  if (variantKey === 'ISSUE') {
    const px = Math.max(win.x, outW - 46 * u), py = Math.ceil(win.y), ph = Math.min(win.h, 30 * u - win.y);
    strips.push([Math.ceil(px), py, Math.floor(win.x + win.w - px), Math.floor(ph)]);
  }
  if (variantKey === 'ENGR') {
    // Las cantoneras entran un poco en la ventana.
    const c = Math.ceil(2.7 * u);
    strips.push([Math.ceil(win.x), Math.ceil(win.y), c, c], [Math.floor(win.x + win.w - c), Math.ceil(win.y), c, c],
      [Math.ceil(win.x), Math.floor(win.y + win.h - c), c, c], [Math.floor(win.x + win.w - c), Math.floor(win.y + win.h - c), c, c]);
  }
  frame = { canvas, strips: strips.filter(r => r[2] > 0 && r[3] > 0) };
  _stampFrameCache.set(key, frame);
  return frame;
}

const _stampStates = new WeakMap();
function _stampState(targetCtx, gridW, gridH, workW, workH) {
  let state = _stampStates.get(targetCtx);
  if (!state || state.gridW !== gridW || state.gridH !== gridH || state.workW !== workW || state.workH !== workH) {
    const canvas = (w, h, read) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c.getContext('2d', read ? { willReadFrequently: true } : undefined);
    };
    const ink = canvas(workW, workH, false);
    state = {
      gridW, gridH, workW, workH,
      sample: canvas(gridW, gridH, true), ink, inkImage: new ImageData(workW, workH),
      lum: new Float32Array(gridW * gridH), blur: new Float32Array(gridW * gridH), dark: new Float32Array(gridW * gridH),
      edge: new Uint8Array(gridW * gridH), hist: new Uint32Array(256),
      // Dos filas de la rejilla ya interpoladas en horizontal; el bucle solo mezcla en vertical.
      rowA: new Uint8Array(workW), rowB: new Uint8Array(workW), edgeA: new Uint8Array(workW), edgeB: new Uint8Array(workW),
      column: new Uint16Array(workW), weight: new Uint8Array(workW),
      t1: new Int16Array(256), t2: new Int16Array(256), t3: new Int16Array(256), contour: new Int16Array(256),
      inkR: new Uint8Array(256), inkG: new Uint8Array(256), inkB: new Uint8Array(256),
      lo: 0, hi: 255, primed: false,
    };
    state.ink32 = new Uint32Array(state.inkImage.data.buffer);
    _stampStates.set(targetCtx, state);
  }
  return state;
}

function _renderStampCore(source, srcW, srcH, targetCtx, mirror, options = {}) {
  const outW = Math.max(1, Math.round(options.outW || targetCtx.canvas?.width || OUT_W));
  const outH = Math.max(1, Math.round(options.outH || targetCtx.canvas?.height || OUT_H));
  const gridW = STAMP_GRID_W, gridH = Math.max(32, Math.round(STAMP_GRID_W * outH / outW));
  const workW = Math.max(64, Math.round(outW * STAMP_WORK_SCALE)), workH = Math.max(64, Math.round(outH * STAMP_WORK_SCALE));
  const state = _stampState(targetCtx, gridW, gridH, workW, workH);
  const variantKey = STAMP_VARIANTS[renderVariant()] ? renderVariant() : 'ENGR';
  const variant = STAMP_VARIANTS[variantKey];
  const palette = _getStampPalette();
  const engrave = stampEngraveVal / 100, inkAmount = stampInkVal / 100, detail = stampDetailVal / 100, paperAmount = stampPaperVal / 100;
  const seed = (_camEngineCore.sessionSeed || 0) >>> 0;
  const frameOn = stampFrameMode === 'ON';
  const layout = frameOn ? STAMP_LAYOUT[variantKey] : { l: 0, r: 0, t: 0, b: 0 };
  const unit = Math.min(workW, workH) / 100;
  const x0 = Math.round(layout.l * unit), y0 = Math.round(layout.t * unit);
  const x1 = workW - Math.round(layout.r * unit), y1 = workH - Math.round(layout.b * unit);

  // 1 · Escena → luminancia en la rejilla de tono.
  const pen = state.sample;
  const [sx, sy, sw, sh] = cropCoordsForDims(srcW, srcH, gridW, gridH);
  pen.save();
  pen.imageSmoothingEnabled = true;
  if (mirror) { pen.translate(gridW, 0); pen.scale(-1, 1); }
  pen.drawImage(source, sx, sy, sw, sh, 0, 0, gridW, gridH);
  pen.restore();
  const src = pen.getImageData(0, 0, gridW, gridH).data;
  const { lum, blur, dark, edge: edges, hist } = state;
  const n = gridW * gridH;
  hist.fill(0);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const l = (src[i] * 77 + src[i + 1] * 150 + src[i + 2] * 29) >> 8;
    lum[p] = l; hist[l]++;
  }
  // 2 · Niveles: el negro de la escena llega a la tinta plena; el blanco se ancla al papel.
  let acc = 0, p2 = 0, p98 = 255;
  while (p2 < 255 && (acc += hist[p2]) < n * 0.02) p2++;
  acc = 0;
  while (p98 > 0 && (acc += hist[p98]) < n * 0.02) p98--;
  const lo = p2 * 0.6, hi = p98 + (255 - p98) * 0.55;
  if (!state.primed) { state.lo = lo; state.hi = hi; }
  else { state.lo += (lo - state.lo) * 0.2; state.hi += (hi - state.hi) * 0.2; }
  const span = Math.max(72, state.hi - state.lo);
  // 3 · Sombra por punto, con memoria donde la escena no se mueve: la línea no tiembla con el ruido.
  const edgeGain = 1.5 + detail * 1.6;
  for (let y = 0, p = 0; y < gridH; y++) {
    const up = (y > 0 ? y - 1 : y) * gridW, dn = (y < gridH - 1 ? y + 1 : y) * gridW, row = y * gridW;
    for (let x = 0; x < gridW; x++, p++) {
      const xl = x > 0 ? x - 1 : x, xr = x < gridW - 1 ? x + 1 : x;
      blur[p] = (lum[up + xl] + lum[up + x] + lum[up + xr] + lum[row + xl] + lum[p] + lum[row + xr] + lum[dn + xl] + lum[dn + x] + lum[dn + xr]) / 9;
    }
  }
  for (let y = 0, p = 0; y < gridH; y++) {
    const up = (y > 0 ? y - 1 : y) * gridW, dn = (y < gridH - 1 ? y + 1 : y) * gridW, row = y * gridW;
    for (let x = 0; x < gridW; x++, p++) {
      const gx = blur[row + (x < gridW - 1 ? x + 1 : x)] - blur[row + (x > 0 ? x - 1 : x)];
      const gy = blur[dn + x] - blur[up + x];
      const edge = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
      const local = lum[p] * (0.45 + detail * 0.4) + blur[p] * (0.55 - detail * 0.4);
      let d = (state.hi - local) / span;
      d = d <= 0 ? 0 : d >= 1 ? 255 : Math.pow(d, 0.9) * 255;
      if (state.primed) { const delta = d - dark[p]; d = dark[p] + delta * (delta > 26 || delta < -26 ? 1 : 0.5); }
      dark[p] = d;
      edges[p] = Math.min(255, edge * edgeGain);
    }
  }
  state.primed = true;
  // 4 · La sombra se amplía a la resolución de trabajo por interpolación bilineal, sin canvas
  //     intermedio ni lecturas: cada columna de trabajo conoce su celda y su peso.
  const { rowA, rowB, edgeA, edgeB, column, weight } = state;
  const spanX = x1 - x0, spanY = y1 - y0;
  for (let x = x0; x < x1; x++) {
    const g = Math.max(0, Math.min(gridW - 1.001, (x - x0 + 0.5) / spanX * gridW - 0.5));
    column[x] = g | 0; weight[x] = Math.round((g - (g | 0)) * 255);
  }
  const fillRow = (row, shadeOut, edgeOut) => {
    const base = row * gridW;
    for (let x = x0; x < x1; x++) {
      const c = base + column[x], w = weight[x];
      shadeOut[x] = (dark[c] * (255 - w) + dark[c + 1] * w) / 255;
      edgeOut[x] = (edges[c] * (255 - w) + edges[c + 1] * w) >> 8;
    }
  };
  let loadedRow = -2;

  // 5 · Pantallas, papel y umbrales de la variante.
  const screens = _stampScreens(variantKey, variant, workW, workH, y1 - y0, engrave, seed);
  const paper = _stampPaper(stampPaletteMode, palette, workW, workH, paperAmount, variantKey, seed);
  const { t1, t2, t3, inkR, inkG, inkB, contour } = state;
  const load = 0.82 + inkAmount * 0.42;
  for (let v = 0; v < 256; v++) {
    const d = v / 255;
    // Reserva del blanco: por debajo del 6 % de sombra no se entinta nada.
    const c1 = d < 0.06 ? 0 : Math.min(variant.c1, (d - 0.06) / 0.94 * 1.2 * load);
    t1[v] = d >= variant.solid ? 600 : c1 <= 0 ? -600 : Math.round(c1 * 255);
    const c2 = d < variant.crossAt ? 0 : Math.min(0.7, (d - variant.crossAt) / (1 - variant.crossAt) * 0.75 * load);
    t2[v] = c2 <= 0 ? -600 : Math.round(c2 * 255);
    const c3 = d < variant.thirdAt ? 0 : Math.min(0.6, (d - variant.thirdAt) / (1 - variant.thirdAt) * 0.6 * load);
    t3[v] = c3 <= 0 ? -600 : Math.round(c3 * 255);
    const mix = Math.min(1, d * 1.15);
    inkR[v] = palette.ink[0] + (palette.deep[0] - palette.ink[0]) * mix;
    inkG[v] = palette.ink[1] + (palette.deep[1] - palette.ink[1]) * mix;
    inkB[v] = palette.ink[2] + (palette.deep[2] - palette.ink[2]) * mix;
    const e = (v - 70) / 90;
    contour[v] = e <= 0 ? 0 : Math.min(235, e * e * (3 - 2 * Math.min(1, e)) * 235 * variant.contour);
  }
  const sharp = screens.pitch * 0.5 * variant.soft;
  const { s1, s2, s3 } = screens;
  const out = state.ink32;
  out.set(paper);
  const plate = variant.plate;
  let upper = rowA, lower = rowB, upperEdge = edgeA, lowerEdge = edgeB;
  for (let y = y0; y < y1; y++) {
    const gy = Math.max(0, Math.min(gridH - 1.001, (y - y0 + 0.5) / spanY * gridH - 0.5));
    const row = gy | 0, wy = Math.round((gy - row) * 255);
    if (row !== loadedRow) {
      // Al bajar una fila, la inferior pasa a ser la superior y solo se interpola la nueva.
      if (row === loadedRow + 1) {
        const swapShade = upper; upper = lower; lower = swapShade;
        const swapEdge = upperEdge; upperEdge = lowerEdge; lowerEdge = swapEdge;
      } else fillRow(row, upper, upperEdge);
      fillRow(row + 1, lower, lowerEdge);
      loadedRow = row;
    }
    let p = y * workW + x0;
    for (let x = x0; x < x1; x++, p++) {
      const d = (upper[x] * (255 - wy) + lower[x] * wy) >> 8;
      let m = t1[d] - s1[p];
      const m2 = t2[d] - s2[p]; if (m2 > m) m = m2;
      const m3 = t3[d] - s3[p]; if (m3 > m) m = m3;
      let cover = 128 + m * sharp;
      // El perfilado solo carga tinta del lado oscuro del borde: no engorda la forma hacia la luz.
      const line = (contour[(upperEdge[x] * (255 - wy) + lowerEdge[x] * wy) >> 8] * d) >> 7; if (line > cover) cover = line;
      if (cover < plate) cover = plate;
      if (cover <= 0) continue;
      const a = cover >= 255 ? 255 : cover | 0;
      const base = paper[p], pr = base & 255, pg = (base >> 8) & 255, pb = (base >> 16) & 255;
      out[p] = 0xff000000 | ((pb + (((inkB[d] - pb) * a) >> 8)) << 16) | ((pg + (((inkG[d] - pg) * a) >> 8)) << 8) | (pr + (((inkR[d] - pr) * a) >> 8));
    }
  }
  state.ink.putImageData(state.inkImage, 0, 0);

  targetCtx.save();
  targetCtx.globalAlpha = 1;
  targetCtx.globalCompositeOperation = 'source-over';
  targetCtx.filter = 'none';
  targetCtx.imageSmoothingEnabled = true;
  try { targetCtx.imageSmoothingQuality = 'high'; } catch (_) {}
  targetCtx.drawImage(state.ink.canvas, 0, 0, outW, outH);
  targetCtx.restore();
  if (frameOn) {
    const frame = _stampFrame(variantKey, stampPaletteMode, palette, outW, outH, seed);
    targetCtx.save();
    targetCtx.globalAlpha = 1;
    targetCtx.globalCompositeOperation = 'source-over';
    for (const [sx, sy, sw, sh] of frame.strips) targetCtx.drawImage(frame.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
    targetCtx.restore();
  }
}
function renderStamp(source, srcW, srcH, targetCtx, mirror, options = {}) {
  _renderStampCore(source, srcW, srcH, targetCtx, mirror, options);
}
