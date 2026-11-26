// FLIP · VFD · REACCIÓN: una reacción química viva dentro de la pantalla de fósforo.
//
// Las demás variantes de VFD son filtros sin memoria: cada cuadro se pinta desde cero. Esta no. Aquí
// la pantalla es un medio: dos sustancias que se difunden y reaccionan entre sí (un modelo de
// reacción-difusión de Gray-Scott) y la cámara no dibuja la imagen, decide en cada punto en qué
// régimen vive esa química:
//   · lo oscuro es zona de extinción: lo que haya crecido ahí se apaga (negro de fósforo);
//   · los contornos siembran reactivo: de ellos brota el coral;
//   · lo iluminado es zona fértil: el coral lo va llenando de laberintos y motas que se dividen.
// Así que lo que se ve es la escena hecha de algo que crece. Lo analógico es la química (continua,
// orgánica, nunca dos veces igual); lo digital es la rejilla que la enseña (niveles contados, tramado
// de 2 × 2, líneas de tubo) y el borde de la imagen real, nítido, encendido en marfil donde cruza el
// coral.
//
// Qué lo mueve además de la luz:
//   · el coral crece a lo largo de los contornos, no en redondo (la difusión se estira en la
//     dirección del borde);
//   · inclinar el teléfono lo arrastra, como un imán junto a un tubo;
//   · con ESCUCHAR encendido: el bajo acelera la reacción, los medios la hacen mutar entre motas y
//     laberintos, los agudos siembran chispas y cada golpe la hace florecer;
//   · si la escena se mueve mucho, el coral viejo se disuelve en vez de quedarse atrás como estela.
//
// Qué cuesta: la química corre en una rejilla de 128 × 96 (12 288 celdas, de 6 a 10 pasos por
// cuadro) en el procesador; un par de milisegundos en un teléfono. Sin WebGL, sin red y sin nada
// que salga del aparato.
(function () {
  'use strict';
  const GW = 128, GH = 96, N = GW * GH;
  const DU = 0.2, DV = 0.1, DT = 0.95;
  let U = new Float32Array(N).fill(1), V = new Float32Array(N), U1 = new Float32Array(N), V1 = new Float32Array(N);
  const Fm = new Float32Array(N), Km = new Float32Array(N), Wx = new Float32Array(N);
  const Ls = new Float32Array(N), Lp = new Float32Array(N), Lf = new Float32Array(N), Ed = new Float32Array(N), Rx = new Float32Array(N);
  const hist = new Uint32Array(256);
  const S = { at: 0, frame: 0, level: null, started: false, pulse: 0, motion: 0, steps: 0, ms: 0, seed: 0x2F6E2B1, wired: false, alive: 0 };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rnd = () => { S.seed = (Math.imul(S.seed, 1664525) + 1013904223) | 0; return (S.seed >>> 0) / 4294967296; };

  // Tres paletas. Cada una: el degradado del coral (de su halo a su cuerpo), el color del frente que
  // está creciendo, el del borde de la imagen donde cruza el coral, y la escena apagada de fondo
  // (negro del tubo, punto del tramado, hilo del contorno: base y lo que le suma la fuerza del borde).
  const ramp = stops => {
    const table = new Uint8Array(256 * 3);
    for (let i = 0, k = 0; i < 256; i++) {
      const f = i / 255;
      while (k < stops.length - 2 && f > stops[k + 1][0]) k++;
      const a = stops[k], b = stops[k + 1], t = clamp((f - a[0]) / (b[0] - a[0] || 1), 0, 1);
      for (let c = 0; c < 3; c++) table[3 * i + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * t);
    }
    return table;
  };
  const PALETTES = {
    // Negro de tubo → índigo → violeta → cian de fósforo → verde FLIP; el frente, en lima.
    fosforo: { label: 'FÓSFORO', lut: ramp([[0, 4, 6, 10], [0.1, 30, 20, 76], [0.26, 96, 44, 236], [0.4, 34, 200, 214], [0.62, 125, 219, 139], [1, 176, 246, 150]]),
      front: [214, 255, 114], edge: [255, 243, 223], back: [4, 6, 10], dot: [10, 44, 58], thread: [16, 60, 80, 30, 60, 64] },
    // Carbón → vino → carmesí → naranja → ámbar; el frente, al blanco de la brasa viva.
    brasa: { label: 'BRASA', lut: ramp([[0, 8, 4, 5], [0.1, 62, 10, 38], [0.26, 176, 22, 52], [0.4, 240, 78, 28], [0.62, 255, 148, 36], [1, 255, 208, 104]]),
      front: [255, 246, 196], edge: [255, 243, 223], back: [8, 4, 5], dot: [56, 16, 20], thread: [60, 24, 20, 60, 30, 16] },
    // Tinta → verde azulado → morado → magenta → rosa; el frente, en menta.
    orquidea: { label: 'ORQUÍDEA', lut: ramp([[0, 5, 4, 10], [0.1, 8, 54, 66], [0.26, 20, 132, 140], [0.4, 150, 58, 222], [0.62, 240, 86, 188], [1, 255, 170, 214]]),
      front: [190, 255, 226], edge: [255, 243, 223], back: [5, 4, 10], dot: [38, 18, 62], thread: [48, 36, 92, 44, 40, 70] },
  };
  // Lo que elige quien la usa: la paleta y si va invertida (el coral crece en lo oscuro y lo
  // iluminado queda apagado). Se recuerda.
  const KEY = 'flip.reaccion', opt = { invert: false, palette: 'fosforo' };
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '{}'); opt.invert = !!saved.invert; if (PALETTES[saved.palette]) opt.palette = saved.palette; } catch (_) {}
  const BAYER2 = [0, 2, 3, 1];
  const glow = [0, 1].map(() => { const canvas = document.createElement('canvas'); return { canvas, ctx: canvas.getContext('2d') }; });

  function reset() {
    U.fill(1); V.fill(0); Lp.fill(0); S.started = false; S.level = null; S.pulse = 0;
  }

  // Lo que se oye, si ESCUCHAR está encendido (docs/escucha.js). Si no, silencio: la reacción va a su paso.
  const quiet = { bass: 0, mid: 0.5, high: 0 };
  function sound() {
    const ear = window.flipEscucha;
    if (!ear) return quiet;
    if (!S.wired && ear.onBeat) { S.wired = true; ear.onBeat(() => { if (ear.on) S.pulse = 1; }); }
    if (!ear.on) return quiet;
    const lv = ear.levels();
    return { bass: lv.bass || 0, mid: lv.mid || 0, high: lv.high || 0 };
  }

  // Un cuadro de química: lee la escena, fija el régimen de cada celda, siembra y deja reaccionar.
  function evolve(lum, sw, sh, now) {
    const fx = sw / GW, fy = sh / GH, invert = opt.invert;
    // 1 · La escena a la rejilla de la química (promedio de 2 × 2) y suavizada en el tiempo: el
    //     ruido del sensor con poca luz no debe sembrar nada.
    hist.fill(0);
    let motion = 0;
    for (let y = 0; y < GH; y++) {
      const y0 = Math.min(sh - 1, (y * fy) | 0), y1 = Math.min(sh - 1, y0 + 1);
      for (let x = 0; x < GW; x++) {
        const x0 = Math.min(sw - 1, (x * fx) | 0), x1 = Math.min(sw - 1, x0 + 1);
        const L = (lum[y0 * sw + x0] + lum[y0 * sw + x1] + lum[y1 * sw + x0] + lum[y1 * sw + x1]) * 0.25;
        const i = y * GW + x, was = S.started ? Ls[i] : L;
        const next = was + (L - was) * 0.5;
        const d = next - was;
        motion += d < 0 ? -d : d;
        Lp[i] = was; Ls[i] = next;
        hist[next | 0]++;
      }
    }
    motion = S.started ? motion / N / 255 : 0;
    S.motion += (motion - S.motion) * 0.4;
    let acc = 0, p10 = -1, p98 = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (p10 < 0 && acc >= N * 0.1) p10 = v;
      if (acc >= N * 0.98) { p98 = v; break; }
    }
    // El corte entre «oscuro» (extinción) y «claro» (fértil) va a dos quintos del recorrido de luz
    // de la escena, no en su mediana: una pared clara entera es fértil y un cuarto en penumbra entero
    // se apaga, sea cual sea la proporción de cada cosa (e, invertida, al revés).
    const wantLo = clamp(p10 + (p98 - p10) * 0.42, 30, 200), wantHi = Math.max(wantLo + 50, Math.min(250, p98)), wantGain = Math.min(2.2, 170 / Math.max(50, p98 - p10));
    let level = S.level;
    const dt = level ? now - level.at : -1;
    if (!level || dt < 0 || dt > 900) level = S.level = { lo: wantLo, hi: wantHi, gain: wantGain, at: now };
    else { const k = 1 - Math.exp(-dt / 300); level.lo += (wantLo - level.lo) * k; level.hi += (wantHi - level.hi) * k; level.gain += (wantGain - level.gain) * k; level.at = now; }
    const lo = level.lo, inv = 1 / (level.hi - lo), gain = level.gain;

    const ear = sound();
    S.pulse *= 0.55;
    // Con la escena en movimiento, el coral viejo se disuelve (sube la mortalidad en todas partes).
    const rush = clamp((S.motion - 0.012) * 22, 0, 1);
    const beat = S.pulse * 0.012, drift = (ear.mid - 0.5) * 0.006 + rush * 0.006;

    // 2 · El régimen de cada celda (F: cuánto se alimenta; k: cuánto muere) y la dirección de su borde.
    for (let y = 0; y < GH; y++) {
      const up = y > 0 ? -GW : 0, down = y < GH - 1 ? GW : 0;
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x, L = Ls[i];
        const gx = (Ls[i + (x < GW - 1 ? 1 : 0)] - Ls[i - (x > 0 ? 1 : 0)]) * 0.5, gy = (Ls[i + down] - Ls[i + up]) * 0.5;
        const mag = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
        // Invertida es el complemento exacto: lo que era extinción es fértil y al revés.
        const e = clamp((mag * gain - 5) / 34, 0, 1), f0 = clamp((L - lo) * inv, 0, 1), f = invert ? 1 - f0 : f0;
        const m = clamp((L - Lp[i] < 0 ? Lp[i] - L : L - Lp[i]) / 26, 0, 1);
        Ed[i] = e; Lf[i] = f;
        // Oscuro: se extingue. Media luz: motas sueltas que se dividen. Luz plena: laberinto denso.
        Fm[i] = 0.014 + 0.026 * f + 0.012 * e + beat;
        Km[i] = 0.0665 - 0.004 * e - 0.0065 * f + drift + 0.012 * m;
        // La difusión pesa más a lo largo del borde (tangente = gradiente girado 90°).
        const norm = gx * gx + gy * gy;
        Wx[i] = norm > 4 ? 0.2 + 0.11 * ((gy * gy - gx * gx) / norm) * e : 0.2;
        // 3 · Siembra: los contornos, siempre; más si algo acaba de moverse ahí.
        if (e > 0.3 && V[i] < 0.3) { V[i] = Math.min(0.42, V[i] + (0.05 + 0.2 * m + 0.1 * ear.high) * e); U[i] = Math.min(U[i], 0.62); }
      }
    }
    // …y núcleos sueltos en lo iluminado, para que una zona clara no espere a que el coral llegue
    // desde su orilla. Los agudos siembran más.
    const seeds = S.started ? 10 + ((ear.high * 26) | 0) + ((S.pulse * 30) | 0) : 220;
    for (let s = 0; s < seeds; s++) {
      const x = 2 + ((rnd() * (GW - 4)) | 0), y = 2 + ((rnd() * (GH - 4)) | 0), i = y * GW + x;
      if (Lf[i] < 0.5 || V[i] > 0.08) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = i + dy * GW + dx; V[j] = 0.5; U[j] = 0.25; }
    }

    Rx.set(V);                                                             // cómo estaba, para ver luego dónde creció
    // 4 · La reacción. El bajo la acelera; inclinar el teléfono la arrastra.
    const steps = 6 + Math.round(ear.bass * 4);
    const tilt = window.flipLight && flipLight.tilt ? flipLight.tilt() : null;
    const ax = tilt ? clamp(tilt.x, -1, 1) * 0.085 : 0, ay = tilt ? clamp(tilt.y, -1, 1) * 0.085 : 0;
    const moving = ax !== 0 || ay !== 0;
    for (let s = 0; s < steps; s++) {
      for (let y = 1; y < GH - 1; y++) {
        for (let i = y * GW + 1, end = y * GW + GW - 1; i < end; i++) {
          const u = U[i], v = V[i], wx = Wx[i], wy = 0.4 - wx;
          const ul = U[i - 1], ur = U[i + 1], uu = U[i - GW], ud = U[i + GW];
          const vl = V[i - 1], vr = V[i + 1], vu = V[i - GW], vd = V[i + GW];
          let lapU = wx * (ul + ur) + wy * (uu + ud) + 0.05 * (U[i - GW - 1] + U[i - GW + 1] + U[i + GW - 1] + U[i + GW + 1]) - u;
          let lapV = wx * (vl + vr) + wy * (vu + vd) + 0.05 * (V[i - GW - 1] + V[i - GW + 1] + V[i + GW - 1] + V[i + GW + 1]) - v;
          const uvv = u * v * v, F = Fm[i];
          let du = DU * lapU - uvv + F * (1 - u), dv = DV * lapV + uvv - (F + Km[i]) * v;
          if (moving) { du -= (ax * (ur - ul) + ay * (ud - uu)) * 0.5; dv -= (ax * (vr - vl) + ay * (vd - vu)) * 0.5; }
          const nu = u + du * DT, nv = v + dv * DT;
          U1[i] = nu < 0 ? 0 : nu > 1 ? 1 : nu;
          V1[i] = nv < 0 ? 0 : nv > 1 ? 1 : nv;
        }
      }
      // Los bordes de la rejilla copian a su vecino de dentro (nada entra ni sale).
      for (let x = 1; x < GW - 1; x++) { U1[x] = U1[x + GW]; V1[x] = V1[x + GW]; const b = (GH - 1) * GW + x; U1[b] = U1[b - GW]; V1[b] = V1[b - GW]; }
      for (let y = 0; y < GH; y++) { const a = y * GW, b = a + GW - 1; U1[a] = U1[a + 1]; V1[a] = V1[a + 1]; U1[b] = U1[b - 1]; V1[b] = V1[b - 1]; }
      let t = U; U = U1; U1 = t; t = V; V = V1; V1 = t;
    }
    // Dónde está creciendo ahora mismo (el frente de la reacción): se pinta en lima.
    let alive = 0;
    for (let i = 0; i < N; i++) { const v = V[i]; Rx[i] = v - Rx[i]; if (v > 0.14) alive++; }
    S.alive = alive / N; S.steps = steps; S.started = true;
  }

  function renderReaccion(lum, sw, sh, renderTarget, targetCtx, outW, outH, now) {
    const t0 = performance.now();
    // Dos llamadas seguidas (la vista y una foto) comparten cuadro de química: no se avanza dos veces.
    if (!S.started || now - S.at > 12 || now < S.at) {
      if (S.started && (now - S.at > 1500 || now < S.at)) reset();        // se volvió de otra cámara: el tubo arranca frío
      evolve(lum, sw, sh, now);
      S.at = now; S.frame++;
    }
    const out = renderTarget.buffer, level = S.level, lo = level.lo, inv = 1 / (level.hi - lo), gain = level.gain;
    const kx = GW / sw, ky = GH / sh, invert = opt.invert;
    const pal = PALETTES[opt.palette], LUT = pal.lut, front3 = pal.front, edge3 = pal.edge, back = pal.back, dot = pal.dot, th = pal.thread;
    for (let y = 0; y < sh; y++) {
      const row = y * sw, down = y < sh - 1 ? sw : 0, scan = (y & 1) ? 0.8 : 1;
      const cy = clamp((y + 0.5) * ky - 0.5, 0, GH - 1.001), y0 = cy | 0, ty = cy - y0, r0 = y0 * GW, r1 = r0 + GW;
      for (let x = 0; x < sw; x++) {
        const idx = row + x, L = lum[idx];
        const cx = clamp((x + 0.5) * kx - 0.5, 0, GW - 1.001), x0 = cx | 0, tx = cx - x0;
        const a = r0 + x0, b = r1 + x0;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const v = V[a] * w00 + V[a + 1] * w10 + V[b] * w01 + V[b + 1] * w11;
        const front = Rx[a] * w00 + Rx[a + 1] * w10 + Rx[b] * w01 + Rx[b + 1] * w11;
        // Lo digital: el fósforo solo sabe siete niveles; entre uno y otro, tramado de 2 × 2.
        const q = Math.min(7, (v * 17 + BAYER2[((y & 1) << 1) | (x & 1)] * 0.25) | 0);
        let r, g, bl;
        if (q > 0) {
          const at = ((q * 36.4) | 0) * 3;
          r = LUT[at]; g = LUT[at + 1]; bl = LUT[at + 2];
          if (front > 0.006) {                                              // frente vivo: lima incandescente
            const k = front >= 0.03 ? 1 : (front - 0.006) / 0.024;
            r += (front3[0] - r) * k; g += (front3[1] - g) * k; bl += (front3[2] - bl) * k;
          }
        } else {
          // Donde no hay coral queda la escena en un punteado tenue: se sabe qué se está mirando.
          const f0 = L > lo ? Math.min(1, (L - lo) * inv) : 0, f = invert ? 1 - f0 : f0;
          if (f * 0.7 > (BAYER2[((y & 1) << 1) | (x & 1)] + 0.5) / 4) { r = dot[0]; g = dot[1]; bl = dot[2]; } else { r = back[0]; g = back[1]; bl = back[2]; }
        }
        // El borde de la imagen real, nítido: marfil donde cruza el coral, un hilo frío donde no.
        const gx = lum[idx + (x < sw - 1 ? 1 : 0)] - L, gy = lum[idx + down] - L;
        const e = ((gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy)) * gain;
        if (e > 46) {
          const o = e >= 120 ? 1 : (e - 46) / 74;
          if (v > 0.12) { const k = o * o * 0.9; r += (edge3[0] - r) * k; g += (edge3[1] - g) * k; bl += (edge3[2] - bl) * k; }
          else if (o > 0.4) { r = th[0] + th[3] * o; g = th[1] + th[4] * o; bl = th[2] + th[5] * o; }
        }
        const o4 = idx << 2;
        out[o4] = r * scan; out[o4 + 1] = g * scan; out[o4 + 2] = bl * scan; out[o4 + 3] = 255;
      }
    }
    renderTarget.ctx.putImageData(new ImageData(out, sw, sh), 0, 0);
    // Halo corto: el fósforo encendido derrama un poco de luz, sin emborronar la rejilla.
    let from = renderTarget.canvas;
    for (let i = 0; i < 2; i++) {
      const layer = glow[i], w = Math.max(4, sw >> (i + 1)), h = Math.max(4, sh >> (i + 1));
      if (layer.canvas.width !== w || layer.canvas.height !== h) { layer.canvas.width = w; layer.canvas.height = h; }
      layer.ctx.globalCompositeOperation = 'copy';
      layer.ctx.imageSmoothingEnabled = true;
      layer.ctx.drawImage(from, 0, 0, w, h);
      from = layer.canvas;
    }
    const ctx = targetCtx;
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(renderTarget.canvas, 0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.2 + S.pulse * 0.25; ctx.drawImage(glow[0].canvas, 0, 0, outW, outH);
    ctx.globalAlpha = 0.26 + S.pulse * 0.3; ctx.drawImage(glow[1].canvas, 0, 0, outW, outH);
    ctx.restore();
    targetCtx.imageSmoothingEnabled = false;
    S.ms += (performance.now() - t0 - S.ms) * 0.1;
  }

  function set(next) {
    if (next && next.invert != null) opt.invert = !!next.invert;
    if (next && PALETTES[next.palette]) opt.palette = next.palette;
    try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch (_) {}
    paint();
    return { ...opt };
  }

  // ── Sus dos teclas, en la banda de la piel INTERFAZ (solo con REACCIÓN puesta) ──
  // Van en la banda y no en el cajón porque el cajón tapa la imagen: aquí se pulsa viendo el cambio.
  // INVERTIR enciende y apaga; la otra dice la paleta y cada toque pasa a la siguiente.
  // En la piel OBJETO son dos teclas del aparato, en su propia fila bajo las variantes.
  let row = null, objeto = null;
  const mine = () => typeof camFamily !== 'undefined' && camFamily === 'VFD' && typeof camVariant !== 'undefined' && camVariant === 'REAC';
  function paint() {
    if (!row) return;
    const on = mine();
    row.hidden = !on;
    document.body.classList.toggle('con-rapidas', on);
    const inv = row.querySelector('#reaccionInvertir'), pal = row.querySelector('#reaccionPaleta');
    inv.classList.toggle('is-on', opt.invert); inv.setAttribute('aria-pressed', String(opt.invert));
    pal.dataset.paleta = opt.palette;
    pal.lastChild.textContent = PALETTES[opt.palette].label;
    pal.setAttribute('aria-label', 'Paleta ' + PALETTES[opt.palette].label + '. Toca para cambiarla');
    if (objeto) {
      objeto.hidden = !on;
      const [oi, op] = objeto.querySelectorAll('button');
      oi.classList.toggle('is-on', opt.invert); oi.setAttribute('aria-pressed', String(opt.invert));
      op.dataset.paleta = opt.palette;
      op.lastChild.textContent = 'COLOR: ' + PALETTES[opt.palette].label;
      op.setAttribute('aria-label', 'Paleta ' + PALETTES[opt.palette].label + '. Toca para cambiarla');
    }
  }
  function mount() {
    const cabeza = document.querySelector('.si-banda-cabeza');
    if (!cabeza || !window.flipShell || row) return;
    row = flipShell.el('div', { class: 'si-rapidas', role: 'group', 'aria-label': 'Opciones de REACCIÓN' },
      '<button class="hw si-chip" type="button" id="reaccionInvertir" aria-pressed="false">INVERTIR</button>' +
      '<button class="hw si-chip" type="button" id="reaccionPaleta"><i aria-hidden="true"></i><span></span></button>');
    cabeza.insertBefore(row, cabeza.querySelector('.si-abrir'));
    const say = text => { if (window.flipShell && flipShell.hint) flipShell.hint(text, 1600); };
    const invertir = () => { set({ invert: !opt.invert }); say(opt.invert ? 'Invertida: el coral crece en lo oscuro' : 'El coral crece en lo iluminado'); };
    const paleta = () => { const ids = Object.keys(PALETTES); set({ palette: ids[(ids.indexOf(opt.palette) + 1) % ids.length] }); say('Paleta ' + PALETTES[opt.palette].label); };
    row.querySelector('#reaccionInvertir').addEventListener('click', invertir);
    row.querySelector('#reaccionPaleta').addEventListener('click', paleta);
    const tira = document.querySelector('#camDeck .deck-looks');
    if (tira) {
      objeto = flipShell.el('div', { class: 'deck-variants reaccion-teclas', role: 'group', 'aria-label': 'Opciones de REACCIÓN' },
        '<button class="hw hw-keycap" type="button" data-reaccion="invertir" aria-pressed="false">INVERTIR</button>' +
        '<button class="hw hw-keycap" type="button" data-reaccion="paleta"><i aria-hidden="true"></i><span></span></button>');
      tira.before(objeto);
      objeto.querySelector('[data-reaccion="invertir"]').addEventListener('click', invertir);
      objeto.querySelector('[data-reaccion="paleta"]').addEventListener('click', paleta);
    }
    for (const id of ['deckLooks', 'deckVariants']) { const node = document.getElementById(id); if (node) new MutationObserver(() => queueMicrotask(paint)).observe(node, { subtree: true, attributes: true, attributeFilter: ['class'] }); }
    paint();
  }
  if (document.readyState === 'complete') mount(); else addEventListener('load', mount);

  // Para las pruebas: cuánto coral hay en la parte clara de la escena y cuánto en la oscura (sin
  // contar los contornos, que siempre llevan).
  function probe() {
    const raw = i => Ls[i], mid = S.level ? S.level.lo : 128;
    let lit = 0, litN = 0, shade = 0, shadeN = 0;
    for (let i = 0; i < N; i++) {
      if (Ed[i] > 0.2) continue;
      const on = V[i] > 0.14 ? 1 : 0, L = raw(i);
      if (L > mid + 20) { lit += on; litN++; } else if (L < mid - 20) { shade += on; shadeN++; }
    }
    return { claro: +(lit / Math.max(1, litN)).toFixed(3), oscuro: +(shade / Math.max(1, shadeN)).toFixed(3), celdas: [litN, shadeN] };
  }

  window.renderReaccion = renderReaccion;
  window.flipReaccion = {
    reset, set, probe,
    options: () => ({ ...opt }),
    palettes: () => Object.fromEntries(Object.entries(PALETTES).map(([id, pal]) => [id, pal.label])),
    state: () => ({ invert: opt.invert, palette: opt.palette, frame: S.frame, steps: S.steps, alive: +S.alive.toFixed(3), motion: +S.motion.toFixed(4), pulse: +S.pulse.toFixed(2), ms: +S.ms.toFixed(2), grid: [GW, GH] }),
  };
})();
