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
| `alpha-flows.cjs` | Recorrido de alfa en un Pixel emulado: permiso denegado y recuperado, foto, doble disparo, vídeo, grabar y parar al instante, cambio de cámara, NIGHT y FLASH, cambios rápidos de modo, segundo plano, rotación, liberación de cámara y micrófono. |
| `alpha-media.cjs` | Vídeo con audio (ffprobe), visor frente a foto y vídeo, importación en EDIT, actualización desde la alfa anterior con su service worker. |
| `alpha-performance.cjs` | ms por cuadro, cadencia y tirones por variante, con y sin CPU frenada, y uso sostenido. |

`capture-gallery.cjs <carpeta>` genera la galería de capturas y clips con las mismas escenas
sobre cualquier commit, para comparar antes y después.

Estas pruebas no sustituyen a un teléfono: sensor, LED, temperatura y rendimiento sostenido
en un Pixel real hay que medirlos en el dispositivo.
