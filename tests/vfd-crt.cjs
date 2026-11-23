// VFD · CRT: el televisor de tubo con colorizador. Con los mandos reales y la cámara simulada:
// se elige desde la bandeja, la imagen es la del aparato (fondo negro, contornos de color, luces
// quemadas en rosa), no parpadea con la escena quieta, el mismo instante da siempre el mismo
// cuadro, la foto y el vídeo salen como el visor, aguanta los cuatro formatos y no deja
// manchado el lienzo para la cámara siguiente.
//   FLIP_URL=http://127.0.0.1:8760 node tests/vfd-crt.cjs [carpeta-de-salida]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, openFlip, probe } = require('./lib/harness.cjs');

const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'flip-crt-')));
fs.mkdirSync(out, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const SNAP = '#deckShutter', MODE = '#deckModeSwitch';

async function download(page, action, name) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), action()]);
  const target = path.join(out, name + path.extname(file.suggestedFilename()));
  await file.saveAs(target);
  return target;
}
// Qué hay en el visor: cuánto negro, cuánto color saturado y cuánto rosa quemado.
const look = page => page.evaluate(() => {
  const d = FlipKit.pixels(display, null, [128, 96]);
  let dark = 0, color = 0, pink = 0, sum = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    sum += 0.299 * r + 0.587 * g + 0.114 * b;
    if (hi < 48) dark++;
    if (hi - lo > 90) color++;
    if (r > 180 && b > 110 && g < r * 0.72 && r >= b) pink++;
  }
  return { dark: +(dark / n).toFixed(3), color: +(color / n).toFixed(3), pink: +(pink / n).toFixed(3), mean: +(sum / n).toFixed(1), size: display.width + 'x' + display.height };
});

async function main() {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720 } });
    await page.waitForFunction(() => vid.videoWidth > 0);

    // ── 1 · Se elige desde la bandeja, como cualquier otra variante ──
    await page.locator('#deckLooks [data-family="VFD"]').click();
    const keys = await page.evaluate(() => [...document.querySelectorAll('#deckVariants [data-variant]')].map(b => ({ id: b.dataset.variant, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })));
    assert.deepEqual(keys.map(k => k.id), ['STD', 'THRML', 'CRT']);
    assert.ok(keys.every(k => k.w >= 80 && k.h >= 34), 'tres teclas que caben y se pueden pulsar: ' + JSON.stringify(keys));
    await page.locator('#deckVariants [data-variant="CRT"]').click();
    await page.waitForFunction(() => camFamily === 'VFD' && camVariant === 'CRT');
    const lcd = await page.evaluate(() => document.getElementById('lcdLook').textContent);
    assert.match(lcd, /CRT/, 'la pantallita dice la variante: ' + lcd);
    await page.waitForTimeout(900);
    step('se elige con sus teclas', { lcd: lcd.trim().replace(/\s+/g, ' ').slice(0, 24) });

    // ── 2 · Es la imagen del aparato: casi todo negro, color en los contornos y rosa en las luces ──
    const live = await look(page);
    assert.ok(live.dark > 0.45, 'el fondo se hunde en negro: ' + live.dark);
    assert.ok(live.color > 0.04, 'hay color saturado: ' + live.color);
    assert.ok(live.pink > 0.008, 'las luces se queman en rosa: ' + live.pink);
    assert.ok(live.mean > 8 && live.mean < 120, 'nivel medio: ' + live.mean);
    step('imagen de tubo con colorizador', live);

    // ── 3 · Escena quieta: ni parpadea ni bombea; el mismo instante da el mismo cuadro ──
    const calm = await page.evaluate(() => {
      FlipKit.hold();
      FlipKit.select('VFD', 'CRT');
      const base = 7100000, means = [], diffs = [];
      let last = null;
      for (let i = 0; i < 45; i++) {
        FlipKit.frame('portrait', 0.5, base + i * 1000 / 30);
        const luma = FlipKit.luma(display, null, [64, 48]);
        let mean = 0, diff = 0;
        for (let p = 0; p < luma.length; p++) { mean += luma[p]; if (last) diff += Math.abs(luma[p] - last[p]); }
        means.push(mean / luma.length);
        if (last) diffs.push(diff / luma.length);
        last = luma;
      }
      const again = () => { FlipKit.frame('portrait', 0.5, base + 44 * 1000 / 30); return ctxD.getImageData(0, 0, display.width, display.height).data; };
      const a = again(), b = again();
      let same = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) same++;
      const visor = FlipKit.luma(display, null, [DSI_W, DSI_H]);
      const shot = FlipKit.exportFrame('portrait', 0.5, base + 44 * 1000 / 30, null, 'high');
      return {
        swing: Math.max(...means) - Math.min(...means), flicker: Math.max(...diffs), same: same / (a.length / 4),
        export: FlipKit.correlation(visor, FlipKit.luma(shot, null, [DSI_W, DSI_H])), exportSize: shot.width + 'x' + shot.height,
      };
    });
    assert.ok(calm.swing < 4, 'el nivel no bombea: ' + calm.swing);
    assert.ok(calm.flicker < 5, 'no parpadea de un cuadro al siguiente: ' + calm.flicker);
    assert.equal(calm.same, 1, 'mismo instante, mismo cuadro');
    assert.ok(calm.export > 0.95, 'la exportación en alta es el visor: ' + calm.export);
    step('escena quieta estable y repetible', { swing: +calm.swing.toFixed(2), flicker: +calm.flicker.toFixed(2), export: +calm.export.toFixed(3), exportSize: calm.exportSize });

    // ── 3b · El sincronismo se va solo de vez en cuando: una vertical se queda vertical casi siempre ──
    // (Con el desgarro apagado, ninguna banda de líneas puede quedar corrida.)
    const sync = await page.evaluate(() => {
      const src = FlipKit.source(640, 480), ctx = FlipKit.sctx;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#fff'; ctx.fillRect(320, 0, 320, 480);
      let clean = 0, shifted = 0, rows = 0, topBand = 0;
      const frames = 60;
      for (let i = 0; i < frames; i++) {
        _renderCamEngineFrame(src, 640, 480, ctxD, false, { path: 'preview', now: 5600000 + i * 190 });
        const d = ctxS.getImageData(0, 0, DSI_W, DSI_H).data, edges = [];
        for (let y = 0; y < DSI_H; y++) {
          // El borde es donde empieza una tirada de cuatro puntos encendidos (una chispa suelta no cuenta).
          const lit = x => d[(y * DSI_W + x) * 4] + d[(y * DSI_W + x) * 4 + 1] + d[(y * DSI_W + x) * 4 + 2] >= 200;
          let x = 0;
          while (x < DSI_W - 4 && !(lit(x) && lit(x + 1) && lit(x + 2) && lit(x + 3))) x++;
          edges.push(x);
        }
        const sorted = edges.slice().sort((a, b) => a - b), middle = sorted[sorted.length >> 1];
        let off = 0;
        for (let y = 0; y < DSI_H; y++) if (Math.abs(edges[y] - middle) >= 2) { off++; if (y < 3) topBand++; }
        rows += DSI_H; shifted += off;
        if (!off) clean++;
      }
      return { clean: clean / frames, shifted: shifted / rows, topBand };
    });
    assert.ok(sync.clean > 0.7, 'la mayoría de los cuadros no tiene ninguna línea corrida: ' + sync.clean);
    assert.ok(sync.shifted < 0.03, 'líneas corridas: ' + sync.shifted);
    assert.ok(sync.topBand < 30, 'la banda de arriba no vive corrida: ' + sync.topBand + ' de 180');
    step('el desgarro es un accidente, no una costumbre', { cuadrosLimpios: +sync.clean.toFixed(2), lineasCorridas: +sync.shifted.toFixed(4) });

    // ── 4 · Cualquier exposición: de casi a oscuras a quemado, siempre hay imagen y nunca un error ──
    const range = await page.evaluate(() => {
      const src = FlipKit.source(640, 480), ctx = FlipKit.sctx, results = [];
      for (const [name, gain, lift] of [['penumbra', 0.12, 0], ['normal', 1, 0], ['quemada', 1.6, 90], ['negro', 0, 0], ['blanco', 0, 255]]) {
        const base = 8200000 + results.length * 50000;
        for (let i = 0; i < 12; i++) {
          FlipScenes.draw(ctx, 640, 480, 'portrait', 0.5, {});
          const image = ctx.getImageData(0, 0, 640, 480), d = image.data;
          for (let p = 0; p < d.length; p += 4) { d[p] = d[p] * gain + lift; d[p + 1] = d[p + 1] * gain + lift; d[p + 2] = d[p + 2] * gain + lift; }
          ctx.putImageData(image, 0, 0);
          _renderCamEngineFrame(src, 640, 480, ctxD, false, { path: 'preview', now: base + i * 1000 / 30 });
        }
        const stats = FlipKit.stats(display);
        results.push({ name, mean: +stats.mean.toFixed(1), max: stats.max, std: +stats.std.toFixed(1) });
      }
      return results;
    });
    const by = Object.fromEntries(range.map(r => [r.name, r]));
    assert.ok(by.penumbra.std > 6, 'en penumbra sigue habiendo imagen: ' + JSON.stringify(by.penumbra));
    assert.ok(by.normal.std > 12 && by.quemada.std > 12, 'con luz normal y quemada hay imagen');
    assert.ok(by.negro.mean < 30, 'con la lente tapada, negro de tubo: ' + by.negro.mean);
    assert.ok(by.blanco.mean > 60, 'contra un foco, la pantalla se quema: ' + by.blanco.mean);
    step('de la penumbra al foco', Object.fromEntries(range.map(r => [r.name, r.mean])));

    // ── 5 · Los cuatro formatos, con las teclas de la consola de ajustes (sección CUADRO) ──
    await page.evaluate(() => { cameraRunning = true; requestAnimationFrame(cameraLoop); });
    await page.locator('#deckAdjust').click();
    await page.waitForFunction(() => camEditOpen);
    await page.locator('#csSections [data-sec="frame"]').click();
    const formats = {};
    for (const [aw, ah] of [[9, 16], [3, 4], [16, 9], [4, 3]]) {
      await page.locator(`#palettes #camAspect .asp-btn[data-aw="${aw}"][data-ah="${ah}"]`).click();
      await page.waitForFunction(([aw, ah]) => camAspW === aw && camAspH === ah && !cameraRequest && vid.videoWidth > 0, [aw, ah]);
      await page.waitForTimeout(500);
      const shape = await look(page);
      const [w, h] = shape.size.split('x').map(Number);
      assert.ok(Math.abs(w / h - aw / ah) < 0.03, `formato ${aw}:${ah} → ${shape.size}`);
      assert.ok(shape.color > 0.02 && shape.dark > 0.3, `imagen en ${aw}:${ah}: ` + JSON.stringify(shape));
      formats[aw + ':' + ah] = shape.size;
    }
    await page.locator('#btnCamEditClose').click();
    await page.waitForFunction(() => !camEditOpen);
    step('cuatro formatos', formats);

    // ── 6 · Foto con el disparador: el archivo es lo que se veía ──
    await page.waitForTimeout(500);
    const visor = await page.evaluate(() => Array.from(FlipKit.luma(display, null, [64, 48])));
    const photo = await download(page, () => page.locator(SNAP).click(), 'foto-crt');
    const still = probe(photo).streams[0];
    assert.ok(still.width >= 640 && still.height >= 480, 'foto ' + still.width + 'x' + still.height);
    const match = await page.evaluate(async ({ bytes, visor }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return FlipKit.correlation(Float32Array.from(visor), FlipKit.luma(canvas, null, [64, 48]));
    }, { bytes: fs.readFileSync(photo).toString('base64'), visor });
    assert.ok(match > 0.8, 'la foto coincide con el visor: ' + match);
    step('foto', { size: still.width + 'x' + still.height, visor: +match.toFixed(3) });

    // ── 7 · Vídeo: graba, para y el archivo se abre ──
    await page.locator(MODE).click();
    await page.locator(SNAP).click();
    await page.waitForFunction(() => recorder && recorder.state === 'recording');
    await page.waitForTimeout(1800);
    const video = await download(page, () => page.locator(SNAP).click(), 'video-crt');
    const info = probe(video), track = info.streams.find(s => s.codec_type === 'video');
    assert.ok(Number(track.nb_read_frames) >= 10, 'cuadros grabados: ' + track.nb_read_frames);
    await page.waitForFunction(() => !recorder);
    await page.locator(MODE).click();
    step('vídeo', { codec: track.codec_name, size: track.width + 'x' + track.height, frames: Number(track.nb_read_frames) });

    // ── 8 · No mancha el lienzo: la cámara siguiente pinta igual que si CRT no hubiera pasado ──
    const clean = await page.evaluate(() => {
      FlipKit.hold();
      const shot = () => { FlipKit.select('DSI', 'STD'); for (let i = 0; i < 6; i++) FlipKit.frame('portrait', 0.5, 9300000 + i * 125); return Array.from(FlipKit.luma(display, null, [64, 48])); };
      const before = shot();
      FlipKit.select('VFD', 'CRT');
      for (let i = 0; i < 6; i++) FlipKit.frame('portrait', 0.5, 9400000 + i * 33);
      const state = { alpha: ctxD.globalAlpha, op: ctxD.globalCompositeOperation, filter: ctxD.filter, smooth: ctxD.imageSmoothingEnabled };
      const after = shot();
      let worst = 0;
      for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(before[i] - after[i]));
      return { state, worst };
    });
    assert.deepEqual(clean.state, { alpha: 1, op: 'source-over', filter: 'none', smooth: false });
    assert.ok(clean.worst < 1, 'DSI pinta igual después de CRT: ' + clean.worst);
    step('deja el lienzo como estaba', clean.state);

    assert.deepEqual(errors, []);
    console.log('PASS · VFD CRT');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
