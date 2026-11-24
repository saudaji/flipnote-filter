// La cámara PRENSA (semitono de imprenta): CMYK, DIARIO y RISO. Con campos planos pintados aquí
// (sin cámara de por medio) se comprueba, tirada a tirada:
//   · que reproduce el tono: más tinta cuanto más oscuro, del papel limpio al casi negro;
//   · que el color sobrevive a la separación (un rojo sale rojo; un gris, gris) y que DIARIO es
//     de una sola tinta;
//   · que la perilla PUNTO cambia el tamaño del punto, y que el punto es proporcional a la imagen
//     (la foto grande es el visor ampliado, no otra trama);
//   · que REGISTRO descuadra las planchas (aparecen flecos de color en un borde negro);
//   · que el espejo es espejo y que, con la imagen quieta, dos cuadros son idénticos;
// y en la app: bandeja y consola (mandos por variante, pantallita), foto como el visor, ajustes que
// se conservan, la gráfica que se suelta y vuelve, y el punto a una tinta si no hay WebGL.
//   FLIP_URL=http://127.0.0.1:8760 node tests/press.cjs [--shots carpeta]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip } = require('./lib/harness.cjs');

const at = process.argv.indexOf('--shots');
const shots = at >= 0 ? path.resolve(process.argv[at + 1]) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

// En la página: pinta un campo y lo pasa por PRENSA en un lienzo propio.
const KIT = () => {
  window.PressKit = {
    field(paint, w = 640, h = 480) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      if (typeof paint === 'string') { g.fillStyle = paint; g.fillRect(0, 0, w, h); } else paint(g, w, h);
      return c;
    },
    print(source, variant, { w = 720, h = 540, mirror = false, path = 'preview' } = {}) {
      const out = document.createElement('canvas'); out.width = w; out.height = h;
      const ctx = out.getContext('2d', { willReadFrequently: true });
      _renderCamEngineFrame(source, source.width, source.height, ctx, mirror, { path, family: 'PRENSA', variant, outW: w, outH: h, now: 1000 });
      return out;
    },
    // Media de color, luminancia, proporción de píxeles «de tinta» y de píxeles con color.
    stats(canvas, box) {
      const [x, y, w, h] = box || [0, 0, canvas.width, canvas.height];
      const d = canvas.getContext('2d').getImageData(x, y, w, h).data;
      let r = 0, g = 0, b = 0, dark = 0, mid = 0, vivid = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (l < 90) dark++; else if (l < 190) mid++;
        if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 70) vivid++;
      }
      return { rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], luma: +((0.299 * r + 0.587 * g + 0.114 * b) / n / 255).toFixed(3), dark: +(dark / n).toFixed(3), mid: +(mid / n).toFixed(3), vivid: +(vivid / n).toFixed(3) };
    },
    // Longitud media de los tramos de tinta o de papel a lo largo de las filas.
    run(canvas) {
      const w = canvas.width, h = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
      let runs = 0, cells = 0;
      for (let y = 8; y < h - 8; y += 3) for (let x = 8; x < w - 8; x++) {
        const i = 4 * (y * w + x), ink = d[i] + d[i + 1] + d[i + 2] < 390, before = d[i - 4] + d[i - 3] + d[i - 2] < 390;
        cells++; if (x === 8 || ink !== before) runs++;
      }
      return +(cells / runs).toFixed(2);
    },
    // Luminancia media por casillas (media de verdad: reducir con drawImage se salta píxeles y, con
    // una trama de puntos, eso es ruido).
    coarse(canvas, cols = 48, rows = 36, flip = false) {
      const w = canvas.width, h = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
      const sum = new Float64Array(cols * rows), count = new Float64Array(cols * rows);
      for (let y = 0; y < h; y++) {
        const row = Math.min(rows - 1, Math.floor(y * rows / h)) * cols;
        for (let x = 0; x < w; x++) {
          const col = Math.min(cols - 1, Math.floor(x * cols / w)), i = 4 * (y * w + x), at = row + (flip ? cols - 1 - col : col);
          sum[at] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; count[at]++;
        }
      }
      return Array.from(sum, (v, i) => v / count[i]);
    },
    corr(a, b) {
      const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
      let sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
      return +(sab / Math.sqrt(saa * sbb || 1)).toFixed(4);
    },
    // Una escena con forma: degradado, disco oscuro a la izquierda y bandas de color a la derecha.
    scene(g, w, h) {
      const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#e9e4d8'); sky.addColorStop(1, '#6d7a86');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1b1d22'; g.beginPath(); g.arc(w * 0.28, h * 0.5, h * 0.28, 0, 7); g.fill();
      ['#d6402f', '#e8b23a', '#2f9a5a', '#2d5fc4'].forEach((color, i) => { g.fillStyle = color; g.fillRect(w * 0.62, h * (0.14 + i * 0.19), w * 0.3, h * 0.15); });
    },
    set(values) { for (const [id, value] of Object.entries(values)) { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); } },
  };
};
const DEFAULTS = { pressDot: 3, pressInk: 50, pressPaper: 35, pressReg: 0, pressPair: 0 };

(async () => {
  const browser = await launch();
  try {
    let { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'portrait', w: 1280, h: 720, fps: 30 } });
    await page.addInitScript(KIT);
    await page.evaluate(KIT);
    await page.evaluate(values => PressKit.set(values), DEFAULTS);
    const variants = await page.evaluate(() => CAM_FAMILIES.PRENSA.variants.map(v => v.id));
    assert.deepEqual(variants, ['CMYK', 'DIARIO', 'RISO']);
    const first = await page.evaluate(() => { PressKit.print(PressKit.field('#808080'), 'CMYK'); return flipPress.state(); });
    assert.ok(first.ready && !first.failed, 'PRENSA pinta en la gráfica: ' + JSON.stringify(first));

    // ── 1 · Tono ──
    const tone = await page.evaluate(vs => Object.fromEntries(vs.map(v => [v, [255, 204, 153, 102, 51, 0].map(g => PressKit.stats(PressKit.print(PressKit.field(`rgb(${g},${g},${g})`), v)).luma)])), variants);
    for (const v of variants) {
      const ls = tone[v];
      for (let i = 1; i < ls.length; i++) assert.ok(ls[i] < ls[i - 1] - 0.02, v + ': cada gris más oscuro lleva más tinta ' + ls);
      assert.ok(ls[0] > 0.8, v + ': el blanco es papel limpio ' + ls[0]);
      assert.ok(ls[5] < (v === 'RISO' ? 0.42 : 0.2), v + ': el negro se llena de tinta ' + ls[5]);
    }
    step('tono: del papel limpio a la tinta llena, sin saltos', tone);

    // ── 2 · Color ──
    const colour = await page.evaluate(() => {
      const mean = (c, v) => PressKit.stats(PressKit.print(PressKit.field(c), v));
      return { red: mean('#d02a20', 'CMYK'), green: mean('#28a048', 'CMYK'), blue: mean('#2848c8', 'CMYK'), yellow: mean('#f0d020', 'CMYK'), gray: mean('#808080', 'CMYK'), paper: mean('#ffffff', 'CMYK'),
        news: mean('#808080', 'DIARIO'), risoWarm: mean('#e0a080', 'RISO'), risoCool: mean('#5078a0', 'RISO') };
    });
    const [rr, rg, rb] = colour.red.rgb, [gr, gg, gb] = colour.green.rgb, [br, bg, bb] = colour.blue.rgb, [yr, yg, yb] = colour.yellow.rgb, [nr, ng, nb] = colour.gray.rgb, [pr, pg, pb] = colour.paper.rgb;
    assert.ok(rr > rg + 50 && rr > rb + 50, 'un rojo sale rojo: ' + colour.red.rgb);
    assert.ok(gg > gr + 25 && gg > gb + 25, 'un verde sale verde: ' + colour.green.rgb);
    assert.ok(bb > br + 40 && bb > bg + 15, 'un azul sale azul: ' + colour.blue.rgb);
    assert.ok(yr > yb + 80 && yg > yb + 80, 'un amarillo sale amarillo: ' + colour.yellow.rgb);
    // El gris no se tiñe más de lo que tiñe el papel.
    assert.ok(Math.abs((nr - nb) - (pr - pb) * nr / pr) < 26 && Math.abs(nr - ng) < 22, 'un gris sale gris: ' + colour.gray.rgb + ' sobre papel ' + colour.paper.rgb);
    assert.ok(colour.news.vivid < 0.01, 'DIARIO es de una tinta: sin píxeles de color (' + colour.news.vivid + ')');
    assert.ok(colour.news.dark > 0.25 && colour.news.dark < 0.75 && colour.news.mid < 0.3, 'DIARIO, a medio gris: tinta o papel, poco intermedio ' + JSON.stringify(colour.news));
    assert.ok(colour.risoWarm.rgb[0] > colour.risoWarm.rgb[2] + 15 && colour.risoCool.rgb[2] > colour.risoCool.rgb[0] + 15, 'RISO: lo cálido tira a la tinta viva y lo frío a la oscura ' + colour.risoWarm.rgb + ' / ' + colour.risoCool.rgb);
    step('color: los primarios sobreviven a la separación; DIARIO, una tinta', { rojo: colour.red.rgb, verde: colour.green.rgb, azul: colour.blue.rgb, gris: colour.gray.rgb, papel: colour.paper.rgb });

    // ── 3 · El punto ──
    const dot = await page.evaluate(() => {
      const gray = PressKit.field('#808080');
      const runs = [2, 6].map(size => { PressKit.set({ pressDot: size }); return PressKit.run(PressKit.print(gray, 'DIARIO')); });
      PressKit.set({ pressDot: 3 });
      const scene = PressKit.field(PressKit.scene, 1280, 960);
      const small = PressKit.print(scene, 'CMYK', { w: 720, h: 540 }), big = PressKit.print(scene, 'CMYK', { w: 1440, h: 1080, path: 'capture' });
      const again = PressKit.print(scene, 'CMYK', { w: 720, h: 540 });
      const a = small.getContext('2d').getImageData(0, 0, 720, 540).data, b = again.getContext('2d').getImageData(0, 0, 720, 540).data;
      let same = 0; for (let i = 0; i < a.length; i += 4) if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) same++;
      return { runs, cells: [flipPress.cell(3, 'CMYK', 720), flipPress.cell(3, 'CMYK', 1440)], photo: PressKit.corr(PressKit.coarse(small, 180, 135), PressKit.coarse(big, 180, 135)), runSmall: PressKit.run(small), runBig: PressKit.run(big), same: same / (a.length / 4),
        faithful: PressKit.corr(PressKit.coarse(small), PressKit.coarse(scene)), state: flipPress.state() };
    });
    assert.ok(dot.runs[1] > dot.runs[0] * 1.5, 'PUNTO más alto, punto más grande: ' + dot.runs);
    assert.ok(Math.abs(dot.cells[1] / dot.cells[0] - 2) < 0.01, 'el punto es proporcional al ancho de la imagen');
    assert.ok(dot.photo > 0.9, 'la foto grande es el visor ampliado: ' + dot.photo);
    assert.ok(dot.runBig > dot.runSmall * 1.6, 'en la foto grande el punto mide el doble de píxeles: ' + dot.runSmall + ' → ' + dot.runBig);
    assert.equal(dot.same, 1, 'con la imagen quieta, dos cuadros son idénticos');
    assert.ok(dot.faithful > 0.85, 'la imagen impresa se parece a la escena: ' + dot.faithful);
    step('punto: sigue a la perilla, es proporcional y no baila', { tramos: dot.runs, foto: dot.photo, parecido: dot.faithful });

    // ── 4 · Registro y espejo ──
    const reg = await page.evaluate(() => {
      const edge = PressKit.field((g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000'; g.fillRect(w * 0.4, 0, w * 0.2, h); });
      const fringe = value => { PressKit.set({ pressReg: value }); return PressKit.stats(PressKit.print(edge, 'CMYK')).vivid; };
      const out = { square: fringe(0), off: fringe(100) };
      PressKit.set({ pressReg: 0 });
      const scene = PressKit.field(PressKit.scene);
      out.mirror = PressKit.corr(PressKit.coarse(PressKit.print(scene, 'DIARIO', { mirror: true })), PressKit.coarse(PressKit.print(scene, 'DIARIO'), 48, 36, true));
      out.notSame = PressKit.corr(PressKit.coarse(PressKit.print(scene, 'DIARIO', { mirror: true })), PressKit.coarse(PressKit.print(scene, 'DIARIO')));
      return out;
    });
    // A registro solo queda el gris del propio borde, que se imprime con puntos de color.
    assert.ok(reg.square < 0.02, 'con las planchas a registro, un borde negro apenas tiene color: ' + reg.square);
    assert.ok(reg.off > reg.square * 2.5 && reg.off > reg.square + 0.015, 'descuadradas, asoman las tintas: ' + reg.square + ' → ' + reg.off);
    assert.ok(reg.mirror > 0.97 && reg.notSame < 0.9, 'el espejo es espejo: ' + reg.mirror + ' / ' + reg.notSame);
    step('registro y espejo', reg);

    // ── 5 · En la app: bandeja, consola y pantallita ──
    await page.evaluate(values => PressKit.set(values), DEFAULTS);
    const tile = page.locator('#deckLooks .look[data-family="PRENSA"]');
    await tile.scrollIntoViewIfNeeded();
    await tile.click();
    await page.waitForFunction(() => camFamily === 'PRENSA' && flipPress.state().mode === 'CMYK');
    await page.waitForTimeout(500);
    const live = await page.evaluate(() => ({ lcd: document.getElementById('lcdLook').textContent, thumb: getComputedStyle(document.querySelector('#deckLooks .look[data-family="PRENSA"]').firstChild).backgroundImage, stats: PressKit.stats(display), fps: camFpsTarget }));
    assert.match(live.lcd, /PRENSA/i);
    assert.match(live.thumb, /look-PRENSA\.webp/);
    assert.ok(live.stats.vivid > 0.05, 'el visor está impreso a color: ' + JSON.stringify(live.stats));
    if (shots) await page.screenshot({ path: path.join(shots, 'prensa-cmyk.png') });
    await page.locator('#deckAdjust').click();
    await page.waitForFunction(() => flipConsole.state().open);
    const knobsOf = () => page.evaluate(() => flipConsole.state().knobs.filter(k => /^press/.test(k.id)).map(k => k.label));
    assert.deepEqual(await knobsOf(), ['PUNTO', 'TINTA', 'PAPEL', 'REGISTRO'], 'CMYK: cuatro perillas');
    const knob = await page.evaluateHandle(() => flipConsole.knob('pressDot'));
    const box = await knob.asElement().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, { steps: 8 });
    const lcd = await page.evaluate(() => document.getElementById('lcdParam').textContent + ' ' + document.getElementById('lcdValue').textContent);
    await page.mouse.up();
    const turned = await page.evaluate(() => pressDotVal);
    assert.ok(turned > 3, 'girar PUNTO lo sube: ' + turned);
    assert.match(lcd, /^PUNTO /, 'la pantallita dice qué se mueve: ' + lcd);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { camVariant = 'DIARIO'; _applyCamState(); flipConsole.sync && flipConsole.sync(); });
    await page.locator('#deckAdjust').click();
    await page.waitForFunction(() => flipConsole.state().open);
    assert.deepEqual(await knobsOf(), ['PUNTO', 'TINTA', 'PAPEL'], 'DIARIO: sin registro (una sola plancha)');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { camVariant = 'RISO'; _applyCamState(); });
    await page.locator('#deckAdjust').click();
    await page.waitForFunction(() => flipConsole.state().open);
    assert.deepEqual(await knobsOf(), ['PUNTO', 'TINTA', 'PAPEL', 'REGISTRO', 'TINTAS'], 'RISO: además, el par de tintas');
    const pairs = await page.evaluate(() => { const seen = []; for (let i = 0; i < 4; i++) { PressKit.set({ pressPair: i }); seen.push(document.getElementById('vPressPair').textContent); } return seen; });
    assert.equal(new Set(pairs).size, 4, 'cuatro pares de tintas: ' + pairs);
    await page.keyboard.press('Escape');
    if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(shots, 'prensa-riso.png') }); }
    step('bandeja, consola y pantallita', { pantallita: lcd, cadencia: live.fps, pares: pairs });

    // ── 6 · La foto sale como el visor ──
    await page.evaluate(() => { PressKit.set({ pressPair: 0, pressDot: 4 }); camVariant = 'CMYK'; _applyCamState(); });
    await page.waitForTimeout(600);
    const visor = await page.evaluate(() => PressKit.coarse(display, 64, 48));
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('#deckShutter').click()]);
    const match = await page.evaluate(async ({ bytes, visor }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return { corr: PressKit.corr(visor, PressKit.coarse(canvas, 64, 48)), size: [bitmap.width, bitmap.height], vivid: PressKit.stats(canvas).vivid };
    }, { bytes: fs.readFileSync(await download.path()).toString('base64'), visor });
    assert.ok(match.corr > 0.9 && match.vivid > 0.05, 'la foto coincide con el visor: ' + JSON.stringify(match));
    step('la foto sale como el visor', match);

    // ── 7 · Se conserva; la gráfica se suelta y vuelve; sin WebGL, punto a una tinta ──
    await page.evaluate(() => PressKit.set({ pressPaper: 80, pressReg: 40, pressPair: 2 }));
    await page.reload();
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    const kept = await page.evaluate(() => ({ family: camFamily, variant: camVariant, dot: pressDotVal, paper: pressPaperVal, reg: pressRegVal, pair: pressPairVal, label: document.getElementById('vPressPair').textContent }));
    assert.deepEqual(kept, { family: 'PRENSA', variant: 'CMYK', dot: 4, paper: 80, reg: 40, pair: 2, label: 'VERDE·NARANJA' }, 'el ajuste se conserva');
    const back = await page.evaluate(async () => {
      flipPress.release();
      const released = flipPress.state().ready;
      await new Promise(resolve => setTimeout(resolve, 400));
      return { released, ready: flipPress.state().ready, vivid: PressKit.stats(display).vivid };
    });
    assert.ok(!back.released && back.ready && back.vivid > 0.05, 'la gráfica se suelta y se rehace sola: ' + JSON.stringify(back));
    const plain = await page.evaluate(async () => {
      const real = window.renderPress;
      window.renderPress = () => false;
      await new Promise(resolve => setTimeout(resolve, 500));
      const stats = PressKit.stats(display);
      const d = ctxD.getImageData(0, 0, display.width, display.height).data, colours = new Set();
      for (let i = 0; i < d.length; i += 16) colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      window.renderPress = real;
      return { vivid: stats.vivid, colours: colours.size, trama: dsiTramaVal };
    });
    // (el motor de DSi: papel, tinta y lo que añade su rejilla; la impresión en gráfica tiene miles de tonos)
    assert.ok(plain.colours <= 8, 'sin WebGL queda el punto a una tinta: ' + JSON.stringify(plain));
    step('se conserva; la gráfica vuelve; sin WebGL, punto a una tinta', { ...kept, sinGrafica: plain.colours + ' colores' });

    await page.evaluate(values => { PressKit.set(values); _setCamFamily('DSI'); }, { ...DEFAULTS, pressReg: 15 });
    assert.deepEqual(errors, [], 'sin errores de página');
    console.log('PRESS PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error('PRESS FAIL\n', error); process.exit(1); });
