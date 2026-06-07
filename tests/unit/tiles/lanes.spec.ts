import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import {
  Lane,
  fromPairs,
  oneWay,
  twoWay,
  turns,
  lanesFrom,
  exitsFrom,
  roadPortsOf,
  laneMovements,
  roadEdges,
  isRoadJunction,
  laneCount,
  nWayLanes,
} from "@/tiles/lanes";

const { Top: T, Right: R, Bottom: B, Left: L } = Position;

describe("lane authoring helpers", () => {
  it("oneWay makes a single directed lane", () => {
    expect(oneWay(L, R)).toEqual({ from: L, to: [R], index: 0 });
  });

  it("twoWay makes one lane each direction", () => {
    expect(twoWay(L, R)).toEqual([
      { from: L, to: [R], index: 0 },
      { from: R, to: [L], index: 0 },
    ]);
  });

  it("turns makes an approach lane with explicit exits", () => {
    expect(turns(L, [R, B])).toEqual({ from: L, to: [R, B], index: 0 });
    expect(turns(L, [B], 1)).toEqual({ from: L, to: [B], index: 1 });
  });

  it("fromPairs builds one lane per approach with all its partners (behaviour-preserving)", () => {
    const lanes = fromPairs([
      [L, R],
      [T, B],
      [L, T],
      [L, B],
      [R, T],
      [R, B],
    ]);
    expect(lanes).toContainEqual({ from: L, to: [R, T, B], index: 0 });
    expect(lanes).toContainEqual({ from: R, to: [L, T, B], index: 0 });
    expect(lanes.filter(l => l.from === L)).toHaveLength(1);
  });
});

describe("lane query helpers", () => {
  const cross: Lane[] = fromPairs([
    [L, R],
    [T, B],
    [L, T],
  ]);

  it("lanesFrom returns the lanes of one approach", () => {
    expect(lanesFrom(cross, L)).toEqual([{ from: L, to: [R, T], index: 0 }]);
    expect(lanesFrom(undefined, L)).toEqual([]);
  });

  it("exitsFrom returns the union of permitted exits from a port", () => {
    expect(exitsFrom(cross, L).sort()).toEqual([R, T].sort());
    expect(exitsFrom(cross, B)).toEqual([T]);
  });

  it("roadPortsOf returns every port the road touches", () => {
    expect(roadPortsOf(cross).sort()).toEqual([T, R, B, L].sort());
    expect(roadPortsOf(undefined)).toEqual([]);
  });

  it("laneMovements expands each lane into directed from->to movements", () => {
    const oneway: Lane[] = [turns(L, [R, B])];
    expect(laneMovements(oneway)).toEqual([
      { from: L, to: R },
      { from: L, to: B },
    ]);
  });
});

describe("roadEdges", () => {
  it("returns one order-normalised undirected edge per physical segment", () => {
    const { Top: T, Right: R, Bottom: B, Left: L } = Position;
    // A two-way straight is a single edge despite two lanes (order-normalised by
    // numeric Position, so R<L here -> [R, L]).
    const straight = roadEdges(twoWay(L, R));
    expect(straight).toHaveLength(1);
    expect([...straight[0]].sort()).toEqual([L, R].sort());
    // A junction collapses its movements to unique edges.
    const cross = fromPairs([[L, R], [T, B], [L, T]]);
    const edges = roadEdges(cross).map(([a, b]) => `${a}-${b}`).sort();
    // L-R, T-B, L-T (each once, order-normalised L<R etc by numeric Position).
    expect(edges).toEqual([...new Set(edges)].sort()); // no duplicates
    expect(roadEdges(cross)).toHaveLength(3);
  });
  it("returns [] for undefined", () => {
    expect(roadEdges(undefined)).toEqual([]);
  });
});

describe("isRoadJunction", () => {
  it("is true when the road touches more than two ports", () => {
    expect(isRoadJunction(fromPairs([[L, R], [L, T]]))).toBe(true);
  });
  it("is false for a straight or one-way road", () => {
    expect(isRoadJunction(twoWay(L, R))).toBe(false);
    expect(isRoadJunction([oneWay(L, R)])).toBe(false);
  });
  it("is false for undefined / empty", () => {
    expect(isRoadJunction(undefined)).toBe(false);
    expect(isRoadJunction([])).toBe(false);
  });
});

describe("laneCount", () => {
  it("returns 0 for undefined/empty road", () => {
    expect(laneCount(undefined, Position.Left)).toBe(0);
    expect(laneCount([], Position.Left)).toBe(0);
  });

  it("returns 1 for a single-lane approach (index 0 only)", () => {
    const road = twoWay(Position.Left, Position.Right);
    expect(laneCount(road, Position.Left)).toBe(1);
    expect(laneCount(road, Position.Right)).toBe(1);
    expect(laneCount(road, Position.Top)).toBe(0);
  });

  it("returns N when indices 0..N-1 are all present", () => {
    const road = nWayLanes(Position.Left, Position.Right, 3);
    expect(laneCount(road, Position.Left)).toBe(3);
    expect(laneCount(road, Position.Right)).toBe(3);
  });
});

describe("nWayLanes", () => {
  it("generates count lanes per direction", () => {
    const road = nWayLanes(Position.Left, Position.Right, 2);
    expect(road).toHaveLength(4);
    expect(road.filter(l => l.from === Position.Left).map(l => l.index).sort()).toEqual([0, 1]);
    expect(road.filter(l => l.from === Position.Right).map(l => l.index).sort()).toEqual([0, 1]);
  });

  it("count=1 produces same structure as twoWay", () => {
    const a = nWayLanes(Position.Left, Position.Right, 1);
    expect(a).toHaveLength(2);
    expect(a[0].index).toBe(0);
    expect(a[1].index).toBe(0);
  });
});
