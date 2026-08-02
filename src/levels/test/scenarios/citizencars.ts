import { Position } from "@/types";
import { oneWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// CITIZENS DRIVE — every car on this board is a person going to work.
//
// A one-way ring road round a town. Brookfield's houses are on the west side
// and along the inside of the ring; the works are the column to the east. The
// commute is nine to eleven tiles, well past the four anybody will walk, and
// there is no railway at all — so everyone who owns a car drives, and everyone
// who does not walks to the shops and no further.
//
// **The ring is closed on purpose, and it is the whole point of the board.**
// `roadEntries` only finds an entry where a road OPENS — off the grid, or at a
// stub with nothing beyond it. A ring has neither, so ambient traffic cannot
// spawn here at all: `trySpawn` bails on an empty entry list before it even
// looks at the density slider. Every vehicle you see was dispatched by
// `roadSim.requestTrip` on behalf of a named citizen leaving their house.
// That is what makes the claim checkable rather than merely plausible.
//
// What to watch:
//  1. **07:00.** The street is empty at night. Cars pull out of the west side
//     one at a time as each resident's own departure hour comes round.
//  2. **They go the long way.** The ring is one-way clockwise, so a car from the
//     west drives up and over the top to reach the works — the same route the
//     debug overlay draws, and the same distance the driver is judged on.
//  3. **16:00 onward.** The whole thing runs in reverse as they go home.
//  4. **The mode-share bar reads ~100% car**, because that is the only way to
//     make this journey. Give the board a railway and watch it change.
//
// One-way, not two-way, for the ordinary reason: a single carriageway shared in
// both directions has nowhere for opposing cars to pass. Directed lanes solve
// that in general (see `twoWay`), but a ring wants one direction anyway.

const street = (from: Position, to: Position): TileCell => ({
  connections: [],
  road: [oneWay(from, to)],
});

const home = (): TileCell => ({
  connections: [],
  terrain: "urban",
  city: "brookfield",
});
const works = (): TileCell => ({
  connections: [],
  terrain: "industry",
  city: "eastworks",
});

// The ring: x 1..10, y 1..7, clockwise.
const X0 = 1;
const X1 = 10;
const Y0 = 1;
const Y1 = 7;

const level: Record<string, TileCell> = {};

// Corners first, then the four runs between them.
level[`${X0},${Y0}`] = street(Bottom, Right); // NW: arrive from the left run, turn east
level[`${X1},${Y0}`] = street(Left, Bottom); // NE: turn south
level[`${X1},${Y1}`] = street(Top, Left); // SE: turn west
level[`${X0},${Y1}`] = street(Right, Top); // SW: turn north
for (let x = X0 + 1; x < X1; x++) {
  level[`${x},${Y0}`] = street(Left, Right); // top run, eastbound
  level[`${x},${Y1}`] = street(Right, Left); // bottom run, westbound
}
for (let y = Y0 + 1; y < Y1; y++) {
  level[`${X0},${y}`] = street(Bottom, Top); // left run, northbound
  level[`${X1},${y}`] = street(Top, Bottom); // right run, southbound
}

// The houses: the whole west kerb, plus the inside of the ring's top run. Both
// are one tile from the carriageway, which is what `ROAD_ACCESS_TILES` asks for
// — a driveway you can see the street from.
for (let y = Y0; y <= Y1; y++) level[`0,${y}`] = home();
for (let x = X0 + 1; x < X1; x++) level[`${x},${Y0 + 1}`] = home();

// The works: the east kerb, nine to eleven tiles from every house.
for (let y = Y0; y <= Y1; y++) level[`${X1 + 1},${y}`] = works();

export const citizencars: TestScenario = {
  id: "citizencars",
  name: "Citizens drive",
  description:
    "No railway, one ring road: every car on the board is a resident driving to work.",
  modeId: "citizens",
  level,
  trains: {},
  size: { cols: 12, rows: 9 },
};
