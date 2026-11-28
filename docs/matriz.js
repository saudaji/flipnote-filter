// FLIP · MATRIZ: una pantalla de puntos de fósforo que dibuja con la dirección de los contornos.
//
// La imagen no se ve por su luz sino por hacia dónde van sus bordes. Una rejilla fija de nodos (36
// de lado corto, de fábrica) y cada nodo tiende un puente hacia sus vecinos en una sola dirección:
// vertical (|), horizontal (—) o una de las dos diagonales (/ \). Donde la imagen no dice nada, va
// vertical; donde hay un contorno, el nodo se gira con él. Como la dirección sale de un campo
// suavizado, los nodos de una zona comparten la suya, y los que comparten diagonal se sueldan en
// las esquinas de la celda: cordones de cuentas separados por canales negros.
//
// Todo en la gráfica (WebGL 1, sin texturas de coma flotante):
//   1 · CELDA     la cámara reducida a la rejilla (16 tomas por celda) y promediada en el tiempo, más
//                 deprisa si algo se mueve: quieta no tiembla, en movimiento no deja estela.
//   2 · GRADIENTE Scharr 3 × 3 de esa luz.
//   3 · ESTADO    tensor de estructura suavizado en 9 × 9 celdas (las zonas salen anchas y decididas),
//                 dirección del contorno y coherencia; se cuantiza a cuatro direcciones CON MEMORIA:
//                 una celda solo cambia si la dirección nueva se pasa 8° del límite, o si la
//                 coherencia cruza el umbral ±0,05. Sin eso la matriz hierve con el ruido del sensor.
//   4 · MAYORÍA   cada celda toma la dirección que más se repite a su alrededor: parches limpios.
//   5 · ENLACES   cada celda sabe si su vecino de delante y el de atrás comparten dirección.
//   6 · DIBUJO    distancia exacta a nodo y puente de las nueve celdas de alrededor (así el cordón
//                 pasa por la esquina de la celda sin muesca), fósforo de borde blando con núcleo
//                 caliente; se pinta también a un cuarto, se emborrona y se suma: el resplandor ancho
//                 que llena a medias los canales negros.
// Nada se lee de vuelta de la gráfica. La columna de DATOS (opcional) dice valores de verdad de
// FLIP —luz, coherencia, cuadros por segundo, golpe— medidos aparte en una muestra de 32 × 18.
//
//   renderMatriz(fuente, anchoFuente, altoFuente, ctx2d, espejo, variante, opciones) → true si pintó
//   opciones: { now, path, outW, outH, own, audio, celdas (24…64), flujo (0,10…0,60), halo (0…1),
//               sujeto (la persona en cordones, el fondo en columnas tenues), datos }
//   variante: FOSFORO · AMBAR · HIELO
(function () {
  'use strict';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const VERT = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  // En las texturas de la rejilla la fila 0 es la de ARRIBA de la imagen (y hacia abajo, como en
  // pantalla): así las direcciones se piensan igual que se ven. Modo 0 = |, 1 = —, 2 = /, 3 = \.

  // 1 · CELDA. uRect: dónde cae la rejilla en la imagen (en fracción) y uCrop, de dónde sale en la fuente.
  const CELL = HEAD + `
    uniform sampler2D uSrc; uniform sampler2D uPrev;
    uniform vec4 uCrop; uniform vec2 uCells; uniform vec2 uOrigin; uniform vec2 uSpan; uniform float uFresh;
    varying vec2 vUv;
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main() {
      vec2 cell = floor(vUv * uCells);
      float acc = 0.0;
      for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
        vec2 f = clamp(uOrigin + (cell + (vec2(float(i), float(j)) + 0.5) * 0.25) * uSpan, 0.0, 1.0);
        acc += luma(texture2D(uSrc, uCrop.xy + f * uCrop.zw).rgb);
      }
      float l = acc / 16.0;
      float prev = texture2D(uPrev, vUv).r;
      float a = uFresh > 0.5 ? 1.0 : mix(0.22, 0.85, smoothstep(0.04, 0.18, abs(l - prev)));
      gl_FragColor = vec4(mix(prev, l, a), l, 0.0, 1.0);
    }`;

  // 2 · GRADIENTE: Scharr 3 × 3 de la luz de la celda (en RG, con 0,5 de cero).
  const GRAD = HEAD + `
    uniform sampler2D uCell; uniform vec2 uCells;
    varying vec2 vUv;
    float L(vec2 c) { return texture2D(uCell, (clamp(c, vec2(0.0), uCells - 1.0) + 0.5) / uCells).r; }
    void main() {
      vec2 p = floor(vUv * uCells);
      float tl = L(p + vec2(-1.0, -1.0)), t = L(p + vec2(0.0, -1.0)), tr = L(p + vec2(1.0, -1.0));
      float l = L(p + vec2(-1.0, 0.0)), r = L(p + vec2(1.0, 0.0));
      float bl = L(p + vec2(-1.0, 1.0)), b = L(p + vec2(0.0, 1.0)), br = L(p + vec2(1.0, 1.0));
      float gx = (3.0 * (tr + br - tl - bl) + 10.0 * (r - l)) / 32.0;
      float gy = (3.0 * (bl + br - tl - tr) + 10.0 * (b - t)) / 32.0;
      gl_FragColor = vec4(0.5 + gx, 0.5 + gy, 0.0, 1.0);
    }`;
  // 3 · ESTADO: tensor de estructura suavizado en 9 × 9 celdas (binomial, σ ≈ 2): las zonas salen
  //     anchas y decididas. Dirección, coherencia y la memoria de cada celda.
  const STATE = HEAD + `
    uniform sampler2D uGrad; uniform sampler2D uCell; uniform sampler2D uPrev; uniform vec2 uCells; uniform float uThr; uniform float uFresh;
    varying vec2 vUv;
    vec2 G(vec2 c) { return texture2D(uGrad, (clamp(c, vec2(0.0), uCells - 1.0) + 0.5) / uCells).rg - 0.5; }
    float W(int i) { int a = i < 0 ? -i : i; return a == 0 ? 70.0 : a == 1 ? 56.0 : a == 2 ? 28.0 : a == 3 ? 8.0 : 1.0; }
    // centro de cada dirección (ángulo de la tangente en la imagen, y hacia abajo, módulo π)
    float centerOf(float m) { return m < 0.5 ? 1.5707963 : m < 1.5 ? 0.0 : m < 2.5 ? 2.3561945 : 0.7853982; }
    float apart(float a, float b) { return abs(mod(a - b + 1.5707963, 3.1415927) - 1.5707963); }
    void main() {
      vec2 c = floor(vUv * uCells);
      float jxx = 0.0, jyy = 0.0, jxy = 0.0;
      for (int j = -4; j <= 4; j++) for (int i = -4; i <= 4; i++) {
        vec2 g = G(c + vec2(float(i), float(j)));
        float w = W(i) * W(j) / 65536.0;
        jxx += w * g.x * g.x; jyy += w * g.y * g.y; jxy += w * g.x * g.y;
      }
      // coherencia con un suelo de energía: una pared lisa con ruido no tiene dirección
      float coh = sqrt((jxx - jyy) * (jxx - jyy) + 4.0 * jxy * jxy) / (jxx + jyy + 0.0006);
      float th = mod(0.5 * atan(2.0 * jxy, jxx - jyy) + 1.5707963, 3.1415927);   // tangente del contorno
      float best = 0.0, bd = 9.0;
      for (int k = 0; k < 4; k++) { float d = apart(th, centerOf(float(k))); if (d < bd) { bd = d; best = float(k); } }
      vec4 prev = texture2D(uPrev, vUv);
      float pm = floor(prev.r * 3.0 + 0.5);
      bool fresh = uFresh > 0.5, was = prev.a > 0.5;
      bool on = fresh ? coh > uThr : (was ? coh > uThr - 0.05 : coh > uThr + 0.05);
      float m = 0.0;
      if (on) m = (!fresh && was && apart(th, centerOf(pm)) < 0.5323254) ? pm : best;   // 22,5° + 8°
      gl_FragColor = vec4(m / 3.0, clamp(coh, 0.0, 1.0), texture2D(uCell, vUv).r, on ? 1.0 : 0.0);
    }`;
  // 4 · MAYORÍA: cada celda toma la dirección que más se repite a su alrededor (3 × 3; la suya
  //     cuenta doble). Sin celdas sueltas: parches limpios, como la pieza.
  const MAJOR = HEAD + `
    uniform sampler2D uState; uniform vec2 uCells;
    varying vec2 vUv;
    void main() {
      vec2 c = floor(vUv * uCells);
      vec4 own = texture2D(uState, vUv);
      float m0 = floor(own.r * 3.0 + 0.5);
      vec4 n = vec4(0.0);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        float m = floor(texture2D(uState, (clamp(c + vec2(float(i), float(j)), vec2(0.0), uCells - 1.0) + 0.5) / uCells).r * 3.0 + 0.5);
        n += vec4(m < 0.5 ? 1.0 : 0.0, abs(m - 1.0) < 0.5 ? 1.0 : 0.0, abs(m - 2.0) < 0.5 ? 1.0 : 0.0, m > 2.5 ? 1.0 : 0.0);
      }
      n += vec4(m0 < 0.5 ? 1.0 : 0.0, abs(m0 - 1.0) < 0.5 ? 1.0 : 0.0, abs(m0 - 2.0) < 0.5 ? 1.0 : 0.0, m0 > 2.5 ? 1.0 : 0.0);
      float m = m0;
      float top = m0 < 0.5 ? n.x : m0 < 1.5 ? n.y : m0 < 2.5 ? n.z : n.w;
      if (n.x > top) { top = n.x; m = 0.0; }
      if (n.y > top) { top = n.y; m = 1.0; }
      if (n.z > top) { top = n.z; m = 2.0; }
      if (n.w > top) { top = n.w; m = 3.0; }
      gl_FragColor = vec4(m / 3.0, own.g, own.b, own.a);
    }`;

  // 5 · ENLACES (y lo que se ve: la persona, la inversión del golpe)
  const LINKS = HEAD + `
    uniform sampler2D uState; uniform sampler2D uMask; uniform vec2 uCells; uniform float uFlip; uniform float uUseMask;
    uniform vec2 uOrigin; uniform vec2 uSpan;
    varying vec2 vUv;
    vec2 stepOf(float m) { return m < 0.5 ? vec2(0.0, 1.0) : m < 1.5 ? vec2(1.0, 0.0) : m < 2.5 ? vec2(1.0, -1.0) : vec2(1.0, 1.0); }
    float person(vec2 c) { return texture2D(uMask, clamp(uOrigin + (c + 0.5) * uSpan, 0.0, 1.0)).r; }
    float modeAt(vec2 c) {
      if (c.x < 0.0 || c.y < 0.0 || c.x >= uCells.x || c.y >= uCells.y) return -1.0;
      float m = floor(texture2D(uState, (c + 0.5) / uCells).r * 3.0 + 0.5);
      if (uUseMask > 0.5 && person(c) < 0.5) m = 0.0;                      // fuera de la persona, columnas
      if (uFlip > 0.5 && m > 1.5) m = 5.0 - m;                             // el golpe cruza las diagonales
      return m;
    }
    void main() {
      vec2 c = floor(vUv * uCells);
      vec4 s = texture2D(uState, vUv);
      float m = modeAt(c);
      vec2 d = stepOf(m);
      // la luz de la imagen: el nodo engorda y brilla con ella (así la figura se lee también por su luz)
      float lum = smoothstep(0.03, 0.85, s.b);
      float bright = mix(0.55, 1.0, lum);                                  // (la pieza apenas varía de brillo: manda la dirección)
      if (uUseMask > 0.5 && person(c) < 0.5) bright *= 0.35;
      gl_FragColor = vec4(m / 3.0, modeAt(c + d) == m ? 1.0 : 0.0, modeAt(c - d) == m ? 1.0 : 0.0, bright);
    }`;

  // 6 · DIBUJO. Se pinta dos veces: a un cuarto, para el resplandor (que se emborrona), y al tamaño
  //     de salida, sumándole ese resplandor. uRect en píxeles del dibujo (y hacia abajo).
  const DRAW = HEAD + `
    uniform sampler2D uLinks; uniform sampler2D uBloom; uniform vec2 uCells; uniform vec2 uOut; uniform vec4 uRect; uniform vec2 uGrid; uniform float uCellPx;
    uniform vec3 uBg; uniform vec3 uHaloC; uniform vec3 uBody; uniform vec3 uCore; uniform float uGlow; uniform float uGrow; uniform float uPulse; uniform float uBloomAmt;
    varying vec2 vUv;
    vec2 stepOf(float m) { return m < 0.5 ? vec2(0.0, 1.0) : m < 1.5 ? vec2(1.0, 0.0) : m < 2.5 ? vec2(1.0, -1.0) : vec2(1.0, 1.0); }
    float seg(vec2 q, vec2 d) { float t = clamp(dot(q, d) / dot(d, d), 0.0, 1.0); return length(q - d * t); }
    void main() {
      vec2 px = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y);
      vec3 col;
      if (px.x < uRect.x) col = uBg * 0.7;                                      // (la columna de datos)
      else {
        vec2 g = (px - uRect.xy - uGrid) / uCellPx;                             // en celdas
        vec2 c0 = floor(g);
        float best = 9.0, bright = 0.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 c = c0 + vec2(float(i), float(j));
          if (c.x < 0.0 || c.y < 0.0 || c.x >= uCells.x || c.y >= uCells.y) continue;
          vec4 s = texture2D(uLinks, (c + 0.5) / uCells);
          vec2 d = stepOf(floor(s.r * 3.0 + 0.5));
          vec2 q = g - (c + 0.5);
          // cuenta gorda y alargada en el sentido del cordón (una perla), cuello más fino entre perla y perla
          float rDot = mix(0.29, 0.38, s.a) + uGrow, rNeck = rDot * 0.42;
          vec2 dn = normalize(d);
          float dist = length(q - dn * clamp(dot(q, dn), -0.15, 0.15)) - rDot;
          if (s.g > 0.5) dist = min(dist, seg(q, d) - rNeck);
          if (s.b > 0.5) dist = min(dist, seg(q, -d) - rNeck);
          if (dist < best) { best = dist; bright = s.a; }
        }
        // borde blando (el fósforo no tiene filo) y núcleo caliente
        float soft = 0.11 + 0.9 / uCellPx;                                        // (el borde de la perla se emborrona, el canal queda negro)
        float body = smoothstep(soft, -soft, best);
        float hot = smoothstep(-0.02, -0.16, best) * body;
        float k = bright * (1.0 + uPulse);
        col = uBg + uHaloC * uGlow * 0.16 * exp(-max(best, 0.0) * 9.0) * k;
        col += uBody * body * k;
        col = mix(col, uCore, hot * clamp(k, 0.0, 1.0) * 0.7);
      }
      col += texture2D(uBloom, vUv).rgb * uBloomAmt;                           // el resplandor ancho
      vec2 e = vUv - 0.5;
      col *= 1.0 - 0.32 * dot(e, e);                                           // el tubo cae un poco hacia los bordes
      gl_FragColor = vec4(col, 1.0);
    }`;
  // El emborronado del resplandor: gaussiana de 9 tomas en 5 lecturas (filtrado lineal), por eje.
  const BLUR = HEAD + `
    uniform sampler2D uTex; uniform vec2 uStep;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(uTex, vUv).rgb * 0.227027;
      c += (texture2D(uTex, vUv + uStep * 1.384615).rgb + texture2D(uTex, vUv - uStep * 1.384615).rgb) * 0.316216;
      c += (texture2D(uTex, vUv + uStep * 3.230769).rgb + texture2D(uTex, vUv - uStep * 3.230769).rgb) * 0.070270;
      gl_FragColor = vec4(c, 1.0);
    }`;

  const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  // Fósforo de cada variante: fondo del tubo, halo, cuerpo y núcleo caliente.
  const PALETTES = {
    FOSFORO: { bg: hex('#040B06'), halo: hex('#18B85C'), body: hex('#52F08C'), core: hex('#B8FFD0'), ink: '#6BFF9E' },
    AMBAR: { bg: hex('#0B0602'), halo: hex('#B8650A'), body: hex('#FFB838'), core: hex('#FFEBC2'), ink: '#FFC45C' },
    HIELO: { bg: hex('#02070B'), halo: hex('#1A78B8'), body: hex('#6AE0FF'), core: hex('#D6F7FF'), ink: '#8AE8FF' },
  };

  let canvas = null, gl = null, failed = false, lost = 0, res = null, maxSide = 4096;
  const slots = new Map();                 // memoria por quién pinta (CÁMARA, STAGE, PORTAL…) y tamaño de rejilla
  const stats = { frames: 0, ms: 0, msAvg: 0, variant: '', cells: [0, 0], cellPx: 0, size: [0, 0], slot: '', person: '', datos: false };

  function program(frag) {
    const make = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('MATRIZ: ' + gl.getShaderInfoLog(shader));
      return shader;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('MATRIZ: ' + gl.getProgramInfoLog(prog));
    const u = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) { const name = gl.getActiveUniform(prog, i).name; u[name] = gl.getUniformLocation(prog, name); }
    return { prog, u };
  }
  function texture(filter, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }
  function init() {
    if (gl) return true;
    if (failed) return false;
    try {
      canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
      gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('MATRIZ: sin WebGL');
      // Si el sistema retira la gráfica (al volver de segundo plano), la siguiente vuelta la rehace.
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost++; gl = null; canvas = null; res = null; slots.clear(); });
      const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS), tmax = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      maxSide = Math.max(512, Math.min(4096, dims ? Math.min(dims[0], dims[1]) : 4096, tmax || 4096));
      res = { cell: program(CELL), grad: program(GRAD), state: program(STATE), major: program(MAJOR), links: program(LINKS), draw: program(DRAW), blur: program(BLUR), src: texture(gl.LINEAR), mask: texture(gl.LINEAR), fbo: gl.createFramebuffer(), bloom: null, bw: 0, bh: 0 };
      res.black = texture(gl.NEAREST, 1, 1);                                  // (resplandor nulo, para la pasada reducida)
      gl.bindTexture(gl.TEXTURE_2D, res.mask);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([255]));
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      return true;
    } catch (error) {
      console.warn(error && error.message || error);
      failed = true; gl = null; canvas = null; res = null;
      return false;
    }
  }

  // La memoria de una rejilla: celda y estado de dos en dos (el de antes y el de ahora) y los enlaces.
  function slotFor(key, cw, ch) {
    let slot = slots.get(key);
    if (slot && (slot.cw !== cw || slot.ch !== ch)) { dropSlot(slot); slots.delete(key); slot = null; }
    if (!slot) {
      if (slots.size >= 3) {                                 // (tres a la vez como mucho: se va la más vieja)
        let old = null;
        for (const [k, s] of slots) if (!old || s.at < old[1].at) old = [k, s];
        dropSlot(old[1]); slots.delete(old[0]);
      }
      slot = { cw, ch, cell: [texture(gl.NEAREST, cw, ch), texture(gl.NEAREST, cw, ch)], state: [texture(gl.NEAREST, cw, ch), texture(gl.NEAREST, cw, ch)], grad: texture(gl.NEAREST, cw, ch), maj: texture(gl.NEAREST, cw, ch), links: texture(gl.NEAREST, cw, ch), turn: 0, at: -1e9, frames: 0, mirror: null, beats: 0, flipUntil: 0 };
      slots.set(key, slot);
    }
    return slot;
  }
  function dropSlot(slot) { if (!gl) return; for (const t of [...slot.cell, ...slot.state, slot.grad, slot.maj, slot.links]) gl.deleteTexture(t); }
  // Las dos texturas del resplandor, a un cuarto del dibujo (filtrado lineal: así se emborrona y se estira).
  function bloomFor(w, h) {
    const bw = Math.max(8, Math.ceil(w / 4)), bh = Math.max(8, Math.ceil(h / 4));
    if (res.bloom && res.bw === bw && res.bh === bh) return res.bloom;
    if (res.bloom) for (const t of res.bloom) gl.deleteTexture(t);
    res.bloom = [texture(gl.LINEAR, bw, bh), texture(gl.LINEAR, bw, bh)]; res.bw = bw; res.bh = bh;
    return res.bloom;
  }
  function pass(p, target, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? res.fbo : null);
    if (target) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.prog);
  }
  function bind(unit, tex, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); if (loc) gl.uniform1i(loc, unit); }

  // ── La persona (SUJETO): la máscara del detector compartido, en una textura de un canal ─────
  const person = { bytes: null, seq: -1, phase: '' };
  function personMask(source, sx, sy, sw, sh, mirror) {
    if (typeof flipSilhouette === 'undefined') { person.phase = 'none'; return false; }
    flipSilhouette.start();
    flipSilhouette.push(source, sx, sy, sw, sh, mirror);
    const mask = flipSilhouette.latest(1200);
    person.phase = mask ? 'ready' : flipSilhouette.status().phase;
    if (!mask) return false;
    if (mask.seq !== person.seq) {
      person.seq = mask.seq;
      const n = mask.width * mask.height;
      if (!person.bytes || person.bytes.length !== n) person.bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) person.bytes[i] = mask.data[i] * 255;
      gl.bindTexture(gl.TEXTURE_2D, res.mask);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mask.width, mask.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, person.bytes);
    }
    return true;
  }

  // ── DATOS: medidas de verdad en una muestra de 32 × 18, cuatro veces por segundo ─────────────
  const probe = { canvas: null, ctx: null, at: -1e9, luz: 0, coh: 0, fps: 0, times: [] };
  function measure(source, sx, sy, sw, sh, now) {
    probe.times.push(now);
    while (probe.times.length > 1 && now - probe.times[0] > 1000) probe.times.shift();
    probe.fps = probe.times.length > 1 ? Math.round((probe.times.length - 1) * 1000 / (now - probe.times[0])) : 0;
    if (now - probe.at < 250) return;
    probe.at = now;
    const w = 32, h = 18;
    if (!probe.canvas) { probe.canvas = document.createElement('canvas'); probe.canvas.width = w; probe.canvas.height = h; probe.ctx = probe.canvas.getContext('2d', { willReadFrequently: true }); }
    try { probe.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h); } catch (_) { return; }
    const d = probe.ctx.getImageData(0, 0, w, h).data, l = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0; i < l.length; i++) { l[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255; sum += l[i]; }
    let xx = 0, yy = 0, xy = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const k = y * w + x, gx = (l[k + 1] - l[k - 1]) / 2, gy = (l[k + w] - l[k - w]) / 2; xx += gx * gx; yy += gy * gy; xy += gx * gy; }
    probe.luz = sum / l.length;
    probe.coh = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy) / (xx + yy + 1e-6);
  }
  function drawData(ctx, strip, outH, ink, audio, cells) {
    const u = Math.max(1, outH / 640), size = Math.max(9, Math.round(13 * u)), big = Math.round(size * 1.7);
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.fillStyle = ink; ctx.shadowColor = ink; ctx.shadowBlur = 6 * u;
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const x = Math.round(strip * 0.14);
    const beat = audio && audio.beat ? audio.beat : 0;
    const rows = [
      ['LUZ', probe.luz.toFixed(2).replace(/^0/, '')], ['COH', probe.coh.toFixed(2).replace(/^0/, '')],
      ['CPS', String(probe.fps)], ['CEL', String(Math.min(cells[0], cells[1]))], ['GOLPE', beat > 0.25 ? '●' : '·'],
    ];
    let y = Math.round(outH * 0.16);
    const step = Math.round((outH * 0.7) / rows.length);
    for (const [label, value] of rows) {
      ctx.font = '600 ' + size + "px 'IBM Plex Mono', 'Courier New', monospace";
      ctx.globalAlpha = 0.62; ctx.fillText(label, x, y);
      ctx.font = '700 ' + big + "px 'IBM Plex Mono', 'Courier New', monospace";
      ctx.globalAlpha = 1; ctx.fillText(value, x, y + big);
      y += step;
    }
    // el borde de la columna: una fila de puntos, como los de la matriz
    ctx.globalAlpha = 0.7;
    const r = Math.max(1, 1.6 * u), gap = Math.max(4, 11 * u);
    for (let py = gap; py < outH - gap / 2; py += gap) { ctx.beginPath(); ctx.arc(strip - gap * 0.6, py, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function renderMatriz(source, srcW, srcH, ctx, mirror, variant, opts) {
    const o = opts || {};
    const outW = Math.max(1, Math.round(o.outW || ctx.canvas.width)), outH = Math.max(1, Math.round(o.outH || ctx.canvas.height));
    if (!srcW || !srcH || !init()) return false;
    const started = performance.now(), now = o.now || started;
    const pal = PALETTES[variant] || PALETTES.FOSFORO;
    // Tamaño del dibujo: el de salida, con tope de la gráfica (una foto enorme se pinta al tope y se estira).
    const k = Math.min(1, maxSide / Math.max(outW, outH));
    const w = Math.max(16, Math.round(outW * k)), h = Math.max(16, Math.round(outH * k));
    // La rejilla: celdas cuadradas, «celdas» en el lado corto del rectángulo de imagen, centrada.
    const strip = o.datos ? Math.round(w * 0.2) : 0;
    const rw = w - strip, rh = h;
    const n = Math.round(clamp(o.celdas == null ? 36 : o.celdas, 24, 64));
    const cellPx = Math.min(rw, rh) / n;
    const cw = Math.max(4, Math.ceil(rw / cellPx - 0.02)), ch = Math.max(4, Math.ceil(rh / cellPx - 0.02));
    const gx = (rw - cw * cellPx) / 2, gy = (rh - ch * cellPx) / 2;
    const [sx, sy, sw, sh] = typeof cropCoordsForDims === 'function' ? cropCoordsForDims(srcW, srcH, rw, rh) : [0, 0, srcW, srcH];
    // Memoria: la de la cámara propia la comparten visor, foto y video (la foto sale como se veía).
    const key = (o.own ? 'cam' : (o.path || 'preview')) + ':' + cw + 'x' + ch;
    const audio = o.audio || null;
    let flip = false, pulse = 0;
    try {
      const slot = slotFor(key, cw, ch);
      const fresh = slot.frames === 0 || started - slot.at > 450 || slot.mirror !== !!mirror;
      // El golpe: 120 ms con las diagonales cruzadas y un destello del fósforo.
      if (audio && audio.beats != null && audio.beats !== slot.beats) { if (slot.beats) slot.flipUntil = now + 120; slot.beats = audio.beats; }
      flip = now < slot.flipUntil;
      pulse = audio ? clamp(audio.beat || 0) * 0.35 : 0;
      const grow = audio ? clamp(audio.mid || 0) * 0.05 : 0;
      const usePerson = !!o.sujeto && personMask(source, sx, sy, sw, sh, mirror);
      if (!o.sujeto) person.phase = '';

      if (canvas.width < w || canvas.height < h) {
        // (una foto grande: el lienzo crece para ella y vuelve a su tamaño después)
        if (o.own && o.path === 'capture' && !o.motion) slot.restore = [canvas.width, canvas.height];   // (STAGE y PORTAL también dicen «capture»: esos no)
        canvas.width = Math.max(canvas.width, w); canvas.height = Math.max(canvas.height, h);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      const a = slot.turn, b = 1 - a;
      const origin = [-gx / rw, -gy / rh], span = [cellPx / rw, cellPx / rh];
      // 1 · celda
      let p = res.cell;
      pass(p, slot.cell[b], cw, ch);
      bind(0, res.src, p.u.uSrc); bind(1, slot.cell[a], p.u.uPrev);
      if (mirror) gl.uniform4f(p.u.uCrop, (sx + sw) / srcW, sy / srcH, -sw / srcW, sh / srcH);
      else gl.uniform4f(p.u.uCrop, sx / srcW, sy / srcH, sw / srcW, sh / srcH);
      gl.uniform2f(p.u.uCells, cw, ch); gl.uniform2fv(p.u.uOrigin, origin); gl.uniform2fv(p.u.uSpan, span);
      gl.uniform1f(p.u.uFresh, fresh ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 2 · gradiente
      p = res.grad;
      pass(p, slot.grad, cw, ch);
      bind(0, slot.cell[b], p.u.uCell);
      gl.uniform2f(p.u.uCells, cw, ch);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 3 · estado
      p = res.state;
      pass(p, slot.state[b], cw, ch);
      bind(0, slot.grad, p.u.uGrad); bind(1, slot.cell[b], p.u.uCell); bind(2, slot.state[a], p.u.uPrev);
      gl.uniform2f(p.u.uCells, cw, ch);
      gl.uniform1f(p.u.uThr, clamp(o.flujo == null ? 0.22 : o.flujo, 0.05, 0.95));
      gl.uniform1f(p.u.uFresh, fresh ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 4 · mayoría
      p = res.major;
      pass(p, slot.maj, cw, ch);
      bind(0, slot.state[b], p.u.uState);
      gl.uniform2f(p.u.uCells, cw, ch);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 5 · enlaces
      p = res.links;
      pass(p, slot.links, cw, ch);
      bind(0, slot.maj, p.u.uState); bind(1, res.mask, p.u.uMask);
      gl.uniform2f(p.u.uCells, cw, ch); gl.uniform1f(p.u.uFlip, flip ? 1 : 0); gl.uniform1f(p.u.uUseMask, usePerson ? 1 : 0);
      gl.uniform2fv(p.u.uOrigin, origin); gl.uniform2fv(p.u.uSpan, span);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 6 · dibujo: primero a un cuarto (para el resplandor), emborronado en dos vueltas; luego al
      //     tamaño del dibujo, en la esquina inferior izquierda del lienzo, con el resplandor sumado.
      const glow = clamp(o.halo == null ? 0.55 : o.halo, 0, 1.5);
      const [bA, bB] = bloomFor(w, h), bw = res.bw, bh = res.bh, q = bw / w;
      const draw = (target, W, H, scale, bloomTex, amount) => {
        const d = res.draw;
        pass(d, target, W, H);
        bind(0, slot.links, d.u.uLinks); bind(1, bloomTex, d.u.uBloom);
        gl.uniform2f(d.u.uCells, cw, ch); gl.uniform2f(d.u.uOut, W, H);
        gl.uniform4f(d.u.uRect, strip * scale, 0, rw * scale, rh * scale); gl.uniform2f(d.u.uGrid, gx * scale, gy * scale); gl.uniform1f(d.u.uCellPx, cellPx * scale);
        gl.uniform3fv(d.u.uBg, pal.bg); gl.uniform3fv(d.u.uHaloC, pal.halo); gl.uniform3fv(d.u.uBody, pal.body); gl.uniform3fv(d.u.uCore, pal.core);
        gl.uniform1f(d.u.uGlow, glow); gl.uniform1f(d.u.uGrow, grow); gl.uniform1f(d.u.uPulse, pulse); gl.uniform1f(d.u.uBloomAmt, amount);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      draw(bA, bw, bh, q, res.black, 0);
      for (const [from, to, sx2, sy2] of [[bA, bB, 1, 0], [bB, bA, 0, 1], [bA, bB, 2.2, 0], [bB, bA, 0, 2.2]]) {
        pass(res.blur, to, bw, bh);
        bind(0, from, res.blur.u.uTex);
        gl.uniform2f(res.blur.u.uStep, sx2 / bw, sy2 / bh);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      draw(null, w, h, 1, bA, glow * 0.24);
      gl.activeTexture(gl.TEXTURE0);
      ctx.save();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(canvas, 0, canvas.height - h, w, h, 0, 0, outW, outH);
      ctx.restore();
      slot.turn = b; slot.at = started; slot.frames++; slot.mirror = !!mirror;
      if (slot.restore) { canvas.width = slot.restore[0]; canvas.height = slot.restore[1]; slot.restore = null; }
      if (o.datos) { measure(source, sx, sy, sw, sh, now); drawData(ctx, strip / k, outH, pal.ink, audio, [cw, ch]); }
      stats.slot = key;
    } catch (error) {
      // Una fuente que aún no tiene imagen: este cuadro no se pinta, el siguiente sí.
      return !!gl;
    }
    const ms = performance.now() - started;
    Object.assign(stats, { frames: stats.frames + 1, ms, msAvg: stats.msAvg ? stats.msAvg * 0.9 + ms * 0.1 : ms, variant, cells: [cw, ch], cellPx: +(cellPx / k).toFixed(3), size: [w, h], person: person.phase, datos: !!o.datos, flip });
    return true;
  }

  // Soltar la gráfica cuando la cámara deja de usarse.
  function release() {
    if (!gl) return;
    const ext = gl.getExtension('WEBGL_lose_context');
    const old = canvas;
    slots.clear();
    gl = null; canvas = null; res = null;
    try { if (ext) ext.loseContext(); } catch (_) {}
    if (old) { old.width = 1; old.height = 1; }
  }

  // Para las pruebas: lo que decidió cada celda en el último cuadro (lectura de la gráfica: SOLO pruebas).
  function cells(key) {
    if (!gl) return null;
    const slot = slots.get(key || stats.slot);
    if (!slot) return null;
    const read = tex => { gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); const px = new Uint8Array(slot.cw * slot.ch * 4); gl.readPixels(0, 0, slot.cw, slot.ch, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return px; };
    const st = read(slot.state[slot.turn]), mj = read(slot.maj), ln = read(slot.links);
    const n = slot.cw * slot.ch, mode = new Array(n), raw = new Array(n), coh = new Array(n), linked = new Array(n);
    for (let i = 0; i < n; i++) { mode[i] = Math.round(mj[i * 4] / 85); raw[i] = Math.round(st[i * 4] / 85); coh[i] = +(st[i * 4 + 1] / 255).toFixed(3); linked[i] = (ln[i * 4 + 1] > 127 ? 1 : 0) + (ln[i * 4 + 2] > 127 ? 2 : 0); }
    // mode: lo que se ve (tras la mayoría); raw: lo que decidió cada celda con su memoria
    return { cw: slot.cw, ch: slot.ch, mode, raw, coh, linked };
  }

  window.renderMatriz = renderMatriz;
  window.flipMatriz = {
    release, cells, palettes: Object.keys(PALETTES),
    state: () => ({ ready: !!gl, failed, lost, slots: [...slots.keys()], ...stats, ms: +stats.ms.toFixed(2), msAvg: +stats.msAvg.toFixed(2), datos: { luz: +probe.luz.toFixed(3), coh: +probe.coh.toFixed(3), fps: probe.fps } }),
  };
})();
