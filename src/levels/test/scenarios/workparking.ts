import { Position } from "@/types";
import { oneWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { deriveWorkplaceParking } from "@/tiles/workplaceParking";

const { Top, Right, Bottom, Left } = Position;

// WORKPLACE PARKING — where the commuter's car actually goes.
//
// A one-way ring road, houses down the east side, and a works on the west that
// nobody can walk to. Everybody who owns a car drives, and — this is the new
// part — every one of those cars has to STOP somewhere when it gets there and
// stay stopped until its owner goes home.
//
// The works has THREE staff spaces at its gate, derived from the map by
// `deriveWorkplaceParking`: nobody drew them, the `terrain: "industry"` did.
// Three, against a works that employs a couple of dozen. That shortfall is the
// board.
//
// **The ring is closed on purpose.** `roadEntries` only finds an entry where a
// road OPENS — off the grid, or at a stub with nothing beyond — and a ring has
// neither, so no ambient traffic can spawn. Every vehicle here is a named
// resident going to work, and every parked car is one of them sitting out the
// working day. Same trick as `/test/citizencars`, and it is what makes the
// claim checkable rather than merely plausible.
//
// What to watch:
//  1. **07:00.** Cars pull off the east kerb one at a time and drive clockwise
//     round to the works.
//  2. **The first three arrivals park.** They swing into the bays outside the
//     gate and STAY there — sprites on the board, not deleted on arrival. The
//     "P 3/3" chip goes red.
//  3. **The fourth is out of luck.** With every bay taken and none aimed at,
//     the next driver is routed to the address instead and pays the search
//     penalty — a slower commute, a worse mood, and a reason for the player to
//     build a car park. Watch the works' own kerb: the queue is not congestion,
//     it is people looking for a space.
//  4. **16:00 onward.** Each owner comes back for their own car — the SAME
//     vehicle id — and the bay is handed to whoever wanted it next.
//
// Design: docs/superpowers/specs/2026-08-04-workplace-parking-design.md
const street = (
  from: Position,
  to: Position,
  terrain: "urban" | "industry" = "urban",
): TileCell => ({
  connections: [],
  road: [oneWay(from, to)],
  terrain,
});

const home = (): TileCell => ({
  connections: [],
  terrain: "urban",
  city: "brookfield",
});
const works = (): TileCell => ({
  connections: [],
  terrain: "industry",
  city: "westworks",
});

// The ring: x 1..9, y 1..6, clockwise.
const X0 = 1;
const X1 = 9;
const Y0 = 1;
const Y1 = 6;

const base: Record<string, TileCell> = {};

base[`${X0},${Y0}`] = street(Bottom, Right, "industry"); // NW corner
base[`${X1},${Y0}`] = street(Left, Bottom); // NE
base[`${X1},${Y1}`] = street(Top, Left); // SE
base[`${X0},${Y1}`] = street(Right, Top, "industry"); // SW
for (let x = X0 + 1; x < X1; x++) {
  base[`${x},${Y0}`] = street(Left, Right); // top run, eastbound
  base[`${x},${Y1}`] = street(Right, Left); // bottom run, westbound
}
for (let y = Y0 + 1; y < Y1; y++) {
  // The west side of the ring serves the works, so it stands on works ground.
  base[`${X0},${y}`] = street(Bottom, Top, "industry"); // left run, northbound
  base[`${X1},${y}`] = street(Top, Bottom); // right run, southbound
}

// The houses: the whole east kerb, plus the inside of the ring's top run — one
// tile from the carriageway, which is what `ROAD_ACCESS_TILES` asks for.
for (let y = Y0; y <= Y1; y++) base[`${X1 + 1},${y}`] = home();
for (let x = X0 + 1; x < X1; x++) base[`${x},${Y0 + 1}`] = home();

// THE WORKS IS ONE BUILDING, not a column of them, and that is the whole
// design of the board: a works spread down the west kerb would derive a rank
// of bays on every tile beside it and there would be room for everybody. One
// gate, one kerb, three spaces.
//
// It sits on the FAR bank of a one-way street, which is legal precisely because
// the street is one-way — there is no oncoming stream to cross to reach it. That
// is the case that made the derivation support `side: "left"` at all: on a board
// built round a one-way loop, half the workplaces are on the wrong kerb and
// would otherwise get no forecourt.
base[`0,3`] = works();

// The staff parking is DERIVED, not drawn: `terrain: "industry"` beside a
// straight one-way street is all the map has to say. Applied here, in the
// scenario's own data, so the board a test loads and the board a player sees
// are the same board.
const level = deriveWorkplaceParking(base);

export const workparking: TestScenario = {
  id: "workparking",
  name: "Workplace parking",
  description:
    "Three staff bays at the factory gate, two dozen people driving to work. Watch who gets one.",
  modeId: "citizens",
  level,
  trains: {},
  size: { cols: 11, rows: 8 },
};
