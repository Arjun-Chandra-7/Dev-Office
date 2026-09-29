import { useEffect, useMemo, useRef, useState } from 'react';
import type { PortfolioProject } from '../../shared/types';
import { openProject } from '../scene/actions';
import { STATUS_LABEL, deskStatus, useOffice } from '../store';

const NO_PROJECTS: PortfolioProject[] = [];

/** Subsequence fuzzy score; higher is better, -1 = no match. */
function score(q: string, p: PortfolioProject) {
  const name = `${p.title} ${p.name}`.toLowerCase();
  if (!q) return 0;
  if (p.title.toLowerCase().startsWith(q)) return 100;
  if (name.includes(q)) return 80;
  let i = 0;
  for (const ch of name) if (ch === q[i]) i++;
  if (i === q.length) return 50;
  return (p.summary ?? '').toLowerCase().includes(q) ? 20 : -1;
}

export function SearchPalette() {
  const open = useOffice((s) => s.paletteOpen);
  const setPalette = useOffice((s) => s.setPalette);
  const projects = useOffice((s) => s.snapshot?.projects ?? NO_PROJECTS);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => input.current?.focus(), 20);
    }
  }, [open]);

  const results = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const rank = { working: 2, online: 1, offline: 0 };
    return projects
      .map((p) => ({ p, s: score(qq, p) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || rank[b.p.status] - rank[a.p.status] || a.p.title.localeCompare(b.p.title))
      .map((x) => x.p);
  }, [q, projects]);

  if (!open) return null;
  const go = (p: PortfolioProject | undefined) => {
    if (!p) return;
    setPalette(false);
    openProject(p.id, false);
  };

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Find a project">
        <input
          ref={input}
          value={q}
          placeholder="Find a project…"
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(results[idx]);
            }
          }}
        />
        <ul>
          {results.map((p, i) => (
            <li key={p.id} className={i === idx ? 'active' : ''} onMouseEnter={() => setIdx(i)} onClick={() => go(p)}>
              <span className={`dot s-${deskStatus(p)}`} />
              <span className="name">{p.title}</span>
              <span className="desc">{(p.summary ?? '').replace(/\*\*|`/g, '')}</span>
              <span className={`chip ${p.status === 'offline' ? '' : 'cyan'}`}>{STATUS_LABEL[p.status]}</span>
            </li>
          ))}
          {!results.length && <li className="empty">No projects match “{q}”</li>}
        </ul>
      </div>
    </div>
  );
}
