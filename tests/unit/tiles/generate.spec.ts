import { describe, it, expect } from "vitest";
import { generateLevel } from "@/tiles/generate";
import { validateLevel } from "@/tiles/validate";

describe("generateLevel", () => {
  it("always produces a level that passes validation", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { level, routes } = generateLevel(seed, {
        width: 7,
        height: 6,
        depotPairs: 2,
      });
      const res = validateLevel(level, routes);
      expect(res.ok, `seed ${seed}: ${JSON.stringify(res.issues)}`).toBe(true);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = generateLevel(42, { width: 8, height: 6, depotPairs: 2 });
    const b = generateLevel(42, { width: 8, height: 6, depotPairs: 2 });
    expect(b).toEqual(a);
  });

  it("places the requested number of paired depots and routes", () => {
    const { depots, routes } = generateLevel(3, {
      width: 9,
      height: 7,
      depotPairs: 2,
    });
    expect(depots.length).toBeGreaterThanOrEqual(4);
    expect(depots.length % 2).toBe(0);
    expect(routes.length).toBe(depots.length / 2);
  });

  it("varies across seeds", () => {
    const a = generateLevel(1, { width: 8, height: 6, depotPairs: 2 });
    const differs = [2, 3, 4, 5].some(
      s =>
        JSON.stringify(generateLevel(s, { width: 8, height: 6, depotPairs: 2 })) !==
        JSON.stringify(a)
    );
    expect(differs).toBe(true);
  });
});
