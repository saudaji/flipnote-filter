# Pruebas de FLIP

Todas corren en Chrome real mediante `playwright-core`, contra un servidor estático de `docs/`.
No necesitan cámara: usan escenas reproducibles (`tests/scenes.js`) y, para los recorridos,
una cámara simulada que entrega esas escenas por `getUserMedia` (`tests/lib/scene-camera.js`).

```bash
npm i --no-save playwright-core        # una vez; Chrome debe estar instalado
node .claude/serve.js 8760             # sirve docs/ en http://127.0.0.1:8760
FLIP_URL=http://127.0.0.1:8760 node tests/run-all.cjs
```

| Prueba | Qué comprueba |
|---|---|
| `alpha-smoke.cjs` | Arranque, foto en alta, un render por refresco, STAGE con su ventana de salida y su micrófono, arranque sin red. |
| `optical-cameras.cjs` | X–Y, FFT y TIEMPO de OSCAM; LED de FLASH; alineación de FLOW. |
| `night-vision.cjs` | AUTO 03 NIGHT: rostro legible en penumbra, negro profundo, lámpara con núcleo pálido y smear, señal monocroma azul verdosa, AGC, obturador lento, foto igual al visor. |
| `vector-beam.cjs` | OSCAM VECTOR: círculo de un solo trazo, diagonal de bajo contraste, sin puentes entre objetos, estabilidad con ruido, respuesta al movimiento y apagado del fósforo. |
| `material-audit.cjs --strict` | Las 16 variantes de pantalla y papel: orden tonal, niveles, campo blanco, trama pegada al material y visor frente a exportación punto a punto. |
| `alpha-flows.cjs` | Recorrido de alfa en un Pixel emulado, con los mandos visibles: permiso denegado y recuperado, foto, doble disparo, vídeo, grabar y parar al instante, cambio de cámara, NIGHT y FLASH, cambios rápidos de modo, segundo plano, mandos sin encimarse en vertical, pantalla pequeña y horizontal, liberación de cámara y micrófono, y SONO con sus lienzos de vuelta y sin suavizado. También un teléfono que no abre dos cámaras a la vez. |
| `alpha-media.cjs` | Vídeo con audio (ffprobe), visor frente a foto y vídeo, importación en EDIT, actualización desde la alfa anterior con su service worker. |
| `alpha-performance.cjs` | ms por cuadro, cadencia y tirones por variante, con y sin CPU frenada, y uso sostenido. |
| `portal.cjs` | PORTAL: dibujo acelerado a la cadencia de la pantalla; la figura por las cuatro yemas (manos simuladas en posiciones conocidas: cada esquina en su yema, triángulo con una pinza cerrada, figura cruzada con una mano del revés), la imagen sincronizada con el seguimiento (retraso y cola de cuadros), el repintado solo cuando algo cambia (y siempre con pegatinas encima), la esquina de una mano, el emulador solo dentro de la ventana, STAMP sin marco, ASCII y sonido, el marco que no se rompe al abrirlo, las tres formas de la ventana con su tecla (cuadro, círculo, triángulo), fijar dejando el marco quieto (el anillo, el portal con su forma, sin repetir en el sitio ni fijar un marco que se mueve), el clic de anular o medio con el pulgar (también con un rastreador simulado que tarda 90 ms y el pulgar moviéndose: se fija la figura de antes), el contexto de WebGL perdido y recuperado con un rastreador lento (la ventana no parpadea), el vitral de portales fijados (elegir, mover, cambiar de estilo, borrar) y el rastreador real: arranca aunque se salga y se vuelva mientras carga, descansa sin manos y sobrevive a salir y volver. `flipPortal.use(fn, { lag })` hace que el rastreador simulado conteste con retraso; `flipPortal.lose(true|false)` pierde y devuelve el contexto; `flipPortal.tune({ dwell: false })` apaga el «quieto» y `flipPortal.form('round')` elige la forma. |
| `feel.cjs` | Tacto: que cada sonido es un clic y no una nota (autocorrelación de cada receta y variante por debajo de 0,45, golpe que cae 30 dB en menos de 32 ms), qué suena y qué vibra en cada pieza (disparador, teclas, botones, interruptor, muescas), que nada suena sin un dedo, que dos sonidos no se pisan, y que al grabar o con el micrófono abierto las teclas callan o bajan. |
| `stage.cjs` | STAGE: cámara por planos nativos y por vídeo directo, conversión YUV del sombreador (I420 y NV12), carta de ajuste, mezcla, bucle, geometría, color, corte a negro, las ocho escenas, LFO, música sintetizada entrando por el analizador (golpes, tempo, adaptación al volumen, silencio), parcheo con cables, perillas y deslizador, guardar escena y transición, MIDI (aprender un CC, mandos sin configurar, notas, cambio de programa, ruedas, reloj), tempo a golpes, manos como mando, foto, grabación, encaje en tres tamaños y ventana de salida en escritorio. |
| `boot-guard.cjs` | El vigía de arranque: arranque limpio; un aviso inofensivo del navegador no cuenta como tropiezo; un cuadro que falla no deja el visor parado; sin carcasa o con el guion principal cortado sale un aviso con el motivo y «Recargar limpio» borra la copia en caché; sin PORTAL la cámara funciona; y siete navegadores hostiles (almacenamiento bloqueado o lleno, PORTAL o STAGE que no arrancan, sin WebGL, sin VideoFrame ni OffscreenCanvas, sin service worker) en los que la cámara tiene que encender y pintar. |
| `webkit-smoke.cjs` | En WebKit (motor de Safari) con forma de iPhone: arranca, las 22 cámaras pintan, PORTAL y STAGE abren, sin errores. Si no hay WebKit de Playwright instalado, avisa y no falla. |
| `vfd-crt.cjs` | VFD · CRT con los mandos reales: se elige desde la bandeja, fondo negro con contornos de color y luces quemadas en rosa, escena quieta sin parpadeo ni bombeo, mismo instante → mismo cuadro, exportación igual al visor, de la penumbra al foco, los cuatro formatos, foto, vídeo y lienzo limpio para la cámara siguiente. |

Fuera de la batería, porque tardan o levantan su propio servidor:

| Prueba | Qué comprueba |
|---|---|
| `explore.cjs [--seed n] [--taps n] [--desktop]` | Recorrido exploratorio: entra en los diez módulos y toca al azar (con semilla) todo lo que se puede tocar. Falla con cualquier error de página o de consola, promesa sin atender, página que no responde o pantalla sin salida, y deja la traza de los últimos toques. |
| `energy.cjs [--seconds n] [--only cam,portal]` | Dónde se va el trabajo: por módulo, CPU del proceso de la página y del de gráficos, llamadas de animación, cuadros de cada motor, mensajes a los hilos de trabajo, contextos de audio y de WebGL vivos. Para ver qué corre sin hacer falta y comparar antes y después. |
| `old-safari-css.cjs [carpeta]` | Qué pinta FLIP en un Safari que no entiende parte del CSS: le quita a la página, al vuelo, lo que cada versión de iOS no soporta (`dvh`, `:has()`, `inset`, `aspect-ratio`, `color-mix()`, `linear()`) y mide dónde queda cada pieza y si el visor pinta. Solo el CSS; lo que le falte de JavaScript no se simula. |
| `update-cache.cjs [--ref 0b13252]` | Actualización con la caché HTTP de por medio: sirve la versión anterior y la actual en un mismo origen con las cabeceras de GitHub Pages (cada archivo, válido diez minutos) y comprueba que lo que guarda el service worker nuevo es la versión nueva, archivo por archivo y byte a byte, que la página que queda es la nueva y que lo que no cambió no se vuelve a descargar. Levanta su propio servidor. |
| `update-published.cjs [--ref 0b13252]` | Actualización desde la app publicada: instala la versión anterior con su service worker, la usa y guarda ajustes en su formato; publica la actual en el mismo origen y comprueba que se instala sola, respeta lo guardado, deja una sola caché, funciona (cámara, VFD · CRT, foto, teclas, PORTAL, STAGE) y arranca sin red. |

`capture-gallery.cjs <carpeta>` genera la galería de capturas y clips con las mismas escenas
sobre cualquier commit, para comparar antes y después.

El Pixel emulado usa las medidas de un Pixel 10 Pro XL real (395 × 741 px CSS con la barra de
direcciones, densidad 3,4).

## En el teléfono

`tests/device/` maneja el Chrome de un Android conectado por USB con el protocolo de depuración.
Así se vio que el detector de siluetas devolvía ceros en la GPU del Pixel 10 y que leer la
cámara costaba 30 ms por cuadro; ninguna de las dos cosas aparece en emulación.

```bash
adb reverse tcp:8760 tcp:8760                                  # el teléfono ve el servidor del Mac
adb forward tcp:9333 localabstract:chrome_devtools_remote      # depuración de Chrome
adb shell am start -a android.intent.action.VIEW -d http://localhost:8760/ com.android.chrome
node tests/device/pixel-open.cjs                               # recarga sin caché y arranca la cámara
PIXEL_URL=http://localhost:8760 PIXEL_ASPECT=9:16 node tests/device/pixel-perf.cjs 2.5 salida.json
PIXEL_URL=http://localhost:8760 node tests/device/pixel-silhouette.cjs carpeta/
```

| Herramienta | Qué mide |
|---|---|
| `pixel-perf.cjs` | ms de render por cuadro, cadencia y tirones de cada variante con la cámara real. |
| `pixel-silhouette.cjs` | SLHT y FLOW: estado del detector, validez de la máscara, cadencia y capturas. |
| `pixel-seg.cjs` | Delegados GPU y CPU del segmentador sobre la misma imagen. |
| `pixel-sensor.cjs` | Coste de la lectura rápida de cámara y diferencia frente a la conversión del navegador. |
| `pixel-shot.cjs` | Captura de la pestaña, tras ejecutar una expresión opcional. |
| `pixel-pair.cjs` | Escena real y resultado de una cámara en el mismo instante, lado a lado. |
| `pixel-stage.cjs` | STAGE y PORTAL: ritmo real por escena, vía de cámara, tamaño del lienzo, silueta, un emulador como fuente y estado del seguimiento de manos. |
| `pixel-crt.cjs` | Con toques de verdad: VFD · CRT (ritmo y coste con la cámara real, foto, vídeo), el clic de las teclas, el giro de cámara y PORTAL. |
| `pixel-heat.cjs [segundos]` | Calor por módulo, leído del teléfono por adb: temperatura de batería, piel y chip, estado térmico, CPU de Chrome y cuadros por segundo. Solo lee. Vale también para una versión anterior servida en el mismo origen (`adb reverse tcp:8760 tcp:<otro puerto>`), para comparar. |
| `pixel-touch.cjs` | Recorrido con toques de verdad (eventos de entrada, no clics por código): AJUSTES, sonido y vibración de las teclas, bandeja, lanzador, y en STAGE escenas, perillas, cables, grabador y salida limpia. No guarda archivos en el teléfono. |

Solo tocan pestañas de FLIP (`localhost:87xx` o el túnel de prueba); las demás ni se listan.
LED, penumbra real, temperatura, giro y vuelta del segundo plano siguen pidiendo a una persona
con el teléfono en la mano.
