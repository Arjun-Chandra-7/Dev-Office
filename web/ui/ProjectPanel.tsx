import { useEffect, useState } from 'react';
import type { ClaudeSession, GithubResult, Project, RepoInfo } from '../../shared/types';
import { ago, deskStatus, duration, launchedFor, tildify, useOffice, useProject } from '../store';

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const ACTIVITY_LABEL: Record<ClaudeSession['activity'], string> = {
  working: 'WORKING',
  idle: 'IDLE',
  standby: 'STANDBY',
  streaming: 'STREAMING OUTPUT',
  unknown: 'LIVE PROCESS',
};

function SessionRow({ s, now }: { s: ClaudeSession; now: number }) {
  const openTerminal = useOffice((st) => st.openTerminal);
  return (
    <li className={`session a-${s.activity}`}>
      <div className="session-head">
        <span className="dot" />
        <b>{ACTIVITY_LABEL[s.activity]}</b>
        {s.activity === 'unknown' && <span className="muted">· activity unknown</span>}
        <span className="spacer" />
        <span className="muted">PID {s.pid}</span>
      </div>
      {s.name && <div className="session-name">{s.name}</div>}
      <div className="session-meta">
        <span>{s.kind}</span>
        <span>up {duration(now - s.startedAt)}</span>
        {s.relCwd && <span>./{s.relCwd}</span>}
        {s.version && <span>v{s.version}</span>}
        <span title="kernel process state">proc {s.procState}</span>
      </div>
      <div className="session-src muted">
        {s.activitySource === 'session-file'
          ? `status "${s.rawStatus}" from ~/.claude/sessions/${s.pid}.json`
          : s.activitySource === 'pty-output'
            ? 'terminal output in the last few seconds'
            : 'no session metadata for this process — only liveness is observable'}
        {s.activity === 'standby' && ' · pre-warmed by the Claude daemon; no conversation yet'}
      </div>
      {s.launchedBy && (
        <button className="btn ghost sm" onClick={() => openTerminal(s.launchedBy)}>
          View terminal
        </button>
      )}
    </li>
  );
}

function GithubBlock({ repo: r, gh }: { repo: RepoInfo; gh: GithubResult | undefined }) {
  if (!r.github) return <div className="muted">{r.remoteUrl ? `Remote is not GitHub: ${r.remoteUrl}` : 'No remote configured'}</div>;
  const full = `${r.github.owner}/${r.github.repo}`;
  if (!gh || gh.status === 'pending') return <div className="muted">{full} · fetching metadata…</div>;
  if (gh.status === 'unavailable')
    return (
      <div>
        <span className="mono">{full}</span>
        <div className="warn-text">GitHub metadata unavailable — {gh.reason}</div>
      </div>
    );
  const d = gh.data;
  return (
    <div className="gh">
      <a href={d.url} target="_blank" rel="noreferrer noopener" className="mono">
        {d.fullName} ↗
      </a>
      <div className="chips">
        <span className={`chip ${d.visibility === 'private' ? 'amber' : ''}`}>{d.visibility}</span>
        <span className="chip">★ {d.stars}</span>
        {d.language && <span className="chip">{d.language}</span>}
        <span className="chip">default {d.defaultBranch}</span>
        {d.archived && <span className="chip amber">archived</span>}
      </div>
      {d.pushedAt && <div className="muted small">pushed {ago(Date.parse(d.pushedAt))} · via {d.source === 'gh-cli' ? 'gh CLI' : 'GitHub REST'}</div>}
    </div>
  );
}

function GitBlock({ r }: { r: RepoInfo }) {
  if (!r.valid) return <div className="warn-text">Git: {r.error ?? 'invalid repository'}</div>;
  const c = r.counts;
  const dirty = c.staged + c.modified + c.untracked + c.conflicted;
  return (
    <div className="git">
      <div className="git-line">
        <span className="branch">⎇ {r.detached ? 'detached HEAD' : r.branch}</span>
        {dirty === 0 ? (
          <span className="chip green">● clean</span>
        ) : (
          <>
            {c.modified > 0 && <span className="chip amber">{c.modified} modified</span>}
            {c.staged > 0 && <span className="chip cyan">{c.staged} staged</span>}
            {c.untracked > 0 && <span className="chip">{c.untracked} untracked</span>}
            {c.conflicted > 0 && <span className="chip red">{c.conflicted} conflicted</span>}
          </>
        )}
        {(r.ahead > 0 || r.behind > 0) && (
          <span className="chip">
            ↑{r.ahead} ↓{r.behind}
          </span>
        )}
      </div>
      {r.lastCommit ? (
        <div className="commit">
          <span className="mono muted">{r.lastCommit.hash.slice(0, 7)}</span> {r.lastCommit.subject}
          <div className="muted small">
            {r.lastCommit.author} · {ago(r.lastCommit.at)}
          </div>
        </div>
      ) : (
        <div className="muted">No commits yet</div>
      )}
    </div>
  );
}

function Description({ p }: { p: Project }) {
  const d = p.description;
  const badge =
    d.source === 'github'
      ? 'GitHub description'
      : d.source === 'github-subrepo'
        ? `GitHub · ${d.from}`
        : d.source === 'readme'
          ? `Fallback · local ${d.from}`
          : null;
  const rootGh = p.repos[0]?.github ? p.github[`${p.repos[0].github.owner}/${p.repos[0].github.repo}`] : undefined;
  const ghEmpty = rootGh?.status === 'ok' && !rootGh.data.description;
  return (
    <section className="desc">
      <p className={d.text ? '' : 'muted'}>{d.text ?? 'No description available'}</p>
      {badge && <span className={`src ${d.source.startsWith('github') ? 'gh' : 'fallback'}`}>{badge}</span>}
      {ghEmpty && d.source !== 'github' && <span className="src note">GitHub repo has no description</span>}
    </section>
  );
}

export function ProjectPanel() {
  const selectedId = useOffice((s) => s.selectedId);
  const panelOpen = useOffice((s) => s.panelOpen);
  const p = useProject(selectedId);
  const snapshot = useOffice((s) => s.snapshot);
  const openPrompt = useOffice((s) => s.openPrompt);
  const openTerminal = useOffice((s) => s.openTerminal);
  const closePanel = useOffice((s) => s.closePanel);
  const overview = useOffice((s) => s.overview);
  const now = useNow();
  if (!p || !panelOpen) return null;

  const status = deskStatus(p);
  const launched = launchedFor(snapshot, p.id);
  const runningLaunched = launched.filter((l) => l.state === 'running');
  const real = p.claude.sessions.filter((s) => s.activity !== 'standby');
  const standby = p.claude.sessions.filter((s) => s.activity === 'standby');
  const claudeOk = snapshot?.system.claude.available;

  return (
    <aside className="panel" aria-label={`${p.name} details`}>
      <div className="panel-head">
        <div>
          <div className={`status-pill s-${status}`}>
            <span className="dot" />
            {status === 'working'
              ? 'CLAUDE WORKING'
              : status === 'live'
                ? `${p.claude.live} LIVE SESSION${p.claude.live > 1 ? 'S' : ''}`
                : status === 'standby'
                  ? 'STANDBY ONLY'
                  : 'NO LIVE SESSION'}
          </div>
          <h1>{p.name}</h1>
          <div className="path mono" title={p.path}>
            {tildify(p.path)}
          </div>
        </div>
        <div className="panel-head-actions">
          <button className="icon-btn" title="Collapse panel" onClick={closePanel}>
            ⟩
          </button>
          <button className="icon-btn" title="Back to office (Esc)" onClick={overview}>
            ✕
          </button>
        </div>
      </div>

      <div className="panel-actions">
        <button className="btn primary" disabled={!claudeOk} onClick={() => openPrompt(p.id)} title={claudeOk ? 'Start Claude Code here (P)' : 'Claude CLI not detected'}>
          Prompt Claude
        </button>
        <button
          className="btn"
          disabled={!launched.length}
          onClick={() => openTerminal((runningLaunched[0] ?? launched[0]).id)}
          title={launched.length ? 'Open the terminal of a session launched from the office' : 'No sessions launched from the office for this project'}
        >
          View Claude{launched.length ? ` (${launched.length})` : ''}
        </button>
      </div>

      <div className="panel-body">
        <Description p={p} />

        <section>
          <h2>Claude</h2>
          {real.length === 0 && <div className="muted">No live Claude session in this project.</div>}
          <ul className="sessions">
            {real.map((s) => (
              <SessionRow key={s.id} s={s} now={now} />
            ))}
          </ul>
          {standby.length > 0 && (
            <details className="standby">
              <summary>
                {standby.length} daemon standby process{standby.length > 1 ? 'es' : ''}
              </summary>
              <ul className="sessions">
                {standby.map((s) => (
                  <SessionRow key={s.id} s={s} now={now} />
                ))}
              </ul>
            </details>
          )}
          {launched.filter((l) => l.state !== 'running').length > 0 && (
            <div className="launched-ended">
              {launched
                .filter((l) => l.state !== 'running')
                .map((l) => (
                  <button key={l.id} className="btn ghost sm" onClick={() => openTerminal(l.id)}>
                    ended session · {l.state === 'failed' ? 'failed' : `exit ${l.exitCode}`} · {ago(l.endedAt, now)}
                  </button>
                ))}
            </div>
          )}
          {p.activity.claudeTranscriptAt && <div className="muted small">Last Claude transcript write {ago(p.activity.claudeTranscriptAt, now)}</div>}
        </section>

        {p.repos.length === 0 && (
          <section>
            <h2>Git</h2>
            <div className="muted">Not a git repository</div>
          </section>
        )}
        {p.repos.map((r) => {
          const gh = r.github ? p.github[`${r.github.owner}/${r.github.repo}`] : undefined;
          return (
            <section key={r.relPath || '.'} className="repo">
              <h2>{r.relPath ? `Repo · ${r.relPath}` : 'Repository'}</h2>
              <GithubBlock repo={r} gh={gh} />
              <GitBlock r={r} />
            </section>
          );
        })}

        <section className="meta muted small">
          {p.activity.dirMtime && <div>Files touched {ago(p.activity.dirMtime, now)} (top level)</div>}
          <div>Desk #{p.slot + 1} · id {p.id}</div>
        </section>
      </div>
    </aside>
  );
}
