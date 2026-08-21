import type { Level, TileCell, Port } from "@/tiles/model";
import { Position } from "@/types";
import { parseCoordId } from "@/tiles/model";
import { oppositePort, neighborCoord } from "@/sim/topology";
import { isOneWayStraight, isRoadJunction } from "@/tiles/lanes";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { levelBounds } from "@/tiles/bounds";
import { plotsOf, type PlotKind } from "@/tiles/cities";
import {
  bankFor,
  bankOf,
  kerbRunClash,
  rowsOf,
  validateParking,
  type ParkingCell,
  type ParkingRow,
} from "@/tiles/parking";

// The mini-rack at the gate — where a commuter's bicycle actually stands.
//
// The car pass (`workplaceParking.ts`) answered "where does the car stop" with
// three staff bays derived from the zoning. A cycling citizen has the same
// question and used to get no answer at all: the bike locked at the door and
// evaporated. So DERIVE the answer the same way: every work/shop plot grows a
// short rank of bike stands at its frontage, and every board that has industry
// ground gets bike parking without anybody drawing anything.
//
// THE RANK IS DELIBERATELY TOO SMALL — six stands against a works employing
// twelve to ninety-six, the same gap the three car bays open. The first riders
// get the gate; everybody else leans the bike somewhere down the street (task 3
// of the design) or the player builds a proper rack with the editor tool. Six
// stands are 75px of a 200px tile at the rack's 12.5px pitch: a short piece of
// street furniture, not the full 16-stand tile.
//
// WHERE IT LANDS. The three car bays fill the gate kerb edge to edge (their
// pitch is a third of the tile), and two rows may never hug one bank
// (`validateParking`), so the rack takes the best kerb still free, in order:
// the gate kerb itself where the car pass has not spoken for it, then ONE TILE
// ALONG the same kerb run (the corner of the plot — the rider walks a few
// steps), then the far kerb of the frontage street (across the road from the
// gate). All three are resolved with the validator's own gates (`bankFor`,
// `kerbRunClash`), and whatever it still objects to is dropped, never shipped.
//
// Design: docs/superpowers/specs/2026-08-21-bike-destination-parking-design.md
export const BIKE_STANDS_PER_PLOT = 6;

// Which plot kinds get a rack — the same set that gets staff car bays, for the
// same reason: homes need no destination parking, the shed at home is free.
const RACKS_FOR: PlotKind[] = ["work", "shop"];

// How long an AMBIENT bike left in a stand stays. Commuting citizens hold their
// stand through the citizen layer (the dwell is their working day); ordinary
// road-sim riders use the same stands, and the same argument as the car bays'
// applies: a works rack that churns every twenty seconds reads as a shop
// doorway, not a factory gate.
export const RACK_DWELL_SEC: [number, number] = [180, 420];

export interface WorkplaceBikeRackOptions {
  // Seed for `plotsOf` — must match the seed the citizen world is built with,
  // or the shops this pass racks are not the shops the citizens cycle to.
  seed?: number;
  tileSize?: number;
}

/**
 * The level with a six-stand bike rack laid at every workplace that has a kerb
 * for one.
 *
 * Pure and IDEMPOTENT, per PLOT rather than per kerb (the home pass's lesson):
 * a plot whose candidate kerbs already carry a rack — authored, or laid by an
 * earlier run — is served and gets nothing more, so a corner works cannot grow
 * a rack per run by walking to its next frontage.
 *
 * Every row is put through `validateParking` and any it objects to is dropped
 * rather than shipped — the objections are not all local, and a derived pass
 * has to be able to back out. A dropped row is NOT re-planned onto the next
 * candidate kerb (the same one-shot discipline as the car pass).
 */
export function deriveWorkplaceBikeRacks(
  level: Level,
  opts: WorkplaceBikeRackOptions = {},
): Level {
  const { seed = 1, tileSize = 200 } = opts;
  const plots = plotsOf(level, seed).filter(p => RACKS_FOR.includes(p.kind));
  if (plots.length === 0) return level;

  // Candidate rows, keyed by tile, built against the ORIGINAL level so a rack
  // laid at one plot never changes whether the next one qualifies — but the
  // banks spent as we go are tracked, so two plots sharing a kerb run each get
  // their own bank or move on.
  const additions = new Map<string, ParkingRow[]>();
  const taken = new Map<string, Set<Port>>();
  const banksOf = (tileId: string): Set<Port> => {
    let s = taken.get(tileId);
    if (!s) {
      s = new Set<Port>(rowsOf(level[tileId]).map(bankOf));
      taken.set(tileId, s);
    }
    return s;
  };

  // Sorted, so a board grows the same racks on every run and a plot that has to
  // share a kerb with a neighbour loses the race deterministically.
  for (const plot of [...plots].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const spots = rackSpots(level, plot.id);
    if (spots.length === 0) continue;
    // Idempotence, per PLOT: a rack already standing at any of this plot's own
    // candidate kerbs serves it. Checking banks alone would send a second run
    // walking past the plot's own rack to lay another one further along.
    const served = spots.some(s =>
      rowsOf(level[s.tileId]).some(r => r.kind === "bikerack" && bankOf(r) === s.bank),
    );
    if (served) continue;
    for (const s of spots) {
      if (banksOf(s.tileId).has(s.bank)) continue;
      // ONE KERB RUN, ONE SIDE OF THE PAVEMENT: a rack is kerbside furniture
      // (the band runs behind it), so beside an across-kerb rank — a drive, a
      // forecourt — on the same flank next door, the band cannot pass in front
      // of one and behind the other.
      if (kerbRunClash(level, s.tileId, s.from, s.bank, "parallel")) continue;
      banksOf(s.tileId).add(s.bank);
      const rows = additions.get(s.tileId) ?? [];
      rows.push({
        from: s.from,
        side: s.side,
        kind: "bikerack",
        count: BIKE_STANDS_PER_PLOT,
        // CENTRED, which is the opposite of the car rank's "pack". Three staff
        // bays fill their tile, so packing makes a continuous parking edge; six
        // stands are a short piece of street furniture that belongs to ONE
        // gate, and it sits in the middle of its tile with kerb either side —
        // the drive's reasoning, not the forecourt's.
        align: "centre",
      });
      additions.set(s.tileId, rows);
      break; // one rack per plot — the gap to the workforce is the mechanic
    }
  }

  if (additions.size === 0) return level;

  let next = applyRows(level, additions);
  // Back out anything the validator objects to. Dropping one tile's rows can
  // clear an objection raised elsewhere, so re-check until it settles —
  // bounded, because each pass drops at least one tile's worth or stops.
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

/** The tiles this pass put stands on. For tests and scenario assertions. */
export function workplaceBikeRackTiles(
  level: Level,
  opts: WorkplaceBikeRackOptions = {},
): string[] {
  const next = deriveWorkplaceBikeRacks(level, opts);
  return Object.keys(next)
    .filter(id => rowsOf(next[id]).length > rowsOf(level[id]).length)
    .sort();
}

// --- internals -----------------------------------------------------------------

interface RackSpot {
  tileId: string;
  from: Port;
  side: "right" | "left";
  bank: Port;
}

/**
 * The kerbs this plot's rack may stand on, best first: the gate kerb of each
 * frontage road tile, then one tile along the same kerb either way, then the
 * far kerb of the frontage street. Deterministic (port order, then step-port
 * order), so a board lays the same racks on every run.
 */
function rackSpots(level: Level, plotId: string): RackSpot[] {
  const coord = parseCoordId(plotId);
  const ports: Port[] = [Position.Top, Position.Right, Position.Bottom, Position.Left];
  const gate: RackSpot[] = [];
  const beside: RackSpot[] = [];
  const across: RackSpot[] = [];
  const seen = new Set<string>();
  const push = (list: RackSpot[], tileId: string, bank: Port) => {
    const cell = level[tileId];
    if (!canCarryARack(cell)) return;
    const key = `${tileId}|${bank}`;
    if (seen.has(key)) return;
    const a = approachForBank(cell, bank);
    if (!a) return;
    seen.add(key);
    list.push({ tileId, from: a.from, side: a.side, bank });
  };
  for (const dir of ports) {
    const n = neighborCoord(coord, dir);
    if (!n) continue;
    const tileId = getCoordinatesId(n);
    const cell = level[tileId];
    if (!canCarryARack(cell)) continue;
    // The kerb the plot stands behind, seen from the road tile: the plot lies
    // back the way we came.
    const bank = oppositePort(dir);
    const a = approachForBank(cell, bank);
    if (a) {
      push(gate, tileId, bank);
      // One tile along the same kerb run — the corner of the plot. The street
      // axis is the serving approach's own axis; step both ways, low port
      // first, so the choice is stable.
      for (const step of [a.from, oppositePort(a.from)].sort((p, q) => p - q)) {
        const sn = neighborCoord(n, step);
        if (sn) push(beside, getCoordinatesId(sn), bank);
      }
    }
    // The far kerb of the frontage street — across the road from the gate. On a
    // two-way street it is the other approach's "right"; on a one-way it is the
    // single approach's "left", which is legal exactly there (no oncoming
    // stream for the rider to cross).
    push(across, tileId, dir);
  }
  return [...gate, ...beside, ...across];
}

// Which approach serves this bank, under the validator's own side rule: "right"
// is the near kerb and always legal; "left" only where the approach carries no
// oncoming stream (a one-way street). A bank along the street's own axis has no
// serving approach and returns null.
function approachForBank(
  cell: TileCell,
  bank: Port,
): { from: Port; side: "right" | "left" } | null {
  for (const from of straightApproaches(cell)) {
    const sides: ("right" | "left")[] = isOneWayStraight(cell.road, from)
      ? ["right", "left"]
      : ["right"];
    for (const side of sides) {
      if (bankFor(from, side) === bank) return { from, side };
    }
  }
  return null;
}

function applyRows(level: Level, additions: Map<string, ParkingRow[]>): Level {
  const out: Level = { ...level };
  for (const [tileId, rows] of additions) {
    const cell = out[tileId];
    const parking: ParkingCell = {
      ...(cell.parking ?? {}),
      label: cell.parking?.label ?? "Bike stands",
      dwellSec: cell.parking?.dwellSec ?? RACK_DWELL_SEC,
      rows: [...(cell.parking?.rows ?? []), ...rows],
    };
    out[tileId] = { ...cell, parking };
  }
  return out;
}

// A tile that can hold a rack at all. Cheap local vetoes only; the expensive,
// non-local rules are left to `validateParking`, which this pass runs and
// honours. The junction veto IS worth paying here, unlike in the car pass:
// this pass has fallback kerbs, and spending the plot's one rack on a tile the
// validator is certain to reject would cost it the kerb that would have worked.
function canCarryARack(cell: TileCell | undefined): cell is TileCell {
  if (!cell?.road?.length) return false;
  // NOT ON A LEVEL CROSSING. A bike stands in a rack for the working day, and
  // the booms' reach is the worst place on the board to leave one.
  if (cell.connections.length > 0) return false;
  if (isRoadJunction(cell.road)) return false;
  return true;
}

// The approaches that run straight through — the only ones a row is legal on
// (nobody racks a bike in a bend or a junction box). Sorted so the pass lays
// the same stands on every run.
function straightApproaches(cell: TileCell): Port[] {
  const out = new Set<Port>();
  for (const lane of cell.road ?? []) {
    if (lane.to.includes(oppositePort(lane.from))) out.add(lane.from);
  }
  return [...out].sort((a, b) => a - b);
}
