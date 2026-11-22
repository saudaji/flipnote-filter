// Recorrido con toques de verdad en el teléfono: CAM, tacto, lanzador, STAGE (escenas, perillas,
// cables, salida limpia, grabador) y PORTAL. No guarda archivos en el teléfono.
//   PIXEL_URL=http://localhost:8760 node tests/device/pixel-touch.cjs [carpeta-de-capturas]
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const P = require('./pixel-lib.cjs');
const out = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push([ok ? 'OK ' : 'FALLA', name, detail]); console.log((ok ? 'OK    ' : 'FALLA ') + name + (detail ? ' · ' + detail : '')); };
(async () => {
  const page = (await P.targets()).find(t => t.type === 'page' && t.url.startsWith(process.env.PIXEL_URL || 'http://localhost:8760'));
  if (!page) throw new Error('no hay pestaña de FLIP: abre antes con pixel-open.cjs');
  const c = await P.connect(page);
  if (out) fs.mkdirSync(out, { recursive: true });
  const shot = name => (out ? c.screenshot(path.join(out, name + '.jpg')) : null);
  const ev = expression => c.evaluate(expression);
  await ev(`(() => { if (flipShell.module() !== 'cam') flipShell.goModule('cam'); flipFeel.set({ sound: true, haptic: true }); flipFeel.log(true); window.__vib = []; if (!navigator.__spied) { const real = navigator.vibrate.bind(navigator); navigator.vibrate = p => { window.__vib.push(p); return real(p); }; navigator.__spied = true; } return true; })()`);
  await P.sleep(800);

  // CAM: AJUSTES abre con un toque, y el toque suena y vibra como botón redondo.
  await c.tap('#deckAdjust');
  await P.sleep(400);
  check('AJUSTES abre con un toque', await ev(`document.body.classList.contains('cam-edit-open')`));
  let log = await ev('flipFeel.log(true)');
  check('el botón redondo suena y vibra', log.length >= 2 && log[0].kind === 'soft' && log[0].sound === 'softDown' && log[0].vib === 6, JSON.stringify(log.map(e => [e.kind, e.phase, e.sound, e.vib])));
  await shot('toque-ajustes');
  await c.tap('#btnCamEditClose');
  await P.sleep(400);
  log = await ev('flipFeel.log(true)');
  check('LISTO cierra y suena a tecla', !(await ev(`document.body.classList.contains('cam-edit-open')`)) && log[0] && log[0].sound === 'keyDown', JSON.stringify(log.map(e => [e.kind, e.phase, e.sound])));
  // Bandeja: un toque en una diapositiva cambia de cámara.
  await c.tap('#deckLooks [data-family="DLPHN"]');
  await P.sleep(700);
  log = await ev('flipFeel.log(true)');
  check('la diapositiva cambia de cámara', (await ev('camFamily')) === 'DLPHN' && log.some(e => e.kind === 'slide'), JSON.stringify(log.map(e => [e.kind, e.sound])));
  check('vibración aceptada por el teléfono', (await ev('window.__vib.length')) >= 3, JSON.stringify(await ev('window.__vib')));
  const photo = await ev(`cameraPhoto().then(b => createImageBitmap(b).then(bmp => [b.type, b.size, bmp.width, bmp.height]))`);
  check('la foto se genera', photo[0] === 'image/jpeg' && photo[1] > 20000, JSON.stringify(photo));
  await ev(`(() => { _setCamFamily('DSI'); return true; })()`);

  // Lanzador → STAGE.
  await c.tap('#shellModule');
  await P.sleep(500);
  await shot('toque-lanzador');
  await c.tap('#shellLauncher [data-module="stage"]');
  await P.sleep(2500);
  check('el lanzador abre STAGE', await ev('flipStage.status().active && flipStage.status().ok && flipStage.status().hasA'), JSON.stringify(await ev('[flipStage.status().size, flipStage.status().path]')));
  await ev(`(() => { flipStage.reset(); flipStage.recall(0, true); return true; })()`);
  await c.tap('#rigScenes [data-scene="1"]');
  check('una tecla de escena la llama', (await ev('flipStage.status().name')) === 'TÚNEL');
  await c.tap('#rigTabs [data-page="fb"]');
  const before = await ev(`flipStage.get('fb.decay')`);
  await c.drag('.rig-knob[data-param="fb.decay"] .dial', 0, 70);
  const after = await ev(`flipStage.get('fb.decay')`);
  check('una perilla se gira arrastrando', after < before - .2, before.toFixed(2) + ' → ' + after.toFixed(2));
  log = await ev('flipFeel.log(true)');
  check('la perilla marca muescas', log.filter(e => e.kind === 'tick').length >= 2, String(log.filter(e => e.kind === 'tick').length));
  await c.tap('.rig-jack[data-src="lfo2"]');
  await c.tap('.rig-knob[data-param="fb.hue"] .dial');
  check('toma y perilla conectan un cable', await ev(`flipStage.status().routes.some(r => r[0] === 'lfo2' && r[1] === 'fb.hue') && document.querySelectorAll('#rigCables path.cord').length >= 1`));
  await shot('toque-cable');
  await c.tap('.rig-knob[data-param="fb.hue"] .dial');
  await c.tap('.rig-jack[data-src="lfo2"]');
  check('otro toque lo suelta', await ev(`!flipStage.status().routes.some(r => r[0] === 'lfo2' && r[1] === 'fb.hue') && flipStage.status().armed === ''`));

  // Grabador sobre el lienzo de STAGE, sin guardar nada en el teléfono.
  const recorded = await ev(`new Promise(done => { const feed = document.getElementById('stageCanvas').captureStream(30); let made; try { made = _createFlipRecorder(feed, 8000000); } catch (e) { done(['error', String(e)]); return; } const chunks = []; made.recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); }; made.recorder.onstop = () => { feed.getTracks().forEach(t => t.stop()); done([made.mime, chunks.reduce((n, b) => n + b.size, 0)]); }; made.recorder.start(500); setTimeout(() => made.recorder.stop(), 2200); })`);
  check('el teléfono graba la salida', recorded[1] > 30000, JSON.stringify(recorded));

  // Salida limpia: pantalla completa y horizontal.
  await c.tap('#rigOut');
  await P.sleep(1800);
  const clean = await ev(`({ clean: flipStage.status().out.clean, orientation: screen.orientation.type, inner: [innerWidth, innerHeight], canvas: (r => [Math.round(r.width), Math.round(r.height)])(document.getElementById('stageCanvas').getBoundingClientRect()) })`);
  check('SALIDA pone la señal a pantalla completa', clean.clean, JSON.stringify(clean));
  check('y gira a horizontal', /landscape/.test(clean.orientation), clean.orientation);
  await shot('toque-salida-limpia');
  await ev(`new Promise(done => { const r = () => requestAnimationFrame(now => done(now)); r(); })`);
  const pace = await ev(`new Promise(done => { let n = 0; const t0 = performance.now(); const tick = now => { n++; if (now - t0 < 2000) requestAnimationFrame(tick); else done(+(n / ((now - t0) / 1000)).toFixed(1)); }; requestAnimationFrame(tick); })`);
  check('en salida limpia mantiene el ritmo', pace > 50, pace + ' fps');
  await ev(`document.exitFullscreen().then(() => true, () => false)`);
  await P.sleep(1500);
  check('al salir vuelve la consola', await ev(`!flipStage.status().out.clean && /portrait/.test(screen.orientation.type)`), await ev('screen.orientation.type'));

  // Permisos que piden un toque del dueño del teléfono: solo se informa.
  console.log('permisos', JSON.stringify(await ev(`Promise.all(['microphone', 'midi'].map(name => navigator.permissions.query({ name }).then(p => name + ': ' + p.state, e => name + ': ?')))`)));
  await ev(`(() => { flipShell.goModule('cam'); return true; })()`);
  const errs = c.log.filter(e => /exception|error/.test(e.kind) && !/XNNPACK|odml|gl_context|feedback/.test(e.text));
  console.log('errores', errs.length, errs.slice(-6).map(e => e.text.slice(0, 220)));
  const failed = results.filter(r => r[0] !== 'OK ').length;
  console.log(failed ? failed + ' comprobación(es) fallan' : 'Todo bien: ' + results.length + ' comprobaciones');
  c.close();
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
