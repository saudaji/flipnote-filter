// PORTAL · una ventana que se abre con las manos.
//
// La cámara se ve tal cual. Al hacer el marco con las dos manos (pulgar e índice en «L») y
// separarlas, entre las cuatro yemas se abre una ventana y dentro la imagen sale con la cámara
// elegida: DSi, DLPHN, STAMP (solo su trama), ASCII, las que reaccionan al sonido… Con una sola
// mano (la otra sujeta el teléfono) la ventana es una lente entre el pulgar y el índice.
//
// Vive sobre CAM: usa su visor, su bandeja de cámaras, su disparador y su grabación, así que
// la foto y el vídeo son exactamente lo que se ve.
const flipPortal = (() => {
  'use strict';
  const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/+esm';
  const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const INPUT = 320;          // lado largo de la imagen que ve el rastreador
  const LOST_MS = 380;        // sin manos este tiempo, la ventana se cierra
  const MIN_AREA = 0.0035;    // fracción del cuadro a partir de la cual la ventana existe
  const THUMB = 4, INDEX = 8;

  const state = {
    active: false, phase: 'idle', message: '', worker: null, loading: null, provider: null,
    busy: false, sentAt: 0, timer: 0, strikes: 0, ms: 0, seq: 0,
    input: null, ictx: null,
    targets: [],            // manos de la última detección: Float32Array(42) en 0…1
    seenAt: -Infinity,
    hands: [],              // manos suavizadas, en píxeles del lienzo
    shape: null,            // { kind:'quad'|'lens', points:[x,y…] | cx,cy,r }
    amount: 0, opened: -Infinity, locked: false, lastT: 0,
    base: null, bctx: null, fx: null, fctx: null, fxAt: -Infinity, fxKey: '',
    look: '',               // '' = cámara de CAM; 'ASCII' | 'SONO' | 'WMP'
    audioReady: false, hinted: false,
  };

  // ── Rastreador de manos ───────────────────────────────────────────────────
  function stopWorker() {
    if (!state.worker) return;
    try { state.worker.postMessage({ type: 'close' }); } catch (_) {}
    const worker = state.worker;
    state.worker = null;
    setTimeout(() => { try { worker.terminate(); } catch (_) {} }, 300);
  }
  function settle() { clearTimeout(state.timer); state.busy = false; }
  function accept(hands, ms) {
    state.targets = hands.map(hand => hand.points);
    if (hands.length) state.seenAt = performance.now();
    state.ms = ms; state.seq++; state.strikes = 0;
  }
  function strike(reason) {
    state.error = String(reason || '');
    if (++state.strikes < 3) return;
    stopWorker();
    state.phase = 'failed';
    state.message = 'El seguimiento de manos dejó de responder. Toca el visor para reintentar.';
  }
  function start() {
    if (state.phase === 'ready' || state.loading) return state.loading || Promise.resolve(true);
    if (state.provider) { state.phase = 'ready'; return Promise.resolve(true); }
    state.phase = 'loading';
    state.message = 'Cargando el seguimiento de manos…';
    state.loading = new Promise(resolve => {
      let worker;
      const fail = message => {
        state.phase = 'failed';
        state.error = message;
        state.message = navigator.onLine === false ? 'El seguimiento de manos necesita conexión la primera vez.' : 'No se pudo cargar el seguimiento de manos. Toca el visor para reintentar.';
        resolve(false);
      };
      try { worker = new Worker('./hands-worker.js'); } catch (error) { fail(String(error)); return; }
      const timer = setTimeout(() => { worker.terminate(); fail('tiempo de carga agotado'); }, 40000);
      let ready = false;
      worker.onmessage = event => {
        const msg = event.data || {};
        if (msg.type === 'ready') {
          ready = true; clearTimeout(timer);
          state.worker = worker; state.phase = 'ready'; state.message = ''; state.strikes = 0;
          resolve(true);
        } else if (msg.type === 'hands') {
          if (worker !== state.worker) return;
          settle(); accept(msg.hands, msg.ms);
        } else if (msg.type === 'error') {
          if (!ready) { clearTimeout(timer); worker.terminate(); fail(msg.message); return; }
          if (worker === state.worker) { settle(); strike(msg.message); }
        }
      };
      worker.onerror = event => {
        if (!ready) { clearTimeout(timer); worker.terminate(); fail(event.message || 'error del worker'); return; }
        if (worker === state.worker) { settle(); strike(event.message); }
      };
      worker.postMessage({ type: 'init', lib: LIB, wasm: WASM, model: MODEL });
    });
    state.loading.finally(() => { state.loading = null; });
    return state.loading;
  }
  function push(canvas) {
    if (state.phase !== 'ready' || state.busy) return;
    const scale = INPUT / Math.max(canvas.width, canvas.height);
    const w = Math.max(16, Math.round(canvas.width * scale)), h = Math.max(16, Math.round(canvas.height * scale));
    if (state.provider) {
      const hands = state.provider(performance.now()) || [];
      accept(hands.map(points => ({ points })), 0);
      return;
    }
    if (!state.input) { state.input = new OffscreenCanvas(w, h); state.ictx = state.input.getContext('2d'); }
    if (state.input.width !== w || state.input.height !== h) { state.input.width = w; state.input.height = h; }
    state.ictx.drawImage(canvas, 0, 0, w, h);
    const bitmap = state.input.transferToImageBitmap();
    state.busy = true;
    state.sentAt = performance.now();
    const worker = state.worker;
    state.timer = setTimeout(() => { if (worker === state.worker) { settle(); strike('sin respuesta'); } }, 4000);
    worker.postMessage({ type: 'frame', id: state.seq, bitmap }, [bitmap]);
  }

  // ── Manos suavizadas y forma de la ventana ────────────────────────────────
  // Cada mano detectada se empareja con la suavizada más cercana para que no salten de una a otra.
  function follow(w, h, dt) {
    const fresh = performance.now() - state.seenAt < LOST_MS;
    const targets = fresh ? state.targets : [];
    const next = [];
    const free = state.hands.slice();
    for (const target of targets) {
      const tx = target[0] * w, ty = target[1] * h;
      let best = -1, bestD = Infinity;
      free.forEach((hand, index) => { const d = (hand[0] - tx) ** 2 + (hand[1] - ty) ** 2; if (d < bestD) { bestD = d; best = index; } });
      const hand = best >= 0 && bestD < (w * 0.4) ** 2 ? free.splice(best, 1)[0] : null;
      const out = hand || new Float32Array(42);
      for (let i = 0; i < 21; i++) {
        const x = target[2 * i] * w, y = target[2 * i + 1] * h;
        if (!hand) { out[2 * i] = x; out[2 * i + 1] = y; continue; }
        // Más rápido cuanto más lejos está el punto: quieto no tiembla, en movimiento no se arrastra.
        const d = Math.hypot(x - out[2 * i], y - out[2 * i + 1]);
        const tau = d > w * 0.05 ? 18 : d > w * 0.012 ? 40 : 85;
        const k = 1 - Math.exp(-dt / tau);
        out[2 * i] += (x - out[2 * i]) * k; out[2 * i + 1] += (y - out[2 * i + 1]) * k;
      }
      next.push(out);
    }
    state.hands = next;
  }
  function shapeFrom(hands, w, h) {
    if (hands.length >= 2) {
      const pair = hands.slice(0, 2).sort((a, b) => (a[2 * THUMB] + a[2 * INDEX]) - (b[2 * THUMB] + b[2 * INDEX]));
      const corner = hand => {
        const a = [hand[2 * THUMB], hand[2 * THUMB + 1]], b = [hand[2 * INDEX], hand[2 * INDEX + 1]];
        return a[1] < b[1] ? [a, b] : [b, a];   // [arriba, abajo]
      };
      const [lu, ld] = corner(pair[0]), [ru, rd] = corner(pair[1]);
      const points = [lu[0], lu[1], ru[0], ru[1], rd[0], rd[1], ld[0], ld[1]];
      let area = 0;
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; area += points[2 * i] * points[2 * j + 1] - points[2 * j] * points[2 * i + 1]; }
      return { kind: 'quad', points, area: Math.abs(area) / 2 / (w * h), cx: (lu[0] + ru[0] + rd[0] + ld[0]) / 4, cy: (lu[1] + ru[1] + rd[1] + ld[1]) / 4 };
    }
    if (hands.length === 1) {
      const hand = hands[0];
      const ax = hand[2 * THUMB], ay = hand[2 * THUMB + 1], bx = hand[2 * INDEX], by = hand[2 * INDEX + 1];
      const r = Math.hypot(bx - ax, by - ay) * 0.56;
      return { kind: 'lens', cx: (ax + bx) / 2, cy: (ay + by) / 2, r, area: (Math.PI * r * r) / (w * h) };
    }
    return null;
  }
  function trace(ctx, shape, grow) {
    ctx.beginPath();
    if (shape.kind === 'lens') { ctx.arc(shape.cx, shape.cy, Math.max(0.5, shape.r * grow), 0, 6.2832); return; }
    const p = shape.points;
    for (let i = 0; i < 4; i++) {
      const x = shape.cx + (p[2 * i] - shape.cx) * grow, y = shape.cy + (p[2 * i + 1] - shape.cy) * grow;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // ── Efecto dentro de la ventana ───────────────────────────────────────────
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
  function renderFx(now, w, h) {
    const cadence = state.look ? 30 : (typeof camFpsTarget === 'number' ? Math.max(4, camFpsTarget) : 24);
    const key = (state.look || camFamily + ':' + camVariant) + ':' + w + 'x' + h;
    if (key === state.fxKey && now - state.fxAt < 1000 / cadence - 4) return;
    state.fxKey = key; state.fxAt = now;
    const ctx = state.fctx, src = state.base;
    if (state.look === 'ASCII') {
      FLIP_STEP_ENGINES.ascii.renderStep(src, ctx, { cols: 72 }, null, now);
    } else if (state.look === 'SONO') {
      _editRenderSonoSource(ctx, w, h, now);
    } else if (state.look === 'WMP') {
      _editRenderWmpSource(ctx, w, h, now);
    } else {
      // De STAMP entra la trama, no el marco del sello.
      const frame = typeof stampFrameMode === 'string' ? stampFrameMode : null;
      if (frame !== null && camFamily === 'STAMP') stampFrameMode = 'OFF';
      try {
        _renderCamEngineFrame(src, w, h, ctx, false, { path: 'capture', now, outW: w, outH: h, resolution: 'medium', family: camFamily, variant: camVariant });
      } finally {
        if (frame !== null && camFamily === 'STAMP') stampFrameMode = frame;
      }
    }
  }

  // ── Cuadro ────────────────────────────────────────────────────────────────
  function ensure(w, h) {
    if (!state.base) {
      state.base = document.createElement('canvas'); state.bctx = state.base.getContext('2d', { willReadFrequently: true });
      state.fx = document.createElement('canvas'); state.fctx = state.fx.getContext('2d', { willReadFrequently: true });
    }
    if (state.base.width !== w || state.base.height !== h) {
      state.base.width = w; state.base.height = h; state.fx.width = w; state.fx.height = h;
      state.fxKey = '';
      if (typeof _resetCamEngineState === 'function') _resetCamEngineState('capture');
    }
  }
  function render(cam, ctx, now) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ensure(w, h);
    const dt = Math.min(100, Math.max(1, now - (state.lastT || now)));
    state.lastT = now;
    // 1 · La cámara tal cual; la frontal, en espejo, para que las manos vayan hacia donde uno las mueve.
    const mirror = typeof facingMode === 'string' && facingMode === 'user';
    const [sx, sy, sw, sh] = cropCoordsForDims(cam.srcW, cam.srcH, w, h);
    const b = state.bctx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    if (mirror) { b.translate(w, 0); b.scale(-1, 1); }
    b.imageSmoothingEnabled = true;
    b.drawImage(cam.source, sx, sy, sw, sh, 0, 0, w, h);
    b.setTransform(1, 0, 0, 1, 0, 0);
    // 2 · Manos.
    push(state.base);
    if (!state.locked) {
      follow(w, h, dt);
      const shape = shapeFrom(state.hands, w, h);
      if (shape && shape.area > MIN_AREA) {
        if (state.amount < 0.02) state.opened = now;
        state.shape = shape;
        state.amount += (1 - state.amount) * (1 - Math.exp(-dt / 90));
      } else {
        state.amount += (0 - state.amount) * (1 - Math.exp(-dt / 110));
        if (state.amount < 0.01) { state.amount = 0; if (!shape) state.shape = state.shape && state.amount ? state.shape : null; }
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(state.base, 0, 0);
    // 3 · La ventana.
    if (state.shape && state.amount > 0.01) {
      try {
        renderFx(now, w, h);
        state.fxError = '';
      } catch (error) {
        // Un efecto que falla no puede parar la cámara: la ventana enseña la imagen sin tratar y se avisa una vez.
        const message = String(error && error.message || error);
        if (state.fxError !== message) { state.fxError = message; console.warn('[PORTAL] efecto', state.look || camFamily, message); flipToast('Esta cámara no pudo dibujarse dentro de la ventana.'); }
        state.fctx.drawImage(state.base, 0, 0);
      }
      const shape = state.shape;
      const grow = 1 - Math.pow(1 - state.amount, 3);
      ctx.save();
      trace(ctx, shape, grow);
      ctx.clip();
      ctx.drawImage(state.fx, 0, 0);
      ctx.restore();
      // El borde: un filo de luz que estalla al abrirse y luego se calma.
      const burst = Math.max(0, 1 - (now - state.opened) / 420);
      const unit = Math.min(w, h) / 100;
      trace(ctx, shape, grow);
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(255,255,255,.95)';
      ctx.shadowBlur = unit * (1.6 + burst * 5);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.82 + burst * 0.18).toFixed(3) + ')';
      ctx.lineWidth = unit * (0.42 + burst * 0.9);
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (burst > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,255,255,' + (burst * 0.35).toFixed(3) + ')';
        trace(ctx, shape, grow);
        ctx.fill();
      }
    }
    ctx.restore();
    marks(w, h);
  }

  // Marcas sobre las yemas: dicen «te veo» sin salir en la foto (van en la capa de datos, no en el lienzo).
  let dots = [];
  function marks(w, h) {
    const host = document.getElementById('osd');
    if (!host) return;
    const rect = display.getBoundingClientRect(), glass = host.getBoundingClientRect();
    const tips = [];
    if (!state.locked) for (const hand of state.hands) tips.push([hand[2 * THUMB], hand[2 * THUMB + 1]], [hand[2 * INDEX], hand[2 * INDEX + 1]]);
    while (dots.length < tips.length) { const dot = document.createElement('i'); dot.className = 'portal-tip'; host.appendChild(dot); dots.push(dot); }
    dots.forEach((dot, index) => {
      const tip = tips[index];
      dot.style.display = tip ? 'block' : 'none';
      if (tip) dot.style.transform = `translate(${(rect.left - glass.left + (tip[0] / w) * rect.width).toFixed(1)}px, ${(rect.top - glass.top + (tip[1] / h) * rect.height).toFixed(1)}px)`;
    });
    const seen = state.hands.length;
    const text = state.phase === 'loading' ? 'Cargando el seguimiento de manos…'
      : state.phase === 'failed' ? state.message
      : state.locked ? 'Ventana fijada · toca el visor para soltarla'
      : seen === 0 ? 'Enseña las manos a la cámara'
      : state.amount < 0.2 ? (seen === 1 ? 'Separa el pulgar y el índice' : 'Haz un marco con las dos manos y sepáralas')
      : '';
    if (text !== state.shown) { state.shown = text; if (window.flipShell) flipShell.hint(text, 0); }
  }

  // ── Módulo ────────────────────────────────────────────────────────────────
  function setLook(key) {
    state.look = key || '';
    state.fxKey = '';
    document.body.dataset.look = state.look;
    if (window.flipShell) { flipShell.lookLabel.text = state.look ? EXTRA[state.look].label : null; flipShell.syncCam(); }
    if (state.look && EXTRA[state.look].audio) ensureAudio();
  }
  function enter() {
    state.active = true; state.locked = false; state.amount = 0; state.shape = null; state.hands = []; state.shown = null;
    document.body.classList.add('portal-mode');
    if (typeof camFamily === 'string' && camFamily === 'SLHT') _setCamFamily('DSI');
    const looks = flipShell.looks;
    if (!looks.querySelector('[data-look]')) {
      for (const [key, spec] of Object.entries(EXTRA)) {
        const tile = flipShell.el('button', { class: 'hw look portal-look', type: 'button', role: 'option', 'data-look': key, title: spec.hint }, `<i></i><span>${spec.label}</span>`);
        tile.firstChild.innerHTML = flipShell.icon(key === 'ASCII' ? 'ascii' : key === 'SONO' ? 'sono' : 'wmp');
        looks.appendChild(tile);
      }
    }
    setLook('');
    start();
    if (typeof _resetCamEngineState === 'function') _resetCamEngineState('capture');
  }
  function exit() {
    state.active = false; state.locked = false;
    document.body.classList.remove('portal-mode');
    setLook('');
    dots.forEach(dot => { dot.style.display = 'none'; });
    if (window.flipShell) flipShell.hint('');
    stopWorker();
    if (state.phase !== 'failed') state.phase = 'idle';
    state.targets = []; state.hands = [];
  }
  function boot() {
    if (!window.flipShell) return;
    flipShell.overlay('portal', { tab: 'cam', enter, exit });
    flipShell.onLook(tile => {
      if (!state.active) return false;
      if (tile.dataset.look) { setLook(tile.dataset.look); flipShell.hint(EXTRA[tile.dataset.look].hint, 2200); state.shown = null; return true; }
      if (state.look) setLook('');
      if (tile.dataset.family === camFamily) { flipShell.syncCam(); return true; }
      return false;
    });
    // Tocar el visor fija la ventana donde está (para soltar las manos) o reintenta la carga.
    display.addEventListener('click', event => {
      if (!state.active) return;
      event.stopImmediatePropagation();
      if (state.phase === 'failed') { state.phase = 'idle'; start(); return; }
      if (state.locked) { state.locked = false; return; }
      if (state.shape && state.amount > 0.5) state.locked = true;
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  return {
    render, enter, exit, start,
    get active() { return state.active; },
    status: () => ({ active: state.active, phase: state.phase, message: state.message, hands: state.hands.length, amount: +state.amount.toFixed(3), shape: state.shape ? state.shape.kind : null, area: state.shape ? +state.shape.area.toFixed(4) : 0, look: state.look, locked: state.locked, ms: state.ms, error: state.error || '', fxError: state.fxError || '' }),
    // El mismo rastreador para otros módulos (STAGE): se le ofrece un cuadro y devuelve las manos
    // de la última detección, en 0…1 sobre ese cuadro.
    track(canvas) { push(canvas); return { hands: state.targets, fresh: performance.now() - state.seenAt < LOST_MS, phase: state.phase, message: state.message }; },
    release() { if (state.active) return; stopWorker(); if (state.phase !== 'failed') state.phase = 'idle'; state.targets = []; },
    // Sustituye el rastreador por una función (pruebas): recibe el tiempo y devuelve manos como Float32Array(42).
    use(provider) { stopWorker(); state.provider = provider; state.phase = provider ? 'ready' : 'idle'; },
  };
})();
