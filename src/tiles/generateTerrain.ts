// Ground for procedurally generated boards.
//
// `generate.ts` lays a track loop and depot spurs and stops there, so every
// generated and Daily board has been bare grass. This paints the rest of the
// map: a lake inside the ring, rock and woods and a town around it — so a
// generated board reads as a place rather than as a diagram.
//
// THE SAFETY PROPERTY, stated so it can be checked rather than believed:
// terrain is written ONLY into coordinates the generator left empty, and only
// ever as `{ connections: [], terrain }`. `validateLevel` has exactly one
// terrain branch and it requires `connections.length > 0 || road.length > 0`,
// so a painted cell provably cannot raise an issue — nor silence one, since
// every other check walks `portsOf(connections)` and a connection-less cell is
// never a step in the route search. A unit test pins this by asserting the
// validator's verdict is unchanged.
//
// Kept out of generate.ts so the topology and the ground stay separately
// readable and separately testable, mirroring the geometry/terrain split
// elsewhere in `src/tiles`.

import { Level, TerrainKind, TileCell } from "@/tiles/model";
import { getCoordinatesId } from "@/utils/tileHelpers";

export interface PaintTerrainOptions {
  width: number;
  height: number;
  // The rectangle the track loop encloses, exclusive — where the lake goes.
  interior: { x0: number; y0: number; x1: number; y1: number };
  // A rng stream of this painter's OWN. Never the generator's: a single extra
  // draw from that one re-rolls the depot layout for every seed in existence.
  rand: () => number;
}

// Cluster sizes, as a fraction of the space available to them. Terrain that
// reads has to come in BODIES, not noise: `patchPath` fuses orthogonally
// adjacent same-kind cells into one outline, so scattered single cells would
// render as a checkerboard of tiny islands.
const LAKE_MIN_FRACTION = 0.35;
const LAKE_MAX_FRACTION = 0.7;

// How much of the margin band may be made unbuildable. `planRoute` refuses to
// route through water/rock/mountain, so an over-stony map is one the editor's
// random-map button cannot draw on and the build tool cannot extend.
const MAX_UNBUILDABLE_MARGIN_FRACTION = 0.22;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const ORTHO = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/**
 * Grow one contiguous blob of `size` cells from `seedId`, taking cells out of
 * `pool` as it goes. Neighbours are visited in a fixed order and chosen with the
 * supplied rng, so the shape is a pure function of the seed.
 */
function grow(
  seedId: string,
  pool: Set<string>,
  size: number,
  rand: () => number,
): string[] {
  if (!pool.has(seedId)) return [];
  const out: string[] = [];
  const frontier: string[] = [seedId];
  pool.delete(seedId);
  while (out.length < size && frontier.length > 0) {
    const pick = Math.floor(rand() * frontier.length);
    const id = frontier.splice(pick, 1)[0];
    out.push(id);
    const [x, y] = id.split(",").map(Number);
    for (const [dx, dy] of ORTHO) {
      const nId = getCoordinatesId({ x: x + dx, y: y + dy });
      if (pool.has(nId)) {
        pool.delete(nId);
        frontier.push(nId);
      }
    }
  }
  return out;
}

/** Chebyshev distance from the board's middle — used to push rock outward. */
function edginess(id: string, width: number, height: number): number {
  const [x, y] = id.split(",").map(Number);
  return Math.max(
    Math.abs(x - (width - 1) / 2),
    Math.abs(y - (height - 1) / 2),
  );
}

/**
 * Paint ground into the empty cells of a generated level. Mutates `level`.
 * Returns the number of cells painted (for tests and tuning).
 */
export function paintTerrain(level: Level, opts: PaintTerrainOptions): number {
  const { width, height, interior, rand } = opts;

  // Every coordinate the generator did NOT use. This one line is the whole
  // safety invariant: there is no "is this a track cell?" test to get wrong.
  const free = new Set<string>();
  const interiorPool = new Set<string>();
  const marginPool = new Set<string>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = getCoordinatesId({ x, y });
      if (level[id]) continue;
      free.add(id);
      const inside =
        x > interior.x0 && x < interior.x1 && y > interior.y0 && y < interior.y1;
      (inside ? interiorPool : marginPool).add(id);
    }
  }

  // Cells that must stay buildable: a depot walled in by water or rock is legal
  // (its spur already exists) but can never be extended by the build tool or the
  // editor, and it reads as a bug rather than as terrain. The generator can and
  // does place depots INSIDE the ring, so this applies to the lake as well as to
  // the margin — the interior is not empty just because the loop avoids it.
  const protectedFromBlocking = new Set<string>();
  for (const [id, cell] of Object.entries(level)) {
    if (cell.role !== "depot") continue;
    const [x, y] = id.split(",").map(Number);
    for (const [dx, dy] of ORTHO) {
      protectedFromBlocking.add(getCoordinatesId({ x: x + dx, y: y + dy }));
    }
  }

  let painted = 0;
  const put = (ids: string[], kind: TerrainKind) => {
    for (const id of ids) {
      // A FRESH literal per cell. Sharing one object across a lake would make
      // every tile of it the same reference, so a single in-play edit would
      // mutate the rest (lakevalley.ts carries the same warning by hand).
      const cell: TileCell = { connections: [], terrain: kind };
      level[id] = cell;
      painted++;
    }
  };

  // Never emit `terrain: "grass"`. Grass is stored as ABSENT — `tileGroundSvg`
  // draws nothing for it — and a cell created to say "grass here" would both
  // read as blank to the editor and grow the board's bounds for nothing.

  // 1. The lake, inside the ring. The loop is a fixed rectangle inset by one, so
  //    it provably never runs through here — the water needs no pathfinding to
  //    stay out of the track's way.
  const lakeCandidates = [...interiorPool].filter(
    id => !protectedFromBlocking.has(id),
  );
  if (lakeCandidates.length >= 2) {
    const seed = lakeCandidates[Math.floor(rand() * lakeCandidates.length)];
    const size = Math.max(
      2,
      Math.round(
        lakeCandidates.length * lerp(LAKE_MIN_FRACTION, LAKE_MAX_FRACTION, rand()),
      ),
    );
    const pool = new Set(lakeCandidates);
    put(grow(seed, pool, size, rand), "water");
  }

  // 2. Rock and mountain, pushed toward the corners where a board's edges are.
  const stonePool = new Set(
    [...marginPool].filter(id => !protectedFromBlocking.has(id)),
  );
  const stoneBudget = Math.floor(
    marginPool.size * MAX_UNBUILDABLE_MARGIN_FRACTION,
  );
  const outer = [...stonePool].sort(
    (a, b) => edginess(b, width, height) - edginess(a, width, height),
  );
  let stoneSpent = 0;
  for (let cluster = 0; cluster < 2 && stoneSpent < stoneBudget; cluster++) {
    const corner = outer.filter(id => stonePool.has(id)).slice(0, Math.max(1, Math.ceil(outer.length / 3)));
    if (corner.length === 0) break;
    const seed = corner[Math.floor(rand() * corner.length)];
    const size = Math.min(2 + Math.floor(rand() * 3), stoneBudget - stoneSpent);
    if (size <= 0) break;
    const kind: TerrainKind = rand() < 0.3 ? "mountain" : "rock";
    const cells = grow(seed, stonePool, size, rand);
    put(cells, kind);
    stoneSpent += cells.length;
  }

  // 3. Woods — buildable, so no budget and no protection needed: you can fell
  //    trees, you just pay more for the ground (terrainBuildFactor).
  const softPool = new Set(
    [...marginPool].filter(id => !level[id]),
  );
  const woodCount = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < woodCount; i++) {
    const remaining = [...softPool];
    if (remaining.length === 0) break;
    const seed = remaining[Math.floor(rand() * remaining.length)];
    put(grow(seed, softPool, 2 + Math.floor(rand() * 4), rand), "forest");
  }

  // 4. A town, preferably beside a station — a place the trains are serving.
  const townSeeds = [...softPool].filter(id => protectedFromBlocking.has(id));
  const townPool = townSeeds.length > 0 ? townSeeds : [...softPool];
  if (townPool.length > 0) {
    const seed = townPool[Math.floor(rand() * townPool.length)];
    put(grow(seed, softPool, 2 + Math.floor(rand() * 2), rand), "urban");
  }

  // 5. Fields, LAST and in the biggest blocks — they are what open country
  //    between the woods and the town actually looks like, and the one kind
  //    whose job is to cover ground rather than to punctuate it. Buildable and
  //    cheap (1.2x), so covering the leftovers costs the player almost nothing;
  //    what it buys is a board with no bare green quarters left on it.
  const fieldCount = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < fieldCount; i++) {
    const remaining = [...softPool];
    if (remaining.length === 0) break;
    const seed = remaining[Math.floor(rand() * remaining.length)];
    // Deliberately larger than a wood: a two-cell field is a sticker, and the
    // furrows only read as a field once the block is several tiles across.
    put(grow(seed, softPool, 4 + Math.floor(rand() * 5), rand), "farmland");
  }

  return painted;
}
