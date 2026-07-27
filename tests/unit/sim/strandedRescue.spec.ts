import { describe, it, expect } from "vitest";
import { createSimulation } from "@/sim/simulation";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { addConnection } from "@/tiles/editOps";
import { Position } from "@/types";

// Building under a train that has RUN OUT OF TRACK.
//
// The situation is reachable in a real game and was reported from one: on Lake
// Valley, buy the ring but not the yellow station's entry, and the yellow train
// leaves its own depot onto a tile with no way out. It strands there, directly
// above its own station — and the tile it is standing on is exactly the tile
// the rescue has to be built on, which the "no building where a train is" rule
// used to refuse outright.

// A depot facing north into a tile that leads nowhere southward: the shape of
// the Lake Valley trap, minimal.
//   1,0  straight E-W  (the "ring": no southern connection)
//   1,1  depot facing north
function strandedLevel(): Level {
  return {
    "0,0": expandKind("straight", 1),
    "1,0": expandKind("straight", 1), // E-W only — nothing joins 1,1
    "2,0": expandKind("straight", 1),
    "1,1": expandKind("depot"), // opens north, into 1,0
  };
}

function simOn(level: Level) {
  return createSimulation({
    level,
    trains: [
      {
        id: "yellow",
        coord: { x: 1, y: 1 },
        entryPort: Position.Center,
        color: "yellow",
        type: "people",
        wagonCount: 0,
      },
    ],
    depotColors: { "1,1": "blue" }, // not yellow: it must leave, not park
  });
}

describe("a train that has run out of track", () => {
  it("is reported as stranded on the tile it is stuck on", () => {
    const level = strandedLevel();
    const sim = simOn(level);
    for (let i = 0; i < 40; i++) sim.step(0.1);

    expect(sim.trainTileId("yellow")).toBe("1,0");
    expect(sim.strandedOn("1,0")).toEqual(["yellow"]);
    // ...and only there.
    expect(sim.strandedOn("0,0")).toEqual([]);
  });

  it("is not confused with a train that merely has somewhere to wait", () => {
    // 1,0 gains its southern link, so the train has a way on. Held or moving,
    // it is not STRANDED, and building under it must stay refused.
    const level = strandedLevel();
    level["1,0"] = addConnection(level["1,0"], Position.Bottom, Position.Left);
    const sim = simOn(level);
    for (let i = 0; i < 10; i++) sim.step(0.1);
    expect(sim.strandedOn(sim.trainTileId("yellow"))).toEqual([]);
  });

  it("gets moving again once the missing link is laid under it", () => {
    const level = strandedLevel();
    const sim = simOn(level);
    for (let i = 0; i < 40; i++) sim.step(0.1);
    expect(sim.strandedOn("1,0")).toEqual(["yellow"]);

    // The rescue: the connection the train has been waiting for, on the very
    // tile it is standing on.
    level["1,0"] = addConnection(level["1,0"], Position.Bottom, Position.Left);
    sim.releaseStranded("yellow");

    // It leaves. (Not "and is still moving": this toy board is three tiles
    // long, so it runs to the far edge and stops again — the point is that it
    // is no longer stuck where it was.)
    // It leaves, westward along the link just laid. (Not "and is still
    // moving": this toy board is three tiles long, so it runs to the far edge
    // and stops again — the point is that it is no longer stuck where it was.)
    for (let i = 0; i < 60; i++) sim.step(0.1);
    expect(sim.trainTileId("yellow")).toBe("0,0");
    expect(sim.strandedOn("1,0")).toEqual([]);
  });

  it("never rewrites an exit the train already committed to", () => {
    // A moving train's head segment carries the port it visibly travelled
    // along; re-deriving it would jump the body onto another curve.
    const level = strandedLevel();
    level["1,0"] = addConnection(level["1,0"], Position.Bottom, Position.Left);
    const sim = simOn(level);
    for (let i = 0; i < 12; i++) sim.step(0.1);
    const before = sim.sampleTrain("yellow")[0].front.exitPort;
    sim.releaseStranded("yellow");
    expect(sim.sampleTrain("yellow")[0].front.exitPort).toBe(before);
  });
});
