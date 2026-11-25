// El grano mate: va sobre el aparato, nunca sobre la imagen.
//   · cada superficie (barra de arriba, pupitre, marco del visor, portada, lanzador) lleva su capa;
//   · el visor de la cámara y el lienzo de cada módulo quedan limpios, en los diez módulos;
//   · no queda carcasa sin grano entre piezas ni grano fuera de la carcasa; lo lustroso y el
//     cristal llevan el suyo, leve;
//   · es una opción: la tecla GRANO del lanzador lo quita y lo pone, y se recuerda;
//   · en la página de entrada, la película y las muestras quedan limpias y el resto lleva grano.
// Para verlo sin depender de lo que pinte la cámara, la prueba tiñe el grano de magenta puro y
// cuenta píxeles magenta en cada zona.
//   FLIP_URL=http://127.0.0.1:8760 node tests/grain.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, openModule } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const BASE = (process.env.FLIP_URL || 'http://127.0.0.1:8760').replace(/\/$/, '');
const DYE = '.grano { background: #f0f !important; opacity: 1 !important; }';

// Fracción de píxeles magenta en un recorte de la pantalla.
async function magenta(page, rect, inset = 3) {
  const clip = { x: Math.round(rect.x + inset), y: Math.round(rect.y + inset), width: Math.max(2, Math.round(rect.width - inset * 2)), height: Math.max(2, Math.round(rect.height - inset * 2)) };
  const shot = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async data => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let hit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] < 20 && d[i + 2] > 235) hit++;
    return hit / (d.length / 4);
  }, shot);
}
// El rectángulo de un elemento; el de un lienzo, recortado a lo que de verdad se ve de él.
const rectOf = (page, selector) => page.evaluate(sel => {
  const e = document.querySelector(sel);
  if (!e) return null;
  let r = e.getBoundingClientRect();
  if (e.tagName === 'CANVAS' && e.parentElement !== document.body && getComputedStyle(e.parentElement).overflow !== 'visible') {
    const p = e.parentElement.getBoundingClientRect();
    const x = Math.max(r.x, p.x), y = Math.max(r.y, p.y);
    r = { x, y, width: Math.min(r.right, p.right) - x, height: Math.min(r.bottom, p.bottom) - y };
  }
  // La barra de arriba tapa el arranque de algunos lienzos: eso es barra, no imagen.
  const bar = document.getElementById('shellTop');
  if (e.tagName === 'CANVAS' && bar) { const b = bar.getBoundingClientRect().bottom; if (r.y < b) r = { x: r.x, y: b, width: r.width, height: r.height - (b - r.y) }; }
  return { x: r.x, y: r.y, width: r.width, height: r.height, shown: r.width > 20 && r.height > 20 && getComputedStyle(e).visibility !== 'hidden' };
}, selector);

(async () => {
  const browser = await launch();
  try {
    // ── La portada: el logo lleva grano ──
    let { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 }, boot: false, piel: 'objeto' });
    await page.waitForSelector('#splash > .grano');
    await page.addStyleTag({ content: DYE });
    const hero = await magenta(page, await rectOf(page, '.splash-hero'));
    assert.ok(hero > 0.95, 'la pantalla de la portada, con su logo, lleva grano: ' + hero.toFixed(3));
    step('portada: el logo lleva grano', { cubierto: +hero.toFixed(3) });

    // ── La cámara: el aparato sí, el visor no ──
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    await page.waitForTimeout(3600);            // la pantallita termina su secuencia de arranque
    const layers = await page.evaluate(() => ['#shellTop', '#camDeck', '#lcd', '#shellLauncher', '#flipSettingsPanel'].filter(sel => !document.querySelector(sel + ' > .grano')));
    assert.deepEqual(layers, [], 'cada superficie tiene su capa de grano');
    const visor = await magenta(page, await rectOf(page, '#display'));
    const deck = await magenta(page, await rectOf(page, '#camDeck'));
    const top = await magenta(page, await rectOf(page, '#shellTop'));
    assert.equal(visor, 0, 'ni un píxel de grano sobre el visor');
    assert.ok(deck > 0.93 && top > 0.93, 'el pupitre y la barra de arriba van cubiertos: ' + deck.toFixed(3) + ' ' + top.toFixed(3));
    // El marco del visor: grano en el aro, nada en el cristal. Y sin costuras: la carcasa que
    // asoma junto al marco y entre el marco y el pupitre también lo lleva.
    const lcd = await rectOf(page, '#lcd');
    const ring = await magenta(page, { x: lcd.x, y: lcd.y + lcd.height / 2 - 20, width: 9, height: 40 }, 1);
    const glass = await magenta(page, { x: lcd.x + lcd.width / 2 - 40, y: lcd.y + 26, width: 80, height: 10 }, 0);
    assert.ok(ring > 0.8, 'el aro del marco lleva grano: ' + ring.toFixed(3));
    assert.equal(glass, 0, 'el cristal, no');
    const seam = await magenta(page, { x: 30, y: lcd.y + lcd.height, width: 300, height: 2 }, 0);
    assert.ok(seam > 0.95, 'ni una franja de carcasa sin grano entre el marco y el pupitre: ' + seam.toFixed(3));
    // Y no se sale de la carcasa: nada en el canto negro ni fuera de sus esquinas redondeadas.
    const view = page.viewportSize();
    const rim = await magenta(page, { x: 0, y: 200, width: 2, height: 300 }, 0);
    const corner = await magenta(page, { x: 0, y: view.height - 5, width: 5, height: 5 }, 0);
    assert.equal(rim + corner, 0, 'el grano no se sale de la carcasa: ' + rim + ' ' + corner);
    const pieces = await page.evaluate(() => ['.hw-candy', '#deckShutter', '.hw-lcd', '#deckGallery'].filter(sel => !document.querySelector(sel + ' > .grano.leve')));
    assert.deepEqual(pieces, [], 'las piezas lustrosas y de cristal llevan su grano leve');
    step('cámara: aparato con grano, visor limpio', { pupitre: +deck.toFixed(3), barra: +top.toFixed(3), aro: +ring.toFixed(3), costura: +seam.toFixed(3), fuera: rim + corner, visor });

    // ── Es una opción: la tecla GRANO del lanzador lo quita, lo dice y se recuerda ──
    await page.locator('#shellModule').click();
    const key = page.locator('#rolloGrano');
    assert.equal((await key.textContent()).trim(), 'SIN GRANO');
    await key.click();
    assert.equal((await key.textContent()).trim(), 'CON GRANO');
    await page.locator('#launcherClose').click();
    await page.waitForTimeout(300);
    const off = await magenta(page, await rectOf(page, '#camDeck'));
    assert.equal(off, 0, 'sin grano, el pupitre queda como antes');
    assert.equal(await page.evaluate(() => localStorage.getItem('flip.rollo.grano')), 'no');
    await page.reload();
    await page.waitForFunction(() => window.flipGrano && document.body.dataset.grano === 'no');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#splash > .grano') || document.body).display === 'none' || !document.querySelector('#splash > .grano')), true, 'tras recargar sigue sin grano');
    await page.evaluate(() => window.flipGrano.set(true));
    assert.equal(await page.evaluate(() => localStorage.getItem('flip.rollo.grano')), 'si');
    await page.addStyleTag({ content: DYE });
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    await page.waitForTimeout(3600);
    const back = await magenta(page, await rectOf(page, '#camDeck'));
    assert.ok(back > 0.93, 'y al ponerlo vuelve: ' + back.toFixed(3));
    step('la tecla GRANO lo quita, lo pone y se recuerda');

    // ── Los demás módulos: su lienzo queda limpio ──
    const canvases = { portal: '#display', ascii: '#asciiCanvas', sflow: '#sflowCanvas', scrash: '#scrashCanvas', fusion: '#fusionCanvas', sono: '#sonoCanvas', wmp: '#wmpCanvas', edit: '#editCanvas', stage: '#stageCanvas' };
    const clean = {};
    for (const [key, selector] of Object.entries(canvases)) {
      await openModule(page, key);
      await page.waitForTimeout(700);
      const rect = await rectOf(page, selector);
      assert.ok(rect && rect.shown, key + ': su lienzo está en pantalla');
      clean[key] = await magenta(page, rect);
      assert.equal(clean[key], 0, key + ': ni un píxel de grano sobre su lienzo');
    }
    const bar = await magenta(page, await rectOf(page, '#shellTop'));
    assert.ok(bar > 0.93, 'y la barra de arriba sigue cubierta: ' + bar.toFixed(3));
    assert.deepEqual(errors, [], 'sin errores');
    step('los otros nueve módulos: lienzo limpio', clean);
    await page.context().close();

    // ── La página de entrada ──
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    page = await context.newPage();
    await page.goto(BASE + '/hola/index.html');
    await page.addStyleTag({ content: DYE });
    const first = await magenta(page, { x: 0, y: 0, width: 412, height: 500 }, 0);
    assert.ok(first > 0.95, 'la página lleva grano: ' + first.toFixed(3));
    for (const selector of ['.pelicula video', '.camaras img']) {
      await page.locator(selector).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const amount = await magenta(page, await rectOf(page, selector));
      assert.equal(amount, 0, selector + ': limpia');
    }
    step('página de entrada: grano en la página, película y muestras limpias');
    await context.close();
    console.log('GRAIN PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
