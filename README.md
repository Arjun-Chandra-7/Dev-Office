# DEV OFFICE — Arjun Chandra's portfolio

A two-storey 3D office you can explore from above or walk through in first person. Every project folder in
`~/Madara/Dev` becomes a private office. Visitors see each project's name, what it is, where the code lives, and
whether a Claude session is working on it right now:

* **Working in background**: a session is actively working.
* **Session online**: a session is open.
* **Session offline**: no session.

Visitors arrive at an **About me** card with a photo and intro. They can then walk in (`WASD`, `Shift` to sprint,
`Space` to jump, `E` to use things), take the stairs or ride the lift, and read about each project at its laptop.

## Run

```bash
cd ~/Madara/Office
npm_config_python=/usr/bin/python3 npm install   # the system python is needed by node-gyp here
npm start                                        # builds the UI, serves on http://localhost:4317
```

* `npm run dev`: hot reload (API on `:4317`, UI on `:5173`).
* `DEV_OFFICE_PUBLIC=1 npm start`: binds `0.0.0.0` and accepts any Host, for use behind a tunnel or reverse
  proxy. This is safe because the API is read-only; see "Security".

## Editing the portfolio

Everything a visitor reads is in **`content/portfolio.json`**, which is hot-reloaded with no restart:

* `about`: your name, tagline, photo (`web/public/about/arjun.webp`) and paragraphs. `**bold**` works.
* `projects`: keyed by folder name. Each entry has `title`, `summary`, `github[]`, `link`, and optional
  `aliases` (other folder names that should use the same entry).
* `merge`: folders that belong to another project. For example, the `Jarvis-*` worktree folders fold into
  **Jarvis**. They get no office, but their Claude sessions count toward Jarvis.

Add or remove a folder in `~/Madara/Dev` and its office appears or disappears within ~0.3 s. A folder
without an entry shows its name and "more soon".

## Graphics

The building is made in **Blender** (`blender/`). It is modelled procedurally, lit with a physical sky and
interior fixtures, and its path-traced global illumination is **baked into texture atlases**. In the
browser those surfaces render unlit, so real-time shadows, AO and post-processing aren't needed. A full frame
takes about 1 ms of GPU time.

Rebuild the kit after changing anything in `blender/`:

```bash
npm run bake            # all modules; ~25 min on CPU. DEVICE=gpu if the GPU has ~2 GB free VRAM
MODULES="office" npm run bake
```

Output: `web/public/kit/*.glb` (meshopt-compressed) and `*_arch.webp` / `*_props.webp` atlases.

## Controls

| | |
| --- | --- |
| Overview | drag pan · right-drag orbit · scroll zoom · `1`/`2` floor · click an office · `Ctrl K` find a project |
| Walk | `V` · click to take the mouse · `WASD` · `Shift` sprint · `Space` jump · `E` use · `Esc` release |
| Lift | stand in front of it and it comes to you; inside, press `E` (or `1`/`2`) |
| About | `I` or the portrait on the lobby wall |

## Checks

```bash
npm test                 # parsers, content/merge rules, status, building plan
npm run typecheck
npm run check:security   # against a running server (DEV_OFFICE_PORT=…)
npm run check:live       # add/rename/remove a temp folder, measure update latency
```

## Security

The server is **read-only**:

* Every non-GET request is refused.
* There are no launch, terminal or refresh endpoints.
* The WebSocket closes on any client message.
* The public payload contains project names, statuses, curated text and opaque agent ids. There are no paths,
  PIDs, commands or session names; `check:security` asserts this.
* Session detection happens server-side from `/proc` and `~/.claude/sessions`.
