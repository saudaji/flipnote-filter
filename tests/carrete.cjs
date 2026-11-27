// El carrete de FLIP: en un teléfono, disparar no lanza una descarga ni una hoja de compartir por
// toma. La toma cae en el carrete (docs/carrete.js), la tecla TOMA lo abre y un toque las saca juntas.
//
//   FLIP_URL=http://127.0.0.1:8760 node tests/carrete.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, ENGINE } = require('./lib/harness.cjs');
const IOS = ENGINE === 'webkit';        // (con el motor de Safari las pruebas se hacen pasar por un iPhone)

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { carrete: true, sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForFunction(() => typeof flipCarrete !== 'undefined' && typeof renderCameraPhoto === 'function' && vid.videoWidth > 0);
    await page.waitForTimeout(500);
    const downloads = [];
    page.on('download', d => { downloads.push(d.suggestedFilename()); d.cancel().catch(() => {}); });

    // 1 · de fábrica en un teléfono: CARRETE; tres disparos, ninguna descarga, tres tomas guardadas
    const start = await page.evaluate(async () => ({ modo: flipAudioSettings.saveMode, opciones: [...document.querySelectorAll('[data-save-mode]')].map(b => b.textContent.trim()), antes: await flipCarrete.stats() }));
    assert.equal(start.modo, 'roll', 'en un teléfono, lo de fábrica es guardar en el carrete');
    assert.deepEqual(start.opciones, ['CARRETE', 'ARCHIVOS', 'COMPARTIR'], 'y se puede elegir en ajustes');
    for (let i = 0; i < 3; i++) { await page.locator('#deckShutter').click(); await page.waitForFunction(n => document.getElementById('deckGallery').dataset.pendientes === String(n), i + 1, { timeout: 15000 }); await page.waitForTimeout(1100); }
    const shot = await page.evaluate(async () => ({ stats: await flipCarrete.stats(), list: await flipCarrete.list(), tecla: { pendientes: document.getElementById('deckGallery').dataset.pendientes, toma: document.getElementById('deckGallery').classList.contains('has-shot') } }));
    assert.deepEqual([downloads.length, shot.stats.count, shot.stats.pending, shot.tecla.pendientes, shot.tecla.toma], [0, 3, 3, '3', true], 'tres disparos: ninguna descarga, tres tomas en el carrete, y la tecla TOMA lo dice');
    assert.ok(shot.list.every(c => c.size > 5000 && /^data:image\/jpeg/.test(c.thumb) && /^flip_cam_.*\.jpg$/.test(c.filename)) && shot.list[0].id > shot.list[2].id, 'cada una con su archivo, su nombre y su miniatura, la más nueva primero');
    console.log('✓ disparar no lanza descargas: las tomas caen en el carrete · ' + JSON.stringify(shot.stats));

    // 2 · siguen ahí al recargar (el carrete vive en el almacén del navegador)
    await page.reload();
    await page.waitForFunction(() => typeof flipCarrete !== 'undefined' && document.getElementById('deckGallery').dataset.pendientes === '3', null, { timeout: 20000 });
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    console.log('✓ el carrete sobrevive a recargar la página');

    // 3 · el carrete se abre con la tecla TOMA: tira de tomas, se elige una, se borra con dos toques
    // (la hoja de compartir del sistema, de mentira: anota lo que recibe)
    await page.evaluate(() => { window.__shared = []; navigator.canShare = data => !!(data && data.files && data.files.length); navigator.share = async data => { window.__shared.push(data.files.map(f => f.name + ' ' + f.type)); }; });
    await page.locator('#deckGallery').click();
    await page.waitForFunction(() => document.querySelectorAll('#viewerRoll [data-toma]').length === 3 && document.querySelector('#viewerStage img'));
    const open = await page.evaluate(() => ({ titulo: document.getElementById('viewerTitle').textContent, todo: document.getElementById('viewerAll').textContent, fila: !document.getElementById('viewerAllRow').hidden, meta: document.getElementById('viewerMeta').textContent, cabe: document.getElementById('viewerAll').getBoundingClientRect().right <= innerWidth + 1 }));
    assert.deepEqual([open.titulo, open.todo, open.fila, open.cabe], ['CARRETE · 3 SIN GUARDAR', IOS ? 'Guardar las 3 en Fotos' : 'Bajar las 3 a Descargas', true, true], 'el carrete dice cuántas faltan y ofrece sacarlas todas: ' + JSON.stringify(open));
    assert.match(open.meta, /en el carrete de FLIP, sin guardar fuera/);
    await page.locator('#viewerRoll [data-toma]').nth(2).click();
    await page.waitForFunction(() => document.querySelectorAll('#viewerRoll [aria-selected="true"]').length === 1 && document.querySelector('#viewerRoll [data-toma]:nth-child(3)').getAttribute('aria-selected') === 'true');
    await page.locator('#viewerDelete').click();
    assert.match(await page.locator('#viewerDelete').textContent(), /Toca otra vez/, 'borrar pide un segundo toque');
    assert.equal(await page.evaluate(async () => (await flipCarrete.stats()).count), 3, 'con un toque no se borra nada');
    await page.locator('#viewerDelete').click();
    await page.waitForFunction(() => document.querySelectorAll('#viewerRoll [data-toma]').length === 2);
    console.log('✓ la tecla TOMA abre el carrete; borrar pide dos toques');

    // 4 · sacarlas todas de una vez. En Android y en computadora: descargas seguidas. En iPhone: UNA
    //     hoja de compartir con todas (ahí está «Guardar imágenes», que las lleva a Fotos).
    await page.waitForTimeout(600);                                 // (las pendientes se leen al abrir, para compartir en el mismo toque)
    await page.locator('#viewerAll').click();
    await page.waitForFunction(() => document.getElementById('viewerTitle').textContent === 'CARRETE · TODO GUARDADO', null, { timeout: 15000 });
    const out = await page.evaluate(async () => ({ stats: await flipCarrete.stats(), fila: document.getElementById('viewerAllRow').hidden, tecla: document.getElementById('deckGallery').dataset.pendientes || '', shared: window.__shared }));
    assert.deepEqual([out.stats.count, out.stats.pending, out.fila, out.tecla], [2, 0, true, ''], 'un toque saca las dos que quedaban, y el carrete las da por guardadas (siguen ahí para verlas): ' + JSON.stringify(out));
    if (IOS) assert.ok(downloads.length === 0 && out.shared.length === 1 && out.shared[0].length === 2 && out.shared[0].every(f => /\.jpg image\/jpeg$/.test(f)), 'en iPhone: una sola hoja de compartir con las dos fotos, y ninguna descarga: ' + JSON.stringify([downloads, out.shared]));
    else assert.ok(downloads.length === 2 && out.shared.length === 0, 'en Android: dos descargas y ninguna hoja de compartir: ' + JSON.stringify([downloads, out.shared]));
    console.log('✓ un toque saca todas las pendientes · ' + JSON.stringify(IOS ? out.shared : downloads));

    // 5 · dos tomas más
    await page.locator('#viewerClose').click();
    const more = await page.evaluate(async () => { for (let i = 0; i < 2; i++) { const blob = await renderCameraPhoto(); await saveBlob(blob, 'flip_cam_prueba_' + i + '.jpg'); } return document.getElementById('deckGallery').dataset.pendientes; });
    assert.equal(more, '2');
    console.log('✓ dos tomas más en el carrete');

    // 6 · lleno de tomas sin guardar: la siguiente no se pierde, se baja como antes
    const full = await page.evaluate(async () => {
      const real = flipCarrete.add; flipCarrete.add = async () => { throw new Error('lleno'); };
      const before = (await flipCarrete.stats()).count, blob = await renderCameraPhoto();
      await saveBlob(blob, 'flip_cam_llena.jpg');
      flipCarrete.add = real;
      return { before, after: (await flipCarrete.stats()).count };
    });
    await page.waitForTimeout(500);
    assert.ok(full.before === full.after && downloads.includes('flip_cam_llena.jpg'), 'con el carrete lleno la toma se baja aparte: ' + JSON.stringify([full, downloads]));
    console.log('✓ con el carrete lleno, la toma no se pierde: se baja aparte');

    // 7 · con ARCHIVOS, todo como antes: una descarga por toma
    const n = downloads.length;
    await page.evaluate(() => { flipAudioSettings.saveMode = 'files'; saveFlipAudioSettings(); });
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => true); await page.waitForTimeout(1800);
    assert.equal(downloads.length, n + 1, 'con GUARDAR EN · ARCHIVOS, cada toma se baja: ' + downloads.slice(n));
    assert.equal(await page.evaluate(async () => (await flipCarrete.stats()).count), full.after, 'y no entra al carrete');
    console.log('✓ con ARCHIVOS todo sigue como antes');
    assert.deepEqual(errors, []);
    console.log('PASS · carrete');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
