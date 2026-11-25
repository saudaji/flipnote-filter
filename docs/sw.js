const CACHE = 'flipnote-filter-v99-silueta';
const ASSETS = [
  './index.html', './manifest.json', './icon-192.png', './icon-512.png', './frame-runtime.js', './stamp.js', './optical-scope.js', './press.js',
  './night-vision.js', './sensor.js', './silhouette.js', './silhouette-worker.js', './shell.css', './shell.js', './silueta.css', './silueta.js', './brand/silueta/grano.webp', './console.css', './console.js',
  './feel.js', './mp4-flat.js', './light.js', './rest.js', './portal.js', './stage.js', './stage.css', './stage-out.html', './hands-worker.js',
  './pretext.js', './enochian.ttf', './fonts/Bloom-Regular.otf', './fonts/BNMonica.otf', './fonts/Fluidic-Regular.otf', './fonts/Canterbury.ttf',
  // Piezas de la carcasa y de la marca que la app usa (las demás de docs/body ya no se precargan).
  './body/bezel.webp', './body/candy-graphite-down.webp', './body/candy-graphite.webp', './body/candy-lilac-down.webp', './body/candy-lilac.webp',
  './body/candy-white-down.webp', './body/candy-white.webp', './body/console-key-down-on.webp', './body/console-key-down.webp',
  './body/console-key-on.webp', './body/console-key.webp', './body/console-nub.webp', './body/console-plate.webp', './body/console-scale.webp',
  './body/console-sel2.webp', './body/console-sel3.webp', './body/console-slide.webp', './body/dial-cream.webp', './body/grain.webp','./body/grano.webp', './body/grano-relieve.webp', 
  './body/jack.webp', './body/keycap-gray-down.webp', './body/keycap-gray.webp', './body/knob.webp', './body/lcd.webp', './body/look-AUTO03.webp',
  './body/look-CASKIA.webp', './body/look-DLPHN.webp', './body/look-DSI.webp', './body/look-OSCAM.webp', './body/look-PRENSA.webp', './body/look-SLHT.webp',
  './body/look-STAMP.webp', './body/look-VFD.webp', './body/nub.webp', './body/shell-bottom.webp', './body/shell-foot.webp', './body/shell-mid.webp',
  './body/shell-top.webp', './body/tray.webp', './brand/fuentes/chivo.woff2', './brand/fuentes/doto.woff2', './brand/fuentes/plex.woff2',
  './brand/rollo-en-anil/activar.js', './brand/rollo-en-anil/app.css', './brand/rollo-en-anil/app/16.png', './brand/rollo-en-anil/app/32.png',
  './brand/rollo-en-anil/app/any-192.png', './brand/rollo-en-anil/app/any-512.png', './brand/rollo-en-anil/app/maskable-192.png',
  './brand/rollo-en-anil/app/maskable-512.png', './brand/rollo-en-anil/app/monocromo-512.png', './brand/rollo-en-anil/app/preloader.svg',
  './brand/rollo-en-anil/arranque/guino.wav', './brand/rollo-en-anil/marca/horizontal-clara.svg',
  './brand/rollo-en-anil/marca/placa-fl-27-compacta-clara.svg', './brand/rollo-en-anil/marca/placa-fl-27-compacta.svg', './brand/rollo-en-anil/marca/placa-vs-27-clara.svg',
  './brand/rollo-en-anil/materiales/bezel-oscuro.webp', './brand/rollo-en-anil/materiales/boton-anil-pulsado.webp',
  './brand/rollo-en-anil/materiales/boton-anil.webp', './brand/rollo-en-anil/materiales/boton-lima-pulsado.webp',
  './brand/rollo-en-anil/materiales/boton-lima.webp', './brand/rollo-en-anil/materiales/boton-mandarina-pulsado.webp',
  './brand/rollo-en-anil/materiales/boton-mandarina.webp', './brand/rollo-en-anil/materiales/boton-rec-pulsado.webp',
  './brand/rollo-en-anil/materiales/boton-rec.webp', './brand/rollo-en-anil/materiales/dial-humo.webp',
  './brand/rollo-en-anil/materiales/disparador-anil-pulsado.webp', './brand/rollo-en-anil/materiales/disparador-anil.webp',
  './brand/rollo-en-anil/materiales/disparador-video-pulsado.webp', './brand/rollo-en-anil/materiales/disparador-video.webp',
  './brand/rollo-en-anil/materiales/lcd-oscuro.webp', './brand/rollo-en-anil/materiales/perfil-anil.webp',
  './brand/rollo-en-anil/materiales/perfil-pulsado.webp', './brand/rollo-en-anil/materiales/perfil.webp',
  './brand/rollo-en-anil/materiales/perilla-humo.webp', './brand/rollo-en-anil/materiales/perilla-marca.webp',
  './brand/rollo-en-anil/materiales/selector-anil-pulsado.webp', './brand/rollo-en-anil/materiales/selector-anil.webp',
  './brand/rollo-en-anil/materiales/shell-bottom-oscuro.webp', './brand/rollo-en-anil/materiales/shell-bottom.webp',
  './brand/rollo-en-anil/materiales/shell-foot-oscuro.webp', './brand/rollo-en-anil/materiales/shell-foot.webp',
  './brand/rollo-en-anil/materiales/shell-mid-oscuro.webp', './brand/rollo-en-anil/materiales/shell-mid.webp',
  './brand/rollo-en-anil/materiales/shell-top-oscuro.webp', './brand/rollo-en-anil/materiales/shell-top.webp',
  './brand/rollo-en-anil/materiales/tecla-anil-pulsada.webp', './brand/rollo-en-anil/materiales/tecla-anil.webp',
  './brand/rollo-en-anil/materiales/tecla-consola-anil-pulsada.webp', './brand/rollo-en-anil/materiales/tecla-consola-anil.webp',
  './brand/rollo-en-anil/materiales/tecla-miel-pulsada.webp', './brand/rollo-en-anil/materiales/tecla-miel.webp',
  './brand/rollo-en-anil/materiales/tecla-pulsada.webp', './brand/rollo-en-anil/materiales/tecla.webp',
  './brand/rollo-en-anil/materiales/tray-oscuro.webp', './brand/rollo-en-anil/tema.css'];
const shell = new URL('./index.html', self.registration.scope).href;

// El detector de siluetas de SLHT y FLOW (MediaPipe) vive en dos CDN y pesa unos 10 MB. Se
// guarda la primera vez que se usa, en una caché aparte que sobrevive a las alfas nuevas:
// después funciona sin red y no vuelve a descargarse.
const VISION_CACHE = 'flip-vision-v1';
const VISION = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@|storage\.googleapis\.com\/mediapipe-models\/)/;

// Una alfa nueva sustituye a la anterior en cuanto termina de descargarse: quien llega con
// la versión vieja instalada no tiene que cerrar todas las pestañas para recibirla.
// Cada archivo se comprueba con el servidor, sin fiarse de la caché HTTP del navegador. GitHub
// Pages los da por válidos diez minutos: fiándose de ella, quien abrió la app hace poco guardaría
// archivos de la versión vieja con el nombre de la nueva —o una mezcla de las dos, que puede no
// arrancar— y se quedaría así hasta la siguiente publicación, porque la app se sirve siempre de
// esta caché. («no-cache» pregunta siempre; lo que no ha cambiado no se vuelve a descargar.)
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'no-cache' }))))
    .then(() => self.skipWaiting()));
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
