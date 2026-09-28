import { useEffect, useState } from 'react';
import { Api, gitDirtyCount, isRecent, tildify, useOffice, type Filter } from '../store';

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return <span>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'claude', label: 'Claude live' },
  { id: 'working', label: 'Working' },
  { id: 'modified', label: 'Modified' },
  { id: 'recent', label: 'Recent 24h' },
];

export function Hud() {
  const snap = useOffice((s) => s.snapshot);
  const filter = useOffice((s) => s.filter);
  const setFilter = useOffice((s) => s.setFilter);
  const setPalette = useOffice((s) => s.setPalette);
  const selectedId = useOffice((s) => s.selectedId);
  const connected = useOffice((s) => s.connected);
  const notify = useOffice((s) => s.notify);
  const mode = useOffice((s) => s.mode);
  const setMode = useOffice((s) => s.setMode);
  const viewFloor = useOffice((s) => s.viewFloor);
  const setViewFloor = useOffice((s) => s.setViewFloor);
  const quality = useOffice((s) => s.quality);
  const setQuality = useOffice((s) => s.setQuality);
  const [refreshing, setRefreshing] = useState(false);
  if (!snap) return null;
  const walking = mode === 'walk';

  const projects = snap.projects;
  const live = projects.reduce((n, p) => n + p.claude.live, 0);
  const working = projects.reduce((n, p) => n + p.claude.working, 0);
  const projectsWithClaude = projects.filter((p) => p.claude.live > 0).length;
  const modified = projects.filter((p) => gitDirtyCount(p) > 0).length;
  const recent = projects.filter((p) => isRecent(p)).length;
  const focused = projects.find((p) => p.id === selectedId);
  const counts: Record<Filter, number> = {
    all: projects.length,
    claude: projectsWithClaude,
    working: projects.filter((p) => p.claude.working > 0).length,
    modified,
    recent,
  };
  const sys = snap.system;

  return (
    <>
      <header className="hud">
        <div className="hud-brand">
          <span className="logo" />
          <div>
            <div className="brand-title">DEV OFFICE</div>
            <div className="brand-sub" title={sys.root}>
              {tildify(sys.root)} {!sys.rootExists && <b className="warn">· missing</b>}
            </div>
          </div>
        </div>
        <dl className="hud-stats">
          <div>
            <dt>Projects</dt>
            <dd>{projects.length}</dd>
          </div>
          <div className={live ? 'on' : ''} title="Live Claude Code processes inside project directories (daemon standby spares excluded)">
            <dt>Claude live</dt>
            <dd>{live}</dd>
          </div>
          <div className={working ? 'on' : ''} title="Sessions reporting busy, or office-launched sessions streaming output">
            <dt>Working</dt>
            <dd>{working}</dd>
          </div>
          <div className={modified ? 'amber' : ''} title="Projects with uncommitted git changes">
            <dt>Git modified</dt>
            <dd>{modified}</dd>
          </div>
        </dl>
        <div className="hud-right">
          {!walking && (
            <div className="seg" role="group" aria-label="Floor">
              <button className={viewFloor === 0 ? 'active' : ''} onClick={() => setViewFloor(0)} title="Ground floor (1)">
                Ground
              </button>
              <button className={viewFloor === 1 ? 'active' : ''} onClick={() => setViewFloor(1)} title="Level 1 (2)">
                Level 1
              </button>
            </div>
          )}
          <button className={`walk-btn${walking ? ' on' : ''}`} onClick={() => setMode(walking ? 'overview' : 'walk')} title="First-person mode (V)">
            {walking ? 'Exit walk' : 'Walk in'} <kbd>V</kbd>
          </button>
          <button
            className="icon-btn"
            title={`Graphics: ${quality} (click to switch)`}
            onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}
          >
            {quality === 'high' ? 'HQ' : 'LQ'}
          </button>
          <button className="search-btn" onClick={() => setPalette(true)}>
            <span>Search projects</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button
            className="icon-btn"
            title="Rescan projects, git and GitHub now"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await Api.refresh();
                notify('Workspace rescanned');
              } catch (e) {
                notify(`Refresh failed: ${(e as Error).message}`, 'error');
              } finally {
                setRefreshing(false);
              }
            }}
          >
            {refreshing ? '…' : '↻'}
          </button>
        </div>
      </header>

      {!walking && <nav className="filters" aria-label="Filter desks">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
            {f.label}
            <span>{counts[f.id]}</span>
          </button>
        ))}
      </nav>}

      <footer className="statusbar">
        <span className={`conn ${connected ? 'ok' : 'bad'}`}>{connected ? 'live' : 'offline'}</span>
        <span title={sys.claude.path ?? ''}>
          claude {sys.claude.available ? sys.claude.version?.replace(' (Claude Code)', '') : <b className="warn">not detected</b>}
        </span>
        <span>
          gh {sys.gh.authenticated ? `@${sys.gh.account}` : sys.gh.available ? <b className="warn">not authenticated</b> : <b className="warn">not installed</b>}
        </span>
        {!sys.git.available && <b className="warn">git not installed</b>}
        {snap.unassignedClaude > 0 && <span title="Claude processes running outside the Dev root">+{snap.unassignedClaude} claude outside root</span>}
        {focused && <span className="focus">▸ {focused.name}</span>}
        <span className="spacer" />
        <span className="hint">
          {walking ? 'WASD move · mouse look · E use · Esc release · V overview' : 'drag pan · right-drag orbit · scroll zoom · 1/2 floors · V walk · Esc overview'}
        </span>
        <Clock />
      </footer>
    </>
  );
}
