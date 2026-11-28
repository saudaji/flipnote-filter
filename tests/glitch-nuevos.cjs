// GLITCH: tres procesos nuevos — ARRASTRE (las luces se corren en hebras horizontales), CHISPA
// (destellos en lo claro) y TRAMA RGB (tramado ordenado por canal, cada canal con su desfase).
// Lo que tiene que seguir siendo verdad, medido:
//   · con los tres a cero GLITCH pinta exactamente lo de siempre (con otros mandos puestos, también);
//   · TRAMA RGB a un cuarto de tono deja solo rojo, verde y azul puros y negro: ningún punto con dos
//     canales encendidos (sin barro amarillo, cian ni blanco);
//   · CHISPA enciende crucecitas solo en lo claro y cambian a saltos;
//   · ARRASTRE corre en horizontal lo que pasa del umbral de luz, y lo oscuro no se mueve;
//   · los tres están en el panel de GLITCH y en las capas GLITCH de EDIT (las de antes cargan a cero).
//   FLIP_URL=http://127.0.0.1:8760 node tests/glitch-nuevos.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForFunction(() => typeof _applyScrash === 'function' && vid.videoWidth > 0);
    await page.evaluate(() => {
      const W = 320, H = 240;
      window.__g = {
        W, H,
        canvas(paint) { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); paint(x); return x; },
        apply(src, p) { const dst = __g.canvas(() => {}); _applyScrash(src, dst, W, H, 1.5, null, { chroma: 0, drip: 0, neon: 0, wave: 0, crush: 0, hue: 0, grain: 0, chaos: 0, audioReact: 100, animate: false, speed: 5, ...p }); return dst.getImageData(0, 0, W, H).data; },
        same(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; },
      };
    });

    // ── 1 · A cero, lo de siempre ──
    const zero = await page.evaluate(() => {
      const room = __g.canvas(x => FlipScenes.draw(x, __g.W, __g.H, 'roomLit', 0, {}));
      const src = room.getImageData(0, 0, __g.W, __g.H).data;
      const det = { chroma: 6, neon: 40, wave: 5, crush: 20, hue: 90 };      // (mandos que no usan azar)
      return {
        copia: __g.same(__g.apply(room, { smear: 0, spark: 0, rgb: 0 }), src),
        conMandos: __g.same(__g.apply(room, { ...det, smear: 0, spark: 0, rgb: 0 }), __g.apply(room, det)),
        // la ruta de los deslizadores globales (pestaña GLITCH)
        globales: (() => { scrNeonVal = 40; scrHueVal = 90; const dst = __g.canvas(() => {}); _applyScrash(room, dst, __g.W, __g.H, 1.5, null); const a = dst.getImageData(0, 0, __g.W, __g.H).data; scrNeonVal = 0; scrHueVal = 0; return __g.same(a, __g.apply(room, { neon: 40, hue: 90 })); })(),
      };
    });
    assert.deepEqual(zero, { copia: true, conMandos: true, globales: true }, 'a cero no cambian nada: ' + JSON.stringify(zero));
    step('con los tres a cero, GLITCH pinta lo de siempre', zero);

    // ── 2 · TRAMA RGB ──
    const rgb = await page.evaluate(() => {
      const gray = v => __g.canvas(x => { x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(0, 0, __g.W, __g.H); });
      const count = d => { const k = { negro: 0, r: 0, g: 0, b: 0, mezcla: 0, otros: 0 }; for (let i = 0; i < d.length; i += 4) { const on = [d[i], d[i + 1], d[i + 2]].map(v => v === 255 ? 1 : v === 0 ? 0 : -1); if (on.includes(-1)) k.otros++; else { const n = on[0] + on[1] + on[2]; if (n === 0) k.negro++; else if (n > 1) k.mezcla++; else if (on[0]) k.r++; else if (on[1]) k.g++; else k.b++; } } const n = d.length / 4; for (const key in k) k[key] = +(k[key] / n).toFixed(3); return k; };
      return { cuarto: count(__g.apply(gray(64), { rgb: 100 })), medio: count(__g.apply(gray(128), { rgb: 100 })), mitad: count(__g.apply(gray(64), { rgb: 50 })) };
    });
    assert.equal(rgb.cuarto.otros, 0, 'a tope, cada canal a un bit');
    assert.equal(rgb.cuarto.mezcla, 0, 'a un cuarto de tono, ningún punto con dos canales: ' + JSON.stringify(rgb.cuarto));
    for (const c of ['r', 'g', 'b', 'negro']) assert.ok(Math.abs(rgb.cuarto[c] - 0.25) < 0.02, 'un cuarto rojo, un cuarto verde, un cuarto azul y un cuarto negro: ' + JSON.stringify(rgb.cuarto));
    assert.ok(rgb.mitad.otros > 0.9, 'a medias, mezcla con la imagen: ' + JSON.stringify(rgb.mitad));
    step('TRAMA RGB: puntos rojos, verdes y azules puros sobre negro', rgb.cuarto);

    // ── 3 · CHISPA ──
    const spark = await page.evaluate(() => {
      // mitad izquierda oscura, derecha clara
      const src = __g.canvas(x => { x.fillStyle = '#202020'; x.fillRect(0, 0, __g.W, __g.H); x.fillStyle = '#d8d8d8'; x.fillRect(__g.W / 2, 0, __g.W / 2, __g.H); });
      const base = src.getImageData(0, 0, __g.W, __g.H).data;
      const lit = d => { let l = 0, r = 0; for (let y = 0; y < __g.H; y++) for (let x = 0; x < __g.W; x++) { const i = 4 * (y * __g.W + x); if (d[i + 2] > base[i + 2] + 15) { if (x < __g.W / 2) l++; else r++; } } return [l, r]; };
      const frames = [];
      for (let i = 0; i < 9; i++) frames.push(__g.apply(src, { spark: 100 }));
      const keys = frames.map(d => { let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i + 2]) >>> 0; return h; });
      return { oscuroClaro: lit(frames[0]), saltos: new Set(keys).size, ceros: __g.same(__g.apply(src, { spark: 0 }), base) };
    });
    assert.equal(spark.oscuroClaro[0], 0, 'en lo oscuro, ningún destello: ' + spark.oscuroClaro);
    assert.ok(spark.oscuroClaro[1] > 60, 'en lo claro, destellos: ' + spark.oscuroClaro);
    assert.ok(spark.saltos >= 2 && spark.saltos <= 4, 'cambian a saltos (cada tres cuadros), no en cada cuadro: ' + spark.saltos);
    step('CHISPA: destellos solo en lo claro, a saltos', spark);

    // ── 4 · ARRASTRE ──
    const smear = await page.evaluate(() => {
      // fondo oscuro con puntos claros en una columna, y una franja gris (bajo el umbral) al lado
      const src = __g.canvas(x => { x.fillStyle = '#101010'; x.fillRect(0, 0, __g.W, __g.H); x.fillStyle = '#ffffff'; for (let y = 0; y < __g.H; y += 2) x.fillRect(160, y, 3, 2); x.fillStyle = '#505050'; x.fillRect(40, 0, 6, __g.H); });
      const base = src.getImageData(0, 0, __g.W, __g.H).data;
      let rows = 0, longest = 0, grayMoved = 0;
      for (let k = 0; k < 6; k++) {
        const d = __g.apply(src, { smear: 100 });
        for (let y = 0; y < __g.H; y++) {
          let run = 0;
          for (const dir of [1, -1]) { let n = 0; for (let x = dir > 0 ? 163 : 159; x >= 0 && x < __g.W; x += dir) { const i = 4 * (y * __g.W + x); if (d[i] > 60) n++; else break; } run = Math.max(run, n); }
          if (run > 4) rows++;
          longest = Math.max(longest, run);
        }
      }
      // una escena sin nada que pase del umbral (solo la franja gris): no se mueve ni un punto
      const dim = __g.canvas(x => { x.fillStyle = '#101010'; x.fillRect(0, 0, __g.W, __g.H); x.fillStyle = '#505050'; x.fillRect(40, 0, 6, __g.H); });
      const dimBase = dim.getImageData(0, 0, __g.W, __g.H).data;
      for (let k = 0; k < 6; k++) { const d = __g.apply(dim, { smear: 100 }); for (let i = 0; i < d.length; i++) if (d[i] !== dimBase[i]) grayMoved++; }
      return { filasConHebra: rows, hebraMasLarga: longest, grisMovido: grayMoved, ceros: __g.same(__g.apply(src, { smear: 0 }), base) };
    });
    assert.ok(smear.filasConHebra > 20 && smear.hebraMasLarga > 15, 'las luces se corren en hebras horizontales: ' + JSON.stringify(smear));
    assert.equal(smear.grisMovido, 0, 'lo que no pasa del umbral de luz no se mueve');
    step('ARRASTRE: hebras horizontales desde lo claro', smear);

    // ── 5 · En el panel de GLITCH y en EDIT ──
    const ui = await page.evaluate(() => {
      const el = id => document.getElementById(id);
      const out = { ids: ['scrSmear', 'scrSpark', 'scrRgb'].map(id => !!el(id)) };
      el('scrRgb').value = 70; el('scrRgb').dispatchEvent(new Event('input'));
      out.global = scrRgbVal;
      el('btnScrashReset').click();
      out.reset = [scrSmearVal, scrSparkVal, scrRgbVal];
      out.editDefault = ['smear', 'spark', 'rgb'].map(k => _editDefaultGlitchParams()[k]);
      out.editOld = ['smear', 'spark', 'rgb'].map(k => _editClampGlitchParams({ chroma: 3 })[k]);
      out.editClamp = _editClampGlitchParams({ smear: 400, spark: -3, rgb: 55 });
      return out;
    });
    assert.deepEqual(ui.ids, [true, true, true]);
    assert.equal(ui.global, 70);
    assert.deepEqual(ui.reset, [0, 0, 0], 'Reset los pone a cero');
    assert.deepEqual(ui.editDefault, [0, 0, 0]);
    assert.deepEqual(ui.editOld, [0, 0, 0], 'una capa GLITCH de antes carga con los tres a cero');
    assert.deepEqual([ui.editClamp.smear, ui.editClamp.spark, ui.editClamp.rgb], [100, 0, 55]);
    step('los tres en el panel de GLITCH y en las capas de EDIT', ui.reset);

    assert.deepEqual(errors, [], 'sin errores de página');
    console.log('GLITCH NUEVOS PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
