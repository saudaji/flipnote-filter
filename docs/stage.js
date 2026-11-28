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
// toma y luego una perilla: aparece el cable. Diez escenas con transición, MIDI con aprendizaje
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
    detent: (x, ratio) => { if (window.flipFeel) flipFeel.detent(x, ratio); },
    edge: (key, at, x) => !!(window.flipFeel && flipFeel.edge && flipFeel.edge(key, at, x)),
    tap: (kind, phase, x) => { if (window.flipFeel) flipFeel.tap(kind, phase, x); },
    hush: (key, on) => { if (window.flipFeel) flipFeel.hush(key, on); },
  };

  // ── Tablas ──────────────────────────────────────────────────────────────────
  // Moduladores: clave, rótulo, color del cable, bipolar (−1…1) o no (0…1).
  const SOURCES = [
    ['lfo1', 'LFO 1', '#ec5b45', true], ['lfo2', 'LFO 2', '#f0ae2b', true], ['bass', 'BAJO', '#2f78dc'], ['mid', 'MEDIO', '#33b09f'],
    ['high', 'AGUDO', '#8b79d6'], ['beat', 'GOLPE', '#e5392b'], ['padx', 'PAD X', '#566679'], ['pady', 'PAD Y', '#8d8572'],
    ['note', 'NOTA', '#3ca956'], ['hx', 'MANO X', '#f08a2d'], ['hy', 'MANO Y', '#d7559b'], ['pinch', 'PINZA', '#3b3c3f'],
    // Pistas de Ableton Live (enlace LIVE con PITÁGORAS): cada toma sigue el nivel de una pista.
    ['lv1', 'PISTA 1', '#7ddb8b'], ['lv2', 'PISTA 2', '#58c6b0'], ['lv3', 'PISTA 3', '#5fb0e6'], ['lv4', 'PISTA 4', '#b39be8'], ['lv5', 'PISTA 5', '#f2a65a'], ['lv6', 'PISTA 6', '#ef7f7f'],
  ];
  const LIVE_KEYS = ['lv1', 'lv2', 'lv3', 'lv4', 'lv5', 'lv6'];
  const SRC = Object.fromEntries(SOURCES.map(s => [s[0], { label: s[1], tone: s[2], bipolar: !!s[3] }]));
  // Mandos: clave → [rótulo, valor de fábrica, tiene centro].
  // (rótulos del TALLER: cada uno, distinto de los demás —antes había dos ZOOM y dos GIRO—)
  const P = {
    'gen.freq': ['ESCALA', .35], 'gen.speed': ['VELOCIDAD', .62, true], 'gen.shape': ['TRAZO', .3], 'gen.hue': ['COLOR B', .55],
    'mix.fade': ['MEZCLA A/B', 0], 'key.level': ['UMBRAL', .5], 'key.soft': ['BORDE', .25],
    'fb.amt': ['ECO', 0], 'fb.zoom': ['ZOOM ECO', .5, true], 'fb.rot': ['GIRO ECO', .5, true], 'fb.decay': ['COLA', .8],
    'fb.x': ['DERIVA X', .5, true], 'fb.y': ['DERIVA Y', .5, true], 'fb.hue': ['COLOR ECO', 0],
    'geo.zoom': ['ZOOM', .5, true], 'geo.rot': ['ÁNGULO', .5, true], 'geo.spin': ['VEL. GIRO', .5, true], 'geo.kal': ['CALEIDO', 0],
    'geo.tile': ['MOSAICO', 0], 'geo.warp': ['ONDULAR', 0], 'geo.wfreq': ['RIZO', .3],
    'col.hue': ['MATIZ', 0], 'col.sat': ['SATURAC.', .5, true], 'col.con': ['CONTRASTE', .5, true], 'col.cycle': ['CICLO', .5, true],
    'col.tint': ['TINTE', 0], 'col.post': ['POSTERIZ.', 0], 'col.solar': ['SOLARIZ.', 0],
    'sig.rgb': ['RGB', 0], 'sig.tear': ['RASGADO', 0], 'sig.vhold': ['V-HOLD', .5, true], 'sig.bleed': ['CROMA', 0],
    'sig.pix': ['PÍXEL', 0], 'sig.scan': ['LÍNEAS', 0], 'sig.noise': ['ESTÁTICA', 0], 'sig.strobe': ['ESTROBO', 0],
    // Destellos sobre las crestas de luz, hebras horizontales de las luces altas y trama ordenada por canal.
    'sig.spark': ['CHISPA', 0], 'sig.smear': ['ARRASTRE', 0], 'sig.dither': ['TRAMA RGB', 0],
    'lfo1.rate': ['VEL. LFO 1', .35], 'lfo2.rate': ['VEL. LFO 2', .6], 'aud.gain': ['GANANCIA', .5, true], 'aud.fall': ['CAÍDA', .4],
    'out.level': ['NIVEL', 1], 'mod.morph': ['TRANSICIÓN', .22],
  };
  // En FÁCIL cada efecto se llama por lo que se ve, y cada fuente por lo que es, sin jerga de sintetizador.
  const FACIL = {
    'gen.freq': 'TAMAÑO', 'gen.speed': 'VELOCIDAD', 'gen.shape': 'ESTILO', 'gen.hue': 'COLOR DE FONDO', 'mix.fade': 'MEZCLA A/B', 'key.level': 'RECORTE', 'key.soft': 'SUAVIDAD',
    'fb.amt': 'ESTELA', 'fb.zoom': 'TÚNEL', 'fb.rot': 'ESPIRAL', 'fb.decay': 'DURACIÓN', 'fb.x': 'ARRASTRE ↔', 'fb.y': 'ARRASTRE ↕', 'fb.hue': 'ARCOÍRIS',
    'geo.zoom': 'ZOOM', 'geo.rot': 'INCLINAR', 'geo.spin': 'ROTACIÓN', 'geo.kal': 'CALEIDOSCOPIO', 'geo.tile': 'MOSAICO', 'geo.warp': 'ONDULAR', 'geo.wfreq': 'DETALLE DE ONDA',
    'col.hue': 'COLOR', 'col.sat': 'VIVEZA', 'col.con': 'CONTRASTE', 'col.cycle': 'CAMBIO DE COLOR', 'col.tint': 'PALETA', 'col.post': 'PÓSTER', 'col.solar': 'METAL',
    'sig.rgb': 'SEPARAR RGB', 'sig.tear': 'GLITCH VHS', 'sig.vhold': 'RODAR TV', 'sig.bleed': 'BARRIDO VHS', 'sig.pix': 'PIXELADO', 'sig.scan': 'LÍNEAS DE TV', 'sig.noise': 'ESTÁTICA', 'sig.strobe': 'ESTROBO',
    // (en FÁCIL «ARRASTRE ↔» ya es la deriva del eco: el arrastre de las luces se llama por lo que dibuja)
    'sig.spark': 'DESTELLOS', 'sig.smear': 'HEBRAS DE LUZ', 'sig.dither': 'TRAMA RGB',
  };
  const FACIL_SRC = { lfo1: 'VAIVÉN 1', lfo2: 'VAIVÉN 2', mid: 'MEDIOS', high: 'AGUDOS', padx: 'DEDO ↔', pady: 'DEDO ↕', note: 'TECLA MIDI', hx: 'MANO ↔', hy: 'MANO ↕', pinch: 'PELLIZCO' };
  // (con la paleta ESPECTRO, SOLARIZ. no dobla la luz: da las vueltas de arcoíris; en plena transición vale el TINTE de destino)
  const spectral = () => live.d['col.pal'] === PAL_ESPECTRO && (morph && morph.to['col.tint'] !== undefined ? morph.to['col.tint'] : live.p['col.tint']) > 0;
  const facil = id => (id === 'col.solar' && spectral() ? 'VUELTAS DE COLOR' : FACIL[id] || P[id][0]);
  const srcFacil = key => FACIL_SRC[key] || SRC[key].label;
  const IDS = Object.keys(P);
  const GLOBAL_IDS = ['aud.gain', 'aud.fall', 'out.level', 'mod.morph'];      // no cambian al cambiar de escena
  const SCENE_IDS = IDS.filter(id => !GLOBAL_IDS.includes(id));
  const D0 = { 'src.look': 'RAW', 'src.gen': 2, 'mix.mode': 0, 'key.inv': 0, 'fb.mode': 0, 'geo.mirror': 0, 'col.pal': 0, 'col.inv': 0, 'lfo1.shape': 0, 'lfo2.shape': 1, 'lfo.sync': 0 };
  const GENS = ['NEGRO', 'BARRAS', 'PLASMA', 'ANILLOS', 'REJILLA', 'NIEVE', 'ONDA', 'ESPECTRO', 'CARTA', 'PINCEL', 'SALPICADURA'];
  const GEN_PINCEL = 9, GEN_SALPICADURA = 10;
  let BRUSH_R = .13;
  const MIX_MODES = ['MEZCLA', 'SUMA', 'MULTIPLICA', 'DIFERENCIA', 'CLAVE DE LUZ', 'SILUETA'];
  // SELLO: el lazo opaco en escalón. La imagen anterior vuelve copiada celda a celda, movida un número
  // entero de celdas y sin suavizar; lo nuevo se estampa encima con borde duro. Así una trama de puntos
  // viaja por el lazo sin volverse gris (con ECO, el remuestreo la emborrona en tres cuadros).
  const FB_MODES = ['ECO', 'ESTELA', 'CLAVE', 'SELLO'];
  const FB_SELLO = 3;
  const MIRRORS = ['NO', 'HORIZONTAL', 'VERTICAL', 'CUATRO'];
  // ESPECTRO no es un degradado de tres tintas: es un colorizador cíclico (la luz recorre el arcoíris
  // varias veces, con la clave a negro abajo). Sus tres colores solo sirven de muestra.
  const PALETTES = [['FÓSFORO', '#020a04', '#1fae4a', '#d8ffd0'], ['ÁMBAR', '#0c0500', '#d9770a', '#ffe9b0'], ['HIELO', '#02040e', '#2f78dc', '#e6f6ff'],
    ['FUEGO', '#0a0002', '#e5392b', '#ffd24a'], ['NEÓN', '#0a0030', '#e6399b', '#3df0e0'], ['CREMA', '#3a3833', '#ec5b45', '#f3efe5'], ['ULTRA', '#12002a', '#8b79d6', '#f0ae2b'],
    ['ESPECTRO', '#000000', '#e6399b', '#3df0e0']];
  const PAL_ESPECTRO = 7;
  const LFO_SHAPES = ['SENO', 'TRIÁNGULO', 'SIERRA', 'CUADRADA', 'AZAR'];
  const ASPECTS = ['16:9', '4:3', '1:1', '9:16'], ASPECT_DIMS = [[16, 9], [4, 3], [1, 1], [9, 16]];
  const QUALITIES = ['AUTO', '540P', '720P', '1080P'], QUALITY_H = [0, 540, 720, 1080], LADDER = [360, 432, 540, 720];
  const DIVS = [[1 / 32, '8 COMPASES'], [1 / 16, '4 COMPASES'], [1 / 8, '2 COMPASES'], [1 / 4, '1 COMPÁS'], [1 / 2, '1/2'], [1, '1/4'], [2, '1/8'], [4, '1/16']];
  // A · CÁMARA: la cámara directa, cada familia de cámaras de FLIP y ASCII. Se lee de CAM_FAMILIES cada vez
  // que hace falta, sin lista fija: otras partes de FLIP registran familias y variantes (CLON las aprende en
  // marcha). Una fuente es «FAMILIA» —la variante puesta en CAM si es esa familia; si no, la primera: así se
  // guardaba antes— o «FAMILIA:VARIANTE». Si la familia o la variante pedida no existe (todavía), no se
  // borra de la escena: se pinta la cámara directa o la variante de siempre hasta que llegue.
  const families = () => (typeof CAM_FAMILIES === 'object' && CAM_FAMILIES) || {};
  function looks() {
    const list = [{ key: 'RAW', label: 'DIRECTA' }];
    for (const [key, cfg] of Object.entries(families())) if (cfg && typeof cfg === 'object') list.push({ key, label: String(cfg.displayLabel || cfg.label || key).toUpperCase() });
    list.push({ key: 'ASCII', label: 'ASCII' });
    return list;
  }
  const lookFamily = look => String(look || 'RAW').split(':')[0];
  const lookKnown = look => { const family = lookFamily(look); return family === 'RAW' || family === 'ASCII' || !!families()[family]; };
  const allVariants = family => { const cfg = families()[family]; return cfg && Array.isArray(cfg.variants) ? cfg.variants.filter(v => v && v.id) : []; };
  const variantsOf = family => allVariants(family).filter(v => !v.oculta);          // las que se ofrecen (CLON esconde las que no están a mano)
  function lookVariant(look) {
    const [family, asked] = String(look || '').split(':'), list = allVariants(family);
    if (asked && list.some(v => v.id === asked)) return asked;
    if (typeof camFamily !== 'undefined' && family === camFamily && typeof camVariant !== 'undefined') return camVariant;
    return list[0] ? list[0].id : '';
  }
  const OPTIONS = {
    'src.gen': GENS, 'mix.mode': MIX_MODES, 'fb.mode': FB_MODES, 'geo.mirror': MIRRORS, 'col.pal': PALETTES.map(p => p[0]),
    'lfo1.shape': LFO_SHAPES, 'lfo2.shape': LFO_SHAPES, 'out.aspect': ASPECTS, 'out.quality': QUALITIES,
  };
  // FÁCIL es la vista de entrada: los cuatro mandos que más cuentan en la escena (easyKnobs) y pocas
  // fuentes a la vista. Las otras ocho son el TALLER: el sintetizador entero, módulo a módulo.
  const PAGES = [
    { id: 'easy', label: 'FÁCIL', title: '', knobs: [] },
    { id: 'src', label: 'IMAGEN', title: 'IMAGEN · A CÁMARA · B FONDO', picks: [['src.look', 'A · CÁMARA'], ['src.var', 'A · VARIANTE'], ['src.gen', 'B · GENERADOR']], knobs: ['gen.freq', 'gen.speed', 'gen.shape', 'gen.hue'] },
    { id: 'mix', label: 'MEZCLA', title: 'MEZCLA Y RECORTE', picks: [['mix.mode', 'MODO']], fader: 'mix.fade', knobs: ['key.level', 'key.soft'], toggles: [['key.inv', 'INVERTIR']] },
    { id: 'fb', label: 'ECO', title: 'ECO · REALIMENTACIÓN', picks: [['fb.mode', 'MODO']], knobs: ['fb.amt', 'fb.zoom', 'fb.rot', 'fb.decay', 'fb.x', 'fb.y', 'fb.hue'] },
    { id: 'geo', label: 'FORMA', title: 'FORMA Y ESPEJOS', picks: [['geo.mirror', 'ESPEJO']], knobs: ['geo.zoom', 'geo.rot', 'geo.spin', 'geo.kal', 'geo.tile', 'geo.warp', 'geo.wfreq'] },
    { id: 'col', label: 'COLOR', title: 'COLOR Y PALETA', picks: [['col.pal', 'PALETA DE TINTA']], knobs: ['col.hue', 'col.sat', 'col.con', 'col.cycle', 'col.tint', 'col.post', 'col.solar'], toggles: [['col.inv', 'NEGATIVO']] },
    { id: 'sig', label: 'EFECTOS', title: 'SEÑAL DE VIDEO · TV Y GLITCH', knobs: ['sig.rgb', 'sig.tear', 'sig.vhold', 'sig.bleed', 'sig.pix', 'sig.scan', 'sig.noise', 'sig.strobe', 'sig.spark', 'sig.smear', 'sig.dither'] },
    { id: 'mod', label: 'RITMO', title: 'RITMO Y CABLES', picks: [['lfo1.shape', 'LFO 1'], ['lfo2.shape', 'LFO 2'], ['aud.src', 'ENTRADA DE SONIDO']], knobs: ['lfo1.rate', 'lfo2.rate', 'aud.gain', 'aud.fall'] },
    { id: 'out', label: 'SALIDA', title: 'SALIDA Y PROYECTOR', picks: [['out.aspect', 'FORMATO'], ['out.quality', 'CALIDAD']], knobs: ['out.level', 'mod.morph'], toggles: [['out.flipX', 'VOLTEAR H'], ['out.flipY', 'VOLTEAR V']] },
  ];

  // ── Escenas de fábrica ──────────────────────────────────────────────────────
  const basePatch = () => { const p = {}; for (const id of SCENE_IDS) p[id] = P[id][1]; return p; };
  const scene = (name, p = {}, d = {}, r = []) => ({ name, p: Object.assign(basePatch(), p), d: Object.assign({}, D0, d), r });
  // Respaldo de la escena GUSANO cuando la cámara GUSANO no está: un PINCEL (óvalo generado, cantos menta
  // en sus puntas y orla negra más allá) recorre una curva cerrada por la mitad de abajo y se estampa paso a
  // paso en trama RGB sobre las copias anteriores, que derivan despacio hacia arriba a saltos de celda
  // entera: cintas curvas apiladas, de puntos RGB con filo menta en escalera y negro entre pliegues. Los
  // graves aceleran el pincel y abren su curva, el golpe cambia el color de la vértebra, los agudos espesan
  // la trama y los medios tuercen el lienzo.
  const gusanoRespaldo = () => scene('GUSANO', { 'mix.fade': 1, 'key.level': .1, 'key.soft': .04, 'gen.speed': .9, 'gen.freq': .8, 'gen.shape': 0, 'gen.hue': .17, 'fb.amt': 1, 'fb.decay': .92, 'fb.x': .54, 'fb.y': .545, 'fb.hue': .06, 'sig.dither': .85 },
    { 'mix.mode': 0, 'src.gen': GEN_PINCEL, 'fb.mode': FB_SELLO }, [['bass', 'gen.speed', .1], ['beat', 'fb.hue', .33], ['bass', 'gen.freq', .2], ['high', 'sig.dither', .15], ['mid', 'fb.rot', .1]]);
  const RESPALDO = { GUSANO: gusanoRespaldo };
  const FACTORY = () => [
    scene('VIVO', { 'sig.scan': .22, 'sig.rgb': .08, 'col.sat': .56, 'col.con': .55 }, {}, [['bass', 'sig.rgb', .55], ['beat', 'geo.zoom', .1], ['high', 'col.con', .12]]),
    scene('TÚNEL', { 'fb.amt': .88, 'fb.zoom': .62, 'fb.rot': .53, 'fb.hue': .1, 'fb.decay': .86, 'col.sat': .6 }, {}, [['lfo1', 'fb.rot', .1], ['bass', 'fb.zoom', .2], ['mid', 'fb.hue', .2], ['beat', 'col.con', .14]]),
    scene('MANDALA', { 'geo.kal': .55, 'geo.spin': .56, 'geo.zoom': .44, 'fb.amt': .6, 'fb.zoom': .53, 'fb.decay': .84, 'col.sat': .66, 'lfo1.rate': .22 }, { 'fb.mode': 1 }, [['lfo1', 'geo.zoom', .12], ['beat', 'geo.zoom', .14], ['mid', 'col.hue', .3], ['bass', 'geo.warp', .35]]),
    scene('SILUETA', { 'mix.fade': 1, 'key.level': .5, 'key.soft': .3, 'gen.freq': .3, 'gen.speed': .64, 'gen.hue': .62, 'gen.shape': .5 }, { 'mix.mode': 5, 'src.gen': 2 }, [['bass', 'gen.freq', .3], ['lfo2', 'gen.hue', .2], ['beat', 'gen.shape', .3]]),
    scene('VHS', { 'sig.tear': .34, 'sig.bleed': .62, 'sig.scan': .5, 'sig.noise': .34, 'sig.rgb': .26, 'col.sat': .62, 'col.con': .56 }, {}, [['beat', 'sig.tear', .6], ['bass', 'sig.rgb', .45], ['lfo2', 'sig.noise', .12]]),
    scene('NEÓN', { 'col.solar': .72, 'col.tint': .82, 'col.post': .3, 'fb.amt': .5, 'fb.hue': .22, 'fb.decay': .86, 'fb.zoom': .52 }, { 'col.pal': 4, 'fb.mode': 1 }, [['lfo1', 'col.hue', .5], ['high', 'sig.rgb', .4], ['bass', 'fb.zoom', .16], ['beat', 'col.post', .25]]),
    scene('ONDAS', { 'mix.fade': .9, 'gen.freq': .5, 'gen.hue': .3, 'gen.shape': .2, 'fb.amt': .86, 'fb.zoom': .44, 'fb.hue': .07, 'fb.decay': .9, 'col.sat': .4 }, { 'mix.mode': 1, 'src.gen': 6, 'fb.mode': 1 }, [['bass', 'fb.zoom', -.14], ['mid', 'gen.hue', .3], ['beat', 'gen.freq', .35]]),
    scene('PRUEBA', { 'mix.fade': 1 }, { 'src.gen': 8 }, []),
    // Salpicadura en colorizador analógico: un charco blanco generado (SALPICADURA) salpica sobre negro y
    // ESPECTRO lo vuelve curvas de nivel gruesas con el arcoíris entero, en lóbulos de video y escalones. Con
    // la cámara: MODO CLAVE DE LUZ y B · NEGRO (la figura sola sobre negro). Los graves corren las curvas y
    // estiran las luces en hebras, los medios suman vueltas, los agudos corren el croma y el golpe hincha
    // la salpicadura y enciende destellos.
    scene('ESPECTRO', { 'mix.fade': 1, 'key.level': .58, 'key.soft': .05, 'gen.speed': .75, 'gen.freq': .6, 'gen.shape': 0, 'col.tint': 1, 'col.solar': .2, 'col.cycle': .6, 'sig.bleed': .55 }, { 'mix.mode': 0, 'src.gen': GEN_SALPICADURA, 'col.pal': PAL_ESPECTRO },
      [['bass', 'col.cycle', .25], ['mid', 'col.solar', .3], ['high', 'sig.bleed', .35], ['beat', 'gen.freq', .2], ['beat', 'sig.spark', .6], ['bass', 'sig.smear', .4]]),
    // El gusano: la cámara GUSANO de FLIP (gusano.js) como fuente A, tal cual, sin bucle ni trama encima:
    // costillas de puntos que se abren en abanico por curvas amplias, remate menta en escalera y pliegues
    // que se montan; se genera solo y reacciona al sonido de STAGE por su cuenta (los graves empujan el
    // recorrido, cada golpe turna el color de los tramos). Si esa cámara no estuviera, la escena es su
    // respaldo: el PINCEL de STAGE sellado en trama RGB (ver gusanoRespaldo).
    scene('GUSANO', {}, { 'src.look': 'GUSANO' }, []),
  ];
  const SCENE_COUNT = 10;

  // ── Estado guardado ─────────────────────────────────────────────────────────
  const STORE = 'flip.stage.v3';        // v3: escenas de fábrica con reacción al sonido más marcada
  function fresh() { return { v: 3, scene: 0, scenes: FACTORY(), live: null, global: { aspect: 0, quality: 0, flipX: 0, flipY: 0, bpm: 0, p: {}, live: { url: '', slots: [] } }, midi: { cc: {}, note: {} } }; }
  function tidyPatch(patch, fallback) {
    // (una ranura que no estaba guardada —las escenas 9 y 10 en un estado de ocho— sale tal cual de fábrica, con sus cables)
    if (!patch || typeof patch !== 'object') return { name: fallback.name, p: Object.assign({}, fallback.p), d: Object.assign({}, fallback.d), r: fallback.r.map(r => r.slice()) };
    // (tres escenas de fábrica cambiaron de nombre: quien las tenía guardadas con el viejo, las ve con el nuevo)
    const viejo = { DIRECTO: 'VIVO', OSCILOS: 'ONDAS', CARTA: 'PRUEBA' }, nombre = String(patch && patch.name || fallback.name).slice(0, 12);
    const out = { name: viejo[nombre] === fallback.name ? fallback.name : nombre, p: {}, d: {}, r: [] };
    for (const id of SCENE_IDS) out.p[id] = Number.isFinite(patch && patch.p && patch.p[id]) ? clamp(patch.p[id]) : fallback.p[id];
    for (const id of Object.keys(D0)) out.d[id] = patch && patch.d && id in patch.d ? patch.d[id] : fallback.d[id];
    // (vale «FAMILIA» —como se guardaba antes— o «FAMILIA:VARIANTE»; una familia que aún no está
    //  registrada se conserva: se pinta la cámara directa hasta que llegue)
    if (typeof out.d['src.look'] !== 'string' || !/^[^:]{1,40}(:[^:]{1,60})?$/.test(out.d['src.look'])) out.d['src.look'] = 'RAW';
    for (const r of (patch && patch.r) || []) if (Array.isArray(r) && SRC[r[0]] && P[r[1]] && Number.isFinite(r[2]) && out.r.length < 24) out.r.push([r[0], r[1], clamp(r[2], -1, 1)]);
    return out;
  }
  function load() {
    const base = fresh();
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!raw || raw.v !== 3 || !Array.isArray(raw.scenes)) return base;
      base.scenes = base.scenes.map((factory, i) => tidyPatch(raw.scenes[i], factory));
      // (lo guardado con ocho escenas carga igual: las dos nuevas salen de fábrica)
      base.scene = clamp(raw.scene | 0, 0, SCENE_COUNT - 1);
      if (raw.live) base.live = tidyPatch(raw.live, base.scenes[base.scene]);
      const g = raw.global || {};
      Object.assign(base.global, { aspect: clamp(g.aspect | 0, 0, 3), quality: clamp(g.quality | 0, 0, 3), flipX: g.flipX ? 1 : 0, flipY: g.flipY ? 1 : 0, bpm: Number.isFinite(g.bpm) ? g.bpm : 0 });
      for (const id of GLOBAL_IDS) if (g.p && Number.isFinite(g.p[id])) base.global.p[id] = clamp(g.p[id]);
      if (g.live && typeof g.live === 'object') base.global.live = { url: typeof g.live.url === 'string' ? g.live.url.slice(0, 400) : '', slots: Array.isArray(g.live.slots) ? g.live.slots.slice(0, 6).map(x => (typeof x === 'string' ? x.slice(0, 40) : '')) : [] };
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
      if (typeof link !== 'undefined' && link.auto && link.auto.scene === store.scene && sameRoutes(live.r, link.auto.routes)) store.live.r = store.scenes[store.scene].r.map(r => r.slice());
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
// TRAMA RGB: Bayer 4×4 por canal, con G corrida una celda a la derecha y B una abajo. Los cuatro
// umbrales más bajos de la matriz caen en celdas (par, par): hasta un cuarto de luz, cada bloque de 4×4
// tiene cuatro puntos rojos, cuatro verdes, cuatro azules y cuatro negros, sin mezclas amarillas ni grises.
const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
float bayer4(vec2 p) { ivec2 a = ivec2(mod(p, 4.)); return (BAYER[a.y * 4 + a.x] + .5) / 16.; }
vec3 rgbDither(vec3 c, vec2 cell, float amt) {
  vec3 th = vec3(bayer4(cell), bayer4(cell + vec2(1., 0.)), bayer4(cell + vec2(0., 1.)));
  return mix(c, step(th, c), amt);
}
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
uniform vec2 uBrush, uBrushDir, uBrushFrom, uBrushFromDir;  // PINCEL: dónde va y hacia dónde, y dónde iba el cuadro anterior (CPU)
uniform float uBrushR;
uniform vec2 uSplash;                                // SALPICADURA: tamaño y momento de la salpicadura (0…1)
uniform vec4 uDrops[14];                             // SALPICADURA: las gotas (x, y, radio, luz), de la CPU
float gBrushKey;                                     // PINCEL: la orla negra de los costados también se sella
float gBrushMint;                                    // PINCEL: su canto menta va liso (sin trama) y no se turna de color
uniform float uFade, uKeyLevel, uKeySoft;
uniform float uFbAmt, uFbZoom, uFbRot, uFbHue, uFbGain;
uniform vec2 uFbShift;
uniform float uZoom, uRot, uKal, uTile, uWarp, uWarpFreq, uWarpPhase;
uniform vec2 uCell;                                  // SELLO / TRAMA RGB: celda, en píxeles (ancho, alto)
uniform vec2 uSelloShift;                            // SELLO: lo que se corre la copia este cuadro, en celdas enteras
uniform int uSelloRot;                               // SELLO: vueltas de canal de la copia este cuadro (0, 1, 2)
uniform float uDither;                               // TRAMA RGB del sello (dentro del lazo)
uniform float uSelloRim;                             // SELLO: este cuadro el sello lleva canto (una vértebra)
uniform float uSelloFade;                            // SELLO: lo que pierde una copia por cuadro (COLA)

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
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p) { return .55 * vnoise(p) + .3 * vnoise(p * 2.1 + 3.7) + .15 * vnoise(p * 4.3 + 7.1); }
float audioBin(float x) { return texture(uAudio, vec2(x, .25)).r; }
float audioWave(float x) { return texture(uAudio, vec2(x, .75)).r * 2. - 1.; }

vec3 gen(vec2 p, vec2 st) {
  float f = uGenFreq, ph = uGenPhase, sh = uGenShape;
  gBrushKey = 0.; gBrushMint = 0.;
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
  if (uGen == 9) {                                   // PINCEL: un óvalo atravesado a su camino, que recorre una curva
    // Se estampa en cuatro pasos entre donde iba y donde va (el más nuevo encima): en las curvas cerradas
    // sus puntas corren más que su ancho y, de un solo golpe por cuadro, dejarían huecos en la cinta.
    // (más allá de sus dos costados lleva una orla negra: con SELLO, la cinta pasa por encima de las viejas
    //  separada por negro; y en sus dos puntas, un canto menta: barrido por el camino, es el filo en escalera)
    for (int i = 3; i >= 0; i--) {
      float w = float(i) / 3.;
      vec2 at = mix(uBrushFrom, uBrush, w), dir = normalize(mix(uBrushFromDir, uBrushDir, w) + vec2(1e-5, 0.));
      vec2 d = p - at, q = vec2(dot(d, dir), dot(d, vec2(-dir.y, dir.x)));
      vec2 n = abs(q) / vec2(uBrushR * .42, uBrushR);
      float r = pow(pow(n.x, 4.) + pow(n.y, 4.), .25);  // óvalo cuadrado: su costado barre una franja pareja
      if (r <= 1. && r >= sh * .7) {                   // TRAZO: de óvalo lleno a anillo
        if (n.y >= .82) { gBrushMint = 1.; return vec3(.2, .91, .59); }
        return pal(uGenHue + q.y / uBrushR * .2) * (.7 + .3 * (1. - r));
      }
      if (i == 3) gBrushKey = (1. - step(r, 1.)) * step(n.x, 1.) * step(n.y, 1. + .035 / uBrushR);
    }
    return vec3(0.);
  }
  if (uGen == 10) {                                  // SALPICADURA: un charco blanco que salpica sobre negro
    // Un disco visto de canto, de borde rasgado, que crece, se abre en corona con un hueco en medio y
    // suelta gotas (las lleva la CPU); por dentro, ondas suaves de luz (lo que ESPECTRO vuelve curvas de
    // nivel). ESCALA es su tamaño, TRAZO cuánto ondula y VELOCIDAD lo que tarda cada salpicadura.
    float size = uSplash.x, cyc = uSplash.y, lum = 0.;
    vec2 c0 = vec2(0., .08), d = (p - c0) / (vec2(.5, .21) * size * (.85 + .25 * smoothstep(0., .35, cyc)));
    float rr = length(d);
    if (rr < 1.5) {                                  // (el ruido, solo cerca del charco)
      float ang = atan(d.y, d.x);
      float edge = 1. + .3 * (vnoise(vec2(ang * 2.2, ph * .7)) - .5) + .12 * (vnoise(vec2(ang * 7., ph * 1.3)) - .5);
      float body = 1. - smoothstep(edge - .03, edge, rr);
      float hole = smoothstep(.05, .5, cyc) * .45 * (1. - smoothstep(.75, 1., cyc));
      body *= smoothstep(hole - .04, hole + .04, rr * (1. + .2 * (vnoise(vec2(ang * 3., ph)) - .5)));
      if (body > 0.) {
        float ripple = .65 * vnoise(p * vec2(2., 3.5) * (1. + sh) + vec2(ph * .3, -ph * .2)) + .35 * vnoise(p * vec2(4., 7.) * (1. + sh) + vec2(-ph * .25, ph * .3) + 5.3);
        lum = body * clamp(.3 + .5 * ripple + .2 * min(rr / edge, 1.), 0., 1.);
      }
    }
    for (int i = 0; i < 14; i++) {                   // las gotas: posición y radio en uDrops (z: radio, w: luz)
      vec4 g = uDrops[i];
      if (g.z > 0.) lum = max(lum, smoothstep(g.z, g.z * .4, length((p - g.xy) * vec2(1., 1.4))) * g.w);
    }
    return vec3(lum);
  }
  return vec3(0.);
}

// Lo que entra al bucle: geometría, las dos fuentes y la mezcla. key: qué tanto es «lo de delante»
// (la clave en CLAVE DE LUZ y SILUETA; en los demás modos, la luz contra el UMBRAL). Solo lo usa SELLO,
// que pide además la clave dura (hard): un sello no tiene medias tintas en el borde.
vec3 source(vec2 st, bool hard, out float key) {
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
    // (el sello sin recorte de silueta todavía, recorta por luz: estampar el cuadro entero no deja gusano)
    float k = uMixMode == 4 ? luma(a) : (uHasMask > .5 ? texture(uMask, mirrorUv(uv)).r : hard ? luma(a) : 1.);
    k = smoothstep(uKeyLevel - uKeySoft, uKeyLevel + uKeySoft, k);
    k = mix(k, 1. - k, uKeyInv);
    if (hard) k = step(.5, k);
    c = mix(a, mix(b, a, k), uFade);
    key = mix(1., k, uFade);
    return c;
  }
  key = smoothstep(uKeyLevel - uKeySoft, uKeyLevel + uKeySoft, luma(c));
  if (uGen == 9) key = max(key, gBrushKey * uFade);
  return c;
}

// SELLO: todo va por celdas. Cada celda lee la fuente en su centro y la copia anterior en la celda de la
// que viene (girada y escalada desde el centro, redondeada a celda entera, más un salto entero), con
// texelFetch: sin filtro, la copia es exacta aunque la textura del bucle sea LINEAR para ECO, ESTELA y
// CLAVE. Donde la clave dice «delante», se estampa la fuente (tramada por canal), opaca y con borde duro.
vec4 sello(vec2 st) {
  vec2 cell = floor(st * uRes / uCell);
  vec2 cst = (cell + .5) * uCell / uRes;
  float key;
  vec3 c = source(cst, true, key);
  float mint = uGen == 9 && uMixMode < 4 ? gBrushMint * step(.5, uFade) : 0.;
  vec2 asp = vec2(uAspect, 1.);
  vec2 q = rot(uFbRot) * ((cst - .5) * asp) / uFbZoom;
  vec2 from = floor((q / asp + .5) * uRes / uCell) + uSelloShift;
  // (el alfa del bucle marca las celdas de canto: viajan con su copia y no se turnan de color, el canto sigue menta)
  vec4 f = vec4(0., 0., 0., 1.);
  if (all(greaterThanEqual(from, vec2(0.))) && all(lessThan(from * uCell, uRes))) {
    vec2 at = min((from + .5) * uCell, uRes - 1.);
    f = texelFetch(uFb, ivec2(at.x, uRes.y - 1. - at.y), 0);
  }
  f.rgb = max(vec3(0.), f.rgb * min(uFbGain, 1.) - uSelloFade);  // (sin ganancia: una copia nunca crece hacia el blanco)
  // COLOR ECO, a saltos: los canales se turnan (rojo → verde → azul), así un punto puro sigue puro.
  if (f.a > .75) { if (uSelloRot == 1) f.rgb = f.brg; else if (uSelloRot == 2) f.rgb = f.gbr; }
  // Cada ocho celdas de recorrido el sello lleva canto: su celda de borde se pinta menta y la de fuera,
  // negra, ambas opacas. Al correrse las copias queda, de cada tramo, una franja de trama cerrada por el
  // canto menta y una raya negra que la separa de la siguiente: las vértebras del gusano. (El canto pide
  // las cuatro celdas vecinas: cuatro lecturas más de la fuente por píxel, solo en esos cuadros.)
  if (uSelloRim > .5) {
    vec2 dc = uCell / uRes;
    float kr, kl, kd, ku;
    vec3 cr = source(cst + vec2(dc.x, 0.), true, kr), cl = source(cst - vec2(dc.x, 0.), true, kl);
    vec3 cd = source(cst + vec2(0., dc.y), true, kd), cu = source(cst - vec2(0., dc.y), true, ku);
    float around = step(.5, kr) + step(.5, kl) + step(.5, kd) + step(.5, ku);
    // (el canto va en el borde de lo que tiene color, no en el de la orla negra del PINCEL)
    float tinted = step(.5, kr) * step(.02, luma(cr)) + step(.5, kl) * step(.02, luma(cl)) + step(.5, kd) * step(.02, luma(cd)) + step(.5, ku) * step(.02, luma(cu));
    if (key <= .5 && around > .5) return vec4(0., 0., 0., 1.);
    if (key > .5 && luma(c) > .02 && tinted < 3.5) return vec4(.2, .91, .59, .5);
  }
  // (el sello se trama a media tinta: con la luz entera de la cámara los tres canales se encienden juntos
  //  y sale blanco y amarillo; a poco más de media, cada punto queda rojo, verde, azul o negro)
  if (key > .5 && mint > .5) return vec4(.2, .91, .59, .5);
  vec3 stamp = uDither > 0. ? rgbDither(clamp(c * mix(1., .55, uDither), 0., 1.), cell, uDither) : c;
  // (fuera del sello, la copia entera: el lazo es opaco y lo que dura lo dice COLA)
  return key > .5 ? vec4(stamp, 1.) : vec4(mix(c, f.rgb, min(1., uFbAmt / .985)), f.a);
}

void main() {
  vec2 st = vec2(vUv.x, 1. - vUv.y);
  if (uFbMode == 3 && uFbAmt > 0.) { outColor = clamp(sello(st), 0., 1.); return; }
  vec2 asp = vec2(uAspect, 1.);
  float key;
  vec3 c = source(st, false, key);
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
uniform int uPalMode;                                // 1: ESPECTRO (colorizador cíclico) en vez del degradado de tres tintas
uniform float uSpark, uSparkCell, uSmear, uDither;
uniform vec2 uCell;
vec3 tex(vec2 st) { return texture(uSrc, vec2(st.x, 1. - st.y)).rgb; }

// ARRASTRE: las luces altas se corren en hebras horizontales. En vez de ordenar píxeles por fila (en
// la CPU, demasiado para 30 cuadros), cada píxel mira doce tomas hacia un lado y se queda con la luz
// que supera el umbral de brasa, cada vez más débil con la distancia. Por ráfagas: cada par de líneas
// decide cuánto se estira, y cada franja de la imagen hacia qué lado.
vec3 smear(vec3 c, vec2 st) {
  float row = hash(vec2(floor(st.y * uRes.y * .5), floor(uTime * 8.)));
  float burst = smoothstep(1. - uSmear * .75, 1., row);
  float dir = hash(vec2(floor(st.y * 24.), 7.1)) > .5 ? 1. : -1.;
  float span = (.04 + .18 * burst) * uSmear, best = luma(c);
  for (int i = 1; i <= 12; i++) {
    float f = float(i) / 12.;
    vec3 s = tex(vec2(st.x - dir * f * span, st.y));
    float ls = luma(s), w = smoothstep(.52, .82, ls) * (1. - f * .78);
    if (ls * w > best * .92) { c = mix(c, s, w * .85); best = max(best, ls * w); }
  }
  return c;
}

// ESPECTRO: un colorizador de video. Todo lo que pasa la clave se vuelve curvas de nivel gruesas con el
// arcoíris entero, a saturación y luz plenas, sobre negro total (debajo de 0,1):
//  · la luz de lo que pasa la clave se ecualiza con su propio histograma (medido en una rejilla de 64 × 36
//    y suavizado en el tiempo): el ciclo usa todo el círculo de color, a partes iguales;
//  · se le suma su sombra a escala media amplificada (la diferencia entre dos niveles de esa rejilla): una
//    cara o una pared casi planas dan varias bandas;
//  · el matiz va en escalera (12 escalones por vuelta, dos por cada sexto del círculo; POSTERIZ. los cambia)
//    y da de 1,5 a 5 vueltas (SOLARIZ.);
//    MATIZ y CICLO lo corren;
//  · «video gordo»: el color cambia por líneas de barrido (1/56 del alto) y se corre en lóbulos horizontales
//    más anchos que altos (CROMA los ensancha); CROMA también pinta las rayitas de la subportadora.
uniform sampler2D uStats, uStatsOne;
uniform int uNorm;
vec3 rainbow(float h) { return clamp(abs(fract(h + vec3(0., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.); }
vec3 espectro(vec2 st, float l) {
  float lines = 56., y = (floor(st.y * lines) + .5) / lines;
  float lag = (.008 + .02 * uBleed) * uRes.y / uRes.x, lh = 0., ln = 0.;
  vec4 g = texelFetch(uStatsOne, ivec2(0, 0), 0);
  if (uNorm == 1 && g.z > .01) {
    // la luz, de la franja de medida (media local de lo que pasa la clave): tres tomas de lado y una por
    // línea, el lóbulo sale más ancho que alto y sin el grano del sensor
    float mean = g.x / g.z, sd = max(.04, sqrt(max(0., g.y / g.z - mean * mean)));
    float sx = clamp(st.x - lag, .5 / 64., 63.5 / 64.) / 3.;
    vec2 su = vec2(sx, 1. - y), dx = vec2(1.4 / 192., 0.);
    vec4 a = textureLod(uStats, su, 0.) + textureLod(uStats, vec2(max(sx - dx.x, .5 / 192.), su.y), 0.) + textureLod(uStats, vec2(min(sx + dx.x, 63.5 / 192.), su.y), 0.);
    vec4 b = textureLod(uStats, su, 2.);
    lh = a.z > .15 ? a.x / a.z : clamp((luma(tex(vec2(st.x - lag, y))) - .5) * uCon + .5, 0., 1.);
    // (la sombra a escala media, solo tierra adentro: en el borde de la clave las medias mezclan negro)
    float detail = a.z > .3 && b.z > .1 ? (a.x / a.z - b.x / b.z) * 1.6 * smoothstep(.75, 1., min(a.z / 3., b.z)) : 0.;
    // la luz se reparte por igual en el círculo de color: su histograma (8 cajas sobre media ± 2 desviaciones)
    // la ecualiza, así una figura casi pareja también recorre todo el arcoíris
    vec4 h0 = texelFetch(uStatsOne, ivec2(1, 0), 0) / g.z, h1 = texelFetch(uStatsOne, ivec2(2, 0), 0) / g.z;
    float p[8] = float[8](h0.x, h0.y, h0.z, h0.w, h1.x, h1.y, h1.z, h1.w), all = 0., below = 0.;
    float u = clamp((lh + detail - mean + 2. * sd) / (4. * sd), 0., .999), k = floor(u * 8.);
    for (int j = 0; j < 8; j++) { all += p[j]; if (float(j) < k) below += p[j]; else if (float(j) == k) below += p[j] * fract(u * 8.); }
    ln = below / max(all, .01);
  } else {
    float span = .035 * uRes.y / uRes.x;
    for (int i = 0; i < 4; i++) lh += luma(tex(vec2(st.x - span * (float(i) / 3. - .3), y)));
    ln = clamp((lh * .25 - .5) * uCon + .5, 0., 1.);
  }
  float steps = uPost >= 2. ? uPost : 12.;
  vec3 m = rainbow(floor((ln * (1.5 + uSolar * 3.5) + uHue) * steps) / steps) * smoothstep(.1, .16, l);
  float e = fract(st.y * lines);
  m *= .85 + .15 * smoothstep(0., .2, e) * smoothstep(1., .8, e);
  if (uBleed > 0.) m *= 1. - uBleed * .12 * (.5 + .5 * sin(gl_FragCoord.x * .9 * 540. / uRes.y + floor(st.y * 270.) * 1.5708));
  return m;
}

// CHISPA: destellos que titilan sobre las crestas de luz de cualquier señal. Dos poblaciones: granos
// finos (uno por celda, en un punto al azar de la celda, que se encienden donde hay luz y más donde la
// luz sobresale de su entorno) y estrellas en cruz, raras, en celdas cuatro veces mayores, solo sobre
// luces altas: la cruz de una estrella llega a las celdas vecinas de su fila y su columna. Cada uno
// late con su propio ritmo, (max(0, sen))^8: encendido poco tiempo, con un pico breve (no es nieve de TV).
vec3 sparkTint(float h, vec3 src) {
  return h < .4 ? vec3(.85, 1., 1.) : h < .62 ? vec3(.44, 1., .88) : h < .8 ? vec3(1., .75, .86) : clamp(src / max(.05, max(src.r, max(src.g, src.b))), 0., 1.);
}
vec3 sparks(vec2 st) {
  vec2 px = st * uRes;
  float S = uSparkCell, k = uRes.y / 540.;
  vec3 add = vec3(0.);
  // (primero el latido y el azar, que no cuestan lecturas: la luz solo se mira en los granos encendidos)
  vec2 cell = floor(px / S);
  float on = step(hash(cell + 5.31), .2 + .6 * uSpark);
  float pulse = on * pow(max(0., sin(mix(5., 13., hash(cell + 2.7)) * uTime + TAU * hash(cell + 9.1))), 8.);
  if (pulse > .02) {
    vec2 cp = (cell + .5 + (vec2(hash(cell + 17.3), hash(cell + 41.9)) - .5) * .6) * S, cs = cp / uRes, d = vec2(S * 1.5) / uRes;
    vec3 at = tex(cs);
    float l0 = luma(at);
    float around = .25 * (luma(tex(cs + vec2(d.x, 0.))) + luma(tex(cs - vec2(d.x, 0.))) + luma(tex(cs + vec2(0., d.y))) + luma(tex(cs - vec2(0., d.y))));
    float crest = clamp((l0 - around) * 6., 0., 1.);
    float r = length(px - cp) / (.7 * k + .08 * S);
    add = sparkTint(hash(cell + 77.7), at) * exp(-r * r) * pulse * smoothstep(.42, .85, l0) * (.2 + .8 * crest) * (.7 + .8 * uSpark);
  }
  float B = S * 4.;
  vec2 big = floor(px / B);
  for (int i = 0; i < 5; i++) {
    vec2 o = i == 0 ? vec2(0.) : i == 1 ? vec2(1., 0.) : i == 2 ? vec2(-1., 0.) : i == 3 ? vec2(0., 1.) : vec2(0., -1.);
    vec2 bc = big + o;
    float p = pow(max(0., sin(mix(3.5, 7.5, hash(bc + 1.1)) * uTime + TAU * hash(bc + 6.6))), 8.);
    float fire = smoothstep(.86 - .14 * uSpark, 1., p) * step(hash(bc + 4.4), .3 + .55 * uSpark);
    if (fire <= 0.) continue;
    vec2 sp = (bc + .5 + (vec2(hash(bc + 3.3), hash(bc + 8.8)) - .5) * .6) * B;
    vec3 sc = tex(sp / uRes);
    fire *= step(.58, luma(sc));
    vec2 dd = (px - sp) / k;
    float arm = mix(6., 15., p), armH = exp(-abs(dd.x) / arm) * exp(-abs(dd.y) / .85), armV = exp(-abs(dd.y) / arm) * exp(-abs(dd.x) / .85);
    add += (sparkTint(hash(bc + 5.5), sc) * (armH + armV) * .85 + exp(-dot(dd, dd) / 3.2)) * fire;
  }
  return add;
}

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
  vec2 sti = st;                                     // (los destellos caen en su punto, no en el centro del bloque de PÍXEL)
  vec2 cells = vec2(uPix * uRes.x / uRes.y, uPix);
  if (uPix > 0.) st = (floor(st * cells) + .5) / cells;
  vec3 c = uRgb > 0. ? vec3(tex(st + vec2(uRgb, 0.)).r, tex(st).g, tex(st - vec2(uRgb, 0.)).b) : tex(st);
  if (uBleed > 0.) {
    vec3 s = (tex(st - vec2(.006, 0.)) + tex(st - vec2(.013, 0.)) + tex(st - vec2(.021, 0.))) / 3.;
    c = mix(c, vec3(luma(c)) + (s - luma(s)) * 1.2, uBleed);
  }
  if (uSmear > 0.) c = smear(c, st);
  bool spectral = uPalMode == 1 && uTint > 0.;      // (con ESPECTRO, SOLARIZ. da las vueltas en vez de doblar la luz)
  if (uHue != 0.) c = hueTurn(c, uHue);
  c = mix(vec3(luma(c)), c, uSat);
  c = (c - .5) * uCon + .5;
  if (uSolar > 0. && !spectral) c = mix(c, 1. - abs(2. * c - 1.), uSolar);
  if (uPost >= 2.) c = floor(clamp(c, 0., 1.) * (uPost - 1.) + .5) / (uPost - 1.);
  if (uTint > 0.) {
    float l = clamp(luma(c), 0., 1.);
    vec3 m = spectral ? espectro(st, l) : l < .5 ? mix(uTintA, uTintB, l * 2.) : mix(uTintB, uTintC, l * 2. - 1.);
    c = mix(c, m, uTint);
  }
  c = mix(c, 1. - c, uInv);
  if (uSpark > 0.) c += sparks(sti);
  if (uDither > 0.) c = rgbDither(clamp(c, 0., 1.), uPix > 0. ? floor(st * cells) : floor(vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uCell), uDither);
  if (uScan > 0.) c *= (1. - uScan * .5 * (.5 + .5 * cos(st.y * 240. * TAU))) * (1. + uScan * .18);
  if (uNoise > 0.) c = mix(c, vec3(hash(st * uRes + fract(uTime) * 311.7)), uNoise * .7);
  outColor = vec4(clamp(c * uGate * seam * uLevel, 0., 1.), 1.);
}`;

  // ESPECTRO · medida de la luz, en una textura de 192 × 36 con tres franjas de 64 × 36: la luz de lo que
  // pasa la clave, su cuadrado y la clave; y su histograma en 8 cajas (4 + 4), contado sobre el rango del
  // cuadro anterior. Sus mipmaps dan medias locales (franja 1) y, en el nivel 6 (3 × 1), el total de cada
  // franja; un pase de 3 × 1 lo suaviza en el tiempo. Solo corre con la paleta ESPECTRO puesta.
  const STATS = COMMON + `
uniform sampler2D uSrc, uPrev;
uniform int uStep;
uniform float uCon, uKeep;
void main() {
  if (uStep == 1) {
    float i = floor(gl_FragCoord.x);
    outColor = mix(textureLod(uSrc, vec2((i + .5) / 3., .5), 6.), texelFetch(uPrev, ivec2(i, 0), 0), uKeep);
    return;
  }
  float band = floor(gl_FragCoord.x / 64.);
  vec2 uv = vec2(fract(gl_FragCoord.x / 64.), vUv.y);
  vec4 g = texelFetch(uPrev, ivec2(0, 0), 0);
  float mean = g.x / max(g.z, .002), sd = max(.04, sqrt(max(0., g.y / max(g.z, .002) - mean * mean)));
  bool fresh = g.z < .002;
  vec4 acc = vec4(0.);
  for (int i = 0; i < 16; i++) {
    vec2 at = uv + (vec2(float(i - (i / 4) * 4), float(i / 4)) - 1.5) * vec2(.25 / 64., .25 / 36.);
    float l = clamp((luma(texture(uSrc, at).rgb) - .5) * uCon + .5, 0., 1.), m = step(.1, l);
    if (band < .5) acc += vec4(l * m, l * l * m, m, 1.);
    else {
      float u = fresh ? l : clamp((l - mean + 2. * sd) / (4. * sd), 0., .999), b = floor(u * 8.) - (band - 1.) * 4.;
      acc += m * vec4(equal(vec4(b), vec4(0., 1., 2., 3.)));
    }
  }
  outColor = acc / 16.;
}`;

  // ── Motor ───────────────────────────────────────────────────────────────────
  const eng = { canvas: null, gl: null, ok: false, error: '', w: 0, h: 0, fb: [], flip: 0, alloc: {}, camKind: 0, camSeq: -1, hasA: false, hasMask: false, maskSeq: -1, maskBytes: null, fit: [1, 1, 0, 0], mirror: 0, yuvKey: '', path: '' };
  const state = { active: false, raf: 0, clean: false, failed: 0 };
  const clock = { last: 0, t: 0, n: 0, fps: 60, slow: 0, fast: 0, autoH: COARSE ? 540 : 720, dtAvg: 16.7, beat: 0, painted: 0 };
  const ph = { gen: 0, spin: 0, cycle: 0, roll: 0, warp: 0, lfo: [0, 0], rnd: [{ cycle: -1, from: 0, to: 0 }, { cycle: -1, from: 0, to: 0 }] };
  // SELLO: la copia salta celdas enteras. Lo que la DERIVA pide por cuadro (fracciones de celda) se acumula y
  // sale en saltos enteros; el COLOR ECO, igual, en tercios de vuelta (un turno de canales cada tercio).
  const lazo = { x: 0, y: 0, hue: 0, rim: 8, on: false };
  const brush = { at: null, dir: [1, 0], from: [0, 0], fromDir: [1, 0] };
  const drops = new Float32Array(56);                                     // SALPICADURA: las catorce gotas                               // PINCEL: dónde iba el cuadro anterior y hacia dónde
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
    return { pr, f: (n, x) => gl.uniform1f(at(n), x), i: (n, x) => gl.uniform1i(at(n), x), v2: (n, x, y) => gl.uniform2f(at(n), x, y), v4v: (n, a) => gl.uniform4fv(at(n), a),
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
  // ESPECTRO: la textura de medida (192 × 36 con sus mipmaps) y dos de 3 × 1 que se turnan para suavizar
  // los totales. Se crean la primera vez que hacen falta; si no se pueden, ESPECTRO sigue sin estirar la luz.
  function statsReady() {
    if (eng.stats) return eng.stats.ok;
    const gl = eng.gl, s = eng.stats = { ok: false, fresh: true, flip: 0 };
    try {
      s.prog = program(STATS);
      s.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.texStorage2D(gl.TEXTURE_2D, 8, gl.RGBA8, 192, 36);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const target = t => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE ? f : null; };
      s.fb = target(s.tex);
      s.one = [0, 1].map(() => { const t = texture(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 3, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return { t, f: target(t) }; });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      s.ok = !!(s.fb && s.one[0].f && s.one[1].f);
    } catch (_) { s.ok = false; gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    return s.ok;
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
  let camMissSince = 0;
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
    const gl = eng.gl, w = base.width, h = base.height, family = lookFamily(key);
    // (la variante entra en la firma: otra variante de la misma familia se pinta en el acto)
    const variant = family === 'ASCII' ? '' : lookVariant(key);
    // (la cadencia puede depender de la variante: los escenarios de VIRTUAL van a 30 y sus consolas a 24)
    const cadence = family === 'ASCII' ? 20 : typeof _camCadence === 'function' ? _camCadence(family, variant) : (typeof cameraCadence === 'object' && cameraCadence[family]) || 24;
    const signature = family + ':' + variant + ':' + w + 'x' + h;
    if (signature !== look.key || now - look.at >= 1000 / cadence - 4) {
      look.key = signature; look.at = now;
      try {
        if (family === 'ASCII') FLIP_STEP_ENGINES.ascii.renderStep(base, look.ctx, { cols: 96 }, null, now);
        else {
          // Del sello de PRINT entra la trama, no el marco.
          const frame = typeof stampFrameMode === 'string' ? stampFrameMode : null;
          const sello = typeof _esSello === 'function' && _esSello(family, variant);
          if (frame !== null && sello) stampFrameMode = 'OFF';
          try {
            // (las cámaras que oyen —GUSANO, ESPECTRO…— oyen lo que oye STAGE: micrófono, entrada o Live)
            const heard = audio.on || !!audio.inject || linkMaster() ? { bass: mods.bass, mid: mods.mid, treble: mods.high, beat: mods.beat } : undefined;
            _renderCamEngineFrame(base, w, h, look.ctx, false, { path: 'capture', now, outW: w, outH: h, resolution: 'medium', family, variant, audio: heard });
          } finally { if (frame !== null && sello) stampFrameMode = frame; }
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
    eng.camKind = 0; eng.fit = [1, 1, 0, 0]; eng.path = 'emulador ' + family + (variant ? ':' + variant : '');
    eng.hasA = true;
    return true;
  }
  function feedSources(now) {
    eng.hasA = false;
    if (!camReady()) return;
    hookVideo();
    eng.mirror = typeof facingMode === 'string' && facingMode === 'user' ? 1 : 0;
    // (una familia que todavía no está registrada se pinta como cámara directa, sin borrarla de la escena)
    const key = lookKnown(live.d['src.look']) ? live.d['src.look'] : 'RAW', keyed = live.d['mix.mode'] === 5;
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
  // La entrada (micrófono, otra entrada de audio o el sonido del propio ordenador) pasa por un
  // analizador propio. Cada banda se mide en decibelios y se normaliza entre su suelo y su techo
  // recientes: reacciona igual con la música baja que alta, y con mezclas muy comprimidas.
  // Los golpes salen del flujo espectral de los graves; el tempo, de la autocorrelación de ese
  // flujo; y el reloj de compases se engancha a los golpes para que los LFO «a tempo» caigan en el pulso.
  const audio = { on: false, busy: false, kind: 'mic', deviceId: '', devices: [], ctx: null, node: null, analyser: null, stream: null,
    db: null, time: null, wave: null, tex: new Uint8Array(512), env: { bass: 0, mid: 0, high: 0 }, band: {}, beat: 0, level: 0, loud: -100, quietFor: 0,
    prev: null, flux: [], onsets: [], lastBeat: -1e9, lastFlux: 0, bpm: 0, tempoAt: 0, beats: 0, inject: null, rate: 48000 };
  const BANDS = { bass: [35, 160], mid: [300, 2200], high: [4500, 12000] };
  const GATE_DB = -66;                                                     // por debajo, es el ruido del micrófono
  function audioReset() {
    audio.env.bass = audio.env.mid = audio.env.high = 0;
    Object.assign(audio, { band: {}, beat: 0, level: 0, loud: -100, quietFor: 0, prev: null, flux: [], onsets: [], lastBeat: -1e9, lastFlux: 0, bpm: 0, beats: 0 });
  }
  // Conecta una fuente al analizador (la entrada elegida, o una fuente de prueba).
  function audioWire(make) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!audio.ctx || audio.ctx.state === 'closed') audio.ctx = new AC();
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    const analyser = audio.ctx.createAnalyser();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0; analyser.minDecibels = -100; analyser.maxDecibels = -10;
    audio.node = make(audio.ctx);
    audio.node.connect(analyser);
    Object.assign(audio, { analyser, db: new Float32Array(analyser.frequencyBinCount), time: new Float32Array(analyser.fftSize), wave: new Uint8Array(1024), rate: audio.ctx.sampleRate, on: true });
    audioReset();
  }
  const systemAudio = () => !COARSE && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  function audioOptions() {
    const list = [{ kind: 'mic', id: '', label: 'MICRÓFONO' }];
    audio.devices.forEach((device, index) => list.push({ kind: 'mic', id: device.id, label: (device.label || 'ENTRADA ' + (index + 2)).toUpperCase().replace(/\s*\(.*?\)\s*/g, ' ').trim().slice(0, 18) }));
    if (systemAudio()) list.push({ kind: 'system', id: '', label: 'ESTA COMPUTADORA' });
    return list;
  }
  async function listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      audio.devices = all.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label).map(d => ({ id: d.deviceId, label: d.label })).slice(0, 6);
      if (ui.panel) syncPicks();
    } catch (_) {}
  }
  async function audioOn(kind = audio.kind, deviceId = audio.deviceId) {
    if (audio.busy) return false;
    audio.busy = true; syncKeys();
    try {
      let stream;
      if (kind === 'system') {
        // El sonido que suena en este ordenador: el navegador pregunta qué pestaña o pantalla compartir.
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false }, systemAudio: 'include' });
        stream.getVideoTracks().forEach(track => track.stop());
        if (!stream.getAudioTracks().length) { flipToast('No llegó sonido: al elegir la pestaña o la pantalla, activa «Compartir audio».', 6000); return false; }
      } else {
        const plain = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? Object.assign({ deviceId: { exact: deviceId } }, plain) : plain }); }
        catch (error) { if (error && error.name === 'NotAllowedError') throw error; stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      }
      audioOff(true);
      audioWire(ctx => ctx.createMediaStreamSource(stream));
      Object.assign(audio, { stream, kind, deviceId: deviceId || '' });
      stream.getAudioTracks()[0].addEventListener('ended', () => { if (audio.stream === stream) audioOff(); });
      feel.hush('stage-system', kind === 'system');                          // sus propios clics entrarían en el análisis
      listDevices();
      readout(kind === 'system' ? 'SONIDO DE LA COMPUTADORA' : 'MIC ENCENDIDO');
      return true;
    } catch (error) {
      flipToast(error && error.name === 'NotAllowedError' ? 'Sin permiso de audio no hay reacción al sonido.' : 'No se pudo abrir esa entrada de sonido.');
      return false;
    } finally { audio.busy = false; syncKeys(); if (ui.panel) syncPicks(); }
  }
  function audioOff(quiet) {
    const was = audio.on;
    audio.on = false;
    try { if (audio.node) audio.node.disconnect(); } catch (_) {}
    try { if (audio.stream) audio.stream.getTracks().forEach(track => track.stop()); } catch (_) {}
    audio.node = null; audio.analyser = null; audio.stream = null;
    audioReset();
    feel.hush('stage-system', false);
    if (was && !quiet) syncKeys();
  }
  const binOf = hz => clamp(Math.round(hz / (audio.rate / 2 / audio.db.length)), 1, audio.db.length - 1);
  function bandDb(lo, hi) {
    const a = binOf(lo), b = binOf(hi);
    let sum = 0;
    for (let i = a; i <= b; i++) sum += Math.exp(audio.db[i] * .1151293);       // dB → amplitud
    return 8.685889 * Math.log(sum / (b - a + 1) + 1e-9);                       // media → dB
  }
  function follow(key, db, dt, gain, fall, open) {
    const band = audio.band[key] || (audio.band[key] = { hi: db, lo: db - 12 });
    if (open) {
      // El techo baja despacio… salvo que la música lleve un rato sin acercarse a él (bajaron el volumen): entonces, deprisa.
      band.far = db > band.hi - 4 ? 0 : (band.far || 0) + dt;
      band.hi = db > band.hi ? db : band.hi - (band.far > 1.2 ? 9 : 2.5) * dt;
      band.lo = db < band.lo ? band.lo + (db - band.lo) * Math.min(1, dt * 8) : band.lo + 1.2 * dt;   // el suelo sube despacio
    }
    const range = clamp(band.hi - band.lo, 9, 40);
    const x = open ? clamp(Math.pow(clamp((db - (band.hi - range)) / range), 1.7) * gain) : 0;
    const e = audio.env;
    e[key] = x > e[key] ? x : e[key] + (x - e[key]) * (1 - Math.exp(-dt / fall));
  }
  // Tempo: autocorrelación del flujo de graves de los últimos seis segundos, en pasos de 10 ms.
  // La serie se suaviza (un golpe ocupa varios pasos) para que un periodo que no cae en un número
  // entero de pasos correlacione igual, y entre un tempo y su mitad se prefiere el más rápido.
  function tempo(now) {
    const span = 6000, step = 10, n = span / step, raw = new Float32Array(n), series = new Float32Array(n);
    for (const [at, value] of audio.onsets) { const k = Math.floor((at - (now - span)) / step); if (k >= 0 && k < n && value > raw[k]) raw[k] = value; }
    let mean = 0;
    for (let i = 0; i < n; i++) mean += raw[i] / n;
    for (let i = 0; i < n; i++) raw[i] = Math.max(0, raw[i] - mean * 1.5);
    let zero = 0;
    for (let i = 2; i < n - 2; i++) { series[i] = (raw[i - 2] + 2 * raw[i - 1] + 3 * raw[i] + 2 * raw[i + 1] + raw[i + 2]) / 9; zero += series[i] * series[i]; }
    if (zero < 1e-6) return 0;
    const score = lag => { let r = 0; for (let i = lag; i < n; i++) r += series[i] * series[i - lag]; return r / zero; };
    let best = 0, bestLag = 0;
    for (let lag = 33; lag <= 100; lag++) {                                     // de 182 a 60 pulsos por minuto
      const r = score(lag) * Math.exp(-.5 * Math.pow(Math.log2(6000 / lag / 120) / .9, 2));
      if (r > best) { best = r; bestLag = lag; }
    }
    if (best < .12) return 0;
    const half = Math.round(bestLag / 2);
    if (half >= 33 && Math.max(score(half - 1), score(half), score(half + 1)) > score(bestLag) * .55) bestLag = [half - 1, half, half + 1].sort((x, y) => score(y) - score(x))[0];
    const a = score(bestLag - 1), b = score(bestLag), c = score(bestLag + 1), fine = (a - c) / (2 * (a - 2 * b + c) || 1);
    return 6000 / (bestLag + clamp(fine, -.5, .5));
  }
  // ── Sincronía por sonido ────────────────────────────────────────────────────
  // Dos teléfonos que oyen la misma música ya caen juntos en cada golpe (lo oyen a la vez). Para
  // que además coincidan en QUÉ pulso es (y los LFO a tempo y los cambios por compás vayan a la
  // par) sin hablarse entre ellos, cada uno numera los pulsos con lo único que comparten: la hora.
  // A un tempo redondeado, «pulsos desde la época» da un número enorme y común; la música fija
  // dónde cae el pulso dentro de ese número (la fase, media circular de los golpes) y el número
  // entero sale igual en todos. Basta coincidir módulo 64 pulsos (16 compases).
  const coro = { bpm: 0, cos: 0, sin: 0, n: 0, locked: false, phase: 0 };
  function coroBeat() {
    const bpm = Math.round(audio.bpm);
    if (!bpm || bpmSource() !== 'AUTO') { coro.locked = false; coro.n = 0; coro.bpm = 0; return; }
    if (bpm !== coro.bpm) Object.assign(coro, { bpm, n: 0, locked: false });
    const w = Date.now() / 60000 * bpm, ang = (w - Math.floor(w)) * TAU;
    const k = coro.n ? .12 : 1;
    coro.cos += (Math.cos(ang) - coro.cos) * k; coro.sin += (Math.sin(ang) - coro.sin) * k;
    if (++coro.n < 6) return;
    coro.phase = (Math.atan2(coro.sin, coro.cos) / TAU + 1) % 1;
    const near = w - coro.phase, n = Math.round(near);
    if (Math.abs(near - n) > .2) return;                                  // un golpe a contratiempo no numera
    const have = Math.round(clock.beat), d = ((((n - have) % 64) + 96) % 64) - 32;
    if (d) clock.beat += d;
    coro.locked = true;
  }
  function onBeat(now) {
    audio.lastBeat = now; audio.beat = 1; audio.beats++;
    coroBeat();
    if (!linkTempo()) clock.beat += (Math.round(clock.beat) - clock.beat) * .35;   // el reloj de compases se engancha al golpe (con LIVE, lo lleva Ableton)
  }
  function readAudio(dt, now) {
    const tex = audio.tex;
    audio.beat *= Math.exp(-dt / .16);
    if (audio.inject) {
      const j = audio.inject;
      audio.env.bass = j.bass || 0; audio.env.mid = j.mid || 0; audio.env.high = j.high || 0;
      if (j.beat) { audio.beat = j.beat; j.beat = 0; }
    } else if (linkMaster()) {
      // LIVE: el master de Ableton tal como sale, sin micrófono ni sala. Mismo seguidor que con el micrófono
      // (GANANCIA y CAÍDA mandan igual); los golpes los cuenta PITÁGORAS y llegan en linkTake().
      const m = link.frame.m;
      const gain = Math.pow(2, (val['aud.gain'] === undefined ? .5 : val['aud.gain']) * 4 - 2), fall = .04 + Math.pow(val['aud.fall'] === undefined ? .4 : val['aud.fall'], 2) * .9;
      follow('bass', m[1] * 54 - 54, dt, gain, fall, m[0] > .02); follow('mid', m[2] * 54 - 54, dt, gain, fall, m[0] > .02); follow('high', m[3] * 54 - 54, dt, gain, fall, m[0] > .02);
      audio.level = m[0] > audio.level ? m[0] : audio.level + (m[0] - audio.level) * (1 - Math.exp(-dt / .25));
    } else if (audio.on && audio.analyser) {
      if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
      audio.analyser.getFloatFrequencyData(audio.db);
      audio.analyser.getFloatTimeDomainData(audio.time);
      audio.analyser.getByteTimeDomainData(audio.wave);
      let sum = 0;
      for (let i = 0; i < audio.time.length; i += 4) sum += audio.time[i] * audio.time[i];
      const loud = 10 * Math.log10(sum / (audio.time.length / 4) + 1e-12), open = loud > GATE_DB;
      audio.loud = loud;
      const level = clamp((loud + 62) / 50);
      audio.level = level > audio.level ? level : audio.level + (level - audio.level) * (1 - Math.exp(-dt / .25));
      audio.quietFor = open ? 0 : audio.quietFor + dt;
      const gain = Math.pow(2, (val['aud.gain'] === undefined ? .5 : val['aud.gain']) * 4 - 2), fall = .04 + Math.pow(val['aud.fall'] === undefined ? .4 : val['aud.fall'], 2) * .9;
      for (const key of Object.keys(BANDS)) follow(key, bandDb(BANDS[key][0], BANDS[key][1]), dt, gain, fall, open);
      // Golpes: cuánto suben los graves (40–140 Hz, donde vive el bombo) de un cuadro al siguiente, frente a lo habitual del último segundo y medio.
      const a = binOf(40), b = binOf(140);
      let flux = 0;
      if (audio.prev) for (let i = a; i <= b; i++) { const d = audio.db[i] - audio.prev[i - a]; if (d > 0) flux += d; }
      flux /= (b - a + 1);
      if (!audio.prev || audio.prev.length !== b - a + 1) audio.prev = new Float32Array(b - a + 1);
      for (let i = a; i <= b; i++) audio.prev[i - a] = audio.db[i];
      if (!open) flux = 0;
      const hist = audio.flux;
      let mean = 0, dev = 0;
      for (const f of hist) mean += f / (hist.length || 1);
      for (const f of hist) dev += (f - mean) * (f - mean) / (hist.length || 1);
      hist.push(flux);
      if (hist.length > 90) hist.shift();
      audio.onsets.push([now, flux]);
      while (audio.onsets.length && now - audio.onsets[0][0] > 6200) audio.onsets.shift();
      // Se dispara en la cima del flujo: cuando el cuadro anterior superó el umbral y este ya baja.
      const last = audio.lastFlux;
      if (hist.length > 20 && last > mean + Math.sqrt(dev) * 2 + 1 && flux < last && now - audio.lastBeat > 220) onBeat(now);
      audio.lastFlux = flux;
      if (now - audio.tempoAt > 600) {
        audio.tempoAt = now;
        let bpm = audio.beats >= 4 && now - audio.lastBeat < 2500 ? tempo(now) : 0;   // sin golpes recientes no hay tempo que sacar
        if (bpm && audio.bpm) { while (bpm < audio.bpm * .7) bpm *= 2; while (bpm > audio.bpm * 1.45) bpm /= 2; }   // sin saltos de octava
        audio.bpm = bpm ? (audio.bpm ? lerp(audio.bpm, bpm, .35) : bpm) : (now - audio.lastBeat > 2500 ? 0 : audio.bpm);
      }
      for (let i = 0; i < 256; i++) { tex[i] = clamp((audio.db[i] + 100) / 90) * 255; tex[256 + i] = audio.wave[i * 4]; }
    }
    if (!audio.on || !audio.analyser) {
      // Sin entrada, el osciloscopio no se queda muerto: una onda de reposo que respira con los LFO.
      const a = .3 + .2 * mods.lfo1, f = 2 + mods.lfo2;
      for (let i = 0; i < 256; i++) {
        const x = i / 255;
        tex[i] = audio.inject || linkMaster() ? 255 * clamp(lerp(audio.env.bass, audio.env.high, x)) : Math.max(0, 150 - i * 1.1) * (.6 + .4 * Math.sin(clock.t * 2 + i * .13));
        tex[256 + i] = 128 + 110 * a * Math.sin(TAU * (x * f + clock.t * .7)) * Math.sin(Math.PI * x) + 14 * Math.sin(TAU * (x * 9 - clock.t * 1.9));
      }
    }
    mods.bass = audio.env.bass; mods.mid = audio.env.mid; mods.high = audio.env.high;
    mods.beat = clamp(Math.max(audio.beat, midi.hit));
  }

  // ── Manos ───────────────────────────────────────────────────────────────────
  const hands = { on: false, goal: { hx: .5, hy: .5, pinch: 0 }, seen: false, phase: 'idle' };
  function handsOn(on) {
    if (on === hands.on) return;
    hands.on = on;
    if (on) { if (window.flipPortal) window.flipPortal.start(); readout('MANOS: CARGANDO', 2500); }
    else if (window.flipPortal && window.flipPortal.release) window.flipPortal.release();
    syncKeys();
  }
  function trackHands(base) {
    if (!window.flipPortal || !window.flipPortal.track) return;
    const res = window.flipPortal.track(base);
    if (res.phase !== hands.phase) { hands.phase = res.phase; if (res.phase === 'ready') readout('MANOS LISTAS'); else if (res.phase === 'failed') { flipToast(res.message || 'El seguimiento de manos no cargó.'); handsOn(false); } }
    hands.seen = res.fresh && res.hands.length > 0;
    if (!hands.seen) return;
    const h = res.hands[0], span = Math.hypot(h[0] - h[18], h[1] - h[19]) || .1;           // muñeca → nudillo medio
    hands.goal.hx = clamp(h[16]); hands.goal.hy = clamp(1 - h[17]);
    hands.goal.pinch = clamp((Math.hypot(h[16] - h[8], h[17] - h[9]) / span - .15) / 1.1);    // índice ↔ pulgar
  }

  // ── MIDI ────────────────────────────────────────────────────────────────────
  // Sin configurar nada: las notas 36–45 y 60–69 llaman a las escenas y cualquier otra da un golpe;
  // los mandos del controlador gobiernan los de la página visible (por orden de número de CC); la
  // rueda de modulación y la de tono son el PAD; el volumen (CC 7), el nivel de salida; un cambio de
  // programa, la escena; y el reloj MIDI, el tempo. APRENDER fija un mando concreto a un control.
  const midi = { access: null, state: 'off', names: [], learn: false, target: '', held: new Set(), gate: 0, hit: 0, seen: -1e9, slew: {}, ticks: [], bpm: 0, tickAt: -1e9, tickBeat: 0, knobs: [], last: '' };
  const CC_SKIP = new Set([0, 6, 32, 38, 64, 65, 66, 67, 96, 97, 98, 99, 100, 101]);        // banco, datos, pedales
  // Los ocho mandos de los controladores más comunes mandan CC seguidos desde uno de estos números:
  // así el primer mando del aparato es la primera perilla de la página desde el primer giro.
  const CC_BANKS = [70, 21, 16, 102, 41];
  function knobSlot(cc) {
    for (const base of CC_BANKS) if (cc >= base && cc < base + 8) return cc - base;
    if (!midi.knobs.includes(cc)) { midi.knobs.push(cc); midi.knobs.sort((a, b) => a - b); }      // los demás, por orden de número
    return midi.knobs.indexOf(cc);
  }
  async function midiConnect() {
    if (!navigator.requestMIDIAccess) { midi.state = 'none'; flipToast('Este navegador no tiene MIDI. En Android y en computadora, usa Chrome.'); syncKeys(); return false; }
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
      midi.tickBeat += 1 / 24;
      clock.beat += (midi.tickBeat - clock.beat) * .5;                    // el reloj de compases sigue al del controlador
      return;
    }
    if (status === 0xfa) { midi.ticks.length = 0; midi.tickBeat = 0; clock.beat = 0; ph.lfo[0] = ph.lfo[1] = 0; return; }
    if (status >= 0xf0) return;
    midi.seen = now;
    if (type === 0xc0) { recall(data[1] % SCENE_COUNT); return; }       // cambio de programa → escena
    if (type === 0xe0) { pad.x = ((data[2] << 7) | data[1]) / 16383; midi.last = 'TONO'; return; }   // rueda de tono → PAD X
    if (type === 0xb0) {
      const x = data[2] / 127;
      if (midi.learn && midi.target) { learnBind('cc', key); return; }
      const dst = store.midi.cc[key];
      if (dst) {
        if (dst[0] === 'p') { midi.slew[dst.slice(2)] = x; if (morph) delete morph.to[dst.slice(2)]; }
        else if (data[2] >= 64) trigger(dst);
        return;
      }
      // Sin asignar.
      const cc = data[1];
      if (cc === 1) { pad.y = x; midi.last = 'MOD'; return; }
      if (cc === 7) { midi.slew['out.level'] = x; return; }
      if (CC_SKIP.has(cc) || cc >= 120) return;
      const page = PAGES.find(entry => entry.id === ui.page) || PAGES[0];
      // (en FÁCIL la página no tiene mandos propios: van los cuatro de la escena; sin mandos, nada que mover)
      const controls = ui.page === 'easy' ? easyKnobs() : page.fader ? [page.fader].concat(page.knobs) : page.knobs;
      if (!controls.length) return;
      const id = controls[knobSlot(cc) % controls.length];
      midi.slew[id] = x;
      if (morph) delete morph.to[id];
      midi.last = 'CC ' + cc;
      readout('CC ' + cc + ' > ' + P[id][0] + ' ' + describe(id, x), 900);
    } else if (type === 0x90 && data[2] > 0) {
      midi.held.add(key); midi.gate = data[2] / 127;
      if (midi.learn && midi.target) { learnBind('note', key); return; }
      const note = data[1], free = Object.keys(store.midi.note).length === 0;
      const dst = store.midi.note[key] || (free && note >= 36 && note < 36 + SCENE_COUNT ? 's:' + (note - 36) : free && note >= 60 && note < 60 + SCENE_COUNT ? 's:' + (note - 60) : '');
      midi.last = 'NOTA ' + note;
      if (dst && dst[0] !== 'p') trigger(dst);
      else { midi.hit = Math.max(midi.hit, data[2] / 127); readout('NOTA ' + note + ' > GOLPE', 600); }       // cualquier otra nota es un golpe
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

  // ── LIVE: lo que toca Ableton, por la señal de PITÁGORAS ────────────────────
  // PITÁGORAS (el asistente de Ableton) ya oye dentro de Live: un oído en el master y un sensor por
  // pista. Su señal para visuales (un flujo de eventos, solo de lectura, con su propia llave) trae
  // 30 veces por segundo el nivel de cada pista, el master en tres bandas, cada golpe y el pulso
  // exacto del transporte. Aquí eso se vuelve: seis tomas (una por pista, con su nombre), BAJO /
  // MEDIO / AGUDO / GOLPE tomados del master de Live en vez del micrófono, y el tempo y el compás
  // de Live como reloj. Formato de cada cuadro: { t, play, pos, bpm, m:[nivel,bajo,medio,agudo],
  // hits, hit, ears, tr:{ 'track:3': [nivel,bajo,medio,agudo] } }, todo de 0 a 1.
  const link = { es: null, state: 'off', at: -1e9, frame: null, tracks: [], keys: LIVE_KEYS.map(() => ''), goal: LIVE_KEYS.map(() => 0), hi: LIVE_KEYS.map(() => .25), lo: LIVE_KEYS.map(() => .06), far: LIVE_KEYS.map(() => 0), prevAt: 0, auto: null, hits: -1, lag: Infinity, demo: false, host: '', paintAt: 0 };
  const linkFresh = () => performance.now() - link.at < 1200;
  const linkMaster = () => linkFresh() && !!link.frame && !!link.frame.ears && Array.isArray(link.frame.m);
  const linkTempo = () => (linkFresh() && link.frame && link.frame.bpm) || 0;
  // Solo el enlace de la señal (el de VISUALES): el de la app de PITÁGORAS abre todo el estudio y no se guarda aquí.
  function linkUrl(text) {
    try {
      const u = new URL(String(text).trim());
      if (!/^https?:$/.test(u.protocol) || !/\/api\/feed\/stream\/?$/.test(u.pathname) || !u.searchParams.get('t')) return '';
      return u.origin + '/api/feed/stream?t=' + encodeURIComponent(u.searchParams.get('t'));
    } catch (_) { return ''; }
  }
  // El papel de una pista, por su nombre (español e inglés). Sirve para dos cosas: llenar las seis tomas
  // con lo que más se ve (bombo, bajo, caja, voz, teclas, platillos) y tender solos los cables.
  const TRACK_ROLES = [
    ['kick', /\b(kick|kik|kck|bd|bombo|drum\s*rack|drums?|bater[ií]a|bataca|kit)\b/i],
    ['bass', /\b(bass|bajo|sub|808|reese|upright|contrabajo|synth\s*bass|moog)\b/i],
    ['snare', /\b(snare|snr|sd|caja|tarola|clap|palmas?|rim|rimshot|redoblante)\b/i],
    ['hats', /\b(hats?|hi[\s-]?hats?|hh|ch|oh|cymbal|platillos?|ride|crash|shaker|perc|percu|conga|bongo|toms?)\b/i],
    ['vox', /\b(vox|voz|voces|vocals?|voice|canto|rap|coros?|lead|melod[ií]a?|solo|guitar|gtr|guitarra|brass|sax|trompeta)\b/i],
    ['keys', /\b(keys?|teclas?|teclado|piano|rhodes|wurli|organ|[oó]rgano|pads?|chords?|acordes?|synth|sinte|saw|arp|strings?|cuerdas?|atmo|fx|efectos?|riser)\b/i],
  ];
  const ROLE_ORDER = ['kick', 'bass', 'snare', 'vox', 'keys', 'hats'];
  const UTILITY = /\b(click|metro|cue|ref|reference|guide|gu[ií]a|sc|sidechain|mute)\b/i;
  const roleOf = name => { const clean = String(name).replace(/^\s*\d+\s*[-·.:]?\s*/, ''); const hit = TRACK_ROLES.find(r => r[1].test(clean)); return hit ? hit[0] : ''; };
  // Las pistas, en el orden en que conviene darles toma: una por papel, luego las demás como vengan
  // en el set, y al final las de servicio (claqueta, guía, referencia), que no dicen nada a la imagen.
  function linkPool() {
    const first = [];
    for (const role of ROLE_ORDER) { const t = link.tracks.find(t => !first.includes(t) && !UTILITY.test(t.name) && roleOf(t.name) === role); if (t) first.push(t); }
    const rest = link.tracks.filter(t => !first.includes(t));
    return first.concat(rest.filter(t => !UTILITY.test(t.name)), rest.filter(t => UTILITY.test(t.name)));
  }
  // Los cables de cada escena de fábrica cuando hay pistas de Live: [papel, mando, cuánto, de dónde si
  // esa pista no está en el set (una fuente del master o un vaivén; «» = sin cable)].
  const AUTOPATCH = [
    [['bass', 'sig.rgb', .5, 'bass'], ['kick', 'geo.zoom', .14, 'beat'], ['hats', 'col.con', .16, 'high'], ['snare', 'sig.scan', .25, '']],
    [['bass', 'fb.zoom', .2, 'bass'], ['kick', 'col.con', .16, 'beat'], ['vox', 'fb.hue', .22, 'mid'], ['keys', 'fb.rot', .1, 'lfo1']],
    [['kick', 'geo.zoom', .16, 'beat'], ['bass', 'geo.warp', .34, 'bass'], ['keys', 'col.hue', .28, 'mid'], ['hats', 'geo.spin', .08, 'lfo1']],
    [['bass', 'gen.freq', .3, 'bass'], ['kick', 'gen.shape', .3, 'beat'], ['vox', 'gen.hue', .24, 'lfo2'], ['snare', 'sig.rgb', .28, '']],
    [['snare', 'sig.tear', .55, 'beat'], ['bass', 'sig.rgb', .42, 'bass'], ['hats', 'sig.noise', .2, 'lfo2'], ['kick', 'sig.vhold', .12, '']],
    [['bass', 'fb.zoom', .18, 'bass'], ['kick', 'col.post', .26, 'beat'], ['hats', 'sig.rgb', .38, 'high'], ['vox', 'col.hue', .4, 'lfo1']],
    [['bass', 'fb.zoom', -.14, 'bass'], ['kick', 'gen.freq', .35, 'beat'], ['vox', 'gen.hue', .3, 'mid'], ['keys', 'gen.shape', .22, '']],
    [],
    [['bass', 'col.cycle', .25, 'bass'], ['vox', 'col.solar', .3, 'mid'], ['hats', 'sig.bleed', .35, 'high'], ['kick', 'gen.freq', .2, 'beat'], ['kick', 'sig.spark', .6, 'beat'], ['bass', 'sig.smear', .4, 'bass']],
    [],
  ];
  const sameRoutes = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Solo si la escena sigue como salió de fábrica (nadie le movió un cable): entonces, al llegar Live,
  // sus cables pasan de «el sonido del cuarto» a «cada instrumento». Lo que el usuario cableó no se toca.
  function linkAutoPatch() {
    if (link.state !== 'on' || !link.tracks.length) return false;
    const factory = FACTORY()[store.scene];
    const intact = sameRoutes(live.r, factory.r) || (link.auto && link.auto.scene === store.scene && sameRoutes(live.r, link.auto.routes));
    if (!intact || !AUTOPATCH[store.scene].length) return false;
    const slotOf = role => { const i = link.keys.findIndex(key => { const t = link.tracks.find(t => t.key === key); return t && roleOf(t.name) === role; }); return i < 0 ? '' : LIVE_KEYS[i]; };
    const routes = [];
    for (const [role, dst, amt, fallback] of AUTOPATCH[store.scene]) { const src = slotOf(role) || fallback; if (src && !routes.some(r => r[0] === src && r[1] === dst)) routes.push([src, dst, amt]); }
    if (sameRoutes(routes, live.r)) { link.auto = { scene: store.scene, routes: routes.map(r => r.slice()) }; return false; }
    live.r = routes;
    link.auto = { scene: store.scene, routes: routes.map(r => r.slice()) };
    ui.easyFor = -1;
    if (ui.rig) { renderPage(); syncJacks(); }
    return true;
  }
  // Al irse Live, una escena que seguía con los cables automáticos vuelve a los suyos.
  function linkAutoUndo() {
    const auto = link.auto;
    link.auto = null;
    if (!auto || auto.scene !== store.scene || !sameRoutes(live.r, auto.routes)) return;
    live.r = store.scenes[store.scene].r.map(r => r.slice());
    ui.easyFor = -1;
    if (ui.rig) { renderPage(); syncJacks(); }
  }
  // Cada toma recuerda el NOMBRE de su pista: si en Live cambian de orden, el cable sigue al instrumento.
  function linkAssign() {
    const want = store.global.live.slots, used = new Set(), pool = linkPool();
    link.keys = LIVE_KEYS.map((_, i) => {
      const t = want[i] && want[i] !== '-' && link.tracks.find(t => t.name === want[i] && !used.has(t.key));
      if (t) used.add(t.key);
      return t ? t.key : '';
    });
    LIVE_KEYS.forEach((_, i) => {
      if (link.keys[i] || want[i] === '-') return;                       // ya tiene pista, o se dejó libre a propósito («-»)
      // (una toma cuya pista ya no existe —otro set— pasa a la siguiente pista sin toma)
      const t = pool.find(t => !used.has(t.key) && !want.includes(t.name));
      if (t) { used.add(t.key); link.keys[i] = t.key; want[i] = t.name; }
    });
    link.hi.fill(.25); link.lo.fill(.06); link.far.fill(0);
    linkLabels();
  }
  // El nombre de una pista, para una toma: sin el número que Live le pone delante («1-Drum Rack») y,
  // si no cabe, las primeras palabras que quepan («UPRIGHT», «WARM SAW»).
  function linkShort(name, max) {
    const clean = String(name).replace(/^\s*\d+\s*[-·.:]?\s*(?=\S)/, '').toUpperCase() || String(name).toUpperCase();
    if (clean.length <= max) return clean;
    let out = '';
    for (const word of clean.split(/\s+/)) { if ((out ? out + ' ' + word : word).length > max) break; out = out ? out + ' ' + word : word; }
    return out || clean.slice(0, max);
  }
  function linkLabels() {
    LIVE_KEYS.forEach((key, i) => {
      const t = link.tracks.find(t => t.key === link.keys[i]), kept = store.global.live.slots[i];
      const name = t ? t.name : kept && kept !== '-' ? kept : 'LIBRE';
      SRC[key].label = linkShort(name, 16);
      const jack = ui.rig && ui.rig.querySelector('.rig-jack[data-src="' + key + '"]');
      if (jack) { jack.querySelector('.hw-print').textContent = linkShort(name, 8); jack.classList.toggle('is-idle', !t); jack.setAttribute('aria-label', 'Modulador ' + name); }
    });
    if (ui.rig) { syncJacks(); linkPaint(); }
  }
  function linkSet(info) {
    link.tracks = Array.isArray(info && info.tracks) ? info.tracks.filter(t => t && t.key && t.kind !== 'master').map(t => ({ key: String(t.key), name: String(t.name || t.key).slice(0, 40) })) : [];
    link.demo = !!(info && info.demo);
    linkAssign();
    save();
    if (link.state === 'on') { if (linkAutoPatch()) readout('PISTAS CONECTADAS SOLAS', 2200); }
  }
  function linkTake(f) {
    if (!f || typeof f.t !== 'number') return;
    const now = performance.now();
    link.frame = f; link.at = now;
    if (link.state !== 'on') {
      link.state = 'on'; linkPaint(); syncJacks();
      if (linkAutoPatch()) readout('PISTAS CONECTADAS SOLAS', 2200);
      // al llegar la señal, las tomas de pista quedan a la vista (el pupitre se desplaza en pantallas bajas)
      const deck = ui.rig && ui.rig.querySelector('.rig-deck');
      if (deck && ui.page !== 'easy') requestAnimationFrame(() => { deck.scrollTop = deck.scrollHeight; });      // en FÁCIL todo cabe sin desplazar
    }
    // retraso de la red + diferencia entre relojes: el menor visto es lo que hay que descontar siempre
    const lag = Date.now() / 1000 - f.t;
    link.lag = lag < link.lag ? lag : link.lag + .0005;
    if (link.hits >= 0 && f.hits > link.hits && f.ears) { audio.beat = Math.max(audio.beat, clamp(.55 + .45 * (f.hit == null ? 1 : f.hit))); audio.beats++; audio.lastBeat = now; }
    link.hits = f.hits;
    // Cada pista usa TODO el recorrido de su toma, suene fuerte o bajito. Su techo sube al instante y
    // baja despacio (y deprisa si la pista lleva más de 2 s lejos de él: tras un golpe fuerte ya no
    // tarda 24 s en recuperarse); su piso sigue el valle real, para que un colchón sostenido también
    // respire; y el recorrido va de 7,5 a 30 dB según lo que la pista se mueva.
    const dt = clamp((now - (link.prevAt || now)) / 1000, .01, .25);
    link.prevAt = now;
    LIVE_KEYS.forEach((_, i) => {
      const v = link.keys[i] && f.tr && f.tr[link.keys[i]];
      if (!v || v[0] <= .06) { link.goal[i] = 0; link.lo[i] = Math.max(.05, link.lo[i] - .12 * dt); link.far[i] += dt; return; }      // puerta de ruido
      const x = v[0];
      link.far[i] = x > link.hi[i] - .1 ? 0 : link.far[i] + dt;
      link.hi[i] = x > link.hi[i] ? x : Math.max(.18, link.hi[i] - (link.far[i] > 2 ? .085 : .012) * dt);
      link.lo[i] = x < link.lo[i] ? link.lo[i] + (x - link.lo[i]) * Math.min(1, dt * 6) : Math.min(link.hi[i] - .14, link.lo[i] + .01 * dt);
      const span = clamp(link.hi[i] - link.lo[i], .14, .55);
      link.goal[i] = Math.pow(clamp((x - (link.hi[i] - span)) / span), 1.35);
    });
  }
  // El pulso de Live en este instante (el cuadro trae el suyo; se adelanta lo que tardó en llegar).
  function linkBeatNow() {
    const f = link.frame;
    return f.pos + (f.play ? clamp(Date.now() / 1000 - f.t - link.lag, 0, .5) * f.bpm / 60 : 0);
  }
  function linkOpen(text, quiet) {
    const url = linkUrl(text);
    if (!url) { if (!quiet) flipToast('Ese no es el enlace de VISUALES de PITÁGORAS. Cópialo tal cual de donde lo encendiste.', 5200); return false; }
    linkClose(true);
    store.global.live.url = url; save();
    Object.assign(link, { state: 'connecting', lag: Infinity, hits: -1, host: new URL(url).host });
    let es;
    try { es = new EventSource(url); } catch (_) { link.state = 'error'; linkPaint(); return false; }
    link.es = es;
    es.addEventListener('set', event => { try { linkSet(JSON.parse(event.data)); } catch (_) {} });
    es.onmessage = event => { try { linkTake(JSON.parse(event.data)); } catch (_) {} };
    es.onerror = () => { if (link.es !== es) return; link.state = es.readyState === 2 ? 'error' : 'connecting'; linkPaint(); };
    linkPaint();
    return true;
  }
  // Enlace de un clic: quien da la señal (PITÁGORAS) abre FLIP con «#stage-live=<enlace de visuales>».
  // Va en el fragmento, que no viaja a ningún servidor; aquí se valida (solo vale el enlace de solo
  // escucha), se guarda y se borra de la barra de direcciones.
  function linkFromHash() {
    const hit = /[#&]stage-live=([^&]+)/.exec(location.hash || '');
    if (!hit) return false;
    let url = '';
    try { url = linkUrl(decodeURIComponent(hit[1])); } catch (_) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    if (!url) return false;
    store.global.live.url = url; save();
    return true;
  }
  function linkClose(keep) {
    if (link.es) { link.es.close(); link.es = null; }
    Object.assign(link, { state: 'off', frame: null, at: -1e9, tracks: [], hits: -1 });
    link.goal.fill(0); link.hi.fill(.25); link.lo.fill(.06); link.far.fill(0); link.keys.fill('');
    linkAutoUndo();
    if (!keep) { store.global.live.url = ''; save(); }
    linkLabels();
  }
  function linkPaint() {
    if (!ui.rig) return;
    link.paintAt = performance.now();
    const f = link.frame, on = link.state === 'on' && linkFresh();
    const text = link.state === 'off' ? 'LIVE · CONECTAR CON ABLETON'
      : link.state === 'error' ? 'LIVE · NO CONTESTA · TOCA PARA REVISAR'
      : !on ? 'LIVE · BUSCANDO A PITÁGORAS…'
      : 'LIVE · ' + (f.bpm ? Math.round(f.bpm) + ' BPM' : 'SIN TEMPO') + ' · ' + link.tracks.length + (link.tracks.length === 1 ? ' PISTA' : ' PISTAS') + (link.demo ? ' · DEMO' : f.ears ? '' : ' · SIN OÍDO DEL MASTER') + (f.play ? '' : ' · PARADO');
    put('rigLiveText', text);
    if (ui.rig.classList.contains('rig-live-on') !== on) requestAnimationFrame(cables);   // las tomas cambian de fila: los cables, con ellas
    ui.rig.classList.toggle('rig-live-on', on);
    $('rigLive').classList.toggle('is-on', on);
    $('rigLive').classList.toggle('is-wait', link.state === 'connecting' || (link.state === 'on' && !on));
    const sheet = $('rigLiveSheet');
    if (sheet.hidden) return;
    put('rigLiveHelp', on ? 'Conectado' + (link.host ? ' a ' + link.host : '') + '. Elige qué pista de Ableton sigue cada toma; luego toca la toma y un mando para tender el cable.'
      : 'Pega el enlace de VISUALES que da PITÁGORAS al encenderse. Solo deja escuchar lo que toca Live: el nivel de cada pista, los golpes y el compás.');
    $('rigLiveUrl').hidden = on; $('rigLiveGo').hidden = on; $('rigLiveOff').hidden = link.state === 'off';
    const slots = $('rigLiveSlots'), sign = link.tracks.map(t => t.key + t.name).join('|') + '#' + link.keys.join(',');
    slots.hidden = !on;
    if (on && slots.dataset.sign !== sign) {
      slots.dataset.sign = sign;
      const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      slots.innerHTML = LIVE_KEYS.map((key, i) => `<label style="--tone:${SRC[key].tone}"><i></i><span>TOMA ${i + 1}</span><select data-slot="${i}" aria-label="Pista de la toma ${i + 1}"><option value="-">— libre —</option>${link.tracks.map(t => `<option value="${esc(t.name)}"${t.key === link.keys[i] ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`).join('');
    }
  }
  function linkSheet(open) {
    $('rigLiveSheet').hidden = !open;
    if (open) { $('rigLiveUrl').value = ''; linkPaint(); }
  }

  // ── Reloj y moduladores ─────────────────────────────────────────────────────
  const taps = [];
  // Quién marca el tempo: el reloj MIDI si llega; si no, el que se marcó a golpes; si no, el de la música.
  // (Con LIVE conectado manda Ableton: es el tempo de verdad, no uno estimado.)
  function bpmNow() { return linkTempo() || (performance.now() - midi.tickAt < 1500 ? midi.bpm : store.global.bpm || audio.bpm || 120); }
  function bpmSource() { return linkTempo() ? 'LIVE' : performance.now() - midi.tickAt < 1500 ? 'MIDI' : store.global.bpm ? 'TAP' : audio.bpm ? 'AUTO' : ''; }
  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 2) { store.global.bpm = clamp(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)), 40, 240); save(); }
    clock.beat = Math.round(clock.beat);                                  // el golpe marca dónde cae el pulso
    ph.lfo[0] = Math.round(ph.lfo[0]); ph.lfo[1] = Math.round(ph.lfo[1]);
    readout(store.global.bpm ? 'TEMPO ' + Math.round(store.global.bpm) + ' BPM' : 'TAP · SIGUE EL RITMO');
  }
  const lfoRate = n => (val['lfo' + n + '.rate'] === undefined ? live.p['lfo' + n + '.rate'] : val['lfo' + n + '.rate']);
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
    clock.beat += bpmNow() / 60 * dt;
    if (linkTempo() && link.frame.play) {
      // El reloj de compases es el de Live: mismo pulso y mismo número de compás que el transporte.
      const d = linkBeatNow() - clock.beat;
      clock.beat += Math.abs(d) > 1.5 ? d : d * Math.min(1, dt * 12);
    }
    {
      // Las pistas de Live llegan unas diez veces por segundo: suben en 25 ms y sueltan en 140 ms.
      const up = 1 - Math.exp(-dt / .025), down = 1 - Math.exp(-dt / .14), alive = linkFresh();
      for (let i = 0; i < LIVE_KEYS.length; i++) { const goal = alive ? link.goal[i] : 0, key = LIVE_KEYS[i]; mods[key] += (goal - mods[key]) * (goal > mods[key] ? up : down); }
    }
    for (const n of [0, 1]) {
      // A tempo, la fase sale del reloj de compases (así cae en el pulso); libre, corre por su cuenta.
      if (live.d['lfo.sync']) ph.lfo[n] = clock.beat * DIVS[Math.min(7, Math.floor(lfoRate(n + 1) * 8))][0];
      else ph.lfo[n] += .03 * Math.pow(500, lfoRate(n + 1)) * dt;
      mods['lfo' + (n + 1)] = wave(live.d['lfo' + (n + 1) + '.shape'], ph.lfo[n], ph.rnd[n]);
    }
    mods.padx = pad.x; mods.pady = pad.y;
    mods.note = midi.held.size ? midi.gate : mods.note * Math.exp(-dt / .25);
    midi.hit *= Math.exp(-dt / .16);
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
    // PINCEL: recorre una curva cerrada de tres frecuencias que no casan entre sí (tarda mucho en repetir
    // el mismo trazo); ESCALA es el radio de la curva y VELOCIDAD, lo que corre. El óvalo va atravesado a su camino.
    // (va por la mitad de abajo: con la DERIVA hacia arriba, cada pasada sube y la siguiente se apila debajo)
    const brushAt = s => { const R = .1 + .3 * v['gen.freq']; return [R * (W / H) * (.95 * Math.sin(s) + .1 * Math.sin(2.618 * s + 1.3)), .2 + R * (.5 * Math.sin(1.414 * s + .7) + .12 * Math.sin(3.303 * s))]; };
    const bp = brushAt(ph.gen * 1.1), ahead = brushAt(ph.gen * 1.1 + .01), behind = brushAt(ph.gen * 1.1 - .01), bl = Math.hypot(ahead[0] - behind[0], ahead[1] - behind[1]);
    brush.from = brush.at || bp; brush.fromDir = brush.dir;
    if (bl > 1e-6) brush.dir = [(ahead[0] - behind[0]) / bl, (ahead[1] - behind[1]) / bl];
    const travel = brush.at ? Math.hypot(bp[0] - brush.at[0], bp[1] - brush.at[1]) * H : 0;
    brush.at = bp;
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
    // Sin cámara y sin generador a la vista, el monitor no se queda en negro: se dibuja un
    // generador. Es solo el dibujo: los mandos y lo guardado no cambian, y al llegar la cámara vuelve.
    // Solo cuando de verdad no hay cámara: no mientras se está abriendo (ni en el primer segundo y
    // medio), para que al entrar con cámara no asome el generador.
    const opening = typeof cameraRequest !== 'undefined' && !!cameraRequest;
    if (camReady() || opening) camMissSince = 0; else if (!camMissSince) camMissSince = performance.now();
    // (la clave SILUETA recorta a la persona de la cámara: sin cámara no hay a quién recortar y salía negro)
    const camless = !!camMissSince && performance.now() - camMissSince > 1500 && (!(d['src.gen'] && v['mix.fade'] > .5) || d['mix.mode'] === 5);
    c.i('uGen', camless ? 2 : d['src.gen']); c.i('uMixMode', camless ? 0 : d['mix.mode']); c.i('uFbMode', d['fb.mode']); c.i('uMirror', d['geo.mirror']); c.f('uKeyInv', d['key.inv'] ? 1 : 0);
    c.f('uGenFreq', lerp(1.5, 42, v['gen.freq'] * v['gen.freq'])); c.f('uGenPhase', ph.gen); c.f('uGenShape', v['gen.shape']); c.f('uGenHue', v['gen.hue']);
    c.v2('uBrush', bp[0], bp[1]); c.v2('uBrushDir', brush.dir[0], brush.dir[1]); c.f('uBrushR', BRUSH_R);
    c.v2('uBrushFrom', brush.from[0], brush.from[1]); c.v2('uBrushFromDir', brush.fromDir[0], brush.fromDir[1]);
    // SALPICADURA: cada gota sale de la corona, sube y cae (catorce, con su azar fijo); la CPU las pone.
    if (d['src.gen'] === GEN_SALPICADURA) {
      const size = .75 + .6 * v['gen.freq'], cyc = ((ph.gen * .16) % 1 + 1) % 1;
      c.v2('uSplash', size, cyc);
      for (let i = 0; i < 14; i++) {
        const r = n => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
        const a = r(1) * TAU, tt = (cyc * 1.3 + r(2) * .3) % 1, kick = size * (.6 + .6 * r(3));
        drops[i * 4] = Math.cos(a) * .5 * size + Math.cos(a) * .25 * tt * kick;
        drops[i * 4 + 1] = .08 + Math.sin(a) * .21 * size + (.9 * tt * tt - .55 * tt - .02) * kick;
        drops[i * 4 + 2] = (.012 + .016 * r(4)) * size * (1 - tt * .5);
        drops[i * 4 + 3] = .6 + .4 * r(5);
      }
      c.v4v('uDrops', drops);
    }
    c.f('uFade', camless ? 1 : v['mix.fade']); c.f('uKeyLevel', v['key.level']); c.f('uKeySoft', .01 + v['key.soft'] * .35);
    c.f('uFbAmt', v['fb.amt'] * .985); c.f('uFbZoom', Math.exp(bi(v['fb.zoom']) * .22 * k)); c.f('uFbRot', bi(v['fb.rot']) * .16 * k);
    c.v2('uFbShift', bi(v['fb.x']) * .045 * k, bi(v['fb.y']) * .045 * k); c.f('uFbHue', v['fb.hue'] * .12 * k); c.f('uFbGain', Math.pow(.55 + v['fb.decay'] * .5, k));
    c.f('uZoom', Math.exp(bi(v['geo.zoom']) * 1.6)); c.f('uRot', bi(v['geo.rot']) * Math.PI + ph.spin * TAU);
    c.f('uKal', v['geo.kal'] < .05 ? 0 : 2 + Math.floor((v['geo.kal'] - .05) / .95 * 10.999)); c.f('uTile', 1 + Math.floor(v['geo.tile'] * 7.999));
    c.f('uWarp', v['geo.warp'] * v['geo.warp'] * .28); c.f('uWarpFreq', 1.5 + v['geo.wfreq'] * 26); c.f('uWarpPhase', ph.warp);
    // SELLO y TRAMA RGB comparten celda: ladrillo de 1,5 × 1 en píxeles enteros, a 1/120 del alto.
    const cellH = Math.max(2, Math.round(H / 120)), cellW = Math.max(2, Math.round(cellH * 1.5));
    const stamping = d['fb.mode'] === FB_SELLO && v['fb.amt'] > 0;
    let jumpX = 0, jumpY = 0, turns = 0;
    // (al entrar a SELLO el lienzo empieza en negro: lo que quedara en el bucle de la escena anterior se
    //  quedaría segundos pegado, porque en SELLO las copias casi no se apagan)
    if (stamping && !lazo.on) {
      for (const b of eng.fb) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.f);
    }
    lazo.on = stamping;
    if (stamping) {
      lazo.x += bi(v['fb.x']) * .045 * k * H / cellW; lazo.y += bi(v['fb.y']) * .045 * k * H / cellH;
      jumpX = Math.round(lazo.x); jumpY = Math.round(lazo.y); lazo.x -= jumpX; lazo.y -= jumpY;
      // una vértebra cada ocho celdas de recorrido (y, quieto, cada treinta y dos cuadros: el sello no se queda sin canto)
      lazo.rim += Math.hypot(bi(v['fb.x']) * .045 * k * H / cellW, bi(v['fb.y']) * .045 * k * H / cellH) + .25 * k;
      if (d['src.gen'] === GEN_PINCEL && v['mix.fade'] > .5) lazo.rim += travel / cellW;     // (con el PINCEL, cuenta lo que avanza el sello)
      lazo.hue += v['fb.hue'] * .12 * k;
      turns = Math.floor(lazo.hue * 3); lazo.hue -= turns / 3;
    } else { lazo.x = lazo.y = lazo.hue = 0; lazo.rim = 8; }
    // (con el PINCEL no hace falta: su canto menta va en el costado y lo barre el camino)
    const rim = stamping && lazo.rim >= 8 && !(d['src.gen'] === GEN_PINCEL && v['mix.fade'] > .5 && d['mix.mode'] < 4);
    if (rim) lazo.rim %= 8;
    c.v2('uCell', cellW, cellH); c.v2('uSelloShift', jumpX, jumpY); c.i('uSelloRot', turns % 3); c.f('uDither', stamping ? v['sig.dither'] : 0); c.f('uSelloRim', rim ? 1 : 0);
    // (COLA en SELLO: a tope la copia dura casi para siempre y solo la tapan el sello o la deriva; abajo, se apaga)
    c.f('uSelloFade', (1 - v['fb.decay']) * .012 * k);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ESPECTRO: se mide la luz de lo que pasa la clave (rejilla y mipmaps) y se suaviza la media del cuadro.
    const conK = Math.exp(bi(v['col.con']) * 1.1);
    const measured = d['col.pal'] === PAL_ESPECTRO && v['col.tint'] > 0 && statsReady();
    let statsOne = null;
    if (measured) {
      const s = eng.stats, m = s.prog, from = s.one[s.flip], to = s.one[1 - s.flip];
      gl.useProgram(m.pr);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb); gl.viewport(0, 0, 192, 36);
      bind(0, write.t); bind(1, from.t);
      m.i('uSrc', 0); m.i('uPrev', 1); m.i('uStep', 0); m.f('uCon', conK);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      bind(2, s.tex); gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.f); gl.viewport(0, 0, 3, 1);
      bind(0, s.tex); bind(1, from.t);
      m.i('uStep', 1); m.f('uKeep', s.fresh ? 0 : Math.pow(.88, k));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      s.flip = 1 - s.flip; s.fresh = false; statsOne = to.t;
    } else if (eng.stats) eng.stats.fresh = true;

    c = eng.post;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(c.pr);
    bind(0, write.t);
    if (statsOne) { bind(1, eng.stats.tex); bind(2, statsOne); }
    c.i('uStats', 1); c.i('uStatsOne', 2); c.i('uNorm', statsOne ? 1 : 0);
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
    c.i('uPalMode', d['col.pal'] === PAL_ESPECTRO ? 1 : 0);
    // (con SELLO la trama ya va dentro del lazo: tramar otra vez a la salida la descuadraría)
    c.f('uSpark', v['sig.spark']); c.f('uSparkCell', Math.max(4, Math.round(H / 80))); c.f('uSmear', v['sig.smear']); c.f('uDither', stamping ? 0 : v['sig.dither']); c.v2('uCell', cellW, cellH);
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
    // El panel se repinta 20 veces por segundo: de sobra para pilotos y agujas, y un tercio del
    // trabajo de estilos que costaba repintarlo cada dos cuadros en una pantalla de 120 Hz.
    if (now - clock.painted >= 48) { clock.painted = now; paint(now); }
  }
  function tick() {
    try { frame(); state.failed = 0; }
    catch (error) {
      if (++state.failed === 1) console.error('STAGE', error);
      if (state.failed === 30) note('STAGE se detuvo por un error de dibujo. Sal y vuelve a entrar.');
    }
  }
  // 60 cuadros por segundo como mucho: en una pantalla de 120 Hz dibujaba el doble sin que se viera.
  function mainFrame() {
    if (!state.active) return;
    if (!(out.ctx && performance.now() - out.lastTick < 150)) tick();     // con ventana de salida, manda su reloj
    pumpMain();
  }
  mainFrame.maxFps = 60;
  function pumpMain() { scheduleFrame(mainFrame); }

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
    if (!eng.ok || typeof MediaRecorder === 'undefined') { flipToast('Este navegador no puede grabar video.'); return; }
    const feed = eng.canvas.captureStream(30);
    if (audio.on && audio.stream) audio.stream.getAudioTracks().forEach(track => feed.addTrack(track));
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
  // Una escena de fábrica hecha sobre una cámara de FLIP que no está registrada (todavía) se llama con su
  // respaldo, si lo tiene (GUSANO); lo guardado no se toca.
  function playable(index) {
    const target = store.scenes[index], factory = FACTORY()[index], spare = factory && RESPALDO[factory.name];
    return spare && target.d['src.look'] === factory.d['src.look'] && !lookKnown(target.d['src.look']) ? spare() : target;
  }
  function recall(index, instant) {
    index = clamp(index | 0, 0, SCENE_COUNT - 1);
    const target = playable(index);
    store.scene = index;
    const ms = instant ? 0 : Math.pow(live.p['mod.morph'], 2) * 4000;
    if (ms > 20) { morph = { from: Object.assign({}, live.p), to: Object.assign({}, target.p), t0: performance.now(), ms }; }
    else { morph = null; for (const id of SCENE_IDS) live.p[id] = target.p[id]; }
    for (const id of Object.keys(midi.slew)) delete midi.slew[id];
    live.d = Object.assign({}, target.d);
    live.r = target.r.map(r => r.slice());
    link.auto = null; linkAutoPatch();
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
    ui.easyFor = -1;
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
    if (route && ui.page === 'easy') coach(SRC[src].label + ' conectado. Arrastra el mando para decidir cuánto lo mueve.', 3600);
    save();
  }
  function arm(src) {
    ui.armed = ui.armed === src ? '' : src;
    ui.rig.classList.toggle('is-arming', !!ui.armed);
    ui.rig.style.setProperty('--arm', ui.armed ? SRC[ui.armed].tone : 'transparent');
    syncJacks();
    if (ui.armed) readout(SRC[ui.armed].label + ' > TOCA UN MANDO', 4000); else readout('', 0);
    coach();
    if (ui.armed && (ui.armed === 'bass' || ui.armed === 'mid' || ui.armed === 'high' || ui.armed === 'beat') && !audio.on && !audio.inject && !linkMaster()) flipToast('Enciende MIC para que siga el sonido.', 2600);
    if (ui.armed === 'note' && midi.state === 'off') flipToast('Toca MIDI para conectar tu controlador.', 2600);
    if (ui.armed && LIVE_KEYS.includes(ui.armed) && link.state !== 'on') flipToast('Conecta LIVE para que este mando siga una pista de Ableton.', 2600);
  }

  // ── Consola ─────────────────────────────────────────────────────────────────
  const ui = { rig: null, monitor: null, screen: null, panel: null, cablesSvg: null, cleanHint: null, page: 'easy', taller: 'src', ctl: {}, armed: '', drag: null, black: false, blackAmt: 0,
    readout: { text: '', until: 0 }, lcdAt: 0, stale: false, lastTap: { t: 0, id: '' } };
  const icon = name => (window.flipShell ? flipShell.icon(name) : '');
  const SVG = {
    left: '<path d="m14.5 6-6 6 6 6"/>', right: '<path d="m9.5 6 6 6-6 6"/>',
    midi: '<circle cx="12" cy="12" r="8.6"/><circle cx="7.4" cy="12.6" r=".9" fill="currentColor"/><circle cx="16.6" cy="12.6" r=".9" fill="currentColor"/><circle cx="8.9" cy="8.7" r=".9" fill="currentColor"/><circle cx="15.1" cy="8.7" r=".9" fill="currentColor"/><circle cx="12" cy="7.3" r=".9" fill="currentColor"/><path d="M10.4 17.6h3.2"/>',
    out: '<rect x="3" y="4.5" width="18" height="12" rx="1.6"/><path d="M8 20.5h8M12 16.5v4"/><path d="m10.4 8.4 3.6 2.1-3.6 2.1z" fill="currentColor" stroke="none"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[name]}</svg>`;
  const getD = id => (id.startsWith('out.') ? (id === 'out.black' ? (ui.black ? 1 : 0) : store.global[id.slice(4)]) : id === 'src.var' ? lookVariant(live.d['src.look']) : live.d[id]);
  // A · VARIANTE no se guarda aparte: es la segunda mitad de «FAMILIA:VARIANTE» en A · CÁMARA.
  const variantLabels = () => { const list = variantsOf(lookFamily(live.d['src.look'])); return list.length ? list.map(v => String(v.label || v.id).toUpperCase()) : ['—']; };
  const optionsOf = id => (id === 'aud.src' ? audioOptions().map(option => option.label) : id === 'src.look' ? looks().map(l => l.label) : id === 'src.var' ? variantLabels() : OPTIONS[id]);
  const optionIndex = id => (id === 'src.look' ? Math.max(0, looks().findIndex(l => l.key === lookFamily(live.d[id])))
    : id === 'src.var' ? Math.max(0, variantsOf(lookFamily(live.d['src.look'])).findIndex(v => v.id === lookVariant(live.d['src.look'])))
    : id === 'aud.src' ? Math.max(0, audioOptions().findIndex(option => option.kind === audio.kind && option.id === audio.deviceId)) : getD(id));
  function setD(id, value) {
    if (id === 'out.black') { setBlack(!!value); return; }
    if (id === 'aud.src') { const option = audioOptions()[value]; if (option) { audio.kind = option.kind; audio.deviceId = option.id; audioOn(option.kind, option.id); } return; }
    if (id === 'src.var') {
      // (por número, la variante en la lista de su familia; o por su clave: «CRT»)
      const family = lookFamily(live.d['src.look']), list = variantsOf(family);
      const chosen = typeof value === 'string' ? allVariants(family).find(v => v.id === value) : list[value];
      if (!chosen) return;
      live.d['src.look'] = family + ':' + chosen.id;
      id = 'src.look';
    } else if (id.startsWith('out.')) { store.global[id.slice(4)] = value; if (id === 'out.aspect' || id === 'out.quality') { clock.autoH = COARSE ? 540 : 720; resize(); } }
    // (A · CÁMARA por número elige la familia —con su variante de siempre—; por texto, «FAMILIA» o «FAMILIA:VARIANTE»)
    else live.d[id] = id === 'src.look' ? (typeof value === 'string' ? value : (looks()[value] || looks()[0]).key) : value;
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
    if (id === 'col.solar' && spectral()) return (1.5 + v * 3.5).toFixed(1) + ' VUELTAS';
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
            <div class="rig-tally rig-tally-right"><span id="rigTallyAudio" class="is-off" role="button" tabindex="0" aria-label="Escuchar música: enciende el micrófono"><b>ESCUCHAR MÚSICA</b><em class="vu"><u></u></em></span></div>
            <div class="rig-note" id="rigNote" role="status"></div>
            <div class="rig-clean-hint" id="rigCleanHint">Arrastra: PAD X · Y &nbsp;·&nbsp; Doble toque: siguiente escena &nbsp;·&nbsp; Atrás: salir</div>
          </div>
        </div>
        <div class="rig-side">
        <div class="rig-deck">
          <div class="rig-row rig-row-scenes"><span class="hw-print">ESCENAS</span><div class="rig-modos" id="rigModos" role="tablist" aria-label="Vista"><button class="hw hw-keycap rig-modo" data-color="gray" type="button" role="tab" data-page="easy"><span>FÁCIL</span></button><button class="hw hw-keycap rig-modo" data-color="gray" type="button" id="rigTaller" aria-label="Taller: el sintetizador completo"><span>TALLER</span></button></div>${window.flipRollo ? `<img class="rollo-badge" src="${flipRollo.url('marca/placa-vs-27-clara.svg')}" alt="STAGE VS-27 PRO">` : '<span class="hw-print rig-badge">VS-27 · PRO</span>'}</div>
          <div class="rig-scenes" id="rigScenes" role="radiogroup" aria-label="Escenas">${Array.from({ length: SCENE_COUNT }, (_, i) => i).map(i => `<button class="hw hw-keycap" type="button" role="radio" data-scene="${i}" data-feel="key" aria-label="Escena ${i + 1}"><span>${i + 1}</span><em></em></button>`).join('')}</div>
          <div class="rig-tabs" id="rigTabs" role="tablist" aria-label="Módulos">${PAGES.filter(page => page.id !== 'easy').map(page => `<button class="hw hw-keycap rig-tab" data-color="gray" type="button" role="tab" data-page="${page.id}"><span>${page.label}</span></button>`).join('')}</div>
          <p class="rig-coach" id="rigCoach" role="status"></p>
          <div class="rig-panel" id="rigPanel" role="tabpanel"></div>
          <button class="hw rig-live" id="rigLive" type="button" aria-haspopup="dialog" aria-label="Enlace con Ableton Live"><i></i><span id="rigLiveText">LIVE · CONECTAR CON ABLETON</span></button>
          <div class="rig-jacks" id="rigJacks" aria-label="Moduladores">${SOURCES.map(([key, label, tone]) => `<button class="hw rig-jack" type="button" data-src="${key}"${LIVE_KEYS.includes(key) ? ' data-live' : ''} data-feel="soft" style="--tone:${tone}" aria-label="Modulador ${label}"><i class="led"></i><b class="socket"></b><span class="hw-print">${label}</span></button>`).join('')}</div>
        </div>
          <div class="rig-transport">
            <div class="hw-labeled"><button class="hw hw-candy" data-color="coral" id="rigRec" type="button" data-feel="primary" aria-label="Grabar la salida">${icon('rec')}</button><span class="hw-print">REC</span></div>
            <div class="hw-labeled"><button class="hw hw-candy" data-color="white" id="rigPhoto" type="button" aria-label="Foto de la salida">${icon(window.flipRollo ? 'foto' : 'cam')}</button><span class="hw-print">FOTO</span></div>
            <button class="hw hw-keycap" data-color="coral" id="rigOut" type="button" data-feel="primary" aria-label="Abrir la salida limpia">${window.flipRollo ? icon('salida') : svg('out')}<span>SALIDA</span></button>
            <button class="hw hw-keycap" data-color="mustard" id="rigTap" type="button" aria-label="Marcar el tempo"><span>TAP</span><em id="rigBpm">120</em></button>
            <div class="hw-labeled"><button class="hw hw-candy" id="rigMic" type="button" aria-label="Micrófono: reacción al sonido" aria-pressed="false">${icon('mic')}</button><span class="hw-print">MIC</span></div>
            <div class="hw-labeled"><button class="hw hw-candy" id="rigMidi" type="button" aria-label="MIDI: conectar y aprender" aria-pressed="false">${window.flipRollo ? icon('midi') : svg('midi')}</button><span class="hw-print">MIDI</span></div>
          </div>
        </div>
        <svg class="rig-cables" id="rigCables" aria-hidden="true"></svg>
        <div class="rig-live-sheet" id="rigLiveSheet" role="dialog" aria-label="Enlace con Ableton Live" hidden>
          <h3>LIVE · ABLETON</h3>
          <p id="rigLiveHelp"></p>
          <input id="rigLiveUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="http://127.0.0.1:8420/api/feed/stream?t=…" aria-label="Enlace de visuales de PITÁGORAS">
          <div class="rig-live-slots" id="rigLiveSlots" hidden></div>
          <div class="rig-live-keys"><button type="button" id="rigLiveGo">CONECTAR</button><button type="button" id="rigLiveOff">DESCONECTAR</button><button type="button" id="rigLiveClose">LISTO</button></div>
        </div>
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
  // Los cuatro mandos que más cuentan en esta escena: primero los que ya llevan cable, luego los
  // que la escena movió más lejos de fábrica, y si faltan, cuatro de siempre.
  // (se eligen al entrar a la escena y se quedan quietos: si se recalcularan con cada cable, las barras
  //  cambiarían de sitio bajo el dedo)
  function easyKnobs() {
    if (ui.easyIds && ui.easyFor === store.scene) return ui.easyIds;
    const picked = [];
    for (const r of live.r) if (!picked.includes(r[1]) && SCENE_IDS.includes(r[1]) && !/^lfo/.test(r[1])) picked.push(r[1]);
    // (en plena transición cuentan los valores de destino, no los de la escena que se va)
    const goal = morph ? Object.assign({}, live.p, morph.to) : live.p;
    const moved = SCENE_IDS.filter(id => !picked.includes(id) && !/^lfo/.test(id)).map(id => [Math.abs(goal[id] - P[id][1]), id]).sort((a, b) => b[0] - a[0]);
    for (const [far, id] of moved) if (picked.length < 4 && far > .04) picked.push(id);
    for (const id of ['geo.zoom', 'col.hue', 'sig.rgb', 'fb.amt']) if (picked.length < 4 && !picked.includes(id)) picked.push(id);
    ui.easyFor = store.scene;
    return (ui.easyIds = picked.slice(0, 4));
  }
  // Las fuentes que se enseñan en FÁCIL: las que ya llevan cable y, de las demás, las pistas de Live si
  // el enlace está encendido, o el sonido y un LFO si no.
  const EASY_SOURCES = ['bass', 'beat', 'mid', 'high', 'lfo1', 'hx'];
  // Una línea que dice qué hacer ahora, con palabras de todos los días.
  let coachTimer = 0;
  function coach(text, ms) {
    const node = ui.rig && $('rigCoach');
    if (!node) return;
    clearTimeout(coachTimer);
    const easy = ui.page === 'easy';
    const base = easy ? (ui.pick ? 'Elige qué mueve «' + facil(ui.pick) + '»' : live.r.length ? 'Desliza una barra, o toca su color para cambiar qué la mueve.' : 'Toca «+ CONECTAR» en un efecto para que siga la música.')
      : ui.armed ? SRC[ui.armed].label + ' › ahora toca la perilla que quieres que mueva' : live.r.length ? 'Toca una fuente y luego una perilla para conectar otro cable' : '1 · Toca una fuente de abajo     2 · Toca la perilla que quieres que mueva';
    node.textContent = text || base;
    node.classList.toggle('is-armed', !!ui.armed && !text);
    node.style.setProperty('--arm', ui.armed ? SRC[ui.armed].tone : 'transparent');
    if (text && ms) coachTimer = setTimeout(() => coach(), ms);
  }
  // FÁCIL · cada efecto de la escena es una barra que se desliza, con una pastilla a su derecha que dice
  // qué la mueve (y late con ello). Tocar la pastilla abre ahí mismo la lista de fuentes y cuánto
  // la mueve. Son los mismos datos que el TALLER (live.p y live.r): allá se ven como perillas y cables.
  const escHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pickList = () => (link.state === 'on' && linkFresh() ? LIVE_KEYS.filter((_, i) => link.keys[i]) : []).concat(['bass', 'mid', 'high', 'beat', 'lfo1', 'lfo2', 'padx', 'hx']);
  const pctText = amt => (amt > 0 ? '+' : '') + Math.round(amt * 100) + ' %';
  function stripHtml(id) {
    const r = live.r.find(r => r[1] === id), open = ui.pick === id, name = escHtml(facil(id));
    let html = `<div class="rig-tira${open ? ' is-open' : ''}" data-tira="${id}">
      <div class="rig-fader" data-param="${id}" data-feel="none" role="slider" tabindex="0" aria-label="${name}" aria-valuemin="0" aria-valuemax="100"><span class="hw-print">${name}</span><div class="track"><i class="ring"></i><i class="cap"></i><i class="live"></i></div></div>
      <button class="hw rig-pastilla${r ? ' is-on' : ''}" type="button" data-pill="${id}" data-feel="soft" style="--tone:${r ? SRC[r[0]].tone : 'transparent'}" aria-expanded="${open}" aria-label="${r ? 'Lo mueve ' + escHtml(srcFacil(r[0])) + '. Toca para cambiarlo' : 'Conectar ' + name + ' a una fuente'}">${r ? `<i class="led" data-led="${r[0]}"></i><span>${escHtml(srcFacil(r[0]))}</span>` : '<span>+ CONECTAR</span>'}</button>`;
    if (open) html += `<div class="rig-elige" role="group" aria-label="Qué mueve ${name}">
        <div class="rig-elige-fuentes">${pickList().map(key => `<button class="hw rig-fuente${r && r[0] === key ? ' is-on' : ''}" type="button" data-fuente="${key}" data-feel="key" style="--tone:${SRC[key].tone}" aria-pressed="${!!(r && r[0] === key)}"><i class="led" data-led="${key}"></i><span>${escHtml(srcFacil(key))}</span></button>`).join('')}</div>
        ${r ? `<label class="rig-cuanto"><span class="hw-print">QUÉ TANTO LA MUEVE</span><input type="range" min="-100" max="100" step="2" value="${Math.round(r[2] * 100)}" data-cuanto="${id}" style="accent-color:${SRC[r[0]].tone}" aria-label="Qué tanto la mueve"><b>${pctText(r[2])}</b></label>` : ''}
        <div class="rig-elige-teclas">${r ? '<button class="hw hw-keycap" data-color="gray" type="button" data-elige="quitar" data-feel="slide"><span>QUITAR</span></button>' : ''}<button class="hw hw-keycap" data-color="gray" type="button" data-elige="taller"><span>VER EN TALLER</span></button><button class="hw hw-keycap" type="button" data-elige="listo" data-feel="soft"><span>LISTO</span></button></div>
      </div>`;
    return html + '</div>';
  }
  // A qué página del TALLER pertenece un mando.
  const pageOf = id => (PAGES.find(p => (p.knobs || []).includes(id) || p.fader === id) || PAGES[1]).id;
  function renderPage() {
    let page = PAGES.find(entry => entry.id === ui.page) || PAGES[0];
    const easy = page.id === 'easy';
    if (easy) page = { id: 'easy', title: 'ESCENA ' + (store.scene + 1) + ' · ' + store.scenes[store.scene].name, knobs: easyKnobs() };
    if (easy && ui.armed) { ui.armed = ''; ui.rig.classList.remove('is-arming'); }      // en FÁCIL no hay «cable en la mano»
    if (!easy || !page.knobs.includes(ui.pick)) ui.pick = '';
    ui.rig.classList.toggle('rig-easy', easy);
    $('rigTaller').classList.toggle('is-on', !easy);
    let html = easy ? '' : `<div class="rig-title hw-print">${page.title}</div>`;
    if (page.picks) html += `<div class="rig-picks" data-count="${page.picks.length}">${page.picks.map(pickHtml).join('')}</div>`;
    if (page.fader) html += `<div class="rig-fader" data-param="${page.fader}" data-feel="none" role="slider" tabindex="0" aria-label="Fundido entre la cámara y el generador" aria-valuemin="0" aria-valuemax="100"><span class="hw-print">A</span><div class="track"><i class="ring"></i><i class="cap"></i><i class="live"></i></div><span class="hw-print">B</span></div>`;
    if (easy) html += `<div class="rig-tiras">${page.knobs.map(stripHtml).join('')}</div>`;
    html += `<div class="rig-knobs">${easy ? '' : page.knobs.map(knobHtml).join('')}${(page.toggles || []).map(toggleHtml).join('')}`;
    if (page.id === 'src') html += `<div class="rig-toggle"><button class="hw hw-candy sm" data-color="blue" type="button" data-act="flip" aria-label="Cambiar de cámara">${icon('flip')}</button><span class="hw-print">GIRAR</span></div>`;
    html += '</div>';
    if (page.id === 'mod') html += `<div class="rig-keys"><button class="hw hw-keycap" type="button" data-act="sync"><span>A TEMPO</span></button><button class="hw hw-keycap" type="button" data-act="hands">${icon('hand')}<span>MANOS</span></button><button class="hw hw-keycap" type="button" data-act="unpatch"><span>QUITAR CABLES</span></button></div><div class="rig-routes" id="rigRoutes"></div>`;
    if (page.id === 'out') html += `<div class="rig-keys"><button class="hw hw-keycap" type="button" data-act="clean">${icon('full')}<span>PANTALLA COMPLETA</span></button><button class="hw hw-keycap" type="button" data-act="window">${svg('out')}<span>VENTANA EXTERNA</span></button><button class="hw hw-keycap" type="button" data-act="black"><span>NEGRO</span></button><button class="hw hw-keycap" type="button" data-act="unmidi"><span>OLVIDAR MIDI</span></button><button class="hw hw-keycap" type="button" data-act="factory"><span>FÁBRICA</span></button></div>
      <p class="rig-help"><b>Teléfono:</b> cable USB-C a HDMI y tecla SALIDA: la pantalla entera es la señal. <b>Computadora:</b> HDMI y VENTANA EXTERNA; doble clic para llenarla.</p>`;
    ui.panel.innerHTML = html;
    ui.ctl = {};
    ui.panel.querySelectorAll('[data-param]').forEach(node => { ui.ctl[node.dataset.param] = node; syncCtl(node.dataset.param); });
    ui.pills = [...ui.panel.querySelectorAll('[data-led]')];
    ui.rig.querySelectorAll('#rigTabs [data-page], #rigModos [data-page]').forEach(tab => { const on = tab.dataset.page === page.id; tab.classList.toggle('is-on', on); tab.setAttribute('aria-selected', String(on)); });
    syncPicks(); syncToggles(); syncKeys(); routesList(); syncJacks(); coach();
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
    ui.panel.querySelectorAll('.rig-pick').forEach(node => { node.querySelector('.hw-lcd b').textContent = optionsOf(node.dataset.pick)[optionIndex(node.dataset.pick)] || ''; });
  }
  function syncToggles() { if (ui.panel) ui.panel.querySelectorAll('[data-toggle]').forEach(node => node.setAttribute('aria-checked', String(!!getD(node.dataset.toggle)))); }
  function syncScenes() {
    ui.rig.querySelectorAll('#rigScenes [data-scene]').forEach(key => { const on = +key.dataset.scene === store.scene; key.classList.toggle('is-on', on); key.setAttribute('aria-checked', String(on)); key.title = store.scenes[+key.dataset.scene].name; const em = key.querySelector('em'); if (em && em.textContent !== key.title) em.textContent = key.title; });
  }
  function syncJacks() {
    ui.rig.querySelectorAll('.rig-jack').forEach(jack => {
      const key = jack.dataset.src;
      jack.classList.toggle('is-armed', ui.armed === key);
      jack.classList.toggle('is-used', live.r.some(r => r[0] === key));
      jack.classList.toggle('is-easy', link.state === 'on' && linkFresh() ? LIVE_KEYS.includes(key) : EASY_SOURCES.includes(key));
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
    if (ui.page === 'easy') { if (host.innerHTML) host.innerHTML = ''; return; }      // en FÁCIL las pastillas dicen qué mueve a qué
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
    if (ui.pills) for (const led of ui.pills) led.style.opacity = (.3 + .7 * Math.abs(mods[led.dataset.led])).toFixed(2);
    if (link.state !== 'off' && now - link.paintAt > 700) linkPaint();
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
    // El sonido, a la vista: de dónde entra, cuánto llega, y si no llega nada.
    // (con el enlace LIVE el sonido es el del master de Ableton, no el del micrófono)
    const liveOn = linkMaster(), heard = audio.on || liveOn;
    const chip = $('rigTallyAudio'), silent = !liveOn && audio.on && audio.quietFor > 4;
    const label = liveOn ? 'ABLETON' : !audio.on ? 'ESCUCHAR MÚSICA' : silent ? 'NO LLEGA SEÑAL' : audio.kind === 'system' ? 'COMPUTADORA' : audio.kind === 'custom' ? 'PRUEBA' : 'MIC';
    if (chip.firstChild.textContent !== label) chip.firstChild.textContent = label;
    chip.classList.toggle('is-off', !heard); chip.classList.toggle('is-silent', silent);
    chip.style.setProperty('--vu', (liveOn ? link.frame.m[0] : audio.level).toFixed(2));
    const wanted = live.r.some(r => r[0] === 'bass' || r[0] === 'mid' || r[0] === 'high' || r[0] === 'beat') || live.d['src.gen'] === 6 || live.d['src.gen'] === 7;
    $('rigMic').classList.toggle('is-asking', !heard && !audio.busy && wanted);
    $('rigTap').classList.toggle('is-beat', (ph.lfo[0] % 1) < .12 && !!live.d['lfo.sync']);
    $('rigMidi').classList.toggle('is-active', now - midi.seen < 120);
    if (!eng.ok) note(eng.error ? 'Este navegador no tiene WebGL 2: STAGE no puede dibujar aquí.' : '');
    else if (!camReady()) note(live.d['mix.mode'] === 5 ? 'SILUETA necesita la cámara para recortarte. Toca el monitor para activarla.' : live.d['src.gen'] && live.p['mix.fade'] > .5 ? '' : typeof cameraRequest !== 'undefined' && cameraRequest ? '' : 'Sin cámara: se ve un generador. Toca el monitor para activarla.');
    else if (audio.on && audio.quietFor > 4) note('No llega sonido. Sube la música o elige otra entrada en RITMO.');
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
      if (drag.armed) { if (step !== drag.step) { drag.step = step; feel.detent(event.clientX); } }
      else {
        // El tope (0 y 100) y el centro de las perillas que lo tienen suenan a tope, una vez.
        const v = live.p[drag.id], at = v <= 0 ? 'min' : v >= 1 ? 'max' : (P[drag.id][2] && v === .5 ? 'mid' : '');
        if (feel.edge('rig:' + drag.id, at, event.clientX)) drag.step = step;
        else if (step !== drag.step) { drag.step = step; feel.detent(event.clientX, v); }
      }
    });
    const release = event => {
      const drag = ui.drag;
      if (!drag) return;
      ui.drag = null;
      drag.node.classList.remove('is-held');
      // (la primera vez que se mueve algo en FÁCIL, la guía dice cómo guardarlo; en el TALLER la pantallita sigue diciendo el valor)
      if (drag.moved && !ui.toldKeep && ui.page === 'easy' && event.type !== 'pointercancel') { ui.toldKeep = true; coach('¿Te gusta cómo quedó? Mantén apretada una escena para guardarla ahí.', 5200); }
      if (drag.moved || event.type === 'pointercancel') return;
      const now = performance.now();
      if (drag.armed) {                                                   // toque con un cable en la mano: conecta o desconecta
        if (drag.had) setRoute(drag.armed, drag.id, 0); else setRoute(drag.armed, drag.id, .5);
        feel.tap(drag.had ? 'slide' : 'patch', 'down', event.clientX);
        readout(SRC[drag.armed].label + (drag.had ? ' SUELTA ' : ' > ') + P[drag.id][0], 1500);
      } else if (ui.lastTap.id === drag.id && now - ui.lastTap.t < 340) {
        setParam(drag.id, P[drag.id][1]);
        feel.edge('rig:' + drag.id, '');
        feel.tap('slide', 'down', event.clientX);
        readout(P[drag.id][0] + ' DE FÁBRICA', 1100);
      } else readout(P[drag.id][0] + ' ' + describe(drag.id, live.p[drag.id]), 1200);
      ui.lastTap = { t: now, id: drag.id };
    };
    ui.panel.addEventListener('input', event => {
      const range = event.target.closest('[data-cuanto]');
      if (!range) return;
      const id = range.dataset.cuanto, r = live.r.find(r => r[1] === id);
      if (!r) return;
      let amt = clamp(+range.value / 100, -1, 1);
      if (Math.abs(amt) < .04) amt = amt < 0 ? -.04 : .04;                 // en cero el cable se soltaría: para eso está QUITAR
      setRoute(r[0], id, amt);
      range.parentNode.querySelector('b').textContent = pctText(amt);
    });
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
        const id = stepper.closest('.rig-pick').dataset.pick, count = optionsOf(id).length;
        setD(id, (optionIndex(id) + +stepper.dataset.step + count) % count);
        syncPicks(); syncToggles();
        readout(optionsOf(id)[optionIndex(id)], 1100);
        return;
      }
      const toggle = event.target.closest('[data-toggle]');
      if (toggle) { setD(toggle.dataset.toggle, getD(toggle.dataset.toggle) ? 0 : 1); syncToggles(); return; }
      const unroute = event.target.closest('[data-unroute]');
      if (unroute) { const r = live.r[+unroute.dataset.unroute]; if (r) setRoute(r[0], r[1], 0); return; }
      const pill = event.target.closest('[data-pill]');
      if (pill) { ui.pick = ui.pick === pill.dataset.pill ? '' : pill.dataset.pill; renderPage(); const open = ui.panel.querySelector('.rig-tira.is-open'); if (open && open.scrollIntoView) open.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      const fuente = event.target.closest('[data-fuente]');
      if (fuente && ui.pick) {
        // una sola fuente por efecto en FÁCIL: la nueva ocupa el sitio de la anterior, con su misma fuerza
        const old = live.r.find(r => r[1] === ui.pick), src = fuente.dataset.fuente;
        if (old && old[0] === src) return;
        const amt = old ? old[2] : .5, at = old ? live.r.indexOf(old) : -1;
        if (old) live.r.splice(at, 1);
        setRoute(src, ui.pick, amt);
        const made = routeOf(src, ui.pick);
        if (made && at >= 0) { live.r.splice(live.r.indexOf(made), 1); live.r.splice(at, 0, made); }      // en el sitio de la anterior
        if ((src === 'bass' || src === 'mid' || src === 'high' || src === 'beat') && !audio.on && !audio.inject && !linkMaster()) flipToast('Toca ESCUCHAR MÚSICA para que siga el sonido.', 2600);
        renderPage();
        return;
      }
      const elige = event.target.closest('[data-elige]');
      if (elige && ui.pick) {
        const what = elige.dataset.elige, id = ui.pick, r = live.r.find(r => r[1] === id);
        if (what === 'quitar' && r) setRoute(r[0], id, 0);
        if (what === 'taller') { ui.page = ui.taller = pageOf(id); ui.pick = ''; renderPage(); const node = ui.ctl[id]; if (node) { node.classList.add('is-target'); setTimeout(() => node.classList.remove('is-target'), 1400); } return; }
        ui.pick = '';
        renderPage();
        return;
      }
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
    const pickPage = event => {
      const tab = event.target.closest('[data-page]');
      if (!tab) return;
      ui.page = tab.dataset.page;
      if (ui.page !== 'easy') ui.taller = ui.page;
      renderPage();
    };
    $('rigTabs').addEventListener('click', pickPage);
    $('rigModos').addEventListener('click', pickPage);
    $('rigTaller').addEventListener('click', () => { if (ui.page === 'easy') { ui.page = ui.taller; renderPage(); } });
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
    $('rigMic').addEventListener('click', () => (audio.on ? audioOff() : audioOn()));
    // «ESCUCHAR MÚSICA» sobre el monitor: lo mismo que MIC, donde se está mirando.
    const chip = $('rigTallyAudio');
    chip.addEventListener('pointerdown', event => event.stopPropagation());
    chip.addEventListener('click', event => { event.stopPropagation(); if (!audio.on && !audio.busy && !linkMaster()) { feel.tap('primary', 'down', event.clientX); audioOn(); } });
    chip.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chip.click(); } });
    $('rigMidi').addEventListener('click', () => { if (midi.state === 'off' || midi.state === 'denied' || midi.state === 'none') midiConnect(); else setLearn(!midi.learn); });
    $('rigLive').addEventListener('click', () => linkSheet(true));
    $('rigLiveClose').addEventListener('click', () => linkSheet(false));
    $('rigLiveGo').addEventListener('click', () => { if (linkOpen($('rigLiveUrl').value)) $('rigLiveUrl').value = ''; });
    $('rigLiveUrl').addEventListener('keydown', event => { if (event.key === 'Enter') $('rigLiveGo').click(); event.stopPropagation(); });
    $('rigLiveOff').addEventListener('click', () => linkClose(false));
    $('rigLiveSlots').addEventListener('change', event => {
      const select = event.target.closest('select[data-slot]');
      if (!select) return;
      const slots = store.global.live.slots, i = +select.dataset.slot;
      // una pista vive en una sola toma: la que la tenía queda libre
      if (select.value !== '-') for (let k = 0; k < 6; k++) if (k !== i && slots[k] === select.value) slots[k] = '-';
      slots[i] = select.value;
      for (let k = 0; k < 6; k++) if (slots[k] == null) slots[k] = '-';
      linkAssign(); save();
    });
    linkLabels();
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
      if (now - lastPadTap < 320) { recall((store.scene + 1) % SCENE_COUNT); feel.tap('slide', 'down', event.clientX); lastPadTap = 0; } else lastPadTap = now;
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
  // Teclado del ordenador (también llega desde la ventana de salida): 1–9 y 0 escenas, espacio tempo, B negro.
  function key(name) {
    if (/^[0-9]$/.test(name)) recall(name === '0' ? 9 : +name - 1);
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
    cancelFrame(mainFrame);
    pumpMain(); pumpOut(); wake(true);
    patched(); syncKeys(); lcd(true);
    linkFromHash();
    if (store.global.live.url && link.state === 'off') linkOpen(store.global.live.url, true);      // el enlace con Ableton vuelve solo
    if (!midi.access && navigator.permissions && navigator.requestMIDIAccess) {
      navigator.permissions.query({ name: 'midi' }).then(permission => { if (permission.state === 'granted' && state.active && !midi.access) midiConnect(); }).catch(() => {});
    }
  }
  function exit() {
    state.active = false;
    document.body.classList.remove('stage-mode');
    cancelFrame(mainFrame);
    recStop();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (out.win && !out.win.closed) { try { out.win.close(); } catch (_) {} }
    output.detach();
    audioOff(); handsOn(false); wake(false);
    linkClose(true); if (ui.rig) linkSheet(false);
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
      hasMask: eng.hasMask, page: ui.page, armed: ui.armed, routes: live.r.map(r => r.slice()), audio: { on: audio.on, kind: audio.kind, bpm: +audio.bpm.toFixed(1), level: +audio.level.toFixed(3), loud: +audio.loud.toFixed(1), beats: audio.beats, silent: audio.on && audio.quietFor > 4 }, beat: +clock.beat.toFixed(3), bpm: +bpmNow().toFixed(1), bpmSource: bpmSource(),
      midi: { state: midi.state, learn: midi.learn, target: midi.target, last: midi.last, knobs: midi.knobs.slice(), map: JSON.parse(JSON.stringify(store.midi)) },
      sync: { locked: coro.locked && bpmSource() === 'AUTO', bpm: coro.bpm, phase: +coro.phase.toFixed(3) },
      live: { state: link.state, fresh: linkFresh(), master: linkMaster(), tracks: link.tracks.map(t => t.name), keys: link.keys.slice(), names: LIVE_KEYS.map(key => SRC[key].label), demo: link.demo, host: link.host }, hands: { on: hands.on, seen: hands.seen }, out: { window: !!out.ctx, clean: state.clean }, rec: rec.on, black: ui.black, morphing: !!morph }),
    get: id => (id in P ? live.p[id] : getD(id)),
    value: id => val[id],
    mods: () => Object.assign({}, mods),
    set(id, v) { if (id in P) setParam(id, v); else { setD(id, v); if (ui.rig) { syncPicks(); syncToggles(); } } },
    route: setRoute, recall, keep, tap,
    page(id) { ui.page = id; renderPage(); },
    // Avanza cuadros a paso fijo (pruebas deterministas).
    step(count = 1, ms = 1000 / 60) { for (let i = 0; i < count; i++) frame(ms / 1000); },
    // Vuelve el reloj, las fases y el bucle a cero (pruebas: el mismo cuadro sale igual dos veces).
    rewind() {
      clock.t = 0; clock.beat = 0; ph.gen = ph.spin = ph.cycle = ph.roll = ph.warp = 0; ph.lfo[0] = ph.lfo[1] = 0;
      for (const memo of ph.rnd) Object.assign(memo, { cycle: -1, from: 0, to: 0 });
      audio.beat = 0; midi.hit = 0; morph = null; lazo.x = lazo.y = lazo.hue = 0; lazo.rim = 8; brush.at = null; brush.dir = [1, 0];
      if (eng.stats) eng.stats.fresh = true;
      if (!eng.ok) return;
      const gl = eng.gl;
      for (const b of eng.fb) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      eng.flip = 0;
    },
    // La salida entera, recién dibujada: { w, h, data } con los píxeles RGBA en base64 (fila de abajo primero).
    pixels() {
      if (!eng.ok) return null;
      const gl = eng.gl;
      draw(evaluate(), 0, clock.t);
      const data = new Uint8Array(eng.w * eng.h * 4);
      gl.readPixels(0, 0, eng.w, eng.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
      return { w: eng.w, h: eng.h, data: btoa(bin) };
    },
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
    audio: { inject(levels) { audio.inject = levels ? Object.assign({}, levels) : null; }, on: audioOn, off: audioOff,
      // Conecta una fuente propia al analizador (pruebas): recibe el AudioContext y devuelve un nodo.
      use(make) { audioOff(true); audioWire(make); audio.kind = 'custom'; syncKeys(); return audio.ctx; } },
    midi: { inject: (bytes, stamp) => midiIn(bytes, stamp === undefined ? performance.now() : stamp), connect: midiConnect, learn: setLearn },
    // direct: fuerza la subida directa del vídeo. inject: sustituye la cámara por unos planos dados (pruebas del sombreador).
    camera: { direct(on) { camState.forceDirect = !!on; eng.path = ''; eng.camSeq = -1; }, inject(planes) { camState.injected = planes || null; eng.camSeq = -1; eng.path = ''; eng.yuvKey = ''; } },
    reset() { linkClose(true); store = fresh(); adopt(store.scenes[0]); morph = null; patched(); linkLabels(); save(); },
    // LIVE: el enlace con Ableton por la señal de PITÁGORAS. inject() es la misma entrada que la red (pruebas y demos).
    live: { connect: linkOpen, disconnect: () => linkClose(false), sheet: linkSheet, keys: LIVE_KEYS,
      inject(message) { if (message && message.set) linkSet(message.set); else linkTake(message); },
      assign(slot, name) { const slots = store.global.live.slots; for (let k = 0; k < 6; k++) if (slots[k] == null) slots[k] = ''; if (name) for (let k = 0; k < 6; k++) if (k !== slot && slots[k] === name) slots[k] = '-'; slots[slot] = name || '-'; linkAssign(); save(); } },
    // (LOOKS y VARIANTS se leen de CAM_FAMILIES en el momento: valen las familias que se registren después)
    tables: { PARAMS: P, SOURCES: SOURCES.map(s => s[0]), PAGES: PAGES.map(p => p.id), GENS, MIX_MODES, FB_MODES, PALETTES: PALETTES.map(p => p[0]), FACTORY: FACTORY().map(s => s.name),
      get LOOKS() { return looks().map(l => l.key); }, variants: family => variantsOf(family).map(v => v.id) },
  };
})();
// La ventana de salida llega a la consola por window.opener.
window.flipStage = flipStage;
