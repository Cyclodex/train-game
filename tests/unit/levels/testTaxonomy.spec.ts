import { describe, it, expect } from "vitest";
import { DOMAINS, SCENARIOS, locate, domainById } from "@/levels/test";

// The /test gallery navigates a domain → category → scenario tree. These guard
// that the tree is well-formed: ids are url-safe and unique at each level, the
// flat SCENARIOS registry is exactly the tree's leaves, and every scenario is
// reachable through exactly one domain/category (so breadcrumbs + the
// back-compat redirect always resolve).
describe("test world taxonomy", () => {
  it("has unique, url-safe domain ids", () => {
    const ids = DOMAINS.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("has unique, url-safe category ids within each domain", () => {
    for (const domain of DOMAINS) {
      const ids = domain.categories.map(c => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("derives SCENARIOS from exactly the tree's leaves, in order", () => {
    const leaves = DOMAINS.flatMap(d => d.categories).flatMap(c => c.scenarios);
    expect(SCENARIOS).toEqual(leaves);
  });

  it("places every scenario under exactly one domain/category", () => {
    for (const scenario of SCENARIOS) {
      const hits = DOMAINS.flatMap(d =>
        d.categories
          .filter(c => c.scenarios.some(s => s.id === scenario.id))
          .map(c => ({ domain: d, category: c }))
      );
      expect(hits.length).toBe(1);
    }
  });

  it("locate() round-trips every scenario to its place in the tree", () => {
    for (const scenario of SCENARIOS) {
      const found = locate(scenario.id);
      expect(found).toBeDefined();
      expect(domainById(found!.domain.id)).toBe(found!.domain);
      expect(found!.category.scenarios).toContain(scenario);
    }
  });

  it("has no empty categories", () => {
    for (const domain of DOMAINS) {
      for (const category of domain.categories) {
        expect(category.scenarios.length).toBeGreaterThan(0);
      }
    }
  });
});
