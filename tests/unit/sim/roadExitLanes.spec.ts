import { describe, it, expect } from "vitest";
import { itSlow } from "../support/tier";
import { Position } from "@/types";
import { Level, parseCoordId } from "@/tiles/model";
import {
  fromPairs,
  nWayLanes,
  junctionExitLane,
  carLaneIndices,
  usableExits,
  isRoadJunction,
  laneCount,
  usableLaneIndices,
} from "@/tiles/lanes";
import { oppositePort, neighborCoord } from "@/sim/topology";
import { createRoadSim } from "@/sim/road";
import { sameEntryConflict } from "@/sim/roadJunction";
import { carcircle } from "@/levels/test/scenarios/carcircle";
import { overtakeloop } from "@/levels/test/scenarios/overtakeloop";
import { mixedcross, mixedtee } from "@/levels/test/scenarios/mixedjunction";
import { crossturns2lane, crossturns3lane } from "@/levels/test/scenarios/crossturns";
import { roadjunction } from "@/levels/test/scenarios/roadjunction";
import { bigjunction } from "@/levels/test/scenarios/bigjunction";
import { buscross } from "@/levels/test/scenarios/buscross";
import { buscrossboth } from "@/levels/test/scenarios/buscrosses";
import { getCoordinatesId } from "@/utils/tileHelpers";

// JUNCTION EXIT-LANE MATCHING — which lane a movement LANDS in.
//
// Split out of road.spec.ts (2026-08-01), which had grown to 3k lines and 27
// top-level describes. One spec file is one vitest worker, so that single file
// set the whole suite's wall-clock floor; these are pure moves, byte for byte.
//
// The question this file asks: a car crossing a junction whose arms have
// DIFFERENT lane counts has to come out somewhere real — a 1->3 fans out, a 3->1
// merges, and a turn lands in the lane its direction implies. See
// `junctionExitLane` in tiles/lanes.ts, and docs/KNOWHOW.md -> JUNCTIONS.

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

  itSlow("same-arm crossing movements never share the junction (car right-turn vs bus straight)", () => {
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

  itSlow("merging movements landing on the SAME exit lane never overlap (yield-and-slot)", () => {
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

  itSlow("a bus turning where the bus lane can't does not oscillate between lanes", () => {
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
      exitRoad: Level[string]["road"];
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
