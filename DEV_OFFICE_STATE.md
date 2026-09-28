# DEV OFFICE — environment findings & verification log

Recorded 2026-09-29 while building on this machine. Live data is always available from `GET /api/state`.
This file records what was *found* and *verified*, not live state.

## Environment (recon)

| Item | Found |
| --- | --- |
| OS | Linux 7.0.0-34-generic (Ubuntu), x86_64, procfs available, `CLK_TCK` 100 |
| Node / npm | v22.22.1 / 9.2.0 (no pnpm, yarn, or bun) |
| git | 2.53.0 |
| gh | 2.46.0, authenticated as `Arjun-Chandra-7` (keyring) |
| Claude Code | 2.1.284 at `~/.local/bin/claude`; a daemon (`claude daemon run`) manages background sessions |
| Claude metadata | `~/.claude/sessions/<pid>.json` (status/cwd/procStart), `~/.claude/projects/<encoded-cwd>/*.jsonl` transcripts |
| Build quirk | miniconda `python3` shadows the system Python and lacks `gyp`, so node-pty needs `npm_config_python=/usr/bin/python3` |
| `~/Madara/Office` | empty before this work; `git init` + bootstrap commit, work done on branch `worktree-dev-office` |

## Projects in `~/Madara/Dev` at the time of testing (15)

Mix of cases the app has to handle, all observed for real:

* **git + GitHub**: Cric-Coach (→ `CrickLytics`, repo description empty → README fallback), EPL, Jarvis
  (`feat/jarvis-daily-assistant`), Pen-Fight, Portfolio, Study-Loop
* **worktree-style `.git` files**: Jarvis-daily-brain, Jarvis-integration, Jarvis-study-companion (all → `JARVIS`)
* **broken `.git`**: Linkdin → "not a git repository …", shown as invalid, no crash
* **nested repos**: Viralyst (9 sub-repos, one without a remote, several dirty: `±29`), Training (1 sub-repo)
* **plain directories**: GPT-2, StudyLoop, jarvis-backups
* `Things to Learn` and `Yt-Mp4` existed at recon and were deleted while the app was running. They
  disappeared from the office as expected.

## Verification performed

### v1 baseline

| Test | Result |
| --- | --- |
| API data vs. filesystem/git/GitHub | branches, dirty counts, remotes, and descriptions match; empty GitHub descriptions correctly fall back to README and are labelled "Fallback · local README.md" |
| Claude detection vs `ps`/`/proc` | Jarvis 3 live (2 bg idle + 1 interactive unknown) + 1 standby; Jarvis-integration busy → WORKING; Study-Loop idle + standby; 2 sessions outside the root (`~/Madara/Office`) counted separately |
| Launch from UI (GPT-2) | PID started in the correct cwd, detected by the `/proc` scan, desk switched live, HUD 5 → 6; a prompt starting with `--help` was *not* parsed as a flag |
| Workspace trust | Claude asked to trust GPT-2. Deliberately **not** granted (it would persist in your config), so that session was used to test Stop |
| Launch + prompt round trip (StudyLoop) | Claude replied `DEV OFFICE OK /home/xor_sensei/Madara/Dev/StudyLoop`; session file status picked up (idle) |
| Stop | exit 143, process gone, no orphaned children |
| Server shutdown with a running PTY | Claude child terminated (no orphan) |
| Browser reload mid-session | tabs survive, scrollback replayed; **bug found**: replayed terminal queries were re-answered into the PTY; fixed with a `replay` message + input suppression; re-verified with input logging (only focus-in reports are sent) |
| Add / rename / delete a project dir (name with spaces and parens) | appeared 381 ms · renamed 380 ms (same desk) · removed 379 ms |
| Security suite (`npm run check:security`) | 17/17 pass: traversal, encoded dots, absolute path, metachar ids → 404; foreign Origin → 403; rebinding Host → 421; form post → 415; bad types → 400; oversized → 413; WS without/foreign Origin rejected |
| 60 projects (temp root, production build on :4318) | 8 rows, 64 desks, no overlaps; labels collapse to status dots when far |
| Viewports | 1600×950 desktop; 390×844 phone (bottom-sheet panel, no horizontal scroll, desk framed above the sheet) |
| Unit tests | 6/6 (parsers, redaction, slugs, transcript-dir encoding, floor plan) |
| Typecheck | clean (server + web + shared) |

### v2 (two-storey 3D building)

| Test | Result |
| --- | --- |
| Unit tests (`npm test`) | 8/8 pass: parsers, redaction, slugs, transcript encoding, building plan (exact office count, doors walkable, walls block), stairs ramp. |
| Typecheck (`npx tsc -p tsconfig.json --noEmit`) | clean (server + web + shared). |
| Walking | movement at ~3 m/s, wall collision, and climbing the stairs to level 1 all work. |
| Lift | calling it, riding it both ways, and closed doors blocking all work. |
| Laptop | using it in first person opens the Jarvis panel with 4 sessions. |
| Folder sync | creating a folder adds an office within ~1 s; deleting it removes the office. |
| Performance | at 1600×950, high quality runs ~62 fps in walk mode and low quality ~113 fps. Shadow throttling doubled HQ. Overview is capped at 30 fps while agents animate. (An earlier "1 fps" reading was caused by Chrome throttling a background tab, not by our code.) |
| Production smoke test | smoke test on :4328 passed with no errors (`npx vite build && NODE_ENV=production tsx server/index.ts`). |

## Known limitations

* **The agents are stylized, not photoreal;** there are no licensed character assets.
* **Pointer lock needs a real click,** so automated browsers can't take it (test hook `window.__walk` provided for dev automation).
* **An agent's activity depends on its session file;** without one (`~/.claude/sessions/<pid>.json`) it shows as "LIVE PROCESS · activity unknown". Nothing is guessed.
* **The laptop only opens the terminal for sessions launched from the office.** Sessions started elsewhere are listed with PID, uptime, name, and status in the project panel, but not attachable via PTY.
* **Linux only for detection.** Process detection uses `/proc`. On other OSes the app still runs, but shows no detected sessions.
* **Deep changes can lag.** Git working-tree edits that don't touch `.git/` appear on the 20 s poll, not instantly. Directory add/remove is instant.
* **First launch in an untrusted folder.** Claude's own trust prompt appears in the terminal; answer it there.
* **Dev server restarts end sessions.** `npm run dev` restarts the backend on server file edits, which ends office-launched sessions by design (no orphans). Use `npm start` for day-to-day use.
* **Unreproduced glitch.** Once during testing, a reload restored an older selected project. It could not be reproduced afterwards (selection persistence re-verified).
