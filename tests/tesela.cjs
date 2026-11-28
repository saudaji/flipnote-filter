// TESELA: la figura hecha de baldosas de una memoria de video rota. Lo que tiene que seguir siendo
// verdad, medido:
//   · el banco propio tiene 32 baldosas de 8 × 8 a cuatro tonos, todas distintas; como en la pieza,
//     los arcos van llenos (campo de cobalto, trazo claro) y el ladrillo rojo con su textura de puntos;
//   · el color va por zonas (rojo ladrillo, arcos azules, poca plata); dentro de la figura el negro
//     es ~30 % de los puntos, como en la pieza, con pocos huecos; las ráfagas hacen tiras de 3–6;
//   · la salida usa SOLO los colores de las cuatro sub-paletas (ni un tono intermedio);
//   · con una persona, el borde de la figura cae en múltiplos de baldosa (ninguna baldosa a medias)
//     y fuera de ella todo es negro;
//   · cambia a saltos (a SALTOS por segundo), no en cada cuadro; ROTURA 0 no corrompe nada y 1, mucho;
//   · sin nadie delante (o mientras carga el detector) no se queda en negro: el cuadro entero, apagado;
//   · con ESCUCHA, la corrupción salta con el golpe;
//   · como cámara: se elige, pinta, sus mandos están en la hoja y la foto sale a tamaño completo.
//   FLIP_URL=http://127.0.0.1:8760 node tests/tesela.cjs
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, openFlip, pickCamera, pickVariant, saveDataUrl } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const EVIDENCE = process.env.FLIP_EVIDENCE || path.join(__dirname, '..', '..', 'alpha2-evidence', 'camaras-nuevas');

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'portrait', w: 720, h: 1280, fps: 30 } });
    await page.waitForFunction(() => typeof renderTesela === 'function' && vid.videoWidth > 0);

    // ── 1 · El banco ──
    const bank = await page.evaluate(() => {
      const b = flipTesela.bank();
      let thick = 0, lit = 0;
      const fine = [], zeros = [];
      b.forEach((t, k) => {
        const on = (x, y) => x >= 0 && y >= 0 && x < 8 && y < 8 && t[y * 8 + x] > 0;
        let checker = 0;
        for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) { const a = t[y * 8 + x], b2 = t[y * 8 + x + 1], c = t[y * 8 + x + 8], d = t[y * 8 + x + 9]; if (a === d && b2 === c && a !== b2 && (a === 0 || b2 === 0)) checker++; }
        if (checker >= 4) fine.push(flipTesela.names[k]);
        // trazo gordo: cada punto encendido cabe en un cuadrito de 2 × 2 encendido
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (on(x, y)) { lit++; if ([[-1, -1], [0, -1], [-1, 0], [0, 0]].some(([dx, dy]) => on(x + dx, y + dy) && on(x + dx + 1, y + dy) && on(x + dx, y + dy + 1) && on(x + dx + 1, y + dy + 1))) thick++; }
        zeros.push(t.filter(v => v === 0).length / 64);
      });
      return { n: b.length, sizes: [...new Set(b.map(t => t.length))], levels: [...new Set(b.flat())].sort(), distinct: new Set(b.map(t => t.join(''))).size, lit: b.map(t => t.filter(v => v > 0).length),
        gordo: +(thick / lit).toFixed(3), tramaFina: fine, negroMedio: +(zeros.reduce((a, v) => a + v, 0) / 32).toFixed(3), conNegro: zeros.filter(z => z >= 0.15).length,
        // (en la textura: fila 0 los arcos, fila 1 el ladrillo)
        arcos: b.slice(0, 8).map(t => ({ cobalto: +(t.filter(v => v === 1).length / 64).toFixed(2), claro: t.filter(v => v >= 2).length })),
        ladrillo: b.slice(8, 16).map(t => ({ rojo: +(t.filter(v => v === 2).length / 64).toFixed(2), puntos: t.filter((v, i) => v === 0 && i % 8 > 0 && i % 8 < 7).length })) };
    });
    assert.equal(bank.n, 32);
    assert.deepEqual(bank.sizes, [64], 'baldosas de 8 × 8');
    assert.deepEqual(bank.levels, [0, 1, 2, 3], 'a 2 bits por punto');
    assert.equal(bank.distinct, 32, 'las 32 distintas');
    assert.ok(bank.lit.every(n => n >= 4 && n <= 64), 'ninguna vacía: ' + bank.lit);
    assert.ok(bank.arcos.every(a => a.cobalto >= 0.4 && a.claro >= 6), 'los arcos, llenos: campo de cobalto y trazo claro: ' + JSON.stringify(bank.arcos));
    assert.ok(bank.ladrillo.every(b => b.rojo >= 0.5 && b.puntos >= 4), 'el ladrillo, rojo con su textura de puntos negros: ' + JSON.stringify(bank.ladrillo));
    step('banco propio: 32 glifos 8×8 a 2 bits, distintos; arcos llenos y ladrillo con puntos', { arcos: bank.arcos.map(a => a.cobalto), ladrillo: bank.ladrillo.map(b => b.rojo) })

    // En la página: la escena (el retrato dibujado) y el motor pintando sobre ella, a 360 × 640.
    await page.evaluate(() => {
      const W = 360, H = 640;
      const src = Object.assign(document.createElement('canvas'), { width: 720, height: 1280 });
      FlipScenes.draw(src.getContext('2d'), 720, 1280, 'portrait', 0, {});
      // una persona: cabeza y hombros en el centro (máscara de 64 × 112)
      const figure = () => { const w = 64, h = 112, d = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const hx = (x - 32) / 14, hy = (y - 40) / 18; d[y * w + x] = (hx * hx + hy * hy < 1) || (y > 62 && Math.abs(x - 32) < 9 + (y - 62) * 0.55) ? 1 : 0; } return { data: d, width: w, height: h }; };
      window.__ts = {
        W, H, src, figure,
        out: k => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; },
        run(canvas, variant, opts, now) { return renderTesela(src, 720, 1280, canvas.getContext('2d'), false, variant, { now, ...opts }); },
        pixels: canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data,
        key: canvas => { const d = __ts.pixels(canvas); let h = 2166136261; for (let i = 0; i < d.length; i += 4) { h ^= d[i] | d[i + 1] << 8 | d[i + 2] << 16; h = Math.imul(h, 16777619); } return h >>> 0; },
      };
      flipSilhouette.use(figure);
    });

    // ── 2 · Solo colores de las sub-paletas ──
    const colors = await page.evaluate(() => {
      const allowed = new Set(flipTesela.palettes.flat().map(c => c.toUpperCase()));
      const res = {};
      for (const v of ['TOTAL', 'SILUETA']) {
        const c = __ts.out();
        for (let i = 0; i < 4; i++) __ts.run(c, v, { path: 'colores' + v }, 50000 + i * 33);
        const d = __ts.pixels(c), seen = new Map();
        let bad = 0;
        for (let i = 0; i < d.length; i += 4) { const hex = '#' + [d[i], d[i + 1], d[i + 2]].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase(); seen.set(hex, (seen.get(hex) || 0) + 1); if (!allowed.has(hex)) bad++; }
        res[v] = { distintos: seen.size, fuera: bad };
      }
      return res;
    });
    for (const [v, r] of Object.entries(colors)) assert.equal(r.fuera, 0, v + ': ningún punto fuera de las sub-paletas: ' + JSON.stringify(r));
    assert.ok(colors.TOTAL.distintos >= 8, 'y se usan varias sub-paletas: ' + JSON.stringify(colors.TOTAL));
    step('la salida usa solo los colores de las sub-paletas', colors);

    // ── 3 · Borde de la figura a baldosa entera, negro fuera ──
    // SILUETA y TOTAL en el mismo salto: cada baldosa sale entera igual que en TOTAL o entera negra.
    const edge = await page.evaluate(() => {
      const a = __ts.out(), b = __ts.out(), now = 60000;
      for (let i = 0; i < 3; i++) { __ts.run(b, 'TOTAL', { path: 'borde-t' }, now); __ts.run(a, 'SILUETA', { path: 'borde-s' }, now); }
      const st = flipTesela.state(), tile = st.tilePx, W = __ts.W, H = __ts.H;
      const da = __ts.pixels(a), db = __ts.pixels(b);
      let inside = 0, outside = 0, partial = 0, outsideLit = 0;
      const mask = __ts.figure(), cw = st.cells[0], ch = st.cells[1];
      // cada punto es de la baldosa floor((x + ½) / baldosa), como en la gráfica
      const same = new Int32Array(cw * ch), black = new Int32Array(cw * ch), count = new Int32Array(cw * ch);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = Math.floor((y + 0.5) / tile) * cw + Math.floor((x + 0.5) / tile), i = 4 * (y * W + x);
        count[k]++;
        if (da[i] === db[i] && da[i + 1] === db[i + 1] && da[i + 2] === db[i + 2]) same[k]++;
        if (da[i] + da[i + 1] + da[i + 2] === 0) black[k]++;
      }
      // la máscara en el centro de la baldosa, con el mismo filtrado lineal que la gráfica
      const at = (u, v) => { const fx = Math.max(0, Math.min(mask.width - 1, u * mask.width - 0.5)), fy = Math.max(0, Math.min(mask.height - 1, v * mask.height - 0.5)); const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(mask.width - 1, x0 + 1), y1 = Math.min(mask.height - 1, y0 + 1), tx = fx - x0, ty = fy - y0, M = (x, y) => mask.data[y * mask.width + x]; return (M(x0, y0) * (1 - tx) + M(x1, y0) * tx) * (1 - ty) + (M(x0, y1) * (1 - tx) + M(x1, y1) * tx) * ty; };
      for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
        const k = cy * cw + cx, n = count[k];
        if (!n) continue;
        if (same[k] === n) inside++; else if (black[k] === n) outside++; else partial++;
        const m = at(Math.min(1, (cx + 0.5) * tile / W), Math.min(1, (cy + 0.5) * tile / H));
        if (m < 0.4 && black[k] !== n) outsideLit++;
      }
      return { tile, cells: st.cells, inside, outside, partial, outsideLit, cut: st.cut };
    });
    assert.equal(edge.cut, true, 'recorta a la persona');
    assert.equal(edge.partial, 0, 'ninguna baldosa a medias: el borde cae en múltiplos de baldosa: ' + JSON.stringify(edge));
    assert.equal(edge.outsideLit, 0, 'fuera de la figura, todo negro: ' + JSON.stringify(edge));
    assert.ok(edge.inside > 100 && edge.outside > 300, 'hay figura y hay fondo: ' + JSON.stringify(edge));
    step('borde de la figura en múltiplos de baldosa, negro fuera', edge);

    // ── 3b · Color por zonas, huecos en la figura, ráfagas en tiras ──
    const zones = await page.evaluate(() => {
      const pals = flipTesela.palettes.map(p => new Set(p.slice(1).map(c => c.toUpperCase()).filter(c => c !== '#FFFFFF')));
      const mask = __ts.figure();
      const tiles = (canvas, tile, cw, ch) => {
        const d = __ts.pixels(canvas), W = __ts.W, out = [];
        for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
          const votes = [0, 0, 0, 0]; let lit = 0, sig = 2166136261;
          for (let y = Math.ceil(cy * tile); y < Math.min(__ts.H, (cy + 1) * tile - 0.5); y++) for (let x = Math.ceil(cx * tile); x < Math.min(W, (cx + 1) * tile - 0.5); x++) {
            const i = 4 * (y * W + x), hex = '#' + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
            sig ^= d[i] | d[i + 1] << 8 | d[i + 2] << 16; sig = Math.imul(sig, 16777619);
            if (hex !== '#000000') { lit++; pals.forEach((p, k) => { if (p.has(hex)) votes[k]++; }); }
          }
          const u = (cx + 0.5) * tile / W, v = (cy + 0.5) * tile / __ts.H;
          const inside = mask.data[Math.min(mask.height - 1, Math.floor(v * mask.height)) * mask.width + Math.min(mask.width - 1, Math.floor(u * mask.width))] > 0.5;
          out.push({ cx, cy, inside, black: lit < 3, pal: votes.indexOf(Math.max(...votes)), sig: lit < 3 ? 0 : sig >>> 0 });
        }
        return out;
      };
      // huecos y paletas, promediados en tres saltos
      let inside = 0, black = 0, pxIn = 0, pxBlack = 0; const share = [0, 0, 0, 0]; let same = 0, pairs = 0;
      for (let k = 0; k < 3; k++) {
        const c = __ts.out();
        __ts.run(c, 'SILUETA', { path: 'zonas', rotura: 0.55 }, 120000 + k * 1000);
        const st = flipTesela.state(), list = tiles(c, st.tilePx, st.cells[0], st.cells[1]);
        // negro punto a punto dentro de la figura
        const dd = __ts.pixels(c);
        for (let y = 0; y < __ts.H; y += 2) for (let x = 0; x < __ts.W; x += 2) { const mv = mask.data[Math.min(mask.height - 1, Math.floor(y / __ts.H * mask.height)) * mask.width + Math.min(mask.width - 1, Math.floor(x / __ts.W * mask.width))]; if (mv < 0.5) continue; pxIn++; const i = 4 * (y * __ts.W + x); if (Math.max(dd[i], dd[i + 1], dd[i + 2]) < 40) pxBlack++; }
        const at = (x, y) => list[y * st.cells[0] + x];
        for (const t of list) {
          if (!t.inside) continue;
          inside++;
          if (t.black) { black++; continue; }
          share[t.pal]++;
          for (const [dx, dy] of [[1, 0], [0, 1]]) { const n = at(t.cx + dx, t.cy + dy); if (n && n.inside && !n.black) { pairs++; if (n.pal === t.pal) same++; } }
        }
      }
      const lit = inside - black;
      // ráfagas: tiras de 3 o más baldosas idénticas de lado (con ROTURA 0 y con 1).
      // (a 336 × 672 la baldosa mide 12 puntos justos: dos baldosas iguales salen iguales punto a punto)
      const runs = rot => {
        const c = document.createElement('canvas'); c.width = 336; c.height = 672;
        renderTesela(__ts.src, 720, 1280, c.getContext('2d'), false, 'TOTAL', { now: 130000, path: 'rafagas' + rot, rotura: rot, baldosa: 28 });
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 336, 672).data, cw = 28, ch = 56, sig = [];
        for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
          let h = 2166136261, lit = 0;
          for (let y = cy * 12; y < cy * 12 + 12; y++) for (let x = cx * 12; x < cx * 12 + 12; x++) { const i = 4 * (y * 336 + x); if (d[i] | d[i + 1] | d[i + 2]) lit++; h ^= d[i] | d[i + 1] << 8 | d[i + 2] << 16; h = Math.imul(h, 16777619); }
          sig.push(lit < 3 ? 0 : h >>> 0);
        }
        const n = new Set();
        for (let y = 0; y < ch; y++) for (let x = 0; x + 2 < cw; x++) { const a = sig[y * cw + x]; if (a && a === sig[y * cw + x + 1] && a === sig[y * cw + x + 2]) n.add(y * cw + x + ':' + a); }
        // (solo de lado: en columna ya hay tiras de fábrica, las del ladrillo apilado)
        return n;
      };
      return { huecos: +(black / inside).toFixed(3), negroPuntos: +(pxBlack / pxIn).toFixed(3), azul: +(share[0] / lit).toFixed(2), rojo: +(share[1] / lit).toFixed(2), plata: +(share[2] / lit).toFixed(2), sombra: +(share[3] / lit).toFixed(2), vecinasMismaPaleta: +(same / pairs).toFixed(2), tiras: (() => { const r0 = runs(0), r1 = runs(1); return { rotura0: r0.size, rotura1: r1.size, nuevas: [...r1].filter(k => !r0.has(k)).length }; })() };
    });
    assert.ok(zones.huecos >= 0.04 && zones.huecos <= 0.25, 'pocos huecos enteros, como en la pieza: ' + JSON.stringify(zones));
    assert.ok(zones.negroPuntos >= 0.22 && zones.negroPuntos <= 0.45, 'dentro de la figura el negro es ~30 % de los puntos (la pieza: 0,30): ' + JSON.stringify(zones));
    assert.ok(zones.rojo >= 0.2 && zones.azul >= 0.2 && zones.plata <= 0.2, 'rojo ladrillo y arcos azules; la plata, minoría: ' + JSON.stringify(zones));
    assert.ok(zones.vecinasMismaPaleta >= 0.6, 'el color va por manchas: las vecinas comparten sub-paleta: ' + JSON.stringify(zones));
    assert.ok(zones.tiras.nuevas >= 8, 'la rotura hace tiras nuevas de baldosas iguales (que sin rotura no están): ' + JSON.stringify(zones.tiras));
    step('color por zonas, huecos en la figura y ráfagas en tiras', zones);

    // ── 4 · A saltos, no en cada cuadro; ROTURA 0 frente a 1 ──
    const jumps = await page.evaluate(() => {
      const res = {};
      for (const [name, opts] of [['saltos6', { saltos: 6, rotura: 0.55 }], ['rotura0', { saltos: 6, rotura: 0 }], ['rotura1', { saltos: 6, rotura: 1 }]]) {
        const c = __ts.out(); let prev = null, changes = 0, frames = 0;
        const t0 = 90000 + Object.keys(res).length * 10000;
        for (let i = 0; i < 60; i++) { __ts.run(c, 'TOTAL', { path: 'saltos-' + name, ...opts }, t0 + i * 1000 / 30); const k = __ts.key(c); if (prev !== null && k !== prev) changes++; prev = k; frames++; }
        res[name] = { cuadros: frames, cambios: changes };
      }
      // cuántas baldosas cambian entre dos saltos con ROTURA 1
      const a = __ts.out(), b = __ts.out();
      __ts.run(a, 'TOTAL', { path: 'r1a', saltos: 6, rotura: 1 }, 200000); __ts.run(b, 'TOTAL', { path: 'r1b', saltos: 6, rotura: 1 }, 200000 + 1000 / 6 + 5);
      const st = flipTesela.state(), tile = st.tilePx, da = __ts.pixels(a), db = __ts.pixels(b);
      let diff = 0, n = 0;
      for (let cy = 0; cy < st.cells[1] - 1; cy++) for (let cx = 0; cx < st.cells[0] - 1; cx++) { n++; let d = false; for (let y = Math.ceil(cy * tile); y < (cy + 1) * tile && !d; y++) for (let x = Math.ceil(cx * tile); x < (cx + 1) * tile; x++) { const i = 4 * (y * __ts.W + x); if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) { d = true; break; } } if (d) diff++; }
      res.rotura1Baldosas = +(diff / n).toFixed(2);
      return res;
    });
    assert.ok(jumps.saltos6.cambios >= 10 && jumps.saltos6.cambios <= 13, 'a 6 saltos por segundo, en 2 s cambia ~12 veces (no 59): ' + JSON.stringify(jumps.saltos6));
    assert.equal(jumps.rotura0.cambios, 0, 'con ROTURA 0 y la escena quieta, nada cambia: ' + JSON.stringify(jumps.rotura0));
    assert.ok(jumps.rotura1Baldosas > 0.25, 'con ROTURA 1, entre dos saltos cambia buena parte de las baldosas: ' + jumps.rotura1Baldosas);
    step('cambia a saltos; ROTURA 0 frente a 1', jumps);

    // ── 5 · Sin nadie (o cargando): el cuadro entero, apagado, nunca negro ──
    const nobody = await page.evaluate(() => {
      const lit = c => { const d = __ts.pixels(c); let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 0) n++; return +(n / (d.length / 4)).toFixed(3); };
      flipSilhouette.use(() => ({ data: new Float32Array(64 * 112), width: 64, height: 112 }));
      const c = __ts.out();
      for (let i = 0; i < 4; i++) __ts.run(c, 'SILUETA', { path: 'nadie' }, 300000 + i * 40);
      const a = { fase: flipTesela.state().person, apagada: flipTesela.state().dim, encendido: lit(c) };
      const t = __ts.out(); __ts.run(t, 'TOTAL', { path: 'nadie-total' }, 300000);
      a.total = lit(t);
      flipSilhouette.use(() => null);                                            // un detector que aún no da máscara
      for (let i = 0; i < 4; i++) __ts.run(c, 'SILUETA', { path: 'nadie' }, 301000 + i * 40);
      a.cargando = { fase: flipTesela.state().person, encendido: lit(c) };
      flipSilhouette.use(__ts.figure);
      return a;
    });
    assert.equal(nobody.fase, 'nobody');
    assert.ok(nobody.apagada && nobody.encendido > 0.15 && nobody.encendido < nobody.total, 'sin nadie: el cuadro entero, más apagado que TOTAL: ' + JSON.stringify(nobody));
    assert.ok(nobody.cargando.encendido > 0.15, 'mientras carga, tampoco negro: ' + JSON.stringify(nobody.cargando));
    step('sin nadie o cargando: el cuadro entero apagado', nobody);

    // ── 6 · Con ESCUCHA, la corrupción salta con el golpe ──
    const beat = await page.evaluate(() => {
      const c = __ts.out(), keys = [];
      for (let i = 0; i < 20; i++) { __ts.run(c, 'TOTAL', { path: 'golpe', audio: { bass: 0, mid: 0, treble: 0, beat: 0, beats: i < 10 ? 3 : 4 } }, 400000 + i * 100); keys.push(__ts.key(c)); }
      return { antes: new Set(keys.slice(0, 10)).size, despues: new Set(keys.slice(10)).size, salto: keys[9] !== keys[10], tick: flipTesela.state().tick };
    });
    assert.deepEqual([beat.antes, beat.despues, beat.salto, beat.tick], [1, 1, true, 4], 'quieta entre golpes y salta en el golpe (aunque pase un segundo): ' + JSON.stringify(beat));
    step('con ESCUCHA, la memoria salta con el golpe', beat);

    // ── 7 · Como cámara ──
    await pickCamera(page, 'TESELA');
    await page.waitForFunction(() => camFamily === 'TESELA' && flipTesela.state().slots.some(k => k.startsWith('cam:')) && flipTesela.state().cut, null, { timeout: 15000 });
    const cam = await page.evaluate(() => ({ st: flipTesela.state(), mandos: [...document.querySelectorAll('#fxEditPanel .fx-ctrl-row:not([hidden])')].map(r => r.dataset.fxId), espejo: camMirror() }));
    assert.deepEqual(cam.mandos, ['baldosa', 'rotura', 'saltos']);
    assert.equal(cam.st.cut, true, 'en la cámara recorta a la persona (detector de prueba): ' + JSON.stringify(cam.st));
    assert.ok(cam.st.msAvg < 12, 'tiempo por cuadro (hilo principal, ms): ' + cam.st.msAvg);
    await pickVariant(page, 'TOTAL');
    await page.waitForFunction(() => flipTesela.state().variant === 'TOTAL', null, { timeout: 5000 });
    const photo = await page.evaluate(async () => {
      const blob = await renderCameraPhoto(), bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
      const st = flipTesela.state();
      return { size: [bmp.width, bmp.height], drawn: st.size, cells: st.cells, tilePx: st.tilePx, url: c.toDataURL('image/jpeg', 0.85) };
    });
    saveDataUrl(path.join(EVIDENCE, 'tesela-foto-total.jpg'), photo.url);
    assert.deepEqual(photo.drawn, photo.size, 'la foto se pinta a su tamaño: ' + JSON.stringify(photo));
    assert.equal(Math.min(...photo.cells), 64, 'con 64 baldosas en el lado corto, como el visor');
    step('TESELA como cámara: visor, mandos y foto a tamaño completo', { visor: cam.st.size, ms: cam.st.msAvg, foto: photo.size, baldosaFoto: photo.tilePx });

    assert.deepEqual(errors, [], 'sin errores de página');
    console.log('TESELA PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
