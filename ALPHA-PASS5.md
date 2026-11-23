# FLIP · quinta pasada: el calor, los dedos de PORTAL y el iPhone en blanco

Rama `fable/public-alpha-pass2`, sobre `1ebfa47` (lo publicado en `main`). Tres avisos después de
usar la versión publicada en un teléfono: se calienta muy rápido; PORTAL reconoce mal los dedos
(«muy torpe, no hace bien las figuras»); y en un iPhone la app se queda en blanco.

Casi todo está medido en el Mac (Chrome y WebKit de Playwright). Al final de la pasada se pudo
usar un teléfono de verdad (un Samsung Galaxy, Chrome 158): ahí se midió el calor, con la versión
publicada y con esta, y PORTAL con manos reales (apartado 6). Lo que salió de esa prueba cambió
el clic de PORTAL y trajo dos cosas nuevas: fijar dejando el marco quieto y elegir la forma de la
ventana. Del iPhone sigue sin haber modelo ni versión. Qué falta, en el apartado 7.

Antes de publicar, el diff se repasó línea a línea dos veces (una lectura propia y otra
independiente). Salieron fallos que las pruebas no veían, algunos metidos por esta misma pasada;
están corregidos y cada uno tiene ya su prueba. El detalle, en el apartado 5.

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
- **El clic fija la figura de antes de mover los dedos.** Acercar el anular al pulgar mueve la
  esquina que marca el pulgar: se toma la figura de 230 ms antes del cuadro en que el rastreador
  vio el clic, contando en la hora de las imágenes (el visor va por detrás del reloj y el
  rastreador, por detrás del visor).
- **Salir de PORTAL mientras carga el seguimiento y volver ya no lo deja sin manos.** La carga en
  curso se descartaba al terminar, y PORTAL se quedaba pidiendo «Enseña las manos a la cámara» sin
  rastreador y sin aviso, hasta salir y entrar otra vez. Venía de antes de esta pasada; en un
  teléfono, donde la primera carga tarda, es fácil caer en ello.
- **Sin WebGL, o con su contexto perdido** (pasa al volver de segundo plano), no hay cola de
  cuadros: la ventana se dibuja con la última detección, algo por detrás, en vez de parpadear.
- Al cambiar de cámara, los cuadros de la anterior que quedan en la cola conservan su espejo (no
  se voltean un instante).

| | Publicado (20 detecciones por segundo) | Ahora (entre 12 y 30 por segundo, siete pasadas) |
|---|---|---|
| Distancia de las esquinas a las yemas (del ancho de la imagen) | 5,27 % | 0,81 – 0,98 % |
| Retraso de la figura respecto de los dedos que se ven | 160 ms | 0 – 40 ms (un cuadro como mucho) |
| Temblor con las manos quietas | 0,174 % | 0,037 – 0,041 % |
| Saltos de la figura (más del 6 % del ancho entre dos dibujos) | 54 | 3 – 8 |
| Con la figura abierta, cuadros sin ventana | 3 % | 0 – 1 % |
| Lo que va el visor por detrás de la realidad | — | 130 – 220 ms |

Queda cerca del suelo de la medida: la propia referencia tiembla (es el mismo rastreador sobre un
vídeo de poca resolución).

**Lo que cambia a la vista:** el visor de PORTAL va entre una y dos décimas de segundo por detrás
de la realidad (más cuanto más lento el rastreador). A cambio la figura no se despega de los dedos.
Las tres últimas pasadas son posteriores a las correcciones del repaso (apartado 5).

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
| PORTAL redibujaba 60 o 120 veces por segundo aunque nada cambiara, y pedía la GPU de alto rendimiento | Solo redibuja si cambia el cuadro, la figura o un estilo (con pegatinas de CAM encima, siempre); copia de cámara cada 28 ms como mucho |

Una medida que se retiró en el repaso: suspender el audio de las teclas en las pausas. Ahorra muy
poco y se paga en el tacto: al despertarlo, el primer clic llega tarde o no suena. El audio de las
teclas sigue como en la versión publicada.

| CPU página + gráficos (núcleos), en el Mac | Publicado | Ahora |
|---|---|---|
| PORTAL (con una mano a la vista) | 0,24 + 0,41 | 0,18 + 0,23 |
| FLOW | 0,64 + 0,22 | 0,48 + 0,19 |
| STAGE · SILUETA | 0,52 + 0,20 | 0,32 + 0,17 |
| STAGE · DIRECTO | 0,15 + 0,15 | 0,15 + 0,16 |
| CAM (DSI … OSCAM) | 0,09 … 0,29 | sin cambio |
| Detecciones del rastreador sin manos delante | sin límite (30 o más por segundo, y el doble calibrando) | 5,7 por segundo |

CAM ya gastaba poco en el Mac; lo que le toca en un teléfono es la cámara a 30 en vez de a 60,
que aquí no se ve (la cámara simulada no tiene sensor). Lo medido en un teléfono, con
temperaturas, está en el apartado 6.

## 3 · El iPhone en blanco

No se reproduce en WebKit actual (el motor de Safari, con forma de iPhone): la portada carga, las
22 cámaras pintan y PORTAL y STAGE abren. Sí se reproducen, forzándolas, tres causas reales de
app rota o pantalla vacía, y hay una cuarta probable:

| Causa | Qué pasaba | Estado |
|---|---|---|
| **Almacenamiento bloqueado** (Safari con «Bloquear todas las cookies», o un navegador dentro de otra app): solo nombrar `localStorage` lanza un error | El guion principal se cortaba al cargar: la app no arrancaba | Arreglado: se usa una copia en memoria (los ajustes no se recuerdan entre visitas, la cámara funciona). Con prueba |
| **Un módulo que falla al iniciarse** (PORTAL, STAGE) deja su nombre declarado y sin valor | El bucle de la cámara preguntaba por él en cada cuadro, lanzaba, y el visor quedaba vacío | Arreglado: se pregunta por `window.flipPortal`. Con prueba |
| **Una actualización a medias.** El service worker llenaba su caché pasando por la caché HTTP del navegador, y GitHub Pages da cada archivo por válido diez minutos | Quien había abierto la app poco antes de una publicación se quedaba con archivos de la versión vieja guardados con el nombre de la nueva: la página vieja o, peor, una mezcla de página vieja y piezas nuevas, que puede no arrancar. Y así hasta la siguiente publicación, porque la app se sirve siempre de esa caché | Arreglado: cada archivo se comprueba con el servidor (lo que no cambió no se vuelve a descargar). Con prueba (`tests/update-cache.cjs`, con las cabeceras de GitHub Pages): antes quedaban viejos `index.html` y siete piezas; ahora, ninguno de los 73 |
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
existen con SONO abierto; PORTAL suelta sus colas y los estilos de sus ventanas al salir.)

La actualización a medias encaja con «en un iPhone se queda en blanco y en otros teléfonos va
bien», pero no está confirmado que fuera eso. Si lo era, esta versión lo cura sola: el service
worker nuevo se instala aunque la página esté rota, y a la siguiente apertura sirve la versión
entera.

Y para que no vuelva a quedarse en blanco sin decir nada, **un vigía de arranque**:

- Si el motor o la carcasa no cargan, sale una pantalla que lo dice, con el error, y un botón
  «Recargar limpio» que borra la copia guardada por el service worker antes de recargar.
- Si lo que no carga es PORTAL, STAGE o las teclas, la cámara funciona y se avisa.
- Con la app en marcha, si un fallo para el visor, se reanuda solo (como mucho una vez por
  segundo) y, si insiste, avisa una vez. Solo cuentan los fallos que de verdad lo paran: un error
  de otra parte, o un aviso inofensivo del navegador, se anota y nada más.

**Por versión de iOS.** No hay un iPhone antiguo a mano, así que esto sale de leer el código y de
quitarle a la página, al vuelo, el CSS que cada versión no entiende (`tests/old-safari-css.cjs`).
Lo que le falte de JavaScript a cada Safari no está simulado.

| iPhone | Qué pasa |
|---|---|
| iOS 12 o anterior (iPhone 6, 5s) | El navegador no puede leer el guion de la app: usa `?.` y `??`, que llegaron con iOS 13.4. La versión publicada se queda en blanco; ahora sale el aviso, que pide actualizar |
| iOS 13.4 a 14.4 | Sin el CSS que le falta, el visor pinta, pero la carcasa pierde su fondo y la bandeja de cámaras se descoloca |
| iOS 14.5 a 15.3 | Sin las unidades `dvh` ni `:has()` todo queda en su sitio: no hacen falta para que se vea |
| iOS 15.4 en adelante | No le falta nada del CSS que usa la app |

Si a alguno de esos Safari le falta al arrancar una función de JavaScript, ya no se queda en
blanco: sale el aviso con el error. PORTAL dibuja sin WebGL 2 si hace falta, y si el seguimiento de
manos no carga, lo dice. El WebKit de pruebas (27) tiene `ctx.filter`; en un Safari que no lo
tenga, algunos brillos difuminados de las cámaras no salen (no da error). El CRT no depende de ello.

De paso, en Safari: lo que se le asigna a `navigator.mediaDevices` desaparece cuando el navegador
limpia memoria (el envoltorio se recoge). El seguimiento de micrófono que baja el clic de las
teclas no funcionaba allí; ahora se sujeta la referencia.

## 4 · Pruebas

- Batería (`tests/run-all.cjs`): catorce pruebas, todas pasan. Nuevas: `boot-guard.cjs` y
  `webkit-smoke.cjs`; `portal.cjs` comprueba la figura por las cuatro yemas, el triángulo, la
  figura cruzada, el retraso de imagen y el descanso del rastreador.
- Actualización desde la versión publicada antes de la alfa (`update-published.cjs`): pasa.
- Actualización con la caché HTTP de por medio (`update-cache.cjs`, nueva): pasa desde la app
  original y desde lo publicado (73 archivos, todos de la versión nueva; de lo publicado a esta se
  descargan 8 y los otros 65 solo se comprueban); con el service worker anterior, falla.
- Recorrido exploratorio (`explore.cjs`), semillas 7 y 41: sin errores.
- `portal.cjs` cubre además las tres formas con su tecla, el «quieto» (fija, no repite en el
  sitio, no fija un marco que se mueve) y el clic con una mano simulada de dedo medio recogido.
- Herramientas nuevas: `tests/energy.cjs` (consumo por módulo), `tests/old-safari-css.cjs` (qué
  pinta la app sin el CSS que un Safari antiguo no entiende) y, para el teléfono,
  `tests/device/pixel-heat.cjs` y `pixel-crt.cjs`.

## 5 · Repaso antes de publicar

Dos lecturas del diff completo, línea a línea. Lo que salió y cómo quedó:

| Qué pasaba | De dónde venía | Cómo quedó |
|---|---|---|
| Con pegatinas de CAM puestas, PORTAL las pintaba dos veces sobre el mismo cuadro (y la lupa ampliaba lo ya ampliado) | De «solo redibuja si algo cambia» | Con pegatinas se repinta en cada vuelta |
| El clic de anular y pulgar fijaba la figura del momento del toque, con la esquina del pulgar ya movida | De la imagen sincronizada | Se fija la de 230 ms antes, en la hora de las imágenes |
| Sin WebGL o con el contexto perdido, la ventana parpadeaba o se cerraba | De la imagen sincronizada | Se dibuja con la última detección |
| En SONO, FLIP y LEGACY salían suavizados en vez de a píxel duro | De soltar sus lienzos fuera de la pestaña (al devolverles el tamaño, el contexto se reinicia) | Se repone el ajuste al volver |
| El primer clic de tecla tras una pausa llegaba tarde o no sonaba | De suspender el audio en las pausas | Medida retirada |
| Salir de PORTAL mientras cargaba el seguimiento y volver lo dejaba sin rastreador | Anterior a esta pasada | La carga en curso se vuelve a esperar |
| El vigía contaba como «tropiezo al dibujar» cualquier error, también los avisos inofensivos del navegador | Del vigía | Solo cuenta si el visor se paró de verdad |
| Tras publicar, el service worker nuevo podía guardar archivos de la versión vieja (salió al ver una copia vieja de la app en un navegador de pruebas) | Anterior a esta pasada: de llenar la caché fiándose de la caché HTTP | Cada archivo se comprueba con el servidor |
| Al cambiar de formato, las capas de OSCAM se reservaban aunque no se usaran; tras doce fotos de OSCAM, las suyas dejaban de soltarse; los estilos de las ventanas de PORTAL seguían en memoria al salir | De las capas a demanda (lo último, anterior) | Corregido |

Cada arreglo tiene su prueba, y cada prueba se comprobó deshaciendo el arreglo: sin él, falla.
Para probar el clic y el camino sin WebGL como en un teléfono, el rastreador simulado de las
pruebas puede contestar con retraso (las manos de hace 90 o 130 ms), y se puede perder y devolver
el contexto de WebGL.

## 6 · En un teléfono de verdad

Un Samsung Galaxy con Chrome 158, por USB (`tests/device/`). La app arranca sin tropiezos, la
cámara entrega 30 cuadros por segundo (29,5 medidos) y PORTAL sube la cámara por planos (I420) con
dibujo acelerado.

### Calor

`pixel-heat.cjs`: 40 segundos por módulo, con la versión publicada y con esta en el mismo origen,
y tres minutos de enfriado entre una y otra. CPU en tanto por ciento de un núcleo (los procesos de
Chrome: página y gráficos).

| | Publicada | Esta |
|---|---|---|
| Cámara, en todos los módulos | 60 cuadros por segundo | 30 |
| PORTAL sin manos · CPU página + gráficos | 166 % + 58 % | 79 % + 38 % |
| PORTAL sin manos · detecciones por segundo | 15 | 6 |
| PORTAL sin manos · el chip, en 40 s | 38,0 → 44,5 °C | 36,4 → 38,3 °C |
| PORTAL sin manos · la batería, en 40 s | 32,1 → 34,1 °C | 32,5 → 32,9 °C |
| FLOW · CPU página + gráficos | 147 % + 73 % | 115 % + 58 % |
| CAM (DSI, VFD · CRT, STAMP) | 42–69 % + 18–26 % | 38–67 % + 16–25 % |
| STAGE · DIRECTO | 59 % + 54 % | 60 % + 55 % |

El estado térmico del teléfono no pasó de «normal» en ninguna de las dos (son tramos cortos). En
CAM lo que gasta Chrome casi no cambia: lo que se ahorra ahí es la cámara a 30 en vez de a 60, que
trabaja fuera de esos dos procesos y esta medida no ve. El ahorro de PORTAL es sin manos delante
(o con portales fijados y nadie delante); con manos, el rastreador va al máximo que da el teléfono
en las dos versiones, y eso no se ha medido.

### PORTAL con manos reales

Cámara frontal y cuatro tandas de medio minuto, apuntando el estado diez veces por segundo y una
captura cada dos segundos y medio (evidencia local).

- **La figura va cosida a las yemas.** En las doce capturas de la primera tanda las cuatro
  esquinas caen sobre índices y pulgares (rectángulo, figura cruzada, inclinada, pinza cerrada).
  Con las dos manos a la vista la ventana estuvo abierta el 98 % del tiempo, sin cierres bruscos.
- Rastreador (delegado de CPU): de 12 a 18 detecciones por segundo, de 47 a 79 ms cada una. La
  imagen va entre 100 y 160 ms por detrás.
- **El clic de anular y pulgar casi no entraba**, y no por lo que arregló el repaso. Con los
  dedos tocándose, las dos yemas coinciden en la imagen (0,2–0,35 tamaños de mano, frente a
  0,9–1,1 en reposo), pero la distancia en 3D que estima el modelo se queda en 1,7–1,9 veces el
  umbral, y da el índice por pegado al pulgar. Solo entró pellizcando con las dos manos a la vez.
  Ahora se decide en la imagen y el 3D queda de freno; vale el anular o el medio; y un clic es un
  acercamiento nuevo (350 ms sin tocar antes), sin depender de la postura de reposo de cada mano.
  En la tanda siguiente entraron los tres toques hechos con el índice estirado, y después quien
  probaba fijó ocho más. Si el índice se va con los otros dedos hasta el pulgar, no cuenta: esa
  pinza es la que cierra la L.
- **Quieto para fijar** (nuevo). Sostener el marco lo mueve entre un 1,6 y un 2,3 % del lado
  corto del visor en un segundo; moverlo con normalidad, del 10 al 40 %. Con el marco quieto
  (tolerancia: 3 %), a los 0,3 s aparece un anillo que se llena en 0,8 s y fija el portal. Moverse
  lo cancela, y tras fijar hay que mover el marco para rearmarlo.
- **Selector de forma** (nuevo). Una tecla junto a FIJAR pasa de cuadro a círculo (el óvalo que
  pasa por el centro de los cuatro lados) y a triángulo (la punta entre los índices, la base en los
  pulgares). Cambia la ventana viva y el portal elegido, y se recuerda de una visita a otra.

En el teléfono y con manos simuladas, las tres formas cambian con su tecla, el anillo se ve
mientras cuenta y el portal fijado conserva su forma.

## 7 · Sin verificar

- **«Quieto para fijar» y las formas, con manos reales.** En el teléfono solo se han visto con
  manos simuladas: falta juzgar a mano si el segundo de espera se queda corto o largo y si fija
  portales sin querer.
- **Otros teléfonos y otras manos.** Las cifras son de un Samsung Galaxy y el clic está afinado
  con las manos de una persona. El teléfono de quien avisó del calor es otro modelo.
- **PORTAL con manos delante, en consumo.** Medido solo sin manos.
- **El iPhone.** No se sabe el modelo, la versión de iOS, ni si se queda en blanco al abrir, al
  encender la cámara o en un módulo. Las causas del apartado 3 están arregladas o reducidas, pero
  ninguna está confirmada como la suya. Si vuelve a pasar, la pantalla de aviso dirá el motivo.
- **El retraso del visor de PORTAL a ojo**: si una o dos décimas por detrás se sienten bien.
- Los 230 ms que retrocede el clic para fijar la figura de antes salen de cómo se comportaba la
  versión publicada: no se han afinado con manos reales.
- Si algún teléfono ignora la petición de 30 cuadros por segundo (el Samsung la respeta).
- Lo que ya estaba pendiente: el clic de las teclas a oído, «este ordenador» como entrada de
  sonido, un controlador MIDI real, el audio de los MP4 en Opus.
