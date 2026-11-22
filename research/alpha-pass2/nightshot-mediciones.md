# Mediciones sobre fotogramas reales de NightShot (22-nov-2026)

Fuente: miniaturas automáticas de vídeos publicados en YouTube (480 × 360, JPEG; son cuadros del propio
vídeo al 25, 50 y 75 % de su duración). Sirven para tono, niveles y caída radial; no para el grano,
que la compresión borra. El modelo de cámara es el que declara el título de cada vídeo.

| Archivo | Vídeo | Cámara según el título |
|---|---|---|
| `3rQzW8zlDL0_hq1…3` | https://www.youtube.com/watch?v=3rQzW8zlDL0 | Sony TRV-110E, NightShot en interior a oscuras |
| `LW4D3Ao4sVM_hq1, hq3` | https://www.youtube.com/watch?v=LW4D3Ao4sVM | Sony DCR-SR45, «Night Vision Test» |
| `izIBVlBUcgk_hq2, hqdefault` | https://www.youtube.com/watch?v=izIBVlBUcgk | Sony Hi8 (CCD-TRV87), sótano con NightShot |
| `Gq3Hyglwp0c_hq2` | https://www.youtube.com/watch?v=Gq3Hyglwp0c | Sony CCD-TRV328, prueba de NightShot |
| `3Q9WnPU8mig_hq3`, `cHDP8ptP4aw_hq3` | https://www.youtube.com/watch?v=3Q9WnPU8mig · https://www.youtube.com/watch?v=cHDP8ptP4aw | Hi8 con NightShot a plena luz |

Las miniaturas se obtienen de `https://i.ytimg.com/vi/<id>/hq1.jpg` (también `hq2`, `hq3`, `hqdefault`).
Para repetir la medición: `node measure-ref.cjs <imagen>…` (necesita ffmpeg).

Cada línea da, por zona de luminancia, el porcentaje del cuadro, el color medio y las razones R/G y B/G.
«Anillos» es la luminancia media en cinco coronas del centro a la esquina.

```
3rQzW8zlDL0_hq1.jpg  recorte 480x359  p1/p5/p50/p95/p99 = 19/24/40/161/180  anillos centro→esquina = 156 91 47 34 27
   L 0-30      20.1%  rgb(24,26,26)  R/G 0.91  B/G 0.98
   L 30-70     60.2%  rgb(37,45,43)  R/G 0.83  B/G 0.95
   L 70-120     8.3%  rgb(73,99,87)  R/G 0.74  B/G 0.88
   L 120-180   10.4%  rgb(124,170,146)  R/G 0.73  B/G 0.86
   L 180-256      1%  rgb(152,207,177)  R/G 0.73  B/G 0.85

3rQzW8zlDL0_hq2.jpg  recorte 480x360  p1/p5/p50/p95/p99 = 14/19/42/204/244  anillos centro→esquina = 125 112 68 39 30
   L 0-30      30.8%  rgb(21,24,23)  R/G 0.89  B/G 0.98
   L 30-70     38.6%  rgb(38,48,45)  R/G 0.8  B/G 0.93
   L 70-120    14.6%  rgb(77,102,91)  R/G 0.75  B/G 0.89
   L 120-180      9%  rgb(120,160,140)  R/G 0.75  B/G 0.88
   L 180-256      7%  rgb(190,237,216)  R/G 0.8  B/G 0.91

3rQzW8zlDL0_hq3.jpg  recorte 480x360  p1/p5/p50/p95/p99 = 9/16/30/122/155  anillos centro→esquina = 104 65 37 27 22
   L 0-30      49.1%  rgb(21,22,23)  R/G 0.99  B/G 1.07
   L 30-70     37.4%  rgb(38,46,43)  R/G 0.84  B/G 0.95
   L 70-120     8.4%  rgb(76,102,89)  R/G 0.75  B/G 0.88
   L 120-180    5.1%  rgb(115,157,135)  R/G 0.74  B/G 0.86

LW4D3Ao4sVM_hq1.jpg  recorte 480x275  p1/p5/p50/p95/p99 = 2/16/39/154/182  anillos centro→esquina = 86 85 60 35 22
   L 0-30        38%  rgb(16,22,22)  R/G 0.74  B/G 1
   L 30-70     36.6%  rgb(37,50,53)  R/G 0.73  B/G 1.05
   L 70-120    14.4%  rgb(74,96,102)  R/G 0.77  B/G 1.06
   L 120-180   10.1%  rgb(126,156,166)  R/G 0.8  B/G 1.06
   L 180-256    1.1%  rgb(178,211,219)  R/G 0.84  B/G 1.04

LW4D3Ao4sVM_hq3.jpg  recorte 480x280  p1/p5/p50/p95/p99 = 1/14/37/158/188  anillos centro→esquina = 75 71 63 40 20
   L 0-30      39.4%  rgb(14,22,25)  R/G 0.64  B/G 1.16
   L 30-70       36%  rgb(32,50,59)  R/G 0.63  B/G 1.18
   L 70-120    13.6%  rgb(67,97,114)  R/G 0.69  B/G 1.18
   L 120-180    9.2%  rgb(115,159,185)  R/G 0.72  B/G 1.17
   L 180-256    1.8%  rgb(160,209,234)  R/G 0.77  B/G 1.12

izIBVlBUcgk_hq2.jpg  recorte 469x273  p1/p5/p50/p95/p99 = 3/6/41/222/238  anillos centro→esquina = 211 133 57 20 9
   L 0-30        46%  rgb(10,11,11)  R/G 0.87  B/G 0.94
   L 30-70     19.7%  rgb(40,60,48)  R/G 0.68  B/G 0.81
   L 70-120    16.3%  rgb(63,107,80)  R/G 0.59  B/G 0.75
   L 120-180    7.5%  rgb(97,175,127)  R/G 0.55  B/G 0.73
   L 180-256   10.5%  rgb(161,248,207)  R/G 0.65  B/G 0.83

izIBVlBUcgk_hqdefault.jpg  recorte 480x276  p1/p5/p50/p95/p99 = 1/14/50/194/218  anillos centro→esquina = 139 100 66 52 35
   L 0-30      25.2%  rgb(15,23,17)  R/G 0.65  B/G 0.76
   L 30-70     39.3%  rgb(35,54,41)  R/G 0.64  B/G 0.76
   L 70-120    18.5%  rgb(65,110,79)  R/G 0.59  B/G 0.72
   L 120-180   10.5%  rgb(100,174,124)  R/G 0.58  B/G 0.71
   L 180-256    6.4%  rgb(148,242,176)  R/G 0.61  B/G 0.73

Gq3Hyglwp0c_hq2.jpg  recorte 478x270  p1/p5/p50/p95/p99 = 11/20/32/67/90  anillos centro→esquina = 46 47 37 30 25
   L 0-30        40%  rgb(23,23,24)  R/G 1  B/G 1.03
   L 30-70     55.8%  rgb(40,42,44)  R/G 0.95  B/G 1.04
   L 70-120     4.2%  rgb(78,86,88)  R/G 0.9  B/G 1.02

3Q9WnPU8mig_hq3.jpg  recorte 480x360  p1/p5/p50/p95/p99 = 1/47/157/252/253  anillos centro→esquina = 104 128 154 152 128
   L 0-30       3.1%  rgb(6,7,3)  R/G 0.87  B/G 0.48
   L 30-70     22.9%  rgb(56,63,48)  R/G 0.89  B/G 0.76
   L 70-120    17.3%  rgb(83,91,70)  R/G 0.91  B/G 0.77
   L 120-180   17.1%  rgb(157,164,133)  R/G 0.96  B/G 0.81
   L 180-256   39.7%  rgb(220,225,194)  R/G 0.98  B/G 0.86

cHDP8ptP4aw_hq3.jpg  recorte 480x359  p1/p5/p50/p95/p99 = 42/64/112/136/141  anillos centro→esquina = 95 86 100 123 106
   L 0-30       0.2%  rgb(17,33,19)  R/G 0.51  B/G 0.59
   L 30-70     10.1%  rgb(52,66,54)  R/G 0.79  B/G 0.82
   L 70-120    50.3%  rgb(83,105,87)  R/G 0.79  B/G 0.83
   L 120-180   39.4%  rgb(111,142,115)  R/G 0.78  B/G 0.81
```

## Lectura

- **Tinte.** Verde en la Hi8 (B/G 0,71–0,83), verde azulado en la TRV-110E (0,86–0,91), cian en la SR45
  (1,0–1,18), casi neutro en la TRV328 y verde oliva a plena luz. FLIP apunta a R/G 0,63 y B/G 1,00 en
  medios tonos: dentro del rango real, hacia el lado azul que pide la dirección artística.
- **Saturación por tono.** Sombras casi neutras, medios tonos con el tinte más marcado, altas luces pálidas
  (R/G sube a 0,77–0,84).
- **Niveles.** Percentil 50 entre 30 y 50 de 255: la mayor parte del cuadro es oscura. Percentil 95 entre
  120 y 220. El percentil 5 no baja de 14–24: el negro del vídeo analógico está levantado. FLIP lo deja
  más profundo (5/255) a propósito.
- **Punto caliente.** Centro 4–5 veces más claro que las esquinas en interiores; hasta 23 veces con la
  cámara pegada a una pared.
- **No medido aquí.** Smear vertical y ruido: son rasgos generales de los CCD interlínea con ganancia alta
  que estas miniaturas no permiten cuantificar.
