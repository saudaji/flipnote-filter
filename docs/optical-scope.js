'use strict';

// OSCAM · VECTOR: la escena, trazada por el haz de un osciloscopio. (Las variantes X–Y, FFT, TIEMPO
// y LGCY se retiraron en noviembre de 2026; «mode» se conserva en la firma por quien la llama.)
const opticalScopes = new WeakMap();
// Los estados vivos, para poder soltar sus capas cuando OSCAM lleva un rato sin pintarse.
const opticalScopeRefs = [];
function releaseOpticalScopes() {
  for (let i = opticalScopeRefs.length - 1; i >= 0; i--) {
    const state = opticalScopeRefs[i].deref();
    if (!state) { opticalScopeRefs.splice(i, 1); continue; }
    const V = state.vector;
    if (!V) continue;
    for (const frame of V.frames || []) if (frame.layer) { frame.layer.width = 0; frame.layer.height = 0; }
    for (const layer of V.pool || []) { layer.width = 0; layer.height = 0; }
    if (V.frames) V.frames.length = 0;
    if (V.pool) V.pool.length = 0;
    if (V.drawn) V.drawn.fill(0);
    V.primed = false;
  }
}
// El estado de un visor: lo crea plotOpticalScope y lo llena plotVectorBeam (state.vector).
function createOpticalScope() {
  return {};
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
// Rejilla de análisis de VECTOR: hasta 320 columnas y unas 92 000 celdas, para que en 9:16 no
// se dispare el coste. Con 192 columnas se perdían el texto de una pantalla o una rejilla.
const VECTOR_CELLS = 92000, VECTOR_MAX_COLS = 320;
function vectorGrid(w, h) {
  const cols = Math.max(160, Math.min(VECTOR_MAX_COLS, Math.round(Math.sqrt(VECTOR_CELLS * w / h))));
  return [cols, Math.max(48, Math.round(cols * h / w))];
}

function createVectorState(cols, rows) {
  const n = cols * rows;
  return {
    cols, rows,
    smooth: new Float32Array(n), fine: new Float32Array(n), wide: new Float32Array(n),
    tmp: new Float32Array(n), grad: new Float32Array(n),
    seen: new Uint8Array(n), drawn: new Uint8Array(n),
    blockCols: Math.ceil(cols / 8), blockRows: Math.ceil(rows / 8), local: new Float32Array(Math.ceil(cols / 8) * Math.ceil(rows / 8)), localCount: new Uint16Array(Math.ceil(cols / 8) * Math.ceil(rows / 8)), density: new Uint16Array(Math.ceil(cols / 8) * Math.ceil(rows / 8)),
    px: new Float32Array(2 * n), py: new Float32Array(2 * n), strength: new Float32Array(2 * n),
    linkA: new Int32Array(2 * n).fill(-1), linkB: new Int32Array(2 * n).fill(-1), used: new Uint8Array(2 * n),
    // el anclaje del haz: la posición filtrada de cada cruce, su velocidad y el cuadro en que se vio
    fx: new Float32Array(2 * n), fy: new Float32Array(2 * n), fvx: new Float32Array(2 * n), fvy: new Float32Array(2 * n), fAt: new Int32Array(2 * n).fill(-9),
    frameNo: 0, highS: 0, held: [],
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
// stab (0…1) es el mando ESTABILIDAD. A 1 el trazo se ancla (diagnóstico y recetas de Gemini Neon,
// comprobados aquí con la cámara de un Pixel: el trazo se movía 0,13 celdas por cuadro con el teléfono
// quieto y aparecían y desaparecían trazos):
//   · la luz de cada celda se promedia en el tiempo con una rampa continua (los tres escalones de
//     antes hacían saltar el cruce cuando el ruido rozaba un corte), y más cuanto más estabilidad;
//   · el umbral sigue a la escena despacio y con zona muerta (antes saltaba de golpe con la exposición);
//   · cada cruce del contorno con la rejilla recuerda dónde estaba y se filtra en el tiempo (filtro
//     «1 €»: quieto, casi no se mueve; si la figura se mueve, la sigue en el mismo cuadro);
//   · un trazo que falta un cuadro en una zona quieta se sostiene un momento en vez de parpadear;
//   · el haz no invierte trazos ni cambia de punto de arranque de un cuadro al siguiente.
function vectorContours(V, luma, sensitivity, detail, firstFrame, stab = 1, dt = 1 / 30) {
  const { cols, rows, smooth, fine, wide, tmp, grad, px, py, strength, linkA, linkB, used } = V;
  const n = cols * rows;
  if (firstFrame) { smooth.set(luma); V.fAt.fill(-9); V.held.length = 0; V.highS = 0; }
  else {
    const floor = 0.51 + (0.06 - 0.51) * stab;
    for (let p = 0; p < n; p++) {
      const d = luma[p] - smooth[p], ad = d < 0 ? -d : d;
      let k = (ad - 0.014) / 0.041; k = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
      smooth[p] += d * (floor + (1 - floor) * k);
    }
  }
  const frameNo = ++V.frameNo;
  vectorBlur(smooth, fine, tmp, cols, rows);
  vectorBlur(fine, wide, tmp, cols, rows);
  vectorBlur(wide, wide, tmp, cols, rows);
  // wide pasa a ser la diferencia de gaussianas; su cruce por cero marca el borde.
  const hist = V.hist || (V.hist = new Uint32Array(64));
  hist.fill(0);
  const { local, localCount, blockCols } = V;
  local.fill(0); localCount.fill(0);
  for (let y = 0; y < rows; y++) {
    const up = (y > 0 ? y - 1 : y) * cols, dn = (y < rows - 1 ? y + 1 : y) * cols, row = y * cols;
    const blockRow = (y >> 3) * blockCols;
    for (let x = 0; x < cols; x++) {
      const p = row + x;
      const gx = fine[row + (x < cols - 1 ? x + 1 : x)] - fine[row + (x > 0 ? x - 1 : x)];
      const gy = fine[dn + x] - fine[up + x];
      const g = Math.sqrt(gx * gx + gy * gy) * 0.5;
      grad[p] = g;
      hist[g >= 0.063 ? 63 : (g * 1000) | 0]++;
      // Media del gradiente por bloques: lo que es textura (un estuco, una tela) tiene borde por todas partes.
      local[blockRow + (x >> 3)] += g; localCount[blockRow + (x >> 3)]++;
      wide[p] = fine[p] - wide[p];
    }
  }
  for (let b = 0; b < local.length; b++) if (localCount[b]) local[b] /= localCount[b];
  // Umbral: un suelo absoluto que fija SENSITIVITY y otro relativo a la textura de la escena.
  let acc = 0, median = 0;
  while (median < 63 && (acc += hist[median]) < n / 2) median++;
  // (la mediana, afinada dentro de su cubeta: entera, un 2 % de exposición la hacía saltar un escalón)
  const inside = hist[median] ? 1 - (acc - n / 2) / hist[median] : 0.5;
  const raw = Math.max(0.0105 * (1.9 - 1.5 * sensitivity), (median + inside) * 0.001 * 3.2);
  if (!V.highS || firstFrame) V.highS = raw;
  else { const d = raw - V.highS, dead = stab > 0.5 ? 0.0012 : 0; if (Math.abs(d) > dead) V.highS += (d - Math.sign(d) * dead) * (0.12 + 0.88 * (1 - stab)); }
  const high = V.highS;
  const low = high * 0.42;

  for (const e of V.active) { linkA[e] = -1; linkB[e] = -1; used[e] = 0; }
  const active = V.active; active.length = 0;
  // Cruces por bloque: donde hay borde por todas partes (estuco, tela, follaje) es textura.
  const density = V.density;
  density.fill(0);
  function cross(e) {
    if (linkA[e] !== -1) return;
    const p = e >> 1, q = e & 1 ? p + cols : p + 1;
    const a = wide[p], b = wide[q], t = a / (a - b);
    const x = p % cols, y = (p / cols) | 0;
    density[(y >> 3) * blockCols + (x >> 3)]++;
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
  // El anclaje: cada cruce se filtra contra su posición del cuadro anterior (la suya, o la de un
  // vecino si el borde se corrió de celda). Corte bajo cuando está quieto, alto cuando se mueve.
  if (!firstFrame) {
    const { fx, fy, fvx, fvy, fAt } = V, last = frameNo - 1;
    const aD = 1 / (1 + (1 / (6.2832 * 1.5)) / dt), fMin = 0.55 + 4.5 * (1 - stab), beta = 0.22, TAU = 6.2832;
    const near = [0, 2, -2, 2 * cols, -2 * cols, 1, -1, 2 * cols + 1, -2 * cols + 1, 2 * cols - 1, -2 * cols - 1, 3, -3];
    for (const e of active) {
      const x = px[e], y = py[e];
      let from = -1, best = 2.6;                                          // (1,6 celdas)²
      for (let k = 0; k < near.length; k++) {
        const o = e + near[k];
        if (o < 0 || o >= fAt.length || fAt[o] !== last) continue;
        const d = (fx[o] - x) * (fx[o] - x) + (fy[o] - y) * (fy[o] - y);
        if (d < best) { best = d; from = o; if (k === 0 && d < 0.6) break; }
      }
      if (from < 0) { fvx[e] = 0; fvy[e] = 0; continue; }                 // sin historia: borde nuevo o figura en movimiento
      const hx = fx[from], hy = fy[from];
      const vx = fvx[from] + ((x - hx) / dt - fvx[from]) * aD, vy = fvy[from] + ((y - hy) / dt - fvy[from]) * aD;
      const speed = Math.hypot(vx, vy), dist = Math.sqrt(best);
      // quieto del todo (menos de un tercio de celda y sin velocidad): el corte baja aún más y el hormigueo se congela
      const fc = stab > 0.02 && dist < 0.35 && speed < 6 ? fMin * (1 - 0.75 * stab) + beta * speed * 0.3 : fMin + beta * speed;
      const alpha = 1 / (1 + (1 / (TAU * fc)) / dt);
      px[e] = hx + (x - hx) * alpha; py[e] = hy + (y - hy) * alpha;
      fvx[e] = vx; fvy[e] = vy;
    }
    for (const e of active) { fx[e] = px[e]; fy[e] = py[e]; fAt[e] = frameNo; }
  } else for (const e of active) { V.fx[e] = px[e]; V.fy[e] = py[e]; V.fvx[e] = 0; V.fvy[e] = 0; V.fAt[e] = frameNo; }
  // Recorre las cadenas: primero las abiertas desde un extremo, después los lazos.
  const chains = [];
  const scale = cols / 192;
  const minLength = (5 + (1 - detail) * 9) * scale;
  const minDetail = (2.6 + (1 - detail) * 5) * scale;
  const { seen, drawn } = V;
  function walk(start, closed) {
    const points = [];
    let e = start, length = 0, peak = 0, sum = 0, kept = 0, lastX = 0, lastY = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, textured = 0, alongC = 0, alongS = 0;
    while (e !== -1 && !used[e]) {
      used[e] = 1;
      const x = px[e], y = py[e];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (points.length) {
        const dx = x - lastX, dy = y - lastY, step = Math.hypot(dx, dy);
        if (step > 1e-6) { length += step; alongC += (dx * dx - dy * dy) / step; alongS += (2 * dx * dy) / step; }
      }
      points.push(x, y); lastX = x; lastY = y;
      const s = strength[e];
      sum += s; if (s > peak) peak = s;
      if (drawn[(y | 0) * cols + (x | 0)]) kept++;
      if (density[((y | 0) >> 3) * blockCols + ((x | 0) >> 3)] > 16) textured++;
      const a = linkA[e], b = linkB[e];
      e = a !== -1 && !used[a] ? a : b !== -1 && !used[b] ? b : -1;
    }
    const count = points.length / 2;
    if (count < 3) return;
    if (closed) length += Math.hypot(points[0] - lastX, points[1] - lastY);
    // Un contorno que ya estaba en pantalla se mantiene con menos contraste: no parpadea en el umbral.
    const steady = kept > count * 0.45;
    const mean = sum / count;
    // Estructura: bordes largos y firmes. Detalle: trazos cortos o suaves que destacan sobre la
    // textura que los rodea (el texto de una pantalla, una rejilla, un cable), nunca la textura misma.
    // Dentro de una textura solo pasa lo que tiene forma limpia: un renglón, un canto, un cable.
    // El grano mismo da lazos y garabatos que recorren mucho más de lo que abarcan.
    const reach = Math.hypot(maxX - minX, maxY - minY);
    const winding = closed ? length / (2 * (maxX - minX + maxY - minY) + 1e-6) : length / (reach + 1e-6);
    // Excepción: los trazos que van todos en la misma dirección (renglones de texto, una rejilla,
    // un rayado) son dibujo, no grano, aunque serpenteen de un renglón al siguiente.
    const aligned = Math.hypot(alongC, alongS) / (length + 1e-6);
    const inTexture = textured > count * 0.4;
    if (inTexture && !(mean > high * 1.8 && length > 40 * scale)) {
      if ((closed ? winding > 1.18 : winding > 1.45) && aligned < 0.5) return;
    }
    // Estructura: largo, firme en todo su recorrido (no por un solo punto fuerte) y sin enmarañar.
    const firm = mean >= high * (steady ? 0.75 : 1);
    const structure = length >= minLength && peak >= (steady ? high * 0.68 : high) && firm && (closed || winding < 4.2);
    let level = 0;
    if (!structure) {
      if (length < minDetail || peak < high * (steady ? 0.36 : 0.5)) return;
      let around = 0;
      for (let i = 0; i < count; i += 4) around += local[((points[2 * i + 1] | 0) >> 3) * V.blockCols + ((points[2 * i] | 0) >> 3)];
      around /= Math.ceil(count / 4);
      // Un trazo largo y alineado con los suyos (un renglón entre renglones) no tiene que destacar
      // sobre lo que lo rodea: lo que lo rodea es el mismo dibujo.
      const stroke = aligned >= 0.5 && length >= 12 * scale;
      if (!stroke && mean < around * (steady ? 1.45 : 1.9) + high * 0.12) return;
      // Un garabato (el grano de una pared) recorre mucho para lo poco que abarca; un renglón,
      // un cable o el canto de un objeto abarcan casi todo lo que recorren.
      if ((closed ? winding > 1.4 : winding > (steady ? 2.4 : 2.0)) && aligned < 0.5) return;
      level = 1;
    }
    chains.push({ points, closed, length, peak, mean, level, texture: textured / count, reach, aligned, box: [minX, minY, maxX, maxY], score: length * mean * (steady ? 1.3 : 1) * (level ? 0.75 : 1) });
  }
  for (const e of active) if (!used[e] && linkB[e] === -1) walk(e, false);
  for (const e of active) if (!used[e]) walk(e, true);

  // Presupuesto del haz: primero lo más largo y contrastado.
  chains.sort((a, b) => b.score - a.score);
  const budget = (1500 + detail * 6200) * scale;
  let total = 0, keep = 0, structureLength = 0;
  while (keep < chains.length && keep < 900 && total + chains[keep].length <= budget) { total += chains[keep].length; if (!chains[keep].level) structureLength += chains[keep].length; keep++; }
  chains.length = keep;
  seen.fill(0);
  for (const chain of chains) {
    const pts = chain.points, count = pts.length / 2;
    // Suaviza el temblor de la rejilla sin redondear las esquinas: un punto donde el trazo gira
    // de verdad (mirando tres puntos a cada lado) se queda en su sitio.
    const pinned = V.pinned && V.pinned.length >= count ? V.pinned : (V.pinned = new Uint8Array(Math.max(256, count * 2)));
    const span = 3;
    for (let i = 0; i < count; i++) {
      let turn = 0;
      const before = chain.closed ? (i - span + count) % count : i - span, after = chain.closed ? (i + span) % count : i + span;
      if (before >= 0 && after < count) {
        const ax = pts[2 * i] - pts[2 * before], ay = pts[2 * i + 1] - pts[2 * before + 1];
        const bx = pts[2 * after] - pts[2 * i], by = pts[2 * after + 1] - pts[2 * i + 1];
        turn = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-6) < 0.72 ? 1 : 0;
      } else turn = 1;
      pinned[i] = turn;
    }
    for (let pass = 0; pass < 4; pass++) {
      let prevX = pts[chain.closed ? pts.length - 2 : 0], prevY = pts[chain.closed ? pts.length - 1 : 1];
      const firstX = pts[0], firstY = pts[1];
      for (let i = chain.closed ? 0 : 1; i < (chain.closed ? count : count - 1); i++) {
        const x = pts[2 * i], y = pts[2 * i + 1];
        if (!pinned[i]) {
          const nextX = i === count - 1 ? firstX : pts[2 * i + 2], nextY = i === count - 1 ? firstY : pts[2 * i + 3];
          pts[2 * i] = (prevX + 2 * x + nextX) * 0.25; pts[2 * i + 1] = (prevY + 2 * y + nextY) * 0.25;
        }
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
      // Un lazo se recorre siempre en el mismo sentido y empieza en su punto más arriba a la izquierda
      // (el extremo en una dirección oblicua: en un cuadrado, su esquina; «el más alto» a secas, en un
      // borde horizontal, cambiaba de un cuadro al siguiente por una milésima de celda).
      let area = 0;
      for (let i = 0; i < count; i++) { const j = (i + 1) % count; area += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1]; }
      if (area < 0) { for (let i = 0, j = count - 1; i < j; i++, j--) { const x = pts[2 * i], y = pts[2 * i + 1]; pts[2 * i] = pts[2 * j]; pts[2 * i + 1] = pts[2 * j + 1]; pts[2 * j] = x; pts[2 * j + 1] = y; } }
      let best = 0, bestA = Infinity;
      for (let i = 0; i < count; i++) { const a = pts[2 * i] + 1.3 * pts[2 * i + 1]; if (a < bestA) { bestA = a; best = i; } }
      if (best) chain.points = pts.slice(2 * best).concat(pts.slice(0, 2 * best));
    } else if (pts[0] + 0.001 * pts[1] > pts[pts.length - 2] + 0.001 * pts[pts.length - 1]) {
      // Una cadena abierta va siempre de izquierda a derecha: su sentido no depende de dónde terminó la anterior.
      for (let i = 0, j = count - 1; i < j; i++, j--) { const x = pts[2 * i], y = pts[2 * i + 1]; pts[2 * i] = pts[2 * j]; pts[2 * i + 1] = pts[2 * j + 1]; pts[2 * j] = x; pts[2 * j + 1] = y; }
    }
  }
  // Un trazo que estaba y este cuadro no salió, en una zona donde nada se mueve, se sostiene unos
  // cuadros (más cuanta más estabilidad): parpadear es peor que tardar un instante en irse.
  const grace = Math.round(4 * stab);
  if (grace > 0 && !firstFrame) {
    const keepers = [];
    for (const old of V.held) {
      const pts = old.points, count = pts.length / 2;
      let covered = 0, moving = 0;
      for (let i = 0; i < count; i += 2) { const p = (pts[2 * i + 1] | 0) * cols + (pts[2 * i] | 0); if (seen[p]) covered++; if (Math.abs(luma[p] - smooth[p]) > 0.04) moving++; }
      const tested = Math.ceil(count / 2);
      if (covered > tested * 0.35) continue;                              // sigue ahí (con otro nombre): no hace falta sostenerlo
      if (moving > tested * 0.12 || old.missed >= grace) continue;        // la zona se mueve, o ya se le dio su tiempo
      old.missed++; keepers.push(old);
    }
    for (const old of keepers) { chains.push(old); total += old.length; }
  }
  V.held = chains.map(c => (c.missed ? c : { points: c.points, closed: c.closed, length: c.length, level: c.level, peak: c.peak, mean: c.mean, box: c.box, missed: 0, score: c.score }));
  for (const c of chains) if (c.missed) { const pts = c.points; for (let i = 0; i < pts.length; i += 2) { const x = pts[i] | 0, y = pts[i + 1] | 0; if (x >= 0 && y >= 0 && x < cols && y < rows) seen[y * cols + x] = 1; } }
  V.drawn.set(seen);
  // Orden del haz: desde donde quedó, al arranque más cercano del siguiente trazo (sin invertirlos).
  const ordered = [];
  let beamX = cols / 2, beamY = rows / 2;
  const pending = chains.slice();
  while (pending.length) {
    let best = 0, bestD = Infinity, flip = false;
    for (let i = 0; i < pending.length; i++) {
      const pts = pending[i].points, last = pts.length - 2;
      const d0 = (pts[0] - beamX) ** 2 + (pts[1] - beamY) ** 2;
      if (d0 < bestD) { bestD = d0; best = i; flip = false; }
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
  V.high = high; V.total = total; V.structure = structureLength; V.crossings = active.length;
  return ordered;
}

// Quita los puntos que no cambian la forma (Douglas-Peucker): una recta queda en dos puntos
// y el haz la traza limpia; una curva conserva los que necesita.
function vectorSimplify(pts, eps) {
  const count = pts.length / 2;
  if (count < 4) return pts;
  const keep = new Uint8Array(count);
  keep[0] = 1; keep[count - 1] = 1;
  const stack = [0, count - 1], limit = eps * eps;
  while (stack.length) {
    const b = stack.pop(), a = stack.pop();
    if (b - a < 2) continue;
    const ax = pts[2 * a], ay = pts[2 * a + 1], dx = pts[2 * b] - ax, dy = pts[2 * b + 1] - ay, len2 = dx * dx + dy * dy;
    let worst = 0, at = -1;
    for (let i = a + 1; i < b; i++) {
      const qx = pts[2 * i] - ax, qy = pts[2 * i + 1] - ay;
      const cross = qx * dy - qy * dx;
      const d = len2 < 1e-6 ? qx * qx + qy * qy : (cross * cross) / len2;
      if (d > worst) { worst = d; at = i; }
    }
    if (at > 0 && worst > limit) { keep[at] = 1; stack.push(a, at, at, b); }
  }
  const out = [];
  for (let i = 0; i < count; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

function plotVectorBeam(state, luma, cols, rows, ctx, w, h, now, reset) {
  let V = state.vector;
  if (!V || V.cols !== cols || V.rows !== rows) V = state.vector = createVectorState(cols, rows);
  if (!V.pool) V.pool = [];
  if (reset) { for (const old of V.frames) V.pool.push(old.layer); V.frames.length = 0; V.drawn.fill(0); V.primed = false; }
  const palette = _oscamColorBasis();
  const stab = Math.max(0, Math.min(1, (typeof oscamStabilityVal === 'number' ? oscamStabilityVal : 100) / 100));
  const dt = V.primed && now > V.lastNow ? Math.max(1 / 60, Math.min(0.1, (now - V.lastNow) / 1000)) : 1 / 30;
  V.lastNow = now;
  const t0 = performance.now();
  const chains = vectorContours(V, luma, oscamIntensityVal / 100, oscamDefinitionVal / 100, !V.primed, stab, dt);
  V.msTrace = (V.msTrace || 0) * 0.9 + (performance.now() - t0) * 0.1;         // cuánto cuesta trazar (media móvil), para las pruebas
  V.primed = true;
  V.chains = chains;
  const sx = w / (cols - 1), sy = h / (rows - 1);
  const core = Math.max(1.1, w / 850) * (0.55 + oscamDetailVal / 65);
  // Dos trazos: la estructura de la escena, firme, y el detalle, más fino y tenue.
  const path = new Path2D(), detail = new Path2D(), dots = new Path2D(), flare = new Path2D();
  const dot = (x, y, r) => { dots.moveTo(x + r, y); dots.arc(x, y, r, 0, 6.2832); flare.moveTo(x + r * 2.6, y); flare.arc(x, y, r * 2.6, 0, 6.2832); };
  // ESTABILIDAD por debajo de 100: el trazo, ya anclado, «se suelta» como el de un osciloscopio que
  // pierde el enganche (capas de Gemini Neon). Se suma al dibujar, nunca al estado del filtro: al
  // volver a 100 se queda quieto al instante. En celdas de la rejilla.
  //   100 → 75  zumbido de la fuente (un vaivén lento) y el imán de inclinar el teléfono;
  //    75 → 40  cada trazo deriva entero y una onda lo recorre;
  //    40 → 0   el barrido se desliza y aparece un segundo trazo tenue. Con tope: la figura se reconoce.
  const u = 1 - stab, loose = u > 0.004;
  const w1 = Math.min(1, u / 0.25), w2 = Math.max(0, Math.min(1, (u - 0.25) / 0.35)), w3 = Math.max(0, Math.min(1, (u - 0.6) / 0.4));
  const tilt = loose && window.flipLight && typeof flipLight.tilt === 'function' ? (+flipLight.tilt() || 0) : 0;
  const PI2 = 6.2832;
  const wobble = (x, y, arc, nx, ny, phase, t, out) => {
    let dx = 0.55 * w1 * Math.sin(PI2 * 1.15 * t + 2.4 * y / rows), dy = 0.35 * w1 * Math.cos(PI2 * 0.73 * t + 1.8 * x / cols);
    if (tilt) { const rx = (x / cols - 0.5) * 2, ry = (y / rows - 0.5) * 2; dx += 14 * Math.pow(u, 1.4) * (0.3 + 0.7 * (rx * rx + ry * ry) * 0.5) * tilt; }
    if (w2) {
      dx += 2.8 * w2 * (0.65 * Math.sin(PI2 * 2.1 * t + phase) + 0.35 * Math.sin(PI2 * 5.3 * t + 1.7 * phase));
      dy += 2.2 * w2 * (0.65 * Math.cos(PI2 * 1.7 * t + 1.3 * phase) + 0.35 * Math.sin(PI2 * 4.6 * t + phase));
      const wave = 2.4 * w2 * Math.sin(0.13 * arc - PI2 * 3.8 * t + phase);
      dx += nx * wave; dy += ny * wave;
    }
    if (w3) dx += 6.5 * w3 * Math.sin(PI2 * 0.85 * t) * (1 + 0.45 * Math.sin(PI2 * 3.7 * t));
    const m = Math.hypot(dx, dy);
    if (m > 1e-6) { const k = 12 * Math.tanh(m / 12) / m; dx *= k; dy *= k; }
    out[0] = x + dx; out[1] = y + dy;
  };
  const echo = w3 > 0.1 ? new Path2D() : null, moved = [0, 0], time = now / 1000;
  for (const chain of chains) {
    const count = chain.points.length / 2;
    let pts = chain.points;
    if (loose) {
      // (la fase de cada trazo sale de dónde está, a saltos de 12 celdas: es suya mientras no se mude)
      const box = chain.box || [pts[0], pts[1], pts[0], pts[1]];
      const phase = ((Math.round((box[0] + box[2]) / 24) * 0.618 + Math.round((box[1] + box[3]) / 24) * 0.414) % 1) * PI2;
      const live = new Array(pts.length), late = echo ? new Array(pts.length) : null;
      let arc = 0;
      for (let i = 0; i < count; i++) {
        const a = i > 0 ? i - 1 : (chain.closed ? count - 1 : 0), b = i < count - 1 ? i + 1 : (chain.closed ? 0 : count - 1);
        const tx = pts[2 * b] - pts[2 * a], ty = pts[2 * b + 1] - pts[2 * a + 1], tl = Math.hypot(tx, ty) || 1;
        if (i) arc += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
        wobble(pts[2 * i], pts[2 * i + 1], arc, -ty / tl, tx / tl, phase, time, moved);
        live[2 * i] = moved[0]; live[2 * i + 1] = moved[1];
        if (late) { wobble(pts[2 * i], pts[2 * i + 1], arc, -ty / tl, tx / tl, phase, time - 0.045, moved); late[2 * i] = moved[0]; late[2 * i + 1] = moved[1]; }
      }
      pts = live;
      if (late && !chain.level) { const l2 = vectorSimplify(late, 0.16); echo.moveTo(l2[0] * sx, l2[1] * sy); for (let i = 2; i < l2.length; i += 2) echo.lineTo(l2[i] * sx, l2[i + 1] * sy); if (chain.closed) echo.closePath(); }
    }
    const line = vectorSimplify(pts, 0.16), target = chain.level ? detail : path;
    target.moveTo(line[0] * sx, line[1] * sy);
    for (let i = 2; i < line.length; i += 2) target.lineTo(line[i] * sx, line[i + 1] * sy);
    if (chain.closed) target.closePath();
    if (chain.level) continue;
    // El haz se asienta donde arranca y donde termina; en un giro brusco pierde velocidad.
    dot(pts[0] * sx, pts[1] * sy, core * 0.85);
    if (!chain.closed) dot(pts[pts.length - 2] * sx, pts[pts.length - 1] * sy, core * 0.85);
    for (let i = 3; i < count - 3; i++) {
      const ax = pts[2 * i] - pts[2 * i - 6], ay = pts[2 * i + 1] - pts[2 * i - 5];
      const bx = pts[2 * i + 6] - pts[2 * i], by = pts[2 * i + 7] - pts[2 * i + 1];
      const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-6);
      if (cos < 0.42) { dot(pts[2 * i] * sx, pts[2 * i + 1] * sy, core * 0.68); i += 5; }
    }
  }
  // Energía por unidad de recorrido: una escena cargada se dibuja más tenue.
  const energyNow = Math.max(0.62, Math.min(1, Math.sqrt((1000 * cols) / 192 / Math.max(1, V.structure || V.total))));
  // (suavizado en el tiempo: cuando entra o sale un trazo largo, el brillo de toda la pantalla no pulsa)
  const energy = V.energy = reset || !V.energy ? energyNow : V.energy + (energyNow - V.energy) * (0.18 + 0.82 * (1 - stab));
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
  if (echo) { pen.globalAlpha = 0.22 * w3; pen.stroke(echo); }        // el segundo barrido, tenue
  pen.globalAlpha = 0.6;
  pen.lineWidth = Math.max(core * 0.56, 0.9 / layerScale);
  pen.stroke(detail);
  pen.globalAlpha = 1;
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
    ctx.strokeStyle = 'rgba(' + base + ',' + Math.min(1, 0.44 * level).toFixed(3) + ')';
    ctx.lineWidth = Math.max(0.8, core * 0.58);
    ctx.stroke(detail);
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
    if (typeof WeakRef === 'function') {
      // Los que ya no existen dejan su sitio; uno vivo (el del visor es el más antiguo) no se olvida.
      if (opticalScopeRefs.length >= 12) for (let i = opticalScopeRefs.length - 1; i >= 0; i--) if (!opticalScopeRefs[i].deref()) opticalScopeRefs.splice(i, 1);
      opticalScopeRefs.push(new WeakRef(state));
    }
  }
  {
    // VECTOR muestrea la escena en celdas cuadradas con la proporción del visor.
    const [cols, rows] = vectorGrid(w, h);
    if (!state.vectorInput || state.vectorInput.canvas.height !== rows || state.vectorInput.canvas.width !== cols) {
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
  }
}
