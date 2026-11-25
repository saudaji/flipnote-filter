// Tacto: el sonido y la vibración de las teclas (docs/feel.js).
// Comprueba que cada sonido es un clic y no una nota, la jerarquía (disparador, teclas, botones,
// interruptor, muescas), que nada suena sin un dedo, que no se pisan y que al grabar las teclas callan.
//   FLIP_URL=http://127.0.0.1:8760 node tests/feel.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip } = require('./lib/harness.cjs');

async function main() {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
    await page.evaluate(() => { window.__vib = []; navigator.vibrate = pattern => { window.__vib.push(pattern); return true; }; });
    const history = [];
    const take = async () => { const fresh = await page.evaluate(() => ({ log: flipFeel.log(true), vib: window.__vib.splice(0) })); history.push(...fresh.log); return fresh; };
    const center = async selector => { const box = await page.locator(selector).first().boundingBox(); return [box.x + box.width / 2, box.y + box.height / 2]; };
    const press = async (selector, hold = 70) => {
      const [x, y] = await center(selector);
      await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(hold); await page.mouse.up();
      await page.waitForTimeout(160);
    };
    await page.waitForTimeout(400);
    await take();
    const kinds = await page.evaluate(() => flipFeel.kinds());
    assert.equal((await page.evaluate(() => flipFeel.state())).built, true, 'los sonidos están sintetizados');

    // 0 · Un clic, no una nota. De cada receta y cada variante se mide: lo afinada que está
    // (autocorrelación entre 0,15 y 5 ms: una nota da 0,5 o más; una tecla o un obturador reales
    // grabados, entre 0,1 y 0,3), lo que tarda el golpe en caer 30 dB y cuánta energía se va a los
    // medios y agudos, que es donde vive el chasquido del plástico.
    const clicks = await page.evaluate(() => {
      const rate = 48000, rows = [];
      for (const name of flipFeel.recipes()) {
        for (let variant = 0; variant < 3; variant++) {
          const x = flipFeel.render(name, variant), n = x.length;
          let peak = 0, at = 0, r0 = 0;
          for (let i = 0; i < n; i++) { const v = Math.abs(x[i]); r0 += v * v; if (v > peak) { peak = v; at = i; } }
          let last = at;
          for (let i = at; i < n; i++) if (Math.abs(x[i]) > peak * 0.0316) last = i;
          let pitch = 0, crossed = false;
          for (let lag = 2; lag <= rate * 0.005; lag++) {
            let r = 0;
            for (let i = lag; i < n; i++) r += x[i] * x[i - lag];
            r /= r0;
            if (r < 0) crossed = true;
            if (crossed && lag >= rate * 0.00015 && r > pitch) pitch = r;
          }
          // Energía por encima de 1 kHz: lo que queda tras un paso alto de un polo.
          let high = 0, y = 0, prev = 0;
          const k = Math.exp(-2 * Math.PI * 1000 / rate);
          for (let i = 0; i < n; i++) { y = k * (y + x[i] - prev); prev = x[i]; high += y * y; }
          rows.push({ name, variant, peak: +peak.toFixed(2), ring: +((last - at) / rate * 1000).toFixed(1), pitch: +pitch.toFixed(2), high: +(high / r0).toFixed(2), ms: +(n / rate * 1000).toFixed(0) });
        }
      }
      return rows;
    });
    for (const c of clicks) {
      const id = c.name + '#' + c.variant;
      assert.ok(c.pitch < 0.45, id + ': suena a nota (afinado ' + c.pitch + ')');
      assert.ok(c.ring <= 32, id + ': el golpe se alarga ' + c.ring + ' ms');
      assert.ok(c.peak > 0.8 && c.peak <= 0.91, id + ': pico ' + c.peak);
      assert.ok(c.ms <= 220, id + ': dura ' + c.ms + ' ms');
    }
    const key = clicks.find(c => c.name === 'keyDown'), soft = clicks.find(c => c.name === 'softDown');
    assert.ok(key.high > 0.5, 'la tecla chasquea: ' + key.high + ' de su energía por encima de 1 kHz');
    assert.ok(soft.high < key.high, 'el botón redondo es más sordo que la tecla');

    // 1 · Botón redondo (secundario): baja y sube, sordo, con un pulso corto.
    await press('#deckAdjust');
    let got = await take();
    assert.deepEqual(got.log.map(e => [e.kind, e.phase, e.sound]), [['soft', 'down', 'softDown'], ['soft', 'up', 'softUp']]);
    assert.deepEqual(got.vib, [6], 'un pulso al bajar, ninguno al subir');
    // 2 · Tecla (LISTO): clic al bajar, clac al subir, más peso que el botón redondo.
    await press('#btnCamEditClose');
    got = await take();
    assert.deepEqual(got.log.map(e => [e.kind, e.phase, e.sound]), [['key', 'down', 'keyDown'], ['key', 'up', 'keyUp']]);
    assert.ok(got.log[0].gain > kinds.soft.down.gain && got.vib[0] > 6, 'la tecla pesa más que el botón redondo');

    // 3 · Disparador en foto: hundirlo y, al soltar, la cortinilla con su doble pulso.
    await press('#deckShutter', 90);
    await page.waitForTimeout(500);
    got = await take();
    assert.deepEqual(got.log.map(e => [e.kind, e.phase, e.sound]), [['shutter', 'down', 'shutterDown'], ['shutter', 'fire', 'shutterFire']]);
    assert.deepEqual(got.vib, [14, [9, 37, 13]]);
    assert.ok(got.log[0].gain > kinds.key.down.gain, 'el disparador es lo que más suena');

    // 4 · Una diapositiva vive en una bandeja que se desplaza: tocarla no suena, elegirla sí.
    await page.locator('#deckLooks [data-family="DLPHN"]').scrollIntoViewIfNeeded();   // en la piel INTERFAZ la tira es un carrusel
    await page.waitForTimeout(350);
    await take();
    const [lx, ly] = await center('#deckLooks [data-family="DLPHN"]');
    await page.mouse.move(lx, ly); await page.mouse.down(); await page.waitForTimeout(60);
    assert.equal((await take()).log.length, 0, 'tocar una diapositiva no suena');
    await page.mouse.up(); await page.waitForTimeout(120);
    got = await take();
    assert.deepEqual(got.log.map(e => [e.kind, e.sound]), [['slide', 'slide']]);
    assert.deepEqual(got.vib, [[3, 19, 6]]);

    // 5 · Un cambio automático (clic por código) no suena ni vibra.
    await page.evaluate(() => { document.getElementById('deckAdjust').click(); document.getElementById('deckAdjust').click(); });
    await page.waitForTimeout(120);
    got = await take();
    assert.equal(got.log.length + got.vib.length, 0, 'lo que no pulsa un dedo no suena');

    // 6 · Muescas: como mucho una cada 30 ms por mucho que se pida.
    assert.equal(await page.evaluate(() => { let n = 0; for (let i = 0; i < 40; i++) if (flipFeel.detent(120)) n++; return n; }), 1);
    await take();
    // …y una perilla marca las suyas al girarla (la de la cadencia, en la sección CUADRO de la consola).
    await press('#deckAdjust');
    await page.evaluate(() => { flipConsole.section('frame'); const fps = document.getElementById('camFpsSlider'); fps.value = '24'; fps.dispatchEvent(new Event('input', { bubbles: true })); });
    await take();
    const box = await page.locator('#camFpsCtrl .cs-knob').boundingBox();
    const kx = box.x + box.width / 2, ky = box.y + box.height / 2;
    await page.mouse.move(kx, ky); await page.mouse.down();
    for (let step = 1; step <= 14; step++) { await page.mouse.move(kx, ky + 8 * step); await page.waitForTimeout(45); }
    await page.mouse.up(); await page.waitForTimeout(120);
    got = await take();
    const ticks = got.log.filter(e => e.kind === 'tick');
    assert.ok(ticks.length >= 4 && ticks.length <= 22, 'muescas de la perilla: ' + ticks.length);
    assert.equal(got.log.some(e => e.kind === 'key' || e.kind === 'soft'), false, 'girar una perilla no suena a tecla');
    for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].at - ticks[i - 1].at >= 29, 'muescas espaciadas');
    assert.ok(ticks.every(e => e.gain <= kinds.tick.down.gain + 0.001), 'una muesca es lo más discreto');
    await press('#btnCamEditClose');
    await take();

    // 7 · Interruptor FOTO/VÍDEO: doble chasquido al cambiar.
    await press('#deckModeSwitch');
    got = await take();
    assert.deepEqual(got.log.map(e => [e.kind, e.sound]), [['switch', 'switch']]);
    assert.deepEqual(got.vib, [[4, 30, 8]]);

    // 8 · Grabando, las teclas callan: queda la vibración. Al parar, dos pulsos.
    await press('#deckShutter', 90);
    await page.waitForFunction(() => document.body.classList.contains('is-recording'), null, { timeout: 15000 });
    got = await take();
    assert.equal(got.log[0].sound, 'shutterDown', 'el arranque suena: aún no se graba');
    assert.equal(got.log.some(e => e.phase === 'fire'), false, 'en vídeo no hay cortinilla');
    await page.waitForTimeout(700);
    await press('#deckAdjust');
    got = await take();
    assert.ok(got.log.length >= 1 && got.log.every(e => e.sound === ''), 'grabando no suena ninguna tecla');
    assert.deepEqual(got.vib, [6], 'pero se sigue notando');
    await press('#btnCamEditClose');
    await take();
    await press('#deckShutter', 90);
    got = await take();
    assert.ok(got.log.every(e => e.sound === ''), 'parar tampoco suena');
    assert.deepEqual(got.vib, [14, [10, 45, 10]]);
    await page.waitForFunction(() => !document.body.classList.contains('is-recording'), null, { timeout: 20000 });
    await page.waitForTimeout(600);
    await press('#deckModeSwitch');
    await take();

    // 9 · Con el micrófono abierto las teclas bajan (el altavoz se cuela en él).
    await page.evaluate(async () => { window.__mic = await navigator.mediaDevices.getUserMedia({ audio: true }); });
    await press('#deckAdjust');
    got = await take();
    assert.ok(Math.abs(got.log[0].gain - kinds.soft.down.gain * 0.3) < 0.01, 'micrófono abierto: ' + got.log[0].gain);
    await page.evaluate(() => window.__mic.getTracks().forEach(track => track.stop()));
    await press('#btnCamEditClose');
    got = await take();
    assert.ok(Math.abs(got.log[0].gain - kinds.key.down.gain) < 0.12, 'micrófono cerrado: vuelve el volumen');

    // 10 · Los dos ajustes: sonido y vibración.
    await press('#shellSettings');
    await page.locator('#flipFeelPills [data-feel-pref="sound"]').click();
    assert.equal((await page.evaluate(() => flipFeel.prefs())).sound, false);
    assert.equal(await page.locator('#flipFeelPills [data-feel-pref="sound"]').getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => _toggleFlipSettings(false));
    await page.waitForTimeout(350);
    await take();
    await press('#deckAdjust');
    got = await take();
    assert.ok(got.log.every(e => e.sound === '') && got.vib.length === 1, 'sin sonido sigue la vibración');
    await page.evaluate(() => flipFeel.set({ sound: true, haptic: false }));
    await press('#btnCamEditClose');
    got = await take();
    assert.ok(got.log[0].sound === 'keyDown' && got.vib.length === 0, 'sin vibración sigue el sonido');
    await page.evaluate(() => flipFeel.set({ sound: true, haptic: true }));

    // 11 · Nunca dos sonidos encima: si coinciden, solo pasa el de más rango.
    const sounded = history.filter(e => e.sound).sort((a, b) => a.at - b.at);
    for (let i = 1; i < sounded.length; i++) {
      const gap = sounded[i].at - sounded[i - 1].at;
      assert.ok(gap >= 21 || kinds[sounded[i].kind].rank > kinds[sounded[i - 1].kind].rank, 'sonidos pisados: ' + JSON.stringify([sounded[i - 1], sounded[i]]));
    }
    assert.deepEqual(errors, []);
    console.log('PASS · tacto · ' + history.length + ' toques revisados, ' + sounded.length + ' con sonido · afinado máximo ' + Math.max(...clicks.map(c => c.pitch)) + ', golpe más largo ' + Math.max(...clicks.map(c => c.ring)) + ' ms');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
