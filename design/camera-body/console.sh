#!/bin/sh
# Renderiza todas las piezas de la consola de ajustes y las deja en docs/body/ como WebP.
#   sh design/camera-body/console.sh [carpeta-de-trabajo]
# Necesita Blender (por defecto el de /Applications) y lo mismo que finish.cjs (playwright-core, cwebp).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-/tmp/flip-console}"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
mkdir -p "$OUT"
piece() { name="$1"; shift; "$BLENDER" -b -P "$HERE/panel.py" -- "$@" | grep -E "RENDER_OK|Error|Traceback" || true; }
r() { out="$OUT/$1.png"; kind="$2"; shift 2; "$BLENDER" -b -P "$HERE/panel.py" -- "$kind" "$out" finish=graphite "$@" 2>&1 | grep -E "RENDER_OK|Error|Traceback" || true; }
# La placa: aluminio anodizado en grafito, cepillado, con sus cuatro tornillos.
r console-plate plate w=384 h=240 scale=3 samples=192
# Perillas: la luz se estrecha para que la cara torneada dé su brillo en abanico.
KNOB="scale=4 samples=160 sheen=0.3 ambient=0.38 key=1.4 face_rough=0.27"
r console-knob knob $KNOB ticks=11 sweep=270
r console-sel3 knob $KNOB ticks=3 sweep=100
r console-sel2 knob $KNOB ticks=2 sweep=70
r console-mark mark $KNOB
# Interruptor deslizante: la ranura y, aparte, el botón que corre por ella.
r console-slide slide scale=4 samples=160
r console-nub nub scale=4 samples=160
# Teclas: grafito con piloto (apagado y encendido, arriba y pulsada) y la coral de LISTO.
for led in off on; do
  suffix=""; [ "$led" = "on" ] && suffix="-on"
  r "console-key$suffix" key w=62 h=30 scale=4 samples=160 color=graphite led=$led
  r "console-key-down$suffix" key w=62 h=30 scale=4 samples=160 color=graphite led=$led state=down
done
r console-key-coral key w=62 h=30 scale=4 samples=160 color=coral
r console-key-coral-down key w=62 h=30 scale=4 samples=160 color=coral state=down
node "$HERE/finish.cjs" "$OUT" "$HERE/../../docs/body"
