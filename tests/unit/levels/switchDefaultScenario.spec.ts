import { describe, it, expect } from "vitest";
import { Position, ActiveIntersection } from "@/types";
import { switchDefault } from "@/levels/test/scenarios/switch-default";
import { initialSwitches } from "@/game";

const { Left } = Position;

// The scenario's whole point: an authored starting arm changes how the cross
// begins. Guard it so the scenario can't silently lose its authored arm.
describe("switch-default scenario", () => {
  it("seeds the cross entry on the authored arm, not the computed default", () => {
    const seeded = initialSwitches(switchDefault.level)["1,1"][Left];
    // Authored straight-through (east); the computed first-valid arm would be
    // Left (north), so the authored value must win.
    expect(seeded).toBe(ActiveIntersection.Straight);
    expect(seeded).not.toBe(ActiveIntersection.Left);
  });
});
