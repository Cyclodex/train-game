# Campaign and levels — what parity still needs, and eight designed levels

**Date:** 2026-07-27 · **Status:** design, nothing implemented
**Companion to:** `2026-07-25-train-valley-mode-design.md` (§8 status, §9 progression rules)

Two parts:

- **Part A** finishes the parity question. §8's scorecard covers the fourteen
  mechanics read off Train Valley's *level 1*. This extends it to the whole
  *game* — the layer a campaign needs that a single level never shows.
- **Part B** turns §9's eight-level sketch into designs you could build from.

> **Every number in Part B is a hypothesis.** The mode's own numbers were all
> corrected by measurement in a real browser — §8 honourably records both guesses
> for the tax year and both for the levy. Treat the budgets and star targets here
> the same way: the geometry and the intent are the design, the numbers are the
> starting point for the same measure-and-correct loop.

---

## Part A — what is still missing

### A1. The §8 scorecard holds up

Spot-checked against the code rather than taken on trust:

| Claim | Verified |
|---|---|
| `TRACK_COST_PER_TILE = 1000` | `sim/economy.ts:54` ✓ |
| Per-board tuning `{ startingBalance, fareGrace, stars, calendar? }`, keyed by the levelId tail | `modes/tycoon.ts` `TycoonTuning`, `tuningFor`, `boardIdOf` ✓ |
| `CalendarSetup { startYear, secPerYear, taxPerTrackPiecePerYear }` | `sim/calendar.ts:26` ✓ |
| `Counters` carry `balance` / `earned` / `spent` / `tilesBuilt` | `sim/objectives.ts:39-45` ✓ |
| Dispatch-on-click is opt-in per board | `SimConfig.waitForDispatch` ✓ |
| The sim parks in *any* colour-matching depot (M6 partial) | `simulation.ts` — `depotColors[tileId] === train.color` ✓ |

No corrections needed. The scorecard is accurate.

### A2. Beyond the fourteen mechanics

The M-list was read off screenshots of one level, so it describes what a *level*
needs. A *campaign* needs six more things, and five of them are not on any list
yet:

1. **The campaign shell.** An ordered level list, an unlock rule, the "Finish →
   next" exit M12 wants, and a running star total. `objectiveStore` already
   persists a per-level best, so this is an index and a screen. **Without it
   there is no game, only boards** — and it is the single largest remaining gap.
2. **The briefing screen** (M11). Already tracked in §8's list.
3. **A teaching system.** Train Valley pins coach-marks to the thing they talk
   about — *"Zug wartet. Per Klick losschicken."*, *"Vollende das Schienennetz…"*.
   We have **no tutorial mechanism at all**. A first level that introduces build,
   dispatch and switch at once needs one; without it, level 1 is a puzzle players
   bounce off rather than a level they learn from. Not currently on any list.
4. **Variety across the arc.** TV changes era and rolling stock per chapter —
   novelty for free. We have `worldTheme` and procedural rolling stock, so both
   hooks exist, but nothing drives them per level. Cheap, and it is what stops
   eight levels reading as one level eight times.
5. **Sound.** TV has it; we have none. `IMPROVEMENTS.md` item 7. Disproportionate
   effect on whether a thing feels finished.
6. **The sibling modes, wired to Tycoon.** TV1 ships story *plus* random (15–20
   min, procedurally different each launch) *plus* sandbox. We have Daily and
   Sandbox, but neither runs the economy, so **there is no procedural Tycoon
   board**. This is §9's long-tail answer, and it is closer than it looks: the
   generator, the economy and the tuning indirection all exist and have simply
   never been pointed at each other. Half of it closed on 2026-07-27 — generated
   boards now paint terrain, so a procgen board is a *place* rather than a
   diagram; what remains is a Tycoon tuning entry that accepts a generated level.

### A3. Where we are already past Train Valley

Listed because a parity list read on its own implies we are behind:

path reservation and interlocking · momentum · the whole road layer · the level
editor · procedural generation · a deterministic headless sim (replays, and
server-verifiable scores later) · unbounded worlds with a camera · zero
third-party assets, all art procedural.

None of these should be traded for parity items.

### A4. The remaining list, ordered by what it unblocks

| # | Item | Size | Why here |
|---|---|---|---|
| 1 | ~~Goals on the Ready card~~ | S | **DONE** 2026-07-27 — and it turned out the HUD pip row was showing gold stars *behind* the Ready overlay, because a predicate over zeroed counters is mostly true before the run |
| 2 | ~~**Campaign shell**~~ | M | **DONE** 2026-07-27 — `src/campaign.ts`, `/campaign`, unlock chain derived from `objectiveStore`, "Next level" on the win card |
| 3 | **Coach-marks / teaching** | M | Level 1 does not work without it — now the largest remaining gap |
| 4 | Briefing screen (M11) | M | Built on `thumb.ts` |
| 5 | Explicit destinations + badge (M6/G4) | S–M | Also removes the two-same-colour-depots hazard |
| 6 | Clearing costs + green plots (M3/M4) | M | Phase 3. Land prices landed 2026-07-27 (`TERRAIN_BUILD_FACTOR`); the green-plot mask and the dashed gap hint remain |
| 7 | **Bridges** | M–L | The *only* engine work the eight-level arc needs |
| 8 | Called trains (M10) | M | Pre-declared pool; L if truly dynamic |
| 9 | Road layer joins the economy | M–L | The differentiator (§4.1) |
| 10 | ~~Terrain in `generateLevel`~~ | S–M | **DONE** 2026-07-27 — `paintTerrain`; a procedural Tycoon board is now only a tuning entry away |
| 11 | Sound | M | Finish |

**Seeding the campaign turned up a rule worth keeping.** The unlock chain means
an unwinnable level is a wall across the whole campaign, so a seed list has to be
*measured*, not assumed. Probed 2026-07-27: `dispatch` and `faredistance` each
deliver one of their two trains and then run forever (`mismatchedArrivals`
climbing — the second train bounces off a deliberately mismatched depot). They
are shuttle demos of a mechanic, not levels. The campaign therefore seeds only
boards with an e2e that reaches a win: `objectives` → `buildgap` →
`lakevalley-open`, placeholders for Part B's eight.

### A5. The finding that matters

**Seven of the eight levels below are buildable with what exists today.** Only
level 7 needs new engine work. The campaign is a *content* exercise, not an
engine one — what is missing is the shell around the levels, not the mechanics
inside them.

---

## Part B — the eight levels

### What a level is, concretely

1. A `TestScenario` — `{ id, name, description, size, level, trains, colors?,
   traffic?, allowIncomplete? }`. Tiles carry `terrain`; `expandKind(kind,
   rotation, { signals })` authors them; `mkTrain(id, x, y, type, wagons, to)`
   authors the stock.
2. A `TycoonTuning` entry in `TUNING_BY_BOARD`, keyed by the board id:
   `{ startingBalance, fareGrace, stars(maxPayout), calendar? }`.

**Not tunable per board today** (each is a small, contained addition):

- `TRACK_COST_PER_TILE` is a global $1,000. A per-board cost is the most obvious
  missing dial — "track is expensive here" is a level design, not a constant.
- The fare constants (handling 250, per-wagon 150/200, per-tile 35) are global.
- Signals are **authored only**. There is no in-play signal tool, which
  constrains level 4 below.

### The sim facts every design here respects

- **Trains route by the arms, not by pathfinding.** A train takes whatever the
  switch is set to; a wrong arm is a mismatch, not a re-route. So the difficulty
  knob is *switch decisions per minute* — and past roughly three concurrent
  trains it becomes hand speed, which is exactly the TV2 trap §9 forbids.
- **An unsignalled departure reserves the whole route to its end.** Single-track
  boards must be signalled deliberately; a signal *is* a waiting bay.
- **A train held at a signal keeps about a consist-length of stale rear
  reservation**, so short consists free tiles sooner. Level 4 turns on this.
- **A train parks in any colour-matching depot**, so two depots of one colour is
  a design hazard until item A4.5 lands. No level below uses one.
- **Fare** = 250 + wagons × (150 people / 200 freight) + 35 × Manhattan between
  the paired depots; decays to a 25% floor over `fareGrace` ideal trips, in 4s
  steps. **Distance pays** — long hauls are the prize, and they burn slower.
- **You cannot build or raze under a train.** Any level that can strand one needs
  a rescue drawable from the far side.

### The arc

Each level: 5–8 minutes, one new dial, three orthogonal stars. Nothing new after
level 7; the last two levels are combinations, not additions.

---

#### 1. The Lake — *exists as `lakevalley-open`*

| | |
|---|---|
| **Hook** | "The lake is in the way, and the south side of the ring is missing." |
| **Teaches** | Build, dispatch, switch — the four verbs at once |
| **Board** | 9×7, three stations, unbuildable lake, ring with the south run deleted |
| **Money** | $15,000 against a 7-piece/$7,000 rebuild — deliberately ~2× |
| **Stars** | Payday $1,700 · Under budget $6,000 · Rail baron 7 pieces |
| **Needs** | **Coach-marks** (A4.3). Everything else is built. |
| **Session** | ~3 min |

Already measured and e2e-covered. The one change: it currently teaches by not
explaining, which is the gap item A4.3 names.

---

#### 2. The Fork — *buildable today*

| | |
|---|---|
| **Hook** | "One line out of town, two towns to serve. The switch decides." |
| **Teaches** | The arm is the decision. Nothing else moves. |
| **Board** | ~7×5. One origin depot west, a T-junction mid-board, two destination depots (different colours) at NE and SE. Both legs authored except the last two tiles of the south leg. |
| **The gap** | 2 pieces, $2,000 — small enough that building is not the puzzle |
| **Money** | $6,000, no calendar (the second clock arrives at level 8) |
| **Trains** | 2, one per destination colour, both waiting at the origin |
| **Stars** | Payday · **Perfect colours** (no mismatched arrival) · Under budget $3,000 |
| **Session** | ~4 min |

The whole level is one question asked twice: is the arm pointing where this
train is going? Perfect colours is the real star and it belongs here because the
level is short — a retry costs a minute, which is §9's condition for a
perfection star.

---

#### 3. The Squeeze — *buildable today*

| | |
|---|---|
| **Hook** | "Two ways round the hill. You can only afford one of them." |
| **Teaches** | Money is the constraint, and the cheap route has a cost of its own |
| **Board** | ~9×6. A rock ridge splits the map. **North route**: open, 8 pieces, generous curves. **South route**: a 4-piece gap through a notch, but it lands both destinations on one shared corridor. |
| **Money** | $5,000 — the north route ($8,000) is out of reach, so the notch is the only answer |
| **Trains** | 2, sharing the corridor |
| **Stars** | Payday · Under budget $4,000 · Rail baron ≥ 6 pieces (mutually exclusive with Under budget — two runs, per §1.3) |
| **Session** | ~5 min |

Deliberately foreshadows level 4: the cheap route *is* a single-track corridor,
and the player will feel the two trains queue on it without yet being told why.
That is the setup the next level pays off.

---

#### 4. Single Track — *buildable today, with one caveat*

| | |
|---|---|
| **Hook** | "One track, two trains, opposite directions." |
| **Teaches** | Signals as waiting bays; the passing loop |
| **Board** | ~11×5. Depots at both ends, a long single corridor between them. Signals **authored** at both ends of a mid-corridor stretch; the loop track itself is the gap. |
| **The gap** | The passing loop — 4 pieces, $4,000 |
| **Money** | $7,000 |
| **Trains** | 2, one from each end, both waiting. Give them **different consist lengths** — the short one clears the loop sooner, which is the observable lesson. |
| **Stars** | Payday · **Hands off** (no manual holds or force-greens) · Under budget $5,000 |
| **Session** | ~6 min |
| **Caveat** | **Signals are authored only** — there is no in-play signal tool. So the level authors the signals and sells the player the *loop*. If an in-play signal tool ever lands, this level becomes much better: buying the signal would be the decision. |

**This is the level no other game in the genre can offer.** Train Valley has
switches and nothing else; the passing-loop-plus-block problem is ours alone.
Hands off is the right star here because the honest solution is topological, not
manual: build the loop and the interlocking resolves it without a single
override.

---

#### 5. The Crossing — *buildable today, needs one star wired*

| | |
|---|---|
| **Hook** | "The short way runs straight through the high street." |
| **Teaches** | The town is a cost |
| **Board** | ~9×7. A road grid through a town in the south. Short rail route crosses the main road at a level crossing; a longer northern route avoids it entirely and costs 4 more pieces. |
| **Money** | $9,000 — both routes affordable, which is the point: this is a *choice*, not a squeeze |
| **Stars** | Payday · **Good neighbour** (`maxCarWaitSec` ≤ 20) · Under budget |
| **Session** | ~6 min |
| **Needs** | Only the star: `maxCarWaitSec` and `carsDelivered` already exist on `Counters` and are already scored by Crossing Keeper. Wiring one of them into a Tycoon star is small. |

**The design insight worth keeping:** a level crossing costs the player *nothing
in money* today — the boom closes for the train, so the cars wait, not the
train. Rather than block this level on the road economy (A4.9), make the crossing
cost a **star**. The cheap route wins Payday and loses Good neighbour; the
expensive one does the reverse. That is a real decision built entirely from parts
that already exist, and it is a truthful preview of what the road economy will
later make cost money.

---

#### 6. Rush Hour — *buildable today*

| | |
|---|---|
| **Hook** | "Same railway. Four times the traffic." |
| **Teaches** | Nothing. This one tests levels 2–5 together. |
| **Board** | ~11×7. A ring with two spurs and one level crossing, opening with two separate gaps so the build is a sequencing problem as well as a money one. |
| **Money** | $12,000 |
| **Trains** | **4, staggered** — not concurrent. Two waiting at the start, two more pre-declared and released as the first two deliver. |
| **Stars** | Payday · Perfect colours · Good neighbour |
| **Session** | ~7 min |

**The discipline that matters here:** four trains *staggered* is a scheduling
problem; four trains *at once* is a clicking problem. §9's rule — if it gets
harder at 4× speed but not with more thought, it is the wrong kind of hard —
applies to this level more than any other. Peak concurrency stays at three, and
`Counters.peakActive` already exists to assert it in a test.

---

#### 7. The Bypass — *blocked on bridges*

| | |
|---|---|
| **Hook** | "Cross the road, or fly over it." |
| **Teaches** | A capital decision: pay once, or pay every time |
| **Board** | ~9×7. Heavy road traffic across the only rail corridor. A level crossing is cheap; a bridge costs several times as much and never closes. |
| **Money** | Tuned so the bridge is affordable only by being lean elsewhere |
| **Stars** | Payday · Good neighbour · Under budget |
| **Session** | ~7 min |
| **Needs** | **Bridges** (A4.7) — a `bridge` role with two independent port pairs on one cell. The connection model already supports two non-interacting pairs; `IMPROVEMENTS.md` item 6. |

If bridges slip, this level degrades gracefully into "the long way round versus
the crossing", which is level 5 with harsher numbers — worth *not* shipping in
that form, because a campaign that repeats a lesson is exactly §9's same-y
middle. Better to ship seven levels than eight with a duplicate.

---

#### 8. The Valley — *buildable today*

| | |
|---|---|
| **Hook** | "Everything you know, and a tax bill every year." |
| **Teaches** | Nothing new. The exam. |
| **Board** | ~13×9. Three stations, a ring, one single-track section with an authored passing loop, one level crossing, water and rock shaping every route. |
| **Money** | $18,000, **calendar on**: ~20 s/year, ~$150 per piece per year |
| **Trains** | 3 concurrent maximum, staggered to 5 total |
| **Stars** | Payday · Under budget · Hands off |
| **Session** | ~8 min — the cap |

The levy is the point: on a board this size an over-built railway cannot pay for
itself, so the winning line is the *lean* one. That is §1.3's two opposed clocks
finally doing their job on a board big enough to feel it — and per §8 the levy is
charged only on player-laid track, so it is a consequence of the player's own
decisions rather than a designer's number.

---

### Build order

| Levels | State |
|---|---|
| 1 | Exists; needs coach-marks |
| 2, 3, 4, 6, 8 | **Buildable today**, no engine work |
| 5 | Buildable today + one star predicate wired to `maxCarWaitSec` |
| 7 | Needs bridges |

### Star vocabulary

Six stars across eight levels, reused so players learn what they mean, and never
three tiers of one axis (§9):

**Payday** (`earned`) · **Under budget** (`trackSpent`) · **Rail baron**
(`tilesBuilt`) · **Perfect colours** (`mismatchedArrivals`) · **Hands off**
(`manualHolds + manualGreens`) · **Good neighbour** (`maxCarWaitSec`) — the last
being the only one that needs wiring.

Note Under budget and Rail baron are arithmetically exclusive wherever both
appear, which is deliberate: it makes a board worth two runs, exactly as Train
Valley's own level 1 does.

---

## What I would do first

1. **Goals on the Ready card** (S) — finishes the mode's own scope, and every
   level below needs the player to be able to read its targets.
2. **The campaign shell** (M) — an ordered list, unlocks over `objectiveStore`,
   and the "next level" exit. Nothing else can be tested end-to-end until a
   second level can be reached from the first.
3. **Levels 2 and 3** — the first new content, chosen deliberately because they
   need *no new mechanics*. They prove the shell, and they are where the pacing
   rules of §9 first get tested against a real player.
4. **Coach-marks** (M) — once there are three levels, the teaching gap is
   measurable rather than theoretical.

Bridges, the road economy and called trains all stay where §8 put them: after the
mode is finished in its own terms.
