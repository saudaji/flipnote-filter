// Abre (o reutiliza) en el Pixel la pestaña de la copia de trabajo y arranca la cámara.
//   node pixel-open.cjs [url]      (por defecto http://localhost:8760/, vía adb reverse)
'use strict';
const P = require('./pixel-lib.cjs');
const url = process.argv[2] || 'http://localhost:8760/';
(async () => {
  let page = (await P.targets()).find(t => t.type === 'page' && t.url.startsWith(new URL(url).origin));
  if (!page) { page = await P.openTab(url); await P.sleep(1500); console.log('pestaña nueva', page.id); }
  const c = await P.connect(page);
  await c.send('Network.enable');
  await c.send('Network.setBypassServiceWorker', { bypass: true });
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.send('Page.bringToFront').catch(() => {});
  await c.navigate(url);
  await P.sleep(2500);
  const perm = await c.evaluate(`navigator.permissions.query({ name: 'camera' }).then(p => p.state).catch(e => 'ERR ' + e.message)`);
  console.log('permiso de cámara:', perm);
  await c.evaluate(`(() => { const b = document.getElementById('btnSplashOriginal'); if (b && !splash.classList.contains('hidden')) b.click(); return true; })()`);
  let ok = false;
  for (let i = 0; i < 45 && !ok; i++) { await P.sleep(1000); ok = await c.evaluate('typeof vid !== "undefined" && vid.videoWidth > 0'); }
  const state = await c.evaluate(`({ video: [vid.videoWidth, vid.videoHeight], stream: !!stream, gate: !document.getElementById('cameraGate').hidden, gateText: document.getElementById('cameraGateText').textContent, sensor: typeof flipSensor !== 'undefined' ? flipSensor.status() : 'sin sensor', inner: [innerWidth, innerHeight], vis: document.visibilityState })`);
  console.log(JSON.stringify(state, null, 1));
  console.log('--- consola'); c.log.filter(e => !/Graph|gl_context|XNNPACK/.test(e.text)).slice(-15).forEach(e => console.log('[' + e.kind + '] ' + String(e.text).slice(0, 300)));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
