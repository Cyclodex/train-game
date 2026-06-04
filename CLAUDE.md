# CLAUDE.md

Guidance for working in this repository.

## What this is

A browser-based **train simulation game** built with **Vue 3 + TypeScript**. A
grid of track tiles (straights, curves, intersections, depots) is laid out, and
trains made of a locomotive plus wagons pathfind from depot to depot, obeying
traffic lights and switchable intersection routes. Movement is animated with
**GSAP** (MotionPathPlugin) along SVG paths defined per tile.

It started life as the Emergency Room team's `vue-base` starter (see README).
The starter scaffolding (the `counterExample` Vuex module, `HelloWorld.vue`, the
unused `TileIntersection.vue` variant) has been removed.

## Tech stack

- Vue 3.5, class components via **`vue-facing-decorator`** (the maintained Vue 3
  successor to `vue-property-decorator`; supports class inheritance, which the
  tile hierarchy relies on).
- TypeScript 5.
- GSAP 3 for animation.
- **Vite 6** build, **Vitest** for unit tests, **Playwright** for e2e, ESLint +
  Prettier. There is no Vuex — game state lives in `App.vue` and a small provided
  `gameConfig`.

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

Game state is held reactively in `src/App.vue` and pushed to children via
`@Provide()` / `@Inject()`:

- `level: LevelDefinition` — a map keyed by `"x,y"` describing every tile
  (component name, rotation, traffic lights, intersection active/disabled routes).
- `trains: TrainsDefinition` — each train's position, type (`people` | `fraight`
  [sic]), wagons, and `routeDestinations`.

Global config is a reactive object in `src/gameConfig.ts`, provided once at the
app level in `src/main.ts` and injected into components as `config`: `tileSize`
(200px), `levelSizeX` (7), `debug`, `automaticTrafficLights`,
`automaticRoutePlanning`, `railDistanceFromPath`. Toggle `debug` in the UI to see
per-tile coordinates and route overlays.

Key files:

- `src/main.ts` — `createApp`, provides `gameConfig`, registers the tile/train
  components globally.
- `src/App.vue` — level + train definitions, pause/play, speed control (1x/2x/4x
  via `gsap.globalTimeline.timeScale`), main layout.
- `src/components/TileBase.ts` — the shared base **class** (a plain `.ts`, never
  rendered: every concrete tile provides its own `<template>`). Concrete tiles
  inherit from it: `TileStraight` → `TileDepot`, plus `TileCurve` and
  `TileIntersectionComplete` (the full intersection logic).
- `src/components/Train.vue` — train rendering and GSAP motion along tile paths.
- `src/types.ts` — all enums/interfaces (TrainStatus, TrafficLight, Position,
  Route, Rotations, etc.). Read this first to understand the domain.
- `src/utils/tileHelpers.ts`, `trainHelpers.ts`, `globalHelpers.ts` — coordinate
  math, direction/position conversions, colour list, `resolveRef`.

Coordinate system: `x` increases right, `y` increases down. `Position`
(Top/Right/Bottom/Left/Center) and `TrainDirection` (U/R/D/L/N) are converted via
the helpers — note the entrance position is the opposite side of the direction of
travel.

## Vue 3 / vue-facing-decorator conventions

- Concrete components export `export default toNative(TheClass)`. A class that is
  **extended** (e.g. `TileStraight`) also exports the raw class as a named export
  for its subclass to `extends`; `TileBase` is a plain `.ts` class (a Vue SFC
  default export is wrapped into an options object and cannot be `extends`-ed).
- Cross-component lookups go through `this.$parent.$refs[id]`. Vue 3 does not wrap
  unique `v-for` refs in arrays the way Vue 2 did, so every lookup is funnelled
  through `resolveRef()` (handles both shapes).
- Reactive state mutates in place (Vue 3 deep proxies) — no `Vue.set`.
- **GSAP objects and DOM nodes must be `markRaw()`-ed** before being stored in
  reactive state (e.g. `trainObject.animation`, `this.visual`, `wagon.visual` in
  `Train.vue`). Vue 3 otherwise wraps them in a Proxy, which breaks GSAP's
  identity-based ticker/`onComplete` scheduling — the classic symptom is a train
  animating out of its depot once and then never advancing.
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
