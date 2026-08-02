import { describe, it, expect } from "vitest";
import { itSlow } from "../support/tier";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { fromPairs } from "@/tiles/lanes";
import { createRoadSim, RoadEntry } from "@/sim/road";
import { JunctionSignal } from "@/sim/junctionSignal";

const { Top, Right, Bottom, Left } = Position;
const NO_CROSSING = () => false;

// A 4-way signalised road cross (the signalcross scenario shape): a horizontal and
// a vertical road meeting at the centre (2,2), which carries an all-turns road +
// the given `signal`. Open at all four map edges so cars spawn from every arm.
function cross(signal: JunctionSignal): Level {
  const road = (...ports: [Position, Position][]): Level[string] => ({
    connections: [],
    road: fromPairs(ports),
  });
  return {
    "0,2": road([Left, Right]),
    "1,2": road([Left, Right]),
    "3,2": road([Left, Right]),
    "4,2": road([Left, Right]),
    "2,0": road([Top, Bottom]),
    "2,1": road([Top, Bottom]),
    "2,3": road([Top, Bottom]),
    "2,4": road([Top, Bottom]),
    "2,2": {
      ...road(
        [Left, Right],
        [Top, Bottom],
        [Left, Top],
        [Left, Bottom],
        [Right, Top],
        [Right, Bottom],
      ),
      signal,
    },
  };
}

// The junction arm a car enters through when it moves from `prevId` onto the
// junction tile (the junction port facing the previous tile), or null if the
// previous tile is not orthogonally adjacent.
function entryArm(juncId: string, prevId: string): Position | null {
  const [jx, jy] = juncId.split(",").map(Number);
  const [px, py] = prevId.split(",").map(Number);
  const dx = px - jx;
  const dy = py - jy;
  if (dx === 0 && dy === -1) return Top;
  if (dx === 0 && dy === 1) return Bottom;
  if (dx === -1 && dy === 0) return Left;
  if (dx === 1 && dy === 0) return Right;
  return null;
}

describe("signalised road junction — cars obey the lights", () => {
  itSlow("never lets a car ENTER the junction on a red arm (round-robin)", () => {
    // Round-robin makes red the common case: only one arm is ever green, so the
    // gate is exercised hard. Track when each car first steps onto the centre tile
    // and assert that arm was not red at that moment.
    const sim = createRoadSim({
      level: cross({ mode: "round-robin" }),
      width: 5,
      height: 5,
      seed: 7,
      spawnInterval: 1.2,
      carSpeed: 0.5,
    });
    const JUNC = "2,2";
    const prevTile = new Map<string, string>();
    let entries = 0;
    const dt = 0.05;
    for (let t = 0; t < 120; t += dt) {
      sim.step(dt, NO_CROSSING);
      for (const c of sim.cars()) {
        const prev = prevTile.get(c.id);
        if (prev && prev !== c.tileId && c.tileId === JUNC) {
          const arm = entryArm(JUNC, prev);
          if (arm !== null) {
            entries++;
            // The arm a car enters on must be green or amber (a true amber lets a
            // committed car clear) — never a hard red.
            expect(sim.signalAspect(JUNC, arm)).not.toBe("red");
          }
        }
        prevTile.set(c.id, c.tileId);
      }
    }
    // The gate must not have frozen the junction: cars kept crossing (go on green).
    expect(entries).toBeGreaterThan(10);
  }, 30000); // heavy sim loop — runs ~4.5s alone, over 5s under full-suite load

  it("an off junction reports no aspect (the gate is inert)", () => {
    const sim = createRoadSim({
      level: cross({ mode: "off" }),
      width: 5,
      height: 5,
      seed: 1,
    });
    expect(sim.signalAspect("2,2", Top)).toBeNull();
    expect(sim.signalOf("2,2")).toEqual({ mode: "off" });
    // Cycling live turns it on, then the aspect becomes a real light.
    sim.cycleSignal("2,2");
    expect(sim.signalOf("2,2")).toEqual({ mode: "two-phase" });
    expect(sim.signalAspect("2,2", Top)).not.toBeNull();
  });
});

describe("bus priority reduces a tracked bus's wait at the junction", () => {
  // Buses approach the junction from the SOUTH arm only and drive straight
  // through. With a fixed two-phase light they wait whenever they arrive during
  // the E+W phase; transit signal priority extends / brings their (N+S) green
  // forward, so they wait less. Same seed → the only difference is the priority.
  function totalBusWait(busPriority: boolean): number {
    const southEntry: RoadEntry = { coord: { x: 2, y: 4 }, entryPort: Bottom };
    const sim = createRoadSim({
      level: cross({ mode: "two-phase", busPriority }),
      width: 5,
      height: 5,
      seed: 11,
      spawnInterval: 2.0,
      carSpeed: 0.5,
      mix: { bus: 1 }, // every spawned vehicle is a bus, so they are the tracked stream
      spawnEntries: [southEntry],
    });
    let stopped = 0;
    const dt = 0.05;
    for (let t = 0; t < 150; t += dt) {
      sim.step(dt, NO_CROSSING);
      for (const c of sim.cars()) {
        if (c.velocity < 1e-3) stopped += dt;
      }
    }
    return stopped;
  }

  itSlow("a prioritised junction stops the bus stream less than a fixed-time one", () => {
    const off = totalBusWait(false);
    const on = totalBusWait(true);
    // The fixed-time light genuinely stops buses (a meaningful baseline)…
    expect(off).toBeGreaterThan(0);
    // …and bus-priority measurably reduces that wait.
    expect(on).toBeLessThan(off);
  });
});
