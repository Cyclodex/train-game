import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { createRoadSim, vehicleClassOf, vehicleSpec, specLength } from "@/sim/road";
import {
  cycleLaneIndices,
  bikeLaneIndices,
  laneUsableBy,
  oneWay,
  type LaneKind,
} from "@/tiles/lanes";
import { planRoute } from "@/sim/roadRouter";
import { addCycleLane } from "@/tiles/editOps";
import { Level } from "@/tiles/model";
import { bikemix } from "@/levels/test/scenarios/bikemix";
import { bikeovertake } from "@/levels/test/scenarios/bikeovertake";
import { cyclelane } from "@/levels/test/scenarios/cyclelane";
import { bikeleftturn } from "@/levels/test/scenarios/bikeleftturn";
import { widestreet } from "@/levels/test/scenarios/widestreet";
import { motorcycles } from "@/levels/test/scenarios/motorcycles";
import { bikedetour } from "@/levels/test/scenarios/bikedetour";

// BICYCLES — phase A+B of the bicycle plan
// (docs/superpowers/specs/2026-08-05-bicycle-travel-mode-design.md).
//
// A bike is a VehicleKind like any other (data: short body, slow cruise) plus a
// VehicleClass of its own wired through the ONE access matrix in tiles/lanes.ts.
// These tests pin the four claims the plan makes: bikes are slow and short,
// bikes never overtake, cars never enter a cycle lane while bikes ride it, and
// a zero-weight mix entry changes nothing for existing seeded boards.

const { Left: L, Right: R } = Position;

describe("the bike vehicle kind", () => {
  it("is its own lane-access class", () => {
    expect(vehicleClassOf("bike")).toBe("bike");
    expect(vehicleClassOf("bus")).toBe("bus");
    expect(vehicleClassOf("truck")).toBe("car");
  });

  it("is under half a car long", () => {
    const bike = specLength(vehicleSpec("bike", 0.23));
    const car = specLength(vehicleSpec("car", 0.23));
    expect(bike).toBeLessThan(car * 0.5);
    expect(bike).toBeGreaterThan(0);
  });
});

describe("the motorcycle vehicle kind", () => {
  it("is a fast, narrow CAR by class — any general lane, overtaking allowed", () => {
    expect(vehicleClassOf("motorcycle")).toBe("car");
  });

  it("is as short as a bike (the capsule the bike used to wear)", () => {
    const moto = specLength(vehicleSpec("motorcycle", 0.23));
    const bike = specLength(vehicleSpec("bike", 0.23));
    const car = specLength(vehicleSpec("car", 0.23));
    expect(moto).toBeCloseTo(bike, 6);
    expect(moto).toBeLessThan(car * 0.5);
  });
});

describe("the lane access matrix", () => {
  const lane = (kind?: LaneKind) => ({ ...oneWay(L, R), ...(kind ? { kind } : {}) });

  it("cars: general lanes only", () => {
    expect(laneUsableBy(lane(), "car")).toBe(true);
    expect(laneUsableBy(lane("bus"), "car")).toBe(false);
    expect(laneUsableBy(lane("cycle"), "car")).toBe(false);
  });

  it("buses: general + bus lanes, never the cycle lane", () => {
    expect(laneUsableBy(lane(), "bus")).toBe(true);
    expect(laneUsableBy(lane("bus"), "bus")).toBe(true);
    expect(laneUsableBy(lane("cycle"), "bus")).toBe(false);
  });

  it("bikes: everything — general, bus and cycle lanes", () => {
    expect(laneUsableBy(lane(), "bike")).toBe(true);
    expect(laneUsableBy(lane("bus"), "bike")).toBe(true);
    expect(laneUsableBy(lane("cycle"), "bike")).toBe(true);
  });

  it("shoulders (the wide street's edge zone): bikes only, like a cycle lane", () => {
    expect(laneUsableBy(lane("shoulder"), "car")).toBe(false);
    expect(laneUsableBy(lane("shoulder"), "bus")).toBe(false);
    expect(laneUsableBy(lane("shoulder"), "bike")).toBe(true);
  });

  it("cycleLaneIndices lists only cycle lanes, ascending", () => {
    const road = [
      { from: L, to: [R], index: 1 },
      { from: L, to: [R], index: 0, kind: "cycle" as const },
    ];
    expect(cycleLaneIndices(road, L)).toEqual([0]);
    expect(cycleLaneIndices(road, R)).toEqual([]);
  });

  it("bikeLaneIndices lists cycle AND shoulder lanes — the bike's ride space", () => {
    const road = [
      { from: L, to: [R], index: 2 },
      { from: L, to: [R], index: 0, kind: "shoulder" as const },
      { from: L, to: [R], index: 1, kind: "cycle" as const },
    ];
    expect(bikeLaneIndices(road, L)).toEqual([0, 1]);
    expect(cycleLaneIndices(road, L)).toEqual([1]); // the paint query stays kind-specific
  });
});

// Drive a scenario for `seconds` sim-seconds and collect per-tick samples.
function drive(
  scenario: typeof bikemix,
  seconds: number,
  seed = 5,
): {
  kinds: Set<string>;
  bikes: { speed: number; laneIndex: number; overtakePhase: string }[];
  motos: { speed: number; laneIndex: number; overtakePhase: string }[];
  carLanes: number[];
  carOnCycleLane: number;
  bikeOnCycleLaneRatio: number;
  completed: number;
  badPos: number;
} {
  const sim = createRoadSim({
    level: scenario.level,
    width: scenario.size!.cols,
    height: scenario.size!.rows,
    seed,
    spawnInterval: scenario.traffic?.spawnInterval ?? 1,
    carSpeed: 0.5,
    carLength: 0.2,
    maxCars: scenario.traffic?.maxCars ?? 10,
    mix: scenario.traffic?.mix,
    overtakeFraction: scenario.traffic?.overtakeFraction,
  });
  const kinds = new Set<string>();
  const bikes: { speed: number; laneIndex: number; overtakePhase: string }[] = [];
  const motos: { speed: number; laneIndex: number; overtakePhase: string }[] = [];
  const carLanes: number[] = [];
  let carOnCycleLane = 0;
  let bikeSamples = 0;
  let bikeOnCycle = 0;
  let badPos = 0;
  let prev = new Set<string>();
  const completedIds = new Set<string>();
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i++) {
    sim.step(0.05, () => false);
    const now = new Set<string>();
    for (const c of sim.cars()) {
      now.add(c.id);
      kinds.add(c.kind);
      if (!Number.isFinite(c.laneIndex)) badPos++;
      const road = scenario.level[c.tileId]?.road;
      // Which side the car entered from is not exposed here; on these straight
      // E-W scenarios the bike lane (cycle or shoulder) is index 0 from BOTH
      // approaches, so lane membership is a plain index test.
      const cycles = new Set([
        ...bikeLaneIndices(road, L),
        ...bikeLaneIndices(road, R),
      ]);
      const onCycle = cycles.has(Math.round(c.laneIndex));
      if (c.kind === "bike") {
        bikes.push({ speed: c.speed, laneIndex: c.laneIndex, overtakePhase: c.overtakePhase });
        bikeSamples++;
        if (onCycle) bikeOnCycle++;
      } else if (c.kind === "motorcycle") {
        motos.push({ speed: c.speed, laneIndex: c.laneIndex, overtakePhase: c.overtakePhase });
        if (onCycle) carOnCycleLane++; // a motorcycle is a car to every lane rule
      } else {
        carLanes.push(c.laneIndex);
        if (onCycle) carOnCycleLane++;
      }
    }
    for (const id of prev) if (!now.has(id)) completedIds.add(id);
    prev = now;
  }
  return {
    kinds,
    bikes,
    motos,
    carLanes,
    carOnCycleLane,
    bikeOnCycleLaneRatio: bikeSamples ? bikeOnCycle / bikeSamples : 0,
    completed: completedIds.size,
    badPos,
  };
}

describe("bikes in mixed traffic (bikemix)", () => {
  it("spawns bikes from the mix, slow, never overtaking, traffic still flows", () => {
    const r = drive(bikemix, 90);
    expect(r.kinds.has("bike")).toBe(true);
    expect(r.kinds.has("car")).toBe(true);
    expect(r.bikes.length).toBeGreaterThan(0);
    // KIND_SPEED 0.45 × spread ≤ 1.25 → a bike's cruise is at most 0.5625 of
    // carSpeed; every car's is at least 0.75 of it. No overlap.
    for (const b of r.bikes) expect(b.speed).toBeLessThan(0.5 * 0.6);
    for (const b of r.bikes) expect(b.overtakePhase).toBe("none");
    expect(r.completed).toBeGreaterThan(3); // the street still delivers
    expect(r.badPos).toBe(0);
  });
});

describe("bikes on a 2-lane road (bikeovertake)", () => {
  it("bikes hold the kerb lane and never enter a passing phase", () => {
    const r = drive(bikeovertake, 90);
    expect(r.bikes.length).toBeGreaterThan(0);
    for (const b of r.bikes) {
      expect(b.overtakePhase).toBe("none");
      // Kerb-most lane is 0; a bike never drifts inner (keep-right + no overtake).
      expect(Math.round(b.laneIndex)).toBe(0);
    }
    expect(r.completed).toBeGreaterThan(5);
  });
});

describe("the cycle lane (cyclelane)", () => {
  it("bikes ride the cycle lane; cars never touch it", () => {
    const r = drive(cyclelane, 90);
    expect(r.bikes.length).toBeGreaterThan(0);
    expect(r.carOnCycleLane).toBe(0);
    // Bikes spawn onto and drift to the cycle lane; near-all samples sit on it.
    expect(r.bikeOnCycleLaneRatio).toBeGreaterThan(0.9);
    expect(r.completed).toBeGreaterThan(5);
  });
});

describe("the kerb rule at a left turn (bikeleftturn)", () => {
  it("cars sort inner for the forced left; bikes hold the kerb lane throughout", () => {
    const r = drive(bikeleftturn, 90);
    expect(r.bikes.length).toBeGreaterThan(0);
    // The left-turn discipline still applies to cars: the eastbound approach
    // puts them on the inner lane, so inner-lane car samples must exist.
    expect(r.carLanes.some(l => Math.round(l) === 1)).toBe(true);
    // The bikes are exempt: through the same forced left, every bike sample —
    // approach, junction tile and exit arm — stays on the kerb lane.
    for (const b of r.bikes) expect(Math.round(b.laneIndex)).toBe(0);
    expect(r.completed).toBeGreaterThan(5);
  });
});

describe("the wide street (widestreet)", () => {
  it("bikes ride the edge zone; cars keep their own lane and keep flowing", () => {
    const r = drive(widestreet, 90);
    expect(r.bikes.length).toBeGreaterThan(0);
    // The shoulder is bikes-only — no car (or motorcycle) sample ever sits on it.
    expect(r.carOnCycleLane).toBe(0);
    // Bikes spawn onto and hold the edge zone, exactly like a cycle lane.
    expect(r.bikeOnCycleLaneRatio).toBeGreaterThan(0.9);
    // The point of the wide street: cars pass alongside without queueing, so
    // the street delivers like the cycle-lane remedy, not like the bikemix queue.
    expect(r.completed).toBeGreaterThan(5);
    expect(r.badPos).toBe(0);
  });
});

describe("motorcycles among bikes (motorcycles)", () => {
  it("motorcycles use the inner lane to pass; bikes hold the kerb", () => {
    const r = drive(motorcycles, 90);
    expect(r.motos.length).toBeGreaterThan(0);
    expect(r.bikes.length).toBeGreaterThan(0);
    // A motorcycle is a fast, narrow car: it may enter the overtaking lane a
    // bike must never touch. With bikes clogging the kerb lane, some sample
    // shows it passing (or already out on the inner lane mid-pass).
    expect(
      r.motos.some(m => m.overtakePhase === "passing" || Math.round(m.laneIndex) === 1),
    ).toBe(true);
    // The bikes stay bikes: kerb lane, never a passing phase.
    for (const b of r.bikes) {
      expect(b.overtakePhase).toBe("none");
      expect(Math.round(b.laneIndex)).toBe(0);
    }
    expect(r.completed).toBeGreaterThan(5);
  });
});

describe("bike routing avoids 3-lane arterials (bikedetour)", () => {
  const { Bottom: Bo } = Position;
  const entries = [
    { coord: { x: 0, y: 1 }, entryPort: L },
    { coord: { x: 5, y: 1 }, entryPort: R },
  ];
  // rng → 0 picks the first surviving target: from the west spawn that is the
  // east entry, so the route choice is deterministic.
  const rng0 = () => 0;

  it("a car rides the arterial straight through", () => {
    const plan = planRoute(bikedetour.level, { x: 0, y: 1 }, L, entries, rng0, "car");
    expect(plan.destination).toBe(entries[1]);
    expect(plan.turns).toEqual([
      { junctionId: "1,1", exitArm: R },
      { junctionId: "4,1", exitArm: R },
    ]);
  });

  it("a bike routes round via the 1-lane back street", () => {
    const plan = planRoute(bikedetour.level, { x: 0, y: 1 }, L, entries, rng0, "bike");
    expect(plan.destination).toBe(entries[1]);
    expect(plan.turns).toEqual([
      { junctionId: "1,1", exitArm: Bo }, // down into the quiet street…
      { junctionId: "4,1", exitArm: R }, // …and rejoin at the far junction
    ]);
  });

  it("a cycle lane on the arterial lifts the avoidance", () => {
    const withCycle: Level = { ...bikedetour.level };
    for (const id of ["0,1", "2,1", "3,1", "5,1"]) {
      withCycle[id] = addCycleLane(withCycle[id], L);
    }
    const plan = planRoute(withCycle, { x: 0, y: 1 }, L, entries, rng0, "bike");
    expect(plan.turns).toEqual([
      { junctionId: "1,1", exitArm: R },
      { junctionId: "4,1", exitArm: R },
    ]);
  });

  it("with no alternative the bike still takes the arterial — a soft penalty, not a ban", () => {
    const direct: Level = Object.fromEntries(
      Object.entries(bikedetour.level).filter(([id]) => id.endsWith(",1")),
    );
    const plan = planRoute(direct, { x: 0, y: 1 }, L, entries, rng0, "bike");
    expect(plan.destination).toBe(entries[1]);
    expect(plan.turns).toEqual([
      { junctionId: "1,1", exitArm: R },
      { junctionId: "4,1", exitArm: R },
    ]);
  });
});

describe("seeded-board determinism", () => {
  it("a zero-weight bike entry draws the identical kind sequence", () => {
    const run = (mix: Record<string, number>) => {
      const sim = createRoadSim({
        level: bikemix.level,
        width: 6,
        height: 3,
        seed: 11,
        spawnInterval: 0.6,
        carSpeed: 0.5,
        carLength: 0.2,
        maxCars: 10,
        mix,
      });
      const seen: string[] = [];
      const known = new Set<string>();
      for (let i = 0; i < 600; i++) {
        sim.step(0.05, () => false);
        for (const c of sim.cars()) {
          if (known.has(c.id)) continue;
          known.add(c.id);
          seen.push(`${c.id}:${c.kind}`);
        }
      }
      return seen;
    };
    const before = run({ car: 1, truck: 0.4 });
    const after = run({ car: 1, truck: 0.4, bike: 0 });
    expect(after).toEqual(before);
  });

  it("a zero-weight motorcycle entry draws the identical kind sequence too", () => {
    const run = (mix: Record<string, number>) => {
      const sim = createRoadSim({
        level: bikemix.level,
        width: 6,
        height: 3,
        seed: 11,
        spawnInterval: 0.6,
        carSpeed: 0.5,
        carLength: 0.2,
        maxCars: 10,
        mix,
      });
      const seen: string[] = [];
      const known = new Set<string>();
      for (let i = 0; i < 600; i++) {
        sim.step(0.05, () => false);
        for (const c of sim.cars()) {
          if (known.has(c.id)) continue;
          known.add(c.id);
          seen.push(`${c.id}:${c.kind}`);
        }
      }
      return seen;
    };
    const before = run({ car: 1, truck: 0.4 });
    const after = run({ car: 1, truck: 0.4, motorcycle: 0 });
    expect(after).toEqual(before);
  });
});
