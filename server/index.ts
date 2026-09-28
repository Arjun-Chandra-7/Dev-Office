import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { StateMessage } from '../shared/types.ts';
import { APP_DIR, DEV_ROOT, HOST, IS_PROD, LIMITS, PORT } from './config.ts';
import { Office } from './office.ts';

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), '[office]', ...a);

const office = new Office();
const app = express();
app.disable('x-powered-by');

// ---- local-only guards -------------------------------------------------------------------
// Bound to 127.0.0.1, plus: Host must be a loopback name (defeats DNS rebinding) and any
// browser Origin must be loopback (defeats cross-site requests / CSRF from other tabs).
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostOk = (host: string | undefined) => !!host && LOOPBACK.has(host.replace(/:\d+$/, '').toLowerCase());
const originOk = (origin: string | undefined) => {
  if (!origin) return true; // non-browser clients (curl) send no Origin
  try {
    return LOOPBACK.has(new URL(origin).hostname.toLowerCase()) || new URL(origin).hostname === '[::1]';
  } catch {
    return false;
  }
};

app.use((req, res, next) => {
  if (!hostOk(req.headers.host)) return res.status(421).json({ error: 'Host not allowed' });
  if (!originOk(req.headers.origin)) return res.status(403).json({ error: 'Origin not allowed' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '64kb' }));

// Mutating endpoints require JSON bodies, which cross-origin pages cannot send without a
// CORS preflight — and we never answer preflights.
const requireJson = (req: Request, res: Response, next: NextFunction) =>
  req.is('application/json') ? next() : res.status(415).json({ error: 'Content-Type must be application/json' });

function project(req: Request, res: Response) {
  const p = office.resolveProjectDir(String(req.params.id));
  if (!p) {
    res.status(404).json({ error: 'Unknown project' });
    return null;
  }
  return p;
}

// ---- API ---------------------------------------------------------------------------------
app.get('/api/system', (_req, res) => res.json(office.current().system));

app.get('/api/state', (_req, res) => res.json(office.current()));

app.get('/api/projects', (_req, res) => res.json(office.current().projects));

app.get('/api/projects/:id', (req, res) => {
  if (!project(req, res)) return;
  const p = office.current().projects.find((x) => x.id === req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Unknown project' });
});

app.get('/api/projects/:id/sessions', (req, res) => {
  if (!project(req, res)) return;
  const snap = office.current();
  const p = snap.projects.find((x) => x.id === req.params.id);
  res.json({
    detected: p?.claude.sessions ?? [],
    launched: snap.launched.filter((s) => s.projectId === req.params.id),
  });
});

app.post('/api/projects/:id/claude', requireJson, (req, res) => {
  const p = project(req, res);
  if (!p) return;
  const prompt = req.body?.prompt;
  if (prompt !== undefined && typeof prompt !== 'string') return res.status(400).json({ error: 'prompt must be a string' });
  if ((prompt ?? '').length > LIMITS.promptMaxChars) return res.status(413).json({ error: 'Prompt too long' });
  if (!office.system.claude.available) return res.status(503).json({ error: office.system.claude.error ?? 'Claude CLI unavailable' });
  try {
    const cols = Number(req.body?.cols) || 120;
    const rows = Number(req.body?.rows) || 34;
    const s = office.ptys.launch(p.id, p.name, p.path, (prompt ?? '').replace(/\r\n/g, '\n'), cols, rows);
    log(`launch claude session=${s.id} pid=${s.pid} project=${p.name} state=${s.state}`);
    res.status(s.state === 'failed' ? 500 : 201).json(s);
  } catch (e) {
    res.status(429).json({ error: (e as Error).message });
  }
});

app.get('/api/sessions', (_req, res) => res.json(office.ptys.list()));

const sessionId = (req: Request) => (/^[a-f0-9]{12}$/.test(String(req.params.sid)) ? String(req.params.sid) : null);

app.post('/api/sessions/:sid/stop', requireJson, (req, res) => {
  const sid = sessionId(req);
  if (!sid || !office.ptys.get(sid)) return res.status(404).json({ error: 'Unknown session' });
  const ok = office.ptys.stop(sid);
  log(`stop session=${sid} ok=${ok}`);
  res.json({ ok });
});

app.delete('/api/sessions/:sid', (req, res) => {
  const sid = sessionId(req);
  if (!sid || !office.ptys.get(sid)) return res.status(404).json({ error: 'Unknown session' });
  res.json({ ok: office.ptys.dismiss(sid) });
});

app.post('/api/refresh', requireJson, async (_req, res) => {
  await office.forceRefresh();
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---- static frontend (production) --------------------------------------------------------
const distDir = path.join(APP_DIR, 'dist');
if (IS_PROD) {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) log('WARNING: dist/ missing — run `npm run build` first');
  app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(distDir, 'index.html')) : next()));
}

// ---- websockets --------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const stateClients = new Set<WebSocket>();

server.on('upgrade', (req, socket, head) => {
  if (!hostOk(req.headers.host) || !req.headers.origin || !originOk(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/ws/state') {
    return wss.handleUpgrade(req, socket, head, (ws) => {
      stateClients.add(ws);
      ws.send(JSON.stringify({ type: 'snapshot', data: office.current() } satisfies StateMessage));
      ws.on('close', () => stateClients.delete(ws));
    });
  }
  const m = url.pathname.match(/^\/ws\/pty\/([a-f0-9]{12})$/);
  if (m) return wss.handleUpgrade(req, socket, head, (ws) => office.ptys.attach(m[1], ws));
  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
});

office.on('snapshot', (snap) => {
  const msg = JSON.stringify({ type: 'snapshot', data: snap } satisfies StateMessage);
  for (const ws of stateClients) if (ws.readyState === 1) ws.send(msg);
});

// ---- lifecycle ---------------------------------------------------------------------------
let shuttingDown = false;
function shutdown(sig: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${sig}: stopping launched Claude sessions`);
  office.ptys.killAll();
  office.stop();
  for (const ws of wss.clients) ws.close(1001, 'server shutting down');
  server.close();
  setTimeout(() => {
    office.ptys.killAllHard();
    process.exit(0);
  }, 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
process.on('uncaughtException', (e) => log('uncaught', e));
process.on('unhandledRejection', (e) => log('unhandled rejection', e));

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    log(`Port ${PORT} is already in use — is DEV OFFICE already running? (http://localhost:${PORT})`);
    process.exit(1);
  }
  throw e;
});

await office.start();
server.listen(PORT, HOST, () => {
  const s = office.system;
  log(`DEV OFFICE on http://localhost:${PORT}  root=${DEV_ROOT}`);
  log(`claude=${s.claude.version ?? 'unavailable'} git=${s.git.version ?? 'unavailable'} gh=${s.gh.authenticated ? s.gh.account : 'unauthenticated'} procfs=${s.procfs}`);
  log(`${office.current().projects.length} projects discovered`);
});
