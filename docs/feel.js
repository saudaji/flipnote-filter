// FLIP FL-27 · tacto: el sonido y la vibración de las teclas.
// Cada pieza suena como lo que es. El disparador pesa y tiene dos tiempos (hundirlo y la
// cortinilla); las teclas hacen clic al bajar y clac al subir, con el muelle sonando un pelo; los
// botones redondos son sordos, de goma; el interruptor da su doble chasquido; las perillas y los
// deslizadores marcan muescas. La vibración lleva el mismo ritmo que el sonido: un golpe, un pulso.
//
// Para que no sea una cacofonía:
//   · solo suena lo que el dedo pulsa de verdad, nunca un cambio automático;
//   · lo que vive dentro de una lista que se desplaza suena al elegirlo, no al tocarlo;
//   · un sonido cada vez: si coinciden dos, gana la pieza más importante;
//   · mientras se graba las teclas callan y queda solo la vibración; con el micrófono abierto bajan;
//   · las muescas se espacian y se apagan cuanto más deprisa se gira.
// Todo se sintetiza aquí (no hay archivos de audio): modos amortiguados más soplos de ruido filtrado.
(function () {
  'use strict';
  const STORE = 'flip.feel.v1';
  const prefs = { sound: true, haptic: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (_) {}

  // ── Recetas ─────────────────────────────────────────────────────────────────
  // len: duración total (ms). hits: golpes; cada uno con modos [Hz, caída ms, nivel, caída de tono]
  // y soplos de ruido { len ms, f Hz, q, level, at ms }. lp: paso bajo final (Hz).
  const RECIPES = {
    // Tecla de teclado: golpe de fondo con cuerpo, clic del contacto y el muelle resonando.
    keyDown: { len: 120, hits: [{ modes: [[215, 22, .32, .28], [468, 18, .66, .18], [935, 11, .5], [1760, 8, .46], [3350, 5.5, .36], [4150, 40, .05], [5230, 28, .028]],
      noise: [{ len: 2.4, f: 3600, q: 1, level: .9 }, { len: 8, f: 1100, q: .8, level: .25 }] }] },
    keyUp: { len: 70, hits: [{ modes: [[640, 11, .5], [1480, 8, .45], [2900, 5, .3], [4700, 3, .16]], noise: [{ len: 1.6, f: 5200, q: 1.4, level: .4 }] }] },
    // Tecla grande: más grave y más larga.
    primaryDown: { len: 160, hits: [{ modes: [[152, 36, .34, .3], [332, 30, .74, .2], [725, 16, .56], [1500, 10, .42], [2700, 6, .3], [3600, 52, .04]],
      noise: [{ len: 3, f: 2900, q: .9, level: .8 }, { len: 14, f: 700, q: .7, level: .3 }] }] },
    primaryUp: { len: 90, hits: [{ modes: [[520, 14, .5], [1150, 10, .45], [2400, 6, .28]], noise: [{ len: 2, f: 4200, q: 1.2, level: .35 }] }] },
    // Disparador: hundirlo (medio recorrido) y, al soltar, la cortinilla en dos tiempos.
    shutterDown: { len: 120, hits: [{ modes: [[172, 30, .32, .3], [392, 22, .76, .2], [845, 12, .5], [1900, 8, .42], [3200, 5, .25]], noise: [{ len: 2.5, f: 3400, q: 1, level: .8 }] }] },
    shutterFire: { len: 190, hits: [
      { gain: .8, modes: [[410, 16, .5], [2300, 7, .5], [3700, 5, .45], [5600, 3.5, .3]], noise: [{ len: 3, f: 4500, q: 1.2, level: .6 }, { at: 6, len: 13, f: 6800, q: 2.2, level: .07 }] },
      { at: 46, modes: [[300, 24, .6, .2], [1900, 9, .5], [3100, 6, .45], [4800, 4, .3]], noise: [{ len: 4, f: 3600, q: 1, level: .6 }] }] },
    // Botón redondo de goma: sordo y redondo.
    softDown: { len: 80, lp: 4200, hits: [{ modes: [[240, 16, .4, .35], [545, 12, .62, .2], [1150, 7, .34], [1900, 4, .16]], noise: [{ len: 1.8, f: 2100, q: .9, level: .45 }] }] },
    softUp: { len: 60, lp: 5000, hits: [{ modes: [[430, 9, .4], [980, 6, .32]], noise: [{ len: 1.2, f: 3000, q: 1, level: .18 }] }] },
    // Interruptor deslizante: el roce y el tope.
    switch: { len: 115, hits: [
      { gain: .55, modes: [[2900, 3.5, .5], [4600, 2.5, .35]], noise: [{ len: 6, f: 2400, q: .7, level: .22 }] },
      { at: 34, modes: [[310, 14, .4], [820, 10, .6], [1900, 6, .5], [3600, 3.5, .3]], noise: [{ len: 1.6, f: 4200, q: 1.3, level: .5 }] }] },
    // Diapositiva que cae en su ranura.
    slide: { len: 95, hits: [
      { gain: .7, modes: [[1700, 5, .5], [3300, 3.5, .4]], noise: [{ len: 1.2, f: 4000, q: 1.2, level: .4 }] },
      { at: 22, modes: [[380, 16, .6, .2], [900, 9, .5], [2100, 6, .36]], noise: [{ len: 1.5, f: 3200, q: 1, level: .5 }] }] },
    // Muesca de perilla o deslizador.
    tick: { len: 30, hits: [{ modes: [[1250, 3.5, .5], [2500, 2.2, .5], [5200, 1.2, .2]], noise: [{ len: .8, f: 4800, q: 1.5, level: .3 }] }] },
  };

  // Cada pieza: su rango (quién gana si coinciden), y qué suena y vibra al bajar, al subir y al
  // actuar. vib: milisegundos, o un patrón [vibra, pausa, vibra…] con el ritmo del sonido.
  const KINDS = {
    shutter: { rank: 5, down: { sound: 'shutterDown', gain: .85, vib: 14 }, fire: { sound: 'shutterFire', gain: 1, vib: [9, 37, 13] } },
    primary: { rank: 4, down: { sound: 'primaryDown', gain: .85, vib: 16 }, up: { sound: 'primaryUp', gain: .45 } },
    key: { rank: 3, down: { sound: 'keyDown', gain: .62, vib: 9 }, up: { sound: 'keyUp', gain: .34 } },
    switch: { rank: 3, late: true, down: { sound: 'switch', gain: .55, vib: [4, 30, 8] } },
    soft: { rank: 2, down: { sound: 'softDown', gain: .46, vib: 6 }, up: { sound: 'softUp', gain: .2 } },
    slide: { rank: 2, late: true, down: { sound: 'slide', gain: .5, vib: [3, 19, 6] } },
    plain: { rank: 2, down: { sound: 'softDown', gain: .36, vib: 5 } },
    tick: { rank: 1, down: { sound: 'tick', gain: .16, vib: 2 } },
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
  function synth(recipe, seed, sr = RATE) {
    const rnd = mulberry(seed);
    const n = Math.ceil(recipe.len * sr / 1000);
    const out = new Float32Array(n);
    const tune = 1 + (rnd() - 0.5) * 0.06;                       // cada tecla, un pelo distinta
    for (const hit of recipe.hits) {
      const start = Math.round((hit.at || 0) * sr / 1000), g = hit.gain == null ? 1 : hit.gain;
      for (const [f, decay, level, drop = 0] of hit.modes || []) {
        const tau = decay * sr / 1000, w = 2 * Math.PI * f * tune * (1 + (rnd() - 0.5) * 0.02) / sr;
        const amp = level * g * (0.88 + rnd() * 0.24);
        let phase = 0;
        for (let i = start, t = 0; i < n; i++, t++) {
          const env = Math.exp(-t / tau);
          if (env < 0.001) break;
          phase += w * (1 + drop * Math.exp(-t / (tau * 0.35)));
          out[i] += amp * env * Math.sin(phase);
        }
      }
      for (const burst of hit.noise || []) {
        const from = start + Math.round((burst.at || 0) * sr / 1000), tau = burst.len * sr / 1000;
        const count = Math.max(0, Math.min(n - from, Math.ceil(tau * 7)));
        const rise = Math.max(2, Math.round(sr * 0.00012));
        const w0 = 2 * Math.PI * Math.min(burst.f * tune, sr * 0.45) / sr, alpha = Math.sin(w0) / (2 * burst.q), a0 = 1 + alpha;
        const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
        const amp = burst.level * g * 2.2;
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < count; i++) {
          const x = (rnd() * 2 - 1) * Math.min(1, i / rise) * Math.exp(-i / tau);
          const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y;
          out[from + i] += y * amp;
        }
      }
    }
    if (recipe.lp) {
      const w0 = 2 * Math.PI * recipe.lp / sr, cos = Math.cos(w0), alpha = Math.sin(w0) / 1.414, a0 = 1 + alpha;
      const b0 = (1 - cos) / 2 / a0, b1 = (1 - cos) / a0, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) { const x = out[i], y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y; }
    }
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
  function wake() {
    if (!prefs.sound) return;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { try { ctx = new AC(); } catch (__) { return; } }
      bus = ctx.createGain();
      bus.gain.value = 0.9;
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
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
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
    state: () => ({ context: ctx ? ctx.state : 'none', built: !!buffers, recording: recording(), mic: micLive() }),
  };
  // El panel de ajustes se pinta antes de que este archivo cargue: se monta ahora si ya existe.
  mount(document.getElementById('flipFeelPills'));
})();
