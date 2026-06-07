# Overtaking + driver behaviour — design

_Status: PLAN (not yet implemented). Builds on the merged lane model A–G
(`src/sim/road.ts`)._

## Goal

Make traffic feel human: not every car drives identically. Some drivers are
**patient** — they sit behind a slow leader at the leader's pace. Others are
**impatient/faster** — when held below their cruise speed they look to **overtake**,
but only commit when they judge the pass will actually complete safely, from the
**distance to the obstacle ahead and the speed difference**. A misjudged or
unavailable overtake is simply not started (or is aborted), never a collision.

## What we already have (reuse, don't rebuild)

- **Per-car cruise speed**: `Car.speed` is drawn per car from `±speedSpread`
  around `carSpeed`. Faster cars already exist and already get stuck behind
  slower ones (car-following caps them) — they are the natural overtakers.
- **Lane-change machinery (G)**: `Car.laneIndex` (continuous), `targetLane`,
  `updateLateral`, `laneClearForChange` (gap acceptance), and the body lean.
  An overtake is "set `targetLane` to the passing lane, then set it back" — the
  lateral motion is already solved.
- **Car-following / `clearAhead`**: gives the clear distance and the leader; the
  trigger and the feasibility inputs come straight from here.
- **Per-car deterministic RNG** at spawn (seeded) for assigning a driver profile
  without disturbing the speed/route streams.

## 1. Driver profiles (the "some drive correctly, some overtake")

Add a small per-car personality, assigned at spawn from the seeded RNG:

```
interface Driver {
  overtaker: boolean;   // will it ever pull out to pass? (disciplined = false)
  patience: number;     // seconds held below cruise before it wants to pass
  boldness: number;     // 0..1 — shrinks the safety margin in the feasibility calc
}
```

- A configurable **mix** (e.g. `TrafficConfig.driverMix = { disciplined: 0.7,
  overtaker: 0.3 }`), defaulting to mostly disciplined so overtakes are an
  occasional event, not constant churn.
- `boldness` scales the safety margins below: a bold driver accepts a tighter
  gap (more passes, more drama); a timid one needs a big margin (rarely passes).
- Disciplined drivers keep the current behaviour exactly (only merge / turn-lane
  changes from F+G; never an overtake).

## 2. When a car *wants* to overtake (trigger)

In the existing per-tick step, a car forms an overtake intent when ALL hold:

1. It's an `overtaker`.
2. It has been **held below cruise** (`velocity < speed · 0.9`) by a *car ahead*
   (not a junction/crossing/queue it can't pass) for ≥ `patience` seconds. Reuse
   the existing `waitSeconds`-style accounting, scoped to "slowed by a leader".
3. The leader is enough slower to be worth passing (`self.speed − lead.speed >
   MIN_OVERTAKE_GAIN`).
4. A **passing lane exists**: a same-direction lane to its left (inner / higher
   index) on a multi-lane road, OR the oncoming lane on a 1-lane-each-way road.
5. It is **not** about to need its current lane for a turn/merge soon (don't pull
   out 1 tile before your exit). Reuse `junctionAhead`.

Intent is cheap to drop: if any condition lapses, the car abandons the idea.

## 3. The feasibility calculation (the heart of it)

Two cases, increasing risk:

### 3a. Same-direction overtake (multi-lane road) — low risk

No oncoming traffic in the target lane. Feasible when:
- The target (passing) lane is clear beside the car AND for a look-ahead window
  (extend `laneClearForChange` to scan a stretch ahead in the target lane, not
  just alongside on the same tile).
- There's room to accelerate past and a gap to **return** into ahead of the
  overtaken car.

This is mostly gap-checking — a good first milestone (no timing math yet).

### 3b. Oncoming-lane overtake (1 lane each way) — the real calculation

This is the "calculate if it works out from distance + speed diff" the feature is
about. Let:

- `v` = the overtaker's pass speed (its cruise), `vL` = leader speed,
  `vO` = oncoming car's speed, all tiles/sec.
- `D_pass` = distance the overtaker must cover *relative to the leader* to get
  from a safe gap behind it to a safe gap ahead = `gapBehind + leaderLen +
  selfLen + 2·SAFE_GAP`.
- **Time to complete the pass:** `t = D_pass / (v − vL)` (needs `v > vL`).
- **Closing distance used against oncoming traffic:** while passing, the
  overtaker and the nearest oncoming car approach at `v + vO`, so the oncoming
  car must currently be at least

  `D_required = (v + vO) · t + MARGIN(boldness)`

  away (down the oncoming lane) for the pass to finish with room to spare.
- **Decision:** start the pass only if the *visible* clear distance to the
  nearest oncoming car `≥ D_required` AND the passing lane is clear right beside
  the car. `MARGIN` shrinks with `boldness` (and we never let it go below a hard
  floor, so even bold drivers keep a minimum cushion).

Inputs all come from the sim: `gapBehind`/leader from `clearAhead`; oncoming car
distance + speed from a forward scan of the oncoming lane (the projection helpers
in `clearAhead` already find oncoming bodies — add their distance + speed).

## 4. Executing an overtake (a small state machine on the car)

```
none → intend → passing → returning → none
                   │           │
                   └── abort ──┴── back to original lane, give up
```

- **intend → passing:** feasibility passed → set `targetLane = passingLane`;
  raise the speed cap to the car's full cruise (don't let car-following to the
  *leader* hold it back while it's committing to pass — it now follows the
  passing lane).
- **passing:** override the desiredLane so F's merge/turn logic doesn't yank it
  back; keep accelerating. Track the overtaken car.
- **passing → returning:** once the overtaker's tail is `SAFE_GAP` ahead of the
  overtaken car's nose, set `targetLane` back to the original lane.
- **abort:** if at any tick (oncoming-lane case) the oncoming car is closing
  faster than predicted — recompute `D_required` against the *current* state; if
  it no longer holds and the car hasn't passed the leader yet, brake and return
  to the original lane behind the leader. Aborting must always be safe (the car
  can fall back into the gap it left). This is why gap acceptance also guards the
  return.

The lateral motion, gap acceptance and lean are all the existing G code; the new
work is the intent/feasibility/state on top.

## 5. Integration points

- `Car`: add `driver: Driver`, `overtake: { phase, targetLane, passingCarId,
  heldSec }` (or a flat set of fields).
- `desiredLane`: when `overtake.phase` is active, it returns the overtake lane
  (highest priority, above merge/turn) until the pass completes/aborts.
- New `considerOvertake(car, dt)` called each tick before `updateLateral`:
  runs the trigger + feasibility + state machine, mutating `overtake`/`targetLane`.
- `clearAhead`: while passing, the car must follow its *passing-lane* leader, not
  the car it's overtaking — make the lane it follows the (fractional) lane it's
  committing to.
- Spawn: assign `driver` from the seeded RNG per the `driverMix`.

## 6. Test scenarios + assertions (every feature ships one)

- `overtake-twolane`: a fast car behind a slow one on a 2-lane-per-direction
  road. Assert the fast car uses the inner lane to pass and returns, and that it
  reaches its cruise speed (the slow car never does the passing).
- `overtake-oncoming`: 1-lane-each-way road, a slow leader, periodic oncoming
  cars. Assert: (a) NO head-on (two opposing cars never occupy the same tile in
  the same lane mid-pass); (b) the overtaker only pulls out when the oncoming gap
  satisfied `D_required` (drive it from a known geometry and check it waits when
  the gap is too small); (c) a bold driver passes in a gap a timid one refuses.
- Determinism: same seed → identical passes (driver + speed draws are seeded).

## 7. Risks / open decisions

- **Scope:** ship **3a (same-direction) first** — it's most of the value with
  none of the head-on risk and reuses gap acceptance directly. Treat **3b
  (oncoming)** as a second milestone behind a flag; it's where the timing math
  and the abort path earn their keep.
- **Map realism:** oncoming overtakes only make sense on long straights; on the
  small test maps the windows are short, so tune `MIN_OVERTAKE_GAIN` /
  `patience` so cars don't dither pulling in and out every tile.
- **Determinism:** assign the driver profile from a *separate* seeded stream (like
  `routeRng`) so adding it doesn't shift the existing per-car speed sequence and
  break seeded tests.
- **Interaction with F:** an overtake must yield to a committed turn — never pull
  out within `TURN_LANE_LOOKAHEAD` of the car's own junction.

## Suggested build order

1. Driver profiles + mix + seeded assignment (no behaviour yet).
2. Same-direction overtake (3a): trigger + gap-window check + state machine +
   `overtake-twolane` scenario/test.
3. Oncoming feasibility (3b): the `D_required` math + oncoming scan + abort +
   `overtake-oncoming` scenario/test, behind a config flag until it's solid.
4. Tuning pass (margins, mix, gains) against the test world.
