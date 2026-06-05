import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { samePair } from "@/tiles/model";
import {
  emptyCell,
  toggleConnection,
  removeConnection,
  setDepot,
  rotateDepot,
  depotFacing,
  toggleSignalPort,
} from "@/tiles/editOps";

const { Top, Right, Bottom, Left, Center } = Position;
const has = (cell: { connections: [Position, Position][] }, p: [Position, Position]) =>
  cell.connections.some(c => samePair(c, p));

describe("toggleConnection", () => {
  it("adds when absent and removes when present, order-independent", () => {
    let c = emptyCell();
    c = toggleConnection(c, Top, Bottom);
    expect(has(c, [Top, Bottom])).toBe(true);
    // Toggling the reversed pair removes it.
    c = toggleConnection(c, Bottom, Top);
    expect(has(c, [Top, Bottom])).toBe(false);
  });

  it("accumulates distinct connections into a junction", () => {
    let c = emptyCell();
    c = toggleConnection(c, Left, Right);
    c = toggleConnection(c, Left, Top);
    c = toggleConnection(c, Right, Top);
    expect(c.connections).toHaveLength(3);
  });

  it("does not mutate the input cell", () => {
    const c = emptyCell();
    toggleConnection(c, Top, Bottom);
    expect(c.connections).toHaveLength(0);
  });
});

describe("removeConnection", () => {
  it("removes a specific pair regardless of order", () => {
    let c = emptyCell();
    c = toggleConnection(c, Top, Right);
    c = removeConnection(c, Right, Top);
    expect(c.connections).toHaveLength(0);
  });
});

describe("depot ops", () => {
  it("setDepot makes a border<->Center depot with role", () => {
    const c = setDepot(emptyCell(), Right);
    expect(has(c, [Right, Center])).toBe(true);
    expect(c.role).toBe("depot");
    expect(depotFacing(c)).toBe(Right);
  });

  it("rotateDepot cycles facing N->E->S->W", () => {
    let c = setDepot(emptyCell(), Top);
    c = rotateDepot(c);
    expect(depotFacing(c)).toBe(Right);
    c = rotateDepot(c);
    expect(depotFacing(c)).toBe(Bottom);
  });

  it("depotFacing is null for non-depot cells", () => {
    expect(depotFacing(emptyCell())).toBeNull();
  });
});

describe("toggleSignalPort", () => {
  it("adds then removes a port", () => {
    let c = emptyCell();
    c = toggleSignalPort(c, Right);
    expect(c.signals).toEqual([Right]);
    c = toggleSignalPort(c, Right);
    expect(c.signals).toEqual([]);
  });
});
