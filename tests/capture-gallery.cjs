// Galería reproducible de FLIP: mismas escenas, mismos ajustes, cualquier commit.
//   FLIP_URL=http://127.0.0.1:8760 node tests/capture-gallery.cjs <carpeta> [filtro] [--face retrato.png]
// Escribe <id>.png (último cuadro del visor), <id>.mp4 para las tomas con clip,
// <id>.export.png para las que comparan exportación y timings.json con ms por cuadro.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip, saveDataUrl, URL } = require('./lib/harness.cjs');
const { execFileSync } = require('node:child_process');

const CADENCE = { DSI: 8, STAMP: 24, AUTO03: 30, DLPHN: 24, CASKIA: 15, VFD: 30, OSCAM: 30, SLHT: 24, PRENSA: 24 };
const shot = (id, family, variant, scene, extra = {}) => ({ id, family, variant, scene, frames: 12, ...extra });
const SHOTS = [
  // AUTO 03: la misma habitación en penumbra con las tres exposiciones, y la versión iluminada.
  ...['DAY', 'FLASH', 'NIGHT'].flatMap(v => [
    shot('auto03-room-' + v, 'AUTO03', v, 'room', { frames: 75, clip: true, export: true }),
    shot('auto03-roomlit-' + v, 'AUTO03', v, 'roomLit', { frames: 20 }),
    shot('auto03-ramp-' + v, 'AUTO03', v, 'ramp', { frames: 20 }),
  ]),
  shot('auto03-nolamp-NIGHT', 'AUTO03', 'NIGHT', 'room', { frames: 45, options: { lamp: false } }),
  // OSCAM VECTOR: formas, estabilidad y persistencia.
  ...['circle', 'diagonal', 'two', 'cup', 'hand', 'cable'].map(s => shot('oscam-vector-' + s, 'OSCAM', 'STD', s, { frames: 30 })),
  shot('oscam-vector-cupNoise', 'OSCAM', 'STD', 'cupNoise', { frames: 60, clip: true }),
  shot('oscam-vector-enterExit', 'OSCAM', 'STD', 'enterExit', { frames: 120, clip: true }),
  shot('oscam-vector-handWave', 'OSCAM', 'STD', 'handWave', { frames: 72, clip: true }),
  // El sello postal de PRINT: tres variantes, cuatro materiales, visor y exportación.
  ...['ENGR', 'INK', 'ISSUE'].flatMap(v => ['portrait', 'text', 'ramp', 'flat'].map(s =>
    shot('stamp-' + v + '-' + s, 'PRENSA', v, s, { export: s === 'portrait' || s === 'flat' }))),
  // CASKIA: materiales y respuesta temporal.
  ...['STD', 'E-INK', 'SEIKO'].flatMap(v => [
    ...['text', 'portrait', 'ramp'].map(s => shot('caskia-' + v + '-' + s, 'CASKIA', v, s, { frames: 20, export: s === 'portrait' })),
    shot('caskia-' + v + '-transition', 'CASKIA', v, 'transition', { frames: 45, clip: true }),
    shot('caskia-' + v + '-objectLeave', 'CASKIA', v, 'objectLeave', { frames: 60, clip: true }),
  ]),
  // Resto de familias.
  ...[['DSI', 'STD'], ['DSI', 'LGCY'], ['DLPHN', 'STD'], ['DLPHN', 'LGCY'], ['VFD', 'STD'], ['VFD', 'THRML'], ['VFD', 'CRT']].flatMap(([f, v]) =>
    ['portrait', 'text', 'ramp'].map(s => shot(f.toLowerCase() + '-' + v + '-' + s, f, v, s, { export: s === 'portrait' }))),
];

async function main() {
  const args = process.argv.slice(2);
  const faceAt = args.indexOf('--face');
  const face = faceAt >= 0 ? args.splice(faceAt, 2)[1] : null;
  const out = path.resolve(args[0] || 'gallery');
  const filter = args[1] ? new RegExp(args[1]) : null;
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser);
    await page.exposeFunction('__save', (rel, dataUrl) => saveDataUrl(path.join(out, rel), dataUrl));
    if (face) await page.evaluate(url => FlipKit.loadFace(url), 'data:image/png;base64,' + fs.readFileSync(face).toString('base64'));
    await page.evaluate(() => FlipKit.hold());
    const timings = {};
    for (const s of SHOTS) {
      if (filter && !filter.test(s.id)) continue;
      const fps = s.fps || CADENCE[s.family] || 30;
      const result = await page.evaluate(async ({ s, fps }) => {
        FlipKit.hold();
        FlipKit.select(s.family, s.variant);
        const ms = [];
        for (let i = 0; i < s.frames; i++) {
          const t = i / fps, now = 1000 + i * 1000 / fps;
          const src = FlipKit.paint(s.scene, t, s.options);
          const begin = performance.now();
          _renderCamEngineFrame(src, src.width, src.height, ctxD, false, { path: 'preview', now });
          ctxD.getImageData(0, 0, 1, 1);   // fuerza a terminar el dibujo antes de parar el reloj
          ms.push(performance.now() - begin);
          if (s.clip) await window.__save('frames/' + s.id + '/f_' + String(i).padStart(4, '0') + '.jpg', FlipKit.jpeg(display, 0.93));
        }
        await window.__save(s.id + '.png', FlipKit.png(display));
        if (s.export) {
          const last = s.frames - 1;
          const canvas = FlipKit.exportFrame(s.scene, last / fps, 1000 + last * 1000 / fps, s.options, 'high');
          await window.__save(s.id + '.export.png', FlipKit.png(canvas));
        }
        ms.sort((a, b) => a - b);
        return { median: +ms[ms.length >> 1].toFixed(2), p95: +ms[Math.floor(ms.length * 0.95)].toFixed(2), size: [display.width, display.height] };
      }, { s, fps });
      timings[s.id] = result;
      if (s.clip) {
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(out, 'frames', s.id, 'f_%04d.jpg'),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-movflags', '+faststart', path.join(out, s.id + '.mp4')]);
      }
      process.stdout.write(s.id + ' ' + result.median + ' ms\n');
    }
    fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({ url: URL, face: !!face, timings }, null, 1));
    if (errors.length) { console.error('Errores de página:', errors); process.exitCode = 1; }
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
