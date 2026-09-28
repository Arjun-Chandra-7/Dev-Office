// Building floor plan — pure data, no three.js. One office per project, nothing else.
//
//            x=0                    x=CORE                                      x=L
//   z=+HZ    ┌──────────────────────┬──────────┬──────────┬──────────┬─────────┐  exterior glass
//            │  STAIRS ▲ (x→ up)    │ office   │ office   │ office   │ …       │  north offices
//   z=+C/2   │                      ├──door────┴──door────┴──door────┴─────────┤  glass fronts
//  entrance  │  LOBBY   corridor ──────────────────────────────────────────────  corridor
//   z=-C/2   │        ┌LIFT┐        ├──door────┬──door────┬──door────┬─────────┤
//            │ recept.└────┘        │ office   │ office   │ office   │ …       │  south offices
//   z=-HZ    └──────────────────────┴──────────┴──────────┴──────────┴─────────┘
//
// Ground floor holds the first half of the projects (by server slot order), level 1 the rest.
// Positions are ranks, so the building contains exactly as many offices as projects.

export const H = 3.6; // floor-to-floor
export const SLAB = 0.22;
export const CEIL = 3.05; // ceiling height above a floor
export const CORR = 3.2; // corridor width
export const OFF_W = 5.2; // office width (x)
export const OFF_D = 5.6; // office depth (z)
export const CORE = 11; // lobby / stairs / lift block length
export const WALL = 0.14;
export const HZ = CORR / 2 + OFF_D; // half building depth
export const DOOR_W = 1.15;
export const DOOR_LOCAL_X = -1.65; // door position in office-local x

export const STAIRS = { x0: 2.6, x1: 8.6, z0: 2.3, z1: 4.2 };
export const LIFT = { x0: 8.0, x1: 10.4, z0: -4.6, z1: -2.2, doorX0: 8.6, doorX1: 9.8 };
export const RECEPTION = { x0: 3.0, x1: 5.6, z0: -4.3, z1: -3.3 };

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type WallKind = 'solid' | 'glass' | 'exterior' | 'rail' | 'collider';
export interface WallSeg extends Box {
  floor: number;
  kind: WallKind;
  height: number;
}

export interface OfficeSpot {
  id: string;
  rank: number;
  floor: number;
  side: 1 | -1; // +1 north (z>0), -1 south
  col: number;
  x: number; // office centre
  z: number;
  y: number; // floor level
  rotY: number; // local +z points to the exterior window
  door: Box; // doorway (world)
}

export interface EmptyBay {
  floor: number;
  side: 1 | -1;
  col: number;
  x: number;
  z: number;
  y: number;
  rotY: number;
}

export interface BuildingPlan {
  length: number;
  cols: number;
  offices: OfficeSpot[];
  byId: Map<string, OfficeSpot>;
  empty: EmptyBay[];
  walls: WallSeg[];
  furnitureBoxes: (Box & { floor: number })[];
  spawn: { x: number; z: number; yaw: number };
}

const seg = (floor: number, kind: WallKind, x0: number, x1: number, z0: number, z1: number, height = CEIL): WallSeg => ({
  floor,
  kind,
  height,
  minX: Math.min(x0, x1),
  maxX: Math.max(x0, x1),
  minZ: Math.min(z0, z1),
  maxZ: Math.max(z0, z1),
});

/** local (office) → world, for an office centred at (x, z) with rotation rotY (0 or π). */
export function toWorld(o: { x: number; z: number; rotY: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(o.rotY);
  const s = Math.sin(o.rotY);
  return [o.x + lx * c + lz * s, o.z - lx * s + lz * c];
}

export function makeBuildingPlan(ids: string[]): BuildingPlan {
  const n = ids.length;
  const perFloor = [Math.ceil(n / 2), n - Math.ceil(n / 2)];
  const cols = Math.max(2, Math.ceil(perFloor[0] / 2), Math.ceil(perFloor[1] / 2));
  const L = CORE + cols * OFF_W;

  const offices: OfficeSpot[] = [];
  const occupied = new Set<string>();
  ids.forEach((id, rank) => {
    const floor = rank < perFloor[0] ? 0 : 1;
    const j = floor === 0 ? rank : rank - perFloor[0];
    const side: 1 | -1 = j % 2 === 0 ? 1 : -1;
    const col = Math.floor(j / 2);
    const x = CORE + col * OFF_W + OFF_W / 2;
    const z = side * (CORR / 2 + OFF_D / 2);
    const rotY = side === 1 ? 0 : Math.PI;
    const spot = { id, rank, floor, side, col, x, z, y: floor * H, rotY } as OfficeSpot;
    const [dx] = toWorld(spot, DOOR_LOCAL_X, 0);
    const fz = side * (CORR / 2);
    spot.door = { minX: dx - DOOR_W / 2, maxX: dx + DOOR_W / 2, minZ: fz - 0.3, maxZ: fz + 0.3 };
    offices.push(spot);
    occupied.add(`${floor}:${side}:${col}`);
  });

  const empty: EmptyBay[] = [];
  for (const floor of [0, 1])
    for (let col = 0; col < cols; col++)
      for (const side of [1, -1] as const)
        if (!occupied.has(`${floor}:${side}:${col}`))
          empty.push({ floor, side, col, x: CORE + col * OFF_W + OFF_W / 2, z: side * (CORR / 2 + OFF_D / 2), y: floor * H, rotY: side === 1 ? 0 : Math.PI });

  const walls: WallSeg[] = [];
  const t = WALL / 2;
  for (const floor of [0, 1]) {
    // exterior curtain walls
    walls.push(seg(floor, 'exterior', 0, L, HZ - t, HZ + t), seg(floor, 'exterior', 0, L, -HZ - t, -HZ + t));
    walls.push(seg(floor, 'exterior', L - t, L + t, -HZ, HZ));
    if (floor === 0) {
      // west façade with the entrance
      walls.push(seg(0, 'exterior', -t, t, -HZ, -1.3), seg(0, 'exterior', -t, t, 1.3, HZ));
    } else walls.push(seg(1, 'exterior', -t, t, -HZ, HZ));

    // partitions between bays (and between core and first bay)
    for (let c = 0; c <= cols; c++) {
      const x = CORE + c * OFF_W;
      for (const side of [1, -1] as const) {
        const hasEither =
          occupied.has(`${floor}:${side}:${c - 1}`) || occupied.has(`${floor}:${side}:${c}`) || c === 0 || c === cols;
        if (hasEither) walls.push(seg(floor, 'solid', x - t, x + t, side * (CORR / 2), side * HZ));
      }
    }
    // glass office fronts with doors (only for real offices — empty bays stay open lounges)
    for (const o of offices.filter((q) => q.floor === floor)) {
      const fz = o.side * (CORR / 2);
      const x0 = o.x - OFF_W / 2;
      const x1 = o.x + OFF_W / 2;
      walls.push(seg(floor, 'glass', x0, o.door.minX, fz - t, fz + t), seg(floor, 'glass', o.door.maxX, x1, fz - t, fz + t));
    }
    // lift shaft
    walls.push(
      seg(floor, 'solid', LIFT.x0 - t, LIFT.x0 + t, LIFT.z0, LIFT.z1),
      seg(floor, 'solid', LIFT.x1 - t, LIFT.x1 + t, LIFT.z0, LIFT.z1),
      seg(floor, 'solid', LIFT.x0, LIFT.x1, LIFT.z0 - t, LIFT.z0 + t),
      seg(floor, 'solid', LIFT.x0, LIFT.doorX0, LIFT.z1 - t, LIFT.z1 + t),
      seg(floor, 'solid', LIFT.doorX1, LIFT.x1, LIFT.z1 - t, LIFT.z1 + t),
    );
  }
  // stairs: enclosed under the flight on the ground floor, railings around the void upstairs
  walls.push(
    seg(0, 'collider', STAIRS.x0 + 0.4, STAIRS.x1, STAIRS.z0 - t, STAIRS.z0 + t, 1),
    seg(0, 'collider', STAIRS.x0, STAIRS.x1, STAIRS.z1 - t, STAIRS.z1 + t, 1),
    seg(0, 'collider', STAIRS.x1 - t, STAIRS.x1 + t, STAIRS.z0, STAIRS.z1, 1),
    seg(1, 'rail', STAIRS.x0, STAIRS.x1 - 0.3, STAIRS.z0 - t, STAIRS.z0 + t, 1.05),
    seg(1, 'rail', STAIRS.x0, STAIRS.x1, STAIRS.z1 - t, STAIRS.z1 + t, 1.05),
    seg(1, 'rail', STAIRS.x0 - t, STAIRS.x0 + t, STAIRS.z0, STAIRS.z1, 1.05),
  );

  // furniture that blocks walking: desk + bookshelf in every office, reception desk
  const furnitureBoxes: (Box & { floor: number })[] = [];
  const localBox = (o: OfficeSpot, x0: number, x1: number, z0: number, z1: number) => {
    const [ax, az] = toWorld(o, x0, z0);
    const [bx, bz] = toWorld(o, x1, z1);
    furnitureBoxes.push({ floor: o.floor, minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) });
  };
  for (const o of offices) {
    localBox(o, -0.65, 1.25, 0.75, 1.65); // desk
    localBox(o, 2.2, 2.6, 0.1, 2.1); // bookshelf
  }
  furnitureBoxes.push({ floor: 0, minX: RECEPTION.x0, maxX: RECEPTION.x1, minZ: RECEPTION.z0, maxZ: RECEPTION.z1 });

  return {
    length: L,
    cols,
    offices,
    byId: new Map(offices.map((o) => [o.id, o])),
    empty,
    walls,
    furnitureBoxes,
    spawn: { x: 1.6, z: 0, yaw: -Math.PI / 2 },
  };
}

// ---- walking physics helpers ------------------------------------------------------------------

export function inStairs(x: number, z: number) {
  return x >= STAIRS.x0 && x <= STAIRS.x1 && z >= STAIRS.z0 && z <= STAIRS.z1;
}
export function stairsY(x: number) {
  return Math.min(1, Math.max(0, (x - STAIRS.x0) / (STAIRS.x1 - STAIRS.x0))) * H;
}
export const LIFT_CAB = { minX: LIFT.x0 + 0.1, maxX: LIFT.x1 - 0.1, minZ: LIFT.z0 + 0.1, maxZ: LIFT.z1 };
export function inLift(x: number, z: number) {
  return x > LIFT_CAB.minX && x < LIFT_CAB.maxX && z > LIFT_CAB.minZ && z < LIFT_CAB.maxZ;
}

/** Circle-vs-box overlap for the player (radius r). */
export function hits(x: number, z: number, r: number, b: Box) {
  const cx = Math.max(b.minX, Math.min(x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}
