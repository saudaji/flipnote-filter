// FLIP · luz viva.
//
// Las piezas son renders con la luz arriba a la izquierda. Un objeto de verdad no tiene la luz
// fija: al inclinarlo, los brillos del metal y del plástico lustroso se desplazan. Aquí el
// teléfono es el objeto: con el sensor de orientación, los brillos del disparador, de los botones
// redondos y de las perillas giran alrededor de su centro como si la lámpara se hubiera movido.
// Son piezas de revolución, así que girar el render entero equivale a mover la luz.
//
// Qué cuesta: nada mientras el teléfono está quieto. Al moverlo, como mucho 20 veces por segundo
// se escribe un ángulo en un puñado de piezas pequeñas, cada una en su capa: la gráfica solo las
// recoloca, no repinta nada. Con la app oculta, el sensor se suelta.
// Sin sensor (un ordenador) o sin permiso (iOS lo pide aparte), la luz se queda donde está.
(function () {
  'use strict';

  const PIECES = '#deckShutter, .hw-candy, .cs-knob:not([data-cs-kind]), .rig-knob .dial, .flip-knob';
  const MAX_TURN = 34;          // grados que puede girar un brillo
  const GAIN = 1.7;             // cuánto gira por grado de inclinación
  const DEAD = 0.5;             // por debajo de esto no se toca nada (el pulso de la mano)
  const SETTLE = 7000;          // ms que tarda una postura sostenida en volverse «la de reposo»

  const light = { last: null, jolts: 0, joltSign: 0, joltAt: 0, shookAt: -1e9, shakes: 0, tx: 0, ty: 0, turn: 0, target: 0, base: null, at: 0, nodes: [], listedAt: -1e9, listening: false, events: 0 };

  function nodes(now) {
    if (now - light.listedAt > 1200) { light.nodes = [...document.querySelectorAll(PIECES)]; light.listedAt = now; }
    return light.nodes;
  }

  function apply(now) {
    const gap = light.target - light.turn;
    light.turn += gap * 0.45;
    if (Math.abs(light.target - light.turn) < 0.15) light.turn = light.target;
    const value = light.turn.toFixed(1) + 'deg';
    for (const node of nodes(now)) node.style.setProperty('--lt', value);
    if (light.turn !== light.target) scheduleFrame(apply);
  }
  apply.maxFps = 20;

  function onTilt(event) {
    if (event.beta == null || event.gamma == null) return;
    const now = performance.now();
    if (now - light.at < 45) return;                       // el sensor avisa 60 veces por segundo; sobra
    const dt = Math.min(1000, now - light.at);
    light.at = now;
    light.events++;
    const beta = event.beta, gamma = event.gamma;
    // Sacudida: tres bandazos seguidos en sentidos alternos (más de 16° entre dos lecturas). Lo usa la
    // mascota, que se marea. Sin sensor nuevo: sale de las mismas lecturas.
    if (light.last) {
      const dg = gamma - light.last.gamma, db = beta - light.last.beta, d = Math.abs(dg) > Math.abs(db) ? dg : db, size = Math.abs(d);
      if (size > 16 && size < 110) {
        const sign = d > 0 ? 1 : -1;
        if (now - light.joltAt > 700) light.jolts = 0;
        if (sign !== light.joltSign || !light.jolts) { light.jolts++; light.joltSign = sign; light.joltAt = now; }
        if (light.jolts >= 3 && now - light.shookAt > 1600) { light.jolts = 0; light.shookAt = now; light.shakes++; try { window.dispatchEvent(new CustomEvent('flip:sacudida')); } catch (_) {} }
      }
    }
    light.last = { beta, gamma };
    if (!light.base) light.base = { beta, gamma };
    // La postura de reposo sigue despacio a la mano: sostener el teléfono inclinado no deja los
    // brillos torcidos para siempre.
    const follow = Math.min(1, dt / SETTLE);
    light.base.beta += (beta - light.base.beta) * follow;
    light.base.gamma += (gamma - light.base.gamma) * follow;
    // La lámpara está arriba, a la izquierda y algo al frente: L = (−0,48, 0,56, 0,67) en los ejes
    // del teléfono. Al girar el teléfono, la lámpara gira al revés vista desde él; para giros
    // pequeños su acimut cambia Lz·(Ly·Δγ + Lx·Δβ)/(Lx² + Ly²) = 0,69·Δγ − 0,59·Δβ.
    // Cuánto se ha ladeado respecto al reposo, de −1 a 1 (25° es el tope): para quien quiera
    // «empujar» algo con la inclinación (VFD · REACCIÓN).
    light.tx = Math.max(-1, Math.min(1, (gamma - light.base.gamma) / 25));
    light.ty = Math.max(-1, Math.min(1, (beta - light.base.beta) / 25));
    const azimuth = 0.69 * (gamma - light.base.gamma) - 0.59 * (beta - light.base.beta);
    const turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, -azimuth * GAIN));
    if (Math.abs(turn - light.target) < DEAD) return;
    light.target = turn;
    scheduleFrame(apply);
  }

  function listen(on) {
    if (on === light.listening || !('DeviceOrientationEvent' in window)) return;
    light.listening = on;
    if (on) window.addEventListener('deviceorientation', onTilt, { passive: true });
    else { window.removeEventListener('deviceorientation', onTilt); light.base = null; light.last = null; light.tx = light.ty = 0; }
  }

  document.addEventListener('visibilitychange', () => listen(!document.hidden));
  listen(!document.hidden);

  window.flipLight = {
    tilt: () => (light.listening && light.base ? { x: light.tx, y: light.ty } : null),
    state: () => ({ shakes: light.shakes, turn: +light.turn.toFixed(1), target: +light.target.toFixed(1), listening: light.listening, events: light.events, pieces: light.nodes.length }),
  };
})();
