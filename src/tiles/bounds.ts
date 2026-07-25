import { Level, parseCoordId } from "@/tiles/model";
import { getCoordinatesId } from "@/utils/tileHelpers";

// World extents, derived from the level's own tiles.
//
// The board used to be a fixed 7x6 written into `gameConfig.levelSizeX` and a
// hardcoded `levelSizeY` in each view, which capped every world at that size no
// matter what the level actually contained. The simulation never had that limit —
// `game.ts` has always taken its extents from the tile coordinates — so the cap
// was purely a rendering one. Deriving the grid here removes it, and makes the
// two agree by construction rather than by both being told "7".
export interface LevelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cols: number;
  rows: number;
}

const EMPTY: LevelBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, cols: 1, rows: 1 };

// The smallest rectangle covering every tile in `level`. An empty level yields a
// 1x1 box at the origin so callers always have something to render into.
//
// `min` pads the result out to at least that many columns/rows, anchored at the
// origin — a nearly-empty editor canvas still offers somewhere to draw.
export function levelBounds(level: Level, min?: { cols: number; rows: number }): LevelBounds {
  const ids = Object.keys(level);
  if (!ids.length) {
    return min ? { ...EMPTY, cols: Math.max(1, min.cols), rows: Math.max(1, min.rows) } : EMPTY;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const { x, y } = parseCoordId(id);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  // The rendered grid is anchored at the origin, not at minX/minY: the engine
  // (spawn entries, off-grid tests, the generator) treats 0,0 as the world corner
  // and a level is normalised before it gets here. Keeping the origin in view is
  // also what makes a coordinate readable — "3,4" is at column 3, always.
  const cols = Math.max(1, maxX + 1, min?.cols ?? 0);
  const rows = Math.max(1, maxY + 1, min?.rows ?? 0);
  return { minX, minY, maxX, maxY, cols, rows };
}

// Shift a level so its lowest coordinate sits at the origin, returning the offset
// applied. This is what lets a world grow in EVERY direction while the engine
// keeps its "the world starts at 0,0" assumption: painting a tile at x = -1
// re-bases the whole level by one column instead of introducing negative
// coordinates that `roadEntries`' off-grid test, the generator and the validator
// would each have to learn about.
//
// Returns the level unchanged (same object) when nothing is negative, so the
// common case costs nothing and callers can cheaply detect "did anything move".
export function normaliseLevel(level: Level): { level: Level; dx: number; dy: number } {
  const b = levelBounds(level);
  const dx = b.minX < 0 ? -b.minX : 0;
  const dy = b.minY < 0 ? -b.minY : 0;
  if (dx === 0 && dy === 0) return { level, dx: 0, dy: 0 };
  return { level: translateLevel(level, dx, dy), dx, dy };
}

// A copy of `level` with every tile moved by (dx, dy). Tile CONTENT is untouched:
// connections and lanes are port-relative, so a tile means the same thing
// wherever it sits.
export function translateLevel(level: Level, dx: number, dy: number): Level {
  if (dx === 0 && dy === 0) return { ...level };
  const out: Level = {};
  for (const [id, cell] of Object.entries(level)) {
    const { x, y } = parseCoordId(id);
    out[getCoordinatesId({ x: x + dx, y: y + dy })] = cell;
  }
  return out;
}

// Anything that references a tile by coordinate has to move with it. Trains carry
// their home depot as x/y, so a re-base that forgot them would strand every train
// off its depot — silently, because the level itself would still validate.
export function translateTrains<T extends { x: number; y: number; destinations?: string[] }>(
  trains: Record<string, T>,
  dx: number,
  dy: number,
): Record<string, T> {
  if (dx === 0 && dy === 0) return trains;
  const out: Record<string, T> = {};
  for (const [id, t] of Object.entries(trains)) {
    out[id] = {
      ...t,
      x: t.x + dx,
      y: t.y + dy,
      ...(t.destinations && {
        destinations: t.destinations.map(d => {
          const { x, y } = parseCoordId(d);
          return getCoordinatesId({ x: x + dx, y: y + dy });
        }),
      }),
    };
  }
  return out;
}
