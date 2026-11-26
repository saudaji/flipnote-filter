// La mascota (la camarita del disparador) reacciona a lo que hace quien usa FLIP, en las dos pieles:
// en INTERFAZ es un dibujo plano; en OBJETO, un render en volumen por capas. Se mueve igual en las
// dos y nunca se mueve sola. Lo que tiene que seguir siendo verdad, en cada piel:
//   · mira hacia donde se inclina el teléfono y hacia el lado al que se pasa la tira de cámaras;
//   · tras el disparo mantiene el ojo cerrado hasta que la toma aparece en TOMA;
//   · duerme (ojo cerrado) mientras la cámara descansa;
//   · entrecierra el ojo con poca luz y lo abre de más con mucha; la escena lo decide;
//   · agitar el teléfono la marea (y el sensor reconoce una sacudida, no un giro cualquiera);
//   · dos toques en la placa: doble guiño;
//   · sale del disparador: su cara en los avisos del visor y, dormida, en la tecla TOMA vacía.
// Y de la piel OBJETO: las piezas del render existen, el ojo cae donde debe, la pupila se pone roja
// en video y grabando no hay cara. El verde es el mismo en las dos pieles.
//   FLIP_URL=http://127.0.0.1:8760 node tests/mascot.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const PARTS = { interfaz: { ojo: '.silueta .ojo', pupila: '.silueta .pupila', mira: '.silueta .mira', placa: '.si-placa', paso: 1.9, toma: 23 }, objeto: { ojo: '.m3-ojo', pupila: '.m3-pupila', mira: '.m3-mira', placa: '#camDeck .rollo-pie', paso: 2.85, toma: 24 } };
const eye = (page, part) => page.evaluate(part => {
  const sh = document.getElementById('deckShutter'), ojo = getComputedStyle(sh.querySelector(part.ojo)), pup = getComputedStyle(sh.querySelector(part.pupila)), mira = getComputedStyle(sh.querySelector(part.mira));
  const m = t => (t === 'none' ? [1, 0, 0, 1, 0, 0] : t.slice(7, -1).split(',').map(Number));
  return { abierto: +ojo.opacity, ojoY: +m(ojo.transform)[3].toFixed(2), ojoX: +m(ojo.transform)[0].toFixed(2), pupX: +m(pup.transform)[4].toFixed(2), pupEscala: +m(pup.transform)[0].toFixed(2), giro: +(Math.atan2(m(mira.transform)[1], m(mira.transform)[0]) * 180 / Math.PI).toFixed(1), clases: sh.className.replace(/\s+/g, ' ').trim() };
}, part);

async function reacciones(page, piel) {
  const part = PARTS[piel];
  await page.evaluate(piel => flipPiel.set(piel), piel);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => document.body.dataset.piel), piel);
  assert.equal(await page.locator('#deckShutter ' + part.ojo).first().evaluate(node => node.getBoundingClientRect().width > 4), true, piel + ': el ojo de la mascota está a la vista');

  // Fuera del disparador: su cara en los avisos y, mientras no hay toma, dormida en la tecla TOMA.
  const fuera = await page.evaluate(() => {
    const gallery = document.getElementById('deckGallery'), b = gallery.querySelector('b'), after = getComputedStyle(b, '::after'), hint = getComputedStyle(document.getElementById('osdHint'), '::before');
    return { vacia: !gallery.classList.contains('has-shot'), toma: /data:image\/svg/.test(after.maskImage || after.webkitMaskImage || ''), ancho: parseFloat(after.width), icono: getComputedStyle(b.querySelector('svg')).display, aviso: /data:image\/svg/.test(hint.backgroundImage), avisoAncho: parseFloat(hint.width) };
  });
  assert.deepEqual([fuera.aviso, fuera.avisoAncho], [true, 17], piel + ': su cara en los avisos');
  if (fuera.vacia) assert.deepEqual([fuera.toma, fuera.ancho, fuera.icono], [true, part.toma, 'none'], piel + ': dormida en la tecla TOMA vacía');

  // Inclinación: la pupila gira con --lt.
  await page.evaluate(() => document.getElementById('deckShutter').style.setProperty('--lt', '20deg'));
  await page.waitForTimeout(250);
  let e = await eye(page, part);
  assert.ok(Math.abs(e.giro - 20) < 0.6, piel + ': la mirada sigue la inclinación: ' + JSON.stringify(e));
  await page.evaluate(() => document.getElementById('deckShutter').style.setProperty('--lt', '0deg'));

  // El carrete: mira hacia el lado al que se pasa la tira, y vuelve al centro al parar.
  const box = await page.locator('#deckLooks').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const pasar = async dx => { let best = 0; for (let i = 0; i < 5; i++) { await page.mouse.wheel(dx, 0); await page.waitForTimeout(45); const x = (await eye(page, part)).pupX; if (Math.abs(x) > Math.abs(best)) best = x; } return best; };
  const derecha = await pasar(110);
  await page.waitForTimeout(900);
  const centro = (await eye(page, part)).pupX;
  const izquierda = await pasar(-110);
  assert.ok(Math.abs(derecha - part.paso) < 0.2 && Math.abs(izquierda + part.paso) < 0.2 && Math.abs(centro) < 0.1, piel + ': mira al lado del carrete: ' + JSON.stringify([derecha, centro, izquierda]));
  await page.waitForTimeout(600);

  // Guardar: ojo cerrado desde el disparo hasta que la toma está en TOMA.
  await page.evaluate(() => { document.getElementById('deckGallery').classList.remove('pop'); if (!window.__realDownload) { window.__realDownload = window._downloadBlob; window._downloadBlob = function () {}; } });
  await page.locator('#deckShutter').click();
  await page.waitForTimeout(30);
  const guardando = await eye(page, part);
  assert.ok(/guarda/.test(guardando.clases), piel + ': cierra el ojo al disparar: ' + guardando.clases);
  await page.waitForFunction(() => document.getElementById('deckGallery').classList.contains('pop'), null, { timeout: 15000 });
  await page.waitForTimeout(700);
  const lista = await eye(page, part);
  assert.ok(!/guarda|guino/.test(lista.clases) && lista.abierto === 1, piel + ': y lo abre con la toma guardada: ' + JSON.stringify(lista));
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#deckGallery b'), '::after').content), 'none', piel + ': con una toma, la tecla TOMA enseña la toma');

  // La luz de la escena: el ojo responde.
  const luces = {};
  for (const luz of ['poca', 'mucha', '']) {
    for (let i = 0; i < 2; i++) { await page.evaluate(v => { if (v) document.body.dataset.luz = v; else delete document.body.dataset.luz; }, luz); await page.waitForTimeout(40); }   // (la escena vuelve a decidir cada 32 cuadros)
    await page.waitForTimeout(200);
    luces[luz || 'normal'] = await eye(page, part);
  }
  assert.ok(luces.poca.ojoY < 0.75 && luces.poca.pupEscala > 1.1, piel + ': con poca luz entrecierra y abre la pupila: ' + JSON.stringify(luces.poca));
  assert.ok(luces.mucha.ojoX > 1.05 && luces.mucha.pupEscala < 0.9, piel + ': con mucha luz abre el ojo y cierra la pupila: ' + JSON.stringify(luces.mucha));

  // Dormida mientras la cámara descansa.
  await page.evaluate(() => document.body.classList.add('is-resting'));
  await page.waitForTimeout(250);
  const dormida = await eye(page, part);
  await page.evaluate(() => document.body.classList.remove('is-resting'));
  await page.waitForTimeout(300);
  const despierta = await eye(page, part);
  assert.deepEqual([dormida.abierto, despierta.abierto], [0, 1], piel + ': duerme en reposo y despierta');

  // Sacudida: tres bandazos alternos la marean; un giro lento, no.
  const orient = (list, gap) => page.evaluate(async ({ list, gap }) => { for (const [beta, gamma] of list) { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta, gamma })); await new Promise(r => setTimeout(r, gap)); } }, { list, gap });
  await page.waitForTimeout(1700);                                // el sensor no cuenta dos sacudidas seguidas
  const antes = await page.evaluate(() => flipLight.state().shakes);
  await orient([[40, 0], [41, 4], [42, 8], [43, 12], [44, 16], [45, 20], [46, 24]], 70);
  assert.equal(await page.evaluate(() => flipLight.state().shakes), antes, 'un giro lento no es una sacudida');
  await orient([[40, 0], [40, 26], [40, -4], [40, 24], [40, -2], [40, 22]], 70);
  const sacudida = await page.evaluate(part => ({ shakes: flipLight.state().shakes, mareo: document.getElementById('deckShutter').classList.contains('mareo'), anim: getComputedStyle(document.querySelector('#deckShutter ' + part.pupila)).animationName }), part);
  assert.deepEqual(sacudida, { shakes: antes + 1, mareo: true, anim: 'si-mareo' }, piel + ': agitar el teléfono la marea');
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => document.getElementById('deckShutter').classList.contains('mareo')), false, 'se le pasa');
  await page.evaluate(() => document.getElementById('deckShutter').style.setProperty('--lt', '0deg'));

  // Doble guiño en la placa.
  const placa = await page.locator(part.placa).first().boundingBox();
  await page.evaluate(() => { window.__g = []; if (!window.__gWatch) window.__gWatch = new MutationObserver(() => window.__g.push(document.getElementById('deckShutter').classList.contains('guino'))).observe(document.getElementById('deckShutter'), { attributes: true, attributeFilter: ['class'] }) || true; });
  await page.mouse.click(placa.x + placa.width / 2, placa.y + placa.height / 2);
  await page.waitForTimeout(90);
  await page.mouse.click(placa.x + placa.width / 2, placa.y + placa.height / 2);
  await page.waitForTimeout(500);
  const guinos = await page.evaluate(() => window.__g.filter((v, i, a) => v && !a[i - 1]).length);
  assert.equal(guinos, 2, piel + ': dos toques en la placa, dos guiños');
  step(piel + ': mira, guarda, reacciona a la luz, duerme, se marea y guiña', { carrete: [derecha, izquierda], poca: luces.poca.ojoY, mucha: luces.mucha.ojoX });
}

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
    await page.waitForTimeout(900);
    await reacciones(page, 'interfaz');
    await reacciones(page, 'objeto');

    // La medida de la luz sale de la escena: negro → poca; blanco → mucha.
    const medida = await page.evaluate(() => {
      const w = 256, h = 192, out = {};
      for (const [name, v] of [['negro', 6], ['blanco', 245], ['medio', 120]]) {
        const src = new Uint8ClampedArray(w * h * 4).fill(v);
        delete document.body.dataset.luz;
        for (let i = 0; i < 40; i++) _fillCamLumBuf(src, w, h);
        out[name] = document.body.dataset.luz || '';
      }
      return out;
    });
    assert.deepEqual(medida, { negro: 'poca', blanco: 'mucha', medio: '' });
    step('la luz se mide en la escena', medida);

    // La piel OBJETO (seguimos en ella): el cuerpo y sus capas; pupila roja en video; grabando, sin cara.
    const verde = await page.evaluate(() => ({ objeto: getComputedStyle(document.body).getPropertyValue('--flip-acento').trim().toUpperCase() }));
    const capa = sel => page.evaluate(sel => { const node = sel === '::before' ? null : document.querySelector('#deckShutter ' + sel); const style = node ? getComputedStyle(node) : getComputedStyle(document.getElementById('deckShutter'), '::before'); return (style.backgroundImage.match(/[a-z-]+\.webp/) || [''])[0]; }, sel);
    const estados = { cuerpo: await capa('::before'), ojo: await capa('.m3-blanco'), pupila: await capa('.m3-pupila'), cerrado: await capa('.m3-cerrado') };
    const sb = await page.locator('#deckShutter').boundingBox();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down(); await page.waitForTimeout(120);
    estados.pulsada = await capa('::before');
    const pulsada = await eye(page, PARTS.objeto);
    await page.mouse.move(2, 2); await page.mouse.up(); await page.waitForTimeout(900);
    await page.evaluate(() => document.body.classList.add('cam-video'));
    estados.video = await capa('.m3-pupila');
    await page.evaluate(() => document.body.classList.add('is-recording'));
    estados.grabando = await capa('::before');
    const sinCara = await page.evaluate(() => getComputedStyle(document.querySelector('#deckShutter .m3')).display);
    await page.evaluate(() => document.body.classList.remove('cam-video', 'is-recording'));
    assert.deepEqual(estados, { cuerpo: 'mascota-cuerpo.webp', ojo: 'mascota-ojo.webp', pupila: 'mascota-pupila.webp', cerrado: 'mascota-ojo-cerrado.webp', pulsada: 'mascota-cuerpo-pulsado.webp', video: 'mascota-pupila-video.webp', grabando: 'disparador-mascota-grabando.webp' });
    assert.deepEqual([pulsada.abierto, sinCara], [0, 'none'], 'pulsada cierra el ojo; grabando no hay cara');
    // Las capas son renders del mismo encuadre: el blanco del ojo cae donde dice la hoja de estilos
    // (64,9 % × 49,7 %) y la pupila dentro de él.
    const piezas = await page.evaluate(async () => {
      const base = './brand/rollo-en-anil/materiales/', out = {};
      const centro = async name => {
        const response = await fetch(base + name + '.webp');
        if (!response.ok) return null;
        const bmp = await createImageBitmap(await response.blob()), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data; let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[4 * (y * c.width + x) + 3] > 200) { sx += x; sy += y; n++; }
        return n ? [+(sx / n / c.width * 100).toFixed(1), +(sy / n / c.height * 100).toFixed(1), +(n * 4 / (c.width * c.height) * 100).toFixed(1)] : [0, 0, 0];
      };
      for (const name of ['mascota-cuerpo', 'mascota-cuerpo-pulsado', 'mascota-ojo', 'mascota-pupila', 'mascota-pupila-video', 'mascota-ojo-cerrado', 'disparador-mascota', 'disparador-mascota-pulsado', 'disparador-mascota-video', 'disparador-mascota-grabando']) out[name] = await centro(name);
      return out;
    });
    for (const [name, c] of Object.entries(piezas)) assert.ok(c && c[2] > 0.5, 'falta la pieza ' + name);
    for (const name of ['mascota-ojo', 'mascota-pupila', 'mascota-pupila-video']) assert.ok(Math.abs(piezas[name][0] - 64.9) < 1.2 && Math.abs(piezas[name][1] - 49.7) < 1.2, name + ' no cae en el ojo: ' + piezas[name]);
    assert.ok(piezas['mascota-pupila'][2] < piezas['mascota-ojo'][2] && piezas['mascota-ojo'][2] < 8, 'las capas del ojo son solo el ojo: ' + JSON.stringify([piezas['mascota-ojo'], piezas['mascota-pupila']]));
    await page.evaluate(() => flipPiel.set('interfaz'));
    await page.waitForTimeout(500);
    const interfaz = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--si-acento').trim().toUpperCase());
    assert.deepEqual([interfaz, verde.objeto], ['#008048', '#008048'], 'el mismo verde en las dos pieles');
    step('piel OBJETO: la mascota en volumen, por capas', { ...estados, ojo: piezas['mascota-ojo'] });

    assert.deepEqual(errors, []);
    console.log('MASCOT PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
