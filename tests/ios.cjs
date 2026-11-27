// iPhone y iPad: lo que en Safari es distinto y ya rompió algo. Se prueba con la identidad de un
// iPhone sobre el navegador de las pruebas (y, con FLIP_ENGINE=webkit, sobre el motor de Safari de
// verdad). Lo que tiene que seguir siendo verdad:
//   · LA IMAGEN NO SALE ACOSTADA: en WebKit no se usa la lectura rápida de la cámara (sus cuadros
//     nativos vienen como los da el sensor, girados); los motores leen el vídeo, que ya viene
//     derecho. Y en cualquier navegador, un cuadro nativo con los lados cambiados respecto al vídeo
//     se rechaza en vez de pintarse girado;
//   · EL RESPLANDOR: Safari no tiene filtros de lienzo; el desenfoque de VFD, DLPHN y AUTO 03 se hace
//     entonces reduciendo y ampliando, y la imagen no sale quemada;
//   · LA PÁGINA NO SE AGRANDA SOLA: tope de escala al enfocar un campo, y el pellizco no es de la página;
//   · UN iPAD ES iOS aunque diga ser un Mac;
//   · LOS AVISOS hablan de Safari, no del candado de Chrome;
//   · EL SELLO espacia sus letras aunque el lienzo no sepa hacerlo.
//   FLIP_URL=http://127.0.0.1:8760 node tests/ios.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, pickCamera, IPHONE, ENGINE } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const identity = { userAgent: IPHONE.userAgent, viewport: IPHONE.viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { context: identity, sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30, freeze: 1 } });
    await page.waitForTimeout(900);

    // ── 1 · La imagen no sale acostada ──
    const cam = await page.evaluate(() => { const f = liveCamFrame(); return { ios: _IS_IOS, usable: flipSensor.usable(vid), status: flipSensor.status(vid), fromVideo: f.source === vid, size: [f.srcW, f.srcH], video: [vid.videoWidth, vid.videoHeight] }; });
    assert.equal(cam.ios, true, 'se reconoce un iPhone');
    assert.equal(cam.usable, false, 'en iPhone no se usa la lectura rápida de la cámara: ' + JSON.stringify(cam.status));
    assert.ok(cam.fromVideo && cam.size[0] === 720 && cam.size[1] === 1280, 'los motores leen el vídeo, en vertical: ' + JSON.stringify(cam));
    // …y un cuadro nativo acostado (lados cambiados respecto al vídeo) se rechaza
    const turned = await page.evaluate(async () => {
      if (typeof VideoFrame !== 'function') return null;
      const make = () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); x.fillStyle = '#284'; x.fillRect(0, 0, 640, 360); return new VideoFrame(c, { timestamp: 0 }); };
      const a = make(), wrong = await flipSensor.convertFrame(a, { videoWidth: 360, videoHeight: 640 }); a.close();
      const b = make(), right = await flipSensor.convertFrame(b, { videoWidth: 640, videoHeight: 360 }); b.close();
      return { wrong: { failed: !!wrong.failed, why: wrong.why || '' }, right: { failed: !!right.failed, size: [right.width, right.height] } };
    });
    if (turned) {
      assert.deepEqual(turned.wrong, { failed: true, why: 'cuadro con orientación' }, 'un cuadro acostado no se pinta');
      assert.deepEqual(turned.right, { failed: false, size: [640, 360] }, 'uno derecho, sí');
    }
    step('la imagen no sale acostada: en iPhone se lee el vídeo, y un cuadro nativo girado se rechaza', { camara: cam.size, girado: turned && turned.wrong.why });

    // ── 2 · El resplandor sin filtros de lienzo ──
    const blur = await page.evaluate(() => {
      const dot = () => { const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 96, 96); x.fillStyle = '#fff'; x.fillRect(40, 40, 16, 16); return c; };
      const run = () => { const out = document.createElement('canvas'); out.width = out.height = 96; const x = out.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#000'; x.fillRect(0, 0, 96, 96); drawBlurred(x, dot(), 4, 96, 96); const d = x.getImageData(0, 0, 96, 96).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i]; return { sum, centre: d[(48 * 96 + 48) * 4], edge: d[(48 * 96 + 60) * 4], far: d[(48 * 96 + 80) * 4] }; };
      const native = canvasHasFilters() ? run() : null;
      _canvasFilters = false;
      const fallback = run();
      return { had: !!native, native, fallback, plain: 16 * 16 * 255 };
    });
    assert.ok(blur.fallback.edge > 12 && blur.fallback.far < 6 && blur.fallback.centre > 120, 'sin filtros, el desenfoque abre un halo alrededor y no más lejos: ' + JSON.stringify(blur.fallback));
    // (es una aproximación: sobre una mancha tan pequeña la luz total baila; en una imagen se compensa,
    //  y eso es lo que se mide después con las cámaras)
    assert.ok(Math.abs(blur.fallback.sum - blur.plain) < blur.plain * 0.4, 'y no inventa ni pierde luz: ' + JSON.stringify(blur));
    if (blur.had) assert.ok(Math.abs(blur.fallback.edge - blur.native.edge) < 70 && blur.native.far < 6, 'se parece al filtro de verdad: ' + JSON.stringify(blur));
    // (sigue en «modo Safari») las tres cámaras con resplandor dibujan, y no quemadas
    const view = () => page.evaluate(() => { const g = document.createElement('canvas'); g.width = 96; g.height = 72; const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, 0, 96, 72); const d = c.getImageData(0, 0, 96, 72).data; let sum = 0, white = 0; for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += v; if (v > 245) white++; } return { mean: Math.round(sum / (d.length / 4)), white: +(white / (d.length / 4)).toFixed(3) }; });
    const glow = {};
    for (const family of ['VFD', 'DLPHN', 'AUTO03']) {
      await pickCamera(page, family);
      await page.waitForFunction(f => camFamily === f, family, { timeout: 5000 });
      await page.waitForTimeout(700);
      const soft = await view();
      let hard = null;
      if (blur.had) { await page.evaluate(() => { _canvasFilters = true; }); await page.waitForTimeout(500); hard = await view(); await page.evaluate(() => { _canvasFilters = false; }); }
      glow[family] = { sinFiltros: soft, conFiltros: hard };
      assert.ok(soft.mean > 8 && soft.white < 0.5, family + ': dibuja y no sale quemada: ' + JSON.stringify(soft));
      if (hard) assert.ok(Math.abs(soft.mean - hard.mean) < 10, family + ': con y sin filtros de lienzo se ve igual de luminosa: ' + JSON.stringify(glow[family]));
    }
    step('el resplandor de VFD, DLPHN y AUTO 03 se hace sin filtros de lienzo', glow);

    // ── 3 · La página no se agranda sola ──
    const page3 = await page.evaluate(() => ({ viewport: document.querySelector('meta[name="viewport"]').content, gate: cameraGateMessage({ name: 'NotAllowedError' }) }));
    assert.match(page3.viewport, /maximum-scale=1/, 'tope de escala para que enfocar un campo no agrande la página');
    assert.match(page3.viewport, /viewport-fit=cover/);
    const pinch = await page.evaluate(() => { const e = new Event('gesturestart', { cancelable: true, bubbles: true }); document.body.dispatchEvent(e); return e.defaultPrevented; });
    assert.equal(pinch, true, 'el pellizco de Safari no agranda la página');
    assert.match(page3.gate[1], /Safari/, 'el aviso de cámara bloqueada habla de Safari: ' + page3.gate[1]);
    assert.doesNotMatch(page3.gate[1], /candado/);
    step('la página no se agranda sola y los avisos hablan de Safari', { vista: page3.viewport });

    // ── 4 · El sello espacia sus letras aunque el lienzo no sepa ──
    const stamp = await page.evaluate(() => {
      const box = () => { const c = document.createElement('canvas'); c.width = 400; c.height = 80; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 80); _stampText(x, 'FLIP', 200, 55, 40, 'Georgia, serif', '#000', { spacing: 0.3 }); const d = x.getImageData(0, 0, 400, 80).data; let lo = 400, hi = 0; for (let y = 0; y < 80; y++) for (let px = 0; px < 400; px++) if (d[(y * 400 + px) * 4] < 128) { if (px < lo) lo = px; if (px > hi) hi = px; } return [lo, hi]; };
      const had = 'letterSpacing' in CanvasRenderingContext2D.prototype, native = had ? box() : null;
      let removed = !had;
      if (had) { try { removed = delete CanvasRenderingContext2D.prototype.letterSpacing; } catch (_) { removed = false; } }
      return { had, removed: removed && !('letterSpacing' in CanvasRenderingContext2D.prototype), native, manual: box() };
    });
    if (stamp.removed) {
      const [lo, hi] = stamp.manual;
      assert.ok(hi - lo > 110 && Math.abs((lo + hi) / 2 - 200) < 6, 'letra a letra, el rótulo queda espaciado y centrado: ' + JSON.stringify(stamp));
      if (stamp.native) assert.ok(Math.abs(lo - stamp.native[0]) < 6 && Math.abs(hi - stamp.native[1]) < 6, 'y ocupa lo mismo que con el espaciado del lienzo: ' + JSON.stringify(stamp));
    }
    step('el sello espacia sus letras sin ayuda del lienzo', stamp);
    assert.deepEqual(errors.filter(e => !/ResizeObserver loop/.test(e)), [], 'sin errores');
    await page.context().close();

    // ── 5 · Un iPad dice ser un Mac ──
    const pad = await openFlip(browser, {
      context: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', viewport: { width: 820, height: 1100 }, deviceScaleFactor: 2, isMobile: ENGINE !== 'webkit', hasTouch: true },
      sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30, freeze: 1 }, boot: false,
      url: undefined,
    });
    await pad.context.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 }); Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }); } catch (_) {} });
    await pad.page.reload();
    await pad.page.waitForFunction(() => typeof _IS_IOS !== 'undefined', null, { timeout: 15000 });
    const ipad = await pad.page.evaluate(() => ({ ios: _IS_IOS, viewport: document.querySelector('meta[name="viewport"]').content }));
    assert.equal(ipad.ios, true, 'un iPad se trata como iOS');
    assert.match(ipad.viewport, /maximum-scale=1/);
    step('un iPad, que dice ser un Mac, se trata como iOS');
    console.log('IOS PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
