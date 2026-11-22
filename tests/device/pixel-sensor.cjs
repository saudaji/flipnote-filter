// Valida en el Pixel la lectura rápida: coste y diferencia frente a la conversión del navegador.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const P = require('./pixel-lib.cjs');
const REPO = path.join(__dirname, '..', '..');
(async () => {
  const page = (await P.targets()).find(t => t.type === 'page' && (!process.env.PIXEL_URL || t.url.startsWith(process.env.PIXEL_URL)));
  const c = await P.connect(page);
  const src = fs.readFileSync(path.join(REPO, 'docs', 'sensor.js'), 'utf8');
  const out = await c.evaluate(`(async () => {
    ${src.replace('const flipSensor =', 'window.__sensor =')}
    const S = window.__sensor;
    const nextFrame = () => new Promise(r => vid.requestVideoFrameCallback(() => r()));
    const times = [];
    for (let i = 0; i < 40; i++) { await nextFrame(); const t = performance.now(); const r = await S.read(vid); times.push(performance.now() - t); if (!r) return { fallo: S.status() }; }
    times.sort((a, b) => a - b);
    const report = { estado: S.status(), mediana_ms: +times[20].toFixed(2), p95_ms: +times[37].toFixed(2), max_ms: +times[39].toFixed(1) };
    // Mismo cuadro por las dos vías.
    const frame = new VideoFrame(vid);
    await S.convertFrame(frame);
    const cur = S.current(vid, 1e9) || { canvas: null };
    const st = S.status().info;
    const [ow, oh] = st.reduced;
    const ref = document.createElement('canvas'); ref.width = ow; ref.height = oh;
    const rctx = ref.getContext('2d', { willReadFrequently: true });
    rctx.imageSmoothingQuality = 'high';
    rctx.drawImage(frame, 0, 0, ow, oh);
    frame.close();
    const a = cur.canvas.getContext('2d').getImageData(0, 0, ow, oh).data, b = rctx.getImageData(0, 0, ow, oh).data;
    const diff = [0, 0, 0], mean = [[0, 0, 0], [0, 0, 0]]; let n = 0;
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) { diff[ch] += Math.abs(a[i + ch] - b[i + ch]); mean[0][ch] += a[i + ch]; mean[1][ch] += b[i + ch]; }
      const la = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114, lb = b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114;
      sa += la; sb += lb; saa += la * la; sbb += lb * lb; sab += la * lb; n++;
    }
    const corr = (sab - sa * sb / n) / Math.sqrt((saa - sa * sa / n) * (sbb - sb * sb / n));
    report.comparacion = { dif_media_rgb: diff.map(v => +(v / n).toFixed(2)), media_sensor: mean[0].map(v => +(v / n).toFixed(1)), media_navegador: mean[1].map(v => +(v / n).toFixed(1)), correlacion_luma: +corr.toFixed(4) };
    report.png = { sensor: cur.canvas.toDataURL('image/jpeg', 0.8), navegador: ref.toDataURL('image/jpeg', 0.8) };
    return report;
  })()`, { timeout: 60000 });
  if (out.png) {
    for (const k of ['sensor', 'navegador']) fs.writeFileSync((process.argv[2] || '.') + '/sensor-' + k + '.jpg', Buffer.from(out.png[k].split(',')[1], 'base64'));
    delete out.png;
  }
  console.log(JSON.stringify(out, null, 1));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
