# Signaling & path reservation — design

Status: **Phase 1 implemented** (2026-06-04). Built on the deterministic
simulation in `src/sim/` and the render loop in `src/game.ts`.

Implementation notes: `routeToNextSignal()` in `network.ts`; reservations,
`signalAspect()`, and manual `toggleHold()` in `simulation.ts`; `game.ts` derives
signal tiles from the level, refreshes reactive `signalAspects` each frame, and
exposes `toggleHold`; `TileStraight.vue` draws a directional red/green signal per
exit. Covered by unit tests (reservation/junction/hold/aspect) and e2e (no two
trains share a tile; signals render; a manual hold forces Stop).

## Goal

Bring back **traffic lights** as a permanent, visible feature, and implement
**path reservation** the way real railways / train games do: a train claims the
route ahead so no other train can enter or cross that path, and signals show
red/green so other trains wait. Must be **stable**: deterministic, computed in the
sim tick, unit-tested — no `$refs`, no polling, no animation callbacks.

## Scope

**Phase 1 (this round):** main signals (Stop/Proceed) + route reservation /
interlocking + manual override + always-visible lights. Trains stop instantly at a
red signal (no braking distance). Built on an **extensible aspect model** so the
later phases below are additive, not a rewrite.

**Deliberately deferred** (each needs a prerequisite, so building it now would
warn about a danger that can't happen yet):

- **Distant / pre-signals (Vorsignal)** and **yellow / multi-aspect** signals —
  these warn a driver to start braking for the next signal. They need a **train
  momentum / braking-distance model** first. (Phase 2.)
- **Speed signaling** (proceed slowly through a diverging route) — needs
  **variable train speed**. (Phase 2.)
- **Path-based signaling (PBS)** — share a block when exact paths don't cross, for
  throughput. (Phase 3.)
- **Automatic deadlock detection/resolution.** (Phase 3.)

## Concept (block / route reservation = interlocking)

- Track between signals is a **block**. A train may only enter a block if it can
  **reserve the whole route through it** (every tile up to the next signal).
- While a route is reserved by train A, **no other train may reserve or enter any
  tile in it** → no head-on, no rear-end, and **no crossing** at junctions (the
  junction tile is part of A's reserved route).
- A **signal** guards the entrance to the block ahead: **Proceed** when the block
  is free/reservable, **Stop** when it is reserved/occupied by another train. A
  train stops at a Stop signal and proceeds when it clears.
- As a train passes through and its tail clears a tile, that tile's reservation is
  **released** so following trains can claim it.

## Signal model (extensible)

- A signal's state is an **`Aspect` enum**, not a red/green boolean:
  `Stop` and `Proceed` now; room for `Caution` / `PreliminaryCaution` later
  (adding yellow = one enum case + one render branch).
- Signals are **directional**, keyed per `(tileId, exitPort)` — matching the old
  `trafficLights` `direction` data. A straight signalled both ways has two.
- Each signal can reference **its next signal along the route** — the hook a
  distant/pre-signal needs in Phase 2. (Stored when blocks are computed; unused in
  Phase 1 rendering.)
- `train.speed` stays a field (already true) so braking/variable speed plugs in.

## Where signals live

- Reuse the level's existing signal tiles (those with `trafficLights`) as block
  boundaries, **plus depot exits** (a depot is a natural block end).
- Signal placement matters: a junction is only protected if a signal sits before
  it on each approach. The current board already has signals near the junctions;
  tune placement if a junction needs tighter protection.

## Data model (added to the simulation)

```
reservations: Map<tileId, trainId>       // a tile reserved by exactly one train
signals:      Map<"tileId:exitPort", …>  // signal definitions (from the level)
manualHold:   Set<"tileId:exitPort">     // player-forced Stop (overrides auto)
```

Plus the existing per-train `path`, `headIndex`, `headProgress`, and body
occupancy.

## Algorithm (inside `step(dt)`, per train, deterministic order)

1. Advance the train's progress (as today).
2. **At a block boundary** (head finishing a signal tile / depot, about to enter
   the next block):
   - Compute the **route ahead**: walk the graph from here following the train's
     switches, collecting tiles until the next signal / depot / dead end.
   - The route is **reservable** if every tile in it is free — not reserved by and
     not occupied by *another* train — and no `manualHold` applies to that signal.
   - **Reservable →** claim all those tiles for this train; signal = `Proceed`;
     train crosses.
   - **Not reservable →** signal = `Stop`; train holds at the signal tile (the
     existing `getSignal === "red"` gate). It retries next tick automatically.
3. **Within a reserved block**, the train runs freely (it owns the tiles).
4. **Release** reservations for tiles fully behind the train's tail each tick.
5. **Occupancy gate stays** as a backstop: a train never enters a tile occupied by
   another train, even if signals/blocks were mis-placed. (Already tested.)

## Signal aspect & the movement gate

- A signal's aspect is **derived each tick** from the block it guards: `Stop` if
  any tile in the block beyond it is reserved by / occupied by another train, or a
  `manualHold` is set; else `Proceed`.
- The sim's `getSignal(tileId, exitPort)` returns `"red"` for `Stop` using the
  same logic (one source of truth).
- `game.ts` exposes `signalAspect(tileId, exitPort)` for rendering.

## Lights & manual override (the visible feature)

- **Lights are always rendered** on signal tiles — a proper red/green signal
  sprite (restoring the look that was removed), showing the computed aspect.
- **Manual override:** clicking a signal toggles a `manualHold` — forces `Stop` so
  the player can deliberately hold a train; clicking again returns it to automatic.

## Integration points

- `src/sim/simulation.ts` — add `reservations` + reserve/release in `step`, the
  aspect query, the manual-hold input; keep the occupancy backstop.
- `src/sim/network.ts` — add a "walk the route until the next signal/depot" helper.
- `src/game.ts` — own `signals` + `manualHold`, wire `getSignal`, expose
  `signalAspect()` and `toggleHold()`.
- `src/components/TileStraight.vue` (+ depot if signalled) — render the signal
  sprite from `signalAspect`, click → `toggleHold`.

## Testing (unit tests first, TDD)

- Two trains approaching a junction from different arms: the first reserves, the
  second's signal goes `Stop` and it waits; after the first clears, the second
  proceeds. (No crossing, ever.)
- A reserved tile can't be claimed by another train; it's released once the
  holder's tail passes.
- Aspect reflects block state; a `manualHold` forces `Stop` regardless.
- The existing "never enters an occupied tile" test stays green.
- An e2e check: a train stops at a Stop signal and never crosses it (already have
  a manual-signal version; extend to the auto/reservation case).

## Known limitation (be honest)

Whole-block reservation can **deadlock** if two trains reserve toward each other on
a shared single-track block with no alternative route. The board's loops and
switchable junctions usually avoid this, and the player can re-route via switches.
Automatic deadlock detection/resolution is Phase 3 (the sim's global view makes it
tractable).

## Roadmap recap

1. **Phase 1 (now):** main signals + reservation + manual override + lights.
2. **Phase 2:** train momentum/braking → distant/pre-signals, yellow aspects,
   speed signaling.
3. **Phase 3:** PBS (path signals) for throughput; deadlock resolution.
