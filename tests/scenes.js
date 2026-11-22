// Escenas de prueba reproducibles para FLIP. Código de navegador sin dependencias:
// cada escena depende solo de (nombre, tiempo en segundos, opciones), nunca del reloj.
// Las usan las regresiones (dibujadas en un canvas que se pasa al motor) y la cámara
// simulada de tests/lib/scene-camera.js.
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const S2L = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const L2S = new Uint8Array(4097);
  for (let i = 0; i <= 4096; i++) {
    const x = i / 4096;
    L2S[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
  }
  function hash(n) {
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
    n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
    return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
  }
  // Ruido triangular de varianza 1 (suma de dos uniformes).
  function tri(n) { return (hash(n) + hash(n ^ 0x68bc21eb) - 1) * 2.4495; }

  const assets = { face: null };
  const cache = new Map();
  function layer(key, w, h, paint) {
    let entry = cache.get(key);
    if (!entry || entry.w !== w || entry.h !== h) {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      paint(ctx);
      entry = { w, h, canvas, ctx };
      cache.set(key, entry);
    }
    return entry;
  }

  // ── Objetos ────────────────────────────────────────────────────────
  function drawFace(ctx, cx, cy, hh) {
    const hw = hh * 0.74;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#2f3550';
    ctx.beginPath(); ctx.ellipse(0, hh * 1.04, hw * 1.25, hh * 0.52, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#b98564';
    ctx.fillRect(-hw * 0.2, hh * 0.36, hw * 0.4, hh * 0.3);
    ctx.fillStyle = '#2a1c14';
    ctx.beginPath(); ctx.ellipse(0, -hh * 0.06, hw * 0.56, hh * 0.56, 0, 0, TAU); ctx.fill();
    const skin = ctx.createLinearGradient(-hw * 0.5, 0, hw * 0.5, 0);
    skin.addColorStop(0, '#e2b190'); skin.addColorStop(0.55, '#cf9a78'); skin.addColorStop(1, '#9b6a50');
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse(0, 0, hw * 0.46, hh * 0.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a1c14';
    ctx.beginPath(); ctx.ellipse(0, -hh * 0.36, hw * 0.47, hh * 0.2, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = '#2a1c14'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, hh * 0.022);
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(s * hw * 0.3, -hh * 0.13);
      ctx.quadraticCurveTo(s * hw * 0.2, -hh * 0.17, s * hw * 0.09, -hh * 0.13); ctx.stroke();
      ctx.fillStyle = '#f4efe8';
      ctx.beginPath(); ctx.ellipse(s * hw * 0.2, -hh * 0.06, hw * 0.085, hh * 0.035, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3b2a1e';
      ctx.beginPath(); ctx.arc(s * hw * 0.2, -hh * 0.06, hh * 0.03, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath(); ctx.arc(s * hw * 0.2, -hh * 0.06, hh * 0.014, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(s * hw * 0.2 - hh * 0.008, -hh * 0.068, hh * 0.006, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(110,70,50,0.8)'; ctx.lineWidth = Math.max(1, hh * 0.014);
    ctx.beginPath(); ctx.moveTo(hw * 0.02, -hh * 0.04);
    ctx.quadraticCurveTo(hw * 0.09, hh * 0.1, 0, hh * 0.12); ctx.stroke();
    ctx.strokeStyle = '#8c4a42'; ctx.lineWidth = Math.max(1.2, hh * 0.022);
    ctx.beginPath(); ctx.moveTo(-hw * 0.14, hh * 0.24);
    ctx.quadraticCurveTo(0, hh * 0.3, hw * 0.14, hh * 0.24); ctx.stroke();
    ctx.restore();
  }
  function drawHand(ctx, cx, cy, s, rot, color) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot || 0);
    ctx.fillStyle = color || '#d9a583';
    ctx.strokeStyle = 'rgba(120,75,55,0.6)'; ctx.lineWidth = Math.max(1, s * 0.012);
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke(); };
    rr(-s * 0.13, s * 0.22, s * 0.26, s * 0.7, s * 0.08);
    for (const [fx, fl, fa] of [[-0.21, 0.30, -0.16], [-0.07, 0.38, -0.05], [0.07, 0.36, 0.05], [0.20, 0.28, 0.17]]) {
      ctx.save(); ctx.translate(fx * s, -s * 0.16); ctx.rotate(fa);
      rr(-s * 0.055, -fl * s, s * 0.11, fl * s + s * 0.06, s * 0.055);
      ctx.restore();
    }
    ctx.save(); ctx.translate(-s * 0.24, s * 0.08); ctx.rotate(-0.95);
    rr(-s * 0.06, -s * 0.26, s * 0.12, s * 0.3, s * 0.06);
    ctx.restore();
    rr(-s * 0.27, -s * 0.2, s * 0.54, s * 0.5, s * 0.12);
    ctx.restore();
  }
  function drawCup(ctx, cx, cy, s, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color || '#34495e'; ctx.lineWidth = s * 0.09; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(s * 0.36, 0, s * 0.2, s * 0.24, 0, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
    ctx.fillStyle = color || '#34495e';
    ctx.beginPath();
    ctx.moveTo(-s * 0.36, -s * 0.42); ctx.lineTo(s * 0.36, -s * 0.42);
    ctx.lineTo(s * 0.29, s * 0.42); ctx.quadraticCurveTo(0, s * 0.5, -s * 0.29, s * 0.42);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1d2935';
    ctx.beginPath(); ctx.ellipse(0, -s * 0.42, s * 0.36, s * 0.07, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawCable(ctx, w, h, color) {
    ctx.save();
    ctx.strokeStyle = color || '#1b1b1f'; ctx.lineWidth = Math.max(3, h * 0.022);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(w * 0.06, h * 0.74);
    ctx.bezierCurveTo(w * 0.3, h * 0.2, w * 0.42, h * 0.95, w * 0.6, h * 0.5);
    ctx.bezierCurveTo(w * 0.7, h * 0.24, w * 0.82, h * 0.3, w * 0.9, h * 0.44);
    ctx.stroke();
    ctx.fillStyle = color || '#1b1b1f';
    ctx.save(); ctx.translate(w * 0.9, h * 0.44); ctx.rotate(0.95);
    ctx.fillRect(-h * 0.03, -h * 0.03, h * 0.11, h * 0.06);
    ctx.fillStyle = '#b8b8b8';
    ctx.fillRect(h * 0.08, -h * 0.018, h * 0.05, h * 0.012);
    ctx.fillRect(h * 0.08, h * 0.006, h * 0.05, h * 0.012);
    ctx.restore();
    ctx.restore();
  }
  function tableBackdrop(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#d8d2c6'); g.addColorStop(1, '#c2bbad');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  // ── Habitación en penumbra: rostro, lámpara y mano en movimiento ───
  const ROOM = {
    lamp: [0.16, 0.40], lampK: 0.9, lampR0: 0.10, ambient: 0.006,
    face: [0.583, 0.415], faceH: 0.248,       // centro y alto de la cabeza (fracción de w, h, h)
    hand: [0.76, 0.66], handS: 0.30,
  };
  function roomStatic(ctx, w, h) {
    ctx.fillStyle = '#8d8478'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5b4a3c'; ctx.fillRect(0, h * 0.78, w, h * 0.22);
    ctx.fillStyle = '#6f6558'; ctx.fillRect(0, h * 0.765, w, h * 0.02);
    ctx.fillStyle = '#4a3a2c'; ctx.fillRect(w * 0.83, h * 0.1, w * 0.15, h * 0.67);
    ctx.strokeStyle = '#2e2218'; ctx.lineWidth = Math.max(1, w * 0.004);
    ctx.strokeRect(w * 0.85, h * 0.14, w * 0.11, h * 0.26);
    ctx.strokeRect(w * 0.85, h * 0.44, w * 0.11, h * 0.28);
    ctx.fillStyle = '#c9b037'; ctx.beginPath(); ctx.arc(w * 0.845, h * 0.45, w * 0.008, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3d3027'; ctx.fillRect(w * 0.03, h * 0.2, w * 0.3, h * 0.022);
    const books = ['#a8322d', '#2d5aa8', '#3c8a4f', '#d9b23c', '#ece6da', '#7a3f8f', '#c96a2a'];
    for (let i = 0; i < books.length; i++) {
      const bh = h * (0.09 + 0.03 * ((i * 7) % 3));
      ctx.fillStyle = books[i];
      ctx.fillRect(w * (0.045 + i * 0.036), h * 0.2 - bh, w * 0.03, bh);
    }
    ctx.fillStyle = '#2f2620'; ctx.fillRect(w * 0.385, h * 0.06, w * 0.13, h * 0.17);
    ctx.fillStyle = '#9fc4d8'; ctx.fillRect(w * 0.395, h * 0.075, w * 0.11, h * 0.075);
    ctx.fillStyle = '#5f8f4e'; ctx.fillRect(w * 0.395, h * 0.15, w * 0.11, h * 0.065);
    ctx.fillStyle = '#4b3b2e'; ctx.fillRect(0, h * 0.63, w * 0.34, h * 0.035);
    ctx.fillRect(w * 0.02, h * 0.66, w * 0.02, h * 0.34); ctx.fillRect(w * 0.3, h * 0.66, w * 0.02, h * 0.34);
    ctx.fillStyle = '#3a3a3e';
    ctx.fillRect(w * 0.153, h * 0.44, w * 0.014, h * 0.19);
    ctx.beginPath(); ctx.ellipse(w * 0.16, h * 0.63, w * 0.045, h * 0.012, 0, 0, TAU); ctx.fill();
    if (assets.face) {
      const side = h * 0.75;
      ctx.drawImage(assets.face, w * 0.33, h * 0.25, side, side);
    } else {
      drawFace(ctx, w * ROOM.face[0], h * ROOM.face[1], h * ROOM.faceH * 1.45);
    }
  }
  function roomEmissive(ctx, w, h) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d9c391';
    ctx.beginPath();
    ctx.moveTo(w * 0.125, h * 0.27); ctx.lineTo(w * 0.195, h * 0.27);
    ctx.lineTo(w * 0.225, h * 0.39); ctx.lineTo(w * 0.095, h * 0.39);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(w * ROOM.lamp[0], h * ROOM.lamp[1], w * 0.02, 0, TAU); ctx.fill();
  }
  function roomIllum(w, h) {
    const key = 'illum:' + w + 'x' + h;
    let map = cache.get(key);
    if (!map) {
      map = new Float32Array(w * h);
      const lx = w * ROOM.lamp[0], ly = h * ROOM.lamp[1], r0 = w * ROOM.lampR0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = (x - lx) / r0, dy = (y - ly) / r0;
        map[y * w + x] = ROOM.ambient + ROOM.lampK / (1 + dx * dx + dy * dy);
      }
      cache.set(key, map);
    }
    return map;
  }
  function handPose(w, h, t) {
    const swing = Math.sin(TAU * t / 1.6);
    return [w * (ROOM.hand[0] + 0.08 * swing), h * (ROOM.hand[1] + 0.03 * Math.sin(TAU * t / 0.8)), h * ROOM.handS, 0.28 * swing];
  }
  function room(ctx, w, h, t, o) {
    const lit = !!o.lit;
    const base = layer('room:' + (assets.face ? 'img' : 'proc'), w, h, c => roomStatic(c, w, h));
    const scratch = layer('roomScratch', w, h, () => {});
    // Promedio de cuatro submuestras: desenfoque de movimiento de una exposición de 1/30 s.
    for (let k = 0; k < 4; k++) {
      scratch.ctx.globalAlpha = 1;
      scratch.ctx.drawImage(base.canvas, 0, 0);
      if (o.hand !== false) drawHand(scratch.ctx, ...handPose(w, h, t - k / 120));
      ctx.globalAlpha = 1 / (k + 1);
      ctx.drawImage(scratch.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    const emissive = layer('roomEm', w, h, c => roomEmissive(c, w, h));
    if (lit) {
      ctx.globalCompositeOperation = 'lighten';
      ctx.drawImage(emissive.canvas, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      if (o.noise !== false) sensorNoise(ctx, w, h, Math.floor(t * 30), 0.0008, 0.00012);
      return;
    }
    const exposure = o.exposure || 1;
    const read = o.read === undefined ? 0.0015 : o.read, shot = o.shot === undefined ? 0.0006 : o.shot;
    const illum = roomIllum(w, h);
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const em = o.lamp === false ? null : emissive.ctx.getImageData(0, 0, w, h).data;
    const seed = Math.imul(Math.floor(t * 30) + 1, 0x9E3779B1) | 0;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const L = o.lamp === false ? ROOM.ambient * 4 : illum[p];
      const shared = tri(p ^ seed);
      for (let c = 0; c < 3; c++) {
        let x = S2L[d[i + c]] * L;
        if (em) x += S2L[em[i + c]] * 6;
        x *= exposure;
        x += Math.sqrt(read * read + shot * x) * (0.75 * shared + 0.66 * tri((p * 4 + c + 1) ^ (seed + 77)));
        d[i + c] = L2S[x <= 0 ? 0 : x >= 1 ? 4096 : (x * 4096) | 0];
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function sensorNoise(ctx, w, h, frame, read, shot) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const seed = Math.imul(frame + 1, 0x9E3779B1) | 0;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const shared = tri(p ^ seed);
      for (let c = 0; c < 3; c++) {
        let x = S2L[d[i + c]];
        x += Math.sqrt(read * read + shot * x) * (0.75 * shared + 0.66 * tri((p * 4 + c + 1) ^ (seed + 77)));
        d[i + c] = L2S[x <= 0 ? 0 : x >= 1 ? 4096 : (x * 4096) | 0];
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── Escenas ────────────────────────────────────────────────────────
  const scenes = {
    room,
    roomLit(ctx, w, h, t, o) { room(ctx, w, h, t, { ...o, lit: true }); },
    // Formas para VECTOR.
    circle(ctx, w, h) {
      ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#3c3c3c'; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.5, h * 0.3, 0, TAU); ctx.fill();
    },
    diagonal(ctx, w, h, t, o) {
      const lo = o.lo === undefined ? 118 : o.lo, hi = o.hi === undefined ? 136 : o.hi;
      ctx.fillStyle = 'rgb(' + [lo, lo, lo] + ')'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgb(' + [hi, hi, hi] + ')';
      ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.9); ctx.lineTo(w * 0.9, h * 0.1); ctx.lineTo(w, h * 0.1);
      ctx.lineTo(w, h); ctx.lineTo(w * 0.1, h); ctx.closePath(); ctx.fill();
    },
    two(ctx, w, h) {
      ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#3c3c3c';
      ctx.beginPath(); ctx.arc(w * 0.25, h * 0.5, h * 0.2, 0, TAU); ctx.fill();
      ctx.fillRect(w * 0.62, h * 0.3, w * 0.24, h * 0.4);
    },
    cup(ctx, w, h) { tableBackdrop(ctx, w, h); drawCup(ctx, w * 0.48, h * 0.52, h * 0.46); },
    cupNoise(ctx, w, h, t, o) {
      scenes.cup(ctx, w, h);
      sensorNoise(ctx, w, h, Math.floor(t * 30), o.read === undefined ? 0.004 : o.read, o.shot === undefined ? 0.0012 : o.shot);
    },
    hand(ctx, w, h) { tableBackdrop(ctx, w, h); drawHand(ctx, w * 0.5, h * 0.5, h * 0.6, 0.1); },
    cable(ctx, w, h) { tableBackdrop(ctx, w, h); drawCable(ctx, w, h); },
    // Entra por la izquierda en t=0.5 s, cruza y sale; a partir de 2.5 s el cuadro queda vacío.
    enterExit(ctx, w, h, t) {
      tableBackdrop(ctx, w, h);
      const r = h * 0.2;
      const x = -r + (w + 2 * r) * Math.max(0, Math.min(1, (t - 0.5) / 2));
      if (t >= 0.5 && t < 2.5) { ctx.fillStyle = '#34495e'; ctx.beginPath(); ctx.arc(x, h * 0.5, r, 0, TAU); ctx.fill(); }
    },
    handWave(ctx, w, h, t) {
      tableBackdrop(ctx, w, h);
      drawHand(ctx, w * (0.5 + 0.22 * Math.sin(TAU * t / 1.2)), h * 0.5, h * 0.55, 0.3 * Math.sin(TAU * t / 1.2));
    },
    // Material: texto, retrato, degradado y transiciones.
    text(ctx, w, h) {
      ctx.fillStyle = '#f6f4ee'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#111'; ctx.textBaseline = 'top';
      ctx.font = 'bold ' + Math.round(h * 0.085) + 'px Georgia, serif';
      ctx.fillText('FLIP · página de prueba', w * 0.06, h * 0.06);
      const lines = [
        'El haz recorre la forma y el fósforo', 'se apaga despacio. La tinta queda en',
        'el surco y el papel conserva su blanco.', 'Una pantalla reflectiva necesita luz;',
        'una emisiva la produce. 0123456789', 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ',
      ];
      ctx.font = Math.round(h * 0.058) + 'px Georgia, serif';
      lines.forEach((line, i) => ctx.fillText(line, w * 0.06, h * (0.2 + i * 0.085)));
      ctx.font = Math.round(h * 0.034) + 'px Georgia, serif';
      for (let i = 0; i < 5; i++) ctx.fillText('texto pequeño para medir legibilidad a tamaño de teléfono · línea ' + (i + 1), w * 0.06, h * (0.73 + i * 0.048));
    },
    portrait(ctx, w, h) {
      ctx.fillStyle = '#b9b3a6'; ctx.fillRect(0, 0, w, h);
      if (assets.face) {
        const side = Math.min(w, h);
        ctx.drawImage(assets.face, (w - side) / 2, 0, side, side);
      } else {
        drawFace(ctx, w * 0.5, h * 0.42, h * 0.62);
      }
    },
    ramp(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h / 3);
      for (let i = 0; i < 8; i++) { const v = Math.round(i * 255 / 7); ctx.fillStyle = 'rgb(' + [v, v, v] + ')'; ctx.fillRect(Math.round(i * w / 8), h / 3, Math.ceil(w / 8), h / 3); }
      for (let i = 0; i < 16; i++) { const v = Math.round(i * 255 / 15); ctx.fillStyle = 'rgb(' + [v, v, v] + ')'; ctx.fillRect(Math.round(i * w / 16), 2 * h / 3, Math.ceil(w / 16), h / 3); }
    },
    flat(ctx, w, h, t, o) { const v = o.value === undefined ? 255 : o.value; ctx.fillStyle = 'rgb(' + [v, v, v] + ')'; ctx.fillRect(0, 0, w, h); },
    // Negro hasta 1 s, blanco después.
    transition(ctx, w, h, t) { ctx.fillStyle = t < 1 ? '#000' : '#fff'; ctx.fillRect(0, 0, w, h); },
    // Un objeto negro sobre papel desaparece en t=1 s.
    objectLeave(ctx, w, h, t) {
      ctx.fillStyle = '#f2f0ea'; ctx.fillRect(0, 0, w, h);
      if (t < 1) { ctx.fillStyle = '#101010'; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.5, h * 0.24, 0, TAU); ctx.fill(); }
    },
    // Contraluz: ventana clara, persona oscura con mechones finos.
    backlight(ctx, w, h, t) {
      ctx.fillStyle = '#3a3630'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f7f4ea'; ctx.fillRect(w * 0.18, h * 0.06, w * 0.64, h * 0.7);
      ctx.fillStyle = '#3a3630'; ctx.fillRect(w * 0.495, h * 0.06, w * 0.01, h * 0.7);
      const cx = w * (0.5 + 0.04 * Math.sin(TAU * (t || 0) / 2)), cy = h * 0.48, hh = h * 0.42;
      ctx.fillStyle = '#17120f';
      ctx.beginPath(); ctx.ellipse(cx, cy + hh * 1.05, hh * 0.95, hh * 0.55, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, cy, hh * 0.36, hh * 0.46, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#17120f'; ctx.lineWidth = Math.max(1, h * 0.004);
      for (let i = 0; i < 28; i++) {
        const a = -Math.PI * (0.08 + 0.84 * i / 27), len = hh * (0.5 + 0.12 * hash(i + 3));
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * hh * 0.33, cy + Math.sin(a) * hh * 0.42);
        ctx.quadraticCurveTo(cx + Math.cos(a) * len * 1.1, cy + Math.sin(a) * len, cx + Math.cos(a + 0.25) * len * 1.25, cy + Math.sin(a + 0.25) * len * 1.05);
        ctx.stroke();
      }
      drawHand(ctx, cx + hh * 0.95, cy + hh * 0.35, hh * 0.5, 0.2, '#17120f');
    },
  };

  root.FlipScenes = {
    names: Object.keys(scenes),
    assets,
    ROOM,
    draw(ctx, w, h, name, t, options) {
      if (!scenes[name]) throw new Error('Escena desconocida: ' + name);
      ctx.save();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      scenes[name](ctx, w, h, t || 0, options || {});
      ctx.restore();
    },
    clearCache() { cache.clear(); },
    hash, tri,
  };
})(typeof window !== 'undefined' ? window : globalThis);
