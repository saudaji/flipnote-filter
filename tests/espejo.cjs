// La cámara frontal se ve como un espejo (igual que en la cámara del teléfono), en la vista y en lo
// que se guarda; la trasera, no. Antes las cámaras de la pestaña CÁMARA nunca espejaban —STAGE y
// PORTAL sí—, y con la frontal, al moverse a un lado la imagen se iba al otro.
//
//   FLIP_URL=http://127.0.0.1:8760 node tests/espejo.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip } = require('./lib/harness.cjs');

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForFunction(() => typeof _renderCamEngineFrame === 'function' && typeof camMirror === 'function' && vid.videoWidth > 0);
    await page.waitForTimeout(600);

    // 1 · Cada cámara obedece la orden de espejo: una fuente con la luz a la izquierda sale con la luz
    //     a la izquierda, y espejada, a la derecha.
    const engines = await page.evaluate(async () => {
      const src = document.createElement('canvas'); src.width = 640; src.height = 480;
      const sx = src.getContext('2d'); sx.fillStyle = '#16181c'; sx.fillRect(0, 0, 640, 480);
      const g = sx.createLinearGradient(0, 0, 300, 0); g.addColorStop(0, '#f4ead8'); g.addColorStop(1, '#8a7f70'); sx.fillStyle = g; sx.fillRect(0, 0, 300, 480);
      const out = document.createElement('canvas'); out.width = 640; out.height = 480; const ctx = out.getContext('2d', { willReadFrequently: true });
      const side = () => { const d = ctx.getImageData(0, 0, 640, 480).data; let l = 0, r = 0; for (let y = 40; y < 440; y += 8) for (let x = 20; x < 620; x += 8) { const i = 4 * (y * 640 + x), v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; if (x < 320) l += v; else r += v; } return l - r; };
      const wait = ms => new Promise(ok => setTimeout(ok, ms)), rows = {};
      for (const family of Object.keys(CAM_FAMILIES)) {
        const list = CAM_FAMILIES[family].variants || [], variant = list.length ? list[0].id : undefined, shot = [];
        for (const mirror of [false, true]) {
          let v = 0;
          for (let k = 0; k < 4; k++) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 640, 480); _renderCamEngineFrame(src, 640, 480, ctx, mirror, { family, variant, path: 'preview', now: performance.now() }); await wait(60); v = side(); }
          shot.push(Math.round(v));
        }
        rows[family] = shot;
      }
      return rows;
    });
    for (const [family, [plain, flipped]] of Object.entries(engines)) assert.ok(plain > 200 && flipped < -200, family + ': sin espejo la luz queda a la izquierda y con espejo a la derecha: ' + plain + ' / ' + flipped);
    console.log('✓ todas las cámaras obedecen el espejo · ' + JSON.stringify(engines));

    // 2 · El espejo se pone solo con la cámara frontal: en la vista y en la captura.
    const live = await page.evaluate(async () => {
      const wait = ms => new Promise(ok => setTimeout(ok, ms));
      const side = canvas => { const g = document.createElement('canvas'); g.width = 64; g.height = 48; const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(canvas, 0, 0, 64, 48); const d = c.getImageData(0, 0, 64, 48).data; let l = 0, r = 0; for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) { const i = 4 * (y * 64 + x), v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; if (x < 32) l += v; else r += v; } return Math.round((l - r) / (32 * 48)); };
      const shot = () => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const cam = liveCamFrame(); _renderCamEngineFrame(cam.source, cam.srcW, cam.srcH, c.getContext('2d'), camMirror(), { path: 'capture', now: performance.now(), outW: 640, outH: 480 }); return side(c); };
      const was = facingMode, out = { atras: [camMirror()] };
      await wait(400); out.atras.push(side(display), shot());
      facingMode = 'user'; await wait(700);
      out.frontal = [camMirror(), side(display), shot()];
      facingMode = was; await wait(500);
      out.vuelta = [camMirror(), side(display)];
      return out;
    });
    assert.equal(live.atras[0], false, 'con la cámara trasera no hay espejo');
    assert.ok(Math.abs(live.atras[1]) >= 3, 'la escena de prueba no es simétrica (si lo fuera, esta prueba no diría nada): ' + live.atras[1]);
    assert.equal(live.frontal[0], true, 'con la frontal, sí');
    assert.ok(Math.sign(live.frontal[1]) === -Math.sign(live.atras[1]) && Math.abs(live.frontal[1] + live.atras[1]) <= Math.max(3, Math.abs(live.atras[1]) * 0.5), 'la vista de la frontal es la de la trasera espejada: ' + live.atras[1] + ' → ' + live.frontal[1]);
    assert.ok(Math.sign(live.frontal[2]) === -Math.sign(live.atras[2]), 'y la captura sale como se vio: ' + live.atras[2] + ' → ' + live.frontal[2]);
    assert.ok(live.vuelta[0] === false && Math.sign(live.vuelta[1]) === Math.sign(live.atras[1]), 'al volver a la trasera se quita: ' + live.vuelta[1]);
    console.log('✓ la frontal se ve y se guarda como espejo; la trasera, no · ' + JSON.stringify(live));
    assert.deepEqual(errors, []);
    console.log('PASS · espejo de la cámara frontal');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
