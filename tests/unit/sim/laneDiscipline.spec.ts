import { describe, it, expect } from "vitest";
import { createRoadSim } from "@/sim/road";
import { Level, Port } from "@/tiles/model";
import { Lane } from "@/tiles/lanes";
import { Position } from "@/types";

const T = Position.Top;
const B = Position.Bottom;
const L = Position.Left;
const R = Position.Right;

// One-way road from `from` toward `to` with `n` lanes (indices 0..n-1).
function oneWayN(from: Port, to: Port, n: number): Lane[] {
  return Array.from({ length: n }, (_, i) => ({ from, to: [to], index: i }));
}

// An UNRESTRICTED all-turns cross: every one of the `n` southbound-approach lanes
// may go straight (T), left (L) or right (R). No dedicated turn lane — so lane
// choice is governed purely by turn-direction discipline, not per-lane restriction.
function crossCentre(n: number): Lane[] {
  return Array.from({ length: n }, (_, i) => ({ from: B, to: [T, L, R], index: i }));
}

// A single 3-lane one-way road climbing north into an all-turns crossroads at
// (1,2). Lanes 0..2 (0 = kerb / right, 2 = inner / left). Cars fan out straight
// (north), left (west) or right (east).
function threeLaneCross(): Level {
  return {
    "1,5": { connections: [], road: oneWayN(B, T, 3) }, // spawn (bottom edge)
    "1,4": { connections: [], road: oneWayN(B, T, 3) },
    "1,3": { connections: [], road: oneWayN(B, T, 3) }, // 3-lane approach
    "1,2": { connections: [], road: crossCentre(3) }, // the cross
    "1,1": { connections: [], road: oneWayN(B, T, 3) }, // north (straight) exit
    "1,0": { connections: [], road: oneWayN(B, T, 3) },
    "0,2": { connections: [], road: oneWayN(R, L, 3) }, // west (left) exit
    "2,2": { connections: [], road: oneWayN(L, R, 3) }, // east (right) exit
  };
}

describe("createRoadSim — turn-aware lane discipline on an unrestricted cross", () => {
  it("puts left-turners on the inner lane, right/straight on the kerb lane", () => {
    // Low density (one car sorting at a time) so every car has clear gaps to reach
    // its lane — the test asserts the discipline, not gap-acceptance under load.
    const sim = createRoadSim({
      level: threeLaneCross(),
      width: 3,
      height: 6,
      seed: 5,
      spawnInterval: 2,
      carSpeed: 0.4,
      carLength: 0.2,
      maxCars: 3,
    });

    // Record, once per car, the lane it occupies the moment its head first reaches
    // the junction (when it commits its turn).
    const committed = new Set<string>();
    let left = 0;
    let right = 0;
    let straight = 0;
    let leftNotInner = 0;
    let rightNotKerb = 0;
    let straightNotKerb = 0;

    for (let i = 0; i < 4000; i++) {
      sim.step(0.05, () => false);
      for (const c of sim.sample()) {
        const f = c.units[0].front;
        if (f.coord.x !== 1 || f.coord.y !== 2 || f.entryPort !== B) continue;
        if (committed.has(c.id)) continue;
        committed.add(c.id);
        const lane = Math.round(c.laneIndex);
        if (f.exitPort === L) {
          left++;
          if (lane !== 2) leftNotInner++; // left turn must come from the inner lane
        } else if (f.exitPort === R) {
          right++;
          if (lane !== 0) rightNotKerb++; // right turn must come from the kerb lane
        } else if (f.exitPort === T) {
          straight++;
          if (lane !== 0) straightNotKerb++; // keep-right: straight runs on the kerb
        }
      }
    }

    // The scenario actually exercised all three movements.
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(straight).toBeGreaterThan(0);

    // And every car committed its turn from the discipline-correct lane.
    expect(leftNotInner).toBe(0);
    expect(rightNotKerb).toBe(0);
    expect(straightNotKerb).toBe(0);
  });
});
