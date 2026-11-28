// El icono de la app: la cámara que guiña, en tres capas descuadradas (verde, mandarina y azul)
// sobre negro, como una tirada con el registro corrido. El ojo abierto es una lente: aro claro y
// cristal oscuro. Escribe los SVG y sus PNG en
// docs/brand/rollo-en-anil/app/ (y el avatar para redes, en comunicacion/).
// Los PNG de la mascota (maestro, any, maskable, avatar) llevan el canto de cada capa comido por el
// grano, como las piezas y el disparador de la piel INTERFAZ (docs/silueta.js: misma fórmula de
// pluma, temblor y mordida). Aquí el grano no mide un punto de la pantalla sino un punto del icono
// a 192: escala con el icono, así a 512 o a 1024 se ve el mismo material que a 192, y a los 48–60 px
// de la pantalla de inicio el canto se lee sin ensuciar la forma. Los ojos quedan nítidos. Los SVG
// son el dibujo vectorial (sin el canto); 16 y 32 se quedan como estaban (ahí no cabe).
//   node design/app-icon/icono.cjs [carpeta de salida]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'docs', 'brand', 'rollo-en-anil', 'app'));

const FONDO = '#0B0C14', VERDE = '#7DDB8B', MANDARINA = '#F77F50', AZUL = '#3D5FE6', OJO = '#FFF3DC', PUPILA = '#151727';
const CUERPO = 'M6 27Q7 18 17 17H19L23 11Q25 8 29 8H42Q47 8 49 13L51 17Q58 18 59 25L61 40Q63 53 51 55L18 59Q7 60 5 49L4 39Q3 32 6 27Z';
const GUINO = 'M13 35Q20 27 29 32Q33 35 30 38Q28 40 25 38Q21 35 17 39Q13 40 13 35Z';
const PASO = [4.4, 4.8];                       // lo que se corre cada capa, en unidades del símbolo (64)

// El símbolo apilado, centrado en un lienzo de «size» y ocupando «span» de su ancho.
function pila(size, span) {
  const w = 58 + PASO[0] * 2, h = 52 + PASO[1] * 2;          // caja del símbolo: x 3–61, y 8–60
  const k = size * span / w;
  const tx = (size - w * k) / 2 - 3 * k, ty = (size - h * k) / 2 - 8 * k;
  const capa = (i, color) => `<path transform="translate(${(PASO[0] * i).toFixed(2)} ${(PASO[1] * i).toFixed(2)})" d="${CUERPO}" fill="${color}"/>`;
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(4)})">${capa(2, AZUL)}${capa(1, MANDARINA)}${capa(0, VERDE)}` +
    `<path d="${GUINO}" fill="${OJO}"/><circle cx="43" cy="34" r="8" fill="${OJO}"/><circle cx="43" cy="34" r="4.3" fill="${PUPILA}"/></g>`;
}
const svg = (size, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">\n  <title>${title}</title>\n  ${body}\n</svg>\n`;
// El grano mate de la interfaz (docs/body/grano.webp), encima de todo el icono. En el SVG que se
// guarda apunta a la tesela del repositorio; al sacar cada PNG se incrusta y se escala para que una
// mota mida un píxel de ese tamaño (si no, a 192 se promediaría y a 1024 saldría en bloques).
const TESELA = 'GRANO_HREF', LADO = 'GRANO_LADO';
const grano = (size, rx) => `<defs><pattern id="grano" width="${LADO}" height="${LADO}" patternUnits="userSpaceOnUse"><image href="${TESELA}" width="${LADO}" height="${LADO}"/></pattern></defs>` +
  `<rect width="${size}" height="${size}" rx="${rx}" fill="url(#grano)"/>`;
const conGrano = (text, href, lado) => text.split(TESELA).join(href).split(LADO).join(String(lado));
// A 16 y 32 px el símbolo va dibujado a la rejilla; a 16 no caben las capas ni el grano.
const G16 = 'M2 7Q2 5 4 5H5L6 3H10L11 5H13Q14 5 14 7V12Q14 14 12 14H4Q2 14 2 12Z';
const G32 = 'M4 13Q4 9 8 9H10L12 5H20L22 9H25Q28 9 28 13V23Q28 28 23 28H8Q4 28 4 24Z';
const files = {
  'maestro.svg': svg(1024, 'FLIP · maestro', `<rect width="1024" height="1024" rx="188" fill="${FONDO}"/>${pila(1024, 0.70)}${grano(1024, 188)}`),
  'maskable.svg': svg(1024, 'FLIP · maskable', `<rect width="1024" height="1024" fill="${FONDO}"/>${pila(1024, 0.54)}${grano(1024, 0)}`),
  '../comunicacion/avatar.svg': svg(1080, 'FLIP · avatar', `<rect width="1080" height="1080" fill="${FONDO}"/>${pila(1080, 0.56)}${grano(1080, 0)}`),
  '16.svg': svg(16, 'FLIP óptico · 16 px', `<rect width="16" height="16" rx="2.88" fill="${FONDO}"/><path d="${G16}" fill="${VERDE}"/>` +
    `<path d="M4 9Q5.6 7.5 7 9L6.4 10.3Q5.5 9.7 4.6 10.3Z" fill="${OJO}"/><circle cx="10.35" cy="9.5" r="1.75" fill="${OJO}"/>`),
  '32.svg': svg(32, 'FLIP óptico · 32 px', `<rect width="32" height="32" rx="5.76" fill="${FONDO}"/><g transform="translate(1.2 0.6) scale(0.86)"><path transform="translate(4 4)" d="${G32}" fill="${AZUL}"/>` +
    `<path transform="translate(2 2)" d="${G32}" fill="${MANDARINA}"/><path d="${G32}" fill="${VERDE}"/><path d="M7 17Q10.5 13.5 14 17L13 19.5Q10.5 17.8 8 19.5Z" fill="${OJO}"/><circle cx="21.5" cy="18" r="3.6" fill="${OJO}"/><circle cx="21.5" cy="18" r="1.7" fill="${PUPILA}"/></g>`),
};
const pngs = [['maestro.svg', 'maestro.png', 1024], ['maestro.svg', 'any-512.png', 512], ['maestro.svg', 'any-192.png', 192], ['maskable.svg', 'maskable.png', 1024],
  ['maskable.svg', 'maskable-512.png', 512], ['maskable.svg', 'maskable-192.png', 192], ['../comunicacion/avatar.svg', '../comunicacion/avatar.png', 1080], ['16.svg', '16.png', 16], ['32.svg', '32.png', 32]];
// El canto comido: en una página, cada capa se pinta como máscara, se mide la distancia de cada punto a
// su contorno (dos pasadas) y su opacidad sale de la misma fórmula que en la piel; el ruido es blanco
// en una rejilla de 192 por lado del icono (interpolado al pintar más grande).
const CANTO = { pluma: 1.25, temblor: 0.55, mordida: 0.5 };   // en puntos del icono a 192
async function pintarMascota(page, { size, canvas, span, rx, tile }) {
  return page.evaluate(async ({ size, canvas, span, rx, tile, CUERPO, GUINO, PASO, colores, CANTO }) => {
    const c = size / 192, k = size / canvas;
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d');
    // fondo (con su esquina, si la lleva)
    const caja = () => { g.beginPath(); if (g.roundRect) g.roundRect(0, 0, size, size, rx * k); else g.rect(0, 0, size, size); };
    caja(); g.fillStyle = colores.FONDO; g.fill();
    // el símbolo apilado, como pila() en el SVG
    const w = 58 + PASO[0] * 2, h = 52 + PASO[1] * 2, kk = canvas * span / w;
    const tx = (canvas - w * kk) / 2 - 3 * kk, ty = (canvas - h * kk) / 2 - 8 * kk;
    const enSimbolo = ctx => { ctx.setTransform(k, 0, 0, k, 0, 0); ctx.translate(tx, ty); ctx.scale(kk, kk); };
    // ruido blanco en la rejilla de 192
    const N = 192, ruido = new Float32Array(N * N);
    let seed = 27019;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < ruido.length; i++) ruido[i] = Math.sqrt(-2 * Math.log(Math.max(1e-7, rand()))) * Math.cos(6.2831853 * rand());
    const n = (x, y) => {           // bilineal, envuelto
      const fx = x / c - 0.5, fy = y / c - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const at = (i, j) => ruido[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
      return (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
    };
    const cuerpo = new Path2D(CUERPO), R2 = Math.SQRT2;
    const capa = (i, color) => {
      const m = document.createElement('canvas'); m.width = m.height = size;
      const mg = m.getContext('2d'); enSimbolo(mg); mg.translate(PASO[0] * i, PASO[1] * i); mg.fillStyle = '#000'; mg.fill(cuerpo);
      const img = mg.getImageData(0, 0, size, size), d = img.data, dentro = new Uint8Array(size * size);
      for (let p = 0; p < size * size; p++) dentro[p] = d[p * 4 + 3] >= 128 ? 1 : 0;
      const dist = clase => {
        const t = new Float32Array(size * size);
        for (let p = 0; p < t.length; p++) t[p] = dentro[p] === clase ? 0 : 1e9;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const p = y * size + x; let v = t[p]; if (!v) continue; if (x) v = Math.min(v, t[p - 1] + 1); if (y) { v = Math.min(v, t[p - size] + 1); if (x) v = Math.min(v, t[p - size - 1] + R2); if (x < size - 1) v = Math.min(v, t[p - size + 1] + R2); } t[p] = v; }
        for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) { const p = y * size + x; let v = t[p]; if (!v) continue; if (x < size - 1) v = Math.min(v, t[p + 1] + 1); if (y < size - 1) { v = Math.min(v, t[p + size] + 1); if (x < size - 1) v = Math.min(v, t[p + size + 1] + R2); if (x) v = Math.min(v, t[p + size - 1] + R2); } t[p] = v; }
        return t;
      };
      const aDentro = dist(1), aFuera = dist(0);
      const pluma = CANTO.pluma * c, temblor = CANTO.temblor * c, mordida = CANTO.mordida, lejos = pluma + 3.2 * temblor;
      const [r, gg, b] = [1, 3, 5].map(o => parseInt(color.slice(o, o + 2), 16));
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const p = y * size + x, sdf = dentro[p] ? -(aFuera[p] - 0.5) : aDentro[p] - 0.5;
        let a;
        if (sdf < -lejos) a = 1; else if (sdf > lejos) a = 0;
        else { const v = n(x + 0.5, y + 0.5); const t = Math.min(1, Math.max(0, (-sdf + v * temblor + pluma) / (2 * pluma))); const sm = t * t * (3 - 2 * t); a = Math.min(1, Math.max(0, sm + v * mordida * 4 * sm * (1 - sm))); }
        d[p * 4] = r; d[p * 4 + 1] = gg; d[p * 4 + 2] = b; d[p * 4 + 3] = Math.round(255 * a);
      }
      mg.setTransform(1, 0, 0, 1, 0, 0); mg.putImageData(img, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(m, 0, 0);
    };
    capa(2, colores.AZUL); capa(1, colores.MANDARINA); capa(0, colores.VERDE);
    // los ojos, nítidos
    enSimbolo(g);
    g.fillStyle = colores.OJO; g.fill(new Path2D(GUINO));
    g.beginPath(); g.arc(43, 34, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = colores.PUPILA; g.beginPath(); g.arc(43, 34, 4.3, 0, Math.PI * 2); g.fill();
    // el grano mate encima de todo, con su mota a la escala del icono (un punto del icono a 192)
    const t = new Image(); t.src = tile; await t.decode();
    const pat = g.createPattern(t, 'repeat'); pat.setTransform(new DOMMatrix([c, 0, 0, c, 0, 0]));
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true; caja(); g.fillStyle = pat; g.fill();
    // fuera de la esquina, transparente
    g.globalCompositeOperation = 'destination-in'; caja(); g.fillStyle = '#000'; g.fill(); g.globalCompositeOperation = 'source-over';
    return cv.toDataURL('image/png');
  }, { size, canvas, span, rx, tile, CUERPO, GUINO, PASO, colores: { FONDO, VERDE, MANDARINA, AZUL, OJO, PUPILA }, CANTO });
}
const MASCOTA = { 'maestro.svg': { span: 0.70, rx: 188 }, 'maskable.svg': { span: 0.54, rx: 0 }, '../comunicacion/avatar.svg': { span: 0.56, rx: 0 } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tile = 'data:image/webp;base64,' + fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'body', 'grano.webp')).toString('base64');
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(out, name), conGrano(body, name.startsWith('..') ? '../../../body/grano.webp' : '../../../body/grano.webp', 256));
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const [source, target, size] of pngs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const canvas = Number(files[source].match(/viewBox="0 0 (\d+)/)[1]);
    if (MASCOTA[source]) {
      const url = await pintarMascota(page, { size, canvas, tile, ...MASCOTA[source] });
      fs.writeFileSync(path.join(out, target), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    } else {
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>` + conGrano(files[source], tile, 256 * canvas / size));
      fs.writeFileSync(path.join(out, target), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
    }
    await page.close();
  }
  await browser.close();
  console.log('icono:', Object.keys(files).length, 'SVG y', pngs.length, 'PNG en', out);
})().catch(e => { console.error(e); process.exit(1); });
