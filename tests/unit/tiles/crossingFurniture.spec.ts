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
  const verge = SIZE * VERGE_FRAC;
  const rowTop = BOOM_ROW_FRACS[0] * SIZE;
  const rowBottom = BOOM_ROW_FRACS[1] * SIZE;

  it("gives a BIG street four bars — two per row, one in from each verge", () => {
    // 2..3 lanes per direction. This is the arrangement the fix is about: on a
    // wide road no arm may reach across the oncoming lanes, so every guarded row
    // is closed by its own pair meeting at the centreline.
    for (const n of [2, 3]) {
      const span = twoWaySpan(n);
      const { booms, signs } = crossingLayout(SIZE, span);
      expect(booms).toHaveLength(4);
      expect(signs).toHaveLength(2); // one warning triangle per APPROACH, not per bar

      for (const [y, pair] of [
        [rowTop, booms.slice(0, 2)],
        [rowBottom, booms.slice(2)],
      ] as const) {
        const [left, right] = pair;
        expect(left.y).toBeCloseTo(y, 6);
        expect(right.y).toBeCloseTo(y, 6);
        // 1. No post stands on the road — one on each verge.
        expect(left.hinge).toBeCloseTo(span.xMin - verge, 6);
        expect(right.hinge).toBeCloseTo(span.xMax + verge, 6);
        // 2. The row is fully guarded: the two arms meet at the centreline.
        expect(left.dir).toBe(1);
        expect(right.dir).toBe(-1);
        expect(left.hinge + left.length).toBeCloseTo(0, 6);
        expect(right.hinge - right.length).toBeCloseTo(0, 6);
        // …and neither is longer than half the road plus its verge.
        expect(left.length).toBeCloseTo(n * W + verge, 6);
        expect(right.length).toBeCloseTo(n * W + verge, 6);
      }
    }
  });

  it("leaves a narrow 1+1 street the classic diagonal pair", () => {
    const span = twoWaySpan(1);
    const { booms, signs } = crossingLayout(SIZE, span);
    expect(booms).toHaveLength(2);
    expect(signs).toHaveLength(2);
    const [top, bottom] = booms;
    expect(top.y).toBeCloseTo(rowTop, 6);
    expect(bottom.y).toBeCloseTo(rowBottom, 6);
    // Opposite verges: the down carriageway's bar on the left, the up one's on
    // the right, each covering its own lane.
    expect(top.hinge).toBeCloseTo(span.xMin - verge, 6);
    expect(bottom.hinge).toBeCloseTo(span.xMax + verge, 6);
    expect(top.hinge + top.length).toBeCloseTo(0, 6);
    expect(bottom.hinge - bottom.length).toBeCloseTo(0, 6);
  });

  it("stands each sign at its own approach's driver's-right post", () => {
    for (const n of [1, 2, 3]) {
      const { booms, signs } = crossingLayout(SIZE, twoWaySpan(n));
      expect(signs[0].x).toBeLessThan(0); // down carriageway: right hand is −x
      expect(signs[1].x).toBeGreaterThan(0);
      expect(signs[0].y).toBeLessThan(rowTop);
      expect(signs[1].y).toBeGreaterThan(rowBottom);
      // The sign shares a post with a bar of its own row.
      expect(booms.some(b => b.y === rowTop && b.hinge === signs[0].x)).toBe(true);
      expect(booms.some(b => b.y === rowBottom && b.hinge === signs[1].x)).toBe(true);
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

  function oneWaySpan(lanes: number, dir: "down" | "up") {
    return crossingRoadSpan({
      size: SIZE,
      downLanes: dir === "down" ? lanes : 0,
      upLanes: dir === "up" ? lanes : 0,
      crossDown: lanes,
      crossUp: lanes,
      downIsJunction: false,
      upIsJunction: false,
      runMax: lanes,
    });
  }

  it("guards a one-way street on the approach side only", () => {
    // No oncoming half to leave clear, and a barrier behind the crossing guards
    // nothing — so ONE row. A big one-way street still gets a bar from each verge.
    const down = crossingLayout(SIZE, oneWaySpan(3, "down"));
    expect(down.signs).toHaveLength(1);
    expect(down.booms).toHaveLength(2);
    for (const b of down.booms) expect(b.y).toBeCloseTo(rowTop, 6); // the approach side
    expect(down.booms[0].hinge + down.booms[0].length).toBeCloseTo(0, 6); // they meet
    expect(down.booms[1].hinge - down.booms[1].length).toBeCloseTo(0, 6);

    const up = crossingLayout(SIZE, oneWaySpan(3, "up"));
    expect(up.booms).toHaveLength(2);
    for (const b of up.booms) expect(b.y).toBeCloseTo(rowBottom, 6);
  });

  it("guards a single-lane one-way street with one full-width bar", () => {
    const { booms, signs } = crossingLayout(SIZE, oneWaySpan(1, "down"));
    expect(booms).toHaveLength(1);
    expect(signs).toHaveLength(1);
    const span = oneWaySpan(1, "down");
    expect(booms[0].dir).toBe(1);
    expect(booms[0].hinge + booms[0].length).toBeCloseTo(span.xMax, 6);
  });

  it("keeps the post inside the tile on an absurdly wide street", () => {
    const { booms } = crossingLayout(SIZE, twoWaySpan(6)); // 12 lanes = 336px
    for (const b of booms) expect(Math.abs(b.hinge)).toBeLessThanOrEqual(SIZE / 2);
  });
});
