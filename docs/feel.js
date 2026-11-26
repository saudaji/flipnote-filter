// FLIP FL-27 · tacto: el sonido y la vibración de las teclas.
// Cada pieza suena como lo que es, y todas suenan a plástico golpeando plástico: un chasquido
// seco y corto, sin nota. El disparador pesa y tiene dos tiempos (hundirlo y la cortinilla); las
// teclas hacen clac al bajar y un tic más fino al subir; los botones redondos son sordos; el
// interruptor roza y encaja; las perillas y los deslizadores marcan muescas. La vibración lleva
// el mismo ritmo que el sonido: un golpe, un pulso.
//
// Para que no sea una cacofonía:
//   · solo suena lo que el dedo pulsa de verdad, nunca un cambio automático;
//   · lo que vive dentro de una lista que se desplaza suena al elegirlo, no al tocarlo;
//   · un sonido cada vez: si coinciden dos, gana la pieza más importante;
//   · mientras se graba las teclas callan y queda solo la vibración; con el micrófono abierto bajan;
//   · las muescas se espacian y se apagan cuanto más deprisa se gira.
// Todo se sintetiza aquí (no hay archivos de audio). Un golpe es un impulso seco más un soplo de
// ruido que se apaga, pasados por bandas muy anchas: nada resuena el tiempo suficiente para
// dejar una altura. Lo agudo dura un milisegundo; lo grave, diez.
(function () {
  'use strict';
  const STORE = 'flip.feel.v1';
  const prefs = { sound: true, haptic: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (_) {}

  // ── Recetas ─────────────────────────────────────────────────────────────────
  // hits: golpes, cada uno en su instante (at, ms) y con su fuerza (gain). Un golpe suma bandas
  // [Hz, anchura q, caída ms, nivel, grano, subida ms]: q ≈ 1 es más de una octava (sin altura);
  // grano es cuánto de la banda es ruido que se apaga (el resto, el impulso seco del contacto);
  // la subida solo la usan los roces. contact: lo que dura el contacto (ms): más largo, más blando.
  // lp: paso bajo final (Hz).
  // Dos voces, una por piel. OBJETO: carcasa de plástico (cuerpo entre 250 y 1900 Hz, tope y
  // rebote). INTERFAZ: cartulina troquelada y obturador de hoja (más corta, más seca, sin caja).
  // La jerarquía de volumen real va de mayor a menor: disparo, tecla grande, tecla, interruptor,
  // botón blando, muesca.
  const RECIPES = {
    objeto: {
      // Tecla ABS: contacto breve, tope con cuerpo cálido (~1.7 kHz) sin dureza arriba de 4 kHz y micro-rebote.
      keyDown: { contact: .15, lp: 9200, hits: [
        { gain: .42, bands: [[3400, .85, .8, .48, .35], [1800, .85, 1.4, .52, .45]] },
        { at: 5.5, bands: [[1950, .85, 2.4, .9, .5], [1050, .85, 3.2, .68, .55], [3200, .85, 1.3, .45, .45], [520, .85, 4.2, .38, .55], [260, .85, 4.8, .18, .5], [1300, .75, 9.5, .05, 1]] },
        { at: 9.5, gain: .16, bands: [[1550, .85, 1.8, .65, .55], [2900, .85, 1.0, .4, .45]] },
      ] },
      // Retorno de tecla: más ligero y consistente (~2.3 kHz), sin picos erráticos de 6.5 kHz.
      keyUp: { contact: .12, lp: 9600, hits: [
        { bands: [[2450, .85, 1.7, .8, .45], [1400, .85, 2.2, .52, .5], [4100, .85, .9, .42, .4], [760, .85, 2.8, .22, .55], [1700, .75, 7, .04, 1]] },
      ] },
      // Tecla grande / tarjeta: caja ABS más grave (~1.35 kHz), firme pero sin boom cansado.
      primaryDown: { contact: .19, lp: 8600, hits: [
        { gain: .4, bands: [[2600, .85, 1.0, .45, .35], [1350, .85, 1.7, .55, .45]] },
        { at: 7.5, bands: [[1400, .85, 3.0, .88, .52], [740, .85, 4.2, .74, .58], [2500, .85, 1.6, .42, .45], [360, .85, 5.8, .46, .58], [185, .85, 6.8, .24, .52], [950, .75, 12, .055, 1]] },
        { at: 12.5, gain: .16, bands: [[1150, .85, 2.2, .65, .55], [2200, .85, 1.1, .38, .45]] },
      ] },
      // Retorno de tecla grande: suelta el muelle un poco más grave que keyUp.
      primaryUp: { contact: .15, lp: 9000, hits: [
        { bands: [[1900, .85, 2.0, .75, .48], [1050, .85, 2.8, .52, .52], [3300, .85, 1.0, .38, .42], [580, .85, 3.2, .24, .55]] },
      ] },
      // Disparador al hundir: recorrido amortiguado (~1.05 kHz), más discreto que el disparo para dejarlo brillar.
      shutterDown: { contact: .26, lp: 7400, hits: [
        { gain: .38, bands: [[2200, .85, 1.0, .5, .4]] },
        { at: 4.5, bands: [[1180, .85, 3.0, .82, .52], [640, .85, 4.2, .75, .58], [2100, .85, 1.5, .38, .45], [310, .85, 5.8, .42, .58], [175, .85, 6.5, .22, .52]] },
      ] },
      // Disparo: el rey. Cortinilla 1 → mecanismo audible continuo (sin hueco muerto) → cortinilla 2 con cuerpo a 38 ms.
      shutterFire: { contact: .11, lp: 10500, hits: [
        { gain: .9, bands: [[2900, .85, 1.6, .85, .48], [5000, .85, 1.0, .55, .42], [1550, .85, 2.3, .58, .52], [720, .85, 3.0, .34, .55]] },
        { at: 4, gain: .26, bands: [[4200, .7, 13, .85, 1, 3], [2200, .75, 16, .65, 1, 6]] },
        { at: 38, bands: [[2200, .85, 2.5, .88, .52], [1180, .85, 3.6, .75, .58], [3900, .85, 1.3, .52, .45], [560, .85, 5.2, .48, .58], [260, .85, 6.2, .26, .52], [1400, .75, 12, .06, 1]] },
      ] },
      // Botón redondo blando: goma/plástico suave (~980 Hz), corto y educado para no tapar a key.
      softDown: { contact: .48, lp: 5400, hits: [
        { bands: [[820, .85, 3.0, .85, .55], [460, .85, 4.2, .62, .58], [1550, .85, 1.8, .44, .48], [240, .85, 4.8, .22, .52]] },
      ] },
      // Retorno de botón redondo: soplo sordo mínimo.
      softUp: { contact: .38, lp: 5800, hits: [
        { bands: [[1200, .75, 2.1, .7, .55], [680, .75, 2.7, .44, .58], [2200, .75, 1.2, .34, .48]] },
      ] },
      // Interruptor deslizante: fricción continua que desemboca directo en el trinquete a 21 ms (sin silencio en medio).
      switch: { contact: .11, lp: 9400, hits: [
        { gain: .42, bands: [[2400, .75, 8.5, .95, 1, 6], [4200, .75, 6.5, .55, 1, 8]] },
        { at: 21, bands: [[2800, .85, 1.6, .85, .42], [4800, .85, .9, .45, .38], [1480, .85, 2.5, .62, .52], [740, .85, 3.5, .36, .58], [320, .85, 4.8, .18, .52]] },
      ] },
      // Diapositiva: roce breve de carril (0–15 ms) y asiento seco en la ranura.
      slide: { contact: .14, lp: 8800, hits: [
        { gain: .45, bands: [[2600, .75, 5.5, .85, .85, 3], [1500, .8, 4.5, .6, .75, 2]] },
        { at: 15, bands: [[1650, .85, 2.6, .85, .52], [900, .85, 3.6, .66, .58], [2900, .85, 1.3, .42, .46], [430, .85, 4.8, .32, .58]] },
      ] },
      // Muesca de perilla / carrete: Delrin/latón cálido (~1.8 kHz, lp 6.8 kHz); gira 30 veces sin picar el oído.
      // ── La galería de CLON (recetas de Gemini Neon) ──
      // Abrir la galería: roce breve de riel plástico (0–18 ms) que abre y encaja en el tope (20 ms).
      drawerOpen: { contact: .15, lp: 8200, hits: [
        { gain: .42, bands: [[1950, .75, 6.5, .88, .92, 4], [1050, .8, 5.5, .62, .85, 3]] },
        { at: 20, bands: [[1420, .85, 2.5, .86, .52], [760, .85, 3.6, .66, .58], [2600, .85, 1.3, .42, .45], [380, .85, 4.6, .34, .55]] },
      ] },
      // Un look entra a la galería: toque de caída (0 ms) y asiento seco (11 ms).
      lookSeat: { contact: .13, lp: 9000, hits: [
        { gain: .46, bands: [[2800, .9, 1.1, .65, .38], [1500, .85, 1.8, .58, .46]] },
        { at: 11, bands: [[1720, .88, 2.4, .9, .48], [920, .85, 3.4, .72, .56], [3150, .85, 1.2, .46, .42], [440, .85, 4.8, .38, .54]] },
      ] },
      // Borrar un look: pestillo breve (0 ms) y caída sorda, más grave (14 ms).
      lookTrash: { contact: .24, lp: 5200, hits: [
        { gain: .44, bands: [[2100, .85, 1.2, .55, .45], [1180, .85, 1.8, .6, .52]] },
        { at: 14, bands: [[680, .88, 3.2, .92, .58], [360, .88, 4.4, .66, .56], [1280, .85, 1.8, .44, .5]] },
      ] },
      // Deshacer el borrado: recogida grave (0 ms) y encaje claro y firme al volver (16 ms).
      lookUndo: { contact: .13, lp: 9200, hits: [
        { gain: .42, bands: [[920, .85, 2.4, .66, .55], [1650, .85, 1.5, .52, .48]] },
        { at: 16, bands: [[2250, .9, 2.0, .9, .44], [1220, .85, 2.8, .66, .52], [3800, .85, 1.0, .44, .4], [540, .85, 3.8, .28, .54]] },
      ] },
      tick: { contact: .13, lp: 6800, hits: [
        { bands: [[1850, .85, 1.2, .85, .45], [980, .85, 1.7, .58, .5], [3200, .8, .75, .38, .45], [520, .85, 2.0, .2, .55]] },
      ] },
      // Tope de perilla (0 %, 100 %, centro) o cierre de video: golpe grave amortiguado con micro-asiento.
      stop: { contact: .3, lp: 4600, hits: [
        { bands: [[680, .9, 3.4, .9, .55], [340, .9, 4.8, .65, .55], [1350, .85, 1.6, .35, .48]] },
        { at: 7, gain: .32, bands: [[520, .9, 3.0, .8, .6], [1050, .85, 1.5, .4, .5]] },
      ] },
      // Conectar cable en STAGE / fijar portal / armar AL GOLPE: encaje metálico-plástico de jack de dos pasos.
      patch: { contact: .1, lp: 9800, hits: [
        { gain: .55, bands: [[3600, 1.1, 1.1, .75, .3], [1900, 1.0, 1.6, .6, .4]] },
        { at: 13, bands: [[2300, 1.0, 2.2, .88, .42], [1150, .9, 3.0, .7, .5], [4400, 1.0, 1.0, .42, .35], [460, .85, 4.2, .34, .52]] },
      ] },
    },
    interfaz: {
      // Tecla plana: un chasquido nítido y plano sin caja hueca (~2.4 kHz, 3.8 ms).
      keyDown: { contact: .09, lp: 8400, hits: [
        { bands: [[2500, 1.1, 1.5, .85, .38], [1450, 1.0, 2.0, .55, .48], [4000, .9, .75, .35, .42], [2100, .7, 5.5, .07, 1]] },
        { at: 4.5, gain: .22, bands: [[1800, 1.0, 1.4, .65, .5]] },
      ] },
      // Soltar tecla: tic de uña sobre cartulina, casi aire.
      keyUp: { contact: .08, lp: 8800, hits: [
        { bands: [[3100, 1.1, 1.1, .8, .35], [1850, 1.0, 1.5, .45, .45], [4700, .9, .6, .28, .4]] },
      ] },
      // Tarjeta / acción principal: troquel seco y firme (~2.0 kHz) con mínimo peso grave.
      primaryDown: { contact: .11, lp: 8000, hits: [
        { bands: [[1900, 1.1, 2.0, .9, .38], [1080, 1.0, 2.6, .62, .48], [3300, .95, 1.0, .38, .4], [580, .9, 3.2, .22, .5]] },
        { at: 6.5, gain: .24, bands: [[1500, 1.0, 1.8, .65, .5]] },
      ] },
      // Retorno de tarjeta: chispa seca y breve.
      primaryUp: { contact: .09, lp: 8600, hits: [
        { bands: [[2500, 1.1, 1.4, .78, .38], [1480, 1.0, 1.8, .48, .45]] },
      ] },
      // Disparador al pulsar: primer paso de bolígrafo de precisión antes del guiño.
      shutterDown: { contact: .14, lp: 7400, hits: [
        { bands: [[1650, 1.05, 2.0, .85, .42], [920, 1.0, 2.8, .6, .48], [2900, .95, 1.0, .32, .4]] },
      ] },
      // Disparo: obturador de hoja rapidísimo (26 ms) que calza exacto con el parpadeo del ojo.
      shutterFire: { contact: .08, lp: 10200, hits: [
        { gain: .88, bands: [[3400, 1.15, 1.2, .85, .34], [1950, 1.05, 1.8, .62, .42], [5400, .95, .75, .45, .36]] },
        { at: 3.5, gain: .24, bands: [[3800, .75, 8.5, .8, 1, 2.5]] },
        { at: 26, bands: [[2600, 1.1, 1.8, .9, .38], [1420, 1.0, 2.5, .7, .48], [4400, 1.0, .95, .45, .38], [680, .9, 3.4, .32, .5]] },
      ] },
      // Botón secundario: toque seco y corto de sello de goma limpia (~1.25 kHz).
      softDown: { contact: .22, lp: 5800, hits: [
        { bands: [[1180, .7, 2.1, .8, .65], [680, .7, 2.8, .55, .65], [2100, .7, 1.1, .45, .55], [3300, .8, .7, .18, .45]] },
      ] },
      // Retorno secundario: apenas perceptible.
      softUp: { contact: .18, lp: 6200, hits: [
        { bands: [[1550, .8, 1.6, .72, .55], [920, .8, 2.0, .42, .58], [2600, .8, .9, .28, .5]] },
      ] },
      // Interruptor: deslizamiento corto de papel/pestaña (16 ms) y cierre instantáneo.
      switch: { contact: .08, lp: 9000, hits: [
        { gain: .44, bands: [[2900, .75, 6.5, .9, 1, 4.5], [4600, .8, 5, .45, 1, 5.5]] },
        { at: 16, bands: [[3100, 1.15, 1.3, .88, .34], [1750, 1.05, 1.9, .6, .44], [5000, 1.0, .7, .36, .35]] },
      ] },
      // Diapositiva / tira de cámaras: tarjeta que pasa por una ranura de cartón (12 ms).
      slide: { contact: .09, lp: 8400, hits: [
        { gain: .48, bands: [[3100, .7, 4.8, .9, .9, 2.5], [1800, .8, 3.8, .55, .8, 1.8]] },
        { at: 12, bands: [[2200, 1.1, 1.8, .86, .42], [1250, 1.0, 2.4, .58, .5], [3600, .95, .95, .36, .42]] },
      ] },
      // Muesca de perilla / carrete: punta fina de lápiz mecánico (~2.5 kHz, 1.5 ms).
      // ── La galería de CLON ──
      // Abrir la galería: pestaña de cartulina que corre (0–12 ms) y traba seca (14 ms).
      drawerOpen: { contact: .1, lp: 8000, hits: [
        { gain: .44, bands: [[2600, .75, 4.6, .88, .92, 3], [1480, .8, 4.0, .58, .82, 2]] },
        { at: 14, bands: [[1950, 1.05, 1.8, .88, .42], [1080, 1.0, 2.5, .6, .48], [3300, .95, .95, .36, .4]] },
      ] },
      // Un look entra: contacto seco de tarjeta (0 ms) y encaje troquelado (9 ms).
      lookSeat: { contact: .09, lp: 8800, hits: [
        { gain: .46, bands: [[3300, 1.1, .95, .66, .34], [1850, 1.0, 1.4, .55, .42]] },
        { at: 9, bands: [[2250, 1.1, 1.7, .9, .38], [1240, 1.0, 2.3, .64, .46], [3900, 1.0, .85, .38, .36], [620, .9, 2.9, .24, .5]] },
      ] },
      // Borrar: suelta seca (0 ms) y caída sorda sobre la mesa (11 ms).
      lookTrash: { contact: .22, lp: 4800, hits: [
        { gain: .40, bands: [[2300, .95, .95, .5, .44], [1280, .9, 1.4, .54, .5]] },
        { at: 11, bands: [[840, .95, 2.3, .88, .56], [450, .9, 3.2, .58, .55], [1560, .9, 1.2, .34, .48]] },
      ] },
      // Deshacer: arranque contenido (0 ms) y chasquido nítido de vuelta (12 ms).
      lookUndo: { contact: .09, lp: 9000, hits: [
        { gain: .42, bands: [[1200, .95, 1.8, .64, .5], [2100, .95, 1.2, .5, .44]] },
        { at: 12, bands: [[2700, 1.1, 1.5, .9, .36], [1500, 1.0, 2.1, .62, .44], [4500, 1.0, .8, .4, .34]] },
      ] },
      tick: { contact: .09, lp: 7200, hits: [
        { bands: [[2150, 1.1, .95, .85, .36], [1250, 1.0, 1.3, .5, .44], [3600, .95, .55, .3, .38]] },
      ] },
      // Tope de perilla: doble golpecito seco de cartulina contra mesa (~1.0 kHz).
      stop: { contact: .2, lp: 5000, hits: [
        { bands: [[920, 1.05, 2.6, .88, .48], [480, 1.0, 3.6, .58, .52], [1700, .95, 1.2, .32, .44]] },
        { at: 6, gain: .3, bands: [[740, 1.0, 2.2, .75, .52]] },
      ] },
      // Encaje de cable / portal / armado AL GOLPE: doble clic metálico-gráfico ultranítido (11 ms).
      patch: { contact: .08, lp: 9600, hits: [
        { gain: .55, bands: [[4000, 1.2, .9, .78, .28], [2200, 1.1, 1.3, .58, .36]] },
        { at: 11, bands: [[2700, 1.15, 1.7, .88, .35], [1480, 1.05, 2.2, .65, .42], [4900, 1.05, .8, .38, .32]] },
      ] },
    },
  };

  // Cada pieza: su rango (quién gana si coinciden), y qué suena y vibra al bajar, al subir y al
  // actuar. vib: milisegundos, o un patrón [vibra, pausa, vibra…] con el ritmo del sonido.
  // Gramática para distinguirlo todo con los ojos cerrados: un pulso corto (5–11 ms) es un toque
  // directo; dos pulsos en ritmo, una pieza con recorrido (deslizar y encajar); el disparador tiene
  // firma propia (hundir, dos cortinillas; en video, corto-largo al abrir y largo-corto al cerrar).
  // Ningún pulso baja de 5 ms (el motor no llega a arrancar) ni pasa de 13 (deja de ser un clic).
  const KINDS = {
    shutter: { rank: 5, down: { sound: 'shutterDown', gain: .68, vib: 9 }, arm: { sound: 'patch', gain: .62, vib: [6, 18, 6] }, fire: { sound: 'shutterFire', gain: 1, vib: [8, 30, 12] } },
    // Video: solo vibración (ningún sonido que se cuele en la toma).
    recStart: { rank: 5, down: { vib: [6, 24, 13] } },
    recStop: { rank: 5, down: { vib: [13, 28, 6] } },
    primary: { rank: 4, down: { sound: 'primaryDown', gain: .84, vib: 11 }, up: { sound: 'primaryUp', gain: .44 } },
    key: { rank: 3, down: { sound: 'keyDown', gain: .74, vib: 8 }, up: { sound: 'keyUp', gain: .38 } },
    switch: { rank: 3, late: true, down: { sound: 'switch', gain: .74, vib: [6, 22, 9] } },
    // Un cable que encaja en STAGE, un portal que se fija.
    patch: { rank: 3, down: { sound: 'patch', gain: .78, vib: [6, 15, 10] } },
    soft: { rank: 2, down: { sound: 'softDown', gain: .38, vib: 6 }, up: { sound: 'softUp', gain: .22 } },
    slide: { rank: 2, late: true, down: { sound: 'slide', gain: .6, vib: [5, 14, 7] } },
    // El tope de una perilla (mínimo, máximo o su centro).
    stop: { rank: 2, down: { sound: 'stop', gain: .42, vib: [9, 14, 5] } },
    plain: { rank: 2, down: { sound: 'softDown', gain: .28, vib: 5 } },
    // El doble guiño de la placa: dos parpadeos en la mano.
    wink: { rank: 2, down: { sound: 'keyDown', gain: .45, vib: [5, 65, 5] } },
    tick: { rank: 1, down: { sound: 'tick', gain: .34, vib: 5 } },
    // La galería de CLON: abrirla, un look que entra, borrar y deshacer (borrar y deshacer son un par:
    // sordo y hacia abajo uno, nítido y hacia arriba el otro; se distinguen con los ojos cerrados).
    drawerOpen: { rank: 3, down: { sound: 'drawerOpen', gain: .62, vib: [5, 18, 8] } },
    lookSeat: { rank: 3, down: { sound: 'lookSeat', gain: .70, vib: [7, 12, 10] } },
    lookTrash: { rank: 3, down: { sound: 'lookTrash', gain: .52, vib: [11, 16, 5] } },
    lookUndo: { rank: 3, down: { sound: 'lookUndo', gain: .66, vib: [5, 16, 11] } },
  };
  // De la pieza más concreta a la más genérica.
  const MAP = [
    ['#deckShutter, #rigPhoto', 'shutter'],
    ['.hw-switch, .cs-toggle, [role="switch"], input[type="checkbox"], [data-mode-label], #escuchaOn, #escuchaGolpe, #consolaMarco, #reaccionInvertir, [data-reaccion="invertir"]', 'switch'],
    ['.launcher-card, .launcher-modo, .splash-door, .btn-center, .viewer-actions .primary', 'primary'],
    ['.look, .flip-settings-tile', 'slide'],
    ['.hw-keycap, .launcher-sub, .si-chip, .si-variante, .si-abrir, .cs-key, .flip-settings-pill, .flip-settings-segments button, #palettes button, #palettes label.asp-btn', 'key'],
    ['.hw-candy, #deckGallery, #sflowAdjust', 'soft'],
    ['button, .btn, [role="button"], summary', 'plain'],
  ];
  const skin = () => (document.body && document.body.dataset.piel === 'interfaz' ? 'interfaz' : 'objeto');
  const ANY = '[data-feel], ' + MAP.map(entry => entry[0]).join(', ');
  function find(target) {
    const node = target && target.closest ? target.closest(ANY) : null;
    if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return null;
    const tagged = node.dataset.feel;
    if (tagged) return KINDS[tagged] ? { node, name: tagged } : null;      // data-feel="none" calla la pieza
    for (const [selector, name] of MAP) if (node.matches(selector)) {
      // En la piel INTERFAZ la cámara ya elegida no cambia de cámara: abre el cajón. Suena a tecla.
      if (name === 'slide' && skin() === 'interfaz' && node.matches('.look.is-on')) return { node, name: 'key' };
      return { node, name };
    }
    return null;
  }
  // ¿Está dentro de algo que se desplaza? Entonces el toque puede ser el inicio de un arrastre.
  function scrolls(node) {
    for (let parent = node.parentElement, depth = 0; parent && parent !== document.body && depth < 14; parent = parent.parentElement, depth++) {
      const tall = parent.scrollHeight > parent.clientHeight + 2, wide = parent.scrollWidth > parent.clientWidth + 2;
      if (!tall && !wide) continue;
      const style = getComputedStyle(parent);
      if ((tall && /auto|scroll/.test(style.overflowY)) || (wide && /auto|scroll/.test(style.overflowX))) return true;
    }
    return false;
  }

  // ── Síntesis ────────────────────────────────────────────────────────────────
  const RATE = 48000, VARIANTS = 5;
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // Paso de banda de dos polos con ganancia de pico constante, en el sitio.
  function bandpass(x, f, q, sr) {
    const w0 = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
    const b0 = alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * (v - x2) - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
  }
  function unit(x) {
    let peak = 0;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    if (peak > 0) for (let i = 0; i < x.length; i++) x[i] /= peak;
  }
  function synth(recipe, seed, sr = RATE) {
    const rnd = mulberry(seed);
    let end = 0;
    for (const hit of recipe.hits) for (const band of hit.bands) end = Math.max(end, (hit.at || 0) + (band[5] || 0) + band[2] * 7 + 4);
    const n = Math.ceil((end + 6) * sr / 1000);
    const out = new Float32Array(n);
    const tune = 1 + (rnd() - 0.5) * 0.07;                       // cada tecla, un pelo distinta
    const touch = Math.max(2, Math.round((recipe.contact || 0.14) * sr / 1000));
    for (const hit of recipe.hits) {
      const start = Math.round((hit.at || 0) * sr / 1000), g = hit.gain == null ? 1 : hit.gain;
      for (const [f, q, decay, level, grit, rise = 0] of hit.bands) {
        const tau = decay * sr / 1000, up = Math.max(2, Math.round((rise || 0.1) * sr / 1000));
        const count = Math.max(8, Math.min(n - start, Math.ceil(tau * 7 + up + sr * 0.003)));
        const centre = f * tune * (1 + (rnd() - 0.5) * 0.05), amp = level * g * (0.94 + rnd() * 0.12);
        // El impulso seco: lo que dura el contacto, medio coseno.
        const dry = new Float32Array(count);
        if (grit < 1) {
          for (let i = 0; i < touch && i < count; i++) dry[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / touch);
          bandpass(dry, centre, q, sr);
          unit(dry);
        }
        // El grano: ruido que se apaga, por dos bandas seguidas para que no sisee fuera de la suya.
        const wet = new Float32Array(count);
        if (grit > 0) {
          for (let i = 0; i < count; i++) wet[i] = (rnd() * 2 - 1) * Math.min(1, i / up) * Math.exp(-Math.max(0, i - up) / tau);
          bandpass(wet, centre, q * 0.8, sr);
          bandpass(wet, centre, q * 0.8, sr);
          unit(wet);
        }
        for (let i = 0; i < count; i++) out[start + i] += amp * ((1 - grit) * dry[i] + grit * wet[i]);
      }
    }
    // Paso alto (nada de bombeo por debajo de lo que un altavoz pequeño mueve) y paso bajo final.
    const pass = (f, high) => {
      const w0 = 2 * Math.PI * f / sr, cos = Math.cos(w0), alpha = Math.sin(w0) / 1.414, a0 = 1 + alpha;
      const b0 = (high ? (1 + cos) / 2 : (1 - cos) / 2) / a0, b1 = (high ? -(1 + cos) : 1 - cos) / a0, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) { const x = out[i], y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y; }
    };
    pass(110, true);
    pass(recipe.lp || 11000, false);
    // Un punto de saturación: el golpe gana cuerpo sin subir el pico.
    unit(out);
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 1.5);
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    const scale = peak > 0 ? 0.9 / peak : 0, tail = Math.round(sr * 0.004);
    for (let i = 0; i < n; i++) out[i] *= scale * Math.min(1, (n - i) / tail);
    return out;
  }
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 600));
  // Un banco de sonidos por piel. Se sintetiza el de la piel en uso; el otro, la primera vez que hace falta.
  const buffers = {};
  const seedOf = (bank, index, v) => 977 + (bank === 'interfaz' ? 4099 : 0) + index * 131 + v * 17;
  // all: de una vez (el primer toque no espera). Si no, una receta por rato libre: sintetizar el
  // banco entero de golpe es un tirón que al arrancar se nota.
  const wip = {};
  function build(bank = skin(), all = true) {
    if (buffers[bank] || typeof AudioBuffer === 'undefined') return;
    const names = Object.keys(RECIPES[bank]), made = wip[bank] || (wip[bank] = {});
    try {
      for (let index = 0; index < names.length; index++) {
        const name = names[index];
        if (made[name]) continue;
        made[name] = [];
        for (let v = 0; v < VARIANTS; v++) {
          const data = synth(RECIPES[bank][name], seedOf(bank, index, v));
          const buffer = new AudioBuffer({ length: data.length, sampleRate: RATE, numberOfChannels: 1 });
          buffer.getChannelData(0).set(data);
          made[name].push(buffer);
        }
        if (!all) { idle(() => build(bank, false), { timeout: 900 }); return; }
      }
      buffers[bank] = made;
      delete wip[bank];
    } catch (_) { delete wip[bank]; }
  }
  if (prefs.sound) idle(() => build(skin(), false), { timeout: 2500 });
  // Al cambiar de piel cambia la voz.
  if (document.body) new MutationObserver(() => { if (prefs.sound) idle(() => build(skin(), false), { timeout: 1200 }); }).observe(document.body, { attributes: true, attributeFilter: ['data-piel'] });

  // ── Salida ──────────────────────────────────────────────────────────────────
  let ctx = null, bus = null, pending = null;
  const turn = {};
  // El contexto de audio se queda en marcha entre toque y toque. Suspenderlo en las pausas ahorra muy
  // poco y se paga en el tacto: al despertarlo, el primer clic llega tarde o no suena.
  function wake() {
    if (!prefs.sound) return;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { try { ctx = new AC(); } catch (__) { return; } }
      bus = ctx.createGain();
      bus.gain.value = 1;
      bus.connect(ctx.destination);
      // El primer toque llega antes de que el navegador deje sonar: se toca al abrirse el paso.
      ctx.onstatechange = () => {
        if (ctx.state !== 'running' || !pending) return;
        const wait = pending; pending = null;
        if (performance.now() - wait.at < 160) play(wait.sound, wait.gain, wait.x, 0);
      };
      build();
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }
  // Sin vibración (iPhone, escritorio) el oído hace el trabajo del dedo: un punto más de nivel.
  const NO_HAPTIC = !navigator.vibrate;
  // La voz de INTERFAZ es más corta y seca: estos ajustes dejan su jerarquía igual que la de OBJETO.
  const TRIM = { interfaz: { primaryDown: .94, shutterDown: .89, switch: .92, lookTrash: .84 } };
  function play(sound, gain, x, delay, shape) {
    if (!buffers[skin()]) build();
    const bank = buffers[skin()] || buffers.objeto || buffers.interfaz;
    if (!ctx || !bus || !bank || !bank[sound]) return false;
    if (ctx.state !== 'running') { if (!delay) pending = { sound, gain, x, at: performance.now() }; return false; }
    const set = bank[sound];
    turn[sound] = ((turn[sound] || 0) + 1 + (Math.random() * (set.length - 1) | 0)) % set.length;
    const source = ctx.createBufferSource();
    source.buffer = set[turn[sound]];
    source.playbackRate.value = (shape && shape.rate || 1) * (1 + (Math.random() - 0.5) * 0.045);
    const amp = ctx.createGain();
    amp.gain.value = Math.min(1.1, gain * ((TRIM[skin()] || {})[sound] || 1) * (0.92 + Math.random() * 0.16) * (NO_HAPTIC ? 1.18 : 1));
    // El dedo nunca cae igual: tres decibelios de inclinación al azar en los agudos, y ningún clic
    // repite al anterior. Las muescas rápidas, además, se apagan por arriba (no solo de volumen).
    let node = source;
    if (ctx.createBiquadFilter) {
      const tilt = ctx.createBiquadFilter();
      tilt.type = 'highshelf'; tilt.frequency.value = 2200; tilt.gain.value = (Math.random() - 0.5) * 3;
      node.connect(tilt); node = tilt;
      if (shape && shape.lp) {
        const soft = ctx.createBiquadFilter();
        soft.type = 'lowpass'; soft.frequency.value = shape.lp; soft.Q.value = 0.5;
        node.connect(soft); node = soft;
      }
    }
    node.connect(amp);
    // Cada pieza suena desde donde está: las de la izquierda, un poco a la izquierda.
    if (ctx.createStereoPanner && x != null && innerWidth > 0) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.6, Math.min(0.6, (x / innerWidth - 0.5) * 1.1));
      amp.connect(pan); pan.connect(bus);
    } else amp.connect(bus);
    source.start(ctx.currentTime + (delay || 0) / 1000);
    return true;
  }
  function buzz(pattern, delay) {
    if (!prefs.haptic || !navigator.vibrate || !pattern) return false;
    const go = () => { try { navigator.vibrate(pattern); } catch (_) {} };
    if (delay) setTimeout(go, delay); else go();
    return true;
  }

  // ── Cuándo callar ───────────────────────────────────────────────────────────
  const hushed = new Set();
  const recording = () => hushed.size > 0 || document.body.classList.contains('is-recording') || !!document.querySelector('.btn.recording');
  // Micrófonos abiertos por cualquier módulo: el altavoz se cuela en ellos.
  const microphones = new Set();
  // Safari recoge el envoltorio de navigator.mediaDevices si nadie lo sujeta, y con él esta función:
  // se guarda una referencia para que siga puesta.
  const devices = navigator.mediaDevices;
  if (devices && devices.getUserMedia) {
    const open = devices.getUserMedia.bind(devices);
    devices.getUserMedia = function (constraints) {
      const request = open(constraints);
      if (constraints && constraints.audio) request.then(stream => stream.getAudioTracks().forEach(track => microphones.add(track)), () => {});
      return request;
    };
  }
  function micLive() {
    for (const track of microphones) { if (track.readyState === 'live') return true; microphones.delete(track); }
    return false;
  }

  // ── Un toque ────────────────────────────────────────────────────────────────
  const GATE = 22;                                    // ms entre sonidos
  let last = { at: -1e9, rank: 0, name: '' };
  const log = [];
  function emit(name, phase, x, delay, scale = 1) {
    const kind = KINDS[name], step = kind && kind[phase];
    if (!step) return false;
    const at = performance.now() + (delay || 0);
    if (phase !== 'fire' && at - last.at < GATE && kind.rank <= last.rank) return false;
    // Tamborilear sobre la misma pieza no suma volumen.
    const drum = phase !== 'fire' && name === last.name && at - last.at < 110 ? 0.72 : 1;
    last = { at, rank: kind.rank, name };
    const level = recording() ? 0 : micLive() ? 0.3 : 1;
    const gain = (step.gain || 0) * level * drum * scale;
    const sounded = step.sound && prefs.sound && level > 0 && !document.hidden ? play(step.sound, gain, x, delay) || !!pending : false;
    const vibrated = step.vib ? buzz(step.vib, delay) : false;
    log.push({ kind: name, phase, sound: sounded ? step.sound : '', vib: vibrated ? step.vib : 0, gain: +gain.toFixed(3), at: Math.round(at) });
    if (log.length > 60) log.shift();
    return true;
  }
  // Muesca de perilla, deslizador o carrete: como mucho una cada 30 ms, y más suave cuanto más
  // rápido. ratio (0..1) es en qué punto del recorrido cae: el resorte se tensa y la muesca sube un
  // pelo de tono (se nota como tensión, no como nota).
  let lastTick = 0, tickRun = 0;
  function detent(x, ratio) {
    const now = performance.now(), gap = now - lastTick;
    if (gap < 30) return false;
    tickRun = gap < 90 ? Math.min(tickRun + 1, 8) : 0;
    lastTick = now;
    const level = recording() ? 0 : micLive() ? 0.3 : 1;
    const gain = KINDS.tick.down.gain * level * (1 - tickRun * 0.05);
    const shape = { rate: ratio == null || !isFinite(ratio) ? 1 : 0.93 + 0.16 * Math.max(0, Math.min(1, ratio)), lp: tickRun > 1 ? 8000 - (tickRun - 1) * 650 : 0 };
    const sounded = prefs.sound && level > 0 && !document.hidden ? play('tick', gain, x, 0, shape) : false;
    // Despacio, una vibración por muesca; deprisa, una de cada dos o de cada tres: el motor no zumba.
    const stride = tickRun >= 6 ? 3 : tickRun >= 2 ? 2 : 1;
    const vibrated = tickRun % stride === 0 ? buzz(KINDS.tick.down.vib, 0) : false;
    log.push({ kind: 'tick', phase: 'down', sound: sounded ? 'tick' : '', vib: vibrated ? KINDS.tick.down.vib : 0, gain: +gain.toFixed(3), at: Math.round(now) });
    if (log.length > 60) log.shift();
    return true;
  }
  // El tope: suena una vez al llegar y no otra hasta despegarse de él. key identifica la perilla.
  const stops = new Map();
  function edge(key, at, x) {
    if (!at) { stops.delete(key); return false; }
    if (stops.get(key) === at) return false;
    stops.set(key, at);
    if (stops.size > 40) stops.delete(stops.keys().next().value);
    last.at = -1e9;
    return emit('stop', 'down', x);
  }

  let press = null;
  document.addEventListener('pointerdown', event => {
    if (!event.isTrusted || event.button > 0) return;
    wake();
    const hit = find(event.target);
    if (!hit) { press = null; return; }
    const kind = KINDS[hit.name];
    press = { node: hit.node, name: hit.name, at: performance.now(), x: event.clientX, late: !!kind.late || scrolls(hit.node), wasRecording: recording() };
    // Parar un video es un solo gesto: su firma llega al soltar, sin el golpe de hundir.
    if (!press.late && !(press.name === 'shutter' && press.wasRecording)) emit(press.name, 'down', press.x);
  }, { capture: true, passive: true });
  document.addEventListener('pointerup', event => {
    if (!event.isTrusted || !press) return;
    wake();
    const held = performance.now() - press.at;
    // Una tecla que se sostuvo suelta con más peso que un toque rápido.
    if (!press.late && held > 38) emit(press.name, 'up', press.x, 0, held > 180 ? 1.1 : 1);
  }, { capture: true, passive: true });
  document.addEventListener('pointercancel', () => { press = null; }, { capture: true, passive: true });
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    wake();
    const hit = find(event.target);
    const mine = press && hit && press.node === hit.node ? press : null;
    press = null;
    if (!hit) return;
    const x = mine ? mine.x : (hit.node.getBoundingClientRect().left + hit.node.offsetWidth / 2);
    // Lo que esperaba a confirmarse (listas, interruptores) y lo que llega por teclado suena ahora.
    if ((mine && mine.late) || (!mine && event.detail === 0)) {
      if (emit(hit.name, 'down', x) && KINDS[hit.name].up) emit(hit.name, 'up', x, 78);
    }
    if (hit.name === 'shutter') {
      const video = hit.node.id === 'deckShutter' && document.body.classList.contains('cam-video');
      // Con AL GOLPE el toque solo arma: el disparo suena cuando de verdad cae la foto (escucha.js).
      const waits = hit.node.id === 'deckShutter' && window.flipEscucha && flipEscucha.waits && flipEscucha.waits();
      if (video) emit(mine && mine.wasRecording ? 'recStop' : 'recStart', 'down', x);
      else if (waits) emit('shutter', 'arm', x);
      else emit('shutter', 'fire', x);
    }
  }, { capture: true });
  // Deslizadores: una muesca cada vigésimo del recorrido.
  const steps = new WeakMap();
  document.addEventListener('input', event => {
    const node = event.target;
    if (!event.isTrusted || !node || node.type !== 'range') return;
    const min = +node.min || 0, max = node.max === '' ? 100 : +node.max;
    const step = Math.round((+node.value - min) / ((max - min) || 1) * 20);
    if (steps.get(node) === step) return;
    steps.set(node, step);
    const rect = node.getBoundingClientRect();
    detent(rect.left + rect.width * step / 20, step / 20);
  }, { capture: true, passive: true });

  // La tira de cámaras es un carrete: al pasarla con el dedo, cada cámara que cruza el centro
  // marca una muesca (un poco más aguda cuanto más a la derecha). Solo cuando la mueve un dedo o la
  // rueda: si la tira se recoloca sola al elegir una cámara, calla.
  const reel = { live: false, touch: false, index: -1, raf: 0, idle: 0 };
  const strip = target => target && target.closest ? target.closest('#deckLooks') : null;
  document.addEventListener('touchstart', event => { reel.touch = !!strip(event.target); }, { capture: true, passive: true });
  document.addEventListener('touchend', () => { reel.touch = false; }, { capture: true, passive: true });
  document.addEventListener('touchcancel', () => { reel.touch = false; }, { capture: true, passive: true });
  document.addEventListener('wheel', event => { if (strip(event.target)) reel.live = true; }, { capture: true, passive: true });
  function reelStep(track) {
    reel.raf = 0;
    const tiles = [...track.querySelectorAll('.look')].filter(tile => tile.offsetWidth > 0);
    if (!tiles.length) return;
    const box = track.getBoundingClientRect(), middle = box.left + box.width / 2;
    let best = -1, gap = 1e9;
    tiles.forEach((tile, i) => { const r = tile.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - middle); if (d < gap) { gap = d; best = i; } });
    if (best === reel.index) return;
    const first = reel.index < 0;
    reel.index = best;
    if (first || !reel.live) return;
    if (detent(middle, tiles.length > 1 ? best / (tiles.length - 1) : 0.5)) {
      const tile = tiles[best];
      tile.classList.remove('paso'); void tile.offsetWidth; tile.classList.add('paso');
      setTimeout(() => tile.classList.remove('paso'), 160);
    }
  }
  document.addEventListener('scroll', event => {
    const track = event.target && event.target.nodeType === 1 && event.target.closest ? event.target.closest('#deckLooks, #deckLooks *') : null;
    if (!track || !event.isTrusted) return;
    if (reel.touch) reel.live = true;
    clearTimeout(reel.idle);
    reel.idle = setTimeout(() => { reel.live = false; }, 160);
    if (!reel.raf) reel.raf = requestAnimationFrame(() => reelStep(event.target));
  }, { capture: true, passive: true });

  // ── Ajustes ─────────────────────────────────────────────────────────────────
  function set(next) {
    Object.assign(prefs, next);
    try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (_) {}
    if (prefs.sound) { build(); wake(); }
  }
  function mount(host) {
    if (!host) return;
    host.innerHTML = '';
    [['sound', 'Sonido'], ['haptic', 'Vibración']].forEach(([key, label]) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'flip-settings-pill';
      pill.dataset.feelPref = key;
      pill.dataset.feel = 'none';
      pill.textContent = label;
      pill.classList.toggle('active', !!prefs[key]);
      pill.setAttribute('aria-pressed', String(!!prefs[key]));
      pill.addEventListener('click', event => {
        set({ [key]: !prefs[key] });
        mount(host);
        // La respuesta es la propia tecla: si se acaba de encender, se oye o se nota.
        if (prefs[key]) { last.at = -1e9; emit('key', 'down', event.clientX); }
      });
      host.appendChild(pill);
    });
  }

  window.flipFeel = {
    tap(name, phase = 'down', x) { return emit(name, phase, x); },
    detent, edge, set, mount,
    prefs: () => ({ ...prefs }),
    // Un módulo que graba por su cuenta avisa para que las teclas callen.
    hush(key, on) { if (on) hushed.add(key); else hushed.delete(key); },
    // Para pruebas y para oír las recetas fuera de la app.
    log: clear => { const copy = log.slice(); if (clear) log.length = 0; return copy; },
    kinds: () => JSON.parse(JSON.stringify(KINDS)),
    kindOf: node => { const hit = find(node); return hit ? hit.name : null; },
    render: (name, variant = 0, bank = skin()) => RECIPES[bank] && RECIPES[bank][name] ? synth(RECIPES[bank][name], seedOf(bank, Object.keys(RECIPES[bank]).indexOf(name), variant)) : null,
    recipes: () => Object.keys(RECIPES.objeto),
    voice: skin,
    state: () => ({ context: ctx ? ctx.state : 'none', built: !!buffers[skin()], voice: skin(), recording: recording(), mic: micLive(), devices: !!devices }),
  };
  // El panel de ajustes se pinta antes de que este archivo cargue: se monta ahora si ya existe.
  mount(document.getElementById('flipFeelPills'));
})();
