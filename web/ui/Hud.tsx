import { useOffice, type Filter, type Quality } from '../store';

const NEXT_QUALITY: Record<Quality, Quality> = { auto: 'high', high: 'low', low: 'aaloo', aaloo: 'auto' };
const TIER_LABEL = { high: 'HQ', low: 'LQ', aaloo: '🥔 AALOO' } as const;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Session online' },
  { id: 'working', label: 'Working' },
];

export function Hud() {
  const snap = useOffice((s) => s.snapshot);
  const filter = useOffice((s) => s.filter);
  const setFilter = useOffice((s) => s.setFilter);
  const setPalette = useOffice((s) => s.setPalette);
  const setAbout = useOffice((s) => s.setAbout);
  const connected = useOffice((s) => s.connected);
  const mode = useOffice((s) => s.mode);
  const setMode = useOffice((s) => s.setMode);
  const viewFloor = useOffice((s) => s.viewFloor);
  const setViewFloor = useOffice((s) => s.setViewFloor);
  const quality = useOffice((s) => s.quality);
  const tier = useOffice((s) => s.tier);
  const setQuality = useOffice((s) => s.setQuality);
  if (!snap) return null;
  const liveStatus = snap.statusAvailable;
  const walking = mode === 'walk';
  const projects = snap.projects;
  const online = projects.filter((p) => p.status !== 'offline').length;
  const working = projects.filter((p) => p.status === 'working').length;
  const counts: Record<Filter, number> = { all: projects.length, online, working };

  return (
    <>
      <header className="hud">
        <button className="hud-brand" onClick={() => setAbout(true)} title="About me (I)">
          <span className="logo" />
          <div>
            <div className="brand-title">{snap.about?.name?.toUpperCase() ?? 'DEV OFFICE'}</div>
            <div className="brand-sub">Dev Office · portfolio</div>
          </div>
        </button>
        <dl className="hud-stats">
          <div>
            <dt>Projects</dt>
            <dd>{projects.length}</dd>
          </div>
          {liveStatus && (
            <>
          <div className={online ? 'on' : ''} title="Projects with a live Claude session">
            <dt>Online</dt>
            <dd>{online}</dd>
          </div>
          <div className={working ? 'on' : ''} title="Projects where a session is working in the background">
            <dt>Working</dt>
            <dd>{working}</dd>
          </div>
            </>
          )}
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
          <button className="icon-btn" title="About me (I)" onClick={() => setAbout(true)}>
            i
          </button>
          <button
            className={`quality-btn${tier === 'aaloo' ? ' aaloo' : ''}`}
            title={`Graphics: ${quality === 'auto' ? `auto (currently ${tier})` : quality}. Click to cycle Auto → High → Low → Aaloo (potato)`}
            onClick={() => setQuality(NEXT_QUALITY[quality])}
          >
            {quality === 'auto' ? <span className="muted">AUTO·</span> : null}
            {TIER_LABEL[tier]}
          </button>
          <button className="search-btn" onClick={() => setPalette(true)}>
            <span>Projects</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>
      </header>

      {!walking && liveStatus && (
        <nav className="filters" aria-label="Filter offices">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
              <span>{counts[f.id]}</span>
            </button>
          ))}
        </nav>
      )}

      <footer className="statusbar">
        <span className={`conn ${connected ? 'ok' : 'bad'}`}>{!liveStatus ? 'portfolio' : connected ? 'live' : 'reconnecting'}</span>
        {liveStatus && (
          <>
        <span className="legend">
          <i className="lg s-working" /> working in background
        </span>
        <span className="legend">
          <i className="lg s-live" /> session online
        </span>
        <span className="legend">
          <i className="lg s-none" /> session offline
        </span>
          </>
        )}
        <span className="spacer" />
        <span className="hint">
          {walking
            ? 'WASD move · Shift sprint · Space jump · E use · Esc release · V overview'
            : 'drag pan · right-drag orbit · scroll zoom · 1/2 floors · V walk · I about'}
        </span>
      </footer>
    </>
  );
}
