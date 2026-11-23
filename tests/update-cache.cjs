// Actualización con la caché HTTP de por medio. GitHub Pages sirve cada archivo como válido
// durante diez minutos (Cache-Control: max-age=600). Si el service worker nuevo llenara su caché
// pasando por la caché HTTP del navegador, quien abrió la app hace poco se quedaría con archivos
// de la versión vieja guardados con el nombre de la nueva —o con una mezcla de nuevos y viejos, que
// puede no arrancar— y seguiría así hasta la siguiente publicación, porque la app se sirve siempre
// de esa caché. Esta prueba lo reproduce en un mismo origen y con esas cabeceras: abre la versión
// anterior, publica la actual y comprueba que cada archivo que guarda el service worker nuevo es el
// de la versión nueva, byte a byte, que la página que queda es la nueva y que lo que no cambió entre
// una versión y otra no se vuelve a descargar (el servidor contesta «304, no ha cambiado»).
//   FLIP_URL no hace falta: levanta su propio servidor.
//   node tests/update-cache.cjs [--ref 0b13252]
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, PIXEL } = require('./lib/harness.cjs');

const args = process.argv.slice(2);
const refAt = args.indexOf('--ref');
const oldRef = refAt >= 0 ? args[refAt + 1] : '0b13252';
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

// Como GitHub Pages: cada archivo válido diez minutos, con su huella (ETag) para poder preguntar si ha cambiado.
function serve(getRoot, seen) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.otf': 'font/otf' };
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(req.url.split('?')[0]);
    if (file === '/') file = '/index.html';
    fs.readFile(path.join(getRoot(), file), (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      const etag = '"' + crypto.createHash('sha1').update(data).digest('hex').slice(0, 20) + '"';
      const same = req.headers['if-none-match'] === etag;
      seen.push([file, same ? 304 : 200]);
      res.writeHead(same ? 304 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600', ETag: etag });
      res.end(same ? undefined : data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
async function until(page, fn, arg, timeout = 40000) {
  const began = Date.now();
  for (;;) {
    try { const value = await page.evaluate(fn, arg); if (value) return value; } catch (_) {}
    if (Date.now() - began > timeout) throw new Error('no se cumple a tiempo: ' + String(fn).slice(0, 110));
    await page.waitForTimeout(250);
  }
}
async function reload(page) {
  try { await page.reload(); } catch (_) {}
  try { await page.waitForLoadState('load'); } catch (_) {}
}

async function main() {
  const repo = path.join(__dirname, '..');
  const current = path.join(repo, 'docs');
  const previous = fs.mkdtempSync(path.join(os.tmpdir(), 'flip-anterior-'));
  execFileSync('sh', ['-c', `git -C "${repo}" archive ${oldRef} docs | tar -x -C "${previous}"`]);
  let root = path.join(previous, 'docs');
  const newCache = (fs.readFileSync(path.join(current, 'sw.js'), 'utf8').match(/const CACHE = '([^']+)'/) || [])[1];
  const oldCache = (fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const CACHE(?:_NAME)? = '([^']+)'/) || [])[1];
  assert.ok(newCache && newCache !== oldCache, 'la versión nueva tiene su propio nombre de caché: ' + oldCache + ' → ' + newCache);
  const seen = [];
  const server = await serve(() => root, seen);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await launch();
  try {
    const context = await browser.newContext({ ...PIXEL });
    const page = await context.newPage();

    // 1 · La versión anterior, recién abierta: el navegador se queda con sus archivos como válidos durante diez minutos.
    await page.goto(origin);
    await until(page, () => navigator.serviceWorker.ready.then(() => true));
    await page.waitForTimeout(1500);
    if (!(await until(page, () => navigator.serviceWorker.controller ? 'si' : 'no')).startsWith('si')) await reload(page);
    await until(page, () => !!navigator.serviceWorker.controller && document.readyState === 'complete');
    step('versión anterior instalada', { ref: oldRef, cache: oldCache });

    // 2 · Se publica la versión actual en el mismo origen, y el navegador comprueba si hay service worker nuevo.
    root = current;
    const had = new Set(seen.map(hit => hit[0]));          // lo que el navegador ya había bajado de la versión anterior
    seen.length = 0;
    await until(page, () => navigator.serviceWorker.getRegistration().then(reg => reg ? reg.update().then(() => true, () => true) : false));
    await until(page, name => caches.keys().then(keys => keys.includes(name)), newCache);
    await until(page, () => navigator.serviceWorker.getRegistration().then(reg => !!(reg && reg.active && !reg.installing && !reg.waiting)));
    await page.waitForTimeout(1500);                       // la página se recarga sola al cambiar de service worker
    await reload(page);
    await until(page, () => document.readyState === 'complete' && !!navigator.serviceWorker.controller);

    // 3 · Lo que guardó el service worker nuevo tiene que ser la versión nueva, archivo por archivo.
    const stored = await until(page, async name => {
      const cache = await caches.open(name), list = await cache.keys(), out = [];
      for (const request of list) {
        const response = await cache.match(request);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        out.push([new URL(request.url).pathname, Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')]);
      }
      return out.length ? out : null;
    }, newCache);
    const stale = [];
    for (const [file, digest] of stored) {
      const disk = path.join(current, file === '/' ? 'index.html' : file);
      const want = crypto.createHash('sha256').update(fs.readFileSync(disk)).digest('hex');
      if (want !== digest) stale.push(file);
    }
    assert.deepEqual(stale, [], 'archivos de la versión vieja guardados con el nombre de la nueva: ' + stale.join(', '));
    assert.ok(stored.length >= 60, 'la caché nueva está completa: ' + stored.length + ' archivos');
    const keys = await until(page, () => caches.keys().then(list => list.length ? list : null));
    assert.deepEqual(keys.filter(key => key.startsWith('flipnote-filter-')), [newCache], 'no queda ninguna caché de la versión anterior');
    step('la caché nueva lleva la versión nueva, byte a byte', { archivos: stored.length });

    // Lo que no cambió entre las dos versiones y el navegador ya tenía no se vuelve a descargar: se
    // pregunta al servidor y este contesta que sigue igual.
    const same = file => { try { return fs.readFileSync(path.join(previous, 'docs', file)).equals(fs.readFileSync(path.join(current, file))); } catch (_) { return false; } };
    const unchanged = stored.map(item => item[0]).filter(same);
    const full = file => seen.filter(hit => hit[0] === file && hit[1] === 200).length;
    const asked = unchanged.filter(file => seen.some(hit => hit[0] === file));
    assert.equal(asked.length, unchanged.length, 'cada archivo se comprueba con el servidor: ' + asked.length + ' de ' + unchanged.length);
    const again = unchanged.filter(file => had.has(file) && full(file) > 0);
    assert.deepEqual(again, [], 'archivos sin cambios que el navegador ya tenía, descargados otra vez enteros: ' + again.join(', '));
    const twice = stored.map(item => item[0]).filter(file => full(file) > 1);
    assert.deepEqual(twice, [], 'archivos descargados enteros más de una vez durante la actualización: ' + twice.join(', '));
    step('lo que no cambió no se vuelve a descargar', { sinCambios: unchanged.length, yaLosTenia: unchanged.filter(file => had.has(file)).length, descargados: stored.filter(item => full(item[0]) > 0).length });

    // 4 · Y la página que queda es la nueva (la anterior no tenía vigía de arranque).
    const boot = await until(page, () => window.__flipBoot ? window.__flipBoot.state() : null);
    assert.deepEqual([boot.done, boot.failed], [true, false], 'la app nueva arranca: ' + JSON.stringify(boot));
    step('la página es la versión nueva y arranca');
    console.log('PASS · actualización con la caché HTTP de por medio (' + oldRef + ')');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
