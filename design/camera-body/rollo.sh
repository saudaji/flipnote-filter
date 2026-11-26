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
# El color de marca de las piezas «añil» es hoy un verde esmeralda (25-nov-2026). Las piezas y sus
# archivos conservan el nombre «anil» (es el nombre del papel que hacen: la tecla elegida, la acción
# principal), y aquí se les da el color.
VERDE="c_anil=#008048"
LOOK="scale=4 samples=128 strip=7 key_rough=0.36 key_coat=0.35 well=#4E4A3E gap=1.2 $PERLA $VERDE"
r() { out="$OUT/$1.png"; kind="$2"; shift 2; "$BLENDER" -b -P "$HERE/build.py" -- "$kind" "$out" $LOOK "$@" 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true; }
k() { out="$OUT/$1.png"; shift; "$BLENDER" -b -P "$HERE/panel.py" -- key "$out" scale=4 strip=7 key_rough=0.36 key_coat=0.35 well=#4E4A3E $VERDE "$@" 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true; }
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
# Disparador: la mascota de FLIP en volumen (la silueta del símbolo, de plástico lustroso verde, con
# sus ojos). Pulsada cierra el ojo; en video la pupila es roja; grabando no lleva cara (la interfaz
# pone encima el cuadrado de detener).
MASCOTA="gloss_rough=0.34 samples=192"
r disparador-mascota mascota $MASCOTA
r disparador-mascota-pulsado mascota state=down $MASCOTA
r disparador-mascota-video mascota cap=video $MASCOTA
r disparador-mascota-grabando mascota state=down face=0 c_anil=#F54846 $MASCOTA
# La misma mascota por capas, para animarla en el disparador de la cámara (mira, guiña, entrecierra
# el ojo): el cuerpo con su guiño, el blanco del ojo, la pupila (oscura y roja) y el ojo cerrado.
r mascota-cuerpo mascota only=cuerpo $MASCOTA
r mascota-cuerpo-pulsado mascota only=cuerpo state=down $MASCOTA
r mascota-ojo mascota only=ojo $MASCOTA
r mascota-pupila mascota only=pupila $MASCOTA
r mascota-pupila-video mascota only=pupila cap=video $MASCOTA
r mascota-ojo-cerrado mascota only=cerrado $MASCOTA
# La sombra de la mascota sale con ruido (es grande y lustrosa): se alisa antes de rematar las piezas.
python3 "$HERE/sombra.py" "$OUT"/disparador-mascota*.png "$OUT"/mascota-cuerpo*.png
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
