import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { roadSurfacePath, roadLaneMarkingPaths } from "@/tiles/roadGeometry";

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
});
