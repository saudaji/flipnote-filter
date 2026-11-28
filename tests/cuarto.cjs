// La cámara CUARTO (un cuarto en 3D de 32 bits con tu imagen en su pantalla). Con escenas dibujadas
// aquí, pasadas por el motor en un lienzo propio, se comprueba con números:
//   · cuarto oscuro con pantalla que brilla (≥ 70 % del cuadro con luz < 0,15 y percentil 99 > 0,7);
//   · la pantalla muestra la cámara (fuente roja → pantalla roja; azul → azul) y su luz tiñe el cuarto;
//   · imagen a bloques de la resolución interna (también en la foto grande) y ≤ 32 niveles por canal;
//   · el paseo cambia el cuadro y vuelve al inicio al cabo del ciclo; con giro 0 se queda quieto;
//   · las tres escenas son distintas; la pantalla es la protagonista del plano (≥ 25 % del ancho en
//     el de presentación, ≥ 35 % el anuncio de la AZOTEA) en vertical y en horizontal, y grande en la
//     mayor parte del paseo;
//   · espejo: se espeja lo que sale en la pantalla, no el cuarto;
//   · la textura va sin corrección de perspectiva y los vértices saltan a la rejilla;
//   · sonido, costo por cuadro, soltar y rehacer, pérdida de la gráfica;
//   · y, si la app ya la registra, la cámara en el visor y su foto.
//   FLIP_URL=http://127.0.0.1:8760 node tests/cuarto.cjs [--shots carpeta]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, openFlip, pickCamera, pickVariant, saveDataUrl, encodeClip } = require('./lib/harness.cjs');

const at = process.argv.indexOf('--shots');
const shots = at >= 0 ? path.resolve(process.argv[at + 1]) : '';
if (shots) fs.mkdirSync(shots, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const VARS = ['DORMITORIO', 'OFICINA', 'AZOTEA'];
const SIZES = [[540, 960], [1024, 576]];

const KIT = () => {
  const paint = {
    roomLit: (g, w, h) => FlipScenes.draw(g, w, h, 'roomLit', 0),
    retrato: (g, w, h) => FlipScenes.draw(g, w, h, 'portrait', 0),
    rojo: (g, w, h) => { g.fillStyle = '#e8241c'; g.fillRect(0, 0, w, h); },
    azul: (g, w, h) => { g.fillStyle = '#2048ee'; g.fillRect(0, 0, w, h); },
    mitad: (g, w, h) => { g.fillStyle = '#e8241c'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#2048ee'; g.fillRect(w / 2, 0, w / 2, h); },
  };
  function scene(name, w = 1280, h = 720) { const c = document.createElement('canvas'); c.width = w; c.height = h; paint[name](c.getContext('2d'), w, h); return c; }
  // Varios cuadros seguidos (la luz de la pantalla se asienta en unos diez) y el último en el lienzo.
  function run(src, W, H, { variant = 'DORMITORIO', frames = 12, start = 1000, opts = {}, mirror = false } = {}) {
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    let ok = true;
    for (let i = 0; i < frames; i++) ok = renderCuarto(src, src.width, src.height, ctx, mirror, variant, { now: start + i * 33.333, ...opts }) && ok;
    out.ok = ok; out.st = flipCuarto.state();
    return out;
  }
  const px = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  function luz(c) {
    const d = px(c), n = d.length / 4, L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255;
    let dark = 0; for (const v of L) dark += v < 0.15;
    L.sort();
    return { oscuro: +(dark / n).toFixed(3), mediana: +L[n >> 1].toFixed(3), p90: +L[Math.floor(n * 0.9)].toFixed(3), p99: +L[Math.floor(n * 0.99)].toFixed(3) };
  }
  function niveles(c) { const d = px(c), s = [new Set(), new Set(), new Set()]; for (let i = 0; i < d.length; i += 4) { s[0].add(d[i]); s[1].add(d[i + 1]); s[2].add(d[i + 2]); } return s.map(x => x.size); }
  // Cuántas columnas (y filas) distintas tiene la imagen y cuánto mide el bloque típico.
  function bloques(c) {
    const d = px(c), W = c.width, H = c.height;
    const colDiff = x => { for (let y = 0; y < H; y++) { const a = (y * W + x) * 4, b = a - 4; if (d[a] !== d[b] || d[a + 1] !== d[b + 1] || d[a + 2] !== d[b + 2]) return true; } return false; };
    const rowDiff = y => { for (let x = 0; x < W; x++) { const a = (y * W + x) * 4, b = a - W * 4; if (d[a] !== d[b] || d[a + 1] !== d[b + 1] || d[a + 2] !== d[b + 2]) return true; } return false; };
    const runs = (n, diff) => { const r = []; let len = 1; for (let i = 1; i < n; i++) { if (diff(i)) { r.push(len); len = 1; } else len++; } r.push(len); return r; };
    const rc = runs(W, colDiff), rr = runs(H, rowDiff), med = a => a.slice().sort((p, q) => p - q)[a.length >> 1];
    return { columnas: rc.length, filas: rr.length, bloqueX: med(rc), bloqueY: med(rr) };
  }
  const inRect = (x, y, r) => r && x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
  function media(c, rect, fuera) {
    const d = px(c), W = c.width, H = c.height, s = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (inRect(x, y, rect) === !!fuera) continue; const k = (y * W + x) * 4; s[0] += d[k]; s[1] += d[k + 1]; s[2] += d[k + 2]; n++; }
    return s.map(v => +(v / Math.max(1, n)).toFixed(1));
  }
  function dif(a, b, fuera) {
    const p = px(a), q = px(b), W = a.width, H = a.height;
    let s = 0, n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (inRect(x, y, fuera)) continue; const k = (y * W + x) * 4; s += Math.abs(p[k] - q[k]) + Math.abs(p[k + 1] - q[k + 1]) + Math.abs(p[k + 2] - q[k + 2]); n += 3; }
    return +(s / n).toFixed(2);
  }
  // Rectángulo dentro de la pantalla (su caja, encogida) y alrededor (su caja, agrandada).
  function interior(st, f = 0.25) { const [x, y, w, h] = st.pantalla.rect; return [Math.round(x + w * f), Math.round(y + h * f), Math.round(w * (1 - 2 * f)), Math.round(h * (1 - 2 * f))]; }
  function caja(st, f = 0.3) { const [x, y, w, h] = st.pantalla.rect; return [Math.round(x - w * f), Math.round(y - h * f), Math.round(w * (1 + 2 * f)), Math.round(h * (1 + 2 * f))]; }
  window.CK = { scene, run, px, luz, niveles, bloques, media, dif, interior, caja };
};

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { boot: false, desktop: true });
    await page.waitForFunction(() => document.readyState === 'complete');
    if (await page.evaluate(() => typeof window.renderCuarto) !== 'function') await page.addScriptTag({ path: path.join(__dirname, '..', 'docs', 'cuarto.js') });
    await page.evaluate(KIT);
    const intro = await page.evaluate(() => ({ fn: typeof renderCuarto, api: !!window.flipCuarto, variantes: flipCuarto.VARIANTES, fabrica: flipCuarto.FABRICA, ciclo: flipCuarto.cycle() }));
    assert.equal(intro.fn, 'function', 'el motor expone renderCuarto');
    assert.ok(intro.api, 'y flipCuarto');
    assert.deepEqual(intro.variantes, ['DORMITORIO', 'OFICINA', 'AZOTEA']);
    step('el motor expone renderCuarto y flipCuarto', intro);

    // ── 1 · Cuarto oscuro con pantalla que brilla, en vertical y horizontal ──
    // (el plano de presentación —giro 0— y, para saber, la media de cinco momentos del paseo)
    const oscuro = await page.evaluate(([VARS, SIZES]) => {
      const src = CK.scene('roomLit'), out = {};
      for (const v of VARS) for (const [W, H] of SIZES) {
        const quieto = CK.run(src, W, H, { variant: v, opts: { giro: 0 } });
        const paseo = [0, 0.2, 0.4, 0.6, 0.8].map(f => CK.luz(CK.run(src, W, H, { variant: v, frames: 8, start: 5000 + f * flipCuarto.cycle(), opts: { giro: 0.35 } })));
        const m = k => +(paseo.reduce((a, s) => a + s[k], 0) / paseo.length).toFixed(3);
        out[v + ' ' + W + '×' + H] = { presentacion: CK.luz(quieto), paseo: { oscuro: m('oscuro'), p99: m('p99') }, ok: quieto.ok };
      }
      return out;
    }, [VARS, SIZES]);
    for (const [k, r] of Object.entries(oscuro)) {
      assert.ok(r.ok, k + ': pinta');
      assert.ok(r.presentacion.oscuro >= 0.7 && r.presentacion.p99 > 0.7, k + ': cuarto oscuro con pantalla que brilla: ' + JSON.stringify(r));
      assert.ok(r.paseo.oscuro >= 0.7, k + ': y oscuro a lo largo del paseo: ' + JSON.stringify(r));
    }
    step('cuarto oscuro (≥ 70 % bajo 0,15) con pantalla que brilla (p99 > 0,7)', oscuro);

    // ── 2 · La pantalla muestra la cámara y su luz tiñe el cuarto ──
    const tinte = await page.evaluate(VARS => {
      const out = {};
      for (const v of VARS) {
        const r = {};
        for (const name of ['rojo', 'azul']) {
          const c = CK.run(CK.scene(name), 540, 960, { variant: v, frames: 14, opts: { giro: 0 } }), st = c.st;
          r[name] = { pantalla: CK.media(c, CK.interior(st)), alrededor: CK.media(c, CK.caja(st), true) };
        }
        const rb = m => m[0] - m[2];
        r.tinte = +(rb(r.rojo.alrededor) - rb(r.azul.alrededor)).toFixed(1);
        out[v] = r;
      }
      return out;
    }, VARS);
    for (const [v, r] of Object.entries(tinte)) {
      const [R1, G1, B1] = r.rojo.pantalla, [R2, G2, B2] = r.azul.pantalla;
      assert.ok(R1 > 1.8 * B1 && R1 > 1.8 * G1 && R1 > 90, v + ': con la cámara roja, la pantalla es roja: ' + JSON.stringify(r));
      assert.ok(B2 > 1.8 * R2 && B2 > 1.4 * G2 && B2 > 90, v + ': con la cámara azul, la pantalla es azul: ' + JSON.stringify(r));
      assert.ok(r.rojo.alrededor[0] > r.azul.alrededor[0] + 1 && r.azul.alrededor[2] > r.rojo.alrededor[2] + 1 && r.tinte > 3, v + ': y la luz de la pantalla tiñe el cuarto: ' + JSON.stringify(r));
    }
    step('la pantalla muestra la cámara y su luz tiñe el cuarto (R−B alrededor, rojo menos azul)', Object.fromEntries(Object.entries(tinte).map(([v, r]) => [v, { pantallaRoja: r.rojo.pantalla, pantallaAzul: r.azul.pantalla, alrededorRojo: r.rojo.alrededor, alrededorAzul: r.azul.alrededor, tinte: r.tinte }])));

    // ── 3 · Píxel gordo y 5 bits: en el visor y en una foto 4 veces más grande ──
    const pixel = await page.evaluate(() => {
      const src = CK.scene('roomLit'), out = {};
      for (const [W, H, extra] of [[540, 960, {}], [1024, 576, {}], [2160, 3840, { path: 'capture', outW: 2160, outH: 3840 }]]) {
        const c = CK.run(src, W, H, { variant: 'DORMITORIO', frames: 6, opts: { giro: 0, ...extra } });
        out[W + '×' + H] = { interna: c.st.size, ...CK.bloques(c), niveles: CK.niveles(c) };
      }
      return out;
    });
    for (const [k, r] of Object.entries(pixel)) {
      const [W, H] = k.split('×').map(Number);
      assert.ok(r.interna[0] <= 320 && r.interna[1] <= 320 && Math.max(...r.interna) === 320, k + ': imagen interna de 320 de lado largo: ' + JSON.stringify(r));
      assert.ok(r.columnas <= r.interna[0] + 1 && r.filas <= r.interna[1] + 1 && r.columnas > r.interna[0] * 0.6, k + ': la imagen sale a bloques de la resolución interna: ' + JSON.stringify(r));
      assert.ok(Math.abs(r.bloqueX - W / r.interna[0]) <= 1 && Math.abs(r.bloqueY - H / r.interna[1]) <= 1, k + ': y el bloque mide lo que toca: ' + JSON.stringify(r));
      assert.ok(r.niveles.every(n => n <= 32 && n >= 12), k + ': ≤ 32 niveles por canal: ' + JSON.stringify(r));
    }
    assert.deepEqual(pixel['2160×3840'].interna, pixel['540×960'].interna, 'la foto grande no sube la resolución interna');
    step('píxel gordo (también en la foto) y ≤ 32 niveles por canal', pixel);

    // ── 4 · El paseo: cambia en el tiempo, vuelve al inicio al cabo del ciclo; giro 0 lo deja quieto ──
    const paseo = await page.evaluate(() => {
      const src = CK.scene('roomLit'), out = {};
      for (const v of ['DORMITORIO', 'OFICINA', 'AZOTEA']) {
        const C = flipCuarto.cycle(0.35), t0 = 20000;
        const f = t => CK.run(src, 360, 640, { variant: v, frames: 10, start: t, opts: { giro: 0.35 } });
        const a = f(t0), b = f(t0 + C / 4), m = f(t0 + C / 2), z = f(t0 + C);
        const q1 = CK.run(src, 360, 640, { variant: v, frames: 10, start: 30000, opts: { giro: 0 } }), q2 = CK.run(src, 360, 640, { variant: v, frames: 10, start: 47000, opts: { giro: 0 } });
        out[v] = {
          ciclo: C, cuarto: CK.dif(a, b), medio: CK.dif(a, m), vuelta: CK.dif(a, z),
          ojo: [a.st.eye, z.st.eye], quieto: CK.dif(q1, q2), ojoQuieto: [q1.st.eye, q2.st.eye],
          fases: [a.st.phase, b.st.phase, m.st.phase, z.st.phase],
        };
      }
      return out;
    });
    for (const [v, r] of Object.entries(paseo)) {
      assert.ok(r.cuarto > 6 && r.medio > 6, v + ': el paseo cambia el cuadro: ' + JSON.stringify(r));
      assert.ok(r.ojo[0].every((x, i) => Math.abs(x - r.ojo[1][i]) < 2e-3) && r.vuelta < Math.min(r.cuarto, r.medio) * 0.15, v + ': y vuelve al inicio al cabo del ciclo: ' + JSON.stringify(r));
      assert.ok(r.ojoQuieto[0].join() === r.ojoQuieto[1].join() && r.quieto < 1.5, v + ': con giro 0 se queda quieto: ' + JSON.stringify(r));
    }
    step('paseo cerrado y determinista; giro 0 quieto (diferencia media en niveles)', paseo);

    // ── 5 · Las tres escenas son distintas; vertical y horizontal encuadran la pantalla ──
    const escenas = await page.evaluate(([VARS, SIZES]) => {
      const src = CK.scene('roomLit'), c = VARS.map(v => CK.run(src, 540, 960, { variant: v, frames: 6, opts: { giro: 0 } }));
      const pares = { 'DORMITORIO·OFICINA': CK.dif(c[0], c[1]), 'DORMITORIO·AZOTEA': CK.dif(c[0], c[2]), 'OFICINA·AZOTEA': CK.dif(c[1], c[2]) };
      const encuadre = {};
      for (const v of VARS) for (const [W, H] of SIZES) {
        const hero = CK.run(src, W, H, { variant: v, frames: 3, opts: { giro: 0 } }).st.pantalla;
        let grande = 0;
        const anchos = [];
        for (let k = 0; k < 8; k++) { const p = CK.run(src, W, H, { variant: v, frames: 2, start: 80000 + k / 8 * flipCuarto.cycle(), opts: { giro: 0.35 } }).st.pantalla; const a = p.visible ? p.rect[2] / W : 0; anchos.push(+a.toFixed(2)); if (a >= 0.18) grande++; }
        const dentro = hero.visible && hero.quad.every(([x, y]) => x >= 0 && x <= W && y >= 0 && y <= H);
        encuadre[v + ' ' + W + '×' + H] = { entera: dentro, visible: hero.visible ? hero.entera : 0, ancho: hero.visible ? +(hero.rect[2] / W).toFixed(3) : 0, paseo: anchos, grandeEnElPaseo: grande + '/8' };
      }
      return { pares, encuadre, triangulos: flipCuarto.state().triangulos };
    }, [VARS, SIZES]);
    assert.ok(Object.values(escenas.pares).every(d => d > 10), 'las tres escenas son distintas: ' + JSON.stringify(escenas.pares));
    for (const [k, e] of Object.entries(escenas.encuadre)) {
      const azotea = k.startsWith('AZOTEA');
      // (el anuncio, como en la referencia, puede salirse un poco por el borde; la tele y el monitor, no)
      assert.ok(azotea ? e.visible >= 0.7 : e.entera, k + ': en el plano de presentación la pantalla se ve: ' + JSON.stringify(e));
      assert.ok(e.ancho >= (azotea ? 0.35 : 0.25), k + ': y es la protagonista del plano (ancho): ' + JSON.stringify(e));
      assert.ok(parseInt(e.grandeEnElPaseo, 10) >= 5, k + ': y sale grande (≥ 18 % del ancho) en la mayor parte del paseo: ' + JSON.stringify(e));
    }
    assert.ok(Object.values(escenas.triangulos).every(n => n < 2500), 'pocos triángulos: ' + JSON.stringify(escenas.triangulos));
    step('tres escenas distintas; la pantalla, protagonista en vertical y horizontal (ancho en fracción del cuadro)', escenas);

    // ── 6 · Espejo: se espeja la imagen de la pantalla, no el cuarto ──
    const espejo = await page.evaluate(() => {
      const src = CK.scene('mitad'), out = {};
      for (const v of ['DORMITORIO', 'OFICINA']) {
        const a = CK.run(src, 540, 960, { variant: v, frames: 14, opts: { giro: 0 } }), b = CK.run(src, 540, 960, { variant: v, frames: 14, opts: { giro: 0 }, mirror: true });
        const [x, y, w, h] = CK.interior(a.st, 0.2), izq = [x, y, Math.round(w / 3), h], der = [x + Math.round(w * 2 / 3), y, Math.round(w / 3), h];
        out[v] = { normal: { izq: CK.media(a, izq), der: CK.media(a, der) }, espejo: { izq: CK.media(b, izq), der: CK.media(b, der) }, cuarto: CK.dif(a, b, CK.caja(a.st, 0.35)) };
      }
      return out;
    });
    for (const [v, r] of Object.entries(espejo)) {
      assert.ok(r.normal.izq[0] > r.normal.izq[2] && r.normal.der[2] > r.normal.der[0], v + ': sin espejo, rojo a la izquierda y azul a la derecha: ' + JSON.stringify(r));
      assert.ok(r.espejo.izq[2] > r.espejo.izq[0] && r.espejo.der[0] > r.espejo.der[2], v + ': con espejo, al revés: ' + JSON.stringify(r));
      assert.ok(r.cuarto < 1, v + ': y el cuarto no se espeja: ' + JSON.stringify(r));
    }
    step('espejo en la pantalla, no en el cuarto', espejo);

    // ── 7 · Textura sin corrección de perspectiva y vértices a la rejilla ──
    const tecnica = await page.evaluate(() => {
      const src = CK.scene('roomLit'), out = {};
      for (const v of ['DORMITORIO', 'AZOTEA']) {
        const base = CK.run(src, 540, 960, { variant: v, frames: 4, opts: { giro: 0 } });
        const persp = CK.run(src, 540, 960, { variant: v, frames: 4, opts: { giro: 0, _perspectiva: true } });
        const liso = CK.run(src, 540, 960, { variant: v, frames: 4, opts: { giro: 0, temblor: 0 } });
        out[v] = { afinContraPerspectiva: CK.dif(base, persp), rejillaContraLiso: CK.dif(base, liso) };
      }
      return out;
    });
    for (const [v, r] of Object.entries(tecnica)) {
      assert.ok(r.afinContraPerspectiva > 0.3, v + ': la textura va afín (distinta de la corregida): ' + JSON.stringify(r));
      assert.ok(r.rejillaContraLiso > 0.3, v + ': los vértices saltan a la rejilla: ' + JSON.stringify(r));
    }
    step('textura afín y vértices a la rejilla (diferencias medias en niveles)', tecnica);

    // ── 8 · Sonido: el golpe hace destellar la pantalla; los graves empujan el paseo ──
    const sonido = await page.evaluate(() => {
      const src = CK.scene('roomLit');
      const scr = audio => { const c = CK.run(src, 540, 960, { variant: 'DORMITORIO', frames: 10, start: 90000, opts: { giro: 0, audio } }); const m = CK.media(c, CK.interior(c.st)); return +(0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]).toFixed(1); };
      const avance = audio => { const c = document.createElement('canvas'); c.width = 270; c.height = 480; const ctx = c.getContext('2d'); renderCuarto(src, 1280, 720, ctx, false, 'OFICINA', { now: 100000, audio }); const p0 = flipCuarto.state().phase; for (let i = 1; i <= 30; i++) renderCuarto(src, 1280, 720, ctx, false, 'OFICINA', { now: 100000 + i * 33.3, audio }); return +(((flipCuarto.state().phase - p0) % 1 + 1) % 1).toFixed(5); };
      return { pantallaQuieta: scr(null), pantallaGolpe: scr({ bass: 0, mid: 0, treble: 0, beat: 1 }), avanceQuieto: avance({ bass: 0, mid: 0, treble: 0, beat: 0 }), avanceGraves: avance({ bass: 1, mid: 0, treble: 0, beat: 0 }), dice: flipCuarto.state().audio };
    });
    assert.ok(sonido.pantallaGolpe > sonido.pantallaQuieta * 1.15, 'el golpe hace destellar la pantalla: ' + JSON.stringify(sonido));
    assert.ok(sonido.avanceGraves > sonido.avanceQuieto * 1.6, 'los graves empujan el paseo: ' + JSON.stringify(sonido));
    step('sonido', sonido);

    // ── 9 · Costo por cuadro, soltar y rehacer, pérdida de la gráfica ──
    const costo = await page.evaluate(async () => {
      const ms = {};
      for (const v of ['DORMITORIO', 'OFICINA', 'AZOTEA']) for (const [W, H] of [[540, 960], [1024, 576]]) {
        const src = CK.scene('roomLit'), c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        for (let i = 0; i < 5; i++) renderCuarto(src, 1280, 720, ctx, false, v, { now: 110000 + i * 33.3 });
        ctx.getImageData(0, 0, 1, 1);
        const t0 = performance.now();
        for (let i = 0; i < 40; i++) renderCuarto(src, 1280, 720, ctx, false, v, { now: 111000 + i * 33.3 });
        ctx.getImageData(0, 0, 1, 1);
        ms[v + ' ' + W + '×' + H] = +((performance.now() - t0) / 40).toFixed(2);
      }
      const src = CK.scene('roomLit'), ctx = document.createElement('canvas').getContext('2d');
      const before = flipCuarto.state().gl;
      flipCuarto.release();
      const released = flipCuarto.state().gl;
      const again = renderCuarto(src, 1280, 720, ctx, false, 'DORMITORIO', { now: 120000 });
      const lost0 = flipCuarto.state().lost;
      const perdio = flipCuarto._perder();
      await new Promise(r => setTimeout(r, 60));
      const c = CK.run(src, 540, 960, { variant: 'DORMITORIO', frames: 12, start: 121000, opts: { giro: 0 } });
      return { msPorCuadro: ms, suelta: [before, released, again, flipCuarto.state().gl], perdida: { provocada: perdio, antes: lost0, despues: flipCuarto.state().lost, repinta: c.ok, luz: CK.luz(c) } };
    });
    assert.deepEqual(costo.suelta, [true, false, true, true], 'la gráfica se suelta y se rehace al volver a pintar');
    assert.ok(costo.perdida.provocada && costo.perdida.despues === costo.perdida.antes + 1 && costo.perdida.repinta && costo.perdida.luz.p99 > 0.7, 'tras perder la gráfica, se rehace y vuelve a pintar: ' + JSON.stringify(costo.perdida));
    assert.ok(Object.values(costo.msPorCuadro).every(ms => ms < 60), 'costo por cuadro razonable: ' + JSON.stringify(costo.msPorCuadro));
    step('costo por cuadro (ms, con el volcado al lienzo), soltar y rehacer, pérdida de la gráfica', costo);

    // ── 10 · Hojas de contacto (con --shots) ──
    if (shots) {
      const hojas = await page.evaluate(([VARS]) => {
        const src = CK.scene('roomLit'), moments = [0, 0.22, 0.47, 0.72], out = {};
        for (const [W, H, tag, s] of [[540, 960, 'vertical', 0.5], [1024, 576, 'horizontal', 0.5]]) {
          const cw = Math.round(W * s), chh = Math.round(H * s), sheet = document.createElement('canvas');
          sheet.width = cw * moments.length; sheet.height = chh * VARS.length;
          const g = sheet.getContext('2d'); g.imageSmoothingEnabled = false;
          VARS.forEach((v, row) => moments.forEach((f, col) => g.drawImage(CK.run(src, W, H, { variant: v, frames: 12, start: 200000 + f * flipCuarto.cycle(), opts: { giro: 0.35 } }), col * cw, row * chh, cw, chh)));
          out[tag] = sheet.toDataURL('image/png');
        }
        // cada escena en su plano de presentación, a tamaño real
        for (const v of VARS) out['plano-' + v] = CK.run(src, 540, 960, { variant: v, opts: { giro: 0 } }).toDataURL('image/png');
        // la luz de la pantalla tiñe el cuarto: rojo, verde, azul
        const tin = document.createElement('canvas'); tin.width = 270 * 3; tin.height = 480 * VARS.length;
        const tg = tin.getContext('2d'); tg.imageSmoothingEnabled = false;
        const colores = ['#e8241c', '#22c040', '#2048ee'];
        VARS.forEach((v, row) => colores.forEach((col, k) => { const s2 = document.createElement('canvas'); s2.width = 1280; s2.height = 720; const g2 = s2.getContext('2d'); g2.fillStyle = col; g2.fillRect(0, 0, 1280, 720); tg.drawImage(CK.run(s2, 540, 960, { variant: v, frames: 14, opts: { giro: 0 } }), k * 270, row * 480, 270, 480); }));
        out.tinte = tin.toDataURL('image/png');
        return out;
      }, [VARS]);
      saveDataUrl(path.join(shots, 'cuarto-vertical.png'), hojas.vertical);
      saveDataUrl(path.join(shots, 'cuarto-horizontal.png'), hojas.horizontal);
      saveDataUrl(path.join(shots, 'cuarto-tinte-rojo-verde-azul.png'), hojas.tinte);
      for (const v of VARS) saveDataUrl(path.join(shots, 'plano-' + v + '.png'), hojas['plano-' + v]);
      // Referencia al lado de lo nuestro: recortes de las hojas de referencia (solo evidencia, no van al repo).
      const refDir = process.env.FLIP_REF_DIR || '';   // carpeta con las hojas de referencia (fuera del repositorio); sin ella no se arma la comparación
      if (fs.existsSync(path.join(refDir, 'efectos-hoja-2.jpg'))) {
        const b64 = f => fs.readFileSync(path.join(refDir, f)).toString('base64');
        const vs = await page.evaluate(async ([h2, h3]) => {
          const load = async b => createImageBitmap(new Blob([Uint8Array.from(atob(b), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
          const H2 = await load(h2), H3 = await load(h3), k = 2240 / 2043;
          const refs = [[H3, 0, 62, 408, 826], [H3, 1226, 62, 1634, 826], [H2, 1226, 970, 1634, 1736], [H2, 0, 970, 408, 1736], [H3, 409, 972, 817, 1736]];
          const src = CK.scene('roomLit'), cyc = flipCuarto.cycle();
          const mine = [['DORMITORIO', 0], ['DORMITORIO', 0.6], ['OFICINA', 0], ['AZOTEA', 0], ['OFICINA', 0.8]];
          const cw = 300, chh = 540, sheet = document.createElement('canvas'); sheet.width = cw * refs.length; sheet.height = chh * 2;
          const g = sheet.getContext('2d');
          refs.forEach(([img, x0, y0, x1, y1], i) => { g.imageSmoothingEnabled = true; g.drawImage(img, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, i * cw, 0, cw, chh); });
          g.imageSmoothingEnabled = false;
          mine.forEach(([v, f], i) => g.drawImage(CK.run(src, 540, 960, { variant: v, frames: 12, start: 300000 + f * cyc, opts: { giro: f ? 0.35 : 0 } }), i * cw, chh, cw, chh));
          return sheet.toDataURL('image/png');
        }, [b64('efectos-hoja-2.jpg'), b64('efectos-hoja-3.jpg')]);
        saveDataUrl(path.join(shots, 'referencia-vs-cuarto.png'), vs);
      }
      // Un trozo del paseo en video, para ver el temblor de vértices y texturas (si hay ffmpeg).
      try {
        for (const v of VARS) {
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuarto-clip-'));
          for (let k = 0; k < 120; k += 30) {
            const frames = await page.evaluate(([v, k]) => { const src = CK.scene('roomLit'), c = document.createElement('canvas'); c.width = 540; c.height = 960; const ctx = c.getContext('2d'); const out = []; for (let i = k; i < k + 30; i++) { renderCuarto(src, 1280, 720, ctx, false, v, { now: 400000 + i * 33.333, giro: 0.6 }); out.push(c.toDataURL('image/png')); } return out; }, [v, k]);
            frames.forEach((u, i) => saveDataUrl(path.join(dir, 'f_' + String(k + i).padStart(4, '0') + '.png'), u));
          }
          encodeClip(dir, path.join(shots, 'paseo-' + v + '.mp4'), 30);
        }
      } catch (error) { console.log('· (sin video del paseo: ' + String(error && error.message || error).split('\n')[0] + ')'); }
    }

    // ── 11 · En la app (si ya la registra): el visor, el cambio de escena y la foto ──
    const wired = await page.evaluate(() => typeof CAM_FAMILIES !== 'undefined' && !!CAM_FAMILIES.CUARTO);
    if (!wired) console.log('· (la app todavía no registra CAM_FAMILIES.CUARTO: el paso dentro de la app queda escrito y sin correr)');
    else {
      const app = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
      await app.page.evaluate(KIT);
      await pickCamera(app.page, 'CUARTO');
      await app.page.waitForFunction(() => camFamily === 'CUARTO' && flipCuarto.state().frames > 10, null, { timeout: 15000 });
      await app.page.waitForTimeout(800);
      const visor = await app.page.evaluate(() => ({ st: flipCuarto.state(), luz: CK.luz(display), size: [display.width, display.height] }));
      assert.ok(visor.st.gl && visor.st.variant === 'DORMITORIO' && visor.luz.oscuro >= 0.5, 'el visor pinta con CUARTO: ' + JSON.stringify({ luz: visor.luz, st: { variant: visor.st.variant, size: visor.st.size, out: visor.st.out, ms: visor.st.ms } }));
      if (shots) await app.page.screenshot({ path: path.join(shots, 'cuarto-app.png') });
      await pickVariant(app.page, 'AZOTEA');
      await app.page.waitForFunction(() => flipCuarto.state().variant === 'AZOTEA', null, { timeout: 10000 });
      const [download] = await Promise.all([app.page.waitForEvent('download', { timeout: 20000 }), app.page.locator('#deckShutter').click()]);
      const bytes = fs.readFileSync(await download.path());
      const photo = await app.page.evaluate(async b64 => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
        const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; c.getContext('2d').drawImage(bitmap, 0, 0);
        // ¿sale a bloques de la imagen interna? Se rehace la foto con el centro de cada bloque y se
        // compara; si la rejilla de bloques es de verdad, se parece mucho más que con la rejilla corrida
        // medio bloque (la compresión deja algo de ruido dentro del bloque: por eso se compara así)
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height, [iw, ih] = flipCuarto.state().size;
        // (cuenta los píxeles que se equivocan de verdad, > 30 entre los tres canales: el ruido de la compresión no llega)
        const rehecha = shift => { let s = 0, n = 0; for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const bx = Math.min(W - 1, Math.floor((Math.floor(x * iw / W + shift) + 0.5 - shift) * W / iw)), by = Math.min(H - 1, Math.floor((Math.floor(y * ih / H + shift) + 0.5 - shift) * H / ih)); const a = (y * W + x) * 4, b = (Math.max(0, by) * W + Math.max(0, bx)) * 4; s += Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]) > 30; n++; } return +(s / n).toFixed(4); };
        return { size: [W, H], luz: CK.luz(c), conSuRejilla: rehecha(0), conRejillaCorrida: rehecha(0.5), st: { variant: flipCuarto.state().variant, size: flipCuarto.state().size, out: flipCuarto.state().out } };
      }, bytes.toString('base64'));
      if (shots) fs.writeFileSync(path.join(shots, 'cuarto-foto.jpg'), bytes);
      assert.ok(photo.size[0] >= 540 && photo.luz.oscuro >= 0.5, 'la foto sale a su tamaño y oscura: ' + JSON.stringify(photo));
      assert.ok(photo.st.size[0] <= 320 && photo.conSuRejilla < photo.conRejillaCorrida * 0.5, 'y a bloques de la imagen interna (píxeles que no casan al rehacerla con su rejilla y con la rejilla corrida): ' + JSON.stringify(photo));
      step('en la app: visor con CUARTO, cambio a AZOTEA y su foto', { visor: { luz: visor.luz, out: visor.st.out, interna: visor.st.size, ms: visor.st.ms }, foto: photo });
      assert.deepEqual(app.errors, [], 'sin errores de página en la app: ' + app.errors.join(' | '));
      await app.context.close();
    }

    assert.deepEqual(errors, [], 'sin errores de página: ' + errors.join(' | '));
    console.log('\nCUARTO: todo en orden');
  } finally { await browser.close(); }
})().catch(error => { console.error('\n✗ ' + (error && error.stack || error)); process.exit(1); });
