import { describe, it, expect } from "vitest";
import { createSimulation, SimConfig } from "@/sim/simulation";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";

// A depot at 0,0 opening east, two straights, a depot at 3,0 opening west.
function lane(): Level {
  return {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("straight", 1),
    "3,0": expandKind("depot", 3),
  };
}

function simOf(extra: Partial<SimConfig> = {}) {
  return createSimulation({
    level: lane(),
    trains: [
      {
        id: "t1",
        coord: { x: 0, y: 0 },
        entryPort: Position.Center, // leaves its depot outward, as game.ts does
        color: "green",
        type: "people",
        wagonCount: 0,
        speed: 1,
      },
    ],
    ...extra,
  });
}

describe("dispatch (opt-in waiting trains)", () => {
  it("DEFAULTS OFF: a train departs immediately, exactly as before", () => {
    const sim = simOf();
    expect(sim.trainState("t1")).toBe("running");
    expect(sim.waitingTrains()).toEqual([]);
    for (let i = 0; i < 6; i++) sim.step(0.5);
    expect(sim.trainTileId("t1")).not.toBe("0,0");
  });

  it("with waitForDispatch a train starts waiting and does not move", () => {
    const sim = simOf({ waitForDispatch: true });
    expect(sim.trainState("t1")).toBe("waiting");
    expect(sim.waitingTrains()).toEqual(["t1"]);
    for (let i = 0; i < 20; i++) sim.step(0.5);
    expect(sim.trainTileId("t1")).toBe("0,0");
    expect(sim.trainProgress("t1")).toBe(0);
    expect(sim.trainVelocity("t1")).toBe(0);
  });

  it("a waiting train reserves nothing ahead of it", () => {
    const sim = simOf({ waitForDispatch: true });
    for (let i = 0; i < 10; i++) sim.step(0.5);
    expect(sim.reservedBy("1,0")).toBeUndefined();
    expect(sim.reservedBy("2,0")).toBeUndefined();
    // It does still stand on its own depot tile — like any train that has not
    // pulled out yet — so nothing else may enter there.
    expect(sim.occupiedBy("0,0")).toBe("t1");
  });

  it("dispatch releases it and it then runs the lane normally", () => {
    const sim = simOf({ waitForDispatch: true, depotColors: { "3,0": "green" } });
    expect(sim.dispatch("t1")).toBe(true);
    expect(sim.trainState("t1")).toBe("running");
    expect(sim.waitingTrains()).toEqual([]);

    let arrived = false;
    for (let i = 0; i < 40 && !arrived; i++) {
      for (const e of sim.step(0.2)) {
        if (e.type === "arrived" && e.matched) arrived = true;
      }
    }
    expect(arrived).toBe(true);
    expect(sim.trainTileId("t1")).toBe("3,0");
  });

  it("dispatch is idempotent and never restarts a moving or parked train", () => {
    const sim = simOf({ waitForDispatch: true });
    expect(sim.dispatch("t1")).toBe(true);
    expect(sim.dispatch("t1")).toBe(false); // already running
    expect(sim.dispatch("nope")).toBe(false); // unknown train
  });

  it("a dispatched train accelerates from rest, it is not shoved", () => {
    const sim = simOf({ waitForDispatch: true });
    sim.dispatch("t1");
    expect(sim.trainVelocity("t1")).toBe(0);
    sim.step(0.1);
    expect(sim.trainVelocity("t1")).toBeGreaterThan(0);
  });

  it("trains injected mid-run also wait when the mode says so", () => {
    const sim = simOf({ waitForDispatch: true });
    sim.addTrain({
      id: "t2",
      coord: { x: 3, y: 0 },
      entryPort: Position.Center,
      color: "red",
      type: "people",
      wagonCount: 0,
      speed: 1,
    });
    expect(sim.trainState("t2")).toBe("waiting");
    expect(sim.waitingTrains()).toEqual(["t1", "t2"]); // sorted, stable
  });
});
