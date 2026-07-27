# Procedural terrain generation — design handoff

**Status: planned, not started.** This doc is the handoff for a fresh session:
it captures the motivation, everything that already exists (as of master,
2026-07-28), a proposed design, and the traps we already know about. Read
`docs/KNOWHOW.md` → TERRAIN sections alongside it.

## Why (the gap)

`generateLevel` (`src/tiles/generate.ts`) paints **zero terrain**. Every
system built for terrain — organic patches, top-down scatter, deep-wood
density, cleared rights-of-way, canopy overhangs, `canBuildOn` blocking,
`TERRAIN_BUILD_FACTOR` pricing — is only visible on hand-authored boards
(`terrain`, `clearing`, `forestworld`, `lakevalley*`, `demoworld`). The three
generated surfaces are all bare grass:

- **Editor "Random"** — `EditorView.vue` (~line 1280) calls `generateLevel`.
- **Daily mode** — `src/modes/daily.ts` (~line 100), seeded by the date.
- **`daily` test scenario** — `src/levels/test/scenarios/daily.ts`, fixed seed.

This is IMPROVEMENTS.md item 1. It is the highest-leverage terrain work left:
it multiplies everything already merged, and needs no new art.

## What exists to build on

- **Generator today** (`src/tiles/generate.ts`): a rectangular track loop
  inset 1 from the border, depot spurs hanging outward off shuffled perimeter
  cells, seeded rng (`makeRng(seed + attempt)`), up to 50 attempts each gated
  by `validateLevel(level, routes).ok`, tiny 3-tile fallback. Deterministic
  per seed. The loop is *geometric* (a fixed rectangle), not pathfound.
- **Terrain model**: `TileCell.terrain?: grass|forest|water|rock|mountain|urban`
  (absent = grass; grass draws nothing). Terrain-only cells
  `{connections: [], terrain}` are legal and count toward `levelBounds`.
- **Rules**: `canBuildOn` (water/rock/mountain block; `validateLevel` raises
  `blocked-terrain` if track sits on a blocker) and `TERRAIN_BUILD_FACTOR`
  (forest 1.5x, urban 2.5x — priced per piece in `game.buildCostOf`).
- **Rendering** needs nothing new: patches fuse across neighbours, scatter
  avoids rail/road corridors (`corridorsFor`), forest densifies with depth
  (8-neighbour count), canopies overhang corridors above trains and cars.
- **Validation harness**: `tests/unit/levels/testScenarios.spec.ts` validates
  every registered scenario; `tests/unit/sim/roadScenarioSweep.spec.ts` needs
  `size` on road-carrying scenarios.

## Proposed design

**Track first, terrain second.** The generator's loop is a fixed rectangle,
so terrain-first would force re-routing machinery that doesn't exist. Painting
terrain *around* the already-laid track keeps `generateLevel`'s contract and
guarantees `blocked-terrain` can never fire — blockers are simply never
painted on track/depot cells.

Add a seeded terrain pass after `build()` succeeds, before `validateLevel`:

1. **Classify cells**: track/depot cells (from the build), the ring's inside
   (lake candidate — the loop encloses a rectangle of free cells, exactly
   like lakevalley's lake-in-ring), and the outside margin.
2. **Lakes**: 0–2 blobs grown from random free seeds (prefer the inside).
   Blob growth = seeded flood: start cell, repeatedly annex a random free
   4-neighbour, size ~3–7. Never annex a track/depot cell.
3. **Rock/mountain**: 0–2 blobs each in the outside margin, size ~2–5.
   Mountain and rock may abut (they read against each other).
4. **Towns**: one urban blob (size 2–4) seeded adjacent to each depot's open
   side — towns are why stations exist. Urban may cover the depot cell itself
   (buildable ground under authored track is fine and already rendered).
5. **Forest**: the filler. 1–3 large blobs (size 6–14) wherever is left,
   allowed to cross the track (that is what clearings + canopy overhang are
   for) but not to swallow every depot's approach.
6. **Grass**: whatever remains — deliberately plenty; boards need air.

Tuning: scale blob counts/sizes off `width * height`. All draws from the same
`makeRng` stream as the build (or a forked `makeRng(seed ^ const)` — either
way document it; same seed must give the same board forever, screenshots and
the daily depend on it).

### Blob quality rules (learned the hard way, see KNOWHOW)

- **Areas, not confetti.** A lone terrain tile reads as an island; prefer
  fewer, bigger blobs. Forest especially: density scales with 8-neighbour
  depth, so a big wood pays off visually and a 1-tile wood looks like today's
  copse (fine, but don't make five of them).
- **Convexish lakes.** The patch renderer bulges shores outward; a snaky
  1-wide lake is legal but reads oddly. Grow lakes compactly (annex the
  neighbour with the most already-lake neighbours).
- **Diagonal kisses split bodies** (by design — cornerInset pulls the two
  apart). Don't rely on diagonal adjacency to connect a blob.
- Keep at least one blocker blob per board when the mode charges for track:
  water/rock/mountain are what make a route a decision.

### API sketch

```ts
// generate.ts
export interface GenerateOptions {
  width: number; height: number; depotPairs: number;
  terrain?: boolean | { lakes?: number; woods?: number; ... }; // default on
}
function paintTerrain(level: Level, rand: Rng, w: number, h: number): void
```

Mutates the level in place (adding `terrain` to existing cells, creating
terrain-only cells). `validateLevel` still runs after, so a bug here fails
generation loudly instead of shipping a broken board.

## Traps / constraints

- **Determinism is load-bearing.** Same seed → same board, forever. The daily
  board is `generateLevel(dateSeed, …)`; changing the rng draw ORDER changes
  every future daily. That's acceptable once (this feature) but note it in
  the commit, and never conditionalise draws on anything non-seeded.
- **`TERRAIN_SEED` is a fixed constant** (20260726) in `TileGround.vue` —
  the *scatter* seed is not the level seed. Generated terrain varies by which
  cells carry which kind; the trees on a given coord are still world-stable.
  Fine as-is; do not thread the level seed into TileGround for this feature.
- **`blocked-terrain`**: never paint water/rock/mountain on a cell with
  `connections` or `role: "depot"`. The design above guarantees it by
  construction; the validator gate is the backstop.
- **Bounds**: terrain-only cells extend `levelBounds`. Painting inside
  `width x height` keeps the board the size the caller asked for.
- **Daily mode + tycoon pricing**: if daily (or future generated tycoon
  boards) ever charge for building, forest/urban placement changes the
  economy. Today daily doesn't charge — no tuning needed yet.
- **Perf**: terrain renders per-tile-cached; a fully-painted 7x6 is nothing.
  The editor's Random on big custom sizes is also fine (cache is per coord).

## Acceptance

- `npm run test:unit` green; add a generator spec: for ~20 seeds, assert
  (a) `validateLevel(...).ok`, (b) no blocker kind on any connected cell,
  (c) at least one non-grass blob, (d) determinism (two calls, same seed,
  deep-equal levels).
- Screenshots (`npm run shot -- daily --label before/after`) — the daily
  scenario is the natural before/after pair since it pins a fixed seed.
- Editor "Random" and `/play?mode=daily` visibly produce terrained boards.
- KNOWHOW + IMPROVEMENTS item 1 updated in the same commit.

## Out of scope (deliberately)

- Rivers/bridges/tunnels (IMPROVEMENTS item 6 — `canBuildOn` exceptions).
- New terrain kinds (farmland, industry — see the 2026-07-28 discussion:
  farmland is the top cosmetic candidate, industry pairs with freight).
- Terrain-driven traffic/demand (towns spawning fares) — the step after this.
