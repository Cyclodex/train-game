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
- BREATHING ROOM AROUND THE BOARD IS THE CAMERA'S JOB, not the page's:
  `WORLD_MARGIN` (48 SCREEN px — constant on screen, so it is `/zoom` in world
  units). `fitCamera`/`fitZoom` leave it and `clampCamera` lets a pan take it at
  either end. Page padding cannot do this: it made the page taller than the window
  AND still pinned a big world's edge hard against the viewport, with nothing to
  push the outer row of tiles off the frame's vignette.
- `/test` IS EXACTLY ONE SCREEN AND NEVER SCROLLS. `.test-view` is a `100vh` flex
  column; `.test-stage` fills its parent (`flex:1; min-height:0`) — it used to be
  `100vh` ITSELF, below a breadcrumb and a description, so the page was ~160px
  taller than the window and every stage control sat below the fold. Whatever needs
  to scroll scrolls INSIDE itself (the card grid). Same rule applies to anything
  added to that column: give it `flex: 0 0 auto` and a `max-height`.
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
- Anything measuring tile positions on screen must read the pitch off a rendered
  tile, not assume 200 (`scripts/probe.mjs`) — the camera scales the board. SVG
  path data inside a tile stays in its own viewBox units and is unaffected.
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
  TANGENTS are chosen rather than implied (`shoreEdge`): `dir*(size/3)` along the
  shore + `out*lean` across it, with `dir`/`out` taken from the EDGE INDEX
  (`EDGE_FRAME`), never measured off the jittered chord — that is what lets two
  tiles derive the identical tangent.
- A corner is one of THREE things (`cornerRoles`), and the difference needs the
  DIAGONAL neighbours, not just the four sides (`TerrainNeighbours` carries all
  eight; the diagonals are in the memo key too):
  · both edges stop → real CORNER: lean `+lean`/`-lean` (bulge out, come back) —
    this is what rounds a lone patch into a blob.
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
- Per-kind scatter has its OWN band (`SCATTER_BAND`): a peak is ~50 units tall so
  it starts low in the tile and overflows UPWARD (deliberate — the row below is
  later in the DOM, so a near peak occludes a far one; `.tile-ground` is
  `overflow: visible` for exactly this). Keep every `translate()` inside 10..90 —
  a unit test sweeps all kinds and fails otherwise.
- `groundShadow(scale, spread, fill)` — the DEFAULT tint is green because the
  default ground is meadow. On rock/mountain/town pass your own (`STONE_SHADOW`/
  `TOWN_SHADOW`), or every boulder gets a patch of moss under it.
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
  a paper cutout. A snow cap must be cut from the massif's OWN flanks (`snowAt`
  lands on the break→apex segment); a free-standing white wedge hangs off the
  silhouette and reads as a paper dart.
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
- The depot art is z-10 and a loco is z-4, so a train sitting in its shed is
  INVISIBLE. A waiting train therefore reads as an empty station — the fare pin
  IS the affordance, which is also how Train Valley presents it.
- RETRY is a first-class Tycoon flow ("bank more next run"), so `reset()` is hit
  routinely here — it must hand back WAITING trains, the starting capital and
  un-settled fares. Verified end to end (win → reset → win again); the stale
  `game.sim` handle it exposed is in VERIFY.
- NOT built, deliberately (`docs/superpowers/specs/2026-07-25-train-valley-mode-design.md`):
  in-play build (phase 2, blocked on extracting `routeDrawController` from
  `EditorView`), reversing (§5.2), crashes (§2.2 G7), production chains (§5.1).
- The DEFAULT board needs the player to throw switches: left alone, both trains
  lap and bounce off wrong-coloured depots forever. That is PRE-EXISTING and
  identical in Puzzle (measured: both modes 0 delivered / 3 mismatches at 60s) —
  don't read it as a Tycoon routing bug when a headless run never completes.
## PARKING (cars stop, 2026-07-26)
- `TileCell.parking?: ParkingCell` = the FOURTH axis (`tiles/parking.ts`). rail
  `connections` / road `lanes` / `terrain` say what crosses or IS a cell; parking
  says where a vehicle may STOP on it. Cell-level like `roadPriority` — rides every
  editor reducer's spread and every JSON path untouched. NEVER model a bay as a
  `Lane` into `Position.Center`: `roadPortsOf` counts Center, so the tile becomes a
  junction (`isRoadJunction` >2 ports), `deriveJunctionCarLanes` silently DELETES
  the Center lane, and `advance` despawns anything exiting through it.
- THE UNIFICATION: a car park's AISLES are ordinary one-way `road` lanes, so the
  router + follower model drive its rows for free. One primitive — a ROW of stalls
  on one approach of one tile, one bank. Kerb bay / 90° lot bay / garage ramp are
  the same thing with different depth+paint. Garage stalls are HIDDEN (inside a
  building), `count` = capacity, all at one pose — safe only because of the
  one-car-at-a-time barrier.
- CAR PHASES (`road.ts CarPhase`): driving | entering | parked | leaving.
  · parked = ZERO body points (`bodyPoints` returns []) + empty `bodyTileIds`.
    That one fact is what keeps it out of `clearAhead`, the junction gates and
    `worstSweptOverlap`. Do NOT try to express a bay as a lane index: `lanePosAt`
    CLAMPS to [0, count-1], so lane −1 reads as the kerb lane and the parked car
    seals its own street forever.
  · entering = full lane body SHRINKING to 0 (traffic queues behind a parker —
    correct); leaving = FULL body from tick 1 (it only sets off on a clear gap).
  · `headProgress` is FROZEN at the peel-off point for the whole stay, so
    `sampleAtArc` keeps working and `resumeFromStall` knows where to rejoin.
  · advanceParking ZEROES `waitSeconds`/`waitedSec`. Left to accrue, a dwell beside
    a crossing FAILS crossing-keeper (30s `maxCarWaitSec`) while behaving perfectly.
  · Filter non-driving cars out of `waitingCarsAt` (else a phantom claimant with
    waitSeconds→∞ owns the arbiter's starvation guard) and parked out of
    `laneClearForChange` (it reads frozen `headProgress`, not body points).
- PARKED CARS ARE OUT OF THE TRAFFIC CAP (`activeCarCount`). `maxCars` is a DENSITY
  setting; counting a car in a bay against it empties the streets as a car park fills.
- AIM TOKENS = plan-time reservation (`parking.aim`). `availableFor` = free − aimed,
  and that is what `openFacilities`/the router read, so a car park that is spoken
  for is avoided like a full one. TRAP (shipped once): take the token only AFTER
  `cars.push`. Every bail-out in `trySpawn` above that — a blocked entry lane most
  of all — fires constantly under `fillFast`, and a token for a car that never
  existed can never be released. Car parks then DRAIN to empty and stay there.
  Pinned by `parking.spec.ts` "no leaked aim tokens", measured via `parkingStatus()`.
- LEAVING A BAY is a two-step claim, and every shortcut here was measured worse:
  · The dwell ends → the car goes to `leaving` and CLAIMS its lane slot at full
    length, but does not move. Traffic brakes for it, so the gap it needs forms
    BECAUSE it is waiting. Claiming only once it starts rolling is a no-win dial
    (0.5-tile gap ⇒ 12 parked / 2 ever out on `parkinglot`; 0.16 ⇒ real clips;
    raising it again just fires the patience valve and barges into traffic, 0.175).
  · It may only claim a slot the traffic behind can BRAKE for: `slotFree` adds
    `v²/2b` per moving car, not just CAR_GAP.
  · It may not claim one an ADJACENT bay is about to use. Two 90° bays are 28px
    apart but a car is 38px long, so two neighbours emerging together cannot fit.
    Committed (`entering`/`leaving`) neighbours win; same-tick ties go to the lower
    id, like the junction gates.
  · `pullOutClear` (the roll decision) measures a STOPPED car against the leaver's
    BODY and a moving one against body + `pullOutGap`. One that stopped behind you
    stopped BECAUSE of you, and treating it as an obstacle deadlocks both
    (measured: 50s stuck in `leaving`, and the sweep drops parkinglot to one
    completed cycle) — but "behind you" has to mean behind your BODY. `pullOutGap`
    (0.16) is nearly three times a stopped car's following gap (CAR_GAP, 0.06), so
    the old blanket skip was the only thing keeping a correctly-parked follower
    from blocking for ever, and it also waved through a car that had come to rest
    INSIDE the space being reversed into.
  · Do NOT grow the leaving footprint in as the car emerges: a follower brakes
    against what it can see, so starting at nothing means it arrives on top (0.077
    vs 0.028). Entering shrinks; leaving is full from tick one.
- NOSE vs CENTRE — the conversion every seam between the road and a bay needs.
  `headProgress` names where a car's FRONT is (arc 0 of `sampleAtArc`); every
  manoeuvre curve names where its MIDDLE is (`sample()` lays the body ±half a
  length about the curve point, and a stall pose is where a car RESTS). Cross
  without converting and the sprite steps half its own length — forward as it
  peels off, backwards as it rejoins, which is a fifth of a tile on a coach and
  was reported as "the bus appears a few cm further back before it drives away".
  · `beginEntering` anchors the curve at `headProgress − half`. NEGATIVE IS FINE:
    a car peeling off toward the first bay of a packed rank has its middle still
    on the tile behind, and `centrelineAt` is a plain lerp on a straight, so t < 0
    is the lane extended backwards. Clamping it to 0 puts a fifth of the jump back
    (measured: the lay-by test fails at 0.145 either way).
  · `seatAtExitSlot` seats the nose at `endT + half`, and `exitFor` takes a
    `headRoom` so the curve stops half a body short of the tile's end — otherwise
    the nose has nowhere legal to sit and the clamp reintroduces the jump.
  · `resumeFromStall` HANDS THE MANOEUVRE'S SPEED OVER on a nose-first exit
    (`PARKING.speed x pace`, capped at the car's own cruise). `advanceParking`
    pins `velocity` at 0 for the whole swing — the curve moves the car, the
    follower model does not — so rejoining at 0 makes a coach that was gliding out
    at 0.47 tiles/sec stop dead on the lane and start again. Not braking: no
    momentum. A REVERSED-OUT bay keeps the standing start and should, the driver
    really has stopped to change direction.
  · `stopTOf` is the STOP LINE, and it is where the CENTRE-vs-NOSE conversion bit
    hardest. Braking the nose to `startTOf` puts the centre half a body SHORT, and
    `beginEntering` anchors the curve there — so every pull-in drove an approach
    half a body longer than the geometry was designed for. On a 90° bay that is
    the worst possible error, because a longer approach cuts HARDER across the
    neighbours: the aisle clearance was spent again before anyone could use it
    (swept penetration into a parked car, measured in the sim: 5.9px → 1.2px once
    the nose stops half a body past). Applied to the TURNING kinds and to halts,
    where the run is a hard constraint; a PARALLEL bay keeps the nose stop, since
    arriving early only lengthens a shallow slide and measured better for it
    (parkingkerb 7 completed cycles a run against 2).
  · A HALT needs the same half: its stall `t` is
    the middle of the marked kerb and the bus stands ON it, so the nose goes half
    a body past. Braking the nose to the middle parked the coach BEHIND its own
    markings — hanging off the back with the front half of the stop empty, which
    is exactly what a bus stopping short looks like (0.122 of a tile out).
    `clearAhead` and `atStallEntry` must agree on it or the car creeps for ever.
- SLOT CHECKS MUST FOLLOW THE BODY ACROSS A TILE SEAM. `slotFree` compared the
  other car's points TILE BY TILE, so a car standing across a seam read as its
  nose alone — its tail was on the tile behind and simply not looked at. A car
  then claimed a slot four thousandths of a tile in, inside a leaving neighbour
  whose tail lay at `1,2|t0.948`, and they sat a tenth of a body through each
  other. It now takes the other body's EXTENT along the approach, mapping a point
  on the tile behind to `t − 1` (exact: a straight lane segment is one tile long
  and a row is only legal on a straight). Anchored on "has a point in my lane on
  MY tile", or an upstream point alone would block on oncoming traffic.
- WHICH STALLS ARE DRIVEN OUT OF FORWARDS: `exitsForward(kind)` = garage | parallel.
  An echelon or 90° bay is REVERSED out of — that is the real motion, and replaying
  the entry curve backwards is exactly it, free. A KERBSIDE space is not: nobody
  backs out of a parallel bay into the traffic behind them, and a coach in a lay-by
  physically cannot. Both of those and the garage drive `forwardExitPath`. The car
  is re-seated on the EXIT slot when it starts leaving, not when it finishes, or it
  spends the manoeuvre claiming the bay and then materialises downstream inside
  whatever queued there.
- GARAGES are driven THROUGH: two ramp mouths (`GARAGE_IN_T` / `GARAGE_OUT_T`) and
  `exitTo` to put the out-ramp on the other approach, so departures do not queue
  behind arrivals.
- A 90° BAY NEEDS A CAR'S LENGTH OF AISLE, and `bayNearPx` enforces it whatever
  the author wrote (`TURN_IN_CLEARANCE_FRAC` 0.19). Turning a car through a right
  angle takes its own length of room: from the 14px aisle these maps had, the
  pull-in drove 5.6px THROUGH the parked car next door; at a car's length it
  grazes it (+0.6px) and stays there however much more you give it. A THRESHOLD,
  not a dial — and the one repeated expression (`kerb + gap·W`) is now one
  function, because the rule would have been missed by all nine call sites.
  · A LONGER APPROACH MAKES IT WORSE, fast: −5.6 → −23.7px at 0.6 of a tile, since
    the car spends the extra distance travelling diagonally across the bays it is
    passing. Turn LATE, in a WIDE aisle. (Which is why `manoeuvreRunPx` gives the
    turning kinds the short fixed run and only kerbside ones a long one.)
  · `apronNearPx` ≠ `bayNearPx`: the clearance is the aisle the car swings
    through, so it is PAVED to the kerb. An authored `gap` is the opposite — a
    pavement or verge — and stays green.
  · `pace` had to move from the run to the CURVE LENGTH. Widening the aisle leaves
    the run untouched and adds half again as much curve, so on the run alone it
    read as "no change" while every 90° pull-in silently took 60% longer and
    `parkinglot` fell from three completed cycles a run to two.
- A REFUSAL THAT CANNOT BE SATISFIED IS A DEADLOCK, not a rule. The lane gate
  below shipped as a plain `return false` from `atStallEntry`, and its
  intersection with three individually-correct rules wedged the car for ever:
  `clearAhead` brakes it to the stop line, a STOPPED car may not change lanes
  (road.ts updateLateral), and a car that never reaches the tile end never runs
  the crossing hook that hands the bay back. Measured on /test/parkingkerb: EVERY
  live vehicle at v=0 at the end of EVERY seed, against 99-108 completed cycles
  once it is impossible. `missedStall` makes it a checked STATE and releases the
  bay on the spot; `clearAhead` does not brake to a stop line the car cannot use;
  and `desiredLane` (P) aims kerb-ward as soon as the car HAS a target, since the
  approach tile is not part of the facility and keep-right needs three
  junction-free tiles a short map does not have.
  - THE SWEEP COULD NOT SEE IT. Its standstill predicate read `c.speed` — the
    car's preferred CRUISE, never zero — so it was dead code for its whole life;
    and it runs 40 simulated seconds while the collapse takes 50-120. Both fixed,
    plus a long-run liveness test in `parking.spec.ts` that runs 200s.
- NOTHING SPAWNS IN THE MIDDLE OF THE MAP. `roadEntries` called a seam an opening
  when no upstream lane fed it — but a ONE-WAY neighbour pointing away feeds
  nothing, so an interior tile beside a one-way read as the edge of the world.
  /test/parkcity materialised 4-9 vehicles a run at its car-park ramp mouth. A
  road you cannot enter from this side is a one-way street; only genuinely
  off-grid, or a stub with no road beyond it, is an entry.
- A PARALLEL BAY'S RUN IS MEASURED FROM THE CAR'S OWN LANE, not the centreline.
  The bay is `bayNearPx + depth/2` out from the middle of the road, but the car is
  already riding the KERB LANE — the shift it actually makes is 27px on a 1+1 and
  on a 2+2 alike, against the 69px the centreline suggests on the wide one. Taken
  from the wrong datum the run came out at 138px, five times the real shift, which
  (a) clamped two of every three stop lines to the tile's leading edge, leaving
  nothing to change lanes in, and (b) drifted the body sideways while it was still
  abeam the neighbours — the "cuts across the next bay" that was reported.
- A PARALLEL BAY CANNOT BE ENTERED NOSE-FIRST when both neighbours are taken, and
  that is geometry, not tuning: 60px of pitch for a 40px car is 20px of slack, and
  the car has to shift 27px sideways. So it is BACKED INTO — `canNoseIn` decides,
  the driver does not: free space ahead means nose in, otherwise reverse in.
  Swept penetration into a parked neighbour went -7.6px -> +0.1 (parkingkerb) and
  -7.5 -> 0.0 (parkcity) with no throughput cost (75-76 completed cycles either way).
  - A MANOEUVRE IS A SEQUENCE OF LEGS, each with its own direction
    (`ManoeuvreLeg.reverse`). `m` still runs 0->1 over the whole thing by arc
    length, so the phase machine never learns there is more than one. Reversing is
    one flag: the rendered heading is the tangent turned round, and arc length,
    speed and pace fall out unchanged.
  - THE TRIGGER MUST NOT FIRE WHILE STILL ROLLING. `PARK_ARRIVE_EPS` exists because
    `clearAhead` binds the clear distance to exactly the stop line and the brake
    ramp approaches it asymptotically — but spending the tolerance while moving
    anchors the curve up to a twentieth of a tile early, and on a kerbside bay that
    extra approach drifts the body across the neighbour (2.4px, gone once the
    trigger needs either the line or a standstill).
  - BACKING INTO A 90 deg OR ECHELON BAY IS NOT SHIPPED, and the reason is measured.
    With the curve laid between the two known tangents it comes out WORSE than
    nosing in: 90 deg forward +3.3/+0.1px against reverse -3.3/-5.6; echelon
    forward -2.3/+0.3 against reverse -8.6/-15.0. Widening the aisle barely moves
    it (-5.6 -> -1.8 at 42px more), because a real reverse swings the FRONT through
    the aisle about a pivot roughly abeam the space, and a Bezier between two known
    tangents bulges across the bays either side instead. It needs a pivot ARC. The
    `reverseParker` trait is drawn and stable; the preference is simply not live.
- A BAY IS ENTERED FROM ITS OWN LANE ONLY. `atStallEntry` refuses any other, and
  `desiredLane` branch (P) gets a car with a `parkTarget` over to the kerb-most
  lane as soon as it is on a tile of that facility — early, so the merge has room.
  Without it a car dives out of the inner lane of a 2+2 street straight across the
  stream beside it. The companion is in the tile-crossing hook: a car that leaves
  its stall's tile still driving RELEASES the bay ("missed it"), or the space
  stays claimed for the rest of the run by a car that can no longer reach it.
- STALL CHOICE is scattered by `hashOf(carId) % free.length`, filtered to bays
  still AHEAD of the nose (`atStallEntry` only fires forwards). Deterministic and
  free: a real RNG draw here would couple the parking stream to traffic state, and
  every seeded run in the repo would shift the next time the following model moved.
  Always taking the nearest bay packs a car park solid from one end.
- The MANOEUVRE is a quadratic Bézier (lane → point abeam the bay → bay) with an
  explicit ARC-LENGTH table. NOT `turnLaneFrame`'s fillet: that is 90°-only
  (tangent == rf because the lane lines are perpendicular) and of the four stall
  kinds only "perpendicular" turns 90°. Never drive `m` as the raw Bézier
  parameter — it is not proportional to distance and the car surges mid-swing.
- GEOMETRY (200px tile, 38x20px car): kerb = `max(laneCountAt,2)/2·W`, ONE-WAY =
  `oneWayRunMax/2·W` (a 1-lane aisle's kerb is 14px, not 28 — the two-way floor
  floats bays a car's width off the tarmac). Depth parallel 26 / perp 48 / angled
  42 / garage 22. Pitch parallel 60 / perp 28 / angled 29 (= carWidth/sin45 — the
  cars nest; deriving pitch from the 45° DIAGONAL wastes a third of the kerb).
  ⇒ kerb parking CAPS AT A 2+2 ARTERIAL: 3+3 leaves 16px, less than a car is wide.
  An ECHELON bay is a PARALLELOGRAM (kerb edge along the road, sides raked
  FORWARD); rotating a rect overlaps its neighbour by 18px and lands on the tarmac.
- `align` defaults to "pack" (row starts at the leading edge). "centre" on every
  tile of a long row leaves a car-sized hole of kerb at EVERY tile seam.
- EDITOR TOOL (2026-07-26): the target is a KERB, not a tile edge and not a lane.
  An edge wedge names a DIRECTION and covers the carriageway; on a two-way street
  the two kerbs are reached from different approaches. So the hit strip is keyed
  `(approach, side)` and DEDUPED BY `bankFor` — else a two-way tile offers four
  hits for its two kerbs and you can author two ranks into one strip of tarmac.
  The strip IS the pixels the bays will cover. Plain click paints the whole street
  run (`setParkingRowRun`, clicked tile decides the state so a half-painted street
  goes uniform); Ctrl+click does one tile via `toggleParkingRow` — a bare `set`
  there means two clicks to change one tile's kind.
  · The tool PREVENTS everything one cell + its neighbours can see (greyed kerb:
    bend, junction, taper, overhang, far bank on a two-way) and REPORTS only
    "car park has no way out", which is a property of a flood fill a road edit
    three tiles away can invent. Verified in the editor: on a 2+2 arterial
    parallel and angled are live, 90° is greyed — kerb parking genuinely caps
    there at the 200px tile.
  · `maxStallsPerTile("garage")` is a CEILING (400), never a default: a garage's
    slots are not on the map, so "how many fit" is the wrong question.
    `DEFAULT_GARAGE_CAPACITY` (16) is what the tool lays, and a reservation is
    dropped on a garage — a whole building is not a disabled bay.
  · Road edits run `pruneParkingRows`: redrawing a two-way street as one-way, or a
    straight as a bend, otherwise orphans a row and the validator fires on a tile
    the author never touched with the parking tool.
  · `validateParking(level, tileSize, grid?)` — the way-out check needs the GRID.
    Without it a kerb bay on the last tile of a border street reads as a car trap,
    because "runs off the level" and "dead-ends mid-map" look identical from the
    level alone. The registry spec passes `scenarioGrid`.
  · TRAP: `isActiveItem`/`selectItem` need a `stall` branch beside the `terrain`
    one. Several dock items share `tool: "parking"`, so without it every kind
    lights up at once and picking one silently does nothing.
- AUTHORING: a car park must LOOP back to the street. There is no U-turn in the
  lane model, so a dead-ended aisle is a car trap — `validateParking` rejects it,
  and `createRoadSim` filters in-grid openings on facility tiles out of BOTH
  `roadEntries` and `allMapExits` (else cars materialise between the rows, and
  through-traffic is routed into the lot "to leave the map there" and evaporates).
  A facility tile may carry ONLY `{facility}` — that is how an aisle joins a car park
  and how "have I driven the whole thing?" stays answerable.
- A FACILITY THAT CANNOT FILL NEVER SHOWS THE FEATURE. The marquee behaviour is a
  driver finding it full and going elsewhere, so keep a demo facility small (the
  garage: 4-6) and let the big surface lot be the one that always has room.
  Conversely: a rank of 2 bays on a 200px tile reads as an UNFINISHED car park, not
  a small one — fill the tile (3 parallel / 7 perpendicular).
- A BAY SERVES ONE CLASS, and the class is ADMISSION not SIZE. `stallFits` gates on
  `bayAdmits(kind, bayClassOf(row))` FIRST, then on real body length as a backstop.
  `BayClass` = car | lorry | bus | delivery | permit, and the `bayAdmits` switch is
  exhaustive on purpose — a new class that nobody may use looks exactly like a bay
  nobody happens to have taken yet.
  · car      → cars. Includes a GARAGE whatever its capacity: a height barrier, and
    its slots are not on the map so no geometry would ever have said so.
  · lorry    → truck + bus. A lay-by genuinely serves both; that is what it is.
  · bus      → bus only (a stop, authored with a SHORT `dwellSec`).
  · delivery → truck only. A coach fits and is not making a delivery.
  · permit   → nobody (no disabled-permit system; they stay empty, which is what
    makes a car park look real rather than 100% usable).
  Geometry alone shipped wrong once: a car took a `long` bay (fits, with room to
  spare), a coach took an ordinary kerb space (bus 55px vs a 60px parallel bay) and
  a lorry drove down a GARAGE ramp (`stallLengthPx` is Infinity there). All three
  measured true; all three wrong; and invisible to every other check, because the
  swept-overlap test only compares bodies within 0.7 lanes and a bay is further out
  than that by construction. Only SINGLE-BOX vehicles park (`vehicleCanPark`, no
  semis).
- TWO KINDS OF BUS STOP, and the difference is one property: `stallOnLane`
  (`StallKind "busstop"`). A LAY-BY is a bay off the carriageway — the bus leaves
  the lane and traffic flows past. A HALT is a length of kerb it stops AGAINST, in
  lane, so everything behind it QUEUES. That inverts the rule the rest of parking
  rests on, so a halted bus KEEPS its road body and every gate that tested
  `phase === "parked"` had to become `blocksLane()` — `clearAhead`'s follower loop,
  `laneClearForChange`, `bodyTileIds`, `pullOutClear`, and the traffic cap. Missing
  one lets the queue drive straight through the bus (measured: 0.04 overlap).
  A halt also skips the manoeuvre entirely (a zero-length curve divides by its own
  length), skips the gap checks, and takes `startTOf` = the stop's own `t`.
- A LAY-BY OPENS AND CLOSES (`layByTaperPx`): the kerb swings out, runs level for
  the bay, swings back. Only for a BIG bay (bus/lorry/delivery) — a run of ordinary
  kerb spaces is a continuous parking LANE and tapering each tile's end would turn
  one street into a row of pockets. 1.5x depth is the most that fits: bay 110 + two
  39px tapers = 188 of 200, and 2x would spill onto the neighbour where the tile's
  own viewBox clips it. A tapered bay CENTRES itself whatever `align` says — a
  packed row starts at the leading edge with no room in front for the opening.
- THE MANOEUVRE IS A CUBIC, AND ITS TANGENT IS THE HEADING. A quadratic cannot
  leave along the lane AND arrive along the bay's own axis — its two tangents share
  one leg — so the arriving angle was whatever the curve finished on and had to be
  BLENDED to the stall's rest angle over the second half. That blend is a rotation
  on a schedule, and it is exactly why parking read as an ANIMATION next to the
  rest of the traffic model: a lane change sets no angle at all (lateral velocity
  under an accel cap, an S-profile arriving at zero, and `lanePosAt`'s body lag
  ANGLES the car by itself). With both ends free the car arrives already pointing
  into the bay, so `manoeuvreAt` returns the bare tangent. Measured over a swing,
  worst change in TURN RATE per step: 0.73° → 0.11° on a kerb bay, 0.75° → 0.20°
  on a 90° one; and the peak turn rate on the 90° halves (6.7° → 3.5°) because the
  turn is spread over the curve instead of crammed into the blend window.
  · It also finished the "drives over the neighbours" story: approaching SQUARE
    rather than diagonally clears them outright. Swept penetration into a parked
    car across a whole `parkinglot` run: −0.029 tiles with the old narrow aisle,
    −0.006 once the stop line stopped adding half a body, ZERO once the approach
    became square. The sim test asserts no penetration at all now, not a tolerance.
  · TRAP: do NOT take the lane's direction from `laneSegmentPointAt(...).tangentDeg`
    to build a handle. It is a finite difference CLAMPED to [0,1], so at t < 0 —
    where a car peeling off toward the first bay of a packed rank legitimately is —
    both samples land on the same side of 0 and the heading comes out 180° WRONG.
    That fed the cubic a reversed handle and the curve looped out and back: a
    0.29-tile lurch, caught by the no-teleport test. `approachDeg` reads the
    segment's two ends instead, which is exact on the straight a row must be on.
- CONTROL-POINT PLACEMENT is what makes a manoeuvre gentle, NOT its length. Each
  end's tangent must match the heading the vehicle actually holds there:
  · IN: p0 and p1 both on the LANE (that is the heading it arrives at). With p1
    abeam the bay instead, the last leg is purely lateral — the vehicle reaches its
    space sideways and the whole turn lands in the final few percent; lengthening
    the approach then makes it WORSE, the same turn concentrated harder (measured:
    12.6°/step on a long lay-by vs 6.9° on a short bay). p1 sits where the KERB
    straightens (the taper end), else the midpoint.
  · OUT: mirror it — p0 and p1 both on the STALL's axis. For a kerb bay that is
    down the road (which incidentally makes the longitudinal motion linear in the
    curve parameter); for a GARAGE the axis IS abeam, since it stands square to the
    street. Get this wrong and the sprite SNAPS from its rest angle into a crab on
    the first tick of leaving.
- MANOEUVRE LENGTH is `manoeuvreRunPx(row, size, kerbPx)` — ONE number for both
  directions, or a bay is entered along a gentle curve and left along a sharp one.
  A KERBSIDE bay is the case that cannot use a constant: the vehicle points down
  the road at both ends and only shifts its own offset sideways, so the room it
  needs is set by that offset (2x lateral). Measured as "slip", the fraction of
  motion that is sideways to the sprite's own heading: 0.89 peak / 0.32 mean on the
  old fixed 0.16-tile approach — a car sliding into its space broadside — against
  0.61 / 0.16 now. 90° and echelon bays keep the constant: they are MEANT to turn
  across the kerb.
- …which then needs `ManoeuvrePath.pace`. Manoeuvre speed cannot be one constant
  either: a long shallow swing into a lay-by is not driven at the speed of a tight
  turn into a 90° bay, and that is the whole reason a town builds a tapered one.
  Left constant, the longer kerbside curves made every pull-in and pull-out ~2.5x
  slower and `parkingkerb` fell from 3 completed cycles a run to 1 — the street
  throttled by vehicles crawling through their own manoeuvres. `pace` = run ÷ the
  fixed approach, so a gentler curve takes about the same TIME.
- A HALT PAINTS NOTHING BOX-SHAPED. `stallBoxPoints` on a zero-depth row is
  DEGENERATE — nought long and a full pitch wide — and renders as a bare line
  straight across the road. `stallOutlinePath`/`parkingKerbPath`/`parkingApronPath`
  all return "" for it; its yellow kerb marking, tarmac legend and shelter
  (`busStopGeometry`) are what mark it. Only visible when zoomed: `npm run shot
  --scale 6` found it.
- THE YELLOW MARKING GOES ON THE ROAD SIDE of a lay-by (`busStopGeometry.kerbLine`
  at `near`, spanning the whole opening incl. the tapers), not along the back of
  the bay. It is a marking on the CARRIAGEWAY — the line between the bay and the
  running lane — so painting it against the verge put it where no traffic could
  ever cross it and left the mouth unmarked. A HALT has zero depth, so `near` IS
  the kerb and both kinds land right for the same reason. The shelter and sign do
  stand at the far edge; they are furniture, not paint.
- The sign reads **H** for a bus facility and **P** otherwise. A car-park P over a
  bus stop reads as somewhere to leave your car, which is the one thing it is not.
- AUTHORING: put a halt UPSTREAM of a lay-by when both are on one street. A queue
  backs up BEHIND its cause, so the halt's runs away from the bay; the other way
  round it reaches back past the lay-by and anything measuring "is traffic stopped
  near the bay?" reads the halt's jam and blames the bay (it did — 35 vehicles).
- SIZE follows the class through ONE predicate, `needsBigBay` (long|delivery|bus →
  110px, one per tile). The inline `reserved === "long"` it replaced sat at NINE
  call sites; every one would have gone on sizing a bus stop like a car space.
- `CAPACITY_PROBES` — capacity/freeCount with no kind asks "could ANYONE use this",
  over one vehicle per class. Hard-coding a car made a lay-by of two lorry bays
  report nought capacity and show VOLL beside two empty spaces. The router always
  names its kind (`availableFor`), so nobody is misrouted by it.
- `freeCount`/`capacity` with NO kind means "could ANY vehicle use this" (car OR
  lorry), so a lay-by of two lorry bays reads `P 2/2` instead of reporting nought
  capacity and showing VOLL beside two empty spaces. The ROUTER always names the
  kind (`availableFor`), so a car is still never sent to lorry-only space.
- `/test/parkinglorry` is the focused demo: car spaces at one end, a lay-by at the
  other, and a mix heavy enough in lorries and coaches to fill it. `/test/parkcity`
  carries all six facility kinds at once, and `parking.spec.ts` runs it for 200
  simulated seconds asserting each is used by exactly its own class — the test that
  would have caught the original report AND the two bugs it was hiding.
  `/test/busstops` is the halt-vs-lay-by pair, asserted both ways: the mechanism (a
  halted bus reports a road body, a bayed one does not) and the consequence
  (traffic queues behind the halt and never behind the bay).
  `/test/parkvariants` is the GALLERY - every kind on one board, and the home for
  the two combinations that existed nowhere: ECHELON bays (authored in no level at
  all) and 90 deg bays BESIDE A STREET (they only ever sat on a car-park aisle). It
  is three INDEPENDENT straight streets, not a loop: a turn tile is narrower than
  the road it meets, so the kerb tapers across the tile beside it and
  `validateParking` rejects a row there. Widths are not interchangeable - a 90 deg
  rank beside a 2+2 lands at 104px, over the tile own half-width, and is rejected;
  it needs the 1+1.
  `/test/buslayby` is ONE straight and ONE bay, for watching a single coach do the
  whole move. Worth its own entry precisely because `busstops` has two stops and a
  city map has fifty vehicles: a seam bug that moves one bus half a body length is
  invisible in company. It is what the nose/centre fix was found and pinned on.
- A TEST'S SIM MUST TAKE THE SCENARIO'S OWN `traffic.mix`. `parking.spec.ts`'s
  helper dropped it, so every map spawned cars only — and a map whose bay is
  bus-reserved parked NOTHING. A seam test then ran green over an empty street
  and reported the ticks it had counted, all of them cars driving past.
- Reserved `disabled`/`delivery` bays are excluded from capacity AND stay empty
  (no permit system) — that is what makes a car park look real, not a bug.
- FOUR FILES, and the split is by QUESTION not by size:
  · `tiles/parking.ts` — where bays ARE (data + geometry, no state)
  · `sim/parking.ts` — which are TAKEN (the registry; also owns `facilityOfTile`,
    because "which car park is this tile part of?" is derived purely from the level
    and BOTH the phase machine and the road graph need it)
  · `sim/roadParking.ts` — what a car DOES about them (the phases)
  · `sim/road.ts` — the traffic model, which now only wires the four together.
  The value of the last split is the explicit `ParkingDeps` list: as closure state
  there was no way to see how coupled parking and traffic were. Only two entries
  are genuinely road.ts's — `bodyPoints` (walks a path by real driven arc length)
  and `roadExitPort`. TRAP when moving code out of `createRoadSim`: a hoisted
  `function` becomes a `const` from a destructure, so anything using it EARLIER in
  the closure hits the TDZ. `facilityOfTile` did (`openingInsideLot` runs while the
  spawn entries are built) and every road scenario threw.
- TESTS: the sweep measures flow against MOVING vehicles (`movingCarCount`) and
  swaps `lateCrossings>0` for `parkCycles >= 3` on `PARKING_SCENARIOS` — parking is
  a CYCLE, not a sink, and that is the property to assert. `frontTiles` must skip
  parked cars AND unit-less samples (a garaged car has `units: []`).
  Dwell must fit the sweep's 40s window on a demo map, or one cycle is all you get.

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
- NO MIN-2 PAINT FLOOR on a curve. `Tile.vue roadPaths` used `max(selfAt, 2)` in
  the curve branch — a leftover from when a 1-lane one-way road was itself drawn 2
  wide. Since the run-max kerb anchor a one-way STRAIGHT is drawn its true 1 lane,
  so the floor made every one-way single-lane BEND twice the width of the road
  either side of it (visible as a bulge at each corner of a car-park aisle).
  `laneCountAt` counts BOTH directions, so anything two-way is already ≥2 and this
  changed nothing for it — `roadcurveloops` is pixel-identical before/after.
  Guarded by `tests/unit/tiles/roadPaintWidth.spec.ts`.
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
- `npm run probe` = RENDER-level audit of all 79 scenarios in a real browser
  (`scripts/probe.mjs`): every tile in the grid cell its coord names, no red
  mismatch paint, no console errors, every merge arrow forward + leaning to the
  survivors. Sits between unit tests (sim behaviour) and `shot` (eyeball). Run it
  after ANY renderer/layout change — it catches what a screenshot won't, across
  maps nobody opens. Ids come from walking the picker, so new scenarios are covered free.
- `npm run shot` starts its OWN dev server on :5181 with `--strictPort`, so another
  worktree's `npm run dev` on that port makes ours exit while the port still
  answers — it would then shoot A DIFFERENT CHECKOUT of the app (or, as seen,
  time out on `window.__game` 30s later with nothing to say why). Guarded now: the
  script watches for its server dying and says to pass `--port`. It also kills the
  process TREE (`taskkill /T`) — with `shell:true` on Windows `.kill()` reaps only
  cmd.exe and every run used to leak a vite holding its port.
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

## STATE (2026-07-26) — read before picking up work
- Nothing is PUSHED. `master` holds the merged road-rendering work; branch
  `claude/terrain-world` is ahead of it with worlds+camera+demoworld, terrain,
  live editing (phase 0) and the Tycoon economy (phase 1). Check
  `git log --oneline origin/master..HEAD` before assuming a remote knows anything.
- OPEN BUG #56: bus bodies clip when a lane change crosses a tile seam mid-merge
  (4 bus maps, 0.037-0.085 tiles). Pinned in `KNOWN_OVERLAP` in
  `roadScenarioSweep.spec.ts` so it cannot worsen. TWO fixes were tried and
  MEASURED WORSE — read the issue before attempting a third.
- NEXT UP: Train Valley phase 2 (build in play); full state of play + sizes in
  the design doc **§8** (renumbered — there used to be two §6s). Its ONE blocker
  is an extraction, not a feature — pull the route-draw gesture out of
  `EditorView` (`pressFrom`/`armed`/`routeStarted`/`pendingId`/`hoverPort` +
  `previewByCell`/`commitSegment`/`extendRoute`/`onZone*`, ~230 lines) into a
  headless `routeDrawController.ts` beside `cameraController.ts`, or `PlayView`
  and `EditorView` end up with two copies of the trickiest interaction in the
  app. It must stay layer-agnostic and emit `RouteStep[]` over injected ports:
  the editor commits CELL BY CELL (`level[id]=` + `syncBusGates` + `persist`,
  rail OR road), play commits the whole route ATOMICALLY via
  `game.applyEdits` (rail-only, guarded). Then: gate on `ModeControls.build`,
  preview `tiles × cost`, spend, call `applyEdits`, grey out what `canEdit` refuses.
- TRAP for the "start `lakevalley` with a GAP in the ring" step (what makes it
  the real level): `validateLevel` raises `dangling-track` on any edge port with
  no connecting neighbour AND `route-disconnected` for the unreachable depot,
  and `tests/unit/levels/testScenarios.spec.ts` runs it over EVERY registered
  scenario. A deliberately-incomplete board needs an authored opt-out first —
  it is not just deleting three tiles.
- The gallery is 79 scenarios. `npm run probe` + the road sweep both iterate the
  registry, so a new scenario is covered the day it is added.
- PARKING landed 2026-07-26 (see the PARKING section), with `/test/parkingkerb`,
  `/test/parkinglot` and the `/test/parkcity` world. Deferred with reasons: a
  permit system for reserved bays (they stay empty, which is what makes a car park
  look real), paid or time-limited parking — now that the Tycoon ledger exists
  this has somewhere to go, so it is a real option rather than a dead end —
  and pedestrians (a whole second sim for a 4px dot).

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
