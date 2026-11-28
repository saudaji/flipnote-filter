// La cámara BRASA (retrato que arde). Con escenas dibujadas aquí, pasadas por el motor en un lienzo
// propio, se comprueba con números:
//   · la salida vive sobre la rampa térmica (carbón → siena → oro → blanco azufre);
//   · el texto como trama solo aparece en los medios tonos (no en el negro ni en lo quemado);
//   · el arrastre alarga las luces en horizontal y no en vertical, y con arrastre 0 no hay;
//   · la rejilla mide ~5 px en el visor y lo mismo, relativo, en una foto grande;
//   · con MARCO hay barras y su hora cambia; sin MARCO la imagen ocupa todo;
//   · el atlas de renglones se repinta cuando llega la letra de la app;
//   · sonido, costo por cuadro y soltar la gráfica; y, si la app ya la tiene registrada, la cámara
//     en el visor y su foto.
//   FLIP_URL=http://127.0.0.1:8760 node tests/brasa.cjs [--shots carpeta]
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
  const paint = {
    // retrato de luz baja: fondo oscuro, la cara dibujada, y un haz claro vertical
    retrato(g, w, h) {
      FlipScenes.draw(g, w, h, 'portrait', 0);
      g.globalCompositeOperation = 'multiply';
      const v = g.createRadialGradient(w * 0.42, h * 0.4, h * 0.05, w * 0.5, h * 0.5, h * 0.62);
      v.addColorStop(0, '#ffffff'); v.addColorStop(0.55, '#777777'); v.addColorStop(1, '#0d0d0d');
      g.fillStyle = v; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      const b = g.createLinearGradient(w * 0.64, 0, w * 0.72, 0);
      b.addColorStop(0, 'rgba(255,252,236,0)'); b.addColorStop(0.5, 'rgba(255,252,236,1)'); b.addColorStop(1, 'rgba(255,252,236,0)');
      g.fillStyle = b; g.fillRect(w * 0.64, h * 0.05, w * 0.08, h * 0.9);
    },
    cuarto(g, w, h) { FlipScenes.draw(g, w, h, 'roomLit', 0); },
    // el mismo retrato con la luz bajada: la cara en medios tonos
    medio(g, w, h) { FlipScenes.draw(g, w, h, 'portrait', 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = '#6e6e6e'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; },
    contraluz(g, w, h) { FlipScenes.draw(g, w, h, 'backlight', 0); },
    // del negro al blanco desde el centro: un anillo de medios tonos
    radial(g, w, h) { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2); r.addColorStop(0, '#fff'); r.addColorStop(1, '#000'); g.fillStyle = r; g.fillRect(0, 0, w, h); },
    // luces pequeñas sobre fondo oscuro
    luces(g, w, h) {
      g.fillStyle = '#161616'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      const s = Math.round(Math.min(w, h) * 0.022);
      for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) g.fillRect(Math.round(w * (0.2 + 0.2 * x)) - s / 2, Math.round(h * (0.12 + 0.15 * y)) - s / 2, s, s);
    },
    gris(g, w, h) { g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h); },
  };
  function scene(name, w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; paint[name](c.getContext('2d'), w, h); return c; }
  function run(src, W, H, { frames = 4, opts = {}, start = 1000, variant = 'ARDOR' } = {}) {
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < frames; i++) renderBrasa(src, src.width, src.height, ctx, false, variant, { now: start + i * 33.333, ...opts });
    return out;
  }
  const px = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const lumaOf = c => { const d = px(c), n = d.length / 4, L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]; return L; };
  // La rampa, muestreada fina: distancia de cada color a la curva.
  function rampDistance(c, ramp) {
    const pts = [], stops = [0, 0.32, 0.70, 1], col = ramp.map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)));
    for (let i = 0; i <= 512; i++) { const x = i / 512; let k = x < 0.32 ? 0 : x < 0.70 ? 1 : 2; const t = (x - stops[k]) / (stops[k + 1] - stops[k]); pts.push(col[k].map((v, j) => v + (col[k + 1][j] - v) * t)); }
    const d = px(c), ds = [];
    for (let i = 0; i < d.length; i += 4 * 7) { let best = 1e9; for (const p of pts) { const e = (d[i] - p[0]) ** 2 + (d[i + 1] - p[1]) ** 2 + (d[i + 2] - p[2]) ** 2; if (e < best) best = e; } ds.push(Math.sqrt(best)); }
    ds.sort((a, b) => a - b);
    return { media: +(ds.reduce((a, x) => a + x, 0) / ds.length).toFixed(2), p95: +ds[Math.floor(ds.length * 0.95)].toFixed(1), p99: +ds[Math.floor(ds.length * 0.99)].toFixed(1) };
  }
  // Autocorrelación de una banda de filas a lo largo de x: el primer pico es el periodo.
  function period(c, y0, y1, maxLag = 30) {
    const w = c.width, L = lumaOf(c), ac = [];
    for (let lag = 1; lag <= maxLag; lag++) {
      let s = 0, a = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = 10; x < w - 10 - lag; x++) { const p = L[y * w + x], q = L[y * w + x + lag]; s += p * q; a += p; b += q; n++; }
      let va = 0; for (let y = y0; y < y1; y++) for (let x = 10; x < w - 10 - lag; x++) { const p = L[y * w + x] - a / n; va += p * p; }
      ac.push(va / n < 0.05 ? 0 : (s / n - (a / n) * (b / n)) / (va / n));          // (una imagen lisa no tiene periodo)
    }
    let lag = 0; for (let i = 2; i < ac.length - 1; i++) if (ac[i] > ac[i - 1] && ac[i] >= ac[i + 1] && ac[i] > 0.1) { lag = i + 1; break; }
    return { lag, ac: ac.map(v => +v.toFixed(2)) };
  }
  window.BK = { scene, run, px, lumaOf, rampDistance, period };
};

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { boot: false, desktop: true });
    await page.waitForFunction(() => document.readyState === 'complete');
    if (await page.evaluate(() => typeof window.renderBrasa) !== 'function') await page.addScriptTag({ path: path.join(__dirname, '..', 'docs', 'brasa.js') });
    await page.evaluate(KIT);
    assert.ok(await page.evaluate(() => typeof renderBrasa === 'function' && !!window.flipBrasa), 'el motor expone renderBrasa y flipBrasa');

    // ── 1 · La salida vive sobre la rampa térmica ──
    const rampa = await page.evaluate(() => {
      const out = {};
      for (const name of ['retrato', 'cuarto', 'radial']) out[name] = BK.rampDistance(BK.run(BK.scene(name, 720, 1280), 540, 960, { frames: 6 }), flipBrasa.RAMPAS.ARDOR);
      out.ceniza = BK.rampDistance(BK.run(BK.scene('retrato', 720, 1280), 540, 960, { frames: 3, variant: 'CENIZA' }), flipBrasa.RAMPAS.CENIZA);
      return out;
    });
    for (const [name, r] of Object.entries(rampa)) assert.ok(r.media < 4 && r.p95 < 12 && r.p99 < 25, name + ': el color no sale de la rampa: ' + JSON.stringify(r));
    step('la salida vive sobre la rampa térmica (distancia en niveles de 0 a 255)', rampa);

    // ── 2 · El texto solo en los medios tonos ──
    const texto = await page.evaluate(() => {
      const W = 540, H = 960, src = BK.scene('radial', 720, 1280);
      const a = BK.lumaOf(BK.run(src, W, H, { frames: 3, opts: { texto: 0.7, arrastre: 0 } }));
      const b = BK.lumaOf(BK.run(src, W, H, { frames: 3, opts: { texto: 0, arrastre: 0 } }));
      // banda de cada píxel según la luz de la escena en ese punto
      const s = document.createElement('canvas'); s.width = W; s.height = H; s.getContext('2d').drawImage(src, 0, 0, W, H);
      const L = BK.lumaOf(s), band = { negro: [0, 0, 0], medio: [0, 0, 0], quemado: [0, 0, 0] };
      for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) {
        const i = y * W + x, l = L[i] / 255, k = l < 0.08 ? 'negro' : l > 0.2 && l < 0.5 ? 'medio' : l > 0.8 ? 'quemado' : null;
        if (!k) continue;
        // alta frecuencia horizontal (diferencia con el vecino) que añade el texto
        band[k][0]++; band[k][1] += Math.abs(a[i] - a[i - 1]) - Math.abs(b[i] - b[i - 1]); band[k][2] += Math.abs(a[i] - b[i]);
      }
      const r = v => ({ hf: +(v[1] / v[0]).toFixed(2), dif: +(v[2] / v[0]).toFixed(2) });
      return { negro: r(band.negro), medio: r(band.medio), quemado: r(band.quemado) };
    });
    assert.ok(texto.medio.hf > 0.3 && texto.medio.dif > 1.5, 'el texto añade detalle horizontal en los medios tonos: ' + JSON.stringify(texto));
    assert.ok(texto.negro.hf < texto.medio.hf * 0.15 && texto.quemado.hf < texto.medio.hf * 0.15 && texto.negro.dif < texto.medio.dif * 0.15 && texto.quemado.dif < texto.medio.dif * 0.15, 'y no en el negro ni en lo quemado: ' + JSON.stringify(texto));
    step('texto como trama solo en los medios tonos', texto);

    // ── 2b · Con una cara en medios tonos (no quemada), la letra entra en la piel ──
    const cara = await page.evaluate(() => {
      const W = 540, H = 960, src = BK.scene('medio', 720, 1280), s = document.createElement('canvas'); s.width = W; s.height = H; s.getContext('2d').drawImage(src, 0, 0, W, H);
      const sd = BK.px(s), a = BK.lumaOf(BK.run(src, W, H, { frames: 3, opts: { texto: 0.7, arrastre: 0 } })), b = BK.lumaOf(BK.run(src, W, H, { frames: 3, opts: { texto: 0, arrastre: 0 } }));
      let n = 0, dif = 0, hf = 0, lum = 0;
      for (let y = Math.round(H * 0.3); y < H * 0.55; y++) for (let x = Math.round(W * 0.25); x < W * 0.75; x++) {
        const i = y * W + x, r = sd[4 * i], g = sd[4 * i + 1], bl = sd[4 * i + 2];
        if (!(r > g && g > bl && r - bl > 25)) continue;                          // piel
        n++; lum += 0.299 * r + 0.587 * g + 0.114 * bl; dif += Math.abs(a[i] - b[i]); hf += Math.abs(a[i] - a[i - 1]) - Math.abs(b[i] - b[i - 1]);
      }
      return { piel: n, luzPiel: Math.round(lum / n), dif: +(dif / n).toFixed(2), hf: +(hf / n).toFixed(2) };
    });
    assert.ok(cara.piel > 5000 && cara.luzPiel > 60 && cara.luzPiel < 130 && cara.dif > 1.2, 'la letra entra en la piel de una cara en medios tonos: ' + JSON.stringify(cara));
    step('letra en la piel en medios tonos', cara);

    // ── 3 · Arrastre: alarga las luces en horizontal, no en vertical; con 0 no hay ──
    const arrastre = await page.evaluate(() => {
      const W = 540, H = 960, src = BK.scene('luces', 720, 1280);
      const extent = amount => {
        // lo más que se extiende cada luz en 16 cuadros (las ráfagas cambian 8 veces por segundo)
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true }), max = new Float32Array(W * H);
        for (let i = 0; i < 16; i++) { renderBrasa(src, 720, 1280, ctx, false, 'ARDOR', { now: 20000 + i * 66.7, arrastre: amount, texto: 0, ardor: 0, rejilla: 0 }); const L = BK.lumaOf(c); for (let k = 0; k < L.length; k++) if (L[k] > max[k]) max[k] = L[k]; }
        let hs = 0, vs = 0, n = 0;
        for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) {
          const cx = Math.round(W * (0.2 + 0.2 * x)), cy = Math.round(H * (0.12 + 0.15 * y));
          let l = 0, r = 0, u = 0, d = 0;
          while (cx - l > 0 && max[cy * W + cx - l - 1] > 120) l++;
          while (cx + r < W - 1 && max[cy * W + cx + r + 1] > 120) r++;
          while (cy - u > 0 && max[(cy - u - 1) * W + cx] > 120) u++;
          while (cy + d < H - 1 && max[(cy + d + 1) * W + cx] > 120) d++;
          hs += l + r + 1; vs += u + d + 1; n++;
        }
        return { horizontal: +(hs / n).toFixed(1), vertical: +(vs / n).toFixed(1) };
      };
      return { con: extent(0.45), sin: extent(0), fuerte: extent(1) };
    });
    assert.ok(Math.abs(arrastre.sin.horizontal - arrastre.sin.vertical) <= 2, 'con arrastre 0 las luces no se alargan: ' + JSON.stringify(arrastre.sin));
    assert.ok(arrastre.con.horizontal >= arrastre.sin.horizontal + 6 && arrastre.con.vertical <= arrastre.sin.vertical + 1, 'el arrastre alarga en horizontal y no en vertical: ' + JSON.stringify(arrastre));
    assert.ok(arrastre.fuerte.horizontal > arrastre.con.horizontal, 'más arrastre, hebras más largas: ' + JSON.stringify(arrastre));
    step('arrastre horizontal por umbral de luz', arrastre);

    // ── 4 · Rejilla de ~5 px, proporcional ──
    const rejilla = await page.evaluate(() => {
      const opts = { texto: 0, arrastre: 0, ardor: 0 };
      const at = (W, H, extra) => BK.period(BK.run(BK.scene('gris', 720, 1280), W, H, { frames: 2, opts: { ...opts, ...extra } }), Math.round(H * 0.4), Math.round(H * 0.4) + 40);
      const v = at(540, 960, {}), big = at(1080, 1920, { path: 'capture' }), mid = at(900, 1600, { path: 'capture' }), off = at(540, 960, { rejilla: 0 });
      return { visor: v.lag, foto: big.lag, ancho900: mid.lag, sinRejilla: off.lag, ac3: v.ac[2], acSin3: off.ac[2] };
    });
    // (como en la referencia: 5 px sobre ~900 de imagen, un 1/180 del ancho; nunca menos de 3 px)
    assert.ok(rejilla.visor === 3, 'la rejilla mide 1/180 del ancho (3 px en un visor de 540): ' + JSON.stringify(rejilla));
    assert.ok(rejilla.foto === 6 && rejilla.ancho900 === 5, 'y el doble en la foto al doble (6 px), 5 px en una imagen de 900: ' + JSON.stringify(rejilla));
    assert.ok(rejilla.sinRejilla === 0 || rejilla.acSin3 < 0.1, 'con REJILLA 0 no hay trama: ' + JSON.stringify(rejilla));
    step('rejilla ortogonal (1/180 del ancho)', rejilla);

    // ── 5 · Marco: barras con hora que cambia; sin marco, la imagen ocupa todo ──
    const marco = await page.evaluate(async () => {
      const W = 540, H = 960, src = BK.scene('retrato', 720, 1280), c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      renderBrasa(src, 720, 1280, ctx, false, 'ARDOR', { now: 1000, marco: true });
      const s1 = flipBrasa.state().marco, [mx, my, mw, mh] = s1.menu;
      const clock = () => Array.from(ctx.getImageData(...s1.reloj).data);
      // el menú es papel claro de brasa (#E6CF9C) con letra oscura
      const barTone = () => { const d = ctx.getImageData(Math.round(mx + mw * 0.8), my + 2, 20, Math.max(1, mh - 5)).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - 0xE6) + Math.abs(d[i + 1] - 0xCF) + Math.abs(d[i + 2] - 0x9C); return s / (d.length / 4); };
      const bottom = () => Array.from(ctx.getImageData(...s1.bottom).data);
      const c1 = clock(), b1 = bottom(), tone = barTone();
      await new Promise(r => setTimeout(r, 1150));
      renderBrasa(src, 720, 1280, ctx, false, 'ARDOR', { now: 2150, marco: true });
      const s2 = flipBrasa.state().marco, c2 = clock(), b2 = bottom(), png = c.toDataURL('image/png');
      const diff = (a, b) => a.reduce((n, v, i) => n + (Math.abs(v - b[i]) > 24), 0);
      renderBrasa(src, 720, 1280, ctx, false, 'ARDOR', { now: 2200 });
      const s3 = flipBrasa.state().marco, toneOff = barTone();
      return { con: { on: s1.on, titulo: s1.top, menu: s1.menu, estado: s1.bottom, reloj: s1.reloj, letra: s1.letra, imagen: s1.image, horas: [s1.hora, s2.hora], relojCambia: diff(c1, c2), textoCorre: diff(b1, b2), tonoMenu: +tone.toFixed(1) }, sin: { on: s3.on, imagen: s3.image, tonoArriba: +toneOff.toFixed(1) }, png };
    });
    const png = marco.png; delete marco.png;
    assert.ok(marco.con.on && marco.con.titulo[3] >= 12 && marco.con.menu[3] >= 10 && marco.con.estado[3] >= 11 && marco.con.tonoMenu < 30, 'con MARCO hay ventana completa: título, menú y barra de estado: ' + JSON.stringify(marco.con));
    assert.equal(marco.con.letra, 'Pixelify Sans', 'el marco va en la letra de píxel de la app');
    assert.ok(marco.con.horas[0] !== marco.con.horas[1] && marco.con.relojCambia > 10, 'la hora de la barra de estado cambia: ' + JSON.stringify(marco.con));
    assert.ok(marco.con.textoCorre > 20, 'el texto de la barra de estado corre: ' + JSON.stringify(marco.con));
    if (shots) saveDataUrl(path.join(shots, 'brasa-marco.png'), png);
    assert.ok(!marco.sin.on && marco.sin.imagen.join() === '0,0,540,960' && marco.sin.tonoArriba > 20, 'sin MARCO no hay barras y la imagen ocupa todo: ' + JSON.stringify(marco.sin));
    step('marco: ventana de mapa de bits propia', marco);

    // ── 6 · Sonido: el bajo corre más las luces; el golpe enciende el haz ──
    const sonido = await page.evaluate(() => {
      const W = 540, H = 960, src = BK.scene('luces', 720, 1280);
      const width = audio => { const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d', { willReadFrequently: true }); let s = 0; for (let i = 0; i < 12; i++) { renderBrasa(src, 720, 1280, ctx, false, 'ARDOR', { now: 40000 + i * 66.7, audio, texto: 0, rejilla: 0 }); const L = BK.lumaOf(c); for (const v of L) s += v > 120; } return s / 12; };
      return { quieto: Math.round(width(null)), bajo: Math.round(width({ bass: 1, mid: 0, treble: 0, beat: 0 })), golpe: Math.round(width({ bass: 0, mid: 0, treble: 0, beat: 1 })) };
    });
    assert.ok(sonido.bajo > sonido.quieto * 1.1 && sonido.golpe > sonido.quieto * 1.1, 'el bajo y el golpe encienden y corren más las luces: ' + JSON.stringify(sonido));
    step('sonido', sonido);

    // ── 7 · Costo por cuadro, foto grande, soltar y rehacer ──
    const costo = await page.evaluate(() => {
      const out = {};
      for (const [W, H] of [[540, 960], [1024, 576]]) for (const marco of [false, true]) {
        const src = BK.scene('cuarto', 1280, 720), c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        for (let i = 0; i < 5; i++) renderBrasa(src, 1280, 720, ctx, false, 'ARDOR', { now: 50000 + i * 33.3, marco });
        ctx.getImageData(0, 0, 1, 1);
        const t0 = performance.now();
        for (let i = 0; i < 40; i++) renderBrasa(src, 1280, 720, ctx, false, 'ARDOR', { now: 51000 + i * 33.3, marco });
        ctx.getImageData(0, 0, 1, 1);
        out[W + '×' + H + (marco ? ' marco' : '')] = +((performance.now() - t0) / 40).toFixed(2);
      }
      const big = document.createElement('canvas'); big.width = 2560; big.height = 1440;
      const okBig = renderBrasa(BK.scene('cuarto', 1280, 720), 1280, 720, big.getContext('2d'), false, 'ARDOR', { path: 'capture', outW: 2560, outH: 1440, now: 60000, marco: true });
      const before = flipBrasa.state().gl;
      flipBrasa.release();
      const released = flipBrasa.state().gl;
      const again = renderBrasa(BK.scene('cuarto', 640, 360), 640, 360, document.createElement('canvas').getContext('2d'), false, 'ARDOR', { now: 60100 });
      return { msPorCuadro: out, foto2560: okBig, suelta: [before, released, flipBrasa.state().gl, again] };
    });
    assert.ok(costo.foto2560, 'pinta una foto de 2560 × 1440');
    assert.deepEqual(costo.suelta, [true, false, true, true], 'la gráfica se suelta y se rehace al volver a pintar');
    assert.ok(Object.values(costo.msPorCuadro).every(ms => ms < 120), 'costo por cuadro razonable: ' + JSON.stringify(costo.msPorCuadro));
    step('costo, foto grande, soltar y rehacer', costo);

    // ── 8 · Hoja de contacto (con --shots) ──
    if (shots) {
      const sheet = await page.evaluate(() => {
        const W = 540, H = 960, names = ['retrato', 'cuarto', 'contraluz', 'radial'], sheet = document.createElement('canvas');
        sheet.width = W * names.length; sheet.height = H * 3;
        const g = sheet.getContext('2d');
        names.forEach((n, i) => {
          const src = BK.scene(n, 720, 1280);
          g.drawImage(src, i * W, 0, W, H);
          g.drawImage(BK.run(src, W, H, { frames: 8 }), i * W, H);
          g.drawImage(BK.run(src, W, H, { frames: 8, opts: { marco: true } }), i * W, 2 * H);
        });
        return { sheet: sheet.toDataURL('image/png'), atlas: flipBrasa._atlas().toDataURL('image/png') };
      });
      saveDataUrl(path.join(shots, 'brasa-hoja.png'), sheet.sheet);
      saveDataUrl(path.join(shots, 'brasa-atlas.png'), sheet.atlas);
    }

    // ── 9 · El atlas se repinta cuando llega la letra ──
    // (en una página sin la letra de la red; luego se «carga» una cara con su nombre)
    const ctx2 = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await ctx2.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await ctx2.addInitScript({ path: path.join(__dirname, 'scenes.js') });
    const p2 = await ctx2.newPage();
    const errors2 = [];
    p2.on('pageerror', e => errors2.push(String(e && e.message || e)));
    await p2.goto(require('./lib/harness.cjs').URL);
    await p2.waitForFunction(() => document.readyState === 'complete');
    if (await p2.evaluate(() => typeof window.renderBrasa) !== 'function') await p2.addScriptTag({ path: path.join(__dirname, '..', 'docs', 'brasa.js') });
    await p2.evaluate(KIT);
    const fuente = await p2.evaluate(async () => {
      const src = BK.scene('radial', 360, 640), c = document.createElement('canvas'); c.width = 270; c.height = 480;
      const ctx = c.getContext('2d');
      renderBrasa(src, 360, 640, ctx, false, 'ARDOR', { now: 1000 });
      const before = { ...flipBrasa.state().atlas }, pix1 = Array.from(flipBrasa._atlas().getContext('2d').getImageData(0, 0, 512, 64).data.filter((_, i) => i % 4 === 0));
      const face = new FontFace('IBM Plex Mono', 'url(./fonts/BNMonica.otf)');
      document.fonts.add(face);
      await face.load();
      await new Promise(r => setTimeout(r, 50));
      renderBrasa(src, 360, 640, ctx, false, 'ARDOR', { now: 1600 });
      const after = { ...flipBrasa.state().atlas }, pix2 = Array.from(flipBrasa._atlas().getContext('2d').getImageData(0, 0, 512, 64).data.filter((_, i) => i % 4 === 0));
      return { antes: before, despues: after, cambio: pix1.reduce((n, v, i) => n + (Math.abs(v - pix2[i]) > 40), 0) };
    });
    assert.deepEqual(fuente.antes, { font: 'monospace', gen: 1 }, 'sin la letra todavía, el atlas sale en monoespaciada: ' + JSON.stringify(fuente));
    assert.ok(fuente.despues.font === 'IBM Plex Mono' && fuente.despues.gen === 2 && fuente.cambio > 200, 'al cargar la letra, el atlas se repinta con ella: ' + JSON.stringify(fuente));
    assert.deepEqual(errors2, [], 'sin errores de página: ' + errors2.join(' | '));
    await ctx2.close();
    step('el atlas se repinta al llegar la letra', fuente);

    // ── 10 · En la app (si ya está registrada): la cámara en el visor y su foto ──
    const wired = await page.evaluate(() => typeof CAM_FAMILIES !== 'undefined' && !!CAM_FAMILIES.BRASA);
    if (!wired) console.log('· (la app todavía no registra CAM_FAMILIES.BRASA: el paso dentro de la app queda escrito y sin correr)');
    else {
      const app = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
      await app.page.evaluate(KIT);
      await pickCamera(app.page, 'BRASA');
      await app.page.waitForFunction(() => camFamily === 'BRASA' && flipBrasa.state().frames > 10, null, { timeout: 15000 });
      await app.page.waitForTimeout(600);
      const visor = await app.page.evaluate(() => ({ st: flipBrasa.state(), rampa: BK.rampDistance(display, flipBrasa.RAMPAS.ARDOR) }));
      assert.ok(visor.st.gl && visor.rampa.media < 6, 'el visor pinta con BRASA: ' + JSON.stringify({ rampa: visor.rampa, marco: visor.st.marco.on, ms: visor.st.ms }));
      if (shots) await app.page.screenshot({ path: path.join(shots, 'brasa-app.png') });
      const [download] = await Promise.all([app.page.waitForEvent('download', { timeout: 20000 }), app.page.locator('#deckShutter').click()]);
      const photo = await app.page.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
        const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; c.getContext('2d').drawImage(bitmap, 0, 0);
        return { size: [bitmap.width, bitmap.height], rampa: BK.rampDistance(c, flipBrasa.RAMPAS.ARDOR), marco: flipBrasa.state().marco.on };
      }, fs.readFileSync(await download.path()).toString('base64'));
      if (shots) saveDataUrl(path.join(shots, 'brasa-foto.jpg'), 'data:image/jpeg;base64,' + fs.readFileSync(await download.path()).toString('base64'));
      assert.ok(photo.size[0] >= 540 && photo.rampa.media < 8, 'la foto sale a su tamaño y sobre la rampa: ' + JSON.stringify(photo));
      step('en la app: visor y foto con BRASA', { visor: { rampa: visor.rampa, marco: visor.st.marco.on }, foto: photo });
      assert.deepEqual(app.errors, [], 'sin errores de página en la app: ' + app.errors.join(' | '));
      await app.context.close();
    }

    assert.deepEqual(errors, [], 'sin errores de página: ' + errors.join(' | '));
    console.log('\nBRASA: todo en orden');
  } finally { await browser.close(); }
})().catch(error => { console.error('\n✗ ' + (error && error.stack || error)); process.exit(1); });
