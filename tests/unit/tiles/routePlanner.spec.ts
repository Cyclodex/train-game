import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { samePair, PortPair } from "@/tiles/model";
import { planRoute, RouteStep } from "@/tiles/routePlanner";

const { Top, Right, Bottom, Left } = Position;

const opts = (
  over: Partial<{ width: number; height: number; passable: (c: { x: number; y: number }) => boolean }> = {}
) => ({ width: 5, height: 5, ...over });

const stepFor = (steps: RouteStep[], id: string) => steps.find(s => s.id === id);
const hasConn = (s: RouteStep | undefined, p: PortPair) => !!s && samePair([s.a, s.b], p);

// The router returns the cells from the first step through the destination,
// EXCLUDING the anchor (`from`) tile — the editor lays the start tile itself.

describe("planRoute — degenerate (same tile)", () => {
  it("returns a single intra-tile connection between the two edges", () => {
    const r = planRoute({ id: "1,1", edge: Top }, { id: "1,1", edge: Right }, opts());
    expect(r).not.toBeNull();
    expect(r).toHaveLength(1);
    expect(hasConn(r![0], [Top, Right])).toBe(true);
  });

  it("returns null when both edges are the same", () => {
    expect(planRoute({ id: "1,1", edge: Top }, { id: "1,1", edge: Top }, opts())).toBeNull();
  });
});

describe("planRoute — straight run", () => {
  it("lays a straight down a column, excluding the anchor", () => {
    const r = planRoute({ id: "1,0", edge: Bottom }, { id: "1,2", edge: Bottom }, opts());
    expect(r).not.toBeNull();
    expect(r!.map(s => s.id).sort()).toEqual(["1,1", "1,2"]);
    expect(hasConn(stepFor(r!, "1,1"), [Top, Bottom])).toBe(true);
    expect(hasConn(stepFor(r!, "1,2"), [Top, Bottom])).toBe(true);
  });

  it("handles an adjacent destination (single emitted cell)", () => {
    const r = planRoute({ id: "1,0", edge: Bottom }, { id: "1,1", edge: Bottom }, opts());
    expect(r).not.toBeNull();
    expect(r).toHaveLength(1);
    expect(hasConn(stepFor(r!, "1,1"), [Top, Bottom])).toBe(true);
  });
});

describe("planRoute — L shape", () => {
  it("bends with a curve where the path turns", () => {
    const r = planRoute({ id: "0,0", edge: Bottom }, { id: "1,1", edge: Right }, opts());
    expect(r).not.toBeNull();
    expect(r!.map(s => s.id)).not.toContain("0,0"); // anchor excluded
    expect(hasConn(stepFor(r!, "0,1"), [Top, Right])).toBe(true); // the corner curve
    expect(hasConn(stepFor(r!, "1,1"), [Left, Right])).toBe(true);
  });
});

describe("planRoute — turn minimisation", () => {
  it("prefers the path with fewer turns among equal-length routes", () => {
    const r = planRoute({ id: "0,0", edge: Right }, { id: "2,2", edge: Bottom }, opts());
    expect(r).not.toBeNull();
    const ids = r!.map(s => s.id);
    // right along row 0 then down column 2: a single corner at (2,0)
    expect(ids).toContain("1,0");
    expect(ids).toContain("2,0");
    expect(hasConn(stepFor(r!, "2,0"), [Left, Bottom])).toBe(true);
    expect(ids).not.toContain("1,1"); // the 3-turn alternative
  });
});

describe("planRoute — bounds", () => {
  it("returns null when the start edge leaves the grid", () => {
    expect(planRoute({ id: "0,0", edge: Top }, { id: "0,2", edge: Bottom }, opts())).toBeNull();
  });

  it("allows the destination's continue-edge to sit on the grid border", () => {
    const r = planRoute({ id: "0,0", edge: Bottom }, { id: "0,4", edge: Bottom }, opts({ height: 5 }));
    expect(r).not.toBeNull();
    expect(r!.map(s => s.id)).toEqual(["0,1", "0,2", "0,3", "0,4"]);
  });
});

describe("planRoute — passable (future blocks)", () => {
  it("routes around a blocked cell", () => {
    const blocked = "2,0";
    const r = planRoute(
      { id: "0,0", edge: Right },
      { id: "4,0", edge: Right },
      opts({ passable: c => `${c.x},${c.y}` !== blocked })
    );
    expect(r).not.toBeNull();
    expect(r!.map(s => s.id)).not.toContain(blocked);
  });

  it("returns null when the destination is walled off", () => {
    const wall = new Set(["2,1", "1,2", "3,2", "2,3"]); // box in (2,2)
    const r = planRoute(
      { id: "0,0", edge: Right },
      { id: "2,2", edge: Bottom },
      opts({ passable: c => !wall.has(`${c.x},${c.y}`) })
    );
    expect(r).toBeNull();
  });
});
