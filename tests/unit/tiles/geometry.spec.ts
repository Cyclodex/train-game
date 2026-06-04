import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { railPathsFor } from "@/tiles/geometry";

const { Top, Bottom, Right, Center } = Position;
const SIZE = 200;
const OFF = 14;

describe("railPathsFor", () => {
  it("returns exactly two rail paths", () => {
    expect(railPathsFor(Top, Bottom, SIZE, OFF)).toHaveLength(2);
  });

  it("vertical straight: rails are two vertical lines offset in x by +/- offset", () => {
    const [r1, r2] = railPathsFor(Top, Bottom, SIZE, OFF);
    // Centre of a vertical straight is x=100; rails at 100+/-14 = 86 and 114.
    expect(r1).toContain("86");
    expect(r2).toContain("114");
  });

  it("curve uses a quadratic (Q) command", () => {
    const [r1] = railPathsFor(Top, Right, SIZE, OFF);
    expect(r1).toContain("Q");
  });

  it("depot stub (port<->Center) returns two offset lines", () => {
    expect(railPathsFor(Top, Center, SIZE, OFF)).toHaveLength(2);
  });
});
