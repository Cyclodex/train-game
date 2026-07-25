import { describe, it, expect } from "vitest";
import { setTerrain, isBlankCell, emptyCell, setDepot } from "@/tiles/editOps";
import { Position } from "@/types";

describe("terrain editing", () => {
  describe("setTerrain", () => {
    it("paints a kind onto an empty cell", () => {
      expect(setTerrain(emptyCell(), "water")).toEqual({
        connections: [],
        terrain: "water",
      });
    });

    it("stores grass as ABSENT, not as a value", () => {
      // Absent must mean grass everywhere (tiles/terrain.ts), so writing the
      // string would create a second spelling of the same thing that only the
      // editor produces — and levels authored by hand would differ from levels
      // painted in the editor for no visible reason.
      const painted = setTerrain(emptyCell(), "forest");
      expect(setTerrain(painted, "grass")).toEqual({ connections: [] });
      expect(setTerrain(painted, undefined)).toEqual({ connections: [] });
    });

    it("leaves everything else on the cell alone", () => {
      const depot = setDepot(emptyCell(), Position.Right);
      const painted = setTerrain(depot, "urban");
      expect(painted.role).toBe("depot");
      expect(painted.connections).toEqual(depot.connections);
      expect(painted.terrain).toBe("urban");
    });

    it("is immutable", () => {
      const before = emptyCell();
      setTerrain(before, "rock");
      expect(before.terrain).toBeUndefined();
    });
  });

  describe("isBlankCell", () => {
    it("treats a terrain-only cell as REAL, not blank", () => {
      // Regression: the editor's commit() dropped any cell with no connections,
      // signals or road — which deleted a lake tile the instant the brush
      // painted it, because terrain is the only thing such a cell carries.
      expect(isBlankCell({ connections: [], terrain: "water" })).toBe(false);
    });

    it("treats a cell carrying nothing as blank", () => {
      expect(isBlankCell(emptyCell())).toBe(true);
      expect(isBlankCell(setTerrain({ connections: [], terrain: "rock" }, "grass"))).toBe(true);
    });

    it("treats track, road, depots and signals as real", () => {
      expect(isBlankCell({ connections: [[Position.Left, Position.Right]] })).toBe(false);
      expect(isBlankCell({ connections: [], role: "depot" })).toBe(false);
      expect(isBlankCell({ connections: [], signals: [Position.Right] })).toBe(false);
      expect(
        isBlankCell({
          connections: [],
          road: [{ from: Position.Left, to: [Position.Right], index: 0 }],
        }),
      ).toBe(false);
    });
  });
});
