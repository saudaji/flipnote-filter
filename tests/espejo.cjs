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
    // (lo que una cámara pinta encima —el marco de OSCAM, sus rótulos— no se espeja y pesa siempre del
    //  mismo lado: se pide que la luz de la IMAGEN cambie de lado, no que el total sea simétrico)
    for (const [family, [plain, flipped]] of Object.entries(engines)) assert.ok(plain > 200 && flipped < 0 && plain - flipped > 0.9 * plain, family + ': sin espejo la luz queda a la izquierda y con espejo a la derecha: ' + plain + ' / ' + flipped);
    console.log('✓ todas las cámaras obedecen el espejo · ' + JSON.stringify(engines));

    // 2 · El espejo se pone solo con la cámara frontal. Se mira qué orden de espejo le llega a la
    //     cámara en cada cuadro del visor (y, si la escena de prueba no es simétrica, que la imagen
    //     del visor de verdad se da la vuelta).
    const live = await page.evaluate(async () => {
      const wait = ms => new Promise(ok => setTimeout(ok, ms));
      const side = canvas => { const g = document.createElement('canvas'); g.width = 64; g.height = 48; const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(canvas, 0, 0, 64, 48); const d = c.getImageData(0, 0, 64, 48).data; let l = 0, r = 0; for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) { const i = 4 * (y * 64 + x), v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; if (x < 32) l += v; else r += v; } return Math.round((l - r) / (32 * 48)); };
      const real = _renderCamEngineFrame; let seen = [];
      _renderCamEngineFrame = function (source, w, h, ctx, mirror, options) { if (options && options.path === 'preview') seen.push(!!mirror); return real.apply(this, arguments); };
      const watch = async ms => { seen = []; await wait(ms); return { cuadros: seen.length, espejados: seen.filter(Boolean).length, lado: side(display) }; };
      const was = facingMode, out = { espejo: [camMirror()] };
      out.atras = await watch(600);
      facingMode = 'user'; out.espejo.push(camMirror());
      out.frontal = await watch(700);
      facingMode = was; out.espejo.push(camMirror());
      out.vuelta = await watch(600);
      _renderCamEngineFrame = real;
      return out;
    });
    assert.deepEqual(live.espejo, [false, true, false], 'el espejo va solo con la frontal');
    assert.ok(live.atras.cuadros >= 3 && live.atras.espejados === 0, 'con la trasera, ningún cuadro del visor va espejado: ' + JSON.stringify(live.atras));
    assert.ok(live.frontal.cuadros >= 3 && live.frontal.espejados === live.frontal.cuadros, 'con la frontal, todos: ' + JSON.stringify(live.frontal));
    assert.ok(live.vuelta.cuadros >= 3 && live.vuelta.espejados === 0, 'y al volver a la trasera se quita: ' + JSON.stringify(live.vuelta));
    if (Math.abs(live.atras.lado) >= 3) assert.ok(Math.sign(live.frontal.lado) === -Math.sign(live.atras.lado) && Math.sign(live.vuelta.lado) === Math.sign(live.atras.lado), 'y en el visor la imagen se da la vuelta: ' + live.atras.lado + ' → ' + live.frontal.lado + ' → ' + live.vuelta.lado);
    console.log('✓ la frontal se ve como espejo; la trasera, no · ' + JSON.stringify(live));
    assert.deepEqual(errors, []);
    console.log('PASS · espejo de la cámara frontal');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
