// FLIP FL-27 · el aparato.
// Construye la interfaz física (banda superior con su pantallita, visor, botonera de CAM,
// lanzador de módulos, visor de la última toma) y la conecta al motor que ya existe en
// index.html. No reimplementa nada: cada mando llama a la misma función o pulsa el mismo
// control de siempre.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, html = '') => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    node.innerHTML = html;
    return node;
  };

  // ── Iconos (trazo propio, sin emoji) ────────────────────────────────────────
  const PATHS = {
    cam: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.4-2h7.2L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/>',
    video: '<rect x="3" y="6.5" width="12.5" height="11" rx="2"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/>',
    flip: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20v-4.7h4.7"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>',
    audio: '<path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4.5 4"/>',
    share: '<path d="M12 15V4"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/>',
    folder: '<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5"/><path d="M4 4v4.5h4.5"/>',
    rec: '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
    dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    ascii: '<path d="M4 18 8 6l4 12M5.5 14h5"/><path d="M15 9.5h5.5M14.5 13.5H20M17 6.5l-1 10M20 6.5l-1 10"/>',
    sono: '<path d="M3 12h2l2-6 3 13 3-16 3 12 2-5 1 2h2"/>',
    wmp: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    scrash: '<path d="M4 6h10M9 6v4h11M4 14h7v4h9M4 18h3"/>',
    fusion: '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
    sflow: '<circle cx="12" cy="7" r="3"/><path d="M6 20c0-4 2.5-6.5 6-6.5s6 2.5 6 6.5"/><path d="M3 10c0-3 1.5-5.5 3.5-6.5M21 10c0-3-1.5-5.5-3.5-6.5"/>',
    edit: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
    stage: '<rect x="3" y="5" width="18" height="11" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
    portal: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><path d="M9 9.5h6v5H9z"/>',
    hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11m0-1.5V5a1.5 1.5 0 0 1 3 0v6m0-3.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.6a5 5 0 0 1-3.9-1.9L4.5 15a1.6 1.6 0 0 1 2.4-2.1L8 14"/>',
  };
  if (window.flipRollo) Object.assign(PATHS, flipRollo.paths);
  const icon = (name, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${PATHS[name] || ''}</svg>`;
  const maskCache = {};
  const iconMask = name => maskCache[name] || (maskCache[name] = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${(PATHS[name] || '').replace(/currentColor/g, '#000')}</svg>`) + '")');

  // Módulos: clave, nombre, descripción y color de su botón.
  const MODULES = [
    ['cam', 'CAM', 'Cámara y filtros', '#ec5b45'], ['portal', 'PORTAL', 'Abre una ventana con las manos', '#8b79d6'],
    ['ascii', 'ASCII', 'Imagen con caracteres', '#566679'], ['sflow', 'FLOW', 'Siluetas y tipografía', '#33b09f'],
    ['scrash', 'GLITCH', 'Distorsión de imagen', '#f08a2d'], ['fusion', 'FUSION', 'Cámara + glitch', '#2f78dc'],
    ['sono', 'SONO', 'Ondas de sonido', '#3ca956'], ['wmp', 'WMP', 'Visualizador musical', '#f0ae2b'],
    ['edit', 'EDIT', 'Edición por capas', '#7d7768'], ['stage', 'STAGE', 'Central de visuales en vivo', '#3b3c3f'],
  ];
  if (window.flipRollo) for (const item of MODULES) item[3] = flipRollo.palette[item[0]][0];
  // Cuatro modos, y dentro de cada uno sus variantes (los diez módulos del motor). Quien abre el
  // lanzador elige entre cuatro cosas, no entre diez: [id, nombre, qué es, icono, [[módulo, rótulo]…]].
  const MODES = [
    ['camara', 'CÁMARA', 'Cámaras de otra época, ASCII, glitch y PORTAL', 'cam', [['cam', 'RETRO'], ['portal', 'PORTAL'], ['ascii', 'ASCII'], ['sflow', 'FLOW'], ['scrash', 'GLITCH']]],
    ['sono', 'SONO', 'Tu música, en imagen', 'sono', [['sono', 'ONDAS'], ['wmp', 'ESCENAS']]],
    ['estudio', 'ESTUDIO', 'Fotos y videos por capas', 'edit', [['edit', 'CAPAS'], ['fusion', 'FUSIÓN']]],
    ['stage', 'STAGE', 'Visuales en vivo y proyección', 'stage', [['stage', 'STAGE']]],
  ];
  const modeOf = key => MODES.find(mode => mode[4].some(sub => sub[0] === key)) || MODES[0];
  const lastOf = mode => { try { const key = localStorage.getItem('flip.modo.' + mode[0]); if (mode[4].some(sub => sub[0] === key)) return key; } catch (_) {} return mode[4][0][0]; };

  // ── Construcción ────────────────────────────────────────────────────────────
  document.body.prepend(el('div', { id: 'camBody', 'aria-hidden': 'true' }));
  const top = el('header', { id: 'shellTop' }, `
    <button class="hw hw-keycap" data-color="slate" id="shellModule" type="button" aria-haspopup="dialog" aria-label="Cambiar de módulo">${icon('cam')}<span id="shellModuleName">CAM</span>${icon('chev', 'class="chev"')}</button>
    <div class="hw-lcd" id="shellLcd" role="status" aria-live="off">
      <div id="lcdLine1"><span id="lcdLook">FLIP</span><span id="lcdRec"><i></i><span id="lcdRecTime">REC 00:00</span></span></div>
      <div id="lcdLine2"><span id="lcdFps">-- FPS</span><span id="lcdFormat">4:3 HD</span><span class="lcd-batt" id="lcdBatt" hidden><i></i><i></i><i></i><i></i></span></div>
      <div id="lcdReadout" aria-hidden="true"><div><span id="lcdParam"></span><span id="lcdValue"></span></div><div id="lcdBar">${'<i></i>'.repeat(16)}</div></div>
    </div>
    <button class="hw hw-candy sm" id="shellMic" type="button" aria-label="Micrófono">${icon('mic')}</button>
    <button class="hw hw-candy sm" id="shellAudio" type="button" aria-label="Entradas de audio">${icon('audio')}</button>
    <button class="hw hw-candy sm" data-color="slate" id="shellSettings" type="button" aria-label="Formato, resolución y audio">${icon('gear')}</button>`);
  const lcd = el('div', { id: 'lcd', 'aria-hidden': 'true' });
  const osd = el('div', { id: 'osd' }, `
    <div id="osdFrame"></div>
    <div id="osdRec"><i></i><span id="osdRecTime">00:00</span></div>
    <div id="osdHint" role="status"></div>`);
  const deck = el('footer', { id: 'camDeck' }, `
    <div class="deck-variants" id="deckVariants" role="tablist" aria-label="Variante"></div>
    <div class="deck-looks"><div class="deck-looks-track" id="deckLooks" role="listbox" aria-label="Cámaras"></div></div>
    <div class="deck-main">
      <div class="deck-left">
        <button class="hw" id="deckGallery" type="button" aria-label="Ver la última toma"><b>${icon('image')}</b></button>
        <div class="deck-mode">
          <span class="hw-print"><b data-mode-label="foto">FOTO</b><b data-mode-label="video">VIDEO</b></span>
          <button class="hw hw-switch" id="deckModeSwitch" type="button" role="switch" aria-checked="false" aria-label="Foto o video"><i></i></button>
        </div>
      </div>
      <button class="hw" id="deckShutter" type="button" aria-label="Disparar"><i></i></button>
      <div class="deck-right">
        <div class="hw-labeled"><button class="hw hw-candy" data-color="mustard" id="deckAdjust" type="button" aria-label="Ajustes de esta cámara">${icon('sliders')}</button><span class="hw-print">AJUSTES</span></div>
        <div class="hw-labeled"><button class="hw hw-candy" data-color="mint" id="deckFlip" type="button" aria-label="Cambiar entre cámara frontal y trasera">${icon('flip')}</button><span class="hw-print">GIRAR</span></div>
      </div>
    </div>`);
  const launcher = el('div', { id: 'shellLauncher', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Modos de FLIP' }, `
    <div class="launcher-head"><h2>MODOS</h2><button class="hw hw-candy sm" id="launcherClose" type="button" aria-label="Cerrar">${icon('close')}</button></div>
    <div class="launcher-grid">${MODES.map(([id, title, sub, ico, subs]) => subs.length === 1
      ? `<button class="hw launcher-card" type="button" data-mode="${id}" data-module="${subs[0][0]}"><em>${icon(ico)}</em><strong>${title}</strong><small>${sub}</small>${id === 'stage' ? '<u>PRO</u>' : ''}</button>`
      : `<div class="launcher-card" data-mode="${id}"><button class="hw launcher-modo" type="button" data-go-mode="${id}"><em>${icon(ico)}</em><strong>${title}</strong><small>${sub}</small></button>` +
        `<div class="launcher-subs" role="group" aria-label="Variantes de ${title}">${subs.map(([key, label]) => `<button class="hw launcher-sub" type="button" data-module="${key}">${label}</button>`).join('')}</div></div>`).join('')}</div>`);
  const viewer = el('div', { id: 'shellViewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Última toma' }, `
    <div class="launcher-head"><h2>ÚLTIMA TOMA</h2><button class="hw hw-candy sm" id="viewerClose" type="button" aria-label="Cerrar">${icon('close')}</button></div>
    <div class="viewer-stage" id="viewerStage"></div>
    <div class="viewer-meta" id="viewerMeta"></div>
    <div class="viewer-actions"><button type="button" id="viewerSave">Guardar otra vez</button><button type="button" class="primary" id="viewerShare">Compartir</button></div>`);
  document.body.append(top, lcd, osd, deck, launcher, viewer);

  // La portada: el aparato saluda en su pantalla.
  const splashEl = $('splash');
  if (splashEl) {
    splashEl.prepend(el('div', { class: 'splash-hero', 'aria-hidden': 'true' }, '<b>hola</b><u>FL-27 · LISTA</u>'));
    const title = splashEl.querySelector('.splash-title');
    if (title) title.after(el('div', { class: 'splash-tag' }, '<i></i>FL-27 · cámara digital'));
  }
  if (window.flipRollo) flipRollo.mount(splashEl, deck, launcher);

  // ── Grano mate ──────────────────────────────────────────────────────────────
  // Cada material del aparato lleva su grano (shell.css, .grano): relieve en el plástico, apenas
  // en lo lustroso y en el cristal, de película en el logo de la portada. El visor, los lienzos de
  // los módulos, las fotos y lo que flota sobre ellos (avisos, la barra de exportar, el ajuste de
  // SFLOW) no están en ninguna lista: la imagen se queda limpia. Se enciende y se apaga con la tecla GRANO del lanzador (y se recuerda).
  const GRANO_BARRAS = '#shellTop, #camDeck, #flipBottomNav, #barSflow, #barEdit, #barStage, #scrashControls, #fusionHUD, #sonoHUD, #wmpHUD, #editHUD, .rig-side';
  const GRANO_HOJAS = '#lcd, #flipSettingsPanel, #shellLauncher, #shellViewer, #splash, #asciiPanel, #upPanel, .rig-panel, .cs-rack';
  const GRANO_PIEZAS = '.hw-candy, #deckShutter, .hw-lcd, #deckGallery';
  const GRANO_KEY = 'flip.rollo.grano';
  let granoTimer = 0;
  const granoSoon = () => { clearTimeout(granoTimer); granoTimer = setTimeout(grano, 140); };
  // Si una pieza rehace su contenido (la pantallita al arrancar), su capa vuelve sola.
  const granoWatch = new MutationObserver(() => granoSoon());
  const capaGrano = (host, kind) => {
    let layer = host.querySelector(':scope > .grano');
    if (!layer) {
      layer = el('i', { class: 'grano' + (kind ? ' ' + kind : ''), 'aria-hidden': 'true' });
      host.appendChild(layer);
      if (getComputedStyle(host).position === 'static') host.classList.add('grano-ancla');
      granoWatch.observe(host, { childList: true });
    }
    return layer;
  };
  function grano() {
    if (document.body.dataset.grano === 'no') return;
    document.querySelectorAll(GRANO_BARRAS + ', ' + GRANO_HOJAS).forEach(surface => {
      const layer = capaGrano(surface);
      if (surface.id === 'lcd') return;
      // Una hoja con desplazamiento: el grano cubre todo su contenido, no solo lo que asoma.
      if (layer.style.height) layer.style.height = '';
      if (surface.scrollHeight > surface.clientHeight + 1) layer.style.height = surface.scrollHeight + 'px';
    });
    // Las piezas están pintadas en su borde (border-image): su capa cubre la pieza entera.
    document.querySelectorAll(GRANO_PIEZAS).forEach(piece => {
      const layer = capaGrano(piece, 'leve'), style = getComputedStyle(piece);
      const b = ['Left', 'Top', 'Right', 'Bottom'].map(side => parseFloat(style['border' + side + 'Width']) || 0);
      const box = b.join(' ');
      if (layer.dataset.borde === box) return;
      layer.dataset.borde = box;
      layer.style.left = -b[0] + 'px'; layer.style.top = -b[1] + 'px';
      layer.style.width = 'calc(100% + ' + (b[0] + b[2]) + 'px)'; layer.style.height = 'calc(100% + ' + (b[1] + b[3]) + 'px)';
    });
    const hero = document.querySelector('.splash-hero');
    if (hero) capaGrano(hero, 'pelicula');
    // La carcasa de fondo lleva su grano en todo menos donde hay una barra, que trae el suyo:
    // así no hay franja sin grano entre piezas ni sitio donde se junten dos capas.
    const body = $('camBody');
    if (body) {
      const layer = capaGrano(body), base = layer.getBoundingClientRect();
      let path = 'M0 0H' + base.width.toFixed(1) + 'V' + base.height.toFixed(1) + 'H0Z';
      document.querySelectorAll(GRANO_BARRAS).forEach(bar => {
        const r = bar.getBoundingClientRect(), style = getComputedStyle(bar);
        if (r.width < 8 || r.height < 8 || style.display === 'none' || style.visibility === 'hidden') return;
        path += 'M' + (r.left - base.left).toFixed(1) + ' ' + (r.top - base.top).toFixed(1) + 'h' + r.width.toFixed(1) + 'v' + r.height.toFixed(1) + 'h' + (-r.width).toFixed(1) + 'Z';
      });
      layer.style.clipPath = 'path(evenodd, "' + path + '")';
    }
  }
  const setGrano = on => {
    document.body.dataset.grano = on ? 'si' : 'no';
    try { localStorage.setItem(GRANO_KEY, on ? 'si' : 'no'); } catch (_) {}
    const key = $('rolloGrano');
    if (key) { key.textContent = on ? 'SIN GRANO' : 'CON GRANO'; key.setAttribute('aria-pressed', String(on)); }
    if (on) grano();
  };
  let granoOn = true;
  try { granoOn = localStorage.getItem(GRANO_KEY) !== 'no'; } catch (_) {}
  const head = launcher.querySelector('.launcher-head');
  if (head) {
    const key = el('button', { type: 'button', id: 'rolloGrano', class: 'hw hw-keycap', 'aria-label': 'Poner o quitar el grano mate del aparato' });
    key.addEventListener('click', () => setGrano(document.body.dataset.grano === 'no'));
    head.insertBefore(key, head.querySelector('#launcherClose'));
  }
  setGrano(granoOn);
  new MutationObserver(granoSoon).observe(document.body, { attributes: true, attributeFilter: ['data-tab', 'data-tema'] });
  addEventListener('click', granoSoon, true);
  addEventListener('resize', granoSoon);
  window.flipGrano = { paint: grano, set: setGrano, on: () => document.body.dataset.grano !== 'no' };

  // ── Geometría del visor ─────────────────────────────────────────────────────
  // relayout() pregunta aquí cuánto mide el cristal donde va el visor de CAM.
  window.flipShellGlass = function () {
    const rect = osd.getBoundingClientRect();
    return rect.width > 40 && rect.height > 40 ? { w: rect.width, h: rect.height } : null;
  };
  let deckHeight = -1;
  function measureDeck() {
    if (document.body.dataset.tab !== 'cam') return;
    const landscape = matchMedia('(orientation: landscape) and (max-height: 540px)').matches;
    const height = landscape ? 0 : Math.round(deck.getBoundingClientRect().height);
    if (height !== deckHeight) {
      deckHeight = height;
      document.documentElement.style.setProperty('--deck-h', height + 'px');
    }
    if (typeof relayout === 'function') relayout();
    frameMarks();
  }
  // Las esquinas de encuadre se colocan sobre la imagen, un poco hacia dentro.
  function frameMarks() {
    const glass = osd.getBoundingClientRect(), image = display.getBoundingClientRect();
    if (!glass.width || !image.width) return;
    osd.style.setProperty('--frame-x', ((glass.width - image.width) / 2 + image.width * 0.07).toFixed(1) + 'px');
    osd.style.setProperty('--frame-y', ((glass.height - image.height) / 2 + image.height * 0.07).toFixed(1) + 'px');
  }
  new ResizeObserver(frameMarks).observe(display);
  new ResizeObserver(measureDeck).observe(deck);
  window.addEventListener('resize', () => requestAnimationFrame(measureDeck));
  window.addEventListener('orientationchange', () => setTimeout(measureDeck, 250));

  // ── CAM: diapositivas, variantes, modo ──────────────────────────────────────
  const looks = $('deckLooks'), variants = $('deckVariants');
  const describe = {};
  document.querySelectorAll('.cam-fam-btn').forEach(btn => { describe[btn.dataset.family] = btn.querySelector('small')?.textContent || ''; });
  Object.entries(CAM_FAMILIES).forEach(([key, cfg]) => {
    const tile = el('button', { class: 'hw look', type: 'button', role: 'option', 'data-family': key, title: describe[key] || '' }, `<i></i><span>${cfg.displayLabel || cfg.label}</span>`);
    tile.firstChild.style.backgroundImage = `url('./body/look-${key}.webp')`;
    looks.appendChild(tile);
  });
  let hintTimer = 0;
  function hint(text, ms = 1900) {
    const node = $('osdHint');
    if (!text) { node.classList.remove('is-on'); return; }
    node.textContent = text;
    node.classList.add('is-on');
    clearTimeout(hintTimer);
    if (ms > 0) hintTimer = setTimeout(() => node.classList.remove('is-on'), ms);
  }
  // Otros módulos (Portal) pueden añadir diapositivas propias y atender su pulsación.
  const lookHandlers = [];
  looks.addEventListener('click', event => {
    const tile = event.target.closest('.look');
    if (!tile) return;
    for (const handler of lookHandlers) if (handler(tile) === true) return;
    if (!tile.dataset.family || tile.dataset.family === camFamily) return;
    _setCamFamily(tile.dataset.family);
    hint(describe[tile.dataset.family]);
  });
  variants.addEventListener('click', event => {
    const key = event.target.closest('[data-variant]');
    if (!key) return;
    const changed = camVariant !== key.dataset.variant;
    camVariant = key.dataset.variant;
    _applyCamState();
    saveSettings();
    const text = _getCamFamilyConfig().variants.find(v => v.id === camVariant)?.hint;
    if (changed && text) flipToast(text, 4200);
  });

  // Un marco de nueve cortes solo se pinta sin costuras si su ancho cae en píxeles enteros de la
  // pantalla; con densidades como 2,625 o 3,5 no cae, y entre corte y corte asoma una raya del fondo.
  function snapEdges() {
    const dpr = window.devicePixelRatio || 1, root = document.documentElement.style;
    for (const n of [9, 12, 17, 18, 20, 21, 22]) root.setProperty('--bw' + n, (Math.max(1, Math.round(n * dpr)) / dpr).toFixed(4) + 'px');
  }
  snapEdges();
  addEventListener('resize', snapEdges);

  let shownFamily = '';
  // Mientras se mueve un mando, la pantallita dice cuál es y cuánto vale (y vuelve sola a lo suyo).
  let readoutTimer = 0;
  function readout(label, value, ratio) {
    const box = $('shellLcd');
    $('lcdParam').textContent = label || '';
    $('lcdValue').textContent = value == null ? '' : String(value);
    const cells = $('lcdBar').children, lit = ratio == null ? -1 : Math.round(ratio * cells.length);
    $('lcdBar').style.visibility = ratio == null ? 'hidden' : '';
    for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('on', i < lit);
    box.classList.add('is-readout');
    clearTimeout(readoutTimer);
    readoutTimer = setTimeout(() => box.classList.remove('is-readout'), 1600);
  }
  const lookLabel = { text: null };
  function syncCam() {
    const cfg = _getCamFamilyConfig();
    const custom = document.body.dataset.look || '';
    looks.querySelectorAll('.look').forEach(tile => {
      const on = custom ? tile.dataset.look === custom : tile.dataset.family === camFamily;
      tile.classList.toggle('is-on', on);
      tile.setAttribute('aria-selected', String(on));
    });
    if (shownFamily !== camFamily + custom) {
      shownFamily = camFamily + custom;
      const active = looks.querySelector('.look.is-on');
      if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    const list = custom ? [] : (cfg.variants || []);
    const signature = (custom || camFamily) + ':' + list.map(v => v.id).join(',');
    if (variants.dataset.signature !== signature) {
      variants.dataset.signature = signature;
      variants.dataset.count = String(list.length);
      variants.innerHTML = list.map(v => `<button class="hw hw-keycap" type="button" role="tab" data-variant="${v.id}"${v.hint ? ` title="${v.hint.replace(/"/g, '&quot;')}"` : ''}><span>${v.label}</span></button>`).join('');
      variants.style.visibility = list.length ? '' : 'hidden';
    }
    variants.querySelectorAll('[data-variant]').forEach(key => {
      const on = key.dataset.variant === camVariant;
      key.classList.toggle('is-on', on);
      key.setAttribute('aria-selected', String(on));
    });
    const variantLabel = list.find(v => v.id === camVariant)?.label || '';
    const name = lookLabel.text || (cfg.soloVariante && variantLabel && camVariant !== 'NUEVO' ? variantLabel : (cfg.displayLabel || cfg.label) + (list.length > 1 ? ' · ' + variantLabel : ''));
    $('lcdLook').textContent = (document.body.classList.contains('portal-mode') ? 'PORTAL ' : '') + name;
    syncFormat();
  }
  function syncFormat() {
    const res = { low: 'SD', medium: 'HD', high: 'HD+' }[flipAudioSettings?.resolution] || '';
    $('lcdFormat').textContent = _getCurrentAspectId() + (res ? ' ' + res : '');
  }

  const btnMode = $('btnRecord'), btnShot = $('btnCapture');
  function syncMode() {
    const video = camMode === 'video';
    document.body.classList.toggle('cam-video', video);
    $('deckModeSwitch').setAttribute('aria-checked', String(video));
    deck.querySelectorAll('[data-mode-label]').forEach(label => label.classList.toggle('is-on', (label.dataset.modeLabel === 'video') === video));
    const recording = btnShot.classList.contains('recording');
    document.body.classList.toggle('is-recording', recording);
    $('deckShutter').setAttribute('aria-label', recording ? 'Detener la grabación' : video ? 'Grabar video' : 'Tomar foto');
    const time = (btnShot.querySelector('.btn-icon')?.textContent || '').trim();
    const shown = /^\d\d:\d\d$/.test(time) ? time : '00:00';
    $('osdRecTime').textContent = shown;
    $('lcdRecTime').textContent = 'REC ' + shown;
  }
  new MutationObserver(syncMode).observe(btnMode, { subtree: true, childList: true, characterData: true });
  new MutationObserver(syncMode).observe(btnShot, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });

  // ── Una sola botonera para todos los modos ──────────────────────────────────
  // El pupitre de la cámara (última toma, FOTO/VIDEO, disparador, AJUSTES y un botón de contexto)
  // es el mismo en ASCII, GLITCH, FUSIÓN, SONO, WMP y EDIT: la misma pieza se muda de sitio y
  // cada mando llama al botón propio del módulo, que sigue existiendo, oculto.
  //   toggle + shoot: módulos con su propio modo foto/video.   snap + rec: módulos con dos botones.
  //   hud: la consola que AJUSTES abre y cierra.   source: lo que hace FUENTE (si no, GIRAR).
  const DECKS = {
    ascii: { video: () => asciiCamMode === 'video', toggle: 'btnAsciiMode', shoot: 'btnAsciiCapture', adjust: () => $('btnAsciiEdit').click() },
    scrash: { video: () => scrashCamMode === 'video', toggle: 'btnScrashMode', shoot: 'btnScrashSnap', hud: true },
    fusion: { snap: 'btnFusionSnap', rec: 'btnFusionRec', hud: true },
    sono: { snap: 'btnSonoCapture', rec: 'btnSonoRec', hud: true, source: () => $('sonoPerm').classList.toggle('visible') },
    wmp: { snap: 'btnWmpCapture', rec: 'btnWmpRec', hud: true, source: () => $('wmpPerm').classList.toggle('visible') },
    edit: { snap: 'btnEditSnap', rec: 'btnEditRec', hud: true, open: true, source: () => $('editFileInput').click() },
  };
  // WMP tiene dos mandos propios que no caben en la botonera común: reproducir o pausar el
  // archivo, y la pantalla completa. Van sobre su pantalla, abajo a la izquierda.
  const wmpArea = $('wmpArea');
  if (wmpArea) {
    const transport = el('div', { id: 'wmpTransport' }, `
      <button class="hw" id="wmpPlay" type="button" aria-label="Reproducir o pausar">${icon('play')}</button>
      <button class="hw" id="wmpFull" type="button" aria-label="Pantalla completa">${icon('full')}</button>`);
    document.body.appendChild(transport);
    const play = $('btnWmpPlayPause');
    const mirror = () => {
      $('wmpPlay').hidden = !play || play.disabled;
      const glyph = ((play && (play.querySelector('.btn-icon') || play).textContent) || '').trim();
      $('wmpPlay').querySelector('svg').outerHTML = icon(glyph === '⏸' ? 'pause' : 'play');
    };
    if (play) new MutationObserver(mirror).observe(play, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
    mirror();
    $('wmpPlay').addEventListener('click', () => play && !play.disabled && play.click());
    $('wmpFull').addEventListener('click', () => $('btnWmpFull') && $('btnWmpFull').click());
  }
  const deckMain = deck.querySelector('.deck-main');
  const modeDeck = el('footer', { id: 'modeDeck' });
  document.body.appendChild(modeDeck);
  const deckVideo = {}, consoleOpen = {};
  for (const [tab, spec] of Object.entries(DECKS)) consoleOpen[tab] = !!spec.open;
  const deckOf = () => (activeTab !== 'cam' && DECKS[activeTab]) || null;
  const deckRecording = spec => { const node = $(spec.rec || spec.shoot); return !!node && node.classList.contains('recording'); };
  const deckIsVideo = spec => (spec.video ? spec.video() : !!deckVideo[activeTab]);
  function paintDeck() {
    const spec = deckOf();
    if (!spec) return;
    const video = deckIsVideo(spec), recording = deckRecording(spec);
    document.body.classList.toggle('cam-video', video || recording);
    document.body.classList.toggle('is-recording', recording);
    $('deckModeSwitch').setAttribute('aria-checked', String(video));
    deckMain.querySelectorAll('[data-mode-label]').forEach(label => label.classList.toggle('is-on', (label.dataset.modeLabel === 'video') === video));
    $('deckShutter').setAttribute('aria-label', recording ? 'Detener la grabación' : video ? 'Grabar video' : 'Tomar foto');
    $('deckAdjust').setAttribute('aria-pressed', String(spec.hud ? !!consoleOpen[activeTab] : false));
  }
  // La consola de un módulo (sus perillas) se abre y se cierra con AJUSTES, como en la cámara.
  function setConsole(tab, open) {
    if (!DECKS[tab] || !DECKS[tab].hud) return;
    consoleOpen[tab] = !!open;
    if (tab !== activeTab) return;
    document.documentElement.dataset.consola = open ? 'abierta' : 'cerrada';
    if (tab === 'scrash' && typeof _syncScrashHudVisibility === 'function') _syncScrashHudVisibility();
    if (tab === 'sono' && typeof _syncSonoLayoutVars === 'function') _syncSonoLayoutVars();
    if (window._editSyncHudLayout) window._editSyncHudLayout();
    window.dispatchEvent(new Event('resize'));
    paintDeck();
  }
  function syncDeck(tab) {
    const spec = tab !== 'cam' && DECKS[tab];
    document.body.classList.toggle('modo-pupitre', !!spec);
    if (!spec) {
      delete document.documentElement.dataset.consola;
      if (deckMain.parentElement !== deck) deck.insertBefore(deckMain, deck.querySelector('.rollo-pie'));
    } else {
      if (deckMain.parentElement !== modeDeck) modeDeck.appendChild(deckMain);
      document.documentElement.dataset.consola = !spec.hud || consoleOpen[tab] ? 'abierta' : 'cerrada';
    }
    // El botón de contexto: GIRAR la cámara o elegir la FUENTE (un archivo, el micrófono).
    const context = $('deckFlip'), source = !!(spec && spec.source);
    context.querySelector('svg').outerHTML = icon(source ? 'folder' : 'flip');
    context.setAttribute('aria-label', source ? 'Elegir la fuente' : 'Cambiar entre cámara frontal y trasera');
    context.parentElement.querySelector('.hw-print').textContent = source ? 'FUENTE' : 'GIRAR';
    if (spec) paintDeck(); else syncMode();
  }
  for (const spec of Object.values(DECKS)) {
    for (const id of [spec.toggle, spec.shoot, spec.snap, spec.rec]) {
      const node = id && $(id);
      if (node) new MutationObserver(paintDeck).observe(node, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    }
  }
  const flipMode = () => {
    const spec = deckOf();
    if (!spec) return btnMode.click();
    if (deckRecording(spec)) return;
    if (spec.toggle) $(spec.toggle).click(); else deckVideo[activeTab] = !deckVideo[activeTab];
    paintDeck();
  };
  $('deckModeSwitch').addEventListener('click', flipMode);
  deck.querySelector('.deck-mode .hw-print').addEventListener('click', event => {
    const label = event.target.closest('[data-mode-label]'), spec = deckOf();
    if (!label) return;
    const now = spec ? (deckIsVideo(spec) ? 'video' : 'foto') : camMode;
    if (label.dataset.modeLabel !== now) flipMode();
  });
  $('deckShutter').addEventListener('click', () => {
    const spec = deckOf();
    if (!spec) return btnShot.click();
    if (spec.shoot) return $(spec.shoot).click();
    $(deckRecording(spec) || deckVideo[activeTab] ? spec.rec : spec.snap).click();
  });
  $('deckFlip').addEventListener('click', () => { const spec = deckOf(); if (spec && spec.source) spec.source(); else _toggleCamera(); });
  $('deckAdjust').addEventListener('click', () => {
    const spec = deckOf();
    if (!spec) return _toggleCamEdit();
    if (spec.adjust) return spec.adjust();
    setConsole(activeTab, !consoleOpen[activeTab]);
  });

  // Cuadros por segundo y batería, a la pantallita.
  const fpsSource = $('fps');
  if (fpsSource) new MutationObserver(() => { $('lcdFps').textContent = fpsSource.textContent.toUpperCase(); }).observe(fpsSource, { childList: true, characterData: true, subtree: true });
  if (navigator.getBattery) {
    navigator.getBattery().then(battery => {
      const paint = () => {
        const node = $('lcdBatt');
        node.hidden = false;
        node.querySelectorAll('i').forEach((bar, index) => bar.classList.toggle('on', battery.level > index / 4 + 0.05));
      };
      paint();
      battery.addEventListener('levelchange', paint);
    }).catch(() => {});
  }

  // ── Banda superior ──────────────────────────────────────────────────────────
  $('shellSettings').addEventListener('click', () => _toggleFlipSettings(true));
  const micSource = $('btnMicMobile'), audioSource = $('btnAudioIO');
  if (micSource) {
    $('shellMic').addEventListener('click', () => micSource.click());
    const mirror = () => $('shellMic').classList.toggle('is-on', micSource.classList.contains('active') || micSource.classList.contains('pending'));
    new MutationObserver(mirror).observe(micSource, { attributes: true, attributeFilter: ['class'] });
    mirror();
  } else $('shellMic').hidden = true;
  if (audioSource) $('shellAudio').addEventListener('click', () => audioSource.click());
  else $('shellAudio').hidden = true;

  // Qué módulo se ve: los del motor, o uno propio de la carcasa (Portal vive sobre CAM).
  const overlays = {};
  let overlay = '';
  const currentModule = () => overlay || activeTab;
  function openLauncher(open) {
    launcher.classList.toggle('is-open', open);
    // Con el lanzador abierto un rato nadie mira la cámara: descansa (rest.js).
    if (window.flipRest) flipRest[open ? 'hold' : 'release']('launcher');
    if (open) {
      const here = currentModule(), mode = modeOf(here)[0];
      launcher.querySelectorAll('.launcher-card').forEach(card => card.classList.toggle('is-on', card.dataset.mode === mode));
      launcher.querySelectorAll('.launcher-sub').forEach(sub => { const on = sub.dataset.module === here; sub.classList.toggle('is-on', on); sub.setAttribute('aria-pressed', String(on)); });
    }
  }
  function goModule(key) {
    try { localStorage.setItem('flip.modo.' + modeOf(key)[0], key); } catch (_) {}
    if (key === currentModule()) return;
    if (overlay && overlays[overlay]) { const leaving = overlay; overlay = ''; overlays[leaving].exit(); }
    if (overlays[key]) {
      if (activeTab !== overlays[key].tab) switchTab(overlays[key].tab);
      overlay = key;
      overlays[key].enter();
      syncTab(activeTab);
    } else if (activeTab !== key) switchTab(key);
    else syncTab(activeTab);
  }
  $('shellModule').addEventListener('click', () => openLauncher(true));
  $('launcherClose').addEventListener('click', () => openLauncher(false));
  launcher.addEventListener('click', event => {
    // Una variante lleva a su módulo; la tarjeta de un modo, a la última variante que se usó en él.
    const sub = event.target.closest('[data-module]'), door = event.target.closest('[data-go-mode]');
    const key = sub ? sub.dataset.module : door ? lastOf(MODES.find(mode => mode[0] === door.dataset.goMode)) : '';
    if (key) { openLauncher(false); goModule(key); }
  });

  // ── Botoneras de los demás módulos: mismos mandos, iconos propios ───────────
  const KIND = { FOTO: 'cam', VIDEO: 'video', SNAP: 'dot', REC: 'rec', STOP: 'stop', SHARE: 'share', EDIT: 'sliders', FILE: 'folder', CHOOSE: 'folder',
    RESET: 'reset', MIC: 'mic', CAPTURE: 'cam', FULL: 'full', CAM: 'cam', FLIP: 'flip', GLITCH: 'bolt', PLAY: 'play', PAUSE: 'pause' };
  const GLYPH = { '▶': 'play', '⏸': 'pause', '●': 'dot', '⏺': 'rec', '⏹': 'stop', '💾': 'folder', '📷': 'cam', '🎥': 'video', '📂': 'folder', '↑': 'share', '↺': 'reset', '⚙': 'sliders', '🎙': 'mic', '⛶': 'full', '🔄': 'flip', '⚡': 'bolt' };
  function dress(root) {
    root.querySelectorAll('.btn').forEach(button => {
      const glyph = button.querySelector('.btn-icon');
      if (!glyph) return;
      const text = glyph.textContent.trim();
      const label = (button.querySelector('.btn-label')?.textContent || '').trim().toUpperCase();
      const kind = /^\d\d:\d\d$/.test(text) ? 'timer' : (KIND[label] || GLYPH[text] || 'dot');
      if (button.dataset.kind !== kind) {
        button.dataset.kind = kind;
        glyph.style.setProperty('--icon', kind === 'timer' ? 'none' : iconMask(kind));
      }
    });
  }
  ['flipBottomNav', 'barSflow', 'barEdit', 'barStage', 'barAscii', 'barSono', 'barWmp', 'barScrash', 'barFusion', 'barUpload'].forEach(id => {
    const bar = $(id);
    if (!bar) return;
    dress(bar);
    let queued = false;
    new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; dress(bar); }); })
      .observe(bar, { subtree: true, childList: true, characterData: true });
  });

  // Las teclas de fuente de EDIT traían un emoji delante del nombre: en una tecla sobra.
  document.querySelectorAll('.edit-src-pill, .edit-add-btn').forEach(key => {
    const text = key.textContent.replace(/^[^\p{L}+]+/u, '').trim();
    if (text && text !== key.textContent) key.textContent = text;
  });

  // ── Etiquetas de los ajustes, en el idioma de la app ────────────────────────
  const WORDS = { ENGRAVE: 'GRABADO', INK: 'TINTA', DETAIL: 'DETALLE', PAPER: 'PAPEL', PALETTE: 'PALETA', FRAME: 'MARCO', CNTR: 'CONTRASTE', CONTRAST: 'CONTRASTE',
    RESO: 'RESONANCIA', SENSITIVITY: 'SENSIBILIDAD', 'LINE WIDTH': 'GROSOR', LOCK: 'FIJACIÓN', GLOW: 'RESPLANDOR', SCAN: 'BARRIDO', GHOST: 'FANTASMA',
    DITHER: 'TRAMADO', TINT: 'TINTE', SOFT: 'SUAVIDAD', TONE: 'TONO', SHARP: 'NITIDEZ', NOISE: 'RUIDO', STAMP: 'FECHA', DENSITY: 'DENSIDAD', FLOW: 'FLUJO',
    CONTOUR: 'CONTORNO', MOTION: 'MOVIMIENTO', SIZE: 'TAMAÑO', FILL: 'RELLENO', SMOOTH: 'SUAVIZADO', MIX: 'MEZCLA', THRESH: 'UMBRAL', DIM: 'FONDO', TRAIL: 'ESTELA',
    'RESET ALL': 'RESTABLECER TODO', RESET: 'RESTABLECER', STICKERS: 'PEGATINAS', ZOOM: 'ZOOM', FPS: 'CUADROS/S' };
  function translate(root) {
    root.querySelectorAll('[class$="-lbl"], .sfh-lbl, .zoom-label, .ac-title, button, label[for]').forEach(node => {
      if (node.children.length) return;
      const word = WORDS[node.textContent.trim().toUpperCase()];
      if (word && node.textContent.trim() !== word) node.textContent = word;
    });
  }
  [$('palettes'), $('sflowHUD')].filter(Boolean).forEach(sheet => {
    translate(sheet);
    let busy = false;
    new MutationObserver(() => { if (busy) return; busy = true; queueMicrotask(() => { translate(sheet); busy = false; }); }).observe(sheet, { subtree: true, childList: true, characterData: true });
  });

  // ── FLOW: los ajustes se pliegan para dejar sitio a la imagen ───────────────
  const flowArea = $('sflowArea');
  if (flowArea) {
    document.documentElement.classList.add('flow-hud-closed');
    const chip = el('button', { class: 'hw', id: 'sflowAdjust', type: 'button', 'aria-expanded': 'false' }, `${icon('sliders')}<span>AJUSTES</span>`);
    flowArea.appendChild(chip);
    chip.addEventListener('click', () => {
      const closed = document.documentElement.classList.toggle('flow-hud-closed');
      chip.setAttribute('aria-expanded', String(!closed));
      if (window._sfSyncHudLayout) window._sfSyncHudLayout();
      window.dispatchEvent(new Event('resize'));
    });
  }

  // ── Última toma ─────────────────────────────────────────────────────────────
  let last = null;
  const originalSave = saveBlob;
  saveBlob = async function (blob, filename) {
    // El visor guarda la toma ya sellada: lo que enseña es lo que se comparte.
    try { blob = await _sealFlipVideo(blob); } catch (_) {}
    try { remember(blob, filename); } catch (_) {}
    return originalSave.call(this, blob, filename);
  };
  function remember(blob, filename) {
    if (!blob || !/^(image|video)\//.test(blob.type || '')) return;
    if (last) URL.revokeObjectURL(last.url);
    last = { blob, filename, url: URL.createObjectURL(blob), video: /^video\//.test(blob.type), at: new Date() };
    const button = $('deckGallery'), face = button.querySelector('b');
    button.classList.add('has-shot');
    button.classList.toggle('is-video', last.video);
    if (last.video) {
      // La miniatura de un video es lo que había en el visor al terminar.
      try {
        const thumb = document.createElement('canvas');
        const shown = { ascii: 'asciiCanvas', scrash: 'scrashCanvas', fusion: 'fusionCanvas', sono: 'sonoCanvas', wmp: 'wmpCanvas', edit: 'editCanvas', sflow: 'sflowCanvas' }[activeTab];
        const source = (shown && $(shown)) || display;
        thumb.width = 120; thumb.height = Math.round(120 * source.height / source.width);
        thumb.getContext('2d').drawImage(source, 0, 0, thumb.width, thumb.height);
        face.style.backgroundImage = `url(${thumb.toDataURL('image/jpeg', 0.7)})`;
      } catch (_) { face.style.backgroundImage = ''; }
    } else face.style.backgroundImage = `url(${last.url})`;
    button.classList.remove('pop');
    void button.offsetWidth;
    button.classList.add('pop');
  }
  function openViewer(open) {
    const stage = $('viewerStage');
    stage.innerHTML = '';
    viewer.classList.toggle('is-open', open);
    // Mientras se mira la última toma, la cámara descansa (rest.js).
    if (window.flipRest) flipRest[open && last ? 'hold' : 'release']('viewer');
    if (!open || !last) return;
    const node = document.createElement(last.video ? 'video' : 'img');
    node.src = last.url;
    if (last.video) { node.controls = true; node.playsInline = true; node.loop = true; node.autoplay = true; }
    else node.alt = 'Última foto tomada con FLIP';
    stage.appendChild(node);
    const size = last.blob.size > 1048576 ? (last.blob.size / 1048576).toFixed(1) + ' MB' : Math.round(last.blob.size / 1024) + ' KB';
    $('viewerMeta').textContent = `${last.filename} · ${size} · guardado en Descargas`;
    $('viewerShare').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([last.blob], last.filename, { type: last.blob.type })] }));
  }
  $('deckGallery').addEventListener('click', () => {
    if (last) openViewer(true);
    else flipToast('Aquí aparecerá tu última foto o video.');
  });
  $('viewerClose').addEventListener('click', () => openViewer(false));
  $('viewerSave').addEventListener('click', () => { if (last) _downloadBlob(last.blob, last.filename); });
  $('viewerShare').addEventListener('click', async () => {
    if (!last) return;
    try { await navigator.share({ files: [new File([last.blob], last.filename, { type: last.blob.type })] }); } catch (_) {}
  });

  // El sonido y la vibración de las teclas viven en feel.js.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (viewer.classList.contains('is-open')) openViewer(false);
    else if (launcher.classList.contains('is-open')) openLauncher(false);
    // Las hojas que suben desde abajo también se cierran con Escape (teclado de escritorio).
    else if (document.querySelector('.flip-settings-panel.open')) _toggleFlipSettings(false);
    else if (typeof camEditOpen !== 'undefined' && camEditOpen) _toggleCamEdit(false);
  });

  // ── Enganches con el motor ──────────────────────────────────────────────────
  const applyCam = _applyCamState;
  _applyCamState = function () {
    const result = applyCam.apply(this, arguments);
    syncCam();
    return result;
  };
  const switchTo = switchTab;
  switchTab = function (tab) {
    // Un módulo propio de la carcasa se cierra al cambiar de pestaña por cualquier vía.
    if (overlay && overlays[overlay] && tab !== overlays[overlay].tab) { const leaving = overlay; overlay = ''; overlays[leaving].exit(); }
    const result = switchTo.apply(this, arguments);
    syncTab(tab);
    return result;
  };
  function syncTab(tab) {
    if (window.flipRollo && document.body.dataset.tab !== tab) flipRollo.cancelMode($('shellLcd'));
    document.body.dataset.tab = tab;
    const key = currentModule();
    const entry = MODULES.find(m => m[0] === key), mode = modeOf(key);
    // La tecla dice el modo; la variante (ASCII, FLOW…) la dice la pantallita.
    $('shellModuleName').textContent = mode[1];
    $('shellModule').querySelector('svg').outerHTML = icon(mode[3]);
    $('shellModule').setAttribute('aria-label', 'Cambiar de modo: ' + mode[1]);
    document.body.dataset.modo = mode[0];
    syncDeck(tab);
    if (tab === 'cam') { syncCam(); syncMode(); requestAnimationFrame(measureDeck); }
    else {
      $('lcdLook').textContent = entry ? entry[1] : String(key).toUpperCase();
      $('lcdFps').textContent = entry ? entry[2].toUpperCase().slice(0, 22) : '';
    }
  }
  syncTab(typeof activeTab === 'string' ? activeTab : 'cam');
  syncCam();
  syncMode();
  measureDeck();
  window.flipShell = {
    hint, syncCam, syncTab, measureDeck, openLauncher, openViewer, icon, el, goModule,
    module: currentModule, mode: () => modeOf(currentModule())[0], modes: MODES,
    // La consola de perillas de un módulo: abrirla o cerrarla, y saber si lo está.
    console: (open, tab = activeTab) => setConsole(tab, open), consoleOpen: (tab = activeTab) => !DECKS[tab] || !DECKS[tab].hud || !!consoleOpen[tab],
    // Registra un módulo que vive sobre una pestaña del motor: { tab, enter(), exit() }.
    overlay(key, spec) { overlays[key] = spec; },
    onLook(handler) { lookHandlers.push(handler); },
    looks, lookLabel, readout,
  };
})();
