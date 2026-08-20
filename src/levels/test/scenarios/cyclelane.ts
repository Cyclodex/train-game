import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, type LaneKind } from "@/tiles/lanes";

// The remedy for `bikemix`: the SAME single-lane street, now with a kerb-side
// CYCLE lane (kind="cycle") beside the car lane. Bikes spawn onto and ride the
// green lane (the drift twin of the bus-lane preference); cars may not enter it
// and flow freely on their own lane — the queue from `bikemix` dissolves. The
// before/after pair of these two scenarios IS the pitch for cycle
// infrastructure. Cycle lane on the kerb (index 0), car lane inboard (index 1),
// mirroring how the bus-lane scenarios are laid out.
function lanesWithCycle(): Lane[] {
  const cycleKind: LaneKind = "cycle";
  return [
    { from: Position.Left, to: [Position.Right], index: 0, kind: cycleKind },
    { from: Position.Right, to: [Position.Left], index: 0, kind: cycleKind },
    { from: Position.Left, to: [Position.Right], index: 1 },
    { from: Position.Right, to: [Position.Left], index: 1 },
  ];
}

export const cyclelane: TestScenario = {
  id: "cyclelane",
  name: "Cycle lane: bikes out of the stream",
  description:
    "The bikemix street with a kerb-side cycle lane painted (green tint). Bikes " +
    "ride the cycle lane, cars keep their own lane and no longer queue behind " +
    "them — compare with /test/bikemix, the same street without the lane. Buses " +
    "may not use it either; only bikes ride green.",
  level: {
    "0,1": { connections: [], road: lanesWithCycle() },
    "1,1": { connections: [], road: lanesWithCycle() },
    "2,1": { connections: [], road: lanesWithCycle() },
    "3,1": { connections: [], road: lanesWithCycle() },
    "4,1": { connections: [], road: lanesWithCycle() },
    "5,1": { connections: [], road: lanesWithCycle() },
  },
  trains: {},
  size: { cols: 6, rows: 3 },
  traffic: { spawnInterval: 0.9, maxCars: 10, mix: { car: 1, bike: 0.8 } },
};
