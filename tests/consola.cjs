// CONSOLA: la escena en polígonos, como la pintaba una consola de otra generación. Lo que tiene que
// seguir siendo verdad:
//   · se elige como una cámara más y la app lo dice;
//   · pinta en la gráfica una malla de cientos de polígonos, y el visor no queda en negro;
//   · con una cara delante se suma su propia malla de facetas (110 puntos, triangulada una vez);
//   · 128 BITS y 32 BITS: cada una con su resolución interna (la de 32, más baja);
//   · el marco de juego (mapa, vida, dinero, alerta) viene puesto, cuenta las tomas y se puede quitar;
//   · toma la foto, y al cambiar de cámara suelta el rastreador de rostro;
//   · VIRTUAL lleva once variantes: las tres de aquí y ocho escenarios en 3D que pinta cuarto.js (los
//     que cuarto.js aún no trae caen a AUTO 03); en ellos la hoja trae los mandos de CUARTO y la tecla
//     PASEO, que llega al motor y se guarda; un estado guardado con la cámara CUARTO se muda a VIRTUAL.
//   FLIP_URL=http://127.0.0.1:8760 node tests/consola.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, pickVariant } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
// Una cara de mentira: 478 puntos repartidos en un óvalo, con las mejillas y la nariz donde van.
const fakeFace = () => {
  const pts = [];
  for (let i = 0; i < 478; i++) { const a = i * 2.39996, r = Math.sqrt((i + .5) / 478); pts.push(.5 + Math.cos(a) * r * .17, .45 + Math.sin(a) * r * .23); }
  const put = (k, x, y) => { pts[2 * k] = x; pts[2 * k + 1] = y; };
  put(234, .33, .45); put(454, .67, .45); put(1, .5, .47); put(10, .5, .22); put(152, .5, .68);
  return pts;
};

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForTimeout(700);
    await page.locator('#deckLooks [data-family="CONSOLA"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.locator('#deckLooks [data-family="CONSOLA"]').click();
    await page.waitForFunction(() => camFamily === 'CONSOLA' && flipConsola.state().frames > 10, null, { timeout: 8000 });
    const a = await page.evaluate(() => {
      const g = document.createElement('canvas'); g.width = 96; g.height = 72;
      const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, 0, 96, 72);
      const d = c.getImageData(0, 0, 96, 72).data; let lit = 0; const seen = new Set();
      for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; seen.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4); }
      return { s: flipConsola.state(), lcd: document.getElementById('lcdLook').textContent, lit: +(lit / (d.length / 4)).toFixed(2), colores: seen.size, variante: camVariant, miniatura: getComputedStyle(document.querySelector('.look[data-family="CONSOLA"] i')).backgroundImage.includes('look-CONSOLA.webp') };
    });
    assert.match(a.lcd, /VIRTUAL/);
    assert.equal(a.variante, 'B128');
    assert.ok(a.s.gl && !a.s.failed, 'pinta en la gráfica');
    assert.ok(a.s.tris >= 300, 'una malla de cientos de polígonos: ' + a.s.tris);
    assert.ok(a.lit > .6 && a.colores > 12, 'el visor no queda en negro ni liso: ' + JSON.stringify([a.lit, a.colores]));
    assert.ok(a.miniatura, 'tiene su miniatura en la tira');
    assert.equal(Math.max(...a.s.size), 480, '128 BITS: 480 de lado largo');
    step('CONSOLA · 128 BITS: la escena en polígonos', { poligonos: a.s.tris, interno: a.s.size.join('×'), msPorCuadro: a.s.ms });

    // ── La cara, con su propia malla ──
    await page.evaluate(points => flipConsola.injectFace(points), fakeFace());
    await page.waitForTimeout(500);
    const f = await page.evaluate(() => flipConsola.state());
    assert.equal(f.face.points, 110, 'la cara se queda con 110 puntos bien repartidos');
    assert.ok(f.faceTris > 120 && f.faceTris < 260, 'y sus facetas se suman a la escena: ' + f.faceTris);
    step('la cara lleva su malla de facetas', { puntos: f.face.points, facetas: f.faceTris });

    // ── 32 BITS ──
    await pickVariant(page, 'B32');
    await page.waitForFunction(() => camVariant === 'B32' && flipConsola.state().variant === 'B32', null, { timeout: 5000 });
    const b = await page.evaluate(() => flipConsola.state());
    assert.equal(Math.max(...b.size), 240, '32 BITS: 240 de lado largo');
    assert.ok(b.tris < a.s.tris, 'y polígonos más grandes');
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => document.getElementById('deckGallery').classList.contains('has-shot'), null, { timeout: 8000 });
    step('32 BITS, y toma la foto', { poligonos: b.tris, interno: b.size.join('×') });

    // ── NOCHE: el cuarto a oscuras alumbrado por la pantalla ──
    await pickVariant(page, 'NOCHE');
    await page.waitForFunction(() => camVariant === 'NOCHE' && flipConsola.state().variant === 'NOCHE', null, { timeout: 5000 });
    const n = await page.evaluate(() => {
      const hudWas = flipConsola.hud(); flipConsola.hud(false);
      const stats = (scene, variant) => {
        const src = document.createElement('canvas'); src.width = 1280; src.height = 720;
        const sx = src.getContext('2d'); FlipScenes.draw(sx, 1280, 720, scene === 'oscuro' ? 'roomLit' : scene, 0, {});
        // «oscuro»: la misma habitación con la luz casi apagada y la lámpara encendida (un emisivo)
        if (scene === 'oscuro') { sx.fillStyle = 'rgba(0,0,0,.86)'; sx.fillRect(0, 0, 1280, 720); sx.fillStyle = '#fffbe8'; sx.beginPath(); sx.arc(200, 280, 26, 0, 6.283); sx.fill(); }
        const out = document.createElement('canvas'); out.width = 640; out.height = 360;
        const ctx = out.getContext('2d', { willReadFrequently: true });
        for (let i = 0; i < 4; i++) renderConsola(src, 1280, 720, ctx, false, variant, { now: 5000 + i * 40, path: 'capture', outW: 640, outH: 360 });
        const d = ctx.getImageData(0, 0, 640, 360).data;
        let sum = 0, dark = 0, indigo = 0, max = 0, stars = 0;
        const L = i => d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114, all = [];
        for (let i = 0; i < d.length; i += 4) { const l = L(i); all.push(l); sum += l; if (l > max) max = l; if (l < 70) { dark++; if (d[i + 2] > d[i] + 6) indigo++; } }
        all.sort((a, b) => a - b);
        // estrellas: puntos claros aislados sobre sombra
        for (let y = 4; y < 356; y += 1) for (let x = 4; x < 636; x += 1) { const i = 4 * (y * 640 + x); if (L(i) > 60 && L(4 * ((y - 4) * 640 + x)) < 25 && L(4 * ((y + 4) * 640 + x)) < 25 && L(4 * (y * 640 + x - 4)) < 25 && L(4 * (y * 640 + x + 4)) < 25) stars++; }
        return { media: Math.round(sum / (d.length / 4)), mediana: +(all[all.length >> 1] / 255).toFixed(3), p95: +(all[Math.floor(all.length * 0.95)] / 255).toFixed(3), bajo012: +(all.filter(v => v < 0.12 * 255).length / all.length).toFixed(2), indigo: dark ? +(indigo / dark).toFixed(2) : 0, max: Math.round(max), estrellas: stars };
      };
      const r = { B128: stats('roomLit', 'B128'), NOCHE: stats('roomLit', 'NOCHE'), oscuroB128: stats('oscuro', 'B128'), oscuroNOCHE: stats('oscuro', 'NOCHE'), size: flipConsola.state().size };
      flipConsola.hud(hudWas);
      return r;
    });
    assert.equal(Math.max(...n.size), 300, 'NOCHE: 300 de lado largo');
    assert.ok(n.NOCHE.mediana < 0.15, 'NOCHE es de noche: un interior normal queda con la mediana de luz por debajo de 0,15: ' + JSON.stringify(n.NOCHE));
    assert.ok(n.NOCHE.bajo012 >= 0.7, 'y al menos el 70 % del cuadro casi negro (luz < 0,12): ' + JSON.stringify(n.NOCHE));
    assert.ok(n.NOCHE.p95 > n.NOCHE.mediana * 2, 'lo que emite luz se separa del cuarto (percentil 95 frente a la mediana): ' + JSON.stringify(n.NOCHE));
    assert.ok(n.NOCHE.indigo > 0.6 && n.NOCHE.indigo > n.B128.indigo + 0.3, 'sus sombras van al índigo: ' + JSON.stringify(n.NOCHE));
    assert.ok(n.NOCHE.max > 220, 'lo que emite luz sigue encendido: ' + n.NOCHE.max);
    assert.ok(n.oscuroNOCHE.estrellas >= 3 && n.oscuroB128.estrellas === 0, 'en las sombras lisas salen estrellas (y en 128 BITS no): ' + JSON.stringify([n.oscuroB128.estrellas, n.oscuroNOCHE.estrellas]));
    step('NOCHE: el cuarto a oscuras, sombras índigo, luces encendidas y estrellas', n);

    // ── El marco de juego: suma al guardar una toma, y se puede quitar ──
    const hud = await page.evaluate(() => flipConsola.hudState());
    assert.equal(hud.on, true, 'el marco viene puesto');
    assert.deepEqual([hud.tomas, hud.dinero], [1, 500], 'la toma guardada cuenta y suma: ' + JSON.stringify(hud));
    const corner = () => page.evaluate(() => {     // esquina de abajo a la izquierda del visor: ahí va el mapa, con su aro claro
      const g = document.createElement('canvas'); g.width = display.width; g.height = display.height;
      const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, 0);
      const u = Math.min(g.width, g.height) / 100, d = c.getImageData(Math.round(3 * u), Math.round(g.height - 36 * u), Math.round(34 * u), Math.round(34 * u)).data;
      let pale = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 225 && d[i + 2] > 195) pale++;
      return pale;
    });
    const withHud = await corner();
    await page.locator('.si-abrir').click();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.si-consola')).display !== 'none'), true, 'la tecla MARCO DE JUEGO aparece con CONSOLA');
    await page.locator('#consolaMarco').click();
    await page.locator('.si-abrir').click();
    await page.waitForTimeout(400);
    const without = await corner();
    assert.equal(await page.evaluate(() => flipConsola.hud()), false);
    assert.ok(withHud > 40 && without < withHud / 4, 'con el marco se ve el aro del mapa; sin él, no: ' + JSON.stringify([withHud, without]));
    await page.evaluate(() => flipConsola.hud(true));
    step('el marco de juego cuenta las tomas y se quita con su tecla', { tomas: hud.tomas, dinero: hud.dinero, aro: [withHud, without] });

    // ── VIRTUAL: once variantes; los escenarios en 3D, con el motor de cuarto ──
    const ESCENARIOS = ['DORMITORIO', 'OFICINA', 'AZOTEA', 'TORRE', 'AUTOBUS', 'AUTOCINEMA', 'ESCAPARATE', 'TAQUERIA'];
    const v = await page.evaluate(async escenarios => {
      const ids = CAM_FAMILIES.CONSOLA.variants.map(x => x.id), labels = CAM_FAMILIES.CONSOLA.variants.map(x => x.label);
      // quién pinta cada variante: se espían los dos motores
      const calls = [], realC = window.renderCuarto, realV = window.renderConsola;
      window.renderCuarto = function (s, w, h, c, m, variant, o) { calls.push(['cuarto', variant, o && o.paseo]); return realC.apply(this, arguments); };
      window.renderConsola = function (s, w, h, c, m, variant) { calls.push(['consola', variant]); return realV.apply(this, arguments); };
      const src = document.createElement('canvas'); src.width = 640; src.height = 360; FlipScenes.draw(src.getContext('2d'), 640, 360, 'roomLit', 0, {});
      const out = document.createElement('canvas'); out.width = 320; out.height = 180;
      const ctx = out.getContext('2d', { willReadFrequently: true }), res = {};
      const engine = window.flipCuarto && flipCuarto.VARIANTES || [];
      for (const id of ['B128', ...escenarios]) {
        calls.length = 0; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 320, 180);
        for (let i = 0; i < 2; i++) _renderCamEngineFrame(src, 640, 360, ctx, false, { family: 'CONSOLA', variant: id, path: 'preview', now: 9000 + i * 40 });
        const d = ctx.getImageData(0, 0, 320, 180).data; let lit = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
        res[id] = { motor: calls.length ? calls[0][0] : 'auto03', trae: engine.includes(id), pinta: lit > 50, cadencia: _camCadence('CONSOLA', id) };
      }
      window.renderCuarto = realC; window.renderConsola = realV;
      return { ids, labels, res, engine };
    }, ESCENARIOS);
    assert.deepEqual(v.ids, ['B128', 'B32', 'NOCHE', ...ESCENARIOS], 'VIRTUAL lleva once variantes, en su orden');
    assert.ok(v.labels.includes('AUTOBÚS') && v.labels.includes('TAQUERÍA'), 'con sus rótulos: ' + v.labels);
    assert.equal(v.res.B128.motor, 'consola', '128 BITS la pinta consola.js');
    assert.equal(v.res.B128.cadencia, 24);
    for (const id of ESCENARIOS) {
      const r = v.res[id];
      assert.equal(r.motor, r.trae ? 'cuarto' : 'auto03', id + ': la pinta cuarto.js si la trae; si no, AUTO 03: ' + JSON.stringify(r));
      assert.ok(r.pinta, id + ': el visor no queda en negro: ' + JSON.stringify(r));
      assert.equal(r.cadencia, 30, id + ' va a 30 cuadros por segundo');
    }
    assert.ok(['DORMITORIO', 'OFICINA', 'AZOTEA'].every(id => v.res[id].motor === 'cuarto'), 'las tres que ya existían las pinta cuarto.js');
    step('once variantes; los escenarios en 3D con el motor de cuarto', { cuarto: v.engine, auto03: ESCENARIOS.filter(id => v.res[id].motor === 'auto03') });

    // ── En un escenario: la hoja trae los mandos de CUARTO y la tecla PASEO llega al motor y se guarda ──
    await pickVariant(page, 'AZOTEA');
    await page.waitForFunction(() => camVariant === 'AZOTEA' && window.flipCuarto && flipCuarto.state().frames > 3, null, { timeout: 8000 });
    const sheet = await page.evaluate(() => ({ mandos: [...document.querySelectorAll('#fxEditPanel .fx-ctrl-row:not([hidden])')].map(r => r.dataset.fxId), panel: document.getElementById('fxEditPanel').style.display,
      marco: document.querySelector('.si-consola') ? document.querySelector('.si-consola').hidden : null, tecla: !document.querySelector('.consola-rapidas').hidden, cadencia: camFpsTarget }));
    assert.deepEqual(sheet.mandos, ['giro', 'luz', 'trama', 'temblor', 'paseo'], 'los mandos de CUARTO y PASEO: ' + JSON.stringify(sheet));
    assert.equal(sheet.panel, 'block');
    assert.equal(sheet.marco, true, 'el marco de juego es de las variantes de consola.js: aquí no sale');
    assert.equal(sheet.tecla, true, 'la tecla PASEO sale en la banda, junto a la variante');
    const seen = () => page.evaluate(() => new Promise(ok => { const real = window.renderCuarto; window.renderCuarto = function (s, w, h, c, m, variant, o) { window.renderCuarto = real; ok({ variant, paseo: o && o.paseo }); return real.apply(this, arguments); }; }));
    const before = await seen();
    await page.locator('#consolaPaseo').click();
    await page.waitForTimeout(300);
    const after = await seen();
    const saved = await page.evaluate(() => ({ valor: fxCamVals.CUARTO.paseo, guardado: JSON.parse(localStorage.getItem('flipSettings')).fxCamVals.CUARTO.paseo, tecla: document.getElementById('consolaPaseo').textContent, hoja: document.getElementById('fxCUARTOpaseo').value }));
    assert.deepEqual([before.variant, before.paseo, after.paseo], ['AZOTEA', true, false], 'la tecla PASEO llega al motor: ' + JSON.stringify([before, after]));
    assert.deepEqual([saved.valor, saved.guardado, saved.tecla, saved.hoja], [0, 0, 'QUIETA', '0'], 'y se guarda en ajustes (la hoja dice lo mismo): ' + JSON.stringify(saved));
    await page.locator('#consolaPaseo').click();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => fxCamVals.CUARTO.paseo), 1);
    step('en un escenario: los mandos de CUARTO, y PASEO / QUIETA llega al motor y se guarda', { mandos: sheet.mandos, paseo: [before.paseo, after.paseo] });

    // ── Un estado guardado con la cámara CUARTO (de antes) se muda a VIRTUAL, con sus mandos ──
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('flipSettings'));
      s.camFamily = 'CUARTO'; s.camVariant = 'OFICINA'; s.fxCamVals.CUARTO.giro = 80; s.fxCamVals.CUARTO.luz = 20;
      s.editPipeline = { source: { type: 'cam' }, steps: [{ engine: 'cam', on: true, family: 'CUARTO', variant: 'AZOTEA' }] };
      localStorage.setItem('flipSettings', JSON.stringify(s));
    });
    await page.reload();
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0);
    const moved = await page.evaluate(() => ({ cam: camFamily + ':' + camVariant, giro: fxCamVals.CUARTO.giro, luz: fxCamVals.CUARTO.luz, edit: window._editPipeline.steps.map(s => s.family + ':' + s.variant), lcd: document.getElementById('lcdLook').textContent }));
    assert.deepEqual([moved.cam, moved.giro, moved.luz, moved.edit], ['CONSOLA:OFICINA', 80, 20, ['CONSOLA:AZOTEA']], 'CUARTO se muda a VIRTUAL con su variante y sus mandos: ' + JSON.stringify(moved));
    assert.match(moved.lcd, /VIRTUAL/);
    step('un estado guardado con CUARTO abre en VIRTUAL · OFICINA, con sus mandos', moved);

    // ── Al cambiar de cámara, el rastreador de rostro se apaga ──
    await page.evaluate(() => { flipConsola.injectFace(null); _setCamFamily('AUTO03'); });
    await page.waitForFunction(() => flipConsola.state().face.state !== 'ready' && flipConsola.state().face.state !== 'loading', null, { timeout: 60000 });
    assert.deepEqual(errors, [], 'sin errores');
    assert.equal(await page.evaluate(() => document.querySelector('.si-consola').hidden), true, 'fuera de CONSOLA la tecla del marco no está');
    step('al cambiar de cámara suelta el rastreador', { estado: (await page.evaluate(() => flipConsola.state())).face.state });
    console.log('CONSOLA PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
