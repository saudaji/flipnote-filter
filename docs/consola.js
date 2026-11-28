// FLIP · CONSOLA: la imagen como la pintaba una consola de otra generación.
// No es un filtro de color: la escena se vuelve polígonos. Una malla cubre el cuadro y sus vértices
// se pegan a los bordes de lo que hay delante (la ropa, el pelo y el fondo quedan en planos); la
// cara lleva su propia malla, que sigue los gestos (rastreo de rostro, en su hilo); y cada polígono
// lleva pegada la imagen real muy reducida y sin suavizar, como una textura de baja resolución.
// Encima, lo que hacía la máquina: resolución baja estirada, pocos colores con tramado, y por
// variante las estelas, el resplandor y el atardecer (128 BITS) o el píxel duro que tiembla (32 BITS).
//   renderConsola(source, srcW, srcH, ctx, mirror, variant) → true si pintó (false: sin gráfica)
// Todo pasa en el teléfono. El rastreo de rostro se carga del mismo sitio que el de manos.
(() => {
  'use strict';
  const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/+esm';
  const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  // Por variante: lado largo interno, cuánta textura pegada (0 = color liso por polígono), rejilla a la
  // que saltan los vértices (0 = no), bits por canal, tramado, estelas, resplandor, atardecer y estirado.
  const VARIANTS = {
    B128: { long: 480, tex: .8, faceTex: .3, snap: 0, bits: 5, dither: .45, trail: 0, bloom: .2, grade: 1, smooth: true, cells: 16, shade: .5 },
    B32: { long: 240, tex: .9, faceTex: .45, snap: 96, bits: 4, dither: 1, trail: 0, bloom: 0, grade: .25, smooth: false, cells: 12, shade: .7 },
    // NOCHE: el cuarto a oscuras alumbrado por la pantalla. Gradación nocturna (grade < 0: casi todo
    // el cuadro en negro índigo —un interior normal queda con la mediana de luz por debajo de 0,15—,
    // solo lo que emite luz se queda encendido), un resplandor muy ancho que tiñe lo de alrededor,
    // tramado a la vista en la penumbra y alguna estrella en lo negro y liso.
    NOCHE: { long: 300, tex: .88, faceTex: .38, snap: 112, bits: 5, dither: .78, trail: .18, bloom: .95, grade: -1, smooth: false, cells: 14, shade: .62, wide: true, stars: true },
  };

  // ── Gráfica ────────────────────────────────────────────────────────────────
  const VERT = `attribute vec2 aPos; attribute vec2 aUv; attribute vec2 aCuv; uniform float uSnap; varying vec2 vUv; varying vec2 vCuv;
    void main() { vec2 p = aPos; if (uSnap > 0.) p = floor(p * uSnap + .5) / uSnap; vUv = aUv; vCuv = aCuv; gl_Position = vec4(p * 2. - 1., 0., 1.); gl_Position.y = -gl_Position.y; }`;
  const FRAG = `precision mediump float; uniform sampler2D uSrc; uniform float uTex, uBits, uDither, uGrade, uFace, uShade, uStars, uTime; varying vec2 vUv; varying vec2 vCuv;
    float bayer(vec2 p) { vec2 a = floor(mod(p, 4.)); float b = mod(a.x + a.y * 2., 4.) * 4. + mod(a.x * 3. + a.y, 4.); return (b + .5) / 16. - .5; }
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() {
      vec3 plano = texture2D(uSrc, vCuv).rgb, tex = texture2D(uSrc, vUv).rgb;
      vec3 c = mix(plano, tex, uTex);
      float l = dot(plano, vec3(.3, .59, .11));
      c *= mix(1., mix(.84, 1.05, floor(l * 3. + .5) / 3.), uShade);                       // sombreado por polígono, en tres tonos
      c = mix(c, c * vec3(1.03, .98, .96) + .02, uFace);                   // la cara, un punto más clara y cálida
      // el atardecer: negros levantados hacia el malva, luces hacia el naranja, más color
      float g = dot(c, vec3(.3, .59, .11));
      if (uGrade >= 0.) {
        vec3 graded = mix(vec3(g), c, 1.28);
        graded = graded * vec3(1.06, .95, .84) + (1. - g) * (1. - g) * vec3(.07, .02, .11) + g * g * vec3(.05, .0, -.05);
        c = mix(c, graded, uGrade);
      } else {
        // la noche: la luz a la 2,35 (un medio tono queda en ~0,1), teñida de violeta con
        // una pizca del color propio para que se lea; lo que emite luz, intacto
        float emit = smoothstep(.72, .93, g);
        float dark = pow(g, 2.35) * .75;
        vec3 night = vec3(.40, .26, .66) * dark + c * dark * .28 + vec3(.010, .007, .022);
        night = mix(night, c * vec3(1.06, 1.02, 1.12) + .03, emit);
        c = mix(c, night, -uGrade);
        // estrellas: puntos sueltos en lo casi negro y liso (donde el polígono y su textura casi no difieren: un cielo, una ventana de noche), que titilan despacio
        float flat_ = 1. - smoothstep(.02, .06, abs(dot(tex - plano, vec3(.3, .59, .11))));
        float star = step(.998, hash(floor(gl_FragCoord.xy))) * (1. - smoothstep(.05, .09, g)) * flat_;
        c += star * uStars * vec3(.62, .66, .9) * (.55 + .45 * sin(uTime * 1.7 + hash(floor(gl_FragCoord.xy) + 7.) * 6.283));
      }
      float q = pow(2., uBits) - 1.;
      c = floor(clamp(c, 0., 1.) * q + .5 + bayer(gl_FragCoord.xy) * uDither) / q;
      gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
    }`;
  let canvas = null, gl = null, res = null, failed = false, lost = 0;
  function ensureGl() {
    if (gl) return true;
    if (failed) return false;
    try {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' };
      gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('CONSOLA: sin WebGL');
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost++; gl = null; canvas = null; res = null; });
      const shader = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('CONSOLA: ' + gl.getShaderInfoLog(s)); return s; };
      const prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('CONSOLA: ' + gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const at = name => gl.getAttribLocation(prog, name), un = name => gl.getUniformLocation(prog, name);
      for (const [name, offset] of [['aPos', 0], ['aUv', 8], ['aCuv', 16]]) { gl.enableVertexAttribArray(at(name)); gl.vertexAttribPointer(at(name), 2, gl.FLOAT, false, 24, offset); }
      res = { prog, tex, buf, u: { snap: un('uSnap'), tex: un('uTex'), bits: un('uBits'), dither: un('uDither'), grade: un('uGrade'), face: un('uFace'), shade: un('uShade'), stars: un('uStars'), time: un('uTime') } };
      gl.uniform1i(un('uSrc'), 0);
      return true;
    } catch (error) { failed = true; gl = null; canvas = null; res = null; console.warn(String(error && error.message || error)); return false; }
  }
  function release() {
    if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
    gl = null; canvas = null; res = null;
    for (const c of [low.canvas, acc.canvas, glowA.canvas, glowB.canvas, glowC.canvas]) if (c) c.width = c.height = 0;
    Object.assign(mesh, { key: '', base: null });
    faceStop();
  }

  // ── La imagen reducida: de ella salen la textura y los bordes ───────────────
  const low = { canvas: null, ctx: null, w: 0, h: 0, lum: null };
  const acc = { canvas: null, ctx: null }, glowA = { canvas: null, ctx: null }, glowB = { canvas: null, ctx: null }, glowC = { canvas: null, ctx: null };
  const surface = (slot, w, h, read) => {
    if (!slot.canvas) { slot.canvas = document.createElement('canvas'); slot.ctx = slot.canvas.getContext('2d', read ? { willReadFrequently: true } : undefined); }
    if (slot.canvas.width !== w || slot.canvas.height !== h) { slot.canvas.width = w; slot.canvas.height = h; return true; }
    return false;
  };

  // ── La malla del cuadro: una rejilla que se pega a los bordes ───────────────
  const mesh = { key: '', cols: 0, rows: 0, base: null, off: null, tris: null, data: null };
  function buildMesh(cols, rows) {
    const key = cols + 'x' + rows;
    if (mesh.key === key) return;
    const n = (cols + 1) * (rows + 1), base = new Float32Array(n * 2);
    let seed = 27;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 8) / 16777216; };
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
      const i = (y * (cols + 1) + x) * 2, edgeX = x === 0 || x === cols, edgeY = y === 0 || y === rows;
      base[i] = (x + (edgeX ? 0 : (rnd() - .5) * .5)) / cols;
      base[i + 1] = (y + (edgeY ? 0 : (rnd() - .5) * .5)) / rows;
    }
    const tris = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const a = y * (cols + 1) + x, b = a + 1, c = a + cols + 1, d = c + 1;
      if ((x + y) & 1) tris.push(a, b, c, b, d, c); else tris.push(a, b, d, a, d, c);                // la diagonal alterna
    }
    Object.assign(mesh, { key, cols, rows, base, off: new Float32Array(n * 2), hold: new Int16Array(n * 2), tris: Uint16Array.from(tris), pos: new Float32Array(n * 2) });
  }
  // Cada vértice busca en su vecindad el punto con más contraste y se va hacia él. Con memoria: se
  // queda con el borde que ya tenía mientras siga ahí, y solo lo suelta si aparece otro claramente
  // mejor. (Sin eso saltaba de borde en borde con el ruido de la cámara y la malla hervía.)
  function hugEdges(strength) {
    const { cols, rows, base, off, pos, hold } = mesh, w = low.w, h = low.h, lum = low.lum;
    const rx = Math.max(1, Math.round(w / cols * .42)), ry = Math.max(1, Math.round(h / rows * .42));
    const grad = (px, py) => { const k = py * w + px; return Math.abs(lum[k + 1] - lum[k - 1]) + Math.abs(lum[k + w] - lum[k - w]); };
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
      const i = (y * (cols + 1) + x) * 2;
      let tx = 0, ty = 0;
      if (x > 0 && x < cols && y > 0 && y < rows) {
        const cx = Math.round(base[i] * (w - 1)), cy = Math.round(base[i + 1] * (h - 1));
        const hx = clamp(cx + hold[i], 1, w - 2), hy = clamp(cy + hold[i + 1], 1, h - 2);
        const mine = hold[i] || hold[i + 1] ? grad(hx, hy) : 0;
        let best = Math.max(18, mine * 1.45 + 8), bx = -1, by = -1;
        for (let dy = -ry; dy <= ry; dy++) {
          const py = cy + dy;
          if (py < 1 || py >= h - 1) continue;
          for (let dx = -rx; dx <= rx; dx++) {
            const px = cx + dx;
            if (px < 1 || px >= w - 1) continue;
            const g = grad(px, py) - (Math.abs(dx) + Math.abs(dy)) * 1.5;
            if (g > best) { best = g; bx = px; by = py; }
          }
        }
        if (bx >= 0) { hold[i] = bx - cx; hold[i + 1] = by - cy; }                // un borde claramente mejor: se muda
        else if (mine < 12) { hold[i] = 0; hold[i + 1] = 0; }                      // su borde desapareció: vuelve a su sitio
        tx = hold[i] / (w - 1) * strength; ty = hold[i + 1] / (h - 1) * strength;
      }
      off[i] += (tx - off[i]) * .16; off[i + 1] += (ty - off[i + 1]) * .16;
      pos[i] = base[i] + off[i]; pos[i + 1] = base[i + 1] + off[i + 1];
    }
  }

  // ── La cara: su malla, que sigue los gestos ────────────────────────────────
  // El rastreador da 478 puntos. Para que las facetas se vean (pocos polígonos), se quedan unos 110
  // bien repartidos —siempre el óvalo— y se triangulan UNA vez: desde entonces la malla es fija y solo
  // se mueven sus puntos, como un modelo.
  const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  const FACE_POINTS = 110;
  const face = { worker: null, state: 'off', busy: false, sentAt: 0, points: null, seenAt: -1e9, picks: null, tris: null, smooth: null, mid: null, mctx: null, ms: 0, error: '', usedAt: 0, timer: 0, injected: false };
  function delaunay(pts) {                                  // Bowyer–Watson; pts: [[x, y]…] → índices de triángulos
    const n = pts.length, p = pts.concat([[-10, -10], [10, -10], [0, 10]]);
    let tris = [[n, n + 1, n + 2]];
    const circum = t => {
      const [ax, ay] = p[t[0]], [bx, by] = p[t[1]], [cx, cy] = p[t[2]];
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-12;
      const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
      const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
      return [ux, uy, (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy)];
    };
    let circles = tris.map(circum);
    for (let i = 0; i < n; i++) {
      const [x, y] = p[i], edges = new Map(), keep = [], keepC = [];
      for (let k = 0; k < tris.length; k++) {
        const c = circles[k];
        if ((x - c[0]) * (x - c[0]) + (y - c[1]) * (y - c[1]) < c[2]) {
          const t = tris[k];
          for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const key = a < b ? a + '_' + b : b + '_' + a; edges.set(key, edges.has(key) ? null : [a, b]); }
        } else { keep.push(tris[k]); keepC.push(c); }
      }
      for (const edge of edges.values()) if (edge) { const t = [edge[0], edge[1], i]; keep.push(t); keepC.push(circum(t)); }
      tris = keep; circles = keepC;
    }
    return tris.filter(t => t[0] < n && t[1] < n && t[2] < n);
  }
  function faceTopology(points) {
    const picks = OVAL.slice(), taken = new Set(picks), total = Math.min(468, points.length / 2);
    const dist = new Float32Array(total).fill(Infinity);
    const relax = k => { for (let i = 0; i < total; i++) { const d = (points[2 * i] - points[2 * k]) ** 2 + (points[2 * i + 1] - points[2 * k + 1]) ** 2; if (d < dist[i]) dist[i] = d; } };
    for (const k of picks) relax(k);
    while (picks.length < FACE_POINTS) {                    // el punto más lejano de los ya elegidos
      let best = -1, far = -1;
      for (let i = 0; i < total; i++) if (!taken.has(i) && dist[i] > far) { far = dist[i]; best = i; }
      if (best < 0) break;
      picks.push(best); taken.add(best); relax(best);
    }
    const tris = delaunay(picks.map(k => [points[2 * k], points[2 * k + 1]]));
    face.picks = Uint16Array.from(picks);
    face.tris = Uint16Array.from(tris.flat());
    face.smooth = Float32Array.from(picks.flatMap(k => [points[2 * k], points[2 * k + 1]]));
  }
  function faceTake(points, now) {
    face.seenAt = now;
    if (!face.tris) {
      // La malla se arma con la cara de frente: si llega muy ladeada, las facetas saldrían estiradas.
      const w = Math.abs(points[2 * 454] - points[2 * 234]), nose = (points[2 * 1] - points[2 * 234]) / (w || 1);
      if (nose > .3 && nose < .7) faceTopology(points); else return;
    }
    const s = face.smooth, picks = face.picks;
    for (let i = 0; i < picks.length; i++) { const k = picks[i] * 2; s[2 * i] += (points[k] - s[2 * i]) * .5; s[2 * i + 1] += (points[k + 1] - s[2 * i + 1]) * .5; }
  }
  function faceStart() {
    if (face.state !== 'off' || face.injected) return;
    face.state = 'loading';
    let worker;
    try { worker = new Worker('./face-worker.js'); } catch (error) { face.state = 'failed'; face.error = String(error); return; }
    face.worker = worker;
    const boot = setTimeout(() => { if (face.state === 'loading') { face.state = 'failed'; face.error = 'tiempo de carga agotado'; try { worker.terminate(); } catch (_) {} } }, 45000);
    worker.onmessage = event => {
      const msg = event.data || {};
      if (face.worker !== worker) return;
      if (msg.type === 'ready') { clearTimeout(boot); face.state = 'ready'; }
      else if (msg.type === 'face') { face.busy = false; face.ms = msg.ms; if (msg.points) faceTake(msg.points, performance.now()); }
      else if (msg.type === 'error') { face.busy = false; if (face.state === 'loading') { clearTimeout(boot); face.state = 'failed'; face.error = msg.message; } }
    };
    worker.onerror = event => { face.busy = false; if (face.state === 'loading') { clearTimeout(boot); face.state = 'failed'; face.error = event.message || 'error del worker'; } };
    worker.postMessage({ type: 'init', lib: LIB, wasm: WASM, model: MODEL });
    // Sin uso un rato (se cambió de cámara), el rastreador se apaga solo.
    face.timer = setInterval(() => { if (performance.now() - face.usedAt > 4000) faceStop(); }, 2000);
  }
  function faceStop() {
    clearInterval(face.timer);
    if (face.worker) { try { face.worker.postMessage({ type: 'close' }); } catch (_) {} const w = face.worker; setTimeout(() => { try { w.terminate(); } catch (_) {} }, 300); }
    Object.assign(face, { worker: null, state: 'off', busy: false, tris: face.injected ? face.tris : null, picks: face.injected ? face.picks : null });
  }
  function faceSend(source, sx, sy, sw, sh, mirror, now) {
    if (face.state !== 'ready' || face.busy || now - face.sentAt < 45) return;
    const scale = 320 / Math.max(sw, sh), w = Math.max(16, Math.round(sw * scale)), h = Math.max(16, Math.round(sh * scale));
    if (!face.mid) { face.mid = new OffscreenCanvas(w, h); face.mctx = face.mid.getContext('2d'); }
    if (face.mid.width !== w || face.mid.height !== h) { face.mid.width = w; face.mid.height = h; }
    const c = face.mctx;
    c.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? w : 0, 0);
    c.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
    face.busy = true; face.sentAt = now;
    createImageBitmap(face.mid).then(bitmap => { if (face.worker && face.state === 'ready') face.worker.postMessage({ type: 'frame', id: now, bitmap }, [bitmap]); else { bitmap.close(); face.busy = false; } }, () => { face.busy = false; });
  }

  // ── El marco de juego ──────────────────────────────────────────────────────
  // Lo que cualquier juego de mundo abierto de esos años ponía encima de la imagen —un mapa redondo,
  // la vida, el dinero, el nivel de alerta, lo que llevas en la mano—, con dibujo, letra y colores
  // propios de FLIP (nada tomado de ningún juego). Y los números dicen algo de verdad:
  //   VIDA = la batería del teléfono · $ = lo que llevas fotografiado · ALERTA = cuánto se mueve la
  //   imagen · en la mano, la cámara y las tomas de la sesión · la hora es la hora.
  const HUD_KEY = 'flip.consola.marco';
  const hud = { on: true, battery: 1, shots: 0, money: 0, alert: 0, prev: null, banner: 0, watching: false };
  try { hud.on = localStorage.getItem(HUD_KEY) !== 'no'; hud.money = Math.max(0, parseInt(localStorage.getItem('flip.consola.dinero') || '0', 10) || 0); } catch (_) {}
  if (navigator.getBattery) navigator.getBattery().then(b => { const read = () => { hud.battery = b.level; }; read(); b.addEventListener('levelchange', read); }).catch(() => {});
  function hudWatch() {
    if (hud.watching) return;
    const gallery = document.getElementById('deckGallery');
    if (!gallery) return;
    hud.watching = true;
    // cada toma guardada hace saltar la miniatura: ahí suma
    new MutationObserver(() => {
      if (!gallery.classList.contains('pop') || !mineVariant() || performance.now() - hud.banner < 600) return;
      hud.shots++; hud.money += 500; hud.banner = performance.now();
      try { localStorage.setItem('flip.consola.dinero', String(hud.money)); } catch (_) {}
    }).observe(gallery, { attributes: true, attributeFilter: ['class'] });
  }
  const INK = '#FFF3DC', GREEN = '#7DDB8B', WARM = '#F77F50', DARK = '#151727';
  function hudText(ctx, text, x, y, size, color, align, font) {
    ctx.font = (font || '900 ') + size + 'px ' + (font ? '' : "'Chivo', 'Archivo', system-ui, sans-serif");
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    const o = Math.max(1, Math.round(size * .09));
    ctx.fillStyle = DARK; ctx.fillText(text, x + o, y + o);                      // sombra dura, de las de entonces
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function drawHud(ctx, w, h, now, capture) {
    const u = Math.min(w, h) / 100, pad = 4.5 * u;
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none'; ctx.imageSmoothingEnabled = true;
    ctx.lineJoin = 'round';
    // ── mapa: abajo a la izquierda ──
    const r = 15 * u, mx = pad + r, my = h - pad - r, t = now / 1000;
    ctx.save();
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = 'rgba(21,23,39,.72)'; ctx.fill();
    ctx.clip();
    ctx.translate(mx, my); ctx.rotate(Math.sin(t * .11) * .5);
    ctx.strokeStyle = 'rgba(255,243,220,.5)'; ctx.lineWidth = 1.5 * u;
    const drift = (t * 1.6 * u) % (9 * u);
    for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(-r * 2, i * 9 * u + drift); ctx.lineTo(r * 2, i * 9 * u + drift); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i * 11 * u, -r * 2); ctx.lineTo(i * 11 * u, r * 2); ctx.stroke(); }
    ctx.fillStyle = 'rgba(125,219,139,.34)'; ctx.fillRect(2 * u, -r * 2, 9 * u, r * 4);            // la avenida
    if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = WARM; ctx.beginPath(); ctx.arc(7 * u, -6 * u + drift, 1.6 * u, 0, Math.PI * 2); ctx.fill(); }   // el objetivo
    ctx.restore();
    ctx.lineWidth = 1.1 * u; ctx.strokeStyle = DARK; ctx.beginPath(); ctx.arc(mx, my, r + .4 * u, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = .7 * u; ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = GREEN; ctx.strokeStyle = DARK; ctx.lineWidth = .5 * u;                        // tú
    ctx.beginPath(); ctx.moveTo(mx, my - 2.6 * u); ctx.lineTo(mx + 1.9 * u, my + 2 * u); ctx.lineTo(mx, my + .9 * u); ctx.lineTo(mx - 1.9 * u, my + 2 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
    hudText(ctx, 'N', mx, my - r - 1.2 * u, 3.4 * u, INK, 'center');
    // ── arriba a la derecha: hora, lo que llevas en la mano, dinero, vida y alerta ──
    const right = w - pad, clock = new Date(), hhmm = String(clock.getHours()).padStart(2, '0') + ':' + String(clock.getMinutes()).padStart(2, '0');
    const box = 13 * u, bx = right - box, by = pad;
    ctx.fillStyle = 'rgba(21,23,39,.72)'; ctx.strokeStyle = INK; ctx.lineWidth = .7 * u;
    ctx.beginPath(); ctx.rect(bx, by, box, box); ctx.fill(); ctx.stroke();
    // en la mano: la cámara (el símbolo de FLIP, simplificado)
    ctx.save(); ctx.translate(bx + box / 2, by + box / 2); ctx.scale(u * .19, u * .19); ctx.translate(-32, -34);
    ctx.fillStyle = GREEN; ctx.beginPath(); ctx.moveTo(6, 27); ctx.quadraticCurveTo(7, 18, 17, 17); ctx.lineTo(19, 17); ctx.lineTo(23, 11); ctx.quadraticCurveTo(25, 8, 29, 8); ctx.lineTo(42, 8); ctx.quadraticCurveTo(47, 8, 49, 13); ctx.lineTo(51, 17); ctx.quadraticCurveTo(58, 18, 59, 25); ctx.lineTo(61, 40); ctx.quadraticCurveTo(63, 53, 51, 55); ctx.lineTo(18, 59); ctx.quadraticCurveTo(7, 60, 5, 49); ctx.lineTo(4, 39); ctx.quadraticCurveTo(3, 32, 6, 27); ctx.closePath(); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(43, 34, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(14, 31, 15, 5);
    ctx.fillStyle = DARK; ctx.beginPath(); ctx.arc(43, 34, 4.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    hudText(ctx, String(hud.shots).padStart(2, '0'), bx + box - 1 * u, by + box - 1.2 * u, 3.6 * u, INK, 'right', "800 ");
    const tx = bx - 2.4 * u;
    hudText(ctx, hhmm, tx, by + 4.6 * u, 5.2 * u, INK, 'right');
    hudText(ctx, '$' + String(hud.money).padStart(8, '0'), tx, by + 10.6 * u, 5.2 * u, GREEN, 'right');
    // vida: un tramo por cada 10 %
    const bars = 10, bw = 2.5 * u, gap = .7 * u, top = by + box + 2.6 * u, lit = Math.round(clamp(hud.battery) * bars);
    for (let i = 0; i < bars; i++) {
      const x = right - (bars - i) * (bw + gap) + gap;
      ctx.fillStyle = DARK; ctx.fillRect(x + .4 * u, top + .4 * u, bw, 3 * u);
      ctx.fillStyle = i < lit ? (lit <= 2 ? WARM : INK) : 'rgba(255,243,220,.22)'; ctx.fillRect(x, top, bw, 3 * u);
    }
    hudText(ctx, 'VIDA', right - bars * (bw + gap) - 1.2 * u, top + 2.9 * u, 3 * u, INK, 'right');
    // alerta: cinco rombos; se encienden con el movimiento de la imagen
    const pips = 5, level = Math.round(clamp(hud.alert) * pips), py = top + 7.8 * u;
    for (let i = 0; i < pips; i++) {
      const x = right - (pips - i) * 4.4 * u + 2.2 * u, on = i >= pips - level;
      ctx.beginPath(); ctx.moveTo(x, py - 1.9 * u); ctx.lineTo(x + 1.9 * u, py); ctx.lineTo(x, py + 1.9 * u); ctx.lineTo(x - 1.9 * u, py); ctx.closePath();
      ctx.fillStyle = on ? WARM : 'rgba(21,23,39,.6)'; ctx.fill();
      ctx.lineWidth = .5 * u; ctx.strokeStyle = on ? INK : 'rgba(255,243,220,.45)'; ctx.stroke();
    }
    // al guardar una toma, el rótulo (no sale en la foto: se pinta después de tomarla)
    const since = now - hud.banner;
    if (!capture && hud.banner && since < 2600) {
      const a = since < 200 ? since / 200 : since > 2100 ? (2600 - since) / 500 : 1;
      ctx.globalAlpha = a;
      hudText(ctx, 'TOMA GUARDADA', w / 2, h * .46, 8.6 * u, WARM, 'center');
      hudText(ctx, '+$500', w / 2, h * .46 + 8 * u, 6.4 * u, INK, 'center');
    }
    ctx.restore();
  }
  function hudMotion() {                                    // cuánto cambió la imagen reducida desde el cuadro anterior
    const lum = low.lum;
    if (!hud.prev || hud.prev.length !== lum.length) { hud.prev = Float32Array.from(lum); return; }
    let sum = 0;
    for (let i = 0; i < lum.length; i += 3) { sum += Math.abs(lum[i] - hud.prev[i]); hud.prev[i] = lum[i]; }
    const move = clamp((sum / (lum.length / 3) - 1.2) / 9);
    hud.alert += (move - hud.alert) * (move > hud.alert ? .3 : .04);
  }

  // ── Un cuadro ──────────────────────────────────────────────────────────────
  const stats = { frames: 0, tris: 0, faceTris: 0, ms: 0, variant: '' };
  function fill(data, at, pos, tris, uvOf) {
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 2, b = tris[t + 1] * 2, c = tris[t + 2] * 2;
      const cu = (uvOf[a] + uvOf[b] + uvOf[c]) / 3, cv = (uvOf[a + 1] + uvOf[b + 1] + uvOf[c + 1]) / 3;
      for (const k of [a, b, c]) { data[at++] = pos[k]; data[at++] = pos[k + 1]; data[at++] = uvOf[k]; data[at++] = uvOf[k + 1]; data[at++] = cu; data[at++] = cv; }
    }
    return at;
  }
  function renderConsola(source, srcW, srcH, ctx, mirror, variant, options) {
    const cfg = VARIANTS[variant] || VARIANTS.B128;
    if (!ensureGl()) return false;
    const started = performance.now(), now = (options && options.now) || started;
    const outW = Math.max(1, Math.round((options && options.outW) || ctx.canvas.width)), outH = Math.max(1, Math.round((options && options.outH) || ctx.canvas.height));
    const tall = outH >= outW, scale = cfg.long / Math.max(outW, outH);
    const iw = Math.max(32, Math.round(outW * scale)), ih = Math.max(32, Math.round(outH * scale));
    // la textura de cada polígono: la imagen a un tercio de la resolución interna, sin suavizar al leerla
    const lw = Math.max(24, Math.round(iw / 3)), lh = Math.max(24, Math.round(ih / 3));
    surface(low, lw, lh, true);
    if (low.w !== lw || low.h !== lh) { low.w = lw; low.h = lh; low.lum = new Float32Array(lw * lh); low.fresh = true; }
    const [sx, sy, sw, sh] = typeof cropCoordsForDims === 'function' ? cropCoordsForDims(srcW, srcH, lw, lh) : [0, 0, srcW, srcH];
    // La imagen reducida se promedia en el tiempo (cada cuadro pesa la mitad): el color de un polígono
    // y los bordes a los que se pega la malla no bailan con el ruido de la cámara.
    const cold = low.fresh || started - (low.at || 0) > 400 || low.mirror !== mirror;
    low.at = started; low.fresh = false; low.mirror = mirror;
    low.ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? lw : 0, 0);
    low.ctx.imageSmoothingEnabled = true;
    low.ctx.globalAlpha = cold ? 1 : .5;
    low.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, lw, lh);
    low.ctx.globalAlpha = 1;
    const px = low.ctx.getImageData(0, 0, lw, lh).data, lum = low.lum;
    for (let i = 0, k = 0; i < lum.length; i++, k += 4) lum[i] = px[k] * .3 + px[k + 1] * .59 + px[k + 2] * .11;

    const cols = tall ? Math.round(cfg.cells * outW / outH) : cfg.cells, rows = tall ? cfg.cells : Math.round(cfg.cells * outH / outW);
    buildMesh(Math.max(4, cols), Math.max(4, rows));
    hugEdges(.8);
    // la cara, si se ve (o se vio hace un instante)
    const preview = !options || options.path !== 'capture';
    if (preview) { face.usedAt = started; faceStart(); faceSend(source, sx, sy, sw, sh, mirror, started); }
    const faceOn = !!face.tris && (face.injected || started - face.seenAt < 450);
    const count = mesh.tris.length + (faceOn ? face.tris.length : 0);
    if (!mesh.data || mesh.data.length < count * 6) mesh.data = new Float32Array(count * 6);
    let at = fill(mesh.data, 0, mesh.pos, mesh.tris, mesh.pos);
    if (faceOn) fill(mesh.data, at, face.smooth, face.tris, face.smooth);

    if (canvas.width !== iw || canvas.height !== ih) { canvas.width = iw; canvas.height = ih; }
    gl.viewport(0, 0, iw, ih);
    gl.bindTexture(gl.TEXTURE_2D, res.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, low.canvas);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.buf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data.subarray(0, count * 6), gl.DYNAMIC_DRAW);
    gl.uniform1f(res.u.snap, cfg.snap); gl.uniform1f(res.u.bits, cfg.bits); gl.uniform1f(res.u.dither, cfg.dither); gl.uniform1f(res.u.grade, cfg.grade); gl.uniform1f(res.u.shade, cfg.shade);
    gl.uniform1f(res.u.tex, cfg.tex); gl.uniform1f(res.u.face, 0);
    gl.uniform1f(res.u.stars, cfg.stars ? 1 : 0); gl.uniform1f(res.u.time, (now / 1000) % 1000);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.tris.length);
    if (faceOn) { gl.uniform1f(res.u.tex, cfg.faceTex); gl.uniform1f(res.u.shade, 1); gl.uniform1f(res.u.face, 1); gl.drawArrays(gl.TRIANGLES, mesh.tris.length, face.tris.length); }

    // Lo que hacía la máquina después: estelas (cada cuadro se mezcla con el anterior) y resplandor.
    let shown = canvas;
    if (cfg.trail > 0) {
      const fresh = surface(acc, iw, ih) || stats.variant !== variant || started - (acc.at || 0) > 400;
      acc.ctx.globalAlpha = fresh ? 1 : 1 - cfg.trail;
      acc.ctx.drawImage(canvas, 0, 0);
      acc.at = started;
      shown = acc.canvas;
    }
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.imageSmoothingEnabled = cfg.smooth;
    ctx.drawImage(shown, 0, 0, outW, outH);
    if (cfg.bloom > 0) {
      surface(glowA, Math.max(8, iw >> 2), Math.max(8, ih >> 2)); surface(glowB, Math.max(4, iw >> 4), Math.max(4, ih >> 4));
      glowA.ctx.globalCompositeOperation = 'copy'; glowA.ctx.drawImage(shown, 0, 0, glowA.canvas.width, glowA.canvas.height);
      glowA.ctx.globalCompositeOperation = 'multiply';                          // solo desbordan las luces: la imagen por sí misma, dos veces
      glowA.ctx.drawImage(glowA.canvas, 0, 0); glowA.ctx.drawImage(glowA.canvas, 0, 0);
      // NOCHE: una vez más (la luz a la octava potencia): solo lo que pasa de ~0,72 derrama halo sobre el cuarto oscuro
      if (cfg.glowPicky) glowA.ctx.drawImage(glowA.canvas, 0, 0);
      glowB.ctx.globalCompositeOperation = 'copy'; glowB.ctx.drawImage(glowA.canvas, 0, 0, glowB.canvas.width, glowB.canvas.height);
      // NOCHE: un escalón más (1/64): la luz de la pantalla o la lámpara se derrama ancha por el cuarto
      if (cfg.wide) { surface(glowC, Math.max(3, iw >> 6), Math.max(3, ih >> 6)); glowC.ctx.globalCompositeOperation = 'copy'; glowC.ctx.drawImage(glowB.canvas, 0, 0, glowC.canvas.width, glowC.canvas.height); }
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = cfg.bloom * .6; ctx.drawImage(glowA.canvas, 0, 0, outW, outH);
      ctx.globalAlpha = cfg.bloom; ctx.drawImage(glowB.canvas, 0, 0, outW, outH);
      if (cfg.wide) { ctx.globalAlpha = cfg.bloom * .9; ctx.drawImage(glowC.canvas, 0, 0, outW, outH); }
    }
    ctx.restore();
    if (hud.on) { hudWatch(); if (preview) hudMotion(); drawHud(ctx, outW, outH, Date.now(), !preview); }
    ctx.imageSmoothingEnabled = false;
    Object.assign(stats, { frames: stats.frames + 1, tris: mesh.tris.length / 3, faceTris: faceOn ? face.tris.length / 3 : 0, ms: performance.now() - started, variant, size: [iw, ih] });
    return true;
  }

  // VIRTUAL tiene dos motores: estas tres variantes son de aquí; los escenarios en 3D (DORMITORIO,
  // AZOTEA…) los pinta cuarto.js. El marco de juego y su dinero son solo de las de aquí.
  const mineVariant = () => typeof camFamily !== 'undefined' && camFamily === 'CONSOLA' && typeof camVariant !== 'undefined' && !!VARIANTS[camVariant];
  const scenario = () => typeof _esCuarto === 'function' && _esCuarto();
  // La tecla MARCO DE JUEGO vive en el cajón «cámaras y filtros» y solo aparece con una de esas tres.
  let hudRow = null;
  function hudPaint() {
    if (!hudRow) return;
    hudRow.hidden = !mineVariant();
    const key = hudRow.querySelector('button');
    key.classList.toggle('is-on', hud.on); key.setAttribute('aria-pressed', String(hud.on));
  }
  // ── PASEO: en los escenarios en 3D, la cámara recorre el escenario o se queda quieta frente a la
  //    pantalla. Es el mando «paseo» de la hoja de ajustes (fxCamVals.CUARTO.paseo) y además una tecla
  //    rápida: en la piel INTERFAZ, en la banda junto a la variante (como las de REACCIÓN y CLON); en
  //    la piel OBJETO, una tecla del aparato bajo las variantes. Se guarda con los ajustes.
  let walkBand = null, walkRow = null;
  const walking = () => typeof fxCamVals === 'object' && fxCamVals.CUARTO ? fxCamVals.CUARTO.paseo >= 1 : true;
  function walkSet(on) {
    if (typeof fxCamVals !== 'object' || !fxCamVals.CUARTO) return;
    fxCamVals.CUARTO.paseo = on ? 1 : 0;
    if (typeof _syncFxCamUI === 'function') _syncFxCamUI();
    if (typeof saveSettings === 'function') saveSettings();
    walkPaint();
    if (window.flipShell && flipShell.hint) flipShell.hint(on ? 'PASEO · la cámara recorre el escenario' : 'QUIETA · la cámara se queda frente a la pantalla', 1800);
  }
  function walkPaint() {
    const on = scenario(), go = walking();
    if (walkBand) {
      walkBand.hidden = !on;
      // (la clase que abre sitio en la banda la ponen también REACCIÓN y CLON al cambiar de cámara: se pone después de ellas)
      setTimeout(() => { if (scenario()) document.body.classList.add('con-rapidas'); }, 0);
      const key = walkBand.querySelector('button');
      key.textContent = go ? 'PASEO' : 'QUIETA';
      key.classList.toggle('is-on', !go); key.setAttribute('aria-pressed', String(!go));
      key.setAttribute('aria-label', go ? 'La cámara pasea. Toca para dejarla quieta frente a la pantalla' : 'La cámara está quieta. Toca para que pasee');
    }
    if (walkRow) {
      walkRow.hidden = !on;
      const key = walkRow.querySelector('button');
      key.textContent = go ? 'CÁMARA: PASEO' : 'CÁMARA: QUIETA';
      key.classList.toggle('is-on', !go); key.setAttribute('aria-pressed', String(!go));
    }
  }
  function hudMount() {
    const cajon = document.getElementById('siCajon'), looks = document.getElementById('deckLooks'), variants = document.getElementById('deckVariants');
    if (!window.flipShell || hudRow) return;
    if (cajon) {
      hudRow = flipShell.el('div', { class: 'si-cajon-fila si-consola' }, '<small>VIRTUAL</small><div class="si-filtros"><button class="hw si-chip" type="button" id="consolaMarco" aria-pressed="true">MARCO DE JUEGO</button></div>');
      cajon.insertBefore(hudRow, cajon.querySelector(':scope > .grano'));
      hudRow.querySelector('button').addEventListener('click', () => window.flipConsola.hud(!hud.on));
    }
    const head = document.querySelector('.si-banda-cabeza');
    if (head) {
      walkBand = flipShell.el('div', { class: 'si-rapidas consola-rapidas', role: 'group', 'aria-label': 'Cámara del escenario' }, '<button class="hw si-chip" type="button" id="consolaPaseo" aria-pressed="false">PASEO</button>');
      head.insertBefore(walkBand, head.querySelector('.si-abrir'));
      walkBand.querySelector('button').addEventListener('click', () => walkSet(!walking()));
    }
    const tray = document.querySelector('#camDeck .deck-groups') || document.querySelector('#camDeck .deck-looks');
    if (tray) {
      walkRow = flipShell.el('div', { class: 'deck-variants reaccion-teclas consola-teclas', role: 'group', 'aria-label': 'Cámara del escenario' }, '<button class="hw hw-keycap" type="button" data-consola="paseo" aria-pressed="false">CÁMARA: PASEO</button>');
      tray.before(walkRow);
      walkRow.querySelector('button').addEventListener('click', () => walkSet(!walking()));
    }
    const paint = () => queueMicrotask(() => { hudPaint(); walkPaint(); });
    for (const node of [looks, variants]) if (node) new MutationObserver(paint).observe(node, { subtree: true, attributes: true, attributeFilter: ['class'] });
    // (el mando de la hoja también la cambia)
    const knob = document.getElementById('fxCUARTOpaseo');
    if (knob) knob.addEventListener('input', () => queueMicrotask(walkPaint));
    hudPaint(); walkPaint();
  }
  if (document.readyState === 'complete') hudMount(); else addEventListener('load', hudMount);

  window.renderConsola = renderConsola;
  window.flipConsola = {
    release, variants: VARIANTS,
    state: () => ({ gl: !!gl, failed, lost, ...stats, ms: +stats.ms.toFixed(2), face: { state: face.state, ms: +face.ms.toFixed(1), points: face.picks ? face.picks.length : 0, seen: performance.now() - face.seenAt < 450, error: face.error } }),
    // Para las pruebas: una cara a mano (478 puntos x,y de 0 a 1), sin cargar el rastreador.
    // El marco de juego: encenderlo, apagarlo, y lo que marca.
    hud(on) { if (on != null) { hud.on = !!on; try { localStorage.setItem(HUD_KEY, hud.on ? 'si' : 'no'); } catch (_) {} hudPaint(); } return hud.on; },
    hudState: () => ({ on: hud.on, vida: +hud.battery.toFixed(2), dinero: hud.money, tomas: hud.shots, alerta: +hud.alert.toFixed(2) }),
    // PASEO de los escenarios en 3D (la tecla rápida y el mando de la hoja son el mismo valor)
    paseo(on) { if (on != null) walkSet(!!on); return walking(); },
    injectFace(points) { if (!points) { face.injected = false; face.tris = face.picks = null; return; } face.injected = true; face.tris = null; faceTake(Float32Array.from(points), performance.now()); },
  };
})();
