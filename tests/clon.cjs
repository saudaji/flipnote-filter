// CLON: la cámara que aprende el look de una imagen (docs/clon.js). Se prueba con referencias
// sintéticas de las que se sabe exactamente qué llevan (tests/lib/clon-refs.js). Lo que tiene que
// seguir siendo verdad:
//   · MIDE bien: la trama (celdas a lo ancho, ángulo, puntos o líneas), la rejilla de píxel y su
//     tramado, la paleta (cuántas tintas y cuáles), el grano, la línea de tinta; y no ve lo que no hay;
//   · AGUANTA UNA FOTO: la referencia casi nunca llega limpia (luz desigual, desenfoque, ruido de
//     sensor, JPEG, un poco girada, a otro tamaño): tiene que medir lo mismo, y no inventarse un
//     píxel gordo por los bloques del JPEG ni un grano por el ruido de la cámara;
//   · SE PONE A PRUEBA: reconstruye su propia referencia con buena nota, y la nota baja si el look
//     que se le pone es el de otra imagen, o el mismo girado (la nota distingue, no regala);
//   · LA CURVA DE TONOS no da saltos: una escena de un solo tono no estira la imagen veinte veces;
//   · APLICA: con una paleta cerrada, lo que sale por la cámara solo lleva esas tintas; con píxel,
//     los bloques son del tamaño medido; la foto sale igual que la vista;
//   · SE USA: la cámara CLON arranca apuntando; COPIAR/CAPTURAR aprende de lo que ve la cámara,
//     ABRIR de un archivo; los looks se guardan (hasta treinta) en una galería donde se usan, se
//     nombran, se marcan favoritos y se borran (con deshacer); cuatro van a la mano como variantes;
//     en las dos pieles.
//   FLIP_URL=http://127.0.0.1:8760 node tests/clon.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, openFlip } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const REFS = path.join(__dirname, 'lib', 'clon-refs.js');
// Las tintas de las referencias, en RGB.
const INK = { rosa: [226, 62, 120], crema: [244, 236, 214] };

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForTimeout(600);
    await page.addScriptTag({ path: REFS });
    await page.evaluate(() => localStorage.removeItem('flip.clon'));

    // ── 1 · Medir ──
    const looks = await page.evaluate(() => {
      const out = {};
      for (const [key, name, args] of [['dots', 'dots', []], ['dots60', 'dots', [400, 60, 45]], ['lines', 'lines', []], ['pixel', 'pixel', []], ['pixel64', 'pixel', [384, 64]], ['duotone', 'duotone', []], ['grainy', 'grainy', []], ['clean', 'clean', []], ['poster', 'poster', []]]) {
        const t0 = performance.now(), look = flipClon.learn(clonRefs[name](...args));
        look.ms = Math.round(performance.now() - t0);
        // la paleta en RGB, para compararla con las tintas de verdad
        const c = document.createElement('canvas'); c.width = c.height = 1;
        out[key] = look;
      }
      return out;
    });
    const deg = look => ((look.screen.angle * 180 / Math.PI) % 180 + 180) % 180;
    const L = looks;
    assert.deepEqual([L.dots.screen.type, L.dots.limited, L.dots.palette.length, L.dots.pixel], ['dot', true, 2, 0], 'trama de puntos a dos tintas: ' + JSON.stringify(L.dots.screen));
    assert.ok(Math.abs(L.dots.screen.freq - 40) < 1.5 && Math.abs(deg(L.dots) % 90 - 30) < 3, '40 celdas a 30°: midió ' + L.dots.screen.freq + ' a ' + deg(L.dots).toFixed(1) + '°');
    assert.ok(Math.abs(L.dots60.screen.freq - 60) < 2 && Math.abs(deg(L.dots60) % 90 - 45) < 3 && L.dots60.screen.type === 'dot', '60 celdas a 45°: midió ' + L.dots60.screen.freq + ' a ' + deg(L.dots60).toFixed(1) + '°');
    assert.ok(L.lines.screen.type === 'line' && Math.abs(L.lines.screen.freq - 50) < 1.5 && Math.abs(deg(L.lines) - 90) < 3, 'líneas horizontales, 50 a lo alto: ' + JSON.stringify(L.lines.screen));
    assert.deepEqual([L.pixel.pixel, L.pixel.palette.length, L.pixel.limited, L.pixel.screen.type], [40, 4, true, 'bayer'], 'píxel de 40 a cuatro tintas con tramado ordenado');
    assert.equal(L.pixel64.pixel, 64, 'píxel de 64');
    assert.deepEqual([L.duotone.limited, L.duotone.pixel, L.duotone.screen.type, L.duotone.grain.amount, L.duotone.edge], [false, 0, 'none', 0, 0], 'un duotono suave no tiene trama, píxel, grano ni tinta');
    assert.ok(L.duotone.rampMix > 0.9, 'en un duotono la luz decide el color: ' + L.duotone.rampMix);
    assert.ok(L.grainy.grain.amount > 0.06 && L.clean.grain.amount === 0, 've el grano donde lo hay (' + L.grainy.grain.amount + ') y no donde no (' + L.clean.grain.amount + ')');
    // El tamaño del grano: grumos de 2 puntos en 400 son unas 200 celdas a lo ancho; de 4, unas 100.
    const grumos = await page.evaluate(() => [2, 4, 6].map(c => flipClon.learn(clonRefs.grainy(400, 34, c)).grain));
    assert.ok(grumos[0].cells > 150 && grumos[0].cells < 300 && grumos[1].cells > 75 && grumos[1].cells < 140 && grumos[2].cells > 35 && grumos[2].cells < 85, 'mide el tamaño del grano: ' + JSON.stringify(grumos.map(g => g.cells)));
    assert.ok(grumos.every(g => g.amount > 0.07 && g.amount < 0.16), 'y su fuerza no depende del tamaño: ' + JSON.stringify(grumos.map(g => g.amount)));
    assert.ok(L.grainy.rampMix < 0.5 && !L.grainy.limited, 'una foto a color no es un duotono ni una paleta cerrada');
    assert.deepEqual([L.poster.limited, L.poster.palette.length, L.poster.screen.type, L.poster.pixel], [true, 4, 'none', 0], 'cartel: cuatro tintas planas');
    assert.ok(L.poster.edge > 0.2, 'y línea de tinta: ' + L.poster.edge);
    // Las tintas medidas son las de verdad (la rosa y la crema de la trama).
    const tintas = await page.evaluate(pal => pal.map(c => { const l = Math.pow(c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2], 3), m = Math.pow(c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2], 3), s = Math.pow(c[0] - 0.0894841775 * c[1] - 1.291485548 * c[2], 3), e = v => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2)); return [e(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), e(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), e(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]; }), L.dots.palette);
    const lejos = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    assert.ok(lejos(tintas[0], INK.rosa) < 10 && lejos(tintas[1], INK.crema) < 10, 'las tintas medidas son las de la referencia: ' + JSON.stringify(tintas));
    assert.deepEqual([L.dots.name, L.pixel.name, L.poster.name, L.duotone.name], ['TRAMA ROSA', 'PÍXEL TURQUESA', 'CARTEL ROJO', 'DUOTONO AZUL'], 'cada look se nombra por lo que es');
    step('mide: trama, píxel, paleta, grano y tinta', { trama: [L.dots.screen.freq, +deg(L.dots).toFixed(1)], pixel: L.pixel.pixel, tintas: L.dots.palette.length, grano: L.grainy.grain.amount, ms: Math.max(...Object.values(L).map(l => l.ms)) });

    // ── 2 · Ponerse a prueba ──
    const notas = Object.fromEntries(Object.entries(L).map(([k, l]) => [k, l.score]));
    for (const [k, nota] of Object.entries(notas)) assert.ok(nota >= 74, 'reconstruye su referencia (' + k + '): ' + nota + ' %');
    assert.ok(notas.dots >= 85 && notas.lines >= 85 && notas.pixel >= 78 && notas.grainy >= 84, 'trama, líneas, píxel y grano, casi calcados: ' + [notas.dots, notas.lines, notas.pixel, notas.grainy].join(' / '));
    // Un look ajeno no reconstruye la imagen: la nota tiene que caer.
    const NOMBRES = ['dots', 'lines', 'pixel', 'poster', 'duotone', 'grainy', 'clean'];
    const cruzadas = await page.evaluate(names => {
      const refs = {}, looks = {}, out = {};
      for (const k of names) { refs[k] = clonRefs[k](); looks[k] = flipClon.learn(refs[k]); }
      const fine = c => { const f = document.createElement('canvas'); f.width = f.height = 256; const x = f.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(c, (c.width - 256) / 2, (c.height - 256) / 2, 256, 256, 0, 0, 256, 256); return f; };
      // (el quinto argumento es el look de la propia referencia: decide su versión sin estilo, la misma para todos)
      for (const ref of names) for (const look of names) out[ref + '←' + look] = flipClon._fit(JSON.parse(JSON.stringify(looks[look])), fine(refs[ref]), 400, refs[ref], looks[ref]).score;
      // las mismas rayas, giradas un cuarto de vuelta: mismas tintas, mismo grosor, otra dirección
      const girado = JSON.parse(JSON.stringify(looks.lines));
      girado.screen.angle = 0;
      out.giradas = flipClon._fit(girado, fine(refs.lines), 400, refs.lines, looks.lines).score;
      return out;
    }, NOMBRES);
    let margen = 100;
    for (const ref of NOMBRES) for (const look of NOMBRES) if (ref !== look) {
      margen = Math.min(margen, cruzadas[ref + '←' + ref] - cruzadas[ref + '←' + look]);
      assert.ok(cruzadas[ref + '←' + ref] >= cruzadas[ref + '←' + look] + 15, 'la nota distingue: ' + ref + ' con su look ' + cruzadas[ref + '←' + ref] + ', con el de ' + look + ' ' + cruzadas[ref + '←' + look]);
    }
    assert.ok(cruzadas['lines←lines'] >= cruzadas.giradas + 12, 'y ve la dirección de la trama: rayas con su look ' + cruzadas['lines←lines'] + ', con el mismo girado ' + cruzadas.giradas);
    step('se pone a prueba: reconstruye su referencia y la nota distingue', { propias: notas, margen, giradas: [cruzadas['lines←lines'], cruzadas.giradas] });

    // ── 2b · La referencia, fotografiada ──
    const fotos = await page.evaluate(async () => {
      const out = {};
      for (const [key, name, o] of [
        ['puntosLuz', 'dots', { light: [0.55, 1.15] }], ['puntosFoco', 'dots', { blur: 0.9 }], ['puntosTodo', 'dots', { rot: 3, light: [0.65, 1.15], blur: 0.9, jpeg: 0.5, noise: 7 }],
        ['cartelLuz', 'poster', { light: [0.55, 1.15] }], ['cartelReflejo', 'poster', { light: [0.55, 1.15], glare: true }], ['cartelRuido', 'poster', { blur: 1, noise: 8 }],
        ['pixelFoco', 'pixel', { blur: 0.8 }], ['pixelTamano', 'pixel', { size: 370 }], ['pixelGiro', 'pixel', { rot: 2 }],
        ['fotoJpeg', 'clean', { jpeg: 0.12 }], ['fotoRuido', 'clean', { noise: 6 }], ['fotoLuz', 'clean', { light: [0.55, 1.15] }], ['rayasRuido', 'lines', { blur: 0.8, noise: 6 }],
      ]) {
        const l = flipClon.learn(await clonDegrade(clonRefs[name](), o));
        out[key] = { k: l.palette.length, lim: l.limited, px: l.pixel, tipo: l.screen.type, celdas: l.screen.freq, grados: ((l.screen.angle * 180 / Math.PI) % 90 + 90) % 90, grano: l.grain.amount, sensor: l.grain.sensor || 0, tinta: l.edge, nota: l.score };
      }
      return out;
    });
    const F = fotos, dice = k => k + ' ' + JSON.stringify(F[k]);
    for (const k of ['puntosLuz', 'puntosFoco']) assert.ok(F[k].lim && F[k].k === 2 && F[k].tipo === 'dot' && Math.abs(F[k].celdas - 40) < 1.5 && Math.abs(F[k].grados - 30) < 3 && !F[k].px, 'la trama de puntos, con mala luz o desenfocada, sigue siendo dos tintas a 40 y 30°: ' + dice(k));
    assert.ok(F.puntosTodo.tipo === 'dot' && Math.abs(F.puntosTodo.celdas - 40) < 3 && !F.puntosTodo.px, 'y con todo a la vez sigue siendo una trama de puntos de ese tamaño: ' + dice('puntosTodo'));
    for (const k of ['cartelLuz', 'cartelReflejo', 'cartelRuido']) assert.ok(F[k].lim && F[k].k === 4 && F[k].tipo === 'none' && !F[k].px && F[k].tinta > 0.2 && F[k].grano === 0, 'el cartel sigue siendo cuatro tintas planas con línea: ' + dice(k));
    for (const k of ['pixelFoco', 'pixelTamano', 'pixelGiro']) assert.ok(Math.abs(F[k].px - 40) <= 2 && F[k].lim, 'el píxel gordo se sigue midiendo desenfocado, a otro tamaño o girado 2°: ' + dice(k));
    assert.ok(!F.fotoJpeg.px && F.fotoJpeg.tipo === 'none' && !F.fotoJpeg.lim, 'los bloques del JPEG no son píxel gordo: ' + dice('fotoJpeg'));
    assert.ok(F.fotoRuido.grano === 0 && F.fotoRuido.sensor > 0 && !F.fotoRuido.lim && F.fotoRuido.tipo === 'none', 'el ruido del sensor no es grano de la referencia: ' + dice('fotoRuido'));
    assert.ok(!F.fotoLuz.lim && F.fotoLuz.tipo === 'none', 'una foto con luz desigual sigue siendo una foto: ' + dice('fotoLuz'));
    assert.ok(F.rayasRuido.tipo === 'line' && Math.abs(F.rayasRuido.celdas - 50) < 2, 'las rayas, desenfocadas y con ruido: ' + dice('rayasRuido'));
    // Cosas que se repiten en la escena (visto en el teléfono: un teclado daba «trama de puntos»).
    const teclado = await page.evaluate(async () => [clonRefs.keyboard(), clonRefs.keyboard(400, 12, 8), await clonDegrade(clonRefs.keyboard(400, 7, 40), { blur: 1.2, noise: 5 })].map(c => { const l = flipClon.learn(c); return { tipo: l.screen.type, px: l.pixel, lim: l.limited }; }));
    assert.deepEqual(teclado.map(t => t.tipo + '/' + t.px), ['none/0', 'none/0', 'none/0'], 'un teclado no es una trama ni un píxel gordo: ' + JSON.stringify(teclado));
    for (const k of Object.keys(F)) assert.ok(F[k].nota >= 55, 'y la reconstruye con nota: ' + dice(k));
    step('aguanta una referencia fotografiada', { notas: Object.fromEntries(Object.entries(F).map(([k, v]) => [k, v.nota])) });

    // ── 2c · La curva de tonos ──
    const curva = await page.evaluate(() => {
      const look = flipClon.learn(clonRefs.clean()), pico = new Float32Array(64), llano = new Float32Array(64).fill(1);
      pico[20] = 1000; pico[21] = 40;                                  // una pared: casi todo de un solo tono
      const a = flipClon._tone(look, pico), b = flipClon._tone(look, llano);
      const salto = c => Math.max(...c.slice(1).map((v, i) => v - c[i])), baja = c => c.slice(1).some((v, i) => v < c[i]);
      return { saltoPico: salto(a), saltoLlano: salto(b), baja: baja(a) || baja(b), negro: [a[0], b[0]], minRef: Math.round(look.cdf[0] * 255) };
    });
    assert.ok(curva.saltoPico <= 4 && curva.saltoLlano <= 4 && !curva.baja, 'la curva sube sin escalones (antes, una pared daba saltos de 20 niveles): ' + JSON.stringify(curva));
    step('la curva de tonos no da saltos', curva);

    // ── 3 · La cámara arranca apuntando; CAPTURAR aprende de lo que ve ──
    await page.locator('#deckLooks [data-family="CLON"]').scrollIntoViewIfNeeded();
    await page.locator('#deckLooks [data-family="CLON"]').click();
    await page.waitForFunction(() => camFamily === 'CLON');
    await page.waitForTimeout(700);
    const inicio = await page.evaluate(() => ({ st: flipClon.state(), keys: [...document.querySelectorAll('.si-rapidas.clon-rapidas [data-clon]')].map(k => k.textContent.trim()), variante: camVariant, banda: document.body.classList.contains('con-rapidas-clon') }));
    assert.deepEqual([inicio.st.looks, inicio.keys, inicio.variante, inicio.banda, inicio.st.gl], [0, ['CAPTURAR', 'ABRIR', 'LOOKS0'], 'NUEVO', true, true], 'sin looks, apunta y ofrece CAPTURAR y ABRIR (y la galería, vacía)');
    // apuntando se ve la cámara tal cual (con color), no un look
    const crudo = await page.evaluate(() => { const g = document.createElement('canvas'); g.width = 64; g.height = 48; const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, 0, 64, 48); const d = c.getImageData(0, 0, 64, 48).data, set = new Set(); for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); return set.size; });
    assert.ok(crudo > 20, 'apuntando se ve la cámara: ' + crudo + ' colores');
    await page.locator('.clon-rapidas [data-clon="copiar"]').click();
    await page.waitForFunction(() => flipClon.state().looks === 1 && !flipClon.state().busy, null, { timeout: 15000 });
    await page.waitForTimeout(1300);
    const capturado = await page.evaluate(() => ({ st: flipClon.state(), look: flipClon.looks()[0], keys: [...document.querySelectorAll('.clon-rapidas [data-clon]')].map(k => k.textContent.trim()), variantes: [...document.querySelectorAll('#deckVariants [data-variant]')].map(k => k.textContent.trim()), lcd: document.getElementById('lcdLook').textContent, guardado: JSON.parse(localStorage.getItem('flip.clon')).length }));
    assert.deepEqual([capturado.st.aim, capturado.st.current, capturado.keys, capturado.guardado], [false, 'C1', ['COPIAR', 'ABRIR', 'LOOKS1'], 1], 'tras capturar, el look queda puesto y guardado');
    assert.match(capturado.look.thumb || '', /^data:image\/jpeg;base64,/, 'con su miniatura para la galería');
    assert.ok(capturado.variantes.length === 1 && capturado.variantes[0] === capturado.look.name, 'y es una variante con su nombre: ' + capturado.look.name + ' / ' + JSON.stringify(capturado.variantes));
    assert.ok(capturado.look.score >= 45, 'aprendido de la cámara, con nota: ' + capturado.look.score);
    step('la cámara: apunta, captura y el look queda como variante', { nombre: capturado.look.name, nota: capturado.look.score });

    // ── 4 · ABRIR: de un archivo ──
    const file = path.join(os.tmpdir(), 'flip-clon-ref-' + process.pid + '.png');
    fs.writeFileSync(file, Buffer.from((await page.evaluate(() => clonRefs.dots().toDataURL('image/png'))).split(',')[1], 'base64'));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.clon-rapidas [data-clon="abrir"]').click()]);
    await chooser.setFiles(file);
    await page.waitForFunction(() => flipClon.state().looks === 2 && !flipClon.state().busy, null, { timeout: 15000 });
    fs.unlinkSync(file);
    await page.waitForTimeout(1400);
    const abierto = await page.evaluate(() => ({ look: flipClon.looks()[1], st: flipClon.state() }));
    assert.deepEqual([abierto.look.name, abierto.look.screen.type, abierto.st.current], ['TRAMA ROSA', 'dot', 'C2'], 'el archivo abierto se clona y queda puesto');
    assert.match(await page.evaluate(() => document.getElementById('lcdLook').textContent), /^TRAMA ROSA$/, 'y la pantallita dice cuál es');
    assert.ok(Math.abs(abierto.look.screen.freq - 40) < 1.5, 'con su trama: ' + abierto.look.screen.freq);

    // ── 5 · Aplicar: por la cámara solo salen sus tintas, con su trama ──
    const salida = await page.evaluate(pal => {
      const g = document.createElement('canvas'); g.width = display.width; g.height = display.height;
      const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, 0);
      const d = c.getImageData(0, 0, g.width, g.height).data;
      let hit = 0, n = 0, ink = 0;
      for (let i = 0; i < d.length; i += 4 * 7) { n++; const near = pal.map(p => Math.max(Math.abs(d[i] - p[0]), Math.abs(d[i + 1] - p[1]), Math.abs(d[i + 2] - p[2]))); if (Math.min(...near) < 26) hit++; if (near[0] < 26) ink++; }
      return { tintas: +(hit / n).toFixed(3), rosa: +(ink / n).toFixed(3), w: g.width, h: g.height };
    }, [INK.rosa, INK.crema]);
    assert.ok(salida.tintas > 0.9, 'la imagen de la cámara solo lleva las dos tintas: ' + JSON.stringify(salida));
    assert.ok(salida.rosa > 0.08 && salida.rosa < 0.92, 'y las dos, repartidas por la trama: ' + salida.rosa);
    // La foto sale con el mismo look.
    await page.evaluate(() => { window.__shot = null; window._downloadBlob = function (blob) { window.__shot = blob; }; });
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => window.__shot, null, { timeout: 15000 });
    const foto = await page.evaluate(async pal => {
      const bmp = await createImageBitmap(window.__shot), g = document.createElement('canvas'); g.width = bmp.width; g.height = bmp.height;
      const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(bmp, 0, 0);
      const d = c.getImageData(0, 0, g.width, g.height).data; let hit = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 11) { n++; if (Math.min(...pal.map(p => Math.max(Math.abs(d[i] - p[0]), Math.abs(d[i + 1] - p[1]), Math.abs(d[i + 2] - p[2])))) < 30) hit++; }
      return { w: bmp.width, h: bmp.height, tintas: +(hit / n).toFixed(3) };
    }, [INK.rosa, INK.crema]);
    assert.ok(foto.tintas > 0.85 && foto.w >= 640, 'la foto lleva el look: ' + JSON.stringify(foto));
    step('aplica: solo sus tintas, en la vista y en la foto', { vista: salida.tintas, foto: foto.tintas, fotoPx: [foto.w, foto.h], ms: (await page.evaluate(() => flipClon.state().ms)) });

    // ── 6 · COPIAR otra vez vuelve a apuntar; los looks no pasan de cuatro; se recuerdan ──
    await page.locator('.clon-rapidas [data-clon="copiar"]').click();
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(() => [flipClon.state().aim, document.querySelector('.clon-rapidas [data-clon="copiar"]').textContent.trim()]), [true, 'CAPTURAR'], 'COPIAR vuelve a apuntar');
    await page.evaluate(() => { flipClon.aim(false); for (const n of ['pixel', 'poster', 'duotone']) flipClon.keep(flipClon.learn(clonRefs[n]())); });
    await page.waitForTimeout(500);
    const cuatro = await page.evaluate(() => ({ n: flipClon.looks().length, nombres: flipClon.looks().map(l => l.name), actual: camVariant, variantes: [...document.querySelectorAll('#deckVariants [data-variant]')].map(k => k.textContent.trim()), puesto: document.querySelector('#deckVariants [data-variant].is-on')?.textContent.trim() }));
    assert.deepEqual([cuatro.n, cuatro.nombres.slice(1), cuatro.variantes.length, cuatro.puesto], [5, ['TRAMA ROSA', 'PÍXEL TURQUESA', 'CARTEL ROJO', 'DUOTONO AZUL'], 4, 'DUOTONO AZUL'], 'se guardan todos; a la mano, en la fila, van cuatro (con el que está puesto): ' + JSON.stringify(cuatro));
    // el píxel por la cámara: bloques del tamaño medido
    await page.evaluate(() => { camVariant = flipClon.looks().find(l => l.name === 'PÍXEL TURQUESA').id; _applyCamState(); });
    await page.waitForTimeout(900);
    const bloques = await page.evaluate(() => { const g = document.createElement('canvas'); g.width = display.width; g.height = 1; const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, Math.floor(display.height / 2), display.width, 1, 0, 0, display.width, 1); const d = c.getImageData(0, 0, g.width, 1).data; let runs = 0; for (let x = 1; x < g.width; x++) if (Math.abs(d[4 * x] - d[4 * x - 4]) + Math.abs(d[4 * x + 1] - d[4 * x - 3]) + Math.abs(d[4 * x + 2] - d[4 * x - 2]) > 24) runs++; return { cambios: runs, ancho: g.width }; });
    assert.ok(bloques.cambios >= 4 && bloques.cambios <= 40, 'una fila de la imagen cambia de color como mucho una vez por bloque (40 a lo ancho): ' + JSON.stringify(bloques));
    await page.reload();
    await page.waitForFunction(() => window.flipClon && window.flipShell, null, { timeout: 20000 });
    assert.equal(await page.evaluate(() => flipClon.looks().length), 5, 'los looks se recuerdan al recargar');
    step('los looks se guardan y se recuerdan; el píxel sale a su tamaño', { nombres: cuatro.nombres, bloques });

    // ── 6b · La galería: usar, nombrar, marcar, borrar y deshacer; caben treinta ──
    // (tras recargar: pasar la portada y volver a CLON, que es donde estaba)
    if (await page.evaluate(() => !document.getElementById('splash').classList.contains('hidden'))) await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => typeof vid !== 'undefined' && vid.videoWidth > 0, null, { timeout: 20000 });
    assert.equal(await page.evaluate(() => camFamily), 'CLON', 'y la cámara que estaba puesta');
    await page.waitForFunction(() => { const k = document.querySelector('.clon-rapidas [data-clon="galeria"]'); return !!k && k.getBoundingClientRect().width > 0; }, null, { timeout: 15000 });
    await page.waitForTimeout(700);
    await page.locator('.clon-rapidas [data-clon="galeria"]').click();
    await page.waitForTimeout(350);
    const hoja = () => page.evaluate(() => { const g = document.getElementById('clonGaleria'), r = g.getBoundingClientRect(), v = document.getElementById('display').getBoundingClientRect(); return { abierta: !g.hidden, cuenta: document.getElementById('clonCuenta').textContent, cartas: [...g.querySelectorAll('.clon-carta')].map(c => c.querySelector('b').textContent + (c.classList.contains('is-on') ? '*' : '') + (c.classList.contains('is-fav') ? '★' : '')), nombre: document.getElementById('clonNombre').value, visorLibre: Math.round(r.top - v.top), cabe: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, deshacer: !g.querySelector('.clon-deshacer').hidden, actual: camVariant, lcd: document.getElementById('lcdLook').textContent, fila: [...document.querySelectorAll('#deckVariants [data-variant]')].map(k => k.textContent.trim()) }; });
    let g = await hoja();
    assert.deepEqual([g.abierta, g.cuenta, g.cartas.length, g.cabe], [true, 'LOOKS · 5 / 30', 5, true], 'la galería se abre con todos los looks: ' + JSON.stringify(g));
    assert.ok(g.visorLibre > 120, 'y deja el visor a la vista (' + g.visorLibre + ' px): lo que se toca se ve en vivo');
    assert.ok(g.cartas.filter(c => c.endsWith('*')).length === 1 && g.nombre === g.cartas.find(c => c.endsWith('*')).slice(0, -1), 'el que está puesto va marcado y con su nombre arriba: ' + JSON.stringify(g.cartas));
    // usar uno que no estaba a la mano: se pone en la cámara y pasa a la fila
    const viejo = cuatro.nombres[0];
    assert.ok(!g.fila.includes(viejo), 'el más viejo no estaba en la fila');
    await page.locator('.clon-carta', { hasText: viejo }).locator('.clon-carta-ver').click();
    await page.waitForTimeout(350);
    g = await hoja();
    assert.ok(g.abierta && g.lcd.includes(viejo) && g.fila.includes(viejo) && g.fila.length === 4 && g.nombre === viejo, 'tocar un look lo pone en la cámara sin cerrar la galería: ' + JSON.stringify(g));
    // nombrarlo
    await page.locator('#clonNombre').fill('mi cartel favorito de siempre');
    await page.locator('#clonNombre').press('Enter');
    await page.waitForTimeout(300);
    g = await hoja();
    assert.ok(g.nombre === 'MI CARTEL FAVORITO' && g.lcd.includes('MI CARTEL FAVORITO') && g.cartas.includes('MI CARTEL FAVORITO*'), 'el nombre se cambia (en mayúsculas y recortado a 18): ' + JSON.stringify([g.nombre, g.lcd]));
    await page.locator('#clonNombre').fill('   ');
    await page.locator('#clonNombre').press('Enter');
    assert.equal((await hoja()).nombre, 'MI CARTEL FAVORITO', 'un nombre vacío no borra el que tenía');
    // favorito: sube al principio
    await page.locator('.clon-carta', { hasText: 'PÍXEL TURQUESA' }).locator('.clon-carta-fav').click();
    await page.waitForTimeout(250);
    g = await hoja();
    assert.equal(g.cartas[0], 'PÍXEL TURQUESA★', 'el favorito va primero: ' + JSON.stringify(g.cartas));
    // borrar y deshacer
    await page.locator('[data-clon="borrar"]').click();
    await page.waitForTimeout(300);
    g = await hoja();
    assert.ok(g.cuenta === 'LOOKS · 4 / 30' && g.deshacer && !g.cartas.some(c => c.startsWith('MI CARTEL')) && g.actual !== 'NUEVO', 'borrar lo quita y ofrece deshacer: ' + JSON.stringify(g));
    await page.locator('[data-clon="deshacer"]').click();
    await page.waitForTimeout(300);
    g = await hoja();
    assert.ok(g.cuenta === 'LOOKS · 5 / 30' && !g.deshacer && g.cartas.includes('MI CARTEL FAVORITO*') && g.lcd.includes('MI CARTEL FAVORITO'), 'deshacer lo devuelve, y puesto: ' + JSON.stringify(g));
    // caben treinta; al llegar el 31 sale el más viejo que no sea favorito
    const lleno = await page.evaluate(() => {
      const base = flipClon.looks()[2];
      for (let i = 0; i < 25; i++) { const copy = JSON.parse(JSON.stringify(base)); copy.name = 'COPIA ' + i; copy.fav = false; flipClon.keep(copy); }
      const antes = flipClon.looks().map(l => l.name);
      flipClon.fav(flipClon.looks()[0].id, true);                    // el más viejo, protegido
      const copy = JSON.parse(JSON.stringify(base)); copy.name = 'EL 31'; copy.fav = false; flipClon.keep(copy);
      const ahora = flipClon.looks().map(l => l.name);
      return { max: flipClon.MAX, antes: antes.length, ahora: ahora.length, salio: antes.filter(n => !ahora.includes(n)), primero: ahora[0], ultimo: ahora[ahora.length - 1], fila: [...document.querySelectorAll('#deckVariants [data-variant]')].length, bytes: localStorage.getItem('flip.clon').length };
    });
    assert.deepEqual([lleno.max, lleno.antes, lleno.ahora, lleno.ultimo, lleno.fila], [30, 30, 30, 'EL 31', 4], 'caben treinta y la fila sigue con cuatro: ' + JSON.stringify(lleno));
    assert.ok(lleno.salio.length === 1 && lleno.salio[0] === 'TRAMA ROSA' && lleno.primero === 'MI CARTEL FAVORITO', 'al llegar el 31 sale el más viejo que no es favorito: ' + JSON.stringify(lleno.salio));
    assert.ok(lleno.bytes < 400000, 'treinta looks con miniatura pesan poco: ' + lleno.bytes + ' caracteres');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    assert.equal((await hoja()).abierta, false, 'Escape la cierra');
    step('la galería: usar, nombrar, favorito, borrar y deshacer; treinta looks', { cuenta: lleno.ahora, pesa: lleno.bytes, visorLibre: g.visorLibre });

    // ── 7 · En la piel OBJETO: sus teclas, en una fila del aparato ──
    const objeto = await openFlip(browser, { piel: 'objeto', sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await objeto.page.waitForTimeout(600);
    await objeto.page.locator('#deckLooks [data-family="CLON"]').scrollIntoViewIfNeeded();
    await objeto.page.locator('#deckLooks [data-family="CLON"]').click();
    await objeto.page.waitForFunction(() => camFamily === 'CLON');
    await objeto.page.waitForTimeout(600);
    const fila = await objeto.page.evaluate(() => { const row = document.querySelector('.clon-teclas'), r = row.getBoundingClientRect(); return { visible: !row.hidden && r.height > 20, teclas: [...row.querySelectorAll('button')].map(k => k.textContent.trim()), cabe: r.right <= innerWidth + 1, banda: getComputedStyle(document.querySelector('.clon-rapidas')).display }; });
    assert.deepEqual(fila, { visible: true, teclas: ['CAPTURAR', 'ABRIR', 'LOOKS0'], cabe: true, banda: 'none' }, 'en OBJETO, tres teclas del aparato');
    await objeto.page.locator('.clon-teclas [data-clon="copiar"]').click();
    await objeto.page.waitForFunction(() => flipClon.state().looks === 1 && !flipClon.state().busy, null, { timeout: 15000 });
    await objeto.page.locator('.clon-teclas [data-clon="galeria"]').click();
    await objeto.page.waitForTimeout(350);
    const charola = await objeto.page.evaluate(() => { const g = document.getElementById('clonGaleria'), r = g.getBoundingClientRect(); return { abierta: !g.hidden, cartas: g.querySelectorAll('.clon-carta').length, cabe: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, redonda: parseFloat(getComputedStyle(g).borderTopLeftRadius) > 10 }; });
    assert.deepEqual(charola, { abierta: true, cartas: 1, cabe: true, redonda: true }, 'y la galería, con la piel del aparato');
    assert.deepEqual(objeto.errors, []);
    step('piel OBJETO: captura con sus teclas y abre su galería', fila);

    assert.deepEqual(errors, []);
    console.log('CLON PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
