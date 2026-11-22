const CACHE = 'flipnote-filter-v76-alpha-pass2';
const ASSETS = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './frame-runtime.js', './stamp.js', './optical-scope.js', './night-vision.js', './pretext.js', './enochian.ttf',
  './fonts/Bloom-Regular.otf', './fonts/BNMonica.otf', './fonts/Fluidic-Regular.otf', './fonts/Canterbury.ttf'];
const shell = new URL('./index.html', self.registration.scope).href;

// Una alfa nueva sustituye a la anterior en cuanto termina de descargarse: quien llega con
// la versión vieja instalada no tiene que cerrar todas las pestañas para recibirla.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('flipnote-filter-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  const url = new URL(request.url);
  const home = new URL('./', self.registration.scope);
  const isHome = request.mode === 'navigate' && (url.pathname === home.pathname || url.pathname === new URL(shell).pathname);
  event.respondWith(caches.open(CACHE).then(async cache =>
    (await cache.match(isHome ? shell : request)) || fetch(request)
  ));
});
