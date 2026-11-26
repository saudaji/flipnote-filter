// Cámaras que escuchan, la variante NEÓN y STAGE · LIVE en el teléfono de verdad (por USB, con FLIP
// abierto y a la vista). Con toques reales: enciende ESCUCHA desde el cajón (micrófono del teléfono),
// mide lo que oye, comprueba que el mando se mueve mientras pinta y vuelve, mira NEÓN con la cámara
// real, y —si PITÁGORAS está en demostración en el puerto 8441 (adb reverse)— conecta STAGE a su
// señal. No guarda nada en el teléfono. Deja capturas en la carpeta que se le diga.
//   node pixel-listen.cjs <carpeta de capturas>
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const P = require('./pixel-lib.cjs');
const out = path.resolve(process.argv[2] || '.');
fs.mkdirSync(out, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const URL0 = process.env.PIXEL_URL || 'http://localhost:8760';

(async () => {
  const pages = (await P.targets()).filter(t => t.type === 'page' && t.url.startsWith(URL0));
  let c = null;
  for (const candidate of pages) {
    const probe = await Promise.race([P.connect(candidate), P.sleep(5000).then(() => null)]);
    if (!probe) continue;
    const seen = await Promise.race([probe.evaluate('document.visibilityState').catch(() => ''), P.sleep(4000).then(() => '')]);
    if (seen === 'visible') { c = probe; break; }
    probe.close();
  }
  if (!c) throw new Error('ninguna pestaña de FLIP está a la vista en el teléfono');
  const shot = name => c.screenshot(path.join(out, name + '.jpg'), { quality: 80 });
  const js = (fn, ...args) => c.evaluate('(' + fn.toString() + ')(' + args.map(a => JSON.stringify(a)).join(',') + ')');
  await c.send('Network.enable');
  await c.send('Network.setBypassServiceWorker', { bypass: true });
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.send('Page.bringToFront').catch(() => {});
  await js(() => { try { localStorage.setItem('flip.piel', 'interfaz'); localStorage.setItem('flip.rollo.carcasa', 'principal'); } catch (_) {} });
  await c.reload();
  await P.sleep(1500);
  for (let i = 0; i < 80; i++) { if (await c.evaluate(`document.readyState === 'complete' && !!window.flipShell && !!window.flipEscucha`).catch(() => false)) break; await P.sleep(500); }
  await P.sleep(900);
  if (await c.evaluate(`!document.getElementById('splash').classList.contains('hidden')`)) await c.tap('#btnSplashOriginal');
  for (let i = 0; i < 45; i++) { if (await c.evaluate('typeof vid !== "undefined" && vid.videoWidth > 0')) break; await P.sleep(1000); }
  await P.sleep(2000);

  // ── 1 · ESCUCHA con el micrófono del teléfono ──
  const permiso = await c.evaluate(`navigator.permissions.query({ name: 'microphone' }).then(p => p.state).catch(() => 'desconocido')`);
  await js(() => { _setCamFamily('PRENSA'); });
  await P.sleep(800);
  await c.tap('.si-abrir');
  await P.sleep(500);
  await c.tap('#escuchaOn');
  let on = false;
  for (let i = 0; i < 24 && !on; i++) { await P.sleep(500); on = await c.evaluate('flipEscucha.on && flipEscucha.state().mic'); }
  if (!on) {
    await shot('escucha-sin-microfono');
    console.log('· la escucha no encendió: permiso de micrófono = ' + permiso + ' (si el teléfono lo pregunta, hay que aceptarlo a mano)');
  } else {
    await shot('1-escucha-cajon');
    await c.tap('.si-abrir');
    const seen = { bass: 0, mid: 0, high: 0, moved: 0, frames: 0 };
    for (let i = 0; i < 30; i++) {
      await P.sleep(200);
      const s = await js(() => { const st = flipEscucha.state(), lv = flipEscucha.levels(); return { peak: st.peak, applied: st.applied, base: [pressRegVal, pressInkVal], beats: st.beats, lv: [lv.bass, lv.mid, lv.high], fps: document.getElementById('lcdFps').textContent, rotulo: (document.querySelector('.si-audio i') || {}).textContent }; });
      for (const k of ['bass', 'mid', 'high']) seen[k] = Math.max(seen[k], s.peak[k]);
      if (s.applied && (s.applied[0] > s.base[0] + 1 || s.applied[1] > s.base[1] + 1)) seen.moved++;
      seen.frames++; seen.beats = s.beats; seen.fps = s.fps; seen.rotulo = s.rotulo; seen.base = s.base;
    }
    await shot('2-escucha-camara');
    assert.equal(seen.rotulo, 'Escucha');
    assert.deepEqual(await js(() => [pressRegVal, pressInkVal]), seen.base, 'los mandos vuelven a su valor');
    step('ESCUCHA con el micrófono del teléfono', { permiso, picos: [seen.bass, seen.mid, seen.high].map(v => +v.toFixed(2)), cuadrosMovidos: seen.moved + '/' + seen.frames, golpes: seen.beats, ritmo: seen.fps });
    await c.tap('.si-abrir'); await P.sleep(400);
    await c.tap('#escuchaOn');
    for (let i = 0; i < 12; i++) { await P.sleep(400); if (!(await c.evaluate('flipEscucha.on'))) break; }
    await c.tap('.si-abrir');
    assert.equal(await c.evaluate('flipEscucha.on || flipEscucha.state().mic'), false, 'se apaga y suelta el micrófono');
  }

  // ── 2 · NEÓN con la cámara real ──
  await js(() => { _setCamFamily('VFD'); camVariant = 'NEON'; _applyCamState(); });
  await P.sleep(2500);
  const neon = await js(() => new Promise(resolve => { const t0 = performance.now(); let n = 0, last = ''; const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve({ fps: document.getElementById('lcdFps').textContent, variante: camVariant, etiqueta: document.querySelector('.si-variante b').textContent }); }; tick(); }));
  await shot('3-neon');
  assert.equal(neon.variante, 'NEON');
  step('NEÓN con la cámara real', neon);
  await js(() => { _setCamFamily('AUTO03'); });

  // ── 3 · STAGE · LIVE contra PITÁGORAS en demostración ──
  await c.tap('#shellModule'); await P.sleep(700);
  await c.tap('#shellLauncher [data-module="stage"]');
  for (let i = 0; i < 30; i++) { await P.sleep(500); if (await c.evaluate('!!window.flipStage && flipStage.active && flipStage.status().ok').catch(() => false)) break; }
  await P.sleep(1500);
  await shot('4-stage');
  const rig = await js(() => { const tabs = [...document.querySelectorAll('#rigTabs .hw-keycap')].map(k => ({ t: k.textContent.trim(), cabe: k.scrollWidth <= k.clientWidth + 1 })); return { tabs, fondo: getComputedStyle(document.getElementById('camBody')).backgroundColor }; });
  console.log('  pestañas de STAGE', JSON.stringify(rig.tabs.map(t => t.t + (t.cabe ? '' : ' ✗'))), rig.fondo);
  const linked = await js(() => flipStage.live.connect('http://localhost:8441/api/feed/stream?t=demo-senal', true));
  let live = null;
  for (let i = 0; i < 16; i++) { await P.sleep(500); live = await js(() => flipStage.status().live); if (live.state === 'on' && live.tracks.length > 5) break; }
  if (linked && live && live.state === 'on') {
    await js(() => { flipStage.route('lv2', 'geo.zoom', .6); });
    await P.sleep(2500);
    const s = await js(() => ({ live: flipStage.status().live, fuente: flipStage.status().bpmSource, bpm: flipStage.status().bpm, fps: flipStage.status().fps, kick: flipStage.mods().lv2 }));
    await shot('5-stage-live');
    assert.equal(s.fuente, 'LIVE');
    step('STAGE conectado a PITÁGORAS (demostración) desde el teléfono', { tomas: s.live.names.join(' '), bpm: s.bpm, fps: s.fps });
    await js(() => { flipStage.route('lv2', 'geo.zoom', 0); flipStage.live.disconnect(); });
  } else console.log('· STAGE no conectó con PITÁGORAS en demostración (¿encendido en 8441 y con adb reverse?): ' + JSON.stringify(live));
  await c.tap('#shellModule'); await P.sleep(700);
  await c.tap('#shellLauncher [data-module="cam"]');
  await P.sleep(800);
  const errors = c.log.filter(e => e.kind === 'error' && !/Graph|gl_context|XNNPACK|favicon/.test(e.text)).map(e => String(e.text).slice(0, 200));
  assert.deepEqual(errors, [], 'sin errores en la consola');
  console.log('PIXEL LISTEN PASS');
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
