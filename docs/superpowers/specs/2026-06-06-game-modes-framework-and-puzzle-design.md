# Game modes as features: the `GameMode` framework + Puzzle/Dispatcher mode — design

**Status:** Draft for review (2026-06-06). On branch `spec/stakes-crossing-scoring`
(off `develop`). Supersedes the framing of
`2026-06-06-stakes-and-crossing-scoring-design.md`: that spec's objective tracker
becomes the **shared core** every mode reuses, and its crossing-scoring moves into a
future **Crossing Keeper** mode (§7). No implementation started.

---

## 1. Goal & the decision already made

The same headless simulation can host very different games — what changes between
"games" is the **objective**, the **failure pressure**, the **spawning**, and **what
the player may touch**. We want **game modes to be first-class, pluggable features**:
a menu of distinct modes, each with its own goal and handling, all layered on the
*unchanged* sim.

Decision (user, 2026-06-06): build the **`GameMode` framework** and **Puzzle /
Dispatcher** as the first registered mode, together. Puzzle needs **zero new sim
mechanics**, so the work is the framework + an objective layer — and it turns the
half-built delivery loop into a genuinely playable game.

### Reference games → why modes (the analysis behind this)

| Game | Core verb | Win / lose | Maps to our mode |
|---|---|---|---|
| Railbound | Route limited pieces so numbered carriages couple in order | Discrete per-level solve; one mechanic per world | **Puzzle** |
| Train Valley 2 | Hand levels, **5-star** (2 task + 3 time stars) | Complete; stars are the game | **Puzzle** + stars |
| Train Valley 1 | Real-time route trains that **keep spawning**, avoid pile-up/crash | Survive era / hit count | **Time Attack** |
| Mini Metro | Keep network flowing; demand **spawns** & accumulates | Normal=overflow loss · Endless=can't lose · Extreme=pieces lock · Creative=free | **Endless** (+ modifiers, **Sandbox**) |
| OpenTTD | Sandbox; goals **player-set / scripted**; score→1000 | No fixed win; a *game script* defines it | **Sandbox** + scripted objective |

The throughline (and the architecture): an objective is just a **script over the sim
event stream** (OpenTTD's "game script" is literally this). So a mode = a script +
some setup + some enabled controls.

---

## 2. The `GameMode` abstraction

A mode is a bundle of **five swappable parts**, all reading/observing the one
headless sim:

```ts
// src/modes/types.ts
export interface GameMode {
  id: string;                       // "puzzle" | "crossing-keeper" | …
  label: string;
  description: string;

  // 1. Board source — where the level + trains come from.
  setup(ctx: ModeContext): ModeSetup;        // fixed level id | procgen seed | editor handoff
                                             // + train defs + (later) spawner config

  // 2. Enabled controls — what the player may interact with this mode.
  controls: ModeControls;                    // { switches, signalHolds, crossingGate, build }

  // 3. Objective tracker — win/lose + scoring + stars. The shared core (§3).
  createObjective(setup: ModeSetup): ObjectiveTracker;

  // 4. Spawner (optional) — trains or demand fed into the sim over time.
  createSpawner?(setup: ModeSetup): Spawner;  // Puzzle: none. Time Attack/Endless: yes.

  // 5. HUD descriptor — which readouts/overlays the view shows.
  hud: HudDescriptor;                         // deliveries? timer? flow meter? queues?
}
```

- **Pure where it can be.** `createObjective` / `createSpawner` return headless,
  deterministic, unit-tested objects (driven by the sim's scaled `dt`, no
  `Date.now()`) — same discipline as `src/sim/*`.
- **The sim never knows about modes.** `simulation.ts` and `road.ts` stay
  mode-agnostic; modes only *observe* events and *gate/enable* existing controls.
- **Registry + select.** `src/modes/index.ts` exports a `MODES` registry (mirrors the
  `/test` `SCENARIOS` registry pattern). A mode-select screen (or a route arg) picks
  one; `game.ts` wires the chosen mode's parts into the loop.

### Where it sits (no churn to the sim/renderer split)

```
src/modes/
  types.ts            # GameMode, ModeControls, HudDescriptor, ObjectiveTracker, Spawner
  index.ts            # MODES registry (picker order)
  puzzle.ts           # the first mode (this spec)
  (crossing-keeper.ts, time-attack.ts, … later)
src/sim/objectives.ts # shared ObjectiveTracker core (from yesterday's spec)
```

`game.ts` already owns the sim + road-sim + rAF loop and exposes reactive refs. It
gains: hold a `mode: GameMode`, build the per-tick observation, drive
`mode` objective/spawner, expose `mode.hud` + tracker state reactively, and a
`reset()` that rebuilds deterministically. `PlayView.vue` renders the HUD/overlays
the mode's `hud` descriptor asks for — a pure projection.

### Per-tick data flow (mode-driven)

```
loop(dt):
  spawner?.step(dt) -> may inject trains/demand into sim         # Puzzle: no-op
  events = sim.step(scaled)
  roadSim.step(scaled, closed)
  obs = collectObservation(events, roadFrame)                    # shared shape
  tracker.observe(obs, scaled)                                   # win/lose/score
  expose tracker.state() reactively; render HUD per mode.hud
```

---

## 3. The shared objective tracker (reused by every mode)

Unchanged from `2026-06-06-stakes-and-crossing-scoring-design.md` §3/§5/§7 — promoted
here to **the shared core**:

```ts
// src/sim/objectives.ts
createObjectiveTracker(spec) -> {
  observe(obs: Observation, dt): void
  state(): ObjectiveState          // phase, delivered, elapsedSec, stars, counters…
  reset(): void
}
```

- Phase machine: `Ready → Playing → Won | Lost`, `reset()` for Retry.
- Counters: `delivered`, `mismatchedArrivals`, `elapsedSec`, `timeLeftSec?`,
  `manualHolds`, `manualGreens`, (+ crossing counters when a mode supplies them).
- Win/lose/stars are **pure predicates** over those counters — i.e. the "game
  script." Puzzle picks one preset; other modes pick others.

This is why building Puzzle also delivers ~90% of the stakes loop: the tracker is the
reusable engine.

---

## 4. Puzzle / Dispatcher — the first mode (concrete)

**Fantasy.** A fixed board. Every train must reach its **matching-colour depot**.
You dispatch — flip switches and hold/release signals — to route them all home
without bouncing or deadlocking. Stars reward mastery. (Railbound / Train Valley 2.)

- **Board source:** a fixed `Level` + `TrainsDefinition` (today's default board, plus
  a couple of hand-made puzzle boards and the `/test` `objectives` scenario). Colours
  must be **solvable, not random** — pin depot/train colours via the existing seeded
  `colorAssignment.ts` so a solution exists.
- **Controls enabled:** `switches`, `signalHolds`. **Disabled:** build/edit, crossing
  gate (crossings, if present, stay automatic here).
- **Objective spec (preset):**
  - **Win:** `delivered >= trainCount` (every train colour-matched home).
  - **Lose (opt-in per board):** `onTimeout` if the board sets `timeLimitSec`; default
    untimed (calm). No crashes in Puzzle (interlock on) — you can only stall, and a
    stall is the puzzle to solve, not a loss.
  - **Stars (up to 3, from the catalogue):** *Speedrun* (`elapsedSec ≤ starTime`),
    *Hands off* (`manualHolds + manualGreens == 0`), *Perfect colours*
    (`mismatchedArrivals == 0`, i.e. no depot bounces). Boards with a crossing may
    swap in *Smooth operator* (no car waited > N s) once the crossing flow counter
    exists.
- **Spawner:** none. The train set is fixed (Puzzle is a closed system).
- **HUD:** deliveries `N/M` (exists), count-up timer, 3 star pips that light as their
  predicate holds. Start overlay (objective + best stars/time + Start), end overlay
  (Won: stars/time/Retry/Next · Lost: reason/Retry).

**Why it's the right first mode:** no new sim behaviour, it exercises every part of
the framework (setup, controls, objective, hud) except the optional spawner, and it
makes the existing board a *game* you can win, lose (on a timed board), and 3-star.

---

## 5. Phasing (each shippable + committed)

1. **Framework skeleton + Puzzle win loop.** `modes/types.ts`, `modes/index.ts`,
   `modes/puzzle.ts`; `objectives.ts` tracker; `game.ts` holds a mode and drives the
   tracker; fold the existing `deliveries` counter in; **Won** overlay + count-up
   timer on the default board. *(M)*
2. **Lose + start/end overlays + Retry.** Phase machine surfaced, `reset()`
   deterministic rebuild, `onTimeout` for timed boards. *(M)*
3. **Stars + localStorage bests.** The 3 Puzzle stars, persistence keyed by level id,
   shown on the start overlay. *(M)*
4. **Mode-select scaffold.** A minimal picker/route arg that selects from `MODES`
   (only Puzzle + Sandbox registered for now) — proves the registry and unblocks
   adding Crossing Keeper next without rework. *(S)*

Stop after any step and the game is strictly better than today.

---

## 6. Testing

- `tests/unit/sim/objectives.spec.ts` — win on N deliveries; lose on `onTimeout`;
  each Puzzle star true/false at its boundary; `reset()` clears phase + counters.
- `tests/unit/modes/puzzle.spec.ts` — the mode wires the right preset: controls,
  spec, hud descriptor; setup produces a solvable colour assignment.
- `/test` scenarios (project rule — one per feature): `objectives` (a tiny board that
  can be won, and lost on a timer) registered in `SCENARIOS`.
- e2e smoke (extend existing): start the default board, run to a win, **Won** overlay
  appears (via `window.__game`).
- Gate before each commit: `npm run build` + `npm run test:unit` green.

---

## 7. The rest of the mode menu (roadmap — each a later plug-in)

Built on the *same* framework; listed so the abstraction is sized for them:

- **Sandbox / Creative** — `controls: { build: true }`, no objective (`phase` stays
  Playing), no fail. ~Free: it's the editor + free play wrapped as a mode. Register
  alongside Puzzle in step 4.
- **Crossing Keeper** — controls `{ crossingGate: true }`; objective scores road
  throughput − car wait, fail on a crossing incident; **uses the crossing-scoring
  from the stakes spec** (`waitedSec`/`RoadFrame`/`crossingIncident`). Small, novel,
  cashes in the road work. *Recommended second mode.*
- **Time Attack / Rush** — adds a `createSpawner` that injects trains on a rising
  cadence; depots gain a backlog queue; fail on overflow. Reuses the road spawner
  pattern. *(M new sim.)*
- **Endless / Network** — `createSpawner` of demand at **stations** (needs the
  stations + cargo/passenger model first); overflow loss; rising difficulty. *The
  headliner, gated on stations. (L.)*
- **Daily / Score Challenge** — `setup` from a date→seed via `generate.ts`; wraps any
  scored mode; best score to localStorage. *(S once one scored mode + procgen.)*

Modifiers (toggles on a mode, not modes): **Extreme** (lock placements),
**no-signals**, **timed**.

---

## 8. Open questions

1. **Mode-select surfacing:** a dedicated `/modes` route + screen, or a dropdown on
   `/play`, or a query arg (`/play?mode=puzzle`) for now? (I lean: query arg in step
   4, a real screen when there are ≥3 modes.)
2. **Puzzle board content:** ship Puzzle on the **existing default board** only at
   first, or author 2–3 small hand-made puzzle boards up front? (I lean: default
   board for steps 1–3, author boards in a follow-up — content, not engineering.)
3. **Limited interventions (Railbound flavour):** do we cap switch flips / holds per
   board as an extra Puzzle constraint, or keep dispatch unlimited and let stars
   (Hands off) carry that role? (I lean: stars first; a hard cap is an opt-in board
   setting later.)
4. **Does Puzzle ever allow crashes?** This spec says no (interlock on, stall-only).
   Crashes live in Crossing Keeper / a future modifier. Confirm.
5. **Second mode confirm:** Crossing Keeper next (recommended), or jump to Time
   Attack for the spawner/queue machinery sooner?

---

## Internal references

- `2026-06-06-stakes-and-crossing-scoring-design.md` — the objective-tracker core +
  crossing-scoring this reframes into modes.
- `docs/brainstorm/01-…` (§1.4 three modes), `…/03-…` (spawning demand/cargo),
  `…/99-open-questions.md` (puzzle-vs-management fork).
- `src/game.ts`, `src/sim/simulation.ts` (`SimEvent`), `src/sim/road.ts`,
  `src/views/PlayView.vue`, `src/levels/test/index.ts` (registry pattern),
  `src/utils/colorAssignment.ts` (seeded solvable colours).

---

## Research sources

- Mini Metro modes (Normal/Endless/Extreme/Creative): https://mini-metro.fandom.com/wiki/Game_Mode
- Train Valley 2 five-star (task vs time) objectives: https://en.wikipedia.org/wiki/Train_Valley_2
- Railbound limited-pieces / order-carriages / one-mechanic-per-world: https://en.wikipedia.org/wiki/Railbound
- OpenTTD sandbox + game-script goals + score-to-1000: https://wiki.openttd.org/en/Manual/Game%20script
</content>
