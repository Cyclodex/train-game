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

  // The mode gallery, resolved once. A missing domain/category is reported as a
  // readable failure rather than a TypeError from a `!` on undefined — this is
  // the node a category rename breaks first, so it has to say WHICH node is
  // gone, not just where the stack unwound.
  function modeGallery() {
    const domain = DOMAINS.find(d => d.id === "challenges");
    expect(domain, 'no domain "challenges" in the DOMAINS tree').toBeDefined();
    const category = domain?.categories.find(c => c.id === "modes");
    expect(category, 'no category "challenges/modes" in the DOMAINS tree').toBeDefined();
    return category!.scenarios;
  }

  it("challenges/modes is a mode gallery: every entry runs a mode, no mode twice", () => {
    // The category exists to show each game mode in isolation (#115). An entry
    // without a mode silently demos Sandbox instead of what its card claims,
    // and two entries for one mode crowd out the single-demo-per-mode promise.
    // (Sandbox and any deliberately unlisted mode are allowed to be absent.)
    const seen = new Set<string>();
    for (const s of modeGallery()) {
      const modeId = s.mode?.id ?? s.modeId;
      expect(modeId, `scenario "${s.id}" in challenges/modes runs no mode`).toBeTruthy();
      expect(seen.has(modeId!), `mode "${modeId}" has two demos in challenges/modes`).toBe(false);
      seen.add(modeId!);
    }
  });

  it("challenges/modes demos EVERY objective-carrying picker mode (#115)", () => {
    // The other half of "exactly one scenario per mode": no-mode-twice alone
    // let a NEW mode ship with no card at all and CI stay green, so the
    // gallery's headline promise was only half held.
    //
    // Exempt: Sandbox — it IS the stage's default, so a card for it would
    // demo the absence of rules. Every other registered mode needs an entry.
    const EXEMPT = new Set(["sandbox"]);
    const demoed = new Set(modeGallery().map(s => s.mode?.id ?? s.modeId));
    for (const m of MODES) {
      if (EXEMPT.has(m.id)) continue;
      expect(
        demoed.has(m.id),
        `mode "${m.id}" is in the picker but has no demo in challenges/modes`
      ).toBe(true);
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
