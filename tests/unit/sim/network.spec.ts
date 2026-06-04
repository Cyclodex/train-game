import { describe, it, expect } from "vitest";
import { traverse } from "@/sim/network";
import {
  LevelDefinition,
  Position,
  ActiveIntersection,
} from "@/types";

const noSwitches = () => undefined;

function level(tiles: Array<[string, string, number?]>): LevelDefinition {
  const out: LevelDefinition = {};
  for (const [key, component, rotation] of tiles) {
    const [x, y] = key.split(",").map(Number);
    out[key] = { x, y, component, rotation: rotation ?? 0 };
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
