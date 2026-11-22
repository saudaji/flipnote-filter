// FLIP en WebKit, el motor de Safari, con forma de iPhone y la cámara simulada: arranca, enciende
// la cámara, todas las cámaras pintan, PORTAL y STAGE abren y no hay errores de página.
// Necesita un WebKit de Playwright (npx playwright install webkit); si no lo hay, avisa y no falla.
// No sustituye a un iPhone de verdad: comparte motor, no memoria, cámara ni versión de iOS.
//   FLIP_URL=http://127.0.0.1:8760 node tests/webkit-smoke.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { webkit, devices } = require('playwright-core');
const URL = process.env.FLIP_URL || 'http://127.0.0.1:8760';

async function launchWebKit() {
  try { return await webkit.launch(); } catch (_) {}
  // La versión que pide este Playwright no está: sirve cualquier otra que haya en la caché.
  const cache = path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  const builds = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => d.startsWith('webkit-')).sort() : [];
  for (const build of builds.reverse()) {
    const exe = path.join(cache, build, 'pw_run.sh');
    if (!fs.existsSync(exe)) continue;
    try { return await webkit.launch({ executablePath: exe }); } catch (_) {}
  }
  return null;
}

async function main() {
  const browser = await launchWebKit();
  if (!browser) { console.log('AVISO · WebKit no está instalado (npx playwright install webkit): prueba omitida'); return; }
  try {
    const context = await browser.newContext({ ...devices['iPhone 15'] });
    await context.addInitScript({ path: path.join(__dirname, 'scenes.js') });
    await context.addInitScript({ path: path.join(__dirname, 'lib', 'page-kit.js') });
    await context.addInitScript(config => { window.__flipSceneCamera = config; }, { scene: 'roomLit', w: 1280, h: 720, fps: 30 });
    await context.addInitScript({ path: path.join(__dirname, 'lib', 'scene-camera.js') });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error && error.message || error)));
    page.on('crash', () => errors.push('la página se cayó'));
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    let boot = await page.evaluate(() => ({ ...window.__flipBoot.state(), screen: !!document.getElementById('flipBootFail'), ios: _IS_IOS }));
    assert.deepEqual([boot.done, boot.screen, boot.ios], [true, false, true], 'arranca como iPhone: ' + JSON.stringify(boot));
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    await page.waitForTimeout(1000);
    const level = () => page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 32; c.height = 24; const x = c.getContext('2d'); x.drawImage(display, 0, 0, 32, 24);
      const d = x.getImageData(0, 0, 32, 24).data; let sum = 0, sq = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += l; sq += l * l; }
      return { mean: sum / n, std: Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)), alpha: d[3] };
    });
    const variants = await page.evaluate(() => Object.entries(CAM_FAMILIES).flatMap(([family, cfg]) => cfg.variants.map(v => [family, v.id])));
    for (const [family, variant] of variants) {
      await page.evaluate(([f, v]) => { _setCamFamily(f); if (camVariant !== v) { camVariant = v; _applyCamState(); } }, [family, variant]);
      await page.waitForTimeout(family === 'SLHT' ? 4000 : 600);
      const seen = await level();
      assert.ok(seen.alpha === 255 && seen.std > 2, family + ' ' + variant + ' pinta en WebKit: ' + JSON.stringify(seen));
    }
    console.log('✓ ' + variants.length + ' cámaras pintan');
    const open = async key => { await page.locator('#shellModule').click(); await page.locator('#shellLauncher [data-module="' + key + '"]').click(); };
    await open('portal');
    await page.waitForFunction(() => window.flipPortal.active, null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    const portal = await page.evaluate(() => { const s = flipPortal.status(); return { gl: s.gl, phase: s.phase, delay: s.delay }; });
    assert.ok((await level()).std > 2, 'PORTAL enseña la cámara');
    await open('stage');
    await page.waitForFunction(() => flipStage.status().active && flipStage.status().fps > 0, null, { timeout: 20000 });
    const stage = await page.evaluate(() => { const s = flipStage.status(); return { ok: s.ok, fps: Math.round(s.fps) }; });
    assert.equal(stage.ok, true, 'STAGE tiene su motor gráfico en WebKit');
    await open('cam');
    await page.waitForFunction(() => activeTab === 'cam' && vid.videoWidth > 0);
    await page.waitForTimeout(800);
    assert.ok((await level()).std > 2, 'de vuelta en CAM, el visor pinta');
    boot = await page.evaluate(() => window.__flipBoot.state());
    assert.equal(boot.stumbles, 0, 'ningún cuadro falló');
    assert.deepEqual(errors, [], 'errores de página en WebKit');
    console.log('PASS · WebKit ' + browser.version() + ' · iPhone 15 · PORTAL ' + JSON.stringify(portal) + ' · STAGE ' + JSON.stringify(stage));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
