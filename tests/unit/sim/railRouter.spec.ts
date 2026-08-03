import { describe, it, expect } from "vitest";
import { planRailRoute, stationTilesOf } from "@/sim/railRouter";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";

// depot — straight — station — straight — station — straight — depot
function line(): Level {
  return {
    "0,0": expandKind("depot", 1),
    "1,0": expandKind("straight", 1),
    "2,0": expandKind("station", 1),
    "3,0": expandKind("straight", 1),
    "4,0": expandKind("station", 1),
    "5,0": expandKind("straight", 1),
    "6,0": expandKind("depot", 3),
  };
}

describe("planRailRoute", () => {
  it("routes out of a depot to the nearest station", () => {
    const plan = planRailRoute(
      line(),
      { coord: { x: 0, y: 0 }, entryPort: Position.Center },
      ["2,0", "4,0"]
    );
    expect(plan?.goal).toBe("2,0");
    expect(plan?.steps.map(s => s.tileId)).toEqual(["0,0", "1,0"]);
  });

  it("picks the nearer of several goals, not the first listed", () => {
    const plan = planRailRoute(
      line(),
      { coord: { x: 5, y: 0 }, entryPort: Position.Right },
      ["2,0", "4,0"]
    );
    expect(plan?.goal).toBe("4,0");
  });

  it("gives an exit lookup the sim can consult per tile boundary", () => {
    const plan = planRailRoute(
      line(),
      { coord: { x: 0, y: 0 }, entryPort: Position.Center },
      ["4,0"]
    );
    // Leaving the depot heads Right, and every straight continues Right.
    expect(plan?.exitAt.get(`0,0:${Position.Center}`)).toBe(Position.Right);
    expect(plan?.exitAt.get(`1,0:${Position.Left}`)).toBe(Position.Right);
    expect(plan?.exitAt.get(`3,0:${Position.Left}`)).toBe(Position.Right);
    // The goal tile itself carries no exit — the plan ends there.
    expect(plan?.exitAt.has(`4,0:${Position.Left}`)).toBe(false);
  });

  it("returns null when nothing is reachable, and when no goal is given", () => {
    const severed: Level = {
      "0,0": expandKind("depot", 1),
      "1,0": expandKind("straight", 1),
      // gap at 2,0
      "3,0": expandKind("station", 1),
    };
    expect(
      planRailRoute(
        severed,
        { coord: { x: 0, y: 0 }, entryPort: Position.Center },
        ["3,0"]
      )
    ).toBeNull();
    expect(
      planRailRoute(line(), { coord: { x: 0, y: 0 }, entryPort: Position.Center }, [])
    ).toBeNull();
  });

  it("routes through a junction, choosing the arm that reaches the goal", () => {
    // A T: the trunk runs Left-Right along y=1 with a branch up to a station.
    //        2,0  station
    //  0,1 — 1,1(T) — 2,1 … depot at 3,1
    const level: Level = {
      "2,0": { ...expandKind("station", 0), connections: [[Position.Bottom, Position.Top]] },
      "2,1": {
        connections: [
          [Position.Left, Position.Right],
          [Position.Left, Position.Top],
          [Position.Right, Position.Top],
        ],
      },
      "1,1": expandKind("straight", 1),
      "0,1": expandKind("depot", 1),
      "3,1": expandKind("depot", 3),
    };
    const plan = planRailRoute(
      level,
      { coord: { x: 0, y: 1 }, entryPort: Position.Center },
      ["2,0"]
    );
    expect(plan?.goal).toBe("2,0");
    // At the junction, entered from the left, the route takes the Top arm.
    expect(plan?.exitAt.get(`2,1:${Position.Left}`)).toBe(Position.Top);
  });

  it("finds its way round a ring, and every step is a real connection", () => {
    // A 3x3 ring of curves and straights with a station on the top edge.
    const level: Level = {
      "0,0": expandKind("curve", 1), // Right+Bottom
      "1,0": { ...expandKind("station", 1) }, // Left-Right
      "2,0": expandKind("curve", 2), // Bottom+Left
      "0,1": expandKind("straight", 0), // Top-Bottom
      "2,1": expandKind("straight", 0),
      "0,2": expandKind("curve", 0), // Top+Right
      "1,2": expandKind("straight", 1), // Left-Right
      "2,2": expandKind("curve", 3), // Left+Top
    };
    const plan = planRailRoute(
      level,
      { coord: { x: 1, y: 2 }, entryPort: Position.Left },
      ["1,0"]
    );
    expect(plan).not.toBeNull();
    expect(plan!.goal).toBe("1,0");
    for (const step of plan!.steps) {
      const cell = level[step.tileId];
      const joined = cell.connections.some(
        ([a, b]) =>
          (a === step.entryPort && b === step.exitPort) ||
          (b === step.entryPort && a === step.exitPort)
      );
      expect(joined, `${step.tileId} ${step.entryPort}->${step.exitPort}`).toBe(true);
    }
  });
});

describe("stationTilesOf", () => {
  it("lists every station on the board, in a stable order", () => {
    expect(stationTilesOf(line())).toEqual(["2,0", "4,0"]);
    expect(stationTilesOf({})).toEqual([]);
  });
});
