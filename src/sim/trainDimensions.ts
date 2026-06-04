// Single source of truth for train sprite dimensions.
//
// The simulation spaces coupled units (loco + wagons) by their *actual*
// on-screen length, not a flat constant, so couplings line up regardless of
// wagon type/width. These pixel widths must match the sprite CSS in
// `src/components/Train.vue` (`.train-locomotive`, `.train-wagon--people`,
// `.train-wagon--fraight`) — keep the two in sync. They are kept here, in plain
// TS with no Vue/DOM imports, so the headless simulation can consume them.

export type TrainKind = "people" | "fraight";

// Sprite widths in CSS pixels (background-size: contain, so width is the
// meaningful axis along the track).
export const UNIT_PX = {
  loco: {
    people: 100,
    fraight: 100,
  },
  wagon: {
    people: 100,
    fraight: 81,
  },
} as const;

// Gap between coupled units, in CSS pixels. A small constant so units read as
// coupled (touching/near-touching) rather than overlapping or drifting apart.
export const COUPLING_GAP_PX = 4;

// Convert a pixel length to tile units (the sim's distance unit).
export function pxToTiles(px: number, tileSize: number): number {
  return px / tileSize;
}

// Per-unit lengths (in tiles) for a train: loco first, then one entry per wagon.
export function unitLengths(
  kind: TrainKind,
  wagonCount: number,
  tileSize: number
): number[] {
  const lengths = [pxToTiles(UNIT_PX.loco[kind], tileSize)];
  for (let i = 0; i < wagonCount; i++) {
    lengths.push(pxToTiles(UNIT_PX.wagon[kind], tileSize));
  }
  return lengths;
}

// The coupling gap in tile units.
export function couplingTiles(tileSize: number): number {
  return pxToTiles(COUPLING_GAP_PX, tileSize);
}
