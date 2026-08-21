import { describe, expect, it } from "vitest";
import {
  MEADOW_TILE,
  backdropCellOf,
  backdropCorridorsAt,
  backdropTreeFelledBy,
  backdropTreeHiddenBy,
  meadowTreeLayout,
} from "@/utils/meadowBackdrop";
import { expandKind } from "@/tiles/kinds";
import { Position } from "@/types";
import { fromPairs } from "@/tiles/lanes";
import { Level, TileCell } from "@/tiles/model";

const { Left, Right } = Position;

describe("meadowTreeLayout", () => {
  it("is deterministic: same seed, same trees", () => {
    const a = meadowTreeLayout();
    const b = meadowTreeLayout();
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
  });

  it("places every tree's base inside the pattern tile", () => {
    for (const t of meadowTreeLayout()) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(MEADOW_TILE);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(MEADOW_TILE);
      expect(t.svg).toContain("<");
    }
  });
});

describe("backdropTreeHiddenBy", () => {
  it("keeps trees on open ground and on rail/road cells (the corridor rule decides there)", () => {
    expect(backdropTreeHiddenBy(undefined)).toBe(false);
    expect(backdropTreeHiddenBy(null)).toBe(false);
    // A cell merely carrying track or a street doesn't swallow a tree by
    // itself — whether it survives is the trunk-vs-corridor test below.
    expect(backdropTreeHiddenBy(expandKind("straight", 1))).toBe(false);
    const road: TileCell = { connections: [], road: fromPairs([[Left, Right]]) };
    expect(backdropTreeHiddenBy(road)).toBe(false);
    // Explicit grass terrain is the same picture as no terrain at all.
    expect(backdropTreeHiddenBy({ connections: [], terrain: "grass" })).toBe(false);
  });

  it("hides trees swallowed by worked or covered ground", () => {
    // Any non-grass terrain paints its own ground over the meadow.
    for (const terrain of ["water", "forest", "urban", "rock", "mountain", "farmland", "industry"] as const) {
      expect(backdropTreeHiddenBy({ connections: [], terrain })).toBe(true);
    }
    // A depot or station owns its plot (building art covers the ground)...
    expect(backdropTreeHiddenBy(expandKind("depot", 0))).toBe(true);
    expect(backdropTreeHiddenBy(expandKind("station", 0))).toBe(true);
    // ...and so does a row of parking bays.
    const parked = {
      connections: [],
      road: fromPairs([[Left, Right]]),
      parking: { rows: [] },
    } as unknown as TileCell;
    expect(backdropTreeHiddenBy(parked)).toBe(true);
  });
});

describe("the felled right-of-way (the forest's corridor rule)", () => {
  it("fells a trunk standing in the ballast, keeps one beside the line", () => {
    // A vertical rail through (0,0): centreline x=50 in ground units.
    const level: Level = { "0,0": expandKind("straight", 0) };
    const corridors = backdropCorridorsAt(level, 0, 0);
    expect(corridors.length).toBeGreaterThan(0);
    // Dead centre of the track: felled.
    expect(backdropTreeFelledBy(corridors, { x: 50, y: 50 })).toBe(true);
    // Just beside the ballast: stands (its crown may overhang the line —
    // that's the canopy overlay's pass-under effect).
    expect(backdropTreeFelledBy(corridors, { x: 15, y: 50 })).toBe(false);
  });

  it("fells a trunk on the carriageway of a road", () => {
    const level: Level = {
      "0,0": { connections: [], road: fromPairs([[Left, Right]]) },
    };
    const corridors = backdropCorridorsAt(level, 0, 0);
    // On the tarmac (centreline y=50): felled.
    expect(backdropTreeFelledBy(corridors, { x: 50, y: 55 })).toBe(true);
    // On the verge, well off the lane stack: stands.
    expect(backdropTreeFelledBy(corridors, { x: 50, y: 85 })).toBe(false);
  });

  it("reads the neighbours' corridors too — a rail running up to the shared edge", () => {
    // The rail lives on (1,0); the tree stands on the EMPTY cell (0,0) hard
    // against their shared boundary, in the neighbour's ballast.
    const level: Level = { "1,0": expandKind("straight", 1) };
    const corridors = backdropCorridorsAt(level, 0, 0);
    expect(backdropTreeFelledBy(corridors, { x: 99, y: 50 })).toBe(true);
    expect(backdropTreeFelledBy(corridors, { x: 50, y: 50 })).toBe(false);
  });

  it("maps a world px position onto its cell, floor-based for the -1 cells", () => {
    expect(backdropCellOf(250, 50, 200)).toEqual({
      cx: 1,
      cy: 0,
      local: { x: 25, y: 25 },
    });
    const off = backdropCellOf(-10, 10, 200);
    expect(off.cx).toBe(-1);
    expect(off.local.x).toBeCloseTo(95);
  });
});
