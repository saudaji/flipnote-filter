# Referencia física · AUTO 03 NIGHT (notas de investigación, 22-nov-2026)

Salida de un subagente de búsqueda web. UNCONFIRMED = sin fuente. Las mediciones propias sobre fotogramas reales van en `MEDICIONES.md` de esta carpeta.

## Familia de referencia
Sony Digital8 DCR-TRV240 / TRV340 / TRV350 (2002-03); alternativa MiniDV DCR-TRV17/TRV18.
- Sony Japón lista Super NightShot y Color Slow Shutter por modelo: https://www.sony.jp/products/Consumer/VD/dictionary/point03.html
- 0 lux en NightShot (4 lux normal en TRV340): https://www.manualsdir.ru/manuals/4294/sony-dcr-trv740e-dcr-trv341e-dcr-trv240e-dcr-trv241e-dcr-trv340e.html?page=269
- NightShot Light: infrarrojo invisible, alcance ≈3 m (10 ft), N.S.LIGHT ON por defecto: https://archive.org/stream/sony-handycam-video-hi8-ccd-trv138-trv338-digital8-dcr-trv280-camera-operations-guide/25152591M_djvu.txt · https://www.manualsdir.com/manuals/445212/sony-dcr-trv740.html?page=30
- Longitud de onda del emisor: UNCONFIRMED.
- Mecanismo: se retira el filtro de corte IR y la lámpara IR emite luz que el CCD ve (Sony Japón, arriba).
- Super NightShot: hasta 16× más brillo que NightShot; obturador automático entre 1/60 s y 1/4 s; «el movimiento puede ralentizarse» y «dejar imágenes residuales»: https://www.manualsdir.com/manuals/444274/sony-dcr-trv250.html?page=39
- Color Slow Shutter: color en penumbra, no a 0 lux; mismo obturador lento.
- Sensor: CCD 1/6", 460k brutos / 290k efectivos; resolución medida 395 líneas (TRV350), 405 (TRV17): https://www.videomaker.com/article/9491-digital8-camcorder-review-sony-dcr-trv350/ · https://www.videomaker.com/article/c5/8666-sony-dcr-trv17-night-vision-camcorder-review/
- Visor B/N de 113k píxeles; LCD 2,5" de 123k.

## Rasgos por origen
**Sensor.** Sensibilidad al IR cercano sin filtro; Sony: los colores «pueden no reproducirse bien». Grano (reseña Panasonic 0 lux: «grainy»). El IR enfoca en otro plano ⇒ imagen blanda, autofoco lento: https://notpurfect.com/main/nightcam.html. Smear vertical y blooming con luces puntuales: UNCONFIRMED en fuentes (rasgo general de CCD interlínea).

**Iluminador.** «Cuadro central brillante» donde el haz IR es más fuerte (Videomaker, TRV17). Alcance 3 m según Sony. Brillo de ojos documentado en una Panasonic IR («como ciervos ante los faros»); UNCONFIRMED en Sony. Follaje mucho más claro en IR: https://yceo.yale.edu/node/56

**Procesado en cámara.** NightShot estándar = «monocromo verde» / «teñido de verde»; el verde se quita con los efectos B&W o Sepia ⇒ es un tinte aplicado sobre señal monocroma. Tono y saturación exactos UNCONFIRMED. Super NightShot «ligeramente sepia» y con «slur» molesto (una reseña). Realce de bordes y AGC: UNCONFIRMED.

**Grabación / pantalla.** Entrelazado estándar del formato. Indicador en pantalla: icono + «NIGHTSHOT» parpadeando; «SUPER NIGHTSHOT»; Digital8 mostraba «NIGHTSHOT PLUS». Tipografía y posición UNCONFIRMED.

## Casos de contraste
- JVC NightAlive: obturador lento digital en color, sin IR; estelas en sujetos rápidos. https://support.jvc.com/consumer/products/glossary.jsp?gId=121
- Panasonic MagicPix: obturador muy lento en color; su modo 0 lux es IR y granulado. https://www.videomaker.com/article/c5/8692-test-bench-panasonic-pv-dv701-mini-dv-camcorder/

## Nota de color
Ninguna fuente describe un modo nocturno de consumo como azul verdoso o cian: todas dicen verde, y el visor de la TRV350 es B/N. El tinte azul verdoso de FLIP es una desviación artística deliberada.

## Material candidato para medir
- https://notpurfect.com/main/nightcam.html (nsx1.jpg / nsx2.jpg, pasillo con NightShot)
- http://sonydigitalstillcamera.blogspot.com/2012/01/sony-hi8-nightshot-vision-infrared-test.html (CCD-TR940)
- https://www.youtube.com/watch?v=cHDP8ptP4aw («X-Ray Sony Hi8 Nightshot»)
- https://maxmax.com/aXRaySonyExamples.htm (diurnas, follaje)
