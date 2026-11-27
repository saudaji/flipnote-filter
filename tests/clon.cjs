// CLON: la cámara que aprende el look de una imagen (docs/clon.js). Se prueba con referencias
// sintéticas de las que se sabe exactamente qué llevan (tests/lib/clon-refs.js). Lo que tiene que
// seguir siendo verdad:
//   · MIDE bien: la trama (celdas a lo ancho, ángulo, puntos o líneas), la rejilla de píxel y su
//     tramado, la paleta (cuántas tintas y cuáles), el grano, la línea de tinta; y no ve lo que no hay;
//   · ENTIENDE UNA FIGURA SOBRE FONDO ABSOLUTO: con negro o blanco puros ocupando casi toda la
//     referencia, mide la figura (sus tintas, su degradado) y en la cámara el negro sale negro;
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
const { launch, pickCamera, openFlip } = require('./lib/harness.cjs');
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

    // ── 1b · Una figura sobre negro o blanco absolutos ──
    // (el fondo es casi toda la imagen: si manda él en las medidas, la figura no se entiende. Antes: un
    //  resplandor azul y rosa sobre negro salía «cuatro tintas, 28 %», y una tinta degradada sobre
    //  blanco, «una tinta: blanco»)
    const figuras = await page.evaluate(() => {
      const refs = {
        roja: clonRefs.silueta(512, '#fff', '#d6233a'), cian: clonRefs.silueta(512, '#000', '#19d3e6'),
        resplandor: clonRefs.resplandor(), degradada: clonRefs.silueta(512, '#fff', (x, k) => { const g = x.createLinearGradient(0, 80 * k, 0, 440 * k); g.addColorStop(0, '#1a2a8a'); g.addColorStop(1, '#e03a8c'); return g; }),
      };
      // una escena con luces y sombras: fondo oscuro, una cara clara
      const scene = document.createElement('canvas'); scene.width = scene.height = 256; const c = scene.getContext('2d');
      c.fillStyle = '#0c0d10'; c.fillRect(0, 0, 256, 256);
      const sk = c.createLinearGradient(70, 0, 190, 0); sk.addColorStop(0, '#f3d7c2'); sk.addColorStop(1, '#6a4f3a'); c.fillStyle = sk; c.beginPath(); c.ellipse(128, 120, 52, 70, 0, 0, 7); c.fill();
      c.fillStyle = '#8a93a8'; c.beginPath(); c.ellipse(128, 266, 113, 73, 0, Math.PI, 0); c.fill();
      const out = {};
      for (const [name, ref] of Object.entries(refs)) {
        const look = flipClon.learn(ref), o = document.createElement('canvas'); o.width = o.height = 256;
        flipClon._render(look, scene, o);
        const d = o.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 256, 256).data, seen = new Set();
        let black = 0, white = 0, colour = 0;
        for (let i = 0; i < d.length; i += 4) { const hi = Math.max(d[i], d[i + 1], d[i + 2]), lo = Math.min(d[i], d[i + 1], d[i + 2]); if (hi <= 10) black++; else if (lo >= 245) white++; else if (hi - lo > 60) colour++; seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3); }
        const n = d.length / 4;
        out[name] = { nota: look.score, cerrada: look.limited, tintas: look.palette.length, partes: look.shares, fondo: look.back, suelo: look.ground && +look.ground[0].toFixed(2), nombre: look.name, negro: +(black / n).toFixed(2), blanco: +(white / n).toFixed(2), color: +(colour / n).toFixed(2), tonos: seen.size };
      }
      return out;
    });
    for (const k of ['roja', 'cian']) {
      const f = figuras[k];
      assert.ok(f.cerrada && f.tintas === 2 && f.nota >= 78, k + ': dos tintas planas (el fondo y la figura), bien reconstruida: ' + JSON.stringify(f));
      assert.ok(Math.abs(f.fondo - 0.775) < 0.03 && Math.abs(Math.max(...f.partes) - 0.775) < 0.03, k + ': el fondo ocupa lo que ocupa (tres cuartos): ' + JSON.stringify(f));
      assert.ok(f.tonos <= 6, k + ': puesta en la cámara, solo lleva sus dos tintas: ' + f.tonos);
    }
    assert.ok(figuras.cian.suelo < 0.1 && figuras.cian.negro > 0.3 && figuras.cian.color > 0.15, 'sobre negro: el negro sale negro absoluto y la figura, de su color: ' + JSON.stringify(figuras.cian));
    assert.ok(figuras.roja.suelo > 0.95 && figuras.roja.blanco > 0.15 && figuras.roja.color > 0.3, 'sobre blanco: el blanco sale blanco y lo oscuro, de su color: ' + JSON.stringify(figuras.roja));
    assert.ok(!figuras.resplandor.cerrada && figuras.resplandor.tintas >= 5 && figuras.resplandor.nota >= 80, 'un resplandor sobre negro es color continuo, no «cuatro tintas»: ' + JSON.stringify(figuras.resplandor));
    assert.ok(figuras.resplandor.negro > 0.25 && figuras.resplandor.color > 0.1 && figuras.resplandor.tonos > 40, 'y puesto en la cámara: negro absoluto en lo oscuro y el degradado de colores en lo claro: ' + JSON.stringify(figuras.resplandor));
    assert.ok(!figuras.degradada.cerrada && figuras.degradada.tintas >= 3 && figuras.degradada.nota >= 60, 'una tinta degradada sobre blanco se ve entera (antes: «una tinta: blanco»): ' + JSON.stringify(figuras.degradada));
    step('una figura sobre negro o blanco absolutos se entiende', Object.fromEntries(Object.entries(figuras).map(([k, f]) => [k, { nota: f.nota, tintas: f.tintas, fondo: f.fondo, nombre: f.nombre }])));

    // ── 1c · Contra la verdad: estilos de receta conocida (tests/lib/clon-estilos.js) ──
    // referencia = estilo(escena A). El clon puesto sobre A tiene que reconstruirla, y puesto sobre otra
    // escena tiene que dejarla con el reparto de color de la referencia. Las distancias son en OKLab × 100
    // (2 apenas se nota). Antes de esta tanda: neón 11,5 (sin resplandor, cian + rosa promediados, el
    // negro en gris), foto con dominante 5,2 (su degradado tomado por luz desigual y aplanado).
    await page.addScriptTag({ path: path.join(__dirname, 'lib', 'clon-estilos.js') });
    const verdad = await page.evaluate(() => {
      const E = clonEstilos, n = 384, A = E.scenes.retrato(n), B = E.scenes.cuarto(n), out = {};
      for (const name of E.names) {
        const rA = E.styled(A, E.recipes[name]), look = flipClon.learn(rA, n, n);
        const cA = document.createElement('canvas'), cB = document.createElement('canvas'); cA.width = cA.height = cB.width = cB.height = n;
        flipClon._render(look, A, cA); flipClon._render(look, B, cB);
        const f = v => +(v * 100).toFixed(1), dA = E.apart(cA, rA), px = (c, x, y) => Math.max(...c.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data.slice(0, 3));
        out[name] = { lejos: f(dA.lejos), cerca: f(dA.cerca), otra: f(E.apart(cB, rA).reparto), cerrada: look.limited, suave: look.soft || 0, resplandor: look.glow || null, hombro: px(cA, 192, 350), halo: [px(rA, 348, 60), px(cA, 348, 60)], dice: flipClon.describe(look) };
      }
      return out;
    });
    const V = verdad;
    assert.ok(V.neon.resplandor && Math.abs(V.neon.resplandor.amount - 0.7) < 0.25 && V.neon.resplandor.size >= 0.024 && V.neon.resplandor.size <= 0.038, 'el resplandor del neón se mide (cantidad 0,7, ancho 3 %): ' + JSON.stringify(V.neon.resplandor));
    assert.ok(Math.abs(V.neon.halo[0] - V.neon.halo[1]) <= 14, 'y se pinta: junto a la lámpara hay la misma luz que en la referencia: ' + V.neon.halo);
    assert.ok(V.neon.hombro <= 2, 'el negro absoluto sale negro absoluto (antes, gris 10): ' + V.neon.hombro);
    assert.ok(V.neon.lejos < 4, 'el neón se reconstruye (antes 11,5): ' + V.neon.lejos);
    assert.ok(V.termico.suave > 0.009 && V.termico.suave < 0.017 && V.cian.suave > 0.009 && V.cian.suave < 0.021, 'la suavidad se mide (1,2 % y 1,6 % del ancho): ' + V.termico.suave + ' / ' + V.cian.suave);
    assert.ok(!V.termico.resplandor && !V.cian.resplandor && !V.cianotipo.resplandor && !V.dominante.resplandor && !V.cartel.resplandor, 'sin resplandor donde no lo hay');
    assert.ok(!V.neon.suave && !V.cianotipo.suave && !V.dominante.suave && !V.cartel.suave, 'sin suavidad donde la imagen es nítida');
    assert.ok(V.termico.lejos < 4 && V.cian.lejos < 4.5 && V.cianotipo.lejos < 2.5 && V.cartel.lejos < 3.5, 'los demás se reconstruyen: ' + JSON.stringify([V.termico.lejos, V.cian.lejos, V.cianotipo.lejos, V.cartel.lejos]));
    assert.ok(V.dominante.lejos < 2.2, 'una foto con dominante conserva los colores de la escena, corridos (antes 5,2): ' + V.dominante.lejos);
    assert.ok(V.cartel.cerrada && !V.neon.cerrada && !V.dominante.cerrada, 'el cartel sigue siendo de tintas planas; lo demás, color continuo');
    for (const name of ['neon', 'termico', 'cian', 'cianotipo', 'dominante']) assert.ok(V[name].otra < 3, name + ': otra escena queda con el reparto de color de la referencia: ' + V[name].otra);
    assert.ok(/resplandor/.test(V.neon.dice) && /suave/.test(V.cian.dice), 'y lo dice: ' + V.neon.dice + ' / ' + V.cian.dice);
    step('contra la verdad: reconstruye estilos de receta conocida', Object.fromEntries(Object.entries(V).map(([k, v]) => [k, [v.lejos, v.cerca, v.otra]])));

    // ── 1d · FIGURA: con la máscara de una persona, ella toma el look y lo demás se va al fondo ──
    // (sin máscara el look se reparte por luz: la ventana, que es lo más claro del cuarto, se enciende
    //  igual que la cara. La máscara aquí es conocida: la cabeza y el cuerpo de la escena «cuarto»)
    const figura = await page.evaluate(() => {
      const E = clonEstilos, n = 384, A = E.scenes.retrato(n), B = E.scenes.cuarto(n), look = flipClon.learn(E.styled(A, E.recipes.neon), n, n);
      const m = 96, mc = document.createElement('canvas'); mc.width = mc.height = m; const mx = mc.getContext('2d', { willReadFrequently: true }), k = m / 384;
      mx.fillStyle = '#000'; mx.fillRect(0, 0, m, m); mx.fillStyle = '#fff';
      mx.beginPath(); mx.ellipse(200 * k, 170 * k, 34 * k, 42 * k, 0, 0, 7); mx.fill();
      mx.beginPath(); mx.moveTo(140 * k, 330 * k); mx.quadraticCurveTo(200 * k, 180 * k, 262 * k, 330 * k); mx.fill();
      const md = mx.getImageData(0, 0, m, m).data, mask = { data: Float32Array.from({ length: m * m }, (_, i) => md[i * 4] / 255), width: m, height: m };
      const run = withMask => { const o = document.createElement('canvas'); o.width = o.height = n; flipClon._render(look, B, o, withMask ? mask : undefined); const d = o.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, n, n).data; return (x, y) => Math.max(d[4 * (y * n + x)], d[4 * (y * n + x) + 1], d[4 * (y * n + x) + 2]); };
      const plain = run(false), cut = run(true);
      const pts = { ventana: [90, 100], lampara: [300, 120], cara: [200, 170], piso: [60, 350], junto: [200, 121] }, out = {};
      for (const key in pts) out[key] = [plain(...pts[key]), cut(...pts[key])];
      // sin nadie en cuadro (máscara vacía) todo sigue como sin FIGURA
      const none = { data: new Float32Array(m * m), width: m, height: m }, o = document.createElement('canvas'); o.width = o.height = n; flipClon._render(look, B, o, none);
      const dn = o.getContext('2d', { willReadFrequently: true }).getImageData(90, 100, 1, 1).data;
      // El detector de verdad es un modelo de selfies y a veces toma un mueble por persona. Aquí su
      // máscara trae a la persona Y a la caja verde del cuarto; con las caras del cuadro, solo cuenta
      // la mancha que toca una cara. Y sin ninguna cara, nada es figura.
      mx.fillRect(40 * k, 250 * k, 70 * k, 60 * k);
      const md2 = mx.getImageData(0, 0, m, m).data, both = Float32Array.from({ length: m * m }, (_, i) => md2[i * 4] / 255), face = [[166 / 384, 128 / 384, 234 / 384, 212 / 384, 0.9]];
      const read = extra => { const c = document.createElement('canvas'); c.width = c.height = n; flipClon._render(look, B, c, { data: both, width: m, height: m, ...extra }); const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, n, n).data; return (x, y) => Math.max(d[4 * (y * n + x)], d[4 * (y * n + x) + 1], d[4 * (y * n + x) + 2]); };
      const trusted = read({}), faced = read({ faces: face }), faceless = read({ faces: [] });
      // el borde: de la persona al fondo se pasa poco a poco (cuántos puntos tarda en caer del 80 % al 20 %)
      let from = -1, to = -1; const top = faced(200, 170); for (let x = 200; x < 300; x++) { const v = faced(x, 170); if (from < 0 && v < top * 0.8) from = x; if (to < 0 && v < top * 0.2) { to = x; break; } }
      return { ...out, mueble: [trusted(75, 280), faced(75, 280)], caraConCara: faced(200, 170), sinCara: [faceless(90, 100), faceless(200, 170)], borde: to - from, vacia: Math.max(dn[0], dn[1], dn[2]), datos: [!!look.backdrop, !!look.cdfFig, look.otOwn], dice: flipClon.describe({ ...look, figure: true }) };
    });
    assert.ok(figura.datos[0] && figura.datos[1] && figura.datos[2] >= 60, 'el look de fondo liso guarda el color de su fondo y los tonos y muestras de la figura sola: ' + figura.datos);
    assert.ok(figura.ventana[0] > 90 && figura.ventana[1] <= 3 && figura.lampara[1] <= 6 && figura.piso[1] <= 3, 'con FIGURA, lo que no es persona se va al negro del fondo (la ventana: ' + figura.ventana + ', la lámpara: ' + figura.lampara + ')');
    assert.ok(figura.cara[1] > 140, 'y la persona se enciende con la luz de la figura: ' + figura.cara);
    assert.ok(figura.junto[1] > 4 && figura.junto[1] < figura.cara[1], 'con su resplandor derramado sobre el fondo: ' + figura.junto);
    assert.ok(Math.abs(figura.vacia - figura.ventana[0]) <= 2, 'sin nadie en cuadro, la cámara sigue como siempre: ' + figura.vacia + ' / ' + figura.ventana[0]);
    assert.ok(/figura recortada/.test(figura.dice), 'y lo dice: ' + figura.dice);
    assert.ok(figura.mueble[0] > 12 && figura.mueble[1] <= 3 && figura.caraConCara > 140, 'lo que el detector toma por persona sin serlo (un mueble) no cuenta: solo la mancha que toca una cara: ' + JSON.stringify([figura.mueble, figura.caraConCara]));
    assert.ok(Math.abs(figura.sinCara[0] - figura.ventana[0]) <= 2, 'sin ninguna cara a la vista nada es figura: el look va por luz: ' + figura.sinCara);
    assert.ok(figura.borde >= 4, 'y el borde no corta en seco: de la persona al fondo se pasa en ' + figura.borde + ' puntos');
    step('FIGURA: la persona toma el look y lo demás se va al fondo', figura);

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
    await pickCamera(page, 'CLON');
    await page.waitForFunction(() => camFamily === 'CLON');
    await page.waitForTimeout(700);
    const inicio = await page.evaluate(() => ({ st: flipClon.state(), keys: [...document.querySelectorAll('.si-rapidas.clon-rapidas [data-clon]:not([hidden])')].map(k => k.textContent.trim()), variante: camVariant, banda: document.body.classList.contains('con-rapidas-clon') }));
    assert.deepEqual([inicio.st.looks, inicio.keys, inicio.variante, inicio.banda, inicio.st.gl], [0, ['CAPTURAR', 'ABRIR', 'LOOKS0'], 'NUEVO', true, true], 'sin looks, apunta y ofrece CAPTURAR y ABRIR (y la galería, vacía)');
    // apuntando se ve la cámara tal cual (con color), no un look
    const crudo = await page.evaluate(() => { const g = document.createElement('canvas'); g.width = 64; g.height = 48; const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, 0, 64, 48); const d = c.getImageData(0, 0, 64, 48).data, set = new Set(); for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); return set.size; });
    assert.ok(crudo > 20, 'apuntando se ve la cámara: ' + crudo + ' colores');
    await page.locator('.clon-rapidas [data-clon="copiar"]').click();
    await page.waitForFunction(() => flipClon.state().looks === 1 && !flipClon.state().busy, null, { timeout: 15000 });
    await page.waitForTimeout(1300);
    const capturado = await page.evaluate(() => ({ st: flipClon.state(), look: flipClon.looks()[0], keys: [...document.querySelectorAll('.clon-rapidas [data-clon]:not([hidden])')].map(k => k.textContent.trim()), variantes: [...document.querySelectorAll('#deckVariants [data-variant]')].map(k => k.textContent.trim()), lcd: document.getElementById('lcdLook').textContent, guardado: JSON.parse(localStorage.getItem('flip.clon')).length }));
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
    await page.waitForFunction(() => { const g = document.getElementById('clonGaleria'); return g && !g.hidden && g.getAnimations().every(a => a.playState !== 'running'); }, null, { timeout: 5000 });
    await page.waitForTimeout(150);
    const hoja = () => page.evaluate(() => { const g = document.getElementById('clonGaleria'), r = g.getBoundingClientRect(), v = document.getElementById('display').getBoundingClientRect(); return { abierta: !g.hidden, cuenta: document.getElementById('clonCuenta').textContent, cartas: [...g.querySelectorAll('.clon-carta')].map(c => c.querySelector('b').textContent + (c.classList.contains('is-on') ? '*' : '') + (c.classList.contains('is-fav') ? '★' : '')), nombre: document.getElementById('clonNombre').value, visorLibre: Math.round(r.top - v.top), cabe: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, deshacer: !g.querySelector('.clon-deshacer').hidden, actual: camVariant, lcd: document.getElementById('lcdLook').textContent, fila: [...document.querySelectorAll('#deckVariants [data-variant]')].map(k => k.textContent.trim()) }; });
    let g = await hoja();
    assert.deepEqual([g.abierta, g.cuenta, g.cartas.length, g.cabe], [true, '5 / 30', 5, true], 'la galería se abre con todos los looks: ' + JSON.stringify(g));
    assert.ok(g.visorLibre > 120, 'y deja el visor a la vista (' + g.visorLibre + ' px): lo que se toca se ve en vivo');
    assert.ok(g.cartas.filter(c => c.endsWith('*')).length === 1 && g.nombre === g.cartas.find(c => c.endsWith('*')).slice(0, -1), 'el que está puesto va marcado y con su nombre arriba: ' + JSON.stringify(g.cartas));
    // cada tarjeta dice de qué clase es (su sello) y con qué pinta (su franja); la estrella no es un botón de la tarjeta
    const cartas = await page.evaluate(() => [...document.querySelectorAll('.clon-carta')].map(c => ({ nombre: c.querySelector('b').textContent, tipo: c.querySelector('.clon-tipo').dataset.tipo, firma: /gradient/.test(c.querySelector('.clon-firma').style.background), botones: c.querySelectorAll('button').length, alto: Math.round(c.getBoundingClientRect().height) })));
    assert.deepEqual(Object.fromEntries(cartas.map(c => [c.nombre, c.tipo])), { [cuatro.nombres[0]]: cartas.find(c => c.nombre === cuatro.nombres[0]).tipo, 'TRAMA ROSA': 'trama', 'PÍXEL TURQUESA': 'pixel', 'CARTEL ROJO': 'cartel', 'DUOTONO AZUL': 'duotono' }, 'cada tarjeta lleva el sello de su clase');
    assert.ok(cartas.every(c => c.firma && c.botones === 0 && c.alto > 100 && c.alto < 160), 'con su franja de color, y sin botones dentro: ' + JSON.stringify(cartas.map(c => c.alto)));
    // usar uno que no estaba a la mano: se pone en la cámara y pasa a la fila
    const viejo = cuatro.nombres[0];
    assert.ok(!g.fila.includes(viejo), 'el más viejo no estaba en la fila');
    await page.locator('.clon-carta', { hasText: viejo }).click();
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
    // favorito: la estrella está en el inspector, lejos de BORRAR; la tarjeta no salta de sitio hasta reabrir
    const hueco = await page.evaluate(() => { const a = document.querySelector('[data-clon="fav"]').getBoundingClientRect(), b = document.querySelector('[data-clon="borrar"]').getBoundingClientRect(); return Math.round(b.left - a.right); });
    assert.ok(hueco > 150, 'la estrella y BORRAR, separados (' + hueco + ' px)');
    const antesFav = (await hoja()).cartas.map(c => c.replace(/[*★]/g, ''));
    await page.locator('.clon-carta', { hasText: 'PÍXEL TURQUESA' }).click();
    await page.locator('[data-clon="fav"]').click();
    await page.waitForTimeout(250);
    g = await hoja();
    assert.deepEqual(g.cartas.map(c => c.replace(/[*★]/g, '')), antesFav, 'al marcarla, la tarjeta no salta de sitio bajo el dedo');
    assert.ok(g.cartas.includes('PÍXEL TURQUESA*★'), 'y lleva su estrella: ' + JSON.stringify(g.cartas));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.locator('.clon-rapidas [data-clon="galeria"]').click(); await page.waitForTimeout(300);
    assert.equal((await hoja()).cartas[0], 'PÍXEL TURQUESA*★', 'al reabrir, el favorito va primero');
    // borrar un favorito pide dos toques (sin diálogo); deshacer lo devuelve
    await page.locator('[data-clon="borrar"]').click();
    await page.waitForTimeout(200);
    g = await hoja();
    assert.ok(g.cuenta === 'LOOKS · 5 / 30'.replace('LOOKS · ', '') && (await page.locator('[data-clon="borrar"]').textContent()) === '¿BORRAR?', 'un favorito no se borra al primer toque: ' + JSON.stringify(g.cuenta));
    await page.locator('[data-clon="borrar"]').click();
    await page.waitForTimeout(300);
    g = await hoja();
    assert.ok(g.cuenta === '4 / 30' && g.deshacer && !g.cartas.some(c => c.startsWith('PÍXEL')) && g.actual !== 'NUEVO', 'el segundo toque lo borra y ofrece deshacer: ' + JSON.stringify(g));
    // se cierra la galería con el borrado pendiente: se puede deshacer desde la píldora del visor
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    const pildora = await page.evaluate(() => { const p = document.getElementById('clonPildora'), r = p.getBoundingClientRect(), v = document.getElementById('display').getBoundingClientRect(); return { visible: !p.hidden, texto: p.textContent, dentro: r.top >= v.top && r.bottom <= v.bottom + 2 && r.left >= 0 && r.right <= innerWidth }; });
    assert.ok(pildora.visible && /BORRADO · PÍXEL TURQUESA/.test(pildora.texto) && /DESHACER/.test(pildora.texto) && pildora.dentro, 'cerrada la galería, deshacer sigue a la mano sobre el visor: ' + JSON.stringify(pildora));
    await page.locator('#clonPildora [data-pildora="deshacer"]').click();
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => [flipClon.looks().length, flipClon.looks().some(l => l.name === 'PÍXEL TURQUESA' && l.fav), document.getElementById('lcdLook').textContent.includes('PÍXEL TURQUESA'), document.getElementById('clonPildora').hidden]), [5, true, true, true], 'deshacer lo devuelve, con su estrella y puesto');
    // un look sin estrella se borra de un toque
    await page.locator('.clon-rapidas [data-clon="galeria"]').click(); await page.waitForTimeout(300);
    await page.locator('.clon-carta', { hasText: 'DUOTONO AZUL' }).click();
    await page.locator('[data-clon="borrar"]').click();
    await page.waitForTimeout(300);
    g = await hoja();
    assert.ok(g.cuenta === '4 / 30' && g.deshacer, 'sin estrella, un toque: ' + JSON.stringify(g.cuenta));
    await page.locator('#clonGaleria [data-clon="deshacer"]').click();
    await page.waitForTimeout(300);
    g = await hoja();
    assert.ok(g.cuenta === '5 / 30' && !g.deshacer && g.cartas.includes('DUOTONO AZUL*'), 'y deshacer lo devuelve, puesto: ' + JSON.stringify(g));
    // caben treinta; al llegar el 31 sale el más viejo sin estrella (y se puede deshacer); si todos son favoritos, no se pisa ninguno
    const lleno = await page.evaluate(() => {
      const base = flipClon.looks().find(l => l.name === 'CARTEL ROJO');
      const copia = nombre => { const c = JSON.parse(JSON.stringify(base)); c.name = nombre; c.fav = false; return c; };
      for (let i = 0; i < 25; i++) flipClon.keep(copia('COPIA ' + i));
      const antes = flipClon.looks().map(l => l.name);
      flipClon.fav(flipClon.looks()[0].id, true);                    // el más viejo, protegido
      const entra = flipClon.keep(copia('EL 31'));
      const ahora = flipClon.looks().map(l => l.name);
      const vuelve = flipClon.restore(), tras = flipClon.looks().map(l => l.name);
      for (const l of flipClon.looks()) flipClon.fav(l.id, true);
      const sinSitio = flipClon.keep(copia('EL QUE NO CABE'));
      for (const l of flipClon.looks().slice(2)) flipClon.fav(l.id, false);
      return { max: flipClon.MAX, antes: antes.length, ahora: ahora.length, salio: antes.filter(n => !ahora.includes(n)), primero: ahora[0], ultimo: ahora[ahora.length - 1], entra: !!entra, vuelve: vuelve && vuelve.name, tras: [tras.length, tras.includes('EL 31'), tras.includes('TRAMA ROSA')], sinSitio, total: flipClon.looks().length, fila: [...document.querySelectorAll('#deckVariants [data-variant]')].length, bytes: localStorage.getItem('flip.clon').length };
    });
    assert.deepEqual([lleno.max, lleno.antes, lleno.ahora, lleno.ultimo, lleno.fila], [30, 30, 30, 'EL 31', 4], 'caben treinta y la fila sigue con cuatro: ' + JSON.stringify(lleno));
    assert.ok(lleno.salio.length === 1 && lleno.salio[0] === 'TRAMA ROSA' && lleno.primero === 'MI CARTEL FAVORITO', 'al llegar el 31 sale el más viejo sin estrella: ' + JSON.stringify(lleno.salio));
    assert.deepEqual([lleno.vuelve, lleno.tras], ['TRAMA ROSA', [30, false, true]], 'y deshacer devuelve al que salió y quita al que entró');
    assert.deepEqual([lleno.sinSitio, lleno.total], [null, 30], 'con treinta favoritos no se pisa ninguno: el nuevo no se guarda');
    assert.ok(lleno.bytes < 400000, 'treinta looks con miniatura pesan poco: ' + lleno.bytes + ' caracteres');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    assert.equal((await hoja()).abierta, false, 'Escape la cierra');
    // la mascota mira hacia arriba mientras la galería está abierta
    await page.locator('.clon-rapidas [data-clon="galeria"]').click(); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.getElementById('deckShutter').classList.contains('hojea')), true, 'con la galería abierta, la mascota la mira');
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.getElementById('deckShutter').classList.contains('hojea')), false);
    step('la galería: usar, nombrar, favorito, borrar y deshacer; treinta looks', { cuenta: lleno.ahora, pesa: lleno.bytes, visorLibre: g.visorLibre });

    // ── 7 · En la piel OBJETO: sus teclas, en una fila del aparato ──
    const objeto = await openFlip(browser, { piel: 'objeto', sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await objeto.page.waitForTimeout(600);
    await pickCamera(objeto.page, 'CLON');
    await objeto.page.waitForFunction(() => camFamily === 'CLON');
    await objeto.page.waitForTimeout(600);
    const fila = await objeto.page.evaluate(() => { const row = document.querySelector('.clon-teclas'), r = row.getBoundingClientRect(); return { visible: !row.hidden && r.height > 20, teclas: [...row.querySelectorAll('button:not([hidden])')].map(k => k.textContent.trim()), cabe: r.right <= innerWidth + 1, banda: getComputedStyle(document.querySelector('.clon-rapidas')).display }; });
    assert.deepEqual(fila, { visible: true, teclas: ['CAPTURAR', 'ABRIR', 'LOOKS0'], cabe: true, banda: 'none' }, 'en OBJETO, tres teclas del aparato');
    await objeto.page.locator('.clon-teclas [data-clon="copiar"]').click();
    await objeto.page.waitForFunction(() => flipClon.state().looks === 1 && !flipClon.state().busy, null, { timeout: 15000 });
    await objeto.page.locator('.clon-teclas [data-clon="galeria"]').click();
    await objeto.page.waitForTimeout(350);
    const charola = await objeto.page.evaluate(() => { const g = document.getElementById('clonGaleria'), r = g.getBoundingClientRect(); return { abierta: !g.hidden, cartas: g.querySelectorAll('.clon-carta').length, cabe: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, redonda: parseFloat(getComputedStyle(g).borderTopLeftRadius) > 10 }; });
    assert.deepEqual(charola, { abierta: true, cartas: 1, cabe: true, redonda: true }, 'y la galería, con la piel del aparato');
    // la tecla FIGURA: no existe en un look sin fondo liso; en uno con fondo aparece, cabe y recorta en vivo
    await objeto.page.evaluate(() => flipClon.gallery(false));
    await objeto.page.waitForTimeout(450);
    await objeto.page.addScriptTag({ path: path.join(__dirname, 'lib', 'clon-estilos.js') });
    const sinFondo = await objeto.page.evaluate(() => ({ oculta: document.querySelector('.clon-teclas [data-clon="figura"]').hidden, figura: flipClon.state().figure }));
    assert.deepEqual(sinFondo, { oculta: true, figura: null }, 'en un look sin fondo liso no hay tecla FIGURA');
    await objeto.page.evaluate(() => {
      const E = clonEstilos, look = flipClon.keep(flipClon.learn(E.styled(E.scenes.retrato(384), E.recipes.neon), 384, 384));
      flipClon.use(look.id);
      // (un detector de mentira: «hay una persona» en el centro del cuadro)
      window.__cara = true;
      flipSilhouette.use(input => { const w = 64, h = Math.max(8, Math.round(64 * input.height / input.width)), data = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x / w - 0.5) / 0.22) ** 2 + ((y / h - 0.5) / 0.34) ** 2 < 1) data[y * w + x] = 1; return { data, width: w, height: h, faces: window.__cara ? [[0.42, 0.3, 0.58, 0.46, 0.9]] : [] }; });
    });
    await objeto.page.waitForTimeout(500);
    const antes = await objeto.page.evaluate(() => { const row = document.querySelector('.clon-teclas'), key = row.querySelector('[data-clon="figura"]'), r = row.getBoundingClientRect(), kr = key.getBoundingClientRect(); return { visible: !key.hidden && kr.width > 20 && kr.height > 20, cabe: r.right <= innerWidth + 1 && kr.right <= innerWidth + 1, puesta: key.getAttribute('aria-pressed'), figura: (({ on, cut, share }) => ({ on, cut, share }))(flipClon.state().figure) }; });
    assert.deepEqual(antes, { visible: true, cabe: true, puesta: 'false', figura: { on: false, cut: false, share: 0 } }, 'en un look de fondo liso, la tecla FIGURA aparece (apagada) y cabe: ' + JSON.stringify(antes));
    await objeto.page.locator('.clon-teclas [data-clon="figura"]').click();
    await objeto.page.waitForFunction(() => { const f = flipClon.state().figure; return f && f.on && f.cut; }, null, { timeout: 8000 });
    const puesta = await objeto.page.evaluate(() => {
      const g = document.createElement('canvas'); g.width = 64; g.height = 48; const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, 0, 64, 48);
      const d = c.getImageData(0, 0, 64, 48).data, at = (x, y) => Math.max(d[4 * (y * 64 + x)], d[4 * (y * 64 + x) + 1], d[4 * (y * 64 + x) + 2]);
      let centro = 0; for (let y = 16; y < 32; y++) for (let x = 26; x < 38; x++) centro = Math.max(centro, at(x, y));
      return { figura: flipClon.state().figure, tecla: document.querySelector('.clon-teclas [data-clon="figura"]').getAttribute('aria-pressed'), esquinas: [at(2, 2), at(61, 2), at(2, 45), at(61, 45)], centro, guardada: JSON.parse(localStorage.getItem('flip.clon')).some(l => l.figure) };
    });
    assert.ok(puesta.tecla === 'true' && puesta.guardada && puesta.figura.share > 0.05, 'al tocarla queda puesta, guardada con el look, y hay persona en cuadro: ' + JSON.stringify(puesta.figura));
    assert.ok(puesta.esquinas.every(v => v <= 6) && puesta.centro > 60, 'en el visor, fuera de la persona está el negro del fondo y dentro hay imagen: ' + JSON.stringify([puesta.esquinas, puesta.centro]));
    // la persona se va (ya no hay cara): se la sigue unos segundos y luego la cámara vuelve a repartir por luz
    await objeto.page.evaluate(() => { window.__cara = false; });
    await objeto.page.waitForTimeout(1500);
    const siguiendo = await objeto.page.evaluate(() => flipClon.state().figure.cut);
    await objeto.page.waitForFunction(() => !flipClon.state().figure.cut, null, { timeout: 9000 });
    assert.equal(siguiendo, true, 'sin cara un momento (se dio la vuelta), la figura se sigue');
    await objeto.page.evaluate(() => { window.__cara = true; });
    await objeto.page.waitForFunction(() => flipClon.state().figure.cut, null, { timeout: 6000 });
    assert.deepEqual(objeto.errors, []);
    step('piel OBJETO: captura con sus teclas y abre su galería; FIGURA aparece solo con fondo liso y recorta en vivo', { ...fila, figura: puesta.figura });

    assert.deepEqual(errors, []);
    console.log('CLON PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
