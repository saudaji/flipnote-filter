# FLIP · quinta pasada: el calor, los dedos de PORTAL y el iPhone en blanco

Rama `fable/public-alpha-pass2`, sobre `1ebfa47` (lo publicado en `main`). Tres avisos después de
usar la versión publicada en un teléfono: se calienta muy rápido; PORTAL reconoce mal los dedos
(«muy torpe, no hace bien las figuras»); y en un iPhone la app se queda en blanco.

Todo lo de abajo está medido en el Mac (Chrome y WebKit de Playwright). **Nada de esta pasada se
ha medido en un teléfono**: el de pruebas estaba enchufado con la depuración por USB apagada, y
del iPhone no hay modelo ni versión. Qué falta, en el apartado 5.

## 1 · PORTAL: la figura, cosida a las yemas

Medido con el vídeo de referencia haciendo de cámara, cuadro a cuadro y con reloj conocido
(`gt.json`: dónde está cada yema en cada cuadro, sacado con el rastreador a toda resolución), y
con el rastreador frenado para que entregue como en un teléfono.

Qué pasaba:

- **La figura no era la de los dedos.** La ventana iba de pulgar a pulgar con la altura de los
  índices. En la referencia las cuatro esquinas son las cuatro yemas (y por eso salen triángulos,
  figuras cruzadas y líneas). Las esquinas quedaban a un 5,3 % del ancho de las yemas.
- **El rastreador veía borroso.** Recibía la imagen a 256 px de lado: una mano a un metro eran
  18 px de palma.
- **Iba 160 ms por detrás** (lo que tarda la detección más el suavizado), y el «adelanto» que se
  hacía no lo compensaba. Simulado sobre las trayectorias reales de las yemas, ningún predictor
  mejora a enseñar el último dato: el movimiento fino de los dedos no se deja adivinar a 150 ms.

Qué se hizo:

- **Las cuatro yemas son las cuatro esquinas**: índice y pulgar de la mano izquierda, pulgar e
  índice de la derecha, sin reordenar (la figura no salta al cruzarse).
- **El rastreador recibe la imagen a 480 px** (casi el doble por lado), cada cuadro una sola vez.
- **La imagen se sincroniza con el seguimiento.** La cámara se enseña un instante por detrás —lo
  que tarda el rastreador, entre 60 y 240 ms, medido y ajustado solo— y cada mano se coloca
  interpolando entre las dos detecciones que rodean al cuadro que se ve. Hay una cola de cuadros
  de cámara en la GPU (y otra de los lienzos pequeños que alimentan los emuladores) para poder
  enseñar el de ese instante. Es lo que hacen las apps de filtros. En la simulación, el error con
  las manos en movimiento baja de 3,4 % a 0,5 %.
- **El clic de anular y pulgar se mide en palmas**, no en centímetros (vale para manos grandes y
  pequeñas), y algo más holgado. En el vídeo de referencia: ningún portal fijado sin querer.

| | Publicado (20 detecciones por segundo) | Ahora (entre 12 y 30 por segundo, cuatro pasadas) |
|---|---|---|
| Distancia de las esquinas a las yemas (del ancho de la imagen) | 5,27 % | 0,81 – 0,93 % |
| Retraso de la figura respecto de los dedos que se ven | 160 ms | 0 – 40 ms (un cuadro como mucho) |
| Temblor con las manos quietas | 0,174 % | 0,037 – 0,041 % |
| Saltos de la figura (más del 6 % del ancho entre dos dibujos) | 54 | 3 – 8 |
| Con la figura abierta, cuadros sin ventana | 3 % | 0 – 1 % |

Queda cerca del suelo de la medida: la propia referencia tiembla (es el mismo rastreador sobre un
vídeo de poca resolución).

**Lo que cambia a la vista:** el visor de PORTAL va entre una y dos décimas de segundo por detrás
de la realidad. A cambio la figura no se despega de los dedos.

## 2 · Calor

`tests/energy.cjs` recorre los módulos y mide, de cada uno, la CPU del proceso de la página y la
del proceso de gráficos (en núcleos: 1,00 = un núcleo entero), las llamadas de animación, lo que
pinta cada motor y lo que se manda a los hilos de trabajo.

Dónde se iba el trabajo sin hacer falta:

| Hallazgo | Qué se hizo |
|---|---|
| El rastreador de manos trabajaba a tope siempre, con manos delante o sin ellas | Sin manos pasa a mirar unas 6 veces por segundo; con manos, 30 como mucho |
| Mientras «calibraba» el delegado de GPU, cada cuadro se analizaba dos veces, y sin manos no terminaba nunca | La comparación solo corre con manos delante y 4 veces por segundo |
| FLOW y la escena SILUETA de STAGE pedían una silueta en cada refresco de pantalla (60 por segundo) | 30 por segundo; quien dibuja más deprisa reutiliza la última |
| La cámara se pedía sin cadencia, y hay teléfonos que entregan 60 cuadros por segundo | Se pide a 30: ninguna cámara de FLIP pinta más deprisa |
| PORTAL redibujaba 60 o 120 veces por segundo aunque nada cambiara, y pedía la GPU de alto rendimiento | Solo redibuja si cambia el cuadro, la figura o un estilo; copia de cámara cada 28 ms como mucho |
| El audio de las teclas quedaba encendido para siempre tras el primer toque | Se suspende a los 9 segundos sin teclas y vuelve con el siguiente toque |

| CPU página + gráficos (núcleos), en el Mac | Publicado | Ahora |
|---|---|---|
| PORTAL (con una mano a la vista) | 0,24 + 0,41 | 0,18 + 0,23 |
| FLOW | 0,64 + 0,22 | 0,48 + 0,19 |
| STAGE · SILUETA | 0,52 + 0,20 | 0,32 + 0,17 |
| STAGE · DIRECTO | 0,15 + 0,15 | 0,15 + 0,16 |
| CAM (DSI … OSCAM) | 0,09 … 0,29 | sin cambio |
| Detecciones del rastreador sin manos delante | sin límite (30 o más por segundo, y el doble calibrando) | 5,7 por segundo |

CAM ya gastaba poco en el Mac; lo que le toca en un teléfono es la cámara a 30 en vez de a 60,
que aquí no se ve (la cámara simulada no tiene sensor). **La temperatura no se ha medido**: para
eso está `tests/device/pixel-heat.cjs`, que lee del teléfono por adb (batería, piel, chip, estado
térmico y CPU de Chrome por módulo) y aún no se ha podido correr.

## 3 · El iPhone en blanco

No se reproduce en WebKit actual (el motor de Safari, con forma de iPhone): la portada carga, las
22 cámaras pintan y PORTAL y STAGE abren. Sí se reproducen, forzándolas, dos causas reales de
pantalla vacía, y hay una tercera probable:

| Causa | Qué pasaba | Estado |
|---|---|---|
| **Almacenamiento bloqueado** (Safari con «Bloquear todas las cookies», o un navegador dentro de otra app): solo nombrar `localStorage` lanza un error | El guion principal se cortaba al cargar: la app no arrancaba | Arreglado: se usa una copia en memoria (los ajustes no se recuerdan entre visitas, la cámara funciona). Con prueba |
| **Un módulo que falla al iniciarse** (PORTAL, STAGE) deja su nombre declarado y sin valor | El bucle de la cámara preguntaba por él en cada cuadro, lanzaba, y el visor quedaba vacío | Arreglado: se pregunta por `window.flipPortal`. Con prueba |
| **Memoria de lienzos.** iOS limita el total de lienzos de una página; al pasarse, los nuevos salen vacíos sin error | La app mantenía vivas las capas de todas las cámaras y módulos a la vez: 72 MB con solo la portada, 214 MB en vertical con fotos en alta | Reducido a menos de la mitad (tabla). Sin confirmar que fuera esto |

| Megas de lienzos vivos | Publicado | Ahora |
|---|---|---|
| Portada, antes de encender la cámara | 72 | 33 |
| Cámara encendida | 91 | 52 |
| Tras 10 fotos | 129 | 64 |
| Vertical 9:16, tras 12 fotos en alta | 214 | 115 |
| Vertical 9:16, grabando vídeo | 222 | 108 |

(Cómo: las capas de cada cámara y sus cachés por tamaño solo existen mientras esa cámara se
pinta, y se sueltan a los seis segundos; la rejilla del CRT es un patrón y no un lienzo del
tamaño de la foto; STAMP guarda dos marcos en vez de seis; los lienzos auxiliares de SONO solo
existen con SONO abierto; PORTAL suelta sus colas al salir.)

Y para que no vuelva a quedarse en blanco sin decir nada, **un vigía de arranque**:

- Si el motor o la carcasa no cargan, sale una pantalla que lo dice, con el error, y un botón
  «Recargar limpio» que borra la copia guardada por el service worker antes de recargar.
- Si lo que no carga es PORTAL, STAGE o las teclas, la cámara funciona y se avisa.
- Con la app en marcha, si un cuadro falla el visor se reanuda solo (como mucho una vez por
  segundo) y, si insiste, avisa una vez.

De paso, en Safari: lo que se le asigna a `navigator.mediaDevices` desaparece cuando el navegador
limpia memoria (el envoltorio se recoge). El seguimiento de micrófono que baja el clic de las
teclas no funcionaba allí; ahora se sujeta la referencia.

## 4 · Pruebas

- Batería (`tests/run-all.cjs`): catorce pruebas, todas pasan. Nuevas: `boot-guard.cjs` y
  `webkit-smoke.cjs`; `portal.cjs` comprueba la figura por las cuatro yemas, el triángulo, la
  figura cruzada, el retraso de imagen y el descanso del rastreador.
- Actualización desde la versión publicada antes de la alfa (`update-published.cjs`): pasa.
- Recorrido exploratorio (`explore.cjs`), semillas 7 y 41: sin errores.
- Herramientas nuevas: `tests/energy.cjs` (consumo por módulo) y, para el teléfono,
  `tests/device/pixel-heat.cjs` y `pixel-crt.cjs`.

## 5 · Sin verificar

- **Todo esto en un teléfono.** Ni la temperatura, ni el PORTAL nuevo con manos reales, ni la
  cámara a 30. Con el teléfono por USB y la depuración activa:
  `node tests/device/pixel-open.cjs && node tests/device/pixel-heat.cjs 90` (con la app publicada
  y con esta, dejando enfriar entre medias) y `node tests/device/pixel-crt.cjs`.
- **El iPhone.** No se sabe el modelo, la versión de iOS, ni si se queda en blanco al abrir, al
  encender la cámara o en un módulo. Las tres causas de arriba están arregladas o reducidas, pero
  ninguna está confirmada como la suya. Si vuelve a pasar, la pantalla de aviso dirá el motivo.
- **El retraso del visor de PORTAL a ojo**: si una o dos décimas por detrás se sienten bien.
- Si un teléfono concreto ignora la petición de 30 cuadros por segundo.
- Lo que ya estaba pendiente: el clic de las teclas a oído, «este ordenador» como entrada de
  sonido, un controlador MIDI real, el audio de los MP4 en Opus.
