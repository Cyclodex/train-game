import type { Level, TileCell, Port } from "@/tiles/model";
import { parseCoordId } from "@/tiles/model";
import { oppositePort, neighborCoord } from "@/sim/topology";
import { cycleLaneIndices, isOneWayStraight } from "@/tiles/lanes";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { levelBounds } from "@/tiles/bounds";
import {
  bankFor,
  bankOf,
  kerbRunClash,
  rowsOf,
  validateParking,
  type ParkingCell,
  type ParkingRow,
} from "@/tiles/parking";

// THE EDGE OF THE ROAD — where a car goes when there is nowhere to put it.
//
// The two derived passes before this one give a town its proper parking: a
// forecourt at the works (`workplaceParking.ts`) and a drive at each house
// (`homeParking.ts`). Neither is ever enough, which is the design. The question
// this file answers is what happens to the driver who arrives and finds all of
// it taken.
//
// The old answer was that the car was DELETED. `settleRequestedTrips` retires a
// requested car half a tile into its destination, so a commuter with nowhere to
// park drove to the works and popped out of existence in the middle of the
// street, in full view. Measured on `/test/homeparking` with the works
// saturated: 30 cars dispatched, 18 parked, **12 simply vanished** — and not one
// of them had even reached the give-up path (`parkingFrame().givenUp` was zero).
// They never had a parking plan at all: nothing was free when they were
// dispatched, so they were sent to the address as an ordinary trip and settled
// there.
//
// So give them somewhere. Every straight street on the board carries a stretch
// of kerb a car can be left on — not a bay, not a car park, no paint, no sign.
// Just the roadside. It is the last thing any driver considers, and it turns
// "the car disappears" into "the car is parked three streets away and its owner
// has a walk", which is both what really happens and a cost the player can see
// and shorten.
//
// WHY THIS DOES NOT MAKE PARKING FREE. The kerb is only ever found within the
// driver's own search radius (six tiles from work, two from home), so a works
// with three bays still pushes its staff further and further out, and the walk
// grows with the shortfall. The forecourt is still worth building; it is just no
// longer the difference between parking and ceasing to exist.
//
// Design: docs/superpowers/specs/2026-08-05-home-parking-design.md → open ends.

// Spaces per stretch of kerb. TWO, and the reason is legibility rather than
// capacity: a run of three `parallel` spaces fills a tile edge to edge and reads
// as a deliberate parking lane, which is exactly what this is not supposed to
// look like. Two leaves gaps in the run, so a street with cars left along it
// reads as a street with cars left along it.
export const KERB_SPACES = 2;

// How long an ambient car would stay. It never applies — nothing ambient can
// claim informal kerb (`stallFits`'s `informal` gate) — but a facility with no
// dwell falls back to the sim's default, and being explicit costs nothing and
// documents the intent: a car left at the roadside is left there, not popping in
// for ten minutes.
const KERB_DWELL_SEC: [number, number] = [600, 1800];

export interface KerbOverflowOptions {
  tileSize?: number;
  spaces?: number;
}

/**
 * The level with last-resort kerb space on every straight street that has room.
 *
 * Pure and IDEMPOTENT: a bank already carrying a row — authored, a forecourt, a
 * drive, or informal kerb from an earlier pass — is left exactly as it is. Run
 * this LAST, so the passes that lay real parking get first choice of every kerb.
 *
 * Every row goes through `validateParking` and any it objects to is dropped.
 */
export function deriveKerbOverflow(level: Level, opts: KerbOverflowOptions = {}): Level {
  const { tileSize = 200, spaces = KERB_SPACES } = opts;
  if (spaces <= 0) return level;

  const additions = new Map<string, ParkingRow[]>();

  for (const tileId of Object.keys(level).sort()) {
    const cell = level[tileId];
    if (!canCarryKerb(level, tileId, cell)) continue;
    const taken = new Set<Port>(rowsOf(cell).map(bankOf));
    // THE KERB IS THE BIKE'S where an approach carries a cycle lane (#87): the
    // half-width green strip is painted on that stream's kerb side and its
    // bikes ride it, so a car left there would stand ON the cycle lane and a
    // car pulling in would cut across it. Per BANK, not per tile: a one-way
    // street with a cycle lane on one side keeps its other, legitimate kerb.
    const bikeBanks = new Set<Port>();
    for (const lane of cell.road ?? []) {
      if (cycleLaneIndices(cell.road, lane.from).length > 0) {
        bikeBanks.add(bankFor(lane.from, "right"));
      }
    }

    for (const from of straightApproaches(cell)) {
      // Same kerb rule as everywhere else: "right" is the near bank and always
      // legal, "left" is the far one and only reachable without crossing an
      // oncoming stream on a one-way street.
      const sides: ("right" | "left")[] = isOneWayStraight(cell.road, from)
        ? ["right", "left"]
        : ["right"];
      for (const side of sides) {
        const bank = bankFor(from, side);
        if (taken.has(bank)) continue;
        if (bikeBanks.has(bank)) continue; // the kerb is the bike's
        // ONE KERB RUN, ONE SIDE OF THE PAVEMENT: informal kerb is kerbside
        // parking, and next to a drive on the same flank the band would have to
        // taper across the drive's bays to get behind these spaces. The kerb
        // beside a run of driveways simply is not somewhere you leave a car.
        if (kerbRunClash(level, tileId, from, bank, "parallel")) continue;
        taken.add(bank);
        const rows = additions.get(tileId) ?? [];
        rows.push({
          from,
          side,
          kind: "parallel",
          count: spaces,
          // "pack" so a run of kerb down one street is one continuous stretch
          // rather than a pocket per tile — nothing is painted, but the SPACES
          // still have to line up or two cars on adjacent tiles sit at odd
          // offsets from each other.
          align: "pack",
          // No paint at all — see `ParkingRow.informal`. This is also what keeps
          // the pass from changing how a single existing board LOOKS: it adds
          // places a car may stop, not tarmac.
          informal: true,
          marking: "none",
        });
        additions.set(tileId, rows);
      }
    }
  }

  if (additions.size === 0) return level;

  let next = applyRows(level, additions);
  const grid = levelBounds(level);
  const dropped = new Set<string>();
  for (let guard = 0; guard < 8; guard++) {
    const issues = validateParking(next, tileSize, { cols: grid.cols, rows: grid.rows });
    const ours = issues.filter(i => additions.has(i.tileId) && !dropped.has(i.tileId));
    if (ours.length === 0) break;
    for (const i of ours) dropped.add(i.tileId);
    const kept = new Map([...additions].filter(([id]) => !dropped.has(id)));
    next = kept.size === 0 ? level : applyRows(level, kept);
    if (kept.size === 0) break;
  }
  return next;
}

/** The tiles this pass put kerb space on. For tests and scenario assertions. */
export function kerbOverflowTiles(level: Level, opts: KerbOverflowOptions = {}): string[] {
  const next = deriveKerbOverflow(level, opts);
  return Object.keys(next)
    .filter(id => rowsOf(next[id]).length > rowsOf(level[id]).length)
    .sort();
}

// --- internals -----------------------------------------------------------------

function applyRows(level: Level, additions: Map<string, ParkingRow[]>): Level {
  const out: Level = { ...level };
  for (const [tileId, rows] of additions) {
    const cell = out[tileId];
    const parking: ParkingCell = {
      ...(cell.parking ?? {}),
      // NO LABEL of its own. A label is signage and this is not signed; a tile
      // that already had one keeps it, via the spread above.
      dwellSec: cell.parking?.dwellSec ?? KERB_DWELL_SEC,
      rows: [...(cell.parking?.rows ?? []), ...rows],
    };
    out[tileId] = { ...cell, parking };
  }
  return out;
}

// A tile whose kerb a car may be left on.
function canCarryKerb(level: Level, tileId: string, cell: TileCell | undefined): boolean {
  if (!cell?.road?.length) return false;
  // NOT ON A LEVEL CROSSING — the booms' reach is the worst place on the board
  // to leave a car standing, and this one would be left for hours.
  if (cell.connections.length > 0) return false;
  // NOT ON A TILE WHERE THE ROAD OPENS INTO THE MAP'S INTERIOR — a stub, a
  // turning head, the end of a spur. `openingInsideLot` in `sim/road.ts` treats
  // any opening on a tile that belongs to a parking facility as being INSIDE a
  // car park rather than a way off the map, and stops ambient traffic spawning
  // or despawning there. That rule is right for a car park's aisles and would be
  // a disaster here: this pass touches nearly every street, so an interior stub
  // that happened to be a spawn point would silently go quiet and the board
  // would lose its traffic.
  //
  // An opening that runs OFF THE GRID is safe and deliberately still allowed —
  // `openingInsideLot` returns early for those, so a border street keeps both
  // its kerb and its spawns.
  if (opensIntoInterior(level, tileId, cell)) return false;
  return true;
}

// Does this tile have a road end that stops somewhere inside the map?
function opensIntoInterior(level: Level, tileId: string, cell: TileCell): boolean {
  const coord = parseCoordId(tileId);
  const ports = new Set<Port>();
  for (const lane of cell.road ?? []) {
    ports.add(lane.from);
    for (const to of lane.to) ports.add(to);
  }
  for (const port of ports) {
    const n = neighborCoord(coord, port);
    if (!n) continue; // off the grid — a real way off the map, and fine
    if (n.x < 0 || n.y < 0) continue;
    const neighbour = level[getCoordinatesId(n)];
    // A port pointing at ground with no road on it is an opening into the
    // interior. (A port pointing off the RIGHT/BOTTOM edge lands on an absent
    // tile too, and is likewise treated as an opening here — conservative, and
    // it costs only the kerb on the outermost tile of a board.)
    if (!neighbour?.road?.length) return true;
  }
  return false;
}

// The approaches that run straight through — the only ones a row is legal on.
function straightApproaches(cell: TileCell): Port[] {
  const out = new Set<Port>();
  for (const lane of cell.road ?? []) {
    if (lane.to.includes(oppositePort(lane.from))) out.add(lane.from);
  }
  return [...out].sort((a, b) => a - b);
}
