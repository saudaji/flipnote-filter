# FLIP · undécima pasada: el arranque de las grabaciones con sonido

Probando la marca en un Pixel 10 Pro XL, Chrome avisó al grabar: «la descripción del códec no
debería cambiar durante la grabación… considera avc3». Esta pasada lo aclara y lo arregla.

Rama `fable/prensa`. Publicada en `main` el 24 de noviembre de 2026 (caché v92).

## Qué pasaba

Solo al grabar **con sonido**, a cualquier resolución. Medido en el teléfono, con la misma cámara
(AUTO 03) y cambiando una cosa cada vez:

| resolución | sonido | aviso de Chrome | fotogramas clave al arrancar |
|---|---|---|---|
| MEDIA 768 × 1366 | no | no | 1 |
| ALTA 1080 × 1920 | no | no | 1 |
| MEDIA | sí | sí | 2, a 60 ms |
| ALTA | sí | sí | 1, y la imagen 0,6 s más corta que el sonido |

La causa: FLIP abría el flujo de vídeo y **después** esperaba a que el micrófono estuviera listo.
Al arrancar el grabador le llegaba un primer cuadro suelto, por otro camino que los demás. Los dos
fotogramas clave solo se distinguen en la etiqueta de color (BT.601 el primero, BT.709 el resto;
comparados byte a byte en una grabación en avc3, que guarda la descripción de cada uno). El vídeo
no se corrompía: decodifica sin errores. Pero la imagen empezaba tarde respecto al sonido y, según
el caso, con dos fotogramas clave pegados.

## El arreglo

`_createFlipRecordingJob` prepara primero el sonido y abre después el flujo de vídeo. Vale para
todos los módulos que graban por ahí (CAM, ASCII, GLITCH, FLOW, FUSION, EDIT, UPLOAD); SONO y WMP
ya lo hacían en un solo paso.

Probado en el Pixel antes de tocar el código (sustituyendo la función en la página pública, que es
donde el micrófono tiene permiso): tres grabaciones con sonido, ningún aviso, un solo fotograma
clave, y la imagen dura lo que el sonido (3,69 s y 3,84 s; antes 3,08 s y más).

En el ordenador, `tests/video-file.cjs` exige ahora que la toma con sonido arranque con un solo
fotograma clave y que la imagen empiece con el sonido. Con el orden antiguo falla; con el nuevo
pasa.

## Lo que no es

- No cambia el formato: se sigue grabando en avc1. Chrome sugiere avc3, y con avc3 el aviso también
  desaparece, pero avc3 lo abren peor algunos reproductores; arreglada la causa, no hace falta.
- No está comprobado que esto fuera el error al subir a Instagram: el archivo ya era válido. Lo
  que sí cambia es que el vídeo arranca limpio.

## Otra cosa que salió al medir: ALTA va lenta con las cámaras pesadas

Tiempo de pintar un cuadro de grabación en el Pixel (ms):

| cámara | MEDIA | ALTA |
|---|---:|---:|
| DSi | 3,6 | 4,0 |
| VFD | 4,6 | 4,9 |
| DLPHN | 6,5 | 6,2 |
| PRENSA | 1,9 | 1,8 |
| STAMP | 19,7 | 28,9 |
| AUTO 03 | 33,5 | 61,2 |

Con AUTO 03 en ALTA el vídeo sale a unos 8 cuadros por segundo (13 en MEDIA; la cámara, a oscuras,
daba 15). No es un fallo nuevo ni de esta pasada: es el coste de esas dos cámaras, que pintan en el
procesador. Queda apuntado: o se llevan a la gráfica, o ALTA debería avisar con ellas.

## El icono de la app instalada

El icono nuevo estaba bien publicado; lo que no cambiaba era la app ya instalada en el teléfono.
Chrome regenera la app instalada por su cuenta, pero solo revisa el manifiesto una vez al día y la
última revisión era anterior al icono. Se resolvió reinstalándola. Para quien la tenga instalada:
se actualiza sola en un día, o al momento desinstalando y volviendo a instalar.
