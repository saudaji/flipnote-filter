# FLIP · sexta pasada: consolas de ajustes y una carcasa que parece de verdad

El encargo tenía dos partes. La primera, de manejo: los ajustes eran listas de deslizadores que
había que desplazar (y al desplazar se movían valores sin querer), y la hoja de ajustes de CAM
tapaba media imagen. La segunda, de aspecto: la carcasa y los botones debían verse como el
aparato de verdad, con su luz, su sombra y sus materiales, como las emulaciones de equipo
analógico, y no como una interfaz plana que se le parece.

Rama `fable/public-alpha-pass2`, publicada en `main` el 23 de noviembre de 2026 (caché v85).

## 1 · Los ajustes ya no se desplazan

### CAM: una consola bajo el visor

Al pulsar AJUSTES, la botonera se retira y en su sitio queda una placa de aluminio anodizado con
los mandos de la cámara elegida. El visor sigue entero a la vista: se ve lo que se está ajustando.

- **Una página por sección**: CÁMARA (los mandos propios de esa cámara), COLOR, CUADRO (cadencia,
  zoom y formato) y PEGATINAS. Se cambia con las teclas de abajo; LISTO o Escape cierran.
- **Como mucho, una fila de perillas y otra de teclas por página.** La cámara con más mandos
  (SLHT, nueve) los lleva en dos filas. Antes eran hasta 1,9 pantallas de desplazamiento con once
  deslizadores finos.
- **Perillas**: se arrastra hacia arriba o hacia abajo (también de lado). Dos toques seguidos la
  devuelven a su valor de fábrica. Suenan muesca a muesca.
- **Interruptores** deslizantes para lo que es una cosa u otra (MARCO, COLOR, limitar la
  cadencia) y **selectores** de dos o tres posiciones para los modos de AUTO 03.
- **La pantallita de arriba** dice qué mando se está moviendo, cuánto vale y, con una barra, por
  dónde va de su recorrido. Al soltar vuelve a lo suyo.

### Los demás módulos: la misma placa

SONO, WMP, FUSION, GLITCH y FLOW tenían cada uno su panel de botones y deslizadores (el de
GLITCH, con desplazamiento y un panel «Fine Tune» plegado). Ahora cada panel es una placa del
mismo aparato, entre el visor y los botones:

| Módulo | Antes | Ahora |
|---|---|---|
| SONO | 3 deslizadores, 8 botones, 266 px | 3 perillas, 2 interruptores y 4 teclas; el piloto de nivel va en la placa |
| WMP | 2 deslizadores, 8 botones | 2 perillas y 8 teclas; el visor ya no queda tapado por el panel |
| FUSION | 1 deslizador, 8 botones | 1 perilla y 8 teclas |
| GLITCH | 10 deslizadores en un panel plegado, con desplazamiento | 2 páginas: MODO (preajustes, paleta, formato) y DETALLE (10 perillas) |
| FLOW | 5 deslizadores en un panel sobre la imagen | 5 perillas en una fila |

### Cómo está hecho (y por qué no cambia lo que hace cada ajuste)

No se ha reescrito ningún ajuste. Cada perilla, interruptor o tecla gobierna el mando que ya
existía —su `<input>` o su botón, que siguen en la página, ocultos—, así que lo que cada uno
hace, guarda y restaura es lo de antes. `docs/console.js` monta las piezas, `docs/console.css`
las pinta; las placas de los demás módulos se describen en una tabla (`RACKS`) al final de
`console.js`: añadir otro panel es añadir una línea.

## 2 · La carcasa

Todas las piezas son renders (Blender, Cycles) con la misma luz, arriba a la izquierda. Los
guiones están en `design/camera-body/`: `build.py` (carcasa y piezas de plástico), `panel.py`
(placa, perillas, teclas e interruptor de la consola), `body.sh` y `console.sh` (lo renderizan
todo y lo dejan en `docs/body/`).

- **Consola**: placa de aluminio anodizado en grafito, cepillada, con sus cuatro tornillos;
  perillas de aluminio torneado con el canto moleteado y la cara cepillada en círculo; la raya
  indicadora es una ranura rellena de pintura coral con el filo oscuro, para que se lea caiga
  donde caiga el brillo; teclas bajas con piloto; interruptor de ranura cromada y botón estriado.
- **Teclas, botones redondos y disparador**: renderizados de nuevo con una ventana de luz en los
  reflejos (el brillo nítido de una foto de producto), ABS con algo de lustre y la junta con la
  carcasa como una rendija en sombra en vez de un filete de color. Al doble de resolución que
  antes en pantallas densas.
- **Carcasa**: el plástico ya no es un color liso. Lleva el grano del molde, la luz le cae desde
  arriba a la izquierda y el canto la recoge.
- **Bandeja de cámaras**: cada cámara es una tecla baja con su muestra tras un cristal.
- **Interruptor FOTO/VÍDEO** (y los de STAGE): la ranura cromada y el botón de aluminio de la
  consola.
- **Barra de guardar** (SONO, GLITCH, ASCII…): sin banda propia, sobre la carcasa, y sus botones
  son las mismas teclas renderizadas. De paso deja de aplicar un desenfoque de fondo que ya no
  hacía nada y costaba gráfica. El aviso de micrófono de SONO, que seguía en inglés y sin
  estilo, ahora es del aparato.
- **Costuras**. Las teclas se dibujan cortando una imagen en nueve trozos, y entre trozo y trozo
  el navegador dejaba pasar una raya del fondo (se veía en las teclas de color a ciertas
  densidades de pantalla). Ahora cada tecla se dibuja dos veces con el corte desplazado, de modo
  que bajo cada junta hay tecla; y el cristal del visor llega hasta debajo del aro del marco.

## 3 · Pruebas

`tests/console.cjs` (nueva, en la batería) comprueba lo que promete esta pasada: que en cada
sección de cada cámara todo cabe en la placa, sin desplazamiento y sin pisar el visor; los
gestos (girar, dos toques, interruptor, selector, teclas, LISTO, Escape) y la pantallita; y que
en SONO, WMP, FUSION, GLITCH y FLOW hay una perilla por deslizador, nada se desplaza y girar o
pulsar cambia el módulo.

Tres pruebas usaban la hoja antigua y se han adaptado a la consola: `alpha-flows.cjs`,
`feel.cjs` (las muescas se oyen al girar una perilla) y `vfd-crt.cjs` (los formatos están en la
sección CUADRO).

La batería completa (`tests/run-all.cjs`, 15 pruebas) pasa. Fuera de ella pasan también
`update-cache.cjs` (la versión nueva del service worker guarda sus 91 archivos, byte a byte) y dos
recorridos de toques al azar (`explore.cjs`, semillas 7 y 23). En WebKit, con forma de iPhone, la
consola abre, una perilla gira y la pantallita lo dice, y las placas de SONO y GLITCH se montan,
sin errores de página.

Una vez, en la primera pasada de la batería, falló la medida de tempo de `stage.cjs` (102,5 donde
espera ≈120). Repetida sola y en la batería final, pasa. No toca nada de esta pasada y no he
averiguado por qué falló esa vez: es una medida que depende del reloj.

## 4 · Sin hacer y sin verificar

- **En un teléfono de verdad.** Todo esto está visto en un Pixel emulado en el ordenador. Falta
  el dedo: si las perillas tienen el tamaño y el recorrido cómodos, si 170 px de arrastre para
  el recorrido entero es mucho o poco, y cómo se ve el grano de la carcasa en la pantalla real.
- **ASCII, UPLOAD y EDIT** siguen con sus paneles de siempre (ASCII tiene 16 deslizadores en un
  panel con desplazamiento). Son el siguiente paso natural: el mismo sistema de placas, pero
  ASCII necesita además selectores para sus listas y un sitio para las tintas.
- **El tamaño de una pegatina** (en la página PEGATINAS, con una pegatina elegida) sigue siendo
  un deslizador.
- **Las perillas de STAGE** y las teclas de la hoja de formato y audio son las de antes: valen,
  pero no tienen el acabado nuevo.
- **Safari.** La batería pasa la prueba de humo en WebKit; la consola no se ha recorrido a mano
  en un iPhone.
