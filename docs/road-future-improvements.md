# Road layer — possibilities & future improvements

A companion to `docs/road-network-progress.md`. The road traffic model (directed lanes, multi-lane roads, junction turn rules, vehicle classes, lane changing, traffic signals, and level crossings) is functionally complete. The next step is to turn that simulation into *gameplay* and to give it a world to exist in.

---

## Where the road layer stands today

### Already built

- **Directed lane model** — `Lane { from, to[], index, kind? }` in `src/tiles/lanes.ts`.
- **Multi-lane roads** — 1–3 lanes, lane drops, merge gores, bus lanes.
- **Junction turn rules** — right-turn-only, no-left-turn, dedicated turn pockets.
- **Vehicle classes** — cars, trucks, semis, buses; bus-only lanes enforced.
- **Lane-aware routing** — cars pre-sort into turn lanes and reroute on missed turns.
- **Lane changing / overtaking** — continuous lateral position, gap acceptance, same-direction passing.
- **Traffic signals** — two-phase, round-robin, bus priority, amber/green/red per arm.
- **Level crossings** — road stops when rail reserves or occupies the tile.
- **Car-following** — per-car cruise speed, accel/brake ramp, reaction delays.
- **Debug overlay + test world** — `roadoneway`, `roadjunction`, `turnlanes`, `buslane`, `roadpriority`, and others.

Key files:

- `src/sim/road.ts` — the road simulation core.
- `src/sim/roadRouter.ts`, `src/sim/roadJunction.ts`, `src/sim/roadArbiter.ts`, `src/sim/junctionSignal.ts`, `src/sim/laneOffset.ts`.
- `src/tiles/lanes.ts`, `src/tiles/roadGeometry.ts` — model + render geometry.
- `src/components/Tile.vue`, `src/components/Crossing.vue` — rendering.
- `src/gameConfig.ts` — `roads`, `roadScoring`, `maxCars` toggles/slider.
- `src/sim/objectives.ts` — `maxCarWaitSec`, `carsDelivered`, `crossingIncidents` counters.

### How it is used right now

Only **Crossing Keeper** (`src/modes/crossing-keeper.ts`) treats the road layer as a scoring mechanic. The other modes (Puzzle, Time Attack, Daily, Sandbox) render roads but do not win/lose on road state. `roadScoring` exists but is mostly unexercised.

The road layer has stopped being the bottleneck; the bottleneck is now turning it into a game.

---

## 1. Road-first game modes (highest value)

These use the existing simulation almost unchanged. The work is mostly mode authoring, HUD wiring, and a `/test` scenario per mode.

### 1.1 Traffic Manager / “Keep the city flowing”

A mode where the road network itself is the puzzle. Win by moving a target number of cars through the map within a time limit, without letting any car wait too long at a crossing or junction.

- Builds on `RoadSim.frame()` (`maxCarWaitSec`, `carsDelivered`).
- Builds on `ObjectiveSpec` (`timeLimitSec`, `fail.maxCarWaitSec`, star predicates).
- Needs a new `src/modes/traffic-manager.ts` and a small road-network test scenario.
- **Effort: M. Risk: low.**

### 1.2 Managed crossing (hardcore Crossing Keeper)

The player manually operates the level-crossing gates. A single car caught on the crossing when a train arrives fails the level.

- `ObjectiveSpec.fail.onCrossingIncident` already exists.
- Needs a real manual gate control in `src/game.ts` + `Crossing.vue` visual feedback.
- Needs a `/test` scenario with one heavy-traffic crossing.
- **Effort: M.**

### 1.3 Signal-network puzzle

The player cycles road-junction traffic signals to minimize total car wait time. The road signal controllers (`cycleSignal`, `signalAspect`) already exist.

- Needs a scoring formula and level format that authors signalized junctions.
- **Effort: M–L.**

---

## 2. Stations, cargo & the living network

The road layer becomes far more meaningful once trains serve stations instead of only depot→depot colour-matching.

### 2.1 Stations as through-track stops

A station tile with a queue of waiting passengers/cargo. Trains dwell, load matching units, and depart.

- Unlocks typed cargo (replacing random colour matching).
- Unlocks Endless / management mode with rising demand.
- Lets road traffic feed stations (cars → passengers, trucks → freight).
- Needs a `station` role on `TileCell`, `TrainStatus.Dwelling`, boarding logic, and platform render.
- See `docs/brainstorm/02-terrain-and-tile-types.md` §2.4 and `docs/brainstorm/03-trains-cargo-economy.md` §3.4.
- **Effort: L. Impact: highest.**

### 2.2 Cargo trucks on the road

Trucks and semis spawn off-map, drive to stations, and deliver/pick up cargo. This couples the road and rail economies.

- Reuses `roadRouter.ts`, `roadEntries`, `roadExits`, and existing vehicle classes.
- Needs stations first (§2.1) and a “delivery” concept for road vehicles.
- **Effort: M–L (blocked by stations).**

---

## 3. World / terrain features

Roads currently drive on a flat green grid. Terrain gives roads a reason to exist and creates natural puzzles.

### 3.1 Obstacles & bridges

- Forest/water/rock tiles that block plain track and plain road.
- Bridges as a `bridge` role with two independent port-pairs, letting a road cross rail *without* a level crossing.
- The data-driven connection model already supports two non-interacting pairs on one cell.
- See `docs/brainstorm/02-terrain-and-tile-types.md` §§2.2, 2.7.
- **Effort: M. Cleanest terrain slice.**

### 3.2 Tunnels / grade separation

Road tunnels under rail or under other roads let the player separate conflicting streams.

- Needs a new road role + routing rule + render.
- **Effort: M–L.**

---

## 4. Smaller traffic-realism improvements

Polish items. Worth doing only after the gameplay loop exists.

### 4.1 Oncoming-lane overtaking

Passing on 1-lane-each-way roads with distance/speed feasibility + abort. Same-direction overtaking is already implemented; oncoming passing is still TODO. See `docs/superpowers/specs/2026-06-07-overtaking-driver-behaviour-design.md` §3b.

### 4.2 Per-road speed limits

Per-tile speed caps. Cars already have `speed` and `cornerCap`; adding a road-level cap is small. See `IMPROVEMENTS.md` §14.

### 4.3 Driver profiles

Aggressive/cautious, lane-hogging, truck-slowdown variance. Adds life but is low priority.

### 4.4 Per-lane route cost planner

Today routes are tile sequences with lane sorting on approach. A true `(tile, lane)` cost planner would handle dense turn-lane networks more robustly. Optimization, not a blocker.

---

## 5. Code-health improvements that unlock future work

| Item | Why it matters | Files |
|---|---|---|
| Migrate Sass `@import` → `@use` | Silenced deprecation will eventually break | `src/scss/global/*`, `vite.config.ts` |
| Add ESLint flat config | `npm run lint` should run cleanly on ESLint 9 | add `eslint.config.js` |
| Type the loose `any`s in routing | Catches real bugs as the sim grows | `src/sim/*`, `src/tiles/*` |
| Fix “fraight” typo in one pass | Per `CLAUDE.md`: do it all at once or never | type strings + asset names |
| Longer-term: `<script setup>` migration | Removes `vue-facing-decorator` dependency | all `.vue` components |

---

## Recommended priority order

1. **Traffic Manager mode** — lowest risk, highest immediate value. Uses existing sim code; just needs a mode file, a scenario, and HUD wiring.
2. **Stations prototype** — biggest design unlock. A single through-track station with dwell/load behaviour opens cargo and Endless mode.
3. **Obstacles + bridges mini-world** — gives roads and rails a place to be; validates the data-driven model for campaign content.
4. **Managed-crossing hardcore variant** — small, high “wow,” builds directly on Crossing Keeper.
5. **Oncoming-lane overtaking + per-road speed limits** — traffic realism polish once the loop exists.

The road simulation is ready. The next move is to make it a game.
