import { describe, it, expect } from "vitest";
import { Position, ActiveIntersection } from "@/types";
import { Level } from "@/tiles/model";
import { initialSwitches } from "@/game";

const { Top, Right, Bottom, Left } = Position;
const TJUNCTION: [Position, Position][] = [
  [Left, Right],
  [Left, Top],
  [Right, Top],
];
const CROSS_FULL: [Position, Position][] = [
  [Top, Bottom],
  [Left, Right],
  [Top, Right],
  [Right, Bottom],
  [Bottom, Left],
  [Left, Top],
];

describe("initialSwitches seeding", () => {
  it("honours an authored defaultArm when its exit is a real partner", () => {
    // T-junction Top entry: arm Right -> exit Left, which is a partner.
    const level: Level = {
      "0,0": { connections: TJUNCTION, defaultArms: { [Top]: ActiveIntersection.Right } },
    };
    expect(initialSwitches(level)["0,0"][Top]).toBe(ActiveIntersection.Right);
  });

  it("falls back to the computed first-valid arm with no defaultArms", () => {
    // Full cross Top entry: first valid arm in Left/Straight/Right order is Left.
    const level: Level = { "0,0": { connections: CROSS_FULL } };
    expect(initialSwitches(level)["0,0"][Top]).toBe(ActiveIntersection.Left);
  });

  it("falls back when the authored arm is stale (exit not a partner)", () => {
    // T-junction Top entry: arm Straight -> exit Bottom is not a partner, so the
    // authored arm is ignored and the computed first-valid arm (Left) is used.
    const level: Level = {
      "0,0": { connections: TJUNCTION, defaultArms: { [Top]: ActiveIntersection.Straight } },
    };
    expect(initialSwitches(level)["0,0"][Top]).toBe(ActiveIntersection.Left);
  });
});
