// La marca «Rollo en añil»: lo que tiene que seguir siendo verdad al tocar la interfaz.
//   · la portada enseña el logo vivo (en bucle, dentro de su pantalla) y la marca; el icono, el manifiesto y la precarga apuntan a
//     archivos que existen;
//   · al encender la cámara, la pantallita corre la secuencia de matriz de puntos y la devuelve;
//   · la tecla CARCASA cambia la carcasa, lo dice, y se recuerda al recargar;
//   · en la carcasa oscura los marcos hundidos son oscuros y, sobre las piezas claras, la tinta
//     sigue siendo oscura (que no quede crema sobre crema);
//   · el disparador, los botones y las teclas pintan los renders de la marca.
//   FLIP_URL=http://127.0.0.1:8760 node tests/brand.cjs [--shots carpeta]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip } = require('./lib/harness.cjs');

const at = process.argv.indexOf('--shots');
const shots = at >= 0 ? path.resolve(process.argv[at + 1]) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const DOCS = path.join(__dirname, '..', 'docs');

// Luminancia relativa (WCAG) de un color CSS «rgb(r, g, b)».
const contrast = (a, b) => {
  const lum = text => { const [r, g, b] = text.match(/[\d.]+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

(async () => {
  // ── 0 · Archivos ──
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  const assets = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
  const missing = assets.filter(file => !fs.existsSync(path.join(DOCS, file)));
  assert.deepEqual(missing, [], 'todo lo que se precarga existe');
  const manifest = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.json'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(DOCS, icon.src)), 'icono ' + icon.src);
  assert.deepEqual(manifest.icons.map(i => i.purpose).sort(), ['any', 'any', 'maskable', 'maskable', 'monochrome']);
  step('precarga e iconos existen', { precarga: assets.length, marca: assets.filter(a => a.startsWith('brand/')).length });

  const browser = await launch();
  try {
    let { page, errors, context } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 }, boot: false, piel: 'objeto' });
    const failed = [];
    page.on('requestfailed', request => failed.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) failed.push(response.status() + ' ' + response.url()); });

    // ── 1 · Portada ──
    await page.waitForFunction(() => document.querySelector('.splash-hero.rollo-ident-listo'), null, { timeout: 10000 });
    const cover = await page.evaluate(async () => {
      await document.fonts.ready;
      const title = document.querySelector('.rollo-titulo');
      return { flip: document.body.dataset.flip, theme: document.body.dataset.tema, title: title.naturalWidth > 0, ident: (() => { const v = document.querySelector('.rollo-vivo'), h = document.querySelector('.splash-hero'); if (!v || !h) return 0; const a = v.getBoundingClientRect(), b = h.getBoundingClientRect(); const dentro = a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom && a.width > 120; return dentro && v.querySelectorAll('.rv-capa').length === 4 ? document.getAnimations().filter(x => x.animationName && x.animationName.startsWith('rv-') && x.playState === 'running').length : 0; })(),
        font: getComputedStyle(document.querySelector('.splash-door-label')).fontFamily, chivo: document.fonts.check('800 12px Chivo'), tag: document.querySelector('.splash-tag').textContent.trim() };
    });
    assert.equal(cover.flip, 'rollo-en-anil');
    assert.equal(cover.theme, 'principal', 'la carcasa de fábrica es la clara');
    assert.ok(cover.title && cover.ident >= 10, 'la marca carga y el logo de la portada está vivo, dentro de su pantalla: ' + cover.ident);
    assert.ok(/Chivo/.test(cover.font) && cover.chivo, 'la serigrafía va en Chivo, servida por la app: ' + cover.font);
    if (shots) await page.screenshot({ path: path.join(shots, 'marca-portada.png') });
    step('portada: marca, logo vivo y tipografía', { rótulo: cover.tag, animaciones: cover.ident });

    // ── 2 · Arranque en la pantallita ──
    await page.locator('#btnSplashOriginal').click();
    await page.waitForSelector('#shellLcd .rollo-matriz', { timeout: 3000 });
    const still = await page.evaluate(() => document.getAnimations().filter(x => x.animationName && x.animationName.startsWith('rv-')).length);
    assert.equal(still, 0, 'con la cámara encendida, el logo de la portada ya no se anima');
    const seen = [];
    for (let i = 0; i < 14; i++) {
      seen.push(await page.evaluate(() => { const m = document.querySelector('#shellLcd .rollo-matriz'); return m ? m.querySelectorAll('rect').length : -1; }));
      await page.waitForTimeout(200);
    }
    const frames = new Set(seen.filter(n => n >= 0));
    assert.ok(frames.size >= 4, 'la secuencia pasa por varios cuadros: ' + seen.join(' '));
    await page.waitForFunction(() => !document.querySelector('#shellLcd .rollo-matriz'), null, { timeout: 4000 });
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    const lcd = await page.evaluate(() => document.getElementById('lcdLook').textContent);
    assert.match(lcd, /DSI/i, 'al acabar, la pantallita vuelve a decir la cámara: ' + lcd);
    step('arranque: matriz de puntos y vuelta al estado', { puntos: [...frames].join(' '), pantallita: lcd });

    // ── 3 · Piezas de la marca ──
    const pieces = await page.evaluate(() => {
      const url = (el, pseudo) => getComputedStyle(el, pseudo).backgroundImage + ' ' + getComputedStyle(el, pseudo).borderImageSource;
      return { shutter: url(document.getElementById('deckShutter'), '::before'), adjust: url(document.getElementById('deckAdjust'), '::before'), flip: url(document.getElementById('deckFlip'), '::before'),
        on: url(document.querySelector('#deckVariants .hw-keycap.is-on, .deck-variants .hw-keycap.is-on') || document.querySelector('.hw-keycap.is-on'), '::before'),
        key: url(document.querySelector('.hw-keycap:not(.is-on):not([data-color])'), '::before'), shell: getComputedStyle(document.getElementById('camBody')).backgroundImage,
        foot: !!document.querySelector('#camDeck .rollo-pie'), footImage: getComputedStyle(document.querySelector('#camDeck .rollo-pie')).backgroundImage };
    });
    assert.match(pieces.shutter, /materiales\/disparador-anil\.webp/);
    assert.match(pieces.adjust, /materiales\/boton-mandarina\.webp/);
    assert.match(pieces.flip, /materiales\/boton-lima\.webp/);
    assert.match(pieces.on, /materiales\/tecla-anil\.webp/);
    assert.match(pieces.key, /materiales\/tecla\.webp/);
    assert.match(pieces.shell, /materiales\/shell-top\.webp.*materiales\/shell-bottom\.webp.*materiales\/shell-mid\.webp/);
    assert.match(pieces.footImage, /placa-fl-27-compacta\.svg/);
    step('disparador, botones, teclas, carcasa y firma son los de la marca');

    // ── 4 · Carcasa oscura ──
    await page.locator('#shellModule').click();
    const key = page.locator('#rolloTema');
    assert.equal((await key.textContent()).trim(), 'TEMA OSCURO');
    await key.click();
    assert.equal((await key.textContent()).trim(), 'TEMA CLARO', 'la tecla dice a cuál se cambia');
    await page.locator('#launcherClose').click();
    await page.waitForTimeout(400);
    const dark = await page.evaluate(() => {
      const css = (el, prop, pseudo) => getComputedStyle(el, pseudo)[prop];
      return { theme: document.body.dataset.tema, shell: css(document.getElementById('camBody'), 'backgroundImage'), bezel: css(document.getElementById('lcd'), 'borderImageSource'),
        tray: css(document.querySelector('.deck-looks'), 'borderImageSource'), lcd: css(document.querySelector('.hw-lcd'), 'borderImageSource', '::before'),
        foot: css(document.querySelector('#camDeck .rollo-pie'), 'backgroundImage'), print: css(document.querySelector('#camDeck .hw-print'), 'color'),
        keyInk: css(document.querySelector('.hw-keycap:not(.is-on):not([data-color])'), 'color') };
    });
    assert.equal(dark.theme, 'oscuro');
    assert.match(dark.shell, /shell-top-oscuro\.webp.*shell-bottom-oscuro\.webp.*shell-mid-oscuro\.webp/);
    assert.match(dark.bezel, /bezel-oscuro\.webp/);
    assert.match(dark.tray, /tray-oscuro\.webp/);
    assert.match(dark.lcd, /lcd-oscuro\.webp/);
    assert.match(dark.foot, /placa-fl-27-compacta-clara\.svg/);
    assert.ok(contrast(dark.print, 'rgb(45, 49, 77)') >= 4.5, 'la serigrafía se lee sobre la carcasa oscura: ' + dark.print);
    assert.ok(contrast(dark.keyInk, 'rgb(255, 243, 220)') >= 4.5, 'la tinta de una tecla clara sigue siendo oscura: ' + dark.keyInk);
    // La hoja de ajustes es una pieza clara: sus textos no pueden heredar la tinta invertida.
    await page.locator('#shellSettings').click();
    await page.waitForTimeout(600);
    const sheet = await page.evaluate(() => {
      const panel = document.querySelector('.flip-settings-panel');
      const own = el => [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
      const texts = [...panel.querySelectorAll('*')].filter(el => own(el) && el.getClientRects().length && !el.closest('button.active, button[aria-pressed="true"], button[aria-selected="true"]'));
      return texts.slice(0, 60).map(el => ({ text: el.textContent.trim().slice(0, 14), color: getComputedStyle(el).color }));
    });
    const faint = sheet.filter(item => contrast(item.color, 'rgb(243, 239, 229)') < 3);
    assert.deepEqual(faint, [], 'en la hoja de ajustes no queda texto claro sobre claro');
    if (shots) await page.screenshot({ path: path.join(shots, 'marca-oscura-ajustes.png') });
    await page.keyboard.press('Escape');
    step('carcasa oscura: marcos oscuros, serigrafía clara y tinta oscura en lo claro', { textos: sheet.length });

    // ── 5 · Se recuerda ──
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.tema === 'oscuro', null, { timeout: 8000 });
    const kept = await page.evaluate(() => ({ theme: document.body.dataset.tema, stored: localStorage.getItem('flip.rollo.carcasa'), splash: getComputedStyle(document.getElementById('splash')).backgroundImage.includes('shell-top-oscuro') }));
    assert.deepEqual(kept, { theme: 'oscuro', stored: 'oscuro', splash: true }, 'la carcasa elegida se recuerda');
    if (shots) await page.screenshot({ path: path.join(shots, 'marca-portada-oscura.png') });
    await page.evaluate(() => flipRollo.setTheme('principal'));
    step('la carcasa elegida se recuerda al recargar');

    assert.deepEqual(failed.filter(url => /brand\/|body\//.test(url)), [], 'ningún archivo de la carcasa o de la marca falla al cargar');
    assert.deepEqual(errors, [], 'sin errores de página');
    console.log('BRAND PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error('BRAND FAIL\n', error); process.exit(1); });
