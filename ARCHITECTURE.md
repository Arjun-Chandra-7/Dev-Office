# Architecture

```
 ~/Madara/Dev ──fs.watch──┐
 git (execFile) ──────────┤
 gh api / GitHub REST ────┤      ┌──────────── backend (Node, 127.0.0.1:4317) ────────────┐
 /proc + ~/.claude/sessions ┼───▶ │ Office (server/office.ts)                              │
 ~/.claude/projects mtimes ─┘      │  discovery · git · GitHub · Claude detection · slots   │
                                   │  build() → OfficeSnapshot ──(hash changed?)──▶ emit    │
                                   │ PtyManager (server/pty.ts): node-pty → `claude -- …`   │
                                   └──────┬───────────────────────┬─────────────────────────┘
                                          │ /ws/state (snapshots) │ /ws/pty/:id (bytes)  + REST /api/*
                                   ┌──────▼───────────────────────▼─────────────────────────┐
                                   │ frontend (React 19 + R3F + xterm.js)                   │
                                   │ store.ts (zustand) ← snapshots, structural sharing     │
                                   │ scene/ (office, desks, camera, labels)  ui/ (HUD, panel│
                                   │ prompt, search palette, terminal dock)                 │
                                   └────────────────────────────────────────────────────────┘
```

The browser never touches the filesystem and never supplies a path or a command. All it sends is a
project **id**, a prompt string, keystrokes for an existing PTY, and a stop request.

## Backend (`server/`)

| File | Responsibility |
| --- | --- |
| `config.ts` | root, port, intervals, limits (local-only constants) |
| `office.ts` | the state engine: discovery, desk slots, git queue, Claude mapping, snapshot + change detection, id→path resolution |
| `git.ts` | `git` via `execFile` (no shell, `GIT_OPTIONAL_LOCKS=0` so it never takes the index lock), porcelain parsing, remote → GitHub ref, credential redaction |
| `github.ts` | metadata via `gh api repos/o/r` (uses the user's gh auth; no tokens stored), anonymous REST fallback, 30 min cache persisted to `.data/github-cache.json`, README fallback extraction |
| `claude.ts` | Claude process detection from `/proc`, enrichment from `~/.claude/sessions/<pid>.json`, transcript-activity lookup |
| `pty.ts` | office-launched sessions: spawn, scrollback ring buffer (512 KB), attach/replay, stop (TERM→KILL), cleanup on shutdown |
| `index.ts` | Express + ws, localhost guards, validation, lifecycle |

### Discovery & real-time

* **Projects** = the immediate child directories of `DEV_ROOT`, skipping hidden dirs and `node_modules`. A
  symlinked child counts only if it resolves inside the root. `fs.watch(DEV_ROOT)` triggers a rescan (debounced
  250 ms, measured ~380 ms end to end). A 15 s rescan is the fallback in case a watcher misses an event.
* **Repos**: a project root with `.git` (dir or file) → `git`. Otherwise nested repos up to 2 levels deep →
  `nested-git` (for example Viralyst's 9 sub-repos). Otherwise `plain`.
* **Git** refreshes when `.git/{index,HEAD,…}` changes (watcher), plus every 20 s. At most 4 concurrent git
  processes, each with a 6 s timeout.
* **Claude** scan every 2.5 s (a `/proc` walk costs a few ms).
* A snapshot is emitted only when its content hash changes. The client keeps unchanged project objects
  (structural sharing), so memoized desks don't re-render.

### Claude session detection (observed, not assumed)

On this machine (Claude Code 2.1.284):

* interactive sessions: process `claude [flags] [prompt]`, and cwd = where it was started
* background sessions: `claude bg-spare`, managed by `claude daemon run`, each wrapped by `claude bg-pty-host`
  (Claude rewrites `argv[0]` to the space-joined title `"claude bg-pty-host"`, which is parsed accordingly)
* Sessions write `~/.claude/sessions/<pid>.json` with `cwd`, `status` (`busy`/`idle`), `spare`, `name`, and
  `procStart` (= `/proc/<pid>/stat` field 22). Some older interactive processes have no file.

The mapping rules:

| Evidence | Displayed |
| --- | --- |
| `/proc/<pid>/cwd` inside a project | the session belongs to that project (worktrees under it included) |
| session file with matching `procStart`, `status: busy` | **WORKING** |
| … `status: idle` | **IDLE** |
| `spare: true`, or an unclaimed `--bg-spare` with no file | **STANDBY** (daemon pre-warm; not counted as live) |
| office-launched PTY with output in the last 4 s, no file | **STREAMING OUTPUT** |
| live process, no metadata | **LIVE PROCESS · activity unknown** |

A session file whose `procStart` doesn't match the live process (PID reuse) is ignored. Daemon, host-wrapper,
and CLI subcommand processes (`daemon`, `bg-pty-host`, `attach`, `mcp`, …) are excluded. Command lines are
shown as the executable plus flags only, so prompt text is never displayed.

### Launching Claude

`POST /api/projects/:id/claude {prompt}` → `office.resolveProjectDir(id)` (regex-validated id → known
project → realpath must be a child of the root) → `pty.spawn(<which claude>, ['--', prompt], {cwd})`.

* No shell is involved, and `--` ends option parsing. This was verified with a prompt starting with `--help`.
* Session-scoped env vars (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, messaging sockets, …) are stripped, so a
  server started from inside Claude Code doesn't make its children look like sub-sessions.
* Browser disconnects don't kill sessions. On reconnect the server sends the scrollback as a `replay`
  message, and the client swallows xterm's auto-generated answers to terminal queries inside that replay.
  Without this, a reconnect injected stale query responses as keystrokes (found and fixed during QA).
* At most 12 running PTYs. Exited sessions are kept 30 min for viewing. Server shutdown sends SIGTERM to all
  PTYs, then SIGKILL after 1.5 s (verified: no orphan).

### Security (local-only)

* The server binds `127.0.0.1` only.
* `Host` must be a loopback name (421 otherwise), which defeats DNS rebinding.
* A browser `Origin` must be loopback (403 otherwise). WebSocket upgrades *require* a loopback Origin.
* Mutating endpoints require `application/json`, so cross-site forms can't send them (415).
* Ids must match `^[a-z0-9][a-z0-9-]{0,120}$` and exist, and paths are only derived server-side.
* Prompt ≤ 20 000 chars; request body ≤ 64 KB; WS frame ≤ 256 KB.
* Remote URLs are credential-redacted. No credentials are stored (gh keeps its own token).

## Frontend (`web/`)

* `store.ts`: zustand store, `/ws/state` connection with backoff, derived statuses, persisted UI state
  (`localStorage`: selection, filter, camera pose, quality; never terminal output).
* `ui/`: HUD + filters + status bar, project panel, prompt dialog, search palette, terminal dock (xterm.js + fit addon, reconnect).

The old flat desks are replaced by a two-storey building in `web/scene/`:

| File | Purpose |
| --- | --- |
| `building/plan.ts` | Pure layout. One office per project, no spare desks. The first half of projects go on the ground floor, the rest on level 1. Also defines lobby, stairs, lift, collision boxes, and the lounges that fill empty bays. |
| `building/materials.ts` | Procedural PBR textures (oak, concrete, plaster, walnut, fabric, grass) with generated normal maps. Offline; no downloaded assets. |
| `building/Building.tsx` | Floors, walls merged per material, glass curtain walls with mullions, ceilings and light panels, stairs, roof, plaza, trees, instanced city skyline. |
| `building/kits.ts` + `Furniture.tsx` | Instanced furniture kits for offices and lounges (a few draw calls total). |
| `building/Lift.tsx` | A working lift: closing → moving → opening, with call buttons on each floor and a cabin panel. |
| `building/Core.tsx` | Reception, a backlit logo wall, a lobby screen showing real counts, a coffee bar. |
| `offices/OfficeUnit.tsx` | Per project: laptop and wall TV with a live status screen, door sign, selection outline, click targets. Clicking the laptop opens the project's Claude sessions (and its terminal, if one was launched from the office). |
| `agents/Agent.tsx` | Stylized seated agents, one per real live Claude session. They type only when the session is observed working. A status ring floats above each head. |
| `player/Player.tsx` | First person: pointer lock, WASD, Shift to run, collisions, the stair ramp, riding the lift, and E/click on whatever the crosshair targets. |
| `OverviewRig.tsx` | Dollhouse camera with a floor switch (1/2). |
| `Scene.tsx` | Sky and environment lighting, golden-hour sun with throttled shadows, N8AO, bloom, SMAA, ACES filmic tone mapping, a color grade, and the HQ/LQ quality toggle. |
| `ui/WalkHud.tsx` | Crosshair, interaction hint, controls card, minimap. |

* **Dev-only helpers** (stripped from the production build):
  * `debug.ts`: `?off=post,shadow,…` bisect flags and `window.__three`.
  * `window.__walk` test hook in `Player.tsx`.
* `scene/labels.tsx`: DOM label layer for overview mode, projected in the render loop with per-label level of detail and depth ordering.

## Data model

See `shared/types.ts`: `Project`, `RepoInfo`, `GithubResult`, `ProjectDescription` (source:
`github` → `readme` → `github-subrepo` → `none`), `ClaudeSession`, `LaunchedSession`, `OfficeSnapshot`.
