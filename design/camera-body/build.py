# Cuerpo de la cámara FLIP FL-27: piezas renderizadas para la interfaz.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P design/camera-body/build.py -- <pieza> <salida.png> [clave=valor …]
#
# Lenguaje: un producto de los 80 hecho en 2027. Plástico ABS crema con grano de molde, teclas de
# teclado mecánico, botones redondos de colores, acentos coral y azul pizarra, cristal oscuro en
# las pantallas. Una unidad de Blender es un píxel CSS del diseño (400 de ancho). Cámara
# ortográfica cenital y luz de estudio desde arriba a la izquierda, como manda la convención de
# las interfaces. Las piezas sueltas salen con fondo transparente y su sombra de contacto.
import bpy, bmesh, math, sys, os
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PIECE = ARGS[0] if ARGS else 'study'
OUT = ARGS[1] if len(ARGS) > 1 else '/tmp/out.png'
OPTS = dict(a.split('=', 1) for a in ARGS[2:] if '=' in a)
SCALE = float(OPTS.get('scale', 3))
SAMPLES = int(OPTS.get('samples', 128))
STATE = OPTS.get('state', 'idle')
FONT = '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf'
FONT_COND = '/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf'


def srgb(hexcode):
    """#RRGGBB → color lineal para Blender."""
    hexcode = hexcode.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(hexcode[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


PALETTE = {
    'cream': '#E7E0CF', 'cream_hi': '#F0EBDE', 'cream_lo': '#CFC7B3', 'well': '#8D8572',
    'key': '#EEE9DC', 'gray': '#B5AFA2', 'coral': '#EC5B45', 'slate': '#566679',
    'mustard': '#F0AE2B', 'blue': '#2F78DC', 'mint': '#33B09F', 'lilac': '#8B79D6',
    'orange': '#F08A2D', 'green': '#3CA956', 'graphite': '#3B3C3F', 'white': '#F4F1EA',
    'glass': '#0B0C0D', 'bezel': '#26272A', 'ink': '#3A3833',
}


# ── Escena ──────────────────────────────────────────────────────────────────────────────
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for device in prefs.devices:
            device.use = True
        scene.cycles.device = 'GPU'
    except Exception as error:
        print('GPU no disponible:', error)
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    try:
        scene.view_settings.view_transform = 'Khronos PBR Neutral'
    except Exception:
        scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    return scene


def camera(scene, w, h, transparent):
    data = bpy.data.cameras.new('cam')
    data.type = 'ORTHO'
    data.ortho_scale = max(w, h)
    data.clip_start = 1
    data.clip_end = 4000
    cam = bpy.data.objects.new('cam', data)
    cam.location = (0, 0, 1200)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = int(round(w * SCALE))
    scene.render.resolution_y = int(round(h * SCALE))
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent


def lights(scene):
    world = bpy.data.worlds.new('world')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    found = None
    for root, _dirs, files in os.walk(os.path.join(os.path.dirname(bpy.app.binary_path), '..', 'Resources')):
        if 'studio.exr' in files and 'world' in root:
            found = os.path.join(root, 'studio.exr')
            break
    if found:
        env.image = bpy.data.images.load(found)
        mapping = nt.nodes.new('ShaderNodeMapping')
        coord = nt.nodes.new('ShaderNodeTexCoord')
        mapping.inputs['Rotation'].default_value = (0, 0, math.radians(float(OPTS.get('hdri', 130))))
        nt.links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
        nt.links.new(mapping.outputs['Vector'], env.inputs['Vector'])
        nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = float(OPTS.get('ambient', 0.5))
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

    def area(name, loc, size, power, color=(1, 1, 1)):
        data = bpy.data.lights.new(name, 'AREA')
        data.shape = 'RECTANGLE'
        data.size, data.size_y = size
        data.energy = power
        data.color = color
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        obj.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(obj)
    key = float(OPTS.get('key', 0.9))
    # Principal grande y suave arriba a la izquierda; relleno cálido enfrente para que las sombras no se ensucien.
    area('key', (-560, 640, 880), (1000, 700), 2.4e7 * key)
    area('fill', (620, -560, 760), (900, 900), 6.5e6 * key, (1.0, 0.96, 0.9))
    softbox(scene)


def softbox(scene):
    """Caja de luz cenital, visible solo en los reflejos: da el brillo a las piezas lustrosas."""
    span = 2400
    mesh = bpy.data.meshes.new('softbox')
    mesh.from_pydata([(-span, -span, 0), (span, -span, 0), (span, span, 0), (-span, span, 0)], [], [(0, 3, 2, 1)])
    obj = bpy.data.objects.new('softbox', mesh)
    obj.location = (0, 0, 1500)
    scene.collection.objects.link(obj)
    obj.visible_camera = False
    obj.visible_diffuse = False
    obj.visible_shadow = False
    mat = bpy.data.materials.new('softbox')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emit = nt.nodes.new('ShaderNodeEmission')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    diag = nt.nodes.new('ShaderNodeMath'); diag.operation = 'SUBTRACT'
    scale = nt.nodes.new('ShaderNodeMapRange')
    extent = float(OPTS.get('sheen_extent', 380))
    scale.inputs['From Min'].default_value = -extent
    scale.inputs['From Max'].default_value = extent
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'EASE'
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.05, 0.05, 0.055, 1)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(coord.outputs['Object'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Y'], diag.inputs[0])
    nt.links.new(sep.outputs['X'], diag.inputs[1])
    nt.links.new(diag.outputs['Value'], scale.inputs['Value'])
    nt.links.new(scale.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], emit.inputs['Color'])
    emit.inputs['Strength'].default_value = float(OPTS.get('sheen', 1.3))
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    obj.data.materials.append(mat)


# ── Materiales ──────────────────────────────────────────────────────────────────────────
MATS = {}


def principled(name, **values):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    for key, value in values.items():
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = value
    return mat


def plastic(color, rough=0.5, grain=1.0, coat=0.0):
    """ABS inyectado: mate, con el grano fino del molde y un punto de traslucidez."""
    key = (color, rough, grain, coat)
    if key in MATS:
        return MATS[key]
    rgb = srgb(PALETTE.get(color, color))
    mat = principled('abs_' + color, **{'Base Color': rgb + (1,), 'Roughness': rough, 'Coat Weight': coat, 'Coat Roughness': 0.06,
                                         'Subsurface Weight': 0.06, 'Subsurface Radius': (2.0, 1.4, 0.9), 'Subsurface Scale': 2.0})
    if grain > 0:
        nt = mat.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        coord = nt.nodes.new('ShaderNodeTexCoord')
        noise = nt.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = float(OPTS.get('grain_scale', 2.6))
        noise.inputs['Detail'].default_value = 5
        noise.inputs['Roughness'].default_value = 0.7
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.16 * grain
        bump.inputs['Distance'].default_value = 0.55
        nt.links.new(coord.outputs['Object'], noise.inputs['Vector'])
        nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        # El color tampoco es plano: la inyección deja nubes muy tenues.
        cloud = nt.nodes.new('ShaderNodeTexNoise')
        cloud.inputs['Scale'].default_value = 0.012
        cloud.inputs['Detail'].default_value = 2
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = tuple(c * 0.94 for c in rgb) + (1,)
        ramp.color_ramp.elements[1].color = rgb + (1,)
        nt.links.new(coord.outputs['Object'], cloud.inputs['Vector'])
        nt.links.new(cloud.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    MATS[key] = mat
    return mat


def gloss(color):
    """Botón de caramelo: plástico lustroso con una capa de barniz."""
    key = ('gloss', color)
    if key not in MATS:
        MATS[key] = principled('gloss_' + color, **{'Base Color': srgb(PALETTE.get(color, color)) + (1,), 'Roughness': 0.26, 'Coat Weight': 1.0,
                                                    'Coat Roughness': 0.05, 'Subsurface Weight': 0.1, 'Subsurface Radius': (2.5, 1.2, 0.8), 'Subsurface Scale': 2.5})
    return MATS[key]


def metal(name, color=(0.84, 0.85, 0.87), rough=0.3, aniso=0.0, radial=False, knurl=0):
    mat = principled(name, **{'Base Color': color + (1,), 'Metallic': 1.0, 'Roughness': rough, 'Anisotropic': aniso})
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if radial:
        tangent = nt.nodes.new('ShaderNodeTangent')
        tangent.direction_type = 'RADIAL'
        tangent.axis = 'Z'
        nt.links.new(tangent.outputs['Tangent'], bsdf.inputs['Tangent'])
    if knurl:
        # Moleteado: estrías radiales por el ángulo alrededor del eje.
        coord = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        atan = nt.nodes.new('ShaderNodeMath'); atan.operation = 'ARCTAN2'
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = knurl
        sine = nt.nodes.new('ShaderNodeMath'); sine.operation = 'SINE'
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.9
        bump.inputs['Distance'].default_value = 1.2
        nt.links.new(coord.outputs['Object'], sep.inputs['Vector'])
        nt.links.new(sep.outputs['Y'], atan.inputs[0])
        nt.links.new(sep.outputs['X'], atan.inputs[1])
        nt.links.new(atan.outputs['Value'], mul.inputs[0])
        nt.links.new(mul.outputs['Value'], sine.inputs[0])
        nt.links.new(sine.outputs['Value'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


# ── Geometría ───────────────────────────────────────────────────────────────────────────
def link(obj, material=None):
    bpy.context.scene.collection.objects.link(obj)
    if material is not None:
        obj.data.materials.append(material)
    return obj


def place(obj, x, y):
    obj.location.x += x
    obj.location.y += y
    return obj


def loop_points(w, h, radius, steps=10):
    """Contorno de un rectángulo redondeado, en sentido antihorario, siempre con los mismos puntos."""
    radius = max(0.01, min(radius, w / 2, h / 2))
    x, y = w / 2 - radius, h / 2 - radius
    pts = []
    for cx, cy, start in ((x, y, 0), (-x, y, 90), (-x, -y, 180), (x, -y, 270)):
        for i in range(steps + 1):
            a = math.radians(start + 90 * i / steps)
            pts.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
    return pts


def loft(name, loops, material=None, cap_top=None, cap_bottom=False):
    """Une contornos sucesivos (cada uno: puntos y altura). cap_top: cuánto se hunde el centro de la tapa."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = [[bm.verts.new((px, py, z)) for px, py in pts] for pts, z in loops]
    count = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(count):
            j = (i + 1) % count
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_top is not None:
        centre = bm.verts.new((0, 0, loops[-1][1] - cap_top))
        top = rings[-1]
        for i in range(count):
            bm.faces.new((top[i], top[(i + 1) % count], centre))
    if cap_bottom:
        bm.faces.new(list(reversed(rings[0])))
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    try:
        mesh.set_sharp_from_angle(angle=math.radians(float(OPTS.get('sharp', 42))))
    except Exception:
        pass
    return link(bpy.data.objects.new(name, mesh), material)


def lathe(name, profile, z=0.0, material=None, segments=128):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rows = []
    for radius, height in profile:
        if radius <= 1e-6:
            rows.append([bm.verts.new((0, 0, height))])
        else:
            rows.append([bm.verts.new((radius * math.cos(2 * math.pi * i / segments), radius * math.sin(2 * math.pi * i / segments), height)) for i in range(segments)])
    for a, b in zip(rows, rows[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[i], b[0], a[j]))
            else:
                bm.faces.new((a[i], b[i], b[j], a[j]))
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    try:
        mesh.set_sharp_from_angle(angle=math.radians(40))
    except Exception:
        pass
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (0, 0, z)
    return link(obj, material)


def arc(cx, cz, radius, start, end, steps=7):
    return [(cx + radius * math.cos(math.radians(start + (end - start) * i / steps)), cz + radius * math.sin(math.radians(start + (end - start) * i / steps))) for i in range(steps + 1)]


def dome(name, radius, depth, crown, fillet, z, material):
    """Botón redondo: tapa abombada, canto fileteado y pared."""
    flat = radius - fillet
    profile = [(flat * i / 12, depth + crown * (1 - (i / 12) ** 2)) for i in range(13)]
    profile += arc(flat, depth - fillet, fillet, 90, 0)[1:]
    profile.append((radius, 0))
    return lathe(name, profile, z, material)


def ring(name, outer, inner, depth, chamfer, z, material):
    profile = [(inner, 0), (inner, depth - chamfer * 0.6), (inner + chamfer * 0.6, depth), (outer - chamfer, depth), (outer, depth - chamfer), (outer, 0)]
    return lathe(name, profile, z, material)


def catcher(w, h, z=0.0):
    mesh = bpy.data.meshes.new('catcher')
    mesh.from_pydata([(-w, -h, z), (w, -h, z), (w, h, z), (-w, h, z)], [], [(0, 1, 2, 3)])
    obj = bpy.data.objects.new('catcher', mesh)
    obj.is_shadow_catcher = True
    return link(obj, plastic('cream', 0.5, 0))


def text(name, body, size, x, y, z, material, font=FONT, spacing=1.0):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = body
    curve.size = size
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.space_character = spacing
    try:
        curve.font = bpy.data.fonts.load(font, check_existing=True)
    except Exception as error:
        print('fuente no cargada', error)
    obj = bpy.data.objects.new(name, curve)
    obj.location = (x, y, z)
    return link(obj, material)


# ── Piezas ──────────────────────────────────────────────────────────────────────────────
def keycap(x, y, w, h, color='key', pressed=False, radius=7.0):
    """Tecla de teclado mecánico vista desde arriba: faldón inclinado, canto suave y tapa algo cóncava."""
    travel = -2.6 if pressed else 0.0
    height, inset = 9.0, 4.6
    well = loft('well', [(loop_points(w + 3.0, h + 3.0, radius + 1.2), -0.2), (loop_points(w + 3.0, h + 3.0, radius + 1.2), 0.25)], plastic('well', 0.7, 0), cap_top=0.0)
    cap = loft('keycap', [
        (loop_points(w, h, radius), 0.3 + travel),
        (loop_points(w - 1.0, h - 1.0, radius - 0.3), 2.0 + travel),
        (loop_points(w - inset * 1.7, h - inset * 1.7, max(2.0, radius - 2.2)), height - 1.1 + travel),
        (loop_points(w - inset * 2.0, h - inset * 2.0, max(1.8, radius - 2.6)), height - 0.25 + travel),
        (loop_points(w - inset * 2.5, h - inset * 2.5, max(1.5, radius - 3.0)), height + travel),
    ], plastic(color, 0.46, 0.55), cap_top=0.7)
    for part in (well, cap):
        place(part, x, y)
    return [well, cap]


def candy(x, y, radius=24, color='coral', pressed=False):
    """Botón redondo lustroso asentado en su hueco."""
    travel = -1.7 if pressed else 0.0
    parts = [
        lathe('seat', [(0, 0.2), (radius + 1.6, 0.2), (radius + 1.6, -0.2)], 0, plastic('well', 0.7, 0)),
        dome('candy', radius, 6.0, 1.9, 2.2, 0.4 + travel, gloss(color)),
    ]
    for part in parts:
        place(part, x, y)
    return parts


def shutter(x, y, video=False, pressed=False):
    """El disparador: un botón grande en un aro de aluminio. Blanco cálido para foto, coral para vídeo."""
    travel = -2.4 if pressed else 0.0
    alu = metal('alu', (0.83, 0.84, 0.86), 0.3, aniso=0.7, radial=True)
    parts = [
        lathe('sh_seat', [(0, 0.2), (51, 0.2), (51, -0.2)], 0, plastic('well', 0.7, 0)),
        ring('sh_ring', 49.5, 40.5, 5.5, 1.8, 0.3, alu),
        lathe('sh_gap', [(0, 0.6), (40.6, 0.6), (40.6, 0.2)], 0, plastic('graphite', 0.6, 0)),
        dome('sh_cap', 38.0, 8.5, 3.4, 3.2, 1.0 + travel, gloss('coral' if video else 'white')),
    ]
    for part in parts:
        place(part, x, y)
    return parts


def knob(x, y, radius=26):
    """Perilla de aluminio moleteado con la cara torneada."""
    side = metal('knurl', (0.80, 0.81, 0.83), 0.34, knurl=float(OPTS.get('knurl', 64)))
    face = metal('face', (0.86, 0.87, 0.89), 0.24, aniso=0.85, radial=True)
    parts = [
        lathe('kn_seat', [(0, 0.2), (radius + 2.2, 0.2), (radius + 2.2, -0.2)], 0, plastic('well', 0.7, 0)),
        lathe('kn_side', [(radius - 3.0, 15), (radius - 0.6, 14.2), (radius, 12.5), (radius, 0.4)], 0, side),
        lathe('kn_face', [(0, 15.3), (radius - 6, 15.3), (radius - 3.2, 15.0)], 0, face),
    ]
    for part in parts:
        place(part, x, y)
    return parts


def dial(x, y, radius=18, color='graphite'):
    """Perilla de sintetizador: falda, cuerpo estriado anodizado y tapa de aluminio torneado.
    No lleva marca: la pone la interfaz, que es la que gira."""
    side = metal('dial_side', srgb(PALETTE[color]), 0.46, knurl=float(OPTS.get('knurl', 40)))
    face = metal('dial_face', (0.86, 0.87, 0.89), 0.26, aniso=0.85, radial=True)
    parts = [
        lathe('dl_seat', [(0, 0.2), (radius + 6.6, 0.2), (radius + 6.6, -0.2)], 0, plastic('well', 0.7, 0)),
        lathe('dl_skirt', [(radius + 5.2, 0.3), (radius + 5.2, 1.6), (radius + 3.8, 3.0), (radius - 0.4, 3.4)], 0, plastic(color, 0.5, 0.2)),
        lathe('dl_side', [(radius, 3.2), (radius, 13.2), (radius - 0.9, 14.6), (radius - 2.6, 15.2)], 0, side),
        lathe('dl_face', [(0, 15.5), (radius - 3.6, 15.5), (radius - 2.6, 15.2)], 0, face),
    ]
    for part in parts:
        place(part, x, y)
    return parts


def jack(x, y, radius=9):
    """Toma de panel de 3,5 mm: tuerca hexagonal, casquillo roscado y el hueco."""
    parts = [
        lathe('jk_nut', [(radius + 4.4, 0.2), (radius + 4.4, 2.4), (radius + 3.4, 3.3), (radius + 0.6, 3.3)], 0, metal('jack_nut', (0.74, 0.75, 0.77), 0.34), segments=6),
        lathe('jk_bush', [(radius + 0.8, 3.1), (radius + 0.8, 4.7), (radius, 5.3), (radius - 2.2, 5.3), (radius - 3.1, 4.5), (radius - 3.1, 3.2)], 0, metal('jack_bush', (0.86, 0.87, 0.88), 0.22, aniso=0.6, radial=True)),
        lathe('jk_hole', [(radius - 3.1, 3.2), (radius - 3.1, -7), (0, -7)], 0, plastic('glass', 0.85, 0)),
    ]
    for part in parts:
        place(part, x, y)
    return parts


def recess(w, h, radius=14, wall=8.0, depth=5.0, dark=5.0, floor=None, x=0, y=0):
    """Marco hundido de una pantalla: pared crema que baja, bisel oscuro y hueco (transparente) para el
    cristal. Con floor, el fondo es de ese material (una bandeja)."""
    inner_w, inner_h, inner_r = w - wall * 2, h - wall * 2, max(1, radius - wall)
    parts = [loft('rc_wall', [(loop_points(w, h, radius), 0.0), (loop_points(inner_w, inner_h, inner_r), -depth)], plastic('cream', 0.5, 1.0))]
    if dark > 0:
        parts.append(loft('rc_bezel', [(loop_points(inner_w, inner_h, inner_r), -depth), (loop_points(inner_w - dark * 2, inner_h - dark * 2, max(1, inner_r - dark)), -depth - 0.6)], plastic('bezel', 0.42, 0.3)))
    if floor:
        fw, fh, fr = inner_w - dark * 2, inner_h - dark * 2, max(1, inner_r - dark)
        parts.append(loft('rc_floor', [(loop_points(fw, fh, fr), -depth - 0.6), (loop_points(fw, fh, fr), -depth - 0.55)], plastic(floor, 0.6, 0.6), cap_top=0.0))
    for part in parts:
        place(part, x, y)
    return parts


def slide_switch(x, y, w=60, h=24, nub=True, track=True, at=-1):
    parts = []
    if track:
        parts.append(loft('sw_track', [(loop_points(w, h, h / 2), 0.0), (loop_points(w - 5, h - 5, (h - 5) / 2), -3.0), (loop_points(w - 5, h - 5, (h - 5) / 2), -2.95)], plastic('graphite', 0.55, 0.2), cap_top=0.0))
    if nub:
        nw = w * 0.46
        parts.append(place(loft('sw_nub', [(loop_points(nw, h - 7, 5), -2.9), (loop_points(nw - 1, h - 8, 4.6), 1.8), (loop_points(nw - 4, h - 11, 3.2), 2.6)], plastic('key', 0.42, 0.5), cap_top=0.0), at * (w - 5 - nw) / 2 * 0.92, 0))
    for part in parts:
        place(part, x, y)
    return parts


def body(w, h):
    """La carcasa: una losa crema con su grano, ranuras de ventilación y tornillos hundidos."""
    slab = loft('body', [(loop_points(w + 160, h + 160, 30), -12), (loop_points(w + 160, h + 160, 30), 0.0)], plastic('cream', 0.52, 1.0), cap_top=0.0, cap_bottom=True)
    cutters = []
    for i in range(7):
        cutters.append(place(loft('slot%d' % i, [(loop_points(46, 3.6, 1.8), -4.0), (loop_points(46, 3.6, 1.8), 3.0)], None, cap_top=0.0, cap_bottom=True), -w / 2 + 44, -h / 2 + 30 + i * 7.4))
    for sx in (-1, 1):
        for sy in (-1, 1):
            cutters.append(place(lathe('screwhole', [(0, 3.0), (5.2, 3.0), (5.2, -2.6), (0, -2.6)], 0, None, segments=48), sx * (w / 2 - 15), sy * (h / 2 - 15)))
    bpy.context.view_layer.objects.active = slab
    for index, cutter in enumerate(cutters):
        mod = slab.modifiers.new('cut%d' % index, 'BOOLEAN')
        mod.object = cutter
        mod.operation = 'DIFFERENCE'
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for cutter in cutters:
        bpy.data.objects.remove(cutter)
    try:
        slab.data.set_sharp_from_angle(angle=math.radians(40))
    except Exception:
        pass
    steel = metal('steel', (0.66, 0.67, 0.69), 0.34, aniso=0.5, radial=True)
    dark = plastic('graphite', 0.6, 0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (w / 2 - 15), sy * (h / 2 - 15)
            place(dome('screw', 4.3, 1.4, 0.5, 0.6, -2.5, steel), cx, cy)
            place(loft('cross_a', [(loop_points(5.4, 1.1, 0.4), -0.7), (loop_points(5.4, 1.1, 0.4), -0.55)], dark, cap_top=0.0), cx, cy)
            place(loft('cross_b', [(loop_points(1.1, 5.4, 0.4), -0.7), (loop_points(1.1, 5.4, 0.4), -0.55)], dark, cap_top=0.0), cx, cy)
    # Serigrafía del modelo, pequeña, junto al borde inferior.
    text('model', 'FLIP  FL-27  ·  RETRO-STYLE DIGITAL CAMERA', 5.2, 34, -h / 2 + 12, 0.1, plastic('ink', 0.6, 0), font=FONT_COND, spacing=1.6)
    return slab


def main():
    scene = reset()
    lights(scene)
    if PIECE == 'study':
        w, h = 400, 320
        camera(scene, w, h, False)
        body(w, h)
        recess(372, 96, x=0, y=100)
        keycap(-150, 20, 78, 36, 'coral')
        keycap(-66, 20, 78, 36, 'key')
        keycap(18, 20, 78, 36, 'key', pressed=True)
        keycap(102, 20, 78, 36, 'slate')
        keycap(170, 20, 40, 36, 'gray')
        shutter(0, -78)
        shutter(-118, -78, video=True)
        for i, color in enumerate(('coral', 'mustard', 'blue', 'mint', 'lilac', 'graphite')):
            candy(84 + (i % 3) * 46, -54 - (i // 3) * 48, 19, color)
        knob(-176, -128, 16)
    elif PIECE == 'body':
        w, h = 400, int(OPTS.get('h', 900))
        camera(scene, w, h, False)
        body(w, h)
    else:
        sizes = {'shutter': (112, 112), 'candy': (56, 56), 'keycap': (int(OPTS.get('w', 96)), int(OPTS.get('h', 46))), 'recess': (int(OPTS.get('w', 132)), int(OPTS.get('h', 132))),
                 'knob': (72, 72), 'switch': (72, 34), 'nub': (40, 34), 'dial': (60, 60), 'jack': (36, 36)}
        if PIECE not in sizes:
            raise SystemExit('pieza desconocida: ' + PIECE)
        w, h = sizes[PIECE]
        camera(scene, w, h, True)
        # Las piezas hundidas (marcos) no llevan plano de sombra: quedaría por encima y las taparía.
        if PIECE not in ('recess', 'switch'):
            catcher(w, h)
        if PIECE == 'shutter':
            shutter(0, 0, video=OPTS.get('cap') == 'video', pressed=STATE == 'down')
        elif PIECE == 'candy':
            candy(0, 0, 23, OPTS.get('color', 'coral'), pressed=STATE == 'down')
        elif PIECE == 'keycap':
            keycap(0, 0, w - 10, h - 10, OPTS.get('color', 'key'), pressed=STATE == 'down')
        elif PIECE == 'recess':
            recess(w - 4, h - 4, radius=float(OPTS.get('radius', 16)), wall=float(OPTS.get('wall', 8)), depth=float(OPTS.get('depth', 5)), dark=float(OPTS.get('dark', 5)), floor=OPTS.get('floor'))
        elif PIECE == 'knob':
            knob(0, 0, 28)
        elif PIECE == 'dial':
            dial(0, 0, 18, OPTS.get('color', 'graphite'))
        elif PIECE == 'jack':
            jack(0, 0, 9)
        elif PIECE == 'switch':
            slide_switch(0, 0, nub=False)
        elif PIECE == 'nub':
            slide_switch(0, 0, w=60, nub=True, track=False, at=0)
    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    print('RENDER_OK', OUT)


main()
