import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { fromPairs, oneWay, turns, nWayLanes } from "@/tiles/lanes";
import {
  roadTraverse,
  roadEntries,
  createRoadSim,
  vehicleSpec,
  specLength,
  CarChord,
} from "@/sim/road";
import { movementsConflict } from "@/sim/roadJunction";
import { carqueue } from "@/levels/test/scenarios/carqueue";
import { roadcross } from "@/levels/test/scenarios/roadcross";
import {
  roadcross1lane,
  roadcross2lane,
  roadcross3lane,
} from "@/levels/test/scenarios/roadcrosslanes";
import { turnlanes } from "@/levels/test/scenarios/turnlanes";
import { lanesAllowingExit } from "@/tiles/lanes";

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
    "0,0": { connections: [], road: fromPairs([road]) },
    "1,0": { connections: [], road: fromPairs([road]) },
    "2,0": { connections: [], road: fromPairs([road]) },
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
        road: fromPairs([[Position.Left, Position.Right]]),
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

  it("reads a function maxCars live, so changing the cap takes effect mid-run", () => {
    const lvl = straightRoad();
    let cap = 2; // the live game-setting cap
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 7,
      spawnInterval: 0.2, // busy: would overflow a small cap quickly
      maxCars: () => cap,
    });
    // Fill up under the low cap and confirm it's respected.
    for (let i = 0; i < 200; i++) sim.step(0.1, () => false);
    expect(sim.cars().length).toBeLessThanOrEqual(2);

    // Raise the cap live: more cars may now spawn.
    cap = 8;
    for (let i = 0; i < 200; i++) sim.step(0.1, () => false);
    expect(sim.cars().length).toBeGreaterThan(2);

    // Drop it to zero live: no new cars spawn (existing ones drive off the map
    // and are not replaced), so the road empties.
    cap = 0;
    for (let i = 0; i < 400; i++) sim.step(0.1, () => false);
    expect(sim.cars().length).toBe(0);
  });

  it("never stacks cars on top of each other at a saturated multi-lane entry", () => {
    // Regression: a high cap on a busy 2-lane road backed traffic up to the spawn
    // edge; the spawn probe only checked lane 0 while cars spawned into a random
    // lane, so new cars piled onto the jammed lane — dozens at the exact same
    // point, frozen, blocking the road. The spawn must probe the lane it actually
    // uses and skip when every lane is blocked at the entry.
    const road: [Position, Position] = [Position.Left, Position.Right];
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(road[0], road[1], 2) },
      "1,0": { connections: [], road: nWayLanes(road[0], road[1], 2) },
      "2,0": { connections: [], road: nWayLanes(road[0], road[1], 2) },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 3,
      spawnInterval: 0.15, // very busy — guarantees the road saturates
      maxCars: 100, // far more than the little road can hold
    });
    for (let i = 0; i < 600; i++) sim.step(0.1, () => false);

    // No two cars may occupy the same tile + lane + position (a "stack").
    const seen = new Set<string>();
    let stacked = 0;
    for (const c of sim.sample()) {
      const f = c.units[0].front;
      const key = `${f.coord.x},${f.coord.y}:${c.laneIndex}:${Math.round(f.t * 50)}`;
      if (seen.has(key)) stacked++;
      seen.add(key);
    }
    expect(stacked).toBe(0);
  });

  it("merges cars out of a dropping lane before it ends (G)", () => {
    // A two-lane road (tiles x=0,1) that drops to one lane (tiles x=2,3). A car
    // in lane 1 has nowhere to go past x=1, so it must change into lane 0 BEFORE
    // the drop — and the road must keep flowing (no permanent queue at the taper).
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
      "1,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
      "2,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 1) },
      "3,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 1) },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 4,
      height: 1,
      seed: 5,
      spawnInterval: 0.4,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 10,
      // Eastbound only, so every car meets the 2→1 drop.
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
    });

    let prev = new Set<string>();
    const completed = new Set<string>();
    let onePerLaneViolations = 0;
    for (let i = 0; i < 1200; i++) {
      sim.step(0.05, () => false);
      const now = new Set(sim.cars().map(c => c.id));
      for (const id of prev) if (!now.has(id)) completed.add(id);
      prev = now;
      // Any eastbound car whose head is on the single-lane section must be in
      // lane 0 — i.e. it merged before the drop, it didn't ride a phantom lane 1.
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        if (f.coord.x >= 2 && Math.round(c.laneIndex) !== 0) onePerLaneViolations++;
      }
    }
    expect(onePerLaneViolations).toBe(0); // always merged before entering 1-lane
    expect(completed.size).toBeGreaterThan(10); // sustained flow through the merge
  });

  it("angles the body into a lane change (rear coupler lags the front)", () => {
    // While a car merges out of lane 1, its front coupler reaches the new lane
    // before its rear, so the two couplers sit at different lateral positions —
    // that divergence is the lean (a flat sideways slide would keep them equal).
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
      "1,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
      "2,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 1) },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 9,
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 6,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
    });
    let maxLean = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const fp = c.units[0].front.lanePos;
        const rp = c.units[0].rear.lanePos;
        if (fp != null && rp != null) maxLean = Math.max(maxLean, Math.abs(fp - rp));
      }
    }
    // A clear front/rear lateral divergence occurs at some point (the lean).
    expect(maxLean).toBeGreaterThan(0.1);
  });

  it("overtakers pass a slow leader on the inner lane, then return; disciplined drivers don't", () => {
    // A 2-lane-each-way straight (no junctions, no lane drops) — the ONLY reason
    // to ride the inner lane is to overtake. Drive it once with all overtakers and
    // once with none; the first must produce inner-lane passes that return to the
    // kerb lane, the second must keep every car in lane 0.
    const lane2 = () => ({ connections: [], road: nWayLanes(Position.Left, Position.Right, 2) });
    const lvl: Level = {
      "0,0": lane2(), "1,0": lane2(), "2,0": lane2(), "3,0": lane2(), "4,0": lane2(), "5,0": lane2(),
    };
    const run = (overtakeFraction: number) => {
      const sim = createRoadSim({
        level: lvl,
        width: 6,
        height: 1,
        seed: 4,
        spawnInterval: 0.9,
        carSpeed: 0.6,
        speedSpread: 0.3, // a real fast/slow mix so leaders get caught
        carLength: 0.2,
        maxCars: 8,
        overtakeFraction,
        spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }], // eastbound only
      });
      // Cars spawn into either lane (rotating), so "overtook" means a car CHANGED
      // lane from where it started — on this map only an overtake does that.
      const firstLane = new Map<string, number>();
      const changedLane = new Set<string>();
      const returnedHome = new Set<string>();
      let stacked = 0;
      for (let i = 0; i < 1500; i++) {
        sim.step(0.05, () => false);
        const pos = new Set<string>();
        for (const c of sim.sample()) {
          const f = c.units[0].front;
          const lane = Math.round(c.laneIndex);
          if (!firstLane.has(c.id)) firstLane.set(c.id, lane);
          const home = firstLane.get(c.id)!;
          if (lane !== home) changedLane.add(c.id);
          else if (changedLane.has(c.id)) returnedHome.add(c.id); // back where it began
          const key = `${f.coord.x},${f.coord.y}:${lane}:${Math.round(f.t * 40)}`;
          if (pos.has(key)) stacked++;
          pos.add(key);
        }
      }
      return { changed: changedLane.size, returned: returnedHome.size, stacked };
    };

    const overtakers = run(1);
    expect(overtakers.changed).toBeGreaterThan(0); // passes happen
    expect(overtakers.returned).toBeGreaterThan(0); // and the car pulls back in
    expect(overtakers.stacked).toBe(0); // never overlaps another car

    const disciplined = run(0);
    expect(disciplined.changed).toBe(0); // nobody ever changes lane (no overtakes)
  });

  it("sorts cars into the turn lane that permits their turn (F)", () => {
    // The turnlanes scenario: a 2-lane approach to a T whose kerb lane turns
    // right and inner lane turns left. Every car that reaches the junction must
    // be in a lane that PERMITS the turn it takes — i.e. it sorted itself into
    // the right lane on the approach (a left-turner never turns from the kerb
    // lane). Both turns must actually happen (cars do reach and use the T).
    const junctionRoad = turnlanes.level["2,1"].road;
    const sim = createRoadSim({
      level: turnlanes.level,
      width: 5,
      height: 5,
      seed: 3,
      spawnInterval: turnlanes.traffic!.spawnInterval,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: turnlanes.traffic!.maxCars,
      spawnEntries: turnlanes.traffic!.spawnEntries,
    });

    // Record, once per car, the lane it occupies when its head FIRST reaches the
    // junction (the moment it commits its turn) — one clean observation each,
    // not per-tick mid-turn noise.
    const committed = new Set<string>();
    let leftTurns = 0;
    let rightTurns = 0;
    let wrongLane = 0;
    for (let i = 0; i < 2500; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        if (f.coord.x !== 2 || f.coord.y !== 1 || f.entryPort !== Position.Bottom) continue;
        if (f.exitPort !== Position.Left && f.exitPort !== Position.Right) continue;
        if (committed.has(c.id)) continue;
        committed.add(c.id);
        if (f.exitPort === Position.Left) leftTurns++; else rightTurns++;
        const allowed = lanesAllowingExit(junctionRoad, Position.Bottom, f.exitPort);
        if (!allowed.includes(Math.round(c.laneIndex))) wrongLane++;
      }
    }
    expect(leftTurns).toBeGreaterThan(0);
    expect(rightTurns).toBeGreaterThan(0);
    expect(wrongLane).toBe(0); // every car turns from a lane that permits it
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
      "0,0": { connections: [], road: fromPairs([road]) },
      "1,0": { connections: [], road: fromPairs([road]) },
      "2,0": {
        connections: [[Position.Top, Position.Bottom]],
        road: fromPairs([road]),
      },
      "3,0": { connections: [], road: fromPairs([road]) },
      "4,0": { connections: [], road: fromPairs([road]) },
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
      "0,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
      "1,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
      "2,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
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
      "0,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
      "1,0": {
        connections: [[Position.Top, Position.Bottom]],
        road: fromPairs([[Position.Left, Position.Right]]),
      },
      "2,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
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
      "0,0": { connections: [], road: fromPairs([road]) },
      "1,0": { connections: [], road: fromPairs([road]) },
      "2,0": { connections: [[Position.Top, Position.Bottom]], road: fromPairs([road]) },
      "3,0": { connections: [], road: fromPairs([road]) },
      "4,0": { connections: [], road: fromPairs([road]) },
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

describe("createRoadSim — multi-lane crosses keep flowing", () => {
  // The shipped 1/2/3-lane cross scenarios must each clear cars from all four
  // arms continuously — adding lanes must not introduce a gridlock the 1-lane
  // case avoids. Drives the real scenario levels so the test guards what ships.
  for (const scn of [roadcross1lane, roadcross2lane, roadcross3lane]) {
    it(`${scn.id}: sustained throughput from every arm, no gridlock`, () => {
      const spawnInterval = scn.traffic?.spawnInterval ?? 0.5;
      const cap = scn.traffic?.maxCars ?? 12;
      const sim = createRoadSim({
        level: scn.level,
        width: 5,
        height: 5,
        seed: 7,
        spawnInterval,
        carSpeed: 0.5,
        carLength: 0.2,
        maxCars: cap,
      });
      let prev = new Set<string>();
      const allIds = new Set<string>();
      let firstHalf = 0;
      let secondHalf = 0;
      const STEPS = 2000;
      for (let i = 0; i < STEPS; i++) {
        sim.step(0.05, () => false);
        const now = new Set(sim.cars().map(c => c.id));
        for (const id of now) allIds.add(id);
        for (const id of prev) {
          if (!now.has(id)) (i < STEPS / 2 ? firstHalf++ : secondHalf++);
        }
        prev = now;
      }
      // Cars complete crossings in BOTH halves → never permanently deadlocks.
      expect(firstHalf).toBeGreaterThan(0);
      expect(secondHalf).toBeGreaterThan(0);
      // Far more cars cycled through than the live cap → real flow, not fill-once.
      expect(allIds.size).toBeGreaterThan(cap);
    });
  }
});

describe("createRoadSim — four-way cross, cars from all sides", () => {
  it("keeps traffic from all four arms flowing without gridlock", () => {
    // A 4-way cross whose centre carries every movement (straight + both turns).
    // Cars spawn from ALL FOUR map edges at once. With two-lane roads (opposing
    // streams pass) plus the junction arbiter (conflicting turns take turns, and
    // right turns never conflict at all), the crossing keeps clearing cars from
    // every arm — it must never lock up into a permanent four-way standstill.
    const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });
    const lvl: Level = {
      // Horizontal road.
      "0,2": road([Position.Left, Position.Right]),
      "1,2": road([Position.Left, Position.Right]),
      "3,2": road([Position.Left, Position.Right]),
      "4,2": road([Position.Left, Position.Right]),
      // Vertical road.
      "2,0": road([Position.Top, Position.Bottom]),
      "2,1": road([Position.Top, Position.Bottom]),
      "2,3": road([Position.Top, Position.Bottom]),
      "2,4": road([Position.Top, Position.Bottom]),
      // All-directions centre: straight through both ways + every turn.
      "2,2": road(
        [Position.Left, Position.Right],
        [Position.Top, Position.Bottom],
        [Position.Left, Position.Top],
        [Position.Left, Position.Bottom],
        [Position.Right, Position.Top],
        [Position.Right, Position.Bottom],
      ),
    };
    const sim = createRoadSim({
      level: lvl,
      width: 5,
      height: 5,
      seed: 7,
      spawnEntries: [
        { coord: { x: 0, y: 2 }, entryPort: Position.Left }, // eastbound
        { coord: { x: 4, y: 2 }, entryPort: Position.Right }, // westbound
        { coord: { x: 2, y: 4 }, entryPort: Position.Bottom }, // northbound
        { coord: { x: 2, y: 0 }, entryPort: Position.Top }, // southbound
      ],
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 12,
    });

    // A car that was present last tick and is gone now drove off the far edge — a
    // completed crossing. Count completions in each half of the run: if the cross
    // ever permanently deadlocked, the second half would see none.
    let prev = new Set<string>();
    const allIds = new Set<string>();
    let firstHalf = 0;
    let secondHalf = 0;
    const STEPS = 1600;
    for (let i = 0; i < STEPS; i++) {
      sim.step(0.05, () => false);
      const now = new Set(sim.cars().map(c => c.id));
      for (const id of now) allIds.add(id);
      for (const id of prev) {
        if (!now.has(id)) {
          if (i < STEPS / 2) firstHalf++;
          else secondHalf++;
        }
      }
      prev = now;
    }

    // Sustained throughput in BOTH halves → the crossing never locked up.
    expect(firstHalf).toBeGreaterThan(0);
    expect(secondHalf).toBeGreaterThan(0);
    // Far more cars completed than the live cap → cars really cycle through, they
    // do not just fill the map once and freeze.
    expect(allIds.size).toBeGreaterThan(12);
  });

  it("never lets two conflicting movements occupy the centre at once", () => {
    // The safety counterpart to the liveness test above. With every movement
    // permitted, the centre carries a mix of conflicting (perpendicular straights,
    // left turns across oncoming) and non-conflicting (right turns, parallel
    // straights in separate lanes) movements. The arbiter + conflict-aware
    // body-point guard must ensure that whenever 2+ cars are on the centre tile at
    // the same time, NONE of their movements geometrically cross — otherwise that
    // is a collision course.
    const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });
    const lvl: Level = {
      "0,2": road([Position.Left, Position.Right]),
      "1,2": road([Position.Left, Position.Right]),
      "3,2": road([Position.Left, Position.Right]),
      "4,2": road([Position.Left, Position.Right]),
      "2,0": road([Position.Top, Position.Bottom]),
      "2,1": road([Position.Top, Position.Bottom]),
      "2,3": road([Position.Top, Position.Bottom]),
      "2,4": road([Position.Top, Position.Bottom]),
      "2,2": road(
        [Position.Left, Position.Right],
        [Position.Top, Position.Bottom],
        [Position.Left, Position.Top],
        [Position.Left, Position.Bottom],
        [Position.Right, Position.Top],
        [Position.Right, Position.Bottom],
      ),
    };
    const sim = createRoadSim({
      level: lvl,
      width: 5,
      height: 5,
      seed: 7,
      spawnEntries: [
        { coord: { x: 0, y: 2 }, entryPort: Position.Left },
        { coord: { x: 4, y: 2 }, entryPort: Position.Right },
        { coord: { x: 2, y: 4 }, entryPort: Position.Bottom },
        { coord: { x: 2, y: 0 }, entryPort: Position.Top },
      ],
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 12,
    });

    // The movement each car is making through the centre tile (2,2), if it is on it.
    const centreMovements = () => {
      const out: { entry: Position; exit: Position }[] = [];
      for (const c of sim.sample()) {
        for (const u of c.units) {
          const pt = [u.front, u.rear].find(
            p => p.coord.x === 2 && p.coord.y === 2 && p.exitPort !== null
          );
          if (pt) {
            out.push({ entry: pt.entryPort, exit: pt.exitPort as Position });
            break; // one movement per vehicle
          }
        }
      }
      return out;
    };

    let sawCoOccupancy = false;
    for (let i = 0; i < 1600; i++) {
      sim.step(0.05, () => false);
      const moves = centreMovements();
      if (moves.length >= 2) sawCoOccupancy = true;
      for (let a = 0; a < moves.length; a++) {
        for (let b = a + 1; b < moves.length; b++) {
          expect(movementsConflict(moves[a], moves[b])).toBe(false);
        }
      }
    }
    // The centre really did get shared (otherwise the safety check is vacuous):
    // non-conflicting movements pass through together.
    expect(sawCoOccupancy).toBe(true);
  });
});

describe("createRoadSim — launch reaction delay", () => {
  it("waits a beat before a stopped car rolls once the gate opens", () => {
    // One car approaching a closed crossing at 1,0. Once it has stopped at the
    // gate and the gate opens, the car must not move on the very next tick — it
    // waits out its reaction time — then accelerates away.
    const lvl: Level = {
      "0,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
      "1,0": {
        connections: [[Position.Top, Position.Bottom]],
        road: fromPairs([[Position.Left, Position.Right]]),
      },
      "2,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
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
  it("enters the map already at cruise speed (no ramp-up from the edge)", () => {
    // A car drives in from off-screen, so it appears already rolling: its first
    // movement on the map should be a full cruise step, not a tiny ramp-from-rest
    // step. speedSpread 0 pins the cruise speed to carSpeed so the step is exact.
    const sim = createRoadSim({
      level: straightRoad(),
      width: 3,
      height: 1,
      seed: 7,
      spawnInterval: 0.3,
      carSpeed: 0.5,
      speedSpread: 0,
      maxCars: 1,
    });
    const deltas: number[] = [];
    let prev: number | null = null;
    for (let i = 0; i < 40; i++) {
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
    // The very first movement after entering is already a full cruise step.
    expect(deltas[0]).toBeGreaterThan(cruiseStep * 0.9);
    expect(deltas[0]).toBeLessThan(cruiseStep * 1.1);
  });

  it("ramps back up from rest after stopping at a closed gate", () => {
    // The accel ramp still applies when a car has to STOP on the map and get going
    // again: hold one at a closed crossing, then open it and watch the first
    // movements come out small and build up toward cruise (not a full step at once).
    const lvl: Level = {
      "0,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
      "1,0": {
        connections: [[Position.Top, Position.Bottom]],
        road: fromPairs([[Position.Left, Position.Right]]),
      },
      "2,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
    };
    let closed = true;
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 7,
      spawnInterval: 0.3,
      carSpeed: 0.5,
      speedSpread: 0,
      maxCars: 1,
    });
    // Settle the car hard against the closed gate (fully stopped).
    for (let i = 0; i < 200; i++) sim.step(0.05, id => id === "1,0" && closed);
    // Open the gate and let the reaction delay elapse, then record the movements.
    closed = false;
    const deltas: number[] = [];
    let prev: number | null = null;
    for (let i = 0; i < 120; i++) {
      sim.step(0.05, () => false);
      const c = sim.cars()[0];
      if (!c) {
        prev = null;
        continue;
      }
      const pos = c.headIndex + c.headProgress;
      if (prev !== null && pos - prev > 1e-9) deltas.push(pos - prev);
      prev = pos;
    }
    expect(deltas.length).toBeGreaterThan(5);
    const cruiseStep = 0.5 * 0.05;
    // First movement out of rest is a small fraction of a cruise step…
    expect(deltas[0]).toBeLessThan(cruiseStep * 0.5);
    // …and it works back up to roughly cruise speed once rolling.
    expect(Math.max(...deltas)).toBeGreaterThan(cruiseStep * 0.9);
  });
});

describe("createRoadSim — variable preferred speed", () => {
  it("draws a spread of per-car cruise speeds within the configured bounds", () => {
    // Spawn a stream of cars on an open road and read each one's `speed`. With a
    // speed spread the spawned cruise speeds vary car-to-car (not all the base
    // value) and every one stays inside [carSpeed*(1-spread), carSpeed*(1+spread)].
    const carSpeed = 0.5;
    const spread = 0.4;
    const sim = createRoadSim({
      level: straightRoad(),
      width: 3,
      height: 1,
      seed: 11,
      spawnInterval: 0.3,
      carSpeed,
      carLength: 0.2,
      speedSpread: spread,
      maxCars: 40,
    });
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.cars()) seen.add(Math.round(c.speed * 1e6));
    }
    const speeds = [...seen].map(s => s / 1e6);
    expect(speeds.length).toBeGreaterThan(3); // several distinct cars spawned
    // Not all equal — there's a real spread.
    expect(new Set(speeds).size).toBeGreaterThan(1);
    const lo = carSpeed * (1 - spread);
    const hi = carSpeed * (1 + spread);
    for (const s of speeds) {
      expect(s).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(s).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("with zero spread every car keeps the exact base cruise speed", () => {
    const sim = createRoadSim({
      level: straightRoad(),
      width: 3,
      height: 1,
      seed: 11,
      spawnInterval: 0.3,
      carSpeed: 0.5,
      carLength: 0.2,
      speedSpread: 0,
      maxCars: 40,
    });
    for (let i = 0; i < 200; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.cars()) expect(c.speed).toBeCloseTo(0.5, 9);
    }
  });

  it("is deterministic: the same seed yields the same per-car speeds", () => {
    const run = () => {
      const sim = createRoadSim({
        level: straightRoad(),
        width: 3,
        height: 1,
        seed: 23,
        spawnInterval: 0.3,
        carSpeed: 0.5,
        carLength: 0.2,
        speedSpread: 0.4,
        maxCars: 40,
      });
      const speeds: number[] = [];
      for (let i = 0; i < 300; i++) {
        sim.step(0.05, () => false);
        for (const c of sim.cars())
          if (!speeds.includes(c.speed)) speeds.push(c.speed);
      }
      return speeds.map(s => Math.round(s * 1e6));
    };
    expect(run()).toEqual(run());
  });

  it("a fast car never overtakes a slower leader and matches its pace", () => {
    // A long one-way straight road. Two cars spawn from the left a head start
    // apart; with a wide speed spread the second car is the faster one and must
    // reel the slower leader in. The gap cap keeps it behind the leader's rear,
    // and once it has closed up its velocity is held to the leader's pace, not its
    // own higher cruise — the slower car sets the platoon speed. Seed 9 yields a
    // ~0.36 leader and a ~0.58 follower (a clear convergence case).
    const road: [Position, Position] = [Position.Left, Position.Right];
    const lvl: Level = {};
    for (let x = 0; x < 40; x++) lvl[`${x},0`] = { connections: [], road: fromPairs([road]) };
    const sim = createRoadSim({
      level: lvl,
      width: 40,
      height: 1,
      seed: 9,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 2.0, // a clear head start so the follower must catch up
      carSpeed: 0.5,
      carLength: 0.2,
      speedSpread: 0.4,
      maxCars: 2,
    });

    const worldX = (s: { coord: { x: number }; t: number }) => s.coord.x + s.t;

    // Capture the first two cars that share the road and reason only about this
    // pair, and only while both are still on the lane: maxCars 2 means a car
    // driving off the right edge would let a fresh, unrelated car spawn in its
    // place, which would muddy a position-only "leader/follower" read.
    let ids: string[] = [];
    for (let i = 0; i < 400 && ids.length < 2; i++) {
      sim.step(0.05, () => false);
      const live = sim.cars();
      if (live.length >= 2) ids = live.slice(0, 2).map(c => c.id);
    }
    expect(ids.length).toBe(2);

    // The follower closes the gap, then holds a steady following distance where
    // its braking model balances the leader's pace. Track the pair while both are
    // alive; assert no-overtake every step, and average the velocities over the
    // "in contact" phase (a tight gap) so the comparison is robust to the small
    // oscillation around that equilibrium rather than tied to one instant.
    let minGap = Infinity;
    let followerSpeed = 0;
    let nContact = 0;
    let sumFollowerV = 0;
    let sumLeaderV = 0;
    for (let i = 0; i < 1200; i++) {
      sim.step(0.05, () => false);
      const live = sim.cars();
      const a = live.find(c => c.id === ids[0]);
      const b = live.find(c => c.id === ids[1]);
      if (!a || !b) break; // one drove off the lane — stop reasoning about the pair
      const byId = new Map(sim.sample().map(c => [c.id, c]));
      const aFront = worldX(byId.get(a.id)!.units[0].front);
      const bFront = worldX(byId.get(b.id)!.units[0].front);
      const ahead = aFront >= bFront ? a : b;
      const behind = ahead === a ? b : a;
      const leaderRear = worldX(byId.get(ahead.id)!.units[0].rear);
      const followerFront = worldX(byId.get(behind.id)!.units[0].front);
      // No overtake, ever: the rear car's nose never crosses the lead car's tail.
      expect(followerFront).toBeLessThanOrEqual(leaderRear + 1e-6);
      // The faster car stays the rear one (it can't pass), so the follower always
      // has the higher preferred speed.
      expect(behind.speed).toBeGreaterThan(ahead.speed);
      const gap = leaderRear - followerFront;
      minGap = Math.min(minGap, gap);
      if (gap < 0.12) {
        // In contact: sample the platoon's velocities for the averages below.
        nContact++;
        sumFollowerV += behind.velocity;
        sumLeaderV += ahead.velocity;
        followerSpeed = behind.speed;
      }
    }
    // The faster car really did catch the slower one and tail it (not just trail at
    // a distance) — otherwise the velocity comparisons below would be vacuous.
    expect(minGap).toBeLessThan(0.12);
    expect(nContact).toBeGreaterThan(50);
    const avgFollowerV = sumFollowerV / nContact;
    const avgLeaderV = sumLeaderV / nContact;
    // While tailing, the follower runs at the leader's pace (within a small band),
    // not its own higher cruise — the slower leader sets the platoon speed.
    expect(avgFollowerV).toBeLessThanOrEqual(avgLeaderV + 0.03);
    expect(avgFollowerV).toBeLessThan(followerSpeed - 0.1);
  });
});

describe("createRoadSim — crossing patience (waitedSec / frame)", () => {
  // A straight road across a crossing tile (rail Top-Bottom) so a closed gate
  // holds the approaching car short of the rails.
  function crossingRoad(): Level {
    const road = fromPairs([[Position.Left, Position.Right]]);
    return {
      "0,0": { connections: [], road },
      "1,0": { connections: [[Position.Top, Position.Bottom]], road },
      "2,0": { connections: [], road },
    };
  }

  it("accrues wait only while gated by the closed crossing, and resets on release", () => {
    let closed = true;
    const sim = createRoadSim({
      level: crossingRoad(),
      width: 3,
      height: 1,
      seed: 5,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 0.5,
      carSpeed: 0.5,
      maxCars: 1,
    });
    // Settle a car hard against the closed gate, then keep it waiting.
    for (let i = 0; i < 100; i++) sim.step(0.1, id => id === "1,0" && closed);
    const waitedAfterStop = sim.frame().maxCarWaitSec;
    expect(waitedAfterStop).toBeGreaterThan(1); // it has been waiting a while
    // The frame's worst wait equals the (single) car's wait.
    expect(sim.frame().carWaitTotalSec).toBeCloseTo(waitedAfterStop, 6);

    // Keep it closed a little longer: the wait keeps climbing.
    for (let i = 0; i < 20; i++) sim.step(0.1, id => id === "1,0" && closed);
    expect(sim.frame().maxCarWaitSec).toBeGreaterThan(waitedAfterStop);

    // Open the gate and let the car roll: its wait resets toward 0 once moving.
    closed = false;
    for (let i = 0; i < 60; i++) sim.step(0.1, () => false);
    expect(sim.frame().maxCarWaitSec).toBeLessThan(0.5);
  });

  it("does not charge a queued car's wait to the crossing (only the lead car waits on it)", () => {
    // A longer approach so a queue forms behind the gate: the lead car is bound by
    // the crossing; the followers are bound by the car ahead, so their wait is not
    // attributed to the crossing.
    const road = fromPairs([[Position.Left, Position.Right]]);
    const lvl: Level = {
      "0,0": { connections: [], road },
      "1,0": { connections: [], road },
      "2,0": { connections: [], road },
      "3,0": { connections: [[Position.Top, Position.Bottom]], road },
      "4,0": { connections: [], road },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 5,
      height: 1,
      seed: 3,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 0.4,
      carSpeed: 0.5,
      carLength: 0.3,
    });
    for (let i = 0; i < 400; i++) sim.step(0.05, id => id === "3,0");
    expect(sim.cars().length).toBeGreaterThan(1); // a real queue formed
    // Total wait charged to the crossing is essentially one car's worth — the lead
    // car at the gate — not the whole queue's. (The followers are bound by the car
    // ahead.) So carWaitTotalSec ≈ maxCarWaitSec, not a multiple of it.
    const f = sim.frame();
    expect(f.maxCarWaitSec).toBeGreaterThan(1);
    expect(f.carWaitTotalSec).toBeLessThan(f.maxCarWaitSec * 1.5);
  });

  it("counts only crossing-using cars toward carsDelivered", () => {
    // Open crossing: cars stream across it and despawn at the right edge — each is
    // a crossing-user, so throughput climbs.
    const sim = createRoadSim({
      level: crossingRoad(),
      width: 3,
      height: 1,
      seed: 7,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 0.4,
      carSpeed: 0.5,
      carLength: 0.2,
    });
    for (let i = 0; i < 400; i++) sim.step(0.05, () => false);
    expect(sim.frame().carsDelivered).toBeGreaterThan(0);
  });

  it("a road with no crossing never counts throughput", () => {
    // A plain straight road (no rail anywhere): cars despawn at the edge but none
    // used a crossing, so carsDelivered stays 0.
    const sim = createRoadSim({
      level: straightRoad(),
      width: 3,
      height: 1,
      seed: 7,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 0.4,
      carSpeed: 0.5,
      carLength: 0.2,
    });
    for (let i = 0; i < 400; i++) sim.step(0.05, () => false);
    expect(sim.frame().carsDelivered).toBe(0);
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
      expect(gap).toBeLessThan(0.08); // packed nearly nose-to-tail (~12px gap)
    }
  });
});

describe("createRoadSim — one-way street", () => {
  it("only ever carries cars in the permitted direction", () => {
    const lvl: Level = {
      "0,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
      "1,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
      "2,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 3,
      height: 1,
      seed: 5,
      spawnInterval: 0.3,
      carLength: 0.2,
    });
    let everSeen = false;
    for (let i = 0; i < 400; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        everSeen = true;
        expect(c.units[0].front.entryPort).toBe(Position.Left);
      }
    }
    expect(everSeen).toBe(true);
  });
});

describe("createRoadSim — right-turn-only cross", () => {
  it("lets all four arms flow simultaneously without gridlock", () => {
    const { Top: T, Right: R, Bottom: B, Left: L } = Position;
    const straight = (a: Position, b: Position) => ({
      connections: [],
      road: [turns(a, [b]), turns(b, [a])],
    });
    const lvl: Level = {
      "0,2": straight(L, R),
      "1,2": straight(L, R),
      "3,2": straight(L, R),
      "4,2": straight(L, R),
      "2,0": straight(T, B),
      "2,1": straight(T, B),
      "2,3": straight(T, B),
      "2,4": straight(T, B),
      // Right-turn-only centre: Left->Bottom, Bottom->Right, Right->Top, Top->Left.
      "2,2": { connections: [], road: [turns(L, [B]), turns(B, [R]), turns(R, [T]), turns(T, [L])] },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 5,
      height: 5,
      seed: 7,
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 12,
    });
    let prev = new Set<string>();
    let completed = 0;
    for (let i = 0; i < 1200; i++) {
      sim.step(0.05, () => false);
      const now = new Set(sim.cars().map(c => c.id));
      for (const id of prev) if (!now.has(id)) completed++;
      prev = now;
    }
    expect(completed).toBeGreaterThan(8);
  });

  it("never makes a right-turner yield (non-conflicting movements are not blocked)", () => {
    // Every movement here is a right turn, and right turns never conflict, so no
    // car should ever have to stop for the junction — they all flow freely. We
    // measure stalled car-ticks (a car whose position doesn't advance between
    // steps). With the old whole-tile exclusion this was in the thousands; with
    // conflict-aware blocking it is ~0. (A small margin tolerates incidental
    // same-lane following, though at these speeds there is none.)
    const { Top: T, Right: R, Bottom: B, Left: L } = Position;
    const straight = (a: Position, b: Position) => ({
      connections: [],
      road: [turns(a, [b]), turns(b, [a])],
    });
    const lvl: Level = {
      "0,2": straight(L, R),
      "1,2": straight(L, R),
      "3,2": straight(L, R),
      "4,2": straight(L, R),
      "2,0": straight(T, B),
      "2,1": straight(T, B),
      "2,3": straight(T, B),
      "2,4": straight(T, B),
      "2,2": { connections: [], road: [turns(L, [B]), turns(B, [R]), turns(R, [T]), turns(T, [L])] },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 5,
      height: 5,
      seed: 7,
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 12,
    });
    const posOf = new Map<string, number>();
    let stalled = 0;
    for (let i = 0; i < 1200; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.cars()) {
        const pos = c.headIndex + c.headProgress;
        const prevPos = posOf.get(c.id);
        if (prevPos !== undefined && Math.abs(pos - prevPos) < 1e-4) stalled++;
        posOf.set(c.id, pos);
      }
    }
    expect(stalled).toBeLessThan(50);
  });
});

describe("createRoadSim — no-left-turn cross", () => {
  it("never performs a banned left turn, and still flows", () => {
    // A 4-way cross where each approach may go straight or right, but NOT left.
    // The banned movements are simply absent from the lanes, so the planner can
    // never route them and the sim never offers them — directed lanes enforcing a
    // partial turn restriction.
    const { Top: T, Right: R, Bottom: B, Left: L } = Position;
    const straight = (a: Position, b: Position) => ({
      connections: [],
      road: [turns(a, [b]), turns(b, [a])],
    });
    const lvl: Level = {
      "0,2": straight(L, R),
      "1,2": straight(L, R),
      "3,2": straight(L, R),
      "4,2": straight(L, R),
      "2,0": straight(T, B),
      "2,1": straight(T, B),
      "2,3": straight(T, B),
      "2,4": straight(T, B),
      // Straight + right only (left turns banned).
      "2,2": {
        connections: [],
        road: [turns(L, [R, B]), turns(R, [L, T]), turns(T, [B, L]), turns(B, [T, R])],
      },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 5,
      height: 5,
      seed: 7,
      spawnEntries: [
        { coord: { x: 0, y: 2 }, entryPort: Position.Left },
        { coord: { x: 4, y: 2 }, entryPort: Position.Right },
        { coord: { x: 2, y: 4 }, entryPort: Position.Bottom },
        { coord: { x: 2, y: 0 }, entryPort: Position.Top },
      ],
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 12,
    });
    // The four banned left-turn movements (screen coords: x→right, y→down).
    const isLeftTurn = (m: { entry: Position; exit: Position }) =>
      (m.entry === L && m.exit === T) ||
      (m.entry === R && m.exit === B) ||
      (m.entry === T && m.exit === R) ||
      (m.entry === B && m.exit === L);

    let prev = new Set<string>();
    let completed = 0;
    let sawCentreMovement = false;
    for (let i = 0; i < 1600; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        for (const u of c.units) {
          const pt = [u.front, u.rear].find(
            p => p.coord.x === 2 && p.coord.y === 2 && p.exitPort !== null
          );
          if (pt) {
            const m = { entry: pt.entryPort, exit: pt.exitPort as Position };
            expect(isLeftTurn(m)).toBe(false); // no banned left turn, ever
            sawCentreMovement = true;
            break;
          }
        }
      }
      const now = new Set(sim.cars().map(c => c.id));
      for (const id of prev) if (!now.has(id)) completed++;
      prev = now;
    }
    expect(sawCentreMovement).toBe(true); // cars really used the junction
    expect(completed).toBeGreaterThan(8); // and traffic kept flowing
  });
});

describe("createRoadSim — per-lane following", () => {
  function twoLaneRoad(): Level {
    const road = nWayLanes(Position.Left, Position.Right, 2);
    return {
      "0,0": { connections: [], road },
      "1,0": { connections: [], road },
      "2,0": { connections: [], road },
    };
  }

  it("cars in different lanes of the same direction flow without cross-lane stalling", () => {
    const sim = createRoadSim({
      level: twoLaneRoad(),
      width: 3,
      height: 1,
      seed: 1,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 0.05,
      carSpeed: 0.5,
      maxCars: 6,
    });
    let stalledTicks = 0;
    for (let i = 0; i < 400; i++) {
      sim.step(0.05, () => false);
      const cars = sim.cars();
      if (cars.length >= 2) {
        const moving = cars.filter(c => c.velocity > 0.01);
        if (moving.length === 0) stalledTicks++;
      }
    }
    expect(stalledTicks).toBeLessThan(30);
  });

  it("sample() includes laneIndex and laneCount fields", () => {
    const sim = createRoadSim({
      level: twoLaneRoad(),
      width: 3,
      height: 1,
      seed: 1,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 0.3,
      carSpeed: 0.5,
      maxCars: 4,
    });
    for (let i = 0; i < 100; i++) sim.step(0.1, () => false);
    const samples = sim.sample();
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(typeof s.laneIndex).toBe("number");
      expect(typeof s.laneCount).toBe("number");
      expect(s.laneIndex).toBeGreaterThanOrEqual(0);
      expect(s.laneCount).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("createRoadSim — lane merge (cross-tile continuity)", () => {
  function mergingRoad(): Level {
    const twoLane = nWayLanes(Position.Left, Position.Right, 2);
    const oneLane = fromPairs([[Position.Left, Position.Right]]);
    return {
      "0,0": { connections: [], road: twoLane },
      "1,0": { connections: [], road: twoLane },
      "2,0": { connections: [], road: oneLane },
      "3,0": { connections: [], road: oneLane },
    };
  }

  it("cars entering the merge point keep flowing (laneIndex clamped to 0)", () => {
    const sim = createRoadSim({
      level: mergingRoad(),
      width: 4,
      height: 1,
      seed: 3,
      spawnEntries: [{ coord: { x: 0, y: 0 }, entryPort: Position.Left }],
      spawnInterval: 0.4,
      carSpeed: 0.5,
      maxCars: 6,
    });
    // Run the sim and ensure no permanent gridlock (not all cars stopped simultaneously).
    let allStuckTicks = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(0.05, () => false);
      const cars = sim.cars();
      if (cars.length >= 2 && cars.every(c => c.velocity < 0.001)) allStuckTicks++;
    }
    expect(allStuckTicks).toBeLessThan(50);
  });
});
