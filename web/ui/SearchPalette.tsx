import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../shared/types';
import { deskStatus, gitDirtyCount, useOffice } from '../store';

const NO_PROJECTS: Project[] = [];

/** Subsequence fuzzy score; higher is better, -1 = no match. */
function score(q: string, p: Project) {
  const hay = `${p.name} ${p.description.text ?? ''} ${p.repos.map((r) => r.github?.repo ?? '').join(' ')}`.toLowerCase();
  const name = p.name.toLowerCase();
  if (!q) return 0;
  if (name.startsWith(q)) return 100;
  if (name.includes(q)) return 80;
  let i = 0;
  for (const ch of name) if (ch === q[i]) i++;
  if (i === q.length) return 50;
  return hay.includes(q) ? 20 : -1;
}

export function SearchPalette() {
  const open = useOffice((s) => s.paletteOpen);
  const setPalette = useOffice((s) => s.setPalette);
  const select = useOffice((s) => s.select);
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
    return projects
      .map((p) => ({ p, s: score(qq, p) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || b.p.claude.working - a.p.claude.working || b.p.claude.live - a.p.claude.live || a.p.name.localeCompare(b.p.name))
      .slice(0, 50)
      .map((x) => x.p);
  }, [q, projects]);

  if (!open) return null;
  const go = (p: Project | undefined) => {
    if (!p) return;
    setPalette(false);
    select(p.id);
  };

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Search projects">
        <input
          ref={input}
          value={q}
          placeholder="Search projects…"
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
          {results.map((p, i) => {
            const st = deskStatus(p);
            const dirty = gitDirtyCount(p);
            return (
              <li key={p.id} className={i === idx ? 'active' : ''} onMouseEnter={() => setIdx(i)} onClick={() => go(p)}>
                <span className={`dot s-${st}`} />
                <span className="name">{p.name}</span>
                <span className="desc">{p.description.text ?? ''}</span>
                {p.claude.live > 0 && <span className="chip cyan">{p.claude.live} claude</span>}
                {dirty > 0 && <span className="chip amber">±{dirty}</span>}
              </li>
            );
          })}
          {!results.length && <li className="empty">No projects match “{q}”</li>}
        </ul>
      </div>
    </div>
  );
}
