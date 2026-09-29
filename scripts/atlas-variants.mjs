// Downscaled atlas variants for lower quality tiers: <name>@2k.webp and <name>@1k.webp.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? 'web/public/kit';
for (const f of fs.readdirSync(dir)) {
  if (!/_(arch|props)\.webp$/.test(f)) continue;
  const base = path.join(dir, f.replace(/\.webp$/, ''));
  for (const [suffix, size, q] of [['@2k', 2048, 85], ['@1k', 1024, 82]]) {
    execFileSync('magick', [path.join(dir, f), '-resize', `${size}x${size}`, '-quality', String(q), `${base}${suffix}.webp`]);
  }
  console.log('variants:', f);
}
