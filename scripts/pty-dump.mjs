// Debug helper: print the retained scrollback of an office-launched session (ANSI stripped).
// usage: node scripts/pty-dump.mjs <sessionId>
import WebSocket from 'ws';

const id = process.argv[2];
const ws = new WebSocket(`ws://localhost:4317/ws/pty/${id}`, { headers: { Origin: 'http://localhost:4317' } });
let out = '';
ws.on('message', (m) => {
  const msg = JSON.parse(String(m));
  if (msg.type === 'output') out += msg.data;
});
setTimeout(() => {
  ws.close();
  console.log(out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, ''));
}, 1500);
