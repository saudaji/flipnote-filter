// La piel INTERFAZ («Silueta») en el teléfono de verdad (por USB, con la pestaña abierta por
// pixel-open.cjs). Con toques reales comprueba: que abre con la piel de fábrica y sus tipografías,
// que el visor va de borde a borde y nada cuelga fuera, que el disparador cierra el ojo mientras
// se pulsa y toma la foto, que la variante pasa a la siguiente con un toque, que el cajón abre sin
// mover la imagen, tema oscuro, y que la piel OBJETO vuelve y se va con su tecla. Mide además el
// ritmo de la cámara con cada piel. No guarda nada en el teléfono: la descarga se retiene en memoria.
//   node pixel-skin.cjs <carpeta de capturas>
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
  // Si hay varias pestañas de FLIP, se usa la que está a la vista (no se cierra ninguna).
  const pages = (await P.targets()).filter(t => t.type === 'page' && t.url.startsWith(URL0));
  if (!pages.length) throw new Error('no hay pestaña de FLIP abierta: corre antes pixel-open.cjs');
  let c = null;
  for (const candidate of pages) {
    const probe = await P.connect(candidate);
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
  const before = await js(() => ({ piel: localStorage.getItem('flip.piel'), tema: localStorage.getItem('flip.rollo.carcasa') }));
  await js(() => { try { localStorage.removeItem('flip.piel'); localStorage.setItem('flip.rollo.carcasa', 'principal'); } catch (_) {} });
  await c.reload();
  await P.sleep(1500);
  for (let i = 0; i < 80; i++) { if (await c.evaluate(`document.readyState === 'complete' && !!window.flipShell && !!window.flipPiel`).catch(() => false)) break; await P.sleep(500); }
  await P.sleep(900);
  await shot('1-portada');
  if (await c.evaluate(`!document.getElementById('splash').classList.contains('hidden')`)) await c.tap('#btnSplashOriginal');
  for (let i = 0; i < 45; i++) { if (await c.evaluate('typeof vid !== "undefined" && vid.videoWidth > 0')) break; await P.sleep(1000); }
  await P.sleep(2500);

  // ── 1 · Piel de fábrica, tipografías y encaje ──
  const base = await js(async () => {
    await document.fonts.ready;
    const r = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
    const out = [];
    for (const node of document.querySelectorAll('#shellTop .hw, #camDeck .hw:not(.look), .si-banda-cabeza button, .si-placa')) {
      const b = node.getBoundingClientRect();
      if (b.width && (b.left < -0.5 || b.right > innerWidth + 0.5 || b.bottom > innerHeight + 0.5)) out.push(node.id || node.className);
    }
    return { piel: document.body.dataset.piel, view: [innerWidth, innerHeight], dpr: devicePixelRatio, video: [vid.videoWidth, vid.videoHeight], visor: r('#osd'), imagen: r('#display'), barra: r('#shellTop'), pupitre: r('#camDeck'),
      marco: getComputedStyle(document.getElementById('lcd')).display, out, scroll: document.documentElement.scrollWidth > innerWidth + 1,
      fuentes: ['800 12px Chivo', '800 12px Doto', '500 12px "IBM Plex Sans"'].map(f => document.fonts.check(f)),
      disparador: (b => [Math.round(b.width), Math.round(b.height)])(document.getElementById('deckShutter').getBoundingClientRect()) };
  });
  assert.equal(base.piel, 'interfaz', 'piel de fábrica');
  assert.equal(base.marco, 'none');
  assert.deepEqual([base.visor[0], base.visor[2]], [0, base.view[0]], 'visor de borde a borde');
  assert.ok(Math.abs(base.visor[1] - base.barra[3]) <= 1 && Math.abs(base.visor[3] - base.pupitre[1]) <= 1, 'visor entre la barra y la banda');
  assert.deepEqual(base.out, [], 'nada cuelga fuera');
  assert.equal(base.scroll, false);
  assert.deepEqual(base.fuentes, [true, true, true], 'tipografías cargadas');
  assert.deepEqual(base.disparador, [88, 84]);
  await shot('2-camara-clara');
  step('piel INTERFAZ en el Pixel', { pantalla: base.view.join('×') + ' @' + base.dpr, camara: base.video.join('×'), visor: (base.visor[2] - base.visor[0]) + '×' + (base.visor[3] - base.visor[1]), imagen: (base.imagen[2] - base.imagen[0]) + '×' + (base.imagen[3] - base.imagen[1]) });

  // Ritmo de la cámara con la piel puesta (cuadros pintados por segundo, 4 s).
  const pace = () => js(() => new Promise(resolve => { const start = performance.now(), from = typeof frameCount === 'number' ? frameCount : -1; let raf = 0; const tick = () => { raf++; if (performance.now() - start < 4000) requestAnimationFrame(tick); else resolve({ raf: +(raf / 4).toFixed(1), fps: document.getElementById('lcdFps').textContent }); }; requestAnimationFrame(tick); }));
  const paceInterfaz = await pace();
  step('ritmo con INTERFAZ', paceInterfaz);
  const alto = await js(() => Object.fromEntries([['cabecera', '.si-banda-cabeza'], ['tira', '.deck-looks'], ['botonera', '#camDeck .deck-main'], ['placa', '.si-placa'], ['pupitre', '#camDeck']].map(([k, sel]) => [k, Math.round(document.querySelector(sel).getBoundingClientRect().height)])));
  console.log('  alturas', JSON.stringify(alto), 'formato', await c.evaluate('_getCurrentAspectId()'));

  // ── 2 · El disparador cierra el ojo mientras se pulsa, y toma la foto ──
  await js(() => { window.__siReal = [window._downloadBlob, window._shareOrDownload]; window.__siGot = []; window._downloadBlob = (blob, name) => { window.__siGot.push([blob.type, blob.size, name]); }; window._shareOrDownload = async (blob, name) => { window.__siGot.push([blob.type, blob.size, name]); }; });
  const eye = () => js(() => { const s = document.getElementById('deckShutter'); return { guino: s.classList.contains('guino') || s.matches(':active'), abierto: +getComputedStyle(s.querySelector('.silueta .ojo')).opacity, cerrado: +getComputedStyle(s.querySelector('.silueta .cerrado')).opacity }; });
  assert.deepEqual(await eye(), { guino: false, abierto: 1, cerrado: 0 }, 'en reposo, un ojo abierto');
  const [sx, sy] = await c.point('#deckShutter');
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  await P.sleep(160);
  const held = await eye();
  await shot('3-guino-pulsado');
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.deepEqual(held, { guino: true, abierto: 0, cerrado: 1 }, 'pulsado: ojo cerrado');
  await P.sleep(700);
  assert.deepEqual(await eye(), { guino: false, abierto: 1, cerrado: 0 }, 'al soltar lo abre');
  let photo = null;
  for (let i = 0; i < 20 && !photo; i++) { await P.sleep(300); photo = await js(() => window.__siGot[0] || null); }
  assert.ok(photo && /^image\//.test(photo[0]) && photo[1] > 20000, 'tomó la foto: ' + JSON.stringify(photo));
  assert.equal(await js(() => document.getElementById('deckGallery').classList.contains('has-shot')), true, 'la miniatura TOMA la enseña');
  await shot('4-tras-foto');
  step('el disparador guiña al toque y toma la foto', { foto: Math.round(photo[1] / 1024) + ' KB' });

  // ── 3 · Variante con un toque; cajón sin mover la imagen ──
  // (Tocar la cámara ya elegida abre el cajón: solo se toca si hay que cambiar a ella.)
  if (await c.evaluate(`camFamily !== 'AUTO03'`)) {
    await js(() => document.querySelector('#deckLooks [data-family="AUTO03"]').scrollIntoView({ inline: 'center', block: 'nearest' }));
    await P.sleep(500);
    await c.tap('#deckLooks [data-family="AUTO03"]');
    await P.sleep(900);
  }
  const v0 = await js(() => ({ now: camVariant, keys: [...document.querySelectorAll('#deckVariants [data-variant]')].map(k => k.dataset.variant), label: document.querySelector('.si-variante b').textContent.trim() }));
  await c.tap('.si-variante');
  await P.sleep(600);
  const v1 = await js(() => ({ now: camVariant, label: document.querySelector('.si-variante b').textContent.trim(), abierto: document.body.classList.contains('banda-abierta') }));
  assert.equal(v1.now, v0.keys[(v0.keys.indexOf(v0.now) + 1) % v0.keys.length], 'un toque pasa a la siguiente variante');
  assert.equal(v1.abierto, false);
  const img0 = await js(() => { const b = document.getElementById('display').getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round); });
  await c.tap('.si-abrir');
  await P.sleep(500);
  const drawer = await js(() => ({ visible: getComputedStyle(document.getElementById('siCajon')).display !== 'none', teclas: [...document.querySelectorAll('#siCajon button')].filter(b => b.getBoundingClientRect().width).map(b => Math.round(b.getBoundingClientRect().height)),
    imagen: (b => [b.left, b.top, b.width, b.height].map(Math.round))(document.getElementById('display').getBoundingClientRect()), dentro: [...document.querySelectorAll('#siCajon button')].every(b => { const r = b.getBoundingClientRect(); return !r.width || (r.left >= 0 && r.right <= innerWidth + 0.5); }) }));
  await shot('5-cajon');
  assert.ok(drawer.visible && drawer.dentro && Math.min(...drawer.teclas) >= 44, 'cajón abierto, con teclas de 44 px dentro de la pantalla: ' + JSON.stringify(drawer));
  assert.deepEqual(drawer.imagen, img0, 'la imagen no se mueve');
  await c.tap('#siCajon [data-variant="' + v0.keys[0] + '"]');
  await P.sleep(400);
  await c.tap('.si-abrir');
  await P.sleep(400);
  step('variante a un toque; cajón sin mover la imagen', { de: v0.label, a: v1.label, variantes: v0.keys.length });

  // ── 4 · Tema oscuro y lanzador ──
  await js(() => flipRollo.setTheme('oscuro'));
  await P.sleep(700);
  await shot('6-camara-oscura');
  await c.tap('#shellModule');
  await P.sleep(900);
  await shot('7-lanzador-oscuro');
  const row = await js(() => [...document.querySelectorAll('.si-personal button')].map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), ok: r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && b.scrollWidth <= b.clientWidth + 1 }; }));
  assert.ok(row.length === 3 && row.every(k => k.ok), 'las tres teclas de apariencia caben con su texto: ' + JSON.stringify(row));
  await js(() => flipRollo.setTheme('principal'));

  // ── 5 · La piel OBJETO vuelve con su tecla, y se va ──
  await c.tap('#flipPiel');
  await P.sleep(900);
  await c.tap('#launcherClose');
  await P.sleep(900);
  const objeto = await js(() => ({ piel: document.body.dataset.piel, marco: getComputedStyle(document.getElementById('lcd')).display !== 'none', silueta: getComputedStyle(document.querySelector('#deckShutter .silueta')).display }));
  assert.deepEqual(objeto, { piel: 'objeto', marco: true, silueta: 'none' });
  await shot('8-piel-objeto');
  const paceObjeto = await pace();
  step('piel OBJETO intacta', { ritmo: paceObjeto });
  await js(() => flipPiel.set('interfaz'));
  await P.sleep(600);

  // Se deja como estaba: descargas de verdad y la piel/tema que tenía el teléfono.
  await js((piel, tema) => { [window._downloadBlob, window._shareOrDownload] = window.__siReal; delete window.__siReal; delete window.__siGot; if (piel) flipPiel.set(piel); if (tema) flipRollo.setTheme(tema); }, before.piel, before.tema);
  const errors = c.log.filter(e => e.kind === 'error' && !/Graph|gl_context|XNNPACK|favicon/.test(e.text)).map(e => String(e.text).slice(0, 200));
  assert.deepEqual(errors, [], 'sin errores en la consola');
  console.log('PIXEL SKIN PASS');
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
