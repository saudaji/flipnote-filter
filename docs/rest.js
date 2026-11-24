// FLIP · la cámara descansa cuando nadie la mira.
//
// Lo que más calienta el teléfono no es FLIP: es tener la cámara abierta. Medido en un Samsung,
// con la cámara encendida y FLIP sin dibujar nada el teléfono ya tiene ocupados unos 3 núcleos; con
// la cámara apagada, medio (ALPHA-PASS7.md). Eso solo se evita no teniéndola encendida de más:
//
//   · Con el visor de la última toma abierto, o el lanzador de módulos, la cámara se suelta y los
//     bucles de dibujo esperan. Al cerrar, vuelven.
//   · Reposo: si el teléfono lleva un minuto quieto (el sensor de orientación no se mueve) y sin
//     toques, la cámara se apaga y la pantalla lo dice. Despierta al tocarla o al levantarlo.
//
// Nunca mientras se graba, ni en STAGE (lo que sale por la otra pantalla no puede pararse). El
// reposo, además, tampoco con PORTAL (se maneja con las manos, sin tocar) ni cuando la imagen la
// mueve el sonido. Y sin sensor de orientación (un ordenador, un iPhone sin su permiso) no hay
// reposo: no se podría distinguir un teléfono en la mesa de uno en la mano.
(function () {
  'use strict';

  const cfg = {
    idle: 60000,                              // ms quieto y sin toques antes del reposo
    warn: 10000,                              // ms de aviso previo en la pantallita
    tick: 2500,                               // cada cuánto se mira
    tilt: 2.5,                                // grados de cambio de postura que cuentan como «lo mueven»
    wakeTilt: 6,                              // grados para despertarlo al levantarlo
    delays: { viewer: 1200, launcher: 5000 }, // ms abiertos antes de soltar la cámara
  };
  const holds = new Map();                    // motivo → temporizador (aún sin aplicar) o true
  const st = { paused: false, parked: false, resting: false, lastInput: performance.now(), lastMove: 0, motion: false, posture: null, restPosture: null, tiltAt: 0, rests: 0, wakes: 0 };

  // Grabaciones en curso, sean del módulo que sean.
  const recorders = new Set();
  if (typeof MediaRecorder === 'function') {
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function () {
      recorders.add(this);
      this.addEventListener('stop', () => { recorders.delete(this); sync(); }, { once: true });
      return start.apply(this, arguments);
    };
  }
  const recording = () => { for (const recorder of recorders) if (recorder.state !== 'inactive') return true; return false; };
  const tab = () => { try { return activeTab; } catch (_) { return 'cam'; } };
  const inStage = () => tab() === 'stage' || document.body.classList.contains('stage-mode');
  const wantsCamera = () => {
    const now = tab();
    return CAMERA_TABS.has(now) || now === 'stage' || (now === 'edit' && editSource && editSource.type === 'cam');
  };

  // ── Soltar y recuperar ──────────────────────────────────────────────────────
  function sync() {
    let want = false;
    for (const value of holds.values()) if (value === true) want = true;
    if (want && (inStage() || recording())) want = false;
    if (want === st.paused) return;
    st.paused = want;
    if (want) {
      // Misma vía que al pasar a segundo plano: cameraParked evita el aviso de «cámara apagada».
      if (stream || cameraRequest) { cameraParked = true; st.parked = true; }
      releaseCamera();
      pauseFrames(true);
      return;
    }
    pauseFrames(false);
    if (!st.parked) return;
    st.parked = false;
    if (document.visibilityState === 'hidden') return;       // la vuelta del segundo plano la enciende
    cameraParked = false;
    if (wantsCamera() && !stream && !cameraRequest && !extAudioMode) startCamera(facingMode).catch(() => {});
    else syncCameraGate();
  }
  function hold(reason, delay) {
    if (holds.has(reason)) return;
    const ms = delay === undefined ? (cfg.delays[reason] || 0) : delay;
    if (ms > 0) holds.set(reason, setTimeout(() => { holds.set(reason, true); sync(); }, ms));
    else { holds.set(reason, true); sync(); }
  }
  function release(reason) {
    const value = holds.get(reason);
    if (value === undefined) return;
    if (value !== true) clearTimeout(value);
    holds.delete(reason);
    // Un instante después: si se cierra el lanzador para cambiar de módulo, que decida el módulo nuevo.
    setTimeout(sync, 0);
  }

  // ── Reposo ──────────────────────────────────────────────────────────────────
  function veil() {
    let node = document.getElementById('restVeil');
    if (node) return node;
    node = document.createElement('div');
    node.id = 'restVeil';
    node.hidden = true;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', 'Cámara en reposo. Toca para seguir.');
    node.innerHTML = '<div class="rest-note"><i></i><b>EN REPOSO</b><span>Toca la pantalla o levanta el teléfono</span></div>';
    document.body.appendChild(node);
    // El toque que despierta no pulsa lo que haya debajo: el velo lo recoge entero y se retira al soltar.
    node.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); wake(true); });
    const lift = event => { event.preventDefault(); event.stopPropagation(); if (!st.resting) node.hidden = true; };
    node.addEventListener('pointerup', lift);
    node.addEventListener('pointercancel', lift);
    node.addEventListener('click', lift);
    return node;
  }
  function eligible() {
    if (document.hidden || st.resting || !stream) return false;
    if (inStage() || recording() || document.body.classList.contains('portal-mode')) return false;
    if (extAudioMode || extMicOnlyMode) return false;
    const now = tab();
    return CAMERA_TABS.has(now) || now === 'edit';
  }
  function rest() {
    st.resting = true;
    st.rests++;
    st.restPosture = st.posture ? st.posture.slice() : null;
    veil().hidden = false;
    document.body.classList.remove('is-waking');
    document.body.classList.add('is-resting');
    hold('idle', 0);
  }
  function wake(byTouch) {
    if (!st.resting) return;
    st.resting = false;
    st.wakes++;
    st.lastInput = performance.now();
    document.body.classList.remove('is-resting');
    document.body.classList.add('is-waking');
    if (!byTouch) veil().hidden = true;
    else setTimeout(() => { if (!st.resting) veil().hidden = true; }, 500);
    release('idle');
    // El visor sigue apagado hasta que la cámara entrega imagen (o no va a volver sola).
    const began = performance.now();
    const back = () => {
      if (st.resting) return;
      const live = !!stream && typeof vid !== 'undefined' && vid.videoWidth > 0;
      if (live || performance.now() - began > 4000) document.body.classList.remove('is-waking');
      else setTimeout(back, 150);
    };
    setTimeout(back, 150);
  }
  function check() {
    try {
      if (!st.motion || !eligible()) return;
      const quiet = performance.now() - Math.max(st.lastInput, st.lastMove);
      if (quiet >= cfg.idle) { rest(); return; }
      if (quiet >= cfg.idle - cfg.warn && window.flipShell) {
        flipShell.readout('REPOSO EN', Math.max(1, Math.round((cfg.idle - quiet) / 1000)) + ' S', null);
      }
    } catch (_) {}
  }
  let timer = setInterval(check, cfg.tick);

  // ── Qué cuenta como «lo están usando» ───────────────────────────────────────
  function onInput(event) {
    st.lastInput = performance.now();
    // Con el teclado (o cualquier cosa que no sea el velo) también despierta, sin hacer nada más.
    if (st.resting && !(event.target && event.target.closest && event.target.closest('#restVeil'))) {
      if (event.type === 'keydown') { event.preventDefault(); event.stopPropagation(); }
      wake(false);
    }
  }
  for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, onInput, { capture: true, passive: type !== 'keydown' });
  function onTilt(event) {
    if (event.beta == null || event.gamma == null) return;
    const now = performance.now();
    if (now - st.tiltAt < 200) return;
    st.tiltAt = now;
    st.motion = true;
    const posture = st.posture;
    if (!posture) { st.posture = [event.beta, event.gamma]; st.lastMove = now; return; }
    if (Math.abs(event.beta - posture[0]) > cfg.tilt || Math.abs(event.gamma - posture[1]) > cfg.tilt) {
      st.posture = [event.beta, event.gamma];
      st.lastMove = now;
    }
    const at = st.restPosture;
    if (st.resting && at && (Math.abs(event.beta - at[0]) > cfg.wakeTilt || Math.abs(event.gamma - at[1]) > cfg.wakeTilt)) wake(false);
  }
  let listening = false;
  function listen(on) {
    if (on === listening || !('DeviceOrientationEvent' in window)) return;
    listening = on;
    if (on) window.addEventListener('deviceorientation', onTilt, { passive: true });
    else { window.removeEventListener('deviceorientation', onTilt); st.posture = null; }
  }
  document.addEventListener('visibilitychange', () => listen(!document.hidden));
  listen(!document.hidden);

  window.flipRest = {
    hold, release,
    // ¿Tiene este módulo la cámara soltada y los bucles en espera?
    holding: () => st.paused,
    state: () => ({ paused: st.paused, parked: st.parked, resting: st.resting, holds: [...holds].map(([reason, value]) => reason + (value === true ? '' : ' (en espera)')), motion: st.motion, recording: recording(), rests: st.rests, wakes: st.wakes }),
    // Para las pruebas: tiempos más cortos.
    config(next) {
      for (const key of Object.keys(next || {})) {
        if (key === 'delays') Object.assign(cfg.delays, next.delays);
        else if (key in cfg) cfg[key] = next[key];
      }
      clearInterval(timer);
      timer = setInterval(check, cfg.tick);
      return { ...cfg, delays: { ...cfg.delays } };
    },
  };
})();
