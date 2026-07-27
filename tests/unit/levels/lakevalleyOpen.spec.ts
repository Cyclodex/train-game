import { describe, it, expect } from "vitest";
import { lakevalley } from "@/levels/test/scenarios/lakevalley";
import {
  lakevalleyOpen,
  LAKEVALLEY_SOUTH_RUN,
} from "@/levels/test/scenarios/lakevalley-open";
import { validateLevel } from "@/tiles/validate";

// The opening state is DERIVED from the complete reference board (minus the
// south run), so the two can never drift. These tests pin the derivation, and
// pin that the half of the board that must work on open really does.
describe("lakevalley-open (the opening state)", () => {
  it("is the complete board minus exactly the south run", () => {
    for (const id of LAKEVALLEY_SOUTH_RUN) {
      expect(lakevalleyOpen.level[id], `${id} should be removed`).toBeUndefined();
      expect(lakevalley.level[id], `${id} should exist on the reference`).toBeDefined();
    }
    const openIds = Object.keys(lakevalleyOpen.level).sort();
    const expected = Object.keys(lakevalley.level)
      .filter(id => !LAKEVALLEY_SOUTH_RUN.includes(id))
      .sort();
    expect(openIds).toEqual(expected);
    for (const id of openIds) {
      expect(lakevalleyOpen.level[id]).toEqual(lakevalley.level[id]);
    }
  });

  it("shares no cell or train references with the reference board", () => {
    // Both boards are handed to createGame and edited in play; a shared object
    // would let one board's session leak into the other's.
    for (const id of Object.keys(lakevalleyOpen.level)) {
      expect(lakevalleyOpen.level[id]).not.toBe(lakevalley.level[id]);
    }
    expect(lakevalleyOpen.trains).toEqual(lakevalley.trains);
    for (const id of Object.keys(lakevalleyOpen.trains)) {
      expect(lakevalleyOpen.trains[id]).not.toBe(lakevalley.trains[id]);
    }
  });

  it("runs Tycoon and is flagged as a deliberately incomplete board", () => {
    expect(lakevalleyOpen.modeId).toBe("tycoon");
    expect(lakevalleyOpen.allowIncomplete).toBe(true);
  });

  it("cuts the yellow station off but keeps the blue↔red trunk validated", () => {
    // The trunk route must be fully connected on open — a regression here would
    // break the only deliveries possible before any track is bought.
    const trunk = validateLevel(lakevalleyOpen.level, [
      { from: "0,2", to: "8,2" },
    ]);
    expect(trunk.issues.filter(i => i.type === "route-disconnected")).toEqual(
      []
    );
    // The yellow station's routes are the ones the player buys back.
    const cut = validateLevel(lakevalleyOpen.level, [
      { from: "8,2", to: "2,6" },
      { from: "2,6", to: "0,2" },
    ]);
    expect(
      cut.issues.filter(i => i.type === "route-disconnected")
    ).toHaveLength(2);
  });
});
