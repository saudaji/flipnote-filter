// Entrar a FLIP y quedarse sin cámara: lo que tiene que seguir siendo verdad.
//   · la portada ofrece tres entradas y dice que nada se sube; la del medio se abre en MÚSICA y
//     FOTO O VIDEO, y por ninguna de las dos se pide la cámara;
//   · elegir la fuente de sonido (SONO y WMP) está en español y con las teclas del aparato;
//   · con la cámara denegada, la puerta de cámara sale en todos los módulos que la usan, dentro de
//     su pantalla y sin avisos en inglés; «usar un archivo» abre el selector y no vuelve a pedirla;
//   · al dar permiso desde la puerta, FLOW arranca (no se queda esperando un botón que no existe);
//   · STAGE sin cámara no deja el monitor en negro: se ve un generador y lo dice;
//   · las pantallas de los módulos empiezan donde acaba la barra de arriba: ninguna tecla queda
//     colgando fuera de la carcasa.
//   FLIP_URL=http://127.0.0.1:8760 node tests/entry.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, openModule } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const SCENE = { scene: 'roomLit', w: 1280, h: 720, fps: 30 };

// Cuenta las veces que la página pide vídeo y, si hace falta, lo deniega como lo haría el navegador.
const watchCamera = (page, deny) => page.evaluate(denied => {
  if (!window.__cam) {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__cam = { asked: 0, deny: false, real };
    window.__camKeep = navigator.mediaDevices;        // WebKit suelta lo asignado si nadie lo sujeta
    navigator.mediaDevices.getUserMedia = constraints => {
      if (constraints && constraints.video) {
        window.__cam.asked++;
        if (window.__cam.deny) return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      }
      return real(constraints);
    };
  }
  window.__cam.deny = denied;
}, deny);
const asked = page => page.evaluate(() => window.__cam.asked);
const gate = page => page.evaluate(() => {
  const g = document.getElementById('cameraGate'), r = g.getBoundingClientRect(), bar = document.getElementById('shellTop').getBoundingClientRect();
  return { shown: !g.hidden, title: document.getElementById('cameraGateTitle').textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), bar: Math.round(bar.bottom),
    toasts: [...document.querySelectorAll('.flip-toast')].map(t => t.textContent).join(' | ') };
});
// Brillo medio (0–255) de un recorte de la pantalla.
async function brightness(page, selector) {
  const box = await page.locator(selector).boundingBox();
  const shot = (await page.screenshot({ clip: { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 } })).toString('base64');
  return page.evaluate(async data => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  }, shot);
}
const ENGLISH = /Camera failed|Requested device|Permission denied|CHOOSE|\bFILE\b|\bMIC\b/;

(async () => {
  const browser = await launch();
  try {
    // ── 1 · La portada y la entrada sin cámara ──
    let { page, errors, context } = await openFlip(browser, { sceneCamera: SCENE, boot: false });
    await watchCamera(page, false);
    const cover = await page.evaluate(() => ({
      doors: [...document.querySelectorAll('.splash-doors > .splash-door, .splash-doors > .splash-par > .splash-door')].filter(d => !d.hidden).map(d => d.querySelector('.splash-door-label').textContent.trim()),
      note: document.querySelector('.splash-nota').textContent.trim(),
    }));
    assert.deepEqual(cover.doors, ['ENCENDER CÁMARA', 'SONIDO O ARCHIVO', 'FLIP STAGE'], 'tres entradas');
    assert.equal(cover.note, 'Todo se procesa en tu dispositivo. Nada se sube.');
    await page.locator('#btnSplashSinCamara').click();
    assert.ok(await page.locator('#btnSplashSono').isVisible() && await page.locator('#btnSplashArchivo').isVisible(), 'la del medio se abre en dos');
    await page.locator('#btnSplashSono').click();
    await page.waitForFunction(() => document.body.dataset.tab === 'sono');
    await page.waitForTimeout(500);
    // Con el micrófono ya permitido SONO arranca solo y el aviso no llega a verse: se lee tal cual está escrito.
    const sono = await page.evaluate(() => ({ tab: document.body.dataset.tab, text: document.getElementById('sonoPerm').textContent.replace(/\s+/g, ' '), key: getComputedStyle(document.getElementById('btnSonoStart')).backgroundColor,
      under: Math.round(parseFloat(getComputedStyle(document.getElementById('sonoPerm')).top) - document.getElementById('shellTop').getBoundingClientRect().bottom) }));
    assert.equal(sono.tab, 'sono');
    assert.equal(await asked(page), 0, 'entrar por MÚSICA no pide la cámara');
    assert.ok(/ELIGE LA FUENTE DE SONIDO/i.test(sono.text) && /MICRÓFONO/.test(sono.text) && /ARCHIVO DE AUDIO/.test(sono.text) && !ENGLISH.test(sono.text), 'SONO pregunta la fuente en español: ' + sono.text);
    assert.notEqual(sono.key, 'rgba(0, 0, 0, 0)', 'con una tecla de verdad');
    assert.equal(sono.under, 0, 'y sin comerse la barra de arriba');
    await openModule(page, 'wmp');
    await page.waitForFunction(() => document.body.dataset.tab === 'wmp');
    const wmp = await page.evaluate(() => document.getElementById('wmpPerm').textContent.replace(/\s+/g, ' '));
    assert.ok(/ELIGE LA FUENTE DE SONIDO/i.test(wmp) && !ENGLISH.test(wmp), 'WMP también: ' + wmp);
    assert.equal(await asked(page), 0);
    step('portada: tres entradas; MÚSICA entra sin cámara y pregunta la fuente en español');
    await context.close();

    ({ page, errors, context } = await openFlip(browser, { sceneCamera: SCENE, boot: false }));
    await watchCamera(page, false);
    await page.locator('#btnSplashSinCamara').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.locator('#btnSplashArchivo').click()]);
    assert.ok(chooser, 'FOTO O VIDEO abre el selector de archivos');
    await page.waitForTimeout(600);
    const file = await page.evaluate(() => ({ tab: document.body.dataset.tab, pill: (document.querySelector('.edit-src-pill.active') || {}).id, gate: !document.getElementById('cameraGate').hidden }));
    assert.deepEqual(file, { tab: 'edit', pill: 'editSrcPhoto', gate: false });
    assert.equal(await asked(page), 0, 'entrar por FOTO O VIDEO no pide la cámara');
    step('FOTO O VIDEO: abre el selector en EDIT sin pedir la cámara');
    await context.close();

    // ── 2 · Cámara denegada ──
    ({ page, errors, context } = await openFlip(browser, { sceneCamera: SCENE, boot: false }));
    await watchCamera(page, true);
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => !document.getElementById('cameraGate').hidden, null, { timeout: 8000 });
    const cam = await gate(page);
    assert.equal(cam.title, 'Cámara bloqueada');
    assert.ok(!ENGLISH.test(cam.toasts), 'sin avisos en inglés: ' + cam.toasts);
    const seen = {};
    for (const key of ['ascii', 'scrash', 'fusion', 'sflow']) {
      await openModule(page, key);
      await page.waitForFunction(() => !document.getElementById('cameraGate').hidden, null, { timeout: 8000 });
      await page.waitForTimeout(500);
      const g = await gate(page);
      assert.ok(g.shown && g.top >= g.bar && g.height >= 200, key + ': la puerta sale dentro de su pantalla: ' + JSON.stringify(g));
      assert.ok(!ENGLISH.test(g.toasts), key + ': sin avisos en inglés: ' + g.toasts);
      seen[key] = g.title;
    }
    const before = await asked(page);
    const [again] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.locator('#btnCameraGateFile').click()]);
    assert.ok(again, '«usar un archivo» abre el selector');
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => ({ tab: document.body.dataset.tab, gate: !document.getElementById('cameraGate').hidden }));
    assert.deepEqual(after, { tab: 'edit', gate: false });
    assert.equal(await asked(page), before, 'y no vuelve a pedir la cámara');
    // En EDIT, volver a la fuente CAM sin permiso enseña la puerta (antes, un aviso suelto).
    await page.locator('#editSrcCam').click();
    await page.waitForFunction(() => !document.getElementById('cameraGate').hidden, null, { timeout: 8000 });
    step('cámara denegada: puerta en todos los módulos y «usar un archivo» sin volver a pedirla', seen);

    // ── 3 · Dar permiso desde la puerta, en FLOW ──
    await openModule(page, 'sflow');
    await page.waitForFunction(() => !document.getElementById('cameraGate').hidden, null, { timeout: 8000 });
    await watchCamera(page, false);
    await page.locator('#btnCameraGate').click();
    await page.waitForFunction(() => document.getElementById('cameraGate').hidden && vid.videoWidth > 0, null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    const flow = await page.evaluate(() => ({ badge: document.getElementById('sflowStatusBadge').textContent, live: !!(typeof stream !== 'undefined' && stream) }));
    assert.ok(flow.live && !/toca CAM|sin cámara/i.test(flow.badge), 'FLOW arranca al dar permiso: ' + JSON.stringify(flow));
    step('FLOW: arranca al activar la cámara desde la puerta');
    await context.close();

    // ── 4 · STAGE sin cámara ──
    ({ page, errors, context } = await openFlip(browser, { sceneCamera: SCENE, boot: false }));
    await watchCamera(page, true);
    await page.locator('#btnSplashStage').click();
    await page.waitForSelector('#rigScreen');
    assert.ok(await asked(page) >= 1, 'STAGE pide la cámara al entrar, como siempre');
    await page.waitForTimeout(3200);
    const stage = { light: Math.round(await brightness(page, '#rigScreen')), note: await page.evaluate(() => (document.querySelector('.rig-note') || {}).textContent || '') };
    assert.ok(stage.light > 24, 'el monitor no se queda en negro: ' + stage.light);
    assert.ok(/Sin cámara: se ve un generador/.test(stage.note), 'y dice por qué: ' + stage.note);
    step('STAGE sin cámara: generador en el monitor, y lo dice', stage);

    // ── 5 · Ninguna pantalla se come la barra de arriba ──
    const tops = {};
    for (const [key, id] of [['ascii', 'asciiArea'], ['scrash', 'scrashArea'], ['fusion', 'fusionArea'], ['edit', 'editArea'], ['sono', 'sonoArea'], ['wmp', 'wmpArea'], ['sflow', 'sflowArea']]) {
      await openModule(page, key);
      await page.waitForTimeout(350);
      tops[key] = await page.evaluate(area => Math.round(document.getElementById(area).getBoundingClientRect().top - document.getElementById('shellTop').getBoundingClientRect().bottom), id);
      assert.ok(tops[key] >= 0, key + ': su pantalla empieza bajo la barra (' + tops[key] + ')');
    }
    assert.deepEqual(errors, [], 'sin errores');
    step('las pantallas empiezan bajo la barra de arriba', tops);
    await context.close();
    console.log('ENTRY PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
