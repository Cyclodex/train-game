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

- Kinds (updated 2026-07-28): `grass | farmland | forest | water | rock |
  mountain | urban | industry` (`TileCell.terrain?`, absent = grass — grass lays
  no FILL, but it does grow a meadow now: see `buildMeadow`).
- Rules: `canBuildOn` (water/rock/mountain block) with the BRIDGE exception
  inside it (`TileCell.bridge`, water only — rock and mountain still wait for a
  tunnel), and `TERRAIN_BUILD_FACTOR` (farmland 1.2x / forest 1.5x / industry 2x
  / urban 2.5x per piece via `game.buildCostOf`; a span is `BRIDGE_BUILD_FACTOR`
  4x and brings its own price rather than reading the table; undo returns the
  terrain-priced cost; bulldoze charges flat clearing, never refunds).
- Rendering: everything top-down under one NW sun; scatter keeps its footprint
  off rail/road corridors (`corridorsFor`); forest canopies may overhang a
  corridor and render on the canopy layer (z7 — above trains AND cars); forest
  density scales with 8-neighbour depth.
- Gallery: `terrain`, `farmland`, `bridge`, `clearing` (rail + street through
  wood/town), `townscape` (buildings at car scale), `industry` (works against
  town), `forestworld` (deep wood, curvy line), `landprices` (build surcharge),
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

### 2. ~~Farmland kind~~ — **DONE 2026-07-28**

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
  `TERRAIN_KINDS` and will catch most omissions). *(Used twice now — farmland
  and industry. It is accurate; add `TerrainKind` in model.ts to the front.)*

**What the doing added to the plan.** Two things had to be right or a field does
not read as a field, and neither is obvious:

- The furrows are seeded by a coarse WORLD lattice (`fieldPlanAt`, 3 tiles a
  cell), never per tile — seeded per tile, every tile edge becomes a field edge
  and the ground redraws the grid the jittered outlines exist to hide.
- Draw BOTH tones every band, 12 points of lightness apart. Crop stripes over the
  base fill leave a cell whose crop landed near the base tone completely blank
  while its neighbour stripes boldly. And a finite bar has to be anchored over
  the TILE: anchored at the point of each furrow nearest the world origin, tiles
  a few hundred units away are missed entirely.

`/test/farmland`; before/after in `docs/verify/farmland/`.

### 3. ~~Rivers + bridges~~ — **DONE 2026-07-28** (IMPROVEMENTS item 6)

Not a new kind: a river is a 1-wide *line* of `water` cells (the patch
renderer already fuses it into a ribbon). A lake is routed around; a river
must be *crossed* — which is what makes the bridge the most interesting build
decision in the game. The bridge is the designed `canBuildOn` exception: a
cell whose two port-pairs don't interact (the connection model already
supports that). Generator follow-up: `paintTerrain` can lay a river across
the margin once bridges exist. Do bridges before painting rivers anywhere the
player must build.

**Built as designed, plus what the doing settled.** `TileCell.bridge`, the
exception INSIDE `canBuildOn` (so the validator, the editor and the planner all
learn about it without being told). Only water is bridgeable — rock and mountain
still wait for a tunnel. `addConnection` sets the flag, which is the one reducer
every build path funnels through, so there is no "place bridge" verb to forget;
`removeConnection` clears it, or a razed crossing leaves a free crossing bought
once.

Two numbers carry the design: `BRIDGE_MOVE` = 6x a plain move in the ROUTE
planner (a 1-wide river is worth crossing from ~6 tiles of detour away, a lake
never is — that trade-off *is* the feature) and `BRIDGE_BUILD_FACTOR` = 4 in
MONEY, the dearest thing in the game. The deck renders for road as well as rail,
because nothing about a structure is rail-specific — and a road deck must be
wider than its carriageway or it vanishes under the opaque road surface.

Still open, deliberately: no river is painted on any board the player must build
across yet (`generateTerrain` lays lakes, not rivers), and `demoworld` has no
river. That was the stated order — bridges first — and it is now the cheap next
step. `/test/bridge`; shot in `docs/verify/bridge/`.

### 4. Industry kind ~~+ terrain-driven demand~~ — KIND **DONE 2026-07-28**, demand DESIGNED

Urban is the *people* half; freight has nowhere to belong. `"industry"`:
big flat roofs, silos, container stacks (top-down, same sun), factor ~2x.
The real prize is coupling terrain to the economy: a depot beside urban
spawns passenger fares, beside industry freight fares (the fare system in
`src/modes/tycoon.ts` prices by cargo + distance already — terrain would
choose/boost the cargo). That's the first time terrain matters beyond build
cost, and it should be its own design doc when picked up.

**Split as instructed.** The KIND is built — buildable, factor 2, cool concrete
with silos, container stacks and vented sheds, laid square to the yard against
the town's jittered pitched roofs (`/test/industry` puts them side by side,
which is the only way to check neither reads as the other). The DEMAND COUPLING
is written up and not built:
`docs/superpowers/specs/2026-07-28-industry-and-demand-design.md`. Its next step
is `depotProfile(level, id)` — a pure derivation of cargo weights from the
terrain within one tile of a depot — which is cheap, safe, and used by nothing
until Tycoon reads it.

### 5. Smaller / later

- **Hills**: buildable at ~1.5–2x, contour-shaded; later couple to
  `trainDynamics` (gradients slow heavy trains). Wait until mountain/rock
  feel insufficient.
- **Snow/desert**: `worldTheme` re-tints (`src/themes.ts`), NOT new kinds —
  they're palettes, not rules.
- **Swamp**: generator variety only; after farmland.

**Assessed 2026-07-28, deliberately not built.** Each of these was left where it
is, for a reason worth writing down rather than rediscovering:

- **Hills — still wait.** The board now carries eight kinds; rock, mountain and
  the meadow's roughness field already give height the *reading* hills would add,
  and nothing yet asks the sim about gradient. Build it when `trainDynamics`
  wants a grade term, not before — it is the one item here that touches the
  simulation, and a purely cosmetic hill is a ninth kind for nothing.
- **Snow/desert — bigger than it looks, and the note above is what makes it
  cheap.** A theme today is CSS only: `THEMES` plus a `.theme-<id>` block in
  `_themes.scss`, which repaints the BACKDROP and nothing else. Terrain art is
  SVG generated in `tiles/terrain.ts` from hardcoded HSL, so a winter world would
  currently be summer fields on a snow backdrop. The work is therefore: take the
  theme at the `css()`/`green()` boundary as a tint (hue shift + desaturation +
  lightness lift), thread it into `tileGroundSvg`/`tileScatterSvg`/`tileCanopySvg`
  from `TileGround`, and — the part that will bite — **add the theme to the memo
  cache key**, or switching theme mid-session serves the old palette from cache.
  Do it as ONE tint function, not per-kind palettes: eight kinds times three
  seasons is a table nobody will keep consistent. Estimate M, mostly mechanical.
- **Swamp — unblocked now (farmland shipped), and still not worth it.** It would
  be a ninth kind whose art sits between water and forest and whose rule is
  "blocks building" — which `water` already provides. Add it when a level *design*
  wants ground that is passable on foot but not by rail, i.e. when there is a
  rule for it to carry. Generator variety alone is not a reason to widen the
  wire-through checklist.

### 6. Two things that were not on this list and should have been

Found by looking at the board rather than at the roadmap; both are done.

- **Town scale.** A tile is 100 ground units and a car is 23 of them. Houses
  shipped at 14-20 units wide — narrower than the cars driving past them — so
  every town read as a model village with full-size traffic in it. Sizes are now
  pitched against that ruler and the archetype is chosen to FIT the room measured
  at each spot (which is what lets buildings be building-sized at all). See
  KNOWHOW → TOWN SCALE; `/test/townscape`.
- **The open green.** Grass lays no fill, and that rule cannot move — a grass
  rect covers the world theme's backdrop on every tile in the game. So the answer
  is additive: grass grows tufts, flower drifts and translucent sward blobs, with
  density from a world noise field so one stretch is cropped and another shaggy.
  Worth saying plainly for whoever picks this up: **the real answer to a boring
  green is farmland**, which COVERS ground. The meadow only stops what is left
  from reading as a lawn. Judge both on a THEMED shot
  (`npm run shot -- <id> --backdrop --no-debug`) — the flat debug backdrop makes
  the meadow look far more prominent than it is.

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
