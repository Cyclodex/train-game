import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// EDGE DEMAND — citizens and imported travellers on ONE platform (#117).
//
// A single shuttle line between a home town and a works town, exactly the
// threecities shape at its smallest. The one new thing is the dial: the home
// town's station carries `edgeDemand: 1`, so on top of the commuters the map
// explains, the platform imports the full catchment-derived schedule of
// travellers from OFF the map — the old "synthetic demand", reinterpreted, no
// longer switched off by the citizen layer's presence.
//
// What to watch:
//  1. **Two crowds, one queue.** At the west platform the morning commuters
//     (named citizens) stand in the same queue as the edge riders (anonymous,
//     arriving steadily all day). The east platform has no dial, so its crowd
//     is commuters only.
//  2. **They compete for seats.** The shuttle boards whoever is at the front;
//     an edge-heavy platform crowds the commuters the town also needs carried,
//     and the city card's Work bar pays for it.
//  3. **No double-counting.** The citizens' trips complete exactly as on a
//     board without the dial; the edge riders add deliveries on top. The old
//     per-mode XOR (citizens on ⇒ synthetic demand off) survives only as this
//     dial's default of 0.
//
// Design: docs/superpowers/specs/2026-08-21-economy-demand-convergence-design.md

// Same shuttle trick as threecities: every depot blue, the train green — a
// colour mismatch, so it bounces at each end and shuttles forever.
const DEPOT_COLOUR = "blue";
const TRAIN_COLOUR = "green";

const WEST = 0;
const EAST = 15;
const RAIL_Y = 2;
/** The dialled platform, exported for the unit test. */
export const EDGE_STATION = `3,${RAIL_Y}`;
export const PLAIN_STATION = `12,${RAIL_Y}`;

const home = (): TileCell => ({ connections: [], terrain: "urban", city: "brookfield" });
const works = (): TileCell => ({ connections: [], terrain: "industry", city: "millside" });

const level: Record<string, TileCell> = {};

// The railway: depot, straights, a station at each town, depot.
level[`${WEST},${RAIL_Y}`] = expandKind("depot", 1);
for (let x = WEST + 1; x < EAST; x++) {
  level[`${x},${RAIL_Y}`] = expandKind("straight", 1);
}
level[`${EAST},${RAIL_Y}`] = expandKind("depot", 3);
level[EDGE_STATION] = { ...expandKind("station", 1), edgeDemand: 1 };
level[PLAIN_STATION] = expandKind("station", 1);

// The towns: homes west, every job east, each block inside its station's
// walking reach (±2). The gap (x 6..9) keeps them two towns to the clustering
// and puts the nearest house five tiles from the nearest job — past the
// walking maximum, so the commute is the railway. No roads at all: with
// nothing to drive down, mode share cannot blur what the platform shows.
for (const y of [0, 1]) {
  for (let x = 1; x <= 5; x++) level[`${x},${y}`] = home();
  for (let x = 10; x <= 14; x++) level[`${x},${y}`] = works();
}

export const edgedemand: TestScenario = {
  id: "edgedemand",
  name: "Edge demand",
  description:
    "The west platform imports travellers from off-map on top of its own commuters — additive, never double-counted.",
  modeId: "citizens",
  level,
  trains: {
    shuttle: mkTrain("shuttle", WEST, RAIL_Y, "people", 3, `${EAST},${RAIL_Y}`),
  },
  colors: {
    depotColors: {
      [`${WEST},${RAIL_Y}`]: DEPOT_COLOUR,
      [`${EAST},${RAIL_Y}`]: DEPOT_COLOUR,
    },
    trainColors: { shuttle: TRAIN_COLOUR },
  },
  size: { cols: EAST + 1, rows: 3 },
};
