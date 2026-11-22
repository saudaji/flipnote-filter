// Rendimiento del visor en uso sostenido, con el bucle real de la cámara.
// Mide por variante: ms de render por cuadro (mediana y p95), cuadros por segundo frente a la
// cadencia pedida y tirones (intervalos de pantalla > 50 ms). Repite con la CPU frenada ×4
// para acercarse a un teléfono. No sustituye a una medición en el dispositivo.
//   FLIP_URL=http://127.0.0.1:8760 node tests/alpha-performance.cjs [--json salida.json] [--seconds 5] [--soak 45]
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { launch, openFlip, PIXEL } = require('./lib/harness.cjs');

const arg = (name, fallback) => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : fallback; };
const seconds = Number(arg('--seconds', 5)), soak = Number(arg('--soak', 45));

async function main() {
  const browser = await launch();
  try {
    const { context, page, errors } = await openFlip(browser, { sceneCamera: { scene: 'room', w: 1280, h: 720, freeze: 2 } });
    const cdp = await context.newCDPSession(page);
    await page.evaluate(() => {
      const perf = window.__perf = { render: [], raf: [], last: 0 };
      const original = _renderCamEngineFrame;
      _renderCamEngineFrame = function (...args) {
        const begin = performance.now();
        const result = original.apply(this, args);
        if (args[5] && args[5].path === 'preview') perf.render.push(performance.now() - begin);
        return result;
      };
      const tick = now => { if (perf.last) perf.raf.push(now - perf.last); perf.last = now; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const variants = await page.evaluate(() => Object.entries(CAM_FAMILIES).flatMap(([family, cfg]) => cfg.variants.map(v => [family, v.id, v.label])));
    const sample = async (family, variant, ms) => {
      await page.evaluate(([f, v]) => { _setCamFamily(f); camVariant = v; _applyCamState(); }, [family, variant]);
      await page.waitForTimeout(700);
      await page.evaluate(() => { __perf.render.length = 0; __perf.raf.length = 0; });
      await page.waitForTimeout(ms);
      return page.evaluate(ms => {
        const sort = list => Float64Array.from(list).sort();
        const render = sort(__perf.render), raf = sort(__perf.raf);
        const at = (list, q) => list.length ? list[Math.min(list.length - 1, Math.floor(q * list.length))] : 0;
        return {
          target: camFpsTarget, fps: +(render.length / (ms / 1000)).toFixed(1),
          median: +at(render, 0.5).toFixed(2), p95: +at(render, 0.95).toFixed(2), worst: +at(render, 1).toFixed(1),
          rafP95: +at(raf, 0.95).toFixed(1), jank: __perf.raf.filter(d => d > 50).length,
        };
      }, ms);
    };
    const rows = [];
    for (const rate of [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      for (const [family, variant, label] of variants) {
        if (family === 'SLHT') continue;   // depende de un modelo en red; se mide aparte
        rows.push({ rate, family, variant: label, ...(await sample(family, variant, seconds * 1000)) });
      }
    }
    // Uso sostenido: la variante más cara, con la CPU frenada, vigilando deriva de tiempo y memoria.
    const heavy = rows.filter(r => r.rate === 4).sort((a, b) => b.median - a.median)[0];
    const heavyId = variants.find(v => v[0] === heavy.family && v[2] === heavy.variant);
    await page.evaluate(([f, v]) => { _setCamFamily(f); camVariant = v; _applyCamState(); }, heavyId);
    await page.waitForTimeout(800);
    const memory = () => page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
    const heapStart = await memory();
    const first = await sample(heavyId[0], heavyId[1], Math.min(10000, soak * 500));
    await page.waitForTimeout(Math.max(0, soak * 1000 - 20000));
    const last = await sample(heavyId[0], heavyId[1], Math.min(10000, soak * 500));
    const heapEnd = await memory();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    const environment = {
      machine: os.cpus()[0].model + ' · ' + os.cpus().length + ' núcleos', browser: await browser.version(),
      emulation: `Pixel 9 · ${PIXEL.viewport.width}×${PIXEL.viewport.height} CSS px @${PIXEL.deviceScaleFactor}`,
      sensor: 'simulado · 1280×720 · escena room congelada', visor: await page.evaluate(() => display.width + '×' + display.height),
    };
    console.log(JSON.stringify(environment));
    console.log('CPU  familia variante | cadencia  fps | mediana   p95  peor | pantalla p95 tirones');
    for (const r of rows) {
      console.log(`×${r.rate}   ${r.family.padEnd(7)} ${r.variant.padEnd(7)} |   ${String(r.target).padStart(3)}  ${String(r.fps).padStart(5)} | ${String(r.median).padStart(6)} ${String(r.p95).padStart(6)} ${String(r.worst).padStart(5)} |    ${String(r.rafP95).padStart(6)}  ${String(r.jank).padStart(4)}`);
    }
    console.log(`sostenido ×4 · ${heavy.family} ${heavy.variant} · ${soak} s · mediana ${first.median} → ${last.median} ms · p95 ${first.p95} → ${last.p95} ms · fps ${first.fps} → ${last.fps} · memoria ${heapStart} → ${heapEnd} MB`);
    const json = arg('--json');
    if (json) fs.writeFileSync(json, JSON.stringify({ environment, rows, soak: { variant: heavy.family + ' ' + heavy.variant, seconds: soak, first, last, heapStart, heapEnd } }, null, 1));
    // Guardas de regresión en esta máquina, sin frenar: ningún motor se come el cuadro.
    for (const r of rows.filter(r => r.rate === 1)) {
      assert.ok(r.median < 14, `${r.family} ${r.variant}: mediana ${r.median} ms`);
      assert.ok(r.fps > r.target * 0.85, `${r.family} ${r.variant}: ${r.fps} fps de ${r.target}`);
    }
    assert.ok(last.median < first.median * 1.35 + 1, 'el tiempo por cuadro no deriva en uso sostenido');
    if (heapStart !== null) assert.ok(heapEnd - heapStart < 60, 'la memoria no crece sin control: ' + (heapEnd - heapStart) + ' MB');
    assert.deepEqual(errors, []);
    console.log('PASS · alpha performance');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
