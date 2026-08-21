import { Position } from "@/types";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import type { ParkingRow } from "@/tiles/parking";
import { TestScenario } from "@/levels/test/scenario";

// CITIZENS RIDE THE BUS (#117 step 1 / #111 step 1) — no railway anywhere.
//
// One street. Houses at the west end, every job at the east end, and the two
// far enough apart that nobody can walk it and no bike covers the longest
// commutes. A bus line joins the two halts — and the people at the kerb are
// the town's own residents, waiting under their own names, exactly as they
// would on a platform.
//
// What to watch (open the city cards):
//  1. **The kerb fills at 07:00.** The morning peak gathers at the west halt —
//     named commuters, not the synthetic crowd (this board's halts import no
//     edge demand; the town explains everybody).
//  2. **Mode share splits along car ownership.** The drivers drive — the same
//     street, so the bus queues behind them — and the rest ride the bus. The
//     transit slice of the mode-share bar is bus-only proof: there is no rail
//     on this board to confuse it with.
//  3. **The bus IS the network.** Take the bus off its line and watch the
//     refusals climb: half the town simply cannot get to work.
//
// The demand architecture note: before #117, a citizen's boarding points were
// rail stations only, so this board was dead — people stood beside a served
// bus stop and reported "no station in reach". The bus stop is now a boarding
// point like any platform, on the same shared transit layer.

const { Left, Right } = Position;

/** The two halts, exported for the unit test that rides this board. */
export const WEST_HALT = "2,1";
export const EAST_HALT = "11,1";

const WIDTH = 14;
const STREET_Y = 1;

const street = (): TileCell => ({ connections: [], road: twoWay(Left, Right) });
const halt = (facility: string, label: string): TileCell => ({
  ...street(),
  parking: {
    facility,
    label,
    dwellSec: [5, 9],
    rows: [{ from: Left, kind: "busstop", count: 1 } as ParkingRow],
  },
});
const home = (): TileCell => ({ connections: [], terrain: "urban", city: "westend" });
const works = (): TileCell => ({ connections: [], terrain: "industry", city: "eastworks" });

const level: Record<string, TileCell> = {};

// The street, edge to edge, with a halt near each end.
for (let x = 0; x < WIDTH; x++) level[`${x},${STREET_Y}`] = street();
level[WEST_HALT] = halt("halt-west", "West End");
level[EAST_HALT] = halt("halt-east", "East Works");

// Houses west, jobs east — each block inside its halt's walking reach (±2),
// and the gap between them (x 5..8) both keeps the two towns two towns to the
// clustering AND puts the nearest house five tiles from the nearest job: one
// more than anybody walks (`walkMaxTiles: 4`), which is what makes this a
// transport board at all. The longest commutes (13 tiles) are past every
// bike's range, so the residents without a car genuinely need the bus.
for (let x = 0; x <= 4; x++) level[`${x},0`] = home();
for (let x = 9; x <= 13; x++) level[`${x},0`] = works();

export const busride: TestScenario = {
  id: "busride",
  name: "Citizens ride the bus",
  description:
    "No rails at all: the commuters at the kerb are the town's own people, and the bus is the network.",
  modeId: "citizens",
  level,
  trains: {},
  // The line and its one bus exist from the start — a demo has to demonstrate.
  busLines: [[WEST_HALT, EAST_HALT]],
  size: { cols: WIDTH, rows: 2 },
  traffic: { spawnInterval: 1.6, maxCars: 12 },
};
