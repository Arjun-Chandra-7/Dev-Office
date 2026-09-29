"""Shared helpers for the DEV OFFICE Blender kit (run inside Blender 5.x).

Coordinates are authored in the web app's frame (three.js: +y up, metres) and converted to
Blender's (+z up): three (x, y, z) -> blender (x, -z, y). The glTF exporter converts back.
"""
import math
import random

import bpy
from mathutils import Vector


def B(x, y, z):
    """three.js coords -> blender coords"""
    return Vector((x, -z, y))


# ---------------------------------------------------------------------------------------------
# scene

def reset(device='cpu'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dev_type in (('OPTIX', 'CUDA') if device == 'gpu' else ()):
        try:
            prefs.compute_device_type = dev_type
            prefs.refresh_devices()
            if any(d.type == dev_type for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == dev_type
                sc.cycles.device = 'GPU'
                break
        except Exception:
            pass
    sc.cycles.samples = 256
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'None'
    sc.unit_settings.system = 'METRIC'
    return sc


def collection(name):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    return col


def link(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


# ---------------------------------------------------------------------------------------------
# materials

_mats = {}


def _principled(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes['Principled BSDF'], m.node_tree


def mat(name, color=(0.8, 0.8, 0.8), rough=0.5, metal=0.0, emit=None, emit_strength=0.0, coat=0.0):
    if name in _mats:
        return _mats[name]
    m, p, _ = _principled(name)
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Coat Weight'].default_value = coat
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = emit_strength
    _mats[name] = m
    return m


def srgb(h):
    """'#rrggbb' -> linear rgb tuple"""
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def _node(nt, kind, loc=(0, 0)):
    n = nt.nodes.new(kind)
    n.location = loc
    return n


def mat_oak_floor():
    """Plank floor: brick texture drives plank layout, noise/wave give grain + per-plank tone."""
    if 'oak_floor' in _mats:
        return _mats['oak_floor']
    m, p, nt = _principled('oak_floor')
    tc = _node(nt, 'ShaderNodeTexCoord', (-1200, 0))
    brick = _node(nt, 'ShaderNodeTexBrick', (-800, 200))
    brick.inputs['Scale'].default_value = 1.0
    brick.inputs['Mortar Size'].default_value = 0.004
    brick.inputs['Brick Width'].default_value = 1.4
    brick.inputs['Row Height'].default_value = 0.19
    brick.offset = 0.37
    brick.inputs['Color1'].default_value = (*srgb('#b98a5a'), 1)
    brick.inputs['Color2'].default_value = (*srgb('#9c6d42'), 1)
    brick.inputs['Mortar'].default_value = (*srgb('#3a2616'), 1)
    wave = _node(nt, 'ShaderNodeTexWave', (-800, -200))
    wave.inputs['Scale'].default_value = 3.0
    wave.inputs['Distortion'].default_value = 6
    wave.inputs['Detail'].default_value = 4
    wave.bands_direction = 'X'
    mix = _node(nt, 'ShaderNodeMix', (-400, 100))
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 0.35
    nt.links.new(tc.outputs['Object'], brick.inputs['Vector'])
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    nt.links.new(brick.outputs['Color'], mix.inputs['A'])
    nt.links.new(wave.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.35
    p.inputs['Coat Weight'].default_value = 0.3
    _mats['oak_floor'] = m
    return m


def mat_noise(name, base, var, scale=4.0, rough=0.6, metal=0.0, detail=6.0):
    """Base colour modulated by noise (concrete, plaster, fabric, rug)."""
    if name in _mats:
        return _mats[name]
    m, p, nt = _principled(name)
    tc = _node(nt, 'ShaderNodeTexCoord', (-900, 0))
    noise = _node(nt, 'ShaderNodeTexNoise', (-700, 0))
    noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = detail
    ramp = _node(nt, 'ShaderNodeValToRGB', (-450, 0))
    ramp.color_ramp.elements[0].color = (*srgb(var), 1)
    ramp.color_ramp.elements[1].color = (*srgb(base), 1)
    ramp.color_ramp.elements[0].position = 0.3
    ramp.color_ramp.elements[1].position = 0.7
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    _mats[name] = m
    return m


def mat_walnut():
    if 'walnut' in _mats:
        return _mats['walnut']
    m, p, nt = _principled('walnut')
    tc = _node(nt, 'ShaderNodeTexCoord', (-900, 0))
    # fine, long grain: squash the wave field across the grain direction
    mp = _node(nt, 'ShaderNodeMapping', (-800, 0))
    mp.inputs['Scale'].default_value = (1.0, 14.0, 14.0)
    wave = _node(nt, 'ShaderNodeTexWave', (-700, 0))
    wave.bands_direction = 'X'
    wave.inputs['Scale'].default_value = 1.6
    wave.inputs['Distortion'].default_value = 3.0
    wave.inputs['Detail'].default_value = 8
    wave.inputs['Detail Scale'].default_value = 2.5
    ramp = _node(nt, 'ShaderNodeValToRGB', (-450, 0))
    ramp.color_ramp.elements[0].color = (*srgb('#3a2314'), 1)
    ramp.color_ramp.elements[1].color = (*srgb('#5c3a22'), 1)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], wave.inputs['Vector'])
    nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.32
    p.inputs['Coat Weight'].default_value = 0.5
    _mats['walnut'] = m
    return m


def library():
    L = {
        'oak': mat_oak_floor(),
        'walnut': mat_walnut(),
        'concrete': mat_noise('concrete', '#8e8f8f', '#6c6d6e', scale=3, rough=0.35),
        'plaster': mat_noise('plaster', '#efece6', '#e2ded6', scale=6, rough=0.9),
        'ceiling': mat_noise('ceiling', '#f2f1ee', '#e6e4df', scale=8, rough=0.95),
        'accent': mat('accent', srgb('#2c3439'), rough=0.7),
        'black_metal': mat('black_metal', srgb('#1a1c1f'), rough=0.35, metal=0.9),
        'aluminium': mat('aluminium', srgb('#c3c7cb'), rough=0.25, metal=1.0),
        'chrome': mat('chrome', srgb('#f0f0f0'), rough=0.08, metal=1.0),
        'white': mat('white', srgb('#ecebe7'), rough=0.3),
        'fabric_charcoal': mat_noise('fabric_charcoal', '#3b3f45', '#30343a', scale=60, rough=0.95, detail=2),
        'fabric_teal': mat_noise('fabric_teal', '#2f6f73', '#255a5d', scale=60, rough=0.95, detail=2),
        'fabric_mustard': mat_noise('fabric_mustard', '#bd8a31', '#9e7026', scale=60, rough=0.95, detail=2),
        'leather': mat_noise('leather', '#7a4a2c', '#5e3820', scale=20, rough=0.5, detail=4),
        'rug': mat_noise('rug', '#8a8074', '#6e655b', scale=25, rough=1.0, detail=3),
        'ceramic': mat('ceramic', srgb('#e8e3db'), rough=0.35),
        'pot_dark': mat('pot_dark', srgb('#2a2b2d'), rough=0.55),
        'soil': mat('soil', srgb('#2a1e14'), rough=1.0),
        'leaf': mat('leaf', srgb('#3d6a31'), rough=0.6),
        'leaf_dark': mat('leaf_dark', srgb('#2a4d27'), rough=0.6),
        'stem': mat('stem', srgb('#4a3a28'), rough=0.8),
        'shade': mat('shade', srgb('#f3e9d2'), rough=0.8, emit=srgb('#ffd9a0'), emit_strength=1.5),
        'panel_light': mat('panel_light', (1, 1, 1), rough=1.0, emit=srgb('#fff1da'), emit_strength=12.0),
        'screen_off': mat('screen_off', srgb('#0a0b0c'), rough=0.2),
        'art': mat_noise('art', '#e7c9a0', '#2f5d62', scale=2.2, rough=0.8, detail=4),
        'book_red': mat('book_red', srgb('#7c2d12'), rough=0.7),
        'book_blue': mat('book_blue', srgb('#1e3a5f'), rough=0.7),
        'book_cream': mat('book_cream', srgb('#e5e0d3'), rough=0.7),
        'book_green': mat('book_green', srgb('#3f6212'), rough=0.7),
        'book_black': mat('book_black', srgb('#1f2937'), rough=0.7),
        'book_orange': mat('book_orange', srgb('#b45309'), rough=0.7),
        'book_teal': mat('book_teal', srgb('#0f766e'), rough=0.7),
        'proxy': mat('proxy', (0.5, 0.5, 0.5), rough=1.0),
        'proxy_light': mat('proxy_light', (1, 1, 1), rough=1.0, emit=srgb('#fff1da'), emit_strength=6.0),
        'glass': mat('GLASS', (0.8, 0.9, 0.9), rough=0.02),
    }
    return L


# ---------------------------------------------------------------------------------------------
# primitives (three.js coordinates in, blender objects out)

def box(name, center, size, material, bevel=0.0, col=None):
    """Axis-aligned box. center/size in three coords (x, y, z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=B(*center))
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        md = o.modifiers.new('bevel', 'BEVEL')
        md.width = bevel
        md.segments = 3
        md.limit_method = 'ANGLE'
        md.harden_normals = False
    o.data.materials.append(material)
    if col:
        link(o, col)
    return o


def rot_obj(o, rot3):
    """rotation in three euler (x, y, z) radians -> blender"""
    o.rotation_euler = (rot3[0], -rot3[2], rot3[1])
    return o


def cyl(name, center, radius, height, material, verts=32, col=None, depth_axis='y'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=height, location=B(*center))
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    if col:
        link(o, col)
    return o


def sphere(name, center, scale, material, col=None, subdiv=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=1, location=B(*center))
    o = bpy.context.active_object
    o.name = name
    o.scale = (scale[0], scale[2], scale[1])
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    if col:
        link(o, col)
    return o


def plane(name, center, w, h, material, facing='+z', col=None):
    """Vertical/horizontal rectangle. facing: normal direction in three coords."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=B(*center))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, h, 1)
    # blender plane faces +Z(blender) = +y three. Rotate to requested facing.
    rot = {
        '+y': (0, 0, 0),
        '-y': (math.pi, 0, 0),
        '+z': (math.pi / 2, 0, 0),    # normal -> blender -y (= three +z), local y stays "up"
        '-z': (math.pi / 2, 0, math.pi),
        '+x': (math.pi / 2, 0, math.pi / 2),
        '-x': (math.pi / 2, 0, -math.pi / 2),
    }[facing]
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(material)
    if col:
        link(o, col)
    return o


# ---------------------------------------------------------------------------------------------
# furniture (office-local three coordinates: origin = office centre at floor level)

def office_chair(L, col, x, z, rot_y=0.0):
    parts = []
    c, s = math.cos(rot_y), math.sin(rot_y)

    def at(lx, lz):
        return (x + lx * c + lz * s, z - lx * s + lz * c)

    for i in range(5):
        a = i / 5 * math.tau
        px, pz = at(math.cos(a) * 0.17, math.sin(a) * 0.17)
        o = box('chair_spoke', (px, 0.07, pz), (0.34, 0.035, 0.05), L['black_metal'], bevel=0.008, col=col)
        rot_obj(o, (0, -a + rot_y, 0))
        parts.append(o)
        wx, wz = at(math.cos(a) * 0.33, math.sin(a) * 0.33)
        parts.append(sphere('chair_wheel', (wx, 0.035, wz), (0.035, 0.035, 0.035), L['black_metal'], col=col))
    parts.append(cyl('chair_pole', (x, 0.27, z), 0.025, 0.38, L['chrome'], col=col))
    seat = box('chair_seat', (x, 0.49, z), (0.52, 0.08, 0.5), L['fabric_charcoal'], bevel=0.03, col=col)
    rot_obj(seat, (0, rot_y, 0))
    bx, bz = at(0, 0.27)
    back = box('chair_back', (bx, 0.9, bz), (0.5, 0.64, 0.07), L['fabric_charcoal'], bevel=0.03, col=col)
    rot_obj(back, (0.12 * math.cos(rot_y), rot_y, 0))
    parts += [seat, back]
    for sd in (-1, 1):
        ax, az = at(sd * 0.28, 0.02)
        arm = box('chair_arm', (ax, 0.68, az), (0.05, 0.03, 0.3), L['black_metal'], bevel=0.01, col=col)
        rot_obj(arm, (0, rot_y, 0))
        px, pz = at(sd * 0.28, 0.1)
        post = box('chair_post', (px, 0.6, pz), (0.03, 0.16, 0.03), L['black_metal'], col=col)
        parts += [arm, post]
    return parts


def visitor_chair(L, col, x, z, rot_y=0.0):
    c, s = math.cos(rot_y), math.sin(rot_y)

    def at(lx, lz):
        return (x + lx * c + lz * s, z - lx * s + lz * c)

    seat = box('vchair_seat', (x, 0.46, z), (0.48, 0.07, 0.46), L['leather'], bevel=0.025, col=col)
    rot_obj(seat, (0, rot_y, 0))
    bx, bz = at(0, -0.22)
    back = box('vchair_back', (bx, 0.74, bz), (0.46, 0.46, 0.06), L['leather'], bevel=0.025, col=col)
    rot_obj(back, (-0.1 * math.cos(rot_y), rot_y, 0))
    for lx, lz in ((-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)):
        px, pz = at(lx, lz)
        cyl('vchair_leg', (px, 0.21, pz), 0.012, 0.42, L['chrome'], verts=12, col=col)


def sofa(L, col, x, z, rot_y, length, material):
    c, s = math.cos(rot_y), math.sin(rot_y)

    def at(lx, lz):
        return (x + lx * c + lz * s, z - lx * s + lz * c)

    base = box('sofa_base', (x, 0.3, z), (length, 0.26, 0.85), material, bevel=0.04, col=col)
    rot_obj(base, (0, rot_y, 0))
    bx, bz = at(0, -0.34)
    back = box('sofa_back', (bx, 0.64, bz), (length, 0.5, 0.2), material, bevel=0.06, col=col)
    rot_obj(back, (0, rot_y, 0))
    for sd in (-1, 1):
        ax, az = at(sd * (length / 2 - 0.08), 0)
        arm = box('sofa_arm', (ax, 0.52, az), (0.16, 0.36, 0.85), material, bevel=0.05, col=col)
        rot_obj(arm, (0, rot_y, 0))
    seats = max(1, round(length / 0.8))
    for i in range(seats):
        cx, cz = at(-length / 2 + 0.16 + (length - 0.32) * (i + 0.5) / seats, 0.06)
        cu = box('sofa_cushion', (cx, 0.48, cz), ((length - 0.36) / seats - 0.02, 0.12, 0.68), material, bevel=0.05, col=col)
        rot_obj(cu, (0, rot_y, 0))
    for lx, lz in ((-length / 2 + 0.1, -0.35), (length / 2 - 0.1, -0.35), (-length / 2 + 0.1, 0.35), (length / 2 - 0.1, 0.35)):
        px, pz = at(lx, lz)
        cyl('sofa_leg', (px, 0.08, pz), 0.02, 0.16, L['black_metal'], verts=10, col=col)


def plant(L, col, x, z, scale=1.0, seed=1, y=0.0):
    rnd = random.Random(seed)
    cyl('pot', (x, y + 0.28 * scale, z), 0.25 * scale, 0.56 * scale, L['ceramic'], col=col)
    cyl('soil', (x, y + 0.555 * scale, z), 0.22 * scale, 0.01, L['soil'], col=col)
    # stems + many elongated leaves
    for i in range(int(22 * scale) + 8):
        a = rnd.random() * math.tau
        r = rnd.random() * 0.2 * scale
        h = (0.7 + rnd.random() * 0.9) * scale
        lx, lz = x + math.cos(a) * r, z + math.sin(a) * r
        leaf = sphere('leaf', (lx, y + h, lz), (0.2 * scale, 0.025 * scale, 0.09 * scale), L['leaf'] if i % 2 else L['leaf_dark'], col=col, subdiv=1)
        rot_obj(leaf, (rnd.uniform(-0.6, 0.6), a, rnd.uniform(-0.5, 0.5)))
    for i in range(5):
        a = rnd.random() * math.tau
        st = cyl('stem', (x + math.cos(a) * 0.05, y + 0.55 * scale + 0.4 * scale, z + math.sin(a) * 0.05), 0.008, 0.8 * scale, L['stem'], verts=6, col=col)
        rot_obj(st, (rnd.uniform(-0.2, 0.2), 0, rnd.uniform(-0.2, 0.2)))


def floor_lamp(L, col, x, z):
    cyl('lamp_base', (x, 0.015, z), 0.15, 0.03, L['black_metal'], col=col)
    cyl('lamp_pole', (x, 0.8, z), 0.012, 1.6, L['black_metal'], verts=10, col=col)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.25, radius2=0.16, depth=0.32, location=B(x, 1.62, z), end_fill_type='NOTHING')
    o = bpy.context.active_object
    o.name = 'lamp_shade'
    o.data.materials.append(L['shade'])
    bpy.ops.object.shade_smooth()
    link(o, col)
    md = o.modifiers.new('solid', 'SOLIDIFY')
    md.thickness = 0.005
