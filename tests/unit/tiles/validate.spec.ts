import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { fromPairs, turns, oneWay, nWayLanes } from "@/tiles/lanes";
import { expandKind } from "@/tiles/kinds";
import { validateLevel, validateRoads } from "@/tiles/validate";

const { Top, Bottom, Left, Right } = Position;

// depot(->Right) - straight - depot(->Left): a clean, fully connected line.
const goodLevel: Level = {
  "0,0": expandKind("depot", 1), // faces Right
  "1,0": expandKind("straight", 1), // Left-Right
  "2,0": expandKind("depot", 3), // faces Left
};

describe("validateLevel", () => {
  it("accepts a fully connected line and confirms the route", () => {
    const res = validateLevel(goodLevel, [{ from: "0,0", to: "2,0" }]);
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it("flags dangling track with no connecting neighbour", () => {
    const res = validateLevel({ "0,0": expandKind("straight", 1) });
    expect(res.ok).toBe(false);
    expect(res.issues.some(i => i.type === "dangling-track")).toBe(true);
  });

  it("flags an isolated depot", () => {
    const res = validateLevel({ "0,0": expandKind("depot", 1) });
    expect(res.issues.some(i => i.type === "isolated-depot")).toBe(true);
  });

  it("flags a disconnected train route", () => {
    // Two separate one-tile lines that never meet.
    const level: Level = {
      "0,0": expandKind("depot", 1),
      "1,0": expandKind("depot", 3),
      "5,5": expandKind("depot", 1),
      "6,5": expandKind("depot", 3),
    };
    const res = validateLevel(level, [{ from: "0,0", to: "5,5" }]);
    expect(res.issues.some(i => i.type === "route-disconnected")).toBe(true);
  });
});

describe("validateRoads", () => {
  it("treats a road that runs off the map edge as valid", () => {
    // A lone road tile; both ends point at off-grid coords -> map-edge ends.
    const level: Level = { "3,3": { connections: [], road: fromPairs([[Top, Bottom]]) } };
    expect(validateRoads(level).ok).toBe(true);
  });

  it("accepts two tiles whose roads join", () => {
    const level: Level = {
      "0,0": { connections: [], road: fromPairs([[Left, Right]]) },
      "1,0": { connections: [], road: fromPairs([[Left, Right]]) },
    };
    expect(validateRoads(level).ok).toBe(true);
  });

  it("flags a road pointing at an existing tile with no road back", () => {
    const level: Level = {
      "0,0": { connections: [], road: fromPairs([[Left, Right]]) }, // Right -> 1,0
      "1,0": expandKind("straight", 1), // exists, rail only, no road
    };
    const res = validateRoads(level);
    expect(res.ok).toBe(false);
    expect(res.issues.some(i => i.type === "dangling-road")).toBe(true);
  });

  it("ignores cells that have no road", () => {
    expect(validateRoads({ "0,0": expandKind("straight", 1) }).ok).toBe(true);
  });
});

describe("validateRoads — lane invariants", () => {
  const { Right: R, Bottom: B, Left: L } = Position;

  it("flags two lanes sharing the same (from, index)", () => {
    const level = {
      "0,0": { connections: [], road: [turns(L, [R], 0), turns(L, [B], 0)] },
    };
    const { ok, issues } = validateRoads(level);
    expect(ok).toBe(false);
    expect(issues.some(i => i.type === "lane-index-clash")).toBe(true);
  });

  it("flags a junction approach with no permitted exit", () => {
    const level = {
      "0,0": { connections: [], road: [turns(L, [], 0)] },
    };
    const { ok, issues } = validateRoads(level);
    expect(ok).toBe(false);
    expect(issues.some(i => i.type === "lane-no-exit")).toBe(true);
  });

  it("accepts a well-formed one-way lane", () => {
    const level = {
      "0,0": { connections: [], road: [oneWay(L, R)] },
      "1,0": { connections: [], road: [oneWay(L, R)] },
    };
    expect(validateRoads(level).ok).toBe(true);
  });
});

describe("validateRoads — lane-index-gap", () => {
  it("flags a gap in lane indices (e.g. 0, 2 without 1)", () => {
    const level = {
      "0,0": {
        connections: [],
        road: [
          { from: Position.Left, to: [Position.Right], index: 0 },
          { from: Position.Left, to: [Position.Right], index: 2 }, // gap: missing 1
          { from: Position.Right, to: [Position.Left], index: 0 },
        ],
      },
    };
    const result = validateRoads(level);
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.type === "lane-index-gap")).toBe(true);
  });

  it("passes for contiguous indices 0..N-1", () => {
    const level = {
      "0,0": { connections: [], road: nWayLanes(Position.Left, Position.Right, 3) },
    };
    expect(validateRoads(level).ok).toBe(true);
  });

  it("passes for single-lane (only index 0)", () => {
    const level = {
      "0,0": {
        connections: [],
        road: [
          { from: Position.Left, to: [Position.Right], index: 0 },
          { from: Position.Right, to: [Position.Left], index: 0 },
        ],
      },
    };
    expect(validateRoads(level).ok).toBe(true);
  });
});
