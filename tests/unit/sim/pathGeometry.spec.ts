import { describe, it, expect } from "vitest";
import {
  portPoint,
  segmentPathD,
  segmentLength,
  laneSegmentPointAt,
  laneSegmentPathD,
  laneRibbonPathD,
  arrowHeadD,
} from "@/sim/pathGeometry";
import { Position } from "@/types";

describe("portPoint", () => {
  it("maps each port to its point on the tile box", () => {
    expect(portPoint(Position.Top, 200)).toEqual({ x: 100, y: 0 });
    expect(portPoint(Position.Right, 200)).toEqual({ x: 200, y: 100 });
    expect(portPoint(Position.Bottom, 200)).toEqual({ x: 100, y: 200 });
    expect(portPoint(Position.Left, 200)).toEqual({ x: 0, y: 100 });
    expect(portPoint(Position.Center, 200)).toEqual({ x: 100, y: 100 });
  });
});

describe("segmentPathD", () => {
  it("draws a straight line between opposite ports", () => {
    expect(segmentPathD(Position.Top, Position.Bottom, 200)).toBe(
      "M 100 0 L 100 200"
    );
    expect(segmentPathD(Position.Left, Position.Right, 200)).toBe(
      "M 0 100 L 200 100"
    );
  });

  it("draws a quadratic curve through the centre between adjacent ports", () => {
    expect(segmentPathD(Position.Top, Position.Right, 200)).toBe(
      "M 100 0 Q 100 100 200 100"
    );
  });

  it("draws a straight line to/from the depot centre", () => {
    expect(segmentPathD(Position.Left, Position.Center, 200)).toBe(
      "M 0 100 L 100 100"
    );
    expect(segmentPathD(Position.Center, Position.Top, 200)).toBe(
      "M 100 100 L 100 0"
    );
  });
});

describe("segmentLength", () => {
  it("a straight (opposite-port) segment is one full tile", () => {
    expect(segmentLength(Position.Top, Position.Bottom, 1)).toBeCloseTo(1, 6);
    expect(segmentLength(Position.Left, Position.Right, 200)).toBeCloseTo(200, 4);
  });

  it("a depot-centre link is half a tile", () => {
    expect(segmentLength(Position.Left, Position.Center, 1)).toBeCloseTo(0.5, 6);
    expect(segmentLength(Position.Center, Position.Top, 200)).toBeCloseTo(100, 4);
  });

  it("a curve (adjacent-port) segment is shorter than a straight (~0.81 tile)", () => {
    const curve = segmentLength(Position.Top, Position.Right, 1);
    expect(curve).toBeLessThan(1);
    expect(curve).toBeCloseTo(0.8116, 3); // quarter-curve through the centre
    // every adjacent pair is the same length (rotational symmetry)
    expect(segmentLength(Position.Left, Position.Bottom, 1)).toBeCloseTo(curve, 6);
    // scales linearly with tile size
    expect(segmentLength(Position.Top, Position.Right, 200)).toBeCloseTo(
      curve * 200,
      4
    );
  });
});

describe("laneSegmentPointAt", () => {
  it("a zero-offset straight is the centreline, heading along travel", () => {
    const p = laneSegmentPointAt(Position.Left, Position.Right, 200, 0, 0, 0.5);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(100, 6);
    expect(p.tangentDeg).toBeCloseTo(0, 4); // east
  });

  it("a constant offset pushes right-of-travel (east → south)", () => {
    const p = laneSegmentPointAt(Position.Left, Position.Right, 200, 28, 28, 0.5);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(128, 6); // 28px to the right of an eastbound heading
    expect(p.tangentDeg).toBeCloseTo(0, 4);
  });

  it("interpolates offEntry→offExit across the tile (a seam taper)", () => {
    const e = laneSegmentPointAt(Position.Left, Position.Right, 200, 0, 28, 0);
    const m = laneSegmentPointAt(Position.Left, Position.Right, 200, 0, 28, 0.5);
    const x = laneSegmentPointAt(Position.Left, Position.Right, 200, 0, 28, 1);
    expect(e.y).toBeCloseTo(100, 6); // starts on the centreline
    expect(m.y).toBeCloseTo(114, 6); // half way out
    expect(x.y).toBeCloseTo(128, 6); // arrives fully offset
    expect(m.tangentDeg).toBeCloseTo((Math.atan2(28, 200) * 180) / Math.PI, 2);
  });

  it("a zero-offset curve follows the corner arc; apex heads 45°", () => {
    // A road turn Top→Right is a quarter-circle around the wrapped NE corner
    // (200,0), radius 100: the apex (t=0.5, angle 135°) sits at
    // (200−100/√2, 100/√2) ≈ (129.29, 70.71), heading SE.
    const p = laneSegmentPointAt(Position.Top, Position.Right, 200, 0, 0, 0.5);
    expect(p.x).toBeCloseTo(200 - 100 / Math.SQRT2, 6);
    expect(p.y).toBeCloseTo(100 / Math.SQRT2, 6);
    expect(p.tangentDeg).toBeCloseTo(45, 2); // SE at the apex of a Top→Right bend
  });
});

describe("laneSegmentPathD", () => {
  it("a constant-offset straight collapses to a 2-point line", () => {
    expect(laneSegmentPathD(Position.Left, Position.Right, 200, 0, 0)).toBe(
      "M 0 100 L 200 100"
    );
    expect(laneSegmentPathD(Position.Left, Position.Right, 200, 28, 28)).toBe(
      "M 0 128 L 200 128"
    );
  });

  it("a curve samples into a polyline from entry to exit", () => {
    const d = laneSegmentPathD(Position.Top, Position.Right, 200, 0, 0, 24);
    expect(d.startsWith("M 100 0 ")).toBe(true);
    expect(d.endsWith("200 100")).toBe(true);
    expect(d.match(/ L /g)!.length).toBe(24); // 25 sampled points
  });
});

describe("laneRibbonPathD", () => {
  it("a straight ribbon is the closed rectangle between its two edges", () => {
    // left edge at -28, right edge at +28 of an eastbound heading.
    expect(
      laneRibbonPathD(Position.Left, Position.Right, 200, -28, -28, 28, 28)
    ).toBe("M 0 128 L 200 128 L 200 72 L 0 72 Z");
  });

  it("a curved ribbon is a closed sampled polygon", () => {
    const d = laneRibbonPathD(Position.Top, Position.Right, 200, -28, -28, 28, 28, 24);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
  });
});

describe("arrowHeadD", () => {
  it("draws an open chevron at the tip, splayed about the heading", () => {
    expect(arrowHeadD({ x: 100, y: 100 }, 0, 7)).toBe(
      "M93 103.85 L100 100 L93 96.15"
    );
  });
});

// --- Corner-fillet turns (unequal entry/exit offsets) -------------------------
//
// A turn whose entry and exit lane offsets DIFFER (any turn between arms of
// different lane counts) follows the corner fillet of the two lane lines:
// straight leg → constant-radius arc tangent to both → straight leg. The old
// model (fixed arc + linear offset lerp) broke the tangent at both seams — the
// path left the road at an angle, the "strange bend" on mixed-width junctions.
describe("laneSegmentPointAt — corner-fillet turns", () => {
  // Bottom→Right (a right turn wrapping the SE corner), tile 200. Kerb lane of a
  // 3-lane band enters at +70; the 1-lane exit arm receives at +14.
  const B = Position.Bottom;
  const R = Position.Right;

  it("starts exactly on the entry lane line, heading along the entry road", () => {
    const p = laneSegmentPointAt(B, R, 200, 70, 14, 0);
    expect(p.x).toBeCloseTo(170, 6); // 100 + 70 right-of-travel (north → east side)
    expect(p.y).toBeCloseTo(200, 6);
    // Heading north (−90°): tangent-continuous with the straight road below.
    expect(p.tangentDeg).toBeCloseTo(-90, 1);
  });

  it("ends exactly on the exit lane line, heading along the exit road", () => {
    const p = laneSegmentPointAt(B, R, 200, 70, 14, 1);
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.y).toBeCloseTo(114, 6); // 100 + 14 right-of-travel (east → south side)
    expect(p.tangentDeg).toBeCloseTo(0, 1); // east: continuous with the exit road
  });

  it("rides the entry lane line straight before the arc (no early drift)", () => {
    // The fillet for (70→14) is radius 30 centred (200,144): the path holds
    // x = 170 until the arc begins at y = 144.
    const f = laneSegmentPointAt(B, R, 200, 70, 14, 0.15);
    expect(f.x).toBeCloseTo(170, 3);
    expect(f.y).toBeGreaterThan(144);
  });

  it("equal offsets stay the plain concentric arc (equal-arm turns unchanged)", () => {
    // off 14 both ends: a circle of radius 100−14 = 86 around the SE corner.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = laneSegmentPointAt(B, R, 200, 14, 14, t);
      const r = Math.hypot(p.x - 200, p.y - 200);
      expect(r).toBeCloseTo(86, 6);
    }
  });

  it("a LEFT turn with unequal offsets is tangent-continuous at both seams too", () => {
    // Left→Top through a junction: inner lane of a 1-lane band (+14) lands on
    // the inner lane of a 3-lane arm (+14 there too would be equal — use a
    // 2-lane landing at +42 to force inequality).
    const a = laneSegmentPointAt(Position.Left, Position.Top, 200, 14, 42, 0);
    expect(a.tangentDeg).toBeCloseTo(0, 1); // entering heading east
    const b = laneSegmentPointAt(Position.Left, Position.Top, 200, 14, 42, 1);
    expect(b.tangentDeg).toBeCloseTo(-90, 1); // leaving heading north
    expect(b.x).toBeCloseTo(100 + 42, 6); // on the exit lane line
    expect(b.y).toBeCloseTo(0, 6);
  });
});
