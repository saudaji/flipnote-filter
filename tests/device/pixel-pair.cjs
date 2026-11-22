// Fuente y resultado del mismo instante en el teléfono, lado a lado, para juzgar un look con la cámara real.
//   PIXEL_URL=http://localhost:8760 node tests/device/pixel-pair.cjs FAMILIA VARIANTE salida.jpg [ancho:alto]
'use strict';
const fs = require('node:fs');
const P = require('./pixel-lib.cjs');
const [family, variant, out, aspect] = process.argv.slice(2);
(async () => {
  const page = (await P.targets()).find(t => t.type === 'page' && (!process.env.PIXEL_URL || t.url.startsWith(process.env.PIXEL_URL)));
  const c = await P.connect(page);
  if (aspect) { const [aw, ah] = aspect.split(':').map(Number); await c.evaluate(`(() => { if (camAspW !== ${aw} || camAspH !== ${ah}) applyCamAspect(${aw}, ${ah}); return true; })()`); await P.sleep(1800); }
  await c.evaluate(`(() => { if (activeTab !== 'cam') switchTab('cam'); _setCamFamily(${JSON.stringify(family)}); camVariant = ${JSON.stringify(variant)}; _applyCamState(); return true; })()`);
  await P.sleep(Number(process.env.PIXEL_WAIT || 1600));
  const data = await c.evaluate(`(() => {
    const w = display.width, h = display.height;
    const pair = document.createElement('canvas'); pair.width = w * 2 + 12; pair.height = h;
    const ctx = pair.getContext('2d');
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, pair.width, pair.height);
    const cam = liveCamFrame(1000);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cam.source, ...cropCoordsForDims(cam.srcW, cam.srcH, w, h), 0, 0, w, h);
    ctx.drawImage(display, w + 12, 0);
    const state = typeof opticalScopes !== 'undefined' && opticalScopes.get(ctxD) && opticalScopes.get(ctxD).vector;
    return { url: pair.toDataURL('image/jpeg', 0.9), size: [w, h], vector: state ? { chains: state.chains ? state.chains.length : 0, total: Math.round(state.total || 0), grid: [state.cols, state.rows] } : null };
  })()`);
  fs.writeFileSync(out, Buffer.from(data.url.split(',')[1], 'base64'));
  console.log(JSON.stringify({ size: data.size, vector: data.vector }));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
