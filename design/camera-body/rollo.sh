#!/bin/sh
# Renderiza los materiales de la marca «Rollo en añil» (docs/brand/rollo-en-anil/identidad.json) y
# los deja en docs/brand/rollo-en-anil/materiales/ como WebP: teclas y botones en añil, mandarina,
# lima y rojo de grabar, el disparador con su aro anodizado añil, y la carcasa en ABS perla y en
# su variante oscura.
#   sh design/camera-body/rollo.sh [carpeta-de-trabajo]
# Necesita Blender (por defecto el de /Applications) y lo mismo que finish.cjs (playwright-core, cwebp).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-/tmp/flip-rollo}"
DEST="$HERE/../../docs/brand/rollo-en-anil/materiales"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
mkdir -p "$OUT"
PERLA="c_cream=#EDE5D8"
LOOK="scale=4 samples=128 strip=7 key_rough=0.36 key_coat=0.35 well=#4E4A3E gap=1.2 $PERLA"
r() { out="$OUT/$1.png"; kind="$2"; shift 2; "$BLENDER" -b -P "$HERE/build.py" -- "$kind" "$out" $LOOK "$@" 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true; }
k() { out="$OUT/$1.png"; shift; "$BLENDER" -b -P "$HERE/panel.py" -- key "$out" scale=4 strip=7 key_rough=0.36 key_coat=0.35 well=#4E4A3E "$@" 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true; }
# Teclas: la añil de «elegido» y de acción principal; el selector de módulo es la misma pieza.
r tecla-anil keycap color=anil
r tecla-anil-pulsada keycap color=anil state=down
cp "$OUT/tecla-anil.png" "$OUT/selector-anil.png"
cp "$OUT/tecla-anil-pulsada.png" "$OUT/selector-anil-pulsado.png"
# Botones redondos de policarbonato.
for color in anil mandarina lima rec; do
  r "boton-$color" candy color=$color
  r "boton-$color-pulsado" candy color=$color state=down
done
# Disparador: tapa de PBT vainilla en aro de aluminio anodizado añil; disco rojo en vídeo.
SHUTTER="dip=5.4 cap_white=#EBE3D0 cap_video=rec gloss_rough=0.34 ring=#2A3F9F ring_rough=0.34"
r disparador-anil shutter $SHUTTER
r disparador-anil-pulsado shutter state=down $SHUTTER
r disparador-video shutter cap=video $SHUTTER
r disparador-video-pulsado shutter cap=video state=down $SHUTTER
# La diapositiva elegida de la bandeja de cámaras y la tecla LISTO de la consola.
k perfil-anil w=64 h=54 samples=128 color=anil $PERLA
k tecla-consola-anil w=62 h=30 samples=160 color=anil finish=graphite
k tecla-consola-anil-pulsada w=62 h=30 samples=160 color=anil finish=graphite state=down
# Teclas en reposo de PBT vainilla (la normal y la diapositiva de la bandeja) y la miel del tempo.
r tecla keycap color=vainilla
r tecla-pulsada keycap color=vainilla state=down
r tecla-miel keycap color=#E9BC4D
r tecla-miel-pulsada keycap color=#E9BC4D state=down
k perfil w=64 h=54 samples=128 color=vainilla $PERLA
k perfil-pulsado w=64 h=54 samples=128 color=vainilla state=down $PERLA
# Perillas de aluminio anodizado humo violeta, con la marca de lectura clara: la de la consola
# (cuerpo y marca aparte, que es la que gira) y la de STAGE.
KNOB="scale=4 samples=160 sheen=0.3 ambient=0.38 key=1.4 face_rough=0.27 finish=graphite anod=#A39CC4 mark=#FFF3DC"
p() { out="$OUT/$1.png"; kind="$2"; shift 2; "$BLENDER" -b -P "$HERE/panel.py" -- "$kind" "$out" $KNOB "$@" 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true; }
p perilla-humo knob ticks=0
p perilla-marca mark
r dial-humo dial color=humo c_humo=#8C85AE
node "$HERE/finish.cjs" "$OUT" "$DEST"
# La carcasa, sin serigrafía (la marca va en su placa), clara y oscura.
shell() { "$BLENDER" -b -P "$HERE/build.py" -- shell "$OUT/.$1.png" scale=4 samples=192 radius=22 model=0 "c_cream=$2" $3 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true; }
shell shell '#EDE5D8'
shell shell-plain '#EDE5D8' plain=1
python3 "$HERE/shell.py" "$OUT/.shell.png" "$OUT/.shell-plain.png" "$DEST" 4
# (la base va más oscura que #232946: con la luz encima el plástico queda en ese tono)
shell shell-oscuro '#181C36'
shell shell-oscuro-plain '#181C36' plain=1
python3 "$HERE/shell.py" "$OUT/.shell-oscuro.png" "$OUT/.shell-oscuro-plain.png" "$DEST" 4 -oscuro
# Los marcos hundidos de la carcasa oscura salen de los de crema (mismo modelado, otro plástico).
for n in bezel tray lcd; do
  python3 "$HERE/oscuro.py" "$HERE/../../docs/body/$n.webp" "$OUT/.$n-oscuro.png" '#E7E0CF' '#2D314D'
  cwebp -quiet -q 92 -alpha_q 100 -m 6 "$OUT/.$n-oscuro.png" -o "$DEST/$n-oscuro.webp"
done
