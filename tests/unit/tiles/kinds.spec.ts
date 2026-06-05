import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { samePair } from "@/tiles/model";

const { Top, Right, Bottom, Left, Center } = Position;

const hasPair = (
  cell: { connections: [Position, Position][] },
  p: [Position, Position]
) => cell.connections.some(c => samePair(c, p));

describe("expandKind", () => {
  it("straight rot 0 connects Top-Bottom; rot 1 connects Right-Left", () => {
    expect(hasPair(expandKind("straight", 0), [Top, Bottom])).toBe(true);
    expect(hasPair(expandKind("straight", 1), [Right, Left])).toBe(true);
  });

  it("curve rot 0 connects Top-Right; rot 1 connects Right-Bottom", () => {
    expect(hasPair(expandKind("curve", 0), [Top, Right])).toBe(true);
    expect(hasPair(expandKind("curve", 1), [Right, Bottom])).toBe(true);
  });

  it("depot rot 0 connects Top-Center and sets role", () => {
    const d = expandKind("depot", 0);
    expect(hasPair(d, [Top, Center])).toBe(true);
    expect(d.role).toBe("depot");
  });

  it("cross has all six distinct-edge pairs", () => {
    expect(expandKind("cross", 0).connections).toHaveLength(6);
  });

  it("signals:true puts a signal on both (non-Center) exit ports", () => {
    const c = expandKind("straight", 1, { signals: true });
    expect(c.signals?.slice().sort()).toEqual([Right, Left].sort());
  });

  it("signals accepts an explicit port list", () => {
    expect(expandKind("straight", 0, { signals: [Top] }).signals).toEqual([Top]);
  });

  it("disable removes the named pairs from a cross", () => {
    const c = expandKind("cross", 0, { disable: [[Top, Right], [Top, Left]] });
    expect(hasPair(c, [Top, Right])).toBe(false);
    expect(hasPair(c, [Top, Bottom])).toBe(true);
  });
});
