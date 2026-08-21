import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { createSimulation, SimConfig, Simulation } from "@/sim/simulation";
import { railRing } from "@/levels/test/scenario";
import { saveload } from "@/levels/test/scenarios/saveload";

// The round-trip property the whole save/load feature rests on
// (docs/superpowers/specs/2026-08-21-save-load-design.md): stepping N ticks,
// snapshotting, restoring into a FRESH sim and stepping M more must be
// indistinguishable from stepping N+M straight through. Everything step(dt)
// reads is either snapshotted verbatim or a pure function of what is, so the
// comparison is exact (toEqual over full snapshots), not approximate.

const DT = 1 / 60;

function step(sim: Simulation, ticks: number) {
  for (let i = 0; i < ticks; i++) sim.step(DT);
}

// The saveload scenario as a SimConfig: two trains contending over a signalled
// crossing, colours pinned by the scenario itself.
function contentionConfig(): SimConfig {
  return {
    level: JSON.parse(JSON.stringify(saveload.level)),
    depotColors: saveload.colors!.depotColors,
    trains: Object.values(saveload.trains).map(t => ({
      id: t.id,
      coord: { x: t.x, y: t.y },
      entryPort: Position.Center,
      color: saveload.colors!.trainColors[t.id],
      type: t.type,
      wagonCount: t.wagons?.length ?? 0,
    })),
  };
}

// A two-station ring with a line train and passenger demand, so the transit
// layer (queues, cursors, manifests, delivered) is part of the round trip.
function lineConfig(): SimConfig {
  const level = {
    ...railRing(1, 0, 3, 2),
    "2,0": { connections: [[Position.Left, Position.Right]], role: "station" },
    "2,2": { connections: [[Position.Left, Position.Right]], role: "station" },
    "0,1": { connections: [[Position.Center, Position.Right]], role: "depot" },
    "1,1": {
      connections: [
        [Position.Top, Position.Bottom],
        [Position.Left, Position.Top],
        [Position.Left, Position.Bottom],
      ],
    },
  } as SimConfig["level"];
  return {
    level,
    depotColors: { "0,1": "blue" },
    trains: [
      {
        id: "t1",
        coord: { x: 0, y: 1 },
        entryPort: Position.Center,
        color: "green",
        type: "people",
        wagonCount: 2,
        line: ["2,0", "2,2"],
      },
    ],
    stationDemand: {
      "2,0": { intervalSec: 2, max: 8, initial: 3 },
      "2,2": { intervalSec: 3, max: 8, initial: 2 },
    },
  };
}

describe("simulation snapshot/restore round trip", () => {
  it("step N + restore + step M equals stepping N+M (contention board)", () => {
    const reference = createSimulation(contentionConfig());
    const saved = createSimulation(contentionConfig());
    // N ticks into the contention: one train holds the crossing's block, the
    // other is braking on the red.
    step(reference, 300);
    step(saved, 300);
    const snap = saved.snapshot();

    const restored = createSimulation(contentionConfig());
    restored.restore(JSON.parse(JSON.stringify(snap)));
    // The restored sim answers exactly like the one it was taken from…
    expect(restored.snapshot()).toEqual(saved.snapshot());
    // …and keeps answering like the uninterrupted run, tick for tick.
    step(reference, 300);
    step(restored, 300);
    expect(restored.snapshot()).toEqual(reference.snapshot());
  });

  it("carries the transit layer: queues, manifests, line cursor, delivered", () => {
    const reference = createSimulation(lineConfig());
    const saved = createSimulation(lineConfig());
    // Long enough for the train to call at both platforms at least once, so
    // boarding, alighting and the delivered total are all non-trivial.
    step(reference, 1800);
    step(saved, 1800);
    expect(saved.passengersDelivered()).toBeGreaterThan(0);
    const snap = saved.snapshot();

    const restored = createSimulation(lineConfig());
    restored.restore(JSON.parse(JSON.stringify(snap)));
    expect(restored.passengersDelivered()).toBe(saved.passengersDelivered());
    expect(restored.stationQueue("2,0")).toBe(saved.stationQueue("2,0"));
    expect(restored.trainPassengers("t1")).toBe(saved.trainPassengers("t1"));
    expect(restored.trainNextStop("t1")).toBe(saved.trainNextStop("t1"));

    step(reference, 1200);
    step(restored, 1200);
    expect(restored.snapshot()).toEqual(reference.snapshot());
  });

  it("keeps a waiting (dispatch-gated) train waiting, and dispatchable", () => {
    const config = { ...contentionConfig(), waitForDispatch: true };
    const sim = createSimulation(config);
    step(sim, 60);
    const snap = sim.snapshot();

    const restored = createSimulation({
      ...contentionConfig(),
      waitForDispatch: true,
    });
    restored.restore(snap);
    expect(restored.trainState("trainH")).toBe("waiting");
    expect(restored.waitingTrains()).toEqual(["trainH", "trainV"]);
    expect(restored.dispatch("trainH")).toBe(true);
    expect(restored.trainState("trainH")).toBe("running");
  });

  it("carries manual signal overrides, and they keep holding the train", () => {
    const reference = createSimulation(contentionConfig());
    const saved = createSimulation(contentionConfig());
    reference.toggleHold("1,1", Position.Right);
    saved.toggleHold("1,1", Position.Right);
    step(reference, 240);
    step(saved, 240);

    const restored = createSimulation(contentionConfig());
    restored.restore(saved.snapshot());
    expect(restored.isHeld("1,1", Position.Right)).toBe(true);
    step(reference, 240);
    step(restored, 240);
    expect(restored.snapshot()).toEqual(reference.snapshot());
    // Held at the signal, not parked at its destination.
    expect(restored.trainState("trainH")).toBe("running");
    expect(restored.trainTileId("trainH")).toBe("1,1");
  });
});
