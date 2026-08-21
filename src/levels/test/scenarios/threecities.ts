import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// THREE CITIES — the citizen simulation, whole.
//
// Two parallel lines run east-west with three stops each. Between them sit
// three towns: Westfield and Eastfield are where people live, Steinbach is
// where the work is. Almost nobody's job is within walking distance of their
// house, and there is no road between the towns — so the commute is the
// railway, and the railway is yours.
//
// What to watch (open the city cards):
//  1. **The clock.** Nothing much moves at 03:00. Around 07:00 the platforms
//     fill, because everyone's working day starts within a two-hour window and
//     each person's exact departure is their own.
//  2. **Mode share.** The short hops inside a town are walked; the cross-map
//     commutes are the train slice. That slice IS the network's report card.
//  3. **Happiness, then population.** Trains running → the Work bar rises,
//     newcomers arrive and plots densify. Let both trains sit in their depots
//     for a few days and watch the same board hollow out.
//
// Deliberately road-free: with no street between the towns there is nothing to
// drive down, which is exactly what makes rail the answer. Cars and park & ride
// have their own scenarios (`/test/parkandride`, `/test/parkcity`).
//
// The two lines are the reason two trains can run at once without a head-on
// deadlock: line A along the top, line B along the bottom, each with its own
// depots, each calling at all three towns. Every plot has a station in walking
// reach on BOTH lines, so a journey is one hop in either direction.

// Every depot is blue and both trains are green: a colour MISMATCH, so a train
// bounces back out of the depot it reaches instead of parking in it. That is
// what turns two trains into two permanent shuttles — an endless mode needs an
// endless service.
const DEPOT_COLOUR = "blue";
const TRAIN_COLOUR = "green";

const WEST = 0;
const EAST = 26;
const STATION_X = [3, 13, 23];

// A rail row: depot, straights, stations at the town centres, depot.
function line(level: Record<string, TileCell>, y: number): void {
  level[`${WEST},${y}`] = expandKind("depot", 1);
  for (let x = WEST + 1; x < EAST; x++) {
    level[`${x},${y}`] = STATION_X.includes(x)
      ? expandKind("station", 1)
      : expandKind("straight", 1);
  }
  level[`${EAST},${y}`] = expandKind("depot", 3);
}

const home = (city: string): TileCell => ({
  connections: [],
  terrain: "urban",
  city,
});
const works = (city: string): TileCell => ({
  connections: [],
  terrain: "industry",
  city,
});

const level: Record<string, TileCell> = {};

// Line A (north) and line B (south).
line(level, 0);
line(level, 3);

// The towns, in the two rows between the lines. Each spans its station's
// walking reach exactly (±2 tiles), so every plot is served — a house one tile
// too far would be a citizen who simply cannot get to work, which is a fine
// thing to be able to build and a terrible thing to ship by accident.
//
// The five-tile gaps between the towns are load-bearing, not scenery: they put
// the NEAREST pair of houses in different towns seven tiles apart — one more than
// anybody will walk (`walkMaxTiles`). Pull the towns closer and the board
// quietly stops being about a railway: the first draft had them a tile apart
// and 97% of all journeys were made on foot. The gaps also keep the three towns
// three towns, since the clustering in `tiles/cities.ts` is an 8-neighbour
// flood fill and two blocks that touch would read as one place.
for (let x = 1; x <= 5; x++) {
  level[`${x},1`] = home("westfield");
  level[`${x},2`] = home("westfield");
}
for (let x = 11; x <= 15; x++) {
  level[`${x},1`] = home("steinbach");
  level[`${x},2`] = works("steinbach"); // the works town: everyone's job is here
}
for (let x = 21; x <= 25; x++) {
  level[`${x},1`] = home("eastfield");
  level[`${x},2`] = home("eastfield");
}

export const threecities: TestScenario = {
  id: "threecities",
  name: "Three cities",
  description:
    "People live in Westfield and Eastfield, work in Steinbach, and judge you on the commute.",
  modeId: "citizens",
  level,
  trains: {
    lineA: mkTrain("lineA", WEST, 0, "people", 4, `${EAST},0`),
    lineB: mkTrain("lineB", EAST, 3, "people", 4, `${WEST},3`),
  },
  colors: {
    depotColors: {
      [`${WEST},0`]: DEPOT_COLOUR,
      [`${EAST},0`]: DEPOT_COLOUR,
      [`${WEST},3`]: DEPOT_COLOUR,
      [`${EAST},3`]: DEPOT_COLOUR,
    },
    trainColors: { lineA: TRAIN_COLOUR, lineB: TRAIN_COLOUR },
  },
  size: { cols: 27, rows: 4 },
};
