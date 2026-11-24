/* Rollo en añil. Adaptador visual sin dependencias del motor de cámara. */
(function () {
  'use strict';
  const root = new URL('.', document.currentScript.src);
  const url = path => new URL(path, root).href;
  const sequence = {
  "columnas": 36,
  "filas": 11,
  "duracionMs": 2400,
  "reducido": {
    "frame": "flip",
    "duracionMs": 150
  },
  "tiempos": [
    {
      "desdeMs": 0,
      "frame": "vacio"
    },
    {
      "desdeMs": 160,
      "frame": "abierta"
    },
    {
      "desdeMs": 420,
      "frame": "guino"
    },
    {
      "desdeMs": 730,
      "frame": "flip"
    },
    {
      "desdeMs": 1450,
      "frame": "modelo"
    },
    {
      "desdeMs": 1930,
      "frame": "estado"
    }
  ],
  "modo": {
    "cam": {
      "modelo": "fl-27",
      "estado": "listo"
    },
    "stage": {
      "modelo": "vs-27",
      "estado": "stage"
    }
  },
  "frames": {
    "vacio": [
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000"
    ],
    "fl-27": [
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000011111010000000000111001111100000",
      "000010000010000000001000100000100000",
      "000010000010000000000000100001000000",
      "000011110010000011100011000010000000",
      "000010000010000000000100000100000000",
      "000010000010000000001000000100000000",
      "000010000011111000001111100100000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000"
    ],
    "vs-27": [
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000010001001111000000111001111100000",
      "000010001010000000001000100000100000",
      "000010001010000000000000100001000000",
      "000010001001110011100011000010000000",
      "000010001000001000000100000100000000",
      "000001010000001000001000000100000000",
      "000000100011110000001111100100000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000"
    ],
    "listo": [
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000010000011100111101111100111000000",
      "000010000001001000000010001000100000",
      "000010000001001000000010001000100000",
      "000010000001000111000010001000100000",
      "000010000001000000100010001000100000",
      "000010000001000000100010001000100000",
      "000011111011101111000010000111000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000"
    ],
    "stage": [
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000011110111110011100011110111110000",
      "000100000001000100010100000100000000",
      "000100000001000100010100000100000000",
      "000011100001000111110101110111100000",
      "000000010001000100010100010100000000",
      "000000010001000100010100010100000000",
      "000111100001000100010011110111110000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000"
    ],
    "abierta": [
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000111100000000000000000",
      "000000000000001111111000000000000000",
      "000000000000011111111100000000000000",
      "000000000000011011101100000000000000",
      "000000000000011011101100000000000000",
      "000000000000011111111100000000000000",
      "000000000000001111111000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000"
    ],
    "guino": [
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000111100000000000000000",
      "000000000000001111111000000000000000",
      "000000000000011111111100000000000000",
      "000000000000010111101100000000000000",
      "000000000000011011101100000000000000",
      "000000000000011111111100000000000000",
      "000000000000001111111000000000000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000"
    ],
    "flip": [
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000",
      "000011110000011111010000001001111000",
      "000111111100010000010000000001000100",
      "001111111110010000010000011001000100",
      "001011110110011110010000001001111000",
      "001101110110010000010000001001000000",
      "001111111110010000010000001001000000",
      "000111111100010000011111011101000000",
      "000000000000000000000000000000000000",
      "000000000000000000000000000000000000"
    ]
  }
};
  const paths = {
  "cam": "<path d=\"M4 10a2 2 0 0 1 2-2h2l2-3h4l2 3h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 14q2-2 4 0m5-1a1.5 1.5 0 1 0-3 0 1.5 1.5 0 1 0 3 0\" stroke-width=\"2\"/>",
  "portal": "<path d=\"M19 11a7 7 0 1 1-6-6.9m6 6.9v-5m0 5h-5M9 13q3-3 6 0\" stroke-width=\"2\"/>",
  "ascii": "<path d=\"M4 18 8 6l4 12m-7-4h6m4-6h5m-5 4h3m-3 4h5\" stroke-width=\"2\"/>",
  "sflow": "<path d=\"M4 15c6 2 4-7 9-7h7m-6-3 6 3-5 4M4 19c5 1 8-3 9-5\" stroke-width=\"2\"/>",
  "scrash": "<path d=\"M4 8h8l-3 4h9m2-4v8h-8l2-3M4 12v4h4\" stroke-width=\"2\"/>",
  "fusion": "<path d=\"M14 10a5 5 0 1 0-10 0 5 5 0 0 0 10 0m6 4a5 5 0 1 0-10 0 5 5 0 0 0 10 0\" stroke-width=\"2\"/>",
  "sono": "<path d=\"M4 12h2c2 0 2-6 4-6s2 12 4 12 2-6 4-6h2\" stroke-width=\"2\"/>",
  "wmp": "<path d=\"M4 17v-5m5 7V8m6 11V5m5 12v-7\" stroke-width=\"2\"/>",
  "edit": "<path d=\"M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zm0 3h14m-9 3 4 2-4 2z\" stroke-width=\"2\"/>",
  "stage": "<path d=\"M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 20h8M7 12h2l2-3 2 5 2-3h2\" stroke-width=\"2\"/>",
  "foto": "<path d=\"M7 7c-2 0-3 1-3 3m13-3c2 0 3 1 3 3M4 15c0 2 1 3 3 3m13-3c0 2-1 3-3 3m-2-6a3 3 0 1 0-6 0 3 3 0 0 0 6 0\" stroke-width=\"2\"/>",
  "video": "<path d=\"M4 9c0-1 1-2 2-2h7c1 0 2 1 2 2v6c0 1-1 2-2 2H6c-1 0-2-1-2-2zm11 2 5-3v8l-5-3\" stroke-width=\"2\"/>",
  "rec": "<path d=\"M17.5 12a5.5 5.5 0 1 0-11 0 5.5 5.5 0 1 0 11 0\" stroke-width=\"2\"/>",
  "stop": "<path d=\"M7 9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z\" stroke-width=\"2\"/>",
  "flip": "<path d=\"M4 10a8 8 0 0 1 14-4l2 3m0-4v4h-4M20 14a8 8 0 0 1-14 4l-2-3m0 4v-4h4\" stroke-width=\"2\"/>",
  "gear": "<path d=\"M5 7h14M5 12h14M5 17h14M8 5v4m8 1v4m-6 1v4\" stroke-width=\"2\"/>",
  "sliders": "<path d=\"M18 12a6 6 0 1 0-12 0 6 6 0 0 0 12 0m-6 0 3-3\" stroke-width=\"2\"/>",
  "mic": "<path d=\"M9 7a3 3 0 0 1 6 0v4a3 3 0 0 1-6 0zm-3 4a6 6 0 0 0 12 0m-6 6v3m-3 0h6\" stroke-width=\"2\"/>",
  "image": "<path d=\"M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zm0 9 4-4 3 2 2-2 5 5m-4-8h.1\" stroke-width=\"2\"/>",
  "share": "<path d=\"M6 12h5m0 0 6-6m-3 0h4v4m-7 2 6 6m-3 0h4v-4\" stroke-width=\"2\"/>",
  "guardar": "<path d=\"M12 5v9m-4-4 4 4 4-4M5 16v2c0 1 1 2 2 2h10c1 0 2-1 2-2v-2\" stroke-width=\"2\"/>",
  "folder": "<path d=\"M4 9c0-1 1-2 2-2h4l2 2h6c1 0 2 1 2 2v6c0 1-1 2-2 2H6c-1 0-2-1-2-2z\" stroke-width=\"2\"/>",
  "reset": "<path d=\"M5 9a7.5 7.5 0 1 1 0 6m0-10v4h4\" stroke-width=\"2\"/>",
  "close": "<path d=\"M7 7l10 10m0-10L7 17\" stroke-width=\"2\"/>",
  "bolt": "<path d=\"M13 4 6 13h5l-1 7 8-9h-5z\" stroke-width=\"2\"/>",
  "zoom": "<path d=\"M15 10a5 5 0 1 0-10 0 5 5 0 0 0 10 0m-1 4 5 5m-9-11v4m-2-2h4\" stroke-width=\"2\"/>",
  "play": "<path d=\"M8 6l10 6-10 6z\" stroke-width=\"2\"/>",
  "pause": "<path d=\"M8 7v10m8-10v10\" stroke-width=\"2\"/>",
  "full": "<path d=\"M8 4H6a2 2 0 0 0-2 2v2m12-4h2a2 2 0 0 1 2 2v2M4 16v2a2 2 0 0 0 2 2h2m12-4v2a2 2 0 0 1-2 2h-2\" stroke-width=\"2\"/>",
  "midi": "<path d=\"M19 12a7 7 0 1 0-14 0 7 7 0 0 0 14 0m-11 1h.1M10 10h.1m1.9-1h.1m1.9 1h.1m1.9 3h.1\" stroke-width=\"2\"/>",
  "salida": "<path d=\"M4 6h11a1 1 0 0 1 1 1v3m0 5v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1M7 21h6m1-8h7m-3-3 3 3-3 3\" stroke-width=\"2\"/>",
  "tempo": "<path d=\"M5 17c2-2 2-6 4-6s2 6 4 6 2-10 5-10h1\" stroke-width=\"2\"/>",
  "bloqueo-pro": "<path d=\"M7 13a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2zm1-2V8a4 4 0 0 1 8 0v3m-4 4v2\" stroke-width=\"2\"/>"
};
  const palette = {
  "cam": [
    "#273FA8",
    "#FFF3DC"
  ],
  "portal": [
    "#594A8C",
    "#FFF3DC"
  ],
  "ascii": [
    "#242646",
    "#FFF3DC"
  ],
  "sflow": [
    "#90C578",
    "#242646"
  ],
  "scrash": [
    "#F77F50",
    "#242646"
  ],
  "fusion": [
    "#273FA8",
    "#FFF3DC"
  ],
  "sono": [
    "#90C578",
    "#242646"
  ],
  "wmp": [
    "#E9BC4D",
    "#242646"
  ],
  "edit": [
    "#EDE5D8",
    "#242646"
  ],
  "stage": [
    "#594A8C",
    "#FFF3DC"
  ]
};
  const storageKey = 'flip.rollo.carcasa';
  const timelines = new WeakMap();
  const namespace = 'http://www.w3.org/2000/svg';

  function setTheme(value) {
    const theme = value === 'oscuro' ? 'oscuro' : 'principal';
    document.body.dataset.tema = theme;
    const toggle = document.getElementById('rolloTema');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(theme === 'oscuro'));
      // La tecla dice a qué carcasa se cambia al pulsarla.
      toggle.textContent = theme === 'oscuro' ? 'CARCASA CLARA' : 'CARCASA OSCURA';
    }
    try { localStorage.setItem(storageKey, theme); } catch (_) {}
  }

  function restoreTheme() {
    let theme;
    try { theme = localStorage.getItem(storageKey); } catch (_) {}
    setTheme(theme);
  }

  function matrix() {
    const surface = document.createElement('div');
    surface.className = 'rollo-matriz';
    surface.setAttribute('aria-hidden', 'true');
    const viewport = document.createElementNS(namespace, 'svg');
    viewport.setAttribute('viewBox', '0 0 36 11');
    viewport.setAttribute('fill', 'currentColor');
    surface.appendChild(viewport);
    return surface;
  }

  function paint(host, rows) {
    const content = document.createDocumentFragment();
    rows.forEach((line, y) => {
      Array.prototype.forEach.call(line, (bit, x) => {
        if (bit !== '1') return;
        const point = document.createElementNS(namespace, 'rect');
        point.setAttribute('x', x + .14);
        point.setAttribute('y', y + .14);
        point.setAttribute('width', '.72');
        point.setAttribute('height', '.72');
        point.setAttribute('rx', '.22');
        content.appendChild(point);
      });
    });
    const viewport = host.firstElementChild;
    viewport.textContent = '';
    viewport.appendChild(content);
  }

  function showMode(lcd, mode) {
    if (!lcd) return;
    const prior = timelines.get(lcd);
    if (prior) prior();
    const surface = matrix();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeline = reduced ? [{ desdeMs: 0, frame: sequence.reducido.frame }] : sequence.tiempos;
    const aliases = sequence.modo[mode] || sequence.modo.cam;
    const timers = [];
    const close = () => {
      timers.forEach(clearTimeout);
      surface.remove();
      timelines.delete(lcd);
    };
    for (const item of timeline) {
      const frame = sequence.frames[aliases[item.frame] || item.frame];
      if (!item.desdeMs) paint(surface, frame);
      else timers.push(setTimeout(() => paint(surface, frame), item.desdeMs));
    }
    timers.push(setTimeout(close, reduced ? sequence.reducido.duracionMs : sequence.duracionMs));
    timelines.set(lcd, close);
    lcd.appendChild(surface);
  }

  function playBoot() {
    const feel = window.flipFeel;
    if (!feel || !feel.prefs().sound || feel.state().recording || document.hidden) return;
    const sound = new Audio(url('arranque/guino.wav'));
    sound.play().catch(() => {});
  }

  // El logo vivo de la portada: la cámara flota, parpadea, guiña y abre sus tres capas; las letras
  // dan un saltito. Cada pieza es su propio SVG y solo se mueve con transform y opacity (app.css),
  // así el bucle no repinta nada.
  const CUERPO = 'M6 27Q7 18 17 17H19L23 11Q25 8 29 8H42Q47 8 49 13L51 17Q58 18 59 25L61 40Q63 53 51 55L18 59Q7 60 5 49L4 39Q3 32 6 27Z';
  const GUINO = 'M13 35Q20 27 29 32Q33 35 30 38Q28 40 25 38Q21 35 17 39Q13 40 13 35Z';
  const LETRAS = [
    ['M0 12Q0 3 10 3H33Q40 3 40 10Q40 16 33 16H15V22H29Q36 22 36 28Q36 34 29 34H15V39Q15 46 8 46Q0 46 0 39Z', 'translate(7 0) rotate(-4 20 23)'],
    ['M0 11Q0 3 8 3Q15 3 15 11V31Q15 34 19 34H33Q40 34 40 40Q40 46 33 46H13Q0 46 0 34Z', 'translate(52 0) rotate(2 20 23)'],
    ['M13 0Q20 1 20 7Q20 13 12 13Q4 13 4 7Q4 0 13 0ZM3 22Q3 17 11 17Q18 17 18 23V39Q18 46 10 46Q3 46 3 39Z', 'translate(95 -1) rotate(-5 10 23)'],
    ['M0 12Q0 3 9 3H24Q44 3 44 20Q44 36 24 36H15V39Q15 46 8 46Q0 46 0 39ZM15 16V24H24Q29 24 29 20Q29 16 24 16Z', 'translate(123 0) rotate(2 21 23)'],
  ];
  function ident() {
    const svg = (cls, box, body) => '<svg class="' + cls + '" viewBox="' + box + '" focusable="false">' + body + '</svg>';
    const capa = (cls, color) => svg('rv-capa ' + cls, '0 0 64 64', '<path d="' + CUERPO + '" fill="' + color + '"/>');
    const lente = '<circle cx="8" cy="8" r="8" fill="#FFF3DC"/><circle cx="8" cy="8" r="4.3" fill="#151727"/>';
    const root = document.createElement('div');
    root.className = 'rollo-ident rollo-vivo';
    root.innerHTML = '<div class="rv-flota"><div class="rv-cabeza">' + capa('rv-azul', '#3D5FE6') + capa('rv-mandarina', '#F77F50') + capa('rv-verde', '#7DDB8B') +
      svg('rv-ojo rv-ojo-i', '0 0 16 16', lente) + svg('rv-ojo rv-ojo-d', '0 0 16 16', lente) + svg('rv-capa rv-guino', '0 0 64 64', '<path d="' + GUINO + '" fill="#FFF3DC"/>') + '</div></div>' +
      '<div class="rv-letras">' + LETRAS.map(([d, t]) => svg('rv-letra', '0 -3 177 58', '<path transform="translate(1 0) ' + t + '" d="' + d + '" fill="#FFF3DF" fill-rule="evenodd"/>')).join('') + '</div>';
    return root;
  }

  function mount(splash, deck, launcher) {
    restoreTheme();
    const hero = splash && splash.querySelector('.splash-hero');
    if (hero) {
      hero.prepend(ident());
      hero.classList.add('rollo-ident-listo');
    }
    if (deck) {
      const plate = document.createElement('span');
      plate.className = 'rollo-pie';
      plate.setAttribute('aria-label', 'FLIP FL-27');
      plate.setAttribute('role', 'img');
      deck.appendChild(plate);
    }
    const head = launcher && launcher.querySelector('.launcher-head');
    if (head) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.id = 'rolloTema';
      toggle.className = 'hw hw-keycap';
      toggle.setAttribute('aria-label', 'Cambiar el color de la carcasa');
      toggle.textContent = document.body.dataset.tema === 'oscuro' ? 'CARCASA CLARA' : 'CARCASA OSCURA';
      toggle.setAttribute('aria-pressed', String(document.body.dataset.tema === 'oscuro'));
      toggle.addEventListener('click', () => setTheme(document.body.dataset.tema === 'oscuro' ? 'principal' : 'oscuro'));
      head.insertBefore(toggle, head.querySelector('#launcherClose'));
    }
  }

  function cancelMode(lcd) {
    const close = lcd && timelines.get(lcd);
    if (close) close();
  }

  window.flipRollo = { paths, palette, mount, showMode, cancelMode, setTheme, playBoot, url };
})();
