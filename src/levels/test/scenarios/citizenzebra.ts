import { Position } from "@/types";
import { nWayLanes } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";

const { Left, Right } = Position;

// THE ZEBRA UNDER LOAD — a busy road, and people who have to get across it.
//
// The other two citizen boards are closed rings with no way in, so the only
// vehicles on them are residents. This one is the opposite on purpose: a
// through road, open at both map edges, two lanes each way, running as busy as
// the density slider allows. The houses are on the north side and every job is
// on the south, so the entire population has to cross a stream of traffic — at
// the ONE crossing in the middle.
//
// What to watch:
//  1. **The traffic stops.** A pedestrian at the kerb claims the zebra and the
//     road sim treats that tile as closed — the identical mechanism a level
//     crossing uses when a train is coming. Cars brake and queue back from it.
//  2. **They wait when they have to.** A walker who arrives while a car is
//     already on the crossing holds at the kerb and turns amber, then goes.
//  3. **The queue is the cost.** One crossing serving a whole town on a busy
//     road holds the traffic up a lot. Two crossings would halve the walk and
//     double the interruptions — that trade is the decision.
//
// Turn the Cars slider up to make the point; at 100% the road is nose to tail
// and the crossing is doing continuous work.

const street = (crossing = false): TileCell => ({
  connections: [],
  // Two lanes each way: a road worth being stopped on.
  road: nWayLanes(Left, Right, 2),
  terrain: "urban",
  ...(crossing ? { footCrossing: true } : {}),
});

const home = (): TileCell => ({ connections: [], terrain: "urban", city: "kreuzfeld" });
const works = (): TileCell => ({ connections: [], terrain: "industry", city: "kreuzfeld" });

const WIDTH = 12;
const CROSSING_X = 6;

const level: Record<string, TileCell> = {};

// The road, edge to edge — so ambient traffic really does pour through.
for (let x = 0; x < WIDTH; x++) level[`${x},1`] = street(x === CROSSING_X);
// Houses along the north kerb, every job along the south.
for (let x = 0; x < WIDTH; x++) {
  level[`${x},0`] = home();
  level[`${x},2`] = works();
}

export const citizenzebra: TestScenario = {
  id: "citizenzebra",
  name: "Zebra under load",
  description:
    "A busy through road with one crossing, and a town that has to get over it.",
  modeId: "citizens",
  level,
  trains: {},
  size: { cols: WIDTH, rows: 3 },
  traffic: { spawnInterval: 0.9, maxCars: 24 },
};
