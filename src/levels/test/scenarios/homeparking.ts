import { Position } from "@/types";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import type { ParkingRow } from "@/tiles/parking";
import { deriveWorkplaceParking } from "@/tiles/workplaceParking";
import { deriveKerbOverflow } from "@/tiles/kerbOverflow";
import { deriveHomeParking } from "@/tiles/homeParking";
import { citizensModeWith } from "@/modes/citizens";

const { Top, Right, Bottom, Left } = Position;

// HOME PARKING — where the car sleeps.
//
// `/test/workparking` is the day half of this: three staff spaces at a factory
// gate against everybody who drove to work. This is the night half, and it is
// the half the model used to hand-wave. A resident's car was DELETED at the
// front door on the grounds that "a house has a driveway" — true, and nothing
// on the board had one.
//
// Now every house does (`tiles/homeParking.ts`, derived — nobody drew them):
// two spaces of its own hardstanding, on the road tile it fronts onto, PRIVATE
// to that address. A passing driver cannot take your drive however empty it is,
// which is what makes it a drive rather than two more public bays.
//
// **THE DRIVE IS FIXED AND THE HOUSEHOLD IS NOT.** That is the whole mechanic
// and nobody authored it. A home plot holds four people at density 0 and up to
// thirty-two as it builds up, while its frontage stays exactly as wide as it
// ever was. So the same two spaces are plenty for a bungalow and a fraction of
// what a terrace needs — and the surplus cars go on the street, where they
// compete like everybody else.
//
// **The ring is closed on purpose.** `roadEntries` only finds an entry where a
// road OPENS — off the grid, or at a stub with nothing beyond — and a ring has
// neither, so no ambient traffic can spawn. Every car here is a named resident,
// and every parked car is one of them, either at work or at home.
//
// What to watch:
//  1. **Night (before 07:00, and after about 18:00).** The cars are on the
//     drives: one or two standing nose-in at each house, at 90° to the street,
//     unmistakably on somebody's property rather than parked outside it. The
//     `carsAtHome` figure is this picture as a number.
//  2. **The overspill.** Look at the denser houses — the ones nearest the middle
//     of the block, which the map opens at a higher density. More cars than
//     drive, so the extra ones take the marked public bays on the south kerb,
//     and those are ordinary parking that anybody could have taken first.
//  3. **Morning.** Everyone reverses off their drive and heads for the works,
//     where three staff bays are waiting for a couple of dozen of them — the
//     day half of the same problem, on the same board.
//  4. **Evening.** They come back for the SAME cars and the drives fill again.
//     A day's commuting is a cycle, not a sink: the spaces are handed back at
//     both ends or a town runs out of them within a week.
//
// Design: docs/superpowers/specs/2026-08-05-home-parking-design.md
const street = (
  a: Position,
  b: Position,
  parking?: TileCell["parking"],
  terrain: "urban" | "industry" = "urban",
): TileCell => ({
  connections: [],
  road: twoWay(a, b),
  terrain,
  ...(parking ? { parking } : {}),
});

const corner = (a: Position, b: Position): TileCell => ({
  connections: [],
  road: twoWay(a, b),
  terrain: "urban",
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

// The ring: x 1..5, y 1..4.
const X0 = 1;
const X1 = 5;
const Y0 = 1;
const Y1 = 4;

// THE PUBLIC KERB — the overspill, and the only public parking on the board.
// Three marked bays on the south run's OUTER bank, facing away from the houses:
// ordinary street parking, first come first served, and one tile from the homes
// inside the ring (`homeParkTiles` is 2, so it is in reach and the works' own
// forecourt across the board is not).
//
// It matters that this is authored and the drives are not. The drives are what
// the map already implied; THIS is the bit a player builds, and watching it fill
// up is watching the lever work.
//
// `side: "right"` off the eastbound approach is the SOUTH kerb — the outer one.
// Getting that backwards is easy and it is not cosmetic: the north kerb of this
// run is the one the houses front onto, so a public row there takes the bank the
// drives need and the whole inner row of houses ends up with no drive at all.
const kerbRow: ParkingRow[] = [
  { from: Left, side: "right", kind: "parallel", count: 3, align: "pack" },
];

const base: Record<string, TileCell> = {};

base[`${X0},${Y0}`] = corner(Bottom, Right); // NW
base[`${X1},${Y0}`] = corner(Left, Bottom); // NE
base[`${X1},${Y1}`] = corner(Top, Left); // SE
base[`${X0},${Y1}`] = corner(Right, Top); // SW
for (let x = X0 + 1; x < X1; x++) {
  base[`${x},${Y0}`] = street(Left, Right); // top run
  // The south run carries the public bays on its far kerb.
  base[`${x},${Y1}`] = street(Left, Right, { label: "Kerb parking", rows: kerbRow });
}
for (let y = Y0 + 1; y < Y1; y++) {
  // The west run stands on works ground, so the works has a straight kerb.
  base[`${X0},${y}`] = street(Top, Bottom, undefined, "industry");
  base[`${X1},${y}`] = street(Top, Bottom);
}

// The houses. Every one of them fronts DIRECTLY onto the ring, because a drive
// runs from the house onto its own street and nothing else — a plot one tile
// back has no frontage and gets none.
//
//  · The east kerb, outside the ring.
for (let y = Y0; y <= Y1; y++) base[`${X1 + 1},${y}`] = home();
//  · The block inside the ring: the top row fronts onto the top run, the bottom
//    row onto the south run. These are the plots the map opens DENSER (density
//    is biased toward a town's middle), so they are where the overspill shows.
for (let x = X0 + 1; x < X1; x++) {
  base[`${x},${Y0 + 1}`] = home();
  base[`${x},${Y1 - 1}`] = home();
}

// One works, one gate, three staff spaces — the same building `/test/workparking`
// is built around, so the two boards can be read against each other.
base[`0,2`] = works();

// BOTH derivations, in this order, and the order is not arbitrary: the staff
// forecourt takes the works' own kerb first, then the drives take the kerbs the
// houses front onto. Neither pass will touch a bank the other has spent — that
// is what "idempotent, and it leaves an authored row alone" buys — so the two
// compose without either knowing the other exists.
// ...and finally the bare kerb, which is what the driver who finds all of that
// taken settles for. It goes LAST because it takes whatever bank is left, and it
// paints nothing at all — the only sign of it is a car standing at the roadside
// where there is no bay. Without it those drivers used to be DELETED at the
// address, in full view, half a tile into the street.
const level = deriveKerbOverflow(deriveHomeParking(deriveWorkplaceParking(base)));

export const homeparking: TestScenario = {
  id: "homeparking",
  name: "Home parking",
  description:
    "Every house has a drive of its own, two spaces wide. Watch what the denser ones do with the third car.",
  // A FASTER CLOCK, because the subject of this board is a cycle. The citizens
  // mode runs a day in half an hour of real time — right for a session, useless
  // for a demonstration: at that rate a visitor watches one hour of one morning
  // and concludes that nothing happens. Four minutes a day puts the drives
  // filling and emptying inside the time somebody will actually stand and watch.
  mode: citizensModeWith({ secPerDay: 240 }),
  level,
  trains: {},
  size: { cols: 8, rows: 6 },
};
