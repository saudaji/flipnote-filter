// CLON a prueba de verdad: estilos de los que se conoce la receta.
//
// Una referencia sintética normal dice «esta imagen lleva tal trama», pero no dice cómo se vería OTRA
// escena con ese mismo look. Aquí sí: cada estilo es una función que convierte cualquier escena en
// su versión estilizada. Entonces se puede medir el clon contra la verdad:
//
//     referencia = estilo(escena A)          lo que se le enseña a CLON
//     clon(A)    frente a  estilo(A)         ¿reconstruye la referencia desde su escena?
//     clon(B)    frente a  estilo(B)         ¿y deja otra escena como la dejaría el estilo?
//
// Los estilos están hechos aparte de CLON (cuentas en JavaScript sobre los puntos, no su
// sombreador), para que la prueba no se dé la razón a sí misma. Se cargan en la página.
(function () {
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lin = v => Math.pow(v / 255, 2.2), enc = v => 255 * Math.pow(clamp(v, 0, 1), 1 / 2.2);
  function toLab(r, g, b) {
    const lr = lin(r), lg = lin(g), lb = lin(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb), m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb), s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function toLin(L, a, b) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  }
  // Desenfoque gaussiano (tres pasadas de caja) sobre un plano de n × n.
  function blur(plane, n, sigma) {
    if (sigma < 0.3) return plane;
    const r = Math.max(1, Math.round(Math.sqrt(sigma * sigma * 4 + 1) / 2 - 0.5)), tmp = new Float32Array(n * n);
    let src = plane;
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < n; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * n + clamp(x, 0, n - 1)]; for (let x = 0; x < n; x++) { tmp[y * n + x] = s / (2 * r + 1); s += src[y * n + clamp(x + r + 1, 0, n - 1)] - src[y * n + clamp(x - r, 0, n - 1)]; } }
      const out = new Float32Array(n * n);
      for (let x = 0; x < n; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, n - 1) * n + x]; for (let y = 0; y < n; y++) { out[y * n + x] = s / (2 * r + 1); s += tmp[clamp(y + r + 1, 0, n - 1) * n + x] - tmp[clamp(y - r, 0, n - 1) * n + x]; } }
      src = out;
    }
    return src;
  }
  let seed = 11;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };

  // ── Escenas (sin estilo): lienzos de n × n ──
  const canvas = n => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
  const scenes = {
    // un retrato: fondo en degradado, pelo oscuro, cara con luz de un lado, hombros, una lámpara
    retrato(n = 384) {
      const c = canvas(n), x = c.getContext('2d'), k = n / 384;
      const bg = x.createLinearGradient(0, 0, n, n); bg.addColorStop(0, '#8fa3b8'); bg.addColorStop(1, '#2a2f3a'); x.fillStyle = bg; x.fillRect(0, 0, n, n);
      x.fillStyle = '#1b1512'; x.beginPath(); x.ellipse(192 * k, 170 * k, 100 * k, 120 * k, 0, 0, 7); x.fill();
      const sk = x.createLinearGradient(110 * k, 0, 280 * k, 0); sk.addColorStop(0, '#f3c7a2'); sk.addColorStop(1, '#7a4f3a'); x.fillStyle = sk; x.beginPath(); x.ellipse(192 * k, 190 * k, 78 * k, 104 * k, 0, 0, 7); x.fill();
      x.fillStyle = '#30405f'; x.beginPath(); x.ellipse(192 * k, 400 * k, 170 * k, 110 * k, 0, Math.PI, 0); x.fill();
      x.fillStyle = '#fff'; x.beginPath(); x.arc(320 * k, 60 * k, 22 * k, 0, 7); x.fill();
      return c;
    },
    // un cuarto: pared fría, ventana clara, una lámpara cálida con su mancha de luz, una figura y el piso
    cuarto(n = 384) {
      const c = canvas(n), x = c.getContext('2d'), k = n / 384;
      const wall = x.createLinearGradient(0, 0, 0, n); wall.addColorStop(0, '#3b4a5c'); wall.addColorStop(1, '#1d222b'); x.fillStyle = wall; x.fillRect(0, 0, n, n);
      const win = x.createLinearGradient(0, 30 * k, 0, 170 * k); win.addColorStop(0, '#dfeaf5'); win.addColorStop(1, '#8fb2d6'); x.fillStyle = win; x.fillRect(36 * k, 36 * k, 110 * k, 140 * k);
      const lamp = x.createRadialGradient(300 * k, 120 * k, 4 * k, 300 * k, 120 * k, 120 * k); lamp.addColorStop(0, '#ffe2a8'); lamp.addColorStop(0.25, '#e9a45c'); lamp.addColorStop(1, 'rgba(120,60,30,0)'); x.fillStyle = lamp; x.fillRect(170 * k, 0, 214 * k, 250 * k);
      const floor = x.createLinearGradient(0, 270 * k, 0, n); floor.addColorStop(0, '#5a4636'); floor.addColorStop(1, '#2b1f18'); x.fillStyle = floor; x.fillRect(0, 270 * k, n, 114 * k);
      x.fillStyle = '#c98f6b'; x.beginPath(); x.ellipse(200 * k, 170 * k, 34 * k, 42 * k, 0, 0, 7); x.fill();
      x.fillStyle = '#7d2f3a'; x.beginPath(); x.moveTo(140 * k, 330 * k); x.quadraticCurveTo(200 * k, 180 * k, 262 * k, 330 * k); x.fill();
      x.fillStyle = '#2f8f86'; x.fillRect(40 * k, 250 * k, 70 * k, 60 * k);
      return c;
    },
  };

  // ── Estilos: receta(escena) → lienzo estilizado ──
  // Cada uno pinta, por punto, a partir de la luz (L de OKLab) y de lo cálido que es el punto frente
  // al resto de la escena; luego, según el estilo: desenfoque, resplandor (suma de luz emborronada) y grano.
  function styled(scene, recipe) {
    const n = scene.width, d = scene.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, n, n).data, N = n * n;
    const L = new Float32Array(N), W = new Float32Array(N);
    let ma = 0, mb = 0;
    const labs = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const p = toLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); labs.set(p, i * 3); ma += p[1]; mb += p[2]; }
    ma /= N; mb /= N;
    for (let i = 0; i < N; i++) { L[i] = labs[i * 3]; W[i] = clamp(0.5 + ((labs[i * 3 + 1] - ma) * 0.7071 + (labs[i * 3 + 2] - mb) * 0.7071) / 0.16, 0, 1); }
    let R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
    for (let i = 0; i < N; i++) { const p = recipe.color(L[i], W[i]), c = toLin(p[0], p[1], p[2]); R[i] = Math.max(0, c[0]); G[i] = Math.max(0, c[1]); B[i] = Math.max(0, c[2]); }
    if (recipe.soft) { const s = recipe.soft * n; R = blur(R, n, s); G = blur(G, n, s); B = blur(B, n, s); }
    if (recipe.glow) {
      const [amount, sigma, from] = recipe.glow, s = sigma * n, hr = new Float32Array(N), hg = new Float32Array(N), hb = new Float32Array(N);
      for (let i = 0; i < N; i++) { const y = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i], k = smooth(from, from * 2, y); hr[i] = R[i] * k; hg[i] = G[i] * k; hb[i] = B[i] * k; }
      const br = blur(hr, n, s), bg = blur(hg, n, s), bb = blur(hb, n, s);
      for (let i = 0; i < N; i++) { R[i] += amount * br[i]; G[i] += amount * bg[i]; B[i] += amount * bb[i]; }
    }
    const out = canvas(n), ox = out.getContext('2d'), im = ox.createImageData(n, n);
    let grain = null;
    if (recipe.grain) {                                            // grano en grumos de «cells» puntos, sobre la luz
      const [amount, cell] = recipe.grain, m = Math.ceil(n / cell) + 2, g = new Float32Array(m * m);
      seed = 23; for (let i = 0; i < g.length; i++) g[i] = rnd() - 0.5;
      grain = (x, y) => { const fx = x / cell, fy = y / cell, ix = fx | 0, iy = fy | 0; let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); return 1.5 * amount * mix(mix(g[iy * m + ix], g[iy * m + ix + 1], tx), mix(g[(iy + 1) * m + ix], g[(iy + 1) * m + ix + 1], tx), ty); };
    }
    for (let i = 0; i < N; i++) {
      let r = enc(R[i]), g = enc(G[i]), b = enc(B[i]);
      if (grain) { const p = toLab(r, g, b), q = toLin(clamp(p[0] + grain(i % n, (i / n) | 0), 0, 1), p[1], p[2]); r = enc(q[0]); g = enc(q[1]); b = enc(q[2]); }
      im.data[i * 4] = r; im.data[i * 4 + 1] = g; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = 255;
    }
    ox.putImageData(im, 0, 0);
    return out;
  }
  const stops = (list, t) => { let k = 0; while (k < list.length - 2 && t > list[k + 1][0]) k++; const A = list[k], B = list[k + 1], u = clamp((t - A[0]) / (B[0] - A[0]), 0, 1); return [mix(A[1], B[1], u), mix(A[2], B[2], u), mix(A[3], B[3], u)]; };
  const recipes = {
    // negro absoluto; lo claro se enciende: cian lo frío, rosa lo cálido; con resplandor
    neon: { color: (L, w) => { const v = smooth(0.42, 0.9, L), c = [mix(0.84, 0.72, w), mix(-0.13, 0.23, w), mix(-0.09, -0.04, w)]; return [v * c[0], v * c[1], v * c[2]]; }, glow: [0.7, 0.03, 0.12] },
    // mapa de calor: del violeta al rosa, naranja, amarillo y verde según la luz; suave
    termico: { color: L => stops([[0, 0.5, 0.04, -0.16], [0.4, 0.56, 0.06, -0.15], [0.55, 0.68, 0.17, -0.04], [0.7, 0.75, 0.12, 0.12], [0.85, 0.9, -0.01, 0.17], [1, 0.87, -0.15, 0.13]], L), soft: 0.012 },
    // del negro al cian y al blanco; desenfocado y con grano gordo
    cian: { color: L => stops([[0, 0, 0, 0], [0.25, 0.04, -0.005, -0.01], [0.7, 0.76, -0.1, -0.08], [1, 0.98, -0.02, -0.01]], L), soft: 0.016, grain: [0.09, 3] },
    // cianotipo: del azul al crema, con grano fino
    cianotipo: { color: L => stops([[0, 0.3, -0.01, -0.11], [0.5, 0.52, -0.03, -0.1], [1, 0.95, 0.0, 0.045]], L), grain: [0.035, 1.5] },
    // cartel a tres tintas planas
    cartel: { color: L => (L < 0.42 ? [0.2, 0.01, -0.03] : L < 0.68 ? [0.6, 0.19, 0.1] : [0.93, 0.0, 0.05]) },
    // foto con dominante: los colores de la escena siguen ahí, con menos color y corridos a verde; pie levantado
    dominante: { color: (L, w) => [0.12 + 0.8 * L, mix(-0.07, 0.02, w), mix(-0.01, 0.07, w)], grain: [0.03, 1.5] },
  };

  // ── Comparar dos lienzos: cuánto se apartan, en OKLab ──
  //   lejos: la imagen reducida a 32 × 32 (¿quedan los colores y los tonos donde estaban?)
  //   cerca: a 128 × 128 (¿y las formas, el resplandor, el borde?)
  //   reparto: los colores de una y otra, ordenados y emparejados (¿es la misma paleta en las mismas cantidades?)
  function small(c, m) { const o = canvas(m), x = o.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; let cur = c; while (cur.width > m * 2) { const h = canvas(cur.width >> 1); const hx = h.getContext('2d'); hx.imageSmoothingEnabled = true; hx.drawImage(cur, 0, 0, h.width, h.height); cur = h; } x.drawImage(cur, 0, 0, m, m); return x.getImageData(0, 0, m, m).data; }
  function apart(a, b) {
    const at = m => { const da = small(a, m), db = small(b, m); let s = 0; for (let i = 0; i < m * m; i++) { const p = toLab(da[i * 4], da[i * 4 + 1], da[i * 4 + 2]), q = toLab(db[i * 4], db[i * 4 + 1], db[i * 4 + 2]); s += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); } return s / (m * m); };
    const da = small(a, 64), db = small(b, 64), dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.58, 0.58, 0.58], [0.58, -0.58, 0.58], [0.58, 0.58, -0.58], [0.58, -0.58, -0.58]];
    let spread = 0;
    for (const dir of dirs) {
      const pa = new Float32Array(4096), pb = new Float32Array(4096);
      for (let i = 0; i < 4096; i++) { const p = toLab(da[i * 4], da[i * 4 + 1], da[i * 4 + 2]), q = toLab(db[i * 4], db[i * 4 + 1], db[i * 4 + 2]); pa[i] = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]; pb[i] = q[0] * dir[0] + q[1] * dir[1] + q[2] * dir[2]; }
      pa.sort(); pb.sort();
      let s = 0; for (let i = 0; i < 4096; i++) s += Math.abs(pa[i] - pb[i]);
      spread += s / 4096;
    }
    return { lejos: at(32), cerca: at(128), reparto: spread / dirs.length };
  }
  window.clonEstilos = { scenes, recipes, styled, apart, names: Object.keys(recipes) };
})();
