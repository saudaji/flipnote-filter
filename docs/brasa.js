// FLIP · BRASA: el retrato que arde.
//
// La imagen se lee solo por su luz y se lleva a una rampa térmica de cuatro paradas (carbón →
// siena → oro → blanco azufre). Encima, cuatro cosas que la hacen arder:
//   · ARRASTRE  las luces se corren en hebras horizontales: por bandas de renglones, a ráfagas, y
//               solo lo que pasa de un umbral de luz (no es ordenar píxeles: es un arrastre de 12
//               lecturas a media resolución, que cuesta poco y se ve igual).
//   · ARDOR     resplandor en pirámide (un cuarto y un dieciseisavo), más alto que ancho: las luces
//               reventadas sueltan un haz vertical.
//   · TEXTO     renglones de letra diminuta como trama, solo en los medios tonos (desaparecen en el
//               negro y se queman en el oro), con cortes y saltos por renglón. Son un atlas de
//               renglones ya compuestos, pintado una vez: una lectura por píxel, letra proporcional
//               al cuadro y texto propio de FLIP sobre luz y óptica.
//   · REJILLA   rejilla ortogonal de un 1/180 del ancho (5 px en una imagen de 900; nunca menos
//               de 3 px), con surcos de un píxel y un tramado suave.
// Con MARCO, la imagen va dentro de una ventana de programa de mapa de bits, de diseño propio:
// bisel, título BRASA.FLIP con tres botoncitos, menú (LUZ · TRAMA · VER · AYUDA) y barra de estado
// con un texto que corre (y la telemetría: tamaño, cuadros por segundo) y la hora.
//
//   renderBrasa(fuente, anchoFuente, altoFuente, ctx2d, espejo, variante, opciones) → false sin gráfica
//   variante: 'ARDOR' (de fábrica) o 'CENIZA' (la misma rampa en gris ceniza)
//   opciones (de 0 a 1): arrastre, texto, ardor, rejilla; marco (booleano); now, path, outW, outH,
//     audio: { bass, mid, treble, beat }; rostro: true protege la cara del arrastre (la pide a
//     flipSilhouette, o la toma de mask.faces si viene una máscara).
(function () {
  'use strict';

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const FABRICA = { arrastre: 0.45, texto: 0.70, ardor: 0.65, rejilla: 0.55 };
  const RAMPAS = {
    ARDOR: ['#140906', '#6B3D2B', '#D8AE5D', '#FFF6BE'],
    CENIZA: ['#0E0D0C', '#4A4440', '#A9A096', '#F2EEE6'],
  };
  const PARADAS = [0, 0.32, 0.70, 1];
  const FUENTE = 'IBM Plex Mono';          // la cargan ya las pantallas de la app; sin ella, monoespaciada
  // El texto de la trama: propio, sobre luz, óptica y cámara.
  const RENGLONES = [
    'La luz llega tarde a todo: lo que miras ya pasó hace un instante.',
    'Un lente no inventa nada; solo decide qué rayos se juntan y cuáles se pierden.',
    'El diafragma abierto deja entrar la noche entera por un agujero pequeño.',
    'Cada píxel guarda una cuenta de fotones, nada más, y aun así recuerda.',
    'La sombra también es luz: la que no alcanzó a llegar.',
    'En el sensor la tarde se vuelve números y los números vuelven a ser tarde.',
    'El grano aparece cuando la luz escasea y la cámara tiene que adivinar.',
    'Enfocar es escoger una distancia y dejar que el resto se derrita.',
    'El obturador corta el tiempo en rebanadas de un milésimo de segundo.',
    'Las altas luces se queman primero, como el papel cerca de la llama.',
    'Un prisma separa lo que el ojo cree que es uno solo.',
    'El blanco no existe por sí mismo: es la suma de todo lo que rebota.',
    'La exposición larga junta en una sola imagen todo lo que se movió.',
    'Medir la luz es aprender a dudar de lo que parece claro.',
    'El ruido del sensor es la cámara pensando en voz alta.',
    'Una ventana es el primer lente de la casa.',
    'Al atardecer la luz viaja de lado y alarga cada cosa hasta su sombra.',
    'El contraluz recorta la figura y le cambia el rostro por un contorno.',
    'La retina tarda en olvidar: por eso las imágenes en fila se mueven.',
    'Lo que brilla demasiado deja una huella verde al cerrar los ojos.',
    'El vidrio dobla la luz un poco y con eso basta para cambiar el mundo.',
    'Toda foto es un acuerdo entre lo que hubo y lo que cupo.',
    'La distancia focal decide si la montaña te queda cerca o lejos.',
    'Un reflejo es una imagen que nadie tomó y que sin embargo está ahí.',
    'El balance de blancos le pregunta a la luz de dónde viene.',
    'Las velas pintan naranja; la pantalla, azul; la luna, casi nada.',
    'Entre dos cuadros cabe todo lo que no se ve.',
    'El polvo en el haz de luz enseña el camino del rayo.',
    'Sobreexponer es confiar demasiado; subexponer, guardar un secreto.',
    'La cámara no ve colores: ve tres cantidades y las mezcla.',
    'Cerca de la fuente la luz es dura; lejos, se vuelve suave.',
    'El destello del lente es la luz chocando consigo misma.',
    'Revelar es esperar a que aparezca lo que ya estaba.',
    'Una imagen quieta guarda el temblor de quien la tomó.',
    'La noche no es negra: es luz demasiado débil para contarla.',
    'El brillo se mide en pasos; cada paso duplica o reparte la luz.',
    'Mirar por el visor es encerrar el mundo en un rectángulo y aceptarlo.',
    'Los ojos ajustan su apertura sin pedir permiso.',
    'El color de una cosa es lo que esa cosa no quiso guardar.',
    'Al final, toda fotografía es una forma de detener la luz un momento.',
  ];

  const VERT = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  // Texturas intermedias: v = 0 es la fila de arriba (así escribe una pasada a textura con vUv).
  const HEAD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float inBox(vec2 p, vec4 b) { return step(b.x, p.x) * step(p.x, b.z) * step(b.y, p.y) * step(p.y, b.w); }
`;
  // 1 · Media resolución con el arrastre: cada píxel mira hacia atrás en su renglón (12 lecturas)
  //     y se queda con la luz que pasa del umbral, más débil cuanto más lejos. Ráfagas por banda
  //     de renglones, que cambian 8 veces por segundo; el golpe enciende varias bandas a la vez.
  const SMEAR = HEAD + `
uniform sampler2D uSrc; uniform vec4 uCrop; uniform vec2 uRes; uniform vec2 uStep; uniform float uSmear, uT8, uBurst, uBurstSeed; uniform vec4 uFace;
vec3 S(vec2 uv) { return texture2D(uSrc, uCrop.xy + uv * uCrop.zw).rgb; }
void main() {
  vec2 uv = vUv;
  vec3 base = 0.25 * (S(uv + uStep * vec2(-0.25, -0.25)) + S(uv + uStep * vec2(0.25, -0.25)) + S(uv + uStep * vec2(-0.25, 0.25)) + S(uv + uStep * vec2(0.25, 0.25)));
  float l0 = luma(base);
  float burst = smoothstep(1.0 - uSmear * 0.75, 1.0, hash12(vec2(floor(uv.y * uRes.y * 0.5), uT8)));
  burst = max(burst, uBurst * step(0.7, hash12(vec2(floor(uv.y * 14.0), uBurstSeed))));
  float dir = hash12(vec2(floor(uv.y * 24.0), 7.1)) > 0.5 ? 1.0 : -1.0;
  float amt = uSmear * (1.0 - 0.6 * inBox(uv, uFace));
  vec3 sm = base; float best = l0;
  if (amt > 0.004) {
    float span = (0.04 + 0.18 * burst) * amt;
    for (int i = 1; i <= 12; i++) {
      float f = float(i) / 12.0;
      vec3 s = S(vec2(clamp(uv.x - dir * f * span, 0.0, 1.0), uv.y));
      float ls = luma(s);
      float w = smoothstep(0.52, 0.82, ls) * (1.0 - f * 0.78);
      if (ls * w > best * 0.92) { sm = mix(sm, s, w * 0.85); best = max(best, ls * w); }
    }
  }
  gl_FragColor = vec4(sm, l0);
}`;
  // 2 · Las luces que desbordan, a un cuarto.
  const BRIGHT = HEAD + `
uniform sampler2D uTex; uniform vec2 uStep;
void main() {
  float l = 0.25 * (luma(texture2D(uTex, vUv + uStep * vec2(-0.25, -0.25)).rgb) + luma(texture2D(uTex, vUv + uStep * vec2(0.25, -0.25)).rgb)
                  + luma(texture2D(uTex, vUv + uStep * vec2(-0.25, 0.25)).rgb) + luma(texture2D(uTex, vUv + uStep * vec2(0.25, 0.25)).rgb));
  gl_FragColor = vec4(vec3(smoothstep(0.5, 1.0, l) * (0.5 + l)), 1.0);
}`;
  const DOWN = HEAD + `
uniform sampler2D uTex; uniform vec2 uStep;
void main() {
  vec3 c = texture2D(uTex, vUv + uStep * vec2(-0.25, -0.25)).rgb + texture2D(uTex, vUv + uStep * vec2(0.25, -0.25)).rgb
         + texture2D(uTex, vUv + uStep * vec2(-0.25, 0.25)).rgb + texture2D(uTex, vUv + uStep * vec2(0.25, 0.25)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;
  // Desenfoque gaussiano de 9 tomas en 5 lecturas lineales.
  const BLUR = HEAD + `
uniform sampler2D uTex; uniform vec2 uDir;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270270;
  c += (texture2D(uTex, vUv + uDir * 1.3846154).rgb + texture2D(uTex, vUv - uDir * 1.3846154).rgb) * 0.3162162;
  c += (texture2D(uTex, vUv + uDir * 3.2307692).rgb + texture2D(uTex, vUv - uDir * 3.2307692).rgb) * 0.0702703;
  gl_FragColor = vec4(c, 1.0);
}`;
  // 3 · El cuadro: luz → texto → rejilla → rampa, todo sobre la luz (así el color nunca sale de
  //     la rampa, salvo un leve halo cobrizo alrededor de las luces quemadas).
  const FINAL = HEAD + `
uniform sampler2D uSrc; uniform sampler2D uHalf; uniform sampler2D uB4; uniform sampler2D uB16; uniform sampler2D uAtlas;
uniform vec4 uCrop; uniform vec2 uRes; uniform vec4 uFace;
uniform float uUnit, uText, uArdor, uGrid, uT3, uJump, uScroll, uFlash, uDebug, uP, uGW, uTexel;
uniform vec3 uR0, uR1, uR2, uR3;
vec3 ramp(float x) {
  x = clamp(x, 0.0, 1.0);
  if (x < 0.32) return mix(uR0, uR1, x / 0.32);
  if (x < 0.70) return mix(uR1, uR2, (x - 0.32) / 0.38);
  return mix(uR2, uR3, (x - 0.70) / 0.30);
}
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 px = uv * uRes;
  vec3 src = texture2D(uSrc, uCrop.xy + uv * uCrop.zw).rgb;
  vec4 hf = texture2D(uHalf, uv);
  float L = smoothstep(0.03, 0.95, max(luma(src), luma(hf.rgb)));   // el arrastre solo aclara
  float glow = uArdor * (0.5 * texture2D(uB4, uv).r + 0.9 * texture2D(uB16, uv).r) * (1.0 + uFlash);
  // Texto: diminuto (medio píxel de salida por punto del atlas en un visor de 540: la letra se
  // queda en trama antes que en texto, como en la referencia), cada renglón con sus cortes y, a
  // ráfagas, un salto de lado.
  vec2 tp = px / uTexel;
  tp.x += uScroll;
  float rowId = floor(tp.y / 13.0);
  float bandRnd = hash12(vec2(rowId, uT3));
  float rowGate = smoothstep(0.18, 0.55, hash12(vec2(rowId, floor(tp.x / 170.0 + bandRnd * 4.0))));
  float jump = step(uJump, bandRnd) * (bandRnd - uJump) * 2.5 * 512.0;
  float ink = texture2D(uAtlas, vec2(tp.x + floor(tp.y / 512.0) * 316.4 + jump, tp.y) / 512.0).r;
  float bell = exp(-pow((L - 0.34) / 0.17, 2.0));                   // campana en los medios tonos
  float tm = bell * mix(0.25, 1.0, rowGate) * uText * (1.0 - 0.5 * inBox(uv, uFace));
  if (uDebug > 0.5) { gl_FragColor = vec4(vec3(ink * tm), 1.0); return; }
  float Lt = L + tm * (ink * 0.26 - 0.035);
  // Rejilla: celdas de píxeles enteros (un 1/180 del ancho, nunca menos de 3 px) separadas por un
  // surco oscuro de un píxel (o más, en una foto grande), y un tramado 2 × 2 por celda.
  vec2 lp = mod(floor(px), uP);
  float groove = max(step(uP - uGW, lp.x), step(uP - uGW, lp.y));
  Lt *= 1.0 - uGrid * 0.34 * groove;
  vec2 cell = floor(px / uP);
  Lt += (mod(mod(cell.x, 2.0) * 2.0 + mod(cell.y, 2.0) * 3.0, 4.0) / 4.0 - 0.375) * 0.04 * uGrid;
  float T = Lt + glow;
  vec3 col = ramp(T);
  col += vec3(0.66, 0.16, 0.09) * smoothstep(0.05, 0.5, texture2D(uB4, uv).r) * (1.0 - smoothstep(0.55, 1.0, T)) * 0.14 * uArdor;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

  let canvas = null, gl = null, failed = false, lost = 0, res = null;
  const S = { t: 0, scroll: 0, last: {}, previewReal: -1e9, beat: 0, beatSeed: 0, fps: 0 };
  const stats = { frames: 0, ms: 0, variant: '', size: [0, 0], image: [0, 0, 0, 0], half: [0, 0] };
  const atlas = { canvas: null, font: '', gen: 0, checkedAt: -1e9, wake: false, loadAsked: false, uploaded: null };
  let frame = { on: false };

  function program(frag) {
    const make = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('BRASA: ' + gl.getShaderInfoLog(shader));
      return shader;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('BRASA: ' + gl.getProgramInfoLog(prog));
    const u = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) { const name = gl.getActiveUniform(prog, i).name; u[name] = gl.getUniformLocation(prog, name); }
    return { prog, u };
  }
  function texture(filter, wrap) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap || gl.CLAMP_TO_EDGE);
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
      if (!gl) throw new Error('BRASA: sin WebGL');
      // Si el sistema retira la gráfica (al volver de segundo plano), la siguiente vuelta la rehace.
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost++; gl = null; canvas = null; res = null; atlas.uploaded = null; });
      res = {
        smear: program(SMEAR), bright: program(BRIGHT), down: program(DOWN), blur: program(BLUR), final: program(FINAL),
        src: texture(gl.LINEAR), atlas: texture(gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT), targets: {},
      };
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

  // ── El atlas de renglones ────────────────────────────────────────────────────────────────
  // ¿Ya cargó la letra de la app? (document.fonts.check da «sí» también cuando la letra no está
  // declarada: hay que buscar su cara y ver que esté cargada.)
  function fontReady() {
    if (typeof document === 'undefined' || !document.fonts) return false;
    for (const face of document.fonts) if (face.family.replace(/["']/g, '') === FUENTE && face.status === 'loaded') return true;
    return false;
  }
  function askFont() {
    if (atlas.loadAsked || typeof document === 'undefined' || !document.fonts) return;
    atlas.loadAsked = true;
    try { document.fonts.addEventListener('loadingdone', () => { atlas.wake = true; }); } catch (_) {}
    for (const weight of ['400', '600']) { try { document.fonts.load(weight + ' 10px "' + FUENTE + '"', 'Luz ñ').then(() => { atlas.wake = true; }, () => {}); } catch (_) {} }
  }
  function paintAtlas() {
    const ready = fontReady();
    if (!atlas.canvas) { atlas.canvas = document.createElement('canvas'); atlas.canvas.width = atlas.canvas.height = 512; }
    const g = atlas.canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#fff'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.font = '400 10px ' + (ready ? '"' + FUENTE + '", monospace' : 'monospace');
    // Renglones de largo desigual, con sangrías y algún renglón en blanco (fin de párrafo).
    let seed = 2911;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 8) / 16777216; };
    const words = RENGLONES.join(' ').split(' ');
    let wi = 0;
    for (let line = 0; line < 39; line++) {
      if (rnd() < 0.07) continue;
      const indent = rnd() < 0.18 ? 22 : 3, room = 512 * (0.5 + 0.5 * rnd()) - indent;
      let text = '';
      for (;;) {
        const next = text ? text + ' ' + words[wi % words.length] : words[wi % words.length];
        if (text && g.measureText(next).width > room) break;
        text = next; wi++;
        if (!text) break;
      }
      g.fillText(text, indent, 10 + line * 13);
    }
    atlas.font = ready ? FUENTE : 'monospace';
    atlas.gen++;
    atlas.uploaded = null;
  }
  function ensureAtlas(now) {
    askFont();
    if (!atlas.gen) paintAtlas();
    else if (atlas.font !== FUENTE && (atlas.wake || now - atlas.checkedAt > 400)) {
      atlas.checkedAt = now; atlas.wake = false;
      if (fontReady()) paintAtlas();                   // la letra llegó: se repinta con ella
    }
    if (atlas.uploaded !== res) {
      gl.bindTexture(gl.TEXTURE_2D, res.atlas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      atlas.uploaded = res;
    }
  }

  // ── El marco: una ventana de programa de mapa de bits, de diseño propio ────────────────────
  // Del género de las ventanas de computadora vieja: borde con bisel, barra de título con el
  // nombre y tres botoncitos, barra de menú, la imagen hundida y una barra de estado con un texto
  // que corre y la hora. Todo dibujado aquí y en los colores de la brasa (nada de grises ni azules
  // de ningún sistema), con la letra de píxel que ya carga la app (Pixelify Sans; si aún no está,
  // monoespaciada). Los botones llevan signos propios: un punto, un rombo y una llama.
  const PIXEL = 'Pixelify Sans';
  let pixelAsked = false;
  function pixelFont() {
    if (typeof document === 'undefined' || !document.fonts) return 'monospace';
    for (const face of document.fonts) if (face.family.replace(/["']/g, '') === PIXEL && face.status === 'loaded') return '"' + PIXEL + '", monospace';
    if (!pixelAsked) { pixelAsked = true; try { document.fonts.load('400 12px "' + PIXEL + '"').catch(() => {}); } catch (_) {} }
    return 'monospace';
  }
  const WIN = { face: '#5A3524', light: '#B98352', dark: '#170A06', mid: '#3A1E13', paper: '#E6CF9C', ink: '#2A140D', title: ['#1E0C07', '#6E3820', '#C07A33'], text: '#FFF0C2', button: '#8A5536', buttonLight: '#DDA86C' };
  const MENU = ['LUZ', 'TRAMA', 'VER', 'AYUDA'];
  function layout(W, H, marco) {
    if (!marco) return { x: 0, y: 0, w: W, h: H, marco: false };
    const u = Math.min(W, H) / 540;
    const b = Math.max(2, Math.round(3 * u)), tb = Math.max(14, Math.round(22 * u)), mb = Math.max(12, Math.round(19 * u)), sb = Math.max(13, Math.round(19 * u)), well = Math.max(1, Math.round(1.5 * u));
    const inner = W - 2 * b, ty = b, my = ty + tb, iy = my + mb + well, sy = H - b - sb;
    return { marco: true, u, b, tb, mb, sb, well, x: b + well, y: iy, w: inner - 2 * well, h: sy - well - iy, top: [b, ty, inner, tb], menu: [b, my, inner, mb], bottom: [b, sy, inner, sb] };
  }
  const two = n => String(n).padStart(2, '0');
  const hora = () => { const d = new Date(); return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()); };
  // Un rectángulo con bisel: claro arriba e izquierda, oscuro abajo y derecha (hundido, al revés).
  function bevel(ctx, x, y, w, h, t, sunken) {
    ctx.fillStyle = sunken ? WIN.dark : WIN.light;
    ctx.fillRect(x, y, w, t); ctx.fillRect(x, y, t, h);
    ctx.fillStyle = sunken ? WIN.light : WIN.dark;
    ctx.fillRect(x, y + h - t, w, t); ctx.fillRect(x + w - t, y, t, h);
  }
  function drawFrame(ctx, W, H, L, info) {
    const { u, b, tb, mb, sb, well } = L, font = pixelFont(), t = Math.max(1, Math.round(u));
    // cuerpo y bisel de la ventana
    ctx.fillStyle = WIN.face; ctx.fillRect(0, 0, W, L.y); ctx.fillRect(0, L.y + L.h, W, H - L.y - L.h); ctx.fillRect(0, 0, L.x, H); ctx.fillRect(L.x + L.w, 0, W - L.x - L.w, H);
    bevel(ctx, 0, 0, W, H, t, false);
    bevel(ctx, t, t, W - 2 * t, H - 2 * t, t, false);
    // barra de título: degradado de brasa, el sello de la rampa, el nombre y tres botones
    const [tx, ty, tw, th] = L.top, grad = ctx.createLinearGradient(tx, 0, tx + tw, 0);
    grad.addColorStop(0, WIN.title[0]); grad.addColorStop(0.6, WIN.title[1]); grad.addColorStop(1, WIN.title[2]);
    ctx.fillStyle = grad; ctx.fillRect(tx, ty, tw, th);
    const pad = Math.round(th * 0.3), sw = Math.max(2, Math.round(th * 0.2));
    for (let k = 0; k < 4; k++) { ctx.fillStyle = info.ramp[k]; ctx.fillRect(tx + pad + (k % 2) * sw, ty + Math.round(th / 2) - sw + Math.floor(k / 2) * sw, sw, sw); }
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = Math.max(8, Math.round(th * 0.68)) + 'px ' + font;
    ctx.fillStyle = WIN.text;
    ctx.fillText('BRASA.FLIP', tx + pad + 3 * sw, ty + th / 2 + 0.5);
    const bs = th - 2 * Math.max(2, Math.round(th * 0.14)), by = ty + Math.round((th - bs) / 2);
    for (let k = 0; k < 3; k++) {
      const bx = tx + tw - pad + 2 - (3 - k) * (bs + Math.max(1, Math.round(u)));
      ctx.fillStyle = WIN.button; ctx.fillRect(bx, by, bs, bs);
      ctx.fillStyle = WIN.buttonLight; ctx.fillRect(bx, by, bs, t); ctx.fillRect(bx, by, t, bs);
      ctx.fillStyle = WIN.dark; ctx.fillRect(bx, by + bs - t, bs, t); ctx.fillRect(bx + bs - t, by, t, bs);
      const cx = bx + bs / 2, cy = by + bs / 2, r = bs * 0.22;
      ctx.fillStyle = WIN.ink; ctx.beginPath();
      if (k === 0) ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
      else if (k === 1) { ctx.moveTo(cx, cy - r * 1.2); ctx.lineTo(cx + r * 1.2, cy); ctx.lineTo(cx, cy + r * 1.2); ctx.lineTo(cx - r * 1.2, cy); ctx.closePath(); }
      else { ctx.moveTo(cx, cy - r * 1.3); ctx.quadraticCurveTo(cx + r * 1.3, cy + r * 0.2, cx, cy + r * 1.2); ctx.quadraticCurveTo(cx - r * 1.3, cy + r * 0.2, cx, cy - r * 1.3); }
      ctx.fill();
    }
    // barra de menú, con la primera letra subrayada
    const [mx, my, mw, mh] = L.menu;
    ctx.fillStyle = WIN.paper; ctx.fillRect(mx, my, mw, mh);
    ctx.fillStyle = WIN.mid; ctx.fillRect(mx, my + mh - t, mw, t);
    const ms = Math.max(7, Math.round(mh * 0.7));
    ctx.font = ms + 'px ' + font; ctx.fillStyle = WIN.ink;
    let x = mx + pad;
    for (const word of MENU) {
      ctx.fillText(word, x, my + mh / 2 + 0.5);
      const fw = ctx.measureText(word[0]).width;
      ctx.fillRect(x, Math.round(my + mh / 2 + ms * 0.42), Math.max(2, Math.round(fw)), t);
      x += ctx.measureText(word).width + ms * 1.1;
    }
    // la imagen, hundida
    bevel(ctx, L.x - well, L.y - well, L.w + 2 * well, L.h + 2 * well, well, true);
    // barra de estado: el texto que corre (y la telemetría) y la hora en su casilla
    const [sx, sy, swd, sh] = L.bottom, gap = Math.max(2, Math.round(2 * u));
    ctx.font = Math.max(7, Math.round(sh * 0.66)) + 'px ' + font;
    const clockW = Math.ceil(ctx.measureText('00:00:00').width) + 2 * pad, run = [sx + gap, sy + gap, swd - clockW - 3 * gap, sh - 2 * gap], clock = [sx + swd - clockW - gap, sy + gap, clockW, sh - 2 * gap];
    for (const r of [run, clock]) { ctx.fillStyle = WIN.paper; ctx.fillRect(...r); bevel(ctx, r[0], r[1], r[2], r[3], t, true); }
    ctx.save();
    ctx.beginPath(); ctx.rect(run[0] + t, run[1] + t, run[2] - 2 * t, run[3] - 2 * t); ctx.clip();
    ctx.fillStyle = WIN.ink;
    const text = info.linea + '  +  ' + info.w + '×' + info.h + '  +  ' + info.fps + ' CPS  +  ARDOR ' + info.ardor + '  +  TEXTO ' + info.texto + '  +  ';
    const tw2 = Math.max(1, ctx.measureText(text).width), off = (info.t * 24 * u) % tw2;
    for (let x2 = run[0] + t - off; x2 < run[0] + run[2]; x2 += tw2) ctx.fillText(text, x2, run[1] + run[3] / 2 + 0.5);
    ctx.restore();
    ctx.textAlign = 'center'; ctx.fillStyle = WIN.ink;
    ctx.fillText(info.hora, clock[0] + clock[2] / 2, clock[1] + clock[3] / 2 + 0.5);
    ctx.textAlign = 'left';
    return clock;
  }

  function audioOf(o, dt) {
    const a = o.audio || null;
    const bass = a ? clamp(num(a.bass, 0)) : 0, mid = a ? clamp(num(a.mid, 0)) : 0, treble = a ? clamp(num(a.treble, num(a.high, 0))) : 0;
    const hit = a ? (typeof a.beat === 'number' ? clamp(a.beat) : a.beat ? 1 : 0) : 0;
    if (hit > S.beat + 0.3) S.beatSeed = (S.beatSeed + 1) % 997;     // cada golpe, otras bandas
    S.beat = Math.max(S.beat * Math.exp(-dt / 0.18), hit);
    return { bass, mid, treble, beat: S.beat };
  }
  // La cara (opcional): la caja más grande, en fracción del encuadre de la imagen.
  function faceBox(o, source, crop, mirror) {
    if (!o.rostro && !(o.mask && o.mask.faces)) return null;
    let faces = o.mask && o.mask.faces;
    if (!faces && typeof flipSilhouette !== 'undefined') {
      flipSilhouette.start();
      flipSilhouette.push(source, crop[0], crop[1], crop[2], crop[3], mirror, { faces: true });
      const m = flipSilhouette.latest(1200);
      faces = m && m.faces;
    }
    if (!faces || !faces.length) return null;
    let best = null, area = 0;
    for (const f of faces) { const a = (f[2] - f[0]) * (f[3] - f[1]); if (a > area) { area = a; best = f; } }
    return best;
  }

  const rgb = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
  function renderBrasa(source, srcW, srcH, ctx, mirror, variant, options) {
    const o = options || {};
    const W = Math.max(1, Math.round(o.outW || ctx.canvas.width)), H = Math.max(1, Math.round(o.outH || ctx.canvas.height));
    if (!W || !H || !srcW || !srcH || !init()) return false;
    const started = performance.now(), now = num(o.now, started);
    const path = o.path === 'capture' ? 'capture' : 'preview';
    const v = RAMPAS[variant] ? variant : 'ARDOR', ramp = RAMPAS[v];
    // Relojes: el visor manda (la grabación solo avanza si no hay visor).
    const last = S.last[path];
    S.last[path] = now;
    let dt = last == null ? 0 : (now - last) / 1000;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.1);
    if (path === 'preview') { if (dt > 0) S.fps = S.fps ? S.fps * 0.9 + 0.1 / dt : 1 / dt; S.previewReal = started; }
    const au = audioOf(o, dt);
    if ((path === 'preview' || started - S.previewReal > 500) && dt > 0) { S.t += dt; S.scroll += dt * 90 * au.mid; }   // los medios corren los renglones
    const arrastre = clamp(num(o.arrastre, FABRICA.arrastre)), texto = clamp(num(o.texto, FABRICA.texto));
    const ardor = clamp(num(o.ardor, FABRICA.ardor)), rejilla = clamp(num(o.rejilla, FABRICA.rejilla));
    const smear = clamp(arrastre * (1 + 0.9 * au.bass)), glowAmt = clamp(ardor + 0.35 * au.treble, 0, 1.3);

    const L = layout(W, H, o.marco === true);
    const iw = L.w, ih = L.h;
    if (iw < 8 || ih < 8) return false;
    const unit = Math.min(W, H) / 540;                     // la rejilla y la letra, proporcionales al cuadro
    const hk = Math.min(1, 960 / Math.max(iw / 2, ih / 2));
    const hw = Math.max(8, Math.round(iw / 2 * hk)), hh = Math.max(8, Math.round(ih / 2 * hk));
    const qw = Math.max(4, Math.round(hw / 2)), qh = Math.max(4, Math.round(hh / 2));
    const sw16 = Math.max(2, Math.round(qw / 4)), sh16 = Math.max(2, Math.round(qh / 4));
    const crop = typeof cropCoordsForDims === 'function' ? cropCoordsForDims(srcW, srcH, iw, ih) : [0, 0, srcW, srcH];
    const [sx, sy, sw, sh] = crop;
    const cropU = mirror ? [(sx + sw) / srcW, sy / srcH, -sw / srcW, sh / srcH] : [sx / srcW, sy / srcH, sw / srcW, sh / srcH];
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (error) {
      return !!gl;                                         // una fuente sin imagen todavía: el siguiente cuadro
    }
    ensureAtlas(now);
    const face = faceBox(o, source, crop, !!mirror);
    const faceU = face ? [face[0], face[1], face[2], face[3]] : [2, 2, -1, -1];
    const half = sized('half', hw, hh), q = sized('q', qw, qh), q2 = sized('q2', qw, qh), s16 = sized('s16', sw16, sh16), s16b = sized('s16b', sw16, sh16);
    if (canvas.width < iw || canvas.height < ih) { canvas.width = Math.max(canvas.width, iw); canvas.height = Math.max(canvas.height, ih); }
    const pass = (p, t, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null); gl.viewport(0, 0, t ? t.w : w, t ? t.h : h); gl.useProgram(p.prog); return p.u; };
    const bind = (unitN, tex, loc) => { gl.activeTexture(gl.TEXTURE0 + unitN); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unitN); };
    const draw = () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // 1 · Arrastre a media resolución.
    let u = pass(res.smear, half);
    bind(0, res.src, u.uSrc);
    gl.uniform4fv(u.uCrop, cropU);
    gl.uniform2f(u.uRes, hw, hh);
    gl.uniform2f(u.uStep, cropU[2] / hw, cropU[3] / hh);
    gl.uniform1f(u.uSmear, smear);
    gl.uniform1f(u.uT8, Math.floor(S.t * 8));
    gl.uniform1f(u.uBurst, au.beat);
    gl.uniform1f(u.uBurstSeed, S.beatSeed);
    gl.uniform4fv(u.uFace, faceU);
    draw();
    // 2 · Resplandor: luces a un cuarto, desenfoque más alto que ancho, y otra vez a un dieciseisavo.
    u = pass(res.bright, q); bind(0, half.tex, u.uTex); gl.uniform2f(u.uStep, 1 / qw, 1 / qh); draw();
    u = pass(res.blur, q2); bind(0, q.tex, u.uTex); gl.uniform2f(u.uDir, 1 / qw, 0); draw();
    u = pass(res.blur, q); bind(0, q2.tex, u.uTex); gl.uniform2f(u.uDir, 0, 1.6 / qh); draw();
    u = pass(res.down, s16); bind(0, q.tex, u.uTex); gl.uniform2f(u.uStep, 1 / sw16, 1 / sh16); draw();
    u = pass(res.blur, s16b); bind(0, s16.tex, u.uTex); gl.uniform2f(u.uDir, 1 / sw16, 0); draw();
    u = pass(res.blur, s16); bind(0, s16b.tex, u.uTex); gl.uniform2f(u.uDir, 0, 2.4 / sh16); draw();
    // 3 · El cuadro.
    u = pass(res.final, null, iw, ih);
    bind(0, res.src, u.uSrc); bind(1, half.tex, u.uHalf); bind(2, q.tex, u.uB4); bind(3, s16.tex, u.uB16); bind(4, res.atlas, u.uAtlas);
    gl.uniform4fv(u.uCrop, cropU);
    gl.uniform2f(u.uRes, iw, ih);
    gl.uniform4fv(u.uFace, faceU);
    gl.uniform1f(u.uUnit, unit);
    // la rejilla: un 1/180 del ancho de la imagen (como en la referencia), en píxeles enteros, mínimo 3
    const P = Math.max(3, Math.round(iw / 180));
    gl.uniform1f(u.uP, P);
    gl.uniform1f(u.uGW, Math.max(1, Math.round(P / 5)));
    gl.uniform1f(u.uTexel, iw / 1080);
    gl.uniform1f(u.uText, texto);
    gl.uniform1f(u.uArdor, glowAmt);
    gl.uniform1f(u.uGrid, rejilla);
    gl.uniform1f(u.uT3, Math.floor(S.t * 3));
    gl.uniform1f(u.uJump, 0.82 - 0.25 * au.mid);
    gl.uniform1f(u.uScroll, S.scroll);
    gl.uniform1f(u.uFlash, 0.8 * au.beat);                 // el golpe enciende el haz
    gl.uniform1f(u.uDebug, o.debug === 'texto' ? 1 : 0);
    gl.uniform3fv(u.uR0, rgb(ramp[0])); gl.uniform3fv(u.uR1, rgb(ramp[1])); gl.uniform3fv(u.uR2, rgb(ramp[2])); gl.uniform3fv(u.uR3, rgb(ramp[3]));
    draw();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    const info = { hora: hora(), w: W, h: H, fps: S.fps ? S.fps.toFixed(1) : '--', t: S.t, ramp, arrastre: Math.round(arrastre * 100), texto: Math.round(texto * 100), ardor: Math.round(ardor * 100), rejilla: Math.round(rejilla * 100), linea: RENGLONES[Math.floor(S.t / 9) % RENGLONES.length].toUpperCase() };
    if (L.marco) {
      ctx.drawImage(canvas, 0, canvas.height - ih, iw, ih, L.x, L.y, iw, ih);
      const clock = drawFrame(ctx, W, H, L, info);
      frame = { on: true, top: L.top, menu: L.menu, bottom: L.bottom, reloj: clock, image: [L.x, L.y, iw, ih], hora: info.hora, letra: pixelFont().includes(PIXEL) ? PIXEL : 'monospace' };
    } else {
      ctx.drawImage(canvas, 0, canvas.height - ih, iw, ih, 0, 0, W, H);
      frame = { on: false, image: [0, 0, W, H] };
    }
    ctx.restore();
    stats.rejilla = P;
    Object.assign(stats, { frames: stats.frames + 1, ms: performance.now() - started, variant: v, size: [W, H], image: frame.image, half: [hw, hh], face: !!face });
    return true;
  }

  // Soltar la gráfica cuando la cámara deja de usarse.
  function release() {
    if (!gl) return;
    const ext = gl.getExtension('WEBGL_lose_context');
    const old = canvas;
    gl = null; canvas = null; res = null; atlas.uploaded = null;
    try { if (ext) ext.loseContext(); } catch (_) {}
    if (old) { old.width = 1; old.height = 1; }
  }

  window.renderBrasa = renderBrasa;
  window.flipBrasa = {
    FABRICA, RAMPAS: Object.fromEntries(Object.entries(RAMPAS).map(([k, r]) => [k, r.slice()])), PARADAS, release,
    state: () => ({ gl: !!gl, failed, lost, canvas: canvas ? [canvas.width, canvas.height] : null, fps: +S.fps.toFixed(1), beat: +S.beat.toFixed(3), atlas: { font: atlas.font, gen: atlas.gen }, marco: { ...frame }, ...stats, ms: +stats.ms.toFixed(2) }),
    // Para las pruebas: el atlas tal cual (para mirarlo) y forzar a revisar la letra.
    _atlas: () => atlas.canvas,
  };
})();
