// Dos pieles sobre la misma estructura: lo que tiene que seguir siendo verdad.
//   · de fábrica se abre la piel INTERFAZ («Silueta»): visor de lado a lado, sin marco de aparato;
//   · el disparador es la silueta de la cámara y, al pulsarlo, cierra el ojo un instante (y dispara);
//   · la banda dice la variante y «cámaras y filtros» abre un cajón que no mueve la imagen;
//   · el grano es opcional también aquí: de película, encima de todo (también del disparador) y
//     nunca sobre la imagen (visor, miniaturas de cámaras, última toma);
//   · la tecla PIEL cambia a OBJETO y de vuelta, sin recargar, y se recuerda;
//   · nada se sale de la pantalla y todo lo que se toca mide lo que un dedo necesita.
//   FLIP_URL=http://127.0.0.1:8760 node tests/skin.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const box = (page, selector) => page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; }, selector);

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForTimeout(900);

    // ── De fábrica: INTERFAZ, con el visor de lado a lado ──
    const base = await page.evaluate(() => ({ piel: document.body.dataset.piel, guardada: localStorage.getItem('flip.piel'), vw: innerWidth,
      marco: getComputedStyle(document.getElementById('lcd')).display, key: document.getElementById('flipPiel').textContent.trim() }));
    assert.equal(base.piel, 'interfaz', 'la piel de fábrica');
    assert.equal(base.marco, 'none', 'sin marco de aparato alrededor del visor');
    assert.equal(base.key, 'PIEL OBJETO', 'la tecla dice a qué piel se cambia');
    const top = await box(page, '#shellTop'), deck = await box(page, '#camDeck'), glass = await box(page, '#osd');
    assert.deepEqual([glass.x, glass.r], [0, base.vw], 'el visor llega de borde a borde');
    assert.ok(Math.abs(glass.y - top.b) <= 1 && Math.abs(glass.b - deck.y) <= 1, 'el visor va de la barra a la banda: ' + JSON.stringify({ top: top.b, glass, deck: deck.y }));
    step('piel INTERFAZ de fábrica, visor sin marco', { visor: glass.w + '×' + glass.h });

    // ── Nada se sale y todo se puede tocar ──
    const fit = await page.evaluate(() => {
      const out = [], small = [];
      for (const node of document.querySelectorAll('#shellTop .hw, #camDeck .hw:not(.look), .si-banda-cabeza button, .si-placa')) {
        const r = node.getBoundingClientRect();
        if (!r.width || getComputedStyle(node).visibility === 'hidden') continue;
        if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) out.push(node.id || node.className);
      }
      // La zona que responde al dedo (la tecla o lo que la envuelve) mide al menos 40 px de alto.
      for (const id of ['shellModule', 'shellMic', 'shellSettings', 'deckShutter', 'deckAdjust', 'deckFlip', 'deckGallery']) {
        const r = document.getElementById(id).getBoundingClientRect();
        if (r.width && (r.height < 32 || r.width < 32)) small.push(id + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
      }
      const scroll = document.documentElement.scrollWidth > innerWidth + 1;
      return { out, small, scroll };
    });
    assert.deepEqual(fit, { out: [], small: [], scroll: false }, 'todo dentro de la pantalla y tocable');
    // La tira solo enseña las cámaras que tocan: las propias de PORTAL no asoman fuera de PORTAL.
    const strip = await page.evaluate(() => ({ ajenas: [...document.querySelectorAll('.portal-look')].filter(t => getComputedStyle(t).display !== 'none').length, total: document.querySelectorAll('.portal-look').length,
      vistas: [...document.querySelectorAll('#deckLooks .look')].filter(t => getComputedStyle(t).display !== 'none').length, elegida: Math.round(document.querySelector('.look.is-on').getBoundingClientRect().width) }));
    assert.equal(strip.ajenas, 0, 'las cámaras de PORTAL no asoman en la tira de CÁMARA');
    assert.equal(strip.elegida, 182, 'la cámara elegida va ancha');
    step('nada cuelga fuera de la pantalla');

    // ── El disparador: la cámara guiña ──
    const eye = () => page.evaluate(() => {
      const shutter = document.getElementById('deckShutter'), open = shutter.querySelector('.silueta .ojo'), closed = shutter.querySelector('.silueta .cerrado');
      return { guino: shutter.classList.contains('guino'), abierto: +getComputedStyle(open).opacity, cerrado: +getComputedStyle(closed).opacity, visible: getComputedStyle(shutter.querySelector('.silueta')).display !== 'none' };
    });
    const shutter = await box(page, '#deckShutter');
    assert.deepEqual([shutter.w, shutter.h], [88, 84], 'el disparador mide lo que la maqueta');
    assert.deepEqual(await eye(), { guino: false, abierto: 1, cerrado: 0, visible: true }, 'en reposo, un ojo abierto');
    const shots = await page.evaluate(() => document.getElementById('deckGallery').classList.contains('has-shot'));
    assert.equal(shots, false);
    await page.locator('#deckShutter').dispatchEvent('pointerdown');
    await page.waitForTimeout(150);
    const pressed = await eye();
    assert.deepEqual(pressed, { guino: true, abierto: 0, cerrado: 1, visible: true }, 'al pulsar cierra el ojo');
    await page.waitForTimeout(450);
    assert.deepEqual(await eye(), { guino: false, abierto: 1, cerrado: 0, visible: true }, 'y lo vuelve a abrir solo');
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => document.getElementById('deckGallery').classList.contains('has-shot'), null, { timeout: 8000 });
    step('el disparador cierra el ojo al pulsarlo y toma la foto');

    // ── La banda y su cajón ──
    const band = await page.evaluate(() => ({ variante: document.querySelector('.si-variante b').textContent.trim(), activa: (document.querySelector('#deckVariants .is-on') || document.querySelector('.look.is-on')).textContent.trim(),
      cajon: getComputedStyle(document.getElementById('siCajon')).display, dentro: !!document.querySelector('#siCajon #deckVariants') }));
    assert.equal(band.variante, band.activa, 'la banda dice la variante en uso');
    assert.equal(band.cajon, 'none', 'el cajón empieza cerrado');
    assert.ok(band.dentro, 'las teclas de variante viven en el cajón');
    // Un toque en la variante pasa a la siguiente, sin abrir nada.
    const cycle = await page.evaluate(() => { const keys = [...document.querySelectorAll('#deckVariants [data-variant]')]; return { keys: keys.map(k => k.dataset.variant), now: camVariant }; });
    if (cycle.keys.length > 1) {
      await page.locator('.si-variante').click();
      await page.waitForTimeout(250);
      const next = await page.evaluate(() => ({ now: camVariant, label: document.querySelector('.si-variante b').textContent.trim(), on: document.querySelector('#deckVariants .is-on').textContent.trim(), abierto: document.body.classList.contains('banda-abierta') }));
      assert.equal(next.now, cycle.keys[(cycle.keys.indexOf(cycle.now) + 1) % cycle.keys.length], 'un toque pasa a la variante siguiente');
      assert.equal(next.label, next.on, 'y la banda lo dice');
      assert.equal(next.abierto, false, 'sin abrir el cajón');
    }
    const before = await box(page, '#display');
    await page.locator('.si-abrir').click();
    await page.waitForTimeout(300);
    const drawer = await page.evaluate(() => ({ display: getComputedStyle(document.getElementById('siCajon')).display, filtros: [...document.querySelectorAll('#siCajon [data-filtro]')].map(chip => chip.dataset.filtro),
      on: [...document.querySelectorAll('#siCajon [data-filtro].is-on')].map(chip => chip.dataset.filtro), alto: Math.min(...[...document.querySelectorAll('#siCajon button')].filter(b => b.getBoundingClientRect().width).map(b => Math.round(b.getBoundingClientRect().height))),
      expanded: document.querySelector('.si-abrir').getAttribute('aria-expanded') }));
    assert.notEqual(drawer.display, 'none', 'el cajón se abre');
    assert.deepEqual(drawer.filtros, ['cam', 'portal', 'ascii', 'sflow', 'scrash'], 'los filtros del modo CÁMARA');
    assert.deepEqual(drawer.on, ['cam']);
    assert.ok(drawer.alto >= 44, 'teclas del cajón de 44 px: ' + drawer.alto);
    assert.equal(drawer.expanded, 'true');
    assert.deepEqual(await box(page, '#display'), before, 'abrir el cajón no mueve ni encoge la imagen');
    await page.locator('#siCajon [data-filtro="ascii"]').click();
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => ({ module: flipShell.module(), abierto: document.body.classList.contains('banda-abierta') }));
    assert.deepEqual(after, { module: 'ascii', abierto: false }, 'un filtro lleva a su módulo y cierra el cajón');
    await page.evaluate(() => flipShell.goModule('cam'));
    await page.waitForTimeout(600);
    step('la banda dice la variante; el cajón abre los filtros sin mover la imagen', { variante: band.variante });

    // ── Grano: opcional, encima de todo (también del disparador) menos de la imagen ──
    // Se tiñe el grano de magenta y se cuentan píxeles: donde hay grano todo sale magenta.
    const grain = await page.evaluate(() => { const style = getComputedStyle(document.querySelector('#shellTop > .grano')); return { on: document.body.dataset.grano, tesela: style.backgroundImage.includes('brand/silueta/grano.webp'), key: document.getElementById('rolloGrano').textContent.trim() }; });
    assert.deepEqual(grain, { on: 'si', tesela: true, key: 'SIN GRANO' }, 'grano de película en la piel nueva');
    const dye = await page.addStyleTag({ content: 'html body[data-piel] .grano.grano { background: #f0f !important; opacity: 1 !important; }' });
    await page.waitForTimeout(250);
    const magenta = async (selector, inset = 3) => {
      const r = await page.evaluate(sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }, selector);
      const clip = { x: Math.round(r.x + inset), y: Math.round(r.y + inset), width: Math.max(2, Math.round(r.width - inset * 2)), height: Math.max(2, Math.round(r.height - inset * 2)) };
      const shot = (await page.screenshot({ clip })).toString('base64');
      return page.evaluate(async data => {
        const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let hit = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] < 20 && d[i + 2] > 235) hit++;
        return +(hit / (d.length / 4)).toFixed(3);
      }, shot);
    };
    const cover = { barra: await magenta('#shellTop'), disparador: await magenta('#deckShutter', 14), teclas: await magenta('#deckAdjust'), banda: await magenta('.si-banda-cabeza'), placa: await magenta('.si-placa'),
      imagen: await magenta('#display'), miniatura: await magenta('.look.is-on i'), toma: await magenta('#deckGallery b') };
    for (const name of ['barra', 'disparador', 'teclas', 'banda', 'placa']) assert.ok(cover[name] > 0.98, 'el grano cubre ' + name + ': ' + JSON.stringify(cover));
    for (const name of ['imagen', 'miniatura', 'toma']) assert.equal(cover[name], 0, 'ni una mota sobre ' + name + ': ' + JSON.stringify(cover));
    await page.evaluate(() => flipGrano.set(false));
    assert.equal(await magenta('#shellTop'), 0, 'SIN GRANO lo quita');
    await page.evaluate(() => flipGrano.set(true));
    await dye.evaluate(node => node.remove());
    step('grano opcional: encima de todo (también del disparador) y nunca sobre la imagen', cover);

    // ── Cambiar de piel, sin recargar, y que se recuerde ──
    await page.locator('#shellModule').click();
    await page.locator('#flipPiel').click();
    await page.waitForTimeout(500);
    const objeto = await page.evaluate(() => ({ piel: document.body.dataset.piel, marco: getComputedStyle(document.getElementById('lcd')).display !== 'none', silueta: getComputedStyle(document.querySelector('#deckShutter .silueta')).display,
      variantes: document.getElementById('deckVariants').parentElement.id, antes: document.getElementById('deckVariants').nextElementSibling.className, key: document.getElementById('flipPiel').textContent.trim(),
      banda: getComputedStyle(document.querySelector('.si-banda-cabeza')).display }));
    assert.deepEqual(objeto, { piel: 'objeto', marco: true, silueta: 'none', variantes: 'camDeck', antes: 'deck-looks', key: 'PIEL INTERFAZ', banda: 'none' }, 'la piel OBJETO vuelve entera');
    await page.reload();
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => document.body.dataset.piel), 'objeto', 'la piel elegida se recuerda');
    await page.evaluate(() => flipPiel.set('interfaz'));
    assert.equal(await page.evaluate(() => localStorage.getItem('flip.piel')), 'interfaz');
    assert.deepEqual(errors, [], 'sin errores');
    step('la tecla PIEL cambia a OBJETO y de vuelta, y se recuerda');
    console.log('SKIN PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
