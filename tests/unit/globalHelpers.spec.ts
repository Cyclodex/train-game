import { describe, it, expect } from "vitest";
import { getRandom, Colors } from "@/utils/globalHelpers";

describe("getRandom", () => {
  it("returns an element from the list", () => {
    const list = ["a", "b", "c"];
    expect(list).toContain(getRandom(list));
  });

  it("Colors is a non-empty palette", () => {
    expect(Colors.length).toBeGreaterThan(0);
  });
});
