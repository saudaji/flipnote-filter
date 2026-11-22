// Actualización desde la app publicada. Quien ya usaba FLIP llega con el service worker de la
// versión anterior instalado y con sus ajustes guardados en el formato de entonces. Esta prueba
// lo reproduce en un mismo origen: abre la versión publicada (por defecto 0b13252, la última de
// main antes de la alfa), la usa y guarda ajustes, publica la versión actual en ese origen y
// comprueba que la nueva se instala sola, respeta lo guardado, no deja cachés viejas, funciona
// (cámara, foto, PORTAL, STAGE, VFD · CRT, teclas) y arranca sin red.
//   FLIP_URL no hace falta: levanta su propio servidor.
//   node tests/update-published.cjs [--ref 0b13252]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, PIXEL } = require('./lib/harness.cjs');

const args = process.argv.slice(2);
const refAt = args.indexOf('--ref');
const oldRef = refAt >= 0 ? args[refAt + 1] : '0b13252';
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

function serve(getRoot) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(req.url.split('?')[0]);
    if (file === '/') file = '/index.html';
    fs.readFile(path.join(getRoot(), file), (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// La app se recarga sola cuando su service worker cambia: mientras eso pasa, una consulta a la
// página puede caer en medio de la navegación. Estas dos ayudas reintentan hasta que se asienta.
async function until(page, fn, arg, timeout = 30000) {
  const began = Date.now();
  for (;;) {
    try { const value = await page.evaluate(fn, arg); if (value) return value; } catch (_) {}
    if (Date.now() - began > timeout) throw new Error('no se cumple a tiempo: ' + String(fn).slice(0, 90));
    await page.waitForTimeout(250);
  }
}
async function reload(page) {
  try { await page.reload(); } catch (_) {}
  try { await page.waitForLoadState('load'); } catch (_) {}
}

async function main() {
  const repo = path.join(__dirname, '..');
  const previous = fs.mkdtempSync(path.join(os.tmpdir(), 'flip-publicada-'));
  execFileSync('sh', ['-c', `git -C "${repo}" archive ${oldRef} docs | tar -x -C "${previous}"`]);
  let root = path.join(previous, 'docs');
  const server = await serve(() => root);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await launch();
  try {
    const context = await browser.newContext({ ...PIXEL, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [], noise = [];
    page.on('pageerror', error => errors.push(String(error && error.message || error)));
    page.on('console', message => { if (message.type() === 'error') noise.push(message.text().slice(0, 240)); });

    // ── 1 · La versión publicada, usada de verdad: cámara abierta, otra cámara elegida, ajustes guardados ──
    await page.goto(origin);
    await until(page, () => navigator.serviceWorker.ready.then(() => true));
    await page.waitForTimeout(1500);                       // la versión publicada se recarga sola al activarse su service worker
    if (!(await until(page, () => navigator.serviceWorker.controller ? 'si' : 'no')).startsWith('si')) await reload(page);
    await until(page, () => !!navigator.serviceWorker.controller && document.readyState === 'complete' && !!document.getElementById('btnSplashOriginal'));
    await page.waitForTimeout(800);
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    const before = await page.evaluate(async () => {
      camFamily = 'VFD'; camVariant = 'THRML';
      if (typeof _applyCamState === 'function') _applyCamState();
      window._stageState = { layers: [{ id: 'a', src: 'cam', opacity: 0.7, blend: 'screen' }], master: 0.8, bpm: 126 };
      saveSettings();
      const audio = JSON.parse(JSON.stringify(FLIP_AUDIO_DEFAULT_SETTINGS));
      audio.aspectRatio = '1:1'; audio.resolution = 'high'; audio.effects.echo.enabled = true; audio.micEnabled = true;
      localStorage.setItem(FLIP_AUDIO_SETTINGS_KEY, JSON.stringify(audio));
      localStorage.setItem('flip_ext_gain', '1.4');
      localStorage.setItem(CUSTOM_SLOTS_KEY, JSON.stringify({ DSI: [['#102030', '#405060', '#8090a0', '#f0f0f0'], null, null, null, null], ASCII: [null, null, null, null, null], VFD: [null, null, null, null, null] }));
      return { caches: await caches.keys(), keys: Object.keys(localStorage).sort(), crt: CAM_FAMILIES.VFD.variants.some(v => v.id === 'CRT'), stage: typeof flipStage !== 'undefined' };
    });
    assert.equal(before.crt, false, 'se parte de la versión publicada (sin VFD · CRT)');
    assert.equal(before.stage, false, 'se parte de la versión publicada (sin el STAGE nuevo)');
    assert.equal(before.caches.length, 1);
    step('versión publicada instalada y usada', { ref: oldRef, cache: before.caches[0], guardado: before.keys });
    const oldErrors = errors.splice(0); noise.length = 0;          // lo que fallara en la versión vieja no es de esta prueba

    // ── 2 · Se publica la nueva. La primera apertura aún puede ser la copia vieja; la nueva se instala sola ──
    root = path.join(repo, 'docs');
    await reload(page);
    const firstOpen = await until(page, () => document.readyState === 'complete' && (typeof flipStage === 'undefined' ? 'versión anterior (de su caché)' : 'versión nueva'));
    const installed = () => page.evaluate(async old => {
      const names = (await caches.keys()).filter(name => name.startsWith('flipnote-filter-'));
      const registration = await navigator.serviceWorker.getRegistration();
      return names.length === 1 && names[0] !== old && !!registration.active && registration.active.state === 'activated' && !registration.waiting && !registration.installing;
    }, before.caches[0]).catch(() => false);
    const began = Date.now();
    while (!(await installed()) && Date.now() - began < 45000) await page.waitForTimeout(250);
    assert.ok(await installed(), 'la versión nueva se instala sola con la anterior abierta');
    const installMs = Date.now() - began;
    await page.waitForTimeout(1500);                       // por si la página vieja se está recargando sola
    errors.length = 0; noise.length = 0;
    await reload(page);
    await until(page, () => document.readyState === 'complete' && typeof flipStage !== 'undefined' && typeof flipPortal !== 'undefined' && typeof flipFeel !== 'undefined');
    await page.waitForTimeout(1200);                       // y la nueva, al registrar su propio service worker
    await until(page, () => document.readyState === 'complete' && typeof flipFeel !== 'undefined' && !!navigator.serviceWorker.controller);
    const after = await page.evaluate(async () => ({
      caches: await caches.keys(), family: camFamily, variant: camVariant, crt: CAM_FAMILIES.VFD.variants.some(v => v.id === 'CRT'),
      gain: localStorage.getItem('flip_ext_gain'), audio: JSON.parse(localStorage.getItem(FLIP_AUDIO_SETTINGS_KEY)), slots: JSON.parse(localStorage.getItem(CUSTOM_SLOTS_KEY)).DSI[0],
      splash: !splash.classList.contains('hidden'),
    }));
    assert.deepEqual(after.caches.filter(name => name.startsWith('flipnote-filter-')).length, 1, 'queda una sola caché de la app: ' + after.caches);
    assert.notEqual(after.caches[0], before.caches[0]);
    assert.equal(after.crt, true, 'es la versión nueva');
    assert.deepEqual([after.family, after.variant], ['VFD', 'THRML'], 'recuerda la cámara que tenía elegida');
    assert.equal(after.gain, '1.4');
    assert.equal(after.audio.aspectRatio, '1:1'); assert.equal(after.audio.resolution, 'high'); assert.equal(after.audio.effects.echo.enabled, true);
    assert.deepEqual(after.slots, ['#102030', '#405060', '#8090a0', '#f0f0f0'], 'conserva las paletas guardadas');
    assert.ok(after.splash, 'arranca por la portada');
    step('la nueva se instala sola y respeta lo guardado', { primeraApertura: firstOpen, instalacionMs: installMs, cache: after.caches, camara: after.family + ' ' + after.variant });

    // ── 3 · Y funciona: cámara, VFD · CRT, foto, teclas, PORTAL y STAGE ──
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    await page.locator('#deckLooks [data-family="VFD"]').click();
    await page.locator('#deckVariants [data-variant="CRT"]').click();
    await page.waitForFunction(() => camVariant === 'CRT');
    await page.waitForTimeout(700);
    const [file] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('#deckShutter').click()]);
    const photo = path.join(previous, 'foto' + path.extname(file.suggestedFilename()));
    await file.saveAs(photo);
    assert.ok(fs.statSync(photo).size > 20000, 'la foto pesa ' + fs.statSync(photo).size);
    const feel = await page.evaluate(() => flipFeel.state());
    assert.equal(feel.built, true, 'las teclas tienen sus sonidos');
    await page.locator('#shellModule').click();
    await page.locator('#shellLauncher [data-module="stage"]').click();
    await page.waitForFunction(() => flipStage.status().active && flipStage.status().fps > 0, null, { timeout: 15000 });
    const stage = await page.evaluate(() => ({ fps: Math.round(flipStage.status().fps), ok: flipStage.status().ok, looks: flipStage.tables.LOOKS.length }));
    assert.equal(stage.ok, true, 'STAGE tiene su motor gráfico');
    await page.locator('#shellModule').click();
    await page.locator('#shellLauncher [data-module="portal"]').click();
    await page.waitForFunction(() => flipPortal.active, null, { timeout: 15000 });
    await page.locator('#shellModule').click();
    await page.locator('#shellLauncher [data-module="cam"]').click();
    await page.waitForFunction(() => !flipPortal.active && activeTab === 'cam');
    assert.deepEqual(errors, [], 'errores de página en la versión nueva');
    step('la versión nueva funciona', { foto: fs.statSync(photo).size, stage });

    // ── 4 · Sin red: arranca la nueva y abre sus módulos nuevos desde la caché ──
    await context.setOffline(true);
    errors.length = 0;
    await page.reload();
    await page.waitForFunction(() => typeof flipStage !== 'undefined' && typeof flipFeel !== 'undefined', null, { timeout: 15000 });
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    const sprites = await page.evaluate(async () => {
      const missing = [];
      for (const url of ['./body/body.webp', './body/keycap-key.webp', './body/dial.webp', './body/jack.webp', './body/look-VFD.webp', './feel.js', './stage.js', './stage.css', './stage-out.html', './portal.js', './hands-worker.js', './shell.css', './shell.js', './sensor.js']) {
        try { const response = await fetch(url); if (!response.ok) missing.push(url); } catch (_) { missing.push(url); }
      }
      return missing;
    });
    assert.deepEqual(sprites, [], 'todo lo que la app necesita está en la caché');
    await page.locator('#shellModule').click();
    await page.locator('#shellLauncher [data-module="stage"]').click();
    await page.waitForFunction(() => flipStage.status().active && flipStage.status().fps > 0, null, { timeout: 15000 });
    await context.setOffline(false);
    assert.deepEqual(errors, [], 'errores de página sin red');
    step('sin red arranca y abre STAGE');

    console.log('PASS · actualización desde la app publicada (' + oldRef + ')' + (oldErrors.length ? ' · la versión anterior traía ' + oldErrors.length + ' error(es) propios' : ''));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
