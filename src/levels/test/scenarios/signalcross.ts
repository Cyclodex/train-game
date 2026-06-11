import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";
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

// Bus priority (layered on two-phase): an approaching bus extends / brings forward
// its arm's green, so it isn't stopped. Mix in buses so the priority is visible.
export const signalbuspriority: TestScenario = {
  id: "signalbuspriority",
  name: "Signals: bus priority",
  description:
    "Signalised cross with transit signal priority: an approaching bus extends or brings forward its green so it sails through, while cars still obey the lights.",
  level: signalCross({ mode: "two-phase", busPriority: true }),
  trains: {},
  size: { cols: 5, rows: 5 },
  traffic: { spawnInterval: 1.0, mix: { car: 1, bus: 1 } },
};
