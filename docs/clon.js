// FLIP · CLON: una cámara que aprende el look de cualquier imagen.
//
// Se le enseña una referencia —un cartel al que se apunta, una portada, una foto que se abre— y
// arma con ella una cámara nueva que funciona en vivo. No elige «la cámara de FLIP que más se
// parece»: mide la referencia y construye un look a su medida. Todo ocurre en el aparato, sin red y
// sin modelos de IA: es estadística de la imagen y un sombreador.
//
// Tres pasos:
//
//   1 · APRENDER (analyze). De la referencia se miden, por separado:
//       · la paleta, agrupando sus colores en un espacio perceptual (OKLab); y si es una paleta
//         cerrada (un cartel a tres tintas, un píxel art) o color continuo (una foto);
//       · la curva de tonos (cuánta imagen hay en cada nivel de luz);
//       · cómo depende el color de la luz (en un duotono, la luz decide el color entero);
//       · la trama: con una transformada de Fourier se busca un pico periódico; da cuántas celdas
//         caben a lo ancho, a qué ángulo, y si son puntos (dos picos en cruz) o líneas (uno);
//       · la rejilla de píxel (bloques planos con saltos a intervalos fijos) y su tramado;
//       · el grano (ruido fino en las zonas lisas), las líneas de tinta y la viñeta.
//
//   2 · APLICAR (renderClon). Un sombreador pinta la cámara en vivo: iguala los tonos de la escena a
//       los de la referencia (los de TU escena, medidos cada pocos cuadros), lleva el color hacia el
//       suyo, y si la paleta es cerrada encaja cada punto en sus tintas con el tramado que tenía
//       (puntos, líneas, ordenado o ruido), sobre su rejilla de píxel si la había; luego contorno,
//       grano y viñeta.
//
//   3 · PONERSE A PRUEBA (fit). Para no fiarse de las medidas: a la referencia se le quita el estilo
//       (se emborrona hasta dejar solo sus manchas de color), se la vuelve a estilizar con lo
//       aprendido y se compara con la original —en color, tonos, espectro y contornos—. Los mandos
//       continuos se ajustan hasta que la reconstrucción se parece lo más posible, y esa distancia
//       final es el «parecido» que se enseña. Un look que no sabe reconstruir su propia referencia
//       saca mala nota, y se ve.
//
// Lo que clona: color, tonos, trama, píxel, grano y contorno. Lo que no: el dibujo (el trazo de una
// ilustración, la tipografía, el contenido). Eso pediría un modelo generativo.
(function () {
  'use strict';
  const KEY = 'flip.clon', MAX_LOOKS = 4, FFT_N = 256, FIT_N = 128;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const $ = id => document.getElementById(id);

  // ── Color: OKLab con gamma 2,2 (la misma aproximación en el sombreador, para que casen) ──
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) LIN[i] = Math.pow(i / 255, 2.2);
  function toLab(r, g, b, out, o) {
    const lr = LIN[r], lg = LIN[g], lb = LIN[b];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  }
  function fromLab(L, a, b) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    const enc = v => Math.round(255 * Math.pow(clamp(v, 0, 1), 1 / 2.2));
    return [enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  }
  function labImage(data, n) {
    const lab = new Float32Array(n * 3);
    for (let i = 0, p = 0; i < n; i++, p += 4) toLab(data[p], data[p + 1], data[p + 2], lab, i * 3);
    return lab;
  }

  // ── Transformada de Fourier en dos dimensiones (potencia de dos), en el sitio ──
  function fft1(re, im, n, start, stride) {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const a = start + i * stride, b = start + j * stride; let t = re[a]; re[a] = re[b]; re[b] = t; t = im[a]; im[a] = im[b]; im[b] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = start + (i + k) * stride, b = start + (i + k + len / 2) * stride;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  // Espectro de potencia de una luminancia n × n (con ventana, sin la media).
  function spectrum(lum, n) {
    const re = new Float32Array(n * n), im = new Float32Array(n * n);
    let mean = 0;
    for (let i = 0; i < n * n; i++) mean += lum[i];
    mean /= n * n;
    for (let y = 0; y < n; y++) {
      const wy = 0.5 - 0.5 * Math.cos(2 * Math.PI * (y + 0.5) / n);
      for (let x = 0; x < n; x++) re[y * n + x] = (lum[y * n + x] - mean) * wy * (0.5 - 0.5 * Math.cos(2 * Math.PI * (x + 0.5) / n));
    }
    for (let y = 0; y < n; y++) fft1(re, im, n, y * n, 1);
    for (let x = 0; x < n; x++) fft1(re, im, n, x, n);
    const pow = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) pow[i] = re[i] * re[i] + im[i] * im[i];
    return pow;
  }

  // ── Paleta: k-medias en OKLab, con semilla fija (la misma referencia da siempre la misma paleta) ──
  function palette(lab, n) {
    const step = Math.max(1, Math.floor(n / 4096)), pts = [];
    for (let i = 0; i < n; i += step) pts.push(i * 3);
    let seed = 0x1F2E3D4C;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
    const dist = (p, c) => { const dl = lab[p] - c[0], da = lab[p + 1] - c[1], db = lab[p + 2] - c[2]; return dl * dl + da * da + db * db; };
    const K = 8, cents = [[lab[pts[0]], lab[pts[0] + 1], lab[pts[0] + 2]]];
    const near = new Float32Array(pts.length).fill(1e9);
    while (cents.length < K) {                                    // k-medias++: el siguiente centro, lejos de los que ya hay
      let total = 0;
      for (let i = 0; i < pts.length; i++) { const d = dist(pts[i], cents[cents.length - 1]); if (d < near[i]) near[i] = d; total += near[i]; }
      if (total < 1e-7) break;
      let pick = rnd() * total, at = 0;
      for (; at < pts.length - 1; at++) { pick -= near[at]; if (pick <= 0) break; }
      cents.push([lab[pts[at]], lab[pts[at] + 1], lab[pts[at] + 2]]);
    }
    const own = new Int8Array(pts.length);
    let counts = [];
    for (let it = 0; it < 12; it++) {
      const sum = cents.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < pts.length; i++) {
        let best = 0, bd = 1e9;
        for (let k = 0; k < cents.length; k++) { const d = dist(pts[i], cents[k]); if (d < bd) { bd = d; best = k; } }
        own[i] = best;
        const s = sum[best], p = pts[i];
        s[0] += lab[p]; s[1] += lab[p + 1]; s[2] += lab[p + 2]; s[3]++;
      }
      counts = sum.map(s => s[3]);
      for (let k = 0; k < cents.length; k++) if (sum[k][3]) cents[k] = [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]];
    }
    // Dos centros casi iguales son la misma tinta; uno con muy pocos puntos es ruido.
    let list = cents.map((c, k) => ({ c, w: counts[k] / pts.length })).filter(e => e.w > 0);
    for (let merged = true; merged && list.length > 2;) {
      merged = false;
      let bi = -1, bj = -1, bd = 0.05 * 0.05;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i].c, b = list[j].c, d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
      if (bi >= 0) {
        const a = list[bi], b = list[bj], w = a.w + b.w;
        a.c = [0, 1, 2].map(k => (a.c[k] * a.w + b.c[k] * b.w) / w); a.w = w;
        list.splice(bj, 1); merged = true;
      }
    }
    list = list.filter(e => e.w >= 0.012);
    list.sort((x, y) => x.c[0] - y.c[0]);
    // Cuánto se aparta la imagen de su paleta: poco = paleta cerrada (tintas planas).
    let err = 0;
    for (let i = 0; i < pts.length; i++) { let bd = 1e9; for (const e of list) { const d = dist(pts[i], e.c); if (d < bd) bd = d; } err += Math.sqrt(bd); }
    return { colors: list.map(e => e.c), shares: list.map(e => e.w), error: err / pts.length };
  }

  // ── El análisis ─────────────────────────────────────────────────────────────
  // thumb: { data, width, height } de la referencia reducida (lado mayor ≤ 256).
  // fine: { lum (Float32Array n × n, 0…1), n, span } un recorte central SIN reducir (n píxeles de lado
  //       sobre una referencia de «span» píxeles de ancho): ahí se ven la trama y la rejilla de píxel.
  // sparse: { data, n } toda la referencia muestreada SIN suavizar (un punto de cada tantos): de ahí salen
  //         la paleta (reducir suavizando mezcla las tintas e inventa colores intermedios).
  // soft: { data, n } la referencia muy reducida promediando: de ahí salen los tonos. Una trama o un
  //       tramado representan un tono continuo con puntos de dos tintas; la curva que hay que copiar es
  //       la de ese tono, no la de los puntos (que solo tiene dos valores).
  function analyze(thumb, fine, sparse, soft) {
    const n = thumb.width * thumb.height, lab = labImage(thumb.data, n);
    const sn2 = sparse ? sparse.n : n, slab = sparse ? labImage(sparse.data, sn2) : lab;
    const pal = palette(slab, sn2);
    const K = pal.colors.length, limited = K <= 6 && pal.error < 0.04;

    // Tonos: los cuantiles de la luz de la referencia.
    const Ls = new Float32Array(n);
    for (let i = 0; i < n; i++) Ls[i] = lab[i * 3];
    const tn = soft ? soft.n : sn2, tlab = soft ? labImage(soft.data, tn) : slab;
    const sorted = new Float32Array(tn);
    for (let i = 0; i < tn; i++) sorted[i] = tlab[i * 3];
    sorted.sort();
    const cdf = [];
    for (let i = 0; i <= 32; i++) cdf.push(+sorted[Math.min(tn - 1, Math.round(i / 32 * (tn - 1)))].toFixed(4));

    // Color según la luz: el color medio de cada nivel, y cuánto explica la luz el color.
    const bins = 16, sa = new Float32Array(bins), sb = new Float32Array(bins), sn = new Float32Array(bins);
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { const k = Math.min(bins - 1, (lab[i * 3] * bins) | 0); sa[k] += lab[i * 3 + 1]; sb[k] += lab[i * 3 + 2]; sn[k]++; ma += lab[i * 3 + 1]; mb += lab[i * 3 + 2]; }
    ma /= n; mb /= n;
    const ramp = [];
    for (let k = 0; k < bins; k++) ramp.push(sn[k] > n * 0.002 ? [sa[k] / sn[k], sb[k] / sn[k]] : null);
    for (let k = 0; k < bins; k++) if (!ramp[k]) {                // niveles sin imagen: se rellenan con los vecinos
      let lo = k - 1, hi = k + 1;
      while (lo >= 0 && !ramp[lo]) lo--;
      while (hi < bins && !ramp[hi]) hi++;
      const A = lo >= 0 ? ramp[lo] : (hi < bins ? ramp[hi] : [ma, mb]), B = hi < bins && ramp[hi] ? ramp[hi] : A, t = lo >= 0 && hi < bins ? (k - lo) / (hi - lo) : 0;
      ramp[k] = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    }
    let total = 0, resid = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.min(bins - 1, (lab[i * 3] * bins) | 0), da = lab[i * 3 + 1] - ma, db = lab[i * 3 + 2] - mb, ra = lab[i * 3 + 1] - ramp[k][0], rb = lab[i * 3 + 2] - ramp[k][1];
      total += da * da + db * db; resid += ra * ra + rb * rb;
    }
    const chroma = Math.sqrt(total / n);                           // cuánto color tiene (0 = gris)
    const explained = total > 1e-6 ? clamp(1 - resid / total, 0, 1) : 1;
    // (con varias tintas de distinto color, el color de la escena sigue contando algo: tope 0,8)
    const rampMix = chroma < 0.012 ? 1 : Math.min(clamp((explained - 0.35) / 0.5, 0, 1), limited && K > 2 ? 0.8 : 1);

    // Lo fino: rejilla de píxel y trama, sobre el recorte sin reducir.
    const N = fine.n, lum = fine.lum, perWidth = fine.span / N;    // cuántas veces cabe el recorte a lo ancho
    const gx = new Float32Array(N), gy = new Float32Array(N);
    for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
      const v = lum[y * N + x];
      gx[x] += Math.abs(lum[y * N + x + 1] - v); gy[y] += Math.abs(lum[(y + 1) * N + x] - v);
    }
    // Un píxel art tiene sus saltos concentrados cada p columnas (y filas): se busca el periodo p cuya
    // mejor fase se lleva casi toda la energía de los saltos.
    const grid = g => {
      let sum = 0;
      for (let i = 0; i < N - 1; i++) sum += g[i];
      if (sum < 1e-6) return { p: 0, q: 0 };
      let best = { p: 0, q: 0 };
      for (let p = 3; p <= 40; p++) {
        const phase = new Float32Array(p);
        for (let i = 0; i < N - 1; i++) phase[i % p] += g[i];
        let top = 0;
        for (let k = 0; k < p; k++) if (phase[k] > top) top = phase[k];
        const q = top / sum;                                       // 1/p si no hay rejilla; cerca de 1 si la hay
        const lift = (q - 1 / p) / (1 - 1 / p);
        // los divisores del periodo verdadero concentran igual: gana el más largo de los que empatan
        if (lift > best.q + 0.02 || (lift > 0.6 && lift >= best.q - 0.03)) best = { p, q: Math.max(lift, best.q) };
      }
      return best;
    };
    const px = grid(gx), py = grid(gy);
    let pixel = 0, period = 0;
    if (px.q > 0.62 && py.q > 0.62 && Math.abs(px.p - py.p) <= 1) { period = (px.p + py.p) / 2; pixel = clamp(Math.round(fine.span / period), 8, 320); }

    const pow = spectrum(lum, N);
    let ac = 0;
    for (let i = 1; i < N * N; i++) ac += pow[i];
    const screen = { type: 'none', freq: 0, angle: 0, strength: 0 };
    if (!pixel && ac > 1e-6) {
      let top = 0, tu = 0, tv = 0;
      for (let v = -N / 2; v < N / 2; v++) for (let u = 0; u < N / 2; u++) {      // medio plano: el espectro es simétrico
        const r = Math.hypot(u, v);
        if (r < 7 || r > N * 0.42) continue;
        const p = pow[((v + N) % N) * N + u];
        if (p > top) { top = p; tu = u; tv = v; }
      }
      // ¿Sobresale ese pico de lo que hay a su misma distancia del centro?
      const r0 = Math.hypot(tu, tv);
      let ring = 0, ringN = 0, lobe = 0;
      for (let v = -N / 2; v < N / 2; v++) for (let u = -N / 2; u < N / 2; u++) {
        const r = Math.hypot(u, v), p = pow[((v + N) % N) * N + ((u + N) % N)];
        if (Math.abs(r - r0) < 3) { ring += p; ringN++; }
        if (Math.hypot(u - tu, v - tv) <= 2 || Math.hypot(u + tu, v + tv) <= 2) lobe += p;
      }
      const prominence = top / Math.max(1e-9, (ring - lobe) / Math.max(1, ringN - 26)), share = lobe / ac;
      if (prominence > 60 && share > 0.012) {
        let cross = 0;                                            // ¿hay otro pico en cruz? entonces son puntos
        for (let dv = -2; dv <= 2; dv++) for (let du = -2; du <= 2; du++) { const u = -tv + du, v = tu + dv, p = pow[((v + N) % N) * N + ((u + N) % N)]; if (p > cross) cross = p; }
        screen.type = cross > top * 0.2 ? 'dot' : 'line';
        screen.freq = +(r0 * perWidth).toFixed(2);
        screen.angle = +Math.atan2(tv, tu).toFixed(4);
        screen.strength = limited ? 1 : +clamp(Math.sqrt(share) * 2.2, 0.15, 1).toFixed(3);
        period = N / r0;
      }
    }
    // Con rejilla de píxel y paleta cerrada: ¿alternan los vecinos? Entonces hay tramado ordenado.
    if (pixel && limited) {
      const cells = Math.max(2, Math.floor(N / period)), idx = new Int8Array(cells * cells);
      for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
        const v = lum[Math.min(N - 1, Math.round((cy + 0.5) * period)) * N + Math.min(N - 1, Math.round((cx + 0.5) * period))];
        let best = 0, bd = 1e9;
        for (let k = 0; k < K; k++) { const d = Math.abs(v - pal.colors[k][0]); if (d < bd) { bd = d; best = k; } }
        idx[cy * cells + cx] = best;
      }
      let differ = 0, pairs = 0;
      for (let cy = 0; cy < cells - 1; cy++) for (let cx = 0; cx < cells - 1; cx++) { pairs += 2; if (idx[cy * cells + cx] !== idx[cy * cells + cx + 1]) differ++; if (idx[cy * cells + cx] !== idx[(cy + 1) * cells + cx]) differ++; }
      const alt = differ / Math.max(1, pairs);
      if (alt > 0.22) { screen.type = 'bayer'; screen.freq = pixel; screen.strength = +clamp(alt * 2.2, 0.4, 1).toFixed(3); }
    }

    // Grano: lo que queda al quitarle a cada punto la media de sus vecinos, solo en zonas lisas.
    const grain = { amount: 0, cells: 0 };
    if (!pixel && screen.type === 'none') {
      let sum = 0, sum2 = 0, cnt = 0, lag = 0;
      let prev = 0;
      for (let y = 2; y < N - 2; y += 2) for (let x = 2; x < N - 2; x++) {
        const i = y * N + x, mean = (lum[i - 1] + lum[i + 1] + lum[i - N] + lum[i + N] + lum[i - N - 1] + lum[i - N + 1] + lum[i + N - 1] + lum[i + N + 1]) / 8;
        const slope = Math.abs(lum[i + 2] - lum[i - 2]) + Math.abs(lum[i + 2 * N] - lum[i - 2 * N]);
        if (slope > 0.06) { prev = 0; continue; }
        const r = lum[i] - mean;
        sum += r; sum2 += r * r; lag += r * prev; cnt++; prev = r;
      }
      if (cnt > N) {
        const sd = Math.sqrt(Math.max(0, sum2 / cnt - (sum / cnt) ** 2));
        if (sd > 0.008) {
          grain.amount = +clamp(sd * 3.2, 0, 0.5).toFixed(3);
          const rho = clamp(lag / Math.max(1e-9, sum2), 0, 0.9);                 // grano gordo: vecinos parecidos
          grain.cells = Math.round(fine.span / (1 + rho * 3));
        }
      }
    }
    if (limited && screen.type === 'none' && grain.amount > 0.05) { screen.type = 'noise'; screen.strength = +clamp(grain.amount * 4, 0.3, 1).toFixed(3); screen.freq = grain.cells; }

    // Líneas de tinta: puntos bastante más oscuros que su entorno, sobre la referencia reducida.
    const w = thumb.width, h = thumb.height;
    let ink = 0, inkN = 0, edgeSum = 0;
    for (let y = 3; y < h - 3; y += 2) for (let x = 3; x < w - 3; x += 2) {
      const i = y * w + x, around = (Ls[i - 3] + Ls[i + 3] + Ls[i - 3 * w] + Ls[i + 3 * w]) / 4;
      inkN++;
      if (Ls[i] < around - 0.16 && around > 0.35) ink++;
      edgeSum += Math.abs(Ls[i + 1] - Ls[i - 1]) + Math.abs(Ls[i + w] - Ls[i - w]);
    }
    const inkShare = ink / Math.max(1, inkN);
    const edge = !pixel && screen.type === 'none' && inkShare > 0.012 ? +clamp(inkShare * 9, 0.25, 1).toFixed(3) : 0;

    // Viñeta: esquinas más oscuras que el centro.
    const box = (x0, y0, x1, y1) => { let s = 0, c = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += Ls[y * w + x]; c++; } return s / Math.max(1, c); };
    const cw = Math.max(2, (w * 0.14) | 0), ch = Math.max(2, (h * 0.14) | 0);
    const four = [box(0, 0, cw, ch), box(w - cw, 0, w, ch), box(0, h - ch, cw, h), box(w - cw, h - ch, w, h)];
    const corners = (four[0] + four[1] + four[2] + four[3]) / 4, centre = box((w * 0.3) | 0, (h * 0.3) | 0, (w * 0.7) | 0, (h * 0.7) | 0);
    // Una viñeta oscurece las cuatro esquinas por igual; si unas sí y otras no, es el contenido de la imagen.
    const even = Math.max(...four) - Math.min(...four) < 0.4 * (centre - corners);
    const vignette = !limited && even && centre > 0.2 && (centre - corners) / centre > 0.16 ? +clamp((centre - corners) / centre * 0.9, 0, 0.6).toFixed(3) : 0;

    const look = {
      v: 1, palette: pal.colors.map(c => c.map(v => +v.toFixed(4))), shares: pal.shares.map(v => +v.toFixed(3)), limited, error: +pal.error.toFixed(4),
      cdf, ramp: ramp.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]), rampMix: +rampMix.toFixed(3), mean: [+ma.toFixed(4), +mb.toFixed(4)], chroma: +chroma.toFixed(4),
      pixel, screen, grain, edge, vignette, tone: 0.8, sat: 1, score: null,
    };
    look.name = nameOf(look);
    return look;
  }

  // Un nombre que diga qué es: el tipo de imagen y su color dominante.
  function nameOf(look) {
    let hue = 'GRIS', best = 0.035;
    look.palette.forEach((c, i) => {
      const chroma = Math.hypot(c[1], c[2]) * (0.35 + look.shares[i]);
      if (chroma <= best) return;
      best = chroma;
      const deg = (Math.atan2(c[2], c[1]) * 180 / Math.PI + 360) % 360;
      hue = deg < 20 ? 'ROSA' : deg < 50 ? 'ROJO' : deg < 78 ? 'NARANJA' : deg < 108 ? 'ÁMBAR' : deg < 135 ? 'LIMA' : deg < 172 ? 'VERDE' : deg < 215 ? 'TURQUESA' : deg < 275 ? 'AZUL' : deg < 320 ? 'VIOLETA' : 'ROSA';
    });
    const kind = look.pixel ? 'PÍXEL' : look.screen.type === 'dot' ? 'TRAMA' : look.screen.type === 'line' ? 'LÍNEAS' : look.limited ? (look.palette.length <= 2 ? 'TINTA' : 'CARTEL') : look.rampMix > 0.75 ? 'DUOTONO' : 'FOTO';
    return kind + ' ' + hue;
  }
  function describe(look) {
    const parts = [look.limited ? look.palette.length + ' tintas' : 'color continuo'];
    if (look.pixel) parts.push('píxel de ' + look.pixel + ' a lo ancho');
    if (look.screen.type === 'dot') parts.push('trama de puntos a ' + Math.round(((look.screen.angle * 180 / Math.PI) % 90 + 90) % 90) + '°');
    else if (look.screen.type === 'line') parts.push('trama de líneas');
    else if (look.screen.type === 'bayer') parts.push('tramado ordenado');
    else if (look.screen.type === 'noise') parts.push('tramado de ruido');
    if (look.grain.amount > 0.03 && look.screen.type !== 'noise') parts.push('grano');
    if (look.edge) parts.push('línea de tinta');
    if (look.vignette) parts.push('viñeta');
    return parts.join(' · ') + (look.score != null ? ' · parecido ' + look.score + ' %' : '');
  }

  // ── El sombreador ───────────────────────────────────────────────────────────
  const VERT = 'attribute vec2 aPos; varying vec2 vUv; void main() { vUv = vec2(aPos.x * .5 + .5, .5 - aPos.y * .5); gl_Position = vec4(aPos, 0., 1.); }';
  const FRAG = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec2 vUv;
    uniform sampler2D uSrc, uTone, uRamp;
    uniform vec4 uCrop;            // de dónde se lee la fuente: origen y tamaño, en sus coordenadas
    uniform vec2 uRes;             // tamaño de la salida, en píxeles
    uniform float uMirror, uCells, uScale, uSeed, uReveal, uAim, uLimited, uEdge, uVig, uSat, uRampMix, uPalN, uFlat;
    uniform vec3 uPal[8];
    uniform vec3 uInk;
    uniform vec4 uDither;          // tipo (0 nada, 1 ordenado, 2 puntos, 3 líneas, 4 ruido), celdas a lo ancho, ángulo, fuerza
    uniform vec2 uGrain;           // cantidad, celdas a lo ancho
    uniform vec4 uChroma;          // color medio de la escena (a, b) y de la referencia (a, b)
    vec3 lab(vec3 c) {
      vec3 l = pow(clamp(c, 0., 1.), vec3(2.2));
      vec3 m = pow(vec3(dot(l, vec3(.4122214708, .5363325363, .0514459929)), dot(l, vec3(.2119034982, .6806995451, .1073969566)), dot(l, vec3(.0883024619, .2817188376, .6299787005))), vec3(1. / 3.));
      return vec3(dot(m, vec3(.2104542553, .793617785, -.0040720468)), dot(m, vec3(1.9779984951, -2.428592205, .4505937099)), dot(m, vec3(.0259040371, .7827717662, -.808675766)));
    }
    vec3 rgb(vec3 c) {
      vec3 m = vec3(c.x + .3963377774 * c.y + .2158037573 * c.z, c.x - .1055613458 * c.y - .0638541728 * c.z, c.x - .0894841775 * c.y - 1.291485548 * c.z);
      m = m * m * m;
      vec3 l = vec3(dot(m, vec3(4.0767416621, -3.3077115913, .2309699292)), dot(m, vec3(-1.2684380046, 2.6097574011, -.3413193965)), dot(m, vec3(-.0041960863, -.7034186147, 1.707614701)));
      return pow(clamp(l, 0., 1.), vec3(1. / 2.2));
    }
    float hash(vec2 p) { p = fract(p * vec2(.1031, .1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
    float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
    float bayer4(vec2 a) { return bayer2(.5 * a) * .25 + bayer2(a); }
    vec3 source(vec2 q) { return texture2D(uSrc, uCrop.xy + vec2(uMirror > .5 ? 1. - q.x : q.x, q.y) * uCrop.zw).rgb; }
    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 uv = vUv, q = uv;
      float cells = uCells * uScale;
      vec2 grid = vec2(cells, max(1., floor(cells / aspect + .5)));
      if (cells > 0.) q = (floor(uv * grid) + .5) / grid;
      vec3 src = source(q);
      if (uAim > .5) {                                             // apuntando: la cámara tal cual, con su encuadre
        vec2 d = abs(uv - .5);
        float inside = step(d.x, .38) * step(d.y, .38);
        float rim = inside * (1. - step(d.x, .38 - 2.5 / uRes.x) * step(d.y, .38 - 2.5 / uRes.y));
        gl_FragColor = vec4(mix(src * .42, src, inside) + rim * vec3(.0, .5, .28), 1.);
        return;
      }
      // Tinta plana sin trama: el ruido de la cámara haría bailar el borde entre dos tintas. Se lee la
      // escena un poco emborronada (nueve puntos) y las manchas salen limpias.
      if (uFlat > .5 && cells <= 0.) {
        vec2 b = vec2(.0034, .0034 * aspect), a = vec2(.0056, .0056 * aspect);   // en fracción del ancho: igual en la vista que en la foto
        src = (src * 2. + source(q + vec2(b.x, b.y)) + source(q + vec2(-b.x, b.y)) + source(q + vec2(b.x, -b.y)) + source(q + vec2(-b.x, -b.y))
          + source(q + vec2(a.x, 0.)) + source(q - vec2(a.x, 0.)) + source(q + vec2(0., a.y)) + source(q - vec2(0., a.y))) / 10.;
      }
      vec3 p = lab(src);
      // Tonos: la luz de la escena, llevada a la distribución de la referencia.
      p.x = texture2D(uTone, vec2(clamp(p.x, .002, .998), .5)).r;
      // Contorno, medido en la fuente.
      float e = 0.;
      if (uEdge > 0.) {
        vec2 st = cells > 0. ? 1. / grid : 1.6 / uRes;
        float lx = lab(source(q + vec2(st.x, 0.))).x - lab(source(q - vec2(st.x, 0.))).x, ly = lab(source(q + vec2(0., st.y))).x - lab(source(q - vec2(0., st.y))).x;
        e = smoothstep(.07, .2, length(vec2(lx, ly))) * uEdge;
      }
      // Color: el de la escena, desplazado al de la referencia; y cuanto más mande la luz en ella,
      // más sale del color que la referencia le pone a cada nivel.
      vec2 ab = (p.yz - uChroma.xy) * uSat + uChroma.zw;
      vec2 ramped = texture2D(uRamp, vec2(clamp(p.x, .03, .97), .5)).rg - .5;
      p.yz = mix(ab, ramped, uRampMix);
      // Viñeta y grano, antes de encajar en la paleta (así el grano también trama).
      vec2 c = uv - .5;
      p.x *= 1. - uVig * dot(c, c) * 2.2;
      float gcells = uGrain.y * uScale;
      if (uGrain.x > 0.) p.x += (hash(floor(uv * vec2(gcells, gcells / aspect)) + uSeed) - .5) * uGrain.x;
      // El umbral del tramado en este punto.
      float thr = .5, fr = uDither.y * uScale;
      vec2 w = uv * vec2(1., 1. / aspect);
      vec2 r = vec2(cos(uDither.z) * w.x + sin(uDither.z) * w.y, -sin(uDither.z) * w.x + cos(uDither.z) * w.y) * fr * 6.2831853;
      if (uDither.x > 3.5) thr = hash(floor(uv * vec2(fr, fr / aspect)) + uSeed * .37);
      else if (uDither.x > 2.5) thr = .5 + .5 * cos(r.x);
      else if (uDither.x > 1.5) thr = .5 + .25 * (cos(r.x) + cos(r.y));
      else if (uDither.x > .5) thr = bayer4(cells > 0. ? floor(uv * grid) : floor(uv * vec2(fr, fr / aspect))) + .03125;
      vec3 outc;
      if (uLimited > .5) {
        // Paleta cerrada: las dos tintas más cercanas, y el tramado decide entre ellas.
        float d1 = 1e9, d2 = 1e9;
        vec3 c1 = uPal[0], c2 = uPal[0];
        for (int i = 0; i < 8; i++) {
          if (float(i) >= uPalN) break;
          vec3 dd = p - uPal[i];
          float d = dot(dd, dd);
          if (d < d1) { d2 = d1; c2 = c1; d1 = d; c1 = uPal[i]; } else if (d < d2) { d2 = d; c2 = uPal[i]; }
        }
        vec3 seg = c2 - c1;
        float t = clamp(dot(p - c1, seg) / max(dot(seg, seg), 1e-5), 0., 1.);
        outc = t > mix(.5, thr, uDither.w) ? c2 : c1;
        outc = mix(outc, uInk, step(.5, e));
      } else {
        // Color continuo: la trama, si la hay, modula la luz.
        p.x += (thr - .5) * uDither.w * .34 * step(.5, uDither.x);
        outc = mix(p, uInk, e);
      }
      vec3 col = rgb(outc);
      if (uReveal < 1.) {                                          // el revelado: la cámara de antes se va por la derecha
        float edge = uReveal * 1.08 - .04;
        col = mix(col, src, step(edge, uv.x));
        col += vec3(.75, 1., .85) * smoothstep(.012, 0., abs(uv.x - edge));
      }
      gl_FragColor = vec4(col, 1.);
    }`;

  const G = { canvas: null, gl: null, u: null, src: null, tone: null, ramp: null, failed: false, lost: 0 };
  function ensureGl() {
    if (G.gl) return true;
    if (G.failed) return false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' };
      const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('CLON: sin WebGL');
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); G.lost++; G.gl = null; G.canvas = null; });
      const shader = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('CLON: ' + gl.getShaderInfoLog(s)); return s; };
      const prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('CLON: ' + gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const at = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
      const tex = (unit, filter) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
      G.src = tex(0, gl.LINEAR); G.tone = tex(1, gl.LINEAR); G.ramp = tex(2, gl.LINEAR);
      const u = {};
      for (const name of ['uSrc', 'uTone', 'uRamp', 'uCrop', 'uRes', 'uMirror', 'uCells', 'uScale', 'uSeed', 'uReveal', 'uAim', 'uLimited', 'uEdge', 'uVig', 'uSat', 'uRampMix', 'uPalN', 'uFlat', 'uPal', 'uInk', 'uDither', 'uGrain', 'uChroma']) u[name] = gl.getUniformLocation(prog, name);
      gl.uniform1i(u.uSrc, 0); gl.uniform1i(u.uTone, 1); gl.uniform1i(u.uRamp, 2);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      G.canvas = canvas; G.gl = gl; G.u = u; G.key = '';
      return true;
    } catch (error) { G.failed = true; G.gl = null; G.canvas = null; console.warn(String(error && error.message || error)); return false; }
  }
  function release() {
    if (G.gl) { const ext = G.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
    G.gl = null; G.canvas = null; G.key = '';
  }

  // La curva de tonos: a cada nivel de luz de la escena, el de la referencia que ocupa su mismo puesto.
  const TYPES = { none: 0, bayer: 1, dot: 2, line: 3, noise: 4 };
  function toneCurve(look, sceneHist, amount, out) {
    let total = 0;
    for (let i = 0; i < sceneHist.length; i++) total += sceneHist[i];
    const bins = sceneHist.length;
    for (let i = 0; i < 256; i++) {
      const at = i / 255 * (bins - 1), k = at | 0;
      // el puesto de este nivel en la escena (acumulado hasta él)
      let rank = 0;
      for (let j = 0; j < k; j++) rank += sceneHist[j];
      rank += sceneHist[k] * (at - k + 0.5);
      rank = total > 0 ? clamp(rank / total, 0, 1) : i / 255;
      const pos = rank * 32, lo = Math.min(31, pos | 0), matched = look.cdf[lo] + (look.cdf[lo + 1] - look.cdf[lo]) * (pos - lo);
      out[i] = Math.round(255 * clamp(i / 255 + (matched - i / 255) * amount, 0, 1));
    }
    return out;
  }
  function loadLook(look) {
    const gl = G.gl, u = G.u, K = Math.min(8, look.palette.length);
    const pal = new Float32Array(24);
    for (let k = 0; k < K; k++) pal.set(look.palette[k], k * 3);
    gl.uniform3fv(u.uPal, pal);
    gl.uniform1f(u.uPalN, K);
    gl.uniform3fv(u.uInk, look.palette[0]);
    gl.uniform1f(u.uLimited, look.limited ? 1 : 0);
    gl.uniform1f(u.uFlat, look.limited && look.screen.type === 'none' ? 1 : 0);
    gl.uniform1f(u.uCells, look.pixel || 0);
    gl.uniform4f(u.uDither, TYPES[look.screen.type] || 0, look.screen.freq || 0, look.screen.angle || 0, look.screen.strength || 0);
    gl.uniform2f(u.uGrain, look.grain.amount || 0, look.grain.cells || 300);
    gl.uniform1f(u.uEdge, look.edge || 0);
    gl.uniform1f(u.uVig, look.vignette || 0);
    gl.uniform1f(u.uSat, look.sat == null ? 1 : look.sat);
    gl.uniform1f(u.uRampMix, look.rampMix);
    const ramp = new Uint8Array(16 * 4);
    look.ramp.forEach((p, k) => { ramp[k * 4] = Math.round(clamp(p[0] + 0.5, 0, 1) * 255); ramp[k * 4 + 1] = Math.round(clamp(p[1] + 0.5, 0, 1) * 255); ramp[k * 4 + 3] = 255; });
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, G.ramp);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, ramp);
  }
  // Pinta «source» con el look en el lienzo del sombreador (w × h). scene: histograma de luz y color medio.
  const toneBytes = new Uint8Array(256);
  function draw(look, source, crop, w, h, scene, extra) {
    const gl = G.gl, u = G.u;
    if (G.canvas.width !== w || G.canvas.height !== h) { G.canvas.width = w; G.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.src);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    loadLook(look);
    toneCurve(look, scene.hist, look.tone == null ? 0.8 : look.tone, toneBytes);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.tone);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, toneBytes);
    gl.uniform4f(u.uCrop, crop[0], crop[1], crop[2], crop[3]);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uMirror, extra.mirror ? 1 : 0);
    gl.uniform1f(u.uScale, extra.scale || 1);
    gl.uniform1f(u.uSeed, extra.seed || 0);
    gl.uniform1f(u.uReveal, extra.reveal == null ? 2 : extra.reveal);
    gl.uniform1f(u.uAim, extra.aim ? 1 : 0);
    gl.uniform4f(u.uChroma, scene.mean[0], scene.mean[1], look.mean[0], look.mean[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ── Medir una imagen (para comparar dos): color, tonos, espectro y contornos ──
  function features(data, n) {
    const lab = labImage(data, n * n), hist = new Float32Array(5 * 7 * 7), tone = new Float32Array(16), lum = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const L = lab[i * 3];
      lum[i] = L;
      hist[Math.min(4, (L * 5) | 0) * 49 + Math.min(6, Math.max(0, ((lab[i * 3 + 1] + 0.35) / 0.7 * 7) | 0)) * 7 + Math.min(6, Math.max(0, ((lab[i * 3 + 2] + 0.35) / 0.7 * 7) | 0))]++;
      tone[Math.min(15, (L * 16) | 0)]++;
    }
    for (let i = 0; i < hist.length; i++) hist[i] /= n * n;
    for (let i = 1; i < 16; i++) tone[i] += tone[i - 1];
    for (let i = 0; i < 16; i++) tone[i] /= n * n;
    const pow = spectrum(lum, n), bands = new Float32Array(10);
    for (let v = -n / 2; v < n / 2; v++) for (let u = -n / 2; u < n / 2; u++) {
      const r = Math.hypot(u, v);
      if (r < 1.5 || r >= n / 2) continue;
      bands[Math.min(9, (Math.log2(r / 1.5) / Math.log2(n / 3) * 10) | 0)] += pow[((v + n) % n) * n + ((u + n) % n)];
    }
    let edge = 0;
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) edge += Math.abs(lum[y * n + x + 1] - lum[y * n + x - 1]) + Math.abs(lum[(y + 1) * n + x] - lum[(y - 1) * n + x]);
    return { hist, tone, bands, edge: edge / (n * n) };
  }
  // texture (0…1): cuánta textura fina tiene la REFERENCIA (lo decide ella, no el look que se prueba:
  // si lleva trama y el look no la trae, tiene que notarse en la nota). Con textura, el espectro pesa;
  // sin ella, la imagen es color y tonos, y el detalle fino lo pone la escena.
  function distance(a, b, texture) {
    let color = 0, tone = 0, spec = 0;
    for (let i = 0; i < a.hist.length; i++) color += Math.abs(a.hist[i] - b.hist[i]);
    for (let i = 0; i < 16; i++) tone += Math.abs(a.tone[i] - b.tone[i]);
    // (una banda casi vacía en las dos no cuenta: se compara por encima de un suelo proporcional a la energía total)
    let ea = 0, eb = 0;
    for (let i = 0; i < 10; i++) { ea += a.bands[i]; eb += b.bands[i]; }
    const floor = 0.004 * (ea + eb) / 2 + 1e-5;
    for (let i = 0; i < 10; i++) spec += Math.min(2, Math.abs(Math.log10((a.bands[i] + floor) / (b.bands[i] + floor))));
    const edge = Math.abs(a.edge - b.edge) / Math.max(0.02, a.edge, b.edge);
    // Cada parte va de 0 (igual) a 1 (nada que ver). El color y el espectro (la textura) pesan más.
    const c = color / 2, t = Math.min(1, tone / 16 * 4), s = Math.min(1, spec / 20 * 3), e = Math.min(1, edge);
    const k = texture == null ? 1 : texture;
    return { color: c, tone: t, spec: s, edge: e, total: (0.56 - 0.14 * k) * c + (0.2 - 0.06 * k) * t + (0.1 + 0.2 * k) * s + 0.14 * e };
  }
  function sceneOf(data, n) {
    const hist = new Float32Array(64), tmp = new Float32Array(3);
    let a = 0, b = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) { toLab(data[p], data[p + 1], data[p + 2], tmp, 0); hist[Math.min(63, (tmp[0] * 64) | 0)]++; a += tmp[1]; b += tmp[2]; }
    return { hist, mean: [a / n, b / n] };
  }

  // Reducir promediando: a mitades, hasta que el lado mayor no pase de «max» (reducir de golpe no
  // promedia: se salta puntos y deja la trama dentro).
  function halve(canvas, max) {
    let cur = canvas;
    while (Math.max(cur.width, cur.height) > max) {
      const next = surface({ canvas: null, ctx: null }, Math.max(1, Math.round(cur.width / 2)), Math.max(1, Math.round(cur.height / 2)));
      next.ctx.imageSmoothingEnabled = true; next.ctx.drawImage(cur, 0, 0, next.canvas.width, next.canvas.height);
      cur = next.canvas;
    }
    return cur;
  }

  // ── Ponerse a prueba: quitarle el estilo a la referencia, volver a ponérselo y comparar ──
  const pad = { canvas: null, ctx: null };
  const surface = (slot, w, h) => { if (!slot.canvas) { slot.canvas = document.createElement('canvas'); slot.ctx = slot.canvas.getContext('2d', { willReadFrequently: true }); } if (slot.canvas.width !== w || slot.canvas.height !== h) { slot.canvas.width = w; slot.canvas.height = h; } return slot; };
  // Dos comparaciones, porque miden cosas distintas:
  //   · con la referencia ENTERA, reducida: ¿quedan sus colores y sus tonos donde estaban? (bloque a
  //     bloque, con la curva y el color del look tal cual: un look ajeno los cambia y se nota);
  //   · con un recorte SIN reducir: ¿son las mismas tintas, la misma textura, los mismos contornos?
  function fit(look, ref, span, whole) {
    if (!ensureGl()) return look;
    const n = FIT_N, gl = G.gl, B = 16;
    const blocks = data => {                                      // color medio de cada bloque (B × B bloques), en OKLab
      const out = new Float32Array(B * B * 3), tmp = new Float32Array(3), s = n / B;
      for (let i = 0, p = 0; i < n * n; i++, p += 4) { toLab(data[p], data[p + 1], data[p + 2], tmp, 0); const o = (Math.floor(Math.floor(i / n) / s) * B + Math.floor((i % n) / s)) * 3; out[o] += tmp[0]; out[o + 1] += tmp[1]; out[o + 2] += tmp[2]; }
      for (let i = 0; i < out.length; i++) out[i] /= s * s;
      return out;
    };
    const all = surface({ canvas: null, ctx: null }, n, n), allSoft = surface({ canvas: null, ctx: null }, n, n);
    let allBlocks = null, allScene = null;
    if (whole) {
      all.ctx.imageSmoothingEnabled = true; all.ctx.imageSmoothingQuality = 'high';
      all.ctx.drawImage(halve(whole, n * 2), 0, 0, n, n);
      allSoft.ctx.imageSmoothingEnabled = true; allSoft.ctx.imageSmoothingQuality = 'high'; allSoft.ctx.drawImage(halve(all.canvas, 16), 0, 0, n, n);
      allBlocks = blocks(all.ctx.getImageData(0, 0, n, n).data);
      allScene = sceneOf(allSoft.ctx.getImageData(0, 0, n, n).data, n * n);
    }
    // La referencia a su tamaño (un recorte central de n de lado) y su versión sin estilo: reducida
    // hasta que no quede trama ni píxel, y vuelta a ampliar con suavizado.
    const crop = surface({ canvas: null, ctx: null }, n, n), soft = surface({ canvas: null, ctx: null }, n, n);
    const side = Math.min(n, ref.width, ref.height);
    crop.ctx.drawImage(ref, (ref.width - side) / 2, (ref.height - side) / 2, side, side, 0, 0, n, n);
    // Cuánto se emborrona: hasta borrar la trama, el píxel o el ruido si los hay; si es tinta plana,
    // solo lo justo para perder las líneas (las formas tienen que seguir ahí).
    const patterned = !!look.pixel || look.screen.type !== 'none', textured = patterned || look.grain.amount > 0.03;
    soft.ctx.imageSmoothingEnabled = true; soft.ctx.imageSmoothingQuality = 'high'; soft.ctx.drawImage(halve(crop.canvas, fit.blur || (patterned ? 8 : 16)), 0, 0, n, n);
    const target = features(crop.ctx.getImageData(0, 0, n, n).data, n);
    // Textura fina de la referencia: qué parte de su energía está en las bandas altas del espectro.
    let fineE = 0, allE = 0;
    for (let i = 0; i < 10; i++) { allE += target.bands[i]; if (i >= 6) fineE += target.bands[i]; }
    const share = allE > 0 ? fineE / allE : 0, texture = clamp((share - 0.05) / 0.2, 0, 1);
    // Los tonos a los que se lleva el recorte son los suyos propios, sin estilo (la curva del look es
    // la de la imagen entera, que puede tener zonas que aquí no salen): la prueba mide si la paleta,
    // la trama y el grano reconstruyen la imagen, no la curva.
    const softData = soft.ctx.getImageData(0, 0, n, n).data, cropL = new Float32Array(n * n), tmp = new Float32Array(3);
    for (let i = 0, p = 0; i < n * n; i++, p += 4) { toLab(softData[p], softData[p + 1], softData[p + 2], tmp, 0); cropL[i] = tmp[0]; }
    cropL.sort();
    const cropCdf = [];
    for (let i = 0; i <= 32; i++) cropCdf.push(cropL[Math.min(n * n - 1, Math.round(i / 32 * (n * n - 1)))]);
    const scene = sceneOf(softData, n * n);
    const scale = side / span, px = new Uint8Array(n * n * 4);
    const score = candidate => {
      // (la viñeta y el color medio son de la imagen entera: en un recorte no se pueden juzgar)
      draw({ ...candidate, cdf: cropCdf, mean: scene.mean, vignette: 0 }, soft.canvas, [0, 0, 1, 1], n, n, scene, { scale, seed: 0.37 });
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const d = distance(features(px, n), target, texture);
      d.place = 0;
      if (allBlocks) {
        draw(candidate, allSoft.canvas, [0, 0, 1, 1], n, n, allScene, { scale: n / whole.width, seed: 0.37 });
        gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const got = blocks(px);
        let err = 0;
        for (let by = 0; by < B; by++) for (let bx = 0; bx < B; bx++) {          // (lo leído viene de abajo arriba)
          const a = (by * B + bx) * 3, b = ((B - 1 - by) * B + bx) * 3;
          err += Math.hypot(allBlocks[a] - got[b], allBlocks[a + 1] - got[b + 1], allBlocks[a + 2] - got[b + 2]);
        }
        d.place = Math.min(1, err / (B * B) / 0.2);
        d.total = 0.72 * d.total + 0.28 * d.place;
      }
      return d;
    };
    // Los mandos continuos, de uno en uno: se prueba alrededor de lo medido y se queda el que más acerca.
    const knobs = [
      ['sat', l => l.sat, (l, v) => { l.sat = v; }, look.limited || look.rampMix > 0.9 ? [1] : [0.6, 0.8, 1, 1.25, 1.5]],
      // (con paleta cerrada, la trama de puntos o de líneas es lo que da los tonos: va entera)
      ['strength', l => l.screen.strength, (l, v) => { l.screen.strength = v; }, look.screen.type === 'none' || (look.limited && (look.screen.type === 'dot' || look.screen.type === 'line')) ? [look.screen.strength] : [0.5, 0.75, 1].map(k => +(clamp(look.screen.strength * k, 0, 1)).toFixed(3)).concat(look.screen.strength < 1 ? [+clamp(look.screen.strength * 1.3, 0, 1).toFixed(3)] : [])],
      ['grain', l => l.grain.amount, (l, v) => { l.grain.amount = v; }, // (el grano no se sube por encima de lo medido: subiría para imitar el detalle que el emborronado quitó)
      look.grain.amount ? [0.4, 0.7, 1].map(k => +(look.grain.amount * k).toFixed(3)) : [0]],
      ['edge', l => l.edge, (l, v) => { l.edge = v; }, look.edge ? [0, 0.5, 0.75, 1].map(k => +(look.edge * k).toFixed(3)) : [0]],
    ];
    const best = JSON.parse(JSON.stringify(look));
    let d = score(best), runs = 1;
    for (let pass = 0; pass < 2; pass++) for (const [, get, set, values] of knobs) {
      if (values.length < 2) continue;
      const keep = get(best);
      let top = keep, topD = d;
      for (const v of values) { if (v === keep) continue; set(best, v); const dv = score(best); runs++; if (dv.total < topD.total - 0.002) { top = v; topD = dv; } }
      set(best, top); d = topD;
    }
    if (fit.debug) { score(best); const c = document.createElement('canvas'); c.width = c.height = n; const im = c.getContext('2d').createImageData(n, n); im.data.set(px); c.getContext('2d').putImageData(im, 0, 0); fit.debug = { synth: c.toDataURL(), target: crop.canvas.toDataURL(), soft: soft.canvas.toDataURL() }; }
    best.score = Math.round(100 * Math.exp(-1.5 * d.total));
    best.fit = { texture: +texture.toFixed(2), place: +d.place.toFixed(3), color: +d.color.toFixed(3), tone: +d.tone.toFixed(3), spec: +d.spec.toFixed(3), edge: +d.edge.toFixed(3), runs };
    G.key = '';
    return best;
  }

  // ── Los looks guardados ─────────────────────────────────────────────────────
  const S = { looks: [], aim: false, revealAt: 0, frame: 0, ms: 0, scene: { hist: new Float32Array(64).fill(1), mean: [0, 0] }, sceneAt: -1e9, last: null, busy: false };
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) S.looks = saved.filter(l => l && l.v === 1 && l.id && Array.isArray(l.palette)); } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S.looks)); } catch (_) {} };
  const family = () => (typeof CAM_FAMILIES !== 'undefined' ? CAM_FAMILIES.CLON : null);
  function syncVariants() {
    const fam = family();
    if (!fam) return;
    fam.variants = S.looks.length ? S.looks.map(l => ({ id: l.id, label: l.name, hint: l.name + ' · ' + describe(l) })) : [{ id: 'NUEVO', label: 'NUEVO', hint: 'CLON · apunta a una imagen y toca COPIAR, o abre una con ABRIR: FLIP arma una cámara con su look.' }];
  }
  syncVariants();
  const current = () => S.looks.find(l => l.id === (typeof camVariant !== 'undefined' ? camVariant : '')) || null;
  const mine = () => typeof camFamily !== 'undefined' && camFamily === 'CLON';
  const apply = () => { if (typeof _applyCamState === 'function') _applyCamState(); };
  const say = (text, ms) => { if (window.flipShell && flipShell.hint) flipShell.hint(text, ms || 2600); };

  // Aprender de una imagen (lienzo, imagen o cuadro de cámara): mide, se pone a prueba y guarda.
  function learn(source, sw, sh, region) {
    const r = region || [0, 0, sw, sh];
    const long = Math.max(r[2], r[3]), k = Math.min(1, 256 / long);
    const tw = Math.max(16, Math.round(r[2] * k)), th = Math.max(16, Math.round(r[3] * k));
    const thumb = surface({ canvas: null, ctx: null }, tw, th);
    thumb.ctx.imageSmoothingEnabled = true; thumb.ctx.imageSmoothingQuality = 'high';
    thumb.ctx.drawImage(source, r[0], r[1], r[2], r[3], 0, 0, tw, th);
    // El recorte fino, sin reducir: FFT_N de lado del centro de la referencia (o toda, si es pequeña).
    const side = Math.min(FFT_N, Math.floor(Math.min(r[2], r[3])));
    const ref = surface({ canvas: null, ctx: null }, Math.round(r[2]), Math.round(r[3]));
    ref.ctx.drawImage(source, r[0], r[1], r[2], r[3], 0, 0, ref.canvas.width, ref.canvas.height);
    const fineCanvas = surface({ canvas: null, ctx: null }, FFT_N, FFT_N);
    fineCanvas.ctx.imageSmoothingEnabled = false;
    fineCanvas.ctx.drawImage(ref.canvas, (ref.canvas.width - side) / 2, (ref.canvas.height - side) / 2, side, side, 0, 0, FFT_N, FFT_N);
    const fd = fineCanvas.ctx.getImageData(0, 0, FFT_N, FFT_N).data, lum = new Float32Array(FFT_N * FFT_N), tmp = new Float32Array(3);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) { toLab(fd[p], fd[p + 1], fd[p + 2], tmp, 0); lum[i] = tmp[0]; }
    // (si la referencia es más pequeña que el recorte, se amplió sin suavizar: las medidas se corrigen con «span»)
    const span = ref.canvas.width * (FFT_N / side);
    const sp = surface({ canvas: null, ctx: null }, 128, 128);
    sp.ctx.imageSmoothingEnabled = false;
    sp.ctx.drawImage(ref.canvas, 0, 0, ref.canvas.width, ref.canvas.height, 0, 0, 128, 128);
    const low = halve(ref.canvas, 40);
    const lowData = low.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, low.width, low.height).data;
    let look = analyze({ data: thumb.ctx.getImageData(0, 0, tw, th).data, width: tw, height: th }, { lum, n: FFT_N, span }, { data: sp.ctx.getImageData(0, 0, 128, 128).data, n: 128 * 128 }, { data: lowData, n: low.width * low.height });
    look = fit(look, fineCanvas.canvas, span, ref.canvas);
    look.name = nameOf(look);
    return look;
  }
  function keep(look) {
    let n = 1;
    const used = new Set(S.looks.map(l => l.id));
    while (used.has('C' + n)) n++;
    look.id = 'C' + n;
    look.at = Date.now();
    if (S.looks.some(l => l.name === look.name)) { let k = 2; while (S.looks.some(l => l.name === look.name + ' ' + k)) k++; look.name += ' ' + k; }
    S.looks.push(look);
    while (S.looks.length > MAX_LOOKS) S.looks.shift();
    save(); syncVariants();
    if (mine()) { camVariant = look.id; apply(); }
    paint();
    return look;
  }
  function forget(id) {
    S.looks = S.looks.filter(l => l.id !== id);
    save(); syncVariants();
    if (mine()) { camVariant = S.looks.length ? S.looks[S.looks.length - 1].id : 'NUEVO'; apply(); }
    paint();
  }
  // Aprender, guardar y revelar; con la mascota «mirando» mientras tanto.
  function adopt(source, sw, sh, region) {
    if (S.busy) return Promise.resolve(null);
    S.busy = true;
    const shutter = $('deckShutter');
    if (shutter) shutter.classList.add('mirando');
    say('Mirando la referencia…', 4000);
    return new Promise(resolve => setTimeout(() => {
      let look = null;
      try { look = keep(learn(source, sw, sh, region)); S.aim = false; S.revealAt = performance.now(); say(look.name + ' · ' + describe(look), 5200); }
      catch (error) { console.warn('CLON:', error); say('No pude leer esa imagen', 2600); }
      S.busy = false;
      if (shutter) shutter.classList.remove('mirando');
      paint();
      resolve(look);
    }, 60));
  }

  // ── La cámara ───────────────────────────────────────────────────────────────
  const probe = { canvas: null, ctx: null };
  function renderClon(source, srcW, srcH, ctx, mirror, variant, options) {
    if (!ensureGl()) return false;
    const started = performance.now(), opts = options || {};
    const outW = Math.max(1, Math.round(opts.outW || ctx.canvas.width)), outH = Math.max(1, Math.round(opts.outH || ctx.canvas.height));
    const look = S.looks.find(l => l.id === variant) || null;
    const aim = (S.aim || !look) && opts.path !== 'capture';
    // Resolución interna: la de la salida, con tope (la vista previa no necesita más; la foto, sí).
    const cap = opts.path === 'capture' ? 2048 : 900, k = Math.min(1, cap / Math.max(outW, outH));
    const w = Math.max(16, Math.round(outW * k)), h = Math.max(16, Math.round(outH * k));
    const [sx, sy, sw, sh] = typeof cropCoordsForDims === 'function' ? cropCoordsForDims(srcW, srcH, w, h) : [0, 0, srcW, srcH];
    const crop = [sx / srcW, sy / srcH, sw / srcW, sh / srcH];
    S.last = { source, srcW, srcH, sx, sy, sw, sh };
    // La escena se mide de vez en cuando (su luz y su color medio) y se sigue despacio.
    if (started - S.sceneAt > 330) {
      surface(probe, 32, 24);
      probe.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 32, 24);
      const fresh = sceneOf(probe.ctx.getImageData(0, 0, 32, 24).data, 32 * 24), cold = started - S.sceneAt > 1500, mix = cold ? 1 : 0.35;
      for (let i = 0; i < 64; i++) S.scene.hist[i] += (fresh.hist[i] - S.scene.hist[i]) * mix;
      S.scene.mean[0] += (fresh.mean[0] - S.scene.mean[0]) * mix; S.scene.mean[1] += (fresh.mean[1] - S.scene.mean[1]) * mix;
      S.sceneAt = started;
    }
    const reveal = started - S.revealAt < 900 && opts.path !== 'capture' ? (started - S.revealAt) / 900 : 2;
    draw(look || NEUTRAL, source, crop, w, h, S.scene, { mirror, aim, reveal, seed: (Math.floor(started / 66) % 97) / 97 });
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.imageSmoothingEnabled = !(look && (look.pixel || look.limited));
    ctx.drawImage(G.canvas, 0, 0, outW, outH);
    ctx.restore();
    S.frame++;
    S.ms += (performance.now() - started - S.ms) * 0.1;
    return true;
  }
  const NEUTRAL = { palette: [[0, 0, 0], [1, 0, 0]], limited: false, cdf: Array.from({ length: 33 }, (_, i) => i / 32), ramp: Array.from({ length: 16 }, () => [0, 0]), rampMix: 0, mean: [0, 0], pixel: 0, screen: { type: 'none', freq: 0, angle: 0, strength: 0 }, grain: { amount: 0, cells: 300 }, edge: 0, vignette: 0, tone: 0, sat: 1 };

  // ── Sus teclas: COPIAR (con la cámara) y ABRIR (una imagen) ─────────────────
  // En la piel INTERFAZ van en la banda; en OBJETO, en una fila bajo las variantes.
  let band = null, row = null, picker = null;
  function capture() {
    const f = S.last;
    if (!f) { say('Todavía no hay imagen de la cámara', 2200); return Promise.resolve(null); }
    // Solo lo de dentro del encuadre (el 76 % central): lo de alrededor no es la referencia.
    const rw = f.sw * 0.76, rh = f.sh * 0.76;
    return adopt(f.source, f.srcW, f.srcH, [f.sx + (f.sw - rw) / 2, f.sy + (f.sh - rh) / 2, rw, rh]);
  }
  function copyKey() {
    if (S.busy) return;
    if (S.aim || !current()) { capture(); return; }               // ya se está apuntando (o no hay ningún look todavía)
    S.aim = true; paint();
    say('Encuadra la imagen que quieras copiar y toca CAPTURAR', 4200);
  }
  function openKey() {
    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file'; picker.accept = 'image/*'; picker.id = 'clonArchivo'; picker.hidden = true;
      document.body.appendChild(picker);
      picker.addEventListener('change', () => {
        const file = picker.files && picker.files[0];
        picker.value = '';
        if (!file) return;
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
          // Una referencia enorme se reduce (la trama fina de un escaneo gigante no cabría en vivo de todos modos).
          const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = surface({ canvas: null, ctx: null }, Math.max(16, Math.round(img.naturalWidth * k)), Math.max(16, Math.round(img.naturalHeight * k)));
          c.ctx.drawImage(img, 0, 0, c.canvas.width, c.canvas.height);
          URL.revokeObjectURL(url);
          adopt(c.canvas, c.canvas.width, c.canvas.height);
        };
        img.onerror = () => { URL.revokeObjectURL(url); say('No pude abrir esa imagen', 2400); };
        img.src = url;
      });
    }
    picker.click();
  }
  function paint() {
    const on = mine();
    document.body.classList.toggle('con-rapidas-clon', on);
    if (!on && S.aim) S.aim = false;
    const label = S.busy ? 'MIRANDO…' : S.aim || (on && !current()) ? 'CAPTURAR' : 'COPIAR';
    for (const host of [band, row]) {
      if (!host) continue;
      host.hidden = !on;
      const key = host.querySelector('[data-clon="copiar"]');
      key.lastChild.textContent = label;
      key.classList.toggle('is-on', S.aim || (on && !current()));
    }
  }
  function mount() {
    if (!window.flipShell || band) return;
    const keys = '<button class="hw KEY" type="button" data-clon="copiar"><span>COPIAR</span></button><button class="hw KEY" type="button" data-clon="abrir"><span>ABRIR</span></button>';
    const head = document.querySelector('.si-banda-cabeza'), tray = document.querySelector('#camDeck .deck-looks');
    if (head) { band = flipShell.el('div', { class: 'si-rapidas clon-rapidas', role: 'group', 'aria-label': 'Clonar un look' }, keys.replace(/KEY/g, 'si-chip')); head.insertBefore(band, head.querySelector('.si-abrir')); }
    if (tray) { row = flipShell.el('div', { class: 'deck-variants reaccion-teclas clon-teclas', role: 'group', 'aria-label': 'Clonar un look' }, keys.replace(/KEY/g, 'hw-keycap')); tray.before(row); }
    for (const host of [band, row]) {
      if (!host) continue;
      host.querySelector('[data-clon="copiar"]').addEventListener('click', copyKey);
      host.querySelector('[data-clon="abrir"]').addEventListener('click', openKey);
    }
    for (const id of ['deckLooks', 'deckVariants']) { const node = $(id); if (node) new MutationObserver(() => queueMicrotask(() => { if (mine() && !current() && S.looks.length) { camVariant = S.looks[S.looks.length - 1].id; apply(); } paint(); })).observe(node, { subtree: true, attributes: true, attributeFilter: ['class'] }); }
    paint();
  }
  if (document.readyState === 'complete') mount(); else addEventListener('load', mount);

  window.renderClon = renderClon;
  window.flipClon = {
    analyze, describe, nameOf, release, _fit: fit,
    learn: (source, w, h, region) => learn(source, w || source.width, h || source.height, region),
    adopt: (source, w, h, region) => adopt(source, w || source.width, h || source.height, region),
    keep, forget, capture,
    looks: () => JSON.parse(JSON.stringify(S.looks)),
    aim(on) { if (on != null) { S.aim = !!on; paint(); } return S.aim; },
    state: () => ({ looks: S.looks.length, aim: S.aim, busy: S.busy, frame: S.frame, ms: +S.ms.toFixed(2), gl: !!G.gl, failed: G.failed, lost: G.lost, current: current() ? current().id : null }),
  };
})();
