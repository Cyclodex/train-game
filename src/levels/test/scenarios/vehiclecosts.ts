import { expandKind } from "@/tiles/kinds";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";

// WHAT THE FLEET COSTS (#91, economy convergence phase 3).
//
// The board opens with a railway, four busy towns, a shed — and NO train. The
// capital in the purse buys exactly one, with change for a bus, so the mode's
// first decision is made before a single fare is earned.
//
// What to watch:
//  1. **+ Train costs money.** The balance drops by the purchase price the
//     moment you order one, and the button refuses (rather than queues) when
//     the purse cannot cover it. A busy SHED is a different refusal: that one
//     delays the departure and takes your money all the same.
//  2. **Wages tick.** Every billing period the fleet bills its keep, as one
//     ledger line. The HUD figure is what the CURRENT fleet will cost next
//     period, so withdrawing a train lowers it before the period even turns.
//  3. **The trade-off.** One train on this line clears its own wages several
//     times over. A second doubles the service and doubles the wage bill —
//     worth it while the platforms are full, a slow bleed once they are not,
//     and that sentence is the whole point of the phase.
//
// FOUR platforms, not two, and the reason is the lesson: the passenger target
// scales with the station count (PASSENGERS_PER_STATION), so a two-stop board
// is won before the first wage bill lands and the trade-off never shows. Four
// stops make a run that lasts several billing periods.
//
// Deliberately no road: a bus needs a street, and this board is about the
// decision between running MORE and running LEAN, not about which vehicle.
// /test/busride is where a bus earns its keep.
//
// Design: docs/superpowers/specs/2026-08-21-economy-demand-convergence-design.md

const WEST = 0;
const EAST = 23;
const RAIL_Y = 2;

/** The platforms, west to east — exported for the unit test that runs this board. */
export const STATIONS = [3, 9, 15, 21].map(x => `${x},${RAIL_Y}`);
export const WEST_STATION = STATIONS[0];
export const EAST_STATION = STATIONS[STATIONS.length - 1];
/** The shed a train is ordered at. */
export const DEPOT = `${WEST},${RAIL_Y}`;

const town = (): TileCell => ({ connections: [], terrain: "urban" });

const level: Record<string, TileCell> = {};

level[DEPOT] = expandKind("depot", 1);
for (let x = WEST + 1; x < EAST; x++) {
  level[`${x},${RAIL_Y}`] = expandKind("straight", 1);
}
level[`${EAST},${RAIL_Y}`] = expandKind("depot", 3);
// Each platform imports a THINNED share of what its catchment would send
// (the edgeDemand dial from phase 1). At the full rate four busy towns
// overwhelm a single train inside forty seconds and the board is lost before
// the first wage bill ever lands — which teaches the overcrowding rule, not
// this one. Dialled down, one train just about copes and a second is a real
// improvement: that gap IS the decision this board is about.
export const EDGE_SHARE = 0.25;
for (const id of STATIONS) {
  level[id] = { ...expandKind("station", 1), edgeDemand: EDGE_SHARE };
}

// A town around each platform, inside its walking reach: the catchment is what
// fills the platforms, and a full platform is what makes a second train worth
// its wages.
for (const id of STATIONS) {
  const sx = Number(id.split(",")[0]);
  for (const y of [0, 1]) {
    for (let x = sx - 2; x <= sx + 2; x++) {
      if (x >= 0 && x <= EAST) level[`${x},${y}`] = town();
    }
  }
}

export const vehiclecosts: TestScenario = {
  id: "vehiclecosts",
  name: "What the fleet costs",
  description:
    "A railway, four crowds and an empty shed: buying a train costs money, and keeping one costs money every period.",
  modeId: "network",
  level,
  // No rolling stock at all — the fleet is the thing the player decides.
  trains: {},
  size: { cols: EAST + 1, rows: 3 },
};
