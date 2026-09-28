// Prints a one-line-per-project summary of GET /api/projects (verification helper).
const base = process.argv[2] ?? 'http://localhost:4317';
const ps = await (await fetch(`${base}/api/projects`)).json();
for (const p of ps) {
  const repos = p.repos
    .map((r) => {
      const st = !r.valid ? `INVALID(${r.error})` : r.clean ? `${r.branch} clean` : `${r.branch} s${r.counts.staged}/m${r.counts.modified}/u${r.counts.untracked}`;
      return `${r.relPath || '.'}:${st} ${r.github ? r.github.owner + '/' + r.github.repo : 'no-gh'}`;
    })
    .join('; ');
  const gh = Object.entries(p.github).map(([k, v]) => `${k}=${v.status}${v.status === 'unavailable' ? '(' + v.reason + ')' : v.status === 'ok' ? '(' + v.data.visibility + ')' : ''}`).join(',');
  console.log(
    `#${p.slot} ${p.id} [${p.kind}] claude live=${p.claude.live} work=${p.claude.working} standby=${p.claude.standby}\n    repos: ${repos || '-'}\n    github: ${gh || '-'}\n    desc(${p.description.source}${p.description.from ? ' ' + p.description.from : ''}): ${(p.description.text ?? '').slice(0, 90)}`,
  );
  for (const s of p.claude.sessions) console.log(`    · pid ${s.pid} ${s.kind} ${s.activity} via ${s.activitySource} cwd=./${s.relCwd} name=${s.name ?? '-'} cmd="${s.command}"`);
}
