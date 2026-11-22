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
| `alpha-smoke.cjs` | Arranque, foto en alta, un render por refresco, salida de STAGE, arranque sin red. |
| `optical-cameras.cjs` | X–Y, FFT y TIEMPO de OSCAM; LED de FLASH; alineación de FLOW. |
| `night-vision.cjs` | AUTO 03 NIGHT: rostro legible en penumbra, negro profundo, lámpara con núcleo pálido y smear, señal monocroma azul verdosa, AGC, obturador lento, foto igual al visor. |
| `vector-beam.cjs` | OSCAM VECTOR: círculo de un solo trazo, diagonal de bajo contraste, sin puentes entre objetos, estabilidad con ruido, respuesta al movimiento y apagado del fósforo. |
| `material-audit.cjs --strict` | Las 15 variantes de pantalla y papel: orden tonal, niveles, campo blanco, trama pegada al material y visor frente a exportación punto a punto. |
| `alpha-flows.cjs` | Recorrido de alfa en un Pixel emulado, con los mandos visibles: permiso denegado y recuperado, foto, doble disparo, vídeo, grabar y parar al instante, cambio de cámara, NIGHT y FLASH, cambios rápidos de modo, segundo plano, mandos sin encimarse en vertical, pantalla pequeña y horizontal, liberación de cámara y micrófono. |
| `alpha-media.cjs` | Vídeo con audio (ffprobe), visor frente a foto y vídeo, importación en EDIT, actualización desde la alfa anterior con su service worker. |
| `alpha-performance.cjs` | ms por cuadro, cadencia y tirones por variante, con y sin CPU frenada, y uso sostenido. |

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

Solo tocan pestañas de FLIP (`localhost:87xx` o el túnel de prueba); las demás ni se listan.
LED, penumbra real, temperatura, giro y vuelta del segundo plano siguen pidiendo a una persona
con el teléfono en la mano.
