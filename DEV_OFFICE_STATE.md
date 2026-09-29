# DEV OFFICE — state & verification (portfolio edition, 2026-09-29)

## Machine

* Blender 5.2.2 LTS (`~/.local/bin/blender`). Cycles OptiX is available on the RTX 3050 (4 GB), but ollama
  holds ~2.1 GB of VRAM, so bakes default to the CPU (Ryzen 5 7235HS).
* Other tools: Node 22, `magick` (WebP), glTF-Transform 4.5 (meshopt).
* `~/Madara/Dev` has 13 folders. With the 4 Jarvis extras merged into **Jarvis**, that gives **9 offices**.

## Verified

| Check | Result |
| --- | --- |
| API | 9 projects with curated titles, summaries and links; Jarvis extras merged; payload has no paths/PIDs/commands |
| Security (`check:security`) | all pass: non-GET → 405, legacy endpoints 404, rebinding Host 421, foreign-origin WS rejected, WS closes on client message |
| Live folders (`check:live`) | add 272 ms · rename 263 ms (same slot) · remove 262 ms |
| Unit tests | 7/7 (content/merge, status, slugs, building plan, stairs) |
| GPU cost | one full frame in walk mode at 1600×950: **0.92 ms** (87 draw calls, 366k tris). Previous build: ~16–33 ms with shadows + AO + post |
| Walk | walk 3.2 m/s, sprint 6.4 m/s, jump peak 0.7 m, collisions, stairs to level 1 |
| Lift | walking into the lobby summons it; `E` inside rides it with no aiming needed; exit on the other floor |
| Interactions | `E` at the About wall → About card; `E` at the JARVIS laptop → JARVIS card (summary + GitHub) |
| About card | shown on arrival with photo, name, tagline and intro |

## Known limitations

* **Status is local.** Statuses come from this machine. A public deployment needs the server to run here
  (`DEV_OFFICE_PUBLIC=1` behind a tunnel); otherwise every office shows offline.
* **Bake time.** A full bake takes ~25 min on the CPU; GPU bakes need ~2 GB of free VRAM.
* **Lighting is baked.** Lighting is fixed at golden hour, and moving furniture would require a re-bake. Only
  agents, screens and the lift are real-time.
* **Stylised people.** Agents are stylised procedural figures, not scanned humans.
* **Content gaps.** Study-Loop is marked "still in progress". Byte Labs
  gets an office once a matching folder (`Byte-Lab`, `Byte-Labs` or
  `Byte-Eats`) exists.
