# Improvement backlog

A prioritised, actionable list of ways to move the train game forward. Ordered
roughly by value-for-effort. Each item notes the rough approach and the main
files involved.

> **Wider brainstorm:** for a broader (less filtered) exploration of future
> directions — objectives & game modes, terrain (tunnels, bridges, level
> crossings, stations, obstacles), trains/cargo/economy, atmosphere, advanced
> signaling, and the open design questions — see [`docs/brainstorm/`](docs/brainstorm/README.md).
> Start at [`docs/brainstorm/99-open-questions.md`](docs/brainstorm/99-open-questions.md).

## Recently landed (the model/view refactor)

The architecture was rebuilt around an authoritative, deterministic simulation
(`src/sim/*`) rendered by a `requestAnimationFrame` loop (`src/game.ts`):

- **Collisions** can't happen — a train never enters an occupied tile.
- **Trains never move on a red signal** — gated centrally each tick (unit + e2e).
- Game logic is **headless and unit-tested**; the renderer just draws it.
- A **delivery counter** scores matching-colour depot arrivals.

The dead imperative `$refs` movement code has been removed from the tile
components — they are now pure views (draw + publish their rotation/switch state).

**Signaling & path reservation (Phase 1) is implemented** — block/route
reservation (interlocking), always-visible directional red/green signals, and a
manual hold. See `docs/signaling-design.md`. Deferred there: pre-signals / yellow
aspects + speed signals (Phase 2), path-based signaling and deadlock resolution
(Phase 3).

**Train momentum (accel/braking) is implemented** — trains carry a velocity,
accelerate away from a stop, and brake with look-ahead so they coast to rest at
the next stop line; heavier/freight trains ramp more gently. This was the missing
Phase-2 prerequisite for yellow/pre-signal aspects. See
`docs/superpowers/specs/2026-06-04-train-momentum-design.md` and `src/sim/physics.ts`.

Remaining from the list below: deadlock resolution (#3), level loading (#6). Minor
polish: wagon spacing is measured in tile-fractions, so couplings look slightly
tighter on curves than on straights — making it pixel-uniform is a nice-to-have.

## How the game plays today

- A 7×6 grid of track tiles is hardcoded in `App.vue`. Two trains (`train1`
  people, `train2` fraight) leave their depots and pathfind toward a destination
  depot, obeying **automatic traffic lights** (a tile reserves the route ahead and
  only goes green when it is free) and **switchable intersections**.
- Click a tile to rotate it, click a traffic light to toggle it (ctrl-click to
  force green), click an intersection switch to change its route, click a train to
  start/stop it. Top-left buttons toggle debug overlay, pause/play, and game speed
  (1×/2×/4×).
- Each train and depot gets a **random colour**. Arriving at a same-colour depot
  is a "successful delivery" — but today that only logs to the console; a
  mismatched depot bounces the train back out.

The biggest gap: there is **no objective loop** — nothing is scored, nothing is
won or lost, and most "matching" is luck because colours are random.

## Gameplay

1. **Score / objective loop** (high value). Count successful same-colour
   deliveries, show a score + delivery counter in the UI, and add a round timer.
   The delivery hook already exists in `TileDepot.trainInDepot`; emit an event up
   to `App` instead of `console.log` and render a HUD. Pairs naturally with
   designing (not randomising) train/depot colours so deliveries are solvable.
2. **Win / lose + start screen**. A start screen, a win state when all trains are
   delivered, and a lose state on crash or timeout. Needs a small game-state
   machine in `App.vue` (or a tiny store).
3. **Collision / crash detection**. Two trains occupying the same tile should
   crash and trigger game-over. The tile already tracks `TileStatus`
   (Free/Reserved/Blocked) and which train entered — extend `incomingTrain` to
   detect a second occupant. This also fixes the current **deadlock**: two trains
   can sit forever at red lights waiting on each other.
4. **More trains / scenarios**. `App.vue` has `train3`/`train4` commented out and
   a six-wagon train ready to enable; turn these into selectable difficulty
   levels once the objective loop exists.
5. **Polish**. Sound effects (depart, brake, deliver, crash), nicer depot/arrival
   feedback (replace the removed `alert`), smoother stop-in-depot easing (see the
   `stopTrainInDepot` duration heuristic in `Train.vue`).

## Road traffic

14. **Variable car speeds with car-following** (idea). Today road cars share one
    speed and queue at the stop line. Give each car its own preferred (cruise)
    speed, then have it follow the car ahead: a car can never exceed the speed of
    the slower car in front, so it closes the gap and matches its pace (a simple
    car-following / "platoon" rule, like real traffic). Faster cars bunch up behind
    slower ones; the slowest car sets the platoon speed.
    - *Later extension:* per-road speed limits — different "speeding tracks" where
      cars are allowed to go faster or slower (e.g. slow zones in the city, faster
      open stretches). The car's effective speed becomes `min(its preferred speed,
      the road's limit, the speed of the car ahead)`.
    - Touch points: the road-car movement / queue-spacing logic added in the recent
      road-car commits (add a look-ahead to the car ahead, mirroring the train
      momentum look-ahead in `src/sim/physics.ts`), plus a per-tile/per-road
      speed-limit field if the limit extension is taken. Ships with its own `/test`
      scenario (two cars at different preferred speeds on one lane → the fast one
      catches and follows the slow one).

## Architecture / code health

6. **Level loading from JSON** (enables everything above). Move the `level` and
   `trains` literals out of `App.vue` into JSON/TS level files and load by id.
   Unlocks multiple levels and a level editor. The `LevelDefinition` /
   `TrainsDefinition` types in `types.ts` already describe the shape.
7. **Type the loose `any`s**. Pathfinding (`Train.checkRoutesOnNextTile`),
   `CheckedRoutes*`, and several tile methods use `any`. Now that the project is
   on TS 5 + strict, tightening these would catch real routing bugs — ideally
   behind unit tests for the pathfinder first.
8. **Unit-test the pathfinder**. `checkRoutesOnNextTile` (recursive multi-path
   search) and the intersection route tables have zero coverage. Extract the pure
   routing logic from the Vue component so it can be tested without a DOM.
9. **Replace imperative `$refs` traversal**. The train/tile choreography reaches
   into sibling components via `this.$parent.$refs[...]`. A small event bus or a
   provided registry would decouple this and remove the `resolveRef` shim.
10. **Sass `@use` migration**. Stylesheets still use `@import` (deprecation is
    silenced in `vite.config.ts`); migrate `scss/global/*` to the module system.
11. **ESLint flat config**. The repo is on ESLint 9; add a flat `eslint.config.js`
    (Vue + TS + Prettier) so `npm run lint` runs.
12. **Fix the "fraight" typo** in one sweep (type strings + asset names), or leave
    it — but do it all at once, never piecemeal.
13. **Longer term**: migrate the class components to `<script setup>` +
    composables now that a Vitest/Playwright safety net exists. This removes the
    `vue-facing-decorator` inheritance machinery but is a large, careful refactor.
