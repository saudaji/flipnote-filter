// FLIP · TESELA: la figura hecha de baldosas de una memoria de video rota.
//
// Así pintaban las consolas de 8 y 16 bits: la pantalla es una rejilla de baldosas de 8 × 8 a cuatro
// tonos (2 bits por punto), cada baldosa sale de un banco pequeño, y cada una lleva su sub-paleta de
// cuatro colores y sus volteos. Cuando esa memoria se corrompe, las baldosas se desordenan en
// ráfagas: tiras de baldosas iguales o seguidas del banco cambian a la vez, de golpe, unas cuantas
// veces por segundo, y entre bloque y bloque se ve el negro del fondo.
//
// Nada se copia de ninguna máquina: el banco (32 glifos de trazo gordo en cuatro familias —arcos,
// ladrillo, cuadros y metal en diagonal—) está dibujado aquí punto a punto, y las sub-paletas son
// propias. Cómo se arma la imagen:
//   · La sub-paleta va POR ZONAS, no baldosa a baldosa: la luz y el tono de la escena muy suavizados
//     (5 × 5 baldosas) más un campo lento que reparte zonas de ladrillo rojo y de arcos azules donde
//     la imagen no lo decide. Lo oscuro va a SOMBRA o a hueco; PLATA queda en minoría.
//   · Huecos: lo muy oscuro, parte de lo oscuro y algunas baldosas sueltas quedan en negro (en la
//     figura, de un cuarto a un tercio de las baldosas): entre bloque y bloque se ve el fondo.
//   · Las baldosas van de dos en dos en vertical (8 × 16, como los sprites altos): las dos mitades
//     son la misma, y en los arcos la de abajo a veces va volteada (∩ sobre ∪).
//   · En cada salto, la ROTURA corrompe tiras de 3 a 6 baldosas, de lado o en columna: todas iguales
//     o seguidas del banco, con otra sub-paleta y otros volteos, o en negro.
//
//   · SILUETA: solo la persona (la máscara del detector compartido, recortada A BALDOSA: borde en
//     escalera, nunca suave), sobre negro. Mientras el detector carga, si falla o si no hay nadie,
//     no se queda en negro: va el cuadro entero apagado (cada baldosa un tono más oscura) y el
//     cristal lo dice una vez.
//   · TOTAL: todo el cuadro.
// La escena se lee a saltos (se toma de nuevo a 6–15 por segundo, con SALTOS), así que entre salto
// y salto la imagen no cambia ni un punto: no hierve con el ruido del sensor. Con ESCUCHA, la
// corrupción salta solo en el golpe.
//
//   renderTesela(fuente, anchoFuente, altoFuente, ctx2d, espejo, variante, opciones) → true si pintó
//   opciones: { now, path, outW, outH, own, audio, baldosa (24…96 en el lado corto; 64 de fábrica: la densidad medida en la pieza, con la figura llenando el cuadro), rotura (0…1),
//               saltos (0…15 por segundo; 0 = la corrupción se queda quieta) }
(function () {
  'use strict';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const VERT = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

  // ── El banco: 32 glifos de 8 × 8 a cuatro tonos ('.' fondo negro, 1 sombra, 2 cuerpo, 3 brillo) ──
  // Como en la pieza, las baldosas van LLENAS: los arcos sobre su campo de cobalto, el ladrillo rojo
  // con su textura de puntos; los cuadros y el metal ponen el negro y la variedad.
  const GLYPHS = [
    // 1 · ARCOS (van en azul): el campo en cobalto y el glifo en trazo claro (blanco y cian), como en la
    //     pieza: arco, pico, rayas, ce, cuna, gancho, ola, aro
    ['arco', '11111111/12333321/13211231/13111131/13111131/13111131/13111131/12111121'],
    ['pico', '11113111/11132311/11321231/11311131/13333331/13111131/31111113/11111111'],
    ['rayas', '11111111/33333333/22222222/11111111/11111111/33333333/22222222/11111111'],
    ['ce', '11111111/11333331/13211111/13111111/13111111/13211111/11333331/11111111'],
    ['cuna', '13111131/13111131/13111131/13111131/13211231/12333321/11111111/11111111'],
    ['gancho', '11111111/13333331/13222221/13211111/13211111/13211111/13211111/13211111'],
    ['ola', '11111111/11111111/13311331/31133113/11111111/11111111/13311331/31133113'],
    ['aro', '11111111/11333311/13211231/13111131/13111131/13211231/11333311/11111111'],
    // 2 · LADRILLO (van en rojo): barras rojas con su textura de puntos negros, una columna negra a la
    //     izquierda y la sombra a la derecha: apiladas hacen las columnas de ladrillo de la pieza
    ['ganchillo', '.2222221/.2.22.21/.2222221/.2.22.21/.2222221/.2.22.21/.2222221/.2.22.21'],
    ['punto', '.2222221/.2.2.2.1/.2222221/.2.2.2.1/.2222221/.2.2.2.1/.2222221/.2.2.2.1'],
    ['sesgo', '.222.221/.22.2221/.2.222.1/..222.21/.222.221/.22.2221/.2.222.1/..222.21'],
    ['contrasesgo', '.222.221/..222.21/.2.222.1/.22.2221/.222.221/..222.21/.2.222.1/.22.2221'],
    ['damero', '.2222221/..2.2.21/.2222221/.2.2.2.1/.2222221/..2.2.21/.2222221/.2.2.2.1'],
    ['hilera', '.2222221/...2..21/.2222221/.2222221/...2..21/.2222221/.2222221/...2..21'],
    ['cadeneta', '.22.2221/.2222.21/.22.2221/.2222.21/.22.2221/.2222.21/.22.2221/.2222.21'],
    ['ladrillo', '.222.221/.2222221/.......1/.2222221/.222.221/.2222221/.......1/.2222221'],
    // 3 · CUADROS (en cualquier paleta): punto, marco, cruz, ele, te, cuatro, diana, losa
    ['punto', '......../......../..3332../..3221../..3221../..2111../......../........'],
    ['marco', '......../.333332./.322221./.32..21./.32..21./.322221./.211111./........'],
    ['cruz', '...32.../...32.../...32.../33333322/22222211/...21.../...21.../...21...'],
    ['ele', '32....../32....../32....../32....../32....../33333333/22222222/11111111'],
    ['te', '33333333/22222222/11132111/...32.../...32.../...32.../...32.../...21...'],
    ['cuatro', '332.332./321.321./211.211./......../332.332./321.321./211.211./........'],
    ['diana', '33333333/32222221/32....21/32.33.21/32.31.21/32....21/32222221/11111111'],
    ['losa', '33333332/32222221/32222221/32222221/32222221/32222221/32222221/21111111'],
    // 4 · METAL EN DIAGONAL (van en plata): diagonal, rayas, cheurones, delta, cuña, aspa, rombo, damero
    ['diagonal', '.....332/....3321/...3321./..3321../.3321.../3321..../321...../21......'],
    ['rayas', '32..32../2..32..3/..32..32/.32..32./32..32../2..32..3/..32..32/.32..32.'],
    ['cheurones', '32....32/.32..32./..3223../...22.../32....32/.32..32./..3223../...22...'],
    ['delta', '...33.../..3223../..3223../.322223./.322223./32222223/32222223/11111111'],
    ['cuña', '.......3/......32/.....322/....3222/...32222/..322222/.3222222/32222222'],
    ['aspa', '32....23/332..233/.332233./..3223../..3223../.332233./332..233/32....23'],
    ['rombo', '...33.../..3223../.322223./32222223/12222221/.122221./..1221../...11...'],
    ['damero', '33..33../32..32../..33..33/..32..32/33..33../32..32../..33..33/..32..32'],
  ];
  // Dentro de cada familia, de la más rala a la más llena: la luz de la escena elige por ahí.
  const TILES = [], NAMES = [];
  for (let f = 0; f < 4; f++) {
    const fam = GLYPHS.slice(f * 8, f * 8 + 8).map(([name, art]) => {
      const t = Uint8Array.from(art.replace(/\//g, ''), ch => ch === '.' ? 0 : +ch);
      return { name, t, ink: t.reduce((a, v) => a + v, 0) };
    }).sort((a, b) => a.ink - b.ink);
    for (const g of fam) { TILES.push(g.t); NAMES.push(g.name); }
  }
  // Sub-paletas de cuatro colores (el 0, siempre negro): AZUL, ROJO, PLATA y SOMBRA.
  const PALETTES = [
    ['#000000', '#0028E8', '#2898FF', '#FFFFFF'],
    ['#000000', '#780800', '#D81808', '#F23C22'],
    ['#000000', '#484848', '#A8A8A8', '#FFFFFF'],
    ['#000000', '#000050', '#5A1A06', '#1C34A8'],
  ];

  // 1 · ESCENA: la imagen reducida a la rejilla (16 tomas por baldosa) y la persona en su centro.
  const SCENE = HEAD + `
    uniform sampler2D uSrc; uniform sampler2D uMask; uniform vec4 uCrop; uniform vec2 uCells; uniform vec2 uSpan; uniform float uUseMask;
    varying vec2 vUv;
    void main() {
      vec2 cell = floor(vUv * uCells);
      vec3 acc = vec3(0.0);
      for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
        vec2 f = clamp((cell + (vec2(float(i), float(j)) + 0.5) * 0.25) * uSpan, 0.0, 1.0);
        acc += texture2D(uSrc, uCrop.xy + f * uCrop.zw).rgb;
      }
      float m = uUseMask > 0.5 ? texture2D(uMask, clamp((cell + 0.5) * uSpan, 0.0, 1.0)).r : 1.0;
      gl_FragColor = vec4(acc / 16.0, m);
    }`;
  const HASH = `
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }`;
  // 2 · ZONAS: sub-paleta por región, densidad y huecos (se calcula con la escena, a saltos).
  //   R sub-paleta/3 · G densidad · B hueco · A persona
  const REGION = HEAD + HASH + `
    uniform sampler2D uScene; uniform vec2 uCells; uniform float uSeed;
    varying vec2 vUv;
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i + uSeed), hash(i + vec2(1.0, 0.0) + uSeed), f.x), mix(hash(i + vec2(0.0, 1.0) + uSeed), hash(i + vec2(1.0, 1.0) + uSeed), f.x), f.y);
    }
    vec4 S(vec2 c) { return texture2D(uScene, (clamp(c, vec2(0.0), uCells - 1.0) + 0.5) / uCells); }
    float W(int i) { return i == 0 ? 0.375 : (i == 1 || i == -1) ? 0.25 : 0.0625; }
    void main() {
      vec2 c = floor(vUv * uCells);
      vec4 own = S(c);
      vec3 sm = vec3(0.0);
      for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) sm += S(c + vec2(float(i), float(j))).rgb * W(i) * W(j);
      float L = luma(own.rgb), Ls = luma(sm);
      float warm = clamp((sm.r - sm.b) / max(Ls, 0.08), -1.0, 1.0);
      float zone = vnoise(c / 2.6), rare = vnoise(c / 3.0 + 17.3);
      float pal;
      if (Ls < 0.11) pal = 3.0;                                                  // sombra
      else if (Ls > 0.80) pal = 0.0;                                             // lo muy claro, arcos azul y blanco
      else pal = warm * 0.35 + (zone - 0.5) * 1.5 > 0.0 ? 1.0 : 0.0;           // ladrillo rojo o arcos azules, por zonas
      if (pal < 1.5 && rare > 0.84 && Ls > 0.18) pal = 2.0;                     // plata, en minoría
      // huecos: lo muy oscuro, parte de lo oscuro y alguna baldosa suelta (de dos en dos, de lado)
      float h = hash(vec2(floor(c.x * 0.5), c.y) + uSeed * 3.0);
      float hole = (L < 0.08 || (L < 0.16 && h < 0.6) || (Ls < 0.18 && h < 0.55) || h < 0.1) ? 1.0 : 0.0;
      if (L < 0.16 && pal < 2.5 && hole < 0.5) pal = 3.0;                       // lo oscuro que no es hueco, en SOMBRA
      // densidad: la luz (y el ladrillo, lleno: el ganchillo y los remaches mandan en sus zonas)
      float dense = pal == 3.0 ? 0.62 + 0.38 * hash(c + 5.0) : clamp(L * 1.1 + (pal == 1.0 ? 0.32 : 0.0) + (hash(c + 9.0) - 0.5) * 0.55, 0.0, 1.0);
      gl_FragColor = vec4(pal / 3.0, dense, hole, own.a);
    }`;
  // 3 · BALDOSAS, en el lienzo de salida.
  const DRAW = HEAD + HASH + `
    uniform sampler2D uRegion; uniform sampler2D uBank; uniform sampler2D uPal;
    uniform vec2 uCells; uniform vec2 uOut; uniform float uTile; uniform float uTick; uniform float uBreak; uniform float uRun; uniform float uCut; uniform float uDim;
    varying vec2 vUv;
    vec4 R(vec2 c) { return texture2D(uRegion, (clamp(c, vec2(0.0), uCells - 1.0) + 0.5) / uCells); }
    void main() {
      vec2 px = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y);
      vec2 cell = floor(px / uTile);
      vec4 me = R(cell);
      if (uCut > 0.5 && me.a < 0.45) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }   // fuera de la figura, negro
      // el par 8 × 16: las dos mitades eligen con la de arriba
      float pair = floor(cell.y * 0.5), half_ = cell.y - pair * 2.0;
      vec4 top = R(vec2(cell.x, pair * 2.0));
      float pal = floor(top.r * 3.0 + 0.5), hole = me.b;
      // (el ladrillo va en columnas: cuatro baldosas iguales en alto; lo demás, de dos en dos)
      vec2 sprite = vec2(cell.x, pal == 1.0 ? floor(cell.y * 0.25) + 500.0 : pair);
      float fam = pal == 1.0 ? 1.0 : pal == 2.0 ? 3.0 : pal == 3.0 ? 2.0 : 0.0;
      if (pal < 1.5 && hash(sprite + 17.0) < (pal == 1.0 ? 0.03 : 0.08)) fam = 2.0;   // algunos cuadros entre arcos y ladrillos
      float dense = pal == 1.0 ? R(vec2(cell.x, floor(cell.y * 0.25) * 4.0)).g : top.g;
      float idx = floor(clamp(dense, 0.0, 0.999) * 8.0);
      float tile = fam * 8.0 + idx;
      float fx = step(0.5, hash(sprite + 3.0));
      float fy = 0.0;
      // los arcos son sprites altos (8 × 16): el glifo se estira por las dos mitades del par, como en la pieza
      float tall = fam == 0.0 ? 1.0 : 0.0;
      // en las zonas azules, algún sprite va hueco: el campo de cobalto en negro y lo negro en cobalto
      float fill = pal == 0.0 && hash(sprite + 29.0) < 0.15 ? 1.0 : 0.0;
      // La rotura: en cada salto, tiras de 3 a 6 baldosas, de lado o en columna, se corrompen juntas.
      float t = mod(uTick, 251.0);
      float runH = 3.0 + floor(hash(vec2(cell.y, t + 1.0)) * (4.0 + uRun)), offH = floor(hash(vec2(cell.y, t + 2.0)) * 6.0);
      float sH = floor((cell.x + offH) / runH), hH = hash(vec2(sH * 7.0 + cell.y * 131.0, t * 3.0 + 5.0));
      float runV = 3.0 + floor(hash(vec2(cell.x, t + 3.0)) * (4.0 + uRun)), offV = floor(hash(vec2(cell.x, t + 4.0)) * 6.0);
      float sV = floor((cell.y + offV) / runV), hV = hash(vec2(sV * 11.0 + cell.x * 173.0, t * 5.0 + 9.0));
      bool corrH = hH < uBreak * 0.14, corrV = !corrH && hV < uBreak * 0.3;   // (más columnas que filas: el ritmo de la pieza es vertical)
      if (corrH || corrV) {
        float key = corrH ? sH * 13.0 + cell.y * 257.0 : sV * 17.0 + cell.x * 263.0;
        float along = corrH ? cell.x + offH - sH * runH : cell.y + offV - sV * runV;
        float kind = hash(vec2(key, t + 11.0));
        if (kind < 0.16) hole = 1.0;                                            // ráfaga de negro
        else {
          float base = floor(hash(vec2(key, t + 13.0)) * 32.0);
          tile = kind < 0.6 ? base : mod(base + along, 32.0);                   // iguales, o seguidas del banco
          float pk = hash(vec2(key, t + 17.0));
          pal = pk < 0.45 ? 1.0 : pk < 0.86 ? 0.0 : 2.0;
          fx = step(0.5, hash(vec2(key, t + 19.0))); fy = step(0.7, hash(vec2(key, t + 23.0))); tall = 0.0;
          fill = pal == 0.0 && hash(vec2(key, t + 29.0)) < 0.2 ? 1.0 : 0.0;
          hole = 0.0;
        }
      }
      if (hole > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      vec2 local = floor(fract(px / uTile) * 8.0);
      if (tall > 0.5) local.y = floor((half_ * 8.0 + local.y) * 0.5);
      if (fx > 0.5) local.x = 7.0 - local.x;
      if (fy > 0.5) local.y = 7.0 - local.y;
      vec2 at = vec2(mod(tile, 8.0), floor(tile / 8.0)) * 8.0 + local + 0.5;
      float level = floor(texture2D(uBank, at / vec2(64.0, 32.0)).r * 3.0 + 0.5);
      if (fill > 0.5 && level < 1.5) level = 1.0 - level;                           // (fondo ↔ sombra)
      level = max(level - uDim, 0.0);                                               // apagada: un tono más oscura
      gl_FragColor = vec4(texture2D(uPal, vec2((level + 0.5) / 4.0, (pal + 0.5) / 4.0)).rgb, 1.0);
    }`;

  let canvas = null, gl = null, failed = false, lost = 0, res = null, maxSide = 4096;
  const slots = new Map();
  const seed = 1 + Math.floor(Math.random() * 97);           // las zonas, distintas en cada sesión, quietas dentro de ella
  const stats = { frames: 0, ms: 0, msAvg: 0, variant: '', cells: [0, 0], tilePx: 0, size: [0, 0], tick: 0, refreshes: 0, person: '', dim: false, cut: false };

  function program(frag) {
    const make = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('TESELA: ' + gl.getShaderInfoLog(shader));
      return shader;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('TESELA: ' + gl.getProgramInfoLog(prog));
    const u = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) { const name = gl.getActiveUniform(prog, i).name; u[name] = gl.getUniformLocation(prog, name); }
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
  function init() {
    if (gl) return true;
    if (failed) return false;
    try {
      canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
      gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('TESELA: sin WebGL');
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost++; gl = null; canvas = null; res = null; slots.clear(); });
      const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS), tmax = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      maxSide = Math.max(512, Math.min(4096, dims ? Math.min(dims[0], dims[1]) : 4096, tmax || 4096));
      res = { scene: program(SCENE), region: program(REGION), draw: program(DRAW), src: texture(gl.LINEAR), mask: texture(gl.LINEAR), bank: texture(gl.NEAREST), pal: texture(gl.NEAREST), fbo: gl.createFramebuffer() };
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      // el banco: 8 columnas × 4 filas de baldosas (una familia por fila), en una textura de 64 × 32 de un canal
      const bytes = new Uint8Array(64 * 32);
      TILES.forEach((t, i) => { const ox = (i % 8) * 8, oy = Math.floor(i / 8) * 8; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bytes[(oy + y) * 64 + ox + x] = t[y * 8 + x] * 85; });
      gl.bindTexture(gl.TEXTURE_2D, res.bank);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 32, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
      // las sub-paletas: 4 tonos × 4 paletas
      const pal = new Uint8Array(4 * 4 * 4);
      PALETTES.forEach((p, j) => p.forEach((c, i) => { const k = (j * 4 + i) * 4; pal[k] = parseInt(c.slice(1, 3), 16); pal[k + 1] = parseInt(c.slice(3, 5), 16); pal[k + 2] = parseInt(c.slice(5, 7), 16); pal[k + 3] = 255; }));
      gl.bindTexture(gl.TEXTURE_2D, res.pal);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, pal);
      gl.bindTexture(gl.TEXTURE_2D, res.mask);
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
  function slotFor(key, cw, ch) {
    let slot = slots.get(key);
    const drop = s => { gl.deleteTexture(s.scene); gl.deleteTexture(s.region); };
    if (slot && (slot.cw !== cw || slot.ch !== ch)) { drop(slot); slots.delete(key); slot = null; }
    if (!slot) {
      if (slots.size >= 3) { let old = null; for (const [k, s] of slots) if (!old || s.at < old[1].at) old = [k, s]; drop(old[1]); slots.delete(old[0]); }
      const make = () => { const t = texture(gl.NEAREST); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); return t; };
      slot = { cw, ch, scene: make(), region: make(), at: -1e9, read: -1, frames: 0, key: '' };
      slots.set(key, slot);
    }
    return slot;
  }

  // ── La persona: la máscara del detector compartido, y si de verdad hay alguien ─────────────
  const person = { bytes: null, seq: -1, phase: '', share: 0, said: '', saidAt: -1e9 };
  function personMask(source, sx, sy, sw, sh, mirror) {
    if (typeof flipSilhouette === 'undefined') { person.phase = 'none'; return false; }
    flipSilhouette.start();
    flipSilhouette.push(source, sx, sy, sw, sh, mirror);
    const mask = flipSilhouette.latest(1200);
    if (!mask) { const ph = flipSilhouette.status().phase; person.phase = ph === 'failed' ? 'failed' : 'loading'; return false; }
    if (mask.seq !== person.seq) {
      person.seq = mask.seq;
      const n = mask.width * mask.height;
      if (!person.bytes || person.bytes.length !== n) person.bytes = new Uint8Array(n);
      let on = 0;
      for (let i = 0; i < n; i++) { const v = mask.data[i]; person.bytes[i] = v * 255; if (v > 0.45) on++; }
      person.share = on / n;
      gl.bindTexture(gl.TEXTURE_2D, res.mask);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mask.width, mask.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, person.bytes);
    }
    // (menos de un 1 % del cuadro no es una persona: es ruido del detector)
    person.phase = person.share > 0.01 ? 'ready' : 'nobody';
    return person.phase === 'ready';
  }
  function tell(phase, now) {
    if (phase === person.said || !window.flipShell || !flipShell.hint) return;
    if (phase === 'nobody' && now - person.saidAt < 6000) return;
    person.said = phase; person.saidAt = now;
    if (phase === 'loading') flipShell.hint('TESELA · cargando el recorte de persona…', 2400);
    else if (phase === 'nobody') flipShell.hint('TESELA · no veo a nadie: va el cuadro entero, apagado', 3000);
    else if (phase === 'failed') flipShell.hint('TESELA necesita conexión la primera vez para recortar a la persona', 4200);
  }
  function pass(p, target, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? res.fbo : null);
    if (target) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.prog);
  }
  function bind(unit, tex, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); if (loc) gl.uniform1i(loc, unit); }

  function renderTesela(source, srcW, srcH, ctx, mirror, variant, opts) {
    const o = opts || {};
    const outW = Math.max(1, Math.round(o.outW || ctx.canvas.width)), outH = Math.max(1, Math.round(o.outH || ctx.canvas.height));
    if (!srcW || !srcH || !init()) return false;
    const started = performance.now(), now = o.now || started;
    const k = Math.min(1, maxSide / Math.max(outW, outH));
    const w = Math.max(16, Math.round(outW * k)), h = Math.max(16, Math.round(outH * k));
    // La rejilla: «baldosa» baldosas en el lado corto, desde la esquina de arriba a la izquierda.
    const n = Math.round(clamp(o.baldosa == null ? 64 : o.baldosa, 24, 96));
    const tile = Math.min(w, h) / n;
    const cw = Math.ceil(w / tile - 1e-6), ch = Math.ceil(h / tile - 1e-6);
    const [sx, sy, sw, sh] = typeof cropCoordsForDims === 'function' ? cropCoordsForDims(srcW, srcH, w, h) : [0, 0, srcW, srcH];
    const audio = o.audio || null, saltos = clamp(o.saltos == null ? 6 : o.saltos, 0, 15);
    // El salto de la corrupción: el reloj a SALTOS por segundo; con ESCUCHA, el contador de golpes.
    const tick = audio && audio.beats != null ? audio.beats : Math.floor(now / 1000 * saltos);
    const silueta = variant !== 'TOTAL';
    try {
      const key = (o.own ? 'cam' : (o.path || 'preview')) + ':' + cw + 'x' + ch;
      const slot = slotFor(key, cw, ch);
      const usePerson = silueta && personMask(source, sx, sy, sw, sh, mirror);
      if (!silueta) person.phase = '';
      const dim = silueta && !usePerson;
      if (silueta && o.own && o.path !== 'capture') tell(person.phase, started);
      // La escena se toma de nuevo a saltos (6–15 por segundo): entre uno y otro no cambia nada.
      const sceneHz = Math.max(6, Math.min(15, saltos || 6));
      const read = Math.floor(now / 1000 * sceneHz);
      const fresh = slot.frames === 0 || started - slot.at > 450 || slot.mirror !== !!mirror || slot.key !== variant + usePerson || (o.own && o.path === 'capture' && !o.motion);   // (la foto, con la imagen de ese instante)
      if (canvas.width < w || canvas.height < h) {
        if (o.own && o.path === 'capture' && !o.motion) slot.restore = [canvas.width, canvas.height];   // (STAGE y PORTAL también dicen «capture»: esos no)
        canvas.width = Math.max(canvas.width, w); canvas.height = Math.max(canvas.height, h);
      }
      if (fresh || read !== slot.read) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, res.src);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        let p = res.scene;
        pass(p, slot.scene, cw, ch);
        bind(0, res.src, p.u.uSrc); bind(1, res.mask, p.u.uMask);
        if (mirror) gl.uniform4f(p.u.uCrop, (sx + sw) / srcW, sy / srcH, -sw / srcW, sh / srcH);
        else gl.uniform4f(p.u.uCrop, sx / srcW, sy / srcH, sw / srcW, sh / srcH);
        gl.uniform2f(p.u.uCells, cw, ch); gl.uniform2f(p.u.uSpan, tile / w, tile / h); gl.uniform1f(p.u.uUseMask, usePerson ? 1 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        p = res.region;
        pass(p, slot.region, cw, ch);
        bind(0, slot.scene, p.u.uScene);
        gl.uniform2f(p.u.uCells, cw, ch); gl.uniform1f(p.u.uSeed, seed);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        slot.read = read; slot.key = variant + usePerson; stats.refreshes++;
      }
      const p = res.draw;
      pass(p, null, w, h);
      bind(0, slot.region, p.u.uRegion); bind(1, res.bank, p.u.uBank); bind(2, res.pal, p.u.uPal);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(p.u.uCells, cw, ch); gl.uniform2f(p.u.uOut, w, h); gl.uniform1f(p.u.uTile, tile);
      gl.uniform1f(p.u.uTick, tick);
      gl.uniform1f(p.u.uBreak, clamp(o.rotura == null ? 0.55 : o.rotura, 0, 1));
      gl.uniform1f(p.u.uRun, audio ? clamp(audio.mid || 0) * 3 : 0);      // los medios alargan las tiras (de 3–6 a 3–9)
      gl.uniform1f(p.u.uCut, usePerson ? 1 : 0);
      gl.uniform1f(p.u.uDim, dim ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ctx.save();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      ctx.imageSmoothingEnabled = false;                                   // (los colores de la paleta, tal cual)
      ctx.drawImage(canvas, 0, canvas.height - h, w, h, 0, 0, outW, outH);
      ctx.restore();
      slot.at = started; slot.frames++; slot.mirror = !!mirror;
      if (slot.restore) { canvas.width = slot.restore[0]; canvas.height = slot.restore[1]; slot.restore = null; }
      Object.assign(stats, { tick, dim, cut: usePerson });
    } catch (error) {
      return !!gl;
    }
    const ms = performance.now() - started;
    Object.assign(stats, { frames: stats.frames + 1, ms, msAvg: stats.msAvg ? stats.msAvg * 0.9 + ms * 0.1 : ms, variant, cells: [cw, ch], tilePx: +(tile / k).toFixed(4), size: [w, h], person: person.phase, share: +person.share.toFixed(3) });
    return true;
  }

  function release() {
    if (!gl) return;
    const ext = gl.getExtension('WEBGL_lose_context');
    const old = canvas;
    slots.clear();
    gl = null; canvas = null; res = null;
    try { if (ext) ext.loseContext(); } catch (_) {}
    if (old) { old.width = 1; old.height = 1; }
  }

  window.renderTesela = renderTesela;
  window.flipTesela = {
    release,
    // Para las pruebas: el banco (32 baldosas de 64 tonos 0–3, en el orden de la textura), sus nombres y las sub-paletas.
    bank: () => TILES.map(t => Array.from(t)),
    names: NAMES.slice(),
    palettes: PALETTES.map(p => p.slice()),
    state: () => ({ ready: !!gl, failed, lost, slots: [...slots.keys()], ...stats, ms: +stats.ms.toFixed(2), msAvg: +stats.msAvg.toFixed(2) }),
  };
})();
