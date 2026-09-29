"""Lobby (core) and corridor modules for the DEV OFFICE kit. World-aligned: the core block spans
x∈[0, CORE], z∈[-HZ, HZ]; the corridor segment is centred on its bay (x∈[-W/2, W/2], z∈[-CORR/2, CORR/2]).
Dimensions mirror web/scene/building/plan.ts."""
import math

import bpy

import kit_lib as K
from kit_lib import B

W, D, CEIL, H = 5.2, 5.6, 3.05, 3.6
CORR = 3.2
CORE = 11.0
HZ = CORR / 2 + D
STAIRS = dict(x0=2.6, x1=8.6, z0=2.3, z1=4.2)
LIFT = dict(x0=8.0, x1=10.4, z0=-4.6, z1=-2.2, dx0=8.6, dx1=9.8)
RECEPTION = dict(x0=3.0, x1=5.6, z0=-4.3, z1=-3.3)


def cut(target, hole_center, hole_size):
    """Boolean-difference an axis-aligned hole out of target (applied at join time)."""
    h = K.box('__cutter__', hole_center, hole_size, K.mat('proxy', (0.5, 0.5, 0.5)))
    md = target.modifiers.new('hole', 'BOOLEAN')
    md.operation = 'DIFFERENCE'
    md.object = h
    md.solver = 'EXACT'
    h.hide_render = True
    h.hide_viewport = True
    return h


def curtain_wall(L, arch, glass, x0, x1, z, facing, entrance=None):
    """Exterior glazing along x at depth z (facing ±z), with mullions every ~1.3 m."""
    length = x1 - x0
    n = max(1, round(length / 1.3))
    for i in range(n + 1):
        x = x0 + length * i / n
        if entrance and entrance[0] < x < entrance[1]:
            continue
        K.box('mullion', (x, CEIL / 2, z), (0.05, CEIL, 0.08), L['black_metal'], bevel=0.004, col=arch)
    K.box('sill', ((x0 + x1) / 2, 0.03, z), (length, 0.06, 0.09), L['black_metal'], col=arch)
    K.box('head', ((x0 + x1) / 2, CEIL - 0.03, z), (length, 0.06, 0.09), L['black_metal'], col=arch)
    K.plane('glass_facade', ((x0 + x1) / 2, CEIL / 2, z), length, CEIL, L['glass'], facing=facing, col=glass)


def curtain_wall_z(L, arch, glass, z0, z1, x, facing, gap=None):
    """Exterior glazing along z at x (west façade)."""
    length = z1 - z0
    n = max(1, round(length / 1.3))
    for i in range(n + 1):
        z = z0 + length * i / n
        if gap and gap[0] - 0.01 < z < gap[1] + 0.01:
            continue
        K.box('mullion', (x, CEIL / 2, z), (0.08, CEIL, 0.05), L['black_metal'], bevel=0.004, col=arch)
    K.box('sill', (x, 0.03, (z0 + z1) / 2), (0.09, 0.06, length), L['black_metal'], col=arch)
    K.box('head', (x, CEIL - 0.03, (z0 + z1) / 2), (0.09, 0.06, length), L['black_metal'], col=arch)
    segs = [(z0, z1)] if not gap else [(z0, gap[0]), (gap[1], z1)]
    for a, b in segs:
        K.plane('glass_facade', (x, CEIL / 2, (a + b) / 2), b - a, CEIL, L['glass'], facing=facing, col=glass)
    if gap:
        # entrance canopy + door frame
        K.box('door_post', (x, 1.15, gap[0]), (0.12, 2.3, 0.08), L['aluminium'], col=arch)
        K.box('door_post', (x, 1.15, gap[1]), (0.12, 2.3, 0.08), L['aluminium'], col=arch)
        K.box('door_head', (x, 2.34, (gap[0] + gap[1]) / 2), (0.14, 0.1, gap[1] - gap[0]), L['aluminium'], col=arch)
        K.box('canopy', (x - 1.1, 3.2, (gap[0] + gap[1]) / 2), (2.2, 0.14, gap[1] - gap[0] + 2.4), L['accent'], bevel=0.01, col=arch)
        K.box('mat', (x + 1.0, 0.004, (gap[0] + gap[1]) / 2), (1.6, 0.008, gap[1] - gap[0]), L['rug'], col=arch)


def slab_and_shell(L, arch, glass, floor, holes, entrance):
    """Floor, ceiling slab (with voids), façade bands and the core/office dividing wall."""
    fl = K.box('floor', (CORE / 2, -0.11, 0), (CORE, 0.22, 2 * HZ), L['concrete'], col=arch)
    for c, s in holes.get('floor', []):
        cut(fl, c, s)
    ce = K.box('ceiling', (CORE / 2, CEIL + (H - CEIL) / 2, 0), (CORE, H - CEIL, 2 * HZ), L['ceiling'], col=arch)
    for c, s in holes.get('ceiling', []):
        cut(ce, c, s)
    for z in (HZ + 0.03, -HZ - 0.03):
        K.box('spandrel', (CORE / 2, CEIL + (H - CEIL) / 2, z), (CORE, H - CEIL, 0.06), L['accent'], col=arch)
        K.box('slab_edge', (CORE / 2, -0.11, z), (CORE, 0.22, 0.06), L['accent'], col=arch)
    K.box('spandrel', (-0.03, CEIL + (H - CEIL) / 2, 0), (0.06, H - CEIL, 2 * HZ + 0.12), L['accent'], col=arch)
    K.box('slab_edge', (-0.03, -0.11, 0), (0.06, 0.22, 2 * HZ + 0.12), L['accent'], col=arch)
    curtain_wall(L, arch, glass, 0, CORE, HZ, '+z')
    curtain_wall(L, arch, glass, 0, CORE, -HZ, '-z')
    curtain_wall_z(L, arch, glass, -HZ, HZ, 0.0, '-x', gap=entrance)
    # half of the dividing wall towards the first office bay (the office module owns the other half)
    for zc in ((CORR / 2 + HZ) / 2, -(CORR / 2 + HZ) / 2):
        K.box('divider', (CORE - 0.035, CEIL / 2, zc), (0.07, CEIL, HZ - CORR / 2), L['plaster'], col=arch)
    # lift shaft (plaster) with landing opening on the corridor side
    t = 0.07
    K.box('shaft_w', (LIFT['x0'], CEIL / 2, (LIFT['z0'] + LIFT['z1']) / 2), (2 * t, CEIL, LIFT['z1'] - LIFT['z0']), L['plaster'], col=arch)
    K.box('shaft_e', (LIFT['x1'], CEIL / 2, (LIFT['z0'] + LIFT['z1']) / 2), (2 * t, CEIL, LIFT['z1'] - LIFT['z0']), L['plaster'], col=arch)
    K.box('shaft_s', ((LIFT['x0'] + LIFT['x1']) / 2, CEIL / 2, LIFT['z0']), (LIFT['x1'] - LIFT['x0'], CEIL, 2 * t), L['plaster'], col=arch)
    K.box('shaft_nl', ((LIFT['x0'] + LIFT['dx0']) / 2, CEIL / 2, LIFT['z1']), (LIFT['dx0'] - LIFT['x0'], CEIL, 2 * t), L['plaster'], col=arch)
    K.box('shaft_nr', ((LIFT['dx1'] + LIFT['x1']) / 2, CEIL / 2, LIFT['z1']), (LIFT['x1'] - LIFT['dx1'], CEIL, 2 * t), L['plaster'], col=arch)
    K.box('shaft_head', ((LIFT['dx0'] + LIFT['dx1']) / 2, (2.2 + CEIL) / 2, LIFT['z1']), (LIFT['dx1'] - LIFT['dx0'], CEIL - 2.2, 2 * t), L['plaster'], col=arch)
    K.box('landing_frame', ((LIFT['dx0'] + LIFT['dx1']) / 2, 2.25, LIFT['z1'] + 0.08), (LIFT['dx1'] - LIFT['dx0'] + 0.16, 0.1, 0.04), L['aluminium'], col=arch)
    for x in (LIFT['dx0'] - 0.04, LIFT['dx1'] + 0.04):
        K.box('landing_post', (x, 1.1, LIFT['z1'] + 0.08), (0.08, 2.2, 0.04), L['aluminium'], col=arch)
    # ceiling light panels
    for x, z in ((2.0, -5.5), (5.0, -5.5), (2.0, 5.8), (5.6, -1.0), (9.6, 5.5), (2.0, 0.0), (5.6, 1.2)):
        K.box('emit_panel', (x, CEIL - 0.011, z), (1.2, 0.02, 1.2), L['panel_light'], col=arch)


def stairs(L, arch, glass):
    steps = 20
    run = (STAIRS['x1'] - STAIRS['x0']) / steps
    rise = H / steps
    w = STAIRS['z1'] - STAIRS['z0']
    cz = (STAIRS['z0'] + STAIRS['z1']) / 2
    for i in range(steps):
        K.box('tread', (STAIRS['x0'] + (i + 0.5) * run, (i + 1) * rise - 0.025, cz), (run + 0.02, 0.05, w - 0.1), L['walnut'], bevel=0.006, col=arch)
    length = math.hypot(STAIRS['x1'] - STAIRS['x0'], H)
    ang = math.atan2(H, STAIRS['x1'] - STAIRS['x0'])
    for z in (STAIRS['z0'] + 0.04, STAIRS['z1'] - 0.04):
        s = K.box('stringer', ((STAIRS['x0'] + STAIRS['x1']) / 2, H / 2 - 0.12, z), (length, 0.3, 0.05), L['black_metal'], col=arch)
        K.rot_obj(s, (0, 0, ang))
    rail = K.box('handrail', ((STAIRS['x0'] + STAIRS['x1']) / 2, H / 2 + 1.0, STAIRS['z0'] + 0.02), (length, 0.05, 0.06), L['black_metal'], bevel=0.01, col=arch)
    K.rot_obj(rail, (0, 0, ang))
    g = K.plane('glass_stair', ((STAIRS['x0'] + STAIRS['x1']) / 2, H / 2 + 0.5, STAIRS['z0'] + 0.02), length, 0.95, L['glass'], facing='-z', col=glass)
    K.rot_obj(g, (0, 0, ang))
    # slatted walnut wall closing the space beneath the flight
    for i in range(24):
        x = STAIRS['x0'] + 0.5 + i * 0.23
        h = max(0.05, (x - STAIRS['x0']) / (STAIRS['x1'] - STAIRS['x0']) * H - 0.25)
        K.box('slat', (x, h / 2, STAIRS['z0'] - 0.03), (0.08, h, 0.05), L['walnut'], col=arch)
    K.box('under_wall', ((STAIRS['x0'] + 0.4 + STAIRS['x1']) / 2, 0.9, STAIRS['z0'] + 0.05), (STAIRS['x1'] - STAIRS['x0'] - 0.4, 1.8, 0.04), L['accent'], col=arch)


def logo(L, arch, text, center, size=0.42):
    bpy.ops.object.text_add(location=B(*center))
    t = bpy.context.active_object
    t.data.body = text
    t.data.align_x = 'CENTER'
    t.data.align_y = 'CENTER'
    t.data.size = size
    t.data.extrude = 0.01
    t.rotation_euler = (math.pi / 2, 0, 0)
    t.data.materials.append(K.mat('logo_light', K.srgb('#e8fbff'), rough=0.4, emit=K.srgb('#bff6ff'), emit_strength=6.0))
    bpy.ops.object.convert(target='MESH')
    K.link(bpy.context.active_object, arch)


def area(name, c, size, power, col, color=(1.0, 0.9, 0.78), size_y=None):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = power
    d.color = color
    d.size = size
    if size_y:
        d.shape = 'RECTANGLE'
        d.size_y = size_y
    o = bpy.data.objects.new(name, d)
    o.location = B(*c)
    col.objects.link(o)


def core_proxies(L, proxy):
    # corridor continuing east + ground outside + opposite façade bounce
    K.box('p_corr', (CORE + 6, -0.11, 0), (12, 0.22, CORR), L['concrete'], col=proxy)
    K.box('p_corr_c', (CORE + 6, CEIL + 0.25, 0), (12, 0.5, CORR), L['ceiling'], col=proxy)
    K.box('p_ground', (CORE / 2, -0.4, 0), (200, 0.1, 200), K.mat('p_grass', K.srgb('#4b6a36'), rough=1), col=proxy)
    area('p_corr_light', (CORE + 4, CEIL - 0.05, 0), 0.4, 120, proxy, size_y=6)


def build_core0():
    L = K.library()
    arch, props, glass, proxy = (K.collection(n) for n in ('arch', 'props', 'glass', 'proxy'))
    holes = {'ceiling': [
        (((STAIRS['x0'] + STAIRS['x1']) / 2, CEIL + 0.3, (STAIRS['z0'] + STAIRS['z1']) / 2), (STAIRS['x1'] - STAIRS['x0'], 1.0, STAIRS['z1'] - STAIRS['z0'])),
        (((LIFT['x0'] + LIFT['x1']) / 2, CEIL + 0.3, (LIFT['z0'] + LIFT['z1']) / 2), (LIFT['x1'] - LIFT['x0'] - 0.14, 1.0, LIFT['z1'] - LIFT['z0'] - 0.14)),
    ]}
    slab_and_shell(L, arch, glass, 0, holes, entrance=(-1.3, 1.3))
    stairs(L, arch, glass)
    # reception + backlit name wall
    rx, rz = (RECEPTION['x0'] + RECEPTION['x1']) / 2, (RECEPTION['z0'] + RECEPTION['z1']) / 2
    K.box('reception', (rx, 0.55, rz), (RECEPTION['x1'] - RECEPTION['x0'], 1.1, RECEPTION['z1'] - RECEPTION['z0']), L['walnut'], bevel=0.02, col=props)
    K.box('reception_top', (rx, 1.12, rz), (RECEPTION['x1'] - RECEPTION['x0'] + 0.1, 0.04, RECEPTION['z1'] - RECEPTION['z0'] + 0.1), L['white'], bevel=0.01, col=props)
    K.box('name_wall', (rx, 1.6, -HZ + 0.14), (4.6, 3.0, 0.1), L['accent'], col=arch)
    logo(L, arch, 'ARJUN CHANDRA', (rx, 2.1, -HZ + 0.2), 0.36)
    logo(L, arch, 'DEV OFFICE', (rx, 1.62, -HZ + 0.2), 0.18)
    # waiting lounge by the entrance + plants
    K.sofa(L, props, 1.3, 4.9, math.pi / 2, 2.2, L['leather'])
    K.cyl('lobby_table', (2.55, 0.38, 4.9), 0.45, 0.04, L['walnut'], col=props)
    K.cyl('lobby_table_leg', (2.55, 0.18, 4.9), 0.04, 0.36, L['black_metal'], col=props)
    K.box('lobby_rug', (2.1, 0.005, 4.9), (2.8, 0.01, 3.2), L['rug'], col=props)
    for (x, z, s, seed) in ((0.7, 6.6, 1.2, 3), (0.7, -6.6, 1.1, 4), (10.4, 6.4, 1.0, 5), (7.2, -6.5, 0.9, 6)):
        K.plant(L, props, x, z, s, seed=seed)
    for (x, z) in ((2.0, -5.5), (5.0, -5.5), (2.0, 5.8), (5.6, -1.0), (9.6, 5.5), (2.0, 0.0), (5.6, 1.2)):
        area('panel', (x, CEIL - 0.03, z), 1.2, 110, proxy)
    core_proxies(L, proxy)


def build_core1():
    L = K.library()
    arch, props, glass, proxy = (K.collection(n) for n in ('arch', 'props', 'glass', 'proxy'))
    holes = {
        'floor': [
            (((STAIRS['x0'] + STAIRS['x1']) / 2, -0.1, (STAIRS['z0'] + STAIRS['z1']) / 2), (STAIRS['x1'] - STAIRS['x0'], 1.0, STAIRS['z1'] - STAIRS['z0'])),
            (((LIFT['x0'] + LIFT['x1']) / 2, -0.1, (LIFT['z0'] + LIFT['z1']) / 2), (LIFT['x1'] - LIFT['x0'] - 0.14, 1.0, LIFT['z1'] - LIFT['z0'] - 0.14)),
        ],
        'ceiling': [
            (((LIFT['x0'] + LIFT['x1']) / 2, CEIL + 0.3, (LIFT['z0'] + LIFT['z1']) / 2), (LIFT['x1'] - LIFT['x0'] - 0.14, 1.0, LIFT['z1'] - LIFT['z0'] - 0.14)),
        ],
    }
    slab_and_shell(L, arch, glass, 1, holes, entrance=None)
    # railings around the stair void (glass infill is a runtime pane)
    x0, x1, z0, z1 = STAIRS['x0'], STAIRS['x1'], STAIRS['z0'], STAIRS['z1']
    for (cx, cz, sx, sz) in (((x0 + x1 - 0.3) / 2, z0, x1 - x0 - 0.3, 0.06), ((x0 + x1) / 2, z1, x1 - x0, 0.06), (x0, (z0 + z1) / 2, 0.06, z1 - z0)):
        K.box('rail_top', (cx, 1.05, cz), (sx, 0.05, sz), L['black_metal'], bevel=0.01, col=arch)
        K.box('rail_foot', (cx, 0.03, cz), (sx, 0.06, sz), L['black_metal'], col=arch)
        K.plane('glass_rail', (cx, 0.53, cz), max(sx, sz), 1.0, L['glass'], facing='-z' if sx > sz else '-x', col=glass)
    # stair-void edge fascia
    K.box('void_fascia', ((x0 + x1) / 2, -0.11, z0 - 0.01), (x1 - x0, 0.22, 0.02), L['white'], col=arch)
    # coffee bar + high table
    K.box('bar', (2.2, 0.52, -5.6), (3.2, 1.04, 0.7), L['walnut'], bevel=0.015, col=props)
    K.box('bar_top', (2.2, 1.06, -5.6), (3.3, 0.04, 0.8), L['white'], bevel=0.01, col=props)
    K.box('espresso', (1.4, 1.25, -5.75), (0.4, 0.35, 0.35), L['aluminium'], bevel=0.02, col=props)
    K.box('high_table', (4.4, 1.02, -5.2), (2.4, 0.05, 0.9), L['walnut'], bevel=0.01, col=props)
    K.box('high_table_leg', (4.4, 0.5, -5.2), (0.12, 1.0, 0.6), L['black_metal'], col=props)
    for x in (3.6, 4.4, 5.2):
        K.cyl('stool', (x, 0.75, -4.55), 0.18, 0.05, L['leather'], col=props)
        K.cyl('stool_leg', (x, 0.37, -4.55), 0.025, 0.74, L['black_metal'], col=props)
    # reading lounge
    K.box('lounge_rug', (4.0, 0.005, 5.4), (4.2, 0.01, 2.6), L['rug'], col=props)
    K.sofa(L, props, 4.0, 6.4, math.pi, 2.6, L['fabric_teal'])
    K.sofa(L, props, 2.3, 5.2, math.pi / 2, 1.1, L['fabric_mustard'])
    K.cyl('lounge_table', (4.0, 0.38, 5.2), 0.5, 0.04, L['walnut'], col=props)
    for (x, z, s, seed) in ((0.7, 6.6, 1.2, 7), (0.7, -6.6, 1.1, 8), (6.8, -6.4, 0.9, 9), (9.8, 6.3, 1.1, 10)):
        K.plant(L, props, x, z, s, seed=seed)
    for (x, z) in ((2.0, -5.5), (5.0, -5.5), (2.0, 5.8), (5.6, -1.0), (9.6, 5.5), (2.0, 0.0), (5.6, 1.2)):
        area('panel', (x, CEIL - 0.03, z), 1.2, 110, proxy)
    core_proxies(L, proxy)
    # the ground floor below the stair void
    K.box('p_below', ((x0 + x1) / 2, -H, (z0 + z1) / 2), (x1 - x0 + 2, 0.2, z1 - z0 + 2), L['concrete'], col=proxy)


def build_corridor():
    L = K.library()
    arch, glass, proxy = (K.collection(n) for n in ('arch', 'glass', 'proxy'))
    K.box('floor', (0, -0.11, 0), (W, 0.22, CORR), L['concrete'], col=arch)
    K.box('ceiling', (0, CEIL + (H - CEIL) / 2, 0), (W, H - CEIL, CORR), L['ceiling'], col=arch)
    K.box('emit_strip', (0, CEIL - 0.011, 0), (W - 0.8, 0.02, 0.3), L['panel_light'], col=arch)
    for sx in (-1, 1):
        K.box('baseboard_rail', (0, 0.02, sx * (CORR / 2 - 0.01)), (W, 0.04, 0.02), L['black_metal'], col=arch)
    # offices either side (lit rooms seen through glass)
    for sz in (-1, 1):
        K.box('p_office_floor', (0, -0.11, sz * (CORR / 2 + D / 2)), (W + 4, 0.22, D), L['oak'], col=proxy)
        K.box('p_office_back', (0, CEIL / 2, sz * (CORR / 2 + D)), (W + 4, CEIL, 0.1), L['plaster'], col=proxy)
        area('p_office_light', (0, CEIL - 0.05, sz * (CORR / 2 + D / 2)), 1.2, 140, proxy)
    K.box('p_corr_c', (0, CEIL + 0.3, 0), (W + 12, 0.5, CORR + 12), L['ceiling'], col=proxy)
    area('corr_light', (0, CEIL - 0.04, 0), 0.3, 110, proxy, size_y=W - 0.8)
