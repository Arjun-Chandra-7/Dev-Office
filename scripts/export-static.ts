// Writes web/public/portfolio.json for static hosting (Vercel): the current project list + curated
// content from this machine, with live session status stripped (a snapshot can't be "live").
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '../server/config.ts';
import { Office } from '../server/office.ts';

const office = new Office();
await office.start();
const snap = office.current();
office.stop();

const out = {
  ...snap,
  statusAvailable: false,
  projects: snap.projects.map((p) => ({ ...p, status: 'offline' as const, agents: [] })),
};
const file = path.join(APP_DIR, 'web', 'public', 'portfolio.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`wrote ${path.relative(APP_DIR, file)}: ${out.projects.length} projects`);
process.exit(0);
