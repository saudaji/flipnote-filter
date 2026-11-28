// La cámara ESPECTRO (colorizador de video sobre la cámara). Con escenas dibujadas aquí, pasadas por
// el motor en un lienzo propio, se comprueba con números:
//   · negro total bajo la clave de luz (en el cuarto y en un degradado);
//   · dentro de la figura, el matiz cubre al menos 5 de los 6 sectores con un 8 % o más cada uno, y
//     va en escalones (casi todo cae en los escalones de la paleta, no en degradado);
//   · al menos 3 bandas distintas cruzan una cara;
//   · el croma se parece a sí mismo mucho más lejos en horizontal que en vertical (lóbulos anchos,
//     líneas de barrido); la subportadora tiene su periodo (7–9 px sobre 1344);
//   · CICLO hace girar el arcoíris en el tiempo; con una escena de rango de luz estrecho sigue
//     usando todo el arcoíris (normalización);
//   · las medidas son proporcionales en una foto grande; sonido, costo, soltar y rehacer; y, si la
//     app ya la tiene registrada, la cámara en el visor y su foto.
//   FLIP_URL=http://127.0.0.1:8760 node tests/espectro.cjs [--shots carpeta]
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
  const rng = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 8) / 16777216; };
  const paint = {
    cuarto(g, w, h) { FlipScenes.draw(g, w, h, 'roomLit', 0); },
    cara(g, w, h) { FlipScenes.draw(g, w, h, 'portrait', 0); },
    degradado(g, w, h) { const r = g.createLinearGradient(0, 0, w, 0); r.addColorStop(0, '#000'); r.addColorStop(1, '#fff'); g.fillStyle = r; g.fillRect(0, 0, w, h); },
    // una salpicadura clara sobre negro: mancha con sombreado y gotas
    salpicadura(g, w, h, lo = 0.25, hi = 1) {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      const cx = w * 0.5, cy = h * 0.55, R = Math.min(w, h) * 0.4;
      const v = x => Math.round(255 * (lo + (hi - lo) * x));
      const gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.05, cx, cy, R * 1.1);
      gr.addColorStop(0, 'rgb(' + [v(1), v(1), v(1)] + ')'); gr.addColorStop(0.55, 'rgb(' + [v(0.55), v(0.55), v(0.55)] + ')'); gr.addColorStop(1, 'rgb(' + [v(0), v(0), v(0)] + ')');
      g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, R * 1.2, R * 0.75, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; g.fillStyle = 'rgb(' + [v(0.7), v(0.7), v(0.7)] + ')'; g.beginPath(); g.ellipse(cx + Math.cos(a) * R * 1.25, cy - R * 0.6 + Math.sin(a) * R * 0.2, R * 0.05, R * 0.11, a, 0, 7); g.fill(); }
    },
    // la misma salpicadura con la luz apretada entre 0,50 y 0,58
    estrecho(g, w, h) { paint.salpicadura(g, w, h, 0.5, 0.58); },
    // manchas de luz por todo el cuadro, sin dirección preferida (por encima de la clave)
    manchas(g, w, h) {
      g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, w, h);
      const r = rng(11), s = Math.min(w, h);
      for (let i = 0; i < 220; i++) {
        const x = r() * w, y = r() * h, rr = s * (0.03 + 0.08 * r()), a = r() < 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(90,90,90,0.55)';
        const gg = g.createRadialGradient(x, y, 0, x, y, rr); gg.addColorStop(0, a); gg.addColorStop(1, 'rgba(150,150,150,0)');
        g.fillStyle = gg; g.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
      }
    },
    gris(g, w, h) { g.fillStyle = 'rgb(180,180,180)'; g.fillRect(0, 0, w, h); },
  };
  function scene(name, w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; paint[name](c.getContext('2d'), w, h); return c; }
  function run(src, W, H, { frames = 6, opts = {}, start = 1000, release = true } = {}) {
    if (release) flipEspectro.release();
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < frames; i++) renderEspectro(src, src.width, src.height, ctx, false, 'STD', { now: start + i * 33.333, ...opts });
    return out;
  }
  const px = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const lumaOf = c => { const d = px(c), n = d.length / 4, L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255; return L; };
  function hueOf(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 1) return -1;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
  }
  const PAL_H = () => flipEspectro.PALETA.map(hex => hueOf(...[1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16))));
  // Matiz dentro de la figura: sectores de 60° (R, Y, G, C, B, M) y cuánto cae en un escalón.
  function hues(c, box) {
    const d = px(c), W = c.width, H = c.height, [x0, y0, x1, y1] = box || [0, 0, W, H], pal = PAL_H();
    const sec = [0, 0, 0, 0, 0, 0];
    let n = 0, near = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = 4 * (y * W + x), r = d[i], g = d[i + 1], b = d[i + 2];
      if (Math.max(r, g, b) < 60) continue;
      const h = hueOf(r, g, b); if (h < 0) continue;
      n++; sec[Math.floor(((h + 30) % 360) / 60)]++;
      if (pal.some(p => Math.min(Math.abs(p - h), 360 - Math.abs(p - h)) <= 8)) near++;
    }
    const share = sec.map(v => +(v / Math.max(1, n)).toFixed(3));
    return { n, sectores: share, llenos: share.filter(v => v >= 0.08).length, escalon: +(near / Math.max(1, n)).toFixed(3) };
  }
  // Autocorrelación del croma (coseno del ángulo de matiz entre un punto y su vecino a d px):
  // la distancia a la que baja de 0,5, en horizontal y en vertical.
  function chromaReach(c, box) {
    const d = px(c), W = c.width, [x0, y0, x1, y1] = box, H = new Float32Array(W * c.height).fill(-1);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = 4 * (y * W + x); if (Math.max(d[i], d[i + 1], d[i + 2]) >= 60) H[y * W + x] = hueOf(d[i], d[i + 1], d[i + 2]); }
    const r = (dx, dy) => { let s = 0, n = 0; for (let y = y0; y < y1 - dy; y++) for (let x = x0; x < x1 - dx; x++) { const a = H[y * W + x], b = H[(y + dy) * W + x + dx]; if (a < 0 || b < 0) continue; s += Math.cos((a - b) * Math.PI / 180); n++; } return n ? s / n : 0; };
    let lh = 0, lv = 0;
    for (let k = 1; k <= 80 && !lh; k++) if (r(k, 0) < 0.5) lh = k;
    for (let k = 1; k <= 80 && !lv; k++) if (r(0, k) < 0.5) lv = k;
    return { horizontal: lh || 80, vertical: lv || 80 };
  }
  // Primer pico de la autocorrelación de la luz a lo largo de x (el periodo de las rayitas).
  function period(c, y0, y1, maxLag = 16) {
    const W = c.width, L = lumaOf(c), ac = [];
    for (let lag = 1; lag <= maxLag; lag++) {
      let s = 0, n = 0, m = 0, v = 0;
      for (let y = y0; y < y1; y++) for (let x = 20; x < W - 20 - lag; x++) { m += L[y * W + x]; n++; }
      m /= n;
      for (let y = y0; y < y1; y++) for (let x = 20; x < W - 20 - lag; x++) { const a = L[y * W + x] - m, b = L[y * W + x + lag] - m; s += a * b; v += a * a; }
      ac.push(v > 0 ? s / v : 0);
    }
    let lag = 0; for (let i = 1; i < ac.length - 1; i++) if (ac[i] > ac[i - 1] && ac[i] >= ac[i + 1] && ac[i] > 0.1) { lag = i + 1; break; }
    return { lag, ac: ac.map(v => +v.toFixed(2)) };
  }
  window.EK = { scene, run, px, lumaOf, hueOf, hues, chromaReach, period };
};

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { boot: false, desktop: true });
    await page.waitForFunction(() => document.readyState === 'complete');
    if (await page.evaluate(() => typeof window.renderEspectro) !== 'function') await page.addScriptTag({ path: path.join(__dirname, '..', 'docs', 'espectro.js') });
    await page.evaluate(KIT);
    assert.ok(await page.evaluate(() => typeof renderEspectro === 'function' && !!window.flipEspectro), 'el motor expone renderEspectro y flipEspectro');

    // ── 1 · Negro total bajo la clave ──
    const negro = await page.evaluate(() => {
      const out = {};
      for (const name of ['cuarto', 'degradado']) {
        const W = 540, H = 960, src = EK.scene(name, W, H), c = EK.run(src, W, H);
        const key = flipEspectro.state().clave, L = EK.lumaOf(src), d = EK.px(c);
        // (se deja fuera lo que el arrastre de las luces, el peine y el temblor pueden correr: 20 px
        // a la izquierda, 10 a la derecha y 9 arriba y abajo)
        let under = 0, lit = 0;
        for (let y = 9; y < H - 9; y += 2) for (let x = 20; x < W - 10; x += 2) {
          let mx = 0;
          for (let yy = y - 9; yy <= y + 9 && mx < key; yy += 3) for (let xx = x - 20; xx <= x + 10; xx += 2) mx = Math.max(mx, L[yy * W + xx]);
          if (mx >= key - 0.03) continue;
          under++;
          const i = 4 * (y * W + x);
          if (Math.max(d[i], d[i + 1], d[i + 2]) > 6) lit++;
        }
        out[name] = { clave: key, bajoClave: under, encendidos: lit };
      }
      return out;
    });
    for (const [k, v] of Object.entries(negro)) assert.ok(v.bajoClave > 2000 && v.encendidos === 0, k + ': negro total bajo la clave: ' + JSON.stringify(v));
    step('negro total bajo la clave', negro);

    // ── 2 · El arcoíris entero dentro de la figura, en escalones ──
    const arco = await page.evaluate(() => {
      const out = {};
      for (const [name, box] of [['salpicadura', [0.15, 0.3, 0.85, 0.8]], ['degradado', [0, 0, 1, 1]], ['cuarto', [0, 0, 1, 1]]]) {
        const W = 540, H = 960, c = EK.run(EK.scene(name, W, H), W, H);
        out[name] = EK.hues(c, [Math.round(box[0] * W), Math.round(box[1] * H), Math.round(box[2] * W), Math.round(box[3] * H)]);
      }
      return out;
    });
    for (const [k, v] of Object.entries(arco)) {
      assert.ok(v.llenos >= 5, k + ': el matiz cubre al menos 5 de 6 sectores con un 8 % o más: ' + JSON.stringify(v));
      assert.ok(v.escalon >= 0.6, k + ': en escalones (casi todo en un escalón de la paleta, no un degradado): ' + JSON.stringify(v));
    }
    step('arcoíris entero y en escalones', arco);

    // ── 3 · Varias bandas cruzan la cara ──
    const cara = await page.evaluate(() => {
      const W = 540, H = 960, c = EK.run(EK.scene('cara', W, H), W, H), d = EK.px(c);
      // la piel: elipse de centro (0,5 W, 0,42 H) y semiejes 0,21 H × 0,31 H; se cruza por debajo de los ojos
      const pal = flipEspectro.PALETA.map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)));
      const rows = [Math.round(H * 0.44), Math.round(H * 0.47), Math.round(H * 0.5)];
      const counts = rows.map(y => {
        let last = -1, run = 0; const seen = new Set();
        for (let x = Math.round(W * 0.5 - H * 0.17); x < W * 0.5 + H * 0.17; x++) {
          const i = 4 * (y * W + x);
          if (Math.max(d[i], d[i + 1], d[i + 2]) < 60) { run = 0; continue; }
          let best = 0, bd = 1e9; pal.forEach((p, k) => { const e = Math.abs(p[0] - d[i]) + Math.abs(p[1] - d[i + 1]) + Math.abs(p[2] - d[i + 2]); if (e < bd) { bd = e; best = k; } });
          if (best === last) { run++; if (run === 6) seen.add(best); } else { last = best; run = 1; }
        }
        return seen.size;
      });
      return { bandasPorFila: counts };
    });
    assert.ok(Math.min(...cara.bandasPorFila) >= 3, 'al menos 3 bandas distintas cruzan la cara: ' + JSON.stringify(cara));
    step('bandas que cruzan la cara', cara);

    // ── 4 · El croma, ancho en horizontal; la subportadora con su periodo ──
    const croma = await page.evaluate(() => {
      const W = 540, H = 960, c = EK.run(EK.scene('manchas', W, H), W, H);
      const reach = EK.chromaReach(c, [40, 80, W - 40, H - 80]);
      const big = EK.run(EK.scene('gris', 1344, 1344), 1344, 1344, { frames: 3 });
      const p = EK.period(big, 600, 640, 16);
      const st = flipEspectro.state();
      return { alcance: reach, subportadora: p.lag, ac: p.ac, lobulo: st.lobulo, linea: st.linea, periodo: st.subportadora };
    });
    assert.ok(croma.alcance.horizontal >= 1.6 * croma.alcance.vertical, 'el croma se parece a sí mismo más lejos en horizontal que en vertical: ' + JSON.stringify(croma));
    assert.ok(croma.subportadora >= 7 && croma.subportadora <= 9, 'las rayitas de subportadora miden 7–9 px sobre 1344: ' + JSON.stringify(croma));
    assert.ok(croma.lobulo >= 28 && croma.lobulo <= 40 && Math.abs(croma.linea - 16) < 0.5, 'lóbulo de ~34 px y línea de 16 px sobre 1344: ' + JSON.stringify(croma));
    step('croma ancho, líneas y subportadora', croma);

    // ── 5 · CICLO gira el arcoíris; la normalización con una escena de luz estrecha ──
    const ciclo = await page.evaluate(() => {
      const W = 540, H = 960, src = EK.scene('degradado', W, H);
      const turn = amount => {
        flipEspectro.release();
        const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d', { willReadFrequently: true });
        const at = () => { const d = EK.px(c), out = []; for (let k = 0; k < 40; k++) { const x = Math.round(W * (0.45 + 0.5 * k / 40)), y = Math.round(H * (0.2 + 0.6 * ((k * 7) % 40) / 40)), i = 4 * (y * W + x); out.push(EK.hueOf(d[i], d[i + 1], d[i + 2])); } return out; };
        for (let i = 0; i < 4; i++) renderEspectro(src, W, H, ctx, false, 'STD', { now: 3000 + i * 33.3, ciclo: amount });
        const a = at();
        for (let i = 4; i < 34; i++) renderEspectro(src, W, H, ctx, false, 'STD', { now: 3000 + i * 33.3, ciclo: amount });
        const b = at();
        let s = 0, n = 0; a.forEach((h, k) => { if (h < 0 || b[k] < 0) return; const dd = Math.abs(h - b[k]); s += Math.min(dd, 360 - dd); n++; });
        return { grados: +(s / Math.max(1, n)).toFixed(1), fase: flipEspectro.state().fase };
      };
      const W2 = 540, H2 = 960, narrow = EK.run(EK.scene('estrecho', W2, H2), W2, H2);
      const st = flipEspectro.state();
      return { ciclo0: turn(0), ciclo03: turn(0.3), ciclo1: turn(1), estrecho: EK.hues(narrow, [Math.round(0.15 * W2), Math.round(0.3 * H2), Math.round(0.85 * W2), Math.round(0.8 * H2)]), rango: [st.lo, st.hi] };
    });
    assert.ok(ciclo.ciclo03.grados > 25 && ciclo.ciclo1.grados > ciclo.ciclo03.grados && ciclo.ciclo0.grados < ciclo.ciclo03.grados * 0.5, 'CICLO hace girar el arcoíris en el tiempo: ' + JSON.stringify(ciclo));
    assert.ok(ciclo.estrecho.llenos >= 5 && ciclo.rango[0] > 0.45 && ciclo.rango[1] < 0.63, 'con la luz apretada entre 0,50 y 0,58 el rango se ajusta a ella y sigue usando todo el arcoíris: ' + JSON.stringify(ciclo));
    step('CICLO y normalización', ciclo);

    // ── 6 · Proporción en una foto grande ──
    const prop = await page.evaluate(() => {
      const src = EK.scene('salpicadura', 720, 1280);
      EK.run(src, 540, 960, { frames: 2 }); const a = flipEspectro.state();
      EK.run(src, 1080, 1920, { frames: 2, opts: { path: 'capture' } }); const b = flipEspectro.state();
      return { visor: [a.linea, a.lobulo, a.subportadora], foto: [b.linea, b.lobulo, b.subportadora] };
    });
    assert.ok(prop.foto.every((v, k) => Math.abs(v - 2 * prop.visor[k]) < 0.05), 'línea, lóbulo y subportadora miden el doble en la foto al doble: ' + JSON.stringify(prop));
    step('proporción en la foto', prop);

    // ── 7 · Sonido: los graves aceleran el giro; el golpe abre la clave ──
    const sonido = await page.evaluate(() => {
      const src = EK.scene('degradado', 540, 960);
      // (giro: vueltas de arcoíris acumuladas; se mide lo que avanza en el mismo segundo)
      const go = audio => { const g0 = flipEspectro.state().giro || 0; EK.run(src, 540, 960, { frames: 31, start: 9000, opts: { audio } }); const st = flipEspectro.state(); return { ...st, avance: +(st.giro - g0).toFixed(4) }; };
      const q = go(null), b = go({ bass: 1, mid: 0, treble: 0, beat: 0 }), g = go({ bass: 0, mid: 0, treble: 0, beat: 1 }), m = go({ bass: 0, mid: 1, treble: 0, beat: 0 });
      return { giroQuieto: q.avance, giroGraves: b.avance, claveQuieto: q.clave, claveGolpe: g.clave, vueltasQuieto: q.vueltas, vueltasMedios: m.vueltas };
    });
    assert.ok(sonido.giroGraves > sonido.giroQuieto * 2 && sonido.claveGolpe < sonido.claveQuieto && sonido.vueltasMedios > sonido.vueltasQuieto, 'los graves aceleran el giro, el golpe abre la clave y los medios suben las vueltas: ' + JSON.stringify(sonido));
    step('sonido', sonido);

    // ── 8 · Costo, foto grande, soltar y rehacer ──
    const costo = await page.evaluate(() => {
      const out = {};
      for (const [W, H] of [[540, 960], [1024, 576]]) {
        const src = EK.scene('cuarto', 1280, 720), c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        for (let i = 0; i < 5; i++) renderEspectro(src, 1280, 720, ctx, false, 'STD', { now: 50000 + i * 33.3 });
        ctx.getImageData(0, 0, 1, 1);
        const t0 = performance.now();
        for (let i = 0; i < 40; i++) renderEspectro(src, 1280, 720, ctx, false, 'STD', { now: 51000 + i * 33.3 });
        ctx.getImageData(0, 0, 1, 1);
        out[W + '×' + H] = +((performance.now() - t0) / 40).toFixed(2);
      }
      const big = document.createElement('canvas'); big.width = 2560; big.height = 1440;
      const okBig = renderEspectro(EK.scene('cuarto', 1280, 720), 1280, 720, big.getContext('2d'), false, 'STD', { path: 'capture', outW: 2560, outH: 1440, now: 60000 });
      const before = flipEspectro.state().gl;
      flipEspectro.release();
      const released = flipEspectro.state().gl;
      const again = renderEspectro(EK.scene('cuarto', 640, 360), 640, 360, document.createElement('canvas').getContext('2d'), false, 'STD', { now: 60100 });
      return { msPorCuadro: out, foto2560: okBig, suelta: [before, released, flipEspectro.state().gl, again] };
    });
    assert.ok(costo.foto2560, 'pinta una foto de 2560 × 1440');
    assert.deepEqual(costo.suelta, [true, false, true, true], 'la gráfica se suelta y se rehace al volver a pintar');
    assert.ok(Object.values(costo.msPorCuadro).every(ms => ms < 40), 'costo por cuadro razonable: ' + JSON.stringify(costo.msPorCuadro));
    step('costo, foto grande, soltar y rehacer', costo);

    // ── 9 · Hoja de contacto (con --shots) ──
    if (shots) {
      const sheet = await page.evaluate(() => {
        const W = 540, H = 960, names = ['salpicadura', 'cuarto', 'cara', 'degradado', 'estrecho'];
        const s = document.createElement('canvas'); s.width = W * names.length; s.height = H * 2;
        const g = s.getContext('2d');
        names.forEach((n, i) => { const src = EK.scene(n, W, H); g.drawImage(src, i * W, 0); g.drawImage(EK.run(src, W, H), i * W, H); });
        const big = EK.run(EK.scene('salpicadura', 1344, 1344), 1344, 1344, { frames: 4 });
        const l = EK.run(EK.scene('cuarto', 1024, 576), 1024, 576);
        return { hoja: s.toDataURL('image/png'), grande: big.toDataURL('image/png'), horizontal: l.toDataURL('image/png') };
      });
      saveDataUrl(path.join(shots, 'espectro-hoja.png'), sheet.hoja);
      saveDataUrl(path.join(shots, 'espectro-1344.png'), sheet.grande);
      saveDataUrl(path.join(shots, 'espectro-1024x576.png'), sheet.horizontal);
    }

    // ── 10 · En la app (si ya está registrada): la cámara en el visor y su foto ──
    const wired = await page.evaluate(() => typeof CAM_FAMILIES !== 'undefined' && !!CAM_FAMILIES.ESPECTRO);
    if (!wired) console.log('· (la app todavía no registra CAM_FAMILIES.ESPECTRO: el paso dentro de la app queda escrito y sin correr)');
    else {
      const app = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
      await app.page.evaluate(KIT);
      await pickCamera(app.page, 'ESPECTRO');
      await app.page.waitForFunction(() => camFamily === 'ESPECTRO' && flipEspectro.state().frames > 10, null, { timeout: 15000 });
      await app.page.waitForTimeout(600);
      const visor = await app.page.evaluate(() => ({ st: flipEspectro.state(), h: EK.hues(display) }));
      assert.ok(visor.st.gl && visor.h.n > 1000 && visor.h.llenos >= 4, 'el visor pinta con ESPECTRO: ' + JSON.stringify({ h: visor.h, ms: visor.st.ms }));
      if (shots) await app.page.screenshot({ path: path.join(shots, 'espectro-app.png') });
      const [download] = await Promise.all([app.page.waitForEvent('download', { timeout: 20000 }), app.page.locator('#deckShutter').click()]);
      const photo = await app.page.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
        const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; c.getContext('2d').drawImage(bitmap, 0, 0);
        return { size: [bitmap.width, bitmap.height], h: EK.hues(c) };
      }, fs.readFileSync(await download.path()).toString('base64'));
      if (shots) saveDataUrl(path.join(shots, 'espectro-foto.jpg'), 'data:image/jpeg;base64,' + fs.readFileSync(await download.path()).toString('base64'));
      assert.ok(photo.size[0] >= 540 && photo.h.llenos >= 4, 'la foto sale a su tamaño y con el arcoíris: ' + JSON.stringify(photo));
      step('en la app: visor y foto con ESPECTRO', { visor: visor.h, foto: photo });
      assert.deepEqual(app.errors, [], 'sin errores de página en la app: ' + app.errors.join(' | '));
      await app.context.close();
    }

    assert.deepEqual(errors, [], 'sin errores de página: ' + errors.join(' | '));
    console.log('\nESPECTRO: todo en orden');
  } finally { await browser.close(); }
})().catch(error => { console.error('\n✗ ' + (error && error.stack || error)); process.exit(1); });
