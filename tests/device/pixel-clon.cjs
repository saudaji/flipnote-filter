// CLON en el teléfono de verdad (por USB, con Chrome al frente y una pestaña de FLIP a la vista).
// Mide lo que el simulador no puede: cuánto tarda en aprender un look en este teléfono, a cuántos
// cuadros corre el sombreador con la cámara real, y qué aprende de lo que la cámara tiene delante.
// No guarda nada en el teléfono fuera de los looks de la propia app (que deja como estaban).
//   node pixel-clon.cjs <carpeta de capturas>
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const P = require('./pixel-lib.cjs');
const out = path.resolve(process.argv[2] || '.');
fs.mkdirSync(out, { recursive: true });
const URL0 = process.env.PIXEL_URL || 'http://localhost:8760';
const REFS = fs.readFileSync(path.join(__dirname, '..', 'lib', 'clon-refs.js'), 'utf8');

(async () => {
  const pages = (await P.targets()).filter(t => t.type === 'page');
  let c = null;
  for (const t of pages) {
    const p = await Promise.race([P.connect(t), P.sleep(3000).then(() => null)]); if (!p) continue;
    const s = await Promise.race([p.evaluate(`({ vis: document.visibilityState, cam: typeof stream !== 'undefined' && !!stream })`).catch(() => null), P.sleep(3000).then(() => null)]);
    if (s && s.vis === 'visible' && !c) { c = p; continue; }
    if (s && s.cam) await p.evaluate(`(() => { try { releaseCamera(); } catch (_) {} })()`).catch(() => {});
    p.close();
  }
  if (!c) throw new Error('ninguna pestaña de FLIP está a la vista en el teléfono');
  const js = (fn, ...args) => c.evaluate('(' + fn.toString() + ')(' + args.map(a => JSON.stringify(a)).join(',') + ')');
  if (!(await c.evaluate('location.href')).startsWith(URL0)) await c.navigate(URL0 + '/');
  await P.sleep(800);
  await c.evaluate(`(async () => { try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); } catch (_) {} })()`, { awaitPromise: true }).catch(() => {});
  await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.reload();
  await P.sleep(1800);
  for (let i = 0; i < 80; i++) { if (await c.evaluate(`document.readyState === 'complete' && !!window.flipShell && !!window.flipClon`).catch(() => false)) break; await P.sleep(500); }
  await P.sleep(800);
  if (await c.evaluate(`!document.getElementById('splash').classList.contains('hidden')`)) await c.tap('#btnSplashOriginal');
  for (let i = 0; i < 30; i++) { if (await c.evaluate('typeof vid !== "undefined" && vid.videoWidth > 0')) break; await P.sleep(1000); }
  if (await c.evaluate('activeTab') !== 'cam') { await c.tap('#shellModule'); await P.sleep(600); await c.tap('#shellLauncher [data-module="cam"]'); await P.sleep(900); }
  await c.evaluate(REFS);
  const saved = await js(() => localStorage.getItem('flip.clon'));
  await js(() => { _setCamFamily('CLON'); _applyCamState(); });
  await P.sleep(1500);
  const fps = async seconds => { const a = await js(() => ({ f: flipClon.state().frame, t: performance.now() })); await P.sleep(seconds * 1000); const b = await js(() => ({ f: flipClon.state().frame, t: performance.now(), ms: flipClon.state().ms, lcd: document.getElementById('lcdFps').textContent })); return { cuadrosPorSeg: +((b.f - a.f) / ((b.t - a.t) / 1000)).toFixed(1), msSombreador: b.ms, pantallita: b.lcd }; };
  await js(() => flipClon.aim(true));
  await P.sleep(700);
  console.log('✓ apuntando · ' + JSON.stringify({ ...(await fps(3)), estado: await js(() => flipClon.state()), fuente: await js(() => { const f = liveCamFrame(); return [f.srcW, f.srcH, f.fast]; }) }));
  await c.screenshot(path.join(out, 'clon-1-apuntando.jpg'), { quality: 86 });
  // Lo que la cámara tiene delante.
  const real = await js(async () => { const t0 = performance.now(); const look = await flipClon.capture(); return look ? { ms: Math.round(performance.now() - t0), nombre: look.name, dice: flipClon.describe(look), tintas: look.palette.length, cerrada: look.limited, trama: look.screen, pixel: look.pixel, grano: look.grain.amount, nota: look.score, ajuste: look.fit } : null; });
  console.log('✓ aprendido de la cámara real · ' + JSON.stringify(real));
  await P.sleep(1600);
  console.log('  en vivo · ' + JSON.stringify(await fps(4)));
  await c.screenshot(path.join(out, 'clon-2-de-la-camara.jpg'), { quality: 86 });
  // Tres referencias conocidas, aplicadas a la cámara real.
  for (const name of ['dots', 'pixel', 'poster']) {
    const info = await js(async name => { const t0 = performance.now(); const look = await flipClon.adopt(clonRefs[name]()); return { ms: Math.round(performance.now() - t0), nombre: look.name, nota: look.score, trama: look.screen.type, celdas: look.screen.freq || look.pixel }; }, name);
    await P.sleep(1500);
    console.log('✓ ' + name + ' · ' + JSON.stringify({ ...info, ...(await fps(3)) }));
    await c.screenshot(path.join(out, 'clon-3-' + name + '.jpg'), { quality: 86 });
  }
  if (process.env.PIXEL_KEEP !== '1') { await js(saved => { if (saved == null) localStorage.removeItem('flip.clon'); else localStorage.setItem('flip.clon', saved); }, saved); }
  console.log('✓ listo');
  c.close();
  process.exit(0);
})().catch(error => { console.error('✗', error.message); process.exit(1); });
