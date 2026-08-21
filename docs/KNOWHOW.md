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
- CLEARANCE FROM THE HUD IS THE CAMERA'S JOB TOO (2026-08-03): `.world` is
  FULL-BLEED (no padding) and the fixed chrome floats over it; `CHROME_INSETS`
  (top 180 / sides 24 / bottom 128, the old `.world` padding) is passed to
  `createCameraController`'s 3rd arg by PlayView + EditorView. `clampCamera`
  centres a small world in the INSET strip and lets a big one be panned until
  its last row clears the dock; `fitZoom` fits inside the strip. Padding on the
  wrapper could not do either: it shrank the camera's window, so the world's
  ground stopped short of the screen in a dead border, and the bottom rows could
  only ever be dragged as far as the dock. TestStage passes no insets (its
  controls are in flow, not over the board) and is unchanged.
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
- TRAP: a bare boolean attribute (`<BuildDock compact>`) reaches a vue-facing-
  decorator `@Prop({ default: false })` as the STRING `""` — which is FALSY — 
  unless the prop declares `type: Boolean` explicitly (no TS-metadata inference).
  Symptom: the flag "just stays false" with zero warnings. Either declare
  `@Prop({ type: Boolean })` or bind explicitly (`:compact="true"`).
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

## GAME FEEL — SOUND + FEEDBACK FX (2026-08-21)
- Sound is synthesised Web Audio, no assets: `audio/cues.ts` (PURE event→cue
  mapping + `rollingGain`, unit-tested) and `audio/engine.ts` (the singleton
  `gameAudio`). World cues fire from `game.ts:handleEvents` (delivery/bounce off
  `cuesForEvents`, "cash" pushed only when the settled fare > 0); click cues fire
  at the click site (`game.cycleSignal`/`toggleHold` → "signal", `Tile.pickArm` →
  "switch", only when the arm actually changes).
- The engine is a NO-OP headless (`typeof window` guard), so `advance()`-driven
  tests never touch it; browsers refuse pre-gesture audio, so the AudioContext is
  created on the first pointerdown/keydown (listeners NOT `{once:true}` — iOS can
  re-suspend a context and resuming takes another gesture). Mute is
  `gameConfig.soundMuted` (persisted via `setSoundMuted`), read live per call.
- The ambient rolling bed is a looped-noise gain ramped per FRAME from the count
  of moving trains (`sim.trainVelocity`), forced to 0 while paused and in
  `game.stop()` — real-time work lives in `frame()`, never in `advance()`.
  TUNE IT FOR LAPTOP SPEAKERS: lowpassed noise at 180Hz/gain 0.02 is inaudible
  on small speakers — the bed sits at 320Hz cutoff, gain 0.055–0.14, with a
  2.8Hz LFO on the FILTER frequency (never the gain: a gain LFO hums at rest).
- Feedback FX are model data: `game.fx` (`FeedbackFx[]`) appended in
  `handleEvents` (delivery pulse / bounce squash / cash chip with the banked
  amount), pruned in `frame()` by WALL-CLOCK age (`FX_TTL_MS` — CSS animations
  run in real time, whatever the speed dial says), cleared in `reset()`.
  `FxLayer.vue` renders it in both PlayView and TestStage; `/test/gamefeel` is
  the isolation board; `tests/unit/feedbackFx.spec.ts` drives it headlessly.
- **A CSS animation on `transform` OVERRIDES the element's inline transform** for
  its whole duration (animations out-cascade the style attribute). Position an
  animated world overlay via `left`/`top` px and keep every keyframe's transform
  self-contained (`translate(-50%,-50%) …`) — the first FxLayer cut put the world
  position in the inline transform and every effect played at the layer origin.
- The cash chip's flight vector is per-element CSS vars (`--fly-x/--fly-y`) read
  by the keyframes; PlayView derives the target from the camera
  (world = cam + screen/zoom), TestStage passes none and the chip drifts up.

## PINCH-ZOOM / TOUCH INPUT (2026-08-21)
- Pinch lives in `cameraController.ts`, so all three boards (PlayView, EditorView,
  TestStage) get it once. Two fingers zoom AND drag; the `−/%/+` buttons stay.
- **Every view must hand the controller EVERY pointer**, saying only whether that
  pointer may pan: `cam.onPointerDown(e, { pan })`. Returning early on a pointer
  the view does not want (what all three used to do) hides the SECOND finger from
  the camera, and the editor — where one finger belongs to the connect tool and
  never pans — could then not be moved by touch at all. A pinch outranks every
  tool: nothing in this app takes two fingers.
- **Zoom about the PREVIOUS midpoint, then pan by the midpoint's travel.** The
  other order (zoom about the new midpoint, then pan) leaks
  `delta * (1/oldZoom - 1/newZoom)` every frame, so the board slides out from
  under the fingers on any pinch that also drifts — which is all of them. Proved
  in `tests/unit/cameraController.spec.ts` as a world-point invariant, not as a
  number.
- **Never read `e.movementX` for a drag.** It is undefined-or-zero for touch
  pointers in several engines, so a one-finger drag moved the board by nothing on
  a phone. The controller tracks `clientX/Y` itself — identical for a mouse
  (the pointer is never locked here) and the only thing that exists for a finger.
- Ending a touch gesture has three cases, all of them live: 3→2 fingers must
  RE-BASELINE the span (a different pair spans a different distance, and without
  it the board jumps); 2→1 hands the pan to the finger still down (lifting a thumb
  and dragging on is ordinary map handling); and the LAST finger up must clear
  `state.panning` even when no pointer ever owned the pan, or the board keeps the
  grabbing cursor and swallows every click from then on.
- **The build/edit edge zones are bound to `@mousedown`/`@mouseup`, not pointer
  events** (`EditorView.vue`, `PlayView.vue`). A `touch-action: none` surface
  fires NO compatibility mouse events — measured: a touch drag over a zone
  delivers `pointerdown`/`touchstart`/`pointerup` and nothing else. So the
  drawing tools cannot be used by touch at all yet. Moving them to pointer events
  is what unlocks that; the `cam.pinching` → `clearPress()` guard in both views
  is already in place for the day it happens.
- `MIN_ZOOM` is still 0.15, so `fitWorld()` on a landscape phone (a ~170px-tall
  viewport) cannot show a big world whole — pinch and pan reach the rest.

## PHONE LAYOUT (2026-08-21) — the /test gallery, and one grid trap
- ONE breakpoint pair for the whole app: `@media (max-width: 700px), (max-height:
  500px)`. `_hud.scss`, `BuildDock.vue`, `EditorView.vue`, `TestView.vue` and
  `TestStage.vue` all use it. The height clause is not decoration — a landscape
  phone is 812x375, wide but shorter than anything the desktop layout assumes.
- **A grid item whose children are ALL `position:absolute` contributes ZERO
  content height, so an `auto` row track cannot see its `aspect-ratio`.** While
  the rows still fit the container nothing shows; the moment they do not, Chrome
  collapses every track to a slice of the leftover space and the items OVERLAP.
  Measured on `/test` at 375px: 45px tracks under 214px cards — the gallery was a
  stack of stripes with every title and description buried under the next card,
  and it looked fine on a desktop because four columns fit their three rows.
  Fix: `grid-auto-rows: max-content` on the grid (`.card-grid`, TestView.vue).
  Reach for it on ANY scrolling grid of aspect-ratio cards.
- A breadcrumb crumb needs `white-space: nowrap` + ellipsis, or a narrow header
  tears "One-way & lanes" into four stacked lines of one word each. Wrap BETWEEN
  crumbs (`flex-wrap` on the row), never inside one.
- `.stage-controls` wraps at every width, not just on phones: it is ~700px of
  chips, so an 800px window already clipped the right-hand readouts off-screen.
- Prose panels get a `max-height` in `vh` + `overflow-y: auto` on small screens.
  `/test/roadlanemerge`'s description is a paragraph and took HALF a phone screen,
  pushing the board out of view; capped at 24vh it scrolls inside its own panel
  and nothing is hidden.
- Scenario descriptions carry paths (`/test/lanedrop`) and arrows (`1→3→1`) with no
  space to break at — `.card-desc` needs `overflow-wrap: anywhere`.
- Touch pan works on the board (pointer events cover touch, `touch-action: none`);
  there is NO pinch-zoom — mobile zooms with the −/%/+ buttons. `MIN_ZOOM` is 0.15,
  so on a landscape phone a big world stays clipped and must be panned.

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
  WHERE IT LANDS: `edgeBow` feeds `edgeLean` only, i.e. a REAL corner's outward
  sweep — and since 2026-08-01 that lean is capped at the tile edge. A long run's
  belly comes from `shorePull` varying per lattice point, not from the bow.
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
    diagonal (`cornerInset`, 18-26u × `CORNER_INSET_BY_STOPS`) and the end
    tangents lean out ~`reach`
    (`CORNER_ROUNDING`), so the turn is a deep sweep, not a softened right
    angle. Needs no cross-tile agreement: only ONE tile ever draws through a
    corner-role point (a same-kind side neighbour would change the role);
    two patches kissing diagonally pull apart into two bodies — deliberate.
  · exactly one stops AND the diagonal differs → mid-shore RUN: pull the point
    INWARD (`shorePull`, 6-12u) and lean by the lattice's shared slope
    (`cornerSlope`). Both are seeded by the LATTICE POINT, so the two tiles
    agree on both.
  · else (interior, or an L's reflex corner where the diagonal IS the same kind)
    → leave it on the lattice, flat. Smoothing a reflex corner pushes one arm
    north and the other east and TEARS THE PATCH OPEN — that case is why the
    diagonals are needed at all. All three are unit-tested for agreement.
- Pushing a shared corner outward does NOT by itself remove a cusp — it is a
  translation, and a cusp is a TANGENT discontinuity. Don't reach for a bigger
  bow/jitter to fix a kink; fix the tangents.
- **A PATCH STAYS ON ITS OWN TILE (2026-08-01).** The mid-shore point used to be
  pushed OUTWARD (7-19u) and the corner lean was unbounded, so a lake sat a fifth
  of a tile in its neighbours and a river came out WIDER THAN THE BRIDGE BUILT TO
  CROSS IT — a full-width deck still left water past both ends of the span, and
  the crossing read as track laid on the river. A cell's terrain is what that
  cell IS, so what answers for the cell (bridge deck, tunnel portal) spans exactly
  one tile and the ground must fit inside it. Three parts, all in `terrain.ts`:
  the mid-shore point is now pulled IN (`shorePull`); a real corner's lean is
  capped at the tile edge (`outwardRoom` — a cubic lies in its control hull, so
  capping the controls contains the whole sweep); and the unclipped fringe halo
  is sized against the pull (20/10, was 30/15). Pinned by "keeps every shore ON
  its own tile", checked PER AXIS — an edge that runs on into the next tile must
  still reach the shared lattice point, jitter and all.
  · The pull is bounded at BOTH ends and the bounds are not arbitrary. MIN >=
    `CORNER_JITTER + CORNER_SLOPE` makes containment exact rather than
    approximate; MAX < the corner inset's per-axis component keeps the shore
    OUTSIDE its own chord — pull deeper and the boundary is sucked in once per
    tile and a 2x2 lake comes out a cushion with a pinch in the middle of each
    side. That is the same star-shaped defect as the old symmetric bow, arriving
    from the other direction. Seen and reverted during this change.
  · CONTAINMENT MADE IT BOXY BEFORE IT MADE IT ROUND, and the two fixes for that
    are worth knowing:
    (a) THE CAP IS ON THE CURVE, NOT ON THE HULL. `outwardRoom` divides by
        `MID_OF_LEAN`: a cubic whose ends sit `d` inside and whose controls lean
        `L` out reaches `d - 0.75L`, so the exact condition is `L <= d/0.75` — a
        control point may sit OUTSIDE the tile while the shore it draws does
        not. Capping at the hull (`L <= d`) is the obvious thing and it is what
        left every sweep dying 5-7 units short: each side read as a straight run
        with a small turn at each end.
    (b) A CORNER'S CUT SCALES WITH THE SIZE OF THE BODY
        (`CORNER_INSET_BY_STOPS`, 4 stops = 1, 3 = 1.3, 2 = 1.75). An ellipse in
        a 2x2 block passes ~29 units inside the block corner per axis against
        ~15 for a circle in one tile: the shore has two tiles to turn in, not
        one. One cut for all sizes rounds a pond and leaves a lake square. Body
        size is READABLE LOCALLY as "how many of my edges stop", and needs no
        cross-tile agreement — a corner-role point is drawn by one tile only.
    Pinned by "reaches the tile edge mid-shore and cedes the tile's corners" and
    "cuts a bigger body's corner deeper than a lone pond's".
  · Scatter obeys the same rule: `peak`'s crest (34-48u) / apron widths, `boulder`'s
    radius and the mountain/rock BANDS are pitched together so a ridge or a
    boulder lands inside its cell. Before, a massif overhung the tunnel portal
    that was supposed to be its mouth.
- SILHOUETTE ≠ BOUNDING BOX (2026-07-26): outward bows + smooth runs alone still
  left every real corner ON the authored box corner — a 3x2 lake was a rectangle
  with wavy edges. The inward corner pull + big leans relaxed it into a blob.
  Pinned by area: a lone
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
- FOREST DEPTH (2026-07-27): a forest tile's density scales with how many of
  its 8 neighbours are forest too (`depth` in buildGround) — +18 trees and
  +0.45 scale at full depth, so a big wood closes into overlapping canopy
  while a lone copse stays airy. Local by design: it needs nothing beyond the
  neighbour flags the cache key already carries, and ONLY forest reads it.
  Toward a same-forest neighbour the placement band runs to the SEAM (0/100),
  so the two tiles' canopy interleaves — the count bonus also compensates for
  that larger band area, or the deep wood comes out sparser per square unit
  than the copse. /test scenario: `forestworld` (a curvy line, 10x5 deep wood).
- SCATTER IS ITS OWN LAYER (2026-07-27): tiles render in DOM order, so a later
  tile's OPAQUE PATCH FILL used to decapitate any canopy overhanging the seam.
  Standing objects therefore render via `tileScatterSvg` on a third
  `<TileGround layer="scatter">` at z-index 1 — above every patch (z0), below
  rails (z2); a road (z1, later DOM in its own cell) still paints over its own
  cell's scenery. Ground layer keeps only patch+rim+marks. Placement tests
  parse EVERY layer (ground + scatter + structures).
- **BUILDINGS ARE NOT SCATTER** (2026-08-21): what people BUILT renders on its
  own `<TileGround layer="structures">` (`tileStructuresSvg`) at **z7**, above
  the walkers AND the cars (both z6); scenery — trees, bushes, boulders, ridges
  — stays `scatter` at z1. Reported as "people walk over the houses": a
  citizen's first leg is the STUB from their own front door to the kerb
  (`sim/pedestrians.ts`), which crosses the plot the house stands on, so at z1
  the figure slid across the roof. Only urban/industry emit structures; a tile's
  art is one `GroundArt` = {ground, scatter, structures, canopy} out of one
  cached build, so the split costs no extra placement pass.
    · Lifting a roof over the TRAFFIC is safe for the same reason the canopy
      layer is: placement already keeps every footprint off the rails and roads
      of its own cell AND its four side-neighbours (`corridorsFor`), and each
      placed building pushes its own footprint on as a blocker. A roof can
      therefore never cover a car, a train or a carriageway — verified on
      `/test/townscape` (level crossing, booms, cars, a consist: none clipped).
    · Same z as `.tile-canopy`, mounted BEFORE it in all three boards (Play,
      Editor, TestStage), so within a cell a crown still overhangs the roof.
      Across cells DOM order decides — only visible where a forest tile's
      overhanging crown reaches onto an urban tile drawn later.
    · The two things that had to come UP with it: PlayView's `.build-overlay`
      (z5 → z8, or a preview rail drawn through a plot vanished under a roof)
      and the station NAMEPLATE + latent hint (z5 → z9, because…)
    · …**the station building is a building too** — `.station-building` went
      z3 → z7 for the identical reason: it stands in the strip between the outer
      platform and the tile edge, which is exactly the ground a passenger walks
      to reach the halt. It is laid clear of the rails (`utils/stationArt.ts`),
      so nothing that moves is hidden by the lift.
    · /test scenario: `citizenhouse`. To PROVE it, don't wait for a lucky frame:
      poll `__game.pedestrians` for one inside a plot's px band, set
      `paused.value = true` in the SAME evaluate, then shoot the frame twice —
      once as-is and once with `.tile-structures{z-index:1}` injected. Same
      walker, same pixel, only the layer.
- GLADES (2026-07-27): forest trees are rejected where `forestDensityAt` — 
  value noise over a 3-tile WORLD lattice, world-seeded so a clearing never
  traces the grid — runs low; just-over-the-bar rolls keep a low `bush()`, so
  lighter growth rims each clearing. TUNE AGAINST THE FIELD'S DISTRIBUTION:
  bilinear noise concentrates around 0.5 (it averages four uniforms), so a
  "full wood" bar at 0.52 rejected half the map; 0.38/0.24 gives ~3/4 full
  wood, ~1/6 shoulder, ~1/10 clearing.
- KEEP-OUT CORRIDORS (2026-07-27): scatter placement keeps each object's
  footprint off every rail/road through the cell AND its four side-neighbours
  (`cellCorridors`/`corridorsFor` in tiles/terrain.ts; centrelines from
  `segmentPoints` in sim/pathGeometry — same quad the trains drive, ONE
  derivation). An object re-rolls up to 8 spots then is DROPPED (the wood thins
  along the line — that's the cleared right-of-way, not a bug); ground marks
  drop without retry. Corridors are part of the terrain cache key: building
  through a tile reflows its scatter. FOREST exception: a trunk ≥ TRUNK_CLEAR
  off the ballast whose crown overlaps the line renders on the CANOPY layer
  (`tileCanopySvg`, second `<TileGround layer="canopy">` per cell, z-index 7 —
  above wagons z3/loco z4 AND road cars z6, below the crossing wrapper z15) so
  trains and cars pass UNDER the foliage. /test scenario: `clearing`.
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
  and rails (2), so scenery never covers track. TWO EXCEPTIONS, both deliberate:
  a tunnel cell renders its ground/scatter a SECOND time above the trains,
  clipped to the tile, as the bore's roof (see TUNNELS); and the `structures`
  layer (z7) draws the town's buildings above the traffic (see BUILDINGS ARE NOT
  SCATTER). Neither can cover track — a bore's roof IS the tile, and a building
  is placed clear of every corridor.
- BACKDROP TREES ARE CANOPY TOO (2026-08-21): the meadow theme's seeded tree
  scatter is NOT a CSS background any more — it was `--meadow-trees` under the
  board, which put every crown BEHIND the rails/trains/cars laid over it. It is
  one `<BackdropTrees>` world overlay per view (Play/Editor/TestStage, inside
  `.level`, absolutely positioned, z7 like `.tile-canopy`), same seed + 680px
  pattern as before (`meadowTreeLayout` in utils/meadowBackdrop.ts). A tree
  whose BASE cell is swallowed — non-grass terrain, `parking`, a `role` plot —
  is dropped (`backdropTreeHiddenBy`), and the forest's right-of-way rule
  applies too: a trunk within TRUNK_CLEAR of a rail/road corridor (own cell +
  4 side-neighbours, `backdropCorridorsAt`/`backdropTreeFelledBy`) is felled,
  while one beside the line keeps its crown OVER the traffic. /test scenario:
  `backdroptrees`. TestStage never had backdrop trees before; now the 🌳 BG
  toggle governs them like the rest of the theme.

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

## BUILDING UNDER A STRANDED TRAIN (2026-07-27)
- The old rule was "no edit on any tile a train occupies or has reserved",
  because a segment caches the exit it committed to and reservations name tiles
  by id. ONE exception now: a train that has RUN OUT OF TRACK has committed to
  no exit at all, so laying the rail it is waiting for contradicts nothing.
- `sim.strandedOn(tileId)` = trains whose HEAD sits there and whose live
  `traverse` gives no next (and is not a depot Center — that is docking, not
  stuck). Asks the LEVEL, not the cached exit, because the cache is the thing
  the rescue is about to change. A train held at a RED SIGNAL has somewhere to
  go and is therefore NOT stranded — it still blocks.
- A tile is editable iff EVERY train claiming it (occupancy OR reservation) is
  stranded on it. A train whose TAIL lies there still blocks: the segment under
  its wagons carries a committed exit. Note a stranded train reserves its own
  body tiles, so the reservation check has to be per-train, not a bare truthy test.
- After the edit, `sim.releaseStranded(id)` re-derives the head's exit — and
  ONLY when it is still null. Without it the train moves off while still being
  DRAWN along the stub it dead-ended on; rewriting a committed exit would
  teleport the body onto a different curve.
- WHY IT MATTERS: `lakevalley-open` reaches this state honestly. Buy the 5-piece
  ring and skip the station entry and 2,5 is [N,E] — the train leaving the
  yellow depot enters from the SOUTH, finds no partner, and strands directly
  above its own station. The depot sprite underneath makes it look docked, so it
  gets reported as "the train went into the depot but did not count". The rescue
  is 2,5's missing link, i.e. the tile the train is standing on. E2e:
  "a train that ran out of track can be rescued from the tile it is stuck on".

## GENERATED TERRAIN (2026-07-27)
- `generateTerrain.ts paintTerrain` gives procgen + Daily boards their ground.
  Painted LAST, and ONLY into coordinates absent from the level — that one guard
  IS the safety property: `validateLevel`'s single terrain branch requires
  `connections.length > 0 || road.length > 0`, so a painted cell provably cannot
  raise an issue nor silence one. Pinned by a test comparing the validator's
  verdict with and without terrain across 30 seeds.
- ITS OWN RNG STREAM (`makeRng(seed ^ 0x7e44a1)`). One extra draw from the
  generator's `rand` would re-roll the depot shuffle for EVERY seed that already
  exists — Daily's fixed seed would silently produce a different map. Guarded by
  a test asserting the topology of seeds 1..30 is byte-identical with terrain on
  and off (comparing `terrain:false` against itself would be tautological).
- THE INTERIOR IS NOT EMPTY. The loop is a rectangle inset by 1, so the lake goes
  inside it with no routing risk — but the generator also places DEPOTS in there,
  so depot cells and their four neighbours are excluded from the water pool on
  BOTH sides of the ring, not only in the margin. A depot walled in by water is
  legal and unextendable, which reads as a bug rather than as terrain.
- A LAKE NEEDS A RING WITH AN INSIDE. 7x6 (what Daily generates) encloses ~6
  cells, most of them depot-adjacent, and correctly comes out with no water at
  all; 10x8 has room. Both pinned, so neither reads as a regression later.
- Unbuildable margin is CAPPED (22%): `planRoute` refuses water/rock/mountain, so
  an over-stony map is one the random-map button cannot draw on.
- Grass is never emitted (it is stored as ABSENT), and every cell gets a FRESH
  literal — a shared one would let one in-play edit mutate the whole lake.
- Bounds grow: a generated board now renders its full width x height, because
  terrain-only cells count toward `levelBounds`. Intended.

## SURVEYED VS ORGANIC EDGES (2026-07-28)
- NOT EVERY GROUND HAS AN ORGANIC EDGE. A lake, a wood, a rock field are shaped
  by water and weather — bowed shores, rounded corners, which is what all the
  patch machinery was built for. FIELDS, TOWNS AND WORKS are shaped by people:
  surveyed, fenced, built to lines. Drawn as blobs, farmland reads as a lake of
  wheat, which is exactly the complaint that prompted this.
- `EDGE_STYLE`/`edgeStyleOf`: farmland + urban + industry = "surveyed", the rest
  "organic". The two styles share EVERYTHING except two decisions:
  · `corners()` returns the bare jittered lattice point (no mid-shore push, no
    corner inset) — that inset is what makes a blob a blob.
  · `patchSegments()` puts both control points ON the chord at the thirds, so
    the cubic IS a straight line. Still a cubic, so the rim, the outline polygon
    and the fringe all keep working unchanged — the shape of the DATA didn't.
- THE JITTER STAYS, and that is the point: lattice offsets are SHARED between the
  tiles meeting at a point, so a surveyed boundary is a polyline through points
  both tiles agree on — a straight run with a slight kink every tile. A hedgerow,
  not a ruler. Pinned: two surveyed tiles' shared corners coincide exactly.
- Surveyed coverage is ~0.85-0.92 of the tile vs organic ~0.55-0.85. Do NOT
  expect 1.0 and do not remove the jitter to get it — that is what would draw
  the grid back on.
- FIELD BOUNDARIES: `fieldBoundaries` draws a hedge along a tile edge where the
  NEIGHBOUR's `fieldPlanAt` differs (compared on the drawn properties, so two
  cells that rolled the same crop count as one field and get no hedge). Seeded
  CANONICALLY on the edge's two lattice points, so both tiles generate the
  identical chain of blobs and it does not matter that both draw it — seed it
  per tile and every hedge in the world doubles up.

## THE SOFT FRINGE (2026-07-28)
- Every patch used to end at a hard line, so a wood read as a sticker laid on
  the meadow however good its outline was. `buildGround` now lays TWO
  translucent strokes of the patch's own colour along `patchRimPath` (the
  STOPPING edges only) BEFORE the fill: wide+faint (30/0.15) then narrow+stronger
  (15/0.3), 18/9 for surveyed kinds because a field ends at a hedge.
- BEFORE the fill and NOT CLIPPED. The opaque fill covers the inward half, so
  what shows is an outward halo fading into the neighbour. Clip it and the fade
  lands entirely under the fill, i.e. nothing. Both sides of a boundary lay one,
  so the blend reads the same whichever tile the DOM draws second.
- Stopping edges ONLY. Fringing the internal joins draws a dark seam down every
  shared boundary — the same defect `patchRimPath` exists to avoid. Pinned: an
  interior tile emits no stroke at all.
- Two strokes rather than an SVG filter: at ~280 tiles a board a feGaussianBlur
  per tile is not worth it, and a two-step falloff reads as a gradient anyway.
## STATIONS (phase 1 — the dwell, 2026-08-01)
- A station is `role: "station"` on THROUGH-track (≥1 edge↔edge pair, no Center
  stub — `validateLevel` flags the rest as `invalid-station`). Same connections
  as a straight; `expandKind("station", rot)` authors one; `toggleStation`
  (editOps) is the editor verb and hands back the SAME cell reference on a
  refusal, so callers can tell "no-op" from "changed".
- A station IS a block boundary (`isBoundary`), exactly like a signal: the
  approach reserves only up to the platform. (A train DRAWN UP at one does hold
  the block past it — its loco is physically out there; see below.)
- Dwell-once-per-pass is tracked by PATH INDEX (`dwelledAtIndex`), never tile
  id — a revisit is a higher index, so the train stops again (the bounce test
  proves 2 dwells). `bounceOutOfDepot` resets the path to index 0 and must
  reset the marker with it.
- `assessGridlock` skips `"dwelling"` like parked/waiting, or scheduled stops
  read as a dead board.
- `/test/station` is the isolation scenario; sim behaviour in
  `tests/unit/sim/station.spec.ts`, tile rules in `tests/unit/tiles/station.spec.ts`.

## DRAWING UP AT THE PLATFORM (2026-08-04) — a train is longer than its halt
- A platform is ONE TILE. A loco and a people wagon are 100 px each on a 200 px
  tile, so loco + 2 carriages = 1.54 tiles: nothing puts the whole train beside
  the slab. The alignment is therefore on the CARRIAGES —
  `platformStopDistance()` centres the block from the nose of unit 1 to the tail
  of the last unit on `PLATFORM_CENTRE_PROGRESS` (0.5), which draws the loco
  clear of the far end. A lone loco has no carriages, so its own body is the
  block and it stops centred (the old behaviour, for that case only).
- CONSEQUENCE: the stop line is usually PAST the station tile — for the standard
  2-carriage train the head comes to rest ~0.53 into the NEXT tile. So the head
  is not on the station when the train is standing at it. Anything that asked
  "is the head on an unserved station?" is wrong; `pendingPlatformStop()` scans
  BACK over the last `ceil(reach)+1` path segments instead and returns
  `{index, remaining}`. The `departed` event must report `path[dwelledAtIndex]`,
  not the head tile.
- `clearDistanceAhead(train, stop)` takes that pending stop as a CAP, not an
  answer: drawing up crosses a tile boundary, so the run is still cleared tile by
  tile (mayCross/occupancy). A blocked approach holds the train short of the
  platform, which is correct.
- Because the loco crosses onto the next tile to draw up, a dwelling train DOES
  reserve the block beyond the station. That is honest (it is standing there),
  but it costs a little throughput versus the old in-tile stop.
- FALLBACK, and it is load-bearing: if the train is brought to a stand short of
  the line and cannot go on (buffers, red signal, train ahead) it dwells where it
  stands, provided it has reached `MIN_PLATFORM_REACH` (the platform centre).
  Without it a terminus platform — stop line past the end of the metals — is a
  station no service ever calls at, and the line cursor never advances: deadlock.
- `advance()` order matters: move → `crossBoundaries()` → dwell check. The dwell
  used to run before the boundary walk; with the head now landing on a later
  segment it must run after, and must re-check `trains[id]` + `state` because a
  depot in that walk can park, bounce or RETIRE the train mid-tick.
- Platform slabs are drawn edge to edge (`margin = 0` in `Tile.vue`): the
  2-carriage block is 204 px, a shade longer than the tile, so an inset slab left
  the ends of the train off the platform. Two station tiles side by side also
  read as one long platform this way (they are still two separate stops).
- Trains ordered into service are built with `SERVICE_TRAIN_WAGONS = 2`
  (game.ts). Three overhung the platform at both ends. Raise it only alongside
  real multi-tile platforms.
- `/test/platformstop` is the isolation scenario (six-tile ring so the stop comes
  round every few seconds).

## STATION PASSENGERS (phase 2 — queues & boarding, 2026-08-01)
- Demand is a SCHEDULE handed to the sim (`SimConfig.stationDemand`: interval /
  max / initial per tile id), never derived inside it — the sim executes, the
  mode layer (later the terrain catchment) decides rates. No RNG anywhere.
- The schedule is SNAPSHOTTED at sim creation: a station built mid-run dwells
  trains but queues nobody until reset. game.ts currently hands every station
  a default (1 pax / 5 s, max 10, 2 initial).
- A full platform PAUSES the spawn clock (holds at max) — it does not bank a
  backlog that floods the next train.
- One-hop model (typeless): whoever is aboard alights at the NEXT call, then
  the queue boards into the free seats. Matched depot arrivals end rides too
  (`ArrivedEvent.alighted?`, absent when 0 so old fixtures compare equal); a
  BOUNCE keeps riders aboard.
- Capacity default: `PASSENGERS_PER_WAGON` (6) × wagons for "people", 0 for
  "fraight" — a goods train calls but boards nobody. Boarding stretches the
  dwell by `BOARDING_SEC_PER_PASSENGER` each.
- Scoring: `Counters.passengersDelivered` fed by per-tick deltas assembled from
  dwell/arrived events in game.ts `handleEvents` — same pattern as deliveries.
- Crowd render: `game.stationQueues` is a reactive per-frame mirror (like
  `occupied`); Tile.vue draws ≤12 dots at fixed pitch along the first slab.
  The editor's stubGame must carry the field (empty), like parkingOccupancy.

## STATION CATCHMENT (phase 3 — terrain sets the demand, 2026-08-01)
- `tiles/catchment.ts`: `stationCatchment` counts urban/industry tiles within
  `WALK_RADIUS_TILES` (2, Chebyshev); `stationDemandOf` maps the urban count
  to the sim's demand schedule — monotone in every field, so "build nearer
  the houses" is always right and never a cliff. Lonely halt still trickles.
- DERIVED, NEVER STORED (the industry-doc rule): repainting the town re-prices
  the station on next reset; no editable demand field exists to drift.
- It lives in tiles/ (map reading), game.ts calls it when building the sim's
  `stationDemand` — the sim stays terrain-blind and just executes.
- Debug overlay: a dashed catchment ring per station (`.station-catchment`,
  radius (2R+1)/2 tiles); needs `overflow: visible` on `.station-layer`.
- `/test/catchment`: town station vs lonely halt on one line — the one
  side-by-side that shows the rule; `tests/unit/tiles/catchment.spec.ts`.

## THE LINE VIEW — names, call order, the route on the metals (2026-08-03)
- `tiles/stationNames.ts`: a platform has a NAME (`TileCell.stationName`), and
  a board that authored none gets a stable LETTER in reading order. A line has
  to read as places — "Nordstadt → Ostmarkt" — or the panel is a list of
  coordinates nobody can match to the board.
- The name is an HTML plate, NOT SVG text: a fixed shield cannot size itself to
  a word, and the first cut crushed "Nordstadt" into 18px.
- `game.lineOverlay` (set via `setLineOverlay({lineId} | {trainId} | null)`) is
  what the board draws while a line is edited: a big call-order badge per stop,
  a hollow "+" on the stops you could still add, and the route along the
  metals. It is ENGINE work — the route is planned with the same
  `planRailRoute` the trains drive, so the picture cannot disagree with them.
- IT DIED SILENTLY FOR FOUR WEEKS (found 2026-08-20). `Tile.vue` gated the badge
  and the route on `overlay.trainId`, from when a line was edited from a TRAIN's
  row; D11 made the LINE the thing you edit and `setLineOverlay({lineId})`
  leaves `trainId` null — so nothing drew at all, on any line, and no test
  noticed because the overlay's DATA was still correct. Gate a view on "is the
  overlay open", never on which door opened it.
- The hollow "+" is an OFFER, so it only appears on a stop the open line could
  actually take (`overlay.kind`); a stop already on the line keeps its number
  regardless, because that is a fact rather than an invitation.
- The badge is its OWN svg layer, not a group inside the station layer: a bus
  stop is a stop too (#90), and that layer only renders for a platform.
- The overlay stores the SEGMENTS driven per tile (`[entry, exit][]`), never
  just tile ids: on a junction, tile-level lighting paints every arm — the
  depot spur included — and the drawn line then shows a route the train never
  takes. That was visible on the first screenshot and is now a test.
- Route colour is deliberately FIXED amber, not the train's livery: only one
  line is drawn at a time and "grey" is a legitimate livery that made the route
  invisible against the ballast.
- REACTIVITY TRAP, hit again: the panel read `sim.trainNextStop`/`isRetiring`
  directly. The sim is `markRaw`, so Vue never re-ran those getters and the
  "next stop" pip froze on whatever it showed first. Anything the view watches
  must come from a reactive mirror refreshed in the frame loop
  (`trainNextStops`, `retiringTrains`), never from the sim.

## THE ROSTER AND THE SHED — buying and routing trains (2026-08-04)
Three bugs, one shape: the panel's whole verb set assumed a train is either in
the sim or does not exist. A train ORDERED INTO A BUSY SHED is neither.
- `trainColors` is `reactive()` and a COPY. Its key set IS the roster — the
  service panel's rows are a computed over `Object.keys(game.trainColors)` —
  and `game` is markRaw, so a plain record gave that computed nothing to track:
  it cached its first answer and a bought train NEVER appeared. On a board that
  starts with no trains the list stayed empty for ever. REACTIVITY TRAP, third
  time; the rule is now "every view source on the game is `reactive()`", and
  `tests/unit/modes/network.spec.ts` asserts it through a real `computed` —
  reading `game.trainColors` directly passes while the panel is frozen.
  The copy matters too: `buyTrain` writes into this record, and `colors` may be
  a scenario's shared object, so proxying the original leaked bought trains
  from one run into the next.
- A QUEUED train has a def, a livery and DOM, but no sim entry. So `setLine`
  tests `defById`, not `sim.trains`, for "does this train exist", and only
  calls `sim.assignLine` for one actually on the metals. Before this, every
  station click on a freshly-bought train was refused SILENTLY — and buying
  into a busy shed is the normal case, not the edge one.
- `syncLine` reads the sim for a running train and `def.line` for a queued one;
  `buyTrain` syncs in BOTH branches, not just the inject one. Otherwise a train
  ordered onto a line reads "no line" until it rolls out, which is exactly what
  "your click did nothing" looks like. `trainInit` carries `def.line` over when
  it finally leaves, so the definition is the honest owner until then.
- Verifying this in a browser: a hidden automation tab pauses rAF, so a queued
  train never rolls out there. Assert the roll-out in a unit test and use the
  browser only for the panel's DOM.

## STATION ARCHITECTURE — the building and its sign (2026-08-04)
- `utils/stationArt.ts` draws the platform's BUILDING, the sister module to
  `trainArt.ts`'s depot shed. Two sizes, `stationSizeFor(urban)`: ≥3 town tiles
  in walking reach → Empfangsgebäude, else a halt shelter. DERIVED from
  `stationCatchment`, never a field — same rule as the demand schedule, so
  painting houses beside a halt promotes it on the next render.
- The art's frame is x ALONG the platform, y AWAY from the track (y=0 street
  side). `Tile.vue`'s `stationStrip`/`stationBuilding` drop it on the outer
  strip with ONE transform about its top-left (`transform-origin: 0 0`):
  unrotated for a left-right station, `rotate(-90deg)` for a top-bottom one.
  `stationAxis` returns null for any other shape → no building, and the tile
  degrades to plate + slabs rather than breaking.
- The CSS box and `STATION_ART_BOX` are the same fractions of a 200px tile, and
  MUST move together: the `<svg>` has the default `preserveAspectRatio`, so a
  mismatched aspect letterboxes the art instead of stretching it.
- The box reaches PAST the platform's inner edge (tileSize*0.22) on purpose —
  the canopy belongs OVER the platform. It stops at *0.26, clear of the crowd
  dots (which sit at the slab's mid-line ±5px), and is drawn last so anyone
  underneath shows through the glazing.
- WHAT MAKES IT READ, learned the expensive way: at 150x30px, LESS. A first cut
  with hipped roofs, a taller concourse block, roof lights and two chimneys read
  as three blue boxes in a row. What works is exactly what the town houses do —
  one body, one gabled roof split lit/shade, a hard SE drop shadow — plus the
  one railway note: a rafter-ribbed canopy on posts with a blue leading edge. A
  pale untinted canopy is essential; tinting it the roof's blue merged house and
  canopy into a single slab.
- The name plate is mounted ON the building (`stationPlateStyle`) instead of
  floating over the grass, and the serving-line colours moved INSIDE it as dots.
  The old blue "S" shield is gone: with a building there, a second glyph saying
  "this is a station" was three markers in three corners for one fact.
- `/test/stationhouse` is the scenario: town station (left-right), the same
  building quarter-turned (top-bottom), and a meadow halt. The halt needs a 5x5
  clear of every urban tile or it promotes itself and the map stops making its
  own point.

## THE SERVICE PANEL — buying trains, drawing lines (2026-08-02)
- The player's whole verb set in the network mode: `game.setLine(trainId,
  stops)` and `game.buyTrain(stops, depotId?)`, both on the GAME (not the
  view), so the loop is unit-testable headless.
- A depot is a QUEUE, not a gate: `buyTrain` never fails for want of room —
  what a busy shed delays is the DEPARTURE, not the purchase. An order made
  while the mouth is blocked goes on `pendingTrains`, and `releasePendingTrains`
  (called from the world step) rolls them out oldest-first as the tile clears.
  Only a board with NO depot returns null.
- A queued train is exactly the state a SCHEDULED train sits in: DOM and livery
  registered, no sim entry — `renderTrains` already hides those, so nothing new
  was needed to keep a train in the shed invisible.
- Two things must happen at ORDER time or the train is broken in a way that is
  hard to see: the renderer roster (`trainDefs`, `unitIds`, `trainColors`) AND
  the view's provided `trains` map (PlayView), which is what `<Train v-for>`
  iterates. Miss the second and the sim drives a train with no sprite at all —
  it happened, and only a browser check caught it.
- Line editing is a BOARD gesture: `editingTrainId` in PlayView, station tiles
  get `.level-tile--pickable`, and a click appends the stop or removes it if it
  is already there. Click order IS call order.
- `game.trainLines` (trainId → stops) and `game.stationLines` (stationId →
  liveries) are view copies of what the sim owns, refreshed on player action
  rather than per frame; the editor's stubGame must carry `stationLines` too.
- `ModeControls.switches` had never been read by anything until this mode
  needed it false. PlayView now honours it, and Tile.vue gained a separate
  `switchesVisible` prop: the EDITOR deliberately draws a read-only fan (a
  picture of the authored arm), but a mode where the train routes itself must
  not draw points at all — an un-clickable arrow is a control that lies.
- When checking occupancy from a TEST, ask `sim.occupiedBy()`, never
  `game.occupied`: the latter is the render mirror and is only refreshed inside
  the rAF frame, so it stays empty for ever headless.

## PASSENGERS WITH DESTINATIONS (2026-08-03)
- A queue is a LIST of destination tile ids now, not a count, and a train
  carries a `manifest` (one entry per rider) instead of a number. That is the
  whole change: everything else follows from it.
- BOARDING: a rider only gets on when the train's LINE calls at where they are
  going. Everyone else waits — which is the first time the SHAPE of a line
  matters, and the reason the mode is about planning rather than throughput.
  ALIGHTING: at their destination, not at the next stop.
- A train with NO line (every classic board) still takes anyone and sets them
  down at its next call — the old one-hop service, unchanged. Same for a
  RETIRING train: its riders are better off on a platform than in a shed.
- Destinations are drawn round-robin (a per-station cursor, never RNG) from the
  stations REACHABLE BY RAIL — `reachableStations` floods the track graph. A
  passenger for an island would be one nothing can ever clear, and the platform
  cap would turn that into a slow, unavoidable loss.
- Consequence worth knowing when authoring: on a board with ONE station nobody
  travels at all, because there is nowhere to ask for. Both intermodal boards
  (`parkandride`, `busfeeder`) needed a second platform for this reason.
- The crowd is drawn from `game.stationWaiting` (tileId → destinations) with a
  colour hashed from the destination id, so a queue nobody serves reads as one
  colour piling up. `stationQueue` still returns the count.
- The CITIZEN layer reaches a platform through the same door:
  `transit.enqueue(stationId, n)` is `addStationPassengers`, and it returns what
  it ACTUALLY queued — 0 means "platform full, keep waiting", which is how
  `boardOrWait` in `sim/citizens.ts` knows to keep the clock running. Since
  destinations came in, a station with nowhere reachable to go also returns 0,
  so a citizen board needs TWO platforms or its people wait forever and the town
  scores you for it (`threecities` has three). The two layers do not yet agree
  on WHERE a citizen wanted to go — the sim picks the destination round-robin,
  the citizen tracks their own — which is the seam the transfer work opens up.

## WITHDRAWING A TRAIN (2026-08-03)
- Two verbs, deliberately not one. `retireTrain` is a JOURNEY: the train drops
  its line, takes no new passengers (`boarded` is forced to 0 while retiring),
  routes to the NEAREST depot and leaves the sim on arrival — the depot-arrival
  branch checks `retiring` before any colour rule. `removeTrain` (scrap) is
  instant and unrealistic, which is why it is a separate call and, in the UI, a
  shift-click.
- `retireTrain` returns false when no depot is reachable; PlayView then scraps,
  so the button never appears to do nothing.
- A train still QUEUED in the shed has no journey to make: withdrawing it is
  cancelling the order, handled in game.ts before the sim is asked.
- Removal has to be undone in three places or something is left behind:
  `dropTrain` in the sim (roster + reservations + blockStates), `forgetTrain`
  in game.ts (trainDefs, unitIds, trainLines, the queues), and the BOARD, which
  reads `game.removedTrains` — the view cannot know when a retiring train
  finally arrives, so it filters on that list rather than being told.
- `step()` walks a snapshot of the roster, so a train that retires mid-tick
  leaves a stale id in it: both the advance and the reservation release guard
  on `trains[id]` still existing.

## ONE LEDGER: THE CITIZENS AND THE RAILWAY (9F, 2026-08-03)
- A citizen joins the REAL platform queue under their own id
  (`enqueuePassenger(tile, dest, tag)`) bound for the station THEY want, and
  learns what happened from `DwellEvent.boardedTags` / `alightedTags`. The
  shadow queue is gone, and with it the rider who kept a seat the rail sim had
  already freed.
- `TransitPort` is now `{enqueue(station, dest, tag): boolean, connects(a,b)}`.
  `connects` is the D10 gate in `optionsFor`: transit is not even OFFERED unless
  a service links the two ends.
- `railPairFor` picks the platform PAIR by connectivity, not "nearest at each
  end". A town between two railways has a nearest platform at each end that
  never meet — the old code offered that journey and it could not be made.
- `alightedAt` decides nothing any more: `stationId === trip.toStation` is an
  arrival, anything else is a change the SIM already re-queued, so the citizen
  layer must not queue them again.
- Two balance facts that fell out, both worth knowing before touching this:
  (1) a REFUSED trip now feeds the journey's own topic as well as `access`, and
  costs the person part of the day (`stuckUntil`) — without that, D10 turned a
  failed commute into a free afternoon of mood-restoring errands and the
  citizens mode quietly lost its teeth. (2) On `threecities` only EASTFIELD
  hollows out now; Westfield walks instead. What used to kill both towns was an
  artefact — choosing a service that was never there and failing at it daily.
- A lineless train no longer dumps its whole load at the next call. It carries
  each rider to the station they named (`off = final`), because a stopper calls
  everywhere it passes and can promise that. Only a RETIRING train dumps.

## A BUS IS PLANNED LIKE A TRAIN (#90, 2026-08-05)
- Draw a LINE, buy a bus, assign it. The line registry, the queues and the
  boarding exchange are the shared `sim/transit.ts` — only the MOVEMENT differs,
  and that stays with each sim (metals and interlocking vs lanes and junctions).
- The road sim gained a SERVICE vehicle: one that stays on the board when it
  arrives instead of ceasing to be traffic, plus `retarget(carId, toTile)` to
  send it on from where it stands. An ordinary `requestTrip` still removes the
  vehicle on arrival — the citizen got home — but a bus that vanished at every
  stop would be a different bus each leg.
- A bus is dispatched to its FIRST stop and works it before pulling away. It
  spawns there with its doors open; without the call, that stop is skipped once,
  at the start.
- A line is a CYCLE for a bus exactly as for a train (`% stops.length`): past
  the last stop it wraps to the first, and it runs for ever. There is no end of
  shift and no garage — a bus lives on its line.
- `pruneLineIfUnused` counts trains AND buses. Withdrawing the last train must
  not delete a line a bus is still working.
- A WITHDRAWN BUS SETS ITS RIDERS DOWN (`setDownAll`, 2026-08-20). `removeBus`
  and `assignBus(id, null)` used to drop the manifest with the vehicle: people
  the player was carrying, gone, with nothing in the count to explain it. It
  mirrors the retiring train's `dumpAll` and dumps at the stop under the bus,
  else the last one it worked (`lastStopId`). Reassigning to ANOTHER line dumps
  too — `off` was decided from the old line (D7), so those riders would be
  carried to a stop the bus no longer calls at, for ever.
- `retarget`'s BOOLEAN MUST BE ACTED ON (2026-08-20). It fails when the bus
  cannot be routed on from the lane it stands in. Ignoring it left the trip
  "arrived" with the dwell run out, so the next tick re-ran the exchange at the
  same kerb: the queue boarded again, and a call that never happened went in the
  log, every `BUS_DWELL_SEC`. Three responses, in order:
    · a TERMINUS turns round at the stop (despawn + respawn there, cursor left
      pointing at that stop). The router plans lane by lane with no U-turn, so a
      line that ends in a dead end otherwise drove off the map;
    · the respawn must NOT work the stop again (`turnedRoundAt`) — it was worked
      a moment ago, and the doors would open twice at a kerb the bus never left;
    · a stop that cannot be driven to AT ALL fails the respawn's `requestTrip`
      for ever, which leaves the bus off the board with people aboard. Logged
      once per stranded stop (`strandedFor`), never once per tick.
  `departing` marks "doors shut, still trying", so no path back into the dwell
  can re-open them.
- A LINE'S STOPS ARE THE PLAYER'S, and nothing stops them naming a tile nobody
  can wait at. Destinations are therefore drawn only from real stops
  (`nextDestination` filters on `isStop`) — the graph may carry the node, it is
  just not somewhere to ask for.
- A bus stop is `TileCell.parking` with a `busstop` row. TWO STOPS MUST NOT
  SHARE A `facility` ID: the parking layer treats one id as one facility, so
  they pool capacity and show a single sign — the first cut of `busrail` read
  "H 2/2" once instead of a halt at each end. Pinned by
  `busLine.spec.ts` → "makes two halts two facilities, not one pooled stop",
  which shows both halves: distinct ids give two one-stall facilities, a shared
  id gives one facility spanning both ends of the street.
- A LINE HAS A KIND (`LineView.kind`, 2026-08-20): `rail` from platforms, `road`
  from kerbs, `null` until its first stop. It must never MIX — no train can call
  at a kerb and no bus can drive to a platform, and a mixed line fails SILENTLY
  (the bus's `requestTrip` from a platform returns null for ever, so it simply
  never appears). D5's intermodal journey is TWO lines meeting at a walk link,
  never one line pretending to be both. The kind lives in `game.ts` and both the
  panel and the board read it; deriving it twice is how the two drift apart.
- THE MODEL SUPPORTING A THING IS NOT THE FEATURE (2026-08-20). #90 shipped with
  `createLine([kerb, kerb])` proved by tests, and NO WAY TO DO IT IN THE BROWSER:
  the line editor gated clicks on `role === "station"`, so bus stops were not
  pickable and the whole feature was unreachable by a player. A headless test
  calling the verb directly cannot see that. When a feature is a player ACTION,
  the check is doing it in the UI — `npm run dev` and a Playwright pass over the
  actual clicks, not just the game verb.

## THE COLOUR OF A WAITING PASSENGER (2026-08-20)
- A dot on a platform (or now a kerb) wears the COLOUR OF THE LINE it is waiting
  for — `game.stationWaitingColours`, aligned with `stationWaiting`. It used to
  be a hash of the DESTINATION, which told the player nothing they could act on:
  six colours collide over a board of destinations, and "four people want to go
  to the orange place" is not something you can build. The line they need is.
- `lineGraph.lineFrom(at, to)` is the primitive: which service they board next,
  by the same "strictly closer" rule `alightFor` uses for where to get OFF.
- A WALK IS NOT A SERVICE, and this is the rule that matters (found by the
  colours, 2026-08-20). Walk links sit in the graph as services calling at both
  ends — that is what makes a kerb and a platform one network — so a journey made
  ENTIRELY of walking counted as "reachable" and produced passengers: people
  queued at Ostbahnhof for a kerb two tiles away, waiting for a train that will
  never call at a road. They had no line to be coloured by, which is how they
  were spotted. Every demand gate now asks for a real RIDE (`firstRideFrom` in
  transit.ts steps over `walk:` ids).
  · A vehicle with NO line still counts as a ride. Where nobody has drawn
    anything the lineless vehicles ARE the network, and every board written
    before lines rests on that — 18 tests said so when the first cut demanded a
    drawn line. Such a passenger is drawn NEUTRAL: no line to blame for the wait.
- A bus stop draws its queue too (`busStopQueueSpots`). It never did: the crowd
  came off the platform slabs, which a kerb has none of, so a halt with six
  people looked identical to an empty one while the HUD counted them.
  · The dots stand PAST the stop, on the verge: a halt sits at the head of its
    tile, so a queue growing backwards ran off the tile's own edge at twelve
    people, and the sign chip (HTML, drawn over the tile, ~0.13 of a tile out)
    covered the front of the queue at anything less than 0.155 out.

## HOW FULL A VEHICLE IS (2026-08-20)
- `game.vehicleLoads[id] = {aboard, seats, colour}` — trains and buses in ONE
  book, so the gauge on the board and the "n/seats" in the panel cannot disagree.
- KEYED BY WHAT THE BOARD DRAWS IT UNDER: a train's own id, a bus's ROAD CAR id.
  A bus has two identities (`bus1` in the panel, `car7` on the tarmac) and
  `BusView.carId` is the join. `RoadCar` carries `vehicleId`/`unit` for the same
  reason — the rendered id is `<vehicleId>#<unit>`, and a gauge belongs to the
  vehicle, on its leading unit (a semi is two units, not two lorries).
- REFRESHED IN THE WORLD STEP, not the frame. It is a model fact; in `frame()`
  it froze in a hidden tab and was invisible to headless tests — the first cut
  did exactly that, with a comment claiming otherwise. The test caught it.
- The gauge is a LIGHT trough with a dark rim, not a dark one: it sits on a
  locomotive, which is dark grey, and a dark trough made an almost-empty train
  read as no gauge at all.
- Its fill is the LINE's colour, falling back to the vehicle's livery when it
  runs no line — a full bar is a complaint about a service, and it should point
  at the same colour the panel row and the platform pips use.
- No seats, no gauge: a freight train never carried anybody, and an empty gauge
  on it is noise.

## THE WALK BETWEEN A KERB AND A PLATFORM (D5, 2026-08-05)
- `walkLinksOf(level)` pairs every bus stop with the stations within
  `WALK_RADIUS_TILES`. The transit layer feeds them to the graph as services
  calling at both ends — nothing ever RUNS them, so they only decide what is
  reachable and where to change.
- A walk has to MOVE people, not merely connect them: when a rider changes at a
  stop, `walkOnward` asks whether the next hop is a walk and re-queues them at
  the FAR end. Left standing at the kerb they would wait for ever for a train
  that does not call at a road.
- Board geometry is therefore load-bearing. On `busrail` the interchange kerb is
  directly under the platform, one tile (inside the radius, so the network
  joins) and Altstadt is four from every platform (outside it, so the bus is the
  only way in). Move either and the board stops demonstrating anything.
- **A WALK IS A STEP OF A JOURNEY, NEVER A JOURNEY** (2026-08-20, review of
  #90). Three rules, and the first cut of the walk had only the middle one:
    · `nextDestination` never offers a stop ONE WALK LINK AWAY
      (`walkOnlyReach`). Nobody becomes a passenger to get somewhere they can
      walk to — and walking them there would have scored a delivery the player
      never earned. Measured on `busrail` as the gallery ships it: every SECOND
      Hauptbahnhof passenger was sent to the kerb outside, nothing could move
      them, the queue hit its cap — and `advanceDemand` stops generating AT the
      cap, so the platform died. After: 54/103/176 delivered per 300s window,
      the platforms peaking at 3 rather than pinned on their cap of 8.
    · Anyone WAITING whose next hop is a walk takes it (`walkWaiting`, run from
      `advanceDemand`). Only riders getting off a vehicle used to walk, which
      left a journey that BEGINS on foot unstartable: no vehicle boards them
      (their first hop is not a ride, and `alightFor`'s strictly-closer rule
      refuses them), so they stood there for ever.
    · A walk that ENDS at the rider's destination is a DELIVERY. Treating it as
      a change re-queued them at their own destination — a state `enqueue`
      itself forbids — so every Altstadt rider sat at Hauptbahnhof and rode one
      pointless extra lap before anybody counted them.
- A WALKER GOES PAST THE CAP, exactly like a CHANGE (D8). A cap is a limit on
  the SPAWNER, not on how many people may stand at a kerb, and holding walkers
  back recreates the very starvation this fixes: with the cap applied to them,
  `busrail`'s Hauptbahnhof sat at 8/8 for an entire run — its Altstadt-bound
  people could not walk to the full kerb, and a stop at its cap generates
  nobody. The cost is a kerb queue with no bound when the bus service is too
  thin to clear it; that is the SIGNAL (buy another bus), and kerbs do not feed
  the overcrowd fail predicate — `worstStationQueue` counts platforms only.
- ONE WALK LINK IS ONE WALK. `walkOnlyReach` is the direct neighbours, never a
  transitive closure: `walkLinksOf` pairs a kerb with the platform beside it and
  says nothing about two platforms that happen to share a kerb. Chaining them
  made all of `busrail`'s railway "walkable", every station dropped out of every
  pool, and the board delivered NOBODY — 0 in 400s. Caught only because the
  board changed under the fix mid-review; on the old straight-street board no
  two stations shared a kerb, so nothing showed it.
- The invariant to hold on to: NO PASSENGER IS EVER CREATED THAT NO MECHANISM
  CAN MOVE. Every hop of every offered journey is either a ride (a line, or a
  stopper) or a walk, and both now have something that performs them.

## THE TRANSIT LAYER — ONE FOR BOTH SIMS (2026-08-05)
- `sim/transit.ts` owns the LINE registry, the line-graph memo, the QUEUES, the
  spawn demand and the boarding EXCHANGE. All of it used to be private to
  `createSimulation`, which was fine while "vehicle that carries passengers"
  meant a train. A bus is planned the same way (#90) and a bus-then-train
  journey is ONE journey — two copies would be the shadow-queue mistake again.
- `createSimulation` takes an optional `transit`; without one it makes its own,
  so every unit test and every road-less board is unchanged. `game.ts` will make
  one and hand it to both sims.
- The layer never learns what a stop IS. `isStop` is injected, and each sim
  contributes its unassigned vehicles through `setStoppers(source, fn)` — keyed
  by source, so rail and road contribute independently and neither can clobber
  the other.
- A matched DEPOT arrival is NOT an exchange. "Everyone home" ends every ride
  aboard and counts them all, whatever they asked for; routing it through
  `exchange` read them as CHANGING at a depot and re-queued them somewhere no
  service will ever call — 3 delivered became 0. It calls `transit.deliver(n)`.
- `exchange` MUTATES the manifest array it is given (the caller owns it) and
  returns the counts a dwell event reports. Boarding asks the NETWORK, never a
  single line's stop list.

## CHANGING TRAINS (phase 9, 2026-08-03)
- `sim/lineGraph.ts` is a SECOND router and answers a different question from
  `railRouter`: not "can a train physically get there" but "can a PASSENGER get
  there on the services that exist". Stations are nodes; two are adjacent when
  some line calls at both. BFS depth = number of RIDES, so depth-1 = changes.
- `alightFor(lineId, at, to)`: the destination when the line goes there, else
  the stop on it that leaves the shortest onward journey. The candidate must be
  **strictly** closer than staying put — with `<=` a triangle of lines hands a
  rider round for ever. A line is treated as a CYCLE, so direction never matters.
- The hop is decided at BOARDING (`offFor`) and never stored on a waiting
  passenger. That is what makes redrawing a line mid-run safe: there is no plan
  to go stale, the next boarding just re-decides.
- A `Rider` is `{final, off}`. At `off`: `final === off` is a DELIVERY, anything
  else is a CHANGE — back onto the platform, at the FRONT and **past the cap**.
  Refusing a change would delete someone mid-journey, invisibly.
- A LINELESS train keeps the exact one-hop service: everyone down at the next
  call, all counted delivered. Deliberate — making them change instead would
  re-queue and re-board the whole load at every platform, inflating dwell times
  and the balance of every board written before lines existed.
- `DwellEvent.changing` is how a score tells the two apart: arrivals are
  `alighted - changing`.

## NOBODY WALKS TO A STATION THAT CANNOT TAKE THEM (D10, 2026-08-03)
- A passenger's destination is drawn from `lineNetwork().reachableFrom(here)` —
  what a SERVICE reaches, not what the metals reach. Phase 8 used the metals, so
  people queued for journeys nothing could make, stood there for ever and drove
  the overcrowd predicate: a punishment for demand the player was never given the
  chance to serve.
- The payoff: a platform queue now means ONE thing, and a fixable one — the
  service is too thin. It used to mix that with "no service goes there", which
  nothing the queue itself suggests could fix.
- A train with NO line counts as a synthetic line over `reachableStations` from
  where it stands: a stopper calls everywhere it passes, so it IS the network on
  a board where nobody has drawn anything. Without that, every classic board and
  half the specs would spawn nobody. It affects the GRAPH only — boarding and
  alighting for a lineless train are untouched.
- Consequence for specs: `trains: []` + `stationDemand` now yields an EMPTY
  platform. Several phase-2 tests needed a train adding for that reason. If a
  queue you expect is empty, ask what service was supposed to serve it.
- Initial queues are seeded AFTER the roster is built (`seedInitialQueues`) —
  at construction time there are no trains and no lines, so nothing is served
  and nobody would ever appear.
- `enqueuePassenger(tile, dest, tag?)` queues ONE person with a known
  destination, for a caller that has already decided (a citizen, a test).
  `addStationPassengers` stays the anonymous-demand verb and still returns what
  it actually queued.
- LATENT DEMAND (`game.stationLatent`, the amber "N/min — no service" plate) is
  the other half of D10: an unserved platform is empty, so something has to say
  which places are still asking. Refreshed in `syncLines()`, NOT per frame — it
  changes exactly when the services do, and a per-frame mirror is invisible to a
  headless test. Never in a fail predicate.
- It takes BOTH to leave a platform unserved, and each half is a rule:
  scrapping the train is not enough (the LINE stands without it — D11), and
  deleting the line is not enough (the train falls back to a stopper, which
  calls everywhere it passes). A test that expects an unserved platform must do
  both — two attempts at this one got it wrong.
- Every mutation of the line registry MUST `touchLines()`; the graph is cached
  behind it. `deleteLine` was missed and the graph went on serving a line that
  no longer existed.

## A LINE IS AN OBJECT, NOT A FIELD ON A TRAIN (D11, 2026-08-03)
- `SimLine {id, name, stops, pinned?}` in a registry; `SimTrain.lineId` points
  at one. `stopsOf(train)` is the only reader — never reach for a train's stops
  directly. Before this the stops hung off the train, so "a service is planned
  here" and "a vehicle is running it" were ONE fact: you could not draw a line
  before buying a train, and withdrawing the last train silently deleted the
  service every waiting passenger had planned around.
- Trains are ASSIGNED (`assignTrain`), many to a line or none. A trainless line
  is legitimate and is the state a player is in until they buy something.
  `retireTrain` drops the train's `lineId`, never the line.
- `pinned` is the difference between the two ways a line is born.
  `createLine` = the player drew it: kept for ever, empty or not.
  `assignLine(trainId, stops)` = train-centric sugar (and how authored
  `init.line` boards load): it finds-or-creates by stop list, so two trains with
  the same stops land on the SAME line, and the line is swept up (`pruneLine`)
  when its last train leaves. Without that distinction every line edit would
  litter the registry with orphans.
- `setLineStops` restarts every train on the line (`restartOnLine`): an index
  into a list that just changed length means nothing.
- The COLOUR belongs to the line, not to a train's livery — `stationLines` (what
  a platform shows) is derived from lines, so an unserved line still announces
  itself, and two trains on one line cannot paint it two colours.
- `lineOverlay` takes `{lineId}` or `{trainId}`; a line is drawable with nothing
  running it. PlayView edits `editingLineId`, not a train.

## LINES — A TRAIN THAT DRIVES ITSELF (2026-08-02)
- `sim/railRouter.ts` `planRailRoute()`: BFS over `(tile, entryPort)` — the same
  graph the editor's `tiles/routePlanner.ts` searches, the same output shape the
  road layer has had all along (`roadRouter`: plan, then follow per-junction
  decisions). Every edge is one tile, so BFS *is* the shortest path.
- The plan reaches the sim through the EXISTING `SwitchResolver` seam:
  `switchOf(train)` translates the plan's exit PORT into the arm that produces
  it (`armForExit`), so `traverse`/`resolveExitPort` are untouched and every
  rule (reservation, occupancy, signals, stop lines) applies unchanged. A train
  with no plan returns the global resolver — byte-for-byte the old behaviour.
- Plans are PER LEG, recomputed at every call and after every depot turn-back.
  That is what keeps `exitAt` unambiguous (a shortest path never repeats a
  `(tile, entry)` node) and what makes track laid mid-run usable next leg.
- A train IN SERVICE never terminates at a depot, whatever the colours say —
  `matched` is gated on `!stopsOf(train)?.length`. Depots are where trains are
  ordered and stabled; on a line they are turn-backs, not destinations.
- Two line shapes, and the difference matters when authoring:
  **a ring** needs no turn-back, so the board needs exactly ONE depot and each
  station comes round once a lap; **a there-and-back shuttle** can only reverse
  at a depot, so it needs one at each end. Both are covered by tests.
- THE ORDER IS THE CONTRACT (2026-08-21, the Transport-Fever rule): a lined
  train calls ONLY at the stop it is currently bound for and runs past every
  other platform — its own line's included — and the cursor simply steps +1 on
  each call. The old rule (call at ANY of the line's stops when passing,
  cursor re-derived by `indexOf`) broke two ways at once: on a ring, a stop
  whose route led past the others was NEVER reached (every en-route platform
  hijacked the cursor — "the train never goes to A"), and a stop named twice
  on a line was swallowed (indexOf finds the first occurrence). NEVER
  reintroduce indexOf-based cursor recovery — the bus cursor in game.ts
  (`advanceBuses`) follows the identical rule, including the terminus
  turn-round stepping BACK by one instead of re-finding itself.
- A LINE MAY NAME A STOP TWICE — A→C→B→C is out via C, back via C, and since
  the strict order above it is also the ONLY way to serve an intermediate
  station in both directions of a shuttle (a train bound for A no longer calls
  at C just for standing on the way). Never twice in a ROW: `normalizeStops`
  (sim/transit.ts, the one door every stop list enters by — createLine AND
  setLineStops) collapses consecutive duplicates and the wrap-around pair
  (last → first is consecutive too, a line is a cycle). The line editor
  (PlayView `editLineAt`) APPENDS on click; clicking the LAST stop takes it
  back off (the undo gesture — a mid-list stop is removed by popping back to
  it). Overlay badges carry every call position ("2·4"), keyed per station.
  `/test/linerevisit` is the shape in isolation; pins in `lines.spec.ts`.
- Crowd peak ≈ arrival rate × LAP TIME, not capacity: a 24-seat train empties
  any of these platforms in one call, but a station only gets served once a
  lap. Size the towns against the lap, or the overflow fail fires on a board
  whose trains were never the problem.
- `sim.assignLine(id, stops)` is the verb an "assign train to line" UI calls;
  `[]` takes the train out of service. `railRing()` in `levels/test/scenario.ts`
  authors a loop; `mkLineTrain()` authors a train in service on one.

## NETWORK MODE (phase 5 — the passenger loop, 2026-08-01)
- Win = people carried (`ObjectiveSpec.passengersRequired`), loss = a platform
  over `fail.maxStationQueue` (against the `peakStationQueue` high-water
  counter). The win rule is "EVERY stated target met", so `deliveriesRequired:
  0` + a passenger target does not win at t=0 — and a board that never mentions
  passengers behaves exactly as before.
- The board's two depots deliberately MISMATCH the shuttle: a matched depot
  PARKS the train and the service dies after one trip, a mismatch bounces it
  back out. So the network mode's "mismatched arrivals" are turn-backs, not
  errors — which is why its third star is briskness, never `mismatchedArrivals
  === 0` (that star would punish the mechanic the mode runs on).
- Single track = ONE train. A second shuttle meets the first head-on and
  deadlocks; capacity is raised with WAGONS (seats), not with more trains,
  until a board authors a passing loop.
- `game.ts` reports `maxStationQueue` from the SIM each tick, never from the
  reactive render mirror — the mirror only updates inside the rAF frame, so a
  headless run would score an empty station forever.
- `npm run shot -- '#/play?mode=…' --start` clicks the Ready card so a mode can
  be photographed RUNNING instead of showing its briefing.

## STATION DEMAND IS TUNED AGAINST A TRAIN (2026-08-01)
- `stationDemandOf`'s rates only mean something next to what a shuttle can
  carry: at DEFAULT_SPEED a round trip is ~30-40s and a people wagon seats 6,
  so a busy station (6 town tiles) turns out one passenger every 4s. The
  phase-3 numbers were ~2.5x hotter and made the first network board
  unwinnable in 19 seconds — nothing revealed it until a mode consumed them.
- The no-town fallback (30s) must stay SLOWER than the one-house case (24s),
  or the middle of nowhere out-generates a hamlet and the "build nearer the
  houses" rule inverts at its first step. The monotonicity spec catches this —
  it caught exactly this during the retune.
- A platform's `max` exceeds the network mode's OVERCROWD_LIMIT only for a real
  town (5+ tiles in reach), so a quiet halt can never lose you a level by
  itself. Retuning either number without the other silently makes the overflow
  fail decorative (max ≤ limit) or unavoidable.

## PARK & RIDE (phase 4 — road feeds rail, 2026-08-01)
- `parkAndRideTargets(level)` (tiles/catchment.ts): tile id → nearest station
  within the walk radius, ties by distance then id — deterministic, computed
  once. When a stall goes free→taken, game.ts injects passengers at that
  station via `sim.addStationPassengers` (capped by the schedule `max`, else
  `STATION_QUEUE_HARD_CAP`; a full platform turns walkers away, returns 0).
- Transfer size comes from the ROW the stall belongs to (`rowFor` on the
  parsed stall id — stall ids lead with their tile id): a bus stop (kind
  "busstop" or `reserved: "bus"`) turns out a busload (4), anything else 1.
- The diff runs in `game.advance()` — the headless world step — NEVER in
  `updateParking` (the render mirror): model logic in a rAF callback is the
  hidden-tab trap, and `tests/unit/parkAndRide.spec.ts` (60 headless seconds,
  more passengers than the schedule can make) exists to keep it that way.
  `prevStalls` resets with the game or a retry double-transfers.
- `/test/parkandride` (kerb bays by the station) and `/test/busfeeder` (an
  in-lane halt: crowd jumps by busloads, cars queue behind the bus).

## CITIZENS & CITIES (the Transport-Fever mode, 2026-08-01)
- Split on the terrain-blindness line: `tiles/cities.ts` READS the map (plots,
  city clustering, road components, station reach) and hands the sim a
  `CitizenWorld`; `sim/citizens.ts` owns the people and never sees a TileCell.
  Enabled per MODE via `ModeSetup.citizens` — absent for every other mode, so
  nothing else on the board changes.
- **The map says WHERE, the sim says HOW MANY.** `terrain: urban|industry` is
  the zoning (level data); `density` + residents are live sim state. Growth
  fills plots, then upgrades density, then raises `wantsRoom` — there is no
  auto-sprawl onto grass.
- A city is a flood fill (8-neighbour) over plot ground; `TileCell.city` tags
  override it for towns that touch. A tile carrying rail/road/parking is NOT a
  plot — a street is not a house.
- **Driving needs one road NETWORK, not two roads.** `roadComponents()` gives
  each plot a component id and a car trip needs both ends to match. This is the
  lever the whole mode turns on: two towns with their own streets and nothing
  between them can only be linked by rail.
- **THREE NUMBERS DECIDE WHETHER A BOARD IS ABOUT TRANSPORT AT ALL**, and all
  three fail silently — the board just quietly becomes a walking simulator:
    1. `walkMaxTiles`. At 6 the reference board's nearest factory was EXACTLY 6
       tiles from the nearest house: rail carried 1% of journeys. The mode sets 4.
    2. Shop capacity [2,4,8,16] vs works [12,24,48,96]. Shops as big as factories
       meant everyone worked on their own street.
    3. Town spacing must EXCEED `walkMaxTiles`. The gaps on `threecities` are
       level design, not scenery.
  Check the mode-share bar first when a citizen board feels inert.
- **A citizen stays in their seat until their station comes up.** The rail sim's
  passengers ride one hop and are set down at the next call; mirroring that
  literally made a shuttle take 16 people aboard, run to the depot, bounce, and
  put all 16 back on the SAME platform as a 'transfer' — 83% of rail attempts
  abandoned on a working railway. Cost of the fix: a through-rider holds a seat
  the sim already freed (boarding is still capacity-gated, which is the part
  that must be true).
- **A bounce is not an arrival.** A colour-mismatched train emits
  `arrived{matched:false}` and reverses out WITH its riders. Only act on
  `matched` arrivals, or every passenger fails twice a lap.
- **The platform cap is not a difficulty dial.** With no `stationDemand` entry a
  station falls back to `STATION_QUEUE_HARD_CAP` (16), which a morning peak
  exceeds — and someone who cannot JOIN the queue waits until they give up. The
  citizen layer supplies an entry with `intervalSec: Infinity` (spawns nobody)
  and a generous `max` (a cap and nothing else).
- Citizens tick in `game.advance()` on the SAME `SimEvent[]` the railway just
  emitted — never in the render mirror. `tests/unit/citizenCommute.spec.ts`
  drives 1500 headless seconds and asserts the pair that IS the mode: trains
  running → 56% of journeys by rail, population 111→153; no trains → the two
  commuter towns halve while the walkable works town holds.
- `/test/threecities` (mode `citizens`), city cards in `CityPanel.vue`.
- **A DRIVING CITIZEN IS A CAR** (2026-08-02). `roadSim.requestTrip(fromTile,
  toTile)` dispatches a real vehicle, routed by `planRouteToGoals` (the same
  goal-directed BFS parking uses) and DESPAWNED on arrival instead of driving
  off the map. `Car.tripGoal` marks such a car; `settleRequestedTrips()` retires
  it at headProgress >= 0.5 on the goal tile. The citizen's driving leg then has
  NO clock — it ends when the car arrives, so congestion costs the commuter real
  time and real mood.
    · `requestTrip` returns null when it cannot dispatch, and the citizen falls
      back to the timer. A saturated road must slow people, never strand them.
    · Requested cars have their own cap (MAX_REQUESTED_CARS), separate from the
      ambient density slider — the slider is a scenery dial, commuters are not
      scenery.
    · `blankCar()` exists so a new `Car` field breaks all three construction
      sites at compile time. That is the point; do not relax it to a partial.
- **A CLOSED RING ROAD SPAWNS NOTHING.** `roadEntries` only finds an entry where
  a road OPENS (off-grid, or a stub with nothing beyond). A ring has neither, so
  ambient traffic cannot spawn — which is what makes `/test/citizencars` able to
  claim that every car on it is a citizen, and `roadRequestTrip.spec.ts` asserts
  the empty entry list directly. Reach for this whenever a scenario needs traffic
  it fully controls.
- **A STREET RUNS THROUGH A TOWN, not beside it.** Put the town's `terrain` on
  the road tiles: the keep-out corridors already step every roof back from a
  carriageway, so the built-up ground stays continuous and the ring of meadow
  between houses and tarmac disappears. Two predicates make this safe, and the
  difference between them IS the feature:
    · `isTownGround` — terrain only. What the city flood fill WALKS OVER, so a
      road laid through a town bridges its halves instead of severing them.
    · `isPlotGround` — town ground with nothing built across it. What holds
      PEOPLE. Nobody lives on the carriageway.
  Before the split, a street through a town read as two towns.
- **THE STREET PROFILE (2026-08-20).** `tiles/streetProfile.ts` is the single
  lateral truth of a street: per SEAM, per FLANK (the seam's two perpendicular
  ports), the ordered strips centreline→out: carriageway → kerbside parking →
  verge → pavement. Resolved at seams because seams are where two tiles must
  AGREE (symmetric by construction — that agreement IS the connectedness of
  every band); a tile's interior is linear interpolation between its two seam
  profiles, one taper rule for every layer at once.
    · CONSUMERS: pavement paint (`footway.ts bandsFor`) and walkers
      (`pavementOffsetEndsFor`) read `FlankProfile.pavement`; the surface paint
      reads `seamPaintLanes` (`Tile.vue` roadPaths — the junction-adopts /
      min-seam pairing now lives ONLY in `roadEdgeFrac`). The cars stay on
      `sim/laneOffset.ts` (hot path) and the parking kerb stays `parking.ts
      kerbOffsetPx` — both PINNED to the profile by the sweep
      (`tests/unit/tiles/streetProfile.spec.ts`): pavement parity, paint
      parity, car-band parity, seam symmetry, strip invariants, and a
      synthetic street×parking×footway matrix — all board-wide over every
      registered scenario. Move either side alone and CI names the board+tile.
    · ACROSS-KERB parking (drives, forecourts) is deliberately NOT a strip: it
      lies beyond the pavement on the property side and never moves the band
      (the cross-section rule, `docs/superpowers/specs/2026-08-20-street-cross-
      section-design.md`). Bare kerb (`row.informal`) paints nothing and moves
      nothing either.
    · ONE-WAY CENTRE RULE (2026-08-20, second pass): the tarmac a stream brings
      to a seam is the tarmac it had — the ENTRY edge adopts the upstream
      one-way's own count, the EXIT edge carries the tile's own. So a gore
      shuts its lane at full width on the tile that owns it, the NEXT tile
      paints the recovery taper back down, and every one-way↔one-way seam
      agrees by construction (the old stepped exit edge was the one asymmetry
      the symmetry sweep had to exempt — and a visible pavement JUMP at every
      lane drop). A merging car sits INSIDE gore/recovery tarmac (containment,
      not equality — see the car-band case); markings keep the min-based REAL
      lane counts. A one-way drop paints NO Sperrfläche (user call, same day):
      the hatched bay ended in a hard white bar right where the recovery
      tarmac carries on, so the closing lane is plain tarmac, its boundary
      divider runs dashed to the seam, and the tapering edge line + merge
      arrows are the whole signage. Two-way reducer gores are untouched.
    · Three pre-existing absurdities the parity oracle surfaced: (a) a WIDE
      junction arm (kerb past 0.5 − band) used to clamp the pavement band
      INSIDE the carriageway and paint tarmac over it — the profile answers
      `pavement: null` (no room is no pavement; the walkers keep the clamp
      fallback so their sampler stays total); (b) deep gapped bays near the
      tile edge clamped the band into the bay — also null now; (c) the walkers
      never had the paint's kerb-anchored ONE-WAY branch, so people and paint
      quietly disagreed on every one-way lane-drop run — the migration put the
      walkers on the paint's numbers (uniform runs unchanged, so nothing
      visibly moved).
    · UNITS: profile = tile fractions; footway = ground units of 100 (×100);
      parking = px at tileSize. LANE 0.14 / VERGE 0.04 / PAVEMENT 0.08 — the
      lockstep with footway's PAVEMENT_GAP/WIDTH is itself a sweep assertion.
    · `parking.ts kerbOffsetPx` keeps its min-2 floor; `roadEdgeFrac` (like
      the pavement always did) does not. They differ only on 1-lane one-way
      BENDS, where no parking row is legal anyway — documented at
      `roadEdgeFrac`.
- **FOOTWAYS (2026-08-02).** `TileCell.footway?: "both" | "none"` is the fifth
  tile axis and only ever an OPT-OUT — every street has pavements unless it says
  "none", so boards written before footways existed grew them for free.
    · NOT a Lane, and do not be tempted: a pavement is bidirectional on ONE
      strip (a Lane is directed), it sits OUTSIDE the kerb (laneOffset positions
      lanes within the carriageway), and its users MAY OVERLAP — which every
      following/swept-body/conflict gate in road.ts exists to forbid.
    · Pavement art reuses the road's OWN kerb geometry (`roadKerbEdge` /
      `roadCurveKerbEdge`) at a bigger offset, so it follows every bend exactly.
      A hand-rolled parallel line drifts on curves.
    · Paint ONE band per side per movement, deduplicated: `twoWay` is two lanes
      over the same ground and painting per lane stacks two bands and shows a
      seam at every tile edge.
    · **MEASURE THE ROAD WITH `laneCountAt`, NEVER `laneCount(p) +
      laneCount(oppositePort(p))`** (2026-08-04). A CURVE (and a junction) carries
      no lanes on the port opposite an arm, so the two-term sum collapses every
      bend to the 2-lane minimum — `roadHalfUnits` did exactly that and laid a
      2-lanes-each-way street's band 28 units inside its own kerb, i.e. UNDER the
      tarmac that is painted over it. The pavement VANISHED for the length of
      every bend (reported as "eine Lücke in den Trottoirs"); `/test/roadcurveloops`
      showed two of its three rings with no pavement at all. `tiles/lanes.ts`
      already documents `laneCountAt` as the helper for "when the tile is a curve
      or junction" — believe it.
    · **NO min-2 FLOOR on the pavement either**, same reason `Tile.vue`'s paint
      width dropped one: since the run-max kerb anchor a 1-lane one-way street is
      drawn its true ONE lane wide, so flooring at two floats the band half a lane
      out with a strip of bare ground behind the kerb (`/test/citizencars`).
    · **The band is seam-matched PER END, not per tile** (`pavementPaths` takes the
      LEVEL, not just the cell). The tarmac meets its neighbour flush, so a
      pavement measured from the tile alone jogs sideways at exactly the seams
      the kerb it follows does not. Since 2026-08-20 the per-end numbers come
      from THE STREET PROFILE (above) — `bandsFor` just reads
      `FlankProfile.pavement` at each seam; the seam rules live in
      `roadEdgeFrac`, nowhere else. Draw with `roadKerbEdge` /
      `roadCurveKerbEdgeTapered`, SIGNED per-end offsets, `side = 1`.
    · **A ONE-WAY street is the one road not symmetric about its centreline.** It
      kerb-anchors the run's widest lane count, so lanes open and close on the
      CENTRE side while the kerb runs dead straight — each pavement follows its
      OWN flank of the profile, and a centred ±half puts the kerb-side band on
      the tarmac. `/test/footwaywidth` is the isolation board for all of this:
      a 1-lane one-way, a 2-lane bend, and a 3→1 taper.
    · **PAVING IS ITS OWN LAYER** (`TileGround layer="paving"`, z1) — driveways
      and pavements, above EVERY tile's ground patch and not just their own. A
      terrain patch's corners are jittered OFF the tile grid on purpose, so a
      plot's ground legitimately spills a few units into the road tile beside
      it; painted in the same z band, DOM order decides and the later tile wins,
      chewing a notch out of the pavement at every seam. Same class of bug the
      scatter split fixed, same fix. Reported as "the sidewalks are not
      connected" and as "the sidewalk is drawn on top of the people" — the
      second was the notch cutting past a walker, NOT a z-order problem: paving
      is z1 and `.pedestrian` is z6, and a pixel probe over the rendered board
      confirms no GROUND layer paints over a walker (the only near-misses are
      two walkers 3px apart, which the model allows on purpose). Since
      2026-08-21 exactly one thing deliberately does: `.tile-structures` (z7),
      the houses themselves — see BUILDINGS ARE NOT SCATTER.
    · Verify layer bugs with PIXELS, not `elementsFromPoint`: every tile layer is
      `pointer-events: none`, so hit-testing cannot see them at all. And PAUSE
      the board first (`__game.paused.value = true`) — a rect read one frame and
      a screenshot taken the next catch a walker several pixels apart, which
      reads as "something is covering them" when nothing is.
- **PEDESTRIANS ARE THEIR OWN SIM** (`sim/pedestrians.ts`): a route of tile ids,
  a distance along it, a side of the street. Positions come out in TILE units so
  a headless test reads them and the renderer only multiplies; `game.pedestrians`
  is filled in `advance()`, not the render mirror.
    · **A walker follows the pavement's own CURVE**: positions come from
      `laneSegmentPointAt` (the sampler the cars use) at the pavement offset.
      Lerping between tile CENTRES is right on a straight and wrong everywhere
      else — on a corner the walker cuts across the inside of the bend, leaves
      the drawn band and turns through a sharp V.
- **A PLOT-TO-PLOT STRAIGHT LINE IS NOT A JOURNEY** (`walkAccessTiles`,
  2026-08-03). The real one goes down the driveway, along the pavement and up
  the other driveway — MEASURED at a near-constant **2.5 tiles** whatever the
  separation (2.64 at one tile apart, 2.39 at four), because it is two fixed end
  legs and not a detour that scales. Leaving it out was a trap, not a rounding
  error: the panel quoted a next-door commute at 4s, the walker took 15-20s, and
  the citizen was scored against the same optimistic distance — so somebody
  whose job was ONE TILE from their door took the maximum unhappiness penalty
  twice a day and left town on the third. A yardstick nobody can reach is not an
  expectation; it is a guaranteed failure.
    · It belongs to the JOURNEY, not to walking. Charging it to the walk alone
      made people drive next door — measured, the walk share on
      `/test/citizenwalk` fell from 89% to 46%. A driver walks to their car and
      from their parking space too. Transit does not get it: its access and
      egress legs are already modelled explicitly.
    · The same allowance goes into `expectedSec`. That does NOT break "a bad
      network must not grade itself" — a constant door-to-kerb term is not read
      from the network, it is true of every journey on every map.
- **THE DAY LENGTH IS MEASURED, NOT PICKED** (`secPerDay: 1800`, 2026-08-03).
  Median door-to-door over 2000 board seconds on the reference boards: a local
  walk 18s, a local drive 13s, a city-to-city rail commute 105s. Read against
  what each obviously IS in a real town (12 min / 10 min / 60-90 min) that fixes
  the exchange rate at ~30 real seconds per board second, so a 24-hour day is
  ~1800 board seconds. At the old 300 the same commute read as EIGHT AND A HALF
  in-game HOURS — people left at 07:00 and arrived after dark — which is what
  the three-hour departure window in `considerTrips` was quietly papering over.
  The cost is a 30-minute real day at 1x, which is what 2x/4x are for.
- **BOARDS OPEN AT 07:00** (`startHour`). A citizen board that starts at midnight
  shows an empty town for seven in-game hours before anyone leaves the house,
  and whoever opened it sits through that every single time. The morning peak is
  the thing the mode is about, so it is the thing you see first.
- **A TEST THAT NEEDS DAYS SAYS SO** (`citizensModeWith`). The shipped day is
  calibrated for playing; a test watching growth or emigration would need nine
  thousand seconds of simulation. Compress the clock explicitly in the test
  rather than bending the shipped calibration to keep the suite fast.
- **"THINKING OF LEAVING" WITH NO REASON IS THE LEAST USEFUL THING A PANEL CAN
  SAY.** A player cannot act on a mood, only on the journey that caused it, so
  every scored trip is remembered (`Citizen.recent`, `TripOutcome`) with its two
  numbers and rendered as a sentence: "The trip to work took 2m 14s — far longer
  than they expected (1m 15s)."
- **A GETTER THAT READS THE `markRaw` SIMS HAS NO REACTIVE DEPENDENCY**, so Vue
  evaluates it ONCE and caches the answer for ever (2026-08-03). This is the
  price of the `markRaw(game)` rule, and it is invisible until something is
  meant to move: the person pin appeared in exactly the right place and then
  never budged, measured at 0px of travel in 4 seconds. `game.renderTick` is a
  `ref` bumped once per drawn frame — touch `game.renderTick.value` at the top
  of any getter that samples the sims on demand (`locatePerson`, `inspectPlot`,
  `inspectPerson`, `compareModes`). Anything that does NOT touch it stays as
  cheap as it was, which is the point of a heartbeat over mirroring a whole
  population into reactive state to serve one open panel.
- **THE PIN FOLLOWS A PERSON THROUGH FIVE DIFFERENT SAMPLERS** (`locatePerson`).
  On foot → the walker's live position; in a car → the car's (the road sim's
  trip id IS the car id, so it is a lookup); on a train → the loco; on a
  platform or indoors → the tile centre. A pin that only knew about walkers
  would silently stick to a doorway for half the population, since roughly half
  of all journeys are driven.
    · Rail geometry is measured off an SVG path (`getPointAtLength`), so the
      exact loco position needs a `document`. Headless it falls back to the
      loco's TILE CENTRE — coarser by half a tile, still tracks the train across
      the map, and testable. Do not pretend the pure path exists.
    · The pin lives inside the camera-scaled world, so it must COUNTER-SCALE
      (`1 / zoom`, capped at 1) or it shrinks to a speck at the 40% a whole town
      is viewed at — the exact zoom at which a "find this person" marker is most
      needed.
    · The pinned id belongs to the VIEW, not the panel: you pin somebody
      precisely so you can close the card and watch them.
- **THE INSPECTOR MUST NOT RE-DERIVE THE DECISION** (`CitizenSim.quoteFor`,
  `game.compareModes`, `CitizenInspector.vue`, 2026-08-03). Click a house → its
  roll call; click a person or a figure on the pavement → their day plus every
  way they could make the journey, priced. The table is the very list
  `chooseMode` compares (`quoteModes` has exactly two callers, the chooser and
  the panel) — a panel that recomputed "what would they have done" drifts from
  the decision the moment either side is touched, and is then worse than no
  panel, because it is confidently wrong.
    · TWO numbers per row, and the gap is the point: `estimateSec` is the honest
      door-to-door estimate, `cost` is the same journey after that person's
      habits. A mode winning on `cost` while losing on `estimateSec` is somebody
      choosing against their own stopwatch.
    · Unavailable modes are LISTED, with a reason ("no road joins the two ends",
      "too far to walk"). "Why not" is half of what a planner came to find out,
      and a silently short table answers none of it.
    · **ONE CLOCK ON THE CARD.** Journey times print on the town's own clock
      ("14 min", "1h 24m"), the same clock the times of day use.
      This was board seconds first, and getting it wrong twice is the lesson:
      seconds were chosen because at `secPerDay: 300` a cross-city commute
      converted to EIGHT AND A HALF in-game hours, so the in-game clock was
      nonsense and seconds were the only honest unit. That was a *symptom of a
      broken calibration being read as a display decision*. Fixing the day
      length removed the reason and left the real fault exposed: the card mixed
      two units, and "leaves at 07:08" plus "took 1m 23s" do not compose — a
      player cannot work out when she arrives. Raw board seconds survive as a
      tooltip (`boardDuration`), which is the one you can check with a
      stopwatch. When a display unit looks wrong, ask whether the MODEL is wrong
      before inventing a unit to hide it.
    · `inGameDuration(sec, secPerDay)` is the pure formatter; `game.durationLabel`
      binds this game's day length, so a view never has to know it — and a test
      compressing the clock gets labels that match its own day, not the shipped
      one.
    · Zero winners is a legal, meaningful outcome: the model REFUSING the
      journey. Say so in the panel; an empty table explains the one case that
      most needs explaining.
    · A person's NAME is a hash of their id, never an RNG draw — a panel that
      renames somebody between two frames is a panel nobody trusts.
    · A transit trip's first timed leg is the approach to the platform. Calling
      it "walking to work" while the chosen mode says Train reads as the panel
      contradicting itself; say "walking to the station".
- **THE 6-NEAREST JOB DRAW BEATS CAPACITY** (`assignJob`). A newcomer picks at
  random from the six nearest OPEN workplaces, so what spreads a town across its
  job clusters is how MANY plots each cluster has, not how big they are — a work
  plot holds twelve, so two of them swallowed a whole town on the first draft of
  `/test/citizenchoice` and the far cluster stayed empty.
- **A STATION CATCHMENT IS 2 TILES, SO STOPS 6 APART LEAVE GAPS**
  (`WALK_RADIUS_TILES`). With stops at 3, 9 and 15, columns 6 and 12 have no
  station in reach at all: a carless resident there whose job is out of walking
  range cannot travel by ANY means and the trip is refused. Fine to build on
  purpose, a bad accident to ship — check plot columns against stop spacing.
- **THE CROSSING IS THE MECHANIC** (`footCrossing`, 2026-08-02). The walking
  graph's node is `(tile, SIDE)`, and the only move that changes side is at a
  zebra. Drop that and a pavement is two networks drawn beside each other with
  people teleporting over the tarmac.
    · `sideOfPlot` must use the SAME sign convention as `pavementOffsets`, or
      routing and paint disagree and walkers land on the wrong kerb.
    · **A `side` is fixed to the STREET; a sampler offset is relative to the
      DIRECTION OF TRAVEL.** They are not the same number. `sideOfPlot` decides
      the side against the tile's own through movement, so a walk that runs
      AGAINST that movement must flip the sign before handing it to
      `laneSegmentPointAt` — that is `pavementOffsetFor(cell, side, entry, exit)`,
      and nothing may reach for `pavementOffsets(...)[0] * side` directly. Using
      the raw sign put everyone walking "backwards" on the opposite bank, and the
      driveway at the far end then hauled them straight over the carriageway:
      on `citizenzebra` (canonical eastbound, jobs reached by walking west from
      the zebra) that was 125 people crossing the road anywhere but the crossing,
      each for ~1.5s, which reads on screen as an occasional jaywalker rather
      than as broken geometry. Guarded by "nobody crosses the carriageway
      anywhere but the zebra" in `tests/unit/citizenWalking.spec.ts`.
    · **A `side` is also spelled per TILE, so it must be TRANSLATED at every
      seam** (2026-08-03). The reference frame is the tile's OWN through
      movement, and that is only ever "whichever movement its lane list names
      first": a corner authored `twoWay(Right, Bottom)` reads its outer bank as
      +1 while the straight beside it authored `twoWay(Left, Right)` reads its
      south bank as +1 — opposite banks, same number, both boards ordinary.
      `walkMoves` therefore carries the BANK, not the sign, through
      `sideAcross()` (footway.ts): compare the two tiles' bank normals on the
      component perpendicular to the step. Carrying the raw number walked people
      a road's width sideways at the seam with no crossing under them (0.44 of a
      tile, on `citizenwalk`'s own corners).
    · **A tile the route enters and leaves BY THE SAME EDGE must be RETRACED,
      not walked through** (2026-08-03). It happens whenever the only zebra is
      past the destination: down to the crossing, over, and back the way you
      came, so the crossing tile's run has `prevTile === nextTile`. `buildSteps`
      runs `t` 0 → 0.5 → 0 for it (`doubleBack`), and `pointOf` adds 180° to the
      heading of any leg whose `t` descends. Walking on to the far edge instead
      resumed the walk a whole tile back — the reported "he went left, and
      suddenly appeared right", measured at 1.05 tiles.
    · Both of the above are jumps, and a jump is the cheapest thing in this
      module to TEST: sample every route on every citizen board each tick and
      assert nobody moves further than a stride (~0.06 of a tile). A road is
      0.44 wide and a tile is 1, so the two failure modes are unmissable and
      need no per-case oracle. See "walks every route on every citizen board
      without a single jump", and `/test/citizencrossback` for both in isolation.
    · Yielding needed NO new rule in the traffic model: a walker claims the tile
      and game.ts ORs it into the road sim's `closed` predicate — the same
      mechanism a level crossing uses for a train. Cars already know how to
      brake for a closed tile.
    · The wait terminates BY CONSTRUCTION: the claim stops anything new
      entering, so the walker only ever waits for what was already there.
    · Snap `progress` to 0 on ENTERING a cross step. Carrying the remainder of
      the last stride means a walker is essentially never at exactly 0 there, so
      the wait never fires and they stroll into the traffic.
    · **A footway step's entry/exit are the ROAD's ports, NEVER the plot's.** A
      house south of an east-west street is reached by walking ALONG the street
      and turning up the driveway. Take the ports from the plot and the
      "pavement" runs across the carriageway: people step onto the zebra and
      come back out of the middle of the road. A tile adjoining a plot is only
      HALF walked (t 0..0.5 or 0.5..1) — the driveway meets it at the middle.
    · **THE RAILWAY CROSSING IS THE ZEBRA'S OPPOSITE**, not its sibling
      (`hasRailCrossing`, 2026-08-03). A pavement plus rails on one tile IS a
      pedestrian level crossing — derived, so every board's existing crossings
      became one for free. At a zebra the walker CLAIMS the tile and the traffic
      gives way; at the tracks the train has absolute priority, the walker waits
      (`railBusy`, the same reserved/occupied predicate the cars brake for), and
      NOTHING the walker does reaches the railway. That is why it needs no
      `CROSS_WAIT_MAX` backstop: with only one side waiting there is nothing to
      deadlock, and "go anyway after 8s" would mean stepping in front of a train.
      Hold only at a leg starting on the tile BOUNDARY — a leg starting mid-tile
      begins ON the rails, and freezing somebody there is the opposite of safe.
    · **The claim must be no wider than the kerb.** Claiming from a step earlier,
      to give cars more warning, holds the tile almost continuously once a town
      shares one zebra: measured a 589-second queue. Cars brake for a closed tile
      from wherever they are, so the kerb is early enough.
    · **A car held AT a closed tile still has a body point ON it.** So "wait
      while any car touches the crossing" deadlocks: the walker waits for a car
      that is waiting for the walker (measured 1078 seconds). Count only bodies
      WELL inside the tile (t 0.15..0.85), and keep `CROSS_WAIT_MAX` as a
      backstop — a pedestrian frozen at a kerb holds the crossing closed and
      takes the whole road down with it.
    · **Zebra stripes run ALONG the road and repeat ACROSS it** — a driver sees
      them side by side, a pedestrian steps over one after another. Square to
      the road (repeating along it) reads as a stack of stop lines.
    · The zebra art needs its own `markings` layer at z2: the road surface is
      drawn ABOVE the ground layer, so paint on the ground is buried under the
      carriageway it is painted on.
    · A walk route is `[plot, street…, plot]` — ADDRESSES ARE NEVER
      THROUGH-ROUTES. Let people walk freely across plots and a short trip cuts
      through gardens and never touches a pavement, which is the whole thing the
      feature exists to show.
    · `planWalk` returns null when no pavement joins the ends, and the citizen's
      leg stays on its clock. A board with no roads (threecities) is unaffected.
    · Step the walkers BEFORE the citizens in advance(), or every arrival is
      reported a tick late.
    · `citizenStats.onFoot` is the headless-visible count — same reason as
      `driving`: the renderer's list does not exist in a test.
- **LOCAL ACCESS IS DERIVED, never drawn** (`tiles/access.ts`). A plot within
  `ROAD_ACCESS_TILES` of a street gets its driveway/apron rendered from the tile
  centre out to that edge. No level data, nothing to keep in sync, re-derived
  the moment a street is laid or bulldozed — and it is the pedestrian graph when
  walking people arrive. Do NOT auto-generate road TILES inside a town: they
  land in the level data, become editable and bulldozable, and must be
  regenerated on every growth step.
    · `accessPortOf` is O(1) per tile because the RENDERER asks per tile per
      frame; `localAccessOf` (whole board) would be quadratic there.
    · It is a METHOD in TileGround, not a getter — a vue-facing-decorator getter
      is a cached computed, and a street laid in play would never grow paths.
    · Draw it as a WEDGE flaring to the kerb, in a tone LIGHTER than the ground
      (hard-standing). A constant-width darker quad reads as a timber plank.
- **`game.roadCars` is a RENDER mirror** (updated in `frame()`, not `advance()`),
  so it is EMPTY in a headless test — measuring cars with it reads 0 while ten
  are driving. `citizenStats.driving` is the headless-visible count.
- A town with only roads does not shrink, it CHURNS: the car-less are refused,
  leave, and are replaced by people who may also lack cars. Population holds
  steady while the town self-selects for drivers, so `access` shows the failure
  only as a DIP — assert on the minimum over a run, never the end state.

## LIFE STAGES & DAILY ROUTINES (2026-08-04)
- Everybody used to get the same three numbers (`outHour`/`backHour`/`shopHour`),
  so a board had TWO SPIKES AND ELEVEN DEAD HOURS. A citizen now has
  `stage: LifeStage` + `routine: Activity[]` — a list of `{target, from?, hour,
  windowH, everyNDays, lastDay}` rolled once at move-in. Five stages: `child`,
  `worker`, `shiftWorker`, `tradesperson`, `retired`.
  Measured on `/test/citizenday`, busiest "travelling" per in-game hour, same map
  and seed, only the mix changed: **at 14:00 and 15:00 an all-worker town has
  NOBODY out at all** where the mixed one has 17. Trough/peak 0.00 → 0.19, and
  the peaks barely move — same people, spread over the hours they would use.
- `TripPurpose` IS the activity target (`home|work|shop|school|leisure|callout`),
  so there is no second `purpose` field to keep in step. Still only THREE topics:
  school/callout → `commute`, leisure → `errands`. A fourth `Topic` would drag
  `CityHappiness`, `recompute()` and the panel behind it to say nothing new.
- **Resolve a target when the activity FIRES, never at move-in.** The nearest shop
  fills up, a call-out is a different address every day, a school may not exist.
- **`everyNDays` parity must include the ACTIVITY INDEX**
  (`(dayIndex + hashId(id) + i) % n`). Leave it out and all of one person's
  every-other-day activities land on the same days — the empty-day bug in
  miniature.
- **`from` (anchor an activity to where it starts) is not polish.** The old errand
  rolled 10:00–19:00 and was gated on being at home, so for most workers the
  window opened while they were at their desk and THE TRIP NEVER HAPPENED. A trip
  home never carries `from`, so wherever the day left somebody they can get back.
- `TileCell.zone?: PlotKind` overrides the derived kind, applied AFTER the shop
  ranking so zoning a school does not promote some other house into the parade.
  `PlotKind` lives in `tiles/model.ts` now (it is tile data), re-exported from
  `tiles/cities.ts`. **A school's capacity is its TEACHERS, not its pupils** —
  capacity on a non-home plot is JOBS and `reviewDay` gates growth on
  `freeJobs > 0`, so a 160-pupil school hands every town imaginary employment.
- `CitizenTuning.stageMix` replaces `joblessShare`. Tests that want one life say
  `stageMix: { worker: 1, … }`.
- **POPULATION IS A BLUNTED SIGNAL ON A STRANDED BOARD NOW; THE BARS ARE THE
  SHARP ONE.** A quarter of every town is children and retired residents whose
  whole day is a local walk — journeys that succeed with no railway at all. They
  are happy, they pull the mean mood up, and newcomers keep arriving faster than
  the stranded commuters leave. Measured on threecities with NO trains, same
  seed, only the mix changed:

  | | Westfield | Eastfield | Steinbach (walks) |
  |---|---|---|---|
  | all workers | 47 → 22 | 43 → 30 | 21 → 84 |
  | life stages | 47 → **72** | 43 → **56** | 21 → 84 |

  The failure is still perfectly visible — Eastfield's Work bar reads 0.53
  against Steinbach's 1.00 — it just is not visible in the headcount. Assert on
  `happiness.commute`/`access`, and keep an ALL-WORKER control run beside it
  (`citizensModeWith({ stageMix: { worker: 1, … } })`) so a real weakening of the
  model cannot hide behind the non-commuter floor. This is the same CHURN the
  road-only note below describes, amplified.

## BIG CITIZEN BOARDS (`/test/hinterland`, 35x24, 2026-08-04)
Four rules, each measured on that board, each of which failed silently:
- **A house column three tiles from BOTH railway corridors strands everyone in it
  without a car** — no walk (`walkMaxTiles: 4`), no car, no station in reach, so
  every trip out is REFUSED. The tell is the red Connection bar on the city card.
  Lay a village as `rail · road · house · road · rail`: every column one tile
  from a carriageway AND two from a platform. A town is at most as wide as its
  lines can serve.
- **Past a point, MORE TRAINS MAKE A RAILWAY CARRY LESS.** Six services on a
  single-track theta spent the day holding each other at signals: rail share fell
  38% → 4% and a six-day headless run took SEVEN TIMES longer. On single track a
  service is a block; buy wagons, not trains. (4 x 10 wagons ships.)
- **A DAILY trip must be a LOCAL trip.** With one café in the valley every retired
  resident of the far village rode three quarters of the ring for a coffee every
  day, gave up, and the village fell 136 → 32 in six days. Make the SCARCE thing
  the twice-a-day one (the school), never the daily one.
- **A pure dormitory dies.** Villages whose every job is a lap away lost half
  their people. Two industrial plots each and all three villages bottom out on
  day three and then GROW AGAIN with their happiness. A place needs a reason to
  stay as well as a reason to travel.
- A ring is one-directional, so the way HOME is the long way round. Watch
  `maxTransfers` (6): a return leg past seven platforms fails outright.
- Build a big board's road net from a SET OF COORDINATES and derive each tile's
  lanes from which neighbours are road (2 arms → `twoWay`, more → every arm to
  every other). Hand-authoring `twoWay(L,R)+twoWay(T,B)` at a crossroads makes a
  junction nobody can turn at; deriving it cannot.
- A `TrainDef` built for a headless test MUST carry `destinations` and `line` —
  omit them and the trains sit in their sheds while the probe reports "transit
  0%" and you go looking for a bug in the citizens. Copy `buildTrainDefs` from
  `TestStage.vue`.
- **A LADDER OF SINGLE-FILE STREETS WITH A JUNCTION ONLY AT EACH END DEADLOCKS**
  (2026-08-21). Marktstadt was five streets thirteen rows long, one lane each
  way, rungs at the top and the bottom and nothing between. Two things follow and
  together they are fatal: every trip across the village is a LAP of the whole
  ladder, and a queue long enough to reach back into a junction box blocks the
  stream that would have let it out. That is a cycle of full tiles with no head
  to move first. It does not clear: measured, 42 of 46 cars standing still for
  the rest of a six-day run, one for 354 unbroken seconds. (An earlier version
  of this note blamed `BOX_KEEP_CLEAR_PATIENCE` for closing the ring — measured
  false on the shipped layout: disabling the valve outright reproduces the
  seed-11 knot bit for bit. The real closer is below.)
  · **The tell is a car clock, not a queue.** 35 journeys a day "given up on
    after 9h 36m" = `maxWaitSec * 2`, `advanceTrip`'s give-up for a driver whose
    car never arrives, with the town's Work bar pinned at 0.00 while its
    neighbours recover. Car mode share sagging (0.20 → 0.11) is the same fact.
  · **Look for FROZEN cars, not slow ones, and read `velocity` — NOT `speed`.**
    `RoadSim.cars()` reports both; `speed` is the driver's preferred cruise and
    is CONSTANT while the car stands still, so a stuck-car probe written against
    it says "0 stopped" over a totally deadlocked town. That cost an hour.
  · **The fix is capacity, and it takes BOTH halves.** A middle rung (shorter
    trips, a second way round every jam) and two lanes each way inside the town
    (somewhere for a blocked turn to be). Measured on the road layer alone, a
    fleet of 40 village trips over 900s: old 436 arrived / 40 frozen; rung only
    887 / 40; wide only 649 / 40; **both 2797 arrived / 0 frozen**. End to end,
    the town's commute went 0.00-0.08 → 0.36-0.60. One-way circulation was tried
    and measured WORSE (566 arrived): with rungs only at the ends, one-way turns
    every local trip into a full circuit.
  · **A per-seed zero is not a guarantee — probe a SWEEP, and probe INSIDE
    capacity** (2026-08-21). The "0 frozen at 40" above was one lucky seed
    pair: at a CONSTANT 40 only 4 of 24 probed runs come through clean (two
    independent trip streams x seeds 1..12), and which ones flip re-rolls on
    ANY dynamics change — an unrelated CLIP_LANES retune (PR #98) turned the
    guard's seed 11 red. A constant-load harness holds the network at that
    density forever (every arrival instantly replaced), which bursty citizen
    demand never does; a zero-freeze assertion at supercritical load asserts a
    coin toss. The clean envelope ends between 24 and 30: at a constant 24 all
    40 probed runs are clean (longest stand 24s), at 30 two of six seeds
    already stand for 350s. 24 is the guard's load.
  · **AND ASSERT THE THROUGHPUT, not only the freeze.** At a load both plans
    survive NEITHER freezes, and at one neither survives BOTH do, so "nothing
    froze" on its own never separates a layout from the one it replaced. What
    does, on every seed: at a constant 24 the shipped plan carries 887-967
    journeys per 900s where the old ladder never once clears 700 (192-674, and
    it jams on a third of its seeds). The freeze checks are the backstop; the
    number the layout actually moves is the evidence.
  · **Do not hand-roll a PRNG for a harness — `makeRng` (mulberry32) is right
    there.** The obvious glibc `s * 1103515245 + 12345` constants overflow the
    double mantissa in JS and the state space collapses: measured period 10466
    from every seed tried, against the 2^31 the arithmetic promises. It stays
    deterministic, so nothing goes red — it is simply not the generator the test
    believes it is sampling with.
  · **BOX–CROSSING–BOX IS A DEADLOCK TRAP.** A level crossing directly between
    two junction boxes (the rung crossing the branch: box 9,10 / crossing
    10,10 / box 11,10) couples the boxes through the rail-crossing keep-clear
    — which is patience-less by design (`won't roll onto a rail crossing`,
    road.spec) and demands room past the far edge. Two opposing streams plus
    one conflicting turner close a wait-cycle in which every hold is locally
    correct (keep-clear → full tile → arbiter-refused box → follower → turner
    → back). Diagnose knots by labelling `bind()` calls in `clearAhead` and
    dumping each frozen car's binding gate — the wait-for graph names the
    cycle in one run. Retracting the rung to avoid the crossings measured
    WORSE (11/20 seeds frozen): connectivity outweighs the trap. The real fix
    is a sim mechanism (spillback / wait-cycle resolution) — open ticket.
  · A width change may only happen ON A JUNCTION. `seamMismatch` flags a plain
    straight or bend whose neighbour has a different lane count (the renderer
    paints it red); a junction fans and merges unequal arms by design and is
    exempt on both sides. So a "wide town centre" zone has to have junctions at
    its every boundary with the single-lane country roads — Marktstadt's zone is
    x=3..11, y=5..18 and its two exits, (3,18) and (11,18), are both T junctions.
  · A mid rung has to miss BOTH lines' platforms (a station may not carry road),
    the block signals (a road tile silently drops the signal authored on it) and
    the zoned plots INSIDE ITS OWN SPAN — and that normally leaves a CHOICE, not
    one row. On hinterland four rows survive all three (6, 10, 14, 16); y=10
    ships because a rung is worth most in the middle and the middle rows are the
    blocked ones (y=11 platform + shop, y=12 café). Choose by how evenly the rung
    splits the ladder: y=10 → 5/8 rows, y=14 → 9/4, y=6 and y=16 sit one and two
    rows off an existing rung. Cost is read off the SPAN too: hinterland's rung
    is x=3..11, so it takes exactly two plots, (6,10) and (8,10); the tiles on
    the rail columns become level crossings and plots outside the span ((2,10),
    (12,10)) are untouched. Counting the NEW ROAD TILES as the plot cost is the
    easy mistake — half of them are rail.
- **PARKING WAS NOT THE CULPRIT, AND CHECK BEFORE YOU BLAME IT.**
  `deriveWorkplaceParking` is applied in a scenario's OWN data — `workparking`
  and `homeparking` call it, and nothing else does. hinterland never has, so the
  17 bays it *would* derive there were never on the board any of the jam
  measurements came from. `workplaceParkingTiles(level)` tells you what a board
  would get; `rowsOf(level[id])` tells you what it actually HAS.

## BRIDGES (2026-07-28)
- `TileCell.bridge?: true` is a STRUCTURE, and the exception lives INSIDE
  `canBuildOn` (`if (cell?.bridge) return true`), never as a second predicate
  beside it. Everything that asks "may I build here" — `validateLevel`'s
  `blocked-terrain`, the editor, the route planner — gets the exception for free
  by asking the question it always asked. Pinned by a validator test.
- ONLY WATER IS BRIDGEABLE (`BRIDGEABLE`/`terrainBridgeable`). Rock and mountain
  are TUNNELLED instead (see TUNNELS, 2026-07-31) — no ground is ever both.
- `addConnection` SETS IT. Every build path in the game (editor commit, in-play
  `buildRoute`, the route-draw lay) funnels through that one reducer, so there is
  no "place bridge" verb to forget and no way to end up with track standing in a
  river. `removeConnection` clears it when the last line goes, or a razed
  crossing leaves a permanently buildable tile mid-river — a free crossing,
  bought once.
- `RouteOpts.bridgeable` is a SECOND passability gate priced at `BRIDGE_MOVE`
  (6x MOVE). That number is the whole design: a 1-wide river is worth crossing
  from ~6 tiles of detour away, a lake several tiles across never is. Money is
  separate — `BRIDGE_BUILD_FACTOR` (4), the dearest thing in the game.
- `terrainBuildFactor` answers BRIDGE for both states of the tile: the span
  standing, and the water a span is about to cross. `buildRoute` prices before
  the edit lands, so a factor that only knew the finished bridge would quote
  every crossing at the price of open water.
- RENDER: `.bridge-deck` in Tile.vue, z1 (over ground, under rails z2), three
  strokes along the same segment paths the rails/lanes follow — shadow offset SE
  to the one sun, deck, parapet. Stroke-based so a bridge on a CURVE bends for
  free. Rail AND road: nothing about a structure is rail-specific, and a road
  deck must be WIDER than its carriageway or it vanishes under the opaque road
  surface (width from the lane count, `+ size*0.18` so the parapet clears the
  tarmac too). /test scenario: `bridge`.
- THE DECK MUST COME BEFORE THE ROAD LAYER IN THE TEMPLATE (2026-08-01). Both are
  z1, so DOM ORDER decides, and drawn later the opaque deck painted the street
  out: a road bridge read as a GAP in the road. z-index alone will not save you
  here — same-z siblings are ordered by the markup.
- A DECK ONLY WORKS IF THE WATER FITS THE TILE. The span runs edge to edge, so
  any water bulging past the boundary shows past the ends of the bridge however
  the deck is drawn. That is why terrain patches are contained (see TERRAIN →
  "A PATCH STAYS ON ITS OWN TILE"); the two are one feature, not two.
- Pinned by traffic, not just by geometry: `bridge.spec.ts` runs the scenario's
  own board and asserts a train reaches the far depot and a car goes bank to bank
  over `4,5`. A span nothing crosses is not a bridge.
- A RIVER IS NOT A KIND: it is a 1-wide line of `water`, which `patchPath` fuses
  into a ribbon. What separates it from a lake is that it cannot be gone round.

## TUNNELS (2026-07-31)
- `TileCell.tunnel` is the bridge's twin: the SAME exception inside `canBuildOn`
  (`bridge || tunnel`), set by `addConnection` on TUNNELABLE ground (rock +
  mountain), cleared by `removeConnection` with the last line. Planner gate
  `RouteOpts.tunnelable` at TUNNEL_MOVE (9x) vs BRIDGE_MOVE (6x); money
  `TUNNEL_BUILD_FACTOR` 6 beats the bridge's 4 as the dearest build.
- THE GROUND STAYS UNBROKEN OVER THE BORE: a tunnel cell lays NO rail keep-out
  corridor (`cellCorridors` skips `connections` when `cell.tunnel`), so the
  mountain scatter closes over the line. Clearing the right-of-way would draw
  the route onto the ridge as a bald stripe — the one thing a tunnel is not.
  TileRail is suppressed on the cell; a dashed guide (z9) is the map notation.
- PORTALS only where the bore meets NON-tunnel ground — an internal seam
  between two tunnel cells gets none. Tile.vue injects `level` for that
  neighbour check and reads `game.levelVersion` in the getter, or an extended
  bore would not retire the now-internal portal (cached-computed trap).
- GOING UNDERGROUND IS OCCLUSION, NOT VISIBILITY. Four layers, and the ORDER is
  the whole design (bottom to top): the portal's black OPENING at z1 → rails z2
  → trains (wagons z3 / loco z4) → the portal's MASONRY at z6 → the bore's
  mountain ROOF at z7/z8. So a train runs INTO the dark (the opening is under
  it), is covered by the masonry at the arch, and is covered by the rock from
  the tile edge on; and the masonry itself disappears under the rock, instead of
  being laid on top of it. Nothing is switched off anywhere. The dashed guide
  (z9) clears everything so the bore stays readable on the ridge.
- WHAT THIS REPLACED, and why it is not worth going back to: `renderTrains`
  used to set `visibility: hidden` once a unit's CENTRE was on the tunnel tile.
  A locomotive is 100px of a 200px tile, so half a loco blinked out on the rock
  face and a whole one blinked back in mid-ridge — with a visible gap opening
  between it and the wagons still on the grass. No portal big enough to mask
  that is a portal you want on the board.
- THE ROOF IS A SECOND COPY, CLIPPED (`TileGround`, `.tile-roof`): the same
  ground/scatter art rendered again above the trains, `clip-path: inset(0)`.
  Both halves of that matter. CLIPPED because the soft fringe is deliberately
  unclipped (half a stroke of the patch's colour, spilled onto the neighbour) —
  lifted over the trains it washes a consist in mountain grey ten units before
  the portal. A COPY, not a lift, so that fringe is still laid below everything
  by the original. (The roof copy CARRIES the height terrace, since 2026-08-03:
  the terrace lives inside the ground fragment now, and a bored ridge that
  terraced below the trains and not above them showed a step at every portal.
  It duplicates the terrace's clipPath id, which is harmless for the same reason
  the patch's own `terrain-clip` already was: both copies define the identical
  geometry, so `url(#id)` resolving to the first is the right answer.)
- THE PORTAL IS SIZED AGAINST THE ROCK FACE, which is the tile edge: a patch
  keeps to its own tile (`54b7391`), so the arch springs at the edge, its crown
  lands on it, and the gallery stands entirely on open ground — 16u out, not the
  30u it needed back when a massif overhung its own portal. The covered stretch
  and the roof MUST meet at that edge; leave a gap and a train shows through it.
  If the containment rule moves, `portalArt` moves with it.
- The opening being UNDER the trains is also what keeps the hillside out of the
  portal: at z1 it covers the mountain's own bowed-out ground patch, so what
  shows inside a portal is always the bore. The neighbour's rails (z2) run over
  it and into the dark, which is exactly right.
  /test scenarios: `tunnel`, `mountainpass` (a 5-unit consist).

## GRADE SEPARATION — flyover (2026-07-31)
- `TileCell.flyover: PortPair` names the connection riding a deck OVER the
  other line; `kindOf` → "flyover". AUTHORED data only, deliberately: crossing
  an existing line with the route tool still builds a flat junction (an editor
  verb for the flyover is a follow-up).
- THE SIM CONTENDS BY CLAIM KEY (`claimKey`, tiles/model.ts): the plain tile id
  on every ordinary cell, `id#over`/`id#under` per level on a flyover. Body
  occupancy (`bodyClaimKeys`), the reservation map, `routeToNextSignal` (it
  RETURNS claim keys now), mayCross/blockReason and the signal aspect all speak
  keys — one derivation, so they can never disagree which level a train is on.
  A multi-partner (switchable) entry falls back to the whole-tile key: a
  junction's lines DO interact, a flyover flag must not split one.
- `reservedBy`/`occupiedBy(tileId)` answer for EITHER level (`claimKeysOf`) —
  the edit gate and the debug overlay ask by tile and must keep working.
  "reserved" events strip keys back to tile ids (`tileIdOfClaim`) for the log.
- RENDER: deck z5 — over the rails (z2) and over the LOWER train (z3/4), so
  passing under the strip reads as passing under a bridge; fresh sleepers+rails
  are drawn ON the deck (the pair's z2 copy sits hidden beneath). `game.ts`
  lifts a unit to z6 while EITHER anchor rides the flyover pair, so a sprite
  straddling the seam never flickers under the parapet.
- TEST TRAP that took a run to see: routes are claimed at the first BOUNDARY
  CROSSING, not at departure — a reservation assertion 0.5s into a run reads
  an empty map. /test scenario: `flyover`; sim contract `flyover.spec.ts` — the
  FLAT clone of the same board must serialise (that contrast IS the test).

## HEIGHTS + GRADES (2026-07-31)
- `TileCell.height?` (absent = 0, `heightOf`) is the FIFTH tile axis. A joined
  boundary may climb AT MOST ONE step — that joint IS the ramp; `validateLevel`
  flags steeper as "grade-step" (once per joint, lexically smaller id reports).
- THE GRADE IS A CRUISE CAP, not a force: `gradeSpeedFactor(kind, wagons,
  grade)` (physics.ts, GRADE_DRAG/GRADE_MASS) caps vCap while the HEAD SEGMENT's
  exit points into a higher tile (`segmentGrade` in simulation.ts). DOWNHILL IS
  EXACTLY 1 — a descent bonus would poison the braking-distance maths (vSafe).
- TEST TRAP: the cap is a BRAKING TARGET. A train enters the first ramp tile
  still at cruise and decelerates THROUGH it — assert the MINIMUM velocity on a
  mid-climb tile (settles onto the cap), never the maximum on the first ramp
  tile. Bit immediately in grades.spec.ts.
- Render: climb CHEVRONS on the ballast (Tile.vue `gradeMarks`, same port
  transform table as tunnel portals; z2 over the rails), pointing uphill —
  drawn on the cell whose neighbour is exactly one step HIGHER; debug label
  shows " h<N>". /test scenario: `grades` (light shuttle vs heavy freight
  racing the same hill — the gap on the ramps is the mechanic).
- HYPSOMETRIC TERRACES (`tileHeightSvg`, 2026-07-31): a cell with height > 0
  lays a fused patch fill on the ground layer, lighter and warmer per step. ON
  GRASS the tint is THEME-ANCHORED (`heightTint(h, theme)`,
  `TERRACE_BASE`): "higher" only exists relative to the ground the theme
  paints — a fixed table read as a hollow on the bright meadow board and as a
  glowing patch on the dark debug flat. One base per theme + one step formula
  (hue toward yellow-green, lightness up), never per-step tables; the debug
  flat ground ("plain", #3a6b4f) is its own anchor so `npm run shot` pictures
  stay comparable. THE THEME IS PART OF THE MEMO KEY — the cache trap the
  terrain roadmap wrote down before anyone hit it. "Same" for the
  patch machinery compares NEIGHBOUR HEIGHT >= the band being drawn — a higher
  neighbour continues the terrace and lays its own lighter body on top of the
  shared reading, so a plateau fuses like a lake and the step edge always
  belongs to the UPPER terrace. Downhill edges get slope faces clipped inside the body:
  LIT on top/left, SHADED on right/bottom (patchSegments' clockwise edge order
  is 0 top, 1 right, 2 bottom, 3 left — the one NW sun again). Own memo cache
  (`heightCache`). Author a hill as a BODY (heights on the whole footprint),
  not just on the track cells, or it reads as two embankments.
- ONE BAND PER LEVEL OF THE FALL, NOT ONE PER CELL (2026-08-01). A cell drew a
  single body — its OWN height — so a boundary that dropped more than one step
  showed ONE contour where the same hill showed two or three elsewhere. It is
  not an exotic case: `/test/grades` is a ridge with authored ramps east-west
  and nothing north-south, so it terraced along the line and went SHEER at the
  top and bottom of the hill, and `mountainpass`'s saddle broke into detached
  slabs. `tileHeightSvg` now takes `HeightNeighbours` (the eight neighbours'
  HEIGHTS, not "same" booleans) and lays band k = 1..h, lowest first.
  · Band k fuses with any neighbour at >= k. Where it stops it is pushed INSIDE
    the tile by `bandInsets` — `(k - n - 1) * TERRACE_BAND_INSET` (17u, capped
    at 35) — so the LOWEST contour a cell owes always lands ON the boundary and
    only the ones above it step in. That is the compatibility rule: a one-step
    ramp is inset by 0, i.e. every board authored before this renders
    unchanged, and only the multi-step drops gain the contours nobody authored.
    Closer contours = steeper slope, which is what a contour map means anyway.
  · So 1 -> 3 in one boundary is DRAWN as 1 -> 2 -> 3 without anyone having to
    pad the hill with rings. Don't "fix" a jump by requiring the intermediate
    ring in the data (validate/editor) — heights are per-cell, the renderer
    answers for the gap.
  · `patchPath`/`patchRimPath`/`patchSegments` take an optional per-edge
    `EdgeInset` for this; `corners()` applies it (both edges at a corner push,
    their normals are perpendicular so they compose) and `outwardRoom` takes it
    off the room a rounded corner may lean into — spend the whole tile and the
    sweep bulges back over the band below and eats the ring it sits in.
  · A band the next one up would cover EXACTLY (every neighbour already above
    it) is skipped: that is the plateau interior, i.e. most cells of a big hill.
  · Pinned in `tests/unit/tiles/heightTerraces.spec.ts`; `/test/terraces` is the
    side-by-side (stepped hill vs 3-step mesa) — the contrast IS the test.
- EVERY GROUND TERRACES, IN ITS OWN COLOUR (2026-08-03). The terrace was the
  meadow's green whatever the cell carried AND the view composed it BEFORE the
  terrain fragment — so every kind that paints an opaque patch covered it, and
  raising a wood/rock/massif/town changed the data, the grade and the chevrons
  and not one pixel of the ground. Only grass (which paints no fill) ever looked
  higher. Three parts, all in `tiles/terrain.ts`:
  · `heightTint(h, theme, kind)` anchors to `GROUND[kind]` when the kind paints
    its own ground, and only then falls back to the theme's `TERRACE_BASE`.
    Hue is untouched (hue is what says "wood" or "slate"); lightness climbs and
    saturation drops a little (aerial perspective). THE STEP IS A SHARE OF THE
    HEADROOM to white (13%, clamped 4..9 points), NOT a flat lift: 7 points flat
    was invisible on the forest's 30% and bleached the town's 68% tan to paper
    by step 3 — a hill town whiter than a depot roof.
  · The terrace is DRAWN THE WAY ITS GROUND IS (`edgeStyleOf(kind)`): organic
    contours for forest/rock/mountain/water, SURVEYED straight banks for
    farmland/urban/industry — weather shapes a hillside, people cut a bench.
    That needed `corners()` to stop returning early for surveyed ground BEFORE
    applying `bandInsets`, or a surveyed multi-step drop stacked every band on
    the same tile edge and showed one.
  · NO SOFT FRINGE except on grass. The fringe is a halo of the band's colour
    spilled downhill; over the backdrop it is a falloff, over an opaque patch it
    is a pale bar along the LOW side of every step — the light back to front.
  · COMPOSITION MOVED INTO THE GROUND BUILD (`Elevation` → `tileGroundSvg`,
    keyed into the memo by `elevationKey`): the terrace is spliced right after
    the patch fill and BEFORE the detail, so a raised field keeps its furrows, a
    raised rock field its scree and a raised town its paving — all ON the
    lighter step. Grass puts it first (it has no fill), which is byte-for-byte
    what the view used to emit, so every grass board renders unchanged.
  · NOTHING BUILDS ON A BANK (`terraceBanks`). Where a terrace stops, the
    ground breaks — a slope face on a hillside, a cut retaining wall in a town —
    and a block dropped across a step came out half on the upper bench and half
    on the lower one. The banks are pushed onto the SAME `blockers` list that
    keeps buildings off rails and roads, so the existing gate does the work: a
    block near a step shrinks to what fits the bench and one that fits nothing
    is dropped. BUILDINGS ONLY (urban/industry) — a wood that stepped back from
    every contour would be a wood full of bald rings.
    · TWO SOURCES, and the second is the trap: the first step off a summit lands
      on the SHARED boundary and is drawn by the UPPER tile alone, so the tile
      at the foot of that wall (whose buildings overhang the tile edge by
      TOWN_OVERHANG) knows nothing about it. Each side reads the same boundary
      from its own `HeightNeighbours` — mine falls to yours / yours rises above
      mine — so neither needs the other's neighbours. THAT is why a FLAT cell
      gets an `Elevation` too (`TileGround.elevation` no longer bails at h0).
    · The elevation must reach `tileScatterSvg`/`tileCanopySvg` as well, not
      just `tileGroundSvg`: scatter is built by its own call with its own memo
      entry, and threading it into the ground alone left the banks nowhere near
      the placement that needed them (they silently did nothing).
    · A DIAGONAL drop has no edge to fence: three cells level and the fourth
      not means nothing stops at any boundary this tile shares — the break
      belongs to the two tiles either side of the odd one out, and both banks
      run through the corner all four meet at. Fenced with a degenerate
      one-point corridor on that corner. IT DOES NOT BIND TODAY and the test
      says so: the urban band (26..74) plus the overhang cap already hold a roof
      ~18u off any tile corner, against a 7u disc. It is a guard for when those
      numbers move, which is why the test asserts the CORRIDOR rather than the
      picture. (The EDGE fences are the opposite — they genuinely move
      buildings, and the non-vacuity assertion beside them proves it.)
  · Pinned in `heightTerraces.spec.ts` ("terraces on terrain") +
    `terrain.spec.ts` ("elevated ground"); `/test/hillsides` is the picture —
    one slope, eight grounds, the grass row in the middle as the control.
- `isBlankCell` MUST count `height` (it does now): the editor's cleanup would
  otherwise silently drop a height-only cell and flatten the hill it was part
  of.

## EDITOR: the three-row build dock (2026-08-21)
- The dock is `BuildDock.vue` (presentational; EditorView owns ALL state):
  categories Rail / Road / Terrain / Bulldozer → tabs separating the verbs →
  items. Brush-like tools (terrain kinds, stall kinds, road widths 1L/2L/3L,
  traffic-light modes, bulldozer scopes) are ITEMS carrying their parameter —
  several items share one `Tool`, and `isActiveItem` matches on the PARAMETER,
  or every sibling lights up together.
- Traffic lights are pick-then-apply (`setJunctionSignalMode`), NOT the old
  6-state cycle (`cycleJunctionSignalMode` survives for back-compat). The
  lights tab default-arms Two-phase via a pre-seeded `itemByTab` entry — its
  first item is Off, and arming Off by default makes the first junction click
  DELETE lights.
- The bulldozer is layer-scoped: `eraseLayer(cell, "rail"|"road"|"parking"|
  "terrain")` in editOps. Road erase takes `parking` with it (rows sit on the
  kerbs of the street being removed); a structure (bridge/tunnel) goes with the
  LAST line it carried, and terrain erase drops it too (no bridge over grass).
  "Everything" is the caller's `delete level[id]`, not an EraseLayer value.
- The dock has a FIXED width (880px desktop) so the category row never shifts
  when tabs of different widths open; the camera's bottom inset is MEASURED off
  `.build-dock-wrap` (the old constant 128 predates the three-row dock).
- Keys 1–4 pick categories (guarded: not from INPUT/TEXTAREA, not with a
  modifier); each category remembers its last tab + item per session.
- e2e tests must open the right TAB before clicking a tool button — Depot is
  Rail→Stations, Signal Rail→Signalling, the erase ✕ handles are Bulldozer
  (default filter Everything; rail ✕ only shows for scope all|rail).

## PLAY: the in-play build dock (2026-08-21)
- PlayView reuses `BuildDock.vue` with `compact closable` (TF manner): a slim
  Build handle flush with the bottom edge while watching; opening it shows the
  dock with the PLAY verb set only — Rail→Track (`game.buildRoute`) and
  Bulldozer (`game.bulldoze`). Opening always ARMS a tool; category switch
  re-arms (that is the Build/Bulldoze exclusivity); Esc finishes the open
  route, a second Esc (or ✕) closes and disarms everything.
- `compact` puts the dock in normal flow (host positions it), sizes to content,
  and moves the hint INSIDE the items row; `closable` renders the ✕
  (`data-testid="build-dock-close"`). Both props need their `type: Boolean`
  (see the bare-attribute trap above).
- RULE: nothing may stack ABOVE the play dock — every pixel over it is board a
  click can no longer reach (the undo pill above the dock broke the lakevalley
  e2e build; Undo now docks in the `actions` slot while the dock is open).
- Which modes see the dock = `mode.controls.build` (sandbox, tycoon, citizens).
  Per-mode tool sets layer on `playDockCategories` when play gains more verbs.

## EDITOR: heights & flyover tools (2026-07-31)
- The HEIGHT brush (Terrain drawer → 🔼/🔽) paints ±1 per cell PER STROKE —
  `heightStroke` remembers where the drag has been, because re-applying ±1 on
  every mouseenter staircases a wobbling drag (the terrain brush never had this
  problem: setting a kind is idempotent, shifting a height is not). Clamped
  0..MAX_HEIGHT (3). Lowering the last content deletes the cell (isBlankCell).
- The FLYOVER verb (Rail drawer → 🌉) cycles flat → pair A over → pair B over →
  flat, and ONLY on a diamond crossing (`flyoverEligible`: exactly two
  connections over four distinct edge ports). Every connection reducer funnels
  through `pruneFlyover`, so deleting or switching a line can never leave a
  stale deck naming a connection that is gone.
- The editor's `stubGame` MUST carry `levelVersion: ref(0)`: Tile.vue's
  neighbour-aware getters (tunnel portals, grade chevrons) read it, and the
  stub is `as unknown as Game` so the type system will not catch the omission —
  the first tunnel or hillside rendered in the editor throws instead.

## INDUSTRY (2026-07-28)
- 8th kind, buildable, factor 2 (between farmland 1.2 and urban 2.5). The
  freight half of the world — the ground a depot will one day read to decide it
  ships goods rather than people. The DEMAND COUPLING IS NOT BUILT: design in
  `docs/superpowers/specs/2026-07-28-industry-and-demand-design.md`.
- It must not read as a darker town. Different VOCABULARY, not tone: circles and
  grids (silos, tanks, container stacks, vented sheds) in cool steel/concrete,
  laid SQUARE to the yard (±4°) — the town is pitched roofs in warm tile jittered
  ±12°, because a village grew and a plant was planned. Check them side by side
  in `/test/industry`, never alone.
- Same fit-the-room placement as the town (`worksBuilding`, shared `blockers`
  list), so the two kinds cannot drift apart in how they pack.
- A pitched roof shades its far half 18 points down, so a shed pitched at the
  town's lightness comes out near-BLACK on the works' own grey ground. Works
  sheds are lit 8 points higher for that reason.
## MEADOW — WHAT GROWS ON PLAIN GRASS (2026-07-28)
- GRASS STILL PAINTS NO FILL. That rule has not moved and must not: a grass
  rect (or a patch outline like every other kind draws) covers the world
  theme's backdrop on EVERY tile in the game. What changed is that grass now
  grows things — tufts, flower drifts, bushes, the odd thorn tree, plus
  translucent `sward` blobs — all ADDITIVE. `buildMeadow` is its own build,
  branched before `buildGround`'s `!base` return; it emits no fill, no rim and
  no clip, and terrain.spec pins exactly that (every path it lays carries
  opacity < 0.45).
- NO PATCH means no containment walk: there is no outline to keep objects
  inside, so placement is the plain band and the corridors. Corridors DO still
  apply — a tuft in the ballast is as wrong as a tree.
- HOW MUCH grows comes from `meadowRoughnessAt` — the same value noise as the
  glades, on a 4-tile lattice with its own salt. That is the only shape of
  unevenness allowed here: a function of WORLD position, so it varies across
  the board and never changes AT a tile boundary (which is what disqualified
  per-tile tone variation — see the note by GROUND). Close-cropped stretches
  get ~2 objects, tussocky ones ~11, and flowers/bushes/trees only appear as
  roughness rises. Pinned: the count varies across a row, and neighbours differ
  by less than the whole range (a gradient, not noise).
- `valueNoiseAt(wx, wy, seed, cell, salt)` is the shared generator behind both
  fields; add a salt rather than a second implementation.
- THE REAL ANSWER TO "the open green is boring" IS FARMLAND, not the meadow.
  Fields cover ground; the meadow only stops what is left reading as a lawn.
  Judge both on a THEMED shot (`npm run shot -- <id> --backdrop`) —
  the flat debug backdrop makes the meadow look far more prominent than it is.
## FARMLAND (2026-07-28)
- 7th kind, buildable, `TERRAIN_BUILD_FACTOR` 1.2 (between grass 1 and forest
  1.5 — you buy the field off the farmer). Wire-through for ANY new kind:
  `TerrainKind` in model.ts, `TERRAIN_KINDS`, `GROUND`/`RIM`, `SCATTER_COUNT`,
  `SCATTER_BAND`, `FOOT`, `BLOCKS_BUILDING`, `TERRAIN_BUILD_FACTOR`, the editor
  palette, `generateTerrain.ts`, a /test scenario. The terrain.spec sweeps
  iterate `TERRAIN_KINDS` and catch most omissions.
- ALL GROUND MARKS, NOTHING STANDS ON IT (`SCATTER_COUNT.farmland = [0,0]`) —
  which keeps farmland out of the corridor and canopy rules entirely. Ballast
  and tarmac simply draw over the furrows, which is what a railway cut through
  a field looks like from above.
- FURROWS ARE SEEDED BY A COARSE WORLD LATTICE (`fieldPlanAt`, FIELD_CELL = 3
  tiles), never by the tile — same trick as the glades. Per tile, every tile
  edge becomes a field edge and the ground redraws the grid the jittered patch
  outlines exist to hide. Per lattice cell, neighbouring tiles share a bearing
  and their furrows RUN ON across the seam; the patchwork comes from the cells.
- A BAND IS A FINITE BAR AND MUST BE ANCHORED OVER THE TILE. First version
  anchored each band at the point closest to the WORLD ORIGIN and drew it 1.5
  tiles long, so tiles a few hundred units away were missed entirely: striped
  near the origin, flat green everywhere right of it. Project the tile centre
  onto the furrow direction and centre the bar there. Pinned by a test that
  counts bands on a far tile.
- DRAW BOTH TONES, EVERY BAND — not crop stripes over the base fill. Drawing
  every other band lets the base show between, so a cell whose crop lands near
  the base tone comes out blank while its neighbour stripes boldly. And give
  the two tones 12 points of lightness, not 6: at 6 the green crops were flat
  olive tiles indistinguishable from the grass they replace. Contrast is a
  property of the FIELD, not of where its hue landed. Pinned.
- Hedgerows run ALONG THE FURROWS (or square across them), never at a free
  angle — a hedge is a field boundary. Free-angled they read as dark
  caterpillars dropped on the crop. /test scenario: `farmland`.
## TOWN SCALE (2026-07-28)
- THE RULER IS THE CAR. A tile is 100 ground units and a car is 23 of them
  (`DEFAULT_CAR_LENGTH` 0.23 tiles). The first town's houses were 14-20 units
  wide — NARROWER THAN THE CARS driving past them, so the board read as a model
  village with full-size traffic in it. Sizes are now pitched against that: a
  house ~1.5 car lengths on its long side, a terrace 3, a hall 3.5. Pinned by a
  terrain.spec test that parses roof rects out of the scatter SVG.
- THE ARCHETYPE IS CHOSEN TO FIT THE ROOM MEASURED AT THE SPOT (`TOWN` +
  `building(rng, scale, room)`), not fixed per tile. That is what lets buildings
  be building-sized at all: sheds and houses take the street frontage where the
  corridor leaves little room, terraces/blocks/halls take the depth of the block.
  A single fixed footprint could only ever be small enough to fit everywhere.
- `FOOT.urban` is therefore the SMALLEST archetype's reach, not the largest
  (`URBAN_SMALLEST_REACH`, pinned). Gate on the biggest and every frontage in the
  game empties out.
- A PLACED BUILDING IS PUSHED BACK ONTO THE CORRIDOR LIST as a degenerate
  one-point corridor (`{pts:[p,p], half: reach}`) — so "don't build on the
  railway" and "don't build on the house next door" are ONE test. Without it,
  building-sized buildings simply pile on top of each other (2-4 per tile at the
  new footprints). `distToPolyline` needs TWO points, hence `[p, p]`.
- The TILE EDGE counts as room too, plus `TOWN_OVERHANG` (10u): a tile cannot see
  its neighbour's scatter, so without it a terrace lands on the next tile's block.
  Some overhang is wanted — it is what makes a town continuous across tiles.
- Archetypes: shed, house (lean-to + chimney), terrace (3-5 party-walled units —
  the one that most says TOWN from above), block (parapet + rooftop plant + light
  well), hall (roof-light strips), church (slate nave + tower, rare, the landmark
  that gives a town a centre). /test scenario: `townscape` (town + street + cars).
## HAND-PAINTED TERRAIN (demoworld, 2026-07-28)
- The DEMO world's ground is authored, not seeded: `GROUND` in demoworld.ts is a
  list of `{kind, cells}` built from `rect()`/`without()`, painted by
  `paintGround` as the LAST step of `build()` so it sees everything already laid.
  Composition beats a seed for the one board that is the shop window; procgen
  (`generateTerrain.ts`) still owns generated + Daily boards.
- ENFORCE THE BLOCKER RULE, DON'T DODGE IT: `paintGround` SKIPS a blocking kind
  (water/rock/mountain) on any cell carrying `connections` or `road`. That is what
  lets a region be a plain rectangle — the railway simply interrupts the lake
  instead of the board failing `validateLevel` — and it means a later change to
  the ring or the streets cannot invalidate the ground.
- PAINT FOREST/URBAN STRAIGHT OVER RAIL AND ROAD, deliberately. Since corridors +
  canopy (see KEEP-OUT CORRIDORS), a line through a wood clears its own
  right-of-way and gets crowns over it, and a street through town steps the houses
  back. Ground kept OFF the built cells instead stops dead at every line and reads
  as track laid on scenery. Leave the DEPOT cell bare inside a wood, though — the
  depot building wants its own clearing.
- demoworld is ~16% unbuildable (SW lake, tarn, SE rock, NW range), inside the 22%
  `generateTerrain` allows itself — the same reason applies to an authored board:
  the build tool has to have somewhere to go.

## THE MODE ROSTER (#113/#114/#115 + review round, 2026-08-21)
- `MODES` (`modes/index.ts`) is the PICKER, not the mode list: five pillars
  (puzzle, tycoon, network, citizens, sandbox). Two rulesets ship UNREGISTERED —
  **Daily** is a BOARD SOURCE (`?board=daily`, the picker's chip) and **Time
  Attack** is a PUZZLE VARIANT any roster with a `spawnAtSec` triggers. Neither
  is reachable through `modeById`; both are imported directly where needed.
- `?board=daily` WINS over an explicit `?mode=` (`?mode=sandbox&board=daily`
  runs the daily ruleset). The daily board IS the daily ruleset.
- BOARD CAPABILITIES ARE DERIVED, never stored per board:
  `boardCapabilities(level, trains)` (`modes/compat.ts`) counts stations, depots,
  bus stops, homes, workplaces off the tiles + roster; a mode declares
  `fits(caps)` and the picker greys unfit cards while the URL guard downgrades
  unfit pairs. So a board built in the editor is judged exactly like an authored
  one, and no author maintains a per-board mode list.
- The derivation is NOT free (walks every tile, floods the towns, rolls a
  per-plot RNG). Test `mode.fits` for EXISTENCE first and short-circuit — Sandbox
  and every no-`fits` mount must not pay for it.
- THE PICKER MUST JUDGE THE BOARD THE PICK LANDS ON, not the one on screen.
  `pickMode` carries `?board=` across, EXCEPT `daily`, which it drops (picking a
  ruleset there means leaving today's board) — so on the daily board fitness is
  judged against `custom ?? DEFAULT_LEVEL`. Judged against the daily blob it
  LIED: generated boards nearly always have a town, so Citizens showed enabled
  and the click landed on the town-less default and downgraded to Puzzle.
- PERSIST THE REQUESTED MODE, NOT THE RESOLVED ONE (`saveLastModeId` in
  PlayView's `mounted`). Saving the guard's fallback erases the preference: play
  Network on a station board, open plain `/play` once, and Network never reopens.
- RUSH CAP ≥ THE BOARD'S OWN BACKLOG. `objectives.ts` seeds `active` from
  `initialActiveTrains` and fails on the FIRST `observe()` once it exceeds
  `fail.maxActiveTrains` — so `Math.max(MAX_ACTIVE_TRAINS, initialActive + 1)`,
  or a board with 5 unscheduled trains plus one scheduled arrival is lost at t=0.
  Since #113 nobody opts into this ruleset; a `spawnAtSec` anywhere triggers it.
- `campaign.ts` pins its OWN `modeId` per level, independent of the scenario's
  (PlayView ignores `scenario.modeId`). `compat.spec.ts` sweeps CAMPAIGN as well
  as SCENARIOS, so a mismatched entry fails CI instead of silently downgrading.
- `crossingGate` (`ModeControls`) is DECLARED BUT UNREAD since Crossing Keeper
  was retired (#121): every mode sets it false and the worst-car-wait HUD it
  gated is gone. `maxCarWaitSec`/`carsDelivered`/`crossingIncidents` are still
  filled every tick and read by NOTHING — no mode scores the road layer.

## THE /test MODE GALLERY (#115, 2026-08-21)
- `challenges/modes` is ONE DEMO PER RULESET, each actually running it (six:
  `daily`, `objectives`→puzzle, `dispatch`→tycoon, `networkmode`, `threecities`
  →citizens, `timeattack`). That is MORE than the picker roster — the two
  unregistered rulesets bracket the four objective-carrying pillars. Sandbox
  needs no card: it is the stage's default, so a card would demo the absence of
  rules. `scenarioCoverage.spec.ts` pins BOTH halves — no mode twice AND every
  registered non-Sandbox mode present (one half alone let a new mode ship
  card-less and stay green).
- `TestStage` renders the mode's SCOREBOARD on the control strip (there are no
  overlays at /test and the stage auto-starts), and EVERY piece is gated by the
  mode's `HudDescriptor` — deliveries included. Network sets
  `deliveries:false, passengers:true` to REPLACE the delivery card; ungated it
  showed a meaningless `Delivered 0 / 1` beside the passenger count.
- THE DAILY SCENARIO PINS A DATE, NOT A SEED (`dailyModeFor("2026-06-15")`, and
  the same in `daily.spec.ts`). Pinning the date exercises the whole
  date→seed→board→colours pipeline; pinning a seed would skip the half that
  actually varies. Only the "resolves the date at setup time" case runs `today`.
- `createGame` takes the VIEW's colours and ignores the ones `setup()` returns,
  so a scenario whose mode pins colours must repeat them in `scenario.colors`.

## CAMPAIGN (2026-07-27)
- `src/campaign.ts` is the whole shell: an ordered `CAMPAIGN`, an unlock rule, a
  star total. Headless and pure, so the progression is unit-tested without a DOM.
- NO NEW PERSISTED KEY. Unlock is DERIVED from `objectiveStore`, which PlayView's
  phase watcher already writes on a win under `board:<scenarioId>`. So "cleared"
  is `loadBest(...) !== null`. A second store would be a second source of truth.
- CLEARED IS A NULL CHECK, never `stars > 0`. A scraped zero-star win is a win;
  gating on a star would strand a player who beat a board the hard way.
- A campaign level IS a /test scenario id — no new board plumbing. But the entry
  MUST carry its own `modeId`: `PlayView` resolves the mode from `?mode=` or the
  last-used mode and IGNORES `scenario.modeId` (only `TestStage` honours that),
  so a level pushed without it silently runs under whatever was played last.
- Navigation is `$router.push({name:"play", query:{mode, board}})`. `App.vue`
  keys the router-view on the full path, so a query change fully REMOUNTS
  PlayView and every class-field initialiser re-runs against the new hash.
- A TYPO IN A LEVEL ID FAILS SILENTLY, twice over: `scenarioById` returns the
  registry's FIRST entry for an unknown id, and PlayView falls through to the
  default board. Hence the unit test asserting every id is in `SCENARIOS`.
- SEED LEVELS MUST BE PROVEN WINNABLE — the unlock rule is a chain, so an
  unwinnable level is a wall across the whole campaign, not a hard level.
  Measured 2026-07-27: `dispatch` and `faredistance` deliver ONE of their two
  trains and then run forever (`mismatchedArrivals` climbing — the second train
  bounces off a deliberately mismatched depot). They are shuttle demos of a
  mechanic, like `/test/rollingstock`, NOT levels. Only boards with an e2e that
  reaches `phase === "won"` are seeded.
- `CampaignView` reads storage ONCE in `created()` into plain fields. Getters are
  cached computeds over a non-reactive source — it would freeze at its first read.
- It is a SCREEN (`/campaign`), not a mode: a `GameMode` is a ruleset with a
  `setup()` to run, a campaign is an index over boards.

## GOALS ON THE READY CARD (M9, 2026-07-27)
- A STAR PREDICATE IS TRUE BEFORE THE RUN. `stars()` evaluates every predicate
  over `zeroCounters()`, and most goals hold trivially there — "no signal was
  overridden" and "no train went to the wrong station" are both true of a run
  that has not happened. So NOTHING scored may be shown in the ready phase.
  This had already shipped as a bug: the HUD's `.score-stars` pip row rendered
  behind the (translucent) Ready overlay with 2 of 3 pips gold. Now gated on
  `phase !== "ready"`, pinned by an e2e asserting `.score-stars` count 0 there.
- Hence TWO types, not one. `GoalSpec {id,label,hint?}` = the target, from
  `goalsOf(spec)`, built ONCE into `game.goals`. `StarState {id,label,earned}` =
  the score. `<GoalList>` renders both: `:earned` is an array of ids the Ready
  card simply omits, so earned-ness is not a boolean anyone can pass backwards.
- `game.goals` is a PLAIN FIELD, and that is safe here only because
  `mode.setup()` runs exactly once — `reset()` rebuilds the sims and the tracker
  but never re-runs setup. (Contrast `get sim()`, which must be a getter.)
- `hint` lives on `StarSpec`, NOT `StarState`: `stars()` allocates fresh objects
  every `state()` call and the loop assigns them over the reactive objective
  every frame. Don't widen the frame-hot object for a string only a card reads.
- LABELS CARRY THEIR NUMBER (`Speedrun (40s)`, `Payday ($1,700)`). Four of six
  modes shipped targetless labels; a goal list reading "Speedrun / Hands off /
  Perfect colours" tells the player nothing they can aim at.
- The Ready card is a /play surface. `TestStage.vue` renders no overlay and calls
  `startObjective()` in `mounted()`, so this feature CANNOT be shown at /test —
  the honest demo is `/#/play?mode=tycoon&board=lakevalley-open`.

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
- The fare falls as a STAIRCASE, not a slope: `DEFAULT_FARE_STEP_SEC` (=4s, the
  middle of TV's 3–5s feel) quantises `fareAt`, so the pin holds a number and
  then drops it in one chunk. `decayPerSec` is still the BALANCE dial and the
  staircase tracks it to within one step (sizes round to $5) — changing the
  step never moves a Payday target, changing the rate does. Per-fare override
  `FareSpec.stepSec`; 0 = the old continuous curve. Measured on
  `lakevalley-open`: −$20 every 4.0s, vs ~6 one-dollar flickers a second before.
- FARES ARE PRICED FROM THE DEMAND, not the consist alone (2026-07-26):
  `base = FARE_HANDLING + FARE_PER_WAGON[type] * wagons + FARE_PER_TILE * demandTiles`
  and `decayPerSec` is DERIVED — the decayable part spread over `fareGrace` x
  ideal travel time. So a long haul is a bigger prize AND burns slower per
  second; those two together are what stop distance from being a pure penalty.
- `demandTilesOf` is MANHATTAN between the depots the level paired, deliberately
  NOT the rail path: on a build board the rail does not exist at setup (a path
  query answers null exactly when it matters), and a straight-line price cannot
  be inflated by routing the long way round.
- The mode only sees `TrainDef`, which carried no destination. `destinations` is
  plumbed from `TrainObject.routeDestinations` in all THREE builders (PlayView,
  TestStage, modes/daily) — miss one and every fare there silently falls back
  to `FALLBACK_DEMAND_TILES`.
- The per-board dial is `TycoonTuning.fareGrace` (ideal trips a fare survives),
  not money/sec: 4 generic, 8 on lakevalley-open. Being measured in TRIPS it
  means the same thing on a 3-tile test lane and a 20-tile ring.
- Payday is the ONLY goal that money-and-time eats — RE-MEASURE it in a real
  browser after any pricing change. lakevalley-open 2026-07-26: prompt run
  $2,040 of $2,440 max, sent-60s-late $1,140, all-floors $611 ⇒ target $1,700.
- lakevalley-open's three demands form a 3-CYCLE (each train's destination is
  another train's shed), so it CANNOT be played one train at a time — a
  serialized measurement run deadlocks at the first arrival. Send all three.
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

## THE SECOND CLOCK — calendar + annual tax (2026-07-26)
- `sim/calendar.ts` is pure: `calendarAt` (a date off `elapsedSec`), `leviesDue`
  (whole years completed), `taxFor(spec, pieces)`. `game.ts collectTax()` is the
  only wiring. Nothing here touches the sim's hot path.
- THE TAX IS PER PIECE OF PLAYER-LAID TRACK, never a flat sum. A flat annual levy
  is a steeper fare decay wearing a hat — it pushes the SAME way (hurry) and the
  player decides nothing about it. Upkeep on the network you chose to build is
  what makes §1.3's two clocks OPPOSED (fare decays ⇒ hurry; tax accrues ⇒ build
  lean). Taxing the AUTHORED board would be a constant nobody can act on — and
  as a bonus, per-piece means a dispatch-only board pays 0 with no special case.
- THE TRAP, and it is easy to miss: `economy.spend()` increments `spent`, and
  "Under budget ≤ $6,000" read `spent`. Book the tax as a spend and that star is
  lost by DAWDLING instead of by over-building — it silently stops measuring the
  build and starts measuring time, which is the axis Payday already scores. Fix
  taken: `Counters.trackSpent` / `MoneyState.trackSpent` (money on track, net of
  bulldoze refunds, kept beside `tilesBuilt` and netted by the same rule), and
  the star reads THAT. The tax stays in `spent`, so the ledger still means "all
  outgoings" and still sums to the balance. Rejected alternative: exempting tax
  from `spent`, which redefines a documented field and breaks that identity.
- Levies are billed in a `while`, not an `if`: one frame at 4x (or a headless
  `advance()` with a big dt) can cross several year boundaries, and a skipped
  levy is silent free money. Gated on `objective.phase === "playing"`, same as
  the fares — nothing accrues behind the Ready card.
- A levy larger than the balance TAKES WHAT IS THERE (`Math.min(owed, balance)`).
  `spend` refuses an unaffordable amount, so booking it whole would make being
  broke FREE. Balance floors at 0; there is still no bankruptcy state.
- TUNE ON A MEASUREMENT, NOT ON TASTE. Both settings that shipped were the second
  guess: 20s/year let the prompt lakevalley-open run finish inside its SECOND
  year, so a winner paid the levy once (a fee, not a clock) → 15s. $200/piece
  then ran the dawdling line to −$400 of capital before its fares landed, i.e. no
  rescue build affordable, i.e. a silent soft-lock → $150. The "every line keeps
  ≥$1,000 of capital" floor is pinned by `tycoon.spec.ts` so the next tweak
  cannot quietly cross back. Measured, lakevalley-open (15s/yr, $150/piece):
  prompt full rebuild won 35s / $2,100 tax / balance $7,660; dawdled 60s first,
  won 95s / $6,300 tax / balance $2,566. Upkeep on a prompt run ($2,100) exceeds
  what it earns ($1,760) — that is the sentence the mechanic exists to say.
- `game.advance(dt)` is the frame body MINUS rendering, extracted so the loop is
  drivable headlessly (`tax.spec.ts`). `game.sim.step()` moves trains only — it
  runs no fares, no levy, no tracker. Use `advance` for anything loop-shaped.
- HUD: the calendar REPLACES the stopwatch where a board has one (M13 is
  literally "a calendar clock, not a stopwatch", and both render the same
  elapsed seconds). Two rows total — balance, then date + upkeep. The row is
  `:key`ed on `money.taxPaid` so its animation replays exactly once per levy; a
  balance that drops silently is the one thing a money HUD must not do.
- CALENDAR IS PER-BOARD (`TycoonTuning.calendar`), NOT mode-wide. The generic
  tuning has none: the boards falling through to it are the one-mechanic test
  scenarios on a $3,000 budget, where a levy both muddies the lesson and
  dominates it. `/test/taxyear` teaches the mechanic (10s year, $300/piece,
  $9,000 purse — dialled for watching, not for balance).

## UNDO vs BULLDOZE (2026-07-27) — two verbs, so each price can be honest
- They were ONE verb (bulldoze, refunding in full) and that is why the price was
  wrong: it had to double as the escape hatch for a MISDRAG. A misdrag is an
  INPUT ERROR, not a world event — every builder that solves it well solves it
  with Ctrl+Z, not with economics. Split:
  · `undoBuild()` reverses a PURCHASE — rails go, full money back as an
    `adjustment`, no fee, and `trackSpent`/`tilesBuilt` both fall because the
    buy never really happened.
  · `bulldoze()` removes a RAILWAY — costs `CLEARING_COST_PER_TILE` (=300, 30%
    of the build price), never pays, and books under the `"clearing"` reason
    that `economy.ts` had reserved. `trackSpent` does NOT fall: you spent that
    money, and "Under budget" must not be winnable by building wide and razing
    the evidence. `tilesBuilt` DOES fall — it counts the railway you kept.
- The undo window closes on what the PLAYER does — next build replaces it, a
  bulldoze or a DISPATCH drops it — never on a clock. A window that closes by
  itself is an invisible timer, which is the thing undo was chosen over. Only
  the LAST gesture is undoable, so "undo the level at the end" is not a strategy.
- TRAP (cost a browser round trip): a gesture can buy NOTHING and must then NOT
  replace the window. The Esc-finish whose terminus duplicates existing rail
  fires after every real gesture, so recording it as "the last purchase" set the
  window to 0 pieces and the undo control vanished the instant the drag ended.
  Guard is `if (pieces > 0)` in `buildRoute`; pinned by a unit test AND an e2e,
  because it only reproduces through the real gesture.
- The view reads `game.undoable` (a Ref), not `canUndoBuild()`: `game` is
  markRaw'd, `lastBuild` is a closure variable, and DISPATCH clears it without
  touching `levelVersion` — so there would be nothing to re-evaluate on. Keyed
  on `pieces`, not `value`, because Sandbox builds free and a $0 undo is real.
- Clearing is priced ABOVE a year's upkeep on the same piece (300 vs 150 on
  lakevalley), so razing surplus pays for itself only with years left to run.
  That is the decision the two prices make together — and it is why the
  insolvency warning names DELIVERING first: clearing is an escape route that
  itself needs money, and `bulldoze` refuses a fee the balance cannot cover.

## BANKRUPTCY (2026-07-27) — the tax's other half
- BANKRUPT = OWING MORE THAN YOU HAVE, never "the balance reached zero". That
  distinction is the whole design: measured lines finish flat broke with the
  railway built and the trains running, and that is a tight WIN, not a failure.
  The fail condition is a LEVY the balance cannot cover (`Counters.unpaidTax`,
  `ObjectiveSpec.fail.onBankruptcy`). Only the tax can produce it — an
  unaffordable BUILD is refused up front, and a refusal is a choice.
- Declared for the whole Tycoon mode, not per board, because it is SELF-GATING:
  no calendar ⇒ no levy ⇒ no shortfall ⇒ it can never fire. `buildgap` and
  `/test/dispatch` carry the flag and are untouched by it.
- The company PAYS WHAT IT HAS on the way down, then folds; billing STOPS at the
  first shortfall. Piling every later levy onto the total would say nothing more
  ("$18,000 short" vs "$600 short" — the run is over either way) and would make
  the number meaningless as a diagnostic.
- THE WARNING IS THE FEATURE, not the Failed screen. `money.taxUnaffordable`
  (`taxPerYear > balance`) turns the calendar row red with "can't pay next year"
  a full in-game YEAR before the bill lands. Without it the fail state is an
  ambush; same lesson as the gridlock nudge (name the failure AND the fix).
  Deliberately literal — it does not try to predict fares.
- The fix it names is DELIVERING, not clearing. Fares are the income; clearing
  track costs a fee (see UNDO vs BULLDOZE) and `bulldoze` refuses one the
  balance cannot cover, so it is an escape route that itself needs money. It is
  also only an escape where there is SURPLUS — razing a piece of a minimal link
  just re-opens the gap. Wording was corrected on 2026-07-27 when the refund
  became a fee and the old advice ("bulldoze") stopped being reliable.
- `/test/bankrupt` is the scenario ($6,000, 8s year, $600/piece — the annual
  bill is a countdown, not a drip). Measured: prompt run won 15.7s banking
  $3,315; relaxed won 24.7s banking $855; dawdling folded at 32.0s, $800 short,
  warned from 24s. Playable at `/#/play?mode=tycoon&board=bankrupt`.
- Fail checks are ordered, and bankruptcy goes FIRST (after the win check, which
  still wins ties): "you ran out of money" beats any symptom another check might
  notice on the same tick. A knock-on worth knowing: a board that DEADLOCKS in
  Tycoon now eventually folds instead of stalling forever — the gridlock nudge
  still fires first and names the real cause.
- The DEFAULT board needs the player to throw switches: left alone, both trains
  lap and bounce off wrong-coloured depots forever. That is PRE-EXISTING and
  identical in Puzzle (measured: both modes 0 delivered / 3 mismatches at 60s) —
  don't read it as a Tycoon routing bug when a headless run never completes.
## PARKING (cars stop, 2026-07-26)
- WHOLE-FRACTION PITCHES REPEAT AT THE SEAM (2026-08-21): a packed row starts
  at the tile's leading edge, so only a pitch that divides the tile exactly
  fills it — `parallel` is 1/3 (three bays, no orphaned stub of kerb that read
  as a fourth bay cut off mid-box) and `bikerack` 1/16. Two parking tiles side
  by side then repeat as one continuous rank. A non-dividing pitch leaves a
  stub the apron's seam extension paves anyway, which is the "cut-off bay"
  playtest report. The truck/coach that would "fit" the roomier 66.7px box is
  still refused by the bay-CLASS gate, not by size.
- THE PAINT LIVES IN `TileParking.vue`, not `Tile.vue` (moved 2026-07-27). It needs
  THREE z-layers and cannot be dropped in at one point, so it is one component
  with a `layer` prop the caller places three times: `apron` (under the road's own
  kerb line + markings, so bays read as a widening of the street rather than a
  slab beside it), `paint` (bay lines, outer kerb, garage mouths, bus markings)
  and `sign` (the "P 3/12" chip, an HTML overlay OUTSIDE the road SVG). Geometry
  is recomputed per instance — path strings, on parking tiles only, gated by
  `Tile.vue`'s `hasParking`. `kerbFor` moved with it and still mirrors
  `tiles/parking.ts kerbOffsetAt` through the injected Game: keep them in lockstep
  or the painted bay and the driven curve disagree about where the kerb is.
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
    a crossing trips any `maxCarWaitSec` fail (30s in the retired crossing-keeper
    mode; the counter lives on in sim/objectives.ts) while behaving perfectly.
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
- LEAVING A BAY BUYS NO RIGHT OF WAY (2026-07-27). The dwell ends and the car
  WAITS IN ITS BAY: phase stays `parked`, so it has no road body and nobody brakes
  for it. It claims the slot and rolls in the same moment, once the slot is
  genuinely clear. `dwellLeft` keeps counting DOWN past zero, so `-dwellLeft` is
  the wait — no second timer, and `cars()` exposes it because that number is the
  whole acceptance test.
  · THE COURTESY YIELD IS THE OTHER HALF (`courtesyClaims` → `clearAhead`). After
    `courtesySec` (4s) the drivers behind stop short of the leaver's slot. At the
    shipped density it costs nothing and shortens the worst wait (parkingkerb s1
    7.0 → 5.3s); at 2.5x traffic it is what keeps a leaver from starving —
    parkinglot without it 4-9 cars still waiting at 200s, worst 45.8s, average
    10-13s; with it 3-4, worst 9.6-33.4s, average 2.9-5.8s. It trades throughput
    for fairness under saturation (125 → 87 cycles at 2.5x) and is neutral at 1x
    (606 → 610 cycles across twelve runs).
  · ONE LEAVER AT A TIME PER CAR PARK, the same serialisation the entering
    barrier runs on, and for a sharper reason: bays are 28px apart and a car is
    38px long, so on a rank of 90° spaces EVERY place a yielding driver can stop
    is inside SOME neighbour's slot. Let three ask at once and the driver who
    stops for one blocks the other two, who are holding the queue that is holding
    the first. Measured on parkinglot seed 4 at the slower reverse: 88s of total
    standstill, three cars 22-38s past their dwell. Longest wait first, ties by id.
  · THE COURTESY STOP LINE NEEDS DAYLIGHT (1.5 x CAR_GAP, not 1). At exactly one
    gap the yielder's nose lands on the SAME number `slotFree` uses as its
    window's rear bound, computed by different arithmetic (rearT − gap vs
    slot − len − gap), and the last ulp decides whether the leaver reads its own
    helper as a blocker. Measured: car21 parked at [.., 0.0300] against
    rear = 0.0300 and vetoed the car it had stopped for, for 3045 straight ticks
    — a permanent wedge of the whole map.
  · PHANTOM-CLAIM SENIORITY MUST BE THE COURTESY ORDERING (longest wait, ties by
    id — `slotFree`'s readyToo). It shipped as plain lowest-id-wins, and the two
    orderings disagreeing is a deadlock cycle: the queue yields to A (longest
    wait), A is vetoed by junior B's phantom claim, B is blocked by the queue.
    Measured as a permanent wedge on parkinglot seed 5 (three leavers ready at
    once). One ordering, everywhere a leaver outranks a leaver.
  · A STANDSTILL PREDICATE MUST COUNT `manoeuvre` PROGRESS AS MOTION.
    `advanceParking` pins `velocity` at 0 while the CURVE moves the car, so with
    reversing at a real crawl a healthy car park reads as a dead map on velocity
    alone. This predicate has now been blind in both directions once each —
    `c.speed` could never fire (cruise, never zero), velocity-only cries wolf on
    cars that are visibly parking. Fixed in parking.spec's liveness test AND
    roadScenarioSweep; any new "is anything moving" check reads velocity OR a
    manoeuvre delta.
  · THE TWO GAPS MUST AGREE OR THE HELPER BECOMES THE OBSTACLE. Measured: with the
    claim gate counting a STOPPED car against `pullOutGap` (0.16) while the
    courtesy yield stopped one at CAR_GAP (0.06) behind the slot, the courteous
    driver parked itself inside the window the leaver tests — 115s of total
    standstill on parkinglot seed 5, three cars never out. The margin is BRAKING
    room, so it applies to moving traffic only; a stopped car is measured against
    the slot itself. And a driver ALREADY level with the slot carries on rather
    than braking to 0 inside it — the one behind yields instead.
  · An over-saturated single-lane aisle still deadlocks at 2.5x traffic, and did
    BEFORE this rule too (parkinglot baseline: 122.6s all-stop on seed 3). Do not
    read a heavy-density gridlock there as this rule's doing.
  · The history, kept because the numbers are still the map of the space: the
    ORIGINAL design claimed the slot at full length the moment the dwell ended and
    let traffic brake for it, and every shortcut off it measured worse at the time
    — claiming only once rolling was a no-win dial (0.5-tile gap ⇒ 12 parked / 2
    ever out on `parkinglot`; 0.16 ⇒ real clips; 0.175 ⇒ the patience valve barges
    into traffic). What dissolves that trade-off is not the gap size but the
    courtesy yield: with it, 0.16 drains fine and nobody is braking for a car that
    has not moved.
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
    one flag: the rendered heading is the tangent turned round, and arc length
    falls out unchanged.
  - REVERSING IS AN ABSOLUTE SPEED, NEVER PACE-SCALED (`REVERSE_PACE` 0.75 x the
    0.16 t/s base crawl = 0.12 t/s, 2026-07-28). This constant shipped WRONG
    once, as a multiplier on the pace-scaled speed, and the two cancelled: `pace`
    speeds a path up in proportion to its length so gentle curves take constant
    TIME, the pivot-reverse path is long (pace ≈ 3-4), so cars backed into 90°
    bays at up to TWICE the crawl they nose in at, and the echelon back-out
    (pace ≈ 2) overtook its own pull-in. "The backwards parking move is way too
    fast", verbatim. A reverse is the one motion where longer = HARDER, so the
    pace time-normalisation must not apply to it.
    · "Is this leg reversed" = the leg's own flag XOR the direction `m` is being
      driven — read it off the LEG, not the phase, or a car backing out of a 90°
      bay (forward legs, replayed backwards) is the one case that stays fast.
    · THE JOIN TICK NEEDS `clampToDirectionChange`: the flag is probed a hair
      past the current `m`, and the step STOPS at a boundary where the direction
      flips — otherwise the one tick straddling the join is driven at the old
      leg's speed (one tick of backing at forward pace, every manoeuvre).
    · MEASURE THE MIDPOINT, NOT THE NOSE. The guard watches rendered positions;
      the body's centre rides the curve at exactly the arc-length rate, but the
      NOSE also carries halfLen x tangent-rotation and sweeps at
      sqrt(v² + (halfLen·ω)²) — 0.18 t/s on a 0.12 t/s reverse, which is
      physically correct motion, not excess speed. The first draft of the guard
      failed on it.
    · 0.75 balances feel vs throughput (6-map sweep, wedges fixed first): cycles
      lot/kerb/city/echelon/variants at absolute 0.75 = 127/164/108/108/144
      against baseline 131/186/113/125/153; 0.55 costs visibly more and pushes
      the worst leaver wait to ~28s. No all-stop anywhere at either value.
    · SLOWING THE REVERSE IS A LIVENESS STRESS TEST: it makes several leavers
      ready at once, which is what exposed the courtesy knife-edge and the
      phantom-seniority cycle (see the leaving section) — both wedged whole maps
      permanently and both predate the speed change.
  - THE TRIGGER MUST NOT FIRE WHILE STILL ROLLING. `PARK_ARRIVE_EPS` exists because
    `clearAhead` binds the clear distance to exactly the stop line and the brake
    ramp approaches it asymptotically — but spending the tolerance while moving
    anchors the curve up to a twentieth of a tile early, and on a kerbside bay that
    extra approach drifts the body across the neighbour (2.4px, gone once the
    trigger needs either the line or a standstill).
  - BACKING INTO A 90 deg BAY IS A PIVOT, and shipped 2026-07-27 as one
    (`pivotReverseLegs`). Pull forward exactly `r` PAST the bay, reverse through a
    quarter circle of radius `r` about `C = A + r*side`, then reverse STRAIGHT the
    remaining `R - r` in (`R` = the lane-to-bay lateral distance, `r` =
    TURN_IN_CLEARANCE_FRAC = a car's length). The straight finish is load-bearing:
    a pure quarter circle needs `R` of pull-past (48-62px here) and runs off the
    end of a packed tile, while `r` is room `bayNearPx` already guarantees.
    · NO NEW LEG TYPE. A cubic with handles 4/3*tan(45deg/2)*r approximates a
      quarter arc to 2.7e-4 of the radius — a hundredth of a pixel. A
      `{kind:"arc"}` union would have touched bezierAt/bezierTangent/buildArcTable/
      locate to buy that.
    · ECHELON IS NOSE-IN ONLY (`canReverseIn`), and NOT for want of a better curve:
      the bay is raked FORWARD, so a car backed into one rests facing back up the
      aisle it came down, and a far-bank rank is only legal on a ONE-WAY aisle.
      The old "-8.6/-15.0px reverse vs -2.3/+0.3 forward" was that fact showing up
      as a swept overlap. `canNoseIn` therefore hems in `parallel` ALONE now.
    · Measured, 3000 ticks x 2 seeds, before -> after: parkinglot reverse-parkers
      0 -> 19/10 with swept clearance unchanged at +0.02px; cycles 34/40 -> 32/39
      (a reverse takes longer than a nose-in; that is the price). parkcity 23 -> 20
      and +0.21 -> +0.11px. Nothing went negative.
  - WHICH WAY A CAR FACES IN ITS BAY HAS EXACTLY ONE ANSWER (`parkedHeadingDeg`),
    and it did not: the entry curve left a kerbside car pointing DOWN the road and
    the exit curve set off assuming it pointed back UP it, so every reverse-parked
    kerbside car SPUN 180 deg on the spot the tick its dwell ended and unwound
    another 102 deg as the looping exit straightened. Measured on parkingkerb: 47
    per-tick heading jumps over 25 deg, worst 180.0; now worst 26.3 (the pivot's
    own sharpest moment). Backing in flips the heading only for a kind that turns
    ACROSS the kerb — a parallel bay lies along the road, so it does not.
    Pinned by "never spins on the spot", which also asserts something DID back in
    (`cars()` exposes `parkedReverse` for exactly that: a spin test passes
    trivially on a build where nothing ever reverses).
  - PARKVARIANTS SEED 1 STILL SWEEPS -2.10px, on tile 1,1 — a car NOSING into an
    echelon bay clipping its parked neighbour. Pre-existing and unchanged by the
    pivot work (identical to the tenth of a pixel before and after); it is the
    "-2.3px echelon forward" already recorded above. It is the only manoeuvre
    overlap left on the parking maps, and parkvariants is NOT in the swept test's
    guarded set for that reason.
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
- THE APRON IS A RECTANGLE, and `apronSpan` is the ONE answer for how far along
  the road it runs (the apron, its outer kerb line and the tests all read it).
  Two rules, both learned from the echelon rank — the only kind whose bays are
  RAKED (2026-07-27):
  · IT USED TO FOLLOW THE RAKE. Road-side edge from `a0 − skew/2`, far edge from
    `a0 + skew/2`, so six 45° bays on a 200px tile put the near edge at −21..153
    and the far edge at 21..195: the last 47px of that tile's road edge had NO
    apron, and on a run the aprons stepped past each other leaving a wedge of
    grass hard against the carriageway in the middle of one car park. Squaring it
    costs two triangles of tarmac at the ends of a rank, which is what the end of
    a real echelon rank looks like anyway.
  · A PACKED ROW REACHES THE SEAM. `align: "pack"` MEANS "part of a run", so where
    the bays come within half a pitch of a tile edge the tarmac goes all the way
    to it — otherwise every seam keeps a hairline of grass (5px echelon, 4px 90°)
    down the middle of one car park. A row that does not pack (centred bay,
    tapered lay-by) is a POCKET and keeps its own extent, and so does a packed
    rank that simply does not reach (six 90° bays = 168px of a 200px tile stays
    at 168): 32px of bare tarmac past the last bay reads as a rank someone gave
    up on.
  · A SINGLE-TILE RANK CANNOT SHOW THIS. Every echelon rank in the gallery sat on
    one tile, where a rake just reads as a rake — hence `/test/parkechelon`, two
    tiles of 45° bays on both banks, which exists precisely to have a SEAM.
  · The 10px band of apron with no bay on it (`apronNearPx` 28 vs `bayNearPx` 38)
    is BY DESIGN — the turn-in clearance is aisle, so it is paved. On a one-way
    aisle (kerb 14) it is 24px for the same reason.
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

## WORKPLACE PARKING (the commuter's car stops somewhere, 2026-08-04)
Design: `docs/superpowers/specs/2026-08-04-workplace-parking-design.md`.
- **A DRIVING CITIZEN'S CAR USED TO BE DELETED ON ARRIVAL**, so the town had a
  rush hour with nothing at stake and `parkPenaltySec: 8` stood in for a fact the
  board never checked. `requestTrip(from, to, kind, { park: true })` sends it to
  the nearest facility with a free bay instead, and it HOLDS that bay until
  `releaseTrip`. Three trip states now (`TripStatus`): driving | parked | arrived.
- **STAFF PARKING IS DERIVED FROM THE ZONING** (`tiles/workplaceParking.ts`).
  `terrain: "industry"` already says "a works"; the pass lays THREE `parallel`
  bays on the road tile a work/shop plot's driveway joins, on the kerb facing the
  plot. Three against a works employing 12–96 — the shortfall IS the mechanic,
  and three is also what fits (60px pitch on a 200px tile).
  · HOMES GET NO *FORECOURT* — they get a private DRIVE instead, from a separate
    pass. See HOME PARKING below.
  · `side: "left"` is offered ONLY on a one-way straight, matching
    `validateParking`'s own rule. Leaving it out costs half the workplaces on any
    board built round a one-way loop: their gate is on the far kerb, and the near
    kerb faces the middle of the ring.
  · IT VALIDATES AND BACKS OUT. Every derived row goes through `validateParking`
    and any the validator objects to is DROPPED, because the objections are not
    local: bays on a dead-end stub turn that stub into a car park with no way out,
    which is a property of a flood fill. Idempotent, so a second pass is a no-op.
  · APPLIED IN THE SCENARIO'S OWN DATA, not in `citizensMode.setup`. `PlayView`
    uses `setup.level`, but **TestStage passes `scenario.level` straight to
    `createGame`** and `createGame` never reads `setup.level` either — so a
    mode-setup transform reaches the play board and NOTHING in `/test` or in any
    unit test. Wiring it into the mode needs that fixed first.
- **`ParkingRow.marking: "none"` IS THE AMERICAN WIDE STREET**: carriageway keeps
  every one of its own markings, the parking edge has no white boxes. PAINT, not a
  new `StallKind` — depth/pitch/manoeuvre/exit are identical to `parallel`, and
  forking them would mean keeping two of everything in step for ever. The apron
  and the outer kerb line still draw, so the run reads as a street that is WIDER
  here rather than cars on the grass. Rejected on any kind but `parallel`: an
  unpainted echelon rank reads as a car park nobody finished.
  `/test/streetparking` is the two side by side.
- **A RELEASED CAR RE-PARKS ITSELF UNLESS YOU SAY OTHERWISE**
  (`trips.releasedFrom`). It keeps `phase === "parked"` while it waits in its bay
  for a gap (leaving a bay buys no right of way), so `settleRequestedTrips` fires
  again on the very next tick and resets the hold to another full hour. Symptom:
  commuters ended their journey HOME "parked".
  · Record WHICH STALL it was let out of, not a boolean. A flag reads "released"
    for the rest of the journey, so the car that reaches its own drive at 18:00 is
    never recorded as parked there — which is the whole evening commute.
- **A CAR STILL HUNTING FOR A SPACE IS NEVER SETTLED BY THE ADDRESS TEST**
  (`parkTarget !== null` gate in `settleRequestedTrips`). Staff bays sit on the
  workplace's OWN street, so the address IS the car park's tile and the trip would
  be deleted half a tile before it parked. Once `giveUpAndReplan` clears
  `parkTarget` the address test applies again, and that is the graceful fallback —
  they found something down the road, and pay `parkSearchSec`.
- `tripGoal.entryPort: null` = ANY approach counts as arrived. A parking trip
  cannot know which way round the block the driver comes back, and the route home
  is planned fresh from the stall.
- `resumeFromStall` plans to `car.tripGoal` when there is one and to a map exit
  otherwise. Ambient traffic leaves the map; a commuter's car has an address. Get
  this wrong on a CLOSED RING and there is no map edge to despawn at — the car
  circles for the rest of the run.
- `abandonTrip(id)` exists for the caller that has LOST the owner (emigration, a
  refused journey home). Releasing the trip alone leaves the CAR parked: a bay
  held by nobody is a bay nobody can use again, one per lost commuter.
- **`game.parkingOccupancy` IS A RENDER MIRROR** — filled in `frame()`, so it is
  empty for ever in a headless run and a test written against it passes vacuously.
  The model-side observable is `citizenStats.carsParked`, counted in `advance()`.
- `/test/workparking` is the demo: a closed one-way ring (so every car is a named
  citizen), one works, three bays, two dozen drivers.

## HOME PARKING (where the car sleeps, 2026-08-05)
Design: `docs/superpowers/specs/2026-08-05-home-parking-design.md`. The night half
of the above; read that section first.
- **`ParkingRow.resident` = the ADDRESS a row belongs to** — somebody's drive, not
  public parking near a house. `bayClassOf` → `"resident"`, and the gate is
  `permitAdmits(row, permit)` where the permit is the driver's home plot id.
  · NOT a `StallReservation`. That axis is painted vehicle CLASS (disabled,
    delivery, loading) — "what may stop here". Ownership is "whose tarmac", which
    no paint decides, and per-ROW is what lets two houses face the SAME road tile
    and each keep their own (a facility-level permit cannot tell them apart).
  · THE PERMIT MUST REACH EVERY COUNTING QUESTION — `openFacilities`, `capacity`,
    `freeCount`, `availableFor`, `pickStallOn`. A street of houses is genuinely
    FULL to a stranger and EMPTY to the residents; a router blind to that either
    parks every passing car on a drive or drives the residents past their own.
- **TWO SPACES, FIXED, WHILE THE HOUSEHOLD GROWS 4 → 32** (`tiles/homeParking.ts`,
  `DRIVE_SPACES`). Nobody authored the gradient: a building grows taller on ground
  that does not grow wider, which is also why terraced streets are the ones lined
  with parked cars. Do NOT scale the drive with density — the map only opens plots
  at 0–2 (the sim owns growth), so there would be no gradient at setup, and a
  drive that grows with the building is never short.
- **IDEMPOTENT PER ADDRESS, NOT PER KERB.** A corner house whose first-choice
  frontage is occupied — by its own drive from the previous run — walks on to the
  next street it touches and lays a SECOND one. Bays grew one drive per run.
- `perpendicular` + `marking: "none"`: nose-in off the carriageway, no white
  lines. `validateParking` allows unmarked non-kerbside rows ONLY for a private
  drive (nobody paints bay lines on their own hardstanding). A 90° bay is 48px
  deep, so it lands inside the tile beside a 2-lane street (kerb 28px) and
  OVERHANGS beside a 2+2 arterial (56px) — houses on a main road get no drive, and
  their residents park on the road, which is what living on one is like.
- **THE DRIVE HOME IS A PARKING TRIP AND CANNOT BE PLANNED WHEN IT IS ASKED FOR.**
  The evening leg starts with the car already in a bay outside the office, so the
  route out is built later by `resumeFromStall`. `Car.parkWish` records the wish
  at `releaseTrip` and that is where it is honoured. Miss it and the drive home is
  the one leg of the day that still deletes the vehicle: drives empty all night.
- **A CAR PARKED AT HOME MUST NOT FOLLOW ITS OWNER.** The send-the-car-after-them
  rule is right at a WORKPLACE (a held public bay with nobody coming back is dead
  space) and inverts at home — every resident who walks to the shops would send
  their car off after them, emptying the town's drives and filling its streets
  with cars going nowhere. Exempt `parkedCar.at === c.home` in all three places
  (`startTrip` dispatch, refused journeys, abandoned trips).
- **THE REQUESTED-CAR CAP MUST NOT COUNT PARKED CARS.** Counting them was right
  while only commuters parked (gone by evening, so the cap turned over). Once the
  car comes home too, a car owner's vehicle is on the board for good and all 60
  slots go to whoever commuted first — the fleet ossifies and nobody else is ever
  dispatched a car. Still bounded, physically: a car counts as parked only while it
  HOLDS A REAL STALL, so parked cars are capped by the board's spaces.
- **RESIDENTS DO TAKE PUBLIC KERB, and that is the point** — it is the player's
  lever, and a street with no drives really does look like that. What stops the
  2026-08-04 ratchet (12/12 bays held at 03:00, rising to the cap over four days)
  is not abstinence but `homeParkTiles: 2`: nobody walks six tiles from their own
  front door every night. Measured on `/test/workparking`: ~11 held overnight,
  ~0–1 by mid-morning, 490+ journeys completed. A cycle, not a ratchet.
- **A FACILITY WITH NO PUBLIC CAPACITY DRAWS NO SIGN** (`parkingStatus()` filters
  `capacity > 0`). `capacity` counts what the public could use, so an all-private
  facility came back zero and the chip read "P VOLL" — a car park, standing empty,
  announcing it is full. Nobody signs their own driveway. Mixed tiles still sign,
  with their public number.
## THE PAVEMENT GOES ROUND THE PARKING (2026-08-05)
- **A BAY STARTS AT THE KERB AND REACHES OUTWARD — WHICH IS WHERE THE PAVEMENT
  WAS.** Both the paint (`pavementPaths` → `bandsFor`) and the people
  (`pavementOffsetFor`) were offset from the CARRIAGEWAY alone
  (`roadHalfUnits + PAVEMENT_PAD`), so the footway ran under the parked cars.
  Measured on `/test/homeparking`: EVERY parking tile overlapped by 8 units,
  which is the band's entire width (bay 14→27 kerbside, 14→38 for a drive,
  against a pavement at 18→26). Now +4 clear on all of them.
- `parkingOutsetUnits(cell, bank)` is the shared fix and BOTH callers must use
  it: paint and people disagreeing is people walking beside the pavement.
- **ONLY WHAT YOU CAN SEE PUSHES IT OUT** (2026-08-20). The first cut counted
  every row, and `row.informal` — bare kerb, derived onto NEARLY EVERY STRAIGHT
  STREET (`tiles/kerbOverflow.ts`), painting nothing — is a `parallel` row, so it
  contributed 13 units on roads with no visible parking at all. Every pavement on
  the board came away from its carriageway and lay in the ground as a free grey
  ribbon; `/test/homeparking` showed it on the outer ring, the inner ring and both
  sides. `parkingOutsetUnits` skips `informal` as it skips `busstop`.
  · **A ONE-SIDED TEST IS WHY IT SHIPPED.** "the band clears every bay" passes
    just as happily when the band has left the street entirely. The guard is the
    OTHER side too: on every bank of every street, the pavement's near edge is
    exactly `PAVEMENT_GAP` from the last solid thing on that bank (kerb, or the
    bay standing at it) — `parkingWalk.spec.ts` → "never floats off into the
    verge either", measured at exactly 4.0 on all 28 banks of
    `/test/homeparking`.
- **PER BANK, NOT PER TILE.** A street with a drive on one side and bare kerb on
  the other has two pavements at two distances; pushing both by the wider leaves
  the empty side's band floating in the verge. `bankOfSide` converts the walker
  model's ±1 to the parking model's Port (`bankFor(through.from, "right"|"left")`).
- **THE KERB IS THE BIKE'S** (2026-08-20, PR #98 × #87). A cycle lane rides the
  kerb side of its stream (`bankFor(from, "right")`), so `deriveKerbOverflow`
  lays no informal space on a bank whose approach has `cycleLaneIndices` — a car
  left there would stand ON the green strip. Per BANK here too: a one-way with a
  kerb-side cycle lane keeps its far bank's spaces (`kerbOverflow.spec.ts`).
- **BODY WIDTHS ARE SIM CONSTANTS, NOT CSS LORE** (2026-08-21). A car is
  `CAR_BODY_WIDTH_FRAC` (16px), a bus/lorry `LARGE_BODY_WIDTH_FRAC` (18px) —
  `sim/laneOffset.ts`, mirrored by the `.road-car` CSS in PlayView/TestStage.
  Sized so width÷lane matches a real street (~0.57); at the old 20px (0.71) a
  car passing an informally parked one clipped through it. `CLIP_LANES`
  (road.ts) and the SQUEEZE cap (laneGeometry.ts, 5px = half-lane − widest
  half-body, with a module-load assert) are DERIVED from them — the literals
  are what went stale last time. **The body-overlap oracle**
  (`tests/unit/roadBodyOverlap.spec.ts` on `/test/parkpass`) rebuilds the
  exact renderer pipeline headless and asserts no two rendered bodies ever
  interpenetrate — moving×moving and moving×parked — with a self-test pinning
  that the OLD geometry would have failed it. Manoeuvres never needed a fix:
  `entering`/`leaving` carry road bodies (traffic already waits); only
  `parked` is deliberately body-less, and the slim widths + squeeze make
  passing it clean.
- Clamped to `MAX_PAVEMENT_OFFSET` (50 − half the band) or a lorry lay-by, at 55
  units deep on its own, puts the pavement half a tile into the neighbour.
- A `busstop` is exempt: the vehicle never leaves the carriageway, so there is
  nothing between kerb and pavement to walk around.
- Ground units are HALF of tile pixels (100 per tile against 200) — every
  conversion between the parking geometry and this file crosses that factor.

## THE WALK FROM THE CAR (2026-08-05)
- The bay-to-door leg (`Leg = "parking"`) was a pure COUNTDOWN of
  `walkFromBaySec`: the cost was modelled and the person was not, so a car park
  fed nobody into the building it served. It is a real walker now.
- **A WALK CANNOT START AT A PLOT HERE, and that is why it needed a new entry
  point.** `planWalk` resolves a plot to `accessTileOf` (the street it fronts
  onto) plus `sideOfPlot` (which bank its BUILDING stands on). A parked car has
  neither: it is already on the road tile, and which pavement it is beside is
  decided by the bank its bay hugs. Hence `sideOfBank` + `planWalkFromKerb`
  (`tiles/footway.ts`), and `pedestrians.requestFromKerb`.
  · A street with a bay on EACH side has two banks, so the tile alone cannot
    answer the question — pinned by a test that the two banks come back as
    opposite pavements.
  · `sideOfBank` and `sideOfPlot` must AGREE where a drive and its house share a
    bank, or somebody walks across the road to reach the house their own car is
    parked outside.
- **THE PORT TAKES THE CAR'S TRIP ID, NOT A TILE** (`WalkingPort
  .requestFromKerb(carTripId, toPlot)`). `game.ts` resolves it through
  `roadSim.tripParkedKerb`, which keeps banks, sides and bay geometry entirely
  out of the citizen layer — the same line terrain-blindness is drawn on.
  · **AND A TILE IS NOT ENOUGH TO STAND SOMEBODY IN**: `tripParkedKerb` also
    returns `at`, the car's own resting pose (`stallPose` at the stall's kerb, in
    world TILE units), and `pedestrians.requestFromKerb` takes it as a REQUIRED
    argument. It was optional, the one caller never passed it, and the walker was
    duly placed at the tile's centre — which is the middle of the carriageway, so
    the driver appeared standing in the traffic and stepped sideways out of it.
    An optional argument with one caller is a dead argument; make it required.
- The leg now ends when the WALKER arrives, with `legRemaining` kept as the
  backstop (same rule as the `walking` leg): no pavement, no route, or a pavement
  deleted underfoot falls back to the clock rather than stranding anybody.
- Only ONE walk per journey is ever live: the `walking` leg sets `walkTrip` for
  the approach to a platform, and the `parking` leg sets it for the last stretch.
  They cannot overlap — a car trip has no platform approach.

## THE KERB (nowhere to park, 2026-08-05)
- **A REQUESTED CAR IS DELETED WHEN IT REACHES ITS ADDRESS**
  (`settleRequestedTrips`, half a tile in). That is the generic "arrived"
  retirement, NOT a parking rule — but a commuter with nowhere to park used to be
  dispatched as a plain address trip and retired there, so cars POPPED OUT OF
  EXISTENCE mid-street. Measured on a saturated `/test/homeparking` (commuters at
  every house → the works): 8/15/30 cars dispatched → **1/2/12 vanished**.
  · And `parkingFrame().givenUp` was ZERO for them: they never reached the
    give-up path at all. Nothing was free when they were DISPATCHED, so
    `planParkingTripNear` returned null and they were sent to the address. Fixing
    only `giveUpAndReplan` would have fixed nothing.
- **`ParkingRow.informal` IS THE BARE KERB** (`tiles/kerbOverflow.ts`, derived
  LAST, after the forecourts and the drives take their banks). Two `parallel`
  spaces on whatever kerb is left. Same numbers now read 0/0/1 vanished.
  · IT PAINTS NOTHING — no apron, no bay lines, no kerb line, no P sign (all four
    return early on `row.informal`), AND IT MOVES NOTHING: `parkingOutsetUnits`
    (`tiles/footway.ts`) must skip it too, or every pavement on the board steps
    13 units into the verge. This is not polish: the pass touches nearly every
    street, so anything a row does to its tile, it does to the whole board.
  · INVISIBLE UNLESS ASKED FOR: `stallFits(..., informal)` defaults FALSE, so
    ambient traffic, the first-choice search and `capacity` (hence the P sign) all
    look straight past it. `planParkingNear` = real parking first, kerb only if
    that comes back empty — offering both at once sends drivers to the kerb
    outside the gate instead of the half-empty car park behind it.
  · NOT ON A ROAD OPENING THAT STOPS INSIDE THE MAP. `openingInsideLot`
    (`sim/road.ts`) treats an opening on any parking tile as being inside a car
    park and refuses to spawn/despawn there — right for an aisle, fatal here,
    because a stub that happened to be a spawn point would silently go quiet.
    Off-grid openings are exempt in that function already, so border streets keep
    both their kerb and their traffic.
- **NOWHERE TO PARK MEANS YOU DO NOT SET OFF.** `requestTrip` returns null when
  `park` was asked for and nothing — bay, drive or kerb — is in reach. That is the
  long-standing "no car could be dispatched" path, so the citizen still travels,
  on a timer, with no vehicle on the board. Refusing is not stranding; dispatching
  a car in order to delete it is a lie.
  · **BUT ASK EVERY WAY OUT OF THE STREET FIRST** — `continue`, never `return`,
    inside the `approachPorts` loop. `planParkingNear` searches from
    `(tile, entry)`, so a space to the east is invisible to the westbound
    approach, and the ports are tried in a fixed ascending order that knows
    nothing about where the parking is. Returning on the first failure refused
    drivers who only had to turn the other way out of their own street. The loop
    running out of ports is the real refusal.
- `giveUpAndReplan` used to retry through `planParkingTrip` — the AMBIENT planner,
  any car park on the map weighted by size — even for a commuter. So somebody who
  could not park at the works set off for a lot across town. A car with a
  `tripGoal` now retries NEAR THAT GOAL with its own permit, then once more at
  `PARK_LAST_RESORT_TILES`.
- The cost of a shortfall is now a WALK, not a penalty constant:
  `walkFromBaySec` measures from the stall the car really took, and on the rush
  above the spread was 1→4 tiles from the gate.

- `citizenStats.carsAtHome` vs `carsParked` is the DAY/NIGHT observable; one
  number cannot show the cycle because it reads the same at both ends of the day.
- `TestScenario.mode` (a mode OBJECT, beating `modeId`) exists for boards whose
  subject is a cycle: the citizens day is 30 real minutes, so at the default clock
  a visitor to `/test/homeparking` sees one hour of one morning and concludes
  nothing happens. That board runs a 4-minute day.

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
- TERRAIN PRICES THE BUILD (2026-07-27): `TERRAIN_BUILD_FACTOR` (terrain.ts,
  forest 1.5x / urban 2.5x) multiplies `TRACK_COST_PER_TILE` per PIECE in
  `game.buildCostOf` (`pricePerPiece`, rounded per piece so preview sum ==
  charge). UNDO hands back `lastBuild.cost`, which is already terrain-priced —
  no second price table; BULLDOZE charges flat CLEARING_COST_PER_TILE and
  refunds nothing (see the undo-vs-bulldoze split in game.ts). Lakevalley
  budgets are safe: its rebuild row is all grass. /test scenario: `landprices`
  ($6,000 vs a $5,000 grass+wood+town gap, tuning in tycoon.ts). The build
  button's hint derives its prices from the same table — keep it that way.
- Editor: `commit()` tests `isBlankCell`, not "no connections/signals/road" — a
  terrain-only cell is REAL and the old test deleted lake tiles as they were painted.
  Painting grass back over a bare cell removes it, so repainting can't grow bounds.
- EDITOR HAND-OFF IS UNGATED (2026-08-03): "Play this" is never disabled and
  `playThis()` has no `canPlay` check — depot pairs and validation issues are
  REPORTED in the drawer status, not enforced. A board with no depot pair simply
  starts with no trains. It pushes `/play?mode=sandbox` EXPLICITLY: /play
  otherwise reopens the last-used mode, and a board-GENERATING one (Daily derives
  its map from the date and ignores the context board) threw the level away.
  Pinned by the "plays a board with no depots at all" editor e2e.

## INVARIANTS
- Tiles are DATA, single source of truth. Rails: `connections: PortPair[]`. Roads:
  `road: Lane[]` = `{from,to[],index,kind?}` DIRECTED (undirected pairs can't do
  one-way/turn rules — never regress). Sim + renderer import same `src/tiles/*`.
- Renderer matches the SIM's lane indexing, not vice versa.
- Cyan/amber debug overlay = where cars actually drive (`game.ts couplerOffset`).
  Lane-graph overlay code must stay identical to it. Cyan ≠ painted dash/gore at a
  seam ⇒ the PAINT is the bug. Overlay is the diagnostic for all road geometry.

## TRACK PROPORTIONS (2026-08-20)
- Anchor the track's look on REAL numbers — standard gauge 1435mm on a 2600mm
  sleeper, i.e. the rails at **55% of the sleeper's half-length**. Everything is
  drawn in `TileRail.vue`: the sleeper band is the centreline stroked 20px
  (`stroke-dasharray="4 5"`), the rails are `railPathsFor` stroked 1.6px grey.
- RAIL STROKE 1.6, not the old 1. A 1px grey hairline all but disappears into
  the sleeper band at normal board zoom — the track read as bare sleepers with
  no metal on it. `Tile.vue`'s `.deck-rail` (the flyover deck's own track) must
  carry the SAME width, or the line changes weight where it climbs onto the deck.
- `railDistanceFromPath` = HALF THE GAUGE in px, and 20/2 × 0.55 = **5.5**. It was
  7 (70%), which left a 3px sleeper end past the rail and read as "rails sitting
  on the sleeper tips" — the user spotted it by eye before the maths was done.
- The terrain keep-out (`terrain.ts RAIL_HALF = 8` units) follows the SLEEPER,
  not the rail, so re-gauging does not move the cleared right-of-way.
- SLEEPER PITCH IS DELIBERATELY COARSE. Real pitch would be ~"2.5 3" (600mm
  centres at 1px = 130mm), roughly twice as many sleepers. Tried and rejected:
  it looks right at a macro crop and blurs into a solid dark band at the normal
  board zoom, where the track loses its railway texture. Judge any sleeper/rail
  weight change at BOARD scale (`npm run shot -- railcurves --scale 2`), not
  only on a zoomed crop.

## CURVES — rail ≠ road (the #1 trap)
- RAIL curve CENTRELINE (the sleeper bed, the path a train drives) = quadratic
  Bézier through TILE CENTRE (`Q centre`). `pathGeometry.ts segmentPathD`.
- The two RAILS are a TRUE PARALLEL OFFSET of that quad — every sample pushed ⟂
  to ITS OWN tangent, emitted as a 24-leg polyline (`geometry.ts railPathsFor`).
  NOT a `Q` with offset endpoints (2026-08-20 fix): offsetting only the endpoints,
  ⟂ to the CHORD, with the control point left at the tile centre, gave (a) HALF
  GAUGE at the apex — 14px at the ports, 7px mid-bend, the rails visibly merging
  into one line through every curve — and (b) a ~5px SIDEWAYS JOG at every seam,
  since a Left↔Bottom curve started its rail at (−4.95, 104.95) while the abutting
  straight put its own at (0, 107). Same rule as the road (next-but-one bullet):
  offset the SAMPLED centreline, never the control point. `/test/railcurves`.
- ROAD turn = 90° CIRCULAR ARC around the WRAPPED TILE CORNER, r=size/2, tangent
  at port edges (`A r r 0 0 sweep`). `roadSegmentPathD`, `turnCornerPoint` (=pa+pb−c).
  Centre-quad bulged into the junction box — fixed bug. Don't merge road turn → rail quad.
- ARC LENGTH not uniform: straight=size, rail curve≈0.8116×size (`curveUnitLength`),
  road turn=(π/2)(size/2)≈0.785×size (`roadSegmentLength`). Space coupled units by
  TRUE arc length (`segmentLength`/`roadSegmentLength` + `sampleAtArc`), else they
  overlap on curves. `scaleX` sprite-foreshorten was REVERTED (user hated it) —
  wrong cause. Kept: chord render (`UnitChord{front,rear}`) + `BOGIE_INSET_FRAC=0.2`.
- Constant-width road curve: offset the SAMPLED centreline ⟂ (`laneOffsetPointAt`),
  never the Bézier control point (pinches apex). Holds for RAIL too — the rail
  gauge is the same problem and had the same bug for a year (see above).
- Turn-LANE path = corner FILLET of the two lane lines (`pathGeometry.ts
  turnLaneFrame`/`turnLanePointAt`): straight-in, max arc tangent to both, straight-
  out. NOT the arc lerp(offEntry,offExit)-pushed (unequal offsets kink at seam =
  old "strange bend" on mixed-width junctions). =concentric arc when offsets equal.

## RAIL SWITCH UI — arrows on the rails (2026-07-27)
- The player-facing switch is a FAN: one per SWITCHABLE ENTRY (`isJunctionEntry`
  = >1 partner), geometry in `src/tiles/switchFan.ts`, drawn by `Tile.vue` as a
  single `.switch-layer` svg in TILE coordinates. It replaced `.switch-box` (a
  24x18 box of three 3px bulbs) — don't reintroduce that class; `game.spec.ts`
  asserts `.switch-fan`.
- TRAIN VALLEY'S MODEL: the control is a MARKING ON THE TRACK, not a widget
  beside it. Each arm is an arrow laid along the rail curve a train would take.
  `railArrow` samples the SAME quadratic `segmentPathD` draws (control point =
  tile centre; for opposite ports that degenerates to the straight line), so an
  arrow physically cannot disagree with the rail it marks. One code path for
  straight and curved — don't split them.
- ARROWS ARE ANCHORED AT THEIR ENTRY: start on the edge the train comes from,
  walk toward the exit, stop as a short stub (`ARROW_T_END_REST`). Version one
  anchored them at the exit (tail mid-air, head on the exit edge) and the player
  read it backwards — "something arrives here" — and couldn't tell which entry
  owned which arrow on a cross. Entry-anchored + mid-stop keeps each entry in
  its own quadrant, which is how OUR all-pairs crosses stay readable (TV never
  has that case).
- WHY IT IS NOT ALL DRAWN AT ONCE. An all-pairs 4-way cross has FOUR independent
  settings and TWELVE possible movements. Drawing them together makes an asterisk
  nobody can read — this was built and thrown away, twice (12 arrows, then 4 long
  + 8 stubs). What works: **at rest each entry draws ONE arrow, its set route,
  a SHORT stub from its entry edge (`ARROW_T_END_REST`, TV proportions)**; a fan
  OPENS (all arms, run further out, `ARROW_T_END_OPEN`) only when a train is
  arriving by that entry or the pointer is on it. Never more than one fan open at a time. Before making arrows more
  visible, re-shoot `switch-fan` — that scenario exists because it is the dense
  case.
- OPENING is per-ENTRY and sticky: `openEntry` is set by `@pointerover` on any of
  that fan's arms, and cleared by `@pointerleave` on the TILE root.
  Per-arm hover would collapse the fan as the pointer travelled from the set
  arrow to an alternative — i.e. it would be unclickable.
- SIZE: the arrows are track markings, so their GEOMETRY scales with the board;
  their WEIGHT must not (that is what made the old widget unusable). Every stroke
  width is `calc(Npx * var(--switch-scale, 1))`, which PlayView/TestStage publish
  on `.level` from `switchFanScale(camera.zoom)` — below 50% zoom it thickens,
  capped 1.7x. Anything rendering `Tile.vue` without that var just gets 1.
- The `.switch-layer` svg is `pointer-events: none`; only the arm hit-paths
  (`pointer-events: stroke`, width also zoom-scaled) take clicks. There is NO hub
  dot and NO cycle gesture in play any more — the old `.switch-hub` circle was
  the "strange black dot" the player asked about; with entry-anchored arrows it
  marked nothing. `switchHubAt` survives for the EDITOR, which centres its
  authored-arm cycle zone on that point.
- TRAP: those hit-paths run ACROSS the tile, so on a junction they sit on top of
  the build tool's `.zone` edge targets and eat the click that would lay track
  (the old edge-hugging box was too small to notice). PlayView passes
  `:switch-interactive="!buildArmed && !razeArmed"`; the lakevalley-open e2e
  catches it, because building the station junction reveals a fan mid-drag.
- NOTHING IN A FAN MAY LOOK LIKE AN ARROW EXCEPT AN ARM. An early version put a
  chevron on the entry marker to say "trains arrive here"; it read as an extra
  arm, being colinear with the Straight arm and pointing the same way.
- Arrows sit DEAD-CENTRE on the rail. An early 8px right-of-travel offset (to
  separate the two directions of one arc) read as a misdrawn arrow — the player
  said so. Centring is safe because opposing directions only co-exist AT REST,
  where the short crop keeps each on its own end of the curve.
- ARROW STYLE (chosen from a 4-variant mockup round, "A1/A3 hybrid"): a stroked
  near-black body in a WHITE casing bending along the curve, finished with a
  filled flat-backed triangle head (`HEAD_LEN`/`HEAD_HALF`; capped at 45% of a
  short arrow's run). The SHAFT stops at the head's back — `railArrow` walks the
  sampled arc length backwards, so don't reintroduce an even-t mapping (the unit
  test checks point-on-curve, not parameters). SET arm = black body/white
  casing; ALTERNATIVES = the inverse ghost (white body, dark casing) — current
  vs available is a colour inversion, not an opacity guess. Head polygons scale
  with the board (geometry); only stroke WIDTHS counter-scale.
- RESTING FANS ARE TRANSLUCENT (`.switch-fan` opacity 0.55): quiet at rest, full
  strength exactly when they matter — `--open` (train due OR pointer on it),
  and always in the EDITOR (`.switch-layer--static`, an editing surface).
  `--muted` (a train is due on a DIFFERENT entry) drops further, to 0.28.
- WHICH FAN MATTERS: `Tile.approachEntry` promotes the fan whose NEIGHBOUR tile
  holds a train pointing at us (`--armed`, glow) and mutes the rest. It keys off
  the reactive `occupied` map — `updateReservations` refills that every frame
  regardless of `switchLockMode` — and only then reads the markRaw'd
  `sim.trains[id].path[headIndex]`. Do not read the sim directly: it is never
  proxied, so nothing would re-render.
- Clicking an arm THROWS STRAIGHT THERE (`pickArm`) — the only gesture. The old
  widget could only cycle, which is why reaching a specific exit on a 4-way took
  up to three clicks and a guess.
- EDITOR: `EditorView` passes `:switch-interactive="false"` and paints its OWN
  `.switch-zone` (r=22) at `switchHubAt`'s point — that zone cycles the AUTHORED
  `defaultArms` and persists, a different verb from the live throw. Its
  `switchPoint()` must track `SWITCH_INSET`; it imports the constant rather than
  re-deriving it.
- Scenario: `/test/switch-fan` (all-pairs cross, authored to start pointing the
  WRONG way). E2E `switchFan.spec.ts` drives point-to-open → click → delivery.

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
- A JUNCTION'S STRAIGHT-THROUGH IS A TURN OF 0°, NOT A ROAD. It is the same
  `junctionExitLane` + exit-arm band as a left/right turn — never the road seam-taper
  (`laneSeamOffsetPx`), which anchors the lane index on the TILE'S OWN band. A
  junction's `laneCountAt` is a movement tally, not the arm's width (a 3-lane side
  arm inflates the count on EVERY other arm), so the taper branch put every inner
  through-lane half a lane off the road it came from: the car snapped entering the
  box and snapped back leaving it. This is the "car changes lane on the cross for no
  reason" report, and it needs the SAME fork in all three places that draw a lane —
  `laneGeometry.couplerOffsets`, `Tile.vue laneArrows`, and the sim's exit-lane
  assignment (`road.ts`: a straight out of a junction now starts on `want`, exactly
  like a turn, because the box now glides it there). Fixed 2026-08-02; `crosslanes`,
  `mixedtee`, `mixedcross`, `turngallery`, `busmegacross`, `parkcity` all carried it.
- THE INVARIANT THAT CATCHES ALL OF THIS: `tests/unit/sim/laneContinuity.spec.ts`
  reconstructs the point `game.ts` actually draws (couplerOffsets + `laneSegmentPointAt`)
  for every vehicle of every road scenario and asserts the step PERPENDICULAR to its
  heading stays < 0.02 tiles/tick. Lateral only — longitudinal travel is the vehicle
  doing its job, and folding it in turns the check into an arbitrary speed test.
  Half a lane is 0.07, a whole lane 0.14, a real lane change ~0.006/tick, so the
  band between "driving" and "teleporting" is wide and unambiguous. Reach for it
  first whenever a car "swerves for no reason": it names the scenario, tile, ports
  and lane.
  · AND IT ONLY CATCHES WHAT THE REGISTRY DRIVES. Every 2-lane bend in the gallery
    had a 2-tile approach, so a car had always SETTLED into its lane before the
    corner and the fractional-lane case was never swept at all (2026-08-05: found
    by hand-lengthening `roadcurvetraffic`, not by the suite). A scenario is
    coverage — when a bug needs a longer road/a busier tile to appear, the fix
    ships the map that keeps driving it (`/test/curvelanechange`, 6-tile approach
    + overtaking up).
- A FRACTIONAL LANE MUST GET A FRACTIONAL OFFSET, EVERYWHERE. `lanePos` is
  CONTINUOUS (0.49 = mid-change), and `junctionExitLane` is a map between lane
  INDICES — so every caller that feeds it a live lane has to decide what to do
  with the fraction, and ROUNDING IS A STEP FUNCTION. `junctionExitOffsetPx` did
  (`Math.round(entryLane)`): the tick a car's lane crossed .5 inside a bend its
  whole exit offset flipped a lane, and the drawn point snapped `t · laneWidth`
  sideways — up to a third of a lane, mid-curve, with nothing in the sim having
  moved. It now interpolates between the answers for `floor` and `ceil`, which is
  identical at whole lanes (converging lanes stay converged, so a 3→1 merge does
  not gain a phantom in-between position). Fixed 2026-08-05.
  · The DECISION callers are the opposite case and correctly keep the round:
    `turnLandsOnBusLane` (arrow colour), `road.ts laneOf`/`turnShift` (an integer
    lane shift preserves the fraction it is added to). Rounding is wrong only
    where the result is a POSITION drawn every tick.
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

## LEVEL-CROSSING FURNITURE (2026-08-04)
- THE BOOMS ARE DERIVED FROM THE ROAD, NOT FROM THE TILE. `tiles/crossingFurniture.ts`
  (pure, unit-tested) returns the span of painted tarmac and the boom/sign positions;
  `Crossing.vue` is a view over it. The old geometry was fixed CSS percentages (post
  at 30%, arm 30%→70%), which is only ever right on a 1+1-lane street: on a 3+3 the
  tarmac is 168px of a 200px tile, so the post stood IN the carriageway and the arm
  covered the two inner lanes. Same lesson as the pavement offset in `footway.ts` —
  road width is data, so anything beside a road must read it.
- A BIG STREET HAS FOUR BARS: both sides of the rails × both verges
  (`BIG_STREET_LANES = 2`, i.e. anything wider than 1+1). Each row is closed by its
  own pair meeting at the centreline, so NO arm is ever longer than half the road —
  reaching the far verge on a 6-lane street would swing an arm right across the
  oncoming lanes. A narrow 1+1 street keeps the classic diagonal PAIR: one bar per
  row, on the approaching driver's right verge (traffic keeps right, so the down
  carriageway is the local −x half and its bar hinges on −x).
- A SIGNAL ON EVERY MAST — one per BAR, not one per row (four on a big two-way
  street, at the tile's four corners). That is the Swiss arrangement (a barrier and
  a Blinklichtsignal on each side of the road) and it is also what makes a closed
  crossing read as a PAIR of barriers per side rather than one long bar. ONE-WAY
  roads are guarded on the approach side ONLY (a bar behind the crossing guards
  nothing): one row, one bar if narrow / a verge pair if big.
- THE CENTRE GAP (`CENTRE_GAP_FRAC = 0.045`) is the other half of that. Two arms
  meeting exactly on the centreline draw as one unbroken bar — the "looks like a
  single barrier" report. Every arm whose tip is the MEETING POINT stops short by
  the gap; an arm ending at a KERB (a narrow one-way street's full barrier) does
  not, since nothing meets it. The gap stays well under a car's width (0.14 tile)
  so the road still reads as closed.
- THE SIGNAL ART: a RED-BORDERED triangular panel — red rim, white ring, black face
  — carrying two red lights side by side AT THE SAME HEIGHT, alternating, on a
  red/white banded mast (matched to the reference photo, 2026-08-05; the earlier art
  was the same panel with the red border missing, and the one before that a red-and-
  white warning triangle with the lamps hanging BELOW it, which is not a signal any
  country uses). At 26px the red border is what makes the sign READABLE on the board:
  a white-rimmed black triangle on grey tarmac is a dark speck until you zoom in.
  The unlit lens is dark red (#6b3030), not black: on a black panel a black lens
  disappears and the signal reads as having only one light.
- THREE CONCENTRIC RINGS FROM ONE PATH (`PANEL_TRIANGLE`, `.xing-rim/-edge/-face`).
  A round-joined stroke grows a shape OUTWARD by half its width, so painting one
  triangle three times with shrinking stroke-widths (5.8 red / 2.0 white / fill-only
  black) gives three nested rounded-corner triangles — the ring THICKNESSES are the
  differences of the half-widths (1.9 and 1.0). `clip-path: polygon()` cannot do this:
  no corner radius, and every ring needs its own hand-inset triangle. Inset the path
  from the viewBox by the widest HALF-stroke (2.9) or the red silhouette overflows.
  The lamps stay OUTSIDE the `<svg>` (siblings in the `.xing-panel` wrapper) for the
  same reason they were outside the old clip-path: an svg clips to its viewBox and
  would eat the outer edge of a lens sitting near the triangle's edge.
- A SIGN IS PLACED IN THE LOCAL FRAME BUT DRAWN IN THE SCREEN FRAME. The booms are
  road furniture and turn with `.crossing-rot`; the panel is a GLYPH, and the same
  quarter turn laid it on its side (triangle pointing at the verge, mast horizontal)
  on every horizontal road. `signStyle` cancels it with `rotate(-90deg)` — safe after
  `translate(-50%, -50%)`, because that has already put the element's CENTRE on the
  layout point and rotation is about the centre. Only `/test/crossinglanes` shows
  this; the vertical-road `/test/crossing` looks perfect either way.
- THE LOCAL FRAME AND ITS ROTATION TRAP. `Crossing.vue` draws the upright layout and
  CSS-`rotate(90deg)`s it for a horizontal road. That maps local (x,y) → screen
  (−y, x), so local +y is screen-LEFT: for a horizontal road "local down" is the
  RIGHT→LEFT movement, and `roadPorts` must return `{down: Right, up: Left}`. Getting
  this backwards puts both bars on the departure side and only shows up in ONE
  orientation — always check both (`/test/crossinglanes` has both plus a one-way).
- MIRROR ABOUT THE HINGE. The right-hand bar is the left one under `scaleX(-1)`;
  `.boom` therefore needs `transform-origin: left center`, because `left` is placed
  at the hinge and the default centre origin slides the whole barrier one arm length
  sideways.
- The span mirrors `Tile.vue roadPaths` (the authority on painted width) at MID-tile,
  where the rails run: two-way = centred band, averaged over its two seam totals
  (`roadSeamPaintTotal`); one-way = kerb-anchored to `roadOneWayRunMax`. If the paint
  rules change, this follows.

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
  anchor, removed 2026-07-25 with its 4 tests. One-way is run-constant
  (`oneWayLaneOffsetPx`) for every SURVIVING lane; only the DROPPING (centre-side)
  lane is seam-adjusted, by clamping its index to the lanes that cross the seam
  (`laneGeometry.oneWaySeamCount`) so a car that never finished its merge GLIDES
  into the survivor over the closing tile instead of being teleported a full lane by
  the index clamp on the far side. Same clamp the painted gore and `Tile.vue`'s
  one-way arrow already used — this only brought the CAR into line with them.
- A LANE INDEX IS NOT PORTABLE ACROSS A WIDTH CHANGE (bidirectional). Lanes anchor
  at the CENTRELINE but are numbered from the KERB, so when the band changes the
  same index is a different physical lane: 3L→2L, index 1 is the middle lane on one
  side of the seam and the centre lane on the other. Carrying it across with a plain
  `min(idx, count-1)` slid the car a WHOLE lane sideways in one tick (`roadlanemerge`,
  measured 0.14 tiles). `laneIndexAcrossSeam` (`laneOffset.ts`) adds `Δcount` so the
  car keeps its physical lane; the widening's new kerb lane simply starts empty, which
  is also the "spread outward into a new lane" behaviour the scenario's comment wanted.
  One-way is kerb-anchored, so its shift is 0 — the two conventions are opposites and
  the function forks on `kerbAnchored` (`isOneWayStraight`), not on lane counts.
  See the fuller entry under "A LANE INDEX IS NOT A PLACE" below.
- The SAME seam branch handles a CURVE, and there the physical lane is not `Δcount`
  but the one `junctionExitLane` names — the exact mapping `turnExitOffsetPx` glides
  the vehicle along inside the curve. Fork on `exitPort === opposite(entryPort)`:
  straight ⇒ `laneIndexAcrossSeam`, turn ⇒ `junctionExitLane` delta. Drawn path and
  assigned index then cannot drift apart at the boundary.
- NEVER MEASURE A WIDTH AGAINST A JUNCTION. Neither seam rule may run when the
  neighbour is a junction: its per-arm `laneCount` tallies the MOVEMENTS fanning
  through the arm, not the arm's width (a bus-only turn off a 1-lane approach reads
  as 2), and the arm adopts the road's band anyway (`roadSeamPaintTotal`). Read as a
  widening, `busshortcut`'s tee threw a car a whole lane sideways into the bus lane
  beside it. The index carries across unchanged; `laneDropAhead` / `laneDropUrgent`
  bail on a junction neighbour for exactly the same reason.
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
  The following/conflict gates no longer read an INTEGER lane identity at all —
  #56 replaced it with the lateral BAND test below, which is what made the seam
  model safe to lean on. The seam's own lane REASSIGNMENT is still a teleport that
  gap acceptance cannot refuse (it is not a lane change), and it is the last
  measured clip on the board: `/test/parkcity` seed 7, 0.035, a car whose exit lane
  lands it on the tail of a car already in that lane. Whoever picks that up wants
  the junction merge clamp, not the lane-change model.
- LANE-CHANGE GAP ACCEPTANCE (#56, `reachableLane` + `laneClearForChange`): asked
  every tick, lane by lane, along the car's ROUTE — not once, per tile, at commit.
  Four facts, each one a bug that was actually measured:
  1. A 2→0 change is TWO decisions. Checking only the first lane crossed let a car
     sweep through a lane it never looked at (worst measured: 0.20 tiles, a whole
     body, `roadstraightlanes` seed 7).
  2. The check follows `forwardRoute`, so a merge finishing on the NEXT tile sees
     what is already lying there.
  3. Refusal picks a TARGET, never a brake: the car holds a lane short or eases back
     the way it came. Braking to a halt mid-change (the 2026-06 attempt) parks the
     body astride the line where it sweeps BOTH lanes — worse, and measured worse.
  4. Gap size is ASYMMETRIC: `CAR_GAP` ahead (slot in and follow), full
     `LANE_CHANGE_GAP` behind (cutting in makes someone else brake). Demanding the
     full gap both ways means a car can only merge into an empty street.
- "SAME LANE" for following is LATERAL, not integer (`inMyLaneBand` in `clearAhead`,
  threshold `CLIP_LANES`). A vehicle mid-change is physically in two lanes; gating
  on `round(laneIndex)` skipped the car it was merging behind until they touched.
- A body's span along another car's route is `bodySpanOnRoute`, and its REAR is the
  rear-most projected point MINUS whatever length was never projected. Body points
  only land on tiles that are on the observer's route, so a long vehicle trailing
  back over the tile behind reads as a short car with a comfortable gap behind it —
  and a merge into that phantom gap lands in the middle of a trailer. Measure the
  unseen part against `roadBodyLength` (the fraction actually on the carriageway),
  never `car.length`, or a car half-tucked into a bay gates traffic it isn't in.
- A vehicle STEERS, it cannot CRAB: `laneVel` is capped at
  `LANE_CHANGE_LEAN·velocity/length`, so lateral speed falls with forward speed and
  a stopped car has none. One lane of lean over one body length is what
  `LANE_CHANGE_RATE` already gave a car at cruise, so cruising behaviour is
  unchanged — the cap only bites on a slow, long or braking vehicle, which is
  exactly where the old model skidded sideways across a lane.
- `Car.laneAnchor` = where the current lateral manoeuvre began; the lean in
  `lanePosAt` is clamped to [anchor, laneIndex]. The lag term extrapolates the
  CURRENT lateral speed backwards over the body, which overshoots while the S-curve
  is still ramping up and hangs the tail in a lane the vehicle was never in — a
  phantom body that reads to every gate (and the swept-overlap test) as a clip.
- A STOPPED car straddling a lane line shuffles onto one of them (`parkingLane`,
  `LANE_PARK_RATE`), body rigid (`laneVel` 0 ⇒ no lean). Traffic can stop a car
  exactly mid-merge, and a straddler blocks two lanes for as long as the queue
  lasts. It does not START a change at a standstill — only finishes one. Parking
  vehicles never reach any of this: `advance` hands `phase !== "driving"` to
  `advanceParking` and returns before `updateLateral`.
- Lane switch (G): `Car.laneIndex` is FLOAT (lateral pos); round()=occupied lane;
  eases to int `targetLane` on accepted gap; ending lane merges before taper (sim
  owns lateral motion, render taper gone).
- A LANE INDEX IS NOT A PLACE (2026-08-02). It is an index into an ANCHORED band,
  and the two anchors move it in opposite directions when the road changes width:
  bidirectional is centre-anchored so lanes are added/dropped at the KERB (the same
  tarmac is `i + Δcount` on the far side of the seam), one-way is kerb-anchored so
  they are added/dropped at the CENTRE (index carries across unchanged). The
  straight-seam branch of `advance` carried the raw index over both, so a car
  entering a 1→3 bidirectional widening in the centre-adjacent lane came out in
  lane 0 — swept two lanes to the far kerb with no gap check, no decision and
  against the merge arrows painted under it, then dragged back at the taper. Fixed
  with `laneIndexAcrossSeam` (`laneOffset.ts` — it lives next to the offset rules it
  inverts). Pinned by the offsets themselves: `laneOffsetConstPx(mapped, to)` ===
  `laneOffsetConstPx(i, from)`.
  · The remap is a lane-index DISCONTINUITY exactly like a junction seam, so it
    sets `Car.lanePivot` too — the tail is still numbered in the old tile's band,
    and without the pin it flicks a lane sideways the tick the head crosses.
- TWO HORIZONS FOR A LANE DROP (`laneDropAhead` → `{near, far}`), because "must I
  move?" and "is it worth moving?" are different questions:
  · `LANE_DROP_LOOKAHEAD` (4) — a lane that stops inside it is one no car may aim
    for. Applied as a CLAMP around `preferredLane` (`survivingLaneBand`), not as
    another branch inside it, so keep-right / pending exit lane / overtake / spawn
    are all filtered through one rule and none can send a car into a doomed lane.
    Replaced the old next-tile-only merge branch: one tile of notice meant the
    merge happened AT the taper.
  · `LANE_KEEP_HORIZON` (8) — the DISCRETIONARY keep-right drift additionally wants
    the lane to last this long. Without it a car dives for the kerb the moment a
    wide stretch opens and merges straight back a tile later: a weave that gains
    nothing. This is why a SHORT widening (`/test/roadlanemerge` row 3) is now
    driven dead straight, and a long one is still used.
  · WHICH SIDE dies is the anchor question again: surviving band = high indices on
    a bidirectional road, low indices on a one-way run (`survivingLaneBand`).
- ONE LANE PER MANOEUVRE (`reachableLane` stops at the first USABLE lane) + a
  `LANE_CHANGE_SETTLE` (1.2 s) hold afterwards (`Car.laneHold`). Two lanes over is
  two decisions with a look in between — the settle is bypassed only when the lane
  ends on the very next tile (`laneDropUrgent`), never the one-lane cap. A lane the
  class may not STOP in is still crossed for free, so cutting over a kerb bus lane
  is one change, not two. Both ways a change can finish must set the hold (`arrive`
  in `updateLateral`): the discrete-step overshoot guard is the one that usually
  fires, and setting it on the exact-arrival path alone left it mostly dead.
- Tests: `laneDrop.spec.ts` (behaviour, on the scenario's own board),
  `laneOffset.spec.ts` (the remap ↔ offset identity). Scenario `/test/lanedrop`:
  the SAME 1→3→1 road at two lengths, which is the whole rule in one picture.
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

## BICYCLES (phase A+B — the slow kind and the cycle lane, 2026-08-05)
Plan: `docs/superpowers/specs/2026-08-05-bicycle-travel-mode-design.md` (phase C
— racks + bike-and-ride — is built, see the next section; C′/D — the citizen
mode, shared paths — are NOT).
- `VehicleKind "bike"` is the FIRST kind with its own pace: `KIND_SPEED`
  (road.ts, bike 0.45) scales the cruise draw at BOTH spawn sites; before it,
  every kind drew from the same `carSpeed ± spread` band and only length
  differed. `KIND_ACCEL`/`KIND_BRAKE` scale the dynamics the same way.
- ACCESS IS ONE MATRIX: `laneUsableBy` (tiles/lanes.ts) — car: all-lanes only;
  bus: + bus lanes; bike: + bus AND cycle lanes (`LaneKind "cycle"`). Every
  "which lanes may X use" question routes through it — the junction-derivation
  filters in editOps.ts ask `laneUsableBy(l, "car")` now, NOT `kind !== "bus"`
  (a cycle lane must not count as car capacity). `laneExits` gives `busTo`
  movements to `cls !== "car"` (a bus gate admits cyclists).
- A bike QUEUES CARS on a 1-lane road ON PURPOSE (no same-lane squeezing —
  width is one global CLIP_LANES) — the incentive to paint a cycle lane, which
  is the remedy: bikes spawn onto / drift to it (`cycleLaneIndices`, the
  bus-lane twin) and cars flow. Multi-lane overtaking of bikes needed ZERO new
  code (the trigger is pure speed-differential); bikes themselves NEVER
  overtake (the bus rule) and spawn KERB-MOST, not rotating — a bike entering
  on the inner lane has to be walked back by keep-right, so don't.
- DETERMINISM: "bike" carries no default mix weight, so `pickKind`'s draw
  sequence is unchanged on every pre-bike seeded board (pinned in
  roadBikes.spec.ts). Bikes appear only where `traffic.mix` opts in.
- `vehicleCanPark` admits bikes since phase C (racks exist) — and racks are the
  ONLY place they may stop: the SIZE gate would pass a bike into any car bay, so
  the bay-CLASS gate is the only fence (see BICYCLES phase C below).
- A bike NEVER rides an inner lane: `preferredLane` short-circuits for bikes to
  the kerb-most cycle lane (else kerb-most usable lane) — no exit-lane settle,
  no keep-right delay — and it is EXEMPT from the left-turn "innermost" lane
  discipline (outermost lane permitting the move; only a dedicated inner-lane
  turn pocket forces it in). Pinned by `/test/bikeleftturn` + roadBikes.spec.
- Editor lane-count tools ➕/➖ (`addStreetLane`/`removeStreetLane` + run
  variants via the shared `mapStreetRun` walker): step a street's car lanes
  along a run without re-dragging the road — SYMMETRICALLY, both directions
  together (1L ↔ 2L ↔ 3L, identical lane sets to the road tool's presets;
  pinned by test). Symmetry is LOAD-BEARING: the yellow centreline paints at
  the ribbon middle and dividers at whole-lane offsets, which only matches a
  street whose directions carry EQUAL lane counts — an asymmetric 3+2 street
  puts the centre marking through the middle of a lane (the sim would cope;
  the paint cannot). ➖ is therefore ALL-OR-NOTHING per tile (an approach at
  its last general lane blocks the tile) and never takes bus/cycle lanes; ➕
  appends on the CENTRE side so kerb bus/cycle lanes stay put, and stops at
  the road tool's 3L ceiling (`MAX_STREET_LANES` — counts carriageway lanes,
  general + bus; the half-width cycle add-on is exempt). Re-ranking keeps
  median bus lanes. One-way streets step their single direction.
- Editor has FOUR lane tools sharing one set of lane hit paths: 🚌 toggles a
  lane bus ↔ normal IN PLACE (`toggleBusLane`/`setBusLaneRun`; it never touches
  green), and 🚲 toggles the STREET's bike lane STRUCTURALLY —
  `addCycleLane` inserts a NEW kerb lane (indices shift +1, the street widens)
  so no car capacity is lost on any width; `removeCycleLane` re-indexes back.
  🚲 is SYMMETRIC like ➕/➖ — BOTH directions gain/lose their green lane on one
  click, for the same load-bearing reason (a 2+1 street runs the yellow centre
  marking through the middle of an oncoming car lane, puts the cycle edge line
  at the kerb while the tint sits half a lane away, and emits a phantom merge
  dash on the untouched side). The click names only the direction, and only to
  pick the verb (`toggleCycleLane`/`toggleCycleLaneRun` — any lane of the
  approach toggles the same thing; the run's SEED tile decides add vs remove).
  Add is idempotent PER DIRECTION, so a half-equipped legacy street converges
  to symmetric rather than double-widening the side that already had green. A
  cycle-ONLY approach (bike path) reverts to normal instead of losing its last
  lane; junctions are excluded (streets only).
- Render: `road-car--bike` is an 8px capsule whose GLASS SPAN is the rider's
  head-dot (livery = jersey), CSS duplicated in PlayView + TestStage as ever.
  A cycle lane paints at HALF the lane width, KERB-ALIGNED (real-world
  proportion), in three agreeing places: the green tint (Tile.vue
  `restrictedLaneBands`, half=0.25·W shifted 0.25·W kerbward), a SOLID white
  edge line replacing the full-slot dashed divider (`roadLaneMarkingPaths`
  cycleA/cycleB — suppress divider `lanes-1`, emit `solid` inner at
  `(lanes-0.5)·W`), and the bike's ride line (`laneGeometry.cycleStripShiftPx`,
  +0.25·W kerbward scaled by lane-pos proximity so merges glide). The lane's
  reserved SLOT is still a full lane in the sim/offset model — only paint and
  ride line are half-width; a true half-width slot would rework the whole
  band/seam/taper pipeline. Debug arrows `lg-cycle` green, shifted onto the strip.
- Those three have to agree on all THREE ROAD SHAPES, and each reaches the paint
  by a different door — miss one and the lane half-renders:
  · STRAIGHT two-way → `roadLaneMarkingPaths` straight branch (skipA/skipB).
  · BEND → its curve branch (same swap on the offset arc). The TINT skipped
    every non-straight movement, so a bend showed the edge line with no green
    under it; `restrictedLaneBands` now emits a `laneRibbonPathD` ribbon at the
    same constant offset for a bend, and still skips a JUNCTION (inside the box
    the paint is turn ribbons/guides, and the offsets there are movements).
  · ONE-WAY STRAIGHT → NOT `roadLaneMarkingPaths` at all: Tile.vue's one-way
    branch is KERB-ANCHORED to the run max (`oneWayLaneOffsetPx`) while that
    function's one-way branch is CENTRED (right only for a one-way bend), so
    the straight has its own builder, `oneWayStraightMarkingPaths` — survivor
    dividers at `(R/2−k)·W`, the widening fan, suppressed `k=1` and the solid
    edge at `k=0.5` for a cycle lane. Before it, a one-way with a cycle lane
    got the tint and kept the full-slot dash.
  · `/test/cyclebend` and `/test/cycleoneway` are those two shapes in isolation.
- `laneContinuity.spec.ts` must feed `couplerOffsets` the SAME class game.ts does
  (`bus` / `bike` / `car`). It mapped every non-bus to "car", which for a bike on
  a cycle lane asks for a car's landing lane through a turn — a point the
  renderer never draws — and reported a whole lane of phantom teleport the first
  time a bike turned off a cycle lane (`/test/cyclebend`). The harness measures
  what the PLAYER sees, so any new vehicle class has to be added there too.
- `/test/bikemix` (the queue), `/test/cyclelane` (the remedy),
  `/test/bikeovertake` (2-lane passing), `/test/bikeleftturn` (kerb rule at a
  forced left), `/test/cyclebend` + `/test/cycleoneway` (the paint on the other
  two road shapes); sim pins in `roadBikes.spec.ts`, paint pins in
  `roadGeometry.spec.ts`.

## BICYCLES phase C — the rack and bike-and-ride (2026-08-20)
- `StallKind "bikerack"` = the busstop's MIRROR: `stallWalkIn` (tiles/parking.ts)
  is the one predicate — no manoeuvre curve in EITHER direction (the rider stops
  at the kerb abeam the stand, `startTOf` returns `info.t`, `exitsForward` is
  false, `beginEntering` short-circuits straight to `parked` with
  `parkPath = null`). A halt keeps its road body (`parkOnLane`); a rack drops it
  (ordinary parked invariant, zero body points) — that pair of predicates is the
  whole difference between the two no-manoeuvre kinds.
- A parked WALK-IN vehicle has no curve for `sample()`'s parked branch (it keys
  on `parkPath`), so road.ts has a second branch that poses it straight from
  `stallPose(row, index, 1, info.kerb)` — same source as the painted hoops, so
  bike and stand cannot disagree. Forget it and a racked bike renders standing
  in its lane.
- Rack depth is 0.09 (18px), NOT the plan's 0.08: `stallFits` measures the real
  body (bike 17.1px) against `stallLengthPx · 0.98`, and 16px refuses the very
  vehicle the rack exists for. Pitch 0.06 (12px — a bike is 9px wide) → 16
  stands/tile where 3 cars fit; it shipped at 18px first and read half-empty.
- `BayClass "bike"` admits bikes ONLY, and no other class admits a bike — both
  directions matter, because a bike passes every size gate there is. A rack
  cannot be `reserved` (needsBigBay would size the stands for a lorry) or
  `resident` (the resident class only admits cars → dead stands);
  `validateParking` refuses both.
- THE P+R TRAP (predicted by the survey, real): `parkAndRideStationsOf`
  qualified a station on ANY parking row in reach — the first rack would have
  made its station a car P+R target with nowhere for a car to park. It filters
  by bay class now (`bayAdmits("car", bayClassOf(row))`), and
  `bikeAndRideStationsOf` is the bike sibling (same WALK radius: the
  rack→platform leg is a walk). `CitizenWorld.bikeAndRideStations` carries it
  for phase C′.
- CYCLING REACH IS A RANGE, NOT A CONSTANT (`BIKE_RANGE_TILES`
  {typical 5, max 9} + `bikeRangeOf(affinity)`, tiles/catchment.ts): most riders
  take the bike for short hops, a sporty tail rides far — per-rider willingness
  is drawn from the band (C′ feeds `bikeAffinity` in), targeting/reachability
  asks `max`. Never widen the shared WALK_RADIUS_TILES instead — it also feeds
  station demand and P+R, and inflating it re-prices every station.
- The transfer needed ZERO new code: a rack stall going free→taken within walk
  reach injects `transferSizeOf` = 1 rider (the default arm — only a bus stop
  returns a busload). Pinned in parkAndRide.spec.ts ("arrived BY BIKE").
- `/test/bikerack` (rack + kerb bays side by side, classes never cross),
  `/test/bikeandride` (the rack feeds the platform); pins in `bikeRack.spec.ts`.

## BICYCLES phase C′ — citizens ride bikes (2026-08-21)
- `TravelMode "bike"` + `"bikeAndRide"`. EVERY `Record<TravelMode, number>` is
  now built by `zeroModes()` and summed by ITERATING `TRAVEL_MODES`
  (citizens.ts) — the hand-written literals/sums were the spec's named silent-
  under-report risk, and the one literal left is game.ts's HUD seed. Adding a
  mode = the union + TRAVEL_MODES + the UI label maps (CityPanel rows/colours,
  CitizenInspector MODE_LABEL/ICON — Records, so the compiler chases you).
- OWNERSHIP GATES, AFFINITY SHAPES: `profile.bikeOwner` (tuning.bikeOwnership
  0.7) says whether the modes exist; `profile.bikeAffinity` (0..1 keenness)
  does double duty — perceived cost via `bikeCostOf` (mapped into the SAME
  0.7–1.4 band the other affinities draw from) and the rider's own RANGE via
  `bikeRangeOf`. The range IS the patience: no slog curve, a hard per-rider
  distance gate ("too-far").
- `bikeSaddleSec` (6s flat, bike legs only) is what keeps the bike off the
  one-tile hop — WITHOUT re-pricing the shared `walkAccessTiles` charge, which
  stays equal across modes (the spec's explicit rule). Without it bikes beat
  the walk from d=1 and `/test/citizenwalk` fell to a 38% walk share.
- BIKE quote = walk template + car's road-component rule + roadDetour at
  `bikeSpeed` 0.45 (1.8× walk, 0.75× car), NO parkPenaltySec (a bike locks at
  the door — half of why it wins the short hops). BIKE-AND-RIDE = the P+R
  template on two wheels: ride to `nearestBikeAndRide` (CHEBYSHEV against the
  range, like every station-reach measure; the ride itself is priced at full
  detoured length), lock, WALK to the platform, train, egress. New refusals
  "no-bike"/"no-rack"; "too-far" is shared (each mode's own reach ran out).
- A CYCLING CITIZEN IS A BIKE: `DrivingPort.request` gained `kind?: "car" |
  "bike"` (game.ts passes it to `roadSim.requestTrip`); `FIRST_LEG` maps both
  bike modes to a driving-shaped leg. A bike mode NEVER resumes the parked CAR
  (`bikeMode` guard in startTrip). Like P+R's car, the B+R bike is retired at
  the rack's street — the rack STALLS fill with the road sim's own riders; the
  held-stall "return half" is one open debt for both modes.
- THE RACK→PLATFORM LEG IS WALKED, never teleported (`arriveFromDrive`, mode
  bikeAndRide): leg "walking" timed from the real rack tile + a REAL walker.
  Two footway extensions made that possible, and they fix more than bikes:
  · `planWalk` endpoints now take a STREET TILE itself (start on its own
    pavement, both sides seeded — side changes still only at crossings) and a
    STATION (nearest street beside it — before this, every "walk to the
    platform" silently fell back to a clock because a station tile is not an
    `isAddress`).
  · buildSteps: no driveway stub for a street-tile endpoint (a stub starts at
    the tile CENTRE = the middle of the carriageway), and the degenerate
    single-tile single-SIDE walk gets a 0.45–0.55 shuffle so it has steps at
    all. Only single-side: a step costs fixed TIME, and padding one in front
    of a zebra held the walker past the kerb-wait the crossing tests measure.
- KNOCK-ON SHARES, all deliberate (the spec's acceptance: bikes eat
  WALK-OR-DRIVE share, never transit's): `/test/citizenwalk` walk share 0.89 →
  ~0.62 (walk+bike > 0.7 pinned instead), citizencars strandings ~55 → high
  40s (a bike rescues some of the carless — refusal pin now >35), citizenchoice
  produces FOUR answers (bike joins walk/car/train). `stats().cycling` +
  HUD 🚴 count the trade against `driving`.
- `/test/citizenbike` is the flagship: houses 3+ tiles from the platform
  (transit refused "no-station-in-reach"), rack under the station, workshop up
  the road, works town rail-only. Pins in `tests/unit/citizenBikes.spec.ts` —
  including "offered ⇔ bikeRangeOf(affinity) reaches the rack, exactly" and
  the two end-to-end runs (real bikes; the rack walk observed with a live
  `walkTrip`).

## BIKES vs MOTORCYCLES + THE WIDE STREET (#99, 2026-08-21)
- The old "bike" split in two. The BIKE keeps the slow kerb-bound behaviour and
  slims to a 6px sliver whose rider head-dot (7px) OVERHANGS the frame —
  `.road-car` clips (`overflow: hidden`), so `.road-car--bike` must set
  `overflow: visible` or the dot is cut to the frame. The MOTORCYCLE
  (`VehicleKind "motorcycle"`, part `"motorcycle"`) wears the old 8px capsule
  and is deliberately class "car": any general lane (including the overtaking
  lane a bike must never touch), overtakes, parks in car bays (`bayAdmits`
  "car"/"resident" admit it), KIND_SPEED 1.15 / ACCEL 1.35. Determinism rule as
  ever: NO default mix weight for either — `pickKind` appends new kinds at the
  END of the weighted list so zero-weight entries change no seeded draw
  (pinned in roadBikes.spec.ts for both kinds).
- WIDE STREET = `LaneKind "shoulder"`: the cycle lane MINUS THE PAINT. Access
  matrix: bike-only (laneUsableBy's final return covers cycle AND shoulder).
  Ride side and paint side are now SEPARATE queries — `bikeLaneIndices`
  (cycle + shoulder: spawn-onto, drift-to, preferredLane, the quarter-lane
  kerbward cycleStripShiftPx and the turn-exit strip) vs `cycleLaneIndices`
  (cycle only: green tint + solid edge line). Grep for the right one before
  adding a caller; using the paint query in the sim re-opens the "bike rides
  the slot centre on a wide street" gap.
- Shoulder paint is a SUPPRESSION, not a marking: in all three marking doors
  (roadLaneMarkingPaths straight/curve/one-way branches + the kerb-anchored
  oneWayStraightMarkingPaths) the kerb slot's full-width dashed divider is
  skipped exactly like a cycle lane's, but the solid half-lane edge is emitted
  ONLY for cycle — a shoulder adds nothing, so the street just paints wider
  (the ribbon width follows from the lane count for free; a shoulder slot is a
  full lane in the band/seam/taper model, same as a cycle lane's).
- Editor: ↔ "Wide street" is the 🚲 tool's structural twin (symmetric per tile,
  run-walker, junctions excluded) via shared `addEdgeLane`/`removeEdgeLane` in
  editOps. Adding one kind where the OTHER sits CONVERTS in place (retag, no
  width change): 🚲 on a wide street paints the edge green, ↔ on a green street
  strips the paint but keeps the width — a street never carries both. Shoulder
  is exempt from the 3L carriageway cap (like cycle) and the 🚌 tool no-ops on
  it.
- Router (roadRouter.planRoute): a bike runs a TWO-PASS BFS — pass 1 skips
  expansion into 3-lane streets without a bike lane (`bikeAvoidsStreet`:
  carriageway ≥ 3 counting general+bus per approach, no cycle/shoulder), pass 2
  is the plain search when pass 1 finds nothing (soft penalty — the only-route
  bike holds the kerb). The TARGET TILE IS EXEMPT from avoidance: the goal test
  fires while STANDING on the destination's edge tile, so blocking it would
  make every arterial-side exit unreachable and silently fall back to the full
  arterial route. The second pass draws NO RNG (target picked before both), so
  every non-bike stream is untouched.
- `/test/widestreet` (edge-zone riding, cars pass in-lane), `/test/motorcycles`
  (moto overtakes on 2 lanes while bikes hold the kerb), `/test/bikedetour`
  (arterial avoidance — cars straight, bikes round the back street; deletes of
  the back street exercise the fallback in roadBikes.spec.ts).

## SIM HOT PATH — why the suite was slow (2026-08-01)
- 90% of a 4m22s unit suite was THREE files (parking 250s, road 120s, sweep 83s),
  and almost all of that was ONE function. `bodyPoints(car)` — a vehicle's sampled
  body — is what every following / gap-acceptance / junction-conflict scan asks
  for, so it is O(cars²) CALLS per tick, each re-walking the path (`segLen`) and
  re-deriving the lateral lag (`lanePosAt`) for a dozen-odd points. Profiled on
  /test/parkcity (37 vehicles): 60% of the entire tick, nearly all of it rebuilding
  bodies that nothing had touched since the last call.
  · FIX: memoise against an EXACT SIGNATURE of the car state it reads (path ref +
    length, headIndex/headProgress, laneIndex/laneVel/laneAnchor, velocity,
    lanePivot, phase/parkOnLane/manoeuvre/length) — NOT against the tick. `step`
    advances cars one at a time and a later car MUST see an earlier one where it
    now IS: a tick-scoped cache silently changes what the gates see, a
    signature-scoped one cannot. Grow the signature when `computeBodyPoints` grows.
  · The returned array is now SHARED. Every caller already treated it read-only.
- `roadPortsOf` (and `isRoadJunction`, which is it plus a length test) was another
  13%: rebuilding a Set from STATIC tile lanes inside the per-pair inner loops.
  Memoised on the `Lane[]` ARRAY IDENTITY (a WeakMap).
  · Safe only because every reducer in `tiles/editOps.ts` is PURELY FUNCTIONAL — an
    edit hands back `{ ...cell, road: next }` with a NEW array, so an edited tile
    misses the cache by construction and live editing still works. A reducer that
    mutated a `Lane[]` in place would serve a stale answer HERE AND NOWHERE ELSE.
    Keep them pure.
- Result: parkcity 6178ms -> 1275ms per 1000 ticks (4.8x), unit suite 4m22s -> 1m07s.
  The GAME LOOP got the same speedup — this was never a test-only cost.
- SPATIAL PRUNE (2026-08-02), the follow-up: after the memo, the two O(cars²) scans
  themselves were the top of the profile — `clearAhead` 24%, `bodySpanOnRoute` 12%.
  Both walk EVERY other vehicle on the map, and on anything bigger than a fixture
  almost none of them are near the route being scanned (parkcity: 192 tiles, 41
  vehicles, ~1600 pairs a tick, most of them streets apart). `memoOnRoute` skips a
  vehicle whose body shares no tile with the route.
  · A NO-OP, not an approximation — the argument to check if you touch either loop:
    every effect in both is reached through `projectPoint(route, p)`, which returns
    null as soon as `route.get(p.tileId)` misses. No route tile => binds nothing,
    spans nothing (`bodySpanOnRoute` leaves `front` at −Infinity => null), vetoes no
    lane change. It only costs a dozen projections and a `tRange` Map to find out.
  · The prune set comes from the MEMO's `tiles` (built with the sampled points), NOT
    from `bodyTileIds` — that one walks path INDICES (`headIndex − length`) while the
    points walk real driven ARC, and the two can disagree by a tile on a bend. A
    prune built on the wrong set would skip a vehicle that IS in the way.
  · parking.spec.ts 65.8s -> 47s (1.44x). It is a big-map win and a small-map wash:
    parkcity 1249 -> ~900ms/1000 ticks, but on a 5-tile fixture every vehicle is on
    every route, the prune never fires, and it is slightly negative. Hoisting the
    memo lookup so the prune and the points share one signature check pays that back.
- HOW TO PROVE A SIM OPTIMISATION CHANGED NOTHING (do this; don't just eyeball a
  green suite): hash a state trace and diff it across the change. 75 road scenarios
  x 3 seeds x 400 ticks, hashing `sim.cars()` kinematics AND every `sim.bodies()`
  point (tileId/lane/entry/t/lanePos at 12dp) — the memo and the prune each came out
  BIT-IDENTICAL, both at `ed41e161…5723`, which is also the PRE-optimisation hash.
  Keep quoting that number: a future change to the road sim that is meant to be
  behaviour-neutral should still produce it. A throwaway spec under `tests/unit/` is
  the cheapest host (it needs the `@` alias).
- The suite was RED on a slow machine BEFORE this, and not from an assertion:
  `parking.spec.ts`'s two biggest cases blew their own timeouts. Green tests, red
  CI — same family as the `onTaskUpdate` trap below. Making it 4.8x faster fixed
  those two; it did NOT fix the class (see the next section — the 5s default was
  still the binding constraint on a busy machine, and "make it faster, don't raise
  the limit" was too strong a rule for a HANG GUARD).

## A RED SIM TEST THAT IS NOT A BUG — READ THE FAILURE LINE FIRST (2026-08-02)
- `sim/parking.spec.ts` (or any long-run sim case) failing on `master` with a
  DIFFERENT COUNT EACH RUN — 2 one time, 6 the next — is the signature. Before
  bisecting anything, read the failure line: `Test timed out in 5000ms.` is not an
  assertion, and nothing in the sim is broken.
- WHY IT CANNOT BE THE SIM. The road sim is deterministic — seeded `makeRng` only,
  no `Math.random`, no `Date.now`/`performance.now` anywhere in `src/sim` — and the
  assertions are pure functions of its state. Same commit + same seed CANNOT give a
  different assertion result. So on identical code, a varying failure set has
  exactly one mechanism left: the wall clock. Use that deduction; it cuts the
  search from "which commit broke parking" to "how loaded was the machine".
- REPRODUCE IT ON PURPOSE rather than waiting for it: 64 CPU burners on 20 cores
  (~9x) turned parking.spec.ts red with TEN timeouts and ZERO assertion failures,
  including both cases reported from a real red run. A scratch `while (Date.now() <
  end)` script under `Start-Process -WindowStyle Hidden` is the whole rig — and kill
  them by `CommandLine -like "*burn.js*"`, never by process name (this repo always
  has other node processes alive).
- Background jobs started with `&` in the Bash tool DIE when the call returns, so a
  "under load" run that way is really a run with no load at all. Detach them.
- MEASURED HEADROOM at the time of writing (idle → 4.5x load, vs budget): the cases
  on the old 5s default sat at 7–13x idle, which is under 2x once a second job is
  on the box. That is why the budget, not the behaviour, was deciding.
- THE FIX IS `testTimeout: 30_000` in `vitest.config.ts`, plus per-case 60s/120s
  where a case genuinely needs it. A timeout is a HANG GUARD, not a tolerance: it
  must be loose enough that a parallel suite run cannot fail it, and 30s stays under
  vitest's hardcoded 60s worker-RPC limit so a stuck test still names itself.
- A per-case timeout is only worth writing when it is LARGER than the default. The
  20s that sat on the bus-halt case was tighter than the new default and did nothing
  but reintroduce the bug on that one test.
- If a case wants more than 120s, make it CHEAPER (split per map/seed, as the
  long-run parking cases already are). Only the budget may be raised — never an
  assertion's tolerance — and a 120s case is proven safe with the in-loop
  `breathe()`: it times out cleanly instead of poisoning the run.

## TEST TIERS — fast lane vs full suite (2026-08-01)
- `npm run test:unit` = FULL (~1m07s). What CI and the implement pipeline run; its
  meaning is deliberately UNCHANGED, so nothing silently loses coverage.
- `npm run test:unit:fast` = fast lane (~28s): everything except the long-run sim cases.
- `npm run test:unit:changed` = only what your diff touches (vs `origin/master`) —
  the sharpest tool while iterating. Needs `origin/master` fetched; edit a core file
  like `sim/road.ts` and it correctly selects everything.
- `npm run test:unit:profile` = ranked file + test costs and slow-tier candidates.
  USE IT rather than guessing what to tag: the line moves whenever the hot path does.
- Tag with `itSlow` / `describeSlow` from `tests/unit/support/tier.ts`, at roughly
  >=900ms — in practice, anything stepping a sim more than a few hundred ticks.
- SPLIT BY TEST, NOT BY FILE. `sim/parking.spec.ts` is the slowest file in the suite
  AND holds ~60 millisecond-fast geometry/registry cases; tiering by file would
  leave anyone working on parking with no quick signal at all.
- The tier arrives via `test.env` in `vitest.fast.config.ts`, NOT a `VAR=x` prefix in
  package.json — that shell form does not work on Windows, which this project is
  developed on.
- The fast lane SKIPS rather than EXCLUDES, so a run still prints "112 skipped" —
  the standing reminder that a full run is owed before pushing.
- THE SUITE IS CPU-BOUND, NOT CRITICAL-PATH-BOUND — measure before you optimise the
  SHAPE of it. The obvious next lever looked like `sim/road.spec.ts`: 3k lines, 27
  describes, 18.5s of the fast lane, and one spec file is one vitest worker, so it
  "obviously" set the wall-clock floor. It did not. Splitting it into five files
  (2026-08-01) moved the whole-suite wall by NOTHING on a 4-core box: fast lane
  ~29.5s before and after, full lane ~70s before and after, both within run-to-run
  noise. Total CPU is ~87s (fast) / ~210s (full) against 4 cores, so wall ≈ cpu/cores
  and redistributing files cannot reduce total work.
  · The split IS worth it where cores are free: the same 98 road tests run 18.0s as
    one file vs 11.9s as five (1.5x), so it pays on an 8–16 core dev machine, where
    the largest single file DOES become the floor. It just is not what fixes CI.
  · GENERAL RULE: `wall ≈ max(total_cpu / cores, slowest_single_file)`. Work out
    which term binds on the machine you care about BEFORE moving files around. The
    2026-08-01 hot-path memo cut the first term 4x and was worth 4m22s -> 1m07s; the
    file split cut the second term and was worth nothing on CI.
- DO NOT CUT THE LONG-RUN CASES' SEEDS OR TICKS. It was considered and rejected on
  2026-08-02, and the reasoning is worth keeping so it is not re-proposed as an easy
  win. `parking.spec.ts`'s parkcity case runs 3 seeds x 4000 ticks = 200 simulated
  seconds; its own comment records that the collapse it exists to catch takes 50–120s
  to appear and that the 40s registry sweep cannot see it. Trimming to 3000 ticks
  saves ~4s of a ~65s suite and cuts the margin over the known worst case from 67%
  to 25% — and that 120s is an OBSERVED range, not a proven bound. Dropping a seed
  removes a third of the random exploration on the map most likely to expose a
  collapse. Bad trades both: the same 1.44x came from making the tick cheaper
  (see SIM HOT PATH → SPATIAL PRUNE) and cost no coverage at all.
- NEXT LEVER if the suite is still too slow: keep attacking CPU, not layout, and not
  coverage. The scans are still the profile's top (`clearAhead`, `bodySpanOnRoute`);
  a per-tick tile->cars index would beat the per-pair prune, but it has to survive
  the fact that `step` moves cars one at a time, so the index goes stale MID-TICK —
  the same hazard the body memo dodges by keying on state instead of on the tick.

## VERIFY
- THE SUITE CAN EXIT 1 WITH EVERY TEST PASSING, and the message names nothing:
  `Tests 2173 passed` followed by `Unhandled Error: [vitest-worker]: Timeout
  calling "onTaskUpdate"`, `Errors 1 error`. Not flaky infrastructure, not our
  assertions — it reproduced on `master` too, and the parking work made it
  reliable rather than occasional by roughly doubling the runtime.
  · MECHANISM: the worker reports each finished test over birpc, whose timeout is
    a HARDCODED 60s (`DEFAULT_TIMEOUT = 6e4` in vitest's bundle — no config knob,
    which is why the fix is a setup file). The reply arrives on a MessagePort =
    a MACROTASK, and vitest chains synchronous test bodies through MICROtasks, so
    a worker running long tight sim loops never yields to the macrotask queue.
    The reply sits unread, the timer fires, the run is poisoned by a test that
    passed.
  · It survives `--pool=forks` AND `--no-file-parallelism`. That rules out
    cross-worker contention and points at one worker starving its own loop —
    which is the diagnosis that matters, because "reduce parallelism" is the
    natural wrong guess.
  · FIX: `tests/unit/setup.ts` awaits a `setImmediate` in a global `beforeEach`.
    Microseconds per test, scales with the suite instead of with any one file.
    Verified green over five runs in all three pool configurations.
  · That covers BETWEEN tests. A single test that blocks 60s on its own is still
    its own problem: keep long-run sim cases PER MAP (not a loop over all three)
    and yield inside multi-thousand-tick loops — see `parking.spec.ts`, where one
    case over three maps ran 70s and tripped this on its own.
  · While you are there: don't run the SAME sims twice to measure two different
    things. The liveness and leaver-wait checks each walked 3 maps x 3 seeds x
    4000 ticks until they were merged into one pass — a third of the suite's
    runtime spent simulating identical traffic to look at a different field.
    207s -> 138s, no coverage lost.
  · 2026-08-01: the hot-path memo above cut the suite 4m22s -> 1m07s, which makes
    this far less likely to fire — but the setup file STAYS. It is the cheap
    insurance, and the next long-run case re-arms the trap.
- `npm run build` (vue-tsc+vite) = fastest gate; `npm run test:unit` = math. Keep green.
  While iterating use `test:unit:changed` or `test:unit:fast`; run the FULL lane
  before you push (see TEST TIERS above).
- `npm run probe` = RENDER-level audit of every registry scenario (90 today) in a real browser
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
- `npm run shot` runs with DEBUG **OFF** since 2026-08-02 — the default flipped
  exactly because the debug reservation tint (`.tile-status--free`, an OPAQUE
  green) covers everything under it (ground art, terrain, depot art), so a
  terrain change verified with the old default looked like it did nothing. PR
  screenshots are debug-free; `--debug` opts back in when the driving-lines ARE
  the subject (use it for BOTH halves of a before/after, and say so in the PR).
  `--no-debug` still parses (it is now the default, kept for old commands).
- SHOT DEBUG STATE IS ASSERTED, NOT ASSUMED: the script reads the stage's toggle
  (`.test-stage.debug`) and clicks until it matches the requested state, so it is
  immune to the app's default drifting. Nothing else needs configuring —
  `gameConfig.debug` is `false` and NOT persisted (no localStorage key, unlike
  `worldTheme`), so a `/#/play?…` route shot, which has no stage toggle at all,
  is debug-free by construction.
- SAME RULE FOR THE BG TOGGLE since 2026-08-20 — it was blind-clicked before,
  which ALTERNATED flat/themed across the ids of one multi-scenario run
  (gameConfig survives hash navigation; the app instance is never reset between
  scenarios), silently breaking before/after pairs shot in runs of different
  length or position. The script now reads `#app.bg-plain` and clicks only on a
  mismatch. Any future stage toggle the script drives must follow this
  read-then-click shape.
- FLAT ≠ BARE: `plainBackdrop` only re-anchors the ground TONE (app ground
  `#3f6b40`, terraces via `TERRACE_BASE.plain`) — the meadow scatter (tufts,
  flowers, patches) still draws. So tell flat from themed by tone (pixel-sample
  the grass: flat ≈ `#3f6b40`, meadow ≈ `#6aac6a`), not by looking for an empty
  green field.
- `tests/unit/sim/roadScenarioSweep.spec.ts` = BEHAVIOURAL sweep of every road
  scenario (iterates `SCENARIOS`): populates, flows, never stands still, bodies
  never clip. Flow is measured as tile CROSSINGS — despawn counts call a closed
  circuit (`carcircle`, `overtakeloop`) gridlocked when its cars are lapping fine.
  `KNOWN_OVERLAP` there is EMPTY since #56 and stays empty — every scenario is held
  to the clean 0.02 bound, so a re-appearing entry is a regression, not a fact of
  life. Sweeping at several seeds is worth it and the sweep itself does not: the
  four bus maps #56 named were merely the ones that clipped at SEED 5, while
  `roadstraightlanes` / `overtakeloop` / `signalturnlanes` were just as broken one
  seed over, and `parkcity`'s worst seed is 1 at baseline and 7 after.
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
- A SHOT IS NOT REPRODUCIBLE PIXEL-FOR-PIXEL WHILE TRAFFIC MOVES, so "identical
  before/after" needs saying carefully. Two runs of the SAME tree on
  `parkvariants` differ by ~24.7k pixels — the rAF loop steps on wall-clock time,
  so every car is a few px along. Diffing paint (a refactor, a marking, an apron)
  means `--density 0` AND a same-code control diff to establish the floor: the
  parking extraction measured 24,748 differing px against its baseline and 24,650
  against a second run of ITSELF, with 4 of 5 maps byte-identical. Quote the
  control number or the claim is unfalsifiable.
- `npm run test:e2e` NEEDS THE SAME FALLBACK SEPARATELY. The runner launches
  Chromium itself and never goes through `launchChromium`, so all 29 specs failed
  on "Executable doesn't exist" in the very container where `shot` and `probe`
  were working. `playwright.config.ts` now sets `launchOptions.executablePath`,
  but ONLY when the pinned build is genuinely absent (`pinnedChromiumMissing`) —
  a machine that ran `npm run browsers` is untouched.
- BROWSERS, IN A CLOUD SESSION: the box already HAS a Chromium
  (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and it is not the revision
  playwright-core pins, and the CDN the installer downloads from is off the
  network policy — so `chromium.launch()` said "Executable doesn't exist" and
  advised a download that cannot happen. `scripts/browser.mjs` (`launchChromium`,
  used by `shot` + `probe`) tries the pinned build, then falls back to any
  chromium in the registry root, and PRINTS which — a shot taken with another
  build is worth knowing when comparing pixels. `install-browsers.mjs` had also
  mapped win64 archives only and threw on Linux; every platform is mapped now.
- `npm run shot`/`npm run probe` ORPHANED THEIR DEV SERVER ON POSIX TOO, for the
  same reason as the Windows case below: `npm run dev` LAUNCHES vite, and
  SIGTERM to the launcher left vite holding the port, so the very next run hit
  the pre-flight refusal. Both now spawn `detached` and signal the process GROUP
  (`process.kill(-pid)`) — the POSIX `taskkill /T`.
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
- TRAP — `npm run test:e2e` CAN TEST SOMEBODY ELSE'S WORKTREE (2026-07-27, cost
  half an hour). `playwright.config.ts` pins port **5180** with
  `reuseExistingServer: !CI`, and every worktree shares that port. A dev server
  left running by another worktree is silently REUSED, so your suite runs
  against THAT tree's code. Symptom is uncanny: tests fail for features the
  other tree simply does not have (`.score-calendar` "element(s) not found"
  while the same page renders perfectly under `npm run dev`), AND unrelated
  long-standing tests fail too (`.switch-box` on the default board) — the give-
  away is that the SAME failure reproduces from a clean `master` worktree.
  Check with `netstat -ano | grep :5180` before believing an e2e failure, and
  kill stray servers (the WORKFLOW rule "kill bg dev servers when done" is
  load-bearing, not tidiness).
- `npm run probe`'s COVERAGE IS NONDETERMINISTIC — measured 76, 79 and 82 ids on
  three consecutive runs of an unchanged tree, and it still prints "all scenarios
  clean" either way. So a green probe is NOT proof your new scenario was probed;
  check the listing for its id, or re-run. Cause is the picker walk: `linksOn`
  navigates by HASH ONLY (no reload) and then waits for "any `#/test/` link",
  which the PREVIOUS page's links already satisfy, so it can enumerate the page
  it just left. The same race is why the explicit form `npm run probe -- <id>`
  can fail with "no .level element" on `buildgap`/`taxyear`/`lakevalley-open` —
  those are bare back-compat ids that REDIRECT to `domain/category/id`, and
  `waitForFunction(() => !!window.__game)` is satisfied by the prior scenario's
  stale handle. Reproduced on clean master, so pre-existing. Not fixed here (the
  probe is the whole repo's render gate and this was a tycoon task). The
  reliable every-scenario sweep is `tests/e2e/scenarios.spec.ts`, which
  enumerates `window.__scenarioIds` — the flat registry — instead of the DOM.
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
- #56 (bodies clip mid-lane-change) is FIXED — see LANE-CHANGE GAP ACCEPTANCE
  above. `KNOWN_OVERLAP` is empty; 72 road scenarios x 5 seeds measure 0.000 but
  for `/test/parkcity` seed 7 (0.035, a junction-seam lane reassignment, not a lane
  change — noted under JUNCTION SEAM). The two earlier attempts failed because they
  treated it as ONE bug; it was five (multi-lane commit, seam blindness,
  straddle-stall, integer-lane following, an over-extrapolated lean).
  `/test/lanechangegap` is the mechanic in isolation.
- Train Valley phase 2 (build in play) is BUILT (2026-07-26) — see BUILD IN
  PLAY above. The route-draw gesture lives headless in `routeDrawController.ts`
  (`createRouteDrawController({drawing, planOpts, lay})`, pinned by
  `routeDrawController.spec.ts` + the editor e2e); each gesture emits ONE
  `lay(RouteStep[])` with anchor/terminus straights in commit order. The editor
  lays cell by cell (`commit`+`layPair`, rail OR road); PlayView hands the same
  array to `game.buildRoute` ATOMICALLY (rail-only, priced). Steps travel a→b.
  Still in the views, deliberately: tool→layer mapping, `layPair` (lane
  count/bus/one-way), preview PAINT. `lakevalley-open` (2026-07-26) is the
  played result — see LAKEVALLEY-OPEN above. The annual tax + calendar clock
  (the economy's second sink/clock) landed the same day — see THE SECOND CLOCK.
- `cfg.lay` runs through the caller's layer choice AT CALL TIME: finishing a
  pending frontier via a tool switch (`toolChanged`) lays the terminus per the
  NEW tool's layer (road route → switch tool → terminus laid as RAIL). That is
  pre-existing editor behaviour, preserved verbatim in the extraction — a fix
  would be a behaviour change, decide it separately.
- The "start `lakevalley` with a GAP in the ring" step is DONE (2026-07-26):
  `/test/lakevalley-open`, playable at `/#/play?mode=tycoon&board=lakevalley-open`
  — see LAKEVALLEY-OPEN above for the tuning and the sim facts it rests on.
- The gallery is 82 scenarios. The road sweep and `tests/e2e/scenarios.spec.ts`
  iterate the registry, so a new scenario is covered the day it is added.
  `npm run probe` walks the DOM instead and its coverage varies run to run
  (see VERIFY) — read its listing, don't trust "all scenarios clean" alone.
- The SECOND CLOCK is built (2026-07-26): calendar + annual tax, §8 item 1, and
  BANKRUPTCY followed it (2026-07-27), and the refund became a demolition FEE
  with UNDO taking over the misdrag case — see the three sections above. NEXT UP
  (design doc §8): goals on the Ready card, the last sliver of M9.

## WORKFLOW
- A GREEN LOCAL SUITE PROVES NOTHING ABOUT A PR WHOSE BASE MOVED (2026-08-03).
  Actions checks out your head MERGED WITH THE CURRENT BASE, so it runs code
  pairs that exist nowhere on your machine. Phase 9 went red on a test another
  session had landed minutes earlier: the merge itself was CLEAN, and the two
  changes were still incompatible (their test read a platform's colour as a
  train livery; D11 had moved it to the line). Before calling a PR done, fetch
  master and re-run — a conflict check is not enough, because this class of
  break has no conflict to find.
- And when it does break: the fix is usually in YOUR code, not their test. Ask
  what the other session's assertion was trying to say, and make that true.
- WRITE LOCALHOST LINKS IN A PR BODY ANYWAY (2026-08-08). The hand-back links are
  written against the dev server because that is where the author was looking,
  and a reviewer has no dev server — so `deploy.yml` rewrites them after the PR
  preview deploys: `http://localhost:<port>/…` ->
  `https://cyclodex.github.io/train-game/pr-preview/pr-<N>/…`. Same paths, same
  hash routes. It runs on EVERY push to the PR, so links added later are caught
  too, and it is idempotent (the trailing slash is part of the match, so a
  rewritten URL no longer matches).
  · It runs on `edited` too, as its OWN job with no build behind it. A body is
    very often written AFTER the push that deployed the preview (it was on the
    PR this shipped on), and a rewrite bolted to the deploy job leaves those
    links dead until someone happens to push again. No loop: an edit made with
    GITHUB_TOKEN does not itself trigger a workflow.
  · BODY ONLY. Comments are a conversation with a timestamp; rewriting posted
    words after the fact reads worse than a stale link — paste preview URLs
    there yourself.
  · Fork PRs never reach the step: their token cannot push to gh-pages, so the
    whole preview job is skipped.
- TRAP — DO NOT EDIT SOURCE WITH A PYTHON SCRIPT unless you write it back in
  BINARY. `io.open(p, "w")` on Windows translates every `\n` to `\r\n`, so a
  one-line change rewrites the WHOLE FILE as CRLF. It is invisible in the editor
  and at a glance in `git diff`; what you see is a commit of 5,268 lines where
  830 were meant, and then a MERGE THAT CONFLICTS ON ENTIRE FILES, because every
  line differs. Cost a merge and an amend on 2026-07-27. The repo is MIXED:
  `src/` and `tests/` are LF, `docs/KNOWHOW.md` is CRLF — so normalise per file
  (`file <path>` says what is on disk, `git show HEAD:<path> | file -` says what
  is STORED). Prefer the Edit tool; if a script is genuinely easier, read and
  write `"rb"`/`"wb"` and do the replacement on bytes.
- Trunk-based MASTER-ONLY (since 2026-06-11); develop deleted. Branch from / PR to master.
- `gh` IS installed + authed, but NOT on the agent shells' PATH: call it by full
  path `"C:\Program Files\GitHub CLI\gh.exe"`. Bare `gh` ENOENTs and the REST API
  404s unauthenticated (private repo) — don't conclude "no GitHub access" from either.
- Commit your scoped change as soon as done+green, unasked. Heavy parallel editing
  of same files (`road.ts`, `editOps.ts`, scenario `index.ts`) — stage only your
  hunks. NO AI attribution in commit msgs.
- LINE ENDINGS: this branch settled it — `.gitattributes` (`* text=auto eol=lf`)
  plus a one-off normalise, so the repo is LF everywhere, on disk and in the tree.
  MASTER DOES NOT HAVE IT YET, and its files are still partly CRLF, so a plain
  `git merge origin/master` conflicts on WHOLE FILES (every line differs on both
  sides). MERGE MASTER WITH `git -c merge.renormalize=true merge origin/master`:
  on 2026-07-31 that turned 8 whole-file conflicts into 2 real ones (a scenario
  list and an import block). Once the `.gitattributes` lands on master this stops
  mattering; until then, renormalize every time.
- Worktrees: node_modules usually resolves up to repo root (try tooling first). If
  junctioned, remove junction (`cmd /c rmdir`) BEFORE `git worktree remove` or it
  deletes the real install. Kill bg dev servers when done.

## BULLDOZE + GRIDLOCK (2026-07-26)
- SUPERSEDED 2026-07-27 — bulldoze no longer refunds; see UNDO vs BULLDOZE. The
  old rule ("refunds must track purchases, or the authored ring is a cash
  machine") is gone with the refund itself: `boughtPieces` now only backs UNDO.
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

## DEPLOY (GitHub Pages, 2026-08-01)
- Static hosting works because the router uses HASH history and vite base is
  RELATIVE ("./" in vite.config.ts) - the same dist/ runs at any URL depth. Do
  not switch to createWebHistory or an absolute base without rethinking Pages.
- `.github/workflows/deploy.yml`: master push -> gh-pages root
  (cyclodex.github.io/train-game/); PRs -> pr-preview/pr-<N>/ via
  rossjrw/pr-preview-action (link commented on the PR, removed on close). The
  master deploy uses clean-exclude: pr-preview/ so it must NOT wipe previews;
  both jobs share one concurrency group because both push to gh-pages.
- One-time repo setting: Settings -> Pages -> Deploy from a branch -> gh-pages
  / root. Fork PRs are skipped (read-only token cannot push gh-pages).
- Cleanup-on-close does NOT run for a PR closed with a merge conflict: GitHub
  creates no pull_request workflow runs for conflicted PRs at all (same reason
  CI never verdicts them), so its pr-preview/pr-<N>/ lingers on gh-pages --
  delete the directory by hand (seen with #62, 2026-08-01).
