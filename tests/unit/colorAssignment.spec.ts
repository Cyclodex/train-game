import { describe, it, expect } from "vitest";
import { assignColors, TrainStart } from "@/utils/colorAssignment";
import { makeRng, Colors } from "@/utils/globalHelpers";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";

/** A level with `depotCount` depots in a row plus one leading straight tile. */
function levelWithDepots(depotCount: number): Level {
  const lvl: Level = {};
  lvl["0,0"] = expandKind("straight", 1);
  for (let i = 0; i < depotCount; i++) {
    const x = i + 1;
    lvl[`${x},0`] = expandKind("depot", 1);
  }
  return lvl;
}

describe("assignColors", () => {
  it("colours every depot and every train", () => {
    const level = levelWithDepots(3);
    const trains: TrainStart[] = [{ id: "t1", x: 1, y: 0 }];
    const { depotColors, trainColors } = assignColors(level, trains, makeRng(1));

    expect(Object.keys(depotColors).sort()).toEqual(["1,0", "2,0", "3,0"]);
    expect(Object.keys(trainColors)).toEqual(["t1"]);
    for (const c of Object.values(depotColors)) expect(Colors).toContain(c);
    for (const c of Object.values(trainColors)) expect(Colors).toContain(c);
  });

  it("gives every train a matching depot that is not its start depot", () => {
    const level = levelWithDepots(4);
    const trains: TrainStart[] = [
      { id: "t1", x: 1, y: 0 },
      { id: "t2", x: 2, y: 0 },
    ];
    const { depotColors, trainColors } = assignColors(level, trains, makeRng(7));

    for (const train of trains) {
      const startId = `${train.x},${train.y}`;
      const match = Object.entries(depotColors).find(
        ([id, color]) => id !== startId && color === trainColors[train.id]
      );
      expect(match, `train ${train.id} has a non-start matching depot`).toBeDefined();
    }
  });

  it("reserves a distinct home depot per train so same colours don't collide", () => {
    // Two trains; with >=2 non-start depots they must own different depots,
    // so a parked train never blocks the other's only home.
    const level = levelWithDepots(4);
    const trains: TrainStart[] = [
      { id: "t1", x: 1, y: 0 },
      { id: "t2", x: 1, y: 0 }, // same start, to stress reservation
    ];
    const { depotColors, trainColors } = assignColors(level, trains, makeRng(3));

    const homes = trains.map(t => {
      const startId = `${t.x},${t.y}`;
      return Object.keys(depotColors).find(
        id => id !== startId && depotColors[id] === trainColors[t.id]
      );
    });
    expect(homes[0]).toBeDefined();
    expect(homes[1]).toBeDefined();
    expect(homes[0]).not.toBe(homes[1]);
  });

  it("solves n trains sitting in n depots — the case greedy assignment could not", () => {
    // The natural shape of a level: every train starts in its own station. The
    // only valid answer is a DERANGEMENT, and first-fit greedy cannot find one —
    // it gives depot B to the train from A and depot A to the train from B, then
    // the third train has nothing left but its own start, falls back to sharing,
    // and two trains end up the same colour. Whichever arrives second is stuck
    // forever, because a parked train occupies its depot tile.
    const level = levelWithDepots(3);
    const trains: TrainStart[] = [
      { id: "t1", x: 1, y: 0 },
      { id: "t2", x: 2, y: 0 },
      { id: "t3", x: 3, y: 0 },
    ];
    const { depotColors, trainColors } = assignColors(level, trains, makeRng(5));

    // Every train has a matching depot, and no two trains want the same one.
    const homes = trains.map(t => {
      const startId = `${t.x},${t.y}`;
      return Object.keys(depotColors).find(
        id => id !== startId && depotColors[id] === trainColors[t.id]
      );
    });
    for (const [i, home] of homes.entries()) {
      expect(home, `train ${trains[i].id} has a non-start home`).toBeDefined();
    }
    expect(new Set(homes).size).toBe(trains.length);
  });

  it("gives depots distinct colours while the palette lasts", () => {
    // Two depots sharing a colour starves a train however well the homes are
    // matched, because the simulation parks a train in the first depot of its
    // colour it reaches.
    const level = levelWithDepots(4);
    const colors = Object.values(assignColors(level, [], makeRng(11)).depotColors);
    expect(new Set(colors).size).toBe(4);
  });

  it("is deterministic for a given seed and varies across seeds", () => {
    const level = levelWithDepots(4);
    const trains: TrainStart[] = [{ id: "t1", x: 1, y: 0 }];

    const a = assignColors(level, trains, makeRng(42));
    const b = assignColors(level, trains, makeRng(42));
    expect(b).toEqual(a);

    // At least one of a handful of other seeds should differ somewhere.
    const differs = [1, 2, 3, 99].some(seed => {
      const c = assignColors(level, trains, makeRng(seed));
      return JSON.stringify(c) !== JSON.stringify(a);
    });
    expect(differs).toBe(true);
  });

  it("degrades gracefully with a single depot (train homes there)", () => {
    const level = levelWithDepots(1);
    const trains: TrainStart[] = [{ id: "t1", x: 5, y: 5 }]; // start elsewhere
    const { depotColors, trainColors } = assignColors(level, trains, makeRng(1));
    expect(trainColors.t1).toBe(depotColors["1,0"]);
  });
});

describe("makeRng", () => {
  it("produces the same stream for the same seed", () => {
    const r1 = makeRng(123);
    const r2 = makeRng(123);
    const a = [r1(), r1(), r1()];
    const b = [r2(), r2(), r2()];
    expect(b).toEqual(a);
  });

  it("returns values in [0, 1)", () => {
    const r = makeRng(5);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
