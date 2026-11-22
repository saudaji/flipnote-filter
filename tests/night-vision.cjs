// Regresión de AUTO 03 · NIGHT. Escena fija (tests/scenes.js → room), sin cámara real:
//   FLIP_URL=http://127.0.0.1:8760 node tests/night-vision.cjs [--print]
// Comprueba que NIGHT se construye desde la luz: rostro legible en penumbra, negro
// profundo, lámpara reconocible, señal monocroma teñida, obturador lento en la oscuridad
// y que la exportación conserva lo que muestra el visor.
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip } = require('./lib/harness.cjs');

async function main() {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser);
    const m = await page.evaluate(async () => {
      FlipKit.hold();
      const R = FlipScenes.ROOM;
      const face = [R.face[0] - 0.06, R.face[1] - 0.115, 0.12, 0.23];
      const bulb = [R.lamp[0] - 0.012, R.lamp[1] - 0.016, 0.024, 0.032];
      const corner = [0.9, 0.86, 0.09, 0.12];
      const run = (variant, scene, frames, options, each) => {
        FlipKit.select('AUTO03', variant);
        _resetCamEngineState();
        for (let i = 0; i < frames; i++) {
          FlipKit.frame(scene, i / 30, 5000 + i * 1000 / 30, options);
          if (each) each(i);
        }
        return display;
      };
      // Verdad de referencia: la misma habitación con la luz encendida y sin ruido.
      const truth = FlipKit.luma(FlipKit.paint('roomLit', 2, { noise: false, hand: false }), face, [36, 48]);
      const input = FlipKit.luma(FlipKit.paint('room', 2, { hand: false }), face, [36, 48]);
      const out = {};
      out.inputLegibility = FlipKit.correlation(truth, input);
      out.inputFace = FlipKit.stats(FlipKit.paint('room', 2, { hand: false }), face).mean;

      run('DAY', 'room', 30, { hand: false });
      out.dayFace = FlipKit.stats(display, face).mean;
      out.dayLegibility = FlipKit.correlation(truth, FlipKit.luma(display, face, [36, 48]));
      const dayBooks = [FlipKit.stats(display, [0.05, 0.12, 0.022, 0.06]), FlipKit.stats(display, [0.085, 0.1, 0.022, 0.08])];
      out.dayHueSpread = Math.abs(dayBooks[0].r / dayBooks[0].g - dayBooks[1].r / dayBooks[1].g);

      run('NIGHT', 'room', 60, { hand: false });
      const night = nightVision.snapshot(ctxD);
      out.gain = night.gain; out.exposure = night.exposure;
      const f = FlipKit.stats(display, face);
      out.face = f.mean; out.faceRG = f.r / f.g; out.faceBG = f.b / f.g;
      out.legibility = FlipKit.correlation(truth, FlipKit.luma(display, face, [36, 48]));
      const c = FlipKit.stats(display, corner);
      out.corner = c.mean; out.cornerP95 = c.p95;
      const b = FlipKit.stats(display, bulb);
      out.bulb = b.mean; out.bulbRG = b.r / b.g;
      const whole = FlipKit.stats(display);
      out.p5 = whole.p5; out.p50 = whole.p50; out.p95 = whole.p95;
      const center = FlipKit.stats(display, [0.4, 0.4, 0.2, 0.2]).mean;
      out.centerOverCorner = center / Math.max(1, c.mean);
      const books = [FlipKit.stats(display, [0.05, 0.12, 0.022, 0.06]), FlipKit.stats(display, [0.085, 0.1, 0.022, 0.08])];
      out.hueSpread = Math.abs(books[0].r / books[0].g - books[1].r / books[1].g);
      // Smear: la columna de la lámpara, lejos de ella, frente a una columna vecina.
      const below = FlipKit.stats(display, [R.lamp[0] - 0.01, 0.9, 0.02, 0.08]).mean;
      const beside = FlipKit.stats(display, [R.lamp[0] + 0.1, 0.9, 0.02, 0.08]).mean;
      out.smear = below - beside;
      // Ruido temporal en una zona plana de la pared (mismo punto, cuadros sucesivos).
      const wall = [0.5, 0.05, 0.05, 0.05];
      const samples = [];
      run('NIGHT', 'room', 70, { hand: false }, i => { if (i >= 40) samples.push(FlipKit.luma(display, wall, [8, 8])); });
      let variance = 0;
      for (let p = 0; p < 64; p++) {
        let mean = 0; for (const s of samples) mean += s[p]; mean /= samples.length;
        let v = 0; for (const s of samples) v += (s[p] - mean) ** 2; variance += v / samples.length / 64;
      }
      out.wallNoise = Math.sqrt(variance);
      out.wallLevel = FlipKit.stats(display, wall).mean;

      // Sin lámpara: la misma habitación a oscuras sube la ganancia y no deja smear.
      run('NIGHT', 'room', 60, { hand: false, lamp: false });
      out.darkGain = nightVision.snapshot(ctxD).gain; out.darkExposure = nightVision.snapshot(ctxD).exposure;
      out.darkSmear = FlipKit.stats(display, [R.lamp[0] - 0.01, 0.9, 0.02, 0.08]).mean - FlipKit.stats(display, [R.lamp[0] + 0.1, 0.9, 0.02, 0.08]).mean;
      out.darkFace = FlipKit.stats(display, face).mean;
      out.darkLegibility = FlipKit.correlation(truth, FlipKit.luma(display, face, [36, 48]));

      // Persistencia: en la oscuridad el visor se actualiza al ritmo del obturador lento.
      const hand = [R.hand[0] - 0.14, R.hand[1] - 0.2, 0.28, 0.36];
      let updates = 0, previous = null;
      run('NIGHT', 'room', 60, { lamp: false }, i => {
        if (i < 30) return;
        const now = FlipKit.luma(display, hand, [24, 24]);
        if (previous) { let d = 0; for (let p = 0; p < now.length; p++) d += Math.abs(now[p] - previous[p]); if (d / now.length > 0.6) updates++; }
        previous = now;
      });
      out.darkUpdates = updates;
      updates = 0; previous = null;
      run('NIGHT', 'roomLit', 60, {}, i => {
        if (i < 30) return;
        const now = FlipKit.luma(display, hand, [24, 24]);
        if (previous) { let d = 0; for (let p = 0; p < now.length; p++) d += Math.abs(now[p] - previous[p]); if (d / now.length > 0.6) updates++; }
        previous = now;
      });
      out.litUpdates = updates;
      out.litGain = nightVision.snapshot(ctxD).gain; out.litExposure = nightVision.snapshot(ctxD).exposure;

      // Exportación: misma escena por la ruta de foto en alta, comparada a tamaño de visor.
      run('NIGHT', 'room', 60, { hand: false });
      const visor = FlipKit.luma(display, null, [128, 96]);
      const still = nightVision.snapshot(ctxD);
      const src = FlipKit.paint('room', 59 / 30, { hand: false });
      const canvas = document.createElement('canvas');
      const dims = _getFlipRecordDimensions(display, { aspectRatio: _getCurrentAspectId(), resolution: 'high' });
      canvas.width = dims.width; canvas.height = dims.height;
      _renderCamEngineFrame(src, src.width, src.height, canvas.getContext('2d'), false, {
        family: 'AUTO03', variant: 'NIGHT', path: 'capture', now: 9000, resolution: 'high', outW: dims.width, outH: dims.height, still,
      });
      out.exportSize = [canvas.width, canvas.height];
      out.exportCorrelation = FlipKit.correlation(visor, FlipKit.luma(canvas, null, [128, 96]));
      out.exportFace = FlipKit.stats(canvas, face).mean;
      out.visorFace = FlipKit.stats(display, face).mean;
      // Escala del grano: energía de alta frecuencia de la pared, a tamaño de visor en ambos.
      const grain = cv => { const l = FlipKit.luma(cv, [0.5, 0.02, 0.2, 0.15], [51, 29]); let e = 0, k = 0; for (let y = 0; y < 29; y++) for (let x = 1; x < 51; x++) { e += Math.abs(l[y * 51 + x] - l[y * 51 + x - 1]); k++; } return e / k; };
      out.visorGrain = grain(display); out.exportGrain = grain(canvas);
      return out;
    });
    const round = v => Array.isArray(v) ? v : +(+v).toFixed(3);
    const table = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v)]));
    if (process.argv.includes('--print')) console.log(table);
    // Rostro legible en penumbra: se parece más a la escena iluminada que la propia entrada y que DAY.
    assert.ok(m.legibility > 0.8 && m.legibility > m.dayLegibility - 0.02, 'legibilidad del rostro ' + m.legibility);
    assert.ok(m.face > 70 && m.face < 175, 'nivel del rostro ' + m.face);
    assert.ok(m.face > m.dayFace * 1.6, 'NIGHT abre la penumbra respecto a DAY');
    // Negro con profundidad y punto caliente.
    assert.ok(m.corner > 2 && m.corner < 30, 'negro de esquina ' + m.corner);
    assert.ok(m.p5 < 22 && m.p50 < 110, 'reparto tonal ' + m.p5 + '/' + m.p50);
    assert.ok(m.centerOverCorner > 3, 'punto caliente ' + m.centerOverCorner);
    // Lámpara: núcleo pálido casi blanco y smear vertical que desaparece sin lámpara.
    assert.ok(m.bulb > 225 && m.bulbRG > 0.86, 'núcleo de la lámpara ' + m.bulb + ' R/G ' + m.bulbRG);
    assert.ok(m.smear > 3 && m.smear < 40 && Math.abs(m.darkSmear) < 2.5, 'smear ' + m.smear + ' / ' + m.darkSmear);
    // Monocromo teñido de azul verdoso: sin restos del color de la escena.
    assert.ok(m.faceRG > 0.55 && m.faceRG < 0.76 && m.faceBG > 0.9 && m.faceBG < 1.08, 'tinte ' + m.faceRG + ' ' + m.faceBG);
    assert.ok(m.hueSpread < 0.04 && m.dayHueSpread > 0.3, 'pérdida de color ' + m.hueSpread);
    // AGC y obturador lento.
    assert.ok(m.darkGain > m.gain * 1.3, 'la lámpara baja la ganancia');
    assert.ok(m.darkExposure >= 60 && m.litExposure === 0, 'obturador lento solo a oscuras');
    assert.ok(m.darkUpdates <= 16 && m.litUpdates >= 27, 'cadencia ' + m.darkUpdates + ' / ' + m.litUpdates);
    assert.ok(m.wallNoise > 1 && m.wallNoise < 9, 'ruido ' + m.wallNoise);
    // La foto conserva exposición, estructura y escala de grano del visor.
    assert.deepEqual(m.exportSize, [1440, 1080]);
    assert.ok(m.exportCorrelation > 0.9, 'visor frente a foto ' + m.exportCorrelation);
    assert.ok(Math.abs(m.exportFace - m.visorFace) < 10, 'nivel del rostro en la foto');
    assert.ok(m.exportGrain / m.visorGrain > 0.6 && m.exportGrain / m.visorGrain < 1.6, 'escala del grano ' + m.exportGrain / m.visorGrain);
    assert.deepEqual(errors, []);
    console.log('PASS · night vision', JSON.stringify(table));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
