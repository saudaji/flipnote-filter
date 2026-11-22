# Cuerpo de la cámara FLIP: piezas renderizadas para la interfaz.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P design/camera-body/build.py -- <pieza> <salida.png> [opciones]
#
# Una unidad de Blender es un píxel CSS del diseño (400 de ancho). Cámara ortográfica cenital,
# luz de estudio desde arriba a la izquierda, como manda la convención de las interfaces. Las
# piezas sueltas (disparador, teclas, marcos) salen con fondo transparente y su sombra de
# contacto, para componerse en cualquier posición sobre la carcasa.
import bpy, bmesh, math, sys, os, json
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PIECE = ARGS[0] if ARGS else 'deck'
OUT = ARGS[1] if len(ARGS) > 1 else '/tmp/out.png'
OPTS = dict(a.split('=', 1) for a in ARGS[2:] if '=' in a)
SCALE = float(OPTS.get('scale', 3))          # píxeles de imagen por píxel CSS
SAMPLES = int(OPTS.get('samples', 96))
STATE = OPTS.get('state', 'idle')
FONT_DIN = '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf'
FONT_COND = '/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf'


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
    except Exception as error:  # sin GPU se renderiza en CPU
        print('GPU no disponible:', error)
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 10
    scene.cycles.transmission_bounces = 8
    scene.cycles.glossy_bounces = 6
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.display_settings.display_device = 'sRGB'
    try:
        scene.view_settings.view_transform = 'Khronos PBR Neutral'
    except Exception:
        scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    return scene


def camera(scene, w, h, transparent):
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = max(w, h)
    cam_data.clip_start = 1
    cam_data.clip_end = 4000
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = (0, 0, 1200)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = int(round(w * SCALE))
    scene.render.resolution_y = int(round(h * SCALE))
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent


def lights(scene, key=1.0):
    world = bpy.data.worlds.new('world')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    hdri = os.path.join(os.path.dirname(bpy.app.binary_path), '..', 'Resources')
    found = None
    for root, _dirs, files in os.walk(hdri):
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
    bg.inputs['Strength'].default_value = 0.55 * key
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

    def area(name, loc, size, power, color=(1, 1, 1)):
        data = bpy.data.lights.new(name, 'AREA')
        data.shape = 'RECTANGLE'
        data.size = size[0]
        data.size_y = size[1]
        data.energy = power * key
        data.color = color
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        direction = Vector((0, 0, 0)) - Vector(loc)
        obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(obj)
        return obj
    # Luz principal arriba a la izquierda, relleno frío abajo a la derecha.
    area('key', (-520, 620, 900), (900, 520), 2.6e7)
    area('fill', (640, -520, 700), (700, 700), 5.5e6, (0.82, 0.9, 1.0))
    area('strip', (60, 900, 420), (1400, 120), 7e6)
    softbox(scene, key)


def softbox(scene, key=1.0):
    """Caja de luz sobre la cámara, invisible para ella. Con vista ortográfica cenital una
    superficie plana refleja justo lo que tiene encima: el degradado de esta caja es el brillo
    que cruza la carcasa y los biseles, más claro arriba a la izquierda."""
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
    # Eje diagonal: −x + y crece hacia arriba a la izquierda.
    diag = nt.nodes.new('ShaderNodeMath'); diag.operation = 'SUBTRACT'
    scale = nt.nodes.new('ShaderNodeMapRange')
    extent = float(OPTS.get('sheen_extent', 420))
    scale.inputs['From Min'].default_value = -extent
    scale.inputs['From Max'].default_value = extent
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'EASE'
    lo, hi = float(OPTS.get('sheen_lo', 0.02)), float(OPTS.get('sheen_hi', 1.0))
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (lo, lo, lo * 1.08, 1)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (hi, hi, hi, 1)
    # Una franja más viva a media diagonal, como el borde de una ventana.
    band = ramp.color_ramp.elements.new(float(OPTS.get('band_at', 0.62)))
    band_level = float(OPTS.get('band', 0.55))
    band.color = (band_level, band_level, band_level * 1.03, 1)
    nt.links.new(coord.outputs['Object'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Y'], diag.inputs[0])
    nt.links.new(sep.outputs['X'], diag.inputs[1])
    nt.links.new(diag.outputs['Value'], scale.inputs['Value'])
    nt.links.new(scale.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], emit.inputs['Color'])
    emit.inputs['Strength'].default_value = float(OPTS.get('sheen', 0.5)) * key
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    obj.data.materials.append(mat)


# ── Materiales ──────────────────────────────────────────────────────────────────────────
def principled(name, **values):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    for key, value in values.items():
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = value
        else:
            print('entrada desconocida', key)
    return mat


def mat_shell():
    # Policarbonato ahumado translúcido: deja ver las tripas, desenfocadas por la rugosidad.
    tint = float(OPTS.get('tint', 0.36))
    mat = principled('shell', **{'Base Color': (tint * 0.92, tint, tint * 1.08, 1), 'Roughness': float(OPTS.get('frost', 0.3)), 'IOR': 1.50,
                                  'Transmission Weight': 1.0, 'Coat Weight': 0.6, 'Coat Roughness': 0.07})
    nt = mat.node_tree
    out = nt.nodes.get('Material Output')
    bsdf = nt.nodes.get('Principled BSDF')
    # Para los rayos de sombra el plástico es un filtro: sin esto la carcasa deja las tripas a oscuras.
    path = nt.nodes.new('ShaderNodeLightPath')
    clear = nt.nodes.new('ShaderNodeBsdfTransparent')
    pass_light = float(OPTS.get('pass', 0.5))
    clear.inputs['Color'].default_value = (pass_light * 0.92, pass_light, pass_light * 1.06, 1)
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(path.outputs['Is Shadow Ray'], mix.inputs['Fac'])
    nt.links.new(bsdf.outputs['BSDF'], mix.inputs[1])
    nt.links.new(clear.outputs['BSDF'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    # Grano de inyección, apenas visible en el brillo.
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1.4
    noise.inputs['Detail'].default_value = 4
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.02
    bump.inputs['Distance'].default_value = 0.5
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def mat_pcb():
    return principled('pcb', **{'Base Color': (0.006, 0.05, 0.043, 1), 'Roughness': 0.38, 'Coat Weight': 0.5, 'Coat Roughness': 0.2})


def mat_metal(name, color, rough, aniso=0.0, radial=False):
    mat = principled(name, **{'Base Color': color + (1,), 'Metallic': 1.0, 'Roughness': rough, 'Anisotropic': aniso})
    if radial:
        nt = mat.node_tree
        tangent = nt.nodes.new('ShaderNodeTangent')
        tangent.direction_type = 'RADIAL'
        tangent.axis = 'Z'
        nt.links.new(tangent.outputs['Tangent'], nt.nodes.get('Principled BSDF').inputs['Tangent'])
    return mat


def mat_plastic(name, color, rough=0.35, coat=0.0):
    return principled(name, **{'Base Color': color + (1,), 'Roughness': rough, 'Coat Weight': coat, 'Coat Roughness': 0.08})


def mat_emit(name, color, strength):
    return principled(name, **{'Base Color': (0, 0, 0, 1), 'Emission Color': color + (1,), 'Emission Strength': strength})


# ── Geometría ───────────────────────────────────────────────────────────────────────────
def link(obj, material=None):
    bpy.context.scene.collection.objects.link(obj)
    if material is not None:
        obj.data.materials.append(material)
    return obj


def rounded_rect(name, w, h, radius, depth, fillet, z=0.0, material=None, resolution=6):
    """Rectángulo redondeado extruido, con el canto superior e inferior fileteados."""
    fillet = max(0.0, min(fillet, depth / 2 - 0.001))
    # El bisel de la curva ensancha el contorno: se dibuja más pequeño para medir lo pedido.
    w, h, radius = w - 2 * fillet, h - 2 * fillet, radius - fillet
    radius = max(0.01, min(radius, w / 2 - 0.6, h / 2 - 0.6))
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    spline = curve.splines.new('BEZIER')
    k = 0.5523 * radius
    x, y = w / 2, h / 2
    if y - radius < 1.0:
        # Extremos semicirculares (tecla en píldora): dos cuartos de círculo por lado con el ápice compartido.
        radius = y
        k = 0.5523 * radius
        pts = [
            ((x - radius, y), (x - radius - k, y), (x - radius + k, y)), ((x, 0), (x, k), (x, -k)),
            ((x - radius, -y), (x - radius + k, -y), (x - radius - k, -y)), ((-x + radius, -y), (-x + radius + k, -y), (-x + radius - k, -y)),
            ((-x, 0), (-x, -k), (-x, k)), ((-x + radius, y), (-x + radius - k, y), (-x + radius + k, y)),
        ]
    else:
        pts = [
            ((x - radius, y), (x - radius - k, y), (x - radius + k, y)), ((x, y - radius), (x, y - radius + k), (x, y - radius - k)),
            ((x, -y + radius), (x, -y + radius + k), (x, -y + radius - k)), ((x - radius, -y), (x - radius + k, -y), (x - radius - k, -y)),
            ((-x + radius, -y), (-x + radius + k, -y), (-x + radius - k, -y)), ((-x, -y + radius), (-x, -y + radius - k), (-x, -y + radius + k)),
            ((-x, y - radius), (-x, y - radius - k), (-x, y - radius + k)), ((-x + radius, y), (-x + radius - k, y), (-x + radius + k, y)),
        ]
    spline.bezier_points.add(len(pts) - 1)
    for point, (co, left, right) in zip(spline.bezier_points, pts):
        point.co = (co[0], co[1], 0)
        point.handle_left = (left[0], left[1], 0)
        point.handle_right = (right[0], right[1], 0)
    spline.use_cyclic_u = True
    curve.resolution_u = 12
    fillet = max(0.0, min(fillet, depth / 2 - 0.001))
    curve.extrude = depth / 2 - fillet
    curve.bevel_depth = fillet
    curve.bevel_resolution = resolution
    obj = bpy.data.objects.new(name, curve)
    obj.location = (0, 0, z + depth / 2)
    return link(obj, material)


def disc(name, radius, depth, fillet, z=0.0, material=None, resolution=6):
    return rounded_rect(name, radius * 2, radius * 2, radius, depth, fillet, z, material, resolution)


def ring(name, outer, inner, depth, fillet, z=0.0, material=None):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    for radius in (outer, inner):
        spline = curve.splines.new('BEZIER')
        k = 0.5523 * radius
        pts = [((radius, 0), (radius, -k), (radius, k)), ((0, radius), (k, radius), (-k, radius)),
               ((-radius, 0), (-radius, k), (-radius, -k)), ((0, -radius), (-k, -radius), (k, -radius))]
        spline.bezier_points.add(3)
        for point, (co, left, right) in zip(spline.bezier_points, pts):
            point.co = (co[0], co[1], 0)
            point.handle_left = (left[0], left[1], 0)
            point.handle_right = (right[0], right[1], 0)
        spline.use_cyclic_u = True
    curve.resolution_u = 24
    fillet = max(0.0, min(fillet, depth / 2 - 0.001))
    curve.extrude = depth / 2 - fillet
    curve.bevel_depth = fillet
    curve.bevel_resolution = 5
    curve.offset = -fillet
    obj = bpy.data.objects.new(name, curve)
    obj.location = (0, 0, z + depth / 2)
    return link(obj, material)


def lathe(name, profile, z=0.0, material=None, segments=128):
    """Pieza de revolución a partir de un perfil (radio, altura). El perfil va de dentro afuera."""
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
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (0, 0, z)
    return link(obj, material)


def arc(cx, cz, radius, start, end, steps=7):
    return [(cx + radius * math.cos(math.radians(start + (end - start) * i / steps)), cz + radius * math.sin(math.radians(start + (end - start) * i / steps))) for i in range(steps + 1)]


def turned_disc(name, radius, depth, fillet=1.0, crown=0.0, z=0.0, material=None, dish=0.0):
    """Disco torneado: tapa abombada (crown) o cóncava (dish), canto fileteado y pared."""
    flat = radius - fillet
    profile = []
    steps = 10
    for i in range(steps + 1):
        t = i / steps
        r = flat * t
        profile.append((r, depth + crown * (1 - t * t) - dish * (1 - t * t)))
    profile += arc(flat, depth - fillet, fillet, 90, 0)[1:]
    profile.append((radius, 0))
    return lathe(name, profile, z, material)


def turned_ring(name, outer, inner, depth, chamfer_out=1.5, chamfer_in=1.0, z=0.0, material=None):
    """Anillo torneado con chaflanes: el exterior recoge la luz, el interior cae hacia el hueco."""
    profile = [(inner, 0), (inner, depth - chamfer_in), (inner + chamfer_in, depth), (outer - chamfer_out, depth), (outer, depth - chamfer_out), (outer, 0)]
    mesh_obj = lathe(name, profile, z, material)
    # Los chaflanes son aristas vivas: sombreado por caras con autosuavizado por ángulo.
    mesh = mesh_obj.data
    try:
        mesh.set_sharp_from_angle(angle=math.radians(28))
    except Exception:
        pass
    return mesh_obj


def dome(name, radius, height, z=0.0, material=None):
    """Casquete convexo: la tapa de un botón."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    segments, rings = 64, 14
    sphere_r = (radius * radius + height * height) / (2 * height)
    top = Vector((0, 0, height))
    verts_prev = None
    max_angle = math.asin(min(1.0, radius / sphere_r))
    center = bm.verts.new((0, 0, height))
    for i in range(1, rings + 1):
        angle = max_angle * i / rings
        r = sphere_r * math.sin(angle)
        zz = height - sphere_r * (1 - math.cos(angle))
        row = [bm.verts.new((r * math.cos(2 * math.pi * s / segments), r * math.sin(2 * math.pi * s / segments), zz)) for s in range(segments)]
        for s in range(segments):
            if verts_prev is None:
                bm.faces.new((center, row[s], row[(s + 1) % segments]))
            else:
                bm.faces.new((verts_prev[s], row[s], row[(s + 1) % segments], verts_prev[(s + 1) % segments]))
        verts_prev = row
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (0, 0, z)
    return link(obj, material)


def text(name, body, size, x, y, z, material, font=FONT_DIN, align='CENTER', extrude=0.0, spacing=1.0):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = body
    curve.size = size
    curve.align_x = align
    curve.align_y = 'CENTER'
    curve.extrude = extrude
    curve.space_character = spacing
    try:
        curve.font = bpy.data.fonts.load(font, check_existing=True)
    except Exception as error:
        print('fuente no cargada', error)
    obj = bpy.data.objects.new(name, curve)
    obj.location = (x, y, z)
    return link(obj, material)


def catcher(w, h, z=0.0):
    mesh = bpy.data.meshes.new('catcher')
    mesh.from_pydata([(-w, -h, z), (w, -h, z), (w, h, z), (-w, h, z)], [], [(0, 1, 2, 3)])
    obj = bpy.data.objects.new('catcher', mesh)
    obj.is_shadow_catcher = True
    return link(obj, mat_plastic('catch', (0.2, 0.2, 0.2), 0.5))


def place(obj, x, y):
    obj.location.x += x
    obj.location.y += y
    return obj


# ── Piezas ──────────────────────────────────────────────────────────────────────────────
def build_shutter(x=0, y=0, video=False, pressed=False):
    chrome = mat_metal('chrome', (0.88, 0.89, 0.92), 0.1)
    spun = mat_metal('spun', (0.82, 0.83, 0.86), 0.26, aniso=0.9, radial=True)
    gun = mat_metal('gun', (0.10, 0.105, 0.12), 0.32, aniso=0.7, radial=True)
    red = principled('capred', **{'Base Color': (0.62, 0.02, 0.015, 1), 'Metallic': 0.85, 'Roughness': 0.3, 'Anisotropic': 0.9, 'Coat Weight': 0.6, 'Coat Roughness': 0.1})
    tangent = red.node_tree.nodes.new('ShaderNodeTangent')
    tangent.direction_type = 'RADIAL'; tangent.axis = 'Z'
    red.node_tree.links.new(tangent.outputs['Tangent'], red.node_tree.nodes.get('Principled BSDF').inputs['Tangent'])
    cap = red if video else spun
    travel = -2.4 if pressed else 0.0
    parts = [
        turned_disc('sh_flange', 50, 2.4, 0.8, 0, 0, gun),
        turned_ring('sh_collar', 46.5, 34, 10.5, 3.2, 2.0, 1.5, chrome),
        turned_ring('sh_gap', 34.2, 30.6, 5.5, 0.4, 0.4, 1.5, mat_plastic('seat', (0.012, 0.012, 0.016), 0.6)),
        turned_disc('sh_cap', 30.4, 9.2, 1.6, 0.0, 2.6 + travel, cap, dish=1.3),
    ]
    for part in parts:
        place(part, x, y)
    return parts


def build_key(x=0, y=0, pressed=False, radius=24):
    chrome = mat_metal('chrome_k', (0.86, 0.87, 0.9), 0.12)
    rubber = mat_plastic('rubber', (0.05, 0.053, 0.06), 0.5, coat=0.2)
    travel = -1.5 if pressed else 0.0
    parts = [
        turned_ring('k_bezel', radius, radius - 4.6, 5.2, 1.8, 1.0, 0, chrome),
        turned_disc('k_cap', radius - 4.9, 5.4, 1.4, 1.1, 0.6 + travel, rubber),
    ]
    for part in parts:
        place(part, x, y)
    return parts


def build_pill(x=0, y=0, w=64, h=30, lit=False, pressed=False):
    chrome = mat_metal('chrome_p', (0.84, 0.85, 0.88), 0.16)
    body = mat_plastic('pill', (0.06, 0.064, 0.072) if not lit else (0.62, 0.64, 0.62), 0.45, coat=0.35)
    travel = -1.2 if pressed else 0.0
    parts = [
        rounded_rect('p_bezel', w, h, h / 2, 4.0, 1.3, 0, chrome),
        rounded_rect('p_cap', w - 5.6, h - 5.6, (h - 5.6) / 2, 5.6, 2.3, 0.4 + travel, body),
    ]
    for part in parts:
        place(part, x, y)
    return parts


def build_frame(w, h, radius=9, border=5.5, x=0, y=0):
    """Marco de una ventana (ranura de looks, miniatura): bisel cromado y cristal negro hundido."""
    chrome = mat_metal('chrome_f', (0.80, 0.81, 0.84), 0.2)
    glass = principled('glass', **{'Base Color': (0.006, 0.007, 0.009, 1), 'Roughness': 0.06, 'Coat Weight': 1.0, 'Coat Roughness': 0.03})
    outer = rounded_rect('f_outer', w, h, radius, 5, 1.4, 0, chrome)
    inner = rounded_rect('f_glass', w - border * 2, h - border * 2, max(1, radius - border), 2.2, 0.3, 0.2, glass)
    # El bisel es un marco: se le resta el hueco con un booleano.
    cutter = rounded_rect('f_cut', w - border * 2, h - border * 2, max(1, radius - border), 30, 0.0, -10, None)
    bpy.context.view_layer.objects.active = outer
    for obj in (outer, cutter):
        obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    mod = outer.modifiers.new('cut', 'BOOLEAN')
    mod.object = cutter
    mod.operation = 'DIFFERENCE'
    bpy.context.view_layer.objects.active = outer
    bpy.ops.object.modifier_apply(modifier='cut')
    bpy.data.objects.remove(cutter)
    for part in (outer, inner):
        place(part, x, y)
    return [outer, inner]


def traces(name, w, h, rng, material, z):
    """Pistas de cobre: buses de líneas paralelas con quiebros a 45°, como en una placa real."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 0.55
    curve.bevel_resolution = 0
    def path(points):
        spline = curve.splines.new('POLY')
        spline.points.add(len(points) - 1)
        for point, (px, py) in zip(spline.points, points):
            point.co = (px, py, 0, 1)
    for _ in range(int(OPTS.get('buses', 34) * max(1.0, (w * h) / 160000))):
        lanes = rng.choice([1, 1, 2, 3, 4, 6, 8])
        pitch = 2.6
        x, y = rng.uniform(-w / 2, w / 2), rng.uniform(-h / 2, h / 2)
        horizontal = rng.random() < 0.5
        legs = []
        for _leg in range(rng.randint(2, 4)):
            run = rng.uniform(24, 130) * rng.choice([-1, 1])
            jog = rng.uniform(8, 34) * rng.choice([-1, 1])
            legs.append((run, jog))
        for lane in range(lanes):
            off = (lane - (lanes - 1) / 2) * pitch
            px, py = (x, y + off) if horizontal else (x + off, y)
            points = [(px, py)]
            for run, jog in legs:
                if horizontal:
                    px += run; points.append((px, py))
                    px += abs(jog) * (1 if run > 0 else -1); py += jog; points.append((px, py))
                else:
                    py += run; points.append((px, py))
                    py += abs(jog) * (1 if run > 0 else -1); px += jog; points.append((px, py))
            path(points)
    obj = bpy.data.objects.new(name, curve)
    obj.location = (0, 0, z)
    return link(obj, material)


def chip(name, cx, cy, cw, ch, z, body, pin, pins=True):
    parts = [place(rounded_rect(name, cw, ch, 1.2, 3.6, 0.4, z, body), cx, cy)]
    if pins:
        # Patas a los dos lados largos.
        count = max(3, int(max(cw, ch) / 4.2))
        for side in (-1, 1):
            for i in range(count):
                t = (i + 0.5) / count - 0.5
                if cw >= ch:
                    parts.append(place(rounded_rect(name + 'p', 1.6, 4.2, 0.2, 1.0, 0.1, z, pin), cx + t * (cw - 4), cy + side * (ch / 2 + 1.6)))
                else:
                    parts.append(place(rounded_rect(name + 'p', 4.2, 1.6, 0.2, 1.0, 0.1, z, pin), cx + side * (cw / 2 + 1.6), cy + t * (ch - 4)))
    return parts


def build_body(w, h):
    """Carcasa translúcida con las tripas debajo."""
    import random
    rng = random.Random(int(OPTS.get('seed', 27)))
    floor = -25.0
    shell = rounded_rect('shell', w + 120, h + 120, 26, 14, 3.0, -14, mat_shell())
    board = rounded_rect('board', w + 100, h + 100, 4, 2, 0.2, floor - 2, mat_pcb())
    black = mat_plastic('ic', (0.014, 0.014, 0.017), 0.28, coat=0.5)
    silver = mat_metal('can', (0.80, 0.81, 0.82), 0.22)
    tin = mat_metal('tin', (0.74, 0.75, 0.76), 0.3)
    gold = principled('gold', **{'Base Color': (1.0, 0.70, 0.22, 1), 'Metallic': 1.0, 'Roughness': 0.28,
                                 'Emission Color': (1.0, 0.62, 0.18, 1), 'Emission Strength': float(OPTS.get('copper', 0.06))})
    blue = mat_plastic('cap', (0.03, 0.13, 0.6), 0.3, coat=0.7)
    white = mat_plastic('conn', (0.78, 0.76, 0.7), 0.5)
    flex = mat_plastic('flex', (0.62, 0.30, 0.04), 0.4, coat=0.5)
    parts = [shell, board, traces('traces', w + 40, h + 40, rng, gold, floor + 0.3)]
    for i in range(int(OPTS.get('chips', 15) * (w * h) / 120000)):
        cw, ch = rng.choice([(34, 34), (52, 28), (24, 24), (62, 44), (18, 40), (44, 44)])
        cx, cy = rng.uniform(-w / 2 + 16, w / 2 - 16), rng.uniform(-h / 2 + 16, h / 2 - 16)
        kind = rng.random()
        if kind < 0.5:
            parts += chip('ic%d' % i, cx, cy, cw, ch, floor, black, tin)
        elif kind < 0.68:
            parts.append(place(rounded_rect('sh%d' % i, cw, ch, 3, 5, 0.7, floor, silver), cx, cy))
        elif kind < 0.86:
            parts.append(place(turned_disc('el%d' % i, rng.uniform(6, 10), 9, 1.0, 0.3, floor, blue if rng.random() < 0.5 else silver), cx, cy))
        else:
            parts.append(place(rounded_rect('cn%d' % i, cw, 12, 1.5, 6, 0.6, floor, white), cx, cy))
    # Pila de botón, cinta plana y bobina del altavoz: las siluetas que se reconocen a través del plástico.
    for cx, cy in ((w * 0.27, h * 0.5 - 150), (-w * 0.2, -h * 0.5 + 420)):
        parts.append(place(turned_disc('coin%d' % len(parts), 31, 5, 1.0, 0.2, floor, silver), cx, cy))
        parts.append(place(turned_ring('coinr%d' % len(parts), 31, 26, 5.6, 0.6, 0.6, floor, tin), cx, cy))
    parts.append(place(rounded_rect('ribbon', 70, 190, 2, 0.8, 0.2, floor + 1.5, flex), -w * 0.24, h * 0.5 - 60))
    for i, radius in enumerate((34, 27, 20, 13, 6)):
        parts.append(place(turned_ring('spk%d' % i, radius, radius - 2.6, 2 + i * 0.9, 0.5, 0.5, floor, gold if i % 2 else silver), w * 0.28, -h * 0.5 + 300))
    # Diodos encendidos bajo la carcasa: el plástico los convierte en halos de color.
    glow = float(OPTS.get('glow', 1))
    leds = [(-w * 0.36, -h * 0.5 + 150, (0.45, 1.0, 0.12), 22), (w * 0.40, -h * 0.5 + 250, (0.1, 0.85, 1.0), 14), (w * 0.02, -h * 0.5 + 30, (1.0, 0.35, 0.05), 12),
            (w * 0.34, h * 0.5 - 30, (0.45, 1.0, 0.12), 14), (-w * 0.40, h * 0.5 - 24, (1.0, 0.2, 0.1), 10)]
    for gx, gy, color, power in leds:
        parts.append(place(turned_disc('led%d' % len(parts), 3.0, 2.2, 0.6, 0.6, floor, mat_emit('glow%d' % len(parts), color, power * glow)), gx, gy))
    return parts


def screw(x, y, radius=6.2):
    steel = mat_metal('steel', (0.62, 0.63, 0.66), 0.3, aniso=0.5, radial=True)
    head = place(disc('screw', radius, 2.6, 0.9, 0, steel), x, y)
    slot_mat = mat_plastic('slot', (0.01, 0.01, 0.012), 0.6)
    a = place(rounded_rect('slot_a', radius * 1.3, 1.5, 0.4, 0.8, 0.1, 2.2, slot_mat), x, y)
    b = place(rounded_rect('slot_b', 1.5, radius * 1.3, 0.4, 0.8, 0.1, 2.2, slot_mat), x, y)
    return [head, a, b]


# ── Programas ───────────────────────────────────────────────────────────────────────────
def decals(w, h):
    """Serigrafía de la carcasa: marca, modelo y avisos, en los bordes para no chocar con los mandos."""
    ink = mat_plastic('ink', (0.72, 0.75, 0.78), 0.55)
    dim = mat_plastic('ink_dim', (0.36, 0.39, 0.42), 0.55)
    orange = mat_plastic('ink_orange', (0.95, 0.36, 0.05), 0.5)
    z = 0.12
    bottom = -h / 2
    text('d_model', 'FLIP  FL-27  ·  DIGITAL STILL / MOTION', 5.6, 0, bottom + 9, z, dim, font=FONT_COND, spacing=1.7)
    return ink, dim, orange


def main():
    scene = reset()
    if PIECE == 'study':
        # Lámina de estudio: carcasa con todas las piezas encima, para juzgar materiales y luz.
        w, h = 400, 300
        camera(scene, w, h, False)
        lights(scene)
        build_body(w, h)
        build_shutter(0, -70)
        build_shutter(118, -70, video=True)
        build_key(-150, -70)
        build_key(-100, -70, pressed=True)
        build_pill(-150, 30)
        build_pill(-80, 30, lit=True)
        build_frame(360, 66, x=0, y=96)
        screw(-182, -132)
        screw(182, -132)
        ink = mat_plastic('ink', (0.78, 0.8, 0.82), 0.5)
        text('t1', 'FOTO', 9, -52, -22, 0.15, ink, spacing=1.3)
        text('t2', 'VIDEO', 9, 54, -22, 0.15, ink, spacing=1.3)
        text('t3', 'FLIP  DIGITAL  FL-27', 7, 0, -138, 0.15, ink, font=FONT_COND, spacing=1.6)
    elif PIECE == 'body':
        w, h = 400, int(OPTS.get('h', 900))
        camera(scene, w, h, False)
        lights(scene)
        build_body(w, h)
        decals(w, h)
        for sx in (-1, 1):
            screw(sx * 184, -h / 2 + 16, 5.4)
            screw(sx * 184, h / 2 - 16, 5.4)
    elif PIECE in ('shutter', 'key', 'pill', 'frame'):
        sizes = {'shutter': (112, 112), 'key': (56, 56), 'pill': (int(OPTS.get('w', 96)), 40), 'frame': (int(OPTS.get('w', 96)), int(OPTS.get('h', 72)))}
        w, h = sizes[PIECE]
        camera(scene, w, h, True)
        lights(scene)
        catcher(w, h)
        if PIECE == 'shutter':
            build_shutter(0, 0, video=OPTS.get('cap') == 'video', pressed=STATE == 'down')
        elif PIECE == 'key':
            build_key(0, 0, pressed=STATE == 'down')
        elif PIECE == 'pill':
            build_pill(0, 0, w=w - 8, h=32, lit=STATE == 'lit', pressed=STATE == 'down')
        else:
            build_frame(w - 6, h - 6, radius=float(OPTS.get('radius', 10)), border=float(OPTS.get('border', 5)))
    else:
        raise SystemExit('pieza desconocida: ' + PIECE)
    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    print('RENDER_OK', OUT)


main()
