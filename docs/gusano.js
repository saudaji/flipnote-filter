// FLIP · GUSANO: cintas de puntos rojos y azules que fluyen en curvas amplias, se enroscan y se
// montan unas sobre otras, con una escalera menta en el canto y negro entre pliegue y pliegue. Se
// lee como op-art en perspectiva.
//
// No es una realimentación de video suave con una trama encima (esa se emborrona en tres cuadros):
// es un SELLO que se estampa opaco, paso a paso, a lo largo de una curva, sobre un lienzo que nunca
// se borra (el algoritmo del pintor).
//   · El lienzo es una rejilla de PUNTOS: un punto mide 1/80 del lado corto (un poco más ancho que
//     alto) y el lienzo guarda, por punto, qué es: rojo, azul (con o sin su filo verde), menta o
//     nada. Se pinta sin filtrar. Al mostrarlo, cada punto se dibuja en bloques duros: el cuerpo de
//     su color, un casquete del otro color arriba a la izquierda y, a veces, un filo verde abajo a
//     la derecha; entre punto y punto, negro.
//   · El sello es una COSTILLA: una barra del grosor de una fila de puntos y de un 27 % del lado
//     corto de largo, atravesada al camino con una inclinación fija (65° respecto a la marcha).
//     Sus puntos alternan rojo y azul; en tramos del camino gana el rojo, en otros el azul. En un
//     extremo lleva un remate menta de un punto y, más allá, un remate negro de tres.
//   · Las costillas se estampan muy juntas (una fila de puntos entre una y otra) a lo largo del
//     camino: forman una cinta ancha cuyas filas se abren en abanico en las curvas (de ahí el tubo
//     en perspectiva); como cada remate cae en la rejilla, la hilera de remates menta dibuja la
//     escalera que corre por el canto, y los remates negros, la media luna negra que la separa del
//     pliegue de abajo.
//   · El camino es un Lissajous de frecuencias no conmensurables con un epiciclo: S amplias y lazos
//     de un 20 % del lado corto que recorren todo el cuadro y se enroscan sobre sí mismos; las
//     pasadas nuevas tapan a las viejas: así se montan los pliegues.
//   · Las costillas caen a distancia fija sobre el camino (no por cuadro) y todo avanza con el reloj
//     (opciones.now), no con el número de llamadas: visor, foto y video van al mismo ritmo y la
//     misma secuencia de relojes da el mismo cuadro. Al empezar se simulan 30 s de historia.
//   · La cámara entra por FIGURA: a 1, el sello es la figura de la cámara (la máscara de persona de
//     flipSilhouette si está, si no su luz por encima de una clave que sigue a la escena) estampada
//     en su sitio 8 veces por segundo mientras el lienzo sube tres filas entre una y otra: una
//     persona que se mueve deja el rastro de gusano, con su canto menta en cada vértebra. A medio
//     camino las costillas se alargan sobre la figura y se acortan fuera, y desde 0,5 la recogen al
//     pasar.
//
//   renderGusano(fuente, anchoFuente, altoFuente, ctx2d, espejo, variante, opciones) → false sin gráfica
//   variante: 'STD'
//   opciones (todas opcionales, de 0 a 1): curva (amplitud y velocidad del recorrido, 0,5), paso
//     (separación entre costillas: una fila de puntos de fábrica, 0,5), trama (tamaño del punto:
//     1/80 del lado corto de fábrica, 0,7), figura (0); now, path ('preview' | 'capture'), outW,
//     outH, audio: { bass, mid, treble, beat }; silueta: false para usar solo la clave de luz;
//     mask: { data, width, height } máscara ya en el encuadre (de 0 a 1 o de 0 a 255).
//   Sonido: los graves empujan el recorrido (más rápido, más costillas por segundo); cada golpe
//     turna el color de los tramos; los medios hacen respirar más las costillas.
(function () {
  'use strict';

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : d);
  const FABRICA = { curva: 0.5, paso: 0.5, trama: 0.7, figura: 0 };
  const COLOR = { rojo: '#E8172E', azul: '#2B14E8', menta: '#33E897', verde: '#18A030' };
  const CORTO = 360;          // celdas del lienzo en el lado corto
  const ASPECTO = 1.5;        // la celda es 1,5 veces más ancha que alta
  const PUNTO = 1.25;         // el punto es 1,25 veces más ancho que alto
  const MAXS = 8;             // costillas por pasada (las que caben en un sombreador de WebGL 1)
  const HIST = 30;            // segundos que se simulan al empezar de cero (el primer cuadro ya es gusano)
  const PASO_T = 1 / 240;     // paso de la marcha por el camino, en segundos
  const FIG_HZ = 8;           // estampas por segundo con el sello de la cámara (entre una y otra, el lienzo sube tres filas)
  const LARGO = 0.15;         // media costilla, en lados cortos (30 % de largo entero)
  const SESGO = 65 * Math.PI / 180;   // la costilla, atravesada al camino: 65° respecto a la marcha
  const NEGRO = 3;            // largo del remate negro, en puntos

  const VERT = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  // Convención: el punto (x, y) cuenta y desde ARRIBA; en la textura del lienzo, v = 0 es la fila de
  // arriba (así escribe una pasada a textura con vUv). La pasada final voltea al pintar en pantalla.
  const HEAD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
`;
  // La pasada de estampado: deriva (corrimiento entero, solo con el sello de la cámara) y hasta 8
  // costillas, en orden, opacas.
  const STAMP = HEAD + `
uniform sampler2D uPrev; uniform sampler2D uMask;
uniform vec2 uGrid; uniform vec2 uShift; uniform float uN, uNegro, uD;
uniform vec2 uAnchor, uCoarse;  // la rejilla de puntos derecha (escalera menta y sello de la cámara): ancla y celda, en celdas del lienzo
uniform vec2 uBox;              // la caja del punto, en fracciones del paso
uniform vec3 uRed, uBlue, uMint, uGreen;
uniform vec4 uA[${MAXS}];   // centro de la costilla (celdas) · dirección de la costilla (unidad, en altos de celda)
uniform vec4 uB[${MAXS}];   // media costilla (altos de celda; < 0: sello de la cámara) · parte roja del tramo · radio en el que recoge la figura · fase de los puntos
bool figIn(vec2 p) { return p.x >= 0.0 && p.y >= 0.0 && p.x < uGrid.x && p.y < uGrid.y && texture2D(uMask, p / uGrid).r > 0.5; }
// El punto k: alternan rojo y azul (con el tramo muy rojo o muy azul gana uno); uno de cada tres
// lleva su filo verde. En su caja (f de 0 a 1): el cuerpo de su color, un casquete del otro
// arriba a la izquierda y el filo abajo a la derecha. Fuera de la caja, negro.
vec3 dot3(vec2 f, float k, float share) {
  if (f.x < 0.0 || f.y < 0.0 || f.x >= 1.0 || f.y >= 1.0) return vec3(0.0);
  bool red = mod(k, 2.0) < 0.5 ? share > 0.25 : share > 0.75;
  vec3 body = red ? uRed : uBlue, other = red ? uBlue : uRed;
  if (f.x < 0.42 && f.y < 0.5) return other;
  if (f.x > 0.64 && f.y > 0.58 && abs(mod(k, 3.0) - 1.0) < 0.5) return uGreen;
  return body;
}
void main() {
  vec2 cell = floor(vUv * uGrid);
  vec2 pc = cell - uShift;
  vec4 prev = vec4(0.0);
  if (pc.x >= 0.0 && pc.y >= 0.0 && pc.x < uGrid.x && pc.y < uGrid.y) prev = texture2D(uPrev, (pc + 0.5) / uGrid);
  vec3 col = prev.rgb;
  // (en alfa, el ángulo de la costilla que pintó cada punto, de 0 a 180° → de 0 a 1: para medirlo)
  float an = prev.a;
  vec2 cc = cell + 0.5;
  vec2 asp = vec2(${ASPECTO.toFixed(2)}, 1.0);
  // la celda de la rejilla de puntos derecha en la que cae este punto del lienzo
  vec2 lt = (cc - uAnchor) / uCoarse, ct = floor(lt);
  for (int i = 0; i < ${MAXS}; i++) {
    if (float(i) >= uN) break;
    vec4 A = uA[i]; vec4 B = uB[i];
    if (B.x < 0.0) {
      // El sello de la cámara: la figura en su sitio, punto a punto en la rejilla derecha; el de
      // arriba de cada columna, menta (sin sombra: lo que hay detrás son sus copias anteriores).
      vec2 tc = uAnchor + (ct + 0.5) * uCoarse;
      if (figIn(tc)) col = !figIn(tc - vec2(0.0, uCoarse.y)) ? uMint : dot3((fract(lt) - 0.5) / uBox + 0.5, ct.x, B.y);
      continue;
    }
    vec2 rel = (cc - A.xy) * asp;
    float s = dot(rel, A.zw), w = rel.x * A.w - rel.y * A.z;
    // el remate menta: las celdas enteras de la rejilla derecha en las que cae el extremo de la
    // costilla (uno o dos puntos; una tras otra, sus celdas hacen la escalera del canto)
    float da = uD * (abs(A.z) * ${PUNTO.toFixed(2)} + abs(A.w));           // paso de los puntos a lo largo de la costilla
    vec2 cap = A.xy + (B.x + 0.5 * da) * A.zw / asp, cap2 = A.xy + (B.x + 1.1 * da) * A.zw / asp;
    if (all(equal(floor((cap - uAnchor) / uCoarse), ct)) || all(equal(floor((cap2 - uAnchor) / uCoarse), ct))) { col = uMint; an = fract(atan(A.w, A.z) / 3.14159265 + 1.0); continue; }
    if (abs(w) <= 0.5 * uD) {
      if (s >= -B.x && s < B.x) {
        // los puntos, derechos en pantalla, centrados en su sitio a lo largo de la costilla
        float kk = floor((s + B.x) / da);
        vec3 hc = vec3(0.0);
        for (int j = -1; j <= 1; j++) {
          float k = kk + float(j);
          vec2 dd = rel - (-B.x + (k + 0.5) * da) * A.zw;
          vec3 d3 = dot3(dd / (uBox * vec2(${PUNTO.toFixed(2)}, 1.0) * uD) + 0.5, k + B.w, B.y);
          if (d3 != vec3(0.0)) { hc = d3; break; }
        }
        col = hc;
      } else if (s >= B.x && s < B.x + da * (1.6 + uNegro)) col = vec3(0.0);   // el remate negro
      else if (B.z > 0.0 && dot(rel, rel) < B.z * B.z && figIn(cc)) col = dot3((fract(lt) - 0.5) / uBox + 0.5, ct.x, B.y);
    } else if (B.z > 0.0 && dot(rel, rel) < B.z * B.z && figIn(cc)) col = dot3((fract(lt) - 0.5) / uBox + 0.5, ct.x, B.y);   // la figura que recoge al pasar
    if (abs(w) <= 0.5 * uD && s >= -B.x && s < B.x + da * (1.6 + uNegro)) an = fract(atan(A.w, A.z) / 3.14159265 + 1.0);
  }
  gl_FragColor = vec4(col, an);
}`;
  // La pasada final: el lienzo, sin filtrar, al tamaño de salida.
  const FINAL = HEAD + `
uniform sampler2D uState; uniform float uDebug;
void main() { vec4 c = texture2D(uState, vec2(vUv.x, 1.0 - vUv.y)); gl_FragColor = vec4(uDebug > 0.5 ? vec3(c.a) : c.rgb, 1.0); }`;

  let canvas = null, gl = null, failed = false, lost = 0, res = null;
  const states = new Map();        // por camino y tamaño de rejilla: cada uno con su lienzo y su reloj
  const S = { previewReal: -1e9, beat: 0, fps: 0, lastPreview: null };
  const stats = { frames: 0, ms: 0, size: [0, 0], grid: [0, 0], stamps: 0, passes: 0, fresh: false, mascara: '', figura: 0, compartido: false, angulos: [] };
  const FIG = { canvas: null, ctx: null, w: 0, h: 0, data: null, kind: '', key: 0.5 };

  function program(frag) {
    const make = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('GUSANO: ' + gl.getShaderInfoLog(shader));
      return shader;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('GUSANO: ' + gl.getProgramInfoLog(prog));
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
  // Un lienzo del gusano: textura sin filtrar (los puntos no se emborronan nunca), vacía.
  function target(w, h) {
    const t = { tex: texture(gl.NEAREST), fbo: gl.createFramebuffer(), w, h };
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return t;
  }
  function drop(t) { if (t && gl) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }

  function init() {
    if (gl) return true;
    if (failed) return false;
    try {
      canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
      gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('GUSANO: sin WebGL');
      // Si el sistema retira la gráfica (al volver de segundo plano), la siguiente vuelta la rehace
      // (y el gusano vuelve a empezar: su lienzo vivía en la gráfica).
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost++; gl = null; canvas = null; res = null; states.clear(); });
      res = { stamp: program(STAMP), final: program(FINAL), mask: texture(gl.NEAREST) };
      gl.bindTexture(gl.TEXTURE_2D, res.mask);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([0]));
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

  // ── El camino ────────────────────────────────────────────────────────────────────────────
  // Un Lissajous de frecuencias sin razón entera que recorre todo el cuadro, con un epiciclo (un
  // círculo que gira 2,31 veces más rápido) que lo hace enroscarse en lazos de un 30 % del lado
  // corto. En lados cortos, desde la esquina de arriba a la izquierda.
  function pathOf(W, H, curva) {
    const short = Math.min(W, H), wn = W / short, hn = H / short;
    return { wn, hn, ax: 0.5 * wn - 0.1, ay: 0.5 * hn - 0.1, r: 0.22 + 0.16 * curva };
  }
  function pathPos(phi, F) {
    return [0.5 * F.wn + F.ax * Math.sin(phi + 0.3) + F.r * Math.sin(2.31 * phi + 0.5),
            0.5 * F.hn + F.ay * Math.sin(1.37 * phi + 1.1) + F.r * Math.cos(2.31 * phi + 0.5)];
  }
  // Las costillas respiran con su propio reloj (los medios las hacen respirar más).
  const breath = (t, mid) => 1 + (0.12 + 0.16 * mid) * Math.sin(t * 0.93 + 0.6) + 0.05 * Math.sin(t * 2.37 + 2.1);
  // La parte roja del tramo: cambia despacio a lo largo del camino (y el golpe la da la vuelta).
  const shareOf = (t, flip) => { const v = 0.5 + 0.45 * Math.sin(t * 0.42 + 0.8); return flip % 2 ? 1 - v : v; };

  // Los mandos traducidos a números del motor.
  function controls(o, au, figura, W, H) {
    const curva = clamp(num(o.curva, FABRICA.curva)), paso = clamp(num(o.paso, FABRICA.paso)), trama = clamp(num(o.trama, FABRICA.trama));
    const dots = Math.round(100 - 51 * trama);         // pasos de punto en el lado corto: 64 de fábrica (el punto, ~1/80)
    const fig = figura >= 0.98;
    return {
      fig, figura, dots, F: pathOf(W, H, curva),
      omega: 0.5 + 0.7 * curva,                         // radianes por segundo del camino
      spacing: paso < 0.5 ? 0.6 + 0.8 * paso : 1 + 2.4 * (paso - 0.5),   // filas de puntos entre costilla y costilla
      d: CORTO / dots,                                  // el paso del punto, en altos de celda
      dvy: fig ? -FIG_HZ * 3 * CORTO / dots : 0,        // con el sello de la cámara el lienzo sube tres filas de puntos por estampa
      mid: au.mid,
    };
  }

  // Una costilla en el punto phi del camino.
  function rib(P, ctl, phi, t) {
    const F = ctl.F;
    const [x, y] = pathPos(phi, F), [x2, y2] = pathPos(phi + 0.003, F);
    let tx = (x2 - x), ty = (y2 - y);
    const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
    // la costilla, girada SESGO desde la marcha
    const ax = tx * Math.cos(SESGO) - ty * Math.sin(SESGO), ay = tx * Math.sin(SESGO) + ty * Math.cos(SESGO);
    let half = LARGO * CORTO * breath(t, ctl.mid);
    let figR = 0;
    if (ctl.figura > 0 && FIG.data) {
      // a medio camino: la costilla se alarga sobre la figura y se acorta fuera; desde 0,5 la
      // recoge al pasar
      const m = maskNear(x / F.wn, y / F.hn, LARGO);
      half *= 1 + Math.min(1, 2 * ctl.figura) * (0.5 * m - 0.45 * (1 - m));
      if (ctl.figura > 0.5) figR = half * (1 + 2.5 * (ctl.figura - 0.5));
    }
    P.angles.push(Math.atan2(ay, ax));
    return { A: [x * CORTO / ASPECTO, y * CORTO, ax, ay], B: [Math.max(1, half), shareOf(t, P.beatShift), figR, 0] };
  }
  // Una estampa con la figura de la cámara en su sitio.
  const figStamp = (P, t) => ({ A: [0, 0, 0, 0], B: [-1, shareOf(t, P.beatShift), 0, 0] });

  // La marcha: avanza el reloj del lienzo hasta tEnd y apunta, en orden, corrimientos y costillas.
  // Las costillas caen a distancia fija sobre el camino (se interpola el punto exacto dentro del
  // paso de marcha).
  function march(P, tEnd, ctl, au, events) {
    while (P.t < tEnd - 1e-9) {
      const h = Math.min(PASO_T, tEnd - P.t);
      const t0 = P.t;
      P.t += h;
      if (ctl.fig) {
        P.dfy += h * ctl.dvy;
        const iy = Math.trunc(P.dfy);
        if (iy) { P.dfy -= iy; P.ay += iy; events.push({ shift: [0, iy] }); }
        P.figAcc += h * FIG_HZ;
        if (P.figAcc >= 1) { P.figAcc -= 1; events.push({ stamp: figStamp(P, P.t) }); P.k++; }
        continue;
      }
      let phi0 = P.phi;
      P.phi += h * ctl.omega * (1 + 1.2 * au.bass);          // los graves empujan el recorrido
      const [x, y] = pathPos(P.phi, ctl.F);
      let step = Math.hypot(x - P.px, y - P.py) * ctl.dots, tt = t0;   // en filas de puntos
      P.px = x; P.py = y;
      while (P.dist + step >= ctl.spacing && step > 0) {
        const lam = (ctl.spacing - P.dist) / step;
        const phiC = phi0 + lam * (P.phi - phi0), tC = tt + lam * (P.t - tt);
        events.push({ stamp: rib(P, ctl, phiC, tC) }); P.k++;
        step *= 1 - lam; phi0 = phiC; tt = tC; P.dist = 0;
      }
      P.dist += step;
    }
  }

  function stateFor(path, gw, gh, now, ctl) {
    const key = path + ':' + gw + 'x' + gh;
    let P = states.get(key);
    const t = now / 1000;
    const stale = P && (t < P.t - 1e-6 || t - P.t > HIST);
    if (!P || stale) {
      if (P) { drop(P.tex[0]); drop(P.tex[1]); }
      // (con el sello de la cámara no hay historia que inventar: el rastro empieza ahora)
      const t0 = ctl.fig ? t : t - HIST;
      P = { key, gw, gh, tex: [target(gw, gh), target(gw, gh)], cur: 0, t: t0, phi: t0 * ctl.omega, dist: 0, k: 0, dfy: 0, ax: 0, ay: 0, figAcc: 0, beatShift: 0, used: 0, fresh: true, angles: [] };
      [P.px, P.py] = pathPos(P.phi, ctl.F);
      states.set(key, P);
      // como mucho cuatro lienzos vivos (visor, foto y alguna capa de otro tamaño)
      if (states.size > 4) { let old = null; for (const s of states.values()) if (s !== P && (!old || s.used < old.used)) old = s; if (old) { drop(old.tex[0]); drop(old.tex[1]); states.delete(old.key); } }
    } else P.fresh = false;
    P.used = performance.now();
    return P;
  }

  // Las pasadas: cada corrimiento abre pasada nueva (así ninguna estampa se corre de su sitio) y
  // caben hasta 8 costillas por pasada.
  function paint(P, events, ctl) {
    let passes = 0, i = 0;
    // el ancla de la rejilla derecha al empezar estas pasadas (la de ahora menos lo que se corre aquí)
    let ax = P.ax, ay = P.ay;
    for (const e of events) if (e.shift) { ax -= e.shift[0]; ay -= e.shift[1]; }
    const u = res.stamp.u;
    gl.useProgram(res.stamp.prog);
    gl.uniform2f(u.uGrid, P.gw, P.gh);
    gl.uniform1f(u.uNegro, NEGRO);
    gl.uniform1f(u.uD, ctl.d);
    gl.uniform2f(u.uCoarse, PUNTO * ctl.d / ASPECTO, ctl.d);
    gl.uniform2f(u.uBox, 0.92, 0.88);
    gl.uniform3fv(u.uRed, rgb(COLOR.rojo)); gl.uniform3fv(u.uBlue, rgb(COLOR.azul)); gl.uniform3fv(u.uMint, rgb(COLOR.menta)); gl.uniform3fv(u.uGreen, rgb(COLOR.verde));
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, res.mask); gl.uniform1i(u.uMask, 1);
    const A = new Float32Array(4 * MAXS), B = new Float32Array(4 * MAXS);
    while (i < events.length) {
      let sx = 0, sy = 0, n = 0;
      while (i < events.length && events[i].shift && n === 0) { sx += events[i].shift[0]; sy += events[i].shift[1]; i++; }
      ax += sx; ay += sy;
      while (i < events.length && events[i].stamp && n < MAXS) { const s = events[i].stamp; A.set(s.A, 4 * n); B.set(s.B, 4 * n); n++; i++; }
      if (!n && !sx && !sy) continue;
      const src = P.tex[P.cur], dst = P.tex[1 - P.cur];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, P.gw, P.gh);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(u.uPrev, 0);
      gl.uniform2f(u.uShift, sx, sy);
      gl.uniform2f(u.uAnchor, ax, ay);
      gl.uniform1f(u.uN, n);
      gl.uniform4fv(u.uA, A); gl.uniform4fv(u.uB, B);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      P.cur = 1 - P.cur;
      passes++;
    }
    return passes;
  }

  // ── La figura (FIGURA > 0) ───────────────────────────────────────────────────────────────
  // Una máscara del tamaño de la rejilla de puntos (un punto por celda), en el encuadre de salida: la de persona si el
  // detector compartido la tiene, si no la luz de la cámara por encima de una clave que sigue a la
  // escena (lo más claro del cuadro, nunca por debajo de 0,42: un cuadro negro no tiene figura).
  function buildMask(o, source, srcW, srcH, W, H, mirror, mw, mh) {
    const crop = typeof cropCoordsForDims === 'function' ? cropCoordsForDims(srcW, srcH, W, H) : [0, 0, srcW, srcH];
    if (!FIG.data || FIG.w !== mw || FIG.h !== mh) { FIG.data = new Uint8Array(mw * mh); FIG.w = mw; FIG.h = mh; }
    let m = o.mask || null;
    if (!m && o.silueta !== false && typeof flipSilhouette !== 'undefined') {
      flipSilhouette.start();
      flipSilhouette.push(source, crop[0], crop[1], crop[2], crop[3], mirror);
      m = flipSilhouette.latest(1200);
    }
    if (m && m.data && m.width && m.height) {
      const d = m.data, scale = d instanceof Float32Array || d instanceof Float64Array ? 255 : 1;
      for (let y = 0; y < mh; y++) {
        const sy = Math.min(m.height - 1, Math.floor((y + 0.5) * m.height / mh));
        for (let x = 0; x < mw; x++) FIG.data[y * mw + x] = d[sy * m.width + Math.min(m.width - 1, Math.floor((x + 0.5) * m.width / mw))] * scale > 127 ? 255 : 0;
      }
      FIG.kind = 'silueta';
    } else {
      if (!FIG.canvas) { FIG.canvas = document.createElement('canvas'); FIG.ctx = FIG.canvas.getContext('2d', { willReadFrequently: true }); }
      if (FIG.canvas.width !== mw || FIG.canvas.height !== mh) { FIG.canvas.width = mw; FIG.canvas.height = mh; }
      const g = FIG.ctx;
      let px;
      try {
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (mirror) { g.translate(mw, 0); g.scale(-1, 1); }
        g.drawImage(source, crop[0], crop[1], crop[2], crop[3], 0, 0, mw, mh);
        g.setTransform(1, 0, 0, 1, 0, 0);
        px = g.getImageData(0, 0, mw, mh).data;
      } catch (_) { return false; }
      const n = mw * mh, L = new Uint8Array(n), hist = new Uint32Array(256);
      for (let i = 0; i < n; i++) { const l = (77 * px[4 * i] + 150 * px[4 * i + 1] + 29 * px[4 * i + 2]) >> 8; L[i] = l; hist[l]++; }
      let acc = 0, q60 = 255;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.6) { q60 = v; break; } }
      const key = Math.round(255 * clamp(Math.max(0.42, q60 / 255 + 0.06), 0.42, 0.88));
      FIG.key = key / 255;
      for (let i = 0; i < n; i++) FIG.data[i] = L[i] > key ? 255 : 0;
      FIG.kind = 'luz';
    }
    gl.bindTexture(gl.TEXTURE_2D, res.mask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mw, mh, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, FIG.data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    return true;
  }
  // Cuánta figura hay alrededor de un punto (de 0 a 1; x, y en fracciones del cuadro; rr en lados cortos).
  function maskNear(x, y, rr) {
    if (!FIG.data) return 0;
    let s = 0, n = 0;
    const sh = Math.min(FIG.w, FIG.h);
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const px = Math.floor(x * FIG.w + i * rr * 0.4 * sh), py = Math.floor(y * FIG.h + j * rr * 0.4 * sh);
      n++;
      if (px >= 0 && py >= 0 && px < FIG.w && py < FIG.h && FIG.data[py * FIG.w + px]) s++;
    }
    return s / n;
  }

  function audioOf(o, dt) {
    const a = o.audio || null;
    const bass = a ? clamp(num(a.bass, 0)) : 0, mid = a ? clamp(num(a.mid, 0)) : 0, treble = a ? clamp(num(a.treble, num(a.high, 0))) : 0;
    const hit = a ? (typeof a.beat === 'number' ? clamp(a.beat) : a.beat ? 1 : 0) : 0;
    const rise = hit > 0.5 && S.beat < 0.35;
    S.beat = Math.max(S.beat * Math.exp(-dt / 0.16), hit);
    return { bass, mid, treble, beat: S.beat, rise };
  }

  const rgb = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

  function renderGusano(source, srcW, srcH, ctx, mirror, variant, options) {
    const o = options || {};
    const W = Math.max(1, Math.round(o.outW || ctx.canvas.width)), H = Math.max(1, Math.round(o.outH || ctx.canvas.height));
    if (!W || !H || !init()) return false;
    const started = performance.now(), now = num(o.now, started);
    const path = o.path === 'capture' ? 'capture' : 'preview';
    const figura = clamp(num(o.figura, FABRICA.figura));
    const lastT = S.lastPreview;
    let dt = path === 'preview' && lastT != null ? (now - lastT) / 1000 : 0;
    if (!(dt > 0) || dt > 0.25) dt = 0;
    if (path === 'preview') { if (dt > 0) S.fps = S.fps ? S.fps * 0.9 + 0.1 / dt : 1 / dt; S.previewReal = started; S.lastPreview = now; }
    const au = audioOf(o, dt);
    const ctl = controls(o, au, figura, W, H);
    // La rejilla del lienzo depende solo de la forma del cuadro: el punto y la línea miden lo
    // mismo, en proporción, en el visor y en una foto de 4K.
    const gh = CORTO * H / Math.min(W, H), gw = gh * W / H / ASPECTO;
    const GW = Math.max(8, Math.round(gw)), GH = Math.max(8, Math.round(gh));

    // La foto y el video, con el visor vivo y la misma forma de cuadro, salen del lienzo del
    // visor tal cual (el visor manda: es lo que se estaba viendo). Si no, llevan el suyo.
    let P = null, shared = false;
    if (path === 'capture' && started - S.previewReal < 500) {
      const pv = states.get('preview:' + GW + 'x' + GH);
      if (pv) { P = pv; shared = true; }
    }
    let events = [], passes = 0;
    if (!P) {
      P = stateFor(path, GW, GH, now, ctl);
      P.angles = [];
      if (au.rise) P.beatShift++;                                          // el golpe da la vuelta a los tramos
      // (la máscara, a la rejilla de puntos: basta y cuesta poco leerla cada cuadro)
      if (figura > 0 && source && srcW && srcH) buildMask(o, source, srcW, srcH, W, H, !!mirror, Math.max(8, Math.round(ctl.dots * W / Math.min(W, H) / PUNTO)), Math.max(8, Math.round(ctl.dots * H / Math.min(W, H))));
      else FIG.kind = '';
      march(P, now / 1000, ctl, au, events);
      passes = paint(P, events, ctl);
    }
    // Al tamaño de salida, punto a punto.
    if (canvas.width < W || canvas.height < H) { canvas.width = Math.max(canvas.width, W); canvas.height = Math.max(canvas.height, H); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const u = res.final.u;
    gl.useProgram(res.final.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, P.tex[P.cur].tex); gl.uniform1i(u.uState, 0);
    gl.uniform1f(u.uDebug, o.debug === 'angulo' ? 1 : 0);   // (para las pruebas: el ángulo de cada costilla, en gris)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, canvas.height - H, W, H, 0, 0, W, H);
    ctx.restore();
    Object.assign(stats, { frames: stats.frames + 1, ms: performance.now() - started, size: [W, H], grid: [P.gw, P.gh], stamps: events.filter(e => e.stamp).length, passes, fresh: !!P.fresh, mascara: figura > 0 ? FIG.kind : '', figura, compartido: shared, turno: P.beatShift, celda: [+(W / P.gw).toFixed(3), +(H / P.gh).toFixed(3)], punto: +(ctl.d * H / P.gh).toFixed(2), angulos: P.angles.slice(-64) });
    return true;
  }

  // Soltar la gráfica cuando la cámara deja de usarse (el gusano empieza de nuevo al volver).
  function release() {
    S.lastPreview = null;
    if (!gl) { states.clear(); return; }
    const ext = gl.getExtension('WEBGL_lose_context');
    const old = canvas;
    gl = null; canvas = null; res = null;
    states.clear();
    try { if (ext) ext.loseContext(); } catch (_) {}
    if (old) { old.width = 1; old.height = 1; }
  }

  window.renderGusano = renderGusano;
  window.flipGusano = {
    FABRICA, COLOR: { ...COLOR }, release,
    state: () => ({ gl: !!gl, failed, lost, canvas: canvas ? [canvas.width, canvas.height] : null, lienzos: states.size, fps: +S.fps.toFixed(1), beat: +S.beat.toFixed(3), ...stats, ms: +stats.ms.toFixed(2) }),
  };
})();
