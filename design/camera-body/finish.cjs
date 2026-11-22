// Remata las piezas renderizadas: limpia la sombra residual (el plano de sombra recoge una
// oclusión tenue que, cortada por el borde de la imagen, dejaría un recuadro visible) y las
// pasa a WebP en docs/body/.
//   node design/camera-body/finish.cjs <carpeta-con-png> [docs/body]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
// playwright-core: el del proyecto (npm i --no-save playwright-core) o, si no, el de la carpeta de al lado.
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { ({ chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'playwright-core'))); }
const src = process.argv[2];
const out = process.argv[3] || path.join(__dirname, '..', '..', 'docs', 'body');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  for (const file of fs.readdirSync(src).filter(f => f.endsWith('.png') && !/^(sheet|study)/.test(f)).sort()) {
    const name = file.replace(/\.png$/, '');
    const input = path.join(src, file), target = path.join(out, name + '.webp');
    if (name === 'body') { execFileSync('cwebp', ['-quiet', '-q', '82', '-m', '6', input, '-o', target]); continue; }
    const url = 'data:image/png;base64,' + fs.readFileSync(input).toString('base64');
    const data = await page.evaluate(async url => {
      const image = new Image(); image.src = url; await image.decode();
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height), d = px.data, w = c.width, h = c.height, feather = Math.round(Math.min(w, h) * 0.07);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = 4 * (y * w + x), a = d[i + 3];
        if (!a) continue;
        // Solo la sombra (oscura y translúcida): se le quita el suelo y se funde hacia el borde.
        const shadow = a < 150 && d[i] + d[i + 1] + d[i + 2] < 150;
        if (!shadow) continue;
        const edge = Math.min(x, y, w - 1 - x, h - 1 - y) / feather;
        const fade = edge >= 1 ? 1 : edge * edge * (3 - 2 * edge);
        d[i + 3] = Math.max(0, (a - 9) * 1.06) * fade;
      }
      ctx.putImageData(px, 0, 0);
      return c.toDataURL('image/png');
    }, url);
    const clean = path.join(src, '.clean-' + file);
    fs.writeFileSync(clean, Buffer.from(data.split(',')[1], 'base64'));
    execFileSync('cwebp', ['-quiet', '-q', '90', '-alpha_q', '94', '-m', '6', clean, '-o', target]);
    fs.renameSync(clean, path.join(src, '.done-' + file));
  }
  await browser.close();
  console.log('piezas en', out);
})().catch(e => { console.error(e); process.exit(1); });
