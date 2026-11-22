# FLIP · cuarta pasada: el aparato de los 80, PORTAL, STAGE y el tacto

Rama `fable/public-alpha-pass2`, sobre `582592d`. Cuatro encargos: rehacer el diseño (la dirección
anterior, policarbonato ahumado y luces de neón, no era la buena), una sección nueva (PORTAL),
llevar STAGE a central de visuales en vivo, y que las teclas suenen y vibren como un teclado de
época. Después, con la app ya en la mano: un modo nuevo de VFD (CRT, apartado 9), el
sonido de las teclas rehecho como clic de plástico (apartado 4) y la revisión completa antes de
llevar la rama a `main` (apartado 10).

## 1 · Diseño: un producto de los 80 hecho en 2027

**Antes.** Carcasa translúcida oscura con la placa a la vista, teclas de goma con bisel cromado,
tipografías Michroma y Chakra Petch. Se leía como ciberpunk.

**Ahora.** Un aparato de plástico ABS crema, como un periférico de 1984 fabricado hoy:

- **Carcasa** crema con grano de molde, rejilla de altavoz, tornillos y serigrafía.
- **Teclas de teclado mecánico** (crema, coral, pizarra, gris, mostaza), con su recorrido al
  pulsarlas; la elegida es la coral, como el BLOQ NUM de un teclado de época.
- **Botones redondos lustrosos** de colores para lo secundario (ajustes, girar, micrófono).
- **Disparador** de aluminio con aro, **interruptor deslizante** FOTO/VÍDEO, **perillas** de
  aluminio moleteado y, en STAGE, perillas de sintetizador con tapa de aluminio y **tomas de
  parcheo** con tuerca hexagonal.
- **Pantallitas de cristal líquido** reflectivo (fondo verdoso, tinta oscura, tipografía de
  puntos) para el estado; el visor, con marco hundido y cristal curvo.
- **Bandeja de diapositivas** con las cámaras, hojas de ajustes en crema, lanzador de módulos con
  cartuchos, portada que saluda en su pantalla.
- Tipografías Archivo (rótulos, con su ancho variable para las teclas), Doto (cristal líquido) y
  Pixelify Sans (datos sobre la imagen).

Todas las piezas están modeladas y renderizadas en Blender (`design/camera-body/build.py`, cámara
cenital, luz de estudio, material con grano) y pesan 430 KB en total. `design/camera-body/finish.cjs`
limpia la sombra residual y las pasa a WebP. La interfaz vive en `docs/shell.css` y `docs/shell.js`,
rehechos enteros.

## 2 · PORTAL: una ventana que se abre con las manos

Sección nueva en el lanzador. La cámara (frontal o trasera) se ve tal cual; al hacer el marco con
las dos manos —pulgar e índice en «L»— y separarlas, entre las cuatro yemas se abre una ventana y
dentro la imagen sale con la cámara elegida.

- Se elige en la misma bandeja de CAM: DSi, STAMP, AUTO 03, DLPHN, CASKIA, VFD, OSCAM, más ASCII y
  las dos que siguen al sonido (SONO, WMP). **SLHT no se ofrece.** De **STAMP entra la trama, no el
  marco** del sello, y el ajuste de marco del usuario no se toca.
- Con una sola mano (la otra sujeta el teléfono) la ventana es la **esquina** que dibujan su
  pulgar y su índice. Las ventanas se **fijan** para componer un vitral (apartado 7).
- La cámara va a la cadencia de la pantalla y cada emulador mantiene la suya solo dentro de la ventana.
- Foto y vídeo salen por el disparador de siempre y son lo que se ve.
- El seguimiento de manos (MediaPipe, 21 puntos por mano) corre en un worker con el delegado de
  CPU, igual que el detector de siluetas, y el service worker guarda el modelo tras la primera
  carga.

## 3 · STAGE: sintetizador de vídeo modular de bolsillo (VS-27)

El STAGE anterior (una lista de capas y una ventana que abría su propia cámara) se retiró entero.
El nuevo es un rack por el que pasa la señal, dibujado en WebGL 2:

```
A · cámara (directa o por un emulador de FLIP) ─┐
B · generador (barras, plasma, anillos, rejilla, │→ MEZCLA / CLAVE → BUCLE → GEOMETRÍA → COLOR → SEÑAL → SALIDA
    nieve, osciloscopio, espectro, carta) ───────┘
```

- **MEZCLA**: fundido, suma, multiplicación, diferencia, clave de luz y **SILUETA** (la persona
  recortada sobre el generador, con el mismo detector de FLOW).
- **BUCLE**: la realimentación de vídeo, el circuito cerrado: el cuadro anterior vuelve con zoom,
  giro, deriva, tinte y persistencia (eco, estela o clave).
- **GEOMETRÍA**: zoom, ángulo, giro continuo, caleidoscopio de 2 a 12 lados, espejos, mosaico, onda.
- **COLOR**: matiz, saturación, contraste, ciclo, tinta en siete paletas, póster, solarizado, negativo.
- **SEÑAL**: separación RGB, rasgado, V-HOLD, croma corrida, píxel, líneas, nieve, estrobo.
- **Modulación**: doce fuentes —dos LFO (libres o a tempo), graves, medios, agudos, golpe, el pad
  XY del monitor, nota MIDI y la mano delante de la cámara (posición y pinza)— y cualquier perilla
  como destino. Se parchea como en un modular: se toca la toma y luego la perilla, y **aparece el
  cable**; arrastrar la perilla con el cable en la mano cambia cuánto modula.
- **Sonido**: tres bandas con ganancia automática (se adaptan al volumen de la sala), detección de
  golpes y tempo estimado.
- **MIDI**: aprendizaje (CC a cualquier perilla; notas a escenas, tempo o corte a negro), notas
  36–43 a las escenas si no hay nada asignado, y **reloj MIDI** para llevar los LFO a tempo.
- **Ocho escenas** con transición ajustable; mantener una tecla la guarda.
- **Cámara**: en Android entra por sus planos nativos (Y, U, V) y el sombreador la convierte a
  color a resolución completa; en ordenador, subida directa del vídeo.
- **Salida**: en el teléfono, la tecla SALIDA pone la señal a pantalla completa, limpia y en
  horizontal (el cable USB-C a HDMI la duplica en el proyector); el dedo sigue siendo el pad XY y un
  doble toque pasa de escena. En ordenador, VENTANA EXTERNA abre una ventana que la consola pinta
  directamente (con permiso de gestión de ventanas se coloca sola en la otra pantalla). Foto y
  grabación de lo que sale; corte a negro; volteo para retroproyección; calidad AUTO que baja o
  sube un escalón según el ritmo real.
- Lleva el rótulo PRO en el lanzador y en la consola. **No hay cobro ni bloqueo**: es una decisión
  de negocio que no me corresponde tomar; el punto único donde iría es la entrada al módulo.

## 4 · Tacto: el sonido y la vibración de las teclas

`docs/feel.js`. Todo sintetizado, sin archivos de audio.

**Rehecho después de oírlo.** La primera versión sumaba resonancias de decenas de
milisegundos en frecuencias casi a octavas (215, 468, 935, 1760 Hz) más un «muelle» a 4–5 kHz:
eso es una nota, y sonaba a xilófono de sintetizador. Ahora cada golpe es un impulso seco (lo
que dura el contacto del plástico) más un soplo de ruido que se apaga, pasados por bandas de más
de una octava de ancho. Nada resuena lo bastante para dejar una altura: lo agudo dura un
milisegundo y lo grave, cinco o seis. Una tecla son tres golpes en 11 ms (el contacto, el tope
con cuerpo y un rebote mínimo); al subir, un tic más fino.

Medido con la misma vara sobre el sonido anterior, el nuevo y dos grabaciones reales (una tecla
y un obturador mecánico):

| | Antes | Ahora | Grabaciones reales |
|---|---|---|---|
| Afinado (autocorrelación máxima entre 0,15 y 5 ms; una nota da 0,5 o más) | 0,49 – 0,73 | 0,12 – 0,23 (la muesca, 0,38 en 6 ms) | 0,12 – 0,26 |
| Lo que tarda el golpe en caer 30 dB | 11 – 90 ms | 6 – 27 ms | 50 – 100 ms (con su sala) |
| Energía de la tecla entre 1 y 4 kHz / por encima de 4 kHz | 22 % / 5 % | 57 % / 19 % | 70 % / 12 % |

En el espectrograma, antes cada toque tenía nudos en sus parciales y rayas horizontales (el
muelle); ahora son líneas verticales lisas. `tests/feel.cjs` lo vigila: suspende si cualquier
receta vuelve a «sonar a nota», y de hecho suspende con el sonido anterior.

| Pieza | Al bajar | Al subir / actuar | Vibración |
|---|---|---|---|
| Disparador | golpe sordo y pesado de medio recorrido | la cortinilla: dos chasquidos a 46 ms con el mecanismo entre medias | 14 ms; luego 9 · pausa · 13, al ritmo del sonido |
| Tecla grande (grabar, SALIDA, entrar) | clac grave, con más caja | tic medio | 16 ms |
| Tecla | clac de plástico: contacto, tope y rebote | tic fino y corto | 9 ms |
| Botón redondo | sordo, de plástico blando | más sordo aún | 6 ms |
| Interruptor | el roce y el encaje | — | 4 · pausa · 8 |
| Diapositiva / tarjeta | cae en su ranura | — | 3 · pausa · 6 |
| Muesca de perilla o deslizador | tic mínimo | — | 2 ms, la mitad de las veces si se gira deprisa |

Para que no sea ruido: solo suena lo que pulsa un dedo; lo que está en una lista que se desplaza
suena al elegirlo, no al tocarlo; nunca dos sonidos encima (gana la pieza más importante);
tamborilear no suma volumen; **grabando, las teclas callan** y queda la vibración; con el
micrófono abierto bajan a un tercio; cada tecla suena un pelo distinta y desde su lado de la
pantalla. Dos ajustes (Sonido, Vibración) en FORMATO Y AUDIO.

## 5 · Evidencia

- **Batería completa** (`tests/run-all.cjs`): doce pruebas, todas pasan. Nuevas en esta pasada:
  `portal.cjs`, `feel.cjs`, `stage.cjs` y `vfd-crt.cjs`; fuera de la batería, `explore.cjs` y
  `update-published.cjs` (qué comprueba cada una, en `tests/README.md`).
- **PORTAL con manos de verdad.** El vídeo de referencia, recortado a la persona, hace de cámara
  (Chrome lo reproduce como dispositivo) y se usa el rastreador real: manos en 73 de 79 muestras,
  ventana abierta en 56, marco y lente, hasta un 16 % del cuadro, 28 ms por inferencia en el Mac.
  Con ese mismo vídeo, la mano mueve los mandos de STAGE (posición y pinza recorren su rango).
- **STAGE.** El sombreador convierte bien I420 y NV12 (rojo y azul puros de entrada dan rojo y
  azul puros de salida); la vía de planos y la subida directa dan la misma imagen; carta de
  ajuste con sus barras en su sitio; la ventana de salida en escritorio recibe la imagen y sus
  teclas llegan a la consola. Un fallo que solo se veía en movimiento (tras una escena que gira,
  la siguiente quedaba torcida) salió al revisar el clip de demostración y tiene su prueba.
- **Tacto.** 45 pulsaciones revisadas en la prueba: ninguna pisa a otra, lo automático no suena,
  grabando no suena nada.
- **Paneles de los demás módulos** (SONO, WMP, GLITCH, FUSION, EDIT, ASCII): pasaron de consola
  negra a placa crema con teclas; capturas antes y después.

## 6 · En un teléfono de verdad

Un **Samsung Galaxy SM-S741B** (Android 17, Exynos, Chrome 158, ventana de 384 × 741 px CSS) por
depuración USB, con su cámara real (720 × 1280, I420). Herramientas en `tests/device/`.

| Qué | Resultado |
|---|---|
| **STAGE**, las ocho escenas | 60 fps en todas, lienzo de 960 × 540, cámara por planos nativos I420; el peor cuadro, 17 ms (un pico de 29 ms en MANDALA) |
| STAGE con un emulador (DLPHN) como fuente | 60 fps |
| SILUETA en STAGE | el recorte carga y sigue a la persona |
| Salida limpia | pantalla completa, gira a horizontal (832 × 384), 60 fps; al salir vuelve la consola en vertical |
| Grabación de la salida | MP4 (avc1), 2,2 MB en 2 s |
| Seguimiento de manos (PORTAL y STAGE) | listo; 42–46 ms por inferencia en su worker, la pantalla sigue a 60 fps |
| **Toques reales**: AJUSTES, bandeja, lanzador, escenas, perillas, cables | 17 de 17 comprobaciones; el teléfono acepta la vibración y cada pieza registra su sonido |
| **CAM**, las 20 variantes | todas a su cadencia, ningún tirón, pantalla a 60 Hz |
| SLHT y FLOW | detector listo en worker (31–39 ms), máscara válida, 60 fps |
| Errores en la consola | ninguno |

Los colores de la cámara por planos (BT.601 de rango completo en este teléfono) se ven naturales.

## 7 · Lo que cambió después de usarlo con el teléfono en la mano

**Fallos encontrados en el Samsung y su causa.**

| Lo que pasaba | Causa | Ahora |
|---|---|---|
| GIRAR no cambiaba a la cámara frontal («Could not start video source») | La app abría la cámara nueva sin soltar la actual; ese teléfono no deja tener dos abiertas (el Pixel sí). Pasaba también en CAM | Se intenta sin corte y, si falla, se suelta la actual y se reintenta; el teléfono queda anotado. Medido: el giro tarda alrededor de un segundo |
| PORTAL no detectaba las manos | Al salir de PORTAL con un cuadro en vuelo, el rastreador quedaba «ocupado» para siempre y al volver no recibía ninguno | El estado se limpia al parar; hay prueba que sale y entra tres veces con un cuadro en vuelo |
| Al abrir mucho el marco, saltaba a un círculo | Una mano se salía del cuadro y la ventana pasaba a ser la de una sola mano | El marco recuerda a sus dos manos; si una sale por un lado, su borde llega hasta ese lado |
| PORTAL se sentía lento | Dibujaba a 30 por segundo y cada cuadro costaba 14 ms; el seguimiento daba 10 lecturas por segundo, con un filtro que arrastraba | Ver abajo |
| STAGE no reaccionaba a la música | El sonido estaba apagado y nada lo decía; en un ordenador, además, el micrófono no oye lo que suena por los auriculares | Ver abajo |

**PORTAL, núcleo nuevo.** Dibujo en WebGL a la cadencia de la pantalla (61 dibujos por segundo en
la prueba), con la cámara por sus planos nativos en Android. Cada mano tiene un estimador (filtro
1€ más velocidad) que adelanta su posición lo que tardó la inferencia, y el cuadro siguiente sale
hacia el rastreador en cuanto vuelve el anterior. El delegado de GPU del rastreador se prueba en
paralelo con el de CPU y solo se adopta si da las mismas manos y es más rápido (en el Mac pasó de
27 a 18 ms por lectura). La ventana sigue la «L» de cada mano, como en el vídeo de referencia:
va de la yema que apunta hacia dentro a ese punto desplazado lo que el otro dedo se separa en
perpendicular; cerrar la L la cierra.

**Portales fijados (vitral).** Una ventana se fija con el clic de anular y pulgar (medido en 3D con
el modelo de la mano, porque en 2D dos yemas coinciden por perspectiva sin tocarse; tiene que
venir de abierto y durar dos lecturas), con la tecla FIJAR o tocando el visor. Cada portal guarda
figura, sitio y estilo: se elige otra cámara y se fija el siguiente. Se mueven arrastrando (dos
dedos: escala y giro), cambian de estilo al tocar otra cámara y se borran con su aspa o con
BORRAR (mantenerla los borra todos). Hasta ocho.

**STAGE, sonido.** Entrada propia y elegible: micrófono, otra entrada de audio o «este ordenador»
(el navegador pregunta qué pestaña o pantalla compartir, con su audio). Arriba a la derecha del
monitor se ve de dónde entra el sonido y cuánto llega; si la escena pide sonido y está apagado,
la tecla MIC late; si está encendido y no llega nada, lo dice. Cada banda se mide en decibelios
y se normaliza entre su suelo y su techo recientes, así reacciona igual con la música baja que
alta. Los golpes salen del flujo espectral de los graves y el tempo de su autocorrelación; un
reloj de compases se engancha a los golpes para que los LFO «a tempo» caigan en el pulso. Las
escenas de fábrica llevan ahora reacciones más marcadas.

**STAGE, MIDI sin configurar.** Las notas 36–43 y 60–67 llaman a las escenas y cualquier otra da
un golpe; los ocho mandos de los controladores habituales (CC desde 70, 21, 16, 102 o 41)
gobiernan las perillas de la página visible; la rueda de tono y la de modulación son el pad; el
volumen es el nivel de salida; un cambio de programa, la escena; el reloj MIDI, el tempo.
APRENDER sigue fijando un mando concreto a un control.

**Evidencia de esta parte.** `portal.cjs` (61 dibujos por segundo, marco, bordes, clic, vitral,
mover, estilos, borrar, rastreador real), `stage.cjs` con música sintetizada entrando de verdad
por el analizador (bombo a 128: cuenta ~15 golpes en 7 s y da 128 ±4 de tempo; 24 dB más baja
sigue reaccionando igual; en silencio no inventa nada y avisa) y MIDI inyectado; `alpha-flows.cjs`
con un teléfono simulado que no abre dos cámaras. Con el vídeo de referencia como cámara: manos
en 97 de 101 muestras, ninguna rotura del marco y ningún portal fijado sin querer.

## 8 · Sin verificar

- **Nada de lo último en un teléfono.** VFD · CRT, el clic nuevo de las teclas, el PORTAL nuevo y
  el sonido de STAGE no se han visto en un teléfono: al ir a medirlos, el Samsung estaba enchufado
  pero con la depuración por USB apagada (el Mac lo veía, la interfaz de depuración no). La prueba
  queda escrita (`tests/device/pixel-crt.cjs`): elige CRT con el dedo, mide ritmo y coste por
  cuadro con la cámara real, foto, vídeo, giro de cámara, PORTAL y las teclas. Lo medido allí
  sigue siendo lo del apartado 6. En el Mac, con la CPU frenada ×4, CRT mantiene su cadencia.
- **El clic de las teclas a oído** y la vibración en la mano. Las medidas dicen que ya no hay
  nota y que el reparto es el de una tecla real; si es «hermoso» lo decide un oído.
- **«Este ordenador» como entrada de sonido**: depende del diálogo de compartir del navegador;
  no se puede automatizar y no se probó a mano.
- **Controlador MIDI real** y **proyector por cable**: MIDI está probado con mensajes inyectados.
- El clic de anular y pulgar de PORTAL con una mano real delante de un teléfono.
- El Pixel 10 (estaba en uso): esta pasada no se midió en él.
- LED real en FLASH, NIGHT en penumbra real, temperatura y batería en uso largo, giro del
  teléfono en CAM, vuelta del segundo plano (igual que en la pasada anterior).

## 9 · VFD · CRT: un televisor de tubo con colorizador

Variante nueva de VFD (teclas STD · THRML · CRT), hecha a partir de un vídeo de referencia: una
cámara metida en un televisor de tubo a través de un colorizador analógico. Está en
`_renderVfdCrt` (`docs/index.html`): lienzo 2D, 256 × 192 puntos de señal, sin nada que cargar.

| En el vídeo | Aquí |
|---|---|
| Casi todo negro: solo se enciende lo que tiene borde o mucha luz | El colorizador solo mira la luminancia. Por debajo del percentil 70 del cuadro queda negro de tubo, con su nieve y un velo rojizo y verdoso muy tenue. |
| Contornos punteados que cambian de color a lo largo de la línea | El tono sale de la orientación del borde, así gira a lo largo de una curva. Los bordes flojos prenden en una línea de cada dos y con huecos. |
| Manchas azules, violetas y rosas con vetas de otro color | Relleno por luz: del negro al rosa pasando por verde azulado, azul, violeta y magenta, con cuatro franjas finas de otro color que dibujan curvas de nivel y reptan despacio. |
| Lo más claro, quemado en rosa, con rayas verticales y halo | Por encima del percentil 92: rosa con las rayas de la subportadora (columna sí, columna no) y un resplandor en dos tamaños. |
| Color corrido y fallos de croma | La croma llega tarde y se corre a la derecha; tramos sueltos saltan de color; cada varios segundos una banda de líneas pierde el sincronismo un instante. |
| El tubo | Rejilla de fósforo rojo, verde y azul, una línea de barrido por fila de señal, barra de zumbido que baja despacio y esquinas apagadas. |

Decisiones que no se ven:

- **Los niveles se adaptan al cuadro** (percentiles, con un cuarto de segundo de inercia): con
  cualquier exposición hay algo en negro, algo en color y algo quemado. Probado de la penumbra
  al foco.
- **Todo es continuo** en la luz y en esos niveles: una pared lisa que cae justo en un umbral
  no parpadea.
- **El azar va atado al reloj del cuadro**: el mismo instante da el mismo cuadro, así que la foto
  y el vídeo salen como el visor (correlación 0,99 en alta, punto a punto).
- **Nada parpadea a pantalla completa.** Lo que se mueve es fino: el punteado (cada 100 ms), la
  nieve y las franjas reptando. Con la escena quieta, el nivel medio no se mueve más de 0,4 de 255.
- **Coste:** 1,9 ms por cuadro en el Mac; con la CPU frenada ×4 mantiene sus 30 por segundo.
- Sirve también como estilo de una ventana de PORTAL y como fuente de STAGE.

`tests/vfd-crt.cjs` lo recorre con los mandos reales (nueve pasos) y la auditoría de materiales lo
incluye (16 variantes). Un fallo propio salió al repasar el código línea a línea: con el
«desgarro» apagado, las primeras filas quedaban siempre corridas. Corregido, y la prueba suspende
si vuelve (comprobado reintroduciéndolo).

## 10 · Antes de llevarlo a main

Lo que se corrió sobre el código final:

- **Batería completa:** doce pruebas, todas pasan.
- **Recorrido exploratorio** (`tests/explore.cjs`, nuevo): entra en los diez módulos y toca al azar
  todo lo que se puede tocar, además de Escape y toques fuera de los botones. Semillas 7, 11, 23
  y 31 en el teléfono emulado y 5 en escritorio: unas 2.400 interacciones sin un error de página,
  de consola ni promesa sin atender. Guarda la traza y sabe repetirla toque a toque (`--replay`).
- **Actualización desde la app publicada** (`tests/update-published.cjs`, nuevo): instala la
  versión de `main` anterior (0b13252, caché v73), la usa y guarda ajustes en su formato; publica
  esta en el mismo origen. La nueva se instala sola, recuerda la cámara elegida, el formato, los
  efectos de audio y las paletas guardadas, deja una sola caché, funciona (cámara, VFD · CRT,
  foto, teclas, PORTAL, STAGE a 60) y arranca sin red.

Lo que el recorrido encontró, y qué se hizo:

| Hallazgo | Qué era | Estado |
|---|---|---|
| WMP a pantalla completa: sin botones a la vista, la imagen no llenaba la pantalla y asomaba el marco | Fallo real (la única salida era el gesto del sistema) | Arreglado: llena la pantalla y un toque devuelve los mandos. Con prueba. |
| Las hojas FORMATO Y AUDIO y AJUSTES no se cerraban con Escape | Fallo menor, de teclado de escritorio | Arreglado. Con prueba. |
| Chrome escribe un error al grabar MP4 con el audio encendido («codec description…») | Aviso del navegador: el archivo sale con una sola cabecera de secuencia y se decodifica entero, con y sin cambios a media toma | Sin cambio; anotado como inofensivo en la prueba. |
| El audio de los MP4 sale en Opus, no en AAC | Así lo elige Chrome si no se le pide otra cosa (visto en Chrome de escritorio; en Android no se ha mirado). Opus dentro de MP4 es menos compatible que AAC fuera de Chrome y Android: conviene comprobar un vídeo con sonido en un iPhone y en las redes donde se comparta | **Sin tocar.** Pedir AAC es una línea, pero cambia el códec de todas las grabaciones con sonido y hoy no hubo teléfono donde probarlo. |
| STAGE en salida limpia no tiene botones | Es así a propósito (los toques son gestos de directo; se sale con «atrás», y lo dice al entrar) | Sin cambio. |
