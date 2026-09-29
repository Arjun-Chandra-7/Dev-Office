import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { StateMessage } from '../shared/types.ts';
import { APP_DIR, DEV_ROOT, HOST, IS_PROD, PORT, PUBLIC } from './config.ts';
import { Office } from './office.ts';

// Read-only portfolio server: project names, statuses and curated content. There is no endpoint
// that writes, launches or reveals anything about the machine.

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), '[office]', ...a);
const office = new Office();
const app = express();
app.disable('x-powered-by');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostOk = (host: string | undefined) => PUBLIC || (!!host && LOOPBACK.has(host.replace(/:\d+$/, '').toLowerCase()));
const originOk = (origin: string | undefined) => {
  if (PUBLIC || !origin) return true;
  try {
    return LOOPBACK.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
};

app.use((req, res, next) => {
  if (!hostOk(req.headers.host)) return res.status(421).json({ error: 'Host not allowed' });
  if (!originOk(req.headers.origin)) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Read-only' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/api/portfolio', (_req, res) => res.json(office.current()));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

const distDir = path.join(APP_DIR, 'dist');
if (IS_PROD) {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) log('WARNING: dist/ missing — run `npm run build` first');
  // baked kit assets are content-hashed by name only when rebuilt; cache for a day
  app.use('/kit', express.static(path.join(distDir, 'kit'), { maxAge: '1d' }));
  app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));
  app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
const clients = new Set<WebSocket>();

server.on('upgrade', (req, socket, head) => {
  if (!hostOk(req.headers.host) || (!PUBLIC && (!req.headers.origin || !originOk(req.headers.origin)))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws/state') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'snapshot', data: office.current() } satisfies StateMessage));
    ws.on('message', () => ws.close(1003, 'read-only')); // clients never send anything
    ws.on('close', () => clients.delete(ws));
  });
});

office.on('snapshot', (snap) => {
  const msg = JSON.stringify({ type: 'snapshot', data: snap } satisfies StateMessage);
  for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
});

function shutdown(sig: string) {
  log(`${sig}: bye`);
  office.stop();
  for (const ws of wss.clients) ws.close(1001, 'server shutting down');
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
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
  log(`DEV OFFICE portfolio on http://${PUBLIC ? '0.0.0.0' : 'localhost'}:${PORT}  root=${DEV_ROOT}${PUBLIC ? '  (PUBLIC mode)' : ''}`);
  log(`${office.current().projects.length} projects`);
});
