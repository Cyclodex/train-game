import { describe, it, expect } from "vitest";
import {
  crossingLayout,
  crossingRoadSpan,
  VERGE_FRAC,
  BOOM_ROW_FRACS,
} from "@/tiles/crossingFurniture";
import { LANE_WIDTH_FRAC } from "@/sim/laneOffset";

// The level-crossing furniture is DERIVED from the road it guards. The bug this
// file locks down: fixed tile percentages (post at 30%, arm 30%→70%) put the
// post on the tarmac of any street wider than 1+1 lanes, and covered only its
// inner lanes.
//
// Two invariants carry the whole feature and are asserted for every width:
//   1. NO POST STANDS ON THE ROAD — every hinge is outside its kerb.
//   2. THE ROAD IS FULLY GUARDED — the two half-barriers' arms, taken together,
//      span kerb to kerb (each covers its own carriageway, meeting at the centre).

const SIZE = 200;
const W = SIZE * LANE_WIDTH_FRAC; // 28px per lane

// A plain n+n-lane two-way street with the same road on both sides.
function twoWaySpan(perDirection: number) {
  const total = perDirection * 2;
  return crossingRoadSpan({
    size: SIZE,
    downLanes: perDirection,
    upLanes: perDirection,
    crossDown: total,
    crossUp: total,
    downIsJunction: false,
    upIsJunction: false,
    runMax: perDirection,
  });
}

describe("crossing furniture — the painted span it is measured from", () => {
  it("a two-way street is a centred band of its lane count", () => {
    for (const n of [1, 2, 3, 4]) {
      const span = twoWaySpan(n);
      expect(span.flow).toBe("two-way");
      expect(span.xMax).toBeCloseTo(n * W, 6); // half of 2n lanes
      expect(span.xMin).toBeCloseTo(-n * W, 6);
    }
  });

  it("tapers to the narrower neighbour at a seam (the min-seam rule)", () => {
    // 3+3 here, 1+1 next door: the painted width at the tile is the average of
    // its two ends, exactly what Tile.vue's trapezoid draws.
    const span = crossingRoadSpan({
      size: SIZE,
      downLanes: 3,
      upLanes: 3,
      crossDown: 6,
      crossUp: 2,
      downIsJunction: false,
      upIsJunction: false,
      runMax: 3,
    });
    expect(span.xMax).toBeCloseTo(((6 + 2) / 2 / 2) * W, 6);
  });

  it("a one-way street is kerb-anchored on its right-hand side", () => {
    // Travelling local-down, the kerb (right of travel) is local −x.
    const down = crossingRoadSpan({
      size: SIZE,
      downLanes: 2,
      upLanes: 0,
      crossDown: 2,
      crossUp: 2,
      downIsJunction: false,
      upIsJunction: false,
      runMax: 2,
    });
    expect(down.flow).toBe("down");
    expect(down.xMin).toBeCloseTo(-W, 6); // kerb at (runMax/2)·W
    expect(down.xMax).toBeCloseTo(W, 6); // 2 lanes of tarmac from it
    // The mirror image when the same street runs the other way.
    const up = crossingRoadSpan({
      size: SIZE,
      downLanes: 0,
      upLanes: 2,
      crossDown: 2,
      crossUp: 2,
      downIsJunction: false,
      upIsJunction: false,
      runMax: 2,
    });
    expect(up.flow).toBe("up");
    expect(up.xMax).toBeCloseTo(W, 6);
    expect(up.xMin).toBeCloseTo(-W, 6);
  });
});

describe("crossing furniture — a bar on the left and a bar on the right", () => {
  // 1..3 lanes per direction: up to 168px of a 200px tile, every width a board
  // actually uses. (Wider than the tile is the clamp's business, tested below.)
  it("gives a two-way street one half-barrier per approach, hinged off the tarmac", () => {
    for (const n of [1, 2, 3]) {
      const span = twoWaySpan(n);
      const { booms, signs } = crossingLayout(SIZE, span);
      expect(booms).toHaveLength(2);
      expect(signs).toHaveLength(2);

      const [top, bottom] = booms;
      // One row either side of the rails, which run through the tile's middle.
      expect(top.y).toBeCloseTo(BOOM_ROW_FRACS[0] * SIZE, 6);
      expect(bottom.y).toBeCloseTo(BOOM_ROW_FRACS[1] * SIZE, 6);
      // Opposite verges: the down carriageway's bar on the left, the up one's
      // on the right — the diagonal pair a real crossing uses.
      expect(top.hinge).toBeLessThan(0);
      expect(bottom.hinge).toBeGreaterThan(0);
      expect(top.dir).toBe(1);
      expect(bottom.dir).toBe(-1);

      // 1. No post stands on the road.
      const verge = SIZE * VERGE_FRAC;
      expect(top.hinge).toBeCloseTo(span.xMin - verge, 6);
      expect(bottom.hinge).toBeCloseTo(span.xMax + verge, 6);

      // 2. Between them the arms span kerb to kerb, meeting at the centreline.
      expect(top.hinge + top.dir * top.length).toBeCloseTo(0, 6);
      expect(bottom.hinge + bottom.dir * bottom.length).toBeCloseTo(0, 6);
      expect(top.length).toBeGreaterThanOrEqual(-span.xMin);
      expect(bottom.length).toBeGreaterThanOrEqual(span.xMax);

      // Each sign stands beside its own post, up the road from it.
      expect(signs[0].x).toBeCloseTo(top.hinge, 6);
      expect(signs[1].x).toBeCloseTo(bottom.hinge, 6);
      expect(signs[0].y).toBeLessThan(top.y);
      expect(signs[1].y).toBeGreaterThan(bottom.y);
    }
  });

  it("scales the arm with the street instead of pinning it to the tile", () => {
    // The regression itself: on a 3+3 street the old fixed geometry hinged at
    // 30% of the tile (x = −40px) — 44px INSIDE a kerb that sits at −84px.
    const wide = crossingLayout(SIZE, twoWaySpan(3)).booms[0];
    const narrow = crossingLayout(SIZE, twoWaySpan(1)).booms[0];
    expect(wide.hinge).toBeCloseTo(-3 * W - SIZE * VERGE_FRAC, 6);
    expect(wide.length).toBeGreaterThan(narrow.length * 2.5);
  });

  it("guards a one-way street with a single full barrier, on the approach side", () => {
    // No oncoming half to leave clear, and a barrier behind the crossing guards
    // nothing — so one bar, spanning the whole carriageway.
    const down = crossingLayout(
      SIZE,
      crossingRoadSpan({
        size: SIZE,
        downLanes: 3,
        upLanes: 0,
        crossDown: 3,
        crossUp: 3,
        downIsJunction: false,
        upIsJunction: false,
        runMax: 3,
      }),
    );
    expect(down.booms).toHaveLength(1);
    const b = down.booms[0];
    expect(b.y).toBeCloseTo(BOOM_ROW_FRACS[0] * SIZE, 6); // the approach side
    expect(b.dir).toBe(1);
    expect(b.length).toBeCloseTo(3 * W + SIZE * VERGE_FRAC, 6); // the full width

    const up = crossingLayout(
      SIZE,
      crossingRoadSpan({
        size: SIZE,
        downLanes: 0,
        upLanes: 3,
        crossDown: 3,
        crossUp: 3,
        downIsJunction: false,
        upIsJunction: false,
        runMax: 3,
      }),
    );
    expect(up.booms).toHaveLength(1);
    expect(up.booms[0].y).toBeCloseTo(BOOM_ROW_FRACS[1] * SIZE, 6);
    expect(up.booms[0].dir).toBe(-1);
  });

  it("keeps the post inside the tile on an absurdly wide street", () => {
    const { booms } = crossingLayout(SIZE, twoWaySpan(6)); // 12 lanes = 336px
    for (const b of booms) expect(Math.abs(b.hinge)).toBeLessThanOrEqual(SIZE / 2);
  });
});
