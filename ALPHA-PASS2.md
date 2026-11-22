# FLIP · segunda pasada de la alfa

Rama `fable/public-alpha-pass2`, sobre `ad2272b` (`codex/public-alpha`, solo local). Base de GitHub: `origin/main` = `0b13252`, que es lo que sirve hoy `https://saudaji.github.io/flipnote-filter/`. Nada de esta rama se ha empujado al remoto.

Todo lo que sigue se midió en Chrome 157 sobre un Mac (Apple M4) emulando un Pixel 9 (412 × 915 CSS px, densidad 2,625) con **sensor simulado**: escenas reproducibles de `tests/scenes.js` entregadas por `getUserMedia`. No hubo teléfono físico.

## Veredicto

**Apta para alfa pública, condicionada a una comprobación en un Pixel físico.** En emulación no queda ningún bloqueante conocido: los que encontré están corregidos y cubiertos por regresiones.

Sin verificar en este teléfono (**not verified**): LED/linterna real en FLASH, respuesta del sensor en penumbra real (ruido propio, cadencia que entrega la cámara a oscuras), temperatura y rendimiento sostenido, autonomía, rotación con cambio de orientación del sensor, y el comportamiento de Chrome para Android al volver del segundo plano.

Comprobación mínima en el Pixel (10 minutos): abrir el enlace, conceder cámara, NIGHT en una habitación a oscuras con una lámpara en cuadro, FLASH con la cámara trasera (¿se enciende y se apaga el LED?), grabar 20 s en STAMP ISSUE y abrir el archivo, salir a otra app y volver, girar el teléfono.

## Bloqueantes de alfa encontrados y corregidos

| Defecto | Cómo se reproduce en `ad2272b` | Arreglo | Regresión |
|---|---|---|---|
| La foto y el vídeo de DSi, CASKIA y VFD no eran lo que mostraba el visor: la exportación muestreaba con una rejilla 1,2–1,6 veces más fina | DSi → SNAP en resolución alta; comparar la trama al mismo aumento. Correlación visor/exportación punto a punto: DSi 0,18, CASKIA 0,82, VFD 0,88 | La exportación conserva los puntos del dispositivo y solo los amplía; tramas colocadas fila a fila | `material-audit.cjs` (ahora 1,00) |
| Tras denegar el permiso de cámara no había forma de reintentar | Denegar el permiso al entrar; ningún control vuelve a pedirlo | Puerta sobre el visor que explica el motivo y ofrece activar la cámara o usar un archivo | `alpha-flows.cjs` paso 1 |
| El micrófono quedaba abierto al salir de WMP (y de SONO si el permiso llegaba tarde), y después de grabar con audio | Entrar en WMP y volver a CAM: la pista de audio sigue viva | Se suelta al salir del módulo y entre tomas | `alpha-flows.cjs` paso 11, `alpha-media.cjs` |
| En segundo plano la cámara seguía abierta y la toma en curso se llenaba de cuadros congelados | Grabar, cambiar de app, volver | Se cierra y guarda la toma, se sueltan cámara y micrófono, se recupera la cámara al volver | `alpha-flows.cjs` paso 9 |
| Con la alfa anterior instalada, la nueva no llegaba hasta cerrar todas las pestañas | Abrir la alfa anterior, publicar la nueva, recargar | El service worker nuevo toma el control al instalarse: la primera apertura aún muestra la copia vieja, la siguiente ya es la nueva | `alpha-media.cjs` paso 4 |
| CASKIA SEIKO salía en negativo | Página blanca con texto negro: fondo oscuro y letras claras (correlación tonal −0,95). También ocurre en `origin/main` | Paleta de reposo claro a punto activado oscuro (+0,94) | `material-audit.cjs` |
| Los avisos largos se cortaban por ambos lados en el teléfono | Cualquier aviso de más de ~45 caracteres | Se parten en líneas y duran lo pedido | — |
| En horizontal y en 9:16 la barra de variantes tapaba el visor | Girar el teléfono en CAM | El visor se centra por encima de la barra | `alpha-flows.cjs` paso 10 |

## Informe por familia

### AUTO 03 · NIGHT
**Referencia.** Sony Handycam con NightShot / Super NightShot (Digital8 DCR-TRV240/340/350, 2002-03; MiniDV DCR-TRV17/18): 0 lux con emisor infrarrojo de ~3 m, obturador automático de 1/60 a 1/4 s que «deja imágenes residuales», imagen monocroma teñida de verde por la cámara (el tinte se quita con el efecto B/N), punto caliente central. Medí fotogramas de vídeos publicados de cinco cámaras (`research/alpha-pass2/nightshot-mediciones.md`): el tinte va del verde (CCD-TRV87, B/G 0,72) al verde azulado (TRV-110E, B/G 0,87) y al cian (DCR-SR45, B/G 1,1); los negros son casi neutros, la mediana ronda 40/255 y el centro es 4–5 veces más claro que las esquinas.

- Del **sensor**: señal monocroma con más peso del rojo, ruido que crece con la ganancia, saturación con halo y smear vertical de las fuentes puntuales. Del **iluminador**: punto caliente. De la **cámara**: AGC con inercia, obturador lento, tinte, realce horizontal de bordes. De la **grabación**: estructura de líneas.
- El azul verdoso es una decisión de FLIP: R/G 0,63 y B/G 1,00 en medios tonos, entre la TRV-110E y la SR45.

**Antes.** DAY a color con ganancia 4×.
**Cambio.** Motor propio en `docs/night-vision.js`, en luz lineal. La foto hereda la ganancia y la exposición del visor; ruido, halo y smear se definen en una rejilla lógica para que la exportación conserve la escala. La interfaz dice lo que es: «Amplifica la luz visible que capta el teléfono; no usa infrarrojo». DAY y FLASH no cambian: ocho capturas idénticas bit a bit.
**Evidencia** (`night-vision.cjs`, habitación en penumbra con lámpara): el rostro pasa de nivel 22 en DAY a 87 y se parece más a la escena iluminada (0,87 frente a 0,78); esquinas en 6/255; mediana 34 y percentil 95 en 146; núcleo de la lámpara 236 casi blanco (R/G 0,98) con smear de 19 niveles que desaparece sin lámpara; la lámpara baja la ganancia de 12× a 6,8×; el obturador lento actúa a oscuras (7 actualizaciones en 1 s frente a 29 con luz); visor frente a foto 0,99 y frente a vídeo 0,99 con el mismo tinte.

### OSCAM · VECTOR
**Referencia.** Osciloscopio analógico en X-Y con fósforo P31 y blanking por el eje Z (clase Tektronix 5103N/465): haz gaussiano con halo, brillo inversamente proporcional a la velocidad, puntos donde el haz se demora, caída rápida del fósforo con cola corta.
**Antes.** Cuatro niveles fijos de isoluminancia: dos o tres líneas por borde, curvas escalonadas, la diagonal de bajo contraste no se dibujaba y la mano salía en fragmentos.
**Cambio.** Un borde es el cruce por cero de una diferencia de gaussianas sobre la luminancia promediada solo donde no hay movimiento. Los cruces se enlazan en cadenas; se dibujan las más largas y contrastadas dentro del recorrido de un cuadro, ordenadas por cercanía. El haz se apaga en los saltos, deja puntos en extremos y esquinas, se atenúa cuando el recorrido es largo y el fósforo guarda los trazos anteriores sin residuo.
**Evidencia** (`vector-beam.cjs`): círculo de un trazo con error radial del 0,65 %; diagonal 118/136 cubierta al 100 %; dos objetos sin luz entre ellos; con ruido de sensor, deriva de 0,005 celdas y mismo número de trazos; el objeto se sigue en el mismo cuadro; al salir queda fósforo 33 ms y a los 0,5 s el fondo es exacto. X-Y, FFT y TIEMPO conservan su ruta y sus lecturas (`optical-cameras.cjs`: picos 0/4/12/32, 3,0 Hz).

### STAMP
**Referencia.** Sello calcográfico: línea de buril que engorda con la sombra (0,05–0,15 mm, 8–14 líneas/mm), cruzado en los oscuros, rayas y puntos en las luces, tinta en relieve, papel con fibra.
**Antes.** Las tres variantes daban casi la misma imagen; todo lo que pasaba del 30 % de luminancia quedaba en papel.
**Cambio.** Pantalla de líneas fija al soporte, con grabado, impresión y papel separados. ENGR: plancha limpia con cruzado. INK: línea gruesa, masas y velo. ISSUE: trama fina de ondas y dentado.
**Evidencia** (`material-audit.cjs`): de la cuña de 16 grises se distinguen 14–16 pasos (antes 7–9), orden tonal 0,99, campo blanco con σ 1,0–1,5 (antes 4,1), visor frente a exportación 0,96–0,98 con la misma trama. Límite: el tono se muestrea a 256 puntos de ancho, así que el texto pequeño no se lee.

### CASKIA
- **STD** (LCD reflectivo tipo Casio/Nokia, STN de 150–300 ms). Bien de trama y color; faltaba el arrastre. Ahora cada punto tarda ~110 ms: una transición de negro a blanco pasa por un gris intermedio y un objeto que se va deja resto unos cuadros.
- **E-INK** (E Ink Pearl/Carta: 16 grises, blanco al 44 % de reflectancia, fantasma hasta el refresco completo). Pasa de 5 a 16 grises sobre un sustrato gris claro; el fantasma es más tenue y dura segundos. No se emula el destello del refresco completo.
- **SEIKO** (TV Watch T001, 1982: cristal guest-host de matriz activa, imagen tenue y lenta). Imagen positiva, respuesta de ~150 ms y nivel de escena con inercia.

### DSi, DLPHN, VFD
Se conservan: orden tonal ≥ 0,93, trama inmóvil mientras la escena se mueve y, tras el arreglo de exportación, visor y archivo iguales punto a punto. En **THRML** el blanco alcanza el tope de la paleta (antes se quedaba en naranja) y el autorrango no parpadea.

### SLHT y FLOW
Con el modelo de segmentación real, SLHT recorta bien el retrato en 4:3 y en 9:16. FLOW dibuja con su propia cámara y la devuelve al salir. Sin red, SLHT usa un mate por contraste con el borde que en contraluz selecciona la ventana y no a la persona. No evalué cabello fino ni varias personas con material real.

## Rendimiento

`alpha-performance.cjs`, bucle real de cámara, 5 s por variante: todas mantienen su cadencia sin tirones (ningún intervalo de pantalla > 50 ms). Mediana por cuadro: STAMP 9 ms, AUTO 03 DAY 7,7, NIGHT 4,6, VECTOR 5,2, el resto por debajo de 6. Con la CPU frenada ×4: STAMP 16–20 ms de un presupuesto de 41, AUTO 03 DAY 16 de 33. 45 s sostenidos en STAMP: 20,2 → 20,1 ms y memoria plana.

## Mejoras futuras

- SLHT sin red en contraluz; SLHT depende de jsDelivr y Google Storage en tiempo de ejecución.
- X-Y, FFT y TIEMPO con el mismo modelo de haz (brillo según velocidad).
- Destello de refresco completo en E-INK.
- En exportaciones a 1440 × 1080 las pantallas emuladas se amplían 5,6×: algunos puntos miden 5 px y otros 6.
- En 360 × 640 los botones flotantes de la derecha pisan una esquina del visor.
- La interfaz mezcla textos en inglés y en español.

## Cómo repetirlo

```bash
npm i --no-save playwright-core
node .claude/serve.js 8760
FLIP_URL=http://127.0.0.1:8760 node tests/run-all.cjs
FLIP_URL=http://127.0.0.1:8760 node tests/capture-gallery.cjs galeria
```

Las referencias consultadas, con sus fuentes y lo que quedó sin confirmar, están en `research/alpha-pass2/`.
