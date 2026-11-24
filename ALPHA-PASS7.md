# FLIP · séptima pasada: el vídeo que Instagram rechazaba, el calor y el aparato como objeto

Tres encargos: los vídeos grabados daban error al subirlos a Instagram, la app sigue calentando
el teléfono, y la interfaz todavía «se siente medio falsa»: no como un aparato de otra época
dentro del cristal.

Rama `fable/public-alpha-pass2`, publicada en `main` el 23 de noviembre de 2026 (caché v86).

## 1 · El vídeo que Instagram no aceptaba

**Causa.** El navegador (MediaRecorder, en Chrome y en Safari) escribe el MP4 «fragmentado»: la
cabecera llega sin la tabla de cuadros y cada tramo trae la suya. Es un formato pensado para
emitir en directo. Abierto por dentro, el archivo que guardaba FLIP era así:

| Toma | Cajas del archivo | Cuadros en el índice | Duración declarada |
|---|---|---|---|
| 4 s, sin sonido | `ftyp moov moof mdat mfra` | 0 | 4,1 s |
| 13 s, con sonido | `ftyp moov moof mdat moof mdat moof mdat` | 0 | **0 s** |

En cuanto la toma pasa de unos segundos, la cabecera declara **duración cero** y no hay índice.
Un reproductor lo sortea; quien lo importa para recortarlo y recodificarlo, no. Además el archivo
salía con el tipo `video/mp4;codecs=avc1`, con la coletilla de códecs, que es lo que recibe el
sistema al compartir.

**Arreglo.** `docs/mp4-flat.js` reescribe el índice y deja un MP4 de una pieza (`ftyp moov mdat`,
con todas sus tablas y la duración verdadera). No recodifica nada: los cuadros y el sonido son
los mismos bytes que salieron del codificador, y el archivo nuevo se monta con trozos del
original, así que una toma larga no se duplica en memoria. Ante cualquier cosa que no entienda,
devuelve el archivo tal cual: una toma no se pierde por esto. Se aplica en el único punto por el
que pasa todo lo que se guarda o se comparte (CAM, GLITCH, FLOW, FUSION, ASCII, SONO, WMP, EDIT y
STAGE), y el visor de la última toma enseña y comparte ese mismo archivo.

De paso: el tipo sale limpio (`video/mp4`), con sonido se pide AAC por su nombre (si el navegador
eligiera Opus dentro del MP4, las redes no lo importarían) y las medidas del vídeo son siempre
pares.

**Comprobado.** `tests/video-file.cjs` graba con la tubería real y abre el archivo que llega a
Descargas: una pieza, índice completo, duración en la cabecera igual a lo grabado, y los mismos
paquetes que el original uno a uno (pista, tiempo y contenido). También que un archivo ilegible
o cortado a media escritura no rompe nada (del cortado rescata lo que está entero).

**Sin comprobar.** Que Instagram lo acepte: el error ocurre dentro de Instagram y desde aquí no se
puede subir nada. El archivo es ahora, por dentro, como el de la cámara del teléfono, que es lo
que se puede garantizar. Tampoco he visto en un Android qué códec de sonido elige Chrome cuando
se graba con micrófono (en el ordenador, AAC).

## 2 · Calor

### Lo que dice el teléfono

Medido en un Samsung Galaxy por USB, leyendo el tiempo de procesador del teléfono entero y de
cada proceso (núcleos: 1,00 = un núcleo ocupado todo el rato):

| Situación | Teléfono entero | Servicio de cámara | Chrome (página + gráficos + navegador) |
|---|---|---|---|
| FLIP abierta, cámara apagada | 0,45 | 0 | 0,01 |
| Cámara trasera encendida y nada más (un vídeo de 2 px) | 3,11 | 1,46 | 0,45 |
| Lo mismo pidiendo 640 × 480 | 3,08 | 1,47 | 0,39 |
| Lo mismo pidiendo 15 cuadros por segundo | 2,90 | 1,48 | 0,36 |
| Cámara delantera | 2,26 | 0,94 | 0,47 |

Con la cámara abierta el teléfono ya tiene unos **2,6 núcleos ocupados antes de que FLIP dibuje
nada**: es el servicio de cámara del fabricante trabajando para el navegador (y lo que arrastra
en el sistema), y no baja pidiendo menos resolución ni menos cuadros. Eso no lo puede cambiar una
página web. Lo de FLIP va encima: entre 0,5 y 1,4 núcleos según el módulo.

Probé también bajar la cámara a 15 cuadros por segundo en las cámaras lentas, sin reabrirla: no
ahorra nada (el navegador descarta los cuadros después de haberlos procesado). No se ha incluido.

### Lo que sobraba en FLIP

| Hallazgo | Qué se hizo |
|---|---|
| Todos los bucles de dibujo se llamaban en cada refresco de pantalla. En una pantalla de 120 Hz (un Pixel), GLITCH, FLOW, SONO, WMP y STAGE dibujaban **120 cuadros por segundo**; CAM, a 8 por segundo, despertaba el teléfono 120 veces para pintar 8 | Cada bucle tiene un tope (30 los que viven de la cámara, 60 los demás) y duerme entre cuadro y cuadro (`docs/frame-runtime.js`). El aspecto no cambia: 60 era ya lo que se veía en un teléfono de 60 Hz |
| GLITCH, FUSION, EDIT y ASCII leían la cámara dibujando el elemento de vídeo, que en Android cuesta 20–30 ms por cuadro | Usan la lectura rápida que ya usaba CAM (menos de 2 ms) |
| La hoja de formato y audio y su telón seguían compuestos a pantalla completa aunque estuvieran cerrados, y el telón llevaba un desenfoque de fondo | Cerrados no existen para la gráfica; abierta, el telón oscurece sin desenfocar la cámara |
| El piloto de SONO cambiaba de color en cada cuadro (estilos y repintado 60–120 veces por segundo) | Seis escalones, y solo se toca cuando cambia |
| STAGE repintaba su panel cada dos cuadros y animaba avisos con brillo y sombra (se recalculan en cada refresco) | Panel a 20 por segundo; los avisos parpadean a saltos, como un piloto |
| El lienzo de grabación preguntaba en cada refresco si le tocaba dibujar | Duerme hasta su cuadro |

### Medidas

Pantalla de 120 Hz simulada en el ordenador (`tests/energy.cjs --hz 120`). Página + gráficos en
núcleos, cuadros dibujados por segundo:

| Módulo | Publicada | Ahora |
|---|---|---|
| FLOW | 1,01 + 0,54 · 118 | 0,34 + 0,12 · 30 |
| GLITCH | 0,24 + 0,04 · 120 | 0,13 + 0,02 · 30 |
| SONO | 0,18 + 0,15 · 120 | 0,08 + 0,07 · 60 |
| WMP | 0,07 + 0,10 · 120 | 0,05 + 0,07 · 60 |
| STAGE · DIRECTO | 0,23 + 0,25 · 120 | 0,13 + 0,13 · 60 |
| STAGE · SILUETA | 0,50 + 0,30 · 120 | 0,33 + 0,14 · 60 |
| CAM · DSi (8 por segundo): despertares por segundo | 120 | 40 |

En el Samsung (pantalla de 60 Hz), las dos versiones servidas a la vez y medidas una tras otra,
40 s por módulo. Núcleos del teléfono entero y, entre paréntesis, página + gráficos de Chrome y
cuadros dibujados por segundo:

| Módulo | Publicada | Ahora |
|---|---|---|
| CAM · DSi | 3,13 (0,41 + 0,18 · 12) | 3,19 (0,42 + 0,17 · 12) |
| CAM · VFD CRT | 3,05 (0,49 + 0,21 · 12) | 3,08 (0,51 + 0,20 · 12) |
| GLITCH | 3,86 (0,84 + 0,55 · 50) | 3,27 (0,58 + 0,35 · 30) |
| FLOW | 3,84 (1,14 + 0,51 · 60) | 3,52 (0,94 + 0,35 · 30) |
| ASCII | 3,56 (1,15 + 0,50 · 20) | 3,37 (0,91 + 0,46 · 20) |
| FUSION | 3,23 (0,53 + 0,36 · 21) | 3,16 (0,57 + 0,32 · 20) |
| STAGE | 3,57 (0,57 + 0,48 · 60) | 3,47 (0,49 + 0,42 · 60) |
| PORTAL sin manos | 3,33 (0,70 + 0,36 · 30) | 3,36 (0,72 + 0,34 · 30) |

Lectura honrada: en este teléfono, **CAM y PORTAL quedan igual** (lo que gastan es casi todo
cámara); GLITCH baja un 15 % del trabajo total del teléfono, FLOW un 8 % y ASCII un 5 %. El
estado térmico no pasó de «normal» en ninguna de las dos. En una pantalla de 120 Hz el recorte
debería ser mayor (ahí se dibujaba el doble), pero eso está medido solo con la pantalla
simulada, no en un Pixel.

FUSION y EDIT quedan a 24 cuadros por segundo: con la lectura rápida cada cuadro cuesta menos, y
a 30 el Samsung pasaba de los 21 que conseguía antes a 30 y acababa trabajando más.

### Añadido después: la cámara descansa cuando nadie la mira

Visto que casi todo el calor es la cámara encendida, lo único que de verdad lo baja es no tenerla
encendida de más (`docs/rest.js`). Sin publicar todavía (caché v87).

- **Visor de la última toma**: mientras se mira una foto o un vídeo, la cámara se suelta y los
  bucles de dibujo esperan. Al cerrar, vuelve. Un vistazo de menos de un segundo no la toca.
- **Lanzador de módulos**: igual si se queda abierto más de cinco segundos. Al elegir un módulo,
  la cámara vuelve solo si ese módulo la usa.
- **Reposo**: si el teléfono lleva un minuto quieto (lo dice el sensor de orientación) y sin
  toques, la pantallita avisa diez segundos antes («REPOSO EN 10 S»), la cámara se apaga y el visor
  lo dice. Despierta al tocar la pantalla —ese toque no pulsa lo que tenga debajo— o al levantar el
  teléfono. La cámara tarda en volver lo mismo que al regresar de otra app.

Cuándo **no**: mientras se graba; en STAGE (lo que sale por la otra pantalla no puede pararse); el
reposo, tampoco con PORTAL (se maneja con las manos, sin tocar) ni cuando la imagen la mueve el
sonido; y sin sensor de orientación (un ordenador, un iPhone) no hay reposo automático, porque no
se podría distinguir un teléfono en la mesa de uno en la mano.

Qué ahorra: mientras descansa, el teléfono está como en la primera fila de la tabla de arriba
(0,45 núcleos en vez de unos 3,1). Esa cifra se midió con la cámara y los bucles parados a mano;
el reposo en sí no se ha probado en un teléfono (no estaba conectado): está comprobado con
`tests/rest.cjs`, con el teléfono «quieto» y «en la mano» simulados.

## 3 · El aparato como objeto

Lo que hacía que pareciera una pantalla y no un objeto, y lo que se ha cambiado:

- **La carcasa llegaba hasta el borde, como el fondo de una página.** Ahora es una pieza
  renderizada entera (Blender, la misma luz que el resto) con su canto redondeado, y no llega al
  borde: entre ella y el teléfono queda una rendija negra, que en la pantalla se funde con el
  marco. La barra del navegador también es negra. Va en tres piezas (tapa de arriba, tapa de abajo
  y una tira central que se estira) para valer con cualquier alto de pantalla sin deformarse.
  Lanzador, visor y portada son el mismo aparato.
- **La rejilla del altavoz era unas rayas pintadas.** Ahora está calada: se ve el fondo oscuro y
  el bisel de cada ranura coge luz por un lado y sombra por el otro. Los tornillos van
  avellanados.
- **La luz estaba clavada.** Con el sensor de orientación, al inclinar el teléfono giran los
  brillos y las sombras del disparador, de los botones redondos y de las perillas, como si la
  lámpara se moviera (`docs/light.js`). Son piezas de revolución, así que girar su render equivale
  a mover la luz; lo que llevan encima (iconos, marcas, escalas) no gira. Si se sostiene inclinado,
  la luz vuelve sola a su sitio. No cuesta nada con el teléfono quieto; al moverlo, la gráfica solo
  recoloca unas capas pequeñas, como mucho 20 veces por segundo.
- **El disparador era un círculo blanco plano.** Tiene la tapa cóncava y un blanco algo más
  apagado, que es lo que deja ver su forma.
- **La hoja de formato y audio era una hoja de web**, con fondo desenfocado y botones de
  degradado. Ahora es una tapa del mismo plástico, con las teclas renderizadas; los efectos de
  sonido son placas de aluminio como la de la consola, con perillas torneadas y teclas con piloto.
- **Los botones de portada, lanzador y visor** eran también degradados: son la misma tecla
  renderizada.
- **La serigrafía** tiene cuerpo: la tinta deja un filo claro sobre el plástico.

### Qué haría falta para ir más allá

1. **Tus ojos con el teléfono en la mano.** La luz que responde a la inclinación solo se juzga
   así: cuánto gira, si se nota, si molesta. Los valores de ahora son una primera propuesta.
2. **Un aparato de referencia.** Hasta ahora el objeto está inventado. Con tres o cuatro fotos de
   aparatos reales cuyo acabado te guste (el plástico, las perillas, cómo envejecen), se copian
   materiales de verdad en vez de imaginarlos.
3. **Decidir si el aparato está nuevo o usado.** Ahora está de estreno. El desgaste (cantos
   pulidos, polvo en las juntas, la pintura gastada de la tecla más usada) es lo que más separa un
   render de una foto, pero es una decisión de carácter del producto.
4. **Texturas escaneadas** (arañazos, huellas, polvo). Las hay libres; habría que descargarlas.
5. **Una carcasa oscura como opción.** No es solo estética: en una pantalla OLED, la carcasa crema
   es luz encendida en dos tercios de la pantalla. Una versión grafito gastaría bastante menos
   pantalla. Es una decisión de diseño; no se ha tocado.

## 4 · Pruebas

Cuatro pruebas nuevas, en la batería:

- `video-file.cjs`: el archivo de vídeo que se guarda (apartado 1).
- `pace.cjs`: en una pantalla de 120 Hz simulada ningún módulo dibuja más deprisa que su tope ni
  se queda corto, y CAM a baja cadencia duerme entre cuadros.
- `object.cjs`: la carcasa con su canto y su rendija, la luz viva (sentidos, tope, vuelta al
  reposo, nada se escribe estando quieto, el sensor se suelta con la app oculta, las marcas y los
  iconos no giran) y la hoja de formato y audio sin desenfoque y con piezas renderizadas.
- `rest.cjs`: la cámara descansa con el visor o el lanzador abiertos y vuelve al cerrar; reposo
  con aviso previo, despertar con un toque que no pulsa nada o al levantar el teléfono; y sin
  reposo en la mano, grabando, con PORTAL, en STAGE ni sin sensor.

La batería completa (`tests/run-all.cjs`, 19 pruebas) pasa. Fuera de ella pasan el recorrido de
toques al azar (`explore.cjs`, semilla 7) y la actualización desde la versión publicada
(`update-cache.cjs`, desde `89e9282` y, con el reposo, desde `30f8417`: todos los archivos de la caché nueva, byte a byte). En WebKit con
forma de iPhone la carcasa nueva se dibuja bien y la prueba de humo pasa; con las reglas de CSS que
no entienden los Safari antiguos, la página se comporta igual que la publicada.

Dos fallos que encontraron las pruebas por el camino, ya arreglados:

- El vigía que reanuda el visor tras un cuadro roto usaba una pieza del planificador que esta
  pasada sustituye; sin el arreglo, un cuadro fallido habría dejado el visor parado.
- Con la luz viva, el disparador se dibujaba dos veces (una fija debajo de la que gira).

Y una prueba retocada: la de tempo a golpes de `stage.cjs` medía lo que tarda un clic del arnés,
que depende de lo cargado que esté el ordenador (por eso falló una vez en la pasada anterior).
Ahora los cuatro golpes los da la propia página, cada medio segundo exacto.

Herramientas: `tests/energy.cjs` cuenta ahora los cuadros dibujados de verdad en cada lienzo y
simula una pantalla de 120 Hz (`--hz 120`); `tests/device/pixel-heat.cjs` lee el procesador del
teléfono entero y de cada proceso (incluido el servicio de cámara) y no deja ningún bucle suyo en
la página mientras mide.

## 5 · Sin hacer y sin verificar

- **Instagram.** No he podido comprobar la subida: hay que probarla desde el teléfono.
- **El Pixel.** Las medidas de teléfono son de un Samsung Galaxy, que en Chrome refresca a 60 Hz.
  El recorte grande (de 120 a 30 o 60 cuadros por segundo) es para pantallas de 120 Hz, y ahí está
  medido solo con la pantalla simulada.
- **La luz viva en un teléfono de verdad.** Probada con inclinaciones simuladas. En iPhone no se
  activa: Safari pide un permiso aparte para el sensor y no se ha añadido esa pregunta.
- **Temperatura.** La cámara encendida es, con diferencia, lo que más calienta, y mientras se usa
  eso no se ha podido bajar. Lo que se ha quitado es trabajo de FLIP y el tiempo que la cámara pasa
  encendida sin que nadie la mire.
- **El reposo en un teléfono de verdad.** Si un minuto es mucho o poco, si el sensor da por
  «quieto» un teléfono que alguien sostiene muy firme, y cuánto tarda la cámara en volver.
- **ASCII, UPLOAD y EDIT** siguen con sus paneles de antes; las perillas de STAGE conservan su
  acabado (aunque ya giran con la luz).
