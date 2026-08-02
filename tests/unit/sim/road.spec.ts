import { describe, it, expect } from "vitest";
import { itSlow } from "../support/tier";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import {
  fromPairs,
  oneWay,
  nWayLanes,
  lanesAllowingExit,
  carLaneIndices,
  busLaneIndices,
} from "@/tiles/lanes";
import {
  roadTraverse,
  roadEntries,
  createRoadSim,
  vehicleSpec,
  specLength,
  vehicleClassOf,
  CarChord,
} from "@/sim/road";
import { carqueue } from "@/levels/test/scenarios/carqueue";
import { roadcross } from "@/levels/test/scenarios/roadcross";
import { turnlanes } from "@/levels/test/scenarios/turnlanes";
import { buslane } from "@/levels/test/scenarios/buslane";

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

  it("treats only the true open edge of a one-way road as a spawn entry", () => {
    // A 3-tile eastbound one-way road (every tile Left->Right). Cars enter at the
    // west edge (0,0) and nowhere else: an interior tile's upstream neighbour
    // feeds it (drives toward the seam) even though no lane LEAVES the neighbour
    // through that seam, so it must not be misread as an open edge. The east edge
    // has no inbound lane, so it is not an entry either.
    const lvl: Level = {
      "0,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
      "1,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
      "2,0": { connections: [], road: [oneWay(Position.Left, Position.Right)] },
    };
    const entries = roadEntries(lvl, 3, 1);
    expect(entries).toEqual([{ coord: { x: 0, y: 0 }, entryPort: Position.Left }]);
  });

  it("does not add a car spawn entry adjacent to a bus-only upstream road", () => {
    // Regular road (0,0) — bus-only segment (1,0) — regular road (2,0).
    // Issue #33: before the fix, 0,0's Right edge and 2,0's Left edge were
    // incorrectly treated as spawn entries because the bus-only neighbour has
    // no *car* lane feeding them. Cars would then appear to spawn from the
    // bus-lane seam. After the fix, only the true map-edge entries remain.
    const busOnly = [
      { from: Position.Left, to: [Position.Right], index: 0, kind: "bus" as const },
      { from: Position.Right, to: [Position.Left], index: 0, kind: "bus" as const },
    ];
    const lvl: Level = {
      "0,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
      "1,0": { connections: [], road: busOnly },
      "2,0": { connections: [], road: fromPairs([[Position.Left, Position.Right]]) },
    };
    const entries = roadEntries(lvl, 3, 1);
    expect(entries).toContainEqual({ coord: { x: 0, y: 0 }, entryPort: Position.Left });
    expect(entries).toContainEqual({ coord: { x: 2, y: 0 }, entryPort: Position.Right });
    // These must NOT appear — they border the bus-only tile, not the map edge.
    expect(entries).not.toContainEqual({ coord: { x: 0, y: 0 }, entryPort: Position.Right });
    expect(entries).not.toContainEqual({ coord: { x: 2, y: 0 }, entryPort: Position.Left });
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
    // 600 ticks of a SATURATED multi-lane road — the heaviest single sim run in
    // this file. It takes ~2s of a 5s default alone and blows it under the
    // parallel suite, where a dozen workers share the cores: measured 5.4-5.6s
    // in a full run and 1.9-2.4s on its own, on an unchanged tree. A timeout
    // here is the machine, never the code — what this test guards (cars stacked
    // at a spawn edge) shows up as `stacked`, which is a count, not a clock.
  }, 30_000);

  itSlow("merges cars out of a dropping lane before it ends (G)", () => {
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

  it("eases into a lane change instead of snapping to full lateral speed", () => {
    // The S-curve motion profile ramps lateral velocity up under a bounded
    // acceleration, so a car never jumps from no sideways motion to its full
    // lane-change speed in a single tick (the old bang-bang behaviour, which
    // looked harsh on an overtake). Use the overtake map (uniform 2-lane each
    // way, no lane drop) so the only lateral motion is the eased pull-out/return —
    // assert that whenever a car is laterally at rest one tick, its lateral speed
    // the next tick is small (it accelerates in, not a jump to the cruise rate).
    const lane2 = () => ({ connections: [], road: nWayLanes(Position.Left, Position.Right, 2) });
    const lvl: Level = {
      "0,0": lane2(), "1,0": lane2(), "2,0": lane2(), "3,0": lane2(), "4,0": lane2(), "5,0": lane2(),
    };
    const sim = createRoadSim({
      level: lvl,
      width: 6,
      height: 1,
      seed: 4,
      spawnInterval: 0.9,
      carSpeed: 0.6,
      speedSpread: 0.3, // a fast/slow mix so leaders get caught and overtaken
      carLength: 0.2,
      maxCars: 8,
      overtakeFraction: 1,
    });
    const dt = 0.05;
    // Per-car lateral history, so we measure every merging car (the first car to
    // spawn rides the kerb lane straight through and never changes).
    const hist = new Map<string, { lane: number; vel: number }>();
    let worstOnsetVel = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(dt, () => false);
      const live = new Set<string>();
      for (const c of sim.sample()) {
        live.add(c.id);
        const prev = hist.get(c.id);
        if (prev) {
          const vel = Math.abs(c.laneIndex - prev.lane) / dt;
          // At lateral rest last tick → this tick's speed is the acceleration
          // onset; it must not leap straight to the cruise rate.
          if (prev.vel < 0.05) worstOnsetVel = Math.max(worstOnsetVel, vel);
          hist.set(c.id, { lane: c.laneIndex, vel });
        } else {
          hist.set(c.id, { lane: c.laneIndex, vel: 0 });
        }
      }
      for (const id of [...hist.keys()]) if (!live.has(id)) hist.delete(id);
    }
    // The car did change lane (so the test actually exercised the motion)…
    expect(worstOnsetVel).toBeGreaterThan(0);
    // …but the onset speed stayed within one acceleration step of rest, not the
    // full ~2.2 lanes/sec cruise the old constant-velocity change jumped to.
    expect(worstOnsetVel).toBeLessThan(0.5);
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
      // Cars spawn into either lane (rotating). The discipline signal is PULLING OUT
      // — riding a lane INNER of where the car started: on this map only an overtake
      // does that. (Keep-right moves a car the other way, toward the kerb, which is
      // not a pull-out — so it doesn't count here.)
      const firstLane = new Map<string, number>();
      const pulledOut = new Set<string>(); // ever rode a lane inner of its start (a pass)
      const returnedKerb = new Set<string>(); // after a pull-out, came back to the kerb
      let stacked = 0;
      for (let i = 0; i < 1500; i++) {
        sim.step(0.05, () => false);
        const pos = new Set<string>();
        for (const c of sim.sample()) {
          const f = c.units[0].front;
          const lane = Math.round(c.laneIndex);
          if (!firstLane.has(c.id)) firstLane.set(c.id, lane);
          const home = firstLane.get(c.id)!;
          if (lane > home) pulledOut.add(c.id); // moved to an inner lane = overtaking
          else if (lane === 0 && pulledOut.has(c.id)) returnedKerb.add(c.id);
          const key = `${f.coord.x},${f.coord.y}:${lane}:${Math.round(f.t * 40)}`;
          if (pos.has(key)) stacked++;
          pos.add(key);
        }
      }
      return { pulledOut: pulledOut.size, returnedKerb: returnedKerb.size, stacked };
    };

    const overtakers = run(1);
    expect(overtakers.pulledOut).toBeGreaterThan(0); // passes happen
    expect(overtakers.returnedKerb).toBeGreaterThan(0); // and the car pulls back in
    expect(overtakers.stacked).toBe(0); // never overlaps another car

    const disciplined = run(0);
    // No overtaking → no car ever pulls out to an inner lane (it may keep-right toward
    // the kerb, but it never moves AWAY from it).
    expect(disciplined.pulledOut).toBe(0);
  });

  it("never puts a car in a bus-only lane (cars confined to car lanes)", () => {
    // The buslane scenario: 1 car lane (index 0) + 1 bus-only lane (index 1) per
    // direction. Cars are car/truck/semi — none is a bus — so NO vehicle may ever
    // occupy the bus lane. Drive it busy, with every driver an overtaker and a wide
    // speed spread (so slow leaders get caught and a pass into the inner lane is
    // tempting): the only inner lane here is the bus lane, so a correct sim never
    // moves a car into it.
    const sim = createRoadSim({
      level: buslane.level,
      width: buslane.size!.cols,
      height: buslane.size!.rows,
      seed: 7,
      spawnInterval: 0.3,
      carSpeed: 0.5,
      carLength: 0.2,
      speedSpread: 0.4,
      overtakeFraction: 1,
      maxCars: 12,
    });
    let busLaneViolations = 0;
    let sampled = 0;
    for (let i = 0; i < 1500; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        const id = `${f.coord.x},${f.coord.y}`;
        const carLanes = carLaneIndices(buslane.level[id]?.road, f.entryPort);
        sampled++;
        if (!carLanes.includes(Math.round(c.laneIndex))) busLaneViolations++;
      }
    }
    expect(sampled).toBeGreaterThan(100); // cars actually ran the road
    expect(busLaneViolations).toBe(0); // and none ever rode the bus lane
  });

  it("a bus prefers the bus lane (rides the bus-only lane)", () => {
    // The buslane scenario has a kerb-side bus lane (index 0) + a car lane per
    // direction. Spawn an all-bus stream: a bus MAY use either lane but PREFERS the
    // bus lane, so the overwhelming majority of sampled bus positions sit on it.
    const sim = createRoadSim({
      level: buslane.level,
      width: buslane.size!.cols,
      height: buslane.size!.rows,
      seed: 4,
      spawnInterval: 0.6,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 8,
      mix: { bus: 1 },
    });
    let onBusLane = 0;
    let busSamples = 0;
    for (let i = 0; i < 1200; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        if (c.units[0].part !== "bus") continue; // only buses spawned, but be explicit
        const f = c.units[0].front;
        const id = `${f.coord.x},${f.coord.y}`;
        const busLanes = busLaneIndices(buslane.level[id]?.road, f.entryPort);
        busSamples++;
        if (busLanes.includes(Math.round(c.laneIndex))) onBusLane++;
      }
    }
    expect(busSamples).toBeGreaterThan(100); // buses actually ran the road
    // Buses settle onto the bus lane and stay there — the strong majority of
    // samples sit on it. The margin allows the brief lateral ease at spawn AND the
    // time a bus rides the adjacent lane while WAITING for a real gap to merge onto
    // a congested bus lane: since #39's swept-body collision work a bus no longer
    // clips its way in (the overlap-recovery clamp holds it back beside an occupant),
    // so on a busy bus lane it spends a little longer in the general lane than the
    // old barge-in behaviour did.
    expect(onBusLane / busSamples).toBeGreaterThan(0.85);
  });

  it("keeps cars off the bus lane even when buses share the road", () => {
    // A mixed car + bus stream on the buslane scenario. Buses ride the bus lane;
    // cars must STILL never occupy it (a car is confined to car lanes regardless of
    // what else is on the road). Distinguish the two by the rendered part.
    const sim = createRoadSim({
      level: buslane.level,
      width: buslane.size!.cols,
      height: buslane.size!.rows,
      seed: 11,
      spawnInterval: 0.4,
      carSpeed: 0.5,
      carLength: 0.2,
      speedSpread: 0.4,
      overtakeFraction: 1,
      maxCars: 12,
      mix: { car: 1, bus: 1 },
    });
    let carBusLaneViolations = 0;
    let carSamples = 0;
    let busOnBusLane = 0;
    for (let i = 0; i < 1500; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        const id = `${f.coord.x},${f.coord.y}`;
        const lane = Math.round(c.laneIndex);
        if (c.units[0].part === "bus") {
          if (busLaneIndices(buslane.level[id]?.road, f.entryPort).includes(lane)) busOnBusLane++;
          continue;
        }
        carSamples++;
        if (!carLaneIndices(buslane.level[id]?.road, f.entryPort).includes(lane)) carBusLaneViolations++;
      }
    }
    expect(carSamples).toBeGreaterThan(100); // cars actually ran the road
    expect(carBusLaneViolations).toBe(0); // and none ever strayed onto the bus lane
    expect(busOnBusLane).toBeGreaterThan(50); // buses were present and used the bus lane
  });

  itSlow("feeds the cross from permitted lanes and turns both ways (F)", () => {
    // The turnlanes scenario: a one-way road widens 1→2→3 lanes from the south
    // edge into an all-turns crossroads at "3,3" (every approach lane may go
    // straight / left / right). Every car that reaches the junction must be in a
    // lane that PERMITS the turn it takes, and both left and right turns must
    // actually happen (cars reach and fan out through the cross).
    const junctionRoad = turnlanes.level["3,3"].road;
    const sim = createRoadSim({
      level: turnlanes.level,
      width: turnlanes.size!.cols,
      height: turnlanes.size!.rows,
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
        if (f.coord.x !== 3 || f.coord.y !== 3 || f.entryPort !== Position.Bottom) continue;
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

  it("two-way traffic flows past itself on a CURVE (no head-on deadlock)", () => {
    // An L-shaped bidirectional 2-lane road: a horizontal straight, a 90° curve,
    // and a vertical straight, open at both far ends so cars spawn from each and
    // meet head-on in the bend. Regression: an oncoming car on a curve enters
    // through our EXIT port (an adjacent port), which oppositePort(entry) doesn't
    // recognise as opposing — so the car-follower treated it as a same-lane
    // obstacle and the two streams froze nose-to-nose in the curve. With opposing
    // detected by the tile's single edge-pair, the lanes pass and the road flows.
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 2) },
      "1,0": { connections: [], road: nWayLanes(Position.Left, Position.Bottom, 2) }, // curve
      "1,1": { connections: [], road: nWayLanes(Position.Top, Position.Bottom, 2) },
    };
    const sim = createRoadSim({
      level: lvl,
      width: 2,
      height: 2,
      seed: 7,
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 12,
    });

    let prev = new Set<string>();
    const completed = new Set<string>();
    for (let i = 0; i < 800; i++) {
      sim.step(0.05, () => false);
      const now = new Set(sim.cars().map(c => c.id));
      for (const id of prev) if (!now.has(id)) completed.add(id);
      prev = now;
    }
    // In the deadlock NO car ever traverses the curve to despawn at the far edge;
    // with both streams flowing many do.
    expect(completed.size).toBeGreaterThan(8);
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
    // A bus is a single box, longer than a car but shorter than a rigid truck.
    expect(specLength(vehicleSpec("bus", base))).toBeGreaterThan(base);
    expect(specLength(vehicleSpec("bus", base))).toBeLessThan(
      specLength(vehicleSpec("truck", base))
    );
  });

  it("renders a car/truck/bus as one box and a semi as a cab + trailer", () => {
    expect(vehicleSpec("car", 0.2).segments.map(s => s.part)).toEqual(["car"]);
    expect(vehicleSpec("truck", 0.2).segments.map(s => s.part)).toEqual(["truck"]);
    expect(vehicleSpec("bus", 0.2).segments.map(s => s.part)).toEqual(["bus"]);
    expect(vehicleSpec("semi", 0.2).segments.map(s => s.part)).toEqual([
      "cab",
      "trailer",
    ]);
  });

  it("classes a bus as the bus lane-access class and everything else as car", () => {
    expect(vehicleClassOf("bus")).toBe("bus");
    expect(vehicleClassOf("car")).toBe("car");
    expect(vehicleClassOf("truck")).toBe("car");
    expect(vehicleClassOf("semi")).toBe("car");
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
