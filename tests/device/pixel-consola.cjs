// CONSOLA en el teléfono de verdad (por USB, con Chrome al frente y una pestaña de FLIP a la vista).
// Mide lo que el simulador no puede: a cuántos cuadros corre la malla con la cámara real, cuánto
// tarda el rastreo de rostro en este teléfono y si la cara queda en facetas (con la cámara frontal).
// No guarda nada en el teléfono. Deja capturas en la carpeta que se le diga.
//   node pixel-consola.cjs <carpeta de capturas>
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const P = require('./pixel-lib.cjs');
const out = path.resolve(process.argv[2] || '.');
fs.mkdirSync(out, { recursive: true });
const URL0 = process.env.PIXEL_URL || 'http://localhost:8760';

(async () => {
  const pages = (await P.targets()).filter(t => t.type === 'page');
  let c = null;
  for (const t of pages) {
    const p = await Promise.race([P.connect(t), P.sleep(4000).then(() => null)]); if (!p) continue;
    const s = await Promise.race([p.evaluate(`({ vis: document.visibilityState, cam: typeof stream !== 'undefined' && !!stream })`).catch(() => null), P.sleep(4000).then(() => null)]);
    if (s && s.vis === 'visible' && !c) { c = p; continue; }
    // una pestaña de FLIP oculta no debe quedarse con la cámara: Android solo la presta a una
    if (s && s.cam) await p.evaluate(`(() => { try { releaseCamera(); } catch (_) {} })()`).catch(() => {});
    p.close();
  }
  if (!c) throw new Error('ninguna pestaña de FLIP está a la vista en el teléfono');
  const js = (fn, ...args) => c.evaluate('(' + fn.toString() + ')(' + args.map(a => JSON.stringify(a)).join(',') + ')');
  await c.send('Network.enable'); await c.send('Network.setBypassServiceWorker', { bypass: true }); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (!(await c.evaluate('location.href')).startsWith(URL0)) await c.navigate(URL0 + '/'); else await c.reload();
  await P.sleep(1800);
  for (let i = 0; i < 80; i++) { if (await c.evaluate(`document.readyState === 'complete' && !!window.flipShell && !!window.flipConsola`).catch(() => false)) break; await P.sleep(500); }
  await P.sleep(800);
  if (await c.evaluate(`!document.getElementById('splash').classList.contains('hidden')`)) await c.tap('#btnSplashOriginal');
  for (let i = 0; i < 30; i++) { if (await c.evaluate('typeof vid !== "undefined" && vid.videoWidth > 0')) break; await P.sleep(1000); }
  if (await c.evaluate('activeTab') !== 'cam') { await c.tap('#shellModule'); await P.sleep(600); await c.tap('#shellLauncher [data-module="cam"]'); await P.sleep(900); }
  const before = await js(() => ({ family: camFamily, variant: camVariant, facing: facingMode }));
  const measure = async (label, seconds) => {
    const a = await js(() => ({ f: flipConsola.state().frames, t: performance.now() }));
    let ms = 0, n = 0, faceMs = 0, seen = 0;
    for (let i = 0; i < seconds * 4; i++) { await P.sleep(250); const s = await js(() => flipConsola.state()); ms += s.ms; n++; faceMs = Math.max(faceMs, s.face.ms); if (s.face.seen) seen++; }
    const b = await js(() => ({ f: flipConsola.state().frames, t: performance.now(), s: flipConsola.state(), lcd: document.getElementById('lcdFps').textContent, video: [vid.videoWidth, vid.videoHeight] }));
    console.log('✓ ' + label + ' · ' + JSON.stringify({ cuadrosPorSeg: +((b.f - a.f) / ((b.t - a.t) / 1000)).toFixed(1), pantallita: b.lcd, msMalla: +(ms / n).toFixed(2), rostro: b.s.face.state, msRostro: +faceMs.toFixed(1), caraVista: seen + '/' + n, poligonos: b.s.tris, facetas: b.s.faceTris, interno: b.s.size, camara: b.video }));
  };
  await js(() => { _setCamFamily('CONSOLA'); camVariant = 'B128'; _applyCamState(); });
  for (let i = 0; i < 60; i++) { await P.sleep(500); const st = await js(() => flipConsola.state().face.state); if (st === 'ready' || st === 'failed') break; }
  console.log('  rastreador de rostro:', JSON.stringify(await js(() => flipConsola.state().face)));
  await measure('128 BITS, cámara trasera', 5);
  await c.screenshot(path.join(out, 'consola-1-trasera-128.jpg'), { quality: 85 });
  await js(() => { camVariant = 'B32'; _applyCamState(); });
  await P.sleep(1200);
  await measure('32 BITS, cámara trasera', 4);
  await c.screenshot(path.join(out, 'consola-2-trasera-32.jpg'), { quality: 85 });
  // con la frontal, para que haya una cara
  await js(() => { camVariant = 'B128'; _applyCamState(); });
  await c.tap('#deckFlip');
  for (let i = 0; i < 16; i++) { await P.sleep(500); if (await c.evaluate('vid.videoWidth > 0 && facingMode !== ' + JSON.stringify(before.facing))) break; }
  await P.sleep(2500);
  await measure('128 BITS, cámara frontal', 5);
  await c.screenshot(path.join(out, 'consola-3-frontal-128.jpg'), { quality: 85 });
  await js(() => { camVariant = 'B32'; _applyCamState(); });
  await P.sleep(1500);
  await c.screenshot(path.join(out, 'consola-4-frontal-32.jpg'), { quality: 85 });
  await js(() => { camVariant = 'B128'; _applyCamState(); saveSettings(); });      // se queda en CONSOLA · 128 BITS, con la frontal, para verlo
  const errors = c.log.filter(e => e.kind === 'error' && !/Graph|gl_context|XNNPACK|favicon/.test(e.text)).map(e => String(e.text).slice(0, 160));
  console.log('errores:', JSON.stringify(errors));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
