// Regresión de OSCAM · VECTOR: geometría del trazo, estabilidad y fósforo.
//   FLIP_URL=http://127.0.0.1:8760 node tests/vector-beam.cjs [--print]
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip } = require('./lib/harness.cjs');

async function main() {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser);
    const m = await page.evaluate(() => {
      FlipKit.hold();
      FlipKit.select('OSCAM', 'STD');
      let base = 0;
      const scope = () => opticalScopes.get(ctxD).vector;
      const run = (scene, frames, options, each) => {
        base += 100000;   // un salto de reloj reinicia el fósforo entre pruebas
        for (let i = 0; i < frames; i++) {
          FlipKit.frame(scene, i / 30, base + i * 1000 / 30, options);
          if (each) each(i, scope());
        }
        return scope();
      };
      const out = {};
      // 1 · Círculo: un solo trazo cerrado, redondo y sin línea doble.
      let V = run('circle', 20);
      const { cols, rows } = V;
      const main = V.chains[0];
      const cx = 0.5 * (cols - 1), cy = 0.5 * (rows - 1), r = 0.3 * (rows - 1);
      let sq = 0, worst = 0;
      for (let i = 0; i < main.points.length; i += 2) {
        const d = Math.hypot(main.points[i] - cx, main.points[i + 1] - cy) - r;
        sq += d * d; worst = Math.max(worst, Math.abs(d));
      }
      out.circleChains = V.chains.length; out.circleClosed = main.closed;
      out.circleRms = Math.sqrt(sq / (main.points.length / 2)) / r; out.circleWorst = worst / r;
      out.circleLength = main.length / (2 * Math.PI * r);
      // 2 · Diagonal de bajo contraste (118 frente a 136 de 255): continua y recta.
      V = run('diagonal', 20);
      const ax = 0.1 * (cols - 1), ay = 0.9 * (rows - 1), bx = 0.9 * (cols - 1), by = 0.1 * (rows - 1);
      const all = V.chains.flatMap(c => { const q = []; for (let i = 0; i < c.points.length; i += 2) q.push([c.points[i], c.points[i + 1]]); return q; });
      let covered = 0, off = 0, on = 0;
      for (let k = 0; k <= 100; k++) {
        const t = 0.06 + 0.88 * k / 100, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        if (all.some(q => Math.hypot(q[0] - x, q[1] - y) < 1.5)) covered++;
      }
      const len = Math.hypot(bx - ax, by - ay);
      for (const q of all) {
        const t = ((q[0] - ax) * (bx - ax) + (q[1] - ay) * (by - ay)) / (len * len);
        if (t < 0.06 || t > 0.94) continue;
        const d = Math.abs((q[0] - ax) * (by - ay) - (q[1] - ay) * (bx - ax)) / len;
        if (d < 4) { off += d * d; on++; }
      }
      out.diagonalCovered = covered / 101; out.diagonalRms = Math.sqrt(off / Math.max(1, on));
      // 3 · Dos objetos: dos trazos y nada encendido entre ellos (el haz salta apagado).
      V = run('two', 20);
      out.twoChains = V.chains.length; out.twoClosed = V.chains.every(c => c.closed);
      out.gapMax = FlipKit.stats(display, [0.46, 0.1, 0.13, 0.8]).max;
      out.traceMax = FlipKit.stats(display, [0.1, 0.25, 0.3, 0.5]).max;
      // Punto de permanencia: la esquina del cuadrado recibe más luz que el centro de un lado.
      const sum = rect => { const s = FlipKit.stats(display, rect); return s.mean; };
      out.cornerOverEdge = sum([0.62 - 0.012, 0.3 - 0.016, 0.024, 0.032]) / sum([0.74 - 0.012, 0.3 - 0.016, 0.024, 0.032]);
      // 4 · Objeto quieto con ruido de sensor: el contorno no hierve.
      let previous = null, drift = 0, pairs = 0, lengths = [], counts = [], start = [], flicker = 0, lastLuma = null;
      run('cupNoise', 45, null, (i, S) => {
        if (i < 15) return;
        const pts = S.chains.flatMap(c => { const q = []; for (let k = 0; k < c.points.length; k += 2) q.push([c.points[k], c.points[k + 1]]); return q; });
        lengths.push(S.total); counts.push(S.chains.length); start.push([S.chains[0].points[0], S.chains[0].points[1]]);
        if (previous) for (const q of pts) { let best = 99; for (const o of previous) { const d = Math.hypot(q[0] - o[0], q[1] - o[1]); if (d < best) best = d; } drift += best; pairs++; }
        previous = pts;
        const luma = FlipKit.luma(display, null, [128, 96]);
        if (lastLuma) { let d = 0; for (let p = 0; p < luma.length; p++) d += Math.abs(luma[p] - lastLuma[p]); flicker = Math.max(flicker, d / luma.length); }
        lastLuma = luma;
      });
      out.noiseDrift = drift / pairs;
      out.noiseLength = (Math.max(...lengths) - Math.min(...lengths)) / Math.max(...lengths);
      out.noiseCounts = [Math.min(...counts), Math.max(...counts)];
      out.noiseStart = Math.max(...start.map(q => Math.hypot(q[0] - start[0][0], q[1] - start[0][1])));
      out.noiseFlicker = flicker;
      // 5 · Entra y sale: responde en el mismo cuadro y el fósforo se apaga solo.
      const below = [0, 0.12, 1, 0.88];   // deja fuera el rótulo del modo
      const idle = FlipKit.stats(FlipKit.frame('enterExit', 0, (base += 100000), null), below).max;
      const seenAt = {};
      run('enterExit', 100, null, (i, S) => {
        const t = i / 30;
        if (i === 45) {
          const discX = (-0.2 * 479 + (639 + 0.4 * 479) * (t - 0.5) / 2) / 639 * (S.cols - 1);
          const c = S.chains[0]; let mx = 0; for (let k = 0; k < c.points.length; k += 2) mx += c.points[k]; mx /= c.points.length / 2;
          out.trackError = Math.abs(mx - discX) / (S.cols - 1);
        }
        if (i === 76 || i === 78 || i === 90) seenAt[i] = { max: FlipKit.stats(display, below).max, chains: S.chains.length };
      });
      out.idleMax = idle; out.afterExit = seenAt;
      return out;
    });
    const round = v => typeof v === 'number' ? +v.toFixed(4) : v;
    const table = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v)]));
    if (process.argv.includes('--print')) console.log(JSON.stringify(table, null, 1));
    assert.equal(m.circleChains, 1, 'el círculo es un solo trazo');
    assert.ok(m.circleClosed && m.circleRms < 0.012 && m.circleWorst < 0.03, 'redondez ' + m.circleRms + ' / ' + m.circleWorst);
    assert.ok(Math.abs(m.circleLength - 1) < 0.03, 'longitud del círculo ' + m.circleLength);
    assert.ok(m.diagonalCovered > 0.97 && m.diagonalRms < 0.5, 'diagonal ' + m.diagonalCovered + ' / ' + m.diagonalRms);
    assert.ok(m.twoChains === 2 && m.twoClosed, 'dos objetos, dos trazos cerrados');
    assert.ok(m.gapMax < 75 && m.traceMax > 200, 'sin puente luminoso: ' + m.gapMax);
    assert.ok(m.cornerOverEdge > 1.04, 'punto de permanencia en la esquina ' + m.cornerOverEdge);
    assert.ok(m.noiseDrift < 0.2 && m.noiseLength < 0.03 && m.noiseStart < 1.5, 'contorno estable ' + JSON.stringify([m.noiseDrift, m.noiseLength, m.noiseStart]));
    assert.equal(m.noiseCounts[0], m.noiseCounts[1], 'mismo número de trazos con ruido');
    assert.ok(m.noiseFlicker < 1.5, 'brillo estable ' + m.noiseFlicker);
    assert.ok(m.trackError < 0.02, 'respuesta al movimiento ' + m.trackError);
    assert.ok(m.afterExit[76].max > m.idleMax + 25, 'queda fósforo justo al salir');
    assert.ok(m.afterExit[90].max <= m.idleMax + 2 && m.afterExit[90].chains === 0, 'el fósforo se apaga: ' + m.afterExit[90].max + ' vs ' + m.idleMax);
    assert.deepEqual(errors, []);
    console.log('PASS · vector beam', JSON.stringify(table));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
