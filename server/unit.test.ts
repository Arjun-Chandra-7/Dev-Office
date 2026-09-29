import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hits, inStairs, makeBuildingPlan, stairsY, H } from '../web/scene/building/plan.ts';
import { encodeProjectDir } from './claude.ts';
import { contentFor, loadContent, mergeMap, slugify, statusOf } from './office.ts';

test('content: Jarvis extras merge into Jarvis, lookups are case-insensitive', () => {
  const c = loadContent();
  const m = mergeMap(c);
  for (const f of ['Jarvis-daily-brain', 'Jarvis-integration', 'Jarvis-study-companion', 'jarvis-backups']) assert.equal(m.get(f.toLowerCase()), 'jarvis');
  assert.equal(m.has('jarvis'), false);
  assert.equal(contentFor(c, 'cric-coach')?.title, 'CrickLytics');
  assert.equal(contentFor(c, 'Byte-Eats')?.title, 'Byte Labs');
  assert.equal(contentFor(c, 'Unknown-Folder'), null);
});

test('status: working beats online beats offline; standby spares are not sessions', () => {
  const proc = (pid: number, status: string | null, spare = false) =>
    ({ pid, cwd: '/x', startedAt: 0, procStart: String(pid), procState: 'S', argv: ['claude'], kind: 'interactive', command: 'claude',
       sessionFile: status === null ? null : { pid, status, spare } }) as any;
  assert.equal(statusOf([]).status, 'offline');
  assert.equal(statusOf([proc(1, null)]).status, 'online');
  assert.equal(statusOf([proc(1, 'idle'), proc(2, 'busy')]).status, 'working');
  assert.equal(statusOf([proc(1, 'idle', true)]).status, 'offline');
  const { agents } = statusOf([proc(1, 'busy'), proc(2, 'idle')]);
  assert.equal(agents.length, 2);
  assert.ok(agents.every((a) => /^[0-9a-f]{12}$/.test(a.id)), 'agent ids are opaque hashes');
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
