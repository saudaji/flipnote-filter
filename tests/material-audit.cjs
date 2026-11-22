// Auditoría material de todas las familias de cámara: una tabla por variante con
//   mono    correlación entre luminancia de entrada y de salida en la cuña de grises
//           (positiva y alta = la imagen conserva la polaridad y el orden tonal)
//   niveles pasos de la cuña de 16 grises que la salida distingue
//   rango   luminancia de salida para negro y blanco
//   blanco  desviación dentro de un campo blanco (suciedad sin motivo)
//   pegado  cambio en una zona quieta mientras otro objeto se mueve (la trama no nada)
//   export  correlación visor ↔ exportación en alta, a tamaño de visor
//   Δmedia  diferencia de nivel medio visor ↔ exportación
//   ms      mediana de render por cuadro en esta máquina
//   FLIP_URL=http://127.0.0.1:8760 node tests/material-audit.cjs [--json salida.json] [--strict]
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { launch, openFlip } = require('./lib/harness.cjs');

const CADENCE = { DSI: 8, STAMP: 24, AUTO03: 30, DLPHN: 24, CASKIA: 15, VFD: 30, OSCAM: 30 };
const VARIANTS = [
  ['DSI', 'STD'], ['DSI', 'LGCY'], ['STAMP', 'ENGR'], ['STAMP', 'INK'], ['STAMP', 'ISSUE'],
  ['AUTO03', 'DAY'], ['AUTO03', 'FLASH'], ['AUTO03', 'NIGHT'], ['DLPHN', 'STD'], ['DLPHN', 'LGCY'],
  ['CASKIA', 'STD'], ['CASKIA', 'E-INK'], ['CASKIA', 'SEIKO'], ['VFD', 'STD'], ['VFD', 'THRML'], ['VFD', 'CRT'],
];

async function main() {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser);
    const rows = [];
    for (const [family, variant] of VARIANTS) {
      rows.push(await page.evaluate(async ({ family, variant, fps }) => {
        FlipKit.hold();
        FlipKit.select(family, variant);
        let base = (window.__auditClock = (window.__auditClock || 0) + 500000);
        const settle = (scene, frames, options, each) => {
          base += 5000;
          for (let i = 0; i < frames; i++) { FlipKit.frame(scene, i / fps, base + i * 1000 / fps, options); if (each) each(i); }
        };
        const frame = stampFrameMode === 'ON' && family === 'STAMP' ? 0.1 : 0;   // margen del marco postal
        const inner = (x, y, w, h) => [frame + x * (1 - 2 * frame), frame + y * (1 - 2 * frame), w * (1 - 2 * frame), h * (1 - 2 * frame)];
        const row = { family, variant };
        // Cuña de 16 grises (tercio inferior de la escena ramp).
        const ms = [];
        base += 5000;
        for (let i = 0; i < 24; i++) {
          const src = FlipKit.paint('ramp', i / fps, null);
          const t0 = performance.now();
          _renderCamEngineFrame(src, src.width, src.height, ctxD, false, { path: 'preview', now: base + i * 1000 / fps });
          ctxD.getImageData(0, 0, 1, 1);
          if (i > 5) ms.push(performance.now() - t0);
        }
        ms.sort((a, b) => a - b);
        row.ms = ms[ms.length >> 1];
        const steps = [];
        for (let i = 0; i < 16; i++) steps.push(FlipKit.stats(display, inner((i + 0.25) / 16, 0.72, 0.5 / 16, 0.22)).mean);
        const input = steps.map((_, i) => i * 255 / 15);
        row.mono = FlipKit.correlation(Float32Array.from(input), Float32Array.from(steps));
        let levels = 1;
        for (let i = 1; i < 16; i++) if (Math.abs(steps[i] - steps[i - 1]) > 2.5) levels++;
        row.levels = levels; row.black = steps[0]; row.white = steps[15];
        // Campo blanco: lo que no es imagen no debe ensuciarse.
        settle('flat', 12, { value: 255 });
        row.whiteStd = FlipKit.stats(display, inner(0.2, 0.2, 0.6, 0.6)).std;
        // Trama pegada al material: zona quieta mientras una mano saluda en otra parte.
        const still = [];
        settle('handWave', 24, null, i => { if (i >= 12) still.push(FlipKit.luma(display, inner(0.02, 0.04, 0.12, 0.2), [32, 32])); });
        let moved = 0;
        for (let k = 1; k < still.length; k++) { let d = 0; for (let p = 0; p < still[k].length; p++) d += Math.abs(still[k][p] - still[k - 1][p]); moved = Math.max(moved, d / still[k].length); }
        row.stick = moved;
        // Visor frente a exportación en alta.
        settle('portrait', 16, null);
        // Se compara punto a punto en la rejilla del dispositivo: un tramado de 1 bit no admite otra escala.
        const visor = FlipKit.luma(display, null, [DSI_W, DSI_H]);
        const visorMean = FlipKit.stats(display).mean;
        const shot = FlipKit.exportFrame('portrait', 15 / fps, base + 15 * 1000 / fps, null, 'high');
        row.exportSize = shot.width + 'x' + shot.height;
        row.exportCorr = FlipKit.correlation(visor, FlipKit.luma(shot, null, [DSI_W, DSI_H]));
        row.exportDelta = FlipKit.stats(shot).mean - visorMean;
        return row;
      }, { family, variant, fps: CADENCE[family] }));
    }
    const fmt = (v, d = 2) => typeof v === 'number' ? v.toFixed(d) : v;
    console.log('familia variante |  mono niveles negro blanco | blanco σ | pegado | export Δmedia |   ms');
    for (const r of rows) {
      console.log(`${r.family.padEnd(7)} ${r.variant.padEnd(6)}  | ${fmt(r.mono).padStart(5)} ${String(r.levels).padStart(5)}   ${fmt(r.black, 0).padStart(4)}  ${fmt(r.white, 0).padStart(4)}  |  ${fmt(r.whiteStd).padStart(6)} | ${fmt(r.stick).padStart(6)} | ${fmt(r.exportCorr).padStart(5)} ${fmt(r.exportDelta, 1).padStart(6)} | ${fmt(r.ms, 1).padStart(5)}`);
    }
    const at = process.argv.indexOf('--json');
    if (at >= 0) fs.writeFileSync(process.argv[at + 1], JSON.stringify(rows, null, 1));
    if (process.argv.includes('--strict')) {
      for (const r of rows) {
        const id = r.family + ' ' + r.variant;
        // THRML y CRT son de falso color: su luminancia no es monótona por diseño.
        if (id !== 'VFD THRML' && id !== 'VFD CRT') assert.ok(r.mono > 0.85, id + ': orden tonal ' + r.mono);
        assert.ok(r.levels >= 3, id + ': niveles ' + r.levels);
        assert.ok(r.exportCorr > 0.9, id + ': visor frente a exportación ' + r.exportCorr);
        assert.ok(Math.abs(r.exportDelta) < 14, id + ': nivel de la exportación ' + r.exportDelta);
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS · material audit (' + rows.length + ' variantes)');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
