import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { createRoadSim, vehicleClassOf, vehicleSpec, specLength } from "@/sim/road";
import { cycleLaneIndices, laneUsableBy, oneWay } from "@/tiles/lanes";
import { bikemix } from "@/levels/test/scenarios/bikemix";
import { bikeovertake } from "@/levels/test/scenarios/bikeovertake";
import { cyclelane } from "@/levels/test/scenarios/cyclelane";

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

describe("the lane access matrix", () => {
  const lane = (kind?: "all" | "bus" | "cycle") => ({ ...oneWay(L, R), ...(kind ? { kind } : {}) });

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

  it("cycleLaneIndices lists only cycle lanes, ascending", () => {
    const road = [
      { from: L, to: [R], index: 1 },
      { from: L, to: [R], index: 0, kind: "cycle" as const },
    ];
    expect(cycleLaneIndices(road, L)).toEqual([0]);
    expect(cycleLaneIndices(road, R)).toEqual([]);
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
      // E-W scenarios the cycle lane is index 0 from BOTH approaches, so lane
      // membership is a plain index test.
      const cycles = new Set([
        ...cycleLaneIndices(road, L),
        ...cycleLaneIndices(road, R),
      ]);
      const onCycle = cycles.has(Math.round(c.laneIndex));
      if (c.kind === "bike") {
        bikes.push({ speed: c.speed, laneIndex: c.laneIndex, overtakePhase: c.overtakePhase });
        bikeSamples++;
        if (onCycle) bikeOnCycle++;
      } else if (onCycle) {
        carOnCycleLane++;
      }
    }
    for (const id of prev) if (!now.has(id)) completedIds.add(id);
    prev = now;
  }
  return {
    kinds,
    bikes,
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
});
