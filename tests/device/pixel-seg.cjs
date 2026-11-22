// Compara en el Pixel los delegados GPU y CPU del segmentador de personas sobre la misma imagen.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const P = require('./pixel-lib.cjs');
const REPO = path.join(__dirname, '..', '..');
(async () => {
  const page = (await P.targets()).find(t => t.type === 'page' && (!process.env.PIXEL_URL || t.url.startsWith(process.env.PIXEL_URL)));
  const c = await P.connect(page);
  const scenes = fs.readFileSync(path.join(REPO, 'tests', 'scenes.js'), 'utf8');
  console.log('escenas:', await c.evaluate(scenes + '\n;typeof FlipScenes'));
  const before = c.log.length;
  const out = await c.evaluate(`(async () => {
    const { ImageSegmenter, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/+esm');
    const vision = await FilesetResolver.forVisionTasks(SLHT_MP_WASM);
    const mk = (delegate, category) => ImageSegmenter.createFromOptions(vision, { baseOptions: { modelAssetPath: SLHT_MP_MODEL, delegate }, outputCategoryMask: !!category, outputConfidenceMasks: !category, runningMode: 'VIDEO' });
    const inputs = {};
    const a = document.createElement('canvas'); a.width = 320; a.height = 240;
    FlipScenes.draw(a.getContext('2d', { willReadFrequently: true }), 320, 240, 'portrait', 0, {});
    inputs.retrato = a;
    const b = document.createElement('canvas'); b.width = 240; b.height = 320;
    if (vid.videoWidth) { b.getContext('2d').drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight, 0, 0, 240, 320); inputs.camara = b; }
    const stats = (arr) => { let mn = Infinity, mx = -Infinity, sum = 0, on = 0, nan = 0; for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (!(v === v)) { nan++; continue; } if (v < mn) mn = v; if (v > mx) mx = v; sum += v; if (v >= 0.5) on++; } return { n: arr.length, min: +mn.toFixed(3), max: +mx.toFixed(3), mean: +(sum / arr.length).toFixed(4), dentro: +(on / arr.length).toFixed(4), nan }; };
    const report = {};
    for (const [delegate, category] of [['CPU', false], ['GPU', false], ['GPU', true]]) {
      const key = delegate + (category ? '-categoria' : '');
      const t0 = performance.now();
      let seg;
      try { seg = await mk(delegate, category); } catch (e) { report[key] = { error: 'crear: ' + e.message }; continue; }
      const entry = { crear_ms: Math.round(performance.now() - t0) };
      for (const [name, cv] of Object.entries(inputs)) {
        const times = []; let last = null, err = null;
        for (let i = 0; i < 24; i++) {
          const s = performance.now();
          try {
            const r = seg.segmentForVideo(cv, performance.now());
            const m = category ? r.categoryMask : r.confidenceMasks[0];
            const arr = category ? m.getAsUint8Array() : m.getAsFloat32Array();
            if (i === 23) last = { w: m.width, h: m.height, ...stats(arr) };
            r.close();
          } catch (e) { err = e.message; break; }
          times.push(performance.now() - s);
          await new Promise(r => setTimeout(r, 4));
        }
        times.sort((x, y) => x - y);
        entry[name] = err ? { error: err } : { mediana_ms: +times[times.length >> 1].toFixed(1), max_ms: +times[times.length - 1].toFixed(1), primera_ms: null, mask: last };
      }
      try { seg.close(); } catch (_) {}
      report[key] = entry;
    }
    return report;
  })()`, { timeout: 120000 });
  console.log(JSON.stringify(out, null, 1));
  const fresh = c.log.slice(before);
  const counts = {};
  fresh.forEach(e => { const k = '[' + e.kind + '] ' + String(e.text).slice(0, 110); counts[k] = (counts[k] || 0) + 1; });
  console.log('--- consola durante la prueba');
  Object.entries(counts).forEach(([k, n]) => console.log(n + ' × ' + k));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
