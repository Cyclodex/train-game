# Stakes: the objective loop, anchored by the level crossing — design

**Status:** Draft for review (written 2026-06-06, autonomously, for the next
session). Deepens the Jun-5 brainstorm — primarily [`01-objectives-and-game-modes.md`](../../brainstorm/01-objectives-and-game-modes.md)
fused with the level-crossing open question in
[`02-terrain-and-tile-types.md`](../../brainstorm/02-terrain-and-tile-types.md) §2.3
and [`04-world-and-atmosphere.md`](../../brainstorm/04-world-and-atmosphere.md) §4.1.
Not yet approved; no implementation started. On branch
`spec/stakes-crossing-scoring` (off `develop`).

---

## 1. Why this, why now

Since the brainstorm we've shipped a lot of **mechanics**: train momentum,
signaling + interlocking, and the entire **road layer + level crossings** with a
deterministic car-sim (`src/sim/road.ts`), cars that queue bumper-to-bumper at a
closed gate, and a `/test` scenario world. The editor can draw both rails and
roads with the route-builder.

But the game still has **no stakes**. `PlayView.vue` shows a single counter —
`deliveries / totalTrains` (`game.deliveries`, incremented in `game.ts`
`handleEvents` on an `arrived` event with `matched === true`) — and a "complete"
banner when they're equal. That's it. There is:

- no timer, no failure condition, no lose state, no start/end screen;
- no reason to play *well* rather than just *eventually*;
- **no payoff for the crossing at all** — cars stop for trains, but a player who
  ignores the crossing entirely loses nothing. The most visually impressive
  system we built is currently pure atmosphere.

The brainstorm rated the objective loop ★★★ — the highest-value area — and called
slice **A** (score + win/lose + stars on the current board) the recommended first
slice. It's still the right call, and it's now *better* than when it was written,
because the crossing gives us a second, naturally-juicy scoring axis we didn't
have on Jun 5: **how well you keep road traffic flowing through the crossings.**

So this slice does two things at once:

1. Turn the delivery tally into a real **objective → win/lose → star-rating** loop
   (doc 01 §§1.1–1.3), with a small **game-phase state machine** and HUD.
2. Promote the **level crossing** from atmosphere to a **first-class scored
   mechanic** — answering open question 2.3 (managed vs. automatic) and giving the
   road system the payoff it's missing.

### Alternatives considered (and why not, this round)

- **Stations / cargo network (doc 02 §2.4)** — the runner-up. High value (★★★),
  opens the management/Endless direction, but it's **L-effort** (new dwell/queue
  sim behaviour) and adds *another* stake-free mechanic to a game that already has
  no stakes. Better *after* the objective layer exists to give it meaning. Slot it
  as the next slice.
- **Terrain / obstacles + bridges/tunnels (doc 02 §§2.7/2.2/2.1)** — the original
  prompt's "forest & friends." Good, and the data-driven model makes it cheap, but
  again it's *content/scenery* without a loop to play inside. Schedule after A.
- **Pure juice pass (doc 04 §§4.3/4.6/4.8 — day/night, sound, particles)** —
  cheap and lovely, and it *pairs* with this slice (a crossing incident wants a
  klaxon; a win wants a jingle). Folded in here only as thin, optional hooks; the
  full juice pass stays its own later slice.

---

## 2. Design goals & non-goals

**Goals**

- A complete, winnable/losable session on the **current boards** — no new tile
  types, no new terrain. Works on `develop` today.
- Keep the **authoritative-sim / thin-renderer** split intact: all scoring and
  win/lose logic is **headless and unit-tested**, beside the sim, not in Vue.
- Make the **crossing matter**: a measurable "kept the road flowing" score and a
  crash/incident fail path, both deterministic and testable.
- Objectives are **data** attached to a level (so the editor and procgen can author
  them later) with sensible defaults when absent (every current level still plays).

**Non-goals (YAGNI this slice)**

- No campaign / world progression / unlock gating (doc 01 §1.5) — later.
- No Endless mode, no demand spawning, no station queues (doc 01 §§1.4/1.6) — needs
  stations.
- No new audio/particle *assets*; only the **event hooks** a later juice pass binds
  to (one no-op-safe emitter).
- No multiplayer / leaderboard / daily seed (doc 01 §1.8) — the star + best-time
  data is stored locally, leaving the door open.
- No change to how trains or cars physically move. We only *observe* the sim and,
  for the managed-crossing variant, *gate* it.

---

## 3. Architecture: an objective layer beside the sim

The current split is: `simulation.ts` (headless trains) + `road.ts` (headless
cars) → `game.ts` (owns both, runs the rAF loop, holds reactive refs) → Vue views.

We add **one new headless module** and a thin reactive surface on `game`:

```
src/sim/objectives.ts        # pure, deterministic, unit-tested
  createObjectiveTracker(spec) -> {
    observe(events: SimEvent[], road: RoadFrame, dt): void
    state(): ObjectiveState           // delivered, timeLeft, incidents, phase, stars…
    reset(): void
  }
```

- It is **pure logic over an event/observation stream** — no Vue, no DOM, no
  `Date.now()` (it's driven by the sim's scaled `dt`, so it stays deterministic and
  replayable, exactly like the rest of `src/sim/*`).
- `game.ts` already aggregates `SimEvent[]` each tick (`handleEvents`). It will
  also build a tiny per-tick **`RoadFrame`** (car waits + which crossings are
  closed + any new road incidents) and feed both into `tracker.observe(...)`.
- `game.ts` exposes the tracker's state as reactive refs (mirroring how
  `deliveries` is exposed today) so `PlayView.vue` renders a HUD off it.

Why a separate module rather than growing `game.ts`: `game.ts` is already the
fattest file (loop + reservations + colours + road wiring). Scoring is a distinct
responsibility with its own tests; keeping it in `src/sim/` lets us unit-test the
whole win/lose/star matrix without a browser — the same discipline that made the
movement model trustworthy.

### Data flow per tick

```
loop(dt)                         # game.ts rAF loop, dt already speed-scaled
 ├─ events = sim.step(scaled)
 ├─ roadSim.step(scaled, closed) # closed(tileId) = reservedBy||occupiedBy (today)
 ├─ roadFrame = collectRoadFrame()   # NEW: waits, incidents, throughput deltas
 ├─ tracker.observe(events, roadFrame, scaled)   # NEW
 ├─ deliveries.value = tracker.state().delivered # (folds the old counter in)
 └─ render(...)                   # draws trains, cars, AND the HUD from state()
```

---

## 4. Objective spec (the data) & defaults

A level optionally carries an objective spec. Shape (in `src/types.ts` or a new
`src/sim/objectives.ts`):

```ts
export interface ObjectiveSpec {
  // Primary win condition: deliver this many colour-matched trains.
  deliveriesRequired: number;          // default: number of trains in the level
  // Optional soft clock. undefined => untimed (current behaviour).
  timeLimitSec?: number;
  // Fail conditions (any true => Lost). All optional/off by default so existing
  // levels keep their current "no way to lose" feel until a level opts in.
  fail?: {
    onTrainCrash?: boolean;            // requires crashes-enabled (see §6)
    onCrossingIncident?: boolean;      // a car caught on a closing crossing
    maxCarWaitSec?: number;            // a single car waits longer than this => fail
    onTimeout?: boolean;               // timeLimitSec elapses before win
  };
  // Optional star objectives (up to 3). Evaluated at win; pure predicates over
  // the tracked counters. Authoring picks 0..3 from the catalogue in §7.
  stars?: StarObjective[];
}
```

**Backward-compatible default:** a level with no spec gets
`{ deliveriesRequired: trainCount }` and **no fail conditions** — identical to
today's "deliver them all, can't lose." Stakes are opt-in per level, which lets us
ship the machinery without breaking the default board or the editor's current
output, then dial difficulty in later (and in procgen / campaign).

Where the spec lives: alongside the level in `levelStore.ts` / `LevelDefinition`,
so the editor can author it and import/export round-trips it. This slice ships the
*runtime + default*; an editor objective-editor panel is a small follow-up.

---

## 5. The game-phase state machine

A tiny enum drives the start/end screens (doc 01 §1.2). It lives in the objective
tracker (so it's testable) and is mirrored reactively for the views.

```
Ready ──start──▶ Playing ──win cond met──▶ Won
                   │
                   ├── fail cond met ────▶ Lost
                   └── (pause is orthogonal; the existing pause just freezes dt)
Won/Lost ──retry──▶ Ready ──start──▶ Playing      # reset() re-seeds the sim+tracker
```

- `Ready` — a start overlay on `/play`: level name, objective summary ("Deliver
  6 trains · keep the crossings clear"), best time / stars earned, a **Start**
  button. (The router already has `/play`; this is an overlay, not a new route.)
- `Playing` — HUD live (§8). Pause/speed already exist and are orthogonal.
- `Won` — end overlay: time taken, **stars earned** (3 icons, lit/unlit),
  "delivered N/N, 0 incidents, longest car wait 7s", **Retry** / (later) **Next**.
- `Lost` — end overlay: the **reason** ("Train crash at 4,2" / "A car was stuck on
  the crossing" / "Time ran out"), **Retry**.

`reset()` must restore determinism: re-create the sim and road-sim from the same
seed (the colour assignment is already seeded — `utils/colorAssignment.ts`), so
Retry is a true do-over. This is the one place we must be careful that nothing
non-reset leaks (e.g. the road-sim's internal `spawnClock`/`nextId`). Cleanest:
`reset()` rebuilds the sub-sims rather than mutating them — `PlayView` already
constructs them once, so we lift that into a `game.reset()`.

---

## 6. The crossing as a scored mechanic (the fresh-work payoff)

This is the part that's *new* relative to the Jun-5 brainstorm and the reason to do
this slice now. Today (`road.ts` + `game.ts`):

- a crossing tile closes when `sim.reservedBy(id) || sim.occupiedBy(id)` (passed
  into `roadSim.step` as the `CrossingClosed` predicate);
- cars stop short of a closed crossing and pack with `CAR_GAP` spacing;
- **nothing is recorded** — no waits, no incidents, no throughput.

We add three deterministic measurements in/around `road.ts`, surfaced as a small
`RoadFrame`, and let the objective tracker turn them into score + fail:

### 6.1 Car patience (throughput score) — the calm, no-crash axis

Each `Car` gains a `waitedSec` accumulator: in `advance()`, when a car's permitted
movement is gated to ~0 by a **closed crossing** specifically (distinguish "stopped
by a closed crossing ahead" from "stopped behind another car" — `clearAhead`
already computes both constraints; return which one bound the car), add `dt` to
`waitedSec`; reset toward 0 once moving freely.

`RoadFrame` reports `maxCarWaitSec` (the worst current wait) and a cumulative
`carWaitTotalSec`. The tracker uses them for:

- a **star**: "no car waited more than N s" (smooth gate timing);
- an optional **fail**: `fail.maxCarWaitSec` exceeded (a gridlocked crossing).

This is the Mini-Metro-ish, **no-crash identity** (open question Q3): you never
crash, but you can *choke the roads*. Calm but with real pressure.

### 6.2 Crossing incident (the stakes axis) — opt-in crashes

The brainstorm's Q3 ("can trains crash, or only stall?") and 2.3's open question
("managed or automatic crossing?") meet here. Two variants, shipped behind a
config/spec flag so the default stays safe:

- **Automatic crossing (default):** the gate closes off the train reservation, as
  today. The only *failure* possible is a car physically still on the crossing tile
  when a train enters it. Today that "can't happen" because the gate closes when the
  block is *reserved* (ahead of the train arriving) and cars never enter a closed
  tile. So in the default model an incident is genuinely impossible — which is fine:
  the default stays crash-free, and the crossing is scored only on patience (§6.1).

- **Managed crossing (opt-in, the "crossing game" fantasy):** the player controls
  the gate (click to lower/raise), the **automatic interlock is off**, and a train
  entering a crossing tile while a car occupies it is a **crash incident** →
  `crossingIncident` event → `Lost` (if `fail.onCrossingIncident`). This is where
  the drama and the "avoid an incident" star live. It reuses the existing occupancy
  data: the road-sim already tracks car body tiles (`bodyTileIds`), and the sim
  already knows when a train is on a tile (`occupiedBy`) — the incident is "train on
  tile X while a car body covers tile X, gate up." We emit it from the road-sim step
  (it has both the car positions and, via the `closed` predicate, train presence)
  rather than threading car state into `simulation.ts`.

Decision for this slice: **build the default (automatic, patience-scored) crossing
first** — it's the safe, deterministic, no-new-failure-mode path and immediately
gives the crossing a score. **Gate the managed/crash variant behind a spec flag**
and a `/test` scenario, landing it as a second commit so we can eyeball the drama
before it can ever affect a default game. This keeps the "you can't crash" identity
as the default while making stakes *available* per level — the hybrid the open
questions leaned toward.

### 6.3 Throughput counter

`RoadFrame` also reports `carsDelivered` (incremented when a car despawns at a map
edge having crossed ≥1 crossing — `road.ts` already despawns at edges; add a
"crossed a crossing" flag on the car so we only count cars that actually used one).
Feeds a "let N cars through" optional objective and the end-screen summary. Cheap;
makes the road feel *accounted for*.

---

## 7. Win / lose / star ratings

**Win:** `delivered >= deliveriesRequired` and no fail condition has fired.

**Lose:** any enabled `fail.*` predicate true (crash, crossing incident, a car
exceeding `maxCarWaitSec`, or `timeLimitSec` elapsing with `onTimeout`).

**Stars (up to 3, evaluated at win)** — pure predicates over tracked counters, a
catalogue the level/author picks from (doc 01 §1.3):

| Star | Predicate (all from tracked counters) |
|------|----------------------------------------|
| Speedrun | `elapsedSec <= spec.starTime` |
| Smooth operator | `maxCarWaitSec <= N` (no car waited > N s) |
| Hands off | `manualHolds === 0 && manualGreens === 0` (no signal overrides) |
| Flawless | `incidents === 0` (managed-crossing levels) |
| Perfect colours | `mismatchedArrivals === 0` (no depot bounces) |

`manualHolds`/`manualGreens` are observable from the existing
`toggleHold`/`forceProceed` controls (surface a counter or emit an event).
`mismatchedArrivals` = count of `arrived` events with `matched === false`
(bounces). Best stars + best time are persisted per level id in `localStorage`
(same place `levelStore.ts` lives), shown on the start overlay.

**Counters the tracker maintains** (the complete list, so the star/fail predicates
are unambiguous): `delivered`, `mismatchedArrivals`, `elapsedSec`, `timeLeftSec?`,
`incidents`, `maxCarWaitSec`, `carWaitTotalSec`, `carsDelivered`, `manualHolds`,
`manualGreens`, `phase`.

---

## 8. UI / HUD

`PlayView.vue` already has a polished score-card (pulse on delivery, complete
banner). We **extend it**, not replace it:

- **Top HUD bar:** deliveries `N/M` (existing), a **timer** (counts up, or down if
  `timeLimitSec`), and a compact **crossing-flow** indicator (e.g. a small road
  icon that goes amber/red as `maxCarWaitSec` climbs — the live tension readout).
- **Start overlay (`Ready`):** objective summary + best time/stars + Start.
- **End overlay (`Won`/`Lost`):** stars (3 icons), time, the one-line summary, and
  Retry. Lost shows the reason string.
- Reuse the existing score-card animations; the overlays are simple absolutely-
  positioned panels (the project already does this with the complete banner).

All overlay state comes from `tracker.state().phase` and counters — the view stays
a pure projection. No game logic in the component.

### Optional juice hooks (thin, this slice)

A single `emitJuice(kind)` call at the four moments that want it later —
`delivery`, `win`, `lose`, `crossingIncident` — wired to a no-op-safe emitter.
The actual sound/particles are the later juice pass; we only place the hooks so
that pass is a pure addition. (Skip entirely if it adds noise; it's a nicety.)

---

## 9. Sim / road changes required

Small, additive, and each independently testable:

1. **`road.ts`** — add `waitedSec` + a `crossedCrossing` flag to `Car`; have
   `advance()`/`clearAhead()` report the *binding constraint* (closed-crossing vs.
   car-ahead) so we attribute waits correctly; expose a `frame()` →
   `{ maxCarWaitSec, carWaitTotalSec, carsDelivered, incidents }` (incidents only
   in the managed variant). Pure; unit-tested against scripted layouts.
2. **`simulation.ts` / events** — add a `"crossingIncident"` `SimEvent` (managed
   variant) and surface `manualHolds`/`manualGreens` counters (or emit events for
   them). The `arrived{matched}` event we already have covers deliveries + bounces.
3. **`objectives.ts`** (new) — the tracker (§3). The bulk of the new, well-isolated
   logic and the bulk of the new tests.
4. **`game.ts`** — build `RoadFrame` each tick, drive the tracker, expose reactive
   state, add `reset()` that rebuilds the sub-sims deterministically.
5. **`PlayView.vue`** — HUD + overlays (§8), all read-only projections.

No change to train movement, signaling, or the road traversal graph.

---

## 10. Testing strategy

Mirrors what already works in this repo (107+ unit tests, deterministic sim):

- **`tests/unit/sim/objectives.spec.ts`** — drive the tracker with synthetic
  event/road-frame streams: win on N deliveries; lose on each fail predicate; each
  star predicate true/false at the boundary; `reset()` clears all counters and
  phase. No DOM.
- **`road.ts` patience tests** — scripted layout with a crossing; assert
  `waitedSec` accrues only while gated by the *crossing* (not by a car ahead) and
  resets when moving; `carsDelivered` counts only crossing-users.
- **Managed-crossing incident test** — a car on the crossing tile + a train on it
  with the gate up emits exactly one `crossingIncident`.
- **`/test` scenarios** (the project now *requires* one per feature — commit
  `763b5c7`): add `objectives` (a tiny board that can be won and lost) and
  `crossing-incident` (the managed variant) scenarios to the registry.
- **e2e smoke** — extend the Playwright check: start a level, run it to a win, the
  Won overlay appears; (managed scenario) force an incident, the Lost overlay
  appears with a reason. Uses the existing `window.__game` hook.

Verification gate before each commit (working-style memory): `npm run build` +
`npm run test:unit` green.

---

## 11. Phasing (each a shippable, committed step)

1. **Objective tracker + default win loop** — `objectives.ts`, fold `deliveries`
   into it, win/`Won` overlay, timer (count-up). No fail, no stars yet. The current
   default board now has a real *win* with a time. *(M)*
2. **Lose + start/end overlays + state machine** — `Ready/Playing/Won/Lost`,
   `reset()`/Retry, `onTimeout` fail. *(M)*
3. **Crossing patience scoring** — `road.ts` `waitedSec`/`frame()`, the live
   crossing-flow HUD indicator, the "Smooth operator" star, optional
   `maxCarWaitSec` fail. The crossing now *matters* in the default (no-crash) game.
   *(M)*
4. **Star ratings + localStorage bests** — the full star catalogue (§7),
   persistence, start-overlay display. *(M, mostly once 1–3 land.)*
5. **Managed crossing + incident (opt-in)** — the crash variant behind a spec flag
   + `/test` scenario; "Flawless" star; `onCrossingIncident` fail. Lands last so
   the default stays crash-free until reviewed. *(M)*

Stop after any step and the game is strictly better than today. Steps 1–4 are the
calm "no-crash" game; step 5 unlocks stakes per level.

---

## 12. Open questions for tomorrow (decide before / during step 5)

1. **Identity (Q3 from `99-open-questions.md`):** is crash-as-fail in scope at all,
   or do we stay strictly "you can only choke, never crash"? This design keeps
   crash **opt-in per level** (default off) — confirm that's the intent, or cut
   step 5 entirely.
2. **Managed vs. automatic crossing (Q2.3):** the design ships **automatic
   (patience-scored) as default** and **managed (player-gated, crash-capable) as
   opt-in**. Is manual gate control fun enough to build, or do we keep crossings
   fully automatic and score only patience? (If the latter, drop the managed
   variant and §6.2's incident path — simpler.)
3. **Where do objectives live for now?** Ship with **per-level specs + a global
   default** (this design), or hardcode one objective on the default board for step
   1 and add the data layer later? (I lean: data layer from the start — it's
   cheap and unblocks the editor/procgen authoring.)
4. **Timer default:** count-**up** (untimed, just measured for the Speedrun star)
   or introduce a **count-down limit** on the default board? I lean count-up by
   default (untimed stays the calm default), limits opt-in per level.
5. **Next slice after this:** **Stations (2.4)** to open the network/cargo/Endless
   direction, or **terrain/obstacles + bridges (2.7/2.2)** for the "place" feel the
   original prompt asked about? Stakes-first (this doc) makes either one land into a
   game instead of a toy.

---

## Internal references

- `docs/brainstorm/01-objectives-and-game-modes.md`, `…/02-…`, `…/04-…`,
  `…/99-open-questions.md` — the source brainstorm this deepens.
- `src/sim/road.ts` — the car-sim this slice instruments (patience, incidents).
- `src/game.ts` — `deliveries`, `handleEvents`, `roadSim` wiring, the rAF loop.
- `src/sim/simulation.ts` — `SimEvent` (`arrived{matched}`, `reserved`, `blocked`,
  `proceeding`); `reservedBy`/`occupiedBy`/`toggleHold`/`forceProceed`.
- `src/views/PlayView.vue` — the score-card the HUD/overlays extend.
- `src/levelStore.ts`, `src/utils/colorAssignment.ts` — level persistence + seeded
  colours (needed for a deterministic `reset()`).
- `docs/signaling-design.md` — signaling phases (interlocking already in).
</content>
