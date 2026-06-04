import { describe, it, expect } from "vitest";
import {
  getCoordinatesId,
  getTileEntrancePosition,
  getRelativeCoordinatesOfNextTile,
} from "@/utils/tileHelpers";
import { Position } from "@/types";

describe("getCoordinatesId", () => {
  it("formats coordinates as 'x,y'", () => {
    expect(getCoordinatesId({ x: 2, y: 3 })).toBe("2,3");
    expect(getCoordinatesId({ x: 0, y: 0 })).toBe("0,0");
  });
});

describe("getRelativeCoordinatesOfNextTile", () => {
  it("maps a leaving position to a grid delta (y increases downward)", () => {
    expect(getRelativeCoordinatesOfNextTile(Position.Top)).toEqual({
      x: 0,
      y: -1,
    });
    expect(getRelativeCoordinatesOfNextTile(Position.Right)).toEqual({
      x: 1,
      y: 0,
    });
    expect(getRelativeCoordinatesOfNextTile(Position.Bottom)).toEqual({
      x: 0,
      y: 1,
    });
    expect(getRelativeCoordinatesOfNextTile(Position.Left)).toEqual({
      x: -1,
      y: 0,
    });
  });

  it("returns no movement for Center", () => {
    expect(getRelativeCoordinatesOfNextTile(Position.Center)).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("getTileEntrancePosition", () => {
  // The entrance position is the side opposite to the direction of travel:
  // moving one tile to the right means entering the next tile from its left.
  it("returns the entrance side opposite the travel direction", () => {
    const origin = { x: 2, y: 2 };
    expect(getTileEntrancePosition({ x: 3, y: 2 }, origin)).toBe(Position.Left);
    expect(getTileEntrancePosition({ x: 1, y: 2 }, origin)).toBe(Position.Right);
    expect(getTileEntrancePosition({ x: 2, y: 3 }, origin)).toBe(Position.Top);
    expect(getTileEntrancePosition({ x: 2, y: 1 }, origin)).toBe(
      Position.Bottom
    );
  });

  it("returns Center when origin and next are the same tile", () => {
    expect(getTileEntrancePosition({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(
      Position.Center
    );
  });

  // getRelativeCoordinatesOfNextTile and getTileEntrancePosition are inverse-ish
  // operations: leaving a tile to the Right lands on a tile entered from Left.
  it("is consistent with getRelativeCoordinatesOfNextTile", () => {
    const origin = { x: 4, y: 4 };
    const delta = getRelativeCoordinatesOfNextTile(Position.Right);
    const next = { x: origin.x + delta.x, y: origin.y + delta.y };
    expect(getTileEntrancePosition(next, origin)).toBe(Position.Left);
  });
});
