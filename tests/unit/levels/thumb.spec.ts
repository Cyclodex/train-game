import { describe, it, expect } from "vitest";
import { SCENARIOS } from "@/levels/test";
import { scenarioGrid } from "@/levels/test/scenario";
import { scenarioThumb } from "@/levels/test/thumb";

// The gallery image tiles render scenarioThumb() as static background art. These
// guard that it produces sane, non-throwing geometry for every scenario, and that
// every tile in the level is represented.
describe("scenario thumbnail", () => {
  for (const scenario of SCENARIOS) {
    describe(scenario.id, () => {
      const grid = scenarioGrid(scenario);
      const thumb = scenarioThumb(scenario.level, grid);

      it("covers the whole grid with a viewBox", () => {
        expect(thumb.viewBox).toBe(`0 0 ${grid.cols * thumb.unit} ${grid.rows * thumb.unit}`);
        expect(thumb.cols).toBe(grid.cols);
        expect(thumb.rows).toBe(grid.rows);
      });

      it("emits one preview tile per level cell, placed in-grid", () => {
        expect(thumb.tiles.length).toBe(Object.keys(scenario.level).length);
        for (const t of thumb.tiles) {
          expect(t.tx).toBeGreaterThanOrEqual(0);
          expect(t.ty).toBeGreaterThanOrEqual(0);
          expect(t.tx).toBeLessThan(grid.cols * thumb.unit);
          expect(t.ty).toBeLessThan(grid.rows * thumb.unit);
        }
      });

      it("draws something — rails or roads — and only finite path data", () => {
        const paths = thumb.tiles.flatMap(t => [...t.roads, ...t.bed, ...t.rails]);
        expect(paths.length).toBeGreaterThan(0);
        for (const d of paths) expect(d).not.toMatch(/NaN|undefined|Infinity/);
      });

      it("marks every depot cell", () => {
        const depotCells = Object.values(scenario.level).filter(c => c.role === "depot").length;
        const depotTiles = thumb.tiles.filter(t => t.depot).length;
        expect(depotTiles).toBe(depotCells);
      });
    });
  }
});
