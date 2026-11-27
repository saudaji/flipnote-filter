// FILM: la película revelada paso a paso (docs/film.js): negativos de color y de plata copiados en
// papel, diapositivas vistas a contraluz y películas experimentales. Se prueba con cartas de las que
// se sabe qué tienen que dar. Lo que tiene que seguir siendo verdad:
//   · LA ESCALA DE GRISES sale gris de punta a punta, con el gris medio en el 18 %, y la gráfica da
//     lo mismo que la cuenta de referencia (la física, sin GPU);
//   · EL MARGEN: con EXPOSICIÓN de −2 a +2 pasos el gris medio no se mueve (la ampliadora lo centra)
//     y las luces no se queman de golpe;
//   · EL COLOR: un color puro no se deslava ni cambia de familia, y la piel no se va al amarillo;
//   · LA HALACIÓN: una luz sobre negro deja un halo, rojo antes que verde y azul; mucho en la película
//     de cine sin capa antihalo y casi nada en las otras; y no inventa luz (lo que da, lo quita);
//   · EL GRANO: se ve, es mayor cuanto más chico el formato, cambia con la densidad y se puede quitar;
//   · NEGRO HONDO Y GRANO PROFUNDO: las de color dejan el negro tan hondo como las de blanco y negro,
//     y su grano mueve la luz más que el color (las capas lo comparten);
//   · CINE CHICO (SÚPER 8 y SÚPER 16): el cuadro es tan pequeño que el grano se dibuja cristal a
//     cristal (sueltos donde llegó poca luz), la emulsión quita nitidez, y el tono no se mueve;
//   · EL OBTURADOR DE CINE (vídeo): lo que se mueve deja estela a lo largo de su camino, lo quieto no
//     cambia y el ruido del sensor no se toma por movimiento;
//   · EMPUJE y PAPEL mueven el contraste hacia donde dicen;
//   · CADA PELÍCULA ES LO QUE DICE: el blanco y negro no tiene color y cambia con FILTRO y VIRADO; la
//     ortocromática no ve el rojo; la diapositiva tiene más color y EXPOSICIÓN la aclara de verdad; la
//     que no se blanqueó casi no tiene color; la cruzada tiñe luces y sombras al revés; el rollo al
//     revés sale naranja; y la de colores cambiados vuelve púrpura el verde;
//   · LOS CAJONES: la tira de cámaras va en tres (FILM · DIGITAL · CUSTOM); cada uno enseña solo las
//     suyas y recuerda su última cámara; en FILM cada película es una diapositiva;
//   · LA CÁMARA: sus películas y sus perillas (cada película enseña las que le tocan); lo ajustado se
//     guarda; toma la foto; grabando vídeo revela una sola vez por cuadro; y al cambiar de cámara
//     suelta la gráfica.
//   FLIP_URL=http://127.0.0.1:8760 node tests/film.cjs
'use strict';
const assert = require('node:assert/strict');
const { launch, openFlip, pickCamera } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForTimeout(600);
    await page.evaluate(() => localStorage.removeItem('flip.film'));
    // El equipo de medida, en la página: cartas de parches y lectura del revelado en luz lineal.
    await page.evaluate(() => {
      const toLin = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const toSrc = v => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));       // (el motor lee la cámara con gamma 2,2)
      window.filmKit = {
        toLin,
        // Una carta de parches (colores en luz lineal), cada uno de 40 × 40.
        chart(colors) { const c = document.createElement('canvas'); c.width = 40 * colors.length; c.height = 40; const x = c.getContext('2d'); colors.forEach((rgb, i) => { x.fillStyle = 'rgb(' + rgb.map(toSrc).join(',') + ')'; x.fillRect(i * 40, 0, 40, 40); }); return c; },
        // Revela y devuelve la media (lineal) del centro de cada parche.
        patches(colors, options) {
          flipFilm.develop(this.chart(colors), { grain: false, ...options });
          const r = flipFilm.read();
          return colors.map((_, i) => { const sum = [0, 0, 0]; let n = 0; for (let y = 12; y < 28; y++) for (let x = i * 40 + 12; x < i * 40 + 28; x++) { const o = (y * r.w + x) * 4; for (let c = 0; c < 3; c++) sum[c] += toLin(r.data[o + c]); n++; } return sum.map(v => +(v / n).toFixed(4)); });
        },
        gray: ev => { const v = Math.min(1, 0.18 * Math.pow(2, ev)); return [v, v, v]; },
        oklab([r, g, b]) { const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b); return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; },
      };
    });

    // ── 1 · La escala de grises ──
    const wedge = await page.evaluate(() => {
      const evs = [-5, -4, -3, -2, -1, 0, 1, 2], P = flipFilm.physics, out = {};
      for (const stock of Object.keys(P.STOCKS)) {
        const film = P.prepare(stock, { push: 0 }), table = P.printTable(film);
        out[stock] = { gpu: filmKit.patches(evs.map(filmKit.gray), { stock }), ref: evs.map(ev => P.develop(film, table, filmKit.gray(ev), 0).print.map(v => +v.toFixed(4))) };
      }
      return { evs, out, state: flipFilm.state() };
    });
    assert.ok(wedge.state.gl && wedge.state.float && !wedge.state.failed, 'revela en la gráfica, con precisión flotante: ' + JSON.stringify(wedge.state));
    // Las que tiñen el gris a propósito (es su carácter) y la que ni siquiera lo centra (el rollo al revés).
    const TINTED = ['CALIDO200', 'CALLE400', 'AMBAR160', 'CRUZADO100', 'REVES200'];
    const SLIDES = ['VIVA50', 'REPORTAJE64'];
    assert.equal(Object.keys(wedge.out).length, 16, 'las dieciséis películas');
    for (const [stock, { gpu, ref }] of Object.entries(wedge.out)) {
      const mid = gpu[5], lum = gpu.map(p => (p[0] + p[1] + p[2]) / 3);
      if (stock !== 'REVES200') assert.ok(Math.abs(lum[5] - 0.18) < 0.02, stock + ': el gris medio sale al 18 %: ' + mid);
      // (en los negros más hondos de una diapositiva ya no queda escalón de 8 bits que los separe)
      for (let i = 1; i < lum.length; i++) assert.ok(i < 3 ? lum[i] >= lum[i - 1] : lum[i] > lum[i - 1], stock + ': la escala sube siempre: ' + lum.map(v => v.toFixed(3)));
      // gris de punta a punta
      // (en los tonos más oscuros un escalón de 8 bits ya es un 5 %: ahí se mira la diferencia absoluta)
      const tint = Math.max(...gpu.map(p => (Math.max(...p) - Math.min(...p)) / Math.max(0.06, (p[0] + p[1] + p[2]) / 3)));
      // (una diapositiva no tiene máscara ni copia que la limpie: sus sombras se van un pelo al cian)
      if (!TINTED.includes(stock)) assert.ok(tint < (SLIDES.includes(stock) ? 0.12 : 0.07), stock + ': los grises no se tiñen: ' + tint.toFixed(3) + ' ' + JSON.stringify(gpu));
      // la gráfica y la cuenta de referencia dan lo mismo (la referencia, recortada a lo que una pantalla enseña)
      const gap = Math.max(...gpu.map((p, i) => Math.max(...p.map((v, c) => Math.abs(v - Math.min(1, Math.max(0, ref[i][c])))))));
      assert.ok(gap < 0.02, stock + ': la gráfica coincide con la referencia: ' + gap.toFixed(4));
      // contraste: de −1 a +1 pasos, más de lo que entra salvo en la película de cine suave
      const gamma = Math.log(lum[6] / lum[4]) / Math.log(4);
      assert.ok(gamma > 0.85 && gamma < 1.7, stock + ': contraste razonable: ' + gamma.toFixed(2));
    }
    step('la escala de grises sale gris, con el gris medio al 18 %, y la gráfica coincide con la referencia', Object.fromEntries(Object.entries(wedge.out).map(([k, v]) => [k, v.gpu.map(p => +((p[0] + p[1] + p[2]) / 3).toFixed(3))])));

    // ── 2 · El margen de exposición ──
    const latitude = await page.evaluate(() => [-2, -1, 0, 1, 2].map(ev => ({ ev, p: filmKit.patches([filmKit.gray(-3), filmKit.gray(0), filmKit.gray(1.5), filmKit.gray(2.4)], { stock: 'RETRATO400', ev }) })));
    for (const { ev, p } of latitude) {
      assert.ok(Math.abs(p[1][1] - 0.18) < 0.025, 'con ' + ev + ' pasos el gris medio sigue al 18 %: ' + p[1]);
      assert.ok(p[3][1] > p[2][1] + 0.03, 'con ' + ev + ' pasos las luces aún se distinguen: ' + [p[2][1], p[3][1]]);
      assert.ok(p[0][1] < 0.07, 'con ' + ev + ' pasos las sombras siguen oscuras: ' + p[0][1]);
    }
    // sobreexponer abre las sombras (el negativo las saca del pie); subexponer las aplasta
    assert.ok(latitude[0].p[0][1] > latitude[4].p[0][1] * 1.4, 'subexpuesto, el negro se levanta (la copia tira del pie): ' + [latitude[0].p[0][1], latitude[4].p[0][1]]);
    step('con EXPOSICIÓN de −2 a +2 el gris medio no se mueve y las luces aguantan', latitude.map(l => l.ev + ': ' + l.p.map(p => p[1].toFixed(3)).join(' ')));

    // ── 3 · El color ──
    const colour = await page.evaluate(() => {
      const lin = rgb => rgb.map(v => Math.pow(v / 255, 2.2));
      const P = { rojo: [175, 54, 60], verde: [70, 148, 73], azul: [56, 61, 150], amarillo: [231, 199, 31], magenta: [187, 86, 149], piel: [194, 150, 130], pielOscura: [115, 82, 68], follaje: [87, 108, 67], naranja: [214, 126, 44] };
      const ins = Object.values(P).map(lin), out = {};
      for (const stock of ['RETRATO400', 'CALIDO200', 'CINE500T']) {
        const got = filmKit.patches(ins, { stock });
        out[stock] = Object.keys(P).map((name, i) => { const a = filmKit.oklab(ins[i]), b = filmKit.oklab(got[i]); return { name, chroma: +(Math.hypot(b[1], b[2]) / Math.hypot(a[1], a[2])).toFixed(2), hue: Math.round(((Math.atan2(b[2], b[1]) - Math.atan2(a[2], a[1])) * 180 / Math.PI + 540) % 360 - 180) }; });
      }
      return out;
    });
    for (const [stock, rows] of Object.entries(colour)) {
      for (const row of rows) {
        assert.ok(row.chroma > 0.8 && row.chroma < 1.6, stock + ' · ' + row.name + ': ni deslavado ni chillón: ×' + row.chroma);
        assert.ok(Math.abs(row.hue) < (stock === 'CALIDO200' ? 20 : 14), stock + ' · ' + row.name + ': sigue siendo su color: ' + row.hue + '°');
      }
    }
    const mean = stock => colour[stock].reduce((s, r) => s + r.chroma, 0) / colour[stock].length;
    assert.ok(mean('CALIDO200') > mean('RETRATO400') + 0.04, 'la película de diario tiene más color que la de retrato: ' + [mean('CALIDO200'), mean('RETRATO400')].map(v => v.toFixed(2)));
    step('los colores puros no se deslavan ni cambian de familia; la piel no se va al amarillo', Object.fromEntries(Object.entries(colour).map(([k, rows]) => [k, rows.map(r => r.name + ' ×' + r.chroma + ' ' + r.hue + '°').join(', ')])));

    // ── 4 · La halación ──
    const halo = await page.evaluate(() => {
      const W = 480, H = 320, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; x.beginPath(); x.arc(W / 2, H / 2, 40, 0, 7); x.fill();
      const out = {};
      for (const stock of ['CINE500T', 'RETRATO400']) {
        // (modo 2: la exposición que le llega a cada capa, en log10 H; 0…1 son −3…+3)
        flipFilm.develop(c, { stock, grain: false, format: 3, mode: 2 });
        const e = flipFilm.read(), at = r => { const o = ((H / 2) * W + Math.round(W / 2 + r)) * 4; return [0, 1, 2].map(k => +(e.data[o + k] / 255 * 6 - 3).toFixed(2)); };
        flipFilm.develop(c, { stock, grain: false, format: 3 });
        const p = flipFilm.read(), ring = r => { const o = ((H / 2) * W + Math.round(W / 2 + r)) * 4; return [0, 1, 2].map(k => +filmKit.toLin(p.data[o + k]).toFixed(4)); };
        out[stock] = { expo: { near: at(46), far: at(120) }, print: { near: ring(46), mid: ring(52), far: ring(150), centre: ring(0) } };
      }
      return out;
    });
    const cine = halo.CINE500T, retrato = halo.RETRATO400;
    assert.ok(cine.expo.near[0] > cine.expo.near[1] + 0.3 && cine.expo.near[1] > cine.expo.near[2] + 0.3, 'el halo llega más a la capa roja, luego a la verde, luego a la azul: ' + cine.expo.near);
    assert.ok(cine.print.near[0] > 0.045 && cine.print.near[0] > cine.print.near[1] * 1.6 && cine.print.near[0] > cine.print.near[2] * 2.5, 'pegado a la luz, el halo es rojo: ' + cine.print.near);
    assert.ok(cine.print.far[0] < 0.03, 'lejos de la luz no hay halo: ' + cine.print.far);
    assert.ok(retrato.print.near[0] < cine.print.near[0] * 0.5, 'la película con capa antihalo casi no lo tiene: ' + [retrato.print.near[0], cine.print.near[0]]);
    assert.ok(cine.print.centre.every(v => v > 0.85), 'la luz sigue blanca en su centro: ' + cine.print.centre);
    step('la halación: halo rojo alrededor de la luz en CINE 500T, casi nada en RETRATO 400', { cine: cine.print, retrato: retrato.print.near });

    // ── 5 · El grano ──
    const grain = await page.evaluate(() => {
      // (una tira de 1024 de ancho: en medio cuadro —el formato 2— cada punto son 23 micras de película, como en una foto)
      const W = 1024, H = 256, flat = v => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const s = Math.round(255 * Math.pow(v, 1 / 2.2)); x.fillStyle = `rgb(${s},${s},${s})`; x.fillRect(0, 0, W, H); return c; };
      const sd = (canvas, options) => {
        flipFilm.develop(canvas, { stock: 'RETRATO400', ...options });
        const r = flipFilm.read(); let n = 0, sum = 0, sq = 0;
        for (let y = 20; y < H - 20; y++) for (let x = 20; x < W - 20; x++) { const v = r.data[(y * W + x) * 4 + 1] / 255; sum += v; sq += v * v; n++; }
        return +Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)).toFixed(4);
      };
      const mid = flat(0.18);
      return {
        off: sd(mid, { grain: false, format: 3 }), formats: [2, 3, 4, 5].map(format => sd(mid, { grain: true, format })),
        tones: [0.01, 0.18, 0.7].map(v => sd(flat(v), { grain: true, format: 2 })),
        pushed: sd(mid, { grain: true, format: 2, push: 2 }), plain: sd(mid, { grain: true, format: 2, push: 0 }),
        seeds: [1.1, 2.2].map(seed => { flipFilm.develop(mid, { stock: 'RETRATO400', format: 2, seed }); const r = flipFilm.read(); return r.data[(128 * W + 128) * 4 + 1]; }),
      };
    });
    assert.ok(grain.off < 0.004, 'sin grano, un gris liso sale liso: ' + grain.off);
    assert.ok(grain.formats[0] > 0.012, 'en medio cuadro el grano se ve: ' + grain.formats[0]);
    for (let i = 1; i < 4; i++) assert.ok(grain.formats[i] < grain.formats[i - 1] * 0.85, 'cuanto mayor el formato, menos grano: ' + grain.formats);
    assert.ok(grain.tones[1] > grain.tones[0] * 1.3, 'el grano cambia con la densidad (más en los medios que en el negro de la copia): ' + grain.tones);
    assert.ok(grain.pushed > grain.plain * 1.15, 'empujar agranda el grano: ' + [grain.plain, grain.pushed]);
    step('el grano: se ve, baja con el formato, cambia con el tono y sube al empujar', grain);

    // ── 5b · Negro hondo y grano profundo (las de color, a la altura de las de blanco y negro) ──
    const deep = await page.evaluate(() => {
      const P = flipFilm.physics, lum = p => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      // el negro de la escena (ocho pasos bajo el gris medio), película por película
      const black = Object.fromEntries(Object.keys(P.STOCKS).map(stock => [stock, +lum(filmKit.patches([filmKit.gray(-8), filmKit.gray(0)], { stock })[0]).toFixed(4)]));
      // un gris liso con grano: cuánto se mueve la luminancia, cuánto el color, y cuánto van juntas las capas
      const W = 1024, H = 256, flat = v => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const s = Math.round(255 * Math.pow(v, 1 / 2.2)); x.fillStyle = `rgb(${s},${s},${s})`; x.fillRect(0, 0, W, H); return c; };
      const stats = (stock, v, format = 2) => {
        flipFilm.develop(flat(v), { stock, format, grain: true }); const r = flipFilm.read();
        let n = 0; const m = [0, 0, 0], q = [0, 0, 0]; let rg = 0, d = 0, d2 = 0;
        for (let y = 20; y < H - 20; y++) for (let x = 20; x < W - 20; x++) { const o = (y * W + x) * 4, R = r.data[o], G = r.data[o + 1], B = r.data[o + 2]; m[0] += R; m[1] += G; m[2] += B; q[0] += R * R; q[1] += G * G; q[2] += B * B; rg += R * G; d += R - G; d2 += (R - G) * (R - G); n++; }
        const sd = k => Math.sqrt(Math.max(0, q[k] / n - (m[k] / n) ** 2));
        return { luz: +sd(1).toFixed(2), color: +Math.sqrt(Math.max(0, d2 / n - (d / n) ** 2)).toFixed(2), juntas: +((rg / n - m[0] * m[1] / n / n) / Math.max(1e-6, sd(0) * sd(1))).toFixed(2), media: Math.round(m[1] / n) };
      };
      // el relieve del baño: un escalón de gris oscuro a gris claro, a tamaño de foto (el revelador
      // gastado alcanza unas 95 micras: en 35 mm, a 1024 puntos, no llega a tres)
      const stepOf = (stock, EW = 2560) => {
        const c = document.createElement('canvas'); c.width = EW; c.height = 64; const x = c.getContext('2d'), s = v => { const k = Math.round(255 * Math.pow(v, 1 / 2.2)); return `rgb(${k},${k},${k})`; };
        x.fillStyle = s(0.06); x.fillRect(0, 0, EW / 2, 64); x.fillStyle = s(0.40); x.fillRect(EW / 2, 0, EW / 2, 64);
        flipFilm.develop(c, { stock, grain: false }); const r = flipFilm.read(), at = px => r.data[(32 * EW + px) * 4 + 1], near = Math.round(EW / 850), mid = Math.round(EW / 20);
        const far = Math.round(EW / 5); return { oscuroLejos: at(EW / 2 - far), oscuroCerca: at(EW / 2 - Math.max(3, near)), claroCerca: at(EW / 2 + Math.max(3, near)), claroMedio: at(EW / 2 + mid), claroLejos: at(EW / 2 + far) };
      };
      const blotch = (() => {
        flipFilm.develop(flat(0.18), { stock: 'RETRATO400', format: 0, grain: true }); const r = flipFilm.read();
        const d = (x, y) => { const o = (y * W + x) * 4; return r.data[o] - r.data[o + 2]; };
        let n = 0, m = 0, q = 0; for (let y = 32; y < H - 32; y++) for (let x = 32; x < W - 32; x++) { const v = d(x, y); m += v; q += v * v; n++; }
        const fino = Math.sqrt(q / n - (m / n) ** 2);
        let bn = 0, bm = 0, bq = 0; for (let y = 32; y + 16 < H - 32; y += 16) for (let x = 32; x + 16 < W - 32; x += 16) { let a = 0; for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) a += d(x + i, y + j); a /= 256; bm += a; bq += a * a; bn++; }
        return { fino: +fino.toFixed(2), ancho: +Math.sqrt(Math.max(0, bq / bn - (bm / bn) ** 2)).toFixed(2) };
      })();
      return {
        blotch, black, retrato: stats('RETRATO400', 0.18), cine: stats('CINE500T', 0.18), mono: stats('BNORTO80', 0.18),
        slide: { luces: stats('VIVA50', 0.9), medios: stats('VIVA50', 0.12) }, negative: { sombras: stats('RETRATO400', 0.012), medios: stats('RETRATO400', 0.18) },
        edge: { retrato: stepOf('RETRATO400'), viva: stepOf('VIVA50'), orto: stepOf('BNORTO80', 1024) }, noche: { super8: stats('BNNOCHE3200', 0.18, 0), super16: stats('BNNOCHE3200', 0.18, 1), medio: stats('BNNOCHE3200', 0.18, 2) }, csf: [P.csfOf(P.STOCKS.RETRATO400), P.csfOf(P.STOCKS.VIVA50), P.csfOf(P.STOCKS.BNORTO80)], tie: [P.tieOf(P.STOCKS.RETRATO400), P.tieOf(P.STOCKS.BNORTO80)],
      };
    });
    const COLOUR_NEGATIVES = ['RETRATO400', 'CALIDO200', 'CINE500T', 'CALLE400', 'AMBAR160', 'CINE250D', 'CRUZADO100', 'PLATA200', 'REVES200', 'PURPURA400'];
    const deepestMono = Math.max(...['BNFINO100', 'BNCLASICO400', 'BNORTO80', 'BNNOCHE3200'].map(k => deep.black[k]));
    for (const stock of COLOUR_NEGATIVES) {
      // (antes: 0,019 de luminancia —un gris oscuro, L* 15—; el del blanco y negro anda por 0,011)
      assert.ok(deep.black[stock] < (stock === 'CINE250D' ? 0.0135 : 0.0115), stock + ': el negro de la escena sale negro, no gris: ' + deep.black[stock]);
      assert.ok(deep.black[stock] < deepestMono * 1.15, stock + ': tan hondo como el de las de blanco y negro: ' + [deep.black[stock], deepestMono]);
    }
    for (const [name, g] of [['RETRATO 400', deep.retrato], ['CINE 500T', deep.cine]]) {
      assert.ok(g.juntas > 0.6, name + ': las capas llevan el grano juntas (grano de luminancia, no confeti): ' + JSON.stringify(g));
      assert.ok(g.color < g.luz * 0.8, name + ': el grano mueve más la luz que el color: ' + JSON.stringify(g));
      assert.ok(g.color > g.luz * 0.15, name + ': y aun así cada capa lleva algo propio (el color respira): ' + JSON.stringify(g));
    }
    assert.ok(deep.cine.luz > deep.retrato.luz * 1.15, 'la de cine rápida tiene más grano que la de retrato: ' + [deep.retrato.luz, deep.cine.luz]);
    assert.ok(deep.retrato.luz > deep.mono.luz * 0.9, 'el grano de color llega al nivel del de blanco y negro: ' + [deep.retrato.luz, deep.mono.luz]);
    assert.deepEqual(deep.tie, [0.86, 1], 'cuánto grano comparten las capas: casi todo en color, todo en blanco y negro');
    assert.ok(deep.slide.luces.luz < deep.slide.medios.luz * 0.5, 'donde una diapositiva queda limpia (los blancos) no hay grano: ' + JSON.stringify(deep.slide));
    assert.ok(deep.negative.sombras.luz < deep.negative.medios.luz * 0.5, 'en la copia de un negativo el negro queda limpio: ' + JSON.stringify(deep.negative));
    for (const name of ['retrato', 'viva']) {
      const e = deep.edge[name];
      assert.ok(e.claroCerca >= e.claroLejos + 2 && e.oscuroCerca <= e.oscuroLejos, name + ': junto a un borde lo claro se aclara y lo oscuro no se levanta (el relieve del baño y el de las capas): ' + JSON.stringify(e));
      assert.ok(e.claroCerca - e.claroLejos < 22 && Math.abs(e.claroMedio - e.claroLejos) <= 1, name + ': un relieve fino, no un halo ancho (a un vigésimo del cuadro ya no queda nada): ' + JSON.stringify(e));
    }
    assert.ok(Math.abs(deep.edge.orto.claroCerca - deep.edge.orto.claroLejos) <= 2 && Math.abs(deep.edge.orto.oscuroCerca - deep.edge.orto.oscuroLejos) <= 2, 'el blanco y negro se queda como estaba: ' + JSON.stringify(deep.edge.orto));
    // el color del grano va a la escala del grano: en un gris liso no quedan manchas anchas de color
    assert.deepEqual(deep.csf, [[0.45, 0.28], [0.58, 0.36], [0, 0]], 'cuánto color fino queda: menos el azul-amarillo que el rojo-verde, algo más en diapositiva, nada en blanco y negro');
    assert.ok(deep.blotch.ancho < deep.blotch.fino * 0.5, 'el color del grano es fino: promediado en bloques de 16 puntos casi desaparece: ' + JSON.stringify(deep.blotch));
    // la película más rápida, contenida en el cuadro más chico: fuerte, pero no una tormenta
    assert.ok(deep.noche.super8.luz < 32 && deep.noche.super8.luz > deep.noche.super16.luz && deep.noche.super16.luz > deep.noche.medio.luz, 'NOCHE 3200: en SÚPER 8 sigue siendo la de más grano, sin reventar la imagen: ' + JSON.stringify(deep.noche));
    step('negro hondo y grano profundo: las de color, a la altura de las de blanco y negro', { negro: deep.black, retrato: deep.retrato, cine: deep.cine, orto: deep.mono, diapositiva: deep.slide, borde: deep.edge });

    // ── 5c · Cine chico: SÚPER 8 y SÚPER 16 ──
    const small = await page.evaluate(() => {
      const P = flipFilm.physics, W = 1024, H = 256;
      const flat = v => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const s = Math.round(255 * Math.pow(v, 1 / 2.2)); x.fillStyle = `rgb(${s},${s},${s})`; x.fillRect(0, 0, W, H); return c; };
      const stat = (stock, v, format, extra) => {
        flipFilm.develop(flat(v), { stock, format, ...extra }); const r = flipFilm.read(); let n = 0, m = 0, q = 0, t = 0;
        for (let y = 20; y < H - 20; y++) for (let x = 20; x < W - 20; x++) { const g = r.data[(y * W + x) * 4 + 1]; m += g; q += g * g; t += g * g * g; n++; }
        m /= n; const va = Math.max(1e-9, q / n - m * m), sd = Math.sqrt(va);
        // «grueso»: lo que queda del grano al promediar bloques de 4 × 4 puntos (un grano fino se borra; uno gordo, no)
        let bn = 0, bm = 0, bq = 0; for (let y = 20; y + 4 <= H - 20; y += 4) for (let x = 20; x + 4 <= W - 20; x += 4) { let a = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) a += r.data[((y + j) * W + x + i) * 4 + 1]; a /= 16; bm += a; bq += a * a; bn++; }
        return { media: +m.toFixed(1), sd: +sd.toFixed(2), grueso: +Math.sqrt(Math.max(0, bq / bn - (bm / bn) ** 2)).toFixed(2), sesgo: +((t / n - 3 * m * va - m * m * m) / (sd * sd * sd)).toFixed(2) };
      };
      // cuántos puntos tarda un borde en pasar de oscuro a claro (del 10 % al 90 % del salto), a tamaño de foto
      const edge = format => {
        const EW = 2560, c = document.createElement('canvas'); c.width = EW; c.height = 64; const x = c.getContext('2d'), s = v => { const k = Math.round(255 * Math.pow(v, 1 / 2.2)); return `rgb(${k},${k},${k})`; };
        x.fillStyle = s(0.06); x.fillRect(0, 0, EW / 2, 64); x.fillStyle = s(0.40); x.fillRect(EW / 2, 0, EW / 2, 64);
        flipFilm.develop(c, { stock: 'RETRATO400', format, grain: false }); const r = flipFilm.read(), at = px => r.data[(32 * EW + px) * 4 + 1], lo = at(EW / 2 - 500), hi = at(EW / 2 + 500);
        let width = 0; for (let px = EW / 2 - 40; px < EW / 2 + 40; px++) { const v = at(px); if (v > lo + 0.1 * (hi - lo) && v < lo + 0.9 * (hi - lo)) width++; }
        return width;
      };
      return {
        names: P.FORMATS.map(f => f.name), small: P.FORMATS.map(f => !!f.small), f35: P.F35,
        formats: [0, 1, 2, 3, 4, 5].map(f => stat('RETRATO400', 0.18, f)), clean: [0, 3].map(f => stat('RETRATO400', 0.18, f, { grain: false })),
        // el negativo (no la copia) de una zona casi sin exponer: ahí los cristales revelados son pocos
        thin: { super8: stat('BNNOCHE3200', 0.004, 0, { mode: 1 }), mm35: stat('BNNOCHE3200', 0.004, 3, { mode: 1 }) },
        slide: { luces: stat('VIVA50', 0.9, 0), medios: stat('VIVA50', 0.12, 0) },
        edges: [edge(0), edge(1), edge(3)], live: stat('RETRATO400', 0.18, 0, { live: true }), state: flipFilm.state(),
      };
    });
    assert.deepEqual(small.names, ['SÚPER 8', 'SÚPER 16', '½ CUADRO', '35 MM', '6 × 7', '4 × 5'], 'los formatos, de menor a mayor');
    assert.deepEqual([small.small, small.f35], [[true, true, false, false, false, false], 3], 'los dos de cine chico, y 35 mm de fábrica');
    for (let i = 1; i < 6; i++) assert.ok(small.formats[i].sd < small.formats[i - 1].sd * 0.95, 'cuanto mayor el formato, menos grano (del súper 8 al 4 × 5): ' + small.formats.map(f => f.sd));
    assert.ok(small.formats[0].sd > small.formats[3].sd * 2.2, 'en súper 8 el grano es cosa seria: ' + [small.formats[0].sd, small.formats[3].sd]);
    for (const f of small.formats) assert.ok(Math.abs(f.media - small.formats[3].media) < 3, 'el formato no mueve el tono: ' + small.formats.map(g => g.media));
    assert.ok(Math.abs(small.clean[0].media - small.clean[1].media) < 2 && small.clean[0].sd < 1, 'sin grano, el súper 8 sale liso y con el mismo gris: ' + JSON.stringify(small.clean));
    assert.ok(small.thin.super8.sesgo > 0.5 && Math.abs(small.thin.mm35.sesgo) < 0.3, 'donde llegó poca luz los cristales se ven sueltos (en 35 mm son demasiados por punto para verse uno a uno): ' + JSON.stringify(small.thin));
    assert.ok(small.slide.luces.sd < small.slide.medios.sd * 0.5, 'la diapositiva en súper 8 también deja limpios los blancos: ' + JSON.stringify(small.slide));
    assert.ok(small.edges[0] > small.edges[1] && small.edges[1] >= small.edges[2] && small.edges[0] >= small.edges[2] + 2, 'la emulsión quita nitidez cuando el cuadro es chico: ' + small.edges);
    assert.ok(Math.abs(small.live.sd - small.formats[0].sd) < small.formats[0].sd * 0.15 && Math.abs(small.live.media - small.formats[0].media) < 2, 'la vista previa (menos huecos por celda) da el mismo grano que la foto: ' + JSON.stringify([small.live, small.formats[0]]));
    assert.equal(small.state.tier, 0, 'sin haber ido lenta, la vista previa dibuja todos sus cristales');
    step('cine chico: SÚPER 8 y SÚPER 16 dibujan el grano cristal a cristal', { grano: small.formats.map(f => f.sd), sueltos: small.thin, borde: small.edges });

    // ── 5d · El obturador de cine (vídeo): lo que se mueve deja estela, y lo quieto no cambia ──
    const shutter = await page.evaluate(() => {
      const W = 1024, H = 768;
      // fondo con textura, una barra clara y un punto de luz; «noise» le pone el ruido de un sensor
      const scene = (bx, by, pan = 0, noise = 0) => {
        const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true });
        x.fillStyle = '#3a4148'; x.fillRect(0, 0, W, H);
        for (let i = 0; i < 60; i++) { const px = ((i * 197 + pan) % (W + 80)) - 40, py = (i * 113) % H; x.fillStyle = i % 3 ? '#4d565e' : '#2b3036'; x.fillRect(px, py, 46, 30); }
        x.fillStyle = '#e9e6dc'; x.fillRect(400 + bx, 150 + by, 60, 380);
        if (noise) { const im = x.getImageData(0, 0, W, H), d = im.data; let sd = noise * 7919 + 1; for (let i = 0; i < d.length; i += 4) { sd = (sd * 1664525 + 1013904223) >>> 0; const n = ((sd >>> 16) % 13) - 6; d[i] += n; d[i + 1] += n; d[i + 2] += n; } x.putImageData(im, 0, 0); }
        return c;
      };
      const spanX = y => { const r = flipFilm.read(), at = px => r.data[(y * W + px) * 4 + 1]; let lo = 255, hi = 0; for (let px = 300; px < 600; px++) { lo = Math.min(lo, at(px)); hi = Math.max(hi, at(px)); } let a = 0, b = 0; for (let px = 300; px < 600; px++) { const v = (at(px) - lo) / (hi - lo); if (v > 0.1) a++; if (v > 0.9) b++; } return [a, b]; };
      const spanY = x0 => { const r = flipFilm.read(), at = py => r.data[(py * W + x0) * 4 + 1]; let lo = 255, hi = 0; for (let py = 60; py < 620; py++) { lo = Math.min(lo, at(py)); hi = Math.max(hi, at(py)); } let a = 0, b = 0; for (let py = 60; py < 620; py++) { const v = (at(py) - lo) / (hi - lo); if (v > 0.1) a++; if (v > 0.9) b++; } return [a, b]; };
      const run = (dx, dy, amount, pan = 0, noise = 0) => {
        flipFilm.forgetMotion();
        flipFilm.develop(scene(0, 0, 0, noise && 1), { stock: 'RETRATO400', grain: false, shutter: { fresh: true, amount } });
        flipFilm.develop(scene(dx, dy, pan, noise && 2), { stock: 'RETRATO400', grain: false, shutter: { fresh: true, amount } });
        return { ancho: spanX(300 + dy), alto: spanY(430 + dx) };
      };
      flipFilm.develop(scene(24, 0), { stock: 'RETRATO400', grain: false });
      const plain = { ancho: spanX(300), alto: spanY(454) };
      // un cuadro repetido (el visor repinta el mismo): la estela se queda como estaba
      flipFilm.forgetMotion();
      for (const dx of [0, 24]) flipFilm.develop(scene(dx, 0), { stock: 'RETRATO400', grain: false, shutter: { fresh: true, amount: 0.625 } });
      flipFilm.develop(scene(24, 0), { stock: 'RETRATO400', grain: false, shutter: { fresh: false, amount: 0.625 } });
      const repeated = { ancho: spanX(300), alto: spanY(454) };
      return { plain, still: run(0, 0, 0.625), noisy: run(0, 0, 0.625, 0, 1), right: run(24, 0, 0.625), fast: run(48, 0, 0.625), left: run(-24, 0, 0.625), down: run(0, 24, 0.625), pan: run(24, 0, 0.625, 24), closed: run(24, 0, 0), repeated };
    });
    assert.deepEqual(shutter.still.ancho, shutter.plain.ancho, 'lo que no se mueve no cambia: ' + JSON.stringify([shutter.still, shutter.plain]));
    assert.ok(Math.abs(shutter.noisy.ancho[0] - shutter.plain.ancho[0]) <= 2, 'el ruido del sensor no se toma por movimiento: ' + JSON.stringify(shutter.noisy));
    assert.ok(shutter.right.ancho[0] >= shutter.plain.ancho[0] + 9 && shutter.right.ancho[0] <= shutter.plain.ancho[0] + 19 && shutter.right.ancho[1] < shutter.plain.ancho[1], 'una barra que se movió 24 puntos deja una estela de unos 15 (1/48 de segundo de cada 1/30): ' + JSON.stringify(shutter.right));
    assert.ok(shutter.fast.ancho[0] > shutter.right.ancho[0] + 8, 'el doble de rápido, el doble de estela: ' + JSON.stringify([shutter.right.ancho, shutter.fast.ancho]));
    assert.ok(Math.abs(shutter.left.ancho[0] - shutter.right.ancho[0]) <= 3, 'igual hacia la izquierda: ' + JSON.stringify(shutter.left));
    assert.ok(Math.abs(shutter.down.ancho[0] - shutter.plain.ancho[0]) <= 2 && shutter.down.alto[0] >= shutter.plain.alto[0] + 7, 'si baja, la estela es vertical y a lo ancho no cambia: ' + JSON.stringify([shutter.down, shutter.plain]));
    assert.ok(shutter.pan.ancho[0] >= shutter.plain.ancho[0] + 9, 'un paneo (se mueve todo) también deja estela: ' + JSON.stringify(shutter.pan));
    assert.deepEqual(shutter.closed.ancho, shutter.plain.ancho, 'con el obturador en cero, nada: ' + JSON.stringify(shutter.closed));
    assert.ok(Math.abs(shutter.repeated.ancho[0] - shutter.right.ancho[0]) <= 2, 'un cuadro repetido conserva su estela (no parpadea): ' + JSON.stringify(shutter.repeated));
    step('el obturador de cine: lo que se mueve deja estela', { quieto: shutter.still.ancho, ruido: shutter.noisy.ancho, derecha24: shutter.right.ancho, derecha48: shutter.fast.ancho, abajo24: shutter.down.alto, repetido: shutter.repeated.ancho });

    // ── 6 · EMPUJE y PAPEL ──
    const contrast = await page.evaluate(() => {
      const ratio = options => { const p = filmKit.patches([filmKit.gray(-1), filmKit.gray(0), filmKit.gray(1)], { stock: 'RETRATO400', ...options }); return { gamma: +(Math.log(p[2][1] / p[0][1]) / Math.log(4)).toFixed(3), mid: p[1][1] }; };
      return { papers: [0, 1, 2].map(paper => ratio({ paper })), push: [-1, 0, 1, 2].map(push => ratio({ push, ev: 0 })) };
    });
    assert.ok(contrast.papers[0].gamma < contrast.papers[1].gamma - 0.08 && contrast.papers[1].gamma < contrast.papers[2].gamma - 0.08, 'papel suave, normal y duro: ' + contrast.papers.map(p => p.gamma));
    for (const p of contrast.papers) assert.ok(Math.abs(p.mid - 0.18) < 0.02, 'cada papel deja el gris medio en su sitio: ' + p.mid);
    for (let i = 1; i < 4; i++) assert.ok(contrast.push[i].gamma > contrast.push[i - 1].gamma + 0.03, 'empujar sube el contraste: ' + contrast.push.map(p => p.gamma));
    step('EMPUJE y PAPEL mueven el contraste', { papel: contrast.papers.map(p => p.gamma), empuje: contrast.push.map(p => p.gamma) });

    // ── 6b · Cada película es lo que dice ──
    const kinds = await page.evaluate(() => {
      const lin = rgb => rgb.map(v => Math.pow(v / 255, 2.2)), lum = p => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      const C = { rojo: [175, 54, 60], verde: [70, 148, 73], azul: [56, 61, 150], amarillo: [231, 199, 31], piel: [194, 150, 130], follaje: [87, 108, 67], cielo: [98, 122, 157] };
      const ins = Object.values(C).map(lin), names = Object.keys(C);
      const chroma = (stock, options) => { const got = filmKit.patches(ins, { stock, ...options }); return +(got.reduce((s, p, i) => { const a = filmKit.oklab(ins[i]), b = filmKit.oklab(p); return s + Math.hypot(b[1], b[2]) / Math.hypot(a[1], a[2]); }, 0) / ins.length).toFixed(3); };
      const tones = (stock, options) => Object.fromEntries(filmKit.patches(ins, { stock, ...options }).map((p, i) => [names[i], +lum(p).toFixed(3)]));
      const grays = (stock, options) => filmKit.patches([filmKit.gray(-2), filmKit.gray(0), filmKit.gray(2)], { stock, ...options });
      return {
        chroma: Object.fromEntries(['RETRATO400', 'CINE250D', 'VIVA50', 'REPORTAJE64', 'PLATA200', 'BNFINO100', 'BNCLASICO400', 'BNORTO80', 'BNNOCHE3200'].map(k => [k, chroma(k)])),
        pan: tones('BNCLASICO400'), orto: tones('BNORTO80'), red: tones('BNCLASICO400', { filter: 3 }), green: tones('BNCLASICO400', { filter: 4 }),
        toners: [0, 1, 2, 3, 4].map(toner => grays('BNFINO100', { toner })),
        slide: [-1, 0, 1].map(ev => +lum(grays('VIVA50', { ev })[1]).toFixed(3)), negative: [-1, 0, 1].map(ev => +lum(grays('RETRATO400', { ev })[1]).toFixed(3)),
        slidePaper: [0, 2].map(paper => grays('VIVA50', { paper })),
        cross: grays('CRUZADO100'), flipped: grays('REVES200'), amber: grays('AMBAR160'),
        swap: filmKit.patches(ins, { stock: 'PURPURA400' }).map(p => p.map(v => +v.toFixed(3))),
        lists: { filters: flipFilm.physics.FILTERS.map(f => f.name), toners: flipFilm.physics.TONERS.map(t => t.name) },
      };
    });
    // blanco y negro: sin color; la ortocromática no ve el rojo; los filtros cambian el tono de cada color
    for (const k of ['BNFINO100', 'BNCLASICO400', 'BNORTO80', 'BNNOCHE3200']) assert.ok(kinds.chroma[k] < 0.03, k + ': sin color: ' + kinds.chroma[k]);
    assert.ok(kinds.orto.rojo < kinds.pan.rojo * 0.6 && kinds.orto.azul > kinds.pan.azul, 'la ortocromática oscurece el rojo y aclara el azul: ' + JSON.stringify([kinds.pan, kinds.orto]));
    assert.ok(kinds.red.rojo > kinds.pan.rojo * 1.5 && kinds.red.azul < kinds.pan.azul * 0.6 && kinds.red.cielo < kinds.pan.cielo * 0.85, 'el filtro rojo aclara el rojo y oscurece el azul y el cielo: ' + JSON.stringify([kinds.pan, kinds.red]));
    assert.ok(kinds.green.verde > kinds.pan.verde * 1.1 && kinds.green.rojo < kinds.pan.rojo * 0.8, 'el filtro verde aclara el verde y oscurece el rojo: ' + JSON.stringify([kinds.pan, kinds.green]));
    assert.deepEqual(kinds.lists, { filters: ['SIN', 'AMARILLO', 'NARANJA', 'ROJO', 'VERDE'], toners: ['NEUTRO', 'CÁLIDO', 'SELENIO', 'SEPIA', 'CIANOTIPO'] });
    // los virados: el gris medio sigue en su sitio; sepia y cálido tiran al rojo, el cianotipo al azul, y el selenio enfría las sombras
    const lumOf = p => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    for (const [i, t] of kinds.toners.entries()) assert.ok(Math.abs(lumOf(t[1]) - 0.18) < 0.02, 'virado ' + i + ': el gris medio no se mueve: ' + t[1]);
    assert.ok(kinds.toners[0].every(p => Math.max(...p) - Math.min(...p) < 0.012), 'sin virar, la copia es neutra: ' + JSON.stringify(kinds.toners[0]));
    assert.ok(kinds.toners[1][1][0] > kinds.toners[1][1][2] * 1.08 && kinds.toners[3][1][0] > kinds.toners[3][1][2] * 1.5 && kinds.toners[3][1][0] > kinds.toners[1][1][0], 'cálido y sepia tiran al rojo, la sepia más: ' + JSON.stringify([kinds.toners[1][1], kinds.toners[3][1]]));
    assert.ok(kinds.toners[4][1][2] > kinds.toners[4][1][0] * 2, 'el cianotipo es azul: ' + kinds.toners[4][1]);
    assert.ok(kinds.toners[2][0][1] < kinds.toners[2][0][0] && kinds.toners[2][0][1] < kinds.toners[2][0][2] && Math.max(...kinds.toners[2][2]) - Math.min(...kinds.toners[2][2]) < 0.03, 'el selenio vira las sombras y deja las luces: ' + JSON.stringify(kinds.toners[2]));
    // color: la diapositiva viva tiene más que la de reportero y que el negativo; la de cine suave y la sin blanquear, menos
    assert.ok(kinds.chroma.VIVA50 > kinds.chroma.RETRATO400 + 0.1 && kinds.chroma.VIVA50 > kinds.chroma.REPORTAJE64 + 0.15, 'la diapositiva viva es la de más color: ' + JSON.stringify(kinds.chroma));
    assert.ok(kinds.chroma.CINE250D < kinds.chroma.RETRATO400 - 0.15 && kinds.chroma.PLATA200 < 0.7, 'la de cine suave y la sin blanquear llevan menos color: ' + JSON.stringify(kinds.chroma));
    // en diapositiva no hay copia que corrija: EXPOSICIÓN aclara y oscurece; en negativo, no; y el PAPEL no le hace nada
    assert.ok(kinds.slide[2] > kinds.slide[1] * 1.6 && kinds.slide[0] < kinds.slide[1] * 0.65, 'la diapositiva se aclara y oscurece con la exposición: ' + kinds.slide);
    assert.ok(Math.abs(kinds.negative[2] - kinds.negative[0]) < 0.02, 'el negativo, no (la copia lo centra): ' + kinds.negative);
    assert.deepEqual(kinds.slidePaper[0], kinds.slidePaper[1], 'una diapositiva no lleva papel');
    // proceso cruzado: luces sin azul (verde-amarillas) y sombras azuladas
    assert.ok(kinds.cross[2][2] < kinds.cross[2][1] - 0.08 && kinds.cross[2][1] >= kinds.cross[2][0] && kinds.cross[0][2] >= kinds.cross[0][0], 'la cruzada tiñe las luces de verde-amarillo y las sombras de azul: ' + JSON.stringify(kinds.cross));
    assert.ok(kinds.amber[2][0] > kinds.amber[2][2] + 0.1, 'ÁMBAR: luces ámbar: ' + kinds.amber[2]);
    // rollo al revés: rojo, luego verde, y casi nada de azul
    assert.ok(kinds.flipped[1][0] > kinds.flipped[1][1] * 2 && kinds.flipped[1][2] < 0.04 && kinds.flipped[2][0] > 0.6 && kinds.flipped[2][2] < 0.05, 'el rollo al revés sale naranja: ' + JSON.stringify(kinds.flipped));
    // colores cambiados: el verde sale púrpura (más azul y rojo que verde) y el rojo sigue rojo
    const [swapRed, swapGreen, , swapYellow] = kinds.swap;
    assert.ok(swapGreen[2] > swapGreen[1] * 1.5 && swapRed[0] > swapRed[1] * 2 && swapRed[0] > swapRed[2] * 2 && swapYellow[2] > swapYellow[1] * 1.5, 'PÚRPURA: el verde y el amarillo cambian de sitio; el rojo, no: ' + JSON.stringify(kinds.swap.slice(0, 4)));
    step('cada película es lo que dice: blanco y negro con filtros y virados, diapositivas, y las experimentales', { croma: kinds.chroma, diapositiva: kinds.slide, alReves: kinds.flipped[1], cruzada: kinds.cross[2] });

    // ── 7 · La cámara ──
    // los tres cajones: de fábrica se está en DIGITAL, con las cámaras de siempre
    const drawers = () => page.evaluate(() => ({
      on: [...document.querySelectorAll('#deckGroups .is-on')].map(k => k.dataset.group), tabs: [...document.querySelectorAll('#deckGroups [data-group]')].map(k => k.textContent.trim()),
      tiles: [...document.querySelectorAll('#deckLooks .look[data-group]')].filter(t => getComputedStyle(t).display !== 'none').map(t => t.dataset.family + (t.dataset.variant ? ':' + t.dataset.variant : '')),
      cam: camFamily + ':' + camVariant, lcd: document.getElementById('lcdLook').textContent,
    }));
    const d0 = await drawers();
    assert.deepEqual(d0.tabs, ['FILM', 'DIGITAL', 'CUSTOM']);
    assert.deepEqual(d0.on, ['digital']);
    assert.deepEqual(d0.tiles, ['DSI', 'AUTO03', 'DLPHN', 'CASKIA', 'VFD', 'OSCAM', 'PRENSA', 'CONSOLA'], 'DIGITAL: las cámaras de siempre, con VIRTUAL');
    await page.locator('#deckGroups [data-group="film"]').click();
    await page.waitForFunction(() => camFamily === 'FILM', null, { timeout: 5000 });
    const d1 = await drawers();
    const stocks = await page.evaluate(() => Object.keys(flipFilm.physics.STOCKS));
    assert.deepEqual([d1.on, d1.tiles, d1.cam], [['film'], stocks.map(k => 'FILM:' + k), 'FILM:RETRATO400'], 'FILM: una diapositiva por película (las mismas que conoce el motor), y entra a la primera');
    await pickCamera(page, 'FILM', 'CALIDO200');
    await page.locator('#deckGroups [data-group="custom"]').click();
    await page.waitForFunction(() => camFamily === 'CLON', null, { timeout: 5000 });
    const d2 = await drawers();
    assert.deepEqual([d2.on, d2.tiles], [['custom'], ['CLON']], 'CUSTOM: el clonador');
    await page.locator('#deckGroups [data-group="digital"]').click();
    await page.waitForFunction(() => camFamily === 'DSI', null, { timeout: 5000 });
    await pickCamera(page, 'VFD');
    await page.locator('#deckGroups [data-group="film"]').click();
    await page.waitForFunction(() => camFamily === 'FILM', null, { timeout: 5000 });
    const d3 = await drawers();
    assert.equal(d3.cam, 'FILM:CALIDO200', 'cada cajón recuerda su última cámara');
    assert.match(d3.lcd, /^CÁLIDO 200$/);
    await page.locator('#deckGroups [data-group="digital"]').click();
    await page.waitForFunction(() => camFamily === 'VFD', null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('#deckVariants [data-variant]').length > 0), true, 'en DIGITAL las variantes siguen en su fila');
    step('la tira va en tres cajones: FILM · DIGITAL · CUSTOM', { film: d1.tiles.length, digital: d0.tiles.length, custom: d2.tiles });

    await pickCamera(page, 'FILM', 'RETRATO400');
    await page.waitForFunction(() => camFamily === 'FILM' && camVariant === 'RETRATO400' && flipFilm.state().frame > 10 && String(flipFilm.state().film).startsWith('RETRATO400'), null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const view = () => page.evaluate(() => {
      const g = document.createElement('canvas'); g.width = 96; g.height = 72;
      const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, 0, 96, 72);
      const d = c.getImageData(0, 0, 96, 72).data; let lit = 0; const mean = [0, 0, 0], seen = new Set();
      for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; for (let k = 0; k < 3; k++) mean[k] += d[i + k]; seen.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4); }
      return { lit: +(lit / (d.length / 4)).toFixed(2), colores: seen.size, mean: mean.map(v => Math.round(v / (d.length / 4))) };
    });
    const a = await page.evaluate(() => ({ s: flipFilm.state(), lcd: document.getElementById('lcdLook').textContent, variante: camVariant, variantes: document.querySelectorAll('#deckVariants [data-variant]').length, miniatura: [...document.querySelectorAll('.look[data-family="FILM"] i')].every(i => /look-FILM-[A-Z0-9]+\.webp/.test(getComputedStyle(i).backgroundImage)) }));
    const seenA = await view();
    assert.match(a.lcd, /RETRATO 400/);
    assert.equal(a.variante, 'RETRATO400');
    assert.equal(a.variantes, 0, 'las películas son diapositivas, no teclas de variante');
    assert.ok(a.s.gl && !a.s.failed, 'revela en la gráfica: ' + JSON.stringify(a.s));
    assert.deepEqual(a.s.size, await page.evaluate(() => [display.width, display.height]), 'el visor se revela a su tamaño de verdad (sin ampliar: ampliado, el grano llega hecho velo)');
    // una película que aún no se había pedido: su tabla de copia se calcula en un hilo aparte
    const aside = await page.evaluate(async () => { const t0 = performance.now(); await flipFilm.ready('CALIDO200', -1, 0); return { ms: Math.round(performance.now() - t0), s: flipFilm.state() }; });
    assert.ok(aside.s.worker && aside.s.waiting === 0, 'las tablas se calculan sin detener la cámara: ' + JSON.stringify(aside));
    assert.ok(a.miniatura, 'cada película tiene su miniatura en la tira');
    assert.ok(seenA.lit > 0.5 && seenA.colores > 40, 'el visor no queda en negro ni liso: ' + JSON.stringify(seenA));
    step('FILM se elige como una cámara más', { estado: a.s, visor: seenA });

    // grabando vídeo se revela una sola vez por cuadro: lo hace el visor, al tamaño del vídeo, y el
    // vídeo toma ese cuadro (antes: dos revelados por cuadro y la gráfica rehaciendo sus destinos)
    const filming = await page.evaluate(async () => {
      const proxy = document.createElement('canvas'); proxy.width = 1440; proxy.height = 1080;
      const ctx = proxy.getContext('2d', { willReadFrequently: true }), wait = ms => new Promise(ok => setTimeout(ok, ms));
      const shot = () => { const cam = liveCamFrame(); return renderFilm(cam.source, cam.srcW, cam.srcH, ctx, false, camVariant, { path: 'capture', outW: 1440, outH: 1080, motion: true }); };
      const sum = () => { const d = ctx.getImageData(600, 400, 240, 240).data; let total = 0, hash = 0; for (let i = 0; i < d.length; i += 4) { total += d[i + 1]; hash = (hash * 31 + d[i] + d[i + 1] * 3) >>> 0; } return { media: Math.round(total / (d.length / 4)), hash }; };
      const before = flipFilm.state(), seen = [], sizes = new Set(); let extra = 0, taken = 0;
      for (let i = 0; i < 16; i++) {
        const f0 = flipFilm.state().frame, ok = shot(), s = flipFilm.state();
        if (i >= 6) { taken++; extra += s.frame - f0; sizes.add(s.size.join('×')); seen.push(sum()); }
        if (!ok) return { failed: true };
        await wait(45);
      }
      const during = flipFilm.state();
      await wait(1200);
      return { before: before.size, during: { size: during.size, reel: during.reel, filming: during.filming }, sizes: [...sizes], extra, taken, seen, after: flipFilm.state(), display: [display.width, display.height] };
    });
    assert.deepEqual([filming.during.size, filming.during.reel, filming.during.filming], [[1280, 960], [1280, 960], true], 'grabando, el visor revela al tamaño del vídeo (con tope) y lo deja en el rollo: ' + JSON.stringify(filming.during));
    assert.deepEqual(filming.sizes, ['1280×960'], 'la gráfica no cambia de tamaño entre cuadro y cuadro: ' + filming.sizes);
    assert.equal(filming.extra, 0, 'el cuadro de vídeo no se revela otra vez: toma el del rollo (' + filming.taken + ' cuadros)');
    assert.ok(filming.seen.every(v => v.media > 12) && new Set(filming.seen.map(v => v.hash)).size >= 3, 'el vídeo lleva imagen y su grano se mueve: ' + JSON.stringify(filming.seen.slice(0, 4)));
    assert.deepEqual([filming.after.size, filming.after.reel, filming.after.filming], [filming.display, null, false], 'al acabar, el visor vuelve a su tamaño y suelta el rollo: ' + JSON.stringify(filming.after));
    assert.deepEqual([filming.after.tier, filming.after.scale], [0, 1], 'sin haber ido lenta, no se baja la calidad');
    step('grabando vídeo se revela una vez por cuadro', { durante: filming.during, alAcabar: filming.after.size });

    // en modo vídeo el obturador de cine va puesto (el visor enseña lo que se va a grabar); en foto, no
    const modes = { foto: await page.evaluate(() => ({ modo: camMode, s: flipFilm.state() })) };
    await page.locator('#deckModeSwitch').click();
    await page.waitForFunction(() => camMode === 'video' && flipFilm.state().shuttering && flipFilm.state().amount > 0, null, { timeout: 8000 });
    await page.waitForTimeout(700);
    modes.video = await page.evaluate(() => ({ modo: camMode, s: flipFilm.state() }));
    const seenVideo = await view();
    await page.locator('#deckModeSwitch').click();
    await page.waitForFunction(() => camMode === 'foto' && !flipFilm.state().shuttering, null, { timeout: 8000 });
    assert.equal(modes.foto.s.shuttering, false, 'en foto no hay obturador de cine');
    // (a 30 cuadros por segundo le toca 0,625 del intervalo; si la cámara de la prueba va más lenta —la
    //  del motor de Safari ronda los 21—, el obturador ya se va cerrando, como con poca luz)
    assert.ok(modes.video.s.shuttering && modes.video.s.amount > (modes.video.s.cameraMs < 40 ? 0.4 : 0) && modes.video.s.amount <= 1.25, 'en vídeo va puesto, con la parte del intervalo que le toca a 1/48 de segundo: ' + JSON.stringify(modes.video.s));
    assert.ok(seenVideo.lit > 0.5 && seenVideo.colores > 40, 'y el visor sigue enseñando la imagen: ' + JSON.stringify(seenVideo));
    step('en modo vídeo el obturador de cine va puesto', { parte: modes.video.s.amount });

    // otra película: cambia la imagen (la de diario es más cálida)
    await pickCamera(page, 'FILM', 'CALIDO200');
    await page.waitForFunction(() => camVariant === 'CALIDO200' && flipFilm.state().film.startsWith('CALIDO200'), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const seenB = await view();
    assert.ok(seenB.mean[0] - seenB.mean[2] > seenA.mean[0] - seenA.mean[2] + 3, 'CÁLIDO 200 es más cálida que RETRATO 400: ' + JSON.stringify([seenA.mean, seenB.mean]));
    await pickCamera(page, 'FILM', 'CINE500T');
    await page.waitForFunction(() => flipFilm.state().film.startsWith('CINE500T'), null, { timeout: 8000 });
    step('las películas cambian la imagen', { retrato: seenA.mean, calido: seenB.mean });

    // cada película enseña las perillas que le tocan: el blanco y negro, siete (con FILTRO y VIRADO, en
    // dos filas que caben); la diapositiva, cuatro (no lleva papel)
    const shown = () => page.evaluate(() => ({
      knobs: [...document.querySelectorAll('#filmEditPanel .cs-slot')].filter(el => el.offsetParent).map(el => el.querySelector('[class$="-lbl"]').textContent + ' ' + el.querySelector('[class$="-val"]').textContent),
      // (ningún rótulo queda tapado por las teclas de abajo)
      clear: (() => { const key = document.querySelector('.cs-key[data-sec="cam"]'), top = key && key.offsetParent ? key.getBoundingClientRect().top : NaN; return [...document.querySelectorAll('#filmEditPanel .cs-slot')].filter(el => el.offsetParent).every(el => el.querySelector('[class$="-val"]').getBoundingClientRect().bottom <= top + 1); })(),
    }));
    await pickCamera(page, 'FILM', 'BNCLASICO400');
    await page.waitForFunction(() => String(flipFilm.state().film).startsWith('BNCLASICO400'), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const seenMono = await view();
    assert.ok(Math.max(...seenMono.mean) - Math.min(...seenMono.mean) < 3, 'en blanco y negro el visor no tiene color: ' + seenMono.mean);
    await page.locator('#deckAdjust').click();
    await page.waitForTimeout(500);
    const mono = await shown();
    assert.deepEqual(mono.knobs, ['EXPOSICIÓN 0', 'EMPUJE 0', 'FORMATO 35 MM', 'PAPEL NORMAL', 'FILTRO SIN', 'VIRADO NEUTRO', 'GRANO SÍ'], 'blanco y negro: siete perillas');
    assert.ok(mono.clear, 'las siete caben sin taparse');
    await page.evaluate(() => { for (const [id, v] of [['filmFilter', 3], ['filmToner', 3]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } });
    await page.waitForFunction(() => flipFilm.state().film === 'BNCLASICO400:0:1:3:3', null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const seenSepia = await view();
    assert.ok(seenSepia.mean[0] > seenSepia.mean[2] + 15, 'virado a sepia, el visor se vuelve cálido: ' + seenSepia.mean);
    assert.deepEqual(await page.evaluate(() => [document.getElementById('vFilmFilter').textContent, document.getElementById('vFilmToner').textContent]), ['ROJO', 'SEPIA']);
    await page.keyboard.press('Escape');
    await pickCamera(page, 'FILM', 'VIVA50');
    await page.waitForFunction(() => String(flipFilm.state().film).startsWith('VIVA50'), null, { timeout: 8000 });
    await page.locator('#deckAdjust').click();
    await page.waitForTimeout(500);
    const slide = await shown();
    assert.deepEqual(slide.knobs, ['EXPOSICIÓN 0', 'EMPUJE 0', 'FORMATO 35 MM', 'GRANO SÍ'], 'diapositiva: cuatro perillas (sin papel)');
    await page.keyboard.press('Escape');
    await pickCamera(page, 'FILM', 'CINE500T');
    await page.waitForFunction(() => flipFilm.state().film.startsWith('CINE500T'), null, { timeout: 8000 });
    step('cada película enseña sus perillas', { blancoYNegro: mono.knobs.length, diapositiva: slide.knobs.length, sepia: seenSepia.mean });

    // las perillas
    await page.locator('#deckAdjust').click();
    await page.waitForTimeout(500);
    const knobs = await page.evaluate(() => [...document.querySelectorAll('#filmEditPanel .cs-slot')].filter(el => el.offsetParent).map(el => el.querySelector('[class$="-lbl"]').textContent + ' ' + el.querySelector('[class$="-val"]').textContent));
    assert.deepEqual(knobs, ['EXPOSICIÓN 0', 'EMPUJE 0', 'FORMATO 35 MM', 'PAPEL NORMAL', 'GRANO SÍ'], 'un negativo de color: cinco perillas, con su valor');
    const before = await view();
    await page.locator('#filmEditPanel .cs-knob').first().focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ s: flipFilm.settings(), text: document.getElementById('vFilmEv').textContent }));
    assert.ok(after.s.ev > 1.2 && after.s.ev < 1.5 && after.text === '+1.3', 'la perilla de EXPOSICIÓN va por tercios de paso: ' + JSON.stringify(after));
    const seenUp = await view();
    assert.ok(Math.abs(seenUp.mean[1] - before.mean[1]) < 30, 'con más exposición la copia no se quema (la ampliadora la centra): ' + JSON.stringify([before.mean, seenUp.mean]));
    await page.evaluate(() => { for (const [id, v] of [['filmPush', 1], ['filmFormat', 0], ['filmPaper', 2], ['filmGrain', 0]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } });
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => flipFilm.settings()), { ev: after.s.ev, push: 1, format: 0, paper: 2, filter: 3, toner: 3, grain: false });
    step('las cinco perillas: EXPOSICIÓN, EMPUJE, FORMATO, PAPEL, GRANO', knobs);

    // la foto
    await page.locator('#deckShutter').click();
    await page.waitForFunction(() => document.getElementById('deckGallery').classList.contains('has-shot'), null, { timeout: 10000 });
    step('toma la foto');

    // lo ajustado se guarda
    await page.reload();
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0 && camFamily === 'FILM' && flipFilm.state().frame > 5, null, { timeout: 15000 });
    const kept = await page.evaluate(() => ({ variante: camVariant, s: flipFilm.settings(), film: flipFilm.state().film }));
    assert.deepEqual([kept.variante, kept.s.push, kept.s.format, kept.s.paper, kept.s.grain], ['CINE500T', 1, 0, 2, false], 'al volver, la película y sus ajustes siguen puestos: ' + JSON.stringify(kept));
    assert.equal(kept.film, 'CINE500T:1:2:0:0', '(el filtro y el virado no le tocan a un negativo de color)');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#deckGroups .is-on')].map(k => k.dataset.group)), ['film'], 'y la tira abre en su cajón');
    step('la película y sus ajustes se guardan', kept);

    // al cambiar de cámara, suelta la gráfica (pasados unos segundos sin usarse)
    await page.evaluate(() => { _setCamFamily('AUTO03'); });
    await page.waitForFunction(() => !flipFilm.state().gl, null, { timeout: 20000 });
    assert.deepEqual(errors, [], 'sin errores');
    step('al cambiar de cámara suelta la gráfica');

    // quien traía ajustes guardados de antes de los formatos de cine chico conserva SU formato
    await page.evaluate(() => localStorage.setItem('flip.film', JSON.stringify({ ev: 0, push: 0, format: 0, paper: 1, filter: 0, toner: 0, grain: true })));
    await page.reload();
    await page.waitForFunction(() => window.flipFilm && document.getElementById('vFilmFormat'), null, { timeout: 20000 });
    const old = await page.evaluate(() => ({ s: flipFilm.settings(), text: document.getElementById('vFilmFormat').textContent, max: document.getElementById('filmFormat').max }));
    assert.deepEqual([old.s.format, old.text, old.max], [2, '½ CUADRO', '5'], 'lo guardado como medio cuadro sigue siendo medio cuadro: ' + JSON.stringify(old));
    await page.evaluate(() => flipFilm.set({ format: 0 }));
    await page.reload();
    await page.waitForFunction(() => window.flipFilm && document.getElementById('vFilmFormat'), null, { timeout: 20000 });
    assert.deepEqual(await page.evaluate(() => [flipFilm.settings().format, document.getElementById('vFilmFormat').textContent]), [0, 'SÚPER 8'], 'y lo que se guarda ahora se lee tal cual');
    step('los ajustes guardados de antes conservan su formato', old);

    // con poca luz la cámara baja sola a 15 cuadros por segundo: ya expone largo, y el obturador se cierra
    const dark = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 15 } });
    await dark.page.evaluate(() => { localStorage.removeItem('flip.film'); _setCamFamily('FILM'); });
    await dark.page.waitForFunction(() => camFamily === 'FILM' && flipFilm.state().frame > 3, null, { timeout: 20000 });
    await dark.page.locator('#deckModeSwitch').click();
    await dark.page.waitForFunction(() => camMode === 'video' && flipFilm.state().shuttering && flipFilm.state().cameraMs > 0, null, { timeout: 10000 });
    await dark.page.waitForTimeout(1500);
    const dim = await dark.page.evaluate(() => flipFilm.state());
    assert.ok(dim.cameraMs > 55 && dim.amount === 0, 'a 15 cuadros por segundo el obturador de cine no añade estela: ' + JSON.stringify({ cameraMs: dim.cameraMs, amount: dim.amount }));
    assert.deepEqual(dark.errors, [], 'sin errores');
    step('con poca luz el obturador se cierra', { pasoDeLaCamaraMs: dim.cameraMs, parte: dim.amount });
    console.log('FILM PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
