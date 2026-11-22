// Miniaturas de la ranura de looks: lo que hace cada cámara sobre una misma escena.
//   FLIP_URL=http://127.0.0.1:8760 node design/camera-body/looks.cjs [escena]
// Escribe docs/body/look-<FAMILIA>.png; después se pasan a WebP con cwebp.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const H = require('../../tests/lib/harness.cjs');
const scene = process.argv[2] || 'portrait';
const out = path.join(__dirname, '..', '..', 'docs', 'body');
(async () => {
  const browser = await H.launch();
  const { page } = await H.openFlip(browser, { sceneCamera: { scene, w: 1280, h: 720, fps: 30 } });
  const families = await page.evaluate(() => Object.keys(CAM_FAMILIES));
  for (const family of families) {
    await page.evaluate(f => { _setCamFamily(f); }, family);
    await page.waitForTimeout(family === 'SLHT' ? 6000 : 1400);
    const data = await page.evaluate(() => {
      const thumb = document.createElement('canvas');
      thumb.width = 222; thumb.height = 174;
      const ctx = thumb.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      // Recorte central con la proporción de la miniatura.
      const sw = display.width, sh = Math.round(display.width * 174 / 222);
      ctx.drawImage(display, 0, Math.max(0, (display.height - sh) / 2), sw, Math.min(sh, display.height), 0, 0, 222, 174);
      return thumb.toDataURL('image/png');
    });
    fs.writeFileSync(path.join(out, 'look-' + family + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    console.log('look', family);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
