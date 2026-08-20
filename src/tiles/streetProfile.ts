import type { Coordinates } from "@/types";
import type { Level, Port, TileCell } from "@/tiles/model";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import {
  isOneWayStraight,
  isRoadJunction,
  junctionArmPaintTotal,
  laneCount,
  laneCountAt,
  oneWayRunMax,
  roadSeamPaintTotal,
} from "@/tiles/lanes";
import { LANE_WIDTH_FRAC } from "@/sim/laneOffset";
import {
  bankFor,
  bankOf,
  needsBigBay,
  rowsOf,
  stallDepthPx,
  stallOnLane,
} from "@/tiles/parking";

// THE STREET PROFILE — one answer to "what is this street, laterally?"
//
// A tile has always stored who USES the street (directed lanes, parking rows, a
// footway opt-out) and left what the street IS — its cross-section — implicit.
// Every layer then derived its own lateral positions: the surface paint had a
// seam rule (`roadSeamPaintTotal`), the car offsets another (`laneOffset.ts`
// min-seam / one-way run anchoring), the pavement grew a third, the kerb was
// computed in `parking.ts`, and the walkers read the pavement through a parallel
// path. Seven derivations of one physical fact — and every pairwise disagreement
// shipped as a visible bug (the pavement under the bays, the walkers beside the
// paint, the bands through the car-park ranks: see KNOWHOW's trap list).
//
// This module is the single façade over that fact. For a tile's seam it answers,
// per FLANK (the two perpendicular ports of the seam), the ordered strips from
// the road's centreline outward:
//
//     carriageway → kerbside parking → verge → pavement
//
// (Across-kerb parking — drives, forecourts — is deliberately NOT a strip: it
// lies beyond the pavement, on the property side, and the pavement never moves
// for it. That is the street cross-section rule,
// docs/superpowers/specs/2026-08-20-street-cross-section-design.md.)
//
// Seams are where the profile is resolved because seams are where two tiles
// must AGREE: every number here is computed symmetrically from the pair of
// adjacent cells, so `resolveSeamProfile(A, p)` and
// `resolveSeamProfile(B, opposite(p))` describe the same physical edge. A
// tile's interior is then linear interpolation between its two seam profiles —
// one taper rule for every layer at once.
//
// Migration state: the pavement (paint + walkers) reads this façade, and the
// SURFACE PAINT's seam widths do too (`Tile.vue` roadPaths reads
// `seamPaintLanes` for its centred ribbons; its one-way straight branch still
// derives entry/exit counts locally for the gores and survivor markings, in
// asserted lockstep with `oneWayCentreBand`). The carriageway numbers wrap the
// same primitives the lane offsets use (`roadSeamPaintTotal` /
// `junctionArmPaintTotal` / `oneWayRunMax`), so the remaining consumers can
// migrate call by call without a pixel moving; the kerb's own home stays
// `parking.ts` (`kerbOffsetPx`), which this module composes rather than
// duplicates.

// All widths in FRACTIONS OF A TILE, the one scale-free unit. At the native
// 200px tile: a lane 28px, the verge 8px, the pavement 16px.
export const PROFILE_LANE_FRAC = LANE_WIDTH_FRAC; // 0.14
// LOCKSTEP with `tiles/footway.ts` (PAVEMENT_GAP = 4, PAVEMENT_WIDTH = 8 ground
// units of 100 per tile). Footway imports THIS module, so the numbers live here
// and footway's own constants are checked against them by the profile sweep.
export const VERGE_FRAC = 0.04;
export const PAVEMENT_FRAC = 0.08;

export type StripKind = "carriageway" | "parking" | "verge" | "pavement";

export interface ProfileStrip {
  kind: StripKind;
  // Signed distance from the road CENTRELINE along this flank's outward normal,
  // as fractions of a tile. `inner < outer`. The carriageway strip starts at 0
  // on a two-way road; on a one-way road's centre flank it can start below 0
  // (the surface is kerb-anchored, not centred — see `roadEdgeFrac`).
  inner: number;
  outer: number;
}

export interface FlankProfile {
  // Which side of the street, as an absolute port — one of the two
  // perpendicular neighbours of the seam's own port.
  flank: Port;
  // Ordered outward. Always starts with the carriageway; parking / verge /
  // pavement follow only where they exist.
  strips: ProfileStrip[];
  // The painted road edge on this flank — where the kerb line is.
  kerb: number;
  // The pavement band's centreline, or null where the tile has no footway.
  // THE number the walkers stand on and the paint strokes; keeping it here is
  // what makes "paint and people disagree" structurally impossible for every
  // consumer that reads the profile.
  pavement: number | null;
}

export interface SeamProfile {
  port: Port;
  flanks: [FlankProfile, FlankProfile];
}

/** The two flank ports of a seam: the ports perpendicular to it. */
export function seamFlanks(port: Port): [Port, Port] {
  // Ports are 0..3 (Top,Right,Bottom,Left); the perpendicular pair is the other
  // axis. Order is stable (lower port first) so callers can rely on it.
  const a = ((port + 1) % 4) as Port;
  const b = ((port + 3) % 4) as Port;
  return a < b ? [a, b] : [b, a];
}

export function flankAt(profile: SeamProfile, flank: Port): FlankProfile {
  const hit = profile.flanks.find(f => f.flank === flank);
  if (!hit) throw new Error(`port ${flank} does not flank seam ${profile.port}`);
  return hit;
}

/**
 * The painted road edge on `flank`, at the seam through `port`, in tile
 * fractions from the centreline.
 *
 * Wraps the exact primitives the paint and the lane offsets already use, so a
 * consumer that migrates from them to the profile does not move a pixel:
 *  · two-way / bends / junction arms: `roadSeamPaintTotal` /
 *    `junctionArmPaintTotal` over the pair of adjacent cells — the same
 *    junction-aware pairing `Tile.vue`'s roadPaths performs.
 *  · one-way straights: kerb-anchored to the run's widest count
 *    (`oneWayRunMax`) — constant along the run on the kerb flank, while the
 *    centre flank follows the per-seam lane count (lanes open and close on the
 *    centre side; `bandsFor`'s one-way branch has always drawn it that way).
 */
export function roadEdgeFrac(
  level: Level,
  coord: Coordinates,
  port: Port,
  flank: Port,
): number {
  const cell = level[getCoordinatesId(coord)];
  const road = cell?.road;
  if (!road?.length) return 0;

  // ONE-WAY straight: asymmetric about the centreline. Which flank is the kerb
  // depends on the direction of travel — right-of-travel is the kerb side.
  const oneWayFrom = oneWayApproach(road, port);
  if (oneWayFrom !== null) {
    const runMax = oneWayRunMax(c => level[getCoordinatesId(c)]?.road, coord, oneWayFrom);
    const kerbFlank = bankFor(oneWayFrom, "right");
    const kerb = (runMax / 2) * PROFILE_LANE_FRAC;
    if (flank === kerbFlank) return kerb;
    // CENTRE flank: the tarmac a stream brings to a seam is the tarmac it had.
    // The entry edge adopts the upstream one-way's own count, the exit edge
    // carries this tile's own — so every one-way↔one-way seam AGREES by
    // construction and each width change happens DOWNSTREAM of its seam: the
    // gore closes a lane at full width, and the tile after it carries the
    // recovery taper back to its own count (a widening keeps its fan-out
    // downstream exactly as before). This replaced the old stepped exit edge
    // (max(entry, exit)), whose one-lane jump at every gore seam was the one
    // asymmetry the profile had to exempt from its symmetry sweep — and the
    // visible pavement step the boards showed at every one-way lane drop.
    const m = oneWayCentreBand(level, coord, port, oneWayFrom);
    return m * PROFILE_LANE_FRAC - kerb;
  }

  const selfJunction = isRoadJunction(road);
  // NO min-2 floor here, in lockstep with the footway's `paintedHalfAt` (whose
  // numbers the pavement has always stood on) rather than with parking's
  // `kerbOffsetPx` (which floors). The two disagree only on one-way BENDS,
  // where no parking row is legal anyway — but a profile that floored would
  // move every pavement on a 1-lane one-way bend the day footway migrates.
  const selfAt = laneCountAt(road, port);
  const n = neighborCoord(coord, port);
  const nCell = n ? level[getCoordinatesId(n)] : undefined;
  const nCrossing = nCell ? laneCountAt(nCell.road, oppositePort(port)) : 0;
  const nJunction = isRoadJunction(nCell?.road);
  const total = selfJunction
    ? junctionArmPaintTotal(selfAt, nCrossing, nJunction)
    : roadSeamPaintTotal(selfAt, nCrossing, nJunction);
  return (total / 2) * PROFILE_LANE_FRAC;
}

/**
 * The painted lane TOTAL crossing a seam — `roadEdgeFrac` in the paint's unit
 * (lanes of tarmac). The sum of the two flank edges, so it is right for every
 * surface: on a centred (two-way / bend / junction-arm) seam the flanks are
 * equal halves; on a one-way straight the kerb flank carries the run anchor and
 * the centre flank the (possibly stepped) band, and their sum is the true
 * painted width at that seam. `Tile.vue`'s roadPaths strokes exactly this many
 * lanes of tarmac at the seam — it reads THIS number, so the surface and the
 * profile cannot drift apart.
 */
export function seamPaintLanes(level: Level, coord: Coordinates, port: Port): number {
  const [f0, f1] = seamFlanks(port);
  return (
    (roadEdgeFrac(level, coord, port, f0) + roadEdgeFrac(level, coord, port, f1)) /
    PROFILE_LANE_FRAC
  );
}

/**
 * The kerbside-parking outset a flank needs at a seam, in tile fractions —
 * the larger of what the two adjacent tiles stand on that flank.
 *
 * VISIBLE parallel rows only. Across-kerb ranks live beyond the pavement (the
 * cross-section rule), a halt never leaves the carriageway, and bare kerb
 * (`row.informal`) paints nothing — counting it once pushed every pavement on
 * the board off its street, which is how the rule got its wording: the profile
 * goes round what you can SEE.
 *
 * Symmetric by construction: both tiles of the seam compute max over the same
 * two cells, which is what makes the pavement one connected line.
 */
export function parkingOutsetFrac(
  level: Level,
  coord: Coordinates,
  port: Port,
  flank: Port,
): number {
  const own = flankParkingDepthFrac(level[getCoordinatesId(coord)], flank);
  const n = neighborCoord(coord, port);
  if (!n) return own;
  const nCell = level[getCoordinatesId(n)];
  // A neighbour only pulls this flank outward if a band actually CONTINUES into
  // it: it has a pavement at all, and its road crosses the shared seam. An
  // aisle with `footway: "none"` beside a street keeps its parking to itself.
  if (!hasFootwayCell(nCell)) return own;
  if (laneCountAt(nCell?.road, oppositePort(port)) === 0) return own;
  return Math.max(own, flankParkingDepthFrac(nCell, flank));
}

/**
 * The full cross-section a tile presents at one of its seams.
 *
 * `resolveSeamProfile(A, p)` and `resolveSeamProfile(neighbour, opposite(p))`
 * agree strip for strip wherever both tiles carry the strip — asserted board-
 * wide by the profile sweep, because that agreement IS the connectedness of
 * every band on the board.
 */
export function resolveSeamProfile(level: Level, coord: Coordinates, port: Port): SeamProfile {
  const cell = level[getCoordinatesId(coord)];
  const flanks = seamFlanks(port);
  const footway = hasFootwayCell(cell);
  return {
    port,
    flanks: [
      flankProfile(level, coord, cell, port, flanks[0], footway),
      flankProfile(level, coord, cell, port, flanks[1], footway),
    ] as [FlankProfile, FlankProfile],
  };
}

// --- internals -----------------------------------------------------------------

function flankProfile(
  level: Level,
  coord: Coordinates,
  cell: TileCell | undefined,
  port: Port,
  flank: Port,
  hasFootway: boolean,
): FlankProfile {
  const footway = hasFootway;
  const kerb = roadEdgeFrac(level, coord, port, flank);
  const strips: ProfileStrip[] = [{ kind: "carriageway", inner: carriagewayInner(kerb), outer: kerb }];
  let edge = kerb;
  const parking = parkingOutsetFrac(level, coord, port, flank);
  if (parking > 0) {
    strips.push({ kind: "parking", inner: edge, outer: edge + parking });
    edge += parking;
  }
  let pavement: number | null = null;
  if (footway) {
    // The walker centre first, because IT is the truth the footway has always
    // clamped: min(edge + verge + half-band, tile edge − half-band). On a wide
    // road (a 3+3 boulevard's kerb is at 0.42) the clamp eats the verge and the
    // band sits flush against the kerb — which is what the boards have always
    // drawn, so the profile says "zero-width verge" rather than inventing one.
    pavement = Math.min(edge + VERGE_FRAC + PAVEMENT_FRAC / 2, 0.5 - PAVEMENT_FRAC / 2);
    const bandInner = pavement - PAVEMENT_FRAC / 2;
    // NO ROOM IS NO PAVEMENT. On a wide junction arm (a 4-lane approach puts
    // the kerb at 0.56) the old footway clamped the band to 0.46 — INSIDE the
    // carriageway — and the surface painted over it, an absurdity nobody saw
    // until this resolver had to state it. Where the clamped band cannot even
    // clear the outermost solid thing, the honest answer is: no pavement here.
    if (bandInner < edge - 1e-9) {
      pavement = null;
    } else {
      strips.push({ kind: "verge", inner: edge, outer: Math.max(edge, bandInner) });
      strips.push({ kind: "pavement", inner: bandInner, outer: pavement + PAVEMENT_FRAC / 2 });
    }
  }
  // A last monotone pass: on a board the validator would reject (bays deeper
  // than the tile, mid-edit states in the editor) the natural strips can
  // overlap. The paint regions are clamped outward-monotone — zero-width where
  // reality has no room — while `pavement` above keeps the walkers' clamped
  // centre untouched, so parity with the footway survives even on illegal
  // boards.
  let lo = Number.NEGATIVE_INFINITY;
  for (const strip of strips) {
    strip.inner = Math.max(strip.inner, lo);
    strip.outer = Math.max(strip.outer, strip.inner);
    lo = strip.outer;
  }
  return { flank, strips, kerb, pavement };
}

// Where the carriageway strip starts on a flank. On a centred (two-way) surface
// that is the centreline; expressing it as `-otherHalf` would double-count the
// street, so each flank simply owns [0, kerb]. A one-way's centre flank can have
// a NEGATIVE kerb (the surface stops short of the centreline); the strip is then
// empty on that side and the carriageway lies wholly on the kerb flank.
function carriagewayInner(kerb: number): number {
  return Math.min(0, kerb);
}

// The visible kerbside parking standing on `flank` of this cell, in tile
// fractions of depth (bay depth + authored gap).
function flankParkingDepthFrac(cell: TileCell | undefined, flank: Port): number {
  let out = 0;
  for (const row of rowsOf(cell)) {
    if (bankOf(row) !== flank) continue;
    if (row.kind !== "parallel") continue;
    if (row.informal) continue;
    if (stallOnLane(row.kind)) continue;
    const depth = stallDepthPx(row.kind, 200, needsBigBay(row.reserved)) / 200;
    out = Math.max(out, depth + (row.gap ?? 0) * PROFILE_LANE_FRAC);
  }
  return out;
}

function hasFootwayCell(cell: TileCell | undefined): boolean {
  if (!cell?.road || cell.road.length === 0) return false;
  return cell.footway !== "none";
}

// The one-way approach whose straight movement crosses `port`, or null when the
// tile is not a one-way straight along that axis.
function oneWayApproach(road: TileCell["road"], port: Port): Port | null {
  for (const from of [port, oppositePort(port)] as Port[]) {
    if (isOneWayStraight(road, from)) return from;
  }
  return null;
}

// The centre-side band of a one-way straight at one of its two seams, in lanes.
//
// ENTRY seam: what the upstream street brings. A same-direction one-way
// neighbour is adopted at ITS own count — wider after a gore (this tile then
// carries the recovery taper), narrower before a fan-out (unchanged, the min
// rule always gave that) — so the seam agrees from both sides. Any other feeder
// (junction, two-way, map edge) keeps the min-seam rule.
//
// EXIT seam: this tile's OWN count, always. A lane drop is shut by the hatched
// gore at full width on the tile that owns the gore, and the taper back down
// belongs to the tile after the seam — never to the seam itself.
function oneWayCentreBand(level: Level, coord: Coordinates, port: Port, from: Port): number {
  const m = laneCount(level[getCoordinatesId(coord)]?.road, from);
  if (port !== from) return m;
  const n = neighborCoord(coord, from);
  const nRoad = n ? level[getCoordinatesId(n)]?.road : undefined;
  if (!nRoad?.length) return m;
  if (isOneWayStraight(nRoad, from)) return laneCount(nRoad, from);
  const crossing = laneCountAt(nRoad, oppositePort(from));
  return !isRoadJunction(nRoad) && crossing > 0 ? Math.min(m, crossing) : m;
}
