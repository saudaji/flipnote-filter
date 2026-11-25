// STAGE · sincronía por sonido: dos aparatos que oyen la misma música, sin conexión entre ellos,
// coinciden en el tempo, en el golpe y además en el NÚMERO de pulso (módulo 64), para que los LFO
// a tempo y todo lo que va por compás caiga a la par. Uno de los dos lleva el reloj 70 ms adelantado,
// como pasa entre dos teléfonos de verdad.
//   FLIP_URL=http://127.0.0.1:8760 node tests/sync.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, openModule } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

async function device(browser, skewMs) {
  const { page, context, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 }, boot: false });
  // la hora de este aparato, con su error; la música se programa con la hora de verdad
  await page.evaluate(skew => { const real = Date.now.bind(Date); window.__real = real; Date.now = () => real() + skew; }, skewMs);
  await page.locator('#btnSplashOriginal').click();
  await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
  await openModule(page, 'stage');
  await page.waitForFunction(() => window.flipStage && flipStage.active && flipStage.status().ok, null, { timeout: 15000 });
  await page.evaluate(() => { localStorage.removeItem('flip.stage.v3'); flipStage.reset(); });
  return { page, context, errors };
}
// La misma canción (bombo a 128) sonando «en la sala»: los golpes caen en los mismos instantes para los dos.
const music = page => page.evaluate(() => flipStage.audio.use(ctx => {
  const rate = ctx.sampleRate, beat = 60 / 128, n = Math.round(rate * beat * 32);
  const buffer = ctx.createBuffer(1, n, rate), d = buffer.getChannelData(0);
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / rate, tb = t % beat, th = (t + beat / 2) % beat;
    d[i] = Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-tb * 28)) * tb) * Math.exp(-tb * 9) * .9 + noise() * Math.exp(-th * 60) * .18 + Math.sin(2 * Math.PI * 440 * t) * .05;
  }
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  source.buffer = buffer; source.loop = true; gain.gain.value = .5;
  source.connect(gain);
  const now = window.__real() / 1000, grid = beat * 4, wait = Math.ceil((now + .3) / grid) * grid - now;      // arranca en una rejilla de hora real
  source.start(ctx.currentTime + wait);
  return gain;
}));
const read = page => page.evaluate(() => { const s = flipStage.status(); return { beat: s.beat, at: window.__real(), bpm: s.audio.bpm, source: s.bpmSource, sync: s.sync, beats: s.audio.beats }; });

(async () => {
  const browser = await launch();
  try {
    const a = await device(browser, 0), b = await device(browser, 70);
    await a.page.waitForTimeout(1700);            // el segundo aparato llega más tarde: sus relojes de compás arrancan distintos
    await music(a.page);
    await b.page.waitForTimeout(900);
    await music(b.page);
    await a.page.waitForTimeout(13000);
    const [ra, rb] = await Promise.all([read(a.page), read(b.page)]);
    assert.equal(ra.source, 'AUTO'); assert.equal(rb.source, 'AUTO');
    assert.ok(Math.abs(ra.bpm - 128) < 3 && Math.abs(rb.bpm - 128) < 3, 'los dos sacan el tempo: ' + ra.bpm + ' / ' + rb.bpm);
    assert.ok(ra.sync.locked && rb.sync.locked, 'los dos numeran los pulsos: ' + JSON.stringify([ra.sync, rb.sync]));
    // mismo instante → mismo pulso: se descuenta lo que pasó entre las dos lecturas
    const diff = ra.beat - rb.beat - (ra.at - rb.at) / 60000 * 128;
    const wrapped = ((diff % 64) + 96) % 64 - 32;
    assert.ok(Math.abs(wrapped) < .3, 'coinciden en el número de pulso (módulo 64): diferencia ' + wrapped.toFixed(3) + ' pulsos');
    step('dos aparatos, solo por el sonido, van en el mismo pulso', { tempo: [+ra.bpm.toFixed(1), +rb.bpm.toFixed(1)], diferencia: +wrapped.toFixed(3), relojDesfasado: '70 ms' });

    // Y lo mantienen medio minuto de música después.
    await a.page.waitForTimeout(9000);
    const [rc, rd] = await Promise.all([read(a.page), read(b.page)]);
    const later = (((rc.beat - rd.beat - (rc.at - rd.at) / 60000 * 128) % 64) + 96) % 64 - 32;
    assert.ok(Math.abs(later) < .3, 'siguen juntos: ' + later.toFixed(3));
    assert.deepEqual([...a.errors, ...b.errors], [], 'sin errores');
    step('y siguen juntos', { diferencia: +later.toFixed(3) });
    console.log('SYNC PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
