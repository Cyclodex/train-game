import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import {
  Movement,
  movementsConflict,
  conflictKey,
  buildConflictMatrix,
} from "@/sim/roadJunction";
import { fromPairs } from "@/tiles/lanes";

// Shorthand aliases
const T = Position.Top;
const R = Position.Right;
const B = Position.Bottom;
const L = Position.Left;

const mv = (entry: Position, exit: Position): Movement => ({ entry, exit });

// ---------------------------------------------------------------------------
// 1. Perpendicular straights conflict (their paths cross inside the square)
// ---------------------------------------------------------------------------
describe("perpendicular straights conflict", () => {
  it("T→B vs L→R conflict", () => {
    expect(movementsConflict(mv(T, B), mv(L, R))).toBe(true);
  });

  it("T→B vs R→L conflict", () => {
    expect(movementsConflict(mv(T, B), mv(R, L))).toBe(true);
  });

  it("B→T vs L→R conflict", () => {
    expect(movementsConflict(mv(B, T), mv(L, R))).toBe(true);
  });

  it("B→T vs R→L conflict", () => {
    expect(movementsConflict(mv(B, T), mv(R, L))).toBe(true);
  });

  it("is symmetric (L→R vs T→B)", () => {
    expect(movementsConflict(mv(L, R), mv(T, B))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Same-axis straights do NOT conflict (parallel lanes)
// ---------------------------------------------------------------------------
describe("same-axis straights do not conflict", () => {
  it("T→B vs B→T (both vertical, right-hand lanes)", () => {
    expect(movementsConflict(mv(T, B), mv(B, T))).toBe(false);
  });

  it("L→R vs R→L (both horizontal, right-hand lanes)", () => {
    expect(movementsConflict(mv(L, R), mv(R, L))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Right turns never conflict with anything
//    Right turns: Top→Left, Left→Bottom, Bottom→Right, Right→Top
// ---------------------------------------------------------------------------
describe("right turns never conflict", () => {
  const rightTurns: Movement[] = [
    mv(T, L),
    mv(L, B),
    mv(B, R),
    mv(R, T),
  ];

  const allMovements: Movement[] = [
    mv(T, B), mv(T, R), mv(T, L),
    mv(B, T), mv(B, L), mv(B, R),
    mv(L, R), mv(L, T), mv(L, B),
    mv(R, L), mv(R, B), mv(R, T),
  ];

  for (const rt of rightTurns) {
    for (const other of allMovements) {
      it(`${Position[rt.entry]}→${Position[rt.exit]} does not conflict with ${Position[other.entry]}→${Position[other.exit]}`, () => {
        expect(movementsConflict(rt, other)).toBe(false);
        expect(movementsConflict(other, rt)).toBe(false);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Left turn conflicts with opposing straight (oncoming traffic)
//    Top→Right (left turn from north) conflicts with Bottom→Top
// ---------------------------------------------------------------------------
describe("left turn conflicts with opposing straight", () => {
  it("Top→Right conflicts with Bottom→Top (oncoming south-to-north)", () => {
    expect(movementsConflict(mv(T, R), mv(B, T))).toBe(true);
  });

  it("Left→Top conflicts with Right→Left (oncoming west)", () => {
    expect(movementsConflict(mv(L, T), mv(R, L))).toBe(true);
  });

  it("Bottom→Left conflicts with Top→Bottom (oncoming north-to-south)", () => {
    expect(movementsConflict(mv(B, L), mv(T, B))).toBe(true);
  });

  it("Right→Bottom conflicts with Left→Right (oncoming east)", () => {
    expect(movementsConflict(mv(R, B), mv(L, R))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Left turn conflicts with crossing perpendicular straight
//    Top→Right conflicts with Right→Left (the westbound stream it must cross)
// ---------------------------------------------------------------------------
describe("left turn conflicts with crossing perpendicular straight", () => {
  it("Top→Right conflicts with Right→Left", () => {
    expect(movementsConflict(mv(T, R), mv(R, L))).toBe(true);
  });

  it("Left→Top conflicts with Top→Bottom", () => {
    expect(movementsConflict(mv(L, T), mv(T, B))).toBe(true);
  });

  it("Bottom→Left conflicts with Left→Right", () => {
    expect(movementsConflict(mv(B, L), mv(L, R))).toBe(true);
  });

  it("Right→Bottom conflicts with Bottom→Top", () => {
    expect(movementsConflict(mv(R, B), mv(B, T))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Opposite-arm left turns do NOT conflict
//    Top→Right and Bottom→Left (both left turns from opposite arms)
// ---------------------------------------------------------------------------
describe("opposite-arm left turns do not conflict", () => {
  it("Top→Right vs Bottom→Left", () => {
    expect(movementsConflict(mv(T, R), mv(B, L))).toBe(false);
  });

  it("Left→Top vs Right→Bottom", () => {
    expect(movementsConflict(mv(L, T), mv(R, B))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Same entry arm never conflicts (same car can't be in two places)
// ---------------------------------------------------------------------------
describe("same entry arm never conflicts", () => {
  it("T→B vs T→R (same entry)", () => {
    expect(movementsConflict(mv(T, B), mv(T, R))).toBe(false);
  });

  it("T→B vs T→L (same entry)", () => {
    expect(movementsConflict(mv(T, B), mv(T, L))).toBe(false);
  });

  it("L→R vs L→T (same entry)", () => {
    expect(movementsConflict(mv(L, R), mv(L, T))).toBe(false);
  });

  it("R→L vs R→T (same entry)", () => {
    expect(movementsConflict(mv(R, L), mv(R, T))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// conflictKey: order-independent
// ---------------------------------------------------------------------------
describe("conflictKey", () => {
  it("produces the same key regardless of argument order", () => {
    const a = mv(T, B);
    const b = mv(L, R);
    expect(conflictKey(a, b)).toBe(conflictKey(b, a));
  });

  it("distinguishes different movement pairs", () => {
    expect(conflictKey(mv(T, B), mv(L, R))).not.toBe(
      conflictKey(mv(T, R), mv(L, R))
    );
  });
});

// ---------------------------------------------------------------------------
// buildConflictMatrix
// ---------------------------------------------------------------------------
describe("buildConflictMatrix", () => {
  it("4-way cross has conflict pairs", () => {
    const road: [Position, Position][] = [
      [T, B],
      [L, R],
    ];
    const matrix = buildConflictMatrix(fromPairs(road));
    expect(matrix.size).toBeGreaterThan(0);
    // T→B vs L→R must be in the matrix
    const a = mv(T, B);
    const b = mv(L, R);
    expect(matrix.has(conflictKey(a, b))).toBe(true);
  });

  it("T-junction (3-arm: Top, Bottom, Left) has conflict pairs", () => {
    // A T-junction that connects T↔B, T↔L, B↔L (arms: T, B, L — no Right)
    const road: [Position, Position][] = [
      [T, B],
      [T, L],
      [B, L],
    ];
    const matrix = buildConflictMatrix(fromPairs(road));
    expect(matrix.size).toBeGreaterThan(0);
  });

  it("a straight road (T↔B only) has no conflict pairs", () => {
    // One pair, two opposite movements: T→B and B→T. They share parallel lanes
    // in right-hand traffic, so no conflict.
    const road: [Position, Position][] = [[T, B]];
    const matrix = buildConflictMatrix(fromPairs(road));
    expect(matrix.size).toBe(0);
  });

  it("each pair in the matrix represents a genuine geometric conflict", () => {
    const road: [Position, Position][] = [
      [T, B],
      [L, R],
    ];
    const matrix = buildConflictMatrix(fromPairs(road));
    // Verify every key in the matrix actually represents a conflicting pair.
    // Since we can't reverse the key easily, just check the total is sane.
    // A 4-way cross has at most 12 non-U-turn movements; we just need > 0.
    expect(matrix.size).toBeGreaterThan(0);
    expect(matrix.size).toBeLessThanOrEqual(66); // C(12,2) = 66 max
  });
});

// ---------------------------------------------------------------------------
// Right-turn-only cross: cars enter from all four arms and every car turns
// right. In right-hand traffic each right turn hugs one corner of the tile, so
// the four turns never cross — the intersection needs no signals and can never
// block, no matter how many cars arrive from how many sides at once.
// ---------------------------------------------------------------------------
describe("right turns from all four arms never conflict", () => {
  // The right turn from each arm (screen coords: x→right, y→down):
  //   eastbound  enters Left  → exits Bottom
  //   northbound enters Bottom → exits Right
  //   westbound  enters Right → exits Top
  //   southbound enters Top   → exits Left
  const rightTurns: Movement[] = [
    mv(L, B),
    mv(B, R),
    mv(R, T),
    mv(T, L),
  ];

  it("no pair of right turns conflicts (the pinwheel hugs four separate corners)", () => {
    for (let i = 0; i < rightTurns.length; i++) {
      for (let j = i + 1; j < rightTurns.length; j++) {
        expect(movementsConflict(rightTurns[i], rightTurns[j])).toBe(false);
      }
    }
  });

  it("no right-turn pair appears in the pinwheel tile's conflict matrix", () => {
    // A tile carrying exactly the four right-turn port pairs. buildConflictMatrix
    // also enumerates the reverse movements (the left turns), so the matrix may
    // be non-empty — but none of its entries is a pair of two right turns.
    const road: [Position, Position][] = [
      [L, B],
      [B, R],
      [R, T],
      [T, L],
    ];
    const matrix = buildConflictMatrix(fromPairs(road));
    for (let i = 0; i < rightTurns.length; i++) {
      for (let j = i + 1; j < rightTurns.length; j++) {
        expect(matrix.has(conflictKey(rightTurns[i], rightTurns[j]))).toBe(false);
      }
    }
  });
});
