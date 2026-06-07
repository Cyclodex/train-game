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
// `centred` distinguishes the two band layouts. A BIDIRECTIONAL road owns one
// half (lanes on the +n side, the centreline is the divider with oncoming): a
// narrowing drops the OUTER kerb lane, so the offset is clamped inward
// (`min(natural, seamWidth - 0.5)`) — inner lanes hold, the kerb lane merges,
// and no lane crosses the centreline. A ONE-WAY road has its lanes CENTRED about
// the centreline (no oncoming half to anchor against), so a lane drop is a
// symmetric squeeze split across BOTH kerbs: scale the whole band toward the
// narrower seam (`natural · seamWidth/selfBand`) so every lane eases in evenly,
// keeping the funnel symmetric instead of pulling only one side in.
export function laneSeamOffsetPx(
  lanePos: number,
  selfBand: number,
  seamWidth: number,
  tileSize: number,
  centred = false,
): number {
  const natural = selfBand - 0.5 - lanePos;
  const adjusted = centred
    ? natural * (selfBand > 0 ? seamWidth / selfBand : 1)
    : Math.min(natural, seamWidth - 0.5);
  return adjusted * tileSize * LANE_WIDTH_FRAC;
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
  centred = false,
): number {
  const offEntry = laneSeamOffsetPx(lanePos, selfBand, bandEntry, tileSize, centred);
  const offExit = laneSeamOffsetPx(lanePos, selfBand, bandExit, tileSize, centred);
  return offEntry + (offExit - offEntry) * t;
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
