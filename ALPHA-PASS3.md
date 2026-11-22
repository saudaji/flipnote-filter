# FLIP · tercera pasada: cuerpo de cámara, FLOW/SLHT en el Pixel y STAMP

Rama `fable/public-alpha-pass2`, sobre `72a5a53`. Esta pasada sí tuvo teléfono: un **Pixel 10 Pro XL** (Android 17, Tensor G5, GPU PowerVR D-Series, Chrome 157) conectado por USB y manejado con el protocolo de depuración de Chrome. Lo que sigue distingue lo medido en el teléfono de lo medido en emulación.

## 1 · Interfaz: la trasera de una cámara

**Antes.** Rectángulos planos, emoji como iconos, un `<select>` para cambiar de módulo, botones flotando sobre la imagen, tres estilos distintos entre CAM, sus ajustes y la hoja de formato, y textos en dos idiomas. En el ancho real del Pixel (395 px) la barra de variantes de OSCAM se encimaba y la de FLOW dejaba dos botones fuera de pantalla.

**Ahora.** La pantalla es la trasera de una cámara, la FL-27:

- **Carcasa** de policarbonato ahumado translúcido: se ven debajo la placa, las pistas, las pilas de botón, la bobina del altavoz y unos diodos encendidos. Está modelada y renderizada en Blender (`design/camera-body/build.py`, cámara ortográfica, Cycles) y pesa 53 KB.
- **Mandos renderizados**, con su estado pulsado: disparador de aluminio torneado (rojo anodizado en vídeo), teclas de goma con bisel cromado, teclas en píldora que se iluminan, marcos de ventana. Todos juntos, 208 KB.
- **Pantalla** con marco y datos en ella como en una videocámara: cámara y variante, formato, batería real del teléfono, cuadros por segundo, piloto de grabación con el tiempo. Nada de eso sale en la foto ni en el vídeo.
- **Botonera de CAM**: variantes en teclas iluminadas, una ranura con las ocho cámaras a la vista (miniatura de lo que hace cada una; un toque la cambia), FOTO/VIDEO con piloto, disparador, miniatura de la última toma y cambio de cámara. El botón «CÁMARAS» y su bandeja desaparecen: ya no hay que abrir nada para elegir.
- **Última toma**: la miniatura abre la foto o el vídeo recién guardado, dice dónde quedó y deja compartirlo o guardarlo otra vez. Antes el archivo se descargaba sin más señal.
- **Módulos**: una tecla con el nombre del módulo abre un lanzador con los nueve, con icono y descripción.
- **Ajustes** de cada cámara y hoja de formato y audio, rehechos con el mismo lenguaje y en español.
- **Resto de módulos** (ASCII, SONO, WMP, GLITCH, FUSION, FLOW, EDIT, STAGE): misma carcasa, mismas teclas e iconos propios, deslizadores con perilla. FLOW tiene botonera nueva (colores, tamaño de aura, disparador, grabar, girar) y pliega sus ajustes para dejar sitio a la imagen.
- Respuesta háptica en cada tecla, hojas con muelle, tipografías Michroma, Chakra Petch y Pixelify Sans.

**Evidencia.** `tests/alpha-flows.cjs` recorre la app con los mandos visibles y comprueba que en 395 × 741 (Pixel con barra de direcciones), 360 × 640 y 880 × 396 todos los mandos caben, ninguno se encima con otro y ninguno pisa el visor. Capturas del teléfono real en la carpeta de evidencia.

## 2 · FLOW y SLHT se rompían en el Pixel: causa y arreglo

**Causa, vista en el teléfono.** MediaPipe con el delegado de GPU no puede leer su máscara en la PowerVR: la consola repite `GL_INVALID_OPERATION: glReadPixels: Invalid format and type combination` una vez por inferencia y la máscara llega **toda a cero**, sin lanzar error. La app creía que el detector funcionaba y dibujaba una silueta vacía. Medido con la misma imagen: GPU → máximo 0; CPU → 37,7 % de píxeles dentro de la figura.

**Arreglo.**
- Un solo detector para toda la app (`docs/silhouette.js`), en un **worker** y con el delegado de **CPU**: la máscara es la misma en todos los dispositivos y la inferencia (~35 ms en el Pixel) no detiene el dibujo. Si deja de responder se reinicia; si no se usa, suelta la memoria.
- **FLOW comparte la cámara de la app** en vez de abrir otra. Con cámara propia había que cerrar una y abrir otra al entrar y al salir, y en Android la segunda apertura puede fallar. Ahora arranca solo al entrar.
- El service worker guarda el modelo la primera vez (10 MB): después funciona sin red.

**Evidencia en el Pixel.** SLHT: detector listo, máscara válida, pantalla a 60 fps. FLOW: máscara válida, 60 fps, ~24 máscaras por segundo, ningún error de GL en la consola.

## 3 · Lo que encontré de paso con el teléfono delante

| Hallazgo en el Pixel | Antes | Ahora |
|---|---|---|
| Leer un cuadro de la cámara con `drawImage` cuesta ~30 ms (el navegador convierte el cuadro entero a RGB). Copiar sus planos nativos con WebCodecs cuesta < 1 ms. `docs/sensor.js` copia los planos y convierte solo lo necesario; la imagen coincide con la del navegador (diferencia media 0,3 niveles, correlación 1,000) | todas las cámaras entre 28 y 47 ms por cuadro | DSi 3,8 · DLPHN 4,8 · NIGHT 6 · STAMP 24 · AUTO 03 DAY 22 ms (9:16) |
| VECTOR volvía a trazar toda la historia del fósforo en cada cuadro | pantalla a 20 fps con 18–20 tirones | 30 fps, sin tirones |
| STAMP en 9:16 | 22 fps, 8–14 tirones cada 2,5 s | 24 fps, ninguno |
| La ventana útil en Chrome es de 395 × 741 px, no 412 × 915 | las pruebas emulaban un Pixel 9 | el arnés usa las medidas del teléfono |

## 4 · STAMP

**Antes.** Dos rectas, «FLIP POST» en la serifa del sistema montado sobre el filete, y las tres variantes con el mismo marco.

**Ahora** cada variante es un sello distinto, dibujado una vez en una capa y compuesto sobre la imagen:

- **ENGR**, definitivo calcográfico: cenefa de guilloché de tres ondas entrelazadas, rosetas de torno en las esquinas, rótulo en reserva sobre fondo rayado, valor en dos tablillas, leyenda con el año en romanos, cantoneras y dentado.
- **INK**, tipográfico a dos tintas: una segunda tinta plana por paleta (bermellón, ocre, sangre de toro, azul petróleo, rojo), gótica calada, valor en discos, registro corrido entre las dos tintas y motas de papel en el plano.
- **ISSUE**, conmemorativo: dentado, márgenes anchos, «primer día de emisión» con la fecha real y un matasellos de doble corona con la fecha y las ondas del rodillo, con la tinta desigual.

Papel con pátina (bordes tostados, motas). Tipos: Cinzel para las romanas, Canterbury (ya en el repositorio) para la gótica.

**Evidencia.** `material-audit.cjs --strict` sigue en verde: 14–16 grises distinguibles, orden tonal 0,99 y visor frente a exportación 0,96–0,98. En el Pixel, STAMP mantiene 24 fps en 9:16.

## 5 · OSCAM VECTOR: definición

**Antes, en el teléfono.** Sobre un escritorio real, 20 trazos: salían los cantos grandes, pero el texto de una pantalla, los cables y los marcos se perdían, y las rectas temblaban. La causa: una rejilla de análisis de 192 columnas y un «presupuesto de haz» que se agotaba con los contornos largos.

**Ahora.**
- Rejilla de hasta 320 columnas (unas 92 000 celdas, para que 9:16 no se dispare).
- Dos trazos: **estructura** (bordes largos y firmes en todo su recorrido) y **detalle**, más fino y tenue (un renglón, un cable, una rejilla).
- El grano no se dibuja: dentro de una zona con borde por todas partes (estuco, tela) solo pasa lo que tiene forma limpia o va alineado con sus vecinos, como los renglones de un texto.
- Suavizado que respeta las esquinas y simplificación del trazo: una recta queda en dos puntos y el haz la dibuja limpia.
- El visor de OSCAM se amplía suavizado en vez de por píxeles.

**Evidencia.** En el mismo escritorio, 83 trazos con los renglones de la pantalla legibles como texto. `vector-beam.cjs`: círculo con error radial del 0,35 % (antes 0,65 %), diagonal cubierta al 100 %, fósforo que vuelve al fondo exacto. En el Pixel: 14 ms por cuadro en 4:3 y 17 ms en 9:16, 30 fps, sin tirones. `tests/device/pixel-pair.cjs` saca escena y resultado del mismo instante, lado a lado.

## 6 · El botón AJUSTES no abría

Un manejador antiguo cerraba los paneles de CAM con cualquier toque «fuera»; el toque que abría la hoja nueva contaba como fuera y la cerraba en el acto. Mis capturas la abrían por código y no lo vieron. Corregido: la hoja abre con las ocho cámaras (también las que no tenían ajustes propios: lleva formato, cadencia, zoom y pegatinas), no se cierra al usarla y LISTO la cierra. `alpha-flows.cjs` ahora pulsa el botón en cada cámara y en FLOW; comprobado en el Pixel con toques reales.

## Estado para la alfa

**Verificado en el Pixel 10 Pro XL:** siluetas de FLOW y SLHT, cadencia y coste por cuadro de las 20 variantes en 4:3 y en 9:16, lectura rápida de la cámara, interfaz nueva con la cámara real, botón AJUSTES con toques reales y VECTOR sobre una escena real.

**Sin verificar todavía en el teléfono (not verified):** LED real en FLASH, penumbra real en NIGHT, temperatura y autonomía en uso largo, giro del teléfono, y salir a otra app y volver. Lo comprobado ahí sigue siendo de emulación.

## Mejoras futuras

- EDIT, STAGE, GLITCH, SONO y WMP conservan por dentro sus controles antiguos; llevan la carcasa y las teclas, no un rediseño de sus paneles, y parte de sus rótulos sigue en inglés.
- En horizontal la botonera pasa a una columna, pero no tiene un diseño propio.
- Las miniaturas de los looks salen de un retrato dibujado; con una foto real se venderían mejor.
- La carcasa tiene un solo acabado.
- El modo `?beta=1` (FLIP OS) no se ha adaptado al cuerpo nuevo.
- AUTO 03 DAY y STAMP ocupan 22–24 ms del hilo principal por cuadro en 9:16: caben, pero son los candidatos a pasar a un worker.

## Cómo repetirlo

```bash
node .claude/serve.js 8760
FLIP_URL=http://127.0.0.1:8760 node tests/run-all.cjs

# En el teléfono (depuración USB activada, Chrome abierto):
adb reverse tcp:8760 tcp:8760
adb forward tcp:9333 localabstract:chrome_devtools_remote
adb shell am start -a android.intent.action.VIEW -d http://localhost:8760/ com.android.chrome
node tests/device/pixel-open.cjs                       # arranca la cámara
PIXEL_URL=http://localhost:8760 PIXEL_ASPECT=9:16 node tests/device/pixel-perf.cjs 2.5
PIXEL_URL=http://localhost:8760 node tests/device/pixel-silhouette.cjs capturas/

# Las piezas de la carcasa:
/Applications/Blender.app/Contents/MacOS/Blender -b -P design/camera-body/build.py -- body body.png h=900
```
