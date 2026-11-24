# FLIP · octava pasada: tramas para la cámara DSi

Primera de las ideas tomadas del estudio de Dither Boy (un programa de escritorio de tramado): que
la trama no sea una sola, sino un mando.

Rama `fable/public-alpha-pass2`. Sin publicar todavía (caché v89).

## Qué hay

La consola de **DSi · STD** tiene ahora una página CÁMARA con dos perillas:

- **TRAMA**, seis posiciones:
  - **BAYER**: la de siempre, la rejilla ordenada.
  - **ATKINSON**: difusión de error como la del primer Macintosh; blancos limpios y negros llenos.
  - **AZUL**: ruido azul; grano fino, sin dibujo reconocible.
  - **PUNTOS**: punto de imprenta, que crece desde el centro de cada celda.
  - **LÍNEAS**: líneas horizontales que engordan con la sombra, como un grabado.
  - **CRUZ**: rayado en diagonal; la segunda diagonal se suma en los tonos oscuros.
- **TAMAÑO**, de ×1 a ×4: el tamaño de la celda de la trama. A ×2 o ×3 los puntos y las líneas se
  leen como dibujo y no como textura.

DSi ya tenía dos tramas repartidas en sus dos variantes (STD con Bayer y LGCY con difusión de error
de Floyd–Steinberg). LGCY queda como estaba; la perilla es de STD.

## Cómo está hecho

- Las cinco tramas de umbral comparten el bucle de siempre: solo cambia la tabla de umbrales. Las
  de puntos, líneas y cruz se sacan de una «función de punto» ordenando sus celdas, así que cada
  tono enciende su proporción justa de tinta. La de ruido azul es una tabla de 64 × 64 generada
  aparte (ruido filtrado en alta frecuencia e igualado por rango).
- **Estabilidad en vídeo.** Las de umbral no pueden moverse: el umbral de cada punto no cambia de
  un cuadro a otro. La difusión de error sí «hierve» con el ruido de la cámara; Atkinson lleva
  histéresis (el punto que ya era tinta tiende a seguir siéndolo) para que no lo haga.
- **Coste.** Es el mismo trabajo por cuadro que antes (256 × 192 puntos a la cadencia de DSi).
- La foto usa el mismo camino que el visor, así que sale igual. El ajuste se guarda con los demás.
- UPLOAD usa el mismo motor con sus propios mandos y sigue en Bayer.

## Pruebas

`tests/dither.cjs` (nueva, en la batería): con una carta de grises fija, cada trama deja el visor
en dos tintas, pone más tinta cuanto más oscuro, dibuja distinto de las demás y no se mueve con la
imagen quieta (las de umbral, punto a punto; Atkinson, 98,5 % o más); ×2 engorda el dibujo; la
perilla cambia la trama y la pantallita lo dice; la foto coincide con el visor; el ajuste se
conserva al recargar; LGCY y UPLOAD no cambian.

## Sin hacer y sin verificar

- **En un teléfono de verdad**: cómo se ve cada trama con la cámara real y su ruido, sobre todo
  Atkinson en penumbra.
- **El ruido azul** es una aproximación; con una tabla de «vacío y cúmulo» quedaría más fino.
- Lo siguiente de la lista: semitono CMYK como cámara nueva, paletas de varios colores sacadas de
  la cámara, y enlaces que abran FLIP con un estilo cargado.
