# KNOWHOW — train-game canon (dense; for the agent)

Facts we kept re-deriving/re-breaking. Read before touching tiles/curves/roads/
junctions. Terse on purpose. Companion docs: `road-network-progress.md` (road
status), `signaling-design.md`, `CLAUDE.md` (architecture).

## UPKEEP (do this every task)
After finishing any task, before the final summary: if you learned, corrected, or
disproved anything here → edit this file in the same commit. Add a fact, fix a
wrong one, delete a dead one. One-line bullets, cite `file.ts:symbol`. Keep it
lean — prune as much as you add. This file only stays useful if every task tends it.

## WORLD SIZE + CAMERA
- A world is as big as its CONTENT. `levelBounds(level, min?)` (`tiles/bounds.ts`)
  derives cols/rows from the tile coordinates; the views render that, not a fixed
  size. `gameConfig.levelSizeX` / the views' `levelSizeY` are now only the MINIMUM
  canvas a new board starts on. The old 7x6 cap was purely a rendering one —
  `game.ts` always sized the sim from the coordinates.
- Engine anchors the world at 0,0 (`roadEntries` off-grid test, generator,
  validator). To grow UP/LEFT, RE-BASE with `normaliseLevel`/`translateLevel`
  rather than introducing negative coords — and move the trains with
  `translateTrains` or every train ends up off its depot while the level still validates.
- Editor grows by drawing: grid = content + `GROW_MARGIN` (2) empty cells. The
  ⬅︎+ / ⬆︎+ dock buttons re-base for the other two sides.
- CAMERA (`camera.ts` pure maths + `cameraController.ts` DOM glue, shared by
  PlayView and TestStage): board renders at the NATIVE 200px tile (all road
  geometry is in those px — scaling tiles would mean re-deriving it) and the
  camera moves a window over it. Fits on mount. `.level` is `position:absolute` +
  `transform-origin: 0 0` inside an `overflow:hidden` viewport; the camera owns
  centring, so no `margin:auto` (they fight).
- TRAP: a class GETTER becomes a CACHED computed (vue-facing-decorator). Anything
  reading a NON-REACTIVE source — `$refs`, `clientWidth/Height`, `window.*` — must
  be a METHOD, or it caches its first value forever. `viewportSize` was a getter:
  first evaluated during the initial render, BEFORE mount with `$refs` still
  empty, so it cached the `window.innerHeight` fallback and the camera clamped
  against the whole window. The bottom of a big world was then unreachable by
  exactly the chrome height (~310px). Guarded by `npm run probe`'s camera check
  (pans to each extreme, asserts the world edge comes flush).
- TRAP: build the controller in `created()`, NOT as a class field. vue-facing-
  decorator collects data off a THROWAWAY instance, so a field initialiser's
  closures capture a `this` whose injected `config` is undefined → first render
  dies inside `worldSize()` with a null `subTree`. And `markRaw` it (CLAUDE.md).
- TRAP (same family, 2026-07-26): a WINDOW-event handler written as an
  arrow-function FIELD can capture a DEAD `this` — PlayView's Esc handler ran
  but read a forever-false `buildArmed` and an undefined `routeCtrl`, a SILENT
  no-op (no error, the guard just returned). Create the closure in `mounted()`
  (`this.bound = e => this.handle(e)` onto `!:` fields, so removeEventListener
  still matches). EditorView's older arrow-field handlers happen to work —
  don't read them as proof the pattern is safe. The buildgap e2e pins Esc's
  EFFECT (finish wedge count → 0), because balance alone can't tell.
- Anything measuring tile positions on screen must read the pitch off a rendered
  tile, not assume 200 (`scripts/probe.mjs`) — the camera scales the board. SVG
  path data inside a tile stays in its own viewBox units and is unaffected.
- A FITTED world gives the camera NO slack: pan is clamped to zero movement, so
  a drag "does nothing" and a pan test passes/fails vacuously. Zoom in first
  (wheel) before asserting that a drag pans — bit during the build-in-play
  verification.
- WHICH BUTTON pans is the CALLER's policy, not the controller's: play boards pan
  on LEFT **or MIDDLE** drag (left is the map gesture everyone knows and the only
  one a trackpad/touchscreen has); the EDITOR pans on middle-drag / space-drag
  only, because a left drag there belongs to the connect tool (edge dot → edge
  dot) and stealing it makes the board unbuildable.
- The viewports set `user-select: none` OUTRIGHT, not on the `--panning` class.
  Doing it on the class is too late twice: the class only lands once the drag
  passes its slop threshold, and disabling selection does NOT clear a selection
  already in progress — so a drag across the board highlighted its debug labels.
  HUD/menus/activity log sit outside the viewport and stay selectable.
- BACKDROP vs GROUND: anything with recognisable scale must be painted on the
  BOARD element (the camera transforms it, so it pans/zooms with the tiles).
  `#app`'s themed background is the FAR distance only — fixed to the viewport, so
  a tree there would sit still while the board slid past it. Splitting these is
  what made the camera read correctly; the next step is terrain as tile data, see
  `docs/superpowers/specs/2026-07-25-terrain-as-tile-data-design.md`.

## RENDER LAYOUT (the board is a CSS grid — mind what else is in it)
- `.level` is `display:grid`; `<Train>`/car divs are its DIRECT CHILDREN, emitted
  BEFORE the `.level-tile` divs. Anything in there that generates a box is a GRID
  ITEM and eats a 200px cell, shifting every tile after it. `.train-composition`
  did exactly that until 2026-07-25 — /play started at column 2 (2 trains) and
  wrapped a 7th row onto a 6-row map; `/test/curve` drew an L as a diagonal
  staircase. Fix is `display: contents` (NOT `position:absolute`: the units inside
  are absolutely positioned against `.level`, and giving the wrapper a position
  re-anchors every transform `game.ts` writes). Road cars were always fine — they
  are absolutely positioned. `npm run probe` guards this now.
- Debug labels sit INSIDE the rotated unit, so they rotate with it. Counter-rotate
  them: cars do (`rotate(${-car.angle}deg)` in both views), trains do via the
  `--unit-angle` custom property `game.ts` publishes next to the transform. Without
  it a westbound train (~180°) renders its id mirrored and upside down.

## ROLLING STOCK ART (procedural SVG, 2026-07-26)
- Locos, wagons and the engine shed are DRAWN (`utils/trainArt.ts`), not loaded.
  `src/assets/` is gone — the project now ships zero third-party assets (ASSETS.md).
- Sprite size is a THREE-way sync: `UNIT_PX` (`sim/trainDimensions.ts`, what the sim
  spaces couplings by) ↔ the CSS `width/height` in `Train.vue` ↔ `UNIT_H` + the
  viewBox in `trainArt.ts`. `trainArt` imports `UNIT_PX` so the width leg can't drift;
  the other two are by hand.
- Livery is a real `fill` now. The PNGs were recoloured by
  `grayscale/sepia/hue-rotate` filter stacks scoped to `.train-locomotive` ONLY — so
  every wagon in the game rendered WHITE regardless of its train's colour, for years.
  If a colour looks wrong, look for a filter, not a fill.
- Freight body variant = hash of the WAGON ID (`freightVariantFor`), not `getRandom`.
  The old renderer re-rolled it per render: a consist reshuffled itself on reload and
  `npm run shot` output was never comparable. Same rule as terrain scatter — art is a
  pure function of identity, never chance.
- An inline `<svg>` swapped in for an `<img>` has NO intrinsic size, so `height` alone
  no longer implies a width (`.depot-building` states both; they match `DEPOT_W/H`).
- At 26–30px a unit must read its LIVERY first: a near-black hopper load or thin dark
  logs turn the wagon into a featureless bar. Detail tones stay inside a generous
  livery rim. Verify in `/test/rollingstock` (all four freight bodies × 4 liveries).
- e2e asserts on the `.train-locomotive` and `.depot-building` CLASS names
  (`tests/e2e/game.spec.ts`) — keep them on whatever element carries the art.

## TERRAIN (ground as tile data, 2026-07-26)
- `TileCell.terrain?` = grass|forest|water|rock|mountain|urban; absent = grass.
  The third axis of the tile model: `connections`/`road` say what CROSSES a cell,
  terrain says what it IS. Only `canBuildOn` reads it so far (see TERRAIN RULES).
- GRASS DRAWS NOTHING (`tileGroundSvg` returns ""). That is what makes adding
  terrain a no-op for every level authored before it: the themed board shows
  through exactly as it did. Don't "fix" it by painting a grass rect — that would
  cover the theme's backdrop on every tile in the game.
- TERRAIN-ONLY CELLS ARE LEGAL: `{connections: [], terrain: "water"}`. `kindOf`
  → "empty", `validateLevel` skips connection-less cells, and `levelBounds`
  counts them — so a lake defines the world's extents like anything else.
- Patches FUSE by looking at neighbours (`patchPath`): an edge whose neighbour is
  the same kind runs full-bleed, a corner rounds only when BOTH its edges stop.
  The rim/shore (`patchRimPath`) must stroke ONLY the stopping edges — stroking
  the whole outline draws a bright line down every internal join and turns a 2x2
  lake into four visibly tiled ponds. Regression-tested.
- SHORES BULGE OUTWARD ONLY (`edgeBow`, 2026-07-26). The bow was symmetric
  (`(r()*2-1)*EDGE_BOW`), so half of every patch's boundaries curved INWARD and a
  lake came out PINCHED — a star, not a body of water. Now the direction is fixed
  and only the amount varies (`-EDGE_BOW * lerp(EDGE_BOW_MIN,1,r)`), so the
  silhouette is convex while the outline stays irregular. SIGN: the outline is
  wound clockwise, so **negative = outward** (same convention as `SEAM_OVERLAP`).
  Pinned by "bows every shore OUTWARD" + a control-point-outside-the-chord test.
- OUTWARD-ONLY WAS ONLY HALF THE FIX. Bulging every edge left a CUSP at every
  shared corner: each edge bowed off its own chord, so the outline arrived ~24°
  off and left ~24° the other way — a sharp inward V at each tile boundary. You
  could count the tiles down the side of a 3x2 lake, which is the tile grid drawn
  back onto the water. Fixed 2026-07-26 by making each shore a CUBIC whose end
  TANGENTS are chosen rather than implied (`patchSegments`): `dir*(size/3)` along
  the shore + `out*lean` across it, with `dir`/`out` taken from the EDGE INDEX
  (`EDGE_FRAME`), never measured off the jittered chord — that is what lets two
  tiles derive the identical tangent.
- A corner is one of THREE things (`cornerRoles`), and the difference needs the
  DIAGONAL neighbours, not just the four sides (`TerrainNeighbours` carries all
  eight; the diagonals are in the memo key too):
  · both edges stop → real CORNER: the point is pulled INWARD along the tile
    diagonal (`cornerInset`, 14-26u) and the end tangents lean out ~`reach`
    (`CORNER_ROUNDING`), so the turn is a deep sweep, not a softened right
    angle. Needs no cross-tile agreement: only ONE tile ever draws through a
    corner-role point (a same-kind side neighbour would change the role);
    two patches kissing diagonally pull apart into two bodies — deliberate.
  · exactly one stops AND the diagonal differs → mid-shore RUN: push the point
    outward (`cornerPush`) and lean by the lattice's shared slope (`cornerSlope`).
    Both are seeded by the LATTICE POINT, so the two tiles agree on both.
  · else (interior, or an L's reflex corner where the diagonal IS the same kind)
    → leave it on the lattice, flat. Smoothing a reflex corner pushes one arm
    north and the other east and TEARS THE PATCH OPEN — that case is why the
    diagonals are needed at all. All three are unit-tested for agreement.
- Pushing a shared corner outward does NOT by itself remove a cusp — it is a
  translation, and a cusp is a TANGENT discontinuity. Don't reach for a bigger
  bow/jitter to fix a kink; fix the tangents.
- SILHOUETTE ≠ BOUNDING BOX (2026-07-26): outward bows + smooth runs alone still
  left every real corner ON the authored box corner — a 3x2 lake was a rectangle
  with wavy edges. The inward corner pull + big leans relaxed it into a blob;
  the mid-shore push (7-19u) gives long runs their belly. Pinned by area: a lone
  tile's outline covers 0.55-0.85 of its square (`patchOutlinePolygon` + grid
  sampling). An INTERIOR tile's own outline covers only ~92-96% — its jittered
  shared chords cede a strip that the NEIGHBOUR's identical chord covers. That
  is not a hole; don't "fix" it per tile.
- Scatter AND ground marks are clamped INSIDE the patch outline (`place` in
  `buildGround`: walk toward the centroid until `pointInPolygon` passes with a
  margin) — with corners cut deep, the per-kind bands alone would stand trees on
  the ceded grass and lilies on the shore. Unit-tested per kind.
- The rim stroke needs `stroke-linecap="round"`. Each tile strokes only its own
  share of a shore, so the segments ABUT, and two butt caps meeting on one line
  antialias to a dark tick across the shallows at every tile boundary — the same
  defect `SEAM_OVERLAP` fixes for the fill, invisible until the shore stopped
  kinking there. The cap can only spill into the overlap the neighbour covers
  (the clip path is the patch).
- Scatter is DERIVED from `(kind, coord, seed)`, never authored: paint an area,
  the trees follow. Same seed = same trees, or screenshots stop being comparable.
  Tree art is shared with the backdrop (`utils/foliage.ts`) so the world's woods
  and the distance are the same forest.
- ALL scatter is TOP-DOWN (2026-07-27): canopies, roof plans, blob boulders,
  ridges — one projection with the tracks/trains, one NW sun (lit up-left facet,
  drop shadow offset down-right). Nothing grows upward out of its band any more,
  so bands are symmetric and forest runs to [10,90]. Keep every `translate()`
  inside 10..90 — a unit test sweeps all kinds and fails otherwise, and it parses
  EVERY translate as a placement: bake prop-internal offsets (shadows, crowns)
  into the point coords, never nest a `<g transform="translate">` inside a prop.
- Shadow tints per ground: `STONE_SHADOW`/`TOWN_SHADOW` in terrain.ts, green
  default in foliage.ts — a green shadow on grey rock reads as moss.
- Ground UNEVENNESS must be painted in BLOCKS, not lines. Hairline "fissures"
  across a rock patch read at board zoom as stray pen strokes lying on the tile;
  broad low-contrast `shelf()` polygons (±3.5% lightness) read as bedrock. Same
  lesson as the abandoned per-tile tone variation, one scale down.
- Rock/mountain scatter tones sit CLOSE together (light 68-75 vs dark 44-51 on a
  56 ground) — and that means RELATIVE to the ground, so a tone shared between
  two kinds has to be a parameter. `pebble`'s fixed 67-74 was ~14 steps over
  rock's L=56 (gravel) but ~30 over mountain's L=42: bright flecks on dark slate,
  reading as litter. It takes a `light` base now (rock 67, mountain 53).
  A near-white face against a near-black one turns every boulder into
  a paper cutout. Snow lives ON the ridge polygon's own crest stations and
  carries its own end-taper (`midProf` × sin) — cut off square it leaves a hard
  white chevron across the ridge. On the tan urban ground a flat roof must
  change TEMPERATURE (concrete grey), not just tone: warm at any lightness
  either vanishes into the ground or reads as blank paper.
- `<TileGround>` is a SIBLING of `<Tile>` inside `.level-tile`, not a layer in it:
  ground exists on cells with nothing built on them. z-index 0 → under road (1)
  and rails (2), so scenery never covers track.

## EDITING THE WORLD WHILE IT RUNS (P0, 2026-07-26)
- THE SIM READS THE LEVEL LIVE. `traverse`, `resolveExitPort`, `routeToNextSignal`
  and `isBoundary` index `level[…]` on EVERY call, against the object handed to
  `createSimulation` — never copied. Track laid mid-run routes on the next tick
  with no rebuild. Don't "optimise" this into a snapshot; `liveEdit.spec.ts` guards it.
- Signals are derived per call from `level[id].signals`, NOT snapshotted.
  `config.signalTiles` is an ADDITIVE override (unioned), for tests that mark
  boundaries on cells carrying no `signals` of their own.
- TRAP: a tile that just became a junction has no switch arm, and
  `connectionsToExitPort` returns **null** for a multi-partner entry with no arm →
  the train STOPS DEAD on the tile you just built. `game.applyEdits` merges fresh
  `initialSwitches` arms in (existing player choices win).
- Edits touching an OCCUPIED or RESERVED tile are rejected (`game.canEdit`). A
  train's `path[headIndex]` caches that tile's exit port and reservations cache
  ids; editing under it makes both stale. Same line of code as the game rule
  "you can't rip up track under a moving train".
- `levelVersion` (a ref bumped per edit) is how the VIEW learns. `game` holds the
  RAW level (the sim indexes it thousands of times a tick — no Proxy in that path)
  while the view holds a reactive proxy of the same target, so raw writes notify
  nobody. `PlayView.bounds`/`gridCells` read the counter.
- Additive edits only so far. Removal is deferred with clearing costs.
- TEST TRAP: a train arriving at a depot whose colour does NOT match BOUNCES BACK
  OUT. In a test that reads like "the new track was ignored". Pass `depotColors`.

## COLOUR ASSIGNMENT = SOLVABILITY (2026-07-26)
- A PARKED TRAIN OCCUPIES ITS DEPOT TILE FOREVER. So "two trains, one matching
  depot" is not a slow level, it is an UNSOLVABLE one — the second train waits
  at the door for good. Every rule below follows from that one fact.
- Depot colours must be DISTINCT while the palette lasts (`Colors` has 5). Random
  per depot let two depots share a colour, and the sim parks a train in the first
  depot of its colour it reaches — so both trains chase the same tile.
- Train homes are a MAXIMUM BIPARTITE MATCHING (`matchHomeDepots`, Kuhn's), not
  greedy first-fit. Greedy cannot find a DERANGEMENT, and the most natural level
  there is — n trains each starting in their own depot — needs one. Greedy swaps
  the first two and strands the last on its own start, which then shares a depot.
  Symptom: the last train runs, then stops dead somewhere and never delivers.
- `/test/lakevalley` is the regression case (3 trains, 3 depots, each in its own).

## ECONOMY + DISPATCH (Tycoon phase 1, 2026-07-26)
- `sim/economy.ts` = pure ledger (`createEconomy`) + fare book (`createFareBook`)
  beside `objectives.ts`: no Vue, no DOM, deterministic. Ledger amounts are
  SIGNED (+earn/−spend) so the entry log sums to the balance and needs no second
  field. `spend` returns null when refused — treat null as "it did not happen".
- `TrainState` gained `"waiting"`, released by `sim.dispatch(id)`. It is gated by
  `SimConfig.waitForDispatch` and DEFAULTS OFF — every level, scenario and unit
  test predates it and assumes a train departs on tick 1. The ONLY thing that
  turns it on is `ModeControls.dispatch` (Tycoon). Do not flip the default.
- A waiting train OCCUPIES its depot tile but RESERVES NOTHING ahead. That falls
  out for free: `releaseStaleReservations` only adds the route-to-next-signal for
  `state === "running"`. Pinned by `dispatch.spec.ts`.
- TRAP (bit once): `renderTrains` computed `docked = trainState !== "running"`.
  Adding a 4th state silently made a WAITING train "docked" and eligible for the
  shed-hiding test. Enumerate the states you mean (`parking || parked`), never
  negate against a union you are about to extend.
- Fares decay while the train WAITS, not only in transit — that is the whole
  mechanic (Train Valley M7). Ticked from `game.ts frame()` only while
  `objective.phase === "playing"`, so nothing burns behind the Ready screen.
  `settle()` is idempotent, so a duplicated `arrived` event cannot pay twice.
- `Counters.balance/earned/spent` are OPTIONAL, like `spawned`/`active`: the mode
  specs build `Counters` fixtures BY HAND, and required fields break them.
  Observation carries the ledger's ABSOLUTES (not deltas) — one source of truth.
- Adding a field to `ModeControls`/`HudDescriptor` breaks the exhaustive
  `expect(mode.controls).toEqual({…})` in all five mode specs. Expected; update
  them all rather than loosening the assertion — it is what keeps a new mode from
  quietly inheriting a control it should not have.
- Fare pins are ABSOLUTELY POSITIONED direct children of `.level`, same rule as
  the road cars (see RENDER LAYOUT — a box-generating direct child becomes a grid
  ITEM and eats a tile). Positions are captured in `renderTrains` from the loco it
  already placed; a second sampling pass would be the same maths twice a frame.
  They live in `components/FarePin.vue` (markup AND scoped styles) because
  PlayView and TestStage both draw them and used to carry byte-identical copies.
- The depot art is z-10 and a loco is z-4, so a train sitting in its shed is
  INVISIBLE. A waiting train therefore reads as an empty station — the fare pin
  IS the affordance, which is also how Train Valley presents it.
- …which is why the pin's own z-index is 30, not 8. Board art it can land on:
  cars 6/7, trains 10, DEPOT ART 10, signals 14, crossing booms 15, switch boxes
  20, depot colour dot 1000. At z-8 a pin over a depot whose building sits above
  the loco (one opening Bottom, e.g. `heldby` 1,0) was drawn UNDER the roof and
  `elementFromPoint` at its centre returned the depot SVG — so the mode's only
  dispatch affordance was both invisible and DEAD there, silently: the click
  landed on the depot and the train stayed `waiting`. Measured 2026-07-26.
- A pin has three states, and the third is `held`: `sim.trainBlock(id)` mapped to
  `{reason, by, color}` in `updateFareBadges`. It rings itself in the BLOCKER's
  livery and prints that train's id, because our interlocking reserves the whole
  route to the next signal — a train can refuse to leave a platform over track it
  is nowhere near, which without an explanation reads as a broken button (Train
  Valley never holds a train, so players arrive expecting it to just go). A
  WAITING train is deliberately not "held": its pin is already the Send button.
  Demo: `/test/heldby`; sim contract pinned by `tests/unit/sim/heldBy.spec.ts`.
- Rebuild the hold record every frame and Vue re-patches the pin 60×/s for a
  train that is standing still — compare before assigning (`sameHold`).
- A HELD train's `velocity` keeps braking down for a second or two AFTER its
  position is already clamped at the stop line (`advance` caps the move, the
  ramp does not snap). Assert POSITION (`trainProgress === 1`), never
  `velocity === 0`, when testing "it stopped".
- RETRY is a first-class Tycoon flow ("bank more next run"), so `reset()` is hit
  routinely here — it must hand back WAITING trains, the starting capital and
  un-settled fares. Verified end to end (win → reset → win again); the stale
  `game.sim` handle it exposed is in VERIFY.
- NOT built, deliberately (`docs/superpowers/specs/2026-07-25-train-valley-mode-design.md`):
  reversing (§5.2), crashes (§2.2 G7), production chains (§5.1), removal/
  bulldozing (deferred with clearing costs, phase 3).
- The DEFAULT board needs the player to throw switches: left alone, both trains
  lap and bounce off wrong-coloured depots forever. That is PRE-EXISTING and
  identical in Puzzle (measured: both modes 0 delivered / 3 mismatches at 60s) —
  don't read it as a Tycoon routing bug when a headless run never completes.

## BUILD IN PLAY (Tycoon phase 2, 2026-07-26)
- `game.buildRoute(steps)` = canAfford gate → `applyEdits` → `spend`, IN THAT
  ORDER: a refused edit (a train moved onto a route tile after the preview)
  spends NOTHING, and nothing runs between gate and spend (one sync call), so
  the spend can't fail after the lay landed. Pinned by `buildRoute.spec.ts`.
- Only NEW pieces are priced (`samePair` filter, `newBuildSteps`): the gesture
  re-lays the anchor straight of the open end it grows from, and closing a gap
  into existing track plans straight through the far tile — both duplicates,
  and charging them prices a 2-tile gap at 5. The SAME filter feeds the preview
  tag (`buildCostOf`) and the `tilesBuilt` counter (Counters/Observation, for a
  "buy ≥ N pieces" star), so shown = charged = counted.
  `TRACK_COST_PER_TILE` (=1000, Train Valley's rate) lives in `sim/economy.ts`.
- PlayView's UI is ONE toggle (gated by `controls.build`; Sandbox has it too
  and builds FREE — no economy ⇒ cost 0, no tag). The zone overlay is z-5:
  above rails, BELOW cars (6) and fare pins (8), so a waiting train stays
  dispatchable mid-build. While armed, LEFT drag belongs to drawing (the
  editor's policy — see WHICH BUTTON above); pan = middle-drag / space+left,
  and left-pan returns on disarm. Zones carry `data-coord`/`data-port` for e2e.
- The controller advances its head AFTER `lay()` returns, so a refusal can't be
  cleaned up inside `lay` — PlayView sets a flag and aborts once the controller
  call returns (`settleBuildGesture`). ABANDON = `dropAnchors(); finishRoute();`
  IN THAT ORDER: with the head cleared, finish cannot lay the pending frontier,
  only forget it. Reversed, it lays (and charges for) a terminus straight no
  cost tag ever showed. Esc = FINISH (lays the terminus); disarm/refusal =
  ABANDON. The Esc terminus is free ONLY when it duplicates the far tile's rail,
  i.e. the route closes into COLLINEAR track (buildgap's flow). Closing into the
  SIDE of an existing line lays a NEW perpendicular straight there — a charged
  $1,000 the cost tag never showed (measured live on lakevalley: 1000 → 0 on
  Esc). Known gap, deliberately documented rather than redesigned.
- Anchor AND terminus are always STRAIGHTS through the pressed edge
  (`straightOut`), so branching off the SIDE of a line buys a CROSSING, not a
  turnout — {N,S} laid across {W,E} has no shared connection, and no train can
  ever enter the branch (verified live: lakevalley corner-cut is unreachable
  rail). Turnouts only form where a planned route passes THROUGH an existing
  tile while turning. Growing from OPEN ENDS is the gesture's honest use.
- `game.reset()` restores the LEVEL from a pristine deep-copy snapshot: Retry
  hands back the starting capital, and keeping the bought track would let every
  Retry re-spend the same money. Built-junction switch entries are pruned with
  the same merge `applyEdits` uses; player arms on surviving junctions persist
  (pre-existing reset behaviour, unchanged).
- A DELIBERATELY-INCOMPLETE board is now authorable: `TestScenario.
  allowIncomplete` makes `testScenarios.spec.ts` skip exactly `dangling-track`
  + `route-disconnected` + `isolated-depot` for that scenario (everything else
  still applies; the third joined 2026-07-26 when `lakevalley-open` severed a
  station outright). `/test/buildgap` is the minimal example — playable at
  `/#/play?mode=tycoon&board=buildgap` (the /test stage shows the board; the
  build UI lives in PlayView).
- A zone CLICK lays the planned route only UP TO the clicked edge — one pair
  per tile, NO terminus-straight pair at the clicked tile (that lands only via
  Esc-finish on the pending frontier). So restoring an authored T-junction
  through the gesture prices it PAIR BY PAIR: lakevalley-open's 2,5 is three
  gestures' worth (ring drag [T,R] + two 1-piece links [R,B], [T,B]) = 3 of
  the rebuild's 7 pieces.

## LAKEVALLEY-OPEN (the Train Valley level, 2026-07-26)
- `lakevalley-open` = `structuredClone(lakevalley)` minus the ring's south run
  (`LAKEVALLEY_SOUTH_RUN`), so the reference board and the opening state can't
  drift (`lakevalleyOpen.spec.ts` pins the derivation). Never share cell/train
  refs between scenarios — both get handed to createGame and edited in play.
- Tycoon tuning is PER BOARD: `tuningFor(levelId)` (`modes/tycoon.ts`) keys on
  the levelId TAIL — PlayView passes `board:<id>`, TestStage `test:<id>`, so
  both routes into a board get the same game. lakevalley-open: $15,000 budget,
  decay 5/s, stars Payday $1,500 / Under budget $6,000 / Rail baron 7 pieces
  (lean+baron mutually exclusive by arithmetic — TV1's own goal design). Every
  other board keeps the generic $3,000/20/s/payday-hands-off-colours.
- AN OPENING LEVEL WANTS A LOOSE BUDGET, and steers with GOALS instead. TV1
  hands you 100,000$ against a ~10,000$ ring. Ours was $8,000 vs a $7,000
  rebuild (one spare piece) and that was too tight, because we have neither of
  TV's safety nets: no bulldoze to refund a misdrag, and no bankruptcy state to
  explain the dead end — a fumbled drag just soft-locks into Retry silently.
  Discipline still gets rewarded because "Under budget" measures SPEND, which is
  independent of what you were given.
- PAYDAY MUST BE RE-MEASURED WHENEVER THE DECAY DIAL MOVES — it is the only goal
  denominated in money that time eats. Same scripted prompt run banked $1,188 at
  10/s and $1,763 at 5/s (max $2,200, all-floor $550), so a target tuned for one
  dial is nearly free at the other. Measure with the lakevalley-open e2e (log
  `end.counters.earned`), then set ~85% of it. The e2e now asserts Payday earned,
  so a mis-tune fails loudly instead of quietly gifting a star.
- THE RING IS THE PASSING LOOP, proved not vibed: the seeded assignment is a
  3-cycle, and a 3-cycle of depots over a TREE of single track deadlocks in
  every dispatch order (B<Y<R<B contradiction at the 1,2–2,2 needle). Don't
  "simplify" the board by shrinking the ring; closing it IS the level.
- SIM ROUTING FACTS the goals rest on (measured in scripted playtests):
  · Trains route BY THE ARMS at reservation time — there is no destination
    pathfinding. A flipped arm reroutes every later reservation through it.
  · A departure with NO signal on its arm-route reserves the WHOLE route to
    its end — a train cannot even leave its depot while that route ends on an
    occupied tile. The 4,2 signal is the board's only mid-track waiting bay.
  · A train STOPPED at a signal keeps ~a consist-length of stale REAR
    reservations (3-unit train at 4,2 pins 5,2+6,2 forever). That kills the
    north-entry lean line (every lap crosses 6,2) and is exactly why the
    east-entry lean line works: yellow's 2-unit consist releases 6,2.
- Verified end to end in a real browser (playtest-lakevalley-open.mjs): full
  rebuild won in ~40 sim-s banking $1,188 (Payday+Baron); lean rebuild won in
  ~75 sim-s banking $692 (Under budget only — serialization burns fares). The
  e2e ("tycoon: lakevalley-open") drives the full loop through the UI.

## TERRAIN RULES
- `canBuildOn(cell)` (`tiles/terrain.ts`) is the ONE predicate: shared by
  `validateLevel` (issue `blocked-terrain`), the editor's `routeOpts.passable`,
  and anything later. Water + rock + mountain block; forest + town don't (you
  fell trees). A bridge (water) and a tunnel (mountain) will be EXCEPTIONS here,
  not second rules.
- Editor: `commit()` tests `isBlankCell`, not "no connections/signals/road" — a
  terrain-only cell is REAL and the old test deleted lake tiles as they were painted.
  Painting grass back over a bare cell removes it, so repainting can't grow bounds.

## INVARIANTS
- Tiles are DATA, single source of truth. Rails: `connections: PortPair[]`. Roads:
  `road: Lane[]` = `{from,to[],index,kind?}` DIRECTED (undirected pairs can't do
  one-way/turn rules — never regress). Sim + renderer import same `src/tiles/*`.
- Renderer matches the SIM's lane indexing, not vice versa.
- Cyan/amber debug overlay = where cars actually drive (`game.ts couplerOffset`).
  Lane-graph overlay code must stay identical to it. Cyan ≠ painted dash/gore at a
  seam ⇒ the PAINT is the bug. Overlay is the diagnostic for all road geometry.

## CURVES — rail ≠ road (the #1 trap)
- RAIL curve = quadratic Bézier through TILE CENTRE (`Q centre`). `geometry.ts
  railPathsFor`, `pathGeometry.ts segmentPathD`.
- ROAD turn = 90° CIRCULAR ARC around the WRAPPED TILE CORNER, r=size/2, tangent
  at port edges (`A r r 0 0 sweep`). `roadSegmentPathD`, `turnCornerPoint` (=pa+pb−c).
  Centre-quad bulged into the junction box — fixed bug. Don't merge road turn → rail quad.
- ARC LENGTH not uniform: straight=size, rail curve≈0.8116×size (`curveUnitLength`),
  road turn=(π/2)(size/2)≈0.785×size (`roadSegmentLength`). Space coupled units by
  TRUE arc length (`segmentLength`/`roadSegmentLength` + `sampleAtArc`), else they
  overlap on curves. `scaleX` sprite-foreshorten was REVERTED (user hated it) —
  wrong cause. Kept: chord render (`UnitChord{front,rear}`) + `BOGIE_INSET_FRAC=0.2`.
- Constant-width road curve: offset the SAMPLED centreline ⟂ (`laneOffsetPointAt`),
  never the Bézier control point (pinches apex).
- Turn-LANE path = corner FILLET of the two lane lines (`pathGeometry.ts
  turnLaneFrame`/`turnLanePointAt`): straight-in, max arc tangent to both, straight-
  out. NOT the arc lerp(offEntry,offExit)-pushed (unequal offsets kink at seam =
  old "strange bend" on mixed-width junctions). =concentric arc when offsets equal.

## JUNCTIONS
- AUTHORING a 4-way cross: every arm must list every OTHER arm in its `to`
  (`demoworld.ts fourWayCross`). `twoWay(L,R) + twoWay(T,B)` looks identical on
  the tile but is a FLYOVER — every car goes straight through, nobody can turn,
  and the junction sync cannot rescue it because it only re-distributes exits a
  lane ALREADY reaches. Assert the behaviour (`demoworld.spec.ts` counts turns vs
  straights at the junctions), not the authoring.
- Lanes DERIVED by `deriveJunctionLanes` (`editOps.ts`), receiving-capacity rule:
  never more turning lanes than the dest has receiving lanes; every movement lane-
  true (no crossing arcs). idx0=kerb, high=inner. R-block kerb side, L-block inner
  side, S middle. N≥3 ⇒ inner = dedicated LEFT pocket. Dual turn shares straight
  onto the lane nearest the straight block. 1L→nL = nearest-lane landings, no fan-
  out. Capacities PER vehicle class (skip bus lanes for cars). Full table:
  `docs/superpowers/specs/2026-06-12-junction-lane-capacity-design.md`.
- ONE-WAY junction turn-offs paint LANE-ANCHORED slip CHANNELS, not the full-box
  arm-width fan (`Tile.vue oneWayTurnChannel`, gated by the `isOneWayJunction`
  getter = no port is both entry AND exit). The channel covers ONLY the lanes that
  take the movement (`road.filter l.from===from && exits.includes(to)`), swept on the
  real car glide path: `laneRibbonPathD` between the turning-lane GROUP's two edge
  offsets (entry band `positioningBandAt` → `roadTurnExitOffsetPx` landing), plus ONE
  kerb edge on the bend's tight side. `laneMarkings:[]` (the channel's solid kerb IS
  the guide). The straight corridor still paints full width (it's `isStraight`, the
  one-way highway branch). Box corners no lane uses become grass — the realistic
  "only where there's a lane" look the user asked for. TWO-WAY junctions are
  UNTOUCHED: the gate returns early ONLY for one-way, so they keep the box-filling
  `roadCurvePolygonPathTapered` ribbon (verified pixel-identical: crossturns3lane
  before==after bar moving cars). ARM SIZING HAS TWO DIFFERENT RULES — don't apply
  one to both (learned the hard way 2026-07-25):
  · TURN arm = the lanes that TAKE the turn. The slip channel is lane-anchored, so a
    1-lane turn into a 3-lane arm NECKS at the seam and paints tarmac no car drives.
    Probe: `road.filter(l=>l.to.includes(exit)).length` vs
    `roadLaneCountAt(armCoord,port)`; every `roadTurnExitOffsetPx` landing must sit
    on an arm lane centre ((n/2−0.5−i)·W).
  · STRAIGHT arm = the junction's THROUGH CORRIDOR (painted to the widest arm), NOT
    the count of straight movements. The corridor is the one-way highway branch and
    paints full width, so a narrower straight arm tapers it and drops a hatched
    closure gore IMMEDIATELY after the junction — worse than the unused lane it was
    meant to remove. `turnlanes` is the worked example: 3-lane approach → W/E arms 1
    lane each (1 lane turns each way), N arm stays 3 even though only 2 lanes go
    straight. Sizing N to 2 "by the rule" produced exactly that gore.
- Turn-guide marking SOLID vs dashed (`Tile.vue junctionTurnGuides`): now reached for
  TWO-WAY junctions only (one-way junctions return the slip channel first). Two-way
  guides stay all-dashed. The `oneWayJunction = this.isOneWayJunction` / `marking.solid`
  dedicated-lane path is retained (single-source-of-truth getter) but unreached for
  one-way in practice — the channel kerb replaced it. crossturns3lane/bigjunction
  (two-way) → 0 solid, all dashed, as before.
- Turn-guide SHIFT (`junctionTurnGuides`): the guide traces the lane's divider on
  the THROUGH-LANE side, NOT the outer kerb (which is already the solid road-edge).
  Shift ½ lane AWAY from the bend's outer kerb: right turn (kerb-most lane, kerb on
  right) → −edge; left turn (inner lane, median on left) → +edge. Wrong sign put a
  right-turn dash on the kerb edge (looked like a stray line) instead of from the
  left of the kerb lane to the top of the exit arm.
- Junctions NEVER lane-count-mismatch. `laneCountAt` over-counts a junction port ⇒
  naive seam check paints junctions+adjacent curves RED (recurring bug). Guard:
  `lanes.ts seamMismatch` + `game.ts roadIsJunctionAt`. Only simple curves must
  preserve lane count across a seam.
- Arm flare is REALISTIC not a defect: junction sizes turn ribbon to widest arm
  (`max(laneCountAt(a),laneCountAt(b),2)`); narrow arm into wide mouth = flare.
  Don't "fix" blind — true per-arm width = `roadCurvePolygonPath` refactor, user-watched.
- Junction arm = the adjoining road's EXACT width (`junctionArmPaintTotal` returns
  `neighbourCrossing` = `laneCountAt`, NO min-2 floor). `laneCountAt`=entering+exiting,
  so a TWO-WAY road is always ≥2 (floor never mattered) but a ONE-WAY 1L road is 1 —
  and it's drawn 1 wide (kerb-anchored), so the arm must be 1 too. The old `max(.,2)`
  floor painted a 1L one-way turn-off arm 2 wide (wider than the 1-lane road it meets).
  ONLY one-way 1L exits change; normal/two-way junctions untouched (test `junctionSeam`
  iterates every scenario). Don't reintroduce the floor — it pinches nothing real.
- Box crossing gated by conflict-matrix arbiter (`roadArbiter.ts`, `roadJunction.ts`);
  `conflictKey` lane-indexed ⇒ parallel lanes cross independently.
- STACKED junctions (a junction directly above another, no road tile between —
  `turnfan`, the user's level): `seamPositioningBand` junction↔junction = MAX, NOT
  min. A junction's exit-port `laneCountAt` counts only the straight-through
  movements (narrower than its arm), so min squeezed the upper junction's turn
  ENTRY inward (entered at the kerb edge, x58 instead of the lane x72 — looked
  "broken" for 3L→1L/2L turns, fine for 3L→3L by coincidence). MAX makes both
  stacked sides adopt the wider approach band ⇒ turn entries land on their real
  lanes AND the through-lanes stay continuous across the seam. Cyan==car (shared
  `positioningBandAt`). Isolated junctions (road neighbours) unaffected.
  PAINT must match: `junctionArmPaintTotal` junction↔junction = MAX too (it was min)
  — else the corner-fillet kerb (`roadCurveKerbEdgeTapered`, width = arm paint/2)
  paints half a lane narrow and the SOLID kerb lands on the lane CENTRE while the
  lanes sit on the wider band. Keep paint (`junctionArmPaintTotal`) and positioning
  (`seamPositioningBand`) in lockstep for stacked junctions.

## ROADS
- `LANE_WIDTH_FRAC=0.14` (`laneOffset.ts`). Same offset fns feed cars+paint+markings
  +overlay — keep lockstep.
- Bidirectional: lanes anchor to YELLOW centreline; kerb lane drops; gore
  `laneDropGore` (point upstream, widen down).
- NEVER infer a lateral DIRECTION from the sign of an offset. `oneWayMergeArrowPath`
  used `Math.sign(laneOff) || 1` ("lean toward the centreline"); on a 3-wide run the
  2→1 drop's closing lane sits at EXACTLY 0, so sign()=0, the fallback picked the
  wrong side and the merge arrows pointed AWAY from the survivors (visibly "up" on an
  eastbound road) — while the 3→2 drop on the same road looked right, which is why it
  survived. The direction is now a REQUIRED `mergeDir` argument (+1 = kerb side for a
  kerb-anchored one-way, which sheds its centre lane). Same class of bug as the gore
  hatch: geometry that reads its own side out of a magnitude breaks at zero.
- ONE gore primitive for both road types: `laneClosureGore(entry,exit,size,
  {outerEntry,innerEntry,outerExit,innerExit})` — explicit px bounds, `outer` =
  closing side, `inner` = survivor side. `laneDropGore` is a thin wrapper (kerb
  anchor); one-way passes NEGATIVE offsets (centre anchor). The hatch side is
  DERIVED (`sign(inner−outer)` at the wide end), so it can't be passed backwards —
  the separate `oneWayClosingGore` had no test and shipped reversed once. Only the
  ANCHOR forks; the geometry never does.
- `laneSeamOffsetPx` is BIDIRECTIONAL-ONLY (min-seam clamp). Its `centred`
  band-substitution branch was one-way's old model — dead since the run-max kerb
  anchor, removed 2026-07-25 with its 4 tests. One-way never seam-adjusts:
  `oneWayLaneOffsetPx` is run-constant.
- One-way: no centreline; KERB-ANCHOR (index 0 = kerb, +n right-of-travel) to run's
  widest count (`oneWayRunMaxAt`, `game.roadOneWayRunMax`) = motorway drop; CENTRE
  (left/−n) lane(s) end w/ hatched island (Sperrfläche)+merge arrows on −n. lane i
  offset=(R/2−0.5−i)·W (= `laneOffsetConstPx` form — MATCHES editor/sim/turns/two-way).
  SIM UNCHANGED (`road.ts desiredLane` merges highest idx down = drops the centre lane;
  the sim is pure index-space, the RENDER defines which physical side an index sits).
  Renderer-only (`oneWayLaneOffsetPx` + `Tile.vue` one-way surface/markings/overlay/gore
  + `oneWayMergeArrowPath` sign-aware lean). Centred symmetric squeeze = WRONG, abandoned.
- index0 = kerb is the ONE canon for ALL lanes (`lanes.ts:31`, `editOps.ts:222`,
  `kerbMostLane`=min idx). The overlay straight branch calls the SAME
  `oneWayLaneOffsetPx` as the car (`Tile.vue` ~883) — never re-derive the formula, or
  cyan drifts from where cars drive.
- FIXED 2026-06-15 (one-way↔canon unify): one-way lanes used to count index0=LEFT while
  everything else counts index0=KERB → at a one-way junction a lane's straight & turn
  arrows split to opposite sides, and overtake/keep-right read the wrong physical side.
  Flipped `oneWayLaneOffsetPx` to index0=kerb (render-only, no sim change). Now
  left-lane→left, mid→straight, right-lane→right like a normal junction; lane-drop island
  moved to the centre side (cosmetic, more realistic = median lane ends). Verified on
  `/test/turnfan` (junctions: L=west,M=straight,R=east+straight, arrows lane-aligned),
  `/test/roadonewaylanes` (drop coherent), `/test/crossturns3lane` (two-way, unchanged);
  1327 unit tests green incl. keep-right overtake.
- JUNCTION SEAM = a lane-index DISCONTINUITY. `car.laneIndex` is ONE value per
  vehicle, but crossing out of a junction reassigns it in a single step (the exit
  arm numbers its lanes independently). The tail is still on the approach segment
  in its old lane, so anything deriving a lane from the car alone teleports the
  body a full lane sideways on that tick (measured: lanePos 1.00→0.00 while still
  on the tile being left; `sample()` feeds the renderer, so it was VISIBLE as the
  rear flicking across the road). `Car.lanePivot` + `CarSample.pathIndex` pin the
  far-side lane for body points behind the seam; `lanePosAt` honours it.
  NOT yet applied to the integer lane identity the following/conflict gates read —
  doing so is more truthful and fixes more, but un-hides collisions those gates
  never handled (overtakeloop clean → 0.09 overlap). See issue #56.
- Lane-change gap acceptance is evaluated on the CURRENT tile at commit time only.
  A long vehicle crossing a seam mid-change never re-checks against the traffic it
  arrives beside — the open half of #56. Pausing mid-change is NOT the fix: a
  vehicle astride the line overlaps BOTH lanes and measures worse.
- Lane switch (G): `Car.laneIndex` is FLOAT (lateral pos); round()=occupied lane;
  eases to int `targetLane` on accepted gap; ending lane merges before taper (sim
  owns lateral motion, render taper gone).
- Approach lane discipline (`road.ts desiredLane` branch F): among the lanes that
  permit the upcoming turn (`lanesAllowingExitFor`), pick by `turnKind` — LEFT→inner
  (max idx), RIGHT/STRAIGHT→kerb (min idx). Works for both dedicated turn pockets
  (`allow` already a subset) AND unrestricted crosses (every lane permits → side is
  pure discipline). Test: `/test/lane-discipline`, `laneDiscipline.spec.ts`.
- Keep-right (`desiredLane` fallthrough): ease to kerb-most usable lane, but ONLY
  after `Car.tilesSinceJunction >= KEEP_RIGHT_AFTER_TILES` (=3) and `pendingExitLane
  == null`. `tilesSinceJunction` resets to 0 on crossing OUT of a junction, +1 per
  plain-tile advance (spawn=0). The delay is LOAD-BEARING: a blanket always-on kerb
  pull RE-CREATES the post-junction "dip to kerb and back" (overtakeloop) and breaks
  the 1→3 left-turn fan-out (left-turner must hold inner across its short exit arm) —
  3 sits above those short arms (junction→far tile = 2). Plus F kerb-sorts
  straight/right on APPROACH, `junctionExitLane` kerb-aligns straight exits, overtake
  returns to kerb. Test: keep-right on an open stretch in `laneDiscipline.spec.ts`.
- Vehicles are data (`vehicleSpec`): car/rigid truck/articulated semi (2 chords).
  Long bodies use full-occupancy sampling (trailer straddling a junction blocks).

## VERIFY
- `npm run build` (vue-tsc+vite) = fastest gate; `npm run test:unit` = math. Keep green.
- `npm run probe` = RENDER-level audit of every registry scenario (75 today) in a real browser
  (`scripts/probe.mjs`): every tile in the grid cell its coord names, no red
  mismatch paint, no console errors, every merge arrow forward + leaning to the
  survivors. Sits between unit tests (sim behaviour) and `shot` (eyeball). Run it
  after ANY renderer/layout change — it catches what a screenshot won't, across
  maps nobody opens. Ids come from walking the picker, so new scenarios are covered free.
- `npm run shot` LEAKED ITS DEV SERVER on Windows until 2026-07-26: `shell:true`
  means the child is cmd.exe, and `server.kill()` took only the wrapper, leaving
  vite holding :5181. `waitForServer` then accepted that orphan's 200 on the next
  run — so shots came out of WHATEVER CHECKOUT started it (found one a day old,
  from a different worktree, silently photographing scenarios that did not exist
  here: `window.__game` never appears and the run dies at the 30s waitForFunction
  with no hint why). Now `taskkill /T` on exit plus a pre-flight refusal if
  anything already answers on the port. If a shot ever times out on `__game`,
  suspect a stale server on the port before suspecting your change.
- `npm run shot -- <id> --send` clicks every fare pin after load. Tycoon boards
  open with every train WAITING, so a plain shot of one is a still life; states
  that only exist once trains roll (a pin held by another train's block) need it,
  plus a `--wait` long enough to reach them (~3s on a 3×3 board) and short enough
  that the runs have not finished.
- `npm run shot` runs with DEBUG ON, and the debug reservation tint
  (`.tile-status--free`, an OPAQUE green) covers everything under it — ground art,
  terrain, depot art. A terrain change verified with a default shot looks like it
  did nothing. Use `--no-debug` to judge anything painted below the rails.
- `tests/unit/sim/roadScenarioSweep.spec.ts` = BEHAVIOURAL sweep of every road
  scenario (iterates `SCENARIOS`): populates, flows, never stands still, bodies
  never clip. Flow is measured as tile CROSSINGS — despawn counts call a closed
  circuit (`carcircle`, `overtakeloop`) gridlocked when its cars are lapping fine.
  `KNOWN_OVERLAP` there pins known defects to their measured number: read it before
  assuming a bus overlap is new.
- LIVE-MODEL PROBE (fastest visual-bug loop, no screenshot needed): `preview_start`
  the `traingame` config in `.claude/launch.json` (dev server :5173), navigate to
  `#/test/<id>`, then run JS against `window.__game`. Works with the browser pane
  HIDDEN — only pixel screenshots need it displayed. `__game` exposes the real road
  API: `roadAt(coord)` (derived lanes), `roadLaneCountAt(coord,port)`,
  `roadOneWayRunMax`, `roadTurnExitOffsetPx(coord,entry,exit,lane,cls)` (where a
  turner LANDS), `roadIsJunctionAt`. Ports are the numeric `Position` enum
  (Top=0,Right=1,Bottom=2,Left=3,Center=4) — passing strings silently returns
  0/null. This gives EXACT numbers (lane offsets, landings, arm widths) where a
  screenshot only gives an impression; edit → HMR → re-query is seconds. Use it to
  FIND/diagnose; use `npm run shot` before/after to PROVE the paint changed.
- ANYTHING `createGame` HANDS OUT THAT `reset()` REBUILDS MUST BE A GETTER.
  `reset()` → `buildSims()` REPLACES `sim`/`roadSim`, so the `return { sim, … }`
  shorthand froze the object that existed at construction: after a Retry the
  handle answered from the DEAD sim while the game ran a new one. It fails
  silently — nothing in `src/` reads `game.sim`, only the e2e specs and the
  `window.__game` probe, so you get WRONG NUMBERS, never an error (measured:
  handle said `parking` while the live sim had the train `waiting`). Fixed
  2026-07-26 (`get sim()`, matching `get signalTiles()`); pinned by
  `tests/unit/gameReset.spec.ts`. Never re-add a bare `sim,`; when a probe
  straddles a reset, cross-check the handle against a value the closure owns
  (`fareBadges`) — disagreement means you are holding a stale handle again.
- The tab must be VISIBLE or rAF is paused and `renderTrains` never runs — so
  `fareBadges`/`roadCars` stay EMPTY and the board looks broken when it is not.
  A hidden pane still answers static queries (see the rAF/hidden-tab note below).
  For behaviour across a reset, drive Playwright directly (`node_modules/
  playwright/index.mjs`) rather than the hidden preview pane.
- BROWSERS: run `npm run browsers` (NOT `npx playwright install`). `.npmrc` sets
  `ignore-scripts` so nothing is auto-downloaded, and on this machine
  `playwright install` HANGS: it fetches the 149MB zip in ~4s, logs "extracting
  archive", then stalls forever in its out-of-process extractor, leaving a half-
  written dir (chrome.dll written, chrome.exe missing) + a held `__dirlock` that
  makes every retry hang too. `scripts/install-browsers.mjs` downloads + extracts
  with the platform unzip (~2s) and writes the INSTALLATION_COMPLETE marker itself.
  Needs THREE builds, not one: chromium, chromium_headless_shell (what a headless
  `chromium.launch()` actually runs) and winldd (chromium won't start without it) —
  discovering them one launch-error at a time is the slow path. Diagnose a stall
  with `DEBUG=pw:install`; kill the node processes and delete `__dirlock` before retrying.
- SHOT VIEWPORT: `shoot.mjs` grows the viewport to `scrollWidth/Height` before
  shooting. A screenshot clip cannot reach outside the viewport, so a tall map (8
  rows × 200px vs a 1200px viewport) was silently cropped — and the cropped part is
  where cars spawn, so the shot also looked suspiciously empty. If a scenario looks
  half-missing or car-free, suspect the viewport before the sim.
- ADOPTING / continuing half-built work (the #1 silent trap): a feature can be
  scaffolded but only HALF-wired — state declared+read but never WRITTEN. A field
  declared+read yet never init'd/mutated is `undefined` at runtime → silent no-op
  (`undefined >= N` is false), so the feature does nothing. `npm run dev`/`npm run
  shot` DON'T type-check — they run happily with it; only `npm run build` (vue-tsc)
  catches a constructor/spawn literal missing the field. So after picking up partial
  work: (1) `npm run build`, never trust a green dev server; (2) grep each new field —
  it must be INIT'd at every spawn/ctor AND mutated by its producer (reset+increment),
  not just read; (3) a behavioural unit test must exercise it end-to-end (a passing
  render proves nothing). Cause: `tilesSinceJunction` shipped declared+read but never
  reset/incremented → keep-right never fired even though it "looked" implemented.
- Every feature ships `/test/<id>` scenario (CLAUDE.md rule); registry test fails CI
  on a broken map. Debug from the scenario, not the full level.
- Visual change ⇒ `npm run shot -- <id> --label before|after` (overlay on, flat bg).
- rAF/hidden-tab: Chrome automation tab hidden ⇒ rAF paused ⇒ sim never steps (no
  cars, frozen) — env artifact. SVG geometry still inspects static. For behaviour use
  unit tests. To eyeball render: `window.__game.stop()` FIRST, then push synthetic
  entries into reactive arrays.
- `config.plainBackdrop` (🌳 BG in /test) = flat green for reading kerbs/markings/gores.

## STATE (2026-07-26 evening) — read before picking up work
- Nothing is PUSHED. Local `master` holds the `claude/terrain-world` merge
  (worlds+camera+demoworld, terrain, live editing, the dispatch loop); branch
  `claude/build-in-play` is ahead of it with the route-draw extraction, build
  in play (phase 2), `lakevalley-open` and the terrain blob relaxation. Check
  `git log --oneline origin/master..HEAD` before assuming a remote knows anything.
- OPEN BUG #56: bus bodies clip when a lane change crosses a tile seam mid-merge
  (4 bus maps, 0.037-0.085 tiles). Pinned in `KNOWN_OVERLAP` in
  `roadScenarioSweep.spec.ts` so it cannot worsen. TWO fixes were tried and
  MEASURED WORSE — read the issue before attempting a third.
- Train Valley phase 2 (build in play) is BUILT (2026-07-26) — see BUILD IN
  PLAY above. The route-draw gesture lives headless in `routeDrawController.ts`
  (`createRouteDrawController({drawing, planOpts, lay})`, pinned by
  `routeDrawController.spec.ts` + the editor e2e); each gesture emits ONE
  `lay(RouteStep[])` with anchor/terminus straights in commit order. The editor
  lays cell by cell (`commit`+`layPair`, rail OR road); PlayView hands the same
  array to `game.buildRoute` ATOMICALLY (rail-only, priced). Steps travel a→b.
  Still in the views, deliberately: tool→layer mapping, `layPair` (lane
  count/bus/one-way), preview PAINT. `lakevalley-open` (2026-07-26) is the
  played result — see LAKEVALLEY-OPEN above. NEXT UP (design doc §8): annual
  tax + calendar clock (the economy's second sink/clock), goals listed on the
  Ready card, destination badges.
- `cfg.lay` runs through the caller's layer choice AT CALL TIME: finishing a
  pending frontier via a tool switch (`toolChanged`) lays the terminus per the
  NEW tool's layer (road route → switch tool → terminus laid as RAIL). That is
  pre-existing editor behaviour, preserved verbatim in the extraction — a fix
  would be a behaviour change, decide it separately.
- The "start `lakevalley` with a GAP in the ring" step is DONE (2026-07-26):
  `/test/lakevalley-open`, playable at `/#/play?mode=tycoon&board=lakevalley-open`
  — see LAKEVALLEY-OPEN above for the tuning and the sim facts it rests on.
- The gallery is 75 scenarios. `npm run probe` + the road sweep both iterate the
  registry, so a new scenario is covered the day it is added.

## WORKFLOW
- Trunk-based MASTER-ONLY (since 2026-06-11); develop deleted. Branch from / PR to master.
- `gh` IS installed + authed, but NOT on the agent shells' PATH: call it by full
  path `"C:\Program Files\GitHub CLI\gh.exe"`. Bare `gh` ENOENTs and the REST API
  404s unauthenticated (private repo) — don't conclude "no GitHub access" from either.
- Commit your scoped change as soon as done+green, unasked. Heavy parallel editing
  of same files (`road.ts`, `editOps.ts`, scenario `index.ts`) — stage only your
  hunks. NO AI attribution in commit msgs.
- Worktrees: node_modules usually resolves up to repo root (try tooling first). If
  junctioned, remove junction (`cmd /c rmdir`) BEFORE `git worktree remove` or it
  deletes the real install. Kill bg dev servers when done.

## BULLDOZE + GRIDLOCK (2026-07-26)
- REFUNDS MUST TRACK PURCHASES, not track. `boughtPieces` (`game.ts`) records the
  connection keys `buildRoute` actually charged for; `bulldoze` refunds only
  those. Without it every board's AUTHORED rail is a cash machine — you would
  bulldoze the pre-laid ring for income. You may raze anything (bar a depot);
  only what you bought pays back. Full refund by design: bulldoze exists so a
  misdrag is not fatal. A demolition FEE belongs with phase 3 clearing costs.
- Removal is the mirror of the new-junction trap: an arm can be left pointing at
  an exit that no longer exists, and `connectionsToExitPort` answers NULL for
  that (train stops dead). `bulldoze` re-derives `initialSwitches` for the tile
  AND its neighbours rather than merging. Adding merges, removing replaces.
- `bulldoze` keeps the CELL when it takes the rails, if terrain/road remain —
  clearing track must not erase the ground under it (`isBlankCell` decides).
- YOU CANNOT BUILD OR RAZE UNDER A TRAIN (same `editBlockers` guard as building)
  — which is also the answer to the question additive-only edits were deferred
  over. Consequence worth knowing: a train stranded at a dead end sits ON the
  near anchor, so the rescue route must be drawn from the FAR side, terminating
  one tile short of it; the join is edge adjacency, so that frees it. Pinned by
  the "nowhere to go" e2e.
- GRIDLOCK: collisions are impossible here, so DEADLOCK is the failure this game
  actually has, and it is silent. `assessGridlock` (pure, `game.ts`) is the test;
  the frame loop only supplies samples + clock. Rules: waiting/parked trains are
  not in the question; a signal the PLAYER holds counts as neither stuck nor
  active; and — the one that is easy to miss — a train at a DEAD END carries NO
  block record at all (the sim notes a block only when `mayCross` refuses;
  running out of rails takes the map-edge branch and reports proceeding), so
  absent block info IS the severed-track case and must count as stuck. The nudge
  names the fix per cause: switches free a deadlock, only rails fix a dead end.
- TRAP: a HIDDEN browser pane runs NO requestAnimationFrame, so the game loop
  does not tick — `elapsedSec` stays 0 and every train reads velocity 0. Any
  "the board is frozen" observation made through the preview pane is worthless.
  Verify frame-loop behaviour in e2e (Playwright composites) or make the logic
  pure and unit-test it. Cost an hour of chasing a phantom deadlock.

## BUILDING: AIMING AT THE END OF A LINE (2026-07-26)
- The board's build targets are the four PINWHEEL WEDGES per tile — they tile the
  square from the centre, so there is no neutral area and every click arms some
  edge. On the gap board that is 168 targets, of which 2 are legal starts, and at
  a fitted zoom (30px tiles) a wedge is ~15px tapering to a POINT at the centre.
- Worse, a line's end is ONE physical place on a boundary but TWO half-targets
  that mean different things: 2,1-East grows the line, 3,1-West arms an empty
  tile. Overshooting by a pixel silently armed the wrong anchor.
- Fix (`tiles/openEnds.ts` + PlayView): at an open end, the wedge is REPLACED by
  a half-tile band carrying the same `data-port`, and the empty tile facing it
  draws its own band DELEGATING to the same `OpenEnd`. One element per port (so
  neither can intercept the other's click), a target of half a tile instead of a
  point, and either side of the boundary arms the same end. A knob marks it.
- Do NOT narrow the targets to open ends only: branching off an INTERIOR edge is
  how lakevalley-open buys its station junction back. Everything stays clickable;
  only the open end gets the bigger, obvious target.
- TRAP — never swap the element under a press. Gating the bands on `pressFrom`
  replaced band with wedge on MOUSEDOWN; mouseup then hit a different element and
  the browser fired `click` on their nearest common ancestor, which has no
  handler. The click vanished with no error and nothing armed. Whatever decides
  which element is under the cursor must not change mid-gesture (`buildIdle` is
  therefore `!armed && !routeStarted`, deliberately not `pressFrom`).
- TRAP — Vite HMR on a big SFC can leave a stale render ("Something went wrong
  during Vue component hot-reload. Full reload required."): the page reported
  `edgeBandPath is not a function` for a method that was plainly in the file.
  Check the console and hard-reload before believing a live probe.
