// VFD · REACCIÓN en el teléfono de verdad (por USB, con Chrome al frente y una pestaña de FLIP a la
// vista). Mide a cuántos cuadros corre con la cámara real, cuánto tarda la química por cuadro, que
// la inclinación del teléfono llega y que el tacto nuevo está cargado. No guarda nada en el teléfono.
//   node pixel-reaccion.cjs <carpeta de capturas>
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
    if (s && s.cam) await p.evaluate(`(() => { try { releaseCamera(); } catch (_) {} })()`).catch(() => {});
    p.close();
  }
  if (!c) throw new Error('ninguna pestaña de FLIP está a la vista en el teléfono');
  const js = (fn, ...args) => c.evaluate('(' + fn.toString() + ')(' + args.map(a => JSON.stringify(a)).join(',') + ')');
  await c.send('Network.enable'); await c.send('Network.setBypassServiceWorker', { bypass: true }); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (!(await c.evaluate('location.href')).startsWith(URL0)) await c.navigate(URL0 + '/'); else await c.reload();
  await P.sleep(1800);
  for (let i = 0; i < 80; i++) { if (await c.evaluate(`document.readyState === 'complete' && !!window.flipShell && !!window.flipReaccion`).catch(() => false)) break; await P.sleep(500); }
  await P.sleep(800);
  if (await c.evaluate(`!document.getElementById('splash').classList.contains('hidden')`)) await c.tap('#btnSplashOriginal');
  for (let i = 0; i < 30; i++) { if (await c.evaluate('typeof vid !== "undefined" && vid.videoWidth > 0')) break; await P.sleep(1000); }
  if (await c.evaluate('activeTab') !== 'cam') { await c.tap('#shellModule'); await P.sleep(600); await c.tap('#shellLauncher [data-module="cam"]'); await P.sleep(900); }
  const before = await js(() => ({ family: camFamily, variant: camVariant, facing: facingMode }));
  await js(() => { _setCamFamily('VFD'); camVariant = 'REAC'; _applyCamState(); });
  await P.sleep(1500);
  const measure = async (label, seconds) => {
    const a = await js(() => ({ f: flipReaccion.state().frame, t: performance.now() }));
    await P.sleep(seconds * 1000);
    const b = await js(() => ({ f: flipReaccion.state().frame, t: performance.now(), s: flipReaccion.state(), lcd: document.getElementById('lcdFps').textContent, tilt: window.flipLight && flipLight.tilt(), dpr: devicePixelRatio, grano: getComputedStyle(document.documentElement).getPropertyValue('--grano-px'), voz: flipFeel.state().voice, haptic: document.body.dataset.haptic }));
    console.log('✓ ' + label + ' · ' + JSON.stringify({ cuadrosPorSeg: +((b.f - a.f) / ((b.t - a.t) / 1000)).toFixed(1), pantallita: b.lcd, msQuimica: b.s.ms, pasos: b.s.steps, vivo: b.s.alive, movimiento: b.s.motion, inclinacion: b.tilt, dpr: b.dpr, granoPx: b.grano, voz: b.voz, tacto: b.haptic }));
  };
  await measure('REACCIÓN, cámara trasera', 5);
  await c.screenshot(path.join(out, 'reaccion-1-trasera.jpg'), { quality: 88 });
  await P.sleep(3000);
  await c.screenshot(path.join(out, 'reaccion-2-trasera-3s.jpg'), { quality: 88 });
  await c.tap('#deckFlip');
  for (let i = 0; i < 16; i++) { await P.sleep(500); if (await c.evaluate('vid.videoWidth > 0 && facingMode !== ' + JSON.stringify(before.facing))) break; }
  await P.sleep(3500);
  await measure('REACCIÓN, cámara frontal', 4);
  await c.screenshot(path.join(out, 'reaccion-3-frontal.jpg'), { quality: 88 });
  await c.tap('#deckFlip');
  await P.sleep(2500);
  // Las opciones: cada paleta y la invertida, con la cámara trasera; y sus teclas en el cajón.
  for (const [name, o] of [['brasa', { palette: 'brasa', invert: false }], ['orquidea', { palette: 'orquidea', invert: false }], ['invertida', { palette: 'fosforo', invert: true }]]) {
    await js(o => flipReaccion.set(o), o);
    await P.sleep(3500);
    await c.screenshot(path.join(out, 'reaccion-4-' + name + '.jpg'), { quality: 88 });
  }
  await js(() => flipReaccion.set({ palette: 'fosforo', invert: false }));
  console.log('✓ teclas en la banda · ' + JSON.stringify(await js(() => ({ visibles: !document.querySelector('.si-rapidas:not(.clon-rapidas)').hidden, teclas: [...document.querySelectorAll('.si-rapidas:not(.clon-rapidas) button')].map(k => k.textContent.trim() + ':' + Math.round(k.getBoundingClientRect().width) + 'x' + Math.round(k.getBoundingClientRect().height)), caben: document.querySelector('.si-rapidas:not(.clon-rapidas)').getBoundingClientRect().right <= innerWidth }))));
  await c.screenshot(path.join(out, 'reaccion-5-banda.jpg'), { quality: 88 });
  if (process.env.PIXEL_KEEP !== '1') await js((f, v) => { _setCamFamily(f); camVariant = v; _applyCamState(); }, before.family, before.variant);
  c.close();
})().catch(error => { console.error('✗', error.message); process.exitCode = 1; });
