import { Position } from "@/types";
import { twoWay } from "@/tiles/lanes";
import { PlotKind, TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// A DAY IN A VILLAGE — every life stage, in one place.
//
// Two villages either side of a single railway, with a ring road round the whole
// board. Lindenau has the works yard, the school and the only café; Bergdorf has
// houses and a shop and nothing else. That asymmetry is the board: everything
// Bergdorf's residents want to DO is one railway journey away, and they want to
// do it at five different times of day.
//
// What to watch — the clock in the HUD, and the "travelling" counter beside it:
//
//  | ~06:30 | tradespeople leave for the yard, before anybody else is up   |
//  | ~07:30 | the school run: children to Lindenau, ahead of the commuters |
//  | ~08:00 | the morning peak proper                                      |
//  | ~09:30 | the retired go for coffee — DAILY, not every other day       |
//  | ~09:00 · 13:30 | call-outs: vans out to a different address each day  |
//  | ~12:30 | the children come home. The counter-peak, and the only one   |
//  | ~13:30 | the shift starts                                             |
//  | ~17:00 | the evening peak                                             |
//  | ~21:30 | the shift ends, and the board is still not empty             |
//
// The point of the board is the middle of that table. Measured here — busiest
// "travelling" count per in-game hour, same map, same seed, only the stage mix
// changed:
//
//   hour        06  07  08  09  10  11  12  13  14  15  16  17  18  19  20  21
//   all workers  0  26  30  30  14  10   8   3   0   0  26  32  34  33  27   7
//   life stages  6  18  25  27  16  12  14  17  17  14  25  32  31  21  14  13
//
// At two and three in the afternoon this board used to be EMPTY. The peaks are
// barely touched: it is not more people, it is the same people spread over the
// hours they would really use.
//
// Deliberately no level crossing — the ring road never meets the line. Crossings
// have their own board (`/test/citizenrail`); this one is about the CLOCK, and a
// closed ring means no ambient traffic can spawn, so every car you see is a
// resident going somewhere.

const WEST = 0;
const EAST = 15;
const RAIL_Y = 2;
const NORTH_Y = 0;
const SOUTH_Y = 4;
const ROAD_N = 1;
const ROAD_S = 3;

const LINDENAU = [1, 2, 3, 4, 5];
const BERGDORF = [10, 11, 12, 13, 14];
// Five tiles between the nearest pair of houses — one more than anybody will
// walk (`walkMaxTiles: 4` in Citizens mode). Close the gap and the board stops
// being about the railway, exactly as it would on `/test/threecities`.

const level: Record<string, TileCell> = {};

// --- the plots ---------------------------------------------------------------

// `zone` states outright what no terrain can say. Everything else is derived the
// way it always was: urban ground is houses, industrial ground is the yard.
const plot = (city: string, zone?: PlotKind, industrial = false): TileCell => ({
  connections: [],
  terrain: industrial ? "industry" : "urban",
  city,
  ...(zone ? { zone } : {}),
});

// Lindenau: the school beside the station, because a school on the far side of a
// village is a school nobody's children can reach.
level[`${LINDENAU[0]},${NORTH_Y}`] = plot("lindenau");
level[`${LINDENAU[1]},${NORTH_Y}`] = plot("lindenau");
level[`${LINDENAU[2]},${NORTH_Y}`] = plot("lindenau", "school");
level[`${LINDENAU[3]},${NORTH_Y}`] = plot("lindenau");
level[`${LINDENAU[4]},${NORTH_Y}`] = plot("lindenau");
level[`${LINDENAU[0]},${SOUTH_Y}`] = plot("lindenau", "shop");
level[`${LINDENAU[1]},${SOUTH_Y}`] = plot("lindenau", "leisure");
for (const x of LINDENAU.slice(2)) level[`${x},${SOUTH_Y}`] = plot("lindenau", undefined, true);

// Bergdorf: houses and a shop. No yard, no school, no café — so its workers, its
// children and its retired all have somewhere to be that is not here, which is
// three different reasons to run a train and three different times of day.
for (const x of BERGDORF) level[`${x},${NORTH_Y}`] = plot("bergdorf");
for (const x of BERGDORF) {
  level[`${x},${SOUTH_Y}`] = plot("bergdorf", x === BERGDORF[2] ? "shop" : undefined);
}

// --- the railway -------------------------------------------------------------
//
// One line, one shuttle. Both depots are blue and the train is green: a colour
// MISMATCH, so it bounces out of whichever depot it reaches and runs back — the
// endless service an endless mode needs (the same trick `/test/threecities` uses).
const DEPOT_W = WEST + 1;
const DEPOT_E = EAST - 1;
const STATIONS: Record<number, string> = { 3: "Lindenau", 12: "Bergdorf" };

level[`${DEPOT_W},${RAIL_Y}`] = expandKind("depot", 1);
level[`${DEPOT_E},${RAIL_Y}`] = expandKind("depot", 3);
for (let x = DEPOT_W + 1; x < DEPOT_E; x++) {
  const name = STATIONS[x];
  level[`${x},${RAIL_Y}`] = name
    ? { ...expandKind("station", 1), stationName: name }
    : expandKind("straight", 1);
}

// --- the ring road -----------------------------------------------------------
//
// Two streets, one either side of the line, joined round both ends. CLOSED on
// purpose: `roadEntries` is empty, so the ambient traffic generator has nowhere
// to spawn and every vehicle on the board belongs to somebody who lives here.
//
// Both plot rows are exactly one tile from a carriageway (a driveway) and two
// from the platform (inside `WALK_RADIUS_TILES`), which is what makes walking,
// driving and the train all genuinely available to everybody. Move a row and one
// of the three quietly stops existing.
const street = (from: Position, to: Position): TileCell => ({
  connections: [],
  road: twoWay(from, to),
  terrain: "urban",
});

level[`${WEST},${ROAD_N}`] = street(Right, Bottom);
level[`${EAST},${ROAD_N}`] = street(Left, Bottom);
level[`${WEST},${ROAD_S}`] = street(Top, Right);
level[`${EAST},${ROAD_S}`] = street(Top, Left);
level[`${WEST},${RAIL_Y}`] = street(Top, Bottom);
level[`${EAST},${RAIL_Y}`] = street(Top, Bottom);
for (let x = WEST + 1; x < EAST; x++) {
  level[`${x},${ROAD_N}`] = street(Left, Right);
  level[`${x},${ROAD_S}`] = street(Left, Right);
}

export const citizenday: TestScenario = {
  id: "citizenday",
  name: "A day in a village",
  description:
    "Five lives on one board: the school run, the trades round, the shift, the café and the commute — and a clock that is never empty.",
  modeId: "citizens",
  level,
  trains: {
    shuttle: mkTrain("shuttle", DEPOT_W, RAIL_Y, "people", 3, `${DEPOT_E},${RAIL_Y}`),
  },
  colors: {
    depotColors: {
      [`${DEPOT_W},${RAIL_Y}`]: "blue",
      [`${DEPOT_E},${RAIL_Y}`]: "blue",
    },
    trainColors: { shuttle: "green" },
  },
  size: { cols: 16, rows: 5 },
};
