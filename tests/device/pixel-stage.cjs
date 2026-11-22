// STAGE y PORTAL en el teléfono: ritmo real por escena, vía de cámara, tamaño del lienzo,
// estado del seguimiento de manos y capturas. Antes: node tests/device/pixel-open.cjs
//   PIXEL_URL=http://localhost:8760 node tests/device/pixel-stage.cjs [carpeta-de-capturas]
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const P = require('./pixel-lib.cjs');
const out = process.argv[2];
// Cuadros que el navegador llega a pintar en dos segundos, y el más lento.
const PACE = `new Promise(done => { let n = 0, worst = 0, last = performance.now(); const t0 = last; const tick = now => { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 2000) requestAnimationFrame(tick); else done({ fps: +(n / ((now - t0) / 1000)).toFixed(1), peor: +worst.toFixed(1) }); }; requestAnimationFrame(tick); })`;
(async () => {
  const page = (await P.targets()).find(t => t.type === 'page' && t.url.startsWith(process.env.PIXEL_URL || 'http://localhost:8760'));
  if (!page) throw new Error('no hay pestaña de FLIP: abre antes con pixel-open.cjs');
  const c = await P.connect(page);
  if (out) fs.mkdirSync(out, { recursive: true });
  const shot = name => (out ? c.screenshot(path.join(out, name + '.jpg')) : null);
  console.log('ventana', JSON.stringify(await c.evaluate('({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent.slice(0, 120) })')));
  await shot('cam');
  await c.evaluate(`(() => { if (flipShell.module() !== 'stage') flipShell.goModule('stage'); return true; })()`);
  await P.sleep(3500);
  const rows = [];
  for (let i = 0; i < 8; i++) {
    await c.evaluate(`flipStage.recall(${i}, true)`);
    await P.sleep(i === 3 ? 9000 : 2200);                        // SILUETA carga su modelo la primera vez
    const pace = await c.evaluate(PACE);
    const st = await c.evaluate('flipStage.status()');
    rows.push({ escena: st.name, fps: pace.fps, peor_ms: pace.peor, motor_fps: st.fps, lienzo: st.size.join('x'), via: st.path, silueta: st.hasMask });
    await shot('stage-' + (i + 1) + '-' + st.name.toLowerCase());
  }
  console.table(rows);
  // Un emulador como fuente (CPU) y las manos como mando.
  await c.evaluate(`(() => { flipStage.recall(0, true); flipStage.set('src.look', flipStage.tables.LOOKS.indexOf('DLPHN')); return true; })()`);
  await P.sleep(2500);
  console.log('emulador DLPHN como fuente', JSON.stringify(await c.evaluate(PACE)), JSON.stringify((await c.evaluate('flipStage.status()')).path));
  await shot('stage-emulador');
  await c.evaluate(`(() => { flipStage.set('src.look', 0); flipStage.route('hx', 'geo.rot', .4); return true; })()`);
  await P.sleep(9000);
  console.log('manos', JSON.stringify(await c.evaluate('({ ...flipStage.status().hands, fase: flipPortal.status().phase, ms: flipPortal.status().ms, error: flipPortal.status().error })')), JSON.stringify(await c.evaluate(PACE)));
  await c.evaluate(`(() => { flipStage.route('hx', 'geo.rot', 0); flipShell.goModule('portal'); return true; })()`);
  await P.sleep(7000);
  console.log('portal', JSON.stringify(await c.evaluate('flipPortal.status()')), JSON.stringify(await c.evaluate(PACE)));
  await shot('portal');
  console.log('tacto', JSON.stringify(await c.evaluate('flipFeel.state()')));
  await c.evaluate(`(() => { flipShell.goModule('cam'); return true; })()`);
  const errs = c.log.filter(e => /exception|error/.test(e.kind) && !/XNNPACK|odml|gl_context|feedback/.test(e.text));
  console.log('errores', errs.length, errs.slice(-6).map(e => e.text.slice(0, 220)));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
