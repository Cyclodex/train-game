import { Position } from "@/types";
import { Level, PlotKind, TerrainKind, TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { nWayLanes, twoWay, type Lane } from "@/tiles/lanes";
import { terrainBlocksBuilding } from "@/tiles/terrain";
import { TestScenario, mkLineTrain } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// HINTERLAND — a whole valley, and four places that need each other.
//
// 35x24 tiles: three times the area of `/test/demoworld` and about five times
// the population of `/test/threecities`. It exists because the life-stages work
// needed somewhere big enough for a day to actually LOOK like a day — a village
// of thirty people has the right shape of clock and not enough traffic to see it.
//
// The valley, and why each place is where it is:
//
//   MARKTSTADT (west)  the big village. Two railway corridors run through it —
//                      the main line at x=4 and the branch at x=10 — because the
//                      walking reach of a platform is two tiles, so a town wider
//                      than five tiles needs a second station or it is not a town,
//                      it is a ribbon. Between them the two corridors reach every
//                      house column: x=2, 6, 8 and 12 are each EXACTLY two tiles
//                      from one. The only column out of reach of both is x=7, the
//                      middle street, and nobody lives on a street. (A platform's
//                      reach is a 5x5 box, not a column, so the last two rows of
//                      the eastern columns — (8,16-17) and (12,16-17) — do fall
//                      outside one; the main line's three calls cover x=2 and x=6
//                      end to end.) The pedestrian core is the x=8 column — the
//                      school, the café and a shop — and it sits two tiles from
//                      the branch on purpose, which is what makes the school
//                      reachable by a child with no car (see the ZONES note).
//   NORDHEIM (north)   houses and a shop. NO ROAD AT ALL.
//   WERK OST (east)    the heavy industry, where most of the valley's jobs are.
//                      NO ROAD AT ALL.
//   SÜDAU (south)      houses and a shop, and the ONE place a road reaches.
//
// The road is the lever, exactly as it is on `/test/threecities`: a street round
// Marktstadt and down to Südau, and nothing else. So a Südau resident may drive
// to the shops in Marktstadt — and a Nordheim resident going to work at Werk Ost
// has the railway or has nothing. `roadComponents` in tiles/cities.ts is what
// makes that a fact rather than a decoration.
//
// The road loop is CLOSED, so `roadEntries` is empty and no ambient traffic can
// spawn: every vehicle on this board belongs to somebody who lives here.
//
// What to watch, with the HUD clock running:
//  1. **06:30** vans out of Marktstadt before anyone else is up.
//  2. **07:30** the school run — Nordheim's and Südau's children on the train to
//     Marktstadt, because Marktstadt has the only school in the valley.
//  3. **08:00** the commute proper, most of it eastbound to Werk Ost.
//  4. **09:30** the retired, daily, to the only café in the valley.
//  5. **12:30** the children home again. The counter-peak.
//  6. **13:30** the afternoon shift, and the second round of call-outs.
//  7. **21:30** the shift ends and the board is STILL not empty.
//
// THE BOARD OPENS OVER-POPULATED FOR ITS RAILWAY, and that is the game rather
// than a bug. Measured over six in-game days, untouched, nobody playing:
//
//   day | people | abandoned/day | Nordheim | Marktstadt | Südau
//     1 |    291 |            59 |     0.08 |       0.47 |  0.88
//     3 |    272 |           100 |     0.50 |       0.37 |  0.76
//     4 |    251 |            71 |     0.42 |       0.53 |  0.32
//     6 |    282 |            57 |     0.73 |       0.60 |  0.60
//
// It falls, bottoms out on day four at the level its network can actually
// carry, and then ALL THREE villages grow again with their happiness. Raising
// that ceiling — another service, another platform, a road where there is none —
// is the whole job. What the player must never see is the other curve: a valley
// that falls and keeps falling, which is what this board did before each village
// had work of its own and a café of its own.
//
// THE MARKTSTADT GRIDLOCK, AND WHAT IT ACTUALLY WAS (fixed 2026-08-21).
//
// The village used to deadlock — not slow down, DEADLOCK. Measured over six
// headless days: 42 of the 46 cars on the board standing at a dead stop, one of
// them for 354 unbroken seconds; 35 journeys a day ending "given up on after
// 9h 36m", which is exactly `maxWaitSec * 2`, the give-up clock for a driver
// whose car never arrives; car mode share falling 0.20 → 0.11 as the survivors
// gave up on driving; and Marktstadt's Work bar pinned at 0.00-0.08 while
// Nordheim recovered to 0.77 and Südau to 0.50.
//
// The earlier note in this file blamed `deriveWorkplaceParking`. That was wrong,
// and the way it was wrong is worth keeping: THIS BOARD HAS NO DERIVED PARKING
// AT ALL. The pass is applied in a scenario's own data (`workparking`,
// `homeparking` call it; nothing calls it here), so the 17 kerbside bays it
// WOULD lay were never on the board the measurements came from. The jam was the
// street plan on its own.
//
// What it really was: five streets thirteen rows long, single file each way,
// with a junction only at each END and nothing in between. So every trip across
// the village was a lap of the whole ladder, and when a queue reached back into
// a junction box it blocked the very stream that would have let it out. A cycle
// of full tiles has no head to move first. Nothing clears it; the cars are there
// for the rest of the run. (An earlier draft of this note named
// `BOX_KEEP_CLEAR_PATIENCE` as what closes the ring. Measured false — disabling
// the valve outright reproduces the knot bit for bit — so read the mechanism
// named below instead.)
//
// The fix is two changes to the plan, both below, and it needs BOTH — measured
// on the road layer alone, a steady fleet of 40 village journeys over 900s:
//
//   layout                                | arrived | gave up | frozen at end
//   the old ladder                        |     436 |      88 |   40 of 40
//   + a middle rung at y=10               |     887 |      44 |   40 of 40
//   + two lanes each way, no middle rung  |     649 |      80 |   40 of 40
//   + both (what ships)                   |    2797 |       0 |    0 of 40
//
// CORRECTION (2026-08-21, the seed-11 investigation, re-swept when the guard
// moved). The shipped row above is a per-seed fact, not a guarantee. At a
// CONSTANT 40 concurrent journeys the shipped layout still gridlocks
// permanently on most seeds — re-probed over two independent trip streams x
// seeds 1..12, only 4 of those 24 runs come through clean — and WHICH seeds
// freeze re-rolls on any change to the sim's dynamics: an unrelated constants
// retune (PR #98, CLIP_LANES) is what turned the guard's seed 11 red without
// touching a single road rule. The load is the point — a constant 40 holds the
// village PAST its stable capacity for the entire run, which the citizens
// board's bursty demand never does. The clean envelope ends between 24 and 30:
// at a constant 24 all 40 probed runs come through (arrived 887-967, zero
// give-ups, longest stand 24.25s), while at 30 two of six seeds already stand
// for 350s. 24 is the load the guard drives.
//
// The table's ABSOLUTE numbers are pre-#98 as well and no longer reproduce —
// re-run today the shipped plan lands 1345-1406 at load 40 on the seeds it
// survives, not 2797. Read the rows against each other, never the values on
// their own.
//
// AND WHAT THE GUARD ASSERTS AT 24 IS THROUGHPUT. Freeze-freedom on its own
// cannot carry the claim: at any load both plans survive, NEITHER freezes. What
// separates them on every seed is how much the streets CARRY — at a constant 24
// the shipped plan lands 887-967 journeys per 900s where the old ladder never
// once clears 700 (192-674 over twelve runs, jamming on a third of them). The
// freeze checks stay as the backstop, not as the evidence.
//
// The residual supercritical knot is NOT the ladder mechanism above, and NOT
// the box patience valve (disabling `BOX_KEEP_CLEAR_PATIENCE` outright
// reproduces the seed-11 knot bit for bit). It lives where the rung crosses
// the branch line: a LEVEL CROSSING directly between two junction boxes —
// box (9,10), crossing (10,10), box (11,10). The rail-crossing keep-clear
// ("never rest straddling the rails", road.ts) has no patience valve and
// demands room past the crossing's far edge, so it couples the two boxes into
// one mutual-exclusion zone; two opposing streams and one turner close a
// wait-cycle through it in which every hold is locally correct: eastbound
// cars inside box (9,10) wait for room past the crossing; that room is held
// by cars the arbiter refuses at box (11,10) because the box is full; the box
// is full of cars following a westbound turner pinned off the rails whose
// turn conflicts with the eastbound cars inside box (9,10). The same trap is
// authored at (3..5,10) over the main line. Retracting the rung to x=5..9 (no
// crossings, T junctions) measured WORSE — 11 of 20 seeds frozen, throughput
// down everywhere — the rung's connectivity outweighs its trap. Raising this
// ceiling needs a sim mechanism (spillback control / wait-cycle resolution),
// not another street.
//
// and end to end on the citizens board, six days at `secPerDay: 900`:
//
//   Marktstadt commute | before 0.24 0.00 0.06 0.04 0.01 0.08
//                      | after  0.47 0.37 0.37 0.53 0.36 0.60
//   abandoned/day      | before 56 120 155 121 86 67 → after 59 71 100 71 52 57
//   car mode share     | before 0.20 → 0.11          → after 0.20 → 0.22
//   Marktstadt on day 6| before 94 people            → after 129
//
// What is LEFT is the board's own difficulty and not a jam: the give-ups that
// remain read "5h 08m", the RAIL patience clock (`maxWaitSec`), not the car one.
// This valley is over-populated for its railway on purpose — see above.
// `tests/unit/levels/hinterlandTraffic.spec.ts` is the guard, and it fails on the
// old plan. `/test/citizenday` was never affected either way (zero abandoned
// trips, commute 0.89-0.96, before and after).
//
// Playable at /#/play?mode=citizens&board=hinterland.

const COLS = 35;
const ROWS = 24;

// --- the railway ---------------------------------------------------------------

const RING_LEFT = 4;
const RING_RIGHT = 31;
const RING_TOP = 3;
const RING_BOTTOM = 20;

// The branch that gives Marktstadt its second corridor. It runs ALL THE WAY
// THROUGH, top edge to bottom edge, so the railway is a theta rather than a ring
// with a stub — and that is an operating decision, not a shape.
//
// A dead-end branch has to be reversed out of, and a train reversing onto track
// another train is running down is how a single-track network deadlocks. Through
// it, every service on this board runs one way round and never turns back.
const BRANCH_X = 10;
const BRANCH_TOP = 4;
const BRANCH_END = 19; // the last straight before the bottom edge

// Where the platforms are. A station may only sit on a plain straight, never on a
// curve, a junction or a crossing.
const STATIONS: Record<string, string> = {
  [`${RING_LEFT},7`]: "Marktstadt West",
  [`${RING_LEFT},11`]: "Marktstadt Mitte",
  [`${RING_LEFT},15`]: "Marktstadt Süd",
  [`${BRANCH_X},8`]: "Markt",
  [`${BRANCH_X},13`]: "Marktstadt Ost",
  [`20,${RING_TOP}`]: "Nordheim",
  [`25,${RING_TOP}`]: "Nordheim Ost",
  [`${RING_RIGHT},10`]: "Werk Ost",
  [`${RING_RIGHT},14`]: "Werk Süd",
  [`19,${RING_BOTTOM}`]: "Südau",
  [`24,${RING_BOTTOM}`]: "Südau Ost",
};

// Depot spurs: the junction on the ring, the straight that leaves it, and the
// shed at the end. One per service, because a depot holds one train.
// `dRot` is which way the shed OPENS: 0 top, 1 right, 2 bottom, 3 left.
const SPURS = [
  { junction: `8,${RING_TOP}`, jRot: 0, link: "8,2", lRot: 0, depot: "8,1", dRot: 2 },
  { junction: `16,${RING_TOP}`, jRot: 0, link: "16,2", lRot: 0, depot: "16,1", dRot: 2 },
  { junction: `27,${RING_BOTTOM}`, jRot: 0, link: "27,19", lRot: 0, depot: "27,18", dRot: 2 },
  { junction: `${RING_RIGHT},17`, jRot: 3, link: "30,17", lRot: 1, depot: "29,17", dRot: 1 },
] as const;

// The ring's platforms, CLOCKWISE — top edge west to east, down the right, back
// west along the bottom, up the left. Every service below is a rotation of this
// list, so every train runs the same way round and two of them can never meet.
const RING_LINE = [
  `20,${RING_TOP}`,
  `25,${RING_TOP}`,
  `${RING_RIGHT},10`,
  `${RING_RIGHT},14`,
  `24,${RING_BOTTOM}`,
  `19,${RING_BOTTOM}`,
  `${RING_LEFT},15`,
  `${RING_LEFT},11`,
  `${RING_LEFT},7`,
];

/** The same circuit, entered from wherever a shed happens to sit. */
function rotate(line: string[], first: string): string[] {
  const i = line.indexOf(first);
  return [...line.slice(i), ...line.slice(0, i)];
}

const fromStop = (first: string) => rotate(RING_LINE, first);

// The MARKTSTADT service: up the branch through the middle of the village, then
// round the outer ring's eastern half. Same rotational sense as the ring trains
// on every metre of track it shares with them — north up the branch matches
// north up the left edge, which is why this can share the top and bottom edges
// with three other services and never face one.
const BRANCH_LINE = [
  `${BRANCH_X},8`,
  `20,${RING_TOP}`,
  `25,${RING_TOP}`,
  `${RING_RIGHT},10`,
  `${RING_RIGHT},14`,
  `24,${RING_BOTTOM}`,
  `19,${RING_BOTTOM}`,
  `${BRANCH_X},13`,
];

// Signals are block boundaries: a train reserves the whole route to the next one,
// so with too few of them one train locks most of the circuit and holds every
// level crossing on it shut until it is round.
const SIGNALS: [string, Position[]][] = [
  [`6,${RING_TOP}`, [Right, Left]],
  [`13,${RING_TOP}`, [Right, Left]],
  [`29,${RING_TOP}`, [Right, Left]],
  [`8,${RING_BOTTOM}`, [Right, Left]],
  [`14,${RING_BOTTOM}`, [Right, Left]],
  [`29,${RING_BOTTOM}`, [Right, Left]],
  [`${RING_LEFT},9`, [Top, Bottom]],
  [`${RING_LEFT},17`, [Top, Bottom]],
  [`${RING_RIGHT},7`, [Top, Bottom]],
  [`${RING_RIGHT},12`, [Top, Bottom]],
];

// --- the roads -----------------------------------------------------------------
//
// Listed as COORDINATES, not as lanes. Which lanes a tile carries is derived
// below from which of its four neighbours are also road — so a corner, a T and a
// crossroads all fall out of the same rule and none of them can be authored
// wrong. (Hand-writing `twoWay(L,R) + twoWay(T,B)` at a crossroads makes a
// junction nobody can turn at; deriving it cannot.)
function roadTiles(): Set<string> {
  const road = new Set<string>();
  const run = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) road.add(`${x},${y}`);
  };
  // Marktstadt's ladder: five streets alternating with the four house columns,
  // rungs top, middle and bottom.
  // THE COLUMN PATTERN IS THE DESIGN. Reading x=2 to x=12:
  //
  //   house(2) road(3) RAIL(4) road(5) house(6) road(7) house(8) road(9)
  //   RAIL(10) road(11) house(12)
  //
  // so every column of houses is one tile from a carriageway — that is what a
  // driveway is — AND exactly two from a platform.
  //
  // Both halves of that were learned the hard way. Without the middle streets,
  // the village centre was five tiles from its outer houses — one more than
  // anybody walks — and the school was simply unreachable: 330 refused journeys a
  // day on a board that looked fine. And a house column three tiles from BOTH
  // railway corridors strands everyone in it who does not own a car: no walk, no
  // car, no station in reach, so every trip out of the village is refused. That
  // is what the red Connection bar on the city card means, and it is why the village
  // is exactly as wide as its two lines can serve and not one column wider.
  run(3, 5, 3, 22); // the long west street, carrying on south to Südau
  run(5, 5, 5, 18);
  run(7, 5, 7, 18);
  run(9, 5, 9, 18);
  run(11, 5, 11, 18);
  run(3, 5, 11, 5);
  // THE MIDDLE RUNG, and it is what keeps the village moving (2026-08-21).
  //
  // With rungs only at y=5 and y=18 the five streets were a ladder thirteen rows
  // long with a junction at each END and nothing in between, so EVERY trip across
  // the village — even two doors up the next street — was a full lap of it. The
  // queues that made met head to head in the junction boxes at the ends and the
  // whole town centre deadlocked (see the note at the top of this file).
  //
  // y=10 is the BEST row, not the only one. A rung has to miss both railways'
  // platforms (x=4 calls at y=7/11/15, x=10 at y=8/13), the two block signals at
  // (4,9) and (4,17), and every zoned plot INSIDE ITS OWN SPAN (the school at
  // 8,8, the shop at 6,11, the café at 8,12, the shop at 8,15). Four rows
  // between the existing rungs survive all three: 6, 10, 14 and 16.
  //
  // A rung is worth most in the middle, and the middle rows are exactly the
  // blocked ones — y=11 carries a platform and a shop, y=12 the café. y=10 is
  // the closest a rung gets: it splits the thirteen rows 5/8, where y=14 splits
  // them 9/4 and y=6 and y=16 sit one and two rows off an existing rung and so
  // split almost nothing.
  //
  // It lays four new road tiles. (4,10) and (10,10) fall on the two rail columns
  // and become LEVEL CROSSINGS; only (6,10) and (8,10) are a cost — one plot out
  // of each of those two twelve-plot columns, so TWO in all. (2,10) and (12,10)
  // lie outside the rung's x=3..11 span and stay plots. Counting every new road
  // tile as a lost plot is the easy mistake; half of them are rail.
  run(3, 10, 11, 10);
  run(3, 18, 23, 18); // the rung that becomes the road east to Südau
  // The southern loop: down the west street, along the bottom, back up at x=23.
  run(3, 22, 23, 22);
  run(23, 18, 23, 22);
  return road;
}

const STEP: Record<number, [number, number]> = {
  [Top]: [0, -1],
  [Right]: [1, 0],
  [Bottom]: [0, 1],
  [Left]: [-1, 0],
};

// MARKTSTADT'S STREETS ARE TWO LANES EACH WAY; the valley's lanes are one.
//
// The village is the only place on this board with enough traffic to queue, and a
// single file each way has no slack at all: one car waiting to turn stops the
// street behind it, the queue backs into the junction box at the end, and the
// stream it blocks there is the one that would have let it out. That is a
// deadlock, not congestion — it never clears (measured: 42 of 46 cars standing
// still for the rest of the run). A second lane gives a blocked movement
// somewhere to be while the other one goes.
//
// The zone is exactly the ladder: x=3..11, y=5..18. Its only two boundaries with
// the single-lane valley roads — (3,18) toward Südau and (11,18) toward the east
// — are BOTH junctions, which is the rule a width change has to obey: a junction
// fans and merges unequal arms by design, a plain straight or bend has to keep
// its neighbour's lane count or the seam is an authoring error the renderer
// paints red (`seamMismatch` in tiles/lanes.ts).
const WIDE = { x0: 3, x1: 11, y0: 5, y1: 18 };
const isTownStreet = (x: number, y: number) =>
  x >= WIDE.x0 && x <= WIDE.x1 && y >= WIDE.y0 && y <= WIDE.y1;

function lanesFor(id: string, road: Set<string>): Lane[] {
  const [x, y] = id.split(",").map(Number);
  const arms = [Top, Right, Bottom, Left].filter(p => {
    const [dx, dy] = STEP[p];
    return road.has(`${x + dx},${y + dy}`);
  });
  const width = isTownStreet(x, y) ? 2 : 1;
  if (arms.length === 2) {
    return width === 1 ? twoWay(arms[0], arms[1]) : nWayLanes(arms[0], arms[1], width);
  }
  // A real junction: every arm reaches every OTHER arm, so a car may turn as well
  // as go straight. Two arms is a straight or a bend; one would be a dead end,
  // which this closed network does not have.
  return arms.flatMap(from => {
    const to = arms.filter(p => p !== from);
    return Array.from({ length: width }, (_, index) => ({ from, to, index }));
  });
}

// --- the settlements -----------------------------------------------------------

interface Block {
  city: string;
  /** Plot columns (x) or rows (y) — whichever the town runs along. */
  cells: string[];
  industrial?: boolean;
}

const rect = (x0: number, y0: number, x1: number, y1: number): string[] => {
  const out: string[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(`${x},${y}`);
  return out;
};

const col = (x: number, y0: number, y1: number) => rect(x, y0, x, y1);
const row = (y: number, x0: number, x1: number) => rect(x0, y, x1, y);

// MARKTSTADT. Plot columns only — 3, 5, 7, 9 and 11 are streets and 4 and 10
// are railway.
//
// The works at the top of x=13 is DELIBERATELY SMALL. A village that can employ
// itself never boards a train: the first draft gave Marktstadt twelve industrial
// plots, `assignJob` handed every resident a job three tiles from their door, and
// the railway this whole valley is built around carried 7% of journeys. Three
// plots employ a fraction of the village; the rest commute east to Werk Ost,
// which has no road to it.
const MARKT_Y0 = 6;
const MARKT_Y1 = 17;
const BLOCKS: Block[] = [
  { city: "marktstadt", cells: col(2, MARKT_Y0, MARKT_Y1) },
  { city: "marktstadt", cells: col(6, MARKT_Y0, MARKT_Y1) },
  { city: "marktstadt", cells: col(8, MARKT_Y0, MARKT_Y1) },
  { city: "marktstadt", cells: col(12, MARKT_Y0, MARKT_Y0 + 2), industrial: true },
  { city: "marktstadt", cells: col(12, MARKT_Y0 + 3, MARKT_Y1) },
  // A SMALL WORKS IN EACH VILLAGE, laid before the houses so it wins the cells.
  //
  // Measured, and the most important number on the board: as pure dormitories
  // with every job an hour's ride away, Nordheim and Südau lost HALF their people
  // in six days — not because the railway was broken but because every single
  // resident depended on it for every single day. Two industrial plots employ
  // about half of Nordheim; the other half still commute to Werk Ost, which is
  // the traffic this valley is for. A village needs a reason to stay as well as a
  // reason to travel.
  { city: "nordheim", cells: [...col(26, 1, 2), ...col(26, 4, 5)], industrial: true },
  { city: "suedau", cells: ["17,19"], industrial: true },
  // NORDHEIM, either side of the ring's top edge. Nine tiles from Marktstadt's
  // last house — more than anybody walks — and not a metre of road.
  { city: "nordheim", cells: [...row(1, 18, 26), ...row(2, 18, 26)] },
  { city: "nordheim", cells: [...row(4, 18, 26), ...row(5, 18, 26)] },
  // SÜDAU, either side of the ring's bottom edge, with the road from Marktstadt
  // running along both sides of it.
  { city: "suedau", cells: row(19, 17, 24) },
  { city: "suedau", cells: row(21, 17, 24) },
  // WERK OST. The valley's heavy industry, on the far side of the ring, reachable
  // by rail alone — which is what makes the eastbound commute the board's spine.
  { city: "werkost", cells: col(29, 10, 14), industrial: true },
  { city: "werkost", cells: col(30, 10, 14), industrial: true },
  { city: "werkost", cells: col(32, 10, 14), industrial: true },
  { city: "werkost", cells: col(33, 10, 14), industrial: true },
];

// The buildings no terrain can describe.
//
// THE SCHOOL IS THE ONLY ONE IN THE VALLEY, and that is the board's story: at
// half past seven Nordheim's and Südau's children are on a train to Marktstadt,
// and at half past twelve they are on one home — the counter-peak, in the hour
// every other kind of traffic leaves empty.
//
// It stands two tiles from the branch line, which is not decoration: a child has
// no car, so a school out of walking reach of a platform is a school every child
// outside Marktstadt is refused every morning for ever.
//
// EVERY VILLAGE HAS ITS OWN CAFÉ, and that one is measured. With a single café
// in Marktstadt, every retired resident of Nordheim rode three quarters of the
// ring for a coffee EVERY DAY, gave up somewhere along it, and the village fell
// from 136 people to 32 in six days. A daily trip must be a local trip; the
// scarce thing has to be the one people make twice a week, not twice a day.
const ZONES: Record<string, PlotKind> = {
  "8,8": "school",
  "8,12": "leisure",
  "8,15": "shop",
  "6,11": "shop",
  "2,9": "shop",
  "12,14": "shop",
  "22,2": "shop", // Nordheim
  "24,4": "leisure",
  "20,21": "shop", // Südau
  "18,21": "leisure",
};

// --- ground --------------------------------------------------------------------
//
// Painted from AREAS, last, so it can see everything that was built and yield to
// it: `patchPath` fuses adjacent same-kind cells into one outline, so a body of
// ground reads as a lake and scattered cells read as confetti. Blocking ground
// (water, rock, mountain) is skipped wherever a line or a street already runs, so
// the level's topology is untouched by any of this.
const GROUND: { kind: TerrainKind; cells: string[] }[] = [
  { kind: "mountain", cells: [...rect(0, 0, 1, 3), ...rect(32, 0, 34, 2)] },
  { kind: "forest", cells: [...rect(26, 4, 30, 8), ...rect(5, 20, 9, 23)] },
  { kind: "forest", cells: rect(14, 6, 15, 16) },
  // The tarn in the middle of the ring: the reason the valley's four places sit
  // round the edge of it rather than in the middle.
  { kind: "water", cells: rect(17, 8, 24, 14) },
  { kind: "rock", cells: [...rect(28, 21, 31, 23), ...rect(0, 20, 1, 23)] },
  {
    kind: "farmland",
    cells: [
      ...rect(16, 6, 27, 7),
      ...rect(16, 15, 27, 17),
      ...rect(25, 9, 27, 14),
      ...rect(10, 19, 22, 20),
      ...rect(24, 19, 27, 20),
      ...rect(2, 0, 17, 0),
      ...rect(27, 0, 31, 2),
      ...rect(0, 4, 2, 5),
      ...rect(0, 18, 2, 19),
    ],
  },
];

// --- build ---------------------------------------------------------------------

function build(): Level {
  const level: Level = {};
  const road = roadTiles();
  const spurJunctions = new Set<string>(SPURS.map(s => s.junction));

  const railAt = (id: string, cell: TileCell) => {
    // A rail tile that a street also crosses is a LEVEL CROSSING: it keeps its
    // rails and gains the road layer. Derived here rather than listed, so moving
    // a street can never leave a crossing behind or forget to make one.
    level[id] = road.has(id) ? { ...cell, road: lanesFor(id, road) } : cell;
  };

  // Ring corners.
  level[`${RING_LEFT},${RING_TOP}`] = expandKind("curve", 1);
  level[`${RING_RIGHT},${RING_TOP}`] = expandKind("curve", 2);
  level[`${RING_RIGHT},${RING_BOTTOM}`] = expandKind("curve", 3);
  level[`${RING_LEFT},${RING_BOTTOM}`] = expandKind("curve", 0);

  // Horizontal runs.
  for (let x = RING_LEFT + 1; x < RING_RIGHT; x++) {
    for (const y of [RING_TOP, RING_BOTTOM]) {
      const id = `${x},${y}`;
      if (x === BRANCH_X) continue; // the branch's two junctions
      if (spurJunctions.has(id)) continue;
      const name = STATIONS[id];
      railAt(id, name ? { ...expandKind("station", 1), stationName: name } : expandKind("straight", 1));
    }
  }
  // Vertical runs.
  for (let y = RING_TOP + 1; y < RING_BOTTOM; y++) {
    for (const x of [RING_LEFT, RING_RIGHT]) {
      const id = `${x},${y}`;
      if (spurJunctions.has(id)) continue;
      const name = STATIONS[id];
      railAt(id, name ? { ...expandKind("station", 0), stationName: name } : expandKind("straight", 0));
    }
  }

  // The branch, joining both edges of the ring: a theta, not a stub.
  level[`${BRANCH_X},${RING_TOP}`] = expandKind("tjunction", 2);
  level[`${BRANCH_X},${RING_BOTTOM}`] = expandKind("tjunction", 0);
  for (let y = BRANCH_TOP; y <= BRANCH_END; y++) {
    const id = `${BRANCH_X},${y}`;
    const name = STATIONS[id];
    railAt(id, name ? { ...expandKind("station", 0), stationName: name } : expandKind("straight", 0));
  }

  // Depot spurs off the ring.
  for (const s of SPURS) {
    level[s.junction] = expandKind("tjunction", s.jRot);
    level[s.link] = expandKind("straight", s.lRot);
    level[s.depot] = expandKind("depot", s.dRot);
  }

  // Signals, only ever onto a plain straight.
  for (const [id, ports] of SIGNALS) {
    const cell = level[id];
    if (cell && !cell.road && cell.role === undefined) level[id] = { ...cell, signals: ports };
  }

  // Streets, onto every road tile the railway has not already claimed (those are
  // the crossings, authored above).
  for (const id of road) {
    if (level[id]) continue;
    level[id] = { connections: [], road: lanesFor(id, road), terrain: "urban" };
  }

  // The settlements.
  for (const block of BLOCKS) {
    for (const id of block.cells) {
      if (level[id]) continue; // never over a railway or a street
      level[id] = {
        connections: [],
        terrain: block.industrial ? "industry" : "urban",
        city: block.city,
        ...(ZONES[id] ? { zone: ZONES[id] } : {}),
      };
    }
  }

  // Ground, last of all.
  for (const { kind, cells } of GROUND) {
    for (const id of cells) {
      const cell = level[id];
      if (cell?.terrain) continue; // a town's own ground wins
      const built = !!cell && (cell.connections.length > 0 || (cell.road?.length ?? 0) > 0);
      if (built && terrainBlocksBuilding(kind)) continue;
      level[id] = cell ? { ...cell, terrain: kind } : { connections: [], terrain: kind };
    }
  }

  return level;
}

const level = build();

export const hinterland: TestScenario = {
  id: "hinterland",
  name: "Hinterland (a whole valley)",
  description:
    "35x24: a big village with the valley's only school and café, two neighbours with neither, and the works everyone commutes to — reachable by rail alone.",
  modeId: "citizens",
  level,
  trains: {
    // FOUR SERVICES, each ordered from its own shed and then in service for
    // ever: a depot is where a train came from, not somewhere it is going.
    //
    // FOUR SERVICES OF TEN WAGONS, and both numbers were measured rather than
    // picked. A wagon seats `PASSENGERS_PER_WAGON` = 6, so this is 240 seats
    // against a valley of ~370 people, a good third of whom cross it twice a day.
    //
    //   3 trains x 4 wagons   transit  17% of journeys,  438 abandoned
    //   4 trains x 6 wagons   transit  36% of journeys,  473 abandoned
    //   6 trains x 8 wagons   transit   4% of journeys,  381 abandoned  <- worse
    //   4 trains x 10 wagons  the shipped board
    //
    // The six-train row is the interesting one and it is a warning worth leaving
    // in the file: PAST A POINT, MORE TRAINS MAKE A RAILWAY CARRY LESS. Six
    // services on a single-track theta spend their time holding each other at
    // signals, so the line went from carrying a third of the valley to carrying
    // almost none of it. Longer trains cost nothing at a junction; extra trains
    // cost a block each.
    // THREE ON THE OUTER RING, ONE THROUGH THE MIDDLE. Putting a second train on
    // the branch route sounded obviously better and measured far worse: the two
    // of them spent the day holding each other at the branch's junctions, the
    // railway's share fell from 38% of journeys to 10%, and a six-day run took
    // seven times as long to simulate. On single track, a service is a block.
    nord: mkLineTrain("nord", 8, 1, "people", 10, fromStop(`20,${RING_TOP}`)),
    sued: mkLineTrain("sued", 27, 18, "people", 10, fromStop(`24,${RING_BOTTOM}`)),
    ost: mkLineTrain("ost", 29, 17, "people", 10, fromStop(`${RING_LEFT},15`)),
    markt: mkLineTrain("markt", 16, 1, "people", 10, BRANCH_LINE),
  },
  colors: {
    depotColors: { "8,1": "blue", "16,1": "blue", "27,18": "blue", "29,17": "blue" },
    trainColors: { nord: "green", markt: "green", sued: "green", ost: "green" },
  },
  size: { cols: COLS, rows: ROWS },
};
