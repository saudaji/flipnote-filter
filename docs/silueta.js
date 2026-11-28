// FLIP · piel INTERFAZ («Silueta»). Va después de shell.js y solo añade: no cambia qué hace
// ningún mando. Pone lo que la piel necesita y la carcasa de objeto no tiene:
//   · el selector de piel (INTERFAZ de fábrica, OBJETO como alternativa; se recuerda);
//   · el disparador con la silueta de la cámara, que cierra el ojo al pulsarlo;
//   · la cabecera de la banda (variante + «cámaras y filtros») y su cajón;
//   · los puntos de la tira de cámaras, el rótulo TOMA, el estado del audio y la placa.
// Los estilos están en silueta.css y cuelgan de body[data-piel="interfaz"].
(() => {
  'use strict';
  const shell = window.flipShell;
  if (!shell) return;
  const { el, icon } = shell;
  const $ = id => document.getElementById(id);
  const KEY = 'flip.piel';
  const body = document.body, deck = $('camDeck'), launcher = $('shellLauncher');
  const variants = $('deckVariants'), looks = $('deckLooks'), shutter = $('deckShutter');

  // ── El disparador ──────────────────────────────────────────────────────────
  // Las tres capas del símbolo, con el guiño a la izquierda y el ojo abierto a la derecha. Al
  // pulsar, el ojo abierto se cierra un instante: la cámara guiña. Grabando, la cara deja paso
  // al cuadrado de detener.
  const CUERPO = 'M6 27Q7 18 17 17H19L23 11Q25 8 29 8H42Q47 8 49 13L51 17Q58 18 59 25L61 40Q63 53 51 55L18 59Q7 60 5 49L4 39Q3 32 6 27Z';
  const capas = [[8.8, 9.6], [4.4, 4.8], [0, 0]].map(([x, y]) => `<path transform="translate(${x} ${y})" d="${CUERPO}"/>`).join('');
  shutter.insertAdjacentHTML('beforeend', `
    <svg class="silueta" viewBox="0 0 88 84" aria-hidden="true">
      <g transform="translate(-2.0139528 -5.7885711) scale(1.2463874)">
        <g fill="none" stroke="var(--flip-borde-disparador, none)" stroke-width="1.043" stroke-linejoin="round">${capas}</g>
        <g fill="var(--flip-acento, #3D5FE6)">${capas}</g>
        <g class="cara">
          <path d="M13 35Q20 27 29 32Q33 35 30 38Q28 40 25 38Q21 35 17 39Q13 40 13 35Z" fill="var(--flip-tinta-acento, #FFF3DF)"/>
          <path class="cerrado" transform="translate(65.5 -1) scale(-1 1)" d="M13 35Q20 27 29 32Q33 35 30 38Q28 40 25 38Q21 35 17 39Q13 40 13 35Z" fill="var(--flip-tinta-acento, #FFF3DF)"/>
          <g class="ojo"><circle cx="43" cy="34" r="8" fill="var(--flip-tinta-acento, #FFF3DF)"/><g class="mira"><circle class="pupila" cx="43" cy="34" r="4.3" fill="var(--flip-acento, #3D5FE6)"/></g></g>
        </g>
      </g>
      <rect class="parar" x="37.64" y="35.64" width="12.72" height="12.72" rx="1.7" fill="var(--flip-tinta-acento, #FFF3DF)"/>
    </svg>`);
  // En la piel OBJETO la mascota es un render en volumen (shell.css): su ojo derecho va por capas
  // para moverse igual que este (mismas clases de estado en el disparador, mismas variables).
  shutter.insertAdjacentHTML('beforeend', '<span class="m3" aria-hidden="true"><span class="m3-ojo"><span class="m3-blanco"></span><span class="m3-mira"><span class="m3-pupila"></span></span></span><span class="m3-cerrado"></span></span>');
  // El guiño dura lo bastante para verse aunque el toque sea muy corto.
  let guinoTimer = 0;
  const guinar = () => {
    shutter.classList.add('guino');
    clearTimeout(guinoTimer);
    guinoTimer = setTimeout(() => shutter.classList.remove('guino'), 230);
  };
  shutter.addEventListener('pointerdown', guinar);
  shutter.addEventListener('click', guinar);
  // Donde no hay vibración (iPhone, escritorio), el disparo se ve: un retroceso corto.
  body.dataset.haptic = navigator.vibrate ? 'vib' : 'vis';
  shutter.addEventListener('click', () => { shutter.classList.remove('retroceso'); void shutter.offsetWidth; shutter.classList.add('retroceso'); setTimeout(() => shutter.classList.remove('retroceso'), 160); });
  // ── La mascota reacciona ── Siempre a algo que hace quien la usa; nunca se mueve sola.
  // Guardar: tras el disparo mantiene el ojo cerrado hasta que la toma aparece en TOMA.
  const galeria = $('deckGallery');
  let guardaTimer = 0;
  const guardado = () => { clearTimeout(guardaTimer); shutter.classList.remove('guarda'); };
  shutter.addEventListener('click', () => {
    if (body.classList.contains('cam-video') || body.classList.contains('is-recording')) return;
    shutter.classList.add('guarda');
    clearTimeout(guardaTimer);
    guardaTimer = setTimeout(guardado, 900);
  });
  if (galeria) new MutationObserver(() => { if (galeria.classList.contains('pop')) setTimeout(guardado, 120); }).observe(galeria, { attributes: true, attributeFilter: ['class'] });
  // El carrete: al pasar la tira de cámaras, mira hacia el lado al que la lleva el dedo (o la rueda).
  // Sigue el gesto, no el desplazamiento: al soltar, la tira se acomoda sola hacia atrás y eso no cuenta.
  const tira = $('deckLooks');
  let miraTimer = 0, miraLado = 0, dedoX = null;
  const mirar = lado => {
    if (lado && lado !== miraLado) { miraLado = lado; shutter.style.setProperty('--mira', String(lado * 1.9)); }
    clearTimeout(miraTimer);
    miraTimer = setTimeout(() => { miraLado = 0; shutter.style.removeProperty('--mira'); }, 260);
  };
  if (tira) {
    tira.addEventListener('wheel', event => { const d = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY; if (Math.abs(d) > 1) mirar(d > 0 ? 1 : -1); }, { passive: true });
    tira.addEventListener('touchstart', event => { dedoX = event.touches[0] ? event.touches[0].clientX : null; }, { passive: true });
    tira.addEventListener('touchmove', event => {
      const x = event.touches[0] ? event.touches[0].clientX : null;
      if (x == null || dedoX == null) return;
      const d = dedoX - x;                                       // el dedo va a la izquierda: llegan las cámaras de la derecha
      if (Math.abs(d) < 6) return;
      dedoX = x;
      mirar(d > 0 ? 1 : -1);
    }, { passive: true });
    tira.addEventListener('touchend', () => { dedoX = null; }, { passive: true });
  }
  // Agitar el teléfono la marea: la pupila da una vuelta (light.js avisa de la sacudida).
  let mareoTimer = 0;
  const marear = () => { shutter.classList.remove('mareo'); void shutter.offsetWidth; shutter.classList.add('mareo'); clearTimeout(mareoTimer); mareoTimer = setTimeout(() => shutter.classList.remove('mareo'), 700); };
  addEventListener('flip:sacudida', marear);
  // Fuera del disparador: su cara en los avisos del visor y, dormida, en la tecla TOMA mientras no
  // hay ninguna toma. Se dibuja una vez y la hoja de estilos la usa.
  const svgUrl = svg => 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  const OJO_CERRADO = 'M13 35Q20 27 29 32Q33 35 30 38Q28 40 25 38Q21 35 17 39Q13 40 13 35Z';
  document.documentElement.style.setProperty('--si-mascota', svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 5 66 58"><path d="${CUERPO}" fill="#008048"/><path d="${OJO_CERRADO}" fill="#FFF3DF"/><circle cx="43" cy="34" r="8" fill="#FFF3DF"/><circle cx="43" cy="34" r="4.3" fill="#151727"/></svg>`));
  // Su silueta, en el encuadre del render en volumen (112 de lado, escala 1,62): recorta la capa de grano del disparador de OBJETO.
  document.documentElement.style.setProperty('--si-mascota-forma', svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.868 -0.368 69.136 69.136"><path d="${CUERPO}"/></svg>`));
  document.documentElement.style.setProperty('--si-mascota-dormida', svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 5 66 58"><path d="${CUERPO}" fill="none" stroke="#000" stroke-width="3.4" stroke-linejoin="round"/><path d="${OJO_CERRADO}"/><path transform="translate(65.5 -1) scale(-1 1)" d="${OJO_CERRADO}"/></svg>`));

  // La puerta principal de la portada (la única rellena de acento).
  const puerta = $('btnSplashOriginal');
  if (puerta) puerta.classList.add('principal');

  // ── Barra de arriba: la tecla de modo lleva la rejilla de «todos los modos» ──
  $('shellModule').insertAdjacentHTML('beforeend', '<svg class="si-rejilla" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="1.5" width="5" height="5" rx=".8"/><rect x="9.5" y="1.5" width="5" height="5" rx=".8"/><rect x="1.5" y="9.5" width="5" height="5" rx=".8"/><rect x="9.5" y="9.5" width="5" height="5" rx=".8"/></svg>');
  // El micrófono dice su estado con palabras.
  const mic = $('shellMic');
  if (mic && !mic.hidden) {
    const label = el('span', { class: 'si-audio' }, '<b>AUDIO</b><i></i>');
    mic.appendChild(label);
    const paint = () => { label.lastChild.textContent = body.dataset.escucha === 'si' ? 'Escucha' : mic.classList.contains('is-on') ? 'Micrófono' : 'Silencio'; };
    new MutationObserver(paint).observe(mic, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(paint).observe(body, { attributes: true, attributeFilter: ['data-escucha'] });
    paint();
  }

  // ── La banda: variante a la izquierda, «cámaras y filtros» a la derecha ─────
  const cabeza = el('div', { class: 'si-banda-cabeza' }, `
    <button class="si-variante" type="button"><small>VARIANTE</small><b></b></button><i aria-hidden="true"></i>
    <button class="si-abrir" type="button" aria-controls="siCajon" aria-expanded="false" aria-label="Cámaras y filtros"><span>CÁMARAS Y FILTROS</span>${icon('chev')}</button>`);
  // El cajón sube sobre el visor: no cambia el tamaño de la imagen al abrirlo.
  const camara = shell.modes.find(mode => mode[0] === 'camara');
  const cajon = el('div', { class: 'si-cajon', id: 'siCajon' }, `
    <div class="si-cajon-fila si-cajon-variantes"><small>VARIANTE</small></div>
    <div class="si-cajon-fila"><small>FILTROS</small><div class="si-filtros" role="group" aria-label="Filtros de cámara">${camara[4].map(([key, label]) => `<button class="hw si-chip" type="button" data-filtro="${key}">${label}</button>`).join('')}</div></div>`);
  const hueco = document.createComment('variantes');           // dónde viven las variantes en la piel OBJETO
  variants.before(hueco);
  deck.prepend(cajon, cabeza);

  const abrir = open => {
    body.classList.toggle('banda-abierta', open);
    cabeza.querySelector('.si-abrir').setAttribute('aria-expanded', String(open));
    // La variante puesta, a la vista aunque la fila se deslice.
    if (open) requestAnimationFrame(() => { const on = variants.querySelector('[data-variant].is-on'); if (on) variants.scrollLeft = Math.max(0, on.offsetLeft + on.offsetWidth - variants.clientWidth + 8); });
    if (open) cajon.querySelectorAll('[data-filtro]').forEach(chip => { const on = chip.dataset.filtro === shell.module(); chip.classList.toggle('is-on', on); chip.setAttribute('aria-pressed', String(on)); });
  };
  cabeza.querySelector('.si-abrir').addEventListener('click', () => abrir(!body.classList.contains('banda-abierta')));
  // Un toque en la variante pasa a la siguiente (DÍA → NOCHE → FLASH…): lo más usado, a un toque.
  // Una cámara sin variantes no tiene a dónde pasar: abre el cajón.
  cabeza.querySelector('.si-variante').addEventListener('click', () => {
    const keys = [...variants.querySelectorAll('[data-variant]')];
    if (keys.length < 2) return abrir(!body.classList.contains('banda-abierta'));
    keys[(keys.findIndex(key => key.classList.contains('is-on')) + 1) % keys.length].click();
  });
  cajon.addEventListener('click', event => {
    const chip = event.target.closest('[data-filtro]');
    if (!chip) return;
    abrir(false);
    shell.goModule(chip.dataset.filtro);
  });
  // La cámara elegida lleva una flecha: tocarla otra vez abre el mismo cajón.
  looks.addEventListener('click', event => {
    const tile = event.target.closest('.look');
    if (tile && tile.classList.contains('is-on') && body.dataset.piel === 'interfaz') abrir(!body.classList.contains('banda-abierta'));
  }, true);
  // Tocar fuera (el visor, la barra) lo cierra.
  addEventListener('pointerdown', event => {
    if (body.classList.contains('banda-abierta') && !event.target.closest('#siCajon, .si-banda-cabeza, .look.is-on')) abrir(false);
  }, true);
  new MutationObserver(() => { if (body.dataset.tab !== 'cam') abrir(false); }).observe(body, { attributes: true, attributeFilter: ['data-tab'] });

  function pintarBanda() {
    const on = variants.querySelector('[data-variant].is-on'), count = variants.querySelectorAll('[data-variant]').length;
    const tile = looks.querySelector('.look.is-on');
    const name = cabeza.querySelector('.si-variante b'), small = cabeza.querySelector('.si-variante small');
    // Una cámara sin variantes dice su nombre: la banda nunca queda con un hueco.
    const keys = [...variants.querySelectorAll('[data-variant]')];
    small.textContent = count > 1 && on ? 'VARIANTE ' + (keys.indexOf(on) + 1) + '/' + count : 'CÁMARA';
    cabeza.querySelector('.si-variante').setAttribute('aria-label', count > 1 && on ? 'Variante ' + on.textContent.trim() + '. Toca para pasar a la siguiente' : 'Cámaras y filtros');
    const antes = name.textContent;
    name.textContent = count > 1 && on ? on.textContent.trim() : (tile ? tile.textContent.trim() : '');
    // La variante nueva entra como una solapa (solo si cambió de verdad).
    if (antes && antes !== name.textContent) { name.classList.remove('pasa'); void name.offsetWidth; name.classList.add('pasa'); }
    cajon.querySelector('.si-cajon-variantes').hidden = count < 2;
    ambiente(tile);
  }
  // El tinte de la cámara puesta: el color medio de su miniatura tiñe, muy bajo, el halo detrás de la
  // tira (silueta.css, --si-ambiente). Se calcula una vez por miniatura y solo al cambiar de cámara o
  // de look: nunca se mira el visor en vivo (leer sus píxeles cada cuadro costaría cuadros).
  const ambientes = new Map();
  let ambienteUrl = null;
  function ambiente(tile) {
    const i = tile && tile.firstElementChild;
    const m = i && /url\(["']?(.*?)["']?\)/.exec(i.style.backgroundImage || '');
    const url = m ? m[1] : '';
    if (url === ambienteUrl) return;
    ambienteUrl = url;
    const poner = color => { if (ambienteUrl === url) body.style.setProperty('--si-ambiente', color); };
    if (!url) return poner('#008048');
    if (ambientes.has(url)) return poner(ambientes.get(url));
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 8;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 8, 8);
        const d = g.getImageData(0, 0, 8, 8).data;
        let r = 0, v = 0, a = 0;
        for (let k = 0; k < d.length; k += 4) { r += d[k]; v += d[k + 1]; a += d[k + 2]; }
        // (el color medio suele salir apagado: se lleva a un brillo fijo para que el tinte se note igual en todas)
        const n = d.length / 4, top = Math.max(1, r, v, a) / n, k = 200 / top;
        const color = 'rgb(' + [r, v, a].map(x => Math.round(Math.min(255, x / n * k))).join(', ') + ')';
        ambientes.set(url, color); poner(color);
      } catch (_) {}
    };
    img.src = url;
  }
  let pintarPendiente = false;
  const pintarLuego = () => { if (pintarPendiente) return; pintarPendiente = true; queueMicrotask(() => { pintarPendiente = false; pintarBanda(); }); };
  new MutationObserver(pintarLuego).observe(variants, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  new MutationObserver(pintarLuego).observe(looks, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });

  // ── Botonera: el rótulo TOMA y la placa ─────────────────────────────────────
  const gallery = $('deckGallery');
  const toma = el('div', { class: 'si-toma' });
  gallery.before(toma);
  toma.append(gallery, el('span', { class: 'hw-print' }, 'TOMA'));
  const placa = el('div', { class: 'si-placa', role: 'img', 'aria-label': 'FLIP FL-27' }, `
    <svg viewBox="0 0 177 54" aria-hidden="true"><g fill="currentColor" fill-rule="evenodd" transform="translate(1 4)">
      <path d="M0 12Q0 3 10 3H33Q40 3 40 10Q40 16 33 16H15V22H29Q36 22 36 28Q36 34 29 34H15V39Q15 46 8 46Q0 46 0 39Z" transform="translate(7 0) rotate(-4 20 23)"/>
      <path d="M0 11Q0 3 8 3Q15 3 15 11V31Q15 34 19 34H33Q40 34 40 40Q40 46 33 46H13Q0 46 0 34Z" transform="translate(52 0) rotate(2 20 23)"/>
      <path d="M13 0Q20 1 20 7Q20 13 12 13Q4 13 4 7Q4 0 13 0ZM3 22Q3 17 11 17Q18 17 18 23V39Q18 46 10 46Q3 46 3 39Z" transform="translate(95 -1) rotate(-5 10 23)"/>
      <path d="M0 12Q0 3 9 3H24Q44 3 44 20Q44 36 24 36H15V39Q15 46 8 46Q0 46 0 39ZM15 16V24H24Q29 24 29 20Q29 16 24 16Z" transform="translate(123 0) rotate(2 21 23)"/>
    </g></svg><b>FL-27</b>`);
  deck.appendChild(placa);
  // Dos toques en la placa: la camarita guiña dos veces. No sirve para nada; da gusto.
  let placaAt = 0;
  // (en la piel OBJETO la placa es la del pie del aparato)
  const dobleGuino = event => {
    const now = performance.now();
    if (now - placaAt > 340) { placaAt = now; return; }
    placaAt = 0;
    const cerrar = on => shutter.classList.toggle('guino', on);
    clearTimeout(guinoTimer);
    cerrar(true); setTimeout(() => cerrar(false), 90); setTimeout(() => cerrar(true), 170); setTimeout(() => cerrar(false), 260);
    if (window.flipFeel) { flipFeel.tap('wink', 'down', event.clientX); setTimeout(() => flipFeel.tap('key', 'up', event.clientX), 110); }
  };
  placa.addEventListener('pointerup', dobleGuino);
  addEventListener('pointerup', event => { if (event.target && event.target.closest && event.target.closest('#camDeck .rollo-pie')) dobleGuino(event); });

  // El grano de esta piel va encima de cada barra: el cajón y la botonera de los demás modos son
  // barras que la piel OBJETO no cuenta (allí el grano les llega de la carcasa de fondo).
  for (const host of [cajon, $('modeDeck')]) if (host && !host.querySelector(':scope > .grano')) host.appendChild(el('i', { class: 'grano', 'aria-hidden': 'true' }));
  // La galería de looks de CLON (la hace clon.js al usarla por primera vez) también es una hoja con su
  // grano; y su capa de PASAR/RECIBIR, que la tapa, lleva el suyo (por debajo del QR: silueta.css).
  const granoGaleria = () => {
    const g = body.dataset.piel === 'interfaz' && $('clonGaleria');
    if (g) for (const host of [g, g.querySelector('#clonCapa')]) if (host && !host.querySelector(':scope > .grano')) host.appendChild(el('i', { class: 'grano', 'aria-hidden': 'true' }));
  };
  new MutationObserver(granoGaleria).observe(body, { attributes: true, attributeFilter: ['class', 'data-piel'] });

  // ── El grano fino: un punto de la tesela, un punto físico de la pantalla ──────
  // La tesela de grano (256 × 256) se pinta a 256 / densidad px CSS: cada punto del ruido cae en un
  // punto físico (a 3× de densidad, un tercio de px CSS), sin grumos y sin arena gorda. Cambia si
  // cambia la densidad (zoom, otra pantalla).
  const granoTam = () => document.documentElement.style.setProperty('--si-grano-tam', (256 / Math.max(0.25, window.devicePixelRatio || 1)).toFixed(4) + 'px');
  granoTam();
  addEventListener('resize', granoTam);

  // ── El canto comido por el grano ─────────────────────────────────────────────
  // Ninguna forma de esta piel tiene filo: su canto es una franja de ~1,5 px donde el grano decide,
  // punto a punto, si es forma o fondo. Eso no lo da el CSS sin costarle cuadros al visor (un filtro
  // SVG o un desenfoque por pieza se recalculan al deslizar), así que se hornea una vez: por cada color
  // y radio, una textura de nueve cortes con el canto calado, con el contorno movido punto a punto por
  // el mismo ruido fino del grano y con la mordida de ese ruido donde la mezcla va al 50 %: borde y
  // superficie se leen como un solo material. Se hornea a la densidad de la pantalla (un punto de la
  // textura, un punto físico). Las aristas son periódicas (48 px): con border-image-repeat: repeat se
  // repiten sin costura y el canto mide lo mismo en una tecla de 44 px que en una hoja de 390.
  // silueta.css las pinta en el ::before de cada pieza, sobre su núcleo liso (variables --si-f-*,
  // --si-sl-*). Se hornea al arrancar, en ratos libres que no frenan ningún cuadro; otra vez al cambiar
  // de tema y si cambia la densidad. Mientras tanto las piezas se ven con su núcleo liso (radio y color).
  const horno = (() => {
    const E_CSS = 48;
    // [nombre, color, radio en px CSS, forma]: «r» rectángulo redondo (vale de píldora: la escala la
    // pone el navegador), «h» hoja que sube (canto solo arriba), «m» marco que entra hacia una foto.
    const PIEZAS = [
      ['tecla', '--si-tecla', 22, 'r'], ['tinta', '--si-tinta', 22, 'r'], ['acento', '--si-acento', 22, 'r'], ['acento-osc', '--si-acento-pulsado', 22, 'r'],
      ['marfil', '--si-marfil', 22, 'r'], ['peligro', '--si-peligro', 22, 'r'], ['pildora', '--si-visor-pildora', 22, 'r'],
      ['banda-tecla', '--si-banda-tecla', 22, 'r'], ['banda-ficha', '--si-banda-ficha', 22, 'r'], ['banda', '--si-banda', 22, 'r'], ['carta', '--si-carta', 22, 'r'], ['banda-carta-22', '--si-banda-carta', 22, 'r'],
      ['banda-carta', '--si-banda-carta', 16, 'r'], ['acento-16', '--si-acento', 16, 'r'], ['tecla-12', '--si-tecla', 12, 'r'],
      ['hoja', '--si-banda', 26, 'h'], ['hoja-clara', '--si-fondo', 26, 'h'], ['marco-mini', '--si-banda', 12, 'm'],
      ['mascota', null, 0, 'mascota'],                              // la máscara del disparador: su silueta, con el mismo canto
    ];
    // El canto mide en px CSS: el corte de cada radio (R + 2 de margen para el calado que sale de la pieza).
    const CORTES = { 22: 24, 16: 18, 12: 14, h26: 28 };
    let escala = 0, urls = [], vuelta = 0, horneadas = 0, ms = 0, timer = 0;
    const ruidos = {};
    // El mismo ruido que el grano de la superficie (design/silueta/grano.py): ruido blanco, cada punto
    // independiente de sus vecinos, de media 0 y σ 1. Periódico por construcción (E × E): las aristas
    // se repiten sin costura.
    function ruido(E) {
      if (ruidos[E]) return ruidos[E];
      const out = new Float32Array(E * E);
      let seed = 27019;
      const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(-2 * Math.log(Math.max(1e-7, rand()))) * Math.cos(6.2831853 * rand());
      return (ruidos[E] = out);
    }
    const rgba = css => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillStyle = css; g.fillRect(0, 0, 1, 1); return g.getImageData(0, 0, 1, 1).data; };
    // Una textura de nueve cortes. Se hornea a la densidad de la pantalla: un punto de la textura es un
    // punto físico, como el grano (el corte se redondea a puntos enteros y la escala sale de ahí). La
    // forma tiene su contorno a 2 px CSS del borde de la textura (lo que sale con border-image-outset).
    function hornear(color, rCss, forma, sl, E) {
      const [cr, cg, cb, ca] = color, k = ca / 255, s = sl / ((forma === 'h' ? 26 : rCss) + 2);
      const out = 2 * s, R = rCss * s;
      const W = 2 * sl + E, H = forma === 'h' ? sl + E : W;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data, n = ruido(E);
      // pluma: media franja calada (1,9 px CSS en total); temblor: cuánto mueve el ruido el contorno, punto
      // a punto; mordida: el grano mordiendo donde la mezcla va al 50 %. Todo a escala de un punto físico.
      const pluma = 0.95 * s, temblor = 0.42 * s, mordida = 0.5, lejos = pluma + 3.2 * temblor;
      const bx = W / 2 - out, by = H / 2 - out;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const px = Math.abs(x + 0.5 - W / 2) - (bx - R);
          const py = forma === 'h' ? (out + R) - (y + 0.5) : Math.abs(y + 0.5 - H / 2) - (by - R);
          let sdf = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - R;   // < 0 dentro
          if (forma === 'm') sdf = -sdf;                                                                // el marco pinta lo de fuera del hueco
          let a;
          if (sdf < -lejos) a = 1;
          else if (sdf > lejos) a = 0;
          else {
            const v = n[(y % E) * E + (x % E)];
            const t = Math.min(1, Math.max(0, (-sdf + v * temblor + pluma) / (2 * pluma)));
            const sm = t * t * (3 - 2 * t);
            a = Math.min(1, Math.max(0, sm + v * mordida * 4 * sm * (1 - sm)));
          }
          const i = (y * W + x) * 4;
          d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = Math.round(255 * a * k);
        }
      }
      g.putImageData(img, 0, 0);
      return cv;
    }
    // La mascota (el disparador) no es un rectángulo: su canto se hace con una máscara de su silueta,
    // horneada igual que las texturas (mismo ruido, misma pluma, mismo temblor, misma mordida). La
    // silueta son las tres capas del cuerpo con un trazo fino (MASCARA_TRAZO): la línea de tinta que la
    // rodea es más ancha (silueta.css), así que el canto comido cae sobre la línea y la deja «diluida en
    // grano» sin borrarla. Se mide la distancia de cada punto al contorno (transformada de distancia en
    // dos pasadas) y se aplica la misma fórmula de hornear(). El ruido es fijo: la máscara no hierve.
    const MASCARA_TRAZO = 0.96;                                     // en unidades del dibujo (× 1,2464 = 1,2 px CSS)
    function hornearMascota(s, E) {
      const W = Math.round(88 * s), H = Math.round(84 * s), n = ruido(E);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.setTransform(s, 0, 0, s, 0, 0);
      g.translate(-2.0139528, -5.7885711); g.scale(1.2463874, 1.2463874);
      const cuerpo = new Path2D(CUERPO);
      g.lineJoin = 'round'; g.lineWidth = MASCARA_TRAZO; g.fillStyle = g.strokeStyle = '#000';
      for (const [x, y] of [[8.8, 9.6], [4.4, 4.8], [0, 0]]) { g.save(); g.translate(x, y); g.fill(cuerpo); g.stroke(cuerpo); g.restore(); }
      const img = g.getImageData(0, 0, W, H), d = img.data, dentro = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) dentro[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
      const R2 = Math.SQRT2, distancia = clase => {
        const t = new Float32Array(W * H);
        for (let i = 0; i < t.length; i++) t[i] = dentro[i] === clase ? 0 : 1e9;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x; let v = t[i]; if (!v) continue;
          if (x) v = Math.min(v, t[i - 1] + 1);
          if (y) { v = Math.min(v, t[i - W] + 1); if (x) v = Math.min(v, t[i - W - 1] + R2); if (x < W - 1) v = Math.min(v, t[i - W + 1] + R2); }
          t[i] = v;
        }
        for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
          const i = y * W + x; let v = t[i]; if (!v) continue;
          if (x < W - 1) v = Math.min(v, t[i + 1] + 1);
          if (y < H - 1) { v = Math.min(v, t[i + W] + 1); if (x < W - 1) v = Math.min(v, t[i + W + 1] + R2); if (x) v = Math.min(v, t[i + W - 1] + R2); }
          t[i] = v;
        }
        return t;
      };
      const aDentro = distancia(1), aFuera = distancia(0);
      const pluma = 0.95 * s, temblor = 0.42 * s, mordida = 0.5, lejos = pluma + 3.2 * temblor;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, sdf = dentro[i] ? -(aFuera[i] - 0.5) : aDentro[i] - 0.5;
        let a;
        if (sdf < -lejos) a = 1;
        else if (sdf > lejos) a = 0;
        else {
          const v = n[(y % E) * E + (x % E)];
          const t = Math.min(1, Math.max(0, (-sdf + v * temblor + pluma) / (2 * pluma)));
          const sm = t * t * (3 - 2 * t);
          a = Math.min(1, Math.max(0, sm + v * mordida * 4 * sm * (1 - sm)));
        }
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.round(255 * a);
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.putImageData(img, 0, 0);
      return cv;
    }
    // Se espera a un rato libre del hilo principal (o, como mucho, 150 ms); si en ese rato queda tiempo, se
    // hornea más de una textura seguida.
    let libre = null;
    const pausa = () => (libre && libre.timeRemaining() > 6 ? Promise.resolve() : new Promise(res => (window.requestIdleCallback ? requestIdleCallback(d => { libre = d; res(); }, { timeout: 150 }) : setTimeout(() => { libre = null; res(); }, 16))));
    const densidad = () => Math.min(4, Math.max(1, window.devicePixelRatio || 1));
    async function todas() {
      const mia = ++vuelta, t0 = performance.now();
      const s = densidad(), E = Math.round(E_CSS * s);
      const cortes = Object.fromEntries(Object.entries(CORTES).map(([r, c]) => [r, Math.round(c * s)]));
      const nuevas = [], props = [];
      let trabajo = 0;
      const suelta = () => nuevas.forEach(u => URL.revokeObjectURL(u));
      for (const [nombre, variable, r, forma] of PIEZAS) {
        await pausa();                                                // en ratos libres: ningún cuadro espera
        if (mia !== vuelta || body.dataset.piel !== 'interfaz') { suelta(); return; }
        const t = performance.now();
        const cv = forma === 'mascota' ? hornearMascota(s, E) : hornear(rgba(getComputedStyle(body).getPropertyValue(variable).trim() || '#000'), r, forma, cortes[forma === 'h' ? 'h26' : r], E);
        trabajo += performance.now() - t;
        const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
        if (mia !== vuelta) { suelta(); return; }
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        nuevas.push(url); props.push(['--si-f-' + nombre, 'url("' + url + '")']);
      }
      // Todas a la vez: ninguna pieza se queda con la textura del tema de antes.
      const root = document.documentElement.style;
      for (const [k, v] of props) root.setProperty(k, v);
      for (const [r, c] of Object.entries(cortes)) root.setProperty('--si-sl-' + r, String(c));
      escala = s; horneadas = props.length; ms = Math.round(trabajo);
      const viejas = urls;
      urls = nuevas;
      // (las de antes se sueltan cuando la página ya pinta con las nuevas: ninguna URL queda viva sin uso)
      requestAnimationFrame(() => requestAnimationFrame(() => viejas.forEach(u => URL.revokeObjectURL(u))));
      body.classList.add('si-bordes-listos');
      dispatchEvent(new CustomEvent('flip:bordes', { detail: { escala: s, texturas: horneadas, ms, total: Math.round(performance.now() - t0) } }));
    }
    const pedir = () => { clearTimeout(timer); timer = setTimeout(() => { if (body.dataset.piel === 'interfaz') todas(); }, 40); };
    new MutationObserver(pedir).observe(body, { attributes: true, attributeFilter: ['data-tema'] });
    addEventListener('resize', () => { if (escala && densidad() !== escala) pedir(); });
    return { pedir, estado: () => ({ listo: body.classList.contains('si-bordes-listos'), escala, texturas: horneadas, vivas: urls.length, ms, piezas: PIEZAS.map(p => p[0]) }) };
  })();

  // ── Apariencia: piel, tema y grano, juntos al pie del lanzador ──────────────
  const personal = el('div', { class: 'si-personal', role: 'group', 'aria-label': 'Apariencia' }, '<small>APARIENCIA</small>');
  const pielKey = el('button', { type: 'button', id: 'flipPiel', class: 'hw hw-keycap', 'aria-label': 'Cambiar entre la piel de interfaz y la de objeto' });
  personal.appendChild(pielKey);
  for (const id of ['rolloTema', 'rolloGrano']) { const key = $(id); if (key) personal.appendChild(key); }
  launcher.appendChild(personal);

  function setPiel(value) {
    const piel = value === 'objeto' ? 'objeto' : 'interfaz';
    body.dataset.piel = piel;
    try { localStorage.setItem(KEY, piel); } catch (_) {}
    // La tecla dice a qué piel se cambia al pulsarla.
    pielKey.textContent = piel === 'interfaz' ? 'PIEL OBJETO' : 'PIEL INTERFAZ';
    pielKey.setAttribute('aria-pressed', String(piel === 'interfaz'));
    // Las teclas de variante: en la banda (OBJETO) o dentro del cajón (INTERFAZ).
    if (piel === 'interfaz') cajon.querySelector('.si-cajon-variantes').appendChild(variants);
    else { hueco.after(variants); abrir(false); }
    pintarBanda();
    shell.measureDeck();
    requestAnimationFrame(() => { shell.measureDeck(); dispatchEvent(new Event('resize')); if (window.flipGrano) flipGrano.paint(); });
    if (piel === 'interfaz') horno.pedir();
  }
  pielKey.addEventListener('click', () => setPiel(body.dataset.piel === 'interfaz' ? 'objeto' : 'interfaz'));
  let piel = 'interfaz';
  try { if (localStorage.getItem(KEY) === 'objeto') piel = 'objeto'; } catch (_) {}
  setPiel(piel);
  window.flipPiel = { set: setPiel, get: () => body.dataset.piel, wink: guinar, drawer: abrir, dizzy: marear, bordes: horno.estado };
})();
