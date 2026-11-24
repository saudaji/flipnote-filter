// El aparato como objeto. Lo que promete la séptima pasada y se puede comprobar sin un teléfono:
//   · la carcasa es una pieza con su canto, separada del borde de la pantalla por una rendija
//     negra (esquinas y bordes negros, plástico dentro), también en lanzador, visor y portada;
//   · luz viva: al inclinar el teléfono giran los brillos del disparador, de los botones redondos
//     y de las perillas, y lo que llevan encima (iconos, marcas) no; inclinaciones opuestas giran
//     en sentidos opuestos, hay un tope, una postura sostenida vuelve sola al reposo, quieto no
//     se escribe nada y con la app oculta el sensor se suelta;
//   · la hoja de formato y audio no desenfoca la cámara y, cerrada, no existe para la gráfica;
//     sus teclas y perillas son las piezas renderizadas.
//   FLIP_URL=http://127.0.0.1:8760 node tests/object.cjs [--shots carpeta]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip } = require('./lib/harness.cjs');

const at = process.argv.indexOf('--shots');
const shots = at >= 0 ? path.resolve(process.argv[at + 1]) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

// Color de unos puntos de una captura, leído en la propia página.
async function pixels(page, points) {
  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(async ([b64, pts]) => {
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
    const k = bitmap.width / innerWidth;
    return pts.map(([x, y]) => { const d = ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data; return [d[0], d[1], d[2]]; });
  }, [shot, points]);
}
const dark = c => c[0] + c[1] + c[2] < 60, cream = c => c[0] > 200 && c[1] > 195 && c[2] > 170 && c[0] >= c[2];

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
    await page.waitForTimeout(500);
    const size = await page.evaluate(() => [innerWidth, innerHeight]);
    const [W, H] = size;

    // ── 1 · Carcasa ──
    const frame = async label => {
      const [corner, cornerB, left, inside, top] = await pixels(page, [[1.5, 1.5], [W - 1.5, H - 1.5], [0.8, H / 2], [9, H * 0.47], [W / 2, 0.8]]);
      assert.ok(dark(corner) && dark(cornerB), label + ': las esquinas son negras (el aparato tiene las suyas redondeadas) ' + corner + ' ' + cornerB);
      assert.ok(dark(left) && dark(top), label + ': rendija negra entre el aparato y el borde ' + left + ' ' + top);
      assert.ok(cream(inside), label + ': dentro, el plástico ' + inside);
    };
    await frame('CAM');
    const body = await page.evaluate(() => ({ image: getComputedStyle(document.getElementById('camBody')).backgroundImage, page: getComputedStyle(document.body).backgroundColor, theme: document.querySelector('meta[name="theme-color"]').content }));
    assert.match(body.image, /shell-top\.webp.*shell-bottom\.webp.*shell-mid\.webp/, 'la carcasa es el render en tres piezas');
    assert.equal(body.page, 'rgb(0, 0, 0)');
    assert.equal(body.theme.toLowerCase(), '#000000', 'la barra del navegador, negra como el teléfono');
    await page.locator('#shellModule').click();
    await page.waitForTimeout(350);
    await frame('lanzador');
    if (shots) await page.screenshot({ path: path.join(shots, 'lanzador.png') });
    await page.locator('#launcherClose').click();
    step('la carcasa es un objeto con su canto, también en el lanzador', { pantalla: size });

    // ── 2 · Luz viva ──
    const tilt = async (beta, gamma, ms = 600) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        await page.evaluate(([b, g]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: g })), [beta, gamma]);
        await page.waitForTimeout(50);
      }
      return page.evaluate(() => {
        const shutter = document.getElementById('deckShutter'), candy = document.getElementById('deckAdjust');
        const m = new DOMMatrix(getComputedStyle(shutter, '::before').transform);
        const icon = candy.querySelector('svg').getBoundingClientRect();
        return { ...flipLight.state(), sprite: +(Math.atan2(m.b, m.a) * 180 / Math.PI).toFixed(1), candy: candy.style.getPropertyValue('--lt'), icon: [Math.round(icon.x * 10), Math.round(icon.y * 10), Math.round(icon.width * 10)],
          own: getComputedStyle(shutter).backgroundSize, piece: getComputedStyle(shutter, '::before').backgroundImage.includes('shutter-') };
      });
    };
    const rest = await tilt(50, 0, 400);
    assert.equal(rest.turn, 0, 'en reposo la luz está donde el render');
    assert.ok(rest.piece && rest.own === '0px 0px', 'el render del disparador va en su propia capa');
    if (shots) await page.screenshot({ path: path.join(shots, 'luz-reposo.png') });
    const right = await tilt(50, 20);
    assert.ok(right.turn < -8 && right.turn >= -34, 'inclinado a la derecha, el brillo gira: ' + right.turn);
    assert.ok(Math.abs(right.sprite - right.turn) < 1, 'gira el render del disparador: ' + right.sprite);
    assert.equal(right.candy, right.turn.toFixed(1) + 'deg', 'y el de los botones redondos');
    assert.deepEqual(right.icon, rest.icon, 'el icono de encima no se mueve');
    if (shots) await page.screenshot({ path: path.join(shots, 'luz-derecha.png') });
    const left = await tilt(50, -20);
    assert.ok(left.turn > 8, 'a la izquierda, al revés: ' + left.turn);
    const far = await tilt(50, -80);
    assert.ok(far.turn <= 34.01, 'con tope: ' + far.turn);
    // Quieto: no se escribe nada (ni un despertar).
    const writes = await page.evaluate(async () => {
      const node = document.getElementById('deckShutter');
      let n = 0;
      const mo = new MutationObserver(list => { n += list.length; });
      mo.observe(node, { attributes: true, attributeFilter: ['style'] });
      const still = flipLight.state();
      for (let i = 0; i < 12; i++) { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 50.2, gamma: -80.1 })); await new Promise(r => setTimeout(r, 50)); }
      await new Promise(r => setTimeout(r, 300));
      mo.disconnect();
      return { n, before: still.turn, after: flipLight.state().turn };
    });
    assert.ok(writes.n <= 2, 'quieto no se toca nada: ' + writes.n + ' escrituras');
    // Sostener la postura: vuelve sola hacia el reposo.
    const held = await tilt(50, -20, 300);
    const later = await tilt(50, -20, 3200);
    assert.ok(Math.abs(later.turn) < Math.abs(held.turn) * 0.8, 'una postura sostenida vuelve al reposo: ' + held.turn + ' → ' + later.turn);
    // Oculta: suelta el sensor.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal((await page.evaluate(() => flipLight.state())).listening, false, 'con la app oculta no se escucha el sensor');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal((await page.evaluate(() => flipLight.state())).listening, true);
    step('luz viva', { derecha: right.turn, izquierda: left.turn, tope: far.turn, sostenida: [held.turn, later.turn], piezas: right.pieces });

    // ── 3 · Perillas de la consola ──
    await page.locator('#deckAdjust').click();
    await page.waitForFunction(() => flipConsole.state().open);
    await page.locator('#csSections [data-sec="frame"]').click();
    await page.waitForTimeout(300);
    await tilt(50, 0, 250);
    const knob = await (async () => { await tilt(50, 20, 500); return page.evaluate(() => {
      const k = document.querySelector('#palettes .cs-knob:not([data-cs-kind])');
      const m = new DOMMatrix(getComputedStyle(k, '::before').transform), mark = new DOMMatrix(getComputedStyle(k.querySelector('i')).transform);
      return { body: +(Math.atan2(m.b, m.a) * 180 / Math.PI).toFixed(1), mark: +(Math.atan2(mark.b, mark.a) * 180 / Math.PI).toFixed(1), turn: flipLight.state().turn, value: getComputedStyle(k).getPropertyValue('--turn').trim() };
    }); })();
    assert.ok(Math.abs(knob.body - knob.turn) < 1.5 && Math.abs(knob.body) > 5, 'el cuerpo de la perilla gira con la luz: ' + JSON.stringify(knob));
    assert.ok(Math.abs(knob.mark - parseFloat(knob.value || '0')) < 1.5, 'la marca sigue marcando el valor, no la luz: ' + JSON.stringify(knob));
    if (shots) await page.screenshot({ path: path.join(shots, 'consola-luz.png') });
    await page.keyboard.press('Escape');
    step('las perillas giran su brillo y conservan su marca', knob);

    // ── 4 · Hoja de formato y audio ──
    const closed = await page.evaluate(() => ['flipSettingsBackdrop', 'flipSettingsPanel'].map(id => { const cs = getComputedStyle(document.getElementById(id)); return [cs.visibility, cs.backdropFilter || cs.webkitBackdropFilter || 'none']; }));
    assert.deepEqual(closed, [['hidden', 'none'], ['hidden', 'none']], 'cerrada, la hoja no se dibuja ni desenfoca');
    await page.locator('#shellSettings').click();
    await page.waitForFunction(() => document.getElementById('flipSettingsPanel').classList.contains('open'));
    await page.waitForTimeout(350);
    const open = await page.evaluate(() => {
      const blur = [...document.querySelectorAll('body *')].filter(el => { const cs = getComputedStyle(el); const bf = cs.backdropFilter || cs.webkitBackdropFilter; return bf && bf !== 'none' && cs.visibility !== 'hidden' && cs.display !== 'none' && el.getClientRects().length; }).map(el => el.id || el.className);
      const key = document.querySelector('#flipSettingsPanel button.active'), cs = getComputedStyle(key, '::before');
      return { blur, visible: getComputedStyle(document.getElementById('flipSettingsPanel')).visibility, key: cs.borderImageSource, flat: getComputedStyle(key).backgroundImage };
    });
    assert.deepEqual(open.blur, [], 'abierta, nada desenfoca la cámara: ' + open.blur);
    assert.equal(open.visible, 'visible');
    assert.match(open.key, /keycap-coral\.webp/, 'la tecla elegida es la pieza renderizada');
    assert.equal(open.flat, 'none', 'sin degradado de CSS debajo');
    await page.locator('#flipSegAudio').click();
    await page.waitForTimeout(250);
    const audio = await page.evaluate(() => {
      const knob = document.querySelector('#flipSettingsPanel .flip-knob'), card = document.querySelector('#flipSettingsPanel .flip-settings-card');
      return { body: getComputedStyle(knob, '::before').backgroundImage, mark: getComputedStyle(knob, '::after').backgroundImage, own: getComputedStyle(knob).transform, plate: getComputedStyle(card).borderImageSource, knobs: document.querySelectorAll('#flipSettingsPanel .flip-knob').length };
    });
    assert.match(audio.body, /console-knob\.webp/); assert.match(audio.mark, /console-mark\.webp/); assert.match(audio.plate, /console-plate\.webp/);
    assert.equal(audio.own, 'none', 'la perilla no gira entera: gira su marca');
    if (shots) await page.screenshot({ path: path.join(shots, 'hoja-audio.png') });
    await page.keyboard.press('Escape');
    step('hoja de formato y audio: sin desenfoque y con piezas renderizadas', { perillas: audio.knobs });

    assert.deepEqual(errors, [], 'sin errores de página');
    console.log('OBJECT PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error('OBJECT FAIL\n', error); process.exit(1); });
