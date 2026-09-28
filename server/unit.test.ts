import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hits, inStairs, makeBuildingPlan, stairsY, H } from '../web/scene/building/plan.ts';
import { encodeProjectDir } from './claude.ts';
import { parseGithubRemote, parseStatus, redactRemote } from './git.ts';
import { slugify } from './office.ts';

test('parseGithubRemote handles https, ssh and non-GitHub remotes', () => {
  assert.deepEqual(parseGithubRemote('https://github.com/Arjun-Chandra-7/JARVIS.git'), { owner: 'Arjun-Chandra-7', repo: 'JARVIS' });
  assert.deepEqual(parseGithubRemote('git@github.com:owner/repo.name.git'), { owner: 'owner', repo: 'repo.name' });
  assert.deepEqual(parseGithubRemote('ssh://git@github.com/owner/repo'), { owner: 'owner', repo: 'repo' });
  assert.equal(parseGithubRemote('https://gitlab.com/owner/repo.git'), null);
  assert.equal(parseGithubRemote(null), null);
});

test('redactRemote strips embedded credentials', () => {
  assert.equal(redactRemote('https://user:ghp_secret@github.com/o/r.git'), 'https://github.com/o/r.git');
  assert.equal(redactRemote('git@github.com:o/r.git'), 'git@github.com:o/r.git');
});

test('parseStatus counts porcelain v1 states and branch info', () => {
  const s = parseStatus('## main...origin/main [ahead 2, behind 1]\n M a.ts\nM  b.ts\nMM c.ts\n?? d.ts\nUU e.ts\n');
  assert.equal(s.branch, 'main');
  assert.equal(s.upstream, 'origin/main');
  assert.equal(s.ahead, 2);
  assert.equal(s.behind, 1);
  assert.deepEqual(s.counts, { staged: 2, modified: 2, untracked: 1, conflicted: 1 });
  assert.equal(parseStatus('## No commits yet on main\n').branch, 'main');
  assert.equal(parseStatus('## HEAD (no branch)\n').detached, true);
});

test('slugify produces safe, stable ids', () => {
  assert.equal(slugify('Things to Learn'), 'things-to-learn');
  assert.equal(slugify('Office Probe (tmp)'), 'office-probe-tmp');
  assert.equal(slugify('../../etc'), 'etc');
  assert.match(slugify('Jarvis-daily-brain'), /^[a-z0-9-]+$/);
});

test('encodeProjectDir matches ~/.claude/projects naming', () => {
  assert.equal(encodeProjectDir('/home/xor_sensei/Madara/Dev/Jarvis'), '-home-xor-sensei-Madara-Dev-Jarvis');
});

test('building plan: exactly one office per project, no spare desks', () => {
  for (const n of [0, 1, 7, 15, 60]) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const plan = makeBuildingPlan(ids);
    assert.equal(plan.offices.length, n);
    const cells = new Set(plan.offices.map((o) => `${o.floor}:${o.side}:${o.col}`));
    assert.equal(cells.size, n, 'offices never overlap');
    // ground floor takes the first half, level 1 the rest
    assert.equal(plan.offices.filter((o) => o.floor === 0).length, Math.ceil(n / 2));
    // empty bays are lounges, never offices
    for (const e of plan.empty) assert.ok(!cells.has(`${e.floor}:${e.side}:${e.col}`));
  }
});

test('building plan: doors are walkable, walls block', () => {
  const plan = makeBuildingPlan(['a', 'b', 'c']);
  const o = plan.byId.get('a')!;
  const doorX = (o.door.minX + o.door.maxX) / 2;
  const doorZ = (o.door.minZ + o.door.maxZ) / 2;
  const blocking = plan.walls.filter((w) => w.floor === 0);
  assert.ok(!blocking.some((w) => hits(doorX, doorZ, 0.28, w)), 'doorway is clear');
  assert.ok(blocking.some((w) => hits(o.x + 2, doorZ, 0.28, w)), 'glass front beside the door blocks');
});

test('stairs ramp spans one storey', () => {
  assert.ok(inStairs(5, 3));
  assert.equal(stairsY(2.6), 0);
  assert.equal(stairsY(8.6), H);
});
