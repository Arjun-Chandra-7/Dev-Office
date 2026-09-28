// Adversarial checks against a running DEV OFFICE backend. Every case must be rejected
// (except the final sanity read). None of these requests can launch a process: each is
// refused before reaching the PTY manager.
import http from 'node:http';
import WebSocket from 'ws';

const PORT = Number(process.env.DEV_OFFICE_PORT ?? 4317);

function req(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    r.on('error', (e) => resolve(`ERR ${e.message}`));
    if (body) r.write(body);
    r.end();
  });
}
const J = { 'Content-Type': 'application/json', Host: `localhost:${PORT}` };
const H = { Host: `localhost:${PORT}` };

const cases = [
  ['traversal ../ in id (POST)', '/api/projects/..%2F..%2Fetc/claude', { method: 'POST', headers: J, body: '{"prompt":"x"}' }, [404]],
  ['raw ../ segments', '/api/projects/../../etc/passwd', { headers: H }, [404]],
  ['encoded dots id', '/api/projects/%2e%2e', { headers: H }, [404]],
  ['absolute path as id', '/api/projects/%2Fetc%2Fpasswd', { headers: H }, [404]],
  ['unknown id launch', '/api/projects/nope/claude', { method: 'POST', headers: J, body: '{"prompt":"x"}' }, [404]],
  ['shell metachar id', '/api/projects/jarvis%3Brm%20-rf', { headers: H }, [404]],
  ['cross-site Origin POST', '/api/projects/gpt-2/claude', { method: 'POST', headers: { ...J, Origin: 'https://evil.example' }, body: '{"prompt":"x"}' }, [403]],
  ['DNS-rebinding Host', '/api/projects', { headers: { Host: `evil.example:${PORT}` } }, [421]],
  ['form-encoded POST', '/api/projects/gpt-2/claude', { method: 'POST', headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'prompt=x' }, [415]],
  ['prompt not a string', '/api/projects/gpt-2/claude', { method: 'POST', headers: J, body: '{"prompt":{"a":1}}' }, [400]],
  ['oversized prompt (25k chars)', '/api/projects/gpt-2/claude', { method: 'POST', headers: J, body: JSON.stringify({ prompt: 'a'.repeat(25000) }) }, [413]],
  ['bad session id stop', '/api/sessions/zzz/stop', { method: 'POST', headers: J, body: '{}' }, [404]],
  ['sanity: valid read', '/api/projects/jarvis', { headers: H }, [200]],
];

let fail = 0;
for (const [name, path, opts, ok] of cases) {
  const code = await req(path, opts);
  const pass = ok.includes(code);
  if (!pass) fail++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(32)} -> ${code}`);
}

const ws = (path, origin) =>
  new Promise((resolve) => {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}${path}`, { headers: origin ? { Origin: origin, Host: `localhost:${PORT}` } : { Host: `localhost:${PORT}` } });
    w.on('open', () => {
      w.close();
      resolve('opened');
    });
    w.on('error', (e) => resolve(`rejected (${e.message})`));
  });
for (const [name, path, origin, want] of [
  ['WS state, foreign Origin', '/ws/state', 'https://evil.example', 'rejected'],
  ['WS pty, no Origin', '/ws/pty/aaaaaaaaaaaa', null, 'rejected'],
  ['WS pty, bad id format', '/ws/pty/..%2F', 'http://localhost:5173', 'rejected'],
  ['WS state, local Origin (sanity)', '/ws/state', 'http://localhost:5173', 'opened'],
]) {
  const r = await ws(path, origin);
  const pass = r.startsWith(want);
  if (!pass) fail++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(32)} -> ${r}`);
}
console.log(fail ? `${fail} FAILED` : 'all security checks passed');
process.exit(fail ? 1 : 0);
