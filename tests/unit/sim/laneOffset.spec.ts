import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { nWayLanes, laneCount, laneCountAt } from "@/tiles/lanes";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import {
  laneOffsetPx,
  laneOffsetConstPx,
  laneIndexAcrossSeam,
  oneWayLaneOffsetPx,
  seamBand,
  seamPositioningBand,
} from "@/sim/laneOffset";
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
    // A 2->1 road drops its KERB lane (lanePos 0) and keeps the inner one; the
    // sim has merged that car inward before the seam (desiredLane). The offset
    // math itself must still be continuous for whatever lanePos it is handed, so
    // a mid-merge fractional lanePos doesn't snap.
    const level = laneRoad([2, 2, 1]);
    const offs = sweepOffsets(level, 3, 0.5); // a half-merged car
    expect(maxStep(offs)).toBeLessThan(W * 0.12);
  });
});

describe("laneIndexAcrossSeam — the same tarmac, renumbered", () => {
  const W = TILE * 0.14;
  // The offset a lane index maps to on a bidirectional tile of `count` lanes.
  const at = (lane: number, count: number) => laneOffsetConstPx(lane, count, TILE);

  it("keeps a car's physical position when a bidirectional road widens", () => {
    // 1 → 3: the single lane sits half a lane off the centreline, and so does
    // lane 2 of the widened road — the two extra lanes appear OUTBOARD, at the
    // kerb. Carrying the index across unchanged put the car in lane 0, two lanes
    // further out: the phantom "1 → 3rd lane" sweep this fixes.
    expect(laneIndexAcrossSeam(0, 1, 3, false)).toBe(2);
    expect(at(2, 3)).toBeCloseTo(at(0, 1), 9);
    expect(at(0, 3)).toBeCloseTo(at(0, 1) + 2 * W, 9); // what it used to get
  });

  it("maps every lane of a widening to its own offset, fractional ones included", () => {
    for (const [from, to] of [[1, 2], [1, 3], [2, 3], [2, 4], [3, 5]]) {
      for (let i = 0; i < from; i++) {
        expect(at(laneIndexAcrossSeam(i, from, to, false), to)).toBeCloseTo(at(i, from), 9);
      }
    }
  });

  it("shifts a mid-change (fractional) position by the same amount", () => {
    // A car crossing the seam half-way through a lane change keeps gliding: the
    // fraction is preserved, so the glide continues from where it had got to.
    expect(laneIndexAcrossSeam(0.5, 2, 3, false)).toBeCloseTo(1.5, 9);
    expect(laneIndexAcrossSeam(1.25, 3, 4, false)).toBeCloseTo(2.25, 9);
    // Except where the destination simply has no such lane — then it merges onto
    // the last one, exactly as the tapered offsets converge there.
    expect(laneIndexAcrossSeam(0.5, 1, 2, false)).toBeCloseTo(1, 9);
  });

  it("merges the dropping kerb lanes onto the survivor at a narrowing", () => {
    // 3 → 1: every lane converges on the one that continues (the offsets do too —
    // `laneSeamOffsetPx` clamps them all to the narrow kerb).
    for (const i of [0, 1, 2]) expect(laneIndexAcrossSeam(i, 3, 1, false)).toBe(0);
    // 3 → 2: only the kerb lane merges; the two inner lanes keep their tarmac.
    expect(laneIndexAcrossSeam(0, 3, 2, false)).toBe(0);
    expect(laneIndexAcrossSeam(1, 3, 2, false)).toBe(0);
    expect(laneIndexAcrossSeam(2, 3, 2, false)).toBe(1);
    expect(at(1, 2)).toBeCloseTo(at(2, 3), 9); // the survivor really is the same lane
  });

  it("carries the index unchanged along a KERB-ANCHORED one-way run", () => {
    // A one-way run anchors on `runMax`, so lane 0 is the same tarmac on every
    // tile of it and lanes are added/dropped on the CENTRE side — the opposite
    // side from a bidirectional road, and the reason this takes a flag.
    for (const [from, to] of [[1, 3], [3, 1], [2, 3], [3, 2]]) {
      for (let i = 0; i < Math.min(from, to); i++) {
        expect(laneIndexAcrossSeam(i, from, to, true)).toBe(i);
      }
    }
    expect(laneIndexAcrossSeam(2, 3, 1, true)).toBe(0); // still clamped into the lanes that exist
  });

  it("never returns a lane the destination does not have", () => {
    for (const from of [1, 2, 3, 4]) {
      for (const to of [1, 2, 3, 4]) {
        for (const kerb of [true, false]) {
          for (let i = 0; i < from; i++) {
            const out = laneIndexAcrossSeam(i, from, to, kerb);
            expect(out).toBeGreaterThanOrEqual(0);
            expect(out).toBeLessThanOrEqual(to - 1);
          }
        }
      }
    }
  });
});

describe("oneWayLaneOffsetPx — kerb-anchored (index 0 = kerb, right-of-travel)", () => {
  const W = TILE * 0.14; // 28px lane width at TILE=200

  // The live one-way car/overlay offset. Lane 0 MUST sit on the kerb (+n,
  // right-of-travel) and the highest index on the centre side (−n), matching the
  // canonical `index 0 = kerb` used by the editor, the sim (kerbMostLane = min
  // index) and two-way junctions. This is the regression guard for the one-way ↔
  // canon unification: if anyone reverts to the old left-align `(i+0.5−R/2)`,
  // index 0 lands on the LEFT and these fail.
  it("places lane 0 on the kerb (+n) and the highest index on the centre (−n)", () => {
    expect(oneWayLaneOffsetPx(0, 3, TILE)).toBeCloseTo(+W, 5); // kerb
    expect(oneWayLaneOffsetPx(1, 3, TILE)).toBeCloseTo(0, 5); // middle
    expect(oneWayLaneOffsetPx(2, 3, TILE)).toBeCloseTo(-W, 5); // centre/left
  });

  it("is identical to laneOffsetConstPx(band = runMax/2) — one canon for every lane", () => {
    for (const runMax of [1, 2, 3, 4, 5]) {
      for (let i = 0; i < runMax; i++) {
        expect(oneWayLaneOffsetPx(i, runMax, TILE)).toBeCloseTo(
          laneOffsetConstPx(i, runMax / 2, TILE),
          9,
        );
      }
    }
  });

  it("a 1-lane one-way run sits centred (offset 0)", () => {
    expect(oneWayLaneOffsetPx(0, 1, TILE)).toBeCloseTo(0, 5);
  });

  it("is run-constant (no seam taper): same offset for any runMax-anchored lane", () => {
    // Lane 0 is always at +(runMax/2−0.5)·W regardless of the local tile count —
    // the kerb lane runs dead straight along the run.
    expect(oneWayLaneOffsetPx(0, 4, TILE)).toBeCloseTo((4 / 2 - 0.5) * W, 5);
    expect(oneWayLaneOffsetPx(0, 2, TILE)).toBeCloseTo((2 / 2 - 0.5) * W, 5);
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

  it("road↔road keeps the min-seam taper", () => {
    expect(seamPositioningBand(3, false, 2, false)).toBe(2);
    expect(seamPositioningBand(2, false, 3, false)).toBe(2);
  });

  it("junction↔junction adopts the WIDER band (stacked junctions never pinch each other)", () => {
    // Two stacked junctions both position on the wider arm — the full approach
    // count, not the (narrower, straight-through-only) count the junction below
    // carries — so the through-lanes stay continuous AND a turn entry stays on its
    // real lanes. Symmetric: both sides resolve to the same (max) band.
    expect(seamPositioningBand(3, true, 2.5, true)).toBe(3);
    expect(seamPositioningBand(1, true, 1.5, true)).toBe(1.5); // narrower self adopts wider neighbour
    expect(seamPositioningBand(1.5, true, 1, true)).toBe(1.5); // and vice-versa — same band both ways
  });

  it("no neighbour road: an open end keeps its own band", () => {
    expect(seamPositioningBand(3, false, 0, true)).toBe(3);
    expect(seamPositioningBand(2.5, true, 0, false)).toBe(2.5);
  });
});
