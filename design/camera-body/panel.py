# La consola de ajustes de FLIP: placa de aluminio cepillado, perillas torneadas, teclas e
# interruptores, renderizados para la interfaz con la misma escena que el cuerpo (build.py).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P design/camera-body/panel.py -- <pieza> <salida.png> [clave=valor …]
#
# Piezas: study (composición para juzgar materiales), plate, knob, mark, toggle, key, led.
# Una unidad de Blender es un píxel CSS del diseño. Cámara ortográfica cenital; luz de estudio
# arriba a la izquierda. Las piezas sueltas salen con fondo transparente y su sombra de contacto.
import bpy, bmesh, math, sys, os
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B
from build import OPTS, srgb, PALETTE, plastic, gloss, metal, principled, lathe, loft, loop_points, place, link, text, dome, ring, catcher

STATE = OPTS.get('state', 'idle')
FINISH = OPTS.get('finish', 'silver')          # silver | graphite | champagne


# ── Materiales ────────────────────────────────────────────────────────────
def brushed(name, color, rough=0.32, grain=1.0, along='X'):
    """Aluminio cepillado en una dirección: brillo anisótropo y el rayado fino del cepillo."""
    mat = principled(name, **{'Base Color': tuple(color) + (1,), 'Metallic': 1.0, 'Roughness': rough, 'Anisotropic': 0.82,
                              'Anisotropic Rotation': 0.0 if along == 'X' else 0.25})
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (0.012, 2.4, 1.0) if along == 'X' else (2.4, 0.012, 1.0)
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1.0
    noise.inputs['Detail'].default_value = 8
    noise.inputs['Roughness'].default_value = 0.75
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.22 * grain
    bump.inputs['Distance'].default_value = 0.35
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    # El cepillado también varía la aspereza: vetas algo más mates.
    span = nt.nodes.new('ShaderNodeMapRange')
    span.inputs['To Min'].default_value = rough - 0.07
    span.inputs['To Max'].default_value = rough + 0.10
    nt.links.new(noise.outputs['Fac'], span.inputs['Value'])
    nt.links.new(span.outputs['Result'], bsdf.inputs['Roughness'])
    tangent = nt.nodes.new('ShaderNodeTangent')
    tangent.direction_type = 'UV_MAP' if False else 'RADIAL'
    tangent.axis = 'Y' if along == 'X' else 'X'
    nt.links.new(tangent.outputs['Tangent'], bsdf.inputs['Tangent'])
    return mat


FINISHES = {'silver': (0.80, 0.80, 0.79), 'champagne': (0.83, 0.77, 0.64), 'graphite': (0.105, 0.108, 0.115)}


def plate_metal():
    color = FINISHES.get(FINISH, FINISHES['silver'])
    return brushed('plate_' + FINISH, color, 0.36 if FINISH != 'graphite' else 0.42, 1.0)


def ink():
    return plastic('#1B1C1E' if FINISH != 'graphite' else '#E9E3D2', 0.55, 0)


# ── Piezas ──────────────────────────────────────────────────────────────
def screw(x, y, z=0.0, radius=3.6):
    """Tornillo de cabeza avellanada con ranura en cruz, girado al azar como en un aparato de verdad."""
    steel = metal('steel', (0.62, 0.63, 0.65), 0.3, aniso=0.5, radial=True)
    dark = plastic('graphite', 0.7, 0)
    angle = (hash((round(x), round(y))) % 180) * math.pi / 180
    head = lathe('screw', [(0, z + 0.55), (radius * 0.72, z + 0.55), (radius, z + 0.2), (radius, z - 0.6), (0, z - 0.6)], 0, steel, segments=48)
    a = loft('sl_a', [(loop_points(radius * 1.5, 0.95, 0.3), z + 0.25), (loop_points(radius * 1.5, 0.95, 0.3), z + 0.6)], dark, cap_top=0.0)
    b = loft('sl_b', [(loop_points(0.95, radius * 1.5, 0.3), z + 0.25), (loop_points(0.95, radius * 1.5, 0.3), z + 0.6)], dark, cap_top=0.0)
    for part in (head, a, b):
        part.rotation_euler.z = angle
        place(part, x, y)
    return [head, a, b]


def plate(w, h, lcd=None, screws=True):
    """Placa frontal: aluminio cepillado de 2 mm con el canto biselado, atornillada por las esquinas.
    lcd = (x, y, ancho, alto): ventana de la pantalla, con su marco negro hundido."""
    mat = plate_metal()
    slab = loft('plate', [(loop_points(w, h, 5.0), 0.0), (loop_points(w, h, 5.0), 1.6), (loop_points(w - 1.4, h - 1.4, 4.4), 2.3)], mat, cap_top=0.0)
    cutters = []
    if lcd:
        lx, ly, lw, lh = lcd
        cutters.append(place(loft('lcdcut', [(loop_points(lw, lh, 3.0), -4.0), (loop_points(lw, lh, 3.0), 4.0)], None, cap_top=0.0, cap_bottom=True), lx, ly))
    holes = [(sx * (w / 2 - 9), sy * (h / 2 - 9)) for sx in (-1, 1) for sy in (-1, 1)] if screws else []
    for hx, hy in holes:
        cutters.append(place(lathe('hole', [(0, 4.0), (4.2, 4.0), (4.2, 1.3), (0, 1.3)], 0, None, segments=48), hx, hy))
    bpy.context.view_layer.objects.active = slab
    for index, cutter in enumerate(cutters):
        mod = slab.modifiers.new('cut%d' % index, 'BOOLEAN')
        mod.object = cutter
        mod.operation = 'DIFFERENCE'
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for cutter in cutters:
        bpy.data.objects.remove(cutter)
    try:
        slab.data.set_sharp_from_angle(angle=math.radians(35))
    except Exception:
        pass
    parts = [slab]
    for hx, hy in holes:
        parts += screw(hx, hy, 1.5)
    if lcd:
        lx, ly, lw, lh = lcd
        # Marco de la pantalla: una pared negra que baja hasta el cristal.
        parts.append(place(loft('lcd_wall', [(loop_points(lw, lh, 3.0), 2.2), (loop_points(lw - 5, lh - 5, 1.6), -1.2)], plastic('#101113', 0.45, 0)), lx, ly))
    return parts


def knob(x, y, radius=24, mark=True, body=True):
    """Perilla de aluminio torneado: falda negra, cuerpo moleteado fino, canto biselado y cara
    cóncava cepillada en círculo. La raya indicadora va aparte (mark) para que gire en la interfaz."""
    parts = []
    if body:
        # anod=#hex: aluminio anodizado en ese color (cuerpo y cara); el bisel queda algo más claro,
        # que es donde el torno deja el metal más vivo.
        anod = srgb(OPTS['anod']) if 'anod' in OPTS else None
        lift = lambda c, k: tuple(min(1.0, v * k + 0.02) for v in c)
        side = metal('kn_side', lift(anod, 1.0) if anod else (0.74, 0.75, 0.76), 0.3, knurl=float(OPTS.get('knurl', 72)))
        face = metal('kn_face', lift(anod, 1.08) if anod else (0.72, 0.73, 0.745), float(OPTS.get('face_rough', 0.2)), aniso=0.96, radial=True)
        edge = metal('kn_edge', lift(anod, 1.9) if anod else (0.9, 0.9, 0.91), 0.12)
        parts += [
            lathe('kn_skirt', [(radius + 3.8, 0.0), (radius + 3.8, 1.5), (radius + 2.8, 2.5), (radius - 0.5, 2.7)], 0, principled('kn_skirt', **{'Base Color': (0.016, 0.017, 0.019, 1), 'Roughness': 0.34, 'Coat Weight': 0.4})),
            lathe('kn_body', [(radius, 2.5), (radius, 17.0)], 0, side),
            lathe('kn_bevel', [(radius, 17.0), (radius - 0.45, 18.3), (radius - 1.9, 19.4), (radius - 2.6, 19.4)], 0, edge),
            lathe('kn_groove', [(radius - 2.6, 19.4), (radius - 2.9, 18.6), (radius - 3.5, 18.6), (radius - 3.8, 19.1)], 0, plastic('#0B0B0C', 0.6, 0)),
            lathe('kn_dish', [(radius - 3.8, 19.1), (radius * 0.6, 18.6), (0, 18.45)], 0, face),
        ]
    if mark:
        # Raya indicadora: una ranura fresada en la cara y rellena de pintura coral. El filo oscuro de
        # la ranura la recorta sobre el aluminio, caiga donde caiga el brillo de la cara torneada.
        slot = principled('kn_slot', **{'Base Color': (0.008, 0.008, 0.01, 1), 'Roughness': 0.55})
        paint = principled('kn_paint', **{'Base Color': srgb(OPTS.get('mark', '#F2553B')) + (1,), 'Roughness': 0.34, 'Coat Weight': 0.5, 'Coat Roughness': 0.1})
        length = radius - 8.4
        for name, width, grow, z0, z1, mat in (('kn_slot', 4.0, 1.5, 18.35, 18.95, slot), ('kn_mark', 2.5, 0.0, 18.5, 19.2, paint)):
            line = loft(name, [(loop_points(width, length + grow, width / 2 - 0.1), z0), (loop_points(width, length + grow, width / 2 - 0.1), z1)], mat, cap_top=0.0)
            line.location.y += length / 2 + 4.2
            parts.append(line)
    for part in parts:
        place(part, x, y)
    return parts


def ticks(x, y, radius=24, count=None, sweep=None):
    """Escala serigrafiada alrededor de la perilla: rayas de -135° a +135°, las de los extremos y el centro más largas."""
    count = int(OPTS.get('ticks', 11)) if count is None else count
    sweep = float(OPTS.get('sweep', 270)) if sweep is None else sweep
    mat = ink()
    out = []
    for i in range(count):
        angle = math.radians(90 + sweep / 2 - sweep * i / (count - 1))
        major = i in (0, count // 2, count - 1) or count <= 5
        length = 4.6 if major else 2.8
        r = radius + 7.4 + length / 2
        tick = loft('tick', [(loop_points(length, 1.05 if major else 0.8, 0.2), 2.32), (loop_points(length, 1.05 if major else 0.8, 0.2), 2.36)], mat, cap_top=0.0)
        tick.rotation_euler.z = angle
        place(tick, x + r * math.cos(angle), y + r * math.sin(angle))
        out.append(tick)
    return out


def toggle(x, y, on=True):
    """Interruptor de palanca: tuerca hexagonal, casquillo y palanca cromada en bate, inclinada."""
    chrome = metal('chrome', (0.9, 0.9, 0.91), 0.08)
    nut = metal('nut', (0.72, 0.73, 0.75), 0.3)
    parts = [
        lathe('tg_washer', [(0, 2.3), (9.6, 2.3), (9.6, 2.9), (7.4, 2.9)], 0, metal('washer', (0.7, 0.71, 0.72), 0.36)),
        lathe('tg_nut', [(7.6, 2.8), (7.6, 5.4), (6.6, 6.0), (4.4, 6.0)], 0, nut, segments=6),
        lathe('tg_bush', [(4.6, 5.8), (4.6, 8.4), (3.9, 9.0), (2.6, 9.0)], 0, metal('bush', (0.8, 0.81, 0.82), 0.28)),
    ]
    lever = lathe('tg_lever', [(0, 0.0), (1.9, 0.0), (1.9, 6.0), (2.6, 12.0), (3.3, 17.0), (3.0, 19.2), (1.6, 20.2), (0, 20.4)], 0, chrome, segments=48)
    lever.location.z = 7.6
    lever.rotation_euler.x = math.radians(-24 if on else 24)
    parts.append(lever)
    for part in parts:
        place(part, x, y)
    return parts


def slide(x, y, w=44, h=18, track=True, nub=True):
    """Interruptor deslizante de panel: ranura negra fresada en la placa y un botón de aluminio
    estriado que corre por ella. La ranura y el botón salen por separado: el botón lo mueve la interfaz."""
    parts = []
    if track:
        parts.append(loft('sl_bezel', [(loop_points(w + 5, h + 5, (h + 5) / 2), 2.2), (loop_points(w + 5, h + 5, (h + 5) / 2), 2.9), (loop_points(w + 3.6, h + 3.6, (h + 3.6) / 2), 3.2), (loop_points(w, h, h / 2), 3.2)],
                          metal('sl_ring', (0.62, 0.63, 0.65), 0.28)))
        parts.append(loft('sl_slot', [(loop_points(w, h, h / 2), 3.2), (loop_points(w - 1.4, h - 1.4, (h - 1.4) / 2), 0.9), (loop_points(w - 1.4, h - 1.4, (h - 1.4) / 2), 0.95)], plastic('#08090A', 0.55, 0), cap_top=0.0))
    if nub:
        nw, nh = w * 0.5, h - 4.0
        cap = metal('sl_nub', (0.80, 0.81, 0.82), 0.3, aniso=0.6)
        parts.append(loft('sl_nub', [(loop_points(nw, nh, 3.4), 1.0), (loop_points(nw, nh, 3.4), 5.4), (loop_points(nw - 1.6, nh - 1.6, 2.8), 6.6), (loop_points(nw - 3.0, nh - 3.0, 2.2), 6.9)], cap, cap_top=0.0))
        # Tres estrías para el dedo.
        dark = plastic('#151617', 0.5, 0)
        for dx in (-3.4, 0.0, 3.4):
            groove = loft('sl_groove', [(loop_points(1.1, nh - 6.5, 0.5), 6.7), (loop_points(1.1, nh - 6.5, 0.5), 7.0)], dark, cap_top=0.0)
            groove.location.x += dx
            parts.append(groove)
    for part in parts:
        place(part, x, y)
    return parts


def key(x, y, w=58, h=28, color='graphite', pressed=False, led=None):
    """Tecla baja de consola: tapa de ABS con el canto suave y, si lleva, su piloto en la esquina."""
    travel = -1.5 if pressed else 0.0
    well = loft('k_well', [(loop_points(w + 2.4, h + 2.4, 4.6), 2.2), (loop_points(w + 2.4, h + 2.4, 4.6), 2.36)], plastic(OPTS.get('well', '#0E0F10'), 0.7, 0), cap_top=0.0)
    cap = loft('k_cap', [
        (loop_points(w, h, 4.0), 2.3 + travel),
        (loop_points(w - 0.6, h - 0.6, 3.8), 5.6 + travel),
        (loop_points(w - 3.2, h - 3.2, 3.0), 7.3 + travel),
        (loop_points(w - 4.4, h - 4.4, 2.6), 7.6 + travel),
    ], plastic(color, float(OPTS.get('key_rough', 0.38)), 0.35, float(OPTS.get('key_coat', 0.0))), cap_top=0.35)
    parts = [well, cap]
    if led is not None:
        lit = led == 'on'
        lens = principled('lens_' + str(lit), **{'Base Color': (0.9, 0.08, 0.05, 1) if lit else (0.25, 0.03, 0.03, 1), 'Roughness': 0.12,
                                                 'Emission Color': (1.0, 0.10, 0.04, 1), 'Emission Strength': 3.2 if lit else 0.0, 'Coat Weight': 1.0})
        dot = lathe('k_led', [(0, 8.5 + travel), (1.3, 8.3 + travel), (2.0, 7.7 + travel), (2.0, 7.3 + travel)], 0, lens, segments=32)
        dot.location.x += -w / 2 + 8.5
        dot.location.y += h / 2 - 7.5
        parts.append(dot)
    for part in parts:
        place(part, x, y)
    return parts


def main():
    piece = B.PIECE
    scene = B.reset()
    B.lights(scene)
    if piece == 'study':
        w, h = 400, 256
        B.camera(scene, w, h, False)
        B.body(w, h + 200)
        plate(384, 240)
        for i in range(4):
            xk = -155 + 71 * i
            knob(xk, 62, 21)
            ticks(xk, 62, 21)
        toggle(-155 + 71 * 4, 58, True)
        for i in range(5):
            key(-142 + 71 * i, -22, 64, 30, 'graphite', led='on' if i == 0 else 'off')
        for i in range(4):
            key(-150 + 68 * i, -88, 62, 30, 'graphite', pressed=False, led='on' if i == 0 else 'off')
        key(146, -88, 72, 30, 'coral')
    else:
        sizes = {'plate': (int(OPTS.get('w', 384)) + 20, int(OPTS.get('h', 240)) + 20), 'knob': (76, 76), 'mark': (76, 76), 'scale': (76, 76), 'toggle': (44, 60),
                 'key': (int(OPTS.get('w', 58)) + 12, int(OPTS.get('h', 28)) + 12), 'slide': (60, 32), 'nub': (60, 32)}
        if piece not in sizes:
            raise SystemExit('pieza desconocida: ' + piece)
        w, h = sizes[piece]
        B.camera(scene, w, h, True)
        if piece not in ('mark', 'scale'):
            catcher(w, h)
        if piece == 'plate':
            lcd = tuple(float(v) for v in OPTS['lcd'].split(',')) if 'lcd' in OPTS else None
            plate(w - 20, h - 20, lcd=lcd)
        elif piece == 'knob':
            knob(0, 0, 24, mark=False)
            if int(OPTS.get('ticks', 11)) > 0:      # ticks=0: la perilla sola (su escala va aparte, en 'scale')
                ticks(0, 0, 24)
        elif piece == 'scale':
            # La escala serigrafiada en la placa, sola: la perilla gira su brillo con la luz y la escala no.
            ticks(0, 0, 24)
        elif piece == 'mark':
            knob(0, 0, 24, mark=True, body=False)
        elif piece == 'slide':
            slide(0, 0, nub=False)
        elif piece == 'nub':
            slide(0, 0, track=False)
        elif piece == 'toggle':
            toggle(0, 0, on=STATE != 'off')
        elif piece == 'key':
            key(0, 0, w - 12, h - 12, OPTS.get('color', 'graphite'), pressed=STATE == 'down', led=OPTS.get('led'))
    scene.render.filepath = B.OUT
    bpy.ops.render.render(write_still=True)
    print('RENDER_OK', B.OUT)


main()
