# FLIP · cuarta pasada: el aparato de los 80, PORTAL, STAGE y el tacto

Rama `fable/public-alpha-pass2`, sobre `582592d`. Cuatro encargos: rehacer el diseño (la dirección
anterior, policarbonato ahumado y luces de neón, no era la buena), una sección nueva (PORTAL),
llevar STAGE a central de visuales en vivo, y que las teclas suenen y vibren como un teclado de
época.

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
- Con una sola mano (la otra sujeta el teléfono) la ventana es una **lente** entre el pulgar y el
  índice. Tocar el visor **fija** la ventana para poder soltar las manos.
- La cámara va fluida a 30 fps y cada emulador mantiene su cadencia solo dentro de la ventana.
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

`docs/feel.js`. Todo sintetizado (modos amortiguados más ruido filtrado), sin archivos de audio.

| Pieza | Al bajar | Al subir / actuar | Vibración |
|---|---|---|---|
| Disparador | golpe grave de medio recorrido | la cortinilla, en dos tiempos | 14 ms; luego 9 · pausa · 13, al ritmo del sonido |
| Tecla grande (grabar, SALIDA, entrar) | golpe grave y largo | clac medio | 16 ms |
| Tecla | clic con cuerpo y el muelle resonando | clac agudo y corto | 9 ms |
| Botón redondo | sordo, de goma | más sordo aún | 6 ms |
| Interruptor | el roce y el tope | — | 4 · pausa · 8 |
| Diapositiva / tarjeta | cae en su ranura | — | 3 · pausa · 6 |
| Muesca de perilla o deslizador | tic mínimo | — | 2 ms, la mitad de las veces si se gira deprisa |

Para que no sea ruido: solo suena lo que pulsa un dedo; lo que está en una lista que se desplaza
suena al elegirlo, no al tocarlo; nunca dos sonidos encima (gana la pieza más importante);
tamborilear no suma volumen; **grabando, las teclas callan** y queda la vibración; con el
micrófono abierto bajan a un tercio; cada tecla suena un pelo distinta y desde su lado de la
pantalla. Dos ajustes (Sonido, Vibración) en FORMATO Y AUDIO.

## 5 · Evidencia

- **Batería completa** (`tests/run-all.cjs`): once pruebas, todas pasan. Nuevas en esta pasada:
  `portal.cjs`, `feel.cjs`, `stage.cjs` (qué comprueba cada una, en `tests/README.md`).
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

## 7 · Sin verificar

- **PORTAL con manos delante de un teléfono.** El rastreador carga y corre en el Samsung, y el
  gesto está probado con el vídeo de referencia en el ordenador; falta una persona haciendo el
  marco delante del teléfono.
- **Sonido con micrófono y MIDI en el teléfono.** Sus permisos piden un toque del dueño; no se
  concedieron por depuración. La reacción al sonido y el MIDI están probados con datos inyectados.
- El **sonido de las teclas a oído** y la vibración en la mano: registrados y aceptados por el
  teléfono, no escuchados ni sentidos por una persona.
- **Controlador MIDI real** y **proyector por cable**.
- El Pixel 10 (estaba en uso): esta pasada no se midió en él.
- LED real en FLASH, NIGHT en penumbra real, temperatura y batería en uso largo, giro del
  teléfono en CAM, vuelta del segundo plano (igual que en la pasada anterior).
