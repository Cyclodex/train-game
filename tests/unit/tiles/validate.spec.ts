import { describe, it, expect } from "vitest";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { validateLevel } from "@/tiles/validate";

// depot(->Right) - straight - depot(->Left): a clean, fully connected line.
const goodLevel: Level = {
  "0,0": expandKind("depot", 1), // faces Right
  "1,0": expandKind("straight", 1), // Left-Right
  "2,0": expandKind("depot", 3), // faces Left
};

describe("validateLevel", () => {
  it("accepts a fully connected line and confirms the route", () => {
    const res = validateLevel(goodLevel, [{ from: "0,0", to: "2,0" }]);
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it("flags dangling track with no connecting neighbour", () => {
    const res = validateLevel({ "0,0": expandKind("straight", 1) });
    expect(res.ok).toBe(false);
    expect(res.issues.some(i => i.type === "dangling-track")).toBe(true);
  });

  it("flags an isolated depot", () => {
    const res = validateLevel({ "0,0": expandKind("depot", 1) });
    expect(res.issues.some(i => i.type === "isolated-depot")).toBe(true);
  });

  it("flags a disconnected train route", () => {
    // Two separate one-tile lines that never meet.
    const level: Level = {
      "0,0": expandKind("depot", 1),
      "1,0": expandKind("depot", 3),
      "5,5": expandKind("depot", 1),
      "6,5": expandKind("depot", 3),
    };
    const res = validateLevel(level, [{ from: "0,0", to: "5,5" }]);
    expect(res.issues.some(i => i.type === "route-disconnected")).toBe(true);
  });
});
