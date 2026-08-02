import { Position } from "@/types";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// PEOPLE ON THE PAVEMENT — walking, where you can see them.
//
// A small block: houses in the middle, the works and shops fronting it on both
// sides, and a street round the whole thing. Everybody's job is two or three
// tiles from their door — inside `walkMaxTiles` — so this board is the walking
// half of the citizen layer in isolation, the way `/test/citizencars` is the
// driving half.
//
// What to watch:
//  1. **The pavements.** Pale stone bands either side of the carriageway, drawn
//     from the road's OWN kerb geometry — so they follow the bend at each corner
//     instead of drifting off it. Every street on every board has them now,
//     unless it says `footway: "none"`.
//  2. **07:00.** Figures leave the houses onto the pavement, walk round to a
//     ZEBRA, cross, and turn in at the works. They pass each other without any
//     of the queueing a car does — a pedestrian is not a vehicle — but they may
//     only cross the carriageway where a crossing says so, and a figure held at
//     a kerb waiting for the road to clear turns amber.
//  3. **The traffic stops for them.** A pedestrian claims the zebra and the road
//     sim treats that tile as closed, which is the identical mechanism a level
//     crossing uses when a train is coming.
//  4. **The journey is theirs.** A walker's leg ends when the FIGURE arrives,
//     not when a clock runs out, so what you watch and what the city card scores
//     are the same journey.
//
// The ring is closed, so `roadEntries` is empty and ambient traffic cannot
// spawn (the same property `/test/citizencars` relies on). Everything moving
// here is a resident.

const street = (from: Position, to: Position, crossing = false): TileCell => ({
  connections: [],
  road: twoWay(from, to),
  terrain: "urban",
  ...(crossing ? { footCrossing: true } : {}),
});

const home = (): TileCell => ({ connections: [], terrain: "urban", city: "lindenau" });
const works = (): TileCell => ({ connections: [], terrain: "industry", city: "lindenau" });

const X0 = 1;
const X1 = 6;
const Y0 = 1;
const Y1 = 4;

const level: Record<string, TileCell> = {};

// The street round the block: four corners and the runs between them. Two-way,
// so both pavements carry people in both directions.
level[`${X0},${Y0}`] = street(Right, Bottom);
level[`${X1},${Y0}`] = street(Left, Bottom);
level[`${X1},${Y1}`] = street(Top, Left);
level[`${X0},${Y1}`] = street(Top, Right);
// TWO ZEBRAS, and they are the whole reason this board is interesting. The
// houses are inside the block and the works outside it, so EVERY resident has
// to cross the carriageway — and the only places they may are these. Watch them
// converge on the crossings rather than stepping off the kerb wherever they
// like, and watch the traffic stop while they are on one.
//
// Move them, or take one away, and the walk gets longer for everybody it served.
// That is the decision: a crossing costs the traffic and saves the pedestrians.
for (let x = X0 + 1; x < X1; x++) {
  level[`${x},${Y0}`] = street(Left, Right, x === 3);
  level[`${x},${Y1}`] = street(Left, Right, x === 4);
}
for (let y = Y0 + 1; y < Y1; y++) {
  level[`${X0},${y}`] = street(Top, Bottom);
  level[`${X1},${y}`] = street(Top, Bottom);
}

// The houses fill the middle of the block — every one of them a tile from the
// carriageway, which is what gives each a driveway onto a pavement.
for (let y = Y0 + 1; y < Y1; y++) {
  for (let x = X0 + 1; x < X1; x++) level[`${x},${y}`] = home();
}

// The works front the street from outside, north and south. Two or three tiles
// from every door: this is a town you walk across.
for (let x = X0; x <= X1; x++) {
  level[`${x},${Y0 - 1}`] = works();
  level[`${x},${Y1 + 1}`] = works();
}

export const citizenwalk: TestScenario = {
  id: "citizenwalk",
  name: "People on the pavement",
  description:
    "Pavements, and two zebras every resident has to reach before they can cross.",
  modeId: "citizens",
  level,
  trains: {},
  size: { cols: 8, rows: 6 },
};
