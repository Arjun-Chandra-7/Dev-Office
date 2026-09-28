import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import type { LaunchedSession, PtyServerMessage } from '../../shared/types';
import { Api, duration, useOffice } from '../store';

const NO_SESSIONS: LaunchedSession[] = [];

type ConnState = 'connecting' | 'open' | 'closed';

function TerminalView({ session }: { session: LaunchedSession }) {
  const host = useRef<HTMLDivElement>(null);
  const [conn, setConn] = useState<ConnState>('connecting');

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: '#05080a',
        foreground: '#d6e4ea',
        cursor: '#67e8f9',
        selectionBackground: '#164e63',
        black: '#0b0f12',
        cyan: '#67e8f9',
        brightBlack: '#4b5563',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    const doFit = () => {
      try {
        fit.fit();
      } catch {
        /* element hidden */
      }
    };
    doFit();

    let ws: WebSocket | null = null;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let ended = session.state !== 'running';
    let replaying = false;

    const sendResize = () => {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    const connect = () => {
      setConn('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws/pty/${session.id}`);
      ws.onopen = () => {
        setConn('open');
        sendResize();
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as PtyServerMessage;
        if (msg.type === 'replay') {
          // The scrollback contains terminal queries (device attributes, version…) that the
          // program already had answered. xterm would answer them again and those answers would
          // reach the live program as keystrokes, so swallow input until the replay is applied.
          replaying = true;
          term.reset();
          term.write(msg.data, () => {
            replaying = false;
            if (!ended) term.focus();
          });
        } else if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'status') {
          ended = msg.session.state !== 'running';
        } else if (msg.type === 'error') {
          term.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`);
        }
      };
      ws.onclose = (ev) => {
        setConn('closed');
        if (disposed || ended || ev.code === 4404 || ev.code === 4410) return;
        retryTimer = setTimeout(connect, 1200); // reconnect while the session is still running
      };
    };
    connect();

    const dataSub = term.onData((d) => {
      if (replaying || ended) return;
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'input', data: d }));
    });
    const ro = new ResizeObserver(() => {
      doFit();
      sendResize();
    });
    ro.observe(host.current!);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      ro.disconnect();
      dataSub.dispose();
      ws?.close();
      term.dispose();
    };
    // Session identity is what matters; status updates must not recreate the terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  return (
    <div className="term-wrap">
      <div ref={host} className="term-host" />
      {conn !== 'open' && session.state === 'running' && <div className="term-conn">{conn === 'connecting' ? 'connecting…' : 'reconnecting…'}</div>}
    </div>
  );
}

export function TerminalDock() {
  const launched = useOffice((s) => s.snapshot?.launched ?? NO_SESSIONS);
  const open = useOffice((s) => s.dockOpen);
  const active = useOffice((s) => s.activeTerminal);
  const setDock = useOffice((s) => s.setDock);
  const openTerminal = useOffice((s) => s.openTerminal);
  const select = useOffice((s) => s.select);
  const notify = useOffice((s) => s.notify);
  const panelOpen = useOffice((s) => s.panelOpen && !!s.selectedId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // An explicitly requested session that is not in the snapshot yet (just launched) shows a
  // placeholder instead of falling back to — and attaching to — some other session.
  const pending = !!active && !launched.some((l) => l.id === active);
  const current = pending ? undefined : launched.find((l) => l.id === active) ?? launched.find((l) => l.state === 'running') ?? launched[0];
  if (!launched.length && !pending) return null;

  if (!open) {
    const running = launched.filter((l) => l.state === 'running').length;
    return (
      <button className="dock-tab" onClick={() => setDock(true)}>
        <span className={`dot ${running ? 'on' : ''}`} />
        Terminals · {running} running
      </button>
    );
  }

  return (
    <section className={`dock${panelOpen ? " with-panel" : ""}`} aria-label="Claude sessions">
      <div className="dock-head">
        <div className="tabs">
          {launched.map((l) => (
            <button key={l.id} className={`tab ${current?.id === l.id ? 'active' : ''} st-${l.state}`} onClick={() => openTerminal(l.id)}>
              <span className="dot" />
              {l.projectName}
              <span className="muted">{l.state === 'running' ? duration(now - l.startedAt) : l.state === 'failed' ? 'failed' : `exit ${l.exitCode}`}</span>
            </button>
          ))}
        </div>
        {current && (
          <div className="dock-actions">
            <span className={`state-pill st-${current.state}`}>
              {current.state === 'running' ? 'CLAUDE ●' : current.state === 'failed' ? 'FAILED' : `EXITED ${current.exitCode ?? ''}`}
            </span>
            <span className="muted small">pid {current.pid ?? '—'}</span>
            <button className="btn ghost sm" onClick={() => select(current.projectId)}>
              Locate desk
            </button>
            {current.state === 'running' ? (
              <button
                className="btn danger sm"
                onClick={async () => {
                  try {
                    await Api.stop(current.id);
                  } catch (e) {
                    notify(`Stop failed: ${(e as Error).message}`, 'error');
                  }
                }}
              >
                Stop session
              </button>
            ) : (
              <button className="btn ghost sm" onClick={() => Api.dismiss(current.id).catch(() => undefined)}>
                Dismiss
              </button>
            )}
            <button className="icon-btn" title="Minimise (`)" onClick={() => setDock(false)}>
              ▾
            </button>
          </div>
        )}
      </div>
      {current?.promptPreview && <div className="dock-prompt muted small">› {current.promptPreview}</div>}
      {current?.error && <div className="warn-text">{current.error}</div>}
      {current && <TerminalView key={current.id} session={current} />}
      {pending && <div className="term-wrap muted small">starting session…</div>}
    </section>
  );
}
