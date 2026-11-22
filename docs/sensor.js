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

  // Convierte un VideoFrame al canvas de un estado. Devuelve false si no sabe leerlo.
  async function convertInto(state, frame) {
    const kind = KINDS[frame.format];
    if (!kind) { state.why = 'formato ' + frame.format; return false; }
    if (frame.rotation || frame.flip) { state.why = 'cuadro con orientación'; return false; }
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

  const supported = typeof VideoFrame === 'function';

  async function read(video) {
    if (!supported || !video || !video.videoWidth) return null;
    const state = stateOf(video);
    if (state.disabled || state.busy) return null;
    state.busy = true;
    let frame = null;
    try {
      frame = new VideoFrame(video);
      if (!(await convertInto(state, frame))) { fail(state); return null; }
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
  }

  return {
    read, prime, current, reset,
    // Para pruebas: convierte un VideoFrame suelto y devuelve su canvas.
    async convertFrame(frame) {
      const state = { canvas: null, ctx: null, image: null, raw: null, width: 0, height: 0, why: '', info: null };
      return (await convertInto(state, frame)) ? state : null;
    },
    usable: video => supported && !(video && states.get(video) && states.get(video).disabled),
    pending: video => !!(video && states.get(video) && states.get(video).busy),
    status(video) {
      const state = video && states.get(video);
      if (!state) return { active: false, disabled: !supported, why: supported ? 'sin cuadros' : 'sin VideoFrame', info: null };
      return { active: !state.disabled && !!state.info, disabled: state.disabled, why: state.why, info: state.info };
    },
  };
})();
