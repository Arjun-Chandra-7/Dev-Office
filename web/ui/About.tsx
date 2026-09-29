import { useEffect, useRef } from 'react';
import { useOffice } from '../store';
import { Rich } from './Rich';

/** "About me" card shown when a visitor arrives (and via the About button / I key). */
export function About() {
  const open = useOffice((s) => s.aboutOpen);
  const about = useOffice((s) => s.snapshot?.about);
  const ready = useOffice((s) => s.ready);
  const setAbout = useOffice((s) => s.setAbout);
  const setMode = useOffice((s) => s.setMode);
  const count = useOffice((s) => s.snapshot?.projects.length ?? 0);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => primary.current?.focus(), 50);
  }, [open]);
  if (!open || !about) return null;

  return (
    <div className="about-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setAbout(false)}>
      <article className="about" aria-label={`About ${about.name}`}>
        <div className="about-photo">
          <img src={about.photo} alt={`Portrait of ${about.name}`} width={450} height={403} />
        </div>
        <div className="about-body">
          <div className="eyebrow">Welcome to my office</div>
          <h1>{about.name}</h1>
          <div className="about-tag">{about.tagline}</div>
          {about.paragraphs.map((p, i) => (
            <p key={i}>
              <Rich text={p} />
            </p>
          ))}
          <div className="about-actions">
            <button
              ref={primary}
              className="btn primary"
              disabled={!ready}
              onClick={() => {
                setAbout(false);
                setMode('walk');
              }}
            >
              {ready ? 'Walk in' : 'Loading the office…'} <kbd>V</kbd>
            </button>
            <button className="btn" onClick={() => setAbout(false)}>
              Explore from above
            </button>
          </div>
          <div className="muted small">
            {count} project{count === 1 ? '' : 's'} inside · each office shows whether a Claude session is working on it right now
          </div>
        </div>
      </article>
    </div>
  );
}
