'use strict';

// An optical pickup: one horizontal line is a spatial signal. Only TIME uses a clock.
const opticalScopes = new WeakMap();
const scopeSamples = 256;
const hannWindow = Float32Array.from(
  { length: scopeSamples },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (scopeSamples - 1)),
);

function opticalSpectrum(line, real, imag, spectrum) {
  const n = line.length;
  let dc = 0;
  for (const value of line) dc += value / n;
  imag.fill(0);
  for (let i = 0, j = 0; i < n; i++) {
    real[j] = (line[i] - dc) * hannWindow[i];
    let bit = n >> 1;
    while (bit && j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size >> 1,
      phase = (-2 * Math.PI) / size;
    const c = Math.cos(phase),
      s = Math.sin(phase);
    for (let start = 0; start < n; start += size) {
      let wr = 1,
        wi = 0;
      for (let k = start; k < start + half; k++) {
        const q = k + half;
        const tr = wr * real[q] - wi * imag[q],
          ti = wr * imag[q] + wi * real[q];
        real[q] = real[k] - tr;
        imag[q] = imag[k] - ti;
        real[k] += tr;
        imag[k] += ti;
        const next = wr * c - wi * s;
        wi = wr * s + wi * c;
        wr = next;
      }
    }
  }
  let peak = 0;
  spectrum[0] = 0;
  for (let k = 1; k < spectrum.length; k++) {
    spectrum[k] = (4 * Math.hypot(real[k], imag[k])) / (n - 1);
    if (spectrum[k] > Math.max(0.012, spectrum[peak])) peak = k;
  }
  return peak;
}

function createOpticalScope() {
  const canvas = document.createElement('canvas');
  canvas.width = scopeSamples;
  canvas.height = 96;
  return {
    input: canvas.getContext('2d', { willReadFrequently: true }),
    luma: new Float32Array(canvas.width * canvas.height),
    line: new Float32Array(scopeSamples),
    real: new Float32Array(scopeSamples),
    imag: new Float32Array(scopeSamples),
    spectrum: new Float32Array(scopeSamples / 2),
    history: [],
    beam: document.createElement('canvas'),
  };
}

// Marching squares converts isoluminance contours into pairs of X/Y beam deflections.
function traceIsolines(ctx, luma, cols, rows, w, h, levels) {
  const step = 2,
    dx = w / (cols - 1),
    dy = h / (rows - 1);
  for (const level of levels) {
    for (let y = 0; y < rows - step; y += step) {
      for (let x = 0; x < cols - step; x += step) {
        const i = y * cols + x;
        const a = luma[i],
          b = luma[i + step],
          c = luma[i + step * cols + step],
          d = luma[i + step * cols];
        const A = a >= level,
          B = b >= level,
          C = c >= level,
          D = d >= level;
        if (A === B && B === C && C === D) continue;
        let firstX,
          firstY,
          count = 0;
        function edge(px, py) {
          if (count++ % 2 === 0) {
            firstX = px;
            firstY = py;
          } else {
            ctx.moveTo(firstX * dx, firstY * dy);
            ctx.lineTo(px * dx, py * dy);
          }
        }
        if (A !== B) edge(x + (step * (level - a)) / (b - a), y);
        if (B !== C) edge(x + step, y + (step * (level - b)) / (c - b));
        if (C !== D) edge(x + (step * (level - d)) / (c - d), y + step);
        if (D !== A) edge(x, y + (step * (level - a)) / (d - a));
      }
    }
  }
}

function plotOpticalScope(source, srcW, srcH, ctx, mirror, mode, now) {
  const w = ctx.canvas.width,
    h = ctx.canvas.height;
  let state = opticalScopes.get(ctx);
  if (!state) {
    state = createOpticalScope();
    opticalScopes.set(ctx, state);
  }
  const { input, luma, line, beam } = state;
  const cols = input.canvas.width,
    rows = input.canvas.height;
  const crop = cropCoordsForDims(srcW, srcH, w, h);
  input.save();
  if (mirror) {
    input.translate(cols, 0);
    input.scale(-1, 1);
  }
  input.drawImage(source, ...crop, 0, 0, cols, rows);
  input.restore();
  const pixels = input.getImageData(0, 0, cols, rows).data;
  let average = 0;
  for (let j = 0, i = 0; j < luma.length; j++, i += 4) {
    luma[j] = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    average += luma[j];
  }
  average /= luma.length;
  const familyKey = mode + oscamColorMode;
  const reset =
    beam.width !== w ||
    beam.height !== h ||
    state.mode !== familyKey ||
    state.source !== source ||
    now - state.last > 650 ||
    now < state.last;
  if (reset) {
    beam.width = w;
    beam.height = h;
    state.mode = familyKey;
    state.source = source;
    state.decodedFrame = undefined;
    state.history.length = 0;
  }
  const scan = Math.min(rows - 2, Math.max(1, Math.round(((rows - 1) * oscamDefinitionVal) / 100)));
  for (let x = 0; x < cols; x++)
    line[x] =
      (luma[(scan - 1) * cols + x] + 2 * luma[scan * cols + x] + luma[(scan + 1) * cols + x]) / 4;
  const pen = beam.getContext('2d'),
    palette = _oscamColorBasis();
  const dt = reset ? 1000 : Math.max(1, now - state.last);
  state.last = now;
  pen.fillStyle =
    'rgba(1,8,7,' + (reset ? 1 : 1 - Math.exp(-dt / (10 + oscamPresenceVal * 1.6))) + ')';
  pen.fillRect(0, 0, w, h);
  pen.lineWidth = Math.max(0.6, w / 850) * (0.55 + oscamDetailVal / 65);
  pen.strokeStyle = 'rgb(' + palette.base.join(',') + ')';
  pen.beginPath();
  const gain = 0.55 + oscamIntensityVal / 55;
  let label;
  if (mode === 'STD') {
    const levels = [0.19, 0.38, 0.58, 0.78].map((v) =>
      Math.min(0.95, v / gain + 0.06 * (scan / rows - 0.5)),
    );
    traceIsolines(pen, luma, cols, rows, w, h, levels);
    label = 'VECTOR  ·  CONTORNO';
  } else if (mode === 'XY') {
    // A horizontal sweep reads two optical pickups simultaneously. Equal signals
    // produce a diagonal; equal-frequency signals in quadrature produce an ellipse.
    const separation = Math.round(((rows - 1) * oscamDefinitionVal) / 100);
    const rowA = Math.floor((rows - 1 - separation) / 2),
      rowB = rowA + separation;
    const scale = Math.min(w, h) * 0.86 * gain;
    for (let i = 0; i < cols; i++) {
      const x = w / 2 + (luma[rowA * cols + i] - 0.5) * scale;
      const y = h / 2 - (luma[rowB * cols + i] - 0.5) * scale;
      if (i === 0) {
        pen.moveTo(x, y);
        pen.lineTo(x + 0.3, y);
      } else pen.lineTo(x, y);
    }
    label = 'X–Y  ·  FILAS ' + (rowA + 1) + ' / ' + (rowB + 1);
  } else if (mode === 'FFT') {
    const peak = opticalSpectrum(line, state.real, state.imag, state.spectrum);
    state.peak = peak;
    state.spectrum.forEach((v, k) => {
      const db = Math.max(-54, 20 * Math.log10(Math.max(0.00001, v * gain)));
      const x = (k * w) / (state.spectrum.length - 1),
        y = h * (0.88 - Math.min(1, (db + 54) / 54) * 0.75);
      if (k) pen.lineTo(x, y);
      else pen.moveTo(x, y);
    });
    label = peak ? 'FFT  ·  ' + peak + ' ciclos/ancho' : 'FFT  ·  DC';
  } else {
    // Average scene light at actual decoded frame times. Canvas sources use the render clock.
    const time = Number.isFinite(source.currentTime) ? source.currentTime * 1000 : now;
    const hist = state.history;
    if (hist.length && time < hist[hist.length - 1].t) hist.length = 0;
    const frame = source.getVideoPlaybackQuality?.().totalVideoFrames;
    if (
      (!hist.length || time > hist[hist.length - 1].t) &&
      (frame === undefined || frame !== state.decodedFrame)
    ) {
      hist.push({ t: time, v: average });
      state.decodedFrame = frame;
    }
    while (hist.length && hist[0].t < time - 2000) hist.shift();
    let lo = 1,
      hi = 0;
    for (const q of hist) {
      lo = Math.min(lo, q.v);
      hi = Math.max(hi, q.v);
    }
    let intervalsSquared = 0;
    let crossings = 0,
      first = 0,
      last = 0,
      armed = false;
    const mid = (lo + hi) / 2;
    hist.forEach((q, k) => {
      const x = w * (1 - (time - q.t) / 2000),
        y = h * (0.5 - (q.v - 0.5) * Math.min(1.7, gain) * 0.78);
      if (k) pen.lineTo(x, y);
      else pen.moveTo(x, y);
      if (q.v < mid - 0.015) armed = true;
      if (armed && k && q.v >= mid && hist[k - 1].v < mid) {
        const prev = hist[k - 1],
          t = prev.t + ((q.t - prev.t) * (mid - prev.v)) / (q.v - prev.v);
        if (!crossings) first = t;
        else intervalsSquared += (t - last) ** 2;
        last = t;
        crossings++;
        armed = false;
      }
    });
    const periods = crossings - 1;
    const period = periods > 0 ? (last - first) / periods : 0;
    const variance = periods > 0 ? intervalsSquared / periods - period * period : 0;
    const periodic = periods >= 2 && variance <= (0.15 * period) ** 2;
    state.hz = periodic && hi - lo > 0.04 ? 1000 / period : 0;
    label = 'TIEMPO  ·  200 ms/div' + (state.hz ? '  ·  ' + state.hz.toFixed(1) + ' Hz' : '');
  }
  pen.stroke();
  ctx.save();
  ctx.drawImage(beam, 0, 0);
  ctx.strokeStyle = 'rgba(' + palette.base.join(',') + ',0.20)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let n = 1; n < 10; n++) {
    const x = (w * n) / 10;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let n = 1; n < 8; n++) {
    const y = (h * n) / 8;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  if (oscamTraceVal > 0) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = oscamTraceVal / 180;
    ctx.filter = 'blur(' + Math.max(1, w / 350) + 'px)';
    ctx.drawImage(beam, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.fillStyle = 'rgb(' + palette.hot.join(',') + ')';
  ctx.font = Math.max(11, w / 57) + 'px monospace';
  ctx.fillText(label, w * 0.028, h * 0.065);
  ctx.restore();
}
