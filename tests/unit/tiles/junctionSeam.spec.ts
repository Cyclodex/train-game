import { describe, it, expect } from "vitest";
import { SCENARIOS } from "@/levels/test";
import { parseCoordId } from "@/tiles/model";
import { neighborCoord, oppositePort } from "@/sim/topology";
import {
  type Lane,
  laneCount,
  laneCountAt,
  isRoadJunction,
  roadEdges,
  roadSeamPaintTotal,
  junctionArmPaintTotal,
} from "@/tiles/lanes";
import type { Port } from "@/tiles/model";

// Regression guard for #30: a lane-count change may never be painted AT or
// directly next to a junction — the junction's painted arm stub must equal the
// adjoining road's width exactly (the width difference between unequal arms is
// resolved INSIDE the box, never at a seam). These assertions mirror the seam
// math in Tile.vue (roadSeamPaintTotal / junctionArmPaintTotal), so a scenario
// that authors a taper next to a junction — or a change that reintroduces the
// junction-laneCountAt over/under-count at a seam — fails CI.

// The painted total a road tile (straight OR curve) shows at the seam on `port`:
// its real crossing width there, floored at the min-2 a one-way still draws.
// For a straight this equals laneCount(a)+laneCount(b); for a curve the facing
// laneCountAt (its opposite port carries no lanes, so the two-term sum would
// under-count). With a junction neighbour the road keeps exactly this width
// (roadSeamPaintTotal junction exemption), so it doubles as the expected value.
function roadFacingTotal(road: Lane[], port: Port): number {
  return Math.max(laneCountAt(road, port), 2);
}

describe("junctionArmPaintTotal / roadSeamPaintTotal", () => {
  it("a junction neighbour never pinches a straight road (keeps its own width)", () => {
    // self 6 (3-lane two-way), junction crossing under-counts to 5 → still 6.
    expect(roadSeamPaintTotal(6, 5, true)).toBe(6);
    expect(roadSeamPaintTotal(6, 5, false)).toBe(5); // a real road meets flush
  });

  it("a junction arm adopts its adjoining road's width (no taper at the seam)", () => {
    // arm's own laneCountAt under-counts to 5; the 3-lane road faces it at 6.
    expect(junctionArmPaintTotal(5, 6, false)).toBe(6);
    // a 1-lane side road faces at 2 → the arm paints 2, never the over-count.
    expect(junctionArmPaintTotal(5, 2, false)).toBe(2);
    // junction-abutting-junction or off-map (0) falls back to its own count.
    expect(junctionArmPaintTotal(4, 6, true)).toBe(Math.min(4, 6));
    expect(junctionArmPaintTotal(3, 0, false)).toBe(3);
  });
});

describe("no painted taper at a junction seam (every scenario)", () => {
  for (const scenario of SCENARIOS) {
    const level = scenario.level;
    const junctions = Object.entries(level).filter(
      ([, cell]) => cell.road && isRoadJunction(cell.road),
    );
    if (junctions.length === 0) continue;

    it(`${scenario.id}: every junction arm matches its adjoining road's width`, () => {
      for (const [coordId, jCell] of junctions) {
        const coord = parseCoordId(coordId);
        const jRoad = jCell.road!;
        // Every port the junction's lanes actually touch is an arm.
        const ports = new Set<Port>();
        for (const lane of jRoad) {
          ports.add(lane.from);
          for (const to of lane.to) ports.add(to);
        }
        for (const p of ports) {
          const nc = neighborCoord(coord, p);
          if (!nc) continue;
          const nb = level[`${nc.x},${nc.y}`];
          if (!nb?.road) continue;
          if (isRoadJunction(nb.road)) continue; // junction↔junction: not a road seam

          const fp = oppositePort(p); // the neighbour road's facing port
          const armW = junctionArmPaintTotal(
            laneCountAt(jRoad, p),
            laneCountAt(nb.road, fp),
            false,
          );
          // The road keeps its own facing width at a junction seam.
          const roadW = roadSeamPaintTotal(
            roadFacingTotal(nb.road, fp),
            laneCountAt(jRoad, p),
            true,
          );
          expect(
            armW,
            `${scenario.id} @ ${coordId} arm ${p}: junction paints ${armW}, road paints ${roadW}`,
          ).toBe(roadW);
        }
      }
    });

    it(`${scenario.id}: no bidirectional road tile next to a junction is a taper`, () => {
      for (const [coordId, cell] of Object.entries(level)) {
        const road = cell.road;
        if (!road || isRoadJunction(road)) continue;
        const coord = parseCoordId(coordId);
        for (const [a, b] of roadEdges(road)) {
          if (oppositePort(a) !== b) continue; // straight edges only
          const la = laneCount(road, a);
          const lb = laneCount(road, b);
          if (la === 0 || lb === 0) continue; // one-way model handled separately
          const self = Math.max(la + lb, 2);
          const na = neighborCoord(coord, a);
          const nb = neighborCoord(coord, b);
          const cellA = na ? level[`${na.x},${na.y}`] : undefined;
          const cellB = nb ? level[`${nb.x},${nb.y}`] : undefined;
          const jA = !!cellA?.road && isRoadJunction(cellA.road);
          const jB = !!cellB?.road && isRoadJunction(cellB.road);
          if (!jA && !jB) continue; // only tiles adjacent to a junction
          const crossA = cellA?.road ? laneCountAt(cellA.road, oppositePort(a)) : 0;
          const crossB = cellB?.road ? laneCountAt(cellB.road, oppositePort(b)) : 0;
          const wA = roadSeamPaintTotal(self, crossA, jA);
          const wB = roadSeamPaintTotal(self, crossB, jB);
          expect(
            wA,
            `${scenario.id} @ ${coordId}: ${a}=${wA} vs ${b}=${wB} — taper next to a junction`,
          ).toBe(wB);
        }
      }
    });
  }
});
