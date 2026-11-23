// Las consolas de ajustes: nada se desplaza, nada tapa la imagen y cada mando gobierna el de siempre.
//   · CAM: en cada cámara y en cada sección, todo cabe en la placa (ningún mando se sale, no hay
//     scroll ni queda a la vista un deslizador nativo) y la placa no pisa el visor;
//   · gestos: girar una perilla mueve su valor y la pantallita lo dice; dos toques la devuelven al
//     valor de fábrica; el interruptor y el selector cambian de opción; las teclas eligen; LISTO y
//     Escape cierran;
//   · los demás módulos (SONO, WMP, FUSION, GLITCH, FLOW): su panel es una placa sin scroll, con una
//     perilla por cada deslizador y una tecla por cada botón, y girar o pulsar cambia el módulo.
//   FLIP_URL=http://127.0.0.1:8760 node tests/console.cjs [--shots carpeta]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip, openModule } = require('./lib/harness.cjs');
const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

async function main() {
  const browser = await launch();
  try {
    let { page, errors, context } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
    const settle = ms => page.waitForTimeout(ms);
    const shot = name => shots ? page.screenshot({ path: path.join(shots, name + '.png') }) : null;
    const centre = selector => page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, selector);
    const value = id => page.evaluate(id => Number(document.getElementById(id).value), id);
    const turn = async (selector, dy) => {
      const [x, y] = await centre(selector);
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(x, y - dy * i / 8);
      return [x, y];
    };
    await settle(700);

    // 1 · CAM: cámara por cámara y sección por sección, todo cabe y nada se desplaza.
    const families = await page.evaluate(() => Object.keys(CAM_FAMILIES));
    const seen = {};
    for (const family of families) {
      await page.evaluate(f => { _setCamFamily(f); }, family);
      await settle(250);
      await page.locator('#deckAdjust').click();
      await settle(450);
      const sections = await page.evaluate(() => flipConsole.state().sections);
      assert.ok(sections.includes('frame') && sections.includes('stickers'), family + ': secciones ' + sections);
      for (const section of sections) {
        await page.evaluate(sec => flipConsole.section(sec), section);
        await settle(200);
        const report = await page.evaluate(() => {
          const host = document.getElementById('palettes'), plate = host.getBoundingClientRect(), glass = display.getBoundingClientRect();
          const shown = el => !!el.offsetParent && getComputedStyle(el).visibility !== 'hidden';
          const out = [];
          for (const el of host.querySelectorAll('.cs-knob, .cs-toggle, .cs-key, .cs-keys button, .pal-swatch, .pcs-slot, [class$="-lbl"], [class$="-val"]')) {
            if (!shown(el)) continue;
            const box = el.getBoundingClientRect();
            if (box.left < plate.left - 1 || box.right > plate.right + 1 || box.top < plate.top - 1 || box.bottom > plate.bottom + 1) out.push((el.id || el.className || el.textContent).toString().slice(0, 28));
          }
          const scrolls = [host, ...host.querySelectorAll('.cs-pane')].filter(el => shown(el) && el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)).map(el => el.id);
          const ranges = [...host.querySelectorAll('input[type="range"]')].filter(el => shown(el) && el.getBoundingClientRect().width > 4 && getComputedStyle(el).opacity !== '0').map(el => el.id);
          return { out, scrolls, ranges, overGlass: plate.top < glass.bottom - 1, plate: [Math.round(plate.width), Math.round(plate.height)], knobs: flipConsole.state().knobs.length, view: [innerWidth, innerHeight] };
        });
        assert.deepEqual(report.out, [], family + ' · ' + section + ': mandos fuera de la placa');
        assert.deepEqual(report.scrolls, [], family + ' · ' + section + ': algo se desplaza');
        assert.deepEqual(report.ranges.filter(id => id !== 'camStickerSize'), [], family + ' · ' + section + ': queda un deslizador a la vista');
        assert.equal(report.overGlass, false, family + ' · ' + section + ': la placa pisa el visor');
        assert.ok(report.plate[0] <= report.view[0] && report.plate[1] <= report.view[1] * 0.42, family + ': la placa cabe · ' + JSON.stringify(report));
        if (section === 'cam') { seen[family] = report.knobs; assert.ok(report.knobs <= 10, family + ': como mucho diez perillas a la vista'); }
      }
      await shot('cam-' + family);
      await page.keyboard.press('Escape');
      await settle(250);
      assert.equal(await page.evaluate(() => document.body.classList.contains('cam-edit-open')), false, family + ': Escape cierra la consola');
    }
    step('CAM: cada sección de cada cámara cabe en la placa, sin scroll', seen);

    // 2 · Gestos.
    await page.evaluate(() => { _setCamFamily('STAMP'); });
    await page.locator('#deckAdjust').click();
    await settle(450);
    const before = await value('stampEngrave');
    let [x, y] = await turn('#stampEditPanel .cs-slot:has(#stampEngrave) .cs-knob', 64);
    const lcd = await page.evaluate(() => ({ on: document.getElementById('shellLcd').classList.contains('is-readout'), param: document.getElementById('lcdParam').textContent, value: document.getElementById('lcdValue').textContent, bar: document.querySelectorAll('#lcdBar > i.on').length, tall: document.getElementById('lcdBar').firstElementChild.getBoundingClientRect().height }));
    await shot('gesto-girar');
    await page.mouse.up();
    const after = await value('stampEngrave');
    assert.ok(after > before + 20 && after <= 100, 'girar hacia arriba sube el valor: ' + before + ' → ' + after);
    assert.equal(await page.evaluate(() => stampEngraveVal), after, 'la cámara recibe el valor');
    assert.ok(lcd.on && /GRABADO/.test(lcd.param) && Number(lcd.value) > before, 'la pantallita dice qué se mueve y cuánto: ' + JSON.stringify(lcd));
    assert.ok(lcd.bar > 8 && lcd.tall > 3, 'y su barra se ve: ' + JSON.stringify(lcd));
    await page.mouse.click(x, y);
    await settle(120);
    await page.mouse.click(x, y);
    await settle(150);
    assert.equal(await value('stampEngrave'), 62, 'dos toques: el valor de fábrica');
    step('perilla: girar, pantallita y doble toque', { de: before, a: after, lcd });

    const frame = await page.evaluate(() => stampFrameMode);
    await page.locator('#stampEditPanel .cs-toggle').click();
    await settle(150);
    assert.notEqual(await page.evaluate(() => stampFrameMode), frame, 'el interruptor cambia el marco');
    await page.locator('#stampEditPanel .cs-toggle').click();
    await page.locator('#stampEditPanel [data-stamppal]').nth(2).click();
    await settle(150);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#stampEditPanel [data-stamppal].active').length), 1, 'una tecla de paleta con piloto');
    await page.locator('#csSections [data-sec="frame"]').click();
    await settle(200);
    assert.equal(await page.evaluate(() => flipConsole.state().section), 'frame');
    const fps = await value('camFpsSlider');
    await turn('#camFpsCtrl .cs-knob', -48);
    await page.mouse.up();
    assert.ok(await value('camFpsSlider') < fps, 'girar hacia abajo baja la cadencia');
    await page.locator('#camAspect .asp-btn[data-aw="16"]').click();
    await settle(300);
    assert.equal(await page.evaluate(() => _getCurrentAspectId()), '16:9', 'la tecla de formato elige');
    await page.locator('#btnCamEditClose').click();
    await settle(300);
    assert.equal(await page.evaluate(() => document.body.classList.contains('cam-edit-open')), false, 'LISTO cierra la consola');
    await page.evaluate(() => { applyCamAspect(4, 3); _setCamFamily('AUTO03'); });
    await page.locator('#deckAdjust').click();
    await settle(400);
    const tone = await page.evaluate(() => auto03ToneMode);
    [x, y] = await centre('#auto03EditPanel .cs-knob');
    await page.mouse.click(x, y);
    await settle(450);
    assert.notEqual(await page.evaluate(() => auto03ToneMode), tone, 'un toque en el selector pasa a la opción siguiente');
    await page.keyboard.press('Escape');
    step('interruptor, teclas, secciones, selector y LISTO');
    assert.deepEqual(errors, [], 'sin errores en CAM');
    await context.close();

    // 3 · Los demás módulos: su panel es una placa sin scroll que gobierna los mandos de siempre.
    const modules = [
      ['sono', 'sonoHUD', 'sonoMix', null],
      ['wmp', 'wmpHUD', 'wmpTrails', null],
      ['fusion', 'fusionHUD', 'fusionReact', null],
      ['scrash', 'scrashControls', 'scrChroma', 1],
      ['sflow', 'sflowHUD', 'sflowFill', null],
    ];
    const racks = {};
    for (const [key, hud, knobId, knobPage] of modules) {
      ({ page, errors, context } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } }));
      await page.waitForTimeout(500);
      await openModule(page, key);
      await page.waitForTimeout(1100);
      if (key === 'sflow') { await page.locator('#sflowAdjust').click(); await page.waitForTimeout(400); }
      const rack = '#' + hud + ' > .cs-rack';
      const report = await page.evaluate(({ hud }) => {
        const host = document.getElementById(hud), rack = host.querySelector(':scope > .cs-rack'), plate = rack.getBoundingClientRect();
        const shown = el => !!el.offsetParent && getComputedStyle(el).visibility !== 'hidden';
        const out = [...rack.querySelectorAll('.cs-knob, .cs-toggle, .cs-key')].filter(el => shown(el) && (el.getBoundingClientRect().left < plate.left - 1 || el.getBoundingClientRect().right > plate.right + 1)).length;
        const bar = [...document.querySelectorAll('#flipBottomNav, #barSflow')].find(shown);
        return {
          visible: shown(rack), plate: [Math.round(plate.left), Math.round(plate.top), Math.round(plate.width), Math.round(plate.height)], view: [innerWidth, innerHeight], out,
          scroll: [host, rack].some(el => el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)),
          ranges: [...host.querySelectorAll('input[type="range"]')].filter(shown).length,
          sliders: host.querySelectorAll('input[type="range"]').length, knobs: rack.querySelectorAll('.cs-knob').length,
          keys: rack.querySelectorAll('.cs-key:not(.cr-tab)').length, pages: rack.querySelectorAll('.cr-page').length,
          overBar: bar ? plate.bottom > bar.getBoundingClientRect().bottom : false,
        };
      }, { hud });
      assert.ok(report.visible, key + ': la placa está a la vista');
      assert.equal(report.scroll, false, key + ': nada se desplaza');
      assert.equal(report.ranges, 0, key + ': no queda ningún deslizador a la vista');
      assert.equal(report.out, 0, key + ': ningún mando se sale de la placa');
      assert.ok(report.plate[0] >= 0 && report.plate[0] + report.plate[2] <= report.view[0] && report.plate[1] > 40 && !report.overBar, key + ': la placa cabe en la pantalla · ' + JSON.stringify(report));
      assert.equal(report.knobs, report.sliders, key + ': una perilla por deslizador · ' + JSON.stringify(report));
      // Girar una perilla cambia el valor del módulo, y su rótulo de valor lo dice.
      if (knobPage !== null) { await page.locator(rack + ' .cr-tab[data-page="' + knobPage + '"]').click(); await page.waitForTimeout(250); }
      assert.ok(await page.evaluate(id => { const knob = flipConsole.knob(id); return !!knob && !!knob.offsetParent && getComputedStyle(knob).visibility !== 'hidden'; }, knobId), key + ': la perilla de ' + knobId + ' está a la vista');
      const was = await page.evaluate(id => Number(document.getElementById(id).value), knobId);
      const up = await page.evaluate(id => { const el = document.getElementById(id); return Number(el.value) < (Number(el.min || 0) + Number(el.max || 100)) / 2; }, knobId);
      const box = await page.evaluate(id => { const r = flipConsole.knob(id).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, knobId);
      await page.mouse.move(box[0], box[1]);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(box[0], box[1] + (up ? -7 : 7) * i);
      await page.mouse.up();
      await page.waitForTimeout(250);
      const now = await page.evaluate(id => Number(document.getElementById(id).value), knobId);
      assert.ok(up ? now > was : now < was, key + ': girar mueve ' + knobId + ' · ' + was + ' → ' + now);
      const label = await page.evaluate(id => flipConsole.knob(id).parentElement.querySelector('.cr-val').textContent, knobId);
      assert.ok(label.includes(String(now)), key + ': el valor de la placa sigue al del módulo · «' + label + '» / ' + now);
      // Pulsar una tecla apagada la enciende en el módulo (y en la placa).
      if (knobPage !== null) { await page.locator(rack + ' .cr-tab[data-page="0"]').click(); await page.waitForTimeout(250); }
      const key2 = await page.evaluate(({ hud }) => {
        const rack = document.querySelector('#' + hud + ' > .cs-rack');
        const groups = [...rack.querySelectorAll('.cr-page.is-on .cr-keys')].filter(group => group.querySelector('.cs-key.is-on') && group.querySelector('.cs-key:not(.is-on)'));
        if (!groups.length) return null;
        const target = groups[0].querySelector('.cs-key:not(.is-on)');
        target.dataset.probe = '1';
        return target.textContent;
      }, { hud });
      if (key2) {
        await page.locator(rack + ' .cs-key[data-probe="1"]').click();
        await page.waitForTimeout(350);
        assert.equal(await page.evaluate(({ hud }) => document.querySelector('#' + hud + ' .cs-key[data-probe="1"]').classList.contains('is-on'), { hud }), true, key + ': la tecla ' + key2 + ' se enciende');
      }
      await (shots ? page.screenshot({ path: path.join(shots, 'modulo-' + key + '.png') }) : null);
      assert.deepEqual(errors, [], key + ': sin errores');
      racks[key] = { perillas: report.knobs, teclas: report.keys, paginas: report.pages, alto: report.plate[3], giro: was + '→' + now, tecla: key2 };
      await context.close();
    }
    step('SONO, WMP, FUSION, GLITCH y FLOW: placa sin scroll, perillas y teclas que gobiernan el módulo', racks);

    console.log('PASS · consolas de ajustes');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
