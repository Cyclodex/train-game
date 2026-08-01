import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import type { Level, TileCell } from "@/tiles/model";
import { oneWay, twoWay, nWayLanes } from "@/tiles/lanes";
import {
  canParkOn,
  parkingRowAt,
  setParkingRow,
  toggleParkingRow,
  setParkingRowRun,
  setFacility,
  pruneParkingRows,
  isBlankCell,
  type RowSpec,
} from "@/tiles/editOps";
import { maxStallsPerTile, validateParking } from "@/tiles/parking";

const { Top, Right, Bottom, Left } = Position;

const street = (): TileCell => ({ connections: [], road: twoWay(Left, Right) });
const oneWayStreet = (): TileCell => ({ connections: [], road: [oneWay(Left, Right)] });
const bend = (): TileCell => ({ connections: [], road: [oneWay(Left, Bottom)] });
const KERB: RowSpec = { kind: "parallel" };
const BAYS: RowSpec = { kind: "perpendicular" };

describe("canParkOn — the cell-local half of the rules, so the tool can grey a kerb", () => {
  it("accepts a kerb on a straight road", () => {
    expect(canParkOn(street(), Left)).toBe(true);
    expect(canParkOn(street(), Right)).toBe(true);
  });

  it("refuses a tile with no road, a junction, and a bend", () => {
    expect(canParkOn({ connections: [] }, Left)).toBe(false);
    expect(canParkOn({ connections: [], road: [
      { from: Left, to: [Right, Bottom], index: 0 },
      { from: Right, to: [Left, Bottom], index: 0 },
      { from: Bottom, to: [Left, Right], index: 0 },
    ] }, Left)).toBe(false);
    // Nobody parks in a bend: the row's geometry is measured along from→opposite.
    expect(canParkOn(bend(), Left)).toBe(false);
  });

  it("allows the far bank only on a one-way street", () => {
    // Crossing to the far kerb means crossing oncoming traffic — legal only where
    // there is none.
    expect(canParkOn(street(), Left, "left")).toBe(false);
    expect(canParkOn(oneWayStreet(), Left, "left")).toBe(true);
  });

  it("refuses a second row hugging a kerb another row already owns", () => {
    // On an east-west street, the FAR bank of the eastbound approach and the NEAR
    // bank of the westbound one are the same strip of tarmac. Authoring both would
    // paint two ranks into one kerb and count every space twice.
    const withNorth = setParkingRow(oneWayStreet(), Left, "left", KERB);
    expect(canParkOn(withNorth, Left, "left")).toBe(true); // that very row
    const twoWayWithNorth = setParkingRow(street(), Right, "right", KERB);
    expect(canParkOn(twoWayWithNorth, Right, "right")).toBe(true);
    expect(canParkOn(twoWayWithNorth, Left, "left")).toBe(false);
  });
});

describe("setParkingRow / toggleParkingRow", () => {
  it("fills the kerb by default and never overruns it", () => {
    const cell = setParkingRow(street(), Left, "right", KERB);
    const row = parkingRowAt(cell, Left)!;
    expect(row.count).toBe(maxStallsPerTile("parallel", 200));
    // An over-long row is the one mistake the validator cannot forgive, so the
    // count is clamped however it is asked for.
    const greedy = setParkingRow(street(), Left, "right", { ...KERB, count: 99 });
    expect(parkingRowAt(greedy, Left)!.count).toBe(maxStallsPerTile("parallel", 200));
  });

  it("stores `side` only for the far bank, so a level round-trips minimal", () => {
    const near = setParkingRow(street(), Left, "right", KERB);
    expect(parkingRowAt(near, Left)!.side).toBeUndefined();
    const far = setParkingRow(oneWayStreet(), Left, "left", KERB);
    expect(parkingRowAt(far, Left, "left")!.side).toBe("left");
  });

  it("preserves every other field on the cell", () => {
    const base: TileCell = { ...street(), terrain: "urban", roadPriority: 1 };
    const next = setParkingRow(base, Left, "right", KERB);
    expect(next.terrain).toBe("urban");
    expect(next.roadPriority).toBe(1);
    expect(next.road).toBe(base.road);
  });

  it("returns the SAME reference when nothing changes", () => {
    // Load-bearing: the commit path keys on identity, so a no-op write must be
    // invisible to it.
    const bare = street();
    expect(setParkingRow(bare, Left, "right", undefined)).toBe(bare);
  });

  it("drops the parking key entirely when the last row goes", () => {
    // A leftover `{}` would keep isBlankCell reporting content for ever: erase the
    // road under it and the cell can never be pruned, yet draws nothing.
    const laid = setParkingRow(street(), Left, "right", KERB);
    const cleared = setParkingRow(laid, Left, "right", undefined);
    expect(cleared.parking).toBeUndefined();
    expect(isBlankCell({ connections: [], ...{} })).toBe(true);
  });

  it("toggles off only when the SAME kind is already there", () => {
    const kerb = toggleParkingRow(street(), Left, "right", KERB);
    expect(parkingRowAt(kerb, Left)!.kind).toBe("parallel");
    // A different kind REPLACES rather than clearing — the dock item is the kind
    // picker, so repeat-clicking is "off" and never a hidden cycle.
    const swapped = toggleParkingRow(kerb, Left, "right", BAYS);
    expect(parkingRowAt(swapped, Left)!.kind).toBe("perpendicular");
    const off = toggleParkingRow(swapped, Left, "right", BAYS);
    expect(parkingRowAt(off, Left)).toBeNull();
  });
});

describe("setParkingRowRun — one click lines a whole street", () => {
  const runLevel = (): Level => ({
    "0,0": street(),
    "1,0": street(),
    "2,0": street(),
    "3,0": street(),
  });

  it("paints every tile of the run from one click", () => {
    const lvl = runLevel();
    const patch = setParkingRowRun(lvl, "1,0", Left, "right", KERB);
    expect(Object.keys(patch).sort()).toEqual(["0,0", "1,0", "2,0", "3,0"]);
    for (const cell of Object.values(patch)) {
      expect(parkingRowAt(cell, Left)!.kind).toBe("parallel");
    }
  });

  it("makes a half-painted street UNIFORM rather than inverting it tile by tile", () => {
    const lvl = runLevel();
    lvl["2,0"] = setParkingRow(lvl["2,0"], Left, "right", KERB);
    // Clicking a bare tile lays the row everywhere, including the one that had it.
    const patch = setParkingRowRun(lvl, "0,0", Left, "right", KERB);
    for (const id of ["0,0", "1,0", "3,0"]) {
      expect(parkingRowAt(patch[id], Left)).not.toBeNull();
    }
    // Clicking a tile that already carries it clears the run instead.
    const laid = { ...lvl, ...setParkingRowRun(lvl, "0,0", Left, "right", KERB) };
    const cleared = setParkingRowRun(laid, "0,0", Left, "right", KERB);
    for (const cell of Object.values(cleared)) expect(parkingRowAt(cell, Left)).toBeNull();
  });

  it("steps over a tile no row may sit on and carries on past it", () => {
    const lvl = runLevel();
    lvl["2,0"] = { connections: [], road: [...twoWay(Left, Right), ...twoWay(Top, Bottom)] };
    const patch = setParkingRowRun(lvl, "0,0", Left, "right", KERB);
    expect(patch["2,0"]).toBeUndefined(); // the junction is skipped
  });

  it("never authors a level validateParking would reject", () => {
    // The whole point of the tool: what it lays must already be legal.
    const lvl = runLevel();
    const patch = setParkingRowRun(lvl, "1,0", Left, "right", KERB);
    const after: Level = { ...lvl, ...patch };
    expect(validateParking(after)).toEqual([]);
  });
});

describe("facilities and pruning", () => {
  it("joins a tile to a car park, and lets a bare facility be the only content", () => {
    // An AISLE tile carries `{facility}` and nothing else — that is how the sim
    // knows a car is still inside the car park.
    const aisle = setFacility({ connections: [], road: [oneWay(Left, Right)] }, "lot");
    expect(aisle.parking).toEqual({ facility: "lot" });
    expect(isBlankCell(aisle)).toBe(false);
  });

  it("leaving a car park drops the key again", () => {
    const joined = setFacility(street(), "lot");
    expect(setFacility(joined, undefined).parking).toBeUndefined();
  });

  it("keeps the rows when only the facility changes", () => {
    const withRow = setParkingRow(street(), Left, "right", KERB);
    const joined = setFacility(withRow, "lot");
    expect(joined.parking!.facility).toBe("lot");
    expect(parkingRowAt(joined, Left)).not.toBeNull();
  });

  it("prunes a row the road under it stopped supporting", () => {
    // Redrawing a two-way street as one-way orphans a far-bank row; redrawing a
    // straight as a bend orphans both. Without this the validator fires on a tile
    // the author never touched with the parking tool.
    const far = setParkingRow(oneWayStreet(), Left, "left", KERB);
    expect(parkingRowAt(far, Left, "left")).not.toBeNull();
    const nowTwoWay: TileCell = { ...far, road: twoWay(Left, Right) };
    expect(parkingRowAt(pruneParkingRows(nowTwoWay), Left, "left")).toBeNull();
    // And an untouched cell comes back by identity.
    const fine = setParkingRow(street(), Left, "right", KERB);
    expect(pruneParkingRows(fine)).toBe(fine);
  });

  it("prunes to nothing and drops the key with it", () => {
    const laid = setParkingRow(street(), Left, "right", KERB);
    const nowBend: TileCell = { ...laid, road: [oneWay(Left, Bottom)] };
    expect(pruneParkingRows(nowBend).parking).toBeUndefined();
  });
});

describe("what the tool cannot author", () => {
  it("a 90° rank never fits beside a wide street, and the tool must not offer it", () => {
    // canParkOn is cell-local so it says yes; the EDITOR additionally greys the
    // kerb via kerbFits. This test pins the underlying fact the greying rests on:
    // laid anyway, the validator rejects it.
    const wide: TileCell = { connections: [], road: nWayLanes(Left, Right, 3) };
    const laid = setParkingRow(wide, Left, "right", BAYS);
    const issues = validateParking({ "0,0": laid });
    expect(issues.map(i => i.message).join()).toMatch(/overhang/);
  });
});
