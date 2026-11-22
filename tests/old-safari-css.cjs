// ¿Qué pinta FLIP en un Safari que no entiende parte del CSS? No hay iPhone antiguo a mano, así que
// se le quita a la página, al vuelo, lo que cada versión de iOS no soporta (la declaración o la regla
// se vuelve inválida, que es lo que le pasa a ese Safari) y se mide dónde queda cada pieza.
// Solo el CSS: lo que le falte de JavaScript a cada Safari no se simula. Fuera de la batería.
//   FLIP_URL=http://127.0.0.1:8760 node tests/old-safari-css.cjs [carpeta-de-capturas]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch, PIXEL, URL } = require('./lib/harness.cjs');
const out = process.argv[2];

const CUTS = {
  dvh: text => text.replace(/(\d)(dvh|svh|lvh)\b/g, '$1$2x'),                       // iOS < 15.4
  has: text => text.replace(/:has\(/g, ':hasx('),                                    // iOS < 15.4
  linear: text => text.replace(/linear\(0,/g, 'linearx(0,'),                         // iOS < 17.2 (curva de animación)
  inset: text => text.replace(/(?<![-\w])inset(\s*:)/g, 'insetx$1'),                 // iOS < 14.5
  aspect: text => text.replace(/aspect-ratio(\s*:)/g, 'aspect-ratiox$1'),            // iOS < 15
  colormix: text => text.replace(/color-mix\(/g, 'color-mixx('),                     // iOS < 16.2
};
const VARIANTS = [
  ['actual', []],
  ['iOS 16.4–17.1 (sin linear())', ['linear']],
  ['iOS 15.4–16.1 (sin color-mix ni linear())', ['linear', 'colormix']],
  ['iOS 15.0–15.3 (además sin dvh ni :has)', ['linear', 'colormix', 'dvh', 'has']],
  ['iOS 14.5–14.8 (además sin aspect-ratio)', ['linear', 'colormix', 'dvh', 'has', 'aspect']],
  ['iOS 13.4–14.4 (además sin inset)', ['linear', 'colormix', 'dvh', 'has', 'aspect', 'inset']],
];
const PARTS = ['#display', '#shellModule', '#shellLcd', '#deckLooks', '#flipBottomNav', '#camBody'];

(async () => {
  const browser = await launch();
  let base = null;
  try {
    for (const [name, cuts] of VARIANTS) {
      const context = await browser.newContext({ ...PIXEL });
      await context.addInitScript({ path: path.join(__dirname, 'scenes.js') });
      await context.addInitScript({ path: path.join(__dirname, 'lib', 'page-kit.js') });
      await context.addInitScript(config => { window.__flipSceneCamera = config; }, { scene: 'roomLit', w: 1280, h: 720 });
      await context.addInitScript({ path: path.join(__dirname, 'lib', 'scene-camera.js') });
      if (cuts.length) await context.route(url => /\.css$/.test(url.pathname) || url.pathname === '/' || /index\.html$/.test(url.pathname), async route => {
        const response = await route.fetch();
        let text = await response.text();
        for (const cut of cuts) text = CUTS[cut](text);
        route.fulfill({ response, body: text });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 120)));
      await page.goto(URL, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      await page.locator('#btnSplashOriginal').click({ timeout: 8000 }).catch(error => errors.push('portada: ' + String(error.message).split('\n')[0]));
      await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 }).catch(() => errors.push('la cámara no encendió'));
      await page.waitForTimeout(1200);
      const got = await page.evaluate(parts => {
        const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
        const c = document.createElement('canvas'); c.width = 16; c.height = 12;
        const x = c.getContext('2d'); let level = -1;
        try { x.drawImage(display, 0, 0, 16, 12); const d = x.getImageData(0, 0, 16, 12).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]; level = Math.round(sum / (d.length / 4) / 3); } catch (_) {}
        const boot = window.__flipBoot ? window.__flipBoot.state() : null;
        return { view: [innerWidth, innerHeight], body: rect(document.body), parts: Object.fromEntries(parts.map(sel => [sel, rect(document.querySelector(sel))])), level, boot: boot && [boot.done, boot.failed, boot.seen], scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
      }, PARTS);
      if (!base) base = got;
      const moved = PARTS.filter(sel => JSON.stringify(got.parts[sel]) !== JSON.stringify(base.parts[sel]));
      const inView = PARTS.filter(sel => { const r = got.parts[sel]; return r && r[2] > 4 && r[3] > 4 && r[0] < got.view[0] && r[1] < got.view[1] && r[0] + r[2] > 0 && r[1] + r[3] > 0; });
      console.log('\n' + name);
      console.log('  visor ' + JSON.stringify(got.parts['#display']) + ' · nivel ' + got.level + ' · cuerpo ' + JSON.stringify(got.body) + ' · página ' + got.scroll.join('x') + ' en ' + got.view.join('x'));
      console.log('  piezas a la vista: ' + inView.length + '/' + PARTS.length + (moved.length ? ' · cambian respecto a la actual: ' + moved.map(sel => sel + ' ' + JSON.stringify(base.parts[sel]) + '→' + JSON.stringify(got.parts[sel])).join('; ') : ' · todo en su sitio'));
      if (errors.length) console.log('  errores: ' + errors.join(' | '));
      if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, name.replace(/[^a-zA-Z0-9.]+/g, '-').replace(/-+$/, '') + '.png') }); }
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error('FALLO', error); process.exit(1); });
