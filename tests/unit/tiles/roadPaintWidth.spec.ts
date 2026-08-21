import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import {
  roadSeamPaintTotal,
  junctionArmPaintTotal,
  laneCountAt,
  nWayLanes,
  oneWay,
  twoWay,
} from "@/tiles/lanes";

// The painted width of a road tile, per end. These two functions are the
// primitives behind the street profile's `roadEdgeFrac`/`seamPaintLanes`, which
// is what `Tile.vue`'s `roadPaths` now reads for its ribbon widths — so what
// they return IS the tarmac on screen (the profile sweep's paint-parity case
// pins that equivalence board-wide).
//
// This file exists because of one recurring class of bug: a MIN-2 FLOOR applied
// in one branch and not another, which makes the same 1-lane one-way road two
// different widths depending on whether the tile is straight or bent.

const { Top, Right, Bottom, Left } = Position;

describe("road paint width — a one-way lane is one lane wide, straight or bent", () => {
  it("counts a one-way single lane as 1 and a two-way road as 2", () => {
    // The premise everything below rests on: `laneCountAt` totals BOTH directions
    // crossing the port, so only a genuine one-way road can be below 2.
    const ow = [oneWay(Left, Right)];
    expect(laneCountAt(ow, Left)).toBe(1);
    expect(laneCountAt(ow, Right)).toBe(1);
    const tw = twoWay(Left, Right);
    expect(laneCountAt(tw, Left)).toBe(2);
    // A one-way BEND is the same: one lane crosses each of its two ports.
    const bend = [oneWay(Top, Right)];
    expect(laneCountAt(bend, Top)).toBe(1);
    expect(laneCountAt(bend, Right)).toBe(1);
  });

  it("paints a one-way bend the same width as the one-way straights it joins", () => {
    // REGRESSION. `Tile.vue` used to pass `Math.max(selfAt, 2)` in the curve
    // branch — a floor left over from when a 1-lane one-way road was itself drawn
    // 2 lanes wide. Since the run-max kerb anchor a one-way STRAIGHT is drawn its
    // true 1 lane, so the floor made every bend of a car-park aisle bulge to twice
    // the width of the road either side of it.
    const bend = laneCountAt([oneWay(Top, Right)], Top);
    const straightNeighbour = laneCountAt([oneWay(Left, Right)], Left);
    expect(roadSeamPaintTotal(bend, straightNeighbour, false)).toBe(1);
  });

  it("leaves every two-way width untouched (the floor was a no-op there)", () => {
    // The floor only ever bit below 2, and nothing two-way is below 2 — so this
    // change cannot have moved a single pixel of an ordinary street.
    for (const lanes of [1, 2, 3]) {
      const road = nWayLanes(Left, Right, lanes);
      const self = laneCountAt(road, Left);
      expect(self).toBe(lanes * 2);
      // Against an equal neighbour, a narrower one, and no neighbour at all.
      expect(roadSeamPaintTotal(self, self, false)).toBe(self);
      expect(roadSeamPaintTotal(self, 2, false)).toBe(Math.min(self, 2));
      expect(roadSeamPaintTotal(self, 0, false)).toBe(self);
    }
  });

  it("still never lets a junction pinch the road it meets", () => {
    // The other half of the seam rule, unchanged: a junction's per-arm count
    // over/under-states the arm, so a road keeps its own width against one and the
    // junction adopts the road's.
    expect(roadSeamPaintTotal(4, 9, true)).toBe(4);
    expect(junctionArmPaintTotal(9, 4, false)).toBe(4);
    // A one-way single-lane road: the arm meets it exactly 1 wide, no floor.
    expect(junctionArmPaintTotal(3, 1, false)).toBe(1);
  });

  it("keeps a one-way bend flush with a WIDER road at the other end", () => {
    // The taper still works: the bend meets its 1-lane arm at 1 and its 4-lane
    // arm at its own width, so each end is flush with what it actually joins.
    const bend = laneCountAt([oneWay(Bottom, Right)], Bottom);
    expect(roadSeamPaintTotal(bend, 1, false)).toBe(1);
    expect(roadSeamPaintTotal(bend, 4, false)).toBe(1);
  });
});
