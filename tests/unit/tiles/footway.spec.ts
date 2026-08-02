import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level, TileCell } from "@/tiles/model";
import { nWayLanes, twoWay } from "@/tiles/lanes";
import { expandKind } from "@/tiles/kinds";
import {
  hasFootway,
  pavementOffsets,
  pavementPaths,
  planWalk,
  roadHalfUnits,
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

  it("routes out of one door, along the street, and in at the other", () => {
    const level = highStreet();
    const route = planWalk(level, "0,0", "4,2");
    expect(route).toEqual(["0,0", "0,1", "1,1", "2,1", "3,1", "4,1", "4,2"]);
  });

  it("collapses to three steps when both doors share a street", () => {
    const level = highStreet();
    expect(planWalk(level, "2,0", "2,2")).toEqual(["2,0", "2,1", "2,2"]);
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
    expect(planWalk(level, "0,0", "4,2")).toBeNull();
  });
});
