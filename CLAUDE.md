# CLAUDE.md

Guidance for working in this repository.

> **Read `docs/KNOWHOW.md` first** — the dense engineering canon (rail-vs-road
> curves, junction lane rules, road rendering, recurring traps, verification).
> **Upkeep is part of every task:** when you learn, correct, or disprove something
> in it, edit `docs/KNOWHOW.md` in the same commit (add/fix/prune one-line facts).
> It only stays useful if each task tends it.

## What this is

A browser-based **train simulation game** built with **Vue 3 + TypeScript**. A
grid of track tiles (straights, curves, intersections, depots) is laid out, and
trains made of a locomotive plus wagons travel from depot to depot, obeying
traffic signals and switchable intersection routes. A deterministic simulation
moves the trains; the renderer draws each loco/wagon at its sampled point along
the per-tile SVG path.

It has since grown a parallel **road layer** — multi-lane roads carrying cars,
trucks and buses, with lane-aware junctions, junction traffic signals and
level crossings where road meets rail (`src/sim/road*.ts`, `src/tiles/lanes.ts`)
— and a **game-modes framework** (`src/modes/`: sandbox, puzzle, daily, time
attack, crossing keeper) layered over the same simulation, plus swappable world
**themes** (`src/themes.ts`). The road layer is gated by `gameConfig.roads`.

It started life as the Emergency Room team's `vue-base` starter (see README).
The starter scaffolding (the `counterExample` Vuex module, `HelloWorld.vue`, the
unused `TileIntersection.vue` variant) has been removed.

## Tech stack

- Vue 3.5, class components via **`vue-facing-decorator`** (the maintained Vue 3
  successor to `vue-property-decorator`).
- **`vue-router`** (hash history) with three routes: `/play` (the game),
  `/editor` (the level editor) and `/test/:domain?/:category?/:scenario?` (the
  feature-test gallery); `/` redirects to `/play`.
- TypeScript 5.
- A hand-written `requestAnimationFrame` loop drives movement (GSAP was removed
  when the simulation took over).
- **Vite 6** build, **Vitest** for unit tests, **Playwright** for e2e, ESLint +
  Prettier. There is no Vuex — game state lives in the simulation + `App.vue` and
  a small provided `gameConfig`.

## Dev commands

```
npm install            # or: npm ci  (.npmrc sets ignore-scripts + save-exact)
npm run dev            # Vite dev server at http://localhost:5173
npm run build          # vue-tsc type-check + vite build -> dist/
npm run preview        # serve the production build
npm run test:unit      # vitest run — THE FULL SUITE (~1m). What CI runs.
npm run test:unit:fast # ~28s: skips the long-run sim cases. While iterating.
npm run test:unit:changed # only tests your diff touches (vs origin/master).
npm run test:unit:profile # where the suite's time goes + slow-tier candidates
npm run browsers       # install the Playwright browser builds (once per machine)
npm run test:e2e       # playwright e2e (needs `npm run browsers` first)
npm run lint           # eslint --fix
```

No `--openssl-legacy-provider` is needed any more; the legacy webpack toolchain
is gone. `.npmrc` sets `ignore-scripts=true`, so Playwright's browsers are not
auto-downloaded — run **`npm run browsers`** once before `npm run test:e2e` or
`npm run shot`. Use that rather than `npx playwright install`: the upstream
installer hangs during extraction on some Windows machines, leaving a half-written
browser directory and a lock that makes every retry hang too. See
`scripts/install-browsers.mjs` and `docs/KNOWHOW.md` → VERIFY.

## Architecture

The game is split into an **authoritative, headless simulation** (`src/sim/*`,
plain TS, no Vue/DOM) and a **thin rendering layer** (Vue components + a
`requestAnimationFrame` loop in `src/game.ts`). The simulation owns game state and
advances on a deterministic `step(dt)` tick; the renderer just draws the current
state. Movement decisions (stop/go, collisions, red signals) live in the model,
not in animation callbacks — this is what makes it stable and unit-testable.

### Tile model (`src/tiles/`) — the single source of truth

A tile is **data**, not a class hierarchy. Each grid cell is a `TileCell`
`{ connections: PortPair[], role?, signals? }`, where `connections` are unordered
port pairs over N/E/S/W/Center. **Everything is derived from `connections`** —
the kind label (`kindOf`), the SVG rail geometry (`tiles/geometry.ts`), and the
simulation's exit-port routing (`connectionsToExitPort`). Both the sim and the
renderer import this module, so topology is defined exactly once. See
`docs/superpowers/specs/2026-06-05-data-driven-tiles-design.md`.

- `model.ts` — types + core derivations (`connectionsToExitPort`, `armExit`,
  `kindOf`, `partnersOf`, `portsOf`, rotation helpers, `parseCoordId`).
- `kinds.ts` — `expandKind("straight"|"curve"|"cross"|"tjunction"|"depot",
  rotation, { signals, disable })`: friendly authoring sugar → `TileCell`.
- `geometry.ts` — `railPathsFor()`: the two rail paths per connection.
- `autotile.ts` — `deriveConnections()`: derive a cell's connections from its
  neighbours. Used by the generator (the editor draws connections explicitly).
- `editOps.ts` — pure single-cell editing reducers (`toggleConnection`,
  `setDepot`/`rotateDepot`, `toggleSignalPort`, `setJunctionSignalMode`,
  layer-scoped `eraseLayer`) used by the editor.
- `validate.ts` — `validateLevel()`: connectivity / dangling-track / reachable
  depots / per-train route checks.
- `generate.ts` — `generateLevel(seed, opts)`: seeded procedural levels (a track
  loop + depot spurs), gated by `validateLevel`.
- `lanes.ts` — the road lane model: `Lane` (from/to ports, index, optional
  kind/restrictions), per-vehicle-class access (`laneUsableBy`, `laneExits`,
  `usableExits`, `busLaneIndices`), and authoring sugar (`oneWay`, `turns`,
  `twoWay`, `fromPairs`).
- `roadGeometry.ts` — SVG road rendering: lane-marking paths (centre/inner
  dividers, kerbs, merge/lane-drop arrows). Complements `sim/pathGeometry.ts`,
  which produces the car centreline a vehicle actually drives.
- `parking.ts` — the PARKING layer (`TileCell.parking`), the fourth axis of the
  tile model: rows of stalls on a road approach, their derived geometry (bay
  boxes, the arc-length-parameterised pull-in curve), facility grouping and
  `validateParking`. A car park's aisles are ordinary `road` lanes, so the router
  drives its rows for free; `parkingGeometry.ts` paints the bays and garage ramps.
- `routePlanner.ts` — the editor's track route builder (pure/headless):
  `planRoute()` runs Dijkstra over `(tile, entry direction)` for the shortest,
  turn-minimised path, returning the per-cell connections to lay (or `null`).

### Simulation (`src/sim/`)

- `topology.ts` — `oppositePort` + `neighborCoord` (port/neighbour math). Exit-port
  resolution now lives in `tiles/model.ts` (`connectionsToExitPort`).
- `network.ts` — `traverse()`: from a tile + entry port, the exit port and the
  next tile/entry (reads `TileCell.connections`).
- `simulation.ts` — `createSimulation()` + `step(dt)`. Trains advance along the
  graph as `(segment, progress)`. **Path reservation / interlocking:** at a signal
  a train reserves the whole route to the next signal (`routeToNextSignal` in
  `network.ts`); it only enters if every tile is free, so no other train can enter
  or cross that path. Signals show `signalAspect()` (Stop/Proceed) and have a
  manual `toggleHold()`; an occupancy backstop covers unsignalled track. Depots
  park on a colour match or bounce on a mismatch and emit events. `sampleTrain()`
  returns loco+wagon positions for rendering. See `docs/signaling-design.md`.
- `pathGeometry.ts` — `segmentPathD()`: the SVG path a train (or car) follows
  across a tile, derived purely from its entry+exit ports.
- `physics.ts` — `trainDynamics()`: derives accel/brake rates from train mass
  (loco + wagons, scaled by wagon type) so heavier trains start/stop more gently.
- `trainDimensions.ts` — single source of truth for loco/wagon sprite pixel
  widths + coupling gap, with px↔tile conversion helpers.
- `objectives.ts` — `createObjectiveTracker()`: the mode-agnostic objective state
  machine (ready/playing/won/lost), counter accumulation (deliveries, mismatches,
  elapsed, crossings) and star/fail-predicate evaluation used by `src/modes/`.

#### Road traffic (`src/sim/road*.ts`, gated by `gameConfig.roads`)

A second vehicle simulation reuses the same tile/lane topology and runs each
tick alongside the trains. Cars/trucks/buses follow lane centrelines as
`(segment, progress)` with continuous lateral lane position (overtaking is a
lane-change state machine).

- `road.ts` — the `RoadSim` core: vehicle kinds + specs, spawn/despawn, lane
  dynamics, and the API (`step`, `sample`, `bodies`, `routePath`,
  `junctionOccupancy`, `signalAspect`, `cycleSignal`).
- `roadRouter.ts` — `planRoute()`: seeded BFS from a spawn entry to a random exit,
  vehicle-class aware (cars skip bus-only lanes), returning per-junction turns.
- `roadJunction.ts` — the lane-aware conflict matrix (`movementsConflict`,
  `sameEntryConflict`, `buildConflictMatrix`): which movements geometrically
  cross inside a junction tile.
- `roadArbiter.ts` — `fcfsWithPriorityArbiter`: first-come-first-served junction
  arbitration with road-priority yielding and a starvation backstop.
- `junctionSignal.ts` — `createJunctionSignal()`/`cycleJunctionSignal()`: timed
  green/amber/all-red controller (two-phase or round-robin, optional bus
  priority) for signalised junctions.
- `laneOffset.ts` — lateral pixel-offset math for lanes, handling road tapering
  at tile seams (min-seam rule) so merges read smoothly.
- `parking.ts` — the parking REGISTRY: which stall is taken, which car park is
  full, plan-time "aim" tokens so a facility that is spoken for is avoided like a
  full one, and the vehicle-fits-the-bay gate. `road.ts` runs the car phase
  machine (driving/entering/parked/leaving) on top of it.

### World size + camera

A world is as big as its content: `src/tiles/bounds.ts` (`levelBounds`) derives
the grid from the level's own tile coordinates, and both boards render that. The
simulation always worked this way — the old fixed 7x6 was a rendering cap in the
views alone. `normaliseLevel`/`translateLevel`/`translateTrains` re-base a level
so it can grow up and left while the engine keeps its "the world starts at 0,0"
assumption.

Because a world can now be far larger than the screen, PlayView and TestStage
share a camera (`src/camera.ts` for the maths, `src/cameraController.ts` for the
pointer/wheel glue): drag to pan, scroll to zoom about the cursor, fit on open.
The board renders at the native 200px tile and the camera moves a window over it.
The editor grows by drawing into a two-cell margin, plus ⬅︎+ / ⬆︎+ to extend
before the origin. `src/levels/test/scenarios/demoworld.ts` is the 20x14 demo:
a signalled rail ring with depot spurs over a street grid, meeting at eight level
crossings — playable at `/#/play?board=demoworld`.

### Renderer

- `src/game.ts` — `createGame()` owns the sim, the switch/signal/colour state,
  and the rAF loop (pause/speed scale `dt`). Each frame it ticks the sim and
  writes loco/wagon transforms straight to the DOM (positions sampled from the
  segment path). `PlayView.vue` creates/provides it (`markRaw` — never proxy the
  sim).
- Components are views: `Train.vue` is a pure sprite renderer; the single
  `Tile.vue` renders *any* cell from its `connections` (rails, signals, junction
  switches, depot art) and publishes live switch/signal state into the game so the
  sim routes accordingly. Traffic signals are a manual tool (default green);
  collisions are handled by the occupancy gate, not signals.

Game state is seeded in `src/views/PlayView.vue` via `@Provide()` / `@Inject()`:

- `level: Level` — a map keyed by `"x,y"` of `TileCell`s (see `src/tiles/`). The
  default level lives in `src/levels/default.ts`; a level built in the editor or
  generated is handed over through `src/levelStore.ts` (in-memory + localStorage).
- `trains: TrainsDefinition` — each train's starting depot, type (`people` |
  `fraight` [sic]), and wagons (the simulation owns live position).

Global config is a reactive object in `src/gameConfig.ts`, provided once at the
app level in `src/main.ts` and injected into components as `config`: `tileSize`
(200px), `levelSizeX` (7 — now only the MINIMUM canvas a new board starts on; a
world's real size is derived from its tiles by `levelBounds`, see
`src/tiles/bounds.ts`), `debug`, `automaticTrafficLights`,
`automaticRoutePlanning`, `railDistanceFromPath`, `switchLockMode`
(`off`/`reserved`/`occupied` interlocking strictness), `colorSeed` (deterministic
depot/train colour assignment), `roads` (master switch for the road layer),
`roadScoring`, `maxCars` (road density as a % of map capacity, read live),
`worldTheme` (persisted backdrop theme) and `plainBackdrop` (debug: strip the
themed backdrop for flat ground). Toggle `debug` in the UI to see per-tile
coordinates and route overlays. `setWorldTheme()` mutates + persists the theme.

Key files:

- `src/main.ts` — `createApp`, provides `gameConfig`, registers `Tile`/`TileRail`/
  `Train`/`DebugShowRoutes`/`CarRouteOverlay` globally, installs the router.
- `src/router.ts` — `/play` (PlayView) + `/editor` (EditorView) + `/test/…`
  (TestView gallery), hash history.
- `src/App.vue` — thin shell: `<router-view>`.
- `src/views/PlayView.vue` — level + train definitions, creates/provides the game,
  pause/play and speed (1x/2x/4x scale the loop's `dt`), delivery count, layout.
- `src/views/EditorView.vue` — the build tools behind a three-row dock
  (`BuildDock.vue`): four categories (Rail / Road / Terrain / Bulldozer) with
  tabs separating the verbs (Rail: Track·Stations·Signalling; Road:
  Roads·Upgrade·Traffic lights·Parking; Terrain: Ground·Height). Road widths
  are catalog items with a live cross-section preview; traffic-light modes are
  pick-then-apply items; the bulldozer erases per layer (all/rail/road/parking/
  terrain). Keys 1–4 switch categories; each remembers its last tab+tool.
  Connect draws rail connections explicitly (drag edge dot → edge dot; a ✕
  handle deletes one rail); signals are per-direction (click a port). Live
  validation, random-map button, export/import, "Play this" hand-off. Design:
  `docs/superpowers/specs/2026-08-21-build-ui-redesign-design.md`.
- `src/game.ts` — the `createGame()` controller + rAF render loop (see above).
- `src/sim/*` — the headless simulation (see the Simulation section).
- `src/tiles/*` — the data-driven tile model (see the Tile model section).
- `src/components/Tile.vue` — the single data-driven tile view (rails, signals,
  switches, depot), replacing the old per-kind components.
- `src/components/Train.vue` — pure loco/wagon sprite renderer (positioned by the
  game loop).
- Other components: `Crossing.vue` (level-crossing booms/lights),
  `CarRouteOverlay.vue` (debug car-route line), `MenuDrawer.vue`/`BuildDock.vue`
  (frosted-glass HUD chrome; BuildDock is the editor's three-row build dock),
  `ScenarioThumb.vue` (static test-gallery preview).
- `src/modes/` — the game-modes framework. `types.ts` defines the `GameMode`
  contract (setup, controls gating, `createObjective`, optional `Spawner`, HUD);
  `index.ts` is the registry; one file per mode (`sandbox`, `puzzle`, `daily`,
  `time-attack`, `crossing-keeper`); `lastMode.ts` persists the last-opened mode.
- `src/themes.ts` — world backdrop registry (`THEMES`, `nextTheme`, `isWorldTheme`);
  `src/utils/meadowBackdrop.ts` builds the seamless meadow backdrop SVG.
- `src/objectiveStore.ts` — per-level best-result (stars/time) persistence;
  `src/gameLog.ts` — humanises `SimEvent`s into an activity log;
  `src/utils/colorAssignment.ts` — deterministic, solvable depot/train colours.
- `src/types.ts` — all enums/interfaces (TrainStatus, TrafficLight, Position,
  Route, Rotations, etc.). Read this first to understand the domain.
- `src/utils/tileHelpers.ts`, `trainHelpers.ts`, `globalHelpers.ts` — coordinate
  math, direction/position conversions, colour list.

Coordinate system: `x` increases right, `y` increases down. `Position`
(Top/Right/Bottom/Left/Center) and `TrainDirection` (U/R/D/L/N) are converted via
the helpers — note the entrance position is the opposite side of the direction of
travel.

## Vue 3 / vue-facing-decorator conventions

- Components export `export default toNative(TheClass)`. (The old tile class
  hierarchy is gone — a single `Tile.vue` now renders every tile from data, so no
  component `extends` another.)
- Reactive state mutates in place (Vue 3 deep proxies) — no `Vue.set`.
- **Plain controllers/DOM objects must be `markRaw()`-ed** before being stored in
  reactive state. The `game` object (which holds the simulation and its refs) is
  provided with `markRaw` so Vue does not deep-proxy the sim or auto-unwrap its
  refs. This is the same hazard that broke the old GSAP timeline (a reactive
  Proxy breaks identity-based scheduling — a train would leave its depot once and
  then never advance).
- `Tile.vue` is a pure view: it draws rails/switches/signals/depot from the cell's
  `connections`, handles switch/signal clicks, and publishes live switch state
  into the game so the simulation routes through it. No cross-component `$refs` or
  movement logic lives in it.

## Conventions / gotchas

- "fraight" is the spelling used throughout for "freight" (type strings, asset
  names). Match existing spelling when touching that code rather than fixing it
  piecemeal, or do a complete rename in one pass.
- Stylesheets still use Sass `@import` (deprecation silenced in `vite.config.ts`);
  migrating to `@use` is a tidy follow-up.
- `/dist`, `/node_modules`, and test artifacts are gitignored.

## Feature test world (REQUIRED for every feature)

There is a feature test harness at the `/test` route: a registry of tiny,
isolated maps — **one per game mechanic** — presented as a drill-down gallery
(`domain → category → scenario`) and deep-linkable at
`/test/:domain/:category/:scenario` (bare `/test/:scenarioId` back-compat links
still resolve). It's both the manual-QA gallery and a debugging aid: a feature in
isolation on a 3-tile map is far easier to reason about than the same feature
buried in `DEFAULT_LEVEL`.

**Project rule: every feature you build must ship with its own test-world
scenario.** Adding (or meaningfully changing) a mechanic without a scenario that
demonstrates it in isolation is incomplete work. When debugging a feature, reach
for its scenario first.

- `src/levels/test/scenario.ts` — the `TestScenario` type + `mkTrain`,
  `scenarioGrid`, `scenarioRoutes` helpers.
- `src/levels/test/scenarios/*.ts` — one file per feature (straight, curve,
  depot, signals, junction, cross, crossing, …).
- `src/levels/test/index.ts` — the `DOMAINS` tree (domain → category → scenario,
  picker order); `SCENARIOS` is the flattened lookup-by-id list derived from it,
  with `locate()`/`firstScenarioOf()` helpers.
- `src/views/TestView.vue` (picker) + `src/views/TestStage.vue` (keyed per
  scenario; creates/provides a fresh `markRaw` game and sizes the grid to the
  map). `createGame`'s optional `colors?: ColorAssignment` arg (after `colorSeed`)
  pins depot/train colours when a scenario needs a determined outcome (e.g. a
  depot-mismatch bounce).

**To add a feature's scenario:** keep it as small as the mechanic allows (a
single lane for simple features; a 2D pocket with two trains for contention
features like signals/crossing, which only *mean* something when trains compete).
Add one `scenarios/<feature>.ts` and register it in the right category of the
`DOMAINS` tree in `index.ts`. The unit test
`tests/unit/levels/testScenarios.spec.ts` iterates the registry and validates
every map (connectivity, route reachability, trains-in-depots, grid fit), so a
broken scenario fails CI. Design notes:
`docs/superpowers/specs/2026-06-06-feature-test-world-design.md`.

## Ideas for improvement (project goal: iterate on the game)

See `IMPROVEMENTS.md` for the prioritised backlog.

## After every push: check for merge conflicts

`git push` succeeding says nothing about whether the branch still merges. Master
moves under you — another PR lands while you are working — and the first anyone
hears of it is a red "This branch has conflicts" on the PR, often hours later.

So the push is not finished until you have checked:

```
git fetch origin master
git merge-tree $(git merge-base HEAD origin/master) HEAD origin/master | grep -c '^+<<<<<<<'
```

Zero means clean. Anything else: merge master in, resolve, re-run
`npm run test:unit`, and push again — then check once more, because master can
move while you are resolving.

Conflicts here are usually trivial and of one shape: two branches each APPENDING
to the same list (a mode registry, a `Game` interface, the render frame's tail).
Keep both sides. Read what each addition is for before choosing an order — in
`frame()`, for instance, the render heartbeat has to tick LAST, after everything
it might wake has been mirrored.

## Verifying changes

`npm run build` (vue-tsc + vite) is the fastest correctness check, and
`npm run test:unit` covers the coordinate math.

**The unit suite has two lanes.** While you iterate, run `npm run test:unit:changed`
(only what your diff touches) or `npm run test:unit:fast` (~28s — the whole suite
minus the long-running simulation cases, which are tagged `itSlow`; see
`tests/unit/support/tier.ts`). Run the FULL `npm run test:unit` (~1m) before you
push — the fast lane prints how many cases it skipped, so it never pretends to be
the whole story. `npm run test:unit:profile` shows where the time actually goes and
which cases are candidates for the slow tier; check it rather than guessing, and
re-check after touching the simulation's hot path. Do NOT tag a test slow to get a
red suite green — a slow test that fails still fails in the full lane.

For behaviour, `npm run test:e2e`
boots a real browser and asserts the level renders 41 tiles + 2 trains, the
trains physically leave their depots, no two trains share a tile, a puzzle-mode
run reaches its win overlay, and there are no console errors. For visual
work, `npm run dev` and open http://localhost:5173 (debug overlay is off by
default — toggle it in the UI). When you add a feature, verify it in its
`/test/:id` scenario (see
**Feature test world** above) — that is the required check that the mechanic
works in isolation.

**Visual changes need a screenshot.** Anything visible on the board (a scenario,
tile/road/lane rendering, the debug driving-line overlay, junctions, vehicles,
signals, depots, trains) is verified with a picture, not just prose. Use the
committed helper:

```
npm run shot -- <scenarioId> --label before     # baseline, before your change
npm run shot -- <scenarioId> --label after       # after — same scenario
```

It loads `/test/<scenarioId>` in a real browser with the **Debug overlay off**
(what a player actually sees) and a flat backdrop, then writes a tight PNG
(default `screenshots/`). A visual **issue** carries a screenshot of the wrong
state; a visual **fix PR** carries a **before/after** pair (the implementer
provides both). See `docs/TICKET_WORKFLOW.md` → **Visual verification**.

**PR screenshots are debug-free.** The overlay paints *over* the board — the
reservation tint and the cyan/amber driving-lines cover lane paint, terrain and
depot art, so a debug shot can make a real change look like it did nothing. The
helper therefore reads the stage's toggle and turns it **off** before shooting,
whatever the app's state; `gameConfig.debug` itself is already `false` by default
and is not persisted, so `/#/play?…` route shots are debug-free anyway. Add
`--debug` only when the overlay *is* the subject (routing, lane centrelines,
where a vehicle actually drives) — and say so in the PR, so the reviewer knows
why the picture is painted over. Before/after must use the **same** flags.

**Finish by handing back the links.** The last thing every task says is WHERE to
look, so the reader never has to hunt for the right page. List every page the
change touches — the `/test/<id>` scenario for the mechanic in isolation, and the
`/#/play?…` board when a mode or level is involved.

Post them as **markdown links**, one per line, each with a few words on what to
watch for:

- [Fares by distance](http://localhost:5173/#/test/faredistance) — $470 vs $680, the short one floors first
- [Lake Valley opening](http://localhost:5173/#/play?mode=tycoon&board=lakevalley-open) — the same pricing in a real run

NOT inside a fenced code block: a fence renders as plain text, so the reader
still has to copy-paste. Fences are for shell commands, links are for pages.
Check the dev server's live port first — usually 5173, but `npm run dev` picks
another when it is taken.

A screenshot proves what you saw; a link lets the reader see it for themselves.
Both, every time — a change nobody can reach in one click is not handed over.

**IN A CLOUD SESSION THERE IS NO LOCALHOST FOR THE READER.** The rule above
assumes the dev server is on the same machine as the person reading. When the
session runs in a remote container (Claude Code on the web, a GitHub Action),
`npm run dev` is listening in that container and dies with it — a
`http://localhost:5173/…` link handed back in CHAT points at the user's own
machine, where nothing is running. Hand back the **deployed preview** instead
(`https://cyclodex.github.io/train-game/pr-preview/pr-<N>/…`, or the master
deploy for work already merged), and say which board or scenario to open. The
localhost convention still applies to the PR BODY, which is rewritten — see
below.

**In a PR body, write localhost anyway.** A reviewer has no dev server, but you
do not have to translate: once the PR preview is deployed, `deploy.yml` rewrites
every `http://localhost:<port>/…` in the **body** to
`https://cyclodex.github.io/train-game/pr-preview/pr-<N>/…` — same paths, same
hash routes, now clickable. It runs on every push to the PR, so links you add
later are rewritten too. Comments are left alone (editing someone's posted words
reads worse than a stale link), so paste preview URLs there yourself.


## Ticket ownership (don't double-build)

`status: ready-for-dev` is the **automated implement pipeline's** queue: an issue
moved there gets auto-branched (`claude/issue-<N>-…`) and a PR opened. So, before
implementing **any** issue:

- **Check first.** Look for an existing `claude/issue-<N>-…` branch or an open PR
  that closes the issue. If one exists, the pipeline already owns it — **review
  that PR, don't build a parallel one.** `in-progress`/`in-review` = already taken.
- **Claim before you build.** If you (a session) are going to implement a ticket
  yourself, set it `status: in-progress` first and **leave it out of
  `ready-for-dev`** — never set a ticket to `ready-for-dev` *and* build it
  yourself, or the pipeline picks it up in parallel (this is the double-work trap).

Full rules: `docs/TICKET_WORKFLOW.md` → **Stages & labels** / **Ownership**.
