// Lateral lane offset for road vehicles and the debug lane overlay.
//
// A road car drives in a lane offset to the RIGHT of its direction of travel,
// measured perpendicular from the tile centreline. The painted road SURFACE
// tapers across a tile when its neighbour has a different lane count: the wider
// tile narrows over its own length to meet the narrower neighbour flush at the
// shared seam (the "min-seam" rule, see roadGeometry.ts / Tile.vue roadPaths).
//
// The lateral offset of a given lane position must follow that taper, or a car
// (and the debug arrow) snaps sideways at the tile boundary because the same
// lane index maps to a different distance-from-centre on each side. This module
// is the single, Vue-free source of that offset math, shared by the car
// renderer (game.ts) and the debug lane-graph overlay (Tile.vue).

// Physical width of one lane as a fraction of tile size (28px at 200px). Must
// match the same constant in game.ts and Tile.vue.
export const LANE_WIDTH_FRAC = 0.14;

// The lane-positioning band for a road approach: half the combined lanes of both
// travel directions, (forward + backward) / 2.
//
// Lane offsets anchor at the tile CENTRELINE and grow outward to the kerb, which
// is right for a BIDIRECTIONAL road: each direction owns one half and the
// centreline is the divider between them, so `forward === backward` and this is
// just `forward` — the original behaviour, unchanged. But a ONE-WAY road has no
// oncoming traffic to fill the other half (`backward === 0`); anchoring its lanes
// at the centreline pushes them all onto the right half, leaving half the
// pavement empty and the outer lane hanging off the kerb. Using `(forward + 0)/2`
// instead re-centres the one-way lanes in the tile so they fill the painted
// surface (which is always centred and `max(forward + backward, 2)` wide).
export function positioningBand(forward: number, backward: number): number {
  return (forward + backward) / 2;
}

// The same-direction lane band that actually crosses a port seam under the
// min-seam rule: the wider tile tapers down to the narrower neighbour, so the
// band at the seam is the smaller of this tile's band and the neighbour's.
// `neighbourBand <= 0` means there is no road neighbour there (a map edge / road
// end), so this tile's own band stands — nothing to taper toward.
export function seamBand(selfBand: number, neighbourBand: number): number {
  return neighbourBand > 0 ? Math.min(selfBand, neighbourBand) : selfBand;
}

// The positioning band at a seam, junction-aware — the band-side counterpart of
// the painting rule in tiles/lanes.ts (roadSeamPaintTotal/junctionArmPaintTotal):
// at a junction↔road seam the ROAD's real band is authoritative on BOTH sides,
// because a junction's per-arm `laneCountAt` tallies the movements that fan
// through the arm, not the arm's real width. Min-ing against it (plain seamBand)
// only corrects an over-count; an under-counted arm (some road lanes never
// targeted) would position vehicles and guides on a narrower band than the
// painted road — half a lane off the markings right at the junction mouth.
//   junction meeting a road  → the road's band (the junction adopts the road)
//   road meeting a junction  → its own band   (a junction never pinches a road)
//   road↔road                → min            (the legit lane-change taper)
//   junction↔junction        → MAX band       (two stacked junctions both adopt the
//                                WIDER arm — a junction is never pinched by a
//                                neighbour, road OR junction. The wider side is the
//                                full approach count; the narrower side is only the
//                                straight-through movements the junction below
//                                carries. Using the max keeps BOTH sides on the same
//                                band, so the through-lanes stay continuous across
//                                the seam AND a turn entry sits on its real lanes
//                                instead of being squeezed inward.)
//   no neighbour road        → own band       (an open road end keeps its width)
export function seamPositioningBand(
  selfBand: number,
  selfIsJunction: boolean,
  neighbourBand: number,
  neighbourIsJunction: boolean,
): number {
  if (neighbourBand <= 0) return selfBand;
  if (selfIsJunction && !neighbourIsJunction) return neighbourBand;
  if (!selfIsJunction && neighbourIsJunction) return selfBand;
  if (selfIsJunction && neighbourIsJunction) return Math.max(selfBand, neighbourBand);
  return Math.min(selfBand, neighbourBand);
}

// The lateral offset (px, right-of-travel) of lane position `lanePos` at a seam
// where this tile's same-direction band (`selfBand` lanes) meets a band of
// `seamWidth` lanes (the min-seam result). 0 = kerb-side, selfBand-1 = centre.
//
// Lanes are anchored at the CENTRELINE and grow outward to the kerb, so a
// narrowing eats the road from the KERB inward: the centre-adjacent lanes
// survive and the kerb lanes drop (see roadGeometry.ts `laneDropGore`, whose
// closure sits on the kerb strip). A lane's natural distance from centre is
// `(selfBand - 0.5 - lanePos)·W`; at the seam it is clamped so it never reaches
// past the narrow kerb (`(seamWidth - 0.5)·W`). That clamp does two correct
// things at once: a surviving (inner) lane is already inside the narrow band so
// it is unchanged, while a dropping (kerb) lane is pulled in to the narrow kerb
// to merge — and crucially NO lane is ever pushed to a negative offset across
// the centreline into oncoming traffic (the bug the old band-substitution
// `(seamWidth - 0.5 - lanePos)·W` produced for every inner lane).
// This is the BIDIRECTIONAL rule: the road owns one half (lanes on the +n side,
// the centreline is the divider with oncoming), so a narrowing drops the OUTER
// kerb lane and the offset is clamped inward (`min(natural, seamWidth - 0.5)`) —
// inner lanes hold, the kerb lane merges, and no lane crosses the centreline.
//
// ONE-WAY roads do NOT come through here: they are kerb-anchored to their run's
// widest lane count (`oneWayLaneOffsetPx` below), so their through-lanes are
// run-constant and no seam adjustment applies at all. A `centred` band-
// substitution variant used to live here for one-way; it was superseded by the
// run-max kerb anchor and is gone.
export function laneSeamOffsetPx(
  lanePos: number,
  selfBand: number,
  seamWidth: number,
  tileSize: number,
): number {
  const natural = selfBand - 0.5 - lanePos;
  return Math.min(natural, seamWidth - 0.5) * tileSize * LANE_WIDTH_FRAC;
}

// Lateral offset (px, right-of-travel) for a coupler at continuous lane position
// `lanePos` (0 = kerb-side, selfBand-1 = centre-adjacent) and progress `t` (0 at
// the entry port, 1 at the exit port) along a STRAIGHT tile of `selfBand` lanes
// whose same-direction band tapers to `bandEntry` lanes at the entry seam and
// `bandExit` at the exit seam (the min-seam rule). Interpolating the seam offsets
// of the two ends makes a dropping lane glide inward to merge as the painted kerb
// shifts — exactly matching the tapered surface — instead of jumping at the seam,
// while a surviving lane holds its line.
//
// For a uniform road (bandEntry === bandExit === selfBand) this reduces to the
// constant `(selfBand - 0.5 - lanePos)·W`, so non-tapering roads are unchanged.
export function laneOffsetPx(
  lanePos: number,
  selfBand: number,
  bandEntry: number,
  bandExit: number,
  t: number,
  tileSize: number,
): number {
  const offEntry = laneSeamOffsetPx(lanePos, selfBand, bandEntry, tileSize);
  const offExit = laneSeamOffsetPx(lanePos, selfBand, bandExit, tileSize);
  return offEntry + (offExit - offEntry) * t;
}

// Kerb-anchored lateral offset (px, +n right-of-travel) for a ONE-WAY HIGHWAY
// lane drop. One-way roads anchor to the run's widest lane count `runMax` along
// their contiguous run, so the through lanes run dead straight and lanes are
// added / dropped on the LEFT (centre side) — the kerb lane (index 0) holds.
// This matches the canonical lane index used EVERYWHERE else (`index 0 = kerb`;
// see `laneOffsetConstPx`, tiles/editOps.ts, and the sim's keep-right discipline
// `kerbMostLane = min index`). Lane `lanePos` (0 = kerb / right-of-travel,
// highest index = centre side / left) sits at `(runMax/2 − 0.5 − lanePos)·W` from
// the centreline — the same form as `laneOffsetConstPx` with band = runMax/2.
// Because the offset depends only on the lane index and the (run-constant)
// `runMax`, a surviving lane has the SAME offset on every tile of the run — no
// seam taper — and a car merging out of the dropping (centre) lane glides as its
// fractional lane index eases down toward the kerb (the sim's `desiredLane` keeps
// lanes 0..n-1 and merges the highest index down: "keep the kerb lanes, drop the
// centre lane"). Flipping this to index0=kerb is what makes a one-way junction's
// straight + turn arrows and the painted markings all land on the same lane.
export function oneWayLaneOffsetPx(lanePos: number, runMax: number, tileSize: number): number {
  return (runMax / 2 - 0.5 - lanePos) * tileSize * LANE_WIDTH_FRAC;
}

// The lane index a vehicle must take on the next tile to keep the PHYSICAL
// lateral position it already has, across a straight-road seam where the lane
// count changes. The inverse of the offset rules above, and the reason it exists:
// a lane index means nothing on its own — it is an index into an anchored band,
// and the two anchors move a lane index in opposite directions.
//
//  • BIDIRECTIONAL (centre-anchored, `laneSeamOffsetPx`): lane `i` sits at
//    `(count - 0.5 - i)·W` from the centreline, so lanes are added and dropped on
//    the KERB side and the same physical lane is `i + (toCount - fromCount)` on
//    the other side of the seam. Carrying the raw index across instead is what
//    swept a car entering a 1→3 widening from the centre-adjacent lane clear
//    across to the far kerb — two lanes of lateral movement it never decided to
//    make, and against the merge arrows painted on the tile.
//  • ONE-WAY (`kerbAnchored`, `oneWayLaneOffsetPx`): lane `i` sits at
//    `(runMax/2 - 0.5 - i)·W` for the whole run, so lanes are added and dropped on
//    the CENTRE side and index 0 is the same tarmac on both sides — the index
//    carries across unchanged.
//
// Clamped into the destination's lanes, which is also the merge case: when a
// narrowing eats more lanes than the vehicle has moved out of, every dropping
// lane maps onto the surviving kerb/centre lane — exactly where the tapered
// offsets converge.
export function laneIndexAcrossSeam(
  lane: number,
  fromCount: number,
  toCount: number,
  kerbAnchored: boolean,
): number {
  if (toCount <= 0) return lane;
  const shifted = kerbAnchored ? lane : lane + (toCount - fromCount);
  return Math.max(0, Math.min(toCount - 1, shifted));
}

// Constant lateral offset (px) for a lane position on a tile whose band does not
// taper (a uniform road, or a curve/junction where the surface keeps a constant
// width). Equivalent to laneOffsetPx with bandEntry === bandExit.
export function laneOffsetConstPx(
  lanePos: number,
  band: number,
  tileSize: number,
): number {
  return (band - 0.5 - lanePos) * tileSize * LANE_WIDTH_FRAC;
}
