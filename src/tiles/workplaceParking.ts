import type { Level, TileCell, Port } from "@/tiles/model";
import { parseCoordId } from "@/tiles/model";
import { oppositePort, neighborCoord } from "@/sim/topology";
import { isOneWayStraight } from "@/tiles/lanes";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { levelBounds } from "@/tiles/bounds";
import { plotsOf, type PlotKind } from "@/tiles/cities";
import {
  bankFor,
  bankOf,
  rowsOf,
  validateParking,
  type ParkingCell,
  type ParkingRow,
} from "@/tiles/parking";

// Staff parking at the gate — where a commuter's car actually stops.
//
// The map already says where the works are (`terrain: "industry"` → a `work`
// plot; the parade of shops in a town centre → a `shop` plot). A works has a
// handful of spaces at its gate. So DERIVE them: this pass lays a short rank of
// kerb bays on the road tile a workplace's driveway joins, on the kerb facing
// the plot, and every board that has industry ground grows staff parking without
// anybody drawing anything.
//
// THE RANK IS DELIBERATELY TOO SMALL. A work plot employs twelve people at
// density 0 and ninety-six at density 3; its forecourt holds three cars. That
// gap is the mechanic, not an oversight: the first arrivals get the gate, and
// everybody else has to find the kerb further down the street or a car park the
// player built. A forecourt big enough for the workforce would make parking
// scenery.
//
// Three is also what physically FITS. A `parallel` bay's pitch is 60px on the
// 200px tile, so three bays fill it edge to edge — and canon says a rank of two
// reads as an unfinished car park rather than a small one (KNOWHOW → PARKING).
//
// Design: docs/superpowers/specs/2026-08-04-workplace-parking-design.md
export const STAFF_BAYS_PER_PLOT = 3;

// Which plot kinds get a forecourt. Homes do not: a driveway is not a car park,
// and the resident's car is at work all day anyway — the whole point of the
// mode is the journey between the two.
const PARKS_FOR: PlotKind[] = ["work", "shop"];

// How long an AMBIENT car left in a staff bay stays. Commuters hold their bay
// through the citizen layer (the dwell is their working day, not a timer), but
// ordinary traffic uses these bays too, and a staff space that churns every
// twenty seconds reads as a supermarket rather than a factory gate.
const STAFF_DWELL_SEC: [number, number] = [180, 420];

export interface WorkplaceParkingOptions {
  // Seed for `plotsOf` — must match the seed the citizen world is built with, or
  // the shops this pass parks are not the shops the citizens work in.
  seed?: number;
  // Painted bays, or a wide street you simply pull over on. "none" is the
  // American arterial (see `ParkingRow.marking`); a board picks one for its
  // whole region, which is what makes an American town look American.
  marking?: "bays" | "none";
  tileSize?: number;
}

// A row this pass added, so a later validation failure can drop OUR bays and
// never an author's.
interface Derived {
  tileId: string;
  bank: Port;
}

/**
 * The level with staff parking laid at every workplace that has a kerb for it.
 *
 * Pure and IDEMPOTENT: a kerb that already carries a row — authored or derived
 * on an earlier pass — is left exactly as it is, so running this twice changes
 * nothing the second time.
 *
 * Every row it lays is put through `validateParking`, and any that the validator
 * objects to is dropped rather than shipped. That matters because the objections
 * are not all local: laying bays on a dead-end stub turns that stub into a car
 * park with no way out, which is a property of a flood fill and not of the tile
 * being edited. A derived pass that can be rejected has to be able to back out.
 */
export function deriveWorkplaceParking(
  level: Level,
  opts: WorkplaceParkingOptions = {},
): Level {
  const { seed = 1, marking = "bays", tileSize = 200 } = opts;
  const plots = plotsOf(level, seed).filter(p => PARKS_FOR.includes(p.kind));
  if (plots.length === 0) return level;

  // Which tiles are workplaces, so the kerb test is a lookup rather than a scan.
  const workplace = new Set(plots.map(p => p.id));

  // Candidate rows, keyed by tile. Built against the ORIGINAL level: a rank laid
  // on one tile never changes whether the next tile qualifies.
  const additions = new Map<string, ParkingRow[]>();
  const derived: Derived[] = [];

  for (const tileId of Object.keys(level).sort()) {
    const cell = level[tileId];
    if (!canCarryStaffParking(cell)) continue;
    const coord = parseCoordId(tileId);
    // The banks this tile already spends on parking — authored rows included, so
    // an author who drew a bus stop outside the factory keeps it.
    const taken = new Set<Port>(rowsOf(cell).map(bankOf));

    // WHICH KERB, and the rule is the validator's own. "right" is the near kerb
    // and always legal; "left" is the far bank, which a driver may only be sent
    // to where there is no oncoming stream to cross — i.e. a one-way street.
    //
    // On a TWO-WAY straight the two approaches hand back the two opposite banks
    // with side "right" anyway, so both kerbs are reachable without ever asking
    // for the illegal one. A ONE-WAY street has a single approach, and its far
    // kerb is only reachable as "left": leaving that out means a works on the
    // wrong side of a one-way ring gets no forecourt at all, which is most of
    // the workplaces on a board built round a one-way loop.
    for (const from of straightApproaches(cell)) {
      const sides: ("right" | "left")[] = isOneWayStraight(cell.road, from)
        ? ["right", "left"]
        : ["right"];
      for (const side of sides) {
        const bank = bankFor(from, side);
        if (taken.has(bank)) continue;
        const n = neighborCoord(coord, bank);
        if (!n || !workplace.has(getCoordinatesId(n))) continue;
        taken.add(bank);
        const rows = additions.get(tileId) ?? [];
        rows.push({
          from,
          side,
          kind: "parallel",
          count: STAFF_BAYS_PER_PLOT,
          // "pack" so a run of workplaces down one street reads as ONE
          // continuous parking edge instead of a hole of kerb at every seam.
          align: "pack",
          ...(marking === "none" ? { marking } : {}),
        });
        additions.set(tileId, rows);
        derived.push({ tileId, bank });
      }
    }
  }

  if (additions.size === 0) return level;

  let next = applyRows(level, additions, marking);
  // Back out anything the validator objects to. Dropping one tile's rows can
  // clear an objection raised somewhere else entirely (the way-out flood fill is
  // per FACILITY), so re-check until it settles — bounded, because each pass
  // removes at least one tile's worth or stops.
  const grid = levelBounds(level);
  const dropped = new Set<string>();
  for (let guard = 0; guard < 8; guard++) {
    const issues = validateParking(next, tileSize, { cols: grid.cols, rows: grid.rows });
    const ours = issues.filter(i => additions.has(i.tileId) && !dropped.has(i.tileId));
    if (ours.length === 0) break;
    for (const i of ours) dropped.add(i.tileId);
    const kept = new Map([...additions].filter(([id]) => !dropped.has(id)));
    next = kept.size === 0 ? level : applyRows(level, kept, marking);
    if (kept.size === 0) break;
  }
  return next;
}

/** Where this pass put bays — for a test, and for a scenario's own assertions. */
export function workplaceParkingTiles(level: Level, opts: WorkplaceParkingOptions = {}): string[] {
  const next = deriveWorkplaceParking(level, opts);
  return Object.keys(next)
    .filter(id => rowsOf(next[id]).length > rowsOf(level[id]).length)
    .sort();
}

// --- internals -----------------------------------------------------------------

function applyRows(
  level: Level,
  additions: Map<string, ParkingRow[]>,
  marking: "bays" | "none",
): Level {
  const out: Level = { ...level };
  for (const [tileId, rows] of additions) {
    const cell = out[tileId];
    const parking: ParkingCell = {
      ...(cell.parking ?? {}),
      label: cell.parking?.label ?? (marking === "none" ? "Street parking" : "Staff parking"),
      dwellSec: cell.parking?.dwellSec ?? STAFF_DWELL_SEC,
      rows: [...(cell.parking?.rows ?? []), ...rows],
    };
    out[tileId] = { ...cell, parking };
  }
  return out;
}

// A tile that can hold a kerb rank at all. Everything here is a cheap local
// veto; the expensive, non-local rules (a tapering kerb, bays that overhang the
// tile, a car park with no way out) are left to `validateParking`, which this
// pass runs and honours.
function canCarryStaffParking(cell: TileCell | undefined): boolean {
  if (!cell?.road?.length) return false;
  // NOT ON A LEVEL CROSSING. Parking against the rails puts a car standing in
  // the booms' reach for its whole dwell, and there is nowhere on the board that
  // is a worse place to leave one.
  if (cell.connections.length > 0) return false;
  return true;
}

// The approaches that run straight through — the only ones a row is legal on
// (`validateParking`: nobody parks in a bend or a junction box). Sorted so the
// pass lays the same bays on every run.
function straightApproaches(cell: TileCell): Port[] {
  const out = new Set<Port>();
  for (const lane of cell.road ?? []) {
    if (lane.to.includes(oppositePort(lane.from))) out.add(lane.from);
  }
  return [...out].sort((a, b) => a - b);
}
