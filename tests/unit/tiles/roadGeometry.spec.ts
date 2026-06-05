import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { roadSurfacePath, roadMarkingPath } from "@/tiles/roadGeometry";

// The road surface is the same centreline a train follows (straight line for
// opposite/Center links, a quadratic through the centre for adjacent ports), so
// it can be stroked wide to read as a paved road. The lane marking shares that
// path and is dashed by the renderer.
describe("roadSurfacePath", () => {
  it("draws a straight line between opposite ports", () => {
    // Left <-> Right across a size-200 tile, centred vertically at y=100.
    const d = roadSurfacePath(Position.Left, Position.Right, 200);
    expect(d).toBe("M 0 100 L 200 100");
  });

  it("draws a straight line for a Center (depot-style) link", () => {
    const d = roadSurfacePath(Position.Bottom, Position.Center, 200);
    expect(d).toBe("M 100 200 L 100 100");
  });

  it("curves adjacent ports through the tile centre", () => {
    // Left <-> Bottom curves via the centre (100,100).
    const d = roadSurfacePath(Position.Left, Position.Bottom, 200);
    expect(d).toBe("M 0 100 Q 100 100 100 200");
  });
});

describe("roadMarkingPath", () => {
  it("matches the surface centreline (the renderer dashes it)", () => {
    expect(roadMarkingPath(Position.Left, Position.Right, 200)).toBe(
      roadSurfacePath(Position.Left, Position.Right, 200)
    );
  });
});
