// Adversarial checks against a running DEV OFFICE portfolio server (read-only API).
import http from 'node:http';
import os from 'node:os';
import WebSocket from 'ws';

const PORT = Number(process.env.DEV_OFFICE_PORT ?? 4317);
const PUBLIC = process.env.DEV_OFFICE_PUBLIC === '1';

function req(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    // fresh connection per request: refused POSTs close the socket without reading the body
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers, agent: false }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ code: res.statusCode, data }));
    });
    r.on('error', (e) => resolve({ code: `ERR ${e.message}`, data: '' }));
    if (body) r.write(body);
    r.end();
  });
}
const H = { Host: `localhost:${PORT}` };
const J = { ...H, 'Content-Type': 'application/json' };

let fail = 0;
const check = (name, pass, detail) => {
  if (!pass) fail++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${detail}`);
};

for (const [method, path] of [
  ['POST', '/api/projects/jarvis/claude'],
  ['POST', '/api/refresh'],
  ['PUT', '/api/portfolio'],
  ['DELETE', '/api/portfolio'],
  ['POST', '/api/sessions/aaaaaaaaaaaa/stop'],
]) {
  const r = await req(path, { method, headers: J, body: '{"prompt":"x"}' });
  check(`${method} ${path} refused`, r.code === 405 || r.code === 404, `-> ${r.code}`);
}
for (const path of ['/api/projects/../../etc/passwd', '/api/state', '/api/system', '/api/sessions']) {
  const r = await req(path, { headers: H });
  check(`legacy/traversal GET ${path}`, r.code === 404, `-> ${r.code}`);
}
if (!PUBLIC) {
  const r = await req('/api/portfolio', { headers: { Host: `evil.example:${PORT}` } });
  check('DNS-rebinding Host rejected', r.code === 421, `-> ${r.code}`);
}

// the public payload must not leak anything about the machine
const snap = await req('/api/portfolio', { headers: H });
check('GET /api/portfolio ok', snap.code === 200, `-> ${snap.code}`);
const home = os.homedir();
const leaks = [home, '/proc', '.claude', 'pid', 'cwd', 'sessionId', 'command', 'Madara/Dev'].filter((s) => snap.data.includes(s));
check('payload leaks no paths / pids / commands', leaks.length === 0, leaks.length ? `found: ${leaks.join(', ')}` : '');

// websocket: read-only; foreign origins rejected in local mode
const ws = (origin) =>
  new Promise((resolve) => {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws/state`, { headers: origin ? { Origin: origin, ...H } : H });
    w.on('open', () => {
      w.send('{"type":"input","data":"rm -rf /"}');
      w.on('close', (code) => resolve(`opened, closed on client message (${code})`));
      setTimeout(() => resolve('opened, still open after client message'), 800);
    });
    w.on('error', (e) => resolve(`rejected (${e.message})`));
  });
if (!PUBLIC) check('WS foreign Origin rejected', (await ws('https://evil.example')).startsWith('rejected'), '');
const local = await ws(`http://localhost:${PORT}`);
check('WS closes on any client message', local.includes('closed on client message'), local);

console.log(fail ? `${fail} FAILED` : 'all security checks passed');
process.exit(fail ? 1 : 0);
