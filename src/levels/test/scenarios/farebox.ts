import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// THE FAREBOX — passengers pay (economy convergence phase 2).
//
// A network-mode shuttle between two towns, and the one new thing on screen is
// the money line: every passenger set down at their stop pays a fare — a $2
// flag fall plus $3 a tile of journey — booked the moment the transit layer
// counts the delivery, so the balance and the passenger counter move together.
//
// What to watch:
//  1. **The balance ticks with the deliveries.** Each time the shuttle sets a
//     crowd down, the takings jump by the crowd's fares. Fares are priced by
//     the JOURNEY (origin → final stop), so this board's single long hop pays
//     the same per person in either direction.
//  2. **One entry per call, not per person.** The ledger books a tick's
//     arrivals as one line ("N passengers"), so a busy platform reads as a
//     payday, not as log noise.
//  3. **Income only, for now.** Nothing on this board costs anything yet —
//     running costs and vehicle prices are phase 3 (#91), and this board will
//     be where their arithmetic first shows.
//
// Design: docs/superpowers/specs/2026-08-21-economy-demand-convergence-design.md

// The same shuttle trick as threecities/edgedemand: depots blue, train green —
// a colour mismatch, so it bounces at each end and shuttles forever.
const DEPOT_COLOUR = "blue";
const TRAIN_COLOUR = "green";

const WEST = 0;
const EAST = 13;
const RAIL_Y = 2;
export const WEST_STATION = `3,${RAIL_Y}`;
export const EAST_STATION = `10,${RAIL_Y}`;

const town = (): TileCell => ({ connections: [], terrain: "urban" });

const level: Record<string, TileCell> = {};

level[`${WEST},${RAIL_Y}`] = expandKind("depot", 1);
for (let x = WEST + 1; x < EAST; x++) {
  level[`${x},${RAIL_Y}`] = expandKind("straight", 1);
}
level[`${EAST},${RAIL_Y}`] = expandKind("depot", 3);
// Each platform imports a THINNED share of what its catchment would send
// (the edgeDemand dial from phase 1). At the full rate two busy towns
// overwhelm the shuttle and the board is LOST inside twenty seconds — which
// was true from the day this board was written and went unnoticed only
// because fares used to book after the run ended. Dialled down, the shuttle
// keeps up, the run lasts, and the takings are what there is to watch.
export const EDGE_SHARE = 0.4;
for (const id of [WEST_STATION, EAST_STATION]) {
  level[id] = { ...expandKind("station", 1), edgeDemand: EDGE_SHARE };
}

// A town at each end, inside its station's walking reach: the catchment is
// what gives each platform a crowd to sell tickets to, at the share dialled
// above.
for (const y of [0, 1]) {
  for (let x = 1; x <= 5; x++) level[`${x},${y}`] = town();
  for (let x = 8; x <= 12; x++) level[`${x},${y}`] = town();
}

export const farebox: TestScenario = {
  id: "farebox",
  name: "The farebox",
  description:
    "Every delivered passenger pays — a flag fall plus distance — and the balance ticks up with the service.",
  modeId: "network",
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
