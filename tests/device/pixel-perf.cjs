// Rendimiento real en el Pixel: ms de render por cuadro y cadencia de pantalla por variante.
//   node pixel-perf.cjs [segundos] [salida.json]
'use strict';
const fs = require('node:fs');
const P = require('./pixel-lib.cjs');
const seconds = Number(process.argv[2] || 2.5);
(async () => {
  const page = (await P.targets()).find(t => t.type === 'page' && (!process.env.PIXEL_URL || t.url.startsWith(process.env.PIXEL_URL)));
  const c = await P.connect(page);
  if (process.env.PIXEL_ASPECT) { const [aw, ah] = process.env.PIXEL_ASPECT.split(':').map(Number); await c.evaluate(`(() => { window.__prevAspect = [camAspW, camAspH]; applyCamAspect(${aw}, ${ah}); })()`); await P.sleep(2500); }
  const info = await c.evaluate(`(() => {
    if (!window.__perf) {
      const perf = window.__perf = { render: [], raf: [], last: 0, original: _renderCamEngineFrame, run: true };
      _renderCamEngineFrame = function (...args) {
        const begin = performance.now();
        const result = perf.original.apply(this, args);
        if (args[5] && args[5].path === 'preview') perf.render.push(performance.now() - begin);
        return result;
      };
      const tick = now => { if (perf.last) perf.raf.push(now - perf.last); perf.last = now; if (perf.run) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
    return { url: location.origin, family: camFamily, variant: camVariant, out: [OUT_W, OUT_H], display: [display.width, display.height], css: [display.style.width, display.style.height],
      video: [vid.videoWidth, vid.videoHeight], inner: [innerWidth, innerHeight], dpr: devicePixelRatio, vis: document.visibilityState,
      variants: Object.entries(CAM_FAMILIES).flatMap(([family, cfg]) => cfg.variants.map(v => [family, v.id, v.label])) };
  })()`);
  console.log(JSON.stringify({ ...info, variants: undefined }));
  const rows = [];
  for (const [family, variant, label] of info.variants) {
    if (family === 'SLHT') continue;
    if (process.env.PIXEL_ONLY && !process.env.PIXEL_ONLY.split(',').includes(family)) continue;
    await c.evaluate(`(() => { _setCamFamily(${JSON.stringify(family)}); camVariant = ${JSON.stringify(variant)}; _applyCamState(); })()`);
    await P.sleep(600);
    await c.evaluate('(() => { __perf.render.length = 0; __perf.raf.length = 0; })()');
    await P.sleep(seconds * 1000);
    const r = await c.evaluate(`(() => {
      const sort = list => Float64Array.from(list).sort();
      const render = sort(__perf.render), raf = sort(__perf.raf);
      const at = (list, q) => list.length ? list[Math.min(list.length - 1, Math.floor(q * list.length))] : 0;
      return { target: camFpsTarget, fps: +(render.length / ${seconds}).toFixed(1), median: +at(render, 0.5).toFixed(1), p95: +at(render, 0.95).toFixed(1), worst: +at(render, 1).toFixed(1),
        rafMedian: +at(raf, 0.5).toFixed(1), rafP95: +at(raf, 0.95).toFixed(1), jank: __perf.raf.filter(d => d > 50).length };
    })()`);
    rows.push({ family, variant: label, ...r });
    console.log(`${family.padEnd(7)} ${label.padEnd(7)} | cadencia ${String(r.target).padStart(3)} fps ${String(r.fps).padStart(5)} | render mediana ${String(r.median).padStart(6)} p95 ${String(r.p95).padStart(6)} peor ${String(r.worst).padStart(6)} | pantalla mediana ${String(r.rafMedian).padStart(5)} p95 ${String(r.rafP95).padStart(6)} tirones ${r.jank}`);
  }
  await c.evaluate(`(() => { _setCamFamily(${JSON.stringify(info.family)}); camVariant = ${JSON.stringify(info.variant)}; _applyCamState(); _renderCamEngineFrame = __perf.original; __perf.run = false; delete window.__perf; })()`);
  if (process.env.PIXEL_ASPECT) await c.evaluate('(() => { if (window.__prevAspect) applyCamAspect(...window.__prevAspect); })()');
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ info: { ...info, variants: undefined }, seconds, rows }, null, 1));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
