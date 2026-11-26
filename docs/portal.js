// PORTAL · ventanas que se abren con las manos.
//
// La cámara se ve tal cual. Con las dos manos en «L» (pulgar e índice) se dibuja un marco: sus
// lados siguen a los dedos y dentro la imagen sale con la cámara elegida (DSi, DLPHN, STAMP —solo
// su trama—, ASCII, las que siguen al sonido…). Con una mano, la ventana es la esquina que
// dibujan su pulgar y su índice.
//
// Las ventanas se pueden FIJAR: tocando el pulgar con el anular (un clic, con el índice aún
// abierto), con la tecla FIJAR o tocando el visor. Cada portal fijado conserva su figura, su sitio
// y su estilo; se elige otro estilo y se fija otro, y así se compone un vitral. Un portal fijado
// se mueve arrastrándolo (con dos dedos se escala y se gira), cambia de estilo al tocar otra
// cámara y se borra con su aspa o con BORRAR.
//
// Para que vaya pegado a los dedos:
//   · el dibujo es WebGL a la cadencia de la pantalla; en Android la cámara entra por sus planos
//     nativos (sensor.js) y el sombreador la pasa a color;
//   · cada mano tiene un estimador (filtro 1€ + velocidad) que adelanta su posición lo que tardó
//     la inferencia, y entre dos detecciones el movimiento se interpola a cada cuadro;
//   · el rastreador arranca con el delegado de CPU (igual en todos los dispositivos) y prueba el
//     de GPU en paralelo: si coincide con el de CPU y es más rápido, se queda con él.
// Vive sobre CAM: usa su visor, su bandeja, su disparador y su grabación; foto y vídeo son lo que se ve.
const flipPortal = (() => {
  'use strict';
  const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/+esm';
  const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const INPUT = 480;          // lado largo de la imagen que ve el rastreador: a 256 una mano a un metro eran 18 píxeles de palma
  const AWAKE_MS = 1500;      // sin manos este tiempo, el rastreador pasa a mirar de vez en cuando
  const IDLE_EVERY = 160;     // …cada tantos ms (con manos delante va tan deprisa como puede)
  const CAL_EVERY = 250;      // la calibración del delegado de GPU compara como mucho cuatro cuadros por segundo
  const BASE_LONG = 480;      // lado largo del lienzo pequeño del que beben el rastreador y los estilos
  const FX_LONG = 960;        // lado largo de cada estilo dentro de su ventana
  const LOST_MS = 300;        // sin detección este tiempo, una mano deja de existir
  const MIN_AREA = 0.004;     // fracción del cuadro a partir de la cual la ventana existe
  const MAX_PANES = 8;
  const WRIST = 0, THUMB_MCP = 2, THUMB = 4, INDEX_MCP = 5, INDEX = 8, MIDDLE_MCP = 9, MIDDLE = 12, RING = 16;
  const TAU = Math.PI * 2;
  const ANDROID = /Android/i.test(navigator.userAgent);
  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const feel = (kind, phase, x) => { if (window.flipFeel) flipFeel.tap(kind, phase, x); };

  const state = {
    active: false, lastT: 0,
    base: null, bctx: null, baseAt: -Infinity, baseShot: 0, bases: [], baseHead: -1, styleBase: null,
    delay: 0, shownAt: 0,         // cuánto va la imagen por detrás del reloj, y de cuándo es el cuadro en pantalla
    hands: [],                    // manos vivas en píxeles, en el instante del cuadro que se ve
    shape: null, amount: 0, opened: -Infinity,
    mode: '', slots: null, lensAfter: 0,
    trail: [],                    // figuras recientes: al fijar se toma la de justo antes del clic
    wait: false,                  // tras fijar, la ventana viva espera a que se suelte el clic
    lockedAt: -Infinity, pinched: false,
    look: '', audioReady: false, shown: null, fxError: '', hintLock: 0,
  };

  // ── Rastreador de manos ───────────────────────────────────────────────────
  const trk = { phase: 'idle', message: '', error: '', loading: null, provider: null, main: null, cand: null, strikes: 0, ms: 0, frames: 0,
    input: null, ictx: null, cal: null, score: null, delegate: '', raw: [], rawAt: -Infinity, sentShot: 0 };
  const CHOICE = 'flip.hands.delegate';
  const chrome = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || '';
  function remembered() { try { const v = JSON.parse(localStorage.getItem(CHOICE) || 'null'); return v && v.v === chrome ? v.d : ''; } catch (_) { return ''; } }
  function remember(d) { try { localStorage.setItem(CHOICE, JSON.stringify({ d, v: chrome })); } catch (_) {} }
  function spawn(delegate) {
    return new Promise(resolve => {
      let worker;
      try { worker = new Worker('./hands-worker.js'); } catch (error) { resolve({ error: String(error) }); return; }
      const rec = { worker, delegate, busy: false, sentAt: 0, timer: 0, ms: 0, dead: false };
      let ready = false;
      const give = message => { clearTimeout(boot); rec.dead = true; try { worker.terminate(); } catch (_) {} resolve({ error: message }); };
      const boot = setTimeout(() => give('tiempo de carga agotado'), 45000);
      worker.onmessage = event => {
        const msg = event.data || {};
        if (msg.type === 'ready') { ready = true; clearTimeout(boot); resolve(rec); }
        else if (msg.type === 'hands') onHands(rec, msg);
        else if (msg.type === 'error') { if (ready) onFault(rec, msg.message); else give(msg.message); }
      };
      worker.onerror = event => { if (ready) onFault(rec, event.message); else give(event.message || 'error del worker'); };
      worker.postMessage({ type: 'init', lib: LIB, wasm: WASM, model: MODEL, delegate });
    });
  }
  function kill(rec) {
    if (!rec || rec.dead) return;
    rec.dead = true; rec.busy = false;
    clearTimeout(rec.timer);
    try { rec.worker.postMessage({ type: 'close' }); } catch (_) {}
    setTimeout(() => { try { rec.worker.terminate(); } catch (_) {} }, 300);
  }
  function stop(keepHands) {
    kill(trk.main); kill(trk.cand);
    trk.main = trk.cand = null; trk.cal = null; trk.score = null;
    if (trk.phase !== 'failed') trk.phase = 'idle';
    if (!keepHands) { tracks.length = 0; trk.raw = []; }
  }
  function start() {
    if (trk.phase === 'ready') return Promise.resolve(true);
    // Se salió mientras cargaba y se vuelve antes de que termine: esa misma carga sirve, y hay que
    // volver a esperarla. (Sin esto, al terminar se descartaba y PORTAL se quedaba sin rastreador y sin aviso.)
    if (trk.loading) { if (trk.phase !== 'failed') { trk.phase = 'loading'; trk.message = 'Cargando el seguimiento de manos…'; } return trk.loading; }
    if (trk.provider) { trk.phase = 'ready'; return Promise.resolve(true); }
    trk.phase = 'loading';
    trk.message = 'Cargando el seguimiento de manos…';
    const known = remembered(), first = known === 'GPU' ? 'GPU' : 'CPU';
    trk.loading = (async () => {
      let rec = await spawn(first);
      if (rec.error && first === 'GPU') { remember('CPU'); rec = await spawn('CPU'); }      // la GPU dejó de servir
      if (rec.error) {
        trk.phase = 'failed'; trk.error = rec.error;
        trk.message = navigator.onLine === false ? 'El seguimiento de manos necesita conexión la primera vez.' : 'No se pudo cargar el seguimiento de manos. Toca el visor para reintentar.';
        return false;
      }
      if (trk.phase !== 'loading') { kill(rec); return false; }                              // se salió mientras cargaba
      trk.main = rec; trk.delegate = rec.delegate; trk.phase = 'ready'; trk.message = ''; trk.strikes = 0;
      // Sin veredicto para este dispositivo: el delegado de GPU se prueba en paralelo, sin estorbar.
      if (!known && rec.delegate === 'CPU') spawn('GPU').then(cand => {
        if (cand.error) { remember('CPU'); return; }
        if (trk.main !== rec || trk.phase !== 'ready') { kill(cand); return; }
        trk.cand = cand; trk.score = { ok: 0, bad: 0, ms: [] }; trk.cal = null;
      });
      return true;
    })();
    trk.loading.finally(() => { trk.loading = null; });
    return trk.loading;
  }
  function send(rec, canvas, id) {
    const scale = INPUT / Math.max(canvas.width, canvas.height);
    const w = Math.max(16, Math.round(canvas.width * scale)), h = Math.max(16, Math.round(canvas.height * scale));
    if (!trk.input) { trk.input = new OffscreenCanvas(w, h); trk.ictx = trk.input.getContext('2d'); }
    if (trk.input.width !== w || trk.input.height !== h) { trk.input.width = w; trk.input.height = h; }
    trk.ictx.drawImage(canvas, 0, 0, w, h);
    const bitmap = trk.input.transferToImageBitmap();
    rec.busy = true; rec.sentAt = performance.now(); rec.id = id;
    // De cuándo es la imagen (no cuándo se envía): de ahí sale cuánto hay que adelantar la mano al dibujarla.
    rec.shotAt = canvas === state.base && state.baseShot ? state.baseShot : rec.sentAt;
    clearTimeout(rec.timer);
    rec.timer = setTimeout(() => { rec.busy = false; onFault(rec, 'sin respuesta'); }, 4000);
    rec.worker.postMessage({ type: 'frame', id, bitmap }, [bitmap]);
  }
  let frameId = 0;
  // ¿Hay manos (o las hubo hace un momento)? Con ellas el rastreador no para; sin ellas, descansa.
  const awake = now => now - trk.rawAt < AWAKE_MS;
  function push(canvas) {
    if (trk.phase !== 'ready' || !canvas || !canvas.width) return;
    const now = performance.now();
    if (trk.provider) {
      // (Pruebas) Con `lag`, el rastreador simulado contesta como uno de verdad: con las manos de hace `lag` ms.
      if (canvas === state.base) trk.sentShot = state.baseShot;
      const shot = now - (trk.providerLag || 0);
      accept(dedupe(trk.provider(shot) || []), 0, shot);
      return;
    }
    const main = trk.main;
    if (!main || main.busy) return;
    if (now - main.sentAt < (awake(now) ? 31 : IDLE_EVERY)) return;          // con manos, 30 por segundo como mucho; sin ellas, de vez en cuando
    const id = ++frameId;
    send(main, canvas, id);
    if (canvas === state.base) trk.sentShot = state.baseShot;
    // Calibración: el mismo cuadro va también al candidato, para comparar sus manos con las de referencia.
    // Solo cuando hay manos que comparar, y sin doblar el trabajo en cada cuadro.
    if (trk.cand && !trk.cand.busy && !trk.cal && trk.raw.length && now - (trk.calAt || 0) >= CAL_EVERY) { trk.calAt = now; trk.cal = { id, main: null, cand: null, ms: 0 }; send(trk.cand, canvas, id); }
  }
  // El modelo a veces da la misma mano dos veces.
  function dedupe(hands) {
    const out = [];
    for (const hand of hands) if (!out.some(o => Math.hypot(o[0] - hand[0], o[1] - hand[1]) + Math.hypot(o[18] - hand[18], o[19] - hand[19]) < 0.08)) out.push(hand);
    return out.slice(0, 2);
  }
  function onHands(rec, msg) {
    if (rec.dead) return;
    clearTimeout(rec.timer);
    rec.busy = false; rec.ms = msg.ms;
    const hands = dedupe(msg.hands.map(hand => { hand.points.meta = hand.meta || null; return hand.points; }));
    if (rec === trk.main) {
      accept(hands, msg.ms, rec.shotAt);
      if (trk.cal && trk.cal.id === msg.id) { trk.cal.main = hands; judge(); }
      // Con manos delante, el cuadro siguiente sale ya, sin esperar al próximo dibujo, y lo más fresco posible.
      if (hands.length && state.active) {
        const t = performance.now();
        if (t - rec.sentAt >= 31) {
          if (t - state.baseAt > 12) refreshBase(null, t);
          if (state.base && state.baseShot > trk.sentShot) push(state.base);
        }
      }
    } else if (rec === trk.cand) {
      if (trk.cal && trk.cal.id === msg.id) { trk.cal.cand = hands; trk.cal.ms = msg.ms; judge(); } else trk.cal = null;
    }
  }
  // ¿El delegado de GPU ve lo mismo que el de CPU? Solo cuentan los cuadros en que hay manos.
  function judge() {
    const cal = trk.cal, score = trk.score;
    if (!cal || !cal.main || !cal.cand || !score) return;
    trk.cal = null;
    if (!cal.main.length) return;
    let same = cal.cand.length === cal.main.length;
    if (same) for (const hand of cal.main) {
      let best = Infinity;
      for (const other of cal.cand) { let d = 0; for (let i = 0; i < 42; i += 2) d += Math.hypot(hand[i] - other[i], hand[i + 1] - other[i + 1]); best = Math.min(best, d / 21); }
      if (best > 0.04) same = false;
    }
    if (same) { score.ok++; score.ms.push(cal.ms); } else score.bad++;
    if (score.bad >= 4) { kill(trk.cand); trk.cand = null; trk.score = null; remember('CPU'); return; }
    if (score.ok < 6) return;
    const typical = score.ms.slice().sort((a, b) => a - b)[score.ms.length >> 1];
    if (typical < (trk.main.ms || 40) * 0.75) { const old = trk.main; trk.main = trk.cand; trk.delegate = 'GPU'; kill(old); remember('GPU'); }
    else { kill(trk.cand); remember('CPU'); }
    trk.cand = null; trk.score = null;
  }
  function onFault(rec, reason) {
    if (rec.dead) return;
    trk.error = String(reason || '');
    if (rec === trk.cand) { kill(rec); trk.cand = null; trk.score = null; trk.cal = null; remember('CPU'); return; }
    if (rec !== trk.main || ++trk.strikes < 3) return;
    kill(rec); trk.main = null;
    if (rec.delegate === 'GPU') { remember('CPU'); trk.phase = 'idle'; trk.strikes = 0; start(); return; }   // la GPU falló en uso
    trk.phase = 'failed';
    trk.message = 'El seguimiento de manos dejó de responder. Toca el visor para reintentar.';
  }

  // ── Imagen sincronizada con el seguimiento ────────────────────────────────
  // El rastreador tarda: cuando dice dónde está una mano, la mano ya no está ahí. Adivinar dónde
  // estará no sirve con dedos (medido con vídeo real: no mejora al último dato). Lo que sí: enseñar
  // la cámara un instante por detrás —lo que tarda el rastreador— y colocar cada mano interpolando
  // entre las dos detecciones que rodean al cuadro que se ve. La figura queda cosida a las yemas.
  const SYNC_MIN = 60, SYNC_MAX = 240;
  // El clic de anular y pulgar fija la figura de este tiempo antes del cuadro en que se vio (ms):
  // la que había antes de que los dedos empezaran a moverse para tocarse.
  const PRE_CLICK = 230;
  // Fijar dejando el marco quieto: si las esquinas no se apartan más de DWELL_TOL (del lado corto del
  // visor) de donde estaban, a los DWELL_WAIT ms empieza a llenarse un anillo y DWELL_FILL después el
  // portal queda fijado. (Con manos de verdad, sostener el marco lo mueve un 2 %; moverlo sin más, del 10 al 40.)
  const DWELL_WAIT = 300, DWELL_FILL = 800, DWELL_TOL = 0.03;
  // La forma de la ventana. Las cuatro yemas marcan siempre la figura; la forma dice qué se dibuja con ellas.
  const FORMS = ['quad', 'round', 'tri'], FORM_NAMES = { quad: 'cuadro', round: 'círculo', tri: 'triángulo' };
  let form = 'quad';
  try { const saved = localStorage.getItem('flip.portal.form'); if (FORMS.includes(saved)) form = saved; } catch (_) {}
  const sync = { delay: 120, want: 120, latency: 70, period: 60, lastShot: 0, lastT: 0 };
  function syncFeed(shot, now, seen) {
    // Solo cuentan las detecciones con manos: sin ellas el rastreador va despacio a propósito.
    if (seen && shot > sync.lastShot) {
      const period = shot - sync.lastShot;
      if (period < 400) sync.period += (period - sync.period) * 0.15;
      sync.latency += (clamp(now - shot, 0, 400) - sync.latency) * 0.15;
      // Lo justo: lo que tarda la detección más algo más de medio periodo (el resto lo cubre la pequeña prolongación).
      sync.want = clamp(sync.latency + sync.period * 0.6 + 8, SYNC_MIN, SYNC_MAX);
    }
    if (shot > sync.lastShot) sync.lastShot = shot;
  }
  function syncStep(now) {
    // El retraso se mueve despacio (60 ms por segundo): un cambio brusco sería un salto en la imagen.
    const dt = Math.min(100, Math.max(0, now - (sync.lastT || now)));
    sync.lastT = now;
    sync.delay += clamp(sync.want - sync.delay, -dt * 0.06, dt * 0.06);
    return gfx.ok ? sync.delay : 0;                     // sin WebGL no hay cola de cuadros: se dibuja el último
  }

  // ── Estimador de cada mano ────────────────────────────────────────────────
  // Filtro 1€ por coordenada, ligero: quita el temblor de la detección sin retrasarla. Cada mano
  // guarda sus últimas posiciones con su hora; al dibujar se interpola en la hora del cuadro visible.
  const est = { minCutoff: 3, beta: 30, dCutoff: 5 };
  const HISTORY = 20;
  const tracks = [];
  const alpha = (dt, cutoff) => 1 / (1 + 1 / (TAU * cutoff * dt));
  function accept(hands, ms, capturedAt) {
    const now = performance.now(), t = capturedAt / 1000;
    syncFeed(capturedAt, now, hands.length > 0);
    trk.raw = hands; trk.rawAt = hands.length ? now : trk.rawAt;
    trk.ms = ms; trk.frames++; trk.strikes = 0;
    const free = tracks.slice(), next = [];
    const gap = (track, points) => Math.hypot(track.raw[0] - points[0], track.raw[1] - points[1]) + Math.hypot(track.raw[18] - points[18], track.raw[19] - points[19]);
    // Dos manos y dos pistas: el emparejamiento que menos las mueve (no se cruzan aunque se acerquen).
    let plan = null;
    if (hands.length === 2 && free.length === 2) plan = gap(free[0], hands[0]) + gap(free[1], hands[1]) <= gap(free[0], hands[1]) + gap(free[1], hands[0]) ? [free[0], free[1]] : [free[1], free[0]];
    for (let index = 0; index < hands.length; index++) {
      const points = hands[index];
      let best = plan ? plan[index] : null, bestD = 1.2;                    // una mano no aparece de la nada si otra acaba de irse: es la misma, que se movió
      if (!plan) for (const track of free) { const d = gap(track, points); if (d < bestD) { bestD = d; best = track; } }
      if (best) {
        free.splice(free.indexOf(best), 1);
        const dt = t - best.at;
        if (dt <= 0 || dt > 0.35) { best.x.set(points); best.v.fill(0); best.hist.length = 0; }
        else for (let i = 0; i < 42; i++) {
          best.v[i] += alpha(dt, est.dCutoff) * ((points[i] - best.raw[i]) / dt - best.v[i]);
          best.x[i] += alpha(dt, est.minCutoff + est.beta * Math.abs(best.v[i])) * (points[i] - best.x[i]);
        }
        best.raw.set(points); best.at = t; best.seen = now;
        best.hist.push({ t, x: best.x.slice() });
        if (best.hist.length > HISTORY) best.hist.shift();
        touch(best, points, now);
        next.push(best);
      } else next.push({ x: Float32Array.from(points), raw: Float32Array.from(points), v: new Float32Array(42), px: new Float32Array(42), hist: [{ t, x: Float32Array.from(points) }], at: t, seen: now, born: now, pinch: false, hits: 0, near: false });
    }
    // Una mano que falta en una detección no se borra aún: la imagen va por detrás y todavía tiene que verse irse.
    const keep = Math.max(LOST_MS, sync.delay + 220);
    for (const track of free) if (now - track.seen < keep && next.length < 2) { track.pinch = false; track.hits = 0; next.push(track); }
    tracks.length = 0;
    for (const track of next) tracks.push(track);
  }
  // Las manos en el instante `at` (ms, el del cuadro que se ve): interpoladas entre las dos
  // detecciones que lo rodean. Si la siguiente aún no ha llegado, siguen 40 ms por donde iban y esperan.
  function pose(at, w, h) {
    const out = [], td = at / 1000;
    const grace = Math.max(0.12, sync.period * 0.0016);
    for (const track of tracks) {
      const hist = track.hist, n = hist.length;
      if (!n || td < hist[0].t - 0.02 || td > hist[n - 1].t + grace) continue;     // aún no había aparecido, o ya se fue
      let i = n - 1;
      while (i > 0 && hist[i - 1].t > td) i--;
      const b = hist[i], a = hist[i > 0 ? i - 1 : 0], span = b.t - a.t;
      const f = span > 0 ? clamp((td - a.t) / span, 0, 1 + 0.04 / Math.max(0.02, span)) : 1;
      for (let k = 0; k < 42; k += 2) {
        track.px[k] = (a.x[k] + (b.x[k] - a.x[k]) * f) * w;
        track.px[k + 1] = (a.x[k + 1] + (b.x[k + 1] - a.x[k + 1]) * f) * h;
      }
      out.push(track.px);
    }
    return out;
  }
  // El clic: la yema del anular toca la del pulgar con el índice todavía abierto. Se mide en 3D
  // (metros, del modelo de la mano): en 2D dos yemas coinciden por perspectiva sin tocarse. Tiene
  // que venir de abierto y durar dos detecciones: una pose que ya llega cerrada no cuenta.
  // El clic: la yema del anular (o la del medio) toca la del pulgar, con el índice estirado. Se
  // decide en la imagen, en tamaños de mano (muñeca–nudillo del medio): al tocarse, las dos yemas
  // coinciden. La distancia en 3D que estima el modelo no sirve para decidirlo: medido con manos de
  // verdad en un teléfono, con los dedos tocándose marca 6 cm y da el índice por pegado al pulgar.
  // Solo se usa de freno, para descartar dos yemas que coinciden en la imagen estando lejos en fondo.
  const CLICK_NEAR = 0.45, CLICK_FAR = 0.55, CLICK_DEEP = 0.9, CLICK_REST = 350;
  function touch(track, points, now) {
    const W = state.w || 1, H = state.h || 1, far = (a, b) => Math.hypot((points[2 * a] - points[2 * b]) * W, (points[2 * a + 1] - points[2 * b + 1]) * H);
    const size = far(WRIST, MIDDLE_MCP) || 1;
    const viaMiddle = far(MIDDLE, THUMB) < far(RING, THUMB);
    const flat = (viaMiddle ? far(MIDDLE, THUMB) : far(RING, THUMB)) / size;   // el dedo que toca: el más cercano de los dos
    const span = far(INDEX, THUMB) / size, reach = far(INDEX, WRIST) / size;
    // El mismo dedo en 3D, en palmas (sin 3D en las pruebas; un worker antiguo no manda el medio: vale el anular).
    const deep = points.meta ? (viaMiddle && points.meta.length > 4 ? points.meta[4] : points.meta[0]) / (points.meta[3] || 0.094) : 0;
    const near = flat < CLICK_NEAR && deep < CLICK_DEEP;
    // Índice estirado (no es un puño) y el pulgar junto al dedo que toca, no junto al índice (no es la pinza que cierra la L).
    const open = reach > 1.3 && span > Math.max(0.35, flat * 1.3);
    track.flat = flat; track.span = span; track.reach = reach; track.deep = deep; track.open = open; track.via = viaMiddle ? 'medio' : 'anular';   // (se enseñan en status())
    // ¿Toca? Con histéresis, para que el ruido no lo encienda y lo apague.
    const wasNear = !!track.near;
    track.near = wasNear ? flat < CLICK_FAR : near;
    if (!track.near) { if (wasNear || !track.awaySince) track.awaySince = now; track.pinch = false; track.hits = 0; return; }
    if (!wasNear) track.nearAt = now;                                         // empieza un acercamiento
    if (track.pinch) return;
    if (!open) { track.hits = 0; return; }
    track.hits = (track.hits || 0) + 1;
    if (track.hits < 2) return;
    track.pinch = true;
    // Un clic es un acercamiento nuevo: la mano llevaba un rato sin tocar (no nace ya en pinza ni rebota).
    // No depende de lo separados que cada cual tenga los dedos en reposo.
    if (track.nearAt - (track.awaySince || track.born) >= CLICK_REST && now - track.born > 300) { trk.clickAt = now; trk.clickShot = track.at * 1000; }   // cuándo se vio, y de cuándo era la imagen
  }

  // ── El marco recuerda a sus dos manos ─────────────────────────────────────
  // Al abrir mucho el marco, una mano se sale del cuadro o el rastreador la pierde un instante.
  // El marco no se convierte entonces en la ventana de una sola mano: la que falta se queda donde
  // estaba y, si se fue por un lado, su borde llega hasta ese lado y espera a que vuelva.
  const EDGE = 0.2, HOLD_FLICKER = 1100, HOLD_EDGE = 9000, HOLD_BOTH = 2500, HOLD_GONE = 160, DRIFT = 0.26;
  const centerX = hand => (hand[2 * THUMB] + hand[2 * INDEX]) / 2;
  const centerY = hand => (hand[2 * THUMB + 1] + hand[2 * INDEX + 1]) / 2;
  function frameHands(w, h, dt, now) {
    const live = state.hands;
    if (live.length >= 2) {
      const pair = live.slice(0, 2).sort((a, b) => centerX(a) - centerX(b));
      state.slots = pair.map(hand => ({ pts: Float32Array.from(hand), lostAt: 0, edge: 0 }));
      state.mode = 'quad';
      return pair;
    }
    if (state.mode !== 'quad' || !state.slots) {
      if (state.mode === 'closing' && state.amount > 0.04) return [];       // el marco termina de cerrarse antes
      // Tras un marco, la mano que queda suele estar yéndose: se le da un momento antes de abrirle ventana.
      if (live.length === 1 && now < state.lensAfter) { state.mode = ''; state.slots = null; return []; }
      state.mode = live.length === 1 ? 'corner' : '';
      state.slots = null;
      return live;
    }
    const slots = state.slots;
    let seen = -1;
    if (live.length === 1) {
      const hand = live[0];
      const far = slot => Math.hypot(centerX(hand) - centerX(slot.pts), centerY(hand) - centerY(slot.pts));
      seen = far(slots[0]) <= far(slots[1]) ? 0 : 1;
      slots[seen] = { pts: Float32Array.from(hand), lostAt: 0, edge: 0 };
    }
    const ease = 1 - Math.exp(-dt / 110);
    let holding = true;
    for (let i = 0; i < 2; i++) {
      if (i === seen) continue;
      const slot = slots[i];
      if (!slot.lostAt) {
        slot.lostAt = now;
        slot.refY = seen >= 0 ? centerY(slots[seen].pts) : null;
        const x = centerX(slot.pts) / w;
        slot.edge = i === 0 && x < EDGE ? -1 : i === 1 && x > 1 - EDGE ? 1 : 0;   // cada mano solo se va por su lado
      }
      if (slot.edge) {                                                       // toda la mano se desliza hasta el borde
        const tip = slot.edge < 0 ? Math.min(slot.pts[2 * THUMB], slot.pts[2 * INDEX]) : Math.max(slot.pts[2 * THUMB], slot.pts[2 * INDEX]);
        const shift = ((slot.edge < 0 ? 0 : w) - tip) * ease;
        for (let k = 0; k < 42; k += 2) slot.pts[k] += shift;
      }
      const patience = seen >= 0 ? (slot.edge ? HOLD_EDGE : HOLD_FLICKER) : (slots[0].edge && slots[1].edge ? HOLD_BOTH : HOLD_GONE);
      if (now - slot.lostAt >= patience) holding = false;
      // La mano que queda se va (la bajan, la suben): el marco no se estira tras ella, se cierra.
      if (seen >= 0 && slot.refY != null && Math.abs(centerY(slots[seen].pts) - slot.refY) > h * DRIFT) holding = false;
    }
    if (holding) return [slots[0].pts, slots[1].pts];
    state.lensAfter = now + 1200;
    state.mode = 'closing';
    state.slots = null;
    return [];
  }

  // ── La figura ─────────────────────────────────────────────────────────────
  // Cada mano hace una «L»: un dedo apunta hacia dentro (hacia la otra mano) y el otro marca la
  // altura. El lado de la ventana junto a esa mano va de la yema interior a ese mismo punto
  // desplazado lo que el otro dedo se separa de él en perpendicular: si la L se cierra (una
  // pinza), el lado se queda sin altura y la ventana se cierra sola.
  function side(hand, toward) {
    const cx = (hand[2 * THUMB_MCP] + hand[2 * INDEX_MCP]) / 2, cy = (hand[2 * THUMB_MCP + 1] + hand[2 * INDEX_MCP + 1]) / 2;
    let ix = hand[2 * THUMB], iy = hand[2 * THUMB + 1], ox = hand[2 * INDEX], oy = hand[2 * INDEX + 1];
    if (toward && (ox - cx) * toward[0] + (oy - cy) * toward[1] > (ix - cx) * toward[0] + (iy - cy) * toward[1]) { const sx = ix, sy = iy; ix = ox; iy = oy; ox = sx; oy = sy; }
    const ux = ix - cx, uy = iy - cy, len2 = ux * ux + uy * uy || 1;
    const k = ((ox - cx) * ux + (oy - cy) * uy) / len2;
    const fx = cx + ux * k, fy = cy + uy * k;                                // pie del dedo exterior sobre el interior
    return { cx, cy, inner: [ix, iy], outer: [ox, oy], foot: [fx, fy], far: [ix + ox - fx, iy + oy - fy] };
  }
  const areaOf = pts => { let a = 0; for (let i = 0, n = pts.length / 2; i < n; i++) { const j = (i + 1) % n; a += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1]; } return a / 2; };
  function shapeFrom(hands, w, h) {
    let pts, kind;
    if (hands.length >= 2) {
      const pair = hands.slice(0, 2).sort((a, b) => centerX(a) - centerX(b));
      const ca = [(pair[0][2 * THUMB_MCP] + pair[0][2 * INDEX_MCP]) / 2, (pair[0][2 * THUMB_MCP + 1] + pair[0][2 * INDEX_MCP + 1]) / 2];
      const cb = [(pair[1][2 * THUMB_MCP] + pair[1][2 * INDEX_MCP]) / 2, (pair[1][2 * THUMB_MCP + 1] + pair[1][2 * INDEX_MCP + 1]) / 2];
      // Las cuatro yemas son las cuatro esquinas: índice y pulgar de la mano izquierda, pulgar e índice
      // de la derecha. Cada lado de la ventana es la pinza de una mano: si se cierra, ese lado se queda
      // en punta; si una mano gira, la figura se cruza. Sin reordenar: la figura no salta al cruzarse.
      const A = pair[0], B = pair[1];
      pts = [A[2 * INDEX], A[2 * INDEX + 1], B[2 * INDEX], B[2 * INDEX + 1], B[2 * THUMB], B[2 * THUMB + 1], A[2 * THUMB], A[2 * THUMB + 1]];
      kind = 'quad';
      // Lo abierta que está: la media de las dos pinzas por lo separadas que están las manos. (El área
      // de una figura cruzada se anula; esto no.)
      const sa = Math.hypot(pts[0] - pts[6], pts[1] - pts[7]), sb = Math.hypot(pts[2] - pts[4], pts[3] - pts[5]);
      const gap = Math.hypot((pts[0] + pts[6] - pts[2] - pts[4]) / 2, (pts[1] + pts[7] - pts[3] - pts[5]) / 2);
      let qx = 0, qy = 0;
      for (let i = 0; i < 8; i += 2) { qx += pts[i] / 4; qy += pts[i + 1] / 4; }
      return { kind, pts, area: (sa + sb) / 2 * gap / (w * h), cx: qx, cy: qy };
    } else if (hands.length === 1) {
      const s = side(hands[0], null);
      pts = [s.foot[0], s.foot[1], s.outer[0], s.outer[1], s.far[0], s.far[1], s.inner[0], s.inner[1]];
      kind = 'corner';
    } else return null;
    let cx = 0, cy = 0;
    for (let i = 0; i < 8; i += 2) { cx += pts[i] / 4; cy += pts[i + 1] / 4; }
    return { kind, pts, area: Math.abs(areaOf(pts)) / (w * h), cx, cy };
  }
  // Polígono con las esquinas redondeadas y crecido desde su centro (la apertura).
  function outline(pts, grow, radius) {
    const n = pts.length / 2, out = [];
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += pts[2 * i] / n; cy += pts[2 * i + 1] / n; }
    const at = i => [cx + (pts[2 * ((i + n) % n)] - cx) * grow, cy + (pts[2 * ((i + n) % n) + 1] - cy) * grow];
    for (let i = 0; i < n; i++) {
      const p = at(i), a = at(i - 1), b = at(i + 1);
      const la = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1, lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
      const r = Math.min(radius, la * 0.3, lb * 0.3);
      const p0 = [p[0] + (a[0] - p[0]) / la * r, p[1] + (a[1] - p[1]) / la * r], p1 = [p[0] + (b[0] - p[0]) / lb * r, p[1] + (b[1] - p[1]) / lb * r];
      for (let s = 0; s <= 5; s++) { const t = s / 5, u = 1 - t; out.push(u * u * p0[0] + 2 * u * t * p[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * p[1] + t * t * p1[1]); }
    }
    return out;
  }
  // El contorno de una figura según su forma: el cuadro tal cual (esquinas en las yemas), el óvalo que
  // pasa por el centro de sus cuatro lados, o el triángulo con la punta entre los dos índices y la
  // base en los pulgares.
  function ringOf(pts, shape, grow, radius) {
    if (shape === 'round') {
      const cx = (pts[0] + pts[2] + pts[4] + pts[6]) / 4, cy = (pts[1] + pts[3] + pts[5] + pts[7]) / 4;
      const ux = (pts[2] + pts[4] - pts[0] - pts[6]) / 4, uy = (pts[3] + pts[5] - pts[1] - pts[7]) / 4;   // del lado izquierdo al derecho
      const vx = (pts[4] + pts[6] - pts[0] - pts[2]) / 4, vy = (pts[5] + pts[7] - pts[1] - pts[3]) / 4;   // del lado de los índices al de los pulgares
      const out = [];
      for (let i = 0; i < 56; i++) { const a = i / 56 * TAU, c = Math.cos(a) * grow, k = Math.sin(a) * grow; out.push(cx + ux * c + vx * k, cy + uy * c + vy * k); }
      return out;
    }
    if (shape === 'tri') return outline([(pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2, pts[4], pts[5], pts[6], pts[7]], grow, radius);
    return outline(pts, grow, radius);
  }
  const inside = (pts, x, y) => { let hit = false; for (let i = 0, n = pts.length / 2, j = n - 1; i < n; j = i++) { const xi = pts[2 * i], yi = pts[2 * i + 1], xj = pts[2 * j], yj = pts[2 * j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit; } return hit; };

  // ── Estilos ───────────────────────────────────────────────────────────────
  const EXTRA = {
    ASCII: { label: 'ASCII', hint: 'Dentro de la ventana, la imagen en caracteres.' },
    SONO: { label: 'SONO', hint: 'Dentro de la ventana, anillos que siguen el sonido.', audio: true },
    WMP: { label: 'WMP', hint: 'Dentro de la ventana, el espectro del sonido.', audio: true },
  };
  function ensureAudio() {
    if (state.audioReady || typeof _buildExtAudioChain !== 'function') return;
    state.audioReady = true;
    Promise.resolve(_buildExtAudioChain()).catch(() => { state.audioReady = false; flipToast('Sin micrófono no hay reacción al sonido.'); });
  }
  const currentStyle = () => (state.look ? { key: state.look, extra: state.look } : { key: camFamily + ':' + camVariant, family: camFamily, variant: camVariant });
  const styleName = style => (style.extra ? EXTRA[style.extra].label : ((CAM_FAMILIES[style.family].displayLabel || CAM_FAMILIES[style.family].label) + ''));
  const cadenceOf = style => (style.extra ? (style.extra === 'ASCII' ? 20 : 30) : ((typeof cameraCadence === 'object' && cameraCadence[style.family]) || 24));
  // Cada estilo en uso tiene su lienzo y su textura; se pintan por turnos, el que más toca primero.
  const pool = new Map();
  function styleEntry(style, w, h) {
    let entry = pool.get(style.key);
    if (!entry) {
      const canvas = document.createElement('canvas');
      entry = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }), tex: null, at: -Infinity, used: 0, dirty: false, drawn: false };
      pool.set(style.key, entry);
    }
    if (entry.canvas.width !== w || entry.canvas.height !== h) { entry.canvas.width = w; entry.canvas.height = h; entry.at = -Infinity; entry.drawn = false; }
    return entry;
  }
  function paintStyle(entry, style, now) {
    const base = state.styleBase || state.base, w = entry.canvas.width, h = entry.canvas.height, ctx = entry.ctx;
    if (style.extra === 'ASCII') FLIP_STEP_ENGINES.ascii.renderStep(base, ctx, { cols: 72 }, null, now);
    else if (style.extra === 'SONO') _editRenderSonoSource(ctx, w, h, now);
    else if (style.extra === 'WMP') _editRenderWmpSource(ctx, w, h, now);
    else {
      // Del sello de PRINT entra la trama, no el marco.
      const frame = typeof stampFrameMode === 'string' ? stampFrameMode : null;
      const sello = typeof _esSello === 'function' && _esSello(style.family, style.variant);
      if (frame !== null && sello) stampFrameMode = 'OFF';
      try { _renderCamEngineFrame(base, base.width, base.height, ctx, false, { path: 'capture', now, outW: w, outH: h, resolution: 'medium', family: style.family, variant: style.variant }); }
      finally { if (frame !== null && sello) stampFrameMode = frame; }
    }
    entry.at = now; entry.dirty = true; entry.drawn = true;
  }
  function feedStyles(needed, now, w, h) {
    const scale = Math.min(1, FX_LONG / Math.max(w, h));
    const fw = Math.max(2, Math.round(w * scale)), fh = Math.max(2, Math.round(h * scale));
    const began = performance.now();
    for (let round = 0; round < 2; round++) {
      let pick = null, late = 1;
      for (const style of needed) {
        const entry = styleEntry(style, fw, fh);
        entry.used = now;
        const due = (now - entry.at) / (1000 / cadenceOf(style));
        if (due >= late) { late = due; pick = [entry, style]; }
      }
      if (!pick) break;
      try { paintStyle(pick[0], pick[1], now); state.fxError = ''; }
      catch (error) {
        // Un estilo que falla no puede parar la cámara: su ventana enseña la imagen sin tratar y se avisa una vez.
        const message = String(error && error.message || error);
        if (state.fxError !== message) { state.fxError = message; console.warn('[PORTAL] estilo', pick[1].key, message); flipToast('Esta cámara no pudo dibujarse dentro de la ventana.'); }
        pick[0].ctx.drawImage(state.styleBase || state.base, 0, 0, fw, fh); pick[0].at = now; pick[0].dirty = true; pick[0].drawn = true;
      }
      if (performance.now() - began > 5) break;                               // el segundo, solo si sobra tiempo
    }
    for (const [key, entry] of pool) if (now - entry.used > 4000) { if (entry.tex && gfx.gl) gfx.gl.deleteTexture(entry.tex); pool.delete(key); }
  }

  // ── Portales fijados ──────────────────────────────────────────────────────
  // Cada uno: su figura en fracciones del cuadro, su estilo y cuándo nació (para el destello).
  const panes = [];
  let selected = -1, paneId = 0;
  function lockLive(how) {
    const now = performance.now();
    if (now - state.lockedAt < 500) return false;
    // La figura de un instante antes: acercar el anular al pulgar mueve la esquina que marca el pulgar.
    // Se toma la que había PRE_CLICK ms antes del cuadro en que el rastreador vio el clic, contando en
    // la hora de las imágenes (el visor va por detrás del reloj, y el rastreador, por detrás del visor).
    let shot = null;
    if (how === 'clic') {
      const cut = (trk.clickShot || now) - PRE_CLICK;
      for (const past of state.trail) if (past.shown <= cut) shot = past;
      if (!shot && state.trail.length) shot = state.trail[0];                 // la figura es más reciente que eso: la primera que hubo
    }
    if (!shot) shot = state.shape && state.amount > 0.5 ? { pts: state.shape.pts.slice(), w: state.w, h: state.h } : null;
    if (!shot) { hint('Haz primero una figura con las manos', 1800); return false; }
    if (panes.length >= MAX_PANES) { flipToast('Caben ' + MAX_PANES + ' portales. Borra alguno para fijar otro.'); return false; }
    const pts = new Float32Array(8);
    for (let i = 0; i < 8; i += 2) { pts[i] = shot.pts[i] / shot.w; pts[i + 1] = shot.pts[i + 1] / shot.h; }
    panes.push({ id: ++paneId, pts, style: currentStyle(), form, at: now });
    state.lockedAt = now; state.wait = true; state.amount = 0; state.shape = null; state.trail.length = 0;
    select(-1);
    feel('switch', 'down');
    hint(panes.length === 1 ? 'Portal fijado. Elige otra cámara y fija el siguiente.' : 'Portal ' + panes.length + ' fijado', 2200);
    syncBar();
    return true;
  }
  function removePane(index) {
    if (index < 0 || index >= panes.length) return;
    panes.splice(index, 1);
    select(-1);
    syncBar();
  }
  function select(index) {
    selected = index >= 0 && index < panes.length ? index : -1;
    if (selected >= 0) {
      // Su estilo pasa a ser el elegido: desde ahí, tocar otra cámara lo cambia.
      const style = panes[selected].style;
      if (style.extra) setLook(style.extra);
      else {
        if (state.look) setLook('');
        if (camFamily !== style.family) _setCamFamily(style.family);
        if (camVariant !== style.variant) { camVariant = style.variant; _applyCamState(); }
      }
      form = FORMS.includes(panes[selected].form) ? panes[selected].form : 'quad';   // y su forma, la del selector
      hint('Arrástralo para moverlo · toca otra cámara o la forma para cambiarlo', 2600);
    }
    syncBar();
  }
  // El selector de forma: cambia la de la ventana viva y la del portal elegido.
  function setForm(next) {
    form = FORMS.includes(next) ? next : FORMS[(FORMS.indexOf(form) + 1) % FORMS.length];
    try { localStorage.setItem('flip.portal.form', form); } catch (_) {}
    if (selected >= 0 && panes[selected]) panes[selected].form = form;
    still.ref = null; still.progress = 0;
    syncBar();
    hint('Forma: ' + FORM_NAMES[form], 1400);
    return form;
  }
  // Quieto: el anillo se llena mientras la figura no se mueve; al completarse, el portal queda fijado.
  const still = { on: true, ref: null, since: 0, progress: 0, spent: null };
  function dwell(shape, w, h, now) {
    const unit = Math.min(w, h), pts = shape.pts;
    const apart = ref => { let most = 0; for (let i = 0; i < 8; i += 2) most = Math.max(most, Math.hypot(pts[i] - ref[i], pts[i + 1] - ref[i + 1])); return most / unit; };
    // Con la figura a medio abrir, en pleno clic, con un portal elegido o con una mano recordada (no vista), no cuenta.
    const live = still.on && state.amount > 0.9 && !state.pinched && selected < 0 && panes.length < MAX_PANES
      && state.hands.length >= (shape.kind === 'quad' ? 2 : 1) && !(state.slots && state.slots.some(slot => slot.lostAt));
    // Tras fijar hay que mover el marco para volver a armarlo: no fija dos veces en el mismo sitio.
    if (still.spent && live) { if (apart(still.spent) > DWELL_TOL * 2) still.spent = null; }
    if (!live || still.spent) { still.ref = null; still.progress = 0; return; }
    if (!still.ref || apart(still.ref) > DWELL_TOL) { still.ref = Float32Array.from(pts); still.since = now; still.progress = 0; return; }
    still.progress = clamp((now - still.since - DWELL_WAIT) / DWELL_FILL);
    if (still.progress >= 1) { still.spent = Float32Array.from(pts); still.ref = null; still.progress = 0; lockLive('quieto'); }
  }
  function movePane(pane, dx, dy) {
    let cx = 0, cy = 0;
    for (let i = 0; i < 8; i += 2) { cx += pane.pts[i] / 4; cy += pane.pts[i + 1] / 4; }
    dx = clamp(cx + dx, 0.02, 0.98) - cx; dy = clamp(cy + dy, 0.02, 0.98) - cy;
    for (let i = 0; i < 8; i += 2) { pane.pts[i] += dx; pane.pts[i + 1] += dy; }
  }

  // ── Dibujo en WebGL ───────────────────────────────────────────────────────
  const VERT_FULL = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
  const FRAG_CAM = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uA, uU, uV;
uniform vec4 uFit; uniform float uMirror; uniform int uKind; uniform mat3 uYuv; uniform vec3 uYuvOff;
void main() {
  vec2 c = vec2(vUv.x, 1. - vUv.y);
  c.x = mix(c.x, 1. - c.x, uMirror);
  c = c * uFit.xy + uFit.zw;
  vec3 rgb;
  if (uKind == 0) rgb = texture(uA, c).rgb;
  else if (uKind == 3) rgb = texture(uA, c).bgr;
  else { vec2 ch = uKind == 1 ? vec2(texture(uU, c).r, texture(uV, c).r) : texture(uU, c).rg; rgb = clamp(uYuv * (vec3(texture(uA, c).r, ch) - uYuvOff), 0., 1.); }
  o = vec4(rgb, 1.);
}`;
  const FRAG_FX = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uFx;
void main() { o = vec4(texture(uFx, vec2(vUv.x, 1. - vUv.y)).rgb, 1.); }`;
  const VERT_FLAT = `#version 300 es
layout(location = 0) in vec2 aPos; uniform vec2 uSize;
void main() { vec2 p = aPos / uSize; gl_Position = vec4(p.x * 2. - 1., 1. - p.y * 2., 0., 1.); }`;
  const FRAG_FLAT = `#version 300 es
precision highp float;
uniform vec4 uColor; out vec4 o;
void main() { o = uColor; }`;
  const gfx = { canvas: null, gl: null, ok: false, tried: false, ring: [], head: -1, span: 10, every: 33, lastUp: -Infinity, lastAsk: -Infinity, seq: -1, fit: [1, 1, 0, 0], yuv: null, yuvOff: [0, .5, .5], yuvKey: '', path: '', hasCam: false, dirty: true, hooked: false, direct: false };
  function program(vert, frag) {
    const gl = gfx.gl;
    const make = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'sombreador'); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, make(gl.VERTEX_SHADER, vert)); gl.attachShader(pr, make(gl.FRAGMENT_SHADER, frag)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || 'enlace');
    const where = {};
    return { pr, at: name => (name in where ? where[name] : (where[name] = gl.getUniformLocation(pr, name))) };
  }
  function texture() {
    const gl = gfx.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return t;
  }
  function initGl() {
    if (gfx.tried) return gfx.ok;
    gfx.tried = true;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: false, stencil: true, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'default' });
      if (!gl) return false;
      gfx.canvas = canvas; gfx.gl = gl;
      gfx.cam = program(VERT_FULL, FRAG_CAM); gfx.fx = program(VERT_FULL, FRAG_FX); gfx.flat = program(VERT_FLAT, FRAG_FLAT);
      gfx.vaoFull = gl.createVertexArray();
      gfx.vaoFlat = gl.createVertexArray();
      gl.bindVertexArray(gfx.vaoFlat);
      gfx.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, gfx.vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gfx.ring = []; gfx.head = -1; gfx.lastUp = -Infinity; gfx.seq = -1; gfx.hasCam = false;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.disable(gl.DEPTH_TEST);
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); gfx.ok = false; });
      canvas.addEventListener('webglcontextrestored', () => { gfx.tried = false; gfx.gl = null; pool.forEach(entry => { entry.tex = null; entry.dirty = true; }); });
      gfx.ok = true;
    } catch (error) { gfx.ok = false; gfx.error = String(error && error.message || error); }
    return gfx.ok;
  }
  function plane(slot, name, format, internal, w, h, data, offset, rowLength) {
    const gl = gfx.gl, key = internal + ':' + w + 'x' + h;
    if (!slot[name]) slot[name] = texture();
    gl.bindTexture(gl.TEXTURE_2D, slot[name]);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, rowLength);
    if (slot.alloc[name] !== key) { slot.alloc[name] = key; gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, data, offset); }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, gl.UNSIGNED_BYTE, data, offset);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  }
  function cover(sw, sh, w, h) {
    const sa = sw / sh, oa = w / h, sx = sa > oa ? oa / sa : 1, sy = sa > oa ? 1 : sa / oa;
    gfx.fit = [sx, sy, .5 - .5 * sx, .5 - .5 * sy];
  }
  // La cola: los últimos cuadros de la cámara, cada uno en su textura y con su hora. Tantos como
  // hagan falta para cubrir el retraso máximo a la cadencia a la que llegan (entre 4 y 16).
  function nextSlot(shot) {
    const gl = gfx.gl;
    if (gfx.lastUp > -Infinity) gfx.every += (clamp(shot - gfx.lastUp, 8, 100) - gfx.every) * 0.1;
    gfx.lastUp = shot;
    gfx.span = clamp(Math.ceil((SYNC_MAX + 50) / gfx.every) + 1, 4, 16);
    while (gfx.ring.length > gfx.span) { const old = gfx.ring.pop(); if (old) for (const name of ['A', 'U', 'V']) if (old[name]) gl.deleteTexture(old[name]); }
    gfx.head = (gfx.head + 1) % gfx.span;
    let slot = gfx.ring[gfx.head];
    if (!slot) slot = gfx.ring[gfx.head] = { A: null, U: null, V: null, alloc: {}, shot: -Infinity, kind: 0, src: [1, 1], yuv: null, yuvOff: null, mirror: false };
    // Cada cuadro guarda el espejo de la cámara que lo tomó: al cambiar de cámara, los de la anterior no se voltean.
    slot.shot = shot; slot.mirror = state.mirror;
    return slot;
  }
  // El cuadro que toca enseñar en el instante `at`: el más reciente que no sea posterior.
  function slotAt(at) {
    let best = null, oldest = null;
    for (const slot of gfx.ring) {
      if (!slot || slot.shot === -Infinity) continue;
      if (slot.shot <= at && (!best || slot.shot > best.shot)) best = slot;
      if (!oldest || slot.shot < oldest.shot) oldest = slot;
    }
    return best || oldest;
  }
  function uploadCamera(now) {
    const gl = gfx.gl;
    if (!vid.videoWidth || vid.readyState < 2) return;
    if (ANDROID && !gfx.direct && flipSensor.planesUsable(vid)) {
      // Un cuadro cada 28 ms como mucho: con la cámara a 60 no se copia ni se sube el doble para lo mismo.
      if (now - gfx.lastAsk >= 28) { gfx.lastAsk = now; flipSensor.planes(vid); }
      const pl = flipSensor.latestPlanes(vid);
      if (pl) {
        if (pl.seq !== gfx.seq) {
          gfx.seq = pl.seq;
          const slot = nextSlot(pl.at);
          const L = pl.layout, pw = pl.width, ph = pl.height, cw = (pw + 1) >> 1, ch = (ph + 1) >> 1;
          if (pl.kind === 'planar') {
            plane(slot, 'A', gl.RED, gl.R8, pw, ph, pl.data, L[0].offset, L[0].stride);
            plane(slot, 'U', gl.RED, gl.R8, cw, ch, pl.data, L[1].offset, L[1].stride);
            plane(slot, 'V', gl.RED, gl.R8, cw, ch, pl.data, L[2].offset, L[2].stride);
            slot.kind = 1;
          } else if (pl.kind === 'biplanar') {
            plane(slot, 'A', gl.RED, gl.R8, pw, ph, pl.data, L[0].offset, L[0].stride);
            plane(slot, 'U', gl.RG, gl.RG8, cw, ch, pl.data, L[1].offset, L[1].stride >> 1);
            slot.kind = 2;
          } else {
            plane(slot, 'A', gl.RGBA, gl.RGBA8, pw, ph, pl.data, L[0].offset, L[0].stride >> 2);
            slot.kind = pl.kind === 'bgr' ? 3 : 0;
          }
          const key = pl.matrix + ':' + pl.fullRange;
          if (key !== gfx.yuvKey) {
            gfx.yuvKey = key;
            const k = flipSensor.coefficients(pl.matrix, pl.fullRange);
            gfx.yuv = new Float32Array([k.scale, k.scale, k.scale, 0, k.gu, k.bu, k.rv, k.gv, 0]);
            gfx.yuvOff = [k.offset, .5, .5];
          }
          slot.yuv = gfx.yuv; slot.yuvOff = gfx.yuvOff; slot.src = [pw, ph];
          gfx.path = 'planos ' + pl.format;
        }
        gfx.hasCam = true;
        return;
      }
      if (gfx.path.startsWith('planos')) return;                              // el siguiente está en camino
    }
    if (!gfx.hooked && vid.requestVideoFrameCallback) {
      gfx.hooked = true;
      const loop = () => { gfx.dirty = true; if (state.active) vid.requestVideoFrameCallback(loop); else gfx.hooked = false; };
      vid.requestVideoFrameCallback(loop);
    }
    // Cuadro nuevo de la cámara (y no más de uno cada 24 ms, para que la cola cubra un cuarto de segundo).
    if ((gfx.dirty || !gfx.hooked || gfx.path !== 'directa') && (now - gfx.lastUp >= 24 || gfx.path !== 'directa')) {
      gfx.dirty = false;
      const slot = nextSlot(now);
      if (!slot.A) slot.A = texture();
      gl.bindTexture(gl.TEXTURE_2D, slot.A);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid);
      slot.alloc.A = ''; slot.kind = 0; slot.yuv = null; slot.src = [vid.videoWidth, vid.videoHeight];
    }
    gfx.path = 'directa'; gfx.hasCam = true;
  }
  function flat(points, mode, color, w, h) {
    const gl = gfx.gl, pr = gfx.flat;
    gl.useProgram(pr.pr);
    gl.bindVertexArray(gfx.vaoFlat);
    gl.bindBuffer(gl.ARRAY_BUFFER, gfx.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, points, gl.DYNAMIC_DRAW);
    gl.uniform2f(pr.at('uSize'), w, h);
    gl.uniform4f(pr.at('uColor'), color[0], color[1], color[2], color[3]);
    gl.drawArrays(mode, 0, points.length / 2);
  }
  function stripOf(ring, half) {
    const n = ring.length / 2, out = new Float32Array((n + 1) * 4);
    for (let i = 0; i <= n; i++) {
      const p = i % n, a = (p - 1 + n) % n, b = (p + 1) % n;
      const tx = ring[2 * b] - ring[2 * a], ty = ring[2 * b + 1] - ring[2 * a + 1], len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len * half, ny = tx / len * half;
      out[4 * i] = ring[2 * p] + nx; out[4 * i + 1] = ring[2 * p + 1] + ny; out[4 * i + 2] = ring[2 * p] - nx; out[4 * i + 3] = ring[2 * p + 1] - ny;
    }
    return out;
  }
  // Una ventana: su estilo recortado a la figura (plantilla de paridad: vale para cualquier polígono) y su filo de luz.
  function drawWindow(ring, entry, w, h, look) {
    const gl = gfx.gl, n = ring.length / 2;
    if (entry && entry.drawn) {
      if (!entry.tex) { entry.tex = texture(); entry.dirty = true; }
      if (entry.dirty) { entry.dirty = false; gl.bindTexture(gl.TEXTURE_2D, entry.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.canvas); }
      const fan = new Float32Array((n + 2) * 2);
      let cx = 0, cy = 0;
      for (let i = 0; i < n; i++) { cx += ring[2 * i] / n; cy += ring[2 * i + 1] / n; }
      fan[0] = cx; fan[1] = cy; fan.set(ring, 2); fan[2 * n + 2] = ring[0]; fan[2 * n + 3] = ring[1];
      gl.enable(gl.STENCIL_TEST);
      gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      flat(fan, gl.TRIANGLE_FAN, [0, 0, 0, 0], w, h);
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.NOTEQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.useProgram(gfx.fx.pr);
      gl.bindVertexArray(gfx.vaoFull);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      gl.uniform1i(gfx.fx.at('uFx'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (look.burst > 0) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        flat(new Float32Array([0, 0, w, 0, w, h, 0, h]), gl.TRIANGLE_FAN, [1, 1, 1, look.burst * .35], w, h);
        gl.disable(gl.BLEND);
      }
      gl.disable(gl.STENCIL_TEST);
    }
    const unit = Math.min(w, h) / 100, half = unit * look.width * .5, c = look.color;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (look.glow > 0) {
      flat(stripOf(ring, half * (4 + look.burst * 6)), gl.TRIANGLE_STRIP, [c[0], c[1], c[2], .13 * look.glow], w, h);
      flat(stripOf(ring, half * 2.2), gl.TRIANGLE_STRIP, [c[0], c[1], c[2], .3 * look.glow], w, h);
    }
    flat(stripOf(ring, half * (1 + look.burst)), gl.TRIANGLE_STRIP, [c[0], c[1], c[2], look.alpha], w, h);
    gl.disable(gl.BLEND);
  }
  function windowsFor(now, w, h) {
    const list = [], unit = Math.min(w, h) / 100;
    panes.forEach((pane, index) => {
      const px = new Float32Array(8);
      for (let i = 0; i < 8; i += 2) { px[i] = pane.pts[i] * w; px[i + 1] = pane.pts[i + 1] * h; }
      const burst = Math.max(0, 1 - (now - pane.at) / 420), chosen = index === selected;
      list.push({ ring: new Float32Array(ringOf(px, pane.form, 1, unit * 1.6)), style: pane.style,
        look: chosen ? { color: [.93, .36, .27], alpha: .95, width: .62 + .12 * Math.sin(now / 160), glow: 1, burst } : { color: [1, 1, 1], alpha: .7, width: .3, glow: 0, burst } });
    });
    if (state.shape && state.amount > 0.01) {
      const grow = 1 - Math.pow(1 - state.amount, 3), burst = Math.max(0, 1 - (now - state.opened) / 420);
      list.push({ ring: new Float32Array(ringOf(state.shape.pts, form, grow, unit * 1.6)), style: currentStyle(), look: { color: [1, 1, 1], alpha: .92, width: .44, glow: 1, burst } });
    }
    return list;
  }
  function drawGl(ctx, now, w, h, list, slot) {
    const gl = gfx.gl, canvas = gfx.canvas;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    if (slot && slot.A) {
      const pr = gfx.cam;
      cover(slot.src[0], slot.src[1], w, h);
      gl.useProgram(pr.pr);
      gl.bindVertexArray(gfx.vaoFull);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, slot.A);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, slot.U || slot.A);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, slot.V || slot.U || slot.A);
      gl.uniform1i(pr.at('uA'), 0); gl.uniform1i(pr.at('uU'), 1); gl.uniform1i(pr.at('uV'), 2);
      gl.uniform4f(pr.at('uFit'), gfx.fit[0], gfx.fit[1], gfx.fit[2], gfx.fit[3]);
      gl.uniform1f(pr.at('uMirror'), slot.mirror ? 1 : 0);
      gl.uniform1i(pr.at('uKind'), slot.kind);
      if (slot.yuv) { gl.uniformMatrix3fv(pr.at('uYuv'), false, slot.yuv); gl.uniform3f(pr.at('uYuvOff'), slot.yuvOff[0], slot.yuvOff[1], slot.yuvOff[2]); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    for (const item of list) drawWindow(item.ring, pool.get(item.style.key), w, h, item.look);
    ctx.drawImage(canvas, 0, 0, w, h);
  }
  // Sin WebGL 2: lo mismo en 2D, a la mitad de cadencia.
  function draw2d(ctx, cam, w, h, list) {
    const [sx, sy, sw, sh] = cropCoordsForDims(cam.srcW, cam.srcH, w, h);
    ctx.save();
    if (state.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(cam.source, sx, sy, sw, sh, 0, 0, w, h);
    ctx.restore();
    const unit = Math.min(w, h) / 100;
    for (const item of list) {
      const trace = () => { ctx.beginPath(); for (let i = 0; i < item.ring.length; i += 2) { if (i) ctx.lineTo(item.ring[i], item.ring[i + 1]); else ctx.moveTo(item.ring[i], item.ring[i + 1]); } ctx.closePath(); };
      const entry = pool.get(item.style.key);
      if (entry && entry.drawn) { ctx.save(); trace(); ctx.clip(); ctx.drawImage(entry.canvas, 0, 0, w, h); ctx.restore(); }
      trace();
      ctx.strokeStyle = 'rgba(' + item.look.color.map(v => Math.round(v * 255)).join(',') + ',' + item.look.alpha + ')';
      ctx.lineWidth = unit * item.look.width * (1 + item.look.burst);
      ctx.stroke();
    }
  }

  // ── Cuadro ────────────────────────────────────────────────────────────────
  const BASES = 8;
  function ensure(w, h) {
    const scale = BASE_LONG / Math.max(w, h);
    const bw = Math.max(2, Math.round(w * scale / 2) * 2), bh = Math.max(2, Math.round(h * scale / 2) * 2);
    if (state.bw !== bw || state.bh !== bh) {
      state.bw = bw; state.bh = bh;
      for (const slot of state.bases.splice(0)) if (slot) { slot.canvas.width = slot.canvas.height = 0; }
      state.baseHead = -1; state.base = null; state.styleBase = null; state.baseAt = -Infinity; state.baseShot = 0;
      if (typeof _resetCamEngineState === 'function') _resetCamEngineState('capture');
    }
    state.w = w; state.h = h;
  }
  // El lienzo pequeño: la cámara recortada al formato del visor y, si es la frontal, en espejo. Hay
  // una cola de ellos, cada uno con su hora: el rastreador mira el último; los estilos, el del
  // instante que se está enseñando.
  function refreshBase(cam, now) {
    if (!state.bw) return false;
    // En Android leer el vídeo con drawImage cuesta 20–30 ms: se usa el lector rápido, que va un
    // cuadro por detrás (y se anota de cuándo es). En el resto, el vídeo tal cual, que es de ahora.
    let source = vid, sw = vid.videoWidth, sh = vid.videoHeight, shot = now;
    if (ANDROID && flipSensor.usable(vid)) {
      if (!flipSensor.pending(vid)) flipSensor.prime(vid);
      const fast = flipSensor.current(vid, 160);
      if (fast) {
        if (fast.at <= state.baseShot && state.baseAt > -Infinity) return false;   // es el mismo cuadro que ya se envió
        source = fast.canvas; sw = fast.width; sh = fast.height; shot = fast.at;
      }
      else if (state.baseAt > -Infinity || !cam) return false;                 // aún no llega el cuadro rápido: sigue valiendo el anterior
      else { source = cam.source; sw = cam.srcW; sh = cam.srcH; }
    }
    if (!sw || !sh) return false;
    state.baseHead = (state.baseHead + 1) % BASES;
    let slot = state.bases[state.baseHead];
    if (!slot) {
      const canvas = document.createElement('canvas');
      canvas.width = state.bw; canvas.height = state.bh;
      slot = state.bases[state.baseHead] = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }), shot: 0 };
    }
    const b = slot.ctx, bw = state.bw, bh = state.bh;
    const [sx, sy, cw, ch] = cropCoordsForDims(sw, sh, bw, bh);
    b.setTransform(1, 0, 0, 1, 0, 0);
    if (state.mirror) { b.translate(bw, 0); b.scale(-1, 1); }
    b.drawImage(source, sx, sy, cw, ch, 0, 0, bw, bh);
    b.setTransform(1, 0, 0, 1, 0, 0);
    slot.shot = shot;
    state.base = slot.canvas; state.bctx = b; state.baseAt = now; state.baseShot = shot;
    return true;
  }
  function baseFor(at) {
    let best = null, oldest = null;
    for (const slot of state.bases) {
      if (!slot || !slot.shot) continue;
      if (slot.shot <= at && (!best || slot.shot > best.shot)) best = slot;
      if (!oldest || slot.shot < oldest.shot) oldest = slot;
    }
    return (best || oldest || { canvas: state.base }).canvas;
  }
  // `force`: quien pinta encima del visor después (las pegatinas de CAM) necesita el cuadro limpio en cada vuelta.
  function render(cam, ctx, now, force) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ensure(w, h);
    const dt = Math.min(100, Math.max(1, now - (state.lastT || now)));
    state.lastT = now;
    state.mirror = typeof facingMode === 'string' && facingMode === 'user';
    const fast = initGl();
    // 0 · La cámara: el cuadro nuevo entra en la cola y se elige el que toca enseñar (el de hace `delay` ms).
    state.delay = syncStep(now);
    let slot = null;
    if (fast) { uploadCamera(now); slot = slotAt(now - state.delay); }
    // Sin cola de cuadros (sin WebGL, o con su contexto perdido al volver de segundo plano) se enseña
    // la cámara de ahora con la última detección: la mano va algo por detrás, pero no parpadea. Si el
    // rastreador calla un cuarto de segundo, se da por ida.
    state.shownAt = slot ? slot.shot : Math.max(sync.lastShot, now - 250);
    // 1 · Manos: un cuadro pequeño al rastreador (a 30 por segundo como mucho) y su posición en el cuadro que se ve.
    // Sin manos, sin ventana y sin portales fijados, el cuadro pequeño solo se renueva cuando el rastreador va a mirar.
    const needed = awake(now) || state.shape || panes.length;
    if (now - state.baseAt >= (needed ? 30 : IDLE_EVERY)) refreshBase(cam, now);
    if (state.base && state.baseShot > trk.sentShot) push(state.base);       // el rastreador recibe cada cuadro una sola vez
    state.styleBase = state.bases.length ? baseFor(state.shownAt) : state.base;
    state.hands = pose(state.shownAt, w, h);
    state.pinched = tracks.some(track => track.pinch);
    const click = (trk.clickAt || 0) > (state.clickSeen || 0);
    if (click) state.clickSeen = trk.clickAt;
    // 2 · La ventana viva.
    if (state.wait && !state.pinched && now - state.lockedAt > 350) state.wait = false;
    if (state.wait) { state.shape = null; state.amount = 0; still.ref = null; still.progress = 0; }
    else {
      const shape = shapeFrom(frameHands(w, h, dt, now), w, h);
      if (shape && shape.area > MIN_AREA) {
        if (state.amount < 0.02) state.opened = now;
        // De una mano a dos (o al revés): la ventana se reabre con su destello, no salta.
        if (state.shape && state.shape.kind !== shape.kind && state.amount > 0.4) { state.amount = 0.4; state.opened = now; }
        state.shape = shape;
        state.amount += (1 - state.amount) * (1 - Math.exp(-dt / 70));
        // El rastro: cada figura con la hora de la imagen sobre la que se dibujó (seis décimas, también a 120 por segundo).
        state.trail.push({ pts: shape.pts.slice(), w, h, at: now, shown: state.shownAt });
        while (state.trail.length > 96 || (state.trail.length && now - state.trail[0].at > 600)) state.trail.shift();
        if (click && state.amount > 0.6) lockLive('clic');
        else dwell(shape, w, h, now);
      } else {
        state.amount += (0 - state.amount) * (1 - Math.exp(-dt / 90));
        if (state.amount < 0.01) { state.amount = 0; state.shape = null; state.trail.length = 0; }
        still.ref = null; still.progress = 0;
      }
    }
    // El portal elegido sigue al estilo que se toque en la bandeja.
    if (selected >= 0 && panes[selected] && currentStyle().key !== panes[selected].style.key) panes[selected].style = currentStyle();
    // 3 · Estilos en uso, por turnos.
    const list = windowsFor(now, w, h);
    if (list.length && state.baseAt > -Infinity) feedStyles(list.map(item => item.style).filter((style, i, all) => all.findIndex(o => o.key === style.key) === i), now, w, h);
    // 4 · A pantalla, solo si algo cambió: el cuadro de cámara que se enseña, la figura, un estilo
    // recién pintado o una animación en marcha. La pantalla refresca a 60 o 120; la cámara, a 30.
    let stamp = (slot ? slot.shot : 0) + '|' + state.amount.toFixed(3) + '|' + list.length + '|' + (selected >= 0 ? selected + '@' + now : '') + '|' + (state.mirror ? 1 : 0) + '|' + w + 'x' + h;
    for (const item of list) {
      const entry = pool.get(item.style.key);
      let sum = 0;
      for (let i = 0; i < item.ring.length; i++) sum += item.ring[i] * (1 + (i & 7));
      stamp += '|' + item.style.key + (entry && entry.dirty ? '*' + entry.at : '') + (item.look && item.look.burst > 0.002 ? '!' + now : '') + sum.toFixed(1);
    }
    if (!fast || force || stamp !== state.stamp || ctx !== state.stampCtx) {
      state.stamp = stamp; state.stampCtx = ctx; state.draws = (state.draws || 0) + 1;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      if (fast) drawGl(ctx, now, w, h, list, slot); else draw2d(ctx, cam, w, h, list);
      ctx.restore();
    }
    marks(w, h, now);
  }

  // ── Sobre el cristal: yemas, tecla de fijar, aspa del portal elegido ──────
  let dots = [], bar = null, drop = null, ring = null;
  function hint(text, ms) { if (window.flipShell) { state.shown = '·' + text; flipShell.hint(text, ms); state.hintUntil = performance.now() + (ms || 0); } }
  function buildBar() {
    const host = document.getElementById('osd');
    if (!host || bar) return;
    bar = document.createElement('div');
    bar.id = 'portalBar';
    bar.innerHTML = `
      <button class="hw hw-keycap" data-color="mustard" id="portalLock" type="button" aria-label="Fijar la ventana donde está"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>FIJAR</span></button>
      <button class="hw hw-keycap" id="portalForm" type="button" aria-label="Forma de la ventana"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d=""/></svg></button>
      <span class="hw-lcd" id="portalCount" aria-live="polite"><b>0</b></span>
      <button class="hw hw-keycap" id="portalErase" type="button" aria-label="Borrar el portal elegido o el último"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7"/></svg><span>BORRAR</span></button>`;
    host.appendChild(bar);
    drop = document.createElement('button');
    drop.id = 'portalDrop'; drop.type = 'button'; drop.className = 'hw'; drop.setAttribute('aria-label', 'Borrar este portal');
    drop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
    host.appendChild(drop);
    ring = document.createElement('i');
    ring.id = 'portalDwell';
    ring.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15"/><circle cx="20" cy="20" r="15" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>';
    host.appendChild(ring);
    bar.querySelector('#portalLock').addEventListener('click', () => lockLive('tecla'));
    bar.querySelector('#portalForm').addEventListener('click', () => setForm());
    // BORRAR: un toque quita el elegido (o el último); mantenerla los quita todos.
    const erase = bar.querySelector('#portalErase');
    let hold = 0, swept = false;
    erase.addEventListener('pointerdown', () => { swept = false; clearTimeout(hold); hold = setTimeout(() => { if (!panes.length) return; swept = true; panes.length = 0; select(-1); feel('switch', 'down'); hint('Todos los portales borrados', 1800); }, 650); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) erase.addEventListener(type, () => clearTimeout(hold));
    erase.addEventListener('click', () => { if (swept) { swept = false; return; } if (!panes.length) { hint('No hay portales fijados', 1500); return; } removePane(selected >= 0 ? selected : panes.length - 1); });
    drop.addEventListener('click', () => removePane(selected));
  }
  function syncBar() {
    if (!bar) return;
    bar.querySelector('#portalCount b').textContent = String(panes.length);
    bar.querySelector('#portalErase').classList.toggle('is-dim', !panes.length);
    bar.querySelector('#portalLock').classList.toggle('is-dim', panes.length >= MAX_PANES);
    const key = bar.querySelector('#portalForm');
    key.querySelector('path').setAttribute('d', form === 'round' ? 'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14z' : form === 'tri' ? 'M12 5.5 19.5 18.5h-15z' : 'M5.5 6.5h13v11h-13z');
    key.setAttribute('aria-label', 'Forma de la ventana: ' + FORM_NAMES[form] + '. Toca para cambiarla.');
    key.dataset.form = form;
  }
  function marks(w, h, now) {
    const host = document.getElementById('osd');
    if (!host) return;
    const rect = display.getBoundingClientRect(), glass = host.getBoundingClientRect();
    const place = (node, x, y) => { node.style.transform = `translate(${(rect.left - glass.left + x * rect.width).toFixed(1)}px, ${(rect.top - glass.top + y * rect.height).toFixed(1)}px)`; };
    const tips = [];
    for (const hand of state.hands) for (const tip of [THUMB, INDEX]) {
      const x = hand[2 * tip] / w, y = hand[2 * tip + 1] / h;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) tips.push([x, y]);            // fuera de la imagen no lleva marca
    }
    while (dots.length < tips.length) { const dot = document.createElement('i'); dot.className = 'portal-tip'; host.appendChild(dot); dots.push(dot); }
    dots.forEach((dot, index) => { const tip = tips[index]; dot.style.display = tip ? 'block' : 'none'; if (tip) place(dot, tip[0], tip[1]); dot.classList.toggle('is-click', state.pinched); });
    if (drop) {
      const pane = selected >= 0 ? panes[selected] : null;
      drop.style.display = pane ? 'grid' : 'none';
      if (pane) { let x = 0, y = 1; for (let i = 0; i < 8; i += 2) { if (pane.pts[i] - pane.pts[i + 1] > x - y) { x = pane.pts[i]; y = pane.pts[i + 1]; } } place(drop, clamp(x, .06, .94), clamp(y, .05, .95)); }
    }
    if (ring) {
      const on = still.progress > 0 && !!state.shape;
      ring.style.display = on ? 'block' : 'none';
      if (on) { ring.firstChild.lastChild.setAttribute('stroke-dashoffset', (100 - 100 * still.progress).toFixed(1)); place(ring, clamp(state.shape.cx / w, .06, .94), clamp(state.shape.cy / h, .06, .94)); }
    }
    if (now < (state.hintUntil || 0)) return;                                 // un aviso puntual sigue en pantalla
    const seen = state.hands.length;
    const text = trk.phase === 'loading' ? 'Cargando el seguimiento de manos…'
      : trk.phase === 'failed' ? trk.message
      : selected >= 0 ? ''
      : seen === 0 ? (panes.length ? '' : 'Enseña las manos a la cámara')
      : state.amount < 0.2 ? (seen === 1 ? 'Abre el pulgar y el índice en L' : 'Haz un marco con las dos manos y sepáralas')
      : panes.length < 2 && state.hintLock < 3 ? (still.on ? 'Déjalo quieto un segundo para fijarlo' : 'Toca el pulgar con el anular para fijarlo')
      : '';
    if (text !== state.shown) { state.shown = text; if (text.startsWith('Déjalo quieto') || text.startsWith('Toca el pulgar')) state.hintLock++; if (window.flipShell) flipShell.hint(text, 0); }
  }

  // ── Módulo ────────────────────────────────────────────────────────────────
  function setLook(key) {
    state.look = key || '';
    document.body.dataset.look = state.look;
    if (window.flipShell) { flipShell.lookLabel.text = state.look ? EXTRA[state.look].label : null; flipShell.syncCam(); }
    if (state.look && EXTRA[state.look].audio) ensureAudio();
  }
  function enter() {
    Object.assign(state, { active: true, amount: 0, shape: null, hands: [], shown: null, mode: '', slots: null, lensAfter: 0, wait: false, hintUntil: 0 });
    state.trail.length = 0; trk.strikes = 0; still.ref = null; still.progress = 0; still.spent = null;
    // Lo que quedara en las colas es de otra visita: no se enseña.
    for (const slot of gfx.ring) if (slot) slot.shot = -Infinity;
    for (const slot of state.bases) if (slot) slot.shot = 0;
    gfx.head = -1; gfx.lastUp = -Infinity; gfx.seq = -1; state.baseAt = -Infinity; state.baseShot = 0; sync.lastT = 0; trk.sentShot = 0;
    document.body.classList.add('portal-mode');
    const looks = flipShell.looks;
    if (!looks.querySelector('[data-look]')) {
      for (const [key, spec] of Object.entries(EXTRA)) {
        const tile = flipShell.el('button', { class: 'hw look portal-look', type: 'button', role: 'option', 'data-look': key, title: spec.hint }, `<i></i><span>${spec.label}</span>`);
        tile.firstChild.innerHTML = flipShell.icon(key === 'ASCII' ? 'ascii' : key === 'SONO' ? 'sono' : 'wmp');
        looks.appendChild(tile);
      }
    }
    buildBar(); syncBar();
    setLook('');
    start();
    if (typeof _resetCamEngineState === 'function') _resetCamEngineState('capture');
  }
  function exit() {
    state.active = false;
    document.body.classList.remove('portal-mode');
    select(-1);
    setLook('');
    dots.forEach(dot => { dot.style.display = 'none'; });
    if (drop) drop.style.display = 'none';
    if (ring) ring.style.display = 'none';
    if (window.flipShell) flipShell.hint('');
    stop();
    state.hands = [];
    // Al salir se sueltan las texturas de la cola (decenas de megas de GPU que CAM no usa).
    if (gfx.gl) for (const slot of gfx.ring.splice(0)) if (slot) for (const name of ['A', 'U', 'V']) if (slot[name]) gfx.gl.deleteTexture(slot[name]);
    gfx.head = -1; gfx.hasCam = false;
    for (const slot of state.bases.splice(0)) if (slot) { slot.canvas.width = slot.canvas.height = 0; }
    state.base = null; state.styleBase = null; state.baseHead = -1; state.baseAt = -Infinity; state.bw = state.bh = 0;
    // …y los estilos pintados para las ventanas (cada uno, un lienzo y su textura): se rehacen al volver.
    for (const entry of pool.values()) { if (entry.tex && gfx.gl) gfx.gl.deleteTexture(entry.tex); entry.canvas.width = entry.canvas.height = 0; }
    pool.clear();
  }
  // Dedo sobre el visor: elegir, mover (dos dedos: escalar y girar), o fijar la ventana viva.
  const grab = { id: -1, pane: -1, moved: false, start: null, last: null, second: null, basePts: null, baseSpan: 0, baseAngle: 0 };
  const at = event => { const r = display.getBoundingClientRect(); return [(event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height]; };
  function boot() {
    if (!window.flipShell) return;
    flipShell.overlay('portal', { tab: 'cam', enter, exit });
    flipShell.onLook(tile => {
      if (!state.active) return false;
      if (tile.dataset.look) { setLook(tile.dataset.look); flipShell.hint(EXTRA[tile.dataset.look].hint, 2200); state.shown = null; return true; }
      if (state.look) setLook('');
      if (tile.dataset.family === camFamily && (!tile.dataset.variant || tile.dataset.variant === camVariant)) { flipShell.syncCam(); return true; }
      return false;
    });
    display.addEventListener('pointerdown', event => {
      if (!state.active) return;
      const p = at(event);
      if (grab.id >= 0 && grab.pane >= 0 && grab.second === null && event.pointerId !== grab.id) {
        grab.second = { id: event.pointerId, p };
        grab.basePts = panes[grab.pane].pts.slice();
        grab.baseSpan = Math.hypot(p[0] - grab.last[0], (p[1] - grab.last[1]) * state.h / state.w) || 0.01;
        grab.baseAngle = Math.atan2((p[1] - grab.last[1]) * state.h / state.w, p[0] - grab.last[0]);
        grab.moved = true;
        return;
      }
      let hit = -1;
      for (let i = panes.length - 1; i >= 0 && hit < 0; i--) if (inside(panes[i].pts, p[0], p[1])) hit = i;
      Object.assign(grab, { id: event.pointerId, pane: hit, moved: false, start: p, last: p, second: null });
      if (hit >= 0) { try { display.setPointerCapture(event.pointerId); } catch (_) {} if (selected !== hit) select(hit); }
    });
    display.addEventListener('pointermove', event => {
      if (!state.active || grab.id < 0 || grab.pane < 0 || !panes[grab.pane]) return;
      const p = at(event), pane = panes[grab.pane];
      if (grab.second) {
        if (event.pointerId === grab.second.id) grab.second.p = p; else if (event.pointerId === grab.id) grab.last = p; else return;
        const a = grab.last, b = grab.second.p, ratio = state.h / state.w;
        const span = Math.hypot(b[0] - a[0], (b[1] - a[1]) * ratio) || 0.01, angle = Math.atan2((b[1] - a[1]) * ratio, b[0] - a[0]);
        const scale = clamp(span / grab.baseSpan, 0.3, 4), turn = angle - grab.baseAngle, cos = Math.cos(turn), sin = Math.sin(turn);
        let cx = 0, cy = 0;
        for (let i = 0; i < 8; i += 2) { cx += grab.basePts[i] / 4; cy += grab.basePts[i + 1] / 4; }
        for (let i = 0; i < 8; i += 2) {
          const x = (grab.basePts[i] - cx) * scale, y = (grab.basePts[i + 1] - cy) * ratio * scale;
          pane.pts[i] = cx + x * cos - y * sin; pane.pts[i + 1] = cy + (x * sin + y * cos) / ratio;
        }
        return;
      }
      if (event.pointerId !== grab.id) return;
      if (!grab.moved && Math.hypot(p[0] - grab.start[0], p[1] - grab.start[1]) < 0.015) return;
      grab.moved = true;
      movePane(pane, p[0] - grab.last[0], p[1] - grab.last[1]);
      grab.last = p;
    });
    const release = event => {
      if (!state.active || grab.id < 0) return;
      if (grab.second && event.pointerId === grab.second.id) { grab.second = null; return; }
      if (event.pointerId !== grab.id) return;
      const tap = !grab.moved && event.type === 'pointerup', hit = grab.pane;
      grab.id = -1; grab.pane = -1; grab.second = null;
      if (!tap || hit >= 0) return;
      if (trk.phase === 'failed') { trk.phase = 'idle'; start(); return; }
      if (selected >= 0) { select(-1); return; }
      if (state.shape && state.amount > 0.5) lockLive('toque');
    };
    display.addEventListener('pointerup', release);
    display.addEventListener('pointercancel', release);
    // El toque sobre el visor es de PORTAL: no llega a los cierres de paneles de CAM.
    display.addEventListener('click', event => { if (state.active) event.stopImmediatePropagation(); }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  let lost = null;
  return {
    render, enter, exit, start,
    get active() { return state.active; },
    // El dibujo acelerado va a la cadencia de la pantalla; sin WebGL 2, a 30 por segundo.
    get fast() { return state.active && gfx.ok; },
    status: () => ({ active: state.active, phase: trk.phase, message: trk.message, delegate: trk.delegate, calibrating: !!trk.cand, frames: trk.frames, busy: !!(trk.main && trk.main.busy),
      mode: state.mode || '', held: state.slots ? state.slots.map(slot => (slot.lostAt ? (slot.edge ? 'lado' : 'espera') : 'viva')) : null, hands: state.hands.length,
      tips: trk.raw.length ? [+trk.raw[0][8].toFixed(3), +trk.raw[0][9].toFixed(3), +trk.raw[0][16].toFixed(3), +trk.raw[0][17].toFixed(3)] : null,
      amount: +state.amount.toFixed(3), shape: state.shape ? state.shape.kind : null, area: state.shape ? +state.shape.area.toFixed(4) : 0, look: state.look,
      // La figura viva, en 0…1 del visor (para medir cuánto se separa de los dedos).
      figure: state.shape && state.w ? Array.from(state.shape.pts, (v, i) => +(v / (i % 2 ? state.h : state.w)).toFixed(4)) : null,
      panes: panes.length, selected, styles: panes.map(pane => pane.style.key), waiting: state.wait, pinched: state.pinched,
      ms: trk.ms, error: trk.error || '', fxError: state.fxError || '', gl: gfx.ok, path: gfx.path,
      // La imagen va `delay` ms por detrás: lo que tarda el rastreador (latency) más parte de su periodo.
      delay: Math.round(state.delay), latency: Math.round(sync.latency), period: Math.round(sync.period), queue: gfx.ring.length,
      // Para las pruebas: cuántas veces se ha pintado de verdad, y cuántos estilos hay guardados.
      draws: state.draws || 0, kept: pool.size, form, dwell: +still.progress.toFixed(2),
      // El clic de cada mano, en tamaños de mano: yema que toca–pulgar, índice–pulgar, índice–muñeca; 3D en palmas; índice abierto, armado.
      pinch: tracks.map(track => ({ flat: +(track.flat || 0).toFixed(2), span: +(track.span || 0).toFixed(2), reach: +(track.reach || 0).toFixed(2), deep: +(track.deep || 0).toFixed(2), open: !!track.open,
        via: track.via || '', near: !!track.near, away: track.near ? 0 : Math.round(performance.now() - (track.awaySince || track.born)), hits: track.hits || 0, on: !!track.pinch, age: Math.round(performance.now() - track.born), x: +track.x[0].toFixed(2), at: Math.round(track.at * 1000) })) }),
    // Portales fijados, para las teclas y para las pruebas.
    panes: {
      list: () => panes.map(pane => ({ id: pane.id, style: pane.style.key, form: pane.form || 'quad', pts: Array.from(pane.pts, v => +v.toFixed(4)) })),
      lock: () => lockLive('tecla'), remove: removePane, select, clear() { panes.length = 0; select(-1); },
      move(index, dx, dy) { if (panes[index]) movePane(panes[index], dx, dy); },
    },
    // El mismo rastreador para otros módulos (STAGE): se le ofrece un cuadro y devuelve las manos
    // de la última detección, en 0…1 sobre ese cuadro.
    track(canvas) { push(canvas); return { hands: trk.raw, fresh: performance.now() - trk.rawAt < LOST_MS, phase: trk.phase, message: trk.message }; },
    release() { if (!state.active) stop(); },
    // Sustituye el rastreador por una función (pruebas): recibe la hora de la imagen y devuelve las manos
    // de ese instante como Float32Array(42). Con `lag` contesta con ese retraso, como un rastreador de verdad.
    use(provider, options) { stop(!!provider); trk.provider = provider; trk.providerLag = provider && options && options.lag || 0; trk.phase = provider ? 'ready' : 'idle'; },
    // Pruebas: pierde (o devuelve) el contexto de WebGL, como hace el sistema al volver de segundo plano.
    lose(on) {
      if (on) { lost = gfx.gl && gfx.gl.getExtension('WEBGL_lose_context'); if (lost) lost.loseContext(); return !!lost; }
      const had = !!lost; if (lost) lost.restoreContext(); lost = null; return had;
    },
    // Pruebas: fuerza la subida directa del vídeo en vez de los planos.
    direct(on) { gfx.direct = !!on; gfx.path = ''; },
    // Ajuste del estimador (para medirlo con vídeo real): devuelve los valores en uso.
    tune(next) { if (next && 'dwell' in next) { still.on = !!next.dwell; still.ref = null; still.progress = 0; next = { ...next }; delete next.dwell; }
      Object.assign(est, next || {}); if (next && next.delay != null) { sync.want = sync.delay = next.delay; } return { ...est, delay: sync.delay, dwell: still.on }; },
    // La forma de la ventana: sin argumento pasa a la siguiente (cuadro, círculo, triángulo).
    form: setForm,
  };
})();
// Quien pregunte por PORTAL lo hace por window.flipPortal: si este archivo falla al iniciarse, el nombre
// declarado queda sin valor y hasta `typeof flipPortal` lanza (y con él, el bucle de la cámara).
window.flipPortal = flipPortal;
