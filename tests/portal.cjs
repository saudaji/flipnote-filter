// PORTAL: la ventana que se abre con las manos.
// Las manos se simulan con posiciones conocidas (flipPortal.use) para que el resultado sea
// reproducible; al final se carga el rastreador real para comprobar que arranca.
//   FLIP_URL=http://127.0.0.1:8760 node tests/portal.cjs [carpeta-de-capturas]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch, openFlip, openModule } = require('./lib/harness.cjs');
const out = process.argv[2];

// Una mano con el pulgar (4) y el índice (8) donde se pide; el resto de puntos, cerca.
const HAND = `(thumb, index) => { const p = new Float32Array(42); for (let i = 0; i < 21; i++) { p[2 * i] = (thumb[0] + index[0]) / 2; p[2 * i + 1] = (thumb[1] + index[1]) / 2 + 0.06; } p[8] = thumb[0]; p[9] = thumb[1]; p[16] = index[0]; p[17] = index[1]; return p; }`;

async function main() {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
    const settle = ms => page.waitForTimeout(ms);
    // Media de color dentro de un rectángulo del visor, en fracciones.
    const zone = rect => page.evaluate(([x, y, w, h]) => {
      const c = document.createElement('canvas'); c.width = 48; c.height = 48;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(display, x * display.width, y * display.height, w * display.width, h * display.height, 0, 0, 48, 48);
      const d = ctx.getImageData(0, 0, 48, 48).data; let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4; return { r: r / n, g: g / n, b: b / n, green: (g - (r + b) / 2) / n };
    }, rect);
    const INSIDE = [0.42, 0.42, 0.16, 0.16], OUTSIDE = [0.04, 0.04, 0.12, 0.1];
    const greenness = c => c.g - (c.r + c.b) / 2;

    // 1 · Entrar por el lanzador: PORTAL vive sobre CAM.
    await openModule(page, 'portal');
    await page.evaluate(() => { _setCamFamily('DSI'); });
    let st = await page.evaluate(() => ({ ...flipPortal.status(), tab: activeTab, module: flipShell.module(), slht: getComputedStyle(document.querySelector('.look[data-family="SLHT"]')).display, extra: document.querySelectorAll('.portal-look').length }));
    assert.equal(st.active, true); assert.equal(st.tab, 'cam'); assert.equal(st.module, 'portal');
    assert.equal(st.slht, 'none', 'SLHT no se ofrece en PORTAL');
    assert.equal(st.extra, 3, 'ASCII y las dos de sonido se suman a la bandeja');

    // 2 · Sin manos: la cámara tal cual.
    await page.evaluate(() => flipPortal.use(() => []));
    await settle(700);
    const plain = await zone(INSIDE);
    st = await page.evaluate(() => flipPortal.status());
    assert.equal(st.amount, 0, 'sin manos no hay ventana');

    // 3 · Marco con las dos manos: la ventana se abre y dentro se ve el emulador.
    await page.evaluate(src => { const hand = eval(src); flipPortal.use(() => [hand([0.3, 0.68], [0.3, 0.3]), hand([0.7, 0.68], [0.7, 0.3])]); }, HAND);
    await settle(1200);
    st = await page.evaluate(() => flipPortal.status());
    assert.equal(st.shape, 'quad'); assert.ok(st.amount > 0.95, 'la ventana se abre: ' + st.amount); assert.ok(st.area > 0.1 && st.area < 0.2, 'área del marco ' + st.area);
    const inside = await zone(INSIDE), outside = await zone(OUTSIDE);
    assert.ok(greenness(inside) > greenness(plain) + 18, 'dentro se ve DSi (verde): ' + greenness(inside).toFixed(1) + ' frente a ' + greenness(plain).toFixed(1));
    assert.ok(greenness(outside) < greenness(inside) - 18, 'fuera sigue la cámara');
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'portal-dsi.png') }); }

    // 4 · La foto es lo que hay en el visor.
    const photo = await page.evaluate(async () => {
      const blob = await cameraPhoto(); const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = 96; c.height = 96; const ctx = c.getContext('2d');
      ctx.drawImage(bmp, bmp.width * 0.42, bmp.height * 0.42, bmp.width * 0.16, bmp.height * 0.16, 0, 0, 96, 96);
      const d = ctx.getImageData(0, 0, 96, 96).data; let g = 0, rb = 0; for (let i = 0; i < d.length; i += 4) { g += d[i + 1]; rb += (d[i] + d[i + 2]) / 2; }
      return { type: blob.type, green: (g - rb) / (d.length / 4), size: [bmp.width, bmp.height] };
    });
    assert.equal(photo.type, 'image/jpeg');
    assert.ok(photo.green > greenness(plain) + 18, 'la foto lleva la ventana: ' + photo.green.toFixed(1));

    // 5 · STAMP entra con su trama, sin el marco del sello, y no cambia el ajuste del usuario.
    await page.locator('#deckLooks [data-family="STAMP"]').click();
    await settle(700);
    const stamp = await page.evaluate(() => ({ frame: stampFrameMode, status: flipPortal.status() }));
    assert.equal(stamp.frame, 'ON', 'el marco de STAMP sigue como estaba');
    assert.ok(stamp.status.amount > 0.95);

    // 6 · Las diapositivas propias: ASCII y sonido.
    for (const look of ['ASCII', 'SONO', 'WMP']) {
      await page.locator('#deckLooks [data-look="' + look + '"]').click();
      await settle(500);
      st = await page.evaluate(() => ({ ...flipPortal.status(), lcd: document.getElementById('lcdLook').textContent }));
      assert.equal(st.look, look); assert.ok(st.lcd.includes(look), 'la pantallita dice ' + st.lcd);
    }
    if (out) await page.screenshot({ path: path.join(out, 'portal-ascii.png') });
    await page.locator('#deckLooks [data-family="DLPHN"]').click();
    await settle(400);
    assert.equal((await page.evaluate(() => flipPortal.status())).look, '', 'volver a una cámara quita la diapositiva propia');

    // 7 · Una sola mano: una lente entre el pulgar y el índice.
    await page.evaluate(src => { const hand = eval(src); flipPortal.use(() => [hand([0.42, 0.6], [0.58, 0.4])]); }, HAND);
    await settle(900);
    st = await page.evaluate(() => flipPortal.status());
    assert.equal(st.shape, 'lens'); assert.ok(st.amount > 0.9);
    if (out) await page.screenshot({ path: path.join(out, 'portal-lente.png') });

    // 8 · Manos juntas: la ventana se cierra.
    await page.evaluate(src => { const hand = eval(src); flipPortal.use(() => [hand([0.49, 0.5], [0.49, 0.5]), hand([0.51, 0.5], [0.51, 0.5])]); }, HAND);
    await settle(900);
    assert.ok((await page.evaluate(() => flipPortal.status())).amount < 0.05, 'con las manos juntas no hay ventana');

    // 9 · Salir devuelve CAM a su estado.
    await openModule(page, 'cam');
    st = await page.evaluate(() => ({ active: flipPortal.active, module: flipShell.module(), slht: getComputedStyle(document.querySelector('.look[data-family="SLHT"]')).display, mode: document.body.classList.contains('portal-mode') }));
    assert.deepEqual([st.active, st.module, st.mode], [false, 'cam', false]);
    assert.notEqual(st.slht, 'none');

    // 10 · El rastreador real arranca (necesita red la primera vez).
    await openModule(page, 'portal');
    await page.evaluate(() => { flipPortal.use(null); flipPortal.start(); });
    const real = await page.waitForFunction(() => { const s = flipPortal.status(); return s.phase === 'ready' || s.phase === 'failed' ? s : null; }, null, { timeout: 60000 }).then(h => h.jsonValue());
    if (real.phase !== 'ready') console.log('aviso: el rastreador real no cargó (' + real.error + ')');
    else { await settle(1500); st = await page.evaluate(() => flipPortal.status()); console.log('rastreador real · ' + st.ms.toFixed(0) + ' ms por cuadro'); }
    assert.deepEqual(errors, []);
    console.log('PASS · portal · ' + JSON.stringify({ dentro: +greenness(inside).toFixed(1), fuera: +greenness(outside).toFixed(1), foto: photo.size.join('x'), rastreador: real.phase }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
