import { describe, it, expect } from "vitest";
import { getRandom, resolveRef, Colors } from "@/utils/globalHelpers";

describe("getRandom", () => {
  it("returns an element from the list", () => {
    const list = ["a", "b", "c"];
    expect(list).toContain(getRandom(list));
  });

  it("Colors is a non-empty palette", () => {
    expect(Colors.length).toBeGreaterThan(0);
  });
});

describe("resolveRef", () => {
  // Bridges the Vue 2 -> Vue 3 difference in how `ref` inside `v-for` resolves.
  it("unwraps the first element of a Vue 2 style ref array", () => {
    const instance = { id: "tile" };
    expect(resolveRef([instance])).toBe(instance);
  });

  it("returns a Vue 3 single instance unchanged", () => {
    const instance = { id: "tile" };
    expect(resolveRef(instance)).toBe(instance);
  });
});
