// VFD · NEÓN y VFD · POLVO: fósforo sobre negro. Lo que tiene que seguir siendo verdad:
//   · se elige como una variante más de VFD y la app lo dice;
//   · el fondo es negro: la mayor parte del cuadro queda apagada;
//   · lo iluminado se enciende en cálidos (naranja a lima) y los contornos en violeta, con halo;
//   · se mueve (las líneas reptan) y la foto sale con el mismo aspecto.
//   FLIP_URL=http://127.0.0.1:8760 node tests/neon.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, pickVariant } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const census = page => page.evaluate(() => {
  const g = document.createElement('canvas'); g.width = 160; g.height = 120;
  const c = g.getContext('2d', { willReadFrequently: true });
  c.drawImage(display, 0, 0, g.width, g.height);
  const d = c.getImageData(0, 0, g.width, g.height).data, n = d.length / 4;
  let dark = 0, warm = 0, violet = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    sum += r * 3 + gg * 5 + b;
    if (r + gg + b < 60) dark++;
    else if (r > 170 && gg > 90 && b < gg) warm++;
    else if (b > 150 && b > gg * 1.3) violet++;
  }
  return { dark: +(dark / n).toFixed(3), warm: +(warm / n).toFixed(3), violet: +(violet / n).toFixed(3), sum };
});

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForTimeout(700);
    await page.locator('#deckLooks [data-family="VFD"]').click();
    await pickVariant(page, 'NEON');
    await page.waitForFunction(() => camFamily === 'VFD' && camVariant === 'NEON');
    await page.waitForTimeout(1500);
    const label = await page.evaluate(() => ({ lcd: document.getElementById('lcdLook').textContent, banda: (document.querySelector('.si-variante b') || {}).textContent }));
    assert.match(label.lcd, /NEÓN/);
    const a = await census(page);
    assert.ok(a.dark > .45, 'el fondo es negro: ' + JSON.stringify(a));
    assert.ok(a.warm > .02, 'lo iluminado se enciende en cálidos: ' + JSON.stringify(a));
    assert.ok(a.violet > .01, 'contornos y halo en violeta: ' + JSON.stringify(a));
    step('NEÓN: fósforo sobre negro', a);
    await page.waitForTimeout(450);
    const b = await census(page);
    assert.notEqual(a.sum, b.sum, 'las líneas reptan: el cuadro cambia aunque la escena no');
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => document.getElementById('deckGallery').classList.contains('has-shot'), null, { timeout: 8000 });
    step('se mueve y toma la foto');

    // ── VFD · POLVO: polvo de fósforo sobre negro, sin halo ──
    await pickVariant(page, 'DUST');
    await page.waitForFunction(() => camVariant === 'DUST');
    await page.waitForTimeout(1200);
    assert.match(await page.evaluate(() => document.getElementById('lcdLook').textContent), /POLVO/);
    const dust = await page.evaluate(() => {
      const g = document.createElement('canvas'); g.width = display.width; g.height = display.height;
      const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, 0);
      const d = c.getImageData(0, 0, g.width, g.height).data, n = d.length / 4;
      let dark = 0, blue = 0, orange = 0, thread = 0, soft = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gg = d[i + 1], b = d[i + 2], sum = r + gg + b;
        if (sum < 24) dark++;
        else if (b > 180 && r < 110 && gg < 140) blue++;
        else if (r > 220 && gg > 110 && gg < 215 && b < 120) orange++;
        else if (r > 200 && gg > 170 && b > 180) thread++;
        else if (sum < 70) soft++;                       // un halo dejaría penumbra alrededor de cada punto
      }
      return { dark: +(dark / n).toFixed(3), blue: +(blue / n).toFixed(4), orange: +(orange / n).toFixed(4), thread: +(thread / n).toFixed(4), soft: +(soft / n).toFixed(4) };
    });
    assert.ok(dust.dark > .6, 'casi todo es negro: ' + JSON.stringify(dust));
    assert.ok(dust.blue > .003 && dust.orange > .01 && dust.thread > .003, 'polvo azul, luces naranjas y bordes en hilo claro: ' + JSON.stringify(dust));
    assert.ok(dust.soft < .01, 'sin halo: los puntos son nítidos: ' + JSON.stringify(dust));
    assert.deepEqual(errors, [], 'sin errores');
    step('POLVO: polvo de fósforo sobre negro', dust);
    console.log('NEON PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
