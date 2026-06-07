import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { fromPairs } from "@/tiles/lanes";
import { planRoute, RouteTurn } from "@/sim/roadRouter";
import { roadEntries } from "@/sim/road";
import { makeRng } from "@/utils/globalHelpers";

// --- Level builders ----------------------------------------------------------

// 5-tile straight road along y=0: entries at (0,0)/Left and (4,0)/Right.
// Width=5, Height=1.
function straight5(): Level {
  const road: [Position, Position] = [Position.Left, Position.Right];
  return {
    "0,0": { connections: [], road: fromPairs([road]) },
    "1,0": { connections: [], road: fromPairs([road]) },
    "2,0": { connections: [], road: fromPairs([road]) },
    "3,0": { connections: [], road: fromPairs([road]) },
    "4,0": { connections: [], road: fromPairs([road]) },
  };
}

// 5×5 grid with a true 4-way routing junction at (2,2):
// a car entering from any arm can exit via any of the other three arms.
// Horizontal road along y=2: tiles 0,2 through 4,2.
// Vertical road along x=2: tiles 2,0 through 2,4.
// Junction tile 2,2 carries all 6 crossing pairs (full 4-way intersection).
// Entries: (0,2)/Left, (4,2)/Right, (2,0)/Top, (2,4)/Bottom.
// Width=5, Height=5.
function cross5(): Level {
  const h: [Position, Position] = [Position.Left, Position.Right];
  const v: [Position, Position] = [Position.Top, Position.Bottom];
  // Full 4-way junction: every arm can reach every other arm.
  const LT: [Position, Position] = [Position.Left, Position.Top];
  const LB: [Position, Position] = [Position.Left, Position.Bottom];
  const RT: [Position, Position] = [Position.Right, Position.Top];
  const RB: [Position, Position] = [Position.Right, Position.Bottom];
  return {
    // Horizontal arm (non-junction)
    "0,2": { connections: [], road: fromPairs([h]) },
    "1,2": { connections: [], road: fromPairs([h]) },
    "3,2": { connections: [], road: fromPairs([h]) },
    "4,2": { connections: [], road: fromPairs([h]) },
    // Vertical arm (non-junction)
    "2,0": { connections: [], road: fromPairs([v]) },
    "2,1": { connections: [], road: fromPairs([v]) },
    "2,3": { connections: [], road: fromPairs([v]) },
    "2,4": { connections: [], road: fromPairs([v]) },
    // The full 4-way junction tile: all 6 inter-arm pairs
    "2,2": { connections: [], road: fromPairs([h, v, LT, LB, RT, RB]) },
  };
}

// --- Tests -------------------------------------------------------------------

describe("planRoute", () => {
  it("returns empty plan on a straight road (no junctions)", () => {
    const level = straight5();
    const entries = roadEntries(level, 5, 1);
    // Spawn from the Left entry at (0,0)
    const spawn = entries.find(
      e => e.coord.x === 0 && e.coord.y === 0 && e.entryPort === Position.Left,
    )!;
    expect(spawn).toBeDefined();

    const rng = makeRng(1);
    const plan = planRoute(level, spawn.coord, spawn.entryPort, entries, rng);
    // A straight road has no junctions, so the plan has zero turns.
    expect(plan.turns).toEqual([]);
    // Destination is the opposite end of the road.
    expect(plan.destination).not.toBeNull();
  });

  it("produces exactly one junction turn for a 4-way cross", () => {
    const level = cross5();
    const entries = roadEntries(level, 5, 5);
    // Spawn from the west: (0,2)/Left
    const spawn = entries.find(
      e => e.coord.x === 0 && e.coord.y === 2 && e.entryPort === Position.Left,
    )!;
    expect(spawn).toBeDefined();

    const rng = makeRng(42);
    const plan = planRoute(level, spawn.coord, spawn.entryPort, entries, rng);

    // Exactly one turn (at the junction 2,2)
    expect(plan.turns).toHaveLength(1);
    const turn = plan.turns[0] as RouteTurn;
    expect(turn.junctionId).toBe("2,2");
    // Exit arm is not Left (can't go back the way we came)
    expect(turn.exitArm).not.toBe(Position.Left);
    // Must be one of the valid exits from the junction
    expect([Position.Right, Position.Top, Position.Bottom]).toContain(turn.exitArm);
    // Destination should be set
    expect(plan.destination).not.toBeNull();
  });

  it("is deterministic for a fixed rng", () => {
    const level = cross5();
    const entries = roadEntries(level, 5, 5);
    const spawn = entries.find(
      e => e.coord.x === 0 && e.coord.y === 2 && e.entryPort === Position.Left,
    )!;

    const run = () => {
      const rng = makeRng(7);
      return planRoute(level, spawn.coord, spawn.entryPort, entries, rng);
    };

    expect(run()).toEqual(run());
  });

  it("returns empty plan when allEntries is empty", () => {
    const level = cross5();
    const spawn = { x: 0, y: 2 };
    const rng = makeRng(1);
    const plan = planRoute(level, spawn, Position.Left, [], rng);
    expect(plan.turns).toEqual([]);
    expect(plan.destination).toBeNull();
  });

  it("returns empty plan when only the spawn entry is in allEntries", () => {
    const level = straight5();
    const entries = roadEntries(level, 5, 1);
    // Keep only the Left entry at (0,0) — the spawn entry itself
    const spawn = entries.find(
      e => e.coord.x === 0 && e.coord.y === 0 && e.entryPort === Position.Left,
    )!;
    expect(spawn).toBeDefined();

    const rng = makeRng(1);
    // allEntries contains only the spawn itself; targets list will be empty
    const plan = planRoute(level, spawn.coord, spawn.entryPort, [spawn], rng);
    expect(plan.turns).toEqual([]);
    expect(plan.destination).toBeNull();
  });
});
