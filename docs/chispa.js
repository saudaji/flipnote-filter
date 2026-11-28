// FLIP · CHISPA: brillantina y destellos que viajan con la imagen.
//
// Dos tiradas del mismo motor:
//   · LENTEJA  brillantina de GIF de los dos mil: facetas de unos 3 px que titilan a saltos (9 por
//              segundo de fábrica). La regla es solo de luz y color, sin adivinar qué es cada cosa:
//              lo oscuro queda liso; lo claro y sin color (nubes, ropa blanca) se vuelve diamantina
//              de todos los colores; lo claro y con color (un prado, un vestido) se cubre de
//              lentejuelas de su mismo color con algunas chispas cálidas sueltas. Los granos más
//              fuertes sueltan una cruz «+» de brazos finos, pocas a la vez.
//   · MAREA    mar de destellos: la imagen suavizada y llevada a la noche, con puntitos que titilan
//              sobre las crestas de luz (bordes de nubes, espuma, contornos) y, muy de vez en
//              cuando, un cuadro de luz grande y translúcido. El tiempo corre continuo, como agua.
//
// Lo que separa esto de la estática de televisión: cada grano es más grande que un píxel, dura
// encendido lo que dura su pulso (no cambia a cada cuadro) y VIAJA con la imagen. Para eso se mide
// el movimiento (flujo óptico de Lucas y Kanade en una rejilla de 64 × 36) y se arrastran unas
// coordenadas de anclaje que deciden qué grano cae en cada punto: al mover la cámara las
// lentejuelas se quedan en la nube o en el vestido, no en el vidrio. Las coordenadas se arrastran
// en dos capas que se reinician por turnos y se relevan grano a grano (como el brillo ya parpadea,
// el relevo no se ve): un paneo largo no estira la brillantina sin fin; y donde el arrastre se
// cizalla (una mano que saluda delante de la pared) esa capa cede el sitio a una quieta.
// Todo en WebGL 1 sin extensiones: los números finos (luz, flujo, anclaje) se guardan partidos en
// dos bytes de una textura RGBA8.
//
//   renderChispa(fuente, anchoFuente, altoFuente, ctx2d, espejo, variante, opciones) → false sin gráfica
//   opciones (todas opcionales; de 0 a 1 salvo ritmo):
//     densidad, umbral, cruces (en MAREA: los cuadros grandes), anclaje, ritmo (4…18 Hz),
//     now, path ('preview' | 'capture'), outW, outH, audio: { bass, mid, treble, beat },
//     persona: 'PERSONA' | 'FONDO' (brillantina solo en la persona o solo detrás; LENTEJA),
//     mask: { data, width, height } máscara ya en el encuadre de salida (si no viene y se pide
//           persona, se le pide a flipSilhouette)
(function () {
  'use strict';

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  // Valores de fábrica por tirada (tabla de la propuesta de efectos).
  const FABRICA = {
    LENTEJA: { densidad: 0.78, umbral: 0.18, cruces: 0.65, anclaje: 0.85, ritmo: 9 },
    MAREA: { densidad: 0.55, umbral: 0.32, cruces: 0.50, anclaje: 0.75, ritmo: 9 },
  };
  const CICLO = 3;            // segundos que vive cada capa de anclaje antes de reiniciarse
  const GRID = 64;            // lado largo de la rejilla de flujo

  const VERT = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  // Convención de todas las texturas intermedias: v = 0 es la fila de ARRIBA de la imagen (así
  // escribe una pasada a textura con vUv y así llega la fuente sin voltear).
  const COMMON = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 hash22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
// Un número de 0 a 1 en dos bytes (1/65025 de paso). Interpolar los dos bytes por separado
// interpola el número: el filtro lineal de la textura sigue sirviendo.
vec2 pack16(float x) { float t = clamp(x, 0.0, 1.0) * 255.0; float hi = floor(t); return vec2(hi / 255.0, t - hi); }
float unpack16(vec2 c) { return c.x + c.y / 255.0; }
// Desplazamiento de anclaje: ±2 cuadros por eje.
vec4 encD(vec2 d) { return vec4(pack16(d.x * 0.25 + 0.5), pack16(d.y * 0.25 + 0.5)); }
vec2 decD(vec4 c) { return (vec2(unpack16(c.rg), unpack16(c.ba)) - 0.5) * 4.0; }
// Flujo: ±4 celdas por cuadro en 12 bits por eje (8 + 4) y la confianza en el cuarto byte.
vec4 encF(vec2 v, float conf) {
  vec2 t = floor(clamp(v * 0.125 + 0.5, 0.0, 1.0) * 4095.0 + 0.5);
  vec2 hi = floor(t / 16.0); vec2 lo = t - hi * 16.0;
  return vec4(hi / 255.0, (lo.x * 16.0 + lo.y) / 255.0, conf);
}
vec3 decF(vec4 c) {
  vec2 hi = floor(c.rg * 255.0 + 0.5); float b = floor(c.b * 255.0 + 0.5);
  float lx = floor(b / 16.0);
  vec2 t = hi * 16.0 + vec2(lx, b - lx * 16.0);
  return vec3((t / 4095.0 - 0.5) * 8.0, c.a);
}
`;
  // 1 · La imagen a un cuarto: recorte, espejo y un gaussiano de 4 × 4 tomas. De ella salen la
  //     zona de cada grano (luz, color) —nunca del píxel suelto, que trae el ruido del sensor— y
  //     las crestas de MAREA.
  const QUARTER = COMMON + `
uniform sampler2D uSrc; uniform vec4 uCrop; uniform vec2 uStep;
void main() {
  vec2 uv = uCrop.xy + vUv * uCrop.zw;
  vec3 c = vec3(0.0); float ws = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i), float(j)) * 0.5 - 0.75;
    float w = exp(-dot(o, o) * 2.0);
    c += w * texture2D(uSrc, uv + uStep * o).rgb; ws += w;
  }
  gl_FragColor = vec4(c / ws, 1.0);
}`;
  // 2 · Luz en la rejilla de flujo, sacada directamente de la imagen con una ventana suave de
  //     10 × 10 tomas (coseno cuadrado de tres celdas de ancho: quita el detalle que, al reducir,
  //     «bailaría» de un cuadro a otro), y su gradiente con la derivada de esa misma ventana, que
  //     es lo que de verdad cambia la luz al moverse la imagen (las diferencias entre celdas
  //     vecinas se quedaban cortas y el flujo salía hasta un 30 % más rápido que la escena).
  //     Luz en 16 bits (R, G); gradiente en 8 bits por eje (B, A).
  const LUM = COMMON + `
uniform sampler2D uSrc; uniform vec4 uCrop; uniform vec2 uStep;
const float R = 1.65;
float win(float o) { float c = cos(1.5707963 * o / R); return c * c; }
float dwin(float o) { return 1.5707963 / R * sin(3.1415927 * o / R); }
void main() {
  vec2 uv = uCrop.xy + vUv * uCrop.zw;
  float l = 0.0, ws = 0.0; vec2 g = vec2(0.0);
  for (int j = 0; j < 10; j++) for (int i = 0; i < 10; i++) {
    vec2 o = (vec2(float(i), float(j)) - 4.5) / 3.0;
    float wx = win(o.x), wy = win(o.y);
    float v = luma(texture2D(uSrc, uv + uStep * o).rgb);
    l += wx * wy * v; ws += wx * wy;
    g += vec2(dwin(o.x) * wy, wx * dwin(o.y)) * v;
  }
  gl_FragColor = vec4(pack16(l / ws), clamp(g / ws * 1.5 + 0.5, 0.0, 1.0));
}`;
  // 3 · Flujo de Lucas y Kanade en ventana de 5 × 5. Se parte del flujo del cuadro anterior
  //     redondeado a celdas enteras (el movimiento casi siempre sigue; y a celda entera no hay que
  //     interpolar, que también sesga) y se mide solo lo que falta, que ya es menos de media celda.
  const FLOW = COMMON + `
uniform sampler2D uCur; uniform sampler2D uPrev; uniform sampler2D uPred; uniform vec2 uGrid; uniform float uUsePred;
void main() {
  vec2 c0 = gl_FragCoord.xy;
  vec2 k = floor(decF(texture2D(uPred, vUv)).xy * uUsePred + 0.5);
  float a11 = 2e-4, a12 = 0.0, a22 = 2e-4, b1 = 0.0, b2 = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 o = vec2(float(i), float(j));
    vec4 cc = texture2D(uCur, (c0 + o) / uGrid), pp = texture2D(uPrev, (c0 + o - k) / uGrid);
    vec2 g = (cc.ba + pp.ba - 1.0) / 3.0;
    float it = unpack16(cc.rg) - unpack16(pp.rg);
    float w = exp(-dot(o, o) * 0.18);
    a11 += w * g.x * g.x; a12 += w * g.x * g.y; a22 += w * g.y * g.y; b1 += w * g.x * it; b2 += w * g.y * it;
  }
  float det = a11 * a22 - a12 * a12;
  vec2 v = k - vec2(a22 * b1 - a12 * b2, a11 * b2 - a12 * b1) / det;
  float m = length(v);
  if (m > 3.5) v *= 3.5 / m;
  float tr = a11 + a22;
  float lmin = max(0.5 * tr - sqrt(max(0.25 * tr * tr - det, 0.0)) - 2e-4, 0.0);
  gl_FragColor = encF(v, lmin / (lmin + 0.0015));
}`;
  // 4 · El flujo, repartido: donde no hay textura (una pared lisa, una camisa blanca) toma el
  //     movimiento de alrededor, pesado por la confianza.
  const SMOOTH = COMMON + `
uniform sampler2D uRaw; uniform vec2 uGrid;
void main() {
  vec2 sum = vec2(0.0); float ws = 0.0, gs = 0.0;
  for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
    vec2 o = vec2(float(i), float(j));
    vec3 f = decF(texture2D(uRaw, (gl_FragCoord.xy + o) / uGrid));
    float g = exp(-dot(o, o) * 0.12);
    float w = g * (f.z * f.z + 1e-4);
    sum += f.xy * w; ws += w; gs += g;
  }
  gl_FragColor = encF(sum / ws, clamp(ws / gs * 4.0, 0.0, 1.0));
}`;
  // 5 · Arrastre de las coordenadas de anclaje (semilagrangiano): lo que hoy está en x estaba en
  //     x − v; su anclaje viene de allí. Se guarda el desplazamiento respecto a la pantalla, que
  //     es suave y se interpola sin costuras.
  const ADVECT = COMMON + `
uniform sampler2D uAnc; uniform sampler2D uFlow; uniform vec2 uGrid; uniform float uK; uniform float uReset;
vec2 F(vec2 c) { return decF(texture2D(uFlow, c / uGrid)).xy; }
void main() {
  vec2 p = vUv * uGrid - 0.5; vec2 i = floor(p); vec2 f = p - i;
  vec2 v = mix(mix(F(i + vec2(0.5, 0.5)), F(i + vec2(1.5, 0.5)), f.x), mix(F(i + vec2(0.5, 1.5)), F(i + vec2(1.5, 1.5)), f.x), f.y);
  vec2 vel = v / uGrid * uK;
  vec2 d = decD(texture2D(uAnc, vUv - vel)) - vel;
  if (uReset > 0.5) d = vec2(0.0);
  gl_FragColor = encD(clamp(d, -1.99, 1.99));
}`;
  // 5b · Cuánto está estirado el anclaje de cada capa (A en R, B en G; 0 = intacto). Donde algo
  //      se mueve distinto de lo de al lado (una mano que saluda delante de la pared), arrastrar las
  //      coordenadas las cizalla y los granos se volvían remolinos y rayas: ahí esa capa cede su
  //      sitio a la otra o, si las dos están rotas, a una capa quieta. (El relevo las rehace cada 3 s.)
  const STRETCH = COMMON + `
uniform sampler2D uA; uniform sampler2D uB; uniform vec2 uAnc; uniform vec2 uRes;
float st(sampler2D T) {
  vec2 e = 1.0 / uAnc;
  vec2 dx = (decD(texture2D(T, vUv + vec2(e.x, 0.0))) - decD(texture2D(T, vUv - vec2(e.x, 0.0)))) * uRes / (2.0 * e.x * uRes.x);
  vec2 dy = (decD(texture2D(T, vUv + vec2(0.0, e.y))) - decD(texture2D(T, vUv - vec2(0.0, e.y)))) * uRes / (2.0 * e.y * uRes.y);
  return max(length(dx), length(dy));
}
void main() { gl_FragColor = vec4(min(st(uA), 1.0), min(st(uB), 1.0), 0.0, 1.0); }`;
  // 5c · La luz de la escena (LENTEJA), en la gráfica: leer el cuadro a la CPU obligaba a esperar a
  //      la gráfica (20–30 ms de golpe cada vez en Safari). Aquí se cuenta: cada uno de 64 tramos
  //      de luz guarda qué parte del cuadro (una rejilla de 32 × 32 sobre la imagen a un cuarto)
  //      queda por debajo de su borde.
  const CDF = COMMON + `
uniform sampler2D uQ;
void main() {
  float edge = (floor(gl_FragCoord.x) + 1.0) / 64.0, n = 0.0;
  for (int y = 0; y < 32; y++) for (int x = 0; x < 32; x++) n += step(luma(texture2D(uQ, (vec2(float(x), float(y)) + 0.5) / 32.0).rgb), edge);
  gl_FragColor = vec4(pack16(n / 1024.0), 0.0, 1.0);
}`;
  //      …y de esa cuenta sale la compuerta: el cuantil pedido (la mitad, de fábrica), pegado al
  //      salto de luz más cercano si lo hay (una zona entera queda dentro o fuera), y por encima de
  //      la superficie lisa más grande si se puede (el fondo queda liso; la brillantina es figura).
  //      Se sigue despacio desde la anterior (uK: 0 se queda, 1 salta).
  const THRESH = COMMON + `
uniform sampler2D uCdf; uniform sampler2D uPrev; uniform float uShare, uFloor, uK;
float C(float i) { return unpack16(texture2D(uCdf, vec2((clamp(i, 0.0, 63.0) + 0.5) / 64.0, 0.5)).rg); }
float Lq(float q) {
  float r = 1.0;
  for (int i = 63; i >= 0; i--) if (C(float(i)) >= q) r = (float(i) + 1.0) / 64.0;
  return r;
}
void main() {
  float share = uShare, thr = Lq(share), width = clamp(Lq(share + 0.15) - thr, 0.06, 0.16);
  if (share > 0.02 && share < 0.95) {
    float best = 0.0, bq = share;
    for (int k = 0; k <= 21; k++) {
      float q = share - 0.06 + 0.01 * float(k);
      if (q < 0.01 || q > 0.95) continue;
      float gap = Lq(q + 0.04) - Lq(q);
      if (gap > best) { best = gap; bq = q; }
    }
    if (best > 0.06) { thr = Lq(bq) + 0.05 * best; width = clamp(0.9 * best, 0.04, 0.16); }
    float bc = 0.0, bi = 0.0;
    for (int i = 0; i < 62; i++) { float c = C(float(i) + 2.0) - (i > 0 ? C(float(i) - 1.0) : 0.0); if (c > bc) { bc = c; bi = float(i); } }
    float hi = (bi + 3.0) / 64.0, above = 1.0 - C(bi + 3.0);
    if (bc > 0.25 && hi > thr && above > 0.08) { thr = hi + 0.01; width = clamp(Lq(min(1.0, 1.0 - above + 0.08)) - thr, 0.04, 0.16); }
  }
  thr = max(thr, uFloor);
  vec4 prev = texture2D(uPrev, vec2(0.5));
  thr = mix(unpack16(prev.rg), thr, uK); width = mix(unpack16(prev.ba) * 0.25, width, uK);
  gl_FragColor = vec4(pack16(thr), pack16(width * 4.0));
}`;
  // 7 · El resplandor de LENTEJA: lo encendido se copia a un cuarto, se emborrona y se suma (como
  //     la pirámide de BRASA). Los granos encendidos se funden en manchitas que brillan y tiñen a
  //     sus vecinos, y la luz cruza el borde de la nube: sin esto la nube se leía como confeti gris.
  const GLOW_DOWN = COMMON + `
uniform sampler2D uTex; uniform vec2 uStep;
void main() {
  vec4 a = texture2D(uTex, vUv + uStep * vec2(-0.25, -0.25)), b = texture2D(uTex, vUv + uStep * vec2(0.25, -0.25));
  vec4 c2 = texture2D(uTex, vUv + uStep * vec2(-0.25, 0.25)), d = texture2D(uTex, vUv + uStep * vec2(0.25, 0.25));
  vec3 c = 0.25 * (a.rgb * a.a + b.rgb * b.a + c2.rgb * c2.a + d.rgb * d.a);      // (solo lo que es brillantina)
  gl_FragColor = vec4(c * smoothstep(0.2, 0.6, luma(c)), 1.0);
}`;
  const GLOW_BLUR = COMMON + `
uniform sampler2D uTex; uniform vec2 uDir;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270270;
  c += (texture2D(uTex, vUv + uDir * 1.3846154).rgb + texture2D(uTex, vUv - uDir * 1.3846154).rgb) * 0.3162162;
  c += (texture2D(uTex, vUv + uDir * 3.2307692).rgb + texture2D(uTex, vUv - uDir * 3.2307692).rgb) * 0.0702703;
  gl_FragColor = vec4(c, 1.0);
}`;
  const GLOW_ADD = COMMON + `
uniform sampler2D uFull; uniform sampler2D uGlow; uniform float uGlowK;
void main() { gl_FragColor = vec4(clamp(texture2D(uFull, vUv).rgb + texture2D(uGlow, vUv).rgb * uGlowK, 0.0, 1.0), 1.0); }`;
  // La luz de la brillantina (calibrada contra la luz de las nubes de la referencia: media,
  // percentiles 10/50/90/95 y puntos casi negros, dentro de la nube): resplandor que se suma, brillo
  // del grano en su pico y luz del fondo bajo las lentejuelas.
  const LUZ = { resplandor: 2.6, pulso: 0.3, fondo: 1.0 };
  // 6 · El cuadro final, a la resolución de salida.
  const FINAL = mode => COMMON + '#define MAREA ' + mode + `
uniform sampler2D uSrc; uniform sampler2D uQ; uniform sampler2D uA; uniform sampler2D uB; uniform sampler2D uMask; uniform sampler2D uStretch; uniform sampler2D uHues; uniform sampler2D uScene;
float gThrRel, gThrW, glowSrc = 1.0;
uniform vec4 uCrop; uniform vec2 uRes; uniform vec2 uQStep;
uniform float uT, uWA, uCell, uMacro, uUnit, uDens, uThr, uPulseK, uBedK, uMicro, uBlock, uCross, uArc, uBright, uCrest, uMacroL, uWave, uMaskMode, uDebug;
vec3 srcAt(vec2 uv) { return texture2D(uSrc, uCrop.xy + uv * uCrop.zw).rgb; }
vec3 qAt(vec2 uv) { return texture2D(uQ, uv).rgb; }
vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-5)), d / (q.x + 1e-5), q.x);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float pulseOf(vec2 id, float t, float extra) {
  float om = mix(3.5, 7.5, hash12(id + 3.1)), ph = 6.2831853 * hash12(id + 7.7);
  return pow(max(0.0, sin(om * t + ph + extra)), 8.0);
}
// La persona (si se pidió): 1 donde va la brillantina.
float gate(vec2 uv) {
  if (uMaskMode < 0.5) return 1.0;
  float m = smoothstep(0.35, 0.65, texture2D(uMask, uv).r);
  return uMaskMode < 1.5 ? m : 1.0 - m;
}
// Granos: manchas suaves sembradas en las coordenadas ancladas (en px), tres por tres candidatos
// por capa, cada uno con su brillo de reposo y su pulso. Se suman (no se recortan en celdas): así
// se pisan un poco, dejan hueco oscuro entre ellos y los que destellan sueltan su resplandor, como
// la brillantina de verdad; una teselación limpia se leía como mosaico.
float nD; vec2 nId; float nPulse;
void nearest(vec2 id, float d2, float p) { if (d2 < nD) { nD = d2; nId = id; nPulse = p; } }
#if MAREA == 0
vec4 gTop; vec3 gTopArc; float gHalo, gGlow, gCov;
void grains(vec2 a, vec2 seed, float wLayer, float keep, float fine, float edgeP) {
  vec2 g = a / uCell; vec2 gi = floor(g); vec2 gf = g - gi;
  // el matiz va por manchitas de granos vecinos (azar de la manchita + azar del grano: la suma
  // de dos azares parejos, vuelta a 0–1, sigue pareja, y la tabla conserva el reparto medido)
  float tone = hash12(floor(a / (uCell * 3.0)) + seed * 0.37 + 83.1);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)), id = gi + o + seed;
    if (hash12(id + 0.37) >= wLayer) continue;                   // duerme (relevo de capas)
    vec2 r = (o + 0.15 + 0.7 * hash22(id) - gf) * uCell;
    float d2 = dot(r, r);
    float s = uCell * mix(0.42, 0.56, hash12(id + 31.7)) * fine; // radio del núcleo, en px
    if (d2 > 6.25 * s * s + 1.0) continue;                       // lejos: no llega
    float p = pulseOf(id, uT, 0.0);
    nearest(id, d2, p);
    if (hash12(id + 51.3) > keep) continue;                      // (en la piel, solo algunos)
    if (hash12(id + 71.3) > edgeP) continue;                     // (en el borde, cada vez menos)
    // lentejuela: núcleo duro (con un píxel de borde suave) y un halo mínimo; nada de disco difuso
    float dd = sqrt(d2);
    float blob = 1.0 - smoothstep(s - 0.6, s + 0.6, dd);
    float halo = exp(-d2 / (4.8 * s * s)) * 0.12;
    float rest = (0.5 + 0.5 * pow(hash12(id + 37.3), 1.4)) * mix(0.55, 1.0, step(hash12(id + 23.7), 0.35 + 0.65 * uDens));
    float warm = step(hash12(id + 19.9), 0.12);
    // matiz con el reparto medido en la referencia (tabla), plata en uno de cada seis granos
    float hu = texture2D(uHues, vec2(fract(hash12(id + 11.3) * 0.6 + tone) * 0.984 + 0.008, 0.5)).r;
    float sat = mix(0.6, 0.98, hash12(id + 47.9)) * (1.0 - step(hash12(id + 61.1), 0.06) * 0.9);
    vec3 arc = hsv2rgb(vec3(fract(hu + 0.03 * sin(uT * 3.0 + hash12(id + 41.9) * 6.2831853)), sat, 1.0));
    // Opacas: en cada punto manda la lentejuela de encima (la que más cubre), no la suma; sumadas,
    // las de colores distintos se volvían blanco. Solo el halo mínimo y el destello se suman.
    if (blob > gTop.x) { gTop = vec4(blob, rest, p, warm); gTopArc = arc; }
    gHalo += halo * rest;
    gGlow += exp(-d2 / (2.0 * s * s)) * p * p;
    gCov = max(gCov, blob);
  }
}
// Cruces «+» de brazos finos, en macroceldas ancladas: solo en grano claro y en el pico de su pulso.
vec3 stars(vec2 a, vec2 uv, vec2 seed, float wLayer) {
  vec3 acc = vec3(0.0);
  vec2 mi = floor(a / uMacro);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cell = mi + vec2(float(i), float(j)), M = cell + seed;
    if (hash12(M + 0.53) >= wLayer) continue;
    float p = pulseOf(M, uT, 0.0);
    if (p <= uCross) continue;
    vec2 d = a - (cell + 0.15 + 0.7 * hash22(M + 9.1)) * uMacro;
    float k = (p - uCross) / (1.0 - uCross);
    float arm = mix(6.0, 11.0, k) * uUnit;
    if (max(abs(d.x), abs(d.y)) > arm + 2.0 * uUnit) continue;
    vec2 suv = uv - d / uRes;
    // (y solo donde la compuerta deja brillar: una cruz suelta sobre la pared lisa delataba la regla)
    if (luma(qAt(suv)) < max(0.48, gThrRel + 0.5 * gThrW) || gate(suv) < 0.5) continue;
    if (uDebug > 1.5 && uDebug < 2.5) { if (max(abs(d.x), abs(d.y)) < 1.5) acc += vec3(1.0); continue; }
    float th = 0.6 * uUnit;
    float ax = max(0.0, 1.0 - abs(d.x) / arm), ay = max(0.0, 1.0 - abs(d.y) / arm);
    float armH = ax * ax * exp(-d.y * d.y / (th * th));
    float armV = ay * ay * exp(-d.x * d.x / (th * th));
    float core = exp(-dot(d, d) / (2.0 * uUnit * uUnit));
    vec3 tint = mix(vec3(1.0, 0.84, 0.48), hsv2rgb(vec3(hash12(M + 13.0), 0.55, 1.0)), 0.35);
    acc += (tint * (armH + armV) * 1.1 + vec3(core) * 1.3) * (0.6 + 0.4 * k);
  }
  return acc;
}
// Las estrellitas del prado: en lo de color vivo, cruces pequeñas del complementario cálido
// (naranja), muchas más y más chicas que las de las nubes.
vec3 sparks2(vec2 a, vec2 uv, vec2 seed, float wLayer) {
  vec3 acc = vec3(0.0);
  float cellM = 9.0 * uUnit;
  vec2 mi = floor(a / cellM);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cell = mi + vec2(float(i), float(j)), M = cell + seed + 517.0;
    if (hash12(M + 0.53) >= wLayer) continue;
    float p = pulseOf(M, uT, 0.0);
    if (p <= uMicro) continue;
    vec2 d = a - (cell + 0.15 + 0.7 * hash22(M + 9.1)) * cellM;
    float k = (p - uMicro) / (1.0 - uMicro);
    float arm = mix(2.5, 4.5, k) * uUnit;
    if (max(abs(d.x), abs(d.y)) > arm + uUnit) continue;
    vec2 suv = uv - d / uRes;
    vec3 sc = qAt(suv), sh = rgb2hsv(sc);
    if (sh.y < 0.45 || luma(sc) < uThr || gate(suv) < 0.5) continue;
    if (uDebug > 5.5) { if (max(abs(d.x), abs(d.y)) < 1.0) acc += vec3(1.0); continue; }
    float th = 0.5 * uUnit;
    float ax = max(0.0, 1.0 - abs(d.x) / arm), ay = max(0.0, 1.0 - abs(d.y) / arm);
    float cross = ax * exp(-d.y * d.y / (th * th)) + ay * exp(-d.x * d.x / (th * th));
    float core = exp(-dot(d, d) / (0.8 * uUnit * uUnit));
    acc += (vec3(1.0, 0.4, 0.08) * cross * 1.4 + vec3(1.0, 0.72, 0.4) * core * 1.4) * (0.6 + 0.4 * k);
  }
  return acc;
}
#else
vec3 gSpark, gZone; float gZoneK; vec2 gGrad;
void sparks(vec2 a, vec2 seed, float wLayer, float alive, float wave) {
  vec2 g = a / uCell; vec2 gi = floor(g); vec2 gf = g - gi;
  float sig = 0.42 * uCell;
  // donde la cresta es marcada, el destello es una rayita corta a lo largo de ella (la tangente)
  float gl = length(gGrad), stretch = 1.0 + 2.0 * smoothstep(0.03, 0.09, gl);
  vec2 t = gl > 1e-4 ? vec2(-gGrad.y, gGrad.x) / gl : vec2(1.0, 0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)), id = gi + o + seed;
    if (hash12(id + 0.37) >= wLayer) continue;
    vec2 r = (o + 0.15 + 0.7 * hash22(id) - gf) * uCell;
    if (dot(r, r) > 1.2 * stretch * stretch * uCell * uCell) continue;   // lejos: no llega
    float p = pulseOf(id, uT, wave);
    nearest(id, dot(r, r), p);
    if (hash12(id + 23.7) >= alive) continue;                    // solo los granos sobre crestas y picos
    r = vec2(dot(r, t) / stretch, dot(r, vec2(-t.y, t.x)));
    if (stretch < 1.3 && hash12(id + 29.1) < 0.3) r.y *= 0.45;   // algunos, rayitas verticales
    float r2 = dot(r, r);
    float shape = exp(-r2 / (sig * sig)) + exp(-r2 / (6.0 * sig * sig)) * 0.28;
    // blanco cian, cian, menta o rosa pálido, mezclado con el color de la zona (en las flores,
    // rosados; en la espuma, cian; en lo blanco, la paleta tal cual)
    float h = hash12(id + 11.3);
    vec3 sc = h < 0.35 ? vec3(0.847, 1.0, 1.0) : h < 0.55 ? vec3(0.54, 0.91, 1.0) : h < 0.75 ? vec3(0.44, 1.0, 0.878) : vec3(1.0, 0.753, 0.863);
    gSpark += mix(sc, gZone, gZoneK * (0.6 + 0.4 * hash12(id + 43.1))) * p * shape;
  }
}
// Cuadros grandes de luz, translúcidos y escasos, sobre los picos de luz.
vec4 squares(vec2 a, vec2 uv, vec2 seed, float wLayer) {
  vec4 acc = vec4(0.0);
  vec2 mi = floor(a / uMacro);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cell = mi + vec2(float(i), float(j)), M = cell + seed;
    if (hash12(M + 0.53) >= wLayer) continue;
    float p = pulseOf(M, uT * 0.8, 0.0);
    if (p <= uCross) continue;
    vec2 d = a - (cell + 0.2 + 0.6 * hash22(M + 9.1)) * uMacro;
    float hw = 6.5 * uUnit * mix(0.8, 1.25, hash12(M + 2.2));
    float box = max(abs(d.x), abs(d.y));
    if (box > hw + 1.0) continue;
    vec2 suv = uv - d / uRes;
    vec3 sc = qAt(suv);
    if (luma(sc) < uMacroL) continue;
    if (uDebug > 1.5 && uDebug < 2.5) { if (box < 1.5) acc = vec4(1.0); continue; }
    float k = (p - uCross) / (1.0 - uCross);
    float alpha = (1.0 - smoothstep(hw - 0.75, hw + 0.75, box)) * 0.45 * smoothstep(0.0, 0.35, k);
    if (alpha > acc.a) acc = vec4(mix(sc * 1.2 + 0.08, vec3(1.0, 0.97, 0.98), 0.5), alpha);
  }
  return acc;
}
#endif
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 aA = (uv + decD(texture2D(uA, uv))) * uRes, aB = (uv + decD(texture2D(uB, uv))) * uRes, aC = uv * uRes;
  vec2 sab = texture2D(uStretch, uv).rg;
  float wa = uWA * (1.0 - smoothstep(0.1, 0.32, sab.x));
  float wb = (1.0 - uWA) * (1.0 - smoothstep(0.1, 0.32, sab.y));
  float wc = max(0.0, 1.0 - wa - wb);
  vec2 sA = vec2(0.0), sB = vec2(173.0, 291.0), sC = vec2(-311.0, 97.0);
  nD = 1e9; nId = vec2(0.0); nPulse = 0.0;
  vec3 qc = qAt(uv);
  float L = luma(qc);
#if MAREA == 0
  vec4 scn = texture2D(uScene, vec2(0.5));
  gThrRel = unpack16(scn.rg); gThrW = unpack16(scn.ba) * 0.25;
  vec3 base = srcAt(uv);
  base = clamp(mix(vec3(luma(base)), base, 1.18), 0.0, 1.0);
  vec3 hsv = rgb2hsv(qc);
  float g = gate(uv);
  // La compuerta de luz. Lo claro y sin color (paredes, nubes) se mide CONTRA LA ESCENA: con una
  // cámara de verdad casi todo interior es claro y sin color, y con un umbral fijo brillaba el
  // cuadro entero; ahora, de fábrica, queda lisa más o menos la mitad más oscura. Lo que tiene
  // color de sobra (un prado, un vestido) sigue la regla fija: es figura aunque sea medio tono.
  float vivid = smoothstep(0.5, 0.75, hsv.y);
  float thrZ = mix(gThrRel, uThr, vivid), rampZ = mix(gThrW, 0.16, vivid);
  float mLuz = smoothstep(thrZ, thrZ + rampZ, L) * g;
  if (uDebug > 4.5 && uDebug < 5.5) { gl_FragColor = vec4(vec3(mLuz), 1.0); return; }
  // Alrededor: la luz cercana (sirve al resplandor y a las luces altas de la cara).
  vec2 hs = 6.0 * uUnit / uRes;
  float halo = 0.0, Lmax = 0.0, Lsum = L;
  for (int k = 0; k < 4; k++) {
    vec2 o = k == 0 ? vec2(hs.x, 0.0) : k == 1 ? vec2(-hs.x, 0.0) : k == 2 ? vec2(0.0, hs.y) : vec2(0.0, -hs.y);
    float l = luma(qAt(uv + o));
    halo += smoothstep(gThrRel + 0.1, gThrRel + 0.45, l) * l;
    Lmax = max(Lmax, l); Lsum += l;
  }
  // El borde deshilachado: en una banda de unos 8 px a cada lado de la compuerta, lo que baja es la
  // PROBABILIDAD de que haya grano (no su brillo); fuera de la forma quedan granos sueltos.
  float edgeP = smoothstep(thrZ - 0.08, thrZ + rampZ + 0.06, Lsum * 0.2) * g;
  // (el filo, donde la escena queda a media luz entre la nube y el cielo, cuenta ya como zona que
  // brilla: si no, asomaba una raya clara sin granos alrededor de la forma)
  float mSoft = max(mLuz, smoothstep(thrZ - 0.14, thrZ, L) * g * (1.0 - vivid));
  // La piel: una cara entera de lentejuela gruesa se veía como costra. En el tono medio de piel
  // la brillantina se vuelve iluminador: uno de cada cuatro granos, más finos, color champaña, y
  // la cara a la vista; el brillo fuerte queda en sus luces altas (frente, pómulo, nariz: picos
  // locales de luz, o lo más claro del cuadro).
  float skin = (1.0 - smoothstep(0.05, 0.1, min(abs(hsv.x - 0.055), 1.0 - abs(hsv.x - 0.055))))
             * smoothstep(0.15, 0.25, hsv.y) * (1.0 - smoothstep(0.62, 0.75, hsv.y)) * smoothstep(0.25, 0.4, hsv.z);
  // (pico de verdad: más claro que todo lo de alrededor; junto a una ceja oscura no cuenta)
  float lift = max(smoothstep(0.008, 0.04, L - Lmax), smoothstep(0.8, 0.94, L));
  float soften = skin * (1.0 - lift);
  // (la gente es figura: la piel lleva su iluminador aunque la compuerta de la escena la deje fuera)
  mLuz = max(mLuz, 0.8 * skin * smoothstep(uThr, uThr + 0.16, L) * g);
  float keep = 1.0 - 0.75 * soften, fine = mix(1.0, 0.75, soften);
  gTop = vec4(0.0); gTopArc = vec3(0.0); gHalo = 0.0; gGlow = 0.0; gCov = 0.0;
  grains(aA, sA, wa, keep, fine, max(edgeP, mSoft));
  grains(aB, sB, wb, keep, fine, max(edgeP, mSoft));
  if (wc > 0.01) grains(aC, sC, wc, keep, fine, max(edgeP, mSoft));
  if (uDebug > 0.5 && uDebug < 1.5) { gl_FragColor = vec4(vec3(hash12(nId * 1.618 + 4.2)), 1.0); return; }
  if (uDebug > 2.5 && uDebug < 3.5) { gl_FragColor = vec4(vec3(nPulse), 1.0); return; }
  // Poco color → diamantina arcoíris; mucho color → lentejuela de su color (los medios abren el arcoíris).
  float wArc = clamp(1.0 - smoothstep(0.15, 0.42, hsv.y) + uArc * 0.45 * exp(-pow((L - 0.45) / 0.2, 2.0)), 0.0, 1.0);
  vec3 colOwn = hsv2rgb(vec3(hsv.x, clamp(hsv.y * 1.05, 0.55, 1.0), clamp(hsv.z * 0.7, 0.18, 0.7)));
  colOwn = mix(colOwn, vec3(1.0, 0.88, 0.72) * clamp(hsv.z * 1.2, 0.3, 1.0), 0.55 * skin);
  // La chispa cálida: oro o naranja (si el color ya es cálido, oro pálido casi blanco).
  float warmBase = 1.0 - smoothstep(0.10, 0.17, min(abs(hsv.x - 0.07), 1.0 - abs(hsv.x - 0.07)));
  vec3 colWarm = hsv2rgb(vec3(0.03, mix(0.45, 0.25, warmBase), 1.0));
  // (los granos sueltos fuera de la forma toman la luz de la nube de al lado, no la del cielo:
  // si no, salían motas oscuras sobre el cielo)
  float Lg = max(L, Lmax * 0.9 * (1.0 - mLuz));
  float kL = 0.1 + 0.35 * Lg, tb = gTop.x, tr = gTop.y, tp = gTop.z, tw = gTop.w;
  // (el grano en su pico de pulso destella casi blanco: son esos puntos los que hacen brillar la nube)
  vec3 arc = (gTopArc * tr * kL + mix(gTopArc, vec3(1.0), 0.3) * tp * uPulseK) * tb + gTopArc * gHalo * kL * 0.6;
  vec3 own = mix(colOwn * (tr * 0.85 + tp * 0.6), colWarm * (tr * kL * 0.6 + tp * 0.7), tw) * tb + colOwn * gHalo * 0.5;
  vec3 grain = (mix(own, arc, wArc) + vec3(1.0, 0.96, 0.88) * gGlow * mix(0.1, 0.18, wArc)) * mix(1.0, 0.6, soften);
  float spill = mSoft, gg = g * step(0.001, max(edgeP, mLuz));         // (el grano que está, está entero)
  // Las lentejuelas tapan lo que tienen debajo (son opacas): sin esto, una chispa naranja sobre el
  // prado verde se sumaba en amarillo y la nube se lavaba de blanco.
  // (lo de debajo se apaga también en el filo, donde la luz de la escena queda a medias: si no, el
  // borde claro de la nube asomaba como un contorno; lo oscuro de alrededor no se toca)
  // Debajo de los granos, la escena bajada justo hasta la compuerta (lo más claro se comprime a
  // ese nivel): así el filo de una nube, que ya está a media luz, no asoma como contorno claro ni
  // deja un anillo oscuro alrededor.
  float thrBed = mix(gThrRel, uThr, smoothstep(0.5, 0.75, rgb2hsv(base).y));       // (con el color del píxel mismo)
  float bedK = min(1.0, (thrBed * 0.95 + 0.04) / max(luma(base), 0.02));
  vec3 under = base * mix(mix(1.0, bedK * mix(1.0, uBedK, wArc), max(mLuz, spill)), 0.9, skin);
  // (entre lentejuela y lentejuela, en la diamantina, el fondo lleva el color de la manchita de
  // alrededor: en la referencia el hueco es azul, rosa o malva, no gris)
  vec2 pg = aA / (uCell * 3.0) - 0.5, pi = floor(pg), pf = smoothstep(0.0, 1.0, pg - pi);
  vec3 tint = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2));
    float h = texture2D(uHues, vec2(hash12(pi + o + 83.1) * 0.984 + 0.008, 0.5)).r;
    tint += hsv2rgb(vec3(h, 0.5, 1.0)) * mix(1.0 - pf.x, pf.x, o.x) * mix(1.0 - pf.y, pf.y, o.y);
  }
  under = mix(under, tint * luma(under) * 1.15, 0.35 * wArc * mLuz * (1.0 - skin));
  vec3 col = under * (1.0 - mix(0.75, 0.0, skin) * min(1.0, gCov) * gg * max(mSoft, 0.15)) + grain * gg;
  // las estrellitas naranjas del prado (solo donde hay color vivo)
  vec3 spk = vec3(0.0);
  if (vivid > 0.01 || uDebug > 5.5) {
    vec3 sp = sparks2(aA, uv, sA, wa) + sparks2(aB, uv, sB, wb);
    if (wc > 0.01) sp += sparks2(aC, uv, sC, wc);
    if (uDebug > 5.5) { gl_FragColor = vec4(min(sp, vec3(1.0)), 1.0); return; }
    col = col * (1.0 - min(1.0, luma(sp) * 1.4) * 0.8) + sp;      // (tapan el verde: si no, salían amarillas)
    spk = sp;
  }
  vec3 st = stars(aA, uv, sA, wa) + stars(aB, uv, sB, wb);
  if (wc > 0.01) st += stars(aC, uv, sC, wc);
  if (uDebug > 1.5 && uDebug < 2.5) { gl_FragColor = vec4(min(st, vec3(1.0)), 1.0); return; }
  col += st;
  // (en el canal alfa va cuánto de este punto es brillantina encendida: de ahí, y solo de ahí, sale
  // el resplandor; una cara o una pared lisa y clara no deben resplandecer)
  glowSrc = clamp(max(min(1.0, gCov) * gg * mix(1.0, 0.15, soften), luma(st) * 2.0 + luma(spk) * 2.0), 0.0, 1.0);
#else
  // Base: pictórica (la imagen a un cuarto, suavizada) y de noche: más oscura pero SATURADA (los
  // rosas y los cian siguen vivos); el frío azul petróleo solo entra en las sombras.
  vec3 src = srcAt(uv);
  // la base a baja resolución, ampliada a bloques sin suavizar (como el video de la referencia);
  // los destellos van encima a resolución completa
  vec2 bc = (floor(uv * uRes / uBlock) + 0.5) * uBlock / uRes;
  vec3 soft = mix(srcAt(bc), qAt(bc), 0.6);
  float ls = luma(soft);
  vec3 vivid = clamp(mix(vec3(ls), soft, 1.25), 0.0, 1.0);
  float shade = 1.0 - smoothstep(0.06, 0.5, ls);
  vec3 night = pow(vivid, vec3(1.22)) * 0.8;
  night = night * mix(vec3(1.0), vec3(0.62, 0.9, 1.12), shade) + vec3(0.008, 0.03, 0.05) * shade;
  // Cresta: diferencia de gaussianas positiva más gradiente.
  vec2 s3 = uQStep * 3.0;
  float wr = luma(qAt(uv + vec2(s3.x, 0.0))), wl = luma(qAt(uv - vec2(s3.x, 0.0))), wd = luma(qAt(uv + vec2(0.0, s3.y))), wu = luma(qAt(uv - vec2(0.0, s3.y)));
  float Lw = 0.25 * (wr + wl + wd + wu);
  float gx = luma(qAt(uv + vec2(uQStep.x, 0.0))) - luma(qAt(uv - vec2(uQStep.x, 0.0)));
  float gy = luma(qAt(uv + vec2(0.0, uQStep.y))) - luma(qAt(uv - vec2(0.0, uQStep.y)));
  float crest = max(0.0, L - Lw) * 4.5 + length(vec2(gx, gy)) * 1.6;
  // (la luz se mira también en el píxel: una cresta fina se diluye al reducir y quedaba a oscuras)
  float cm = smoothstep(uCrest, uCrest + 0.22, crest) * smoothstep(uThr, uThr + 0.16, max(L, luma(src)));
  // Y no solo en los bordes: dentro de lo claro con textura (espuma, flores), cada pico local de
  // luz puede soltar su destello; así salen campos de puntos sueltos además de los collares.
  // (Una zona lisa no tiene picos: queda limpia.)
  // (pico de verdad: más claro que su alrededor y casi sin pendiente; el borde de una mancha lisa
  // tiene pendiente y ese ya es cosa del collar)
  vec3 zh = rgb2hsv(luma(src) > L ? src : qc);
  // (en nubes grises el campo casi no entra: allí los puntos van en hileras sobre el contorno de
  // cada lóbulo; el campo es para lo claro de verdad —espuma— o con color —flores—)
  float field = smoothstep(0.025, 0.06, max(0.0, L - Lw)) * (1.0 - smoothstep(0.04, 0.12, length(vec2(gx, gy))))
              * smoothstep(uThr + 0.05, uThr + 0.3, L) * 0.45 * max(smoothstep(uThr + 0.25, uThr + 0.45, L), 0.5 * smoothstep(0.3, 0.5, zh.y));
  // en nubes grises (poco color, luz media) los puntos van más escasos y solo en los bordes netos:
  // hileras finas sobre el contorno de cada lóbulo, no la nube llena
  float grayMid = (1.0 - smoothstep(0.25, 0.45, zh.y)) * (1.0 - smoothstep(uThr + 0.25, uThr + 0.45, L));
  cm *= mix(1.0, smoothstep(uCrest + 0.15, uCrest + 0.45, crest) * 0.55, grayMid);
  float alive = max(cm, field) * mix(0.55, 1.0, uDens) * (1.0 - 0.5 * smoothstep(0.35, 0.6, zh.y));   // (en las flores, pocos: allí van los cuadros)
  // (el color de la zona se toma del punto mismo: en un macizo de flores, el rosa de la flor y no
  // la mezcla con las hojas)
  gZone = hsv2rgb(vec3(zh.x, min(1.0, zh.y * 1.3 + 0.15), 1.0));
  gGrad = vec2(wr - wl, wd - wu) / 3.0;          // (la pendiente a escala ancha: la de la cresta, no la de cada grumo)
  gZoneK = 0.75 * smoothstep(0.08, 0.35, zh.y);
  gSpark = vec3(0.0);
  sparks(aA, sA, wa, alive, 1.6 * sin(dot(aA, vec2(0.021, 0.013)) / uUnit - uWave));
  sparks(aB, sB, wb, alive, 1.6 * sin(dot(aB, vec2(0.021, 0.013)) / uUnit - uWave));
  if (wc > 0.01) sparks(aC, sC, wc, alive, 1.6 * sin(dot(aC, vec2(0.021, 0.013)) / uUnit - uWave));
  if (uDebug > 0.5 && uDebug < 1.5) { gl_FragColor = vec4(vec3(hash12(nId * 1.618 + 4.2)), 1.0); return; }
  if (uDebug > 2.5 && uDebug < 3.5) { gl_FragColor = vec4(vec3(nPulse), 1.0); return; }
  vec3 spark = gSpark * uBright;
  vec4 sq = squares(aA, uv, sA, wa);
  vec4 sqB = squares(aB, uv, sB, wb);
  if (sqB.a > sq.a) sq = sqB;
  if (wc > 0.01) { vec4 sqC = squares(aC, uv, sC, wc); if (sqC.a > sq.a) sq = sqC; }
  if (uDebug > 1.5 && uDebug < 2.5) { gl_FragColor = vec4(vec3(sq.a), 1.0); return; }
  if (uDebug > 3.5) { gl_FragColor = vec4(min(spark, vec3(1.0)), 1.0); return; }
  vec3 col = mix(night + spark, sq.rgb, sq.a);
#endif
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), glowSrc);
}`;

  let canvas = null, gl = null, failed = false, lost = 0, res = null;
  const paths = {};
  // Relojes compartidos por visor y grabación (la foto sale con el brillo del instante).
  const S = { wall: 0, stepPhase: 0, wave: 0, last: {}, previewReal: -1e9, beat: 0, beatAt: null, fps: 0 };
  const stats = { frames: 0, ms: 0, variant: '', size: [0, 0], grid: [0, 0], anchors: [0, 0], cell: 0, wA: 0, persona: 0, flow: true };

  function program(frag) {
    const make = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('CHISPA: ' + gl.getShaderInfoLog(shader));
      return shader;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('CHISPA: ' + gl.getProgramInfoLog(prog));
    const u = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) { const name = gl.getActiveUniform(prog, i).name; u[name] = gl.getUniformLocation(prog, name); }
    return { prog, u };
  }
  function texture(filter, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }
  // El reparto de matices de la diamantina, medido en las nubes de la referencia (doce tramos de
  // 30°, del rojo al magenta): mucho naranja y amarillo, mucho azul, poco verde. La tabla da, para
  // un azar de 0 a 1, el matiz que le toca (la inversa de ese reparto).
  const HUES = [0.26, 0.15, 0.08, 0.025, 0.012, 0.03, 0.075, 0.3, 0.13, 0.025, 0.03, 0.04];
  function hueTable() {
    const total = HUES.reduce((a, x) => a + x, 0), out = new Uint8Array(64 * 4);
    for (let i = 0; i < 64; i++) {
      let q = (i + 0.5) / 64 * total, k = 0;
      while (k < 11 && q > HUES[k]) { q -= HUES[k]; k++; }
      const v = Math.round(((k + Math.min(1, q / HUES[k])) / 12) * 255);
      out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = v; out[4 * i + 3] = 255;
    }
    return out;
  }
  // Una textura a la que se puede pintar, ya limpia con el color dado (el «cero» de cada código).
  function target(w, h, filter, clear) {
    const t = { tex: texture(filter, w, h), fbo: gl.createFramebuffer(), w, h };
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    if (clear) { gl.viewport(0, 0, w, h); gl.clearColor(clear[0], clear[1], clear[2], clear[3]); gl.clear(gl.COLOR_BUFFER_BIT); }
    return t;
  }
  function drop(t) { if (t && gl) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }
  // Texturas de trabajo del tamaño de la salida (visor y foto se turnan: se rehacen si cambia).
  function sized(key, w, h) {
    const t = res.sized[key];
    if (t && t.w === w && t.h === h) return t;
    drop(t);
    return (res.sized[key] = target(w, h, gl.LINEAR));
  }
  const ZERO_D = [127 / 255, 0.5, 127 / 255, 0.5];      // desplazamiento cero
  const ZERO_F = [128 / 255, 128 / 255, 0, 0];          // flujo cero, sin confianza

  function init() {
    if (gl) return true;
    if (failed) return false;
    try {
      canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
      gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('CHISPA: sin WebGL');
      // Si el sistema retira la gráfica (al volver de segundo plano), la siguiente vuelta la rehace.
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost++; gl = null; canvas = null; res = null; for (const k of Object.keys(paths)) delete paths[k]; });
      res = {
        quarter: program(QUARTER), lum: program(LUM), flow: program(FLOW), smooth: program(SMOOTH), advect: program(ADVECT), stretch: program(STRETCH), cdf: program(CDF), thresh: program(THRESH), glowDown: program(GLOW_DOWN), glowBlur: program(GLOW_BLUR), glowAdd: program(GLOW_ADD), sized: {},
        final: [program(FINAL(0)), program(FINAL(1))],
        src: texture(gl.LINEAR), mask: texture(gl.LINEAR), maskOf: null,
      };
      gl.bindTexture(gl.TEXTURE_2D, res.mask);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      res.cdfT = target(64, 1, gl.NEAREST);
      res.scene = [target(1, 1, gl.NEAREST, [0.3, 0, 0.64, 0]), target(1, 1, gl.NEAREST, [0.3, 0, 0.64, 0])];
      res.sceneI = 0;
      SC.step = null;
      res.hues = texture(gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, hueTable());
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      return true;
    } catch (error) {
      console.warn(error && error.message || error);
      failed = true; gl = null; canvas = null; res = null;
      return false;
    }
  }

  // Rejilla de flujo: 64 en el lado largo; la de anclaje, el doble.
  const gridFor = (w, h) => (w >= h ? [GRID, Math.max(16, Math.round(GRID * h / w))] : [Math.max(16, Math.round(GRID * w / h)), GRID]);
  // Cada camino (visor y grabación) lleva su propia memoria de movimiento: grabar no le mueve el
  // anclaje al visor ni al revés.
  function pathState(path, W, H, now, mirror) {
    const [fw, fh] = gridFor(W, H);
    const qk = Math.min(1, 480 / (Math.max(W, H) / 4));
    const qw = Math.max(8, Math.round(W / 4 * qk)), qh = Math.max(8, Math.round(H / 4 * qk));
    let P = paths[path];
    if (!P) P = paths[path] = { fw: 0, fh: 0, qw: 0, qh: 0, i: 0, last: null, lastC: null };
    if (P.fw !== fw || P.fh !== fh) {
      for (const t of [P.raw, P.flow, P.st, ...(P.lum || []), ...(P.A || []), ...(P.B || [])]) drop(t);
      P.lum = [target(fw, fh, gl.NEAREST), target(fw, fh, gl.NEAREST)];
      P.raw = target(fw, fh, gl.NEAREST, ZERO_F);
      P.flow = target(fw, fh, gl.NEAREST, ZERO_F);
      P.A = [target(fw * 2, fh * 2, gl.LINEAR, ZERO_D), target(fw * 2, fh * 2, gl.LINEAR, ZERO_D)];
      P.B = [target(fw * 2, fh * 2, gl.LINEAR, ZERO_D), target(fw * 2, fh * 2, gl.LINEAR, ZERO_D)];
      P.st = target(fw * 2, fh * 2, gl.LINEAR, [0, 0, 0, 1]);
      P.fw = fw; P.fh = fh; P.last = null;
    }
    if (P.qw !== qw || P.qh !== qh) { drop(P.q); P.q = target(qw, qh, gl.LINEAR); P.qw = qw; P.qh = qh; }
    // Sin cuadros un rato, con el reloj hacia atrás o con el espejo cambiado, el movimiento medido
    // ya no vale: se empieza de cero.
    P.fresh = P.last == null || now < P.last || now - P.last > 500 || P.mirror !== mirror;
    P.last = now; P.mirror = mirror;
    return P;
  }

  function useProgram(p, t, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : w, t ? t.h : h);
    gl.useProgram(p.prog);
    return p.u;
  }
  function bind(unit, tex, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); if (loc) gl.uniform1i(loc, unit); }
  const drawQuad = () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // La máscara de persona: la que venga en las opciones o la del detector compartido.
  function personMask(o, source, crop, mirror, marea) {
    // (MAREA no la usa: es una atmósfera de agua y luz; recortar a la persona rompe la inmersión)
    const mode = marea ? 0 : o.persona === 'PERSONA' ? 1 : o.persona === 'FONDO' ? 2 : (o.mask ? 1 : 0);
    if (!mode) return 0;
    let m = o.mask || null;
    if (!m && typeof flipSilhouette !== 'undefined') {
      flipSilhouette.start();
      flipSilhouette.push(source, crop[0], crop[1], crop[2], crop[3], mirror);
      m = flipSilhouette.latest(1200);
    }
    // (sin máscara todavía —el detector carga—, la brillantina va en todo)
    if (!m || !m.data || !m.width || !m.height) return 0;
    if (res.maskOf !== m || res.maskSeq !== m.seq) {
      const n = m.width * m.height, bytes = new Uint8Array(n * 4), d = m.data, scale = d instanceof Float32Array || d instanceof Float64Array ? 255 : 1;
      for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, d[i] * scale)); bytes[4 * i] = bytes[4 * i + 1] = bytes[4 * i + 2] = v; bytes[4 * i + 3] = 255; }
      gl.bindTexture(gl.TEXTURE_2D, res.mask);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, m.width, m.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      res.maskOf = m; res.maskSeq = m.seq;
    }
    return mode;
  }

  // ── La luz de la escena (LENTEJA) ─────────────────────────────────────────────────────────
  // umbral → qué parte del cuadro (la más oscura) queda lisa: 0 nada, 0,18 (fábrica) la mitad, 0,65 el 95 %.
  // (la cuenta se hace en la gráfica, ver CDF y THRESH; aquí solo el paso de brillo con que se sigue)
  const shareFor = u => (u <= 0.18 ? 0.5 * u / 0.18 : Math.min(0.97, 0.5 + 0.45 * (u - 0.18) / 0.47));
  const SC = { step: null };

  function audioOf(o, dt) {
    const a = o.audio || null;
    const bass = a ? clamp(num(a.bass, 0)) : 0, mid = a ? clamp(num(a.mid, 0)) : 0, treble = a ? clamp(num(a.treble, num(a.high, 0))) : 0;
    // El golpe puede llegar como pulso (true un cuadro) o como envolvente que ya cae (la de ESCUCHA).
    const hit = a ? (typeof a.beat === 'number' ? clamp(a.beat) : a.beat ? 1 : 0) : 0;
    S.beat = Math.max(S.beat * Math.exp(-dt / 0.2), hit);
    return { bass, mid, treble, beat: S.beat };
  }

  function renderChispa(source, srcW, srcH, ctx, mirror, variant, options) {
    const o = options || {};
    const W = Math.max(1, Math.round(o.outW || ctx.canvas.width)), H = Math.max(1, Math.round(o.outH || ctx.canvas.height));
    if (!W || !H || !srcW || !srcH || !init()) return false;
    const started = performance.now();
    const v = variant === 'MAREA' ? 'MAREA' : 'LENTEJA', marea = v === 'MAREA', f = FABRICA[v];
    const path = o.path === 'capture' ? 'capture' : 'preview';
    const now = num(o.now, started);
    const dens = clamp(num(o.densidad, f.densidad)), thr = clamp(num(o.umbral, f.umbral), 0, 0.65);
    const cross = clamp(num(o.cruces, f.cruces)), anchor = clamp(num(o.anclaje, f.anclaje)), ritmo = clamp(num(o.ritmo, f.ritmo), 4, 18);

    // ── Relojes: el visor manda; la grabación solo avanza si no hay visor ──
    const last = S.last[path];
    S.last[path] = now;
    let dt = last == null ? 0 : (now - last) / 1000;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.1);
    if (path === 'preview') { if (dt > 0) S.fps = S.fps ? S.fps * 0.9 + 0.1 / dt : 1 / dt; S.previewReal = started; }
    const au = audioOf(o, dt);
    const lead = path === 'preview' || started - S.previewReal > 500;
    if (lead && dt > 0) {
      S.wall += dt;
      S.stepPhase += dt * (ritmo + 6 * au.bass);                     // el bajo acelera la cadencia (9 → 15)
      S.wave += dt * (ritmo / 9) * 1.4 * (1 + 1.5 * au.bass);        // el bajo empuja la marea
    }
    // LENTEJA vive a saltos: su tiempo (y el relevo de capas) solo cambia en cada paso.
    const tAnim = marea ? S.wall : Math.floor(S.stepPhase) / 9;
    const c = ((tAnim / CICLO) % 1 + 1) % 1, wA = Math.sin(Math.PI * c) ** 2;

    const unit = Math.min(W, H) / 380;                                 // los tamaños son proporcionales al cuadro
    const cell = (marea ? 2.2 - 0.6 * dens : 2.8 - 0.8 * dens) * unit;
    const macro = (marea ? 34 : 20) * unit;
    const crop = typeof cropCoordsForDims === 'function' ? cropCoordsForDims(srcW, srcH, W, H) : [0, 0, srcW, srcH];
    const [sx, sy, sw, sh] = crop;
    let P;
    try {
      P = pathState(path, W, H, now, !!mirror);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (error) {
      // Una fuente que aún no tiene imagen: este cuadro no se pinta, el siguiente sí.
      return !!gl;
    }
    const cropU = mirror ? [(sx + sw) / srcW, sy / srcH, -sw / srcW, sh / srcH] : [sx / srcW, sy / srcH, sw / srcW, sh / srcH];
    const maskMode = personMask(o, source, crop, !!mirror, marea);
    if (canvas.width < W || canvas.height < H) { canvas.width = Math.max(canvas.width, W); canvas.height = Math.max(canvas.height, H); }

    // 1 · Cuarto.
    let u = useProgram(res.quarter, P.q);
    bind(0, res.src, u.uSrc);
    gl.uniform4fv(u.uCrop, cropU);
    gl.uniform2f(u.uStep, cropU[2] / P.qw, cropU[3] / P.qh);
    drawQuad();

    // 2–4 · Movimiento (con anclaje 0 los granos van pegados a la pantalla: ni se mide).
    const cur = P.i, prev = 1 - P.i;
    const moving = anchor > 0.001, freshFlow = P.fresh || !P.wasMoving;
    P.wasMoving = moving;
    if (moving) {
      u = useProgram(res.lum, P.lum[cur]);
      bind(0, res.src, u.uSrc);
      gl.uniform4fv(u.uCrop, cropU);
      gl.uniform2f(u.uStep, cropU[2] / P.fw, cropU[3] / P.fh);
      drawQuad();
      u = useProgram(res.flow, P.raw);
      bind(0, P.lum[cur].tex, u.uCur);
      bind(1, P.lum[freshFlow ? cur : prev].tex, u.uPrev);
      bind(2, P.flow.tex, u.uPred);
      gl.uniform2f(u.uGrid, P.fw, P.fh);
      gl.uniform1f(u.uUsePred, freshFlow ? 0 : 1);
      drawQuad();
      u = useProgram(res.smooth, P.flow);
      bind(0, P.raw.tex, u.uRaw);
      gl.uniform2f(u.uGrid, P.fw, P.fh);
      drawQuad();
    }
    // 5 · Anclaje: cada capa se reinicia cuando su peso pasa por cero.
    let resetA = P.fresh, resetB = P.fresh;
    if (P.lastC != null && !P.fresh) {
      const back = c < P.lastC, jump = Math.abs(c - P.lastC) > 0.5 && !back;
      if (back || jump) resetA = true;
      if ((P.lastC < 0.5 && c >= 0.5) || (back && c >= 0.5) || jump) resetB = true;
    }
    P.lastC = c;
    for (const [layer, reset] of [[P.A, resetA], [P.B, resetB]]) {
      u = useProgram(res.advect, layer[1 - cur]);
      bind(0, layer[cur].tex, u.uAnc);
      bind(1, P.flow.tex, u.uFlow);
      gl.uniform2f(u.uGrid, P.fw, P.fh);
      gl.uniform1f(u.uK, moving && !freshFlow ? anchor : 0);
      gl.uniform1f(u.uReset, reset ? 1 : 0);
      drawQuad();
    }

    u = useProgram(res.stretch, P.st);
    bind(0, P.A[1 - cur].tex, u.uA);
    bind(1, P.B[1 - cur].tex, u.uB);
    gl.uniform2f(u.uAnc, P.fw * 2, P.fh * 2);
    gl.uniform2f(u.uRes, W, H);
    drawQuad();

    // 5c · La luz de la escena (LENTEJA): se recuenta en cada paso de brillo y se sigue despacio;
    //      entre pasos no cambia (así no rompe el salto a 9 por segundo). La foto no recuenta: usa
    //      la del visor, que es la que se estaba viendo.
    if (!marea) {
      const step = Math.floor(S.stepPhase), cold = P.fresh && path === 'preview', lead = path === 'preview' || started - S.previewReal > 500;
      let k = 0;
      if (cold || SC.step == null || Math.abs(step - SC.step) > 30) k = 1;
      else if (step !== SC.step) k = 1 - Math.pow(0.75, step - SC.step);
      if (lead && k > 0) {
        u = useProgram(res.cdf, res.cdfT);
        bind(0, P.q.tex, u.uQ);
        drawQuad();
        const from = res.scene[res.sceneI], to = res.scene[1 - res.sceneI];
        u = useProgram(res.thresh, to);
        bind(0, res.cdfT.tex, u.uCdf);
        bind(1, from.tex, u.uPrev);
        gl.uniform1f(u.uShare, shareFor(thr));
        gl.uniform1f(u.uFloor, Math.min(0.08, thr * 0.5));
        gl.uniform1f(u.uK, k);
        drawQuad();
        res.sceneI = 1 - res.sceneI;
      }
      if (lead) SC.step = step;
    }

    // 6 · Final.
    const fin = res.final[marea ? 1 : 0], debug = { facetas: 1, cruces: 2, cuadros: 2, pulso: 3, destellos: 4, compuerta: 5, estrellitas: 6 }[o.debug] || 0;
    const glow = !marea && !debug;
    const full = glow ? sized('full', W, H) : null;
    u = useProgram(fin, full, W, H);
    bind(0, res.src, u.uSrc);
    bind(1, P.q.tex, u.uQ);
    bind(2, P.A[1 - cur].tex, u.uA);
    bind(3, P.B[1 - cur].tex, u.uB);
    bind(4, res.mask, u.uMask);
    bind(5, P.st.tex, u.uStretch);
    bind(6, res.hues, u.uHues);
    bind(7, res.scene[res.sceneI].tex, u.uScene);
    gl.uniform1f(u.uBlock, Math.max(2, Math.round(Math.sqrt(W * H) * 0.011)));
    gl.uniform4fv(u.uCrop, cropU);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform2f(u.uQStep, 1 / P.qw, 1 / P.qh);
    gl.uniform1f(u.uT, tAnim);
    gl.uniform1f(u.uWA, wA);
    gl.uniform1f(u.uCell, cell);
    gl.uniform1f(u.uMacro, macro);
    gl.uniform1f(u.uUnit, unit);
    gl.uniform1f(u.uDens, clamp(dens + 0.25 * au.treble));               // los agudos, más granos encendidos
    gl.uniform1f(u.uThr, thr);
    if (marea) {
      gl.uniform1f(u.uCross, clamp(0.85 - 0.2 * cross - 0.12 * au.beat, 0.4, 0.99));    // el golpe salpica cuadros
      gl.uniform1f(u.uMacroL, clamp(0.5 - 0.2 * cross - 0.1 * au.beat, 0.2, 0.95));
      gl.uniform1f(u.uCrest, Math.max(0.02, 0.12 - 0.12 * au.mid));     // los medios llenan más crestas
      gl.uniform1f(u.uBright, 1.4 + 0.5 * au.treble);
      gl.uniform1f(u.uWave, S.wave);
    } else {
      gl.uniform1f(u.uCross, clamp(0.92 - 0.52 * cross - 0.42 * au.beat, 0.12, 0.99));   // el golpe enciende una oleada de cruces
      gl.uniform1f(u.uArc, au.mid);
      gl.uniform1f(u.uMicro, clamp(0.84 - 0.14 * cross - 0.2 * au.beat, 0.4, 0.99));
      gl.uniform1f(u.uPulseK, LUZ.pulso);
      gl.uniform1f(u.uBedK, LUZ.fondo);
    }
    gl.uniform1f(u.uMaskMode, maskMode);
    gl.uniform1f(u.uDebug, debug);
    drawQuad();
    // 7 · Resplandor (LENTEJA): a un cuarto, emborronado en dos pasadas, y sumado.
    if (glow) {
      const gw = Math.max(4, Math.round(W / 4)), gh = Math.max(4, Math.round(H / 4)), g1 = sized('g1', gw, gh), g2 = sized('g2', gw, gh);
      u = useProgram(res.glowDown, g1); bind(0, full.tex, u.uTex); gl.uniform2f(u.uStep, 1 / gw, 1 / gh); drawQuad();
      u = useProgram(res.glowBlur, g2); bind(0, g1.tex, u.uTex); gl.uniform2f(u.uDir, 1 / gw, 0); drawQuad();
      u = useProgram(res.glowBlur, g1); bind(0, g2.tex, u.uTex); gl.uniform2f(u.uDir, 0, 1 / gh); drawQuad();
      u = useProgram(res.glowAdd, null, W, H); bind(0, full.tex, u.uFull); bind(1, g1.tex, u.uGlow); gl.uniform1f(u.uGlowK, LUZ.resplandor); drawQuad();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.drawImage(canvas, 0, canvas.height - H, W, H, 0, 0, W, H);
    ctx.restore();
    P.i = 1 - P.i;
    Object.assign(stats, { frames: stats.frames + 1, ms: performance.now() - started, variant: v, size: [W, H], grid: [P.fw, P.fh], anchors: [P.fw * 2, P.fh * 2], cell: +cell.toFixed(2), wA: +wA.toFixed(3), persona: maskMode, flow: moving, t: +tAnim.toFixed(3) });
    return true;
  }

  // Para las pruebas: el flujo medido (media en píxeles de salida por cuadro, solo donde hay confianza).
  function flowProbe(path, raw) {
    const P = paths[path || 'preview'];
    if (!gl || !P) return null;
    const n = P.fw * P.fh, px = new Uint8Array(n * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, (raw ? P.raw : P.flow).fbo);
    gl.readPixels(0, 0, P.fw, P.fh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // (sin las dos celdas del borde, por donde entra imagen nueva; mediana, que no la mueven los raros)
    const xs = [], ys = [];
    let sw = 0;
    for (let y = 2; y < P.fh - 2; y++) for (let x = 2; x < P.fw - 2; x++) {
      const i = y * P.fw + x, b = px[4 * i + 2], lx = b >> 4, ly = b & 15;
      xs.push(((px[4 * i] * 16 + lx) / 4095 - 0.5) * 8); ys.push(((px[4 * i + 1] * 16 + ly) / 4095 - 0.5) * 8); sw += px[4 * i + 3] / 255;
    }
    const med = a => a.sort((p, q) => p - q)[a.length >> 1];
    const [W, H] = stats.size;
    return { vx: med(xs) * W / P.fw, vy: med(ys) * H / P.fh, conf: sw / xs.length };
  }

  // Para las pruebas: la compuerta de la escena que está usando LENTEJA (lee la gráfica: solo pruebas).
  function sceneProbe() {
    if (!gl || !res) return null;
    const px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.scene[res.sceneI].fbo);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { thr: +((px[0] + px[1] / 255) / 255).toFixed(3), ancho: +((px[2] + px[3] / 255) / 255 * 0.25).toFixed(3) };
  }
  // Soltar la gráfica cuando la cámara deja de usarse.
  function release() {
    if (!gl) return;
    const ext = gl.getExtension('WEBGL_lose_context');
    const old = canvas;
    gl = null; canvas = null; res = null;
    for (const k of Object.keys(paths)) delete paths[k];
    try { if (ext) ext.loseContext(); } catch (_) {}
    if (old) { old.width = 1; old.height = 1; }
  }

  window.renderChispa = renderChispa;
  window.flipChispa = {
    FABRICA, release,
    state: () => ({ gl: !!gl, failed, lost, canvas: canvas ? [canvas.width, canvas.height] : null, fps: +S.fps.toFixed(1), beat: +S.beat.toFixed(3), ...stats, ms: +stats.ms.toFixed(2) }),
    _flow: flowProbe, _umbral: sceneProbe,
  };
})();
