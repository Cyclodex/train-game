import { expandKind } from "@/tiles/kinds";
import { twoWay } from "@/tiles/lanes";
import { Position } from "@/types";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";
import type { ParkingRow } from "@/tiles/parking";

const { Left, Right } = Position;

// CITIZENS RIDE BIKES — phase C′: the bike in the mode choice, and bike-and-ride
// as the way onto the railway when the platform is too far to walk.
//
// One town of houses at the west end of a street; the jobs are split:
//
//   · **The workshop up the road** (4–7 tiles) — too far to walk happily, close
//     enough to CYCLE. Bike owners ride it (watch 🚴 in the header and the Bike
//     band in the share bar); the rest walk the slog or drive.
//   · **The works over the hill** — no road goes there at all, and every house
//     is TOO FAR FROM THE STATION TO WALK (the catchment is two tiles; the
//     houses are three-plus away). Plain transit is refused — "no station
//     within reach" — so the railway's only door is the BIKE RACK by the
//     platform: ride to the rack, lock the bike, WALK to the platform (a real
//     figure on the pavement — no teleport), and take the train.
//
// Click a resident to see the six-mode quote: whose range reaches the rack
// (`bikeRangeOf` — most people ride short hops, the sporty tail rides far),
// who has no bike at all, and why transit alone is off the table.

const STATION_W = 5; // the boarding station, above the rack
const STATION_E = 16; // the far town's platform
const RAIL_Y = 0;
const STREET_Y = 1; // directly under the rail, so the platform meets the kerb
const PLOT_Y = 2; // every address fronts the street from the south
const WIDTH = 20;

const street = (): TileCell => ({
  connections: [],
  road: twoWay(Left, Right),
  terrain: "urban",
});
const home = (): TileCell => ({ connections: [], terrain: "urban", city: "veloheim" });
const works = (city: string): TileCell => ({ connections: [], terrain: "industry", city });

const rack = (from: Position): ParkingRow => ({ from, kind: "bikerack", count: 6 });

const level: Record<string, TileCell> = {};

// The railway: one line along the top, a platform over the rack and one in the
// far town, a depot at each end.
level[`0,${RAIL_Y}`] = expandKind("depot", 1);
for (let x = 1; x < WIDTH - 1; x++) {
  level[`${x},${RAIL_Y}`] =
    x === STATION_W || x === STATION_E
      ? expandKind("station", 1)
      : expandKind("straight", 1);
}
level[`${WIDTH - 1},${RAIL_Y}`] = expandKind("depot", 3);

// The street: the WEST network only, x = 0..9, running right under the line.
// Nothing drives east of it — the far town is the railway's alone.
for (let x = 0; x <= 9; x++) level[`${x},${STREET_Y}`] = street();

// The rack, on the street directly below the boarding platform — inside the
// station's walking reach, which is what makes this a bike-and-ride station
// (`bikeAndRideStationsOf`), and NOT a car P+R: no car may take a stand.
level[`${STATION_W},${STREET_Y}`] = {
  ...street(),
  parking: {
    facility: "veloBR",
    label: "B+R",
    rows: [rack(Left), rack(Right)],
  },
};

// The houses — deliberately THREE OR MORE TILES from the boarding station, so
// walking to the platform is out of reach and the rack is the way in. Two
// neighbourhoods on one street: the west end's ride to the rack is 4–7 tiles
// (keen cyclists only), the east end's is 3–4 (most owners) — the per-rider
// range visible on a single street.
for (let x = 0; x <= 3; x++) level[`${x},${PLOT_Y}`] = home();
for (let x = 8; x <= 9; x++) level[`${x},${PLOT_Y}`] = home();

// The workshop up the road: the plain-bike commute (and the walk/drive it
// competes against). One plot only, so `assignJob`'s nearest-six draw sends a
// good share of the town to the far works instead.
level[`7,${PLOT_Y}`] = works("veloheim");

// The far town: jobs in reach of the eastern platform, reachable by rail alone.
for (let x = 15; x <= 17; x++) level[`${x},${PLOT_Y}`] = works("bergdorf");

// Both depots one colour, the train another: it bounces for ever, an endless
// service for an endless mode.
const DEPOT_COLOUR = "blue";
const TRAIN_COLOUR = "green";

export const citizenbike: TestScenario = {
  id: "citizenbike",
  name: "Citizens ride bikes",
  description:
    "Bikes win the mid-range commute, and the rack by the platform is the " +
    "railway's door: ride there, lock up, walk to the train — visibly, on foot.",
  modeId: "citizens",
  level,
  trains: {
    shuttle: mkTrain("shuttle", 0, RAIL_Y, "people", 3, `${WIDTH - 1},${RAIL_Y}`),
  },
  colors: {
    depotColors: {
      [`0,${RAIL_Y}`]: DEPOT_COLOUR,
      [`${WIDTH - 1},${RAIL_Y}`]: DEPOT_COLOUR,
    },
    trainColors: { shuttle: TRAIN_COLOUR },
  },
  size: { cols: WIDTH, rows: 3 },
  traffic: { spawnInterval: 3, maxCars: 6, mix: { car: 1, bike: 0.5 } },
};
