// El icono de la app: la cámara que guiña, en tres capas descuadradas (verde, mandarina y azul)
// sobre negro, como una tirada con el registro corrido. El ojo abierto es una lente: aro claro y
// cristal oscuro. Escribe los SVG y sus PNG en
// docs/brand/rollo-en-anil/app/ (y el avatar para redes, en comunicacion/).
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
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tile = 'data:image/webp;base64,' + fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'body', 'grano.webp')).toString('base64');
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(out, name), conGrano(body, name.startsWith('..') ? '../../../body/grano.webp' : '../../../body/grano.webp', 256));
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const [source, target, size] of pngs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const canvas = Number(files[source].match(/viewBox="0 0 (\d+)/)[1]);
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>` + conGrano(files[source], tile, 256 * canvas / size));
    fs.writeFileSync(path.join(out, target), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
    await page.close();
  }
  await browser.close();
  console.log('icono:', Object.keys(files).length, 'SVG y', pngs.length, 'PNG en', out);
})().catch(e => { console.error(e); process.exit(1); });
