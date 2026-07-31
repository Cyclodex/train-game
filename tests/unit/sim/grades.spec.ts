import { describe, it, expect } from "vitest";
import { createSimulation } from "@/sim/simulation";
import { Position } from "@/types";
import { gradeSpeedFactor } from "@/sim/physics";
import { heightOf, TileCell } from "@/tiles/model";
import { validateLevel } from "@/tiles/validate";
import { grades } from "@/levels/test/scenarios/grades";

const { Left, Right } = Position;

describe("gradeSpeedFactor (physics)", () => {
  it("is exactly 1 on the flat and DOWNHILL — descending earns no bonus", () => {
    // A speed bonus downhill would poison the sim's braking-distance maths.
    expect(gradeSpeedFactor("people", 2, 0)).toBe(1);
    expect(gradeSpeedFactor("people", 2, -1)).toBe(1);
  });

  it("slows a climb, more per extra step", () => {
    const one = gradeSpeedFactor("people", 2, 1);
    const two = gradeSpeedFactor("people", 2, 2);
    expect(one).toBeLessThan(1);
    expect(two).toBeLessThan(one);
  });

  it("punishes weight: freight crawls where the shuttle keeps pace", () => {
    const shuttle = gradeSpeedFactor("people", 1, 1);
    const freight = gradeSpeedFactor("fraight", 4, 1);
    expect(freight).toBeLessThan(shuttle);
  });
});

describe("heights in the level model", () => {
  it("defaults to the valley floor", () => {
    expect(heightOf(undefined)).toBe(0);
    expect(heightOf({ connections: [] })).toBe(0);
    expect(heightOf({ connections: [], height: 2 })).toBe(2);
  });

  it("the validator allows a one-step ramp and flags a cliff", () => {
    const line = (h0: number, h1: number): Record<string, TileCell> => ({
      "0,0": { connections: [[Right, Position.Center]], role: "depot" },
      "1,0": { connections: [[Left, Right]], ...(h0 ? { height: h0 } : {}) },
      "2,0": { connections: [[Left, Right]], ...(h1 ? { height: h1 } : {}) },
      "3,0": { connections: [[Left, Position.Center]], role: "depot" },
    });
    expect(
      validateLevel(line(0, 1)).issues.filter(i => i.type === "grade-step")
    ).toEqual([]);
    // The h2 block cliffs on BOTH its joints (up from 1,0 and down to the
    // depot), and each joint is reported exactly once.
    const cliff = validateLevel(line(0, 2)).issues.filter(
      i => i.type === "grade-step"
    );
    expect(cliff.length).toBe(2);
  });
});

// The race the /test/grades scenario stages, measured. Runs on the scenario's
// own board (imported) so a board change fails here, not silently on stage.
function simOf() {
  return createSimulation({
    level: grades.level,
    depotColors: { "0,1": "blue", "8,1": "green", "0,3": "yellow", "8,3": "red" },
    trains: [
      {
        id: "shuttle",
        coord: { x: 0, y: 1 },
        entryPort: Position.Center,
        color: "green",
        type: "people",
        wagonCount: 1,
        speed: 1,
      },
      {
        id: "freight",
        coord: { x: 0, y: 3 },
        entryPort: Position.Center,
        color: "red",
        type: "fraight",
        wagonCount: 4,
        speed: 1,
      },
    ],
  });
}

describe("the hill (sim contract of /test/grades)", () => {
  it("caps speed on the climb and lifts the cap past the summit", () => {
    const sim = simOf();
    // The cap is a BRAKING TARGET, not a teleport: the freight enters the
    // first ramp tile still fast and decelerates through it, so the honest
    // measurements are the SLOWEST it goes mid-climb (settles onto the cap)
    // and the fastest it goes back on the summit flat (the cap lifts).
    const slowest: Record<string, number> = {};
    const fastest: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      sim.step(0.05);
      const tile = sim.trainTileId("freight");
      const v = sim.trainVelocity("freight");
      slowest[tile] = Math.min(slowest[tile] ?? Infinity, v);
      fastest[tile] = Math.max(fastest[tile] ?? 0, v);
    }
    expect(sim.trainState("freight")).toBe("parked");
    const cap = gradeSpeedFactor("fraight", 4, 1);
    // Mid-climb (2,3 exits into the h2 summit) it sits ON the cap…
    expect(slowest["2,3"]).toBeGreaterThan(cap - 0.02);
    expect(slowest["2,3"]).toBeLessThan(cap + 0.06);
    // …and once the segment ahead is level (4,3 → 5,3) it cruises again.
    expect(fastest["4,3"]).toBeGreaterThan(0.9);
  });

  it("the shuttle beats the freight over the same hill", () => {
    const sim = simOf();
    let shuttleParkedAt = 0;
    let freightParkedAt = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(0.05);
      if (!shuttleParkedAt && sim.trainState("shuttle") === "parked") {
        shuttleParkedAt = i;
      }
      if (!freightParkedAt && sim.trainState("freight") === "parked") {
        freightParkedAt = i;
      }
    }
    expect(shuttleParkedAt).toBeGreaterThan(0);
    expect(freightParkedAt).toBeGreaterThan(0);
    expect(shuttleParkedAt).toBeLessThan(freightParkedAt);
  });
});
