// FLIP · CUARTO: tu cámara sale en la pantalla encendida de un cuarto a oscuras.
//
// No es un filtro sobre la imagen: es un cuarto en 3D, armado aquí con cajas y planos y pintado como
// lo pintaba una consola de 32 bits. Lo que ve la cámara del teléfono sale EN VIVO en la pantalla
// de ese cuarto (el televisor, el monitor, el anuncio de la azotea), y esa pantalla es la luz del
// cuarto: su color medio tiñe lo que tiene delante (si la cámara ve algo rojo, el cuarto se pone rojo).
// Tres escenas, cada una con su pantalla:
//   · DORMITORIO  cama, cómoda, televisor de tubo, persiana con luz de luna, ventilador de techo
//                 que gira, ventana con estrellas.
//   · OFICINA     escritorio, computadora de tubo con teclado, luminarias de techo, mamparas y
//                 una ventana a la ciudad.
//   · AZOTEA      barandal con malla, edificios con ventanas encendidas, torre lejana, cielo con
//                 estrellas y un anuncio luminoso grande.
// Lo que hacía aquella máquina, hecho de verdad:
//   · imagen interna fija de 320 de lado largo, ampliada sin suavizar (también en la foto: el píxel
//     gordo no se afina al pedir más resolución);
//   · vértices pegados a la rejilla de píxeles: los polígonos tiemblan cuando la cámara se mueve;
//   · texturas SIN corrección de perspectiva: la coordenada viaja multiplicada por w y se divide en
//     cada píxel por la w interpolada en pantalla, así que se interpola en línea recta sobre la
//     pantalla (afín) y se tuerce en los polígonos grandes, como entonces; leídas al vecino, 64 × 64;
//   · luz calculada por vértice (paredes y suelos van partidos para que el degradado se vea a tramos);
//   · niebla negra índigo por distancia;
//   · color a 5 bits por canal con tramado ordenado de 4 × 4, que se ve en la penumbra;
//   · y un resplandor ancho que sale solo de lo que emite luz (la pantalla, las luminarias, las
//     ventanas): cada superficie lleva en el canal alfa cuánto emite y de ahí bebe el resplandor.
// La cámara 3D pasea sola por un recorrido corto y cerrado (se acerca a la pantalla, mira arriba,
// se aleja), determinista en función del tiempo; el encuadre se abre en vertical para que la
// pantalla y el cuarto compongan igual en un teléfono que en horizontal.
//
//   renderCuarto(fuente, anchoFuente, altoFuente, ctx2d, espejo, variante, opciones) → false sin gráfica
//   opciones (todas opcionales; de 0 a 1): giro (velocidad del paseo, 0,35; 0 = quieta en el plano
//     de presentación), luz (cuánto alumbra la pantalla, 0,7), trama (tramado, 0,6), temblor
//     (vértices a la rejilla, 0,5); now, path, outW, outH; audio: { bass, mid, treble, beat }.
//   Con sonido: el golpe hace destellar la pantalla (y la luz que echa sobre el cuarto) con una franja
//   que baja por el tubo; los graves empujan el paseo y suben la luz; los medios hacen temblar más los
//   polígonos; los agudos hacen titilar las estrellas.
//   Con espejo, la imagen de la pantalla va espejada; el cuarto no.
(function () {
  'use strict';

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const FABRICA = { giro: 0.35, luz: 0.7, trama: 0.6, temblor: 0.5 };
  const LARGO = 320;       // lado largo de la imagen interna, en visor y en foto
  const CICLO = 30;        // segundos de una vuelta del paseo con el giro de fábrica

  // ── Vectores y matrices (por columnas, como las pide WebGL) ──────────────────
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mulS = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function lookAt(eye, at, roll) {
    const z = norm(sub(eye, at)), x0 = norm(cross([0, 1, 0], z)), y0 = cross(z, x0);
    // (giro sobre el eje de la mirada: el plano «inclinado» de cámara en mano)
    const c = Math.cos(roll || 0), sn = Math.sin(roll || 0), x = add(mulS(x0, c), mulS(y0, sn)), y = add(mulS(y0, c), mulS(x0, -sn));
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }
  function mat4mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
    return o;
  }
  // Giros de 3 × 3 por filas, para armar piezas torcidas.
  const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
  const m3 = (a, b) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]); return o; };
  const ID3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  // ── Texturas propias, hechas aquí píxel a píxel ─────────────────────────────
  // Un atlas de 256 × 512 con 32 baldosas de 64 × 64. El alfa de cada texel dice qué es: 255 opaco,
  // 128 emite luz (las ventanas encendidas, las estrellas, los focos) y 0 hueco (la malla, las hojas).
  // Se sube como bytes crudos, sin pasar por un lienzo 2D, para que el alfa no altere el color.
  const T = {
    liso: 0, madera: 1, cuadros: 2, rayada: 3, teclas: 4, ladrillo: 5, ventanas: 6, alfombra: 7,
    persiana: 8, estrellas: 9, concreto: 10, malla: 11, tablero: 12, plafon: 13, luminaria: 14, cartelA: 15,
    cartelB: 16, cartelC: 17, colcha: 18, cajones: 19, rejilla: 20, focos: 21, ventanas2: 22, planta: 23,
    rayos: 24, papel: 25, metal: 26, oficinas: 27, cartelD: 28, cartelE: 29, bolsa: 30, cinta: 31,
  };
  const AW = 256, AH = 512, TS = 64, TAU = Math.PI * 2;
  function hash2(x, y, s) {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  // Ruido de valor que se repite cada 64 texels (la baldosa casa con sus vecinas).
  function vnoise(x, y, cell, s) {
    const n = TS / cell, gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const w = (i, j) => hash2(((i % n) + n) % n, ((j % n) + n) % n, s);
    return (w(x0, y0) * (1 - sx) + w(x0 + 1, y0) * sx) * (1 - sy) + (w(x0, y0 + 1) * (1 - sx) + w(x0 + 1, y0 + 1) * sx) * sy;
  }
  const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const shade = (c, k, d = 0) => [c[0] * k + d, c[1] * k + d, c[2] * k + d];
  function makeAtlas() {
    const data = new Uint8Array(AW * AH * 4);
    const wood = (x, y, s) => {
      const g = y + 2.5 * Math.sin(x * TAU / 64 * 2 + vnoise(x, y, 16, s) * 4);
      const ring = 0.5 + 0.5 * Math.sin(g * 1.1 + vnoise(x, y, 8, s + 1) * 3);
      const n = (hash2(x, y, s + 2) - 0.5) * 14;
      return [118 + ring * 36 + n, 70 + ring * 22 + n * 0.6, 42 + ring * 12 + n * 0.4];
    };
    // estrellas: unas pocas, de brillo distinto; las más fuertes con cruz
    const stars = new Float32Array(TS * TS);
    for (let i = 0; i < 30; i++) {
      const sx = Math.floor(hash2(i, 1, 21) * TS), sy = Math.floor(hash2(i, 2, 21) * TS), b = hash2(i, 3, 21);
      stars[sy * TS + sx] = Math.max(stars[sy * TS + sx], 0.35 + 0.65 * b);
      if (b > 0.86) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = ((sy + dy + TS) % TS) * TS + (sx + dx + TS) % TS; stars[k] = Math.max(stars[k], 0.32); }
    }
    // hojas de la planta: elipses torcidas alrededor de un tallo
    const leaves = [];
    for (let i = 0; i < 9; i++) leaves.push({ x: 32 + (hash2(i, 5, 31) - 0.5) * 30, y: 18 + hash2(i, 6, 31) * 36, a: (hash2(i, 7, 31) - 0.5) * 2.4, l: 9 + hash2(i, 8, 31) * 7, g: hash2(i, 9, 31) });
    const P = {
      liso: (x, y) => { const v = 182 + (hash2(x >> 1, y >> 1, 1) - 0.5) * 14; return [v, v, v]; },
      madera: (x, y) => wood(x, y, 3),
      cuadros: (x, y) => {
        const bx = x % 32, by = y % 32, band = t => t >= 3 && t < 13;
        let c = [196, 186, 214];
        if (band(bx)) c = mixc(c, [74, 60, 124], 0.62);
        if (band(by)) c = mixc(c, [74, 60, 124], 0.62);
        if (bx === 20 || by === 20) c = mixc(c, [236, 140, 170], 0.7);
        return shade(c, 1, ((x + y) & 1) ? 6 : -6);
      },
      rayada: (x, y) => {
        const sx = x % 16;
        let c = sx < 8 ? [158, 146, 188] : [126, 114, 162];
        if (sx === 0 || sx === 8) c = [104, 94, 138];
        if (sx >= 3 && sx < 6 && ((y + (x >> 4) * 8) % 16) === 4) c = [184, 172, 212];
        return shade(c, 1, (hash2(x, y, 4) - 0.5) * 10);
      },
      teclas: (x, y) => {
        const kx = x % 8, ky = y % 8;
        if (kx < 1 || kx > 6 || ky < 1 || ky > 6) return [52, 50, 60];
        if (kx === 1 || ky === 1) return [206, 204, 214];
        if (kx === 6 || ky === 6) return [138, 136, 150];
        return [178, 176, 188];
      },
      ladrillo: (x, y) => {
        const row = y >> 3, bx = (x + (row & 1) * 8) % 16, by = y % 8, id = ((x + (row & 1) * 8) >> 4) & 3;
        if (bx === 0 || by === 0) return [92, 88, 94];
        const v = (hash2(id, row, 5) - 0.5) * 30, n = (hash2(x, y, 6) - 0.5) * 14;
        return [128 + v + n, 58 + v * 0.4 + n, 46 + v * 0.3 + n];
      },
      ventanas: (x, y) => {
        const cx = x % 16, cy = y % 8, col = x >> 4, row = y >> 3, n = (hash2(x, y, 10) - 0.5) * 8;
        if (cx >= 3 && cx < 13 && cy >= 2 && cy < 7) {
          const r = hash2(col, row, 11);
          if (r < 0.32 && !(r > 0.24 && cy >= 5)) {                 // encendida (algunas con la persiana a medio bajar)
            const t = hash2(col, row, 12);
            return t < 0.12 ? [200, 222, 255, 128] : [255, 196 + t * 44, 104 + t * 70, 128];
          }
          return [22, 26, 44];
        }
        return [38 + n, 36 + n, 50 + n];
      },
      alfombra: (x, y) => { const v = vnoise(x, y, 4, 7) * 20 + (hash2(x, y, 8) - 0.5) * 36; return [78 + v, 70 + v, 98 + v]; },
      persiana: (x, y) => {
        const sy = y % 8;
        let c = sy < 6 ? [228 - sy * 8, 232 - sy * 8, 246 - sy * 6] : [16, 16, 30];
        if (x % 32 === 15) c = shade(c, 0.7);
        return sy < 6 ? [c[0], c[1], c[2], 190] : c;
      },
      estrellas: (x, y) => {
        const s = stars[y * TS + x];
        if (!s) return [5, 5, 14];
        const v = s > 0.7 ? [236, 238, 255] : [150 * s + 60, 156 * s + 60, 200 * s + 50];
        return [v[0], v[1], v[2], 128];
      },
      concreto: (x, y) => {
        let v = 100 + vnoise(x, y, 16, 31) * 28 + vnoise(x, y, 4, 32) * 12 + (hash2(x, y, 33) - 0.5) * 14;
        if (Math.abs(y - (22 + 6 * Math.sin(x * TAU / 64))) < 0.7) v -= 30;
        return [v, v - 2, v + 8];
      },
      malla: (x, y) => {
        const u = (x + y) & 15, v = (x - y + 64) & 15;
        if (u >= 2 && v >= 2) return [0, 0, 0, 0];
        const k = u === 0 || v === 0 ? 1.15 : 0.82;
        return [150 * k, 152 * k, 172 * k];
      },
      tablero: (x, y) => { let v = (hash2(x, y, 41) - 0.5) * 20 + ((y & 1) ? 5 : -5) + vnoise(x, y, 8, 42) * 10; if (x < 2) v -= 26; return [98 + v, 94 + v, 140 + v]; },
      plafon: (x, y) => {
        if (x % 32 === 0 || y % 32 === 0) return [118, 116, 130];
        if (hash2(x, y, 51) < 0.06) return [150, 148, 162];
        const v = (hash2(x >> 1, y >> 1, 52) - 0.5) * 8;
        return [188 + v, 186 + v, 198 + v];
      },
      luminaria: (x, y) => {
        if (x < 3 || x > 60 || y < 3 || y > 60) return [168, 168, 178];
        if (x % 16 === 8 || y % 16 === 8) return [226, 232, 242, 128];
        return [252, 252, 248, 128];
      },
      // carteles: formas abstractas propias (sin letras, sin figuras de nadie)
      cartelA: (x, y) => {
        if (x < 3 || x > 60 || y < 3 || y > 60) return [222, 220, 228];
        let c = [24 + y * 0.3, 26, 64 + y * 0.5];
        if (Math.hypot(x - 32, y - 26) < 15 && !(y > 26 && y % 4 === 0)) { const t = (y - 11) / 30; c = [250, 150 - 70 * t, 60 + 80 * t]; }
        if (y > 42 + 7 * Math.abs(Math.sin(x * TAU / 64 * 1.5))) c = [40, 150, 160];
        if (y > 50 + 4 * Math.sin(x * TAU / 64 * 2 + 1)) c = [24, 96, 112];
        return c;
      },
      cartelB: (x, y) => {
        if (x < 3 || x > 60 || y < 3 || y > 60) return [222, 220, 228];
        const d = Math.max(Math.abs(x - 31.5), Math.abs(y - 31.5)), b = Math.floor(d / 4) % 3;
        return b === 0 ? [240, 196, 60] : b === 1 ? [36, 168, 170] : [96, 30, 66];
      },
      cartelC: (x, y) => {
        if (x < 3 || x > 60 || y < 3 || y > 60) return [222, 220, 228];
        const z = Math.abs(((x / 12) % 2) - 1) * 6;
        let c = ((y + z) % 12) < 4 ? [236, 90, 150] : [20, 18, 26];
        if (Math.abs(Math.hypot(x - 40, y - 24) - 12) < 2) c = [80, 220, 230];
        return c;
      },
      colcha: (x, y) => {
        const u = (x + y) % 16, v = (x - y + 64) % 16, d = Math.min(u, 16 - u, v, 16 - v);
        if (d === 0) return [168, 160, 196];
        const c = 196 + d * 4;
        return [c, c - 6, c + 18];
      },
      cajones: (x, y) => {
        let c = wood(x, y, 13);
        if (x < 3 || x > 60 || y < 3 || y > 60) c = shade(c, 0.55);
        else if (x === 3 || y === 3) c = shade(c, 1.2);
        if (x >= 22 && x < 42 && y >= 28 && y < 34) c = (x === 22 || x === 41 || y === 28 || y === 33) ? [110, 88, 40] : [206, 172, 92];
        return c;
      },
      rejilla: (x, y) => (y % 4 < 2 && x > 2 && x < 61 ? [14, 14, 20] : [52, 50, 60]),
      focos: (x, y) => {
        const d = Math.hypot((x % 16) - 7.5, (y % 16) - 7.5);
        return d < 4.5 ? [255, 236 - d * 8, 176 - d * 10, 128] : [40, 38, 48];
      },
      ventanas2: (x, y) => {
        const cy = y % 8, seg = x >> 4, row = y >> 3;
        if (cy >= 2 && cy < 6 && x % 8 !== 0) {
          if (hash2(seg, row, 61) < 0.36) { const t = hash2(seg, row, 62); return t < 0.7 ? [255, 222 + t * 30, 150 + t * 50, 128] : [196, 218, 255, 128]; }
          return [20, 26, 40];
        }
        return [30, 34, 48];
      },
      planta: (x, y) => {
        if (Math.abs(x - 32) < 1.2 && y > 34) return [50, 90, 50];
        for (const l of leaves) {
          const dx = x - l.x, dy = y - l.y, c = Math.cos(l.a), s = Math.sin(l.a), u = dx * c + dy * s, v = -dx * s + dy * c;
          if ((u * u) / (l.l * l.l) + (v * v) / 9 < 1) return [36 + l.g * 30, 104 + l.g * 50 + u, 56 + l.g * 20];
        }
        return [0, 0, 0, 0];
      },
      rayos: x => { const sx = x % 8, v = sx < 3 ? 255 : sx === 3 || sx === 7 ? 90 : 0; return [v, v, v]; },
      papel: (x, y) => (y % 6 === 3 && x > 6 && x < 58 - Math.floor(hash2(y, 1, 71) * 20) ? [150, 150, 165] : [226, 226, 232]),
      metal: (x, y) => { const v = 90 + (hash2(0, y, 81) - 0.5) * 24 + (hash2(x, y, 82) - 0.5) * 8; return [v, v, v + 8]; },
      cartelD: (x, y) => {
        if (x < 3 || x > 60 || y < 3 || y > 60) return [222, 220, 228];
        if (Math.hypot(x - 20, y - 18) < 8) return [240, 236, 220];
        const k = x + y;
        if (k > 56 && k < 96) return [[236, 72, 92], [246, 150, 60], [244, 220, 80], [70, 190, 130], [70, 120, 220]][Math.floor((k - 56) / 8)];
        return [18, 60, 70];
      },
      cartelE: (x, y) => {
        if (x < 3 || x > 60 || y < 3 || y > 60) return [222, 220, 228];
        if (y > 50) return [24, 22, 30];
        const cx = (x - 3) % 12, cy = (y - 3) % 12, alt = (Math.floor((x - 3) / 12) + Math.floor((y - 3) / 12)) & 1;
        if (cy > cx) return alt ? [96, 40, 124] : [232, 118, 60];
        return [232, 212, 172];
      },
      // una bolsa de botana arrugada: brillos en los pliegues y una franja clara, sin letras ni marca
      bolsa: (x, y) => {
        const f = Math.sin(x * TAU / 64 * 3 + Math.sin(y * TAU / 64 * 2) * 2.2) * 0.5 + Math.sin((x + y) * TAU / 64 * 2) * 0.3;
        let c = [212 + f * 40, 74 + f * 34, 44 + f * 20];
        if (y > 26 && y < 38) c = [244 + f * 10, 214 + f * 30, 110 + f * 30];
        if (y < 4 || y > 59) c = ((x >> 1) & 1) ? [150, 50, 34] : [236, 120, 80];
        return c;
      },
      // el lomo de una caja de cinta: plástico negro con su etiqueta en blanco (sin letras)
      cinta: (x, y) => {
        if (x > 8 && x < 56 && y > 14 && y < 50) return y > 20 && y < 26 ? [196, 70, 90] : [222, 216, 200];
        return [28, 28, 34];
      },
      // oficinas encendidas de noche: tiras de ventanas, casi todas con la luz prendida
      oficinas: (x, y) => {
        const cy = y % 8, seg = x >> 3, row = y >> 3;
        if (cy >= 2 && cy < 6 && x % 8 !== 0) {
          if (hash2(seg, row, 91) < 0.68) { const t = hash2(seg, row, 92); return t < 0.8 ? [255, 228 + t * 26, 168 + t * 50, 128] : [206, 226, 255, 128]; }
          return [26, 30, 46];
        }
        return [44, 44, 58];
      },
    };
    for (const name of Object.keys(T)) {
      const paint = P[name], idx = T[name], ox = (idx % 4) * TS, oy = Math.floor(idx / 4) * TS;
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const c = paint(x, y), k = ((oy + y) * AW + ox + x) * 4;
        data[k] = clamp(Math.round(c[0]), 0, 255); data[k + 1] = clamp(Math.round(c[1]), 0, 255); data[k + 2] = clamp(Math.round(c[2]), 0, 255);
        data[k + 3] = c.length > 3 ? c[3] : 255;
      }
    }
    return data;
  }

  // ── Geometría: cajas y planos ───────────────────────────────────────────────
  // Cada vértice: posición, normal, coordenada de textura (en baldosas), color del vértice y
  // material (baldosa, cuánto emite, tipo, cuánto resplandece). Tipos: 0 normal, 1 la pantalla,
  // 2 cielo (sin niebla, las estrellas titilan), 3 recorte (la malla, las hojas), 4 luz que parpadea.
  const STRIDE = 15;
  const WHITE = [1, 1, 1];
  function Builder() {
    const segs = { fijo: [], aspa: [], luz: [] };
    let cur = segs.fijo, R = ID3, Tr = [0, 0, 0];
    const tp = p => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + Tr[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + Tr[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + Tr[2]];
    const tn = n => [R[0] * n[0] + R[1] * n[1] + R[2] * n[2], R[3] * n[0] + R[4] * n[1] + R[5] * n[2], R[6] * n[0] + R[7] * n[1] + R[8] * n[2]];
    const matv = m => [m.tile || 0, m.emis || 0, m.kind || 0, m.glow == null ? 1 : m.glow];
    function vert(p, n, uv, c, m) { const q = tp(p), k = tn(n); cur.push(q[0], q[1], q[2], k[0], k[1], k[2], uv[0], uv[1], c[0], c[1], c[2], m[0], m[1], m[2], m[3]); }
    const B = {
      pantalla: null,
      seg(name) { cur = segs[name]; },
      // dibuja dentro de un giro (filas 3 × 3) y un traslado
      xf(rot, t, fn) { const oR = R, oT = Tr; R = rot; Tr = t; fn(); R = oR; Tr = oT; },
      // un plano desde la esquina o con los lados U y W (la normal es U × W); se parte en celdas
      quad(o, U, W, mat) {
        mat = mat || {};
        const lu = len(U), lv = len(W), n = norm(cross(U, W)), uh = mulS(U, 1 / lu), vh = mulS(W, 1 / lv);
        const nu = mat.div ? mat.div[0] : mat.cell ? Math.max(1, Math.round(lu / mat.cell)) : 1;
        const nv = mat.div ? mat.div[1] : mat.cell ? Math.max(1, Math.round(lv / mat.cell)) : 1;
        const rep = mat.rep || [1, 1], m = matv(mat);
        const P = (s, t) => {
          let p = add(add(o, mulS(U, s)), mulS(W, t));
          if (mat.bulge) p = add(p, mulS(n, mat.bulge * (1 - (2 * s - 1) ** 2) * (1 - (2 * t - 1) ** 2)));
          return p;
        };
        // la textura va pegada al mundo (las piezas de una pared casan) salvo que se pida 0…1
        const UV = (s, t, p) => (mat.uv ? [mat.uv[0] + s * (mat.uv[2] - mat.uv[0]), mat.uv[1] + t * (mat.uv[3] - mat.uv[1])] : [dot(p, uh) * rep[0], dot(p, vh) * rep[1]]);
        const C = (s, t, p) => (mat.colFn ? mat.colFn(tp(p), s, t) : mat.col || WHITE);
        for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
          const q = [[i / nu, j / nv], [(i + 1) / nu, j / nv], [(i + 1) / nu, (j + 1) / nv], [i / nu, (j + 1) / nv]].map(([s, t]) => { const p = P(s, t); return [p, UV(s, t, p), C(s, t, p)]; });
          for (const k of [0, 1, 2, 0, 2, 3]) vert(q[k][0], n, q[k][1], q[k][2], m);
        }
      },
      // cuatro esquinas cualesquiera (abajo-izq, abajo-der, arriba-der, arriba-izq), textura 0…1
      quad4(p0, p1, p2, p3, mat) {
        const n = norm(cross(sub(p1, p0), sub(p3, p0))), m = matv(mat), c = mat.col || WHITE, uv = mat.uv || [0, 0, 1, 1];
        const q = [[p0, [uv[0], uv[1]]], [p1, [uv[2], uv[1]]], [p2, [uv[2], uv[3]]], [p3, [uv[0], uv[3]]]];
        for (const k of [0, 1, 2, 0, 2, 3]) vert(q[k][0], n, q[k][1], c, m);
      },
      // una caja de a a b; faces: { pz, nz, px, nx, py, ny } → material propio, o null para no ponerla
      box(a, b, mat, faces) {
        const [x0, y0, z0] = a, [x1, y1, z1] = b, dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
        const f = (k, o, U, W) => { const m = faces && k in faces ? faces[k] : mat; if (m) B.quad(o, U, W, m); };
        f('pz', [x0, y0, z1], [dx, 0, 0], [0, dy, 0]);
        f('nz', [x1, y0, z0], [-dx, 0, 0], [0, dy, 0]);
        f('px', [x1, y0, z1], [0, 0, -dz], [0, dy, 0]);
        f('nx', [x0, y0, z0], [0, 0, dz], [0, dy, 0]);
        f('py', [x0, y1, z1], [dx, 0, 0], [0, 0, -dz]);
        f('ny', [x0, y0, z0], [dx, 0, 0], [0, 0, dz]);
      },
      // la pantalla protagonista: un plano algo abombado que muestra la cámara (y de donde sale la luz)
      screen(o, U, W, mat) {
        B.quad(o, U, W, { ...mat, kind: 1, emis: 1, glow: 1, uv: [0, 0, 1, 1] });
        const corners = [o, add(o, U), add(add(o, U), W), add(o, W)].map(tp);
        B.pantalla = { corners, center: mulS(corners.reduce(add, [0, 0, 0]), 0.25), normal: norm(tn(cross(U, W))), aspect: len(U) / len(W), width: len(U) };
      },
      finish() {
        const all = segs.fijo.concat(segs.aspa, segs.luz), groups = {};
        let at = 0;
        for (const k of ['fijo', 'aspa', 'luz']) { const n = segs[k].length / STRIDE; groups[k] = [at, n]; at += n; }
        return { data: new Float32Array(all), groups, verts: at, tris: at / 3 };
      },
    };
    return B;
  }
  // Una pared vertical en el plano eje = plano (eje 'z': corre en x; eje 'x': corre en z), mirando
  // hacia cara (+1/-1 sobre ese eje), con un hueco opcional [a0, a1, y0, y1] para una ventana.
  function pared(B, eje, plano, cara, a0, a1, y0, y1, mat, hueco) {
    const rect = (p0, p1, q0, q1) => {
      if (p1 - p0 < 1e-3 || q1 - q0 < 1e-3) return;
      if (eje === 'z') { if (cara > 0) B.quad([p0, q0, plano], [p1 - p0, 0, 0], [0, q1 - q0, 0], mat); else B.quad([p1, q0, plano], [p0 - p1, 0, 0], [0, q1 - q0, 0], mat); }
      else if (cara > 0) B.quad([plano, q0, p1], [0, 0, p0 - p1], [0, q1 - q0, 0], mat);
      else B.quad([plano, q0, p0], [0, 0, p1 - p0], [0, q1 - q0, 0], mat);
    };
    if (!hueco) return rect(a0, a1, y0, y1);
    const [b0, b1, h0, h1] = hueco;
    rect(a0, b0, y0, y1); rect(b1, a1, y0, y1); rect(b0, b1, y0, h0); rect(b0, b1, h1, y1);
  }
  // El marco de una ventana en una pared de eje x (mirando a cara): moldura hacia el cuarto y
  // derrame hacia fuera.
  function marcoX(B, plano, cara, [b0, b1, h0, h1], mat) {
    const inn = plano + cara * 0.04, out = plano - cara * 0.09, xa = Math.min(plano, inn), xb = Math.max(plano, inn), oa = Math.min(plano, out), ob = Math.max(plano, out);
    B.box([xa, h0 - 0.07, b0 - 0.08], [xb, h0, b1 + 0.08], mat); B.box([xa, h1, b0 - 0.08], [xb, h1 + 0.07, b1 + 0.08], mat);
    B.box([xa, h0, b0 - 0.08], [xb, h1, b0], mat); B.box([xa, h0, b1], [xb, h1, b1 + 0.08], mat);
    B.box([oa, h0 - 0.05, b0], [ob, h0, b1], mat); B.box([oa, h1, b0], [ob, h1 + 0.05, b1], mat);
    B.box([oa, h0, b0 - 0.05], [ob, h1, b0], mat); B.box([oa, h0, b1], [ob, h1, b1 + 0.05], mat);
  }

  // Un cable: tramos delgados de punto a punto.
  function cable(B, pts, col) {
    const m = { tile: T.liso, col: col || [0.7, 0.7, 0.76] };
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], d = sub(pts[i], p0), L = len(d), a = mulS(d, 1 / L), ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const c2 = norm(cross(a, ref)), c1 = cross(c2, a);
      B.xf([a[0], c1[0], c2[0], a[1], c1[1], c2[1], a[2], c1[2], c2[2]], p0, () => B.box([0, -0.007, -0.007], [L, 0.007, 0.007], m, { ny: null }));
    }
  }
  // Un control de consola genérico (de nadie): cuerpo, dos asas, cruceta y cuatro botones de color.
  function mando(B, pos, rot) {
    const g = { tile: T.liso, col: [0.24, 0.24, 0.3] }, no = { ny: null };
    B.xf(rotY(rot), pos, () => {
      B.box([-0.075, 0, -0.03], [0.075, 0.03, 0.03], g, no);
      B.box([-0.088, 0, 0], [-0.045, 0.027, 0.075], g, no);
      B.box([0.045, 0, 0], [0.088, 0.027, 0.075], g, no);
      B.box([-0.056, 0.03, -0.005], [-0.028, 0.036, 0.005], { tile: T.liso, col: [0.1, 0.1, 0.12] }, no);
      B.box([-0.047, 0.03, -0.014], [-0.037, 0.036, 0.014], { tile: T.liso, col: [0.1, 0.1, 0.12] }, no);
      [[0.04, 0, [0.9, 0.3, 0.3]], [0.052, -0.012, [0.3, 0.8, 0.4]], [0.052, 0.012, [0.3, 0.45, 0.95]], [0.064, 0, [0.95, 0.82, 0.3]]].forEach(([x, z, col]) => B.box([x - 0.005, 0.03, z - 0.005], [x + 0.005, 0.037, z + 0.005], { tile: T.liso, col }, no));
    });
  }
  // Una pila de cajas de cinta, cada una un poco torcida.
  function cintas(B, pos, n, rot) {
    const lomo = { tile: T.cinta, uv: [0, 0, 1, 1], col: [0.9, 0.9, 0.95] }, tapa = { tile: T.liso, col: [0.15, 0.15, 0.19] };
    for (let i = 0; i < n; i++) B.xf(rotY(rot + (i % 2 ? 0.13 : -0.07) * (i % 3 ? 1 : -1)), [pos[0], pos[1] + i * 0.027, pos[2]], () => B.box([-0.095, 0, -0.053], [0.095, 0.026, 0.053], tapa, { pz: lomo, nz: lomo, ny: null }));
  }
  // Una bolsa arrugada: una caja aplastada con las esquinas movidas y la tapa abombada.
  function bolsa(B, pos, w, d, h, rot) {
    const m = { tile: T.bolsa, col: [1, 1, 1] }, j = (i, k) => (hash2(i, k, 77) - 0.5) * 0.25;
    B.xf(rotY(rot), pos, () => {
      const b = [[-w / 2, 0, d / 2], [w / 2, 0, d / 2], [w / 2, 0, -d / 2], [-w / 2, 0, -d / 2]];
      const t = b.map((p, i) => [p[0] * (0.92 + j(i, 1)), h * (0.55 + j(i, 2) * 2), p[2] * (0.85 + j(i, 3))]);
      const mid = (a, c) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 + h * 0.18, (a[2] + c[2]) / 2];
      const C = [j(5, 1) * w, h * 1.05, j(5, 2) * d], m01 = mid(t[0], t[1]), m12 = mid(t[1], t[2]), m23 = mid(t[2], t[3]), m30 = mid(t[3], t[0]);
      B.quad4(t[0], m01, C, m30, { ...m, uv: [0, 0, 0.5, 0.5] }); B.quad4(m01, t[1], m12, C, { ...m, uv: [0.5, 0, 1, 0.5] });
      B.quad4(C, m12, t[2], m23, { ...m, uv: [0.5, 0.5, 1, 1] }); B.quad4(m30, C, m23, t[3], { ...m, uv: [0, 0.5, 0.5, 1] });
      for (let i = 0; i < 4; i++) { const k = (i + 1) % 4; B.quad4(b[i], b[k], t[k], t[i], { ...m, uv: [0, 0.85, 1, 1] }); }
    });
  }

  // ── Las escenas ─────────────────────────────────────────────────────────────
  // Cada una arma su geometría y dice: luces (hasta 4, por vértice), luz ambiente, niebla, cuánto y
  // hasta dónde alumbra la pantalla, qué clase de pantalla es (tubo o anuncio de focos) y el
  // recorrido de la cámara (planos por los que pasa: ojo, adónde mira, campo del lado corto).
  const ESCENAS = {
    DORMITORIO(B) {
      const X = 2.0, Z0 = -3.0, Z1 = 1.6, H = 2.6;
      const muro = { tile: T.rayada, col: [0.78, 0.7, 0.98], rep: [1.2, 1], cell: 0.7 };
      const blanco = { tile: T.liso, col: [0.72, 0.7, 0.82] };
      const madera = { tile: T.madera, col: [0.86, 0.6, 0.46], rep: [2, 2] };
      const carta = (tile, o, U, W) => B.quad(o, U, W, { tile, uv: [0, 0, 1, 1], col: [0.9, 0.9, 0.95] });
      B.quad([-X, 0, Z1], [2 * X, 0, 0], [0, 0, Z0 - Z1], { tile: T.alfombra, col: [0.62, 0.55, 0.8], rep: [1.4, 1.4], cell: 0.7 });
      B.quad([-X, H, Z0], [2 * X, 0, 0], [0, 0, Z1 - Z0], { tile: T.liso, col: [0.44, 0.42, 0.6], cell: 0.8 });
      const persiana = [-2.5, -1.1, 0.95, 2.05], estrellas = [-2.2, -1.1, 1.05, 1.95];
      pared(B, 'z', Z0, 1, -X, X, 0, H, muro);
      pared(B, 'z', Z1, -1, -X, X, 0, H, muro);
      pared(B, 'x', -X, 1, Z0, Z1, 0, H, muro, persiana);
      pared(B, 'x', X, -1, Z0, Z1, 0, H, muro, estrellas);
      // la persiana, sobre la cama (luz de luna entre las lamas), y la ventana con estrellas
      B.quad([-X - 0.08, 0.95, -1.1], [0, 0, -1.4], [0, 1.1, 0], { tile: T.persiana, col: [0.78, 0.84, 1], rep: [1, 2.4], glow: 0.55 });
      marcoX(B, -X, 1, persiana, blanco);
      B.quad([X + 0.3, 0.8, -2.4], [0, 0, 1.5], [0, 1.4, 0], { tile: T.estrellas, kind: 2, glow: 0.7 });
      marcoX(B, X, -1, estrellas, blanco);
      B.box([X - 0.04, 1.47, -2.2], [X, 1.53, -1.1], blanco);
      B.box([X - 0.04, 1.05, -1.68], [X, 1.95, -1.62], blanco);
      // cómoda con seis cajones, a la derecha de la cama
      const c0 = 0.05, c1 = 1.75;
      B.box([c0, 0, Z0], [c1, 0.8, -2.45], madera);
      B.box([c0 - 0.03, 0.8, Z0], [c1 + 0.03, 0.84, -2.42], madera);
      for (const [x0, x1] of [[c0 + 0.03, 0.88], [0.92, c1 - 0.03]]) for (const [y0, y1] of [[0.06, 0.28], [0.3, 0.52], [0.54, 0.76]]) B.quad([x0, y0, -2.44], [x1 - x0, 0, 0], [0, y1 - y0, 0], { tile: T.cajones, uv: [0, 0, 1, 1], col: [0.86, 0.6, 0.46] });
      // la tele de tubo, grande: caja, rejilla del altavoz, piloto y la pantalla abombada
      const tx = 0.95, tv = { tile: T.liso, col: [0.34, 0.31, 0.4], rep: [3, 3] };
      B.box([tx - 0.45, 0.84, -2.98], [tx + 0.45, 1.54, -2.42], tv);
      B.quad([tx - 0.4, 0.86, -2.417], [0.8, 0, 0], [0, 0.05, 0], { tile: T.rejilla, uv: [0, 0, 1, 0.4], col: [0.8, 0.8, 0.9] });
      B.quad([tx + 0.36, 0.873, -2.416], [0.025, 0, 0], [0, 0.014, 0], { tile: T.liso, col: [1, 0.25, 0.2], emis: 1, glow: 0.7 });
      B.screen([tx - 0.36, 0.935, -2.417], [0.72, 0, 0], [0, 0.54, 0], { div: [4, 3], bulge: 0.035 });
      // encima de la cómoda, a la izquierda de la tele: un control con su cable y una pila de cintas
      mando(B, [0.3, 0.84, -2.62], 0.55);
      cintas(B, [0.24, 0.84, -2.86], 3, 0.15);
      cable(B, [[0.5, 0.855, -2.72], [0.36, 0.855, -2.66], [0.3, 0.855, -2.6]], [0.25, 0.25, 0.3]);
      // el cable de la tele, que cuelga por la cómoda hasta el piso
      cable(B, [[0.5, 0.86, -2.9], [0.2, 0.855, -2.75], [0.06, 0.85, -2.44], [0.035, 0.5, -2.41], [0.06, 0.012, -2.33], [0.3, 0.012, -2.0], [0.22, 0.012, -1.7]]);
      // lámpara de buró, a la derecha de la tele
      const metal = { tile: T.metal, col: [0.6, 0.58, 0.66] }, lx = 1.6, lz = -2.75;
      B.box([lx - 0.04, 0.84, lz - 0.04], [lx + 0.04, 0.86, lz + 0.04], metal);
      B.box([lx - 0.005, 0.86, lz - 0.005], [lx + 0.005, 1.04, lz + 0.005], metal);
      {
        const yb = 1.02, yt = 1.24, rb = 0.14, rt = 0.08, sh = { tile: T.liso, col: [1, 0.74, 0.46], emis: 0.62, glow: 0.8 };
        const c = (r, y) => [[lx - r, y, lz + r], [lx + r, y, lz + r], [lx + r, y, lz - r], [lx - r, y, lz - r]];
        const lo = c(rb, yb), hi = c(rt, yt);
        for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; B.quad4(lo[i], lo[j], hi[j], hi[i], sh); }
      }
      // carteles (formas propias, sin letras ni figuras de nadie)
      carta(T.cartelA, [-1.55, 1.15, -2.995], [0.6, 0, 0], [0, 0.85, 0]);
      carta(T.cartelD, [-0.78, 1.25, -2.995], [0.62, 0, 0], [0, 0.8, 0]);
      carta(T.cartelE, [0.55, 1.78, -2.995], [0.5, 0, 0], [0, 0.55, 0]);
      carta(T.cartelB, [X - 0.005, 1.2, 0.55], [0, 0, 0.62], [0, 0.85, 0]);
      carta(T.cartelE, [X - 0.005, 0.95, -0.65], [0, 0, 0.45], [0, 0.5, 0]);
      carta(T.cartelC, [-X + 0.005, 1.25, 0.25], [0, 0, -0.65], [0, 0.9, 0]);
      // repisa con cajas y libros
      B.box([1.72, 1.55, -0.7], [X, 1.58, 0.5], madera);
      const libros = [[0.62, 0.34, 0.86], [0.3, 0.62, 0.66], [0.82, 0.32, 0.36], [0.85, 0.74, 0.4], [0.45, 0.4, 0.8], [0.7, 0.7, 0.75]];
      let z = -0.66;
      libros.forEach((col, i) => { const w = 0.07 + (i % 3) * 0.04, h = 0.17 + ((i * 7) % 4) * 0.03; B.box([1.76, 1.58, z], [1.96, 1.58 + h, z + w], { tile: T.liso, col }); z += w + 0.015; });
      B.box([1.74, 1.58, 0.05], [1.98, 1.78, 0.42], { tile: T.cuadros, col: [0.55, 0.5, 0.7], rep: [3, 3] });
      // la cama, con la cabecera contra la pared de la persiana; cobija a cuadros y una bolsa encima
      B.box([-X, 0, -2.25], [0, 0.3, -0.85], madera);
      B.box([-X, 0, -2.25], [-1.93, 0.9, -0.85], madera);
      B.box([-1.95, 0.3, -2.22], [-0.03, 0.5, -0.88], { tile: T.liso, col: [0.8, 0.78, 0.92] });
      B.box([-1.9, 0.5, -2.1], [-1.5, 0.66, -1.0], { tile: T.colcha, col: [0.98, 0.96, 1], rep: [2.5, 2.5] });
      const cobija = { tile: T.cuadros, col: [0.86, 0.8, 1], rep: [2.2, 2.2], cell: 0.6 };
      B.box([-1.5, 0.5, -2.27], [0.02, 0.56, -0.83], cobija);
      B.quad([0.02, 0.16, -0.83], [0, 0, -1.44], [0, 0.4, 0], cobija);
      B.quad([-1.5, 0.16, -0.83], [1.52, 0, 0], [0, 0.4, 0], cobija);
      bolsa(B, [-0.42, 0.56, -1.3], 0.34, 0.24, 0.1, 0.5);
      // el ventilador: tallo fijo, y el cubo con sus cuatro aspas en su propio tramo (gira)
      const fx = 0.1, fz = -1.35;
      B.box([fx - 0.015, 2.32, fz - 0.015], [fx + 0.015, H, fz + 0.015], metal);
      B.box([fx - 0.07, 2.56, fz - 0.07], [fx + 0.07, H, fz + 0.07], blanco);
      B.seg('aspa');
      const aspa = { tile: T.liso, col: [0.84, 0.82, 0.9] };
      B.box([-0.1, -0.1, -0.1], [0.1, 0, 0.1], { tile: T.liso, col: [0.76, 0.74, 0.82] });
      B.box([-0.07, -0.16, -0.07], [0.07, -0.1, 0.07], { tile: T.liso, col: [0.95, 0.88, 0.7], emis: 0.3, glow: 0.35 });
      for (let k = 0; k < 4; k++) B.xf(m3(rotY(k * Math.PI / 2), rotX(0.12)), [0, 0, 0], () => B.box([0.09, -0.065, -0.065], [0.66, -0.048, 0.065], aspa));
      // franjas de luna que entran por la persiana: sobre la cama y en la pared, junto a la esquina
      B.seg('luz');
      const luna = [0.2, 0.24, 0.42];
      B.quad([-1.95, 0.566, -0.9], [1.9, 0, 0], [0, 0, -1.35], { tile: T.rayos, rep: [1.6, 1], colFn: (p, sv) => mulS(luna, 0.9 * Math.pow(1 - sv, 1.3)) });
      B.quad([-0.5, 0.75, -2.99], [0.28, 1.3, 0], [-1.42, 0, 0], { tile: T.rayos, uv: [0, 0, 9, 1], colFn: (p, sv, tv) => mulS(luna, 0.55 * tv) });
      return {
        luces: [
          { pos: [lx, 1.0, lz], col: [0.82, 0.45, 0.19], fall: 3.5 },               // la lámpara
          { pos: [-2.6, 2.2, -1.8], col: [0.24, 0.28, 0.6], fall: 0.35 },            // la luna, por la persiana (alumbra la cama, no el cuarto)
          { pos: [fx, 2.1, fz], col: [0.05, 0.045, 0.04], fall: 2 },                 // el foco del ventilador
        ],
        amb: [0.02, 0.016, 0.046], fog: [0.02, 0.016, 0.045, 2.5, 9], near: 0.06, far: 30,
        scr: { power: 4.4, fall: 1.25, kind: 0 },
        aspa: { pivot: [fx, 2.32, fz], speed: 1.5 },
        // planos: la tele de tres cuartos y desde abajo (el de presentación), muy cerca, el ventilador
        // con la tele, uno general con la cama delante, y la tele desde la derecha con la lámpara
        keys: [
          { eye: [0.3, 0.95, -1.48], look: [0.82, 1.2, -2.42], fov: 66 },
          { eye: [0.72, 0.8, -1.62], look: [0.95, 1.3, -2.42], fov: 70, roll: 2 },
          { eye: [0.85, 1.2, -0.85], look: [0.45, 1.95, -2.0], fov: 68 },
          { eye: [1.15, 1.2, 0.5], look: [0.0, 1.1, -2.42], fov: 64 },
          { eye: [1.62, 1.05, -1.52], look: [1.0, 1.15, -2.42], fov: 66, roll: -2 },
        ],
      };
    },

    OFICINA(B) {
      const X = 3.2, Z0 = -3.6, Z1 = 2.6, H = 2.7;
      const muro = { tile: T.liso, col: [0.46, 0.43, 0.62], cell: 0.9 };
      const mampara = { tile: T.tablero, col: [0.52, 0.46, 0.8], rep: [1.5, 1.5], cell: 0.7 };
      const remate = { tile: T.liso, col: [0.5, 0.5, 0.6] };
      const beige = { tile: T.liso, col: [0.47, 0.43, 0.6], rep: [3, 3] };
      B.quad([-X, 0, Z1], [2 * X, 0, 0], [0, 0, Z0 - Z1], { tile: T.alfombra, col: [0.5, 0.5, 0.64], rep: [1.2, 1.2], cell: 0.9 });
      B.quad([-X, H, Z0], [2 * X, 0, 0], [0, 0, Z1 - Z0], { tile: T.plafon, col: [0.62, 0.62, 0.74], rep: [0.83, 0.83], cell: 1.0 });
      for (const [x0, z0] of [[-0.3, -1.0], [1.5, -1.0], [-2.1, -1.0], [-0.3, -3.2]]) B.quad([x0, H - 0.01, z0], [0.6, 0, 0], [0, 0, 1.2], { tile: T.luminaria, uv: [0, 0, 1, 2], col: [0.95, 0.97, 1], glow: 0.15 });
      const ventana = [-2.8, 2.8, 1.0, 2.2];
      pared(B, 'z', Z0, 1, -X, X, 0, H, muro, ventana);
      pared(B, 'z', Z1, -1, -X, X, 0, H, muro);
      pared(B, 'x', -X, 1, Z0, Z1, 0, H, muro);
      pared(B, 'x', X, -1, Z0, Z1, 0, H, muro);
      // la ciudad por la ventana del fondo: edificios con ventanas encendidas y cielo con estrellas
      B.quad([-2.9, 0.9, Z0 - 0.5], [5.8, 0, 0], [0, 0.85, 0], { tile: T.ventanas2, rep: [0.9, 0.9], col: [0.8, 0.8, 0.95] });
      B.quad([-2.9, 1.75, Z0 - 0.6], [5.8, 0, 0], [0, 0.6, 0], { tile: T.estrellas, kind: 2, rep: [0.7, 0.7], glow: 0.6 });
      for (const x of [-2.8, -1.4, 0, 1.4, 2.8]) B.box([x - 0.04, 1.0, Z0 - 0.06], [x + 0.04, 2.2, Z0 + 0.03], remate);
      B.box([-2.84, 0.95, Z0 - 0.06], [2.84, 1.0, Z0 + 0.06], remate);
      // mamparas del cubículo, con remate
      B.box([-1.4, 0, -1.42], [1.4, 1.5, -1.36], mampara);
      B.box([-1.42, 0, -1.42], [-1.36, 1.5, 0.5], mampara);
      B.box([1.36, 0, -1.42], [1.42, 1.5, 0.5], mampara);
      B.box([-1.43, 1.5, -1.44], [1.43, 1.54, -1.34], remate);
      B.box([-1.44, 1.5, -1.44], [-1.34, 1.54, 0.52], remate);
      B.box([1.34, 1.5, -1.44], [1.44, 1.54, 0.52], remate);
      B.quad([-0.9, 1.0, -1.355], [0.28, 0, 0], [0, 0.36, 0], { tile: T.papel, uv: [0, 0, 1, 1], col: [0.9, 0.9, 0.95] });
      B.quad([-1.355, 0.95, -0.2], [0, 0, -0.42], [0, 0.48, 0], { tile: T.cartelB, uv: [0, 0, 1, 1], col: [0.85, 0.85, 0.9] });
      // el escritorio y su cajonera
      B.box([-1.36, 0.72, -1.36], [1.36, 0.76, -0.5], { tile: T.liso, col: [0.56, 0.5, 0.64], cell: 0.6 });
      B.box([0.75, 0, -1.3], [1.3, 0.72, -0.55], { tile: T.liso, col: [0.5, 0.46, 0.58] });
      for (const [y0, y1] of [[0.04, 0.26], [0.28, 0.48], [0.5, 0.7]]) B.quad([0.78, y0, -0.545], [0.49, 0, 0], [0, y1 - y0, 0], { tile: T.cajones, uv: [0, 0, 1, 1], col: [0.6, 0.56, 0.7] });
      // la computadora: gabinete de escritorio, monitor de tubo encima, teclado y ratón
      B.box([-0.38, 0.76, -1.25], [0.38, 0.9, -0.62], beige);
      B.quad([0.08, 0.81, -0.618], [0.22, 0, 0], [0, 0.018, 0], { tile: T.liso, col: [0.08, 0.08, 0.1] });
      B.quad([-0.32, 0.815, -0.617], [0.02, 0, 0], [0, 0.012, 0], { tile: T.liso, col: [0.3, 1, 0.4], emis: 1, glow: 0.7 });
      B.box([-0.33, 0.9, -1.18], [0.33, 1.42, -0.66], beige);
      B.box([-0.22, 0.95, -1.32], [0.22, 1.36, -1.18], beige);
      B.quad([-0.3, 0.915, -0.657], [0.6, 0, 0], [0, 0.04, 0], { tile: T.rejilla, uv: [0, 0, 1, 0.4], col: [0.8, 0.8, 0.9] });
      B.screen([-0.24, 0.98, -0.658], [0.48, 0, 0], [0, 0.36, 0], { div: [4, 3], bulge: 0.025 });
      B.box([-0.3, 0.76, -0.52], [0.3, 0.79, -0.3], beige, { py: { tile: T.teclas, uv: [0, 0, 2, 0.75], col: [0.6, 0.56, 0.74] } });
      B.quad([0.36, 0.762, -0.3], [0.2, 0, 0], [0, 0, -0.22], { tile: T.liso, col: [0.2, 0.16, 0.34] });
      B.box([0.42, 0.765, -0.48], [0.48, 0.79, -0.38], beige);
      B.box([0.55, 0.76, -1.0], [0.63, 0.87, -0.92], { tile: T.liso, col: [0.42, 0.3, 0.72] });
      B.xf(rotY(0.25), [-0.75, 0.762, -0.85], () => B.quad([-0.15, 0, 0.2], [0.3, 0, 0], [0, 0, -0.4], { tile: T.papel, uv: [0, 0, 1, 1], col: [0.88, 0.88, 0.94] }));
      // lo que hay sobre el escritorio: cintas, una bolsa de botana, el cable del monitor; y más carteles
      cintas(B, [0.85, 0.76, -1.12], 4, -0.2);
      bolsa(B, [-0.72, 0.76, -0.78], 0.3, 0.22, 0.09, -0.35);
      cable(B, [[0.2, 1.0, -1.3], [0.42, 0.765, -1.34], [0.6, 0.765, -1.3], [0.66, 0.4, -1.36], [0.7, 0.012, -1.3]], [0.2, 0.2, 0.26]);
      B.quad([-1.3, 0.92, -1.355], [0.36, 0, 0], [0, 0.48, 0], { tile: T.cartelD, uv: [0, 0, 1, 1], col: [0.85, 0.85, 0.9] });
      B.quad([1.355, 0.9, -1.05], [0, 0, 0.4], [0, 0.45, 0], { tile: T.cartelE, uv: [0, 0, 1, 1], col: [0.85, 0.85, 0.9] });
      // planta en la esquina del escritorio
      B.box([-1.2, 0.76, -1.25], [-1.02, 0.92, -1.07], { tile: T.liso, col: [0.72, 0.42, 0.32] });
      B.quad([-1.33, 0.9, -1.16], [0.44, 0, 0], [0, 0.5, 0], { tile: T.planta, kind: 3, uv: [0, 0, 1, 1] });
      B.quad([-1.11, 0.9, -1.38], [0, 0, 0.44], [0, 0.5, 0], { tile: T.planta, kind: 3, uv: [0, 0, 1, 1] });
      // la silla, retirada
      const tela = { tile: T.tablero, col: [0.32, 0.29, 0.48], rep: [3, 3] };
      B.box([0.35, 0.44, 0.1], [0.85, 0.5, 0.6], tela);
      B.box([0.37, 0.55, 0.58], [0.83, 1.02, 0.64], tela);
      B.box([0.57, 0.08, 0.32], [0.63, 0.44, 0.38], { tile: T.metal, col: [0.5, 0.5, 0.58] });
      // otros cubículos, a oscuras
      B.box([1.6, 0, -1.42], [X, 1.5, -1.36], mampara);
      B.box([-X, 0, -1.42], [-1.6, 1.5, -1.36], mampara);
      B.box([1.6, 0.72, -1.36], [X, 0.76, -0.6], { tile: T.liso, col: [0.5, 0.46, 0.58] });
      B.box([2.1, 0.76, -1.2], [2.6, 1.22, -0.78], beige);
      B.quad([2.16, 0.83, -0.778], [0.38, 0, 0], [0, 0.3, 0], { tile: T.liso, col: [0.05, 0.05, 0.08] });
      return {
        luces: [
          { pos: [0, 2.5, -0.4], col: [0.2, 0.2, 0.32], fall: 0.6 },
          { pos: [0, 2.5, -2.6], col: [0.2, 0.2, 0.32], fall: 0.6 },
          { pos: [1.8, 2.5, -0.4], col: [0.14, 0.14, 0.24], fall: 0.6 },
          { pos: [0, 1.6, -5.5], col: [0.18, 0.14, 0.34], fall: 0.08 },             // el resplandor de la ciudad
        ],
        amb: [0.026, 0.022, 0.06], fog: [0.022, 0.018, 0.05, 2.5, 11], near: 0.06, far: 30,
        scr: { power: 2.8, fall: 1.7, kind: 0 },
        // planos: el monitor de tres cuartos y de cerca, con el borde del escritorio delante (el de
        // presentación); desde abajo a la izquierda; las luminarias con el monitor; uno general; de lado
        keys: [
          { eye: [0.42, 1.12, -0.08], look: [-0.03, 1.13, -0.66], fov: 66 },
          { eye: [-0.36, 1.0, -0.12], look: [0.0, 1.2, -0.66], fov: 68, roll: 2 },
          { eye: [0.15, 1.15, 0.15], look: [0.05, 1.9, -0.9], fov: 68 },
          { eye: [-1.0, 1.55, 1.2], look: [0.25, 0.95, -1.0], fov: 60 },
          { eye: [0.66, 1.3, -0.24], look: [-0.05, 1.12, -0.7], fov: 64, roll: -2 },
        ],
      };
    },

    AZOTEA(B) {
      const concreto = { tile: T.concreto, col: [0.46, 0.44, 0.56], rep: [0.6, 0.6], cell: 2.2 };
      const metal = { tile: T.metal, col: [0.5, 0.5, 0.6] };
      // el cielo: una caja enorme por dentro, con estrellas y el resplandor violeta de la ciudad abajo
      const cielo = { tile: T.estrellas, kind: 2, rep: [0.008, 0.008], glow: 0.7, div: [4, 3], colFn: p => mixc([2.6, 1.7, 3.4], [1, 1, 1], Math.pow(clamp((p[1] + 40) / 200), 0.6)) };
      const S = 320, top = 280, bot = -60;
      pared(B, 'z', -S, 1, -S, S, bot, top, cielo);
      pared(B, 'z', S, -1, -S, S, bot, top, cielo);
      pared(B, 'x', -S, 1, -S, S, bot, top, cielo);
      pared(B, 'x', S, -1, -S, S, bot, top, cielo);
      B.quad([-S, top, -S], [2 * S, 0, 0], [0, 0, 2 * S], { ...cielo, div: [3, 3] });
      // la calle, muy abajo
      B.quad([-260, -38, 0], [520, 0, 0], [0, 0, -300], { tile: T.concreto, col: [0.2, 0.2, 0.26], rep: [0.05, 0.05], div: [2, 2] });
      // la azotea: piso, pretiles, malla con postes
      B.quad([-7, 0, 7], [14, 0, 0], [0, 0, -10.1], { ...concreto, col: [0.38, 0.36, 0.48] });
      B.box([-7, 0, -3.35], [7, 0.85, -3.1], { ...concreto, col: [0.5, 0.48, 0.6], cell: 1.2 });
      B.box([7, 0, -3.35], [7.25, 0.85, 7], concreto);
      B.box([-7.25, 0, -3.35], [-7, 0.85, 7], concreto);
      for (let x = -7; x <= 7; x += 2) B.box([x - 0.03, 0.85, -3.25], [x + 0.03, 2.4, -3.19], metal);
      B.box([-7, 2.38, -3.25], [7, 2.43, -3.19], metal);
      // (la malla queda a medio metro del ojo: donde se asoma la cámara va partida fino, como hacían
      // aquellos juegos con lo cercano, para que la textura afín no la deshaga en manchones)
      const malla = { tile: T.malla, kind: 3, rep: [2.6, 2.6], col: [0.72, 0.72, 0.84] };
      B.quad([-7, 0.85, -3.22], [5, 0, 0], [0, 1.53, 0], { ...malla, cell: 1.4 });
      B.quad([-2, 0.85, -3.22], [7, 0, 0], [0, 1.53, 0], { ...malla, cell: 0.3 });
      B.quad([5, 0.85, -3.22], [2, 0, 0], [0, 1.53, 0], { ...malla, cell: 1.4 });
      // cosas de azotea: un aparato de aire con rejilla y el cuarto de la escalera con su foco
      B.box([3.5, 0, 0.5], [5.0, 1.1, 1.6], metal, { nx: { tile: T.rejilla, uv: [0, 0, 2, 2], col: [0.7, 0.7, 0.8] } });
      B.box([-6.8, 0, 3.5], [-4.2, 2.6, 6.8], { tile: T.ladrillo, col: [0.62, 0.46, 0.5], rep: [1.2, 1.2], cell: 1.3 });
      B.quad([-4.19, 0, 5.6], [0, 0, -0.9], [0, 2.0, 0], { tile: T.metal, col: [0.3, 0.28, 0.36] });
      B.box([-4.2, 2.12, 5.0], [-4.1, 2.22, 5.2], { tile: T.liso, col: [1, 0.72, 0.4], emis: 1, glow: 0.9 });
      // el edificio de al lado, pegado y un poco más bajo: oficinas con la luz prendida que se ven
      // enormes al asomarse por la malla; en su azotea, el anuncio
      const vent = (tile, col) => ({ tile, rep: [1 / 12, 1 / 28], col: col || [0.82, 0.8, 0.95], cell: 11, glow: 0.55 });
      const ofi = { tile: T.oficinas, rep: [1 / 9, 1 / 20], col: [0.72, 0.64, 0.54], cell: 6, glow: 0.3 };
      B.box([1, -38, -24], [19, -1.5, -8], ofi, { ny: null, nz: null, py: { ...concreto, col: [0.36, 0.34, 0.44], cell: 5 } });
      B.box([-30, -38, -40], [-17, 6, -28], vent(T.ventanas, [0.7, 0.68, 0.85]), { ny: null });
      B.box([-16, -38, -24], [-6, -9, -14], vent(T.ventanas2, [0.66, 0.64, 0.82]), { ny: null, py: concreto });
      B.box([-4, -38, -48], [10, -4, -34], vent(T.ventanas, [0.74, 0.7, 0.86]), { ny: null, py: concreto });
      // la torre lejana: tres cuerpos, corona encendida, aguja y luz roja que parpadea
      const tx = 14, tz = -125;
      B.box([tx - 7, -38, tz - 7], [tx + 7, 30, tz + 7], vent(T.ventanas2), { ny: null });
      B.box([tx - 4.5, 30, tz - 4.5], [tx + 4.5, 48, tz + 4.5], vent(T.ventanas2), { ny: null });
      B.box([tx - 2.5, 48, tz - 2.5], [tx + 2.5, 53, tz + 2.5], { tile: T.focos, rep: [0.8, 0.8], col: [1, 0.95, 0.85], emis: 0.5, glow: 1 }, { ny: null });
      B.box([tx - 0.3, 53, tz - 0.3], [tx + 0.3, 66, tz + 0.3], metal);
      B.box([tx - 0.5, 66, tz - 0.5], [tx + 0.5, 67, tz + 0.5], { tile: T.liso, col: [1, 0.15, 0.1], kind: 4, emis: 1, glow: 1 });
      // el resto de la ciudad, a lo lejos (siempre igual: semilla fija)
      let seed = 7;
      const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      for (let i = 0; i < 18; i++) {
        const x = -170 + i * 20 + (rnd() - 0.5) * 10, z = -70 - rnd() * 110, w = 12 + rnd() * 18, d = 12 + rnd() * 14, h = -12 + rnd() * 55;
        if (Math.abs(x - tx) < 14 && z < -95) continue;            // que no tape la torre
        B.box([x - w / 2, -38, z - d / 2], [x + w / 2, h, z + d / 2], { ...vent(i % 2 ? T.ventanas : T.ventanas2, [0.7, 0.7, 0.86]), cell: 30 }, { ny: null });
      }
      // el anuncio luminoso, grande y algo girado: postes, armazón, marco de focos y la pantalla de focos
      B.xf(rotY(-0.42), [11, -1.5, -17.5], () => {
        B.box([-4.6, 0, -0.4], [-4.2, 1.4, 0], metal);
        B.box([4.2, 0, -0.4], [4.6, 1.4, 0], metal);
        B.box([-7.6, 1.3, -0.5], [7.6, 10.6, -0.05], { tile: T.metal, col: [0.32, 0.3, 0.38], cell: 2 });
        const f = { tile: T.focos, rep: [3, 3], col: [1, 0.92, 0.8] };
        B.quad([-7.4, 10.2, 0.0], [14.8, 0, 0], [0, 0.32, 0], f);
        B.quad([-7.4, 1.38, 0.0], [14.8, 0, 0], [0, 0.32, 0], f);
        B.quad([-7.4, 1.7, 0.0], [0.32, 0, 0], [0, 8.5, 0], f);
        B.quad([7.08, 1.7, 0.0], [0.32, 0, 0], [0, 8.5, 0], f);
        B.screen([-7.0, 1.75, 0.01], [14, 0, 0], [0, 8.4, 0], { div: [6, 4] });
      });
      return {
        luces: [
          { pos: [-4.0, 2.25, 5.1], col: [0.7, 0.42, 0.2], fall: 1.4 },             // el foco de la puerta
          { pos: [0, -30, -60], col: [0.26, 0.17, 0.4], fall: 0.0002 },              // la ciudad, desde abajo
          { pos: [-100, 150, 50], col: [0.07, 0.075, 0.16], fall: 0 },               // la luna
        ],
        amb: [0.025, 0.02, 0.05], fog: [0.04, 0.03, 0.08, 30, 240], near: 0.15, far: 700,
        scr: { power: 3.6, fall: 0.006, kind: 1 },
        // planos: pegado a la malla, el anuncio arriba y las oficinas abajo (el de presentación); asomado
        // a las ventanas; el anuncio de cerca; uno general; la torre y el cielo
        keys: [
          { eye: [0.0, 1.72, -2.75], look: [6.2, -1.0, -13], lookH: [6.6, 1.4, -13], fov: 68, roll: -4 },
          { eye: [0.9, 1.75, -2.8], look: [4.5, -9, -10.5], fov: 66, roll: 3 },
          { eye: [1.4, 1.65, -2.7], look: [11, 4.2, -17.5], lookH: [11, 5.2, -17.5], fov: 62, roll: -6 },
          { eye: [-1.5, 1.65, 1.5], look: [6, 3, -20], fov: 62 },
          { eye: [0.4, 1.6, -1.8], look: [12, 16, -60], fov: 64 },
        ],
      };
    },
  };
  // La geometría se arma una vez por escena y se guarda (sobrevive a la pérdida de la gráfica).
  const armadas = {};
  function escena(name) {
    if (armadas[name]) return armadas[name];
    const B = Builder(), info = ESCENAS[name](B), mesh = B.finish();
    const p = B.pantalla, cam = p.aspect >= 1 ? [Math.round(48 * p.aspect), 48] : [48, Math.round(48 / p.aspect)];
    return (armadas[name] = { name, ...info, mesh, pantalla: p, camSize: cam });
  }

  // ── El paseo ────────────────────────────────────────────────────────────────
  const smooth = t => t * t * (3 - 2 * t);
  const cr = (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return a.map((_, k) => 0.5 * (2 * b[k] + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3)); };
  function poseAt(esc, phase, aspect) {
    const K = esc.keys, n = K.length, x = (((phase % 1) + 1) % 1) * n, i = Math.floor(x), s0 = x - i;
    const s = s0 + (smooth(s0) - s0) * 0.6;                 // se demora un poco en cada plano
    const P = k => K[(i + k + n) % n];
    // (un plano puede llevar otra mira para horizontal: «lookH», cuando en apaisado la pantalla se saldría)
    const L = k => (aspect > 1.2 && P(k).lookH) || P(k).look;
    const eye = cr(P(-1).eye, P(0).eye, P(1).eye, P(2).eye, s), look = cr(L(-1), L(0), L(1), L(2), s);
    const short = (P(0).fov + (P(1).fov - P(0).fov) * smooth(s0)) * Math.PI / 180;
    const roll = ((P(0).roll || 0) + ((P(1).roll || 0) - (P(0).roll || 0)) * smooth(s0)) * Math.PI / 180;
    // El campo horizontal sale del lado corto: en vertical, 0,92 de él (se gana alto: gran angular de
    // cerca, como en los planos de referencia); en horizontal, como mucho 1,3 (si no, a 16:9 la
    // pantalla se quedaba en nada).
    const hfov = short * (aspect >= 1 ? Math.min(1.3, 0.92 * aspect) : 0.92);
    const fovY = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    return { eye, look, fovY, roll };
  }

  // ── Gráfica ─────────────────────────────────────────────────────────────────
  // (HP: alta precisión donde la hay; las coordenadas de textura multiplicadas por w la necesitan)
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#define HP highp\n#else\nprecision mediump float;\n#define HP mediump\n#endif\n';
  const QUAD_V = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  // La cámara reducida al tamaño de la pantalla del cuarto (recortada a su proporción, espejada si toca).
  const CAM_F = HEAD + `uniform sampler2D uSrc; uniform vec4 uCrop; uniform vec2 uStep; varying vec2 vUv;
    void main() {
      vec2 uv = uCrop.xy + vUv * uCrop.zw;
      vec3 c = texture2D(uSrc, uv + uStep * vec2(-0.3, -0.3)).rgb + texture2D(uSrc, uv + uStep * vec2(0.3, -0.3)).rgb
             + texture2D(uSrc, uv + uStep * vec2(-0.3, 0.3)).rgb + texture2D(uSrc, uv + uStep * vec2(0.3, 0.3)).rgb;
      gl_FragColor = vec4(c * 0.25, 1.0);
    }`;
  // Su color medio en un solo texel, que se mezcla con el del cuadro anterior (la luz no parpadea con el ruido).
  const AVG_F = HEAD + `uniform sampler2D uSrc;
    void main() {
      vec3 c = vec3(0.0);
      for (int y = 0; y < 6; y++) for (int x = 0; x < 8; x++) c += texture2D(uSrc, (vec2(float(x), float(y)) + 0.5) / vec2(8.0, 6.0)).rgb;
      gl_FragColor = vec4(c / 48.0, 1.0);
    }`;
  const SCENE_V = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv; attribute vec3 aCol; attribute vec4 aMat;
    uniform mat4 uVP; uniform mat4 uModel; uniform vec3 uEye; uniform vec2 uRes; uniform float uSnap;
    uniform vec3 uScrPos; uniform vec3 uScrC; uniform vec3 uScrN; uniform float uScrFall;
    uniform vec3 uLp[4]; uniform vec3 uLc[4]; uniform float uLf[4];
    uniform vec3 uAmb; uniform vec2 uFog; uniform float uAfinV;
    varying highp vec3 vUvq; varying vec3 vCol; varying vec3 vLit; varying float vScr; varying float vFog; varying vec4 vMat; varying highp vec3 vDir;
    void main() {
      vec4 wp = uModel * vec4(aPos, 1.0);
      vec3 n = normalize((uModel * vec4(aNrm, 0.0)).xyz);
      vec4 clip = uVP * wp;
      // el vértice salta a la rejilla de píxeles de la imagen interna (de ahí el temblor)
      if (uSnap > 0.0 && clip.w > 0.05) { vec2 g = uRes * 0.5 / uSnap; clip.xy = floor(clip.xy / clip.w * g + 0.5) / g * clip.w; }
      gl_Position = clip;
      // textura afín: la coordenada viaja multiplicada por w; al dividirla en el píxel por la w
      // interpolada se anula la corrección de perspectiva del hardware
      vUvq = vec3(aUv * mix(1.0, clip.w, uAfinV), clip.w);
      // luz por vértice: ambiente y hasta cuatro luces de la escena…
      vec3 lit = uAmb;
      for (int i = 0; i < 4; i++) {
        vec3 L = uLp[i] - wp.xyz; float d2 = dot(L, L);
        lit += uLc[i] * max(dot(n, L) * inversesqrt(d2 + 1e-4), 0.0) / (1.0 + uLf[i] * d2);
      }
      vLit = lit;
      // …y la de la pantalla, que alumbra sobre todo hacia delante y algo a los lados (su color se
      // pone en el píxel); «delante» se mide desde el centro real de la pantalla
      vec3 Ls = uScrPos - wp.xyz; float s2 = dot(Ls, Ls); vec3 ls = Ls * inversesqrt(s2 + 1e-4);
      float ahead = dot(uScrN, normalize(wp.xyz - uScrC + uScrN * 1e-3));
      vScr = max(dot(n, ls), 0.0) * clamp(ahead * 0.8 + 0.55, 0.0, 1.0) / (1.0 + uScrFall * s2);
      vFog = clamp((distance(wp.xyz, uEye) - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
      vDir = wp.xyz - uEye;
      vCol = aCol; vMat = aMat;
    }`;
  const SCENE_F = HEAD + `
    uniform sampler2D uAtlas; uniform sampler2D uCam; uniform sampler2D uAvg;
    uniform float uLuz, uTime, uScrGain, uScrKind, uAdd, uRoll, uTwinkle, uAfin;
    uniform vec2 uCamSize; uniform vec3 uFogCol;
    varying HP vec3 vUvq; varying vec3 vCol; varying vec3 vLit; varying float vScr; varying float vFog; varying vec4 vMat; varying HP vec3 vDir;
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    // lo que muestra la pantalla: la cámara, con su curvatura de tubo y sus líneas (o los focos del anuncio)
    vec3 pantalla(vec2 uv) {
      vec2 p = uv * 2.0 - 1.0;
      if (uScrKind < 0.5) p *= 1.0 + 0.06 * dot(p, p);
      if (max(abs(p.x), abs(p.y)) > 1.0) return vec3(0.012, 0.012, 0.02);
      vec2 q = p * 0.5 + 0.5, tc = vec2(q.x, 1.0 - q.y);
      vec3 c = texture2D(uCam, tc).rgb;
      vec2 cell = fract(tc * uCamSize);
      // líneas de barrido: una por cada dos filas, de perfil suave (con una por fila y borde duro, en una
      // pantalla de 50 píxeles salía un muaré ondulado)
      if (uScrKind < 0.5) c *= 1.0 - 0.26 * (0.5 + 0.5 * cos(6.2831 * tc.y * uCamSize.y * 0.5));
      else c *= 0.4 + 0.6 * smoothstep(0.58, 0.28, length(cell - 0.5));
      c *= 1.0 - 0.22 * dot(p, p);
      c += uRoll * 0.3 * smoothstep(0.08, 0.0, abs(fract(uTime * 0.5) - tc.y));
      return pow(c, vec3(1.1)) * uScrGain + vec3(0.012, 0.016, 0.03);
    }
    // el cielo: estrellas de un píxel fijas en el infinito (por dirección, en las seis caras de un
    // cubo; así no dependen del tamaño de ninguna textura y no se mueven con el paralaje)
    float estrellas(vec3 d) {
      vec3 a = abs(d); vec2 f; float face;
      if (a.x >= a.y && a.x >= a.z) { f = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
      else if (a.y >= a.z) { f = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
      else { f = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
      vec2 cell = floor((f * 0.5 + 0.5) * 300.0) + vec2(face * 311.0, face * 173.0);
      float h = hash(cell);
      if (h < 0.9965) return 0.0;
      float b = 0.35 + 0.65 * hash(cell + 17.0);
      return b * (0.6 + 0.4 * sin(uTime * (1.7 + uTwinkle * 5.0) + hash(cell + 5.0) * 6.2831));
    }
    // la luz que echa la pantalla: su color medio, algo más saturado, que no se apaga del todo
    vec3 luzPantalla() {
      vec3 a = texture2D(uAvg, vec2(0.5)).rgb;
      float l = dot(a, vec3(0.3, 0.59, 0.11));
      a = max(mix(vec3(l), a, 1.35), 0.0);
      return a * vec3(0.9, 0.84, 1.12) + vec3(0.02, 0.022, 0.05);           // (con un dejo violeta: la noche)
    }
    void main() {
      vec2 uv = mix(vUvq.xy, vUvq.xy / vUvq.z, uAfin);   // (uAfin 0 solo para las pruebas: textura con perspectiva)
      float kind = floor(vMat.z + 0.5);
      vec3 col; float glow;
      if (kind == 1.0) { col = pantalla(uv); glow = 1.0; }
      else if (kind == 2.0) { float st = estrellas(normalize(vDir)); col = vec3(0.018, 0.017, 0.05) * vCol + vec3(0.86, 0.88, 1.0) * st; glow = st * vMat.w; }
      else {
        float idx = floor(vMat.x + 0.5);
        vec2 tile = vec2(mod(idx, 4.0), floor((idx + 0.5) / 4.0));
        vec2 f = fract(uv); f.y = 1.0 - f.y; f = clamp(f, 1.0 / 128.0, 1.0 - 1.0 / 128.0);
        vec2 auv = (tile + f) * vec2(0.25, 0.125);
        vec4 t = texture2D(uAtlas, auv);
        if (t.a < 0.25) discard;
        vec3 base = t.rgb * vCol;
        if (uAdd > 0.5) { gl_FragColor = vec4(base, 0.0); return; }
        float e = max(vMat.y, clamp((1.0 - t.a) * 2.0, 0.0, 1.0));
        if (kind == 4.0) e *= step(fract(uTime / 1.6), 0.3);
        vec3 light = vLit + vScr * luzPantalla() * uLuz;
        col = mix(base * light, base, e);
        glow = e * vMat.w;
      }
      float fog = kind == 2.0 ? 0.0 : vFog * (1.0 - 0.5 * glow);
      col = mix(col, uFogCol, fog);
      gl_FragColor = vec4(col, glow * (1.0 - fog));
    }`;
  // Resplandor: reducciones sucesivas; la primera se queda solo con lo que emite (color por alfa).
  const DOWN_F = HEAD + `uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uFirst; uniform float uSpread; varying vec2 vUv;
    // (en la primera, además, solo lo que pasa de ~0,45 de luz: una pantalla oscura no deslumbra)
    vec3 tap(vec2 o) { vec4 s = texture2D(uSrc, vUv + o * uTexel); float k = s.a * smoothstep(0.32, 0.78, dot(s.rgb, vec3(0.3, 0.59, 0.11))); return s.rgb * mix(1.0, k, uFirst); }
    void main() { gl_FragColor = vec4((tap(vec2(-uSpread, -uSpread)) + tap(vec2(uSpread, -uSpread)) + tap(vec2(-uSpread, uSpread)) + tap(vec2(uSpread, uSpread))) * 0.25, 1.0); }`;
  // Final: escena + resplandor, a 5 bits por canal con tramado ordenado de 4 × 4.
  const POST_F = HEAD + `uniform sampler2D uScene; uniform sampler2D uB1; uniform sampler2D uB2; uniform sampler2D uB3; uniform sampler2D uB4;
    uniform vec2 uRes; uniform float uDither; uniform float uBloom;
    float m2(vec2 b) { float eq = 1.0 - abs(b.x - b.y); return eq * b.x + (1.0 - eq) * (b.x * 2.0 + b.y * 3.0); }
    float bayer(vec2 p) { vec2 a = mod(floor(p), 4.0); return (m2(mod(a, 2.0)) * 4.0 + m2(floor(a / 2.0)) + 0.5) / 16.0 - 0.5; }
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      vec3 c = texture2D(uScene, uv).rgb;
      vec3 g = texture2D(uB1, uv).rgb * 0.12 + texture2D(uB2, uv).rgb * 0.28 + texture2D(uB3, uv).rgb * 0.55 + texture2D(uB4, uv).rgb * 0.9;
      // (mezcla de pantalla: el halo se ve en lo oscuro alrededor del tubo y no quema lo que ya brilla)
      c = 1.0 - (1.0 - c) * (1.0 - min(g * uBloom, 1.0));
      c = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5 + bayer(gl_FragCoord.xy) * uDither) / 31.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`;

  let canvas = null, gl = null, res = null, failed = false, lost = 0;
  const soltados = new WeakSet();
  function drop() { gl = null; canvas = null; res = null; }
  function program(vs, fs, attrs) {
    const make = (type, text) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, text); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('CUARTO: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, make(gl.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl.bindAttribLocation(prog, i, a));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('CUARTO: ' + gl.getProgramInfoLog(prog));
    const u = {}, count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) { const name = gl.getActiveUniform(prog, i).name; u[name.replace('[0]', '')] = gl.getUniformLocation(prog, name); }
    return { prog, u };
  }
  function texture(filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(w, h, filter, depth) {
    const tex = texture(filter);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (depth) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('CUARTO: búfer incompleto');
    return { tex, fbo, rb, w, h };
  }
  const freeTarget = t => { if (!t) return; gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); if (t.rb) gl.deleteRenderbuffer(t.rb); };
  function ensureGl() {
    if (gl && !gl.isContextLost()) return true;
    if (gl) drop();                              // la perdió sin avisar todavía: se rehace
    if (failed) return false;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
      const g = c.getContext('webgl', opts) || c.getContext('experimental-webgl', opts);
      if (!g) throw new Error('CUARTO: sin WebGL');
      // Si el sistema retira la gráfica (pasa al volver de segundo plano), la siguiente vuelta la rehace.
      c.addEventListener('webglcontextlost', event => { event.preventDefault(); if (soltados.has(c)) return; lost++; if (canvas === c) drop(); });
      canvas = c; gl = g;
      res = {
        cam: program(QUAD_V, CAM_F, ['aPos']), avg: program(QUAD_V, AVG_F, ['aPos']), down: program(QUAD_V, DOWN_F, ['aPos']), post: program(QUAD_V, POST_F, ['aPos']),
        scene: program(SCENE_V, SCENE_F, ['aPos', 'aNrm', 'aUv', 'aCol', 'aMat']),
        src: texture(gl.LINEAR), atlas: texture(gl.NEAREST), quad: gl.createBuffer(), vbos: {}, sets: [], camT: null, avgT: null, avgFresh: true,
      };
      gl.bindTexture(gl.TEXTURE_2D, res.atlas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, AW, AH, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlasBytes || (atlasBytes = makeAtlas()));
      gl.bindBuffer(gl.ARRAY_BUFFER, res.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      res.avgT = target(1, 1, gl.NEAREST, false);
      return true;
    } catch (error) {
      console.warn(String(error && error.message || error));
      failed = true; drop();
      return false;
    }
  }
  let atlasBytes = null;
  // Búferes de la escena y del resplandor para un tamaño interno (se guardan dos: visor y foto se turnan).
  function setFor(iw, ih) {
    const key = iw + 'x' + ih;
    let s = res.sets.find(x => x.key === key);
    if (s) return s;
    const q = d => [Math.max(2, Math.round(iw / d)), Math.max(2, Math.round(ih / d))];
    s = { key, iw, ih, scene: target(iw, ih, gl.LINEAR, true), b: [2, 4, 8, 16].map(d => target(...q(d), gl.LINEAR, false)) };
    res.sets.unshift(s);
    while (res.sets.length > 2) { const old = res.sets.pop(); freeTarget(old.scene); old.b.forEach(freeTarget); }
    return s;
  }
  function vboFor(esc) {
    let v = res.vbos[esc.name];
    if (v) return v;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, esc.mesh.data, gl.STATIC_DRAW);
    return (res.vbos[esc.name] = { buf });
  }
  function bindQuad() {
    gl.bindBuffer(gl.ARRAY_BUFFER, res.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (let i = 1; i < 5; i++) gl.disableVertexAttribArray(i);
  }
  function bindMesh(v) {
    gl.bindBuffer(gl.ARRAY_BUFFER, v.buf);
    const F = 4, S = STRIDE * F;
    [[0, 3, 0], [1, 3, 3], [2, 2, 6], [3, 3, 8], [4, 4, 11]].forEach(([loc, size, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, off * F); });
  }
  // Recorte centrado de la fuente a la proporción de la pantalla del cuarto.
  function crop(srcW, srcH, aspect) {
    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    if (srcW / srcH > aspect) { sw = sh * aspect; sx = (srcW - sw) / 2; } else { sh = sw / aspect; sy = (srcH - sh) / 2; }
    return [sx, sy, sw, sh];
  }

  // ── Un cuadro ──────────────────────────────────────────────────────────────
  const walk = { rate: null, offset: 0, last: -1e9 };
  const stats = { frames: 0, ms: 0, variant: '', size: [0, 0], out: [0, 0], phase: 0, eye: null, look: null, fov: 0, pantalla: null, audio: false };
  function project(VP, p, W, H) {
    const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13], w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
    return w > 0.01 ? [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H, w] : null;
  }
  function renderCuarto(source, srcW, srcH, ctx, mirror, variant, options) {
    const o = options || {};
    if (!ctx || !ctx.canvas || !srcW || !srcH) return false;
    if (!ensureGl()) return false;
    const started = performance.now(), now = num(o.now, started);
    const name = ESCENAS[variant] ? variant : 'DORMITORIO', esc = escena(name);
    const outW = Math.max(1, Math.round(num(o.outW, ctx.canvas.width))), outH = Math.max(1, Math.round(num(o.outH, ctx.canvas.height)));
    const big = Math.max(outW, outH), iw = Math.max(24, Math.round(LARGO * outW / big)), ih = Math.max(24, Math.round(LARGO * outH / big));
    const audio = o.audio && typeof o.audio === 'object' ? o.audio : null;
    const bass = audio ? clamp(num(audio.bass, 0)) : 0, mid = audio ? clamp(num(audio.mid, 0)) : 0, treble = audio ? clamp(num(audio.treble, 0)) : 0, beat = audio ? clamp(num(audio.beat, 0)) : 0;
    const giro = clamp(num(o.giro, FABRICA.giro)), luz = clamp(num(o.luz, FABRICA.luz)), trama = clamp(num(o.trama, FABRICA.trama)), temblor = clamp(num(o.temblor, FABRICA.temblor));
    // El paseo: fase = tiempo × velocidad + desfase. Mientras corre seguido (cuadros a menos de medio
    // segundo), si la velocidad cambia —el mando, o los graves que la empujan— el desfase absorbe el
    // cambio y la cámara sigue sin saltar. Tras una pausa la fase vuelve a ser solo función del tiempo.
    // Con giro 0, quieta en el primer plano (el de presentación); si se vuelve a girar sin pausa,
    // arranca desde ahí.
    let phase = 0;
    const seguido = Math.abs(now - walk.last) < 500;
    walk.last = now;
    if (giro > 0) {
      const rate = giro / FABRICA.giro / CICLO * (1 + 1.2 * bass);
      if (walk.rate === null || !seguido) { walk.rate = rate; walk.offset = 0; }
      if (rate !== walk.rate) { walk.offset = (((walk.offset + now / 1000 * (walk.rate - rate)) % 1) + 1) % 1; walk.rate = rate; }
      phase = (((now / 1000 * rate + walk.offset) % 1) + 1) % 1;
    } else { walk.rate = 0; walk.offset = 0; }
    const aspect = outW / outH, pose = poseAt(esc, phase, aspect);
    const VP = mat4mul(perspective(pose.fovY, aspect, esc.near, esc.far), lookAt(pose.eye, pose.look, pose.roll));
    const set = setFor(iw, ih), vbo = vboFor(esc), [cw, ch] = esc.camSize;
    try {
      // 1 · La cámara al tamaño de la pantalla del cuarto.
      if (!res.camT || res.camT.w !== cw || res.camT.h !== ch) { freeTarget(res.camT); res.camT = target(cw, ch, gl.NEAREST, false); res.avgFresh = true; }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      const [sx, sy, sw, sh] = crop(srcW, srcH, esc.pantalla.aspect);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      bindQuad();
      gl.bindFramebuffer(gl.FRAMEBUFFER, res.camT.fbo);
      gl.viewport(0, 0, cw, ch);
      gl.useProgram(res.cam.prog);
      gl.uniform1i(res.cam.u.uSrc, 0);
      if (mirror) gl.uniform4f(res.cam.u.uCrop, (sx + sw) / srcW, sy / srcH, -sw / srcW, sh / srcH);
      else gl.uniform4f(res.cam.u.uCrop, sx / srcW, sy / srcH, sw / srcW, sh / srcH);
      gl.uniform2f(res.cam.u.uStep, sw / srcW / cw, sh / srcH / ch);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 2 · Su color medio, mezclado con el anterior (un tercio por cuadro).
      gl.bindFramebuffer(gl.FRAMEBUFFER, res.avgT.fbo);
      gl.viewport(0, 0, 1, 1);
      gl.useProgram(res.avg.prog);
      gl.bindTexture(gl.TEXTURE_2D, res.camT.tex);
      gl.uniform1i(res.avg.u.uSrc, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      gl.blendColor(0, 0, 0, res.avgFresh ? 1 : 0.33);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
      res.avgFresh = false;
      // 3 · El cuarto, a la resolución interna.
      gl.bindFramebuffer(gl.FRAMEBUFFER, set.scene.fbo);
      gl.viewport(0, 0, iw, ih);
      gl.clearColor(esc.fog[0], esc.fog[1], esc.fog[2], 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      const S = res.scene, u = S.u;
      gl.useProgram(S.prog);
      bindMesh(vbo);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, res.atlas);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, res.camT.tex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, res.avgT.tex);
      gl.uniform1i(u.uAtlas, 0); gl.uniform1i(u.uCam, 1); gl.uniform1i(u.uAvg, 2);
      gl.uniformMatrix4fv(u.uVP, false, VP);
      gl.uniformMatrix4fv(u.uModel, false, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
      gl.uniform3fv(u.uEye, pose.eye);
      gl.uniform2f(u.uRes, iw, ih);
      gl.uniform1f(u.uSnap, temblor > 0 ? temblor * 2 + mid : 0);
      const P = esc.pantalla;
      // (la pantalla es una luz con área: se pone el punto de luz un poco por delante, así también
      // alcanza de refilón la pared en la que se apoya, como pasa con un tubo encendido)
      gl.uniform3fv(u.uScrPos, add(P.center, mulS(P.normal, P.width * 0.55)));
      gl.uniform3fv(u.uScrC, P.center);
      gl.uniform3fv(u.uScrN, P.normal);
      gl.uniform1f(u.uScrFall, esc.scr.fall);
      const lp = new Float32Array(12), lc = new Float32Array(12), lf = new Float32Array(4);
      esc.luces.slice(0, 4).forEach((l, i) => { lp.set(l.pos, i * 3); lc.set(l.col, i * 3); lf[i] = l.fall; });
      gl.uniform3fv(u.uLp, lp); gl.uniform3fv(u.uLc, lc); gl.uniform1fv(u.uLf, lf);
      gl.uniform3fv(u.uAmb, esc.amb);
      gl.uniform2f(u.uFog, esc.fog[3], esc.fog[4]);
      gl.uniform3f(u.uFogCol, esc.fog[0], esc.fog[1], esc.fog[2]);
      gl.uniform1f(u.uLuz, esc.scr.power * (luz / FABRICA.luz) * (1 + 0.8 * beat + 0.4 * bass));
      gl.uniform1f(u.uTime, (now / 1000) % 3600);
      gl.uniform1f(u.uScrGain, 1.42 * (1 + 0.6 * beat));
      gl.uniform1f(u.uScrKind, esc.scr.kind);
      gl.uniform1f(u.uRoll, beat);
      gl.uniform1f(u.uTwinkle, treble);
      gl.uniform2f(u.uCamSize, cw, ch);
      gl.uniform1f(u.uAdd, 0);
      const afin = o._perspectiva ? 0 : 1;
      gl.uniform1f(u.uAfin, afin); gl.uniform1f(u.uAfinV, afin);
      const g = esc.mesh.groups;
      if (g.fijo[1]) gl.drawArrays(gl.TRIANGLES, g.fijo[0], g.fijo[1]);
      if (g.aspa[1] && esc.aspa) {
        // el ventilador gira sobre su eje: su propio tramo con su matriz
        const a = now / 1000 * esc.aspa.speed, c = Math.cos(a), s = Math.sin(a), pv = esc.aspa.pivot;
        gl.uniformMatrix4fv(u.uModel, false, new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, pv[0], pv[1], pv[2], 1]));
        gl.drawArrays(gl.TRIANGLES, g.aspa[0], g.aspa[1]);
        gl.uniformMatrix4fv(u.uModel, false, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
      }
      if (g.luz[1]) {
        // luz que se suma (las franjas de la persiana): sin escribir profundidad
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
        gl.uniform1f(u.uAdd, 1);
        gl.drawArrays(gl.TRIANGLES, g.luz[0], g.luz[1]);
        gl.uniform1f(u.uAdd, 0);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      gl.disable(gl.DEPTH_TEST);
      // 4 · El resplandor: cuatro reducciones (½, ¼, ⅛, 1/16); la primera solo con lo que emite.
      bindQuad();
      gl.useProgram(res.down.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(res.down.u.uSrc, 0);
      let from = set.scene;
      set.b.forEach((t, i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.viewport(0, 0, t.w, t.h);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform2f(res.down.u.uTexel, 1 / from.w, 1 / from.h);
        gl.uniform1f(res.down.u.uFirst, i === 0 ? 1 : 0);
        gl.uniform1f(res.down.u.uSpread, i === 0 ? 0.5 : 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        from = t;
      });
      // 5 · Final al lienzo de la gráfica (del tamaño interno): 5 bits y tramado.
      if (canvas.width !== iw || canvas.height !== ih) { canvas.width = iw; canvas.height = ih; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, iw, ih);
      const Q = res.post;
      gl.useProgram(Q.prog);
      [set.scene, ...set.b].forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t.tex); });
      gl.uniform1i(Q.u.uScene, 0); gl.uniform1i(Q.u.uB1, 1); gl.uniform1i(Q.u.uB2, 2); gl.uniform1i(Q.u.uB3, 3); gl.uniform1i(Q.u.uB4, 4);
      gl.uniform2f(Q.u.uRes, iw, ih);
      gl.uniform1f(Q.u.uDither, trama / FABRICA.trama);
      gl.uniform1f(Q.u.uBloom, 1 + 0.4 * bass);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);
      // 6 · Ampliado sin suavizar al tamaño pedido.
      ctx.save();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, iw, ih, 0, 0, outW, outH);
      ctx.restore();
    } catch (error) {
      // una fuente que aún no tiene imagen: este cuadro no se pinta, el siguiente sí
      if (!gl || gl.isContextLost()) return false;
      return true;
    }
    // dónde quedó la pantalla en la imagen (para las pruebas y para quien quiera encuadrar)
    const pts = esc.pantalla.corners.map(p => project(VP, p, outW, outH));
    let pantalla = { visible: false, rect: null };
    if (pts.every(Boolean)) {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(outW, Math.max(...xs)), y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(outH, Math.max(...ys));
      if (x1 > x0 && y1 > y0) pantalla = { visible: true, rect: [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)], quad: pts.map(p => [Math.round(p[0]), Math.round(p[1])]), entera: +((x1 - x0) * (y1 - y0) / ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)))).toFixed(3) };
    }
    Object.assign(stats, { frames: stats.frames + 1, ms: performance.now() - started, variant: name, size: [iw, ih], out: [outW, outH], phase: +phase.toFixed(4), eye: pose.eye.map(v => +v.toFixed(3)), look: pose.look.map(v => +v.toFixed(3)), fov: +(pose.fovY * 180 / Math.PI).toFixed(1), pantalla, audio: !!audio, tris: esc.mesh.tris });
    return true;
  }

  // Soltar la gráfica cuando la cámara deja de usarse (la geometría armada se queda en memoria: es poca).
  function release() {
    if (!gl) return;
    const ext = gl.getExtension('WEBGL_lose_context'), old = canvas;
    soltados.add(old);
    drop();
    try { if (ext) ext.loseContext(); } catch (_) {}
    if (old) { old.width = 1; old.height = 1; }
  }

  window.renderCuarto = renderCuarto;
  window.flipCuarto = {
    FABRICA, VARIANTES: Object.keys(ESCENAS), release,
    // milisegundos de una vuelta del paseo con ese giro (sin sonido)
    cycle: giro => (num(giro, FABRICA.giro) > 0 ? CICLO * FABRICA.giro / num(giro, FABRICA.giro) * 1000 : Infinity),
    state: () => ({ gl: !!gl, failed, lost, ...stats, ms: +stats.ms.toFixed(2), triangulos: Object.fromEntries(Object.keys(ESCENAS).map(k => [k, escena(k).mesh.tris])) }),
    // Para las pruebas: una pérdida de la gráfica como la que provoca el sistema.
    _perder() { const ext = gl && gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); return !!ext; },
  };
})();
