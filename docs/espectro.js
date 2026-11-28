// FLIP · ESPECTRO: el colorizador de video de antes, sobre la cámara.
//
// Lo claro de la imagen se vuelve curvas de nivel gordas de arcoíris completo sobre negro total: la
// luz decide el matiz y lo recorre varias veces (2,5 vueltas de fábrica), en escalones; lo que no
// pasa la clave de luz queda negro. Encima, el aspecto de video compuesto de cinta:
//   · LÍNEAS   la imagen va en líneas de barrido gordas (un 1/84 del lado corto: 16 px en una
//              imagen de 1344), cada una con su luz.
//   · CROMA    el color tiene poco ancho de banda horizontal: se calcula en lóbulos de un 1/40 del
//              lado corto (34 px en 1344) y se estira entre ellos; por eso las manchas de color son
//              mucho más anchas que altas y se corren a la derecha del borde.
//   · SUBPORTADORA  rayitas verticales finas (un 1/168 del lado corto: 8 px en 1344) que cambian de
//              fase en cada línea.
//   · CORRIMIENTO  cada línea se corre un poco en horizontal, y las luces se arrastran a la derecha.
// Para que cualquier escena use el círculo de color entero, la luz se NORMALIZA dentro de lo que
// pasa la clave (percentiles del cuadro, seguidos en el tiempo) y se le suma su propio detalle de
// baja frecuencia: una cara o una pared casi planas también dan varias bandas.
//
//   renderEspectro(fuente, anchoFuente, altoFuente, ctx2d, espejo, variante, opciones) → false sin gráfica
//   variante: 'STD'
//   opciones (de 0 a 1): vueltas (0,5 → 2,5 vueltas de arcoíris), clave (0,3: la luz por debajo, a
//     negro), croma (0,6: ancho del lóbulo y fuerza de la subportadora), ciclo (0,3: lo que gira el
//     arcoíris por segundo); now, path, outW, outH, audio: { bass, mid, treble, beat }.
//   Sonido: los graves aceleran el giro (las curvas corren por la superficie), los medios suben las
//     vueltas, los agudos ensanchan el croma y el golpe abre la clave un instante.
(function () {
  'use strict';

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const FABRICA = { vueltas: 0.5, clave: 0.3, croma: 0.6, ciclo: 0.3 };
  const PASOS = 14;                 // escalones de matiz por vuelta
  // El arcoíris en sus escalones, limpio y saturado: rojos, naranjas, amarillos y verdes tan vivos
  // como el cian y el morado (en la referencia, la compresión los lava; el colorizador no).
  const PALETA = ['#F2352E', '#FF7A1A', '#F5D21A', '#A8F01C', '#34F02A', '#1CF08A', '#1CF0D8', '#26D0F5', '#3AA6F5', '#4A68F2', '#7A4AF2', '#B44AF2', '#E44AD8', '#F2468E'];
  // Las medidas de la referencia, en fracciones del lado corto (la referencia mide 1344 de ancho).
  const LINEA = 16 / 1344, LOBULO = 34 / 1344, SUBP = 8 / 1344;

  const VERT = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  // Convención de las texturas intermedias: v = 0 es la línea de ARRIBA (así escribe una pasada a
  // textura con vUv y así llega la fuente sin voltear).
  const HEAD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
`;
  // 1 · Las líneas de barrido: una fila de textura por línea, con la luz media de la línea (tres
  //     lecturas en vertical y dos en horizontal).
  const LINES = HEAD + `
uniform sampler2D uSrc; uniform vec4 uCrop; uniform vec2 uStep;
vec3 S(vec2 uv) { return texture2D(uSrc, uCrop.xy + clamp(uv, 0.0, 1.0) * uCrop.zw).rgb; }
void main() {
  vec2 uv = vUv;
  float l = 0.0;
  for (int j = 0; j < 3; j++) for (int i = 0; i < 2; i++)
    l += luma(S(uv + vec2((float(i) - 0.5) * 0.5 * uStep.x, (float(j) - 1.0) * 0.33 * uStep.y)));
  gl_FragColor = vec4(vec3(l / 6.0), 1.0);
}`;
  // 2 · La luz de baja frecuencia (para el detalle propio): reducir con filtro, dos veces.
  const DOWN = HEAD + `
uniform sampler2D uTex; uniform vec2 uStep;
void main() {
  float l = texture2D(uTex, vUv + uStep * vec2(-0.25, -0.25)).r + texture2D(uTex, vUv + uStep * vec2(0.25, -0.25)).r
          + texture2D(uTex, vUv + uStep * vec2(-0.25, 0.25)).r + texture2D(uTex, vUv + uStep * vec2(0.25, 0.25)).r;
  gl_FragColor = vec4(vec3(l * 0.25), 1.0);
}`;
  // 3 · El croma, en lóbulos: la luz media del lóbulo, normalizada dentro de lo que pasa la clave,
  //     con su detalle de baja frecuencia sumado → matiz = vueltas × luz + giro, en escalones. Se
  //     guarda como vector de color (coseno, seno) para que el filtro lo estire entre lóbulos.
  const CHROMA = HEAD + `
uniform sampler2D uLines; uniform sampler2D uLow;
uniform float uTaps, uKey, uLo, uHi, uDetail, uTurns, uPhase, uNoise, uSeed, uTexture; uniform vec2 uSize;
void main() {
  float l = 0.0;
  for (int i = 0; i < 4; i++) l += texture2D(uLines, vec2(vUv.x + (float(i) - 1.5) * uTaps, vUv.y)).r;
  l *= 0.25;
  float low = texture2D(uLow, vUv).r;
  float n = (l - uLo) / max(uHi - uLo, 0.04) + uDetail * (l - low) / max(uHi - uLo, 0.04);
  // textura propia de la luz (fija, más fina que el lóbulo) y ruido de cinta por lóbulo: las
  // fronteras entre escalones salen dentadas, con ladrillos de uno y otro lado
  vec2 tp = vUv * uSize * vec2(2.0, 1.0), ti = floor(tp), tf = fract(tp);
  float vn = mix(mix(hash12(ti), hash12(ti + vec2(1.0, 0.0)), tf.x), mix(hash12(ti + vec2(0.0, 1.0)), hash12(ti + vec2(1.0, 1.0)), tf.x), tf.y);
  n += uTexture * (vn - 0.5);
  n += uNoise * (hash12(floor(vUv * uSize) + uSeed) - 0.5);
  float h = fract(n * uTurns + uPhase);
  h = floor(h * ${PASOS}.0 + 0.5) / ${PASOS}.0;
  float a = 6.2831853 * h;
  float on = smoothstep(uKey - 0.02, uKey + 0.02, l);
  gl_FragColor = vec4(0.5 + 0.5 * on * cos(a), 0.5 + 0.5 * on * sin(a), on, 1.0);
}`;
  // 4 · El cuadro: línea a línea, con su corrimiento. La luz va en líneas finas (un tercio de la
  //     línea de croma) y, con el arrastre de las luces hacia la derecha, decide la clave; el croma,
  //     retrasado y estirado entre lóbulos y entre líneas, da el matiz: cada lóbulo cae en un
  //     escalón de la paleta y entre uno y otro el color pasa en un tramo corto (no en degradado).
  //     Brillo y saturación altos; la subportadora encima.
  const FINAL = HEAD + `
uniform sampler2D uLines; uniform sampler2D uChroma;
uniform vec2 uRes; uniform float uLp, uNl, uNf, uKey, uJit, uT, uDelay, uSmear, uPsc, uSub, uSeed, uComb;
uniform vec3 uPal[${PASOS}];
vec3 palAt(float k) {
  vec3 c = uPal[0];
  for (int i = 1; i < ${PASOS}; i++) if (abs(float(i) - k) < 0.5) c = uPal[i];
  return c;
}
vec3 pal(float h) {
  float x = fract(h) * ${PASOS}.0, k = floor(x), f = x - k;
  return mix(palAt(k), palAt(mod(k + 1.0, ${PASOS}.0)), smoothstep(0.3, 0.7, f));
}
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  float line = floor(px.y / uLp);
  float fine = floor(px.y / uLp * 3.0);
  // corrimiento por línea: un temblor que cambia 12 veces por segundo, y de vez en cuando una
  // línea que se va más lejos
  float j = (hash12(vec2(line, uSeed)) - 0.5) * 2.0;
  float far = step(0.985, hash12(vec2(line * 1.7, uSeed + 3.1)));
  // y el peine de las dos mitades del cuadro entrelazado: una línea sí y otra no se corren al revés
  // (los bordes de las bandas salen en zigzag)
  float comb = (mod(line, 2.0) - 0.5) * uComb * (0.7 + 0.3 * sin(uT * 1.3 + line * 0.07));
  float x = px.x + uJit * (j + far * 2.5 * sign(j)) + comb;
  float u = x / uRes.x;
  float yf = (fine + 0.5) / uNf;
  float l = texture2D(uLines, vec2(u, yf)).r;
  // las luces se arrastran a la derecha (el borde se corre en horizontal)
  float ls = max(l, max(0.82 * texture2D(uLines, vec2(u - uSmear, yf)).r, 0.6 * texture2D(uLines, vec2(u - 2.0 * uSmear, yf)).r));
  float on = smoothstep(uKey - 0.015, uKey + 0.015, ls);
  // el croma va por líneas (cada una con su corrimiento) y solo se funde con la vecina en el borde
  float fy = fract(px.y / uLp);
  vec3 c = mix(texture2D(uChroma, vec2(u - uDelay, (line + 0.5) / uNl)).rgb, texture2D(uChroma, vec2(u - uDelay, (line + 1.5) / uNl)).rgb, smoothstep(0.75, 1.0, fy) * 0.5);
  vec2 v = c.rg * 2.0 - 1.0;
  // al salir de la figura el croma se apaga antes que la luz (el lóbulo es ancho): el borde se lava
  // hacia el blanco, como en la cinta; dentro, saturación a tope
  vec3 col = length(v) < 0.05 ? vec3(0.86) : mix(vec3(0.86), pal(atan(v.y, v.x) / 6.2831853), smoothstep(0.02, 0.25, c.b));
  float sub = 1.0 - uSub * (0.5 + 0.5 * sin(6.2831853 * px.x / uPsc + line * 3.14159));
  float gap = 1.0 - 0.05 * smoothstep(0.8, 1.0, fy);
  // (la subportadora y el borde de línea oscurecen un poco de media: se devuelve)
  gl_FragColor = vec4(min(col * on * sub * gap * (1.0 + 0.5 * uSub), 1.0), 1.0);
}`;

  const PAL = new Float32Array(PALETA.flatMap(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16) / 255)));
  let canvas = null, gl = null, failed = false, lost = 0, res = null;
  const S = { last: null, t: 0, phase: 0, giro: 0, previewReal: -1e9, beat: 0, fps: 0, lo: null, hi: null };
  const stats = { frames: 0, ms: 0, size: [0, 0], lineas: [0, 0], lobulo: 0, linea: 0, subportadora: 0, lo: 0, hi: 0, clave: 0, vueltas: 0 };
  const SC = { canvas: null, ctx: null, at: -1e9 };

  function program(frag) {
    const make = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('ESPECTRO: ' + gl.getShaderInfoLog(shader));
      return shader;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('ESPECTRO: ' + gl.getProgramInfoLog(prog));
    const u = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) { const name = gl.getActiveUniform(prog, i).name; u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(prog, name); }
    return { prog, u };
  }
  function texture(filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  function target(w, h) {
    const t = { tex: texture(gl.LINEAR), fbo: gl.createFramebuffer(), w, h };
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    return t;
  }
  function sized(key, w, h) {
    const t = res.targets[key];
    if (t && t.w === w && t.h === h) return t;
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    return (res.targets[key] = target(w, h));
  }
  function init() {
    if (gl) return true;
    if (failed) return false;
    try {
      canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
      gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('ESPECTRO: sin WebGL');
      // Si el sistema retira la gráfica (al volver de segundo plano), la siguiente vuelta la rehace.
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost++; gl = null; canvas = null; res = null; });
      res = { lines: program(LINES), down: program(DOWN), chroma: program(CHROMA), final: program(FINAL), src: texture(gl.LINEAR), targets: {} };
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

  // ── La normalización ─────────────────────────────────────────────────────────────────────
  // Cada 100 ms el cuadro se reduce a 64 puntos de lado y se mira la luz de lo que pasa la clave: el
  // 4 % más oscuro y el 3 % más claro marcan el rango que recorre el arcoíris. Se sigue en el tiempo
  // (un cuarto de segundo) para que no bombee.
  function sceneRange(source, crop, key, now, cold) {
    if (!cold && SC.range && now >= SC.at && now - SC.at < 100) return SC.range;
    const [sx, sy, sw, sh] = crop, long = 64;
    const pw = sw >= sh ? long : Math.max(8, Math.round(long * sw / sh)), ph = sw >= sh ? Math.max(8, Math.round(long * sh / sw)) : long;
    if (!SC.canvas) { SC.canvas = document.createElement('canvas'); SC.ctx = SC.canvas.getContext('2d', { willReadFrequently: true }); }
    if (SC.canvas.width !== pw || SC.canvas.height !== ph) { SC.canvas.width = pw; SC.canvas.height = ph; }
    let d;
    try { SC.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, pw, ph); d = SC.ctx.getImageData(0, 0, pw, ph).data; } catch (_) { return SC.range || [key, 1]; }
    const L = [];
    for (let i = 0; i < pw * ph; i++) { const l = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255; if (l > key) L.push(l); }
    let lo = key, hi = Math.min(1, key + 0.3);
    if (L.length > 8) { L.sort((a, b) => a - b); lo = Math.max(key, L[Math.floor(0.04 * (L.length - 1))]); hi = L[Math.floor(0.97 * (L.length - 1))]; }
    if (hi - lo < 0.06) hi = Math.min(1.2, lo + 0.06);          // (un cuadro de una sola luz: el rango mínimo)
    SC.at = now;
    SC.range = [lo, hi];
    return SC.range;
  }

  function audioOf(o, dt) {
    const a = o.audio || null;
    const bass = a ? clamp(num(a.bass, 0)) : 0, mid = a ? clamp(num(a.mid, 0)) : 0, treble = a ? clamp(num(a.treble, num(a.high, 0))) : 0;
    const hit = a ? (typeof a.beat === 'number' ? clamp(a.beat) : a.beat ? 1 : 0) : 0;
    S.beat = Math.max(S.beat * Math.exp(-dt / 0.16), hit);
    return { bass, mid, treble, beat: S.beat };
  }

  function renderEspectro(source, srcW, srcH, ctx, mirror, variant, options) {
    const o = options || {};
    const W = Math.max(1, Math.round(o.outW || ctx.canvas.width)), H = Math.max(1, Math.round(o.outH || ctx.canvas.height));
    if (!W || !H || !srcW || !srcH || !init()) return false;
    const started = performance.now(), now = num(o.now, started);
    const path = o.path === 'capture' ? 'capture' : 'preview';
    // Reloj: el visor manda (la foto sale con el arcoíris del instante; la grabación solo avanza si
    // no hay visor). El giro se acumula, así que los graves lo aceleran sin saltos.
    let dt = S.last == null ? 0 : (now - S.last) / 1000;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.25);
    const lead = path === 'preview' || started - S.previewReal > 500;
    if (lead) S.last = now;
    if (path === 'preview') { if (dt > 0) S.fps = S.fps ? S.fps * 0.9 + 0.1 / dt : 1 / dt; S.previewReal = started; }
    const au = audioOf(o, lead ? dt : 0);
    const vueltas = clamp(num(o.vueltas, FABRICA.vueltas)), clave = clamp(num(o.clave, FABRICA.clave));
    const croma = clamp(num(o.croma, FABRICA.croma)), ciclo = clamp(num(o.ciclo, FABRICA.ciclo));
    const speed = (0.03 + 0.55 * ciclo) * (1 + 2 * au.bass);       // vueltas de arcoíris por segundo
    if (lead) { S.phase = (S.phase + dt * speed) % 1; S.giro += dt * speed; S.t += dt; }
    if (S.last == null || S.phase == null) S.phase = 0;
    const turns = 1 + 3 * clamp(vueltas + 0.3 * au.mid);           // 2,5 de fábrica
    const key = clamp(0.06 + 0.7 * clave - 0.12 * au.beat, 0.02, 0.95);
    const cr = clamp(croma + 0.3 * au.treble);

    const short = Math.min(W, H);
    const Lp = Math.max(2, short * LINEA);                  // alto de la línea, en píxeles de salida
    const nl = Math.max(4, Math.ceil(H / Lp));                   // líneas de croma
    const nf = nl * 3;                                            // líneas de luz (finas)
    const lw = Math.max(16, Math.ceil(W / 2));
    const lobe = Math.max(4, short * LOBULO * (0.55 + 0.75 * cr));   // ancho del lóbulo de croma, px
    const cw = Math.max(4, Math.ceil(W / lobe));                  // un texel de croma por lóbulo
    const psc = Math.max(2, short * SUBP);                  // periodo de la subportadora, px
    const crop = typeof cropCoordsForDims === 'function' ? cropCoordsForDims(srcW, srcH, W, H) : [0, 0, srcW, srcH];
    const [sx, sy, sw, sh] = crop;
    const cropU = mirror ? [(sx + sw) / srcW, sy / srcH, -sw / srcW, sh / srcH] : [sx / srcW, sy / srcH, sw / srcW, sh / srcH];
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (error) {
      return !!gl;                                                 // una fuente sin imagen todavía: el siguiente cuadro
    }
    // el rango de la luz (lo mide el visor; la foto usa el del visor si está vivo)
    const cold = S.lo == null;
    if (path === 'preview' || !S.lo || started - S.previewReal > 500) {
      const [lo, hi] = sceneRange(source, crop, key, now, cold);
      const k = cold ? 1 : 1 - Math.exp(-dt / 0.25);
      S.lo = cold ? lo : S.lo + (lo - S.lo) * k;
      S.hi = cold ? hi : S.hi + (hi - S.hi) * k;
    }
    const lo = Math.max(key, S.lo), hi = Math.max(lo + 0.06, S.hi);

    const lines = sized('lines', lw, nf);
    const lw4 = Math.max(4, Math.ceil(lw / 6)), nl4 = Math.max(2, Math.ceil(nf / 9));
    const lw16 = Math.max(2, Math.ceil(lw4 / 5)), nl16 = Math.max(2, Math.ceil(nl4 / 3));
    const low1 = sized('low1', lw4, nl4), low2 = sized('low2', lw16, nl16);
    const chroma = sized('chroma', cw, nl);
    if (canvas.width < W || canvas.height < H) { canvas.width = Math.max(canvas.width, W); canvas.height = Math.max(canvas.height, H); }
    const pass = (p, t, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null); gl.viewport(0, 0, t ? t.w : w, t ? t.h : h); gl.useProgram(p.prog); return p.u; };
    const bind = (unit, tex, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); };
    const draw = () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // 1 · Líneas.
    let u = pass(res.lines, lines);
    bind(0, res.src, u.uSrc);
    gl.uniform4fv(u.uCrop, cropU);
    gl.uniform2f(u.uStep, 1 / lw, 1 / nf);
    draw();
    // 2 · Luz de baja frecuencia.
    u = pass(res.down, low1); bind(0, lines.tex, u.uTex); gl.uniform2f(u.uStep, 1 / lw4, 1 / nl4); draw();
    u = pass(res.down, low2); bind(0, low1.tex, u.uTex); gl.uniform2f(u.uStep, 1 / lw16, 1 / nl16); draw();
    // 3 · Croma en lóbulos.
    u = pass(res.chroma, chroma);
    bind(0, lines.tex, u.uLines); bind(1, low2.tex, u.uLow);
    gl.uniform1f(u.uTaps, 1 / cw / 4);
    gl.uniform1f(u.uKey, key);
    gl.uniform1f(u.uLo, lo); gl.uniform1f(u.uHi, hi);
    gl.uniform1f(u.uDetail, 0.9);
    gl.uniform1f(u.uTurns, turns);
    gl.uniform1f(u.uPhase, S.phase);
    gl.uniform1f(u.uNoise, 0.02 * (0.5 + cr));
    gl.uniform1f(u.uTexture, 0.05);
    gl.uniform1f(u.uSeed, Math.floor(S.t * 12) % 1000);
    gl.uniform2f(u.uSize, cw, nl);
    draw();
    // 4 · El cuadro.
    u = pass(res.final, null, W, H);
    bind(0, lines.tex, u.uLines); bind(1, chroma.tex, u.uChroma);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uLp, Lp); gl.uniform1f(u.uNl, nl); gl.uniform1f(u.uNf, nf);
    gl.uniform1f(u.uKey, key);
    gl.uniform1f(u.uJit, short * 0.0022 * (0.4 + cr));
    gl.uniform1f(u.uSeed, Math.floor(S.t * 12) % 1000);
    gl.uniform1f(u.uT, S.t);
    gl.uniform1f(u.uComb, short * 0.026 * (0.5 + cr));
    gl.uniform1f(u.uDelay, 0.35 * lobe / W);
    gl.uniform1f(u.uSmear, short * 0.006 / W);
    gl.uniform1f(u.uPsc, psc);
    gl.uniform1f(u.uSub, 0.06 + 0.12 * cr);
    gl.uniform3fv(u.uPal, PAL);
    draw();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.drawImage(canvas, 0, canvas.height - H, W, H, 0, 0, W, H);
    ctx.restore();
    Object.assign(stats, { frames: stats.frames + 1, ms: performance.now() - started, size: [W, H], lineas: [lw, nl], lobulo: +lobe.toFixed(2), linea: +Lp.toFixed(2), subportadora: +psc.toFixed(2), lo: +lo.toFixed(3), hi: +hi.toFixed(3), clave: +key.toFixed(3), vueltas: +turns.toFixed(2), fase: +S.phase.toFixed(4), giro: +S.giro.toFixed(4) });
    return true;
  }

  // Soltar la gráfica cuando la cámara deja de usarse.
  function release() {
    // (el rango de luz y el reloj se olvidan siempre, también si la gráfica ya se había perdido)
    S.lo = S.hi = null; S.last = null; SC.range = null;
    if (!gl) return;
    const ext = gl.getExtension('WEBGL_lose_context');
    const old = canvas;
    gl = null; canvas = null; res = null;
    try { if (ext) ext.loseContext(); } catch (_) {}
    if (old) { old.width = 1; old.height = 1; }
  }

  window.renderEspectro = renderEspectro;
  window.flipEspectro = {
    FABRICA, PASOS, PALETA: PALETA.slice(), release,
    state: () => ({ gl: !!gl, failed, lost, canvas: canvas ? [canvas.width, canvas.height] : null, fps: +S.fps.toFixed(1), beat: +S.beat.toFixed(3), ...stats, ms: +stats.ms.toFixed(2) }),
  };
})();
