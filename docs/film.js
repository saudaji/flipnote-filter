// FLIP · FILM — emulación fotoquímica con base física.
//
// Una película no es un filtro de color: se EXPONE y se REVELA. Aquí la imagen recorre lo mismo que
// en un rollo y una ampliadora, y de ahí salen juntos el color, el contraste, el grano y el halo:
//
//   escena (RGB lineal) ─► A · exposición de cada capa (la luz, vista por la sensibilidad espectral
//                              de la película; todo lo espectral se integra antes, una vez)
//                        ─► B · halación: la luz que rebota en la base vuelve, sobre todo a la capa roja
//                              (en luz lineal y antes de las curvas: solo florecen las luces de verdad)
//                        ─► C · revelado: curva característica por capa (suma de tres sub-emulsiones)
//                              y acopladores DIR (cada capa frena a sus vecinas y a su alrededor)
//                        ─► D · grano: estadística de los cristales revelados (depende de la densidad
//                              y del formato; nadie le pone «cantidad»)
//                        ─► E · copia: la ampliadora centra el negativo y el papel lo vuelve positivo
//
// Diseño: FILM-viabilidad-y-arquitectura (Claude) con la auditoría de Gemini Neon. Los parámetros de
// cada película son de ARRANQUE (Neon los dio citando fichas públicas; no están cotejados uno a uno):
// son películas propias, descritas por lo que son, sin nombres ni marcas de nadie.
//
// Este archivo tiene dos mitades: la física (pura, sin navegador: se prueba con Node) y el revelado
// en WebGL 2 con la cámara de FLIP.
(function () {
  'use strict';
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // ══ LA FÍSICA ══════════════════════════════════════════════════════════════════════════════════
  const physics = (() => {
    // El espectro visible, cada 5 nm.
    const L0 = 380, STEP = 5, N = 69;                              // 380 … 720 nm
    const LAM = Float64Array.from({ length: N }, (_, i) => L0 + i * STEP);
    const spec = fn => Float64Array.from(LAM, fn);
    // Gaussiana de dos anchos (uno a cada lado del pico).
    const lobe = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
    const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    // Funciones de igualación de color CIE 1931 (ajuste analítico de Wyman, Sloan y Shirley, 2013).
    const CMF = [
      spec(l => 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2)),
      spec(l => 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1)),
      spec(l => 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8)),
    ];
    const dot = (a, b, c) => { let s = 0; if (c) for (let i = 0; i < N; i++) s += a[i] * b[i] * c[i]; else for (let i = 0; i < N; i++) s += a[i] * b[i]; return s; };
    // Luz de un cuerpo negro (Planck) a T kelvin, con la misma luminancia sea cual sea T: al comparar
    // dos luces solo cuenta su color.
    const planck = T => { const raw = spec(l => { const x = l * 1e-9; return 1e-30 / (Math.pow(x, 5) * (Math.exp(0.014388 / (x * T)) - 1)); }), y = dot(raw, CMF[1]); return raw.map(v => v / y); };
    const XYZ2RGB = [[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560], [0.0556434, -0.2040259, 1.0572252]];
    const mul3 = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
    const inv3 = m => {
      const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
      const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
      return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
    };
    const mulM = (a, b) => a.map(row => [0, 1, 2].map(j => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
    // Un espectro, visto: RGB lineal de pantalla con el blanco de «white» (un espectro de luz) en (1, 1, 1).
    const viewer = white => {
      const w = mul3(XYZ2RGB, [dot(white, CMF[0]), dot(white, CMF[1]), dot(white, CMF[2])]);
      return light => { const c = mul3(XYZ2RGB, [dot(light, CMF[0]), dot(light, CMF[1]), dot(light, CMF[2])]); return [c[0] / w[0], c[1] / w[1], c[2] / w[2]]; };
    };

    // ── De RGB a espectro ──
    // Una cámara RGB ya perdió el espectro; se reconstruye uno PLAUSIBLE: tres bases suaves que suman
    // uno (el blanco es un espectro plano) y que, vistas, devuelven exactamente el color de partida.
    // Es lineal, así que la exposición de cada capa es una matriz de 3 × 3 (sin tablas por punto).
    const D65 = planck(6504), sB = spec(l => 1 / (1 + Math.exp((l - 492) / 11))), sR = spec(l => 1 / (1 + Math.exp(-(l - 588) / 11)));
    const BASES = [sR, spec((l, i) => 1 - sB[i] - sR[i]), sB];        // rojo, verde, azul
    const see65 = viewer(D65);
    const seen = BASES.map(b => see65(spec((l, i) => b[i] * D65[i])));  // el color de cada base, bajo luz de día
    const TO_BASES = inv3([[seen[0][0], seen[1][0], seen[2][0]], [seen[0][1], seen[1][1], seen[2][1]], [seen[0][2], seen[1][2], seen[2][2]]]);
    const upsample = rgb => { const w = mul3(TO_BASES, rgb); return spec((l, i) => w[0] * BASES[0][i] + w[1] * BASES[1][i] + w[2] * BASES[2][i]); };

    // ── Piezas con las que se describe una emulsión ──
    // Sensibilidad espectral de una capa: log10 S = A − (λ − λ0)² / 2σ², con un σ a cada lado.
    // «lea»: la capa está debajo del filtro amarillo y casi no ve el azul.
    const sens = (l0, sl, sr, A = 0, lea = false) => spec(l => Math.pow(10, A - Math.pow(l - l0, 2) / (2 * Math.pow(l < l0 ? sl : sr, 2)) - (lea ? 2.2 * (1 - smooth(470, 505, l)) : 0)));
    // Densidad espectral de un tinte: su pico y sus absorciones de más (las que la máscara naranja corrige).
    const dye = (lp, w, extra = []) => spec(l => Math.exp(-Math.pow(l - lp, 2) / (2 * w * w)) + extra.reduce((s, [l2, w2, a2]) => s + a2 * Math.exp(-Math.pow(l - l2, 2) / (2 * w2 * w2)), 0));

    // ── Las películas (parámetros de arranque) ──
    // Orden de capas en todo el archivo: [roja, verde, azul] = la que ve el rojo (tinte cian), el verde
    // (magenta) y el azul (amarillo).
    const NEG_EXTRA = [[[440, 30, 0.14], [540, 35, 0.18]], [[435, 26, 0.22]], []];
    const NEG_DYES = [dye(665, 48, NEG_EXTRA[0]), dye(542, 30, NEG_EXTRA[1]), dye(442, 34)];
    // La máscara naranja: el acoplador de cada capa es de color —absorbe justo donde su tinte absorbe de
    // más— y se gasta al formarse el tinte. Así la absorción de más queda casi constante (el velo
    // naranja) en vez de ensuciar los colores. «MASK» es qué parte de esa absorción alcanza a cancelar.
    const NEG_MASK = NEG_EXTRA.map(extra => dye(0, 1, extra)), MASK = 0.92;
    const SUB = { share: [0.28, 0.42, 0.30], shift: [-0.75, 0, 0.75] };       // sub-emulsión rápida, media y lenta
    const STOCKS = {
      RETRATO400: {
        name: 'RETRATO 400', hint: 'RETRATO 400 · negativo de color para todos los días: piel limpia y mucho margen en las luces.',
        kind: 'negative', balance: 5500,
        sens: [sens(642, 36, 18, -0.04, true), sens(548, 34, 24, 0, true), sens(445, 32, 24, 0.05)],
        dmin: [0.22, 0.58, 0.88], dmax: [2.05, 2.55, 2.95], gamma: [0.58, 0.62, 0.66], gray: -0.62,
        dir: [[0.14, 0.26, 0], [0.72, 0.14, 0.41], [0, 0.42, 0.12]], dirRadius: 18,
        halation: { radius: 210, k: [0.035, 0.008, 0.001] },
        grain: { d: [0.95, 0.58, 0.34], rho: [0.9, 2.8, 5.2], sat: 0.5 },
      },
      CALIDO200: {
        name: 'CÁLIDO 200', hint: 'CÁLIDO 200 · negativo de calle y sol: más color, más contraste y dorados cálidos.',
        kind: 'negative', balance: 5500,
        sens: [sens(645, 32, 16, 0.02, true), sens(546, 30, 22, 0, true), sens(442, 30, 22, 0.08)],
        dmin: [0.24, 0.62, 0.94], dmax: [2.20, 2.75, 3.15], gamma: [0.66, 0.70, 0.74], gray: -0.55,
        dir: [[0.16, 0.21, 0], [0.72, 0.16, 0.45], [0, 0.57, 0.15]], dirRadius: 20,
        halation: { radius: 220, k: [0.045, 0.010, 0.002] },
        grain: { d: [1.05, 0.65, 0.38], rho: [0.75, 2.3, 4.4], sat: 0.48 },
        warm: 0.035,                                                   // su copia tira a cálida: un punto más de luz azul en la ampliadora (más tinte amarillo en el papel)
      },
      CINE500T: {
        name: 'CINE 500T', hint: 'CINE 500T · película de cine para luz de foco, sin capa antihalo: las luces sangran en rojo.',
        kind: 'negative', balance: 3200,
        sens: [sens(646, 35, 18, -0.18, true), sens(546, 32, 24, 0.08, true), sens(445, 30, 24, 0.42)],
        dmin: [0.20, 0.56, 0.86], dmax: [1.95, 2.40, 2.75], gamma: [0.62, 0.65, 0.68], gray: -0.66,
        dir: [[0.14, 0.20, 0], [0.72, 0.14, 0.43], [0, 0.37, 0.12]], dirRadius: 18,
        halation: { radius: 235, k: [0.28, 0.07, 0.01] },
        grain: { d: [1.10, 0.64, 0.30], rho: [0.7, 2.5, 6.4], sat: 0.52 },
      },
    };
    // El papel de copia (color, contraste normal).
    const PAPER = {
      sens: [sens(692, 26, 20, -0.2), sens(545, 24, 18, 0), sens(472, 22, 18, 0.25)],
      dyes: [dye(658, 44, [[540, 34, 0.11]]), dye(550, 30, [[435, 25, 0.12]]), dye(445, 36)],
      dmin: 0.08, dmax: [2.25, 2.30, 2.20], gamma: [2.15, 2.25, 2.10],
      toe: 1.5, shoulder: 1.4,                                         // qué tan cortos son el pie y el hombro de su curva (1 = logística pura)
    };
    const PAPERS = [{ name: 'SUAVE', grade: 0.84 }, { name: 'NORMAL', grade: 1 }, { name: 'DURO', grade: 1.2 }];
    const FORMATS = [{ name: '½ CUADRO', mm: 24 }, { name: '35 MM', mm: 36 }, { name: '6 × 7', mm: 70 }, { name: '4 × 5', mm: 127 }];

    // ── La curva característica de una capa: densidad contra log10 de la exposición ──
    // Tres sub-emulsiones logísticas; «k» se busca para que la pendiente en el centro sea la gamma pedida.
    function layerCurve(dmin, dmax, gamma, centre) {
      const range = dmax - dmin, parts = k => x => { let s = 0; for (let j = 0; j < 3; j++) s += SUB.share[j] / (1 + Math.exp(-k * (x - centre - SUB.shift[j]))); return s; };
      let lo = 0.4, hi = 14;
      for (let it = 0; it < 40; it++) { const k = 0.5 * (lo + hi), f = parts(k), slope = range * (f(centre + 0.02) - f(centre - 0.02)) / 0.04; if (slope < gamma) lo = k; else hi = k; }
      const k = 0.5 * (lo + hi);
      return {
        k, centre, dmin, range,
        D: x => dmin + range * parts(k)(x),
        // qué parte de cada sub-emulsión se revela (para el grano)
        p: x => SUB.shift.map(s => 1 / (1 + Math.exp(-k * (x - centre - s)))),
      };
    }

    // ── Preparar una película: todo lo que el revelado necesita, ya integrado ──
    // options: { push: −1…2 (empuje), scene: kelvin de la luz de la escena (por defecto, la de la película) }
    function prepare(key, options = {}) {
      const stock = STOCKS[key];
      if (!stock) throw new Error('FILM: no conozco la película ' + key);
      const push = clamp(options.push || 0, -1, 2);
      const light = planck(options.scene || stock.balance), ref = planck(stock.balance);
      // A · la matriz de exposición: lo que cada capa recibe de cada primario, con el blanco en (1, 1, 1)
      // bajo la luz para la que la película está equilibrada.
      const expose = stock.sens.map(s => { const white = dot(ref, s); return BASES.map(b => dot(b, light, s) / white); });
      const E = mulM(expose, TO_BASES);
      // C · las curvas. El empuje (revelar de más una película expuesta de menos) sube la pendiente,
      // gana algo de sensibilidad y levanta el velo.
      const centre = stock.gray;                                       // log10 H del centro de la curva, con el gris medio en 0
      const curves = [0, 1, 2].map(c => layerCurve(stock.dmin[c] + 0.03 * Math.max(0, push), stock.dmax[c], stock.gamma[c] * (1 + 0.16 * push), -centre - 0.18 * push));
      // El gris medio expuesto con «ev» pasos de más o de menos, y empujado: su densidad en cada capa.
      const grayAt = ev => curves.map(cv => cv.D(0.30103 * (ev - push)));
      return { key, stock, push, E, curves, grayAt };
    }

    // ── La copia: del negativo al positivo, como tabla ──
    // Para cada terna de densidades del negativo (por encima de su mínimo, de 0 a 1 de su recorrido):
    // su transmisión espectral (tintes + máscara naranja, que se gasta al formarse el tinte), la luz de
    // la ampliadora a través de él, la exposición de cada capa del papel, la curva del papel, sus
    // tintes, y lo que refleja bajo luz de día. Las luces de la ampliadora se ajustan para que el gris
    // medio del negativo salga gris medio en el papel.
    function printTable(film, size = 32, grade = 1) {
      // «grade»: el grado del papel (su contraste): 1 es el normal; menos, suave; más, duro.
      const { stock, curves } = film, lamp = planck(3200), see = viewer(D65), pgamma = PAPER.gamma.map(g => g * grade);
      // La curva del papel: una logística con el pie acortado (el papel real pasa de blanco a gris en
      // poco recorrido; con una logística pura el blanco de la escena se quedaba en gris claro).
      // Su pendiente (la «gamma» del papel) se mide donde se trabaja: en el gris medio.
      const target = 0.745 - PAPER.dmin;                                 // el gris medio en el papel refleja el 18 %
      const paper = [0, 1, 2].map(k => {
        const range = PAPER.dmax[k] - PAPER.dmin, shape = (kk, x) => range * (1 - Math.pow(1 - Math.pow(1 / (1 + Math.exp(-kk * x)), PAPER.toe), PAPER.shoulder));
        const slopeAtGray = kk => { let a = -6, b = 6; for (let i = 0; i < 50; i++) { const m = 0.5 * (a + b); if (shape(kk, m) < target) a = m; else b = m; } const x = 0.5 * (a + b); return (shape(kk, x + 0.01) - shape(kk, x - 0.01)) / 0.02; };
        let lo = 0.5, hi = 20;
        for (let i = 0; i < 40; i++) { const kk = 0.5 * (lo + hi); if (slopeAtGray(kk) < pgamma[k]) lo = kk; else hi = kk; }
        const kk = 0.5 * (lo + hi);
        return { range, D: x => shape(kk, x) };
      });
      const grayN = film.grayAt(0).map((d, c) => (d - curves[c].dmin) / curves[c].range);
      const white = see(spec((l, i) => D65[i]));                          // el papel sin tinte es el blanco de pantalla
      // «gain»: cuánto pesa cada tinte del negativo para el papel (su densidad de copia, que no es la de
      // la ficha). «offset»: las luces de la ampliadora. Se ajustan los dos para que la escala de grises
      // de la escena salga gris en el papel de punta a punta, con el gris medio en el 18 %.
      const gain = [1, 1, 1], offset = [0, 0, 0];
      let base = [1, 1, 1];
      const through = n => spec((l, i) => {                              // n: densidad de cada capa, de 0 a 1 de su recorrido
        let d = 0.06;
        for (let c = 0; c < 3; c++) d += curves[c].range * gain[c] * (n[c] * NEG_DYES[c][i] + MASK * (1 - n[c]) * NEG_MASK[c][i]);
        return Math.pow(10, -d);
      });
      const print = nn => {
        const T = through(nn), dens = [0, 1, 2].map(k => paper[k].D(Math.log10(dot(lamp, T, PAPER.sens[k]) / base[k]) + offset[k]));
        const rgb = see(spec((l, i) => D65[i] * Math.pow(10, -(dens[0] * PAPER.dyes[0][i] + dens[1] * PAPER.dyes[1][i] + dens[2] * PAPER.dyes[2][i]))));
        return [rgb[0] / white[0], rgb[1] / white[1], rgb[2] / white[2]];
      };
      const nAt = ev => film.grayAt(ev).map((d, c) => (d - curves[c].dmin) / curves[c].range);
      // (las densidades de la ficha ya incluyen la máscara: el contraste de la copia tiene que ser el de
      //  la película —su gamma— por el del papel, algo rebajado por la luz parásita)
      const lo = nAt(-1), hi = nAt(1), contrast = 0.92 * (1 + 0.16 * film.push) * (stock.gamma[0] + stock.gamma[1] + stock.gamma[2]) / 3 * (pgamma[0] + pgamma[1] + pgamma[2]) / 3;
      for (let it = 0; it < 90; it++) {
        base = PAPER.sens.map(sn => dot(lamp, through(grayN), sn));
        const g = print(grayN);
        // más luz en una capa del papel → más tinte → menos de ese color en la copia
        for (let k = 0; k < 3; k++) offset[k] += 0.6 * Math.log10(Math.max(1e-4, g[k]) / 0.18) / pgamma[k];
        if (it % 2) {
          const a = print(lo), z = print(hi);
          for (let k = 0; k < 3; k++) { const slope = Math.log10(Math.max(1e-4, z[k]) / Math.max(1e-4, a[k])) / 0.60206; gain[k] = clamp(gain[k] * Math.pow(contrast / Math.max(0.05, slope), 0.5), 0.4, 4); }
        }
      }
      if (stock.warm) offset[2] += stock.warm;
      const out = new Uint8Array(size * size * size * 4), n = [0, 0, 0];
      const enc = v => Math.round(255 * (v <= 0 ? 0 : v >= 1 ? 1 : v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
      for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
        n[0] = r / (size - 1); n[1] = g / (size - 1); n[2] = b / (size - 1);
        const rgb = print(n), o = 4 * ((b * size + g) * size + r);
        out[o] = enc(rgb[0]); out[o + 1] = enc(rgb[1]); out[o + 2] = enc(rgb[2]); out[o + 3] = 255;
      }
      return { size, data: out, print, grayN, gain, offset };
    }

    // ── Tablas de una dimensión para el sombreador ──
    // Para log10 H entre X0 y X1 (con el gris medio en 0): la densidad de cada capa (de 0 a 1 de su
    // recorrido) y la desviación de su grano, por micra de lado del punto.
    const X0 = -4, X1 = 3.5, XN = 1024;
    function curveTable(film) {
      const { stock, curves, push } = film, out = new Float32Array(XN * 4), noise = new Float32Array(XN * 4);
      for (let i = 0; i < XN; i++) {
        const x = X0 + (X1 - X0) * i / (XN - 1);
        for (let c = 0; c < 3; c++) {
          const cv = curves[c];
          out[i * 4 + c] = (cv.D(x) - cv.dmin) / cv.range;
          // Grano: los cristales revelados de cada sub-emulsión siguen una ley de Poisson (su varianza
          // es su media), frenada por el solape de las nubes de tinte. La capa azul lleva cristales
          // más grandes y menos numerosos; la roja, algo más grandes. Empujar agranda el grano.
          const p = cv.p(x), size = c === 2 ? 0.65 : c === 0 ? 0.92 : 1;
          let v = 0;
          for (let j = 0; j < 3; j++) v += Math.pow(cv.range * SUB.share[j], 2) * p[j] * (1 - stock.grain.sat * p[j]) / (stock.grain.rho[j] * size);
          noise[i * 4 + c] = Math.sqrt(v * (1 + 0.8 * Math.max(0, push))) / cv.range;                 // en unidades de «n» (0…1 del recorrido), por micra
        }
        out[i * 4 + 3] = 1; noise[i * 4 + 3] = 1;
      }
      return { x0: X0, x1: X1, n: XN, density: out, noise };
    }

    // El revelado de UN punto, en JavaScript y sin atajos: la referencia contra la que se mide el
    // sombreador. rgb lineal con el gris medio en 0,18. Devuelve densidades y la copia (RGB lineal).
    function develop(film, table, rgb, ev = 0) {
      const gain = Math.pow(2, ev - film.push) / 0.18, H = mul3(film.E, rgb).map(v => Math.max(1e-6, v * gain));
      const x = H.map(v => Math.log10(v));
      // El freno entre capas. La curva de la ficha de cada capa ya trae el freno de un gris (las tres
      // capas con la misma exposición que ella); lo que se añade es la diferencia: cuánto más (o menos)
      // inhibidor sueltan las otras capas por estar expuestas distinto. Por eso un gris no cambia y
      // un color gana pureza.
      const d = (j, v) => film.curves[j].D(v) - film.curves[j].dmin;
      const eff = x.map((v, c) => v - film.stock.dir[c].reduce((s, m, j) => s + m * (d(j, x[j]) - d(j, v)), 0));
      const D = eff.map((v, c) => film.curves[c].D(v));
      const shift = film.grayAt(ev).map((d, c) => (d - film.grayAt(0)[c]) / film.curves[c].range);
      const n = D.map((d, c) => clamp((d - film.curves[c].dmin) / film.curves[c].range - shift[c], 0, 1));
      return { H, D, n, print: table ? table.print(n) : null };
    }

    return { LAM, STOCKS, PAPER, PAPERS, FORMATS, SUB, X0, X1, XN, prepare, printTable, curveTable, develop, upsample, planck, viewer, D65, clamp };
  })();

  if (typeof module !== 'undefined' && module.exports) { module.exports = physics; return; }
  // Este mismo archivo, cargado como hilo aparte, solo calcula la tabla de copia (es lo único lento:
  // medio segundo largo en un teléfono) para que cambiar de película no detenga la cámara.
  if (typeof window === 'undefined') {
    self.onmessage = event => {
      const { id, key, push, grade } = event.data, table = physics.printTable(physics.prepare(key, { push }), 32, grade);
      self.postMessage({ id, data: table.data }, [table.data.buffer]);
    };
    return;
  }
  window.flipFilmPhysics = physics;

  // ══ EL REVELADO, EN LA GPU ═════════════════════════════════════════════════════════════════════
  // Cinco pasos (WebGL 2, con destinos de media precisión flotante):
  //   1 · exponer: la cámara, a luz lineal, por la matriz de la película            (tamaño completo)
  //   2 · halación: esa exposición, desenfocada al radio del rebote en la base      (reducida)
  //   3 · primer revelado: densidad de cada capa                                    (a la mitad)
  //   4 · el inhibidor se difunde                                                   (a la mitad)
  //   5 · revelado final (con el freno de las capas vecinas), grano, ampliadora y papel
  // Si el teléfono no da destinos flotantes, queda el paso 5 solo, sin halación ni difusión.
  const $ = id => document.getElementById(id);
  const KEY = 'flip.film';
  const VERT = `#version 300 es
    in vec2 aPos; out vec2 vUv;
    void main() { vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;
  const HEAD = `#version 300 es
    precision highp float; precision highp sampler3D;
    in vec2 vUv; out vec4 o;
    uniform sampler2D uCurves; uniform vec2 uX;                    // tablas de la película; uX = (x0, 1/(x1 − x0))
    vec3 lookup(vec3 x, float row) { vec3 t = clamp((x - uX.x) * uX.y, 0., 1.) * (1023. / 1024.) + .5 / 1024.; return vec3(texture(uCurves, vec2(t.r, row)).r, texture(uCurves, vec2(t.g, row)).g, texture(uCurves, vec2(t.b, row)).b); }
    vec3 curve(vec3 x) { return lookup(x, .25); }
    vec3 curveAt(float x) { return texture(uCurves, vec2(clamp((x - uX.x) * uX.y, 0., 1.) * (1023. / 1024.) + .5 / 1024., .25)).rgb; }   // las tres capas con una misma exposición
    vec3 log10v(vec3 v) { return log(max(v, vec3(1e-6))) * .4342944819; }
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }`;
  const EXPOSE = `
    uniform sampler2D uSrc; uniform vec4 uCrop; uniform float uMirror, uGain; uniform mat3 uE;
    vec3 exposure(vec2 uv) {
      vec3 c = texture(uSrc, uCrop.xy + vec2(uMirror > .5 ? 1. - uv.x : uv.x, uv.y) * uCrop.zw).rgb;
      vec3 lin = pow(c, vec3(2.2));
      // La cámara del teléfono ya recortó sus luces: lo que llega quemado se supone más brillante de
      // lo que dice (hasta ocho veces: un foco lo es cien), para que la halación tenga de dónde sangrar.
      float over = smoothstep(.9, 1., max(c.r, max(c.g, c.b)));
      lin *= 1. + 7. * over * over * over;
      return max(uE * lin, 0.) * uGain;
    }`;
  const FRAG = {
    expose: HEAD + EXPOSE + `void main() { o = vec4(exposure(vUv), 1.); }`,
    blur: HEAD + `
      uniform sampler2D uTex; uniform vec2 uStep; uniform float uLod, uSigma;
      void main() {
        vec3 sum = vec3(0.); float total = 0.;
        for (int i = -7; i <= 7; i++) { float w = exp(-float(i * i) / (2. * uSigma * uSigma)); sum += w * textureLod(uTex, vUv + float(i) * uStep, uLod).rgb; total += w; }
        o = vec4(sum / total, 1.);
      }`,
    first: HEAD + `
      uniform sampler2D uH, uHalo, uWide; uniform vec3 uK;
      void main() { o = vec4(curve(log10v(mix(textureLod(uH, vUv, 1.).rgb, mix(texture(uHalo, vUv).rgb, texture(uWide, vUv).rgb, .3), uK))), 1.); }`,
    final: simple => HEAD + (simple ? EXPOSE : 'uniform sampler2D uH, uHalo, uWide, uSpread;') + `
      uniform sampler3D uPrint; uniform vec3 uK, uRange, uShift, uNoise;   // uNoise = (¿grano?, lado del grumo en puntos, 1/lado en micras)
      uniform vec3 uDirR, uDirG, uDirB; uniform float uSeed, uMode; uniform vec2 uRes;
      vec3 gauss(vec2 cell, float salt) {
        vec3 a = vec3(hash(cell + salt), hash(cell + salt + 17.3), hash(cell + salt + 41.9)), b = vec3(hash(cell.yx + salt + 5.1), hash(cell.yx + salt + 23.7), hash(cell.yx + salt + 67.2));
        return sqrt(-2. * log(max(a, vec3(1e-4)))) * cos(6.2831853 * b);
      }
      // ruido en grumos: el valor de cada esquina de la celda, mezclado con suavidad (1,5 devuelve la fuerza que la mezcla quita)
      vec3 grumos(vec2 p, float salt) {
        vec2 i = floor(p), f = p - i; f = f * f * (3. - 2. * f);
        return mix(mix(gauss(i, salt), gauss(i + vec2(1., 0.), salt), f.x), mix(gauss(i + vec2(0., 1.), salt), gauss(i + vec2(1., 1.), salt), f.x), f.y) * 1.5;
      }
      void main() {
        ${simple ? 'vec3 H = exposure(vUv);' : 'vec3 H = mix(texture(uH, vUv).rgb, mix(texture(uHalo, vUv).rgb, texture(uWide, vUv).rgb, .3), uK);'}
        vec3 x = log10v(H);
        // C · el freno entre capas: cada capa suelta inhibidor según su densidad y frena a las vecinas. La
        // curva de la ficha de una capa ya trae el freno de un gris (las tres capas expuestas como ella);
        // se añade la diferencia con ese gris. Un gris no cambia; un color gana pureza; y como el
        // inhibidor se difunde unas micras, los bordes se marcan.
        vec3 spread = ${simple ? 'curve(x)' : 'texture(uSpread, vUv).rgb'} * uRange;
        vec3 xe = x - vec3(dot(uDirR, spread - curveAt(x.r) * uRange), dot(uDirG, spread - curveAt(x.g) * uRange), dot(uDirB, spread - curveAt(x.b) * uRange));
        vec3 n = curve(xe);
        if (uMode > 1.5) { o = vec4(clamp((x + 3.) / 6., 0., 1.), 1.); return; }       // (pruebas: la exposición)
        // D · el grano: dos tamaños de grumo; su fuerza sale de la tabla (cristales revelados) y del formato
        if (uNoise.x > .5) {
          vec2 p = gl_FragCoord.xy / uNoise.y;
          vec3 g = uNoise.y > 1.2 ? .8 * grumos(p, uSeed) + .6 * grumos(p * .43, uSeed + 91.) : .8 * gauss(floor(p), uSeed) + .6 * grumos(p * .43, uSeed + 91.);
          n += lookup(xe, .75) * uNoise.z * g;
        }
        if (uMode > .5) { o = vec4(clamp(n, 0., 1.), 1.); return; }                    // (pruebas: el negativo)
        // E · la ampliadora centra el negativo (uShift) y el papel lo vuelve positivo
        vec3 rgb = texture(uPrint, clamp(n - uShift, 0., 1.) * (31. / 32.) + .5 / 32.).rgb;
        o = vec4(rgb + (hash(gl_FragCoord.xy + uSeed) - .5) / 255., 1.);
      }`,
  };

  const G = { canvas: null, gl: null, float: false, prog: {}, tex: {}, fbo: {}, size: {}, failed: false, lost: 0, film: null };
  function program(gl, frag) {
    const make = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('FILM: sombreador: ' + gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, make(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('FILM: programa: ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  function ensureGl() {
    if (G.gl) return true;
    if (G.failed) return false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('FILM: sin WebGL 2');
      G.float = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
      G.prog = G.float ? { expose: program(gl, FRAG.expose), blur: program(gl, FRAG.blur), first: program(gl, FRAG.first), final: program(gl, FRAG.final(false)) } : { final: program(gl, FRAG.final(true)) };
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const tex = (target, filter) => { const t = gl.createTexture(); gl.bindTexture(target, t); gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE); return t; };
      G.tex = { src: tex(gl.TEXTURE_2D, gl.LINEAR), curves: tex(gl.TEXTURE_2D, gl.LINEAR), print: tex(gl.TEXTURE_3D, gl.LINEAR) };
      for (const name of ['H', 'a', 'b', 'c', 'wide', 'first', 'd', 'spread']) { G.tex[name] = tex(gl.TEXTURE_2D, name === 'H' ? gl.LINEAR_MIPMAP_NEAREST : gl.LINEAR); G.fbo[name] = gl.createFramebuffer(); G.size[name] = [0, 0]; }
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); G.gl = null; G.lost++; G.film = null; });
      G.canvas = canvas; G.gl = gl;
      return true;
    } catch (error) { console.warn(String(error && error.message || error)); G.failed = true; G.gl = null; return false; }
  }
  function release() {
    if (!G.gl) return;
    const lose = G.gl.getExtension('WEBGL_lose_context');
    G.gl = null; G.film = null;
    if (lose) lose.loseContext();
    if (G.canvas) { G.canvas.width = G.canvas.height = 1; G.canvas = null; }
  }
  // Un destino flotante del tamaño pedido (se rehace solo si cambia).
  function target(name, w, h, mips) {
    const gl = G.gl;
    gl.bindTexture(gl.TEXTURE_2D, G.tex[name]);
    if (G.size[name][0] !== w || G.size[name][1] !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      G.size[name] = [w, h];
      gl.bindFramebuffer(gl.FRAMEBUFFER, G.fbo[name]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, G.tex[name], 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.fbo[name]);
    gl.viewport(0, 0, w, h);
  }
  // Las tablas de una película (curvas, grano y copia), calculadas una vez y subidas a la GPU.
  // La tabla de copia se pide al hilo aparte; si no lo hay (o falla), se calcula aquí mismo.
  const made = new Map(), waiting = new Map();
  let worker = null, workerDead = false;
  function put(id, data) {
    const [key, push, paper] = id.split(':'), film = physics.prepare(key, { push: +push });
    made.set(id, { id, film, curves: physics.curveTable(film), print: { size: 32, data: data || physics.printTable(film, 32, physics.PAPERS[+paper].grade).data } });
    if (made.size > 10) made.delete(made.keys().next().value);
    return made.get(id);
  }
  function finish(id, data) {
    const wait = waiting.get(id);
    if (!wait) return;
    waiting.delete(id);
    wait.done(made.get(id) || put(id, data));
  }
  function ask(id) {
    if (made.has(id)) return Promise.resolve(made.get(id));
    if (waiting.has(id)) return waiting.get(id).promise;
    let done; const promise = new Promise(ok => { done = ok; });
    waiting.set(id, { promise, done });
    try {
      if (!worker && !workerDead) {
        worker = new Worker('./film.js');
        worker.onmessage = event => finish(event.data.id, event.data.data);
        worker.onerror = () => { workerDead = true; worker = null; for (const key of [...waiting.keys()]) finish(key, null); };
      }
      if (worker) { const [key, push, paper] = id.split(':'); worker.postMessage({ id, key, push: +push, grade: physics.PAPERS[+paper].grade }); }
      else finish(id, null);
    } catch (_) { workerDead = true; worker = null; finish(id, null); }
    return promise;
  }
  const idOf = (key, push, paper) => key + ':' + push + ':' + paper;
  // Deja en la GPU las tablas de esa película. Si aún se están calculando: con «sync» las calcula en el
  // acto; sin él, devuelve la película que ya estaba cargada (o nada, si no había ninguna).
  function loadFilm(key, push, paper, sync) {
    const gl = G.gl, id = idOf(key, push, paper);
    if (G.film === id && made.has(id)) return made.get(id);
    if (!made.has(id)) {
      if (sync) put(id, null);
      else { ask(id); return G.film && made.get(G.film) || null; }
    }
    const set = made.get(id), rows = new Float32Array(physics.XN * 4 * 2);
    rows.set(set.curves.density, 0); rows.set(set.curves.noise, physics.XN * 4);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.tex.curves);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, physics.XN, 2, 0, gl.RGBA, gl.FLOAT, rows);
    gl.bindTexture(gl.TEXTURE_3D, G.tex.print);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, set.print.size, set.print.size, set.print.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, set.print.data);
    G.film = id;
    return set;
  }
  // Revela «source» y lo deja en el lienzo del motor (w × h).
  //   o: { stock, ev, push, format (0…3), grain, mirror, crop [x, y, w, h] en 0…1, seed, mode (0 copia, 1 negativo, 2 exposición) }
  function develop(source, w, h, o) {
    const gl = G.gl, set = loadFilm(o.stock, o.push, clamp(o.paper == null ? 1 : o.paper | 0, 0, 2), o.sync);
    if (!set) return null;
    const { film } = set, stock = film.stock;
    if (G.canvas.width !== w || G.canvas.height !== h) { G.canvas.width = w; G.canvas.height = h; }
    const upp = physics.FORMATS[clamp(o.format | 0, 0, 3)].mm * 1000 / Math.max(w, h);          // micras de película por punto
    const range = film.curves.map(c => c.range), shift = film.grayAt(o.ev).map((d, c) => (d - film.grayAt(0)[c]) / range[c]);
    const common = prog => {
      gl.useProgram(prog.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.tex.curves); gl.uniform1i(prog.u.uCurves, 0);
      gl.uniform2f(prog.u.uX, physics.X0, 1 / (physics.X1 - physics.X0));
    };
    const exposing = prog => {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.tex.src); gl.uniform1i(prog.u.uSrc, 1);
      const c = o.crop || [0, 0, 1, 1];
      gl.uniform4f(prog.u.uCrop, c[0], 1 - c[1] - c[3], c[2], c[3]);          // (la imagen se sube con la Y hacia arriba)
      gl.uniform1f(prog.u.uMirror, o.mirror ? 1 : 0);
      gl.uniform1f(prog.u.uGain, Math.pow(2, o.ev - film.push) / 0.18);
      gl.uniformMatrix3fv(prog.u.uE, false, [film.E[0][0], film.E[1][0], film.E[2][0], film.E[0][1], film.E[1][1], film.E[2][1], film.E[0][2], film.E[1][2], film.E[2][2]]);
    };
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.tex.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.disable(gl.BLEND);
    const k = stock.halation.k;
    if (G.float) {
      // 1 · exponer
      target('H', w, h); common(G.prog.expose); exposing(G.prog.expose);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindTexture(gl.TEXTURE_2D, G.tex.H); gl.generateMipmap(gl.TEXTURE_2D);
      // 2 · halación: el rebote cae a «radius» micras; se desenfoca sobre una copia reducida
      const sigma = stock.halation.radius / upp * 0.6, level = clamp(Math.round(Math.log2(Math.max(1, sigma / 2.4))), 0, 6), f = 1 << level;
      const bw = Math.max(2, Math.ceil(w / f)), bh = Math.max(2, Math.ceil(h / f)), st = sigma / f;
      const blur = (from, to, tw, th, dx, dy, lod, sig) => { target(to, tw, th); common(G.prog.blur); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.tex[from]); gl.uniform1i(G.prog.blur.u.uTex, 1); gl.uniform2f(G.prog.blur.u.uStep, dx, dy); gl.uniform1f(G.prog.blur.u.uLod, lod); gl.uniform1f(G.prog.blur.u.uSigma, Math.max(0.35, sig)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
      blur('H', 'a', bw, bh, 1 / bw, 0, level, st);
      blur('a', 'b', bw, bh, 0, 1 / bh, 0, st);
      // …y su cola: el rebote no acaba en seco (la luz que vuelve a rebotar llega más lejos). Un segundo
      // desenfoque, más de tres veces más ancho, que se mezcla con el primero.
      const gap = Math.max(1, 3.2 * st / 3);
      blur('b', 'c', bw, bh, gap / bw, 0, 0, 3);
      blur('c', 'wide', bw, bh, 0, gap / bh, 0, 3);
      // 3 · primer revelado, a la mitad
      const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
      target('first', hw, hh); common(G.prog.first);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.tex.H); gl.uniform1i(G.prog.first.u.uH, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, G.tex.b); gl.uniform1i(G.prog.first.u.uHalo, 2);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, G.tex.wide); gl.uniform1i(G.prog.first.u.uWide, 5);
      gl.uniform3f(G.prog.first.u.uK, k[0], k[1], k[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 4 · el inhibidor se difunde unas micras (da el borde marcado de la película)
      const ds = stock.dirRadius / upp / 2;
      blur('first', 'd', hw, hh, 1 / hw, 0, 0, ds);
      blur('d', 'spread', hw, hh, 0, 1 / hh, 0, ds);
    }
    // 5 · revelado final, grano, ampliadora y papel
    const P = G.prog.final;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    common(P);
    if (G.float) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.tex.H); gl.uniform1i(P.u.uH, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, G.tex.b); gl.uniform1i(P.u.uHalo, 2);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, G.tex.wide); gl.uniform1i(P.u.uWide, 5);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, G.tex.spread); gl.uniform1i(P.u.uSpread, 3);
    } else exposing(P);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_3D, G.tex.print); gl.uniform1i(P.u.uPrint, 4);
    gl.uniform3f(P.u.uK, k[0], k[1], k[2]);
    gl.uniform3f(P.u.uRange, range[0], range[1], range[2]);
    gl.uniform3f(P.u.uShift, shift[0], shift[1], shift[2]);
    const d = stock.dir;
    gl.uniform3f(P.u.uDirR, d[0][0], d[0][1], d[0][2]); gl.uniform3f(P.u.uDirG, d[1][0], d[1][1], d[1][2]); gl.uniform3f(P.u.uDirB, d[2][0], d[2][1], d[2][2]);
    // el grumo de grano mide unas 11 micras: en puntos, según el formato; su fuerza baja con su lado
    const cell = Math.max(1, 11 / upp);
    gl.uniform3f(P.u.uNoise, o.grain === false ? 0 : 1, cell, 1 / (cell * upp));
    gl.uniform1f(P.u.uSeed, o.seed || 0); gl.uniform1f(P.u.uMode, o.mode || 0);
    gl.uniform2f(P.u.uRes, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return G.canvas;
  }

  // ── La cámara FILM ──────────────────────────────────────────────────────────────────────────────
  const S = { ev: 0, push: 0, format: 1, paper: 1, grain: true, frame: 0, ms: 0 };
  try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved && typeof saved === 'object') { S.ev = clamp(+saved.ev || 0, -2, 2); S.push = clamp(Math.round(+saved.push || 0), -1, 2); S.format = clamp(Math.round(saved.format == null ? 1 : +saved.format), 0, 3); S.paper = clamp(Math.round(saved.paper == null ? 1 : +saved.paper), 0, 2); S.grain = saved.grain !== false; } } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ev: S.ev, push: S.push, format: S.format, paper: S.paper, grain: S.grain })); } catch (_) {} };
  function renderFilm(source, srcW, srcH, ctx, mirror, variant, options) {
    if (!ensureGl()) return false;
    const started = performance.now(), opts = options || {};
    const outW = Math.max(1, Math.round(opts.outW || ctx.canvas.width)), outH = Math.max(1, Math.round(opts.outH || ctx.canvas.height));
    const capture = opts.path === 'capture';
    // Resolución interna: la de la salida, con tope (la vista previa no necesita más; la foto, sí).
    const cap = capture ? 2560 : 900, scale = Math.min(1, cap / Math.max(outW, outH));
    const w = Math.max(16, Math.round(outW * scale)), h = Math.max(16, Math.round(outH * scale));
    const [sx, sy, sw, sh] = typeof cropCoordsForDims === 'function' ? cropCoordsForDims(srcW, srcH, w, h) : [0, 0, srcW, srcH];
    const stock = physics.STOCKS[variant] ? variant : 'RETRATO400';
    let ready;
    try {
      // (la foto espera a su película; la vista previa sigue con la que hubiera mientras llega la nueva)
      ready = develop(source, w, h, { stock, ev: S.ev, push: S.push, format: S.format, paper: S.paper, grain: S.grain, mirror, sync: capture, crop: [sx / srcW, sy / srcH, sw / srcW, sh / srcH], seed: capture ? 7.31 : (Math.floor(started / 42) % 211) * 1.37 });
    } catch (error) { console.warn(String(error && error.message || error)); G.failed = true; return false; }
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    if (ready) ctx.drawImage(G.canvas, 0, 0, outW, outH);
    else {
      // La primera película todavía se está calculando (un instante): mientras, la cámara tal cual.
      if (mirror) { ctx.translate(outW, 0); ctx.scale(-1, 1); }
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
    }
    ctx.restore();
    if (ready && !S.warmed) { S.warmed = true; for (const key of Object.keys(physics.STOCKS)) ask(idOf(key, S.push, S.paper)); }
    if (ready) { S.frame++; S.ms += (performance.now() - started - S.ms) * 0.1; }
    return true;
  }

  // La película de siempre se va calculando en cuanto la app está quieta, para que entrar a FILM sea inmediato.
  setTimeout(() => { try { ask(idOf(typeof camFamily !== 'undefined' && camFamily === 'FILM' && physics.STOCKS[camVariant] ? camVariant : 'RETRATO400', S.push, S.paper)); } catch (_) {} }, 1800);

  // Los mandos (su panel está en la página; la consola los vuelve perillas).
  const signed = (v, digits) => (v > 0 ? '+' : v < 0 ? '-' : '') + (digits && Math.abs(v) % 1 ? Math.abs(v).toFixed(1) : String(Math.round(Math.abs(v))));
  const KNOBS = [
    ['filmEv', 'vFilmEv', () => Math.round(S.ev * 3), v => { S.ev = clamp(v / 3, -2, 2); }, v => signed(v / 3, 1)],
    ['filmPush', 'vFilmPush', () => S.push, v => { S.push = clamp(v, -1, 2); }, v => signed(v)],
    ['filmFormat', 'vFilmFormat', () => S.format, v => { S.format = clamp(v, 0, 3); }, v => physics.FORMATS[v].name],
    ['filmPaper', 'vFilmPaper', () => S.paper, v => { S.paper = clamp(v, 0, 2); }, v => physics.PAPERS[v].name],
    ['filmGrain', 'vFilmGrain', () => (S.grain ? 1 : 0), v => { S.grain = v > 0; }, v => (v ? 'SÍ' : 'NO')],
  ];
  function syncUI() {
    for (const [id, out, get, , text] of KNOBS) { const input = $(id), value = get(); if (!input) continue; if (+input.value !== value) input.value = value; const label = $(out); if (label) label.textContent = text(value); }
  }
  for (const [id, , , set] of KNOBS) { const input = $(id); if (input) input.addEventListener('input', event => { set(Math.round(+event.target.value)); save(); syncUI(); }); }
  syncUI();

  window.renderFilm = renderFilm;
  window.flipFilm = {
    physics, release, syncUI,
    // Revela una imagen suelta (pruebas y, más adelante, una foto abierta). Devuelve el lienzo del motor.
    develop(source, options = {}) {
      if (!ensureGl()) return null;
      const w = options.w || source.width || source.videoWidth, h = options.h || source.height || source.videoHeight;
      return develop(source, w, h, { stock: options.stock || 'RETRATO400', ev: options.ev || 0, push: options.push || 0, format: options.format == null ? 1 : options.format, paper: options.paper, grain: options.grain, mirror: false, sync: true, seed: options.seed == null ? 7.31 : options.seed, mode: options.mode || 0 });
    },
    // Lee el lienzo del motor (RGBA de 8 bits, de arriba abajo).
    read() { const gl = G.gl, w = G.canvas.width, h = G.canvas.height, raw = new Uint8Array(w * h * 4), out = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw); for (let y = 0; y < h; y++) out.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); return { data: out, w, h }; },
    set(values) { if (values.ev != null) S.ev = clamp(+values.ev, -2, 2); if (values.push != null) S.push = clamp(Math.round(+values.push), -1, 2); if (values.format != null) S.format = clamp(Math.round(+values.format), 0, 3); if (values.paper != null) S.paper = clamp(Math.round(+values.paper), 0, 2); if (values.grain != null) S.grain = !!values.grain; save(); syncUI(); return this.settings(); },
    // Avisa cuando las tablas de una película están listas (por omisión, con los ajustes puestos).
    ready: (stock, push = S.push, paper = S.paper) => ask(idOf(physics.STOCKS[stock] ? stock : 'RETRATO400', push, paper)).then(() => true),
    settings: () => ({ ev: S.ev, push: S.push, format: S.format, paper: S.paper, grain: S.grain }),
    state: () => ({ worker: !!worker, waiting: waiting.size, made: made.size, gl: !!G.gl, float: G.float, failed: G.failed, lost: G.lost, frame: S.frame, ms: +S.ms.toFixed(2), film: G.film }),
  };
})();
