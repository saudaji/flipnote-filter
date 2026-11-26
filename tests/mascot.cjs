// La mascota (la camarita del disparador, piel INTERFAZ) reacciona a lo que hace quien usa FLIP.
// Nunca se mueve sola. Lo que tiene que seguir siendo verdad:
//   · mira hacia donde se inclina el teléfono y hacia el lado al que se pasa la tira de cámaras;
//   · tras el disparo mantiene el ojo cerrado hasta que la toma aparece en TOMA;
//   · duerme (ojo cerrado) mientras la cámara descansa;
//   · entrecierra el ojo con poca luz y lo abre de más con mucha; la escena lo decide;
//   · agitar el teléfono la marea (y el sensor reconoce una sacudida, no un giro cualquiera);
//   · dos toques en la placa: doble guiño;
//   · sale del disparador: su cara en los avisos del visor y, dormida, en la tecla TOMA vacía.
//   FLIP_URL=http://127.0.0.1:8760 node tests/mascot.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const eye = page => page.evaluate(() => {
  const sh = document.getElementById('deckShutter'), ojo = getComputedStyle(sh.querySelector('.ojo')), pup = getComputedStyle(sh.querySelector('.pupila')), mira = getComputedStyle(sh.querySelector('.mira'));
  const m = t => (t === 'none' ? [1, 0, 0, 1, 0, 0] : t.slice(7, -1).split(',').map(Number));
  return { abierto: +ojo.opacity, ojoY: +m(ojo.transform)[3].toFixed(2), ojoX: +m(ojo.transform)[0].toFixed(2), pupX: +m(pup.transform)[4].toFixed(2), pupEscala: +m(pup.transform)[0].toFixed(2), giro: +(Math.atan2(m(mira.transform)[1], m(mira.transform)[0]) * 180 / Math.PI).toFixed(1), clases: sh.className.replace(/\s+/g, ' ').trim() };
});

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => document.body.dataset.piel), 'interfaz');

    // Fuera del disparador: dormida en la tecla TOMA vacía, y su cara en los avisos.
    const fuera = await page.evaluate(() => {
      const b = document.querySelector('#deckGallery b'), after = getComputedStyle(b, '::after'), hint = getComputedStyle(document.getElementById('osdHint'), '::before');
      return { toma: /data:image\/svg/.test(after.maskImage || after.webkitMaskImage || ''), ancho: parseFloat(after.width), icono: getComputedStyle(b.querySelector('svg')).display, aviso: /data:image\/svg/.test(hint.backgroundImage), avisoAncho: parseFloat(hint.width) };
    });
    assert.deepEqual(fuera, { toma: true, ancho: 23, icono: 'none', aviso: true, avisoAncho: 17 });
    step('fuera del disparador: en la tecla TOMA vacía y en los avisos', fuera);

    // Inclinación: la pupila gira con --lt.
    await page.evaluate(() => document.getElementById('deckShutter').style.setProperty('--lt', '20deg'));
    await page.waitForTimeout(250);
    let e = await eye(page);
    assert.ok(Math.abs(e.giro - 20) < 0.6, 'la mirada sigue la inclinación: ' + JSON.stringify(e));
    await page.evaluate(() => document.getElementById('deckShutter').style.setProperty('--lt', '0deg'));

    // El carrete: mira hacia el lado al que se pasa la tira, y vuelve al centro al parar.
    const box = await page.locator('#deckLooks').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const pasar = async dx => { let best = 0; for (let i = 0; i < 5; i++) { await page.mouse.wheel(dx, 0); await page.waitForTimeout(45); const x = (await eye(page)).pupX; if (Math.abs(x) > Math.abs(best)) best = x; } return best; };
    const derecha = { pupX: await pasar(110) };
    await page.waitForTimeout(900);
    const centro = await eye(page);
    const izquierda = { pupX: await pasar(-110) };
    assert.ok(derecha.pupX > 1 && izquierda.pupX < -1 && Math.abs(centro.pupX) < 0.1, 'mira al lado del carrete: ' + JSON.stringify([derecha.pupX, centro.pupX, izquierda.pupX]));
    await page.waitForTimeout(600);
    step('mira hacia donde se inclina y hacia donde se pasa el carrete', { derecha: derecha.pupX, izquierda: izquierda.pupX });

    // Guardar: ojo cerrado desde el disparo hasta que la toma está en TOMA.
    await page.evaluate(() => { window.__saved = 0; const real = window._downloadBlob; window._downloadBlob = function () { window.__saved++; }; });
    await page.locator('#deckShutter').click();
    await page.waitForTimeout(30);
    const guardando = await eye(page);
    assert.ok(/guarda/.test(guardando.clases), 'cierra el ojo al disparar: ' + guardando.clases);
    await page.waitForFunction(() => document.getElementById('deckGallery').classList.contains('has-shot'), null, { timeout: 15000 });
    await page.waitForTimeout(700);
    const lista = await eye(page);
    assert.ok(!/guarda|guino/.test(lista.clases) && lista.abierto === 1, 'y lo abre con la toma guardada: ' + JSON.stringify(lista));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#deckGallery b'), '::after').content), 'none', 'con una toma, la tecla TOMA enseña la toma');
    step('cierra el ojo mientras guarda');

    // La luz de la escena: la decide la cámara; el ojo responde.
    const luces = {};
    for (const luz of ['poca', 'mucha', '']) {
      await page.evaluate(v => { window.__luzForzada = true; if (v) document.body.dataset.luz = v; else delete document.body.dataset.luz; }, luz);
      await page.waitForTimeout(40);
      // (la escena de prueba vuelve a decidir cada 32 cuadros: se lee enseguida)
      await page.evaluate(v => { if (v) document.body.dataset.luz = v; else delete document.body.dataset.luz; }, luz);
      await page.waitForTimeout(220);
      luces[luz || 'normal'] = await eye(page);
    }
    assert.ok(luces.poca.ojoY < 0.75 && luces.poca.pupEscala > 1.1, 'con poca luz entrecierra y abre la pupila: ' + JSON.stringify(luces.poca));
    assert.ok(luces.mucha.ojoX > 1.05 && luces.mucha.pupEscala < 0.9, 'con mucha luz abre el ojo y cierra la pupila: ' + JSON.stringify(luces.mucha));
    // …y la medida sale de la escena: negro → poca; blanco → mucha.
    const medida = await page.evaluate(() => {
      const w = 256, h = 192, out = {};
      for (const [name, v] of [['negro', 6], ['blanco', 245], ['medio', 120]]) {
        const src = new Uint8ClampedArray(w * h * 4).fill(v);
        delete document.body.dataset.luz;
        for (let i = 0; i < 40; i++) _fillCamLumBuf(src, w, h);
        out[name] = document.body.dataset.luz || '';
      }
      return out;
    });
    assert.deepEqual(medida, { negro: 'poca', blanco: 'mucha', medio: '' });
    step('la luz de la escena: entrecierra con poca, abre con mucha', { poca: luces.poca.ojoY, mucha: luces.mucha.ojoX, medida });

    // Dormida mientras la cámara descansa.
    await page.evaluate(() => document.body.classList.add('is-resting'));
    await page.waitForTimeout(250);
    const dormida = await eye(page);
    await page.evaluate(() => document.body.classList.remove('is-resting'));
    await page.waitForTimeout(300);
    const despierta = await eye(page);
    assert.deepEqual([dormida.abierto, despierta.abierto], [0, 1], 'duerme en reposo y despierta');
    step('duerme mientras la cámara descansa');

    // Sacudida: tres bandazos alternos la marean; un giro lento, no.
    const orient = (page, list, gap) => page.evaluate(async ({ list, gap }) => { for (const [beta, gamma] of list) { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta, gamma })); await new Promise(r => setTimeout(r, gap)); } }, { list, gap });
    const antes = await page.evaluate(() => flipLight.state().shakes);
    await orient(page, [[40, 0], [41, 4], [42, 8], [43, 12], [44, 16], [45, 20], [46, 24]], 70);
    assert.equal(await page.evaluate(() => flipLight.state().shakes), antes, 'un giro lento no es una sacudida');
    await orient(page, [[40, 0], [40, 26], [40, -4], [40, 24], [40, -2], [40, 22]], 70);
    const sacudida = await page.evaluate(() => ({ shakes: flipLight.state().shakes, mareo: document.getElementById('deckShutter').classList.contains('mareo'), anim: getComputedStyle(document.querySelector('#deckShutter .pupila')).animationName }));
    assert.deepEqual(sacudida, { shakes: antes + 1, mareo: true, anim: 'si-mareo' });
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => document.getElementById('deckShutter').classList.contains('mareo')), false, 'se le pasa');
    step('agitar el teléfono la marea', sacudida);

    // Doble guiño en la placa.
    const placa = await page.locator('.si-placa').boundingBox();
    await page.evaluate(() => { window.__g = []; new MutationObserver(() => window.__g.push(document.getElementById('deckShutter').classList.contains('guino'))).observe(document.getElementById('deckShutter'), { attributes: true, attributeFilter: ['class'] }); });
    await page.mouse.click(placa.x + placa.width / 2, placa.y + placa.height / 2);
    await page.waitForTimeout(90);
    await page.mouse.click(placa.x + placa.width / 2, placa.y + placa.height / 2);
    await page.waitForTimeout(500);
    const guinos = await page.evaluate(() => window.__g.filter((v, i, a) => v && !a[i - 1]).length);
    assert.equal(guinos, 2, 'dos toques en la placa, dos guiños');
    step('doble guiño en la placa');

    assert.deepEqual(errors, []);
    console.log('MASCOT PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
