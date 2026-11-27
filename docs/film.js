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
//                        ─► C2 · el baño: el revelador se gasta donde hay mucho que revelar y eso alcanza
//                              a lo de al lado (décimas de milímetro): el contraste local, el relieve
//                        ─► D · grano: estadística de los cristales que forman la imagen (depende de la
//                              densidad y del formato; nadie le pone «cantidad»). Los cristales gruesos
//                              mandan en lo poco expuesto y los finos se suman después; en color, las
//                              capas comparten casi todo su grano y cada una añade sus nubes de tinte
//                        ─► E · copia: la ampliadora centra el negativo y el papel lo vuelve positivo
//                              (una diapositiva se mira a contraluz; el blanco y negro va a su papel,
//                              que se puede virar)
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
    //
    // Hay tres clases de película, y cada una acaba de un modo distinto:
    //   · «negative»: negativo de color con máscara naranja; se copia en papel de color;
    //   · «reversal»: diapositiva; la propia película es el positivo y se mira a contraluz (sin papel:
    //     no hay quien corrija la exposición, así que EXPOSICIÓN aquí sí aclara y oscurece);
    //   · «mono»: negativo de plata, una sola emulsión; se copia en papel de blanco y negro, que se
    //     puede virar, y admite un filtro de color delante del objetivo.
    // Lo «experimental» no son efectos encima: son cosas que se le hacen a una película de verdad, y se
    // calculan igual que se hacen —
    //   · «unmasked» + «cross»: una diapositiva revelada como negativo (proceso cruzado): sin máscara y
    //     con las capas de contraste distinto, las luces y las sombras se tiñen al revés una de otra;
    //   · «silver»: saltarse el blanqueo: la plata se queda con el tinte (más contraste, menos color);
    //   · «shoot»: cargar el rollo al revés: la luz entra por la base naranja y llega primero a la capa roja;
    //   · «swap»: una película cuyas capas forman el tinte de otra (colores cambiados de sitio).
    const NEG_EXTRA = [[[440, 30, 0.14], [540, 35, 0.18]], [[435, 26, 0.22]], []];
    const NEG_DYES = [dye(665, 48, NEG_EXTRA[0]), dye(542, 30, NEG_EXTRA[1]), dye(442, 34)];
    // La máscara naranja: el acoplador de cada capa es de color —absorbe justo donde su tinte absorbe de
    // más— y se gasta al formarse el tinte. Así la absorción de más queda casi constante (el velo
    // naranja) en vez de ensuciar los colores. «MASK» es qué parte de esa absorción alcanza a cancelar.
    const NEG_MASK = NEG_EXTRA.map(extra => dye(0, 1, extra)), MASK = 0.92;
    // Los tintes de una diapositiva: sin máscara que los limpie, cada uno absorbe un poco donde no debe.
    const SLIDE_DYES = [dye(652, 46, [[545, 40, 0.09], [440, 30, 0.05]]), dye(546, 31, [[440, 28, 0.15], [650, 40, 0.03]]), dye(446, 34, [[545, 40, 0.03]])];
    const SUB = { share: [0.28, 0.42, 0.30], shift: [-0.75, 0, 0.75] };       // sub-emulsión rápida, media y lenta
    const x3 = v => [v, v, v];
    // El freno entre capas (DIR) de la película de retrato, ajustado contra una carta de colores; las
    // demás lo toman escalado: «k» multiplica lo que cada capa frena a las otras (el color), y «self» es
    // lo que una capa se frena a sí misma en su contorno (el borde marcado).
    const DIR0 = [[0.14, 0.26, 0], [0.72, 0.14, 0.41], [0, 0.42, 0.12]];
    const dirOf = (k, self) => DIR0.map((row, c) => row.map((v, j) => (c === j ? (self == null ? v : self) : Math.min(0.95, v * k))));
    // Una sensibilidad a la que se le resta (o suma) un lóbulo: la cuarta capa de algunos negativos
    // —sensible al cian, frena a la roja— hace justo eso: la capa roja «ve en negativo» el verde azulado.
    const lobed = (s, l0, w, a) => spec((l, i) => s[i] + a * Math.exp(-Math.pow(l - l0, 2) / (2 * w * w)));
    // Una emulsión de plata: de dónde a dónde ve («from» lo corta el vidrio; «to», su sensibilización).
    const silverSens = (to, soft, blue = 0.3) => spec(l => smooth(372, 408, l) * (1 - smooth(to - soft, to + soft, l)) * (1 - 0.22 * lobe(l, 505, 24, 24)) * (1 + blue * lobe(l, 438, 30, 30)));
    // Rollo cargado al revés: la luz atraviesa la base (naranja: se come el azul y parte del verde) y
    // llega a las capas roja y verde sin el filtro amarillo que las protegía del azul; la capa azul
    // queda debajo de todo, detrás de ese filtro, casi a oscuras.
    const BASE_T = spec(l => Math.pow(10, -(0.18 + 0.60 * (1 - smooth(530, 600, l)) + 0.32 * (1 - smooth(450, 510, l)))));
    const YELLOW_T = spec(l => Math.pow(10, -1.5 * (1 - smooth(468, 520, l))));
    const NATIVE_BLUE = spec(l => 0.28 * (1 - smooth(440, 500, l)));          // la sensibilidad propia de la plata al azul
    const flipped = s => [spec((l, i) => (s[0][i] + NATIVE_BLUE[i]) * BASE_T[i]), spec((l, i) => (s[1][i] + NATIVE_BLUE[i]) * BASE_T[i]), spec((l, i) => s[2][i] * BASE_T[i] * YELLOW_T[i] * 0.6)];
    const STOCKS = {
      // ── negativos de color ──
      RETRATO400: {
        name: 'RETRATO 400', kind: 'negative', balance: 5500,
        sens: [sens(642, 36, 18, -0.04, true), sens(548, 34, 24, 0, true), sens(445, 32, 24, 0.05)],
        dmin: [0.22, 0.58, 0.88], dmax: [2.05, 2.55, 2.95], gamma: [0.58, 0.62, 0.66], gray: -0.62,
        dir: DIR0, dirRadius: 18,
        halation: { radius: 210, k: [0.035, 0.008, 0.001] },
        grain: { rho: [0.9, 2.8, 5.2], sat: 0.5 }, edge: 0.22, contrast: 1.03,
      },
      CALIDO200: {
        name: 'CÁLIDO 200', kind: 'negative', balance: 5500,
        sens: [sens(645, 32, 16, 0.02, true), sens(546, 30, 22, 0, true), sens(442, 30, 22, 0.08)],
        dmin: [0.24, 0.62, 0.94], dmax: [2.20, 2.75, 3.15], gamma: [0.66, 0.70, 0.74], gray: -0.55,
        dir: [[0.16, 0.21, 0], [0.72, 0.16, 0.45], [0, 0.57, 0.15]], dirRadius: 20,
        halation: { radius: 220, k: [0.045, 0.010, 0.002] },
        grain: { rho: [1.3, 4.0, 7.6], sat: 0.48 }, edge: 0.20,
        warm: 0.035,                                                   // su copia tira a cálida: un punto más de luz azul en la ampliadora (más tinte amarillo en el papel)
      },
      CINE500T: {
        name: 'CINE 500T', kind: 'negative', balance: 3200,
        sens: [sens(646, 35, 18, -0.18, true), sens(546, 32, 24, 0.08, true), sens(445, 30, 24, 0.42)],
        dmin: [0.20, 0.56, 0.86], dmax: [1.95, 2.40, 2.75], gamma: [0.62, 0.65, 0.68], gray: -0.66,
        dir: [[0.14, 0.20, 0], [0.72, 0.14, 0.43], [0, 0.37, 0.12]], dirRadius: 18,
        halation: { radius: 235, k: [0.28, 0.07, 0.01] },
        grain: { rho: [0.41, 1.45, 3.7], sat: 0.52 }, edge: 0.22, contrast: 1.04,
      },
      // Negativo de calle con cuarta capa: tonos duros, verdes que tiran al cian, rojos hondos; las
      // sombras se enfrían y las luces se calientan (las capas no llevan el mismo contraste).
      CALLE400: {
        name: 'CALLE 400', kind: 'negative', balance: 5500,
        sens: [lobed(sens(644, 34, 17, -0.02, true), 508, 20, -0.16), sens(541, 30, 22, 0, true), sens(447, 30, 24, 0.06)],
        dmin: [0.24, 0.60, 0.92], dmax: [2.15, 2.70, 3.05], gamma: [0.68, 0.70, 0.70], gray: -0.52,
        dir: dirOf(0.8), dirRadius: 20,
        halation: { radius: 215, k: [0.04, 0.009, 0.001] },
        grain: { rho: [0.6, 1.9, 3.8], sat: 0.48 }, edge: 0.26,
        contrast: 1.07, cross: [1.09, 0.94, 1.0], paper: { toe: 1.75, shoulder: 1.8 },
      },
      // Negativo de álbum: la copia que se guardó treinta años. Luces ámbar, sombras con color.
      AMBAR160: {
        name: 'ÁMBAR 160', kind: 'negative', balance: 5500,
        sens: [sens(640, 36, 18, 0, true), sens(550, 34, 24, 0, true), sens(444, 32, 24, 0.04)],
        dmin: [0.22, 0.58, 0.88], dmax: [2.10, 2.60, 3.00], gamma: [0.60, 0.63, 0.64], gray: -0.60,
        dir: dirOf(1.2), dirRadius: 18,
        halation: { radius: 210, k: [0.04, 0.009, 0.001] },
        grain: { rho: [1.1, 3.2, 6.0], sat: 0.5 }, edge: 0.16,
        cross: [1.05, 1.0, 0.76], cast: [-0.008, 0.004, 0.022], paper: { toe: 1.35, shoulder: 1.45 },
      },
      // Negativo de cine para luz de día: poco contraste, poco color, sombras largas, una gota de magenta.
      CINE250D: {
        name: 'CINE 250D', kind: 'negative', balance: 5500,
        sens: [sens(644, 35, 18, -0.02, true), sens(546, 32, 24, 0, true), sens(445, 30, 24, 0.05)],
        dmin: [0.20, 0.56, 0.86], dmax: [1.95, 2.40, 2.75], gamma: [0.54, 0.56, 0.58], gray: -0.68,
        dir: dirOf(0.62), dirRadius: 18,
        halation: { radius: 230, k: [0.11, 0.028, 0.004] },
        grain: { rho: [0.58, 1.9, 4.35], sat: 0.52 }, edge: 0.20,
        contrast: 0.94, cast: [0, 0.010, -0.004], paper: { toe: 1.25, shoulder: 1.7 },
      },
      // ── diapositivas ──
      // Diapositiva de paisaje: color a tope, negros hondos, los azules con una gota de magenta.
      VIVA50: {
        name: 'DIAPO VIVA 50', kind: 'reversal', balance: 5500,
        sens: [lobed(sens(646, 30, 16, 0, true), 448, 22, 0.035), sens(546, 28, 20, 0, true), sens(444, 28, 22, 0.02)],
        dmin: x3(0), dmax: x3(3.5), gamma: x3(1.5), gray: 0.30,
        dir: [[0.05, 0.036, 0], [0.237, 0.05, 0.094], [0.104, 0.027, 0.05]], dirRadius: 16,
        halation: { radius: 200, k: [0.02, 0.005, 0.001] },
        grain: { rho: [1.0, 3.0, 5.3], sat: 0.5 }, edge: 0.08,
        sub: { share: [0.26, 0.44, 0.30], shift: [-0.32, 0, 0.34] },
      },
      // Diapositiva de reportero: color contenido, sombras duras, cielos hondos sin magenta.
      REPORTAJE64: {
        name: 'REPORTAJE 64', kind: 'reversal', balance: 5500,
        sens: [lobed(sens(640, 34, 17, 0, true), 492, 22, -0.14), sens(548, 30, 22, 0, true), sens(446, 30, 22, 0)],
        dmin: x3(0), dmax: x3(3.6), gamma: x3(1.36), gray: 0.24,
        dir: [[0.05, 0.028, -0.138], [0.016, 0.05, -0.046], [-0.037, 0.042, 0.05]], dirRadius: 16,
        halation: { radius: 200, k: [0.02, 0.005, 0.001] },
        grain: { rho: [0.55, 1.6, 3.0], sat: 0.5 }, edge: 0.08,
        sub: { share: [0.34, 0.42, 0.24], shift: [-0.30, 0, 0.36] }, tint: [0.985, 1, 1.03],
      },
      // ── experimentales ──
      // Diapositiva revelada como negativo: contraste alto, luces verde-amarillas y sombras azules.
      CRUZADO100: {
        name: 'CRUZADO 100', kind: 'negative', balance: 5500, unmasked: true,
        sens: [sens(646, 30, 16, 0, true), sens(546, 28, 20, 0, true), sens(444, 28, 22, 0.02)],
        dmin: [0.18, 0.22, 0.30], dmax: [2.6, 2.8, 3.0], gamma: [0.80, 0.84, 0.80], gray: -0.46,
        dir: dirOf(1.25), dirRadius: 18,
        halation: { radius: 200, k: [0.03, 0.007, 0.001] },
        grain: { rho: [1.0, 3.0, 5.6], sat: 0.5 }, edge: 0.26,
        cross: [0.95, 1.16, 0.60], cast: [0.006, -0.02, 0.012], paper: { toe: 1.8, shoulder: 1.8 },
      },
      // Negativo sin blanquear: la plata se queda en la película. Metálico, duro, casi sin color.
      PLATA200: {
        name: 'PLATA 200', kind: 'negative', balance: 5500,
        sens: [sens(644, 35, 18, -0.02, true), sens(546, 32, 24, 0, true), sens(445, 30, 24, 0.05)],
        dmin: [0.22, 0.58, 0.88], dmax: [2.05, 2.55, 2.95], gamma: [0.60, 0.63, 0.66], gray: -0.60,
        dir: dirOf(1.0), dirRadius: 18,
        halation: { radius: 215, k: [0.05, 0.012, 0.002] },
        grain: { rho: [0.6, 1.85, 3.7], sat: 0.45 }, edge: 0.28,
        silver: 0.95, contrast: 1.24, cast: [0.005, 0, -0.006], paper: { toe: 1.7, shoulder: 1.8 },
      },
      // El rollo cargado al revés: todo en rojos, naranjas y amarillos.
      REVES200: {
        name: 'AL REVÉS 200', kind: 'negative', balance: 5500,
        sens: [sens(642, 36, 18, -0.04, true), sens(548, 34, 24, 0, true), sens(445, 32, 24, 0.05)],
        shoot: { sens: flipped([sens(642, 36, 18, -0.04), sens(548, 34, 24, 0), sens(445, 32, 24, 0.05)]), ev: 0.55 },
        dmin: [0.22, 0.58, 0.88], dmax: [2.05, 2.55, 2.95], gamma: [0.62, 0.66, 0.70], gray: -0.62,
        dir: dirOf(0.7), dirRadius: 18,
        halation: { radius: 210, k: [0.03, 0.03, 0.02] },
        grain: { rho: [0.6, 1.9, 3.6], sat: 0.5 }, edge: 0.20,
      },
      // Película de colores cambiados: la capa del verde forma el tinte de la del azul, y al revés.
      // El follaje sale púrpura; el cielo, verde agua; los amarillos, rosa. El rojo se queda.
      PURPURA400: {
        name: 'PÚRPURA 400', kind: 'negative', balance: 5500, swap: [0, 2, 1],
        sens: [sens(642, 36, 18, -0.04, true), sens(548, 34, 24, 0, true), sens(445, 32, 24, 0.05)],
        dmin: [0.22, 0.58, 0.88], dmax: [2.05, 2.55, 2.95], gamma: [0.62, 0.64, 0.64], gray: -0.60,
        dir: dirOf(0.9), dirRadius: 18,
        halation: { radius: 210, k: [0.04, 0.009, 0.001] },
        grain: { rho: [0.7, 2.2, 4.2], sat: 0.5 }, edge: 0.20,
      },
      // ── blanco y negro ──
      // Grano finísimo; no ve del todo el rojo (los labios y la piel ganan cuerpo). Sombras suaves y con
      // detalle, y de los medios a las luces, dura.
      BNFINO100: {
        name: 'B/N FINO 100', kind: 'mono', balance: 5500,
        sens: x3(silverSens(632, 16, 0.2)),
        dmin: x3(0.26), dmax: x3(2.25), gamma: x3(0.62), gray: -0.64,
        dir: dirOf(0, 0.28), dirRadius: 13,
        halation: { radius: 190, k: x3(0.012) },
        grain: { rho: [3.4, 10.0, 18.0], sat: 0.5 },
        paper: { toe: 1.75, shoulder: 1.4 },
      },
      // La de reportero de toda la vida: ve todos los colores, grano con carácter, pie largo.
      BNCLASICO400: {
        name: 'B/N CLÁSICO 400', kind: 'mono', balance: 5500,
        sens: x3(silverSens(655, 18)),
        dmin: x3(0.30), dmax: x3(2.35), gamma: x3(0.64), gray: -0.58,
        dir: dirOf(0, 0.36), dirRadius: 16,
        halation: { radius: 215, k: x3(0.03) },
        grain: { rho: [0.34, 1.0, 2.0], sat: 0.45 },
        paper: { toe: 1.5, shoulder: 1.9 },
      },
      // Ortocromática: ciega al rojo. Labios y pecas oscuros, cielos blancos, mucho contraste.
      BNORTO80: {
        name: 'B/N ORTO 80', kind: 'mono', balance: 5500,
        sens: x3(silverSens(578, 14, 0.45)),
        dmin: x3(0.24), dmax: x3(2.40), gamma: x3(0.72), gray: -0.56,
        dir: dirOf(0, 0.32), dirRadius: 13,
        halation: { radius: 190, k: x3(0.02) },
        grain: { rho: [2.2, 6.5, 12.0], sat: 0.5 },
        contrast: 1.08, paper: { toe: 1.6, shoulder: 2.0 },
      },
      // La de noche: rapidísima, grano como arena, sin capa antihalo (las luces se abren en un velo).
      BNNOCHE3200: {
        name: 'B/N NOCHE 3200', kind: 'mono', balance: 3200,
        sens: x3(silverSens(672, 20, 0.15)),
        dmin: x3(0.36), dmax: x3(2.20), gamma: x3(0.60), gray: -0.50,
        dir: dirOf(0, 0.3), dirRadius: 18,
        halation: { radius: 240, k: x3(0.2) },
        grain: { rho: [0.085, 0.26, 0.55], sat: 0.4 },
        contrast: 1.1, paper: { toe: 1.6, shoulder: 1.9 },
      },
    };
    // El soporte de la copia de color (contraste normal). Es un material de mucha densidad —el negro
    // de una copia de cine, no el de un papel mate—: con 2,25 de densidad máxima el negro de la escena
    // se quedaba en gris oscuro (L* 15) y toda la imagen parecía tener un velo; con 2,85 baja a L* 7,
    // donde lo dejan las de blanco y negro. El hombro corto hace que las sombras lleguen a ese negro.
    const PAPER = {
      sens: [sens(692, 26, 20, -0.2), sens(545, 24, 18, 0), sens(472, 22, 18, 0.25)],
      dyes: [dye(658, 44, [[540, 34, 0.11]]), dye(550, 30, [[435, 25, 0.12]]), dye(445, 36)],
      dmin: 0.08, dmax: [2.85, 2.90, 2.80], gamma: [2.15, 2.25, 2.10],
      toe: 1.5, shoulder: 2.0,                                         // qué tan cortos son el pie y el hombro de su curva (1 = logística pura)
    };
    // El papel de blanco y negro (plata sobre fibra).
    const BW_PAPER = { dmin: 0.05, dmax: 2.15, gamma: 2.2, toe: 1.5, shoulder: 1.4 };
    const PAPERS = [{ name: 'SUAVE', grade: 0.84 }, { name: 'NORMAL', grade: 1 }, { name: 'DURO', grade: 1.2 }];
    // Los formatos, del más pequeño al más grande: el ancho del cuadro, en milímetros. En los dos de cine
    // chico («small») el cuadro es tan pequeño que una nube de tinte ya ocupa varios puntos de la imagen:
    // ahí el grano no se sortea como estadística, se dibuja cristal a cristal, y la emulsión —que
    // dispersa la luz unas micras— ya quita nitidez.
    const FORMATS = [{ name: 'SÚPER 8', mm: 5.8, small: true }, { name: 'SÚPER 16', mm: 12.4, small: true }, { name: '½ CUADRO', mm: 24 }, { name: '35 MM', mm: 36 }, { name: '6 × 7', mm: 70 }, { name: '4 × 5', mm: 127 }];
    const F35 = 3;                                                   // el formato de fábrica
    // El radio (en micras) de la nube que deja cada cristal revelado: los gruesos (la sub-emulsión
    // rápida) y los finos. Y cuánto dispersa la luz cada clase de emulsión (la desviación de su mancha,
    // en micras; en color la capa roja, que va al fondo, es la que más, y la azul, arriba, la que menos).
    const CLOUD = { coarse: 8.3, fine: 5.5 };
    const SCATTER = { negative: 3.6, reversal: 3.0, mono: 2.6 }, SCATTER_LAYER = [1.25, 1, 0.8];
    // Cuántos cristales por micra² tiene cada capa respecto a la verde (la azul los lleva más grandes y
    // menos numerosos; la roja, algo más grandes).
    const layerSize = (film, c) => (film.mono ? 1 : c === 2 ? 0.65 : c === 0 ? 0.92 : 1);
    // Filtros de color delante del objetivo (blanco y negro): qué deja pasar cada uno. El fotómetro
    // compensa la luz que quitan: un gris se queda donde estaba y los colores cambian de tono.
    const cutOn = (at, soft, floor = 0.01) => spec(l => floor + (1 - floor) / (1 + Math.exp(-(l - at) / soft)));
    const FILTERS = [
      { name: 'SIN', t: null },
      { name: 'AMARILLO', t: cutOn(495, 7, 0.02) },
      { name: 'NARANJA', t: cutOn(550, 7) },
      { name: 'ROJO', t: cutOn(598, 7) },
      { name: 'VERDE', t: spec(l => 0.02 + 0.6 * lobe(l, 538, 26, 34)) },
    ];
    // Virados: en qué se convierte la plata de la copia. «lo» es el color de las densidades bajas (las
    // luces) y «hi» el de las altas (las sombras): cuánto absorbe en rojo, verde y azul por unidad de
    // densidad. Un virador no ataca igual lo claro que lo oscuro: de ahí el tono partido.
    const TONERS = [
      { name: 'NEUTRO', lo: [1, 1, 1], hi: [1, 1, 1], base: [1, 1, 1], dmax: 1 },
      { name: 'CÁLIDO', lo: [0.88, 1, 1.24], hi: [0.96, 1, 1.09], base: [1, 0.985, 0.945], dmax: 0.98 },
      { name: 'SELENIO', lo: [1.0, 1.0, 0.98], hi: [0.89, 1.07, 0.97], base: [1, 0.995, 0.975], dmax: 1.08 },
      { name: 'SEPIA', lo: [0.66, 1, 1.62], hi: [0.84, 1, 1.3], base: [1, 0.985, 0.94], dmax: 0.86 },
      { name: 'CIANOTIPO', lo: [1.55, 0.86, 0.34], hi: [1.3, 0.98, 0.56], base: [1, 0.995, 0.965], dmax: 0.92 },
    ];

    // ── La curva característica de una capa: densidad contra log10 de la exposición ──
    // Tres sub-emulsiones logísticas; «k» se busca para dar la gamma pedida. En un negativo, la gamma es
    // la pendiente en el centro de la curva. En una diapositiva (que es su propio positivo) es el
    // contraste de la imagen en el gris medio: lo que de verdad se ve.
    function layerCurve(dmin, dmax, gamma, centre, sub = SUB, reversal = false) {
      const range = dmax - dmin, parts = k => x => { let s = 0; for (let j = 0; j < 3; j++) s += sub.share[j] / (1 + Math.exp(-k * (x - centre - sub.shift[j]))); return s; };
      const measure = reversal
        ? k => { const f = parts(k); return 0.70 * (f(0.02) - f(-0.02)) / 0.04 / Math.max(1e-4, 1 - f(0)); }
        : k => { const f = parts(k); return range * (f(centre + 0.02) - f(centre - 0.02)) / 0.04; };
      let lo = 0.4, hi = 14;
      for (let it = 0; it < 40; it++) { const k = 0.5 * (lo + hi); if (measure(k) < gamma) lo = k; else hi = k; }
      const k = 0.5 * (lo + hi);
      return {
        k, centre, dmin, range,
        D: x => dmin + range * parts(k)(x),
        // qué parte de cada sub-emulsión se revela (para el grano)
        p: x => sub.shift.map(s => 1 / (1 + Math.exp(-k * (x - centre - s)))),
      };
    }

    // ── Preparar una película: todo lo que el revelado necesita, ya integrado ──
    // options: { push: −1…2 (empuje), scene: kelvin de la luz de la escena (por defecto, la de la
    //            película), filter: 0…4 (filtro de color; solo en blanco y negro) }
    function prepare(key, options = {}) {
      const stock = STOCKS[key];
      if (!stock) throw new Error('FILM: no conozco la película ' + key);
      const push = clamp(options.push || 0, -1, 2), mono = stock.kind === 'mono', reversal = stock.kind === 'reversal';
      const filter = mono ? clamp(Math.round(options.filter || 0), 0, FILTERS.length - 1) : 0, glass = FILTERS[filter].t;
      const light = planck(options.scene || stock.balance), ref = planck(stock.balance);
      const lit = glass ? spec((l, i) => light[i] * glass[i]) : light, shoot = stock.shoot;
      // A · la matriz de exposición: lo que cada capa recibe de cada primario, con el blanco en (1, 1, 1)
      // bajo la luz para la que la película está equilibrada (y a través del filtro, si lo lleva).
      // Un rollo cargado al revés se mide como si estuviera al derecho: de ahí sale su color.
      const expose = stock.sens.map((s, c) => { const white = glass ? dot(ref, glass, s) : dot(ref, s), boost = shoot ? Math.pow(2, shoot.ev || 0) : 1; return BASES.map(b => boost * dot(b, lit, shoot ? shoot.sens[c] : s) / white); });
      const E = mulM(expose, TO_BASES);
      // C · las curvas. El empuje (revelar de más una película expuesta de menos) sube la pendiente,
      // gana sensibilidad (toda la que se le pide, en diapositiva; parte, en negativo: el resto lo pone
      // la copia) y levanta el velo.
      const centre = -stock.gray - (reversal ? 0.30103 : 0.18) * push;    // log10 H del centro de la curva, con el gris medio en 0
      const curves = [0, 1, 2].map(c => layerCurve(stock.dmin[c] + (reversal ? 0 : 0.03 * Math.max(0, push)), stock.dmax[c], stock.gamma[c] * (1 + 0.16 * push), centre, stock.sub || SUB, reversal));
      // El gris medio expuesto con «ev» pasos de más o de menos, y empujado: su densidad en cada capa.
      const grayAt = ev => curves.map(cv => cv.D(0.30103 * (ev - push)));
      // Lo que la ampliadora corrige al copiar un negativo expuesto de más o de menos (en una
      // diapositiva no hay copia: nada).
      const shiftAt = ev => (reversal ? [0, 0, 0] : grayAt(ev).map((d, c) => (d - grayAt(0)[c]) / curves[c].range));
      return { key, stock, push, filter, mono, reversal, E, curves, grayAt, shiftAt };
    }

    // ── La copia: de la película a la imagen, como tabla ──
    // Para cada terna de densidades (por encima de su mínimo, de 0 a 1 de su recorrido), el color que
    // se acaba viendo. Cada clase de película llega por su camino.
    // La curva de un papel: una logística con el pie acortado (el papel real pasa de blanco a gris en
    // poco recorrido; con una logística pura el blanco de la escena se quedaba en gris claro). Su
    // pendiente (la «gamma» del papel) se mide donde se trabaja: en el gris medio («target»).
    function paperCurve(range, gamma, toe, shoulder, target) {
      const shape = (kk, x) => range * (1 - Math.pow(1 - Math.pow(1 / (1 + Math.exp(-kk * x)), toe), shoulder));
      const slopeAtGray = kk => { let a = -6, b = 6; for (let i = 0; i < 50; i++) { const m = 0.5 * (a + b); if (shape(kk, m) < target) a = m; else b = m; } const x = 0.5 * (a + b); return (shape(kk, x + 0.01) - shape(kk, x - 0.01)) / 0.02; };
      let lo = 0.5, hi = 20;
      for (let i = 0; i < 40; i++) { const kk = 0.5 * (lo + hi); if (slopeAtGray(kk) < gamma) lo = kk; else hi = kk; }
      const kk = 0.5 * (lo + hi);
      return x => shape(kk, x);
    }
    // El contraste que debe tener la copia de un negativo: el de la película —su gamma— por el del
    // papel, algo rebajado por la luz parásita (las densidades de la ficha ya incluyen la máscara).
    const copyContrast = (film, pgamma) => 0.92 * (1 + 0.16 * film.push) * (film.stock.gamma[0] + film.stock.gamma[1] + film.stock.gamma[2]) / 3 * pgamma * (film.stock.contrast || 1);

    // Negativo de color: su transmisión espectral (tintes + máscara naranja, que se gasta al formarse
    // el tinte, + la plata si no se blanqueó), la luz de la ampliadora a través de él, la exposición de
    // cada capa del papel, la curva del papel, sus tintes, y lo que refleja bajo luz de día. Las luces
    // de la ampliadora se ajustan para que el gris medio del negativo salga gris medio en el papel.
    function negativePrint(film, grade) {
      const { stock, curves } = film, lamp = planck(3200), see = viewer(D65), pgamma = PAPER.gamma.map(g => g * grade), form = stock.paper || PAPER;
      const target = 0.745 - PAPER.dmin;                                 // el gris medio en el papel refleja el 18 %
      const paper = [0, 1, 2].map(k => paperCurve(PAPER.dmax[k] - PAPER.dmin, pgamma[k], form.toe, form.shoulder, target));
      const dyeOf = stock.swap || [0, 1, 2], mask = stock.unmasked ? 0 : MASK, silver = stock.silver || 0;
      const grayN = film.grayAt(0).map((d, c) => (d - curves[c].dmin) / curves[c].range);
      const white = see(spec((l, i) => D65[i]));                          // el papel sin tinte es el blanco de pantalla
      // «gain»: cuánto pesa cada tinte del negativo para el papel (su densidad de copia, que no es la de
      // la ficha). «offset»: las luces de la ampliadora. Se ajustan los dos para que la escala de grises
      // de la escena salga gris en el papel de punta a punta, con el gris medio en el 18 %.
      const gain = [1, 1, 1], offset = [0, 0, 0];
      let base = [1, 1, 1];
      const through = n => spec((l, i) => {                              // n: densidad de cada capa, de 0 a 1 de su recorrido
        let d = 0.06, ag = 0;
        for (let c = 0; c < 3; c++) { const q = dyeOf[c]; d += curves[c].range * gain[q] * (n[c] * NEG_DYES[q][i] + mask * (1 - n[c]) * NEG_MASK[q][i]); ag += curves[c].range * n[c]; }
        return Math.pow(10, -d - silver * ag / 3);
      });
      const print = nn => {
        const T = through(nn), dens = [0, 1, 2].map(k => paper[k](Math.log10(dot(lamp, T, PAPER.sens[k]) / base[k]) + offset[k]));
        const rgb = see(spec((l, i) => D65[i] * Math.pow(10, -(dens[0] * PAPER.dyes[0][i] + dens[1] * PAPER.dyes[1][i] + dens[2] * PAPER.dyes[2][i]))));
        return [rgb[0] / white[0], rgb[1] / white[1], rgb[2] / white[2]];
      };
      const nAt = ev => film.grayAt(ev).map((d, c) => (d - curves[c].dmin) / curves[c].range);
      const lo = nAt(-1), hi = nAt(1), contrast = copyContrast(film, (pgamma[0] + pgamma[1] + pgamma[2]) / 3);
      const centre = () => { base = PAPER.sens.map(sn => dot(lamp, through(grayN), sn)); const g = print(grayN); for (let k = 0; k < 3; k++) offset[k] += 0.6 * Math.log10(Math.max(1e-4, g[k]) / 0.18) / pgamma[k]; };   // más luz en una capa del papel → más tinte → menos de ese color en la copia
      for (let it = 0; it < 90; it++) {
        centre();
        if (it % 2) {
          const a = print(lo), z = print(hi);
          for (let k = 0; k < 3; k++) { const slope = Math.log10(Math.max(1e-4, z[k]) / Math.max(1e-4, a[k])) / 0.60206; gain[k] = clamp(gain[k] * Math.pow(contrast / Math.max(0.05, slope), 0.5), 0.25, 4); }
        }
      }
      // Capas con contraste distinto (proceso cruzado, película vieja): el gris medio sigue gris, pero
      // hacia las luces y hacia las sombras cada capa se va por su lado.
      if (stock.cross) { for (let k = 0; k < 3; k++) gain[k] *= stock.cross[k]; for (let it = 0; it < 40; it++) centre(); }
      if (stock.warm) offset[2] += stock.warm;
      if (stock.cast) for (let k = 0; k < 3; k++) offset[k] += stock.cast[k];
      return { print, grayN, gain, offset };
    }

    // Diapositiva: lo que no se reveló en el primer baño es lo que acaba formando tinte (cuanta más
    // luz, menos tinte), y se mira a contraluz. La cantidad de cada tinte es la que deja gris el gris.
    function slidePrint(film) {
      // («clear»: con luz de sobra la película queda limpia del todo; una logística nunca llega)
      const { stock, curves } = film, see = viewer(D65), gain = [1, 1, 1], dyeOf = stock.swap || [0, 1, 2], flare = 0.003, clear = 0.03;
      const through = n => spec((l, i) => { let d = 0; for (let c = 0; c < 3; c++) { const q = dyeOf[c]; d += curves[c].range * gain[q] * Math.max(0, (1 - n[c] - clear) / (1 - clear)) * SLIDE_DYES[q][i]; } return D65[i] * Math.pow(10, -d); });
      const white = see(through([1, 1, 1]));
      const print = n => { const c = see(through(n)); return [0, 1, 2].map(k => (c[k] / white[k] + flare) / (1 + flare)); };
      const grayN = film.grayAt(0).map((d, c) => (d - curves[c].dmin) / curves[c].range);
      for (let it = 0; it < 80; it++) { const g = print(grayN); for (let k = 0; k < 3; k++) gain[k] = clamp(gain[k] * Math.pow(0.745 / Math.max(0.02, -Math.log10(Math.max(1e-4, g[k]))), 0.8), 0.1, 4); }
      if (stock.tint) for (let k = 0; k < 3; k++) gain[k] *= stock.tint[k];
      return { print, grayN, gain, offset: [0, 0, 0] };
    }

    // Blanco y negro: el negativo de plata es neutro; el papel lo vuelve positivo y el virado le da color.
    function monoPrint(film, grade, toner) {
      const { stock, curves } = film, cv = curves[0], tone = TONERS[clamp(Math.round(toner || 0), 0, TONERS.length - 1)], form = stock.paper || BW_PAPER;
      const pgamma = BW_PAPER.gamma * grade, range = BW_PAPER.dmax * tone.dmax - BW_PAPER.dmin, paper = paperCurve(range, pgamma, form.toe, form.shoulder, 0.745 - BW_PAPER.dmin);
      const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      let gain = 1, offset = 0;
      const print = n => {
        const D = paper(-cv.range * gain * (n[0] + n[1] + n[2]) / 3 + offset), t = D / range;
        return [0, 1, 2].map(k => tone.base[k] * Math.pow(10, -D * (tone.lo[k] + (tone.hi[k] - tone.lo[k]) * t)));
      };
      const nAt = ev => film.grayAt(ev).map((d, c) => (d - curves[c].dmin) / curves[c].range);
      const grayN = nAt(0), lo = nAt(-1), hi = nAt(1), contrast = copyContrast(film, pgamma);
      for (let it = 0; it < 90; it++) {
        offset += 0.6 * Math.log10(Math.max(1e-4, lum(print(grayN))) / 0.18) / pgamma;
        if (it % 2) { const slope = Math.log10(Math.max(1e-4, lum(print(hi))) / Math.max(1e-4, lum(print(lo)))) / 0.60206; gain = clamp(gain * Math.pow(contrast / Math.max(0.05, slope), 0.5), 0.25, 4); }
      }
      return { print, grayN, gain: x3(gain), offset: x3(offset) };
    }

    // «grade»: el grado del papel (su contraste): 1 es el normal; menos, suave; más, duro (una
    // diapositiva no lleva papel). «toner»: el virado de la copia en blanco y negro.
    function printTable(film, size = 32, grade = 1, toner = 0) {
      const made = film.mono ? monoPrint(film, grade, toner) : film.reversal ? slidePrint(film) : negativePrint(film, grade);
      const out = new Uint8Array(size * size * size * 4), n = [0, 0, 0];
      const enc = v => Math.round(255 * (v <= 0 ? 0 : v >= 1 ? 1 : v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
      for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
        n[0] = r / (size - 1); n[1] = g / (size - 1); n[2] = b / (size - 1);
        const rgb = made.print(n), o = 4 * ((b * size + g) * size + r);
        out[o] = enc(rgb[0]); out[o + 1] = enc(rgb[1]); out[o + 2] = enc(rgb[2]); out[o + 3] = 255;
      }
      return { size, data: out, print: made.print, grayN: made.grayN, gain: made.gain, offset: made.offset };
    }

    // ── Tablas de una dimensión para el sombreador ──
    // Para log10 H entre X0 y X1 (con el gris medio en 0): la densidad de cada capa (de 0 a 1 de su
    // recorrido) y la desviación de su grano, por micra de lado del punto: la de toda la capa
    // («noise») y, aparte, la de sus cristales gruesos («coarse»: la sub-emulsión rápida) y la de los
    // finos («fine»: la media y la lenta).
    const X0 = -4, X1 = 3.5, XN = 1024;
    function curveTable(film) {
      const { stock, curves, push, reversal } = film, sub = stock.sub || SUB;
      const out = new Float32Array(XN * 4), noise = new Float32Array(XN * 4), coarse = new Float32Array(XN * 4), fine = new Float32Array(XN * 4);
      const qFast = new Float32Array(XN * 4), qMid = new Float32Array(XN * 4);     // qué parte de los cristales gruesos y de los finos forma imagen
      for (let i = 0; i < XN; i++) {
        const x = X0 + (X1 - X0) * i / (XN - 1);
        for (let c = 0; c < 3; c++) {
          const cv = curves[c];
          out[i * 4 + c] = (cv.D(x) - cv.dmin) / cv.range;
          // Grano: los cristales que forman la imagen siguen una ley de Poisson (su varianza es su
          // media), frenada por el solape de las nubes de tinte. En un negativo la imagen la forman los
          // cristales REVELADOS; en una diapositiva, los que el primer baño NO reveló (por eso donde
          // queda limpia —los blancos— no hay grano: ahí no queda nada que forme tinte).
          // La capa azul lleva cristales más grandes y menos numerosos; la roja, algo más grandes.
          // Empujar agranda el grano.
          const p = cv.p(x), size = layerSize(film, c), boost = 1 + 0.8 * Math.max(0, push);
          const part = j => { const q = reversal ? 1 - p[j] : p[j]; return Math.pow(cv.range * sub.share[j], 2) * q * (1 - stock.grain.sat * q) / (stock.grain.rho[j] * size) * boost; };
          const fast = part(0), rest = part(1) + part(2);
          noise[i * 4 + c] = Math.sqrt(fast + rest) / cv.range;                                        // en unidades de «n» (0…1 del recorrido), por micra
          coarse[i * 4 + c] = Math.sqrt(fast) / cv.range; fine[i * 4 + c] = Math.sqrt(rest) / cv.range;
          qFast[i * 4 + c] = reversal ? 1 - p[0] : p[0]; qMid[i * 4 + c] = reversal ? 1 - p[1] : p[1];
        }
        out[i * 4 + 3] = 1; noise[i * 4 + 3] = 1; coarse[i * 4 + 3] = 1; fine[i * 4 + 3] = 1; qFast[i * 4 + 3] = 1; qMid[i * 4 + 3] = 1;
      }
      return { x0: X0, x1: X1, n: XN, density: out, noise, coarse, fine, qFast, qMid };
    }
    // Cuánto del grano comparten las tres capas de una película de color (de 0 a 1 de su varianza).
    // En una película de verdad cada capa tiene sus cristales y su grano es independiente: de cerca,
    // confeti de colores. A tamaño de pantalla eso se lee como ruido de sensor y como un velo claro,
    // no como grano. Las nuestras atan casi todo el grano entre capas —grano de luminancia, como el de
    // la plata— y dejan una parte propia de cada capa, en nubes más anchas: el color que respira dentro.
    const TIE = 0.86;
    const tieOf = stock => (stock.kind === 'mono' ? 1 : stock.grain.tie == null ? TIE : stock.grain.tie);

    // El revelado de UN punto, en JavaScript y sin atajos: la referencia contra la que se mide el
    // sombreador. rgb lineal con el gris medio en 0,18. Devuelve densidades y la imagen (RGB lineal).
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
      const shift = film.shiftAt(ev);
      const n = D.map((d, c) => clamp((d - film.curves[c].dmin) / film.curves[c].range - shift[c], 0, 1));
      return { H, D, n, print: table ? table.print(n) : null };
    }

    return { LAM, STOCKS, PAPER, PAPERS, FORMATS, F35, CLOUD, SCATTER, SCATTER_LAYER, layerSize, FILTERS, TONERS, SUB, X0, X1, XN, TIE, tieOf, prepare, printTable, curveTable, develop, upsample, planck, viewer, D65, clamp };
  })();

  if (typeof module !== 'undefined' && module.exports) { module.exports = physics; return; }
  // Este mismo archivo, cargado como hilo aparte, solo calcula la tabla de copia (es lo único lento:
  // medio segundo largo en un teléfono) para que cambiar de película no detenga la cámara.
  if (typeof window === 'undefined') {
    self.onmessage = event => {
      const { id, key, push, grade, toner } = event.data, table = physics.printTable(physics.prepare(key, { push }), 32, grade, toner);
      self.postMessage({ id, data: table.data }, [table.data.buffer]);
    };
    return;
  }
  window.flipFilmPhysics = physics;

  // ══ EL REVELADO, EN LA GPU ═════════════════════════════════════════════════════════════════════
  // Once pasadas por cuadro (WebGL 2, con destinos de media precisión flotante):
  //   1 · exponer: la cámara, a luz lineal, por la matriz de la película            (tamaño completo)
  //   2 · halación: esa exposición, desenfocada al radio del rebote en la base      (reducida; 4 pasadas)
  //   3 · primer revelado: densidad de cada capa                                    (a la mitad)
  //   4 · el inhibidor se difunde unas micras                                       (a la mitad; 2 pasadas)
  //   4b · el baño: la misma densidad a décimas de milímetro (películas de color)   (reducida; 2 pasadas)
  //   5 · revelado final (con el freno de las capas vecinas y el del baño), grano, ampliadora y soporte
  // En cine chico (SÚPER 8 y SÚPER 16) hay dos pasadas más (1b: la emulsión dispersa la luz) y el grano
  // del paso 5 deja de sortearse como estadística: se dibuja cristal a cristal (hasta 63 huecos por punto,
  // cada uno con su cuenta de Poisson).
  // El último paso hace por cada punto: 5 lecturas en coma flotante, 21 de las tablas de la película,
  // unos 80 sorteos para el grano (dos tamaños de cristal y las nubes de tinte de cada capa) y la tabla
  // de copia en 3D. En el visor son 786 000 puntos, 24 granos distintos por segundo.
  // Si el teléfono no da destinos flotantes, queda el paso 5 solo, sin halación ni difusión.
  const $ = id => document.getElementById(id);
  const KEY = 'flip.film', NFMT = physics.FORMATS.length - 1;
  const VERT = `#version 300 es
    in vec2 aPos; out vec2 vUv;
    void main() { vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;
  const HEAD = `#version 300 es
    precision highp float; precision highp sampler3D;
    in vec2 vUv; out vec4 o;
    uniform sampler2D uCurves; uniform vec2 uX;                    // tablas de la película; uX = (x0, 1/(x1 − x0))
    vec3 lookup(vec3 x, float row) { vec3 t = clamp((x - uX.x) * uX.y, 0., 1.) * (1023. / 1024.) + .5 / 1024.; return vec3(texture(uCurves, vec2(t.r, row)).r, texture(uCurves, vec2(t.g, row)).g, texture(uCurves, vec2(t.b, row)).b); }
    // (filas de la tabla: densidad, grano, grano grueso, grano fino, y qué parte de los cristales gruesos y de los finos forma imagen)
    const float DENSITY = 1. / 12., NOISE = 3. / 12., COARSE = 5. / 12., FINE = 7. / 12., QFAST = 9. / 12., QMID = 11. / 12.;
    vec3 curve(vec3 x) { return lookup(x, DENSITY); }
    vec3 curveAt(float x) { return texture(uCurves, vec2(clamp((x - uX.x) * uX.y, 0., 1.) * (1023. / 1024.) + .5 / 1024., DENSITY)).rgb; }   // las tres capas con una misma exposición
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
      uniform sampler2D uTex; uniform vec2 uStep; uniform float uLod; uniform vec3 uSigma;      // (un ancho por capa)
      void main() {
        vec3 sum = vec3(0.), total = vec3(0.);
        for (int i = -7; i <= 7; i++) { vec3 w = exp(-float(i * i) / (2. * uSigma * uSigma)); sum += w * textureLod(uTex, vUv + float(i) * uStep, uLod).rgb; total += w; }
        o = vec4(sum / total, 1.);
      }`,
    first: HEAD + `
      uniform sampler2D uH, uHalo, uWide; uniform vec3 uK;
      void main() { o = vec4(curve(log10v(mix(textureLod(uH, vUv, 1.).rgb, mix(texture(uHalo, vUv).rgb, texture(uWide, vUv).rgb, .3), uK))), 1.); }`,
    final: simple => HEAD + (simple ? EXPOSE : 'uniform sampler2D uH, uHalo, uWide, uSpread, uBath; uniform float uEdge;') + `
      uniform sampler3D uPrint; uniform vec3 uK, uRange, uShift, uNoise;   // uNoise = (¿grano?, lado del grumo en puntos, 1/lado en micras)
      uniform vec3 uDirR, uDirG, uDirB; uniform float uSeed, uMode, uMono; uniform vec2 uRes, uTie;   // uTie = (raíz de lo que comparten las capas, raíz de lo propio)
      // Cine chico: los cristales, uno por uno. uCry = (radio de la nube gruesa en puntos, nubes por celda,
      // signo, fuerza); uCryF = lo mismo para la fina (radio, nubes por celda, fuerza); uMc y uMf = cuántos
      // cristales caben en una celda de cada capa si todos forman imagen. Con uCry.x en 0, apagado.
      uniform vec4 uCry; uniform vec3 uCryF, uMc, uMf;
      // Cuántos cristales forman imagen en un hueco, cuando se esperan «m»: una ley de Poisson, sorteada
      // con el número «u» del hueco (el mismo para las tres capas: comparten cristal). Hasta cuatro se
      // cuentan uno a uno; con más, ya da igual contarlos que estimarlos.
      vec3 conteo(vec3 m, float u) {
        float z = log(u / (1. - u)) * .5513;
        vec3 many = max(vec3(0.), floor(m + sqrt(m) * z + .5));
        if (min(m.r, min(m.g, m.b)) >= 4.) return many;                 // (lo denso no paga la cuenta uno a uno)
        vec3 pr = exp(-m), cdf = pr, k = vec3(0.);
        for (int i = 1; i <= 10; i++) { k += step(cdf, vec3(u)); pr *= m / float(i); cdf += pr; }
        return mix(k, many, step(4., m));
      }
      // La película, vista de cerca: el plano se reparte en celdas del tamaño de una nube; cada celda
      // tiene unos huecos con sitio fijo (sorteado), y en cada hueco hay tantos cristales como dicte la
      // exposición de ESTE punto. Cada cristal deja una nube redonda. Donde llegó poca luz se ven sueltos;
      // donde llegó mucha, se enciman. Devuelve cuánto se aparta de su media (en lo denso, desviación 1).
      vec3 cristales(vec2 frag, float radius, float slots, vec3 perCell, vec3 q, float salt) {
        vec2 p = frag / radius, cell = floor(p);
        vec3 full = max(perCell * q, vec3(1e-4)), m = full / slots, sum = vec3(0.);
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 c = cell + vec2(float(i), float(j));
          for (float s = 0.; s < slots; s += 1.) {
            vec2 at = c + vec2(hash(c + salt + s * 7.31), hash(c.yx + salt + 3.7 + s * 5.17)) - p;
            float r2 = dot(at, at);
            // (lo que cuenta es cuánto se aparta cada hueco de lo esperado: así el sitio de los huecos,
            //  que es fijo, no añade un moteado propio cuando hay muchos cristales en cada uno)
            if (r2 < 1.) { float k = 1. - r2; sum += (conteo(m, clamp(hash(c * 1.37 + salt + 11.3 + s * 3.91), 1e-4, .9999)) - m) * k * k; }
          }
        }
        return sum / sqrt(full * .6283185);
      }
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
        ${simple ? '' : `// C2 · el baño: donde se revela mucho, el revelador se gasta y suelta bromuro, y eso alcanza a lo que
        // tiene al lado (décimas de milímetro). Junto a una zona densa se revela menos; junto a una clara, más.
        // Es el contraste local de la película —el relieve—, y una zona lisa no cambia.
        xe -= uEdge * dot(texture(uBath, vUv).rgb * uRange - spread, vec3(1. / 3.));`}
        vec3 n = curve(xe);
        if (uMode > 1.5) { o = vec4(clamp((x + 3.) / 6., 0., 1.), 1.); return; }       // (pruebas: la exposición)
        // D · el grano: dos tamaños de grumo; su fuerza sale de la tabla (cristales revelados) y del formato
        if (uNoise.x > .5) {
          vec2 p = gl_FragCoord.xy / uNoise.y;
          float fino = (uNoise.y > 1.2 ? grumos(p, uSeed) : gauss(floor(p), uSeed)).r, grueso = grumos(p * .43, uSeed + 91.).r;
          if (uCry.x > 0.) {
            // Cine chico: los cristales gruesos y los finos, uno por uno (compartidos por las capas); en
            // color, además, las nubes de tinte propias de cada capa. En una diapositiva lo que forma
            // imagen es lo que NO se reveló: el signo va al revés.
            vec3 grain = lookup(xe, COARSE) * uCry.w * cristales(gl_FragCoord.xy, uCry.x, uCry.y, uMc, lookup(xe, QFAST), uSeed + 91.)
                       + lookup(xe, FINE) * uCryF.z * cristales(gl_FragCoord.xy, uCryF.x, uCryF.y, uMf, lookup(xe, QMID), uSeed);
            n += uCry.z * uTie.x * grain;
            if (uMono < .5) n += uNoise.z * uTie.y * lookup(xe, NOISE) * grumos(mat2(.8, .6, -.6, .8) * p * .31, uSeed + 173.);
          }
          else if (uMono > .5) n += lookup(xe, NOISE) * uNoise.z * (.8 * fino + .6 * grueso);   // una sola emulsión: un solo grano
          else {
            // Color: el grano es el de la plata —el mismo dibujo que en blanco y negro—, compartido por
            // las tres capas, y cada tamaño lleva la fuerza de SUS cristales: los gruesos (la sub-emulsión
            // rápida, la única que se revela con poca luz) mandan en lo poco expuesto, y los finos se suman
            // al subir la exposición. Encima, lo propio de cada capa: nubes de tinte anchas, giradas para
            // que no caigan sobre el dibujo de la plata; es el color que se mueve dentro del grano.
            vec3 nubes = grumos(mat2(.8, .6, -.6, .8) * p * .31, uSeed + 173.);
            n += uNoise.z * (uTie.x * (lookup(xe, FINE) * fino + lookup(xe, COARSE) * grueso) + uTie.y * lookup(xe, NOISE) * nubes);
          }
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
      for (const name of ['H', 'H0', 's1', 'a', 'b', 'c', 'wide', 'first', 'd', 'spread', 'e', 'bath']) { G.tex[name] = tex(gl.TEXTURE_2D, name === 'H' || name === 'first' ? gl.LINEAR_MIPMAP_NEAREST : gl.LINEAR); G.fbo[name] = gl.createFramebuffer(); G.size[name] = [0, 0]; }
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
    const [key, push, paper, filter, toner] = id.split(':'), film = physics.prepare(key, { push: +push, filter: +filter });
    made.set(id, { id, film, curves: physics.curveTable(film), print: { size: 32, data: data || physics.printTable(film, 32, physics.PAPERS[+paper].grade, +toner).data } });
    if (made.size > 24) made.delete(made.keys().next().value);
    return made.get(id);
  }
  function finish(id, data) {
    const wait = waiting.get(id);
    if (!wait) return;
    waiting.delete(id);
    wait.done(made.get(id) || put(id, data));
  }
  // Las tablas se piden al hilo aparte de una en una. Lo que la cámara necesita YA pasa por delante de
  // lo que solo se va adelantando (las demás películas, para que cambiar sea inmediato).
  const queue = [];
  let busy = '';
  function pump() {
    if (busy || !queue.length) return;
    if (!worker) { for (const id of queue.splice(0)) finish(id, null); return; }
    busy = queue.shift();
    const [key, push, paper, , toner] = busy.split(':');
    worker.postMessage({ id: busy, key, push: +push, grade: physics.PAPERS[+paper].grade, toner: +toner });
  }
  function ask(id, urgent) {
    if (made.has(id)) return Promise.resolve(made.get(id));
    if (waiting.has(id)) { const at = queue.indexOf(id); if (urgent && at > 0) { queue.splice(at, 1); queue.unshift(id); } return waiting.get(id).promise; }
    let done; const promise = new Promise(ok => { done = ok; });
    waiting.set(id, { promise, done });
    // (el blanco y negro es una sola curva: se calcula en el acto)
    if (physics.STOCKS[id.split(':')[0]].kind === 'mono') { finish(id, null); return promise; }
    try {
      if (!worker && !workerDead) {
        worker = new Worker('./film.js');
        worker.onmessage = event => { busy = ''; finish(event.data.id, event.data.data); pump(); };
        worker.onerror = () => { workerDead = true; worker = null; busy = ''; queue.length = 0; for (const key of [...waiting.keys()]) finish(key, null); };
      }
      if (urgent) queue.unshift(id); else queue.push(id);
      pump();
    } catch (_) { workerDead = true; worker = null; busy = ''; queue.length = 0; for (const key of [...waiting.keys()]) finish(key, null); }
    return promise;
  }
  // Qué tablas son: película, empuje, papel, filtro y virado. Lo que a una película no le toca se deja
  // en su valor de fábrica (una diapositiva no lleva papel; el filtro y el virado son del blanco y negro).
  const idOf = (key, push, paper, filter, toner) => { const kind = physics.STOCKS[key].kind, mono = kind === 'mono'; return [key, push, kind === 'reversal' ? 1 : paper, mono ? filter | 0 : 0, mono ? toner | 0 : 0].join(':'); };
  // Deja en la GPU las tablas de esa película. Si aún se están calculando: con «sync» las calcula en el
  // acto; sin él, devuelve la película que ya estaba cargada (o nada, si no había ninguna).
  function loadFilm(key, push, paper, filter, toner, sync) {
    const gl = G.gl, id = idOf(key, push, paper, filter, toner);
    if (G.film === id && made.has(id)) return made.get(id);
    if (!made.has(id)) {
      if (sync) put(id, null);
      else { ask(id, true); if (!made.has(id)) return G.film && made.get(G.film) || null; }
    }
    const set = made.get(id), rows = new Float32Array(physics.XN * 4 * 6);
    [set.curves.density, set.curves.noise, set.curves.coarse, set.curves.fine, set.curves.qFast, set.curves.qMid].forEach((row, i) => rows.set(row, physics.XN * 4 * i));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.tex.curves);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, physics.XN, 6, 0, gl.RGBA, gl.FLOAT, rows);
    gl.bindTexture(gl.TEXTURE_3D, G.tex.print);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, set.print.size, set.print.size, set.print.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, set.print.data);
    G.film = id;
    return set;
  }
  // Revela «source» y lo deja en el lienzo del motor (w × h).
  //   o: { stock, ev, push, format (0…5), live (vista previa: menos huecos por celda al dibujar cristales), paper (0…2), filter (0…4), toner (0…4), grain, mirror, crop [x, y, w, h] en 0…1, seed, mode (0 copia, 1 negativo, 2 exposición) }
  function develop(source, w, h, o) {
    const gl = G.gl, set = loadFilm(o.stock, o.push, clamp(o.paper == null ? 1 : o.paper | 0, 0, 2), o.filter | 0, o.toner | 0, o.sync);
    if (!set) return null;
    const { film } = set, stock = film.stock;
    if (G.canvas.width !== w || G.canvas.height !== h) { G.canvas.width = w; G.canvas.height = h; }
    const format = physics.FORMATS[clamp(o.format == null ? physics.F35 : o.format | 0, 0, NFMT)], upp = format.mm * 1000 / Math.max(w, h);   // micras de película por punto
    const range = film.curves.map(c => c.range), shift = film.shiftAt(o.ev);
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
      const blur = (from, to, tw, th, dx, dy, lod, sig) => { const sg = Array.isArray(sig) ? sig : [sig, sig, sig].map(v => Math.max(0.35, v)); target(to, tw, th); common(G.prog.blur); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.tex[from]); gl.uniform1i(G.prog.blur.u.uTex, 1); gl.uniform2f(G.prog.blur.u.uStep, dx, dy); gl.uniform1f(G.prog.blur.u.uLod, lod); gl.uniform3f(G.prog.blur.u.uSigma, sg[0], sg[1], sg[2]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
      // 1 · exponer
      target(format.small ? 'H0' : 'H', w, h); common(G.prog.expose); exposing(G.prog.expose);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 1b · cine chico: la emulsión dispersa la luz unas micras, y aquí unas micras ya son puntos
      if (format.small) {
        const spread = physics.SCATTER[stock.kind] / upp, by = film.mono ? [1, 1, 1] : physics.SCATTER_LAYER, sig = by.map(f => Math.max(0.3, spread * f));
        blur('H0', 's1', w, h, 1 / w, 0, 0, sig);
        blur('s1', 'H', w, h, 0, 1 / h, 0, sig);
      }
      gl.bindTexture(gl.TEXTURE_2D, G.tex.H); gl.generateMipmap(gl.TEXTURE_2D);
      // 2 · halación: el rebote cae a «radius» micras; se desenfoca sobre una copia reducida
      const sigma = stock.halation.radius / upp * 0.6, level = clamp(Math.round(Math.log2(Math.max(1, sigma / 2.4))), 0, 6), f = 1 << level;
      const bw = Math.max(2, Math.ceil(w / f)), bh = Math.max(2, Math.ceil(h / f)), st = sigma / f;
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
      gl.bindTexture(gl.TEXTURE_2D, G.tex.first); gl.generateMipmap(gl.TEXTURE_2D);
      blur('first', 'd', hw, hh, 1 / hw, 0, 0, ds);
      blur('d', 'spread', hw, hh, 0, 1 / hh, 0, ds);
      // 4b · el baño: la misma densidad, promediada a la distancia a la que se gasta el revelador
      if (stock.edge) {
        const reach = (stock.edgeRadius || 260) / upp / 2, lod = clamp(Math.round(Math.log2(Math.max(1, reach / 2.4))), 0, 6), ef = 1 << lod;
        const ew = Math.max(2, Math.ceil(hw / ef)), eh = Math.max(2, Math.ceil(hh / ef));
        blur('first', 'e', ew, eh, 1 / ew, 0, lod, reach / ef);
        blur('e', 'bath', ew, eh, 0, 1 / eh, 0, reach / ef);
      }
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
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, stock.edge ? G.tex.bath : G.tex.spread); gl.uniform1i(P.u.uBath, 6);
      gl.uniform1f(P.u.uEdge, stock.edge || 0);
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
    gl.uniform1f(P.u.uSeed, o.seed || 0); gl.uniform1f(P.u.uMode, o.mode || 0); gl.uniform1f(P.u.uMono, film.mono ? 1 : 0);
    gl.uniform2f(P.u.uRes, w, h);
    const tie = physics.tieOf(stock);
    gl.uniform2f(P.u.uTie, Math.sqrt(tie), Math.sqrt(1 - tie));
    // (en la vista previa, si el teléfono no llega a 20 cuadros por segundo dibujando cristales, se le
    //  piden menos por celda y, si ni así, el grano vuelve a sortearse como en los formatos grandes; la
    //  foto los dibuja siempre)
    const tier = o.live ? S.tier : 0;
    if (format.small && o.grain !== false && tier < 2) {
      // cristal a cristal: el radio de cada nube en puntos (nunca menos de lo que un punto puede enseñar),
      // cuántos cristales caben en una celda de ese lado, y la fuerza que le toca a una nube de ese tamaño
      const rc = Math.max(1.25, physics.CLOUD.coarse / upp), rf = Math.max(1.25, physics.CLOUD.fine / upp), rho = stock.grain.rho;
      const perCell = (density, r) => [0, 1, 2].map(c => density * physics.layerSize(film, c) * Math.pow(r * upp, 2));
      const mc = perCell(rho[0], rc), mf = perCell(rho[1], rf);
      gl.uniform4f(P.u.uCry, rc, o.live ? 3 - tier : 4, film.reversal ? -1 : 1, 0.757 / (rc * upp));
      gl.uniform3f(P.u.uCryF, rf, o.live ? 2 - tier : 3, 0.757 / (rf * upp));
      gl.uniform3f(P.u.uMc, mc[0], mc[1], mc[2]); gl.uniform3f(P.u.uMf, mf[0], mf[1], mf[2]);
    } else gl.uniform4f(P.u.uCry, 0, 0, 1, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return G.canvas;
  }

  // ── La cámara FILM ──────────────────────────────────────────────────────────────────────────────
  const S = { ev: 0, push: 0, format: physics.F35, paper: 1, filter: 0, toner: 0, grain: true, frame: 0, ms: 0, tier: 0, gap: 0, last: 0, slow: 0 };
  const NF = physics.FILTERS.length - 1, NT = physics.TONERS.length - 1;
  // (lo guardado antes de los dos formatos de cine chico no lleva «v»: su lista empezaba en medio cuadro)
  try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved && typeof saved === 'object') { S.ev = clamp(+saved.ev || 0, -2, 2); S.push = clamp(Math.round(+saved.push || 0), -1, 2); S.format = clamp(Math.round(saved.format == null ? physics.F35 : +saved.format + (saved.v >= 2 ? 0 : 2)), 0, NFMT); S.paper = clamp(Math.round(saved.paper == null ? 1 : +saved.paper), 0, 2); S.filter = clamp(Math.round(+saved.filter || 0), 0, NF); S.toner = clamp(Math.round(+saved.toner || 0), 0, NT); S.grain = saved.grain !== false; } } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 2, ev: S.ev, push: S.push, format: S.format, paper: S.paper, filter: S.filter, toner: S.toner, grain: S.grain })); } catch (_) {} };
  const mine = key => idOf(key, S.push, S.paper, S.filter, S.toner);
  function renderFilm(source, srcW, srcH, ctx, mirror, variant, options) {
    if (!ensureGl()) return false;
    const started = performance.now(), opts = options || {};
    const outW = Math.max(1, Math.round(opts.outW || ctx.canvas.width)), outH = Math.max(1, Math.round(opts.outH || ctx.canvas.height));
    const capture = opts.path === 'capture';
    // Resolución interna: la de la salida, con tope. La vista previa se revela a su tamaño de verdad
    // (1024 puntos): revelada más pequeña y ampliada después, el grano llegaba emborronado, hecho velo.
    const cap = capture ? 2560 : 1280, scale = Math.min(1, cap / Math.max(outW, outH));
    const w = Math.max(16, Math.round(outW * scale)), h = Math.max(16, Math.round(outH * scale));
    const [sx, sy, sw, sh] = typeof cropCoordsForDims === 'function' ? cropCoordsForDims(srcW, srcH, w, h) : [0, 0, srcW, srcH];
    const stock = physics.STOCKS[variant] ? variant : 'RETRATO400';
    let ready;
    try {
      // (la foto espera a su película; la vista previa sigue con la que hubiera mientras llega la nueva)
      ready = develop(source, w, h, { stock, ev: S.ev, push: S.push, format: S.format, paper: S.paper, filter: S.filter, toner: S.toner, grain: S.grain, mirror, sync: capture, live: !capture, crop: [sx / srcW, sy / srcH, sw / srcW, sh / srcH], seed: capture ? 7.31 : (Math.floor(started / 42) % 211) * 1.37 });
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
    if (ready && !S.warmed) { S.warmed = true; for (const key of Object.keys(physics.STOCKS)) ask(mine(key)); }
    if (ready) { S.frame++; S.ms += (performance.now() - started - S.ms) * 0.1; }
    // El ritmo de la vista previa con cristales dibujados: si va lenta un buen rato, se baja un escalón.
    if (ready && !capture) {
      const gap = started - S.last; S.last = started;
      if (physics.FORMATS[S.format].small && S.grain && gap > 0 && gap < 500) {
        S.gap += (gap - S.gap) * (S.gap ? 0.1 : 1);
        S.slow = S.gap > 50 ? S.slow + 1 : 0;
        if (S.slow > 45 && S.tier < 2) { S.tier++; S.slow = 0; S.gap = 0; }
      } else { S.gap = 0; S.slow = 0; }
    }
    return true;
  }

  // La película de siempre se va calculando en cuanto la app está quieta, para que entrar a FILM sea inmediato.
  setTimeout(() => { try { ask(mine(typeof camFamily !== 'undefined' && camFamily === 'FILM' && physics.STOCKS[camVariant] ? camVariant : 'RETRATO400')); } catch (_) {} }, 1800);

  // Los mandos (su panel está en la página; la consola los vuelve perillas).
  const signed = (v, digits) => (v > 0 ? '+' : v < 0 ? '-' : '') + (digits && Math.abs(v) % 1 ? Math.abs(v).toFixed(1) : String(Math.round(Math.abs(v))));
  const KNOBS = [
    ['filmEv', 'vFilmEv', () => Math.round(S.ev * 3), v => { S.ev = clamp(v / 3, -2, 2); }, v => signed(v / 3, 1)],
    ['filmPush', 'vFilmPush', () => S.push, v => { S.push = clamp(v, -1, 2); }, v => signed(v)],
    ['filmFormat', 'vFilmFormat', () => S.format, v => { S.format = clamp(v, 0, NFMT); }, v => physics.FORMATS[v].name],
    ['filmPaper', 'vFilmPaper', () => S.paper, v => { S.paper = clamp(v, 0, 2); }, v => physics.PAPERS[v].name, kind => kind !== 'reversal'],
    ['filmFilter', 'vFilmFilter', () => S.filter, v => { S.filter = clamp(v, 0, NF); }, v => physics.FILTERS[v].name, kind => kind === 'mono'],
    ['filmToner', 'vFilmToner', () => S.toner, v => { S.toner = clamp(v, 0, NT); }, v => physics.TONERS[v].name, kind => kind === 'mono'],
    ['filmGrain', 'vFilmGrain', () => (S.grain ? 1 : 0), v => { S.grain = v > 0; }, v => (v ? 'SÍ' : 'NO')],
  ];
  // (cada película enseña solo los mandos que le tocan: una diapositiva no lleva papel; el filtro y el
  //  virado son del blanco y negro)
  function syncUI() {
    const stock = typeof camFamily !== 'undefined' && camFamily === 'FILM' && physics.STOCKS[camVariant], kind = stock ? stock.kind : 'negative';
    for (const [id, out, get, , text, when] of KNOBS) {
      const input = $(id), value = get(); if (!input) continue;
      if (+input.value !== value) input.value = value;
      const label = $(out); if (label) label.textContent = text(value);
      const row = input.closest('.film-ctrl-row'), hide = !!when && !when(kind);
      if (row && row.hidden !== hide) row.hidden = hide;
    }
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
      return develop(source, w, h, { stock: options.stock || 'RETRATO400', ev: options.ev || 0, push: options.push || 0, format: options.format == null ? physics.F35 : options.format, live: !!options.live, paper: options.paper, filter: options.filter, toner: options.toner, grain: options.grain, mirror: false, sync: true, seed: options.seed == null ? 7.31 : options.seed, mode: options.mode || 0 });
    },
    // Lee el lienzo del motor (RGBA de 8 bits, de arriba abajo).
    read() { const gl = G.gl, w = G.canvas.width, h = G.canvas.height, raw = new Uint8Array(w * h * 4), out = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw); for (let y = 0; y < h; y++) out.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); return { data: out, w, h }; },
    set(values) { if (values.ev != null) S.ev = clamp(+values.ev, -2, 2); if (values.push != null) S.push = clamp(Math.round(+values.push), -1, 2); if (values.format != null) S.format = clamp(Math.round(+values.format), 0, NFMT); if (values.paper != null) S.paper = clamp(Math.round(+values.paper), 0, 2); if (values.filter != null) S.filter = clamp(Math.round(+values.filter), 0, NF); if (values.toner != null) S.toner = clamp(Math.round(+values.toner), 0, NT); if (values.grain != null) S.grain = !!values.grain; save(); syncUI(); return this.settings(); },
    // Avisa cuando las tablas de una película están listas (por omisión, con los ajustes puestos).
    ready: (stock, push = S.push, paper = S.paper, filter = S.filter, toner = S.toner) => ask(idOf(physics.STOCKS[stock] ? stock : 'RETRATO400', push, paper, filter, toner)).then(() => true),
    settings: () => ({ ev: S.ev, push: S.push, format: S.format, paper: S.paper, filter: S.filter, toner: S.toner, grain: S.grain }),
    state: () => ({ worker: !!worker, waiting: waiting.size, made: made.size, gl: !!G.gl, float: G.float, failed: G.failed, lost: G.lost, frame: S.frame, ms: +S.ms.toFixed(2), film: G.film, size: G.canvas ? [G.canvas.width, G.canvas.height] : null, tier: S.tier, gap: Math.round(S.gap) }),
  };
})();
