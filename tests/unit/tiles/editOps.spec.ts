import { describe, it, expect } from "vitest";
import { Position, ActiveIntersection } from "@/types";
import { samePair, TileCell } from "@/tiles/model";
import {
  emptyCell,
  toggleConnection,
  addConnection,
  removeConnection,
  setDepot,
  rotateDepot,
  depotFacing,
  toggleSignalPort,
  toggleRoad,
  addRoad,
  removeRoad,
  cycleDefaultArm,
} from "@/tiles/editOps";

const { Top, Right, Bottom, Left, Center } = Position;
const CROSS_FULL: [Position, Position][] = [
  [Top, Bottom],
  [Left, Right],
  [Top, Right],
  [Right, Bottom],
  [Bottom, Left],
  [Left, Top],
];
const TJUNCTION: [Position, Position][] = [
  [Left, Right],
  [Left, Top],
  [Right, Top],
];
const has = (cell: { connections: [Position, Position][] }, p: [Position, Position]) =>
  cell.connections.some(c => samePair(c, p));
// A road edge is present as a two-way edge when both directed lane movements
// (a->b and b->a) exist among the cell's lanes.
const hasRoadPair = (cell: TileCell, p: [Position, Position]) => {
  const road = cell.road ?? [];
  const ab = road.some(l => l.from === p[0] && l.to.includes(p[1]));
  const ba = road.some(l => l.from === p[1] && l.to.includes(p[0]));
  return ab && ba;
};

describe("toggleConnection", () => {
  it("adds when absent and removes when present, order-independent", () => {
    let c = emptyCell();
    c = toggleConnection(c, Top, Bottom);
    expect(has(c, [Top, Bottom])).toBe(true);
    // Toggling the reversed pair removes it.
    c = toggleConnection(c, Bottom, Top);
    expect(has(c, [Top, Bottom])).toBe(false);
  });

  it("accumulates distinct connections into a junction", () => {
    let c = emptyCell();
    c = toggleConnection(c, Left, Right);
    c = toggleConnection(c, Left, Top);
    c = toggleConnection(c, Right, Top);
    expect(c.connections).toHaveLength(3);
  });

  it("does not mutate the input cell", () => {
    const c = emptyCell();
    toggleConnection(c, Top, Bottom);
    expect(c.connections).toHaveLength(0);
  });
});

describe("addConnection", () => {
  it("adds when absent", () => {
    const c = addConnection(emptyCell(), Top, Bottom);
    expect(has(c, [Top, Bottom])).toBe(true);
  });

  it("is idempotent — re-adding the same pair does not remove it", () => {
    let c = addConnection(emptyCell(), Top, Bottom);
    c = addConnection(c, Bottom, Top); // reversed, already present
    expect(has(c, [Top, Bottom])).toBe(true);
    expect(c.connections).toHaveLength(1);
  });

  it("accumulates distinct pairs into a junction", () => {
    let c = addConnection(emptyCell(), Left, Right);
    c = addConnection(c, Top, Bottom);
    expect(c.connections).toHaveLength(2);
  });

  it("does not mutate the input cell", () => {
    const c = emptyCell();
    addConnection(c, Top, Bottom);
    expect(c.connections).toHaveLength(0);
  });
});

describe("removeConnection", () => {
  it("removes a specific pair regardless of order", () => {
    let c = emptyCell();
    c = toggleConnection(c, Top, Right);
    c = removeConnection(c, Right, Top);
    expect(c.connections).toHaveLength(0);
  });
});

describe("depot ops", () => {
  it("setDepot makes a border<->Center depot with role", () => {
    const c = setDepot(emptyCell(), Right);
    expect(has(c, [Right, Center])).toBe(true);
    expect(c.role).toBe("depot");
    expect(depotFacing(c)).toBe(Right);
  });

  it("rotateDepot cycles facing N->E->S->W", () => {
    let c = setDepot(emptyCell(), Top);
    c = rotateDepot(c);
    expect(depotFacing(c)).toBe(Right);
    c = rotateDepot(c);
    expect(depotFacing(c)).toBe(Bottom);
  });

  it("depotFacing is null for non-depot cells", () => {
    expect(depotFacing(emptyCell())).toBeNull();
  });
});

describe("toggleSignalPort", () => {
  it("adds then removes a port", () => {
    let c = emptyCell();
    c = toggleSignalPort(c, Right);
    expect(c.signals).toEqual([Right]);
    c = toggleSignalPort(c, Right);
    expect(c.signals).toEqual([]);
  });
});

describe("cycleDefaultArm", () => {
  it("from no authored arm, advances past the computed first-valid arm", () => {
    // Full cross: all three arms valid at Top, computed first-valid is Left.
    const c = cycleDefaultArm({ connections: CROSS_FULL }, Top);
    expect(c.defaultArms?.[Top]).toBe(ActiveIntersection.Straight);
  });

  it("advances through valid arms and wraps", () => {
    let c: TileCell = { connections: CROSS_FULL };
    c = cycleDefaultArm(c, Top); // -> Straight
    c = cycleDefaultArm(c, Top); // -> Right
    expect(c.defaultArms?.[Top]).toBe(ActiveIntersection.Right);
    c = cycleDefaultArm(c, Top); // wraps -> Left
    expect(c.defaultArms?.[Top]).toBe(ActiveIntersection.Left);
  });

  it("skips arms whose exit is not a real partner", () => {
    // T-junction Left entry: only Left (->Top) and Straight (->Right) are valid;
    // Right (->Bottom) is not a partner, so cycling never lands on it.
    let c: TileCell = { connections: TJUNCTION };
    c = cycleDefaultArm(c, Left); // computed first-valid Left -> next Straight
    expect(c.defaultArms?.[Left]).toBe(ActiveIntersection.Straight);
    c = cycleDefaultArm(c, Left); // Straight -> wraps to Left (Right skipped)
    expect(c.defaultArms?.[Left]).toBe(ActiveIntersection.Left);
  });

  it("is a no-op on a non-junction entry", () => {
    const c = cycleDefaultArm({ connections: [[Top, Bottom]] }, Top);
    expect(c.defaultArms).toBeUndefined();
  });

  it("does not mutate the input cell", () => {
    const c = { connections: CROSS_FULL };
    cycleDefaultArm(c, Top);
    expect((c as { defaultArms?: unknown }).defaultArms).toBeUndefined();
  });
});

describe("road ops", () => {
  it("toggleRoad adds when absent and removes when present, order-independent", () => {
    let c = emptyCell();
    c = toggleRoad(c, Top, Bottom);
    expect(hasRoadPair(c, [Top, Bottom])).toBe(true);
    c = toggleRoad(c, Bottom, Top); // reversed pair removes it
    expect(hasRoadPair(c, [Top, Bottom])).toBe(false);
  });

  it("road is independent of rail connections on the same cell", () => {
    let c = toggleConnection(emptyCell(), Left, Right); // rail
    c = toggleRoad(c, Top, Bottom); // road crossing it -> a level crossing
    expect(has(c, [Left, Right])).toBe(true);
    expect(hasRoadPair(c, [Top, Bottom])).toBe(true);
  });

  it("addRoad is idempotent and accumulates a road junction", () => {
    // Each two-way edge is one index-0 lane per approach. A single edge L<->R is
    // two lanes (from L, from R); adding a crossing edge makes four (a junction).
    let c = addRoad(emptyCell(), Left, Right);
    c = addRoad(c, Right, Left); // reversed, already present — idempotent
    expect(hasRoadPair(c, [Left, Right])).toBe(true);
    expect(c.road).toHaveLength(2); // lanes from L and from R
    c = addRoad(c, Top, Bottom);
    expect(hasRoadPair(c, [Top, Bottom])).toBe(true);
    expect(c.road).toHaveLength(4); // + lanes from T and from B
  });

  it("removeRoad removes a specific pair regardless of order", () => {
    let c = toggleRoad(emptyCell(), Top, Right);
    c = removeRoad(c, Right, Top);
    expect(c.road).toHaveLength(0);
  });

  it("does not mutate the input cell", () => {
    const c = emptyCell();
    toggleRoad(c, Top, Bottom);
    expect(c.road).toBeUndefined();
  });
});
