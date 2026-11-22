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

// ── VECTOR ───────────────────────────────────────────────────────────
// Referencia: osciloscopio analógico en X-Y con fósforo P31 y blanking por el eje Z.
// La escena se convierte en trazos que un haz recorre uno tras otro:
//   1. La luminancia se promedia en el tiempo solo donde no hay movimiento: el ruido del
//      sensor no llega al contorno y un objeto que se mueve responde en el mismo cuadro.
//   2. Un borde es el cruce por cero de una diferencia de gaussianas. Cada borde da un
//      único trazo con posición subpíxel, sin escalones ni líneas dobles.
//   3. Los cruces se enlazan en cadenas. Se dibujan las más largas y contrastadas hasta
//      agotar el recorrido que el haz puede cubrir en un cuadro.
//   4. El haz se apaga en los saltos, se demora en extremos y esquinas (puntos brillantes)
//      y reparte su energía: cuanto más recorrido, menos brillo.
//   5. El fósforo guarda los trazos anteriores y los apaga con una caída rápida y una
//      cola corta. Lo que sigue quieto acumula luz; lo que se va, se desvanece.
const VECTOR_COLS = 192;

function createVectorState(cols, rows) {
  const n = cols * rows;
  return {
    cols, rows,
    smooth: new Float32Array(n), fine: new Float32Array(n), wide: new Float32Array(n),
    tmp: new Float32Array(n), grad: new Float32Array(n),
    seen: new Uint8Array(n), drawn: new Uint8Array(n),
    px: new Float32Array(2 * n), py: new Float32Array(2 * n), strength: new Float32Array(2 * n),
    linkA: new Int32Array(2 * n).fill(-1), linkB: new Int32Array(2 * n).fill(-1), used: new Uint8Array(2 * n),
    active: [], frames: [], chains: [], primed: false,
  };
}

// Binomial separable [1 4 6 4 1] / 16, σ ≈ 1 celda.
function vectorBlur(src, dst, tmp, cols, rows) {
  for (let y = 0; y < rows; y++) {
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      const l2 = src[row + (x > 1 ? x - 2 : 0)], l1 = src[row + (x > 0 ? x - 1 : 0)];
      const r1 = src[row + (x < cols - 1 ? x + 1 : cols - 1)], r2 = src[row + (x < cols - 2 ? x + 2 : cols - 1)];
      tmp[row + x] = (l2 + r2 + 4 * (l1 + r1) + 6 * src[row + x]) * 0.0625;
    }
  }
  for (let y = 0; y < rows; y++) {
    const u2 = (y > 1 ? y - 2 : 0) * cols, u1 = (y > 0 ? y - 1 : 0) * cols;
    const d1 = (y < rows - 1 ? y + 1 : rows - 1) * cols, d2 = (y < rows - 2 ? y + 2 : rows - 1) * cols, row = y * cols;
    for (let x = 0; x < cols; x++) {
      dst[row + x] = (tmp[u2 + x] + tmp[d2 + x] + 4 * (tmp[u1 + x] + tmp[d1 + x]) + 6 * tmp[row + x]) * 0.0625;
    }
  }
}

// Devuelve las cadenas de contorno del cuadro, ya filtradas y en el orden del haz.
function vectorContours(V, luma, sensitivity, detail, firstFrame) {
  const { cols, rows, smooth, fine, wide, tmp, grad, px, py, strength, linkA, linkB, used } = V;
  const n = cols * rows;
  if (firstFrame) smooth.set(luma);
  else {
    for (let p = 0; p < n; p++) {
      const d = luma[p] - smooth[p], ad = d < 0 ? -d : d;
      smooth[p] += d * (ad > 0.06 ? 1 : ad > 0.022 ? 0.5 : 0.2);
    }
  }
  vectorBlur(smooth, fine, tmp, cols, rows);
  vectorBlur(fine, wide, tmp, cols, rows);
  vectorBlur(wide, wide, tmp, cols, rows);
  // wide pasa a ser la diferencia de gaussianas; su cruce por cero marca el borde.
  const hist = new Uint32Array(64);
  for (let y = 0; y < rows; y++) {
    const up = (y > 0 ? y - 1 : y) * cols, dn = (y < rows - 1 ? y + 1 : y) * cols, row = y * cols;
    for (let x = 0; x < cols; x++) {
      const p = row + x;
      const gx = fine[row + (x < cols - 1 ? x + 1 : x)] - fine[row + (x > 0 ? x - 1 : x)];
      const gy = fine[dn + x] - fine[up + x];
      const g = Math.sqrt(gx * gx + gy * gy) * 0.5;
      grad[p] = g;
      hist[g >= 0.063 ? 63 : (g * 1000) | 0]++;
      wide[p] = fine[p] - wide[p];
    }
  }
  // Umbral: un suelo absoluto que fija SENSITIVITY y otro relativo a la textura de la escena.
  let acc = 0, median = 0;
  while (median < 63 && (acc += hist[median]) < n / 2) median++;
  const high = Math.max(0.0105 * (1.9 - 1.5 * sensitivity), (median + 0.5) * 0.001 * 3.2);
  const low = high * 0.42;

  for (const e of V.active) { linkA[e] = -1; linkB[e] = -1; used[e] = 0; }
  const active = V.active; active.length = 0;
  function cross(e) {
    if (linkA[e] !== -1) return;
    const p = e >> 1, q = e & 1 ? p + cols : p + 1;
    const a = wide[p], b = wide[q], t = a / (a - b);
    const x = p % cols, y = (p / cols) | 0;
    if (e & 1) { px[e] = x; py[e] = y + t; } else { px[e] = x + t; py[e] = y; }
    strength[e] = grad[p] + (grad[q] - grad[p]) * t;
    active.push(e);
  }
  function link(a, b) {
    cross(a); cross(b);
    if (linkA[a] === -1) linkA[a] = b; else linkB[a] = b;
    if (linkA[b] === -1) linkA[b] = a; else linkB[b] = a;
  }
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const p = y * cols + x;
      if (grad[p] < low && grad[p + 1] < low && grad[p + cols] < low && grad[p + cols + 1] < low) continue;
      const a = wide[p] > 0, b = wide[p + 1] > 0, c = wide[p + cols + 1] > 0, d = wide[p + cols] > 0;
      if (a === b && b === c && c === d) continue;
      const top = 2 * p, right = 2 * (p + 1) + 1, bottom = 2 * (p + cols), left = 2 * p + 1;
      const t = a !== b, r = b !== c, m = c !== d, l = d !== a;
      if (t && r && m && l) {
        const centre = wide[p] + wide[p + 1] + wide[p + cols] + wide[p + cols + 1] > 0;
        if (a === centre) { link(top, right); link(bottom, left); } else { link(top, left); link(right, bottom); }
      } else if (t && r) link(top, right);
      else if (t && m) link(top, bottom);
      else if (t && l) link(top, left);
      else if (r && m) link(right, bottom);
      else if (r && l) link(right, left);
      else if (m && l) link(bottom, left);
    }
  }
  // Recorre las cadenas: primero las abiertas desde un extremo, después los lazos.
  const chains = [];
  const minLength = 5 + (1 - detail) * 9;
  const { seen, drawn } = V;
  function walk(start, closed) {
    const points = [];
    let e = start, length = 0, peak = 0, sum = 0, kept = 0, lastX = 0, lastY = 0;
    while (e !== -1 && !used[e]) {
      used[e] = 1;
      const x = px[e], y = py[e];
      if (points.length) length += Math.hypot(x - lastX, y - lastY);
      points.push(x, y); lastX = x; lastY = y;
      const s = strength[e];
      sum += s; if (s > peak) peak = s;
      if (drawn[(y | 0) * cols + (x | 0)]) kept++;
      const a = linkA[e], b = linkB[e];
      e = a !== -1 && !used[a] ? a : b !== -1 && !used[b] ? b : -1;
    }
    const count = points.length / 2;
    if (closed) length += Math.hypot(points[0] - lastX, points[1] - lastY);
    // Un contorno que ya estaba en pantalla se mantiene con menos contraste: no parpadea en el umbral.
    const steady = kept > count * 0.45;
    if (count < 3 || length < minLength || peak < (steady ? high * 0.68 : high)) return;
    chains.push({ points, closed, length, peak, mean: sum / count, score: length * (sum / count) * (steady ? 1.3 : 1) });
  }
  for (const e of active) if (!used[e] && linkB[e] === -1) walk(e, false);
  for (const e of active) if (!used[e]) walk(e, true);

  // Presupuesto del haz: primero lo más largo y contrastado.
  chains.sort((a, b) => b.score - a.score);
  const budget = 900 + detail * 2600;
  let total = 0, keep = 0;
  while (keep < chains.length && keep < 260 && total + chains[keep].length <= budget) total += chains[keep++].length;
  chains.length = keep;
  seen.fill(0);
  for (const chain of chains) {
    const pts = chain.points, count = pts.length / 2;
    // Suaviza las facetas de la rejilla; el ancho de banda de la deflexión redondea igual.
    for (let pass = 0; pass < 2; pass++) {
      let prevX = pts[chain.closed ? pts.length - 2 : 0], prevY = pts[chain.closed ? pts.length - 1 : 1];
      const firstX = pts[0], firstY = pts[1];
      for (let i = chain.closed ? 0 : 1; i < (chain.closed ? count : count - 1); i++) {
        const x = pts[2 * i], y = pts[2 * i + 1];
        const nextX = i === count - 1 ? firstX : pts[2 * i + 2], nextY = i === count - 1 ? firstY : pts[2 * i + 3];
        pts[2 * i] = (prevX + 2 * x + nextX) * 0.25; pts[2 * i + 1] = (prevY + 2 * y + nextY) * 0.25;
        prevX = x; prevY = y;
      }
    }
    for (let i = 0; i < count; i++) {
      const cx = pts[2 * i] | 0, cy = pts[2 * i + 1] | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const x = cx + ox, y = cy + oy;
        if (x >= 0 && y >= 0 && x < cols && y < rows) seen[y * cols + x] = 1;
      }
    }
    if (chain.closed) {
      // Un lazo empieza siempre en su punto más alto: el punto de arranque no salta de cuadro a cuadro.
      let best = 0;
      for (let i = 1; i < count; i++) if (pts[2 * i + 1] < pts[2 * best + 1] - 1e-4 || (Math.abs(pts[2 * i + 1] - pts[2 * best + 1]) <= 1e-4 && pts[2 * i] < pts[2 * best])) best = i;
      if (best) chain.points = pts.slice(2 * best).concat(pts.slice(0, 2 * best));
    }
  }
  V.drawn.set(seen);
  // Orden del haz: desde donde quedó, al extremo más cercano del siguiente trazo.
  const ordered = [];
  let beamX = cols / 2, beamY = rows / 2;
  const pending = chains.slice();
  while (pending.length) {
    let best = 0, bestD = Infinity, flip = false;
    for (let i = 0; i < pending.length; i++) {
      const pts = pending[i].points, last = pts.length - 2;
      const d0 = (pts[0] - beamX) ** 2 + (pts[1] - beamY) ** 2;
      if (d0 < bestD) { bestD = d0; best = i; flip = false; }
      if (!pending[i].closed) {
        const d1 = (pts[last] - beamX) ** 2 + (pts[last + 1] - beamY) ** 2;
        if (d1 < bestD) { bestD = d1; best = i; flip = true; }
      }
    }
    const chain = pending.splice(best, 1)[0];
    if (flip) {
      const pts = chain.points, reversed = new Array(pts.length);
      for (let i = 0; i < pts.length; i += 2) { reversed[i] = pts[pts.length - 2 - i]; reversed[i + 1] = pts[pts.length - 1 - i]; }
      chain.points = reversed;
    }
    const end = chain.closed ? 0 : chain.points.length - 2;
    beamX = chain.points[end]; beamY = chain.points[end + 1];
    ordered.push(chain);
  }
  V.high = high; V.total = total;
  return ordered;
}

function plotVectorBeam(state, luma, cols, rows, ctx, w, h, now, reset) {
  let V = state.vector;
  if (!V || V.cols !== cols || V.rows !== rows) V = state.vector = createVectorState(cols, rows);
  if (!V.pool) V.pool = [];
  if (reset) { for (const old of V.frames) V.pool.push(old.layer); V.frames.length = 0; V.drawn.fill(0); V.primed = false; }
  const palette = _oscamColorBasis();
  const chains = vectorContours(V, luma, oscamIntensityVal / 100, oscamDefinitionVal / 100, !V.primed);
  V.primed = true;
  V.chains = chains;
  const sx = w / (cols - 1), sy = h / (rows - 1);
  const core = Math.max(1.1, w / 850) * (0.55 + oscamDetailVal / 65);
  const path = new Path2D(), dots = new Path2D(), flare = new Path2D();
  const dot = (x, y, r) => { dots.moveTo(x + r, y); dots.arc(x, y, r, 0, 6.2832); flare.moveTo(x + r * 2.6, y); flare.arc(x, y, r * 2.6, 0, 6.2832); };
  for (const chain of chains) {
    const pts = chain.points, count = pts.length / 2;
    path.moveTo(pts[0] * sx, pts[1] * sy);
    for (let i = 1; i < count; i++) path.lineTo(pts[2 * i] * sx, pts[2 * i + 1] * sy);
    if (chain.closed) path.closePath();
    // El haz se asienta donde arranca y donde termina; en un giro brusco pierde velocidad.
    dot(pts[0] * sx, pts[1] * sy, core * 0.85);
    if (!chain.closed) dot(pts[pts.length - 2] * sx, pts[pts.length - 1] * sy, core * 0.85);
    for (let i = 2; i < count - 2; i++) {
      const ax = pts[2 * i] - pts[2 * i - 4], ay = pts[2 * i + 1] - pts[2 * i - 3];
      const bx = pts[2 * i + 4] - pts[2 * i], by = pts[2 * i + 5] - pts[2 * i + 1];
      const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-6);
      if (cos < 0.42) { dot(pts[2 * i] * sx, pts[2 * i + 1] * sy, core * 0.68); i += 3; }
    }
  }
  // Energía por unidad de recorrido: una escena cargada se dibuja más tenue.
  const energy = Math.max(0.5, Math.min(1, Math.sqrt(1000 / Math.max(1, V.total))));
  const tauFast = 18 + oscamPresenceVal * 0.5, tauSlow = 40 + oscamPresenceVal * 1.2;
  const glow = oscamTraceVal / 100;
  const frames = V.frames;
  // Una toma suelta (foto) no tiene historia: se le da la luz acumulada de un trazo quieto.
  const settled = frames.length ? 1 : 2;
  const base = palette.base.join(','), hot = palette.hot.join(',');
  // Cada cuadro se traza una sola vez en su propia capa; el resplandor de los cuadros anteriores
  // se compone con imágenes. Volver a trazar toda la historia en cada cuadro (ocho trazos de
  // miles de segmentos) dejaba la pantalla de un Pixel 10 en 20 fps. Las capas se reducen en
  // lienzos grandes para acotar la memoria; el trazo no baja de un píxel de capa.
  const layerScale = Math.min(1, Math.sqrt(520000 / (w * h)));
  const lw = Math.max(1, Math.round(w * layerScale)), lh = Math.max(1, Math.round(h * layerScale));
  const layer = V.pool.pop() || document.createElement('canvas');
  if (layer.width !== lw || layer.height !== lh) { layer.width = lw; layer.height = lh; }
  const pen = layer.getContext('2d');
  pen.setTransform(lw / w, 0, 0, lh / h, 0, 0);
  pen.globalCompositeOperation = 'source-over';
  pen.globalAlpha = 1;
  pen.clearRect(0, 0, w, h);
  pen.globalCompositeOperation = 'lighter';
  pen.lineCap = 'round';
  pen.lineJoin = 'round';
  pen.strokeStyle = 'rgb(' + base + ')';
  pen.lineWidth = Math.max(core * 0.9, 1.05 / layerScale);
  pen.stroke(path);
  pen.fillStyle = 'rgba(' + hot + ',0.893)';
  pen.fill(dots);
  frames.push({ time: now, path, dots, energy, layer });

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = 'rgb(' + palette.bg.join(',') + ')';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(' + palette.base.join(',') + ',0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 1; k < 10; k++) { const x = Math.round((w * k) / 10) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let k = 1; k < 8; k++) { const y = Math.round((h * k) / 8) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
  // Divisiones menores sobre los ejes centrales, como la retícula interna de un Tektronix.
  for (let k = 1; k < 50; k++) { const x = (w * k) / 50; ctx.moveTo(x, h / 2 - h * 0.006); ctx.lineTo(x, h / 2 + h * 0.006); }
  for (let k = 1; k < 40; k++) { const y = (h * k) / 40; ctx.moveTo(w / 2 - h * 0.006, y); ctx.lineTo(w / 2 + h * 0.006, y); }
  ctx.stroke();

  ctx.globalCompositeOperation = 'lighter';
  // El trazo nuevo es del color del fósforo; el blanco del núcleo sale de la luz que se acumula.
  const fresh = palette.base.map((v, k) => Math.round(v + (palette.hot[k] - v) * 0.35)).join(',');
  let first = 0;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  for (let i = 0; i < frames.length - 1; i++) {
    const frame = frames[i], age = now - frame.time;
    const weight = age <= 0 ? 1 : 0.8 * Math.exp(-age / tauFast) + 0.2 * Math.exp(-age / tauSlow);
    if (weight < 0.02) { first = i + 1; continue; }
    ctx.globalAlpha = Math.min(1, 0.56 * weight * frame.energy);
    ctx.drawImage(frame.layer, 0, 0, w, h);
  }
  ctx.imageSmoothingEnabled = smooth;
  ctx.globalAlpha = 1;
  {
    const level = energy * settled;
    if (glow > 0) {
      // Halo del vidrio y dispersión del fósforo: la capa del cuadro, reducida a la mitad tres
      // veces y devuelta a su tamaño. Dos trazos anchos costaban más que todo lo demás.
      const bloom = V.bloom || (V.bloom = [0, 1, 2].map(() => document.createElement('canvas')));
      let from = layer, bw = lw, bh = lh;
      for (const small of bloom) {
        bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
        if (small.width !== bw || small.height !== bh) { small.width = bw; small.height = bh; }
        const g = small.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.imageSmoothingEnabled = true;
        g.drawImage(from, 0, 0, bw, bh);
        from = small;
      }
      const soft = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = Math.min(1, 0.67 * glow * level);
      ctx.drawImage(bloom[2], 0, 0, w, h);
      ctx.drawImage(bloom[0], 0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = soft;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(' + fresh + ',' + Math.min(1, 0.56 * level).toFixed(3) + ')';
    ctx.lineWidth = core;
    ctx.stroke(path);
    ctx.fillStyle = 'rgba(' + hot + ',' + Math.min(1, 0.5 * level).toFixed(3) + ')';
    ctx.fill(dots);
    ctx.fillStyle = 'rgba(' + base + ',' + Math.min(1, 0.26 * (0.4 + glow) * level).toFixed(3) + ')';
    ctx.fill(flare);
  }
  if (first) for (const old of frames.splice(0, first)) V.pool.push(old.layer);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgb(' + hot + ')';
  ctx.font = Math.max(11, w / 57) + 'px monospace';
  ctx.fillText('VECTOR  ·  CONTORNO', w * 0.028, h * 0.065);
  ctx.restore();
}

function plotOpticalScope(source, srcW, srcH, ctx, mirror, mode, now) {
  const w = ctx.canvas.width,
    h = ctx.canvas.height;
  let state = opticalScopes.get(ctx);
  if (!state) {
    state = createOpticalScope();
    opticalScopes.set(ctx, state);
  }
  if (mode === 'STD') {
    // VECTOR muestrea la escena en celdas cuadradas con la proporción del visor.
    const cols = VECTOR_COLS, rows = Math.max(48, Math.min(384, Math.round((VECTOR_COLS * h) / w)));
    if (!state.vectorInput || state.vectorInput.canvas.height !== rows) {
      const canvas = document.createElement('canvas');
      canvas.width = cols; canvas.height = rows;
      state.vectorInput = canvas.getContext('2d', { willReadFrequently: true });
      state.vectorLuma = new Float32Array(cols * rows);
    }
    const pen = state.vectorInput, luma = state.vectorLuma;
    pen.save();
    pen.imageSmoothingEnabled = true;
    pen.imageSmoothingQuality = 'high';
    if (mirror) { pen.translate(cols, 0); pen.scale(-1, 1); }
    pen.drawImage(source, ...cropCoordsForDims(srcW, srcH, w, h), 0, 0, cols, rows);
    pen.restore();
    const pixels = pen.getImageData(0, 0, cols, rows).data;
    for (let j = 0, i = 0; j < luma.length; j++, i += 4) {
      luma[j] = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    }
    const key = 'STD' + oscamColorMode + w + 'x' + h;
    const reset = state.mode !== key || state.source !== source || now - state.last > 650 || now < state.last;
    state.mode = key; state.source = source; state.last = now;
    plotVectorBeam(state, luma, cols, rows, ctx, w, h, now, reset);
    return;
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
  if (mode === 'XY') {
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
