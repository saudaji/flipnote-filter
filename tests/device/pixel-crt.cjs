// En el teléfono, con toques de verdad: VFD · CRT (se elige con sus teclas, ritmo y coste por
// cuadro con la cámara real, qué se ve, foto y vídeo), el clic de las teclas (qué suena y qué
// vibra, y que el audio está en marcha), el giro de cámara y PORTAL (dibujo por GPU, ritmo,
// rastreador de manos). Deja capturas en la carpeta que se le pase.
//   node pixel-open.cjs && node pixel-crt.cjs [carpeta]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const P = require('./pixel-lib.cjs');
const out = process.argv[2] || '';
if (out) fs.mkdirSync(out, { recursive: true });
const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass: !!pass }); console.log((pass ? '✓ ' : '✗ ') + name + (detail !== undefined ? ' · ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };

(async () => {
  const page = (await P.targets()).find(t => t.type === 'page' && (!process.env.PIXEL_URL || t.url.startsWith(process.env.PIXEL_URL)));
  if (!page) throw new Error('no hay pestaña de FLIP abierta: corre antes pixel-open.cjs');
  const c = await P.connect(page);
  await c.send('Page.bringToFront').catch(() => {});
  const shot = async name => { if (out) await c.screenshot(path.join(out, name + '.jpg'), { quality: 82 }); };
  // La pantalla no se duerme mientras dura la prueba (se suelta al final).
  await c.evaluate(`navigator.wakeLock ? navigator.wakeLock.request('screen').then(lock => { window.__testLock = lock; return 'ok'; }).catch(e => 'sin bloqueo: ' + e.message) : 'sin API'`);
  const info = await c.evaluate(`({ ua: navigator.userAgent.replace(/^.*(Android [0-9.]+).*?(Chrome\\/[0-9]+).*$/, '$1 · $2'), inner: [innerWidth, innerHeight], dpr: devicePixelRatio, video: [vid.videoWidth, vid.videoHeight], module: flipShell.module(), sw: (navigator.serviceWorker.controller || {}).scriptURL || 'sin service worker' })`);
  console.log(JSON.stringify(info));
  // Lo que se guarde durante la prueba no baja al teléfono: se anota su tipo y su peso.
  await c.evaluate(`(() => { if (window.__saved) return; window.__saved = []; const real = _downloadBlob; _downloadBlob = function (blob, name) { window.__saved.push({ name, type: blob.type, size: blob.size }); }; window.__restoreSave = () => { _downloadBlob = real; }; })()`);
  await c.evaluate(`(() => { if (flipShell.module() !== 'cam') { document.getElementById('shellModule').click(); document.querySelector('#shellLauncher [data-module="cam"]').click(); } return true; })()`);
  await P.sleep(900);

  // ── 1 · VFD · CRT con sus teclas ──
  await c.evaluate(`document.querySelector('#deckLooks [data-family="VFD"]').scrollIntoView({ inline: 'center', block: 'nearest' })`);
  await P.sleep(350);
  await c.evaluate('flipFeel.log(true)');
  await c.tap('#deckLooks [data-family="VFD"]');
  await P.sleep(300);
  await c.tap('#deckVariants [data-variant="CRT"]');
  await P.sleep(500);
  const picked = await c.evaluate(`({ family: camFamily, variant: camVariant, lcd: document.getElementById('lcdLook').textContent, keys: [...document.querySelectorAll('#deckVariants [data-variant]')].map(b => b.dataset.variant) })`);
  ok('VFD · CRT se elige con el dedo', picked.family === 'VFD' && picked.variant === 'CRT' && /CRT/.test(picked.lcd), picked);
  const feel = await c.evaluate(`({ log: flipFeel.log(true), state: flipFeel.state(), prefs: flipFeel.prefs() })`);
  const sounded = feel.log.filter(e => e.sound), buzzed = feel.log.filter(e => e.vib);
  ok('las teclas suenan y vibran al tocarlas', feel.state.built && feel.state.context === 'running' && sounded.length >= 2 && buzzed.length >= 1,
    { audio: feel.state.context, sonidos: sounded.map(e => e.kind + ':' + e.sound), vibra: buzzed.map(e => e.vib) });

  // ── 2 · Ritmo y coste por cuadro con la cámara real ──
  await P.sleep(700);
  const perf = await c.evaluate(`new Promise(done => {
    const real = _renderCamEngineFrame, render = [], raf = [];
    let last = 0;
    _renderCamEngineFrame = function (...args) { const t0 = performance.now(); const r = real.apply(this, args); if (args[5] && args[5].path === 'preview') render.push(performance.now() - t0); return r; };
    const t0 = performance.now();
    const tick = now => {
      if (last) raf.push(now - last); last = now;
      if (now - t0 < 5000) return requestAnimationFrame(tick);
      _renderCamEngineFrame = real;
      const sort = list => Float64Array.from(list).sort(), at = (list, q) => list.length ? list[Math.min(list.length - 1, Math.floor(q * list.length))] : 0;
      const r = sort(render), f = sort(raf);
      done({ fps: +(render.length / 5).toFixed(1), target: camFpsTarget, median: +at(r, .5).toFixed(1), p95: +at(r, .95).toFixed(1), worst: +at(r, 1).toFixed(1), screenHz: +(1000 / at(f, .5)).toFixed(0), jank: raf.filter(d => d > 50).length });
    };
    requestAnimationFrame(tick);
  })`, { timeout: 20000 });
  ok('CRT a su cadencia y sin tirones', perf.fps >= 26 && perf.p95 < 28 && perf.jank <= 2, perf);
  const look = await c.evaluate(`(() => {
    const probe = document.createElement('canvas'); probe.width = 128; probe.height = Math.round(128 * display.height / display.width);
    const ctx = probe.getContext('2d', { willReadFrequently: true }); ctx.drawImage(display, 0, 0, probe.width, probe.height);
    const d = ctx.getImageData(0, 0, probe.width, probe.height).data; let dark = 0, color = 0, pink = 0, sum = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2], hi = Math.max(r, g, b), lo = Math.min(r, g, b); sum += .299 * r + .587 * g + .114 * b; if (hi < 48) dark++; if (hi - lo > 90) color++; if (r > 180 && b > 110 && g < r * .72 && r >= b) pink++; }
    return { dark: +(dark / n).toFixed(2), color: +(color / n).toFixed(3), pink: +(pink / n).toFixed(3), mean: +(sum / n).toFixed(1), size: display.width + 'x' + display.height, level: _vfdCrtLevel && { mid: Math.round(_vfdCrtLevel.mid), hi: Math.round(_vfdCrtLevel.hi), gain: +_vfdCrtLevel.gain.toFixed(2) } };
  })()`);
  ok('lo que se ve es el tubo: negro, color y luces en rosa', look.dark > 0.2 && look.color > 0.01 && look.mean > 4 && look.mean < 150, look);
  await shot('crt-visor');

  // ── 3 · Foto y vídeo con el disparador ──
  await c.evaluate('window.__saved.length = 0');
  await c.tap('#deckShutter');
  await P.sleep(1600);
  let saved = await c.evaluate('window.__saved.slice()');
  ok('foto en CRT', saved.length === 1 && /image\//.test(saved[0].type) && saved[0].size > 30000, saved[0]);
  await c.evaluate(`(() => { const v = document.getElementById('viewer') || document.querySelector('.is-open[id*="iewer"]'); const close = document.getElementById('viewerClose'); if (close && close.offsetParent) close.click(); return true; })()`);
  await P.sleep(400);
  await c.evaluate('window.__saved.length = 0');
  await c.tap('#deckModeSwitch');
  await P.sleep(400);
  await c.tap('#deckShutter');
  let recording = false;
  for (let i = 0; i < 30 && !recording; i++) { await P.sleep(150); recording = await c.evaluate('!!recorder && recorder.state === "recording"'); }
  await P.sleep(2600);
  await c.tap('#deckShutter');
  for (let i = 0; i < 40; i++) { await P.sleep(200); if ((await c.evaluate('window.__saved.length')) > 0) break; }
  saved = await c.evaluate('window.__saved.slice()');
  ok('vídeo en CRT', recording && saved.length === 1 && /video\//.test(saved[0].type) && saved[0].size > 150000, { grabando: recording, archivo: saved[0] });
  await c.evaluate(`(() => { const close = document.getElementById('viewerClose'); if (close && close.offsetParent) close.click(); return true; })()`);
  await P.sleep(300);
  await c.tap('#deckModeSwitch');
  await P.sleep(400);

  // ── 4 · Giro de cámara (en un teléfono que no abre dos a la vez) ──
  const facing = () => c.evaluate(`(() => { const t = stream && stream.getVideoTracks()[0]; const s = t ? t.getSettings() : {}; return { facing: s.facingMode || facingMode, w: vid.videoWidth, h: vid.videoHeight, live: !!t && t.readyState === 'live', pending: !!cameraRequest }; })()`);
  const before = await facing();
  let t0 = Date.now();
  await c.tap('#deckFlip');
  let after = before;
  for (let i = 0; i < 50; i++) { await P.sleep(150); after = await facing(); if (!after.pending && after.live && after.facing !== before.facing && after.w > 0) break; }
  const flipMs = Date.now() - t0;
  ok('GIRAR abre la otra cámara', after.live && after.facing !== before.facing, { de: before.facing, a: after.facing, ms: flipMs, tamaño: after.w + 'x' + after.h });
  await P.sleep(700);
  await shot('crt-frontal');
  t0 = Date.now();
  await c.tap('#deckFlip');
  let back = after;
  for (let i = 0; i < 50; i++) { await P.sleep(150); back = await facing(); if (!back.pending && back.live && back.facing === before.facing && back.w > 0) break; }
  ok('y vuelve a la trasera', back.live && back.facing === before.facing, { ms: Date.now() - t0 });
  await P.sleep(500);

  // ── 5 · PORTAL: dibujo por GPU a la cadencia de la pantalla y rastreador en marcha ──
  await c.tap('#shellModule');
  await P.sleep(350);
  await c.tap('#shellLauncher [data-module="portal"]');
  let portal = null;
  for (let i = 0; i < 60; i++) { await P.sleep(500); portal = await c.evaluate('({ ...flipPortal.status(), fast: flipPortal.fast })'); if (portal.active && portal.phase === 'ready' && portal.frames > 8) break; }
  ok('PORTAL entra y el rastreador de manos arranca', portal.active && portal.phase === 'ready', { fase: portal.phase, delegado: portal.delegate, calibrando: portal.calibrating, gl: portal.fast, mensaje: portal.message });
  const pperf = await c.evaluate(`new Promise(done => {
    const real = flipPortal.render, costs = [], gaps = [];
    let last = 0;
    flipPortal.render = function () { const t0 = performance.now(); const r = real.apply(this, arguments); costs.push(performance.now() - t0); if (last) gaps.push(t0 - last); last = t0; return r; };
    const frames0 = flipPortal.status().frames, t0 = performance.now();
    setTimeout(() => {
      flipPortal.render = real;
      const sort = list => Float64Array.from(list).sort(), at = (list, q) => list.length ? list[Math.min(list.length - 1, Math.floor(q * list.length))] : 0;
      const s = flipPortal.status(), seconds = (performance.now() - t0) / 1000;
      done({ dibujos: +(costs.length / seconds).toFixed(1), coste: +at(sort(costs), .5).toFixed(2), costeP95: +at(sort(costs), .95).toFixed(2), hueco95: +at(sort(gaps), .95).toFixed(1), rastreador: +((s.frames - frames0) / seconds).toFixed(1), delegado: s.delegate, calibrando: s.calibrating, gl: flipPortal.fast });
    }, 4000);
  })`, { timeout: 20000 });
  ok('PORTAL dibuja a la cadencia de la pantalla', pperf.gl && pperf.dibujos >= 50 && pperf.costeP95 < 9, pperf);
  ok('el rastreador sigue las manos a buen ritmo', pperf.rastreador >= 12, { porSegundo: pperf.rastreador, delegado: pperf.delegado });
  await shot('portal');
  // Un portal fijado con el botón, se mueve con el dedo y se borra.
  const panes = await c.evaluate(`(() => { const n0 = flipPortal.panes.list().length; const lock = document.getElementById('portalLock'); return { n0, lock: !!lock && lock.offsetParent !== null }; })()`);
  ok('la barra de portales está a mano', panes.lock, panes);
  await c.tap('#shellModule');
  await P.sleep(350);
  await c.tap('#shellLauncher [data-module="cam"]');
  await P.sleep(900);
  const home = await c.evaluate(`({ module: flipShell.module(), portal: flipPortal.active, video: vid.videoWidth })`);
  ok('de vuelta en CAM', home.module === 'cam' && !home.portal && home.video > 0, home);

  // ── Consola ──
  const bad = c.log.filter(e => (e.kind === 'exception' || e.kind === 'error' || /^log:error/.test(e.kind)) && !/Graph|gl_context|XNNPACK|inference_feedback|favicon/.test(e.text));
  ok('sin errores en la consola del teléfono', bad.length === 0, bad.slice(0, 4).map(e => '[' + e.kind + '] ' + String(e.text).slice(0, 160)));
  await c.evaluate(`(() => { window.__restoreSave && window.__restoreSave(); delete window.__saved; if (window.__testLock) { window.__testLock.release(); delete window.__testLock; } return true; })()`);
  const failed = results.filter(r => !r.pass);
  console.log(failed.length ? 'FALLAN ' + failed.length + ': ' + failed.map(r => r.name).join(' · ') : 'PASS · ' + results.length + ' comprobaciones en el teléfono');
  c.close();
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
