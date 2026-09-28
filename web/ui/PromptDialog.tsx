import { useEffect, useRef, useState } from 'react';
import { Api, tildify, useOffice, useProject } from '../store';

export function PromptDialog() {
  const projectId = useOffice((s) => s.promptFor);
  const p = useProject(projectId);
  const openPrompt = useOffice((s) => s.openPrompt);
  const openTerminal = useOffice((s) => s.openTerminal);
  const notify = useOffice((s) => s.notify);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (projectId) {
      setError(null);
      setTimeout(() => ta.current?.focus(), 30);
    }
  }, [projectId]);

  if (!projectId || !p) return null;

  const start = async (prompt: string) => {
    setBusy(true);
    setError(null);
    try {
      // Size the PTY to the terminal dock so Claude's TUI renders correctly from the start.
      const cols = Math.max(80, Math.floor((window.innerWidth - 40) / 8.4));
      const rows = Math.max(16, Math.floor((window.innerHeight * 0.46) / 17));
      const s = await Api.launch(p.id, prompt, cols, rows);
      if (s.state === 'failed') throw new Error(s.error ?? 'failed to start');
      setText('');
      openPrompt(null);
      openTerminal(s.id);
      notify(`Claude started in ${p.name} (pid ${s.pid})`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && openPrompt(null)}>
      <form
        className="modal prompt"
        onSubmit={(e) => {
          e.preventDefault();
          start(text);
        }}
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">Prompt Claude</div>
            <h2>{p.name}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={() => openPrompt(null)} aria-label="Close">
            ✕
          </button>
        </div>
        <textarea
          ref={ta}
          value={text}
          maxLength={20000}
          placeholder="Describe the task… e.g. Inspect the authentication implementation and find why the session expires after refresh. Do not modify anything yet."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              start(text);
            }
          }}
        />
        <div className="prompt-foot">
          <div className="muted small">
            Runs the installed <span className="mono">claude</span> CLI as an interactive session in{' '}
            <span className="mono">{tildify(p.path)}</span>. Claude's own permission prompts apply.
          </div>
          {error && <div className="warn-text">{error}</div>}
          <div className="prompt-actions">
            <button type="button" className="btn ghost" disabled={busy} onClick={() => start('')}>
              Start without prompt
            </button>
            <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
              {busy ? 'Starting…' : 'Start Claude session'} <kbd>Ctrl ↵</kbd>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
