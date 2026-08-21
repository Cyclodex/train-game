import { Position } from "@/types";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// BEHIND THE HOUSES — the render layer a town is built on, in isolation.
//
// One block: a row of homes with a street either side of it and the works
// beyond them, so every resident's walk leaves a plot, crosses a carriageway at
// a zebra and turns in at another. Nothing here is about routing — this board
// exists to be LOOKED AT, and what it shows is DEPTH.
//
// What to watch:
//  1. **A walk starts indoors.** A resident's first leg is the stub from their
//     own front door to the kerb, and it crosses the plot — which is exactly
//     where the house stands. The figure comes OUT FROM BEHIND the roof rather
//     than sliding across it, and vanishes behind it again on the way home.
//  2. **Roofs hide people, not traffic.** Buildings render at z7, above the
//     walkers (z6); the scenery around them — trees, bushes, the works yard's
//     tanks — is still `scatter` at z1, under everything. Only what people
//     BUILT was lifted, and placement keeps every footprint off the carriageway
//     of its own tile AND its four neighbours, so no roof can cover a vehicle.
//  3. **The works are buildings too.** The sheds and halls north and south
//     behave exactly like the houses: a walker turning in at the works
//     disappears behind the shed, not over it.
//
// The ring is closed, so `roadEntries` is empty and ambient traffic cannot
// spawn (the property `/test/citizenwalk` relies on for the same reason).
// Everything moving here is a resident on foot.

const street = (from: Position, to: Position, crossing = false): TileCell => ({
  connections: [],
  road: twoWay(from, to),
  terrain: "urban",
  ...(crossing ? { footCrossing: true } : {}),
});

const home = (): TileCell => ({ connections: [], terrain: "urban", city: "lindenau" });
const works = (): TileCell => ({ connections: [], terrain: "industry", city: "lindenau" });

const X0 = 0;
const X1 = 5;
const NORTH = 1; // the street north of the houses
const SOUTH = 3; // …and the one south of them

const level: Record<string, TileCell> = {};

// The ring: two runs past the front doors, joined round the ends. The homes sit
// in the gap between them, which is what makes every plot's driveway short and
// every roof something a walker has to come out from behind.
level[`${X0},${NORTH}`] = street(Right, Bottom);
level[`${X1},${NORTH}`] = street(Left, Bottom);
level[`${X0},${SOUTH}`] = street(Top, Right);
level[`${X1},${SOUTH}`] = street(Top, Left);
level[`${X0},2`] = street(Top, Bottom);
level[`${X1},2`] = street(Top, Bottom);

// One zebra per run, offset from each other so the two halves of the block walk
// different routes to work.
for (let x = X0 + 1; x < X1; x++) {
  level[`${x},${NORTH}`] = street(Left, Right, x === 2);
  level[`${x},${SOUTH}`] = street(Left, Right, x === 3);
  level[`${x},2`] = home();
}

// The jobs, one tile beyond each street: a walk of two or three tiles, well
// inside `walkMaxTiles`, so nobody here drives.
for (let x = X0; x <= X1; x++) {
  level[`${x},${NORTH - 1}`] = works();
  level[`${x},${SOUTH + 1}`] = works();
}

export const citizenhouse: TestScenario = {
  id: "citizenhouse",
  name: "Behind the houses",
  description: "Walkers pass behind the roofs they used to walk over.",
  modeId: "citizens",
  level,
  trains: {},
  size: { cols: 6, rows: 5 },
};
