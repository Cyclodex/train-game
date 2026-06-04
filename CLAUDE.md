# CLAUDE.md

Guidance for working in this repository.

## What this is

A browser-based **train simulation game** built with **Vue 2.7 + TypeScript**. A
grid of track tiles (straights, curves, intersections, depots) is laid out, and
trains made of a locomotive plus wagons pathfind from depot to depot, obeying
traffic lights and switchable intersection routes. Movement is animated with
**GSAP** (MotionPathPlugin) along SVG paths defined per tile.

It started life as the Emergency Room team's `vue-base` starter (see README), so
some scaffolding remains (the `counterExample` Vuex module, `HelloWorld.vue`).
These are not part of the game and can be ignored or removed.

## Tech stack

- Vue 2.7 (class components via `vue-property-decorator`)
- TypeScript ~3.9
- Vuex 3 (currently near-empty; game state lives in `App.vue`, not the store)
- GSAP 3 for animation
- vue-cli 4 / webpack 4 build, Jest for unit tests, ESLint + Prettier

## Dev commands

```
npm install            # or: npm ci
npm run serve          # dev server at http://localhost:8080
npm run build          # production build -> dist/
npm run test:unit      # jest
npm run lint           # eslint --fix
```

**Node version note:** on Node 17+ the old webpack 4 toolchain needs the legacy
OpenSSL provider. The `serve`, `build`, and `test:unit` scripts already wrap the
command with `cross-env NODE_OPTIONS=--openssl-legacy-provider`, so they work out
of the box on modern Node (verified on Node 22). If you ever run
`vue-cli-service` directly, set that env var yourself.

## Architecture

Game state is held reactively in `src/App.vue` and pushed to children via
`@ProvideReactive()`:

- `level: LevelDefinition` — a map keyed by `"x,y"` describing every tile
  (component name, rotation, traffic lights, intersection active/disabled routes).
- `trains: TrainsDefinition` — each train's position, type (`people` | `fraight`
  [sic]), wagons, and `routeDestinations`.

Global config lives in `src/main.ts` on the root Vue `data`: `tileSize` (200px),
`levelSizeX` (7), `debug`, `automaticTrafficLights`, `automaticRoutePlanning`,
`railDistanceFromPath`. Toggle `debug` in the UI to see per-tile coordinates and
route overlays.

Key files:

- `src/App.vue` — level + train definitions, pause/play, speed control (1x/2x/4x
  via `gsap.globalTimeline.timeScale`), main layout.
- `src/components/Tile*.vue` — one component per tile kind. `TileBase.vue` is the
  shared base; `TileIntersectionComplete.vue` is the full intersection logic.
- `src/components/Train.vue` — train rendering and GSAP motion along tile paths.
- `src/types.ts` — all enums/interfaces (TrainStatus, TrafficLight, Position,
  Route, Rotations, etc.). Read this first to understand the domain.
- `src/utils/tileHelpers.ts`, `trainHelpers.ts`, `globalHelpers.ts` — coordinate
  math, direction/position conversions, color list.

Coordinate system: `x` increases right, `y` increases down. `Position`
(Top/Right/Bottom/Left/Center) and `TrainDirection` (U/R/D/L/N) are converted via
the helpers — note the entrance position is the opposite side of the direction of
travel.

## Conventions / gotchas

- "fraight" is the spelling used throughout for "freight" (type strings, asset
  names). Match existing spelling when touching that code rather than fixing it
  piecemeal, or do a complete rename in one pass.
- Lint runs Prettier; there are ~140 pre-existing Prettier warnings (mostly
  indentation in switch statements). Don't let a large auto-fix diff bury real
  changes — fix files you touch.
- The Vuex store is essentially unused for game logic; state is component-local in
  `App.vue`. If state grows, consider moving it into Vuex.
- `/dist` and `/node_modules` are gitignored.

## Ideas for improvement (project goal: iterate on the game)

- Add a score/objective loop (deliver trains, count successful arrivals, timer).
- Level loading from JSON instead of hardcoding `level`/`trains` in `App.vue`;
  enables multiple levels and a level editor.
- Collision/crash detection and game-over state.
- Sound effects and UI polish; a start screen.
- Unit tests for the pathfinding and tile-helper math (currently only the sample
  spec exists).
- Longer term: migrate to Vue 3 + Vite + TypeScript 5 (large, breaking — do as a
  dedicated effort with the test suite as a safety net).

## Verifying changes

Build is the fastest correctness check (`npm run build`). For visual checks, the
production build can be opened from `dist/` or run via `npm run serve`. There is a
headless render path: a real Chrome can load the built `dist/index.html` and the
game renders 40 tiles + trains with no console errors — use that as a smoke test.
