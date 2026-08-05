import type { Level, TileCell, Port } from "@/tiles/model";
import { Position } from "@/types";
import { parseCoordId } from "@/tiles/model";
import { oppositePort, neighborCoord } from "@/sim/topology";
import { isOneWayStraight } from "@/tiles/lanes";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { levelBounds } from "@/tiles/bounds";
import { plotsOf } from "@/tiles/cities";
import {
  bankFor,
  bankOf,
  rowsOf,
  validateParking,
  type ParkingCell,
  type ParkingRow,
} from "@/tiles/parking";

// THE DRIVE — where a car sleeps.
//
// The workplace pass (`workplaceParking.ts`) answered the day half of the
// question: a commuter's car has to stop somewhere at the office, and there are
// three spaces for ninety-six people. This is the night half, and it is the one
// the map has been quietly assuming all along.
//
// Until now a resident's car simply EVAPORATED at the front door, and the
// justification written into the citizen sim was "a house has a driveway". That
// is true, and it was doing a lot of work for something nothing on the board
// modelled: nobody could see it, nothing counted it, and above all nothing ran
// OUT of it. So derive it. Every home plot gets its own off-street parking on
// the road tile its driveway joins — the hardstanding, the pair of ruts, the
// garage in front of the house — and it belongs to that address and no other
// (`ParkingRow.resident`).
//
// WHY THIS IS A MECHANIC AND NOT A COURTESY: the drive is a FIXED two spaces,
// and the household is not fixed. A home plot holds four people at density 0 and
// thirty-two at density 3 (`cities.ts` CAPACITY), so the same two spaces cover
// every car at a bungalow and a fraction of them at a block of flats. Nobody
// authored that gradient and nobody has to maintain it: it falls out of a
// building that grows taller while its frontage does not, which is also why
// terraced streets in real towns are the ones lined with parked cars.
//
// Where the drive is full, the overspill goes on the street — ordinary public
// parking, competed for, and the player's lever is to build some.
//
// Design: docs/superpowers/specs/2026-08-05-home-parking-design.md

// Spaces on one home's drive. TWO, and it is the number the whole gradient hangs
// off, so it is worth saying why it is not one and not four.
//
//  · Not ONE. A household with a car and a car is the ordinary case, not the
//    exceptional one, and a single space would put half of even a BUNGALOW's
//    residents on the street — which would make the density gradient below
//    meaningless, because everybody would be short from the start.
//  · Not FOUR. Two 90° bays are 56px of a 200px frontage; four are 112px, which
//    is most of the house's width and reads as a small car park rather than as
//    somebody's drive. It would also cover a density-2 terrace outright, and the
//    whole point is that building UP eventually outgrows the ground.
export const DRIVE_SPACES = 2;

// A drive is NOT a car park that happens to be private, and the dwell says so.
// Nothing ambient can take one of these (the permit gate closes it), so this
// number only ever applies to a car whose owner never comes back for it — the
// backstop that stops an emigrant's car holding the family drive for the rest of
// the run. Long, because a car really does sit on a drive all weekend.
const DRIVE_DWELL_SEC: [number, number] = [1800, 3600];

export interface HomeParkingOptions {
  // Seed for `plotsOf` — must match the seed the citizen world is built with, or
  // the houses this pass gives drives to are not the houses people live in.
  seed?: number;
  tileSize?: number;
  // Spaces per drive. Boards that want a denser town can turn it down; the
  // default is the one the gradient above is reasoned about.
  spaces?: number;
}

/**
 * The level with a private drive laid at every house that has a frontage for one.
 *
 * Pure and IDEMPOTENT, on the same terms as the workplace pass: a kerb that
 * already carries a row — authored, a staff forecourt, or a drive from an
 * earlier run — is left exactly as it is.
 *
 * ONE DRIVE PER HOUSE, not one per frontage. A corner plot with a street on two
 * sides is still one household with one drive, and laying a rank on each side
 * would quietly hand it four spaces while its neighbour mid-terrace got two. So
 * each home plot picks a single frontage tile (the first that can carry a rank,
 * in port order) and that is its drive.
 *
 * Every row is put through `validateParking` and any the validator objects to is
 * dropped rather than shipped — the objections are not all local (a rank can
 * turn a stub into a car park with no way out), so a derived pass has to be able
 * to back out.
 */
export function deriveHomeParking(level: Level, opts: HomeParkingOptions = {}): Level {
  const { seed = 1, tileSize = 200, spaces = DRIVE_SPACES } = opts;
  if (spaces <= 0) return level;
  const homes = plotsOf(level, seed).filter(p => p.kind === "home");
  if (homes.length === 0) return level;

  // Candidate rows, keyed by tile, built against the ORIGINAL level so a drive
  // laid at one house never changes whether the next one qualifies. The banks
  // already spent on parking are tracked as we go, though: two houses facing the
  // SAME road tile from opposite sides each get their own drive on their own
  // kerb, and both have to land in the same map.
  const additions = new Map<string, ParkingRow[]>();
  // Addresses that ALREADY have a drive somewhere on this level. Idempotence is
  // per HOUSEHOLD, not per kerb, and the difference is not academic: a second
  // run finds the house's first-choice frontage occupied — by its own drive —
  // and, checking only banks, would walk on to the next street the plot touches
  // and lay it a second one. Corner houses quietly grew a drive per run.
  const housed = new Set<string>();
  for (const cell of Object.values(level)) {
    for (const row of rowsOf(cell)) if (row.resident) housed.add(row.resident);
  }
  const taken = new Map<string, Set<Port>>();
  const banksOf = (tileId: string): Set<Port> => {
    let s = taken.get(tileId);
    if (!s) {
      s = new Set<Port>(rowsOf(level[tileId]).map(bankOf));
      taken.set(tileId, s);
    }
    return s;
  };

  // Sorted, so a board grows the same drives on every run and a house that has
  // to share a frontage tile with a neighbour loses the race deterministically.
  for (const home of [...homes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (housed.has(home.id)) continue;
    const spot = frontageFor(level, home.id, banksOf);
    if (!spot) continue;
    banksOf(spot.tileId).add(spot.bank);
    const rows = additions.get(spot.tileId) ?? [];
    rows.push({
      from: spot.from,
      side: spot.side,
      // NOSE IN, off the carriageway. A drive is not a kerbside space: you pull
      // straight onto it, across the kerb, and leave the car facing the house.
      // It is also what makes the board readable at a glance — a car standing at
      // 90° to the street is unmistakably ON somebody's property, where a car
      // lying along the kerb is just parked outside.
      kind: "perpendicular",
      count: spaces,
      // CENTRED on the frontage, which is the opposite of what the staff ranks
      // want. A workplace forecourt packs to the tile edge so a run of them down
      // one street reads as one continuous parking edge; a drive must NOT do
      // that. It belongs to one house, so it sits in the middle of that house's
      // frontage with kerb either side of it, exactly as a real one does.
      align: "centre",
      // NO WHITE LINES. Nobody paints bay markings on their own hardstanding —
      // see `validateParking`, which allows an unmarked non-kerbside row only
      // for a private drive, and for exactly this reason.
      marking: "none",
      // WHOSE IT IS. Everything else here is paint; this is the field that makes
      // the drive private, and it is why a street of houses reads as full to a
      // passing stranger and as empty to the people who live there.
      resident: home.id,
    });
    additions.set(spot.tileId, rows);
  }

  if (additions.size === 0) return level;

  let next = applyRows(level, additions);
  // Back out anything the validator objects to. Dropping one tile's rows can
  // clear an objection raised elsewhere (the way-out flood fill is per FACILITY),
  // so re-check until it settles — bounded, because each pass drops at least one
  // tile's worth or stops.
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

/** Address → the tile its drive ended up on. For tests and for a scenario's own assertions. */
export function homeDriveTiles(level: Level, opts: HomeParkingOptions = {}): Record<string, string> {
  const next = deriveHomeParking(level, opts);
  const out: Record<string, string> = {};
  for (const tileId of Object.keys(next).sort()) {
    for (const row of rowsOf(next[tileId])) {
      if (row.resident) out[row.resident] = tileId;
    }
  }
  return out;
}

// --- internals -----------------------------------------------------------------

interface Frontage {
  tileId: string;
  from: Port;
  side: "right" | "left";
  bank: Port;
}

/**
 * The one road tile this house's drive joins, and which kerb of it.
 *
 * Neighbours only. A drive runs from the house onto the street it fronts onto —
 * `ROAD_ACCESS_TILES` is 1 for the same reason ("your street is the one you can
 * see from the door"), and a drive that crossed a tile of somebody else's garden
 * to reach the road would be a private road, which is a different thing.
 */
function frontageFor(
  level: Level,
  homeId: string,
  banksOf: (tileId: string) => Set<Port>,
): Frontage | null {
  const coord = parseCoordId(homeId);
  // Port order (Top, Right, Bottom, Left), so the choice is stable and a house
  // with two frontages always picks the same one.
  const ports: Port[] = [Position.Top, Position.Right, Position.Bottom, Position.Left];
  for (const dir of ports) {
    const n = neighborCoord(coord, dir);
    if (!n) continue;
    const tileId = getCoordinatesId(n);
    const cell = level[tileId];
    if (!cell?.road?.length || !canCarryADrive(cell)) continue;
    // The kerb the house is on, seen from the road tile: the house lies back the
    // way we came.
    const bank = oppositePort(dir);
    if (banksOf(tileId).has(bank)) continue;
    // WHICH APPROACH SERVES THAT KERB, and the rule is the validator's own.
    // "right" is the near kerb and always legal; "left" is the far bank, which a
    // driver may only be sent across where there is no oncoming stream — a
    // one-way street. On a two-way straight both banks come back as somebody's
    // "right", so the illegal case never has to be asked for.
    for (const from of straightApproaches(cell)) {
      const sides: ("right" | "left")[] = isOneWayStraight(cell.road, from)
        ? ["right", "left"]
        : ["right"];
      for (const side of sides) {
        if (bankFor(from, side) !== bank) continue;
        return { tileId, from, side, bank };
      }
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
      label: cell.parking?.label ?? "Residents",
      dwellSec: cell.parking?.dwellSec ?? DRIVE_DWELL_SEC,
      rows: [...(cell.parking?.rows ?? []), ...rows],
    };
    out[tileId] = { ...cell, parking };
  }
  return out;
}

// A tile that can hold a drive at all. Cheap local vetoes only; the expensive,
// non-local rules (a tapering kerb, bays that overhang the tile beside a wide
// road, a car park with no way out) are left to `validateParking`, which this
// pass runs and honours.
//
// The overhang rule is the one that bites here and it is worth knowing about
// rather than being surprised by: a 90° bay is 48px deep, so it lands inside the
// tile beside a two-lane street (kerb 28px) and overhangs beside a 2+2 arterial
// (kerb 56px). Houses front onto streets, not onto arterials, and where somebody
// has drawn one they will get no drives and their residents park on the road —
// which is exactly what living on a main road is like.
function canCarryADrive(cell: TileCell | undefined): boolean {
  if (!cell?.road?.length) return false;
  // NOT ON A LEVEL CROSSING. A drive is a place a car stands for hours; the
  // booms' reach is the worst of all of them.
  if (cell.connections.length > 0) return false;
  return true;
}

// The approaches that run straight through — the only ones a row is legal on
// (nobody parks in a bend or a junction box). Sorted so the pass lays the same
// drives on every run.
function straightApproaches(cell: TileCell): Port[] {
  const out = new Set<Port>();
  for (const lane of cell.road ?? []) {
    if (lane.to.includes(oppositePort(lane.from))) out.add(lane.from);
  }
  return [...out].sort((a, b) => a - b);
}
