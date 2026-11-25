// La marca y la cámara PRENSA en el teléfono de verdad (por USB, con la pestaña abierta por
// pixel-open.cjs). Recarga la app y, con toques reales, comprueba: portada (ident, marca,
// tipografías), arranque de la pantallita, piezas de la marca, luz viva y sensor de movimiento,
// carcasa oscura (lanzador, cámara y hoja de ajustes) y PRENSA con la cámara real en sus tres
// tiradas (que pinta en la gráfica, a color, a su cadencia y sin errores; foto al doble de tamaño
// igual al visor; vídeo corto de una pieza). No guarda nada en el teléfono: la foto se compara en
// memoria y el vídeo se examina sin escribirlo. Deja capturas en la carpeta que se le diga.
//   node pixel-brand.cjs <carpeta de capturas>
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
  const page = (await P.targets()).find(t => t.type === 'page' && t.url.startsWith(URL0));
  if (!page) throw new Error('no hay pestaña de FLIP abierta: corre antes pixel-open.cjs');
  const c = await P.connect(page);
  const shot = name => c.screenshot(path.join(out, name + '.jpg'), { quality: 72 });
  const js = (fn, ...args) => c.evaluate('(' + fn.toString() + ')(' + args.map(a => JSON.stringify(a)).join(',') + ')');
  await c.send('Network.enable');
  await c.send('Network.setBypassServiceWorker', { bypass: true });
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  const failed = [];
  c.on(msg => { if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) failed.push(msg.params.errorText); if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) failed.push(msg.params.response.status + ' ' + msg.params.response.url.slice(-60)); });
  await c.send('Page.bringToFront').catch(() => {});
  await js(() => { try { localStorage.setItem('flip.rollo.carcasa', 'principal'); } catch (_) {} });

  // ── 1 · Portada ──
  await c.reload();
  // Por red y sin caché la app tarda en llegar: se espera a que esté entera, no un tiempo fijo.
  await P.sleep(1500);
  for (let i = 0; i < 80; i++) { if (await c.evaluate(`document.readyState === 'complete' && !!window.flipShell && !!document.querySelector('.splash-hero.rollo-ident-listo')`).catch(() => false)) break; await P.sleep(500); }
  await P.sleep(800);
  const cover = await js(async () => {
    await document.fonts.ready;
    const title = document.querySelector('.rollo-titulo');
    return { screen: [innerWidth, innerHeight, devicePixelRatio], theme: document.body.dataset.tema, ident: (() => { const v = document.querySelector('.rollo-vivo'), h = document.querySelector('.splash-hero'); if (!v || !h) return 0; const a = v.getBoundingClientRect(), b = h.getBoundingClientRect(); const dentro = a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom && a.width > 120; return dentro && v.querySelectorAll('.rv-capa').length === 4 ? document.getAnimations().filter(x => x.animationName && x.animationName.startsWith('rv-') && x.playState === 'running').length : 0; })(), shown: !!document.querySelector('.splash-hero.rollo-ident-listo'), title: title ? title.naturalWidth : 0,
      chivo: document.fonts.check('800 12px Chivo'), plex: document.fonts.check('500 14px "IBM Plex Sans"'), doto: document.fonts.check('800 13px Doto'), agent: navigator.userAgent.match(/Chrome\/[\d.]+/)[0] };
  });
  assert.ok(cover.ident > 0 && cover.shown && cover.title > 0, 'la portada enseña el logo vivo y la marca: ' + JSON.stringify(cover));
  assert.ok(cover.chivo && cover.plex && cover.doto, 'las tres tipografías cargan: ' + JSON.stringify(cover));
  await shot('01-portada');
  step('portada', cover);

  // ── 2 · Arranque ──
  await c.tap('#btnSplashOriginal');
  const seen = [];
  for (let i = 0; i < 12; i++) { seen.push(await js(() => { const m = document.querySelector('#shellLcd .rollo-matriz'); return m ? m.querySelectorAll('rect').length : -1; })); if (i === 4) await shot('02-arranque'); await P.sleep(170); }
  const frames = new Set(seen.filter(n => n >= 0));
  assert.ok(frames.size >= 3, 'la pantallita corre la secuencia: ' + seen.join(' '));
  let video = false;
  for (let i = 0; i < 40 && !video; i++) { await P.sleep(500); video = await js(() => typeof vid !== 'undefined' && vid.videoWidth > 0 && !document.querySelector('#shellLcd .rollo-matriz')); }
  assert.ok(video, 'la cámara enciende y la pantallita vuelve a su estado');
  await P.sleep(1500);
  const cam = await js(() => {
    const url = (el, pseudo) => getComputedStyle(el, pseudo).backgroundImage + ' ' + getComputedStyle(el, pseudo).borderImageSource;
    const loaded = name => performance.getEntriesByType('resource').filter(e => e.name.includes(name)).map(e => e.decodedBodySize || e.transferSize || -1);
    return { lcd: document.getElementById('lcdLook').textContent, video: [vid.videoWidth, vid.videoHeight], shutter: /disparador-anil/.test(url(document.getElementById('deckShutter'), '::before')),
      key: /materiales\/tecla\.webp/.test(url(document.querySelector('.hw-keycap:not(.is-on):not([data-color])'), '::before')), shell: /materiales\/shell-top\.webp/.test(getComputedStyle(document.getElementById('camBody')).backgroundImage),
      foot: /placa-fl-27-compacta/.test(getComputedStyle(document.querySelector('#camDeck .rollo-pie')).backgroundImage), light: flipLight.state(), rest: flipRest.state().motion, shellBytes: loaded('shell-bottom.webp') };
  });
  assert.ok(cam.shutter && cam.key && cam.shell && cam.foot, 'las piezas son las de la marca: ' + JSON.stringify(cam));
  await shot('03-cam');
  step('arranque y cámara', { puntos: [...frames].join(' '), pantallita: cam.lcd, video: cam.video, luz: cam.light, movimiento: cam.rest });

  // ── 3 · Carcasa oscura ──
  await c.tap('#shellModule');
  await P.sleep(500);
  await shot('04-lanzador');
  await c.tap('#rolloTema');
  await P.sleep(500);
  const key = await js(() => ({ theme: document.body.dataset.tema, text: document.getElementById('rolloTema').textContent }));
  assert.deepEqual(key, { theme: 'oscuro', text: 'TEMA CLARO' });
  await shot('05-lanzador-oscuro');
  await c.tap('#launcherClose');
  await P.sleep(700);
  const dark = await js(() => ({ shell: /shell-top-oscuro/.test(getComputedStyle(document.getElementById('camBody')).backgroundImage), bezel: /bezel-oscuro/.test(getComputedStyle(document.getElementById('lcd')).borderImageSource),
    tray: /tray-oscuro/.test(getComputedStyle(document.querySelector('.deck-looks')).borderImageSource), print: getComputedStyle(document.querySelector('#camDeck .hw-print')).color }));
  assert.ok(dark.shell && dark.bezel && dark.tray, 'la carcasa oscura lleva sus marcos: ' + JSON.stringify(dark));
  await shot('06-cam-oscura');
  await c.tap('#shellSettings');
  await P.sleep(700);
  await shot('07-ajustes-oscura');
  await js(() => { const panel = document.getElementById('flipSettingsPanel'); if (panel.classList.contains('open')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await P.sleep(400);
  if (await js(() => document.getElementById('flipSettingsPanel').classList.contains('open'))) { await c.tap('#shellSettings'); await P.sleep(400); }
  await js(() => flipRollo.setTheme('principal'));
  step('carcasa oscura', dark);

  // ── 4 · PRENSA con la cámara real ──
  const press = {};
  const stats = () => js(() => {
    const w = display.width, h = display.height, d = ctxD.getImageData(0, 0, w, h).data;
    let vivid = 0, sum = 0, n = 0;
    const tones = new Set();
    for (let i = 0; i < d.length; i += 28) { n++; sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 70) vivid++; tones.add((d[i] >> 3 << 10) | (d[i + 1] >> 3 << 5) | (d[i + 2] >> 3)); }
    return { size: [w, h], luma: +(sum / n / 255).toFixed(3), vivid: +(vivid / n).toFixed(3), tones: tones.size };
  });
  await js(() => { const tile = document.querySelector('#deckLooks .look[data-family="PRENSA"]'); tile.scrollIntoView({ inline: 'center', block: 'nearest' }); });
  await P.sleep(500);
  await c.tap('#deckLooks .look[data-family="PRENSA"]');
  await P.sleep(1500);
  const gl = await js(() => {
    const probe = document.createElement('canvas').getContext('webgl');
    const info = probe && probe.getExtension('WEBGL_debug_renderer_info');
    const high = probe && probe.getShaderPrecisionFormat(probe.FRAGMENT_SHADER, probe.HIGH_FLOAT);
    return { family: camFamily, state: flipPress.state(), renderer: info ? probe.getParameter(info.UNMASKED_RENDERER_WEBGL) : '?', highp: high ? high.precision : 0, maxTexture: probe ? probe.getParameter(probe.MAX_TEXTURE_SIZE) : 0 };
  });
  assert.equal(gl.family, 'PRENSA', 'la diapositiva de PRENSA se elige con un toque');
  assert.ok(gl.state.ready && !gl.state.failed, 'PRENSA pinta en la gráfica del teléfono: ' + JSON.stringify(gl));
  for (const variant of ['CMYK', 'DIARIO', 'RISO']) {
    await js(v => { camVariant = v; _applyCamState(); }, variant);
    await P.sleep(1500);
    // Cadencia real: cuadros pintados en 3 s.
    const fps = await js(() => new Promise(done => { const real = window.renderPress; let n = 0; window.renderPress = function () { n++; return real.apply(this, arguments); }; setTimeout(() => { window.renderPress = real; done(+(n / 3).toFixed(1)); }, 3000); }));
    const s = await stats();
    press[variant] = { ...s, fps, state: await js(() => { const st = flipPress.state(); return [st.mode, st.w, st.h, +st.cell.toFixed(1), st.fw, st.fh]; }) };
    await shot('08-prensa-' + variant.toLowerCase());
    assert.ok(s.luma > 0.08 && s.luma < 0.95 && s.tones > 30, variant + ': hay imagen impresa ' + JSON.stringify(s));
    // La cadencia que toca es la del teléfono: la de fábrica de PRENSA (24) o la que el usuario tenga limitada.
    const target = await js(() => camFpsTarget);
    press[variant].target = target;
    assert.ok(fps > target * 0.85, variant + ': va a su cadencia (' + fps + ' de ' + target + ')');
  }
  assert.ok(press.DIARIO.vivid < 0.02, 'DIARIO es de una tinta en el teléfono: ' + press.DIARIO.vivid);
  step('PRENSA con cámara real', { grafica: gl.renderer, highp: gl.highp, ...press });

  // La foto (el camino de captura, al doble de tamaño) frente al visor, en memoria.
  await js(() => { camVariant = 'CMYK'; _applyCamState(); });
  await P.sleep(800);
  const photo = await js(() => {
    const coarse = canvas => { const w = canvas.width, h = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, w, h).data, cols = 48, rows = Math.round(48 * h / w), sum = new Float64Array(cols * rows), cnt = new Float64Array(cols * rows);
      for (let y = 0; y < h; y++) { const r = Math.min(rows - 1, Math.floor(y * rows / h)) * cols; for (let x = 0; x < w; x += 2) { const at = r + Math.min(cols - 1, Math.floor(x * cols / w)), i = 4 * (y * w + x); sum[at] += d[i] + d[i + 1] + d[i + 2]; cnt[at]++; } }
      return Array.from(sum, (v, i) => v / cnt[i]); };
    const corr = (a, b) => { const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; } return ab / Math.sqrt(aa * bb || 1); };
    // Mismo cuadro de cámara para las dos: se congela en un lienzo.
    const frame = liveCamFrame(), still = document.createElement('canvas'); still.width = frame.srcW; still.height = frame.srcH; still.getContext('2d').drawImage(frame.source, 0, 0, frame.srcW, frame.srcH);
    const make = (w, h, path) => { const c = document.createElement('canvas'); c.width = w; c.height = h; _renderCamEngineFrame(still, still.width, still.height, c.getContext('2d', { willReadFrequently: true }), false, { path, family: 'PRENSA', variant: 'CMYK', outW: w, outH: h, now: performance.now() }); return c; };
    const small = make(display.width, display.height, 'preview'), big = make(display.width * 2, display.height * 2, 'capture');
    return { small: [small.width, small.height], big: [big.width, big.height], corr: +corr(coarse(small), coarse(big)).toFixed(4), canvas: flipPress.state().canvas };
  });
  assert.ok(photo.corr > 0.97, 'la foto grande es el visor ampliado: ' + JSON.stringify(photo));
  step('foto como el visor', photo);

  // Vídeo corto con PRENSA, sin escribirlo en el teléfono.
  const clip = await js(async () => {
    const realSave = window.saveBlob, realShare = window._shareOrDownload;
    let got = null;
    window.saveBlob = async blob => { got = blob; };
    try {
      if (!document.body.classList.contains('cam-video')) document.getElementById('deckModeSwitch').click();
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('deckShutter').click();
      await new Promise(r => setTimeout(r, 3600));
      const recording = document.body.classList.contains('is-recording');
      document.getElementById('deckShutter').click();
      for (let i = 0; i < 60 && !got; i++) await new Promise(r => setTimeout(r, 250));
      if (!got) return { recording, error: 'no llegó el archivo' };
      const flat = window.flipMp4 && /mp4/.test(got.type) ? await flipMp4.flatten(got) : null;
      const video = document.createElement('video'); video.muted = true; video.src = URL.createObjectURL(flat ? flat.blob : got);
      const meta = await new Promise(done => { video.onloadedmetadata = () => done({ duration: +video.duration.toFixed(2), size: [video.videoWidth, video.videoHeight] }); video.onerror = () => done({ error: 'no se abre' }); setTimeout(() => done({ error: 'tarda' }), 6000); });
      URL.revokeObjectURL(video.src);
      return { recording, type: got.type, kb: Math.round(got.size / 1024), ...meta, flat: flat ? flat.info : null };
    } finally { window.saveBlob = realSave; if (document.body.classList.contains('cam-video')) document.getElementById('deckModeSwitch').click(); }
  });
  await P.sleep(800);
  assert.ok(clip.recording && !clip.error && clip.duration > 2 && clip.duration < 6, 'el vídeo de PRENSA se graba y se abre: ' + JSON.stringify(clip));
  step('vídeo con PRENSA', clip);

  await js(() => { _setCamFamily('DSI'); });
  const errors = c.log.filter(e => /exception|error/.test(e.kind) && !/XNNPACK|odml|Graph|gl_context/.test(e.text));
  assert.deepEqual(errors.map(e => e.text.slice(0, 160)), [], 'sin errores en la consola del teléfono');
  assert.deepEqual(failed, [], 'ningún archivo falla al cargar');
  console.log('PIXEL BRAND PASS');
  c.close();
})().catch(e => { console.error('PIXEL BRAND FAIL\n', e.message || e); process.exit(1); });
