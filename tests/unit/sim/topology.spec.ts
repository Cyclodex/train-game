import { describe, it, expect } from "vitest";
import {
  oppositePort,
  neighborCoord,
  tileExitPort,
} from "@/sim/topology";
import { Position, ActiveIntersection } from "@/types";

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

describe("tileExitPort - straight", () => {
  it("connects Top<->Bottom when vertical (rotation 0) and Left<->Right when horizontal (rotation 1)", () => {
    expect(tileExitPort("TileStraight", 0, Position.Top)).toBe(Position.Bottom);
    expect(tileExitPort("TileStraight", 0, Position.Bottom)).toBe(Position.Top);
    expect(tileExitPort("TileStraight", 1, Position.Right)).toBe(Position.Left);
    expect(tileExitPort("TileStraight", 1, Position.Left)).toBe(Position.Right);
  });

  it("returns null for a port the straight does not connect", () => {
    expect(tileExitPort("TileStraight", 0, Position.Left)).toBeNull();
  });
});

describe("tileExitPort - curve", () => {
  it("connects the two ports for each rotation", () => {
    // rot 0: Top<->Right
    expect(tileExitPort("TileCurve", 0, Position.Top)).toBe(Position.Right);
    expect(tileExitPort("TileCurve", 0, Position.Right)).toBe(Position.Top);
    // rot 1: Right<->Bottom
    expect(tileExitPort("TileCurve", 1, Position.Right)).toBe(Position.Bottom);
    // rot 2: Bottom<->Left
    expect(tileExitPort("TileCurve", 2, Position.Bottom)).toBe(Position.Left);
    // rot 3: Left<->Top
    expect(tileExitPort("TileCurve", 3, Position.Left)).toBe(Position.Top);
  });
});

describe("tileExitPort - depot", () => {
  it("connects the outer port (per rotation) to Center", () => {
    expect(tileExitPort("TileDepot", 0, Position.Top)).toBe(Position.Center);
    expect(tileExitPort("TileDepot", 0, Position.Center)).toBe(Position.Top);
    expect(tileExitPort("TileDepot", 1, Position.Right)).toBe(Position.Center);
    expect(tileExitPort("TileDepot", 3, Position.Center)).toBe(Position.Left);
  });
});

describe("tileExitPort - intersection", () => {
  it("exits according to the switch arm for the entry port", () => {
    // Top entry: Left->Right, Straight->Bottom, Right->Left
    expect(
      tileExitPort("TileIntersectionComplete", 0, Position.Top, {
        switchArm: ActiveIntersection.Left,
      })
    ).toBe(Position.Right);
    expect(
      tileExitPort("TileIntersectionComplete", 0, Position.Top, {
        switchArm: ActiveIntersection.Straight,
      })
    ).toBe(Position.Bottom);
    // Right entry, Straight -> Left
    expect(
      tileExitPort("TileIntersectionComplete", 0, Position.Right, {
        switchArm: ActiveIntersection.Straight,
      })
    ).toBe(Position.Left);
  });
});
