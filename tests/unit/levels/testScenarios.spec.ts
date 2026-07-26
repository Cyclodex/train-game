import { describe, it, expect } from "vitest";
import { SCENARIOS } from "@/levels/test";
import { scenarioRoutes, scenarioGrid } from "@/levels/test/scenario";
import { validateLevel, validateRoads } from "@/tiles/validate";
import { roadEntries } from "@/sim/road";

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
        // A deliberately-incomplete board (`allowIncomplete`, e.g. buildgap)
        // OPENS with dangling open ends and an unreachable destination — buying
        // the track that closes that gap in play is its whole point, so those
        // two issue types are expected there and only there. Everything else
        // (blocked terrain, isolated depots) must still hold on such a board,
        // and every other scenario keeps the full check. Do NOT widen this:
        // the flag is per-scenario opt-in precisely so a genuinely broken map
        // elsewhere still fails CI.
        const issues = scenario.allowIncomplete
          ? res.issues.filter(
              i =>
                i.type !== "dangling-track" && i.type !== "route-disconnected"
            )
          : res.issues;
        expect(issues).toEqual([]);
        if (!scenario.allowIncomplete) expect(res.ok).toBe(true);
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

      it("if it declares traffic, the road actually has a spawn entry", () => {
        // A scenario that declares `traffic` but whose road is a CLOSED map (no
        // road port opening off the grid) spawns ZERO vehicles — the feature is
        // silently dead. Reuse the sim's own spawn-entry derivation (roadEntries)
        // so the rule can't drift from how the sim actually spawns. A scenario may
        // supply explicit `spawnEntries`, which bypass edge detection — accept those.
        if (!scenario.traffic) return;
        const explicit = scenario.traffic.spawnEntries ?? [];
        if (explicit.length > 0) return;
        const { cols, rows } = scenarioGrid(scenario);
        const entries = roadEntries(scenario.level, cols, rows);
        expect(entries.length).toBeGreaterThan(0);
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
