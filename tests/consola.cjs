// CONSOLA: la escena en polígonos, como la pintaba una consola de otra generación. Lo que tiene que
// seguir siendo verdad:
//   · se elige como una cámara más y la app lo dice;
//   · pinta en la gráfica una malla de cientos de polígonos, y el visor no queda en negro;
//   · con una cara delante se suma su propia malla de facetas (110 puntos, triangulada una vez);
//   · 128 BITS y 32 BITS: cada una con su resolución interna (la de 32, más baja);
//   · el marco de juego (mapa, vida, dinero, alerta) viene puesto, cuenta las tomas y se puede quitar;
//   · toma la foto, y al cambiar de cámara suelta el rastreador de rostro.
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

    // ── Al cambiar de cámara, el rastreador de rostro se apaga ──
    await page.evaluate(() => { flipConsola.injectFace(null); _setCamFamily('AUTO03'); });
    await page.waitForFunction(() => flipConsola.state().face.state !== 'ready' && flipConsola.state().face.state !== 'loading', null, { timeout: 60000 });
    assert.deepEqual(errors, [], 'sin errores');
    assert.equal(await page.evaluate(() => document.querySelector('.si-consola').hidden), true, 'fuera de CONSOLA la tecla del marco no está');
    step('al cambiar de cámara suelta el rastreador', { estado: (await page.evaluate(() => flipConsola.state())).face.state });
    console.log('CONSOLA PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
