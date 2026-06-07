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

// The same-direction lane band that actually crosses a port seam under the
// min-seam rule: the wider tile tapers down to the narrower neighbour, so the
// band at the seam is the smaller of this tile's band and the neighbour's.
// `neighbourBand <= 0` means there is no road neighbour there (a map edge / road
// end), so this tile's own band stands — nothing to taper toward.
export function seamBand(selfBand: number, neighbourBand: number): number {
  return neighbourBand > 0 ? Math.min(selfBand, neighbourBand) : selfBand;
}

// Lateral offset (px, right-of-travel) for a coupler at continuous lane position
// `lanePos` (0 = kerb-side, N-1 = centre-adjacent) and progress `t` (0 at the
// entry port, 1 at the exit port) along a STRAIGHT tile whose same-direction
// lane band tapers from `bandEntry` lanes at the entry seam to `bandExit` at the
// exit seam (the min-seam rule). A lane's offset is `(band - 0.5 - lanePos)·W`
// at each end; interpolating the two ends makes a continuing lane glide inward /
// outward as the painted kerb shifts, exactly matching the tapered surface —
// instead of jumping when the discrete tile lane count changes at the seam.
//
// For a uniform road (bandEntry === bandExit) this reduces to the original
// constant `(band - 0.5 - lanePos)·W`, so non-tapering roads are unchanged.
export function laneOffsetPx(
  lanePos: number,
  bandEntry: number,
  bandExit: number,
  t: number,
  tileSize: number,
): number {
  const w = tileSize * LANE_WIDTH_FRAC;
  const offEntry = (bandEntry - 0.5 - lanePos) * w;
  const offExit = (bandExit - 0.5 - lanePos) * w;
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
