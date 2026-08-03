import { expandKind } from "@/tiles/kinds";
import { twoWay } from "@/tiles/lanes";
import { Position } from "@/types";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Left, Right } = Position;

// HOW PEOPLE CHOOSE — one street of houses, three commutes, three answers.
//
// The board exists to be INSPECTED. Click a house, click a resident, and the
// panel prices every way they could make their journey: walk, car, train, park
// & ride, each in board seconds, with the winner marked and a reason beside the
// ones that are not on offer at all. Three neighbours on the same street get
// three different answers, and the numbers say why.
//
//   · **A job two tiles away** → they WALK. The train is on offer and loses
//     badly: waiting for it costs more than the whole walk.
//   · **A job six tiles away, down the same street** → they DRIVE. The road
//     reaches, and once it does the car beats the train over any distance this
//     board contains.
//   · **A job twelve tiles away, across the gap in the street** → they take the
//     TRAIN, because the car is not on offer: no road joins the two ends.
//
// That last line is the whole lesson of the mode, and it is why the street has
// a deliberate two-tile GAP at x=11–12. The railway does not win by being fast.
// It wins where the road does not go. Close the gap in the editor and watch the
// third group switch to driving.
//
// Design: docs/superpowers/specs/2026-08-01-citizens-and-cities-design.md

const STATION_X = [3, 9, 15];
const NORTH_RAIL = 0;
const STREET_Y = 2;
const SOUTH_RAIL = 4;
const WIDTH = 20;
/** The break in the street: what makes the far side undriveable. */
export const GAP_X = [11, 12];

const street = (): TileCell => ({
  connections: [],
  road: twoWay(Left, Right),
  terrain: "urban",
});
const home = (city: string): TileCell => ({ connections: [], terrain: "urban", city });
const works = (city: string): TileCell => ({ connections: [], terrain: "industry", city });

const level: Record<string, TileCell> = {};

// A line above and a line below, three stops each, a depot at each end. Two
// lines rather than one so BOTH plot rows have a station within walking reach
// (the catchment radius is 2 tiles) — a house one tile too far is a citizen who
// simply cannot get to work, which is a fine thing to build on purpose and a
// terrible thing to ship by accident.
function line(y: number): void {
  level[`0,${y}`] = expandKind("depot", 1);
  for (let x = 1; x < WIDTH - 1; x++) {
    level[`${x},${y}`] = STATION_X.includes(x)
      ? expandKind("station", 1)
      : expandKind("straight", 1);
  }
  level[`${WIDTH - 1},${y}`] = expandKind("depot", 3);
}
line(NORTH_RAIL);
line(SOUTH_RAIL);

// The street — in TWO pieces. Everything west of the gap is one road network;
// everything east of it is another, and nothing drives between them.
for (let x = 0; x < WIDTH; x++) {
  if (!GAP_X.includes(x)) level[`${x},${STREET_Y}`] = street();
}

// The houses: one neighbourhood either side of the street.
//
// x = 1..5 and not 1..6, and the difference matters: a station's catchment is
// two tiles, so with stops at 3, 9 and 15 the columns x = 6 and x = 12 have no
// station in reach at all. A house there whose owner has no car and whose job
// is out of walking range cannot make the journey by ANY means, and the model
// refuses the trip — the strongest unhappiness signal it has. Fine to build on
// purpose; a bad accident to ship on the board that teaches mode choice.
for (const y of [1, 3]) for (let x = 1; x <= 5; x++) level[`${x},${y}`] = home("altstadt");

// Job 1 — the corner shop at the end of the road. Four tiles: a walk.
for (const y of [1, 3]) level[`7,${y}`] = works("altstadt");
// Job 2 — down the same street, past walking range but on the same road
// network and in reach of station 9. The car's case.
for (const y of [1, 3]) level[`9,${y}`] = works("mittelfeld");
// Job 3 — over the gap, in reach of station 15. The railway's case, and the
// only one of the three where it has one.
//
// Six plots against the near clusters' two apiece, and that ratio is doing the
// work: `assignJob` draws at random from the SIX NEAREST open workplaces, so
// keeping the near clusters small is what puts a third of the town out here
// rather than leaving the far jobs empty and the lesson unlearnable. Capacity
// alone would not have done it — a work plot holds twelve, so two of them
// swallowed the whole town on the first draft of this board.
for (const y of [1, 3]) for (let x = 14; x <= 16; x++) level[`${x},${y}`] = works("neustadt");

// Both depots the same colour and the train another, so it bounces rather than
// parks: an endless mode needs an endless service.
const DEPOT_COLOUR = "blue";
const TRAIN_COLOUR = "green";

export const citizenchoice: TestScenario = {
  id: "citizenchoice",
  name: "How people choose",
  description: "One street, three commutes: one walked, one driven, one by train — and the panel says why.",
  modeId: "citizens",
  level,
  trains: {
    north: mkTrain("north", 0, NORTH_RAIL, "people", 3, `${WIDTH - 1},${NORTH_RAIL}`),
    south: mkTrain("south", WIDTH - 1, SOUTH_RAIL, "people", 3, `0,${SOUTH_RAIL}`),
  },
  colors: {
    depotColors: {
      [`0,${NORTH_RAIL}`]: DEPOT_COLOUR,
      [`${WIDTH - 1},${NORTH_RAIL}`]: DEPOT_COLOUR,
      [`0,${SOUTH_RAIL}`]: DEPOT_COLOUR,
      [`${WIDTH - 1},${SOUTH_RAIL}`]: DEPOT_COLOUR,
    },
    trainColors: { north: TRAIN_COLOUR, south: TRAIN_COLOUR },
  },
  size: { cols: WIDTH, rows: 5 },
  traffic: { spawnInterval: 3, maxCars: 6 },
};
