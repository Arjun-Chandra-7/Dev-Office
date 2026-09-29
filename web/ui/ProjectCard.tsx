import { STATUS_LABEL, deskStatus, useOffice, useProject } from '../store';
import { Rich } from './Rich';

const repoName = (url: string) => url.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** Portfolio card for a project: name, status, what it is, where to find it. */
export function ProjectCard() {
  const selectedId = useOffice((s) => s.selectedId);
  const panelOpen = useOffice((s) => s.panelOpen);
  const p = useProject(selectedId);
  const closePanel = useOffice((s) => s.closePanel);
  const overview = useOffice((s) => s.overview);
  const mode = useOffice((s) => s.mode);
  const liveStatus = useOffice((s) => s.snapshot?.statusAvailable ?? false);
  if (!p || !panelOpen) return null;
  const st = deskStatus(p);

  return (
    <aside className="panel" aria-label={`${p.title}`}>
      <div className="panel-head">
        <div>
          {liveStatus && (
            <div className={`status-pill s-${st}`}>
              <span className="dot" />
              {STATUS_LABEL[p.status].toUpperCase()}
            </div>
          )}
          <h1>{p.title}</h1>
        </div>
        <div className="panel-head-actions">
          <button className="icon-btn" title="Close" onClick={mode === 'walk' ? closePanel : overview}>
            ✕
          </button>
        </div>
      </div>

      <div className="panel-body">
        <section className="desc">
          {p.summary ? (
            <p>
              <Rich text={p.summary} />
            </p>
          ) : (
            <p className="muted">More about this project soon.</p>
          )}
        </section>

        {(p.link || p.github.length > 0) && (
          <section className="links">
            {p.link && (
              <a className="btn primary live" href={p.link} target="_blank" rel="noopener noreferrer">
                Open live site ↗<span className="muted">{host(p.link)}</span>
              </a>
            )}
            {p.github.length > 0 && (
              <>
                <h2>Source{p.github.length > 1 ? ` · ${p.github.length} repositories` : ''}</h2>
                <ul className="repos">
                  {p.github.map((g) => (
                    <li key={g}>
                      <a href={g} target="_blank" rel="noopener noreferrer">
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                          <path
                            fill="currentColor"
                            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
                          />
                        </svg>
                        {repoName(g)}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        <section className="muted small status-note">
          {!liveStatus
            ? 'Live session status shows here when my workstation is online.'
            : p.status === 'working'
            ? 'A Claude session is actively working on this project right now.'
            : p.status === 'online'
              ? `${p.agents.length} Claude session${p.agents.length > 1 ? 's are' : ' is'} open on this project.`
              : 'No Claude session is running on this project at the moment.'}
        </section>
      </div>
    </aside>
  );
}
