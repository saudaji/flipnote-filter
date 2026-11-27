// La foto de cámara, a su mejor calidad:
//   1 · nunca sale de la copia reducida con que se pinta el visor: sale del cuadro de vídeo entero;
//   2 · en FILM y CLON, si la cámara da una foto de verdad (la toma del sensor), se revela esa,
//       recortada a lo que enseña el visor; si no casa, viene girada o falla, se usa el vídeo;
//   3 · MÁXIMA: 1440 de lado corto, solo para la foto (el vídeo la trata como ALTA).
//
//   FLIP_URL=http://127.0.0.1:8760 node tests/foto.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, pickCamera } = require('./lib/harness.cjs');

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForFunction(() => typeof renderCameraPhoto === 'function' && vid.videoWidth > 0);
    await page.waitForTimeout(500);
    // herramientas en la página: tomar la foto y medirla
    await page.evaluate(() => {
      window.__foto = async () => {
        const blob = await renderCameraPhoto(), bmp = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height;
        // detalle fino: cuánto cambia la luz de un punto al siguiente, en el centro de la imagen
        let fine = 0, n = 0, red = 0, total = 0;
        for (let y = (h * 0.3) | 0; y < h * 0.7; y += 3) for (let xx = (w * 0.3) | 0; xx < w * 0.7; xx++) { const i = 4 * (y * w + xx); fine += Math.abs(d[i + 1] - d[i + 5]); n++; }
        for (let i = 0; i < d.length; i += 4 * 97) { total++; if (d[i] > 150 && d[i + 1] < 70 && d[i + 2] < 70) red++; }
        return { size: [w, h], fine: +(fine / n).toFixed(2), red: +(red / total).toFixed(2), kb: Math.round(blob.size / 1024), info: flipPhotoInfo() };
      };
      // una «toma del sensor» de mentira: el cuadro de vídeo de ahora, con más campo alrededor (wide)
      // y con un detalle fino —rayas de un punto— que el vídeo de 1280 × 720 no puede traer
      // (FLIP guarda su lector de fotos por pista de cámara: la toma de mentira lee qué toca en cada disparo)
      window.__sensor = (opts = {}) => {
        window.__sensorOpts = opts;
        window.ImageCapture = class { constructor(track) { this.track = track; }
          async takePhoto() {
            const { wide = 1.2, portrait = false, other = false, fail = false } = window.__sensorOpts;
            if (fail) throw new Error('la cámara no dio la foto');
            const W = portrait ? 1800 : 2400, H = portrait ? 2400 : 1800, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
            x.fillStyle = '#394a3a'; x.fillRect(0, 0, W, H);
            const full = Math.min(W, H * vid.videoWidth / vid.videoHeight), sw = full / wide, sh = sw * vid.videoHeight / vid.videoWidth, sx = (W - sw) / 2, sy = (H - sh) / 2;
            if (other) { for (let i = 0; i < 400; i++) { x.fillStyle = 'hsl(' + (i * 47 % 360) + ' 70% ' + (20 + i * 13 % 60) + '%)'; x.fillRect((i * 733) % W, (i * 419) % H, 180, 130); } }
            else { x.drawImage(vid, sx, sy, sw, sh); x.globalAlpha = 0.35; x.fillStyle = '#fff'; for (let xx = sx; xx < sx + sw; xx += 3) x.fillRect(xx, sy, 1.2, sh); x.globalAlpha = 1; }
            return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
          } };
      };
    });

    // ── 1 · la foto no hereda la copia reducida del visor ──
    // (se mira qué imagen le llega a la cámara: en el visor, la copia reducida; en la foto, el vídeo entero)
    const one = await page.evaluate(async () => {
      const realFrame = liveCamFrame, realRender = _renderCamEngineFrame, tiny = document.createElement('canvas'); tiny.width = 36; tiny.height = 64; tiny.getContext('2d').fillRect(0, 0, 36, 64);
      window.ImageCapture = undefined;
      const seen = { preview: [], capture: [] };
      liveCamFrame = () => ({ source: tiny, srcW: 36, srcH: 64, fast: true });       // el visor, con su copia reducida
      _renderCamEngineFrame = function (source, w, h, ctx, mirror, options) { const path = options && options.path; if (seen[path]) seen[path].push([w, h, source === tiny]); return realRender.apply(this, arguments); };
      await new Promise(ok => setTimeout(ok, 300));
      const photo = await __foto();
      liveCamFrame = realFrame; _renderCamEngineFrame = realRender;
      return { preview: seen.preview.slice(-1)[0], capture: seen.capture, photo, video: [vid.videoWidth, vid.videoHeight] };
    });
    assert.deepEqual(one.preview, [36, 64, true], 'el visor se pinta con la copia reducida');
    assert.ok(one.capture.length === 1 && one.capture[0][2] === false && one.capture[0][0] === one.video[0] && one.capture[0][1] === one.video[1] && one.photo.info.from === 'video', 'pero la foto se revela del cuadro de vídeo entero, no de esa copia: ' + JSON.stringify([one.capture, one.video]));
    console.log('✓ la foto no hereda la copia reducida del visor · ' + JSON.stringify({ visor: one.preview, foto: one.capture[0], medida: one.photo.size }));

    // ── 2 · FILM revela la toma del sensor ──
    await pickCamera(page, 'FILM');
    await page.waitForFunction(() => camFamily === 'FILM' && flipFilm.state().frame > 3, null, { timeout: 20000 });
    const two = await page.evaluate(async () => {
      flipFilm.set({ grain: false }); flipAudioSettings.resolution = 'max';
      window.ImageCapture = undefined;
      const video = await __foto();
      __sensor({ wide: 1.2 }); const sensor = await __foto();
      __sensor({ wide: 1 }); const tight = await __foto();
      __sensor({ portrait: true }); const turned = await __foto();
      __sensor({ other: true }); const other = await __foto();
      __sensor({ fail: true }); const failed = await __foto();
      // en una cámara de píxel gordo no se pide la toma
      __sensor({ wide: 1.2 }); const dsi = await (async () => { const fam = camFamily, v = camVariant; _setCamFamily('DSI'); await new Promise(ok => setTimeout(ok, 400)); const r = await __foto(); _setCamFamily(fam); camVariant = v; if (typeof _applyCamState === 'function') _applyCamState(); return r; })();
      flipFilm.set({ grain: true });
      return { video, sensor, tight, turned, other, failed, dsi };
    });
    assert.equal(two.video.info.from, 'video', 'sin toma del sensor, la foto sale del vídeo');
    assert.ok(two.sensor.info.from === 'sensor' && Math.abs(two.sensor.info.wide - 1.2) <= 0.041 && two.sensor.info.score > 0.6, 'con ella, se revela la toma, recortada a lo que enseña el visor (traía un 20 % más de campo): ' + JSON.stringify(two.sensor.info));
    assert.ok(two.tight.info.from === 'sensor' && two.tight.info.wide <= 1.041, 'y si trae el mismo campo, entera: ' + JSON.stringify(two.tight.info));
    assert.ok(two.sensor.fine > two.video.fine * 1.6, 'la foto de la toma trae detalle que el vídeo no tiene (rayas de un punto): ' + two.video.fine + ' → ' + two.sensor.fine);
    assert.ok(two.turned.info.from === 'video' && two.other.info.from === 'video' && two.failed.info.from === 'video', 'una toma girada, una que no casa con el visor o un fallo: se usa el vídeo, y se dice por qué: ' + JSON.stringify([two.turned.info.why, two.other.info.why, two.failed.info.why]));
    assert.equal(two.dsi.info.from, 'video', 'a una cámara de píxel gordo no se le pide la toma');
    console.log('✓ FILM revela la toma del sensor, recortada al visor · ' + JSON.stringify({ video: two.video.fine, sensor: two.sensor.fine, info: two.sensor.info }));

    // ── 3 · MÁXIMA ──
    const three = await page.evaluate(() => {
      const dims = (resolution, photo) => { const d = _getFlipRecordDimensions(display, { aspectRatio: '9:16', resolution, photo }); return [d.width, d.height]; };
      const pills = [...document.querySelectorAll('[data-resolution]')].map(b => b.textContent.trim());
      return { foto: dims('max', true), video: dims('max', false), alta: dims('high', true), pills, lcd: (document.getElementById('lcdFormat') || {}).textContent || '', bits: [_getFlipVideoBitrate(0, null, 30)] };
    });
    assert.deepEqual([three.foto, three.video, three.alta], [[1440, 2560], [1080, 1920], [1080, 1920]], 'MÁXIMA: 1440 × 2560 en la foto; el vídeo la trata como ALTA');
    assert.deepEqual(three.pills, ['BAJA', 'MEDIA', 'ALTA', 'MÁXIMA'], 'y está entre las opciones de resolución');
    assert.deepEqual(two.sensor.size.slice().sort((a, b) => a - b)[0], 1440, 'la foto en MÁXIMA mide 1440 de lado corto: ' + two.sensor.size);
    console.log('✓ MÁXIMA · ' + JSON.stringify({ foto: three.foto, video: three.video, medida: two.sensor.size, kb: two.sensor.kb }));
    assert.deepEqual(errors, []);
    console.log('PASS · foto a máxima calidad');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
