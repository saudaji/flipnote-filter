// Mide tinte por zona tonal, niveles y caída radial de fotogramas de referencia.
// Uso: node measure-ref.cjs img1.jpg img2.jpg ...   (decodifica con ffmpeg a RGB crudo)
const { execFileSync } = require('node:child_process');
const path = require('node:path');
function load(file) {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number);
  const [w, h] = probe;
  const buf = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  return { w, h, buf };
}
function measure(file) {
  const { w, h, buf } = load(file);
  const lum = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) lum[p] = 0.299 * buf[p * 3] + 0.587 * buf[p * 3 + 1] + 0.114 * buf[p * 3 + 2];
  // Recorta barras negras (filas/columnas cuyo máximo es < 14).
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
  const rowMax = y => { let m = 0; for (let x = 0; x < w; x++) m = Math.max(m, lum[y * w + x]); return m; };
  const colMax = x => { let m = 0; for (let y = 0; y < h; y++) m = Math.max(m, lum[y * w + x]); return m; };
  while (y0 < h / 2 && rowMax(y0) < 14) y0++;
  while (y1 > h / 2 && rowMax(y1) < 14) y1--;
  while (x0 < w / 2 && colMax(x0) < 14) x0++;
  while (x1 > w / 2 && colMax(x1) < 14) x1--;
  const bins = [[0, 30], [30, 70], [70, 120], [120, 180], [180, 256]].map(([a, b]) => ({ a, b, n: 0, r: 0, g: 0, b2: 0 }));
  const values = [];
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, cx = x0 + cw / 2, cy = y0 + ch / 2;
  const rings = Array.from({ length: 5 }, () => ({ n: 0, s: 0 }));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const p = y * w + x, L = lum[p];
    values.push(L);
    const bin = bins.find(q => L >= q.a && L < q.b);
    bin.n++; bin.r += buf[p * 3]; bin.g += buf[p * 3 + 1]; bin.b2 += buf[p * 3 + 2];
    const rad = Math.min(0.999, Math.hypot((x - cx) / (cw / 2), (y - cy) / (ch / 2)) / Math.SQRT2);
    const ring = rings[Math.floor(rad * 5)]; ring.n++; ring.s += L;
  }
  values.sort((a, b) => a - b);
  const pct = q => Math.round(values[Math.floor(q * (values.length - 1))]);
  const tone = bins.map(q => q.n < 200 ? null : { zona: q.a + '-' + q.b, pct: +(100 * q.n / values.length).toFixed(1), rgb: [q.r / q.n, q.g / q.n, q.b2 / q.n].map(Math.round), 'R/G': +(q.r / q.g).toFixed(2), 'B/G': +(q.b2 / q.g).toFixed(2) }).filter(Boolean);
  return { archivo: path.basename(file), recorte: [cw, ch], p1: pct(0.01), p5: pct(0.05), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), anillos: rings.map(r => Math.round(r.s / Math.max(1, r.n))), tono: tone };
}
for (const file of process.argv.slice(2)) {
  const m = measure(file);
  console.log(`\n${m.archivo}  recorte ${m.recorte.join('x')}  p1/p5/p50/p95/p99 = ${m.p1}/${m.p5}/${m.p50}/${m.p95}/${m.p99}  anillos centro→esquina = ${m.anillos.join(' ')}`);
  for (const t of m.tono) console.log(`   L ${t.zona.padEnd(8)} ${String(t.pct).padStart(5)}%  rgb(${t.rgb.join(',')})  R/G ${t['R/G']}  B/G ${t['B/G']}`);
}
