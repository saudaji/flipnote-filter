// Las consolas de ajustes.
//
// Los ajustes de cada cámara eran una hoja con una lista de deslizadores que había que desplazar
// (y al desplazar se movían valores sin querer), y tapaba media imagen. Ahora son una consola
// bajo el visor, con una página por sección —CÁMARA, COLOR, CUADRO, PEGATINAS— y en cada página,
// como mucho, una fila de perillas y otra de teclas. Nada se desplaza.
//
// Los paneles de los demás módulos (FLOW, SONO, WMP, FUSION, GLITCH) siguen la misma regla: una
// placa con sus perillas y sus teclas, montada sobre el panel de siempre (ver RACKS, más abajo).
//
// No se reescribe ningún ajuste: cada perilla, interruptor o selector gobierna el mando que ya
// existía (su <input> o sus botones, que siguen en la página, ocultos), así que lo que cada uno
// hace, guarda y restaura no cambia.
(() => {
  'use strict';
  const host = document.getElementById('palettes');
  if (!host) return;
  const $ = id => document.getElementById(id);
  const feel = () => window.flipFeel || null;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const FAMILY_PANES = ['dlpEditPanel', 'oscamEditPanel', 'caskiaEditPanel', 'auto03EditPanel', 'stampEditPanel', 'slhtEditPanel'];
  const PANES = FAMILY_PANES.concat(['camMobileUtilityDock', 'camStickerPanel', 'palColorTabs']);
  const SECTIONS = [['cam', 'CÁMARA'], ['color', 'COLOR'], ['frame', 'CUADRO'], ['stickers', 'PEGATINAS']];
  const SWEEP = 270;                           // recorrido de una perilla, en grados
  const TRAVEL = 170;                          // píxeles de arrastre vertical para recorrerla entera

  // ── Construcción (una vez) ─────────────────────────────────────────────────
  host.classList.add('cs');
  for (const id of PANES) { const pane = $(id); if (pane) pane.classList.add('cs-pane'); }
  const bar = document.createElement('div');
  bar.id = 'csSections';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Secciones de ajustes');
  bar.innerHTML = SECTIONS.map(([key, label]) => `<button class="cs-key" type="button" role="tab" data-sec="${key}">${label}</button>`).join('');
  host.appendChild(bar);
  const done = $('btnCamEditClose');
  if (done) { done.classList.add('cs-key'); bar.appendChild(done); }

  const knobs = [], toggles = [], selectors = [];
  const labelOf = row => { const el = row.querySelector('[class$="-lbl"], .cs-lbl, .zoom-meta > :first-child, .fps-toggle > label'); return el ? el.textContent.trim() : ''; };
  const nameOf = entry => entry.label ? entry.label() : labelOf(entry.row);
  function span(className, text) { const el = document.createElement('span'); el.className = className; el.textContent = text || ''; return el; }
  function knobEl(kind) {
    const knob = document.createElement('div');
    knob.className = 'cs-knob';
    knob.tabIndex = 0;
    knob.dataset.feel = 'none';                // no es una tecla: suena al girar, muesca a muesca
    if (kind) knob.dataset.csKind = kind;
    knob.setAttribute('role', kind ? 'spinbutton' : 'slider');
    knob.appendChild(document.createElement('i'));
    return knob;
  }
  function toggleEl() {
    const toggle = document.createElement('div');
    toggle.className = 'cs-toggle';
    toggle.tabIndex = 0;
    toggle.setAttribute('role', 'switch');
    toggle.appendChild(document.createElement('i'));
    return toggle;
  }
  function makeKnob(row, input, kind) {
    const knob = knobEl(kind);
    row.classList.add('cs-slot');
    row.insertBefore(knob, row.firstChild);
    return knob;
  }
  // Perillas: una por cada deslizador de las páginas de cámara, más cadencia y zoom.
  const ranges = [];
  for (const id of FAMILY_PANES) { const pane = $(id); if (pane) ranges.push(...pane.querySelectorAll('input[type="range"]')); }
  for (const id of ['camFpsSlider', 'camZoomSlider']) { const input = $(id); if (input) ranges.push(input); }
  for (const input of ranges) {
    const row = input.closest('[class$="-ctrl-row"]') || input.parentElement;
    const knob = makeKnob(row, input, '');
    knobs.push({ knob, input, row });
  }
  // Interruptores: la casilla de la cadencia y los pares de botones (uno u otro).
  function makeToggle(row, label) {
    const toggle = toggleEl();
    row.classList.add('cs-slot');
    row.insertBefore(toggle, row.firstChild);
    if (label && !row.querySelector('[class$="-lbl"]')) row.appendChild(span('cs-lbl', label));
    return toggle;
  }
  const fpsBox = $('camFpsToggle'), fpsRow = $('camFpsCtrl');
  if (fpsBox && fpsRow) {
    // Dos celdas en la misma pieza: el interruptor que limita la cadencia y la perilla que dice a cuánto.
    const toggle = makeToggle(fpsRow, '');
    const knob = fpsRow.querySelector('.cs-knob'), meta = fpsRow.querySelector('.fps-toggle');
    const limit = document.createElement('div'), rate = document.createElement('div');
    limit.className = rate.className = 'cs-cell';
    limit.append(toggle, span('cs-lbl', 'LIMITAR'));
    rate.append(knob);
    if (meta) rate.append(meta);
    fpsRow.prepend(limit, rate);
    toggles.push({ toggle, box: fpsBox, row: fpsRow, name: 'LIMITAR CUADROS' });
  }
  for (const [selector, label] of [['[data-stampframe]', 'MARCO'], ['.dlp-col-btn', 'COLOR']]) {
    const first = host.querySelector(selector);
    if (!first) continue;
    const row = first.closest('[class$="-row"]');
    const options = [...row.querySelectorAll('button')];
    const toggle = makeToggle(row, label);
    const value = row.appendChild(span('cs-val', ''));
    toggles.push({ toggle, options, row, value });
  }
  // Selectores de tres posiciones: los grupos de AUTO 03.
  for (const row of host.querySelectorAll('#auto03EditPanel .auto03-row')) {
    const options = [...row.querySelectorAll('button')];
    if (options.length < 2) continue;
    const knob = makeKnob(row, null, options.length === 2 ? 'sel2' : 'sel3');
    const value = row.appendChild(span('cs-val', ''));
    selectors.push({ knob, options, row, value });
  }
  // Teclas: los grupos de opciones que conviene ver enteros.
  for (const [selector, label, share] of [['[data-stamppal]', '', 0], ['#oscamColorRow', 'COLOR', 3], ['#oscamLegacyRow', 'MODO', 2], ['#camAspect', 'FORMATO', 0],
    ['#camStickerToolRow', '', 0], ['.cam-stk-reset-row', '', 0], ['#camStickerSelRow', '', 0]]) {
    const hit = host.querySelector(selector);
    if (!hit) continue;
    const row = hit.matches('button') ? hit.closest('[class$="-row"]') : hit;
    row.classList.add('cs-keys');
    if (label) row.dataset.csLabel = label;
    if (share) { row.dataset.csShare = '1'; row.style.setProperty('--cs-share', String(share)); }
  }
  host.querySelectorAll('.pal-tab-row button, #palSlotActions button').forEach(button => button.classList.add('cs-key'));

  // ── Estado ────────────────────────────────────────────────────────────────
  const ratioOf = input => { const min = Number(input.min || 0), max = Number(input.max || 100); return max > min ? clamp((Number(input.value) - min) / (max - min), 0, 1) : 0; };
  const shown = entry => { if (entry.text) return entry.text(); const el = entry.row.querySelector('[class$="-val"], .fps-val, .zoom-val'); return el ? el.textContent.trim() : String(entry.input.value); };
  function syncKnob(entry) {
    const { knob, input } = entry;
    knob.style.setProperty('--turn', (-SWEEP / 2 + SWEEP * ratioOf(input)).toFixed(1) + 'deg');
    knob.setAttribute('aria-valuemin', input.min || '0');
    knob.setAttribute('aria-valuemax', input.max || '100');
    knob.setAttribute('aria-valuenow', input.value);
    knob.setAttribute('aria-label', nameOf(entry));
  }
  const isOn = el => el.classList.contains('active') || el.classList.contains('is-on') || el.classList.contains('on') || el.getAttribute('aria-pressed') === 'true';
  const activeIndex = options => Math.max(0, options.findIndex(isOn));
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  function syncSelector(entry) {
    const n = entry.options.length, i = activeIndex(entry.options);
    const spread = n === 2 ? 70 : 100;
    entry.knob.style.setProperty('--turn', (n > 1 ? -spread / 2 + spread * i / (n - 1) : 0).toFixed(1) + 'deg');
    entry.value.textContent = entry.options[i].textContent.trim();
    entry.knob.setAttribute('aria-label', nameOf(entry));
    entry.knob.setAttribute('aria-valuetext', entry.value.textContent);
  }
  function syncToggle(entry) {
    const on = entry.box ? entry.box.checked : activeIndex(entry.options) === 1;
    entry.toggle.setAttribute('aria-checked', String(on));
    entry.toggle.setAttribute('aria-label', nameOf(entry));
    if (entry.value) setText(entry.value, entry.options[activeIndex(entry.options)].textContent.trim());
    if (entry.box) entry.row.classList.toggle('is-off', !on);
  }
  const visible = el => !!el && el.style.display !== 'none' && !(el.id === 'palColorTabs' && el.classList.contains('cam-color-hidden'));
  function available(sec) {
    if (sec === 'cam') return FAMILY_PANES.some(id => { const pane = $(id); return pane && pane.style.display === 'block'; });
    if (sec === 'color') return visible($('palColorTabs'));
    return true;
  }
  function setSection(sec) {
    if (!available(sec)) sec = SECTIONS.map(s => s[0]).find(available);
    host.dataset.sec = sec;
    bar.querySelectorAll('[data-sec]').forEach(key => {
      const on = key.dataset.sec === sec;
      key.hidden = !available(key.dataset.sec);
      key.classList.toggle('is-on', on);
      key.setAttribute('aria-selected', String(on));
    });
  }
  function sync() {
    knobs.forEach(syncKnob);
    selectors.forEach(syncSelector);
    toggles.forEach(syncToggle);
    // Cuántas perillas lleva la página a la vista: hasta cinco por fila; más, en dos filas.
    for (const id of FAMILY_PANES) {
      const pane = $(id);
      if (!pane) continue;
      const slots = [...pane.querySelectorAll('.cs-slot')].filter(slot => !(/^(oscamStaticOnlyRow|oscamLegacyRow)$/.test(slot.id) && !slot.classList.contains('visible')));
      const perRow = slots.length > 5 ? Math.ceil(slots.length / 2) : Math.max(3, slots.length);
      pane.style.setProperty('--cs-n', String(perRow));
      pane.dataset.csN = String(perRow);
      pane.dataset.csRows = slots.length > 5 ? '2' : '1';
    }
    setSection(host.dataset.sec || 'cam');
  }
  // La consola ocupa el pupitre, sin pisar el visor: se ajusta al ancho y al alto que tiene.
  function layout() {
    const deck = $('camDeck');
    const room = deck ? deck.getBoundingClientRect().height : 256;
    const unit = clamp(Math.min((innerWidth - 12) / 384, (room - 8) / 240), 0.72, 1.22);
    host.style.setProperty('--cu', unit.toFixed(4) + 'px');
    // El marco de las teclas, en píxeles enteros de la pantalla: si no, se le ven las costuras.
    const dpr = window.devicePixelRatio || 1, snap = n => (Math.max(1, Math.round(n * unit * dpr)) / dpr).toFixed(4) + 'px';
    host.style.setProperty('--cs-kb', snap(18));
    host.style.setProperty('--cs-ko', snap(6));
  }

  // ── Mandos ────────────────────────────────────────────────────────────────
  function readout(entry) {
    const shell = window.flipShell;
    if (shell && shell.readout) shell.readout(nameOf(entry), entry.input ? shown(entry) : (entry.value ? entry.value.textContent : ''), entry.input ? ratioOf(entry.input) : null);
  }
  function setValue(entry, next, x) {
    const input = entry.input, min = Number(input.min || 0), max = Number(input.max || 100), step = Number(input.step) > 0 ? Number(input.step) : 1;
    const snapped = clamp(min + Math.round((next - min) / step) * step, min, max);
    const text = String(+snapped.toFixed(4));
    if (text === input.value) return false;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    syncKnob(entry);
    if (feel()) feel().detent(x);
    readout(entry);
    return true;
  }
  let hold = null, lastTap = { knob: null, at: 0 };
  document.addEventListener('pointerdown', event => {
    const knob = event.target.closest('.cs-knob');
    if (!knob || event.button > 0) return;
    const entry = knobs.find(k => k.knob === knob), selector = selectors.find(s => s.knob === knob);
    if (!entry && !selector) return;
    event.preventDefault();
    try { knob.setPointerCapture(event.pointerId); } catch (_) {}
    knob.classList.add('is-held');
    hold = { knob, entry, selector, id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0, start: entry ? Number(entry.input.value) : activeIndex(selector.options), changed: false };
    if (entry) readout(entry);
  });
  document.addEventListener('pointermove', event => {
    if (!hold || event.pointerId !== hold.id) return;
    const dy = hold.y - event.clientY, dx = event.clientX - hold.x;
    hold.moved = Math.max(hold.moved, Math.abs(dy), Math.abs(dx));
    if (hold.entry) {
      const input = hold.entry.input, range = Number(input.max || 100) - Number(input.min || 0);
      if (setValue(hold.entry, hold.start + (dy / TRAVEL + dx / (TRAVEL * 2.2)) * range, event.clientX)) hold.changed = true;
    } else {
      const n = hold.selector.options.length, want = clamp(hold.start + Math.round((dy + dx * 0.5) / 26), 0, n - 1);
      if (want !== activeIndex(hold.selector.options)) { hold.selector.options[want].click(); hold.changed = true; if (feel()) feel().detent(event.clientX); syncSelector(hold.selector); readout(hold.selector); }
    }
  });
  function release(event) {
    if (!hold || event.pointerId !== hold.id) return;
    const { knob, entry, selector, moved, changed } = hold;
    hold = null;
    knob.classList.remove('is-held');
    const now = performance.now();
    if (entry) {
      if (changed) entry.input.dispatchEvent(new Event('change', { bubbles: true }));
      // Dos toques seguidos sin arrastrar: el valor de fábrica.
      if (moved < 6 && event.type === 'pointerup') {
        if (lastTap.knob === knob && now - lastTap.at < 340) { if (setValue(entry, Number(entry.input.defaultValue), event.clientX)) entry.input.dispatchEvent(new Event('change', { bubbles: true })); lastTap = { knob: null, at: 0 }; }
        else lastTap = { knob, at: now };
      }
    } else if (moved < 6 && event.type === 'pointerup') {
      // Un toque en un selector: la opción siguiente.
      const options = selector.options;
      options[(activeIndex(options) + 1) % options.length].click();
      if (feel()) feel().tap('switch', 'down', event.clientX);
      syncSelector(selector);
      readout(selector);
    }
  }
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  document.addEventListener('wheel', event => {
    const knob = event.target.closest('.cs-knob');
    const entry = knob && knobs.find(k => k.knob === knob);
    if (!entry) return;
    event.preventDefault();
    const input = entry.input, range = Number(input.max || 100) - Number(input.min || 0);
    if (setValue(entry, Number(input.value) - Math.sign(event.deltaY) * Math.max(Number(input.step) || 1, range / 50), event.clientX)) input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { passive: false });
  document.addEventListener('keydown', event => {
    const knob = event.target.closest && event.target.closest('.cs-knob, .cs-toggle');
    if (!knob) return;
    const entry = knobs.find(k => k.knob === knob), selector = selectors.find(s => s.knob === knob), toggle = toggles.find(t => t.toggle === knob);
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
    if (toggle && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); flip(toggle); return; }
    if (!dir && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (entry) {
      const input = entry.input, min = Number(input.min || 0), max = Number(input.max || 100);
      const next = event.key === 'Home' ? min : event.key === 'End' ? max : Number(input.value) + dir * Math.max(Number(input.step) || 1, (max - min) / 50);
      if (setValue(entry, next)) input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (selector && dir) {
      const options = selector.options;
      options[clamp(activeIndex(options) + dir, 0, options.length - 1)].click();
      syncSelector(selector);
      readout(selector);
    }
  });
  function flip(entry) {
    if (entry.box) entry.box.click();
    else entry.options[activeIndex(entry.options) === 1 ? 0 : 1].click();
    syncToggle(entry);
    const shell = window.flipShell;
    if (shell && shell.readout) shell.readout(entry.name || nameOf(entry), entry.value ? entry.value.textContent : (entry.box.checked ? 'SÍ' : 'NO'), null);
  }
  document.addEventListener('click', event => {
    if (!event.target.closest) return;
    const toggle = event.target.closest('.cs-toggle');
    if (toggle) { const entry = toggles.find(t => t.toggle === toggle); if (entry) flip(entry); return; }
    const tab = event.target.closest('#csSections [data-sec]');
    if (tab) { setSection(tab.dataset.sec); return; }
    // Una tecla de opción: el piloto de su grupo cambia en cuanto la app la da por elegida.
    if (event.target.closest('#palettes .cs-keys, #palettes .cs-pane')) setTimeout(sync, 0);
  });
  // Un valor que cambia por otra vía (restaurar ajustes, otra cámara) mueve su perilla.
  document.addEventListener('input', event => { const entry = knobs.find(k => k.input === event.target); if (entry) syncKnob(entry); });

  // ── Enganches ─────────────────────────────────────────────────────────────
  if (typeof _applyCamState === 'function') {
    const apply = _applyCamState;
    _applyCamState = function () { const out = apply.apply(this, arguments); sync(); return out; };
  }
  // La primera vez que se abre la consola, el cristal dice cómo se mueve una perilla.
  let tipped = false;
  try { tipped = localStorage.getItem('flip.console.tip') === '1'; } catch (_) {}
  function tip() {
    if (tipped) return;
    tipped = true;
    try { localStorage.setItem('flip.console.tip', '1'); } catch (_) {}
    const shell = window.flipShell;
    if (shell && shell.hint) shell.hint('Arrastra una perilla arriba o abajo. Dos toques: su valor de fábrica.', 4200);
  }
  let wasOpen = false;
  new MutationObserver(() => {
    const open = document.body.classList.contains('cam-edit-open');
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) { layout(); host.dataset.sec = available('cam') ? 'cam' : available('color') ? 'color' : 'frame'; sync(); tip(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', () => { if (wasOpen) layout(); });
  layout();
  sync();

  // ══ Las consolas de los demás módulos ═════════════════════════════════════
  // Cada panel (#sonoHUD, #wmpHUD…) conserva sus mandos de siempre, ocultos, y encima lleva una
  // placa con perillas, interruptores y teclas que los gobiernan. Qué va en cada placa:
  //   K(…)  una fila de perillas; cada cosa es un deslizador («#id») o un par de botones, que se
  //         vuelve interruptor («.contenedor|RÓTULO»);
  //   Y(…)  una fila de teclas: los botones de ese contenedor, con su rótulo;
  //   split una fila partida: perillas a la izquierda y teclas a la derecha;
  //   tail  teclas sueltas en la fila de abajo, junto a las pestañas de página.
  const K = (...items) => ({ knobs: items });
  const Y = (keys, label, perRow) => ({ keys, label, perRow });
  const RACKS = {
    sonoHUD: { pages: [{ rows: [K('.sono-presets|MODO', '.sono-row2', '#sonoMix', '#sonoChaos', '#sonoHue'), Y('.flip-presets-row', 'PREAJUSTES')] }], lamp: '#sonoAmpDot' },
    wmpHUD: { pages: [{ rows: [Y('.wmp-presets', 'VISUAL'), { split: [K('#wmpSens', '#wmpTrails'), Y('.flip-presets-row', 'AMBIENTE')] }] }] },
    fusionHUD: { pages: [{ rows: [{ split: [K('#fusionReact'), Y('#fusionFamRow', 'CÁMARA', 4)] }] }] },
    sflowHUD: { pages: [{ rows: [K('#sflowDensity', '#sflowFill', '#sflowThresh', '#sflowDim', '#sflowTrail')] }], tail: ['#btnSflowReset'] },
    scrashControls: { pages: [
      { name: 'MODO', rows: [Y('.flip-presets-row', 'PREAJUSTES'), Y('.scrash-quick-card:nth-child(1) .sc-top-row', 'PALETA'), Y('.scrash-quick-card:nth-child(2) .sc-top-row', 'FORMATO')] },
      { name: 'DETALLE', rows: [K('#scrChroma', '#scrNeon', '#scrHue', '#scrAudioReact', '#scrSpeed'), K('#scrDrip', '#scrWave', '#scrCrush', '#scrGrain', '#scrChaos')] },
    ], tail: ['#btnScrashAnimateQuick', '#btnScrashResetQuick'] },
  };
  const racks = [];
  const make = (tag, className) => { const el = document.createElement(tag); el.className = className; return el; };
  const textIn = (row, selector) => { const el = row && row.querySelector(selector); return el ? el.textContent.trim() : ''; };
  const sourcesOf = (hud, selector) => { const hit = hud.querySelector(selector); return !hit ? [] : hit.matches('button') ? [hit] : [...hit.querySelectorAll('button')]; };
  const keyText = src => (src.textContent || '').replace(/\s+/g, ' ').trim();
  // La forma de un panel: qué mandos tiene ahora mismo. Si cambia (hay filas que el módulo crea al abrirse), la placa se rehace.
  function shapeOf(R) {
    const parts = [];
    const visit = spec => {
      if (spec.split) return spec.split.forEach(visit);
      if (spec.knobs) for (const item of spec.knobs) { const el = R.hud.querySelector(item.split('|')[0]); parts.push(el ? (el.matches('input') ? 'r' : 'b' + el.querySelectorAll('button').length) : '-'); }
      else parts.push(sourcesOf(R.hud, spec.keys).map(keyText).join(','));
    };
    R.cfg.pages.forEach(page => page.rows.forEach(visit));
    (R.cfg.tail || []).forEach(selector => parts.push(R.hud.querySelector(selector) ? '1' : '0'));
    return parts.join('|');
  }
  function rackKey(R, src, className) {
    const key = make('button', 'cs-key ' + (className || ''));
    key.type = 'button';
    R.keys.push({ el: key, src });
    return key;
  }
  function buildRack(R) {
    for (const list of [knobs, toggles]) for (let i = list.length - 1; i >= 0; i--) if (list[i].rack === R) list.splice(i, 1);
    R.keys = [];
    R.rack.textContent = '';
    const row = spec => {
      if (spec.split) {
        const [left, ...right] = spec.split, box = make('div', 'cr-split'), col = make('div', 'cr-col');
        box.append(row(left), col);
        right.forEach(part => col.append(row(part)));
        return box;
      }
      if (spec.knobs) {
        const box = make('div', 'cr-knobs');
        let count = 0;
        for (const item of spec.knobs) {
          const [selector, fixed] = item.split('|'), src = R.hud.querySelector(selector);
          if (!src) continue;
          const slot = make('div', 'cr-slot'), lbl = span('cr-lbl'), val = span('cr-val');
          if (src.matches('input')) {
            const knob = knobEl(''), line = src.parentElement;
            slot.append(knob, lbl, val);
            knobs.push({ knob, input: src, rack: R, lbl, val, label: () => fixed || textIn(line, '[class$="-lbl"]'), text: () => textIn(line, '[class$="-val"]') || src.value });
          } else {
            const toggle = toggleEl();
            slot.append(toggle, lbl, val);
            toggles.push({ toggle, options: [...src.querySelectorAll('button')].slice(0, 2), rack: R, lbl, value: val, label: () => fixed || textIn(src, '[class$="-lbl"]') });
          }
          box.append(slot);
          count++;
        }
        box.style.setProperty('--cs-n', String(count));
        box.dataset.csN = String(count);
        return box;
      }
      const box = make('div', 'cr-keys');
      if (spec.label) box.dataset.label = spec.label;
      if (spec.perRow) box.style.setProperty('--cr-per', String(spec.perRow));
      for (const src of sourcesOf(R.hud, spec.keys)) box.append(rackKey(R, src));
      return box;
    };
    const pages = make('div', 'cr-pages');
    R.cfg.pages.forEach((page, index) => {
      const box = make('div', 'cr-page');
      box.dataset.page = String(index);
      page.rows.forEach(spec => box.append(row(spec)));
      if (page.rows.filter(spec => spec.knobs).length > 1) box.classList.add('is-tight');
      pages.append(box);
    });
    R.rack.append(pages);
    if (R.cfg.pages.length > 1 || R.cfg.tail) {
      const tabs = make('div', 'cr-tabs');
      if (R.cfg.pages.length > 1) R.cfg.pages.forEach((page, index) => { const key = make('button', 'cs-key cr-tab'); key.type = 'button'; key.textContent = page.name; key.dataset.page = String(index); tabs.append(key); });
      tabs.append(make('i', 'cr-gap'));
      for (const selector of R.cfg.tail || []) { const src = R.hud.querySelector(selector); if (src) tabs.append(rackKey(R, src, 'cr-tail')); }
      R.rack.append(tabs);
    }
    if (R.lamp) R.rack.append(R.lamp);
  }
  function layoutRack(R) {
    const unit = clamp((innerWidth - 12) / 384, 0.72, 1.22), dpr = window.devicePixelRatio || 1;
    const snap = n => (Math.max(1, Math.round(n * unit * dpr)) / dpr).toFixed(4) + 'px';
    R.hud.style.setProperty('--cu', unit.toFixed(4) + 'px');
    R.hud.style.setProperty('--cs-kb', snap(18));
    R.hud.style.setProperty('--cs-ko', snap(6));
    R.hud.style.setProperty('--cs-pb', snap(26));
    R.hud.style.setProperty('--cs-po', snap(10));
  }
  function syncRack(R) {
    const shape = shapeOf(R);
    if (shape !== R.shape) { R.shape = shape; buildRack(R); }
    for (const entry of knobs) if (entry.rack === R) { setText(entry.lbl, entry.label()); setText(entry.val, entry.text()); syncKnob(entry); }
    for (const entry of toggles) if (entry.rack === R) { setText(entry.lbl, entry.label()); syncToggle(entry); }
    for (const key of R.keys) {
      setText(key.el, keyText(key.src));
      key.el.classList.toggle('is-on', isOn(key.src));
      key.el.hidden = key.src.hidden || key.src.style.display === 'none';
      key.el.disabled = key.src.disabled;
    }
    R.rack.querySelectorAll('.cr-page').forEach(page => page.classList.toggle('is-on', Number(page.dataset.page) === R.page));
    R.rack.querySelectorAll('.cr-tab').forEach(tab => { const on = Number(tab.dataset.page) === R.page; tab.classList.toggle('is-on', on); tab.setAttribute('aria-pressed', String(on)); });
    // El visor del módulo llega hasta donde empieza la placa: si su alto cambia, se avisa.
    const height = Math.round(R.hud.getBoundingClientRect().height);
    if (height && height !== R.height) {
      R.height = height;
      document.documentElement.style.setProperty('--' + R.hud.id + '-h', height + 'px');
      requestAnimationFrame(() => dispatchEvent(new Event('resize')));
    }
  }
  for (const id of Object.keys(RACKS)) {
    const hud = $(id);
    if (!hud) continue;
    const R = { hud, cfg: RACKS[id], rack: make('div', 'cs-rack'), keys: [], page: 0, shape: null, height: 0, lamp: RACKS[id].lamp ? hud.querySelector(RACKS[id].lamp) : null, queued: false };
    hud.classList.add('cs-host');
    hud.append(R.rack);
    racks.push(R);
    R.rack.addEventListener('click', event => {
      const tab = event.target.closest('.cr-tab');
      if (tab) { R.page = Number(tab.dataset.page); syncRack(R); return; }
      const key = R.keys.find(k => k.el === event.target.closest('.cs-key'));
      if (key) { key.src.click(); setTimeout(() => syncRack(R), 0); }
    });
    // Lo que el módulo cambie por su cuenta (otro preajuste, un rótulo, un valor) se refleja en la placa.
    new MutationObserver(records => {
      if (R.queued || records.every(record => R.rack.contains(record.target) || (record.target === hud && record.attributeName === 'style'))) return;
      R.queued = true;
      requestAnimationFrame(() => { R.queued = false; layoutRack(R); syncRack(R); });
    }).observe(hud, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-pressed'] });
    layoutRack(R);
    syncRack(R);
  }
  addEventListener('resize', () => racks.forEach(layoutRack));

  window.flipConsole = {
    // Para las pruebas: la sección a la vista, las que hay y el valor de cada perilla.
    state: () => ({ open: wasOpen, section: host.dataset.sec || '', sections: SECTIONS.map(s => s[0]).filter(available), unit: parseFloat(host.style.getPropertyValue('--cu')) || 1,
      knobs: knobs.filter(k => k.knob.offsetParent).map(k => ({ id: k.input.id, label: nameOf(k), value: Number(k.input.value), turn: parseFloat(k.knob.style.getPropertyValue('--turn')) })),
      racks: racks.filter(R => R.rack.offsetParent).map(R => ({ id: R.hud.id, page: R.page, pages: R.cfg.pages.length, keys: R.keys.filter(k => !k.el.hidden).map(k => k.el.textContent + (k.el.classList.contains('is-on') ? '*' : '')) })) }),
    section: setSection,
    knob: id => { const entry = knobs.find(k => k.input && k.input.id === id); return entry ? entry.knob : null; },
    sync,
  };
})();
