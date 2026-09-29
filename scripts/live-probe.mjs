// Verification: create / rename / delete a temporary project dir in the Dev root and measure how
// long each change takes to appear on the live /ws/state stream.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const root = process.env.DEV_OFFICE_ROOT ?? path.join(os.homedir(), 'Madara', 'Dev');
const A = path.join(root, 'Office Probe (tmp)');
const B = path.join(root, 'Office Probe renamed');
let names = [];
const PORT = process.env.DEV_OFFICE_PORT ?? 4317;
const ws = new WebSocket(`ws://localhost:${PORT}/ws/state`, { headers: { Origin: `http://localhost:${PORT}` } });
ws.on('message', (m) => {
  const msg = JSON.parse(String(m));
  names = msg.data.projects.map((p) => `${p.name}#${p.id}#slot${p.slot}#${p.status}`);
});
const waitFor = async (pred, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (pred()) return console.log(`${label}: ${Date.now() - t0} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
  console.log(`${label}: TIMEOUT`);
};
await new Promise((r) => ws.on('open', r));
await new Promise((r) => setTimeout(r, 500));

fs.mkdirSync(A);
fs.writeFileSync(path.join(A, 'README.md'), '# Probe\n\nTemporary directory created by the DEV OFFICE live-update test.\n');
await waitFor(() => names.some((n) => n.startsWith('Office Probe (tmp)#')), 'added');
console.log('  ', names.find((n) => n.startsWith('Office Probe (tmp)#')));
fs.renameSync(A, B);
await waitFor(() => names.some((n) => n.startsWith('Office Probe renamed#')) && !names.some((n) => n.startsWith('Office Probe (tmp)#')), 'renamed');
console.log('  ', names.find((n) => n.startsWith('Office Probe renamed#')));
fs.rmSync(B, { recursive: true });
await waitFor(() => !names.some((n) => n.startsWith('Office Probe')), 'removed');
console.log('project count now', names.length);
ws.close();
