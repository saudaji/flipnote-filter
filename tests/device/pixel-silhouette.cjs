// SLHT y FLOW en el Pixel: estado del detector, validez de la máscara, cadencia y capturas.
'use strict';
const path = require('node:path');
const P = require('./pixel-lib.cjs');
const REPO = path.join(__dirname, '..', '..');
const OUT = (process.argv[2] || '.') + '/';
require('node:fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const page = (await P.targets()).find(t => t.type === 'page' && t.url.startsWith('http://localhost:8760'));
  const c = await P.connect(page);
  const before = c.log.length;
  const probe = `(() => { const m = flipSilhouette.latest(60000); let on = 0, mx = 0; if (m) for (let i = 0; i < m.data.length; i++) { if (m.data[i] >= 0.5) on++; if (m.data[i] > mx) mx = m.data[i]; }
    return { estado: flipSilhouette.status(), mascara: m ? { w: m.width, h: m.height, dentro: +(on / m.data.length).toFixed(3), max: +mx.toFixed(3), edad_ms: Math.round(performance.now() - m.at) } : null }; })()`;
  const cadence = `new Promise(done => { let n = 0, worst = 0, prev = 0; const seq0 = flipSilhouette.status().seq; const t0 = performance.now(); const tick = now => { if (prev) worst = Math.max(worst, now - prev); prev = now; n++; if (now - t0 < 3000) requestAnimationFrame(tick); else done({ pantalla_fps: +(n / 3).toFixed(1), peor_ms: Math.round(worst), mascaras_por_s: +((flipSilhouette.status().seq - seq0) / 3).toFixed(1) }); }; requestAnimationFrame(tick); })`;
  await c.evaluate(`(() => { switchTab('cam'); _setCamFamily('SLHT'); camVariant = 'STD'; _applyCamState(); return true; })()`);
  await P.sleep(5000);
  console.log('SLHT', JSON.stringify(await c.evaluate(probe)), JSON.stringify(await c.evaluate(cadence)));
  await c.screenshot(OUT + '02-slht.jpg', { quality: 60 });
  await c.evaluate(`(() => { switchTab('sflow'); return true; })()`);
  await P.sleep(4000);
  console.log('FLOW', JSON.stringify(await c.evaluate(probe)), JSON.stringify(await c.evaluate(cadence)));
  console.log('FLOW estado', JSON.stringify(await c.evaluate(`({ tab: activeTab, stream: !!stream, video: [vid.videoWidth, vid.videoHeight], badge: document.getElementById('sflowStatusBadge').textContent, canvas: [document.getElementById('sflowCanvas').width, document.getElementById('sflowCanvas').height], sensor: flipSensor.status(vid).active })`)));
  await c.screenshot(OUT + '03-flow.jpg', { quality: 60 });
  await c.evaluate(`(() => { switchTab('cam'); _setCamFamily('DSI'); return true; })()`);
  const counts = {};
  c.log.slice(before).forEach(e => { const k = '[' + e.kind + '] ' + String(e.text).slice(0, 110); counts[k] = (counts[k] || 0) + 1; });
  console.log('--- consola'); Object.entries(counts).forEach(([k, n]) => console.log(n + ' × ' + k));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
