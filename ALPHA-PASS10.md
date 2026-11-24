# FLIP · décima pasada: PRENSA, la cámara de semitono

Segunda de las ideas tomadas del estudio de Dither Boy: el semitono de imprenta, con sus planchas
de color. Entra como una cámara nueva de CAM, la novena.

Rama `fable/prensa`, encima de la marca (`fable/rollo-anil`). Publicada en `main` el 24 de noviembre de 2026
(caché v91), tras probarla en el Pixel.

## Qué hay

**PRENSA** imprime lo que ve la cámara: separa la imagen en planchas de tinta y tira cada una con
su trama de puntos girada. Tres tiradas:

- **CMYK**: cuatricromía. Cian a 15°, magenta a 75°, amarillo a 0° y negro a 45°; juntas hacen
  la roseta de una revista vista de cerca.
- **DIARIO**: una sola tinta negra, trama más gruesa, papel de periódico.
- **RISO**: dos tintas planas que se pisan, como en una duplicadora de fanzine. La oscura dibuja
  y la viva se va a lo cálido (la piel, la madera).

En la consola:

- **PUNTO** (1–10): el tamaño del punto.
- **TINTA**: cuánta tinta carga la máquina; poca lava la imagen, mucha la empasta.
- **PAPEL**: de blanco limpio a papel de periódico amarillento, con su fibra.
- **REGISTRO** (CMYK y RISO): descuadra las planchas, como una tirada barata; en los bordes
  asoman las tintas.
- **TINTAS** (solo RISO): el par de tintas. Azul y rosa, negro y rojo, verde y naranja, lila y
  amarillo.

## Cómo está hecho

- Todo se hace en la gráfica (`docs/press.js`, WebGL), en dos pasadas: la cámara se reduce a unas
  dos muestras y media por punto, y un sombreador pinta el papel y las planchas. Reducir primero
  hace que el punto lo dibuje el tono de la imagen y no el ruido del sensor.
- El punto es el «euclídeo» de la imprenta: redondo en las luces, damero a medio tono y agujero
  redondo en las sombras. Una tabla corrige el umbral para que la tinta que se ve sea la que se
  pide (la escala de grises sale sin saltos).
- El negro se lleva buena parte de los grises, así los neutros no salen teñidos.
- El tamaño del punto es proporcional al ancho de la imagen: la foto grande es el visor ampliado,
  no otra trama.
- La gráfica se suelta cuando PRENSA deja de usarse y se rehace sola si el sistema la retira.
- Sin WebGL no hay planchas: la cámara cae al punto de imprenta a una tinta del motor de DSi.

## Medido

En el ordenador de trabajo, con la cámara simulada a 30 cuadros (`tests/energy.cjs --only cam`):
PRENSA · CMYK ocupa 0,27 núcleos de página y 0,11 de hilo principal, en la parte baja de las
cámaras (STAMP 0,29 y 0,22; OSCAM 0,32 y 0,22; DLPHN 0,29 y 0,14). El trabajo se va a la gráfica.

## Comprobado

`tests/press.cjs`, con campos de color pintados en la propia prueba:

- los seis grises de la escala salen cada uno más oscuro que el anterior en las tres tiradas, del
  papel limpio a la tinta llena;
- un rojo sale rojo, un verde verde, un azul azul, un amarillo amarillo y un gris, gris; DIARIO no
  tiene píxeles de color;
- PUNTO cambia el tamaño; la foto al doble de tamaño coincide con el visor (0,9995) y sus puntos
  miden el doble de píxeles; con la imagen quieta dos cuadros son idénticos;
- REGISTRO triplica los flecos de color en un borde negro; el espejo es espejo;
- en la app: la diapositiva de la bandeja, los mandos de cada tirada (4, 3 y 5 perillas), la
  pantallita, la foto igual al visor, los ajustes que se conservan al recargar, la gráfica que se
  suelta y vuelve, y la caída a una tinta sin WebGL.

Batería completa (22 pruebas): 20 en verde en la pasada; a `alpha-performance` y `portal` se les
cerró el navegador a mitad (sin informe de fallo de Chrome) y, repetidas a solas, pasan las dos.
Con el procesador frenado a la cuarta parte, PRENSA tarda 0,9 ms de mediana por cuadro.

## En el teléfono (Pixel 10 Pro XL, Chrome 157, por USB)

`tests/device/pixel-brand.cjs`, con toques reales y la cámara de verdad:

- **Marca**: la portada carga el ident, la marca y las tres tipografías; la pantallita corre la
  secuencia de arranque y vuelve a su estado; las piezas son las renderizadas; la luz viva recibe
  el sensor de inclinación; la carcasa oscura lleva sus marcos oscuros en la cámara, el lanzador y
  la hoja de ajustes.
- **PRENSA**: pinta en la gráfica del teléfono (PowerVR, con precisión alta) a 24 cuadros por
  segundo en las tres tiradas; DIARIO sale a una tinta; la foto al doble de tamaño coincide con
  el visor (0,9996); un vídeo de 3,5 s se graba, se aplana a una pieza y se abre. Nada se guarda
  en el teléfono durante la prueba.
- Sin errores en la consola ni archivos que fallen.

Trabajo del teléfono entero (`tests/device/pixel-heat.cjs`, 45 s por tramo, núcleos ocupados; con
la cámara abierta, lo más es la propia cámara del sistema):

| | teléfono | página | gráficos | ms por cuadro |
|---|---:|---:|---:|---:|
| CAM · DSi | 2,67 | 0,21 | 0,15 | 3,8 |
| CAM · PRENSA CMYK | 2,79 | 0,34 | 0,35 | 1,5 |
| CAM · STAMP | 2,97 | 0,79 | 0,33 | 23,7 |
| GLITCH | 3,51 | 0,44 | 0,69 | — |
| STAGE | 3,77 | 0,52 | 0,61 | — |
| cámara en reposo | ≈ 1,0 | 0,06 | 0,06 | — |

PRENSA queda entre DSi y STAMP. Estado térmico 0 (normal) en toda la medida; la piel del teléfono
entre 34 y 36 °C. El reposo automático saltó solo durante la primera pasada (teléfono quieto un
minuto) y dejó el teléfono en un núcleo: la herramienta ahora lo aplaza mientras mide.

## Sin comprobar

- PRENSA con poca luz, a ojo, durante un rato largo (si el ruido del sensor hace hervir el punto).
- iPhone: la prueba de WebKit abre las tres tiradas sin error, sin mirar la imagen.
- Los verdes y azules salen apagados (es lo que da la cuatricromía con estas tintas); no se ha
  comparado con una impresión real.
- El ahorro de la carcasa oscura en la pantalla OLED y el sonido del arranque.

## Lo siguiente de la lista

Paletas de varios colores sacadas de la cámara, y enlaces que abran FLIP con un estilo cargado.
