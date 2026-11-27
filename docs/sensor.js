// Lectura rápida de la cámara.
//
// En Chrome para Android, llevar un cuadro de la cámara a un canvas (drawImage, createImageBitmap,
// texImage2D) cuesta entre 20 y 30 ms por cuadro en un Pixel 10: el navegador convierte el cuadro
// completo a RGB. Copiar sus planos nativos con WebCodecs cuesta menos de 1 ms. Este módulo copia
// los planos, reduce el cuadro y lo convierte a RGB solo en los píxeles que hacen falta, y lo deja
// en un canvas pequeño que los motores usan como fuente en vez del elemento de vídeo.
//
//   flipSensor.prime(video)          pide el cuadro siguiente (asíncrono, no bloquea)
//   flipSensor.current(video, edad)  último cuadro convertido si es reciente: { canvas, width, height }
//   flipSensor.read(video)           promesa del cuadro convertido, o null si no hay vía rápida
//   flipSensor.reset(video)          cámara nueva: se vuelve a probar el formato
//
// Cada elemento de vídeo tiene su propio estado. Si el navegador no tiene VideoFrame, el formato
// no es conocido o algo falla tres veces seguidas, devuelve null y quien llama sigue usando el
// vídeo como antes.
//
// En iPhone y iPad (WebKit) NO se usa: allí leer el vídeo no cuesta, y los planos nativos vienen
// como los da el sensor —acostados—, con el giro como dato aparte: copiados tal cual, la imagen
// salía girada un cuarto de vuelta, como con el teléfono en horizontal.
const flipSensor = (() => {
  'use strict';
  // Lado corto del cuadro reducido. Los motores muestrean como mucho a 320 × 240.
  const SHORT_SIDE = 360;
  const KINDS = { I420: 'planar', I420A: 'planar', NV12: 'biplanar', RGBA: 'rgb', RGBX: 'rgb', BGRA: 'bgr', BGRX: 'bgr' };
  const states = new WeakMap();
  const tableCache = new Map();

  function stateOf(video) {
    let state = states.get(video);
    if (!state) {
      state = {
        canvas: null, ctx: null, image: null, raw: null,
        width: 0, height: 0, at: -Infinity,
        busy: false, fails: 0, disabled: false, why: '', info: null,
      };
      states.set(video, state);
    }
    return state;
  }

  // Coeficientes de YCbCr a RGB en coma fija (×64), por matriz y rango.
  function tablesFor(matrix, full) {
    const hd = matrix === 'bt709' || matrix === 'bt2020-ncl';
    const key = (hd ? '709' : '601') + (full ? 'f' : 'l');
    let t = tableCache.get(key);
    if (t) return t;
    const c = full
      ? (hd ? [1.5748, -0.187324, -0.468124, 1.8556] : [1.402, -0.344136, -0.714136, 1.772])
      : (hd ? [1.792741, -0.213249, -0.532909, 2.112402] : [1.596027, -0.391762, -0.812968, 2.017232]);
    const scale = full ? 1 : 255 / 219, offset = full ? 0 : 16;
    t = { y: new Int32Array(256), rv: new Int32Array(256), gu: new Int32Array(256), gv: new Int32Array(256), bu: new Int32Array(256) };
    for (let i = 0; i < 256; i++) {
      t.y[i] = Math.round(64 * scale * (i - offset)) + 32;
      t.rv[i] = Math.round(64 * c[0] * (i - 128));
      t.gu[i] = Math.round(64 * c[1] * (i - 128));
      t.gv[i] = Math.round(64 * c[2] * (i - 128));
      t.bu[i] = Math.round(64 * c[3] * (i - 128));
    }
    tableCache.set(key, t);
    return t;
  }

  // Planos Y, U, V (I420) o Y, UV intercalado (NV12) → RGBA reducido k veces.
  function fromYuv(raw, layout, w, h, k, d, ow, oh, t, biplanar) {
    const yo = layout[0].offset, ys = layout[0].stride;
    const uo = layout[1].offset, us = layout[1].stride;
    const vo = biplanar ? uo + 1 : layout[2].offset, vs = biplanar ? us : layout[2].stride;
    const cstep = biplanar ? 2 : 1, half = k >> 1;
    const ty = t.y, trv = t.rv, tgu = t.gu, tgv = t.gv, tbu = t.bu;
    let o = 0;
    for (let y = 0; y < oh; y++) {
      const sy = y * k, sy1 = Math.min(h - 1, sy + half);
      const row0 = yo + sy * ys, row1 = yo + sy1 * ys;
      const crow = sy1 >> 1;
      const urow = uo + crow * us, vrow = vo + crow * vs;
      for (let x = 0; x < ow; x++) {
        const sx = x * k, sx1 = Math.min(w - 1, sx + half);
        const luma = half
          ? (raw[row0 + sx] + raw[row0 + sx1] + raw[row1 + sx] + raw[row1 + sx1] + 2) >> 2
          : raw[row0 + sx];
        const cx = (sx1 >> 1) * cstep;
        const u = raw[urow + cx], v = raw[vrow + cx], yy = ty[luma];
        d[o] = (yy + trv[v]) >> 6;
        d[o + 1] = (yy + tgu[u] + tgv[v]) >> 6;
        d[o + 2] = (yy + tbu[u]) >> 6;
        o += 4;
      }
    }
  }

  function fromRgb(raw, layout, k, d, ow, oh, swap) {
    const base = layout[0].offset, stride = layout[0].stride;
    const r = swap ? 2 : 0, b = swap ? 0 : 2;
    let o = 0;
    for (let y = 0; y < oh; y++) {
      const row = base + y * k * stride;
      for (let x = 0; x < ow; x++) {
        const p = row + x * k * 4;
        d[o] = raw[p + r]; d[o + 1] = raw[p + 1]; d[o + 2] = raw[p + b];
        o += 4;
      }
    }
  }

  // ¿El cuadro nativo viene girado respecto a lo que el vídeo enseña? Lo dice él mismo (rotation,
  // flip) o se le nota: sus lados son los del vídeo, cambiados.
  function turned(frame, video) {
    if (frame.rotation || frame.flip) return true;
    const vw = video && video.videoWidth, vh = video && video.videoHeight;
    return !!vw && vw !== vh && frame.displayWidth === vh && frame.displayHeight === vw;
  }

  // Convierte un VideoFrame al canvas de un estado. Devuelve false si no sabe leerlo.
  async function convertInto(state, frame, video) {
    const kind = KINDS[frame.format];
    if (!kind) { state.why = 'formato ' + frame.format; return false; }
    if (turned(frame, video)) { state.why = 'cuadro con orientación'; return false; }
    const rect = frame.visibleRect;
    const w = rect.width, h = rect.height;
    if (frame.displayWidth !== w || frame.displayHeight !== h) { state.why = 'píxel no cuadrado'; return false; }
    const size = frame.allocationSize();
    if (!state.raw || state.raw.length < size) state.raw = new Uint8Array(size);
    const layout = await frame.copyTo(state.raw);
    const k = Math.max(1, Math.floor(Math.min(w, h) / SHORT_SIDE));
    const ow = Math.floor(w / k), oh = Math.floor(h / k);
    if (!state.canvas) {
      state.canvas = document.createElement('canvas');
      state.ctx = state.canvas.getContext('2d', { willReadFrequently: true });
    }
    if (state.canvas.width !== ow || state.canvas.height !== oh || !state.image) {
      state.canvas.width = ow; state.canvas.height = oh;
      state.image = state.ctx.createImageData(ow, oh);
      state.image.data.fill(255);
    }
    const d = state.image.data;
    const space = frame.colorSpace || {};
    if (kind === 'rgb' || kind === 'bgr') {
      fromRgb(state.raw, layout, k, d, ow, oh, kind === 'bgr');
    } else {
      // Sin metadatos, las cámaras entregan BT.601 de rango limitado.
      fromYuv(state.raw, layout, w, h, k, d, ow, oh, tablesFor(space.matrix, space.fullRange === true), kind === 'biplanar');
    }
    state.ctx.putImageData(state.image, 0, 0);
    state.width = ow; state.height = oh;
    state.info = { format: frame.format, source: [w, h], reduced: [ow, oh], factor: k, matrix: space.matrix || null, fullRange: space.fullRange === true };
    return true;
  }

  function fail(state, reason) {
    if (reason) state.why = String(reason && reason.message || reason);
    // Tres fallos seguidos: se deja de intentar hasta que cambie la cámara.
    if (++state.fails >= 3) state.disabled = true;
  }

  const APPLE = /iPhone|iPad|iPod/i.test(navigator.userAgent) || /Apple/i.test(navigator.vendor || '');
  const supported = typeof VideoFrame === 'function' && !APPLE;

  async function read(video) {
    if (!supported || !video || !video.videoWidth) return null;
    const state = stateOf(video);
    if (state.disabled || state.busy) return null;
    state.busy = true;
    let frame = null;
    try {
      frame = new VideoFrame(video);
      if (!(await convertInto(state, frame, video))) { fail(state); return null; }
      state.at = performance.now();
      state.fails = 0;
      return state;
    } catch (error) {
      fail(state, error);
      return null;
    } finally {
      try { if (frame) frame.close(); } catch (_) {}
      state.busy = false;
    }
  }

  function prime(video) {
    if (supported && video) read(video);
  }

  function current(video, maxAge = 150) {
    const state = video && states.get(video);
    if (!state || state.disabled || !state.width) return null;
    return performance.now() - state.at <= maxAge ? state : null;
  }

  function reset(video) {
    const state = video && states.get(video);
    if (!state) return;
    state.fails = 0; state.disabled = false; state.why = '';
    state.at = -Infinity; state.info = null; state.width = 0; state.height = 0;
    const raw = planeStates.get(video);
    if (raw) { raw.fails = 0; raw.disabled = false; raw.out = null; raw.why = ''; }
  }

  // ── Planos nativos para la GPU (STAGE) ────────────────────────────────────
  // Copia el cuadro tal cual sale de la cámara (Y, U, V…) sin convertirlo: el sombreador lo pasa
  // a RGB a resolución completa. Dos búferes alternos para no pisar el que se está subiendo.
  //   flipSensor.planes(video)        pide el cuadro siguiente (no bloquea)
  //   flipSensor.latestPlanes(video)  { kind, width, height, data, layout, matrix, fullRange, seq } o null
  const planeStates = new WeakMap();
  function planes(video) {
    if (!supported || !video || !video.videoWidth) return;
    let st = planeStates.get(video);
    if (!st) planeStates.set(video, st = { bufs: [null, null], turn: 0, busy: false, fails: 0, disabled: false, out: null, seq: 0, why: '' });
    if (st.disabled || st.busy) return;
    st.busy = true;
    let frame = null;
    (async () => {
      try {
        frame = new VideoFrame(video);
        const kind = KINDS[frame.format], rect = frame.visibleRect;
        if (!kind || turned(frame, video) || frame.displayWidth !== rect.width || frame.displayHeight !== rect.height) {
          st.disabled = true; st.why = kind ? 'cuadro con orientación' : 'formato ' + frame.format; st.out = null;
          return;
        }
        const size = frame.allocationSize();
        const slot = st.turn ^= 1;
        if (!st.bufs[slot] || st.bufs[slot].length < size) st.bufs[slot] = new Uint8Array(size);
        const layout = await frame.copyTo(st.bufs[slot]);
        const space = frame.colorSpace || {};
        st.out = { kind, format: frame.format, width: rect.width, height: rect.height, data: st.bufs[slot], layout, matrix: space.matrix || null, fullRange: space.fullRange === true, seq: ++st.seq, at: performance.now() };
        st.fails = 0;
      } catch (error) {
        st.why = String(error && error.message || error);
        if (++st.fails >= 3) { st.disabled = true; st.out = null; }
      } finally {
        try { if (frame) frame.close(); } catch (_) {}
        st.busy = false;
      }
    })();
  }
  function latestPlanes(video, maxAge = 400) {
    const st = video && planeStates.get(video);
    return st && st.out && performance.now() - st.out.at <= maxAge ? st.out : null;
  }

  return {
    read, prime, current, reset, planes, latestPlanes,
    planesUsable: video => supported && !(video && planeStates.get(video) && planeStates.get(video).disabled),
    // Coeficientes de YCbCr a RGB para un sombreador: { offset, scale, rv, gu, gv, bu }.
    coefficients(matrix, full) {
      const hd = matrix === 'bt709' || matrix === 'bt2020-ncl';
      const c = full
        ? (hd ? [1.5748, -0.187324, -0.468124, 1.8556] : [1.402, -0.344136, -0.714136, 1.772])
        : (hd ? [1.792741, -0.213249, -0.532909, 2.112402] : [1.596027, -0.391762, -0.812968, 2.017232]);
      return { offset: full ? 0 : 16 / 255, scale: full ? 1 : 255 / 219, rv: c[0], gu: c[1], gv: c[2], bu: c[3] };
    },
    // Para pruebas: convierte un VideoFrame suelto y devuelve su canvas.
    // («video»: opcional, lo que el vídeo dice medir; sirve para notar un cuadro girado)
    async convertFrame(frame, video) {
      const state = { canvas: null, ctx: null, image: null, raw: null, width: 0, height: 0, why: '', info: null };
      return (await convertInto(state, frame, video)) ? state : { failed: true, why: state.why };
    },
    usable: video => supported && !(video && states.get(video) && states.get(video).disabled),
    pending: video => !!(video && states.get(video) && states.get(video).busy),
    status(video) {
      const state = video && states.get(video);
      if (!state) return { active: false, disabled: !supported, why: supported ? 'sin cuadros' : APPLE ? 'no hace falta en WebKit' : 'sin VideoFrame', info: null };
      return { active: !state.disabled && !!state.info, disabled: state.disabled, why: state.why, info: state.info };
    },
  };
})();
