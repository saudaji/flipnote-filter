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
  POSTAL: { paper:[234,226,204], fiber:[214,201,176], ink:[58,116,74], deep:[26,63,37], accent:[145,164,111] },
  COBALT: { paper:[238,232,221], fiber:[219,206,190], ink:[56,93,154], deep:[24,44,92], accent:[145,171,212] },
  SEPIA:  { paper:[229,216,194], fiber:[207,190,163], ink:[91,66,45], deep:[44,28,19], accent:[151,118,84] },
  OXIDE:  { paper:[238,221,194], fiber:[215,196,169], ink:[154,83,35], deep:[92,44,18], accent:[214,154,86] },
  NOIR:   { paper:[239,233,223], fiber:[217,208,197], ink:[50,49,45], deep:[16,16,14], accent:[131,126,118] },
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
const STAMP_FRAME_MARGIN = 0.085;

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

function _drawStampIssueFrame(targetCtx, outW, outH, palette, imageBounds) {
  const { x, y, w, h } = imageBounds;
  const margin = Math.max(10, Math.round(Math.min(outW, outH) * 0.032));
  const lineOuter = Math.max(1.5, Math.round(Math.min(outW, outH) * 0.0035));
  const lineInner = Math.max(1, Math.round(Math.min(outW, outH) * 0.002));
  const accent = `rgb(${palette.accent.join(',')})`;
  const deep = `rgb(${palette.deep.join(',')})`;
  const ink = `rgb(${palette.ink.join(',')})`;
  targetCtx.save();
  targetCtx.strokeStyle = accent;
  targetCtx.lineWidth = lineOuter;
  targetCtx.strokeRect(x - margin, y - margin, w + margin * 2, h + margin * 2);
  targetCtx.strokeStyle = deep;
  targetCtx.lineWidth = lineInner;
  targetCtx.strokeRect(x - margin * 0.55, y - margin * 0.55, w + margin * 1.1, h + margin * 1.1);
  targetCtx.strokeRect(x - margin * 0.18, y - margin * 0.18, w + margin * 0.36, h + margin * 0.36);
  targetCtx.fillStyle = deep;
  targetCtx.font = `${Math.max(12, Math.round(outH * 0.026))}px Georgia, "Times New Roman", serif`;
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'middle';
  targetCtx.fillText('FLIP POST', outW * 0.5, y - margin * 0.66);
  targetCtx.fillStyle = ink;
  targetCtx.font = `${Math.max(11, Math.round(outH * 0.022))}px Georgia, "Times New Roman", serif`;
  targetCtx.textAlign = 'left';
  targetCtx.fillText(renderVariant(), x - margin * 0.74, y + h + margin * 0.52);
  targetCtx.textAlign = 'right';
  targetCtx.fillText('12c', x + w + margin * 0.74, y + h + margin * 0.52);
  targetCtx.restore();
}
// Dentado del sello emitido: perforaciones a paso fijo que muerden el borde del papel.
function _drawStampPerforation(targetCtx, outW, outH) {
  const radius = outH * 0.0115, inset = outH * 0.004;
  targetCtx.save();
  targetCtx.fillStyle = '#16140f';
  targetCtx.beginPath();
  const along = (length, place) => {
    const count = Math.max(4, Math.round(length / (radius * 3.1)));
    for (let k = 0; k <= count; k++) place((k / count) * length);
  };
  along(outW, t => { targetCtx.moveTo(t + radius, inset); targetCtx.arc(t, inset, radius, 0, 6.2832); targetCtx.moveTo(t + radius, outH - inset); targetCtx.arc(t, outH - inset, radius, 0, 6.2832); });
  along(outH, t => { targetCtx.moveTo(inset + radius, t); targetCtx.arc(inset, t, radius, 0, 6.2832); targetCtx.moveTo(outW - inset + radius, t); targetCtx.arc(outW - inset, t, radius, 0, 6.2832); });
  targetCtx.fill();
  targetCtx.fillRect(0, 0, outW, inset); targetCtx.fillRect(0, outH - inset, outW, inset);
  targetCtx.fillRect(0, 0, inset, outH); targetCtx.fillRect(outW - inset, 0, inset, outH);
  targetCtx.restore();
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
      sample: canvas(gridW, gridH, true), tone: canvas(gridW, gridH, true), up: canvas(workW, workH, true), ink,
      toneImage: new ImageData(gridW, gridH), inkImage: new ImageData(workW, workH),
      lum: new Float32Array(gridW * gridH), blur: new Float32Array(gridW * gridH), dark: new Float32Array(gridW * gridH),
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
  const margin = frameOn ? STAMP_FRAME_MARGIN : 0;
  const x0 = Math.round(workW * margin), y0 = Math.round(workH * margin);
  const x1 = workW - x0, y1 = workH - y0;

  // 1 · Escena → luminancia en la rejilla de tono.
  const pen = state.sample;
  const [sx, sy, sw, sh] = cropCoordsForDims(srcW, srcH, gridW, gridH);
  pen.save();
  pen.imageSmoothingEnabled = true;
  if (mirror) { pen.translate(gridW, 0); pen.scale(-1, 1); }
  pen.drawImage(source, sx, sy, sw, sh, 0, 0, gridW, gridH);
  pen.restore();
  const src = pen.getImageData(0, 0, gridW, gridH).data;
  const { lum, blur, dark } = state;
  const n = gridW * gridH;
  const hist = new Uint32Array(256);
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
  const tone = state.toneImage.data;
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
      const i = p << 2;
      tone[i] = d; tone[i + 1] = Math.min(255, edge * edgeGain); tone[i + 2] = 0; tone[i + 3] = 255;
    }
  }
  state.primed = true;
  state.tone.putImageData(state.toneImage, 0, 0);
  // 4 · La sombra se amplía con suavizado a la resolución de trabajo, solo dentro del marco.
  const up = state.up;
  up.imageSmoothingEnabled = true;
  up.imageSmoothingQuality = 'medium';
  up.drawImage(state.tone.canvas, x0, y0, x1 - x0, y1 - y0);
  const shade = up.getImageData(0, 0, workW, workH).data;

  // 5 · Pantallas, papel y umbrales de la variante.
  const screens = _stampScreens(variantKey, variant, workW, workH, y1 - y0, engrave, seed);
  const paper = _stampPaper(stampPaletteMode, palette, workW, workH, paperAmount, variantKey, seed);
  const t1 = new Int16Array(256), t2 = new Int16Array(256), t3 = new Int16Array(256);
  const inkR = new Uint8Array(256), inkG = new Uint8Array(256), inkB = new Uint8Array(256), contour = new Int16Array(256);
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
  for (let y = y0; y < y1; y++) {
    let p = y * workW + x0, i = p << 2;
    for (let x = x0; x < x1; x++, p++, i += 4) {
      const d = shade[i];
      let m = t1[d] - s1[p];
      const m2 = t2[d] - s2[p]; if (m2 > m) m = m2;
      const m3 = t3[d] - s3[p]; if (m3 > m) m = m3;
      let cover = 128 + m * sharp;
      // El perfilado solo carga tinta del lado oscuro del borde: no engorda la forma hacia la luz.
      const line = (contour[shade[i + 1]] * d) >> 7; if (line > cover) cover = line;
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
    const mx = Math.round(outW * margin), my = Math.round(outH * margin);
    _drawStampIssueFrame(targetCtx, outW, outH, palette, { x: mx, y: my, w: outW - mx * 2, h: outH - my * 2 });
    if (variantKey === 'ISSUE') _drawStampPerforation(targetCtx, outW, outH);
  }
}
function renderStamp(source, srcW, srcH, targetCtx, mirror, options = {}) {
  _renderStampCore(source, srcW, srcH, targetCtx, mirror, options);
}
