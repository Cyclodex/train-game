import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { deriveLevel, PaintMap } from "@/tiles/autotile";
import { kindOf } from "@/tiles/model";
import { validateLevel } from "@/tiles/validate";

const { Center } = Position;

describe("deriveLevel", () => {
  it("auto-tiles a depot-straight-depot line into a connected, valid level", () => {
    const paint: PaintMap = {
      "0,0": { paint: "depot" },
      "1,0": { paint: "track" },
      "2,0": { paint: "depot" },
    };
    const level = deriveLevel(paint);

    // Middle cell sees two horizontal track/depot neighbours -> straight.
    expect(kindOf(level["1,0"])).toBe("straight");
    // Depots face inward toward the track.
    expect(level["0,0"].role).toBe("depot");
    expect(level["2,0"].role).toBe("depot");

    const res = validateLevel(level, [{ from: "0,0", to: "2,0" }]);
    expect(res.ok, JSON.stringify(res.issues)).toBe(true);
  });

  it("forms a junction where a branch meets a line", () => {
    // A horizontal line 0,1-1,1-2,1 with a branch going up from 1,1 to 1,0.
    const paint: PaintMap = {
      "0,1": { paint: "track" },
      "1,1": { paint: "track" },
      "2,1": { paint: "track" },
      "1,0": { paint: "track" },
    };
    const level = deriveLevel(paint);
    expect(kindOf(level["1,1"])).toBe("tjunction");
  });

  it("a depot whose facing neighbour is empty still connects to an adjacent track on another side", () => {
    const paint: PaintMap = {
      "1,1": { paint: "depot" }, // track is below it
      "1,2": { paint: "track" },
      "1,3": { paint: "depot" },
    };
    const level = deriveLevel(paint);
    // depot 1,1 should face Bottom (toward the track at 1,2).
    const conn = level["1,1"].connections[0];
    expect(conn).toContain(Center);
    const res = validateLevel(level);
    expect(res.issues.some(i => i.type === "isolated-depot")).toBe(false);
  });
});
