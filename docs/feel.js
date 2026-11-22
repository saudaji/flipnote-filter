// FLIP FL-27 · tacto: el sonido y la vibración de las teclas.
// Cada pieza suena como lo que es, y todas suenan a plástico golpeando plástico: un chasquido
// seco y corto, sin nota. El disparador pesa y tiene dos tiempos (hundirlo y la cortinilla); las
// teclas hacen clac al bajar y un tic más fino al subir; los botones redondos son sordos; el
// interruptor roza y encaja; las perillas y los deslizadores marcan muescas. La vibración lleva
// el mismo ritmo que el sonido: un golpe, un pulso.
//
// Para que no sea una cacofonía:
//   · solo suena lo que el dedo pulsa de verdad, nunca un cambio automático;
//   · lo que vive dentro de una lista que se desplaza suena al elegirlo, no al tocarlo;
//   · un sonido cada vez: si coinciden dos, gana la pieza más importante;
//   · mientras se graba las teclas callan y queda solo la vibración; con el micrófono abierto bajan;
//   · las muescas se espacian y se apagan cuanto más deprisa se gira.
// Todo se sintetiza aquí (no hay archivos de audio). Un golpe es un impulso seco más un soplo de
// ruido que se apaga, pasados por bandas muy anchas: nada resuena el tiempo suficiente para
// dejar una altura. Lo agudo dura un milisegundo; lo grave, diez.
(function () {
  'use strict';
  const STORE = 'flip.feel.v1';
  const prefs = { sound: true, haptic: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (_) {}

  // ── Recetas ─────────────────────────────────────────────────────────────────
  // hits: golpes, cada uno en su instante (at, ms) y con su fuerza (gain). Un golpe suma bandas
  // [Hz, anchura q, caída ms, nivel, grano, subida ms]: q ≈ 1 es más de una octava (sin altura);
  // grano es cuánto de la banda es ruido que se apaga (el resto, el impulso seco del contacto);
  // la subida solo la usan los roces. contact: lo que dura el contacto (ms): más largo, más blando.
  // lp: paso bajo final (Hz).
  const RECIPES = {
    // Tecla: el contacto, a los 6 ms el tope con cuerpo, y un rebote mínimo.
    keyDown: { contact: .14, hits: [
      { gain: .5, bands: [[4200, .8, .8, .5, .35], [2000, .8, 1.5, .5, .45]] },
      { at: 6, bands: [[2100, .8, 2.6, .9, .55], [1150, .8, 3.4, .6, .6], [3600, .8, 1.5, .55, .5], [5800, .8, .8, .3, .4], [520, .8, 4.5, .34, .6], [260, .8, 5, .16, .55], [1400, .7, 12, .055, 1]] },
      { at: 10.5, gain: .18, bands: [[1700, .8, 2, .7, .6], [3200, .8, 1.1, .5, .5]] }] },
    // Al subir, el tope de arriba: más fino y más ligero.
    keyUp: { contact: .12, hits: [{ bands: [[2600, .8, 1.9, .8, .5], [1500, .8, 2.4, .5, .55], [4600, .8, 1, .5, .45], [6500, .8, .6, .2, .4], [800, .8, 3, .2, .6], [1800, .7, 9, .045, 1]] }] },
    // Tecla grande: más grave, con más caja.
    primaryDown: { contact: .18, hits: [
      { gain: .45, bands: [[3000, .8, 1, .5, .35], [1500, .8, 1.8, .5, .5]] },
      { at: 8, bands: [[1500, .8, 3, .85, .55], [800, .8, 4.2, .7, .6], [2800, .8, 1.8, .5, .5], [4800, .8, .9, .25, .4], [380, .8, 6, .42, .6], [190, .8, 7, .22, .55], [1000, .7, 15, .06, 1]] },
      { at: 13.5, gain: .18, bands: [[1200, .8, 2.6, .7, .6], [2400, .8, 1.3, .45, .5]] }] },
    primaryUp: { contact: .15, hits: [{ bands: [[2000, .8, 2.2, .75, .5], [1100, .8, 3, .5, .55], [3700, .8, 1.1, .45, .45], [600, .8, 3.5, .22, .6], [1400, .7, 10, .045, 1]] }] },
    // Disparador: hundirlo pesa; al soltar, la cortinilla en dos tiempos con el mecanismo entre medias.
    shutterDown: { contact: .25, hits: [
      { gain: .35, bands: [[2600, .8, 1.1, .5, .4]] },
      { at: 5, bands: [[1300, .8, 3.2, .8, .55], [700, .8, 4.5, .75, .6], [2500, .8, 1.8, .45, .5], [4200, .8, .9, .2, .4], [330, .8, 6.5, .45, .6], [170, .8, 7.5, .25, .55], [900, .7, 15, .06, 1]] }] },
    shutterFire: { contact: .12, hits: [
      { gain: .85, bands: [[3200, .8, 1.6, .8, .5], [5600, .8, 1, .6, .45], [1700, .8, 2.2, .5, .55], [800, .8, 2.8, .25, .55]] },
      { at: 5, gain: .08, bands: [[5200, .7, 12, 1, 1, 3]] },
      { at: 46, bands: [[2400, .8, 2.4, .8, .55], [1300, .8, 3.4, .65, .6], [4300, .8, 1.3, .55, .45], [6800, .8, .7, .25, .4], [600, .8, 5, .4, .6], [280, .8, 6, .2, .55], [1500, .7, 14, .055, 1]] }] },
    // Botón redondo: plástico más blando, sordo.
    softDown: { contact: .5, lp: 6000, hits: [{ bands: [[900, .8, 3.6, .85, .6], [500, .8, 5, .6, .6], [1700, .8, 2.2, .5, .5], [2900, .8, 1.2, .2, .45], [240, .8, 6, .25, .55]] }] },
    softUp: { contact: .4, lp: 6400, hits: [{ bands: [[1300, .7, 2.4, .7, .6], [700, .7, 3, .45, .6], [2400, .7, 1.4, .4, .5], [3800, .7, .9, .16, .45]] }] },
    // Interruptor deslizante: el roce y, al final del recorrido, el encaje.
    switch: { contact: .1, hits: [
      { gain: .28, bands: [[3000, .7, 6, 1, 1, 4]] },
      { at: 34, bands: [[3000, .8, 1.6, .8, .45], [5400, .8, .9, .5, .4], [1600, .8, 2.4, .55, .55], [800, .8, 3.4, .3, .6], [330, .8, 5, .15, .55], [1500, .7, 11, .045, 1]] }] },
    // Diapositiva que cae en su ranura.
    slide: { contact: .14, hits: [
      { gain: .6, bands: [[3300, .8, 1.1, .5, .4], [1800, .8, 1.7, .5, .5]] },
      { at: 22, bands: [[1700, .8, 2.8, .8, .55], [950, .8, 3.8, .6, .6], [3100, .8, 1.4, .45, .5], [450, .8, 5, .3, .6], [1300, .7, 12, .05, 1]] }] },
    // Muesca de perilla o deslizador.
    tick: { contact: .1, hits: [{ bands: [[2600, .6, 1, .7, .6], [5000, .6, .7, .55, .55], [1300, .6, 1.5, .45, .6], [7200, .6, .5, .2, .5], [700, .6, 1.8, .2, .6]] }] },
  };

  // Cada pieza: su rango (quién gana si coinciden), y qué suena y vibra al bajar, al subir y al
  // actuar. vib: milisegundos, o un patrón [vibra, pausa, vibra…] con el ritmo del sonido.
  const KINDS = {
    shutter: { rank: 5, down: { sound: 'shutterDown', gain: .95, vib: 14 }, fire: { sound: 'shutterFire', gain: 1, vib: [9, 37, 13] } },
    primary: { rank: 4, down: { sound: 'primaryDown', gain: .92, vib: 16 }, up: { sound: 'primaryUp', gain: .52 } },
    key: { rank: 3, down: { sound: 'keyDown', gain: .8, vib: 9 }, up: { sound: 'keyUp', gain: .45 } },
    switch: { rank: 3, late: true, down: { sound: 'switch', gain: .7, vib: [4, 30, 8] } },
    soft: { rank: 2, down: { sound: 'softDown', gain: .56, vib: 6 }, up: { sound: 'softUp', gain: .27 } },
    slide: { rank: 2, late: true, down: { sound: 'slide', gain: .6, vib: [3, 19, 6] } },
    plain: { rank: 2, down: { sound: 'softDown', gain: .42, vib: 5 } },
    tick: { rank: 1, down: { sound: 'tick', gain: .2, vib: 2 } },
  };
  // De la pieza más concreta a la más genérica.
  const MAP = [
    ['#deckShutter', 'shutter'],
    ['.hw-switch, [role="switch"], input[type="checkbox"]', 'switch'],
    ['.launcher-card, .splash-door, .btn-center, .viewer-actions .primary', 'primary'],
    ['.look, .flip-settings-tile', 'slide'],
    ['.hw-keycap, .flip-settings-pill, .flip-settings-segments button, #palettes button, #palettes label.asp-btn', 'key'],
    ['.hw-candy, #deckGallery, #sflowAdjust', 'soft'],
    ['button, .btn, [role="button"], summary', 'plain'],
  ];
  const ANY = '[data-feel], ' + MAP.map(entry => entry[0]).join(', ');
  function find(target) {
    const node = target && target.closest ? target.closest(ANY) : null;
    if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return null;
    const tagged = node.dataset.feel;
    if (tagged) return KINDS[tagged] ? { node, name: tagged } : null;      // data-feel="none" calla la pieza
    for (const [selector, name] of MAP) if (node.matches(selector)) return { node, name };
    return null;
  }
  // ¿Está dentro de algo que se desplaza? Entonces el toque puede ser el inicio de un arrastre.
  function scrolls(node) {
    for (let parent = node.parentElement, depth = 0; parent && parent !== document.body && depth < 14; parent = parent.parentElement, depth++) {
      const tall = parent.scrollHeight > parent.clientHeight + 2, wide = parent.scrollWidth > parent.clientWidth + 2;
      if (!tall && !wide) continue;
      const style = getComputedStyle(parent);
      if ((tall && /auto|scroll/.test(style.overflowY)) || (wide && /auto|scroll/.test(style.overflowX))) return true;
    }
    return false;
  }

  // ── Síntesis ────────────────────────────────────────────────────────────────
  const RATE = 48000, VARIANTS = 3;
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // Paso de banda de dos polos con ganancia de pico constante, en el sitio.
  function bandpass(x, f, q, sr) {
    const w0 = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
    const b0 = alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * (v - x2) - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
  }
  function unit(x) {
    let peak = 0;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    if (peak > 0) for (let i = 0; i < x.length; i++) x[i] /= peak;
  }
  function synth(recipe, seed, sr = RATE) {
    const rnd = mulberry(seed);
    let end = 0;
    for (const hit of recipe.hits) for (const band of hit.bands) end = Math.max(end, (hit.at || 0) + (band[5] || 0) + band[2] * 7 + 4);
    const n = Math.ceil((end + 6) * sr / 1000);
    const out = new Float32Array(n);
    const tune = 1 + (rnd() - 0.5) * 0.07;                       // cada tecla, un pelo distinta
    const touch = Math.max(2, Math.round((recipe.contact || 0.14) * sr / 1000));
    for (const hit of recipe.hits) {
      const start = Math.round((hit.at || 0) * sr / 1000), g = hit.gain == null ? 1 : hit.gain;
      for (const [f, q, decay, level, grit, rise = 0] of hit.bands) {
        const tau = decay * sr / 1000, up = Math.max(2, Math.round((rise || 0.1) * sr / 1000));
        const count = Math.max(8, Math.min(n - start, Math.ceil(tau * 7 + up + sr * 0.003)));
        const centre = f * tune * (1 + (rnd() - 0.5) * 0.05), amp = level * g * (0.88 + rnd() * 0.24);
        // El impulso seco: lo que dura el contacto, medio coseno.
        const dry = new Float32Array(count);
        if (grit < 1) {
          for (let i = 0; i < touch && i < count; i++) dry[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / touch);
          bandpass(dry, centre, q, sr);
          unit(dry);
        }
        // El grano: ruido que se apaga, por dos bandas seguidas para que no sisee fuera de la suya.
        const wet = new Float32Array(count);
        if (grit > 0) {
          for (let i = 0; i < count; i++) wet[i] = (rnd() * 2 - 1) * Math.min(1, i / up) * Math.exp(-Math.max(0, i - up) / tau);
          bandpass(wet, centre, q * 0.8, sr);
          bandpass(wet, centre, q * 0.8, sr);
          unit(wet);
        }
        for (let i = 0; i < count; i++) out[start + i] += amp * ((1 - grit) * dry[i] + grit * wet[i]);
      }
    }
    // Paso alto (nada de bombeo por debajo de lo que un altavoz pequeño mueve) y paso bajo final.
    const pass = (f, high) => {
      const w0 = 2 * Math.PI * f / sr, cos = Math.cos(w0), alpha = Math.sin(w0) / 1.414, a0 = 1 + alpha;
      const b0 = (high ? (1 + cos) / 2 : (1 - cos) / 2) / a0, b1 = (high ? -(1 + cos) : 1 - cos) / a0, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) { const x = out[i], y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y; }
    };
    pass(110, true);
    pass(recipe.lp || 11000, false);
    // Un punto de saturación: el golpe gana cuerpo sin subir el pico.
    unit(out);
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 1.5);
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    const scale = peak > 0 ? 0.9 / peak : 0, tail = Math.round(sr * 0.004);
    for (let i = 0; i < n; i++) out[i] *= scale * Math.min(1, (n - i) / tail);
    return out;
  }
  let buffers = null;
  function build() {
    if (buffers || typeof AudioBuffer === 'undefined') return;
    const made = {};
    try {
      Object.keys(RECIPES).forEach((name, index) => {
        made[name] = [];
        for (let v = 0; v < VARIANTS; v++) {
          const data = synth(RECIPES[name], 977 + index * 131 + v * 17);
          const buffer = new AudioBuffer({ length: data.length, sampleRate: RATE, numberOfChannels: 1 });
          buffer.getChannelData(0).set(data);
          made[name].push(buffer);
        }
      });
      buffers = made;
    } catch (_) { buffers = null; }
  }
  if (prefs.sound) (window.requestIdleCallback || (fn => setTimeout(fn, 600)))(build, { timeout: 2500 });

  // ── Salida ──────────────────────────────────────────────────────────────────
  let ctx = null, bus = null, pending = null;
  const turn = {};
  // Un contexto de audio en marcha mantiene despierto el hilo de sonido aunque no suene nada: tras
  // unos segundos sin teclas se suspende, y el siguiente toque lo despierta.
  let nap = 0;
  function rest() {
    clearTimeout(nap);
    nap = setTimeout(() => { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 9000);
  }
  function wake() {
    if (!prefs.sound) return;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { try { ctx = new AC(); } catch (__) { return; } }
      bus = ctx.createGain();
      bus.gain.value = 1;
      bus.connect(ctx.destination);
      // El primer toque llega antes de que el navegador deje sonar: se toca al abrirse el paso.
      ctx.onstatechange = () => {
        if (ctx.state !== 'running' || !pending) return;
        const wait = pending; pending = null;
        if (performance.now() - wait.at < 160) play(wait.sound, wait.gain, wait.x, 0);
      };
      build();
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    rest();
  }
  function play(sound, gain, x, delay) {
    if (!ctx || !bus || !buffers || !buffers[sound]) return false;
    if (ctx.state !== 'running') { if (!delay) pending = { sound, gain, x, at: performance.now() }; return false; }
    const set = buffers[sound];
    turn[sound] = ((turn[sound] || 0) + 1 + (Math.random() * (set.length - 1) | 0)) % set.length;
    const source = ctx.createBufferSource();
    source.buffer = set[turn[sound]];
    source.playbackRate.value = 1 + (Math.random() - 0.5) * 0.045;
    const amp = ctx.createGain();
    amp.gain.value = gain * (0.92 + Math.random() * 0.16);
    source.connect(amp);
    // Cada pieza suena desde donde está: las de la izquierda, un poco a la izquierda.
    if (ctx.createStereoPanner && x != null && innerWidth > 0) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.6, Math.min(0.6, (x / innerWidth - 0.5) * 1.1));
      amp.connect(pan); pan.connect(bus);
    } else amp.connect(bus);
    source.start(ctx.currentTime + (delay || 0) / 1000);
    return true;
  }
  function buzz(pattern, delay) {
    if (!prefs.haptic || !navigator.vibrate || !pattern) return false;
    const go = () => { try { navigator.vibrate(pattern); } catch (_) {} };
    if (delay) setTimeout(go, delay); else go();
    return true;
  }

  // ── Cuándo callar ───────────────────────────────────────────────────────────
  const hushed = new Set();
  const recording = () => hushed.size > 0 || document.body.classList.contains('is-recording') || !!document.querySelector('.btn.recording');
  // Micrófonos abiertos por cualquier módulo: el altavoz se cuela en ellos.
  const microphones = new Set();
  // Safari recoge el envoltorio de navigator.mediaDevices si nadie lo sujeta, y con él esta función:
  // se guarda una referencia para que siga puesta.
  const devices = navigator.mediaDevices;
  if (devices && devices.getUserMedia) {
    const open = devices.getUserMedia.bind(devices);
    devices.getUserMedia = function (constraints) {
      const request = open(constraints);
      if (constraints && constraints.audio) request.then(stream => stream.getAudioTracks().forEach(track => microphones.add(track)), () => {});
      return request;
    };
  }
  function micLive() {
    for (const track of microphones) { if (track.readyState === 'live') return true; microphones.delete(track); }
    return false;
  }

  // ── Un toque ────────────────────────────────────────────────────────────────
  const GATE = 22;                                    // ms entre sonidos
  let last = { at: -1e9, rank: 0, name: '' };
  const log = [];
  function emit(name, phase, x, delay) {
    const kind = KINDS[name], step = kind && kind[phase];
    if (!step) return false;
    const at = performance.now() + (delay || 0);
    if (at - last.at < GATE && kind.rank <= last.rank) return false;
    // Tamborilear sobre la misma pieza no suma volumen.
    const drum = name === last.name && at - last.at < 110 ? 0.72 : 1;
    last = { at, rank: kind.rank, name };
    const level = recording() ? 0 : micLive() ? 0.3 : 1;
    const sounded = prefs.sound && level > 0 && !document.hidden ? play(step.sound, step.gain * level * drum, x, delay) || !!pending : false;
    const vibrated = step.vib ? buzz(step.vib, delay) : false;
    log.push({ kind: name, phase, sound: sounded ? step.sound : '', vib: vibrated ? step.vib : 0, gain: +(step.gain * level * drum).toFixed(3), at: Math.round(at) });
    if (log.length > 60) log.shift();
    return true;
  }
  // Muesca de perilla o deslizador: como mucho una cada 30 ms, y más suave cuanto más rápido.
  let lastTick = 0, tickRun = 0;
  function detent(x) {
    const now = performance.now(), gap = now - lastTick;
    if (gap < 30) return false;
    tickRun = gap < 90 ? Math.min(tickRun + 1, 8) : 0;
    lastTick = now;
    const level = recording() ? 0 : micLive() ? 0.3 : 1;
    const gain = KINDS.tick.down.gain * level * (1 - tickRun * 0.07);
    const sounded = prefs.sound && level > 0 && !document.hidden ? play('tick', gain, x, 0) : false;
    const vibrated = tickRun % 2 === 0 ? buzz(KINDS.tick.down.vib, 0) : false;       // la mitad de pulsos al girar deprisa
    log.push({ kind: 'tick', phase: 'down', sound: sounded ? 'tick' : '', vib: vibrated ? KINDS.tick.down.vib : 0, gain: +gain.toFixed(3), at: Math.round(now) });
    if (log.length > 60) log.shift();
    return true;
  }

  let press = null;
  document.addEventListener('pointerdown', event => {
    if (!event.isTrusted || event.button > 0) return;
    wake();
    const hit = find(event.target);
    if (!hit) { press = null; return; }
    const kind = KINDS[hit.name];
    press = { node: hit.node, name: hit.name, at: performance.now(), x: event.clientX, late: !!kind.late || scrolls(hit.node), wasRecording: recording() };
    if (!press.late) emit(press.name, 'down', press.x);
  }, { capture: true, passive: true });
  document.addEventListener('pointerup', event => {
    if (!event.isTrusted || !press) return;
    wake();
    const held = performance.now() - press.at;
    if (!press.late && held > 38) emit(press.name, 'up', press.x);
  }, { capture: true, passive: true });
  document.addEventListener('pointercancel', () => { press = null; }, { capture: true, passive: true });
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    wake();
    const hit = find(event.target);
    const mine = press && hit && press.node === hit.node ? press : null;
    press = null;
    if (!hit) return;
    const x = mine ? mine.x : (hit.node.getBoundingClientRect().left + hit.node.offsetWidth / 2);
    // Lo que esperaba a confirmarse (listas, interruptores) y lo que llega por teclado suena ahora.
    if ((mine && mine.late) || (!mine && event.detail === 0)) {
      if (emit(hit.name, 'down', x) && KINDS[hit.name].up) emit(hit.name, 'up', x, 78);
    }
    if (hit.name === 'shutter') {
      // Foto: la cortinilla. Vídeo: al parar, dos pulsos y ningún sonido que se cuele en la toma.
      if (!document.body.classList.contains('cam-video')) emit('shutter', 'fire', x);
      else if (mine && mine.wasRecording) buzz([10, 45, 10], 0);
    }
  }, { capture: true });
  // Deslizadores: una muesca cada vigésimo del recorrido.
  const steps = new WeakMap();
  document.addEventListener('input', event => {
    const node = event.target;
    if (!event.isTrusted || !node || node.type !== 'range') return;
    const min = +node.min || 0, max = node.max === '' ? 100 : +node.max;
    const step = Math.round((+node.value - min) / ((max - min) || 1) * 20);
    if (steps.get(node) === step) return;
    steps.set(node, step);
    const rect = node.getBoundingClientRect();
    detent(rect.left + rect.width * step / 20);
  }, { capture: true, passive: true });

  // ── Ajustes ─────────────────────────────────────────────────────────────────
  function set(next) {
    Object.assign(prefs, next);
    try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (_) {}
    if (prefs.sound) { build(); wake(); }
  }
  function mount(host) {
    if (!host) return;
    host.innerHTML = '';
    [['sound', 'Sonido'], ['haptic', 'Vibración']].forEach(([key, label]) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'flip-settings-pill';
      pill.dataset.feelPref = key;
      pill.dataset.feel = 'none';
      pill.textContent = label;
      pill.classList.toggle('active', !!prefs[key]);
      pill.setAttribute('aria-pressed', String(!!prefs[key]));
      pill.addEventListener('click', event => {
        set({ [key]: !prefs[key] });
        mount(host);
        // La respuesta es la propia tecla: si se acaba de encender, se oye o se nota.
        if (prefs[key]) { last.at = -1e9; emit('key', 'down', event.clientX); }
      });
      host.appendChild(pill);
    });
  }

  window.flipFeel = {
    tap(name, phase = 'down', x) { return emit(name, phase, x); },
    detent, set, mount,
    prefs: () => ({ ...prefs }),
    // Un módulo que graba por su cuenta avisa para que las teclas callen.
    hush(key, on) { if (on) hushed.add(key); else hushed.delete(key); },
    // Para pruebas y para oír las recetas fuera de la app.
    log: clear => { const copy = log.slice(); if (clear) log.length = 0; return copy; },
    kinds: () => JSON.parse(JSON.stringify(KINDS)),
    render: (name, variant = 0) => RECIPES[name] ? synth(RECIPES[name], 977 + Object.keys(RECIPES).indexOf(name) * 131 + variant * 17) : null,
    recipes: () => Object.keys(RECIPES),
    state: () => ({ context: ctx ? ctx.state : 'none', built: !!buffers, recording: recording(), mic: micLive(), devices: !!devices }),
  };
  // El panel de ajustes se pinta antes de que este archivo cargue: se monta ahora si ya existe.
  mount(document.getElementById('flipFeelPills'));
})();
