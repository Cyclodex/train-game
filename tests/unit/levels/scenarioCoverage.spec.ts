import { describe, it, expect } from "vitest";
import {
  DOMAINS,
  SCENARIOS,
  locate,
  firstScenarioOf,
  scenarioById,
} from "@/levels/test";
import { MODES } from "@/modes";

// Structural coverage guard for the feature-test registry. `testScenarios.spec`
// validates each scenario's *level* (connectivity, routes, grid fit); this file
// guards the *registry tree* itself — the part the picker and the deep-link
// navigation rely on. It enforces the invariants that keep "every feature has a
// scenario" honest: no dead picker nodes, every scenario reachable, and no
// dangling cross-module references (a scenario pinned to a game mode that no
// longer exists). All of these are deterministic and run inside the fast CI.

const URL_SAFE = /^[a-z0-9-]+$/;

describe("feature test world coverage", () => {
  it("has no empty domain (every domain offers at least one category)", () => {
    for (const d of DOMAINS) {
      expect(d.categories.length, `domain "${d.id}" has no categories`).toBeGreaterThan(0);
    }
  });

  it("has no empty category (a dead picker node ships a broken gallery)", () => {
    for (const d of DOMAINS) {
      for (const c of d.categories) {
        expect(
          c.scenarios.length,
          `category "${d.id}/${c.id}" has no scenarios`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("has unique, url-safe domain ids", () => {
    const ids = DOMAINS.map(d => d.id);
    expect(new Set(ids).size, "duplicate domain id").toBe(ids.length);
    for (const id of ids) expect(id).toMatch(URL_SAFE);
  });

  it("has unique, url-safe category ids within each domain", () => {
    for (const d of DOMAINS) {
      const ids = d.categories.map(c => c.id);
      expect(new Set(ids).size, `duplicate category id in "${d.id}"`).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(URL_SAFE);
    }
  });

  it("locates every scenario back to its domain + category", () => {
    for (const s of SCENARIOS) {
      const where = locate(s.id);
      expect(where, `scenario "${s.id}" is not reachable from the DOMAINS tree`).toBeDefined();
      // The flat registry and the tree must agree, so a by-id lookup round-trips.
      expect(scenarioById(s.id).id).toBe(s.id);
    }
  });

  it("resolves a representative scenario for every domain and category", () => {
    for (const d of DOMAINS) {
      expect(firstScenarioOf(d), `domain "${d.id}" has no representative`).toBeDefined();
      for (const c of d.categories) {
        expect(firstScenarioOf(c), `category "${d.id}/${c.id}" has no representative`).toBeDefined();
      }
    }
  });

  it("pins scenarios only to game modes that are actually registered", () => {
    // A scenario may run under a specific mode via `modeId` (e.g. the time-attack
    // scenario). If that id drifts from the modes registry the scenario silently
    // falls back to free-play and stops exercising the feature it claims to.
    const modeIds = new Set(MODES.map(m => m.id));
    for (const s of SCENARIOS) {
      if (s.modeId === undefined) continue;
      expect(
        modeIds.has(s.modeId),
        `scenario "${s.id}" pins modeId "${s.modeId}", which is not in the MODES registry`
      ).toBe(true);
    }
  });
});
