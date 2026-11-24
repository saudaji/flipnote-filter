#!/bin/sh
# Renderiza las piezas de plástico de la carcasa —teclas, botones redondos y disparador— y las deja
# en docs/body/ como WebP.
#   sh design/camera-body/body.sh [carpeta-de-trabajo]
# Necesita Blender (por defecto el de /Applications) y lo mismo que finish.cjs (playwright-core, cwebp).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-/tmp/flip-body}"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
mkdir -p "$OUT"
# El acabado: una ventana de luz en los reflejos (el brillo nítido de una foto de producto), ABS
# con algo de lustre en las teclas y la junta con la carcasa como una rendija en sombra.
LOOK="scale=4 samples=128 strip=7 key_rough=0.36 key_coat=0.35 well=#4E4A3E gap=1.2"
r() { out="$OUT/$1.png"; kind="$2"; shift 2; "$BLENDER" -b -P "$HERE/build.py" -- "$kind" "$out" $LOOK "$@" 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true; }
for color in key coral slate gray mustard; do
  r "keycap-$color" keycap color=$color
  r "keycap-$color-down" keycap color=$color state=down
done
for color in coral mustard blue mint lilac graphite slate white; do
  r "candy-$color" candy color=$color
  r "candy-$color-down" candy color=$color state=down
done
# El disparador lleva la tapa cóncava (donde descansa el dedo) y un blanco algo más apagado: es lo
# que deja ver su forma en vez de un círculo blanco plano.
SHUTTER="dip=5.4 cap_white=#E2DFD6 gloss_rough=0.34"
r shutter-photo shutter $SHUTTER
r shutter-photo-down shutter state=down $SHUTTER
r shutter-video shutter cap=video $SHUTTER
r shutter-video-down shutter cap=video state=down $SHUTTER
# La carcasa entera, en tres piezas (más el pie liso de las pantallas interiores).
"$BLENDER" -b -P "$HERE/build.py" -- shell "$OUT/.shell.png" scale=4 samples=192 radius=22 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true
"$BLENDER" -b -P "$HERE/build.py" -- shell "$OUT/.shell-plain.png" scale=4 samples=192 radius=22 plain=1 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true
python3 "$HERE/shell.py" "$OUT/.shell.png" "$OUT/.shell-plain.png" "$HERE/../../docs/body" 4
# Las diapositivas de la bandeja de cámaras: teclas bajas (las de la consola), en crema y en coral.
k() { out="$OUT/$1.png"; shift; "$BLENDER" -b -P "$HERE/panel.py" -- key "$out" w=64 h=54 scale=4 samples=128 strip=7 key_rough=0.36 key_coat=0.35 well=#4E4A3E "$@" 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true; }
k look-key color=key
k look-key-down color=key state=down
k look-key-on color=coral
# El grano de molde de la carcasa (necesita un Python con numpy: el de Blender lo trae).
BPY="$(ls "$(dirname "$BLENDER")"/../Resources/*/python/bin/python3* | head -1)"
"$BPY" "$HERE/grain.py" "$OUT/grain.rgba" 0.12
python3 -c "from PIL import Image; Image.frombytes('RGBA', (256, 256), open('$OUT/grain.rgba', 'rb').read()).save('$OUT/.grain.png')"
cwebp -quiet -lossless -z 9 -exact "$OUT/.grain.png" -o "$HERE/../../docs/body/grain.webp"
node "$HERE/finish.cjs" "$OUT" "$HERE/../../docs/body"
