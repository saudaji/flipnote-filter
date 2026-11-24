// La cámara descansa cuando nadie la mira (docs/rest.js). Tener la cámara abierta es, con mucho,
// lo que más calienta el teléfono; aquí se comprueba que se suelta cuando toca y solo entonces:
//   · con el visor de la última toma abierto: cámara suelta y bucles en espera, sin aviso de
//     «cámara apagada»; al cerrar vuelve la imagen. Un vistazo rápido no la toca;
//   · con el lanzador abierto un rato: igual; al elegir un módulo con cámara vuelve, y al elegir
//     uno sin cámara (SONO) no se enciende;
//   · reposo: quieto y sin toques → avisa en la pantallita, apaga la cámara y lo dice; el toque
//     que despierta no pulsa lo que hay debajo; también despierta al mover el teléfono;
//   · no hay reposo si el teléfono se mueve, si se graba, en STAGE, con PORTAL ni sin sensor;
//   · en reposo, ir a otra app y volver no enciende la cámara.
//   FLIP_URL=http://127.0.0.1:8760 node tests/rest.cjs [--shots carpeta]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip } = require('./lib/harness.cjs');

const at = process.argv.indexOf('--shots');
const shots = at >= 0 ? path.resolve(process.argv[at + 1]) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      flipRest.config({ idle: 2500, warn: 1300, tick: 250, delays: { viewer: 400, launcher: 600 } });
      // Cuadros que dibuja el motor de CAM.
      window.__draws = 0;
      const real = _renderCamEngineFrame;
      _renderCamEngineFrame = function () { window.__draws++; return real.apply(this, arguments); };
      // El teléfono «quieto» o «en la mano»: eventos de orientación que la página se manda sola.
      window.__pose = null;
      setInterval(() => { if (window.__pose) window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: window.__pose(), gamma: 0 })); }, 100);
    });
    const state = () => page.evaluate(() => ({ ...flipRest.state(), stream: !!stream, video: vid.videoWidth, live: window.__flipSceneCameraState.live, opens: window.__flipSceneCameraState.opens, parkedFlag: cameraParked,
      gate: !document.getElementById('cameraGate').hidden, tab: activeTab, resting: document.body.classList.contains('is-resting'), veil: !document.getElementById('restVeil') ? false : !document.getElementById('restVeil').hidden }));
    const drawsIn = async ms => { const a = await page.evaluate(() => window.__draws); await page.waitForTimeout(ms); return (await page.evaluate(() => window.__draws)) - a; };
    const cameraBack = () => page.waitForFunction(() => !!stream && vid.videoWidth > 0 && !flipRest.state().paused, null, { timeout: 8000 });
    const pose = kind => page.evaluate(k => { window.__pose = k === 'quieto' ? () => 50 : k === 'mano' ? () => 50 + 6 * Math.sin(performance.now() / 350) : k === 'levantar' ? () => 62 : null; }, kind);

    // ── 1 · Visor de la última toma ──
    const [photo] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('#deckShutter').click()]);
    await photo.path();
    await page.waitForTimeout(500);
    let before = await state();
    // Un vistazo rápido no suelta la cámara.
    await page.locator('#deckGallery').click();
    await page.waitForTimeout(150);
    await page.locator('#viewerClose').click();
    await page.waitForTimeout(700);
    let now = await state();
    assert.equal(now.opens, before.opens, 'un vistazo rápido al visor no reabre la cámara');
    assert.ok(now.stream && !now.paused);
    // Mirándola un rato, sí.
    await page.locator('#deckGallery').click();
    await page.waitForFunction(() => flipRest.state().paused, null, { timeout: 4000 });
    now = await state();
    assert.deepEqual([now.stream, now.live, now.parked, now.parkedFlag, now.gate], [false, 0, true, true, false], 'visor abierto: cámara suelta, sin aviso de cámara apagada ' + JSON.stringify(now));
    assert.equal(await drawsIn(700), 0, 'y los bucles de dibujo esperan');
    if (shots) await page.screenshot({ path: path.join(shots, 'visor.png') });
    await page.locator('#viewerClose').click();
    await cameraBack();
    assert.ok(await drawsIn(900) > 2, 'al cerrar el visor vuelve la imagen');
    now = await state();
    assert.equal(now.parkedFlag, false);
    assert.equal(now.opens, before.opens + 1, 'la cámara se abrió una sola vez más');
    step('visor: la cámara descansa mientras se mira la toma', { aperturas: now.opens });

    // ── 2 · Lanzador ──
    await page.locator('#shellModule').click();
    await page.waitForFunction(() => flipRest.state().paused, null, { timeout: 4000 });
    assert.equal((await state()).stream, false, 'lanzador abierto un rato: cámara suelta');
    await page.locator('#shellLauncher [data-module="scrash"]').click();
    await cameraBack();
    now = await state();
    assert.deepEqual([now.tab, now.stream, now.paused], ['scrash', true, false], 'al elegir GLITCH la cámara vuelve');
    await page.waitForFunction(() => { const c = document.getElementById('scrashCanvas'), x = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return x[0] + x[1] + x[2] > 0; }, null, { timeout: 6000 });
    await page.locator('#shellModule').click();
    await page.waitForFunction(() => flipRest.state().paused, null, { timeout: 4000 });
    const opensBeforeSono = (await state()).opens;
    await page.locator('#shellLauncher [data-module="sono"]').click();
    await page.waitForTimeout(900);
    now = await state();
    assert.deepEqual([now.tab, now.stream, now.paused, now.opens], ['sono', false, false, opensBeforeSono], 'al elegir SONO, que no usa cámara, no se enciende');
    // De vuelta a CAM sin esperar en el lanzador.
    await page.locator('#shellModule').click();
    await page.locator('#shellLauncher [data-module="cam"]').click();
    await page.waitForFunction(() => activeTab === 'cam' && !!stream && vid.videoWidth > 0, null, { timeout: 8000 });
    step('lanzador: descansa si se queda abierto, y cada módulo recupera lo suyo', { aperturas: (await state()).opens });

    // ── 3 · Sin sensor de orientación no hay reposo ──
    await page.waitForTimeout(3200);
    now = await state();
    assert.deepEqual([now.motion, now.rests, now.resting], [false, 0, false], 'sin sensor no se puede saber si está en la mano: no reposa');

    // ── 4 · Reposo: quieto y sin toques ──
    await pose('quieto');
    await page.waitForFunction(() => /REPOSO EN/.test(document.getElementById('lcdParam').textContent) && document.getElementById('shellLcd').classList.contains('is-readout'), null, { timeout: 5000 });
    const warning = await page.evaluate(() => document.getElementById('lcdParam').textContent + ' ' + document.getElementById('lcdValue').textContent);
    await page.waitForFunction(() => document.body.classList.contains('is-resting'), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    now = await state();
    assert.deepEqual([now.resting, now.veil, now.stream, now.live, now.paused, now.gate], [true, true, false, 0, true, false], 'en reposo: cámara apagada y dicho en pantalla ' + JSON.stringify(now));
    assert.equal(await drawsIn(600), 0, 'en reposo no se dibuja');
    const note = await page.evaluate(() => document.querySelector('#restVeil .rest-note').innerText.replace(/\s+/g, ' ').trim());
    assert.match(note, /EN REPOSO/i);
    if (shots) await page.screenshot({ path: path.join(shots, 'reposo.png') });
    // Ir a otra app y volver no enciende la cámara.
    for (const hidden of [true, false]) {
      await page.evaluate(value => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
      await page.waitForTimeout(400);
    }
    now = await state();
    assert.deepEqual([now.resting, now.stream], [true, false], 'al volver de otra app sigue en reposo');
    // El toque que despierta cae sobre el disparador: no debe disparar.
    const shutter = await page.locator('#deckShutter').boundingBox();
    const fired = [];
    const onDownload = d => fired.push(d);
    page.on('download', onDownload);
    await page.mouse.click(shutter.x + shutter.width / 2, shutter.y + shutter.height / 2);
    await cameraBack();
    await page.waitForFunction(() => !document.body.classList.contains('is-waking'), null, { timeout: 6000 });
    await page.waitForTimeout(900);
    page.off('download', onDownload);
    now = await state();
    assert.equal(fired.length, 0, 'el toque que despierta no dispara la cámara');
    assert.deepEqual([now.resting, now.veil, now.stream, now.wakes], [false, false, true, 1], 'despierta al tocar ' + JSON.stringify(now));
    assert.ok(await drawsIn(900) > 2, 'y vuelve la imagen');
    // Despierto, el disparador funciona al primer toque.
    await pose(null);
    const [again] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('#deckShutter').click()]);
    await again.path();
    step('reposo: avisa, apaga la cámara y despierta con un toque que no pulsa nada', { aviso: warning, nota: note });

    // ── 5 · Despierta al mover el teléfono ──
    await pose('quieto');
    await page.waitForFunction(() => document.body.classList.contains('is-resting'), null, { timeout: 8000 });
    await pose('levantar');
    await cameraBack();
    now = await state();
    assert.deepEqual([now.resting, now.wakes], [false, 2], 'levantar el teléfono lo despierta');
    step('reposo: despierta al levantar el teléfono');

    // ── 6 · Cuándo no ──
    const restsSoFar = now.rests;
    await pose('mano');                                    // en la mano: se mueve
    await page.waitForTimeout(3600);
    assert.equal((await state()).rests, restsSoFar, 'con el teléfono en la mano no hay reposo');
    await pose('quieto');                                  // grabando
    await page.locator('#deckModeSwitch').click();
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => recorder && recorder.state === 'recording', null, { timeout: 15000 });
    await page.waitForTimeout(3600);
    now = await state();
    assert.deepEqual([now.rests, now.recording, now.stream], [restsSoFar, true, true], 'grabando no hay reposo');
    const [clip] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.locator('#deckShutter').click()]);
    await clip.path();
    await page.waitForFunction(() => !recorder);
    await page.locator('#deckModeSwitch').click();
    await page.evaluate(() => document.body.classList.add('portal-mode'));      // PORTAL se maneja sin tocar
    await page.waitForTimeout(3400);
    assert.equal((await state()).rests, restsSoFar, 'con PORTAL no hay reposo');
    await page.evaluate(() => document.body.classList.remove('portal-mode'));
    await page.locator('#shellModule').click();                                 // STAGE
    await page.locator('#shellLauncher [data-module="stage"]').click();
    await page.waitForFunction(() => flipStage.status().active && flipStage.status().fps > 0, null, { timeout: 15000 });
    await page.waitForTimeout(3600);
    now = await state();
    assert.deepEqual([now.rests, now.paused], [restsSoFar, false], 'en STAGE no hay reposo');
    // Ni se para con el lanzador abierto: lo que sale por la otra pantalla sigue.
    await page.locator('#shellModule').click();
    await page.waitForTimeout(1300);
    now = await state();
    assert.deepEqual([now.paused, now.stream], [false, true], 'en STAGE el lanzador no para nada');
    await page.locator('#launcherClose').click();
    step('sin reposo en la mano, grabando, con PORTAL ni en STAGE');

    assert.deepEqual(errors, [], 'sin errores de página');
    console.log('REST PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error('REST FAIL\n', error); process.exit(1); });
