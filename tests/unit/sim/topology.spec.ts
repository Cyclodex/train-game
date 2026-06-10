import { describe, it, expect } from "vitest";
import { oppositePort, neighborCoord } from "@/sim/topology";
import { Position } from "@/types";

describe("oppositePort", () => {
  it("flips Top<->Bottom and Left<->Right", () => {
    expect(oppositePort(Position.Top)).toBe(Position.Bottom);
    expect(oppositePort(Position.Bottom)).toBe(Position.Top);
    expect(oppositePort(Position.Left)).toBe(Position.Right);
    expect(oppositePort(Position.Right)).toBe(Position.Left);
  });

  it("leaves Center unchanged", () => {
    expect(oppositePort(Position.Center)).toBe(Position.Center);
  });
});

describe("neighborCoord", () => {
  it("steps one tile toward the exit port (y increases downward)", () => {
    const c = { x: 3, y: 3 };
    expect(neighborCoord(c, Position.Top)).toEqual({ x: 3, y: 2 });
    expect(neighborCoord(c, Position.Right)).toEqual({ x: 4, y: 3 });
    expect(neighborCoord(c, Position.Bottom)).toEqual({ x: 3, y: 4 });
    expect(neighborCoord(c, Position.Left)).toEqual({ x: 2, y: 3 });
  });

  it("has no neighbor for Center (depot interior)", () => {
    expect(neighborCoord({ x: 1, y: 1 }, Position.Center)).toBeNull();
  });
});
