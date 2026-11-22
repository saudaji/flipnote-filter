// Detector de siluetas compartido por SLHT (familia de CAM) y FLOW.
//
// Un solo segmentador de personas para toda la app, en un worker y con el delegado de CPU.
// Antes cada módulo creaba el suyo con el delegado de GPU: en la PowerVR del Pixel 10 la
// lectura de la máscara falla sin lanzar error («glReadPixels: Invalid format and type
// combination») y devuelve todo ceros, así que ninguna silueta aparecía. En CPU la máscara es
// la misma en todos los dispositivos; en el worker la inferencia (~40 ms en un Pixel 10) no
// detiene el dibujo.
//
//   flipSilhouette.start()                         carga el detector (se puede llamar siempre)
//   flipSilhouette.push(src, sx, sy, sw, sh, mirror)  ofrece un cuadro; se ignora si hay uno en curso
//   flipSilhouette.latest(edadMáx)                 { data, width, height, seq, at } o null
//   flipSilhouette.status()                        { phase, mode, message, ms }
//   flipSilhouette.retry()                         tras un fallo
//   flipSilhouette.use(fn)                         detector propio (pruebas)
const flipSilhouette = (() => {
  'use strict';
  const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/+esm';
  const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';
  const INPUT = 256;            // lado largo de la imagen que recibe el modelo
  const INIT_TIMEOUT = 30000;   // la primera vez descarga unos 10 MB
  const FRAME_TIMEOUT = 4000;
  const IDLE_RELEASE = 25000;   // sin uso, se suelta la memoria del modelo

  const s = {
    phase: 'idle', mode: '', message: '', loading: null,
    worker: null, local: null, localStamp: 0,
    busy: false, sentAt: 0, frameTimer: 0, frameId: 0, strikes: 0,
    mask: null, seq: 0, ms: 0, lastUse: 0, idleTimer: 0,
    input: null, ictx: null,
  };

  function setPhase(phase, message = '') {
    s.phase = phase;
    s.message = message;
  }

  function accept(data, width, height, ms) {
    s.mask = { data, width, height, seq: ++s.seq, at: performance.now() };
    s.ms = ms;
    s.strikes = 0;
  }

  function settle() {
    clearTimeout(s.frameTimer);
    s.busy = false;
  }

  function stopWorker() {
    if (!s.worker) return;
    try { s.worker.postMessage({ type: 'close' }); } catch (_) {}
    const worker = s.worker;
    s.worker = null;
    setTimeout(() => { try { worker.terminate(); } catch (_) {} }, 300);
  }

  function startWorker() {
    return new Promise((resolve, reject) => {
      if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') { reject(new Error('sin worker')); return; }
      let worker;
      try { worker = new Worker('./silhouette-worker.js'); } catch (error) { reject(error); return; }
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('tiempo de carga agotado')); }, INIT_TIMEOUT);
      let ready = false;
      worker.onmessage = event => {
        const msg = event.data || {};
        if (msg.type === 'ready') {
          ready = true;
          clearTimeout(timer);
          s.worker = worker;
          resolve();
        } else if (msg.type === 'mask') {
          if (worker !== s.worker) return;
          settle();
          accept(msg.data, msg.width, msg.height, msg.ms);
        } else if (msg.type === 'error') {
          if (!ready) { clearTimeout(timer); worker.terminate(); reject(new Error(msg.message)); return; }
          if (worker === s.worker) { settle(); strike(msg.message); }
        }
      };
      worker.onerror = event => {
        if (!ready) { clearTimeout(timer); worker.terminate(); reject(new Error(event.message || 'error del worker')); return; }
        if (worker === s.worker) { settle(); strike(event.message || 'error del worker'); }
      };
      worker.postMessage({ type: 'init', lib: LIB, wasm: WASM, model: MODEL });
    });
  }

  // Respaldo sin worker: el mismo modelo y delegado, en el hilo principal.
  async function startLocal() {
    const { ImageSegmenter, FilesetResolver } = await import(LIB);
    const vision = await FilesetResolver.forVisionTasks(WASM);
    s.local = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      outputCategoryMask: false, outputConfidenceMasks: true, runningMode: 'VIDEO',
    });
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('tiempo de carga agotado')), ms);
      promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }

  function start() {
    s.lastUse = performance.now();
    if (s.phase === 'ready') return Promise.resolve(true);
    if (s.loading) return s.loading;
    if (s.phase === 'failed') return Promise.resolve(false);
    setPhase('loading', 'Cargando el detector de siluetas…');
    s.loading = (async () => {
      try {
        await startWorker();
        s.mode = 'worker';
      } catch (workerError) {
        try {
          await withTimeout(startLocal(), INIT_TIMEOUT);
          s.mode = 'main';
        } catch (localError) {
          setPhase('failed', navigator.onLine === false
            ? 'El detector de siluetas necesita conexión la primera vez.'
            : 'No se pudo cargar el detector de siluetas. Toca para reintentar.');
          s.error = String(localError && localError.message || localError) + ' · worker: ' + String(workerError && workerError.message || workerError);
          return false;
        }
      }
      setPhase('ready');
      s.strikes = 0;
      if (!s.idleTimer) s.idleTimer = setInterval(releaseIfIdle, 5000);
      return true;
    })();
    s.loading.finally(() => { s.loading = null; });
    return s.loading;
  }

  function releaseIfIdle() {
    if (s.phase !== 'ready' || s.mode === 'custom' || s.busy || performance.now() - s.lastUse < IDLE_RELEASE) return;
    stopWorker();
    try { if (s.local) s.local.close(); } catch (_) {}
    s.local = null;
    s.mask = null;
    setPhase('idle');
    clearInterval(s.idleTimer);
    s.idleTimer = 0;
  }

  // Dos fallos seguidos de inferencia: se reinicia el detector una vez; si vuelve a fallar, se rinde.
  function strike(reason) {
    s.error = String(reason || '');
    if (++s.strikes < 2) return;
    stopWorker();
    try { if (s.local) s.local.close(); } catch (_) {}
    s.local = null;
    if (s.restarted) {
      setPhase('failed', 'El detector de siluetas dejó de responder. Toca para reintentar.');
      return;
    }
    s.restarted = true;
    setPhase('idle');
    start();
  }

  function prepare(source, sx, sy, sw, sh, mirror) {
    const scale = INPUT / Math.max(sw, sh);
    const w = Math.max(16, Math.round(sw * scale)), h = Math.max(16, Math.round(sh * scale));
    if (!s.input || s.offscreen !== (s.mode === 'worker')) {
      s.offscreen = s.mode === 'worker';
      s.input = s.offscreen ? new OffscreenCanvas(w, h) : document.createElement('canvas');
      s.ictx = s.input.getContext('2d', s.offscreen ? undefined : { willReadFrequently: true });
    }
    if (s.input.width !== w || s.input.height !== h) { s.input.width = w; s.input.height = h; }
    const ctx = s.ictx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function push(source, sx, sy, sw, sh, mirror) {
    s.lastUse = performance.now();
    if (s.phase !== 'ready' || s.busy || !(sw > 0) || !(sh > 0)) return false;
    // 30 siluetas por segundo como mucho: quien dibuja a 60 o a 120 reutiliza la última. Segmentar
    // cada refresco de pantalla era de lo que más calentaba (FLOW y la escena SILUETA de STAGE).
    if (s.lastUse - (s.sentAt || 0) < 33) return false;
    try {
      prepare(source, sx, sy, sw, sh, mirror);
    } catch (_) {
      return false;
    }
    s.busy = true;
    s.sentAt = performance.now();
    if (s.mode === 'custom') {
      try {
        const mask = s.provider(s.input);
        if (mask) accept(mask.data, mask.width, mask.height, performance.now() - s.sentAt);
      } finally {
        s.busy = false;
      }
    } else if (s.mode === 'worker') {
      const bitmap = s.input.transferToImageBitmap();
      const worker = s.worker;
      s.frameTimer = setTimeout(() => { if (worker === s.worker) { settle(); strike('sin respuesta'); } }, FRAME_TIMEOUT);
      worker.postMessage({ type: 'frame', id: ++s.frameId, bitmap }, [bitmap]);
    } else {
      // Fuera de la tarea de dibujo, para que este cuadro llegue a pantalla antes de inferir.
      setTimeout(() => {
        let result = null;
        try {
          const stamp = Math.max(s.localStamp + 1, Math.round(performance.now()));
          s.localStamp = stamp;
          result = s.local.segmentForVideo(s.input, stamp);
          const mask = result.confidenceMasks[0];
          accept(mask.getAsFloat32Array().slice(), mask.width, mask.height, performance.now() - s.sentAt);
        } catch (error) {
          strike(error && error.message);
        } finally {
          try { if (result) result.close(); } catch (_) {}
          s.busy = false;
        }
      }, 0);
    }
    return true;
  }

  function latest(maxAge = 1500) {
    return s.mask && performance.now() - s.mask.at <= maxAge ? s.mask : null;
  }

  function retry() {
    if (s.phase !== 'failed') return start();
    s.restarted = false;
    s.strikes = 0;
    setPhase('idle');
    return start();
  }

  // Sustituye el detector por una función propia: recibe el canvas de entrada y devuelve
  // { data, width, height }. Las pruebas la usan para dar una máscara conocida.
  function use(provider) {
    stopWorker();
    try { if (s.local) s.local.close(); } catch (_) {}
    s.local = null;
    s.provider = provider;
    s.mode = 'custom';
    s.mask = null;
    s.input = null;
    setPhase('ready');
  }

  return {
    start, push, latest, retry, use,
    status: () => ({ phase: s.phase, mode: s.mode, message: s.message, ms: s.ms, error: s.error || '', seq: s.seq }),
  };
})();
