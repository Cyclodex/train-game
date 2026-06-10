import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { deriveConnections } from "@/tiles/autotile";
import { samePair } from "@/tiles/model";

const { Top, Right, Bottom, Left, Center } = Position;
const has = (cell: { connections: [Position, Position][] }, p: [Position, Position]) =>
  cell.connections.some(c => samePair(c, p));

describe("deriveConnections", () => {
  it("empty paint clears connections", () => {
    expect(deriveConnections({ paint: "empty" }, {}).connections).toEqual([]);
  });

  it("depot keeps its explicit facing and sets role", () => {
    const d = deriveConnections({ paint: "depot", facing: Right }, {});
    expect(has(d, [Right, Center])).toBe(true);
    expect(d.role).toBe("depot");
  });

  it("track with two opposite connectable edges is a straight", () => {
    const c = deriveConnections({ paint: "track" }, { [Top]: true, [Bottom]: true });
    expect(c.connections).toHaveLength(1);
    expect(has(c, [Top, Bottom])).toBe(true);
  });

  it("track with two adjacent connectable edges is a curve", () => {
    const c = deriveConnections({ paint: "track" }, { [Top]: true, [Right]: true });
    expect(has(c, [Top, Right])).toBe(true);
  });

  it("track with three+ edges becomes a full junction", () => {
    const c = deriveConnections(
      { paint: "track" },
      { [Top]: true, [Right]: true, [Bottom]: true, [Left]: true }
    );
    expect(c.connections).toHaveLength(6);
  });

  it("track with a single connectable edge is a dead-end stub", () => {
    const c = deriveConnections({ paint: "track" }, { [Left]: true });
    expect(has(c, [Left, Center])).toBe(true);
  });

  it("track with no connectable neighbours is empty", () => {
    expect(deriveConnections({ paint: "track" }, {}).connections).toEqual([]);
  });
});
