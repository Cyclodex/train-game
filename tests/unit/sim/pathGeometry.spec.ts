import { describe, it, expect } from "vitest";
import { portPoint, segmentPathD, segmentLength } from "@/sim/pathGeometry";
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
