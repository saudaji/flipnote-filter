# FLIP · novena pasada: la marca «Rollo en añil»

FLIP ya tiene marca: símbolo (una cámara ladeada que guiña), logotipo, paleta, tipografías,
pictogramas y secuencia de arranque. La dirección y los archivos vienen del paquete
`FLIP-Rollo-en-anil-integracion.zip` (hecho fuera, sobre la versión `e0d03a9`); esta pasada lo
integra en la versión actual, renderiza de verdad los materiales con la paleta nueva y termina la
carcasa oscura.

Rama `fable/rollo-anil`, sobre `main` (`4a4ead0`). Sin publicar.

## Qué cambia a la vista

- **Portada**: el ident de FLIP en el cristal, como señal de tubo; la marca en una tecla añil.
- **Arranque**: al encender la cámara (o STAGE) la pantallita corre 2,4 s de matriz de puntos:
  la cámara abre los ojos, guiña, FLIP, el modelo (FL-27 o VS-27) y LISTO. Con «reducir
  movimiento», un solo cuadro. Suena un guiño corto si los sonidos de la interfaz están activos.
- **Color**: el «elegido» y la acción principal pasan de coral a **añil** (`#273FA8`); mandarina
  para AJUSTES, lima para GIRAR, rojo solo para grabar. La carcasa es ABS perla (`#EDE5D8`), las
  teclas PBT vainilla, las perillas aluminio anodizado humo violeta con la marca clara.
- **Carcasa oscura**: en el lanzador de módulos hay una tecla CARCASA OSCURA / CARCASA CLARA. Se
  recuerda entre sesiones. En un teléfono OLED la oscura enciende muchos menos píxeles.
- **Pictogramas** nuevos para los diez módulos y los mandos; **tipografías** Chivo (serigrafía),
  Doto (pantallita) e IBM Plex Sans (textos), servidas desde la propia app (licencia OFL).
- **Firma** FLIP FL-27 tampografiada al pie de la cámara; placa STAGE VS-27 PRO en STAGE.
- **Instalación**: iconos nuevos (normal, adaptable y monocromo) e imagen de enlace 1200 × 630.

## Qué se hizo además del parche

El paquete traía como «materiales» los renders anteriores recoloreados (lo dice su manual, y deja
en `materiales-render.json` los valores para renderizarlos). Aquí se han renderizado en Blender
con la misma cadena de siempre (`design/camera-body/rollo.sh`):

- teclas en vainilla, añil y miel; botones redondos en añil, mandarina, lima y rojo;
- el disparador con su aro de **aluminio anodizado añil** (el torneado se ve bajo el tinte) y el
  disco rojo de vídeo;
- las perillas de la consola y de STAGE en aluminio anodizado humo, con marca clara;
- la carcasa perla y la **carcasa oscura** como plástico oscuro de verdad (con su brillo en el
  canto), no como la clara teñida. Ya no lleva la línea serigrafiada antigua: la marca va en su
  firma.

Y se ha terminado lo que el parche dejaba a medias:

- **Carcasa oscura**: los marcos del visor, de la bandeja de cámaras, de la última toma y de la
  pantallita seguían en crema, igual que el aro de los visores de los demás módulos. Ahora son
  del plástico de la carcasa (`design/camera-body/oscuro.py` los saca de los de crema). La hoja de
  ajustes, el panel de EDIT, la placa de STAGE y las teclas claras conservan la tinta oscura (con
  el parche, sus textos quedaban crema sobre crema).
- **Coral residual**: los «elegido» pintados a mano (teclas de la hoja de ajustes, de EDIT, de
  FLOW, la tarjeta en uso del lanzador) pasan a añil; lo que avisa (piloto de reposo, toma armada
  en STAGE) va en mandarina.
- La tecla de carcasa dice a cuál se cambia; la firma del pie no pisa el canto.
- La lista de precarga del service worker se rehízo a partir de lo que la app usa: entran 59
  archivos de la marca y salen 30 piezas antiguas que ya no se pintan (siguen en `docs/body/`).
  Caché `v90`.
- La prueba de la luz viva (`tests/object.cjs`) reconoce el render nuevo del disparador.

## Comprobado

- Batería completa en verde con la marca aplicada: las 20 pruebas de siempre (la de la luz viva,
  repetida aparte tras ponerle los nombres nuevos de las piezas) más una nueva, `tests/brand.cjs`.
- Recorrido de los diez módulos, la hoja de ajustes y la última toma en carcasa clara y oscura,
  sin errores de página (Chrome, 395 × 844).
- Portada y cámara en WebKit (el motor de Safari), las dos carcasas.

## Sin comprobar

- En un teléfono real: el arranque de la pantallita, el sonido, la carcasa oscura en OLED y la
  luz viva sobre las piezas nuevas.
- El ahorro de energía de la carcasa oscura (no se ha medido).
- La imagen de enlace en redes (hace falta que esté publicada).
- Contraste real con reflejos; los valores del manual son de color plano.

## Pendiente de la marca (no entra en esta pasada)

- **Marca de agua** opcional en fotos y vídeos (los SVG están en `docs/brand/…/comunicacion/`).
- **Textos de voz** del manual (permiso de cámara, reposo, errores): hoy se conservan los de la app.
- **Bloqueo PRO** de STAGE: hay pictograma y aviso, falta una fuente de licencia.
- La placa de la consola sigue en grafito y los paneles de ASCII, UPLOAD y EDIT conservan su
  dibujo anterior con los colores nuevos.
- En la carcasa oscura, el monitor y la placa de STAGE siguen en perla (leen como placa clara).

## Para deshacerlo

Todo está en una rama aparte; `main` no se ha tocado. La carpeta `docs/brand/` es nueva y los
renders antiguos siguen en `docs/body/`.
