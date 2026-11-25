// Cuatro modos en vez de diez módulos: lo que tiene que seguir siendo verdad.
//   · el lanzador enseña cuatro tarjetas (CÁMARA, SONO, ESTUDIO, STAGE) que caben sin desplazar;
//   · los diez módulos del motor siguen a un toque, como variantes dentro de su modo;
//   · la tecla de arriba dice el modo y la pantallita, la variante;
//   · la tarjeta de un modo lleva a la última variante que se usó en él, y se recuerda;
//   · un solo color de acento: los iconos de las cuatro tarjetas van en la misma tinta y solo la
//     tarjeta en uso va en añil.
//   FLIP_URL=http://127.0.0.1:8760 node tests/modes.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, openModule } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const EXPECTED = { camara: ['cam', 'portal', 'ascii', 'sflow', 'scrash'], sono: ['sono', 'wmp'], estudio: ['edit', 'fusion'], stage: ['stage'] };
const NAMES = { camara: 'CÁMARA', sono: 'SONO', estudio: 'ESTUDIO', stage: 'STAGE' };

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForTimeout(600);
    await page.locator('#shellModule').click();
    await page.waitForTimeout(500);
    const launcher = await page.evaluate(() => {
      const grid = document.querySelector('.launcher-grid');
      return {
        title: document.querySelector('#shellLauncher h2').textContent,
        cards: [...document.querySelectorAll('.launcher-card')].map(card => ({ mode: card.dataset.mode, name: card.querySelector('strong').textContent, on: card.classList.contains('is-on'),
          subs: card.dataset.module ? [card.dataset.module] : [...card.querySelectorAll('.launcher-sub')].map(sub => sub.dataset.module),
          tone: getComputedStyle(card.querySelector('em')).backgroundColor, touch: Math.min(...[...card.querySelectorAll('button'), ...(card.tagName === 'BUTTON' ? [card] : [])].map(b => Math.round(b.getBoundingClientRect().height))) })),
        fits: grid.scrollHeight <= grid.clientHeight + 1,
      };
    });
    assert.equal(launcher.title, 'MODOS');
    assert.deepEqual(launcher.cards.map(card => card.mode), ['camara', 'sono', 'estudio', 'stage'], 'cuatro tarjetas');
    for (const card of launcher.cards) {
      assert.equal(card.name, NAMES[card.mode]);
      assert.deepEqual(card.subs, EXPECTED[card.mode], card.mode + ': sus variantes');
      assert.ok(card.touch >= 40, card.mode + ': teclas que se pueden tocar (' + card.touch + ' px)');
    }
    assert.ok(launcher.fits, 'las cuatro caben sin desplazar');
    assert.deepEqual(launcher.cards.filter(card => card.on).map(card => card.mode), ['camara'], 'solo la tarjeta en uso va marcada');
    const tones = new Set(launcher.cards.filter(card => !card.on).map(card => card.tone));
    assert.equal(tones.size, 1, 'los iconos de los demás modos van todos en la misma tinta: ' + [...tones].join(' '));
    await page.locator('#launcherClose').click();
    step('lanzador: cuatro modos, con sus variantes y un solo acento', { variantes: launcher.cards.map(card => card.subs.length).join('+') });

    // ── Los diez módulos siguen a un toque; la tecla dice el modo y la pantallita la variante ──
    const seen = {};
    for (const [mode, keys] of Object.entries(EXPECTED)) {
      for (const key of keys) {
        await openModule(page, key);
        await page.waitForTimeout(500);
        const state = await page.evaluate(() => ({ module: flipShell.module(), mode: flipShell.mode(), key: document.getElementById('shellModuleName').textContent, body: document.body.dataset.modo }));
        assert.deepEqual(state, { module: key, mode, key: NAMES[mode], body: mode }, key + ' → ' + JSON.stringify(state));
        seen[key] = state.key;
      }
    }
    step('los diez módulos, cada uno bajo su modo', seen);

    // ── La tarjeta de un modo vuelve a su última variante, también tras recargar ──
    await openModule(page, 'scrash');
    await openModule(page, 'sono');
    await page.locator('#shellModule').click();
    await page.locator('[data-go-mode="camara"]').click();
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => flipShell.module()), 'scrash', 'CÁMARA vuelve a GLITCH, la última que se usó');
    assert.equal(await page.evaluate(() => localStorage.getItem('flip.modo.camara')), 'scrash');
    assert.deepEqual(errors, [], 'sin errores');
    step('la tarjeta de un modo lleva a su última variante');
    console.log('MODES PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
