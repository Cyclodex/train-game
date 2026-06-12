import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { nWayLanes, laneCount, laneCountAt } from "@/tiles/lanes";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { laneOffsetPx, laneOffsetConstPx, seamBand, seamPositioningBand } from "@/sim/laneOffset";
import { Coordinates } from "@/types";

// These tests pin the lateral-offset continuity that fixes the "cars snap
// sideways at a lane-count change" rendering regression. The offset math lives
// in the Vue-free sim/laneOffset.ts and is composed here exactly the way
// game.ts `couplerOffset` (and Tile.vue's debug overlay) compose it, so the
// assertion below proves the on-screen behaviour without booting a DOM.

const TILE = 200;

// A pure re-statement of game.ts `couplerOffset` for one coupler at lateral
// lane position `lanePos`, on the straight road tile at `coord` entered via
// `entry`, at progress `t` (0 = entry seam, 1 = exit seam). Reads the level's
// neighbour lane counts and applies the min-seam taper, identical to the
// renderer. (Straight-only — these fixtures are straight roads.)
function couplerOffset(
  level: Level,
  coord: Coordinates,
  entry: Position,
  exit: Position,
  t: number,
  lanePos: number,
): number {
  const bandAt = (c: Coordinates, port: Position): number =>
    laneCount(level[getCoordinatesId(c)]?.road, port);
  const selfBand = bandAt(coord, entry);
  if (selfBand <= 0) return 0;
  if (exit === oppositePort(entry)) {
    const nEntry = neighborCoord(coord, entry);
    const nExit = neighborCoord(coord, exit);
    const bandEntry = seamBand(selfBand, nEntry ? bandAt(nEntry, oppositePort(entry)) : 0);
    const bandExit = seamBand(selfBand, nExit ? bandAt(nExit, oppositePort(exit)) : 0);
    return laneOffsetPx(lanePos, selfBand, bandEntry, bandExit, t, TILE);
  }
  return laneOffsetConstPx(lanePos, selfBand, TILE);
}

// A west→east straight road whose per-direction lane counts follow `counts`,
// one tile per entry. Tile i is entered (eastbound) via Left, exits via Right.
function laneRoad(counts: number[]): Level {
  const lvl: Level = {};
  counts.forEach((count, i) => {
    lvl[`${i},0`] = {
      connections: [],
      road: nWayLanes(Position.Left, Position.Right, count),
    };
  });
  return lvl;
}

// Walk an eastbound kerb-lane (lanePos = 0) car across the road in small steps,
// collecting its lateral offset at each step. The car advances `t` from 0→1
// within each tile, then moves onto the next tile at t = 0.
function sweepOffsets(level: Level, tiles: number, lanePos: number, steps = 20): number[] {
  // Clamp the requested lane to the tile's actual lane count, mirroring the sim:
  // a car never holds a lane index a tile doesn't have (it has merged to a valid
  // lane before the narrowing). Asserting offsets at a nonexistent lane index
  // would test an unreachable state.
  const laneOn = (i: number) => {
    const n = laneCount(level[`${i},0`]?.road, Position.Left);
    return n > 0 ? Math.min(lanePos, n - 1) : lanePos;
  };
  const out: number[] = [];
  for (let i = 0; i < tiles; i++) {
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push(couplerOffset(level, { x: i, y: 0 }, Position.Left, Position.Right, t, laneOn(i)));
    }
  }
  // Include the final exit seam of the last tile.
  out.push(couplerOffset(level, { x: tiles - 1, y: 0 }, Position.Left, Position.Right, 1, laneOn(tiles - 1)));
  return out;
}

function maxStep(xs: number[]): number {
  let m = 0;
  for (let i = 1; i < xs.length; i++) m = Math.max(m, Math.abs(xs[i] - xs[i - 1]));
  return m;
}

describe("lane lateral offset — seam continuity (rendering regression)", () => {
  // The bug, stated as the OLD (constant, centre-relative) offset: a kerb-lane
  // car's offset is (curCount - 0.5 - lanePos)·W on its CURRENT tile, so it jumps
  // by a whole lane-width when curCount changes at the seam.
  const W = TILE * 0.14;

  it("documents the discontinuity the old constant offset produced at a 2->1 seam", () => {
    // Kerb lane (lanePos 0). On the 2-lane tile: (2 - 0.5 - 0)·W = 1.5·W = 42px.
    // On the 1-lane tile: (1 - 0.5 - 0)·W = 0.5·W = 14px. A 28px snap.
    const onTwo = (2 - 0.5 - 0) * W;
    const onOne = (1 - 0.5 - 0) * W;
    expect(onTwo).toBeCloseTo(42, 5);
    expect(onOne).toBeCloseTo(14, 5);
    expect(Math.abs(onTwo - onOne)).toBeCloseTo(W, 5); // a full lane-width jump
  });

  it("documents the discontinuity the old constant offset produced at a 1->2 seam", () => {
    const onOne = (1 - 0.5 - 0) * W;
    const onTwo = (2 - 0.5 - 0) * W;
    expect(Math.abs(onTwo - onOne)).toBeCloseTo(W, 5);
  });

  it("tapers smoothly across a 2->1 reduction (no per-tick snap)", () => {
    // counts: 2, 2, 1 — the kerb-lane car continues through; the 2-lane tile
    // before the drop tapers its band from 2 down to 1 across its own length.
    const level = laneRoad([2, 2, 1]);
    const offs = sweepOffsets(level, 3, 0);
    // Per-step change must stay well under a lane-width: a continuous glide.
    expect(maxStep(offs)).toBeLessThan(W * 0.12);
    // And it actually moved (a real taper, not a flat line): the 2-lane start
    // offset (42px) eases to the 1-lane offset (14px).
    expect(offs[0]).toBeCloseTo(42, 1);
    expect(offs[offs.length - 1]).toBeCloseTo(14, 1);
  });

  it("tapers smoothly across a 1->2 addition (no per-tick snap)", () => {
    // counts: 1, 2, 2 — entering the widened road, the 2-lane tile tapers from
    // 1 (at the seam with the 1-lane neighbour) up to 2 across its length.
    const level = laneRoad([1, 2, 2]);
    const offs = sweepOffsets(level, 3, 0);
    expect(maxStep(offs)).toBeLessThan(W * 0.12);
    expect(offs[0]).toBeCloseTo(14, 1); // starts at the 1-lane offset
    expect(offs[offs.length - 1]).toBeCloseTo(42, 1); // ends at the 2-lane offset
  });

  it("tapers smoothly across a 3->2->1 multi-step reduction", () => {
    const level = laneRoad([3, 3, 2, 1]);
    const offs = sweepOffsets(level, 4, 0);
    expect(maxStep(offs)).toBeLessThan(W * 0.12);
  });

  it("leaves a uniform road unchanged (constant offset, zero per-tick delta)", () => {
    const level = laneRoad([2, 2, 2]);
    const offs = sweepOffsets(level, 3, 0);
    expect(maxStep(offs)).toBeCloseTo(0, 6);
    for (const o of offs) expect(o).toBeCloseTo(42, 5); // kerb lane of a 2-lane road
  });

  it("never sends a surviving inner lane across the centreline at a narrowing", () => {
    // Regression: when a 3-lane direction narrows to 1 (the skip-a-lane row of
    // the lanemerge gallery), the two inner lanes SURVIVE (the kerb lanes drop).
    // The old band-substitution taper computed (bandExit - 0.5 - lanePos)·W, which
    // for lanePos 1 and 2 with bandExit = 1 is -0.5·W and -1.5·W — negative, i.e.
    // the lane line crossing onto the oncoming side of the street. Every lane's
    // offset must stay on its own side (>= 0) at all progress points.
    const level = laneRoad([3, 3, 1]);
    for (const lanePos of [0, 1, 2]) {
      const offs = sweepOffsets(level, 3, lanePos);
      for (const o of offs) expect(o).toBeGreaterThanOrEqual(0);
    }
  });

  it("holds a surviving inner lane steady across a 2->1 drop (kerb lane is the one that merges)", () => {
    // The kerb lane (lanePos 0) is the one that closes and merges to centre; the
    // inner lane (lanePos 1) survives and must keep its centre-adjacent offset
    // (0.5·W = 14px) all the way through, not drift toward / across the centre.
    const level = laneRoad([2, 2, 1]);
    const inner = sweepOffsets(level, 3, 1);
    for (const o of inner) expect(o).toBeCloseTo(14, 1);
  });

  it("keeps both same-direction lanes of a CURVE on their own side (no centreline crossing)", () => {
    // Regression: the lane-positioning band is half the lanes crossing the
    // approach (forward + backward) = laneCountAt(road, from) / 2. On a curve the
    // oncoming lanes enter from the ADJACENT exit port, so a naive
    // positioningBand(laneCount(from), laneCount(oppositePort(from))) reads the
    // opposite port — which carries NO lanes on a curve — and halves the band
    // (2 -> 1), pushing one same-direction lane to a negative offset across the
    // centreline. That is the crossed-arrows / wrong-car-path bug. With the
    // laneCountAt band, both lanes stay on the right-of-travel side.
    const curve = nWayLanes(Position.Right, Position.Bottom, 2); // 2 each way
    const band = laneCountAt(curve, Position.Right) / 2; // forward + backward = 4 -> 2
    expect(band).toBe(2);
    const offset = (index: number) => (band - 0.5 - index) * W;
    expect(offset(0)).toBeCloseTo(1.5 * W, 5); // kerb lane, well right of centre
    expect(offset(1)).toBeCloseTo(0.5 * W, 5); // inner lane, still right of centre
    for (const index of [0, 1]) expect(offset(index)).toBeGreaterThan(0);
  });

  it("keeps the inner lane continuous across the seam too", () => {
    // Inner lane (lanePos 1) on a 2->1 road: the inner lane is the one that
    // DROPS, but the sim merges that car to lane 0 before the seam (desiredLane);
    // the offset math itself must still be continuous for whatever lanePos it is
    // handed, so a mid-merge fractional lanePos doesn't snap.
    const level = laneRoad([2, 2, 1]);
    const offs = sweepOffsets(level, 3, 0.5); // a half-merged car
    expect(maxStep(offs)).toBeLessThan(W * 0.12);
  });
});

describe("one-way centred band — substitution (lanes connect, highest index merges)", () => {
  const W = TILE * 0.14;

  it("substitutes the narrow-side offset so survivors land on their neighbour and the top index merges", () => {
    // A one-way 3-lane tile: CENTRED band selfBand = 3/2 = 1.5, lane centres at
    // +1·W, 0, -1·W. Narrowing toward a 2-lane seam (band 1, lane centres +0.5·W,
    // -0.5·W), each surviving lane takes its NARROW-side offset so it lands exactly
    // on the downstream lane (no half-lane gap — the old scaling left +0.667·W,
    // 0.167·W short of the +0.5·W neighbour), and the highest-index lane (lane 2)
    // merges onto the innermost survivor (lane 1). `centred = true` is the one-way path.
    const selfBand = 1.5;
    const seam = 1;
    const off = (lp: number) => laneOffsetPx(lp, selfBand, selfBand, seam, 1, TILE, true);
    expect(off(0)).toBeCloseTo(0.5 * W, 5); // lands on the downstream top lane
    expect(off(1)).toBeCloseTo(-0.5 * W, 5); // lands on the downstream bottom lane
    expect(off(2)).toBeCloseTo(-0.5 * W, 5); // highest index merges onto lane 1
  });

  it("matches the downstream uniform one-way tile exactly at the seam (continuity)", () => {
    // The 3-lane tile's exit-seam offset for a surviving lane equals the 2-lane
    // tile's own centred offset for that lane — so the lane line is continuous,
    // which is the whole point of substitution over the old scaling.
    const seamOff = (lp: number) => laneOffsetPx(lp, 1.5, 1.5, 1, 1, TILE, true);
    const downstreamOff = (lp: number) => laneOffsetPx(lp, 1, 1, 1, 0, TILE, true); // 2-lane uniform, entry seam
    expect(seamOff(0)).toBeCloseTo(downstreamOff(0), 5);
    expect(seamOff(1)).toBeCloseTo(downstreamOff(1), 5);
  });

  it("a uniform one-way road (no taper) keeps every lane on its centred line", () => {
    const selfBand = 1.5;
    const off = (lp: number) => laneOffsetPx(lp, selfBand, selfBand, selfBand, 1, TILE, true);
    expect(off(0)).toBeCloseTo(1 * W, 5);
    expect(off(1)).toBeCloseTo(0, 5);
    expect(off(2)).toBeCloseTo(-1 * W, 5);
  });

  it("collapses every lane to the centreline at a one-lane seam", () => {
    // 3 (or 2) lanes narrowing to a single centred lane: all lanes converge to
    // offset 0 at the seam (seamCount = 1).
    const off = (lp: number) => laneOffsetPx(lp, 1.5, 1.5, 0.5, 1, TILE, true);
    expect(off(0)).toBeCloseTo(0, 5);
    expect(off(1)).toBeCloseTo(0, 5);
    expect(off(2)).toBeCloseTo(0, 5);
  });
});

describe("seamPositioningBand — junction-aware band at a seam", () => {
  // The band-side counterpart of the junction paint rule (#30): the ROAD's real
  // band is authoritative at any junction↔road seam, on both sides.
  it("a junction meeting a plain road adopts the road's band", () => {
    // Junction arm under-counts (band 2.5) but the road is really 3 wide.
    expect(seamPositioningBand(2.5, true, 3, false)).toBe(3);
    // Over-count: arm counts 2, the road is 1 — still the road's band.
    expect(seamPositioningBand(2, true, 1, false)).toBe(1);
  });

  it("a plain road keeps its own band at a junction seam (never pinched)", () => {
    expect(seamPositioningBand(3, false, 2.5, true)).toBe(3);
    expect(seamPositioningBand(1, false, 2, true)).toBe(1);
  });

  it("road↔road keeps the min-seam taper; junction↔junction keeps min", () => {
    expect(seamPositioningBand(3, false, 2, false)).toBe(2);
    expect(seamPositioningBand(2, false, 3, false)).toBe(2);
    expect(seamPositioningBand(3, true, 2.5, true)).toBe(2.5);
  });

  it("no neighbour road: an open end keeps its own band", () => {
    expect(seamPositioningBand(3, false, 0, true)).toBe(3);
    expect(seamPositioningBand(2.5, true, 0, false)).toBe(2.5);
  });
});
