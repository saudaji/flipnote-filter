'use strict';

// AUTO 03 · NIGHT — emulación de la visión nocturna de una videocámara de consumo
// (Sony Handycam NightShot / Super NightShot, 1998-2003). El teléfono solo aporta luz
// visible: aquí no hay infrarrojo, se reconstruye la respuesta de aquella cámara.
//
// Cadena, en luz lineal:
//   sensor      mezcla monocroma con peso en rojo (lo más cercano al IR cercano)
//   iluminador  punto caliente central con caída hacia las esquinas
//   AGC         ganancia según la luz medida, con inercia
//   obturador   integración de cuadros cuando falta luz (Super NightShot)
//   ruido       proporcional a la ganancia, promediado por la integración
//   CCD         saturación, halo y smear vertical de las fuentes puntuales
//   cámara      curva de tono con negro profundo y realce horizontal de bordes
//   tinte       monocromo azul verdoso según el nivel (preferencia de FLIP; el
//               original va del verde al verde azulado según el modelo)
// La trama del ruido, el halo y el smear se definen sobre una rejilla lógica de 256
// columnas: una foto a más resolución conserva la escala que se ve en el visor.

const nightVision = (() => {
  const LOGICAL_W = 256;
  const BLOOM_W = 64;
  // Tinte por luminancia de salida: sombras profundas, medios cian, altas luces pálidas.
  const TINT_STOPS = [
    [0, 2, 5, 6], [24, 14, 26, 28], [50, 35, 56, 57], [95, 66, 107, 108],
    [150, 112, 166, 160], [205, 172, 222, 208], [240, 222, 248, 238], [255, 244, 255, 250],
  ];
  const tint = new Uint8Array(256 * 3);
  for (let v = 0; v < 256; v++) {
    let k = 1;
    while (TINT_STOPS[k][0] < v) k++;
    const a = TINT_STOPS[k - 1], b = TINT_STOPS[k], t = (v - a[0]) / (b[0] - a[0] || 1);
    for (let c = 0; c < 3; c++) tint[v * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * t);
  }
  // sRGB → lineal, ya ponderado por la respuesta espectral del sensor sin filtro IR.
  const linR = new Float32Array(256), linG = new Float32Array(256), linB = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255, lin = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    linR[i] = lin * 0.5; linG[i] = lin * 0.38; linB[i] = lin * 0.12;
  }
  const TONE_N = 2048, TONE_MAX = 1.6;
  const toneCache = new Map();
  // Curva de la cámara: pie que hunde el negro, gamma de vídeo y hombro suave hasta la saturación.
  function toneCurve(contrast) {
    let lut = toneCache.get(contrast);
    if (lut) return lut;
    lut = new Float32Array(TONE_N + 1);
    const toe = 0.0025, gamma = 1 / (2.05 + contrast * 0.5);
    for (let i = 0; i <= TONE_N; i++) {
      const x = (i / TONE_N) * TONE_MAX;
      const lifted = Math.max(0, x - toe) / (1 - toe);
      const shoulder = lifted < 0.62 ? lifted : 0.62 + (1 - Math.exp(-(lifted - 0.62) * 2.9)) * 0.38;
      let y = Math.pow(shoulder, gamma);
      y += (y - 0.5) * contrast * 0.5 * (1 - Math.abs(y - 0.5) * 1.4);
      lut[i] = Math.max(0, Math.min(1, y)) * 255;
    }
    toneCache.set(contrast, lut);
    return lut;
  }
  function hash(x, y, seed) {
    let n = Math.imul(x + 1 ^ seed, 0x2c1b3c6d) ^ Math.imul(y + 1 ^ (seed >>> 3), 0x297a2d39);
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
  }

  const states = new WeakMap();
  function stateFor(ctx, w, h, source) {
    let state = states.get(ctx);
    if (!state || state.w !== w || state.h !== h) {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const bloomH = Math.max(8, Math.round(BLOOM_W * h / w));
      const bloomCanvas = document.createElement('canvas');
      bloomCanvas.width = BLOOM_W; bloomCanvas.height = bloomH;
      const logicalH = Math.max(1, Math.round(LOGICAL_W * h / w));
      const spot = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        const dy = ((y + 0.5) / h - 0.5) * 2;
        for (let x = 0; x < w; x++) {
          const dx = ((x + 0.5) / w - 0.5) * 2;
          const r = Math.sqrt((dx * dx + dy * dy) / 2);
          spot[y * w + x] = 0.18 + 0.82 * Math.exp(-Math.pow(r / 0.5, 2));
        }
      }
      state = {
        w, h, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }),
        image: new ImageData(w, h), spot, logicalH,
        signal: new Float32Array(w * h), sum: new Float32Array(w * h), held: new Float32Array(w * h),
        level: new Float32Array(w * h),
        column: new Float32Array(LOGICAL_W), smear: new Float32Array(LOGICAL_W),
        bloom: new Float32Array(BLOOM_W * bloomH), bloomTmp: new Float32Array(BLOOM_W * bloomH), bloomH,
        bloomCanvas, bloomCtx: bloomCanvas.getContext('2d'), bloomImage: new ImageData(BLOOM_W, bloomH),
        lineCanvas: null,
      };
      states.set(ctx, state);
    }
    if (state.source !== source) {
      state.source = source;
      state.gain = 0; state.count = 0; state.ready = false; state.last = -1;
    }
    return state;
  }
  // Tiempo de exposición del obturador lento según la ganancia: 1/30 s con luz, hasta 2/15 s a oscuras.
  function exposureFor(gain) {
    return gain < 3 ? 0 : gain < 5.5 ? 60 : gain < 8.5 ? 95 : 128;
  }
  function scanlines(state, outW, outH) {
    const key = outW + 'x' + outH;
    if (state.lineKey === key) return state.lineCanvas;
    const canvas = state.lineCanvas || document.createElement('canvas');
    canvas.width = 1; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(1, outH);
    // 240 líneas por campo: cada línea deja una franja más oscura entre haces.
    for (let y = 0; y < outH; y++) {
      const phase = (y * 240 / outH) % 1;
      const dark = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
      image.data[y * 4 + 3] = Math.round(34 * dark);
    }
    ctx.putImageData(image, 0, 0);
    state.lineCanvas = canvas; state.lineKey = key;
    return canvas;
  }

  // options: sampleW, sampleH, outW, outH, contrast (-1..1), sharp (0..2), noise (0..2),
  // still { gain, exposure }: foto de un solo disparo que hereda el AGC del visor.
  function render(source, srcW, srcH, targetCtx, mirror, now, options = {}) {
    const w = Math.max(32, options.sampleW | 0), h = Math.max(32, options.sampleH | 0);
    const outW = Math.max(1, Math.round(options.outW || targetCtx.canvas.width));
    const outH = Math.max(1, Math.round(options.outH || targetCtx.canvas.height));
    const state = stateFor(targetCtx, w, h, source);
    const [sx, sy, sw, sh] = cropCoordsForDims(srcW, srcH, w, h);
    const pen = state.ctx;
    pen.save();
    pen.imageSmoothingEnabled = true;
    if (mirror) { pen.translate(w, 0); pen.scale(-1, 1); }
    pen.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
    pen.restore();
    const src = pen.getImageData(0, 0, w, h).data;
    const { signal, sum, held, level, spot, column, smear } = state;
    const n = w * h, still = options.still || null;
    const noiseScale = options.noise === undefined ? 1 : options.noise;
    const dt = state.last < 0 || now < state.last || now - state.last > 400 ? -1 : now - state.last;
    state.last = now;

    // 1 · Sensor: señal monocroma lineal; las zonas quemadas de la entrada alimentan el smear.
    column.fill(0);
    const toLogical = LOGICAL_W / w;
    let meter = 0, weight = 0;
    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p++) {
        const i = p << 2, r = src[i], g = src[i + 1], b = src[i + 2];
        const s = linR[r] + linG[g] + linB[b];
        signal[p] = s;
        if (r > 238 && g > 238 && b > 228) column[(x * toLogical) | 0] += 1;
        const lit = s * spot[p];
        // Medición ponderada al centro; una lámpara cuenta, pero no manda sola.
        meter += (lit > 0.2 ? 0.2 : lit) * spot[p];
        weight += spot[p];
      }
    }
    meter /= weight;

    // 2 · AGC con inercia: baja rápido ante una luz, sube despacio al oscurecer.
    const wanted = Math.max(1, Math.min(12, 0.13 / (meter + 0.0035)));
    if (still) state.gain = still.gain || wanted;
    else if (dt < 0 || !state.gain) state.gain = wanted;
    else state.gain += (wanted - state.gain) * (1 - Math.exp(-dt / (wanted < state.gain ? 140 : 420)));
    const gain = state.gain;

    // 3 · Ruido del sensor (lectura + fotones), que la ganancia amplifica.
    const seed = (Math.floor(now / 16.6) * 2654435761) >>> 0;
    const logicalH = state.logicalH, toLogicalY = logicalH / h;
    const exposure = still ? (still.exposure || 0) : exposureFor(gain);
    // Una foto suelta equivale a la integración que el visor ya lleva hecha.
    const stillFactor = still ? 1 / Math.sqrt(Math.max(1, exposure / 33.3)) : 1;
    const read = 0.0013 * noiseScale * stillFactor, shot = 0.00026 * noiseScale * noiseScale * stillFactor * stillFactor;
    if (noiseScale > 0) {
      for (let y = 0, p = 0; y < h; y++) {
        const ly = (y * toLogicalY) | 0;
        for (let x = 0; x < w; x++, p++) {
          const lx = (x * toLogical) | 0;
          const s = signal[p];
          const grain = hash(lx, ly, seed) + hash(lx + 131, ly + 71, seed ^ 0x5bd1e995) - 1;
          signal[p] = s + grain * 2.45 * Math.sqrt(read * read + shot * s);
        }
      }
    }

    // 4 · Obturador lento: suma cuadros hasta completar la exposición y entonces actualiza.
    if (still || exposure <= 0 || dt < 0 || !state.ready) {
      held.set(signal);
      sum.fill(0); state.count = 0; state.elapsed = 0; state.ready = true;
    } else {
      for (let p = 0; p < n; p++) sum[p] += signal[p];
      state.count++; state.elapsed += dt;
      if (state.elapsed >= exposure - 4) {
        const inv = 1 / state.count;
        for (let p = 0; p < n; p++) { held[p] = sum[p] * inv; sum[p] = 0; }
        state.count = 0; state.elapsed = 0;
      }
    }
    state.exposure = exposure;

    // 5 · Smear vertical del CCD: la columna de una fuente saturada se aclara entera.
    const smearGain = 0.12 * Math.min(1, gain / 3.5) / logicalH * (LOGICAL_W / w) * toLogicalY;
    let anySmear = false;
    for (let x = 0; x < LOGICAL_W; x++) {
      const left = column[x > 0 ? x - 1 : x], right = column[x < LOGICAL_W - 1 ? x + 1 : x];
      smear[x] = Math.min(0.05, (left + 2 * column[x] + right) * 0.25 * smearGain);
      if (smear[x] > 0.0005) anySmear = true;
    }

    // 6 · Ganancia, iluminador y curva de tono; el exceso sobre la saturación alimenta el halo.
    const contrast = options.contrast || 0;
    const tone = toneCurve(contrast);
    const toneScale = TONE_N / TONE_MAX;
    const { bloom, bloomTmp, bloomH } = state;
    bloom.fill(0);
    const toBloomX = BLOOM_W / w, toBloomY = bloomH / h;
    for (let y = 0, p = 0; y < h; y++) {
      const by = ((y * toBloomY) | 0) * BLOOM_W;
      for (let x = 0; x < w; x++, p++) {
        let v = held[p] * gain * spot[p];
        if (anySmear) v += smear[(x * toLogical) | 0];
        if (v > 0.8) bloom[by + ((x * toBloomX) | 0)] += v > 2.2 ? 1.4 : v - 0.8;
        level[p] = tone[v <= 0 ? 0 : v >= TONE_MAX ? TONE_N : (v * toneScale) | 0];
      }
    }

    // 7 · Realce horizontal de bordes (corrección de apertura) y tinte.
    const out = state.image.data;
    const sharp = (options.sharp === undefined ? 1 : options.sharp) * 0.42;
    const reach = Math.max(1, Math.round(w / LOGICAL_W));
    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p++) {
        const here = level[p];
        const left = level[x >= reach ? p - reach : p], right = level[x < w - reach ? p + reach : p];
        let v = here + (here - (left + right) * 0.5) * sharp;
        v = v <= 0 ? 0 : v >= 255 ? 255 : v | 0;
        const i = p << 2, t = v * 3;
        out[i] = tint[t]; out[i + 1] = tint[t + 1]; out[i + 2] = tint[t + 2]; out[i + 3] = 255;
      }
    }
    pen.putImageData(state.image, 0, 0);

    targetCtx.save();
    targetCtx.globalAlpha = 1;
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.filter = 'none';
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.imageSmoothingQuality = 'high';
    targetCtx.drawImage(state.canvas, 0, 0, outW, outH);

    // 8 · Halo de las altas luces: una rejilla pequeña difuminada y ampliada, sin filtros de canvas.
    const cellArea = (w / BLOOM_W) * (h / bloomH);
    let anyBloom = false;
    for (let pass = 0; pass < 2; pass++) {
      const from = pass ? bloomTmp : bloom, to = pass ? bloom : bloomTmp;
      for (let y = 0; y < bloomH; y++) for (let x = 0; x < BLOOM_W; x++) {
        const row = y * BLOOM_W;
        const a = pass ? from[(y > 0 ? y - 1 : y) * BLOOM_W + x] : from[row + (x > 0 ? x - 1 : x)];
        const c = pass ? from[(y < bloomH - 1 ? y + 1 : y) * BLOOM_W + x] : from[row + (x < BLOOM_W - 1 ? x + 1 : x)];
        to[row + x] = (a + 2 * from[row + x] + c) * 0.25;
      }
    }
    const glow = state.bloomImage.data;
    for (let p = 0; p < bloom.length; p++) {
      const amount = Math.min(1, bloom[p] / cellArea * 1.7);
      if (amount > 0.004) anyBloom = true;
      const i = p << 2;
      glow[i] = 178; glow[i + 1] = 240; glow[i + 2] = 226; glow[i + 3] = Math.round(amount * 255);
    }
    if (anyBloom) {
      state.bloomCtx.putImageData(state.bloomImage, 0, 0);
      targetCtx.globalCompositeOperation = 'screen';
      targetCtx.globalAlpha = 0.85;
      targetCtx.drawImage(state.bloomCanvas, 0, 0, outW, outH);
      targetCtx.globalAlpha = 1;
    }
    // 9 · Estructura de líneas del campo de vídeo.
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.drawImage(scanlines(state, outW, outH), 0, 0, outW, outH);
    targetCtx.imageSmoothingEnabled = false;
    targetCtx.restore();
    return state;
  }

  // Estado del visor para que la foto herede su exposición.
  function snapshot(ctx) {
    const state = states.get(ctx);
    return state && state.gain ? { gain: state.gain, exposure: state.exposure || 0 } : null;
  }
  function reset(ctx) { states.delete(ctx); }

  return { render, snapshot, reset, exposureFor, tint };
})();
