import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import {
  roadTraverse,
  roadEntries,
  createRoadSim,
  vehicleSpec,
  specLength,
  CarChord,
} from "@/sim/road";
import { carqueue } from "@/levels/test/scenarios/carqueue";
import { roadcross } from "@/levels/test/scenarios/roadcross";

// A vehicle samples as one render box per body segment (cab + trailer for a
// semi); these grab the whole-body front/rear ends used by the queueing tests.
// Every car here uses the default all-cars mix, so each is a single segment.
const bodyFront = (c: CarChord) => c.units[0].front;
const bodyRear = (c: CarChord) => c.units[c.units.length - 1].rear;

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
      .map(c => ({ front: worldX(bodyFront(c)), rear: worldX(bodyRear(c)) }))
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

  it("lets two opposing streams pass in separate lanes without deadlocking", () => {
    // Two-lane (right-hand) road open at both edges; cars spawn from both ends —
    // eastbound enters from the Left edge, westbound from the Right. On the old
    // single-lane model these froze nose-to-nose; now each rides the lane to the
    // right of its travel, so the streams pass and the road keeps clearing cars
    // from BOTH directions.
    const lvl: Level = {
      "0,0": { connections: [], road: [[Position.Left, Position.Right]] },
      "1,0": { connections: [], road: [[Position.Left, Position.Right]] },
      "2,0": { connections: [], road: [[Position.Left, Position.Right]] },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 3,
      spawnInterval: 0.4,
      carLength: 0.4,
    });
    // A car's head entered its tile from the Left when travelling east, from the
    // Right when travelling west — so its head-segment entry port reveals which
    // way it is going.
    const dirOf = (c: CarChord): "east" | "west" =>
      bodyFront(c).entryPort === Position.Left ? "east" : "west";

    const completed = { east: 0, west: 0 };
    let prev = new Map<string, "east" | "west">();
    let sawBothPresent = false;

    for (let i = 0; i < 400; i++) {
      sim.step(0.05, () => false);
      const now = new Map<string, "east" | "west">();
      let east = false;
      let west = false;
      for (const c of sim.sample()) {
        const d = dirOf(c);
        now.set(c.id, d);
        if (d === "east") east = true;
        else west = true;
      }
      if (east && west) sawBothPresent = true;
      // A car present last tick but gone now drove off the far edge — a completed
      // crossing. If the road had deadlocked, completions would stop entirely.
      for (const [id, d] of prev) {
        if (!now.has(id)) completed[d]++;
      }
      prev = now;
    }

    // Both streams kept flowing — cars from each direction crossed the whole road.
    expect(completed.east).toBeGreaterThan(0);
    expect(completed.west).toBeGreaterThan(0);
    // And both streams shared the road at the same time (they met and passed,
    // rather than strictly alternating) — direct proof of lane separation.
    expect(sawBothPresent).toBe(true);
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

  it("won't roll onto a rail crossing when the road just past it is jammed", () => {
    // road 0..4; the level crossing is tile 2,0 (rail Top-Bottom + road). Tile 3,0
    // — immediately past the crossing — is a standing jam (always "closed"). Cars
    // must queue *before* the crossing, never coming to rest on the tracks, even
    // though the crossing's own gate is open.
    const road: [Position, Position] = [Position.Left, Position.Right];
    const lvl: Level = {
      "0,0": { connections: [], road: [road] },
      "1,0": { connections: [], road: [road] },
      "2,0": { connections: [[Position.Top, Position.Bottom]], road: [road] },
      "3,0": { connections: [], road: [road] },
      "4,0": { connections: [], road: [road] },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 5,
      height: 1,
      seed: 3,
      spawnInterval: 0.4,
      carSpeed: 0.5,
      carLength: 0.3,
    });
    // Jam everything from tile 3 on (just past the crossing); the crossing 2,0 is
    // NOT closed — only the road beyond it is blocked.
    for (let i = 0; i < 600; i++) sim.step(0.05, id => id === "3,0");

    // A real queue formed, and not one car is resting on the crossing tile.
    expect(sim.cars().length).toBeGreaterThan(1);
    const onCrossing = sim
      .sample()
      .some(
        c =>
          (bodyFront(c).coord.x === 2 && bodyFront(c).coord.y === 0) ||
          (bodyRear(c).coord.x === 2 && bodyRear(c).coord.y === 0)
      );
    expect(onCrossing).toBe(false);
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
        if (onJunction(bodyFront(c)))
          axes.add(horizontal(bodyFront(c).entryPort) ? "h" : "v");
        if (onJunction(bodyRear(c)))
          axes.add(horizontal(bodyRear(c).entryPort) ? "h" : "v");
      }
      expect(axes.size).toBeLessThanOrEqual(1);
      for (const c of samples) {
        const f = bodyFront(c);
        if (f.coord.x > 2 && f.coord.y === 2) eastboundPassed = true;
        if (f.coord.y < 2 && f.coord.x === 2) northboundPassed = true;
      }
    }
    // Neither stream is starved: traffic actually crosses both ways (no deadlock).
    expect(eastboundPassed).toBe(true);
    expect(northboundPassed).toBe(true);
  });

  it("reports the junction tile a car holds (and only while one occupies it)", () => {
    const sim = createRoadSim({
      level: roadcross.level,
      width: roadcross.size!.cols,
      height: roadcross.size!.rows,
      seed: 4,
      spawnEntries: [
        { coord: { x: 0, y: 2 }, entryPort: Position.Left },
        { coord: { x: 2, y: 4 }, entryPort: Position.Bottom },
      ],
      spawnInterval: 0.4,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 8,
    });

    let everHeld = false;
    for (let i = 0; i < 1200; i++) {
      sim.step(0.05, () => false);
      const held = sim.junctionOccupancy();
      const ids = Object.keys(held);
      // Only the actual crossing tile (2,2) is ever reported, never an approach.
      for (const id of ids) expect(id).toBe("2,2");
      // It is held by a real, currently-live car.
      const liveIds = new Set(sim.cars().map(c => c.id));
      for (const id of ids) expect(liveIds.has(held[id])).toBe(true);
      if (ids.length > 0) everHeld = true;
    }
    expect(everHeld).toBe(true); // cars do pass through, so it gets held
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

describe("vehicle kinds", () => {
  it("scales each kind's body length from the base car length", () => {
    const base = 0.2;
    expect(specLength(vehicleSpec("car", base))).toBeCloseTo(base, 9);
    // A truck is one longer box.
    expect(specLength(vehicleSpec("truck", base))).toBeGreaterThan(base);
    // A semi (cab + trailer + coupling gap) is the longest of the three.
    expect(specLength(vehicleSpec("semi", base))).toBeGreaterThan(
      specLength(vehicleSpec("truck", base))
    );
  });

  it("renders a car/truck as one box and a semi as a cab + trailer", () => {
    expect(vehicleSpec("car", 0.2).segments.map(s => s.part)).toEqual(["car"]);
    expect(vehicleSpec("truck", 0.2).segments.map(s => s.part)).toEqual(["truck"]);
    expect(vehicleSpec("semi", 0.2).segments.map(s => s.part)).toEqual([
      "cab",
      "trailer",
    ]);
  });

  it("spawns only the kinds the mix allows", () => {
    // Mix of only trucks → every sampled vehicle is a single truck box, and its
    // body is longer than a plain car's.
    const sim = createRoadSim({
      level: straightRoad(),
      width: 3,
      height: 1,
      seed: 9,
      spawnInterval: 0.5,
      carLength: 0.2,
      mix: { truck: 1 },
    });
    for (let i = 0; i < 120; i++) sim.step(0.05, () => false);
    const samples = sim.sample();
    expect(samples.length).toBeGreaterThan(0);
    for (const c of samples) {
      expect(c.units.map(u => u.part)).toEqual(["truck"]);
    }
  });
});

describe("createRoadSim — long vehicles occupy what they straddle", () => {
  it("a semi's trailer keeps a perpendicular car out of the junction it straddles", () => {
    // The roadcross 4-way junction, but every vehicle is a semi (two-box body
    // longer than one tile). The interlock invariant must still hold for the long
    // body: two perpendicular streams never co-occupy the centre tile — which can
    // only work if the trailer (not just the cab/tail) marks the junction it sits
    // on. Without full-body occupancy a trailer mid-spanning 2,2 would be invisible
    // to the crossing stream and let it drive in.
    const sim = createRoadSim({
      level: roadcross.level,
      width: roadcross.size!.cols,
      height: roadcross.size!.rows,
      seed: 4,
      spawnEntries: [
        { coord: { x: 0, y: 2 }, entryPort: Position.Left }, // eastbound
        { coord: { x: 2, y: 4 }, entryPort: Position.Bottom }, // northbound
      ],
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 8,
      mix: { semi: 1 },
    });

    const onJunction = (s: { coord: { x: number; y: number } }) =>
      s.coord.x === 2 && s.coord.y === 2;
    const horizontal = (p: Position) => p === Position.Left || p === Position.Right;
    let sawSemi = false;
    let eastboundPassed = false;
    let northboundPassed = false;

    for (let i = 0; i < 1500; i++) {
      sim.step(0.05, () => false);
      const samples = sim.sample();
      const axes = new Set<string>();
      for (const c of samples) {
        if (c.units.length === 2) sawSemi = true;
        // Every body box of every vehicle is checked, so a trailer straddling the
        // junction counts as occupying it.
        for (const u of c.units) {
          if (onJunction(u.front)) axes.add(horizontal(u.front.entryPort) ? "h" : "v");
          if (onJunction(u.rear)) axes.add(horizontal(u.rear.entryPort) ? "h" : "v");
        }
      }
      expect(axes.size).toBeLessThanOrEqual(1);
      for (const c of samples) {
        const f = c.units[0].front;
        if (f.coord.x > 2 && f.coord.y === 2) eastboundPassed = true;
        if (f.coord.y < 2 && f.coord.x === 2) northboundPassed = true;
      }
    }
    expect(sawSemi).toBe(true); // the scenario really did run semis
    expect(eastboundPassed).toBe(true);
    expect(northboundPassed).toBe(true); // neither stream deadlocked
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
      .map(c => ({
        front: bodyFront(c).coord.x + bodyFront(c).t,
        rear: bodyRear(c).coord.x + bodyRear(c).t,
      }))
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
