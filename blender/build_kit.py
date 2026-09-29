"""DEV OFFICE — Blender kit builder + light baker.

Usage (headless):
  blender -b --factory-startup -P blender/build_kit.py -- --module office --preview out.png
  blender -b --factory-startup -P blender/build_kit.py -- --module office --bake web/public/kit --size 2048 --samples 512

Each module is authored in the web app's coordinate frame (see kit_lib.B), lit with a physical
sky + interior fixtures, and its full global illumination is baked into one texture atlas. The
runtime renders those meshes unlit, so the browser pays ~nothing for lighting.
"""
import argparse
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_lib as K  # noqa: E402
from kit_lib import B  # noqa: E402

W, D, CEIL, H = 5.2, 5.6, 3.05, 3.6
CORR = 3.2
DOOR_X, DOOR_W = -1.65, 1.15

# ---------------------------------------------------------------------------------------------
# lighting


def sky_world(strength=1.0, elevation=22.0, rotation=200.0):
    w = bpy.data.worlds.new('sky')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'MULTIPLE_SCATTERING'
    sky.sun_elevation = math.radians(elevation)
    sky.sun_rotation = math.radians(rotation)
    sky.sun_intensity = 0.55
    sky.sun_size = math.radians(2.0)
    sky.air_density = 1.2
    sky.aerosol_density = 2.0
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength
    return w


def area_light(name, center, size, power, color=(1.0, 0.9, 0.78), col=None, shape='SQUARE', size_y=None):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = power
    d.color = color
    d.shape = shape
    d.size = size
    if size_y is not None:
        d.size_y = size_y
    o = bpy.data.objects.new(name, d)
    o.location = B(*center)  # area lights point down (-Z blender) by default = -y three
    (col or bpy.context.scene.collection).objects.link(o)
    return o


# ---------------------------------------------------------------------------------------------
# modules


def shell(L, col, glass_col, front='glass'):
    """Office/lounge bay shell: floor, ceiling slab, side walls, window wall, corridor front."""
    K.box('floor', (0, -0.11, 0), (W, 0.22, D), L['oak'], col=col)
    K.box('ceiling', (0, CEIL + (H - CEIL) / 2, 0), (W, H - CEIL, D), L['ceiling'], col=col)
    K.box('spandrel', (0, CEIL + (H - CEIL) / 2, D / 2 + 0.03), (W, H - CEIL, 0.06), L['accent'], col=col)
    K.box('slab_edge', (0, -0.11, D / 2 + 0.03), (W, 0.22, 0.06), L['accent'], col=col)
    for sx in (-1, 1):
        K.box('side_wall', (sx * (W / 2 - 0.035), CEIL / 2, 0), (0.07, CEIL, D), L['plaster'], col=col)
    # skirting
    for sx in (-1, 1):
        K.box('skirting', (sx * (W / 2 - 0.075), 0.04, 0), (0.012, 0.08, D - 0.1), L['white'], col=col)
    # exterior curtain wall
    for x in (-W / 2 + 0.07, -1.3, 0.0, 1.3, W / 2 - 0.07):
        K.box('mullion', (x, CEIL / 2, D / 2), (0.05, CEIL, 0.08), L['black_metal'], bevel=0.004, col=col)
    K.box('sill', (0, 0.03, D / 2), (W, 0.06, 0.09), L['black_metal'], col=col)
    K.box('head', (0, CEIL - 0.03, D / 2), (W, 0.06, 0.09), L['black_metal'], col=col)
    K.plane('glass_window', (0, CEIL / 2, D / 2), W, CEIL, L['glass'], facing='+z', col=glass_col)
    if front == 'glass':
        zf = -D / 2
        d0, d1 = DOOR_X - DOOR_W / 2, DOOR_X + DOOR_W / 2
        for x in (-W / 2 + 0.07, d0, d1, 0.3, 1.45, W / 2 - 0.07):
            K.box('front_mullion', (x, CEIL / 2, zf), (0.05, CEIL, 0.07), L['black_metal'], bevel=0.004, col=col)
        K.box('front_head', (0, CEIL - 0.03, zf), (W, 0.06, 0.08), L['black_metal'], col=col)
        K.box('front_sill_l', ((-W / 2 + d0) / 2, 0.025, zf), (d0 + W / 2, 0.05, 0.08), L['black_metal'], col=col)
        K.box('front_sill_r', ((d1 + W / 2) / 2, 0.025, zf), (W / 2 - d1, 0.05, 0.08), L['black_metal'], col=col)
        K.box('door_header', (DOOR_X, 2.2, zf), (DOOR_W, 0.08, 0.08), L['black_metal'], col=col)
        K.plane('glass_front_l', ((-W / 2 + d0) / 2, CEIL / 2, zf), d0 + W / 2, CEIL, L['glass'], facing='-z', col=glass_col)
        K.plane('glass_front_r', ((d1 + W / 2) / 2, CEIL / 2, zf), W / 2 - d1, CEIL, L['glass'], facing='-z', col=glass_col)
        K.plane('glass_transom', (DOOR_X, (2.24 + CEIL) / 2, zf), DOOR_W, CEIL - 2.24, L['glass'], facing='-z', col=glass_col)
        # frosted privacy band
        K.box('frost_band', ((d1 + W / 2) / 2, 1.1, zf + 0.012), (W / 2 - d1, 0.3, 0.004), L['white'], col=col)
    # recessed ceiling light panel (baked emitter)
    K.box('emit_panel', (0, CEIL - 0.011, 0.3), (1.2, 0.02, 1.2), L['panel_light'], col=col)
    for x in (-1.6, 1.6):
        K.cyl('downlight', (x, CEIL - 0.006, -1.6), 0.08, 0.012, L['panel_light'], col=col)


def office_furniture(L, col):
    # rug + desk
    K.box('rug', (0.3, 0.005, 1.15), (3.4, 0.01, 2.7), L['rug'], bevel=0.004, col=col)
    K.box('desk_top', (0.3, 0.745, 1.2), (1.9, 0.05, 0.9), L['walnut'], bevel=0.012, col=col)
    for sx in (-0.9, 0.9):
        K.box('desk_leg', (0.3 + sx, 0.36, 1.2), (0.05, 0.72, 0.82), L['black_metal'], bevel=0.006, col=col)
    K.box('desk_modesty', (0.3, 0.48, 0.8), (1.72, 0.42, 0.025), L['walnut'], col=col)
    K.cyl('mug', (0.98, 0.815, 1.42), 0.04, 0.1, L['ceramic'], col=col)
    K.box('notebook', (-0.3, 0.775, 1.3), (0.21, 0.015, 0.29), L['book_black'], bevel=0.003, col=col)
    K.office_chair(L, col, 0.3, 1.86, 0.0)
    K.visitor_chair(L, col, -0.25, 0.15, 0.0)
    K.visitor_chair(L, col, 0.85, 0.15, 0.0)
    # bookshelf along +x wall
    bx = 2.4
    for z in (0.12, 2.08):
        K.box('shelf_side', (bx, 0.95, z), (0.36, 1.9, 0.04), L['walnut'], bevel=0.004, col=col)
    K.box('shelf_back', (bx + 0.17, 0.95, 1.1), (0.02, 1.9, 1.96), L['walnut'], col=col)
    rnd = random.Random(5)
    books = [L[k] for k in ('book_red', 'book_blue', 'book_cream', 'book_green', 'book_black', 'book_orange', 'book_teal')]
    for s in range(5):
        y = 0.05 + s * 0.44
        K.box('shelf', (bx, y, 1.1), (0.36, 0.03, 1.96), L['walnut'], bevel=0.003, col=col)
        if s == 4:
            continue
        z = 0.18
        while z < 2.0:
            w = 0.03 + rnd.random() * 0.04
            h = 0.24 + rnd.random() * 0.12
            if rnd.random() < 0.12:
                z += 0.12
                continue
            b = K.box('book', (bx - 0.02, y + 0.015 + h / 2, z + w / 2), (0.24, h, w), rnd.choice(books), bevel=0.003, col=col)
            if rnd.random() < 0.08:
                K.rot_obj(b, (0, 0, 0.18))
            z += w + 0.004
    # credenza + TV housing on the -x wall (screen is a runtime overlay)
    K.box('credenza', (-2.28, 0.3, 0.9), (0.45, 0.6, 1.7), L['walnut'], bevel=0.01, col=col)
    K.box('credenza_base', (-2.28, 0.03, 0.9), (0.4, 0.06, 1.6), L['black_metal'], col=col)
    K.box('tv_body', (-2.51, 1.55, 0.9), (0.04, 0.84, 1.46), L['screen_off'], bevel=0.006, col=col)
    # lounge corner
    K.sofa(L, col, 2.05, -1.35, -math.pi / 2, 1.8, L['fabric_teal'])
    K.cyl('coffee_table', (1.05, 0.4, -1.35), 0.35, 0.04, L['walnut'], col=col)
    K.cyl('coffee_leg', (1.05, 0.2, -1.35), 0.025, 0.38, L['black_metal'], verts=12, col=col)
    # framed canvas, hung proud of the wall (inner wall face is x = 2.53)
    K.box('art_frame', (2.51, 1.75, -1.35), (0.03, 0.85, 1.25), L['black_metal'], col=col)
    K.box('art', (2.49, 1.75, -1.35), (0.012, 0.78, 1.18), L['art'], col=col)
    K.plant(L, col, -2.05, 2.3, 1.15, seed=11)
    K.plant(L, col, 2.2, -2.4, 0.8, seed=17)
    K.floor_lamp(L, col, 1.62, 2.45)


def lounge_furniture(L, col):
    K.box('rug', (0, 0.005, 0.6), (3.6, 0.01, 3.0), L['rug'], bevel=0.004, col=col)
    K.sofa(L, col, 0, 1.9, math.pi, 2.4, L['leather'])
    K.sofa(L, col, -1.6, 0.4, math.pi / 2, 1.0, L['fabric_mustard'])
    K.sofa(L, col, 1.6, 0.4, -math.pi / 2, 1.0, L['fabric_mustard'])
    K.cyl('coffee_table', (0, 0.38, 0.5), 0.55, 0.05, L['walnut'], col=col)
    K.cyl('coffee_leg', (0, 0.18, 0.5), 0.04, 0.36, L['black_metal'], verts=12, col=col)
    K.plant(L, col, -2.1, 2.3, 1.3, seed=23)
    K.plant(L, col, 2.1, 2.3, 1.1, seed=29)
    K.plant(L, col, 0, 0.5, 0.35, seed=31, y=0.41)


def bay_proxies(L, proxy_col):
    """Stand-ins for what surrounds a bay (corridor, opposite offices, ground) — bake context only."""
    K.box('p_corr_floor', (0, -0.11, -D / 2 - CORR / 2), (W + 4, 0.22, CORR), L['concrete'], col=proxy_col)
    K.box('p_corr_ceiling', (0, CEIL + 0.25, -D / 2 - CORR / 2), (W + 4, 0.5, CORR), L['ceiling'], col=proxy_col)
    K.box('p_opposite', (0, CEIL / 2, -D / 2 - CORR - 0.1), (W + 4, CEIL, 0.2), L['proxy'], col=proxy_col)
    K.box('p_ground', (0, -4.0, D / 2 + 30), (200, 0.1, 60), K.mat('p_grass', K.srgb('#4b6a36'), rough=1), col=proxy_col)
    area_light('corr_light', (0, CEIL - 0.05, -D / 2 - CORR / 2), 0.4, 90, col=proxy_col, shape='RECTANGLE', size_y=4.0)


def build_bay(kind):
    L = K.library()
    arch = K.collection('arch')
    props = K.collection('props')
    glass = K.collection('glass')
    proxy = K.collection('proxy')
    shell(L, arch, glass, front='glass' if kind == 'office' else 'open')
    (office_furniture if kind == 'office' else lounge_furniture)(L, props)
    bay_proxies(L, proxy)
    area_light('panel_light', (0, CEIL - 0.03, 0.3), 1.2, 140, col=proxy)
    area_light('lamp_fill', (1.62, 1.5, 2.45), 0.3, 12, color=(1.0, 0.82, 0.6), col=proxy)
    sky_world(strength=1.0)
    return arch, glass


def _core(fn):
    def run():
        import core_modules as CM
        getattr(CM, fn)()
        sky_world(strength=1.0)
    return run


MODULES = {
    'office': lambda: build_bay('office'),
    'lounge': lambda: build_bay('lounge'),
    'corridor': _core('build_corridor'),
    'core0': _core('build_core0'),
    'core1': _core('build_core1'),
}


# ---------------------------------------------------------------------------------------------
# preview render


def preview(path, cam_pos, target, samples=96, res=(1280, 720)):
    sc = bpy.context.scene
    cam_d = bpy.data.cameras.new('cam')
    cam_d.lens = 22
    cam = bpy.data.objects.new('cam', cam_d)
    sc.collection.objects.link(cam)
    cam.location = B(*cam_pos)
    direction = B(*target) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.cycles.samples = samples
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    # glass renders as real glass in the preview
    g = bpy.data.materials['GLASS'].node_tree.nodes['Principled BSDF']
    g.inputs['Transmission Weight'].default_value = 1.0
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--module', default='office')
    ap.add_argument('--preview')
    ap.add_argument('--cam', default='-1.65,1.6,-4.6')
    ap.add_argument('--target', default='0.4,1.0,1.2')
    ap.add_argument('--samples', type=int, default=96)
    ap.add_argument('--device', default='cpu', choices=['cpu', 'gpu'])
    ap.add_argument('--bake')
    ap.add_argument('--size', type=int, default=2048)
    ap.add_argument('--light-size', type=int, default=1024)
    ap.add_argument('--exposure', type=float, default=0.0)
    a = ap.parse_args(argv)
    K.reset(a.device)
    MODULES[a.module]()
    if a.bake:
        import bake as BK
        parts = [(n, bpy.data.collections[n]) for n in ('arch', 'props') if n in bpy.data.collections]
        BK.bake_module(a.module, parts, bpy.data.collections['glass'], os.path.abspath(a.bake),
                       size=a.size, light_size=a.light_size, samples=a.samples, exposure=a.exposure)
        return
    if a.preview:
        preview(os.path.abspath(a.preview), tuple(map(float, a.cam.split(','))), tuple(map(float, a.target.split(','))), a.samples)


if __name__ == '__main__':
    main()
