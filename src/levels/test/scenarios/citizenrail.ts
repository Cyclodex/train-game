import { Position } from "@/types";
import { twoWay } from "@/tiles/lanes";
import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Left, Right } = Position;

// THE PEDESTRIAN LEVEL CROSSING — a town cut in half by the railway.
//
// Everybody lives on the west side of the line and works on the east, and the
// only way over is the level crossing in the middle. Not a zebra: a zebra is a
// negotiation and this is not one. The train has absolute priority, so the
// walkers wait, and nothing they do can hold the train up.
//
// What to watch:
//  1. **They stop at the tracks.** A figure reaching the crossing while the
//     train has it holds at the edge and turns amber — the same amber a walker
//     at a busy zebra shows, driven by the same `waiting` flag. When the tile
//     clears they walk over.
//  2. **The train does not care.** Nothing the pedestrians do reaches the
//     railway. Compare `/test/citizenzebra`, where a walker CLAIMS the crossing
//     and the traffic gives way to them — the two crossings are opposites, and
//     that asymmetry is why this one cannot deadlock and needs no backstop.
//  3. **The cars wait alongside them.** The ambient traffic on the same street
//     brakes for the identical predicate (a train reserving or standing on the
//     tile), so the booms hold up the queue and the crowd together.
//  4. **The commute is the cost.** Every journey on this board pays for the
//     wait, and the city card's Work bar is where it shows up.
//
// Both depot colours are set to the SAME value while the train is set to
// another, so it bounces back out of every depot it reaches instead of parking:
// a shuttle that keeps the crossing busy for as long as you watch.

const street = (): TileCell => ({
  connections: [],
  road: twoWay(Left, Right),
  terrain: "urban",
});

const home = (): TileCell => ({ connections: [], terrain: "urban", city: "gleisdorf" });
const works = (): TileCell => ({ connections: [], terrain: "industry", city: "gleisdorf" });

const WIDTH = 13;
/** The one tile where the street and the railway share ground. */
export const CROSSING_X = 6;
/** The row the street runs along. */
export const STREET_Y = 2;

const level: Record<string, TileCell> = {};

// The street, edge to edge, with the level crossing in the middle: a vertical
// rail straight and a horizontal road over the same tile. The pavement runs
// across the rails with it, and THAT is what makes this cell a pedestrian
// crossing — derived from the tile, with nothing to author.
for (let x = 0; x < WIDTH; x++) level[`${x},${STREET_Y}`] = street();
level[`${CROSSING_X},${STREET_Y}`] = {
  ...expandKind("straight", 0), // vertical rail
  road: twoWay(Left, Right),
  terrain: "urban",
};

// Houses west of the line, every job east of it, on BOTH sides of the street —
// so a decent crowd converges on one crossing. Nobody has to cross the ROAD to
// get to work: this board tests one mechanic at a time, and the road crossing
// has `/test/citizenzebra` to itself.
for (const y of [STREET_Y - 1, STREET_Y + 1]) {
  for (let x = 0; x < CROSSING_X; x++) level[`${x},${y}`] = home();
  for (let x = CROSSING_X + 1; x < WIDTH; x++) level[`${x},${y}`] = works();
}

// The railway: depot, approach, the crossing, approach, depot. The two approach
// tiles sit in the plot rows — a line does cut through a town, which is the
// point of the board.
level[`${CROSSING_X},${STREET_Y - 2}`] = expandKind("depot", 2); // opens south
level[`${CROSSING_X},${STREET_Y - 1}`] = expandKind("straight", 0);
level[`${CROSSING_X},${STREET_Y + 1}`] = expandKind("straight", 0);
level[`${CROSSING_X},${STREET_Y + 2}`] = expandKind("depot", 0); // opens north

const DEPOT_COLOUR = "#2f6f4f";
const TRAIN_COLOUR = "#b34d3a";

export const citizenrail: TestScenario = {
  id: "citizenrail",
  name: "Crossing the railway",
  description: "A town cut in half by the line, and the level crossing everybody walks over.",
  modeId: "citizens",
  level,
  trains: {
    shuttle: mkTrain(
      "shuttle",
      CROSSING_X,
      STREET_Y - 2,
      "people",
      2,
      `${CROSSING_X},${STREET_Y + 2}`
    ),
  },
  colors: {
    depotColors: {
      [`${CROSSING_X},${STREET_Y - 2}`]: DEPOT_COLOUR,
      [`${CROSSING_X},${STREET_Y + 2}`]: DEPOT_COLOUR,
    },
    trainColors: { shuttle: TRAIN_COLOUR },
  },
  size: { cols: WIDTH, rows: 5 },
  traffic: { spawnInterval: 1.6, maxCars: 12 },
};
