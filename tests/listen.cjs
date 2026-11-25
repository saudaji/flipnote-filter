// Cámaras que escuchan: lo que tiene que seguir siendo verdad.
//   · apagada, la cámara pinta igual que siempre;
//   · encendida, el bajo mueve el mando de la cámara mientras se pinta el cuadro (el visor cambia)
//     y el mando vuelve a su valor: lo que el usuario dejó en AJUSTES ni cambia ni se guarda movido;
//   · la foto sale con la modulación (pasa por el mismo camino);
//   · una cámara sin mando que mover no rompe nada y lo dice;
//   · AL GOLPE: el disparador cierra el ojo y espera; la foto sale con el siguiente golpe, una por
//     toque, y si no llega ninguno sale sola a los 2,5 s;
//   · con el micrófono de verdad (el falso de Chrome pita cada segundo) el oído mide algo;
//   · se enciende desde el cajón «cámaras y filtros».
//   FLIP_URL=http://127.0.0.1:8760 node tests/listen.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
// Huella del visor: suma de diferencias entre vecinos (cuánto «bloque» tiene la imagen).
const print = page => page.evaluate(() => {
  const g = document.createElement('canvas'); g.width = 96; g.height = 72;
  const c = g.getContext('2d', { willReadFrequently: true }); c.imageSmoothingEnabled = false;
  c.drawImage(display, 0, 0, g.width, g.height);
  const d = c.getImageData(0, 0, g.width, g.height).data;
  let sum = 0, edges = 0;
  for (let i = 0; i < d.length; i += 4) { sum += d[i] + d[i + 1] + d[i + 2]; if (i >= 4 && Math.abs(d[i] - d[i - 4]) > 24) edges++; }
  return { sum, edges };
});

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForTimeout(900);
    await page.evaluate(() => { _setCamFamily('DSI'); document.getElementById('dsiTrama').value = 0; document.getElementById('dsiTrama').dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('dsiCelda').value = 1; document.getElementById('dsiCelda').dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(500);

    // ── Apagada: nada cambia ──
    const off = await page.evaluate(() => flipEscucha.state());
    assert.deepEqual([off.on, off.applied, document => 0].slice(0, 2), [false, null]);
    const quiet = await print(page);

    // ── Encendida: el bajo agranda la trama mientras pinta, y el mando vuelve ──
    await page.evaluate(() => { flipEscucha.inject({ bass: 1 }); return flipEscucha.set(true); });
    await page.waitForTimeout(600);
    const loud = await page.evaluate(() => ({ ...flipEscucha.state(), celda: dsiCeldaVal, perilla: document.getElementById('dsiCelda').value, guardado: JSON.parse(localStorage.getItem('flipSettings') || '{}').dsiCeldaVal, body: document.body.dataset.escucha }));
    assert.equal(loud.on, true);
    assert.equal(loud.body, 'si');
    assert.deepEqual(loud.applied, [4], 'con el bajo a tope la celda se pinta a 4');
    assert.equal(loud.celda, 1, 'y el mando vuelve a su valor al acabar el cuadro');
    assert.equal(String(loud.perilla), '1', 'la perilla de AJUSTES no se mueve');
    assert.ok(loud.guardado == null || loud.guardado === 1, 'no se guarda movido: ' + loud.guardado);
    const moved = await print(page);
    assert.ok(Math.abs(moved.edges - quiet.edges) > quiet.edges * 0.12, 'el visor cambia con el bajo: ' + JSON.stringify({ quiet, moved }));
    await page.evaluate(() => flipEscucha.inject({ bass: 0 }));
    await page.waitForTimeout(500);
    const back = await print(page);
    assert.ok(Math.abs(back.edges - quiet.edges) < quiet.edges * 0.08, 'sin bajo vuelve a verse como antes: ' + JSON.stringify({ quiet, back }));
    assert.deepEqual((await page.evaluate(() => flipEscucha.state())).applied, [1]);
    step('el bajo mueve la trama mientras pinta y el mando vuelve', { bordes: [quiet.edges, moved.edges, back.edges] });

    // ── La foto sale con la modulación ──
    await page.evaluate(() => flipEscucha.inject({ bass: 1 }));
    const before = (await page.evaluate(() => flipEscucha.state())).paths.capture || 0;
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => document.getElementById('deckGallery').classList.contains('has-shot'), null, { timeout: 8000 });
    const paths = (await page.evaluate(() => flipEscucha.state())).paths;
    assert.ok((paths.capture || 0) > before, 'la foto pasa por la escucha: ' + JSON.stringify(paths));
    assert.equal(await page.evaluate(() => dsiCeldaVal), 1);
    step('la foto se toma con el mando movido', { caminos: Object.keys(paths) });

    // ── Una cámara sin mando que mover ──
    await page.evaluate(() => { flipEscucha.inject({ bass: 1, mid: 1, high: 1 }); _setCamFamily('AUTO03'); });
    await page.waitForTimeout(500);
    const plain = await page.evaluate(() => flipEscucha.state());
    assert.deepEqual([plain.mueve, plain.applied], [false, null], 'AUTO 03 no tiene mando que mover');
    await page.evaluate(() => _setCamFamily('DLPHN'));
    await page.waitForTimeout(500);
    const dlp = await page.evaluate(() => ({ ...flipEscucha.state(), contraste: dlpContrastVal, resplandor: dlpResonanceVal }));
    assert.equal(dlp.applied.length, 2, 'DLPHN mueve dos mandos');
    assert.ok(dlp.applied[0] > dlp.contraste && dlp.applied[1] > dlp.resplandor, 'los dos suben mientras pinta: ' + JSON.stringify(dlp));
    step('cada cámara mueve lo suyo; la que no tiene mando no se rompe', { DLPHN: dlp.applied, base: [dlp.contraste, dlp.resplandor] });

    // ── AL GOLPE: el disparador espera el pulso ──
    await page.evaluate(() => { _setCamFamily('DSI'); flipEscucha.inject({ bass: 0 }); flipEscucha.golpe(true); window.__shots = 0; const real = window._downloadBlob; window._downloadBlob = function () { window.__shots++; return real.apply(this, arguments); }; });
    await page.waitForTimeout(300);
    await page.locator('#deckShutter').click();
    await page.locator('#deckShutter').click();           // un segundo toque mientras espera no suma otra foto
    await page.waitForTimeout(500);
    const waiting = await page.evaluate(() => ({ ...flipEscucha.state(), shots: window.__shots, espera: document.getElementById('deckShutter').classList.contains('espera'), ojo: +getComputedStyle(document.querySelector('#deckShutter .silueta .ojo')).opacity }));
    assert.deepEqual([waiting.armed, waiting.shots, waiting.espera, waiting.ojo], [true, 0, true, 0], 'espera con el ojo cerrado, sin foto todavía');
    await page.evaluate(() => flipEscucha.inject({ bass: 1, beat: 1 }));
    await page.waitForFunction(() => window.__shots === 1, null, { timeout: 4000 });
    await page.waitForTimeout(700);
    const fired = await page.evaluate(() => ({ ...flipEscucha.state(), shots: window.__shots, espera: document.getElementById('deckShutter').classList.contains('espera') }));
    assert.deepEqual([fired.armed, fired.shots, fired.espera], [false, 1, false], 'una sola foto, en el golpe');
    await page.evaluate(() => flipEscucha.inject({ bass: 0 }));
    const t0 = Date.now();
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => window.__shots === 2, null, { timeout: 6000 });
    const waited = Date.now() - t0;
    assert.ok(waited > 2000 && waited < 4500, 'sin golpe, sale sola a los 2,5 s: ' + waited + ' ms');
    await page.evaluate(() => flipEscucha.golpe(false));
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => window.__shots === 3, null, { timeout: 3000 });
    step('AL GOLPE: espera el pulso con el ojo cerrado; una foto por toque', { sinGolpe: waited + ' ms' });

    // ── Con el micrófono de verdad ──
    await page.evaluate(() => { flipEscucha.inject(null); return flipEscucha.set(false); });
    assert.equal(await page.evaluate(() => document.body.dataset.escucha), 'no');
    await page.locator('.si-abrir').click();
    await page.waitForTimeout(300);
    const row = await page.evaluate(() => ({ texto: document.querySelector('.si-escucha-dice').textContent, alto: Math.round(document.getElementById('escuchaOn').getBoundingClientRect().height), dentro: document.getElementById('escuchaGolpe').getBoundingClientRect().right <= innerWidth }));
    assert.ok(/micrófono/i.test(row.texto) && row.alto >= 44 && row.dentro, 'la fila ESCUCHA en el cajón: ' + JSON.stringify(row));
    await page.locator('#escuchaOn').click();
    await page.waitForFunction(() => flipEscucha.on && flipEscucha.state().mic, null, { timeout: 12000 });
    await page.waitForTimeout(3500);
    const real = await page.evaluate(() => ({ ...flipEscucha.state(), rotulo: (document.querySelector('.si-audio i') || {}).textContent, chip: document.getElementById('escuchaOn').classList.contains('is-on'), descansa: document.body.classList.contains('is-resting') }));
    assert.ok(real.mic && real.chip, 'la escucha abrió el micrófono');
    assert.equal(real.rotulo, 'Escucha', 'la barra lo dice');
    assert.ok(Math.max(real.peak.bass, real.peak.mid, real.peak.high) > 0.2, 'el oído mide el pitido del micrófono de prueba: ' + JSON.stringify(real.peak));
    await page.locator('#escuchaOn').click();
    await page.waitForFunction(() => !flipEscucha.on && !flipEscucha.state().mic, null, { timeout: 6000 });
    assert.deepEqual(errors, [], 'sin errores');
    step('con micrófono real el oído mide; se enciende y se apaga desde el cajón', { picos: Object.fromEntries(Object.entries(real.peak).map(([k, v]) => [k, +v.toFixed(2)])) });
    console.log('LISTEN PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
