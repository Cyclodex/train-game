# Feature Test World — Design

Date: 2026-06-06

## Problem

The game boots into `DEFAULT_LEVEL`, a sprawling hand-authored map that mixes
every mechanic together. It's a poor harness for verifying a single feature: to
check signals you have to find the signal in a busy level and wait for the right
train to reach it. We want a focused, growing set of tiny maps — one per feature
— that each demonstrate exactly one mechanic at a glance, and that we extend as
new features land.

## Decision

A **scenario registry + picker**, surfaced on a new `/test` route. Each feature is
its own small, self-contained map in its own file. A dropdown (and `/test/:id`
deep link) switches between them. Simple features are a single horizontal lane;
contention features (signals, crossing intersection) get a small 2D pocket with
two trains, because interlocking only *means* something when two trains compete
for the same path.

Rejected alternatives:

- **One combined screen, one row per feature.** Great at-a-glance, but capped at
  ~6 rows and structurally unable to show two-train contention.
- **Editor panel.** Couples the harness to the editor for no benefit.

## Data contract

```ts
// src/levels/test/scenario.ts
import { Level } from "@/tiles/model";
import { TrainsDefinition } from "@/types";
import { ColorAssignment } from "@/utils/colorAssignment";

export interface TestScenario {
  id: string;          // url slug, e.g. "signals"
  name: string;        // "Signals & interlocking"
  description: string; // one line shown in the picker
  level: Level;
  trains: TrainsDefinition;
  // Optional: pin depot/train colours (e.g. to force a depot-mismatch bounce).
  // When omitted, createGame's seeded auto-assignment is used.
  colors?: ColorAssignment;
  // Optional explicit grid size; defaults to the level's derived extents.
  size?: { cols: number; rows: number };
}
```

A scenario is exactly what `createGame(level, trainDefs, tileSize, seed, colors?)`
needs, plus presentation metadata.

## File layout

```
src/levels/test/
  scenario.ts            // the TestScenario type
  index.ts               // export const SCENARIOS: TestScenario[]
  scenarios/
    straight.ts
    curve.ts
    depot.ts             // park-on-match + bounce-on-mismatch (pinned colours)
    signals.ts           // two trains contend; interlocking holds one back
    junction.ts          // t-junction switch routes a train down a branch
    cross.ts             // crossing intersection, two trains cross
    crossing.ts          // road level-crossing (Bahnübergang) with a car
```

Adding a feature = add one `scenarios/*.ts` and one line in `index.ts`. This is
the "improve it when we add features" workflow: **one file per feature.**

## View + routing

- New routes in `src/router.ts`: `/test` (first scenario) and `/test/:scenario`.
- New `src/views/TestView.vue`. It reuses the existing rendering machinery
  verbatim — `createGame`, `Tile`, `Train`, `Crossing`, the rAF loop via
  `game.start()/stop()`, the debug overlay — mirroring `PlayView` minus the score
  card, plus a scenario picker (`<select>` that routes to `/test/:id`, showing the
  active scenario's name + description).
- **Grid sizing is per-scenario.** `TestView` computes `cols`/`rows` from the
  scenario's `size` or, when absent, from the level's max x/y, instead of the
  hardcoded `levelSizeX = 7` / `levelSizeY = 6` in `PlayView`. The `.level`
  container width is `cols * tileSize`. The simulation itself is size-agnostic, so
  this is purely a rendering concern local to `TestView`.
- Selecting a scenario re-creates the game. `TestView` keys the game on the route
  param and tears down the old game (`stop()`) before building the new one, so
  switching scenarios is clean.

## createGame change (backward compatible)

Add an optional 5th parameter:

```ts
export function createGame(
  level: Level,
  trainDefs: TrainDef[],
  tileSize: number,
  colorSeed = 1,
  colors?: ColorAssignment,   // NEW: when provided, used instead of assignColors
): Game
```

When `colors` is passed, `createGame` uses it directly for both `depotColors`
(into the sim's matching) and `trainColors`; otherwise it calls `assignColors` as
today. `PlayView` is unchanged. This lets the depot scenario deterministically
present one matching and one mismatching depot.

## Initial scenarios

| id | proves | trains | grid |
|----|--------|--------|------|
| `straight` | leave depot → straight → park in depot | 1 | 4×1 |
| `curve` | curve geometry + travel | 1 | small L |
| `depot` | park on colour match; bounce on mismatch | 1–2 | small |
| `signals` | manual hold + two-train interlocking | 2 | 2D pocket |
| `junction` | t-junction switch routes onto a branch | 1 | 2D pocket |
| `cross` | crossing intersection, two trains cross | 2 | 2D pocket |
| `crossing` | road level-crossing gate + car | 1 | small |

Each map is built with `expandKind(...)` from `src/tiles/kinds.ts` and uses the
same `road?` seam for the crossing as `DEFAULT_LEVEL`.

## Testing

A unit test (`tests/unit/levels/testScenarios.spec.ts`) iterates `SCENARIOS` and
asserts, for each:

- `validateLevel(level, routes)` is `ok` (no dangling track, depots reachable,
  every train route connects), where `routes` are derived from each train's
  `routeDestinations`.
- ids are unique and url-safe.

So a broken test map fails CI, not just the eyeballs. Existing `npm run build`
(vue-tsc) covers the view's type-safety.

## Out of scope (YAGNI)

- No combined "all features" overview screen.
- No editor integration, no save/load — scenarios are code, edited in code.
- No new gameplay; this only arranges existing mechanics into focused maps.
