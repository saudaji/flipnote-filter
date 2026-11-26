// VFD · REACCIÓN: una química viva dentro del fósforo (docs/reaccion.js). Lo que tiene que seguir
// siendo verdad:
//   · se elige como una variante más de VFD y la app lo dice;
//   · el fondo es negro y el coral crece donde hay luz, no en lo oscuro; invertida, al revés;
//   · está vivo: el cuadro cambia aunque la escena no, y la química avanza una vez por cuadro;
//   · tres paletas que se distinguen; la elección se recuerda;
//   · sus dos teclas (invertir, paleta) viven en la banda y solo aparecen con REACCIÓN puesta;
//   · el golpe la hace florecer cuando ESCUCHAR está encendido;
//   · la foto sale con el mismo aspecto y la química cuesta poco.
//   FLIP_URL=http://127.0.0.1:8760 node tests/reaccion.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, pickVariant } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
// Cuánto del cuadro está apagado y de qué color es lo encendido (verde/cian, cálido, rosa).
const census = page => page.evaluate(() => {
  const g = document.createElement('canvas'); g.width = 160; g.height = 120;
  const c = g.getContext('2d', { willReadFrequently: true });
  c.drawImage(display, 0, 0, g.width, g.height);
  const d = c.getImageData(0, 0, g.width, g.height).data, n = d.length / 4;
  let dark = 0, green = 0, warm = 0, pink = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    sum += r * 3 + gg * 5 + b;
    if (r + gg + b < 110) dark++;
    else if (gg > 150 && gg > r * 1.15) green++;
    else if (r > 180 && gg > 60 && b < gg * 0.8) warm++;
    else if (r > 180 && b > 140 && gg < r * 0.75) pink++;
  }
  return { dark: +(dark / n).toFixed(3), green: +(green / n).toFixed(3), warm: +(warm / n).toFixed(3), pink: +(pink / n).toFixed(3), sum };
});
// Cuánto coral hay en la parte clara de la escena y cuánto en la oscura, sin contar contornos.
const where = page => page.evaluate(() => flipReaccion.probe());

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForTimeout(700);
    await page.evaluate(() => { try { localStorage.removeItem('flip.reaccion'); } catch (_) {} flipReaccion.set({ invert: false, palette: 'fosforo' }); });
    assert.equal(await page.locator('.si-rapidas').isVisible(), false, 'sin REACCIÓN puesta no hay teclas suyas');
    await page.locator('#deckLooks [data-family="VFD"]').click();
    await pickVariant(page, 'REAC');
    await page.waitForFunction(() => camFamily === 'VFD' && camVariant === 'REAC');
    await page.waitForTimeout(3500);
    const label = await page.evaluate(() => ({ lcd: document.getElementById('lcdLook').textContent, banda: (document.querySelector('.si-variante b') || {}).textContent }));
    assert.match(label.lcd, /REACCIÓN/);
    const a = await census(page), st = await page.evaluate(() => flipReaccion.state());
    assert.ok(a.dark > .35, 'el fondo es negro: ' + JSON.stringify(a));
    assert.ok(a.green > .05 && a.green > a.warm * 3 && a.green > a.pink * 3, 'FÓSFORO: el coral es verde y cian: ' + JSON.stringify(a));
    assert.ok(st.alive > .08 && st.alive < .7, 'hay coral, pero no lo llena todo: ' + st.alive);
    assert.ok(st.ms < 12, 'la química cuesta poco: ' + st.ms + ' ms');
    step('REACCIÓN: coral de fósforo sobre negro', { ...a, vivo: st.alive, ms: st.ms });

    // Vivo: la escena no cambia y el cuadro sí. Y un paso de química por cuadro pintado, no dos.
    const f0 = await page.evaluate(() => ({ f: flipReaccion.state().frame, t: performance.now() }));
    await page.waitForTimeout(1500);
    const b = await census(page), f1 = await page.evaluate(() => ({ f: flipReaccion.state().frame, t: performance.now() }));
    assert.notEqual(a.sum, b.sum, 'el coral se mueve');
    const rate = (f1.f - f0.f) / ((f1.t - f0.t) / 1000);
    assert.ok(rate > 8 && rate < 40, 'un paso de química por cuadro: ' + rate.toFixed(1) + ' por segundo');
    step('está vivo', { porSegundo: +rate.toFixed(1) });

    // El coral vive en lo iluminado; invertida, en lo oscuro.
    const normal = await where(page);
    assert.ok(normal.claro > normal.oscuro + .1, 'crece donde hay luz: ' + JSON.stringify(normal));
    await page.evaluate(() => flipReaccion.set({ invert: true }));
    await page.waitForTimeout(4500);
    const inverted = await where(page);
    assert.ok(inverted.oscuro > inverted.claro + .1, 'invertida crece en lo oscuro: ' + JSON.stringify(inverted));
    await page.evaluate(() => flipReaccion.set({ invert: false }));
    step('normal e invertida', { normal, invertida: inverted });

    // Paletas.
    await page.evaluate(() => flipReaccion.set({ palette: 'brasa' }));
    await page.waitForTimeout(3500);
    const brasa = await census(page);
    assert.ok(brasa.warm > .05 && brasa.warm > brasa.green * 3, 'BRASA es cálida: ' + JSON.stringify(brasa));
    await page.evaluate(() => flipReaccion.set({ palette: 'orquidea' }));
    await page.waitForTimeout(600);
    const orquidea = await census(page);
    assert.ok(orquidea.pink > .04 && orquidea.pink > orquidea.warm, 'ORQUÍDEA es rosa: ' + JSON.stringify(orquidea));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('flip.reaccion'))), { invert: false, palette: 'orquidea' }, 'la elección se recuerda');
    step('tres paletas', { brasa: brasa.warm, orquidea: orquidea.pink });

    // Sus dos teclas, en la banda (a la vista de la imagen): invertir y paleta.
    assert.equal(await page.locator('.si-rapidas').isVisible(), true, 'con REACCIÓN puesta, sus teclas están en la banda');
    await page.evaluate(() => flipReaccion.set({ palette: 'fosforo', invert: false }));
    await page.locator('#reaccionPaleta').click();
    await page.locator('#reaccionInvertir').click();
    const keys = await page.evaluate(() => {
      const inv = document.getElementById('reaccionInvertir'), pal = document.getElementById('reaccionPaleta'), box = pal.getBoundingClientRect(), view = document.getElementById('display').getBoundingClientRect();
      return { ...flipReaccion.options(), pressed: inv.getAttribute('aria-pressed'), dice: pal.textContent.trim(), feel: [flipFeel.kindOf(inv), flipFeel.kindOf(pal)].join(','), cabe: box.right <= innerWidth && box.height >= 34, imagen: view.height > 200 };
    });
    assert.deepEqual(keys, { invert: true, palette: 'brasa', pressed: 'true', dice: 'BRASA', feel: 'switch,key', cabe: true, imagen: true });
    await page.locator('#reaccionPaleta').click();
    await page.locator('#reaccionPaleta').click();
    await page.locator('#reaccionInvertir').click();
    assert.deepEqual(await page.evaluate(() => flipReaccion.options()), { invert: false, palette: 'fosforo' }, 'la paleta da la vuelta a las tres');
    // Las seis variantes de VFD caben en el cajón: la fila se desliza y la elegida queda a la vista.
    await page.locator('.si-abrir').click();
    await page.waitForTimeout(350);
    const fila = await page.evaluate(() => { const on = document.querySelector('#deckVariants [data-variant].is-on').getBoundingClientRect(); return { izquierda: on.left >= 0, derecha: on.right <= innerWidth + 1, texto: document.querySelector('#deckVariants [data-variant].is-on').scrollWidth <= document.querySelector('#deckVariants [data-variant].is-on').clientWidth + 1 }; });
    assert.deepEqual(fila, { izquierda: true, derecha: true, texto: true }, 'la variante elegida se ve entera');
    await page.locator('.si-abrir').click();
    step('teclas en la banda', keys);

    // El golpe la hace florecer (solo con ESCUCHAR encendido).
    await page.evaluate(() => { flipEscucha.inject({ bass: 1, mid: .5, high: .5 }); return flipEscucha.set(true); });
    await page.waitForTimeout(500);
    await page.evaluate(() => flipEscucha.inject({ bass: 1, mid: .5, high: .5, beat: 1 }));
    await page.waitForFunction(() => flipReaccion.state().pulse > .05, null, { timeout: 3000 });
    const loud = await page.evaluate(() => flipReaccion.state());
    assert.equal(loud.steps, 10, 'el bajo acelera la reacción');
    await page.evaluate(() => { flipEscucha.inject(null); return flipEscucha.set(false); });
    await page.waitForTimeout(400);
    assert.equal((await page.evaluate(() => flipReaccion.state())).steps, 6, 'en silencio vuelve a su paso');
    step('con el sonido: el bajo la acelera y el golpe la enciende', { pasos: loud.steps });

    // La foto.
    await page.evaluate(() => { window.__shot = null; const real = window._downloadBlob; window._downloadBlob = function (blob) { window.__shot = blob; }; });
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => window.__shot, null, { timeout: 15000 });
    const photo = await page.evaluate(async () => {
      const bmp = await createImageBitmap(window.__shot), g = document.createElement('canvas'); g.width = 160; g.height = 120;
      const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(bmp, 0, 0, g.width, g.height);
      const d = c.getImageData(0, 0, g.width, g.height).data; let dark = 0, green = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] < 110) dark++; else if (d[i + 1] > 150 && d[i + 1] > d[i] * 1.15) green++; }
      return { w: bmp.width, h: bmp.height, dark: +(dark / (d.length / 4)).toFixed(3), green: +(green / (d.length / 4)).toFixed(3) };
    });
    assert.ok(photo.dark > .3 && photo.green > .04, 'la foto sale con el coral: ' + JSON.stringify(photo));
    step('la foto sale igual', photo);

    assert.deepEqual(errors, []);
    console.log('REACCION PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
