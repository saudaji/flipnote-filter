// STAGE · sintetizador de vídeo modular (docs/stage.js).
// Comprueba el motor (fuentes, mezcla, bucle, geometría, color, salida), la modulación (LFO, sonido,
// parcheo con cables), las escenas, MIDI (aprendizaje, notas, reloj), la consola y la ventana de salida.
//   FLIP_URL=http://127.0.0.1:8760 node tests/stage.cjs [carpeta-de-capturas]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch, openFlip, openModule, stageTab } = require('./lib/harness.cjs');
const out = process.argv[2];
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${(+a).toFixed(1)} frente a ${b} (±${tol})`);

async function phone(browser) {
  const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
  await page.evaluate(() => { localStorage.removeItem('flip.stage.v3'); flipStage.reset(); });
  const settle = ms => page.waitForTimeout(ms);
  const S = () => page.evaluate(() => flipStage.status());
  const probe = (x, y, w, h) => page.evaluate(r => flipStage.probe(r[0], r[1], r[2], r[3]), [x, y, w, h]);
  const center = async selector => { const box = await page.locator(selector).first().boundingBox(); return [box.x + box.width / 2, box.y + box.height / 2]; };
  const drag = async (selector, dx, dy) => { const [x, y] = await center(selector); await page.mouse.move(x, y); await page.mouse.down(); for (let i = 1; i <= 6; i++) await page.mouse.move(x + dx * i / 6, y + dy * i / 6); await page.mouse.up(); await settle(60); };

  // 1 · Entra por el lanzador y dibuja la cámara por la vía rápida de planos.
  await openModule(page, 'stage');
  await page.waitForFunction(() => flipStage.status().hasA, null, { timeout: 15000 });
  // El primer cuadro puede llegar por la vía directa mientras se copia el primero de los planos.
  await page.waitForFunction(() => flipStage.status().path.startsWith('planos'), null, { timeout: 8000 }).catch(() => {});
  let st = await S();
  assert.equal(st.ok, true, 'WebGL 2: ' + st.error);
  assert.deepEqual(st.size, [960, 540], 'calidad AUTO en un teléfono');
  assert.ok(st.path.startsWith('planos'), 'la cámara entra por sus planos nativos: ' + st.path);
  assert.equal(st.name, 'DIRECTO');
  await page.evaluate(() => { flipStage.recall(0, true); for (const id of ['sig.scan', 'sig.rgb']) flipStage.set(id, 0); flipStage.set('col.sat', .5); flipStage.set('col.con', .5); flipStage.route('bass', 'sig.rgb', 0); flipStage.route('beat', 'geo.zoom', 0); });
  await settle(400);
  const viaPlanes = await probe(.3, .3, .4, .4);
  assert.ok(viaPlanes.r + viaPlanes.g + viaPlanes.b > 120, 'la cámara se ve: ' + JSON.stringify(viaPlanes));
  // La subida directa del vídeo da la misma imagen.
  await page.evaluate(() => flipStage.camera.direct(true));
  await settle(400);
  assert.equal((await S()).path, 'directa');
  const direct = await probe(.3, .3, .4, .4);
  for (const ch of ['r', 'g', 'b']) near(viaPlanes[ch], direct[ch], 14, 'planos y vídeo directo coinciden en ' + ch);
  await page.evaluate(() => flipStage.camera.direct(false));

  // 2 · El sombreador convierte bien los planos YUV (I420 y NV12, BT.601 de rango limitado).
  const yuv = await page.evaluate(async () => {
    const w = 64, h = 36, cw = 32, ch = 18, results = {};
    const colors = [[81, 90, 240], [41, 240, 110]];                     // rojo y azul puros
    for (const kind of ['planar', 'biplanar']) {
      const data = new Uint8Array(w * h + 2 * cw * ch);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = colors[x < w / 2 ? 0 : 1][0];
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const c = colors[x < cw / 2 ? 0 : 1];
        if (kind === 'planar') { data[w * h + y * cw + x] = c[1]; data[w * h + cw * ch + y * cw + x] = c[2]; }
        else { data[w * h + y * w + 2 * x] = c[1]; data[w * h + y * w + 2 * x + 1] = c[2]; }
      }
      const layout = kind === 'planar' ? [{ offset: 0, stride: w }, { offset: w * h, stride: cw }, { offset: w * h + cw * ch, stride: cw }] : [{ offset: 0, stride: w }, { offset: w * h, stride: w }];
      flipStage.camera.inject({ kind, format: kind === 'planar' ? 'I420' : 'NV12', width: w, height: h, data, layout, matrix: 'smpte170m', fullRange: false, seq: kind === 'planar' ? 1 : 2, at: performance.now() });
      flipStage.step(2);
      results[kind] = { left: flipStage.probe(.1, .3, .25, .4), right: flipStage.probe(.65, .3, .25, .4), path: flipStage.status().path };
    }
    flipStage.camera.inject(null);
    return results;
  });
  for (const kind of ['planar', 'biplanar']) {
    const { left, right } = yuv[kind];
    assert.ok(left.r > 240 && left.g < 14 && left.b < 14, kind + ': rojo ' + JSON.stringify(left));
    assert.ok(right.b > 240 && right.r < 14 && right.g < 14, kind + ': azul ' + JSON.stringify(right));
  }
  await settle(300);

  // 3 · Generador y mezcla: la carta de ajuste tiene sus barras donde toca.
  await page.evaluate(() => flipStage.recall(7, true));
  await settle(200);
  const white = await probe(.02, .1, .1, .3), blue = await probe(.88, .1, .1, .3), green = await probe(.45, .1, .08, .3);
  near(white.r, 191, 6, 'barra blanca'); near(white.b, 191, 6, 'barra blanca (azul)');
  assert.ok(blue.b > 180 && blue.r < 8 && blue.g < 8, 'barra azul ' + JSON.stringify(blue));
  assert.ok(green.g > 180 && green.r < 8 && green.b < 8, 'barra verde ' + JSON.stringify(green));
  // 4 · Color y salida: negativo, nivel y corte a negro.
  await page.evaluate(() => flipStage.set('col.inv', 1));
  near((await probe(.02, .1, .1, .3)).r, 64, 6, 'negativo de la barra blanca');
  await page.evaluate(() => { flipStage.set('col.inv', 0); flipStage.set('out.level', .5); });
  near((await probe(.02, .1, .1, .3)).r, 96, 6, 'nivel a la mitad');
  await page.evaluate(() => { flipStage.set('out.level', 1); flipStage.key('b'); flipStage.step(60); });
  assert.ok((await probe(.02, .1, .1, .3)).r < 3, 'tecla B: salida en negro');
  await page.evaluate(() => { flipStage.key('b'); flipStage.step(60); });
  near((await probe(.02, .1, .1, .3)).r, 191, 6, 'vuelve del negro');
  // 5 · Geometría: el espejo horizontal repite la mitad izquierda; el caleidoscopio es simétrico.
  await page.evaluate(() => flipStage.set('geo.mirror', 1));
  const mirrored = await probe(.88, .1, .1, .3);
  near(mirrored.r, 191, 8, 'espejo: a la derecha, la barra blanca'); near(mirrored.b, 191, 8, 'espejo (azul)');
  await page.evaluate(() => { flipStage.set('geo.mirror', 0); flipStage.set('geo.kal', .6); });
  const kl = await probe(.25, .2, .1, .1), kr = await probe(.65, .2, .1, .1);
  for (const ch of ['r', 'g', 'b']) near(kl[ch], kr[ch], 10, 'caleidoscopio simétrico en ' + ch);
  await page.evaluate(() => flipStage.set('geo.kal', 0));
  // 6 · Bucle: con la fuente a negro, la imagen anterior sigue en pantalla y se va apagando.
  const trail = await page.evaluate(() => {
    flipStage.set('fb.mode', 1); flipStage.set('fb.amt', 1); flipStage.set('fb.decay', .86); flipStage.step(30);
    flipStage.set('src.gen', 0); flipStage.step(4);
    const soon = flipStage.probe(.02, .1, .1, .3).r;
    flipStage.step(240);
    return { soon, late: flipStage.probe(.02, .1, .1, .3).r };
  });
  assert.ok(trail.soon > 120, 'el bucle retiene la imagen: ' + trail.soon);
  assert.ok(trail.late < trail.soon * .35, 'y la estela se apaga: ' + JSON.stringify(trail));

  // 7 · Las ocho escenas de fábrica dibujan sin errores; SILUETA carga su recorte.
  for (let i = 0; i < 8; i++) {
    await page.evaluate(n => { flipStage.recall(n, true); flipStage.step(8); }, i);
    const px = await probe(.1, .1, .8, .8);
    assert.ok(px.r + px.g + px.b > 20, 'la escena ' + (i + 1) + ' no sale en negro');
  }
  // Tras una escena que gira y cicla el color, la siguiente no se queda torcida ni teñida.
  const settled = await page.evaluate(() => {
    flipStage.recall(2, true); flipStage.set('col.cycle', .9); flipStage.step(100);
    flipStage.recall(7, true); flipStage.step(150);
    return flipStage.probe(.02, .1, .1, .3);
  });
  near(settled.r, 191, 8, 'la carta vuelve derecha tras el giro'); near(settled.b, 191, 8, 'y sin tinte');
  await page.evaluate(() => flipStage.recall(3, true));
  const masked = await page.waitForFunction(() => flipStage.status().hasMask, null, { timeout: 45000 }).then(() => true, () => false);
  if (!masked) console.log('aviso: el recorte de silueta no cargó (necesita red la primera vez)');

  // 8 · Modulación: LFO, sonido y golpe llegan a los mandos.
  const mod = await page.evaluate(() => {
    flipStage.recall(7, true);
    flipStage.set('lfo1.shape', 3); flipStage.set('lfo1.rate', .8); flipStage.set('out.level', .5); flipStage.route('lfo1', 'out.level', .5);
    const seen = new Set();
    for (let i = 0; i < 90; i++) { flipStage.step(1); seen.add(Math.round(flipStage.value('out.level') * 10)); }
    flipStage.route('lfo1', 'out.level', 0); flipStage.set('out.level', 1);
    flipStage.audio.inject({ bass: 1, mid: .5, high: 0, beat: 1 });
    flipStage.set('sig.rgb', .2); flipStage.route('bass', 'sig.rgb', .5); flipStage.route('mid', 'col.hue', .4);
    flipStage.step(1);
    const withSound = { rgb: flipStage.value('sig.rgb'), hue: flipStage.value('col.hue'), beat: flipStage.mods().beat };
    flipStage.step(60);
    const later = flipStage.mods().beat;
    flipStage.audio.inject(null); flipStage.route('bass', 'sig.rgb', 0); flipStage.route('mid', 'col.hue', 0); flipStage.set('sig.rgb', 0);
    return { square: [...seen].sort((a, b) => a - b), withSound, later };
  });
  assert.deepEqual(mod.square, [0, 10], 'un LFO cuadrado lleva el nivel de 0 a 1');
  near(mod.withSound.rgb, .7, .01, 'los graves empujan RGB'); near(mod.withSound.hue, .2, .01, 'los medios empujan el matiz');
  assert.ok(mod.withSound.beat > .8 && mod.later < .05, 'el golpe salta y se apaga: ' + JSON.stringify([mod.withSound.beat, mod.later]));

  // 8b · Música de verdad por el analizador: bombo a 128 por minuto, platos y un acorde, sintetizados.
  // Tiene que seguirla a volumen normal, 24 dB más baja (se adapta sola) y callar en el silencio.
  await page.evaluate(() => {
    flipStage.audio.use(ctx => {
      const rate = ctx.sampleRate, beat = 60 / 128, n = Math.round(rate * beat * 32);
      const buffer = ctx.createBuffer(1, n, rate), d = buffer.getChannelData(0);
      let seed = 7;
      const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
      for (let i = 0; i < n; i++) {
        const t = i / rate, tb = t % beat, th = (t + beat / 2) % beat;
        d[i] = Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-tb * 28)) * tb) * Math.exp(-tb * 9) * .9 + noise() * Math.exp(-th * 60) * .18
          + Math.sin(2 * Math.PI * 440 * t) * .05 + Math.sin(2 * Math.PI * 660 * t) * .04;
      }
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = buffer; source.loop = true; gain.gain.value = .5;
      source.connect(gain); source.start();
      window.__music = gain;
      return gain;
    });
  });
  const listen = (ms, from = 0) => page.evaluate(([ms, from]) => new Promise(done => {
    const t0 = performance.now(), start = flipStage.status().audio.beats; let lo = 1, hi = 0;
    const tick = () => {
      const t = performance.now() - t0;
      if (t >= from) { const bass = flipStage.mods().bass; lo = Math.min(lo, bass); hi = Math.max(hi, bass); }
      if (t < ms) requestAnimationFrame(tick); else { const a = flipStage.status(); done({ beats: a.audio.beats - start, bpm: a.audio.bpm, source: a.bpmSource, lo, hi, level: a.audio.level, silent: a.audio.silent }); }
    };
    tick();
  }), [ms, from]);
  const loud = await listen(7000, 2500);
  assert.ok(loud.beats >= 12 && loud.beats <= 18, 'cuenta los golpes del bombo (unos 15 en 7 s): ' + loud.beats);
  near(loud.bpm, 128, 4, 'saca el tempo de la música'); assert.equal(loud.source, 'AUTO');
  assert.ok(loud.hi > .8 && loud.lo < .25, 'los graves suben con cada bombo y bajan entre ellos: ' + JSON.stringify(loud));
  assert.ok(loud.level > .3, 'el medidor enseña que la señal llega: ' + loud.level);
  await page.evaluate(() => { window.__music.gain.value = .5 * Math.pow(10, -24 / 20); });
  const soft = await listen(7000, 4000);
  assert.ok(soft.beats >= 11, 'con la música 24 dB más baja sigue contando golpes: ' + soft.beats);
  assert.ok(soft.hi > .6, 'y los mandos siguen moviéndose igual de lejos: ' + JSON.stringify(soft));
  await page.evaluate(() => { window.__music.gain.value = 0; });
  const hush = await listen(5500, 3000);
  assert.ok(hush.beats <= 1 && hush.hi < .05 && hush.silent && hush.bpm === 0, 'en silencio no inventa golpes ni tempo y avisa de que no llega señal: ' + JSON.stringify(hush));
  assert.equal(await page.locator('#rigTallyAudio b').textContent(), 'NO LLEGA SEÑAL');
  await page.evaluate(() => flipStage.audio.off());
  assert.equal(await page.locator('#rigTallyAudio b').textContent().then(async () => { await settle(200); return page.locator('#rigTallyAudio b').textContent(); }), 'SIN SONIDO');

  // 9 · Consola: perillas con el dedo, doble toque a fábrica, parcheo con cables.
  await stageTab(page, 'fb');
  const before = await page.evaluate(() => flipStage.get('fb.amt'));
  await drag('.rig-knob[data-param="fb.amt"] .dial', 0, -80);
  const after = await page.evaluate(() => flipStage.get('fb.amt'));
  assert.ok(after > before + .3, 'arrastrar hacia arriba sube el mando: ' + before + ' → ' + after);
  assert.ok((await page.locator('#lcdLook').textContent()).startsWith('CANTIDAD'), 'la pantallita dice qué se mueve');
  await page.locator('.rig-knob[data-param="fb.amt"] .dial').dblclick();
  near(await page.evaluate(() => flipStage.get('fb.amt')), 0, .001, 'doble toque: de fábrica');
  await drag('.rig-knob[data-param="fb.zoom"] .dial', 0, -4);
  near(await page.evaluate(() => flipStage.get('fb.zoom')), .5, .001, 'el mando con centro se queda en su muesca');
  // Cable: toma LFO 1 y después la perilla.
  await page.locator('.rig-jack[data-src="lfo1"]').click();
  assert.equal((await S()).armed, 'lfo1');
  await page.locator('.rig-knob[data-param="fb.rot"] .dial').click();
  st = await S();
  assert.deepEqual(st.routes.find(r => r[0] === 'lfo1' && r[1] === 'fb.rot'), ['lfo1', 'fb.rot', .5], 'tocar la perilla conecta el cable');
  assert.ok(await page.locator('#rigCables path.cord').count() >= 1, 'el cable se dibuja');
  assert.ok(await page.locator('.rig-knob[data-param="fb.rot"].is-patched').count() === 1, 'la perilla enseña su collar');
  // Con el cable en la mano, arrastrar la perilla cambia cuánto modula.
  await drag('.rig-knob[data-param="fb.rot"] .dial', 0, 60);
  const depth = (await S()).routes.find(r => r[0] === 'lfo1' && r[1] === 'fb.rot')[2];
  assert.ok(depth < .1, 'arrastrar con el cable cambia la cantidad: ' + depth);
  await page.locator('.rig-knob[data-param="fb.rot"] .dial').click();
  assert.equal((await S()).routes.some(r => r[0] === 'lfo1' && r[1] === 'fb.rot'), false, 'otro toque lo suelta');
  await page.locator('.rig-jack[data-src="lfo1"]').click();
  assert.equal((await S()).armed, '');
  // Selector y deslizador.
  await stageTab(page, 'mix');
  await page.locator('.rig-pick[data-pick="mix.mode"] [data-step="1"]').click();
  assert.equal(await page.evaluate(() => flipStage.get('mix.mode')), 1);
  assert.equal(await page.locator('.rig-pick[data-pick="mix.mode"] .hw-lcd b').textContent(), 'SUMA');
  await page.evaluate(() => flipStage.set('mix.fade', 0));
  await drag('.rig-fader[data-param="mix.fade"] .cap', 140, 0);
  assert.ok(await page.evaluate(() => flipStage.get('mix.fade')) > .4, 'el deslizador se arrastra en horizontal');

  // 10 · Escenas: toque para llamar, mantener para guardar, transición.
  await page.locator('#rigScenes [data-scene="1"]').click();
  assert.equal((await S()).name, 'TÚNEL');
  await page.evaluate(() => { flipStage.set('mod.morph', 0); flipStage.set('col.hue', .77); });
  const [sx, sy] = await center('#rigScenes [data-scene="1"]');
  await page.mouse.move(sx, sy); await page.mouse.down(); await settle(800); await page.mouse.up(); await settle(100);
  await page.locator('#rigScenes [data-scene="0"]').click();
  near(await page.evaluate(() => flipStage.get('col.hue')), 0, .001, 'otra escena, otro valor');
  await page.locator('#rigScenes [data-scene="1"]').click();
  near(await page.evaluate(() => flipStage.get('col.hue')), .77, .001, 'la escena guardada vuelve con lo suyo');
  await page.evaluate(() => flipStage.set('mod.morph', .5));
  await page.locator('#rigScenes [data-scene="2"]').click();
  assert.equal((await S()).morphing, true, 'la transición está en marcha');
  await settle(1300);
  assert.equal((await S()).morphing, false);
  near(await page.evaluate(() => flipStage.get('geo.kal')), .55, .001, 'y llega a su destino');
  await page.evaluate(() => flipStage.set('mod.morph', 0));

  // 11 · MIDI: aprender un CC, notas a escenas y reloj.
  await page.evaluate(() => flipStage.midi.learn(true));
  await stageTab(page, 'geo');
  await page.locator('.rig-knob[data-param="geo.zoom"] .dial').click();
  assert.equal((await S()).midi.target, 'p:geo.zoom');
  await page.evaluate(() => { flipStage.midi.inject([0xb0, 21, 100]); flipStage.midi.learn(false); });
  st = await S();
  assert.equal(st.midi.map.cc['0:21'], 'p:geo.zoom', 'el CC queda asignado');
  await page.evaluate(() => { flipStage.midi.inject([0xb0, 21, 127]); flipStage.step(30); });
  near(await page.evaluate(() => flipStage.get('geo.zoom')), 1, .01, 'el CC mueve su mando');
  await page.evaluate(() => { flipStage.midi.inject([0x90, 40, 110]); flipStage.midi.inject([0x80, 40, 0]); });
  assert.equal((await S()).scene, 4, 'las notas 36–43 llaman a las escenas');
  const clock = await page.evaluate(() => { for (let i = 0; i < 25; i++) flipStage.midi.inject([0xf8], 1000 + i * (60000 / 128 / 24)); const s = flipStage.status(); return [s.bpm, s.bpmSource]; });
  near(clock[0], 128, .5, 'el reloj MIDI marca el tempo'); assert.equal(clock[1], 'MIDI');
  // Sin aprender nada: los mandos del controlador gobiernan los de la página que se ve, por orden.
  await stageTab(page, 'fb');
  await page.evaluate(() => { flipStage.midi.inject([0xb0, 71, 127]); flipStage.midi.inject([0xb0, 70, 0]); flipStage.midi.inject([0xb0, 72, 64]); flipStage.step(30); });
  const auto = await page.evaluate(() => ['fb.amt', 'fb.zoom', 'fb.rot'].map(id => +flipStage.get(id).toFixed(2)));
  assert.deepEqual(auto, [0, 1, 0.5], 'CC 70, 71 y 72 mueven las tres primeras perillas de BUCLE');
  // El CC aprendido antes (21 → ZOOM de GEOM) manda sobre la regla automática aunque caiga en un banco conocido.
  const learned = await page.evaluate(() => { const amt = flipStage.get('fb.amt'); flipStage.midi.inject([0xb0, 21, 127]); flipStage.step(30); return [flipStage.get('geo.zoom'), flipStage.get('fb.amt') === amt]; });
  near(learned[0], 1, .01, 'el CC aprendido sigue en su mando'); assert.equal(learned[1], true, 'y no toca la página visible');
  // Cambio de programa → escena; notas 60–67 → escenas; otra nota → golpe; ruedas → PAD; volumen → nivel.
  const free = await page.evaluate(() => {
    flipStage.midi.inject([0xc0, 5]); const byProgram = flipStage.status().scene;
    flipStage.midi.inject([0x90, 62, 100]); flipStage.midi.inject([0x80, 62, 0]); const byNote = flipStage.status().scene;
    flipStage.midi.inject([0x90, 84, 127]); flipStage.step(1); const hit = flipStage.mods().beat; flipStage.midi.inject([0x80, 84, 0]);
    flipStage.midi.inject([0xe0, 0, 96]); flipStage.midi.inject([0xb0, 1, 32]); flipStage.step(1); const pad = [flipStage.mods().padx, flipStage.mods().pady];
    flipStage.midi.inject([0xb0, 7, 64]); flipStage.step(30); const level = flipStage.get('out.level');
    flipStage.midi.inject([0xb0, 7, 127]); flipStage.step(30);
    return { byProgram, byNote, hit, pad, level };
  });
  assert.equal(free.byProgram, 5); assert.equal(free.byNote, 2);
  assert.ok(free.hit > .8, 'una nota suelta da un golpe: ' + free.hit);
  near(free.pad[0], .75, .01, 'la rueda de tono es el PAD X'); near(free.pad[1], 32 / 127, .01, 'la de modulación, el PAD Y');
  near(free.level, 64 / 127, .01, 'el volumen MIDI es el nivel de salida');
  // Tempo a golpes.
  await settle(1700);
  // La tecla responde a un toque de verdad; el compás lo marcan cuatro golpes dados desde la propia
  // página, cada medio segundo exacto (los toques del arnés tardan más o menos según lo cargado que
  // esté el ordenador, y eso medía la prueba, no el tempo).
  await page.locator('#rigTap').click();
  await page.evaluate(() => new Promise(done => { let n = 0; const hit = () => { document.getElementById('rigTap').click(); if (++n < 4) setTimeout(hit, 500); else done(); }; setTimeout(hit, 2200); }));
  st = await S();
  assert.equal(st.bpmSource, 'TAP'); assert.ok(st.bpm > 105 && st.bpm < 130, 'cuatro golpes cada medio segundo ≈ 120: ' + st.bpm);

  // 11b · La mano delante de la cámara es un mando: posición del índice y pinza.
  await page.evaluate(() => {
    const hand = new Float32Array(42);
    for (let i = 0; i < 21; i++) { hand[2 * i] = .5; hand[2 * i + 1] = .6; }
    hand[0] = .5; hand[1] = .9; hand[18] = .5; hand[19] = .6;          // muñeca y nudillo medio: tamaño de la mano
    hand[16] = .8; hand[17] = .25; hand[8] = .8; hand[9] = .55;        // índice y pulgar, separados
    flipPortal.use(() => [hand]);
    flipStage.route('hx', 'geo.rot', .5);
  });
  await page.waitForFunction(() => flipStage.status().hands.seen, null, { timeout: 8000 });
  await settle(700);
  const handMods = await page.evaluate(() => flipStage.mods());
  near(handMods.hx, .8, .03, 'MANO X sigue al índice'); near(handMods.hy, .75, .03, 'MANO Y sigue al índice');
  assert.ok(handMods.pinch > .5, 'PINZA abierta: ' + handMods.pinch);
  await page.evaluate(() => { flipStage.route('hx', 'geo.rot', 0); flipPortal.use(null); });

  // 12 · Foto y grabación de la salida.
  const [shot] = await Promise.all([page.waitForEvent('download'), page.locator('#rigPhoto').click()]);
  assert.match(shot.suggestedFilename(), /^flip_stage_.*\.jpg$/);
  const [clip] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    (async () => { await page.locator('#rigRec').click(); assert.equal((await S()).rec, true); assert.equal(await page.evaluate(() => flipFeel.state().recording), true, 'grabando, las teclas callan'); await settle(1800); await page.locator('#rigRec').click(); })(),
  ]);
  assert.match(clip.suggestedFilename(), /^flip_stage_.*\.(mp4|webm)$/);
  assert.ok(fs.statSync(await clip.path()).size > 20000, 'el vídeo tiene contenido');

  // 13 · La consola cabe: nada se sale a lo ancho y el transporte siempre está a la vista.
  await stageTab(page, 'fb');
  for (const [w, h] of [[395, 741], [360, 640], [880, 396]]) {
    await page.setViewportSize({ width: w, height: h });
    await settle(350);
    const layout = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
      return { vw: innerWidth, vh: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth, monitor: box('#rigScreen'), transport: box('.rig-transport'), tabs: box('#rigTabs'), jacks: box('#rigJacks') };
    });
    assert.ok(layout.overflow <= 0, `${w}×${h}: sin desbordar a lo ancho`);
    assert.ok(layout.transport[3] <= layout.vh + 1 && layout.transport[0] >= 0 && layout.transport[2] <= layout.vw + 1, `${w}×${h}: transporte a la vista ` + JSON.stringify(layout.transport));
    assert.ok(layout.monitor[2] - layout.monitor[0] > 150 && layout.monitor[3] <= layout.vh, `${w}×${h}: monitor a la vista ` + JSON.stringify(layout.monitor));
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `stage-${w}x${h}.png`) }); }
  }
  await page.setViewportSize({ width: 395, height: 741 });

  // 14 · Salir devuelve la cámara a CAM y suelta lo que STAGE abrió.
  await openModule(page, 'cam');
  st = await S();
  assert.equal(st.active, false);
  await page.waitForFunction(() => { const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.drawImage(display, 0, 0, 8, 8); const d = x.getImageData(0, 0, 8, 8).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s > 2000; }, null, { timeout: 10000 });
  assert.deepEqual(errors, []);
  return { viaPlanes: viaPlanes.r | 0, masked };
}

// La ventana de salida, en un ordenador.
async function desktop(browser) {
  const { page, errors } = await openFlip(browser, { desktop: true, sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
  await page.evaluate(() => { localStorage.removeItem('flip.stage.v3'); flipStage.reset(); });
  await openModule(page, 'stage');
  await page.waitForFunction(() => flipStage.status().hasA, null, { timeout: 15000 });
  let st = await page.evaluate(() => flipStage.status());
  assert.deepEqual(st.size, [1280, 720], 'calidad AUTO en un ordenador');
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#rigOut').click();
  const popup = await popupPromise;
  popup.on('pageerror', error => errors.push('salida: ' + error.message));
  await page.waitForFunction(() => flipStage.status().out.window, null, { timeout: 10000 });
  await popup.waitForFunction(() => {
    const canvas = document.getElementById('out');
    if (canvas.width !== 1280) return false;
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const x = c.getContext('2d'); x.drawImage(canvas, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data;
    for (let i = 4; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) > 24) return true;
    return false;
  }, null, { timeout: 10000 });
  // Las teclas de la ventana de salida llegan a la consola.
  await popup.keyboard.press('3');
  await page.waitForFunction(() => flipStage.status().scene === 2);
  if (out) { await page.waitForTimeout(600); await page.screenshot({ path: path.join(out, 'stage-escritorio.png') }); await popup.screenshot({ path: path.join(out, 'stage-salida.png') }); }
  await popup.close();
  await page.waitForFunction(() => !flipStage.status().out.window, null, { timeout: 5000 });
  assert.ok((await page.evaluate(() => flipStage.status())).fps > 20, 'la consola sigue dibujando sola');
  assert.deepEqual(errors, []);
}

async function main() {
  const browser = await launch();
  try {
    const result = await phone(browser);
    await desktop(browser);
    console.log('PASS · stage · ' + JSON.stringify(result));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
