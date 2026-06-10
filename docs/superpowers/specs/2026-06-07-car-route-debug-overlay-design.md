# Car route debug overlay — design

**Date:** 2026-06-07
**Status:** approved

## Goal

In debug mode, let the player inspect where any given car is going: hover a car
to preview its full route as a highlighted line from its current position to the
map-edge opening it is heading for; click to pin that route so it persists as the
car drives. Click the same car again (or empty space) to unpin.

This is the road counterpart to the existing per-car **destination marker**
(`carDestinations` in `game.ts`): the marker says *where*, this overlay says *how
it gets there*.

## Why it is possible

A car's route is already fully determined at spawn. `planRoute`
(`src/sim/roadRouter.ts`) runs a BFS from the entry to a randomly chosen
destination and stores on the car:

- `routePlan: RouteTurn[]` — the exit arm taken at each junction along the path,
- `destination: RoadEntry | null` — the off-map opening it is driving to.

The full tile-by-tile path is not stored (only the head segment plus the next are
kept in `car.path`), but it is **deterministic** and can be replayed forward from
the car's current head by following `routePlan` at junctions and the single
straight/curve exit elsewhere.

## Scope

- **One car at a time.** With up to ~40 live cars, drawing every route at once is
  unreadable. Only the hovered/pinned car's route is shown.
- **Hover preview + click to pin.** Cars move, so a hovered sprite drives out from
  under the cursor; pinning keeps the route up while the car drives.
- **Debug mode only.** Gated behind the existing `config.debug` toggle, alongside
  the other debug overlays (coords, reservations, destination markers).
- **Centreline geometry.** The line follows tile centrelines (the exact "which
  tiles + which turns" path). Future lane offsets are *not* predicted: lane
  changes are decided reactively each tick, so a lane-accurate future line would
  be a guess, whereas the centreline route is exact.

## Architecture

### 1. Simulation (`src/sim/road.ts`)

Add one read-only method to the `RoadSim` interface:

```ts
// The remaining route of the live car `carId`, as the ordered tile segments from
// its current head tile to the map edge it is heading for. [] if no such car.
routePath(carId: string): RoadSegment[];
```

Implementation walks forward from the car's current head segment:

- at each tile, take the junction turn from `routePlan` (via the existing
  `carExitAt`) or, for a straight/curve, the single car exit (`roadTraverse`);
- collect `{ coord, entryPort, exitPort }` per tile;
- stop when the move runs off the map (the destination) or a tile has no
  continuing car road.

Guarded by a visited-`(coord, entryPort)` set and a max-steps cap
(`width * height + 1`) so a malformed map can never loop forever. Pure and
deterministic — unit-testable directly.

### 2. Controller (`src/game.ts`)

- Reactive `routeCarId: string | null` — the **pinned** car id, falling back to
  the **hovered** id when nothing is pinned. New methods: `setHoveredCar(id)`,
  `clearHoveredCar()`, `togglePinnedCar(id)`, `clearRouteCar()`.
- Each frame, when `config.debug` and a car is active, call
  `roadSim.routePath(activeId)`, convert each segment to a tile-local
  `segmentPathD(entryPort, exitPort, tileSize)` translated by the tile origin
  `(coord.x * tileSize, coord.y * tileSize)`, and expose a reactive
  `carRoute: { segments: string[]; color: string } | null`.
- The active car's colour comes from the existing `carColor(id)` so the line
  matches the car. If the active car has despawned (no segments), `carRoute` is
  `null` and the pinned id is cleared.

### 3. View

- New global component `src/components/CarRouteOverlay.vue`: an absolutely-
  positioned, full-size SVG (same placement pattern as `DebugShowRoutes.vue`),
  rendering one `<path>` per route segment with an arrowhead marker on the last.
  Props: `segments: string[]`, `color: string`.
- Rendered inside the level grid in both `src/views/PlayView.vue` and
  `src/views/TestStage.vue`, shown only when `config.debug` and `carRoute` is set.
- The `.road-car` divs gain `@mouseenter` / `@mouseleave` / `@click` handlers
  (stripping the `#unit` suffix off the rendered id to get the base car id). The
  handlers no-op unless `config.debug` is on; click toggles the pin.

### 4. Feature test world (required)

- `src/levels/test/scenarios/carroute.ts`: a small map with a road junction so a
  single car's pinned route visibly bends. Registered in
  `src/levels/test/index.ts`. The existing `testScenarios.spec.ts` validates the
  map automatically.

## Testing

- **Unit (`tests/unit/sim/roadRoutePath.spec.ts`):** build a small level + sim,
  step until a car exists, assert `routePath(id)` is non-empty, starts at the
  car's head tile, and its final segment exits at the car's `destination`.
- **Build:** `npm run build` (vue-tsc + vite) for type correctness.
- **Manual:** `/test/carroute` with debug on — hover/click the car, confirm the
  route lights up, bends at the junction, and persists while driving.

## Out of scope

- Showing multiple cars' routes at once.
- Lane-accurate future geometry (predicting lane changes).
- Any non-debug, player-facing use.
