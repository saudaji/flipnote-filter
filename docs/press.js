// FLIP · PRENSA: semitono de imprenta.
//
// La imagen se separa en planchas de tinta y cada plancha se tira con su trama de puntos girada:
// cian a 15°, magenta a 75°, amarillo a 0° y negro a 45°, que juntas hacen la roseta de una
// revista vista de cerca. Tres tiradas:
//   · CMYK    cuatricromía sobre papel.
//   · DIARIO  una sola tinta negra, trama gruesa, papel de periódico.
//   · RISO    dos tintas planas que se pisan (duplicadora de fanzine).
// Todo se hace en la gráfica, en dos pasadas: la cámara se reduce a unas dos muestras y media por
// punto (así el punto lo dibuja el tono y no el ruido del sensor) y un sombreador pinta papel y
// tinta. El punto es «euclídeo»: redondo en las luces, damero a medio tono y agujero redondo en
// las sombras. Una tabla corrige el umbral para que la tinta que se ve sea la que se pide.
//
//   renderPress(fuente, anchoFuente, altoFuente, ctx2d, espejo, variante, { dot, ink, paper, register, pair })
// devuelve false si no hay gráfica (quien llama pinta otra cosa).
(function () {
  'use strict';

  const VERT = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  // Pasada 1: recorte, espejo y reducción con cuatro tomas.
  const DOWN = HEAD + `
    uniform sampler2D uSrc; uniform vec4 uCrop; uniform vec2 uStep; varying vec2 vUv;
    void main() {
      vec2 uv = uCrop.xy + vUv * uCrop.zw;
      vec3 c = texture2D(uSrc, uv + uStep * vec2(-0.25, -0.25)).rgb + texture2D(uSrc, uv + uStep * vec2(0.25, -0.25)).rgb
             + texture2D(uSrc, uv + uStep * vec2(-0.25, 0.25)).rgb + texture2D(uSrc, uv + uStep * vec2(0.25, 0.25)).rgb;
      gl_FragColor = vec4(c * 0.25, 1.0);
    }`;
  const rot = deg => { const a = deg * Math.PI / 180; return 'vec2(' + Math.cos(a).toFixed(6) + ', ' + Math.sin(a).toFixed(6) + ')'; };
  // Pasada 2: papel y planchas.
  const PRINT = mode => HEAD + '#define MODE ' + mode + `
    uniform sampler2D uImg; uniform sampler2D uLut;
    uniform vec2 uRes; uniform float uCell; uniform float uGamma; uniform float uAge; uniform float uReg; uniform float uUnit;
    uniform vec3 uInkA; uniform vec3 uInkB;
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    vec3 img(vec2 p) { return texture2D(uImg, clamp(p / uRes, 0.0, 1.0)).rgb; }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    // Cuánta tinta deja una plancha en este píxel: 0 papel, 1 tinta.
    float plate(vec2 p, vec2 cs, float amount, float rough) {
      amount = pow(clamp(amount, 0.0, 1.0), uGamma);
      vec2 q = vec2(cs.x * p.x + cs.y * p.y, cs.x * p.y - cs.y * p.x) * (6.2831853 / uCell);
      vec2 w = cos(q);
      float spot = 0.5 + 0.25 * (w.x + w.y);
      float th = texture2D(uLut, vec2(amount * 0.99609375 + 0.001953125, 0.5)).r * 1.02 - 0.01;
      th += rough * clamp(amount * 12.0, 0.0, 1.0) * clamp((1.0 - amount) * 12.0, 0.0, 1.0);
      float slope = 1.5707963 / uCell * sqrt(max(2.0 - dot(w, w), 0.0));
      return clamp(0.5 + (spot - th) / max(slope * 1.25, 1e-4), 0.0, 1.0);
    }
    vec4 separate(vec3 rgb) {
      rgb = clamp(mix(vec3(luma(rgb)), rgb, 1.15), 0.0, 1.0);
      vec3 cmy = 1.0 - rgb;
      float k = min(cmy.x, min(cmy.y, cmy.z));
      // El negro se lleva buena parte de los grises (así los neutros no salen teñidos) y casi todo lo oscuro.
      float black = pow(k, 1.35) * 0.92;
      return vec4((cmy - black) / (1.0 - black), black);
    }
    void main() {
      vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      vec2 g = p / uUnit;
      float fibre = hash(floor(g)), tooth = hash(floor(g * 0.5) + 71.0);
      float rough = (fibre - 0.5) * (0.05 + 0.09 * uAge);
      vec3 paper = mix(vec3(0.965, 0.955, 0.93), vec3(0.885, 0.83, 0.70), uAge);
      paper *= 1.0 - (0.02 + 0.045 * uAge) * (fibre - 0.5) - (0.012 + 0.03 * uAge) * (tooth - 0.5);
      // Entintado desigual, a lo largo del pliego.
      float load = 1.0 - 0.07 * (0.5 + 0.5 * sin(g.x * 0.011 + sin(g.y * 0.017) * 2.0));
      vec3 col = paper;
    #if MODE == 0
      vec2 pc = p + uReg * vec2(-1.0, -0.45), pm = p + uReg * vec2(0.85, 0.5), py = p + uReg * vec2(0.15, -0.8);
      float c = plate(pc, ${rot(15)}, separate(img(pc)).x, rough) * load;
      float m = plate(pm, ${rot(75)}, separate(img(pm)).y, rough) * load;
      float y = plate(py, ${rot(0)},  separate(img(py)).z, rough) * load;
      float k = plate(p,  ${rot(45)}, separate(img(p)).w, rough) * load;
      col *= mix(vec3(1.0), vec3(0.05, 0.62, 0.86), c);
      col *= mix(vec3(1.0), vec3(0.88, 0.07, 0.48), m);
      col *= mix(vec3(1.0), vec3(1.0, 0.90, 0.05), y);
      col *= mix(vec3(1.0), vec3(0.11, 0.10, 0.10), k);
    #elif MODE == 1
      float l = smoothstep(0.03, 0.97, luma(img(p)));
      float k = plate(p, ${rot(45)}, 1.0 - l, rough * 1.4) * load;
      col = mix(paper * vec3(0.97, 0.965, 0.955), vec3(0.13, 0.12, 0.115), k);
    #else
      vec2 pa = p + (uReg + 0.7 * uUnit) * vec2(-1.0, -0.45), pb = p + (uReg + 0.7 * uUnit) * vec2(0.85, 0.5);
      vec3 sa = img(pa), sb = img(pb);
      float dark = pow(1.0 - luma(sa), 1.25);
      // La tinta viva va a lo cálido (piel, madera, luces de tungsteno) y deja un velo en los medios tonos.
      float warm = clamp((sb.r - sb.b) * 1.5 + (sb.r - sb.g) * 0.7, 0.0, 1.0) * 0.85 + (1.0 - luma(sb)) * 0.22;
      float a = plate(pa, ${rot(15)}, dark, rough * 1.6) * load;
      float b = plate(pb, ${rot(75)}, warm, rough * 1.6) * load;
      col *= mix(vec3(1.0), uInkB, b * 0.94);
      col *= mix(vec3(1.0), uInkA, a * 0.94);
    #endif
      gl_FragColor = vec4(col, 1.0);
    }`;

  const MODES = { CMYK: 0, DIARIO: 1, RISO: 2 };
  // Pares de tinta de RISO: la oscura dibuja, la viva colorea.
  const PAIRS = [
    { id: 'AZUL·ROSA', a: [0.0, 0.47, 0.75], b: [1.0, 0.28, 0.69] },
    { id: 'NEGRO·ROJO', a: [0.12, 0.11, 0.11], b: [1.0, 0.36, 0.33] },
    { id: 'VERDE·NARANJA', a: [0.0, 0.42, 0.47], b: [1.0, 0.46, 0.18] },
    { id: 'LILA·AMARILLO', a: [0.40, 0.29, 0.62], b: [1.0, 0.89, 0.0] },
  ];

  let canvas = null, gl = null, failed = false, lost = 0, res = null;
  const last = { mode: '', w: 0, h: 0, cell: 0, fw: 0, fh: 0 };

  // Umbral del punto para cada cantidad de tinta: el cuantil de la función de punto.
  function lutBytes() {
    const n = 96, values = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) values[y * n + x] = 0.5 + 0.25 * (Math.cos(2 * Math.PI * (x + 0.5) / n) + Math.cos(2 * Math.PI * (y + 0.5) / n));
    values.sort();
    const out = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const amount = i / 255;
      const th = i === 0 ? 1.01 : i === 255 ? -0.01 : values[Math.min(values.length - 1, Math.max(0, Math.round((1 - amount) * (values.length - 1))))];
      out[i] = Math.round(Math.max(0, Math.min(1, (th + 0.01) / 1.02)) * 255);
    }
    return out;
  }
  function program(frag) {
    const make = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('PRENSA: ' + gl.getShaderInfoLog(shader));
      return shader;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('PRENSA: ' + gl.getProgramInfoLog(prog));
    const uniforms = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) { const name = gl.getActiveUniform(prog, i).name; uniforms[name] = gl.getUniformLocation(prog, name); }
    return { prog, u: uniforms };
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
  function init() {
    if (gl) return true;
    if (failed) return false;
    try {
      canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
      gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('PRENSA: sin WebGL');
      // Si el sistema retira la gráfica (pasa al volver de segundo plano), la siguiente vuelta la rehace.
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost++; gl = null; canvas = null; res = null; });
      res = { down: program(DOWN), print: [program(PRINT(0)), program(PRINT(1)), program(PRINT(2))], src: texture(gl.LINEAR), small: texture(gl.LINEAR), lut: texture(gl.LINEAR), fbo: gl.createFramebuffer(), fw: 0, fh: 0 };
      gl.bindTexture(gl.TEXTURE_2D, res.lut);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, lutBytes());
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

  // Tamaño del punto: ancho de celda como fracción del ancho de la imagen (igual en visor y en foto).
  const cellFor = (dot, variant, w) => Math.max(3, (3 + Math.max(1, Math.min(10, dot)) * 1.3) * (variant === 'DIARIO' ? 1.35 : 1) * w / 720);

  function renderPress(source, srcW, srcH, ctx, mirror, variant, opts) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (!w || !h || !srcW || !srcH || !init()) return false;
    const o = opts || {};
    const mode = MODES[variant] === undefined ? 0 : MODES[variant];
    const cell = cellFor(o.dot === undefined ? 3 : o.dot, variant, w);
    // El lienzo de la gráfica solo crece: visor y grabación se turnan sin rehacerlo.
    if (canvas.width < w || canvas.height < h) { canvas.width = Math.max(canvas.width, w); canvas.height = Math.max(canvas.height, h); }
    const fw = Math.max(48, Math.min(1024, Math.round(w / cell * 2.5))), fh = Math.max(48, Math.min(1024, Math.round(h / cell * 2.5)));
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (res.fw !== fw || res.fh !== fh) {
        gl.bindTexture(gl.TEXTURE_2D, res.small);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, res.small, 0);
        res.fw = fw; res.fh = fh;
      }
      // 1 · Reducir.
      const [sx, sy, sw, sh] = cropCoordsForDims(srcW, srcH, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
      gl.viewport(0, 0, fw, fh);
      gl.useProgram(res.down.prog);
      gl.bindTexture(gl.TEXTURE_2D, res.src);
      gl.uniform1i(res.down.u.uSrc, 0);
      if (mirror) gl.uniform4f(res.down.u.uCrop, (sx + sw) / srcW, sy / srcH, -sw / srcW, sh / srcH);
      else gl.uniform4f(res.down.u.uCrop, sx / srcW, sy / srcH, sw / srcW, sh / srcH);
      gl.uniform2f(res.down.u.uStep, sw / srcW / fw, sh / srcH / fh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 2 · Imprimir, en la esquina inferior izquierda del lienzo.
      const print = res.print[mode], u = print.u, ink = o.ink === undefined ? 50 : o.ink, pair = PAIRS[o.pair | 0] || PAIRS[0];
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(print.prog);
      gl.bindTexture(gl.TEXTURE_2D, res.small);
      gl.uniform1i(u.uImg, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, res.lut);
      gl.uniform1i(u.uLut, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(u.uRes, w, h);
      gl.uniform1f(u.uCell, cell);
      gl.uniform1f(u.uGamma, 1.5 - 0.9 * Math.max(0, Math.min(100, ink)) / 100);
      gl.uniform1f(u.uAge, Math.max(0, Math.min(100, o.paper === undefined ? 35 : o.paper)) / 100);
      gl.uniform1f(u.uReg, Math.max(0, Math.min(100, o.register || 0)) / 100 * 0.012 * w);
      gl.uniform1f(u.uUnit, w / 720);
      if (u.uInkA) gl.uniform3fv(u.uInkA, pair.a);
      if (u.uInkB) gl.uniform3fv(u.uInkB, pair.b);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ctx.drawImage(canvas, 0, canvas.height - h, w, h, 0, 0, w, h);
    } catch (error) {
      // Una fuente que aún no tiene imagen: este cuadro no se pinta, el siguiente sí.
      return !!gl;
    }
    last.mode = variant; last.w = w; last.h = h; last.cell = cell; last.fw = fw; last.fh = fh;
    return true;
  }

  // Soltar la gráfica cuando la cámara deja de usarse.
  function release() {
    if (!gl) return;
    const ext = gl.getExtension('WEBGL_lose_context');
    const old = canvas;
    gl = null; canvas = null; res = null;
    try { if (ext) ext.loseContext(); } catch (_) {}
    if (old) { old.width = 1; old.height = 1; }
  }

  window.renderPress = renderPress;
  window.flipPress = {
    PAIRS, release,
    cell: cellFor,
    state: () => ({ ready: !!gl, failed, lost, canvas: canvas ? [canvas.width, canvas.height] : null, ...last }),
  };
})();
