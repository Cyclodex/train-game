import { describe, it, expect } from "vitest";
import { portPoint, segmentPathD } from "@/sim/pathGeometry";
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
