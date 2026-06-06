import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import {
  roadTraverse,
  roadEntries,
  createRoadSim,
} from "@/sim/road";
import { carqueue } from "@/levels/test/scenarios/carqueue";
import { roadcross } from "@/levels/test/scenarios/roadcross";

// A simple straight road across three tiles (Left<->Right), open at both map
// edges (0,0 enters from the left edge, 2,0 leaves at the right edge).
function straightRoad(): Level {
  const road: [Position, Position] = [Position.Left, Position.Right];
  return {
    "0,0": { connections: [], road: [road] },
    "1,0": { connections: [], road: [road] },
    "2,0": { connections: [], road: [road] },
  };
}

describe("roadTraverse", () => {
  it("follows a straight road to the next tile", () => {
    const lvl = straightRoad();
    const t = roadTraverse(lvl, { x: 0, y: 0 }, Position.Left);
    expect(t.exitPort).toBe(Position.Right);
    expect(t.next).toEqual({ coord: { x: 1, y: 0 }, entryPort: Position.Left });
  });

  it("returns no next tile when the road runs off the map edge", () => {
    const lvl = straightRoad();
    const t = roadTraverse(lvl, { x: 2, y: 0 }, Position.Left);
    expect(t.exitPort).toBe(Position.Right);
    expect(t.next).toBeNull();
  });

  it("returns no exit for a port the road does not use", () => {
    const lvl = straightRoad();
    const t = roadTraverse(lvl, { x: 0, y: 0 }, Position.Top);
    expect(t.exitPort).toBeNull();
    expect(t.next).toBeNull();
  });

  it("ignores rail connections (only road pairs route cars)", () => {
    // A level crossing: rail Top<->Bottom, road Left<->Right.
    const lvl: Level = {
      "0,0": {
        connections: [[Position.Top, Position.Bottom]],
        road: [[Position.Left, Position.Right]],
      },
    };
    // Entering from the road Left, the car leaves Right (not via the rail).
    const t = roadTraverse(lvl, { x: 0, y: 0 }, Position.Left);
    expect(t.exitPort).toBe(Position.Right);
    // Entering from the rail Top, the road has no such port: no exit.
    const r = roadTraverse(lvl, { x: 0, y: 0 }, Position.Top);
    expect(r.exitPort).toBeNull();
  });
});

describe("roadEntries", () => {
  it("finds road ports that open onto the map edge (car spawn points)", () => {
    const lvl = straightRoad();
    const entries = roadEntries(lvl, 3, 1);
    // 0,0 opens left onto the edge; 2,0 opens right onto the edge.
    expect(entries).toContainEqual({ coord: { x: 0, y: 0 }, entryPort: Position.Left });
    expect(entries).toContainEqual({ coord: { x: 2, y: 0 }, entryPort: Position.Right });
    // The middle tile connects on both sides to road neighbours: not an entry.
    expect(entries.every(e => !(e.coord.x === 1 && e.coord.y === 0))).toBe(true);
  });
});

describe("createRoadSim — spawning + movement", () => {
  it("does not spawn or move when there are no roads", () => {
    const sim = createRoadSim({ level: {}, width: 3, height: 1, seed: 1 });
    for (let i = 0; i < 100; i++) sim.step(0.1, () => false);
    expect(sim.cars().length).toBe(0);
  });

  it("spawns cars deterministically and drives them along the road", () => {
    const lvl = straightRoad();
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 7,
      spawnInterval: 1, // one spawn attempt per second of sim time
    });
    // Advance enough sim time to spawn at least one car and move it.
    let moved = false;
    for (let i = 0; i < 200; i++) {
      sim.step(0.1, () => false);
      if (sim.cars().some(c => c.headIndex > 0 || c.headProgress > 0)) moved = true;
    }
    expect(sim.cars().length).toBeGreaterThan(0);
    expect(moved).toBe(true);
  });

  it("is deterministic for a fixed seed", () => {
    const run = () => {
      const sim = createRoadSim({
        level: straightRoad(),
        width: 3,
        height: 1,
        seed: 42,
        spawnInterval: 1,
      });
      for (let i = 0; i < 60; i++) sim.step(0.1, () => false);
      return sim.cars().map(c => ({
        head: c.headIndex,
        prog: Math.round(c.headProgress * 1000),
      }));
    };
    expect(run()).toEqual(run());
  });
});

describe("createRoadSim — car following", () => {
  // World X of a CarSample on a Left->Right straight road: the tile column plus
  // the progress across it (entry is Left = t 0, exit Right = t 1).
  const worldX = (s: { coord: { x: number }; t: number }) => s.coord.x + s.t;

  it("cars queue without overlapping and pack closely behind a stopped car", () => {
    // A long straight road; a permanently-closed crossing at 2,0 forces a queue.
    const road: [Position, Position] = [Position.Left, Position.Right];
    const lvl: Level = {
      "0,0": { connections: [], road: [road] },
      "1,0": { connections: [], road: [road] },
      "2,0": {
        connections: [[Position.Top, Position.Bottom]],
        road: [road],
      },
      "3,0": { connections: [], road: [road] },
      "4,0": { connections: [], road: [road] },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 5,
      height: 1,
      seed: 3,
      spawnInterval: 0.3, // spawn often to build a queue
      carLength: 0.4,
    });
    // Build a standing queue behind the closed crossing.
    for (let i = 0; i < 400; i++) sim.step(0.05, id => id === "2,0");

    const bodies = sim
      .sample()
      .map(c => ({ front: worldX(c.front), rear: worldX(c.rear) }))
      // Order them along the road, leading car first.
      .sort((a, b) => b.front - a.front);
    expect(bodies.length).toBeGreaterThan(1); // a real queue formed

    // No two bodies overlap: each follower's front stays behind the leader's rear.
    for (let i = 1; i < bodies.length; i++) {
      const leader = bodies[i - 1];
      const follower = bodies[i];
      expect(follower.front).toBeLessThanOrEqual(leader.rear + 1e-6);
    }
    // And they pack tightly: the closest consecutive gap is small (the old
    // whole-tile gate left ~0.6 tile between queued cars).
    const minGap = Math.min(
      ...bodies.slice(1).map((f, i) => bodies[i].rear - f.front)
    );
    expect(minGap).toBeLessThan(0.2);
  });

  it("never rolls a car onto a tile occupied head-on by an oncoming car", () => {
    // Two-tile road open at both edges; cars spawn from both ends and must not
    // pass through each other (they stop nose-to-nose).
    const lvl: Level = {
      "0,0": { connections: [], road: [[Position.Left, Position.Right]] },
      "1,0": { connections: [], road: [[Position.Left, Position.Right]] },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 2,
      height: 1,
      seed: 3,
      spawnInterval: 0.2,
      carLength: 0.4,
    });
    const worldX2 = (s: { coord: { x: number }; entryPort: Position; t: number }) =>
      s.entryPort === Position.Left ? s.coord.x + s.t : s.coord.x + (1 - s.t);
    for (let i = 0; i < 300; i++) {
      sim.step(0.05, () => false);
      const bodies = sim
        .sample()
        .map(c => {
          const a = worldX2(c.front);
          const b = worldX2(c.rear);
          return { lo: Math.min(a, b), hi: Math.max(a, b) };
        })
        .sort((p, q) => p.lo - q.lo);
      for (let k = 1; k < bodies.length; k++) {
        // Each body starts at or after the previous one ends: no overlap.
        expect(bodies[k].lo).toBeGreaterThanOrEqual(bodies[k - 1].hi - 1e-6);
      }
    }
  });
});

describe("createRoadSim — crossing gate from rail reservation", () => {
  it("holds a car at a closed crossing and releases it when the train clears", () => {
    // road across 0,0 (open left) -> 1,0 (the crossing) -> 2,0 (open right).
    const lvl: Level = {
      "0,0": { connections: [], road: [[Position.Left, Position.Right]] },
      "1,0": {
        connections: [[Position.Top, Position.Bottom]],
        road: [[Position.Left, Position.Right]],
      },
      "2,0": { connections: [], road: [[Position.Left, Position.Right]] },
    };
    let closed = true;
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 5,
      spawnInterval: 0.5,
    });
    // Run with the crossing closed: cars pile up before 1,0 but never enter it.
    for (let i = 0; i < 200; i++) {
      sim.step(0.1, id => id === "1,0" && closed);
      expect(sim.cars().every(c => c.tileId !== "1,0")).toBe(true);
    }
    expect(sim.cars().length).toBeGreaterThan(0); // at least one is waiting

    // Open the gate: a waiting car must now be able to reach/pass the crossing.
    closed = false;
    let enteredCrossing = false;
    for (let i = 0; i < 400; i++) {
      sim.step(0.1, () => false);
      if (sim.cars().some(c => c.tileId === "1,0")) enteredCrossing = true;
    }
    expect(enteredCrossing).toBe(true);
  });
});

describe("createRoadSim — road junction interlock", () => {
  it("never lets two perpendicular streams co-occupy the crossing, and both flow", () => {
    // The roadcross scenario: a 4-way crossing at 2,2. Spawn one-way from the
    // left (eastbound) and the bottom (northbound) so the two streams meet at the
    // centre. With the junction interlock exactly one car may occupy 2,2 at a
    // time — the other waits clear of it — so they take turns instead of jamming.
    const sim = createRoadSim({
      level: roadcross.level,
      width: roadcross.size!.cols,
      height: roadcross.size!.rows,
      seed: 4,
      spawnEntries: [
        { coord: { x: 0, y: 2 }, entryPort: Position.Left }, // eastbound
        { coord: { x: 2, y: 4 }, entryPort: Position.Bottom }, // northbound
      ],
      spawnInterval: 0.4,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 8,
    });

    const onJunction = (c: { coord: { x: number; y: number } }) =>
      c.coord.x === 2 && c.coord.y === 2;
    const horizontal = (p: Position) =>
      p === Position.Left || p === Position.Right;
    let eastboundPassed = false; // a car reached x>2 (cleared the crossing east)
    let northboundPassed = false; // a car reached y<2 (cleared the crossing north)

    for (let i = 0; i < 1200; i++) {
      sim.step(0.05, () => false);
      const samples = sim.sample();
      // Cars touching the junction may follow one another nose-to-tail along one
      // road, but two *perpendicular* streams must never occupy it at once — that
      // mixed state is exactly the gridlock the interlock prevents.
      const axes = new Set<string>();
      for (const c of samples) {
        if (onJunction(c.front))
          axes.add(horizontal(c.front.entryPort) ? "h" : "v");
        if (onJunction(c.rear))
          axes.add(horizontal(c.rear.entryPort) ? "h" : "v");
      }
      expect(axes.size).toBeLessThanOrEqual(1);
      for (const c of samples) {
        if (c.front.coord.x > 2 && c.front.coord.y === 2) eastboundPassed = true;
        if (c.front.coord.y < 2 && c.front.coord.x === 2) northboundPassed = true;
      }
    }
    // Neither stream is starved: traffic actually crosses both ways (no deadlock).
    expect(eastboundPassed).toBe(true);
    expect(northboundPassed).toBe(true);
  });
});

describe("createRoadSim — launch reaction delay", () => {
  it("waits a beat before a stopped car rolls once the gate opens", () => {
    // One car approaching a closed crossing at 1,0. Once it has stopped at the
    // gate and the gate opens, the car must not move on the very next tick — it
    // waits out its reaction time — then accelerates away.
    const lvl: Level = {
      "0,0": { connections: [], road: [[Position.Left, Position.Right]] },
      "1,0": {
        connections: [[Position.Top, Position.Bottom]],
        road: [[Position.Left, Position.Right]],
      },
      "2,0": { connections: [], road: [[Position.Left, Position.Right]] },
    };
    let closed = true;
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 5,
      spawnInterval: 0.5,
      carSpeed: 0.5,
      maxCars: 1,
    });
    // Settle a single car hard against the closed gate.
    for (let i = 0; i < 200; i++) sim.step(0.05, id => id === "1,0" && closed);
    const stopped = sim.cars()[0];
    expect(stopped).toBeDefined();
    const posBefore = stopped.headIndex + stopped.headProgress;

    // Open the gate, step one small tick: the car is still in its reaction time.
    closed = false;
    sim.step(0.05, () => false);
    const justAfter = sim.cars()[0];
    expect(justAfter.headIndex + justAfter.headProgress).toBeCloseTo(posBefore, 6);

    // After the reaction delay (~0.6s) elapses, the car has rolled forward.
    for (let i = 0; i < 20; i++) sim.step(0.05, () => false);
    const later = sim.cars()[0];
    // It either advanced along its tile or already crossed into the next one.
    expect(later.headIndex + later.headProgress).toBeGreaterThan(posBefore + 0.05);
  });
});

describe("createRoadSim — acceleration ramp", () => {
  it("ramps a car up from rest instead of snapping to cruise speed", () => {
    // A single car on an open straight road. It should start slow and work up to
    // cruise speed over several ticks, not cover a full cruise step immediately.
    const sim = createRoadSim({
      level: straightRoad(),
      width: 3,
      height: 1,
      seed: 7,
      spawnInterval: 0.3,
      carSpeed: 0.5,
      maxCars: 1,
    });
    const deltas: number[] = [];
    let prev: number | null = null;
    for (let i = 0; i < 120; i++) {
      sim.step(0.05, () => false);
      const c = sim.cars()[0];
      if (!c) {
        prev = null; // the car drove off the end; ignore the gap
        continue;
      }
      const pos = c.headIndex + c.headProgress;
      if (prev !== null && pos - prev > 1e-9) deltas.push(pos - prev);
      prev = pos;
    }
    expect(deltas.length).toBeGreaterThan(5);
    const cruiseStep = 0.5 * 0.05; // speed * dt — the distance at full cruise
    // The first movement out of rest is a small fraction of a cruise step…
    expect(deltas[0]).toBeLessThan(cruiseStep * 0.5);
    // …and the car works up to roughly cruise speed once rolling.
    expect(Math.max(...deltas)).toBeGreaterThan(cruiseStep * 0.9);
  });
});

describe("carqueue test-world scenario", () => {
  it("queues cars bumper-to-bumper on the approach to its closed crossing", () => {
    // Drive the actual showcase geometry: cars enter one-way from the left edge
    // (3,3) is the crossing) and must stack tightly on the 0,3 / 1,3 / 2,3
    // approach when the gate is held closed.
    const sim = createRoadSim({
      level: carqueue.level,
      width: carqueue.size!.cols,
      height: carqueue.size!.rows,
      seed: 1,
      spawnEntries: [{ coord: { x: 0, y: 3 }, entryPort: Position.Left }],
      spawnInterval: 0.6,
      carSpeed: 0.5,
      carLength: 46 / 200, // the sprite-matched body the game uses (CAR_SPRITE_PX)
    });
    for (let i = 0; i < 600; i++) sim.step(0.05, id => id === "3,3");

    // World X along the Left->Right approach road = column + progress.
    const bodies = sim
      .sample()
      .map(c => ({ front: c.front.coord.x + c.front.t, rear: c.rear.coord.x + c.rear.t }))
      .sort((a, b) => b.front - a.front);

    expect(bodies.length).toBeGreaterThan(2); // a real queue built up
    // None entered the closed crossing tile (front stays left of column 3).
    expect(bodies[0].front).toBeLessThanOrEqual(3 + 1e-6);
    // Consecutive cars neither overlap nor leave a full-tile gap between them.
    for (let i = 1; i < bodies.length; i++) {
      const gap = bodies[i - 1].rear - bodies[i].front;
      expect(gap).toBeGreaterThanOrEqual(-1e-6); // no overlap
      expect(gap).toBeLessThan(0.06); // packed nearly nose-to-tail (~6px gap)
    }
  });
});
