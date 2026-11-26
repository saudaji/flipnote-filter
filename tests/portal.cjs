// PORTAL: ventanas que se abren con las manos, y portales fijados (vitral).
// Las manos se simulan con posiciones conocidas (flipPortal.use) para que el resultado sea
// reproducible; al final se carga el rastreador real para comprobar que arranca y que no se atasca.
//   FLIP_URL=http://127.0.0.1:8760 node tests/portal.cjs [carpeta-de-capturas]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch, openFlip, openModule } = require('./lib/harness.cjs');
const out = process.argv[2];

// Una mano en «L»: la esquina (bases del pulgar y del índice), la yema del índice, la del pulgar
// y, opcional, la del anular (por defecto recogida en la palma, como la del medio). Tamaño de la
// mano ≈ 0,2 del alto.
const HAND = `(corner, index, thumb, ring) => { const p = new Float32Array(42);
  for (let i = 0; i < 21; i++) { p[2 * i] = corner[0]; p[2 * i + 1] = corner[1] + 0.05; }
  p[0] = corner[0]; p[1] = corner[1] + 0.22; p[18] = corner[0]; p[19] = corner[1] + 0.02;
  p[4] = corner[0]; p[5] = corner[1]; p[10] = corner[0]; p[11] = corner[1];
  p[8] = thumb[0]; p[9] = thumb[1]; p[16] = index[0]; p[17] = index[1];
  const r = ring || [corner[0], corner[1] + 0.12]; p[32] = r[0]; p[33] = r[1];
  p[24] = corner[0]; p[25] = corner[1] + 0.12;
  return p; }`;

async function main() {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
    const settle = ms => page.waitForTimeout(ms);
    // hands(lista): cada mano es [esquina, índice, pulgar, anular?].
    const hands = spec => page.evaluate(([src, list]) => { const hand = eval(src); const made = list.map(args => hand(...args)); flipPortal.use(() => made); }, [HAND, spec]);
    const L = (x, inward, top = 0.3, bottom = 0.65, ring) => [[x, bottom], [x, top], [x + inward, bottom], ring];
    const S = () => page.evaluate(() => flipPortal.status());
    // Media de color dentro de un rectángulo del visor, en fracciones.
    const zone = rect => page.evaluate(([x, y, w, h]) => {
      const c = document.createElement('canvas'); c.width = 48; c.height = 48;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(display, x * display.width, y * display.height, w * display.width, h * display.height, 0, 0, 48, 48);
      const d = ctx.getImageData(0, 0, 48, 48).data; let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4; return { r: r / n, g: g / n, b: b / n };
    }, rect);
    const INSIDE = [0.42, 0.4, 0.16, 0.16], OUTSIDE = [0.04, 0.04, 0.12, 0.1];
    const greenness = c => c.g - (c.r + c.b) / 2;
    const FRAME = [L(0.25, 0.08), L(0.75, -0.08)];                 // yemas en (0,25 0,30) (0,75 0,30) (0,67 0,65) (0,33 0,65)

    // 1 · Entrar por el lanzador: PORTAL vive sobre CAM y dibuja acelerado.
    await openModule(page, 'portal');
    await page.evaluate(() => { _setCamFamily('DSI'); flipPortal.tune({ dwell: false }); flipPortal.form('quad'); });
    await hands([]);
    await settle(700);
    let st = await page.evaluate(() => ({ ...flipPortal.status(), tab: activeTab, module: flipShell.module(), extra: document.querySelectorAll('.portal-look').length, fast: flipPortal.fast }));
    assert.equal(st.active, true); assert.equal(st.tab, 'cam'); assert.equal(st.module, 'portal');
    assert.equal(st.extra, 3, 'ASCII y las dos de sonido se suman a la bandeja');
    assert.equal(st.gl, true, 'dibujo acelerado'); assert.equal(st.fast, true);
    // 2 · Sin manos: la cámara tal cual, a la cadencia de la pantalla.
    const plain = await zone(INSIDE);
    assert.ok(plain.r + plain.g + plain.b > 60, 'la cámara se ve: ' + JSON.stringify(plain));
    assert.equal(st.amount, 0, 'sin manos no hay ventana');
    const pace = await page.evaluate(() => new Promise(done => { const real = flipPortal.render; let n = 0; flipPortal.render = function () { n++; return real.apply(this, arguments); }; setTimeout(() => { flipPortal.render = real; done(n); }, 1000); }));
    assert.ok(pace > 45, 'PORTAL dibuja a la cadencia de la pantalla: ' + pace + ' por segundo');

    // 3 · Marco con las dos manos en L: la ventana va de yema a yema y dentro se ve el emulador.
    await hands(FRAME);
    await settle(1000);
    st = await S();
    assert.equal(st.shape, 'quad'); assert.ok(st.amount > 0.95, 'la ventana se abre: ' + st.amount);
    assert.ok(st.area > 0.13 && st.area < 0.17, 'la ventana ocupa lo que encierran las cuatro yemas: ' + st.area);
    // Las cuatro esquinas son las cuatro yemas: índice y pulgar de la mano izquierda, pulgar e índice de la derecha.
    const corners = [[0.25, 0.30], [0.75, 0.30], [0.67, 0.65], [0.33, 0.65]];
    corners.forEach(([x, y], i) => assert.ok(Math.hypot(st.figure[2 * i] - x, st.figure[2 * i + 1] - y) < 0.012, 'la esquina ' + i + ' está en su yema: ' + st.figure.slice(2 * i, 2 * i + 2)));
    const inside = await zone(INSIDE), outside = await zone(OUTSIDE);
    assert.ok(greenness(inside) > greenness(plain) + 18, 'dentro se ve DSi (verde): ' + greenness(inside).toFixed(1) + ' frente a ' + greenness(plain).toFixed(1));
    assert.ok(greenness(outside) < greenness(inside) - 18, 'fuera sigue la cámara');
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'portal-marco.png') }); }
    // Si las L se cierran (pinza en las dos manos), el marco se queda sin altura y se cierra.
    await hands([[[0.25, 0.65], [0.33, 0.64], [0.33, 0.65]], [[0.75, 0.65], [0.67, 0.64], [0.67, 0.65]]]);
    await settle(700);
    assert.ok((await S()).amount < 0.1, 'cerrar las L cierra la ventana');
    // Una mano cierra su pinza y la otra no: ese lado queda en punta y la ventana sigue abierta (un triángulo).
    await hands([[[0.25, 0.5], [0.33, 0.49], [0.33, 0.5]], L(0.75, -0.08)]);
    await settle(700);
    st = await S();
    assert.equal(st.shape, 'quad'); assert.ok(st.amount > 0.9 && st.area > 0.02, 'con una pinza cerrada queda un triángulo abierto: ' + JSON.stringify([st.amount, st.area]));
    assert.ok(Math.hypot(st.figure[0] - st.figure[6], st.figure[1] - st.figure[7]) < 0.03, 'las dos esquinas de la mano cerrada coinciden');
    // Una mano del revés (el índice por debajo del pulgar): la figura se cruza y no se cierra ni salta.
    await hands([L(0.25, 0.08), [[0.75, 0.3], [0.75, 0.65], [0.67, 0.3]]]);
    await settle(700);
    st = await S();
    assert.equal(st.shape, 'quad'); assert.ok(st.amount > 0.9 && st.area > 0.08, 'la figura cruzada sigue abierta: ' + JSON.stringify([st.amount, st.area]));
    assert.ok(Math.abs(st.figure[3] - 0.65) < 0.02 && Math.abs(st.figure[5] - 0.3) < 0.02, 'cada esquina sigue en su yema aunque la figura se cruce: ' + st.figure);
    // La imagen va unas décimas por detrás del reloj (lo que tarda el seguimiento) y la figura se coloca en ese instante.
    assert.ok(st.delay >= 55 && st.delay <= 245, 'retraso de la imagen dentro de lo previsto: ' + st.delay + ' ms');
    assert.ok(st.queue >= 4 && st.queue <= 16, 'cola de cuadros de cámara: ' + st.queue);
    await hands(FRAME);
    await settle(800);
    // Con la figura quieta solo se repinta cuando llega un cuadro de cámara (a 30; la pantalla va a 60 o más)…
    const paint = ms => page.evaluate(ms => new Promise(done => {
      const real = flipPortal.render, from = flipPortal.status().draws; let ticks = 0;
      flipPortal.render = function () { ticks++; return real.apply(this, arguments); };
      setTimeout(() => { flipPortal.render = real; done({ ticks, draws: flipPortal.status().draws - from }); }, ms);
    }), ms);
    let load = await paint(1000);
    assert.ok(load.ticks > 45 && load.draws >= 20 && load.draws < load.ticks * 0.8, 'con la figura quieta no se repinta en cada vuelta: ' + JSON.stringify(load));
    // …salvo que CAM pinte encima (una pegatina): entonces cada vuelta parte del cuadro limpio, o la
    // pegatina se pintaría sobre sí misma y la lupa ampliaría lo ya ampliado.
    await page.evaluate(() => { camStickers.push({ id: 9001, type: 'zoom', x: 0.5, y: 0.15, size: 10 }); });
    const stuck = await paint(700);
    assert.equal(stuck.draws, stuck.ticks, 'con pegatinas se repinta en cada vuelta: ' + JSON.stringify(stuck));
    await page.evaluate(() => { camStickers.length = 0; });
    await settle(200);

    // 4 · La foto es lo que hay en el visor.
    const photo = await page.evaluate(async () => {
      const blob = await cameraPhoto(); const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = 96; c.height = 96; const ctx = c.getContext('2d');
      ctx.drawImage(bmp, bmp.width * 0.42, bmp.height * 0.4, bmp.width * 0.16, bmp.height * 0.16, 0, 0, 96, 96);
      const d = ctx.getImageData(0, 0, 96, 96).data; let g = 0, rb = 0; for (let i = 0; i < d.length; i += 4) { g += d[i + 1]; rb += (d[i] + d[i + 2]) / 2; }
      return { type: blob.type, green: (g - rb) / (d.length / 4), size: [bmp.width, bmp.height] };
    });
    assert.equal(photo.type, 'image/jpeg');
    assert.ok(photo.green > greenness(plain) + 18, 'la foto lleva la ventana: ' + photo.green.toFixed(1));

    // 5 · El sello de PRINT entra con su trama, sin el marco, y no cambia el ajuste del usuario.
    await page.locator('#deckLooks [data-family="PRENSA"]').click();
    await page.evaluate(() => { camVariant = 'ENGR'; _applyCamState(); });
    await settle(700);
    const stamp = await page.evaluate(() => ({ frame: stampFrameMode, status: flipPortal.status() }));
    assert.equal(stamp.frame, 'ON', 'el marco del sello sigue como estaba');
    assert.ok(stamp.status.amount > 0.95);
    // 6 · Las diapositivas propias: ASCII y sonido.
    for (const look of ['ASCII', 'SONO', 'WMP']) {
      await page.locator('#deckLooks [data-look="' + look + '"]').click();
      await settle(500);
      st = await page.evaluate(() => ({ ...flipPortal.status(), lcd: document.getElementById('lcdLook').textContent }));
      assert.equal(st.look, look); assert.ok(st.lcd.includes(look), 'la pantallita dice ' + st.lcd);
    }
    await page.locator('#deckLooks [data-family="DSI"]').click();
    await settle(400);
    assert.equal((await S()).look, '', 'volver a una cámara quita la diapositiva propia');

    // 7 · El marco no se rompe al abrirlo mucho. Una mano se sale por su lado: sigue siendo un
    // marco y su borde llega hasta ese lado. (Antes saltaba a la ventana de una sola mano.)
    await hands([[[0.08, 0.65], [0.08, 0.3], [0.19, 0.65]], L(0.92, -0.07)]);
    await settle(900);
    const wide = await S();
    assert.equal(wide.shape, 'quad');
    await hands([L(0.92, -0.07)]);
    for (let i = 0; i < 12; i++) { await settle(150); const now = await S(); assert.equal(now.shape, 'quad', 'con una mano fuera sigue siendo un marco (muestra ' + i + ')'); assert.ok(now.amount > 0.9, 'y sigue abierto'); }
    const pinned = await S();
    assert.ok(pinned.area > wide.area * 1.05, 'el borde de la mano que salió llega hasta el lado: ' + wide.area + ' → ' + pinned.area);
    // Con una mano fuera, si la que queda se baja, el marco se cierra: no se estira tras ella.
    await hands([[[0.92, 0.97], [0.92, 0.74], [0.85, 0.97]]]);
    await settle(900);
    assert.ok((await S()).amount < 0.15, 'bajar la mano que queda cierra el marco: ' + JSON.stringify(await S()));
    await hands([]);
    await settle(600);
    // Un parpadeo del rastreador en mitad del cuadro (pierde una mano medio segundo) no cambia la forma.
    await hands(FRAME);
    await settle(800);
    await hands([FRAME[1]]);
    for (let i = 0; i < 4; i++) { await settle(130); assert.equal((await S()).shape, 'quad', 'un parpadeo no rompe el marco'); }
    await hands(FRAME);
    await settle(400);
    // Si una mano se va de verdad, el marco se cierra; la ventana de una mano nace después, nunca a medio abrir.
    await hands([[[0.42, 0.6], [0.42, 0.4], [0.58, 0.6]]]);
    let closed = false, last = await S();
    for (let i = 0; i < 42; i++) {
      await settle(100);
      const now = await S();
      if (now.amount < 0.1) closed = true;
      if (now.shape === 'corner' && now.amount > 0.3) assert.ok(closed, 'la ventana de una mano solo aparece con el marco ya cerrado');
      last = now;
    }
    // 8 · Una sola mano: la esquina que dibujan su pulgar y su índice.
    assert.equal(last.shape, 'corner'); assert.ok(last.amount > 0.9, 'una mano en L abre su esquina: ' + JSON.stringify(last));
    assert.ok(last.area > 0.025 && last.area < 0.04, 'del tamaño de la L: ' + last.area);
    if (out) await page.screenshot({ path: path.join(out, 'portal-una-mano.png') });
    await hands([]);
    await settle(700);

    // 8a · La forma de la ventana: las mismas cuatro yemas, otro contorno. El círculo no llega a las
    // esquinas del cuadro; el triángulo tiene la punta entre los dos índices y deja fuera las esquinas de arriba.
    await hands(FRAME);
    await settle(900);
    const lit = async rect => greenness(await zone(rect)) > greenness(plain) + 18;
    const CORNER = [0.262, 0.315, 0.035, 0.03], TOPMID = [0.47, 0.315, 0.06, 0.03], CENTER = [0.44, 0.44, 0.12, 0.1];
    assert.deepEqual([await lit(CORNER), await lit(TOPMID), await lit(CENTER)], [true, true, true], 'el cuadro llega a sus esquinas');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('portalForm')).display !== 'none' && document.getElementById('portalForm').dataset.form), 'quad');
    await page.locator('#portalForm').click();
    await settle(500);
    assert.equal((await S()).form, 'round');
    assert.deepEqual([await lit(CORNER), await lit(TOPMID), await lit(CENTER)], [false, true, true], 'el círculo no llega a la esquina del cuadro, pero sí al centro de su lado');
    if (out) await page.screenshot({ path: path.join(out, 'portal-circulo.png') });
    await page.locator('#portalForm').click();
    await settle(500);
    assert.equal((await S()).form, 'tri');
    assert.deepEqual([await lit(CORNER), await lit(TOPMID), await lit(CENTER)], [false, true, true], 'el triángulo tiene la punta entre los índices');
    assert.equal(await lit([0.60, 0.33, 0.05, 0.03]), false, 'y deja fuera la esquina de arriba a la derecha');
    if (out) await page.screenshot({ path: path.join(out, 'portal-triangulo.png') });
    assert.equal(await page.evaluate(() => localStorage.getItem('flip.portal.form')), 'tri', 'la forma se recuerda');
    // Quieto para fijar: con el marco parado, un anillo se llena y el portal queda fijado, con su forma.
    await hands([]);
    await settle(600);
    await page.evaluate(() => flipPortal.tune({ dwell: true }));
    await hands(FRAME);
    await page.waitForFunction(() => { const s = flipPortal.status(); return s.dwell > 0.15 && s.dwell < 0.95; }, null, { timeout: 4000, polling: 30 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('portalDwell')).display), 'block', 'el anillo se ve mientras cuenta');
    await page.waitForFunction(() => flipPortal.status().panes === 1, null, { timeout: 4000 });
    let kept = (await page.evaluate(() => flipPortal.panes.list()))[0];
    assert.equal(kept.form, 'tri', 'el portal fijado conserva la forma');
    corners.forEach(([x, y], i) => assert.ok(Math.hypot(kept.pts[2 * i] - x, kept.pts[2 * i + 1] - y) < 0.012, 'y sus yemas: ' + JSON.stringify(kept.pts)));
    // Sin mover el marco no vuelve a fijar; moverlo lo rearma. Y si el marco se mueve, no cuenta.
    await settle(2200);
    assert.equal((await S()).panes, 1, 'quieto en el mismo sitio no fija dos veces');
    await page.evaluate(([src]) => { const hand = eval(src), L = (x, inward, top, bottom) => hand([x, bottom], [x, top], [x + inward, bottom]); const began = performance.now();
      flipPortal.use(t => { const k = 0.06 * Math.sin((t - began) / 260); return [L(0.25 + k, 0.08, 0.3, 0.65), L(0.75 + k, -0.08, 0.3, 0.65)]; }); }, [HAND]);
    await settle(2600);
    st = await S();
    assert.equal(st.panes, 1, 'un marco que se mueve no se fija solo');
    assert.equal(st.shape, 'quad');
    // El portal elegido cambia de forma con el selector.
    await hands([]);
    await settle(500);
    await page.evaluate(() => { flipPortal.tune({ dwell: false }); flipPortal.panes.select(0); });
    await page.locator('#portalForm').click();
    kept = (await page.evaluate(() => flipPortal.panes.list()))[0];
    assert.equal(kept.form, 'quad', 'el selector cambia la forma del portal elegido (triángulo → cuadro)');
    await page.evaluate(() => { flipPortal.panes.clear(); flipPortal.form('quad'); });
    await settle(300);

    // 8b · El clic fija la figura de antes de mover los dedos. Con un rastreador que tarda como uno de
    // verdad (90 ms), el pulgar de la derecha se va hacia el anular (de 0,67 a 0,62) y, una décima
    // después, se tocan: el portal conserva la esquina donde estaba el pulgar antes de moverse.
    await page.evaluate(([src, frame]) => {
      const hand = eval(src), made = spec => spec.map(args => hand(...args));
      const still = made(frame);
      const moved = made([frame[0], [[0.75, 0.65], [0.75, 0.3], [0.62, 0.65]]]);
      const touching = made([frame[0], [[0.75, 0.65], [0.75, 0.3], [0.62, 0.65], [0.62, 0.65]]]);
      const t0 = performance.now() + 800;
      flipPortal.use(t => t < t0 ? still : t < t0 + 100 ? moved : touching, { lag: 90 });
    }, [HAND, FRAME]);
    await page.waitForFunction(() => flipPortal.status().panes === 1, null, { timeout: 6000 });
    const fixed = (await page.evaluate(() => flipPortal.panes.list()))[0].pts;      // índice izq., índice der., pulgar der., pulgar izq.
    assert.ok(Math.abs(fixed[4] - 0.67) < 0.012 && Math.abs(fixed[5] - 0.65) < 0.012, 'la esquina del pulgar es la de antes de moverse (0,67), no la del clic (0,62): ' + JSON.stringify(fixed));
    [[0.25, 0.30], [0.75, 0.30], [0.67, 0.65], [0.33, 0.65]].forEach(([x, y], i) => assert.ok(Math.hypot(fixed[2 * i] - x, fixed[2 * i + 1] - y) < 0.012, 'el portal fijado tiene la esquina ' + i + ' en su yema: ' + JSON.stringify(fixed)));
    st = await S();
    assert.ok(st.latency >= 70 && st.latency <= 110 && st.delay >= 90 && st.delay <= 160, 'el visor se retrasa lo que tarda el rastreador: ' + JSON.stringify([st.latency, st.delay]));
    await page.evaluate(() => flipPortal.panes.clear());

    // 8c · Sin la cola de cuadros (el contexto de WebGL perdido, como al volver de segundo plano) y con
    // un rastreador lento (200 ms), la ventana no parpadea: se dibuja con la última detección.
    await page.evaluate(([src, frame]) => { const hand = eval(src), still = frame.map(args => hand(...args)); flipPortal.use(() => still, { lag: 200 }); }, [HAND, FRAME]);
    await settle(1200);
    assert.equal((await S()).shape, 'quad');
    assert.equal(await page.evaluate(() => flipPortal.lose(true)), true, 'se puede simular la pérdida del contexto');
    await page.waitForFunction(() => flipPortal.status().gl === false, null, { timeout: 4000 });
    await settle(700);
    for (let i = 0; i < 12; i++) {
      await settle(80);
      const now = await S();
      assert.ok(now.gl === false && now.hands === 2 && now.shape === 'quad' && now.amount > 0.9, 'sin WebGL la ventana sigue a las manos sin parpadear (muestra ' + i + '): ' + JSON.stringify([now.gl, now.hands, now.shape, now.amount]));
      corners.forEach(([x, y], k) => assert.ok(Math.hypot(now.figure[2 * k] - x, now.figure[2 * k + 1] - y) < 0.012, 'y cada esquina sigue en su yema: ' + now.figure));
    }
    assert.ok(greenness(await zone(INSIDE)) > greenness(plain) + 18, 'y dentro se sigue viendo el emulador');
    // Al volver el contexto, PORTAL recupera el dibujo acelerado y rehace la cola.
    await page.evaluate(() => flipPortal.lose(false));
    await page.waitForFunction(() => { const s = flipPortal.status(); return s.gl === true && s.queue >= 4; }, null, { timeout: 8000 });
    await settle(600);
    st = await S();
    assert.ok(st.shape === 'quad' && st.amount > 0.9, 'con el contexto de vuelta la ventana sigue abierta: ' + JSON.stringify([st.shape, st.amount]));
    assert.ok(greenness(await zone(INSIDE)) > greenness(plain) + 18, 'y el emulador vuelve a verse dentro');
    await hands([]);
    await settle(700);

    // 9 · Fijar con el clic: el anular toca el pulgar con el índice abierto.
    await hands(FRAME);
    await settle(900);
    await hands([FRAME[0], L(0.75, -0.08, 0.3, 0.65, [0.67, 0.65])]);
    await page.waitForFunction(() => flipPortal.status().panes === 1, null, { timeout: 4000 });
    st = await S();
    assert.equal(st.waiting, true, 'mientras dura el clic, la ventana viva espera');
    let list = await page.evaluate(() => flipPortal.panes.list());
    const xs = [0, 2, 4, 6].map(i => list[0].pts[i]), ys = [1, 3, 5, 7].map(i => list[0].pts[i]);
    assert.ok(Math.abs(Math.min(...xs) - 0.25) < 0.03 && Math.abs(Math.max(...xs) - 0.75) < 0.03 && Math.abs(Math.min(...ys) - 0.3) < 0.03 && Math.abs(Math.max(...ys) - 0.65) < 0.03, 'el portal queda donde estaba la figura (de yema a yema): ' + JSON.stringify(list[0].pts));
    assert.equal(list[0].style, 'DSI:STD');
    // Suelta el clic y se lleva las manos: el portal se queda.
    await hands([]);
    await settle(1300);
    st = await S();
    assert.equal(st.waiting, false); assert.equal(st.panes, 1); assert.ok(st.amount < 0.02, 'sin manos no queda ventana viva: ' + st.amount);
    assert.ok(greenness(await zone(INSIDE)) > greenness(plain) + 18, 'el portal fijado sigue vivo sin manos');
    // Otro estilo y otro portal, más pequeño y en otro sitio: un vitral.
    await page.locator('#deckLooks [data-family="DLPHN"]').click();
    const SMALL = [[[0.08, 0.95], [0.08, 0.75], [0.12, 0.95]], [[0.3, 0.95], [0.3, 0.75], [0.26, 0.95]]];
    await hands(SMALL);
    await settle(900);
    assert.equal((await S()).shape, 'quad');
    await page.locator('#portalLock').click();
    await settle(400);
    st = await S();
    assert.deepEqual(st.styles, ['DSI:STD', 'DLPHN:STD'], 'cada portal conserva su estilo');
    await hands([]);
    await settle(900);
    const first = await zone(INSIDE), second = await zone([0.14, 0.78, 0.1, 0.14]);
    assert.ok(greenness(first) > greenness(plain) + 18, 'el primero sigue en DSi');
    assert.ok(second.b - second.r > first.b - first.r + 25, 'el segundo va en DLPHN (azul): ' + JSON.stringify([first, second]));
    assert.equal(await page.locator('#portalCount b').textContent(), '2');
    if (out) await page.screenshot({ path: path.join(out, 'portal-vitral.png') });
    const collage = await page.evaluate(async () => { const bmp = await createImageBitmap(await cameraPhoto()); return [bmp.width, bmp.height]; });
    assert.deepEqual(collage, photo.size, 'la foto del vitral sale igual que cualquier otra');

    // 10 · Elegir un portal con el dedo, moverlo y cambiarle el estilo.
    const box = await page.evaluate(() => { const r = display.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    const point = (x, y) => [box[0] + x * box[2], box[1] + y * box[3]];
    let [mx, my] = point(0.5, 0.48);
    await page.mouse.click(mx, my);
    await settle(300);
    st = await S();
    assert.equal(st.selected, 0, 'un toque dentro lo elige');
    assert.equal(await page.evaluate(() => camFamily), 'DSI', 'y su estilo pasa a ser el elegido');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('portalDrop')).display), 'grid', 'aparece su aspa');
    const before = (await page.evaluate(() => flipPortal.panes.list()))[0].pts;
    await page.mouse.move(mx, my); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(mx + box[2] * 0.2 * i / 6, my - box[3] * 0.15 * i / 6);
    await page.mouse.up(); await settle(200);
    const after = (await page.evaluate(() => flipPortal.panes.list()))[0].pts;
    assert.ok(Math.abs(after[0] - before[0] - 0.2) < 0.02 && Math.abs(after[1] - before[1] + 0.15) < 0.02, 'arrastrarlo lo mueve sin cambiar su figura: ' + JSON.stringify([before.slice(0, 2), after.slice(0, 2)]));
    assert.ok(Math.abs((after[2] - after[0]) - (before[2] - before[0])) < 0.001, 'conserva su tamaño');
    await page.locator('#deckLooks [data-family="VFD"]').click();
    await settle(400);
    assert.deepEqual((await S()).styles, ['VFD:STD', 'DLPHN:STD'], 'tocar otra cámara cambia el estilo del portal elegido');
    [mx, my] = point(0.9, 0.08);
    await page.mouse.click(mx, my);
    await settle(200);
    assert.equal((await S()).selected, -1, 'tocar fuera lo suelta');

    // 11 · Borrar: el aspa del elegido, la tecla (el último) y mantenerla (todos).
    [mx, my] = point(0.19, 0.85);
    await page.mouse.click(mx, my);
    await settle(250);
    assert.equal((await S()).selected, 1);
    await page.locator('#portalDrop').click();
    assert.deepEqual((await S()).styles, ['VFD:STD'], 'el aspa borra ese portal');
    await hands(FRAME); await settle(700);
    await page.locator('#portalLock').click(); await settle(300);
    await hands([]); await settle(500);
    assert.equal((await S()).panes, 2);
    await page.locator('#portalErase').click();
    assert.equal((await S()).panes, 1, 'BORRAR quita el último');
    const [ex, ey] = await page.evaluate(() => { const r = document.getElementById('portalErase').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.mouse.move(ex, ey); await page.mouse.down(); await settle(850); await page.mouse.up(); await settle(200);
    st = await S();
    assert.equal(st.panes, 0, 'mantener BORRAR los quita todos');
    assert.equal(await page.locator('#portalCount b').textContent(), '0');

    // 12 · Salir devuelve CAM a su estado.
    await openModule(page, 'cam');
    st = await page.evaluate(() => ({ active: flipPortal.active, module: flipShell.module(), mode: document.body.classList.contains('portal-mode'), bar: getComputedStyle(document.getElementById('portalBar')).display }));
    assert.deepEqual([st.active, st.module, st.mode, st.bar], [false, 'cam', false, 'none']);

    // 12b · Al salir se sueltan los estilos pintados para las ventanas.
    assert.equal(await page.evaluate(() => flipPortal.status().kept), 0, 'fuera de PORTAL no queda ningún estilo guardado');

    // 13 · El rastreador real arranca (necesita red la primera vez)… también si se sale de PORTAL
    // mientras carga y se vuelve antes de que termine (se quedaba sin rastreador y sin aviso).
    await openModule(page, 'portal');
    await page.evaluate(() => {
      flipPortal.use(null); flipPortal.start();
      const go = key => { document.getElementById('shellModule').click(); document.querySelector('#shellLauncher [data-module="' + key + '"]').click(); };
      go('cam'); go('portal');
    });
    assert.equal(await page.evaluate(() => flipPortal.active), true, 'de vuelta en PORTAL');
    const real = await page.waitForFunction(() => { const s = flipPortal.status(); return s.phase === 'ready' || s.phase === 'failed' ? s : null; }, null, { timeout: 60000 }).then(h => h.jsonValue());
    if (real.phase !== 'ready') console.log('aviso: el rastreador real no cargó (' + real.error + ')');
    else {
      const base = (await S()).frames;
      await page.waitForFunction(n => flipPortal.status().frames > n + 3, base, { timeout: 20000 });
      st = await S();
      console.log('rastreador real · ' + st.ms.toFixed(0) + ' ms por cuadro · delegado ' + st.delegate);
      // Sin manos delante el rastreador descansa: mira de vez en cuando, no en cada cuadro.
      // (La escena de la habitación lleva una mano dibujada; se cambia por una pared lisa.)
      await page.evaluate(() => { window.__sceneBefore = window.__flipSceneCamera.scene; window.__flipSceneCamera.scene = 'flat'; window.__flipSceneCamera.options = { value: 120 }; });
      await settle(2600);
      const idle0 = await S();
      await settle(3000);
      const idle1 = await S();
      const rate = (idle1.frames - idle0.frames) / 3;
      assert.ok(rate > 2 && rate < 9, 'sin manos el rastreador descansa pero sigue mirando: ' + rate.toFixed(1) + ' detecciones por segundo');
      console.log('rastreador en reposo · ' + rate.toFixed(1) + ' detecciones por segundo');
      await page.evaluate(() => { window.__flipSceneCamera.scene = window.__sceneBefore; window.__flipSceneCamera.options = null; });
      // 14 · …y, tras salir con un cuadro en vuelo y volver, sigue recibiendo cuadros.
      // (En un teléfono se quedaba «ocupado» para siempre y PORTAL dejaba de ver las manos.)
      for (let round = 0; round < 3; round++) {
        await page.waitForFunction(() => flipPortal.status().busy, null, { timeout: 8000 });
        await openModule(page, 'cam');
        await openModule(page, 'portal');
        await page.waitForFunction(() => flipPortal.status().phase === 'ready', null, { timeout: 60000 });
        const seen = (await S()).frames;
        await page.waitForFunction(n => flipPortal.status().frames > n + 2, seen, { timeout: 15000 });
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS · portal · ' + JSON.stringify({ dentro: +greenness(inside).toFixed(1), fuera: +greenness(outside).toFixed(1), foto: photo.size.join('x'), cadencia: pace, rastreador: real.phase }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
