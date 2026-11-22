// Utilidades de página para las pruebas de FLIP. Se inyecta antes que la app y solo
// toca sus globales cuando una prueba llama a FlipKit.
(function () {
  'use strict';
  const kit = {
    src: null,
    sctx: null,
    source(w = 640, h = 480) {
      if (!kit.src || kit.src.width !== w || kit.src.height !== h) {
        kit.src = document.createElement('canvas');
        kit.src.width = w; kit.src.height = h;
        kit.sctx = kit.src.getContext('2d', { willReadFrequently: true });
      }
      return kit.src;
    },
    // Detiene el bucle en vivo y fija las semillas: los cuadros dependen solo de (escena, t, now).
    hold(seed = 0x1234567) {
      cameraRunning = false;
      _camEngineCore.sessionSeed = seed >>> 0;
      _resetCamEngineState();
      let s = seed >>> 0;
      Math.random = () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    select(family, variant) {
      _setCamFamily(family);
      if (variant && camVariant !== variant) { camVariant = variant; _applyCamState(); }
    },
    paint(scene, t, options) {
      const o = options || {};
      const src = kit.source(o.w || 640, o.h || 480);
      FlipScenes.draw(kit.sctx, src.width, src.height, scene, t, o);
      return src;
    },
    // Cuadro del visor: misma llamada que hace cameraLoop.
    frame(scene, t, now, options) {
      const src = kit.paint(scene, t, options);
      _renderCamEngineFrame(src, src.width, src.height, ctxD, false, { path: 'preview', now });
      return display;
    },
    // Cuadro de exportación a las dimensiones de foto o vídeo de la resolución pedida.
    exportFrame(scene, t, now, options, resolution = 'high', target = null) {
      const src = kit.paint(scene, t, options);
      const dims = _getFlipRecordDimensions(display, { aspectRatio: _getCurrentAspectId(), resolution });
      const canvas = target || document.createElement('canvas');
      if (canvas.width !== dims.width || canvas.height !== dims.height) { canvas.width = dims.width; canvas.height = dims.height; }
      _renderCamEngineFrame(src, src.width, src.height, canvas.getContext('2d'), false, {
        path: 'capture', now, resolution, outW: dims.width, outH: dims.height,
      });
      return canvas;
    },
    pixels(canvas, rect, size) {
      const [x, y, w, h] = rect ? rect.map((v, i) => Math.round(v * (i % 2 ? canvas.height : canvas.width))) : [0, 0, canvas.width, canvas.height];
      const sw = size ? size[0] : w, sh = size ? size[1] : h;
      const probe = document.createElement('canvas');
      probe.width = sw; probe.height = sh;
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, x, y, w, h, 0, 0, sw, sh);
      return ctx.getImageData(0, 0, sw, sh).data;
    },
    // Estadística de una región dada en fracciones [x, y, w, h] del lienzo.
    stats(canvas, rect) {
      const d = kit.pixels(canvas, rect);
      const n = d.length / 4, lum = new Float32Array(n);
      let r = 0, g = 0, b = 0, sum = 0, sq = 0;
      for (let i = 0, p = 0; p < n; i += 4, p++) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        lum[p] = l; r += d[i]; g += d[i + 1]; b += d[i + 2]; sum += l; sq += l * l;
      }
      const sorted = Float32Array.from(lum).sort();
      const pct = q => sorted[Math.floor(q * (n - 1))];
      const mean = sum / n;
      return {
        mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), r: r / n, g: g / n, b: b / n,
        min: sorted[0], p5: pct(0.05), p50: pct(0.5), p95: pct(0.95), max: sorted[n - 1],
      };
    },
    // Luminancia reducida a size (para correlaciones y perfiles).
    luma(canvas, rect, size = [64, 48]) {
      const d = kit.pixels(canvas, rect, size);
      const out = new Float32Array(d.length / 4);
      for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      return out;
    },
    correlation(a, b) {
      let ma = 0, mb = 0;
      for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
      ma /= a.length; mb /= b.length;
      let ab = 0, aa = 0, bb = 0;
      for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
      return ab / Math.sqrt(aa * bb || 1);
    },
    png(canvas) { return canvas.toDataURL('image/png'); },
    jpeg(canvas, q = 0.92) { return canvas.toDataURL('image/jpeg', q); },
    async loadFace(dataUrl) {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      FlipScenes.assets.face = image;
      FlipScenes.clearCache();
    },
  };
  window.FlipKit = kit;
})();
