// FLIP · CUARTO: tu cámara sale en la pantalla encendida de un cuarto a oscuras.
//
// No es un filtro sobre la imagen: es un cuarto en 3D, armado aquí con cajas y planos y pintado como
// lo pintaba una consola de 32 bits. Lo que ve la cámara del teléfono sale EN VIVO en la pantalla
// de ese cuarto (el televisor, el monitor, el anuncio de la azotea), y esa pantalla es la luz del
// cuarto: su color medio tiñe lo que tiene delante (si la cámara ve algo rojo, el cuarto se pone rojo).
// Ocho escenas, cada una con su pantalla:
//   · DORMITORIO  cama, cómoda, televisor de tubo, persiana con luz de luna, ventilador que gira.
//   · OFICINA     escritorio, computadora de tubo con teclado, luminarias de techo, mamparas.
//   · AZOTEA      barandal con malla, edificios con ventanas encendidas y un anuncio luminoso grande.
//   · TORRE       una torre de cristal con pantalla gigante, vista desde una azotea de la ciudad.
//   · AUTOBUS     la tele colgada del techo de un articulado, desde un asiento; la avenida pasa.
//   · AUTOCINEMA  la película en la pantalla grande; cámara fija; alguien se acuesta en el cofre.
//   · ESCAPARATE  un muro de teles en una vitrina, desfasadas, reflejadas en los charcos.
//   · TAQUERIA    la tele chiquita arriba del refri de un puesto de tacos, con el trompo girando.
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
// pantalla y el cuarto compongan igual en un teléfono que en horizontal. Con paseo: false va, sin
// salto, al plano de pantalla (de frente, entera y grande) y se queda; lo ambiental sigue vivo.
//
//   renderCuarto(fuente, anchoFuente, altoFuente, ctx2d, espejo, variante, opciones) → false sin gráfica
//   opciones (todas opcionales; de 0 a 1): giro (velocidad del paseo, 0,35; 0 = quieta en el plano
//     de presentación), luz (cuánto alumbra la pantalla, 0,7), trama (tramado, 0,6), temblor
//     (vértices a la rejilla, 0,5), paseo (booleano, true; false = plano de pantalla); now, path,
//     outW, outH; audio: { bass, mid, treble, beat }.
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
  const rotZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  // matriz de modelo (por columnas) desde un giro 3 × 3 por filas y un traslado
  const M4 = (r, t) => new Float32Array([r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, t[0], t[1], t[2], 1]);
  const m3v = (r, v) => [r[0] * v[0] + r[1] * v[1] + r[2] * v[2], r[3] * v[0] + r[4] * v[1] + r[5] * v[2], r[6] * v[0] + r[7] * v[1] + r[8] * v[2]];
  const IDM = M4(ID3, [0, 0, 0]);

  // ── Texturas propias, hechas aquí píxel a píxel ─────────────────────────────
  // Un atlas de 256 × 1024 con 64 baldosas de 64 × 64. El alfa de cada texel dice qué es: 255 opaco,
  // 128 emite luz (las ventanas encendidas, las estrellas, los focos) y 0 hueco (la malla, las hojas).
  // Se sube como bytes crudos, sin pasar por un lienzo 2D, para que el alfa no altere el color.
  const T = {
    liso: 0, madera: 1, cuadros: 2, rayada: 3, teclas: 4, ladrillo: 5, ventanas: 6, alfombra: 7,
    persiana: 8, estrellas: 9, concreto: 10, malla: 11, tablero: 12, plafon: 13, luminaria: 14, cartelA: 15,
    cartelB: 16, cartelC: 17, colcha: 18, cajones: 19, rejilla: 20, focos: 21, ventanas2: 22, planta: 23,
    rayos: 24, papel: 25, metal: 26, oficinas: 27, cartelD: 28, cartelE: 29, bolsa: 30, cinta: 31,
    cristal: 32, lona: 33, cortina: 34, asfalto: 35, banqueta: 36, charco: 37, carne: 38, azulejo: 39,
    asiento: 40, piso: 41, tinaco: 42, humo: 43, ventanas3: 44, haz: 45, grava: 46, impermeable: 47,
    charcoAsf: 48,
  };
  const AW = 256, AH = 1024, TS = 64, TAU = Math.PI * 2;
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
      // torre de cristal oscuro: un piso cada 8 texels, módulos de 8; pocas ventanas encendidas
      cristal: (x, y) => {
        const cx = x % 8, cy = y % 8, col = x >> 3, row = y >> 3;
        if (cy === 0) return [74, 78, 98];
        if (cx === 0) return [52, 56, 74];
        const r = hash2(col, row, 101);
        if (r < 0.012) return r < 0.008 ? [255, 206, 120, 170] : [170, 205, 255, 170];
        const v = 12 + (hash2(col, row, 102) - 0.5) * 8 + (cy < 3 ? 7 : 0);
        return [v, v + 4, v + 15];
      },
      // lona de puesto: franjas anchas roja y crema, con pliegues
      lona: (x, y) => { const c = (x >> 3) & 1 ? [214, 58, 52] : [234, 226, 206]; return shade(c, 0.86 + 0.14 * Math.cos(y * TAU / 64 * 2)); },
      // cortina metálica: costillas horizontales con algo de óxido
      cortina: (x, y) => {
        const r = y % 4, c = r === 0 ? [156, 156, 166] : r === 3 ? [58, 58, 68] : [118, 118, 130];
        return vnoise(x, y, 8, 111) > 0.72 ? mixc(c, [120, 72, 46], 0.5) : c;
      },
      asfalto: (x, y) => { const v = 38 + (hash2(x, y, 121) - 0.5) * 22; return hash2(x, y, 122) < 0.012 ? [120, 120, 130] : [v, v, v + 6]; },
      banqueta: (x, y) => { if (x % 32 === 0 || y % 32 === 0) return [62, 60, 66]; const v = 104 + vnoise(x, y, 8, 131) * 18 + (hash2(x, y, 132) - 0.5) * 12; return [v, v - 2, v + 4]; },
      // la banqueta con charcos: donde hay agua, hueco (debajo va el reflejo)
      charco: (x, y) => {
        const w = vnoise(x, y, 16, 141) * 0.75 + vnoise(x, y, 8, 142) * 0.25;
        if (w > 0.62) return [0, 0, 0, 0];
        if (w > 0.57) return [40, 40, 48];
        if (x % 32 === 0 || y % 32 === 0) return [58, 56, 62];
        const v = 92 + vnoise(x, y, 8, 131) * 16; return [v, v - 2, v + 6];
      },
      // el asfalto mojado con charcos (huecos: debajo va el reflejo)
      charcoAsf: (x, y) => {
        const w = vnoise(x, y, 16, 143) * 0.7 + vnoise(x, y, 8, 144) * 0.3;
        if (w > 0.6) return [0, 0, 0, 0];
        if (w > 0.55) return [26, 26, 32];
        const v = 36 + (hash2(x, y, 121) - 0.5) * 20; return [v, v, v + 6];
      },
      // el trompo: capas de carne roja anaranjada con orillas tostadas y vetas de grasa
      carne: (x, y) => {
        const band = (y + Math.sin(x * TAU / 64 * 2) * 2) % 6;
        if (band < 1) return [70, 24, 12];
        if (hash2(x >> 1, y, 151) < 0.08) return [232, 168, 112];
        const v = (hash2(x, y, 152) - 0.5) * 30; return [180 + v, 66 + v * 0.5, 30];
      },
      // azulejo de barra: blanco con una flor geométrica azul (forma propia)
      azulejo: (x, y) => {
        const cx = x % 16, cy = y % 16;
        if (cx === 0 || cy === 0) return [150, 150, 160];
        const d = Math.abs(cx - 8) + Math.abs(cy - 8);
        if (d < 3 || (d > 5 && d < 7) || (cx === 8 || cy === 8) && d < 9) return [40, 72, 168];
        return [228, 228, 234];
      },
      // tela de asiento de autobús: azul oscuro con confeti de colores
      asiento: (x, y) => {
        const h = hash2(x >> 1, y >> 1, 161);
        if (h < 0.05) return [[230, 200, 60], [220, 70, 110], [60, 190, 200]][Math.floor(h * 60) % 3];
        const v = (hash2(x, y, 162) - 0.5) * 14; return [38 + v, 46 + v, 108 + v];
      },
      // piso de hule con botones
      piso: (x, y) => { const d = Math.hypot((x % 8) - 3.5, (y % 8) - 3.5); return d < 2 ? [96, 96, 104] : d < 2.6 ? [46, 46, 52] : [70, 70, 78]; },
      tinaco: (x, y) => (y % 8 < 2 ? [56, 56, 62] : [30, 30, 34]),
      // mancha suave para humo, vapor y haces (se suma)
      humo: (x, y) => { const d = Math.hypot(x - 31.5, y - 31.5) / 31.5, v = 255 * Math.pow(Math.max(0, 1 - d), 2); return [v, v, v]; },
      // edificios bajos de ciudad: ventanas de todos tamaños, cortinas de colores, algunas prendidas
      ventanas3: (x, y) => {
        const cx = x % 16, cy = y % 16, col = x >> 4, row = y >> 4;
        if (cx >= 3 && cx < 13 && cy >= 4 && cy < 13) {
          const r = hash2(col, row, 171);
          if (r < 0.4) { const t = hash2(col, row, 172); return t < 0.2 ? [240, 150, 90, 128] : t < 0.3 ? [150, 230, 170, 128] : t < 0.45 ? [200, 220, 255, 128] : [255, 214, 140, 128]; }
          return [26, 26, 34];
        }
        const v = 70 + (hash2(col, row, 173) - 0.5) * 30 + (hash2(x, y, 174) - 0.5) * 10; return [v, v - 6, v - 12];
      },
      // haz de luz: fuerte abajo, se apaga hacia arriba y hacia los lados (se suma)
      haz: (x, y) => { const v = 255 * Math.pow(y / 63, 1.6) * Math.pow(Math.max(0, 1 - Math.abs(x - 31.5) / 32), 1.5); return [v, v, v]; },
      grava: (x, y) => { const v = 66 + (hash2(x, y, 181) - 0.5) * 34; return hash2(x >> 1, y >> 1, 182) < 0.1 ? [v + 30, v + 26, v + 20] : [v, v - 3, v - 8]; },
      // impermeabilizante rojo de azotea, con parches
      impermeable: (x, y) => { const v = (hash2(x, y, 191) - 0.5) * 16 + vnoise(x, y, 16, 192) * 24; return (x % 32 === 0) ? [110, 46, 38] : [150 + v, 62 + v * 0.5, 50 + v * 0.4]; },
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
  // material (baldosa, cuánto emite, tipo, cuánto resplandece). Tipos: 0 normal, 1 pantalla, 2 cielo
  // (sin niebla, con estrellas), 3 recorte (la malla, las hojas), 4 luz que parpadea. En una pantalla,
  // la «baldosa» es su retraso (cuántos cuadros atrás muestra) y el color del vértice, su tinte.
  // La geometría va en tramos: «fijo» (lo quieto), piezas que se mueven con su propia matriz (el
  // ventilador, el trompo, una persona…) y tramos que se SUMAN a lo pintado (franjas de luz, humo).
  const STRIDE = 15;
  const WHITE = [1, 1, 1];
  function Builder() {
    const segs = [{ name: 'fijo', add: false, v: [] }];
    let cur = segs[0], R = ID3, Tr = [0, 0, 0];
    const tp = p => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + Tr[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + Tr[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + Tr[2]];
    const tn = n => norm([R[0] * n[0] + R[1] * n[1] + R[2] * n[2], R[3] * n[0] + R[4] * n[1] + R[5] * n[2], R[6] * n[0] + R[7] * n[1] + R[8] * n[2]]);
    const matv = m => [m.tile || 0, m.emis || 0, m.kind || 0, m.glow == null ? 1 : m.glow];
    function vert(p, n, uv, c, m) { const q = tp(p), k = tn(n); cur.v.push(q[0], q[1], q[2], k[0], k[1], k[2], uv[0], uv[1], c[0], c[1], c[2], m[0], m[1], m[2], m[3]); }
    const B = {
      pantalla: null, pantallas: [], principal: null,
      // tramo: 'fijo', 'luz' (se suma) o el nombre de una pieza; { add } si se suma
      seg(name, opts) { cur = segs.find(x => x.name === name) || (segs.push({ name, add: !!(opts && opts.add) || name === 'luz', v: [] }), segs[segs.length - 1]); },
      actual() { return cur.name; },
      // dibuja dentro de un giro (filas 3 × 3) y un traslado, encadenados con los de fuera
      xf(rot, t, fn) { const oR = R, oT = Tr; Tr = add(tp(t), [0, 0, 0]); R = m3(oR, rot); fn(); R = oR; Tr = oT; },
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
      tri(p0, p1, p2, mat) {
        const n = norm(cross(sub(p1, p0), sub(p2, p0))), m = matv(mat), c = mat.col || WHITE;
        vert(p0, n, [0, 0], c, m); vert(p1, n, [1, 0], c, m); vert(p2, n, [0.5, 1], c, m);
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
      // un cilindro de n caras (tinacos, postes, el trompo): base en c, radio abajo r y arriba r2
      cil(c, r, h, n, mat, opts) {
        const o = opts || {}, r2 = o.r2 == null ? r : o.r2, a0 = o.a0 || 0, P = (a, rr, y) => [c[0] + Math.cos(a) * rr, c[1] + y, c[2] + Math.sin(a) * rr];
        for (let i = 0; i < n; i++) {
          const a = a0 + i / n * TAU, b2 = a0 + (i + 1) / n * TAU, u0 = i / n * (o.urep || 1), u1 = (i + 1) / n * (o.urep || 1);
          B.quad4(P(b2, r, 0), P(a, r, 0), P(a, r2, h), P(b2, r2, h), { ...mat, uv: [u0, 0, u1, o.vrep || 1] });
          if (o.tapa !== false && r2 > 0) B.tri(P(b2, r2, h), P(a, r2, h), [c[0], c[1] + h, c[2]], o.tapaMat || mat);
          if (o.base) B.tri(P(a, r, 0), P(b2, r, 0), c, o.baseMat || mat);
        }
      },
      // una pantalla: un plano algo abombado que muestra la cámara. opts.retraso (cuadros atrás),
      // opts.tinte, opts.registrar (false en un reflejo: no cuenta como pantalla ni da luz)
      screen(o, U, W, mat, opts) {
        const op = opts || {};
        B.quad(o, U, W, { ...mat, kind: 1, emis: 1, glow: op.glow == null ? 1 : op.glow, uv: [0, 0, 1, 1], tile: op.retraso || 0, col: op.tinte || WHITE });
        if (op.registrar === false) return;
        const corners = [o, add(o, U), add(add(o, U), W), add(o, W)].map(tp);
        const p = { corners, center: mulS(corners.reduce(add, [0, 0, 0]), 0.25), normal: tn(cross(U, W)), aspect: len(U) / len(W), width: len(U) };
        B.pantallas.push(p);
        if (!B.pantalla) B.pantalla = p;
      },
      // la «pantalla» de la escena, si es un conjunto (el muro de teles): sus cuatro esquinas
      ponPrincipal(corners, normal) { const width = len(sub(corners[1], corners[0])); B.principal = { corners, center: mulS(corners.reduce(add, [0, 0, 0]), 0.25), normal: norm(normal), aspect: width / len(sub(corners[3], corners[0])), width }; },
      finish() {
        const order = segs.filter(x => !x.add).concat(segs.filter(x => x.add)), groups = [];
        let at = 0;
        for (const g of order) { const n = g.v.length / STRIDE; if (n) groups.push({ name: g.name, add: g.add, start: at, count: n }); at += n; }
        const data = new Float32Array(at * STRIDE);
        let k = 0;
        for (const g of order) { data.set(g.v, k); k += g.v.length; }
        return { data, groups, verts: at, tris: at / 3 };
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

  // Un cielo: caja enorme vista por dentro, con estrellas y el color que diga colFn (resplandor abajo).
  function cieloCaja(B, S, bot, top, colFn, div) {
    const cielo = { tile: T.estrellas, kind: 2, glow: 0.7, div: div || [4, 3], colFn };
    pared(B, 'z', -S, 1, -S, S, bot, top, cielo); pared(B, 'z', S, -1, -S, S, bot, top, cielo);
    pared(B, 'x', -S, 1, -S, S, bot, top, cielo); pared(B, 'x', S, -1, -S, S, bot, top, cielo);
    B.quad([-S, top, -S], [2 * S, 0, 0], [0, 0, 2 * S], { ...cielo, div: [3, 3] });
  }
  // Una silla de plástico (asiento, respaldo y cuatro patas), mirando hacia +z antes de girarla.
  function silla(B, pos, rot, col) {
    const m = { tile: T.liso, col: col || [0.86, 0.86, 0.9] };
    B.xf(rotY(rot), pos, () => {
      B.box([-0.22, 0.42, -0.22], [0.22, 0.46, 0.22], m);
      B.box([-0.22, 0.46, -0.24], [0.22, 0.88, -0.2], m);
      for (const [x, z] of [[-0.2, -0.2], [0.17, -0.2], [-0.2, 0.17], [0.17, 0.17]]) B.box([x, 0, z], [x + 0.03, 0.42, z + 0.03], m, { ny: null, py: null });
    });
  }
  // Una maceta con su mata (dos planos cruzados con hojas recortadas).
  function maceta(B, pos, h, col) {
    B.cil(pos, 0.16, 0.3, 6, { tile: T.liso, col: col || [0.68, 0.36, 0.26] }, { r2: 0.2, tapa: false });
    const [x, y, z] = pos, m = { tile: T.planta, kind: 3, uv: [0, 0, 1, 1] };
    B.quad([x - h / 2, y + 0.22, z], [h, 0, 0], [0, h, 0], m); B.quad([x, y + 0.22, z - h / 2], [0, 0, h], [0, h, 0], m);
  }

  // Una persona de pocos polígonos. De una postura (dónde está la cadera, hacia dónde mira, cuánto se
  // echa atrás, y los ángulos de hombros, codos, caderas y rodillas) sale el giro y la posición de cada
  // parte; así se arma quieta o se mueve pieza a pieza. Mira hacia +z antes de girarla.
  function esqueleto(p) {
    const R0 = rotY(p.yaw || 0), P0 = p.pos, out = {}, put = (k, R, t) => { out[k] = { R, t }; };
    put('cadera', R0, P0);
    const Rt = m3(R0, rotX(-(p.lean || 0)));
    put('torso', Rt, P0);
    put('cabeza', m3(m3(Rt, rotY(p.giraCabeza || 0)), rotX(p.cabeza || 0)), add(P0, m3v(Rt, [0, 0.53, 0])));
    [[0, -1], [1, 1]].forEach(([k, sx]) => {
      const L = k ? 'D' : 'I', sh = add(P0, m3v(Rt, [sx * 0.235, 0.47, 0]));
      const Ra = m3(Rt, m3(rotX(-(p.hom ? p.hom[k] : 0)), rotZ(sx * (p.abre ? p.abre[k] : 0.08))));
      put('brazo' + L, Ra, sh);
      const el = add(sh, m3v(Ra, [0, -0.29, 0])), Rf = m3(Ra, rotX(-(p.codo ? p.codo[k] : 0.12)));
      put('antebrazo' + L, Rf, el);
      out['mano' + L] = add(el, m3v(Rf, [0, -0.3, 0]));
      const hip = add(P0, m3v(R0, [sx * 0.095, 0, 0])), Rh = m3(R0, m3(rotX(-(p.cad ? p.cad[k] : 0)), rotZ(-sx * (p.cierra ? p.cierra[k] : 0))));
      put('muslo' + L, Rh, hip);
      put('pierna' + L, m3(Rh, rotX(p.rod ? p.rod[k] : 0)), add(hip, m3v(Rh, [0, -0.44, 0])));
    });
    return out;
  }
  const PARTES = ['cadera', 'torso', 'cabeza', 'brazoI', 'brazoD', 'antebrazoI', 'antebrazoD', 'musloI', 'musloD', 'piernaI', 'piernaD'];
  function parteGeo(B, parte, c) {
    const m = col => ({ tile: T.liso, col }), no = { ny: null };
    if (parte === 'cadera') B.box([-0.16, -0.09, -0.1], [0.16, 0.05, 0.1], m(c.pantalon), no);
    else if (parte === 'torso') B.box([-0.18, 0, -0.1], [0.18, 0.5, 0.11], c.camisaMat || m(c.camisa));
    else if (parte === 'cabeza') { B.box([-0.095, 0.02, -0.1], [0.095, 0.25, 0.1], m(c.piel)); B.box([-0.105, 0.16, -0.115], [0.105, 0.28, 0.07], m(c.pelo), no); }
    else if (parte.startsWith('brazo')) B.box([-0.052, -0.29, -0.052], [0.052, 0.03, 0.052], m(c.camisa), no);
    else if (parte.startsWith('antebrazo')) { B.box([-0.045, -0.25, -0.045], [0.045, 0, 0.045], m(c.manga || c.camisa), no); B.box([-0.04, -0.33, -0.035], [0.04, -0.25, 0.035], m(c.piel)); }
    else if (parte.startsWith('muslo')) B.box([-0.075, -0.45, -0.08], [0.075, 0.02, 0.08], m(c.pantalon), no);
    else { B.box([-0.06, -0.42, -0.06], [0.06, 0, 0.06], m(c.pantalon), no); B.box([-0.055, -0.47, -0.07], [0.055, -0.42, 0.15], m(c.zapato)); }
  }
  // opts.piezas: true (todas) o la lista de partes que van como piezas (con su matriz) con el prefijo dado
  function figura(B, pose, ropa, opts) {
    const o = opts || {}, E = esqueleto(pose), vuelta = B.actual();
    for (const parte of PARTES) {
      if (o.piezas && (o.piezas === true || o.piezas.includes(parte))) { B.seg(o.prefijo + parte); parteGeo(B, parte, ropa); B.seg(vuelta); }
      else B.xf(E[parte].R, E[parte].t, () => parteGeo(B, parte, ropa));
    }
  }
  const mueveFigura = (a, prefijo, pose, partes) => { const E = esqueleto(pose); for (const k of partes || PARTES) a[prefijo + k] = { m: M4(E[k].R, E[k].t) }; return E; };
  const SILUETA = { piel: [0.3, 0.24, 0.26], pelo: [0.08, 0.07, 0.09], camisa: [0.18, 0.17, 0.24], pantalon: [0.14, 0.14, 0.2], zapato: [0.06, 0.06, 0.08] };
  // Un auto cualquiera (sin marca): carrocería, cabina de vidrio oscuro, ruedas, faros y calaveras.
  // Mira hacia −z; el cofre queda arriba de la carrocería, de z −2,1 a −0,75 (altura 0,86).
  function auto(B, pos, rot, col, lejos, detalle) {
    const pint = { tile: T.liso, col }, vid = { tile: T.liso, col: [0.07, 0.08, 0.13] }, neg = { tile: T.liso, col: [0.08, 0.08, 0.1] }, tapacubos = { tile: T.liso, col: [0.62, 0.62, 0.68] };
    B.xf(rotY(rot), pos, () => {
      B.box([-0.88, 0.3, -2.1], [0.88, 0.86, 2.1], pint, { ny: null });
      const lo = [[-0.84, 0.86, -0.72], [0.84, 0.86, -0.72], [0.84, 0.86, 1.15], [-0.84, 0.86, 1.15]], hi = [[-0.72, 1.36, -0.18], [0.72, 1.36, -0.18], [0.72, 1.36, 0.78], [-0.72, 1.36, 0.78]];
      B.quad4(lo[1], lo[0], hi[0], hi[1], vid); B.quad4(lo[3], lo[2], hi[2], hi[3], vid);
      B.quad4(lo[0], lo[3], hi[3], hi[0], vid); B.quad4(lo[2], lo[1], hi[1], hi[2], vid);
      B.quad4(hi[0], hi[3], hi[2], hi[1], pint);
      B.box([-0.9, 0.24, -2.16], [0.9, 0.42, -2.06], neg, { ny: null }); B.box([-0.9, 0.24, 2.06], [0.9, 0.42, 2.16], neg, { ny: null });
      for (const x of [-0.62, 0.62]) {
        B.box([x - 0.16, 0.6, -2.115], [x + 0.16, 0.72, -2.1], { tile: T.liso, col: [0.9, 0.88, 0.7], emis: 0.25, glow: 0.4 });
        B.box([x - 0.16, 0.62, 2.1], [x + 0.16, 0.72, 2.115], { tile: T.liso, col: [0.9, 0.12, 0.1], emis: 0.45, glow: 0.6 });
      }
      if (!lejos) for (const [x, z] of [[-0.86, -1.3], [0.86, -1.3], [-0.86, 1.3], [0.86, 1.3]]) B.xf(rotZ(Math.PI / 2), [x, 0.32, z], () => { if (!detalle) { B.cil([0, -0.12, 0], 0.32, 0.24, 6, neg, { tapa: false }); return; } B.cil([0, -0.12, 0], 0.32, 0.24, 8, neg, { base: true }); B.cil([0, -0.135, 0], 0.16, 0.27, 6, tapacubos, { base: true }); });
    });
  }

  // ── Las escenas ─────────────────────────────────────────────────────────────
  // Cada una arma su geometría y dice: luces (hasta 4, por vértice), luz ambiente, niebla, cuánto y
  // hasta dónde alumbra la pantalla, qué clase de pantalla es (tubo o anuncio de focos) y el
  // recorrido de la cámara (planos por los que pasa: ojo, adónde mira, campo del lado corto).
  // el parpadeo de un tubo fluorescente viejo: casi siempre encendido, con rachas de tartamudeo
  const parpadeo = t => { const k = t % 7.3; return k > 5.6 && k < 6.5 ? (Math.sin(k * 47) > 0.1 ? 1 : 0) : k > 6.5 && k < 6.75 ? 0 : 1; };
  // el encuadre del autocinema (ojo, desvío y distancia de la pantalla del fondo, mira y campo)
  const CINE = { cam: [-5.44, 0.3, 3.74], sw: 24, sy: 3.0, desvio: 0.08, dist: 62, mira: [9.0, 1.45, -3.5], miraH: [9.0, 1.05, -3.5], fov: 36, fovH: 29.5 };
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
        anim: t => ({ aspa: { m: M4(rotY(-t * 1.5), [fx, 2.32, fz]) } }),
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

    // La torre de cristal con su pantalla gigante, vista de noche desde una azotea de la ciudad: tinacos,
    // tendedero, antenas, una silla, macetas y el cuartito con su foco. La torre (inventada, sin rótulos):
    // losa ancha de cristal oscuro, la pantalla apaisada 3:2 en su tercio medio, un cilindro bajo con aro
    // de luces encima y la aguja rosa; detrás, haces de luz que suben.
    TORRE(B) {
      const imp = { tile: T.impermeable, col: [0.6, 0.55, 0.62], rep: [0.7, 0.7], cell: 1.6 };
      const pretil = { tile: T.concreto, col: [0.6, 0.56, 0.62], rep: [0.8, 0.8], cell: 1.4 };
      const metal = { tile: T.metal, col: [0.55, 0.55, 0.62] };
      cieloCaja(B, 900, -60, 800, p => mixc([3.4, 2.4, 2.6], [2.4, 2.2, 2.8], Math.pow(clamp((p[1] + 20) / 240), 0.55)));
      // la calle y la ciudad baja
      B.quad([-900, -18, 40], [1800, 0, 0], [0, 0, -900], { tile: T.asfalto, col: [0.3, 0.28, 0.32], rep: [0.02, 0.02], div: [2, 2] });
      let seed = 21;
      const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      const vent = { tile: T.ventanas3, rep: [1 / 7, 1 / 7], col: [0.75, 0.72, 0.8], cell: 14, glow: 0.45 };
      for (let i = 0; i < 34; i++) {
        const z = -16 - rnd() * 260, x = -200 + (i % 14) * 30 + (rnd() - 0.5) * 14, w = 14 + rnd() * 16, d = 10 + rnd() * 14, h = -12 + rnd() * (z < -120 ? 34 : 13);
        if (x > -75 && x < 95 && z < -230) continue;                   // el pie de la torre, despejado
        if (Math.abs(x) < 10 && z > -45) continue;                       // delante de la azotea, la calle
        B.box([x - w / 2, -18, z - d / 2], [x + w / 2, h, z + d / 2], vent, { ny: null, py: { tile: T.concreto, col: [0.4, 0.38, 0.44] } });
        if (i % 3 === 0) B.cil([x + w / 4, h, z], 0.7, 1.2, 6, { tile: T.tinaco, uv: [0, 0, 1, 1], col: [0.5, 0.5, 0.55] });
      }
      // luces de calle anaranjadas, en filas
      const farol = { tile: T.liso, col: [1, 0.62, 0.25], emis: 1, glow: 0.9 };
      for (let k = 0; k < 14; k++) { const z = -30 - k * 8, x = -12 + (k % 2) * 24; B.box([x - 0.35, -12.6, z - 0.35], [x + 0.35, -12, z + 0.35], farol); }
      for (let k = 0; k < 16; k++) { const x = -110 + k * 14, z = -96; B.box([x - 0.35, -12.6, z - 0.35], [x + 0.35, -12, z + 0.35], farol); }
      // la torre: losa ANCHA y maciza de cristal oscuro, de lados paralelos (como en la foto: el frente
      // visible mide de ancho ~0,85 de su alto visible; la pantalla ocupa ~73 % de ese ancho, en la
      // franja media-alta), algo girada para que se vea su costado izquierdo
      const TX = 8, TZ = -300, TW = 136, TD = 46, T0 = -18, T1 = 156, GIRO = 0.2;
      const cristal = { tile: T.cristal, rep: [1 / 16, 1 / 30], col: [0.9, 0.9, 1], cell: 26, glow: 0.6 };
      const cz = -TD / 2 - 6, CR = 20, CH = 24;
      B.xf(rotY(GIRO), [TX, 0, TZ], () => {
        B.box([-TW / 2, T0, -TD], [TW / 2, T1, 0], cristal, { ny: null, py: { tile: T.concreto, col: [0.3, 0.3, 0.36] } });
        // la pantalla gigante de focos: apaisada 3:2, 73 % del ancho del frente
        B.box([-51, 62.5, 0], [51, 131.5, 0.7], { tile: T.metal, col: [0.2, 0.2, 0.26] });
        B.screen([-49.5, 64, 0.8], [99, 0, 0], [0, 66, 0], { div: [6, 4] });
        // el remate: cilindro bajo y ancho, retranqueado, con su aro de luces azuladas, y la aguja rosa
        B.cil([0, T1, cz], CR, CH, 16, { tile: T.cristal, col: [1.5, 1.5, 1.7], glow: 0.6 }, { urep: 6, vrep: CH / 30, tapaMat: { tile: T.concreto, col: [0.3, 0.3, 0.36] } });
        B.cil([0, T1 + 3, cz], CR + 0.4, 2.4, 16, { tile: T.liso, col: [0.55, 0.78, 1], emis: 1, glow: 1 }, { tapa: false });
        B.cil([0, T1 + CH - 1.2, cz], CR + 0.3, 1.0, 16, { tile: T.liso, col: [0.45, 0.6, 1], emis: 0.7, glow: 0.8 }, { tapa: false });
        B.cil([0, T1 + CH, cz], 10, 3, 10, { tile: T.metal, col: [0.3, 0.3, 0.38] }, {});
        const rosa = { tile: T.liso, col: [1, 0.36, 0.56], emis: 0.9, glow: 1 }, top = T1 + CH + 3;
        for (let k = 0; k < 4; k++) { const y0 = top + k * 6, r = 4.2 - k * 0.8; B.cil([0, y0, cz], r, 5.4, 4, k % 2 ? rosa : metal, { r2: r - 0.7, a0: Math.PI / 4, tapa: false }); B.cil([0, y0 + 5.4, cz], r - 0.6, 0.6, 4, rosa, { r2: r - 0.8, a0: Math.PI / 4 }); }
        B.box([-0.5, top + 24, cz - 0.5], [0.5, top + 32, cz + 0.5], rosa);
        B.box([-1.1, top + 32, cz - 1.1], [1.1, top + 33.6, cz + 1.1], { tile: T.liso, col: [1, 0.15, 0.12], kind: 4, emis: 1, glow: 1 });
      });
      // (para medir: el frente de la losa, del techo para abajo)
      const Rg = rotY(GIRO), aMundo = p => add(m3v(Rg, p), [TX, 0, TZ]);
      const frente = [[-TW / 2, T0, 0.1], [TW / 2, T0, 0.1], [TW / 2, T1, 0.1], [-TW / 2, T1, 0.1]].map(aMundo);
      // la azotea: impermeabilizante rojo, pretiles
      B.quad([-6, 0, 7], [12, 0, 0], [0, 0, -11], imp);
      B.box([-6.2, 0, -4.25], [6.2, 1.0, -4.0], pretil); B.box([-6.25, 1.0, -4.3], [6.25, 1.08, -3.95], { tile: T.concreto, col: [0.7, 0.68, 0.72] });
      B.box([-6.25, 0, -4.0], [-6.0, 1.0, 7], pretil); B.box([6.0, 0, -4.0], [6.25, 1.0, 7], pretil);
      // tinacos negros sobre su base, a la izquierda, con su tubería
      for (const [x, z] of [[-1.7, -3.1], [-2.8, -2.2]]) {
        B.box([x - 0.55, 0, z - 0.55], [x + 0.55, 0.5, z + 0.55], { tile: T.concreto, col: [0.5, 0.48, 0.54] });
        B.cil([x, 0.5, z], 0.52, 1.15, 10, { tile: T.tinaco, uv: [0, 0, 1, 1], col: [0.62, 0.62, 0.68] }, { urep: 3, vrep: 2, tapaMat: { tile: T.tinaco, col: [0.5, 0.5, 0.56] } });
        B.cil([x, 1.65, z], 0.22, 0.08, 8, { tile: T.liso, col: [0.2, 0.2, 0.24] });
        cable(B, [[x + 0.5, 0.9, z], [x + 0.9, 0.9, z], [x + 0.9, 0.03, z + 0.4]], [0.5, 0.5, 0.56]);
      }
      // antena de televisión (mástil con travesaños) y antena de plato
      B.box([3.6, 1.08, -3.75], [3.66, 4.4, -3.69], metal);
      for (let k = 0; k < 4; k++) B.box([3.1 + k * 0.05, 3.6 + k * 0.22, -3.74], [4.16 - k * 0.05, 3.63 + k * 0.22, -3.7], metal);
      B.box([-5.6, 1.0, -3.1], [-5.54, 2.1, -3.04], metal);
      B.xf(m3(rotY(0.6), rotX(-1.05)), [-5.57, 2.15, -3.07], () => B.cil([0, -0.06, 0], 0.45, 0.16, 8, { tile: T.liso, col: [0.75, 0.75, 0.8] }, { r2: 0.08 }));
      // tendedero a la derecha, de fondo a frente: la ropa queda de canto y enmarca la torre
      B.box([1.6, 0, -3.0], [1.66, 1.95, -2.94], metal); B.box([1.6, 0, 2.6], [1.66, 1.95, 2.66], metal);
      cable(B, [[1.63, 1.9, -2.97], [1.63, 1.9, 2.63]], [0.75, 0.75, 0.8]); cable(B, [[2.15, 1.9, -2.97], [2.15, 1.9, 2.63]], [0.75, 0.75, 0.8]);
      B.box([1.6, 1.88, -3.0], [2.18, 1.92, -2.94], metal); B.box([1.6, 1.88, 2.6], [2.18, 1.92, 2.66], metal);
      const ropa = [
        { x: 1.63, z: -1.9, w: 0.62, h: 0.72, mat: { tile: T.cuadros, col: [0.7, 0.85, 1], rep: [3, 3] } },
        { x: 1.63, z: -0.9, w: 0.5, h: 0.95, mat: { tile: T.rayada, col: [1, 0.75, 0.6], rep: [3, 3] } },
        { x: 1.63, z: 0.1, w: 0.6, h: 0.68, mat: { tile: T.liso, col: [0.95, 0.95, 1] } },
        { x: 1.63, z: 1.1, w: 0.42, h: 1.0, mat: { tile: T.liso, col: [0.32, 0.38, 0.65] } },
        { x: 2.15, z: -1.3, w: 0.7, h: 0.55, mat: { tile: T.colcha, col: [1, 0.85, 0.95], rep: [2, 2] } },
        { x: 2.15, z: 0.7, w: 0.55, h: 0.8, mat: { tile: T.liso, col: [0.9, 0.35, 0.35] } },
        { x: 2.15, z: 2.2, w: 0.3, h: 0.4, mat: { tile: T.liso, col: [0.95, 0.9, 0.6] } },
      ];
      ropa.forEach((r, i) => { B.seg('ropa' + i); B.quad([0, -r.h, r.w / 2], [0, 0, -r.w], [0, r.h, 0], r.mat); B.box([-0.01, -0.02, r.w / 2 - 0.09], [0.01, 0.03, r.w / 2 - 0.05], { tile: T.liso, col: [0.3, 0.8, 0.4] }); });
      B.seg('fijo');
      // una silla mirando a la torre, macetas en el pretil, un tanque de gas
      silla(B, [-0.2, 0, -1.2], Math.PI + 0.2);
      maceta(B, [-1.6, 1.08, -4.12], 0.45); maceta(B, [-0.9, 1.08, -4.12], 0.6, [0.5, 0.52, 0.6]); maceta(B, [2.8, 1.08, -4.12], 0.4);
      B.cil([5.4, 0, -1.6], 0.18, 0.95, 8, { tile: T.liso, col: [0.85, 0.85, 0.9] }, {});
      // el cuartito de azotea, detrás a la izquierda, con su foco pelón que alumbra la azotea
      B.box([-6.0, 0, 4.0], [-2.8, 2.5, 7.0], { tile: T.ladrillo, col: [0.66, 0.5, 0.48], rep: [1.2, 1.2], cell: 1.2 });
      B.quad([-2.79, 0, 5.8], [0, 0, -0.9], [0, 2.0, 0], { tile: T.metal, col: [0.32, 0.3, 0.38] });
      cable(B, [[-2.75, 2.5, 4.6], [-2.6, 2.3, 4.6]], [0.2, 0.2, 0.2]);
      B.box([-2.66, 2.17, 4.54], [-2.54, 2.3, 4.66], { tile: T.liso, col: [1, 0.82, 0.5], emis: 1, glow: 1 });
      // la otra pared: un tubo de luz fría sobre la puerta de servicio
      B.box([-0.5, 0, 6.9], [4.5, 2.6, 7.6], { tile: T.ladrillo, col: [0.6, 0.48, 0.48], rep: [1.2, 1.2], cell: 1.3 });
      B.box([1.4, 2.35, 6.82], [2.6, 2.42, 6.9], { tile: T.liso, col: [0.75, 0.9, 1], emis: 1, glow: 0.7 });
      // el halo de la pantalla en el aire de la noche (del color de lo que enseña) y los haces que suben
      B.seg('luz');
      B.xf(rotY(GIRO), [TX, 0, TZ], () => B.quad([-110, 20, 0.35], [220, 0, 0], [0, 155, 0], { tile: T.humo, uv: [0, 0, 1, 1], col: [2.6, 2.6, 2.6], kind: 5 }));   // (entre la fachada y la pantalla: alumbra alrededor, no encima de la imagen)
      [[-38], [44], [78]].forEach((_, i) => { B.seg('haz' + i, { add: true }); for (const a of [0, Math.PI / 2]) B.xf(rotY(a), [0, 0, 0], () => B.quad([-12, 0, 0], [24, 0, 0], [0, 650, 0], { tile: T.haz, uv: [0, 0, 1, 1], col: [0.14, 0.2, 0.42] })); });
      const hz = [[-60, -360, 0.12], [40, -372, -0.07], [95, -352, 0.2]];
      return {
        luces: [
          { pos: [-2.4, 2.2, 4.3], col: [1.5, 1.0, 0.5], fall: 0.12 },              // el foco pelón del cuartito
          { pos: [2.0, 2.4, 6.2], col: [0.45, 0.6, 0.75], fall: 0.18 },             // el tubo de luz fría en la otra pared
          { pos: [0, -40, -80], col: [0.42, 0.24, 0.16], fall: 0.00004 },           // la ciudad, desde abajo
          { pos: [-200, 300, 300], col: [0.1, 0.1, 0.17], fall: 0 },                // la luna, detrás
        ],
        amb: [0.05, 0.042, 0.08], fog: [0.03, 0.022, 0.05, 160, 900], near: 0.15, far: 2000, estrellas: 0.25,
        scr: { power: 3.8, fall: 0.000012, kind: 1, gain: 1.35 },
        anim: t => {
          const a = {};
          ropa.forEach((r, i) => { a['ropa' + i] = { m: M4(m3(rotZ(0.16 * Math.sin(t * 1.3 + i * 1.7) + 0.05), rotY(0.12 * Math.sin(t * 0.9 + i))), [r.x, 1.9, r.z]) }; });
          hz.forEach(([x, z, k], i) => { a['haz' + i] = { m: M4(m3(rotZ(k + 0.08 * Math.sin(t * 0.21 + i * 2)), rotX(-0.1)), [x, -18, z]), a: 0.85 + 0.15 * Math.sin(t * 0.7 + i) }; });
          return a;
        },
        // planos: desde atrás de la azotea con la torre encima (el de presentación), junto a la ropa
        // mirando arriba, entre los tinacos, uno general, y asomado al pretil
        keys: [
          { eye: [0.2, 1.5, 4.2], look: [8, 80, -300], lookH: [8, 86, -300], fov: 54, fovH: 64 },
          { eye: [1.2, 1.3, 2.4], look: [10, 70, -300], fov: 60, fovH: 70, roll: 4 },
          { eye: [-3.2, 1.0, 1.6], look: [10, 60, -300], lookH: [10, 76, -300], fov: 62, fovH: 70, roll: -3 },
          { eye: [-1.5, 2.2, 6.6], look: [6, 40, -300], lookH: [6, 64, -300], fov: 64, fovH: 74 },
          { eye: [0.4, 1.62, -3.4], look: [8, 100, -300], fov: 46, fovH: 58, roll: 3 },
        ],
        vista: { eye: [0.8, 1.6, -3.2], frac: [0.5, 0.4], mira: [0, 18, 0] },
        medidas: { frente },
      };
    },

    // Un puesto de tacos de noche en la banqueta: lona a rayas, el trompo girando con su brasa, la
    // plancha con su vapor, el foco pelón, salsas, bancos, el refrigerador (sin marca) y encima la tele
    // chiquita, que es la pantalla; el taquero, clientes en silueta, un auto estacionado, calle oscura.
    TAQUERIA(B) {
      const metal = { tile: T.metal, col: [0.6, 0.6, 0.66] }, liso = col => ({ tile: T.liso, col });
      cieloCaja(B, 300, -20, 200, p => mixc([1.4, 0.9, 1.1], [0.35, 0.33, 0.5], clamp(p[1] / 90)));
      // calle, banqueta con guarnición, muro de enfrente con la cortina cerrada, edificios
      B.quad([-40, 0, 30], [80, 0, 0], [0, 0, -30], { tile: T.asfalto, col: [0.55, 0.52, 0.58], rep: [0.6, 0.6], cell: 4 });
      B.quad([-40, 0.15, 0], [80, 0, 0], [0, 0, -5.2], { tile: T.banqueta, col: [0.62, 0.6, 0.66], rep: [0.8, 0.8], cell: 2 });
      B.box([-40, 0, -0.1], [40, 0.15, 0.05], { tile: T.concreto, col: [0.7, 0.68, 0.72], rep: [1, 1] }, { ny: null });
      B.quad([-14, 0.15, -5.2], [28, 0, 0], [0, 6, 0], { tile: T.ladrillo, col: [0.5, 0.42, 0.44], rep: [1.1, 1.1], cell: 2 });
      B.quad([-1.8, 0.15, -5.18], [3.6, 0, 0], [0, 2.6, 0], { tile: T.cortina, col: [0.7, 0.7, 0.76], rep: [1, 2] });
      const vent = { tile: T.ventanas3, rep: [1 / 7, 1 / 7], col: [0.7, 0.66, 0.74], cell: 10, glow: 0.4 };
      B.box([-30, 6, -12], [30, 18, -5.2], vent, { ny: null });
      B.box([-30, 0, 30], [30, 14, 38], vent, { ny: null });
      // poste de luz al fondo, anaranjado
      B.box([7.9, 0.15, -0.5], [8.05, 5.4, -0.35], metal);
      B.box([7.4, 5.3, -0.55], [8.05, 5.4, -0.3], metal);
      B.box([7.3, 5.15, -0.55], [7.65, 5.3, -0.3], { tile: T.liso, col: [1, 0.62, 0.28], emis: 1, glow: 1 });
      // el auto estacionado
      auto(B, [-4.6, 0, 1.6], Math.PI / 2, [0.3, 0.36, 0.5]);
      // el puesto: postes y lona
      for (const [x, z] of [[-2.2, -1.4], [2.6, -1.4], [-2.2, -4.2], [2.6, -4.2]]) B.box([x - 0.03, 0.15, z - 0.03], [x + 0.03, 2.45, z + 0.03], metal, { ny: null });
      B.quad([-2.4, 2.35, -1.2], [0, 0.25, -3.2], [5.2, 0, 0], { tile: T.lona, uv: [0, 0, 3, 5], col: [0.66, 0.62, 0.66], cell: 0.65 });
      B.quad([-2.4, 2.05, -1.2], [5.2, 0, 0], [0, 0.3, 0], { tile: T.lona, uv: [0, 0, 5, 0.4], col: [0.66, 0.62, 0.66], cell: 0.65 });
      // la barra: frente de azulejo, cubierta de acero
      B.box([-1.7, 0.15, -2.6], [1.5, 0.95, -2.2], { tile: T.liso, col: [0.5, 0.5, 0.56] }, { pz: { tile: T.azulejo, rep: [2.4, 2.4], col: [0.95, 0.95, 1] } });
      B.box([-1.75, 0.95, -2.65], [1.55, 0.99, -2.15], metal);
      // la plancha y el comal, tortillas, salsas, platos, cebolla y cilantro
      B.box([0.1, 0.99, -2.6], [1.25, 1.03, -2.25], { tile: T.metal, col: [0.25, 0.25, 0.3] });
      for (const [x, z] of [[0.35, -2.45], [0.62, -2.38], [0.9, -2.47]]) B.cil([x, 1.03, z], 0.09, 0.012, 7, liso([0.92, 0.84, 0.62]));
      [[-1.5, [0.85, 0.15, 0.1]], [-1.38, [0.2, 0.62, 0.25]], [-1.26, [0.92, 0.42, 0.1]], [1.38, [0.85, 0.15, 0.1]]].forEach(([x, c]) => { B.cil([x, 0.99, -2.28], 0.035, 0.18, 6, liso(c)); B.cil([x, 1.17, -2.28], 0.02, 0.04, 6, liso([0.9, 0.9, 0.9])); });
      B.cil([-0.35, 0.99, -2.32], 0.12, 0.06, 8, liso([0.92, 0.92, 0.95]));
      B.box([-0.15, 0.99, -2.42], [0.02, 1.05, -2.28], liso([0.3, 0.75, 0.3])); B.box([-0.15, 0.99, -2.58], [0.02, 1.05, -2.44], liso([0.92, 0.92, 0.95]));
      // atrás: tabla de picar, el trompo con su piña (gira) y la brasa vertical que lo asa
      B.box([-1.6, 0.15, -3.7], [0.7, 0.92, -3.3], { tile: T.liso, col: [0.45, 0.45, 0.5] });
      B.box([-1.3, 0.92, -3.7], [-0.4, 0.96, -3.3], metal);
      // (el trompo va en la esquina de la barra, a la vista de la calle, con su brasa detrás)
      B.box([-1.75, 0.99, -2.62], [-0.95, 1.02, -2.18], metal);
      B.box([-1.38, 1.02, -2.43], [-1.32, 2.15, -2.37], metal);
      B.seg('trompo');
      B.cil([0, 0, 0], 0.26, 0.82, 10, { tile: T.carne, col: [1.15, 1.05, 1] }, { r2: 0.38, urep: 3, vrep: 1.4, tapaMat: { tile: T.carne, col: [0.85, 0.62, 0.5] } });
      B.cil([0, 0.82, 0], 0.13, 0.2, 8, { tile: T.liso, col: [1.0, 0.8, 0.2] }, { r2: 0.11 });
      for (const a of [0, 1.6, 3.2]) B.xf(rotY(a), [0, 1.0, 0], () => B.quad([-0.14, 0, 0], [0.28, 0, 0], [0, 0.24, 0], { tile: T.planta, kind: 3, uv: [0, 0, 1, 1] }));
      B.seg('brasa');
      B.box([-0.45, 0, -0.05], [0.45, 0.98, 0.05], { tile: T.rejilla, col: [1, 0.52, 0.18], emis: 1, glow: 1, uv: [0, 0, 2, 2] }, { pz: { tile: T.rejilla, col: [1, 0.55, 0.2], emis: 1, glow: 1, uv: [0, 0, 3, 3] } });
      B.seg('fijo');
      // los focos pelones colgados de la lona: uno sobre la plancha y otro en la orilla, sobre los bancos
      cable(B, [[0.3, 2.45, -2.6], [0.3, 2.1, -2.6]], [0.15, 0.15, 0.15]);
      B.box([0.25, 1.98, -2.65], [0.35, 2.1, -2.55], { tile: T.liso, col: [1, 0.9, 0.62], emis: 1, glow: 1 });
      cable(B, [[2.45, 2.38, -1.45], [2.45, 2.05, -1.45]], [0.15, 0.15, 0.15]);
      B.box([2.4, 1.93, -1.5], [2.5, 2.05, -1.4], { tile: T.liso, col: [1, 0.9, 0.62], emis: 1, glow: 1 });
      // el refrigerador (blanco, sin marca) y la tele chiquita encima, que es la pantalla
      B.box([0.9, 0.15, -4.2], [1.65, 1.85, -3.45], liso([0.46, 0.47, 0.52]));
      B.box([0.93, 1.2, -3.45], [1.62, 1.22, -3.44], liso([0.3, 0.3, 0.35])); B.box([1.53, 0.6, -3.44], [1.57, 1.1, -3.41], metal);
      B.box([0.8, 1.85, -4.05], [1.76, 2.52, -3.5], liso([0.2, 0.2, 0.25]));
      B.box([0.95, 1.85, -4.2], [1.61, 2.38, -4.05], liso([0.2, 0.2, 0.25]));
      B.screen([0.88, 1.9, -3.495], [0.8, 0, 0], [0, 0.58, 0], { div: [2, 2], bulge: 0.02 });
      cable(B, [[1.45, 2.1, -4.15], [1.63, 1.95, -4.22], [1.7, 0.16, -4.25]], [0.2, 0.2, 0.24]);
      // bancos de plástico
      const banco = liso([0.82, 0.2, 0.18]);
      for (const x of [-0.2, 0.8, 1.8]) { B.cil([x, 0.15, -1.75], 0.15, 0.4, 6, banco, { r2: 0.13, tapa: false }); B.cil([x, 0.55, -1.75], 0.17, 0.04, 6, banco); }
      // el taquero (su brazo derecho pica: pieza) y clientes en silueta (uno se lleva el taco a la boca)
      const taquero = { piel: [0.62, 0.45, 0.36], pelo: [0.1, 0.09, 0.1], camisa: [0.9, 0.9, 0.92], pantalon: [0.2, 0.22, 0.3], zapato: [0.1, 0.1, 0.1] };
      const poseTaq = (k) => ({ pos: [-0.55, 1.05, -2.95], yaw: -0.35, hom: [0.5, 0.75 + 0.15 * k], codo: [0.9, 0.7 - 0.2 * k], abre: [0.15, 0.1] });
      figura(B, poseTaq(0), taquero, { piezas: ['brazoD', 'antebrazoD'], prefijo: 'taq_' });
      const poseCli = (k) => ({ pos: [0.8, 0.72, -1.75], yaw: Math.PI, cad: [1.45, 1.45], rod: [1.5, 1.5], hom: [0.55, 0.5 + 1.0 * k], codo: [0.9, 1.2 + 0.9 * k], lean: -0.12 });
      const cliente = (camisa) => ({ piel: [0.5, 0.36, 0.3], pelo: [0.08, 0.07, 0.09], camisa, pantalon: [0.2, 0.22, 0.32], zapato: [0.1, 0.1, 0.12] });
      figura(B, poseCli(0), cliente([0.3, 0.42, 0.62]), { piezas: ['brazoD', 'antebrazoD'], prefijo: 'cli_' });
      figura(B, { pos: [1.8, 0.72, -1.75], yaw: Math.PI + 0.15, cad: [1.4, 1.45], rod: [1.4, 1.55], hom: [0.6, 0.65], codo: [1.0, 1.1], lean: -0.08 }, cliente([0.62, 0.3, 0.36]));
      figura(B, { pos: [3.4, 1.05, -2.0], yaw: Math.PI + 1.1, hom: [0.1, 0.3], codo: [0.2, 1.4] }, cliente([0.3, 0.5, 0.36]));
      // vapor de la plancha (se suma)
      B.seg('vapor', { add: true });
      for (let k = 0; k < 3; k++) B.quad([-0.18 + k * 0.12, 0, 0], [0.32, 0, 0], [0, 0.4, 0], { tile: T.humo, uv: [0, 0, 1, 1], col: [0.25, 0.22, 0.2] });
      B.seg('fijo');
      const t0 = 0.8;
      return {
        luces: t => [
          { pos: [0.3, 1.9, -2.5], col: [1.7, 1.1, 0.55], fall: 0.8 },                // el foco pelón
          { pos: [-1.5, 1.5, -2.3], col: mulS([1.5, 0.62, 0.18], 0.8 + 0.2 * Math.sin(t * 9) * Math.sin(t * 3.7)), fall: 2.2 },    // la brasa
          { pos: [7.5, 5.0, -0.4], col: [0.6, 0.36, 0.14], fall: 0.03 },             // el poste de la calle
          { pos: [2.45, 1.85, -1.45], col: [1.2, 0.8, 0.42], fall: 0.7 },            // el foco de la orilla
        ],
        amb: [0.03, 0.024, 0.05], fog: [0.025, 0.02, 0.045, 10, 50], near: 0.06, far: 400, estrellas: 0.2,
        scr: { power: 2.6, fall: 2.2, kind: 0, gain: 1.45 },
        anim: t => {
          const a = {};
          a.trompo = { m: M4(rotY(t * 0.9), [-1.35, 1.1, -2.4]) };
          a.brasa = { m: M4(rotY(0.85), [-1.78, 1.04, -2.62]), e: 0.4 * Math.sin(t * 9) * Math.sin(t * 3.7) };
          mueveFigura(a, 'taq_', poseTaq(0.5 + 0.5 * Math.sin(t * 7)), ['brazoD', 'antebrazoD']);
          const bocado = Math.pow(Math.max(0, Math.sin(t * 0.7)), 3);
          mueveFigura(a, 'cli_', poseCli(bocado), ['brazoD', 'antebrazoD']);
          const v = (t * 0.35) % 1;
          a.vapor = { m: M4(ID3, [0.62, 1.05 + v * 0.5, -2.42]), a: Math.sin(v * Math.PI) * 0.9 };
          return a;
        },
        // planos: sentado en la barra viendo la tele del refri (el de presentación), el trompo de cerca,
        // la tele de cerca, uno general desde la calle, y a lo largo de la barra
        keys: [
          { eye: [0.4, 1.55, 0.25], look: [-0.35, 1.6, -3.0], fov: 64, fovH: 50 },
          { eye: [-0.75, 1.3, -1.25], look: [-1.3, 1.6, -2.45], fov: 62, roll: -2 },
          { eye: [1.05, 1.55, -1.85], look: [1.27, 2.0, -3.5], fov: 60 },
          { eye: [-0.9, 1.6, 2.0], look: [0.4, 1.45, -2.8], fov: 62 },
          { eye: [2.0, 1.7, -3.05], look: [-1.3, 1.45, -2.3], fov: 62, roll: 2 },
        ],
        vista: { eye: [0.15, 1.62, -0.7], frac: [0.56, 0.42], mira: [-0.32, -0.28, 0], miraH: [-0.42, -0.2, 0] },
      };
    },

    // El escaparate de una tienda de electrónica, de noche, desde la banqueta mojada: un muro de teles de
    // tubo de varios tamaños, TODAS con la cámara (cada una con su tinte y unos cuadros de retraso),
    // reflejadas en los charcos y en el vidrio; la cortina metálica a medio bajar, un poste de luz, un
    // anuncio de neón con forma de tele (sin letras) y alguien que pasa en silueta.
    ESCAPARATE(B) {
      const liso = col => ({ tile: T.liso, col }), metal = { tile: T.metal, col: [0.5, 0.5, 0.58] };
      // el reflejo: todo lo de arriba, volteado bajo el suelo y estirado hacia abajo, como en el piso
      // mojado (las luces se alargan en rayas verticales)
      const ESP = [1, 0, 0, 0, -1.35, 0, 0, 0, 1];
      cieloCaja(B, 300, -40, 200, p => mixc([1.3, 0.85, 1.0], [0.35, 0.33, 0.5], clamp(p[1] / 80)));
      // suelo: banqueta y calle mojadas de punta a punta: el reflejo se ve por todas partes y encima
      // sólo se suma, tenue, la textura del piso (losas de la banqueta, asfalto); la calle lejos, seca
      B.seg('luz');
      B.quad([-14, 0.004, 0], [28, 0, 0], [0, 0, -4], { tile: T.banqueta, col: [0.16, 0.15, 0.18], rep: [0.8, 0.8], cell: 1.4 });
      B.quad([-14, 0.004, 8], [28, 0, 0], [0, 0, -8], { tile: T.asfalto, col: [0.12, 0.12, 0.15], rep: [0.6, 0.6], cell: 2 });
      B.quad([1.0, 0.006, 2.2], [3.6, 0, 0], [0, 0, -3.8], { tile: T.humo, uv: [0, 0, 1, 1], col: [0.3, 0.17, 0.06] });   // el charco de luz del poste
      B.seg('fijo');
      B.quad([-14, 0, 30], [28, 0, 0], [0, 0, -22], { tile: T.asfalto, col: [0.5, 0.48, 0.55], rep: [0.6, 0.6], cell: 4 });
      B.box([-14, 0, -0.08], [14, 0.06, 0.08], { tile: T.concreto, col: [0.6, 0.58, 0.64] }, { ny: null });
      // la fachada con el hueco del escaparate; la cortina a medio bajar con su caja; el zócalo
      const muro = { tile: T.ladrillo, col: [0.3, 0.26, 0.32], rep: [0.9, 0.9], cell: 1.5 };
      pared(B, 'z', -4, 1, -8, 8, 0, 7.5, muro, [-2.7, 2.7, 0.5, 3.4]);
      const neg = liso([0.05, 0.05, 0.07]);
      // la tienda por dentro: suelo, fondo y techo oscuros, repisas
      B.quad([-2.7, 0.5, -4], [5.4, 0, 0], [0, 0, -2.8], { tile: T.piso, col: [0.4, 0.4, 0.46], rep: [2, 2] });
      B.quad([-2.7, 0, -6.6], [5.4, 0, 0], [0, 3.4, 0], { tile: T.tablero, col: [0.25, 0.24, 0.32], rep: [1.4, 1.4] });
      // el muro de teles: tres filas en repisas (abajo grandes, arriba chicas), todas encendidas
      const tintes = [[1, 1, 1], [1, 0.86, 0.72], [0.76, 0.9, 1.1], [0.84, 1.04, 0.86], [1.04, 0.82, 1.0], [0.92, 0.95, 1]];
      const teles = [];
      [[0.5, 1.0, [1.15, 1.75, 1.15]], [1.58, 0.6, [0.86, 0.92, 0.9, 0.86]], [2.24, 0.46, [0.66, 0.7, 0.72, 0.7, 0.66]]].forEach(([y0, hh, ws], row) => {
        const gap = 0.07, tot = ws.reduce((a, w) => a + w, 0) + gap * (ws.length - 1);
        let x = -tot / 2;
        ws.forEach((w, i) => { teles.push({ x: x + w / 2, y: y0, w, h: hh * (w / Math.max(...ws)) * 0.95, rot: ((row + i) % 3 - 1) * 0.07, k: teles.length }); x += w + gap; });
        B.box([-2.65, y0 - 0.05, -6.2], [2.65, y0, -5.1], { tile: T.madera, col: [0.5, 0.36, 0.3], rep: [2, 2] });
      });
      const tele = (t, refl) => B.xf(rotY(t.rot), [t.x, t.y, -5.55], () => {
        const w = t.w, h = t.h, sw = w * 0.82, sh = Math.min(h * 0.8, sw * 0.75);
        B.box([-w / 2, 0, -0.35], [w / 2, h, 0.05], liso(refl ? [0.12, 0.12, 0.16] : [0.26, 0.25, 0.3]), { ny: null });
        B.box([-w * 0.32, h * 0.12, -0.55], [w * 0.32, h * 0.88, -0.35], liso([0.2, 0.2, 0.24]), { ny: null });
        B.screen([-sw / 2, (h - sh) / 2 + 0.01, 0.055], [sw, 0, 0], [0, sh, 0], { div: [2, 2], bulge: 0.02 }, { retraso: t.k % 6, tinte: refl ? mulS(tintes[t.k % 6], 0.62) : tintes[t.k % 6], registrar: !refl, glow: refl ? 0.5 : 1 });
      });
      teles.forEach(t => tele(t, false));
      // y bajo cada tele, en el piso mojado, su luz corrida en una raya vertical (del color de la imagen)
      B.seg('luz');
      teles.forEach(t => B.xf(rotY(t.rot), [t.x, 0, -5.45], () => B.quad([-t.w * 0.32, -(t.y + t.h) * 2.1, 0], [t.w * 0.64, 0, 0], [0, (t.y + t.h) * 2.1 - t.y * 0.9, 0], { tile: T.humo, uv: [0, 0, 1, 1], col: mulS(tintes[t.k % 6], 3.2), kind: 5 })));
      B.seg('fijo');
      // la «pantalla» de la escena es el muro entero (para su luz y su encuadre)
      B.ponPrincipal([[-2.2, 0.5, -5.5], [2.2, 0.5, -5.5], [2.2, 2.72, -5.5], [-2.2, 2.72, -5.5]], [0, 0, 1]);
      // el tubo de luz de la tienda, arriba al fondo
      B.box([-1.4, 2.93, -5.75], [1.4, 3.0, -5.65], { tile: T.liso, col: [0.8, 0.92, 1.0], emis: 1, glow: 0.8 });
      // el marco de aluminio del escaparate, con su parteluz
      const alu = liso([0.55, 0.56, 0.62]);
      B.box([-2.78, 0.42, -4.02], [2.78, 0.52, -3.9], alu); B.box([-2.78, 0.42, -4.02], [-2.66, 3.4, -3.9], alu); B.box([2.66, 0.42, -4.02], [2.78, 3.4, -3.9], alu);
      // cortina metálica bajada un tercio, con su caja y su chapa
      B.box([-2.8, 3.4, -4.1], [2.8, 3.75, -3.85], metal);
      B.quad([-2.7, 2.78, -3.92], [5.4, 0, 0], [0, 0.62, 0], { tile: T.cortina, col: [0.45, 0.45, 0.52], rep: [1, 1.6], cell: 1.2 });
      B.box([-2.7, 2.75, -3.95], [2.7, 2.81, -3.88], metal); B.box([-0.12, 2.67, -3.94], [0.12, 2.78, -3.89], liso([0.7, 0.62, 0.2]));
      // reflejos en el vidrio (se suman): rayas frías en diagonal y el foco del poste
      B.seg('luz');
      for (const [x, w] of [[-1.9, 0.35], [-0.6, 0.18], [1.2, 0.5]]) B.xf(rotZ(-0.55), [x, 1.2, -3.97], () => B.quad([-w / 2, -1.2, 0], [w, 0, 0], [0, 2.4, 0], { tile: T.humo, uv: [0, 0, 1, 1], col: [0.05, 0.07, 0.1] }));
      B.quad([1.7, 2.3, -3.96], [0.5, 0, 0], [0, 0.5, 0], { tile: T.humo, uv: [0, 0, 1, 1], col: [0.35, 0.22, 0.1] });
      B.seg('fijo');
      // anuncio de neón con forma de tele, sin letras: marco, antenas y una onda
      const neonA = { tile: T.liso, col: [0.3, 0.95, 1], emis: 1, glow: 1 }, neonR = { tile: T.liso, col: [1, 0.3, 0.6], emis: 1, glow: 1 };
      const neon = m => {
        for (const [a, b] of [[[-0.7, 4.3], [0.7, 4.3]], [[-0.7, 5.2], [0.7, 5.2]], [[-0.7, 4.3], [-0.7, 5.2]], [[0.7, 4.3], [0.7, 5.2]]]) B.box([Math.min(a[0], b[0]) - 0.03, Math.min(a[1], b[1]) - 0.03, -3.95], [Math.max(a[0], b[0]) + 0.03, Math.max(a[1], b[1]) + 0.03, -3.9], neonA);
        cable(B, [[-0.1, 5.23, -3.92], [-0.45, 5.65, -3.92]], m); cable(B, [[0.1, 5.23, -3.92], [0.45, 5.65, -3.92]], m);
        cable(B, [[-0.5, 4.75, -3.9], [-0.25, 4.95, -3.9], [0, 4.6, -3.9], [0.25, 4.95, -3.9], [0.5, 4.75, -3.9]], m);
      };
      neon([1, 0.3, 0.6]);
      // el poste de luz en la orilla de la banqueta
      B.box([3.9, 0, 0.2], [4.04, 5.2, 0.34], metal, { ny: null });
      B.box([2.8, 5.1, 0.2], [4.04, 5.2, 0.34], metal);
      B.box([2.7, 4.95, 0.15], [3.15, 5.1, 0.4], { tile: T.liso, col: [1, 0.64, 0.3], emis: 1, glow: 1 });
      // el reflejo en los charcos: lo mismo, volteado
      B.xf(ESP, [0, 0, 0], () => {
        teles.forEach(t => tele(t, true));
        pared(B, 'z', -4, 1, -8, 8, 0, 7.5, { ...muro, col: [0.14, 0.12, 0.16], cell: 3 }, [-2.7, 2.7, 0.5, 3.4]);
        B.quad([-2.7, 2.78, -3.92], [5.4, 0, 0], [0, 0.62, 0], { tile: T.cortina, col: [0.3, 0.3, 0.36], rep: [1, 1.6], cell: 1.6 });
        B.box([-1.4, 2.93, -5.75], [1.4, 3.0, -5.65], { tile: T.liso, col: [0.5, 0.58, 0.64], emis: 1, glow: 0.5 });
        B.box([2.7, 4.95, 0.15], [3.15, 5.1, 0.4], { tile: T.liso, col: [0.7, 0.45, 0.2], emis: 1, glow: 0.5 });
        B.box([3.9, 0, 0.2], [4.04, 5.2, 0.34], { tile: T.metal, col: [0.25, 0.25, 0.3] });
        neon([0.6, 0.18, 0.36]);
      });
      // alguien que pasa por la banqueta (y su reflejo en los charcos), cada veinte segundos
      figura(B, { pos: [0, 0.95, -1.6] }, { ...SILUETA, camisa: [0.16, 0.16, 0.22] }, { piezas: true, prefijo: 'pea_' });
      const ciclo = 20;
      return {
        luces: [
          { pos: [2.9, 4.8, 0.3], col: [1.0, 0.6, 0.25], fall: 0.07 },              // el poste
          { pos: [0, 4.8, -3.6], col: [0.25, 0.55, 0.65], fall: 0.6 },              // el neón
          { pos: [0, 2.85, -5.0], col: [0.3, 0.34, 0.42], fall: 0.5 },              // el tubo de la tienda
        ],
        amb: [0.02, 0.018, 0.04], fog: [0.02, 0.018, 0.04, 9, 60], near: 0.08, far: 600, estrellas: 0.2,
        scr: { power: 3.4, fall: 0.35, kind: 0, gain: 1.8 },
        anim: t => {
          const a = {}, f = (t % ciclo) / 9, x = -9 + f * 18, paso = Math.sin(t * 5.2);
          if (f > 1) { for (const k of PARTES) a['pea_' + k] = { off: true }; return a; }
          const E = esqueleto({ pos: [x, 0.95 + Math.abs(paso) * 0.03, -1.7], yaw: Math.PI / 2, cad: [0.45 * paso, -0.45 * paso], rod: [0.4 * Math.max(0, -paso), 0.4 * Math.max(0, paso)], hom: [-0.35 * paso, 0.35 * paso], codo: [0.25, 0.25] });
          for (const k of PARTES) a['pea_' + k] = { m: [M4(E[k].R, E[k].t), M4(m3(ESP, E[k].R), m3v(ESP, E[k].t))] };
          return a;
        },
        // planos: desde la orilla de la banqueta (el de presentación), al ras de un charco, pegado al
        // vidrio, uno general desde la otra acera, y desde el otro lado
        keys: [
          { eye: [0.35, 1.25, 0.35], look: [0, 1.4, -5.6], fov: 62 },
          { eye: [-1.0, 0.42, 0.9], look: [0.2, 1.05, -5.5], fov: 64, roll: -2 },
          { eye: [2.1, 1.5, -2.4], look: [-0.4, 1.35, -5.6], fov: 62 },
          { eye: [-2.2, 1.7, 5.5], look: [0.3, 2.2, -4.0], fov: 60 },
          { eye: [-2.3, 1.4, -1.6], look: [0.5, 1.3, -5.6], fov: 62, roll: 2 },
        ],
        vista: { eye: [0.15, 1.3, -0.6], frac: [0.82, 0.8] },
      };
    },

    // Dentro de un autobús articulado de noche, desde un asiento: la tele colgada del techo al frente es
    // la pantalla. Asientos, tubos y pasamanos con correas que se mecen, el fuelle de la articulación,
    // pasajeros en silueta; por las ventanas pasan las luces de la avenida (la calle se mueve de verdad:
    // paralaje) y el camino mece el cuadro.
    AUTOBUS(B) {
      const liso = col => ({ tile: T.liso, col }), amarillo = liso([0.85, 0.72, 0.2]), gris = liso([0.5, 0.52, 0.6]);
      const X = 1.25, Y = 2.3, Z0 = -6.2, Z1 = 6.5;
      cieloCaja(B, 400, -40, 200, p => mixc([1.5, 0.95, 1.05], [0.35, 0.33, 0.5], clamp(p[1] / 70)));
      // el casco: piso de hule, techo, paredes bajo y sobre la franja de ventanas (huecos entre parantes)
      B.quad([-X, 0, Z1], [2 * X, 0, 0], [0, 0, Z0 - Z1], { tile: T.piso, col: [0.55, 0.55, 0.62], rep: [1.6, 1.6], cell: 1.2 });
      B.quad([-X, Y, Z0], [2 * X, 0, 0], [0, 0, Z1 - Z0], { tile: T.liso, col: [0.4, 0.42, 0.5], cell: 2 });
      const panel = { tile: T.liso, col: [0.32, 0.34, 0.46], cell: 2.2 }, panelAlto = { tile: T.liso, col: [0.45, 0.46, 0.56], cell: 2.2 };
      for (const [x, cara] of [[-X, 1], [X, -1]]) { pared(B, 'x', x, cara, Z0, Z1, 0, 0.95, panel); pared(B, 'x', x, cara, Z0, Z1, 1.95, Y, panelAlto); }
      pared(B, 'z', Z1, -1, -X, X, 0, Y, panel);
      for (let z = Z0; z <= Z1 + 0.01; z += 1.27) for (const x of [-X, X]) B.box([x - 0.04, 0.95, z - 0.05], [x + 0.04, 1.95, z + 0.05], gris, { ny: null, py: null, [x < 0 ? 'nx' : 'px']: null });
      for (const x of [-X, X]) { B.box([x - 0.06, 0.93, Z0], [x + 0.06, 0.99, Z1], gris); B.box([x - 0.05, 1.92, Z0], [x + 0.05, 1.98, Z1], gris); }
      // los tubos fluorescentes del techo, fríos y encendidos (uno parpadea): carcasa y difusor
      const tubo = { tile: T.liso, col: [0.82, 0.93, 1.0], emis: 1, glow: 0.9 }, carcasa = liso([0.3, 0.32, 0.38]);
      let malo = null;
      for (const x of [-0.72, 0.72]) for (let z = Z0 + 0.9; z < Z1 - 0.5; z += 2.2) {
        B.box([x - 0.09, Y - 0.05, z], [x + 0.09, Y, z + 1.3], carcasa, { py: null });
        if (!malo && x > 0 && z > 0) { malo = [x, z]; continue; }
        B.box([x - 0.06, Y - 0.075, z + 0.05], [x + 0.06, Y - 0.05, z + 1.25], tubo, { py: null });
      }
      B.seg('tuboMalo'); B.box([malo[0] - 0.06, Y - 0.075, malo[1] + 0.05], [malo[0] + 0.06, Y - 0.05, malo[1] + 1.25], tubo, { py: null }); B.seg('fijo');
      // asientos de plástico amarillo hacia el frente, con su armazón; tubos amarillos y pasamanos con correas
      const plastico = liso([1.15, 0.88, 0.2]), armazon = liso([0.25, 0.25, 0.3]);
      for (let z = -4.46; z < 5.8; z += 0.86) for (const [x0, x1] of [[-1.17, -0.27], [0.27, 1.17]]) {
        if (z > 1.5 && z < 3.0 && x0 > 0) continue;                       // (la zona de la puerta)
        B.box([x0, 0.42, z], [x1, 0.5, z + 0.46], plastico, { ny: null, nz: null });
        B.box([x0, 0.5, z + 0.42], [x1, 0.98, z + 0.5], plastico, { ny: null });
        B.box([x0 + 0.05, 0.98, z + 0.4], [x1 - 0.05, 1.03, z + 0.52], amarillo);
        B.box([(x0 + x1) / 2 - 0.03, 0, z + 0.2], [(x0 + x1) / 2 + 0.03, 0.42, z + 0.26], armazon, { ny: null, py: null });
      }
      for (let z = -3.2; z < 5.8; z += 1.72) for (const x of [-0.3, 0.3]) B.box([x - 0.025, 0, z - 0.025], [x + 0.025, Y, z + 0.025], amarillo, { ny: null, py: null });
      for (const x of [-0.48, 0.48]) B.box([x - 0.02, 2.0, Z0 + 0.3], [x + 0.02, 2.04, Z1 - 0.3], amarillo);
      const correas = [];
      for (let z = -3.0; z < 5.5; z += 1.1) for (const x of [-0.48, 0.48]) correas.push([x, z]);
      correas.forEach((c, i) => { B.seg('correa' + i); B.box([-0.012, -0.28, -0.012], [0.012, 0, 0.012], liso([0.2, 0.2, 0.24]), { ny: null }); B.box([-0.06, -0.38, -0.012], [0.06, -0.28, 0.012], liso([0.3, 0.3, 0.36])); });
      B.seg('fijo');
      // la articulación: el fuelle y el plato; del otro lado, el tramo de adelante en penumbra
      B.box([-X, 0, Z0 - 1.0], [X, Y, Z0], { tile: T.rayada, col: [0.22, 0.2, 0.26], rep: [3, 1] }, { pz: null, nz: null });
      B.cil([0, 0.01, Z0 - 0.5], 1.0, 0.02, 10, { tile: T.metal, col: [0.5, 0.5, 0.56] });
      B.quad([-X, 0, Z0 - 1.0], [2 * X, 0, 0], [0, 0, -9], { tile: T.piso, col: [0.4, 0.4, 0.46], rep: [1.6, 1.6], cell: 1.5 });
      B.quad([-X, Y, Z0 - 10], [2 * X, 0, 0], [0, 0, 9], liso([0.4, 0.42, 0.5]));
      for (const x of [-X, X]) { const c = x < 0 ? 1 : -1; pared(B, 'x', x, c, Z0 - 10, Z0 - 1, 0, 0.95, panel); pared(B, 'x', x, c, Z0 - 10, Z0 - 1, 1.95, Y, panelAlto); }
      for (let z = Z0 - 2.2; z > Z0 - 9.5; z -= 1.3) for (const [x0, x1] of [[-1.17, -0.27], [0.27, 1.17]]) B.box([x0, 0.42, z], [x1, 1.0, z + 0.5], liso([1.0, 0.78, 0.18]), { ny: null });
      B.box([-X, 1.95, Z0 - 10.2], [X, Y, Z0 - 10], panelAlto); B.box([-X, 0, Z0 - 10.2], [X, 0.95, Z0 - 10], panel);
      // la tele colgada del techo al frente de este tramo, mirando a los asientos (pantalla plana)
      B.box([-0.03, 2.05, Z0 + 0.55], [0.03, Y, Z0 + 0.61], gris);
      B.box([-0.6, 1.38, Z0 + 0.5], [0.6, 2.08, Z0 + 0.62], liso([0.12, 0.12, 0.15]));
      B.screen([-0.55, 1.42, Z0 + 0.625], [1.1, 0, 0], [0, 0.62, 0], {});
      // pasajeros en silueta: sentados y uno de pie agarrado del tubo
      const sil = (c) => ({ ...SILUETA, camisa: c });
      figura(B, { pos: [-0.72, 0.62, -1.9], yaw: Math.PI, cad: [1.5, 1.45], rod: [1.5, 1.45], hom: [0.4, 0.3], codo: [1.0, 1.1], lean: -0.1, cabeza: 0.15 }, sil([0.2, 0.22, 0.32]));
      figura(B, { pos: [0.95, 0.62, -0.5], yaw: Math.PI, cad: [1.5, 1.5], rod: [1.5, 1.5], hom: [0.35, 0.2], codo: [1.2, 0.9], lean: -0.05, cabeza: 0.35 }, sil([0.32, 0.18, 0.22]));
      figura(B, { pos: [-0.72, 0.62, 2.4], yaw: Math.PI, cad: [1.5, 1.5], rod: [1.5, 1.5], hom: [0.3, 0.3], codo: [1.0, 1.0], lean: -0.15 }, sil([0.18, 0.26, 0.24]));
      figura(B, { pos: [0.05, 0.95, 0.9], yaw: Math.PI + 0.4, hom: [0.1, 2.9], codo: [0.2, 0.25], abre: [0.1, 0.05] }, sil([0.26, 0.24, 0.3]));
      // la avenida que pasa (se mueve): faroles anaranjados, fachadas con ventanas y aparadores, autos
      const L = 40;
      B.seg('calle');
      B.quad([-14, -0.35, L], [28, 0, 0], [0, 0, -L], { tile: T.asfalto, col: [0.5, 0.48, 0.55], rep: [0.5, 0.5], cell: 5 });
      for (const sx of [-1, 1]) {
        for (let z = 2; z < L; z += 10) { const x = sx * 4.4; B.box([x - 0.08, -0.35, z - 0.08], [x + 0.08, 5.0, z + 0.08], gris, { ny: null }); B.box([x - sx * 0.9, 4.9, z - 0.15], [x + sx * 0.1, 5.05, z + 0.15], { tile: T.liso, col: [1, 0.62, 0.26], emis: 1, glow: 1 }); }
        B.quad(sx < 0 ? [-9, -0.35, 0] : [9, -0.35, L], [0, 0, sx < 0 ? L : -L], [0, 12, 0], { tile: T.ventanas3, rep: [1 / 7, 1 / 7], col: [0.75, 0.72, 0.8], cell: 8, glow: 0.4 });
        for (let z = 5; z < L; z += 13) B.quad(sx < 0 ? [-8.95, -0.35, z] : [8.95, -0.35, z + 4], [0, 0, sx < 0 ? 4 : -4], [0, 2.4, 0], { tile: T.liso, col: [1, 0.92, 0.75], emis: 0.85, glow: 0.8 });
      }
      B.seg('autos');
      auto(B, [-3.2, -0.35, 0], 0, [0.4, 0.38, 0.5], true);
      auto(B, [-3.2, -0.35, 17], 0, [0.55, 0.2, 0.2], true);
      B.seg('fijo');
      return {
        luces: t => {
          const zf = ((t * 11) % 10);                                                   // el farol más cercano pasa cada 0,9 s
          const near = 1 - Math.min(1, Math.abs(zf - 5) / 5);
          return [
            { pos: [0, 2.1, -3.3], col: [1.0, 1.1, 1.3], fall: 0.12 },                 // los tubos del techo
            { pos: [0.4, 2.1, 1.6], col: mulS([1.15, 1.25, 1.45], 0.35 + 0.65 * parpadeo(t)), fall: 0.1 },  // (con el que parpadea)
            { pos: [4.0, 4.8, (zf - 5) * 1.6], col: mulS([1, 0.6, 0.25], 0.55 * near * near), fall: 0.05 },   // el farol que pasa
            { pos: [-4.0, 4.8, (5 - zf) * 1.6 + 2], col: mulS([1, 0.6, 0.25], 0.35 * near), fall: 0.05 },
          ];
        },
        amb: [0.055, 0.055, 0.08], fog: [0.03, 0.025, 0.05, 12, 70], near: 0.05, far: 900, estrellas: 0.25,
        scr: { power: 2.6, fall: 0.45, kind: 2, gain: 1.45 },
        vaiven: t => ({ d: [0.018 * Math.sin(t * 1.3) + 0.008 * Math.sin(t * 3.7), 0.012 * Math.sin(t * 2.3), 0], r: 0.012 * Math.sin(t * 0.9) + 0.005 * Math.sin(t * 2.7) }),
        anim: t => {
          const a = {}, off = (t * 11) % L, off2 = (t * 25) % (2 * L);
          a.tuboMalo = parpadeo(t) > 0.5 ? {} : { off: true };
          a.calle = { m: [-2, -1, 0, 1].map(k => M4(ID3, [0, 0, off + k * L])) };
          a.autos = { m: [-1, 0, 1].map(k => M4(ID3, [0, 0, off2 + k * 2 * L - L])) };
          correas.forEach(([x, z], i) => { a['correa' + i] = { m: M4(m3(rotX(0.12 * Math.sin(t * 1.3 + i * 0.7) + 0.06 * Math.sin(t * 3.1)), rotZ(0.08 * Math.sin(t * 0.9 + i))), [x, 2.0, z]) }; });
          return a;
        },
        // planos: sentado en la segunda fila con la tele adelante (el de presentación), mirando por la
        // ventana, de pie en el pasillo cerca de la tele, uno general desde atrás, y desde el otro lado
        keys: [
          { eye: [0.72, 1.3, -2.6], look: [0.0, 2.05, -5.6], fov: 64 },
          { eye: [0.72, 1.3, -2.6], look: [4.0, 1.35, -3.9], fov: 66 },
          { eye: [0.05, 1.6, -3.5], look: [0, 1.85, -5.6], fov: 62, roll: 2 },
          { eye: [0.3, 1.62, 5.2], look: [0, 1.5, -6], fov: 64 },
          { eye: [-0.72, 1.24, -1.95], look: [0.1, 1.82, -5.6], fov: 64, roll: -2 },
        ],
        vista: { eye: [0.0, 1.5, -2.25], frac: [0.6, 0.5], mira: [0, -0.22, 0], miraH: [0, 0, 0] },
      };
    },

    // Un autocinema de noche. La cámara está FIJA, casi al ras del suelo, detrás de un convertible
    // descapotado; la película (la cámara del usuario) va en la pantalla grande. Lo que se mueve es una
    // persona: llega caminando de la dulcería, se sienta en la orilla del cofre, sube las piernas, se
    // recuesta contra el parabrisas con un café (su vapor) en una mano y un cigarro en la otra (la brasa
    // se aviva al fumar, sube un hilo de humo, suelta la bocanada) y se queda viendo la película; al
    // rato se baja, va por otro café y vuelve. Alrededor: autos en fila, postes de bocina, la dulcería con
    // su luz, el haz del proyector, árboles y estrellas.
    AUTOCINEMA(B) {
      const liso = col => ({ tile: T.liso, col }), metal = { tile: T.metal, col: [0.5, 0.5, 0.56] };
      cieloCaja(B, 400, -20, 220, p => mixc([1.9, 1.3, 2.1], [0.36, 0.36, 0.6], clamp(p[1] / 70)));
      // la grava: fina cerca (para que la lámpara deje su charco de luz), gruesa lejos y un poco más abajo
      B.quad([-14, 0, 9], [28, 0, 0], [0, 0, -24], { tile: T.grava, col: [0.6, 0.57, 0.62], rep: [0.5, 0.5], cell: 3.5 });
      B.quad([-60, -0.06, 60], [120, 0, 0], [0, 0, -130], { tile: T.grava, col: [0.6, 0.57, 0.62], rep: [0.5, 0.5], cell: 16 });
      // La cámara (fija) y lo que mira: a 30 cm del suelo, delante y a la izquierda de nuestro auto, en
      // diagonal hacia la persona. El autocinema tiene dos pantallas: nuestra fila ve la del sur (detrás
      // de la cámara: su luz, del color de la película, le da de frente a la persona) y otra, al fondo y
      // en ángulo, pasa la misma película: es la que se ve en el cuadro, detrás de la persona, recortándola
      const CAM = CINE.cam, PER = [0, 1.15, 1.2];
      const dx = PER[0] - CAM[0], dz = PER[2] - CAM[2], dl = Math.hypot(dx, dz), D = [dx / dl, 0, dz / dl];
      const enVista = (giro, dist) => { const c = Math.cos(giro), s2 = Math.sin(giro); return [CAM[0] + (D[0] * c - D[2] * s2) * dist, 0, CAM[2] + (D[0] * s2 + D[2] * c) * dist]; };
      const SW = CINE.sw, SH = SW * 9 / 16, SY = CINE.sy, SC = enVista(CINE.desvio, CINE.dist), giroP = Math.atan2(-D[0], -D[2]);
      B.xf(rotY(giroP), SC, () => {
        B.box([-SW / 2 - 0.6, SY - 0.6, -0.5], [SW / 2 + 0.6, SY + SH + 0.6, -0.05], liso([0.62, 0.62, 0.66]));
        for (let k = 0; k <= 6; k++) { const x = -SW / 2 + k * SW / 6; B.box([x - 0.25, 0, -2.6], [x + 0.25, SY + SH, -2.1], metal, { ny: null }); }
        B.box([-SW / 2, SY + SH * 0.5, -2.5], [SW / 2, SY + SH * 0.5 + 0.3, -2.2], metal);
        B.screen([-SW / 2, SY, 0], [SW, 0, 0], [0, SH, 0], { div: [6, 4] });
        // árboles en el horizonte, detrás de la pantalla
        for (let k = 0; k < 18; k++) { const x = -80 + k * 9.5 + (k % 3) * 2, z = -14 - (k % 4) * 3, h = 7 + (k * 7 % 5); B.cil([x, 0, z], 2.6 + (k % 2), h, 5, liso([0.05, 0.09, 0.08]), { r2: 0, tapa: false }); }
      });
      // la dulcería, a media distancia a la izquierda del cuadro: muro claro, ventanilla encendida, toldo, letrero de neón
      const DC = enVista(-0.46, 19), giroD = Math.atan2(CAM[0] - DC[0], CAM[2] - DC[2]);
      B.xf(rotY(giroD), DC, () => {
        B.box([-1.8, 0, -2.8], [1.8, 2.7, 0], liso([0.6, 0.55, 0.5]));
        B.quad([-0.9, 0.95, 0.01], [1.8, 0, 0], [0, 1.0, 0], { tile: T.liso, col: [1, 0.86, 0.6], emis: 1, glow: 0.9 });
        B.quad4([-1.1, 2.05, 0.01], [1.1, 2.05, 0.01], [1.1, 1.75, 0.8], [-1.1, 1.75, 0.8], { tile: T.lona, uv: [0, 0, 3, 1], col: [0.9, 0.9, 1] });
        B.box([-1.9, 2.7, -2.9], [1.9, 2.85, 0.1], liso([0.5, 0.2, 0.22]));
        B.box([-0.7, 3.2, -1.2], [0.7, 3.65, -0.9], { tile: T.liso, col: [1, 0.4, 0.45], emis: 0.9, glow: 1 });
        B.box([-0.05, 2.85, -1.1], [0.05, 3.2, -1.0], metal, { ny: null });
      });
      // otros autos, en filas como la nuestra (miran al sur: se les ven las calaveras rojas) y postes de bocina
      const colores = [[0.5, 0.2, 0.2], [0.25, 0.35, 0.5], [0.6, 0.55, 0.42], [0.3, 0.45, 0.35], [0.55, 0.55, 0.6], [0.45, 0.3, 0.5]];
      [[5.8, 0], [-6, -1], [-3, -10], [3, -10], [9, -10], [15, -10], [-2, -20], [6, -20], [12, -20], [19, -20]].forEach(([x, z], i) => auto(B, [x, 0, z], Math.PI + (i % 3 - 1) * 0.05, colores[i % colores.length], z < -12));
      for (const [x, z] of [[2.9, 1.5], [8.6, 1.5], [-2.9, -8.5], [2.9, -8.5], [8.6, -8.5], [14.4, -8.5]]) { B.box([x - 0.04, 0, z - 0.04], [x + 0.04, 1.25, z + 0.04], metal, { ny: null }); B.box([x - 0.12, 1.0, z - 0.04], [x + 0.12, 1.25, z + 0.16], liso([0.12, 0.12, 0.14])); }
      // la lámpara del estacionamiento, fuera de cuadro a la izquierda: modela el auto y a la persona
      B.box([-3.05, 0, 0.95], [-2.95, 5.6, 1.05], metal, { ny: null }); B.box([-3.3, 5.5, 0.85], [-2.7, 5.65, 1.15], { tile: T.liso, col: [1, 0.78, 0.5], emis: 1, glow: 0.8 });
      // la luna, alta sobre la pantalla del fondo
      { const LC = add(enVista(0.1, 75), [0, 40, 0]), u = [-D[2], 0, D[0]], v = [0, 1, 0], r = 2.4;
        for (let k = 0; k < 10; k++) { const a0 = k / 10 * TAU, a1 = (k + 1) / 10 * TAU, P = a => add(LC, add(mulS(u, Math.cos(a) * r), mulS(v, Math.sin(a) * r))); B.tri(LC, P(a1), P(a0), { tile: T.liso, col: [1, 0.95, 0.82], emis: 1, glow: 1 }); } }
      // NUESTRO auto, de frente a la cámara (mira al sur): defensa, moldura y parrilla cromadas, faros redondos
      const cromo = liso([0.5, 0.52, 0.58]);
      auto(B, [0, 0, 0], Math.PI, [0.86, 0.8, 0.68], false, true);
      for (const x of [-0.885, 0.885]) B.box([x - 0.01, 0.6, -2.05], [x + 0.01, 0.64, 2.05], cromo, { ny: null, py: null });
      B.box([-0.92, 0.22, 2.08], [0.92, 0.38, 2.22], cromo);
      B.quad([-0.42, 0.44, 2.105], [0.84, 0, 0], [0, 0.3, 0], { tile: T.rejilla, uv: [0, 0, 3, 1.2], col: [0.85, 0.85, 0.92] });
      for (const x of [-0.64, 0.64]) B.xf(rotX(Math.PI / 2), [x, 0.62, 2.1], () => { B.cil([0, 0, 0], 0.11, 0.04, 8, cromo); B.cil([0, 0, 0], 0.08, 0.055, 8, { tile: T.liso, col: [1, 0.95, 0.78], emis: 0.5, glow: 0.7 }); });
      // la persona (todas sus partes, piezas), su café, su cigarro con la brasa, el vapor, el humo
      const ropa = { piel: [0.72, 0.52, 0.4], pelo: [0.12, 0.08, 0.06], camisa: [0.78, 0.26, 0.26], manga: [0.78, 0.26, 0.26], pantalon: [0.42, 0.52, 0.74], zapato: [0.92, 0.92, 0.94] };
      figura(B, { pos: [0, 0.95, 0] }, ropa, { piezas: true, prefijo: 'per_' });
      B.seg('per_taza'); B.cil([0, -0.05, 0], 0.05, 0.13, 6, liso([0.95, 0.95, 0.98])); B.cil([0, 0.08, 0], 0.052, 0.012, 6, liso([0.3, 0.2, 0.15]));
      B.seg('per_cig'); B.box([-0.008, -0.09, -0.008], [0.008, 0, 0.008], liso([0.95, 0.93, 0.88])); B.box([-0.011, -0.11, -0.011], [0.011, -0.09, 0.011], { tile: T.liso, col: [1, 0.42, 0.12], emis: 0.65, glow: 1 });
      const nube = (w, h, col) => B.quad([-w / 2, 0, 0], [w, 0, 0], [0, h, 0], { tile: T.humo, uv: [0, 0, 1, 1], col });
      B.seg('per_vapor', { add: true }); nube(0.14, 0.24, [0.26, 0.26, 0.28]); B.xf(ID3, [0.03, 0.12, 0], () => nube(0.12, 0.22, [0.2, 0.2, 0.22]));
      B.seg('per_humo', { add: true }); for (let k = 0; k < 6; k++) B.xf(ID3, [Math.sin(k * 1.7) * 0.03 - k * 0.09, k * 0.11, 0], () => nube(0.07 + k * 0.035, 0.15, [0.2, 0.2, 0.22]));
      B.seg('per_boca', { add: true }); nube(0.4, 0.34, [0.24, 0.24, 0.26]);
      B.seg('fijo');
      // la coreografía: posturas clave (cadera, giro, inclinación, piernas), mezcladas suave
      const cerca = (a, b, k) => a + (b - a) * smooth(clamp(k));
      const mezcla = (A, Bp, k) => { const o = {}; for (const key of Object.keys(A)) o[key] = Array.isArray(A[key]) ? A[key].map((v, i) => cerca(v, Bp[key][i], k)) : cerca(A[key], Bp[key], k); return o; };
      const pose = (pos, yaw, lean, cad, rod) => ({ pos, yaw, lean, cad, rod, hom: [0.12, 0.12], codo: [0.15, 0.15], abre: [0.08, 0.08], cabeza: 0, cierra: [0, 0] });
      // acostada en el cofre, recargada en el parabrisas, viendo la película (al sur); una pierna cruzada
      const REC0 = { ...pose([-0.28, 0.95, 1.12], 0, 1.0, [1.3, 1.38], [0.45, 0.3]), cabeza: 0.75, hom: [0.3, 0.5], codo: [1.7, 1.1], abre: [0.3, 0.15] };
      const REC = { ...REC0, cad: [2.2, 1.5], rod: [1.3, 0.1], cierra: [0, 0.25] };
      const SENT = pose([-0.28, 0.95, 1.25], 0, 0.1, [1.35, 1.35], [0.5, 0.4]);
      const ORILLA = pose([-0.74, 0.95, 1.7], -Math.PI / 2, 0.08, [1.5, 1.5], [1.4, 1.4]);
      const PIE = pose([-1.32, 0.95, 1.7], -Math.PI / 2, 0, [0, 0], [0, 0]);
      const PIE_E = pose([-1.32, 0.95, 1.5], Math.PI / 2, 0.05, [0, 0], [0, 0]);
      const FUERA = [-3.5, 0.95, -6], TAZA = [-0.62, 0.875, 1.25];
      const camina = (from, to, k, t) => {
        const p = from.map((v, i) => v + (to[i] - v) * k), paso = Math.sin(t * 5.4), yaw = Math.atan2(to[0] - from[0], to[2] - from[2]);
        return { ...pose([p[0], 0.95 + Math.abs(paso) * 0.03, p[2]], yaw, 0.04, [0.45 * paso, -0.45 * paso], [0.4 * Math.max(0, -paso), 0.4 * Math.max(0, paso)]), hom: [-0.35 * paso, 0.35 * paso], codo: [0.3, 0.3] };
      };
      const pulso = (x, a, d) => { const u = (x - a) / d; return u <= 0 || u >= 1 ? 0 : Math.sin(u * Math.PI); };
      // en qué está la persona según la fase (un minuto con el giro de fábrica): acostada casi todo el
      // tiempo; al final del ciclo se va, vuelve con su café, lo deja en el cofre, se sube, se acomoda,
      // cruza la pierna y toma el café. Devuelve [postura, nombre, ¿café en la mano?]
      function persona(f, t) {
        if (f < 0.62) return [REC, 'acostada', true];
        if (f < 0.65) return [mezcla(REC, SENT, (f - 0.62) / 0.03), 'se levanta', true];
        if (f < 0.68) return [mezcla(SENT, ORILLA, (f - 0.65) / 0.03), 'se baja', true];
        if (f < 0.70) return [mezcla(ORILLA, PIE, (f - 0.68) / 0.02), 'se baja', true];
        if (f < 0.77) return [camina(PIE.pos, FUERA, (f - 0.70) / 0.07, t), 'se va', true];
        if (f < 0.81) return [null, 'fuera', true];
        if (f < 0.89) return [camina(FUERA, PIE_E.pos, (f - 0.81) / 0.08, t), 'caminando', true];
        if (f < 0.905) { const k = pulso(f, 0.89, 0.015); return [{ ...PIE_E, lean: 0.25 * k, hom: [0.12, 0.12 + 1.15 * k], codo: [0.15, 0.15 + 0.1 * k] }, 'deja el café', f < 0.898]; }
        if (f < 0.915) return [mezcla(PIE_E, PIE, (f - 0.905) / 0.01), 'se voltea', false];
        if (f < 0.935) return [mezcla(PIE, ORILLA, (f - 0.915) / 0.02), 'se sube', false];
        if (f < 0.955) return [mezcla(ORILLA, SENT, (f - 0.935) / 0.02), 'se sube', false];
        if (f < 0.975) return [mezcla(SENT, REC0, (f - 0.955) / 0.02), 'se recuesta', false];
        const k = clamp((f - 0.975) / 0.02), alcanza = pulso(f, 0.977, 0.02);
        const P = mezcla(REC0, REC, k);
        return [{ ...P, hom: [P.hom[0], P.hom[1] + 0.7 * alcanza], codo: [P.codo[0], P.codo[1] - 1.0 * alcanza], abre: [P.abre[0], P.abre[1] - 0.6 * alcanza] }, 'toma el café', f > 0.987];
      }
      const haciaCamara = rotY(-1.11);
      let brasa = [0.3, 1.3, 1.0], fumando = 0;
      return {
        luces: () => [
          { pos: [-3, 5.4, 1], col: [1.2, 0.88, 0.55], fall: 0.02 },                 // la lámpara del estacionamiento
          { pos: brasa, col: mulS([1, 0.42, 0.12], 0.14 + 0.4 * fumando), fall: 9 },  // la brasa del cigarro, que se aviva al fumar
          { pos: add(SC, [-D[0] * 6, SY + SH * 0.5, -D[2] * 6]), col: [0.5, 0.52, 0.66], fall: 0.0005 }, // la pantalla del fondo, que la recorta
          { pos: add(DC, [0, 2.2, 0]), col: [0.8, 0.4, 0.45], fall: 0.02 },        // el neón y la ventanilla de la dulcería
        ],
        // la luz de la película viene de la pantalla del sur, detrás de la cámara
        luzDe: { center: [0, SY + SH / 2, 46], normal: [0, 0, -1], width: SW },
        amb: [0.06, 0.056, 0.095], fog: [0.02, 0.02, 0.045, 35, 160], near: 0.05, far: 900,
        scr: { power: 4.4, fall: 0.0004, kind: 2, gain: 1.3 },
        ciclo: 60,
        anim: (t, A) => {
          const a = {};
          let [P, postura, enMano] = persona(A.fase, t);
          if (A.b > 0) { P = P ? mezcla(P, REC, A.b) : REC; if (A.b > 0.99) { postura = 'acostada'; enMano = true; } }
          if (!P) { for (const k of [...PARTES, 'cig', 'vapor', 'humo', 'boca']) a['per_' + k] = { off: true }; a.per_taza = { m: M4(ID3, TAZA) }; fumando = 0; a._persona = { postura, puntos: [FUERA] }; return a; }
          // acostada: respira, y de vez en cuando da un trago o una fumada
          const quieta = postura === 'acostada';
          const trago = quieta ? pulso(t % 13, 6, 2.4) : 0, fumada = quieta ? pulso(t % 17, 10, 2.6) : 0;
          P = { ...P, lean: P.lean + (quieta ? 0.02 * Math.sin(t * 1.7) : 0), hom: [P.hom[0] + 0.5 * fumada, P.hom[1] + 0.75 * trago], codo: [P.codo[0] + 0.6 * fumada, P.codo[1] + 0.75 * trago], cabeza: P.cabeza - 0.15 * trago };
          const E = mueveFigura(a, 'per_', P);
          // el cigarro en la mano izquierda (la del lado de la cámara: su brasa se ve), el café en la derecha
          a.per_taza = { m: M4(ID3, enMano ? add(E.manoD, [0, 0.02, 0]) : TAZA) };
          const Rc = E.antebrazoI.R, tip = add(E.manoI, m3v(Rc, [0, -0.11, 0]));
          brasa = tip; fumando = fumada;
          a.per_cig = { m: M4(Rc, E.manoI), e: 1.6 * fumada };
          const v = (t * 0.6) % 1, taza = enMano ? E.manoD : add(TAZA, [0, -0.02, 0]);
          a.per_vapor = { m: M4(haciaCamara, add(taza, [0, 0.12 + v * 0.12, 0])), a: Math.sin(v * Math.PI) * 0.9 };
          a.per_humo = { m: M4(m3(haciaCamara, rotZ(0.15 * Math.sin(t * 1.3))), add(tip, [0, 0.03, 0])), a: 0.75 + 0.25 * Math.sin(t * 2.1) };
          const ex = clamp(((t % 17) - 12.4) / 2.6), boca = add(E.cabeza.t, m3v(E.cabeza.R, [0, 0.1, 0.12]));
          a.per_boca = quieta && ex > 0 && ex < 1 ? { m: M4(haciaCamara, add(boca, [0, ex * 0.4, ex * 0.2])), a: Math.sin(ex * Math.PI) * 0.9 } : { off: true };
          const top = add(E.cabeza.t, m3v(E.cabeza.R, [0, 0.29, 0])), pies = ['piernaI', 'piernaD'].map(k => add(E[k].t, m3v(E[k].R, [0, -0.47, 0])));
          a._persona = { postura, puntos: [top, ...pies, E.manoI, E.manoD, E.cadera.t] };
          return a;
        },
        // la cámara no se mueve: defensa, parrilla, faro y cofre de perfil abajo; la persona recostada,
        // recortada contra la pantalla del fondo y el cielo
        keys: [{ eye: CAM, look: add(CAM, CINE.mira), lookH: add(CAM, CINE.miraH), fov: CINE.fov, fovH: CINE.fovH }],
        vista: { fija: true },
      };
    },
  };
  // La geometría se arma una vez por escena y se guarda (sobrevive a la pérdida de la gráfica).
  const armadas = {};
  function escena(name) {
    if (armadas[name]) return armadas[name];
    const B = Builder(), info = ESCENAS[name](B), mesh = B.finish();
    // la cámara se recorta a la proporción de la (primera) pantalla; la luz y el encuadre usan la
    // principal (en el escaparate, el muro de teles entero)
    const a = B.pantalla.aspect, cam = a >= 1 ? [Math.round(48 * a), 48] : [48, Math.round(48 / a)];
    return (armadas[name] = { name, ciclo: CICLO, ...info, mesh, pantalla: B.principal || B.pantalla, pantallas: B.pantallas, camAspect: a, camSize: cam });
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
    const F = k => (aspect > 1.2 && P(k).fovH) || P(k).fov;
    const short = (F(0) + (F(1) - F(0)) * smooth(s0)) * Math.PI / 180;
    const roll = ((P(0).roll || 0) + ((P(1).roll || 0) - (P(0).roll || 0)) * smooth(s0)) * Math.PI / 180;
    // El campo horizontal sale del lado corto: en vertical, 0,92 de él (se gana alto: gran angular de
    // cerca, como en los planos de referencia); en horizontal, como mucho 1,3 (si no, a 16:9 la
    // pantalla se quedaba en nada).
    const hfov = short * (aspect >= 1 ? Math.min(1.3, 0.92 * aspect) : 0.92);
    const fovY = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    return { eye, look, fovY, roll };
  }
  // El plano de pantalla (paseo: false): desde el ojo que la escena dice (delante de su pantalla, poco
  // escorzo), mirando al centro de la pantalla, con el campo justo para que la pantalla ocupe ~57 % del
  // ancho en vertical y ~46 % en horizontal, entera y con algo del cuarto alrededor. El campo sale de
  // proyectar sus cuatro esquinas: vale para cualquier pantalla, cerca o lejos.
  function vistaPantalla(esc, aspect) {
    const V = esc.vista || {};
    if (V.fija) return poseAt(esc, 0, aspect);
    const P = esc.pantalla, eye = (aspect > 1.2 && V.eyeH) || V.eye || add(P.center, mulS(P.normal, P.width * 1.3));
    const look = add(P.center, (aspect > 1.2 && V.miraH) || V.mira || [0, 0, 0]), M = lookAt(eye, look, 0);
    let u0 = 1e9, u1 = -1e9, ua = 0, va = 0;
    for (const c of P.corners) {
      const x = M[0] * c[0] + M[4] * c[1] + M[8] * c[2] + M[12], y = M[1] * c[0] + M[5] * c[1] + M[9] * c[2] + M[13], z = -(M[2] * c[0] + M[6] * c[1] + M[10] * c[2] + M[14]);
      const u = x / z, v = y / z;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); ua = Math.max(ua, Math.abs(u)); va = Math.max(va, Math.abs(v));
    }
    const F = V.frac || [0.57, 0.46];                         // (una escena puede pedir otra proporción)
    const T = Math.max((u1 - u0) / (2 * (aspect >= 1 ? F[1] : F[0])), ua / 0.92, va * aspect / 0.9, 0.07);
    return { eye, look, fovY: 2 * Math.atan(T / aspect), roll: 0 };
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
  const AVG_F = HEAD + `uniform sampler2D uSrc; uniform vec2 uOff;
    void main() {
      vec3 c = vec3(0.0);
      for (int y = 0; y < 6; y++) for (int x = 0; x < 8; x++) c += texture2D(uSrc, uOff + (vec2(float(x), float(y)) + 0.5) / vec2(32.0, 12.0)).rgb;
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
    uniform float uLuz, uTime, uScrGain, uScrKind, uAdd, uRoll, uTwinkle, uAfin, uSlot, uPieceE, uAlpha, uStars;
    uniform vec2 uCamSize; uniform vec3 uFogCol;
    varying HP vec3 vUvq; varying vec3 vCol; varying vec3 vLit; varying float vScr; varying float vFog; varying vec4 vMat; varying HP vec3 vDir;
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    // lo que muestra la pantalla: la cámara (con el retraso de esa pantalla, en cuadros: su hueco de la
    // tira), con su curvatura de tubo y sus líneas, o los focos del anuncio, o lisa (proyección, pantalla
    // plana); y su tinte (cada tele del escaparate tira a un color)
    vec3 pantalla(vec2 uv) {
      vec2 p = uv * 2.0 - 1.0;
      if (uScrKind < 0.5) p *= 1.0 + 0.06 * dot(p, p);
      if (max(abs(p.x), abs(p.y)) > 1.0) return vec3(0.012, 0.012, 0.02);
      vec2 q = p * 0.5 + 0.5, tc = vec2(q.x, 1.0 - q.y), h = 0.5 / uCamSize;
      float slot = mod(uSlot - floor(vMat.x + 0.5) + 16.0, 8.0);
      vec3 c = texture2D(uCam, (vec2(mod(slot, 4.0), floor(slot / 4.0)) + clamp(tc, h, 1.0 - h)) / vec2(4.0, 2.0)).rgb;
      vec2 cell = fract(tc * uCamSize);
      // líneas de barrido: una por cada dos filas, de perfil suave (con una por fila y borde duro, en una
      // pantalla de 50 píxeles salía un muaré ondulado)
      if (uScrKind < 0.5) c *= 1.0 - 0.26 * (0.5 + 0.5 * cos(6.2831 * tc.y * uCamSize.y * 0.5));
      else if (uScrKind < 1.5) c *= 0.66 + 0.34 * smoothstep(0.58, 0.28, length(cell - 0.5));   // (focos: rejilla suave; marcada, en pantallas lejanas hacía ondas)
      else c *= 0.97 + 0.03 * sin(uTime * 47.0);
      c *= (1.0 - 0.22 * dot(p, p)) * vCol;
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
      if (h < 1.0 - 0.0035 * uStars) return 0.0;
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
        vec2 auv = (tile + f) * vec2(0.25, 0.0625);
        vec4 t = texture2D(uAtlas, auv);
        if (t.a < 0.25) discard;
        vec3 base = t.rgb * vCol;
        // (tipo 5: el halo de una pantalla gigante, del color de lo que enseña en ese momento)
        if (uAdd > 0.5) { if (kind == 5.0) base *= luzPantalla() * uLuz * 0.07; gl_FragColor = vec4(base * uAlpha, 0.0); return; }
        float e = max(vMat.y, clamp((1.0 - t.a) * 2.0, 0.0, 1.0));
        // (una pieza puede avivar lo que emite: la brasa del cigarro al dar la fumada)
        if (vMat.y > 0.01) { base *= 1.0 + 0.6 * uPieceE; e = min(e * (1.0 + uPieceE), 1.0); }
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
        src: texture(gl.LINEAR), atlas: texture(gl.NEAREST), quad: gl.createBuffer(), vbos: {}, sets: [], ring: null, slot: 0, avgT: null, avgFresh: true,
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
  const walk = { rate: null, offset: 0, last: -1e9, b: 0 };
  const stats = { frames: 0, ms: 0, variant: '', size: [0, 0], out: [0, 0], phase: 0, eye: null, look: null, fov: 0, pantalla: null, pantallas: [], persona: null, paseo: true, quieto: 0, audio: false };
  function project(VP, p, W, H) {
    const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13], w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
    return w > 0.01 ? [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H, w] : null;
  }
  // dónde queda un cuadrilátero en la imagen: caja recortada al cuadro, sus esquinas y qué parte se ve
  function enImagen(VP, corners, W, H) {
    const pts = corners.map(p => project(VP, p, W, H));
    if (!pts.every(Boolean)) return { visible: false, rect: null };
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(W, Math.max(...xs)), y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(H, Math.max(...ys));
    if (!(x1 > x0 && y1 > y0)) return { visible: false, rect: null };
    return { visible: true, rect: [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)], quad: pts.map(p => [Math.round(p[0]), Math.round(p[1])]), entera: +((x1 - x0) * (y1 - y0) / ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)))).toFixed(3) };
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
    const paseo = o.paseo !== false;
    // Paseo o plano de pantalla. «b» va de 0 (paseando) a 1 (quieta frente a la pantalla) en 0,8 s
    // mientras los cuadros llegan seguidos (menos de medio segundo entre uno y otro); tras una pausa
    // salta directo a donde toca: así todo sigue siendo función del tiempo y no hay saltos al cambiar.
    const seguido = Math.abs(now - walk.last) < 500, dt = seguido ? clamp((now - walk.last) / 1000, 0, 0.25) : 0;
    walk.last = now;
    walk.b = seguido ? clamp(walk.b + (paseo ? -dt : dt) / 0.8) : (paseo ? 0 : 1);
    const bq = smooth(walk.b);
    // La fase: tiempo × velocidad + desfase. Si la velocidad cambia mientras corre (el mando, los graves
    // que la empujan, o el freno al ir a la pantalla), el desfase absorbe el cambio y no salta; con
    // giro 0, quieta en el primer plano; frente a la pantalla, la fase se detiene y luego sigue de ahí.
    let phase = 0;
    if (giro > 0) {
      const rate = giro / FABRICA.giro / esc.ciclo * (1 + 1.2 * bass) * (1 - bq);
      if (walk.rate === null || !seguido) { walk.rate = rate; walk.offset = 0; }
      if (rate !== walk.rate) { walk.offset = (((walk.offset + now / 1000 * (walk.rate - rate)) % 1) + 1) % 1; walk.rate = rate; }
      phase = (((now / 1000 * rate + walk.offset) % 1) + 1) % 1;
    } else { walk.rate = 0; walk.offset = 0; }
    const aspect = outW / outH, tAmb = (now / 1000) % 3600;
    let pose = poseAt(esc, phase, aspect);
    if (esc.vaiven) { const v = esc.vaiven(tAmb); pose.eye = add(pose.eye, mulS(v.d, 1 - bq)); pose.look = add(pose.look, mulS(v.d, 1 - bq)); pose.roll += v.r * (1 - bq); }
    if (bq > 0) {
      const q = vistaPantalla(esc, aspect), mix3 = (x, y) => x.map((v, i) => v + (y[i] - v) * bq);
      pose = { eye: mix3(pose.eye, q.eye), look: mix3(pose.look, q.look), fovY: pose.fovY + (q.fovY - pose.fovY) * bq, roll: pose.roll * (1 - bq) };
    }
    const VP = mat4mul(perspective(pose.fovY, aspect, esc.near, esc.far), lookAt(pose.eye, pose.look, pose.roll));
    const anim = esc.anim ? esc.anim(tAmb, { fase: phase, b: bq, now }) : {};
    const set = setFor(iw, ih), vbo = vboFor(esc), [cw, ch] = esc.camSize;
    try {
      // 1 · La cámara al tamaño de la pantalla, en el siguiente de los ocho huecos de la tira (así una
      // pantalla puede enseñar lo de hace unos cuadros sin subir nada más: el muro de teles va desfasado).
      let fresh = false;
      if (!res.ring || res.ring.w !== cw * 4 || res.ring.h !== ch * 2) { freeTarget(res.ring); res.ring = target(cw * 4, ch * 2, gl.NEAREST, false); res.avgFresh = true; fresh = true; }
      res.slot = ((res.slot || 0) + 1) % 8;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      const [sx, sy, sw, sh] = crop(srcW, srcH, esc.camAspect);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      bindQuad();
      gl.bindFramebuffer(gl.FRAMEBUFFER, res.ring.fbo);
      gl.useProgram(res.cam.prog);
      gl.uniform1i(res.cam.u.uSrc, 0);
      if (mirror) gl.uniform4f(res.cam.u.uCrop, (sx + sw) / srcW, sy / srcH, -sw / srcW, sh / srcH);
      else gl.uniform4f(res.cam.u.uCrop, sx / srcW, sy / srcH, sw / srcW, sh / srcH);
      gl.uniform2f(res.cam.u.uStep, sw / srcW / cw, sh / srcH / ch);
      for (let k = fresh ? 0 : res.slot; k <= (fresh ? 7 : res.slot); k++) { gl.viewport((k % 4) * cw, Math.floor(k / 4) * ch, cw, ch); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
      // 2 · Su color medio, mezclado con el anterior (un tercio por cuadro).
      gl.bindFramebuffer(gl.FRAMEBUFFER, res.avgT.fbo);
      gl.viewport(0, 0, 1, 1);
      gl.useProgram(res.avg.prog);
      gl.bindTexture(gl.TEXTURE_2D, res.ring.tex);
      gl.uniform1i(res.avg.u.uSrc, 0);
      gl.uniform2f(res.avg.u.uOff, (res.slot % 4) / 4, Math.floor(res.slot / 4) / 2);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      gl.blendColor(0, 0, 0, res.avgFresh ? 1 : 0.33);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
      res.avgFresh = false;
      // 3 · La escena, a la resolución interna.
      gl.bindFramebuffer(gl.FRAMEBUFFER, set.scene.fbo);
      gl.viewport(0, 0, iw, ih);
      gl.clearColor(esc.fog[0], esc.fog[1], esc.fog[2], 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      const S = res.scene, u = S.u;
      gl.useProgram(S.prog);
      bindMesh(vbo);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, res.atlas);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, res.ring.tex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, res.avgT.tex);
      gl.uniform1i(u.uAtlas, 0); gl.uniform1i(u.uCam, 1); gl.uniform1i(u.uAvg, 2);
      gl.uniformMatrix4fv(u.uVP, false, VP);
      gl.uniformMatrix4fv(u.uModel, false, IDM);
      gl.uniform3fv(u.uEye, pose.eye);
      gl.uniform2f(u.uRes, iw, ih);
      gl.uniform1f(u.uSnap, temblor > 0 ? temblor * 2 + mid : 0);
      // (la luz puede venir de otra pantalla que la del encuadre: en el autocinema, la que está detrás de la cámara)
      const P = esc.luzDe || esc.pantalla;
      // (la pantalla es una luz con área: se pone el punto de luz un poco por delante, así también
      // alcanza de refilón la pared en la que se apoya, como pasa con un tubo encendido)
      gl.uniform3fv(u.uScrPos, add(P.center, mulS(P.normal, P.width * 0.55)));
      gl.uniform3fv(u.uScrC, P.center);
      gl.uniform3fv(u.uScrN, P.normal);
      gl.uniform1f(u.uScrFall, esc.scr.fall);
      const lp = new Float32Array(12), lc = new Float32Array(12), lf = new Float32Array(4);
      const luces = typeof esc.luces === 'function' ? esc.luces(tAmb) : esc.luces;
      luces.slice(0, 4).forEach((l, i) => { lp.set(l.pos, i * 3); lc.set(l.col, i * 3); lf[i] = l.fall; });
      gl.uniform3fv(u.uLp, lp); gl.uniform3fv(u.uLc, lc); gl.uniform1fv(u.uLf, lf);
      gl.uniform3fv(u.uAmb, esc.amb);
      gl.uniform2f(u.uFog, esc.fog[3], esc.fog[4]);
      gl.uniform3f(u.uFogCol, esc.fog[0], esc.fog[1], esc.fog[2]);
      gl.uniform1f(u.uLuz, esc.scr.power * (luz / FABRICA.luz) * (1 + 0.8 * beat + 0.4 * bass));
      gl.uniform1f(u.uTime, tAmb);
      gl.uniform1f(u.uScrGain, (esc.scr.gain || 1.42) * (1 + 0.6 * beat));
      gl.uniform1f(u.uScrKind, esc.scr.kind);
      gl.uniform1f(u.uRoll, beat);
      gl.uniform1f(u.uTwinkle, treble);
      gl.uniform2f(u.uCamSize, cw, ch);
      gl.uniform1f(u.uSlot, res.slot);
      gl.uniform1f(u.uStars, esc.estrellas == null ? 1 : esc.estrellas);
      gl.uniform1f(u.uAdd, 0); gl.uniform1f(u.uPieceE, 0); gl.uniform1f(u.uAlpha, 1);
      const afin = o._perspectiva ? 0 : 1;
      gl.uniform1f(u.uAfin, afin); gl.uniform1f(u.uAfinV, afin);
      // Lo quieto, luego las piezas que se mueven (cada una con su matriz; puede ir varias veces), y al
      // final lo que se suma (franjas de luz, humo, vapor, haces) sin escribir profundidad.
      const dibuja = g => {
        const a = g.name === 'fijo' || g.name === 'luz' ? null : anim[g.name];
        if (a && a.off) return;
        const ms = !a || !a.m ? [IDM] : a.m.length === 16 && typeof a.m[0] === 'number' ? [a.m] : a.m;
        gl.uniform1f(u.uPieceE, a && a.e || 0); gl.uniform1f(u.uAlpha, a && a.a != null ? a.a : 1);
        for (const m of ms) { gl.uniformMatrix4fv(u.uModel, false, m); gl.drawArrays(gl.TRIANGLES, g.start, g.count); }
      };
      const groups = esc.mesh.groups;
      groups.filter(g => !g.add).forEach(dibuja);
      const sumas = groups.filter(g => g.add);
      if (sumas.length) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
        gl.uniform1f(u.uAdd, 1);
        sumas.forEach(dibuja);
        gl.uniform1f(u.uAdd, 0);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      gl.uniformMatrix4fv(u.uModel, false, IDM); gl.uniform1f(u.uPieceE, 0); gl.uniform1f(u.uAlpha, 1);
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
      gl.uniform1f(Q.u.uBloom, (esc.bloom || 1) * (1 + 0.4 * bass));
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
      stats.error = String(error && (error.stack || error.message) || error);
      if (!gl || gl.isContextLost()) return false;
      return true;
    }
    // dónde quedaron las pantallas (y la persona, si la hay) en la imagen: para las pruebas y para encuadrar
    const pantalla = enImagen(VP, esc.pantalla.corners, outW, outH);
    const pantallas = esc.pantallas.map(p => enImagen(VP, p.corners, outW, outH));
    const medidas = esc.medidas ? Object.fromEntries(Object.entries(esc.medidas).map(([k, q]) => [k, enImagen(VP, q, outW, outH)])) : null;
    let persona = null;
    if (anim._persona) {
      const pts = anim._persona.puntos.map(p => project(VP, p, outW, outH)).filter(Boolean);
      if (pts.length) { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); persona = { postura: anim._persona.postura, alto: Math.round(Math.max(...ys) - Math.min(...ys)), ancho: Math.round(Math.max(...xs) - Math.min(...xs)), rect: [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...ys) - Math.min(...ys))], cabeza: anim._persona.puntos[0].map(v => +v.toFixed(2)) }; }
    }
    Object.assign(stats, { frames: stats.frames + 1, ms: performance.now() - started, variant: name, size: [iw, ih], out: [outW, outH], phase: +phase.toFixed(4), eye: pose.eye.map(v => +v.toFixed(3)), look: pose.look.map(v => +v.toFixed(3)), fov: +(pose.fovY * 180 / Math.PI).toFixed(2), roll: +pose.roll.toFixed(4), pantalla, pantallas, medidas, persona, paseo, quieto: +walk.b.toFixed(3), audio: !!audio, tris: esc.mesh.tris });
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
    FABRICA: { ...FABRICA, paseo: true }, VARIANTES: ['DORMITORIO', 'OFICINA', 'AZOTEA', 'TORRE', 'AUTOBUS', 'AUTOCINEMA', 'ESCAPARATE', 'TAQUERIA'], release,
    // milisegundos de una vuelta del paseo con ese giro (sin sonido), en esa escena
    cycle: (giro, variante) => (num(giro, FABRICA.giro) > 0 ? escena(ESCENAS[variante] ? variante : 'DORMITORIO').ciclo * FABRICA.giro / num(giro, FABRICA.giro) * 1000 : Infinity),
    state: () => ({ gl: !!gl, failed, lost, ...stats, ms: +stats.ms.toFixed(2), triangulos: Object.fromEntries(Object.keys(ESCENAS).map(k => [k, escena(k).mesh.tris])) }),
    // Para las pruebas: una pérdida de la gráfica como la que provoca el sistema.
    _perder() { const ext = gl && gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); return !!ext; },
  };
})();
