import { createRoadSim, roadEntries } from "@/sim/road";
import type { TrafficConfig } from "@/sim/road";
import type { Level } from "@/tiles/model";
import type { Position } from "@/types";

// Shared road-simulation test helpers. Extracted so the registry-wide sweep and
// the targeted specs measure a scenario the SAME way — a scenario that passes one
// and fails the other would otherwise be an argument about the harness rather
// than about the sim.

export interface ScenarioLike {
  level: Level;
  size?: { cols: number; rows: number };
  traffic?: TrafficConfig;
}

// Build a sim straight from a TestScenario's own traffic config, with the
// deterministic per-interval spawn cadence (no `fillFast`) so a run replays
// identically for a fixed seed.
export function simFor(scenario: ScenarioLike, seed: number) {
  const t = (scenario.traffic ?? {}) as {
    spawnInterval?: number;
    maxCars?: number;
    overtakeFraction?: number;
    mix?: Record<string, number>;
    spawnEntries?: { coord: { x: number; y: number }; entryPort: Position }[];
  };
  return createRoadSim({
    level: scenario.level,
    width: scenario.size!.cols,
    height: scenario.size!.rows,
    seed,
    spawnInterval: t.spawnInterval ?? 0.5,
    carSpeed: 0.5,
    carLength: 0.2,
    speedSpread: 0.3,
    maxCars: t.maxCars ?? 12,
    overtakeFraction: t.overtakeFraction,
    mix: t.mix,
    spawnEntries: t.spawnEntries,
  });
}

// A car is ~20px wide in a ~28px lane, so two same-direction bodies physically
// CLIP when their lane centres are closer than ~0.71 lane. The swept-body check
// treats two bodies as overlapping when, on the same tile and travel direction,
// their LONGITUDINAL extents intersect AND their LATERAL (continuous lanePos)
// extents are within that body width — a true 2D body overlap. Mid lane-change
// bodies are laterally offset, so a clean pass (the car eases clear before drawing
// level) registers no overlap, while a real clip does.
const CLIP_LANES_TEST = 0.7; // a hair under the body-width ratio, for margin

export function worstSweptOverlap(sim: ReturnType<typeof createRoadSim>): number {
  type Ext = { id: string; tMin: number; tMax: number; lMin: number; lMax: number };
  // Group body extents per car, keyed by tile + travel direction (entry port), so
  // only same-direction bodies on one tile are compared. Opposing lanes and
  // crossing junction streams are handled by their own gates/tests.
  const groups = new Map<string, Map<string, Ext>>();
  for (const body of sim.bodies()) {
    for (const p of body.points) {
      const key = `${p.tileId}|${p.entry}`;
      let perCar = groups.get(key);
      if (!perCar) groups.set(key, (perCar = new Map()));
      const e = perCar.get(body.id);
      if (!e) perCar.set(body.id, { id: body.id, tMin: p.t, tMax: p.t, lMin: p.lanePos, lMax: p.lanePos });
      else {
        e.tMin = Math.min(e.tMin, p.t);
        e.tMax = Math.max(e.tMax, p.t);
        e.lMin = Math.min(e.lMin, p.lanePos);
        e.lMax = Math.max(e.lMax, p.lanePos);
      }
    }
  }
  let worst = 0;
  for (const perCar of groups.values()) {
    const arr = [...perCar.values()];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        const longOverlap = Math.min(a.tMax, b.tMax) - Math.max(a.tMin, b.tMin);
        // Lateral centre separation between the two bodies (0 if their lanePos
        // extents already intersect).
        const latSep = Math.max(0, Math.max(a.lMin, b.lMin) - Math.min(a.lMax, b.lMax));
        // Only a 2D overlap counts: longitudinally overlapping AND laterally
        // within a body width.
        if (longOverlap > worst && latSep < CLIP_LANES_TEST) worst = longOverlap;
      }
    }
  }
  return worst;
}

// Does this scenario carry any road at all? Rail-only scenarios have no road
// traffic to measure, so the road sweep skips them.
export function hasRoad(scenario: ScenarioLike): boolean {
  return Object.values(scenario.level).some(cell => (cell.road?.length ?? 0) > 0);
}

// Can traffic ever enter this scenario? A closed ring with no map-edge opening
// and no explicit spawn entries is a deliberate STATIC gallery (roadcurveloops
// exists purely to eyeball the curve geometry), not a broken map — asserting
// liveness on it would be asserting the wrong thing.
export function canSpawn(scenario: ScenarioLike): boolean {
  if (scenario.traffic?.spawnEntries?.length) return true;
  const { cols, rows } = scenario.size ?? { cols: 0, rows: 0 };
  return roadEntries(scenario.level, cols, rows).length > 0;
}

// One tick's worth of "which tile is each vehicle's front on". Comparing this
// between ticks counts tile CROSSINGS, which is the flow measure that works for
// both open maps (cars exit) and closed circuits (cars lap forever) — a car that
// keeps changing tiles is making progress no matter where it ends up.
// PARKED vehicles are deliberately absent. A car in a bay is where it wants to
// be, so counting it as a vehicle that failed to cross a tile would read a car
// park working exactly as designed as a jam. A car inside a GARAGE reports no
// body units at all (it is inside a building), so the guard is also what stops
// this reading `units[0]` of an empty array.
export function frontTiles(sim: ReturnType<typeof createRoadSim>): Map<string, string> {
  const out = new Map<string, string>();
  const parked = new Set(sim.cars().filter(c => c.parked).map(c => c.id));
  for (const c of sim.sample()) {
    if (parked.has(c.id) || c.units.length === 0) continue;
    const f = c.units[0].front;
    out.set(c.id, `${f.coord.x},${f.coord.y}`);
  }
  return out;
}

// Vehicles that are supposed to be MOVING — everything except the ones sitting in
// a parking bay. The sweep's liveness assertions compare crossings against this
// rather than against the whole fleet: with parked cars in the denominator, a car
// park filling up would look like traffic failing to advance.
export function movingCarCount(sim: ReturnType<typeof createRoadSim>): number {
  return sim.cars().filter(c => !c.parked).length;
}

// Cars that have completed the parking CYCLE this run: parked, dwelt, and driven
// away again. This is the property a parking scenario actually has to prove — that
// parking is a cycle and not a sink — and it is what the sweep asserts in place of
// "traffic was still crossing tiles at the end" on a map whose whole point is that
// some of its vehicles are standing still on purpose.
export function countUnparkings(sim: ReturnType<typeof createRoadSim>, seen: Set<string>): number {
  let done = 0;
  for (const c of sim.cars()) {
    if (c.parked) {
      seen.add(c.id);
    } else if (seen.has(c.id) && c.phase === "driving") {
      seen.delete(c.id);
      done++;
    }
  }
  return done;
}
