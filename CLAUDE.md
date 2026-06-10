# CLAUDE.md

Guidance for working in this repository.

## What this is

A browser-based **train simulation game** built with **Vue 3 + TypeScript**. A
grid of track tiles (straights, curves, intersections, depots) is laid out, and
trains made of a locomotive plus wagons travel from depot to depot, obeying
traffic signals and switchable intersection routes. A deterministic simulation
moves the trains; the renderer draws each loco/wagon at its sampled point along
the per-tile SVG path.

It started life as the Emergency Room team's `vue-base` starter (see README).
The starter scaffolding (the `counterExample` Vuex module, `HelloWorld.vue`, the
unused `TileIntersection.vue` variant) has been removed.

## Tech stack

- Vue 3.5, class components via **`vue-facing-decorator`** (the maintained Vue 3
  successor to `vue-property-decorator`).
- **`vue-router`** (hash history) with two routes: `/play` (the game) and
  `/editor` (the level editor).
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
npm run test:unit      # vitest run
npm run test:e2e       # playwright (needs: npx playwright install chromium once)
npm run lint           # eslint --fix
```

No `--openssl-legacy-provider` is needed any more; the legacy webpack toolchain
is gone. `.npmrc` sets `ignore-scripts=true`, so Playwright's browser binary is
not auto-downloaded — run `npx playwright install chromium` once before
`npm run test:e2e`.

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
  `setDepot`/`rotateDepot`, `toggleSignalPort`) used by the editor.
- `validate.ts` — `validateLevel()`: connectivity / dangling-track / reachable
  depots / per-train route checks.
- `generate.ts` — `generateLevel(seed, opts)`: seeded procedural levels (a track
  loop + depot spurs), gated by `validateLevel`.

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
- `pathGeometry.ts` — `segmentPathD()`: the SVG path a train follows across a
  tile, derived purely from its entry+exit ports.

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
(200px), `levelSizeX` (7), `debug`, `automaticTrafficLights`,
`automaticRoutePlanning`, `railDistanceFromPath`. Toggle `debug` in the UI to see
per-tile coordinates and route overlays.

Key files:

- `src/main.ts` — `createApp`, provides `gameConfig`, registers `Tile`/`TileRail`/
  `Train`/`DebugShowRoutes` globally, installs the router.
- `src/router.ts` — `/play` (PlayView) + `/editor` (EditorView), hash history.
- `src/App.vue` — thin shell: `<router-view>`.
- `src/views/PlayView.vue` — level + train definitions, creates/provides the game,
  pause/play and speed (1x/2x/4x scale the loop's `dt`), delivery count, layout.
- `src/views/EditorView.vue` — connect/depot/signal/erase tools. Connect draws
  rail connections explicitly (drag edge dot → edge dot; click a rail to delete);
  signals are per-direction (click a port). Live validation, random-map button,
  export/import, "Play this" hand-off.
- `src/game.ts` — the `createGame()` controller + rAF render loop (see above).
- `src/sim/*` — the headless simulation (see the Simulation section).
- `src/tiles/*` — the data-driven tile model (see the Tile model section).
- `src/components/Tile.vue` — the single data-driven tile view (rails, signals,
  switches, depot), replacing the old per-kind components.
- `src/components/Train.vue` — pure loco/wagon sprite renderer (positioned by the
  game loop).
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
isolated maps — **one per game mechanic** — with a picker, deep-linkable at
`/test/:id`. It's both the manual-QA gallery and a debugging aid: a feature in
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
- `src/levels/test/index.ts` — the `SCENARIOS` registry (picker order).
- `src/views/TestView.vue` (picker) + `src/views/TestStage.vue` (keyed per
  scenario; creates/provides a fresh `markRaw` game and sizes the grid to the
  map). `createGame`'s optional 5th arg `colors?: ColorAssignment` pins
  depot/train colours when a scenario needs a determined outcome (e.g. a
  depot-mismatch bounce).

**To add a feature's scenario:** keep it as small as the mechanic allows (a
single lane for simple features; a 2D pocket with two trains for contention
features like signals/crossing, which only *mean* something when trains compete).
Add one `scenarios/<feature>.ts` and one line in `index.ts`. The unit test
`tests/unit/levels/testScenarios.spec.ts` iterates the registry and validates
every map (connectivity, route reachability, trains-in-depots, grid fit), so a
broken scenario fails CI. Design notes:
`docs/superpowers/specs/2026-06-06-feature-test-world-design.md`.

## Ideas for improvement (project goal: iterate on the game)

See `IMPROVEMENTS.md` for the prioritised backlog.

## Verifying changes

`npm run build` (vue-tsc + vite) is the fastest correctness check, and
`npm run test:unit` covers the coordinate math. For behaviour, `npm run test:e2e`
boots a real browser and asserts the level renders 40 tiles + 2 trains, the
trains physically leave their depots, and there are no console errors. For visual
work, `npm run dev` and open http://localhost:5173 (debug overlay is on by
default). When you add a feature, verify it in its `/test/:id` scenario (see
**Feature test world** above) — that is the required check that the mechanic
works in isolation.
