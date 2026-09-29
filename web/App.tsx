import { useEffect, useRef } from 'react';
import { openProject } from './scene/actions';
import { DeskLabels } from './scene/labels';
import { Scene } from './scene/Scene';
import { orderedIds } from './scene/usePlan';
import { useOffice } from './store';
import { About } from './ui/About';
import { Hud } from './ui/Hud';
import { ProjectCard } from './ui/ProjectCard';
import { SearchPalette } from './ui/SearchPalette';
import { WalkHud } from './ui/WalkHud';

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useOffice.getState();
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea') !== null;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        s.setPalette(!s.paletteOpen);
        return;
      }
      if (e.key === 'Escape') {
        if (s.paletteOpen) return s.setPalette(false);
        if (s.aboutOpen) return s.setAbout(false);
        if (s.panelOpen) return s.mode === 'walk' ? s.closePanel() : s.overview();
        if (s.mode === 'overview' && !typing) return s.overview();
        return;
      }
      if (typing || s.paletteOpen) return;
      if (s.aboutOpen) {
        if (e.key === 'v' || e.key === 'V') {
          s.setAbout(false);
          s.setMode('walk');
        }
        return;
      }
      if (e.key === 'i' || e.key === 'I') return s.setAbout(true);

      if (s.mode === 'walk') {
        // in first person WASD / Space / E belong to the player
        if (e.key === 'v' || e.key === 'V') s.setMode('overview');
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        return s.setPalette(true);
      }
      if (e.key === 'v' || e.key === 'V') return s.setMode('walk');
      if (e.key === 'o' || e.key === 'O') return s.overview();
      if (e.key === '1') return s.setViewFloor(0);
      if (e.key === '2') return s.setViewFloor(1);

      // arrows step through offices in building order
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (step && s.snapshot?.projects.length) {
        e.preventDefault();
        const ids = orderedIds(s.snapshot.projects);
        const i = s.selectedId ? ids.indexOf(s.selectedId) : -1;
        openProject(ids[(i + step + ids.length) % ids.length] ?? ids[0], false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useKeyboard();
  const connected = useOffice((s) => s.connected);
  const hasSnapshot = useOffice((s) => !!s.snapshot);
  const toast = useOffice((s) => s.toast);
  const down = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="app">
      <div
        className="stage"
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          // clicking empty space (not a drag) returns to the overview
          const d = down.current;
          down.current = null;
          if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
          requestAnimationFrame(() => {
            const s = useOffice.getState();
            if (s.mode === 'overview' && !s.hoveredId && s.selectedId && e.button === 0) s.overview();
          });
        }}
      >
        <Scene />
        <DeskLabels />
      </div>
      <Hud />
      <WalkHud />
      <ProjectCard />
      <SearchPalette />
      <About />
      {!hasSnapshot && (
        <div className="boot">
          <div className="boot-inner">
            <div className="boot-title">DEV OFFICE</div>
            <div className="boot-sub">{connected ? 'opening the doors…' : 'connecting…'}</div>
          </div>
        </div>
      )}
      {hasSnapshot && !connected && <div className="conn-lost">Live status reconnecting…</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
