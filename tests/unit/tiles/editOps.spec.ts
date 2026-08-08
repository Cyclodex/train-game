import { describe, it, expect } from "vitest";
import { Position, ActiveIntersection } from "@/types";
import { samePair, TileCell, Level } from "@/tiles/model";
import { lanesAllowingExit, nWayLanes, twoWay } from "@/tiles/lanes";
import { validateRoads } from "@/tiles/validate";
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
  toggleBusLane,
  toggleCycleLane,
  setLaneKind,
  streetRunLanes,
  setBusLaneRun,
  toggleCycleLaneRun,
  syncJunctionBusGates,
  syncJunctionBusGatesAround,
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

  it("wires turns onto EVERY lane of a multi-lane junction (not just lane 0)", () => {
    // Build a 2-lane 4-way cross, then draw the four turn edges with the lane
    // picker at 2. Every lane of every approach must permit each turn — the bug
    // was that turns landed only on lane index 0, so lane 1 couldn't turn.
    const T = Position.Top, R = Position.Right, B = Position.Bottom, L = Position.Left;
    let c = addRoad(emptyCell(), L, R, 2);
    c = addRoad(c, T, B, 2); // straight 2-lane cross
    for (const [a, b] of [[L, T], [L, B], [R, T], [R, B]] as [Position, Position][]) {
      c = addRoad(c, a, b, 2);
    }
    // Each approach has two car lanes (0 and 1), and BOTH permit every turn.
    for (const from of [T, R, B, L]) {
      for (const exit of [T, R, B, L].filter(p => p !== from)) {
        expect(lanesAllowingExit(c.road, from, exit)).toEqual([0, 1]);
      }
    }
    // The resulting layer is structurally valid (contiguous indices, every lane exits).
    expect(validateRoads({ "0,0": c }).issues).toEqual([]);
  });

  it("addRoad oneWay lays lanes only in the drawn direction", () => {
    const c = addRoad(emptyCell(), Left, Right, 1, 0, true);
    expect(c.road).toHaveLength(1);
    expect(c.road![0]).toMatchObject({ from: Left, to: [Right], index: 0 });
    // Not a two-way edge: there is no Right->Left movement.
    expect(hasRoadPair(c, [Left, Right])).toBe(false);
    // Multi-lane one-way: only the forward direction's lanes exist.
    const w = addRoad(emptyCell(), Left, Right, 2, 0, true);
    expect(w.road).toHaveLength(2);
    expect(w.road!.every(l => l.from === Left && l.to.includes(Right))).toBe(true);
    expect(validateRoads({ "0,0": w }).issues).toEqual([]);
  });

  it("redrawing a two-way edge as one-way strips the reverse direction", () => {
    let c = addRoad(emptyCell(), Left, Right); // two-way
    expect(hasRoadPair(c, [Left, Right])).toBe(true);
    c = addRoad(c, Left, Right, 1, 0, true); // repaint one-way L->R
    expect(c.road).toHaveLength(1);
    expect(c.road![0]).toMatchObject({ from: Left, to: [Right] });
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

describe("toggleBusLane (the 🚌 tool)", () => {
  const laneAt = (cell: TileCell, from: Position, index: number) =>
    cell.road!.find(l => l.from === from && l.index === index)!;

  it("toggles a lane bus ↔ normal in place, identified by from+index", () => {
    // A 2-lane one-way road L->R (index 0 kerb, index 1 inboard).
    let c = addRoad(emptyCell(), Left, Right, 2, 0, true);
    expect(laneAt(c, Left, 0).kind).toBeUndefined();
    c = toggleBusLane(c, Left, 0); // normal → bus
    expect(laneAt(c, Left, 0).kind).toBe("bus");
    expect(laneAt(c, Left, 1).kind).toBeUndefined(); // the other lane is untouched
    c = toggleBusLane(c, Left, 0); // bus → normal
    expect(laneAt(c, Left, 0).kind).toBeUndefined();
    expect(c.road!.filter(l => l.from === Left)).toHaveLength(2); // never structural
  });

  it("leaves a cycle lane alone — green belongs to the bike tool", () => {
    let c = addRoad(emptyCell(), Left, Right, 1, 0, true);
    c = setLaneKind(c, Left, 0, "cycle");
    expect(toggleBusLane(c, Left, 0)).toBe(c);
  });

  it("keeps the lane's movements and index when flipping kind", () => {
    let c = addRoad(emptyCell(), Left, Right, 2, 0, true);
    c = toggleBusLane(c, Left, 1);
    const lane = laneAt(c, Left, 1);
    expect(lane).toMatchObject({ from: Left, to: [Right], index: 1, kind: "bus" });
  });

  it("is a no-op (same cell) when no lane matches", () => {
    const c = addRoad(emptyCell(), Left, Right, 1, 0, true);
    expect(toggleBusLane(c, Left, 5)).toBe(c); // no lane at index 5
    expect(toggleBusLane(emptyCell(), Left, 0)).toBeDefined(); // no road at all
  });

  it("does not mutate the input cell", () => {
    const c = addRoad(emptyCell(), Left, Right, 1, 0, true);
    const before = c.road![0].kind;
    toggleBusLane(c, Left, 0);
    expect(c.road![0].kind).toBe(before);
  });
});

describe("toggleCycleLane (the 🚲 tool)", () => {
  const laneAt = (cell: TileCell, from: Position, index: number) =>
    cell.road!.find(l => l.from === from && l.index === index)!;

  it("adds a NEW kerb-side green lane — the street widens, car lanes stay", () => {
    // The headline case: a 1-lane street gains a bike lane WITHOUT losing its
    // only car lane.
    let c = addRoad(emptyCell(), Left, Right, 1, 0, true);
    c = toggleCycleLane(c, Left);
    const lanes = c.road!.filter(l => l.from === Left);
    expect(lanes).toHaveLength(2);
    expect(laneAt(c, Left, 0).kind).toBe("cycle");
    expect(laneAt(c, Left, 1).kind).toBeUndefined();
    // The new green lane copies the street's movement.
    expect(laneAt(c, Left, 0).to).toEqual([Right]);
  });

  it("widens a multi-lane street the same way — every car/bus lane kept", () => {
    let c = addRoad(emptyCell(), Left, Right, 3, 0, true);
    c = toggleBusLane(c, Left, 0); // kerb lane is a bus lane
    c = toggleCycleLane(c, Left);
    const lanes = c.road!.filter(l => l.from === Left);
    expect(lanes).toHaveLength(4); // green + bus + 2 car
    expect(laneAt(c, Left, 0).kind).toBe("cycle");
    expect(laneAt(c, Left, 1).kind).toBe("bus"); // shifted inboard, still a bus lane
    expect(laneAt(c, Left, 2).kind).toBeUndefined();
    expect(laneAt(c, Left, 3).kind).toBeUndefined();
  });

  it("toggles back off from ANY lane of the direction — no dead spots", () => {
    let c = addRoad(emptyCell(), Left, Right, 2, 0, true);
    c = toggleCycleLane(c, Left); // add: 3 lanes
    c = toggleCycleLane(c, Left); // remove again (direction-level toggle)
    const lanes = c.road!.filter(l => l.from === Left);
    expect(lanes).toHaveLength(2);
    expect(lanes.every(l => l.kind == null)).toBe(true);
  });

  it("only touches the clicked direction of a two-way street", () => {
    let c: TileCell = { connections: [], road: nWayLanes(Left, Right, 1) };
    c = toggleCycleLane(c, Left);
    expect(c.road!.filter(l => l.from === Left)).toHaveLength(2);
    expect(c.road!.filter(l => l.from === Right)).toHaveLength(1); // untouched
  });

  it("a cycle-only direction (bike path) reverts to normal instead of vanishing", () => {
    let c = addRoad(emptyCell(), Left, Right, 1, 0, true);
    c = setLaneKind(c, Left, 0, "cycle");
    c = toggleCycleLane(c, Left);
    const lanes = c.road!.filter(l => l.from === Left);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].kind).toBeUndefined();
  });
});

describe("streetRunLanes", () => {
  // A straight horizontal two-way street of `n` tiles at y=0, lane index 0 each way.
  const straightRow = (n: number): Level => {
    const lvl: Level = {};
    for (let x = 0; x < n; x++) lvl[`${x},0`] = { connections: [], road: nWayLanes(Left, Right, 1) };
    return lvl;
  };
  // The set of "id:from" the run covers (index is constant across a run).
  const cover = (run: { id: string; from: Position; index: number }[]) =>
    new Set(run.map(r => `${r.id}:${r.from}`));

  it("always includes the clicked lane", () => {
    const lvl = straightRow(1);
    const run = streetRunLanes(lvl, "0,0", Left, 0);
    expect(run).toContainEqual({ id: "0,0", from: Left, index: 0 });
  });

  it("walks a straight run end to end in both directions", () => {
    // 4 tiles; click the middle one's Left→Right lane. The run is that lane on
    // every tile (the eastbound lane), found by walking forward and backward.
    const lvl = straightRow(4);
    const run = streetRunLanes(lvl, "1,0", Left, 0);
    expect(cover(run)).toEqual(
      new Set(["0,0:Left", "1,0:Left", "2,0:Left", "3,0:Left"].map(s =>
        s.replace("Left", String(Left)))),
    );
    expect(run).toHaveLength(4);
  });

  it("collects ALL upstream tiles when clicking deep into a long street", () => {
    // Regression: clicking tile 4 of a 6-tile straight street must sweep the whole
    // upstream chain (0..3), not just one tile back. The backward walk steps tile
    // by tile rather than delegating to the forward walk (which would immediately
    // turn around at the first upstream tile and stop).
    const lvl = straightRow(6);
    const run = streetRunLanes(lvl, "4,0", Left, 0);
    expect(run.map(r => r.id).sort()).toEqual(
      ["0,0", "1,0", "2,0", "3,0", "4,0", "5,0"],
    );
  });

  it("walks backward around a curve (click downstream of a bend)", () => {
    // L-shape: horizontal at (0,0), bend down at (1,0), vertical at (1,1),(1,2).
    // Click the LAST tile (1,2); the backward walk must follow the bend and pick
    // up the tiles before it ((1,1),(1,0),(0,0)), where the approach side changes
    // from Top to Left across the curve.
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(Left, Right, 1) },
      "1,0": { connections: [], road: twoWay(Left, Bottom) }, // curve W<->S
      "1,1": { connections: [], road: nWayLanes(Top, Bottom, 1) },
      "1,2": { connections: [], road: nWayLanes(Top, Bottom, 1) },
    };
    // Southbound lane on the last tile enters from Top.
    const run = streetRunLanes(lvl, "1,2", Top, 0);
    expect(new Set(run.map(r => r.id))).toEqual(
      new Set(["0,0", "1,0", "1,1", "1,2"]),
    );
  });

  it("follows the run around a curve", () => {
    // An L-shape: a horizontal tile at (0,0) bending down at (1,0) to (1,1).
    // The eastbound lane (from Left) at (0,0) flows into the curve, then south.
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(Left, Right, 1) },
      "1,0": { connections: [], road: twoWay(Left, Bottom) }, // curve W<->S
      "1,1": { connections: [], road: nWayLanes(Top, Bottom, 1) },
    };
    const run = streetRunLanes(lvl, "0,0", Left, 0);
    const ids = new Set(run.map(r => r.id));
    expect(ids).toEqual(new Set(["0,0", "1,0", "1,1"]));
  });

  it("stops at a junction tile", () => {
    // A straight street running into a 4-way cross at (2,0): the run includes the
    // straights up to the junction but not the junction tile itself.
    const lvl = straightRow(2);
    lvl["2,0"] = { connections: [], road: [...nWayLanes(Left, Right, 1), ...nWayLanes(Top, Bottom, 1)] };
    const run = streetRunLanes(lvl, "0,0", Left, 0);
    const ids = new Set(run.map(r => r.id));
    expect(ids.has("2,0")).toBe(false); // junction not crossed
    expect(ids.has("0,0")).toBe(true);
    expect(ids.has("1,0")).toBe(true);
  });

  it("stops at the road end (no neighbour road)", () => {
    const lvl = straightRow(2); // (0,0),(1,0); nothing at (2,0) or (-1,0)
    const run = streetRunLanes(lvl, "0,0", Left, 0);
    expect(new Set(run.map(r => r.id))).toEqual(new Set(["0,0", "1,0"]));
  });

  it("stops where the next tile lacks that lane index", () => {
    // (0,0) has a 2-lane road; (1,0) only 1 lane. Walking the inner lane (index 1)
    // forward stops at the seam because (1,0) has no index-1 lane.
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(Left, Right, 2) },
      "1,0": { connections: [], road: nWayLanes(Left, Right, 1) },
      "2,0": { connections: [], road: nWayLanes(Left, Right, 1) },
    };
    const run = streetRunLanes(lvl, "0,0", Left, 1);
    expect(new Set(run.map(r => r.id))).toEqual(new Set(["0,0"]));
  });

  it("terminates on a circular street (loop guard)", () => {
    // A 2x2 ring of curves: each tile bends the run into the next; the eastbound
    // lane loops around. Without the loop guard the walk would never stop.
    const lvl: Level = {
      "0,0": { connections: [], road: twoWay(Right, Bottom) },
      "1,0": { connections: [], road: twoWay(Left, Bottom) },
      "1,1": { connections: [], road: twoWay(Left, Top) },
      "0,1": { connections: [], road: twoWay(Right, Top) },
    };
    const run = streetRunLanes(lvl, "0,0", Right, 0);
    // All four ring tiles, visited once each (no infinite loop / duplicates).
    expect(run).toHaveLength(4);
    expect(new Set(run.map(r => r.id))).toEqual(new Set(["0,0", "1,0", "1,1", "0,1"]));
  });
});

describe("setLaneKind / setLaneKindRun", () => {
  it("setLaneKind sets and clears a lane's kind explicitly", () => {
    let c = addRoad(emptyCell(), Left, Right, 2, 0, true);
    c = setLaneKind(c, Left, 0, "bus");
    expect(c.road!.find(l => l.from === Left && l.index === 0)!.kind).toBe("bus");
    c = setLaneKind(c, Left, 0, undefined);
    expect(c.road!.find(l => l.from === Left && l.index === 0)!.kind).toBeUndefined();
  });

  it("setLaneKind is a no-op (same cell) when no lane matches", () => {
    const c = addRoad(emptyCell(), Left, Right, 1, 0, true);
    expect(setLaneKind(c, Left, 9, "bus")).toBe(c);
  });

  it("clicking a bus lane paints the run back to normal (two-state)", () => {
    // 3-tile straight; the middle tile's eastbound lane is already a bus lane, the
    // ends are normal — a half-painted street. Clicking the bus tile makes the
    // CLICKED lane decide the target: it is bus, so the whole run goes NORMAL.
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(Left, Right, 1) },
      "1,0": { connections: [], road: nWayLanes(Left, Right, 1) },
      "2,0": { connections: [], road: nWayLanes(Left, Right, 1) },
    };
    lvl["1,0"] = setLaneKind(lvl["1,0"], Left, 0, "bus");
    const changed = setBusLaneRun(lvl, "1,0", Left, 0);
    for (const id of ["0,0", "1,0", "2,0"]) {
      const lane = changed[id].road!.find(l => l.from === Left && l.index === 0)!;
      expect(lane.kind).toBeUndefined();
    }
  });

  it("clicking a normal lane paints the run to bus", () => {
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(Left, Right, 1) },
      "1,0": { connections: [], road: nWayLanes(Left, Right, 1) },
    };
    const changed = setBusLaneRun(lvl, "0,0", Left, 0);
    for (const id of ["0,0", "1,0"]) {
      const lane = changed[id].road!.find(l => l.from === Left && l.index === 0)!;
      expect(lane.kind).toBe("bus");
    }
    // Only the eastbound lane (index 0 from Left) changed; the westbound lane stays.
    expect(changed["0,0"].road!.find(l => l.from === Right)!.kind).toBeUndefined();
  });

  it("the bus tool never touches a green lane, even via a run", () => {
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(Left, Right, 1) },
      "1,0": { connections: [], road: nWayLanes(Left, Right, 1) },
    };
    lvl["0,0"] = setLaneKind(lvl["0,0"], Left, 0, "cycle");
    lvl["1,0"] = setLaneKind(lvl["1,0"], Left, 0, "cycle");
    expect(setBusLaneRun(lvl, "0,0", Left, 0)).toEqual({});
  });
});

describe("toggleCycleLaneRun (the 🚲 tool, whole street)", () => {
  it("adds a green kerb lane along the run — every tile widens, car lanes kept", () => {
    const lvl: Level = {
      "0,0": { connections: [], road: nWayLanes(Left, Right, 1) },
      "1,0": { connections: [], road: nWayLanes(Left, Right, 1) },
      "2,0": { connections: [], road: nWayLanes(Left, Right, 1) },
    };
    const changed = toggleCycleLaneRun(lvl, "1,0", Left, 0);
    for (const id of ["0,0", "1,0", "2,0"]) {
      const east = changed[id].road!.filter(l => l.from === Left);
      expect(east).toHaveLength(2); // green lane + the (kept) street lane
      expect(east.find(l => l.index === 0)!.kind).toBe("cycle");
      expect(east.find(l => l.index === 1)!.kind).toBeUndefined();
      expect(changed[id].road!.filter(l => l.from === Right)).toHaveLength(1); // other way untouched
    }
  });

  it("clicking a street that HAS the green lane removes it along the run", () => {
    const widened = (): Level[string] =>
      toggleCycleLane({ connections: [], road: nWayLanes(Left, Right, 1) }, Left);
    const lvl: Level = { "0,0": widened(), "1,0": widened() };
    // Click the CAR lane (index 1) — the direction, not the green lane, decides.
    const changed = toggleCycleLaneRun(lvl, "0,0", Left, 1);
    for (const id of ["0,0", "1,0"]) {
      const east = changed[id].road!.filter(l => l.from === Left);
      expect(east).toHaveLength(1); // narrowed back to the single car lane
      expect(east[0].kind).toBeUndefined();
      expect(east[0].index).toBe(0);
    }
  });

  it("a half-equipped street becomes uniform: the seed tile decides the verb", () => {
    // Tile 0 already has the green lane, tile 1 does not. Clicking tile 1 (no
    // green) ADDS everywhere — tile 0 keeps its one lane (add is idempotent).
    const lvl: Level = {
      "0,0": toggleCycleLane({ connections: [], road: nWayLanes(Left, Right, 1) }, Left),
      "1,0": { connections: [], road: nWayLanes(Left, Right, 1) },
    };
    const changed = toggleCycleLaneRun(lvl, "1,0", Left, 0);
    for (const id of Object.keys(changed)) {
      const east = changed[id].road!.filter(l => l.from === Left);
      expect(east.filter(l => l.kind === "cycle")).toHaveLength(1);
    }
  });
});

describe("syncJunctionBusGates (bus-only street gates its junctions)", () => {
  const { Top: T, Right: R, Bottom: B, Left: L } = Position;
  // The user-map shape: a W-E street whose EAST part is bus-only, with a curve
  // branching south. Junction at 1,0 with arms L (car street), R (bus street),
  // B (car street).
  const tee = (): TileCell => ({
    connections: [],
    road: [
      { from: L, to: [R, B], index: 0 },
      { from: R, to: [L], index: 0 },
      { from: B, to: [L, R], index: 0 },
    ],
  });
  const street = (a: Position, b: Position, kind?: "bus"): TileCell => ({
    connections: [],
    road: kind ? nWayLanes(a, b, 1, kind) : nWayLanes(a, b, 1),
  });
  const mkLevel = (eastBus: boolean): Level => ({
    "0,0": street(L, R),
    "1,0": tee(),
    "2,0": street(L, R, eastBus ? "bus" : undefined),
    "1,1": street(T, B),
  });

  it("moves car exits toward a bus-only arm from `to` to `busTo`", () => {
    const level = mkLevel(true);
    const synced = syncJunctionBusGates(level, "1,0");
    const fromWest = synced.road!.find(l => l.from === L)!;
    expect(fromWest.to).toEqual([B]); // cars: south only
    expect(fromWest.busTo).toEqual([R]); // buses: may still go east
    const fromSouth = synced.road!.find(l => l.from === B)!;
    expect(fromSouth.to).toEqual([L]);
    expect(fromSouth.busTo).toEqual([R]);
    // The arm coming FROM the bus street is untouched (only buses arrive there).
    const fromEast = synced.road!.find(l => l.from === R)!;
    expect(fromEast.to).toEqual([L]);
    expect(fromEast.busTo).toBeUndefined();
    // The level stays valid: one lane per (from, index), every lane has an exit.
    expect(validateRoads({ ...level, "1,0": synced }).ok).toBe(true);
  });

  it("is idempotent", () => {
    const level = mkLevel(true);
    const once = syncJunctionBusGates(level, "1,0");
    const twice = syncJunctionBusGates({ ...level, "1,0": once }, "1,0");
    expect(twice).toBe(once); // same reference: no further change
  });

  it("restores `to` when the street regains car lanes", () => {
    const level = mkLevel(true);
    const gated = syncJunctionBusGates(level, "1,0");
    const back: Level = { ...mkLevel(false), "1,0": gated };
    const restored = syncJunctionBusGates(back, "1,0");
    const fromWest = restored.road!.find(l => l.from === L)!;
    expect([...fromWest.to].sort()).toEqual([R, B].sort());
    expect(fromWest.busTo).toBeUndefined();
  });

  it("leaves non-junction tiles and unrelated junctions alone", () => {
    const level = mkLevel(true);
    expect(syncJunctionBusGates(level, "0,0")).toBe(level["0,0"]);
    const out = syncJunctionBusGatesAround(level, ["2,0"]);
    expect(Object.keys(out)).toEqual(["1,0"]); // only the adjoining junction
  });

  it("does not gate against an open map edge or an empty tile", () => {
    const level = mkLevel(false);
    // 1,0's north neighbour does not exist: the junction must not gate T even
    // though no car lane "enters from" a missing tile.
    const synced = syncJunctionBusGates(level, "1,0");
    expect(synced).toBe(level["1,0"]);
  });
});
