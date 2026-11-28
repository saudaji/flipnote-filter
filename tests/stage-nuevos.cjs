// STAGE · lo nuevo (docs/stage.js): paleta ESPECTRO, lazo SELLO con TRAMA RGB (escena GUSANO), CHISPA,
// ARRASTRE, fuentes FAMILIA:VARIANTE y las diez escenas. Cada paso mide algo que no sale por casualidad,
// sobre una carta dibujada que entra como cámara (rampa de grises, disco blanco, cuadros de gris, una zona
// oscura y una con crestas de luz), y lo nuevo en cero tiene que dar la imagen de antes, píxel a píxel.
//   FLIP_URL=http://127.0.0.1:8760 node tests/stage-nuevos.cjs [carpeta-de-evidencia]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { launch, openFlip, openModule, stageTab, saveDataUrl, ENGINE } = require('./lib/harness.cjs');
const out = process.argv[2];
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${(+a).toFixed(3)} frente a ${b} (±${tol})`);
// STAGE tal como estaba antes de estos mandos: la referencia de «lo nuevo en cero no cambia nada».
const REF = 'f37d986';

// Los ganchos de prueba que la versión de antes no tenía (los mismos que trae la nueva).
const HOOKS = `
    rewind() {
      clock.t = 0; clock.beat = 0; ph.gen = ph.spin = ph.cycle = ph.roll = ph.warp = 0; ph.lfo[0] = ph.lfo[1] = 0;
      for (const memo of ph.rnd) Object.assign(memo, { cycle: -1, from: 0, to: 0 });
      audio.beat = 0; midi.hit = 0; morph = null;
      if (!eng.ok) return;
      const gl = eng.gl;
      for (const b of eng.fb) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      eng.flip = 0;
    },
    pixels() {
      if (!eng.ok) return null;
      const gl = eng.gl;
      draw(evaluate(), 0, clock.t);
      const data = new Uint8Array(eng.w * eng.h * 4);
      gl.readPixels(0, 0, eng.w, eng.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
      return { w: eng.w, h: eng.h, data: btoa(bin) };
    },
`;

async function boot(page) {
  await page.locator('#btnSplashOriginal').click();
  await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
}
async function enterStage(page) {
  await page.evaluate(() => { localStorage.removeItem('flip.stage.v3'); flipStage.reset(); });
  await openModule(page, 'stage');
  await page.waitForFunction(() => flipStage.status().hasA, null, { timeout: 15000 });
}

// Utilidades en la página: la carta como cámara, la salida en píxeles y un estado neutro.
async function kit(page) {
  await page.evaluate(() => {
    const W = 960, H = 540;
    const card = () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      if (typeof facingMode === 'string' && facingMode === 'user') { x.translate(W, 0); x.scale(-1, 1); }   // (la frontal va en espejo: la carta sale derecha)
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
      const g = x.createLinearGradient(0, 40, 0, 500); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
      x.fillStyle = g; x.fillRect(40, 40, 160, 460);                                   // rampa de grises, de arriba abajo
      x.fillStyle = 'rgb(14,14,14)'; x.fillRect(240, 40, 160, 160);                     // zona oscura
      x.fillStyle = '#fff'; x.beginPath(); x.arc(480, 270, 64, 0, Math.PI * 2); x.fill(); // disco blanco
      x.fillRect(640, 60, 16, 16);                                                      // cuadrito blanco, solo en su franja
      x.fillStyle = 'rgb(64,64,64)'; x.fillRect(600, 230, 100, 100);                    // gris a un cuarto
      x.fillStyle = 'rgb(128,128,128)'; x.fillRect(600, 380, 100, 100);                 // gris medio
      x.fillStyle = 'rgb(180,180,180)'; x.fillRect(760, 300, 160, 160);                 // zona clara con crestas
      x.fillStyle = '#fff'; for (let yy = 306; yy < 456; yy += 16) for (let xx = 766; xx < 916; xx += 16) x.fillRect(xx, yy, 3, 3);
      return new Uint8Array(x.getImageData(0, 0, W, H).data.buffer);
    };
    window.__nv = {
      W, H,
      inject() { flipStage.camera.inject({ kind: 'rgba', format: 'RGBA', width: W, height: H, data: card(), layout: [{ offset: 0, stride: W * 4 }], matrix: 'smpte170m', fullRange: false, seq: 4242, at: performance.now() }); },
      // (una cámara en negro: lo que se vea es solo de la escena)
      dark() { flipStage.camera.inject({ kind: 'rgba', format: 'RGBA', width: W, height: H, data: new Uint8Array(W * H * 4), layout: [{ offset: 0, stride: W * 4 }], matrix: 'smpte170m', fullRange: false, seq: 4343, at: performance.now() }); },
      // bloques de 2 × 2 celdas (16 × 10 px) con luz en al menos un 15 % de sus píxeles
      blocks(g) {
        const bw = 16, bh = 10, cols = Math.floor(g.w / bw), rows = Math.floor(g.h / bh), map = new Uint8Array(cols * rows);
        for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
          let n = 0;
          for (let y = by * bh; y < by * bh + bh; y++) for (let x = bx * bw; x < bx * bw + bw; x++) { const i = g.at(x, y); if (Math.max(g.d[i], g.d[i + 1], g.d[i + 2]) > 30) n++; }
          map[by * cols + bx] = n > bw * bh * .15 ? 1 : 0;
        }
        return { map, cols, rows };
      },
      // un cuadro de gusano: cobertura por bloques, menta, cruces por corte y costillas (franjas finas de
      // puntos separadas por negro, contadas a lo largo de columnas cada 8 px, en pasos de 2 px)
      worm(g) {
        const { map, cols, rows } = __nv.blocks(g);
        let on = 0, mint = 0, ribs = 0, lines = 0;
        for (const m of map) on += m;
        for (let y = 0; y < g.h; y += 2) for (let x = 0; x < g.w; x += 2) { const i = g.at(x, y); if (g.d[i + 1] > 180 && g.d[i] > 20 && g.d[i] < 110 && g.d[i + 2] > 100 && g.d[i + 2] < 200) mint++; }
        for (let x = 4; x < g.w; x += 8) { let last = -1; lines++; for (let y = 0; y < g.h; y += 2) { const i = g.at(x, y), lit = Math.max(g.d[i], g.d[i + 1], g.d[i + 2]) > 60 ? 1 : 0; if (last >= 0 && lit !== last) ribs++; last = lit; } }
        const cut = across => { const n = across ? rows : cols, len = across ? cols : rows, out = []; for (let k = 0; k < n; k++) { let t = 0; for (let j = 1; j < len; j++) { const p = across ? map[k * cols + j] : map[j * cols + k], q = across ? map[k * cols + j - 1] : map[(j - 1) * cols + k]; if (p !== q) t++; } out.push(t); } return { mean: out.reduce((a, b) => a + b, 0) / n, multi: out.filter(t => t >= 4).length / n }; };
        // (y, píxel a píxel cada 4 px, qué tiene luz: la cobertura fina y lo que cambia entre dos cuadros)
        const px = [];
        let lit = 0;
        for (let y = 0; y < g.h; y += 4) for (let x = 0; x < g.w; x += 4) { const i = g.at(x, y), l = Math.max(g.d[i], g.d[i + 1], g.d[i + 2]) > 60 ? 1 : 0; px.push(l); lit += l; }
        return { map: Array.from(map), px, cover: on / map.length, lit: lit / px.length, mint: mint / (g.w * g.h / 4), ribs: ribs / lines, rows: cut(true), cols: cut(false) };
      },
      moved: (a, b) => a.map.reduce((n, m, i) => n + (m !== b.map[i] ? 1 : 0), 0) / a.map.length,
      changed: (a, b) => a.px.reduce((n, m, i) => n + (m !== b.px[i] ? 1 : 0), 0) / a.px.length,
      // escalones de matiz distintos a lo largo de una línea (tramos de 4 px o más)
      bandsOn(g, y, x0, x1) {
        let runs = 0, last = -1, len = 0;
        for (let x = x0; x < x1; x++) {
          const h = __nv.hue(g, x, y), q = h < 0 ? -1 : Math.round(h * 12) % 12;
          if (q === last) { len++; if (len === 4 && q >= 0) runs++; } else { last = q; len = 1; }
        }
        return runs;
      },
      // reparto del matiz de lo que tiene color en seis sectores
      sectors(g, box) {
        const n = [0, 0, 0, 0, 0, 0]; let all = 0;
        for (let y = box[1]; y < box[3]; y += 2) for (let x = box[0]; x < box[2]; x += 2) { const h = __nv.hue(g, x, y); if (h >= 0) { n[Math.min(5, Math.floor(h * 6))]++; all++; } }
        return { full: n.filter(k => k / Math.max(1, all) >= .08).length, all, share: n.map(k => +(k / Math.max(1, all)).toFixed(2)) };
      },
      // matiz de cada píxel con color (máximo > 60), de 0 a 1
      hue(g, x, y) {
        const i = g.at(x, y), r = g.d[i], gg = g.d[i + 1], b = g.d[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        if (mx < 60 || mx - mn < 40) return -1;
        const d = mx - mn, h = mx === r ? (gg - b) / d : mx === gg ? 2 + (b - r) / d : 4 + (r - gg) / d;
        return Math.min(.999999, ((h < 0 ? h + 6 : h) + 1e-6) / 6);    // (sin «% 1»: 2/6 % 1 da 0,3333…26 y el verde puro caía en el sector de antes)
      },
      grab() {
        const p = flipStage.pixels(), bin = atob(p.data), d = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
        return { w: p.w, h: p.h, d, at: (x, y) => ((p.h - 1 - y) * p.w + x) * 4 };      // (x, y) desde arriba a la izquierda
      },
      neutral() {
        flipStage.reset(); flipStage.set('out.quality', 1); flipStage.recall(0, true);
        for (const r of flipStage.status().routes) flipStage.route(r[0], r[1], 0);
        for (const id of ['sig.scan', 'sig.rgb']) flipStage.set(id, 0);
        flipStage.set('col.sat', .5); flipStage.set('col.con', .5);
      },
      luma: (d, i) => (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) / 255,
    };
  });
}

// 1 · Lo nuevo en cero: las ocho escenas de fábrica y los mandos de antes dan la misma imagen que STAGE
// antes de este cambio (sacado de git), píxel a píxel, con el mismo reloj y la misma carta.
async function identity(browser) {
  let old = '';
  try { old = execFileSync('git', ['show', REF + ':docs/stage.js'], { cwd: path.join(__dirname, '..'), maxBuffer: 1 << 24 }).toString(); }
  catch (_) { console.log('aviso: sin git o sin ' + REF + ', no se compara con la versión de antes'); return null; }
  if (!old.includes('rewind()')) old = old.replace('    tables: {', HOOKS + '    tables: {');
  const states = [
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(scene => ({ scene })),
    { scene: 0, set: { 'sig.rgb': .6, 'sig.tear': .5, 'sig.bleed': .8, 'sig.pix': .3, 'sig.scan': .6, 'sig.noise': .3, 'sig.vhold': .62, 'sig.strobe': .2 } },
    { scene: 0, set: { 'col.tint': 1, 'col.pal': 3, 'col.solar': .6, 'col.post': .5, 'col.hue': .3, 'col.cycle': .7, 'col.sat': .8, 'col.con': .7 } },
    { scene: 0, set: { 'col.tint': .7, 'col.pal': 6, 'col.inv': 1, 'geo.kal': .5, 'geo.mirror': 3, 'geo.warp': .5 } },
    { scene: 1, set: { 'fb.mode': 0, 'fb.x': .7, 'fb.y': .35, 'fb.hue': .4 } },
    { scene: 2, set: { 'fb.mode': 2, 'fb.decay': .95, 'fb.rot': .7 } },
  ];
  const render = async source => {
    // (sin service worker: si no, la recarga podría salir de su caché y saltarse la versión pedida)
    const { page, context, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 }, boot: false, context: { serviceWorkers: 'block' } });
    if (source) await context.route('**/stage.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: source }));
    await page.reload();
    await boot(page);
    await enterStage(page);
    await kit(page);
    // (que de verdad corre la versión pedida: la de antes no tenía SELLO)
    assert.equal(await page.evaluate(() => !!flipStage.tables.FB_MODES), !source, source ? 'corre la versión de antes' : 'corre la versión nueva');
    const frames = await page.evaluate(states => {
      __nv.inject();
      return states.map(s => {
        flipStage.reset(); flipStage.set('out.quality', 1); flipStage.recall(s.scene, true);
        for (const [id, v] of Object.entries(s.set || {})) flipStage.set(id, v);
        flipStage.rewind(); flipStage.step(24, 1000 / 30);
        return flipStage.pixels().data;
      });
    }, states);
    await context.close();
    assert.deepEqual(errors, [], 'sin errores de página');
    return frames;
  };
  const before = await render(old), after = await render(null);
  const report = [];
  states.forEach((s, i) => {
    const a = Buffer.from(before[i], 'base64'), b = Buffer.from(after[i], 'base64');
    assert.equal(a.length, b.length);
    let differ = 0, worst = 0;
    for (let k = 0; k < a.length; k++) { const d = Math.abs(a[k] - b[k]); if (d) { differ++; if (d > worst) worst = d; } }
    report.push({ estado: i < 8 ? 'escena ' + (i + 1) : 'mandos ' + (i - 7), differ, worst });
  });
  for (const r of report) assert.ok(r.differ === 0, `${r.estado}: con lo nuevo en cero la imagen cambió (${r.differ} valores, hasta ${r.worst})`);
  return report.length;
}

async function phone(browser) {
  const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
  await enterStage(page);
  await kit(page);
  const result = {};

  // 2 · Las diez escenas: ESPECTRO y GUSANO después de PRUEBA, con sus cables al sonido.
  const tables = await page.evaluate(() => ({ factory: flipStage.tables.FACTORY, fb: flipStage.tables.FB_MODES, pal: flipStage.tables.PALETTES }));
  assert.deepEqual(tables.factory, ['VIVO', 'TÚNEL', 'MANDALA', 'SILUETA', 'VHS', 'NEÓN', 'ONDAS', 'PRUEBA', 'ESPECTRO', 'GUSANO']);
  assert.equal(tables.fb[3], 'SELLO'); assert.equal(tables.pal[7], 'ESPECTRO');
  const sound = await page.evaluate(() => {
    const read = (scene, ids) => {
      // (sin entrada de sonido, las bandas se quedan como estaban: el silencio se inyecta)
      flipStage.recall(scene, true); flipStage.audio.inject({ bass: 0, mid: 0, high: 0 }); flipStage.step(60);
      const quiet = Object.fromEntries(ids.map(id => [id, flipStage.value(id)]));
      flipStage.audio.inject({ bass: 1, mid: 1, high: 1, beat: 1 }); flipStage.step(1);
      const loud = Object.fromEntries(ids.map(id => [id, flipStage.value(id)]));
      flipStage.audio.inject(null); flipStage.step(60);
      return { quiet, loud, routes: flipStage.status().routes };
    };
    return { espectro: read(8, ['col.cycle', 'col.solar', 'sig.bleed', 'gen.freq', 'sig.spark', 'sig.smear']) };
  });
  // ESPECTRO: los graves corren las curvas, los medios suman vueltas, los agudos corren el croma, el golpe abre la clave.
  near(sound.espectro.loud['col.cycle'] - sound.espectro.quiet['col.cycle'], .25, .01, 'ESPECTRO: graves → CICLO');
  near(sound.espectro.loud['col.solar'] - sound.espectro.quiet['col.solar'], .3, .01, 'ESPECTRO: medios → vueltas');
  near(sound.espectro.loud['sig.bleed'] - sound.espectro.quiet['sig.bleed'], .35, .01, 'ESPECTRO: agudos → CROMA');
  near(sound.espectro.loud['gen.freq'] - sound.espectro.quiet['gen.freq'], .2, .01, 'ESPECTRO: el golpe hincha la salpicadura');
  assert.ok(sound.espectro.loud['sig.spark'] > .5 && sound.espectro.quiet['sig.spark'] < .01, 'ESPECTRO: el golpe enciende destellos ' + JSON.stringify(sound.espectro));
  near(sound.espectro.loud['sig.smear'] - sound.espectro.quiet['sig.smear'], .4, .01, 'ESPECTRO: los graves estiran las luces');
  // GUSANO: los graves lo empujan, los medios tuercen la trayectoria, los agudos espesan la trama, el golpe cambia la vértebra de color.
  // GUSANO no lleva cables: la cámara GUSANO oye lo que oye STAGE (se lo pasa con cada cuadro) y cada
  // golpe le turna el color de los tramos.
  const ear = await page.evaluate(async () => {
    flipStage.reset(); flipStage.recall(9, true); flipStage.audio.inject({ bass: 0, mid: 0, high: 0 });
    await new Promise(done => setTimeout(done, 800));
    const before = flipGusano.state().turno;
    flipStage.audio.inject({ bass: 1, mid: 0, high: 0, beat: 1 });
    await new Promise(done => setTimeout(done, 400));
    const after = flipGusano.state().turno;
    flipStage.audio.inject({ bass: 0, mid: 0, high: 0 });
    return { before, after, routes: flipStage.status().routes.length, look: flipStage.get('src.look') };
  });
  assert.equal(ear.look, 'GUSANO'); assert.equal(ear.routes, 0, 'GUSANO sin cables de STAGE');
  assert.ok(ear.after > ear.before, 'el golpe de STAGE llega a la cámara GUSANO y le turna el color: ' + JSON.stringify(ear));
  // los mandos nuevos son destinos de modulación como los demás
  const routed = await page.evaluate(() => {
    __nv.neutral(); flipStage.route('high', 'sig.spark', .5); flipStage.route('bass', 'sig.smear', .4); flipStage.route('beat', 'sig.dither', .6);
    flipStage.audio.inject({ bass: 1, mid: 0, high: 1, beat: 1 }); flipStage.step(1);
    const v = ['sig.spark', 'sig.smear', 'sig.dither'].map(id => +flipStage.value(id).toFixed(3));
    flipStage.audio.inject(null);
    return v;
  });
  assert.deepEqual(routed, [.5, .4, .6], 'CHISPA, ARRASTRE y TRAMA RGB siguen al sonido');

  // 3 · ESPECTRO sobre la rampa de grises: dos vueltas de matiz o más, y negro debajo de la clave.
  const spectral = await page.evaluate(() => {
    __nv.neutral(); __nv.inject();
    flipStage.set('col.pal', 7); flipStage.set('col.tint', 1); flipStage.set('col.solar', .3);
    flipStage.rewind(); flipStage.step(4);
    const g = __nv.grab(), hues = [], dark = [];
    for (let y = 44; y < 496; y++) {
      let r = 0, gg = 0, b = 0;
      for (let x = 110; x < 130; x++) { const i = g.at(x, y); r += g.d[i]; gg += g.d[i + 1]; b += g.d[i + 2]; }
      r /= 20; gg /= 20; b /= 20;
      const lum = (y - 40) / 460, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (lum < .07) dark.push(mx);
      if (mx > 40 && mx - mn > 30) {
        const d = mx - mn;
        let h = mx === r ? (gg - b) / d : mx === gg ? 2 + (b - r) / d : 4 + (r - gg) / d;
        hues.push(((h / 6) % 1 + 1) % 1);
      }
    }
    let turns = 0;
    for (let i = 1; i < hues.length; i++) { let d = hues[i] - hues[i - 1]; d -= Math.round(d); turns += Math.abs(d); }
    return { turns, colored: hues.length, darkMax: Math.max(...dark) };
  });
  assert.ok(spectral.turns >= 2, 'ESPECTRO: la rampa da dos vueltas de arcoíris o más: ' + JSON.stringify(spectral));
  assert.ok(spectral.colored > 300, 'ESPECTRO: casi toda la rampa sale en color: ' + spectral.colored);
  assert.ok(spectral.darkMax < 10, 'ESPECTRO: debajo de la clave, negro: ' + spectral.darkMax);
  result.espectro = +spectral.turns.toFixed(2);

  // 4 · TRAMA RGB: canales casi binarios y corridos entre sí (en el gris a un cuarto, puntos R, G, B y negros por igual).
  const dither = await page.evaluate(() => {
    __nv.neutral(); __nv.inject();
    flipStage.set('sig.dither', 1); flipStage.rewind(); flipStage.step(2);
    const g = __nv.grab(), stat = (x0, y0) => {
      let mid = 0, n = 0, eq = 0, only = [0, 0, 0];
      for (let y = y0 + 10; y < y0 + 90; y++) for (let x = x0 + 10; x < x0 + 90; x++) {
        const i = g.at(x, y), on = [g.d[i] > 127, g.d[i + 1] > 127, g.d[i + 2] > 127];
        for (let c = 0; c < 3; c++) if (g.d[i + c] > 30 && g.d[i + c] < 225) mid++;
        n++;
        if (on[0] === on[1] && on[1] === on[2]) eq++;
        for (let c = 0; c < 3; c++) if (on[c] && on.filter(Boolean).length === 1) only[c]++;
      }
      return { gris: mid / (3 * n), iguales: eq / n, soloR: only[0] / n, soloG: only[1] / n, soloB: only[2] / n };
    };
    return { cuarto: stat(600, 230), medio: stat(600, 380) };
  });
  for (const k of ['cuarto', 'medio']) assert.ok(dither[k].gris < .03, `TRAMA RGB (${k}): canales casi binarios, sin gris: ` + JSON.stringify(dither[k]));
  assert.ok(dither.cuarto.soloR > .15 && dither.cuarto.soloG > .15 && dither.cuarto.soloB > .15 && dither.cuarto.iguales < .4, 'TRAMA RGB: en el gris a un cuarto, puntos rojos, verdes y azules por separado: ' + JSON.stringify(dither.cuarto));
  assert.ok(dither.medio.iguales < .1, 'TRAMA RGB: los canales van corridos (sin el desfase, el gris saldría gris o blanco): ' + JSON.stringify(dither.medio));
  result.trama = dither.cuarto;

  // 5 · SELLO frente a ECO: el disco blanco, con deriva a la derecha, deja copias a su izquierda. En SELLO
  // conservan el escalón (contraste alto entre celdas vecinas); en ECO se emborronan en una estela suave.
  const loop = await page.evaluate(() => {
    const run = mode => {
      __nv.neutral(); __nv.inject();
      flipStage.set('mix.mode', 4); flipStage.set('mix.fade', 1); flipStage.set('src.gen', 0); flipStage.set('key.level', .6); flipStage.set('key.soft', .04);
      // (ECO a tope casi no deja entrar lo nuevo: al 95 % el disco ya se ve y su estela, también)
      flipStage.set('fb.mode', mode); flipStage.set('fb.amt', .95); flipStage.set('fb.decay', .9); flipStage.set('fb.x', .72); flipStage.set('fb.y', .5);
      flipStage.rewind(); flipStage.step(30, 1000 / 30);
      const g = __nv.grab();
      let diff = 0, steps = 0, lit = 0, n = 0;
      for (let y = 240; y < 300; y++) for (let x = 280; x < 400; x++) {
        const i = g.at(x, y), j = g.at(x + 8, y), k = g.at(x, y + 5);
        const d = (Math.abs(g.d[i] - g.d[j]) + Math.abs(g.d[i + 1] - g.d[j + 1]) + Math.abs(g.d[i + 2] - g.d[j + 2]) + Math.abs(g.d[i] - g.d[k]) + Math.abs(g.d[i + 1] - g.d[k + 1]) + Math.abs(g.d[i + 2] - g.d[k + 2])) / 6;
        diff += d; if (d > 60) steps++; if (__nv.luma(g.d, i) > .1) lit++; n++;
      }
      return { contraste: diff / n, escalones: steps / n, copia: lit / n };
    };
    return { sello: run(3), eco: run(0) };
  });
  assert.ok(loop.eco.copia > .3 && loop.sello.copia > .3, 'las dos dejan copias a la izquierda del disco: ' + JSON.stringify(loop));
  assert.ok(loop.sello.contraste > loop.eco.contraste * 3, 'SELLO conserva el escalón y ECO lo emborrona: ' + JSON.stringify(loop));
  assert.ok(loop.sello.escalones > .15 && loop.eco.escalones < .02, 'en SELLO las copias son franjas de borde duro: ' + JSON.stringify(loop));
  result.sello = { sello: +loop.sello.contraste.toFixed(1), eco: +loop.eco.contraste.toFixed(1) };
  // y dentro del lazo, la trama viaja sin volverse gris: tras 30 cuadros las copias siguen siendo puntos puros
  const worm = await page.evaluate(() => {
    __nv.neutral(); __nv.inject();
    flipStage.set('mix.mode', 4); flipStage.set('mix.fade', 1); flipStage.set('src.gen', 0); flipStage.set('key.level', .6);
    flipStage.set('fb.mode', 3); flipStage.set('fb.amt', 1); flipStage.set('fb.decay', .9); flipStage.set('fb.x', .72); flipStage.set('fb.y', .5); flipStage.set('sig.dither', 1);
    flipStage.rewind(); flipStage.step(30, 1000 / 30);
    const g = __nv.grab();
    let mid = 0, lit = 0, rim = 0;
    for (let y = 240; y < 300; y++) for (let x = 250; x < 400; x++) {
      const i = g.at(x, y), r = g.d[i], gg = g.d[i + 1], b = g.d[i + 2], m = Math.max(r, gg, b);
      if (m < 25) continue;
      if (gg === m && r > .1 * m && r < .35 * m && b > .5 * m && b < .75 * m) { rim++; continue; }       // el canto menta
      lit++;
      for (const v of [r, gg, b]) if (v > .12 * m && v < .8 * m) mid++;
    }
    return { gris: mid / Math.max(1, 3 * lit), lit, rim };
  });
  // (las copias pierden luz cuadro a cuadro —COLA—: «puro» es que cada canal esté apagado o al nivel de los
  //  demás encendidos, un punto rojo, verde, azul o su suma, más oscuro con la edad, nunca una mezcla gris)
  assert.ok(worm.lit > 1500 && worm.rim > 200 && worm.gris < .05, 'SELLO + TRAMA RGB: la cola sigue en puntos puros, sin gris lavado: ' + JSON.stringify(worm));

  // 5b · GUSANO, la escena de fábrica: la cámara GUSANO de FLIP como fuente, sola (sin bucle ni trama
  // encima). Costillas finas de puntos que cubren entre un 55 y un 70 % del cuadro, con un 3 a 7 % de menta,
  // y que cambian despacio (el motor no deriva: unos 5 % por segundo).
  await page.evaluate(() => { flipStage.camera.inject(null); flipStage.reset(); flipStage.set('out.quality', 1); flipStage.recall(9, true); });
  await page.waitForTimeout(1500);
  const motor = { a: await page.evaluate(() => __nv.worm(__nv.grab())) };
  await page.waitForTimeout(3000);
  motor.b = await page.evaluate(() => __nv.worm(__nv.grab()));
  motor.moved = await page.evaluate(([a, b]) => __nv.changed(a, b), [motor.a, motor.b]);
  const brief = w => ({ lit: +w.lit.toFixed(3), mint: +w.mint.toFixed(3), ribs: +w.ribs.toFixed(1), blocks: +w.cover.toFixed(2) });
  const shown = { a: brief(motor.a), b: brief(motor.b), moved: +motor.moved.toFixed(3), path: await page.evaluate(() => flipStage.status().path) };
  assert.equal(shown.path, 'emulador GUSANO:STD', 'la fuente es la cámara GUSANO: ' + JSON.stringify(shown));
  for (const w of [motor.a, motor.b]) {
    // (píxeles con luz: entre punto y punto hay negro, así que cuentan los puntos, no los bloques)
    assert.ok(w.lit >= .5 && w.lit <= .75, 'GUSANO: cubre entre 55 y 70 % (±5): ' + JSON.stringify(shown));
    assert.ok(w.mint >= .025 && w.mint <= .075, 'GUSANO: 3 a 7 % de menta: ' + JSON.stringify(shown));
    assert.ok(w.ribs >= 20, 'GUSANO: costillas (muchas franjas finas por columna): ' + JSON.stringify(shown));
  }
  assert.ok(motor.moved >= .08 && motor.moved <= .35, 'GUSANO: cambia despacio (en 3 s, del orden del 19 % de los píxeles): ' + JSON.stringify(shown));
  result.gusano = shown;

  // 5b' · El respaldo: sin la cámara GUSANO registrada, la escena es el PINCEL de STAGE sellado en trama RGB
  // (cámara en negro): a los 4 s cintas que cubren entre 35 y 75 %, con cruces, menta y movimiento.
  const spare = await page.evaluate(() => {
    const families = Object.entries(CAM_FAMILIES);
    for (const [key] of families) delete CAM_FAMILIES[key];
    for (const [key, cfg] of families) if (key !== 'GUSANO') CAM_FAMILIES[key] = cfg;
    try {
      flipStage.reset(); flipStage.set('out.quality', 1); __nv.dark(); flipStage.recall(9, true);
      const setup = { gen: flipStage.get('src.gen'), fb: flipStage.get('fb.mode'), routes: flipStage.status().routes.length };
      flipStage.rewind(); flipStage.step(240);
      const a = __nv.worm(__nv.grab());
      flipStage.step(60);
      const b = __nv.worm(__nv.grab());
      return { setup, cover: a.cover, rows: a.rows, cols: a.cols, mint: a.mint, moved: __nv.moved(a, b) };
    } finally {
      for (const [key] of Object.entries(CAM_FAMILIES)) delete CAM_FAMILIES[key];
      for (const [key, cfg] of families) CAM_FAMILIES[key] = cfg;
      flipStage.camera.inject(null);
    }
  });
  assert.deepEqual(spare.setup, { gen: 9, fb: 3, routes: 5 }, 'sin la cámara GUSANO, la escena es el respaldo PINCEL + SELLO');
  assert.ok(spare.cover >= .35 && spare.cover <= .75, 'respaldo: a los 4 s las cintas cubren entre 35 y 75 %: ' + JSON.stringify(spare));
  assert.ok(spare.rows.mean >= 2.5 && spare.cols.mean >= 2.5 && spare.cols.multi >= .25, 'respaldo: cintas, no un bloque: ' + JSON.stringify(spare));
  assert.ok(spare.mint > .02 && spare.moved >= .1, 'respaldo: con filo menta y en marcha: ' + JSON.stringify(spare));
  result.respaldo = { cubre: +spare.cover.toFixed(2), cambia: +spare.moved.toFixed(2) };

  // 5c · ESPECTRO, la escena sola: la salpicadura sale en curvas de nivel con el arcoíris entero (al menos
  // 5 de los 6 sectores de matiz con un 8 % o más de lo que tiene color) y con varias bandas por línea.
  const spectrum = await page.evaluate(() => {
    const { bandsOn, sectors } = __nv;
    flipStage.reset(); flipStage.set('out.quality', 1); __nv.dark(); flipStage.recall(8, true); flipStage.rewind();
    flipStage.step(150);
    const g = __nv.grab(), splash = sectors(g, [0, 0, g.w, g.h]);
    const rows = [230, 280, 330].map(y => bandsOn(g, y, 120, 840));
    let outside = 0;                                    // negro total fuera: las esquinas
    for (const [x, y] of [[20, 20], [940, 20], [20, 520], [940, 520]]) { const i = g.at(x, y); outside = Math.max(outside, g.d[i], g.d[i + 1], g.d[i + 2]); }
    flipStage.camera.inject(null);
    return { splash, rows, outside };
  });
  assert.ok(spectrum.splash.full >= 5, 'ESPECTRO: la salpicadura cubre el arcoíris (≥ 5 de 6 sectores con ≥ 8 %): ' + JSON.stringify(spectrum));
  assert.ok(Math.max(...spectrum.rows) >= 4, 'ESPECTRO: varias bandas cruzan la salpicadura: ' + JSON.stringify(spectrum));
  assert.ok(spectrum.outside < 4, 'ESPECTRO: fuera, negro total: ' + JSON.stringify(spectrum));
  result.espectroEscena = { sectores: spectrum.splash.share, bandas: spectrum.rows };

  // 6 · ARRASTRE: las luces altas se alargan en horizontal y no en vertical (el cuadrito blanco aislado).
  const smear = await page.evaluate(() => {
    const measure = amount => {
      __nv.neutral(); __nv.inject();
      flipStage.set('sig.smear', amount); flipStage.rewind();
      let wide = 0, tall = 0;
      for (let t = 0; t < 6; t++) {                                     // varias ráfagas
        flipStage.step(4);
        const g = __nv.grab();
        for (let y = 60; y < 76; y++) for (let x = 440; x < 860; x++) if ((x < 636 || x > 660) && __nv.luma(g.d, g.at(x, y)) > .3) wide++;
        for (let y = 0; y < 140; y++) if (y < 56 || y > 80) for (let x = 640; x < 656; x++) if (__nv.luma(g.d, g.at(x, y)) > .3) tall++;
      }
      return { wide, tall };
    };
    return { off: measure(0), on: measure(1) };
  });
  assert.ok(smear.off.wide < 20, 'sin ARRASTRE, el cuadrito no se alarga: ' + JSON.stringify(smear));
  assert.ok(smear.on.wide > 400, 'ARRASTRE: el cuadrito blanco deja hebras horizontales: ' + JSON.stringify(smear));
  assert.ok(smear.on.tall < 10, 'ARRASTRE: y no crece en vertical: ' + JSON.stringify(smear));
  result.arrastre = smear.on.wide;

  // 7 · CHISPA: destellos solo donde hay luz o crestas, y cambian con el tiempo.
  const spark = await page.evaluate(() => {
    __nv.neutral(); __nv.inject();
    flipStage.rewind(); flipStage.step(1);
    const base = __nv.grab();
    flipStage.set('sig.spark', 1);
    const shot = () => {
      const g = __nv.grab(), on = new Set();
      let dark = 0, light = 0, black = 0;
      for (let y = 0; y < 540; y++) for (let x = 0; x < 960; x++) {
        const i = g.at(x, y), d = __nv.luma(g.d, i) - __nv.luma(base.d, i);
        if (d < .15) continue;
        on.add(y * 960 + x);
        if (x >= 240 && x < 400 && y >= 40 && y < 200) dark++;
        else if (x >= 760 && x < 920 && y >= 300 && y < 460) light++;
        if (__nv.luma(base.d, i) < .05) black++;
      }
      return { on, dark, light, black };
    };
    flipStage.step(10); const a = shot();
    flipStage.step(40); const b = shot();
    let both = 0;
    for (const k of a.on) if (b.on.has(k)) both++;
    return { a: { n: a.on.size, dark: a.dark, light: a.light, black: a.black }, b: { n: b.on.size, dark: b.dark, light: b.light }, shared: both / Math.max(1, Math.min(a.on.size, b.on.size)) };
  });
  assert.ok(spark.a.light > 40 && spark.b.light > 40, 'CHISPA: la zona clara con crestas destella: ' + JSON.stringify(spark));
  assert.ok(spark.a.dark === 0 && spark.b.dark === 0, 'CHISPA: en la zona oscura, nada: ' + JSON.stringify(spark));
  assert.ok(spark.a.black < spark.a.n * .2, 'CHISPA: casi nada cae sobre el negro (solo los brazos de alguna estrella): ' + JSON.stringify(spark));
  assert.ok(spark.shared < .5, 'CHISPA: titila (otros granos medio segundo después): ' + JSON.stringify(spark));
  result.chispa = spark.a.n;
  await page.evaluate(() => { flipStage.camera.inject(null); flipStage.reset(); });

  // 7b · ESPECTRO sobre la cámara (el cuarto dibujado, recortado por luz contra negro): dentro de la figura
  // el matiz cubre al menos 5 de 6 sectores con un 8 % o más, y al menos 3 bandas cruzan la cara.
  // (el CICLO quieto: si no, el reparto del matiz depende del instante en que se mira)
  await page.evaluate(() => { flipStage.set('out.quality', 1); flipStage.recall(8, true); flipStage.set('mix.mode', 4); flipStage.set('src.gen', 0); flipStage.set('col.solar', .3); flipStage.set('col.cycle', .5); });
  await page.waitForTimeout(1500);
  const room = await page.evaluate(() => {
    const g = __nv.grab(), figure = __nv.sectors(g, [0, 0, g.w, g.h]);
    const face = [150, 190, 230].map(y => __nv.bandsOn(g, y, 380, 650));
    return { figure, face };
  });
  assert.ok(room.figure.full >= 5, 'ESPECTRO con cámara: en la figura, ≥ 5 de 6 sectores de matiz con ≥ 8 %: ' + JSON.stringify(room));
  assert.ok([...room.face].sort((a, b) => a - b)[1] >= 3, 'ESPECTRO con cámara: ≥ 3 bandas cruzan la cara: ' + JSON.stringify(room));
  result.espectroCamara = { sectores: room.figure.share, bandasCara: room.face };
  await page.evaluate(() => flipStage.reset());

  // 8 · FAMILIA:VARIANTE. VFD:CRT pinta distinto de VFD:STD; «VFD» (como se guardaba antes) pinta como su
  // variante de siempre; una familia o variante que no existe no rompe nada ni se borra.
  const shoot = async look => {
    await page.evaluate(l => { flipStage.recall(0, true); for (const r of flipStage.status().routes) flipStage.route(r[0], r[1], 0); for (const id of ['sig.scan', 'sig.rgb']) flipStage.set(id, 0); flipStage.set('src.look', l); }, look);
    await page.waitForTimeout(900);
    return page.evaluate(() => ({ px: flipStage.probe(.05, .05, .9, .9), path: flipStage.status().path, look: flipStage.get('src.look'), variant: flipStage.get('src.var') }));
  };
  const camFam = await page.evaluate(() => camFamily);
  assert.notEqual(camFam, 'VFD', 'la cámara de CAM no es VFD (si no, «VFD» seguiría su variante)');
  const std = await shoot('VFD:STD'), crt = await shoot('VFD:CRT'), plain = await shoot('VFD');
  assert.equal(std.path, 'emulador VFD:STD'); assert.equal(crt.path, 'emulador VFD:CRT');
  const gap = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
  assert.ok(gap(std.px, crt.px) > 25, 'VFD:CRT pinta distinto de VFD:STD: ' + JSON.stringify([std.px, crt.px]));
  assert.equal(plain.path, 'emulador VFD:STD', '«VFD» a secas es su primera variante, como antes');
  assert.ok(gap(plain.px, std.px) < 12, '«VFD» pinta como VFD:STD: ' + JSON.stringify([plain.px, std.px]));
  const missing = await shoot('NOEXISTE:X');
  assert.ok(missing.path === 'directa' || missing.path.startsWith('planos'), 'una familia que no existe se pinta como cámara directa: ' + missing.path);
  assert.equal(missing.look, 'NOEXISTE:X', 'y se conserva en la escena');
  const noVariant = await shoot('VFD:NOCHE');
  assert.equal(noVariant.path, 'emulador VFD:STD', 'una variante que aún no existe usa la de siempre');
  // en el TALLER: A · CÁMARA elige la familia y A · VARIANTE su variante, leídas de CAM_FAMILIES en vivo
  await page.evaluate(() => { CAM_FAMILIES.PRUEBAZ = { label: 'PRUEBAZ', variants: [{ id: 'UNO', label: 'UNO' }, { id: 'DOS', label: 'DOS' }] }; });
  assert.ok(await page.evaluate(() => flipStage.tables.LOOKS.includes('PRUEBAZ') && flipStage.tables.variants('PRUEBAZ').join() === 'UNO,DOS'), 'una familia registrada después aparece sola');
  await page.evaluate(() => { delete CAM_FAMILIES.PRUEBAZ; flipStage.set('src.look', 'VFD:CRT'); flipStage.page('src'); });
  await page.waitForTimeout(200);
  const lcd = id => page.locator(`.rig-pick[data-pick="${id}"] .hw-lcd b`).textContent();
  assert.equal(await lcd('src.look'), 'VFD'); assert.equal(await lcd('src.var'), 'CRT');
  await page.locator('.rig-pick[data-pick="src.var"] [data-step="1"]').click();
  assert.equal(await page.evaluate(() => flipStage.get('src.look')), 'VFD:NEON', 'la tecla de variante pasa a la siguiente');
  assert.equal(await lcd('src.var'), 'NEÓN');
  await page.locator('.rig-pick[data-pick="src.look"] [data-step="1"]').click();
  const nextFamily = await page.evaluate(() => { const l = flipStage.tables.LOOKS; return l[l.indexOf('VFD') + 1]; });
  assert.equal(await page.evaluate(() => flipStage.get('src.look')), nextFamily, 'la tecla de cámara pasa a la familia siguiente, con su variante de siempre');
  await page.evaluate(() => flipStage.set('src.look', 'RAW'));
  result.variante = gap(std.px, crt.px) | 0;

  // 9 · Un estado guardado con el formato de antes (ocho escenas, «VFD» sin variante) carga igual.
  await page.waitForTimeout(500);                                       // (lo guardado se escribe a los 350 ms)
  const saved = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('flip.stage.v3') || 'null');
    st.scenes = st.scenes.slice(0, 8);
    st.scenes[2].d['src.look'] = 'VFD'; st.scenes[2].p['col.hue'] = .4; delete st.scenes[2].p['sig.spark']; st.scenes[2].p['sig.smear'] = .6;
    st.scene = 2; st.live = null;
    localStorage.setItem('flip.stage.v3', JSON.stringify(st));
    return st.scenes.length;
  });
  assert.equal(saved, 8);
  await page.reload();
  await boot(page);
  await openModule(page, 'stage');
  await page.waitForFunction(() => flipStage.status().hasA, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  const loaded = await page.evaluate(() => ({ scene: flipStage.status().scene, look: flipStage.get('src.look'), hue: flipStage.get('col.hue'), spark: flipStage.get('sig.spark'), smear: flipStage.get('sig.smear'), path: flipStage.status().path, names: [...document.querySelectorAll('#rigScenes [data-scene]')].map(k => k.textContent.trim()) }));
  assert.equal(loaded.scene, 2); assert.equal(loaded.look, 'VFD'); near(loaded.hue, .4, .001, 'lo guardado se conserva'); assert.equal(loaded.spark, 0, 'un mando nuevo que no estaba guardado sale en cero');
  near(loaded.smear, .6, .001, 'un mando nuevo guardado vuelve con su valor');
  assert.equal(loaded.path, 'emulador VFD:STD', 'y se pinta como antes');
  assert.equal(loaded.names.length, 10, 'las dos escenas nuevas salen de fábrica junto a las guardadas');
  const nine = await page.evaluate(() => { flipStage.recall(9, true); return { name: flipStage.status().name, routes: flipStage.status().routes.length }; });
  assert.deepEqual(nine, { name: 'GUSANO', routes: 0 }, 'GUSANO sale de fábrica aunque lo guardado no lo tuviera');

  // 10 · Las escenas nuevas en la consola: teclas 9 y 10, MIDI 44 y 45, y el teclado (9 y 0).
  await page.evaluate(() => { flipStage.recall(0, true); flipStage.page('easy'); });
  await page.locator('#rigScenes [data-scene="8"]').click();
  assert.equal((await page.evaluate(() => flipStage.status())).name, 'ESPECTRO');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.rig-tira .hw-print')].map(n => n.textContent)), ['CAMBIO DE COLOR', 'VUELTAS DE COLOR', 'BARRIDO VHS', 'TAMAÑO'], 'ESPECTRO en FÁCIL (con su paleta, SOLARIZ. son las vueltas)');
  await page.evaluate(() => { flipStage.midi.inject([0x90, 45, 100]); flipStage.midi.inject([0x80, 45, 0]); });
  assert.equal((await page.evaluate(() => flipStage.status())).name, 'GUSANO', 'la nota 45 llama a la escena 10');
  await page.evaluate(() => flipStage.key('9'));
  assert.equal((await page.evaluate(() => flipStage.status())).name, 'ESPECTRO', 'la tecla 9');
  await page.evaluate(() => flipStage.key('0'));
  assert.equal((await page.evaluate(() => flipStage.status())).name, 'GUSANO', 'la tecla 0 es la escena 10');
  const easy = await page.evaluate(() => ({ sobra: document.querySelector('.rig-deck').scrollHeight - document.querySelector('.rig-deck').clientHeight, tiras: [...document.querySelectorAll('.rig-tira .hw-print')].map(n => n.textContent),
    filas: new Set([...document.querySelectorAll('#rigScenes [data-scene]')].map(k => Math.round(k.getBoundingClientRect().top))).size }));
  assert.equal(easy.filas, 2, 'las diez escenas ocupan dos filas, como las ocho de antes');
  // (en la pantalla del Pixel FÁCIL cabe entero; en la del iPhone de pruebas ya sobraban 79 px con ocho escenas, y siguen siendo 79)
  if (ENGINE === 'chromium') assert.ok(easy.sobra <= 1, 'FÁCIL con diez escenas cabe sin desplazar (sobran ' + easy.sobra + ' px)');
  else console.log('FÁCIL en ' + ENGINE + ': sobran ' + easy.sobra + ' px (igual que con ocho escenas)');
  assert.deepEqual(easy.tiras, ['ZOOM', 'COLOR', 'SEPARAR RGB', 'ESTELA'], 'GUSANO (sin cables) enseña en FÁCIL los cuatro de siempre: ' + JSON.stringify(easy.tiras));
  await stageTab(page, 'sig');
  const knobs = await page.evaluate(() => [...document.querySelectorAll('#rigPanel .rig-knob .hw-print')].map(n => n.textContent));
  assert.deepEqual(knobs.slice(8), ['CHISPA', 'ARRASTRE', 'TRAMA RGB'], 'las perillas nuevas, en EFECTOS');
  const sheet = await page.evaluate(() => [...document.querySelectorAll('#rigPanel .rig-knob')].slice(8).map(k => { const r = k.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  for (const [w, h] of sheet) assert.ok(w > 60 && h > 60, 'la perilla nueva tiene su sitio: ' + JSON.stringify(sheet));

  // Evidencia: hojas de contacto de ESPECTRO y GUSANO y de cada mando nuevo a media y a tope, con la cámara de escena.
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    const cells = [];
    const take = async (label, setup, ms, arg) => {
      await page.evaluate(setup, arg);
      await page.waitForTimeout(ms);
      cells.push({ label, url: await page.evaluate(() => { flipStage.probe(0, 0, .01, .01); return document.getElementById('stageCanvas').toDataURL('image/png'); }) });
    };
    await page.evaluate(() => { flipStage.set('out.quality', 1); flipStage.page('easy'); });
    await take('ESPECTRO · 1,5 s', () => flipStage.recall(8, true), 1500);
    await take('ESPECTRO · 4 s', () => {}, 2500);
    await take('GUSANO · 4 s', () => flipStage.recall(9, true), 4000);
    await take('GUSANO · 8 s', () => {}, 4000);
    await take('ESPECTRO CON CÁMARA', () => { flipStage.recall(8, true); flipStage.set('mix.mode', 4); flipStage.set('src.gen', 0); flipStage.set('col.solar', .3); }, 1500);
    for (const [id, name] of [['sig.spark', 'CHISPA'], ['sig.smear', 'ARRASTRE'], ['sig.dither', 'TRAMA RGB']]) for (const v of [.5, 1]) {
      await take(name + ' · ' + (v === 1 ? 'TOPE' : 'MEDIA'), ([id, v]) => { flipStage.recall(0, true); for (const r of flipStage.status().routes) flipStage.route(r[0], r[1], 0); for (const k of ['sig.scan', 'sig.rgb']) flipStage.set(k, 0); flipStage.set(id, v); }, 900, [id, v]);
    }
    for (const [i, c] of cells.entries()) saveDataUrl(path.join(out, String(i + 1).padStart(2, '0') + '-' + c.label.replace(/[^A-Z0-9]+/gi, '-').toLowerCase() + '.png'), c.url);
    const sheetUrl = await page.evaluate(async cells => {
      const cw = 480, ch = 270, pad = 26, cols = 2, rows = Math.ceil(cells.length / cols);
      const c = document.createElement('canvas'); c.width = cols * cw; c.height = rows * (ch + pad);
      const x = c.getContext('2d'); x.fillStyle = '#111'; x.fillRect(0, 0, c.width, c.height);
      for (const [i, cell] of cells.entries()) {
        const img = new Image(); img.src = cell.url; await img.decode();
        const ox = (i % cols) * cw, oy = Math.floor(i / cols) * (ch + pad);
        x.drawImage(img, ox, oy + pad, cw, ch);
        x.fillStyle = '#eee'; x.font = '600 15px system-ui, sans-serif'; x.fillText(cell.label, ox + 8, oy + 18);
      }
      return c.toDataURL('image/jpeg', .92);
    }, cells);
    saveDataUrl(path.join(out, 'hoja-de-contacto.jpg'), sheetUrl);
  }
  assert.deepEqual(errors, []);
  return result;
}

// La ventana de salida lleva lo nuevo: con TRAMA RGB a tope, lo que pinta la otra pantalla son puntos puros.
async function desktop(browser) {
  const { page, errors } = await openFlip(browser, { desktop: true, sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
  await enterStage(page);
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#rigOut').click();
  const popup = await popupPromise;
  popup.on('pageerror', error => errors.push('salida: ' + error.message));
  await page.waitForFunction(() => flipStage.status().out.window, null, { timeout: 10000 });
  await page.evaluate(() => { flipStage.recall(0, true); flipStage.set('sig.dither', 1); });
  await page.waitForTimeout(800);
  const binary = await popup.evaluate(() => {
    const canvas = document.getElementById('out'), c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d'); x.drawImage(canvas, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let mid = 0;
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) if (d[i + k] > 40 && d[i + k] < 215) mid++;
    return mid / (3 * d.length / 4);
  });
  // (LÍNEAS DE TV de la escena VIVO oscurece una de cada tantas filas: por eso no es cero)
  assert.ok(binary < .25, 'la salida en ventana enseña la TRAMA RGB: ' + binary.toFixed(3));
  // GUSANO (la cámara GUSANO como fuente) llega a la ventana; y al irse a otra escena y volver, el lienzo del
  // gusano sigue sano (mismas proporciones de menta y de rojo y azul).
  const inWindow = () => popup.evaluate(() => {
    const canvas = document.getElementById('out'), c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d'); x.drawImage(canvas, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let mint = 0, red = 0, blue = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { n++; if (d[i + 1] > 180 && d[i] < 110 && d[i + 2] > 100 && d[i + 2] < 200) mint++; else if (d[i] > 150 && d[i + 1] < 80 && d[i + 2] < 110) red++; else if (d[i + 2] > 150 && d[i] < 110 && d[i + 1] < 80) blue++; }
    return { mint: +(mint / n).toFixed(3), red: +(red / n).toFixed(3), blue: +(blue / n).toFixed(3) };
  });
  await page.evaluate(() => { flipStage.set('sig.dither', 0); flipStage.recall(9, true); });
  await page.waitForTimeout(1500);
  const worm1 = await inWindow();
  await page.evaluate(() => flipStage.recall(4, true)); await page.waitForTimeout(800);
  await page.evaluate(() => flipStage.recall(9, true)); await page.waitForTimeout(1500);
  const worm2 = await inWindow();
  for (const w of [worm1, worm2]) assert.ok(w.mint > .015 && w.red > .05 && w.blue > .05, 'GUSANO en la ventana de salida, también al volver de otra escena: ' + JSON.stringify([worm1, worm2]));
  await popup.close();
  await page.waitForFunction(() => !flipStage.status().out.window, null, { timeout: 5000 });
  // La grabación lleva lo nuevo: ESPECTRO grabado es arcoíris (mucho más color que la cámara de escena).
  const colorOf = file => {
    const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-sseof', '-0.6', '-i', file, '-frames:v', '1', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    let sat = 0, lit = 0;                                              // saturación media de lo que tiene luz
    for (let i = 0; i < raw.length; i += 3) { const mx = Math.max(raw[i], raw[i + 1], raw[i + 2]), mn = Math.min(raw[i], raw[i + 1], raw[i + 2]); if (mx > 40) { sat += (mx - mn) / mx; lit++; } }
    return sat / Math.max(1, lit);
  };
  const record = async scene => {
    await page.evaluate(n => flipStage.recall(n, true), scene);
    await page.waitForTimeout(600);
    const [clip] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), (async () => { await page.locator('#rigRec').click(); await page.waitForTimeout(1800); await page.locator('#rigRec').click(); })()]);
    const file = await clip.path();
    assert.ok(fs.statSync(file).size > 20000, 'el video tiene contenido');
    return colorOf(file);
  };
  let recorded = null;
  try { execFileSync('ffmpeg', ['-version']); recorded = { vivo: await record(0), espectro: await record(8), gusano: await record(9) }; } catch (error) { if (error.code !== 'ENOENT') throw error; console.log('aviso: sin ffmpeg, no se mira dentro de la grabación'); }
  if (recorded) assert.ok(recorded.espectro > recorded.vivo + .25, 'la grabación de ESPECTRO sale en arcoíris: ' + JSON.stringify(recorded));
  if (recorded) assert.ok(recorded.gusano > recorded.vivo + .2, 'la grabación de GUSANO lleva sus puntos de color (no la cámara): ' + JSON.stringify(recorded));
  assert.deepEqual(errors, []);
  return { ventana: +binary.toFixed(3), grabacion: recorded && { espectro: +recorded.espectro.toFixed(2), gusano: +recorded.gusano.toFixed(2) }, gusanoVentana: [worm1, worm2] };
}

async function main() {
  const browser = await launch();
  try {
    const same = await identity(browser);
    const result = await phone(browser);
    const outWindow = await desktop(browser);
    console.log('PASS · stage-nuevos · ' + JSON.stringify(Object.assign({ identicas: same }, outWindow, result)));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
