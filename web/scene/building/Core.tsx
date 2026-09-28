import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { deskStatus, gitDirtyCount, useOffice } from '../../store';
import { InstancedKit } from './Furniture';
import { decorKit, loungeKit } from './kits';
import { M } from './materials';
import { H, HZ, LIFT, RECEPTION, type BuildingPlan } from './plan';

/** Lobby display: real counts from the snapshot, redrawn only when they change. */
function LobbyScreen() {
  const snap = useOffice((s) => s.snapshot);
  const stats = useMemo(() => {
    const ps = snap?.projects ?? [];
    return {
      projects: ps.length,
      live: ps.reduce((n, p) => n + p.claude.live, 0),
      working: ps.reduce((n, p) => n + p.claude.working, 0),
      modified: ps.filter((p) => gitDirtyCount(p) > 0).length,
      busiest: ps.filter((p) => deskStatus(p) === 'working').map((p) => p.name).slice(0, 3),
    };
  }, [snap]);
  const key = JSON.stringify(stats);
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 1024, 512);
    grd.addColorStop(0, '#06141a');
    grd.addColorStop(1, '#0b0f14');
    g.fillStyle = grd;
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#67e8f9';
    g.font = '800 58px "JetBrains Mono", monospace';
    g.fillText('DEV OFFICE', 60, 105);
    g.fillStyle = '#7f8f98';
    g.font = '500 26px "JetBrains Mono", monospace';
    g.fillText('live workspace status', 62, 150);
    const cells: [string, number, string][] = [
      ['PROJECTS', stats.projects, '#e6f1f4'],
      ['CLAUDE LIVE', stats.live, '#67e8f9'],
      ['WORKING', stats.working, '#67e8f9'],
      ['GIT MODIFIED', stats.modified, '#fbbf24'],
    ];
    cells.forEach(([label, v, col], i) => {
      const x = 60 + i * 235;
      g.fillStyle = '#7f8f98';
      g.font = '600 22px "JetBrains Mono", monospace';
      g.fillText(label, x, 250);
      g.fillStyle = col;
      g.font = '800 96px "JetBrains Mono", monospace';
      g.fillText(String(v), x, 350);
    });
    g.fillStyle = '#b6d5dc';
    g.font = '500 26px "JetBrains Mono", monospace';
    g.fillText(stats.busiest.length ? `● working now: ${stats.busiest.join(', ')}` : 'no session reporting busy right now', 60, 440);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => tex.dispose(), [tex]);
  const m = M();
  return (
    <group position={[LIFT.x0 - 0.1, 1.75, (LIFT.z0 + LIFT.z1) / 2]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh material={m.screenBezel}>
        <boxGeometry args={[2.3, 1.2, 0.06]} />
      </mesh>
      <mesh position={[0, 0, 0.031]}>
        <planeGeometry args={[2.2, 1.1]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

function logoTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 1024, 256);
  g.fillStyle = '#ffffff';
  g.font = '800 120px "Inter", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('DEV OFFICE', 512, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Core({ plan, floors }: { plan: BuildingPlan; floors: [boolean, boolean] }) {
  const m = M();
  const logo = useMemo(logoTexture, []);
  useEffect(() => () => logo.dispose(), [logo]);
  const lounge = useMemo(loungeKit, []);
  const decor = useMemo(decorKit, []);
  const rx = (RECEPTION.x0 + RECEPTION.x1) / 2;
  const rz = (RECEPTION.z0 + RECEPTION.z1) / 2;

  const emptyGround = plan.empty.filter((e) => e.floor === 0);
  const emptyUpper = plan.empty.filter((e) => e.floor === 1);
  const plants0 = useMemo(
    () => [
      { x: 0.7, y: 0, z: 6.5, rotY: 0 },
      { x: 0.7, y: 0, z: -6.5, rotY: 0 },
      { x: 10.4, y: 0, z: 6.4, rotY: 0 },
      { x: plan.length - 0.7, y: 0, z: 1.2, rotY: 0 },
    ],
    [plan.length],
  );
  const plants1 = useMemo(
    () => [
      { x: 0.7, y: H, z: 6.5, rotY: 0 },
      { x: 0.7, y: H, z: -6.5, rotY: 0 },
      { x: 6.8, y: H, z: -6.4, rotY: 0 },
      { x: plan.length - 0.7, y: H, z: 1.2, rotY: 0 },
    ],
    [plan.length],
  );

  return (
    <group>
      <group visible={floors[0]}>
        {/* reception desk */}
        <mesh material={m.walnut} position={[rx, 0.55, rz]} castShadow receiveShadow>
          <boxGeometry args={[RECEPTION.x1 - RECEPTION.x0, 1.1, RECEPTION.z1 - RECEPTION.z0]} />
        </mesh>
        <mesh material={m.whiteLaminate} position={[rx, 1.12, rz]} castShadow>
          <boxGeometry args={[RECEPTION.x1 - RECEPTION.x0 + 0.1, 0.04, RECEPTION.z1 - RECEPTION.z0 + 0.1]} />
        </mesh>
        {/* backlit logo wall */}
        <mesh material={m.accentWall} position={[rx, 1.6, -HZ + 0.12]} receiveShadow>
          <boxGeometry args={[4.4, 3.0, 0.1]} />
        </mesh>
        <mesh position={[rx, 2.05, -HZ + 0.18]}>
          <planeGeometry args={[3.4, 0.85]} />
          <meshBasicMaterial map={logo} color="#9ff3ff" transparent toneMapped={false} />
        </mesh>
        <LobbyScreen />
        {/* waiting sofa + table */}
        <mesh material={m.leather} position={[1.4, 0.3, 4.8]} castShadow>
          <boxGeometry args={[0.85, 0.3, 2.2]} />
        </mesh>
        <mesh material={m.leather} position={[1.05, 0.62, 4.8]} castShadow>
          <boxGeometry args={[0.2, 0.5, 2.2]} />
        </mesh>
        <mesh material={m.walnut} position={[2.6, 0.38, 4.8]} castShadow>
          <cylinderGeometry args={[0.45, 0.45, 0.04, 32]} />
        </mesh>
        <InstancedKit parts={decor} at={plants0} />
        <InstancedKit parts={lounge} at={emptyGround} />
      </group>
      <group visible={floors[1]}>
        {/* level-1 break area: coffee bar + high table */}
        <mesh material={m.walnut} position={[2.2, H + 0.52, -5.6]} castShadow receiveShadow>
          <boxGeometry args={[3.2, 1.04, 0.7]} />
        </mesh>
        <mesh material={m.whiteLaminate} position={[2.2, H + 1.06, -5.6]} castShadow>
          <boxGeometry args={[3.3, 0.04, 0.8]} />
        </mesh>
        <mesh material={m.aluminium} position={[1.4, H + 1.25, -5.75]} castShadow>
          <boxGeometry args={[0.4, 0.35, 0.35]} />
        </mesh>
        <mesh material={m.walnut} position={[4.4, H + 1.02, -5.2]} castShadow receiveShadow>
          <boxGeometry args={[2.4, 0.05, 0.9]} />
        </mesh>
        <mesh material={m.blackMetal} position={[4.4, H + 0.5, -5.2]} castShadow>
          <boxGeometry args={[0.12, 1.0, 0.6]} />
        </mesh>
        <InstancedKit parts={decor} at={plants1} />
        <InstancedKit parts={lounge} at={emptyUpper} />
      </group>
    </group>
  );
}
