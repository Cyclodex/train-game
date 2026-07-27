# Handoff: what is left in the Tycoon mode

For an agent picking this up with **no memory of how it got here** — a fresh
cloud session, say. Current as of `master` @ 2026-07-28.

Each numbered item in §3 is written to be started **on its own**: read §1 and §2,
then take one item and go. They are ordered by what unblocks the most, not by
size.

---

## 1. Read first

- **`CLAUDE.md`** — architecture and conventions. The short version: an
  authoritative headless simulation (`src/sim/*`, no Vue/DOM, deterministic
  `step(dt)`) and a thin renderer (Vue + a rAF loop in `src/game.ts`). Tiles are
  data; everything derives from `connections`.
- **`docs/KNOWHOW.md`** — the engineering canon. Dense, and it is where the traps
  live. **Read the sections named in your item before writing code.** Keeping it
  current is part of every task: if you learn, fix or disprove something there,
  edit it in the same commit.
- **`docs/superpowers/specs/2026-07-25-train-valley-mode-design.md`** §8 — the
  status of this mode, mechanic by mechanic (M1–M14), and the ordered remainder.
- **`docs/superpowers/specs/2026-07-27-campaign-and-levels-design.md`** — the
  parity list beyond a single level (Part A) and eight designed levels (Part B).

### Ground rules

- **Every feature ships a `/test` scenario** (`src/levels/test/`), registered in
  the `DOMAINS` tree. The registry test validates every map, so a broken one
  fails CI. The exception is anything that only exists on `/play`: `TestStage`
  renders no start/end overlay and calls `startObjective()` in `mounted()`, so
  the Ready card, the campaign and any coach-mark **cannot** appear there. Say so
  explicitly rather than adding a scenario that shows nothing.
- **Visual change ⇒ a screenshot**, before/after into `docs/verify/<topic>/`.
- **No AI attribution in commit messages** (`KNOWHOW` → WORKFLOW).
- Commit your scoped change as soon as it is done and green. Other sessions edit
  this repo in parallel — stage your own files, never `git add -A` blindly.

### Verification, in order

```bash
npm run build          # vue-tsc + vite — the real gate; dev and shot do NOT type-check
npm run test:unit      # 1827 tests today
npm run browsers       # ONCE per machine, before e2e or shot (never npx playwright install)
npm run test:e2e       # 29 tests today
npm run probe          # render-level audit of every /test scenario — after ANY renderer change
npm run shot -- <id> --label after            # a /test scenario
npm run shot -- '#/play?mode=tycoon&board=x'  # any route, for /play chrome
```

### Traps that have already cost someone a night

- **`npm run shot` runs with debug ON**, and the reservation tint is opaque over
  ground art. Use `--no-debug` to judge anything painted below the rails, or the
  after-shot looks identical to the before-shot.
- **A class getter is a cached computed** (vue-facing-decorator). Anything reading
  a non-reactive source — `$refs`, `localStorage`, `window.*` — must be a method
  or a plain field, or it freezes at its first value.
- **Several files are CRLF** (`PlayView.vue`, `KNOWHOW.md`). A multi-line search
  string with `\n` will not match. After editing, compare `git diff --stat` with
  `git diff --stat -w`; if they disagree you have normalised the file.
- **`String.replace()` eats `$$`** in the *replacement* string. Scripted edits
  over source containing `` `$${x}` `` silently drop a `$`. Prefer a literal-safe
  editor.
- **`shoot.mjs` refuses a port that is already serving**, because it would
  photograph another checkout's code. Pass `--port <free one>`.
- **A feature can be scaffolded but only half-wired** — state declared and read
  but never written is `undefined` at runtime and silently no-ops. `npm run dev`
  will not tell you; `npm run build` will.

---

## 2. Where the mode stands

The loop is complete and playable end to end at
`/#/play?mode=tycoon&board=lakevalley-open`: build rails for money, dispatch
waiting trains, flip switches, bank a decaying fare, pay an annual levy, go
bankrupt if you cannot.

Shipped: the economy and fare decay · dispatch-on-click · build-in-play with live
costing · bulldoze · terrain with build rules and land prices · the calendar and
annual tax · bankruptcy with a warning a year ahead · goals listed on the Ready
card · an ordered campaign with unlocks and a "Next level" exit · terrain on
generated boards.

**Not planned, deliberately** (each has a reasoned entry in the design doc):
crashes, production chains, reversing trains.

---

## 3. The open items

### 3.1 Coach-marks / a teaching system · **M** · start here

**We have no tutorial mechanism at all.** Level 1 of the campaign introduces
build, dispatch and switch simultaneously and explains none of them. With the
campaign in place, this is what stands between "three boards in a list" and a
game that teaches you to play it.

Train Valley pins a short hint to the thing it is talking about — *"Zug wartet.
Per Klick losschicken."* over a waiting train, *"Vollende das Schienennetz…"*
over the gap. That anchoring is the whole idea: a hint in a corner is a manual, a
hint on the object is a lesson.

- **Where.** A new component plus a per-board hint list. Key the list by board id
  the way `TycoonTuning` does (`tuningFor` / `boardIdOf` in `src/modes/tycoon.ts`)
  — that indirection already exists and both `/play` and `/test` resolve through it.
- **The precedent to copy.** `src/components/FarePin.vue` is already a bubble
  pinned over a board object and positioned by the game loop. A coach-mark is the
  same problem.
- **Design decisions to make (and record):** what triggers a hint (phase, a
  counter, a tile becoming visible), what dismisses it (doing the thing — not a
  close button), and whether a dismissed hint stays dismissed across a Retry.
  Suggested: dismiss on the action, and do not repeat within a run.
- **Traps.** Every mode's `hud` shape is asserted in `tests/unit/modes/*.spec.ts`
  (five of them), so adding a `HudDescriptor` field means updating all five —
  consider whether you need one at all. This is `/play`-only (see §1), so no
  `/test` scenario.
- **Done when** a hint appears over the waiting train on `lakevalley-open`,
  disappears when the player sends it, an e2e asserts both, and a screenshot is
  in `docs/verify/`.

### 3.2 Explicit destinations + a destination badge · **S–M**

Today the simulation parks a train in **any** colour-matching depot
(`simulation.ts`: `depotColors[tileId] === train.color`). `TrainDef.destinations`
exists and already prices the fare, but the sim ignores it. Two consequences: a
board cannot have two depots of one colour, and a player cannot see where a train
is going.

- **Where.** The arrival check in `src/sim/simulation.ts`; the badge under the
  fare pin in `src/components/FarePin.vue`.
- **Keep colour as the visual encoding** — `utils/colorAssignment.ts` guarantees a
  solvable assignment (`matchHomeDepots`, Kuhn's) and that guarantee is
  load-bearing. This item makes the *destination* authoritative, not the colour
  scheme redundant.
- **Done when** a train only counts at its named depot, the badge shows which,
  and the existing colour-assignment tests still pass.

### 3.3 The briefing screen (M11) · **M**

Train Valley shows a greyscale map of the level with a coloured line from each
origin to its destination and the fare on each — a *plan of the demand*, shown
before you start.

- **Where.** `src/levels/test/thumb.ts` + `src/components/ScenarioThumb.vue`
  already render a sim-free map of any board. That is the renderer; this item is
  the overlay around it.
- **Interaction with the Ready card**, which now lists the goals: decide whether
  the briefing replaces it, precedes it, or is a panel inside it. Recommend
  inside — one screen before the level, not two.
- **Done when** `lakevalley-open` opens with a readable plan of its three
  demands, plus a screenshot.

### 3.4 Green plots, clearing scenery, and the gap hint · **M**

The remains of phase 3. The *prices* already exist — `TERRAIN_BUILD_FACTOR` in
`src/tiles/terrain.ts` (the per-ground build surcharge, applied in `game.ts`) and
`CLEARING_COST_PER_TILE` in `src/sim/economy.ts` — what is missing is the reading
and the verbs:

- a **green buildable mask** — Train Valley marks where you may build, we only
  refuse where you may not;
- **clearing scenery** as an action with a price (forest and town are buildable
  but should cost to clear);
- the **dashed "close this gap" hint** — today a gap is visible only as absent
  rails.

### 3.5 Bridges · **M–L** · the only engine work the level arc needs

A `bridge` role carrying **two independent port pairs** on one cell, so road can
cross rail (or rail cross water) without a level crossing. The connection model
already supports two non-interacting pairs; design it as an *exception inside
`canBuildOn`*, not as a second rule beside it.

This is what level 7 of the designed arc ("The Bypass" — cross the road, or fly
over it) needs, and nothing else in the arc does.

### 3.6 Player-called extra trains (M10) · **M**

A button that spends money and pays a premium. The `Spawner` contract exists
(Time Attack uses it) and `game.ts` can inject a train mid-run.

**The constraint:** `PlayView` renders `<Train v-for="t in trains">` from a fixed
list resolved at setup, so genuinely dynamic sprites are an *L*. A **pre-declared
pool** — say twenty trains, hidden until called — is the cheap path and is enough
for a campaign level. Take that first.

### 3.7 The road layer joins the economy · **M–L** · the differentiator

Neither Train Valley game simulates road traffic; ours does. Where rail meets
road the player should choose: a **level crossing** (cheap, but every closure
queues cars) or a **bridge** (expensive, no interaction), with congestion costing
money.

The counters already exist and are already scored by Crossing Keeper —
`maxCarWaitSec`, `carsDelivered` on `Counters`. A cheap first step that needs no
new engine work at all: make a Tycoon **star** read `maxCarWaitSec`, so the fast
route through town costs you a star. See level 5 of the designed arc.

### 3.8 The eight campaign levels · content, not engine

`docs/superpowers/specs/2026-07-27-campaign-and-levels-design.md` Part B designs
eight levels — board, gap, budget, trains, three stars and a session length each.
**Seven of the eight need no engine work**; only "The Bypass" waits on §3.5.

The campaign currently seeds three existing boards as placeholders
(`src/campaign.ts`): `objectives` → `buildgap` → `lakevalley-open`. Swapping in
real levels is a one-array edit.

**The rule that seeding taught, do not skip it:** the unlock chain means an
unwinnable level is a wall across the whole campaign. Every seeded board must be
*measured* winnable — two obvious-looking candidates (`dispatch`,
`faredistance`) turned out to be shuttle demos whose second train bounces off a
mismatched depot forever.

### 3.9 Smaller, whenever

- **Sound** — none at all today. Disproportionate effect on whether it feels
  finished.
- **Per-level variety** — `worldTheme` and procedural rolling stock both exist;
  nothing drives them per level, so eight levels risk reading as one level eight
  times.
- **A procedural Tycoon board** — the generator now paints terrain, so what
  remains is a `TycoonTuning` entry that accepts a generated level. That is the
  long-tail answer: a new board every day, forever.
- **`demoworld` paints no terrain**, so `/play`'s demo board is still bare grass.
- **`TRACK_COST_PER_TILE` is a global $1,000.** A per-board cost is the most
  obvious missing level-design dial.

---

## 4. If you only do one thing

§3.1. The campaign made the game finishable; the teaching is what makes it
learnable, and every level in Part B assumes a player who was taught the verbs in
level 1.
