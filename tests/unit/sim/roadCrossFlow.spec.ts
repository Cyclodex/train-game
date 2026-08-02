import { describe, it, expect } from "vitest";
import { itSlow } from "../support/tier";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { fromPairs, turns } from "@/tiles/lanes";
import { createRoadSim, CarChord } from "@/sim/road";
import { movementsConflict } from "@/sim/roadJunction";
import { roadcross } from "@/levels/test/scenarios/roadcross";
import {
  roadcross1lane,
  roadcross2lane,
  roadcross3lane,
} from "@/levels/test/scenarios/roadcrosslanes";
import { mixedcross, mixedtee } from "@/levels/test/scenarios/mixedjunction";
import { bigjunction } from "@/levels/test/scenarios/bigjunction";

// CROSSES THAT KEEP FLOWING — junction arbitration and turn restrictions.
//
// Split out of road.spec.ts (2026-08-01) — see roadExitLanes.spec.ts for why.
// Pure moves.
//
// Where roadExitLanes.spec.ts asks WHICH LANE a movement lands in, this file
// asks whether traffic gets through at all: the interlock (no two conflicting
// movements in the box at once), sustained throughput from every arm, and the
// turn-restricted crosses where a banned movement must never be taken.

// A vehicle samples as one render box per body segment (cab + trailer for a
// semi); these grab the whole-body front/rear ends used by the queueing tests.
// Every car here uses the default all-cars mix, so each is a single segment.
const bodyFront = (c: CarChord) => c.units[0].front;
const bodyRear = (c: CarChord) => c.units[c.units.length - 1].rear;

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
      // Every reported occupant is a real, currently-live car (the value
      // lists ALL bodies in the box, space-separated).
      const liveIds = new Set(sim.cars().map(c => c.id));
      for (const id of ids)
        for (const cid of held[id].split(" ")) expect(liveIds.has(cid)).toBe(true);
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
    itSlow(`${scn.id}: sustained throughput from every arm, no gridlock`, () => {
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

  itSlow("mixedcross (1/2/3/2 arms): cars cross the centre and exit, no gridlock", () => {
    const r = drive(mixedcross, { x: 3, y: 3 }, 7);
    expect(r.badPos).toBe(0); // no broken positions
    expect(r.throughCentre).toBeGreaterThan(0); // cars actually traverse the junction
    expect(r.completed).toBeGreaterThan(10); // sustained flow off the far side
    expect(r.allStuckTicks).toBeLessThan(80); // no permanent deadlock
  });

  itSlow("mixedtee (3-lane road, 2-lane spur): cars cross the centre and exit, no gridlock", () => {
    const r = drive(mixedtee, { x: 3, y: 2 }, 4);
    expect(r.badPos).toBe(0);
    expect(r.throughCentre).toBeGreaterThan(0);
    expect(r.completed).toBeGreaterThan(10);
    expect(r.allStuckTicks).toBeLessThan(80);
    // ~3.3s on its own on a fast machine — the 5s default has no headroom left
    // on a shared CI runner under the parallel suite (timed out there at 5s).
    // A timeout here is the machine, never the code — what this test guards
    // (gridlock) shows up as `allStuckTicks`, which is a count, not a clock.
  }, 30_000);

  itSlow("bigjunction (4-way × 3-lane dedicated turn lanes): cars cross the centre and exit, no gridlock", () => {
    // The largest unequal-movement junction in the epic (#16 acceptance criterion):
    // 12 directed lanes, each wired to exactly one exit (kerb→right, middle→straight,
    // inner→left) on all four 3-lane arms. Drive it under load (maxCars 16, the
    // `drive` default, well above the scenario's own cap of 12) and confirm cars
    // sort, cross the centre, and clear off the far side without locking up.
    const r = drive(bigjunction, { x: 3, y: 3 }, 7);
    expect(r.badPos).toBe(0); // no broken positions through the dedicated turn lanes
    expect(r.throughCentre).toBeGreaterThan(0); // cars actually traverse the crossroads
    expect(r.completed).toBeGreaterThan(10); // sustained flow off the far side
    expect(r.allStuckTicks).toBeLessThan(80); // no permanent deadlock under load
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
