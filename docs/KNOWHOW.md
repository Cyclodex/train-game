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
- `npm run probe` = RENDER-level audit of all 68 scenarios in a real browser
  (`scripts/probe.mjs`): every tile in the grid cell its coord names, no red
  mismatch paint, no console errors, every merge arrow forward + leaning to the
  survivors. Sits between unit tests (sim behaviour) and `shot` (eyeball). Run it
  after ANY renderer/layout change — it catches what a screenshot won't, across
  maps nobody opens. Ids come from walking the picker, so new scenarios are covered free.
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

## STATE (2026-07-25) — read before picking up work
- Nothing is PUSHED. `master` holds the merged road-rendering work; branch
  `claude/bigger-worlds` is ahead of it with worlds+camera+demoworld. Check
  `git log --oneline origin/master..HEAD` before assuming a remote knows anything.
- OPEN BUG #56: bus bodies clip when a lane change crosses a tile seam mid-merge
  (4 bus maps, 0.037-0.085 tiles). Pinned in `KNOWN_OVERLAP` in
  `roadScenarioSweep.spec.ts` so it cannot worsen. TWO fixes were tried and
  MEASURED WORSE — read the issue before attempting a third.
- NEXT UP (agreed): terrain as tile data, spec written and not started —
  `docs/superpowers/specs/2026-07-25-terrain-as-tile-data-design.md`. Cosmetic
  first; bridges are the prize. See IMPROVEMENTS.md item 1.
- The gallery is 69 scenarios. `npm run probe` + the road sweep both iterate the
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
