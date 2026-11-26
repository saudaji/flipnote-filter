// La mascota y lo último del tacto en el teléfono de verdad (por USB, con Chrome al frente y una
// pestaña de FLIP a la vista). Recarga la página sin caché (borra la caché local de esta dirección
// de desarrollo para que no sirva archivos viejos), deja VFD · REACCIÓN puesta y lee cómo está la
// mascota: mirada, luz de la escena, sacudidas contadas. No guarda nada en el teléfono.
//   node pixel-mascota.cjs <carpeta de capturas>
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
  // La caché de la dirección de desarrollo guarda la versión de hace un rato con el mismo nombre: fuera.
  await c.evaluate(`(async () => { try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); } catch (_) {} })()`, { awaitPromise: true }).catch(() => {});
  await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.reload();
  await P.sleep(1800);
  for (let i = 0; i < 80; i++) { if (await c.evaluate(`document.readyState === 'complete' && !!window.flipShell && !!window.flipReaccion && !!(window.flipPiel && flipPiel.dizzy)`).catch(() => false)) break; await P.sleep(500); }
  await P.sleep(800);
  if (await c.evaluate(`!document.getElementById('splash').classList.contains('hidden')`)) await c.tap('#btnSplashOriginal');
  for (let i = 0; i < 30; i++) { if (await c.evaluate('typeof vid !== "undefined" && vid.videoWidth > 0')) break; await P.sleep(1000); }
  if (await c.evaluate('activeTab') !== 'cam') { await c.tap('#shellModule'); await P.sleep(600); await c.tap('#shellLauncher [data-module="cam"]'); await P.sleep(900); }
  await js(() => { _setCamFamily('VFD'); camVariant = 'REAC'; _applyCamState(); });
  await P.sleep(3000);
  const read = () => js(() => {
    const sh = document.getElementById('deckShutter'), cs = getComputedStyle(document.documentElement);
    return { version: !!flipPiel.dizzy, variante: camVariant, opciones: flipReaccion.options(), fps: document.getElementById('lcdFps').textContent, ms: flipReaccion.state().ms, luz: document.body.dataset.luz || 'normal', giro: sh.style.getPropertyValue('--lt'), sacudidas: flipLight.state().shakes, mascota: /data:image/.test(cs.getPropertyValue('--si-mascota')), tacto: document.body.dataset.haptic, voz: flipFeel.state().voice, teclas: [...document.querySelectorAll('.si-rapidas:not(.clon-rapidas) button')].map(k => k.textContent.trim()), grano: cs.getPropertyValue('--grano-px') };
  });
  console.log('✓ cargada · ' + JSON.stringify(await read()));
  await c.screenshot(path.join(out, 'mascota-1-pixel.jpg'), { quality: 88 });
  await js(() => flipPiel.dizzy());
  await P.sleep(250);
  await c.screenshot(path.join(out, 'mascota-2-mareo.jpg'), { quality: 88 });
  await js(() => flipShell.hint('Aquí estoy', 2200));
  await P.sleep(500);
  await c.screenshot(path.join(out, 'mascota-3-aviso.jpg'), { quality: 88 });
  // La piel OBJETO: el verde y la mascota en volumen como disparador, con las teclas de REACCIÓN.
  await js(() => flipPiel.set('objeto'));
  await P.sleep(1500);
  console.log('✓ mascota 3D · ' + JSON.stringify(await js(() => { const sh = document.getElementById('deckShutter'), m = t => (t === 'none' ? [1, 0, 0, 1, 0, 0] : t.slice(7, -1).split(',').map(Number)); const mira = m(getComputedStyle(sh.querySelector('.m3-mira')).transform); return { capas: ['.m3-blanco', '.m3-pupila', '.m3-cerrado'].map(sel => (getComputedStyle(sh.querySelector(sel)).backgroundImage.match(/[a-z-]+\.webp/) || [''])[0]), ojoAncho: Math.round(sh.querySelector('.m3-ojo').getBoundingClientRect().width), giroPupila: +(Math.atan2(mira[1], mira[0]) * 180 / Math.PI).toFixed(1), inclinacion: sh.style.getPropertyValue('--lt'), luz: document.body.dataset.luz || 'normal' }; })));
  console.log('✓ piel OBJETO · ' + JSON.stringify(await js(() => ({ disparador: (getComputedStyle(document.getElementById('deckShutter'), '::before').backgroundImage.match(/disparador-[a-z-]+\.webp/) || [''])[0], acento: getComputedStyle(document.body).getPropertyValue('--flip-acento').trim(), teclas: [...document.querySelectorAll('.reaccion-teclas:not(.clon-teclas) button')].map(k => k.textContent.trim()), fps: document.getElementById('lcdFps').textContent }))));
  await c.screenshot(path.join(out, 'mascota-4-objeto.jpg'), { quality: 88 });
  if (process.env.PIXEL_PIEL !== 'objeto') { await js(() => flipPiel.set('interfaz')); await P.sleep(900); await c.screenshot(path.join(out, 'mascota-5-interfaz-verde.jpg'), { quality: 88 }); }
  console.log('✓ lista para jugar');
  c.close();
  process.exit(0);
})().catch(error => { console.error('✗', error.message); process.exit(1); });
