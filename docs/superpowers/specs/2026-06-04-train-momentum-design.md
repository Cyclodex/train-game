# Train momentum: realistic starting & stopping

**Status:** design / approved direction
**Date:** 2026-06-04
**Area:** headless simulation (`src/sim/*`), train dynamics only — renderer untouched.

## Problem

Trains today move at a constant `speed` (tiles/sec). Each tick does
`headProgress += speed * dt`, and the moment a train must stop (red signal, a
reserved/occupied tile ahead, a depot, a dead end) it **instantly** clamps to a
halt; when the way clears it **instantly** snaps back to full speed. There is no
momentum, so departures and arrivals look unnatural — a train teleports from 0 to
cruise and from cruise to 0.

The signaling design doc already names this gap: a "train momentum/braking model"
is the missing Phase-2 foundation (it precedes yellow/pre-signal aspects).

## Goal

Trains accelerate smoothly away from a stop, cruise at their max speed, and brake
smoothly to a halt — coasting to rest **exactly at the stop line** (red signal,
the train ahead, a depot, a dead end) rather than slamming to zero. Heavier trains
(freight, more wagons) accelerate and brake more gently than light ones.

All movement physics stays inside the authoritative headless simulation. The
renderer (`game.ts`, `Train.vue`) and the reservation/interlocking logic are not
touched — they already read `sampleTrain()` / `trainProgress()` each frame and
will simply see smooth motion.

## Non-goals

- No new visible aspects (yellow / pre-signals / speed signs). This model is the
  prerequisite for those, not the feature itself.
- No change to reservation, interlocking, switch, or depot semantics.
- No renderer or UI changes (the existing speed multiplier still scales `dt`).

## Model

### Per-train state (added to `SimTrain`)

- `velocity: number` — current speed in tiles/sec, starts at `0`.
- `maxSpeed: number` — cruise speed (the value previously called `speed`; kept as
  `speed` on the public `SimTrain` for compatibility, used as the cap).
- `accel: number` — acceleration in tiles/sec².
- `brake: number` — deceleration in tiles/sec².
- `lookAhead: number` — how far forward (in tiles) to scan for stop points;
  derived once as `maxSpeed² / (2·brake) + 1` so a train never brakes for
  something beyond its braking distance, and never spuriously brakes on open
  track.

`accel`/`brake` are accepted as optional fields on `TrainInit`; when omitted the
simulation derives them from the train's `type` and `wagonCount` (see Mass).

### Per-tick integration (in `advance`)

For a running train, each `step(dt)`:

1. **Look ahead.** Compute `clearDistance` — the distance (in tiles) from the
   train head to the nearest point it must stop at, scanning forward along its
   live route, capped at `lookAhead`. A tile boundary is *crossable* under exactly
   the same conditions the current `advance` uses to decide cross-vs-clamp: not a
   dead end / map edge, not a depot arrival, not a manual Stop hold, and the block
   ahead reservable for this train (or forced green) and not physically occupied
   by another. The scan stops at the first non-crossable boundary; the stop line
   is that boundary.

2. **Cap speed for braking.** `vSafe = √(2 · brake · clearDistance)` — the fastest
   the train may go now and still brake to rest within `clearDistance`.
   `vCap = min(maxSpeed, vSafe)`.

3. **Update velocity.** Ramp toward `vCap`:
   - if `velocity < vCap`: `velocity = min(vCap, velocity + accel·dt)`
   - if `velocity > vCap`: `velocity = max(vCap, velocity − brake·dt)`
   - clamp `velocity ≥ 0`.

4. **Move.** `move = min(velocity · dt, clearDistance)`. If the train is within a
   tiny `ARRIVAL_EPS` of the stop line (`clearDistance − move < ARRIVAL_EPS`),
   snap `move = clearDistance` so it actually reaches the line rather than
   approaching it asymptotically.

5. **Advance & cross.** Add `move` to `headDistance` and cross tile boundaries
   exactly as today. The existing hard checks at each boundary stay in place as a
   **safety backstop**: even if physics overshoots by a hair, a train can still
   never enter a reserved/occupied/red tile — it clamps at the boundary, and the
   next tick its `vCap` collapses to ~0.

`velocity` resets to `0` when a train parks in a matching depot or bounces out of
a mismatched one (it then accelerates away from rest).

### Look-ahead scan (pure, read-only)

A new helper walks hypothetical head segments forward from the current head using
`traverse` + `resolveExitPort` (same as `advance`), summing one tile of distance
per crossable boundary, until a boundary is not crossable or `lookAhead` is
reached. It writes **no** reservations — reservation writes still happen only when
the train physically crosses in `advance`. Crossability reuses the existing
predicates (`tileFreeForTrain`, `routeToNextSignal`, occupancy, manual
hold/proceed), factored into a shared `mayCross(train, head)` so the scan and the
real crossing can never disagree.

### Mass

Heavier trains accelerate and brake more gently. Derived from existing data:

```
weight   = 1 + wagonCount · (type === "fraight" ? FRAIGHT_WAGON_W : PEOPLE_WAGON_W)
massK    = 1 + (weight − 1) · MASS_SENSITIVITY      // ≥ 1
accel    = BASE_ACCEL / massK
brake    = BASE_BRAKE / massK
```

A loco-only people train uses the base rates; longer and freight trains scale
down. Constants live in one place (a new `src/sim/physics.ts`) and are tuned so a
light train reaches cruise in roughly a second and the heaviest enabled train
still feels responsive (no absurd braking distances). `maxSpeed` is unchanged
(per-train, default as today).

## Files

- `src/sim/physics.ts` *(new)* — `BASE_ACCEL`, `BASE_BRAKE`, mass constants,
  `ARRIVAL_EPS`, and `trainDynamics(type, wagonCount) → { accel, brake }`. Plain
  TS, no Vue/DOM (mirrors `trainDimensions.ts`).
- `src/sim/simulation.ts` — add the per-train dynamics fields; add `mayCross` and
  `clearDistanceAhead`; rewrite the body of `advance` to integrate velocity;
  reset `velocity` on park/bounce. `TrainInit` gains optional `accel`/`brake`. A
  `trainVelocity(id)` accessor is exposed for tests and future speed signals.
- `src/game.ts` — pass `accel`/`brake` from `trainDynamics(def.type,
  def.wagonIds.length)` when building `TrainInit` (alongside the existing
  `unitLengths`/`coupling`).

## Testing

New unit tests in `tests/unit/sim/simulation.spec.ts`:

- **Accelerates from rest:** velocity rises over successive ticks from 0 and
  saturates at `maxSpeed` on open track; the first tick covers far less than the
  constant-speed prediction.
- **Brakes to a stop at a red signal / blocker:** approaching a held signal, the
  train's velocity declines over several ticks and it comes to rest with its head
  at the signal-tile boundary — it does not run at full speed then halt in one
  tick.
- **Coasts to rest in a depot:** the train slows into the depot and the arrival
  event still fires (no asymptotic hang short of the line).
- **Mass (physics):** `trainDynamics` gives a heavier/freight train smaller accel
  and brake than a light people loco.
- **Safety invariant preserved:** the existing "never enters an occupied tile"
  and crossing/reservation tests still hold.

Existing constant-speed tests that assert exact distances after a fixed `dt`
(`advances a train tile by tile`, `exposes fractional progress`) encode the old
instant-speed model. They are updated to reflect ramping: assert ordered tile
progression and eventual arrival / monotonic progress rather than an exact
linear position. Other existing tests assert end states over long loops and should
still pass; where ramping needs a few more ticks to reach the same end state, the
loop counts are increased without weakening the asserted invariant.

Verification: `npm run test:unit` (physics + simulation), then `npm run build`
(vue-tsc) and a quick `npm run dev` look for feel.

## Risks / trade-offs

- **Tuning is feel-driven.** Constants are centralized so they can be adjusted
  after seeing the trains move; the model is correct regardless of the exact
  numbers.
- **Look-ahead vs reservation race.** A train may scan a free block as clear, then
  another train reserves it before this train arrives. `clearDistance` then drops
  suddenly and the train brakes hard (or, worst case, the safety backstop clamps
  it at the boundary). This never causes a collision — it only looks like a firm
  stop — and is rare given block reservation already claims the whole route ahead.
- **Large `dt` at 4× speed.** A big tick can't break safety (move is clamped to
  `clearDistance`); it can slightly coarsen the braking curve, which is acceptable.
