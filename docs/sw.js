const CACHE = 'flipnote-filter-v81-alpha-pass4';
const ASSETS = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './frame-runtime.js', './stamp.js', './optical-scope.js', './night-vision.js', './sensor.js',
  './silhouette.js', './silhouette-worker.js', './shell.css', './shell.js', './feel.js', './portal.js', './stage.js', './stage.css', './stage-out.html', './hands-worker.js', './pretext.js', './enochian.ttf',
  './body/body.webp', './body/bezel.webp', './body/tray.webp', './body/lcd.webp', './body/knob.webp', './body/dial.webp', './body/dial-cream.webp', './body/jack.webp',
  './body/switch.webp', './body/nub.webp', './body/shutter-photo.webp', './body/shutter-photo-down.webp',
  './body/shutter-video.webp', './body/shutter-video-down.webp', './body/candy-graphite.webp',
  './body/candy-graphite-down.webp', './body/candy-coral.webp', './body/candy-coral-down.webp',
  './body/candy-mustard.webp', './body/candy-mustard-down.webp', './body/candy-blue.webp',
  './body/candy-blue-down.webp', './body/candy-mint.webp', './body/candy-mint-down.webp',
  './body/candy-lilac.webp', './body/candy-lilac-down.webp', './body/candy-white.webp',
  './body/candy-white-down.webp', './body/candy-slate.webp', './body/candy-slate-down.webp',
  './body/keycap-key.webp', './body/keycap-key-down.webp', './body/keycap-coral.webp',
  './body/keycap-coral-down.webp', './body/keycap-slate.webp', './body/keycap-slate-down.webp',
  './body/keycap-gray.webp', './body/keycap-gray-down.webp', './body/keycap-mustard.webp',
  './body/keycap-mustard-down.webp',
  './body/look-DSI.webp', './body/look-STAMP.webp', './body/look-AUTO03.webp', './body/look-DLPHN.webp',
  './body/look-CASKIA.webp', './body/look-VFD.webp', './body/look-OSCAM.webp', './body/look-SLHT.webp',
  './fonts/Bloom-Regular.otf', './fonts/BNMonica.otf', './fonts/Fluidic-Regular.otf', './fonts/Canterbury.ttf'];
const shell = new URL('./index.html', self.registration.scope).href;

// El detector de siluetas de SLHT y FLOW (MediaPipe) vive en dos CDN y pesa unos 10 MB. Se
// guarda la primera vez que se usa, en una caché aparte que sobrevive a las alfas nuevas:
// después funciona sin red y no vuelve a descargarse.
const VISION_CACHE = 'flip-vision-v1';
const VISION = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@|storage\.googleapis\.com\/mediapipe-models\/)/;

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
  if (request.method !== 'GET') return;
  if (VISION.test(request.url)) {
    event.respondWith(caches.open(VISION_CACHE).then(async cache => {
      const hit = await cache.match(request.url);
      if (hit) return hit;
      // Siempre con CORS: una respuesta opaca (la de importScripts) ocuparía megas de cuota.
      const response = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
      if (response.ok) cache.put(request.url, response.clone()).catch(() => {});
      return response;
    }));
    return;
  }
  if (!request.url.startsWith(self.registration.scope)) return;
  const url = new URL(request.url);
  const home = new URL('./', self.registration.scope);
  const isHome = request.mode === 'navigate' && (url.pathname === home.pathname || url.pathname === new URL(shell).pathname);
  event.respondWith(caches.open(CACHE).then(async cache =>
    (await cache.match(isHome ? shell : request)) || fetch(request)
  ));
});
