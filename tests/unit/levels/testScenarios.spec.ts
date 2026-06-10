import { describe, it, expect } from "vitest";
import { SCENARIOS } from "@/levels/test";
import { scenarioRoutes, scenarioGrid } from "@/levels/test/scenario";
import { validateLevel, validateRoads } from "@/tiles/validate";

describe("feature test world", () => {
  it("has unique, url-safe scenario ids", () => {
    const ids = SCENARIOS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  for (const scenario of SCENARIOS) {
    describe(scenario.id, () => {
      it("is a connected level with every train route reachable", () => {
        const res = validateLevel(scenario.level, scenarioRoutes(scenario));
        expect(res.issues).toEqual([]);
        expect(res.ok).toBe(true);
      });

      it("has a valid road layer", () => {
        const res = validateRoads(scenario.level);
        expect(res.issues).toEqual([]);
      });

      it("every train starts in a depot tile", () => {
        for (const train of Object.values(scenario.trains)) {
          const start = scenario.level[`${train.x},${train.y}`];
          expect(start?.role).toBe("depot");
        }
      });

      it("fits within its derived grid", () => {
        const { cols, rows } = scenarioGrid(scenario);
        for (const id of Object.keys(scenario.level)) {
          const [x, y] = id.split(",").map(Number);
          expect(x).toBeLessThan(cols);
          expect(y).toBeLessThan(rows);
        }
      });
    });
  }
});
