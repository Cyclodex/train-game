import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import {
  approachPortsOf,
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
  laneCountAt,
  nWayLanes,
  seamPaintTotal,
  seamMismatch,
  turnKind,
  junctionExitLane,
  junctionExitOffsetPx,
  turnSeamBand,
  usableExits,
  lanesAllowingExitFor,
  laneExits,
  laneAllExits,
} from "@/tiles/lanes";
import { seamBand, laneOffsetConstPx } from "@/sim/laneOffset";
import { mixedtee } from "@/levels/test/scenarios/mixedjunction";

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

describe("laneCountAt", () => {
  it("counts distinct physical lanes crossing a seam, not movements", () => {
    // 4-way all-turns junction: every approach is one index-0 lane that fans out
    // to all three exits. Each port carries 1 lane in + 1 lane out = 2, even
    // though three movements converge on it (they share the one index-0 exit
    // lane). Counting movements would wrongly report 4 and false-flag a mismatch.
    const junction = fromPairs([
      [L, R], [T, B], [L, T], [L, B], [R, T], [R, B],
    ]);
    for (const p of [T, R, B, L]) expect(laneCountAt(junction, p)).toBe(2);
  });

  it("still counts genuine multi-lane turn approaches by their distinct lanes", () => {
    // Two-lane approach from L: lane 0 goes straight to R, lane 1 turns to T.
    // L carries 2 distinct lanes entering; the R seam carries 1 exiting (lane 0).
    const road: Lane[] = [turns(L, [R], 0), turns(L, [T], 1)];
    expect(laneCountAt(road, L)).toBe(2);
    expect(laneCountAt(road, R)).toBe(1);
  });
});

describe("junction narrow-arm positioning band (mixedtee spur alignment)", () => {
  it("seam-matches a junction's over-counted arm to the neighbour, so lanes line up", () => {
    // /test/mixedtee: a 3-lane E-W road with a 2-lane spur south. The junction's B
    // (spur) arm laneCountAt deliberately OVER-counts: 2 lanes entering + the 3
    // main-road lanes that can turn onto the spur (distinct indices 0,1,2) = 5,
    // i.e. positioning band 2.5. The actual spur is 2 lanes each way (band 2).
    const centre = mixedtee.level["3,2"].road;
    const spur = mixedtee.level["3,3"].road;
    expect(laneCountAt(centre, B)).toBe(5); // over-count (correct for mismatch-suppression)
    expect(laneCountAt(spur, T)).toBe(4); // the real arm: 2 lanes each way
    const junctionBand = laneCountAt(centre, B) / 2; // 2.5 — wrong to POSITION with
    const armBand = laneCountAt(spur, T) / 2; // 2 — the actual arm width
    // The renderer (couplerOffset / lane overlay) must position the B-arm lanes
    // with the SEAM-MATCHED band so they line up with the spur at the entrance,
    // not half a lane out.
    expect(seamBand(junctionBand, armBand)).toBe(2);
    expect(seamBand(junctionBand, armBand)).not.toBe(junctionBand);
    // The wide main-road arms are NOT over-counted relative to their neighbour, so
    // their band is unchanged (they already lined up — the "exit is OK" side).
    const west = mixedtee.level["2,2"].road; // 3-lane west arm
    expect(seamBand(laneCountAt(centre, L) / 2, laneCountAt(west, R) / 2)).toBe(3);
  });
});

describe("turnSeamBand (turn-glide target band entering a junction)", () => {
  // Regression: the default sandbox map — a cross of a 2-lane E-W road and a
  // 1-lane N-S road, fed from below by a 1-lane curve. The junction's B arm
  // laneCountAt over-counts (1 entering + distinct turn-exit indices 0 and 1 = 3,
  // band 1.5), but the junction POSITIONS a vehicle entering that arm with the
  // seam-matched band (min with the curve's honest band 1). The curve's turn
  // glide must target the SAME band, or every vehicle (and lane arrow) eases to
  // 28px, then snaps to the junction's 14px exactly at the entrance seam.
  const cross: Lane[] = [
    // E-W: kerb lane goes straight or right, inner lane straight or left.
    { from: L, to: [R, B], index: 0 },
    { from: L, to: [R, T], index: 1 },
    { from: R, to: [L, T], index: 0 },
    { from: R, to: [L, B], index: 1 },
    // N-S: single lane each way, all turns permitted.
    { from: T, to: [B, L, R], index: 0 },
    { from: B, to: [T, L, R], index: 0 },
  ];
  const curve = nWayLanes(T, R, 1); // 1-lane curve below: Top (to junction) ↔ Right

  it("seam-matches the junction's over-counted arm down to the feeding curve", () => {
    expect(laneCountAt(cross, B)).toBe(3); // over-count: band 1.5
    expect(laneCountAt(curve, T)).toBe(2); // honest: band 1
    expect(turnSeamBand(curve, T, cross, B)).toBe(1);
  });

  it("the curve's glide target equals the junction's own entry offset (no snap)", () => {
    // What the junction uses to place a vehicle entering via B (couplerOffset):
    const junctionEntryBand = seamBand(laneCountAt(cross, B) / 2, laneCountAt(curve, T) / 2);
    const junctionEntryOff = laneOffsetConstPx(0, junctionEntryBand, 200);
    // What the curve's turn glide eases the vehicle to at the seam:
    const glideTarget = junctionExitOffsetPx(
      curve, R, 0, T, cross, B, turnSeamBand(curve, T, cross, B), 200, "car",
    );
    expect(glideTarget).toBeCloseTo(junctionEntryOff, 6); // both 14px
    // The raw over-counted band would have overshot to 28px — half a lane out.
    const rawBand = laneCountAt(cross, B) / 2;
    expect(junctionExitOffsetPx(curve, R, 0, T, cross, B, rawBand, 200, "car")).toBeCloseTo(28, 6);
  });

  it("a turn onto a non-junction arm is unchanged (the receiver's band stands)", () => {
    // Junction turning right onto a 2-lane straight: receiver band 2, giver
    // (junction at its L port) over-counts to 2 as well → min is still 2.
    const straight2 = nWayLanes(L, R, 2);
    expect(turnSeamBand(cross, L, straight2, R)).toBe(2);
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

describe("seamPaintTotal", () => {
  it("keeps the tile's full width at an off-map / grass edge (no neighbour road)", () => {
    // The regression: a 3-lane road running off the play area must NOT taper to
    // a phantom 2-lane neighbour. neighbourCrossing 0 means there is no road.
    expect(seamPaintTotal(3, 0)).toBe(3);
    expect(seamPaintTotal(4, 0)).toBe(4);
    expect(seamPaintTotal(6, 0)).toBe(6);
    expect(seamPaintTotal(2, 0)).toBe(2);
  });

  it("meets a narrower neighbour road flush (takes the min)", () => {
    expect(seamPaintTotal(4, 2)).toBe(2);
    expect(seamPaintTotal(3, 2)).toBe(2);
  });

  it("floors a one-way single-lane neighbour at the min-2 it is painted", () => {
    // Neighbour physically carries 1 lane but is drawn 2 wide; the seam meets
    // that painted width, not a 1-lane pinch.
    expect(seamPaintTotal(2, 1)).toBe(2);
    expect(seamPaintTotal(3, 1)).toBe(2);
  });

  it("stays at the tile's width when the neighbour is wider (the neighbour tapers)", () => {
    expect(seamPaintTotal(2, 4)).toBe(2);
    expect(seamPaintTotal(3, 5)).toBe(3);
  });
});

describe("seamMismatch", () => {
  // The crosslanes centre: 3-lane E-W approaches + 1-lane N-S, every lane → every exit.
  const centre: Lane[] = [
    ...Array.from({ length: 3 }, (_, i) => ({ from: L, to: [R, T, B], index: i })),
    ...Array.from({ length: 3 }, (_, i) => ({ from: R, to: [L, T, B], index: i })),
    { from: T, to: [B, L, R], index: 0 },
    { from: B, to: [T, L, R], index: 0 },
  ];

  it("never flags a junction — arms fan/merge unequal lane counts by design", () => {
    // laneCountAt over-counts a junction exit port (3 E-W lanes can fan through T
    // plus the 1 N approach = 4), but the 1-lane arm crosses only 2. That is a
    // legal merge, not a mismatch, because the tile is a junction.
    expect(laneCountAt(centre, T)).toBe(4);
    expect(seamMismatch(centre, T, 2)).toBe(false);
  });

  it("flags a simple curve whose lane count is not preserved across the bend", () => {
    // A 3-lane curve (L<->T, two ports) meeting a 2-lane neighbour: genuine error.
    const curve = nWayLanes(L, T, 3);
    expect(seamMismatch(curve, L, 2)).toBe(true);
  });

  it("does not flag a matching seam or an off-map / grass edge", () => {
    const curve = nWayLanes(L, T, 2);
    expect(seamMismatch(curve, L, laneCountAt(curve, L))).toBe(false);
    expect(seamMismatch(curve, L, 0)).toBe(false); // no neighbour road
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

describe("turnKind", () => {
  it("classifies straight / left / right from right-hand-traffic geometry", () => {
    // Entering from Bottom = travelling North.
    expect(turnKind(Position.Bottom, Position.Top)).toBe("straight");
    expect(turnKind(Position.Bottom, Position.Left)).toBe("left");
    expect(turnKind(Position.Bottom, Position.Right)).toBe("right");
    // Entering from Left = travelling East.
    expect(turnKind(Position.Left, Position.Right)).toBe("straight");
    expect(turnKind(Position.Left, Position.Top)).toBe("left");
    expect(turnKind(Position.Left, Position.Bottom)).toBe("right");
  });
});

describe("junctionExitLane", () => {
  const B = Position.Bottom;
  const T = Position.Top;
  const L = Position.Left;
  const R = Position.Right;
  // A junction approach from Bottom with `n` lanes, each permitting all turns.
  const approach = (n: number): Lane[] =>
    Array.from({ length: n }, (_, i) => ({ from: B, to: [T, L, R], index: i }));

  it("fans a 1-lane approach out by turn direction into a 3-lane exit", () => {
    const j = approach(1);
    // Straight (exit Top): exit arm entered through its Bottom; kerb-aligned → lane 0.
    expect(junctionExitLane(j, B, 0, T, nWayLanes(T, B, 3), B, "car")).toBe(0);
    // Right turn (exit Right): exit arm entered through Left; kerb-aligned → lane 0.
    expect(junctionExitLane(j, B, 0, R, nWayLanes(L, R, 3), L, "car")).toBe(0);
    // Left turn (exit Left): exit arm entered through Right; inner-aligned → lane 2.
    expect(junctionExitLane(j, B, 0, L, nWayLanes(L, R, 3), R, "car")).toBe(2);
  });

  it("merges a 3-lane approach into a 1-lane exit (every lane → lane 0)", () => {
    const j = approach(3);
    for (const idx of [0, 1, 2]) {
      expect(junctionExitLane(j, B, idx, T, nWayLanes(T, B, 1), B, "car")).toBe(0);
    }
  });

  it("matches lanes 1:1 across an equal 3→3 straight", () => {
    const j = approach(3);
    expect(junctionExitLane(j, B, 0, T, nWayLanes(T, B, 3), B, "car")).toBe(0);
    expect(junctionExitLane(j, B, 1, T, nWayLanes(T, B, 3), B, "car")).toBe(1);
    expect(junctionExitLane(j, B, 2, T, nWayLanes(T, B, 3), B, "car")).toBe(2);
  });

  it("keeps cars off a kerb-side bus lane on the exit arm; puts buses on it", () => {
    const j = approach(1);
    // Exit arm: kerb bus lane (index 0) + two car lanes (1,2), entered via Bottom.
    const busExit: Lane[] = [
      { from: B, to: [T], index: 0, kind: "bus" },
      { from: B, to: [T], index: 1 },
      { from: B, to: [T], index: 2 },
    ];
    // A car going straight kerb-aligns to the lowest CAR lane (1), never the bus lane.
    expect(junctionExitLane(j, B, 0, T, busExit, B, "car")).toBe(1);
    // A bus going straight kerb-aligns onto the bus lane (index 0).
    expect(junctionExitLane(j, B, 0, T, busExit, B, "bus")).toBe(0);
  });
});

describe("junctionExitOffsetPx (turn-glide target offset)", () => {
  const B = Position.Bottom;
  const T = Position.Top;
  const approach = (n: number): Lane[] =>
    Array.from({ length: n }, (_, i) => ({ from: B, to: [T, Position.Left, Position.Right], index: i }));
  // tileSize 200 → lane width 0.14·200 = 28px; laneOffsetConstPx = (band-0.5-lane)·28.

  it("a turn onto a 1-lane arm lands at that lane's centre offset (the glide target)", () => {
    // 1-lane two-way exit arm → centred band 1; target lane 0 → (1-0.5-0)·28 = 14px.
    const off = junctionExitOffsetPx(approach(1), B, 0, T, nWayLanes(T, B, 1), B, 1, 200, "car");
    expect(off).toBeCloseTo(14, 6);
  });

  it("every lane of a wide approach merging to a 1-lane arm targets the same offset", () => {
    const j = approach(3);
    const offs = [0, 1, 2].map(i => junctionExitOffsetPx(j, B, i, T, nWayLanes(T, B, 1), B, 1, 200, "car"));
    expect(offs).toEqual([offs[0], offs[0], offs[0]]); // all converge — no fan-out onto a 1-lane arm
    expect(offs[0]).toBeCloseTo(14, 6);
  });

  it("a bus glides to a kerb bus lane further out than a car (which avoids it)", () => {
    const busExit: Lane[] = [
      { from: B, to: [T], index: 0, kind: "bus" },
      { from: B, to: [T], index: 1 },
      { from: B, to: [T], index: 2 },
    ];
    // One-way 3-lane exit arm → band passed as 1.5. Car target lane 1 → (1.5-0.5-1)·28 = 0.
    const car = junctionExitOffsetPx(approach(1), B, 0, T, busExit, B, 1.5, 200, "car");
    // Bus target lane 0 (the kerb bus lane) → (1.5-0.5-0)·28 = 28.
    const bus = junctionExitOffsetPx(approach(1), B, 0, T, busExit, B, 1.5, 200, "bus");
    expect(car).toBeCloseTo(0, 6);
    expect(bus).toBeCloseTo(28, 6);
    expect(bus).toBeGreaterThan(car); // bus sits further toward the kerb
  });
});

describe("busTo: bus-only exits on a shared lane", () => {
  // The busjunction T: cars N–S straight only, buses may also turn east, and the
  // east arm is a bus lane. One physical lane per (from, index) — no validator clash.
  const tee: Lane[] = [
    { from: T, to: [B], busTo: [R], index: 0 },
    { from: B, to: [T], busTo: [R], index: 0 },
    { from: R, to: [T, B], index: 0, kind: "bus" },
  ];

  it("laneExits gives buses the extra exits, cars only `to`", () => {
    const lane = tee[0];
    expect(laneExits(lane, "car")).toEqual([B]);
    expect(laneExits(lane, "bus")).toEqual([B, R]);
    expect(laneAllExits(lane)).toEqual([B, R]);
  });

  it("usableExits: cars cannot leave east, buses can", () => {
    expect(usableExits(tee, T, "car")).toEqual([B]);
    expect(usableExits(tee, T, "bus").sort()).toEqual([B, R].sort());
    expect(usableExits(tee, B, "car")).toEqual([T]);
    expect(usableExits(tee, B, "bus").sort()).toEqual([T, R].sort());
  });

  it("lanesAllowingExitFor: the shared lane allows the east turn only for buses", () => {
    expect(lanesAllowingExitFor(tee, T, R, "car")).toEqual([]);
    expect(lanesAllowingExitFor(tee, T, R, "bus")).toEqual([0]);
  });

  it("laneCountAt counts the bus turn as a physical seam lane (no centred point)", () => {
    // East seam: 1 entering (R approach) + 1 distinct exiting index via busTo = 2,
    // matching the adjacent 1+1 bus-only street — lanes land at real positions.
    expect(laneCountAt(tee, R)).toBe(2);
  });

  it("structural derivations include busTo movements", () => {
    expect(roadPortsOf(tee).sort()).toEqual([T, R, B].sort());
    expect(isRoadJunction(tee)).toBe(true);
    expect(laneMovements(tee)).toContainEqual({ from: T, to: R });
    expect(laneMovements(tee)).toContainEqual({ from: B, to: R });
    expect(roadEdges(tee)).toContainEqual([T, R]);
  });
});

// approachPortsOf: only arms traffic ENTERS from. An exit-only arm (one-way
// outbound) must not get a signal phase or a signal head (see junctionSignal).
describe("approachPortsOf", () => {
  const B = Position.Bottom;
  const L = Position.Left;
  const R = Position.Right;
  it("excludes exit-only arms, keeps every entering arm", () => {
    // T-junction: traffic enters from L and R; B is OUTBOUND-only (exit-only).
    const road = [
      { from: L, to: [R, B], index: 0 },
      { from: R, to: [L, B], index: 0 },
    ];
    expect(approachPortsOf(road).sort()).toEqual([L, R].sort());
    expect(roadPortsOf(road).sort()).toEqual([L, R, B].sort()); // structural superset
  });
  it("empty road has no approaches", () => {
    expect(approachPortsOf([])).toEqual([]);
    expect(approachPortsOf(undefined)).toEqual([]);
  });
});
