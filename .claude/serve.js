const http = require('http');
const fs = require('fs');
const path = require('path');
// Uso: node .claude/serve.js [puerto] [carpeta]. Por defecto 8742 y docs/ de este árbol.
const port = Number(process.argv[2] || process.env.PORT || 8742);
const root = path.resolve(process.argv[3] || path.join(__dirname, '..', 'docs'));
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.wasm': 'application/wasm',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.md': 'text/plain', '.webp': 'image/webp',
};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    // no-cache: el navegador revalida siempre, así el service worker ve cada alfa nueva.
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('serving ' + root + ' on ' + port));
