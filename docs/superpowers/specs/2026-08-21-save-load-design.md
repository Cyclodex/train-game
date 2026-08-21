# Save / load (Spielstand) — design

2026-08-21. Status: implemented alongside this spec.

## Problem

Only the LEVEL layout persists today (`levelStore.ts`), plus per-level best
results (`objectiveStore.ts`) and a few settings (`gameConfig.ts`). A running
GAME cannot be saved: leaving `/play` loses train positions, money, objective
progress and dispatched state. This spec adds named save slots that capture a
running game and restore it exactly.

## The one design question: snapshot vs. rebuild

The sim is headless and deterministic, so every piece of state is either
**snapshotted** (serialized verbatim) or **rebuilt** (re-derived from data that
is snapshotted). The rule used throughout: snapshot anything a player action or
elapsed time has moved; rebuild anything that is a pure function of what is
already in the save.

### Snapshotted

| State | Where | Why not rebuilt |
| --- | --- | --- |
| Level (live) | `GameSave.level` | build-in-play mutates it |
| Level (pristine) | `GameSave.pristineLevel` | Retry after a load must reset to the run's own opening board — restoring starting capital while keeping bought track would be free money |
| Train roster (`TrainDef[]`) | `GameSave.trains` | `buyTrain` appends, retire/scrap remove |
| Colours (depot + live train liveries) | `GameSave.colors` | bought trains got palette colours the seeded assignment cannot reproduce |
| Switch arms | `GameSave.switches` | player clicks |
| Sim trains (full `SimTrain` minus derived fields) | `SimSnapshot.trains` | position, momentum, dwell, manifest, line cursor are the game |
| Per-train route plan (`RailPlan.steps`) | in each train snapshot | replanning mid-leg from the current head can tie-break differently than the plan the train committed to; `exitAt` is rebuilt from `steps` |
| Reservations | `SimSnapshot.reservations` | re-deriving would claim blocks a train had not yet claimed (a train reserves only when it crosses), changing who yields to whom |
| Manual signal overrides (hold / force-green) | `SimSnapshot` | player state |
| Transit layer: lines (+`lineSeq`), queues, spawn clocks, destination cursors, delivered total | `SimSnapshot.transit` | queues and cursors are elapsed-time state; `lineSeq` keeps future line ids collision-free |
| Objective tracker: phase, counters, lostReason | `GameSave.objective` | the score IS the progress |
| Economy ledger: balance, earned, spent, clock, seq, entries | `GameSave.game.economy` | money moved |
| Fare book: ages, settled | `GameSave.game.fares` | fares decay with time |
| Game bookkeeping: `clock`, deliveries, manual hold/green totals, `tilesBuiltTotal`, `trackSpentTotal`, `leviesBilled`, `taxPaidTotal`, `unpaidTaxTotal`, `boughtPieces`, `boughtCount`, queued (in-shed) train ids, bus roster (id + lineId) | `GameSave.game` | closure counters in `createGame` |

### Rebuilt on restore

- **Derived train fields** — `unitOffsets`, `bodyLength`, `lookAhead`
  (recomputed from `unitLengths`/`coupling`/`speed`/`brake`, same formulas as
  `buildTrain`), `plan.exitAt` (from `plan.steps`).
- **`blockStates`** — cleared; the next tick re-derives holds. This re-emits one
  `blocked` event per held train after a load (a log line, no state).
- **Road traffic** — NOT snapshotted. The road sim is rebuilt fresh from the
  same seed; cars respawn deterministically from t=0. Accepted per scope: road
  vehicles are scenery in every mode this feature covers.
- **Buses** — the roster (which buses, on which lines) is saved; each is
  re-bought onto its line on restore. Bus positions and riders ABOARD a bus at
  save time are not restored (riders waiting at stops are, via the transit
  queues). Known v1 limitation.
- **Spawner** (Time Attack) — a pure schedule cursor; restored by
  `reset()` + one `step(elapsedSec)` whose returned defs are discarded (the
  already-spawned trains live in the sim snapshot; `injectTrain` also guards).
- **Signal tile list, station lists, catchment demand config** — derived from
  the saved level at `createGame` time.

### Out of scope (v1)

- **Citizens mode**: the citizen sim (population, trips, moods) is not
  serialized. The save UI is hidden when the citizen layer is enabled.
- **Undo window** (`lastBuild`): cleared by a load; undo does not survive.
- **Event log**: starts empty after a load (timestamps keep the saved clock).

## API

### `Simulation.snapshot()` / `Simulation.restore(snap)` (`src/sim/simulation.ts`)

`snapshot()` returns plain JSON data (`SimSnapshot`). `restore(snap)` mutates in
place: the exposed `trains` record is emptied and refilled (callers hold the
reference), the reservation map / hold sets are replaced, and the transit layer
it holds is restored via `TransitLayer.restore` — mutation in place matters
because `game.ts` shares one transit object between sims.

Restore order inside `restore()`: transit first (trains reference line ids),
then trains, then reservations, then overrides; `blockStates` cleared.

### `TransitLayer.snapshot()` / `restore(snap)` (`src/sim/transit.ts`)

Lines in order (with `pinned`), `lineSeq`, queues, spawn clocks, destination
cursors, delivered total. The line-graph memo is just `touch()`ed.

### `ObjectiveTracker.snapshot()` / `restore(snap)` (`src/sim/objectives.ts`)

`{ phase, counters, lostReason }`.

### `Economy.snapshot()` / `restore(snap)`, `FareBook.snapshot()` / `restore(snap)` (`src/sim/economy.ts`)

Ledger scalars + entry log + `seq`; fare ages + settled set (specs stay
construction-time data).

### `Game.captureSave()` / `Game.restoreSave(save)` (`src/game.ts`)

`captureSave()` assembles the full `GameSave` (versioned). `restoreSave(save)`
is called on a FRESHLY created game whose `createGame` already received the
save's level, trains, mode and colours — it then overwrites the moving state:
switches, pristine level (in place), sim, tracker, economy, fares, closure
counters, shed queue, buses, spawner fast-forward; ends with the usual
`syncLine`/`syncLines`/`refreshMoney`/`refreshObjective`.

Restoring is a two-step contract by design: `createGame` owns construction
(mode setup, colour pinning, transit wiring) and `restoreSave` owns state.
Folding both into one constructor path would duplicate `buildSims`.

### `src/saveStore.ts` — slots

`localStorage` under one key (`train-game:saves`), in-memory fallback like
`levelStore`. `SAVE_VERSION = 1`; a slot with a different version is listed as
incompatible and refuses to load (no migration in v1). API: `listSaves()`
(metas, newest first), `getSave(id)`, `putSave(id, save)`, `deleteSave(id)`,
`AUTOSAVE_ID`.

### UI (`src/views/PlayView.vue`)

- Drawer button **💾 Saves** opens a Spielstand overlay: name field + Save
  button, slot list (name, mode, date) with Load / Delete.
- Loading navigates to `/#/play?save=<id>&t=<nonce>` (the nonce forces a
  remount when re-loading the same slot). On mount, `?save=` wins over
  `?board=`/custom level: the view builds the game from the save's level,
  trains, mode and colours, then calls `game.restoreSave(save)` and does NOT
  auto-start the objective (the saved phase stands) or re-seed scenario buses.
- Autosave: `beforeUnmount` writes slot `autosave` while the objective is
  `playing` (never in citizens mode).
- Save UI hidden while the citizen layer is enabled.

## Correctness argument (why restore resumes exactly)

The sim's `step(dt)` reads: `level`, `switches` (via resolver), the trains
record, `reservations`, `manualHold`/`manualProceed`, and the transit layer.
All of these are either snapshotted verbatim or byte-equal after rebuild
(derived train fields are pure functions of snapshotted inputs; `exitAt` is a
pure index of `steps`). Iteration order is `Object.keys(trains).sort()` —
independent of insertion order — and transit's queues/cursors are restored
verbatim, so the first post-restore tick computes exactly what the
next pre-save tick would have. Hence the round-trip property:

> step N ticks → snapshot → restore into a fresh sim → step M ticks
> ≡ step N+M ticks (same config, same dt sequence)

which `tests/unit/sim/saveRestore.spec.ts` asserts by comparing full snapshots,
and `tests/unit/gameSave.spec.ts` asserts at game level (tycoon: money,
fares, tracker; puzzle variant: spawner).

Known non-exactness after a LOAD (documented, deliberate): road cars restart
from t=0, buses restart at their first stop, and one `blocked` log line per
held train re-emits. None of these feeds back into train movement scoring
except `maxCarWaitSec`-style road counters, which no covered mode fails on.

## Feature-test scenario

`src/levels/test/scenarios/saveload.ts` — a two-train contention pocket
(signal + junction, puzzle mode) small enough that reservations and holds are
exercised within seconds. Registered under Challenges → Save & load. It is the
board the round-trip unit tests run on, and playable at
`/#/play?board=saveload` to exercise the save/load UI manually.

## Save format sketch

```ts
interface GameSave {
  version: 1;
  name: string;
  savedAt: number;           // wall clock, display only
  modeId: string;
  levelId: string;
  colorSeed: number;
  level: Level;              // live
  pristineLevel: Level;      // what Retry resets to
  trains: TrainDef[];        // live roster
  colors: { depotColors: Record<string, string>; trainColors: Record<string, string> };
  switches: Record<string, Record<number, ActiveIntersection>>;
  sim: SimSnapshot;
  objective: ObjectiveSnapshot;
  game: {
    clock: number;
    deliveries: number;
    manualHoldTotal: number; manualGreenTotal: number;
    tilesBuiltTotal: number; trackSpentTotal: number;
    leviesBilled: number; taxPaidTotal: number; unpaidTaxTotal: number;
    boughtPieces: string[]; boughtCount: number;
    queuedTrainIds: string[];
    buses: { lineId?: string }[];
    economy?: EconomySnapshot;
    fares?: FareBookSnapshot;
  };
}
```
