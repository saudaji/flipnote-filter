// FLIP · cámaras que escuchan (prototipo). Con ESCUCHA encendida, el sonido del lugar mueve la
// cámara: el bajo, los medios y los agudos empujan uno o dos mandos de la cámara elegida, y el
// disparador puede esperar al siguiente golpe para tomar la foto justo en el pulso.
//   · Usa el micrófono que la app ya tiene (el de AUDIO): no abre otro.
//   · El mando se mueve SOLO mientras se pinta el cuadro (visor, foto y video) y vuelve a su valor:
//     lo que el usuario dejó en AJUSTES no cambia ni se guarda movido.
//   · Nada sale del teléfono: es el mismo análisis local que el resto de la app.
// Va después de shell.js y silueta.js. window.flipEscucha es su mando (y el de las pruebas).
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const KEY = 'flip.escucha';
  const body = document.body, shutter = $('deckShutter');
  const S = { on: false, golpe: false, mic: false, inject: null, armed: false, timer: 0, bypass: false, applied: null, paths: {} };
  try { S.golpe = !!JSON.parse(localStorage.getItem(KEY) || '{}').golpe; } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ golpe: S.golpe })); } catch (_) {} };

  // ── Qué mueve el sonido en cada cámara ─────────────────────────────────────
  // Solo mandos que el dibujo lee como un número en cada cuadro (sin reservar memoria ni rehacer
  // tablas): [banda, cuánto sube con la banda a tope, mínimo, máximo]. Las cámaras que no tienen
  // un mando así (AUTO 03, VFD, OSCAM) todavía no se mueven; el disparo al golpe les sirve igual.
  const mando = (get, set, band, span, min, max, extra) => ({ get, set, band, span, min, max, ...extra });
  const MAPA = {
    DSI: { dice: 'El bajo agranda la trama', mandos: [
      mando(() => dsiCeldaVal, v => { dsiCeldaVal = v; }, 'bass', 3, 1, 4, { step: true, ok: () => !(DSI_TRAMAS[dsiTramaVal] && DSI_TRAMAS[dsiTramaVal].diffusion) })] },
    DLPHN: { dice: 'El bajo sube el contraste; los agudos, el resplandor', mandos: [
      mando(() => dlpContrastVal, v => { dlpContrastVal = v; }, 'bass', 80, 50, 200),
      mando(() => dlpResonanceVal, v => { dlpResonanceVal = v; }, 'high', 60, 0, 100)] },
    CASKIA: { dice: 'El bajo sube el contraste; los medios, el tramado', solo: 'SEIKO', mandos: [
      mando(() => caskiaSeikoContrastVal, v => { caskiaSeikoContrastVal = v; }, 'bass', 45, 0, 100),
      mando(() => caskiaSeikoDitherVal, v => { caskiaSeikoDitherVal = v; }, 'mid', 50, 0, 100),
      mando(() => caskiaSeikoGhostVal, v => { caskiaSeikoGhostVal = v; }, 'high', 40, 0, 100)] },
    STAMP: { dice: 'El bajo ahonda el grabado; los medios cargan la tinta', mandos: [
      mando(() => stampEngraveVal, v => { stampEngraveVal = v; }, 'bass', 34, 0, 100),
      mando(() => stampInkVal, v => { stampInkVal = v; }, 'mid', 30, 0, 100)] },
    PRENSA: { dice: 'El bajo descuadra las planchas; los medios cargan la tinta', mandos: [
      mando(() => pressRegVal, v => { pressRegVal = v; }, 'bass', 60, 0, 100),
      mando(() => pressInkVal, v => { pressInkVal = v; }, 'mid', 30, 0, 100)] },
    SLHT: { dice: 'El bajo agranda las letras; los agudos las agitan', mandos: [
      mando(() => slhtGlyphSz, v => { slhtGlyphSz = v; }, 'bass', 8, 5, 18),
      mando(() => slhtNoiseAmt, v => { slhtNoiseAmt = v; }, 'high', 55, 0, 100)] },
  };
  const mapaDe = family => { const m = MAPA[family]; return m && (!m.solo || camVariant === m.solo) ? m : null; };

  // ── Oído: tres bandas y el golpe, del micrófono que ya está abierto ─────────
  // Un analizador propio, sin suavizado, colgado de la misma cadena (el de la app suaviza y borra
  // los golpes). Las bandas se normalizan entre un suelo y un techo que se adaptan despacio: da
  // igual si la música suena fuerte o lejos.
  const BANDAS = { bass: [35, 160], mid: [300, 2200], high: [4500, 12000] };
  const A = { ctx: null, node: null, db: null, at: 0, read: 0, env: { bass: 0, mid: 0, high: 0 }, top: {}, low: {}, flux: new Float32Array(64), fi: 0, lastFlux: 0, prev: null, beat: 0, beats: 0, beatAt: 0, peak: { bass: 0, mid: 0, high: 0 } };
  function wire() {
    if (typeof extAudioCtx === 'undefined' || !extAudioCtx || !extInGainNode) { A.ctx = A.node = null; return false; }
    if (A.ctx === extAudioCtx && A.node) return true;
    try {
      A.node = extAudioCtx.createAnalyser();
      A.node.fftSize = 1024; A.node.smoothingTimeConstant = 0; A.node.minDecibels = -100; A.node.maxDecibels = -10;
      extInGainNode.connect(A.node);
      A.db = new Float32Array(A.node.frequencyBinCount);
      A.prev = new Float32Array(8);
      A.ctx = extAudioCtx; A.top = {}; A.low = {}; A.flux.fill(0); A.at = 0;
      return true;
    } catch (_) { A.ctx = A.node = null; return false; }
  }
  const beatListeners = [];
  function onBeat(now) { A.beat = 1; A.beats++; A.beatAt = now; for (const fn of beatListeners) { try { fn(now); } catch (_) {} } }
  function analyze(now) {
    const dt = A.at ? Math.min(.25, (now - A.at) / 1000) : 1 / 30;
    A.at = now;
    A.beat *= Math.exp(-dt / .16);
    if (S.inject) {
      for (const key of ['bass', 'mid', 'high']) A.env[key] = clamp(+S.inject[key] || 0);
      if (S.inject.beat) { S.inject.beat = 0; onBeat(now); }
      return;
    }
    if (!wire()) { A.env.bass = A.env.mid = A.env.high = 0; return; }
    A.node.getFloatFrequencyData(A.db);
    const hz = A.ctx.sampleRate / A.node.fftSize;
    for (const key of ['bass', 'mid', 'high']) {
      const a = Math.max(1, Math.round(BANDAS[key][0] / hz)), b = Math.min(A.db.length - 1, Math.round(BANDAS[key][1] / hz));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += Math.pow(10, A.db[i] / 20);
      const db = 20 * Math.log10(sum / (b - a + 1) + 1e-9);
      // techo que cae 4 dB/s y suelo que sube 2 dB/s: la banda vale dónde está entre los dos
      A.top[key] = Math.max(db, (A.top[key] ?? db) - 4 * dt);
      A.low[key] = Math.min(db, (A.low[key] ?? db) + 2 * dt);
      const range = clamp(A.top[key] - A.low[key], 10, 40);
      const open = db > -78 && A.top[key] - A.low[key] > 5;
      const x = open ? Math.pow(clamp((db - (A.top[key] - range)) / range), 1.7) : 0;
      A.env[key] = x > A.env[key] ? x : A.env[key] * Math.exp(-dt / .16);      // sube al instante, baja en 160 ms
      if (A.env[key] > A.peak[key]) A.peak[key] = A.env[key];
    }
    // Golpe: lo que crece de un cuadro a otro en los graves (40–150 Hz), sobre su media reciente.
    const a = Math.max(1, Math.round(40 / hz)), b = Math.min(a + A.prev.length - 1, Math.round(150 / hz));
    let flux = 0;
    for (let i = a; i <= b; i++) { const amp = Math.pow(10, A.db[i] / 20), d = amp - A.prev[i - a]; if (d > 0) flux += d; A.prev[i - a] = amp; }
    let mean = 0, dev = 0;
    for (let i = 0; i < A.flux.length; i++) mean += A.flux[i];
    mean /= A.flux.length;
    for (let i = 0; i < A.flux.length; i++) dev += (A.flux[i] - mean) * (A.flux[i] - mean);
    dev = Math.sqrt(dev / A.flux.length);
    if (A.lastFlux > mean + dev * 2 + 2e-4 && flux < A.lastFlux && now - A.beatAt > 200 && A.env.bass > .25) onBeat(now);
    A.flux[A.fi++ % A.flux.length] = A.lastFlux;
    A.lastFlux = flux;
  }
  function levels(now) {
    if (now == null) now = performance.now();
    if (now - A.read > 4) { A.read = now; analyze(now); }
    return A.env;
  }

  // ── Mover el mando mientras se pinta el cuadro, y devolverlo ────────────────
  const render = _renderCamEngineFrame;
  _renderCamEngineFrame = function (source, srcW, srcH, targetCtx, mirror, options) {
    if (!S.on || activeTab !== 'cam') return render.apply(this, arguments);
    const lv = levels(options && options.now);
    if (!options || options.path !== 'capture') latir(lv.bass);
    const mapa = mapaDe((options && options.family) || camFamily);
    if (!mapa) { S.applied = null; return render.apply(this, arguments); }
    const saved = [], applied = [];
    for (const m of mapa.mandos) {
      if (m.ok && !m.ok()) continue;
      const base = m.get();
      let v = clamp(base + lv[m.band] * m.span, m.min, m.max);
      if (m.step) v = Math.round(v);
      saved.push(m, base);
      applied.push(v);
      m.set(v);
    }
    S.applied = applied; const path = (options && options.path) || 'preview'; S.paths[path] = (S.paths[path] || 0) + 1;
    try { return render.apply(this, arguments); }
    finally { for (let i = 0; i < saved.length; i += 2) saved[i].set(saved[i + 1]); }
  };
  // La cámara del disparador late con el bajo: se ve que está oyendo. Va con los cuadros de la
  // cámara (no tiene bucle propio: apagada, la escucha no despierta nada).
  let pulso = 0;
  function latir(bass) {
    const v = Math.round(bass * 20) / 20;
    if (v === pulso) return;
    pulso = v;
    if (v) shutter.style.setProperty('--pulso', v); else shutter.style.removeProperty('--pulso');
  }

  // ── Disparar al golpe ──────────────────────────────────────────────────────
  // Con AL GOLPE, el disparador no toma la foto al tocarlo: cierra el ojo y espera el siguiente
  // golpe (o 2,5 s si no llega ninguno). Una foto por toque, justo en el pulso.
  function fire() {
    if (!S.armed) return;
    S.armed = false;
    clearTimeout(S.timer);
    shutter.classList.remove('espera');
    S.bypass = true;
    try { shutter.click(); } finally { S.bypass = false; }
  }
  shutter.addEventListener('click', event => {
    if (S.bypass || !S.on || !S.golpe || activeTab !== 'cam' || body.classList.contains('cam-video') || body.classList.contains('is-recording')) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (S.armed) return;
    S.armed = true;
    shutter.classList.add('espera');
    if (window.flipShell) flipShell.hint('Esperando el golpe…', 2400);
    S.timer = setTimeout(fire, 2500);
  }, true);
  beatListeners.push(() => { if (S.armed) fire(); });

  // ── Encender y apagar ──────────────────────────────────────────────────────
  const micOn = () => (typeof extMicOnlyMode !== 'undefined' && extMicOnlyMode) || (typeof extAudioMode !== 'undefined' && extAudioMode);
  const waitMic = ms => new Promise(resolve => { const from = Date.now(); (function poll() { if (micOn()) resolve(true); else if (Date.now() - from > ms) resolve(false); else setTimeout(poll, 120); })(); });
  async function set(on, options = {}) {
    on = !!on;
    if (on === S.on) return S.on;
    if (on && !S.inject && options.mic !== false && !micOn()) {
      // el mismo botón de micrófono de la app (pide el permiso dentro del toque)
      const key = $('btnMicMobile');
      if (key) key.click(); else if (typeof startMicOnly === 'function') startMicOnly().catch(() => {});
      S.mic = true;
      if (!(await waitMic(9000))) {
        S.mic = false;
        if (typeof flipToast === 'function') flipToast('Para escuchar hace falta el micrófono. Actívalo y vuelve a intentarlo.', 4200);
        paint();
        return false;
      }
    }
    if (!on) {
      if (S.armed) { S.armed = false; clearTimeout(S.timer); shutter.classList.remove('espera'); }
      if (S.mic && micOn()) { const key = $('btnMicMobile'); if (key && key.classList.contains('active')) key.click(); }
      S.mic = false;
    }
    S.on = on;
    vigilar(on);
    if (!on) latir(0);
    body.dataset.escucha = on ? 'si' : 'no';
    A.peak.bass = A.peak.mid = A.peak.high = 0;
    paint();
    if (on && window.flipShell) { const m = mapaDe(camFamily); flipShell.hint(m ? m.dice + '.' : 'Esta cámara todavía no se mueve con el sonido; puede disparar al golpe.', 3200); }
    return S.on;
  }

  // ── Mandos: una fila en el cajón «cámaras y filtros» de la piel INTERFAZ ────
  const cajon = $('siCajon');
  let fila = null;
  if (cajon && window.flipShell) {
    fila = flipShell.el('div', { class: 'si-cajon-fila si-escucha' }, `<small>ESCUCHA</small>
      <div class="si-filtros" role="group" aria-label="Cámaras que escuchan">
        <button class="hw si-chip" type="button" id="escuchaOn" aria-pressed="false">ESCUCHAR</button>
        <button class="hw si-chip" type="button" id="escuchaGolpe" aria-pressed="false">AL GOLPE</button>
      </div><p class="si-escucha-dice" aria-live="polite"></p>`);
    cajon.insertBefore(fila, cajon.querySelector(':scope > .grano'));
    $('escuchaOn').addEventListener('click', () => set(!S.on));
    $('escuchaGolpe').addEventListener('click', () => { S.golpe = !S.golpe; save(); paint(); });
  }
  function paint() {
    if (!fila) return;
    const on = $('escuchaOn'), golpe = $('escuchaGolpe'), m = mapaDe(camFamily);
    on.classList.toggle('is-on', S.on); on.setAttribute('aria-pressed', String(S.on));
    golpe.classList.toggle('is-on', S.golpe); golpe.setAttribute('aria-pressed', String(S.golpe));
    fila.querySelector('.si-escucha-dice').textContent = !S.on ? 'El sonido del lugar mueve la cámara. Usa el micrófono; nada se sube.'
      : (m ? m.dice + '.' : 'Esta cámara todavía no se mueve con el sonido.') + (S.golpe ? ' El disparador espera el golpe.' : '');
  }
  body.dataset.escucha = 'no';
  paint();
  // Al cambiar de cámara, la fila dice qué mueve en la nueva.
  const looks = $('deckLooks');
  if (looks) new MutationObserver(() => queueMicrotask(paint)).observe(looks, { subtree: true, attributes: true, attributeFilter: ['class'] });
  // Si el micrófono se apaga por fuera (el botón de AUDIO, la app en segundo plano), la escucha también.
  // Mientras la escucha está encendida (y solo entonces) hay dos relojes: el oído, 50 veces por
  // segundo —una cámara que pinta 8 cuadros por segundo se perdería los golpes si oyera a su
  // ritmo—, y un vigía del micrófono.
  let vigia = 0, oido = 0;
  const vigilar = on => {
    clearInterval(vigia); clearInterval(oido);
    vigia = on ? setInterval(() => { if (S.on && !S.inject && !micOn()) { S.mic = false; set(false); } }, 1500) : 0;
    oido = on ? setInterval(() => { if (!document.hidden) levels(); }, 20) : 0;
  };

  window.flipEscucha = {
    set, get on() { return S.on; },
    golpe(on) { if (on != null) { S.golpe = !!on; save(); paint(); } return S.golpe; },
    levels: () => ({ ...levels(), beat: A.beat, beats: A.beats }),
    // Para las pruebas: niveles a mano (sin micrófono) y lo que se aplicó en el último cuadro.
    inject(lv) { S.inject = lv ? { bass: 0, mid: 0, high: 0, beat: 0, ...lv } : null; },
    state: () => ({ on: S.on, golpe: S.golpe, armed: S.armed, applied: S.applied && S.applied.slice(), paths: { ...S.paths }, mic: micOn(), peak: { ...A.peak }, beats: A.beats, mueve: !!mapaDe(camFamily) }),
    onBeat(fn) { beatListeners.push(fn); },
    mapa: MAPA,
  };
})();
