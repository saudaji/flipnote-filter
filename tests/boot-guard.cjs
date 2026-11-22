// El vigía de arranque: FLIP nunca se queda en blanco sin decir por qué.
//   · arranque normal: ni aviso ni rastro;
//   · si no carga la carcasa o el guion principal se corta, pantalla de aviso con el motivo y un
//     botón que recarga borrando la copia guardada por el service worker;
//   · si lo que falla es un módulo opcional (PORTAL), la cámara funciona y se avisa;
//   · con la app en marcha, un cuadro que falla no deja el visor parado;
//   · en navegadores hostiles (almacenamiento bloqueado o lleno, un módulo que no arranca, sin
//     WebGL, sin VideoFrame ni OffscreenCanvas, sin service worker) la cámara enciende y pinta.
//   FLIP_URL=http://127.0.0.1:8760 node tests/boot-guard.cjs
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, PIXEL, URL } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

async function open(browser, tamper) {
  const context = await browser.newContext({ ...PIXEL });
  await context.addInitScript({ path: path.join(__dirname, 'scenes.js') });
  await context.addInitScript({ path: path.join(__dirname, 'lib', 'page-kit.js') });
  await context.addInitScript(config => { window.__flipSceneCamera = config; }, { scene: 'roomLit', w: 1280, h: 720 });
  await context.addInitScript({ path: path.join(__dirname, 'lib', 'scene-camera.js') });
  if (tamper) await tamper(context);
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  return { context, page };
}
const guard = page => page.evaluate(() => ({ ...window.__flipBoot.state(), screen: !!document.getElementById('flipBootFail'), text: (document.getElementById('flipBootFail') || {}).textContent || '' }));

async function main() {
  const browser = await launch();
  try {
    // 1 · Arranque normal.
    let { context, page } = await open(browser);
    await page.waitForTimeout(600);
    let st = await guard(page);
    assert.deepEqual([st.done, st.failed, st.screen, st.errors.length], [true, false, false, 0], 'arranque limpio: ' + JSON.stringify(st));
    // …y con la app en marcha, un cuadro que falla no deja el visor parado.
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0);
    await page.waitForTimeout(500);
    // Un aviso inofensivo del navegador (los hay) o un error de otra parte no es un tropiezo del visor:
    // se anota, pero ni reanuda nada ni acaba en un aviso de «tropiezo al dibujar».
    await page.evaluate(() => { for (let i = 0; i < 10; i++) window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })); });
    await page.waitForTimeout(1600);
    st = await guard(page);
    assert.deepEqual([st.stumbles, st.seen], [0, 10], 'los avisos inofensivos no cuentan como tropiezos: ' + JSON.stringify(st));
    assert.equal(await page.evaluate(() => /tropiezo/.test(document.body.innerText)), false, 'ni sale el aviso de tropiezo');
    const resumed = await page.evaluate(() => new Promise(done => {
      const real = _renderCamEngineFrame;
      let thrown = 0, drawn = 0;
      _renderCamEngineFrame = function () { if (thrown < 3) { thrown++; throw new Error('cuadro roto de prueba'); } drawn++; return real.apply(this, arguments); };
      setTimeout(() => { _renderCamEngineFrame = real; done({ thrown, drawn, stumbles: __flipBoot.state().stumbles }); }, 5000);
    }));
    assert.equal(resumed.thrown, 3);
    assert.ok(resumed.drawn > 8, 'el visor se reanuda tras los cuadros rotos: ' + JSON.stringify(resumed));
    assert.equal(resumed.stumbles, 3, 'cada cuadro roto, una reanudación: ' + JSON.stringify(resumed));
    step('arranque normal y visor que se reanuda', resumed);
    await context.close();

    // 2 · La carcasa no carga: aviso con el motivo, no una página vacía.
    ({ context, page } = await open(browser, ctx => ctx.route('**/shell.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'var roto = (((;' }))));
    await page.waitForSelector('#flipBootFail', { timeout: 8000 });
    st = await guard(page);
    assert.ok(/FLIP no pudo arrancar/.test(st.text) && /carcasa/.test(st.text), 'dice qué falló: ' + st.text.slice(0, 200));
    assert.ok(await page.locator('#flipBootRetry').isVisible());
    // «Recargar limpio» borra la copia guardada y recarga.
    await page.evaluate(async () => { const cache = await caches.open('flipnote-filter-prueba'); await cache.put('./x', new Response('x')); });
    await context.unroute('**/shell.js');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.locator('#flipBootRetry').click()]);
    await page.waitForFunction(() => window.__flipBoot && window.__flipBoot.state().done);
    st = await guard(page);
    assert.equal(st.screen, false, 'tras recargar limpio, la app arranca');
    assert.equal((await page.evaluate(() => caches.keys())).includes('flipnote-filter-prueba'), false, 'la caché vieja se borró');
    step('sin carcasa: aviso, y «Recargar limpio» lo arregla');
    await context.close();

    // 3 · El guion principal se corta a medias.
    ({ context, page } = await open(browser, ctx => ctx.route(url => url.pathname === '/' || url.pathname.endsWith('/index.html'), async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace('<script src="./frame-runtime.js"></script>\n<script>', '<script src="./frame-runtime.js"></script>\n<script>\nthrow new Error("motor roto de prueba");');
      route.fulfill({ response, body: html });
    })));
    await page.waitForSelector('#flipBootFail', { timeout: 8000 });
    st = await guard(page);
    assert.ok(/motor de la cámara/.test(st.text) && /motor roto de prueba/.test(st.text), 'enseña el error: ' + st.text.slice(0, 300));
    step('guion principal cortado: aviso con el error');
    await context.close();

    // 4 · Falla un módulo opcional: la cámara funciona igual.
    ({ context, page } = await open(browser, ctx => ctx.route('**/portal.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'throw new Error("portal roto de prueba");' }))));
    await page.waitForTimeout(800);
    st = await guard(page);
    assert.deepEqual([st.done, st.screen], [true, false], 'sin PORTAL la app arranca: ' + JSON.stringify(st));
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    step('sin PORTAL: la cámara funciona');
    await context.close();

    // 5 · Navegadores hostiles: la cámara enciende y el visor pinta en todos, sin aviso de fallo.
    const viewfinder = () => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 16; c.height = 12; const x = c.getContext('2d'); x.drawImage(display, 0, 0, 16, 12); const d = x.getImageData(0, 0, 16, 12).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]; return Math.round(sum / (d.length / 4)); });
    const hostile = [
      // Safari con «Bloquear todas las cookies», o un navegador dentro de otra app: nombrar localStorage lanza.
      ['almacenamiento bloqueado', ctx => ctx.addInitScript(() => { const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); }; for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { configurable: true, get: deny }); })],
      ['almacenamiento lleno', ctx => ctx.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); }; })],
      // Un módulo que lanza al iniciarse deja su nombre declarado y sin valor: preguntar por él no puede parar la cámara.
      ['PORTAL falla al iniciarse', ctx => ctx.route('**/portal.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'const flipPortal = (() => { throw new Error("portal no arranca"); })();' }))],
      ['STAGE falla al iniciarse', ctx => ctx.route('**/stage.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'const flipStage = (() => { throw new Error("stage no arranca"); })();' }))],
      ['sin WebGL', ctx => ctx.addInitScript(() => { const real = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type) { return /webgl/.test(type) ? null : real.apply(this, arguments); }; })],
      ['sin VideoFrame ni OffscreenCanvas', ctx => ctx.addInitScript(() => { try { delete window.VideoFrame; } catch (_) {} try { delete window.OffscreenCanvas; } catch (_) {} try { delete HTMLVideoElement.prototype.requestVideoFrameCallback; } catch (_) {} })],
      ['sin service worker ni caché', ctx => ctx.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch (_) {} try { delete window.caches; } catch (_) {} })],
    ];
    for (const [name, tamper] of hostile) {
      ({ context, page } = await open(browser, tamper));
      await page.waitForTimeout(500);
      st = await guard(page);
      assert.deepEqual([st.done, st.screen], [true, false], name + ': arranca sin aviso de fallo · ' + JSON.stringify(st.errors));
      await page.locator('#btnSplashOriginal').click();
      await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
      await page.waitForTimeout(1300);
      const level = await viewfinder();
      assert.ok(level > 30, name + ': el visor pinta (' + level + ')');
      st = await guard(page);
      assert.deepEqual([st.stumbles, st.seen], [0, 0], name + ': ningún cuadro falla ni salta ningún error');
      await context.close();
    }
    step('navegadores hostiles', hostile.map(h => h[0]));

    console.log('PASS · vigía de arranque');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
