// Terrain rendering, derived from tile data.
//
// `TileCell.terrain` says what a cell IS (grass/forest/water/rock/mountain/
// urban); this module turns that into ground art. Nothing is authored per tile: an author
// paints an AREA of forest and the individual trees follow from
// `(kind, coord, seed)` — the same deterministic trick meadowBackdrop.ts uses for
// the distance, just per tile instead of per texture tile. Determinism is
// load-bearing: a level must look identical on every load, and `npm run shot`
// screenshots must be comparable.
//
// Design: `docs/superpowers/specs/2026-07-25-terrain-as-tile-data-design.md`.
// This is step 2 of its sequencing — COSMETIC ONLY. No rule in the simulation or
// the validator reads terrain yet; that arrives one rule at a time (water blocks
// track, then bridges, then rock), each with its own /test scenario.
import { TerrainKind, TileCell, parseCoordId } from "@/tiles/model";
import { segmentPoints } from "@/sim/pathGeometry";
import { makeRng } from "@/utils/globalHelpers";
import { Rng, bush, green, lerp, tree } from "@/utils/foliage";

export const TERRAIN_KINDS: readonly TerrainKind[] = [
  "grass",
  "farmland",
  "forest",
  "water",
  "rock",
  "mountain",
  "urban",
  "industry",
] as const;

// Art is authored in a 100x100 box and scaled to whatever `tileSize` is, so
// scatter sizes stay independent of the px tile size.
export const GROUND_UNITS = 100;

// A PATCH STAYS ON ITS OWN TILE.
//
// This is the containment rule every constant below is pitched against, and it
// is a GAMEPLAY rule as much as a drawing one: a cell's terrain is what that
// cell IS, so a structure that answers for the cell — a bridge over water, a
// bore through rock — has to be able to cover it. While a lake bulged a fifth of
// a tile into its neighbours, a full-width bridge deck still left water showing
// past both ends of the span, and the crossing read as track laid on the river.
// Everything a patch draws is therefore kept inside the tile box: the shore is
// pulled IN off the lattice line (see SHORE_PULL) rather than pushed out, and a
// rounded corner's lean is capped at the tile edge (see patchSegments).
//
// The one deliberate exception is the soft fringe (see buildGround), which is
// translucent and exists precisely to blend across the seam.

// How far a tile corner is nudged off the grid. This is what stops a patch
// reading as a rounded rectangle: the grid is still underneath, but nothing
// lands on it. Small — it is the ONE thing that can still put a patch a few
// units over its own boundary (at the reflex corner of an L, where the point is
// shared with a diagonal neighbour and so cannot be clamped by either tile).
const CORNER_JITTER = 3;

// SHORES BULGE OUTWARD. The bow used to be symmetric — `(r()*2-1)*EDGE_BOW` —
// so about half of every patch's boundaries curved INWARD, and a concave shore
// reads as a pinch: lakes came out star-shaped, sucked in between their corners,
// which is the one thing a body of water never does. The direction is now fixed
// (always outward) and only the AMOUNT varies, between EDGE_BOW_MIN and the full
// bow: the silhouette stays convex while the outline stays irregular. Anything
// less than a floor here would let the odd shore go flat and reintroduce a
// straight tile edge.
const EDGE_BOW = 11;
const EDGE_BOW_MIN = 0.34;

// A cubic reaches 3/4 of its control offset at the midpoint, so a shore that
// should bulge EDGE_BOW has to lean its controls out by EDGE_BOW / 0.75.
const MID_OF_LEAN = 0.75;

// A lattice point in the MIDDLE of a shore — one where the boundary runs
// straight on into the next tile — is pulled off the grid too, INWARD, and the
// shore leans through it. Without this the outline returned to the bare lattice
// point at every tile boundary and left a sharp inward V there: the bulges were
// convex, but the CUSPS BETWEEN THEM drew the tile grid back onto the shore, so
// you could count the tiles down the side of a lake. The pull gives the shore
// somewhere else to be; the slope is what makes the two tiles' curves meet
// smoothly rather than at a kink (see patchSegments).
//
// INWARD, not outward. It used to push out by the same amounts, which is what
// put a lake a fifth of a tile into the meadow next door and left a river wider
// than the bridge built to cross it (see the containment note above). The
// smoothing is unchanged either way — the shore still never touches the grid
// line, it now sits just inside it instead of just outside — and because BOTH
// tiles read the same shared pull, the seam stays shut exactly as before.
// SHALLOW, and bounded at both ends for different reasons.
//
// The minimum is not free: a mid-shore point may be nudged CORNER_JITTER back
// toward the grid and its control point leans a further CORNER_SLOPE outward,
// so MIN >= JITTER + SLOPE is what makes "the shore stays on its tile" exact
// rather than approximate.
//
// The MAXIMUM is what keeps the shore CONVEX, and it is pitched against
// CORNER_INSET: a real corner is cut ~10-18 units into the tile (the diagonal
// pull, resolved onto one axis), so a mid-shore point deeper than that would sit
// INSIDE the line between the corners either side of it — the boundary would be
// sucked in once per tile and a 2x2 lake would come out as a cushion with a
// pinch in the middle of each side. That is the same star-shaped defect the
// outward-only bow was introduced to fix, just arriving from the other
// direction: the shore has to stay OUTSIDE its chord and INSIDE its tile, and
// the gap between these two constants is the room to do both.
const SHORE_PULL_MIN = 6;
const SHORE_PULL_MAX = 12;
const CORNER_SLOPE = 3;

// How far short of its own tile edge a rounded corner's lean has to stop (see
// outwardRoom).
const SHORE_EDGE_KEEP = 2;

// A REAL corner — where the patch genuinely turns — is pulled INWARD, along the
// tile's diagonal. This is what finally stopped an authored block silhouetting
// as its own bounding box: outward bows alone still left every corner sitting on
// the box corner, so a 3x2 lake was a rectangle with wavy edges. Pulling the
// corner a third of the way into the tile (while the mid-shore points push OUT)
// makes the outline sweep from outside the lattice line down into the tile and
// back — an effective corner radius of most of a tile, which is what reads as a
// rounded blob. The two amounts vary per corner so the blob is never a circle.
// The base amounts are pitched at a LONE tile, where a circle inscribed in the
// square cuts each corner by ~14.6 units on each axis, i.e. ~21 along the
// diagonal.
const CORNER_INSET_MIN = 18;
const CORNER_INSET_MAX = 26;

// …but a corner of a BIGGER body has to be cut deeper, and this is why a 2x2
// lake used to read as a rounded rectangle instead of as an oval. An ellipse
// inscribed in a 2x2 block passes ~29 units inside each corner of the block ON
// EACH AXIS — twice a lone tile's cut — because the shore has two tiles to
// travel while it turns, not one. Cutting every corner by the lone-tile amount
// therefore rounds a small pond correctly and leaves a big lake square.
//
// How big the body is, is READABLE LOCALLY: it is how many of this tile's edges
// stop. Four = the body is this tile alone. Three = the end of a one-wide
// ribbon. Two = a corner tile of something at least 2x2 — the case that needs
// the deep cut. No cross-tile agreement is needed for this (unlike every shared
// lattice value): a corner-role point is only ever drawn through by ONE tile,
// because a same-kind side neighbour would have made it a run instead.
const CORNER_INSET_BY_STOPS: Record<number, number> = { 4: 1, 3: 1.3, 2: 1.75 };

// How much a real corner's end tangents lean outward, as a multiple of the old
// bow-derived lean. At ~1 the outline turned ~78° at the corner point — a
// softened right angle, which is why a lone tile still read as a square. Scaled
// up until the lean is comparable to `reach`, both edges leave the corner at
// roughly 45°, so the turn spreads over the whole corner sweep instead of
// happening at the point. Capped just under `reach` or the cubic could loop.
const CORNER_ROUNDING = 2.2;

// A continuing (internal) edge is pushed a hair OUTWARD instead of being drawn
// as an exact shared line. Two patches that abut precisely still show a hairline
// seam, because each antialiases its edge against the background and two
// half-covered pixels do not add up to a full one. Both tiles bow outward, so
// they overlap by ~1 unit of the same colour and the seam has nowhere to appear.
// The path is wound clockwise, so a NEGATIVE bow is the outward direction.
const SEAM_OVERLAP = 0.6;

// --- Keep-out corridors ------------------------------------------------------
//
// Scatter must not stand on anything a vehicle runs over. A corridor is the
// centreline of a rail connection or a road across the SAME cell (or a
// neighbouring one), with a half-width; placement keeps each object's footprint
// outside every corridor, so laying track through a wood fells the trees in the
// right-of-way and a town's houses step back from the line. Forest gets one
// deliberate exception (see buildGround): a trunk may stand BESIDE the line
// while its canopy overhangs it — those trees render on the CANOPY layer, above
// the trains, so a train slips under the foliage.

export interface Corridor {
  pts: Pt[];
  half: number;
}

// Rails sit `railDistanceFromPath` (7px of 200 = 3.5 units) either side of the
// centreline, on sleepers a little wider — ~8 units of track edge to edge.
const RAIL_HALF = 8;
// One lane is 14 units wide (roadGeometry's size * 0.14); a road's half-width
// is its widest approach, since each direction's lanes sit on their own side.
const LANE_W_UNITS = 14;
const ROAD_MARGIN = 2;

/** The corridors of ONE cell, in its own 0..GROUND_UNITS space. */
export function cellCorridors(cell: TileCell | null | undefined): Corridor[] {
  if (!cell) return [];
  const out: Corridor[] = [];
  // A tunnelled line is UNDERGROUND: the mountain over it stays unbroken, so
  // its rail lays no keep-out corridor and the scatter closes over the bore.
  // (Clearing the right-of-way here would draw the tunnel's route onto the
  // ridge as a bald stripe — the one thing a tunnel visibly is not.)
  if (!cell.tunnel) {
    for (const [a, b] of cell.connections) {
      out.push({ pts: segmentPoints(a, b, GROUND_UNITS), half: RAIL_HALF });
    }
  }
  if (cell.road?.length) {
    // One corridor per (from → to) movement, as wide as its deepest lane stack.
    const widest = new Map<string, { corridor: Corridor; lanes: number }>();
    for (const lane of cell.road) {
      for (const to of [...lane.to, ...(lane.busTo ?? [])]) {
        const key = [lane.from, to].sort().join(">");
        const lanes = lane.index + 1;
        const cur = widest.get(key);
        if (cur) {
          cur.lanes = Math.max(cur.lanes, lanes);
          cur.corridor.half = cur.lanes * LANE_W_UNITS + ROAD_MARGIN;
        } else {
          widest.set(key, {
            lanes,
            corridor: {
              pts: segmentPoints(lane.from, to, GROUND_UNITS),
              half: lanes * LANE_W_UNITS + ROAD_MARGIN,
            },
          });
        }
      }
    }
    for (const { corridor } of widest.values()) out.push(corridor);
  }
  return out;
}

/**
 * A tile's corridors PLUS its four side-neighbours', translated into this
 * tile's space. The wide forest band lets a canopy reach ~4 units over the tile
 * edge, and a neighbour's rail runs right up to that edge at a port — without
 * the neighbours, a tree hugging the boundary would drape its canopy over the
 * next tile's track on the wrong (ground) layer.
 */
export function corridorsFor(
  cell: TileCell | null | undefined,
  neighbours?: Partial<
    Record<"top" | "right" | "bottom" | "left", TileCell | null | undefined>
  >,
): Corridor[] {
  const out = cellCorridors(cell);
  if (!neighbours) return out;
  const shifts: [keyof typeof neighbours, number, number][] = [
    ["top", 0, -GROUND_UNITS],
    ["right", GROUND_UNITS, 0],
    ["bottom", 0, GROUND_UNITS],
    ["left", -GROUND_UNITS, 0],
  ];
  for (const [side, dx, dy] of shifts) {
    for (const c of cellCorridors(neighbours[side])) {
      out.push({
        half: c.half,
        pts: c.pts.map(p => ({ x: p.x + dx, y: p.y + dy })),
      });
    }
  }
  return out;
}

function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Distance from a point to the EDGE of the nearest corridor. Negative = on it. */
export function corridorClearance(p: Pt, corridors: Corridor[]): number {
  let best = Infinity;
  for (const c of corridors) {
    best = Math.min(best, distToPolyline(p, c.pts) - c.half);
  }
  return best;
}

// The clear radius an object of this kind needs beyond a corridor's edge, per
// unit of band scale — the drawn art's worst-case reach (forest's includes the
// 0.42 tree conversion in buildGround).
export const FOOT: Record<TerrainKind, number> = {
  grass: 0,
  farmland: 0,
  forest: 13,
  water: 6,
  rock: 13,
  mountain: 26,
  // The SMALLEST town archetype's reach (`URBAN_SMALLEST_REACH`), not the
  // largest: a building's footprint is chosen to fit the room actually measured
  // at its spot (see `building`), so this only has to admit a shed. Gating on
  // the biggest would empty the street frontage of the whole town.
  urban: 15,
  // Works buildings are the biggest roofs in the game, but the same rule as the
  // town applies: the footprint is chosen to fit the room measured at the spot,
  // so the gate only has to admit the smallest thing on a yard (a silo).
  industry: 13,
};
// A trunk needs far less room than a canopy: how much clearance a FOREST
// tree's base needs before it is standing in the ballast.
const TRUNK_CLEAR = 4;

// --- Glades ------------------------------------------------------------------
//
// A real wood is not wall-to-wall trees: it has clearings, and thinner, lighter
// growth around them. The density field is VALUE NOISE over a coarse WORLD
// lattice — seeded by world position, never by the tile — so a glade spans tile
// boundaries seamlessly and can never redraw the grid the jittered patches
// exist to hide. Trees are rejected where the field runs low (a rejected spot
// occasionally keeps a low bush instead — light gets through where the canopy
// doesn't close), and the survivors shrink a little toward a glade's rim.

// Tiles per noise cell: a glade spans a couple of tiles, not a couple of trees.
const GLADE_CELL = 3;

function fieldCorner(gx: number, gy: number, seed: number, salt: number): number {
  return makeRng(hashInts(seed, gx, gy, salt))();
}

const smoothT = (t: number) => t * t * (3 - 2 * t);

/**
 * Smooth value noise 0..1 at a WORLD position (in tile units), over a lattice
 * `cell` tiles across. The one shape of unevenness this codebase is allowed:
 * it is a function of WORLD position, so whatever it drives varies across the
 * board without ever changing AT a tile boundary — which is what disqualified
 * per-tile tone variation (see the note by GROUND).
 */
function valueNoiseAt(
  wx: number,
  wy: number,
  seed: number,
  cell: number,
  salt: number,
): number {
  const cx = Math.floor(wx / cell);
  const cy = Math.floor(wy / cell);
  const fx = smoothT(wx / cell - cx);
  const fy = smoothT(wy / cell - cy);
  const a = fieldCorner(cx, cy, seed, salt);
  const b = fieldCorner(cx + 1, cy, seed, salt);
  const c = fieldCorner(cx, cy + 1, seed, salt);
  const d = fieldCorner(cx + 1, cy + 1, seed, salt);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/** Forest density 0..1 at a WORLD position (in tile units). Deterministic. */
export function forestDensityAt(wx: number, wy: number, seed: number): number {
  return valueNoiseAt(wx, wy, seed, GLADE_CELL, 0x6e);
}

// Open ground is not a lawn. The same noise, on a coarser lattice and its own
// salt, decides how ROUGH a stretch of meadow is: close-cropped in places,
// tussocky and flowering in others, with the odd thicket. See `meadowScatter`.
const MEADOW_CELL = 4;

/** Meadow roughness 0..1 at a WORLD position (in tile units). Deterministic. */
export function meadowRoughnessAt(wx: number, wy: number, seed: number): number {
  return valueNoiseAt(wx, wy, seed, MEADOW_CELL, 0xb3);
}

// How likely a tree at this density is to stand: full wood above, none below,
// a soft shoulder between. THE THRESHOLDS ARE PITCHED AGAINST THE FIELD'S REAL
// DISTRIBUTION: bilinear noise concentrates hard around 0.5 (it averages four
// uniforms), so a "full wood" bar at 0.52 rejected trees across half the map
// and turned every forest into sparse shrubland. At 0.38/0.24 roughly three
// quarters of the world is full wood, a sixth is the lighter shoulder, and a
// tenth is true clearing — a forest with glades, not a glade with trees.
const GLADE_FULL = 0.38;
const GLADE_FLOOR = 0.24;

function gladeKeep(density: number): number {
  if (density >= GLADE_FULL) return 1;
  if (density <= GLADE_FLOOR) return 0.04;
  return smoothT((density - GLADE_FLOOR) / (GLADE_FULL - GLADE_FLOOR));
}

// A cell with no `terrain` is grass. Grass is the ONE kind that draws no ground
// of its own: the board's themed ground shows through untouched, so adding
// terrain to the model changes nothing about how existing levels look. Painting
// grass explicitly and painting nothing are deliberately the same picture.
export function terrainOf(cell: TileCell | null | undefined): TerrainKind {
  return cell?.terrain ?? "grass";
}

// --- Rules -------------------------------------------------------------------
//
// The first thing that reads terrain rather than just drawing it. Kept here, as
// one predicate, so the validator, the editor and the route planner can never
// disagree about where a line may run.
//
// Forest is deliberately BUILDABLE — you fell the trees. Water, rock and
// mountain stop a plain track, and those are the interesting ones: they are what
// makes a route a decision instead of a straight line. (Water stops *plain*
// track; a bridge is a later feature and will be an exception here, not a new
// rule — as a tunnel will be for mountain.)
const BLOCKS_BUILDING: Record<TerrainKind, boolean> = {
  grass: false,
  farmland: false,
  forest: false,
  water: true,
  rock: true,
  mountain: true,
  urban: false,
  industry: false,
};

export function terrainBlocksBuilding(kind: TerrainKind): boolean {
  return BLOCKS_BUILDING[kind];
}

// Which blocking ground a STRUCTURE can carry a line over. Water can be
// bridged; rock and mountain cannot (a tunnel is their answer, and a separate
// feature). This is deliberately a property of the GROUND rather than a second
// predicate beside canBuildOn: "may I build here" has exactly one answer, and
// the bridge is an exception inside it.
const BRIDGEABLE: Record<TerrainKind, boolean> = {
  grass: false,
  farmland: false,
  forest: false,
  water: true,
  rock: false,
  mountain: false,
  urban: false,
  industry: false,
};

export function terrainBridgeable(kind: TerrainKind): boolean {
  return BRIDGEABLE[kind];
}

// Which blocking ground a bore can carry a line UNDER. Rock and mountain are
// tunnelled; water is bridged, never tunnelled (one answer per ground, so the
// two structures can never both claim a cell). Same shape as BRIDGEABLE and for
// the same reason: a property of the GROUND, feeding the one canBuildOn
// exception rather than a second predicate beside it.
const TUNNELABLE: Record<TerrainKind, boolean> = {
  grass: false,
  farmland: false,
  forest: false,
  water: false,
  rock: true,
  mountain: true,
  urban: false,
  industry: false,
};

export function terrainTunnelable(kind: TerrainKind): boolean {
  return TUNNELABLE[kind];
}

/**
 * Whether laying a line on this cell would MEAN boring a tunnel — the exact
 * twin of `needsBridge`, for the grounds a span cannot cross. The build tools
 * use it to offer a bore where they would otherwise refuse, and to set
 * `TileCell.tunnel` on what they lay.
 */
export function needsTunnel(cell: TileCell | null | undefined): boolean {
  return !cell?.tunnel && terrainTunnelable(terrainOf(cell));
}

/**
 * Whether laying a line on this cell would MEAN building a bridge — i.e. the
 * ground blocks a plain line but a span can cross it. The build tools use this
 * to offer a crossing where they would otherwise refuse, and to set
 * `TileCell.bridge` on what they lay.
 */
export function needsBridge(cell: TileCell | null | undefined): boolean {
  return !cell?.bridge && terrainBridgeable(terrainOf(cell));
}

// Terrain's SECOND gameplay rule (after canBuildOn): what laying track on this
// ground multiplies the base tile price by. Felling a wood costs half again;
// buying town land costs two and a half times. Only modes with a ledger feel
// it — sandbox and puzzle build free — and only the three buildable grounds
// matter here: water/rock/mountain refuse track outright, and a future bridge
// or tunnel is expected to bring its OWN price, not read this table.
export const TERRAIN_BUILD_FACTOR: Record<TerrainKind, number> = {
  grass: 1,
  // Buying the field off the farmer: cheaper than felling a wood, dearer than
  // running across open grass nobody was using.
  farmland: 1.2,
  forest: 1.5,
  water: 1,
  rock: 1,
  mountain: 1,
  urban: 2.5,
  // Dearer than a field, cheaper than town land: a works site is bought, but
  // nobody is being rehoused.
  industry: 2,
};

// A span is a STRUCTURE, not ground, so it brings its own price rather than
// reading the table above — and it is the dearest thing in the game to build,
// which is what makes "go round or cross?" a decision worth taking. High enough
// to hurt, not so high that a river is a wall.
export const BRIDGE_BUILD_FACTOR = 4;

// Boring through rock is dearer still than spanning water — the new dearest
// thing in the game. The gap between the two matters: a river is a line you
// cross once, a ridge is usually several tiles of bore, so the per-tile price
// alone already stacks; this factor keeps a single-tile bore from undercutting
// a single-tile span.
export const TUNNEL_BUILD_FACTOR = 6;

/**
 * The build-price factor for a cell. Missing cell = bare grass = 1.
 *
 * A bridge answers for BOTH states of the same tile: the span already standing
 * (`cell.bridge`), and the water a span is about to be thrown across. The build
 * verb prices a route BEFORE the edit lands, so a factor that only recognised
 * the finished bridge would quote every crossing at the price of open water.
 */
export function terrainBuildFactor(cell: TileCell | null | undefined): number {
  const kind = terrainOf(cell);
  if (cell?.bridge || terrainBridgeable(kind)) return BRIDGE_BUILD_FACTOR;
  if (cell?.tunnel || terrainTunnelable(kind)) return TUNNEL_BUILD_FACTOR;
  return TERRAIN_BUILD_FACTOR[kind];
}

/**
 * Whether track or road may be laid on this cell. Missing cell = bare grass.
 *
 * The bridge is the ONE exception, and it lives here rather than in a second
 * rule beside this one: a cell carrying a span is buildable whatever is under
 * it. Everything that asks "may I build here" — the validator's
 * `blocked-terrain`, the editor, the route planner — gets the exception for
 * free by asking the same question it always did.
 */
export function canBuildOn(cell: TileCell | null | undefined): boolean {
  if (cell?.bridge || cell?.tunnel) return true;
  return !terrainBlocksBuilding(terrainOf(cell));
}

// The four edge neighbours' kinds, in the order a clockwise path walks them —
// plus the four DIAGONAL ones, which decide whether a corner is the middle of a
// straight shore or a place where the boundary turns. Diagonals are optional
// (absent = grass), so a caller that only knows its four sides still works: it
// just treats every corner as mid-shore, which is the common case.
export interface TerrainNeighbours {
  top: TerrainKind;
  right: TerrainKind;
  bottom: TerrainKind;
  left: TerrainKind;
  topLeft?: TerrainKind;
  topRight?: TerrainKind;
  bottomRight?: TerrainKind;
  bottomLeft?: TerrainKind;
}

const ALL_GRASS: TerrainNeighbours = {
  top: "grass",
  right: "grass",
  bottom: "grass",
  left: "grass",
  topLeft: "grass",
  topRight: "grass",
  bottomRight: "grass",
  bottomLeft: "grass",
};

type Hsl = [h: number, s: number, l: number];
const css = ([h, s, l]: Hsl) => `hsl(${h} ${s}% ${l.toFixed(1)}%)`;

// Base ground colour per kind. `null` = draw nothing (see terrainOf).
// Rock is deliberately COOL grey and urban WARM tan: as two beiges they were
// indistinguishable on the board at any distance.
// Mountain is a DARKER, bluer slate than rock: the two blocking grounds must be
// tellable apart at a glance, and "higher and colder" is the reading we want.
const GROUND: Record<TerrainKind, Hsl | null> = {
  grass: null,
  // Warm and pale against the meadow's cooler green, so a field block reads as
  // worked land at a glance rather than as another shade of lawn. The stripes
  // (see `fieldStripes`) do most of the work; this is what shows between them.
  farmland: [64, 32, 52],
  forest: [96, 30, 30],
  water: [196, 44, 47],
  rock: [210, 7, 56],
  mountain: [214, 13, 42],
  urban: [36, 17, 68],
  // Hardstanding: a cool, desaturated concrete, deliberately GREYER and darker
  // than the town's warm tan so the two read apart at a glance — one is where
  // people live, the other is where things are made.
  industry: [212, 6, 58],
};

// A second, lighter tone drawn just inside the patch edge — shallows at a
// shoreline, a scree apron around rock. Without it a terrain patch reads as a
// flat sticker; with it the edge reads as a place where two grounds meet.
const RIM: Record<TerrainKind, Hsl | null> = {
  grass: null,
  // A hedgerow: the darker green a field is bounded by. Same trick as water's
  // shallows — it is what stops the block reading as a flat sticker.
  farmland: [98, 34, 33],
  forest: null,
  water: [190, 46, 62],
  rock: [210, 8, 65],
  // A scree apron where the massif runs out — the same idea as rock's. Kept
  // only a few steps off the ground: on this dark slate a bright rim reads as a
  // capsule drawn round the tile rather than as the foot of a range.
  mountain: [214, 12, 46],
  urban: null,
  industry: null,
};

// NO per-tile tone variation. It was tried (±3.5% lightness) to stop a large
// wood reading as one flat slab, and it backfired badly: because the fill is
// flat per tile, the boundary between two tones IS the tile edge, so the grid
// became legible straight through the colour — the exact thing the jittered
// outline exists to hide. Unevenness has to come from something that doesn't
// change at tile boundaries (scatter density, a gradient across the patch), not
// from a per-tile constant.

// --- Patch shape -------------------------------------------------------------
//
// A terrain patch is NOT drawn on the tile grid. Its four corners are lattice
// points nudged off the grid, and each boundary bows between them — so a lake
// has a shoreline rather than four right angles.
//
// The whole trick is WHAT EACH RANDOM NUMBER IS SEEDED BY:
//   - a corner is seeded by the LATTICE POINT, shared by up to four tiles;
//   - a boundary is seeded by the EDGE, canonicalised so the two tiles either
//     side compute the same number.
// Seed by the tile instead and neighbours disagree about where their shared
// boundary is, which reopens the seams that patchPath exists to close.

function hashInts(seed: number, ...vals: number[]): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (const v of vals) h = Math.imul(h ^ (v + 0x9e3779b9), 0x01000193) >>> 0;
  return h >>> 0;
}

/**
 * Where the grid intersection (gx, gy) actually sits, in the local 0..size box
 * of a tile whose top-left corner is that point. Every tile touching this
 * lattice point derives the same offset, so their outlines meet exactly.
 */
export function latticeOffset(
  gx: number,
  gy: number,
  seed: number,
): { dx: number; dy: number } {
  const r = makeRng(hashInts(seed, gx, gy, 0x0c));
  return {
    dx: (r() * 2 - 1) * CORNER_JITTER,
    dy: (r() * 2 - 1) * CORNER_JITTER,
  };
}

/**
 * How far the boundary between two lattice points bows out, perpendicular to
 * them. Always NEGATIVE, which is the OUTWARD direction for this clockwise
 * outline (same convention as SEAM_OVERLAP) — see EDGE_BOW.
 *
 * Canonicalised on the endpoint pair: `edgeBow(a, b) === edgeBow(b, a)`, which
 * is what lets the tile on each side draw the identical curve.
 */
export function edgeBow(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  seed: number,
): number {
  const swap = bx < ax || (bx === ax && by < ay);
  const [p, q] = swap ? [[bx, by], [ax, ay]] : [[ax, ay], [bx, by]];
  const r = makeRng(hashInts(seed, p[0], p[1], q[0], q[1], 0x1d));
  return -EDGE_BOW * lerp(EDGE_BOW_MIN, 1, r());
}

/**
 * How far a MID-SHORE lattice point is pulled off the grid, INWARD along the
 * shore's outward normal, and how steeply the shore leans as it passes through.
 * Both are seeded by the lattice point alone, so the two tiles that share it
 * place it and angle it identically — that agreement is the whole reason the
 * seam stays shut.
 */
export function shorePull(gx: number, gy: number, seed: number): number {
  const r = makeRng(hashInts(seed, gx, gy, 0x3b));
  return lerp(SHORE_PULL_MIN, SHORE_PULL_MAX, r());
}

export function cornerSlope(gx: number, gy: number, seed: number): number {
  const r = makeRng(hashInts(seed, gx, gy, 0x5f));
  return (r() * 2 - 1) * CORNER_SLOPE;
}

/**
 * How far a REAL corner is pulled into its tile, along the diagonal. Seeded by
 * the lattice point for determinism, but unlike push/slope it needs no cross-
 * tile agreement: a corner-role point is only ever drawn through by ONE tile of
 * the patch (a same-kind side neighbour would change the role), so the pull can
 * be as personal as it likes. Two patches kissing diagonally each pull into
 * their own tile and separate into two bodies — deliberate: two diagonal ponds
 * touching at a point read as a defect, not as a lake.
 */
export function cornerInset(gx: number, gy: number, seed: number): number {
  const r = makeRng(hashInts(seed, gx, gy, 0x77));
  return lerp(CORNER_INSET_MIN, CORNER_INSET_MAX, r());
}

// --- How a boundary is DRAWN --------------------------------------------------
//
// Not every ground has an organic edge. A lake, a wood, a rock field are shaped
// by water and weather, so their boundaries bow and their corners round — that
// is what all the shore machinery below is for. But FIELDS, TOWNS AND WORKS are
// shaped by people: they are surveyed, fenced and built to lines, and from above
// their boundaries are STRAIGHT runs meeting at angles. Drawn as blobs they read
// as a lake of wheat.
//
// The two styles share every bit of machinery except two decisions (see
// `corners` and `patchSegments`):
//   organic  — corners pulled inward / pushed outward, shores bowed as cubics.
//   surveyed — corners left on their jittered lattice point, shores straight.
// The jitter stays, because it is SHARED between the tiles that meet at a
// lattice point: a surveyed boundary is therefore a polyline through points both
// tiles agree on, which is a straight run with a slight kink every tile — a
// hedgerow, not a ruler, and exactly what a field boundary looks like.
export type EdgeStyle = "organic" | "surveyed";

const EDGE_STYLE: Record<TerrainKind, EdgeStyle> = {
  grass: "organic",
  farmland: "surveyed",
  forest: "organic",
  water: "organic",
  rock: "organic",
  mountain: "organic",
  urban: "surveyed",
  industry: "surveyed",
};

export function edgeStyleOf(kind: TerrainKind): EdgeStyle {
  return EDGE_STYLE[kind];
}

type Pt = { x: number; y: number };

// Each edge in the order the clockwise outline walks it: the direction it runs,
// and the OUTWARD normal (away from the tile). Taken from the edge INDEX rather
// than measured off the jittered chord, so the two tiles either side of a shore
// derive the identical frame and their tangents can line up exactly.
const EDGE_FRAME: { dir: Pt; out: Pt }[] = [
  { dir: { x: 1, y: 0 }, out: { x: 0, y: -1 } }, // top:    TL -> TR
  { dir: { x: 0, y: 1 }, out: { x: 1, y: 0 } }, // right:  TR -> BR
  { dir: { x: -1, y: 0 }, out: { x: 0, y: 1 } }, // bottom: BR -> BL
  { dir: { x: 0, y: -1 }, out: { x: -1, y: 0 } }, // left:   BL -> TL
];

// What a corner IS, which is decided by its two edges and its diagonal:
//  - "corner": both edges stop, so the patch genuinely turns here. Round it.
//  - "run": exactly one edge stops and the boundary carries straight on into the
//    next tile. Push it out and give it a shared tangent — no kink.
//  - "turn": interior, or the reflex corner of an L (the diagonal is the same
//    kind, so the boundary turns AROUND this point). Leave it on the lattice:
//    the two tiles meeting there run perpendicular and must not agree.
type CornerRole =
  | { kind: "corner" }
  | { kind: "run"; edge: number }
  | { kind: "turn" };

function cornerRoles(stops: boolean[], diag: boolean[]): CornerRole[] {
  const roles: CornerRole[] = [];
  for (let i = 0; i < 4; i++) {
    const before = stops[(i + 3) % 4];
    const after = stops[i];
    if (before && after) roles.push({ kind: "corner" });
    else if (before !== after && !diag[i]) {
      roles.push({ kind: "run", edge: before ? (i + 3) % 4 : i });
    } else roles.push({ kind: "turn" });
  }
  return roles;
}

// The tile's four corners in local space, each displaced by its lattice point's
// shared offset — then, mid-shore, pushed outward, or at a real corner pulled
// INWARD along the diagonal (see CORNER_INSET). Clockwise from the top-left.
function corners(
  x: number,
  y: number,
  seed: number,
  size: number,
  roles: CornerRole[],
  style: EdgeStyle,
  stops: boolean[],
): Pt[] {
  // How deep this tile's real corners are cut: the further the body extends,
  // the longer the shore has to turn, and the deeper the cut has to be for the
  // silhouette to read as one curve (see CORNER_INSET_BY_STOPS).
  const insetScale = CORNER_INSET_BY_STOPS[stops.filter(Boolean).length] ?? 1;
  const local: Pt[] = [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
  return cornerLattice(x, y).map(([gx, gy], i) => {
    const { dx, dy } = latticeOffset(gx, gy, seed);
    const p = { x: local[i].x + dx, y: local[i].y + dy };
    const role = roles[i];
    // Surveyed ground keeps every corner ON its shared lattice point: no belly
    // pushed out mid-shore, no bite taken out of the corner. That is the whole
    // difference between a field and a pond.
    if (style === "surveyed") return p;
    if (role.kind === "run") {
      const pull = shorePull(gx, gy, seed);
      const out = EDGE_FRAME[role.edge].out;
      p.x -= out.x * pull;
      p.y -= out.y * pull;
    } else if (role.kind === "corner") {
      // The inward diagonal is opposite the two adjacent edges' outward
      // normals; their sum has length sqrt(2), so divide to get a unit pull.
      const inset = cornerInset(gx, gy, seed) * insetScale;
      const oBefore = EDGE_FRAME[(i + 3) % 4].out;
      const oAfter = EDGE_FRAME[i].out;
      p.x -= ((oBefore.x + oAfter.x) / Math.SQRT2) * inset;
      p.y -= ((oBefore.y + oAfter.y) / Math.SQRT2) * inset;
    }
    return p;
  });
}

// The lattice points of each corner, in the same clockwise order — needed to
// seed each edge by the pair it actually spans.
function cornerLattice(x: number, y: number): [number, number][] {
  return [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ];
}

const n1 = (v: number) => v.toFixed(1);

// One boundary's cubic geometry: start, both controls, end. Built by
// patchSegments, consumed by the path builders, the rim, and the scatter
// containment polygon — one derivation, so they can never disagree.
interface ShoreSeg {
  a: Pt;
  p1: Pt;
  p2: Pt;
  b: Pt;
  stops: boolean;
}

// The slope to hand `shoreEdge` at one end of an edge. `sign` is +1 leaving a
// corner, −1 arriving at one: a real corner leans out on the way in and back on
// the way out, a mid-shore point uses the lattice's shared slope either way, and
// a reflex corner stays flat so the two perpendicular shores meet cleanly.
function edgeLead(
  role: CornerRole,
  lattice: [number, number],
  seed: number,
  lean: number,
  sign: number,
): number {
  if (role.kind === "corner") return sign * lean;
  if (role.kind === "run") return cornerSlope(lattice[0], lattice[1], seed);
  return 0;
}

/**
 * Which of a tile's neighbours carry the SAME terrain. The four sides decide
 * where the patch stops; the four diagonals (absent = different) decide whether
 * a corner is mid-shore or a turn.
 */
export interface PatchSame {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  topLeft?: boolean;
  topRight?: boolean;
  bottomRight?: boolean;
  bottomLeft?: boolean;
}

// Edge order matches `corners`: top, right, bottom, left.
function edgeStops(same: PatchSame): boolean[] {
  return [!same.top, !same.right, !same.bottom, !same.left];
}

// Diagonal order matches the CORNERS: top-left, top-right, bottom-right,
// bottom-left — corner i's diagonal is the tile across it.
function cornerDiagonals(same: PatchSame): boolean[] {
  return [!!same.topLeft, !!same.topRight, !!same.bottomRight, !!same.bottomLeft];
}

// Everything the two path builders need to agree on, worked out once.
function patchFrame(
  same: PatchSame,
  x: number,
  y: number,
  seed: number,
  size: number,
  style: EdgeStyle,
) {
  const stops = edgeStops(same);
  const roles = cornerRoles(stops, cornerDiagonals(same));
  return {
    stops,
    roles,
    c: corners(x, y, seed, size, roles, style, stops),
    g: cornerLattice(x, y),
    reach: size / 3,
  };
}

// The outward lean that rounds a real corner, derived from this edge's own bow
// so each corner still turns by a different amount (see EDGE_BOW), scaled up by
// CORNER_ROUNDING so the turn is spread over the whole sweep rather than
// happening at the point. `edgeBow` is negative for outward; a lead takes
// outward as positive. Capped just under `reach`: a lean past the along-shore
// component would tip the end tangent beyond 45° and risk a loop.
function edgeLean(
  g: [number, number][],
  i: number,
  seed: number,
  reach: number,
): number {
  const [ax, ay] = g[i];
  const [bx, by] = g[(i + 1) % 4];
  const lean = (-edgeBow(ax, ay, bx, by, seed) / MID_OF_LEAN) * CORNER_ROUNDING;
  return Math.min(lean, reach * 0.95);
}

/**
 * How much room a point has before the tile edge it is leaning toward. The
 * containment rule (see the note by CORNER_JITTER) is enforced here and nowhere
 * else: a cubic lies inside the convex hull of its four points, so capping a
 * corner's outward lean at this distance keeps the whole rounded sweep on the
 * tile — the shore reaches the boundary and stops there instead of spilling a
 * quarter of a tile onto the ground next door.
 */
function outwardRoom(p: Pt, out: Pt, size: number): number {
  const room = out.x !== 0 ? (out.x > 0 ? size - p.x : p.x) : out.y > 0 ? size - p.y : p.y;
  // Divided by MID_OF_LEAN, because the CURVE is what has to stay on the tile,
  // not its control points. A cubic whose two ends sit `d` inside the boundary
  // and whose controls both lean `L` outward reaches `d - 0.75L` at its
  // midpoint, so the exact condition is L <= d / 0.75 — the control point may
  // legitimately sit outside the tile while the shore it draws does not.
  //
  // Capping at the hull instead (L <= d) was the first attempt and it is what
  // made a lake look BOXY: the sweep died 5-7 units short of the boundary all
  // the way round, so every side read as a straight run with a small turn at
  // each end instead of as one arc. Rounding a corner needs the lean, and the
  // lean has to be worth a third more than the room to spend it.
  //
  // The keep-off is subtracted first so the curve stops just SHORT of the grid
  // line rather than on it: landing exactly on 0 or `size` would put the
  // shore's steepest part on the tile edge, which is the thing the jitter is
  // there to avoid.
  return Math.max(0, room - SHORE_EDGE_KEEP) / MID_OF_LEAN;
}

/**
 * Every boundary of the patch, as cubics whose END TANGENTS are chosen, not
 * implied.
 *
 * This is the whole trick. A quadratic bowing off the chord leaves each corner
 * at an angle, so where two tiles' shores met the outline kinked ~47° — a sharp
 * inward V at every tile boundary, which is the tile grid drawn back onto the
 * lake. Here each end contributes `dir * reach` along the shore plus `out *
 * lead` across it, and at a mid-shore corner BOTH tiles read the same lead
 * (the lattice point's shared slope) from the same frame — so the two curves
 * leave and arrive along one line and the join disappears.
 *
 * `leadOut` is the slope leaving `a`, `leadIn` the slope arriving at `b`, both
 * positive = outward. A real corner passes +lean / −lean, which bulges the edge
 * out and brings it back; with the corner point itself pulled inward (see
 * CORNER_INSET) that sweep is what rounds a lone patch into a blob. An internal
 * join runs a hair outward on both ends so two abutting bodies overlap by ~1
 * unit of the same colour instead of leaving an antialiasing hairline.
 */
function patchSegments(
  same: PatchSame,
  x: number,
  y: number,
  seed: number,
  size: number,
  style: EdgeStyle = "organic",
): ShoreSeg[] {
  const { stops, roles, c, g, reach } = patchFrame(same, x, y, seed, size, style);
  const segs: ShoreSeg[] = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    const j = (i + 1) % 4;
    const { dir, out } = EDGE_FRAME[i];
    let leadOut: number;
    let leadIn: number;
    if (style === "surveyed" && stops[i]) {
      // A STRAIGHT boundary, still expressed as a cubic so every consumer (the
      // rim, the outline polygon, the fringe) keeps working unchanged: put both
      // control points on the chord at the thirds and the curve IS the line.
      segs.push({
        a,
        p1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
        p2: { x: b.x - (b.x - a.x) / 3, y: b.y - (b.y - a.y) / 3 },
        b,
        stops: true,
      });
      continue;
    }
    if (!stops[i]) {
      const seam = SEAM_OVERLAP / MID_OF_LEAN;
      leadOut = seam;
      leadIn = -seam;
    } else {
      // A real corner leans out by the edge's own amount, but never past the
      // tile edge: the patch has to stay on its own cell (see outwardRoom).
      const lean = edgeLean(g, i, seed, reach);
      leadOut = edgeLead(roles[i], g[i], seed, Math.min(lean, outwardRoom(a, out, size)), 1);
      leadIn = edgeLead(roles[j], g[j], seed, Math.min(lean, outwardRoom(b, out, size)), -1);
    }
    segs.push({
      a,
      p1: {
        x: a.x + dir.x * reach + out.x * leadOut,
        y: a.y + dir.y * reach + out.y * leadOut,
      },
      p2: {
        x: b.x - dir.x * reach - out.x * leadIn,
        y: b.y - dir.y * reach - out.y * leadIn,
      },
      b,
      stops: stops[i],
    });
  }
  return segs;
}

const cubic = (s: ShoreSeg) =>
  `C${n1(s.p1.x)} ${n1(s.p1.y)} ${n1(s.p2.x)} ${n1(s.p2.y)} ${n1(s.b.x)} ${n1(s.b.y)}`;

/**
 * The outline of this tile's terrain patch. An edge whose neighbour carries the
 * SAME kind runs straight between the two shared corners — both tiles draw that
 * identical line, so the bodies fuse invisibly. An edge where the terrain stops
 * bows into a shoreline. A lake is authored as an area, never as corner sprites.
 */
export function patchPath(
  same: PatchSame,
  x = 0,
  y = 0,
  seed = 1,
  size = GROUND_UNITS,
  style: EdgeStyle = "organic",
): string {
  const segs = patchSegments(same, x, y, seed, size, style);
  const out = [`M${n1(segs[0].a.x)} ${n1(segs[0].a.y)}`];
  for (const s of segs) out.push(cubic(s));
  out.push("Z");
  return out.join(" ");
}

/**
 * Just the boundaries where the terrain actually STOPS — the parts that are a
 * real shore, not an internal join. Stroking the whole outline instead draws a
 * bright line down every shared edge, which turns a 2x2 lake into four visibly
 * tiled ponds: the one thing patchPath exists to prevent.
 */
export function patchRimPath(
  same: PatchSame,
  x = 0,
  y = 0,
  seed = 1,
  size = GROUND_UNITS,
  style: EdgeStyle = "organic",
): string {
  return patchSegments(same, x, y, seed, size, style)
    .filter(s => s.stops)
    .map(s => `M${n1(s.a.x)} ${n1(s.a.y)} ${cubic(s)}`)
    .join(" ");
}

/**
 * The patch outline flattened to a polygon, for containment tests: scatter must
 * STAND ON the patch, and with real corners now cutting deep into the tile the
 * per-kind bands alone no longer guarantee that — a tree placed band-legally in
 * a corner would stand on grass, a lily on the shore. Six samples per cubic is
 * plenty at this scale; the shapes are shallow arcs.
 */
export function patchOutlinePolygon(
  same: PatchSame,
  x = 0,
  y = 0,
  seed = 1,
  size = GROUND_UNITS,
  style: EdgeStyle = "organic",
): Pt[] {
  const pts: Pt[] = [];
  for (const s of patchSegments(same, x, y, seed, size, style)) {
    for (let k = 0; k < 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      pts.push({
        x: w0 * s.a.x + w1 * s.p1.x + w2 * s.p2.x + w3 * s.b.x,
        y: w0 * s.a.y + w1 * s.p1.y + w2 * s.p2.y + w3 * s.b.y,
      });
    }
  }
  return pts;
}

/** Standard even-odd ray cast. Exported for the geometry tests. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// --- Scatter -----------------------------------------------------------------

// Objects standing on the ground, per kind. Counts are deliberately modest: this
// is drawn under the rails on every tile of a world that can now be 20+ tiles
// wide, and a forest that reads as a wood at a glance beats one that reads as
// individual trees at full zoom.
const SCATTER_COUNT: Record<TerrainKind, [min: number, max: number]> = {
  grass: [0, 0],
  // Nothing STANDS on a field: it is all ground marks (stripes, hedge blobs,
  // bale rows), which is what keeps farmland out of the corridor/canopy rules
  // entirely.
  farmland: [0, 0],
  forest: [9, 14],
  water: [0, 2],
  rock: [4, 6],
  mountain: [2, 3],
  // Two or three, because a building is now the size of a building (see the
  // TOWN archetypes): six of them at the new footprints would be one solid roof
  // per tile with no yards, gardens or street between them.
  urban: [2, 4],
  // Fewer and bigger than a town's: a works is two or three large objects on a
  // lot, not a street of houses.
  industry: [2, 3],
};

// Where on the tile the standing objects go, and how big they get. Everything
// is drawn TOP-DOWN now (see foliage.ts), so nothing grows upward out of its
// band — objects only need enough margin that their own footprint stays clear
// of a rail on the tile boundary, and `place` pulls them onto the patch anyway.
interface ScatterBand {
  x: [number, number];
  y: [number, number];
  scale: [number, number];
}
const DEFAULT_BAND: ScatterBand = { x: [16, 84], y: [16, 84], scale: [0.72, 1.15] };
const SCATTER_BAND: Partial<Record<TerrainKind, ScatterBand>> = {
  // Canopies are meant to overlap into a wood, so trees run almost to the
  // patch edge — the containment walk keeps them on the patch.
  forest: { x: [10, 90], y: [10, 90], scale: [0.72, 1.15] },
  // Boulders are bigger than a tree's footprint, so they keep a deeper margin.
  rock: { x: [24, 76], y: [24, 76], scale: [0.72, 1.15] },
  // A ridge is the biggest footprint on the board; keep its centre well inside
  // the tile so the massif stays on its own ground. Band + `peak`'s own reach
  // are pitched together so a crest lands inside the cell it belongs to — a
  // mountain hanging over the neighbour is the same defect as a lake doing it
  // (see the containment note by CORNER_JITTER), and worse, because a ridge is
  // opaque: it drew over ground a tunnel portal or a bridge had to answer for.
  mountain: { x: [33, 67], y: [33, 67], scale: [0.8, 1.1] },
  // Buildings are the biggest footprints on the board after a ridge, so they
  // keep well off the tile edge — and the scale range is narrow, because a town
  // whose houses vary by 40% reads as a perspective error rather than as
  // variety (the archetypes supply the variety instead).
  urban: { x: [26, 74], y: [26, 76], scale: [0.9, 1.08] },
  industry: { x: [28, 72], y: [28, 74], scale: [0.9, 1.1] },
};

type Pt2 = { x: number; y: number };

const poly = (pts: Pt2[], fill: string, extra = "") =>
  `<path d="M${pts.map(p => `${n1(p.x)} ${n1(p.y)}`).join(" L")} Z" fill="${fill}"${extra}/>`;

// --- Rock --------------------------------------------------------------------
//
// Grey with a faint blue cast, to sit on the deliberately COOL rock ground. The
// old boulders were warm beige on cool grey and read as something dropped there
// rather than as the ground breaking through.
function stone(rng: Rng, light: number, sat: [number, number] = [5, 13]): string {
  const h = Math.round(lerp(202, 222, rng()));
  const s = Math.round(lerp(sat[0], sat[1], rng()));
  return `hsl(${h} ${s}% ${Math.round(light)}%)`;
}

// Shadow tints per ground. foliage's default is green (it is meadow shadow);
// dropped on grey rock it reads as a patch of moss, and on a town's render as
// a lawn.
const STONE_SHADOW = "rgba(28,36,48,0.22)";
const TOWN_SHADOW = "rgba(58,48,38,0.18)";

// An irregular closed blob around (0,0): the footprint of a rock seen from
// above. Points walk the full circle with jittered radius, so no two rocks on
// the board are the same rock.
function blobPts(rng: Rng, r: number, n: number, squish = 1): Pt2[] {
  const rot = rng() * Math.PI * 2;
  const pts: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const ang = rot + (i / n) * Math.PI * 2;
    const rad = r * lerp(0.78, 1.15, rng());
    pts.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad * squish });
  }
  return pts;
}

// Split a blob into its NW-facing (lit) and SE-facing (shaded) halves along the
// chord between its most-NW and most-SE vertices. Shape and shading come from
// the same points, so they can never disagree.
function splitBySun(pts: Pt2[]): { lit: Pt2[]; shade: Pt2[] } {
  const n = pts.length;
  let i0 = 0;
  let i1 = 0;
  for (let i = 1; i < n; i++) {
    if (pts[i].x + pts[i].y < pts[i0].x + pts[i0].y) i0 = i;
    if (pts[i].x + pts[i].y > pts[i1].x + pts[i1].y) i1 = i;
  }
  const walk = (from: number, to: number): Pt2[] => {
    const out: Pt2[] = [];
    for (let i = from; ; i = (i + 1) % n) {
      out.push(pts[i]);
      if (i === to) break;
    }
    return out;
  };
  const a = walk(i0, i1);
  const b = walk(i1, i0);
  const sun = (h: Pt2[]) => h.reduce((s, p) => s + p.x + p.y, 0) / h.length;
  return sun(a) <= sun(b) ? { lit: a, shade: b } : { lit: b, shade: a };
}

/**
 * A boulder, TOP-DOWN: an irregular blob split along the sun chord — lit toward
 * the NW, shaded toward the SE — with a small bright crown offset toward the
 * light and a drop shadow offset away from it.
 *
 * The tones sit CLOSE together on purpose. A near-white face against a near-
 * black one turns every rock into a paper cutout; a boulder is one lump of grey
 * catching the light unevenly, which is tones a few steps apart.
 */
function boulder(rng: Rng, scale: number): string {
  // Sized against the rock band (24..76) and the scale cap, same rule as the
  // ridge: radius + the shadow's own 0.24r offset has to fit the margin.
  const r = lerp(9, 14, rng()) * scale;
  const pts = blobPts(rng, r, 8, lerp(0.72, 1, rng()));
  const { lit, shade } = splitBySun(pts);
  // Offsets are baked into the POINTS, not wrapped in a nested translate: the
  // only translate() in a tile's art is the placement of each object, which is
  // what lets the placement tests parse positions back out of the SVG.
  const shift = (ps: Pt2[], by: number): Pt2[] =>
    ps.map(p => ({ x: p.x + by, y: p.y + by }));
  const crown = poly(shift(blobPts(rng, r * 0.3, 5), -r * 0.26), stone(rng, lerp(76, 82, rng())));
  return (
    poly(shift(pts, r * 0.24), STONE_SHADOW) +
    poly(lit, stone(rng, lerp(66, 73, rng()))) +
    poly(shade, stone(rng, lerp(46, 53, rng()))) +
    crown
  );
}

/**
 * A loose stone: the scree that makes rock read as GROUND, not as props.
 *
 * `light` is the lit face's tone and MUST be pitched against the ground it lies
 * on, not fixed. On rock (ground L=56) the default sits ~14 steps above it and
 * reads as stone; dropped unchanged on mountain (L=42) the same chips were ~30
 * steps up — bright flecks scattered over dark slate, which read as litter or
 * ice rather than as gravel.
 */
function pebble(rng: Rng, scale: number, light = 67): string {
  const r = lerp(3.2, 5.6, rng()) * scale;
  const pts = blobPts(rng, r, 5, lerp(0.7, 1, rng()));
  const { lit, shade } = splitBySun(pts);
  return (
    poly(lit, stone(rng, lerp(light, light + 7, rng()))) +
    poly(shade, stone(rng, lerp(light - 23, light - 16, rng())))
  );
}

/**
 * A bedrock shelf: a broad, flat, barely-there polygon a few steps off the
 * ground tone. Without something at this scale a rock patch is one flat slab of
 * grey with props standing on it.
 *
 * This replaced a first attempt at hairline "fissures", which at board zoom read
 * as stray pen strokes lying on the tile rather than as stone — the same lesson
 * as the terrain colours: unevenness has to be painted in BLOCKS, not in lines.
 */
function shelf(rng: Rng, base: Hsl): string {
  const w = lerp(26, 46, rng());
  const d = w * lerp(0.42, 0.62, rng());
  const [h, s, l] = base;
  // Two or three steps off the ground, no more. Push the contrast and the shelf
  // stops being texture and becomes a hexagonal sticker lying on the tile.
  const tone = `hsl(${h} ${s}% ${(l + lerp(-3.5, 3.5, rng())).toFixed(1)}%)`;
  const steps = 8;
  const pts: Pt2[] = [];
  for (let i = 0; i < steps; i++) {
    const ang = (i / steps) * Math.PI * 2 + lerp(-0.25, 0.25, rng());
    const rad = lerp(0.55, 1, rng());
    pts.push({ x: Math.cos(ang) * (w / 2) * rad, y: Math.sin(ang) * (d / 2) * rad });
  }
  return poly(pts, tone, ' opacity="0.6"');
}

// --- Mountain ----------------------------------------------------------------

/**
 * A peak, TOP-DOWN: a RIDGE — a crest line crossing the tile at a random
 * bearing, with a lit apron falling away to the NW and a shaded one to the SE,
 * and snow along the high middle of the crest. The aprons taper to nothing at
 * the crest's ends, so a ridge ends in points rather than in a blunt bar; two
 * or three of these crossing each other read as a massif.
 */
function peak(rng: Rng, scale: number): string {
  // Crest length and apron widths are bounded by the tile, not by taste: at the
  // band's edge (33/67) and the scale cap (1.1) a half-crest of 48/2 plus the
  // wobble and the shadow offset just reaches the boundary. Grow either and the
  // massif starts hanging over the next cell.
  const len = lerp(34, 48, rng()) * scale; // total crest length
  const th = rng() * Math.PI; // crest bearing
  const u: Pt2 = { x: Math.cos(th), y: Math.sin(th) }; // along the crest
  let v: Pt2 = { x: -u.y, y: u.x }; // across it
  // `v` must point toward the sun (NW) so the lit apron is on the right side.
  if (v.x + v.y > 0) v = { x: -v.x, y: -v.y };

  // Wider than it is long is what separates a massif from a shard: the aprons
  // together span more than half the crest, so the footprint is a rugged blob
  // with a spine, not a spiky lens.
  const wLit = lerp(12, 16, rng()) * scale;
  const wShade = lerp(13, 18, rng()) * scale;
  const face = stone(rng, lerp(56, 64, rng()), [10, 18]);
  const shade = stone(rng, lerp(36, 44, rng()), [12, 20]);

  // Crest stations, wobbling a little across the axis so the ridge is not a
  // straight bar. The apron width profile peaks mid-crest and dies at the
  // ends, and each station's width jitters so the flanks are rugged.
  const M = 7;
  const crest: Pt2[] = [];
  const prof: number[] = [];
  for (let i = 0; i < M; i++) {
    const t = i / (M - 1);
    const s = (t - 0.5) * len;
    const wob = (rng() * 2 - 1) * 2.5 * scale;
    crest.push({ x: u.x * s + v.x * wob, y: u.y * s + v.y * wob });
    prof.push(Math.pow(Math.sin(Math.PI * t), 0.55) * lerp(0.75, 1.2, rng()));
  }
  const apron = (side: Pt2, w: number): Pt2[] => {
    // Crest walked forward, offset points walked back: a closed half-ridge.
    const out = crest.map((p, i) => ({
      x: p.x + side.x * w * prof[i],
      y: p.y + side.y * w * prof[i],
    }));
    return [...crest, ...out.reverse()];
  };
  const litPoly = apron(v, wLit);
  const shadePoly = apron({ x: -v.x, y: -v.y }, wShade);

  // A snowfield along the summit: the interior of the crest, spreading a good
  // way down both flanks, in a bright and a dim tone so the crest line
  // survives under it. The field carries its own taper so it dies out toward
  // the crest ends in points — without it the snow's cut-off edge is a hard
  // chevron across the ridge.
  const K = M - 2;
  const mid = crest.slice(1, M - 1);
  const midProf = prof
    .slice(1, M - 1)
    .map((p, j) => p * Math.sin((Math.PI * (j + 0.5)) / K));
  const snowSide = (side: Pt2, w: number): Pt2[] => [
    ...mid,
    ...mid
      .map((p, i) => ({
        x: p.x + side.x * w * midProf[i],
        y: p.y + side.y * w * midProf[i],
      }))
      .reverse(),
  ];
  const snow = rng() < 0.82;
  const snowLit = snow
    ? poly(snowSide(v, wLit * lerp(0.45, 0.6, rng())), "hsl(202 24% 94%)")
    : "";
  const snowShade = snow
    ? poly(snowSide({ x: -v.x, y: -v.y }, wShade * lerp(0.35, 0.5, rng())), "hsl(208 18% 78%)")
    : "";

  // The full silhouette: lit-side offsets walked forward, shade-side offsets
  // walked back. The end stations have zero width, so the two sides meet at the
  // crest's endpoints and the loop closes. The shadow offset is baked into the
  // points (no nested translate — see boulder).
  const off = 3.6 * scale;
  const silhouette = [...[...litPoly.slice(M)].reverse(), ...shadePoly.slice(M)];
  const shadow = poly(
    silhouette.map(p => ({ x: p.x + off, y: p.y + off })),
    STONE_SHADOW,
  );

  return shadow + poly(litPoly, face) + poly(shadePoly, shade) + snowLit + snowShade;
}

// --- Town --------------------------------------------------------------------

/** A warm plaster/render wall, and a slightly darker tone for the shaded side. */
function renderTone(rng: Rng, light: number): string {
  return `hsl(${Math.round(lerp(26, 44, rng()))} ${Math.round(lerp(12, 26, rng()))}% ${Math.round(light)}%)`;
}

// A building's drop shadow: its own footprint offset to the SOUTH-EAST, matching
// the canopies' sun (see foliage.ts). Drawn inside the building's rotated frame;
// the jitter is small enough (±14°) that the offset still reads as one sun.
function roofShadow(w: number, d: number, scale: number): string {
  const off = 2.6 * scale;
  return `<rect x="${n1(-w / 2 + off)}" y="${n1(-d / 2 + off)}" width="${n1(w)}" height="${n1(d)}" rx="1" fill="${TOWN_SHADOW}"/>`;
}

// A pitched roof, drawn about (0,0): the NW-facing half catches the sun, the
// SE half is in shade, and a bright ridge line runs between them. `along` picks
// which axis the ridge runs down, so a row of houses isn't all facing one way.
function pitched(
  w: number,
  d: number,
  hue: number,
  sat: number,
  light: number,
  scale: number,
): string {
  const lit = `hsl(${hue} ${sat}% ${Math.round(light)}%)`;
  const dim = `hsl(${hue} ${sat}% ${Math.round(light - 18)}%)`;
  const ridge = `hsl(${Math.max(0, hue)} ${Math.max(0, sat - 8)}% ${Math.round(light + 12)}%)`;
  return (
    `<rect x="${n1(-w / 2)}" y="${n1(-d / 2)}" width="${n1(w)}" height="${n1(d / 2)}" fill="${lit}"/>` +
    `<rect x="${n1(-w / 2)}" y="0" width="${n1(w)}" height="${n1(d / 2)}" fill="${dim}"/>` +
    `<line x1="${n1(-w / 2)}" y1="0" x2="${n1(w / 2)}" y2="0" stroke="${ridge}" stroke-width="${n1(1.1 * scale)}"/>`
  );
}

// A chimney stack: a small dark box sitting ON the ridge, which is where a
// chimney actually comes through a roof and what makes a plain rectangle read
// as a house rather than as a card.
function chimney(x: number, hue: number, scale: number): string {
  const s = 3.2 * scale;
  return `<rect x="${n1(x - s / 2)}" y="${n1(-s / 2)}" width="${n1(s)}" height="${n1(s)}" fill="hsl(${hue} 14% 28%)"/>`;
}

/** Roof tile colours: the warm reds and browns a town's roofs actually are. */
function tileRoof(rng: Rng): { hue: number; sat: number; light: number } {
  return {
    hue: Math.round(lerp(4, 24, rng())),
    sat: Math.round(lerp(34, 54, rng())),
    light: lerp(48, 58, rng()),
  };
}

// --- Town archetypes ---------------------------------------------------------
//
// Each takes its footprint (already scaled) and draws about (0,0). The caller
// picks the size, so placement can know an archetype's reach BEFORE drawing it.

/** A garage or outbuilding: the small thing that fills a corner of a plot. */
function shed(rng: Rng, scale: number, w: number, d: number): string {
  const hue = Math.round(lerp(20, 40, rng()));
  const light = lerp(40, 50, rng());
  return (
    roofShadow(w, d, scale) +
    `<rect x="${n1(-w / 2)}" y="${n1(-d / 2)}" width="${n1(w)}" height="${n1(d)}" rx="0.8" fill="hsl(${hue} 12% ${Math.round(light)}%)"/>` +
    `<rect x="${n1(-w / 2)}" y="${n1(-d / 2)}" width="${n1(w)}" height="${n1(d * 0.45)}" fill="hsl(${hue} 12% ${Math.round(light + 9)}%)"/>`
  );
}

/** The common case: one detached house under a pitched tile roof. */
function house(rng: Rng, scale: number, w: number, d: number): string {
  const { hue, sat, light } = tileRoof(rng);
  const stack = rng() < 0.6 ? chimney(w * lerp(-0.28, 0.28, rng()), hue, scale) : "";
  // A lean-to on one gable end — a porch or a garage — so the outline isn't a
  // bare rectangle. Drawn under the main roof's tones, half its depth.
  const lean =
    rng() < 0.45
      ? `<rect x="${n1(w / 2 - 1)}" y="${n1(-d / 4)}" width="${n1(w * 0.26)}" height="${n1(d * 0.55)}" rx="0.8" fill="hsl(${hue} ${Math.max(0, sat - 14)}% ${Math.round(light - 8)}%)"/>`
      : "";
  return roofShadow(w, d, scale) + lean + pitched(w, d, hue, sat, light, scale) + stack;
}

/**
 * A terrace: 3-5 houses sharing party walls under one long roof. This is the
 * archetype that most says "town" from above — a row reads as a street frontage
 * where the same floor area as detached houses reads as a hamlet.
 */
function terrace(rng: Rng, scale: number, w: number, d: number): string {
  const { hue, sat, light } = tileRoof(rng);
  const units = 3 + Math.floor(rng() * 3);
  const step = w / units;
  let out = roofShadow(w, d, scale) + pitched(w, d, hue, sat, light, scale);
  for (let i = 1; i < units; i++) {
    // The party wall, drawn as a seam across both roof pitches, with the odd
    // shared chimney stack standing on it.
    const px = -w / 2 + step * i;
    out +=
      `<line x1="${n1(px)}" y1="${n1(-d / 2)}" x2="${n1(px)}" y2="${n1(d / 2)}" stroke="hsl(${hue} ${sat}% ${Math.round(light - 26)}%)" stroke-width="${n1(0.7 * scale)}"/>` +
      (rng() < 0.55 ? chimney(px, hue, scale) : "");
  }
  return out;
}

/**
 * A flat-roofed block: parapet ring, slab, rooftop plant. Concrete GREY, not
 * the warm render of the roofs around it — on the tan town ground a warm flat
 * roof either vanishes into it or reads as blank paper, so the roof has to
 * change temperature, not just tone.
 */
function block(rng: Rng, scale: number, w: number, d: number): string {
  const hue = Math.round(lerp(28, 38, rng()));
  const parapet = `hsl(${hue} 10% ${Math.round(lerp(42, 48, rng()))}%)`;
  const slab = `hsl(${hue} 8% ${Math.round(lerp(56, 62, rng()))}%)`;
  const inset = 2.6 * scale;
  const plant = (): string => {
    const bw = lerp(5, 9, rng()) * scale;
    const bh = lerp(4, 8, rng()) * scale;
    const bx = lerp(-w / 2 + inset + bw, w / 2 - inset - bw * 2, rng());
    const by = lerp(-d / 2 + inset + bh, d / 2 - inset - bh * 2, rng());
    return (
      `<rect x="${n1(bx + 0.8 * scale)}" y="${n1(by + 0.8 * scale)}" width="${n1(bw)}" height="${n1(bh)}" fill="${TOWN_SHADOW}"/>` +
      `<rect x="${n1(bx)}" y="${n1(by)}" width="${n1(bw)}" height="${n1(bh)}" fill="hsl(210 10% ${Math.round(lerp(48, 58, rng()))}%)"/>`
    );
  };
  // A light well on the bigger blocks: the courtyard a deep floorplate needs.
  const well =
    rng() < 0.4
      ? `<rect x="${n1(-w * 0.16)}" y="${n1(-d * 0.14)}" width="${n1(w * 0.32)}" height="${n1(d * 0.28)}" fill="hsl(${hue} 8% ${Math.round(lerp(36, 42, rng()))}%)"/>`
      : "";
  return (
    roofShadow(w, d, scale) +
    `<rect x="${n1(-w / 2)}" y="${n1(-d / 2)}" width="${n1(w)}" height="${n1(d)}" rx="1" fill="${parapet}"/>` +
    `<rect x="${n1(-w / 2 + inset)}" y="${n1(-d / 2 + inset)}" width="${n1(w - inset * 2)}" height="${n1(d - inset * 2)}" fill="${slab}"/>` +
    well +
    plant() +
    plant()
  );
}

/** A long metal hall — the works, the depot shed, the supermarket. */
function hall(rng: Rng, scale: number, w: number, d: number): string {
  const hue = Math.round(lerp(200, 216, rng()));
  const sat = Math.round(lerp(6, 12, rng()));
  const light = lerp(56, 64, rng());
  // Roof lights: the strips of glazing down a shed roof, which is the detail
  // that tells a hall apart from a plain grey slab at board zoom.
  let lights = "";
  const strips = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < strips; i++) {
    const lx = lerp(-w / 2 + w * 0.08, w / 2 - w * 0.16, i / Math.max(1, strips - 1));
    lights += `<rect x="${n1(lx)}" y="${n1(-d * 0.34)}" width="${n1(w * 0.07)}" height="${n1(d * 0.68)}" fill="hsl(${hue} ${sat + 6}% ${Math.round(light + 12)}%)" opacity="0.75"/>`;
  }
  return (
    roofShadow(w, d, scale) +
    pitched(w, d, hue, sat, light, scale) +
    lights
  );
}

/**
 * A church: a long slate nave with a square tower at the north end. The one
 * landmark in the set — rare, a different colour temperature from every other
 * roof, and the thing that gives a town a centre to read it from.
 */
function church(rng: Rng, scale: number, w: number, d: number): string {
  const hue = Math.round(lerp(206, 224, rng()));
  const sat = Math.round(lerp(8, 16, rng()));
  const light = lerp(44, 52, rng());
  const towerW = w * lerp(0.72, 0.9, rng());
  const ty = -d / 2 - towerW * 0.28;
  return (
    roofShadow(w, d, scale) +
    pitched(w, d, hue, sat, light, scale) +
    // The tower: its own shadow, a square plan, and a bright cap so it reads as
    // taller than the nave it stands on.
    `<rect x="${n1(-towerW / 2 + 1.6 * scale)}" y="${n1(ty - towerW / 2 + 1.6 * scale)}" width="${n1(towerW)}" height="${n1(towerW)}" fill="${TOWN_SHADOW}"/>` +
    `<rect x="${n1(-towerW / 2)}" y="${n1(ty - towerW / 2)}" width="${n1(towerW)}" height="${n1(towerW)}" fill="hsl(${hue} ${sat}% ${Math.round(light - 8)}%)"/>` +
    `<rect x="${n1(-towerW / 4)}" y="${n1(ty - towerW / 4)}" width="${n1(towerW / 2)}" height="${n1(towerW / 2)}" fill="hsl(${hue} ${sat}% ${Math.round(light + 16)}%)"/>`
  );
}

// --- Which building goes where -----------------------------------------------
//
// SCALE, in the units everything else here is measured in: a tile is 100 units
// and a CAR IS 23 OF THEM long (`DEFAULT_CAR_LENGTH` = 0.23 tiles). The first
// town shipped with houses 14-20 units wide — narrower than the cars driving
// past them, which reads as a model village rather than as a town. A modest
// house is ~1.5 car lengths on its long side, a terrace 3, a hall 3.5. Those
// are the numbers below, and they are why only two or three buildings now fit
// on a tile where six used to.
interface TownArchetype {
  weight: number;
  w: [number, number];
  d: [number, number];
  draw: (rng: Rng, scale: number, w: number, d: number) => string;
}

const TOWN: TownArchetype[] = [
  { weight: 1.1, w: [18, 24], d: [13, 18], draw: shed },
  { weight: 4, w: [30, 40], d: [22, 28], draw: house },
  { weight: 2.2, w: [52, 70], d: [22, 28], draw: terrace },
  { weight: 2, w: [40, 52], d: [32, 42], draw: block },
  { weight: 1.2, w: [56, 72], d: [26, 34], draw: hall },
  { weight: 0.4, w: [26, 34], d: [44, 56], draw: church },
];

// The clear radius an archetype needs: the half-diagonal of its LARGEST
// footprint, which also covers the ±12° rotation (a rotated rectangle never
// reaches past its own half-diagonal).
const reachOf = (a: TownArchetype): number => Math.hypot(a.w[1], a.d[1]) / 2;

// `FOOT.urban` is the gate a spot must clear before a building is attempted at
// all, and it must match the SMALLEST archetype's reach — set it higher and the
// street frontage empties out, lower and a shed lands in the ballast. Pinned by
// a unit test rather than derived here, because FOOT is declared far above.
export const URBAN_SMALLEST_REACH = reachOf(TOWN[0]);

/**
 * One building, TOP-DOWN — what you see of a town from above is its roofs.
 *
 * `room` is the clear half-extent available at this spot, in UNSCALED units,
 * and the archetype is chosen from those that FIT it. That is what makes a town
 * read: modest houses and sheds front the street where the corridor leaves
 * little room, and the terraces, blocks and halls stand in the depth of the
 * block where there is space for them. A fixed footprint could only ever be
 * small enough to fit everywhere.
 */
function building(rng: Rng, scale: number, room: number): { svg: string; reach: number } {
  const fits = TOWN.filter(a => reachOf(a) <= room);
  const pool = fits.length > 0 ? fits : [TOWN[0]];
  const total = pool.reduce((s, a) => s + a.weight, 0);
  let r = rng() * total;
  let pick = pool[0];
  for (const a of pool) {
    r -= a.weight;
    if (r <= 0) {
      pick = a;
      break;
    }
  }
  const w = lerp(pick.w[0], pick.w[1], rng()) * scale;
  const d = lerp(pick.d[0], pick.d[1], rng()) * scale;
  const ang = lerp(-12, 12, rng());
  return {
    svg: `<g transform="rotate(${ang.toFixed(1)})">${pick.draw(rng, scale, w, d)}</g>`,
    // The footprint actually drawn, not the archetype's maximum — the caller
    // turns this into a keep-out so the next building doesn't land on its roof.
    reach: Math.hypot(w, d) / 2,
  };
}

// How far a building may reach past its own tile's edge. Some overhang is what
// makes a town continuous across tiles instead of a grid of separate estates;
// unbounded, a terrace on one tile lands on a block on the next, and neither
// tile can see the other's scatter to prevent it.
const TOWN_OVERHANG = 10;

// --- Meadow (what grows on plain grass) --------------------------------------
//
// Grass is the one kind that paints NO ground of its own, and that has to stay
// true: a grass rect would cover the world theme's backdrop on every tile in
// the game (see terrainOf and the note by GROUND). So the answer to "the open
// green is boring" cannot be a fill — it has to be things ON the green.
//
// Everything here is therefore additive scatter and low-contrast marks, and how
// MUCH of it a stretch gets comes from `meadowRoughnessAt`: a coarse world noise
// field, so one part of the board is close-cropped and another is tussocky and
// flowering, and the change happens across tiles rather than at their edges.

/** A clump of grass: a few blades leaning off one root, a shade off the sward. */
function tuft(rng: Rng, scale: number): string {
  const n = 3 + Math.floor(rng() * 3);
  const h = lerp(3.4, 6.2, rng()) * scale;
  const tone = green(rng, lerp(30, 42, rng()));
  let out = "";
  for (let i = 0; i < n; i++) {
    const a = lerp(-0.9, 0.9, rng());
    const len = h * lerp(0.65, 1, rng());
    out += `<path d="M0 0 Q${n1(Math.sin(a) * len * 0.4)} ${n1(-len * 0.6)} ${n1(Math.sin(a) * len)} ${n1(-len)}" stroke="${tone}" stroke-width="${n1(0.9 * scale)}" fill="none" stroke-linecap="round"/>`;
  }
  return out;
}

/** A drift of wildflowers: a low green pad speckled with colour. */
function flowers(rng: Rng, scale: number): string {
  const r = lerp(3.4, 6, rng()) * scale;
  // One hue per drift — a meadow flowers in patches of a species, not in
  // confetti. Kept pale: saturated dots at this size read as UI, not as plants.
  const hue = [50, 328, 0, 268][Math.floor(rng() * 4)];
  const petal = `hsl(${hue} ${Math.round(lerp(30, 55, rng()))}% ${Math.round(lerp(76, 88, rng()))}%)`;
  let out = `<ellipse cx="0" cy="0" rx="${n1(r)}" ry="${n1(r * 0.8)}" fill="${green(rng, 38)}" opacity="0.5"/>`;
  const n = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    out += `<circle cx="${n1(lerp(-r, r, rng()) * 0.8)}" cy="${n1(lerp(-r, r, rng()) * 0.7)}" r="${n1(lerp(0.7, 1.3, rng()) * scale)}" fill="${petal}"/>`;
  }
  return out;
}

/**
 * A soft patch of sward a shade off the rest — rougher grazing, a damp hollow,
 * a dry rise. Painted as a low-contrast blob, NEVER as a per-tile tone: the
 * blob has an outline of its own, so it cannot draw the tile grid the way a
 * flat per-tile fill does.
 */
function sward(rng: Rng): string {
  const r = lerp(16, 30, rng());
  // Many points, so the blob reads as a soft change in the sward rather than as
  // a hexagon someone dropped on the grass. At 7 the facets were legible.
  const pts = blobPts(rng, r, 13, lerp(0.6, 0.95, rng()));
  const dry = rng() < 0.3;
  const tone = dry
    ? `hsl(${Math.round(lerp(56, 72, rng()))} ${Math.round(lerp(24, 34, rng()))}% ${Math.round(lerp(48, 56, rng()))}%)`
    : green(rng, lerp(30, 44, rng()));
  // Low contrast, but not invisible. Under ~0.15 the blobs vanish at board zoom
  // and the open green is exactly as flat as it was; over ~0.4 they stop being
  // ground and start being stains.
  return poly(pts, tone, ` opacity="${(0.2 + rng() * 0.15).toFixed(2)}"`);
}

// --- Farmland ----------------------------------------------------------------
//
// The signature top-down landscape: a patchwork of ploughed strips. Everything
// here is a GROUND MARK, never a standing object — a field has nothing to stand
// on it, which is also what keeps farmland out of the corridor and canopy rules
// entirely (the ballast and the tarmac simply draw over the stripes, exactly as
// a railway cut through a field looks from above).
//
// THE STRIPES ARE SEEDED BY A WORLD LATTICE, NOT BY THE TILE. That is the whole
// trick, and it is the same one the glades use. Seed the direction per tile and
// every tile boundary becomes a field boundary — the tile grid, drawn back onto
// the ground in furrows, which is precisely what the jittered patch outlines
// exist to hide. Seeded by a coarse world lattice instead, neighbouring tiles
// in the same lattice cell share a direction and their furrows RUN ON across
// the seam, so a field is as big as the lattice cell (a few tiles) and the
// patchwork comes from the cells, not from the grid.

// Tiles per field. Big enough that a field spans several tiles; small enough
// that a large farmed area still reads as a patchwork rather than as one crop.
const FIELD_CELL = 3;

interface FieldPlan {
  angle: number; // furrow bearing, radians
  width: number; // furrow width, ground units
  crop: Hsl; // the strip tone
  fallow: Hsl; // the tone between strips
}

/** The field plan at a WORLD position (in tile units). Deterministic. */
export function fieldPlanAt(wx: number, wy: number, seed: number): FieldPlan {
  const gx = Math.floor(wx / FIELD_CELL);
  const gy = Math.floor(wy / FIELD_CELL);
  const r = makeRng(hashInts(seed, gx, gy, 0x9a));
  // Crops, in the tones a field actually comes in from above: young green,
  // ripe straw, and turned earth. The pair is drawn from one roll so a field is
  // one crop rather than a stripe of each.
  const roll = r();
  const hue = roll < 0.4 ? lerp(78, 96, r()) : roll < 0.75 ? lerp(44, 54, r()) : lerp(28, 38, r());
  const sat = roll < 0.4 ? lerp(30, 40, r()) : roll < 0.75 ? lerp(36, 48, r()) : lerp(22, 30, r());
  const light = roll < 0.4 ? lerp(46, 54, r()) : roll < 0.75 ? lerp(60, 68, r()) : lerp(38, 44, r());
  // The two tones need REAL separation — 12 points of lightness, not the 6 the
  // first version used. A field is only a field if you can see the furrows: at
  // 6 points the green crops came out as flat olive tiles indistinguishable
  // from the grass they were meant to replace, while the straw ones (which
  // happen to sit far from the base tone) striped boldly. Contrast has to be a
  // property of the field, not an accident of where its hue landed.
  return {
    angle: r() * Math.PI,
    width: lerp(7, 13, r()),
    crop: [Math.round(hue), Math.round(sat), light],
    fallow: [Math.round(hue + 5), Math.round(Math.max(0, sat - 12)), light - 12],
  };
}

/**
 * The furrows across one tile: parallel bands at the field's bearing, drawn
 * long enough to cover the tile whatever the angle, and clipped to the patch by
 * the caller. Positions come from the WORLD distance along the field's normal,
 * so a band starting on one tile continues on the next without a step.
 */
function fieldStripes(x: number, y: number, seed: number): string {
  const plan = fieldPlanAt(x, y, seed);
  const c = Math.cos(plan.angle);
  const s = Math.sin(plan.angle);
  // Unit normal to the furrows; the stripe index is distance along it.
  const nx = -s;
  const ny = c;
  // This tile's four corners in WORLD ground units, so the run of stripe
  // indices covering the tile can be worked out exactly.
  const x0 = x * GROUND_UNITS;
  const y0 = y * GROUND_UNITS;
  const corners = [
    [x0, y0],
    [x0 + GROUND_UNITS, y0],
    [x0 + GROUND_UNITS, y0 + GROUND_UNITS],
    [x0, y0 + GROUND_UNITS],
  ];
  const ds = corners.map(([px, py]) => px * nx + py * ny);
  const lo = Math.floor(Math.min(...ds) / plan.width) - 1;
  const hi = Math.ceil(Math.max(...ds) / plan.width) + 1;
  const half = GROUND_UNITS * 1.5; // long enough to cross the tile at any angle
  const out: string[] = [];
  // EVERY band is drawn, alternating the two tones — not just the crop ones
  // over the base fill. Drawing only every other band leaves the base showing
  // between them, so a lattice cell whose crop happens to land near the base
  // tone comes out as a blank green tile with no furrows at all, while its
  // neighbour is boldly striped. Two explicit tones per field make the contrast
  // a property of the FIELD instead of an accident of the palette.
  // Where the tile sits ALONG the furrows. A band is drawn as a finite bar
  // (`half` long), and its natural anchor — the point on the band closest to
  // the world origin — can be hundreds of units away from this tile, so a bar
  // anchored there simply misses the tile and the field comes out blank. That
  // is exactly how the first version failed: tiles near the origin were striped
  // and everything to the right of them was flat green. Anchor over the tile's
  // own centre instead and a bar one and a half tiles long always covers it.
  const alongTile = (x0 + GROUND_UNITS / 2) * c + (y0 + GROUND_UNITS / 2) * s;
  for (let i = lo; i <= hi; i++) {
    // The band's centre in world units, converted back to tile-local.
    const d = (i + 0.5) * plan.width;
    const mx = d * nx + alongTile * c - x0;
    const my = d * ny + alongTile * s - y0;
    // A band is a long thin rectangle: centre ± half along the furrow, ± width
    // across it. Built as an explicit polygon so no nested transform is needed
    // (the placement tests parse every translate as an object position).
    const ax = c * half;
    const ay = s * half;
    const bx = (nx * plan.width) / 2;
    const by = (ny * plan.width) / 2;
    out.push(
      poly(
        [
          { x: mx - ax - bx, y: my - ay - by },
          { x: mx + ax - bx, y: my + ay - by },
          { x: mx + ax + bx, y: my + ay + by },
          { x: mx - ax + bx, y: my - ay + by },
        ],
        // Alternate on the WORLD index, not a local counter, so the two tones
        // stay in step across a tile boundary.
        css(((i % 2) + 2) % 2 === 0 ? plan.crop : plan.fallow),
      ),
    );
  }
  return out.join("");
}

/**
 * A hedgerow: the dark, ragged green line between two strips.
 *
 * It runs ALONG THE FURROWS (or square across them), never at a random bearing
 * — a hedge is a field boundary, and a field's boundaries are the directions it
 * was ploughed in. Angled freely they read as dark caterpillars dropped on the
 * crop, which is exactly how the first version came out.
 */
function hedge(rng: Rng, along: number): string {
  const len = lerp(34, 62, rng());
  const th = lerp(3.4, 5, rng());
  const a = along + (rng() < 0.3 ? Math.PI / 2 : 0);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const tone = `hsl(${Math.round(lerp(94, 112, rng()))} ${Math.round(lerp(30, 42, rng()))}% ${Math.round(lerp(26, 33, rng()))}%)`;
  // Drawn as a chain of overlapping blobs along the line, so the edge is
  // ragged like a hedge rather than straight like a fence.
  let out = "";
  const n = Math.max(3, Math.round(len / th));
  for (let i = 0; i <= n; i++) {
    const t = (i / n - 0.5) * len;
    const r = th * lerp(0.7, 1.15, rng());
    out += `<ellipse cx="${n1(c * t)}" cy="${n1(s * t)}" rx="${n1(r)}" ry="${n1(r * 0.82)}" fill="${tone}"/>`;
  }
  return out;
}

/**
 * Whether two field plans are the same field. Compared on the drawn properties
 * rather than on lattice coordinates, so two neighbouring cells that happen to
 * roll the same crop and bearing count as one field and get no hedge between
 * them — which is right: you cannot see a boundary that isn't there.
 */
function samePlan(a: FieldPlan, b: FieldPlan): boolean {
  return (
    a.angle === b.angle &&
    a.width === b.width &&
    a.crop[0] === b.crop[0] &&
    a.crop[2] === b.crop[2]
  );
}

/**
 * The hedgerow along ONE tile edge, where two different fields meet.
 *
 * Seeded canonically on the edge's two lattice points, so the tiles either side
 * generate the IDENTICAL chain of blobs and it does not matter that both draw
 * it — they land on top of each other. Seed it per tile and the hedge doubles
 * up, twice as thick and twice as ragged, on every boundary in the world.
 */
function hedgeAlong(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  gx: number,
  gy: number,
  hx: number,
  hy: number,
  seed: number,
): string {
  const swap = hx < gx || (hx === gx && hy < gy);
  const [p, q] = swap ? [[hx, hy], [gx, gy]] : [[gx, gy], [hx, hy]];
  const rng = makeRng(hashInts(seed, p[0], p[1], q[0], q[1], 0xa7));
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(4, Math.round(len / 6));
  const tone = `hsl(${Math.round(lerp(94, 110, rng()))} ${Math.round(lerp(30, 40, rng()))}% ${Math.round(lerp(27, 34, rng()))}%)`;
  let out = "";
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // A small wander across the line, so the hedge is planted rather than ruled.
    const wob = (rng() * 2 - 1) * 2.2;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const cx = lerp(ax, bx, t) + nx * wob;
    const cy = lerp(ay, by, t) + ny * wob;
    const r = lerp(3, 4.6, rng());
    out += `<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(r)}" ry="${n1(r * 0.85)}" fill="${tone}"/>`;
  }
  return out;
}

/**
 * Hedges on the sides where the NEIGHBOURING field is a different field. This
 * is what turns a big farmed area from one striped expanse into a patchwork
 * with boundaries: the stripe plan already changes every few tiles, and this
 * draws the hedge that change implies.
 */
function fieldBoundaries(x: number, y: number, seed: number, same: PatchSame): string {
  const mine = fieldPlanAt(x, y, seed);
  const S = GROUND_UNITS;
  const sides: [boolean, number, number, number, number, number, number][] = [
    // [neighbour is farmland, edge from, edge to, the neighbour tile]
    [!!same.top, 0, 0, S, 0, x, y - 1],
    [!!same.right, S, 0, S, S, x + 1, y],
    [!!same.bottom, 0, S, S, S, x, y + 1],
    [!!same.left, 0, 0, 0, S, x - 1, y],
  ];
  let out = "";
  for (const [isField, ax, ay, bx, by, nx, ny] of sides) {
    if (!isField) continue; // a shore, not a boundary — the rim draws that
    if (samePlan(mine, fieldPlanAt(nx, ny, seed))) continue;
    out += hedgeAlong(ax, ay, bx, by, x, y, nx, ny, seed);
  }
  return out;
}

/** A row of bales left on the stubble — the detail that says "just harvested". */
function bales(rng: Rng): string {
  const n = 3 + Math.floor(rng() * 3);
  const step = lerp(7, 11, rng());
  const a = rng() * Math.PI;
  const r = lerp(2.6, 3.6, rng());
  let out = "";
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * step;
    const px = Math.cos(a) * t;
    const py = Math.sin(a) * t;
    out +=
      `<ellipse cx="${n1(px + 0.9)}" cy="${n1(py + 0.9)}" rx="${n1(r)}" ry="${n1(r * 0.85)}" fill="rgba(60,50,30,0.2)"/>` +
      `<ellipse cx="${n1(px)}" cy="${n1(py)}" rx="${n1(r)}" ry="${n1(r * 0.85)}" fill="hsl(${Math.round(lerp(44, 52, rng()))} ${Math.round(lerp(38, 50, rng()))}% ${Math.round(lerp(64, 72, rng()))}%)"/>`;
  }
  return out;
}

// --- Industry ----------------------------------------------------------------
//
// The freight half of the world. Urban is where people are; this is where
// THINGS are, and it exists so that a depot beside it can one day mean freight
// the way a depot beside a town means passengers (see the design note in
// docs/superpowers/specs/2026-07-28-industry-and-demand-design.md — the demand
// coupling is deliberately NOT built here; this is the ground it will read).
//
// Drawn top-down under the same NW sun as everything else, but from a different
// vocabulary to the town's: circles and grids rather than pitched roofs, cool
// steel and concrete rather than warm tile, so a works never reads as a suburb.

/** A silo or tank: a cylinder from above — a ring with a lit crown. */
function silo(rng: Rng, scale: number, w: number): string {
  const r = w / 2;
  const hue = Math.round(lerp(196, 216, rng()));
  const sat = Math.round(lerp(4, 12, rng()));
  const body = lerp(58, 68, rng());
  return (
    `<circle cx="${n1(r * 0.22)}" cy="${n1(r * 0.22)}" r="${n1(r)}" fill="${STONE_SHADOW}"/>` +
    `<circle cx="0" cy="0" r="${n1(r)}" fill="hsl(${hue} ${sat}% ${Math.round(body - 14)}%)"/>` +
    `<circle cx="${n1(-r * 0.16)}" cy="${n1(-r * 0.16)}" r="${n1(r * 0.74)}" fill="hsl(${hue} ${sat}% ${Math.round(body)}%)"/>` +
    // The cap ring, and the ladder that tells you the scale of the thing.
    `<circle cx="${n1(-r * 0.16)}" cy="${n1(-r * 0.16)}" r="${n1(r * 0.3)}" fill="hsl(${hue} ${sat}% ${Math.round(body + 10)}%)"/>` +
    `<rect x="${n1(-r * 0.06)}" y="${n1(-r)}" width="${n1(0.12 * r)}" height="${n1(r * 0.5)}" fill="hsl(${hue} ${sat}% ${Math.round(body - 24)}%)"/>`
  );
}

/**
 * A container stack: rows of boxes in shipping colours. The one object on the
 * board that is unambiguously about FREIGHT, which is the whole point of the
 * kind — a player should be able to tell what a siding is for by looking.
 */
function containers(rng: Rng, scale: number, w: number, d: number): string {
  const cols = 3 + Math.floor(rng() * 3);
  const rows = 2 + Math.floor(rng() * 2);
  const bw = (w / cols) * 0.86;
  const bd = (d / rows) * 0.8;
  const HUES = [8, 30, 120, 205, 268, 350];
  let out = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng() < 0.16) continue; // gaps: a yard is never full
      const px = -w / 2 + (c + 0.5) * (w / cols);
      const py = -d / 2 + (r + 0.5) * (d / rows);
      const hue = HUES[Math.floor(rng() * HUES.length)];
      const light = Math.round(lerp(40, 56, rng()));
      out +=
        `<rect x="${n1(px - bw / 2 + 0.8 * scale)}" y="${n1(py - bd / 2 + 0.8 * scale)}" width="${n1(bw)}" height="${n1(bd)}" fill="${STONE_SHADOW}"/>` +
        `<rect x="${n1(px - bw / 2)}" y="${n1(py - bd / 2)}" width="${n1(bw)}" height="${n1(bd)}" fill="hsl(${hue} ${Math.round(lerp(34, 52, rng()))}% ${light}%)"/>` +
        `<rect x="${n1(px - bw / 2)}" y="${n1(py - bd / 2)}" width="${n1(bw)}" height="${n1(bd * 0.42)}" fill="hsl(${hue} ${Math.round(lerp(30, 46, rng()))}% ${light + 8}%)"/>`;
    }
  }
  return out;
}

/** A works shed: the town's hall, longer and in works colours. */
function works(rng: Rng, scale: number, w: number, d: number): string {
  const hue = Math.round(lerp(200, 214, rng()));
  const sat = Math.round(lerp(3, 9, rng()));
  // Pitched roofs shade their far half 18 points down, so a shed pitched at the
  // town's lightness came out near-black on the works' own grey ground — a dark
  // bar rather than a building. Lit from higher up.
  const light = lerp(58, 66, rng());
  // Ventilators along the ridge — the detail that says "shed with something
  // running inside it" rather than "warehouse".
  let vents = "";
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const vx = lerp(-w * 0.36, w * 0.36, n === 1 ? 0.5 : i / (n - 1));
    vents += `<rect x="${n1(vx - 1.6 * scale)}" y="${n1(-1.6 * scale)}" width="${n1(3.2 * scale)}" height="${n1(3.2 * scale)}" fill="hsl(${hue} ${sat}% ${Math.round(light - 22)}%)"/>`;
  }
  return roofShadow(w, d, scale) + pitched(w, d, hue, sat, light, scale) + vents;
}

interface WorksArchetype {
  weight: number;
  w: [number, number];
  d: [number, number];
  draw: (rng: Rng, scale: number, w: number, d: number) => string;
}

const WORKS: WorksArchetype[] = [
  // A silo is round, so its footprint is its diameter both ways.
  { weight: 2, w: [22, 32], d: [22, 32], draw: (r, s, w) => silo(r, s, w) },
  { weight: 2.2, w: [38, 56], d: [30, 44], draw: containers },
  { weight: 3, w: [54, 76], d: [30, 40], draw: works },
  { weight: 1.6, w: [42, 56], d: [34, 46], draw: block },
];

const worksReach = (a: WorksArchetype): number => Math.hypot(a.w[1], a.d[1]) / 2;

/** One works object, sized to the room measured at its spot (as `building`). */
function worksBuilding(
  rng: Rng,
  scale: number,
  room: number,
): { svg: string; reach: number } {
  const fits = WORKS.filter(a => worksReach(a) <= room);
  const pool = fits.length > 0 ? fits : [WORKS[0]];
  const total = pool.reduce((s, a) => s + a.weight, 0);
  let r = rng() * total;
  let pick = pool[0];
  for (const a of pool) {
    r -= a.weight;
    if (r <= 0) {
      pick = a;
      break;
    }
  }
  const w = lerp(pick.w[0], pick.w[1], rng()) * scale;
  const d = lerp(pick.d[0], pick.d[1], rng()) * scale;
  // Works buildings sit SQUARE to the yard, unlike the town's jittered roofs:
  // a plant is laid out, a village grew.
  const ang = lerp(-4, 4, rng());
  return {
    svg: `<g transform="rotate(${ang.toFixed(1)})">${pick.draw(rng, scale, w, d)}</g>`,
    reach: Math.hypot(w, d) / 2,
  };
}

/** Hardstanding: the concrete apron a works stands on, with its joint lines. */
function apron(rng: Rng): string {
  const w = lerp(30, 52, rng());
  const d = lerp(20, 34, rng());
  const tone = `hsl(${Math.round(lerp(204, 216, rng()))} ${Math.round(lerp(3, 8, rng()))}% ${Math.round(lerp(60, 68, rng()))}%)`;
  return `<rect x="${n1(-w / 2)}" y="${n1(-d / 2)}" width="${n1(w)}" height="${n1(d)}" fill="${tone}" opacity="0.8"/>`;
}

/** A lily pad with the odd flower — enough to say "this water is shallow here". */
function lily(rng: Rng, scale: number): string {
  const r = 5.5 * scale;
  const n = (v: number) => v.toFixed(1);
  const pad = `<ellipse cx="0" cy="0" rx="${n(r)}" ry="${n(r * 0.78)}" fill="hsl(120 32% 42%)" opacity="0.85"/>`;
  const flower =
    rng() < 0.35
      ? `<circle cx="${n(r * 0.3)}" cy="${n(-r * 0.25)}" r="${n(r * 0.32)}" fill="hsl(340 55% 88%)"/>`
      : "";
  return pad + flower;
}

// --- Ground marks ------------------------------------------------------------
//
// Flat things PAINTED on the ground rather than standing on it: scree under a
// rock field, paving and gardens between the buildings of a town. They are laid
// down before the standing objects and never sorted with them, so a boulder
// always sits ON its debris and a house always stands ON its yard.

/**
 * A paved yard or forecourt: a slightly skewed slab, a touch lighter and greyer
 * than the ground. Deliberately LOW contrast — pushed brighter it stops reading
 * as ground and starts reading as white paper dropped on the town.
 */
function paving(rng: Rng): string {
  // Sized against the buildings it serves (see the TOWN archetypes): a forecourt
  // narrower than a car is a doormat.
  const w = lerp(24, 42, rng());
  const d = lerp(14, 26, rng());
  const skew = lerp(-3.5, 3.5, rng());
  const tone = `hsl(${Math.round(lerp(32, 46, rng()))} ${Math.round(lerp(5, 11, rng()))}% ${Math.round(lerp(66, 74, rng()))}%)`;
  return poly(
    [
      { x: -w / 2 + skew, y: -d },
      { x: w / 2 + skew, y: -d },
      { x: w / 2, y: 0 },
      { x: -w / 2, y: 0 },
    ],
    tone,
    ' opacity="0.85"',
  );
}

/** A garden plot: the green between the houses, so a town isn't all render. */
function garden(rng: Rng): string {
  const w = lerp(20, 34, rng());
  const d = w * lerp(0.4, 0.6, rng());
  const tone = `hsl(${Math.round(lerp(96, 122, rng()))} ${Math.round(lerp(20, 32, rng()))}% ${Math.round(lerp(46, 55, rng()))}%)`;
  return `<ellipse cx="0" cy="${n1(-d / 2)}" rx="${n1(w / 2)}" ry="${n1(d / 2)}" fill="${tone}" opacity="0.55"/>`;
}

function groundMarks(
  kind: TerrainKind,
  rng: Rng,
  base: Hsl,
  place: (x: number, y: number) => Pt2,
  clear: (p: Pt2, r: number) => boolean,
  // The bearing anything aligned to the ground should follow — the field's
  // furrow direction. Zero for every kind that has no such direction.
  along = 0,
): string {
  // Marks that land on a corridor are simply dropped (no retries): they are
  // filler, and bare ballast beside the line reads better than a garden on it.
  const spread = (
    count: number,
    radius: number,
    make: () => string,
    yBand: [number, number] = [20, 88],
  ): string => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const p = place(lerp(14, 86, rng()), lerp(yBand[0], yBand[1], rng()));
      if (!clear(p, radius)) continue;
      out.push(`<g transform="translate(${n1(p.x)} ${n1(p.y)})">${make()}</g>`);
    }
    return out.join("");
  };
  if (kind === "rock") {
    return (
      spread(3 + Math.floor(rng() * 3), 12, () => shelf(rng, base)) +
      spread(5 + Math.floor(rng() * 4), 4, () => pebble(rng, 1))
    );
  }
  if (kind === "mountain") {
    // Top-down, there is no "foot of the range" — scree lies wherever the
    // ridges are not, and the depth sort keeps a massif on top of its gravel.
    return (
      spread(3 + Math.floor(rng() * 3), 12, () => shelf(rng, base)) +
      spread(4 + Math.floor(rng() * 3), 4, () => pebble(rng, 0.85, 53))
    );
  }
  if (kind === "urban") {
    return (
      spread(3 + Math.floor(rng() * 3), 10, () => paving(rng)) +
      spread(2 + Math.floor(rng() * 3), 8, () => garden(rng))
    );
  }
  if (kind === "industry") {
    return spread(2 + Math.floor(rng() * 2), 12, () => apron(rng));
  }
  if (kind === "farmland") {
    // The stripes themselves are laid by the caller (they need the patch clip);
    // these are what breaks them up. Sparse on purpose: the furrows are the
    // texture, and a hedge on every tile turns a landscape into a maze. Hedges
    // get no keep-out radius worth the name — a hedge beside the line is
    // exactly right.
    return (
      (rng() < 0.55 ? spread(1, 3, () => hedge(rng, along)) : "") +
      (rng() < 0.35 ? spread(1, 8, () => bales(rng)) : "")
    );
  }
  return "";
}

// One deterministic RNG per tile: the same coord in the same world always draws
// the same trees. FNV-1a over the coord id, mixed with the world seed.
function tileRng(coordId: string, seed: number): Rng {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < coordId.length; i++) {
    h ^= coordId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return makeRng(h >>> 0);
}

// --- Assembly ----------------------------------------------------------------

// Memo: the ground of a tile only changes when its kind, its neighbours' kinds,
// its coord, the world seed or the tracks/roads through it change — none of
// which move during play. Without this, panning a 20x14 board would redraw
// ~280 tiles of procedural art per frame.
const cache = new Map<string, { ground: string; scatter: string; canopy: string }>();

function buildCached(
  kind: TerrainKind,
  coordId: string,
  neighbours: TerrainNeighbours,
  seed: number,
  corridors: Corridor[],
): { ground: string; scatter: string; canopy: string } {
  const same: PatchSame = {
    top: neighbours.top === kind,
    right: neighbours.right === kind,
    bottom: neighbours.bottom === kind,
    left: neighbours.left === kind,
    topLeft: neighbours.topLeft === kind,
    topRight: neighbours.topRight === kind,
    bottomRight: neighbours.bottomRight === kind,
    bottomLeft: neighbours.bottomLeft === kind,
  };
  // The diagonals belong in the key too: two tiles with identical sides but a
  // different corner neighbour draw different outlines (mid-shore vs turn).
  // The corridors belong in it because building a line THROUGH a tile reflows
  // its scatter — that is the whole feature.
  const corrKey = corridors
    .map(c => `${c.half}:${c.pts.map(p => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(";")}`)
    .join("|");
  const key =
    `${kind}|${+same.top}${+same.right}${+same.bottom}${+same.left}` +
    `${+same.topLeft!}${+same.topRight!}${+same.bottomRight!}${+same.bottomLeft!}` +
    `|${coordId}|${seed}|${corrKey}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const built = buildGround(kind, coordId, same, seed, corridors);
  cache.set(key, built);
  return built;
}

// --- Heights: hypsometric terraces -------------------------------------------
//
// A cell with `height > 0` lays a TERRACE under whatever else it carries: a
// fused patch fill in a lighter, sunnier green per step (classic hypsometric
// tinting), so higher ground visibly IS higher ground. Neighbours AT OR ABOVE
// this height CONTINUE the terrace (the higher neighbour lays its own, lighter
// body on the shared reading), so a plateau fuses into one organic shape
// exactly the way a lake does — and the edge toward LOWER ground becomes the
// slope face, painted under the one NW sun everything else obeys: the north
// and west faces catch light, the south and east faces fall into shade.
// The terrace deliberately reuses the patch machinery (patchPath /
// patchSegments), so its outline jitters off the grid and its shared edges
// fuse invisibly, like every other body of ground in the game.

// A terrace is grass-family ground, so its tint is ANCHORED TO THE THEME's
// board green and climbs from there — a fixed table read as a hollow on the
// bright meadow board and as a glowing patch on the dark debug backdrop,
// because "higher" is only ever higher RELATIVE to the ground it stands on.
// One base per theme, one formula for the steps (per the terrain roadmap's
// theming note: a tint function at the Hsl boundary, never per-kind tables):
// each step turns toward sunny yellow-green and lifts the lightness, so two
// adjacent steps stay tellable apart on any backdrop.
const TERRACE_BASE: Record<string, Hsl> = {
  // Just above the meadow board's green (#6aac6a ≈ hsl(120 28% 55%)).
  meadow: [112, 30, 60],
  // A drier grass-mat green, the way a model-railway baseboard paints hills.
  table: [92, 24, 62],
  // The debug flat ground (#3a6b4f, TestStage) is much darker than any theme
  // board — anchored separately so `npm run shot` pictures stay comparable.
  plain: [104, 30, 44],
};

export function heightTint(height: number, theme = "meadow"): Hsl {
  const step = Math.max(1, height) - 1;
  const [bh, bs, bl] = TERRACE_BASE[theme] ?? TERRACE_BASE.meadow;
  return [bh - 9 * step, bs + 2 * step, Math.min(bl + 6 * step, 82)];
}

// Memo, for the same reason as `cache` below: a terrace only changes with its
// height, its neighbour comparison, its coord or the seed.
const heightCache = new Map<string, string>();

/**
 * The terrace one elevated tile lays, as an SVG fragment in the 0..100 box.
 * `same` compares NEIGHBOUR HEIGHT >= this height (fuse) — lower neighbours
 * are where the slope faces paint. "" at ground level.
 */
export function tileHeightSvg(
  height: number,
  coordId: string,
  same: PatchSame,
  seed = 1,
  theme = "meadow",
): string {
  if (height <= 0) return "";
  // THE THEME IS PART OF THE KEY — the memo trap the terrain roadmap wrote
  // down before anyone hit it: switch theme mid-session and a key without it
  // serves every terrace from the old palette.
  const key =
    `h${height}|${+same.top}${+same.right}${+same.bottom}${+same.left}` +
    `${+same.topLeft!}${+same.topRight!}${+same.bottomRight!}${+same.bottomLeft!}` +
    `|${coordId}|${seed}|${theme}`;
  const hit = heightCache.get(key);
  if (hit !== undefined) return hit;

  const { x, y } = parseCoordId(coordId);
  const [hh, hs, hl] = heightTint(height, theme);
  const d = patchPath(same, x, y, seed, GROUND_UNITS);
  const parts: string[] = [];

  // Soft fringe outside the body (unclipped, like every kind's), so the
  // terrace blends into the ground below instead of ending at a hard line.
  const fringeD = patchRimPath(same, x, y, seed, GROUND_UNITS);
  if (fringeD) {
    parts.push(
      `<path d="${fringeD}" fill="none" stroke="${css([hh, hs, hl])}" stroke-width="30" stroke-linecap="round" opacity="0.15"/>`,
      `<path d="${fringeD}" fill="none" stroke="${css([hh, hs, hl])}" stroke-width="15" stroke-linecap="round" opacity="0.3"/>`,
    );
  }
  parts.push(`<path d="${d}" fill="${css([hh, hs, hl])}"/>`);

  // The slope faces: each DOWNHILL edge stroked inside the body — lit where it
  // faces the sun (top/left), shaded where it faces away (right/bottom). Edge
  // order is patchSegments' clockwise walk: 0 top, 1 right, 2 bottom, 3 left.
  const slopes = patchSegments(same, x, y, seed, GROUND_UNITS)
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.stops);
  if (slopes.length > 0) {
    const clipId = `height-clip-${coordId.replace(",", "-")}-${height}`;
    parts.unshift(`<clipPath id="${clipId}"><path d="${d}"/></clipPath>`);
    for (const { s, i } of slopes) {
      const lit = i === 0 || i === 3;
      const tone: Hsl = lit ? [hh, hs - 4, hl + 8] : [hh, hs + 4, hl - 11];
      const seg = `M${n1(s.a.x)} ${n1(s.a.y)} ${cubic(s)}`;
      parts.push(
        `<path d="${seg}" fill="none" stroke="${css(tone)}" stroke-width="13" stroke-linecap="round" clip-path="url(#${clipId})" opacity="0.8"/>`,
      );
    }
  }

  const built = parts.join("");
  heightCache.set(key, built);
  return built;
}

/**
 * The FLAT ground for one tile as an SVG fragment, in a 0..100 box: the terrain
 * patch, its rim and its ground marks (paving, scree, gardens). Returns "" for
 * grass (see terrainOf) so the common tile costs nothing. Renders UNDER
 * everything, including every neighbour's standing objects.
 */
export function tileGroundSvg(
  kind: TerrainKind,
  coordId: string,
  neighbours: TerrainNeighbours = ALL_GRASS,
  seed = 1,
  corridors: Corridor[] = [],
): string {
  return buildCached(kind, coordId, neighbours, seed, corridors).ground;
}

/**
 * The tile's STANDING objects — trees, bushes, boulders, ridges, buildings —
 * on their own layer above every tile's ground patch. The split is what stops
 * the next tile's opaque patch fill (later in the DOM) decapitating a canopy
 * that legitimately overhangs the seam: patches all live below, scatter all
 * lives above. Still under the rails and roads (see TileGround.vue).
 */
export function tileScatterSvg(
  kind: TerrainKind,
  coordId: string,
  neighbours: TerrainNeighbours = ALL_GRASS,
  seed = 1,
  corridors: Corridor[] = [],
): string {
  return buildCached(kind, coordId, neighbours, seed, corridors).scatter;
}

/**
 * The tile's OVERHEAD art: forest trees whose trunks stand beside a corridor
 * but whose canopies reach over it. Rendered on a layer above the trains (see
 * TileGround.vue), so a train passes underneath. "" for every other kind, and
 * for any forest tile with no line through or beside it.
 */
export function tileCanopySvg(
  kind: TerrainKind,
  coordId: string,
  neighbours: TerrainNeighbours = ALL_GRASS,
  seed = 1,
  corridors: Corridor[] = [],
): string {
  return buildCached(kind, coordId, neighbours, seed, corridors).canopy;
}

/**
 * What grows on plain grass.
 *
 * A separate build from `buildGround` because grass is a separate case in every
 * way that matters: NO PATCH (so no fill, no rim, no outline to keep things
 * inside — the world theme's backdrop is the ground here and must stay visible),
 * and density that comes from a world noise field rather than from a per-kind
 * constant, so open country varies across the board instead of being one flat
 * green everywhere.
 *
 * Corridors still apply: a tuft standing in the ballast is as wrong as a tree
 * is. Marks and scatter both drop rather than retry — this is filler, and bare
 * verge beside the line is exactly right.
 */
function buildMeadow(
  coordId: string,
  seed: number,
  corridors: Corridor[],
): { ground: string; scatter: string; canopy: string } {
  const rng = tileRng(coordId, seed);
  const { x, y } = parseCoordId(coordId);
  const room = (p: Pt2): number =>
    corridors.length ? corridorClearance(p, corridors) : Infinity;
  // Roughness at the tile's centre. One sample per tile is enough — the field
  // is smooth over four tiles, so neighbours land close together and a rough
  // stretch fades into a cropped one over several tiles rather than at a seam.
  const rough = meadowRoughnessAt(x + 0.5, y + 0.5, seed);

  // Broad, very low-contrast sward blobs first: the tonal variation that stops
  // a big open expanse reading as one flat colour. They are ground, so they go
  // under everything and take no part in the depth sort.
  const marks: string[] = [];
  const swardCount = 2 + Math.floor(rng() * 2 + rough * 2);
  for (let i = 0; i < swardCount; i++) {
    const p = { x: lerp(18, 82, rng()), y: lerp(18, 82, rng()) };
    if (room(p) < 6) continue;
    marks.push(`<g transform="translate(${n1(p.x)} ${n1(p.y)})">${sward(rng)}</g>`);
  }

  // Then what stands in it. Tufts everywhere, flowers and bushes only where the
  // ground is rough, a lone thorn tree rarer still — so a cropped stretch is
  // nearly bare and a rough one is properly shaggy.
  const count = Math.round(lerp(2, 11, rough));
  const placed: { y: number; g: string }[] = [];
  for (let i = 0; i < count; i++) {
    const p = { x: lerp(10, 90, rng()), y: lerp(10, 90, rng()) };
    const roll = rng();
    const scale = lerp(0.8, 1.25, rng());
    let body: string;
    let foot: number;
    if (roll < 0.06 + rough * 0.06) {
      body = tree(rng, scale * 0.34);
      foot = 11 * scale;
    } else if (roll < 0.2 + rough * 0.18) {
      body = bush(rng, scale * 0.4);
      foot = 7 * scale;
    } else if (roll < 0.44 + rough * 0.2) {
      body = flowers(rng, scale);
      foot = 6 * scale;
    } else {
      body = tuft(rng, scale);
      foot = 4 * scale;
    }
    if (room(p) < foot) continue;
    placed.push({
      y: p.y,
      g: `<g transform="translate(${n1(p.x)} ${n1(p.y)})">${body}</g>`,
    });
  }
  placed.sort((a, b) => a.y - b.y);
  return {
    ground: marks.join(""),
    scatter: placed.map(p => p.g).join(""),
    canopy: "",
  };
}

function buildGround(
  kind: TerrainKind,
  coordId: string,
  same: PatchSame,
  seed: number,
  corridors: Corridor[],
): { ground: string; scatter: string; canopy: string } {
  const base = GROUND[kind];
  // Grass has no ground of its own to paint, but it does have things growing on
  // it — a different build entirely, and the only one that must never emit a
  // fill (see meadowScatter).
  if (kind === "grass") return buildMeadow(coordId, seed, corridors);
  if (!base) return { ground: "", scatter: "", canopy: "" };

  const rng = tileRng(coordId, seed);
  const { x, y } = parseCoordId(coordId);

  const style = edgeStyleOf(kind);
  const d = patchPath(same, x, y, seed, GROUND_UNITS, style);

  // A SOFT FRINGE, before the fill and deliberately NOT clipped.
  //
  // Every kind used to end at a hard line: the fill stopped, the grass began,
  // and a wood or a rock field read as a sticker laid on the meadow however good
  // its outline was. Two translucent strokes of the patch's own colour along the
  // edges where it STOPS (never the internal joins — those are invisible) give
  // it a falloff instead: the fill covers the inward half, so what shows is an
  // outward halo fading into whatever is next door. A wide faint pass plus a
  // narrower stronger one approximates a gradient without an SVG filter, which
  // at ~280 tiles a board is worth avoiding.
  //
  // Unclipped means it spills onto the neighbour, which is the point — and both
  // sides of a boundary lay one, so the blend reads the same whichever tile the
  // DOM happens to draw second. Surveyed ground gets a tighter fringe: a field
  // ends at a hedge and a town at a fence, so its edge is soft, not vague.
  const parts: string[] = [];
  const fringeD = patchRimPath(same, x, y, seed, GROUND_UNITS, style);
  if (fringeD) {
    // Sized against the shore's own inset (SHORE_PULL_MIN): the stroke is
    // centred on the boundary, so half of it reaches outward — half of `wide`
    // is what the halo spills, and keeping that within the pull is what stops
    // the ONE deliberately unclipped thing a patch draws from painting a lake's
    // blue onto the meadow two tiles over.
    const [wide, tight] = style === "surveyed" ? [14, 7] : [20, 10];
    parts.push(
      `<path d="${fringeD}" fill="none" stroke="${css(base)}" stroke-width="${wide}" stroke-linecap="round" opacity="0.15"/>`,
      `<path d="${fringeD}" fill="none" stroke="${css(base)}" stroke-width="${tight}" stroke-linecap="round" opacity="0.3"/>`,
    );
  }
  parts.push(`<path d="${d}" fill="${css(base)}"/>`);

  // Everything placed on this tile must STAND ON the patch. The bands keep
  // objects off the tile edges, but a real corner now cedes a deep bite of the
  // tile to the surrounding grass (CORNER_INSET) — a band-legal position there
  // would put a tree on the lawn or a lily on the shore. A placement outside
  // the outline walks toward the patch centroid until it is inside with a
  // little margin (tested against the polygon inflated about the centroid, so
  // the margin scales with how far out the point sits). Deterministic: no extra
  // rng draws, so positions only move where the geometry demands it.
  const poly = patchOutlinePolygon(same, x, y, seed, GROUND_UNITS, style);
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  const insideWithMargin = (px: number, py: number): boolean =>
    pointInPolygon({ x: cx + (px - cx) / 0.88, y: cy + (py - cy) / 0.88 }, poly);
  const place = (px: number, py: number): Pt2 => {
    for (let k = 0; k <= 10; k++) {
      const q = { x: lerp(px, cx, k / 10), y: lerp(py, cy, k / 10) };
      if (insideWithMargin(q.x, q.y)) return q;
    }
    return { x: cx, y: cy };
  };

  // The rim is a thick inside stroke along the STOPPING edges only (see
  // patchRimPath), clipped to the patch so it reads as a band just inside the
  // shore rather than a line drawn on it.
  //
  // ROUND CAPS, not the default butt. Each tile strokes only its own share of a
  // shore, so on a shore that runs across several tiles the segments ABUT — and
  // two butt caps meeting on the same line antialias to a half-covered pixel
  // column, i.e. a dark tick across the shallows at every tile boundary. It is
  // the same defect SEAM_OVERLAP fixes for the fill, and it only became visible
  // once the shore itself stopped kinking there. The cap's overhang is harmless:
  // the clip path is the patch, so it can only spill into the SEAM_OVERLAP the
  // neighbour also covers, and at a real corner it is cut off entirely.
  const clipId = `terrain-clip-${coordId.replace(",", "-")}-${kind}`;
  let clipped = false;
  const needClip = (): string => {
    if (!clipped) {
      parts.unshift(`<clipPath id="${clipId}"><path d="${d}"/></clipPath>`);
      clipped = true;
    }
    return clipId;
  };

  // The furrows go straight after the base fill and before every other mark, so
  // hedges and bales lie ON the crop. Clipped to the patch: a stripe is a long
  // bar crossing the whole tile, and unclipped it would run out onto the grass.
  if (kind === "farmland") {
    parts.push(
      `<g clip-path="url(#${needClip()})" opacity="0.92">${fieldStripes(x, y, seed)}</g>`,
      // …and the hedge wherever the field next door is a different field. Also
      // clipped: a boundary hedge belongs to the farmland, not to the grass or
      // the ballast beyond it.
      `<g clip-path="url(#${needClip()})">${fieldBoundaries(x, y, seed, same)}</g>`,
    );
  }

  const rim = RIM[kind];
  const rimD = rim ? fringeD : "";
  if (rim && rimD) {
    parts.push(
      `<path d="${rimD}" fill="none" stroke="${css(rim)}" stroke-width="9" stroke-linecap="round" clip-path="url(#${needClip()})" opacity="0.75"/>`,
    );
  }

  // How much room a point has to the nearest line — and, once a building has
  // gone up, to that too. A placed building is pushed on as a degenerate
  // one-point corridor with its own footprint as the half-width, so "don't
  // build on the railway" and "don't build on the house next door" are the
  // same test rather than two. Without it a tile's two or three buildings, now
  // that they are building-sized, simply pile on top of each other.
  const blockers = corridors.slice();
  const room = (p: Pt2): number =>
    blockers.length ? corridorClearance(p, blockers) : Infinity;

  // Flat marks first: scree, paving, gardens. They belong to the ground, so they
  // go under everything that stands on it and take no part in the depth sort.
  const marks = groundMarks(
    kind,
    rng,
    base,
    place,
    (p, r) => room(p) >= r,
    kind === "farmland" ? fieldPlanAt(x, y, seed).angle : 0,
  );
  if (marks) parts.push(marks);

  const [lo, hi] = SCATTER_COUNT[kind];
  let count = lo + Math.floor(rng() * (hi - lo + 1));
  let band = SCATTER_BAND[kind] ?? DEFAULT_BAND;
  if (kind === "forest") {
    // The deeper in the wood, the denser and taller. A tile's depth is how many
    // of its 8 neighbours are forest too — a local measure, but it is exactly
    // the interior of a LARGE area that scores high, so a big wood closes into
    // overlapping canopy while a lone copse keeps today's airy scatter. Local
    // also means it needs nothing beyond the neighbours the cache key already
    // carries.
    const depth =
      [
        same.top,
        same.right,
        same.bottom,
        same.left,
        same.topLeft,
        same.topRight,
        same.bottomRight,
        same.bottomLeft,
      ].filter(Boolean).length / 8;
    // The bonus also compensates for the band: at full depth the placement
    // area grows from the 80x80 interior box to the whole tile, so the count
    // has to grow with it or the deep wood comes out SPARSER per square unit
    // than the copse (which is how the seam-widening first shipped).
    count += Math.round(18 * depth);
    band = {
      ...band,
      // Where the wood continues into the next tile, trees may stand right on
      // the seam — the two tiles' scatter interleaves and the forest closes
      // over the boundary. (The scatter layer renders above every patch fill,
      // so an overhanging canopy no longer gets cut by the neighbour; and a
      // neighbour's rails are already in `corridors`.) Toward grass or another
      // kind the margin stays.
      x: [same.left ? 0 : band.x[0], same.right ? GROUND_UNITS : band.x[1]],
      y: [same.top ? 0 : band.y[0], same.bottom ? GROUND_UNITS : band.y[1]],
      scale: [band.scale[0], band.scale[1] + 0.45 * depth],
    };
  }
  const placed: { y: number; g: string }[] = [];
  const overhead: { y: number; g: string }[] = [];
  for (let i = 0; i < count; i++) {
    // Keep objects ON the patch (see `place` above) and their footprint OFF
    // every corridor. An object that can't find clear ground in a few tries is
    // dropped: the wood thins along the railway, the town steps back from it,
    // which is what a cleared right-of-way looks like.
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = place(
        lerp(band.x[0], band.x[1], rng()),
        lerp(band.y[0], band.y[1], rng()),
      );
      let scale = lerp(band.scale[0], band.scale[1], rng());
      // Glades: reject trees where the density field runs low. A rejected spot
      // occasionally keeps a low BUSH — the lighter growth of a clearing —
      // and trees near a glade's rim come out a little smaller. The roll is
      // drawn every attempt regardless, so the rng stream's shape doesn't
      // depend on the field.
      const gladeRoll = rng();
      if (kind === "forest") {
        const density = forestDensityAt(
          x + p.x / GROUND_UNITS,
          y + p.y / GROUND_UNITS,
          seed,
        );
        const keep = gladeKeep(density);
        if (gladeRoll > keep) {
          // A roll JUST over the bar keeps a low bush: the lighter growth rims
          // the glade rather than carpeting it.
          if (gladeRoll < keep + 0.15 && room(p) >= TRUNK_CLEAR) {
            placed.push({
              y: p.y,
              g: `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">${bush(rng, scale * 0.42)}</g>`,
            });
            break;
          }
          continue;
        }
        // Trees shrink only in the shoulder around a glade; the full wood
        // keeps its full-grown crowns.
        scale *= lerp(0.8, 1, Math.min(1, keep + 0.2));
      }
      const clear = room(p);
      // The forest exception: a trunk standing just OFF the ballast whose
      // canopy reaches over the line. It renders on the canopy layer, above the
      // trains — the pass-under effect — and leans big, because a sapling's
      // crown wouldn't reach the ballast in the first place.
      const overhang =
        kind === "forest" && clear < FOOT.forest * scale && clear >= TRUNK_CLEAR;
      if (clear < FOOT[kind] * scale && !overhang) continue;
      let body: string;
      if (kind === "forest") {
        body = tree(rng, (overhang ? Math.max(scale, 1.05) : scale) * 0.42);
      } else if (kind === "rock") body = boulder(rng, scale);
      else if (kind === "mountain") body = peak(rng, scale);
      // The town picks a building that FITS the room measured here, rather than
      // one size that has to fit everywhere: a shed or a house on the frontage,
      // a terrace or a hall in the depth of the block. The tile edge counts as
      // room too (plus TOWN_OVERHANG), or the big archetypes would land half on
      // the neighbouring tile, which cannot see them to keep clear.
      else if (kind === "urban" || kind === "industry") {
        const toEdge =
          Math.min(p.x, p.y, GROUND_UNITS - p.x, GROUND_UNITS - p.y) + TOWN_OVERHANG;
        const room = Math.min(clear, toEdge) / scale;
        const built =
          kind === "urban"
            ? building(rng, scale, room)
            : worksBuilding(rng, scale, room);
        blockers.push({ pts: [p, p], half: built.reach });
        body = built.svg;
      } else body = lily(rng, scale);
      (overhang ? overhead : placed).push({
        y: p.y,
        g: `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">${body}</g>`,
      });
      break;
    }
  }
  // Back to front, so a nearer canopy overlaps a farther one naturally.
  placed.sort((a, b) => a.y - b.y);
  overhead.sort((a, b) => a.y - b.y);

  return {
    ground: parts.join(""),
    scatter: placed.map(p => p.g).join(""),
    canopy: overhead.map(p => p.g).join(""),
  };
}

// Test seam: the memo would otherwise make "same input, same output" untestable
// against a changed implementation.
export function _clearTerrainCache(): void {
  cache.clear();
}
