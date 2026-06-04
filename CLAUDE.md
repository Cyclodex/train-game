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
  successor to `vue-property-decorator`; supports class inheritance, which the
  tile hierarchy relies on).
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

### Simulation (`src/sim/`)

- `topology.ts` — pure tile graph: exit port per tile kind/rotation/switch,
  neighbour math.
- `network.ts` — `traverse()`: from a tile + entry port, the exit port and the
  next tile/entry.
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
  segment path). `App.vue` creates/provides it (`markRaw` — never proxy the sim).
- Components are views: `Train.vue` is a pure sprite renderer; tiles draw rails,
  rotation, switches, signals and publish their live rotation/switch state into
  the game so the sim routes accordingly. Traffic signals are a manual tool
  (default green); collisions are handled by the occupancy gate, not signals.

Game state still seeded in `src/App.vue` via `@Provide()` / `@Inject()`:

- `level: LevelDefinition` — a map keyed by `"x,y"` describing every tile
  (component name, rotation, traffic lights, intersection active/disabled routes).
- `trains: TrainsDefinition` — each train's starting depot, type (`people` |
  `fraight` [sic]), and wagons (the simulation owns live position).

Global config is a reactive object in `src/gameConfig.ts`, provided once at the
app level in `src/main.ts` and injected into components as `config`: `tileSize`
(200px), `levelSizeX` (7), `debug`, `automaticTrafficLights`,
`automaticRoutePlanning`, `railDistanceFromPath`. Toggle `debug` in the UI to see
per-tile coordinates and route overlays.

Key files:

- `src/main.ts` — `createApp`, provides `gameConfig`, registers the tile/train
  components globally.
- `src/App.vue` — level + train definitions, creates/provides the game, pause/play
  and speed (1x/2x/4x scale the loop's `dt`), delivery count, main layout.
- `src/game.ts` — the `createGame()` controller + rAF render loop (see above).
- `src/sim/*` — the headless simulation (see the Simulation section).
- `src/components/TileBase.ts` — the shared base **class** (a plain `.ts`, never
  rendered: every concrete tile provides its own `<template>`). Concrete tiles
  inherit from it: `TileStraight` → `TileDepot`, plus `TileCurve` and
  `TileIntersectionComplete` (the full intersection logic).
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

- Concrete components export `export default toNative(TheClass)`. A class that is
  **extended** (e.g. `TileStraight`) also exports the raw class as a named export
  for its subclass to `extends`; `TileBase` is a plain `.ts` class (a Vue SFC
  default export is wrapped into an options object and cannot be `extends`-ed).
- Reactive state mutates in place (Vue 3 deep proxies) — no `Vue.set`.
- **Plain controllers/DOM objects must be `markRaw()`-ed** before being stored in
  reactive state. The `game` object (which holds the simulation and its refs) is
  provided with `markRaw` so Vue does not deep-proxy the sim or auto-unwrap its
  refs. This is the same hazard that broke the old GSAP timeline (a reactive
  Proxy breaks identity-based scheduling — a train would leave its depot once and
  then never advance).
- Tiles are pure views: they draw rails/rotation/switches/signals, handle clicks
  (rotate, toggle switch/signal), and publish their live rotation/switch state
  into the game so the simulation routes through it. No cross-component `$refs`
  or movement logic lives in them any more.
- Lifecycle hooks merge across the inheritance chain (base `created` runs before
  the subclass), same as Vue 2's mixin merge — several tiles rely on this.

## Conventions / gotchas

- "fraight" is the spelling used throughout for "freight" (type strings, asset
  names). Match existing spelling when touching that code rather than fixing it
  piecemeal, or do a complete rename in one pass.
- Stylesheets still use Sass `@import` (deprecation silenced in `vite.config.ts`);
  migrating to `@use` is a tidy follow-up.
- `/dist`, `/node_modules`, and test artifacts are gitignored.

## Ideas for improvement (project goal: iterate on the game)

See `IMPROVEMENTS.md` for the prioritised backlog.

## Verifying changes

`npm run build` (vue-tsc + vite) is the fastest correctness check, and
`npm run test:unit` covers the coordinate math. For behaviour, `npm run test:e2e`
boots a real browser and asserts the level renders 40 tiles + 2 trains, the
trains physically leave their depots, and there are no console errors. For visual
work, `npm run dev` and open http://localhost:5173 (debug overlay is on by
default).
