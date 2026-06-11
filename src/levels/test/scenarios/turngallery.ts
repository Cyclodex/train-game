import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, nWayLanes } from "@/tiles/lanes";

// The cross-width turn GALLERY: every same-width and mixed-width cross side by
// side on one map, so a turn that bends wrong anywhere is visible here first.
// Reported map (2026-06-11): equal-arm crosses turned nicely, but a turn between
// arms of DIFFERENT widths bent strangely. This is that board (the 2L×2L cross
// shifted one tile west so its west arm is fed by the 2-lane curve and the
// 3-lane road's west end stops in grass — a valid open road end):
//
//   (1,1) 1L×1L cross   (3,1) 2L×1L cross   (5,1) 3L×1L cross
//   (2,4) 2L×2L cross   (5,3) 3L×3L cross   (5,4) 3L→2L-spur T
//
// plus a 1L→2L straight widening (1,2→1,3), a 2-lane curve feeding a junction
// (1,4→2,4), and a junction-abutting-junction seam (5,3↔5,4). Right-hand
// traffic: a right turn leaves from the kerb lane, a left turn from the inner.
const T = Position.Top;
const R = Position.Right;
const B = Position.Bottom;
const L = Position.Left;

type Cell = { connections: []; road: Lane[] };

const ns = (n: number): Cell => ({ connections: [], road: nWayLanes(T, B, n) });
const ew = (n: number): Cell => ({ connections: [], road: nWayLanes(L, R, n) });

// n straight+turn lanes per approach: `to` lists the straight exit then the turn.
const fan = (from: Position, to: Position[], n: number): Lane[] =>
  Array.from({ length: n }, (_, index) => ({ from, to: [...to], index }));

export const turngallery: TestScenario = {
  id: "turngallery",
  name: "Turns: cross-width gallery (1/2/3-lane arms mixed)",
  description:
    "Every cross width side by side — 1L×1L, 2L×1L, 3L×1L, 2L×2L, 3L×3L and a " +
    "3L road with a 2L spur — so a turn that bends wrong between unequal arms " +
    "is visible in isolation. Enable Debug for the per-lane driving lines.",
  level: {
    // -- row 1: the three crosses over a 1L E-W street ------------------------
    "0,1": ew(1),
    "2,1": ew(1),
    "4,1": ew(1),
    "6,1": ew(1),
    // 1L×1L control: every arm 1 lane (E/W arms turn right, N/S arms turn left).
    "1,0": ns(1),
    "1,2": ns(1),
    "1,1": {
      connections: [],
      road: [
        ...fan(L, [R, B], 1),
        ...fan(R, [L, T], 1),
        ...fan(T, [B, R], 1),
        ...fan(B, [T, L], 1),
      ],
    },
    // 2L×1L: the N-S road is 2 lanes (right turns), the E-W street 1 (left turns).
    "3,0": ns(2),
    "3,2": ns(2),
    "3,1": {
      connections: [],
      road: [
        ...fan(L, [R, T], 1),
        ...fan(R, [L, B], 1),
        ...fan(T, [B, L], 2),
        ...fan(B, [T, R], 2),
      ],
    },
    // 3L×1L: the N-S road is 3 lanes (right turns), the E-W street 1 (left turns).
    "5,0": ns(3),
    "5,2": ns(3),
    "5,1": {
      connections: [],
      road: [
        ...fan(L, [R, T], 1),
        ...fan(R, [L, B], 1),
        ...fan(T, [B, L], 3),
        ...fan(B, [T, R], 3),
      ],
    },
    // -- the 1L→2L widening + 2-lane curve feeding the 2L×2L cross ------------
    "1,3": ns(2),
    "1,4": { connections: [], road: nWayLanes(T, R, 2) },
    "2,3": ns(2),
    "2,5": ns(2),
    "3,4": ew(2),
    "4,4": ew(2),
    "2,4": {
      connections: [],
      road: [
        ...fan(T, [B, R], 2),
        ...fan(B, [T, L], 2),
        ...fan(L, [R, B], 2),
        ...fan(R, [L, T], 2),
      ],
    },
    // -- the 3L×3L cross and the 3L→2L-spur T (junction-abutting-junction) ----
    "4,3": ew(3),
    "6,3": ew(3),
    "5,3": {
      connections: [],
      road: [
        ...fan(T, [B, L], 3),
        ...fan(B, [T, R], 3),
        ...fan(L, [R, T], 3),
        ...fan(R, [L, B], 3),
      ],
    },
    "5,5": ns(3),
    "5,4": {
      connections: [],
      road: [
        ...fan(T, [B], 3),
        ...fan(B, [T, L], 3),
        ...fan(L, [B], 2),
      ],
    },
  },
  trains: {},
  size: { cols: 7, rows: 6 },
  traffic: { mix: { car: 1 }, spawnInterval: 0.7, maxCars: 18 },
};
