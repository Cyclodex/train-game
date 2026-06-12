import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { fromPairs } from "@/tiles/lanes";
import { oppositePort } from "@/sim/topology";
import { createRoadSim, CarChord, CarSample } from "@/sim/road";
import { createLaneGeometry } from "@/sim/laneGeometry";
import { laneSegmentPointAt } from "@/sim/pathGeometry";

// Reconstruct the WORLD point a coupler is drawn at, exactly as the renderer does
// (game.ts sampleRoadWorld), but in tile units (tileSize = 1). This is the path
// the player sees, so measuring on it tests the real behaviour, not an internal.
function worldSampler(level: Level) {
  const geo = createLaneGeometry(level, 1);
  return (s: CarSample, chordLane: number, part: string) => {
    const cls = part === "bus" ? "bus" : "car";
    const off = geo.couplerOffsets(s, chordLane, cls);
    const exit = s.exitPort !== null && s.exitPort !== s.entryPort ? s.exitPort : null;
    const p =
      exit === null
        ? laneSegmentPointAt(s.entryPort, oppositePort(s.entryPort), 1, off.offEntry, off.offEntry, 0)
        : laneSegmentPointAt(s.entryPort, exit, 1, off.offEntry, off.offExit, s.t);
    return { x: s.coord.x + p.x, y: s.coord.y + p.y };
  };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const road = (...ports: [Position, Position][]): { connections: []; road: ReturnType<typeof fromPairs> } => ({
  connections: [],
  road: fromPairs(ports),
});

// A road that runs east across three straight tiles, turns south at (3,0), and
// runs south to the bottom edge — straight tiles and one 90° turn, so a single
// car's world speed can be compared between the two tile shapes.
function straightThenTurn(): Level {
  return {
    "0,0": road([Position.Left, Position.Right]),
    "1,0": road([Position.Left, Position.Right]),
    "2,0": road([Position.Left, Position.Right]),
    "3,0": road([Position.Left, Position.Bottom]), // 90° turn: west → south
    "3,1": road([Position.Top, Position.Bottom]),
    "3,2": road([Position.Top, Position.Bottom]), // exit at the bottom edge
  };
}

describe("road driven-length normalisation (#36 constant world speed)", () => {
  it("a car covers world distance per second within ±10% on a straight vs a turn", () => {
    const level = straightThenTurn();
    const sim = createRoadSim({
      level,
      width: 4,
      height: 3,
      seed: 1,
      carSpeed: 0.5,
      carLength: 0.2,
      speedSpread: 0, // every car the exact cruise speed → deterministic
      spawnInterval: 0.1,
      maxCars: 1, // one car at a time; we measure the first
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
    });
    const world = worldSampler(level);
    const dt = 0.02;

    // Per-tile-shape world displacement, summed over the ticks the head spent on a
    // representative straight tile (2,0) vs the turn tile (3,0). Both are mid-route
    // (past the spawn acceleration, before the exit), so the car cruises across them.
    const acc: Record<string, { sum: number; n: number }> = {
      straight: { sum: 0, n: 0 },
      turn: { sum: 0, n: 0 },
    };
    let prev: { x: number; y: number } | null = null;
    let firstId: string | null = null;

    for (let i = 0; i < 1200; i++) {
      sim.step(dt, () => false);
      const cars: CarChord[] = sim.sample();
      const car = cars[0];
      if (!car) {
        if (firstId) break; // the measured car has driven off — done
        prev = null;
        continue;
      }
      if (firstId === null) firstId = car.id;
      if (car.id !== firstId) break;
      const head = car.units[0].front;
      const here = world(head, car.laneIndex, car.units[0].part);
      if (prev) {
        const d = dist(prev, here);
        const id = `${head.coord.x},${head.coord.y}`;
        if (id === "2,0") {
          acc.straight.sum += d;
          acc.straight.n += 1;
        } else if (id === "3,0") {
          acc.turn.sum += d;
          acc.turn.n += 1;
        }
      }
      prev = here;
    }

    expect(acc.straight.n).toBeGreaterThan(5);
    expect(acc.turn.n).toBeGreaterThan(5);
    const straightSpeed = acc.straight.sum / acc.straight.n;
    const turnSpeed = acc.turn.sum / acc.turn.n;
    // The unintended per-tile-shape penalty (a curve was ~21% slower than a
    // straight) is gone: the two world speeds match within ±10%. A small, bounded
    // corner ease is allowed to remain (turn slightly ≤ straight), which is why
    // this is a band, not equality.
    expect(turnSpeed / straightSpeed).toBeGreaterThan(0.9);
    expect(turnSpeed / straightSpeed).toBeLessThan(1.1);
  });
});

describe("road body spacing (#37 semi cab→trailer gap constant through a turn)", () => {
  it("a semi's cab→trailer pixel gap stays within ±10% crossing a 90° turn", () => {
    const level = straightThenTurn();
    const sim = createRoadSim({
      level,
      width: 4,
      height: 3,
      seed: 1,
      carSpeed: 0.5,
      carLength: 0.2,
      speedSpread: 0,
      spawnInterval: 0.1,
      maxCars: 1,
      mix: { semi: 1 }, // every spawn is an articulated cab + trailer
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
    });
    const world = worldSampler(level);

    // The coupling gap = world distance between the cab's REAR and the trailer's
    // FRONT. Sample it on a straight stretch and while the rig straddles the turn,
    // and compare. Before the fix the trailer drifted off the cab through the bend.
    const straightGaps: number[] = [];
    const turnGaps: number[] = [];
    let firstId: string | null = null;

    for (let i = 0; i < 1500; i++) {
      sim.step(0.02, () => false);
      const car = sim.sample()[0];
      if (!car) {
        if (firstId) break;
        continue;
      }
      if (firstId === null) firstId = car.id;
      if (car.id !== firstId) break;
      if (car.units.length < 2) continue; // not a semi (shouldn't happen with this mix)
      const cabRear = world(car.units[0].rear, car.laneIndex, car.units[0].part);
      const trailerFront = world(car.units[1].front, car.laneIndex, car.units[1].part);
      const gap = dist(cabRear, trailerFront);
      // "Mid-turn" = the cab's front is on the turn tile (3,0); "straight" = the
      // whole rig sits on the eastbound straights (cab front on 1,0 or 2,0).
      const cabTile = `${car.units[0].front.coord.x},${car.units[0].front.coord.y}`;
      if (cabTile === "3,0") turnGaps.push(gap);
      else if (cabTile === "1,0" || cabTile === "2,0") straightGaps.push(gap);
    }

    expect(straightGaps.length).toBeGreaterThan(5);
    expect(turnGaps.length).toBeGreaterThan(5);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const straight = avg(straightGaps);
    const turn = avg(turnGaps);
    // The gap holds its straight-road value through the bend (no telescoping).
    expect(Math.abs(turn / straight - 1)).toBeLessThan(0.1);
    // And every sampled gap is close to the others (no momentary stretch spikes).
    const all = [...straightGaps, ...turnGaps];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    expect(hi / lo).toBeLessThan(1.2);
  });
});
