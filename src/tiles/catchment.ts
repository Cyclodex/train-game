import type { Level } from "@/tiles/model";
import type { StationDemand } from "@/sim/simulation";
import { parseCoordId } from "@/tiles/model";

// The walking catchment of a station: how far people walk to a platform, and
// what the ground within that reach says about who is coming.
//
// DERIVED, NEVER STORED — the same rule the industry/demand design fixed for
// depots: the map is the single source of truth, so an author cannot put a
// metropolis fare on a platform in an empty meadow, and repainting the town
// re-prices the station on the next reset with no second field to update.
// This module is pure map-reading (tiles/), used by the GAME layer to build
// the sim's demand schedule; the sim itself stays terrain-blind and just
// executes whatever schedule it is handed.

// People walk this many tiles to a station (Chebyshev distance — the square
// ring, matching how neighbourhoods read on a grid).
export const WALK_RADIUS_TILES = 2;

// What the ground within walking reach contains.
export interface StationCatchment {
  urban: number; // town tiles in reach — the passenger driver
  industry: number; // works tiles in reach — the freight driver (later phase)
}

export function stationCatchment(
  level: Level,
  coordId: string
): StationCatchment {
  const { x, y } = parseCoordId(coordId);
  let urban = 0;
  let industry = 0;
  for (let dy = -WALK_RADIUS_TILES; dy <= WALK_RADIUS_TILES; dy++) {
    for (let dx = -WALK_RADIUS_TILES; dx <= WALK_RADIUS_TILES; dx++) {
      const cell = level[`${x + dx},${y + dy}`];
      if (!cell) continue;
      if (cell.terrain === "urban") urban += 1;
      else if (cell.terrain === "industry") industry += 1;
    }
  }
  return { urban, industry };
}

// Park & ride: which station (if any) serves each tile — the nearest station
// within walking reach, ties broken by Chebyshev distance then id so the map
// is deterministic. game.ts consults this when a car takes a parking stall:
// its occupant walks to that station and joins the platform queue. Computed
// once per level (stations are level data).
export function parkAndRideTargets(level: Level): Record<string, string> {
  const best: Record<string, { station: string; dist: number }> = {};
  for (const [id, cell] of Object.entries(level)) {
    if (cell.role !== "station") continue;
    const { x, y } = parseCoordId(id);
    for (let dy = -WALK_RADIUS_TILES; dy <= WALK_RADIUS_TILES; dy++) {
      for (let dx = -WALK_RADIUS_TILES; dx <= WALK_RADIUS_TILES; dx++) {
        const tid = `${x + dx},${y + dy}`;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const cur = best[tid];
        if (!cur || dist < cur.dist || (dist === cur.dist && id < cur.station)) {
          best[tid] = { station: id, dist };
        }
      }
    }
  }
  return Object.fromEntries(
    Object.entries(best).map(([tid, b]) => [tid, b.station])
  );
}

// The passenger demand schedule a station earns from its surroundings. A
// station beside nothing still sees a trickle (somebody always turns up); a
// town within walking reach means faster arrivals, a larger waiting crowd,
// and a platform that is not empty when the level opens. All values are
// simple monotone functions of the urban count, so "build the station nearer
// the houses" is always the right move and never a cliff.
// The rates are set against what a TRAIN can actually do, which is the only
// scale that means anything: at DEFAULT_SPEED (0.5 tiles/sec) a shuttle needs
// roughly 30-40s to work a short line and come back, and a people wagon seats
// PASSENGERS_PER_WAGON. A busy station (6 town tiles) therefore turns out a
// passenger every 4s — a couple of trainloads per round trip, so a good service
// keeps up and a neglected one visibly does not. The first numbers here were
// authored before any mode consumed them and were ~2.5x hotter than that; the
// network mode made an unwinnable board out of them, which is exactly the sort
// of thing only a real consumer can tell you.
export function stationDemandOf(level: Level, coordId: string): StationDemand {
  const { urban } = stationCatchment(level, coordId);
  return {
    // The no-town fallback must stay SLOWER than the one-house case (24s), or
    // the middle of nowhere out-generates a hamlet and the whole "build nearer
    // the houses" rule inverts at its own first step.
    intervalSec: urban > 0 ? Math.max(3, 24 / urban) : 30,
    // The platform cap. Above the network mode's OVERCROWD_LIMIT only for a
    // REAL town (5+ tiles in reach), so a quiet halt can never lose you the
    // level by itself — the crowd that ends a run has to be one you were given
    // the traffic to justify.
    max: Math.min(4 + 2 * urban, 16),
    initial: Math.min(2 + Math.floor(urban / 2), 8),
  };
}
