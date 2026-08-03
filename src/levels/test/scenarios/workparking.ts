import { Position } from "@/types";
import { oneWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { deriveWorkplaceParking } from "@/tiles/workplaceParking";

const { Top, Right, Bottom, Left } = Position;

// WORKPLACE PARKING — where the commuter's car actually goes.
//
// A one-way ring road, houses down the west side, and a works on the east that
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
//  1. **07:00.** Cars pull off the west kerb one at a time and drive clockwise
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
  city: "eastworks",
});

// The ring: x 1..9, y 1..6, clockwise.
const X0 = 1;
const X1 = 9;
const Y0 = 1;
const Y1 = 6;

const base: Record<string, TileCell> = {};

base[`${X0},${Y0}`] = street(Bottom, Right); // NW corner
base[`${X1},${Y0}`] = street(Left, Bottom, "industry"); // NE
base[`${X1},${Y1}`] = street(Top, Left, "industry"); // SE
base[`${X0},${Y1}`] = street(Right, Top); // SW
for (let x = X0 + 1; x < X1; x++) {
  base[`${x},${Y0}`] = street(Left, Right); // top run, eastbound
  base[`${x},${Y1}`] = street(Right, Left); // bottom run, westbound
}
for (let y = Y0 + 1; y < Y1; y++) {
  base[`${X0},${y}`] = street(Bottom, Top); // left run, northbound
  base[`${X1},${y}`] = street(Top, Bottom, "industry"); // right run, southbound
}

// The houses: the whole west kerb, plus the inside of the ring's top run — one
// tile from the carriageway, which is what `ROAD_ACCESS_TILES` asks for.
for (let y = Y0; y <= Y1; y++) base[`0,${y}`] = home();
for (let x = X0 + 1; x < X1; x++) base[`${x},${Y0 + 1}`] = home();

// THE WORKS IS ONE BUILDING, not a column of them, and that is the whole
// design of the board: a works spread down the east kerb would derive a rank
// of bays on every tile beside it and there would be room for everybody. One
// gate, one kerb, three spaces.
base[`${X1 + 1},3`] = works();

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
  size: { cols: 12, rows: 8 },
};
