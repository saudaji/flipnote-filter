// FLIP STAGE · VS-27 — sintetizador de vídeo modular de bolsillo.
//
// Una central de visuales en vivo: la señal recorre un rack de módulos como en un sintetizador
// de vídeo analógico y sale limpia por la pantalla, lista para un proyector o un monitor.
//
//   FUENTE A (cámara, directa o pasada por un emulador de FLIP) ─┐
//   FUENTE B (generador: barras, plasma, anillos, rejilla, nieve, │→ MEZCLA / CLAVE → BUCLE
//             osciloscopio, espectro, carta de ajuste) ───────────┘   (realimentación: el
//   circuito cerrado) → GEOMETRÍA (caleidoscopio, espejos, mosaico, onda) → COLOR → SEÑAL
//   (RGB, rasgado, V-HOLD, líneas, nieve, estrobo) → SALIDA.
//
// Todo mando es un destino de modulación. Las fuentes (dos LFO, graves, medios, agudos, golpe,
// el pad XY del monitor, las notas MIDI y la mano delante de la cámara) se parchean tocando su
// toma y luego una perilla: aparece el cable. Ocho escenas con transición, MIDI con aprendizaje
// (CC a perillas, notas a escenas), reloj MIDI y tempo a golpes.
//
// El dibujo es WebGL 2 en dos pases (composición con realimentación + acabado). En Android la
// cámara entra por sus planos nativos (sensor.js) y se convierte a color en el sombreador.
// Salida: pantalla completa limpia en el teléfono (el cable USB-C la duplica en el proyector) o
// una ventana aparte en el ordenador (stage-out.html), que esta página pinta directamente.
const flipStage = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const ANDROID = /Android/i.test(navigator.userAgent);
  const COARSE = matchMedia('(pointer: coarse)').matches;
  const feel = {
    detent: x => { if (window.flipFeel) flipFeel.detent(x); },
    tap: (kind, phase, x) => { if (window.flipFeel) flipFeel.tap(kind, phase, x); },
    hush: (key, on) => { if (window.flipFeel) flipFeel.hush(key, on); },
  };

  // ── Tablas ──────────────────────────────────────────────────────────────────
  // Moduladores: clave, rótulo, color del cable, bipolar (−1…1) o no (0…1).
  const SOURCES = [
    ['lfo1', 'LFO 1', '#ec5b45', true], ['lfo2', 'LFO 2', '#f0ae2b', true], ['bass', 'BAJO', '#2f78dc'], ['mid', 'MEDIO', '#33b09f'],
    ['high', 'AGUDO', '#8b79d6'], ['beat', 'GOLPE', '#e5392b'], ['padx', 'PAD X', '#566679'], ['pady', 'PAD Y', '#8d8572'],
    ['note', 'NOTA', '#3ca956'], ['hx', 'MANO X', '#f08a2d'], ['hy', 'MANO Y', '#d7559b'], ['pinch', 'PINZA', '#3b3c3f'],
  ];
  const SRC = Object.fromEntries(SOURCES.map(s => [s[0], { label: s[1], tone: s[2], bipolar: !!s[3] }]));
  // Mandos: clave → [rótulo, valor de fábrica, tiene centro].
  const P = {
    'gen.freq': ['FREC', .35], 'gen.speed': ['VELOC', .62, true], 'gen.shape': ['FORMA', .3], 'gen.hue': ['TONO', .55],
    'mix.fade': ['FUNDIDO', 0], 'key.level': ['UMBRAL', .5], 'key.soft': ['BORDE', .25],
    'fb.amt': ['CANTIDAD', 0], 'fb.zoom': ['ZOOM', .5, true], 'fb.rot': ['GIRO', .5, true], 'fb.decay': ['PERSIST', .8],
    'fb.x': ['DERIVA X', .5, true], 'fb.y': ['DERIVA Y', .5, true], 'fb.hue': ['TINTE', 0],
    'geo.zoom': ['ZOOM', .5, true], 'geo.rot': ['ÁNGULO', .5, true], 'geo.spin': ['GIRO', .5, true], 'geo.kal': ['CALEIDO', 0],
    'geo.tile': ['MOSAICO', 0], 'geo.warp': ['ONDA', 0], 'geo.wfreq': ['RIZO', .3],
    'col.hue': ['MATIZ', 0], 'col.sat': ['SATUR', .5, true], 'col.con': ['CONTRASTE', .5, true], 'col.cycle': ['CICLO', .5, true],
    'col.tint': ['TINTA', 0], 'col.post': ['POSTER', 0], 'col.solar': ['SOLAR', 0],
    'sig.rgb': ['RGB', 0], 'sig.tear': ['RASGADO', 0], 'sig.vhold': ['V-HOLD', .5, true], 'sig.bleed': ['CROMA', 0],
    'sig.pix': ['PÍXEL', 0], 'sig.scan': ['LÍNEAS', 0], 'sig.noise': ['NIEVE', 0], 'sig.strobe': ['ESTROBO', 0],
    'lfo1.rate': ['RITMO 1', .35], 'lfo2.rate': ['RITMO 2', .6], 'aud.gain': ['SENSIB', .5, true], 'aud.fall': ['CAÍDA', .4],
    'out.level': ['NIVEL', 1], 'mod.morph': ['TRANSICIÓN', .22],
  };
  const IDS = Object.keys(P);
  const GLOBAL_IDS = ['aud.gain', 'aud.fall', 'out.level', 'mod.morph'];      // no cambian al cambiar de escena
  const SCENE_IDS = IDS.filter(id => !GLOBAL_IDS.includes(id));
  const D0 = { 'src.look': 'RAW', 'src.gen': 2, 'mix.mode': 0, 'key.inv': 0, 'fb.mode': 0, 'geo.mirror': 0, 'col.pal': 0, 'col.inv': 0, 'lfo1.shape': 0, 'lfo2.shape': 1, 'lfo.sync': 0 };
  const GENS = ['NEGRO', 'BARRAS', 'PLASMA', 'ANILLOS', 'REJILLA', 'NIEVE', 'ONDA', 'ESPECTRO', 'CARTA'];
  const MIX_MODES = ['MEZCLA', 'SUMA', 'MULTIPLICA', 'DIFERENCIA', 'CLAVE DE LUZ', 'SILUETA'];
  const FB_MODES = ['ECO', 'ESTELA', 'CLAVE'];
  const MIRRORS = ['NO', 'HORIZONTAL', 'VERTICAL', 'CUATRO'];
  const PALETTES = [['FÓSFORO', '#020a04', '#1fae4a', '#d8ffd0'], ['ÁMBAR', '#0c0500', '#d9770a', '#ffe9b0'], ['HIELO', '#02040e', '#2f78dc', '#e6f6ff'],
    ['FUEGO', '#0a0002', '#e5392b', '#ffd24a'], ['NEÓN', '#0a0030', '#e6399b', '#3df0e0'], ['CREMA', '#3a3833', '#ec5b45', '#f3efe5'], ['ULTRA', '#12002a', '#8b79d6', '#f0ae2b']];
  const LFO_SHAPES = ['SENO', 'TRIÁNGULO', 'SIERRA', 'CUADRADA', 'AZAR'];
  const ASPECTS = ['16:9', '4:3', '1:1', '9:16'], ASPECT_DIMS = [[16, 9], [4, 3], [1, 1], [9, 16]];
  const QUALITIES = ['AUTO', '540P', '720P', '1080P'], QUALITY_H = [0, 540, 720, 1080], LADDER = [360, 432, 540, 720];
  const DIVS = [[1 / 32, '8 COMPASES'], [1 / 16, '4 COMPASES'], [1 / 8, '2 COMPASES'], [1 / 4, '1 COMPÁS'], [1 / 2, '1/2'], [1, '1/4'], [2, '1/8'], [4, '1/16']];
  const LOOKS = (() => {
    const list = [{ key: 'RAW', label: 'DIRECTA' }];
    if (typeof CAM_FAMILIES === 'object') for (const [key, cfg] of Object.entries(CAM_FAMILIES)) if (key !== 'SLHT') list.push({ key, label: (cfg.displayLabel || cfg.label || key).toUpperCase() });
    list.push({ key: 'ASCII', label: 'ASCII' });
    return list;
  })();
  const OPTIONS = {
    'src.look': LOOKS.map(l => l.label), 'src.gen': GENS, 'mix.mode': MIX_MODES, 'fb.mode': FB_MODES, 'geo.mirror': MIRRORS, 'col.pal': PALETTES.map(p => p[0]),
    'lfo1.shape': LFO_SHAPES, 'lfo2.shape': LFO_SHAPES, 'out.aspect': ASPECTS, 'out.quality': QUALITIES,
  };
  const PAGES = [
    { id: 'src', label: 'FUENTE', title: 'FUENTES · A CÁMARA · B GENERADOR', picks: [['src.look', 'A · CÁMARA'], ['src.gen', 'B · GENERADOR']], knobs: ['gen.freq', 'gen.speed', 'gen.shape', 'gen.hue'] },
    { id: 'mix', label: 'MEZCLA', title: 'MEZCLADOR Y CLAVE', picks: [['mix.mode', 'MODO']], fader: 'mix.fade', knobs: ['key.level', 'key.soft'], toggles: [['key.inv', 'INVERTIR']] },
    { id: 'fb', label: 'BUCLE', title: 'BUCLE · CIRCUITO CERRADO', picks: [['fb.mode', 'MODO']], knobs: ['fb.amt', 'fb.zoom', 'fb.rot', 'fb.decay', 'fb.x', 'fb.y', 'fb.hue'] },
    { id: 'geo', label: 'GEOM', title: 'GEOMETRÍA', picks: [['geo.mirror', 'ESPEJO']], knobs: ['geo.zoom', 'geo.rot', 'geo.spin', 'geo.kal', 'geo.tile', 'geo.warp', 'geo.wfreq'] },
    { id: 'col', label: 'COLOR', title: 'COLOR', picks: [['col.pal', 'PALETA DE TINTA']], knobs: ['col.hue', 'col.sat', 'col.con', 'col.cycle', 'col.tint', 'col.post', 'col.solar'], toggles: [['col.inv', 'NEGATIVO']] },
    { id: 'sig', label: 'SEÑAL', title: 'SEÑAL DE VÍDEO', knobs: ['sig.rgb', 'sig.tear', 'sig.vhold', 'sig.bleed', 'sig.pix', 'sig.scan', 'sig.noise', 'sig.strobe'] },
    { id: 'mod', label: 'MOD', title: 'MODULACIÓN', picks: [['lfo1.shape', 'LFO 1'], ['lfo2.shape', 'LFO 2']], knobs: ['lfo1.rate', 'lfo2.rate', 'aud.gain', 'aud.fall'] },
    { id: 'out', label: 'SALIDA', title: 'SALIDA', picks: [['out.aspect', 'FORMATO'], ['out.quality', 'CALIDAD']], knobs: ['out.level', 'mod.morph'], toggles: [['out.flipX', 'VOLTEAR H'], ['out.flipY', 'VOLTEAR V']] },
  ];

  // ── Escenas de fábrica ──────────────────────────────────────────────────────
  const basePatch = () => { const p = {}; for (const id of SCENE_IDS) p[id] = P[id][1]; return p; };
  const scene = (name, p = {}, d = {}, r = []) => ({ name, p: Object.assign(basePatch(), p), d: Object.assign({}, D0, d), r });
  const FACTORY = () => [
    scene('DIRECTO', { 'sig.scan': .22, 'sig.rgb': .1, 'col.sat': .56, 'col.con': .55 }, {}, [['bass', 'sig.rgb', .4], ['beat', 'geo.zoom', .07]]),
    scene('TÚNEL', { 'fb.amt': .88, 'fb.zoom': .62, 'fb.rot': .53, 'fb.hue': .1, 'fb.decay': .86, 'col.sat': .6 }, {}, [['lfo1', 'fb.rot', .1], ['bass', 'fb.zoom', .12]]),
    scene('MANDALA', { 'geo.kal': .55, 'geo.spin': .56, 'geo.zoom': .44, 'fb.amt': .6, 'fb.zoom': .53, 'fb.decay': .84, 'col.sat': .66, 'lfo1.rate': .22 }, { 'fb.mode': 1 }, [['lfo1', 'geo.zoom', .14], ['mid', 'col.hue', .25]]),
    scene('SILUETA', { 'mix.fade': 1, 'key.level': .5, 'key.soft': .3, 'gen.freq': .3, 'gen.speed': .64, 'gen.hue': .62, 'gen.shape': .5 }, { 'mix.mode': 5, 'src.gen': 2 }, [['bass', 'gen.freq', .22], ['lfo2', 'gen.hue', .2]]),
    scene('VHS', { 'sig.tear': .34, 'sig.bleed': .62, 'sig.scan': .5, 'sig.noise': .34, 'sig.rgb': .26, 'col.sat': .62, 'col.con': .56 }, {}, [['beat', 'sig.tear', .5], ['lfo2', 'sig.noise', .12]]),
    scene('NEÓN', { 'col.solar': .72, 'col.tint': .82, 'col.post': .3, 'fb.amt': .5, 'fb.hue': .22, 'fb.decay': .86, 'fb.zoom': .52 }, { 'col.pal': 4, 'fb.mode': 1 }, [['lfo1', 'col.hue', .5], ['high', 'sig.rgb', .35]]),
    scene('OSCILOS', { 'mix.fade': .9, 'gen.freq': .5, 'gen.hue': .3, 'gen.shape': .2, 'fb.amt': .86, 'fb.zoom': .44, 'fb.hue': .07, 'fb.decay': .9, 'col.sat': .4 }, { 'mix.mode': 1, 'src.gen': 6, 'fb.mode': 1 }, [['bass', 'fb.zoom', -.1], ['mid', 'gen.hue', .3]]),
    scene('CARTA', { 'mix.fade': 1 }, { 'src.gen': 8 }, []),
  ];

  // ── Estado guardado ─────────────────────────────────────────────────────────
  const STORE = 'flip.stage.v2';
  function fresh() { return { v: 2, scene: 0, scenes: FACTORY(), live: null, global: { aspect: 0, quality: 0, flipX: 0, flipY: 0, bpm: 0, p: {} }, midi: { cc: {}, note: {} } }; }
  function tidyPatch(patch, fallback) {
    const out = { name: String(patch && patch.name || fallback.name).slice(0, 12), p: {}, d: {}, r: [] };
    for (const id of SCENE_IDS) out.p[id] = Number.isFinite(patch && patch.p && patch.p[id]) ? clamp(patch.p[id]) : fallback.p[id];
    for (const id of Object.keys(D0)) out.d[id] = patch && patch.d && id in patch.d ? patch.d[id] : fallback.d[id];
    if (!LOOKS.some(l => l.key === out.d['src.look'])) out.d['src.look'] = 'RAW';
    for (const r of (patch && patch.r) || []) if (Array.isArray(r) && SRC[r[0]] && P[r[1]] && Number.isFinite(r[2]) && out.r.length < 24) out.r.push([r[0], r[1], clamp(r[2], -1, 1)]);
    return out;
  }
  function load() {
    const base = fresh();
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!raw || raw.v !== 2 || !Array.isArray(raw.scenes)) return base;
      base.scenes = base.scenes.map((factory, i) => tidyPatch(raw.scenes[i], factory));
      base.scene = clamp(raw.scene | 0, 0, 7);
      if (raw.live) base.live = tidyPatch(raw.live, base.scenes[base.scene]);
      const g = raw.global || {};
      Object.assign(base.global, { aspect: clamp(g.aspect | 0, 0, 3), quality: clamp(g.quality | 0, 0, 3), flipX: g.flipX ? 1 : 0, flipY: g.flipY ? 1 : 0, bpm: Number.isFinite(g.bpm) ? g.bpm : 0 });
      for (const id of GLOBAL_IDS) if (g.p && Number.isFinite(g.p[id])) base.global.p[id] = clamp(g.p[id]);
      if (raw.midi) { base.midi.cc = Object.assign({}, raw.midi.cc); base.midi.note = Object.assign({}, raw.midi.note); }
    } catch (_) {}
    return base;
  }
  let store = load();
  const live = { p: {}, d: {}, r: [] };
  function adopt(patch) {
    for (const id of SCENE_IDS) live.p[id] = patch.p[id];
    for (const id of GLOBAL_IDS) live.p[id] = id in store.global.p ? store.global.p[id] : P[id][1];
    live.d = Object.assign({}, patch.d);
    live.r = patch.r.map(r => r.slice());
  }
  adopt(store.live || store.scenes[store.scene]);
  const snapshot = name => ({ name, p: Object.fromEntries(SCENE_IDS.map(id => [id, +live.p[id].toFixed(4)])), d: Object.assign({}, live.d), r: live.r.map(r => [r[0], r[1], +r[2].toFixed(3)]) });
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store.live = snapshot(store.scenes[store.scene].name);
      for (const id of GLOBAL_IDS) store.global.p[id] = live.p[id];
      try { localStorage.setItem(STORE, JSON.stringify(store)); } catch (_) {}
    }, 350);
  }

  // ── Sombreadores ────────────────────────────────────────────────────────────
  const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  const COMMON = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
const float PI = 3.14159265, TAU = 6.2831853;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float luma(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
vec3 hueTurn(vec3 c, float t) {
  float a = t * TAU, cs = cos(a), sn = sin(a);
  const vec3 k = vec3(.57735);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1. - cs);
}
vec3 pal(float t) { return .5 + .5 * cos(TAU * (t + vec3(0., .33, .67))); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 mirrorUv(vec2 uv) { vec2 m = mod(uv, 2.); return mix(m, 2. - m, step(1., m)); }
`;
  // Pase 1 · fuentes, mezcla, geometría y bucle. Coordenadas de imagen: origen arriba a la izquierda.
  const COMPOSE = COMMON + `
uniform sampler2D uA, uU, uV, uFb, uMask, uAudio;
uniform vec2 uRes;
uniform float uAspect;
uniform vec4 uFitA;
uniform mat3 uYuv;
uniform vec3 uYuvOff;
uniform int uCamKind, uGen, uMixMode, uFbMode, uMirror;
uniform float uMirrorA, uHasA, uHasMask, uKeyInv;
uniform float uGenFreq, uGenPhase, uGenShape, uGenHue;
uniform float uFade, uKeyLevel, uKeySoft;
uniform float uFbAmt, uFbZoom, uFbRot, uFbHue, uFbGain;
uniform vec2 uFbShift;
uniform float uZoom, uRot, uKal, uTile, uWarp, uWarpFreq, uWarpPhase;

vec3 srcA(vec2 uv) {
  if (uHasA < .5) return vec3(0.);
  vec2 c = mirrorUv(uv);
  c.x = mix(c.x, 1. - c.x, uMirrorA);
  c = c * uFitA.xy + uFitA.zw;
  if (uCamKind == 0) return texture(uA, c).rgb;
  if (uCamKind == 3) return texture(uA, c).bgr;
  vec2 chroma = uCamKind == 1 ? vec2(texture(uU, c).r, texture(uV, c).r) : texture(uU, c).rg;
  return clamp(uYuv * (vec3(texture(uA, c).r, chroma) - uYuvOff), 0., 1.);
}
float audioBin(float x) { return texture(uAudio, vec2(x, .25)).r; }
float audioWave(float x) { return texture(uAudio, vec2(x, .75)).r * 2. - 1.; }

vec3 gen(vec2 p, vec2 st) {
  float f = uGenFreq, ph = uGenPhase, sh = uGenShape;
  if (uGen == 1) {                                   // BARRAS: oscilador de barras, giran con FORMA
    float a = sh * PI, x = p.x * cos(a) + p.y * sin(a);
    float s = .5 + .5 * sin(x * f * PI + ph * TAU);
    return pal(uGenHue + floor(x * f * .5 + ph) * .17) * smoothstep(.3, .7, s);
  }
  if (uGen == 2) {                                   // PLASMA
    float v = sin(p.x * f * .9 + ph * TAU) + sin(p.y * f * 1.3 - ph * TAU * .7) + sin((p.x + p.y) * f * .7 + ph * TAU * .4)
      + sin(length(p * f * .8 + vec2(sin(ph * TAU * .3), cos(ph * TAU * .2))) * 2.);
    return pal(uGenHue + v * (.06 + sh * .22));
  }
  if (uGen == 3) {                                   // ANILLOS: de círculos a cuadrados
    float r = mix(length(p), max(abs(p.x), abs(p.y)) * 1.2, sh);
    float s = .5 + .5 * sin(r * f * TAU * .6 - ph * TAU * 2.);
    return pal(uGenHue + r * .5) * smoothstep(.35, .65, s);
  }
  if (uGen == 4) {                                   // REJILLA: plana o suelo en fuga
    float d = p.y - mix(-.9, -.05, sh);
    vec2 q = sh < .02 ? p : vec2(p.x / max(d, .02), 1. / max(d, .02)) * .25;
    q.y += ph;
    vec2 l = abs(fract(q * f * .5) - .5);
    float fog = sh < .02 ? 1. : smoothstep(0., .25, d);
    return pal(uGenHue) * (1. - smoothstep(0., .07, min(l.x, l.y))) * fog;
  }
  if (uGen == 5) {                                   // NIEVE
    float n = hash(floor(st * uRes / (1. + f * .2)) + floor(ph * 60.) * 7.13);
    float band = .75 + .25 * sin(st.y * 30. * (sh + .05) + ph * TAU * 4.);
    return mix(vec3(n), pal(uGenHue + n * .2) * n, sh) * band;
  }
  if (uGen == 6) {                                   // ONDA: osciloscopio del sonido
    float d = abs(p.y - audioWave(st.x) * (.08 + f * .012));
    return pal(uGenHue + st.x * .25) * (1. - smoothstep(0., .006 + sh * .03, d) + .12 / (1. + d * d * 2400.));
  }
  if (uGen == 7) {                                   // ESPECTRO
    float n = 6. + floor(f * 1.4), xi = (floor(st.x * n) + .5) / n;
    float h = audioBin(pow(xi, 1.7) * .75) * (.35 + sh * .65);
    return pal(uGenHue + (1. - st.y) * .35) * step(1. - st.y, h) * step(.1, fract(st.x * n));
  }
  if (uGen == 8) {                                   // CARTA de ajuste
    vec3 c;
    if (st.y < .64) { float k = 7. - floor(st.x * 7.); c = .75 * vec3(mod(floor(k / 2.), 2.), mod(floor(k / 4.), 2.), mod(k, 2.)); }
    else if (st.y < .76) c = vec3(st.x);
    else { vec2 g = abs(fract(p * 8.) - .5); c = vec3((1. - smoothstep(0., .04, min(g.x, g.y))) * .8); }
    c = mix(c, vec3(1.), 1. - smoothstep(0., .006, abs(length(p) - .42)));
    c = mix(c, vec3(1.), (1. - smoothstep(0., .003, min(abs(p.x), abs(p.y)))) * step(length(p), .42));
    return c;
  }
  return vec3(0.);
}

void main() {
  vec2 st = vec2(vUv.x, 1. - vUv.y);
  vec2 asp = vec2(uAspect, 1.);
  // GEOMETRÍA: actúa sobre las coordenadas con las que se leen las dos fuentes.
  vec2 p = rot(uRot) * ((st - .5) * asp) / uZoom;
  if (uWarp > 0.) p += uWarp * vec2(sin(p.y * uWarpFreq + uWarpPhase), cos(p.x * uWarpFreq * .9 + uWarpPhase * 1.3));
  if (uKal >= 2.) {
    float seg = TAU / uKal, a = atan(p.x, -p.y), r = length(p);
    a = abs(mod(a + seg * .5, seg) - seg * .5);
    p = r * vec2(sin(a), -cos(a));
  }
  if (uMirror == 1 || uMirror == 3) p.x = -abs(p.x);
  if (uMirror == 2 || uMirror == 3) p.y = -abs(p.y);
  vec2 uv = p / asp + .5;
  if (uTile > 1.) uv = mirrorUv(uv * uTile);
  vec3 a = srcA(uv);
  vec3 b = gen((uv - .5) * asp, uv);
  // MEZCLA
  vec3 c;
  if (uMixMode == 0) c = mix(a, b, uFade);
  else if (uMixMode == 1) c = a + b * uFade;
  else if (uMixMode == 2) c = a * mix(vec3(1.), b * 1.6, uFade);
  else if (uMixMode == 3) c = mix(a, abs(a - b), uFade);
  else {
    float k = uMixMode == 4 ? luma(a) : (uHasMask > .5 ? texture(uMask, mirrorUv(uv)).r : 1.);
    k = smoothstep(uKeyLevel - uKeySoft, uKeyLevel + uKeySoft, k);
    k = mix(k, 1. - k, uKeyInv);
    c = mix(a, mix(b, a, k), uFade);
  }
  // BUCLE: el cuadro anterior vuelve transformado (el circuito cerrado).
  if (uFbAmt > 0.) {
    vec2 q = rot(uFbRot) * ((st - .5) * asp) / uFbZoom + uFbShift;
    vec2 fuv = q / asp + .5;
    vec3 f = texture(uFb, vec2(fuv.x, 1. - fuv.y)).rgb;
    vec2 edge = smoothstep(vec2(0.), vec2(.012), fuv) * smoothstep(vec2(0.), vec2(.012), 1. - fuv);
    f *= edge.x * edge.y;
    if (uFbHue > 0.) f = hueTurn(f, uFbHue);
    f = max(vec3(0.), f * uFbGain - .003);
    if (uFbMode == 0) c = mix(c, f, uFbAmt);
    else if (uFbMode == 1) c = mix(c, max(c, f), uFbAmt);
    else c = mix(c, mix(f, c, smoothstep(.22, .6, luma(c))), uFbAmt);
  }
  outColor = vec4(clamp(c, 0., 1.), 1.);
}`;
  // Pase 2 · color y señal, a pantalla.
  const POST = COMMON + `
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uTime;
uniform float uRgb, uTear, uRoll, uRollOn, uPix, uScan, uNoise, uBleed, uGate;
uniform float uHue, uSat, uCon, uPost, uSolar, uTint, uInv, uLevel, uFlipX, uFlipY;
uniform vec3 uTintA, uTintB, uTintC;
vec3 tex(vec2 st) { return texture(uSrc, vec2(st.x, 1. - st.y)).rgb; }
void main() {
  vec2 st = vec2(vUv.x, 1. - vUv.y);
  st = mix(st, 1. - st, vec2(uFlipX, uFlipY));
  float seam = 1.;
  if (uRollOn > .5) { float fy = fract(st.y + uRoll); seam = smoothstep(0., .03, min(fy, 1. - fy)); st.y = fy; }
  if (uTear > 0.) {
    float band = floor(st.y * 16.), tick = floor(uTime * 11.);
    st.x += step(1. - uTear * .4, hash(vec2(band, tick))) * (hash(vec2(band + 3., tick)) - .5) * .22 * uTear;
    st.x += (hash(vec2(floor(st.y * uRes.y * .5), floor(uTime * 30.))) - .5) * .006 * uTear;
    st.x += uTear * .06 * pow(max(0., st.y - .92) / .08, 2.) * sin(uTime * 23.);
  }
  if (uPix > 0.) { vec2 cells = vec2(uPix * uRes.x / uRes.y, uPix); st = (floor(st * cells) + .5) / cells; }
  vec3 c = uRgb > 0. ? vec3(tex(st + vec2(uRgb, 0.)).r, tex(st).g, tex(st - vec2(uRgb, 0.)).b) : tex(st);
  if (uBleed > 0.) {
    vec3 s = (tex(st - vec2(.006, 0.)) + tex(st - vec2(.013, 0.)) + tex(st - vec2(.021, 0.))) / 3.;
    c = mix(c, vec3(luma(c)) + (s - luma(s)) * 1.2, uBleed);
  }
  if (uHue != 0.) c = hueTurn(c, uHue);
  c = mix(vec3(luma(c)), c, uSat);
  c = (c - .5) * uCon + .5;
  if (uSolar > 0.) c = mix(c, 1. - abs(2. * c - 1.), uSolar);
  if (uPost >= 2.) c = floor(clamp(c, 0., 1.) * (uPost - 1.) + .5) / (uPost - 1.);
  if (uTint > 0.) {
    float l = clamp(luma(c), 0., 1.);
    c = mix(c, l < .5 ? mix(uTintA, uTintB, l * 2.) : mix(uTintB, uTintC, l * 2. - 1.), uTint);
  }
  c = mix(c, 1. - c, uInv);
  if (uScan > 0.) c *= (1. - uScan * .5 * (.5 + .5 * cos(st.y * 240. * TAU))) * (1. + uScan * .18);
  if (uNoise > 0.) c = mix(c, vec3(hash(st * uRes + fract(uTime) * 311.7)), uNoise * .7);
  outColor = vec4(clamp(c * uGate * seam * uLevel, 0., 1.), 1.);
}`;

  // ── Motor ───────────────────────────────────────────────────────────────────
  const eng = { canvas: null, gl: null, ok: false, error: '', w: 0, h: 0, fb: [], flip: 0, alloc: {}, camKind: 0, camSeq: -1, hasA: false, hasMask: false, maskSeq: -1, maskBytes: null, fit: [1, 1, 0, 0], mirror: 0, yuvKey: '', path: '' };
  const state = { active: false, raf: 0, clean: false, failed: 0 };
  const clock = { last: 0, t: 0, n: 0, fps: 60, slow: 0, fast: 0, autoH: COARSE ? 540 : 720, dtAvg: 16.7 };
  const ph = { gen: 0, spin: 0, cycle: 0, roll: 0, warp: 0, lfo: [0, 0], rnd: [{ cycle: -1, from: 0, to: 0 }, { cycle: -1, from: 0, to: 0 }] };
  const mods = Object.fromEntries(SOURCES.map(s => [s[0], 0]));
  const val = {};
  const hex = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);

  function program(frag) {
    const gl = eng.gl;
    const make = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error((gl.getShaderInfoLog(shader) || 'sombreador').slice(0, 500));
      return shader;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, make(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, make(gl.FRAGMENT_SHADER, frag)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error((gl.getProgramInfoLog(pr) || 'enlace').slice(0, 500));
    const where = {};
    const at = name => (name in where ? where[name] : (where[name] = gl.getUniformLocation(pr, name)));
    return { pr, f: (n, x) => gl.uniform1f(at(n), x), i: (n, x) => gl.uniform1i(at(n), x), v2: (n, x, y) => gl.uniform2f(at(n), x, y),
      v3: (n, a) => gl.uniform3f(at(n), a[0], a[1], a[2]), v4: (n, a) => gl.uniform4f(at(n), a[0], a[1], a[2], a[3]), m3: (n, a) => gl.uniformMatrix3fv(at(n), false, a) };
  }
  function texture() {
    const gl = eng.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return t;
  }
  function initGl() {
    const gl = eng.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) { eng.error = 'sin WebGL 2'; return false; }
    eng.gl = gl;
    try { eng.compose = program(COMPOSE); eng.post = program(POST); } catch (error) { eng.error = String(error && error.message || error); return false; }
    gl.bindVertexArray(gl.createVertexArray());
    eng.texA = texture(); eng.texU = texture(); eng.texV = texture(); eng.texMask = texture(); eng.texAudio = texture();
    eng.alloc = {};
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    eng.w = 0;
    resize();
    return true;
  }
  function size() {
    const g = store.global, [aw, ah] = ASPECT_DIMS[g.aspect];
    const short = QUALITY_H[g.quality] || clock.autoH;
    const even = n => Math.max(2, Math.round(n / 2) * 2);
    return aw >= ah ? [even(short * aw / ah), short] : [short, even(short * ah / aw)];
  }
  function resize() {
    const gl = eng.gl;
    if (!gl) return;
    const [w, h] = size();
    if (w === eng.w && h === eng.h) return;
    eng.w = w; eng.h = h;
    eng.canvas.width = w; eng.canvas.height = h;
    for (const old of eng.fb) { gl.deleteFramebuffer(old.f); gl.deleteTexture(old.t); }
    eng.fb = [0, 1].map(() => {
      const t = texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return { t, f };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    eng.flip = 0;
    look.key = '';
    if (ui.screen) ui.screen.style.setProperty('--ar', (w / h).toFixed(4));
  }
  // Sube un plano de 8 bits, reservando la textura solo cuando cambia de tamaño.
  function plane(name, tex, format, internal, w, h, data, offset, rowLength) {
    const gl = eng.gl, key = internal + ':' + w + 'x' + h;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, rowLength);
    if (eng.alloc[name] !== key) { eng.alloc[name] = key; gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, data, offset); }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, gl.UNSIGNED_BYTE, data, offset);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  }
  function fitCover(sw, sh) {
    const sa = sw / sh, oa = eng.w / eng.h;
    const sx = sa > oa ? oa / sa : 1, sy = sa > oa ? 1 : sa / oa;
    eng.fit = [sx, sy, .5 - .5 * sx, .5 - .5 * sy];
  }

  // ── Fuentes ─────────────────────────────────────────────────────────────────
  const look = { base: null, bctx: null, canvas: null, ctx: null, at: -Infinity, key: '' };
  const camState = { dirty: true, hooked: false, forceDirect: false };
  function camReady() { return !!camState.injected || (typeof vid !== 'undefined' && vid && vid.videoWidth > 0 && vid.readyState >= 2 && typeof stream !== 'undefined' && !!stream); }
  function hookVideo() {
    if (camState.hooked || typeof vid === 'undefined' || !vid.requestVideoFrameCallback) return;
    camState.hooked = true;
    const loop = () => { camState.dirty = true; if (state.active) vid.requestVideoFrameCallback(loop); else camState.hooked = false; };
    vid.requestVideoFrameCallback(loop);
  }
  function uploadRaw() {
    const gl = eng.gl;
    // Android: los planos nativos de la cámara, sin pasar por la conversión del navegador.
    if (camState.injected || (ANDROID && !camState.forceDirect && flipSensor.planesUsable(vid))) {
      if (!camState.injected) flipSensor.planes(vid);
      const pl = camState.injected || flipSensor.latestPlanes(vid);
      if (pl) {
        if (pl.seq !== eng.camSeq) {
          eng.camSeq = pl.seq;
          const L = pl.layout, w = pl.width, h = pl.height, cw = (w + 1) >> 1, ch = (h + 1) >> 1;
          if (pl.kind === 'planar') {
            plane('A', eng.texA, gl.RED, gl.R8, w, h, pl.data, L[0].offset, L[0].stride);
            plane('U', eng.texU, gl.RED, gl.R8, cw, ch, pl.data, L[1].offset, L[1].stride);
            plane('V', eng.texV, gl.RED, gl.R8, cw, ch, pl.data, L[2].offset, L[2].stride);
            eng.camKind = 1;
          } else if (pl.kind === 'biplanar') {
            plane('A', eng.texA, gl.RED, gl.R8, w, h, pl.data, L[0].offset, L[0].stride);
            plane('U', eng.texU, gl.RG, gl.RG8, cw, ch, pl.data, L[1].offset, L[1].stride >> 1);
            eng.camKind = 2;
          } else {
            plane('A', eng.texA, gl.RGBA, gl.RGBA8, w, h, pl.data, L[0].offset, L[0].stride >> 2);
            eng.camKind = pl.kind === 'bgr' ? 3 : 0;
          }
          const key = pl.matrix + ':' + pl.fullRange;
          if (key !== eng.yuvKey) {
            eng.yuvKey = key;
            const k = flipSensor.coefficients(pl.matrix, pl.fullRange);
            eng.yuv = new Float32Array([k.scale, k.scale, k.scale, 0, k.gu, k.bu, k.rv, k.gv, 0]);
            eng.yuvOff = [k.offset, .5, .5];
          }
          fitCover(w, h);
          eng.path = 'planos ' + pl.format;
        }
        eng.hasA = true;
        return;
      }
      if (flipSensor.planesUsable(vid) && eng.path.startsWith('planos')) { eng.hasA = true; return; }   // el siguiente está en camino
    }
    if (camState.dirty || !camState.hooked || eng.path !== 'directa') {
      camState.dirty = false;
      gl.bindTexture(gl.TEXTURE_2D, eng.texA);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid);
      eng.alloc.A = '';
    }
    eng.camKind = 0; eng.path = 'directa';
    fitCover(vid.videoWidth, vid.videoHeight);
    eng.hasA = true;
  }
  // La cámara en un lienzo pequeño, recortada al formato de salida y en espejo si es la frontal:
  // de ahí beben los emuladores, la silueta y el seguimiento de manos.
  function cpuFrame() {
    if (flipSensor.usable(vid) && !flipSensor.pending(vid)) flipSensor.prime(vid);
    const cam = liveCamFrame(260);
    if (!cam || !cam.srcW) return null;
    const long = 640, w = eng.w >= eng.h ? long : Math.round(long * eng.w / eng.h / 2) * 2, h = eng.w >= eng.h ? Math.round(long * eng.h / eng.w / 2) * 2 : long;
    if (!look.base) {
      look.base = document.createElement('canvas'); look.bctx = look.base.getContext('2d', { willReadFrequently: true });
      look.canvas = document.createElement('canvas'); look.ctx = look.canvas.getContext('2d', { willReadFrequently: true });
    }
    if (look.base.width !== w || look.base.height !== h) {
      look.base.width = w; look.base.height = h; look.canvas.width = w; look.canvas.height = h; look.key = '';
      if (typeof _resetCamEngineState === 'function') _resetCamEngineState('capture');
    }
    const [sx, sy, sw, sh] = cropCoordsForDims(cam.srcW, cam.srcH, w, h);
    const b = look.bctx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    if (eng.mirror) { b.translate(w, 0); b.scale(-1, 1); }
    b.drawImage(cam.source, sx, sy, sw, sh, 0, 0, w, h);
    b.setTransform(1, 0, 0, 1, 0, 0);
    return look.base;
  }
  function uploadLook(base, key, now) {
    const gl = eng.gl, w = base.width, h = base.height;
    const cadence = key === 'ASCII' ? 20 : (typeof cameraCadence === 'object' && cameraCadence[key]) || 24;
    const signature = key + ':' + w + 'x' + h;
    if (signature !== look.key || now - look.at >= 1000 / cadence - 4) {
      look.key = signature; look.at = now;
      try {
        if (key === 'ASCII') FLIP_STEP_ENGINES.ascii.renderStep(base, look.ctx, { cols: 96 }, null, now);
        else {
          // De STAMP entra la trama, no el marco del sello.
          const frame = typeof stampFrameMode === 'string' ? stampFrameMode : null;
          if (frame !== null && key === 'STAMP') stampFrameMode = 'OFF';
          try {
            const variant = key === camFamily ? camVariant : (CAM_FAMILIES[key].variants && CAM_FAMILIES[key].variants[0] && CAM_FAMILIES[key].variants[0].id);
            _renderCamEngineFrame(base, w, h, look.ctx, false, { path: 'capture', now, outW: w, outH: h, resolution: 'medium', family: key, variant });
          } finally { if (frame !== null && key === 'STAMP') stampFrameMode = frame; }
        }
        gl.bindTexture(gl.TEXTURE_2D, eng.texA);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, look.canvas);
        eng.alloc.A = '';
        look.failed = '';
      } catch (error) {
        if (look.failed !== key) { look.failed = key; flipToast('Ese emulador no se pudo aplicar en STAGE; sigue la cámara directa.'); }
        live.d['src.look'] = 'RAW';
        return false;
      }
    }
    eng.camKind = 0; eng.fit = [1, 1, 0, 0]; eng.path = 'emulador ' + key;
    eng.hasA = true;
    return true;
  }
  function feedSources(now) {
    eng.hasA = false;
    if (!camReady()) return;
    hookVideo();
    eng.mirror = typeof facingMode === 'string' && facingMode === 'user' ? 1 : 0;
    const key = live.d['src.look'], keyed = live.d['mix.mode'] === 5;
    let base = null;
    if (!camState.injected && (key !== 'RAW' || keyed || hands.on)) base = cpuFrame();
    if (key === 'RAW' || !base || !uploadLook(base, key, now)) uploadRaw();
    eng.shaderMirror = eng.path.startsWith('emulador') ? 0 : eng.mirror;
    if (keyed && base) {
      flipSilhouette.start();
      flipSilhouette.push(base, 0, 0, base.width, base.height, false);
      const mask = flipSilhouette.latest(1200);
      if (mask && mask.seq !== eng.maskSeq) {
        eng.maskSeq = mask.seq;
        const n = mask.width * mask.height;
        if (!eng.maskBytes || eng.maskBytes.length !== n) eng.maskBytes = new Uint8Array(n);
        for (let i = 0; i < n; i++) eng.maskBytes[i] = mask.data[i] * 255;
        plane('M', eng.texMask, eng.gl.RED, eng.gl.R8, mask.width, mask.height, eng.maskBytes, 0, mask.width);
      }
      eng.hasMask = !!mask;
    } else eng.hasMask = false;
    if (hands.on && base) trackHands(base);
  }

  // ── Sonido ──────────────────────────────────────────────────────────────────
  const audio = { on: false, busy: false, owned: false, analyser: null, freq: null, wave: null, rate: 48000, tex: new Uint8Array(512), env: { bass: 0, mid: 0, high: 0 }, agc: { bass: [0, .12], mid: [0, .12], high: [0, .12] },
    beat: 0, flux: { prev: 0, mean: 0, dev: 0 }, lastBeat: 0, gaps: [], bpm: 0, inject: null };
  async function micOn(deviceId) {
    if (audio.busy || audio.on) return;
    audio.busy = true; syncKeys();
    try {
      await _buildExtAudioChain(deviceId || undefined);
      const an = extAudioCtx.createAnalyser();
      an.fftSize = 1024; an.smoothingTimeConstant = 0.3; an.minDecibels = -95; an.maxDecibels = -20;
      extInGainNode.connect(an);
      Object.assign(audio, { analyser: an, freq: new Uint8Array(an.frequencyBinCount), wave: new Uint8Array(an.fftSize), rate: extAudioCtx.sampleRate, on: true, owned: true });
      readout('MIC ENCENDIDO');
    } catch (error) {
      audio.on = false;
      flipToast('Sin micrófono no hay reacción al sonido.');
    } finally { audio.busy = false; syncKeys(); }
  }
  function micOff() {
    const was = audio.on;
    audio.on = false; audio.analyser = null;
    if (audio.owned && !extAudioMode && !extMicOnlyMode) {
      try { if (extMicStream) extMicStream.getTracks().forEach(track => track.stop()); } catch (_) {}
      extMicStream = null;
      try { if (extAudioCtx) extAudioCtx.close(); } catch (_) {}
      extAudioCtx = null; extAnalyser = null; extInGainNode = null;
      try { FlipAudioReact.attach(null); } catch (_) {}
    }
    audio.owned = false;
    audio.env.bass = audio.env.mid = audio.env.high = 0; audio.beat = 0; audio.bpm = 0; audio.gaps.length = 0;
    if (was) syncKeys();
  }
  function bandOf(lo, hi) {
    const freq = audio.freq, n = freq.length, hz = audio.rate / 2 / n;
    const a = Math.max(1, Math.floor(lo / hz)), b = Math.min(n - 1, Math.ceil(hi / hz));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += freq[i];
    return sum / ((b - a + 1) * 255);
  }
  function follow(key, raw, dt, gain, fall) {
    const g = audio.agc[key], e = audio.env;
    g[1] = Math.max(raw, g[1] * Math.exp(-dt / 9), .12);                  // techo: lo más fuerte de los últimos segundos
    g[0] = Math.min(raw, g[0] + dt * .03);                                // suelo: el ruido de fondo
    const x = clamp(Math.pow(clamp((raw - g[0]) / Math.max(.1, g[1] - g[0])), 1.5) * gain);
    e[key] = x > e[key] ? lerp(e[key], x, .75) : e[key] + (x - e[key]) * (1 - Math.exp(-dt / fall));
  }
  function onBeat(now) {
    const gap = now - audio.lastBeat;
    audio.lastBeat = now; audio.beat = 1;
    if (gap > 240 && gap < 1600) { audio.gaps.push(gap); if (audio.gaps.length > 12) audio.gaps.shift(); }
    else if (gap >= 1600) audio.gaps.length = 0;
    if (audio.gaps.length >= 6) {
      const sorted = audio.gaps.slice().sort((a, b) => a - b), median = sorted[sorted.length >> 1];
      const spread = (sorted[Math.floor(sorted.length * .75)] - sorted[Math.floor(sorted.length * .25)]) / median;
      let bpm = 60000 / median;
      while (bpm < 70) bpm *= 2;
      while (bpm > 175) bpm /= 2;
      audio.bpm = spread < .35 ? (audio.bpm ? lerp(audio.bpm, bpm, .3) : bpm) : 0;
    } else audio.bpm = 0;
  }
  function readAudio(dt, now) {
    const tex = audio.tex;
    audio.beat *= Math.exp(-dt / .16);
    if (audio.inject) {
      const j = audio.inject;
      audio.env.bass = j.bass || 0; audio.env.mid = j.mid || 0; audio.env.high = j.high || 0;
      if (j.beat) { audio.beat = j.beat; j.beat = 0; }
    } else if (audio.on && audio.analyser) {
      if (extAudioCtx && extAudioCtx.state === 'suspended') extAudioCtx.resume().catch(() => {});
      audio.analyser.getByteFrequencyData(audio.freq);
      audio.analyser.getByteTimeDomainData(audio.wave);
      const gain = Math.pow(2, (val['aud.gain'] === undefined ? .5 : val['aud.gain']) * 4 - 2), fall = .04 + Math.pow(val['aud.fall'] === undefined ? .4 : val['aud.fall'], 2) * .9;
      const bass = bandOf(30, 170);
      follow('bass', bass, dt, gain, fall); follow('mid', bandOf(260, 2000), dt, gain, fall); follow('high', bandOf(4000, 12000), dt, gain, fall);
      const fl = audio.flux, rise = Math.max(0, bass - fl.prev), k = Math.min(1, dt / 1.2);
      fl.prev = bass;
      fl.mean += (rise - fl.mean) * k; fl.dev += (Math.abs(rise - fl.mean) - fl.dev) * k;
      if (rise > fl.mean + fl.dev * 2.6 + .018 && now - audio.lastBeat > 150) onBeat(now);
      for (let i = 0; i < 256; i++) { tex[i] = audio.freq[i]; tex[256 + i] = audio.wave[i * 4]; }
    }
    if (!audio.on || !audio.analyser) {
      // Sin micrófono, el osciloscopio no se queda muerto: una onda de reposo que respira con los LFO.
      const a = .3 + .2 * mods.lfo1, f = 2 + mods.lfo2;
      for (let i = 0; i < 256; i++) {
        const x = i / 255;
        tex[i] = audio.inject ? 255 * clamp(lerp(audio.env.bass, audio.env.high, x)) : Math.max(0, 150 - i * 1.1) * (.6 + .4 * Math.sin(clock.t * 2 + i * .13));
        tex[256 + i] = 128 + 110 * a * Math.sin(TAU * (x * f + clock.t * .7)) * Math.sin(Math.PI * x) + 14 * Math.sin(TAU * (x * 9 - clock.t * 1.9));
      }
    }
    mods.bass = audio.env.bass; mods.mid = audio.env.mid; mods.high = audio.env.high; mods.beat = clamp(audio.beat);
  }

  // ── Manos ───────────────────────────────────────────────────────────────────
  const hands = { on: false, goal: { hx: .5, hy: .5, pinch: 0 }, seen: false, phase: 'idle' };
  function handsOn(on) {
    if (on === hands.on) return;
    hands.on = on;
    if (on) { if (typeof flipPortal !== 'undefined') flipPortal.start(); readout('MANOS: CARGANDO', 2500); }
    else if (typeof flipPortal !== 'undefined' && flipPortal.release) flipPortal.release();
    syncKeys();
  }
  function trackHands(base) {
    if (typeof flipPortal === 'undefined' || !flipPortal.track) return;
    const res = flipPortal.track(base);
    if (res.phase !== hands.phase) { hands.phase = res.phase; if (res.phase === 'ready') readout('MANOS LISTAS'); else if (res.phase === 'failed') { flipToast(res.message || 'El seguimiento de manos no cargó.'); handsOn(false); } }
    hands.seen = res.fresh && res.hands.length > 0;
    if (!hands.seen) return;
    const h = res.hands[0], span = Math.hypot(h[0] - h[18], h[1] - h[19]) || .1;           // muñeca → nudillo medio
    hands.goal.hx = clamp(h[16]); hands.goal.hy = clamp(1 - h[17]);
    hands.goal.pinch = clamp((Math.hypot(h[16] - h[8], h[17] - h[9]) / span - .15) / 1.1);    // índice ↔ pulgar
  }

  // ── MIDI ────────────────────────────────────────────────────────────────────
  const midi = { access: null, state: 'off', names: [], learn: false, target: '', held: new Set(), gate: 0, seen: -1e9, slew: {}, ticks: [], bpm: 0, tickAt: -1e9 };
  async function midiConnect() {
    if (!navigator.requestMIDIAccess) { midi.state = 'none'; flipToast('Este navegador no tiene MIDI. En Android y en ordenador, usa Chrome.'); syncKeys(); return false; }
    try { midi.access = await navigator.requestMIDIAccess({ sysex: false }); }
    catch (_) { midi.state = 'denied'; flipToast('Permiso de MIDI denegado: actívalo en los ajustes del sitio.'); syncKeys(); return false; }
    const bind = () => {
      midi.names = [];
      midi.access.inputs.forEach(input => { input.onmidimessage = event => midiIn(event.data, event.timeStamp); midi.names.push(input.name || 'MIDI'); });
      midi.state = midi.names.length ? 'on' : 'wait';
      syncKeys();
    };
    midi.access.onstatechange = bind;
    bind();
    readout(midi.names.length ? 'MIDI: ' + midi.names[0].toUpperCase().slice(0, 14) : 'MIDI: SIN MANDO', 2600);
    return true;
  }
  function trigger(dst, x) {
    if (dst[0] === 's') recall(+dst.slice(2));
    else if (dst === 't:tap') tap();
    else if (dst === 't:black') setBlack(!ui.black);
  }
  function midiIn(data, stamp) {
    const status = data[0], type = status & 0xf0, key = (status & 0x0f) + ':' + data[1], now = performance.now();
    if (status === 0xf8) {                                              // reloj: 24 pulsos por negra
      midi.ticks.push(stamp || now);
      if (midi.ticks.length > 25) midi.ticks.shift();
      if (midi.ticks.length >= 13) { const bpm = 60000 / ((midi.ticks[midi.ticks.length - 1] - midi.ticks[0]) / (midi.ticks.length - 1) * 24); if (bpm > 30 && bpm < 300) { midi.bpm = bpm; midi.tickAt = now; } }
      return;
    }
    if (status === 0xfa) { ph.lfo[0] = ph.lfo[1] = 0; midi.ticks.length = 0; return; }
    if (status >= 0xf0) return;
    midi.seen = now;
    if (type === 0xb0) {
      const x = data[2] / 127;
      if (midi.learn && midi.target) { learnBind('cc', key); return; }
      const dst = store.midi.cc[key];
      if (!dst) return;
      if (dst[0] === 'p') { midi.slew[dst.slice(2)] = x; if (morph) delete morph.to[dst.slice(2)]; }
      else if (data[2] >= 64) trigger(dst);
    } else if (type === 0x90 && data[2] > 0) {
      midi.held.add(key); midi.gate = data[2] / 127;
      if (midi.learn && midi.target) { learnBind('note', key); return; }
      const dst = store.midi.note[key] || (Object.keys(store.midi.note).length === 0 && data[1] >= 36 && data[1] <= 43 ? 's:' + (data[1] - 36) : '');
      if (dst && dst[0] !== 'p') trigger(dst);
    } else if (type === 0x80 || type === 0x90) midi.held.delete(key);
  }
  function learnBind(kind, key) {
    const target = midi.target;
    if (target[0] === 'p' && kind !== 'cc') { readout('ESE MANDO PIDE UN CC'); return; }
    for (const map of [store.midi.cc, store.midi.note]) for (const k of Object.keys(map)) if (map[k] === target) delete map[k];
    store.midi[kind][key] = target;
    const [ch, num] = key.split(':');
    readout((kind === 'cc' ? 'CC ' : 'NOTA ') + num + ' C' + (+ch + 1) + ' > ' + targetName(target), 2200);
    midi.target = '';
    markLearn();
    save();
  }
  const targetName = target => target[0] === 'p' ? P[target.slice(2)][0] : target[0] === 's' ? 'ESCENA ' + (+target.slice(2) + 1) : target === 't:tap' ? 'TAP' : 'NEGRO';
  function setLearn(on) {
    midi.learn = on; midi.target = '';
    ui.rig.classList.toggle('is-learning', on);
    markLearn();
    readout(on ? 'MIDI: TOCA UN MANDO' : 'MIDI LISTO', on ? 4000 : 1200);
    syncKeys();
  }
  function markLearn() { ui.rig.querySelectorAll('.is-target').forEach(node => node.classList.remove('is-target')); }
  function learnTarget(target, node) {
    midi.target = target;
    markLearn();
    node.classList.add('is-target');
    readout('MUEVE EL MANDO MIDI > ' + targetName(target), 5000);
  }

  // ── Reloj y moduladores ─────────────────────────────────────────────────────
  const taps = [];
  function bpmNow() { return performance.now() - midi.tickAt < 1500 ? midi.bpm : store.global.bpm || audio.bpm || 120; }
  function bpmSource() { return performance.now() - midi.tickAt < 1500 ? 'MIDI' : store.global.bpm ? 'TAP' : audio.bpm ? 'AUTO' : ''; }
  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 2) { store.global.bpm = clamp(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)), 40, 240); save(); }
    ph.lfo[0] = Math.round(ph.lfo[0]); ph.lfo[1] = Math.round(ph.lfo[1]);
    readout(store.global.bpm ? 'TEMPO ' + Math.round(store.global.bpm) + ' BPM' : 'TAP · SIGUE EL RITMO');
  }
  function lfoHz(n) {
    const v = val['lfo' + n + '.rate'] === undefined ? live.p['lfo' + n + '.rate'] : val['lfo' + n + '.rate'];
    return live.d['lfo.sync'] ? bpmNow() / 60 * DIVS[Math.min(7, Math.floor(v * 8))][0] : .03 * Math.pow(500, v);
  }
  function wave(shape, phase, memo) {
    const x = phase - Math.floor(phase);
    if (shape === 0) return Math.sin(x * TAU);
    if (shape === 1) return 1 - 4 * Math.abs(x - .5);
    if (shape === 2) return 2 * x - 1;
    if (shape === 3) return x < .5 ? 1 : -1;
    if (Math.floor(phase) !== memo.cycle) { memo.cycle = Math.floor(phase); memo.from = memo.to; memo.to = Math.random() * 2 - 1; }
    return lerp(memo.from, memo.to, clamp(x * 6));
  }
  const pad = { x: .5, y: .5, active: false };
  function stepMods(dt) {
    for (const n of [0, 1]) { ph.lfo[n] += lfoHz(n + 1) * dt; mods['lfo' + (n + 1)] = wave(live.d['lfo' + (n + 1) + '.shape'], ph.lfo[n], ph.rnd[n]); }
    mods.padx = pad.x; mods.pady = pad.y;
    mods.note = midi.held.size ? midi.gate : mods.note * Math.exp(-dt / .25);
    const k = 1 - Math.exp(-dt / .07);
    for (const key of ['hx', 'hy', 'pinch']) mods[key] += (hands.goal[key] - mods[key]) * k;
    for (const id of Object.keys(midi.slew)) {
      const goal = midi.slew[id];
      live.p[id] += (goal - live.p[id]) * (1 - Math.exp(-dt / .035));
      if (Math.abs(goal - live.p[id]) < .002) { live.p[id] = goal; delete midi.slew[id]; save(); }
      ui.stale = true;
    }
  }
  let morph = null;
  function stepMorph(now) {
    if (!morph) return;
    const t = clamp((now - morph.t0) / morph.ms), e = t * t * (3 - 2 * t);
    for (const id of Object.keys(morph.to)) live.p[id] = lerp(morph.from[id], morph.to[id], e);
    ui.stale = true;
    if (t >= 1) morph = null;
  }
  function evaluate() {
    for (const id of IDS) val[id] = live.p[id];
    for (const r of live.r) val[r[1]] += r[2] * mods[r[0]];
    for (const id of IDS) val[id] = clamp(val[id]);
    return val;
  }

  // ── Dibujo ──────────────────────────────────────────────────────────────────
  const dead = x => (Math.abs(x) < .04 ? 0 : (x - Math.sign(x) * .04) / .96);
  const bi = v => dead(v * 2 - 1);                                      // mando con centro → −1…1 con zona muerta
  function draw(v, dt, t) {
    const gl = eng.gl, W = eng.w, H = eng.h, d = live.d, g = store.global, k = dt * 60;
    // Giro, ciclo de color y V-HOLD son velocidades: al volver el mando al centro, lo acumulado
    // regresa solo a la vuelta entera más cercana (la imagen no se queda torcida ni teñida).
    const spin = (key, speed, rate) => { if (speed) ph[key] += speed * dt; else ph[key] += (Math.round(ph[key]) - ph[key]) * Math.min(1, dt * rate); };
    ph.gen += bi(v['gen.speed']) * 2.2 * dt;
    ph.warp += 1.3 * dt;
    spin('spin', bi(v['geo.spin']) * .5, 5);
    spin('cycle', bi(v['col.cycle']) * .8, 5);
    spin('roll', bi(v['sig.vhold']) * 1.6, 7);
    const read = eng.fb[eng.flip], write = eng.fb[1 - eng.flip];
    const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };

    let c = eng.compose;
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.f);
    gl.viewport(0, 0, W, H);
    gl.useProgram(c.pr);
    bind(0, eng.texA); bind(1, eng.texU); bind(2, eng.texV); bind(3, read.t); bind(4, eng.texMask); bind(5, eng.texAudio);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 2, 0, gl.RED, gl.UNSIGNED_BYTE, audio.tex);
    c.i('uA', 0); c.i('uU', 1); c.i('uV', 2); c.i('uFb', 3); c.i('uMask', 4); c.i('uAudio', 5);
    c.v2('uRes', W, H); c.f('uAspect', W / H);
    c.v4('uFitA', eng.fit); c.i('uCamKind', eng.camKind); c.f('uMirrorA', eng.shaderMirror ? 1 : 0); c.f('uHasA', eng.hasA ? 1 : 0); c.f('uHasMask', eng.hasMask ? 1 : 0);
    if (eng.yuv) { c.m3('uYuv', eng.yuv); c.v3('uYuvOff', eng.yuvOff); }
    c.i('uGen', d['src.gen']); c.i('uMixMode', d['mix.mode']); c.i('uFbMode', d['fb.mode']); c.i('uMirror', d['geo.mirror']); c.f('uKeyInv', d['key.inv'] ? 1 : 0);
    c.f('uGenFreq', lerp(1.5, 42, v['gen.freq'] * v['gen.freq'])); c.f('uGenPhase', ph.gen); c.f('uGenShape', v['gen.shape']); c.f('uGenHue', v['gen.hue']);
    c.f('uFade', v['mix.fade']); c.f('uKeyLevel', v['key.level']); c.f('uKeySoft', .01 + v['key.soft'] * .35);
    c.f('uFbAmt', v['fb.amt'] * .985); c.f('uFbZoom', Math.exp(bi(v['fb.zoom']) * .22 * k)); c.f('uFbRot', bi(v['fb.rot']) * .16 * k);
    c.v2('uFbShift', bi(v['fb.x']) * .045 * k, bi(v['fb.y']) * .045 * k); c.f('uFbHue', v['fb.hue'] * .12 * k); c.f('uFbGain', Math.pow(.55 + v['fb.decay'] * .5, k));
    c.f('uZoom', Math.exp(bi(v['geo.zoom']) * 1.6)); c.f('uRot', bi(v['geo.rot']) * Math.PI + ph.spin * TAU);
    c.f('uKal', v['geo.kal'] < .05 ? 0 : 2 + Math.floor((v['geo.kal'] - .05) / .95 * 10.999)); c.f('uTile', 1 + Math.floor(v['geo.tile'] * 7.999));
    c.f('uWarp', v['geo.warp'] * v['geo.warp'] * .28); c.f('uWarpFreq', 1.5 + v['geo.wfreq'] * 26); c.f('uWarpPhase', ph.warp);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    c = eng.post;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(c.pr);
    bind(0, write.t);
    c.i('uSrc', 0); c.v2('uRes', W, H); c.f('uTime', t % 1000);
    c.f('uRgb', v['sig.rgb'] * v['sig.rgb'] * .035); c.f('uTear', v['sig.tear']); c.f('uRoll', ph.roll); c.f('uRollOn', Math.abs(ph.roll - Math.round(ph.roll)) > .002 ? 1 : 0);
    c.f('uPix', v['sig.pix'] < .04 ? 0 : lerp(200, 10, Math.sqrt(v['sig.pix']))); c.f('uScan', v['sig.scan']); c.f('uNoise', v['sig.noise'] * v['sig.noise']); c.f('uBleed', v['sig.bleed']);
    const strobe = v['sig.strobe'];
    c.f('uGate', strobe < .03 ? 1 : lerp(1, (t * (2 + strobe * 7)) % 1 < .5 ? 1 : 0, Math.min(1, strobe * 1.6)));
    const sat = bi(v['col.sat']);
    c.f('uHue', v['col.hue'] + ph.cycle); c.f('uSat', sat < 0 ? 1 + sat : 1 + sat * 1.2); c.f('uCon', Math.exp(bi(v['col.con']) * 1.1));
    c.f('uPost', v['col.post'] < .04 ? 0 : Math.round(lerp(14, 2, Math.sqrt(v['col.post'])))); c.f('uSolar', v['col.solar']); c.f('uTint', v['col.tint']);
    const tint = PALETTES[d['col.pal']] || PALETTES[0];
    c.v3('uTintA', hex(tint[1])); c.v3('uTintB', hex(tint[2])); c.v3('uTintC', hex(tint[3]));
    c.f('uInv', d['col.inv'] ? 1 : 0); c.f('uFlipX', g.flipX ? 1 : 0); c.f('uFlipY', g.flipY ? 1 : 0);
    ui.blackAmt += ((ui.black ? 1 : 0) - ui.blackAmt) * Math.min(1, dt * 9);
    c.f('uLevel', v['out.level'] * (1 - ui.blackAmt));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    eng.flip = 1 - eng.flip;
  }
  // Calidad AUTO: si el cuadro no llega a tiempo baja un escalón; si va sobrado, vuelve a subir.
  function pace(dt) {
    const ms = dt * 1000;
    clock.dtAvg += (ms - clock.dtAvg) * .05;
    clock.fps = 1000 / clock.dtAvg;
    if (store.global.quality !== 0) return;
    const base = COARSE ? 540 : 720, at = LADDER.indexOf(clock.autoH);
    clock.slow = ms > 22 ? clock.slow + 1 : Math.max(0, clock.slow - 2);
    clock.fast = ms < 17.6 ? clock.fast + 1 : 0;
    if (clock.slow > 90 && at > 0) { clock.autoH = LADDER[at - 1]; clock.slow = 0; resize(); }
    else if (clock.fast > 720 && clock.autoH < base) { clock.autoH = LADDER[at + 1]; clock.fast = 0; resize(); }
  }
  function frame(fixed) {
    const now = performance.now();
    const dt = fixed || clamp((now - clock.last) / 1000, .001, .1);
    clock.last = now; clock.t += dt; clock.n++;
    if (!fixed) pace(dt);
    readAudio(dt, now); stepMods(dt); stepMorph(now);
    const v = evaluate();
    if (!eng.ok) return;
    feedSources(now);
    draw(v, dt, clock.t);
    if (out.ctx) {
      try {
        if (out.win.closed) output.detach();
        else { if (out.canvas.width !== eng.w || out.canvas.height !== eng.h) { out.canvas.width = eng.w; out.canvas.height = eng.h; } out.ctx.drawImage(eng.canvas, 0, 0); }
      } catch (_) { output.detach(); }
    }
    if (clock.n % 2 === 0) paint(now);
  }
  function tick() {
    try { frame(); state.failed = 0; }
    catch (error) {
      if (++state.failed === 1) console.error('STAGE', error);
      if (state.failed === 30) note('STAGE se detuvo por un error de dibujo. Sal y vuelve a entrar.');
    }
  }
  function pumpMain() {
    state.raf = requestAnimationFrame(() => {
      if (!state.active) return;
      if (!(out.ctx && performance.now() - out.lastTick < 150)) tick();     // con ventana de salida, manda su reloj
      pumpMain();
    });
  }

  // ── Salida ──────────────────────────────────────────────────────────────────
  const out = { win: null, canvas: null, ctx: null, lastTick: -1e9 };
  function pumpOut() {
    const win = out.win;
    if (!win || win.closed || !out.ctx) return;
    win.requestAnimationFrame(() => {
      if (out.win !== win || !out.ctx) return;
      out.lastTick = performance.now();
      if (state.active) tick();
      pumpOut();
    });
  }
  const output = {
    attach(win) {
      out.win = win;
      out.canvas = win.document.getElementById('out');
      out.ctx = out.canvas.getContext('2d', { alpha: false });
      pumpOut(); syncKeys();
      readout('SALIDA EN VENTANA');
    },
    detach(win) {
      if (win && win !== out.win) return;
      out.win = null; out.canvas = null; out.ctx = null;
      syncKeys();
    },
  };
  function openWindow() {
    if (out.win && !out.win.closed) { try { out.win.focus(); } catch (_) {} return; }
    const win = window.open('./stage-out.html', 'FLIP_STAGE_OUT', 'popup,width=1280,height=720');
    if (!win) { flipToast('El navegador bloqueó la ventana de salida: permite las ventanas emergentes de FLIP.'); return; }
    out.win = win;
    // Con permiso de gestión de ventanas, la salida va sola a la otra pantalla.
    (async () => {
      try {
        if (!('getScreenDetails' in window)) return;
        const details = await window.getScreenDetails();
        const other = details.screens.find(screen => screen !== details.currentScreen);
        if (!other || win.closed) return;
        win.moveTo(other.availLeft, other.availTop); win.resizeTo(other.availWidth, other.availHeight);
      } catch (_) {}
    })();
  }
  async function clean(on) {
    const node = ui.monitor;
    if (!on) { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); return; }
    if (!node.requestFullscreen) { flipToast('Este navegador no deja usar la pantalla completa.'); return; }
    try { await node.requestFullscreen({ navigationUI: 'hide' }); } catch (_) { flipToast('No se pudo pasar a pantalla completa.'); return; }
    const [aw, ah] = ASPECT_DIMS[store.global.aspect];
    try { await screen.orientation.lock(aw >= ah ? 'landscape' : 'portrait'); } catch (_) {}
    let shown = 0;
    try { shown = +localStorage.getItem('flip.stage.cleanHint') || 0; localStorage.setItem('flip.stage.cleanHint', String(shown + 1)); } catch (_) {}
    if (shown < 3) { ui.cleanHint.classList.add('is-on'); setTimeout(() => ui.cleanHint.classList.remove('is-on'), 3200); }
  }
  document.addEventListener('fullscreenchange', () => {
    state.clean = !!ui.monitor && document.fullscreenElement === ui.monitor;
    if (ui.rig) ui.rig.classList.toggle('is-clean', state.clean);
    if (!state.clean) { try { screen.orientation.unlock(); } catch (_) {} }
    syncKeys();
  });
  let wakeLock = null;
  async function wake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock && !document.hidden) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      else if (!on && wakeLock) { const lock = wakeLock; wakeLock = null; await lock.release(); }
    } catch (_) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.active) wake(true); });

  // Grabación y foto de lo que sale.
  const rec = { on: false, recorder: null, chunks: [], t0: 0, mime: '' };
  function recStart() {
    if (!eng.ok || typeof MediaRecorder === 'undefined') { flipToast('Este navegador no puede grabar vídeo.'); return; }
    const feed = eng.canvas.captureStream(30);
    if (audio.on && extMicStream) extMicStream.getAudioTracks().forEach(track => feed.addTrack(track));
    let made;
    try { made = _createFlipRecorder(feed, 8000000); } catch (_) { flipToast('No se pudo iniciar la grabación.'); return; }
    Object.assign(rec, { recorder: made.recorder, mime: made.mime || 'video/webm', chunks: [], on: true, t0: performance.now() });
    made.recorder.ondataavailable = event => { if (event.data && event.data.size) rec.chunks.push(event.data); };
    made.recorder.onstop = async () => {
      const type = rec.mime.split(';')[0], blob = new Blob(rec.chunks, { type });
      rec.chunks = [];
      feed.getVideoTracks().forEach(track => track.stop());
      if (blob.size) { try { await saveBlob(blob, _flipName('stage', /mp4/.test(type) ? 'mp4' : 'webm')); } catch (_) {} }
    };
    made.recorder.start(1000);
    feel.hush('stage-rec', true);
    syncKeys();
  }
  function recStop() {
    if (!rec.on) return;
    rec.on = false;
    try { rec.recorder.stop(); } catch (_) {}
    feel.hush('stage-rec', false);
    syncKeys();
  }
  function photo() {
    if (!eng.ok) return;
    draw(evaluate(), 0, clock.t);                                          // el cuadro, recién pintado, en esta misma tarea
    eng.canvas.toBlob(async blob => { if (blob) { try { await saveBlob(blob, _flipName('stage', 'jpg')); } catch (_) {} } }, 'image/jpeg', .93);
    ui.monitor.classList.remove('is-shot'); void ui.monitor.offsetWidth; ui.monitor.classList.add('is-shot');
  }

  // ── Escenas ─────────────────────────────────────────────────────────────────
  function recall(index, instant) {
    index = clamp(index | 0, 0, 7);
    const target = store.scenes[index];
    store.scene = index;
    const ms = instant ? 0 : Math.pow(live.p['mod.morph'], 2) * 4000;
    if (ms > 20) { morph = { from: Object.assign({}, live.p), to: Object.assign({}, target.p), t0: performance.now(), ms }; }
    else { morph = null; for (const id of SCENE_IDS) live.p[id] = target.p[id]; }
    for (const id of Object.keys(midi.slew)) delete midi.slew[id];
    live.d = Object.assign({}, target.d);
    live.r = target.r.map(r => r.slice());
    patched();
    readout('E' + (index + 1) + ' ' + target.name, 1100);
    save();
  }
  function keep(index) {
    store.scenes[index] = snapshot(store.scenes[index].name);
    store.scene = index;
    syncScenes();
    readout('ESCENA ' + (index + 1) + ' GUARDADA', 1600);
    save();
  }
  function patched() {
    if (live.d['mix.mode'] === 5 && typeof flipSilhouette !== 'undefined') flipSilhouette.start();
    if (live.r.some(r => r[0] === 'hx' || r[0] === 'hy' || r[0] === 'pinch')) handsOn(true);
    if (!ui.rig) return;
    syncScenes(); renderPage(); syncJacks();
  }

  // ── Parcheo ─────────────────────────────────────────────────────────────────
  const routeOf = (src, dst) => live.r.find(r => r[0] === src && r[1] === dst);
  function setRoute(src, dst, amt) {
    let route = routeOf(src, dst);
    if (Math.abs(amt) < .02) { if (route) live.r.splice(live.r.indexOf(route), 1); route = null; }
    else if (route) route[2] = amt;
    else if (live.r.length < 24) live.r.push(route = [src, dst, amt]);
    else { readout('NO CABEN MÁS CABLES'); return; }
    if (route && (src === 'hx' || src === 'hy' || src === 'pinch')) handsOn(true);
    syncJacks(); syncCtl(dst); cables(); routesList();
    save();
  }
  function arm(src) {
    ui.armed = ui.armed === src ? '' : src;
    ui.rig.classList.toggle('is-arming', !!ui.armed);
    ui.rig.style.setProperty('--arm', ui.armed ? SRC[ui.armed].tone : 'transparent');
    syncJacks();
    if (ui.armed) readout(SRC[ui.armed].label + ' > TOCA UN MANDO', 4000); else readout('', 0);
    if (ui.armed && (ui.armed === 'bass' || ui.armed === 'mid' || ui.armed === 'high' || ui.armed === 'beat') && !audio.on && !audio.inject) flipToast('Enciende MIC para que los mandos sigan el sonido.', 2600);
    if (ui.armed === 'note' && midi.state === 'off') flipToast('Pulsa MIDI para conectar tu controlador.', 2600);
  }

  // ── Consola ─────────────────────────────────────────────────────────────────
  const ui = { rig: null, monitor: null, screen: null, panel: null, cablesSvg: null, cleanHint: null, page: 'src', ctl: {}, armed: '', drag: null, black: false, blackAmt: 0,
    readout: { text: '', until: 0 }, lcdAt: 0, stale: false, lastTap: { t: 0, id: '' } };
  const icon = name => (window.flipShell ? flipShell.icon(name) : '');
  const SVG = {
    left: '<path d="m14.5 6-6 6 6 6"/>', right: '<path d="m9.5 6 6 6-6 6"/>',
    midi: '<circle cx="12" cy="12" r="8.6"/><circle cx="7.4" cy="12.6" r=".9" fill="currentColor"/><circle cx="16.6" cy="12.6" r=".9" fill="currentColor"/><circle cx="8.9" cy="8.7" r=".9" fill="currentColor"/><circle cx="15.1" cy="8.7" r=".9" fill="currentColor"/><circle cx="12" cy="7.3" r=".9" fill="currentColor"/><path d="M10.4 17.6h3.2"/>',
    out: '<rect x="3" y="4.5" width="18" height="12" rx="1.6"/><path d="M8 20.5h8M12 16.5v4"/><path d="m10.4 8.4 3.6 2.1-3.6 2.1z" fill="currentColor" stroke="none"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[name]}</svg>`;
  const getD = id => (id.startsWith('out.') ? (id === 'out.black' ? (ui.black ? 1 : 0) : store.global[id.slice(4)]) : live.d[id]);
  const optionIndex = id => (id === 'src.look' ? Math.max(0, LOOKS.findIndex(l => l.key === live.d[id])) : getD(id));
  function setD(id, value) {
    if (id === 'out.black') { setBlack(!!value); return; }
    if (id.startsWith('out.')) { store.global[id.slice(4)] = value; if (id === 'out.aspect' || id === 'out.quality') { clock.autoH = COARSE ? 540 : 720; resize(); } }
    else live.d[id] = id === 'src.look' ? LOOKS[value].key : value;
    if (id === 'src.look' && typeof _resetCamEngineState === 'function') { _resetCamEngineState('capture'); look.key = ''; }
    if (id === 'mix.mode' && value === 5) { flipSilhouette.start(); if (live.p['mix.fade'] < .05) setParam('mix.fade', 1); }
    if (id === 'src.gen' && (value === 6 || value === 7) && !audio.on) flipToast('Enciende MIC para que el generador siga el sonido.', 2600);
    save();
  }
  function setBlack(on) { ui.black = on; if (ui.rig) { ui.rig.classList.toggle('is-black', on); syncKeys(); } readout(on ? 'SALIDA EN NEGRO' : 'SALIDA ABIERTA', 1000); }
  function setParam(id, v) { live.p[id] = clamp(v); if (morph) delete morph.to[id]; delete midi.slew[id]; syncCtl(id); save(); }
  function describe(id, v) {
    const signed = x => (x > 0 ? '+' : '') + Math.round(x * 100);
    if (id === 'geo.kal') return v < .05 ? 'NO' : (2 + Math.floor((v - .05) / .95 * 10.999)) + ' LADOS';
    if (id === 'geo.tile') return 'X' + (1 + Math.floor(v * 7.999));
    if (id === 'col.post') return v < .04 ? 'NO' : Math.round(lerp(14, 2, Math.sqrt(v))) + ' TONOS';
    if (id === 'lfo1.rate' || id === 'lfo2.rate') { if (live.d['lfo.sync']) return DIVS[Math.min(7, Math.floor(v * 8))][1]; const hz = .03 * Math.pow(500, v); return hz < 1 ? (1 / hz).toFixed(1) + ' S' : hz.toFixed(1) + ' HZ'; }
    if (id === 'mod.morph') return (Math.pow(v, 2) * 4).toFixed(1) + ' S';
    if (id === 'geo.zoom') return 'X' + Math.exp(bi(v) * 1.6).toFixed(2);
    return P[id][2] ? signed(bi(v)) : String(Math.round(v * 100));
  }
  function readout(text, ms = 1400) { ui.readout = { text, until: performance.now() + ms }; lcd(true); }
  function note(text) { if (ui.note) { ui.note.textContent = text || ''; ui.note.classList.toggle('is-on', !!text); } }
  const put = (id, text) => { const node = $(id); if (node && node.textContent !== text) node.textContent = text; };
  function lcd(force) {
    if (!state.active) return;
    const now = performance.now();
    if (!force && now - ui.lcdAt < 240) return;
    ui.lcdAt = now;
    const current = store.scenes[store.scene];
    const elapsed = rec.on ? Math.floor((now - rec.t0) / 1000) : 0;
    put('lcdLook', ui.readout.until > now && ui.readout.text ? ui.readout.text : rec.on ? 'REC ' + String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0') : 'E' + (store.scene + 1) + ' ' + current.name);
    put('lcdFps', Math.round(clock.fps) + ' FPS  ' + Math.round(bpmNow()) + ' BPM');
    put('lcdFormat', ASPECTS[store.global.aspect] + ' ' + Math.min(eng.w, eng.h) + 'P');
  }

  function build() {
    const host = $('stageArea');
    if (!host) return false;
    host.innerHTML = `
      <div class="rig" id="stageRig">
        <div class="rig-monitor" id="rigMonitor">
          <div class="rig-screen" id="rigScreen">
            <canvas id="stageCanvas" width="960" height="540"></canvas>
            <i class="rig-cross" id="rigCross"></i>
            <div class="rig-tally"><span id="rigTallyLive"><i></i>EN VIVO</span><span id="rigTallyOut">SALIDA</span><span id="rigTallyRec"><i></i>REC</span></div>
            <div class="rig-note" id="rigNote" role="status"></div>
            <div class="rig-clean-hint" id="rigCleanHint">Arrastra: PAD X · Y &nbsp;·&nbsp; Doble toque: siguiente escena &nbsp;·&nbsp; Atrás: salir</div>
          </div>
        </div>
        <div class="rig-side">
        <div class="rig-deck">
          <div class="rig-row rig-row-scenes"><span class="hw-print">ESCENAS · MANTÉN PARA GUARDAR</span><span class="hw-print rig-badge">VS-27 · PRO</span></div>
          <div class="rig-scenes" id="rigScenes" role="radiogroup" aria-label="Escenas">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<button class="hw hw-keycap" type="button" role="radio" data-scene="${i}" data-feel="key" aria-label="Escena ${i + 1}"><span>${i + 1}</span></button>`).join('')}</div>
          <div class="rig-tabs" id="rigTabs" role="tablist" aria-label="Módulos">${PAGES.map(page => `<button class="hw hw-keycap" data-color="gray" type="button" role="tab" data-page="${page.id}"><span>${page.label}</span></button>`).join('')}</div>
          <div class="rig-panel" id="rigPanel" role="tabpanel"></div>
          <div class="rig-jacks" id="rigJacks" aria-label="Moduladores">${SOURCES.map(([key, label, tone]) => `<button class="hw rig-jack" type="button" data-src="${key}" data-feel="soft" style="--tone:${tone}" aria-label="Modulador ${label}"><i class="led"></i><b class="socket"></b><span class="hw-print">${label}</span></button>`).join('')}</div>
        </div>
          <div class="rig-transport">
            <div class="hw-labeled"><button class="hw hw-candy" data-color="coral" id="rigRec" type="button" data-feel="primary" aria-label="Grabar la salida">${icon('rec')}</button><span class="hw-print">REC</span></div>
            <div class="hw-labeled"><button class="hw hw-candy" data-color="white" id="rigPhoto" type="button" aria-label="Foto de la salida">${icon('cam')}</button><span class="hw-print">FOTO</span></div>
            <button class="hw hw-keycap" data-color="coral" id="rigOut" type="button" data-feel="primary" aria-label="Abrir la salida limpia">${svg('out')}<span>SALIDA</span></button>
            <button class="hw hw-keycap" data-color="mustard" id="rigTap" type="button" aria-label="Marcar el tempo"><span>TAP</span><em id="rigBpm">120</em></button>
            <div class="hw-labeled"><button class="hw hw-candy" id="rigMic" type="button" aria-label="Micrófono: reacción al sonido" aria-pressed="false">${icon('mic')}</button><span class="hw-print">MIC</span></div>
            <div class="hw-labeled"><button class="hw hw-candy" id="rigMidi" type="button" aria-label="MIDI: conectar y aprender" aria-pressed="false">${svg('midi')}</button><span class="hw-print">MIDI</span></div>
          </div>
        </div>
        <svg class="rig-cables" id="rigCables" aria-hidden="true"></svg>
      </div>`;
    Object.assign(ui, { rig: $('stageRig'), monitor: $('rigMonitor'), screen: $('rigScreen'), panel: $('rigPanel'), cablesSvg: $('rigCables'), note: $('rigNote'), cleanHint: $('rigCleanHint') });
    ui.leds = [...ui.rig.querySelectorAll('.rig-jack')].map(jack => [jack.dataset.src, jack.querySelector('.led')]);
    eng.canvas = $('stageCanvas');
    wire();
    return true;
  }
  const knobHtml = id => `<div class="rig-knob${P[id][2] ? ' has-center' : ''}" data-param="${id}" data-feel="none" role="slider" tabindex="0" aria-label="${P[id][0]}" aria-valuemin="0" aria-valuemax="100"><div class="dial"><i class="ring"></i><i class="ptr"></i><i class="live"></i></div><span class="hw-print">${P[id][0]}</span></div>`;
  const pickHtml = ([id, label]) => `<div class="rig-pick" data-pick="${id}"><span class="hw-print">${label}</span><div class="rig-pick-row"><button class="hw hw-keycap" data-color="gray" type="button" data-step="-1" aria-label="${label}: anterior">${svg('left')}</button><div class="hw-lcd"><b></b></div><button class="hw hw-keycap" data-color="gray" type="button" data-step="1" aria-label="${label}: siguiente">${svg('right')}</button></div></div>`;
  const toggleHtml = ([id, label]) => `<div class="rig-toggle"><button class="hw hw-switch" type="button" role="switch" aria-checked="false" data-toggle="${id}" aria-label="${label}"><i></i></button><span class="hw-print">${label}</span></div>`;
  function renderPage() {
    const page = PAGES.find(entry => entry.id === ui.page) || PAGES[0];
    let html = `<div class="rig-title hw-print">${page.title}</div>`;
    if (page.picks) html += `<div class="rig-picks" data-count="${page.picks.length}">${page.picks.map(pickHtml).join('')}</div>`;
    if (page.fader) html += `<div class="rig-fader" data-param="${page.fader}" data-feel="none" role="slider" tabindex="0" aria-label="Fundido entre la cámara y el generador" aria-valuemin="0" aria-valuemax="100"><span class="hw-print">A</span><div class="track"><i class="ring"></i><i class="cap"></i><i class="live"></i></div><span class="hw-print">B</span></div>`;
    html += `<div class="rig-knobs">${page.knobs.map(knobHtml).join('')}${(page.toggles || []).map(toggleHtml).join('')}`;
    if (page.id === 'src') html += `<div class="rig-toggle"><button class="hw hw-candy sm" data-color="blue" type="button" data-act="flip" aria-label="Cambiar de cámara">${icon('flip')}</button><span class="hw-print">GIRAR</span></div>`;
    html += '</div>';
    if (page.id === 'mod') html += `<div class="rig-keys"><button class="hw hw-keycap" type="button" data-act="sync"><span>A TEMPO</span></button><button class="hw hw-keycap" type="button" data-act="hands">${icon('hand')}<span>MANOS</span></button><button class="hw hw-keycap" type="button" data-act="unpatch"><span>QUITAR CABLES</span></button></div><div class="rig-routes" id="rigRoutes"></div>`;
    if (page.id === 'out') html += `<div class="rig-keys"><button class="hw hw-keycap" type="button" data-act="clean">${icon('full')}<span>PANTALLA COMPLETA</span></button><button class="hw hw-keycap" type="button" data-act="window">${svg('out')}<span>VENTANA EXTERNA</span></button><button class="hw hw-keycap" type="button" data-act="black"><span>NEGRO</span></button><button class="hw hw-keycap" type="button" data-act="unmidi"><span>OLVIDAR MIDI</span></button><button class="hw hw-keycap" type="button" data-act="factory"><span>FÁBRICA</span></button></div>
      <p class="rig-help"><b>Teléfono:</b> cable USB-C a HDMI y tecla SALIDA: la pantalla entera es la señal. <b>Ordenador:</b> HDMI y VENTANA EXTERNA; doble clic para llenarla.</p>`;
    ui.panel.innerHTML = html;
    ui.ctl = {};
    ui.panel.querySelectorAll('[data-param]').forEach(node => { ui.ctl[node.dataset.param] = node; syncCtl(node.dataset.param); });
    ui.rig.querySelectorAll('#rigTabs [data-page]').forEach(tab => { const on = tab.dataset.page === page.id; tab.classList.toggle('is-on', on); tab.setAttribute('aria-selected', String(on)); });
    syncPicks(); syncToggles(); syncKeys(); routesList();
    requestAnimationFrame(cables);
  }
  const angle = v => -135 + 270 * v;
  function syncCtl(id) {
    const node = ui.ctl[id];
    if (!node) return;
    const v = live.p[id], routes = live.r.filter(r => r[1] === id);
    node.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    node.classList.toggle('is-patched', routes.length > 0);
    const span = routes.reduce((sum, r) => sum + Math.abs(r[2]), 0);
    const lo = clamp(v - (routes.some(r => SRC[r[0]].bipolar || r[2] < 0) ? span : 0)), hi = clamp(v + (routes.some(r => SRC[r[0]].bipolar || r[2] > 0) ? span : 0));
    node.style.setProperty('--tone', routes.length ? SRC[routes[0][0]].tone : 'transparent');
    if (node.classList.contains('rig-fader')) {
      node.style.setProperty('--pos', v.toFixed(4)); node.style.setProperty('--lo', lo.toFixed(4)); node.style.setProperty('--hi', hi.toFixed(4));
    } else {
      node.style.setProperty('--turn', angle(v).toFixed(1) + 'deg');
      node.style.setProperty('--from', angle(lo).toFixed(1)); node.style.setProperty('--len', (270 * (hi - lo)).toFixed(1));
    }
  }
  function syncPicks() {
    ui.panel.querySelectorAll('.rig-pick').forEach(node => { node.querySelector('.hw-lcd b').textContent = OPTIONS[node.dataset.pick][optionIndex(node.dataset.pick)] || ''; });
  }
  function syncToggles() { if (ui.panel) ui.panel.querySelectorAll('[data-toggle]').forEach(node => node.setAttribute('aria-checked', String(!!getD(node.dataset.toggle)))); }
  function syncScenes() {
    ui.rig.querySelectorAll('#rigScenes [data-scene]').forEach(key => { const on = +key.dataset.scene === store.scene; key.classList.toggle('is-on', on); key.setAttribute('aria-checked', String(on)); key.title = store.scenes[+key.dataset.scene].name; });
  }
  function syncJacks() {
    ui.rig.querySelectorAll('.rig-jack').forEach(jack => {
      const key = jack.dataset.src;
      jack.classList.toggle('is-armed', ui.armed === key);
      jack.classList.toggle('is-used', live.r.some(r => r[0] === key));
    });
  }
  function syncKeys() {
    if (!ui.rig) return;
    const set = (id, on, pressed) => { const node = $(id); if (!node) return; node.classList.toggle('is-on', !!on); if (pressed !== undefined) node.setAttribute('aria-pressed', String(!!pressed)); };
    set('rigMic', audio.on, audio.on); $('rigMic').classList.toggle('is-busy', audio.busy);
    set('rigMidi', midi.state === 'on', midi.state === 'on'); $('rigMidi').classList.toggle('is-learning', midi.learn);
    ui.rig.classList.toggle('is-recording', rec.on);
    ui.rig.classList.toggle('has-output', !!out.ctx || state.clean);
    $('rigRec').setAttribute('aria-label', rec.on ? 'Detener la grabación' : 'Grabar la salida');
    $('rigRec').innerHTML = icon(rec.on ? 'stop' : 'rec');
    ui.panel.querySelectorAll('[data-act]').forEach(key => {
      const act = key.dataset.act;
      key.classList.toggle('is-on', (act === 'hands' && hands.on) || (act === 'sync' && !!live.d['lfo.sync']) || (act === 'black' && ui.black) || (act === 'window' && !!out.ctx) || (act === 'clean' && state.clean));
    });
  }
  function routesList() {
    const host = $('rigRoutes');
    if (!host) return;
    host.innerHTML = live.r.length
      ? live.r.map((r, i) => `<span class="rig-route" style="--tone:${SRC[r[0]].tone}"><i></i>${SRC[r[0]].label} › ${P[r[1]][0]} <b>${r[2] > 0 ? '+' : ''}${Math.round(r[2] * 100)}</b><button class="hw" type="button" data-unroute="${i}" aria-label="Quitar el cable de ${SRC[r[0]].label} a ${P[r[1]][0]}">×</button></span>`).join('')
      : '<span class="rig-help">Sin cables. Toca una toma de abajo y después una perilla para conectarla.</span>';
  }
  // Los cables de parcheo: de cada toma a las perillas de la página visible.
  function cables() {
    const host = ui.cablesSvg;
    if (!host || !ui.rig) return;
    const frame = ui.rig.getBoundingClientRect();
    if (!frame.width) { host.innerHTML = ''; return; }
    host.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
    const clip = ui.panel.getBoundingClientRect();
    let html = '', defs = '';
    const used = {};
    live.r.forEach((r, index) => {
      const node = ui.ctl[r[1]], jack = ui.rig.querySelector('.rig-jack[data-src="' + r[0] + '"] .socket');
      if (!node || !jack) return;
      const a = jack.getBoundingClientRect(), fader = node.classList.contains('rig-fader');
      const target = (node.querySelector('.dial') || node.querySelector('.track')).getBoundingClientRect();
      if (target.bottom < clip.top + 4 || target.top > clip.bottom - 4) return;
      const slot = used[r[1]] = (used[r[1]] || 0) + 1;
      const x1 = a.left + a.width / 2 - frame.left, y1 = a.top + a.height / 2 - frame.top;
      const cx = target.left + target.width / 2 - frame.left, cy = target.top + target.height / 2 - frame.top, radius = target.width / 2;
      // El cable entra por una esquina del mando (las perillas son redondas y dejan las esquinas libres):
      // primero la de abajo más cercana a la toma, después la otra, y si hay más, las de arriba.
      const near = x1 <= cx ? -1 : 1, side = slot % 2 ? near : -near, low = slot <= 2 ? 1 : -1;
      const x2 = fader ? cx + side * (radius - 14) : cx + side * radius * .8, y2 = fader ? cy + target.height / 2 + 3 : cy + low * radius * .8;
      const k = Math.max(22, Math.abs(y1 - y2) * .42);
      const d = `M${x1.toFixed(1)} ${y1.toFixed(1)}C${x1.toFixed(1)} ${(y1 - k).toFixed(1)} ${(x2 + side * 16).toFixed(1)} ${(y2 + 26).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      const tone = SRC[r[0]].tone, id = 'rigPlug' + index;
      defs += `<radialGradient id="${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".35" stop-color="${tone}"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>`;
      html += `<path d="${d}" class="shade"/><path d="${d}" stroke="${tone}" class="cord"/><path d="${d}" class="shine"/><circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="5" fill="${tone}"/><circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="5" fill="url(#${id})"/>`;
    });
    host.innerHTML = `<defs><filter id="rigShade" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>${defs}</defs>${html}`;
  }
  // Lo que cambia cada pocos cuadros: luces de las tomas, puntos vivos, pantallita.
  function paint(now) {
    if (!ui.rig || state.clean) { lcd(false); return; }
    for (const [key, led] of ui.leds) led.style.opacity = (.22 + .78 * Math.abs(mods[key])).toFixed(2);
    for (const id of Object.keys(ui.ctl)) {
      const node = ui.ctl[id];
      if (ui.stale && !(ui.drag && ui.drag.id === id)) syncCtl(id);
      if (node.classList.contains('is-patched')) {
        if (node.classList.contains('rig-fader')) node.style.setProperty('--live', val[id].toFixed(4));
        else node.style.setProperty('--live', angle(val[id]).toFixed(1) + 'deg');
      }
    }
    ui.stale = false;
    const cross = $('rigCross');
    cross.style.left = (pad.x * 100).toFixed(1) + '%'; cross.style.top = ((1 - pad.y) * 100).toFixed(1) + '%';
    put('rigBpm', String(Math.round(bpmNow())));
    $('rigTap').classList.toggle('is-beat', (ph.lfo[0] % 1) < .12 && !!live.d['lfo.sync']);
    $('rigMidi').classList.toggle('is-active', now - midi.seen < 120);
    if (!eng.ok) note(eng.error ? 'Este navegador no tiene WebGL 2: STAGE no puede dibujar aquí.' : '');
    else if (!camReady()) note(live.d['src.gen'] && live.p['mix.fade'] > .5 ? '' : 'Sin cámara. Toca el monitor para activarla.');
    else if (live.d['mix.mode'] === 5 && !eng.hasMask) note(flipSilhouette.status().phase === 'failed' ? 'El recorte de silueta necesita conexión la primera vez.' : 'Cargando el recorte de silueta…');
    else note('');
    lcd(false);
  }

  // ── Gestos ──────────────────────────────────────────────────────────────────
  function wire() {
    const rig = ui.rig;
    // Perillas y deslizador: arrastre vertical (u horizontal en el deslizador); doble toque, a fábrica.
    ui.panel.addEventListener('pointerdown', event => {
      const node = event.target.closest('[data-param]');
      if (!node) return;
      const id = node.dataset.param;
      event.preventDefault();
      if (midi.learn) { learnTarget('p:' + id, node); return; }
      try { node.setPointerCapture(event.pointerId); } catch (_) {}
      const fader = node.classList.contains('rig-fader');
      const route = ui.armed ? routeOf(ui.armed, id) : null;
      ui.drag = { id, node, fader, x: event.clientX, y: event.clientY, armed: ui.armed, start: ui.armed ? (route ? route[2] : 0) : live.p[id], moved: false, step: -1, had: !!route, width: fader ? node.querySelector('.track').getBoundingClientRect().width : 0 };
      node.classList.add('is-held');
    });
    ui.panel.addEventListener('pointermove', event => {
      const drag = ui.drag;
      if (!drag || !drag.node.hasPointerCapture(event.pointerId)) return;
      const delta = drag.fader ? (event.clientX - drag.x) / Math.max(40, drag.width - 30) : (drag.y - event.clientY) / 190 + (event.clientX - drag.x) / 420;
      if (!drag.moved && Math.abs(delta) < .012) return;
      drag.moved = true;
      if (drag.armed) {
        const amt = clamp(drag.start + delta * 1.6, -1, 1);
        setRoute(drag.armed, drag.id, Math.abs(amt) < .02 ? (amt < 0 ? -.02 : .02) : amt);
        readout(SRC[drag.armed].label + ' > ' + P[drag.id][0] + ' ' + (amt > 0 ? '+' : '') + Math.round(amt * 100), 1600);
      } else {
        let v = clamp(drag.start + delta);
        if (P[drag.id][2] && Math.abs(v - .5) < .022) v = .5;             // muesca del centro
        setParam(drag.id, v);
        readout(P[drag.id][0] + ' ' + describe(drag.id, v), 1600);
      }
      const step = Math.round((drag.armed ? (routeOf(drag.armed, drag.id) || [0, 0, 0])[2] : live.p[drag.id]) * 24);
      if (step !== drag.step) { drag.step = step; feel.detent(event.clientX); }
    });
    const release = event => {
      const drag = ui.drag;
      if (!drag) return;
      ui.drag = null;
      drag.node.classList.remove('is-held');
      if (drag.moved || event.type === 'pointercancel') return;
      const now = performance.now();
      if (drag.armed) {                                                   // toque con un cable en la mano: conecta o desconecta
        if (drag.had) setRoute(drag.armed, drag.id, 0); else setRoute(drag.armed, drag.id, .5);
        feel.tap('switch', 'down', event.clientX);
        readout(SRC[drag.armed].label + (drag.had ? ' SUELTA ' : ' > ') + P[drag.id][0], 1500);
      } else if (ui.lastTap.id === drag.id && now - ui.lastTap.t < 340) {
        setParam(drag.id, P[drag.id][1]);
        feel.tap('key', 'down', event.clientX);
        readout(P[drag.id][0] + ' DE FÁBRICA', 1100);
      } else readout(P[drag.id][0] + ' ' + describe(drag.id, live.p[drag.id]), 1200);
      ui.lastTap = { t: now, id: drag.id };
    };
    ui.panel.addEventListener('pointerup', release);
    ui.panel.addEventListener('pointercancel', release);
    ui.panel.addEventListener('keydown', event => {
      const node = event.target.closest('[data-param]');
      if (!node) return;
      const step = { ArrowUp: .02, ArrowRight: .02, ArrowDown: -.02, ArrowLeft: -.02 }[event.key];
      if (!step) return;
      event.preventDefault();
      setParam(node.dataset.param, live.p[node.dataset.param] + step);
      readout(P[node.dataset.param][0] + ' ' + describe(node.dataset.param, live.p[node.dataset.param]));
    });
    ui.panel.addEventListener('click', event => {
      const stepper = event.target.closest('[data-step]');
      if (stepper) {
        const id = stepper.closest('.rig-pick').dataset.pick, count = OPTIONS[id].length;
        setD(id, (optionIndex(id) + +stepper.dataset.step + count) % count);
        syncPicks(); syncToggles();
        readout(OPTIONS[id][optionIndex(id)], 1100);
        return;
      }
      const toggle = event.target.closest('[data-toggle]');
      if (toggle) { setD(toggle.dataset.toggle, getD(toggle.dataset.toggle) ? 0 : 1); syncToggles(); return; }
      const unroute = event.target.closest('[data-unroute]');
      if (unroute) { const r = live.r[+unroute.dataset.unroute]; if (r) setRoute(r[0], r[1], 0); return; }
      const key = event.target.closest('[data-act]');
      if (!key) return;
      const act = key.dataset.act;
      if (act === 'flip') { if (typeof _toggleCamera === 'function') _toggleCamera(); }
      else if (act === 'hands') handsOn(!hands.on);
      else if (act === 'sync') { setD('lfo.sync', live.d['lfo.sync'] ? 0 : 1); readout(live.d['lfo.sync'] ? 'LFO A TEMPO ' + Math.round(bpmNow()) : 'LFO LIBRES'); }
      else if (act === 'black') setBlack(!ui.black);
      else if (act === 'unpatch') { live.r = []; syncJacks(); Object.keys(ui.ctl).forEach(syncCtl); cables(); routesList(); save(); readout('SIN CABLES'); }
      else if (act === 'unmidi') { store.midi = { cc: {}, note: {} }; save(); readout('MIDI OLVIDADO'); }
      else if (act === 'clean') clean(!state.clean);
      else if (act === 'window') openWindow();
      else if (act === 'factory') {
        if (key.dataset.sure) { store.scenes = FACTORY(); delete key.dataset.sure; key.querySelector('span').textContent = 'FÁBRICA'; recall(0, true); readout('ESCENAS DE FÁBRICA'); }
        else { key.dataset.sure = '1'; key.querySelector('span').textContent = '¿SEGURO?'; setTimeout(() => { if (key.isConnected && key.dataset.sure) { delete key.dataset.sure; key.querySelector('span').textContent = 'FÁBRICA'; } }, 3000); }
      }
      syncKeys();
    });
    // Pestañas de módulo.
    $('rigTabs').addEventListener('click', event => {
      const tab = event.target.closest('[data-page]');
      if (!tab) return;
      ui.page = tab.dataset.page;
      renderPage();
    });
    // Escenas: toque para llamar, mantener para guardar.
    let hold = 0, held = false;
    $('rigScenes').addEventListener('pointerdown', event => {
      const key = event.target.closest('[data-scene]');
      if (!key || midi.learn) return;
      held = false;
      clearTimeout(hold);
      hold = setTimeout(() => { held = true; keep(+key.dataset.scene); feel.tap('switch', 'down', event.clientX); }, 620);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) $('rigScenes').addEventListener(type, () => clearTimeout(hold));
    $('rigScenes').addEventListener('click', event => {
      const key = event.target.closest('[data-scene]');
      if (!key) return;
      if (midi.learn) { learnTarget('s:' + key.dataset.scene, key); return; }
      if (!held) recall(+key.dataset.scene);
      held = false;
    });
    // Tomas de modulación.
    $('rigJacks').addEventListener('click', event => {
      const jack = event.target.closest('.rig-jack');
      if (jack && !midi.learn) arm(jack.dataset.src);
    });
    // Transporte.
    $('rigRec').addEventListener('click', () => (rec.on ? recStop() : recStart()));
    $('rigPhoto').addEventListener('click', photo);
    $('rigOut').addEventListener('click', () => (COARSE ? clean(!state.clean) : openWindow()));
    $('rigTap').addEventListener('click', event => { if (midi.learn) learnTarget('t:tap', event.currentTarget); else tap(); });
    $('rigMic').addEventListener('click', () => (audio.on ? micOff() : micOn()));
    $('rigMidi').addEventListener('click', () => { if (midi.state === 'off' || midi.state === 'denied' || midi.state === 'none') midiConnect(); else setLearn(!midi.learn); });
    // El monitor es un pad XY; doble toque, siguiente escena. Sin cámara, un toque la pide.
    let lastPadTap = 0;
    ui.screen.addEventListener('pointerdown', event => {
      if (!camReady() && typeof startCamera === 'function' && !state.clean) startCamera(facingMode).catch(() => {});
      try { ui.screen.setPointerCapture(event.pointerId); } catch (_) {}
      pad.active = true; pad.moved = false; pad.downX = event.clientX; pad.downY = event.clientY;
      ui.screen.classList.add('is-touched');
    });
    ui.screen.addEventListener('pointermove', event => {
      if (!pad.active) return;
      if (!pad.moved && Math.hypot(event.clientX - pad.downX, event.clientY - pad.downY) < 6) return;
      pad.moved = true;
      const box = eng.canvas.getBoundingClientRect();
      pad.x = clamp((event.clientX - box.left) / box.width); pad.y = clamp(1 - (event.clientY - box.top) / box.height);
    });
    const padUp = event => {
      if (!pad.active) return;
      pad.active = false;
      ui.screen.classList.remove('is-touched');
      if (pad.moved || event.type === 'pointercancel') return;
      const now = performance.now();
      if (now - lastPadTap < 320) { recall((store.scene + 1) % 8); lastPadTap = 0; } else lastPadTap = now;
    };
    ui.screen.addEventListener('pointerup', padUp);
    ui.screen.addEventListener('pointercancel', padUp);
    // Soltar el cable tocando fuera de los mandos.
    rig.addEventListener('click', event => { if (ui.armed && !event.target.closest('.rig-jack, [data-param], .rig-tabs, .rig-screen')) arm(ui.armed); });
    const relayout = () => { if (state.active) requestAnimationFrame(cables); };
    window.addEventListener('resize', relayout);
    rig.querySelector('.rig-deck').addEventListener('scroll', cables, { passive: true });
    document.addEventListener('keydown', event => { if (state.active && !/INPUT|TEXTAREA|SELECT/.test((event.target.tagName || ''))) key(event.key); });
  }
  // Teclado del ordenador (también llega desde la ventana de salida): 1–8 escenas, espacio tempo, B negro.
  function key(name) {
    if (/^[1-8]$/.test(name)) recall(+name - 1);
    else if (name === ' ') tap();
    else if (name === 'b' || name === 'B') setBlack(!ui.black);
  }

  // ── Entrar y salir ──────────────────────────────────────────────────────────
  function enter() {
    if (!ui.rig && !build()) return;
    state.active = true; state.failed = 0;
    document.body.classList.add('stage-mode');
    if (!eng.gl && !eng.error) eng.ok = initGl();
    if (typeof stream !== 'undefined' && !stream && !extAudioMode && typeof startCamera === 'function') startCamera(facingMode).catch(() => {});
    clock.last = performance.now();
    cancelAnimationFrame(state.raf);
    pumpMain(); pumpOut(); wake(true);
    patched(); syncKeys(); lcd(true);
    // La primera vez, dos frases que explican el aparato.
    try {
      if (!localStorage.getItem('flip.stage.hello')) { localStorage.setItem('flip.stage.hello', '1'); flipToast('Teclas 1 a 8: escenas. Toca una toma de abajo y luego una perilla para conectar un cable.', 6500); }
    } catch (_) {}
    if (!midi.access && navigator.permissions && navigator.requestMIDIAccess) {
      navigator.permissions.query({ name: 'midi' }).then(permission => { if (permission.state === 'granted' && state.active && !midi.access) midiConnect(); }).catch(() => {});
    }
  }
  function exit() {
    state.active = false;
    document.body.classList.remove('stage-mode');
    cancelAnimationFrame(state.raf);
    recStop();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (out.win && !out.win.closed) { try { out.win.close(); } catch (_) {} }
    output.detach();
    micOff(); handsOn(false); wake(false);
    if (ui.armed) arm(ui.armed);
    if (midi.learn) setLearn(false);
    save();
  }
  window._stageOnEnter = enter;
  window._stageOnExit = exit;
  window.addEventListener('pagehide', () => { if (out.win && !out.win.closed) { try { out.win.close(); } catch (_) {} } });
  function boot() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // ── Interfaz pública (y de pruebas) ─────────────────────────────────────────
  return {
    output, key,
    pad(x, y) { pad.x = clamp(x); pad.y = clamp(y); },
    get active() { return state.active; },
    status: () => ({ active: state.active, ok: eng.ok, error: eng.error, size: [eng.w, eng.h], fps: +clock.fps.toFixed(1), scene: store.scene, name: store.scenes[store.scene].name, hasA: eng.hasA, path: eng.path, camKind: eng.camKind,
      hasMask: eng.hasMask, page: ui.page, armed: ui.armed, routes: live.r.map(r => r.slice()), audio: { on: audio.on, bpm: Math.round(audio.bpm) }, bpm: +bpmNow().toFixed(1), bpmSource: bpmSource(),
      midi: { state: midi.state, learn: midi.learn, target: midi.target, map: JSON.parse(JSON.stringify(store.midi)) }, hands: { on: hands.on, seen: hands.seen }, out: { window: !!out.ctx, clean: state.clean }, rec: rec.on, black: ui.black, morphing: !!morph }),
    get: id => (id in P ? live.p[id] : getD(id)),
    value: id => val[id],
    mods: () => Object.assign({}, mods),
    set(id, v) { if (id in P) setParam(id, v); else { setD(id, v); if (ui.rig) { syncPicks(); syncToggles(); } } },
    route: setRoute, recall, keep, tap,
    page(id) { ui.page = id; renderPage(); },
    // Avanza cuadros a paso fijo (pruebas deterministas).
    step(count = 1, ms = 1000 / 60) { for (let i = 0; i < count; i++) frame(ms / 1000); },
    // Color medio de un recuadro de la salida (fracciones, origen arriba a la izquierda), recién dibujada.
    probe(x, y, w, h) {
      if (!eng.ok) return null;
      const gl = eng.gl;
      draw(evaluate(), 0, clock.t);
      const px = Math.max(1, Math.round(w * eng.w)), py = Math.max(1, Math.round(h * eng.h));
      const data = new Uint8Array(px * py * 4);
      gl.readPixels(Math.round(x * eng.w), Math.round((1 - y - h) * eng.h), px, py, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
      const n = data.length / 4;
      return { r: r / n, g: g / n, b: b / n };
    },
    audio: { inject(levels) { audio.inject = levels ? Object.assign({}, levels) : null; }, on: micOn, off: micOff },
    midi: { inject: (bytes, stamp) => midiIn(bytes, stamp === undefined ? performance.now() : stamp), connect: midiConnect, learn: setLearn },
    // direct: fuerza la subida directa del vídeo. inject: sustituye la cámara por unos planos dados (pruebas del sombreador).
    camera: { direct(on) { camState.forceDirect = !!on; eng.path = ''; eng.camSeq = -1; }, inject(planes) { camState.injected = planes || null; eng.camSeq = -1; eng.path = ''; eng.yuvKey = ''; } },
    reset() { store = fresh(); adopt(store.scenes[0]); morph = null; patched(); save(); },
    tables: { PARAMS: P, SOURCES: SOURCES.map(s => s[0]), PAGES: PAGES.map(p => p.id), GENS, MIX_MODES, LOOKS: LOOKS.map(l => l.key) },
  };
})();
// La ventana de salida llega a la consola por window.opener.
window.flipStage = flipStage;
