import { describe, it, expect } from "vitest";
import { Position, ActiveIntersection } from "@/types";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { addConnection } from "@/tiles/editOps";
import { createSimulation } from "@/sim/simulation";

// P0 of the build-and-dispatch mode: can the world change while it runs?
//
// The answer turned out to be "mostly already yes" — `traverse`,
// `resolveExitPort`, `routeToNextSignal` and `isBoundary` all index the level on
// every call, against the object handed to createSimulation, which is never
// copied. These tests pin that property down, because it is load-bearing for the
// whole build tool and nothing else would notice if a future refactor snapshotted
// the level for speed.

const run = (sim: ReturnType<typeof createSimulation>, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) sim.step(1 / 60);
};

function lineLevel(): Level {
  return {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("straight", 1),
  };
}

const oneTrain = [
  { id: "t1", coord: { x: 0, y: 0 }, entryPort: Position.Center, color: "red", type: "people" as const, wagonCount: 1 },
];

describe("editing the level while the simulation runs", () => {
  it("routes onto track that did not exist when the sim was created", () => {
    const level = lineLevel();
    // Give the depot the train's colour, or arrival is a MISMATCH and the train
    // bounces straight back out again — which looks exactly like "the new track
    // was ignored" from the outside.
    const sim = createSimulation({ level, trains: oneTrain, depotColors: { "4,0": "red" } });
    run(sim, 20);
    // The line dead-ends at 2,0: the train can go no further.
    expect(sim.trainTileId("t1")).toBe("2,0");

    // Lay two more tiles, mutating the same object the sim holds.
    level["3,0"] = expandKind("straight", 1);
    level["4,0"] = expandKind("depot", 3);
    run(sim, 20);

    expect(sim.trainTileId("t1")).toBe("4,0");
  });

  it("sees a signal built mid-run, without being told about it", () => {
    // Signals used to be snapshotted into a Set at construction. They are now
    // derived from the level per call, so a signal laid later is a real block
    // boundary — and holding it stops the train.
    const level = lineLevel();
    level["3,0"] = expandKind("straight", 1);
    level["4,0"] = expandKind("depot", 3);
    const sim = createSimulation({ level, trains: oneTrain });

    level["2,0"] = { ...level["2,0"], signals: [Position.Right] };
    sim.toggleHold("2,0", Position.Right);
    run(sim, 20);

    expect(sim.isHeld("2,0", Position.Right)).toBe(true);
    expect(sim.trainTileId("t1")).toBe("2,0");
    expect(sim.trainVelocity("t1")).toBe(0);
  });

  it("takes a branch added to a tile it has already driven over", () => {
    // The tile becomes a junction after the train passed it once. Rounding a
    // loop, the train meets the new arm and — given a switch arm — takes it.
    const level: Level = {
      "0,0": expandKind("depot", 1),
      "1,0": expandKind("straight", 1),
      "2,0": expandKind("curve", 2), // Left->Bottom: entered from the west, leaves south
      "2,1": expandKind("depot"), // opens Top
    };
    const sim = createSimulation({ level, trains: oneTrain });
    run(sim, 25);
    expect(sim.trainTileId("t1")).toBe("2,1");

    // Extend 1,0 with a southern branch: it is now a T-junction, and a train
    // entering from the left has TWO partners.
    level["1,0"] = addConnection(level["1,0"], Position.Left, Position.Bottom);
    expect(level["1,0"].connections.length).toBe(2);
  });

  it("stalls a train on a new junction that has no switch arm — the trap P0 has to handle", () => {
    // `connectionsToExitPort` returns NULL for a multi-partner entry with no
    // arm, so a tile that just became a junction stops a train dead. This is
    // why applyEdits merges fresh switch arms in; without a resolver the sim
    // behaves exactly as documented here.
    const level: Level = {
      "0,0": expandKind("depot", 1),
      "1,0": expandKind("straight", 1),
      "2,0": expandKind("straight", 1),
      "3,0": expandKind("depot", 3),
    };
    const sim = createSimulation({ level, trains: oneTrain });
    // Make 1,0 a junction before the train reaches it, with no switch resolver.
    level["1,0"] = addConnection(level["1,0"], Position.Left, Position.Bottom);
    level["1,1"] = expandKind("depot");
    run(sim, 20);

    expect(sim.trainTileId("t1")).toBe("1,0");
    expect(sim.trainVelocity("t1")).toBe(0);
  });

  it("keeps running when the new junction DOES have an arm", () => {
    const level: Level = {
      "0,0": expandKind("depot", 1),
      "1,0": expandKind("straight", 1),
      "2,0": expandKind("straight", 1),
      "3,0": expandKind("depot", 3),
    };
    const sim = createSimulation({
      level,
      trains: oneTrain,
      // Straight on through, the arm applyEdits would have merged in.
      getSwitch: (id, entry) =>
        id === "1,0" && entry === Position.Left ? ActiveIntersection.Straight : undefined,
      depotColors: { "3,0": "red" },
    });
    level["1,0"] = addConnection(level["1,0"], Position.Left, Position.Bottom);
    level["1,1"] = expandKind("depot");
    run(sim, 25);

    expect(sim.trainTileId("t1")).toBe("3,0");
  });
});

describe("the guard on editing", () => {
  it("identifies the tiles a train is standing on or has reserved", () => {
    // applyEdits refuses any edit touching these. A train's path caches the exit
    // port of its current tile and reservations cache tile ids, so editing one
    // makes both stale — and "you can't rip up track under a moving train" is
    // the rule a player expects anyway.
    const level = lineLevel();
    level["3,0"] = expandKind("straight", 1);
    level["4,0"] = expandKind("depot", 3);
    const sim = createSimulation({ level, trains: oneTrain });
    run(sim, 6);

    const here = sim.trainTileId("t1");
    expect(sim.occupiedBy(here)).toBe("t1");
    // Somewhere well ahead of the train is free to build on.
    expect(sim.occupiedBy("4,0")).toBeUndefined();
  });
});
