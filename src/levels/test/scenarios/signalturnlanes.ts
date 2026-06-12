import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, type LaneKind, turns } from "@/tiles/lanes";
import { type Level, type TileCell } from "@/tiles/model";

// Signalised crossroads with DEDICATED, SORTED lanes per arm — the showcase for
// the junction-signal rendering: a white stop line across each approach, ONE
// signal head per incoming lane on a dark gantry bar (the kerb head is a BUS
// head, lit by the transit aspect), and white per-lane direction arrows painted
// on the approach tiles (↰ ↑ ↱) because the lanes are sorted by turn.
//
// Every arm is a 4-lane two-way road: a kerb BUS lane (index 0) + three car
// lanes (1 right, 2 straight, 3 left). Cars sort into the lane that permits
// their turn before the junction; the signal runs two-phase with bus priority so
// the kerb bus head gets its head start. Right-hand traffic turn table:
//   From L (→E): right = B, left = T, straight = R
//   From R (→W): right = T, left = B, straight = L
//   From T (→S): right = L, left = R, straight = B
//   From B (→N): right = R, left = L, straight = T
const L = Position.Left;
const R = Position.Right;
const T = Position.Top;
const B = Position.Bottom;
const BUS: LaneKind = "bus";

// A 4-lane two-way arm: kerb bus lane + 3 car lanes per direction. The lanes
// simply continue into/out of the junction; the per-lane turn SORTING is forced
// by the junction centre below (and surfaced by the approach direction arrows).
function arm(a: Position, b: Position): TileCell {
  const dir = (from: Position, to: Position): Lane[] => [
    { from, to: [to], index: 0, kind: BUS },
    { from, to: [to], index: 1 },
    { from, to: [to], index: 2 },
    { from, to: [to], index: 3 },
  ];
  return { connections: [], road: [...dir(a, b), ...dir(b, a)] };
}

// The signalised centre: per approach, the kerb BUS lane (index 0) goes straight
// + turns right (kerb-to-kerb), and the three car lanes are sorted
// right / straight / left (indices 1 / 2 / 3).
function center(): TileCell {
  const approach = (
    from: Position,
    right: Position,
    straight: Position,
    left: Position,
  ): Lane[] => [
    { from, to: [straight, right], index: 0, kind: BUS }, // bus: straight + right
    turns(from, [right], 1),
    turns(from, [straight], 2),
    turns(from, [left], 3),
  ];
  return {
    connections: [],
    road: [
      ...approach(L, B, R, T),
      ...approach(R, T, L, B),
      ...approach(T, L, B, R),
      ...approach(B, R, T, L),
    ],
    signal: { mode: "two-phase", busPriority: true },
  };
}

function level(): Level {
  return {
    // Horizontal arm (west–east), 3-tile approach each side.
    "0,3": arm(L, R), "1,3": arm(L, R), "2,3": arm(L, R),
    "4,3": arm(L, R), "5,3": arm(L, R), "6,3": arm(L, R),
    // Vertical arm (north–south).
    "3,0": arm(T, B), "3,1": arm(T, B), "3,2": arm(T, B),
    "3,4": arm(T, B), "3,5": arm(T, B), "3,6": arm(T, B),
    // The signalised, lane-sorted crossroads.
    "3,3": center(),
  };
}

export const signalturnlanes: TestScenario = {
  id: "signalturnlanes",
  name: "Signals: per-lane heads + turn lanes",
  description:
    "A signalised 4-lane crossroads (kerb bus lane + R/straight/L car lanes). Each " +
    "approach shows a white stop line, one signal head per lane on a gantry bar (the " +
    "kerb head is a bus head with a head start), and white per-lane direction arrows " +
    "(↰ ↑ ↱) on the approach tiles. Cars sort by turn before the junction.",
  level: level(),
  trains: {},
  size: { cols: 7, rows: 7 },
  traffic: { spawnInterval: 0.8, mix: { car: 3, bus: 1 } },
};
