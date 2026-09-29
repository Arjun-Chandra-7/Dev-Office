"""Bake + export stage for DEV OFFICE kit modules (Blender 5.x).

albedo (hi-res, noise free) × denoised irradiance (lower res, many samples) + emission
→ AgX tone-mapped atlas → WebP, plus a GLB whose single UV set addresses that atlas.
"""
import math
import os
import subprocess

import bpy
import numpy as np


def _select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def join_collection(col, name):
    """Apply modifiers, join every mesh in the collection into one object."""
    objs = [o for o in col.objects if o.type == 'MESH']
    for o in objs:
        _select_only([o])
        for md in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=md.name)
    _select_only(objs)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def drop_hidden_faces(ob, floor_y=0.0, top_y=3.6):
    """Remove faces nobody can see (slab undersides, ceiling-slab tops) to save atlas space."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    doomed = []
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        if n.z < -0.99 and c.z < floor_y - 0.05:  # blender z = three y
            doomed.append(f)
        elif n.z > 0.99 and c.z > top_y - 0.01:
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()
    print(f'[{ob.name}] dropped {len(doomed)} hidden faces')


def make_bake_uv(ob, margin=0.004):
    me = ob.data
    for uv in list(me.uv_layers):
        me.uv_layers.remove(uv)
    me.uv_layers.new(name='bake')
    _select_only([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    except Exception as e:  # packing is an improvement, not a requirement
        print('pack_islands skipped:', e)
    bpy.ops.object.mode_set(mode='OBJECT')


def _target_nodes(ob, img):
    """Add an (unlinked, active) image node to every material so bake writes into img."""
    for slot in ob.material_slots:
        m = slot.material
        nt = m.node_tree
        n = nt.nodes.get('__bake__') or nt.nodes.new('ShaderNodeTexImage')
        n.name = '__bake__'
        n.image = img
        n.select = True
        nt.nodes.active = n


def _metals_to_dielectric(ob):
    """Diffuse bakes see metals as black; bake them as their tint instead."""
    for slot in ob.material_slots:
        p = slot.material.node_tree.nodes.get('Principled BSDF')
        if p and p.inputs['Metallic'].default_value > 0.5:
            p.inputs['Metallic'].default_value = 0.0
            c = p.inputs['Base Color'].default_value
            p.inputs['Base Color'].default_value = (c[0] * 0.55, c[1] * 0.55, c[2] * 0.55, 1)


def bake_pass(ob, name, size, kind, samples, direct=True, indirect=True, color=True):
    img = bpy.data.images.new(name, size, size, float_buffer=True, alpha=False)
    _target_nodes(ob, img)
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    bk = sc.render.bake
    bk.margin = 12
    bk.use_clear = True
    bk.target = 'IMAGE_TEXTURES'
    if kind == 'DIFFUSE':
        bk.use_pass_direct = direct
        bk.use_pass_indirect = indirect
        bk.use_pass_color = color
    _select_only([ob])
    bpy.ops.object.bake(type=kind)
    return img


def denoise_linear(img, out_exr):
    """OIDN via the compositor in a scratch scene; returns path of the linear EXR result."""
    main = bpy.context.scene
    scn = bpy.data.scenes.new('__denoise__')
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = 1
    tree = bpy.data.node_groups.new('__den__', 'CompositorNodeTree')
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    n_img = tree.nodes.new('CompositorNodeImage')
    n_img.image = img
    n_den = tree.nodes.new('CompositorNodeDenoise')
    n_out = tree.nodes.new('NodeGroupOutput')
    tree.links.new(n_img.outputs['Image'], n_den.inputs['Image'])
    tree.links.new(n_den.outputs['Image'], n_out.inputs[0])
    scn.compositing_node_group = tree
    scn.render.use_compositing = True
    scn.render.resolution_x, scn.render.resolution_y = img.size
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'OPEN_EXR'
    scn.render.image_settings.color_depth = '32'
    bpy.ops.render.render(scene=scn.name)
    bpy.data.images['Render Result'].save_render(out_exr, scene=scn)
    bpy.context.window_manager  # keep main scene current
    bpy.data.scenes.remove(scn)
    _ = main
    return out_exr


def _pixels(img, size):
    if tuple(img.size) != (size, size):
        img.scale(size, size)
    a = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(size, size, 4)


def compose_and_save(albedo, irradiance_exr, emit, size, out_png, exposure=0.0):
    irr_img = bpy.data.images.load(irradiance_exr)
    A = _pixels(albedo, size)
    I = _pixels(irr_img, size)
    E = _pixels(emit, size)
    final = A[..., :3] * I[..., :3] + E[..., :3]
    img = bpy.data.images.new('__final__', size, size, float_buffer=True, alpha=False)
    out = np.ones((size, size, 4), dtype=np.float32)
    out[..., :3] = final
    img.pixels.foreach_set(out.ravel())
    sc = bpy.context.scene
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = exposure
    s = sc.render.image_settings
    s.file_format = 'PNG'
    s.color_depth = '8'
    s.color_mode = 'RGB'
    img.save_render(out_png, scene=sc)
    return out_png


def _single_material(baked):
    """One material slot per baked mesh (runtime swaps in the atlas by object name)."""
    me = baked.data
    for p in me.polygons:
        p.material_index = 0
    while len(baked.material_slots) > 1:
        baked.active_material_index = len(baked.material_slots) - 1
        _select_only([baked])
        bpy.ops.object.material_slot_remove()
    baked.material_slots[0].material = bpy.data.materials.get('BAKED') or bpy.data.materials.new('BAKED')


def to_webp(png, webp, quality=88):
    subprocess.run(['magick', png, '-quality', str(quality), '-define', 'webp:method=6', webp], check=True)
    return webp


def bake_part(name, col, tmp, out_dir, size, light_size, samples, exposure):
    ob = join_collection(col, name)
    drop_hidden_faces(ob)
    make_bake_uv(ob)
    _metals_to_dielectric(ob)
    print(f'[{name}] tris≈{sum(len(p.vertices) - 2 for p in ob.data.polygons)}')
    albedo = bake_pass(ob, f'{name}_albedo', size, 'DIFFUSE', samples=4, direct=False, indirect=False, color=True)
    emit = bake_pass(ob, f'{name}_emit', size, 'EMIT', samples=1)
    irr = bake_pass(ob, f'{name}_irr', light_size, 'DIFFUSE', samples=samples, direct=True, indirect=True, color=False)
    irr_exr = denoise_linear(irr, os.path.join(tmp, f'{name}_irr_dn.exr'))
    png = compose_and_save(albedo, irr_exr, emit, size, os.path.join(tmp, f'{name}.png'), exposure)
    to_webp(png, os.path.join(out_dir, f'{name}.webp'))
    return ob


def bake_module(name, parts, glass_col, out_dir, size=2048, light_size=1024, samples=192, exposure=0.0):
    """parts: [(suffix, collection)] — each becomes its own mesh + atlas (<name>_<suffix>)."""
    os.makedirs(out_dir, exist_ok=True)
    tmp = os.path.join(out_dir, '_tmp')
    os.makedirs(tmp, exist_ok=True)
    glass_col.hide_render = True  # light passes through window openings
    baked = [bake_part(f'{name}_{suffix}', col, tmp, out_dir, size, light_size, samples, exposure) for suffix, col in parts]
    glass_col.hide_render = False
    for ob in baked:
        _single_material(ob)
    extras = [o for o in glass_col.objects if o.type == 'MESH']
    _select_only([*baked, *extras])
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out_dir, f'{name}.glb'),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='NONE',
        export_yup=True,
    )
    print(f'[{name}] exported {[o.name for o in baked]} + {len(extras)} glass panes')
