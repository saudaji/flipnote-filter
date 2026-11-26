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
  document.documentElement.style.setProperty('--si-mascota', svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 5 66 58"><path d="${CUERPO}" fill="#7DDB8B"/><path d="${OJO_CERRADO}" fill="#FFF3DF"/><circle cx="43" cy="34" r="8" fill="#FFF3DF"/><circle cx="43" cy="34" r="4.3" fill="#151727"/></svg>`));
  document.documentElement.style.setProperty('--si-mascota-dormida', svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 5 66 58"><path d="${CUERPO}" fill="none" stroke="#000" stroke-width="3.4" stroke-linejoin="round"/><path d="${OJO_CERRADO}"/><path transform="translate(65.5 -1) scale(-1 1)" d="${OJO_CERRADO}"/></svg>`));
  // El grano se pinta a un número entero de píxeles de pantalla por punto (ver silueta.css).
  const granoPx = () => { const dpr = Math.max(1, window.devicePixelRatio || 1), k = Math.max(1, Math.round(dpr / 2)); document.documentElement.style.setProperty('--grano-px', (256 * k / dpr).toFixed(4) + 'px'); };
  granoPx();
  addEventListener('resize', granoPx);

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
  }
  let pintarPendiente = false;
  const pintarLuego = () => { if (pintarPendiente) return; pintarPendiente = true; queueMicrotask(() => { pintarPendiente = false; pintarBanda(); }); };
  new MutationObserver(pintarLuego).observe(variants, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  new MutationObserver(pintarLuego).observe(looks, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

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
  placa.addEventListener('pointerup', event => {
    const now = performance.now();
    if (now - placaAt > 340) { placaAt = now; return; }
    placaAt = 0;
    const cerrar = on => shutter.classList.toggle('guino', on);
    clearTimeout(guinoTimer);
    cerrar(true); setTimeout(() => cerrar(false), 90); setTimeout(() => cerrar(true), 170); setTimeout(() => cerrar(false), 260);
    if (window.flipFeel) { flipFeel.tap('wink', 'down', event.clientX); setTimeout(() => flipFeel.tap('key', 'up', event.clientX), 110); }
  });

  // El grano de esta piel va encima de cada barra: el cajón y la botonera de los demás modos son
  // barras que la piel OBJETO no cuenta (allí el grano les llega de la carcasa de fondo).
  for (const host of [cajon, $('modeDeck')]) if (host && !host.querySelector(':scope > .grano')) host.appendChild(el('i', { class: 'grano', 'aria-hidden': 'true' }));

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
  }
  pielKey.addEventListener('click', () => setPiel(body.dataset.piel === 'interfaz' ? 'objeto' : 'interfaz'));
  let piel = 'interfaz';
  try { if (localStorage.getItem(KEY) === 'objeto') piel = 'objeto'; } catch (_) {}
  setPiel(piel);
  window.flipPiel = { set: setPiel, get: () => body.dataset.piel, wink: guinar, drawer: abrir, dizzy: marear };
})();
