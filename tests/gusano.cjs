// La cámara GUSANO (cintas de puntos RGB estampadas a lo largo de una curva). Pasada por el motor en
// un lienzo propio, se comprueba con números:
//   · sin cámara útil (fuente negra), la escena sola, tras unos segundos simulados, deja negro entre
//     el 30 y el 42 % del cuadro (como la referencia, 36 %), en cintas (muchas transiciones
//     negro↔color en filas y en columnas);
//   · las filas de puntos NO son paralelas en todo el cuadro: el ángulo de las costillas que se ven
//     varía 60° o más a lo ancho de la imagen (hay curvas que se abren en abanico);
//   · el punto mide ~1/80 del lado corto;
//   · los canales son casi binarios y sin gris fangoso; el menta (los remates en escalera) ocupa
//     del 3 al 6 % del cuadro;
//   · los bordes van en escalón (sin suavizado: ninguna transición blanda entre celdas);
//   · determinista con la misma secuencia de relojes; sigue cambiando en el tiempo; avanza con el
//     reloj y no con el número de llamadas;
//   · FIGURA 1 con una figura dibujada que se desplaza deja rastro con su forma; con FIGURA 0 la
//     cámara no cuenta;
//   · la rejilla es la misma en el visor y en una foto al doble (el punto mide lo mismo, en
//     proporción); la foto con el visor vivo sale del lienzo del visor;
//   · sonido, costo por cuadro, soltar y rehacer; y, si la app ya la tiene registrada, la cámara en
//     el visor y su foto.
//   FLIP_URL=http://127.0.0.1:8760 node tests/gusano.cjs [--shots carpeta]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip, pickCamera, saveDataUrl } = require('./lib/harness.cjs');

const at = process.argv.indexOf('--shots');
const shots = at >= 0 ? path.resolve(process.argv[at + 1]) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

const KIT = () => {
  const black = document.createElement('canvas'); black.width = 64; black.height = 64;
  black.getContext('2d').fillRect(0, 0, 64, 64);
  // Una figura clara (cabeza y cuerpo) sobre negro, en x de 0 a 1.
  function figure(g, w, h, x) {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    const cx = w * x, cy = h * 0.6, s = Math.min(w, h);
    g.beginPath(); g.arc(cx, cy - s * 0.2, s * 0.09, 0, 7); g.fill();
    g.beginPath(); g.ellipse(cx, cy + s * 0.11, s * 0.15, s * 0.25, 0, 0, 7); g.fill();
  }
  // Corre el motor: frames cuadros cada 33,3 ms desde start; opts puede ser función del cuadro.
  function run(W, H, { frames = 120, start = 20000, opts = {}, src = black, each = null, release = true } = {}) {
    if (release) flipGusano.release();
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    let stamps = 0;
    for (let i = 0; i < frames; i++) {
      if (each) each(i);
      renderGusano(src, src.width, src.height, ctx, false, 'STD', { now: start + i * 33.333, ...(typeof opts === 'function' ? opts(i) : opts) });
      if (i >= frames / 2) stamps += flipGusano.state().stamps;
    }
    out.stamps = stamps;
    return out;
  }
  const px = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const isColor = (d, i) => Math.max(d[i], d[i + 1], d[i + 2]) > 50;
  function measure(c) {
    const d = px(c), W = c.width, H = c.height, n = W * H;
    const PAL = Object.values(flipGusano.COLOR).map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)));
    let onPal = 0, color = 0, binary = 0, gray = 0, mint = 0, th = 0, tv = 0, diffPairs = 0, soft = 0, runs = 0, runLen = 0;
    for (let y = 0; y < H; y++) {
      let run = 0;
      for (let x = 0; x < W; x++) {
        const i = 4 * (y * W + x), c0 = isColor(d, i);
        if (c0) {
          color++; run++;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          // (casi binario: cada canal, apagado o encendido; el menta lleva su azul a media luz, 151)
          if ([r, g, b].every(v => v < 60 || v > 140)) binary++;
          if (PAL.some(p => Math.abs(p[0] - r) + Math.abs(p[1] - g) + Math.abs(p[2] - b) < 24)) onPal++;
          if (Math.min(r, g, b) > 60 && Math.max(r, g, b) - Math.min(r, g, b) < 30) gray++;
          if (g > 150 && r < 120 && g - r > 80 && b > 80 && b < 200) mint++;
        } else if (run) { runs++; runLen += run; run = 0; }
        if (x > 0) {
          const j = i - 4;
          if (c0 !== isColor(d, j)) th++;
          const dm = Math.max(Math.abs(d[i] - d[j]), Math.abs(d[i + 1] - d[j + 1]), Math.abs(d[i + 2] - d[j + 2]));
          if (dm > 0) { diffPairs++; if (dm <= 40) soft++; }
        }
        if (y > 0 && c0 !== isColor(d, i - 4 * W)) tv++;
      }
      if (run) { runs++; runLen += run; }
    }
    const r3 = v => +v.toFixed(3);
    return { cubre: r3(color / n), binario: r3(binary / Math.max(1, color)), paleta: r3(onPal / Math.max(1, color)), gris: r3(gray / n), menta: r3(mint / n), transH: r3(th / n), transV: r3(tv / n), tramoMedio: +(runLen / Math.max(1, runs)).toFixed(1), blandas: r3(soft / Math.max(1, diffPairs)) };
  }
  // Fracción de píxeles distintos entre dos lienzos.
  function differ(a, b) { const p = px(a), q = px(b); let n = 0; for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) n++; return n / (p.length / 4); }
  // Columnas con color (fracción del ancho) dentro de una franja de filas.
  function colorCols(c, y0, y1) { const d = px(c), W = c.width; let k = 0; for (let x = 0; x < W; x++) { let any = false; for (let y = y0; y < y1 && !any; y++) if (isColor(d, 4 * (y * W + x))) any = true; if (any) k++; } return k / W; }
  // El arco más corto (en grados, de 0 a 180, circular) que contiene el 90 % de los ángulos.
  function arc(angles) {
    if (angles.length < 20) return 0;
    const a = angles.slice().sort((p, q) => p - q), n = a.length, keep = Math.ceil(n * 0.9);
    let best = 180;
    for (let i = 0; i < n; i++) { const j = i + keep - 1, end = j < n ? a[j] : a[j - n] + 180; best = Math.min(best, end - a[i]); }
    return +best.toFixed(1);
  }
  // Cuánto se separan unos ángulos (de 0 a 180, circular): 180 menos el mayor hueco entre ellos.
  function spread(angles) {
    if (angles.length < 2) return 0;
    const a = angles.slice().sort((p, q) => p - q);
    let gap = a[0] + 180 - a[a.length - 1];
    for (let i = 1; i < a.length; i++) gap = Math.max(gap, a[i] - a[i - 1]);
    return +(180 - gap).toFixed(1);
  }
  window.GK = { black, figure, run, px, measure, differ, colorCols, arc, spread };
};

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { boot: false, desktop: true });
    await page.waitForFunction(() => document.readyState === 'complete');
    if (await page.evaluate(() => typeof window.renderGusano) !== 'function') await page.addScriptTag({ path: path.join(__dirname, '..', 'docs', 'gusano.js') });
    await page.evaluate(KIT);
    assert.ok(await page.evaluate(() => typeof renderGusano === 'function' && !!window.flipGusano), 'el motor expone renderGusano y flipGusano');

    // ── 1 · La escena sola: cubre una parte del cuadro, en cintas ──
    const sola = await page.evaluate(() => {
      const out = {};
      for (const [W, H] of [[540, 960], [1024, 576]]) {
        const c = GK.run(W, H, { frames: 120 }), m = GK.measure(c), st = flipGusano.state();
        // el ángulo de la costilla que pintó cada punto que se ve (la misma escena, pintada en gris)
        const dbg = document.createElement('canvas'); dbg.width = W; dbg.height = H;
        renderGusano(GK.black, 64, 64, dbg.getContext('2d'), false, 'STD', { now: 20000 + 119 * 33.333, debug: 'angulo' });
        const d = GK.px(c), a = GK.px(dbg), all = [], cut = [];
        for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
          const i = 4 * (y * W + x);
          if (Math.max(d[i], d[i + 1], d[i + 2]) <= 50) continue;
          const ang = a[i] / 255 * 180;
          all.push(ang);
          if (y > H * 0.45 && y < H * 0.55) cut.push([x, ang]);
        }
        // en el corte a media altura: el ángulo medio en 8 tramos a lo ancho, y cuánto varía de uno a otro
        const seg = Array.from({ length: 8 }, () => [0, 0, 0]);
        for (const [x, ang] of cut) { const k = Math.min(7, Math.floor(x / W * 8)), r = ang * Math.PI / 90; seg[k][0] += Math.cos(r); seg[k][1] += Math.sin(r); seg[k][2]++; }
        const means = seg.filter(v => v[2] >= 5).map(v => ((Math.atan2(v[1], v[0]) * 90 / Math.PI) + 180) % 180);
        out[W + '×' + H] = { ...m, negro: +(1 - m.cubre).toFixed(3), punto: +(st.punto / Math.min(W, H) * 80).toFixed(2), angulo: GK.arc(all), anguloCorte: GK.spread(means), tramosCorte: means.map(v => Math.round(v)) };
      }
      return out;
    });
    for (const [k, m] of Object.entries(sola)) {
      assert.ok(m.negro >= 0.30 && m.negro <= 0.42, k + ': tras 4 s la escena sola deja negro del 30 al 42 % del cuadro: ' + JSON.stringify(m));
      assert.ok(m.transH >= 0.03 && m.transV >= 0.03, k + ': en cintas (muchas transiciones negro↔color en filas y en columnas): ' + JSON.stringify(m));
      assert.ok(m.angulo >= 60 && m.anguloCorte >= 60, k + ': las filas no son paralelas: el ángulo de las costillas varía 60° o más (en todo el cuadro y en un corte a media altura): ' + JSON.stringify(m));
      assert.ok(m.punto >= 1.0 && m.punto <= 1.6, k + ': el paso del punto es de ~1/64 del lado corto (el punto, ~1/80): ' + JSON.stringify(m));
    }
    step('la escena sola: negro del 30 al 42 %, en cintas que se curvan', sola);

    // ── 2 · Canales casi binarios, sin gris; menta en los cantos; bordes en escalón ──
    const color = sola['540×960'];
    assert.ok(color.binario >= 0.97 && color.paleta >= 0.97, 'cada canal va apagado o encendido (casi binario) y cada punto es rojo, azul o menta puros, sin mezclas: ' + JSON.stringify(color));
    assert.ok(color.gris <= 0.003, 'sin gris fangoso (R≈G≈B): ' + JSON.stringify(color));
    assert.ok(Object.values(sola).every(m => m.menta >= 0.03 && m.menta <= 0.065), 'el menta de los remates ocupa del 3 al 6 % del cuadro: ' + JSON.stringify(Object.values(sola).map(m => m.menta)));
    assert.ok(color.blandas <= 0.01, 'bordes en escalón, sin transiciones blandas: ' + JSON.stringify(color));
    step('canales casi binarios, sin gris, menta y bordes duros', { binario: color.binario, paleta: color.paleta, gris: color.gris, menta: color.menta, blandas: color.blandas });

    // ── 3 · Determinista; sigue cambiando; avanza con el reloj, no con las llamadas ──
    const tiempo = await page.evaluate(() => {
      const a = GK.run(540, 960, { frames: 60 }), b = GK.run(540, 960, { frames: 60 });
      const igual = GK.differ(a, b);
      const t0 = GK.run(540, 960, { frames: 60, start: 30000 }), t1 = GK.run(540, 960, { frames: 90, start: 30000 }), t3 = GK.run(540, 960, { frames: 150, start: 30000 });
      const cambia = GK.differ(t0, t1), cambia3 = GK.differ(t0, t3);
      // el mismo segundo final, en 60 cuadros a 33 ms o en 120 a 16,7 ms: casi lo mismo
      flipGusano.release();
      const c30 = document.createElement('canvas'); c30.width = 540; c30.height = 960; const x30 = c30.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i <= 60; i++) renderGusano(GK.black, 64, 64, x30, false, 'STD', { now: 50000 + i * 33.333 });
      flipGusano.release();
      const c60 = document.createElement('canvas'); c60.width = 540; c60.height = 960; const x60 = c60.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i <= 120; i++) renderGusano(GK.black, 64, 64, x60, false, 'STD', { now: 50000 + i * 16.6665 });
      return { igual, cambia, cambia3, ritmo: GK.differ(c30, c60), cubre30: GK.measure(c30).cubre, cubre60: GK.measure(c60).cubre };
    });
    assert.equal(tiempo.igual, 0, 'la misma secuencia de relojes da el mismo cuadro');
    assert.ok(tiempo.cambia > 0.03 && tiempo.cambia3 > 0.1, 'sigue cambiando: el gusano avanza (un segundo después, una parte; tres segundos después, bastante más): ' + JSON.stringify(tiempo));
    assert.ok(tiempo.ritmo < 0.12 && Math.abs(tiempo.cubre30 - tiempo.cubre60) < 0.03, 'a 30 o a 60 cuadros por segundo, el mismo gusano al mismo reloj: ' + JSON.stringify(tiempo));
    step('determinista, cambia en el tiempo y va con el reloj', tiempo);

    // ── 4 · FIGURA: con 1 la figura que se mueve deja rastro; con 0 la cámara no cuenta ──
    const figura = await page.evaluate(() => {
      const W = 540, H = 960, src = document.createElement('canvas'); src.width = 360; src.height = 640;
      const g = src.getContext('2d');
      const moving = GK.run(W, H, { frames: 60, src, opts: { figura: 1, silueta: false }, each: i => GK.figure(g, 360, 640, 0.15 + 0.7 * i / 59) });
      const mm = GK.measure(moving), mascara = flipGusano.state().mascara;
      const still = GK.run(W, H, { frames: 60, src, opts: { figura: 1, silueta: false }, each: () => GK.figure(g, 360, 640, 0.5) });
      // ancho con color en la franja de la figura (que el rastro, al subir, sigue cubriendo)
      const band = [Math.round(H * 0.25), Math.round(H * 0.85)];
      const wideMoving = GK.colorCols(moving, band[0], band[1]), wideStill = GK.colorCols(still, band[0], band[1]);
      // y por encima de la figura quieta queda el tubo que la deriva estira hacia arriba
      const above = GK.colorCols(still, Math.round(H * 0.05), Math.round(H * 0.3));
      GK.figure(g, 360, 640, 0.5);
      const zero = GK.differ(GK.run(W, H, { frames: 40, src, opts: { figura: 0 } }), GK.run(W, H, { frames: 40, opts: { figura: 0 } }));
      return { cubre: mm.cubre, binario: mm.binario, mascara, anchoMoviendo: +wideMoving.toFixed(3), anchoQuieta: +wideStill.toFixed(3), tuboArriba: +above.toFixed(3), figura0: zero };
    });
    assert.equal(figura.mascara, 'luz', 'con silueta: false el sello sale de la clave de luz');
    assert.ok(figura.cubre > 0.08 && figura.binario >= 0.97, 'con FIGURA 1 la figura estampa su trama: ' + JSON.stringify(figura));
    assert.ok(figura.anchoMoviendo > 0.6 && figura.anchoMoviendo > figura.anchoQuieta * 1.6, 'la figura que se mueve deja rastro a lo largo de su camino: ' + JSON.stringify(figura));
    assert.ok(figura.tuboArriba > 0.15 && figura.tuboArriba < 0.6, 'quieta, la deriva la estira en tubo con su ancho: ' + JSON.stringify(figura));
    assert.equal(figura.figura0, 0, 'con FIGURA 0 la cámara no cambia nada');
    step('FIGURA: rastro de la figura y nada con 0', figura);

    // ── 5 · Proporción: la misma rejilla en el visor y en la foto; la foto sale del visor ──
    const prop = await page.evaluate(() => {
      flipGusano.release();
      const v = document.createElement('canvas'); v.width = 540; v.height = 960; const vx = v.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i < 80; i++) renderGusano(GK.black, 64, 64, vx, false, 'STD', { now: 60000 + i * 33.333 });
      const sv = flipGusano.state();
      const f = document.createElement('canvas'); f.width = 1080; f.height = 1920;
      renderGusano(GK.black, 64, 64, f.getContext('2d'), false, 'STD', { now: 60000 + 79 * 33.333, path: 'capture', outW: 1080, outH: 1920 });
      const sf = flipGusano.state();
      // celda a celda (en el centro de cada celda de la rejilla), visor y foto
      const [gw, gh] = sv.grid, pv = GK.px(v), pf = GK.px(f);
      let bad = 0;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const a = 4 * (Math.floor((j + 0.5) * 960 / gh) * 540 + Math.floor((i + 0.5) * 540 / gw)), b = 4 * (Math.floor((j + 0.5) * 1920 / gh) * 1080 + Math.floor((i + 0.5) * 1080 / gw));
        if (pv[a] !== pf[b] || pv[a + 1] !== pf[b + 1] || pv[a + 2] !== pf[b + 2]) bad++;
      }
      return { rejillaVisor: sv.grid, rejillaFoto: sf.grid, celdaVisor: sv.celda, celdaFoto: sf.celda, compartido: sf.compartido, distintos: +(bad / (gw * gh)).toFixed(4), lienzos: sf.lienzos };
    });
    assert.deepEqual(prop.rejillaVisor, prop.rejillaFoto, 'la rejilla es la misma en el visor y en la foto al doble: ' + JSON.stringify(prop));
    assert.ok(Math.abs(prop.celdaFoto[0] - 2 * prop.celdaVisor[0]) < 0.01 && Math.abs(prop.celdaFoto[1] - 2 * prop.celdaVisor[1]) < 0.01, 'la celda (y el punto) mide el doble en la foto al doble: ' + JSON.stringify(prop));
    assert.ok(prop.compartido && prop.distintos < 0.002, 'con el visor vivo la foto es el cuadro del visor, celda por celda: ' + JSON.stringify(prop));
    step('proporción y foto desde el visor', prop);

    // ── 6 · Sonido: los graves empujan el recorrido; el golpe turna el color ──
    const sonido = await page.evaluate(() => {
      const quiet = GK.run(540, 960, { frames: 90, start: 70000 }).stamps;
      const bass = GK.run(540, 960, { frames: 90, start: 70000, opts: { audio: { bass: 1, mid: 0, treble: 0, beat: 0 } } }).stamps;
      flipGusano.release();
      const c = document.createElement('canvas'); c.width = 540; c.height = 960; const x = c.getContext('2d');
      const turns = [];
      for (let i = 0; i < 60; i++) { renderGusano(GK.black, 64, 64, x, false, 'STD', { now: 80000 + i * 33.333, audio: { bass: 0, mid: 0, treble: 0, beat: i % 15 === 0 ? 1 : 0 } }); turns.push(flipGusano.state().turno); }
      return { estampasQuieto: quiet, estampasGraves: bass, turnos: [...new Set(turns)].length };
    });
    assert.ok(sonido.estampasGraves > sonido.estampasQuieto * 1.4, 'los graves empujan el recorrido (más vértebras por segundo): ' + JSON.stringify(sonido));
    assert.ok(sonido.turnos >= 4, 'cada golpe turna el color: ' + JSON.stringify(sonido));
    step('sonido', sonido);

    // ── 7 · Costo, foto grande, soltar y rehacer ──
    const costo = await page.evaluate(() => {
      const out = {};
      for (const [W, H] of [[540, 960], [1024, 576]]) {
        flipGusano.release();
        const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d', { willReadFrequently: true });
        for (let i = 0; i < 12; i++) renderGusano(GK.black, 64, 64, ctx, false, 'STD', { now: 90000 + i * 33.333 });
        ctx.getImageData(0, 0, 1, 1);
        const t0 = performance.now();
        for (let i = 0; i < 60; i++) renderGusano(GK.black, 64, 64, ctx, false, 'STD', { now: 90400 + i * 33.333 });
        ctx.getImageData(0, 0, 1, 1);
        out[W + '×' + H] = +((performance.now() - t0) / 60).toFixed(2);
      }
      flipGusano.release();
      const big = document.createElement('canvas'); big.width = 2160; big.height = 3840;
      const t1 = performance.now();
      const okBig = renderGusano(GK.black, 64, 64, big.getContext('2d'), false, 'STD', { path: 'capture', outW: 2160, outH: 3840, now: 99000 });
      const fotoFria = +(performance.now() - t1).toFixed(1);
      const before = flipGusano.state().gl;
      flipGusano.release();
      const released = flipGusano.state().gl;
      const again = renderGusano(GK.black, 64, 64, document.createElement('canvas').getContext('2d'), false, 'STD', { now: 99100 });
      return { msPorCuadro: out, foto4k: okBig, fotoFriaMs: fotoFria, suelta: [before, released, flipGusano.state().gl, again] };
    });
    assert.ok(costo.foto4k, 'pinta una foto de 2160 × 3840');
    assert.deepEqual(costo.suelta, [true, false, true, true], 'la gráfica se suelta y se rehace al volver a pintar');
    assert.ok(Object.values(costo.msPorCuadro).every(ms => ms < 40), 'costo por cuadro razonable: ' + JSON.stringify(costo.msPorCuadro));
    step('costo, foto grande, soltar y rehacer', costo);

    // ── 8 · Hoja de contacto (con --shots) ──
    if (shots) {
      const sheet = await page.evaluate(() => {
        const W = 540, H = 960, cases = [{}, { trama: 0.2 }, { trama: 1 }, { paso: 0.1 }, { paso: 1 }, { curva: 0 }, { curva: 1 }];
        const s = document.createElement('canvas'); s.width = W * cases.length; s.height = H;
        const g = s.getContext('2d');
        cases.forEach((o, k) => g.drawImage(GK.run(W, H, { frames: 120, opts: o }), k * W, 0));
        const l = document.createElement('canvas'); l.width = 1024; l.height = 576;
        l.getContext('2d').drawImage(GK.run(1024, 576, { frames: 120 }), 0, 0);
        const src = document.createElement('canvas'); src.width = 360; src.height = 640; const sg = src.getContext('2d');
        const f = GK.run(W, H, { frames: 60, src, opts: { figura: 1, silueta: false }, each: i => GK.figure(sg, 360, 640, 0.15 + 0.7 * i / 59) });
        return { hoja: s.toDataURL('image/png'), horizontal: l.toDataURL('image/png'), figura: f.toDataURL('image/png') };
      });
      saveDataUrl(path.join(shots, 'gusano-hoja.png'), sheet.hoja);
      saveDataUrl(path.join(shots, 'gusano-1024x576.png'), sheet.horizontal);
      saveDataUrl(path.join(shots, 'gusano-figura.png'), sheet.figura);
    }

    // ── 9 · En la app (si ya está registrada): la cámara en el visor y su foto ──
    const wired = await page.evaluate(() => typeof CAM_FAMILIES !== 'undefined' && !!CAM_FAMILIES.GUSANO);
    if (!wired) console.log('· (la app todavía no registra CAM_FAMILIES.GUSANO: el paso dentro de la app queda escrito y sin correr)');
    else {
      const app = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
      await app.page.evaluate(KIT);
      await pickCamera(app.page, 'GUSANO');
      await app.page.waitForFunction(() => camFamily === 'GUSANO' && flipGusano.state().frames > 20, null, { timeout: 15000 });
      await app.page.waitForTimeout(800);
      const visor = await app.page.evaluate(() => ({ st: flipGusano.state(), m: GK.measure(display) }));
      assert.ok(visor.st.gl && visor.m.cubre > 0.2 && visor.m.binario > 0.9, 'el visor pinta con GUSANO: ' + JSON.stringify({ m: visor.m, grid: visor.st.grid, ms: visor.st.ms }));
      if (shots) await app.page.screenshot({ path: path.join(shots, 'gusano-app.png') });
      const [download] = await Promise.all([app.page.waitForEvent('download', { timeout: 20000 }), app.page.locator('#deckShutter').click()]);
      const photo = await app.page.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
        const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; c.getContext('2d').drawImage(bitmap, 0, 0);
        return { size: [bitmap.width, bitmap.height], cubre: GK.measure(c).cubre };
      }, fs.readFileSync(await download.path()).toString('base64'));
      if (shots) saveDataUrl(path.join(shots, 'gusano-foto.jpg'), 'data:image/jpeg;base64,' + fs.readFileSync(await download.path()).toString('base64'));
      assert.ok(photo.size[0] >= 540 && photo.cubre > 0.2 && photo.cubre < 0.85, 'la foto sale a su tamaño y con el gusano: ' + JSON.stringify(photo));
      step('en la app: visor y foto con GUSANO', { visor: visor.m, foto: photo });
      assert.deepEqual(app.errors, [], 'sin errores de página en la app: ' + app.errors.join(' | '));
      await app.context.close();
    }

    assert.deepEqual(errors, [], 'sin errores de página: ' + errors.join(' | '));
    console.log('\nGUSANO: todo en orden');
  } finally { await browser.close(); }
})().catch(error => { console.error('\n✗ ' + (error && error.stack || error)); process.exit(1); });
