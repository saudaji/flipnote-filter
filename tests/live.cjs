// STAGE · LIVE: el enlace con Ableton por la señal de PITÁGORAS. Lo que tiene que seguir siendo verdad:
//   · con la señal llegando, cada toma de pista lleva el nombre de su pista de Live y sigue su nivel;
//     un cable desde esa toma mueve el mando que se elija;
//   · BAJO / MEDIO / AGUDO / GOLPE salen del master de Live (sin micrófono), y el tempo y el compás
//     son los de Live (reloj «LIVE»), con el mismo número de pulso que el transporte;
//   · las tomas recuerdan el NOMBRE: si en Live cambian el orden de las pistas, el cable sigue al
//     instrumento; se puede elegir a mano qué pista va en cada toma;
//   · si la señal se corta, las tomas caen a cero y el reloj vuelve al de la casa;
//   · por red de verdad (un flujo de eventos de otro origen): conecta con el enlace de VISUALES,
//     rechaza el enlace de la app y dice cuando la llave no vale;
//   · si PITÁGORAS está encendido en modo demostración (puerto 8441), conecta con él de punta a punta.
//   FLIP_URL=http://127.0.0.1:8760 node tests/live.cjs
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { launch, openFlip, openModule } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ': ' + a + ' ≠ ' + b + ' ± ' + tol);
const TRACKS = [['track:0', '1-Kick'], ['track:1', 'Bajo'], ['track:2', 'Voz'], ['track:3', 'Hats'], ['track:4', 'Keys'], ['track:5', 'Gtr'], ['track:6', 'FX'], ['track:7', 'Pads']];
const info = order => ({ tracks: order.map(i => ({ key: 'track:' + order.indexOf(i), kind: 'track', index: order.indexOf(i), name: TRACKS[i][1] })), signature: '4/4', tempo: 128, demo: false });

// Una señal como la de PITÁGORAS, para la prueba de red: mismo formato, otro origen.
function feedServer() {
  const state = { hits: 0, clients: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (url.pathname !== '/api/feed/stream') { res.writeHead(404, cors); return res.end(); }
    if (url.searchParams.get('t') !== 'llave-buena') { res.writeHead(401, { ...cors, 'content-type': 'application/json' }); return res.end('{"error":"token"}'); }
    res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(': conectado\n\nevent: set\ndata: ' + JSON.stringify(info([0, 1, 2])) + '\n\n');
    state.clients++;
    const began = Date.now();
    const timer = setInterval(() => {
      const pos = (Date.now() - began) / 1000 * 128 / 60, kick = Math.max(0, 1 - (pos % 1) * 5);
      if (Math.floor(pos) + 1 > state.hits) state.hits = Math.floor(pos) + 1;
      res.write('data: ' + JSON.stringify({ t: Date.now() / 1000, play: true, pos: +pos.toFixed(3), bpm: 128, m: [.85, kick, .4, .3], hits: state.hits, hit: 1, ears: true, tr: { 'track:0': [kick, kick, 0, 0], 'track:1': [.7, .7, .2, 0], 'track:2': [.2, 0, .2, .1] } }) + '\n\n');
    }, 33);
    req.on('close', () => { clearInterval(timer); state.clients--; });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}

(async () => {
  const browser = await launch();
  const feed = await feedServer();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await openModule(page, 'stage');
    await page.waitForFunction(() => window.flipStage && flipStage.active && flipStage.status().ok, null, { timeout: 15000 });
    await page.evaluate(() => { localStorage.removeItem('flip.stage.v3'); flipStage.reset(); });
    const frame = (extra = {}) => ({ t: Date.now() / 1000, play: true, pos: 8, bpm: 128, m: [.8, .9, .4, .3], hits: 0, hit: 1, ears: true, tr: { 'track:0': [.95, .9, 0, 0], 'track:1': [.5, .5, 0, 0], 'track:2': [.1, 0, .1, 0] }, ...extra });

    // ── Apagado: las tomas de pista no estorban ──
    const idle = await page.evaluate(() => ({ live: flipStage.status().live, jacks: [...document.querySelectorAll('.rig-jack[data-live]')].filter(j => getComputedStyle(j).display !== 'none').length, bar: document.getElementById('rigLiveText').textContent, alto: Math.round(document.getElementById('rigLive').getBoundingClientRect().height), fuente: flipStage.status().bpmSource }));
    assert.equal(idle.live.state, 'off');
    assert.equal(idle.jacks, 0, 'sin enlace no se ven las tomas de pista');
    assert.match(idle.bar, /CONECTAR CON ABLETON/);
    assert.notEqual(idle.fuente, 'LIVE');

    // ── Llega la señal: nombres, niveles, cable ──
    await page.evaluate(([set, f]) => { for (const r of flipStage.status().routes) flipStage.route(r[0], r[1], 0); flipStage.live.inject({ set }); flipStage.live.inject(f); flipStage.route('lv1', 'sig.rgb', .5); flipStage.set('sig.rgb', .2); }, [info([0, 1, 2, 3, 4, 5, 6, 7]), frame()]);
    await page.evaluate(f => { flipStage.live.inject(f); flipStage.step(20, 16); }, frame());
    const on = await page.evaluate(() => ({ s: flipStage.status(), mods: flipStage.mods(), rgb: flipStage.value('sig.rgb'), jacks: [...document.querySelectorAll('.rig-jack[data-live]')].filter(j => getComputedStyle(j).display !== 'none').map(j => j.querySelector('.hw-print').textContent), bar: document.getElementById('rigLiveText').textContent,
      // la barra y la fila de pistas quedan a la vista sin desplazar (van antes que las demás tomas)
      dentro: [...document.querySelectorAll('.rig-jack[data-live], #rigLive')].every(n => { const r = n.getBoundingClientRect(), deck = document.querySelector('.rig-transport').getBoundingClientRect(); return r.width > 20 && r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= deck.top + 1; }),
      rotulo: getComputedStyle(document.querySelector('.rig-jack[data-live] .hw-print')).color, fondo: getComputedStyle(document.getElementById('camBody')).backgroundColor }));
    assert.equal(on.s.live.state, 'on');
    assert.deepEqual(on.s.live.names, ['KICK', 'BAJO', 'VOZ', 'HATS', 'KEYS', 'GTR'], 'cada toma toma el nombre de su pista');
    assert.deepEqual(on.jacks, ['KICK', 'BAJO', 'VOZ', 'HATS', 'KEYS', 'GTR']);
    assert.ok(on.dentro, 'la barra LIVE y la fila de pistas se ven sin desplazar');
    // los rótulos se leen: tinta oscura sobre fondo claro (STAGE pone sus mandos sobre el fondo)
    const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).map(Number); return (.2126 * r + .7152 * g + .0722 * b) / 255; };
    assert.ok(Math.abs(lum(on.rotulo) - lum(on.fondo)) > .45, 'rótulos legibles sobre el fondo de STAGE: ' + on.rotulo + ' / ' + on.fondo);
    assert.ok(on.mods.lv1 > .9, 'la toma del bombo sigue su nivel: ' + on.mods.lv1);
    assert.ok(on.mods.lv2 > .9, 'la del bajo, que suena más bajito, usa también todo su recorrido: ' + on.mods.lv2);
    assert.ok(on.mods.lv3 < .15 && on.mods.lv4 === 0, 'el soplo de una pista casi vacía no cuenta, y una callada vale cero: ' + on.mods.lv3);
    near(on.rgb, .2 + .5 * on.mods.lv1, .03, 'el cable desde la toma mueve el mando');
    assert.match(on.bar, /LIVE · 128 BPM · 8 PISTAS/);
    step('las tomas llevan el nombre y el nivel de cada pista de Live', { tomas: on.jacks.join(' '), bombo: +on.mods.lv1.toFixed(2), bajo: +on.mods.lv2.toFixed(2) });

    // ── El master y el reloj son los de Live ──
    assert.equal(on.s.live.master, true);
    assert.ok(on.mods.bass > .5, 'BAJO sale del master de Live, sin micrófono: ' + on.mods.bass);
    assert.equal(on.s.audio.on, false);
    assert.equal(on.s.bpmSource, 'LIVE');
    assert.equal(on.s.bpm, 128);
    assert.ok(on.s.beat >= 7.95 && on.s.beat < 8.9, 'el compás es el del transporte de Live (pulso 8 y lo que haya pasado desde el cuadro): ' + on.s.beat);
    await page.evaluate(f => { flipStage.live.inject(f); flipStage.step(1, 16); }, frame({ hits: 1, pos: 9 }));
    const hit = await page.evaluate(() => flipStage.mods().beat);
    assert.ok(hit > .7, 'un golpe de Live enciende GOLPE: ' + hit);
    await page.evaluate(f => { flipStage.live.inject(f); flipStage.step(30, 16); }, frame({ hits: 1, pos: 9.5 }));
    assert.ok(await page.evaluate(() => flipStage.mods().beat) < .2, 'y se apaga solo');
    step('BAJO/MEDIO/AGUDO/GOLPE y el compás salen de Live', { reloj: on.s.bpmSource, bpm: on.s.bpm });

    // ── El cable sigue al instrumento, no a la posición ──
    await page.evaluate(([set, f]) => { flipStage.live.inject({ set }); flipStage.live.inject(f); flipStage.step(20, 16); }, [info([2, 1, 0, 3, 4, 5, 6, 7]), frame({ tr: { 'track:0': [.1, 0, 0, 0], 'track:1': [.5, .5, 0, 0], 'track:2': [.95, .9, 0, 0] } })]);
    const moved = await page.evaluate(() => ({ live: flipStage.status().live, lv1: flipStage.mods().lv1 }));
    assert.equal(moved.live.names[0], 'KICK');
    assert.equal(moved.live.keys[0], 'track:2', 'la toma 1 sigue al bombo, ahora en otra posición');
    assert.ok(moved.lv1 > .9);
    await page.evaluate(() => flipStage.live.assign(0, 'Pads'));
    const picked = await page.evaluate(() => flipStage.status().live);
    assert.equal(picked.names[0], 'PADS');
    assert.ok(!picked.names.slice(1).includes('PADS'), 'una pista vive en una sola toma');
    step('las tomas recuerdan el nombre de su pista; se pueden elegir a mano', { toma1: picked.names[0] });

    // ── Se corta la señal ──
    await page.waitForTimeout(1400);
    await page.evaluate(() => flipStage.step(40, 16));
    const cut = await page.evaluate(() => ({ s: flipStage.status(), mods: flipStage.mods() }));
    assert.equal(cut.s.live.fresh, false);
    assert.ok(cut.mods.lv1 < .02 && cut.mods.lv2 < .02, 'sin señal las tomas caen a cero');
    assert.notEqual(cut.s.bpmSource, 'LIVE', 'y el reloj vuelve al de la casa');
    step('sin señal: tomas a cero y reloj propio');

    // ── Por red de verdad ──
    await page.evaluate(() => flipStage.live.disconnect());
    const base = 'http://127.0.0.1:' + feed.port;
    assert.equal(await page.evaluate(url => flipStage.live.connect(url, true), base + '/?t=llave-buena'), false, 'el enlace de la app no vale: abre todo el estudio');
    assert.equal(await page.evaluate(() => flipStage.status().live.state), 'off');
    await page.locator('#rigLive').click();
    await page.locator('#rigLiveUrl').fill(base + '/api/feed/stream?t=llave-buena');
    await page.locator('#rigLiveGo').click();
    await page.waitForFunction(() => { const l = flipStage.status().live; return l.state === 'on' && l.tracks.length === 3; }, null, { timeout: 8000 });
    await page.waitForTimeout(1600);
    const net = await page.evaluate(() => ({ s: flipStage.status(), mods: flipStage.mods(), campo: getComputedStyle(document.getElementById('rigLiveUrl')).display, tomas: [...document.querySelectorAll('#rigLiveSlots select')].map(sel => sel.value), guardado: JSON.parse(localStorage.getItem('flip.stage.v3') || '{}').global.live }));
    assert.equal(net.s.bpmSource, 'LIVE');
    assert.deepEqual(net.s.live.tracks, ['1-Kick', 'Bajo', 'Voz']);
    assert.equal(net.s.live.names[0], 'KICK', 'la toma no enseña el número que Live le pone a la pista');
    assert.ok(net.mods.lv2 > .3, 'el nivel llega por la red: ' + JSON.stringify(net.mods));
    assert.ok(net.s.audio.beats >= 2, 'los golpes de Live se cuentan: ' + net.s.audio.beats);
    assert.equal(net.campo, 'none', 'conectado, la hoja ya no enseña el campo del enlace');
    assert.ok(net.tomas.includes('1-Kick') && net.tomas.includes('Bajo'), 'la hoja deja elegir pista por toma: ' + net.tomas.join(','));
    assert.ok(/\/api\/feed\/stream\?t=/.test(net.guardado.url), 'el enlace se recuerda');
    const before = await page.evaluate(() => flipStage.status().beat);
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => flipStage.status().beat);
    near(after - before, 128 / 60, .2, 'el compás avanza al tempo de Live');
    await page.locator('#rigLiveSlots select[data-slot="0"]').selectOption('Voz');
    assert.equal(await page.evaluate(() => flipStage.status().live.names[0]), 'VOZ');
    await page.locator('#rigLiveClose').click();
    await page.evaluate(url => flipStage.live.connect(url, true), base + '/api/feed/stream?t=llave-mala');
    await page.waitForFunction(() => flipStage.status().live.state === 'error', null, { timeout: 8000 });
    assert.match(await page.evaluate(() => document.getElementById('rigLiveText').textContent), /NO CONTESTA/);
    step('por red: conecta con el enlace de VISUALES, rechaza el de la app y avisa si la llave no vale', { pistas: net.s.live.tracks.join(' ') });

    // ── Con PITÁGORAS de verdad (modo demostración), si está encendido ──
    const demo = await new Promise(resolve => { const req = http.get('http://127.0.0.1:8441/api/feed/stream?t=demo-senal', res => { resolve(res.statusCode === 200); req.destroy(); }); req.on('error', () => resolve(false)); req.setTimeout(1500, () => { req.destroy(); resolve(false); }); });
    if (demo) {
      await page.evaluate(() => { flipStage.live.disconnect(); localStorage.removeItem('flip.stage.v3'); flipStage.reset(); return flipStage.live.connect('http://127.0.0.1:8441/api/feed/stream?t=demo-senal', true); });
      await page.waitForFunction(() => { const l = flipStage.status().live; return l.state === 'on' && l.tracks.length >= 6; }, null, { timeout: 8000 });
      const real = await page.evaluate(() => flipStage.status().live);
      assert.ok(real.tracks.includes('KICK') && real.demo === true, 'el set de demostración de PITÁGORAS: ' + real.tracks.join(' '));
      step('de punta a punta con PITÁGORAS en demostración', { pistas: real.tracks.length, tomas: real.names.join(' ') });
    } else console.log('· PITÁGORAS (demostración, puerto 8441) no está encendido: esa parte no se probó');
    await page.evaluate(() => flipStage.live.disconnect());
    assert.deepEqual(errors, [], 'sin errores');
    console.log('LIVE PASS');
  } finally { await browser.close(); feed.server.closeAllConnections && feed.server.closeAllConnections(); feed.server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
