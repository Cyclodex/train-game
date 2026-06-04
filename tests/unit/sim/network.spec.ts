import { describe, it, expect } from "vitest";
import { traverse, routeToNextSignal } from "@/sim/network";
import { Position, ActiveIntersection } from "@/types";
import { Level } from "@/tiles/model";
import { AuthorKind, expandKind } from "@/tiles/kinds";

const noSwitches = () => undefined;

// Map legacy component names used in these fixtures to the new authoring kinds.
const KIND: Record<string, AuthorKind> = {
  TileStraight: "straight",
  TileCurve: "curve",
  TileDepot: "depot",
  TileIntersectionComplete: "cross",
};

function level(tiles: Array<[string, string, number?]>): Level {
  const out: Level = {};
  for (const [key, component, rotation] of tiles) {
    out[key] = expandKind(KIND[component], rotation ?? 0);
  }
  return out;
}

describe("traverse", () => {
  it("follows a horizontal straight to the next tile", () => {
    const lvl = level([
      ["0,0", "TileStraight", 1],
      ["1,0", "TileStraight", 1],
    ]);
    const t = traverse(lvl, noSwitches, { x: 0, y: 0 }, Position.Left);
    expect(t.exitPort).toBe(Position.Right);
    expect(t.next).toEqual({ coord: { x: 1, y: 0 }, entryPort: Position.Left });
  });

  it("returns no next tile when leaving the map edge", () => {
    const lvl = level([["0,0", "TileStraight", 1]]);
    const t = traverse(lvl, noSwitches, { x: 0, y: 0 }, Position.Left);
    expect(t.exitPort).toBe(Position.Right);
    expect(t.next).toBeNull();
  });

  it("treats a depot exit (Center) as terminal with no next tile", () => {
    const lvl = level([["0,0", "TileDepot", 0]]);
    // Enter the depot from the Top, park in the Center.
    const t = traverse(lvl, noSwitches, { x: 0, y: 0 }, Position.Top);
    expect(t.exitPort).toBe(Position.Center);
    expect(t.next).toBeNull();
  });

  it("returns no exit for a port the tile does not connect", () => {
    const lvl = level([["0,0", "TileStraight", 0]]); // vertical
    const t = traverse(lvl, noSwitches, { x: 0, y: 0 }, Position.Left);
    expect(t.exitPort).toBeNull();
    expect(t.next).toBeNull();
  });

  it("uses the switch resolver for intersections", () => {
    const lvl = level([
      ["1,1", "TileIntersectionComplete", 0],
      ["1,2", "TileStraight", 0],
    ]);
    // Entering the intersection from the Top with the Straight arm -> Bottom.
    const getSwitch = (coordId: string, entryPort: Position) =>
      coordId === "1,1" && entryPort === Position.Top
        ? ActiveIntersection.Straight
        : undefined;
    const t = traverse(lvl, getSwitch, { x: 1, y: 1 }, Position.Top);
    expect(t.exitPort).toBe(Position.Bottom);
    expect(t.next).toEqual({ coord: { x: 1, y: 2 }, entryPort: Position.Top });
  });
});

describe("routeToNextSignal", () => {
  const noSwitchesFn = () => undefined;

  it("collects the block tiles up to and including the next signal", () => {
    const lvl = level([
      ["0,0", "TileStraight", 1],
      ["1,0", "TileStraight", 1], // signal
      ["2,0", "TileStraight", 1],
      ["3,0", "TileStraight", 1], // signal
      ["4,0", "TileStraight", 1],
    ]);
    const isBoundary = (id: string) => id === "1,0" || id === "3,0";
    // From the signal at 1,0 heading right: the block is 2,0 then the next
    // signal 3,0 (inclusive).
    const route = routeToNextSignal(
      lvl,
      noSwitchesFn,
      isBoundary,
      { x: 1, y: 0 },
      Position.Left
    );
    expect(route).toEqual(["2,0", "3,0"]);
  });

  it("ends the block at a depot / map edge", () => {
    const lvl = level([
      ["0,0", "TileStraight", 1], // signal
      ["1,0", "TileStraight", 1],
      ["2,0", "TileDepot", 3], // opening on the Left -> a boundary
    ]);
    const isBoundary = (id: string) => id === "0,0" || id === "2,0";
    const route = routeToNextSignal(
      lvl,
      noSwitchesFn,
      isBoundary,
      { x: 0, y: 0 },
      Position.Left
    );
    expect(route).toEqual(["1,0", "2,0"]);
  });

  it("stops on a loop without running forever", () => {
    // A 2x2 loop of curves with no boundary at all.
    const lvl = level([
      ["0,0", "TileCurve", 1], // Right<->Bottom
      ["1,0", "TileCurve", 2], // Bottom<->Left
      ["1,1", "TileCurve", 3], // Left<->Top
      ["0,1", "TileCurve", 0], // Top<->Right
    ]);
    const route = routeToNextSignal(
      lvl,
      noSwitchesFn,
      () => false,
      { x: 0, y: 0 },
      Position.Right
    );
    // No signal anywhere: it walks the loop once and stops (no infinite loop).
    expect(route.length).toBeGreaterThan(0);
    expect(route.length).toBeLessThan(20);
  });
});
