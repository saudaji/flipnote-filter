// La piel INTERFAZ: mancha, forma curva, letra gorda en minúsculas y el grano comiéndose el borde.
// Lo que tiene que seguir siendo verdad (con números):
//   · ninguna pieza lleva esquina cortada (clip-path) ni contorno: son manchas de color, con su radio
//     (píldora en las teclas, 22 en tarjetas, 16 en las cartas de CLON, 12 en las miniaturas, 26 arriba
//     en las hojas que suben);
//   · la letra: acciones en minúsculas (con CSS: el texto no cambia), siglas y nombres como están,
//     teclas en peso 800 y tracking negativo, y la letra de puntos fuera de todo lo que mide ≤ 12 px;
//   · el canto comido se hornea al arrancar (texturas de nueve cortes en URLs blob:), se pone
//     si-bordes-listos, se rehornea al cambiar de tema y las URLs viejas se sueltan;
//   · el grano es fino (un punto de ruido por punto físico: medido por autocorrelación) y se nota sin
//     velar; el canto de las formas está comido por ese mismo ruido; y el grano nunca va sobre el
//     visor, ni en las esquinas de la hoja que sube sobre él, ni sobre el QR de PASAR (que se lee);
//   · no hay rayas entre los cortes del border-image con densidad 3,4;
//   · todo lo que se toca mide 44 px; los contrastes de texto pasan AA en claro y en oscuro;
//   · la piel OBJETO no cambia nada: sin las reglas de INTERFAZ se calcula exactamente igual.
//   FLIP_URL=http://127.0.0.1:8760 node tests/piel.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip, pickCamera } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const CAM = { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } };
const DYE = 'html body[data-piel] .grano.grano { background: #f0f !important; opacity: 1 !important; }';
// Las 27 reglas de silueta.css que valen para las dos pieles (ver el punto 11). Iguales a las de antes
// de la piel nueva, salvo una: el grano de la galería de CLON también se esconde en OBJETO.
const HUELLA_COMUNES = { n: 27, huella: 'c3ac87f2' };

// Fracción de píxeles magenta (el grano teñido) en un rectángulo de la página.
async function magenta(page, rect) {
  const shot = (await page.screenshot({ clip: rect })).toString('base64');
  return page.evaluate(async data => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let hit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] < 20 && d[i + 2] > 235) hit++;
    return +(hit / (d.length / 4)).toFixed(4);
  }, shot);
}
const caja = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, sel);

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, CAM);
    await page.waitForFunction(() => document.body.classList.contains('si-bordes-listos'), null, { timeout: 15000 });
    await page.waitForTimeout(500);

    // ── 1 · El canto comido: horneado al arrancar ──
    const horno = await page.evaluate(() => {
      const b = flipPiel.bordes(), cs = getComputedStyle(document.documentElement);
      return { ...b, urls: b.piezas.map(n => cs.getPropertyValue('--si-f-' + n).trim()), cortes: ['22', '16', '12', 'h26'].map(n => cs.getPropertyValue('--si-sl-' + n).trim()), dpr: devicePixelRatio };
    });
    assert.ok(horno.listo && horno.texturas === horno.piezas.length && horno.vivas === horno.texturas, 'todas las texturas horneadas y vivas: ' + JSON.stringify(horno));
    assert.ok(horno.urls.every(u => /^url\("blob:/.test(u)), 'cada textura es una URL blob: (nada nuevo en la red): ' + horno.urls.filter(u => !/^url\("blob:/.test(u)).join(', '));
    assert.equal(horno.escala, Math.min(4, Math.max(1, horno.dpr)), 'hornea a la densidad de la pantalla (un punto de la textura, un punto físico)');
    assert.deepEqual(horno.cortes, [24, 18, 14, 28].map(n => String(Math.round(n * horno.escala))), 'los cortes, a esa densidad');
    assert.ok(horno.ms < 1500, 'hornear todas cuesta poco: ' + horno.ms + ' ms de trabajo (en tareas sueltas)');
    step('el canto comido se hornea al arrancar', { texturas: horno.texturas, escala: horno.escala, ms: horno.ms });

    // ── 2 · Forma: manchas sin esquina cortada ni contorno, con su radio ──
    await page.locator('.si-abrir').click();
    await page.waitForTimeout(350);
    const forma = await page.evaluate(() => {
      const cs = (e, p) => getComputedStyle(e, p || null);
      const out = { cortadas: [], conContorno: [], sinCanto: [] };
      const piezas = [...document.querySelectorAll('#shellTop .hw, #camDeck .hw:not(.look):not(.hw-switch), #siCajon .hw, .deck-group.is-on')].filter(e => e.getBoundingClientRect().width);
      for (const e of piezas) {
        for (const p of [null, '::before', '::after']) { const s = cs(e, p); if (s.clipPath !== 'none') out.cortadas.push((e.id || e.className) + (p || '')); }
        const s = cs(e);
        if (s.boxShadow !== 'none' || parseFloat(s.borderTopWidth) > 0) out.conContorno.push(e.id || e.className);
        const transparente = ['shellMic', 'shellAudio', 'shellSettings'].includes(e.id) || cs(e, '::before').content === 'none' || cs(e, '::before').display === 'none';
        if (!transparente && !/blob:/.test(cs(e, '::before').borderImageSource)) out.sinCanto.push(e.id || e.className);
      }
      const r = (sel, p) => { const e = document.querySelector(sel); return e ? cs(e, p).borderTopLeftRadius : null; };
      out.radios = {
        tecla: r('#siCajon [data-filtro="cam"]', '::before'), modo: r('#shellModule', '::before'), ficha: r('.deck-group.is-on', '::before'),
        hoja: r('#siCajon', '::before'), miniatura: r('.look.is-on i'), toma: r('#deckGallery b'),
      };
      // el color de la mancha (núcleo) es el de la tecla, no un contorno
      const tecla = document.querySelector('#siCajon [data-filtro="portal"]'), body = cs(document.body);
      out.mancha = [cs(tecla, '::before').backgroundColor, body.getPropertyValue('--si-banda-tecla').trim()];
      return out;
    });
    assert.deepEqual(forma.cortadas, [], 'ninguna esquina cortada');
    assert.deepEqual(forma.conContorno, [], 'ningún contorno de línea');
    assert.deepEqual(forma.sinCanto, [], 'cada mancha lleva su canto comido');
    assert.deepEqual(forma.radios, { tecla: '999px', modo: '999px', ficha: '999px', hoja: '26px', miniatura: '12px', toma: '12px' }, 'los radios: ' + JSON.stringify(forma.radios));
    const hex = c => '#' + c.match(/\d+/g).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
    assert.equal(hex(forma.mancha[0]), forma.mancha[1].toUpperCase(), 'la tecla apagada es una mancha del color de la tecla de la banda');
    step('formas: manchas curvas, sin esquina cortada ni contorno', forma.radios);

    // ── 3 · Letra: minúsculas con CSS, siglas como están, gorda y apretada, sin puntos ≤ 12 px ──
    const letra = await page.evaluate(() => {
      const cs = sel => getComputedStyle(document.querySelector(sel));
      const t = sel => { const e = document.querySelector(sel); return { texto: e.textContent.trim(), visto: e.innerText.trim(), caja: getComputedStyle(e).textTransform, peso: +getComputedStyle(e).fontWeight, tracking: parseFloat(getComputedStyle(e).letterSpacing) || 0 }; };
      const puntos = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const e = n.parentElement; if (!n.textContent.trim() || !e) continue;
        const r = e.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
        const s = getComputedStyle(e);
        if (/Doto/.test(s.fontFamily) && parseFloat(s.fontSize) <= 12.5 && s.visibility !== 'hidden') puntos.push(e.id || e.className || e.tagName);
      }
      const pesos = Object.fromEntries(['#shellModuleName', '#siCajon [data-filtro="portal"]', '.deck-group', '.si-toma .hw-print', '.si-abrir'].map(sel => [sel, +getComputedStyle(document.querySelector(sel)).fontWeight]));
      return { pesos, chivo: document.fonts.check('800 12px Chivo') && /^"?Chivo/.test(getComputedStyle(document.querySelector('#siCajon [data-filtro="portal"]')).fontFamily), modo: t('#shellModuleName'), filtro: t('#siCajon [data-filtro="cam"]'), ascii: t('#siCajon [data-filtro="ascii"]'), variante: t('#deckVariants [data-variant]'), lectura: t('#lcdLook'), toma: t('.si-toma .hw-print'), placa: t('.si-placa b'), seccion: t('.si-cajon-fila > small'),
        familia: cs('#lcdFps').fontFamily, puntos };
    });
    assert.ok(letra.modo.texto === 'CÁMARA' && letra.modo.visto === 'cámara' && letra.modo.caja === 'lowercase', 'la tecla de modo se lee en minúsculas y su texto no cambia: ' + JSON.stringify(letra.modo));
    assert.ok(letra.filtro.caja === 'lowercase' && letra.filtro.peso >= 700 && letra.filtro.tracking < 0, 'un filtro: minúsculas, gordo y apretado: ' + JSON.stringify(letra.filtro));
    assert.ok(letra.ascii.caja === 'none' && letra.ascii.visto === 'ASCII', 'ASCII es una sigla y se queda: ' + JSON.stringify(letra.ascii));
    assert.ok(letra.variante.caja === 'none' && letra.variante.visto === letra.variante.texto, 'los nombres de variante (STD, LGCY…) se quedan como están');
    assert.ok(letra.lectura.caja === 'none' && /DSi/.test(letra.lectura.visto) && letra.lectura.peso === 800, 'la lectura dice DSi tal cual: ' + JSON.stringify(letra.lectura));
    assert.ok(letra.toma.visto === 'toma' && letra.seccion.visto === letra.seccion.texto.toLowerCase() && letra.placa.visto === 'FL-27', 'rótulos en minúsculas y el código del modelo como está');
    assert.ok(!/Doto/.test(letra.familia), 'la segunda línea de la lectura ya no es de puntos');
    assert.ok(letra.chivo && Object.values(letra.pesos).every(w => w >= 800), 'las teclas y rótulos chicos van gordos (800, en Chivo cargada): ' + JSON.stringify(letra.pesos));
    assert.deepEqual(letra.puntos, [], 'nada de letra de puntos a 12 px o menos');
    step('letra: minúsculas con CSS, siglas como están, gorda y apretada', { modo: letra.modo.visto, filtro: letra.filtro.visto, ascii: letra.ascii.visto, lectura: letra.lectura.visto });

    // ── 4 · El grano: fino (un punto físico por punto de ruido), y nunca sobre el visor ──
    const grano = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('#shellTop > .grano')); return { pintado: s.imageRendering, tam: s.backgroundSize, esperado: (256 / devicePixelRatio).toFixed(4), tesela: /brand\/silueta\/grano\.webp/.test(s.backgroundImage), opacidad: +s.opacity }; });
    assert.ok(grano.tesela && grano.pintado === 'pixelated' && Math.abs(parseFloat(grano.tam) - parseFloat(grano.esperado)) < 0.01 && grano.opacidad > 0.4 && grano.opacidad <= 1, 'la tesela de grano, a 256 / densidad px y sin interpolar: un punto de ruido, un punto físico: ' + JSON.stringify(grano));
    // El cristal del grano, medido en la pantalla: autocorrelación de la luminancia a un punto físico
    // de distancia, en un trozo liso de la barra (sin letra). Ruido fino ≈ 0; un grumo suavizado daba
    // ~0,75 y la arena de dos puntos por cristal, ~0,5. Y que se note (σ) sin velar.
    const liso = await page.addStyleTag({ content: 'body * { -webkit-text-fill-color: transparent !important; } body svg { visibility: hidden !important; }' });
    // (en la barra de arriba, anclada a y = 0: una capa a media altura de punto la vuelve a muestrear el
    //  compositor y eso, no el grano, añade correlación vertical)
    const parche = await page.evaluate(() => { const b = document.getElementById('shellLcd').getBoundingClientRect(); return { x: b.x + 6, y: b.y + 4, width: b.width - 12, height: b.height - 8 }; });
    const cristal = await page.evaluate(async data => {
      const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height, L = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      let m = 0; for (const v of L) m += v; m /= L.length;
      let v0 = 0, vx = 0, vy = 0, nx = 0, ny = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = L[y * W + x] - m; v0 += a * a; if (x + 1 < W) { vx += a * (L[y * W + x + 1] - m); nx++; } if (y + 1 < H) { vy += a * (L[(y + 1) * W + x] - m); ny++; } }
      const varianza = v0 / L.length;
      return { ac1x: +(vx / nx / varianza).toFixed(3), ac1y: +(vy / ny / varianza).toFixed(3), sigma: +(Math.sqrt(varianza) / 255 * 100).toFixed(2), puntos: [W, H] };
    }, (await page.screenshot({ clip: parche })).toString('base64'));
    await liso.evaluate(node => node.remove());
    assert.ok(Math.abs(cristal.ac1x) < 0.25 && Math.abs(cristal.ac1y) < 0.25, 'el grano es fino: sin grumos, cada punto independiente del de al lado: ' + JSON.stringify(cristal));
    assert.ok(cristal.sigma >= 2 && cristal.sigma <= 8, 'y se nota como textura sin velar: σ de luminancia ' + cristal.sigma + ' %');
    // El canto: el contorno de la tecla de modo (tinta sobre crema) se mueve punto a punto con el ruido.
    const borde = await page.evaluate(() => { const b = document.getElementById('shellModule').getBoundingClientRect(); return { x: b.x + b.width * 0.3, y: b.y + 4 - 3, width: b.width * 0.4, height: 7 }; });
    const comido = await page.evaluate(async data => {
      const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height, L = (x, y) => { const i = (y * W + x) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
      const fuera = L(0, 0), dentro = L(0, H - 1), mitad = (fuera + dentro) / 2, filas = [];
      for (let x = 0; x < W; x++) { let y = 0; while (y < H - 1 && L(x, y) > mitad) y++; filas.push(y); }
      const m = filas.reduce((a, b) => a + b, 0) / W;
      return { rugosidad: +Math.sqrt(filas.reduce((a, b) => a + (b - m) ** 2, 0) / W).toFixed(2), saltos: filas.filter((v, i) => i && v !== filas[i - 1]).length, ancho: W };
    }, (await page.screenshot({ clip: borde })).toString('base64'));
    assert.ok(comido.rugosidad >= 0.6 && comido.saltos > comido.ancho * 0.3, 'el canto está comido por el grano (no es un filo limpio): ' + JSON.stringify(comido));
    const dye = await page.addStyleTag({ content: DYE });
    await page.waitForTimeout(200);
    const cajon = await caja(page, '#siCajon'), visor = await caja(page, '#display');
    const visorLibre = { x: visor.x + 2, y: visor.y + 2, width: visor.width - 4, height: Math.max(4, cajon.y - visor.y - 4) };
    const enVisor = await magenta(page, visorLibre);
    const esquinas = [await magenta(page, { x: cajon.x, y: cajon.y, width: 5, height: 5 }), await magenta(page, { x: cajon.x + cajon.width - 5, y: cajon.y, width: 5, height: 5 })];
    const enHoja = await magenta(page, { x: cajon.x + 40, y: cajon.y + 20, width: cajon.width - 80, height: 30 });
    assert.equal(enVisor, 0, 'ni una mota de grano sobre el visor');
    assert.deepEqual(esquinas, [0, 0], 'ni en las esquinas redondas de la hoja que sube sobre el visor');
    assert.ok(enHoja > 0.98, 'y la hoja sí lleva grano: ' + enHoja);
    await dye.evaluate(node => node.remove());
    await page.locator('.si-abrir').click();
    step('grano fino, canto comido y nunca sobre el visor', { cristal, canto: comido, visor: enVisor, esquinas, hoja: enHoja });

    // ── 5 · Sin rayas entre cortes (densidad de la pantalla: ' + dpr + ') ──
    const limpio = await page.addStyleTag({ content: 'body .grano { display: none !important; } body * { -webkit-text-fill-color: transparent !important; } body svg { visibility: hidden !important; }' });
    await page.locator('.si-abrir').click();
    await page.waitForTimeout(400);
    const rayas = {};
    for (const sel of ['#shellModule', '#siCajon [data-filtro="cam"]', '#siCajon [data-filtro="portal"]', '.deck-group.is-on', '#deckVariants [data-variant]']) {
      const r = await page.evaluate(sel => { const e = document.querySelector(sel), b = e.getBoundingClientRect(), s = getComputedStyle(e); const iy = parseFloat(s.getPropertyValue('--si-iy')) || 0, ix = parseFloat(s.getPropertyValue('--si-ix')) || 0; const h = b.height - 2 * iy; return { x: b.x + ix + h / 2 + 2, y: b.y + iy + 5, width: b.width - 2 * ix - h - 4, height: h - 10 }; }, sel);   // (lejos del canto moteado: ahí el ruido es a propósito)
      const shot = (await page.screenshot({ clip: r })).toString('base64');
      rayas[sel] = await page.evaluate(async data => {
        const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height, L = (x, y) => { const i = (y * W + x) * 4; return (d[i] + d[i + 1] + d[i + 2]) / 3; };
        const med = a => a.slice().sort((p, q) => p - q)[a.length >> 1];
        const cols = [], rows = [];
        for (let x = 0; x < W; x++) { let s = 0; for (let y = 0; y < H; y++) s += L(x, y); cols.push(s / H); }
        for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += L(x, y); rows.push(s / W); }
        const mc = med(cols), mr = med(rows);
        return +Math.max(...cols.map(v => Math.abs(v - mc)), ...rows.map(v => Math.abs(v - mr))).toFixed(1);
      }, shot);
    }
    await limpio.evaluate(node => node.remove());
    await page.locator('.si-abrir').click();
    assert.ok(Object.values(rayas).every(v => v <= 3), 'ninguna raya dentro de las manchas (desvío máximo de una fila o columna, sobre 255): ' + JSON.stringify(rayas));
    step('sin rayas entre cortes', rayas);

    // ── 6 · Blancos de toque de 44 px ──
    const toques = await page.evaluate(() => {
      const chicos = [];
      for (const e of document.querySelectorAll('#shellTop .hw, .si-banda-cabeza button, .deck-group, #camDeck .deck-main .hw, .si-placa')) {
        const r = e.getBoundingClientRect();
        if (!r.width || getComputedStyle(e).visibility === 'hidden') continue;
        if (e.classList.contains('si-placa')) continue;
        if (Math.round(r.height) < 44 || Math.round(r.width) < 44) chicos.push((e.id || e.className) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
      }
      return chicos;
    });
    assert.deepEqual(toques, [], 'todo lo que se toca mide 44 × 44 px o más');
    step('blancos de toque de 44 px');

    // ── 7 · El tinte de la cámara puesta: solo al cambiar de cámara ──
    const tinte1 = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--si-ambiente').trim());
    await pickCamera(page, 'AUTO03');
    await page.waitForFunction(t => getComputedStyle(document.body).getPropertyValue('--si-ambiente').trim() !== t, tinte1, { timeout: 5000 });
    const tinte2 = await page.evaluate(() => ({ tinte: getComputedStyle(document.body).getPropertyValue('--si-ambiente').trim(), halo: getComputedStyle(document.querySelector('.deck-looks')).backgroundImage }));
    assert.ok(/^rgb\(/.test(tinte1) && /^rgb\(/.test(tinte2.tinte) && tinte1 !== tinte2.tinte && /radial-gradient/.test(tinte2.halo), 'el halo de la tira toma el color de la cámara puesta: ' + JSON.stringify([tinte1, tinte2.tinte]));
    step('el halo toma el color de la cámara puesta', { antes: tinte1, despues: tinte2.tinte });

    // ── 8 · Contrastes (AA) en claro y en oscuro ──
    const contrastes = async () => page.evaluate(() => {
      const cs = getComputedStyle(document.body), v = k => cs.getPropertyValue(k).trim();
      const lum = hexa => { const n = hexa.replace('#', ''); const c = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
      const ratio = (a, b) => { const [x, y] = [lum(v(a)), lum(v(b))].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
      return { 'tinta/fondo': ratio('--si-tinta', '--si-fondo'), 'tinta/tecla': ratio('--si-tinta', '--si-tecla'), 'suave/fondo': ratio('--si-suave', '--si-fondo'), 'sobre-tinta/tinta': ratio('--si-sobre-tinta', '--si-tinta'),
        'marfil/banda-tecla': ratio('--si-marfil', '--si-banda-tecla'), 'marfil/banda': ratio('--si-marfil', '--si-banda'), 'banda-suave/banda': ratio('--si-banda-suave', '--si-banda'), 'banda-suave/banda-tecla': ratio('--si-banda-suave', '--si-banda-tecla'),
        'sobre-acento/acento': ratio('--si-sobre-acento', '--si-acento'), 'banda/marfil': ratio('--si-banda', '--si-marfil'), 'tinta/carta': ratio('--si-tinta', '--si-carta') };
    });
    const claro = await contrastes();
    await page.evaluate(() => document.getElementById('rolloTema').click());
    const oscuro = await contrastes();
    for (const [nombre, r] of [...Object.entries(claro).map(([k, x]) => ['claro ' + k, x]), ...Object.entries(oscuro).map(([k, x]) => ['oscuro ' + k, x])]) assert.ok(r >= 4.5, nombre + ' pasa AA: ' + r);
    step('contrastes AA', { claro, oscuro });

    // ── 9 · Cambiar de tema rehornea, y las URLs de antes se sueltan ──
    const viejas = horno.urls.map(u => u.slice(5, -2));
    await page.waitForFunction(v => { const u = getComputedStyle(document.documentElement).getPropertyValue('--si-f-tecla'); return u && !u.includes(v); }, viejas[0], { timeout: 25000 });
    await page.waitForTimeout(300);
    const tema = await page.evaluate(async viejas => {
      const sueltas = await Promise.all(viejas.map(u => fetch(u).then(() => false, () => true)));
      return { sueltas: sueltas.filter(Boolean).length, total: viejas.length, estado: flipPiel.bordes(), modo: getComputedStyle(document.querySelector('#shellModule'), '::before').backgroundColor };
    }, viejas);
    assert.equal(tema.sueltas, tema.total, 'al rehornear, las texturas viejas se sueltan (ninguna URL blob: queda viva sin uso)');
    assert.ok(tema.estado.listo && tema.estado.vivas === tema.estado.texturas, 'y las nuevas están todas');
    assert.equal(hex(tema.modo), '#F6EFE2', 'con el tema oscuro, la tecla de modo es la mancha clara del tema');
    await page.evaluate(() => document.getElementById('rolloTema').click());
    step('el tema rehornea y suelta las URLs viejas', { sueltas: tema.sueltas });

    // ── 10 · CLON · PASAR: el QR, nítido, sin grano encima, y se lee ──
    await page.waitForFunction(() => window.flipClon);
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'lib/clon-estilos.js'), 'utf8') });
    const id = await page.evaluate(() => { const E = clonEstilos, n = 256, A = E.scenes.retrato(n); const l = flipClon.keep(flipClon.learn(E.styled(A, E.recipes.neon), n, n)); flipClon.keep(flipClon.learn(E.styled(A, E.recipes.cartel), n, n)); flipClon.use(l.id); return l.id; });
    await page.waitForTimeout(600);
    await page.evaluate(() => flipClon.gallery(true));
    await page.waitForTimeout(500);
    const galeria = await page.evaluate(() => { const g = document.getElementById('clonGaleria'), carta = g.querySelector('.clon-carta'); return { grano: !!g.querySelector(':scope > .grano'), carta: getComputedStyle(carta, '::before').borderTopLeftRadius, mini: getComputedStyle(carta.querySelector('.clon-mini')).borderTopLeftRadius, minis: getComputedStyle(carta.querySelector('.clon-mini')).zIndex }; });
    assert.deepEqual(galeria, { grano: true, carta: '16px', mini: '11px', minis: '4' }, 'la galería: hoja con grano, cartas de 16 con miniatura de 11 por encima del grano');
    await page.locator('[data-clon="pasar"]').click();
    await page.waitForTimeout(400);
    // (el lienzo se ajusta con object-fit: contain: el QR es el cuadrado del medio; a los lados está la capa)
    const qr = await page.evaluate(() => { const c = document.getElementById('clonQr'), r = c.getBoundingClientRect(), lado = Math.min(r.width, r.height); return { x: r.x + (r.width - lado) / 2, y: r.y + (r.height - lado) / 2, width: lado, height: lado }; });
    const dye2 = await page.addStyleTag({ content: DYE });
    await page.waitForTimeout(150);
    const sobreQr = await magenta(page, { x: qr.x + 2, y: qr.y + 2, width: qr.width - 4, height: qr.height - 4 });
    await dye2.evaluate(node => node.remove());
    await page.waitForTimeout(150);
    let lector = null;
    if (await page.evaluate(() => typeof BarcodeDetector !== 'undefined')) {
      const png = (await page.screenshot({ clip: { x: qr.x - 6, y: qr.y - 6, width: qr.width + 12, height: qr.height + 12 } })).toString('base64');
      lector = await page.evaluate(async data => {
        const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
        try { return (await new BarcodeDetector({ formats: ['qr_code'] }).detect(img)).map(f => f.rawValue); } catch (error) { return 'error: ' + error; }
      }, png);
    }
    const esperado = await page.evaluate(id => flipClon.pass.qrText(id), id);
    assert.equal(sobreQr, 0, 'ni una mota de grano sobre el QR');
    if (Array.isArray(lector) && lector.length) { assert.equal(lector[0], esperado, 'el QR, fotografiado de la pantalla, se lee'); step('PASAR: el QR sin grano y se lee de la pantalla', { lado: Math.round(qr.width) }); }
    else step('PASAR: el QR sin grano (este navegador no trae lector de códigos: ' + JSON.stringify(lector) + ')', { lado: Math.round(qr.width) });
    await page.locator('#clonCapa .clon-pase [data-clon="capa-cerrar"]').click();
    await page.evaluate(() => flipClon.gallery(false));
    assert.deepEqual(errors, [], 'sin errores');
    await page.context().close();

    // ── 11 · La piel OBJETO no cambia nada ──
    // (a) en OBJETO no se hornea nada ni se pone ninguna clase;
    // (b) quitando de silueta.css todas las reglas de INTERFAZ, OBJETO se calcula exactamente igual.
    const css = fs.readFileSync(path.join(__dirname, '..', 'docs', 'silueta.css'), 'utf8');
    const tmp = await browser.newPage();
    const recortado = await tmp.evaluate(text => {
      const sheet = new CSSStyleSheet(); sheet.replaceSync(text);
      let quitadas = 0;
      const fuera = (list, owner) => { for (let i = list.length - 1; i >= 0; i--) { const r = list[i]; if (r.cssRules && !r.selectorText) fuera(r.cssRules, r); else if (r.selectorText && r.selectorText.split(',').every(sel => /data-piel="interfaz"\]/.test(sel) && !/:not\(\[data-piel="interfaz"\]\)/.test(sel))) { owner.deleteRule(i); quitadas++; } } };
      fuera(sheet.cssRules, sheet);
      return { css: [...sheet.cssRules].map(r => r.cssText).join('\n'), quitadas };
    }, css);
    await tmp.close();
    assert.ok(recortado.quitadas > 300, 'se quitan las reglas de INTERFAZ: ' + recortado.quitadas);
    const objeto = async quitar => {
      const ctx = await browser.newContext({ ...require('./lib/harness.cjs').PIXEL });
      if (quitar) await ctx.route('**/silueta.css', route => route.fulfill({ body: recortado.css, contentType: 'text/css' }));
      return ctx;
    };
    const medir = async ctx => {
      await ctx.addInitScript({ path: path.join(__dirname, 'scenes.js') });
      await ctx.addInitScript({ path: path.join(__dirname, 'lib', 'page-kit.js') });
      await ctx.addInitScript(() => { try { localStorage.setItem('flip.piel', 'objeto'); } catch (_) {} });
      await ctx.addInitScript(config => { window.__flipSceneCamera = config; }, CAM.sceneCamera);
      await ctx.addInitScript({ path: path.join(__dirname, 'lib', 'scene-camera.js') });
      const p = await ctx.newPage();
      await p.goto(require('./lib/harness.cjs').URL);
      await p.locator('#btnSplashOriginal').click();
      await p.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
      await p.waitForTimeout(1500);
      const r = await p.evaluate(() => {
        const P = ['display', 'position', 'width', 'height', 'background-color', 'background-image', 'color', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-transform', 'border-top-left-radius', 'border-image-source', 'box-shadow', 'clip-path', 'opacity', 'z-index', 'padding-top', 'image-rendering', 'visibility', 'content'];
        const out = {}, seen = {};
        for (const node of document.querySelectorAll('#shellTop *, #camDeck *, #shellLauncher *, #splash *, #shellTop, #camDeck, #shellLauncher')) {
          if (node.closest('svg') && node.tagName !== 'svg') continue;
          if (node.classList.contains('splash-char')) continue;          // (letras sueltas de la portada, escondidas y con posición al azar)
          let key = node.tagName + (node.id ? '#' + node.id : '') + '.' + String(node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className).trim().split(/\s+/).filter(c => !/^(paso|pop|guino|retroceso|mareo|is-down)$/.test(c)).sort().join('.');
          seen[key] = (seen[key] || 0) + 1; key += '~' + seen[key];
          for (const ps of [null, '::before', '::after']) { const s = getComputedStyle(node, ps); if (ps && (s.content === 'none' || s.content === 'normal')) continue; out[key + (ps || '')] = P.map(x => s.getPropertyValue(x)).join('|'); }
        }
        return { estilos: out, horno: flipPiel.bordes(), clase: document.body.classList.contains('si-bordes-listos'), vars: getComputedStyle(document.documentElement).getPropertyValue('--si-f-tecla').trim() };
      });
      await ctx.close();
      return r;
    };
    // (c) las reglas de silueta.css que valen para las dos pieles (las que no cuelgan de
    //     body[data-piel="interfaz"]) son las de siempre: si alguien cambia una, esta huella cambia.
    const comunes = (() => {
      const out = [], walk = (t, pre) => {
        let i = 0;
        while (i < t.length) {
          const open = t.indexOf('{', i); if (open < 0) break;
          const sel = t.slice(i, open).trim();
          let depth = 1, j = open + 1;
          while (depth && j < t.length) { if (t[j] === '{') depth++; else if (t[j] === '}') depth--; j++; }
          const cuerpo = t.slice(open + 1, j - 1);
          if (/^@(media|supports)/.test(sel)) walk(cuerpo, pre + sel + ' ');
          else if (!sel.startsWith('@keyframes')) {
            const sels = []; let d = 0, cur = '';
            for (const ch of sel) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { sels.push(cur.trim()); cur = ''; } else cur += ch; }
            sels.push(cur.trim());
            if (!sels.every(x => /data-piel="interfaz"\]/.test(x) && !/:not\(\[data-piel="interfaz"\]\)/.test(x))) out.push(pre + sel.replace(/\s+/g, ' ') + ' { ' + cuerpo.replace(/\s+/g, ' ').trim() + ' }');
          }
          i = j;
        }
      };
      walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), '');
      let h = 0;
      for (const ch of out.join('\n')) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
      return { n: out.length, huella: h.toString(16) };
    })();
    assert.deepEqual(comunes, HUELLA_COMUNES, 'las reglas comunes a las dos pieles no cambian: ' + JSON.stringify(comunes));
    const entera = await medir(await objeto(false));
    const sinInterfaz = await medir(await objeto(true));
    assert.ok(!entera.horno.listo && !entera.clase && !entera.vars && entera.horno.texturas === 0, 'en OBJETO no se hornea nada: ' + JSON.stringify({ horno: entera.horno.texturas, clase: entera.clase }));
    const claves = Object.keys(entera.estilos);
    const distintas = claves.filter(k => entera.estilos[k] !== sinInterfaz.estilos[k]);
    assert.ok(claves.length > 150, 'se miden muchas piezas: ' + claves.length);
    assert.deepEqual(distintas.slice(0, 8), [], 'las reglas de INTERFAZ no tocan nada de OBJETO (' + distintas.length + ' piezas distintas)');
    step('la piel OBJETO no cambia nada', { piezas: claves.length, distintas: distintas.length });
    console.log('PIEL PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
