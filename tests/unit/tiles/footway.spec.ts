import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level, TileCell } from "@/tiles/model";
import { nWayLanes, twoWay } from "@/tiles/lanes";
import { expandKind } from "@/tiles/kinds";
import {
  hasFootCrossing,
  hasFootway,
  pavementOffsets,
  pavementOffsetFor,
  pavementPaths,
  planWalk,
  roadHalfUnits,
  sideOfPlot,
  walkNeighbours,
} from "@/tiles/footway";

const town = (): TileCell => ({ connections: [], terrain: "urban" });
const street = (from = Position.Left, to = Position.Right): TileCell => ({
  connections: [],
  road: twoWay(from, to),
  terrain: "urban",
});

describe("footways: derived by default, opt out explicitly", () => {
  it("gives every street a pavement without anyone asking", () => {
    expect(hasFootway(street())).toBe(true);
    // ...which is what lets every board written before footways existed grow
    // them for free.
    expect(hasFootway(town())).toBe(false);
    expect(hasFootway(expandKind("straight", 1))).toBe(false);
  });

  it("takes them away only when the tile says so", () => {
    expect(hasFootway({ ...street(), footway: "none" })).toBe(false);
    expect(hasFootway({ ...street(), footway: "both" })).toBe(true);
  });

  it("pushes the pavement out on a wider road", () => {
    const narrow = street();
    const wide: TileCell = {
      connections: [],
      road: nWayLanes(Position.Left, Position.Right, 3),
    };
    expect(roadHalfUnits(wide)).toBeGreaterThan(roadHalfUnits(narrow));
    const [a] = pavementOffsets(wide);
    const [b] = pavementOffsets(narrow);
    expect(a).toBeGreaterThan(b);
    // Symmetric: one pavement each side of the carriageway.
    expect(pavementOffsets(narrow)[1]).toBe(-pavementOffsets(narrow)[0]);
  });

  it("draws one band per side and never twice for a two-way street", () => {
    // twoWay is two lanes over the SAME ground; painting per lane would stack
    // two bands per side and show a seam at every tile edge.
    const paths = pavementPaths(street()).match(/<path /g) ?? [];
    expect(paths).toHaveLength(2);
    expect(pavementPaths(town())).toBe("");
    expect(pavementPaths({ ...street(), footway: "none" })).toBe("");
  });
});

describe("the walking graph", () => {
  function highStreet(): Level {
    const level: Level = {};
    for (let x = 0; x <= 4; x++) level[`${x},1`] = street();
    for (let x = 0; x <= 4; x++) level[`${x},0`] = town(); // houses along the north kerb
    for (let x = 0; x <= 4; x++) level[`${x},2`] = town(); // and the south
    return level;
  }

  it("steps between adjoining pavements, and nowhere else", () => {
    const level = highStreet();
    expect(walkNeighbours(level, "2,1").sort()).toEqual(["1,1", "3,1"]);
    // A house is not a pavement: you step off it onto one, you do not walk
    // THROUGH it (which is what keeps people visibly on the street).
    expect(walkNeighbours(level, "2,0")).toEqual([]);
  });

  it("knows which pavement a house stands on", () => {
    const level = highStreet();
    // North and south of the same street are opposite sides, and the sign
    // matches the one `pavementOffsets` uses so the walker lands on the paint.
    expect(sideOfPlot(level, "2,0", "2,1")).toBe(-1);
    expect(sideOfPlot(level, "2,2", "2,1")).toBe(1);
  });

  it("routes along one pavement when both doors are on the same side", () => {
    const level = highStreet();
    const route = planWalk(level, "0,0", "4,0");
    expect(route?.tiles).toEqual(["0,1", "1,1", "2,1", "3,1", "4,1"]);
    // Never changes side: there is no crossing, and none is needed.
    expect(new Set(route?.sides)).toEqual(new Set([-1]));
  });

  it("WILL NOT CROSS THE ROAD without a crossing", () => {
    // The mechanic, stated as a refusal. Two doors facing each other across a
    // street with no zebra between them are not walkable, and the citizen layer
    // falls back to its clock rather than teleporting somebody over the tarmac.
    const level = highStreet();
    expect(planWalk(level, "2,0", "2,2")).toBeNull();
  });

  it("crosses at a zebra, and takes the detour to reach one", () => {
    const level = highStreet();
    level["4,1"] = { ...street(), footCrossing: true };
    expect(hasFootCrossing(level["4,1"])).toBe(true);
    expect(hasFootCrossing(level["2,1"])).toBe(false);

    const route = planWalk(level, "2,0", "2,2");
    expect(route).not.toBeNull();
    // Down to the crossing, over it, and back — the detour is the cost of
    // putting the zebra where it is.
    expect(route?.tiles).toEqual(["2,1", "3,1", "4,1", "4,1", "3,1", "2,1"]);
    // The tile appears twice: once on each pavement. That repeat IS the crossing.
    expect(route?.sides).toEqual([-1, -1, -1, 1, 1, 1]);
  });

  it("crosses on the spot when the zebra is right there", () => {
    const level = highStreet();
    level["2,1"] = { ...street(), footCrossing: true };
    const route = planWalk(level, "2,0", "2,2");
    expect(route?.tiles).toEqual(["2,1", "2,1"]);
    expect(route?.sides).toEqual([-1, 1]);
  });

  it("returns null rather than a bad route when there is no way to walk", () => {
    const level = highStreet();
    expect(planWalk(level, "2,0", "2,0")).toBeNull(); // already there
    // A house with no street in reach.
    level["9,9"] = town();
    expect(planWalk(level, "2,0", "9,9")).toBeNull();
    // Two streets with a gap between them: no pavement joins the pieces.
    const split: Level = {
      "0,1": street(),
      "0,0": town(),
      "4,1": street(),
      "4,0": town(),
    };
    expect(planWalk(split, "0,0", "4,0")).toBeNull();
  });

  it("will not route over a street that opted out of its pavement", () => {
    const level = highStreet();
    level["2,1"] = { ...street(), footway: "none" };
    // The motorway in the middle severs the walk; nothing else can get past it.
    expect(planWalk(level, "0,0", "4,0")).toBeNull();
    // ...and a crossing on a street with no pavement is not a crossing.
    expect(hasFootCrossing({ ...street(), footway: "none", footCrossing: true })).toBe(false);
  });
});

describe("which bank of the street a walker is on", () => {
  // A `side` belongs to the STREET; the offset the geometry sampler wants
  // belongs to the walker's DIRECTION OF TRAVEL. Getting those two confused put
  // people on the wrong pavement the moment they walked back the other way, and
  // the driveway at the far end then dragged them over the carriageway.
  it("flips the offset when the walk runs against the tile's own direction", () => {
    const cell = street(Position.Left, Position.Right); // canonical: eastbound
    const [half] = pavementOffsets(cell);

    // Eastbound, side +1: right of travel, so the south bank.
    expect(pavementOffsetFor(cell, 1, Position.Left, Position.Right)).toBeCloseTo(half);
    // Westbound, side +1: STILL the south bank, which is now on the left — so
    // the offset handed to the sampler has to change sign.
    expect(pavementOffsetFor(cell, -1, Position.Right, Position.Left)).toBeCloseTo(half);
    expect(pavementOffsetFor(cell, 1, Position.Right, Position.Left)).toBeCloseTo(-half);
  });

  it("agrees with the side a plot is assigned, whichever way it is walked", () => {
    const level: Level = { "1,1": street(), "1,0": town(), "1,2": town() };
    const north = sideOfPlot(level, "1,0", "1,1") as 1 | -1;
    const south = sideOfPlot(level, "1,2", "1,1") as 1 | -1;
    expect(north).toBe(-south);
    // The house north of the street is north of the centreline no matter which
    // way its owner happens to be walking.
    const cell = level["1,1"];
    expect(pavementOffsetFor(cell, north, Position.Left, Position.Right)).toBeLessThan(0);
    expect(pavementOffsetFor(cell, north, Position.Right, Position.Left)).toBeGreaterThan(0);
  });

  it("keeps a bend's two directions on the same pavement", () => {
    const bend: TileCell = { connections: [], road: twoWay(Position.Top, Position.Right) };
    const [half] = pavementOffsets(bend);
    expect(pavementOffsetFor(bend, 1, Position.Top, Position.Right)).toBeCloseTo(half);
    expect(pavementOffsetFor(bend, 1, Position.Right, Position.Top)).toBeCloseTo(-half);
  });
});
