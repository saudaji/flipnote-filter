// MATRIZ: la pantalla de puntos de fósforo que dibuja con la dirección de los contornos. Lo que tiene
// que seguir siendo verdad, medido:
//   · sobre bordes rectos de ángulo conocido (vertical, horizontal, 45° y 135°) con ruido de sensor,
//     cada celda junto al borde elige esa dirección;
//   · una pared lisa con ruido no tiene dirección: cae a vertical;
//   · los cordones diagonales pasan por la esquina de la celda sin muesca;
//   · con la escena quieta la orientación no hierve de un cuadro a otro;
//   · tres fósforos (verde, ámbar, hielo); espejo; el golpe cruza las diagonales; PERSONA;
//   · como cámara: se elige, pinta, sus mandos están en la hoja y la foto sale a tamaño completo;
//   · EDIT guarda la variante de una capa CAM («family:variant») y los proyectos de antes cargan.
//   FLIP_URL=http://127.0.0.1:8760 node tests/matriz.cjs
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, openFlip, pickCamera, pickVariant, saveDataUrl } = require('./lib/harness.cjs');
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const EVIDENCE = process.env.FLIP_EVIDENCE || path.join(__dirname, '..', '..', 'alpha2-evidence', 'camaras-nuevas');

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } });
    await page.waitForFunction(() => typeof renderMatriz === 'function' && vid.videoWidth > 0);
    // En la página: una escena de dos tonos partida por una recta (ángulo en grados, en pantalla) con
    // ruido de sensor (σ = 0,06) nuevo en cada cuadro, y el motor pintando sobre ella.
    await page.evaluate(() => {
      const W = 540, H = 720;
      window.__mz = {
        src: Object.assign(document.createElement('canvas'), { width: W, height: H }),
        out: Object.assign(document.createElement('canvas'), { width: W, height: H }),
        noise(ctx, sigma) {
          const id = ctx.getImageData(0, 0, W, H), d = id.data;
          for (let i = 0; i < d.length; i += 4) { const n = (Math.random() + Math.random() + Math.random() - 1.5) * 2 * sigma * 255; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
          ctx.putImageData(id, 0, 0);
        },
        // deg: dirección del borde en pantalla (0 horizontal, 90 vertical, 45 «/», 135 «\»)
        edge(deg, sigma) {
          const c = this.src.getContext('2d', { willReadFrequently: true });
          c.fillStyle = 'rgb(64,64,64)'; c.fillRect(0, 0, W, H);
          const a = deg * Math.PI / 180, dx = Math.cos(a), dy = -Math.sin(a), L = 2000;
          c.fillStyle = 'rgb(191,191,191)'; c.beginPath();
          c.moveTo(W / 2 - dx * L, H / 2 - dy * L); c.lineTo(W / 2 + dx * L, H / 2 + dy * L);
          c.lineTo(W / 2 + dx * L - dy * L, H / 2 + dy * L + dx * L); c.lineTo(W / 2 - dx * L - dy * L, H / 2 - dy * L + dx * L); c.closePath(); c.fill();
          if (sigma) this.noise(c, sigma);
        },
        flat(sigma) { const c = this.src.getContext('2d', { willReadFrequently: true }); c.fillStyle = 'rgb(128,128,128)'; c.fillRect(0, 0, W, H); this.noise(c, sigma); },
        run(opts, variant, mirror, now) { return renderMatriz(this.src, W, H, this.out.getContext('2d'), !!mirror, variant || 'FOSFORO', { path: 'prueba', now, ...opts }); },
      };
    });

    // ── 1 · Bordes de ángulo conocido ──
    const angles = await page.evaluate(async () => {
      const out = {};
      const want = { 90: 0, 0: 1, 45: 2, 135: 3 };
      let now = 100000;
      for (const deg of [90, 0, 45, 135]) {
        now += 2000;                                                          // (otra escena: memoria nueva)
        for (let i = 0; i < 10; i++) { __mz.edge(deg, 0.06); __mz.run({}, 'FOSFORO', false, now += 33); }
        const c = flipMatriz.cells(), st = flipMatriz.state();
        // celdas cuyo centro queda a menos de 1,2 celdas del borde
        const cell = st.cellPx, W = 540, H = 720, gx = (W - c.cw * cell) / 2, gy = (H - c.ch * cell) / 2;
        const a = deg * Math.PI / 180, nx = Math.sin(a), ny = Math.cos(a);       // normal del borde (y hacia abajo)
        let near = 0, hit = 0, far = 0, farVert = 0;
        for (let y = 0; y < c.ch; y++) for (let x = 0; x < c.cw; x++) {
          const px = gx + (x + 0.5) * cell - W / 2, py = gy + (y + 0.5) * cell - H / 2, d = Math.abs(px * nx + py * ny) / cell;
          const m = c.mode[y * c.cw + x];
          if (d < 1.2) { near++; if (m === want[deg]) hit++; }
          else if (d > 6) { far++; if (m === 0) farVert++; }
        }
        out[deg] = { near, hit: +(hit / near).toFixed(3), farVertical: +(farVert / far).toFixed(3) };
      }
      return out;
    });
    for (const [deg, r] of Object.entries(angles)) {
      assert.ok(r.hit >= 0.9, 'borde a ' + deg + '°: las celdas junto al borde eligen su dirección: ' + JSON.stringify(r));
      assert.ok(r.farVertical >= 0.97, 'borde a ' + deg + '°: lejos del borde (zona lisa con ruido) va vertical: ' + JSON.stringify(r));
    }
    step('bordes a 90°, 0°, 45° y 135° con ruido σ=0,06: cada celda junto al borde elige bien', angles);

    // ── 2 · Pared lisa con ruido: vertical ──
    const wall = await page.evaluate(() => {
      let now = 200000;
      for (let i = 0; i < 12; i++) { __mz.flat(0.06); __mz.run({}, 'FOSFORO', false, now += 33); }
      const c = flipMatriz.cells();
      return { vertical: +(c.mode.filter(m => m === 0).length / c.mode.length).toFixed(4), cohMax: Math.max(...c.coh) };
    });
    assert.ok(wall.vertical >= 0.995, 'una pared lisa con ruido cae a vertical: ' + JSON.stringify(wall));
    step('pared lisa con ruido: todo vertical', wall);

    // ── 3 · Cordón diagonal sin muesca en la esquina de celda ──
    // Una franja ancha a 45°: dentro, todas las celdas «/» y enlazadas. Se recorre el centro de un
    // cordón de centro a centro de celda (pasa justo por la esquina) y se mide la luz del verde.
    const cord = await page.evaluate(() => {
      const c2 = __mz.src.getContext('2d', { willReadFrequently: true }), W = 540, H = 720;
      let now = 300000;
      for (let i = 0; i < 6; i++) {
        c2.fillStyle = '#404040'; c2.fillRect(0, 0, W, H);
        c2.save(); c2.translate(W / 2, H / 2); c2.rotate(-Math.PI / 4);
        for (let k = -12; k <= 12; k++) { c2.fillStyle = k % 2 ? '#a0a0a0' : '#606060'; c2.fillRect(-900, k * 14, 1800, 14); }
        c2.restore();
        __mz.run({}, 'FOSFORO', false, now += 33);
      }
      const c = flipMatriz.cells(), st = flipMatriz.state(), cell = st.cellPx;
      const gx = (W - c.cw * cell) / 2, gy = (H - c.ch * cell) / 2;
      const ctx = __mz.out.getContext('2d', { willReadFrequently: true }), img = ctx.getImageData(0, 0, W, H).data;
      const G = (x, y) => img[4 * (Math.round(y) * W + Math.round(x)) + 1];
      // centro: celdas «/» con sus dos enlaces, lejos del borde de la franja
      const cx = Math.floor(c.cw / 2), cy = Math.floor(c.ch / 2);
      const res = [];
      for (let k = -3; k <= 3; k++) {
        const x0 = cx + k, y0 = cy - k;
        if (c.mode[y0 * c.cw + x0] !== 2 || c.linked[y0 * c.cw + x0] !== 3) continue;
        let lo = 255, hi = 0, corner = 0;
        for (let t = 0; t <= 1.0001; t += 0.05) {
          const g = G(gx + (x0 + 0.5 + t) * cell, gy + (y0 + 0.5 - t) * cell);
          lo = Math.min(lo, g); hi = Math.max(hi, g); if (Math.abs(t - 0.5) < 0.01) corner = g;
        }
        // el canal entre dos cordones vecinos (van a 0,707 celdas y desfasados medio paso: el canal
        // ondula): el punto más oscuro dentro de la celda
        let gap = 255;
        for (let v = 0; v <= 1.0001; v += 0.1) for (let u = 0; u <= 1.0001; u += 0.1) gap = Math.min(gap, G(gx + (x0 + u) * cell, gy + (y0 + v) * cell));
        res.push({ lo, hi, corner, gap });
      }
      return { cells: res.length, res, slash: +(c.mode.filter(m => m === 2).length / c.mode.length).toFixed(2) };
    });
    assert.ok(cord.cells >= 4, 'hay cordones «/» enlazados en la franja: ' + JSON.stringify(cord));
    for (const r of cord.res) {
      assert.ok(r.lo >= 0.55 * r.hi, 'el cordón no se estrecha en la esquina de la celda: ' + JSON.stringify(r));
      assert.ok(r.gap < 0.6 * r.corner, 'y entre cordones queda un canal más oscuro: ' + JSON.stringify(r));
    }
    step('cordones diagonales continuos por la esquina de celda, canal negro entre ellos', cord.res[0]);

    // ── 3b · El fósforo: en una pared lisa el verde ocupa 55–65 % y el canal queda a medias ──
    const phosphor = await page.evaluate(() => {
      let now = 350000;
      const c2 = __mz.src.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i < 8; i++) { c2.fillStyle = '#808080'; c2.fillRect(0, 0, 540, 720); __mz.run({}, 'FOSFORO', false, now += 33); }
      const d = __mz.out.getContext('2d', { willReadFrequently: true }).getImageData(120, 160, 300, 400).data, g = [];
      for (let i = 0; i < d.length; i += 4) g.push(d[i + 1]);
      g.sort((a, b) => a - b);
      const peak = g[Math.floor(g.length * 0.99)], floor = g[Math.floor(g.length * 0.01)];
      return { verde: +(g.filter(v => v > floor + 0.5 * (peak - floor)).length / g.length).toFixed(3), canal: floor, pico: peak };
    });
    assert.ok(phosphor.verde >= 0.55 && phosphor.verde <= 0.65, 'en una pared lisa el verde ocupa 55–65 % del área: ' + JSON.stringify(phosphor));
    assert.ok(phosphor.canal > 25 && phosphor.canal < 110, 'el resplandor llena el canal a medias (ni negro ni lleno): ' + JSON.stringify(phosphor));
    step('fósforo gordo y con resplandor', phosphor);

    // ── 3c · Parches: en un retrato, zonas de 5–10 celdas todas horizontales o diagonales ──
    const patches = await page.evaluate(() => {
      const base = document.createElement('canvas'); base.width = 540; base.height = 720;
      FlipScenes.draw(base.getContext('2d'), 540, 720, 'portrait', 0, {});
      __mz.src.getContext('2d').drawImage(base, 0, 0);
      let now = 380000;
      for (let i = 0; i < 8; i++) __mz.run({}, 'FOSFORO', false, now += 33);
      const c = flipMatriz.cells(), seen = new Uint8Array(c.mode.length), sizes = [];
      for (let k = 0; k < c.mode.length; k++) {
        if (seen[k] || c.mode[k] === 0) continue;
        const m = c.mode[k], stack = [k]; let n = 0; seen[k] = 1;
        while (stack.length) { const q = stack.pop(); n++; const x = q % c.cw, y = (q / c.cw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, nk = ny * c.cw + nx; if (nx >= 0 && ny >= 0 && nx < c.cw && ny < c.ch && !seen[nk] && c.mode[nk] === m) { seen[nk] = 1; stack.push(nk); } } }
        sizes.push(n);
      }
      sizes.sort((a, b) => b - a);
      const cells = sizes.reduce((a, b) => a + b, 0);
      return { noVertical: +(cells / c.mode.length).toFixed(2), parches: sizes.length, mayores: sizes.slice(0, 5), sueltas: +(sizes.filter(n => n < 4).reduce((a, b) => a + b, 0) / cells).toFixed(3) };
    });
    assert.ok(patches.noVertical >= 0.3, 'un retrato da zonas no verticales grandes: ' + JSON.stringify(patches));
    assert.ok(patches.mayores[0] >= 40 && patches.mayores[3] >= 25, 'parches de verdad, no contornos finos: ' + JSON.stringify(patches));
    assert.ok(patches.sueltas < 0.05, 'sin celdas sueltas: ' + JSON.stringify(patches));
    step('parches grandes y decididos en un retrato', patches);

    // ── 4 · Quieta, no hierve ──
    const still = await page.evaluate(() => {
      const c2 = __mz.src.getContext('2d', { willReadFrequently: true });
      const base = document.createElement('canvas'); base.width = 540; base.height = 720;
      FlipScenes.draw(base.getContext('2d'), 540, 720, 'roomLit', 0, {});
      let now = 400000, prev = null, changed = 0, total = 0;
      for (let i = 0; i < 40; i++) {
        c2.drawImage(base, 0, 0); __mz.noise(c2, 0.03);
        __mz.run({}, 'FOSFORO', false, now += 33);
        if (i < 8) continue;                                                  // (se asienta)
        const m = flipMatriz.cells().mode;
        if (prev) { for (let k = 0; k < m.length; k++) if (m[k] !== prev[k]) changed++; total += m.length; }
        prev = m;
      }
      return { cambian: +(changed / total * 100).toFixed(3), diagonales: +(prev.filter(v => v >= 2).length / prev.length).toFixed(2) };
    });
    assert.ok(still.cambian < 0.3, 'con la escena quieta y ruido de sensor casi ninguna celda cambia de un cuadro a otro (%): ' + JSON.stringify(still));
    assert.ok(still.diagonales > 0.03, 'y la habitación sí tiene contornos con dirección: ' + JSON.stringify(still));
    step('escena quieta con ruido: la orientación no hierve', still);

    // ── 5 · Tres fósforos, espejo, el golpe, PERSONA ──
    const looks = await page.evaluate(() => {
      const mean = () => { const d = __mz.out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 540, 720).data; const s = [0, 0, 0]; for (let i = 0; i < d.length; i += 16) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; } const n = d.length / 16; return s.map(v => Math.round(v / n)); };
      const base = document.createElement('canvas'); base.width = 540; base.height = 720;
      FlipScenes.draw(base.getContext('2d'), 540, 720, 'portrait', 0, {});
      __mz.src.getContext('2d').drawImage(base, 0, 0);
      const out = {};
      let now = 500000;
      for (const v of ['FOSFORO', 'AMBAR', 'HIELO']) { for (let i = 0; i < 3; i++) __mz.run({}, v, false, now += 33); out[v] = mean(); }
      // espejo: una escena con un borde «/» a la izquierda: espejada, «\» a la derecha
      __mz.edge(45, 0); now += 2000; for (let i = 0; i < 6; i++) __mz.run({}, 'FOSFORO', false, now += 33);
      const a = flipMatriz.cells();
      now += 2000; for (let i = 0; i < 6; i++) __mz.run({}, 'FOSFORO', true, now += 33);
      const b = flipMatriz.cells();
      let agree = 0, n = 0;
      for (let y = 0; y < a.ch; y++) for (let x = 0; x < a.cw; x++) { const m = a.mode[y * a.cw + x], mm = b.mode[y * a.cw + (a.cw - 1 - x)]; if (m >= 2) { n++; if (mm === 5 - m) agree++; } }
      out.espejo = +(agree / n).toFixed(3);
      // el golpe: con un golpe nuevo, 120 ms con las diagonales cruzadas
      now += 2000;
      __mz.run({ audio: { bass: 0, mid: 0, treble: 0, beat: 0, beats: 1 } }, 'FOSFORO', false, now += 33);
      const before = flipMatriz.cells().linked.slice();
      __mz.run({ audio: { bass: 0, mid: 0, treble: 0, beat: 1, beats: 2 } }, 'FOSFORO', false, now += 33);
      const during = flipMatriz.state().flip;
      __mz.run({ audio: { bass: 0, mid: 0, treble: 0, beat: 0.2, beats: 2 } }, 'FOSFORO', false, now += 200);
      out.golpe = { cruzadas: during, despues: flipMatriz.state().flip };
      // PERSONA: con una máscara (media pantalla), fuera de la persona todo en columnas
      flipSilhouette.use(input => { const w = 32, h = 32, d = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = x < 16 ? 1 : 0; return { data: d, width: w, height: h }; });
      __mz.edge(45, 0); now += 2000;
      for (let i = 0; i < 6; i++) { __mz.run({ sujeto: true }, 'FOSFORO', false, now += 40); }
      const c = flipMatriz.cells(), l = { izq: 0, der: 0, nI: 0, nD: 0 };
      for (let y = 0; y < c.ch; y++) for (let x = 0; x < c.cw; x++) { const diag = c.mode[y * c.cw + x] >= 2; if (x < c.cw * 0.4) { l.nI++; if (diag) l.izq++; } else if (x > c.cw * 0.6) { l.nD++; if (diag) l.der++; } }
      // (flipMatriz.cells lee el estado; lo que se ve —la persona en cordones— sale de los enlaces: se mira el dibujo)
      const d = __mz.out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 540, 720).data;
      let li = 0, ld = 0;
      for (let y = 0; y < 720; y += 3) for (let x = 0; x < 540; x += 3) { const g = d[4 * (y * 540 + x) + 1]; if (x < 200) li += g; else if (x > 340) ld += g; }
      out.persona = { fase: flipMatriz.state().person, luzDentro: Math.round(li), luzFuera: Math.round(ld) };
      return out;
    });
    assert.ok(looks.FOSFORO[1] > looks.FOSFORO[0] * 1.5 && looks.FOSFORO[1] > looks.FOSFORO[2], 'FÓSFORO es verde: ' + looks.FOSFORO);
    assert.ok(looks.AMBAR[0] > looks.AMBAR[1] && looks.AMBAR[1] > looks.AMBAR[2] * 1.5, 'ÁMBAR es ámbar: ' + looks.AMBAR);
    assert.ok(looks.HIELO[2] > looks.HIELO[0] * 1.5 && looks.HIELO[2] >= looks.HIELO[1] * 0.95, 'HIELO es azul hielo: ' + looks.HIELO);
    assert.ok(looks.espejo >= 0.9, 'espejada, cada «/» sale «\\» en la celda simétrica: ' + looks.espejo);
    assert.deepEqual(looks.golpe, { cruzadas: true, despues: false }, 'el golpe cruza las diagonales 120 ms');
    assert.equal(looks.persona.fase, 'ready');
    assert.ok(looks.persona.luzDentro > looks.persona.luzFuera * 1.8, 'PERSONA: la persona brilla y el fondo queda tenue: ' + JSON.stringify(looks.persona));
    step('tres fósforos, espejo, el golpe y PERSONA', looks);

    // ── 6 · Como cámara: se elige, pinta, la hoja trae sus mandos; foto a tamaño completo ──
    await page.evaluate(() => flipSilhouette.use(() => null));
    await pickCamera(page, 'MATRIZ');
    await page.waitForFunction(() => camFamily === 'MATRIZ' && flipMatriz.state().slot.startsWith('cam:'), null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const cam = await page.evaluate(() => {
      const g = document.createElement('canvas'); g.width = 90; g.height = 160;
      const c = g.getContext('2d', { willReadFrequently: true }); c.drawImage(display, 0, 0, 90, 160);
      const d = c.getImageData(0, 0, 90, 160).data; let green = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 1] > d[i] + 30 && d[i + 1] > d[i + 2] + 10) green++;
      return { st: flipMatriz.state(), verde: +(green / (d.length / 4)).toFixed(2), lcd: document.getElementById('lcdLook') ? document.getElementById('lcdLook').textContent : '', mandos: [...document.querySelectorAll('#fxEditPanel .fx-ctrl-row:not([hidden])')].map(r => r.dataset.fxId), panel: document.getElementById('fxEditPanel').style.display, espejo: camMirror() };
    });
    assert.ok(cam.st.ready && !cam.st.failed, 'pinta en la gráfica');
    assert.ok(cam.verde > 0.25, 'el visor es fósforo verde: ' + cam.verde);
    assert.deepEqual(cam.mandos, ['celdas', 'flujo', 'halo', 'sujeto', 'datos']);
    assert.equal(cam.panel, 'block');
    assert.ok(cam.st.msAvg < 12, 'tiempo por cuadro (hilo principal, ms): ' + cam.st.msAvg);
    // un mando se guarda en ajustes y llega al motor
    await page.evaluate(() => { const i = document.getElementById('fxMATRIZceldas'); i.value = 48; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(400);
    const tuned = await page.evaluate(() => ({ cells: flipMatriz.state().cells, saved: JSON.parse(localStorage.getItem('flipSettings')).fxCamVals.MATRIZ.celdas }));
    assert.equal(Math.min(...tuned.cells), 48, 'CELDAS cambia la rejilla: ' + tuned.cells);
    assert.equal(tuned.saved, 48, 'y se guarda en ajustes');
    await pickVariant(page, 'AMBAR');
    await page.waitForFunction(() => flipMatriz.state().variant === 'AMBAR', null, { timeout: 5000 });
    const photo = await page.evaluate(async () => {
      const blob = await renderCameraPhoto(), bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; const s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4 * 61) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
      const st = flipMatriz.state();
      return { size: [bmp.width, bmp.height], drawn: st.size, cellPx: st.cellPx, cells: st.cells, rgb: s, url: c.toDataURL('image/jpeg', 0.85) };
    });
    saveDataUrl(path.join(EVIDENCE, 'matriz-foto-ambar.jpg'), photo.url);
    assert.ok(Math.min(...photo.size) >= 720, 'la foto sale grande: ' + photo.size);
    assert.deepEqual(photo.drawn, photo.size, 'y el motor la pintó a su tamaño, no estirada del visor');
    assert.equal(Math.min(...photo.cells), 48, 'con la misma rejilla que el visor');
    assert.ok(photo.rgb[0] > photo.rgb[2] * 1.5, 'en ámbar');
    step('MATRIZ como cámara: visor, mandos guardados y foto a tamaño completo', { visor: cam.st.size, ms: cam.st.msAvg, foto: photo.size, celdaFoto: photo.cellPx });

    // ── 7 · ESCUCHA sabe qué mueve en MATRIZ ──
    const ear = await page.evaluate(async () => {
      flipEscucha.inject({ bass: 1, mid: 0, high: 1 });
      await flipEscucha.set(true, { mic: false });
      await new Promise(ok => setTimeout(ok, 500));
      const s = flipEscucha.state();
      await flipEscucha.set(false); flipEscucha.inject(null);
      return { mueve: s.mueve, applied: s.applied, base: [fxCamVals.MATRIZ.flujo, fxCamVals.MATRIZ.halo] };
    });
    assert.equal(ear.mueve, true);
    assert.deepEqual(ear.applied, [Math.max(10, ear.base[0] - 14), Math.min(100, ear.base[1] + 35)], 'el bajo baja FLUJO y los agudos suben HALO: ' + JSON.stringify(ear));
    assert.deepEqual(await page.evaluate(() => [fxCamVals.MATRIZ.flujo, fxCamVals.MATRIZ.halo]), ear.base, 'y los mandos vuelven a su valor');
    step('ESCUCHA mueve FLUJO y HALO', ear);

    // ── 8 · EDIT: la capa CAM guarda «family:variant»; un proyecto de antes carga igual ──
    const edit = await page.evaluate(() => {
      const seen = [];
      const real = _renderCamEngineFrame;
      _renderCamEngineFrame = function (s, w, h, c, m, o) { seen.push([o.family, o.variant]); return real.apply(this, arguments); };
      const src = document.createElement('canvas'); src.width = 320; src.height = 240; src.getContext('2d').fillRect(0, 0, 100, 100);
      const dst = document.createElement('canvas'); dst.width = 320; dst.height = 240;
      FLIP_STEP_ENGINES.cam.renderStep(src, dst.getContext('2d'), _editStepParams({ engine: 'cam', family: 'MATRIZ', variant: 'HIELO' }), null, 1000);
      FLIP_STEP_ENGINES.cam.renderStep(src, dst.getContext('2d'), _editStepParams({ engine: 'cam', family: 'MATRIZ' }), null, 1033);
      FLIP_STEP_ENGINES.cam.renderStep(src, dst.getContext('2d'), _editStepParams({ engine: 'cam', family: 'MATRIZ', variant: 'NOEXISTE' }), null, 1066);
      _renderCamEngineFrame = real;
      return { seen, profiles: [flipMatriz.state().variant], valid: [_editCamVariant('MATRIZ', 'HIELO'), _editCamVariant('MATRIZ', 'B128'), _editCamVariant('CONSOLA', 'NOCHE')] };
    });
    assert.deepEqual(edit.seen, [['MATRIZ', 'HIELO'], ['MATRIZ', undefined], ['MATRIZ', undefined]], 'la capa pasa su variante (y si no es de la familia, ninguna)');
    assert.deepEqual(edit.valid, ['HIELO', undefined, 'NOCHE']);
    // un proyecto guardado antes de las variantes: solo familia
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('flipSettings'));
      s.editPipeline = { source: { type: 'cam' }, steps: [{ engine: 'cam', on: true, family: 'CONSOLA' }, { engine: 'cam', on: true, family: 'MATRIZ', variant: 'AMBAR' }] };
      localStorage.setItem('flipSettings', JSON.stringify(s));
    });
    await page.reload();
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0);
    const loaded = await page.evaluate(() => window._editPipeline.steps.map(s => [s.family, s.variant || null]));
    assert.deepEqual(loaded, [['CONSOLA', null], ['MATRIZ', 'AMBAR']], 'carga el proyecto de antes y el nuevo: ' + JSON.stringify(loaded));
    step('EDIT: «family:variant» en la capa CAM, y los proyectos de antes cargan', loaded);

    assert.deepEqual(errors, [], 'sin errores de página');
    console.log('MATRIZ PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
