'use strict';

// Ritmo de los bucles de dibujo.
//
// Antes cada bucle se llamaba en cada refresco de pantalla (60 por segundo; 120 en un Pixel) y
// decidía dentro si tocaba dibujar: el teléfono se despertaba 120 veces por segundo para pintar
// 8, y los motores sin límite propio dibujaban 120 cuadros donde bastaban 30 o 60. Ahora:
//
//   · Un bucle declara su tope con loop.maxFps (60 si no dice nada) y no se le llama más a menudo.
//   · scheduleFrame(loop, espera) deja dormir el hilo «espera» ms antes de pedir el cuadro: quien
//     dibuja a 8 por segundo duerme entre cuadro y cuadro en vez de preguntar en cada refresco.
//   · scheduleFrame(loop, espera, true) dice que la vuelta que acaba no dibujó (aún no tocaba, o
//     el cuadro de la cámara no había llegado): no cuenta para el tope y se repite cuanto antes.
//   · Despertarlo antes de tiempo (un toque, un ajuste) sigue siendo scheduleFrame(loop) sin más.
//   · cancelFrame(loop) lo para.
//   · pauseFrames(true) deja todos los bucles en espera (la cámara en reposo, rest.js): quien pida
//     su próxima vuelta se queda apuntado y la recibe al reanudar con pauseFrames(false).
const FRAME_DEFAULT_FPS = 60;
const FRAME_SLACK = 3;                  // ms de holgura: el refresco nunca llega clavado
const frameStates = new WeakMap();
let framePeriod = 1000 / 60;            // lo que dura un refresco de esta pantalla, medido

// Se mide al abrir y al volver a la app: unos pocos refrescos seguidos, el más corto manda.
function measureFramePeriod() {
  let left = 6, last = 0, best = Infinity;
  const step = time => {
    if (last && time - last > 3) best = Math.min(best, time - last);
    last = time;
    if (--left > 0) requestAnimationFrame(step);
    else if (best < 40) framePeriod = best;
  };
  requestAnimationFrame(step);
}
measureFramePeriod();
document.addEventListener('visibilitychange', () => { if (!document.hidden) measureFramePeriod(); });

function frameStateOf(loop) {
  let state = frameStates.get(loop);
  if (state) return state;
  state = { last: -1e9, prev: -1e9, at: 0, raf: 0, timer: 0, fire: null, chained: 0 };
  state.fire = time => {
    state.raf = 0;
    // Dos llamadas seguidas (la anterior se saltó) distan justo un refresco: afina la medida.
    if (state.chained) {
      const gap = time - state.chained;
      if (gap > 3 && gap < 40) framePeriod += (gap - framePeriod) * 0.25;
      state.chained = 0;
    }
    // La pantalla refresca más deprisa que el tope del bucle: se espera al refresco siguiente.
    if (time + 0.5 < state.at) { state.chained = time; state.raf = requestAnimationFrame(state.fire); return; }
    state.prev = state.last;
    state.last = time;
    loop(time);
  };
  frameStates.set(loop, state);
  return state;
}

let framesPaused = false;
const framesHeld = new Set();
function pauseFrames(on) {
  if (!!on === framesPaused) return;
  framesPaused = !!on;
  if (framesPaused) return;
  const held = [...framesHeld];
  framesHeld.clear();
  for (const loop of held) scheduleFrame(loop);
}

function scheduleFrame(loop, wait, idle) {
  const state = frameStateOf(loop);
  if (idle) state.last = state.prev;
  if (framesPaused) { framesHeld.add(loop); return; }
  const now = performance.now();
  // Sin espera pedida solo manda el tope: comparar con «ahora» haría saltarse un refresco cuando
  // el cuadro siguiente ya trae una hora anterior a esta llamada (el hilo iba con retraso).
  const at = Math.max(wait > 0 ? now + wait : -Infinity, state.last + 1000 / (loop.maxFps || FRAME_DEFAULT_FPS) - FRAME_SLACK);
  if (state.raf) { if (at < state.at) state.at = at; return; }
  if (state.timer) {
    if (at >= state.at - 1) return;     // ya dormía hasta entonces o hasta antes
    clearTimeout(state.timer);
    state.timer = 0;
  }
  state.at = at;
  // Dormir solo compensa si se saltan más de dos refrescos; se despierta uno y medio antes.
  const sleep = at - now;
  if (sleep > framePeriod * 2.5 && !document.hidden) {
    state.timer = setTimeout(() => { state.timer = 0; state.raf = requestAnimationFrame(state.fire); }, sleep - framePeriod * 1.5);
  } else state.raf = requestAnimationFrame(state.fire);
}

function cancelFrame(loop) {
  framesHeld.delete(loop);
  const state = frameStates.get(loop);
  if (!state) return;
  if (state.raf) cancelAnimationFrame(state.raf);
  if (state.timer) clearTimeout(state.timer);
  state.raf = 0;
  state.timer = 0;
}

// ¿Hay una vuelta pedida para este bucle? (En pausa, estar apuntado cuenta.)
function framePending(loop) {
  if (framesHeld.has(loop)) return true;
  const state = frameStates.get(loop);
  return !!(state && (state.raf || state.timer));
}

const analyserSnapshots = new WeakMap();
function sampleAudio(analyser) {
  let snapshot = analyserSnapshots.get(analyser);
  if (!snapshot || snapshot.timeData.length !== analyser.fftSize) {
    snapshot = {
      freqData: new Uint8Array(analyser.frequencyBinCount),
      timeData: new Uint8Array(analyser.fftSize),
    };
    analyserSnapshots.set(analyser, snapshot);
  }
  analyser.getByteFrequencyData(snapshot.freqData);
  analyser.getByteTimeDomainData(snapshot.timeData);
  return snapshot;
}
