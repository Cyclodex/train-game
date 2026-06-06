import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import {
  roadSurfacePath,
  roadSurfacePolygonPath,
  roadLaneMarkingPaths,
} from "@/tiles/roadGeometry";

describe("roadSurfacePath", () => {
  it("draws a straight line between opposite ports", () => {
    const d = roadSurfacePath(Position.Left, Position.Right, 200);
    expect(d).toBe("M 0 100 L 200 100");
  });

  it("draws a straight line for a Center (depot-style) link", () => {
    const d = roadSurfacePath(Position.Bottom, Position.Center, 200);
    expect(d).toBe("M 100 200 L 100 100");
  });

  it("curves adjacent ports through the tile centre", () => {
    const d = roadSurfacePath(Position.Left, Position.Bottom, 200);
    expect(d).toBe("M 0 100 Q 100 100 100 200");
  });
});

describe("roadSurfacePolygonPath", () => {
  it("equal widths on a straight road form a rectangle", () => {
    // 2-lane road, both ends 112px wide
    const d = roadSurfacePolygonPath(Position.Left, Position.Right, 200, 112, 112);
    // Right-hand perpendicular for Left→Right is (0, 1), so +half is +y (down).
    // Entry corners: (0, 100±56) = (0,44) and (0,156).
    // Exit corners:  (200, 100±56) = (200,44) and (200,156).
    expect(d).toBe("M 0 156 L 200 156 L 200 44 L 0 44 Z");
  });

  it("wider entry, narrower exit: trapezoid narrows toward the exit", () => {
    // 2→1 merge: 112px wide at entry, 56px wide at exit.
    const d = roadSurfacePolygonPath(Position.Left, Position.Right, 200, 112, 56);
    // Entry half=56, exit half=28
    expect(d).toBe("M 0 156 L 200 128 L 200 72 L 0 44 Z");
  });

  it("narrower entry, wider exit: trapezoid widens toward the exit", () => {
    // 1→2 split: 56px wide at entry, 112px wide at exit.
    const d = roadSurfacePolygonPath(Position.Left, Position.Right, 200, 56, 112);
    // Entry half=28, exit half=56
    expect(d).toBe("M 0 128 L 200 156 L 200 44 L 0 72 Z");
  });

  it("adjacent (curved) ports form a quadrilateral with right-hand offsets", () => {
    // Left→Bottom on a 200px tile; the centreline curves through (100,100).
    // Unit right-hand perp is (-dy, dx)/mag = (-100, 100)/sqrt(20000) ≈ (-0.7071, 0.7071).
    // With widthA = widthB = 56, half = 28. Corners (rounded to 4 dp):
    //   entry right:  (0,100) + 28·(-0.7071, 0.7071) = (-19.7990, 119.7990)
    //   exit  right:  (100,200) + 28·(-0.7071, 0.7071) = (80.2010, 219.7990)
    //   exit  left:   (100,200) - 28·(-0.7071, 0.7071) = (119.7990, 180.2010)
    //   entry left:   (0,100) - 28·(-0.7071, 0.7071) = (19.7990, 80.2010)
    const d = roadSurfacePolygonPath(Position.Left, Position.Bottom, 200, 56, 56);
    const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
    expect(nums).toHaveLength(8);
    expect(nums[0]).toBeCloseTo(-19.799, 2);
    expect(nums[1]).toBeCloseTo(119.799, 2);
    expect(nums[2]).toBeCloseTo(80.201, 2);
    expect(nums[3]).toBeCloseTo(219.799, 2);
    expect(nums[4]).toBeCloseTo(119.799, 2);
    expect(nums[5]).toBeCloseTo(180.201, 2);
    expect(nums[6]).toBeCloseTo(19.799, 2);
    expect(nums[7]).toBeCloseTo(80.201, 2);
  });

  it("closes with a Z so SVG fill renders the trapezoid", () => {
    const d = roadSurfacePolygonPath(Position.Left, Position.Right, 200, 112, 56);
    expect(d.endsWith(" Z")).toBe(true);
  });
});

describe("roadLaneMarkingPaths", () => {
  it("single-lane straight road: only centre divider", () => {
    const marks = roadLaneMarkingPaths(Position.Left, Position.Right, 200, 1, 1);
    expect(marks).toHaveLength(1);
    expect(marks[0].kind).toBe("centre");
    expect(marks[0].d).toBe("M 0 100 L 200 100");
  });

  it("2-lane straight road: centre + 2 inner dividers (one per side)", () => {
    const marks = roadLaneMarkingPaths(Position.Left, Position.Right, 200, 2, 2);
    expect(marks).toHaveLength(3); // centre + 1 inner each side
    expect(marks.filter(m => m.kind === "centre")).toHaveLength(1);
    expect(marks.filter(m => m.kind === "inner")).toHaveLength(2);
  });

  it("3-lane straight road: centre + 4 inner dividers (two per side)", () => {
    const marks = roadLaneMarkingPaths(Position.Left, Position.Right, 200, 3, 3);
    expect(marks).toHaveLength(5); // centre + 2 inner each side
    expect(marks.filter(m => m.kind === "inner")).toHaveLength(4);
  });

  it("curved road: only centre divider (no parallel Bezier offsets)", () => {
    const marks = roadLaneMarkingPaths(Position.Left, Position.Bottom, 200, 2, 2);
    expect(marks).toHaveLength(1);
    expect(marks[0].kind).toBe("centre");
  });

  it("inner dividers are parallel offsets of the centreline", () => {
    // For Left→Right (horizontal centreline at y=100), inner divider at +LANE_W
    // should be at y = 100 + LANE_W (right-hand side = downward)
    const LANE_W = 200 * 0.14; // 28px
    const marks = roadLaneMarkingPaths(Position.Left, Position.Right, 200, 2, 2);
    const inner = marks.filter(m => m.kind === "inner");
    // One at +LANE_W (below), one at -LANE_W (above)
    const ys = inner.map(m => {
      const match = m.d.match(/M \d+ ([\d.]+)/);
      return match ? parseFloat(match[1]) : NaN;
    }).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(100 - LANE_W, 1);
    expect(ys[1]).toBeCloseTo(100 + LANE_W, 1);
  });

  it("2→1 taper: inner divider on the wide side runs straight to the narrow kerb", () => {
    // 2 lanes at entry → 1 lane at exit. The wide side's inner divider sits
    // at offset 1·LANE_W = 28 (midway between centreline and the wide side's
    // kerb at 56). On the narrow side, the road is only 1 lane wide, so the
    // kerb is at offset LANE_W = 28 too — i.e. exactly where the divider is.
    // The divider runs straight (no offset change) and the road's painted
    // surface tapers in to meet it.
    const LANE_W = 200 * 0.14; // 28px
    const marks = roadLaneMarkingPaths(
      Position.Left,
      Position.Right,
      200,
      2, // lanesA
      1, // lanesB
    );
    // 1 centre + 1 inner above + 1 inner below = 3
    expect(marks).toHaveLength(3);
    const inners = marks.filter(m => m.kind === "inner");
    expect(inners).toHaveLength(2);

    // Positive side: straight line at y = 100 + LANE_W.
    const positive = inners.find(m => {
      const xs = m.d.match(/M (\d+\.?\d*) ([\d.]+)/);
      return xs && parseFloat(xs[1]) === 0;
    });
    expect(positive).toBeDefined();
    expect(positive!.d).toBe(`M 0 ${100 + LANE_W} L 200 ${100 + LANE_W}`);

    // Negative side: straight line at y = 100 - LANE_W.
    const negative = inners.find(m => {
      const xs = m.d.match(/M (\d+\.?\d*) ([\d.]+)/);
      return xs && parseFloat(xs[1]) === 0 && parseFloat(xs[2]) < 100;
    });
    expect(negative).toBeDefined();
    expect(negative!.d).toBe(`M 0 ${100 - LANE_W} L 200 ${100 - LANE_W}`);
  });

  it("2→1 taper: no extra inner divider is produced for the dropped lane", () => {
    // A 2-lane road has 1 inner divider per side; the 2→1 case still draws
    // exactly 1 per side (the lane-1 boundary is on the new kerb), not 0.
    const marks = roadLaneMarkingPaths(
      Position.Left,
      Position.Right,
      200,
      2, 1,
    );
    expect(marks.filter(m => m.kind === "inner")).toHaveLength(2);
  });

  it("3→2 taper: 2 inner per side on the wide end, 1 on the narrow end", () => {
    // 3 lanes → 2 lanes: lo=2, hi=3. Loop runs i=1,2. Both indices map to
    // a straight line (i=1 at 1·LANE_W, i=2 at 2·LANE_W = narrow kerb).
    // Total: 2 inner per side, 4 total.
    const marks = roadLaneMarkingPaths(
      Position.Left,
      Position.Right,
      200,
      3, 2,
    );
    expect(marks.filter(m => m.kind === "inner")).toHaveLength(4);
  });
});

