import { useEffect, useRef } from 'react';
import { DeskLabels } from './scene/labels';
import { Scene } from './scene/Scene';
import { orderedIds } from './scene/usePlan';
import { useOffice } from './store';
import { Hud } from './ui/Hud';
import { ProjectPanel } from './ui/ProjectPanel';
import { PromptDialog } from './ui/PromptDialog';
import { SearchPalette } from './ui/SearchPalette';
import { TerminalDock } from './ui/TerminalDock';
import { WalkHud } from './ui/WalkHud';

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useOffice.getState();
      const typing = e.target instanceof HTMLElement && (e.target.closest('input, textarea, .xterm') !== null);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        s.setPalette(!s.paletteOpen);
        return;
      }
      if (s.mode === 'walk') {
        // in first person WASD/E belong to the player; only a few global keys apply
        if (typing || s.promptFor || s.paletteOpen) {
          if (e.key === 'Escape') s.paletteOpen ? s.setPalette(false) : s.promptFor && s.openPrompt(null);
          return;
        }
        if (e.key === 'v' || e.key === 'V') s.setMode('overview');
        if (e.key === '`') s.setDock(!s.dockOpen);
        if (e.key === 'Escape' && s.panelOpen) s.closePanel();
        return;
      }
      if (e.key === 'Escape') {
        if (s.paletteOpen) return s.setPalette(false);
        if (s.promptFor) return s.openPrompt(null);
        if (typing) return;
        return s.overview();
      }
      if (typing || s.paletteOpen || s.promptFor) return;

      if (e.key === '/') {
        e.preventDefault();
        s.setPalette(true);
        return;
      }
      if (e.key === 'v' || e.key === 'V') return s.setMode('walk');
      if (e.key === 'o' || e.key === 'O') return s.overview();
      if (e.key === '1') return s.setViewFloor(0);
      if (e.key === '2') return s.setViewFloor(1);
      if (e.key === '`') return s.setDock(!s.dockOpen);
      if (e.key === 'p' && s.selectedId) return s.openPrompt(s.selectedId);
      if (e.key === 'Enter' && s.selectedId && !s.panelOpen) return s.select(s.selectedId, { openPanel: true });

      // arrows step through offices in building order
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (step && s.snapshot?.projects.length) {
        e.preventDefault();
        const ids = orderedIds(s.snapshot.projects);
        const i = s.selectedId ? ids.indexOf(s.selectedId) : -1;
        const next = ids[(i + step + ids.length) % ids.length] ?? ids[0];
        s.select(next, { openPanel: s.panelOpen });
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
          // clicking empty floor (not a drag) returns to the overview
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
      <ProjectPanel />
      <TerminalDock />
      <PromptDialog />
      <SearchPalette />
      {!hasSnapshot && (
        <div className="boot">
          <div className="boot-inner">
            <div className="boot-title">DEV OFFICE</div>
            <div className="boot-sub">{connected ? 'scanning workspace…' : 'connecting to local backend…'}</div>
          </div>
        </div>
      )}
      {hasSnapshot && !connected && <div className="conn-lost">Backend disconnected — reconnecting…</div>}
      {toast && <div className={`toast t-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
