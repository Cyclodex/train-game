import { describe, it, expect } from "vitest";
import { DOMAINS, SCENARIOS } from "@/levels/test";
import { iconForDomain, iconForCategory, iconForScenario } from "@/levels/test/icons";

// Every gallery tile shows an identity glyph. Guard that each domain, category,
// and scenario resolves to a non-empty icon (scenarios fall back to their
// category icon, so none should ever hit the generic placeholder).
describe("gallery tile icons", () => {
  it("gives every domain an icon", () => {
    for (const d of DOMAINS) expect(iconForDomain(d.id)).toBeTruthy();
  });

  it("gives every category an icon", () => {
    for (const d of DOMAINS) {
      for (const c of d.categories) {
        expect(iconForCategory(d.id, c.id)).toBeTruthy();
      }
    }
  });

  it("gives every scenario a real icon (never the generic fallback)", () => {
    for (const s of SCENARIOS) {
      const icon = iconForScenario(s.id);
      expect(icon).toBeTruthy();
      expect(icon).not.toBe("🧩");
    }
  });
});
