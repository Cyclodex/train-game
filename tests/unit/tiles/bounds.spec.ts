import { describe, it, expect } from "vitest";
import { levelBounds, normaliseLevel, translateLevel, translateTrains } from "@/tiles/bounds";
import { expandKind } from "@/tiles/kinds";
import { Level } from "@/tiles/model";

const straight = () => expandKind("straight", 1);

function levelAt(...ids: string[]): Level {
  const out: Level = {};
  for (const id of ids) out[id] = straight();
  return out;
}

describe("levelBounds", () => {
  it("derives the grid from the tiles, not from a fixed board size", () => {
    // The whole point: a 12-wide level reports 12 columns. The old views asked
    // gameConfig for 7 and cropped anything past it.
    const b = levelBounds(levelAt("0,0", "11,3"));
    expect(b.cols).toBe(12);
    expect(b.rows).toBe(4);
  });

  it("keeps the origin in the grid even when the level starts further out", () => {
    // Coordinates are absolute: "5,5" must render at column 5, so the grid spans
    // from the origin regardless of where the content begins.
    const b = levelBounds(levelAt("5,5"));
    expect(b).toMatchObject({ minX: 5, minY: 5, maxX: 5, maxY: 5, cols: 6, rows: 6 });
  });

  it("gives an empty level something to render into", () => {
    expect(levelBounds({})).toMatchObject({ cols: 1, rows: 1 });
    expect(levelBounds({}, { cols: 8, rows: 6 })).toMatchObject({ cols: 8, rows: 6 });
  });

  it("pads up to a minimum without ever shrinking a bigger level", () => {
    const b = levelBounds(levelAt("0,0", "20,1"), { cols: 8, rows: 6 });
    expect(b.cols).toBe(21); // content wins
    expect(b.rows).toBe(6); // minimum wins
  });
});

describe("normaliseLevel — growing a world upward / leftward", () => {
  it("re-bases negative coordinates to the origin", () => {
    // Painting off the top-left is how a world grows in those directions. The
    // engine assumes the world starts at 0,0 (roadEntries' off-grid test, the
    // generator, the validator), so instead of teaching all of them about
    // negative coordinates the level is shifted.
    const { level, dx, dy } = normaliseLevel(levelAt("-2,-1", "0,0"));
    expect({ dx, dy }).toEqual({ dx: 2, dy: 1 });
    expect(Object.keys(level).sort()).toEqual(["0,0", "2,1"]);
  });

  it("is a no-op for a level that already starts at or after the origin", () => {
    const before = levelAt("0,0", "3,2");
    const { level, dx, dy } = normaliseLevel(before);
    expect({ dx, dy }).toEqual({ dx: 0, dy: 0 });
    expect(level).toBe(before); // same object — the common case costs nothing
  });

  it("shifts only as far as needed on each axis independently", () => {
    const { dx, dy } = normaliseLevel(levelAt("-3,4"));
    expect({ dx, dy }).toEqual({ dx: 3, dy: 0 });
  });
});

describe("translateLevel / translateTrains", () => {
  it("moves tiles without touching their contents", () => {
    const before = levelAt("1,1");
    const after = translateLevel(before, 2, 3);
    expect(Object.keys(after)).toEqual(["3,4"]);
    // Connections are port-relative, so a tile means the same thing wherever it is.
    expect(after["3,4"]).toBe(before["1,1"]);
  });

  it("moves a train's home depot and its destinations with the level", () => {
    // A re-base that forgot the trains would strand every one of them off its
    // depot — and the level itself would still validate, so nothing would say so.
    const trains = {
      t1: { id: "t1", x: 0, y: 0, destinations: ["4,2"] },
    };
    const moved = translateTrains(trains, 2, 1);
    expect(moved.t1).toMatchObject({ x: 2, y: 1, destinations: ["6,3"] });
  });

  it("returns the trains untouched when there is no shift", () => {
    const trains = { t1: { id: "t1", x: 1, y: 1 } };
    expect(translateTrains(trains, 0, 0)).toBe(trains);
  });
});
