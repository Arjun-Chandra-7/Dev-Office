# DEV OFFICE

A live, two-storey 3D office building for everything in `~/Madara/Dev`.

* Every project directory gets its own private office, and nothing else does, so there are no spare desks.
* Each office has a laptop and a wall TV that show the project's live status, plus a door sign.
* Each office has one seated agent per live Claude Code session.
* Click a laptop to reach that project's Claude sessions. You can do this from above or in first person.
  From there you can start a new session and use it in an embedded terminal.
* You can walk the building in first person with WASD, take the stairs, and ride the lift.

Nothing on screen is mocked:

* Projects come from the filesystem.
* Repository state comes from the local VCS.
* Metadata comes from GitHub, through the `gh` CLI.
* Sessions come from `/proc` plus Claude Code's own session files.

## Run it

```bash
cd ~/Madara/Office
npm install          # see note below about node-pty
npm start            # builds the UI, serves everything on http://localhost:4317
```

Development mode (hot reload for both halves):

```bash
npm run dev          # API on :4317, UI on http://localhost:5173
```

**node-pty build note:** on this machine, miniconda's `python3` comes first on `PATH` and it lacks `gyp`, so
`npm install` fails. Use the system Python:
`npm_config_python=/usr/bin/python3 npm install`

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEV_OFFICE_ROOT` | `~/Madara/Dev` | directory whose children become offices |
| `DEV_OFFICE_PORT` | `4317` | backend port (always bound to 127.0.0.1) |
| `DEV_OFFICE_WEB_PORT` | `5173` | Vite dev-server port (`npm run dev` only) |
| `DEV_OFFICE_DATA` | `./.data` | project order + GitHub cache |
| `DEV_OFFICE_DEBUG_INPUT` | unset | `1` logs raw PTY keystrokes (debugging only) |

## Using it

**Overview (dollhouse)**

| Action | How |
| --- | --- |
| Open an office and its Claude sessions | click the office or its laptop, search (`Ctrl/⌘ K` or `/`), or use the arrow keys |
| Switch floor | **Ground / Level 1** buttons, or `1` / `2` |
| Back to the overview | `Esc`, `O`, or click empty floor |
| Pan / orbit / zoom | left-drag / right-drag / scroll (touch: one finger / pinch) |
| Graphics quality | **HQ / LQ** button (LQ drops ambient occlusion, uses 1K shadows and 1× resolution) |

**First person** (`V` or **Walk in**). Click to take the mouse, then:

| Action | How |
| --- | --- |
| Move / run | `W A S D` (or the arrow keys) / hold `Shift` |
| Look | mouse |
| Use what the crosshair is on | `E` or click. The **laptop** opens that project's Claude sessions, plus its terminal if one was launched from the office. The **call button** brings the lift, and the **cabin panel** rides it. |
| Change floor | take the stairs in the lobby, or ride the lift |
| Release the mouse / leave | `Esc` / `V` |

A minimap (top right) shows the floor you're on, offices coloured by Claude status, the lift, and you.

**Everywhere**

| Action | How |
| --- | --- |
| Prompt Claude in the focused project | **Prompt Claude** button or `P`; submit with `Ctrl ↵` |
| Terminals | dock at the bottom; `` ` `` toggles it; **Stop session** sends SIGTERM (SIGKILL after 4 s) |
| Filter offices | All · Claude live · Working · Modified · Recent 24h |

**Offices follow the folders:**

* Add or delete a directory in `~/Madara/Dev` and its office appears or disappears within about a second, with
  no refresh needed.
* Offices fill the ground floor first, then level 1, in project order.
* A bay without a project is an open lounge, never an empty desk.

**Agents reflect real sessions:**

* There is one agent per real, live Claude process.
* An agent types only when its session is observed working: status `busy`, or an office-launched terminal
  streaming output. Otherwise it sits back.
* The ring above each head is coloured by that status.

## Checks

```bash
npm test                 # unit tests (parsers, slugs, building plan, stairs)
npm run typecheck
npm run check:security   # adversarial API/WebSocket checks against a running server (DEV_OFFICE_PORT)
npm run check:live       # creates/renames/deletes a temp project dir, measures update latency
```

See `ARCHITECTURE.md` for how it works and `DEV_OFFICE_STATE.md` for what was found on this machine and how
it was verified.
