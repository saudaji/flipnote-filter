// Las tramas de la cámara DSi. La consola de DSi · STD tiene dos perillas: TRAMA (Bayer, Atkinson,
// ruido azul, puntos, líneas y rayado cruzado) y TAMAÑO (la celda de la trama, de ×1 a ×4). Con
// una escena fija y una carta de grises se comprueba, trama a trama:
//   · que el visor sigue siendo de dos tintas (papel y tinta, nada más);
//   · que reproduce el tono: más tinta cuanto más oscuro, de un extremo a otro de la rampa;
//   · que cada trama dibuja distinto de las demás;
//   · que es estable: con la imagen quieta, dos cuadros seguidos son iguales (las de umbral,
//     punto a punto; Atkinson, con su histéresis, casi);
//   · que ×2 engorda el dibujo;
// y además que la perilla mueve la trama y la pantallita lo dice, que la foto sale como el visor,
// que el ajuste se conserva al recargar y que DSi · LGCY y UPLOAD no cambian.
//   FLIP_URL=http://127.0.0.1:8760 node tests/dither.cjs [--shots carpeta]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip } = require('./lib/harness.cjs');

const at = process.argv.indexOf('--shots');
const shots = at >= 0 ? path.resolve(process.argv[at + 1]) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const CAMERA = { scene: 'ramp', w: 1280, h: 720, fps: 30, freeze: 2 };

// Lo que hay en el sensor de DSi (256 × 192) en este momento.
const read = page => page.evaluate(() => {
  const w = DSI_W, h = DSI_H, d = ctxS.getImageData(0, 0, w, h).data, pal = _getPal(false);
  const ink = new Uint8Array(w * h), colours = new Set();
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    ink[p] = Math.abs(d[i] - pal.ink[0]) + Math.abs(d[i + 1] - pal.ink[1]) + Math.abs(d[i + 2] - pal.ink[2]) < 24 ? 1 : 0;
  }
  // Tinta por franjas verticales del tercio de arriba (la rampa continua, de negro a blanco).
  const bands = [];
  for (let b = 0; b < 8; b++) {
    let n = 0, total = 0;
    for (let y = 4; y < h / 3 - 4; y++) for (let x = Math.round(b * w / 8); x < Math.round((b + 1) * w / 8); x++) { n += ink[y * w + x]; total++; }
    bands.push(+(n / total).toFixed(3));
  }
  // Longitud media de los tramos horizontales de un mismo color en la franja central (grosor del dibujo).
  let runs = 0, cells = 0;
  for (let y = 4; y < h / 3 - 4; y++) { for (let x = Math.round(w * 3 / 8); x < Math.round(w * 5 / 8); x++) { cells++; if (x === Math.round(w * 3 / 8) || ink[y * w + x] !== ink[y * w + x - 1]) runs++; } }
  let hash = 0;
  for (let p = 0; p < ink.length; p++) hash = (hash * 31 + ink[p]) >>> 0;
  return { colours: colours.size, bands, run: +(cells / runs).toFixed(2), hash, bits: Array.from(ink).join('') };
});
const setKnobs = (page, trama, celda) => page.evaluate(([t, c]) => {
  for (const [id, value] of [['dsiTrama', t], ['dsiCelda', c]]) { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
}, [trama, celda]);
const same = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n++; return n / a.length; };

(async () => {
  const browser = await launch();
  try {
    let { page, errors, context } = await openFlip(browser, { sceneCamera: CAMERA });
    await page.waitForTimeout(600);
    const names = await page.evaluate(() => DSI_TRAMAS.map(t => t.id));
    assert.deepEqual(names, ['BAYER', 'ATKINSON', 'AZUL', 'PUNTOS', 'LINEAS', 'CRUZ']);

    // ── 1 · Cada trama ──
    const seen = {};
    for (let i = 0; i < names.length; i++) {
      await setKnobs(page, i, 1);
      await page.waitForTimeout(450);
      const a = await read(page);
      await page.waitForTimeout(350);
      const b = await read(page);
      assert.equal(a.colours, 2, names[i] + ': el visor es de dos tintas, tiene ' + a.colours);
      for (let k = 1; k < a.bands.length; k++) assert.ok(a.bands[k] <= a.bands[k - 1] + 0.03, names[i] + ': más tinta en lo oscuro que en lo claro ' + a.bands);
      assert.ok(a.bands[0] > 0.8 && a.bands[7] < 0.2, names[i] + ': de negro lleno a papel limpio ' + a.bands);
      const stable = same(a.bits, b.bits);
      assert.ok(stable >= (names[i] === 'ATKINSON' ? 0.985 : 1), names[i] + ': quieta, la trama no se mueve (' + (stable * 100).toFixed(2) + ' % igual)');
      seen[names[i]] = { hash: a.hash, run: a.run, bands: a.bands, stable };
      if (shots) await page.screenshot({ path: path.join(shots, 'trama-' + names[i] + '.png') });
      // Celda doble: el dibujo engorda.
      await setKnobs(page, i, 2);
      await page.waitForTimeout(450);
      const wide = await read(page);
      assert.equal(wide.colours, 2);
      assert.ok(wide.run > a.run * 1.35, names[i] + ' ×2 dibuja más grueso: ' + a.run + ' → ' + wide.run);
      seen[names[i]].run2 = wide.run;
    }
    assert.equal(new Set(Object.values(seen).map(s => s.hash)).size, names.length, 'cada trama dibuja distinto');
    step('seis tramas: dos tintas, tono fiel, estables y distintas', Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [v.run, v.run2]])));

    // ── 2 · La perilla y la pantallita ──
    await setKnobs(page, 0, 1);
    await page.locator('#deckAdjust').click();
    await page.waitForFunction(() => flipConsole.state().open);
    const panel = await page.evaluate(() => ({ section: flipConsole.state().section, shown: document.getElementById('dsiEditPanel').style.display, knobs: flipConsole.state().knobs.length }));
    assert.equal(panel.shown, 'block', 'DSi · STD enseña su página de cámara');
    const knob = await page.evaluateHandle(() => flipConsole.knob('dsiTrama'));
    const box = await knob.asElement().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 70, { steps: 8 });
    const lcd = await page.evaluate(() => document.getElementById('lcdParam').textContent + ' ' + document.getElementById('lcdValue').textContent);
    await page.mouse.up();
    const turned = await page.evaluate(() => ({ value: dsiTramaVal, label: document.getElementById('vDsiTrama').textContent }));
    assert.ok(turned.value >= 1, 'girar la perilla cambia la trama: ' + JSON.stringify(turned));
    assert.match(lcd, /^TRAMA /, 'la pantallita dice qué se mueve: ' + lcd);
    assert.equal(turned.label, (await page.evaluate(() => DSI_TRAMAS[dsiTramaVal].label)));
    await page.keyboard.press('Escape');
    step('la perilla TRAMA mueve la trama y la pantallita lo dice', { pantallita: lcd, trama: turned.label });

    // ── 3 · La foto sale como el visor ──
    await setKnobs(page, 3, 2);
    await page.waitForTimeout(500);
    const visor = await page.evaluate(() => Array.from(FlipKit.luma(display, null, [64, 48])));
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('#deckShutter').click()]);
    const file = await download.path();
    const match = await page.evaluate(async ({ bytes, visor }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return FlipKit.correlation(Float32Array.from(visor), FlipKit.luma(canvas, null, [64, 48]));
    }, { bytes: fs.readFileSync(file).toString('base64'), visor });
    assert.ok(match > 0.9, 'la foto coincide con el visor: ' + match);
    step('la foto con trama de puntos sale como el visor', { coincidencia: +match.toFixed(3) });

    // ── 4 · Se conserva al recargar; LGCY y UPLOAD no cambian ──
    await page.reload();
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const kept = await page.evaluate(() => ({ trama: dsiTramaVal, celda: dsiCeldaVal, label: document.getElementById('vDsiTrama').textContent, size: document.getElementById('vDsiCelda').textContent }));
    assert.deepEqual(kept, { trama: 3, celda: 2, label: 'PUNTOS', size: '×2' }, 'el ajuste se conserva');
    // LGCY: sin página de cámara, y su difusión de error no depende de la perilla.
    await page.evaluate(() => { camVariant = 'LGCY'; _applyCamState(); });
    await page.waitForTimeout(500);
    const legacyA = await read(page);
    const hidden = await page.evaluate(() => document.getElementById('dsiEditPanel').style.display);
    await setKnobs(page, 5, 4);
    await page.waitForTimeout(500);
    const legacyB = await read(page);
    assert.equal(hidden, 'none', 'DSi · LGCY no enseña la perilla');
    assert.ok(same(legacyA.bits, legacyB.bits) > 0.999, 'ni cambia con ella');
    // UPLOAD usa el mismo motor con sus propios mandos: sigue en Bayer.
    const upload = await page.evaluate(() => {
      const scene = document.createElement('canvas'); scene.width = 256; scene.height = 192;
      const g = scene.getContext('2d'), grad = g.createLinearGradient(0, 0, 256, 0);
      grad.addColorStop(0, '#000'); grad.addColorStop(1, '#fff'); g.fillStyle = grad; g.fillRect(0, 0, 256, 192);
      const out = document.createElement('canvas'); out.width = 256; out.height = 192;
      const run = () => { _renderDitheredCore(scene, 256, 192, out.getContext('2d'), false, false, true, null, { sampleW: 256, sampleH: 192, outW: 256, outH: 192, scanCanvas: false }); return Array.from(out.getContext('2d').getImageData(0, 0, 256, 192).data).join(','); };
      dsiTramaVal = 5; dsiCeldaVal = 4; const withCross = run();
      dsiTramaVal = 0; dsiCeldaVal = 1; const withBayer = run();
      return withCross === withBayer;
    });
    assert.equal(upload, true, 'UPLOAD no depende de la trama de DSi');
    step('se conserva al recargar; LGCY y UPLOAD, como estaban', kept);

    assert.deepEqual(errors, [], 'sin errores de página');
    console.log('DITHER PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error('DITHER FAIL\n', error); process.exit(1); });
