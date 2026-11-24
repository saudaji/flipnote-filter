// La página de entrada (docs/hola/): lo que tiene que seguir siendo verdad.
//   · carga sus tipografías e imágenes, sin errores y sin nada que no exista;
//   · no se desborda de lado en un teléfono angosto ni en uno ancho;
//   · sus puertas llevan a la app; la tecla Instalar solo aparece cuando el navegador la ofrece;
//   · el logo vive (en bucle) y la película tiene portada y no arranca sola con sonido.
//   FLIP_URL=http://127.0.0.1:8760 node tests/landing.cjs [--shots carpeta]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./lib/harness.cjs');

const at = process.argv.indexOf('--shots');
const shots = at >= 0 ? path.resolve(process.argv[at + 1]) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const BASE = (process.env.FLIP_URL || 'http://127.0.0.1:8760').replace(/\/$/, '');

(async () => {
  const browser = await launch();
  try {
    for (const [name, width, height] of [['angosto', 360, 740], ['telefono', 412, 915], ['escritorio', 1280, 800]]) {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [], failed = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
      await page.goto(BASE + '/hola/index.html');
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(async () => { for (const img of document.images) { img.loading = 'eager'; if (!img.complete) await new Promise(done => { img.onload = img.onerror = done; }); } });
      const state = await page.evaluate(() => ({
        fonts: [document.fonts.check('800 20px Chivo'), document.fonts.check('500 17px "IBM Plex Sans"'), document.fonts.check('800 13px Doto')],
        broken: [...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src')),
        overflow: document.documentElement.scrollWidth - innerWidth,
        doors: [...document.querySelectorAll('[data-abrir]')].map(a => a.getAttribute('href')),
        install: document.getElementById('instalar').hidden,
        alive: document.getAnimations().filter(a => a.animationName && a.animationName.startsWith('rv-') && a.playState === 'running').length,
        video: (v => ({ poster: !!v.poster, muted: v.muted, autoplay: v.autoplay, inline: v.playsInline }))(document.querySelector('video')),
        cameras: document.querySelectorAll('.camaras figure').length,
      }));
      assert.deepEqual(state.fonts, [true, true, true], name + ': las tres tipografías de la marca');
      assert.deepEqual(state.broken, [], name + ': ninguna imagen rota');
      assert.deepEqual(failed, [], name + ': nada que no exista');
      assert.deepEqual(errors, [], name + ': sin errores');
      assert.ok(state.overflow <= 0, name + ': no se desborda de lado (' + state.overflow + ')');
      assert.ok(state.doors.length >= 3 && state.doors.every(href => href === '../'), name + ': las puertas llevan a la app');
      assert.equal(state.install, true, name + ': Instalar no aparece si el navegador no lo ofrece');
      assert.ok(state.alive >= 10, name + ': el logo vive (' + state.alive + ')');
      assert.ok(state.video.poster && state.video.muted && !state.video.autoplay && state.video.inline, name + ': la película espera, callada y con portada');
      assert.equal(state.cameras, 8);
      // El navegador ofrece instalar: aparece la tecla.
      const offered = await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); return !document.getElementById('instalar').hidden; });
      assert.ok(offered, name + ': con la oferta del navegador, aparece Instalar');
      if (shots) await page.screenshot({ path: path.join(shots, 'entrada-' + name + '.png'), fullPage: true });
      // La puerta abre la app y deja dicho que la entrada ya se vio.
      await Promise.all([page.waitForURL(url => !/\/hola\//.test(String(url)), { timeout: 8000 }), page.locator('.portada [data-abrir]').click()]);
      const seen = await page.evaluate(() => localStorage.getItem('flip.entrada.vista'));
      assert.equal(seen, '1', name + ': al abrir la app queda anotado');
      step(name, { ancho: width, vivas: state.alive });
      await context.close();
    }
    console.log('LANDING PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
