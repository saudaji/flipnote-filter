// FLIP · CLON: una cámara que aprende el look de cualquier imagen.
//
// Se le enseña una referencia —un cartel al que se apunta, una portada, una foto que se abre— y
// arma con ella una cámara nueva que funciona en vivo. No elige «la cámara de FLIP que más se
// parece»: mide la referencia y construye un look a su medida. Todo ocurre en el aparato: es
// estadística de la imagen y un sombreador (el único modelo es el detector de personas de la tecla
// FIGURA, opcional: también corre en el aparato, y se descarga la primera vez que se usa).
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
//       · el grano (ruido fino en las zonas lisas), las líneas de tinta y la viñeta;
//       · el reparto de color entero (una nube de muestras), para cuando a una misma luz hay varios
//         colores —un neón cian y rosa, una foto con dominante—;
//       · la suavidad (qué tan desenfocados están sus bordes más nítidos) y el resplandor (la luz que
//         lo que brilla derrama sobre un fondo oscuro), que se le quita antes de medir lo demás.
//
//   2 · APLICAR (renderClon). Un sombreador pinta la cámara en vivo: iguala los tonos de la escena a
//       los de la referencia (los de TU escena, medidos cada pocos cuadros), lleva el color hacia el
//       suyo, y si la paleta es cerrada encaja cada punto en sus tintas con el tramado que tenía
//       (puntos, líneas, ordenado o ruido), sobre su rejilla de píxel si la había; luego contorno,
//       grano y viñeta. En color continuo, el color sale de llevar la nube de colores de la escena a
//       la de la referencia (transporte por rebanadas, en una tabla de 16³). Antes de todo eso la
//       escena se desenfoca si la referencia era suave, y al final se suma el resplandor.
//
//   3 · PONERSE A PRUEBA (fit). Para no fiarse de las medidas: a la referencia se le quita el estilo
//       (se emborrona hasta dejar solo sus manchas de color), se la vuelve a estilizar con lo
//       aprendido y se compara con la original —en color, tonos, espectro y contornos—. Los mandos
//       continuos se ajustan hasta que la reconstrucción se parece lo más posible, y esa distancia
//       final es el «parecido» que se enseña. Un look que no sabe reconstruir su propia referencia
//       saca mala nota, y se ve.
//
// Lo que clona: color, tonos, trama, píxel, grano, contorno, suavidad y resplandor. Lo que no: el
// dibujo (el trazo de una ilustración, la tipografía, el contenido). Eso pediría un modelo generativo.
// Qué parte de la escena es «la figura» solo lo sabe con la tecla FIGURA (looks de fondo liso), que
// usa el detector de personas de FLIP; sin ella, o si no hay una persona, el look se reparte por luz.
// Se prueba contra la verdad en tests/clon.cjs: estilos de receta conocida (tests/lib/clon-estilos.js).
(function () {
  'use strict';
  const KEY = 'flip.clon', MAX_LOOKS = 30, A_MANO = 4, REVEAL_MS = 760, FFT_N = 256, FIT_N = 128, COLOR_FAR = 0.1;
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
      let bi = -1, bj = -1, bd = 0.065 * 0.065;
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
    list = list.filter(e => e.w >= 0.008);                         // (una tinta de verdad puede ocupar el 1 % de la imagen)
    list.sort((x, y) => x.c[0] - y.c[0]);
    // Cuánto se aparta la imagen de su paleta: poco = paleta cerrada (tintas planas).
    let err = 0;
    for (let i = 0; i < pts.length; i++) { let bd = 1e9; for (const e of list) { const d = dist(pts[i], e.c); if (d < bd) bd = d; } err += Math.sqrt(bd); }
    return { colors: list.map(e => e.c), shares: list.map(e => e.w), error: err / pts.length };
  }

  // ── Rejilla de píxel ────────────────────────────────────────────────────────
  // Un píxel art tiene sus saltos de luz en una rejilla: cada p puntos, en columnas y en filas. Se
  // busca así: el perfil de saltos por columna (y por fila) se correlaciona consigo mismo; su primer
  // pico da el periodo, que no tiene por qué ser entero (una imagen reescalada, una pantalla
  // fotografiada). Como la rejilla puede venir algo girada, se prueban nueve inclinaciones y se queda
  // la que mejor la alinea. Y para no confundirla con otras cosas periódicas:
  //   · los saltos tienen que estar CONCENTRADOS en la rejilla (dentro de un bloque no pasa nada): eso
  //     descarta las tramas de puntos;
  //   · tienen que ser saltos de verdad: los bloques de 8 × 8 de una foto en JPEG también forman
  //     rejilla, pero sus saltos son mínimos.
  function pixelGrid(lum, N) {
    const axis = vertical => {
      let best = null;
      for (let s = -4; s <= 4; s++) {
        const tan = Math.tan(s * Math.PI / 180), g = new Float32Array(N);
        for (let a = 0; a < N - 1; a++) {
          const off = (a - N / 2) * tan;
          for (let b = 0; b < N - 1; b++) {
            const d = vertical ? Math.abs(lum[a * N + b + 1] - lum[a * N + b]) : Math.abs(lum[(b + 1) * N + a] - lum[b * N + a]);
            const at = Math.round(b - off);
            if (at >= 0 && at < N) g[at] += d;
          }
        }
        let mean = 0;
        for (let i = 8; i < N - 8; i++) mean += g[i];
        mean /= N - 16;
        let varg = 0;
        for (let i = 8; i < N - 8; i++) varg += (g[i] - mean) ** 2;
        if (varg < 1e-9) continue;
        const r = new Float32Array(82);
        let rmax = 0;
        for (let lag = 3; lag <= 80; lag++) { let acc = 0; for (let i = 8; i < N - 8 - lag; i++) acc += (g[i] - mean) * (g[i + lag] - mean); r[lag] = acc / varg; if (r[lag] > rmax) rmax = r[lag]; }
        let lag = 0;
        for (let k = 4; k < 80; k++) if (r[k] > r[k - 1] && r[k] >= r[k + 1] && r[k] > 0.3 && r[k] >= 0.6 * rmax) { lag = k; break; }   // el primer pico fuerte: el periodo, no un múltiplo
        if (!lag) continue;
        const den = r[lag - 1] - 2 * r[lag] + r[lag + 1], p = lag + (Math.abs(den) > 1e-9 ? clamp(0.5 * (r[lag - 1] - r[lag + 1]) / den, -0.5, 0.5) : 0);
        // ¿Cuánto de los saltos cae en la rejilla (con su mejor arranque)?
        // (con ventana estrecha si el periodo es corto; y se mide lo que EXCEDE del azar: con periodos
        //  cortos la ventana ya cubre media rejilla y cualquier cosa «se concentra»)
        const win = p >= 8 ? 1.5 : p >= 5 ? 1 : 0.5;
        let total = 0, top = 0, teeth = 0;
        for (let i = 8; i < N - 8; i++) total += g[i];
        for (let ph = 0; ph < p; ph += 0.5) {
          let on = 0, n = 0;
          for (let i = 8; i < N - 8; i++) { const d = ((i - ph) % p + p) % p; if (Math.min(d, p - d) <= win) on += g[i]; }
          for (let t = ph; t < N - 8; t += p) if (t >= 8) n++;
          if (on > top) { top = on; teeth = n; }
        }
        const cover = Math.min(0.95, (2 * win + 1) / p), raw = total > 0 ? top / total : 0, conc = Math.max(0, (raw - cover) / (1 - cover));
        const jump = teeth ? top / (teeth * (N - 1)) : 0, quality = r[lag] * conc;
        if (!best || quality > best.quality) best = { p, r: r[lag], conc, jump, shear: s, quality };
      }
      return best;
    };
    const x = axis(true), y = axis(false);
    if (!x || !y) return null;
    const period = (x.p + y.p) / 2, jump = (x.jump + y.jump) / 2;
    if (Math.abs(x.p - y.p) / period > 0.08 || x.conc < 0.45 || y.conc < 0.45) return null;
    if (jump < 0.03 || (Math.abs(period - 8) < 0.3 && jump < 0.06)) return null;      // bloques de compresión, no píxeles
    return { period, jump: +jump.toFixed(3), conc: +Math.min(x.conc, y.conc).toFixed(2), shear: [x.shear, y.shear] };
  }

  // ── Luz desigual ────────────────────────────────────────────────────────────
  // Un cartel fotografiado casi nunca está iluminado por igual: de un lado sale más claro que del
  // otro, y entonces cada tinta parece dos o tres. Se busca un plano de luz: los puntos de un mismo
  // color (misma cromaticidad, que no cambia con la luz) deberían tener la misma luminosidad, así que
  // lo que varíe dentro de cada color, de un lado a otro de la imagen, es la luz. Se ajusta ese plano
  // (en logaritmo, con pesos que ignoran lo que se sale) y solo se usa si de verdad explica la
  // variación; y quien lo llama solo lo acepta si la paleta mejora. Así no «aplana» un duotono ni una foto.
  // pts: [x, y, r, g, b] por muestra, con x e y de −0,5 a 0,5.
  function lightPlane(pts, n) {
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const o = i * 5, r = LIN[pts[o + 2]], g = LIN[pts[o + 3]], b = LIN[pts[o + 4]], sum = r + g + b;
      if (sum < 0.04 || (pts[o + 2] > 250 && pts[o + 3] > 250 && pts[o + 4] > 250)) continue;         // ni lo negro (sin color que medir) ni un reflejo quemado
      const key = (Math.min(11, (r / sum * 12) | 0) << 4) | Math.min(11, (g / sum * 12) | 0);
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(pts[o], pts[o + 1], Math.log(0.2126 * r + 0.7152 * g + 0.0722 * b + 1e-4));
    }
    const obs = [];
    for (const a of groups.values()) {
      const m = a.length / 3;
      if (m < 20) continue;
      let mx = 0, my = 0, ml = 0, minX = 1, maxX = -1, minY = 1, maxY = -1;
      for (let i = 0; i < a.length; i += 3) { mx += a[i]; my += a[i + 1]; ml += a[i + 2]; if (a[i] < minX) minX = a[i]; if (a[i] > maxX) maxX = a[i]; if (a[i + 1] < minY) minY = a[i + 1]; if (a[i + 1] > maxY) maxY = a[i + 1]; }
      if (maxX - minX < 0.25 && maxY - minY < 0.25) continue;      // un color que solo está en un rincón no dice nada de la luz
      mx /= m; my /= m; ml /= m;
      for (let i = 0; i < a.length; i += 3) obs.push(a[i] - mx, a[i + 1] - my, a[i + 2] - ml);
    }
    if (obs.length < 450) return null;
    let bx = 0, by = 0;
    for (let it = 0; it < 5; it++) {
      let sxx = 0, sxy = 0, syy = 0, sxl = 0, syl = 0;
      for (let i = 0; i < obs.length; i += 3) {
        const dx = obs[i], dy = obs[i + 1], dl = obs[i + 2], res = Math.abs(dl - (bx * dx + by * dy)), wt = it === 0 || res < 0.08 ? 1 : 0.08 / res;
        sxx += wt * dx * dx; sxy += wt * dx * dy; syy += wt * dy * dy; sxl += wt * dx * dl; syl += wt * dy * dl;
      }
      const det = sxx * syy - sxy * sxy;
      if (Math.abs(det) < 1e-9) return null;
      bx = (syy * sxl - sxy * syl) / det; by = (sxx * syl - sxy * sxl) / det;
    }
    let ssT = 0, ssR = 0;
    for (let i = 0; i < obs.length; i += 3) { ssT += obs[i + 2] ** 2; ssR += (obs[i + 2] - bx * obs[i] - by * obs[i + 1]) ** 2; }
    const r2 = ssT > 1e-6 ? 1 - ssR / ssT : 0;
    if (r2 < 0.65 || Math.exp(0.5 * (Math.abs(bx) + Math.abs(by))) < 1.12) return null;
    return { bx, by, r2: +r2.toFixed(2) };
  }
  // Lo que hay que multiplicar un valor (0…255) en (x, y) para deshacer esa luz.
  const lightGain = (plane, x, y) => clamp(Math.exp(-(plane.bx * x + plane.by * y) / 2.2), 0.55, 1.9);

  // ── El análisis ─────────────────────────────────────────────────────────────
  // thumb: { data, width, height } de la referencia reducida (lado mayor ≤ 256).
  // fine: { lum (Float32Array n × n, 0…1), n, span } un recorte central SIN reducir (n píxeles de lado
  //       sobre una referencia de «span» píxeles de ancho): ahí se ven la trama y la rejilla de píxel.
  // sparse: { data, n } toda la referencia muestreada SIN suavizar (un punto de cada tantos): de ahí salen
  //         la paleta (reducir suavizando mezcla las tintas e inventa colores intermedios).
  // soft: { data, n } la referencia muy reducida promediando: de ahí salen los tonos. Una trama o un
  //       tramado representan un tono continuo con puntos de dos tintas; la curva que hay que copiar es
  //       la de ese tono, no la de los puntos (que solo tiene dos valores).
  // back: { rgb, share, samples } si la referencia tiene fondo liso («samples»: cuántas de las muestras de
  //       «sparse» son del fondo). Con fondo, lo que se mide es la figura: el fondo no diluye el color
  //       ni decide si la paleta es cerrada, y en los tonos cuenta como mucho por la mitad (la cámara
  //       no se queda negra en sus tres cuartas partes porque la referencia lo fuera).
  // ── Llevar un reparto de color a otro (transporte por rebanadas, Pitié y otros, 2005) ──
  // Dos nubes de puntos en OKLab: la escena (ya con los tonos de la referencia) y la referencia. Se
  // busca cómo mover cada color de la escena para que su nube quede como la de la referencia,
  // moviendo lo menos posible: lo cálido y claro de la escena va a lo cálido y claro de la referencia,
  // lo frío a lo frío. Se hace por rebanadas: se miran las dos nubes a lo largo de una dirección, se
  // igualan sus repartos en esa dirección (como una curva de tonos), y se repite con otras direcciones
  // hasta que casan desde todas. Lo mismo que se le hace a la nube se le hace a una rejilla de 16³
  // colores, y esa rejilla es la tabla con la que el sombreador mueve cada punto de la imagen.
  const OT_M = 600, OT_N = 16, OT_KNOTS = 40, OT_SPAN = 0.32, OT_TURNS = 10, OT_JITTER = 0.012, OT_SMOOTH = 1;
  // (los puestos en que se comparan los dos repartos: más juntos en los extremos, que es donde viven
  //  los brillos y las sombras pequeñas —una lámpara, un reflejo—; repartidos por igual, se los comía el vecino)
  const OT_AT = Array.from({ length: OT_KNOTS + 1 }, (_, j) => 0.5 * (1 - Math.cos(Math.PI * j / OT_KNOTS)));
  const OT_BASES = (() => {                                       // direcciones fijas (las mismas siempre: la tabla no baila)
    const list = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]]];
    let seed = 0x9e3779b9;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
    while (list.length < OT_TURNS) {
      const u = [rnd(), rnd(), rnd()], v = [rnd(), rnd(), rnd()], nu = Math.hypot(u[0], u[1], u[2]);
      for (let i = 0; i < 3; i++) u[i] /= nu;
      const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      for (let i = 0; i < 3; i++) v[i] -= d * u[i];
      const nv = Math.hypot(v[0], v[1], v[2]);
      if (nv < 0.2) continue;
      for (let i = 0; i < 3; i++) v[i] /= nv;
      list.push([u, v, [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]]);
    }
    return list;
  })();
  const OT_NOISE = (() => { const out = new Float32Array(2048); let seed = 77; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; for (let i = 0; i < out.length; i++) out[i] = (rnd() + rnd() + rnd() + rnd() - 2) * 1.732; return out; })();
  // Cuánto se usa el reparto. Si en la referencia la luz decide el color (un duotono, un mapa de
  // calor), nada: cada punto toma el color medio de su nivel de luz, sea cálido o frío en la escena
  // (ahí la nube de la referencia es un hilo, y llevar una nube a un hilo no dice nada del color). Si
  // a una misma luz hay varios colores, entero.
  const otKeep = look => { const t = clamp(((look.byLight == null ? 0 : look.byLight) - 0.75) / 0.15, 0, 1); return 1 - t * t * (3 - 2 * t); };
  const otNode = i => { const t = (2 * (i + 0.5) / OT_N - 1); return OT_SPAN * t * Math.abs(t); };   // más fina cerca del gris
  // Las muestras de la referencia, ya ordenadas a lo largo de cada dirección (se hace una vez por look).
  function otTarget(look) {
    if (look._ot && look._ot.from === look.ot) return look._ot;
    const M = look.ot.length / 6, pts = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) { pts[i * 3] = parseInt(look.ot.substr(i * 6, 2), 16) / 255; pts[i * 3 + 1] = parseInt(look.ot.substr(i * 6 + 2, 2), 16) / 255 - 0.5; pts[i * 3 + 2] = parseInt(look.ot.substr(i * 6 + 4, 2), 16) / 255 - 0.5; }
    const knots = [];
    for (const basis of OT_BASES) for (const e of basis) {
      const line = new Float32Array(M);
      for (let i = 0; i < M; i++) line[i] = pts[i * 3] * e[0] + pts[i * 3 + 1] * e[1] + pts[i * 3 + 2] * e[2];
      line.sort();
      const k = new Float32Array(OT_KNOTS + 1);
      for (let j = 0; j <= OT_KNOTS; j++) k[j] = line[Math.round(OT_AT[j] * (M - 1))];
      knots.push(k);
    }
    Object.defineProperty(look, '_ot', { value: { from: look.ot, knots }, enumerable: false, configurable: true, writable: true });   // (no se guarda con el look)
    return look._ot;
  }
  // scene: Float32Array de (luz ya con la curva del look, a, b) por muestra. Devuelve la tabla: por
  // cada nudo de la rejilla (16 de luz × 16 × 16 de color), cuánto se mueven su a y su b.
  const otWork = { grid: null, line: null, from: new Float32Array(OT_KNOTS + 1) };
  function transport(look, scene, count) {
    const target = otTarget(look), G3 = OT_N * OT_N * OT_N, X = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { X[i * 3] = scene[i * 3]; X[i * 3 + 1] = scene[i * 3 + 1] + OT_JITTER * OT_NOISE[(i * 2) & 2047]; X[i * 3 + 2] = scene[i * 3 + 2] + OT_JITTER * OT_NOISE[(i * 2 + 1) & 2047]; }
    if (!otWork.grid) { otWork.grid = new Float32Array(G3 * 3); otWork.home = new Float32Array(G3 * 3); for (let z = 0, o = 0; z < OT_N; z++) for (let y = 0; y < OT_N; y++) for (let x = 0; x < OT_N; x++, o += 3) { otWork.home[o] = z / (OT_N - 1); otWork.home[o + 1] = otNode(x); otWork.home[o + 2] = otNode(y); } }
    const grid = otWork.grid, from = otWork.from, line = otWork.line && otWork.line.length === count ? otWork.line : (otWork.line = new Float32Array(count));
    grid.set(otWork.home);
    // (v, a lo largo de «e»: de su puesto en la escena al valor que ocupa ese puesto en la referencia)
    const shift = (v, to) => {
      if (v <= from[0]) return to[0] - from[0];
      if (v >= from[OT_KNOTS]) return to[OT_KNOTS] - from[OT_KNOTS];
      let lo = 0, hi = OT_KNOTS;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (from[mid] <= v) lo = mid; else hi = mid; }
      const span = from[hi] - from[lo], t = span > 1e-7 ? (v - from[lo]) / span : 0.5;
      return to[lo] + (to[hi] - to[lo]) * t - v;
    };
    for (let turn = 0; turn < OT_TURNS; turn++) for (let axis = 0; axis < 3; axis++) {
      const e = OT_BASES[turn][axis], to = target.knots[turn * 3 + axis];
      for (let i = 0; i < count; i++) line[i] = X[i * 3] * e[0] + X[i * 3 + 1] * e[1] + X[i * 3 + 2] * e[2];
      const sorted = line.slice().sort();
      for (let j = 0; j <= OT_KNOTS; j++) from[j] = sorted[Math.round(OT_AT[j] * (count - 1))];
      for (let i = 0; i < count; i++) { const d = shift(line[i], to); X[i * 3] += d * e[0]; X[i * 3 + 1] += d * e[1]; X[i * 3 + 2] += d * e[2]; }
      for (let o = 0; o < G3 * 3; o += 3) { const d = shift(grid[o] * e[0] + grid[o + 1] * e[1] + grid[o + 2] * e[2], to); grid[o] += d * e[0]; grid[o + 1] += d * e[1]; grid[o + 2] += d * e[2]; }
    }
    let out = new Float32Array(G3 * 2);
    for (let i = 0; i < G3; i++) { out[i * 2] = grid[i * 3 + 1] - otWork.home[i * 3 + 1]; out[i * 2 + 1] = grid[i * 3 + 2] - otWork.home[i * 3 + 2]; }
    // La tabla se alisa (cada nudo con sus vecinos, en las tres direcciones): las rebanadas se igualan
    // con pocos puntos, y sin alisar dos colores casi iguales de la escena podían irse a tintes
    // distintos —bandas de color en un degradado oscuro—.
    for (let pass = 0; pass < OT_SMOOTH; pass++) for (const stride of [1, OT_N, OT_N * OT_N]) {
      const next = new Float32Array(G3 * 2);
      for (let i = 0; i < G3; i++) {
        const at = Math.floor(i / stride) % OT_N, lo = at > 0 ? i - stride : i, hi = at < OT_N - 1 ? i + stride : i;
        next[i * 2] = 0.25 * out[lo * 2] + 0.5 * out[i * 2] + 0.25 * out[hi * 2]; next[i * 2 + 1] = 0.25 * out[lo * 2 + 1] + 0.5 * out[i * 2 + 1] + 0.25 * out[hi * 2 + 1];
      }
      out = next;
    }
    return out;
  }
  // ── Suavidad y resplandor: lo que le pasa a la luz, no al color ──
  // Desenfoque gaussiano de un plano (tres pasadas de caja), en el sitio.
  function blurPlane(plane, w, h, sigma) {
    if (sigma < 0.3) return plane;
    const r = Math.max(1, Math.round(Math.sqrt(sigma * sigma * 4 + 1) / 2 - 0.5)), tmp = new Float32Array(w * h), k = 1 / (2 * r + 1);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) { let sum = 0; const o = y * w; for (let x = -r; x <= r; x++) sum += plane[o + clamp(x, 0, w - 1)]; for (let x = 0; x < w; x++) { tmp[o + x] = sum * k; sum += plane[o + Math.min(w - 1, x + r + 1)] - plane[o + Math.max(0, x - r)]; } }
      for (let x = 0; x < w; x++) { let sum = 0; for (let y = -r; y <= r; y++) sum += tmp[clamp(y, 0, h - 1) * w + x]; for (let y = 0; y < h; y++) { plane[y * w + x] = sum * k; sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
    }
    return plane;
  }
  // ¿Qué tan suave es la referencia? En sus bordes más marcados se compara el salto de luz visto de
  // cerca (dos cajas de 2 puntos, una a cada lado) con el salto visto de lejos (cajas de 8): en un
  // borde nítido son iguales; en uno desenfocado, de cerca apenas hay salto. El cociente dice el
  // ancho del desenfoque (y el grano no lo engaña: se promedia dentro de las cajas). Devuelve la
  // desviación del desenfoque en fracción del ancho, o 0 si la imagen es nítida.
  const SOFT_F = u => 2 * (0.5 * (1 + erf(u / Math.SQRT2)) + (Math.exp(-u * u / 2) - 1) * 0.3989423 / u - 0.5);
  function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x < 0 ? -y : y; }
  function softOf(L, w, h) {
    if (w < 48 || h < 48) return 0;
    const W1 = w + 1, sat = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += L[y * w + x]; sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row; } }
    const box = (x0, y0, x1, y1) => (sat[y1 * W1 + x1] - sat[y0 * W1 + x1] - sat[y1 * W1 + x0] + sat[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
    // el salto entre dos cajas de lado s pegadas en (x, y), en horizontal (dir 0) o vertical (dir 1)
    const jump = (x, y, s, dir) => (dir ? box(x - (s >> 1), y, x + (s >> 1), y + s) - box(x - (s >> 1), y - s, x + (s >> 1), y) : box(x, y - (s >> 1), x + s, y + (s >> 1)) - box(x - s, y - (s >> 1), x, y + (s >> 1)));
    const far = [];
    for (let dir = 0; dir < 2; dir++) for (let y = 12; y < h - 12; y += 2) for (let x = 12; x < w - 12; x += 2) { const d = Math.abs(jump(x, y, 8, dir)); if (d >= 0.08) far.push([d, x, y, dir]); }
    if (far.length < 40) return 0;
    far.sort((p, q) => q[0] - p[0]);
    // (el grano también da saltos de cerca: se mide en las zonas lisas —donde de lejos no hay salto— y se descuenta)
    const calm = [];
    for (let y = 12; y < h - 12; y += 3) for (let x = 12; x < w - 12; x += 3) if (Math.abs(jump(x, y, 8, 0)) < 0.02 && Math.abs(jump(x, y, 8, 1)) < 0.02) calm.push(Math.abs(jump(x, y, 2, 0)));
    calm.sort((p, q) => p - q);
    const noise = calm.length > 20 ? calm[calm.length >> 1] / 0.6745 : 0;
    const top = far.slice(0, Math.max(40, Math.round(far.length * 0.25))), ratios = [];
    for (const [, x, y, dir] of top) {
      let near = 0, wide = 0;
      for (let k = -3; k <= 3; k++) { const xx = dir ? x : x + k, yy = dir ? y + k : y; near = Math.max(near, Math.abs(jump(xx, yy, 2, dir))); wide = Math.max(wide, Math.abs(jump(xx, yy, 8, dir))); }
      ratios.push(Math.sqrt(Math.max(0, near * near - 4 * noise * noise)) / wide);
    }
    ratios.sort((p, q) => p - q);
    // (los bordes más nítidos de la imagen son los que dicen su nitidez: la parte alta del cociente)
    const r = ratios[Math.floor(ratios.length * (noise > 0.01 ? 0.6 : 0.75))];
    let sigma = 0.3;
    while (sigma < 8 && SOFT_F(2 / sigma) / SOFT_F(8 / sigma) > r) sigma *= 1.06;
    return sigma >= SOFT_MIN ? +(Math.min(sigma, 6) / w).toFixed(4) : 0;
  }
  // ¿Tiene resplandor? Sobre fondo oscuro, lo que brilla derrama luz a su alrededor. Se prueba el
  // modelo que luego pinta la cámara —imagen + cantidad × (lo que brilla, emborronado)— con varios
  // anchos: en los puntos oscuros que rodean a lo que brilla, la luz que hay dividida entre la que
  // el modelo pondría debe dar lo mismo cerca que lejos (esa es la cantidad). Una figura nítida sin
  // resplandor da cero (alrededor está negro); una mancha desenfocada da un cociente que cambia con
  // la distancia. Devuelve la cantidad, el ancho (fracción del ancho de la imagen) y la referencia
  // SIN su resplandor («bare»), que es de la que se miden los tonos y el color.
  const GLOW_FROM = 0.1, GLOW_SIZES = [0.012, 0.015, 0.019, 0.024, 0.03, 0.038, 0.048, 0.06], SOFT_MIN = 1.5;
  const glowSource = (R, G, B, n) => { const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]; for (let i = 0; i < n; i++) { const y = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i], t = clamp((y - GLOW_FROM) / GLOW_FROM, 0, 1), k = t * t * (3 - 2 * t); out[0][i] = R[i] * k; out[1][i] = G[i] * k; out[2][i] = B[i] * k; } return out; };
  function glowOf(data, w, h, softSigma) {
    const n = w * h, R = new Float32Array(n), Gc = new Float32Array(n), B = new Float32Array(n), Y = new Float32Array(n);
    for (let i = 0; i < n; i++) { R[i] = LIN[data[i * 4]]; Gc[i] = LIN[data[i * 4 + 1]]; B[i] = LIN[data[i * 4 + 2]]; Y[i] = 0.2126 * R[i] + 0.7152 * Gc[i] + 0.0722 * B[i]; }
    const sorted = Y.slice().sort(), top = sorted[Math.floor(0.995 * (n - 1))], ground = sorted[Math.floor(0.05 * (n - 1))];
    if (top < 0.2 || sorted[Math.floor(0.25 * (n - 1))] > 0.02) return null;        // sin nada que brille, o sin oscuro alrededor
    const luma = planes => { const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = 0.2126 * planes[0][i] + 0.7152 * planes[1][i] + 0.0722 * planes[2][i]; return out; };
    const measure = (source, size) => {
      const H = blurPlane(luma(source), w, h, size * w), ratios = [];
      for (let i = 0; i < n; i++) if (Y[i] < GLOW_FROM && H[i] > 0.02 * top) ratios.push((Y[i] - ground) / H[i]);
      if (ratios.length < n * 0.015) return null;
      ratios.sort((p, q) => p - q);
      const at = q => ratios[Math.floor(q * (ratios.length - 1))], amount = at(0.25);
      return { amount, size, spread: (at(0.45) - at(0.1)) / Math.max(amount, 1e-3) };
    };
    let source = glowSource(R, Gc, B, n), best = null;
    for (const size of GLOW_SIZES) {
      if (softSigma && size < softSigma * 2.2) continue;            // (un borde desenfocado no es resplandor)
      const m = measure(source, size);
      if (m && (!best || m.spread < best.spread)) best = m;
    }
    if (!best || best.amount < 0.08 || best.amount > 3 || best.spread > 0.6) return null;
    // Quitarlo: imagen − cantidad × halo. Lo que brilla se midió con el resplandor puesto, así que se
    // repite una vez con la imagen ya limpia.
    let halo = null;
    for (let pass = 0; pass < 2; pass++) {
      halo = source.map(plane => blurPlane(plane.slice(), w, h, best.size * w));
      if (pass === 0) {
        source = glowSource(R.map((v, i) => Math.max(0, v - best.amount * halo[0][i])), Gc.map((v, i) => Math.max(0, v - best.amount * halo[1][i])), B.map((v, i) => Math.max(0, v - best.amount * halo[2][i])), n);
        const again = measure(source, best.size);
        if (again && again.amount > 0) best.amount = again.amount;
      }
    }
    const enc = v => Math.round(255 * Math.pow(clamp(v, 0, 1), 1 / 2.2)), bare = new Uint8ClampedArray(data);
    for (let i = 0; i < n; i++) {
      // (donde casi toda la luz era resplandor, lo que queda al quitarlo es el error de la medida, no
      //  imagen: ese punto era fondo)
      const g = best.amount * (0.2126 * halo[0][i] + 0.7152 * halo[1][i] + 0.0722 * halo[2][i]), left = Y[i] - g, k = left < 0.3 * g ? ground / Math.max(Y[i] - g, 1e-6) : 1, cut = left < 0.3 * g && left <= 0 ? 0 : k;
      bare[i * 4] = enc((R[i] - best.amount * halo[0][i]) * cut); bare[i * 4 + 1] = enc((Gc[i] - best.amount * halo[1][i]) * cut); bare[i * 4 + 2] = enc((B[i] - best.amount * halo[2][i]) * cut);
    }
    return {
      amount: +best.amount.toFixed(3), size: best.size, spread: +best.spread.toFixed(2), bare,
      // (lo que el resplandor le suma, en luz lineal, a un punto cualquiera de la referencia: x, y de 0 a 1)
      at: (x, y) => { const i = clamp(Math.floor(y * h), 0, h - 1) * w + clamp(Math.floor(x * w), 0, w - 1); return [best.amount * halo[0][i], best.amount * halo[1][i], best.amount * halo[2][i]]; },
    };
  }
  const hex2 = v => (256 + Math.round(clamp(v + 0.5, 0, 1) * 255)).toString(16).slice(1);
  // mid: la referencia a media reducción (unos 128 puntos de lado), para los tonos de una imagen de
  // color continuo sin trama.
  function analyze(thumb, fine, sparse, soft, back, mid) {
    const n = thumb.width * thumb.height, lab = labImage(thumb.data, n);
    const sn2 = sparse ? sparse.n : n, slab = sparse ? labImage(sparse.data, sn2) : lab;
    const pal = palette(slab, sn2);
    const behind = back ? (data, i) => Math.abs(data[i] - back.rgb[0]) + Math.abs(data[i + 1] - back.rgb[1]) + Math.abs(data[i + 2] - back.rgb[2]) <= 36 : () => false;
    // (las muestras del fondo casan con su tinta sin error: el error que cuenta es el de la figura)
    if (back && back.samples && back.samples < sn2) pal.error *= sn2 / (sn2 - back.samples);
    // (y las partes de cada tinta vuelven a ser las de verdad: el fondo entró con menos muestras de las suyas)
    if (back && back.samples && pal.colors.length > 1) {
      const g = new Float32Array(3); toLab(back.rgb[0], back.rgb[1], back.rgb[2], g, 0);
      let at = 0, bd = 1e9;
      pal.colors.forEach((c, k) => { const d = Math.hypot(c[0] - g[0], c[1] - g[1], c[2] - g[2]); if (d < bd) { bd = d; at = k; } });
      const rest = 1 - pal.shares[at];
      if (bd < 0.12 && rest > 1e-6) pal.shares = pal.shares.map((w, k) => (k === at ? back.share : w * (1 - back.share) / rest));
    }
    // ¿Paleta cerrada? Pocas tintas y la imagen pegada a ellas. «Pegada» se mide contra lo que separa
    // a las tintas entre sí: una foto de poco contraste también se queda en tres o cuatro centros y con
    // poco error absoluto, pero sus centros están casi tan cerca unos de otros como los puntos de ellos.
    const K = pal.colors.length;
    let gap = 1e9;
    for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) gap = Math.min(gap, Math.hypot(pal.colors[i][0] - pal.colors[j][0], pal.colors[i][1] - pal.colors[j][1], pal.colors[i][2] - pal.colors[j][2]));
    const limited = K <= 6 && pal.error < 0.04 && pal.error < 0.2 * gap;

    // Tonos: los cuantiles de la luz de la referencia.
    const Ls = new Float32Array(n);
    for (let i = 0; i < n; i++) Ls[i] = lab[i * 3];
    const tones = from => {
      let tn = from ? from.n : sn2;
      const tlab = from ? labImage(from.data, tn) : slab;
      let sorted = new Float32Array(tn), fig = null;
      if (back && from) {
        const own = [], rest = [];
        for (let i = 0; i < tn; i++) (behind(from.data, i * 4) ? rest : own).push(tlab[i * 3]);
        const room = Math.min(rest.length, own.length);                     // el fondo: como mucho la mitad de los tonos
        if (own.length >= 16) {
          sorted = Float32Array.from(own.concat(rest.slice(0, room))); tn = sorted.length;
          // (y los tonos de la figura sola, para cuando la cámara sabe qué es figura: tecla FIGURA)
          const mine = Float32Array.from(own).sort();
          fig = []; for (let i = 0; i <= 32; i++) fig.push(+mine[Math.min(mine.length - 1, Math.round(i / 32 * (mine.length - 1)))].toFixed(4));
        }
        else for (let i = 0; i < tn; i++) sorted[i] = tlab[i * 3];
      } else for (let i = 0; i < tn; i++) sorted[i] = tlab[i * 3];
      sorted.sort();
      const cdf = [];
      for (let i = 0; i <= 32; i++) cdf.push(+sorted[Math.min(tn - 1, Math.round(i / 32 * (tn - 1)))].toFixed(4));
      return { tn, sorted, cdf, fig };
    };
    const { tn, sorted } = tones(soft);
    let { cdf, fig: cdfFig } = tones(soft);

    // Color según la luz: el color medio de cada nivel, y cuánto explica la luz el color.
    const bins = 32, sa = new Float32Array(bins), sb = new Float32Array(bins), sn = new Float32Array(bins);     // (los looks de antes traen 16 niveles)
    let ma = 0, mb = 0, nf = 0;
    const skip = back ? new Uint8Array(n) : null;                  // los puntos del fondo
    if (skip) { let rest = 0; for (let i = 0; i < n; i++) if (behind(thumb.data, i * 4)) { skip[i] = 1; rest++; } if (n - rest < 64) skip.fill(0); }
    for (let i = 0; i < n; i++) { const k = Math.min(bins - 1, (lab[i * 3] * bins) | 0); sa[k] += lab[i * 3 + 1]; sb[k] += lab[i * 3 + 2]; sn[k]++; if (skip && skip[i]) continue; ma += lab[i * 3 + 1]; mb += lab[i * 3 + 2]; nf++; }
    ma /= nf; mb /= nf;
    const ramp = [];
    for (let k = 0; k < bins; k++) ramp.push(sn[k] > nf * 0.002 ? [sa[k] / sn[k], sb[k] / sn[k]] : null);
    for (let k = 0; k < bins; k++) if (!ramp[k]) {                // niveles sin imagen: se rellenan con los vecinos
      let lo = k - 1, hi = k + 1;
      while (lo >= 0 && !ramp[lo]) lo--;
      while (hi < bins && !ramp[hi]) hi++;
      const A = lo >= 0 ? ramp[lo] : (hi < bins ? ramp[hi] : [ma, mb]), B = hi < bins && ramp[hi] ? ramp[hi] : A, t = lo >= 0 && hi < bins ? (k - lo) / (hi - lo) : 0;
      ramp[k] = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    }
    let total = 0, resid = 0;
    for (let i = 0; i < n; i++) {
      if (skip && skip[i]) continue;
      const k = Math.min(bins - 1, (lab[i * 3] * bins) | 0), da = lab[i * 3 + 1] - ma, db = lab[i * 3 + 2] - mb, ra = lab[i * 3 + 1] - ramp[k][0], rb = lab[i * 3 + 2] - ramp[k][1];
      total += da * da + db * db; resid += ra * ra + rb * rb;
    }
    const chroma = Math.sqrt(total / nf);                          // cuánto color tiene la figura (0 = gris)
    const explained = total > 1e-6 ? clamp(1 - resid / total, 0, 1) : 1;
    // El reparto de color de la referencia, en muestras: OT_M puntos (luz, a, b) tomados de toda ella.
    // Con el color medio de cada nivel de luz, una referencia con dos colores a la misma luz (un neón
    // cian y rosa, un mapa de calor) salía apagada —cian + rosa = lavanda—. Con las muestras, la cámara
    // lleva el reparto de color de la escena al de la referencia entero (ver «transport»). El fondo
    // liso entra como en los tonos: sin pasar de la mitad.
    let ot, otOwn = 0;
    if (!limited) {
      const own = [], rest = [];
      for (let i = 0; i < n; i++) (skip && skip[i] ? rest : own).push(i);
      const take = Math.min(rest.length, own.length), list = own.concat(rest.filter((_, j) => Math.floor(j * take / Math.max(1, rest.length)) !== Math.floor((j - 1) * take / Math.max(1, rest.length))));
      ot = '';
      for (let k = 0; k < OT_M; k++) { const at = Math.min(list.length - 1, Math.floor((k + 0.5) * list.length / OT_M)), i = list[at]; if (at < own.length) otOwn++; ot += hex2(lab[i * 3] - 0.5) + hex2(lab[i * 3 + 1]) + hex2(lab[i * 3 + 2]); }
    }
    // (con varias tintas de distinto color, el color de la escena sigue contando algo: tope 0,8)
    // (una figura luminosa sobre fondo liso es un mapa de degradado: del fondo al color y al blanco
    //  según la luz; ahí manda la luz aunque dos colores compartan nivel)
    const rampMix = chroma < 0.012 ? 1 : Math.max(back && !limited ? 0.75 : 0, Math.min(clamp((explained - 0.35) / 0.5, 0, 1), limited && K > 2 ? 0.8 : 1));

    // Lo fino: rejilla de píxel y trama, sobre el recorte sin reducir.
    const N = fine.n, lum = fine.lum, perWidth = fine.span / N;    // cuántas veces cabe el recorte a lo ancho
    let grid = pixelGrid(lum, N);
    // (una referencia pequeña se amplió sin suavizar para medirla: esos «bloques» son del ampliado, no suyos)
    if (grid && fine.zoom > 1 && grid.period <= fine.zoom * 1.25) grid = null;
    let pixel = 0, period = 0;
    if (grid) { period = grid.period; pixel = clamp(Math.round(fine.span / period), 8, 320); }

    const pow = spectrum(lum, N);
    let ac = 0;
    for (let i = 1; i < N * N; i++) ac += pow[i];
    const P = (u, v) => pow[((v + N) % N) * N + ((u + N) % N)];
    const screen = { type: 'none', freq: 0, angle: 0, strength: 0 };
    if (!pixel && ac > 1e-6) {
      let top = 0, tu = 0, tv = 0;
      for (let v = -N / 2; v < N / 2; v++) for (let u = 0; u < N / 2; u++) {      // medio plano: el espectro es simétrico
        const r = Math.hypot(u, v);
        // (de 12 para arriba: una trama repite cada 21 puntos o menos. Más abajo lo que se repite son
        //  COSAS de la imagen —las teclas de un teclado, unas baldosas, una persiana—, no una trama: con
        //  7, apuntar a un teclado daba «trama de puntos» y le ponía un velo de cuadros a la cámara)
        if (r < 12 || r > N * 0.42) continue;
        const p = P(u, v);
        if (p > top) { top = p; tu = u; tv = v; }
      }
      // ¿Sobresale ese pico de lo que hay a su misma distancia del centro? Se compara con la MEDIANA
      // del anillo: una media se la comen el propio pico, su pareja en cruz y las otras tramas de
      // una impresión a varias tintas, y entonces una trama clarísima parecía no sobresalir.
      const r0 = Math.hypot(tu, tv), ring = [];
      let lobe = 0;
      for (let v = -N / 2; v < N / 2; v++) for (let u = -N / 2; u < N / 2; u++) {
        const r = Math.hypot(u, v);
        if (Math.abs(r - r0) < 3) ring.push(P(u, v));
        if (Math.hypot(u - tu, v - tv) <= 3 || Math.hypot(u + tu, v + tv) <= 3) lobe += P(u, v);   // radio 3: una foto en perspectiva ensancha el pico
      }
      ring.sort((a, b) => a - b);
      const prominence = top / Math.max(1e-9, ring[ring.length >> 1]), share = lobe / ac;
      // ¿Y es la frecuencia BASE, o un armónico de algo más grande? Una fila de teclas (o de ventanas,
      // o de baldosas) tiene bordes duros: repite cada mucho, pero deja picos al doble y al triple de
      // su frecuencia, que caen donde caería una trama. Una trama de verdad no tiene nada a la mitad
      // ni a un tercio de su pico.
      let harmonic = false;
      for (const k of [2, 3]) {
        const su = tu / k, sv = tv / k, sr = Math.hypot(su, sv), around = [];
        if (sr < 3) continue;
        let sub = 0;
        for (let v = -N / 2; v < N / 2; v++) for (let u = -N / 2; u < N / 2; u++) {
          if (Math.abs(Math.hypot(u, v) - sr) < 2) around.push(P(u, v));
          if (Math.hypot(u - su, v - sv) <= 1.6) sub = Math.max(sub, P(u, v));
        }
        around.sort((a, b) => a - b);
        if (sub > 0.35 * top && sub > 15 * around[around.length >> 1]) harmonic = true;
      }
      if (prominence > 45 && share > 0.008 && !harmonic) {
        // ¿Hay otro pico en cruz? Entonces son puntos. Se busca con holgura (±12°, ±15 % de radio):
        // en una foto con algo de perspectiva la cruz no cae a 90° exactos.
        const a0 = Math.atan2(tv, tu) + Math.PI / 2;
        let cross = 0;
        for (let v = -N / 2; v < N / 2; v++) for (let u = -N / 2; u < N / 2; u++) {
          const r = Math.hypot(u, v);
          if (r < r0 * 0.85 || r > r0 * 1.15) continue;
          let da = Math.abs(Math.atan2(v, u) - a0) % Math.PI;
          if (da > Math.PI / 2) da = Math.PI - da;
          if (da < 0.21) { const p = P(u, v); if (p > cross) cross = p; }
        }
        // El pico afinado por debajo de la celda del espectro (parábola sobre el logaritmo de sus vecinos).
        const fineAt = (m, c, pl) => { const a = Math.log(m + 1e-12), b = Math.log(c + 1e-12), d = Math.log(pl + 1e-12), den = a - 2 * b + d; return Math.abs(den) > 1e-9 ? clamp(0.5 * (a - d) / den, -0.5, 0.5) : 0; };
        const fu = tu + fineAt(P(tu - 1, tv), top, P(tu + 1, tv)), fv = tv + fineAt(P(tu, tv - 1), top, P(tu, tv + 1));
        screen.type = cross > top * 0.15 ? 'dot' : 'line';
        screen.freq = +(Math.hypot(fu, fv) * perWidth).toFixed(2);
        screen.angle = +Math.atan2(fv, fu).toFixed(4);
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

    // Grano: lo que queda al quitarle a cada punto la media de sus vecinos, solo en zonas lisas (las
    // zonas se eligen sobre la imagen suavizada: si no, un grano fuerte se excluiría a sí mismo).
    // Se mide a dos escalas, porque hay que separar el grano de la REFERENCIA del ruido de la cámara
    // que la fotografía: el ruido de sensor no tiene tamaño (cada punto va por su cuenta: al promediar
    // de 2 × 2 cae a la mitad), y el grano de película sí (va en grumos: al promediar apenas baja).
    const grain = { amount: 0, cells: 0 };
    if (!pixel && screen.type === 'none') {
      const residual = (img, n) => {
        const soft = new Float32Array(n * n);
        for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) { const i = y * n + x; soft[i] = (img[i] * 4 + (img[i - 1] + img[i + 1] + img[i - n] + img[i + n]) * 2 + img[i - n - 1] + img[i - n + 1] + img[i + n - 1] + img[i + n + 1]) / 16; }
        let sum = 0, sum2 = 0, cnt = 0, lag = 0, prev = 0, had = false;
        const all = new Float32Array(n * n);
        for (let y = 3; y < n - 3; y++) { had = false; for (let x = 3; x < n - 3; x++) {
          const i = y * n + x;
          if (Math.abs(soft[i + 2] - soft[i - 2]) + Math.abs(soft[i + 2 * n] - soft[i - 2 * n]) > 0.05) { had = false; continue; }
          const r = img[i] - (img[i - 1] + img[i + 1] + img[i - n] + img[i + n] + img[i - n - 1] + img[i - n + 1] + img[i + n - 1] + img[i + n + 1]) / 8;
          sum += r; sum2 += r * r; all[cnt++] = Math.abs(r);
          if (had) lag += r * prev;
          prev = r; had = true;
        } }
        if (cnt < n) return null;
        // La fuerza sale de la MEDIANA del residuo, no de su media: el grano está en todas partes; el
        // borde de una línea de tinta deja residuos enormes en unos pocos puntos, y con la media un
        // cartel de tinta plana «tenía grano».
        const varr = Math.max(0, sum2 / cnt - (sum / cnt) ** 2), sorted = all.subarray(0, cnt).sort();
        return { sd: 1.4826 * sorted[cnt >> 1], rho: varr > 1e-9 ? lag / cnt / varr : 0 };
      };
      // Cuatro escalas (1, 2, 4 y 8 puntos): el grano se ve más fuerte en la escala de su tamaño.
      const levels = [{ img: lum, n: N }];
      for (let k = 1; k < 4; k++) {
        const up = levels[k - 1], m = up.n >> 1, img = new Float32Array(m * m);
        for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) img[y * m + x] = (up.img[2 * y * up.n + 2 * x] + up.img[2 * y * up.n + 2 * x + 1] + up.img[(2 * y + 1) * up.n + 2 * x] + up.img[(2 * y + 1) * up.n + 2 * x + 1]) / 4;
        levels.push({ img, n: m });
      }
      const res = levels.map(l => residual(l.img, l.n)), sd = res.map(r => (r ? r.sd : 0)), one = res[0], two = res[1];
      let top = 0;
      for (let k = 1; k < 4; k++) if (sd[k] > sd[top]) top = k;
      if (analyze.debug) analyze.debug.grain = { sd: sd.map(v => +v.toFixed(4)), rho: res.map(r => (r ? +r.rho.toFixed(2) : null)) };
      if (one && two && sd[top] > 0.008) {
        // (el residuo contra los vecinos sale anticorrelado de por sí: se corrige antes de juzgar)
        const ratio = two.sd / Math.max(1e-6, one.sd), rho = clamp((one.rho + 0.125) / 1.125, 0, 0.95);
        const sensor = top === 0 && ratio < 0.62 && rho < 0.12 && one.sd < 0.034;
        if (sensor) grain.sensor = +one.sd.toFixed(3);       // ruido de la cámara que la retrató: no es del look
        if (!sensor) {
          // El tamaño: la escala donde más se ve, afinada con sus dos vecinas (parábola sobre el logaritmo).
          const y0 = Math.log(Math.max(1e-5, sd[Math.max(0, top - 1)])), y1 = Math.log(sd[top]), y2 = Math.log(Math.max(1e-5, sd[Math.min(3, top + 1)]));
          const bend = y0 - 2 * y1 + y2, shift = top > 0 && top < 3 && bend < -1e-6 ? clamp(0.5 * (y0 - y2) / bend, -0.5, 0.5) : top === 0 ? clamp((y2 - y1 + 0.69) * 0.7, 0, 0.5) : 0;
          const size = Math.pow(2, top + shift);
          // La fuerza: la de todas las escalas juntas (un grano grueso reparte su energía entre varias;
          // con solo la mayor se quedaba en dos tercios). 1,328 = 1 + ¼ + 1/16 + 1/64: lo que suma el ruido blanco.
          const all = Math.sqrt((sd[0] * sd[0] + sd[1] * sd[1] + sd[2] * sd[2] + sd[3] * sd[3]) / 1.328);
          grain.amount = +clamp(all * 3.2, 0, 0.5).toFixed(3);
          grain.cells = Math.round(fine.span / size);
          grain.ratio = +ratio.toFixed(2); grain.rho = +rho.toFixed(2);
        }
      }
    }
    if (limited && screen.type === 'none' && grain.amount > 0.05) { screen.type = 'noise'; screen.strength = +clamp(grain.amount * 4, 0.3, 1).toFixed(3); screen.freq = grain.cells; }

    // Líneas de tinta: puntos bastante más oscuros que su entorno, sobre la referencia reducida. Se mira
    // a dos distancias (una línea desenfocada es más ancha) y el umbral sigue al contraste de la imagen.
    const w = thumb.width, h = thumb.height;
    const spread = sorted[Math.round((tn - 1) * 0.9)] - sorted[Math.round((tn - 1) * 0.1)], dip = Math.max(0.11, 0.22 * spread);
    let ink = 0, inkN = 0;
    for (let y = 4; y < h - 4; y += 2) for (let x = 4; x < w - 4; x += 2) {
      const i = y * w + x, near = (Ls[i - 2] + Ls[i + 2] + Ls[i - 2 * w] + Ls[i + 2 * w]) / 4, far = (Ls[i - 4] + Ls[i + 4] + Ls[i - 4 * w] + Ls[i + 4 * w]) / 4, around = Math.max(near, far);
      inkN++;
      if (Ls[i] < around - dip && around > 0.35) ink++;
    }
    const inkShare = ink / Math.max(1, inkN);
    const edge = !pixel && (screen.type === 'none' || screen.type === 'noise') && inkShare > 0.012 ? +clamp(inkShare * 9, 0.25, 1).toFixed(3) : 0;

    // Viñeta: esquinas más oscuras que el centro.
    const box = (x0, y0, x1, y1) => { let s = 0, c = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += Ls[y * w + x]; c++; } return s / Math.max(1, c); };
    const cw = Math.max(2, (w * 0.14) | 0), ch = Math.max(2, (h * 0.14) | 0);
    const four = [box(0, 0, cw, ch), box(w - cw, 0, w, ch), box(0, h - ch, cw, h), box(w - cw, h - ch, w, h)];
    const corners = (four[0] + four[1] + four[2] + four[3]) / 4, centre = box((w * 0.3) | 0, (h * 0.3) | 0, (w * 0.7) | 0, (h * 0.7) | 0);
    // Una viñeta oscurece las cuatro esquinas por igual; si unas sí y otras no, es el contenido de la imagen.
    const even = Math.max(...four) - Math.min(...four) < 0.4 * (centre - corners);
    const vignette = !limited && even && centre > 0.2 && (centre - corners) / centre > 0.16 ? +clamp((centre - corners) / centre * 0.9, 0, 0.6).toFixed(3) : 0;

    // Los tonos salen de la referencia muy reducida cuando lleva trama, píxel o tintas planas (ahí un
    // punto es tinta o papel, y el tono es su mezcla). En color continuo esa reducción se come lo fino:
    // las líneas claras de un neón, los brillos, el negro pegado a una figura. Ahí se miden a media
    // reducción (lo justo para promediar el grano).
    if (mid && !limited && !pixel && screen.type === 'none') { const fine = tones(mid); cdf = fine.cdf; cdfFig = fine.fig; }
    const look = {
      v: 1, palette: pal.colors.map(c => c.map(v => +v.toFixed(4))), shares: pal.shares.map(v => +v.toFixed(3)), limited, error: +pal.error.toFixed(4),
      back: back ? +back.share.toFixed(3) : 0,                       // cuánto de la referencia es fondo liso (0 = no lo tiene)
      // (su color, solo si es un extremo —negro o blanco casi absolutos—: ahí el tramo del fondo se copia
      //  entero y sin tinte. Un fondo de color medio es una tinta más del cartel y se trata como las otras.)
      ground: back ? (() => { const g = new Float32Array(3); toLab(back.rgb[0], back.rgb[1], back.rgb[2], g, 0); return g[0] <= 0.15 || g[0] >= 0.92 ? [+g[0].toFixed(4), +g[1].toFixed(4), +g[2].toFixed(4)] : null; })() : null,
      cdf, ramp: ramp.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]), rampMix: +rampMix.toFixed(3), mean: [+ma.toFixed(4), +mb.toFixed(4)], chroma: +chroma.toFixed(4),
      ot, byLight: +explained.toFixed(3),
      // (para la tecla FIGURA: el color del fondo liso, los tonos de la figura sola y cuántas de las
      //  muestras —las primeras— son de la figura)
      backdrop: back ? (() => { const g = new Float32Array(3); toLab(back.rgb[0], back.rgb[1], back.rgb[2], g, 0); return [+g[0].toFixed(4), +g[1].toFixed(4), +g[2].toFixed(4)]; })() : null, cdfFig: back && cdfFig ? cdfFig : null, otOwn,
      pixel, screen, grain, edge, vignette, tone: 1, sat: 1, score: null,
    };
    look.name = nameOf(look);
    return look;
  }

  // ¿Duotono? La luz decide el color entero (un solo color por nivel). Los looks de antes solo traen la mezcla.
  const duo = look => (look.byLight != null ? clamp((look.byLight - 0.35) / 0.5, 0, 1) : look.rampMix) > 0.75;
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
    const kind = look.pixel ? 'PÍXEL' : look.screen.type === 'dot' ? 'TRAMA' : look.screen.type === 'line' ? 'LÍNEAS' : look.limited ? (look.palette.length <= 2 ? 'TINTA' : 'CARTEL') : duo(look) ? 'DUOTONO' : 'FOTO';
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
    if (look.figure && (look.ground || (look.limited && look.backdrop))) parts.push('figura recortada');
    if (look.soft) parts.push('suave');
    if (look.glow) parts.push('resplandor');
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
    uniform vec3 uPalRgb[8];       // las mismas tintas, ya en RGB de pantalla
    uniform vec3 uInk;
    uniform vec4 uDither;          // tipo (0 nada, 1 ordenado, 2 puntos, 3 líneas, 4 ruido), celdas a lo ancho, ángulo, fuerza
    uniform vec2 uGrain;           // cantidad, celdas a lo ancho
    uniform vec4 uChroma;          // color medio de la escena (a, b) y de la referencia (a, b)
    uniform vec4 uGround;          // el fondo liso de la referencia: (luz, a, b, ¿lo tiene?)
    uniform sampler2D uLut;        // cuánto se mueve el color (a, b) de cada punto: 16 rebanadas de luz, cada una de 16 × 16
    uniform sampler2D uMask;       // dónde hay una persona (0…1), sobre el mismo recorte que la fuente
    uniform vec4 uBack;            // tecla FIGURA: el color del fondo de la referencia (luz, a, b) y ¿va puesta?
    uniform vec2 uOt;              // ¿el look trae su reparto de color? (los de antes, no: van con el color medio por nivel); y cuánto cuenta el color de la escena
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
    // (mod 4 antes de elevar al cuadrado: con precisión media, 300² ya desborda y saldría negro)
    float bayer2(vec2 a) { a = mod(floor(a), 4.); return fract(a.x / 2. + a.y * a.y * .75); }
    float bayer4(vec2 a) { return bayer2(.5 * a) * .25 + bayer2(a); }
    vec3 source(vec2 q) { return texture2D(uSrc, uCrop.xy + vec2(uMirror > .5 ? 1. - q.x : q.x, q.y) * uCrop.zw).rgb; }
    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 uv = vUv, q = uv;
      float cells = uCells * uScale;
      vec2 grid = vec2(cells, max(1., floor(cells / aspect + .5)));
      if (cells > 0.) q = (floor(uv * grid) + .5) / grid;
      vec3 src = source(q), raw = src;
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
        vec2 b = vec2(.0034, .0034 * aspect) / uScale, a = vec2(.0056, .0056 * aspect) / uScale;   // en fracción del ancho: igual en la vista que en la foto
        src = (src * 2. + source(q + vec2(b.x, b.y)) + source(q + vec2(-b.x, b.y)) + source(q + vec2(b.x, -b.y)) + source(q + vec2(-b.x, -b.y))
          + source(q + vec2(a.x, 0.)) + source(q - vec2(a.x, 0.)) + source(q + vec2(0., a.y)) + source(q - vec2(0., a.y))) / 10.;
      }
      vec3 p = lab(src);
      // Tonos: la luz de la escena, llevada a la distribución de la referencia.
      p.x = texture2D(uTone, vec2(clamp(p.x, .002, .998), .5)).r;
      // Contorno, medido en la fuente.
      float e = 0., eg = 0.;
      if (uEdge > 0.) {
        // (el paso va en fracción del ancho: la línea pesa lo mismo en la vista que en la foto; y la
        //  diferencia se mide en luma con raíz, sin pasar cuatro veces por OKLab)
        vec2 st = cells > 0. ? 1. / grid : vec2(.0024, .0024 * aspect) / uScale;
        vec3 Y = vec3(.299, .587, .114);
        float lx = sqrt(dot(source(q + vec2(st.x, 0.)), Y)) - sqrt(dot(source(q - vec2(st.x, 0.)), Y)), ly = sqrt(dot(source(q + vec2(0., st.y)), Y)) - sqrt(dot(source(q - vec2(0., st.y)), Y));
        eg = smoothstep(.07, .2, length(vec2(lx, ly)));
        e = eg * uEdge;
      }
      // Color: el de la escena, desplazado al de la referencia; y cuanto más mande la luz en ella,
      // más sale del color que la referencia le pone a cada nivel.
      vec2 ab = (p.yz - uChroma.xy) * uSat + uChroma.zw;
      vec2 ramped = texture2D(uRamp, vec2(clamp(p.x, .03, .97), .5)).rg - .5;
      if (uOt.x > .5) {
        vec2 t = clamp(p.yz / ${OT_SPAN}, -1., 1.), w = clamp(.5 + .5 * sign(t) * sqrt(abs(t)), .03125, .96875);
        float z = clamp(p.x, 0., 1.) * 15., z0 = floor(z), z1 = min(15., z0 + 1.);
        vec2 moved = p.yz + mix(texture2D(uLut, vec2((z0 + w.x) / 16., w.y)).rg, texture2D(uLut, vec2((z1 + w.x) / 16., w.y)).rg, z - z0) - .5;
        p.yz = mix(ramped, uChroma.zw + (moved - uChroma.zw) * uSat, uOt.y);
      } else p.yz = mix(ab, ramped, uRampMix);
      // Con fondo liso: lo que cae en su tono toma su color (un negro absoluto no lleva el tinte de la figura).
      if (uGround.w > .5) p.yz = mix(uGround.yz, p.yz, smoothstep(.02, .2, abs(p.x - uGround.x)));
      // FIGURA: lo que no es persona es fondo, y toma el color del fondo de la referencia.
      if (uBack.w > .5) p = mix(uBack.xyz, p, smoothstep(.2, .8, texture2D(uMask, vec2(uMirror > .5 ? 1. - q.x : q.x, q.y)).r));
      // Viñeta y grano, antes de encajar en la paleta (así el grano también trama).
      vec2 c = uv - .5;
      p.x *= 1. - uVig * dot(c, c) * 2.2;
      float gcells = uGrain.y * uScale;
      if (uGrain.x > 0.) {
        // (grumos redondos, no cuadros: el valor de cada esquina de la celda, mezclado con suavidad; el
        //  1.5 devuelve la fuerza que la mezcla quita)
        vec2 gp = uv * vec2(gcells, gcells / aspect), gi = floor(gp), gf = gp - gi;
        gf = gf * gf * (3. - 2. * gf);
        float g = mix(mix(hash(gi + uSeed), hash(gi + vec2(1., 0.) + uSeed), gf.x), mix(hash(gi + vec2(0., 1.) + uSeed), hash(gi + vec2(1., 1.) + uSeed), gf.x), gf.y);
        p.x += (g - .5) * uGrain.x * 1.5;
      }
      // El umbral del tramado en este punto.
      float thr = .5, fr = uDither.y * uScale;
      vec2 w = uv * vec2(1., 1. / aspect);
      vec2 r = vec2(cos(uDither.z) * w.x + sin(uDither.z) * w.y, -sin(uDither.z) * w.x + cos(uDither.z) * w.y) * fr * 6.2831853;
      if (uDither.x > 3.5) thr = hash(floor(uv * vec2(fr, fr / aspect)) + uSeed * .37);
      // (los umbrales tienen que repartirse por igual entre 0 y 1: solo así un tono t deja tinta en la
      //  fracción t de la superficie. Un coseno no lo hace —pasa más tiempo cerca de sus extremos—: las
      //  líneas van con onda triangular y los puntos con la suma de cosenos pasada por su propio reparto)
      else if (uDither.x > 2.5) thr = abs(2. * fract(r.x / 6.2831853 + .137) - 1.);   // (el desfase evita que un tono caiga justo sobre un umbral)
      else if (uDither.x > 1.5) { float s = .5 * (cos(r.x) + cos(r.y)), s2 = s * s; thr = .5 + .5 * s * (1.5288 + s2 * (-1.0589 + .5301 * s2)); }
      else if (uDither.x > .5) thr = bayer4(cells > 0. ? floor(uv * grid) : floor(uv * vec2(fr, fr / aspect))) + .03125;
      vec3 col;
      if (uLimited > .5) {
        // Paleta cerrada: las tintas más cercanas (en OKLab, que es como se parecen los colores), y el
        // tramado decide entre ellas. CUÁNTA superficie ocupa cada una se calcula en RGB de pantalla:
        // así el promedio de la trama es el tono pedido, igual que en la referencia (en OKLab, que es
        // curvo, las rayas y los puntos salían más delgados que los de la imagen copiada).
        float d1 = 100., d2 = 100., d3 = 100.;                       // (100 y no 1e9: cabe en precisión media)
        vec3 k1 = uPalRgb[0], k2 = uPalRgb[0], k3 = uPalRgb[0];
        for (int i = 0; i < 8; i++) {
          if (float(i) >= uPalN) break;
          vec3 dd = p - uPal[i];
          float d = dot(dd, dd);
          if (d < d1) { d3 = d2; k3 = k2; d2 = d1; k2 = k1; d1 = d; k1 = uPalRgb[i]; }
          else if (d < d2) { d3 = d2; k3 = k2; d2 = d; k2 = uPalRgb[i]; }
          else if (d < d3) { d3 = d; k3 = uPalRgb[i]; }
        }
        vec3 e1 = k2 - k1, e2 = k3 - k1, rr = rgb(p) - k1;
        float g11 = dot(e1, e1), g12 = dot(e1, e2), g22 = dot(e2, e2), det = g11 * g22 - g12 * g12;
        if (uPalN > 2.5 && det > 1e-5) {
          // Con tres tintas o más, un color que cae ENTRE tres (una piel entre rojo, amarillo y azul) se
          // reparte entre las tres según su posición en ese triángulo; con solo las dos más cercanas se
          // perdía la tercera y el tono se torcía.
          float r1 = dot(rr, e1), r2 = dot(rr, e2);
          float w2 = clamp((g22 * r1 - g12 * r2) / det, 0., 1.), w3 = clamp((g11 * r2 - g12 * r1) / det, 0., 1.);
          float w1 = max(0., 1. - w2 - w3), s = max(w1 + w2 + w3, 1e-5);
          w1 /= s; w2 /= s;
          float t1 = mix(step(.5, w1), w1, uDither.w), t2 = mix(step(.5, w1 + w2), w1 + w2, uDither.w);
          col = thr < t1 ? k1 : (thr < t2 ? k2 : k3);
        } else {
          float t = clamp(dot(rr, e1) / max(g11, 1e-5), 0., 1.);
          col = t > mix(.5, thr, uDither.w) ? k2 : k1;
        }
        // (con tinta plana la línea está o no está: «uEdge» dice a partir de qué salto de luz se pinta
        //  —con poco, solo los bordes más marcados—; antes se comparaba fuerza × salto con ½, y una
        //  referencia con líneas medidas por debajo de 0,5 no pintaba ninguna)
        col = mix(col, uPalRgb[0], uEdge > 0. ? step(mix(.7, .12, uEdge), eg) : 0.);
      } else {
        // Color continuo: la trama, si la hay, modula la luz.
        p.x += (thr - .5) * uDither.w * .34 * step(.5, uDither.x);
        col = rgb(mix(p, uInk, e));
      }
      if (uReveal < 1.) {                                          // el revelado: la cámara de antes se va por la derecha
        float edge = uReveal * 1.08 - .04;
        col = mix(col, raw, step(edge, uv.x));
        col += vec3(.75, 1., .85) * smoothstep(.012, 0., abs(uv.x - edge));
      }
      gl_FragColor = vec4(col, 1.);
    }`;

  // Las pasadas de la luz (suavidad antes de pintar el look, resplandor después): copiar reduciendo,
  // quedarse con lo que brilla, desenfocar a lo largo de un eje y sumar. Todo en luz lineal.
  const VERT2 = 'attribute vec2 aPos; varying vec2 vT; void main() { vT = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }';
  const FRAG2 = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec2 vT;
    uniform sampler2D uA, uB;
    uniform vec4 uBox;             // qué parte de la entrada se copia: origen y tamaño
    uniform vec2 uStep;            // al copiar, lo que mide un punto de la salida en la entrada; al desenfocar, el paso
    uniform float uMode, uGain, uFrom;
    uniform float uK[5];           // los pesos del desenfoque (centro y cuatro a cada lado)
    vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
    vec3 enc(vec3 c) { return pow(clamp(c, 0., 1.), vec3(1. / 2.2)); }
    void main() {
      vec3 s = vec3(0.);
      if (uMode > 2.5) { gl_FragColor = vec4(enc(lin(texture2D(uA, vT).rgb) + uGain * lin(texture2D(uB, vT).rgb)), 1.); return; }
      if (uMode > .5 && uMode < 1.5) {
        s = lin(texture2D(uA, vT).rgb) * uK[0];
        for (int i = 1; i < 5; i++) s += (lin(texture2D(uA, vT + uStep * float(i)).rgb) + lin(texture2D(uA, vT - uStep * float(i)).rgb)) * uK[i];
      } else {
        vec2 q = uBox.xy + vT * uBox.zw;
        for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
          vec3 c = lin(texture2D(uA, q + (vec2(float(i), float(j)) - 1.5) * .25 * uStep).rgb);
          if (uMode > 1.5) c *= smoothstep(uFrom, 2. * uFrom, dot(c, vec3(.2126, .7152, .0722)));
          s += c;
        }
        s /= 16.;
      }
      gl_FragColor = vec4(enc(s), 1.);
    }`;
  const G = { canvas: null, gl: null, u: null, src: null, tone: null, ramp: null, failed: false, lost: 0 };
  function ensureGl() {
    if (G.gl) return true;
    if (G.failed) return false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };   // (lo pintado se lee en el mismo turno: no hace falta conservarlo)
      const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('CLON: sin WebGL');
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); G.lost++; G.gl = null; G.canvas = null; G.look = null; });
      const shader = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('CLON: ' + gl.getShaderInfoLog(s)); return s; };
      const program = (vert, frag) => {
        const pr = gl.createProgram();
        gl.attachShader(pr, shader(gl.VERTEX_SHADER, vert)); gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, frag));
        gl.bindAttribLocation(pr, 0, 'aPos');
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('CLON: ' + gl.getProgramInfoLog(pr));
        return pr;
      };
      const prog = program(VERT, FRAG), post = program(VERT2, FRAG2), v = {};
      gl.useProgram(post);
      for (const name of ['uA', 'uB', 'uBox', 'uStep', 'uMode', 'uGain', 'uFrom', 'uK']) v[name] = gl.getUniformLocation(post, name);
      gl.uniform1i(v.uA, 4); gl.uniform1i(v.uB, 5);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const tex = (unit, filter) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
      G.src = tex(0, gl.LINEAR); G.tone = tex(1, gl.LINEAR); G.ramp = tex(2, gl.LINEAR); G.lut = tex(3, gl.LINEAR); G.table = null; G.mask = tex(7, gl.LINEAR); G.maskSeq = -1;
      const u = {};
      for (const name of ['uSrc', 'uTone', 'uRamp', 'uCrop', 'uRes', 'uMirror', 'uCells', 'uScale', 'uSeed', 'uReveal', 'uAim', 'uLimited', 'uEdge', 'uVig', 'uSat', 'uRampMix', 'uGround', 'uLut', 'uOt', 'uMask', 'uBack', 'uPalN', 'uFlat', 'uPal', 'uPalRgb', 'uInk', 'uDither', 'uGrain', 'uChroma']) u[name] = gl.getUniformLocation(prog, name);
      gl.uniform1i(u.uSrc, 0); gl.uniform1i(u.uTone, 1); gl.uniform1i(u.uRamp, 2); gl.uniform1i(u.uLut, 3); gl.uniform1i(u.uMask, 7);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      G.canvas = canvas; G.gl = gl; G.u = u; G.look = null; G.sceneAt = -1; G.prog = prog; G.post = post; G.v = v; G.fb = {};
      return true;
    } catch (error) { G.failed = true; G.gl = null; G.canvas = null; console.warn(String(error && error.message || error)); return false; }
  }
  function release() {
    if (G.gl) { const ext = G.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
    G.gl = null; G.canvas = null; G.look = null;
  }

  // La curva de tonos: a cada nivel de luz de la escena, el de la referencia que ocupa su mismo puesto.
  const TYPES = { none: 0, bayer: 1, dot: 2, line: 3, noise: 4 };
  function toneCurve(look, sceneHist, amount, out) {
    const bins = sceneHist.length, cum = new Float32Array(bins + 1);
    // El histograma de la escena sale de pocos puntos: se suaviza un paso antes de acumularlo.
    for (let k = 0; k < bins; k++) cum[k + 1] = cum[k] + 0.25 * sceneHist[Math.max(0, k - 1)] + 0.5 * sceneHist[k] + 0.25 * sceneHist[Math.min(bins - 1, k + 1)];
    const total = cum[bins], cdf = look.cdf;
    const at = q => { const pos = clamp(q, 0, 1) * 32, lo = Math.min(31, pos | 0); return cdf[lo] + (cdf[lo + 1] - cdf[lo]) * (pos - lo); };
    // Una referencia casi toda de un tono (un cartel blanco con poca tinta) no se copia nivel a nivel:
    // lavaría la escena entera. Se copian solo sus extremos, y la escena conserva su propio reparto.
    const p05 = at(0.05), p50 = at(0.5), p95 = at(0.95), extreme = p95 - p50 < 0.06 || p50 - p05 < 0.06, lo02 = at(0.02), hi98 = at(0.98);
    const m = new Float32Array(256), flatOk = new Uint8Array(256), ground = look.ground && look.back ? look.ground[0] : null;
    // (en la prueba de parecido la «escena» es la propia referencia sin estilo: se copia nivel a nivel, sin topes)
    if (look.exact) {
      for (let i = 0; i < 256; i++) { const pos = i / 255 * bins, k = Math.min(bins - 1, pos | 0); out[i] = Math.round(255 * clamp(total > 0 ? at((cum[k] + (cum[k + 1] - cum[k]) * (pos - k)) / total) : i / 255, 0, 1)); }
      return out;
    }
    let first = 0, last = 255;
    for (let i = 0; i < 256; i++) {
      // el puesto de este nivel en la escena: 0 para el negro, 1 para el blanco (sin levantar el negro)
      const pos = i / 255 * bins, k = Math.min(bins - 1, pos | 0);
      const rank = total > 0 ? (cum[k] + (cum[k + 1] - cum[k]) * (pos - k)) / total : i / 255;
      const matched = extreme ? lo02 + (hi98 - lo02) * Math.pow(rank, 0.9) : at(rank);
      // (el tramo que en la referencia es fondo —negro o blanco absoluto— va entero a ese tono: si se
      //  quedara a medias, el negro salía gris azulado)
      // (o más allá: con fondo negro, todo lo que caiga por debajo de él también es fondo)
      const onGround = ground != null && (Math.abs(matched - ground) < 0.03 || (ground < 0.5 ? matched < ground : matched > ground));
      m[i] = i / 255 + (matched - i / 255) * (onGround ? 1 : amount);
      flatOk[i] = onGround ? 1 : 0;
      if (rank < 0.002) first = i; if (rank < 0.998) last = i;
    }
    // Tope de pendiente: ningún tramo de la curva se estira más de 2,4× ni se aplasta por debajo de
    // 0,35× (sin él, una escena con un pico en su histograma daba saltos de 20× y la imagen parpadeaba).
    // El suelo solo cuenta entre el tono más oscuro y el más claro de la escena: fuera no hay nada que
    // aplastar, y darle pendiente a esos tramos se la quitaba a los que sí tienen imagen.
    const span = m[255] - m[0], mean = span / 255, min = Math.min(0.35 / 255, mean * 0.6), max = Math.max(2.4 / 255, mean * 1.4), d = new Float32Array(255);
    // El tramo del fondo no entra en el reparto: es plano y se queda plano. (Antes, cuando el tope
    // dejaba la curva corta, lo que faltaba se repartía entre todos los tramos, el del fondo incluido,
    // y un negro absoluto salía gris oscuro.) Si con el tope no se llega arriba, con fondo se afloja el
    // tope: ahí importa más que el negro sea negro y la figura llegue a su luz.
    const onRun = i => flatOk[i] && flatOk[i + 1], floor = i => (i >= first && i <= last && !onRun(i) ? min : 0);
    let cap = max;
    for (let widen = 0; widen < 5; widen++) {
      for (let i = 0; i < 255; i++) d[i] = onRun(i) ? 0 : clamp(m[i + 1] - m[i], floor(i), cap);
      let sum = 0;
      for (let pass = 0; pass < 4; pass++) {
        let room = 0;
        sum = 0;
        for (let i = 0; i < 255; i++) sum += d[i];
        const need = span - sum;
        if (Math.abs(need) < 1e-5) break;
        for (let i = 0; i < 255; i++) room += onRun(i) ? 0 : need > 0 ? cap - d[i] : d[i] - floor(i);
        if (room < 1e-7) break;
        const k = Math.min(1, Math.abs(need) / room);
        for (let i = 0; i < 255; i++) if (!onRun(i)) d[i] += need > 0 ? (cap - d[i]) * k : -(d[i] - floor(i)) * k;
      }
      sum = 0;
      for (let i = 0; i < 255; i++) sum += d[i];
      if (ground == null || span - sum < 0.01) break;
      cap *= 1.6;
    }
    for (let i = 0, v = m[0]; i < 256; i++) {
      out[i] = Math.round(255 * clamp(v, 0, 1));
      if (i < 255) v += d[i];
    }
    return out;
  }
  function loadLook(look) {
    const gl = G.gl, u = G.u, K = Math.min(8, look.palette.length);
    const pal = new Float32Array(24);
    for (let k = 0; k < K; k++) pal.set(look.palette[k], k * 3);
    gl.uniform3fv(u.uPal, pal);
    const palRgb = new Float32Array(24);
    for (let k = 0; k < K; k++) { const c = fromLab(look.palette[k][0], look.palette[k][1], look.palette[k][2]); palRgb[k * 3] = c[0] / 255; palRgb[k * 3 + 1] = c[1] / 255; palRgb[k * 3 + 2] = c[2] / 255; }
    gl.uniform3fv(u.uPalRgb, palRgb);
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
    if (look.ground && look.back) gl.uniform4f(u.uGround, look.ground[0], look.ground[1], look.ground[2], 1); else gl.uniform4f(u.uGround, 0, 0, 0, 0);
    gl.uniform2f(u.uOt, look.ot && !look.limited ? 1 : 0, otKeep(look));
    const ramp = new Uint8Array(look.ramp.length * 4);
    look.ramp.forEach((p, k) => { ramp[k * 4] = Math.round(clamp(p[0] + 0.5, 0, 1) * 255); ramp[k * 4 + 1] = Math.round(clamp(p[1] + 0.5, 0, 1) * 255); ramp[k * 4 + 3] = 255; });
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, G.ramp);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, look.ramp.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, ramp);
  }
  // Pinta «source» con el look en el lienzo del sombreador (w × h). scene: histograma de luz y color medio.
  const toneBytes = new Uint8Array(256), lutBytes = new Uint8Array(OT_N * OT_N * OT_N * 4);
  // Un lienzo intermedio (textura + su marco), del tamaño pedido.
  function target(name, w, h) {
    const gl = G.gl;
    let t = G.fb[name];
    if (!t) { t = G.fb[name] = { tex: gl.createTexture(), fb: gl.createFramebuffer(), w: 0, h: 0 }; gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, t.tex); for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val); }
    if (t.w !== w || t.h !== h) {
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      t.w = w; t.h = h;
    }
    return t;
  }
  // Una pasada de la luz: de la textura «from» (y «plus», al sumar) al lienzo «to» (o a la salida).
  const kernel = new Float32Array(5);
  function pass(mode, from, to, w, h, o) {
    const gl = G.gl, v = G.v;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fb : null);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, from);
    // (la segunda entrada se suelta cuando no se usa: si se quedara puesta la de un cuadro anterior y
    //  resultara ser el lienzo al que ahora se pinta, WebGL lo toma por leer y escribir a la vez y no pinta)
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, o.plus || null);
    const box = o.box || [0, 0, 1, 1];
    gl.uniform4f(v.uBox, box[0], box[1], box[2], box[3]);
    gl.uniform2f(v.uStep, o.step[0], o.step[1]);
    gl.uniform1f(v.uMode, mode); gl.uniform1f(v.uGain, o.gain || 0); gl.uniform1f(v.uFrom, GLOW_FROM);
    if (o.sigma) { let sum = 0; for (let i = 0; i < 5; i++) { kernel[i] = Math.exp(-i * i / (2 * o.sigma * o.sigma)); sum += i ? 2 * kernel[i] : kernel[i]; } for (let i = 0; i < 5; i++) kernel[i] /= sum; gl.uniform1fv(v.uK, kernel); }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function draw(look, source, crop, w, h, scene, extra) {
    const gl = G.gl, u = G.u;
    if (G.canvas.width !== w || G.canvas.height !== h) { G.canvas.width = w; G.canvas.height = h; }
    gl.useProgram(G.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.src);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    // El look y la curva de tonos solo se vuelven a subir cuando cambian (la escena se mide tres veces
    // por segundo, no treinta).
    if (G.look !== look) { loadLook(look); G.look = look; G.sceneAt = -1; }
    if (G.sceneAt !== scene.version || scene.version == null) {
      toneCurve(look, scene.hist, look.tone == null ? 0.8 : look.tone, toneBytes);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.tone);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, toneBytes);
      G.sceneAt = scene.version == null ? -1 : scene.version;
      if (look.ot && !look.limited && scene.samples && otKeep(look) > 0.01) {
        // La nube de la escena con los tonos ya puestos, y de ahí la tabla. En vivo la tabla sigue a
        // la nueva poco a poco («extra.follow»): la escena se mide con pocos puntos y de golpe parpadearía.
        const count = scene.samples.length / 3, cloud = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) { cloud[i * 3] = toneBytes[Math.round(clamp(scene.samples[i * 3], 0, 1) * 255)] / 255; cloud[i * 3 + 1] = scene.samples[i * 3 + 1]; cloud[i * 3 + 2] = scene.samples[i * 3 + 2]; }
        const fresh = transport(look, cloud, count), follow = extra.follow == null || !G.table || G.tableOf !== look.ot ? 1 : extra.follow;
        if (follow >= 1) G.table = fresh; else for (let i = 0; i < fresh.length; i++) G.table[i] += (fresh[i] - G.table[i]) * follow;
        G.tableOf = look.ot;
        const bytes = lutBytes;
        for (let z = 0; z < OT_N; z++) for (let y = 0; y < OT_N; y++) for (let x = 0; x < OT_N; x++) { const i = ((z * OT_N + y) * OT_N + x) * 2, o = (y * OT_N * OT_N + z * OT_N + x) * 4; bytes[o] = Math.round(clamp(G.table[i] + 0.5, 0, 1) * 255); bytes[o + 1] = Math.round(clamp(G.table[i + 1] + 0.5, 0, 1) * 255); bytes[o + 3] = 255; }
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, G.lut);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, OT_N * OT_N, OT_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      }
    }
    // La suavidad de la referencia: la escena se desenfoca antes de pintarla (en un lienzo pequeño:
    // el desenfoque mide siempre unos 2 puntos de ese lienzo, sea cual sea el tamaño de la salida).
    const plain = extra.aim || extra.plain, soft = !plain && look.soft > 0 ? look.soft : 0, glow = !plain && look.glow && look.glow.amount > 0 ? look.glow : null;
    if (soft) {
      const aw = Math.max(32, Math.min(w, Math.round(2 / soft))), ah = Math.max(8, Math.round(aw * h / w)), a = target('a', aw, ah), b = target('b', aw, ah);
      gl.useProgram(G.post);
      pass(0, G.src, a, aw, ah, { box: crop, step: [crop[2] / aw, crop[3] / ah] });
      pass(1, a.tex, b, aw, ah, { step: [1 / aw, 0], sigma: soft * aw });
      pass(1, b.tex, a, aw, ah, { step: [0, 1 / ah], sigma: soft * aw });
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.useProgram(G.prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.tex);
      crop = [0, 0, 1, 1];
    }
    const main = glow ? target('m', w, h) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, main ? main.fb : null);
    gl.viewport(0, 0, w, h);
    gl.uniform4f(u.uCrop, crop[0], crop[1], crop[2], crop[3]);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uMirror, extra.mirror ? 1 : 0);
    gl.uniform1f(u.uScale, extra.scale || 1);
    gl.uniform1f(u.uSeed, extra.seed || 0);
    gl.uniform1f(u.uReveal, extra.reveal == null ? 2 : extra.reveal);
    gl.uniform1f(u.uAim, extra.aim ? 1 : 0);
    gl.uniform4f(u.uChroma, scene.mean[0], scene.mean[1], look.mean[0], look.mean[1]);
    const mask = !plain && extra.mask && extra.back ? extra.mask : null;
    if (mask) {
      if (mask.seq == null || mask.seq !== G.maskSeq) {
        const count = mask.width * mask.height;
        if (!G.maskBytes || G.maskBytes.length !== count) G.maskBytes = new Uint8Array(count);
        for (let i = 0; i < count; i++) G.maskBytes[i] = mask.data[i] * 255;
        gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, G.mask);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mask.width, mask.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, G.maskBytes);
        G.maskSeq = mask.seq == null ? -1 : mask.seq;
      }
      gl.uniform4f(u.uBack, extra.back[0], extra.back[1], extra.back[2], 1);
    } else gl.uniform4f(u.uBack, 0, 0, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // El resplandor: lo que brilla en la imagen ya pintada, emborronado y sumado encima.
    if (glow) {
      const gw = Math.max(32, Math.min(Math.max(32, w >> 1), Math.round(2.4 / glow.size))), gh = Math.max(8, Math.round(gw * h / w)), g1 = target('g1', gw, gh), g2 = target('g2', gw, gh);
      gl.useProgram(G.post);
      pass(2, main.tex, g1, gw, gh, { step: [1 / gw, 1 / gh] });
      pass(1, g1.tex, g2, gw, gh, { step: [1 / gw, 0], sigma: glow.size * gw });
      pass(1, g2.tex, g1, gw, gh, { step: [0, 1 / gh], sigma: glow.size * gw });
      pass(3, main.tex, null, w, h, { step: [0, 0], plus: g1.tex, gain: glow.amount });
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.useProgram(G.prog);
    }
  }

  // ── Medir una imagen (para comparar dos): color, tonos, espectro y contornos ──
  // El color se compara como REPARTO, sin casillas: las mismas M muestras de las dos imágenes,
  // proyectadas sobre 13 direcciones de OKLab y ordenadas (transporte por rebanadas). Con casillas, un
  // tono que cae justo en una frontera cambia de casilla por nada y la nota salta.
  const DIRS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, -1, 1], [1, 1, -1], [1, -1, -1]]
    .map(d => { const m = Math.hypot(d[0], d[1], d[2]); return [d[0] / m, d[1] / m, d[2] / m]; });
  const SAMPLES = 4096, WEDGES = 12, picks = {};
  function pick(count) {
    if (picks[count]) return picks[count];
    const out = new Uint32Array(SAMPLES);
    let seed = 0x2545f491;
    for (let i = 0; i < SAMPLES; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; out[i] = seed % count; }
    return (picks[count] = out);
  }
  // flip: la imagen viene de abajo arriba (lo que se lee de WebGL); solo cambia el sentido de los ángulos.
  function features(data, n, flip) {
    const lab = labImage(data, n * n), lum = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) lum[i] = lab[i * 3];
    const idx = pick(n * n), slices = [];
    for (const d of DIRS) {
      const line = new Float32Array(SAMPLES);
      for (let i = 0; i < SAMPLES; i++) { const o = idx[i] * 3; line[i] = lab[o] * d[0] + lab[o + 1] * d[1] + lab[o + 2] * d[2]; }
      slices.push(line.sort());
    }
    // El espectro, de dos maneras: por tamaño del detalle (10 bandas) y por DIRECCIÓN (12 cuñas de 15°):
    // sin las cuñas, unas rayas horizontales y las mismas en vertical miden igual.
    const pow = spectrum(lum, n), bands = new Float32Array(10), wedges = new Float32Array(WEDGES);
    for (let v = -n / 2; v < n / 2; v++) for (let u = -n / 2; u < n / 2; u++) {
      const r = Math.hypot(u, v);
      if (r < 1.5 || r >= n / 2) continue;
      const e = pow[((v + n) % n) * n + ((u + n) % n)];
      bands[Math.min(9, (Math.log2(r / 1.5) / Math.log2(n / 3) * 10) | 0)] += e;
      if (r >= 6) { let t = Math.atan2(flip ? -v : v, u); if (t < 0) t += Math.PI; wedges[Math.round(t / (Math.PI / WEDGES)) % WEDGES] += e; }
    }
    let fineE = 0, allE = 0, wedgeE = 0;
    for (let i = 0; i < 10; i++) { allE += bands[i]; if (i >= 6) fineE += bands[i]; }
    for (let i = 0; i < WEDGES; i++) wedgeE += wedges[i];
    if (wedgeE > 0) for (let i = 0; i < WEDGES; i++) wedges[i] /= wedgeE;
    let edge = 0;
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) edge += Math.abs(lum[y * n + x + 1] - lum[y * n + x - 1]) + Math.abs(lum[(y + 1) * n + x] - lum[(y - 1) * n + x]);
    // texture (0…1): qué parte de la energía está en el detalle fino (trama, píxel, grano).
    return { slices, bands, wedges, edge: edge / (n * n), texture: clamp(((allE > 0 ? fineE / allE : 0) - 0.05) / 0.2, 0, 1) };
  }
  // Cada parte va de 0 (igual) a 1 (nada que ver). Con textura fina en CUALQUIERA de las dos, el
  // espectro y su dirección pesan (si la referencia lleva trama y el look no la trae, o al revés, tiene
  // que notarse); sin ella, la imagen es color y tonos, y el detalle fino lo pone la escena.
  function distance(a, b) {
    let color = 0, spec = 0, turn = 0;
    const tone = (() => { let t = 0; for (let i = 0; i < SAMPLES; i++) t += Math.abs(a.slices[0][i] - b.slices[0][i]); return t / SAMPLES; })();
    for (let d = 0; d < DIRS.length; d++) { let t = 0; const x = a.slices[d], y = b.slices[d]; for (let i = 0; i < SAMPLES; i++) t += Math.abs(x[i] - y[i]); color += t / SAMPLES; }
    color /= DIRS.length;
    // (una banda casi vacía en las dos no cuenta: se compara por encima de un suelo proporcional a la energía total)
    let ea = 0, eb = 0;
    for (let i = 0; i < 10; i++) { ea += a.bands[i]; eb += b.bands[i]; }
    const floor = 0.004 * (ea + eb) / 2 + 1e-5;
    for (let i = 0; i < 10; i++) spec += Math.min(2, Math.abs(Math.log10((a.bands[i] + floor) / (b.bands[i] + floor))));
    for (let i = 0; i < WEDGES; i++) turn += Math.abs(a.wedges[i] - b.wedges[i]);
    const edge = Math.abs(a.edge - b.edge) / Math.max(0.02, a.edge, b.edge);
    const c = Math.min(1, color / COLOR_FAR), t = Math.min(1, tone * 4), s = Math.min(1, spec / 20 * 3), o = Math.min(1, turn / 2), e = Math.min(1, edge);
    const k = Math.max(a.texture, b.texture);
    return { color: c, tone: t, spec: s, turn: o, edge: e, texture: k, total: (0.56 - 0.18 * k) * c + (0.2 - 0.08 * k) * t + (0.1 + 0.06 * k) * s + 0.2 * k * o + 0.14 * e };
  }
  function sceneOf(data, n, bins) {
    const hist = new Float32Array(bins || 64), tmp = new Float32Array(3), top = hist.length - 1;
    let a = 0, b = 0;
    // (y hasta 1024 de sus puntos, repartidos por toda ella: la nube de color que se lleva a la de la referencia)
    const step = Math.max(1, Math.ceil(n / 1024)), samples = new Float32Array(Math.ceil(n / step) * 3);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      toLab(data[p], data[p + 1], data[p + 2], tmp, 0); hist[Math.min(top, (tmp[0] * (top + 1)) | 0)]++; a += tmp[1]; b += tmp[2];
      if (i % step === 0) samples.set(tmp, (i / step) * 3);
    }
    return { hist, mean: [a / n, b / n], samples };
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
  // own: el look medido de ESTA referencia, si el que se prueba es otro (la versión sin estilo la
  // decide la referencia: con el look que se prueba, cada candidato se medía contra una base distinta).
  // bare: la referencia sin su resplandor, si lo tiene (es la «escena» de la que se parte en la entera).
  function fit(look, ref, span, whole, own, bare) {
    if (!ensureGl()) return look;
    // (con píxel gordo los bloques van al doble: en uno pequeño caben dos o tres celdas del tramado y su
    //  color medio depende de cuáles tocaron)
    const n = FIT_N, gl = G.gl, B = (own || look).pixel ? 8 : 16;
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
      allSoft.ctx.imageSmoothingEnabled = true; allSoft.ctx.imageSmoothingQuality = 'high'; allSoft.ctx.drawImage(halve(bare || all.canvas, 16), 0, 0, n, n);
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
    const base = own || look, patterned = !!base.pixel || base.screen.type !== 'none';
    // Sin trama, antes se quitan las líneas de tinta con una mediana (a mitad de tamaño, 9 × 9: se lleva
    // líneas de hasta 9 píxeles): emborronada, una línea negra se queda en un surco gris que el look
    // pinta con otra tinta. Y si es tinta plana (un cartel), no se emborrona más: las manchas tienen que
    // conservar su borde, que es donde el look vuelve a poner la línea (emborronada, la línea no se
    // podía probar). El precio: de una imagen posterizada SIN líneas, su versión sin estilo es casi ella
    // misma, y un look de color continuo la reproduce casi igual de bien; ahí la nota separa poco.
    let plain = crop.canvas;
    const flat = !patterned && base.limited && !(base.grain.amount > 0.03);
    if (!patterned) {
      const h = n >> 1, small = surface({ canvas: null, ctx: null }, h, h);
      small.ctx.imageSmoothingEnabled = true; small.ctx.drawImage(crop.canvas, 0, 0, h, h);
      const im = small.ctx.getImageData(0, 0, h, h), src = new Uint8ClampedArray(im.data), win = new Uint8Array(81);
      for (let c = 0; c < 3; c++) for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) {
        let q = 0;
        for (let dy = -4; dy <= 4; dy++) { const yy = clamp(y + dy, 0, h - 1) * h; for (let dx = -4; dx <= 4; dx++) win[q++] = src[(yy + clamp(x + dx, 0, h - 1)) * 4 + c]; }
        win.sort(); im.data[(y * h + x) * 4 + c] = win[40];
      }
      small.ctx.putImageData(im, 0, 0);
      plain = small.canvas;
    }
    soft.ctx.imageSmoothingEnabled = true; soft.ctx.imageSmoothingQuality = 'high'; soft.ctx.drawImage(flat && !fit.blur ? plain : halve(plain, fit.blur || (patterned ? 8 : 16)), 0, 0, n, n);
    // Si la referencia venía con ruido de cámara (no es parte del look), se compara contra ella un poco
    // alisada: el look no lo pone, y no tiene por qué perder nota por no ponerlo.
    let goal = crop;
    if (base.grain.sensor) {
      const h = surface({ canvas: null, ctx: null }, n >> 1, n >> 1);
      h.ctx.imageSmoothingEnabled = true; h.ctx.drawImage(crop.canvas, 0, 0, n >> 1, n >> 1);
      goal = surface({ canvas: null, ctx: null }, n, n);
      goal.ctx.imageSmoothingEnabled = true; goal.ctx.drawImage(h.canvas, 0, 0, n, n);
    }
    const target = features(goal.ctx.getImageData(0, 0, n, n).data, n);
    // Los tonos a los que se lleva el recorte son los suyos propios, sin estilo (la curva del look es
    // la de la imagen entera, que puede tener zonas que aquí no salen): la prueba mide si la paleta,
    // la trama y el grano reconstruyen la imagen, no la curva.
    const softData = soft.ctx.getImageData(0, 0, n, n).data, cropL = new Float32Array(n * n), tmp = new Float32Array(3);
    for (let i = 0, p = 0; i < n * n; i++, p += 4) { toLab(softData[p], softData[p + 1], softData[p + 2], tmp, 0); cropL[i] = tmp[0]; }
    cropL.sort();
    const cropCdf = [];
    for (let i = 0; i <= 32; i++) cropCdf.push(cropL[Math.min(n * n - 1, Math.round(i / 32 * (n * n - 1)))]);
    const scene = sceneOf(softData, n * n, 256);
    const scale = side / span, px = new Uint8Array(n * n * 4);
    // (y lo mismo su reparto de color: el del recorte, no el de la referencia entera)
    let cropOt;
    if (look.ot) {
      const cd = crop.ctx.getImageData(0, 0, n, n).data;
      cropOt = '';
      for (let k = 0; k < OT_M; k++) { const i = Math.floor((k + 0.5) * n * n / OT_M) * 4; toLab(cd[i], cd[i + 1], cd[i + 2], tmp, 0); cropOt += hex2(tmp[0] - 0.5) + hex2(tmp[1]) + hex2(tmp[2]); }
    }
    const crisp = candidate => {
      draw({ ...candidate, cdf: cropCdf, ot: cropOt, mean: scene.mean, vignette: 0, exact: true }, soft.canvas, [0, 0, 1, 1], n, n, scene, { scale, seed: 0.37, plain: true });
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
    };
    const score = candidate => {
      // (la viñeta y el color medio son de la imagen entera: en un recorte no se pueden juzgar)
      crisp(candidate);
      const d = distance(features(px, n, true), target);
      d.place = 0;
      if (allBlocks) {
        draw({ ...candidate, soft: 0 }, allSoft.canvas, [0, 0, 1, 1], n, n, allScene, { scale: n / whole.width, seed: 0.37 });
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
      ['sat', l => l.sat, (l, v) => { l.sat = v; }, look.limited || look.ot || look.rampMix > 0.9 ? [1] : [0.6, 0.8, 1, 1.25, 1.5]],
      // (con paleta cerrada, la trama de puntos o de líneas es lo que da los tonos: va entera)
      ['strength', l => l.screen.strength, (l, v) => { l.screen.strength = v; }, look.screen.type === 'none' || (look.limited && (look.screen.type === 'dot' || look.screen.type === 'line')) ? [look.screen.strength] : [0.5, 0.75, 1].map(k => +(clamp(look.screen.strength * k, 0, 1)).toFixed(3)).concat(look.screen.strength < 1 ? [+clamp(look.screen.strength * 1.3, 0, 1).toFixed(3)] : [])],
      ['grain', l => l.grain.amount, (l, v) => { l.grain.amount = v; }, // (el grano no se sube por encima de lo medido: subiría para imitar el detalle que el emborronado quitó)
      look.grain.amount ? [0.4, 0.7, 1].map(k => +(look.grain.amount * k).toFixed(3)) : [0]],
      ['edge', l => l.edge, (l, v) => { l.edge = v; }, look.edge ? [0, 0.5, 1, 1.6, 2.5].map(k => +clamp(look.edge * k, 0, 1).toFixed(3)).filter((v, i, a) => a.indexOf(v) === i) : [0]],
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
    if (fit.debug) { crisp(best); const c = document.createElement('canvas'); c.width = c.height = n; const im = c.getContext('2d').createImageData(n, n); im.data.set(px); c.getContext('2d').putImageData(im, 0, 0); fit.debug = { synth: c.toDataURL(), target: crop.canvas.toDataURL(), soft: soft.canvas.toDataURL(), plain: plain.toDataURL() }; }
    best.score = Math.round(100 * Math.exp(-1.5 * d.total));
    best.fit = { texture: +d.texture.toFixed(2), turn: +d.turn.toFixed(3), place: +d.place.toFixed(3), color: +d.color.toFixed(3), tone: +d.tone.toFixed(3), spec: +d.spec.toFixed(3), edge: +d.edge.toFixed(3), runs };
    G.look = null;
    return best;
  }

  // ── Los looks guardados ─────────────────────────────────────────────────────
  const S = { looks: [], aim: false, revealAt: 0, frame: 0, ms: 0, scene: { hist: new Float32Array(64).fill(1), mean: [0, 0], samples: null, follow: 1 }, sceneAt: -1e9, last: null, busy: false };
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) S.looks = saved.filter(l => l && l.v === 1 && l.id && Array.isArray(l.palette)); } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S.looks)); } catch (_) {} };
  const family = () => (typeof CAM_FAMILIES !== 'undefined' ? CAM_FAMILIES.CLON : null);
  // Caben MAX_LOOKS looks; a la mano, en la fila de variantes, van A_MANO: el que está puesto, luego
  // los favoritos y luego los últimos. Los demás siguen siendo variantes válidas (se eligen en la
  // galería), pero la fila no los pinta («oculta»). Quiénes van a la mano solo se recalcula al tocar
  // la galería, no al pasar de uno a otro en la fila: si no, las teclas bailarían bajo el dedo.
  function syncVariants() {
    const fam = family();
    if (!fam) return;
    const cur = typeof camVariant !== 'undefined' ? camVariant : '';
    const hand = new Set(S.looks.slice().sort((a, b) => (b.id === cur) - (a.id === cur) || (!!b.fav) - (!!a.fav) || (b.at || 0) - (a.at || 0)).slice(0, A_MANO).map(l => l.id));
    fam.variants = S.looks.length ? S.looks.map(l => ({ id: l.id, label: l.name, hint: l.name + ' · ' + describe(l), oculta: !hand.has(l.id) })) : [{ id: 'NUEVO', label: 'NUEVO', hint: 'CLON · apunta a una imagen y toca COPIAR, o abre una con ABRIR: FLIP arma una cámara con su look.' }];
  }
  syncVariants();
  const current = () => S.looks.find(l => l.id === (typeof camVariant !== 'undefined' ? camVariant : '')) || null;
  const mine = () => typeof camFamily !== 'undefined' && camFamily === 'CLON';
  // (y se anota en los ajustes cuál quedó puesto: si no, al volver a abrir FLIP la cámara arrancaba apuntando)
  const apply = () => { if (typeof _applyCamState === 'function') _applyCamState(); if (typeof saveSettings === 'function') saveSettings(); };
  const say = (text, ms) => { if (window.flipShell && flipShell.hint) flipShell.hint(text, ms || 2600); };

  // Aprender de una imagen (lienzo, imagen o cuadro de cámara): mide, se pone a prueba y guarda.
  // El fondo de una referencia, si lo tiene: un color liso (sin cambios entre vecinos) que ocupa al
  // menos un cuarto de ella. cand: [cambio con sus vecinos, x, y] por muestra; full: sus puntos (RGBA).
  function backdrop(cand, full, W) {
    // negro absoluto o blanco absoluto: basta con que ocupen un quinto (aunque traigan el ruido de un JPEG)
    const dark = [0, 0, 0, 0], light = [0, 0, 0, 0];
    for (const [, x, y] of cand) {
      const i = 4 * (y * W + x), hi = Math.max(full[i], full[i + 1], full[i + 2]), lo = Math.min(full[i], full[i + 1], full[i + 2]);
      const to = hi <= 22 ? dark : lo >= 233 ? light : null;
      if (to) { to[0] += full[i]; to[1] += full[i + 1]; to[2] += full[i + 2]; to[3]++; }
    }
    const end = dark[3] >= light[3] ? dark : light;
    // (en niveles enteros: la conversión de color va por tabla, y con decimales no encuentra el nivel)
    if (end[3] >= cand.length * 0.2) return { rgb: [Math.round(end[0] / end[3]), Math.round(end[1] / end[3]), Math.round(end[2] / end[3])], share: 0 };
    const bins = new Map();
    for (const [g, x, y] of cand) if (g <= 24) {
      const i = 4 * (y * W + x), key = (full[i] >> 4) << 8 | (full[i + 1] >> 4) << 4 | full[i + 2] >> 4;
      let b = bins.get(key); if (!b) bins.set(key, b = [0, 0, 0, 0]);
      b[0] += full[i]; b[1] += full[i + 1]; b[2] += full[i + 2]; b[3]++;
    }
    let top = null;
    for (const b of bins.values()) if (!top || b[3] > top[3]) top = b;
    if (!top || top[3] < cand.length * 0.25) return null;
    return { rgb: [Math.round(top[0] / top[3]), Math.round(top[1] / top[3]), Math.round(top[2] / top[3])], share: 0 };
  }
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
    // La paleta sale de la referencia a su tamaño, pero solo de sus puntos «de interior»: los que
    // se parecen a sus cuatro vecinos. Un borde desenfocado es una mezcla de dos tintas, y contarlo
    // inventa tintas que no existen.
    const W = ref.canvas.width, H = ref.canvas.height, full = ref.ctx.getImageData(0, 0, W, H).data;
    const stride = Math.max(1, Math.round(Math.sqrt(W * H / 20000))), cand = [];
    for (let y = 1; y < H - 1; y += stride) for (let x = 1; x < W - 1; x += stride) {
      const i = 4 * (y * W + x);
      let g = 0;
      for (let c = 0; c < 3; c++) g += Math.abs(full[i + c] - full[i + c + 4]) + Math.abs(full[i + c] - full[i + c - 4]) + Math.abs(full[i + c] - full[i + c + 4 * W]) + Math.abs(full[i + c] - full[i + c - 4 * W]);
      cand.push([g, x, y]);
    }
    // ¿Fondo liso? Una figura sobre negro absoluto (o blanco, o un color plano) es casi toda fondo: sus
    // puntos «de interior» —los más lisos— eran TODOS del fondo, y la figura se quedaba fuera de la
    // paleta (un esqueleto azul y rosa sobre negro salía «dos tintas: negro y azul»). Si un solo color,
    // liso, ocupa buena parte de la referencia, es el fondo: lo liso se busca en lo que NO es fondo, y
    // el fondo entra en la paleta como una tinta más, sin pasar de la mitad de las muestras (para que
    // las tintas de la figura no se queden por debajo de lo que cuenta como tinta).
    const back = backdrop(cand, full, W);
    const isBack = back ? i => Math.abs(full[i] - back.rgb[0]) + Math.abs(full[i + 1] - back.rgb[1]) + Math.abs(full[i + 2] - back.rgb[2]) <= 36 : () => false;
    const figure = back ? cand.filter(c => !isBack(4 * (c[2] * W + c[1]))) : cand;
    const flat = figure.map(c => c[0]).sort((p, q) => p - q)[Math.floor(figure.length * 0.55)];
    let kept = figure.filter(c => c[0] <= flat), backN = 0;
    if (back) {
      const behind = cand.filter(c => isBack(4 * (c[2] * W + c[1])));
      back.share = +(behind.length / cand.length).toFixed(3);
      backN = Math.min(behind.length, kept.length);                // el fondo, como mucho la mitad de las muestras
      const step = behind.length / Math.max(1, backN);
      for (let k = 0; k < backN; k++) kept.push(behind[Math.floor(k * step)]);
    }
    const sn = kept.length, pts = new Float32Array(sn * 5), sparse = new Uint8ClampedArray(sn * 4);
    kept.forEach(([, x, y], k) => { const i = 4 * (y * W + x); pts.set([x / W - 0.5, y / H - 0.5, full[i], full[i + 1], full[i + 2]], k * 5); sparse.set([full[i], full[i + 1], full[i + 2], 255], k * 4); });
    const thumbData = thumb.ctx.getImageData(0, 0, tw, th).data;
    const low = halve(ref.canvas, 40);
    const lowData = low.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, low.width, low.height).data;
    // ¿Luz desigual? Si un plano de luz la explica Y al deshacerlo la paleta mejora, se deshace (en
    // las muestras de la paleta, en la miniatura y en la imagen de los tonos).
    let light = null;
    const plane = lightPlane(pts, sn), asIs = plane ? { thumb: new Uint8ClampedArray(thumbData), low: new Uint8ClampedArray(lowData), sparse: new Uint8ClampedArray(sparse) } : null;
    if (plane) {
      const fixed = new Uint8ClampedArray(sn * 4);
      for (let k = 0; k < sn; k++) { const gain = lightGain(plane, pts[k * 5], pts[k * 5 + 1]); fixed[k * 4] = sparse[k * 4] * gain; fixed[k * 4 + 1] = sparse[k * 4 + 1] * gain; fixed[k * 4 + 2] = sparse[k * 4 + 2] * gain; fixed[k * 4 + 3] = 255; }
      const before = palette(labImage(sparse, sn), sn), after = palette(labImage(fixed, sn), sn);
      if (after.error < before.error * 0.65 || after.colors.length < before.colors.length) {
        light = plane;
        sparse.set(fixed);
        const undo = (data, w, h) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = 4 * (y * w + x), gain = lightGain(plane, (x + 0.5) / w - 0.5, (y + 0.5) / h - 0.5); data[i] *= gain; data[i + 1] *= gain; data[i + 2] *= gain; } };
        undo(thumbData, tw, th); undo(lowData, low.width, low.height);
      }
    }
    // (una imagen a la mitad, promediando de 2 × 2)
    const half = t => { const w2 = tw >> 1, h2 = th >> 1, out = new Uint8ClampedArray(w2 * h2 * 4); for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) for (let c = 0; c < 3; c++) { const i = 4 * (2 * y * tw + 2 * x) + c; out[4 * (y * w2 + x) + c] = (t[i] + t[i + 4] + t[i + 4 * tw] + t[i + 4 * tw + 4] + 2) >> 2; } return { data: out, n: w2 * h2 }; };
    const measure = (t, l, sp) => analyze({ data: t, width: tw, height: th }, { lum, n: FFT_N, span, zoom: FFT_N / side }, { data: sp, n: sn }, { data: l, n: low.width * low.height }, back ? { rgb: back.rgb, share: back.share, samples: backN } : null, half(t));
    let look = measure(thumbData, lowData, sparse);
    // (la luz desigual solo se deshace en un cartel: tintas planas que la luz del cuarto aclara de un
    //  lado. En una imagen de color continuo, un degradado es de la imagen —un cielo, un fondo de
    //  estudio—: deshacerlo le aplanaba los tonos y le cambiaba los colores)
    if (light && !look.limited) { light = null; look = measure(asIs.thumb, asIs.low, asIs.sparse); }
    if (light) look.light = { bx: +light.bx.toFixed(3), by: +light.by.toFixed(3), r2: light.r2 };
    // Suavidad y resplandor (solo en color continuo sin trama ni píxel: en un cartel, el borde es el look).
    let bare = null;
    if (!look.limited && !look.pixel && look.screen.type === 'none') {
      const t = light ? thumbData : asIs ? asIs.thumb : thumbData, sp = light ? sparse : asIs ? asIs.sparse : sparse, L = new Float32Array(tw * th), tmp3 = new Float32Array(3);
      for (let i = 0; i < tw * th; i++) { toLab(t[i * 4], t[i * 4 + 1], t[i * 4 + 2], tmp3, 0); L[i] = tmp3[0]; }
      const soft = softOf(L, tw, th), glow = glowOf(t, tw, th, soft);
      if (glow) {
        // Los tonos, el color y la paleta se miden otra vez sobre la referencia sin su resplandor: si
        // no, el halo contaba como tonos de la imagen y la cámara lo ponía dos veces.
        bare = surface({ canvas: null, ctx: null }, tw, th);
        const im = bare.ctx.createImageData(tw, th); im.data.set(glow.bare); bare.ctx.putImageData(im, 0, 0);
        const low2 = halve(bare.canvas, 40), lowBare = low2.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, low2.width, low2.height).data, spBare = new Uint8ClampedArray(sp);
        for (let k = 0; k < sn; k++) { const g = glow.at(pts[k * 5] + 0.5, pts[k * 5 + 1] + 0.5); for (let c = 0; c < 3; c++) spBare[k * 4 + c] = Math.round(255 * Math.pow(Math.max(0, LIN[sp[k * 4 + c]] - g[c]), 1 / 2.2)); }
        look = analyze({ data: glow.bare, width: tw, height: th }, { lum, n: FFT_N, span, zoom: FFT_N / side }, { data: spBare, n: sn }, { data: lowBare, n: low2.width * low2.height }, back ? { rgb: back.rgb, share: back.share, samples: backN } : null, half(glow.bare));
        look.glow = { amount: glow.amount, size: glow.size };
      }
      if (soft) look.soft = soft;
    }
    look = fit(look, fineCanvas.canvas, span, ref.canvas, undefined, bare && bare.canvas);
    look.name = nameOf(look);
    // La miniatura para la galería: el centro de la referencia, 96 × 96 (unos 3 KB; no sale del teléfono).
    try {
      const mini = surface({ canvas: null, ctx: null }, 96, 96), m = Math.min(tw, th);
      mini.ctx.imageSmoothingEnabled = true; mini.ctx.imageSmoothingQuality = 'high';
      mini.ctx.drawImage(thumb.canvas, (tw - m) / 2, (th - m) / 2, m, m, 0, 0, 96, 96);
      look.thumb = mini.canvas.toDataURL('image/jpeg', 0.72);
    } catch (_) {}
    return look;
  }
  function keep(look) {
    let n = 1;
    const used = new Set(S.looks.map(l => l.id));
    while (used.has('C' + n)) n++;
    look.id = 'C' + n;
    look.at = Date.now();
    if (S.looks.some(l => l.name === look.name)) { let k = 2; while (S.looks.some(l => l.name === look.name + ' ' + k)) k++; look.name += ' ' + k; }
    // Llena de favoritos: una estrella no se pisa sin permiso. No se guarda, y se dice por qué.
    S.out = null; S.full = false;
    if (S.looks.length >= MAX_LOOKS && S.looks.every(l => l.fav)) { S.full = true; return null; }
    S.looks.push(look);
    // Llena: sale el más viejo sin estrella, y queda en la mano unos segundos por si se quiere de vuelta.
    while (S.looks.length > MAX_LOOKS) { const i = S.looks.findIndex(l => !l.fav && l !== look); S.out = S.looks.splice(i, 1)[0]; S.undo = { look: S.out, at: i, was: false, added: look.id }; }
    if (mine()) camVariant = look.id;
    save(); syncVariants();
    if (mine()) apply();
    paint();
    return look;
  }
  // Borrar deja el look en la mano un momento, por si fue sin querer (restore lo devuelve a su sitio).
  function forget(id) {
    const at = S.looks.findIndex(l => l.id === id);
    if (at < 0) return null;
    const was = current() && current().id === id, look = S.looks.splice(at, 1)[0];
    S.undo = { look, at, was };
    if (mine() && was) camVariant = S.looks.length ? S.looks[Math.min(at, S.looks.length - 1)].id : 'NUEVO';
    save(); syncVariants();
    if (mine()) apply();
    paint();
    return look;
  }
  function restore() {
    const u = S.undo;
    if (!u || (S.looks.length >= MAX_LOOKS && !u.added)) return null;
    S.undo = null;
    if (u.added) { const i = S.looks.findIndex(l => l.id === u.added); if (i >= 0) S.looks.splice(i, 1); }      // el que entró en su lugar se va
    S.looks.splice(Math.min(u.at, S.looks.length), 0, u.look);
    if (mine() && (u.was || u.added)) camVariant = u.look.id;
    save(); syncVariants();
    if (mine()) apply();
    paint();
    return u.look;
  }
  function rename(id, text) {
    const look = S.looks.find(l => l.id === id), name = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 18);
    if (!look || !name || name === look.name) return look ? look.name : null;
    look.name = name; look.named = true;
    save(); syncVariants();
    if (mine()) apply();
    paint();
    return name;
  }
  function fav(id, on) {
    const look = S.looks.find(l => l.id === id);
    if (!look) return false;
    look.fav = on == null ? !look.fav : !!on;
    save(); syncVariants();
    if (mine()) apply();
    paint();
    return look.fav;
  }
  function use(id) {
    if (!S.looks.some(l => l.id === id)) return false;
    if (typeof camFamily !== 'undefined' && camFamily !== 'CLON' && typeof _setCamFamily === 'function') _setCamFamily('CLON');
    camVariant = id; S.aim = false;
    syncVariants(); apply(); paint();
    return true;
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
      try {
        look = keep(learn(source, sw, sh, region));
        if (look) { S.aim = false; S.revealAt = performance.now(); entered(look); }
        else if (S.full) { say('30 favoritos · quita una estrella o borra uno para guardar otro look', 6500); gallery(true); }
      }
      catch (error) { console.warn('CLON:', error); say('No pude leer esa imagen', 2600); }
      S.busy = false;
      if (shutter) shutter.classList.remove('mirando');
      paint();
      resolve(look);
    }, 60));
  }

  // ── FIGURA: la cámara sabe qué es persona y qué es fondo ─────────────────────
  // Sin esto, «una figura clara sobre negro» se traduce por luz: lo claro de la escena brilla y lo
  // oscuro se va a negro, sea persona o pared. Con la tecla FIGURA (en looks de fondo liso) se usa el
  // detector de personas de FLIP —el mismo de STAGE y FLOW; corre en el teléfono—, y solo cuenta la
  // persona a la que se le ve la cara (ver «confirmFigure»): lo que no es
  // persona toma el color del fondo de la referencia, y la persona recibe los tonos y los colores de la
  // FIGURA de la referencia (medidos sin su fondo), repartidos según la luz y el color de la persona
  // sola. Si no hay nadie en cuadro, o el detector aún no carga, la cámara sigue como siempre.
  // (solo con un fondo inconfundible: negro o blanco absolutos, o el fondo plano de un cartel. La pared
  //  lisa de una foto también «ocupa un cuarto de la imagen», y no es un fondo de estudio)
  const backOf = look => (look ? look.ground || (look.limited && look.backdrop) || null : null);
  function figureLook(look) {
    if (look._fig && look._fig.from === look.ot && look._fig.sat === look.sat) return look._fig.look;
    const own = look.otOwn >= 60 && look.ot ? look.ot.slice(0, look.otOwn * 6) : look.ot;
    const fig = { ...look, cdf: look.cdfFig || look.cdf, ot: own, back: 0, ground: null };
    Object.defineProperty(look, '_fig', { value: { from: look.ot, sat: look.sat, look: fig }, enumerable: false, configurable: true, writable: true });
    return fig;
  }
  // La figura confirmada. El detector de personas es un modelo de selfies: sin nadie cerca toma por
  // persona un sillón, una cortina, una lámpara. Así que de su máscara solo cuentan las manchas que
  // TOCAN UNA CARA (el detector de caras va junto, en el mismo cuadro): se rellena la mancha desde la
  // cara y lo demás se tira. Si la persona se da la vuelta, la mancha se sigue unos segundos por donde
  // estaba; sin cara y sin rastro, no hay figura y la cámara reparte el look por luz, como siempre.
  // El borde se difumina (un 1,5 % del ancho) y se mezcla con el de la máscara anterior: recortado
  // en seco sobre un fondo liso, parece una calcomanía.
  const FIG = { seq: -1, out: null, last: null, lastW: 0, lastH: 0, faceAt: -1e9 };
  function confirmFigure(mask, now) {
    if (!mask) return null;
    if (mask.seq != null && mask.seq === FIG.seq) return FIG.out;
    FIG.seq = mask.seq == null ? -1 : mask.seq;
    const w = mask.width, h = mask.height, n = w * h, data = mask.data, keep = new Uint8Array(n), stack = [];
    const seed = i => { if (!keep[i] && data[i] > 0.5) { keep[i] = 1; stack.push(i); } };
    const faces = (mask.faces || []).filter(f => f[4] >= 0.5);
    for (const f of faces) {
      // (la cara y un poco más abajo: el cuello y los hombros, por si la máscara deja un hueco en la cara)
      const x0 = Math.max(0, Math.floor(f[0] * w)), x1 = Math.min(w - 1, Math.ceil(f[2] * w)), y0 = Math.max(0, Math.floor(f[1] * h)), y1 = Math.min(h - 1, Math.ceil((f[3] + (f[3] - f[1]) * 0.4) * h));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) seed(y * w + x);
    }
    if (faces.length) FIG.faceAt = now;
    else if (FIG.last && FIG.lastW === w && FIG.lastH === h && now - FIG.faceAt < 4000) for (let i = 0; i < n; i++) if (FIG.last[i] > 0.6) seed(i);
    while (stack.length) {
      const i = stack.pop(), x = i % w;
      if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1); if (i >= w) seed(i - w); if (i < n - w) seed(i + w);
    }
    let count = 0;
    for (let i = 0; i < n; i++) count += keep[i];
    if (count < n * 0.02) { FIG.last = null; return (FIG.out = null); }
    const soft = feather(Float32Array.from(keep, (k, i) => (k ? data[i] : 0)), w, h);
    if (FIG.last && FIG.lastW === w && FIG.lastH === h) for (let i = 0; i < n; i++) soft[i] = 0.6 * soft[i] + 0.4 * FIG.last[i];
    FIG.last = soft; FIG.lastW = w; FIG.lastH = h;
    return (FIG.out = { data: soft, width: w, height: h, seq: mask.seq, share: count / n });
  }
  const feather = (plane, w, h) => blurPlane(plane, w, h, Math.max(0.8, w * 0.015));
  // Los puntos de una imagen (RGBA) que caen sobre la persona; null si casi no hay persona.
  function figurePixels(data, w, h, mask) {
    const out = new Uint8ClampedArray(w * h * 4);
    let count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const m = mask.data[Math.min(mask.height - 1, Math.floor((y + 0.5) / h * mask.height)) * mask.width + Math.min(mask.width - 1, Math.floor((x + 0.5) / w * mask.width))];
      if (m > 0.5) { const i = 4 * (y * w + x); out[count * 4] = data[i]; out[count * 4 + 1] = data[i + 1]; out[count * 4 + 2] = data[i + 2]; out[count * 4 + 3] = 255; count++; }
    }
    return count >= Math.max(12, w * h * 0.02) ? { data: out.subarray(0, count * 4), count, share: count / (w * h) } : null;
  }
  function figureKey() {
    const look = current();
    if (!look || !backOf(look) || S.busy) return;
    look.figure = !look.figure;
    S.figSaid = '';
    if (look.figure && typeof flipSilhouette !== 'undefined') flipSilhouette.start();
    save(); syncVariants(); paint();
    say(look.figure ? 'FIGURA · la persona toma el look y lo demás se va al fondo' : 'FIGURA apagada · el look se reparte por luz', 3200);
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
    // FIGURA: se le ofrece el cuadro al detector de personas y se toma su última máscara.
    let mask = null;
    if (look && look.figure && backOf(look) && !aim && typeof flipSilhouette !== 'undefined') {
      flipSilhouette.start();
      flipSilhouette.push(source, sx, sy, sw, sh, false, { faces: true });
      const raw = flipSilhouette.latest(1200);
      mask = confirmFigure(raw, started);
      // (y se dice qué pasa, una vez por cambio: cargando, sin conexión, o que no hay una cara a la vista)
      const phase = raw ? (mask ? 'ready' : raw.faces ? 'nobody' : 'loading') : flipSilhouette.status().phase;
      if (phase !== S.figSaid && opts.path !== 'capture' && !(phase === 'nobody' && started - (S.figSaidAt || 0) < 6000)) {
        S.figSaid = phase; S.figSaidAt = started;
        if (phase === 'failed') say('FIGURA necesita conexión la primera vez', 4200);
        else if (phase === 'nobody') say('FIGURA · no veo una cara: el look va por luz', 3000);
        else if (phase !== 'ready') say('Cargando el recorte de figura…', 2600);
      }
    }
    // La escena se mide de vez en cuando (su luz y su color medio) y se sigue despacio.
    if (started - S.sceneAt > 330 || !!mask !== !!S.figMask) {
      surface(probe, 32, 24);
      probe.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 32, 24);
      // (con FIGURA, la escena que cuenta es la persona sola; si no hay nadie en cuadro, todo como siempre)
      const all = probe.ctx.getImageData(0, 0, 32, 24).data, own = mask ? figurePixels(all, 32, 24, mask) : null, was = S.figOn;
      S.figOn = !!own; S.figShare = own ? +own.share.toFixed(3) : 0; S.figMask = !!mask;
      const fresh = own ? sceneOf(own.data, own.count) : sceneOf(all, 32 * 24), cold = started - S.sceneAt > 1500 || S.scene.version == null || was !== S.figOn;
      // Cuánto cambió la escena (0 nada, 1 todo). Por debajo de un 4 % es ruido de la cámara o pulso de
      // la mano: no se toca nada y la imagen no parpadea. Un cambio grande se sigue rápido; uno
      // normal, despacio.
      let moved = 0;
      for (let i = 0; i < 64; i++) moved += Math.abs(fresh.hist[i] - S.scene.hist[i]);
      moved /= 2 * 32 * 24;
      const mix = cold ? 1 : moved < 0.04 ? 0 : moved > 0.3 ? 0.55 : 0.16;
      if (mix > 0) {
        for (let i = 0; i < 64; i++) S.scene.hist[i] += (fresh.hist[i] - S.scene.hist[i]) * mix;
        S.scene.mean[0] += (fresh.mean[0] - S.scene.mean[0]) * mix; S.scene.mean[1] += (fresh.mean[1] - S.scene.mean[1]) * mix;
        S.scene.samples = fresh.samples; S.scene.follow = mix;
        S.scene.version = (S.scene.version || 0) + 1;
      }
      S.sceneAt = started;
    }
    const reveal = started - S.revealAt < REVEAL_MS && opts.path !== 'capture' ? (started - S.revealAt) / REVEAL_MS : 2;
    const cut = mask && S.figOn;
    draw(cut ? figureLook(look) : look || NEUTRAL, source, crop, w, h, S.scene, { mirror, aim, reveal, seed: (Math.floor(started / 66) % 97) / 97, follow: S.scene.follow, mask: cut ? mask : null, back: cut ? backOf(look) : null });
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
  // ── La galería: todos los looks guardados (diseño de tarjeta, gestos, tacto y mascota: Gemini Neon) ──
  // Una hoja que sube desde abajo y deja el visor a la vista: al tocar un look se pone en la cámara
  // y se ve en vivo arriba, sin cerrarla. Arriba de la rejilla, el look elegido: estrella a la
  // izquierda, nombre en medio, BORRAR a la derecha (lejos una de otro: un dedazo no borra un favorito).
  let sheet = null, pill = null, undoTimer = 0, sureTimer = 0, pillTimer = 0, openedWith = '';
  const html = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ink = c => 'rgb(' + fromLab(c[0], c[1], c[2]).join(',') + ')';
  const tap = (kind, x) => { if (window.flipFeel && flipFeel.tap) flipFeel.tap(kind, 'down', x); };
  // La mascota acusa recibo (una clase un momento); nunca se mueve sola.
  function mascot(cls, ms) { const b = $('deckShutter'); if (!b) return; b.classList.add(cls); setTimeout(() => b.classList.remove(cls), ms); }
  function doubleWink() { const b = $('deckShutter'); if (!b) return; b.classList.add('guino'); setTimeout(() => b.classList.remove('guino'), 90); setTimeout(() => b.classList.add('guino'), 170); setTimeout(() => b.classList.remove('guino'), 260); }
  // Qué clase de look es (su sello en la tarjeta) y con qué pinta (su franja de color).
  const kindOf = l => (l.pixel ? 'pixel' : l.screen && l.screen.type === 'dot' ? 'trama' : l.screen && l.screen.type === 'line' ? 'lineas' : l.limited ? 'cartel' : duo(l) ? 'duotono' : 'foto');
  const SEALS = {
    trama: '<circle cx="3" cy="3" r="1.6"/><circle cx="7.4" cy="3" r="1.6"/><circle cx="3" cy="7.4" r="1.6"/><circle cx="7.4" cy="7.4" r="1.6"/>',
    lineas: '<path d="M0 4.2 5 1.3M0 8 10 2.2M5 9.4 10 6.5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    pixel: '<path d="M0 6h3V3h3V0h4v4H7v3H4v3H0z"/>',
    cartel: '<path d="M0 0h6.5v6.5H0z"/><path d="M4 4h6v6H4z" opacity=".55"/>',
    duotono: '<path d="M5 0a5 5 0 0 0 0 10z"/><path d="M5 0a5 5 0 0 1 0 10z" opacity=".5"/>',
    foto: '<path d="M0.6 9.2C4.6 9.2 5.4 0.8 9.4 0.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  };
  const KIND_ORDER = ['trama', 'lineas', 'pixel', 'cartel', 'duotono', 'foto'];
  function signature(l) {
    if (l.limited) {                                                // tintas planas: bloques según lo que ocupa cada una
      const pal = l.palette.slice(0, 6), w = pal.map((_, i) => Math.max(0.12, (l.shares && l.shares[i]) || 0)), sum = w.reduce((a, b) => a + b, 0);
      let at = 0;
      return 'linear-gradient(90deg,' + pal.map((c, i) => { const from = at; at += w[i] / sum * 100; return ink(c) + ' ' + from.toFixed(1) + '% ' + (at - 0.7).toFixed(1) + '%, #0B0C14 ' + (at - 0.7).toFixed(1) + '% ' + at.toFixed(1) + '%'; }).join(',') + ')';
    }
    // color continuo: del más oscuro al más claro, con el color que la referencia le pone a cada nivel de luz
    return 'linear-gradient(90deg,' + [2, 6, 10, 14].map(k => { const r = (l.ramp && l.ramp[Math.floor(k * l.ramp.length / 16)]) || [0, 0], m = l.rampMix == null ? 1 : l.rampMix, mean = l.mean || [0, 0]; return ink([(k + 0.5) / 16, mean[0] + (r[0] - mean[0]) * Math.max(0.35, m), mean[1] + (r[1] - mean[1]) * Math.max(0.35, m)]); }).join(',') + ')';
  }
  const ORDERS = ['recientes', 'tipo', 'parecido'];
  let order = 'recientes';
  try { const o = localStorage.getItem(KEY + '.orden'); if (ORDERS.includes(o)) order = o; } catch (_) {}
  function sorted() {
    const recent = (a, b) => (!!b.fav) - (!!a.fav) || (b.at || 0) - (a.at || 0);
    const list = S.looks.slice();
    if (order === 'tipo') list.sort((a, b) => KIND_ORDER.indexOf(kindOf(a)) - KIND_ORDER.indexOf(kindOf(b)) || recent(a, b));
    else if (order === 'parecido') list.sort((a, b) => (b.score || 0) - (a.score || 0) || recent(a, b));
    else list.sort(recent);
    return list.map(l => l.id);
  }
  // El orden a la vista se fija al abrir (o al tocar el chip): marcar una estrella no manda la tarjeta
  // a otro sitio bajo el dedo; se recoloca la próxima vez.
  function arrange(fresh) {
    const ids = S.looks.map(l => l.id);
    if (fresh || !S.shown) S.shown = sorted();
    S.shown = S.shown.filter(id => ids.includes(id));
    for (const id of sorted()) if (!S.shown.includes(id)) S.shown.unshift(id);            // uno nuevo entra arriba
    if (S.undo && !S.undo.added) { /* el borrado, si vuelve, vuelve a su sitio: arrange(false) lo recoloca al restaurar */ }
  }
  function galleryPaint() {
    if (!sheet) return;
    arrange(false);
    const cur = current(), n = S.looks.length;
    const count = sheet.querySelector('#clonCuenta');
    count.textContent = n + ' / ' + MAX_LOOKS;
    count.classList.toggle('is-casi', n >= MAX_LOOKS - 2);
    sheet.classList.toggle('is-vacia', !n);
    const chip = sheet.querySelector('[data-clon="orden"]');
    chip.hidden = n < 6; chip.textContent = order.toUpperCase();
    sheet.querySelector('#clonRejilla').innerHTML = S.shown.map(id => {
      const l = S.looks.find(x => x.id === id);
      // la miniatura de la referencia; un look antiguo sin ella enseña sus tintas
      const back = l.thumb && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(l.thumb) ? 'background-image:url(' + l.thumb + ')' : 'background:linear-gradient(135deg,' + l.palette.map(ink).join(',') + ')';
      const on = !!(cur && cur.id === l.id), kind = kindOf(l);
      return `<button class="hw clon-carta${on ? ' is-on' : ''}${l.fav ? ' is-fav' : ''}" type="button" role="option" aria-selected="${on}" data-id="${html(l.id)}" data-feel="slide" aria-label="${html(l.name)}${l.fav ? ', favorito' : ''}"><i class="clon-mini" style="${back}"><svg class="clon-tipo" viewBox="0 0 10 10" aria-hidden="true" data-tipo="${kind}">${SEALS[kind]}</svg>${l.fav ? '<em class="clon-estrellita" aria-hidden="true">★</em>' : ''}</i><span class="clon-firma" style="background:${signature(l)}"></span><b>${html(l.name)}</b></button>`;
    }).join('') + (n >= MAX_LOOKS ? '<p class="clon-llena">Galería llena · el próximo look reemplaza al más viejo sin estrella.</p>' : '');
    const bar = sheet.querySelector('.clon-elegido'), name = sheet.querySelector('#clonNombre');
    bar.hidden = !cur;
    if (cur && document.activeElement !== name) name.value = cur.name;
    const star = sheet.querySelector('[data-clon="fav"]');
    star.setAttribute('aria-pressed', String(!!(cur && cur.fav))); star.classList.toggle('is-on', !!(cur && cur.fav));
    const del = sheet.querySelector('[data-clon="borrar"]'), sure = !!cur && S.sure === cur.id;
    del.textContent = sure ? '¿BORRAR?' : 'BORRAR'; del.classList.toggle('is-seguro', sure);
    sheet.querySelector('#clonDice').textContent = cur ? describe(cur) : '';
    const un = sheet.querySelector('.clon-deshacer');
    un.hidden = !S.undo;
    if (S.undo) un.querySelector('span').textContent = S.undo.added ? 'Salió «' + S.undo.look.name + '» para hacer sitio' : 'BORRADO · ' + S.undo.look.name;
  }
  // Deshacer dura seis segundos, con la galería abierta o cerrada (cerrada, en una píldora sobre el visor).
  function undoArm(ms) {
    clearTimeout(undoTimer);
    S.undoUntil = performance.now() + (ms || 6000);
    undoTimer = setTimeout(() => { S.undo = null; pillHide('deshacer'); if (sheet && !sheet.hidden) galleryPaint(); }, ms || 6000);
    if (sheet) { const line = sheet.querySelector('.clon-tiempo'); line.style.animation = 'none'; void line.offsetWidth; line.style.animation = 'clonTiempo ' + (ms || 6000) + 'ms linear forwards'; }
  }
  function undoNow(x) {
    clearTimeout(undoTimer);
    const back = restore();
    pillHide('deshacer');
    if (back) { tap('lookUndo', x); mascot('guino', 230); mascot('retroceso', 160); say('Volvió «' + back.name + '»', 2200); arrange(false); }
    if (sheet && !sheet.hidden) { galleryPaint(); const card = sheet.querySelector('.clon-carta.is-on'); if (card) { card.classList.add('vuelve'); setTimeout(() => card.classList.remove('vuelve'), 320); } }
    return back;
  }
  function removeNow(x) {
    const cur = current();
    if (!cur) return;
    if (cur.fav && S.sure !== cur.id) {                              // un favorito pide dos toques (sin diálogo)
      S.sure = cur.id; tap('stop', x);
      clearTimeout(sureTimer); sureTimer = setTimeout(() => { S.sure = ''; if (sheet && !sheet.hidden) galleryPaint(); }, 3000);
      galleryPaint();
      return;
    }
    S.sure = ''; clearTimeout(sureTimer);
    forget(cur.id);
    tap('lookTrash', x); mascot('sobresalto', 260);
    undoArm(6000);
    galleryPaint();
  }
  // La píldora sobre el visor: lo que acaba de pasar y, si acaso, una tecla.
  function pillShow(kind, text, key, ms, thumb) {
    if (!pill) return;
    clearTimeout(pillTimer);
    pill.dataset.kind = kind;
    pill.innerHTML = (thumb ? `<i style="background-image:url(${thumb})"></i>` : '<i class="clon-cara"></i>') + `<span>${html(text)}</span>` + (key ? `<button class="hw" type="button" data-pildora="${key[0]}" data-feel="${key[2] || 'key'}">${key[1]}</button>` : '');
    const view = $('display'), r = view ? view.getBoundingClientRect() : { left: 0, right: innerWidth, bottom: innerHeight * 0.6 };
    pill.style.left = Math.round(r.left + 10) + 'px'; pill.style.right = Math.round(innerWidth - r.right + 10) + 'px'; pill.style.top = Math.round(Math.max(60, r.bottom - 52)) + 'px';
    pill.hidden = false;
    pillTimer = setTimeout(() => pillHide(), ms || 5200);
  }
  function pillHide(kind) { if (pill && !pill.hidden && (!kind || pill.dataset.kind === kind)) { pill.hidden = true; clearTimeout(pillTimer); } }
  // Un look recién aprendido entra a la galería: a medio revelado la tecla de la galería da un sello.
  function entered(look) {
    const b = $('deckShutter');
    if (S.looks.length === MAX_LOOKS && !S.out) { setTimeout(doubleWink, 0); setTimeout(() => mascot('llena', 160), 260); }
    else if (b) mascot('guino', 230);
    setTimeout(() => {
      tap('lookSeat');
      for (const host of [band, row]) { const k = host && host.querySelector('[data-clon="galeria"]'); if (k) { k.classList.remove('clon-sello'); void k.offsetWidth; k.classList.add('clon-sello'); } }
    }, 500);
    if (S.out) { undoArm(6000); pillShow('deshacer', 'Salió «' + S.out.name + '» para hacer sitio', ['deshacer', 'DESHACER', 'none'], 6000); }
    else pillShow('guardado', look.name + ' · ' + (look.score == null ? '' : look.score + ' %'), ['renombrar', 'RENOMBRAR'], 5200, look.thumb);
    say(S.looks.length === MAX_LOOKS ? MAX_LOOKS + ' / ' + MAX_LOOKS + ' · galería llena' : look.name + ' · ' + describe(look), 4200);
  }
  function gallery(open, focusName) {
    if (!sheet) return false;
    const want = open == null ? sheet.hidden : !!open;
    if (want === !sheet.hidden) { if (want && focusName) sheet.querySelector('#clonNombre').focus(); return want; }
    sheet.hidden = !want;
    sheet.style.transform = '';
    document.body.classList.toggle('clon-galeria-abierta', want);
    const b = $('deckShutter');
    if (b) b.classList.toggle('hojea', want);
    if (want) {
      openedWith = current() ? current().id : '';
      pillHide();
      syncVariants(); arrange(true); galleryPaint();
      const on = sheet.querySelector('.clon-carta.is-on'); if (on) on.scrollIntoView({ block: 'nearest' });
      if (focusName) setTimeout(() => sheet.querySelector('#clonNombre').focus(), 60);
    } else {
      sheet.classList.remove('escribiendo'); S.sure = '';
      if (document.activeElement && sheet.contains(document.activeElement)) document.activeElement.blur();
      if ((current() ? current().id : '') !== openedWith) mascot('guino', 230);            // se llevó otro look: acusa recibo
      // lo borrado sigue pudiéndose deshacer los segundos que le queden
      if (S.undo) pillShow('deshacer', S.undo.added ? 'Salió «' + S.undo.look.name + '»' : 'BORRADO · ' + S.undo.look.name, ['deshacer', 'DESHACER', 'none'], Math.max(800, (S.undoUntil || 0) - performance.now()));
    }
    paint();
    return want;
  }
  function galleryBuild() {
    sheet = flipShell.el('div', { class: 'clon-galeria', id: 'clonGaleria', role: 'dialog', 'aria-label': 'Galería de looks', hidden: '' }, `
      <header class="clon-cabeza"><i class="clon-asa" aria-hidden="true"></i><small>LOOKS</small><b id="clonCuenta"></b><button class="hw clon-tecla clon-orden" type="button" data-clon="orden" data-feel="key" aria-label="Cambiar el orden" hidden></button><button class="hw clon-tecla" type="button" data-clon="cerrar" data-feel="key">LISTO</button></header>
      <div class="clon-elegido"><button class="hw clon-tecla clon-estrella" type="button" data-clon="fav" data-feel="switch" aria-pressed="false" aria-label="Favorito">★</button><input id="clonNombre" type="text" maxlength="18" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done" aria-label="Nombre del look"><button class="hw clon-tecla clon-borra" type="button" data-clon="borrar" data-feel="none">BORRAR</button><p id="clonDice"></p></div>
      <div class="clon-rejilla" id="clonRejilla" role="listbox" aria-label="Looks guardados"></div>
      <div class="clon-vacio"><i class="clon-cara" aria-hidden="true"></i><b>TODAVÍA NO HAY LOOKS</b><p>Apunta a un cartel, una portada o abre una foto. Aquí caben hasta ${MAX_LOOKS} cámaras tuyas.</p><div><button class="hw clon-tecla is-acento" type="button" data-clon="copiar-camara" data-feel="primary">COPIAR CON CÁMARA</button><button class="hw clon-tecla" type="button" data-clon="abrir-foto" data-feel="key">ABRIR FOTO</button></div></div>
      <div class="clon-deshacer" hidden><i class="clon-cara" aria-hidden="true"></i><span></span><button class="hw clon-tecla" type="button" data-clon="deshacer" data-feel="none">DESHACER</button><u class="clon-tiempo" aria-hidden="true"></u></div>`);
    sheet.hidden = true;
    document.body.appendChild(sheet);
    pill = flipShell.el('div', { class: 'clon-pildora', id: 'clonPildora', role: 'status', hidden: '' }, '');
    pill.hidden = true;
    document.body.appendChild(pill);
    pill.addEventListener('click', event => {
      const key = event.target.closest('[data-pildora]');
      if (!key) return;
      if (key.dataset.pildora === 'deshacer') undoNow(event.clientX);
      else if (key.dataset.pildora === 'renombrar') { pillHide(); gallery(true, true); }
    });
    const name = sheet.querySelector('#clonNombre');
    sheet.addEventListener('click', event => {
      const card = event.target.closest('.clon-carta'), act = event.target.closest('[data-clon]'), cur = current();
      if (card) { S.sure = ''; use(card.dataset.id); galleryPaint(); return; }
      if (!act) return;
      const what = act.dataset.clon;
      if (what === 'cerrar') gallery(false);
      else if (what === 'orden') { order = ORDERS[(ORDERS.indexOf(order) + 1) % ORDERS.length]; try { localStorage.setItem(KEY + '.orden', order); } catch (_) {} arrange(true); galleryPaint(); sheet.querySelector('#clonRejilla').scrollTop = 0; }
      else if (what === 'fav' && cur) { fav(cur.id); galleryPaint(); }
      else if (what === 'borrar') removeNow(event.clientX);
      else if (what === 'deshacer') undoNow(event.clientX);
      else if (what === 'copiar-camara') { gallery(false); S.aim = true; paint(); say('Encuadra la imagen que quieras copiar y toca CAPTURAR', 4200); }
      else if (what === 'abrir-foto') { gallery(false); openKey(); }
    });
    const commit = () => { const cur = current(); if (cur) { const before = cur.name, set = rename(cur.id, name.value); name.value = set || cur.name; if (set && set !== before) { sheet.classList.add('nombrado'); setTimeout(() => sheet.classList.remove('nombrado'), 160); } } galleryPaint(); };
    name.addEventListener('focus', () => { sheet.classList.add('escribiendo'); name.select(); tap('soft'); });
    name.addEventListener('blur', () => { sheet.classList.remove('escribiendo'); commit(); });
    name.addEventListener('input', () => { const at = name.selectionStart, up = name.value.toUpperCase(); if (up !== name.value) { name.value = up; try { name.setSelectionRange(at, at); } catch (_) {} } });
    name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); tap('key'); name.blur(); } else if (event.key === 'Escape') { const cur = current(); name.value = cur ? cur.name : ''; name.blur(); } event.stopPropagation(); });
    addEventListener('keydown', event => { if (event.key === 'Escape' && !sheet.hidden) gallery(false); });
    // tocar fuera (el visor) la cierra
    addEventListener('pointerdown', event => { if (!sheet.hidden && !event.target.closest('#clonGaleria, #clonPildora, [data-clon="galeria"]')) { tap('soft', event.clientX); gallery(false); } }, true);
    // y deslizar la cabecera hacia abajo: la hoja sigue al dedo y, pasado un tramo, se va
    const head = sheet.querySelector('.clon-cabeza');
    let pull = null;
    head.addEventListener('pointerdown', event => { if (event.target.closest('button')) return; pull = { y: event.clientY, t: performance.now(), id: event.pointerId }; try { head.setPointerCapture(event.pointerId); } catch (_) {} });
    head.addEventListener('pointermove', event => { if (!pull || event.pointerId !== pull.id) return; const dy = Math.max(0, event.clientY - pull.y); sheet.style.transform = dy ? 'translateY(' + dy + 'px)' : ''; });
    const drop = event => { if (!pull) return; const dy = Math.max(0, event.clientY - pull.y), v = dy / Math.max(1, performance.now() - pull.t); pull = null; if (event.type === 'pointerup' && (dy > 48 || v > 0.45)) { tap('stop', event.clientX); gallery(false); } else sheet.style.transform = ''; };
    head.addEventListener('pointerup', drop); head.addEventListener('pointercancel', drop);
    // al disparar, la píldora de «guardado» se quita de en medio
    const shutter = $('deckShutter'); if (shutter) shutter.addEventListener('pointerdown', () => pillHide('guardado'));
  }
  function paint() {
    const on = mine();
    document.body.classList.toggle('con-rapidas-clon', on);
    if (!on && S.aim) S.aim = false;
    if (!on && sheet && !sheet.hidden) gallery(false);
    const label = S.busy ? 'MIRANDO…' : S.aim || (on && !current()) ? 'CAPTURAR' : 'COPIAR';
    for (const host of [band, row]) {
      if (!host) continue;
      host.hidden = !on;
      const key = host.querySelector('[data-clon="copiar"]');
      key.lastChild.textContent = label;
      key.classList.toggle('is-on', S.aim || (on && !current()));
      const shelf = host.querySelector('[data-clon="galeria"]');
      shelf.querySelector('em').textContent = String(S.looks.length);
      shelf.classList.toggle('is-on', !!sheet && !sheet.hidden); shelf.classList.toggle('tiene', S.looks.length > 0);
      shelf.setAttribute('aria-label', 'Galería: ' + S.looks.length + ' looks guardados');
      // FIGURA solo existe en los looks de fondo liso (una figura sobre negro, sobre blanco, sobre un color)
      const cut = host.querySelector('[data-clon="figura"]'), cur = current();
      cut.hidden = !(on && cur && backOf(cur) && !S.aim);
      cut.classList.toggle('is-on', !!(cur && cur.figure)); cut.setAttribute('aria-pressed', cur && cur.figure ? 'true' : 'false');
      cut.setAttribute('aria-label', 'Figura: la persona toma el look y lo demás se va al fondo');
    }
    if (sheet && !sheet.hidden) galleryPaint();
  }
  function mount() {
    if (!window.flipShell || band) return;
    const keys = '<button class="hw KEY" type="button" data-clon="copiar"><span>COPIAR</span></button><button class="hw KEY" type="button" data-clon="abrir"><span>ABRIR</span></button><button class="hw KEY clon-abre-galeria" type="button" data-clon="galeria" data-feel="drawerOpen" aria-haspopup="dialog"><span>LOOKS</span><em>0</em></button><button class="hw KEY clon-figura" type="button" data-clon="figura" data-feel="switch" aria-pressed="false" hidden><span>FIGURA</span></button>';
    const head = document.querySelector('.si-banda-cabeza'), tray = document.querySelector('#camDeck .deck-groups') || document.querySelector('#camDeck .deck-looks');
    if (head) { band = flipShell.el('div', { class: 'si-rapidas clon-rapidas', role: 'group', 'aria-label': 'Clonar un look' }, keys.replace(/KEY/g, 'si-chip')); head.insertBefore(band, head.querySelector('.si-abrir')); }
    if (tray) { row = flipShell.el('div', { class: 'deck-variants reaccion-teclas clon-teclas', role: 'group', 'aria-label': 'Clonar un look' }, keys.replace(/KEY/g, 'hw-keycap')); tray.before(row); }
    galleryBuild();
    for (const host of [band, row]) {
      if (!host) continue;
      host.querySelector('[data-clon="copiar"]').addEventListener('click', copyKey);
      host.querySelector('[data-clon="abrir"]').addEventListener('click', openKey);
      host.querySelector('[data-clon="galeria"]').addEventListener('click', () => gallery());
      host.querySelector('[data-clon="figura"]').addEventListener('click', figureKey);
    }
    for (const id of ['deckLooks', 'deckVariants']) { const node = $(id); if (node) new MutationObserver(() => queueMicrotask(() => { if (mine() && !current() && S.looks.length) { camVariant = S.looks[S.looks.length - 1].id; apply(); } paint(); })).observe(node, { subtree: true, attributes: true, attributeFilter: ['class'] }); }
    // Al abrir FLIP los ajustes se leen antes de que este archivo cargue, cuando CLON aún no tiene sus
    // looks: el que estaba puesto no pasaba la comprobación y la cámara arrancaba apuntando. Se repone aquí.
    if (mine() && !current() && S.looks.length) {
      let saved = '';
      try { saved = JSON.parse(localStorage.getItem('flipSettings') || '{}').camVariant || ''; } catch (_) {}
      camVariant = S.looks.some(l => l.id === saved) ? saved : S.looks[S.looks.length - 1].id;
      syncVariants(); apply();
    } else syncVariants();                   // ya se sabe qué look estaba puesto: que quede a la mano
    paint();
  }
  if (document.readyState === 'complete') mount(); else addEventListener('load', mount);

  window.renderClon = renderClon;
  window.flipClon = {
    analyze, describe, nameOf, release, _fit: fit, _transport: transport, _scene: sceneOf, _tone: (look, hist, amount) => Array.from(toneCurve(look, hist, amount == null ? 0.8 : amount, new Uint8Array(256))),
    // (pruebas) pone un look sobre una imagen suelta y lo deja en «out»
    // (con «mask» —{ data, width, height }, 1 donde hay persona— y un look de fondo liso, como con la
    //  tecla FIGURA. Si la máscara trae «faces», se confirma como en vivo: solo lo que toca una cara)
    _render(look, source, out, mask) {
      if (!ensureGl()) return false;
      surface(probe, 32, 24); probe.ctx.drawImage(source, 0, 0, 32, 24);
      if (mask) { FIG.seq = -1; FIG.last = null; mask = mask.faces === undefined ? { data: feather(Float32Array.from(mask.data), mask.width, mask.height), width: mask.width, height: mask.height } : confirmFigure({ ...mask, seq: null }, performance.now()); }
      const all = probe.ctx.getImageData(0, 0, 32, 24).data, own = mask && backOf(look) ? figurePixels(all, 32, 24, mask) : null;
      const scene = own ? sceneOf(own.data, own.count) : sceneOf(all, 32 * 24); scene.version = Math.random();
      G.look = null;
      draw(own ? figureLook(look) : look, source, [0, 0, 1, 1], out.width, out.height, scene, { mirror: false, aim: false, reveal: 2, seed: 0.3, mask: own ? mask : null, back: own ? backOf(look) : null });
      out.getContext('2d').drawImage(G.canvas, 0, 0, out.width, out.height);
      return true;
    },
    learn: (source, w, h, region) => learn(source, w || source.width, h || source.height, region),
    adopt: (source, w, h, region) => adopt(source, w || source.width, h || source.height, region),
    keep, forget, restore, rename, fav, use, gallery, capture, MAX: MAX_LOOKS,
    looks: () => JSON.parse(JSON.stringify(S.looks)),
    aim(on) { if (on != null) { S.aim = !!on; paint(); } return S.aim; },
    state: () => ({ looks: S.looks.length, aim: S.aim, busy: S.busy, frame: S.frame, ms: +S.ms.toFixed(2), gl: !!G.gl, failed: G.failed, lost: G.lost, current: current() ? current().id : null, figure: current() && backOf(current()) ? { on: !!current().figure, cut: !!S.figOn, share: S.figShare || 0, faces: typeof flipSilhouette !== 'undefined' ? flipSilhouette.status().faces : '' } : null }),
  };
})();
