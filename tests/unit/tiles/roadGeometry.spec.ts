import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import {
  roadSurfacePath,
  roadSurfacePolygonPath,
  roadCurvePolygonPath,
  roadLaneMarkingPaths,
  laneDropArrowPath,
  laneDropArrowPlan,
  laneDropGore,
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

  it("curved road: centre divider + offset Bézier inner dividers", () => {
    const marks = roadLaneMarkingPaths(Position.Left, Position.Bottom, 200, 2, 2);
    expect(marks).toHaveLength(3); // centre + 1 inner per side
    expect(marks[0].kind).toBe("centre");
    expect(marks.filter(m => m.kind === "inner")).toHaveLength(2);
  });

  it("curved road 1-lane: only centre divider", () => {
    const marks = roadLaneMarkingPaths(Position.Left, Position.Bottom, 200, 1, 1);
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

  it("flags the dropped-lane divider as a merge line (tighter dash), not continuing ones", () => {
    // 3→2 taper, lo=2/hi=3: the i=1 boundary (lanes 0|1) continues on both ends
    // and is NOT a merge line; the i=2 boundary (lane 2 ends) IS — one per side.
    const taper = roadLaneMarkingPaths(Position.Left, Position.Right, 200, 3, 2);
    const innerTaper = taper.filter(m => m.kind === "inner");
    expect(innerTaper.filter(m => m.merge)).toHaveLength(2); // the ending lane, both sides
    expect(innerTaper.filter(m => !m.merge)).toHaveLength(2); // the continuing divider, both sides

    // Equal lane counts: no lane ends, so no divider is a merge line.
    const even = roadLaneMarkingPaths(Position.Left, Position.Right, 200, 3, 3);
    expect(even.some(m => m.merge)).toBe(false);
  });

  it("detects the merge line from the caps when the tile's lane count is uniform", () => {
    // How real tiles render: a 3-per-direction tile (lanesA === lanesB === 3)
    // that tapers via the caps — wide half = 3·LANE_W on entry, narrow half =
    // 2·LANE_W on exit (a 3→2 drop). The divider at 2·LANE_W sits on the narrow
    // kerb and is the lane-drop line; the one at 1·LANE_W continues.
    const LANE_W = 200 * 0.14;
    const marks = roadLaneMarkingPaths(
      Position.Left, Position.Right, 200, 3, 3, 3 * LANE_W, 2 * LANE_W,
    );
    const inner = marks.filter(m => m.kind === "inner");
    expect(inner.filter(m => m.merge)).toHaveLength(2); // 2·LANE_W divider, both sides
    expect(inner.filter(m => !m.merge)).toHaveLength(2); // 1·LANE_W divider, both sides

    // Uniform caps (no taper): nothing is a merge line.
    const flat = roadLaneMarkingPaths(
      Position.Left, Position.Right, 200, 3, 3, 3 * LANE_W, 3 * LANE_W,
    );
    expect(flat.some(m => m.merge)).toBe(false);
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

describe("laneDropArrowPlan", () => {
  it("narrowing tile (2→1): one arrow in the single ending lane", () => {
    const plan = laneDropArrowPlan(2, 1, 0);
    expect(plan).toEqual([{ laneIndex: 1, alongT: 0.15 }]);
  });

  it("approach tile (2,2,1): two advance arrows in the ending lane", () => {
    const plan = laneDropArrowPlan(2, 2, 1);
    expect(plan).toEqual([
      { laneIndex: 1, alongT: 0.35 },
      { laneIndex: 1, alongT: 0.75 },
    ]);
  });

  it("narrowing 3→1: one arrow per ending lane (indices 1 and 2)", () => {
    const plan = laneDropArrowPlan(3, 1, 0);
    expect(plan).toEqual([
      { laneIndex: 1, alongT: 0.15 },
      { laneIndex: 2, alongT: 0.15 },
    ]);
  });

  it("approach 3→1: two advance arrows per ending lane (4 total)", () => {
    const plan = laneDropArrowPlan(3, 3, 1);
    expect(plan).toHaveLength(4);
    expect(plan.filter(p => p.laneIndex === 1)).toHaveLength(2);
    expect(plan.filter(p => p.laneIndex === 2)).toHaveLength(2);
  });

  it("no drop ahead (2,2,2): no arrows", () => {
    expect(laneDropArrowPlan(2, 2, 2)).toEqual([]);
  });

  it("a widening downstream (2→3): no arrows", () => {
    expect(laneDropArrowPlan(2, 3, 0)).toEqual([]);
  });

  it("single-lane road: no arrows", () => {
    expect(laneDropArrowPlan(1, 0, 0)).toEqual([]);
  });

  it("road simply ends at the seam (downstream1 = 0): no arrows", () => {
    expect(laneDropArrowPlan(2, 0, 0)).toEqual([]);
  });

  it("road ends one tile ahead (2,2,0): no arrows (not a lane drop)", () => {
    expect(laneDropArrowPlan(2, 2, 0)).toEqual([]);
  });
});

describe("laneDropArrowPath", () => {
  it("angles toward the centre but stays balanced about the lane centre", () => {
    // Left→Right, size 200: forward = (1,0), right-of-travel n = (0,1) (down).
    // lane 1 → laneMid = 1.5·28 = 42. LATERAL 0.6 → ±0.3·28 = ±8.4 about laneMid:
    // tailOff = 50.4, headOff = 33.6 → y 150.4 → 133.6 (leans toward centreline).
    // HALF = 15, along0 = 0.25·200 = 50 → tail x = 35, head x = 65.
    const arrow = laneDropArrowPath(Position.Left, Position.Right, 200, 1, 0.25);
    expect(arrow.shaft).toBe("M 35 150.4 L 65 133.6");
  });

  it("arrowhead is an open chevron (two strokes, no fill/close)", () => {
    const arrow = laneDropArrowPath(Position.Left, Position.Right, 200, 1, 0.25);
    // Open path: barb → tip → barb, not closed with Z.
    expect(arrow.head.trimEnd().endsWith("Z")).toBe(false);
    expect((arrow.head.match(/L/g) ?? []).length).toBe(2);
    // The chevron tip is the shaft's head point (65, 133.6).
    expect(arrow.head).toContain("L 65 133.6 L");
  });

  it("points in the travel direction (head ahead of tail along entry→exit)", () => {
    const arrow = laneDropArrowPath(Position.Left, Position.Right, 200, 1, 0.5);
    const [, tailX, , headX] = arrow.shaft.match(/M (\S+) (\S+) L (\S+) (\S+)/)!.map(Number);
    expect(headX).toBeGreaterThan(tailX);
  });
});

describe("laneDropGore", () => {
  it("2→1 drop: triangle from outer kerb upstream to the closing band at the seam", () => {
    // Left→Right, size 200: f = (1,0), n = (0,1). survivors=1, selfN=2.
    // innerOff = 1·28 = 28 → y 128; outerOff = 2·28 = 56 → y 156.
    // A = (0,156) tip at outer kerb upstream; B = (200,156); C = (200,128).
    const gore = laneDropGore(Position.Left, Position.Right, 200, 1, 2);
    expect(gore.triangle).toBe("M 0 156 L 200 156 L 200 128 Z");
  });

  it("border is a closed triangle and the hatch has stripes", () => {
    const gore = laneDropGore(Position.Left, Position.Right, 200, 1, 2);
    expect(gore.triangle.trimEnd().endsWith("Z")).toBe(true);
    expect(gore.hatch.length).toBeGreaterThan(0);
    expect(gore.hatch.every(d => d.startsWith("M "))).toBe(true);
  });

  it("3→1 drop covers the whole closing band (lanes 1 and 2)", () => {
    // survivors=1, selfN=3 → innerOff 28 (y128), outerOff 84 (y184).
    const gore = laneDropGore(Position.Left, Position.Right, 200, 1, 3);
    expect(gore.triangle).toBe("M 0 184 L 200 184 L 200 128 Z");
  });
});

describe("roadCurvePolygonPath", () => {
  it("returns a closed path (starts with M, ends with Z)", () => {
    const d = roadCurvePolygonPath(Position.Left, Position.Bottom, 200, 56);
    expect(d.trimStart().startsWith("M")).toBe(true);
    expect(d.trimEnd().endsWith("Z")).toBe(true);
  });

  it("contains a quadratic Bézier segment (Q) for both outer and inner edges", () => {
    const d = roadCurvePolygonPath(Position.Left, Position.Bottom, 200, 56);
    // Should have outer Q and inner Q (two Q commands total).
    const qCount = (d.match(/Q/g) ?? []).length;
    expect(qCount).toBe(2);
  });

  it("is wider than the centreline (offset points differ from centrepoints)", () => {
    // For Left→Bottom, centre entry is (0,100) and centre exit is (100,200).
    // With halfW=28 the outer entry point should not be (0,100).
    const d = roadCurvePolygonPath(Position.Left, Position.Bottom, 200, 56);
    expect(d).not.toContain("M 0 100");
  });

  it("roadLaneMarkingPaths curved 2-lane returns 3 paths: centre + 2 inner", () => {
    const marks = roadLaneMarkingPaths(Position.Left, Position.Bottom, 200, 2, 2);
    expect(marks).toHaveLength(3);
    expect(marks[0].kind).toBe("centre");
    expect(marks.filter(m => m.kind === "inner")).toHaveLength(2);
  });

  it("inner Bézier markings on curved roads contain Q command", () => {
    const marks = roadLaneMarkingPaths(Position.Left, Position.Bottom, 200, 2, 2);
    const inners = marks.filter(m => m.kind === "inner");
    for (const inner of inners) {
      expect(inner.d).toContain("Q");
    }
  });

  it("keeps a near-constant half-width through the bend (no apex pinch)", () => {
    // Regression: offsetting the control point by exactly halfW under-shoots at
    // the apex (the ribbon pinched to ~85% mid-curve). The control-offset factor
    // restores constant width — the outer edge must stay within ~2% of halfW all
    // along the curve, not just at the seam endpoints.
    const halfW = 56;
    const d = roadCurvePolygonPath(Position.Top, Position.Right, 200, halfW * 2);
    // Parse: "M ax ay Q cx1 cy1 bx1 by1 L ... Q ... Z". The outer edge is the
    // first M + first Q (control cx1,cy1 ; end bx1,by1).
    const n = d.match(/-?\d+\.?\d*/g)!.map(Number);
    const outer = { a: { x: n[0], y: n[1] }, c: { x: n[2], y: n[3] }, b: { x: n[4], y: n[5] } };
    // Centreline through Top(100,0) -> Center(100,100) -> Right(200,100).
    const cl = { a: { x: 100, y: 0 }, c: { x: 100, y: 100 }, b: { x: 200, y: 100 } };
    const bez = (
      p: { a: { x: number; y: number }; c: { x: number; y: number }; b: { x: number; y: number } },
      t: number,
    ) => ({
      x: (1 - t) * (1 - t) * p.a.x + 2 * (1 - t) * t * p.c.x + t * t * p.b.x,
      y: (1 - t) * (1 - t) * p.a.y + 2 * (1 - t) * t * p.c.y + t * t * p.b.y,
    });
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const o = bez(outer, t);
      const m = bez(cl, t);
      const dist = Math.hypot(o.x - m.x, o.y - m.y);
      expect(dist).toBeGreaterThan(halfW * 0.98);
      expect(dist).toBeLessThan(halfW * 1.02);
    }
  });
});

