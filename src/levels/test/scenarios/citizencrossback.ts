import { Position } from "@/types";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// THE WALK BACK — a zebra that is not on the way.
//
// `/test/citizenwalk` puts a crossing on both sides of its block, so a walker
// there always goes forwards: door, pavement, zebra, works. This board takes
// one of them away, and that single change produces the two awkward walks that
// a pavement has to get right and used to get wrong. Both are lateral JUMPS —
// the walker is in one place on one tick and somewhere they could not have
// walked to on the next.
//
//  1. **Doubling back.** The house and its works are on the same tile of
//     street, on opposite banks, and the only zebra is one tile west. So the
//     walk is: out to the pavement, west to the crossing, over, and east again
//     to a door directly opposite the one they left. The route reaches the
//     crossing tile and leaves it BY THE SAME EDGE — and a tile entered and
//     left by one edge has to be retraced, walked in to the middle and back out
//     the way it was entered. Walking on to the far edge instead left the
//     walker a tile beyond where the next step resumed: they stepped off the
//     zebra, strolled west, and snapped a whole tile east. Measured: 1.05 tiles.
//
//  2. **The corner's spelling.** The second works is round the bend on the west
//     arm, so that walk crosses at the same zebra and then rounds the north-west
//     corner. A pavement `side` is +1 or -1 measured against EACH TILE'S OWN
//     through movement, and a tile's through movement is whichever one its lane
//     list happens to name first: the corner here reads `twoWay(Right, Bottom)`
//     and the straight beside it `twoWay(Left, Right)` — both perfectly
//     ordinary, and they disagree about which bank +1 is. Carried across that
//     seam as a bare number, the walker changed banks mid-stride with no
//     crossing under them. Measured: 0.44 tiles, the width of the road.
//
// The ring is closed, so `roadEntries` is empty and no ambient traffic can
// spawn (the same property `/test/citizenwalk` relies on): everything moving
// here is a resident, and the pavements are clear enough to watch them on.
//
// What to watch: from 07:00, two figures leave the two houses inside the block,
// converge on the ONE zebra, and walk back out to their works — one of them all
// the way back to the tile it started on. Not one sideways jump in either walk,
// and the only time anybody is on the tarmac is on the stripes.

const street = (from: Position, to: Position, crossing = false): TileCell => ({
  connections: [],
  road: twoWay(from, to),
  terrain: "urban",
  ...(crossing ? { footCrossing: true } : {}),
});

const home = (): TileCell => ({ connections: [], terrain: "urban", city: "hinterbach" });
const works = (): TileCell => ({ connections: [], terrain: "industry", city: "hinterbach" });

/** The one tile anybody may legally be out in the road on. */
export const CROSSING_ID = "2,1";

const level: Record<string, TileCell> = {};

// A small ring of street round a two-tile block. The corners are authored the
// same way `/test/citizenwalk`'s are — which is to say ordinarily, and which is
// to say the north-west one disagrees with the straight beside it about the
// sign of its banks. See note 2.
level["1,1"] = street(Right, Bottom);
level["4,1"] = street(Left, Bottom);
level["4,3"] = street(Top, Left);
level["1,3"] = street(Top, Right);
level["2,1"] = street(Left, Right, true); // the one zebra on the board
level["3,1"] = street(Left, Right);
level["2,3"] = street(Left, Right);
level["3,3"] = street(Left, Right);
level["1,2"] = street(Top, Bottom);
level["4,2"] = street(Top, Bottom);

// The two houses inside the block. Both front the top street (a plot takes the
// street across its NORTH edge first — `accessPortOf`), so both start on the
// INNER bank and neither can reach a works without the zebra.
level["2,2"] = home();
level["3,2"] = home();

// The works directly across the road from the eastern house — the double-back.
level["3,0"] = works();
// ...and one round the bend on the west arm — the corner.
level["0,2"] = works();

export const citizencrossback: TestScenario = {
  id: "citizencrossback",
  name: "The walk back",
  description:
    "One zebra, and it is not on the way: walkers double back over it, and round a corner, without jumping.",
  modeId: "citizens",
  level,
  trains: {},
  size: { cols: 5, rows: 4 },
};
