import { Position } from "@/types";
import { Level } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane } from "@/tiles/lanes";

// A cycle lane on a ONE-WAY street. One-way straights are painted by their own
// kerb-anchored builder (roadGeometry `oneWayStraightMarkingPaths`) rather than
// the two-way `roadLaneMarkingPaths`, because a one-way pins lane 0 to the kerb
// and sheds lanes on the centre side — so the cycle lane's markings had to be
// taught there separately, and until they were, a one-way showed the green tint
// but kept the full-width dashed divider and had no edge line at all.
//
// What to watch: ONE solid white line half a lane in from the kerb, sitting on
// the inner edge of the green strip — no dash beside it — with the cars on the
// inboard lane and the bikes on the green.

const { Left: L, Right: R } = Position;

// Kerb-side cycle lane (index 0) + one car lane inboard, eastbound only.
const oneWayWithCycle = (): Lane[] => [
  { from: L, to: [R], index: 0, kind: "cycle" },
  { from: L, to: [R], index: 1 },
];

const street = (): Level[string] => ({ connections: [], road: oneWayWithCycle() });

export const cycleoneway: TestScenario = {
  id: "cycleoneway",
  name: "Cycle lane on a one-way",
  description:
    "A one-way street (eastbound only) with a kerb-side cycle lane. The green " +
    "strip is bounded by a solid white edge line half a lane in from the kerb — " +
    "the dashed full-lane divider a plain 2-lane one-way would show is gone, " +
    "because the bike lane is only half a slot wide.",
  level: {
    "0,1": street(),
    "1,1": street(),
    "2,1": street(),
    "3,1": street(),
    "4,1": street(),
  },
  trains: {},
  size: { cols: 5, rows: 3 },
  traffic: { spawnInterval: 0.9, maxCars: 8, mix: { car: 1, bike: 0.8 } },
};
