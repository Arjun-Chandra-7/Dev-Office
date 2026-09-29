# Architecture

```
 ~/Madara/Dev (fs.watch) ─┐
 content/portfolio.json ──┼─▶ server/office.ts ──▶ PortfolioSnapshot ──▶ GET /api/portfolio, WS /ws/state (read-only)
 /proc + ~/.claude/sessions ┘   (folders → merged projects → curated content → status)
                                                          │
 blender/ ──(bake)──▶ web/public/kit/*.glb + *.webp       ▼
                                   web/ (React 19 + React Three Fiber): baked building + live overlays + UI
```

## Server (`server/`)

| File | Role |
| --- | --- |
| `office.ts` | Discovery of immediate child folders, `merge` rules, stable slots (`.data/layout.json`), curated content lookup, status per project, change-only broadcasts. |
| `claude.ts` | Claude Code process detection from `/proc` (cwd, start time), enriched by `~/.claude/sessions/<pid>.json` (validated by `procStart`). Daemon "spare" processes are not sessions. |
| `index.ts` | Express + ws. GET only (405 otherwise); Host/Origin loopback checks unless `DEV_OFFICE_PUBLIC=1`. |
| `config.ts` | Paths, port, public-mode flag, scan intervals. |

**Status:** a session reporting `busy` makes the project **working**. Any other live, non-spare session makes it
**online**. Otherwise it is **offline**. Agents are opaque hashes of `pid:procStart`.

## Blender kit (`blender/`)

* `kit_lib.py` holds procedural materials (oak planks, walnut, concrete, plaster, fabrics, leather, plants),
  primitives with bevels, and furniture builders.
* `build_kit.py` builds the office and lounge modules and the bake-time light rig: a multiple-scattering sky
  and area lights, plus proxy geometry for the surroundings that is baked but not exported.
* `core_modules.py` builds the lobby (`core0`), upper lobby (`core1`) and corridor segment, with boolean voids
  for the stairs and lift.
* `bake.py` bakes, per module part (`arch` = shell, `props` = furniture):
  1. **albedo** (4096, noise-free) and **emission** (4096);
  2. **irradiance** (1024, 192 samples), denoised with OIDN through the compositor;
  3. **final** = albedo × irradiance + emission, tone-mapped with AgX and saved as WebP.

  Faces nobody sees are dropped before UV packing. Glass is exported as separate named panes.
* `scripts/bake-kit.sh` runs every module and then meshopt-compresses the GLBs (~5×).

## Web (`web/`)

* `scene/building/BakedBuilding.tsx` loads each module (GLB + atlases). It expands quantised attributes to
  float32 before baking node transforms into the geometry (otherwise int16 positions clamp to ±1). Materials
  are unlit `MeshBasicMaterial` (`toneMapped: false`). Offices, lounges and corridors are **instanced** per
  floor: two draw calls cover every office.
* **Dollhouse overview:** a shared clipping plane (`cutPlane`) removes the ceiling of the viewed floor.
* `scene/building/plan.ts` is the pure floor plan: ranks become offices (ground floor first), with empty
  bays as lounges, walls/colliders, stairs and lift.
* `scene/building/Lift.tsx` is the lift state machine (doors → travel → doors) shared with the physics.
* `scene/player/Player.tsx` handles first person: pointer lock, WASD, sprint with FOV kick, jump with
  gravity, per-axis collision, stair ramp, riding the lift, a lift lobby that summons it, and `E` on
  interactables (laptop → project card, About wall → About card, lift).
* `scene/offices/OfficeUnit.tsx` holds the live parts per project: laptop and TV screen (name + status), door
  sign, agents (one per session, typing only while working), and click targets.
* `scene/building/Exterior.tsx` contains the site, instanced trees with blob shadows, instanced city, roof and
  end closure.
* `ui/` has `About`, `ProjectCard`, `Hud`, `SearchPalette` and `WalkHud` (crosshair, hint, minimap).
* The canvas renders on demand. It runs at 30 fps only while agents animate, and every frame while walking.
* Lighting for the few real-time objects comes from a one-time environment map plus one unshadowed sun.
