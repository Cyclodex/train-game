import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { fromPairs, oneWay, turns, nWayLanes, junctionExitLane } from "@/tiles/lanes";
import { oppositePort } from "@/sim/topology";
import {
  roadTraverse,
  roadEntries,
  createRoadSim,
  vehicleSpec,
  specLength,
  vehicleClassOf,
  CarChord,
} from "@/sim/road";
import { movementsConflict, sameEntryConflict } from "@/sim/roadJunction";
import { carqueue } from "@/levels/test/scenarios/carqueue";
import { carcircle } from "@/levels/test/scenarios/carcircle";
import { overtakeloop } from "@/levels/test/scenarios/overtakeloop";
import { roadcross } from "@/levels/test/scenarios/roadcross";
import {
  roadcross1lane,
  roadcross2lane,
  roadcross3lane,
} from "@/levels/test/scenarios/roadcrosslanes";
import { turnlanes } from "@/levels/test/scenarios/turnlanes";
import { mixedcross, mixedtee } from "@/levels/test/scenarios/mixedjunction";
import { crossturns2lane, crossturns3lane } from "@/levels/test/scenarios/crossturns";
import { roadjunction } from "@/levels/test/scenarios/roadjunction";
import { bigjunction } from "@/levels/test/scenarios/bigjunction";
import { buslane } from "@/levels/test/scenarios/buslane";
import { buscross } from "@/levels/test/scenarios/buscross";
import {
  buscrossboth,
  busmedian,
  busarterial,
  busmedianboth,
  busonewaycross,
  busmegacross,
} from "@/levels/test/scenarios/buscrosses";
import { lanesAllowingExit, carLaneIndices, busLaneIndices, usableExits, turnLandsOnBusLane, isRoadJunction, laneCount, usableLaneIndices } from "@/tiles/lanes";
import { neighborCoord } from "@/sim/topology";
import { parseCoordId } from "@/tiles/model";
import { getCoordinatesId } from "@/utils/tileHelpers";

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
    // Buses settle onto the bus lane and stay there — allow a small margin for the
    // brief lateral ease at spawn, but the strong majority must be on the bus lane.
    expect(onBusLane / busSamples).toBeGreaterThan(0.9);
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

  it("feeds the cross from permitted lanes and turns both ways (F)", () => {
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
          if (!now.has(id)) { if (i < STEPS / 2) firstHalf++; else secondHalf++; }
        }
        prev = now;
      }
      // Cars complete crossings in BOTH halves → never permanently deadlocks.
      expect(firstHalf).toBeGreaterThan(0);
      expect(secondHalf).toBeGreaterThan(0);
      // Far more cars cycled through than the live cap → real flow, not fill-once.
      expect(allIds.size).toBeGreaterThan(cap);
    }, 15000); // 3-lane drives ~2000 heavy steps and sits near the 5s default — give headroom
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

describe("createRoadSim — unequal-lane junctions match the exit lane", () => {
  const B = Position.Bottom;
  const T = Position.Top;
  const L = Position.Left;
  const R = Position.Right;
  // A T-junction at (2,1): a 1-lane road climbs from the south and meets a 3-lane
  // east–west road. A car from the south can only turn left (west) or right (east).
  // West arm: (1,1),(0,1); east arm: (3,1),(4,1) — two tiles each so the car has
  // room to ease into the matched lane after the turn. Spawn ONLY from the south,
  // so every car on an arm came up the 1-lane approach and turned.
  function tLevel(): Level {
    const arm3 = () => ({ connections: [], road: nWayLanes(L, R, 3) });
    return {
      "2,2": { connections: [], road: nWayLanes(T, B, 1) }, // 1-lane south approach
      "1,1": arm3(),
      "0,1": arm3(),
      "3,1": arm3(),
      "4,1": arm3(),
      "2,1": {
        connections: [],
        road: [
          { from: B, to: [L, R], index: 0 }, // 1-lane approach: may turn either way
          { from: L, to: [R], index: 0 },
          { from: L, to: [R], index: 1 },
          { from: L, to: [R], index: 2 },
          { from: R, to: [L], index: 0 },
          { from: R, to: [L], index: 1 },
          { from: R, to: [L], index: 2 },
        ],
      },
    };
  }

  it("fans 1→3: a left-turner reaches the inner lane, a right-turner the kerb lane", () => {
    const sim = createRoadSim({
      level: tLevel(),
      width: 5,
      height: 3,
      seed: 5,
      spawnEntries: [{ coord: { x: 2, y: 2 }, entryPort: B }], // south only
      spawnInterval: 1.0,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 8,
      overtakeFraction: 0, // isolate lane-matching: no overtakers pulling out to pass
    });
    // On the FAR exit tiles, a left-turner (now westbound on (0,1), entered via
    // Right) must have reached the inner lane (2); a right-turner (eastbound on
    // (4,1), entered via Left) the kerb lane (0). Observe each car once it is on the
    // far tile and settled (laneVel ~ 0 is implied by it having had a whole tile).
    let leftInner = 0;
    let leftWrong = 0;
    let rightKerb = 0;
    let rightWrong = 0;
    for (let i = 0; i < 1600; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        const lane = Math.round(c.laneIndex);
        if (f.coord.x === 0 && f.coord.y === 1 && f.entryPort === R) {
          // westbound on the far west tile = turned left at the junction.
          if (lane === 2) leftInner++; else leftWrong++;
        }
        if (f.coord.x === 4 && f.coord.y === 1 && f.entryPort === L) {
          // eastbound on the far east tile = turned right at the junction.
          if (lane === 0) rightKerb++; else rightWrong++;
        }
      }
    }
    // Both turns happened, and each landed in its matching exit lane — the left-
    // turner actually reached lane 2 (proving 1→3 fan-out, not the old pile-into-0).
    expect(leftInner).toBeGreaterThan(20);
    expect(rightKerb).toBeGreaterThan(20);
    expect(leftWrong).toBe(0);
    expect(rightWrong).toBe(0);
  });

  it("routes buses onto a kerb bus lane through a junction; cars stay off it", () => {
    // Same T, but the east arm's kerb lane is a bus lane (index 0) + 2 car lanes.
    // A right-turner kerb-aligns: a bus lands on the bus lane, a car on the lowest
    // CAR lane (1) — never the bus lane — even though it crossed a junction to get
    // there.
    const busArm = (): { connections: []; road: import("@/tiles/lanes").Lane[] } => ({
      connections: [],
      road: [
        { from: L, to: [R], index: 0, kind: "bus" },
        { from: L, to: [R], index: 1 },
        { from: L, to: [R], index: 2 },
        { from: R, to: [L], index: 0, kind: "bus" },
        { from: R, to: [L], index: 1 },
        { from: R, to: [L], index: 2 },
      ],
    });
    const lvl = tLevel();
    lvl["3,1"] = busArm();
    lvl["4,1"] = busArm();
    const sim = createRoadSim({
      level: lvl,
      width: 5,
      height: 3,
      seed: 8,
      spawnEntries: [{ coord: { x: 2, y: 2 }, entryPort: B }],
      spawnInterval: 0.8,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 8,
      mix: { car: 1, bus: 1 },
    });
    let busOnBusLane = 0;
    let carOnBusLane = 0;
    let carSamples = 0;
    for (let i = 0; i < 1800; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        if (f.coord.x !== 4 || f.coord.y !== 1 || f.entryPort !== L) continue; // far east, right-turners
        const lane = Math.round(c.laneIndex);
        if (c.units[0].part === "bus") {
          if (lane === 0) busOnBusLane++;
        } else {
          carSamples++;
          if (lane === 0) carOnBusLane++;
        }
      }
    }
    expect(carSamples).toBeGreaterThan(20); // cars did turn right onto the bus arm
    expect(carOnBusLane).toBe(0); // and none ever rode the kerb bus lane
    expect(busOnBusLane).toBeGreaterThan(10); // buses used the bus lane through the junction
  });

  it("buscross scenario: buses hold the bus lane through the cross, cars never do", () => {
    // Drive the actual /test/buscross scenario (a 4-way cross whose east–west main
    // road has a kerb bus lane). On the far-east through tile (4,2), eastbound
    // vehicles have crossed the junction: every bus must be on the bus lane (0),
    // and no car may ever be — the cross-lane fix keeps the classes apart across
    // the intersection too.
    const sim = createRoadSim({
      level: buscross.level,
      width: buscross.size!.cols,
      height: buscross.size!.rows,
      seed: 6,
      spawnInterval: 0.6,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 12,
      mix: buscross.traffic!.mix,
    });
    let busOnBus = 0;
    let busOffBus = 0;
    let carOnBus = 0;
    let carSamples = 0;
    // Only THROUGH buses must hold the bus lane: a bus that TURNED IN from the
    // side road legitimately lands on its movement's landing lane and changes
    // onto the bus lane when a gap allows. Track who was already eastbound on
    // the western approach (x ≤ 1) — those crossed straight through.
    const throughEast = new Set<string>();
    for (let i = 0; i < 1800; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        if (f.entryPort === Position.Left && f.coord.y === 2 && f.coord.x <= 1) {
          throughEast.add(c.id);
        }
        if (f.coord.x !== 4 || f.coord.y !== 2 || f.entryPort !== Position.Left) continue;
        const lane = Math.round(c.laneIndex);
        if (c.units[0].part === "bus") {
          if (lane === 0) busOnBus++;
          else if (throughEast.has(c.id)) busOffBus++;
        } else {
          carSamples++;
          if (lane === 0) carOnBus++;
        }
      }
    }
    expect(busOnBus).toBeGreaterThan(20); // buses ran the through road on the bus lane
    expect(busOffBus).toBe(0); // a THROUGH bus was never off it past the cross
    expect(carSamples).toBeGreaterThan(20); // cars ran the through road too
    expect(carOnBus).toBe(0); // and never strayed onto the bus lane across the cross
  });

  it("buscross scenario: the kerb bus lane feeds a turn, and buses take it", () => {
    // The user flagged that bus lanes looked turn-locked. They are not: the kerb
    // bus lane at the cross feeds the natural right turn off the main road, and
    // buses physically leave the main road onto the 1-lane side road.
    const centre = buscross.level["2,2"].road;
    // Eastbound (L→…) bus lane: straight (R) AND the right turn (B, south).
    const eastExits = usableExits(centre, Position.Left, "bus");
    expect(eastExits).toContain(Position.Right); // straight still allowed
    expect(eastExits).toContain(Position.Bottom); // right turn now allowed
    // Westbound (R→…) bus lane: straight (L) AND the right turn (T, north).
    const westExits = usableExits(centre, Position.Right, "bus");
    expect(westExits).toContain(Position.Left);
    expect(westExits).toContain(Position.Top);

    // And it happens in the running sim: buses reach the side-road arms, which
    // are only fed from the cross (a bus there either turned off the main road
    // or ran the side road — either way buses are not confined to the through
    // road). At least one bus must be observed on a side-road tile.
    const sim = createRoadSim({
      level: buscross.level,
      width: buscross.size!.cols,
      height: buscross.size!.rows,
      seed: 6,
      spawnInterval: 0.6,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 12,
      mix: buscross.traffic!.mix,
    });
    let busesOnSideRoad = 0;
    for (let i = 0; i < 1800; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        if (c.units[0].part !== "bus") continue;
        const f = c.units[0].front;
        if (f.coord.x === 2 && (f.coord.y === 1 || f.coord.y === 3)) busesOnSideRoad++;
      }
    }
    expect(busesOnSideRoad).toBeGreaterThan(0);
  });

  it("same-arm crossing movements never share the junction (car right-turn vs bus straight)", () => {
    // User-reported on buscrossboth: a bus on the kerb bus lane (index 0) goes
    // STRAIGHT while a car from the inner lane (index 1) of the SAME arm turns
    // RIGHT — the right turn sweeps across the bus lane, and the two drove over
    // each other. Movements from the same entry were hard-coded as never
    // conflicting (a single-lane-era assumption), so nothing serialized them.
    // Assert: at no tick are two vehicles simultaneously on the junction tile
    // having entered from the SAME arm where one goes straight/left and the
    // other turns right from a more inner lane (the kerb-crossing combo).
    const sim = createRoadSim({
      level: buscrossboth.level,
      width: buscrossboth.size!.cols,
      height: buscrossboth.size!.rows,
      seed: 3,
      spawnInterval: 0.45,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 14,
      mix: buscrossboth.traffic!.mix,
    });
    let overlaps = 0;
    for (let i = 0; i < 4000; i++) {
      sim.step(0.05, () => false);
      const onJunction = sim
        .sample()
        .filter(c => {
          const f = c.units[0].front;
          return f.coord.x === 2 && f.coord.y === 2 && f.exitPort !== null;
        });
      for (let a = 0; a < onJunction.length; a++) {
        for (let b = a + 1; b < onJunction.length; b++) {
          const fa = onJunction[a].units[0].front;
          const fb = onJunction[b].units[0].front;
          if (fa.entryPort !== fb.entryPort) continue; // same-arm pairs only
          // Their paths cross exactly when the lateral order inverts (the same
          // predicate the sim now enforces): e.g. an inner-lane right turn over
          // a kerb-lane straight. A kerb bus turning right beside an inner
          // straight car is parallel and legitimately concurrent.
          if (
            sameEntryConflict(
              fa.entryPort,
              fa.exitPort!,
              Math.round(onJunction[a].laneIndex),
              fb.exitPort!,
              Math.round(onJunction[b].laneIndex),
            )
          )
            overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);
  }, 30000);

  it("merging movements landing on the SAME exit lane never overlap (yield-and-slot)", () => {
    // User-reported: vehicles from DIFFERENT arms exiting onto the same arm can
    // overlap when they land on the same lane (e.g. a westbound straight car and
    // a south left-turner both landing the west arm's car lane). Merging is
    // yield-and-slot: they MAY share the junction (the later one trails the
    // earlier through the merge point), but their bodies must never overlap in
    // the shared distance-to-exit-edge coordinate. Merging onto DIFFERENT lanes
    // (bus → bus lane beside car → car lane) is unconstrained.
    const sim = createRoadSim({
      level: buscrossboth.level,
      width: buscrossboth.size!.cols,
      height: buscrossboth.size!.rows,
      seed: 5,
      spawnInterval: 0.45,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 14,
      mix: buscrossboth.traffic!.mix,
    });
    const centre = buscrossboth.level["2,2"].road;
    let overlaps = 0;
    for (let i = 0; i < 4000; i++) {
      sim.step(0.05, () => false);
      const onJunction = sim.sample().filter(c => {
        const f = c.units[0].front;
        return f.coord.x === 2 && f.coord.y === 2 && f.exitPort !== null;
      });
      for (let a = 0; a < onJunction.length; a++) {
        for (let b = a + 1; b < onJunction.length; b++) {
          const A = onJunction[a];
          const B = onJunction[b];
          const fa = A.units[0].front;
          const fb = B.units[0].front;
          if (fa.entryPort === fb.entryPort) continue; // same-arm covered elsewhere
          if (fa.exitPort !== fb.exitPort) continue; // merges only
          const exit = fa.exitPort!;
          const arm = buscrossboth.level[
            `${2 + (exit === Position.Right ? 1 : exit === Position.Left ? -1 : 0)},${
              2 + (exit === Position.Bottom ? 1 : exit === Position.Top ? -1 : 0)
            }`
          ].road;
          const ap = oppositePort(exit);
          const la = junctionExitLane(
            centre, fa.entryPort, Math.round(A.laneIndex), exit, arm, ap,
            A.units[0].part === "bus" ? "bus" : "car",
          );
          const lb = junctionExitLane(
            centre, fb.entryPort, Math.round(B.laneIndex), exit, arm, ap,
            B.units[0].part === "bus" ? "bus" : "car",
          );
          if (la !== lb) continue; // different landing lanes: unconstrained
          // Body interval in distance-to-exit-edge space: front sits 1−t before
          // the shared exit edge; a rear coupler still on the approach tile means
          // the body extends back to (at least) the junction's entry edge (d=1).
          const span = (c: (typeof onJunction)[number]) => {
            const front = 1 - c.units[0].front.t;
            const rearOnJ =
              c.units[0].rear.coord.x === 2 && c.units[0].rear.coord.y === 2;
            const rear = rearOnJ ? 1 - c.units[0].rear.t : 1;
            return [front, rear] as const; // front <= rear in this coordinate
          };
          const [af, ar] = span(A);
          const [bf, br] = span(B);
          const eps = 1e-6;
          // d-interval intersection mid-tile across DIFFERENT arms is benign
          // (the curves haven't converged yet); a real clash is an intersection
          // inside the CONVERGED zone next to the shared exit edge, where both
          // paths are already on the same line.
          const CONVERGED = 0.25; // tile-distance from the exit edge
          const lo = Math.max(af, bf);
          const hi = Math.min(ar, br);
          if (lo < hi - eps && lo < CONVERGED) overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);
  }, 30000);

  it("overtakeloop: a ramp car lands ON its merge lane — no dip to the kerb and back", () => {
    // User-reported: a car merging from the on-ramp (T→R, a left-side merge whose
    // landing lane is the INNER lane 2 of the 3-lane road) visibly snapped to the
    // kerb lane 0 at the seam and then drifted back across. The turn glide
    // physically delivers the car onto lane 2, so its sim lane must START there:
    // on its first samples past the merge tile the car sits on lane 2 and never
    // dips below lane 1 in the immediate aftermath (overtaking may move it later).
    const sim = createRoadSim({
      level: overtakeloop.level,
      width: overtakeloop.size!.cols,
      height: overtakeloop.size!.rows,
      seed: 9,
      spawnInterval: overtakeloop.traffic!.spawnInterval,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 4, // few cars: isolate the merge, no overtaking pressure
      overtakeFraction: 0,
      spawnEntries: overtakeloop.traffic!.spawnEntries,
    });
    // Track each car's lane over its first moments on the tile after the merge
    // (4,1 entered via Left). Every car comes from the ramp (sole spawn entry).
    const firstLanes = new Map<string, number[]>();
    for (let i = 0; i < 1200; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        if (f.coord.x !== 4 || f.coord.y !== 1 || f.entryPort !== Position.Left) continue;
        if (f.t > 0.6) continue; // only the entry stretch right past the seam
        const arr = firstLanes.get(c.id) ?? [];
        if (arr.length < 12) arr.push(c.laneIndex);
        firstLanes.set(c.id, arr);
      }
    }
    const merged = [...firstLanes.values()].filter(a => a.length > 0);
    expect(merged.length).toBeGreaterThan(0); // ramp cars did pass the merge
    for (const lanes of merged) {
      expect(Math.round(lanes[0])).toBe(2); // arrives ON the inner landing lane
      for (const l of lanes) expect(l).toBeGreaterThan(1.5); // and never dips kerb-ward
    }
  }, 30000);

  it("carcircle: feed roads zipper into the loop — the carousel keeps moving", () => {
    // User-reported: merge exclusion blocked the carcircle feeds a whole tile
    // early and stuttered the loop. Merging is yield-and-slot now, so once the
    // loop has filled, traffic must keep flowing: across the measurement window
    // a healthy majority of cars are in motion on average, and the loop never
    // freezes outright (every car stopped) for long.
    const sim = createRoadSim({
      level: carcircle.level,
      width: carcircle.size!.cols,
      height: carcircle.size!.rows,
      seed: 2,
      spawnInterval: carcircle.traffic!.spawnInterval,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: carcircle.traffic!.maxCars,
      spawnEntries: carcircle.traffic!.spawnEntries,
    });
    for (let i = 0; i < 1200; i++) sim.step(0.05, () => false); // fill the loop
    expect(sim.cars().length).toBeGreaterThanOrEqual(8);
    let movingFraction = 0;
    let frozenTicks = 0;
    const WINDOW = 1200;
    for (let i = 0; i < WINDOW; i++) {
      sim.step(0.05, () => false);
      const cars = sim.cars();
      const moving = cars.filter(c => c.velocity > 0.001).length;
      movingFraction += moving / Math.max(1, cars.length);
      if (moving === 0 && cars.length > 0) frozenTicks++;
    }
    movingFraction /= WINDOW;
    expect(movingFraction).toBeGreaterThan(0.5); // the carousel flows
    expect(frozenTicks).toBeLessThan(WINDOW * 0.05); // and never seizes up
  }, 30000);

  it("a committed turner is not frozen mid-junction by a non-conflicting cross stream", () => {
    // Regression (user-reported): in buscrossboth a car from the south turning
    // LEFT (B→L) stopped ON the cross while a bus ran straight R→L — though
    // B→L and R→L don't conflict (they merge into different lanes). Cause: when
    // the head enters the junction its routePlan turn is CONSUMED, and the
    // per-body conflict gate then re-derived the movement via the consumed plan's
    // fallback — assuming STRAIGHT (B→T), which DOES conflict with R→L. The gate
    // must use the car's own committed path segment (exact exit) instead.
    //
    // Keep traffic light (maxCars 4) so exit arms never queue back into the
    // junction — then a vehicle standing still ON the junction tile for longer
    // than the launch-reaction delay can only be a phantom conflict.
    const sim = createRoadSim({
      level: buscrossboth.level,
      width: buscrossboth.size!.cols,
      height: buscrossboth.size!.rows,
      seed: 11,
      spawnInterval: 0.5,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 4,
      mix: buscrossboth.traffic!.mix,
    });
    const stoppedOnJunction = new Map<string, number>(); // car id -> consecutive stopped ticks
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      sim.step(0.05, () => false);
      const stopped = new Set(
        sim.cars().filter(c => c.velocity <= 0.001 && c.tileId === "2,2").map(c => c.id),
      );
      for (const id of stopped) {
        const n = (stoppedOnJunction.get(id) ?? 0) + 1;
        stoppedOnJunction.set(id, n);
        worst = Math.max(worst, n);
      }
      for (const id of [...stoppedOnJunction.keys()]) {
        if (!stopped.has(id)) stoppedOnJunction.delete(id);
      }
    }
    // 0.05s ticks: allow the 0.6s launch-reaction delay plus margin (1.5s), but a
    // car frozen for a whole bus crossing (several seconds) must fail.
    expect(worst).toBeLessThanOrEqual(30);
  });

  it("a bus turning where the bus lane can't does not oscillate between lanes", () => {
    // In buscross the kerb bus lane permits straight + right only; a LEFT turn must
    // come from the inner car lane. A bus turning left therefore has to leave the
    // bus lane — and must STAY left, not get yanked back onto the bus lane every
    // tick (the oscillation bug). Track each westbound bus's rounded lane on the
    // west approach tiles (x 0,1): a clean change is 0→1 once; oscillation flips
    // back and forth many times.
    const sim = createRoadSim({
      level: buscross.level,
      width: buscross.size!.cols,
      height: buscross.size!.rows,
      seed: 4,
      spawnInterval: 0.6,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 12,
      mix: buscross.traffic!.mix,
    });
    const hist = new Map<string, { last: number; changes: number; reachedInner: boolean }>();
    for (let i = 0; i < 2400; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        if (c.units[0].part !== "bus") continue;
        const f = c.units[0].front;
        if (f.entryPort !== Position.Left || f.coord.x > 1) continue; // westbound approach only
        const lane = Math.round(c.laneIndex);
        const h = hist.get(c.id) ?? { last: lane, changes: 0, reachedInner: false };
        if (lane !== h.last) h.changes++;
        h.last = lane;
        if (lane >= 1) h.reachedInner = true;
        hist.set(c.id, h);
      }
    }
    const movers = [...hist.values()].filter(h => h.reachedInner);
    expect(movers.length).toBeGreaterThan(0); // some bus did leave the bus lane to turn
    // No bus flips lanes more than a couple of times (a settle, not an oscillation).
    const worst = Math.max(...[...hist.values()].map(h => h.changes));
    expect(worst).toBeLessThanOrEqual(3);
  });
});

describe("bus-lane crosses flow and keep cars off the bus lane", () => {
  // Drive each /test bus-cross scenario end-to-end. On the ARM tiles (not the
  // junction centre, where lanes map through turns) assert the class invariant:
  // a car NEVER drives on a bus lane, and buses DO use the bus lane — whether the
  // bus lane is the kerb (index 0) or the median (inner) lane. Plus: traffic
  // actually flows through (cars complete) with no broken positions or gridlock.
  const drive = (
    scenario: { level: Level; size?: { cols: number; rows: number }; traffic?: { mix?: Record<string, number> } },
    centre: { x: number; y: number },
    seed: number,
  ) => {
    const sim = createRoadSim({
      level: scenario.level,
      width: scenario.size!.cols,
      height: scenario.size!.rows,
      seed,
      spawnInterval: 0.6,
      carSpeed: 0.5,
      carLength: 0.2,
      maxCars: 14,
      mix: scenario.traffic?.mix,
    });
    let prev = new Set<string>();
    const completed = new Set<string>();
    let carOnBus = 0;
    let busOnBus = 0;
    let busSamples = 0;
    let badPos = 0;
    let stuck = 0;
    for (let i = 0; i < 1600; i++) {
      sim.step(0.05, () => false);
      const now = new Set(sim.cars().map(c => c.id));
      for (const id of prev) if (!now.has(id)) completed.add(id);
      prev = now;
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        if (!Number.isFinite(f.t) || (f.lanePos != null && !Number.isFinite(f.lanePos))) badPos++;
        if (f.coord.x === centre.x && f.coord.y === centre.y) continue; // skip the junction tile
        const road = scenario.level[`${f.coord.x},${f.coord.y}`]?.road;
        const busLanes = busLaneIndices(road, f.entryPort);
        if (busLanes.length === 0) continue;
        const onBus = busLanes.includes(Math.round(c.laneIndex));
        if (c.units[0].part === "bus") {
          busSamples++;
          if (onBus) busOnBus++;
        } else if (onBus) {
          carOnBus++;
        }
      }
      const cars = sim.cars();
      if (cars.length >= 3 && cars.every(c => c.velocity < 0.001)) stuck++;
    }
    return { completed: completed.size, carOnBus, busOnBus, busSamples, badPos, stuck };
  };

  const cases: [string, { level: Level; size?: { cols: number; rows: number }; traffic?: { mix?: Record<string, number> } }][] = [
    ["buscrossboth", buscrossboth],
    ["busmedian", busmedian],
    ["busarterial", busarterial],
    ["busmedianboth", busmedianboth],
    ["busonewaycross", busonewaycross],
    ["busmegacross", busmegacross],
  ];

  for (const [name, scenario] of cases) {
    it(`${name}: cars never use a bus lane, buses do, and traffic flows`, () => {
      const r = drive(scenario, { x: 2, y: 2 }, 7);
      expect(r.badPos).toBe(0); // no broken/non-finite positions
      expect(r.completed).toBeGreaterThan(5); // sustained flow through the cross
      expect(r.stuck).toBeLessThan(80); // no permanent gridlock
      expect(r.busSamples).toBeGreaterThan(20); // buses actually ran the arms
      expect(r.busOnBus).toBeGreaterThan(0); // and used their bus lane
      expect(r.carOnBus).toBe(0); // a car NEVER drove on a bus lane on the arms
    });
  }
});

describe("bus-lane overlay colours a junction movement by where it LANDS", () => {
  // The debug overlay (Tile.vue) paints an arrow amber only when the movement
  // lands on a real bus lane on the EXIT arm — the rule lives in
  // `turnLandsOnBusLane`, shared by game.ts + the editor. Regression for #18: a
  // median bus turning right onto a car-only arm (busmegacross W→S) was painted
  // amber even though the bus lands on a CAR lane there. Drive the shared rule
  // against every shipped bus-cross centre so an amber arrow can never again be
  // drawn onto a lane the bus doesn't occupy as a bus lane.
  const T = Position.Top;
  const R = Position.Right;
  const B = Position.Bottom;
  const L = Position.Left;
  // The exit arm's road for a movement leaving the centre tile (2,2) via `exit`.
  const armRoad = (level: Level, exit: Position) =>
    level[
      `${2 + (exit === R ? 1 : exit === L ? -1 : 0)},${
        2 + (exit === B ? 1 : exit === T ? -1 : 0)
      }`
    ]?.road;

  const family: [string, typeof buscross][] = [
    ["buscross", buscross],
    ["buscrossboth", buscrossboth],
    ["busmedian", busmedian],
    ["busarterial", busarterial],
    ["busmedianboth", busmedianboth],
    ["busonewaycross", busonewaycross],
    ["busmegacross", busmegacross],
  ];

  it("every amber bus movement lands on a bus lane; car-lane fallbacks exist (cyan)", () => {
    let amber = 0;
    let fallback = 0;
    for (const [, scn] of family) {
      const centre = scn.level["2,2"].road;
      for (const lane of centre!) {
        if (lane.kind !== "bus") continue; // only bus-lane approaches go amber
        for (const to of lane.to) {
          const exitRoad = armRoad(scn.level, to);
          const exitApproach = oppositePort(to);
          if (turnLandsOnBusLane(centre, lane.from, lane.index, to, exitRoad, exitApproach, "bus")) {
            amber++;
            // Honesty: an amber arrow really ends on a bus lane of the exit arm.
            const landing = junctionExitLane(
              centre, lane.from, lane.index, to, exitRoad, exitApproach, "bus",
            );
            expect(busLaneIndices(exitRoad, exitApproach)).toContain(landing);
          } else {
            fallback++; // a bus movement that lands on a car lane → rendered cyan
          }
        }
      }
    }
    expect(amber).toBeGreaterThan(0); // amber is still used where it's earned
    expect(fallback).toBeGreaterThan(0); // and the buggy class (car-lane fallback) is present
  });

  it("busmegacross: the median bus's right turn onto the car-only south arm is NOT amber", () => {
    // W median bus lane (from L, index 1) turning to the south (B). The south arm
    // is a 2-lane one-way OUTBOUND with no bus lane — the original phantom amber.
    const centre = busmegacross.level["2,2"].road;
    const south = armRoad(busmegacross.level, B);
    expect(
      turnLandsOnBusLane(centre, L, 1, B, south, oppositePort(B), "bus"),
    ).toBe(false);
  });

  it("busmedianboth: a median bus left turn lands on the cross street's median bus lane (amber)", () => {
    // The positive case: median→median is a true bus-lane-to-bus-lane movement.
    const centre = busmedianboth.level["2,2"].road;
    const north = armRoad(busmedianboth.level, T);
    expect(
      turnLandsOnBusLane(centre, L, 1, T, north, oppositePort(T), "bus"),
    ).toBe(true);
  });
});

describe("unequal-arm junctions: every car movement lands on a real exit lane", () => {
  // Companion to the bus-side landing guarantee (#18): on junctions whose arms
  // carry different lane counts, every CAR movement that fans onto a wider arm or
  // merges onto a narrower one must resolve to a CONCRETE lane that actually
  // exists on the exit arm — never an index ≥ the arm's lane count. The sim drives
  // the car to `junctionExitLane(...)` when it crosses out of a junction
  // (road.ts), and the debug overlay arrow ends at that same lane
  // (`roadTurnExitOffsetPx` → `junctionExitOffsetPx` → `junctionExitLane`), so
  // pinning the landing lane here locks BOTH the routing and the overlay to a real
  // lane. Regression coverage for #26 across every shipped unequal-arm scenario.
  const family: [string, Level][] = [
    ["mixedcross", mixedcross.level],
    ["mixedtee", mixedtee.level],
    ["crossturns2lane", crossturns2lane.level],
    ["crossturns3lane", crossturns3lane.level],
    ["roadjunction", roadjunction.level],
    ["bigjunction", bigjunction.level],
  ];

  // Every (junction tile, car approach lane, permitted exit) movement in a level,
  // paired with the exit arm's road and the port the car enters it through. Only
  // junction tiles (a real routing choice) and car-usable approach lanes are
  // walked — the case where junctionExitLane must fan/merge onto the exit arm.
  function carMovements(level: Level) {
    const out: {
      coordId: string;
      from: Position;
      index: number;
      exit: Position;
      exitRoad: ReturnType<typeof mixedcross.level[string]["road"]> | undefined;
      exitApproach: Position;
    }[] = [];
    for (const [coordId, cell] of Object.entries(level)) {
      const road = cell.road;
      if (!isRoadJunction(road)) continue;
      const coord = parseCoordId(coordId);
      for (const lane of road!) {
        if (lane.kind === "bus") continue; // a car can't take a bus-only approach lane
        for (const exit of lane.to) {
          const next = neighborCoord(coord, exit);
          if (!next) continue;
          out.push({
            coordId,
            from: lane.from,
            index: lane.index,
            exit,
            exitRoad: level[getCoordinatesId(next)]?.road,
            exitApproach: oppositePort(exit),
          });
        }
      }
    }
    return out;
  }

  for (const [name, level] of family) {
    it(`${name}: every car turn/cross resolves to a real car lane on the exit arm`, () => {
      const moves = carMovements(level);
      expect(moves.length).toBeGreaterThan(0); // the scenario actually has junction movements
      for (const m of moves) {
        const carLanesOut = carLaneIndices(m.exitRoad, m.exitApproach);
        // The exit arm must offer the car a lane at all — no car movement may fan
        // onto an arm with no car lane (that would be an un-takeable movement).
        expect(
          carLanesOut.length,
          `${name} ${m.coordId} ${m.from}#${m.index}→${m.exit}: exit arm has no car lane`,
        ).toBeGreaterThan(0);
        const landing = junctionExitLane(
          level[m.coordId].road,
          m.from,
          m.index,
          m.exit,
          m.exitRoad,
          m.exitApproach,
          "car",
        );
        // The landing index must be a CONCRETE lane of the exit arm: present in
        // its car-usable lane set and strictly below its lane count (never an
        // off-the-edge index the car/overlay would draw outside the road).
        expect(
          carLanesOut,
          `${name} ${m.coordId} ${m.from}#${m.index}→${m.exit}: landing ${landing} is not a real car lane of ${JSON.stringify(carLanesOut)}`,
        ).toContain(landing);
        expect(landing).toBeLessThan(laneCount(m.exitRoad, m.exitApproach));
        // And the car may legally drive in the lane it lands on (not a bus lane).
        expect(usableLaneIndices(m.exitRoad, m.exitApproach, "car")).toContain(landing);
      }
    });
  }
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

describe("mixed-lane junctions route end-to-end", () => {
  // Drive a junction whose arms have different lane counts and confirm cars
  // actually flow THROUGH the centre and off the far side — i.e. every connection
  // works, with no permanent gridlock and no broken (NaN / off-grid) position.
  const drive = (
    scenario: { level: Level; size?: { cols: number; rows: number } },
    centre: { x: number; y: number },
    seed: number,
  ) => {
    const sim = createRoadSim({
      level: scenario.level,
      width: scenario.size!.cols,
      height: scenario.size!.rows,
      seed,
      spawnInterval: 0.5,
      maxCars: 16,
    });
    let prev = new Set<string>();
    const completed = new Set<string>();
    let throughCentre = 0;
    let badPos = 0;
    let allStuckTicks = 0;
    for (let i = 0; i < 1600; i++) {
      sim.step(0.05, () => false);
      const now = new Set(sim.cars().map(c => c.id));
      for (const id of prev) if (!now.has(id)) completed.add(id);
      prev = now;
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        // A broken sample = non-finite progress or lateral lane position.
        if (!Number.isFinite(f.t) || (f.lanePos != null && !Number.isFinite(f.lanePos))) badPos++;
        if (f.coord.x === centre.x && f.coord.y === centre.y) throughCentre++;
      }
      const cars = sim.cars();
      if (cars.length >= 3 && cars.every(c => c.velocity < 0.001)) allStuckTicks++;
    }
    return { completed: completed.size, throughCentre, badPos, allStuckTicks };
  };

  it("mixedcross (1/2/3/2 arms): cars cross the centre and exit, no gridlock", () => {
    const r = drive(mixedcross, { x: 3, y: 3 }, 7);
    expect(r.badPos).toBe(0); // no broken positions
    expect(r.throughCentre).toBeGreaterThan(0); // cars actually traverse the junction
    expect(r.completed).toBeGreaterThan(10); // sustained flow off the far side
    expect(r.allStuckTicks).toBeLessThan(80); // no permanent deadlock
  });

  it("mixedtee (3-lane road, 2-lane spur): cars cross the centre and exit, no gridlock", () => {
    const r = drive(mixedtee, { x: 3, y: 2 }, 4);
    expect(r.badPos).toBe(0);
    expect(r.throughCentre).toBeGreaterThan(0);
    expect(r.completed).toBeGreaterThan(10);
    expect(r.allStuckTicks).toBeLessThan(80);
  });
});
