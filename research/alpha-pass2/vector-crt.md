# Referencia física · OSCAM VECTOR (notas de investigación, 22-nov-2026)

Salida de un subagente de búsqueda web. Lo marcado UNCONFIRMED no tiene fuente; es juicio de ingeniería.

## Referencia elegida
Osciloscopio analógico Tektronix (clase 5103N / 465) con fósforo P31 y retícula interna, en modo X-Y con blanking por eje Z.
- Fenderson (Oscilloscope Music) usó un Tektronix 5103N: https://www.hackster.io/news/these-genius-musicians-use-music-to-draw-animations-on-oscilloscopes-76d65c9473ce
- P31 + retícula interna (sin paralaje): https://www.qsl.net/iv3cve/hp/an/pdf/an_25.pdf
- Retícula 8×10 divisiones (Tek 485): https://ia801301.us.archive.org/1/items/tektronix_485_r485/485_r485_text.pdf
- Tek 4010 (tubo de almacenamiento) descartado: persiste minutos. https://en.wikipedia.org/wiki/Vector_monitor

## Haz y fósforo
- Modelo de haz de MAME BGFX (referencia plausible): núcleo gaussiano + halo más ancho y débil; sigma del halo = 3,5 × sigma del núcleo; fuerza de halo 0,04; más intensidad ensancha núcleo hasta 12 % y halo hasta 25 %; intensidad comprimida con sqrt; tone-map `1-exp(-L)`. https://docs.mamedev.org/techspecs/bgfx_vector_crt.html
- Brillo ∝ 1/velocidad del haz: vectores largos se ven más tenues. https://en.wikipedia.org/wiki/Vector_monitor · https://github.com/mamedev/mame/issues/399 · https://patents.google.com/patent/US6246389
- Puntos brillantes donde el haz se detiene (extremos, vértices, punto estacionario). MAME da a cada punto longitud mínima max(distancia, ancho de haz, 1 px) y remata con tapas redondas.
- Fósforos: P1 verde ~525 nm 1–100 ms; P7 destello azul 440 nm + resplandor amarillo 558 nm largo; P31 ZnS:Cu verde amarillento 0,01–1 ms; P39 verde largo. https://en.wikipedia.org/wiki/Phosphor
- P31 pico 520 nm; 1,4 % de contraste residual a 50 ms; persistencia percibida discutida (≈2 ms fotómetro vs «varios cientos de ms» percibidos). https://epub.ub.uni-muenchen.de/16122/1/P31.pdf
- Forma de la caída: UNCONFIRMED. MAME usa exp(-dt/tau), tau 2 ms (rango 1–100). Juicio: caída inicial rápida + cola tipo ley de potencia ≈ suma de dos exponenciales.
- Blanking Z entre trazos evita puentes. https://forum.allaboutcircuits.com/threads/vector-graphics-using-a-pic-and-xy-axis-on-my-scope.155253/
- Ancho de banda de deflexión limitado ⇒ esquinas redondeadas, huecos en el contorno. Vectrex ≈20 kHz; Atari 19" 1 MHz pequeña señal. https://e-basteln.de/arcade/asteroids/monitor/
- Parpadeo cuando la lista es larga; Vectrex ~50 cuadros/s; regla de aficionados: ~300 líneas estable, 600 titila, 900 estrobo. https://vectrex.substack.com/p/a-vexxon-retrospective

## Arte previo para dibujar contornos
- Láser (TouchDesigner Laser CHOP): puntos de esquina/hold según ángulo, blanking automático entre formas. https://derivative.ca/UserGuide/Laser_CHOP
- Receta (UNCONFIRMED, juicio): ordenar contornos por vecino más cercano desde la posición del haz (+2-opt), invertir cada contorno para empezar por su extremo más próximo, remuestrear a velocidad constante, dwell en esquinas, saltos apagados, tope de puntos por cuadro descartando primero los contornos más cortos/tenues.

## Señales de falsedad
Brillo uniforme sin dependencia de velocidad; rejilla de píxel visible; glow tipo raster; contornos que hierven porque el orden o el punto de inicio cambia cada cuadro; puentes luminosos entre formas; esquinas perfectamente afiladas.
