import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs, type Lane, type LaneKind } from "@/tiles/lanes";
import { type Level, type TileCell } from "@/tiles/model";
import { JunctionSignal } from "@/sim/junctionSignal";

// Street-junction traffic signals (#38). A 4-way road cross where cars enter from
// every arm and may go straight / left / right — the same all-turns centre as the
// `roadjunction` scenario, but the centre tile carries a `signal`, so the
// intersection is SIGNALISED: an approach may only enter on green, with a real
// amber + all-red clearance between phases, on top of the conflict-matrix yield.
//
// A phase plan only *means* something under contention, so cars stream from all
// four arms (the picker's two competing streams). One scenario per mode shows the
// timing in isolation; the bus-priority one adds buses so transit signal priority
// is visible.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });

function signalCross(signal: JunctionSignal) {
  return {
    // Horizontal road.
    "0,2": road([Position.Left, Position.Right]),
    "1,2": road([Position.Left, Position.Right]),
    "3,2": road([Position.Left, Position.Right]),
    "4,2": road([Position.Left, Position.Right]),
    // Vertical road.
    "2,0": road([Position.Top, Position.Bottom]),
    "2,1": road([Position.Top, Position.Bottom]),
    "2,3": road([Position.Top, Position.Bottom]),
    "2,4": road([Position.Top, Position.Bottom]),
    // The signalised crossing: all turn connections + the traffic signal.
    "2,2": {
      ...road(
        [Position.Left, Position.Right],
        [Position.Top, Position.Bottom],
        [Position.Left, Position.Top],
        [Position.Left, Position.Bottom],
        [Position.Right, Position.Top],
        [Position.Right, Position.Bottom],
      ),
      signal,
    },
  };
}

// Two-phase: N+S green together, then E+W. The everyday light — highest throughput.
export const signaltwophase: TestScenario = {
  id: "signaltwophase",
  name: "Signals: two-phase",
  description:
    "Signalised cross, opposing-pairs timing: N+S green together, then E+W. Cars from all four arms obey green/amber/red.",
  level: signalCross({ mode: "two-phase" }),
  trains: {},
  size: { cols: 5, rows: 5 },
  traffic: { spawnInterval: 1.0 },
};

// Round-robin: exactly one approach green at a time, cycling N→E→S→W. Lower
// throughput, conflict-free even for unprotected turns.
export const signalroundrobin: TestScenario = {
  id: "signalroundrobin",
  name: "Signals: round-robin",
  description:
    "Signalised cross, single-arm round-robin: one approach green at a time, cycling N→E→S→W. Conflict-free for awkward junctions.",
  level: signalCross({ mode: "round-robin" }),
  trains: {},
  size: { cols: 5, rows: 5 },
  traffic: { spawnInterval: 1.0 },
};

// ─── Bus-lane signal priority helpers ────────────────────────────────────────
// Bus priority (transit signal priority) only makes sense when buses travel in a
// dedicated bus lane: the signal controller extends the green for the arm that has
// a bus approaching. The three scenarios below demonstrate this for 1-lane
// (bus-only approach), 2-lane (1 bus + 1 car), and 3-lane (1 bus + 2 car) road
// configurations.
//
// Right-hand traffic turn table (used throughout):
//   From L (→E):  right = B,  left = T,  straight = R
//   From R (→W):  right = T,  left = B,  straight = L
//   From T (→S):  right = L,  left = R,  straight = B
//   From B (→N):  right = R,  left = L,  straight = T

const L = Position.Left;
const R = Position.Right;
const T = Position.Top;
const B = Position.Bottom;
const BUS: LaneKind = "bus";

// A straight road arm (two-way) with `carLanes` car lanes + 1 kerb bus lane per
// direction. Bus lane sits at index 0 (kerb); car lanes at indices 1..carLanes.
function busArm(from: Position, to: Position, carLanes: number): TileCell {
  const road: Lane[] = [
    { from, to: [to], index: 0, kind: BUS },
    ...Array.from({ length: carLanes }, (_, i) => ({ from, to: [to], index: i + 1 })),
    { from: to, to: [from], index: 0, kind: BUS },
    ...Array.from({ length: carLanes }, (_, i) => ({ from: to, to: [from], index: i + 1 })),
  ];
  return { connections: [], road };
}

// Symmetric 4-way junction centre with `carLanes` car lanes + 1 kerb bus lane per
// arm. Bus lane (index 0): straight + right turn only (kerb-to-kerb, no cross-lane
// left turn). Car lanes (indices 1..carLanes): all three movements.
function busCrossCenter(carLanes: number, signal: JunctionSignal): TileCell {
  const road: Lane[] = [
    // From L (→E): right = B, left = T, straight = R
    { from: L, to: [R, B], index: 0, kind: BUS },
    ...Array.from({ length: carLanes }, (_, i) => ({ from: L, to: [R, T, B], index: i + 1 })),
    // From R (→W): right = T, left = B, straight = L
    { from: R, to: [L, T], index: 0, kind: BUS },
    ...Array.from({ length: carLanes }, (_, i) => ({ from: R, to: [L, T, B], index: i + 1 })),
    // From T (→S): right = L, left = R, straight = B
    { from: T, to: [B, L], index: 0, kind: BUS },
    ...Array.from({ length: carLanes }, (_, i) => ({ from: T, to: [B, L, R], index: i + 1 })),
    // From B (→N): right = R, left = L, straight = T
    { from: B, to: [T, R], index: 0, kind: BUS },
    ...Array.from({ length: carLanes }, (_, i) => ({ from: B, to: [T, L, R], index: i + 1 })),
  ];
  return { connections: [], road, signal };
}

// Full 5×5 grid for a symmetric bus-lane cross: 4 arm tiles per direction + the
// centre. `carLanes` = car lanes per direction (1 → 2L total, 2 → 3L total).
function busCrossLevel(carLanes: number, signal: JunctionSignal): Level {
  return {
    "0,2": busArm(L, R, carLanes),
    "1,2": busArm(L, R, carLanes),
    "3,2": busArm(L, R, carLanes),
    "4,2": busArm(L, R, carLanes),
    "2,0": busArm(T, B, carLanes),
    "2,1": busArm(T, B, carLanes),
    "2,3": busArm(T, B, carLanes),
    "2,4": busArm(T, B, carLanes),
    "2,2": busCrossCenter(carLanes, signal),
  };
}

// 1L bus-only approach: the N-S corridor is a 1-lane bus-only street; the E-W
// road is a 1-lane car-only street. Cars go straight through on E-W; buses travel
// the N-S corridor (and can also enter/exit via E-W). The junction centre gates
// car exits toward the bus-only N-S arms behind `busTo` so cars are never routed
// onto the bus street — exactly what syncJunctionBusGates would compute.
function oneLBusCrossLevel(signal: JunctionSignal): Level {
  // E-W: plain car lane each direction.
  const ewArm: TileCell = {
    connections: [],
    road: [
      { from: L, to: [R], index: 0 },
      { from: R, to: [L], index: 0 },
    ],
  };
  // N-S: bus-only lane each direction.
  const nsArm: TileCell = {
    connections: [],
    road: [
      { from: T, to: [B], index: 0, kind: BUS },
      { from: B, to: [T], index: 0, kind: BUS },
    ],
  };
  // Junction centre: N-S arms are bus-only so car lanes gate their exits to busTo.
  const center: TileCell = {
    connections: [],
    road: [
      // Cars from E/W go straight; buses from E/W may also turn onto the bus street.
      { from: L, to: [R], busTo: [T, B], index: 0 },
      { from: R, to: [L], busTo: [T, B], index: 0 },
      // Buses from N/S: all movements (bus-only lane — cars cannot enter from here).
      { from: T, to: [B, L, R], index: 0, kind: BUS },
      { from: B, to: [T, L, R], index: 0, kind: BUS },
    ],
    signal,
  };
  return {
    "0,2": ewArm, "1,2": ewArm, "3,2": ewArm, "4,2": ewArm,
    "2,0": nsArm, "2,1": nsArm, "2,3": nsArm, "2,4": nsArm,
    "2,2": center,
  };
}

// 1L — bus-only approach: a 1-lane bus-only N-S street crosses a 1-lane car-only
// E-W street. The signal controls both corridors (two-phase: N+S ↔ E+W). With bus
// priority on, an approaching bus extends the N+S green so it rarely stops.
export const signalbuslane1l: TestScenario = {
  id: "signalbuslane1l",
  name: "Signals: bus priority (1L bus-only approach)",
  description:
    "A 1-lane bus-only N-S street crosses a 1-lane car-only E-W street at a signalised " +
    "junction with transit signal priority. Buses hold the N-S corridor; cars go straight " +
    "east-west. The priority extends the N+S green when a bus is approaching.",
  level: oneLBusCrossLevel({ mode: "two-phase", busPriority: true }),
  trains: {},
  size: { cols: 5, rows: 5 },
  // Buses spawn from all edges; cars only succeed from E/W (N/S roads are bus-only).
  traffic: { spawnInterval: 1.0, mix: { car: 1, bus: 1 } },
};

// 2L (1 bus + 1 car per direction) — bus priority with dedicated lane: every arm
// has a kerb bus lane (index 0) alongside a car lane (index 1). Bus priority
// extends the active arm's green while a bus is approaching on the bus lane.
// Previously `signalbuspriority` used plain 1-lane roads; updated here to show
// actual dedicated bus lanes where the priority mechanism is meaningful.
export const signalbuspriority: TestScenario = {
  id: "signalbuspriority",
  name: "Signals: bus priority (2L: kerb bus + 1 car)",
  description:
    "Signalised cross with dedicated bus lanes: each arm has a kerb bus lane (index 0) + " +
    "1 car lane (index 1) per direction. A waiting bus gets a HEAD START: its arm's small " +
    "transit lens turns green ~3s before the cars' green, so the bus clears its lane " +
    "before right-turning cars cross it. The green is also extended / brought forward " +
    "for approaching buses. Watch the bus pull away while the cars still hold.",
  level: busCrossLevel(1, { mode: "two-phase", busPriority: true }),
  trains: {},
  size: { cols: 5, rows: 5 },
  traffic: { spawnInterval: 1.0, mix: { car: 1, bus: 1 } },
};

// 3L (1 bus + 2 car per direction) — wider road, same bus priority: the kerb lane
// is still the bus lane; two car lanes sit inboard. The signal phase plan and the
// bus-priority extension are unchanged — the wider road increases car capacity but
// does not alter the signalling logic.
export const signalbuslane3l: TestScenario = {
  id: "signalbuslane3l",
  name: "Signals: bus priority (3L: kerb bus + 2 car)",
  description:
    "Wide-road signalised cross: each arm has a kerb bus lane + 2 car lanes per direction " +
    "(3L total). Bus priority works identically to the 2L case; the extra car lane " +
    "increases throughput while buses keep their dedicated kerb lane. Enable Debug to " +
    "compare the amber bus-lane arrows against the wider car-lane band.",
  level: busCrossLevel(2, { mode: "two-phase", busPriority: true }),
  trains: {},
  size: { cols: 5, rows: 5 },
  traffic: { spawnInterval: 0.8, mix: { car: 2, bus: 1 } },
};
