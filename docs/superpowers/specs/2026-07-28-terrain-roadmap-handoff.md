# Terrain roadmap — handoff for a fresh session

**Context.** Written 2026-07-28 to hand the terrain thread to a new session.
The original target — a procedural terrain pass in `generateLevel` — was
**built by a parallel session while this was being planned**: see
`src/tiles/generateTerrain.ts` (`paintTerrain`: lake inside the track ring,
rock/woods/town in the margin, blob growth on its own rng stream, capped
unbuildable fraction, validator-safety property pinned by
`tests/unit/tiles/generate.spec.ts`). Generated and Daily boards now have
ground. **Do not rebuild it.** What follows is what actually remains, ranked.

Read first: `docs/KNOWHOW.md` → TERRAIN / TERRAIN RULES sections (top-down
scatter, keep-out corridors, forest depth, canopy layer, build pricing), and
`docs/superpowers/specs/2026-07-25-terrain-as-tile-data-design.md`.

## Terrain state of the world (2026-07-28)

- Kinds: `grass | forest | water | rock | mountain | urban` (`TileCell.terrain?`,
  absent = grass, grass draws nothing).
- Rules: `canBuildOn` (water/rock/mountain block; bridge/tunnel are planned as
  *exceptions inside it*, IMPROVEMENTS item 6) and `TERRAIN_BUILD_FACTOR`
  (forest 1.5x / urban 2.5x per piece via `game.buildCostOf`; undo returns the
  terrain-priced cost; bulldoze charges flat clearing, never refunds).
- Rendering: everything top-down under one NW sun; scatter keeps its footprint
  off rail/road corridors (`corridorsFor`); forest canopies may overhang a
  corridor and render on the canopy layer (z7 — above trains AND cars); forest
  density scales with 8-neighbour depth.
- Gallery: `terrain`, `clearing` (rail + street through wood/town),
  `forestworld` (deep wood, curvy line), `landprices` (build surcharge),
  `lakevalley*`, `daily` (generated, now terrained), `demoworld` (hand-painted
  20x14 world — see item 1).

## Remaining work, ranked

### 1. ~~Paint `demoworld`~~ — **DONE 2026-07-28**

Hand-authored in `src/levels/test/scenarios/demoworld.ts` as a `GROUND` list of
rectangles (`rect`/`without`), painted by `paintGround` as the last step of
`build()` so it sees everything already laid: a range on the north-west corner,
two woods the ring's top straight runs through, a tarn between the streets, the
town around the 9/13 × 6/9 crossroads plus a hamlet on the avenues, the
south-west wood the bottom straight runs through, a lake wrapping the south-west
corner, and rock pinning the south-east. ~16% of the board is unbuildable, well
under the 22% `generateTerrain` allows itself.

What the doing taught, beyond the traps listed here:

- **The blocker rule is best enforced, not just avoided.** `paintGround` SKIPS a
  blocking kind on any cell carrying `connections` or `road`, so an authored area
  is simply interrupted by the railway instead of the board failing validation.
  That makes regions safe to draw as plain rectangles — no hand-cut holes around
  the ring, and no way for a later edit to the layout to invalidate the ground.
- **Forest and urban are the opposite case: paint them straight over rail and
  road on purpose.** The corridor/canopy work (`/test/clearing`) means a line
  through a wood clears its own right-of-way and gets crowns overhanging it, and
  a street through town steps the houses back. Keeping non-blocking ground OFF
  the built cells throws that away and leaves patches that stop dead at every
  line.
- Leave the DEPOT cells bare inside a wood (here 6,3): the depot building wants
  its own clearing to read.
- Before/after: `docs/verify/demoworld-terrain/`.

### 2. Farmland kind (M — best visual value per effort)

The signature top-down landscape: a patchwork of field strips between towns.
- Model: new `TerrainKind` `"farmland"`, buildable, `TERRAIN_BUILD_FACTOR`
  ~1.2 ("buying farmland").
- Render: ground tone a warm straw/green; scatter = broad striped rectangles
  (two-tone rows at a slight per-field rotation) + the odd hedgerow blob —
  ground MARKS, not standing objects, so no corridor/canopy interaction
  beyond the existing keep-out for marks. Fields must come in bodies (2x2+)
  or they read as stickers.
- Wire-through checklist for ANY new kind: `TERRAIN_KINDS`, `GROUND`/`RIM`
  tones, `SCATTER_COUNT`/`SCATTER_BAND`/`FOOT`, `BLOCKS_BUILDING`,
  `TERRAIN_BUILD_FACTOR`, editor terrain palette, `generateTerrain.ts`
  placement, a `/test` scenario, terrain.spec sweeps (they iterate
  `TERRAIN_KINDS` and will catch most omissions).

### 3. Rivers + bridges (L — ship as a pair; IMPROVEMENTS item 6)

Not a new kind: a river is a 1-wide *line* of `water` cells (the patch
renderer already fuses it into a ribbon). A lake is routed around; a river
must be *crossed* — which is what makes the bridge the most interesting build
decision in the game. The bridge is the designed `canBuildOn` exception: a
cell whose two port-pairs don't interact (the connection model already
supports that). Generator follow-up: `paintTerrain` can lay a river across
the margin once bridges exist. Do bridges before painting rivers anywhere the
player must build.

### 4. Industry kind + terrain-driven demand (L — the gameplay door)

Urban is the *people* half; freight has nowhere to belong. `"industry"`:
big flat roofs, silos, container stacks (top-down, same sun), factor ~2x.
The real prize is coupling terrain to the economy: a depot beside urban
spawns passenger fares, beside industry freight fares (the fare system in
`src/modes/tycoon.ts` prices by cargo + distance already — terrain would
choose/boost the cargo). That's the first time terrain matters beyond build
cost, and it should be its own design doc when picked up.

### 5. Smaller / later

- **Hills**: buildable at ~1.5–2x, contour-shaded; later couple to
  `trainDynamics` (gradients slow heavy trains). Wait until mountain/rock
  feel insufficient.
- **Snow/desert**: `worldTheme` re-tints (`src/themes.ts`), NOT new kinds —
  they're palettes, not rules.
- **Swamp**: generator variety only; after farmland.

## Standing conventions any of this must respect

- Determinism everywhere: seeded rng, stable across loads, screenshots
  comparable; `generateTerrain` draws from its OWN stream (one extra draw on
  the generator's stream re-rolls every existing daily board).
- Top-down, one NW sun, offsets baked into points (never a nested
  `translate()` inside a prop — the placement tests parse every translate).
- Every mechanic ships with a `/test` scenario; visual work ships
  before/after shots (`npm run shot -- <id> --label …`) and ends by handing
  back clickable links.
- KNOWHOW.md upkeep in the same commit.
