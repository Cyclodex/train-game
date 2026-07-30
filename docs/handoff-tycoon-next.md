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

### Corrected on 2026-07-27 — read this before trusting an old "TV does X"

The design doc's mechanic list (§1.2) was read off screenshots of Train Valley's
**tutorial level**, and four tutorial devices got written down as mechanics. The
list was re-researched against public sources on 2026-07-27; the corrections are
marked in place there, and the two that change this worklist are:

| Was believed | Actually |
|---|---|
| TV briefs every level with a greyscale map of its demands | **Tutorial only.** What every level shows before Start is its goal list — which we ship. §3.3 is demoted from parity item to our own idea. |
| TV marks buildable land with green plots | **Tutorial only**, coaching one gap. No standing mask in TV1. §3.4 re-scoped to the surcharge and a demolition cap. |
| Trains wait in the station until clicked | **Half true.** Trains *spawn on a timer*, and one left standing is ejected when the stations fill. The click means "send it now". This is the **new §3.6**, and it is a fork worth deciding early. |
| A TV level's cast is fixed at the start | **New stations open while you play** — which is why building matters for a whole TV level, not just its first minute. Also §3.6. |

Four mechanics were missing entirely — stations opening mid-level, per-train
stop/reverse, **authored bridges and tunnels**, and **randomly-rolled fares** —
and are now M15–M18 plus M7b in the design doc. **The lesson, in one line: when
the only evidence for a mechanic is a tutorial frame, write down what the tutorial
is teaching — not what the mechanic is.**

Three of those change items below, and one changes a number we shipped:

- **§3.5 bridges get cheaper.** TV1 does not let the player *build* bridges or
  tunnels — they are authored chokepoints you route through. A `bridge` role
  authored into a board is the shippable first version, and it is all "The Bypass"
  needs if the choice is *over vs round* rather than *buy one*.
- **TV1's fares are random** — *"no regard for distance to travel, length of train,
  speed of train, or any other factor"* — and its own reviewers call that the
  worst thing about it. Our demand-priced fare is better. Nobody should "restore
  parity" here.
- **The annual tax formula is `max(minimal_tax_value, annual_income × tax_rate)`**,
  from the developers themselves, with the floor rising **per chapter**. Our
  per-piece levy stays (it is the only one of the three that answers a player
  decision), but the rising floor is worth copying and needs no new code: let
  `taxPerTrackPiecePerYear` climb board by board through `TycoonTuning`.

> **A caution about this table itself.** Its first version, written the same day
> from web-search summaries, got the tax wrong — it said "rises with inflation",
> which came from a forum post that its own author retracted after a developer
> replied. The summary quoted the retracted paragraph and not the retraction. If
> you are checking a claim that came from a forum, **open the thread**.

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

**The 2026-07-27 research made this item bigger, and clearer.** Everything the
design doc's §1.2 got wrong turned out to be TV's *tutorial* doing work we had
mistaken for mechanics — the green plots, the dashed gap line, the demand map.
That is not embarrassing for TV; it is a compliment. Its tutorial is so integrated
that an outside observer reads it as part of the game. Two consequences here:

- **Steal the devices, not just the coach-marks.** A green highlight on the cells
  the player should build from, a dashed line across the gap to close, a one-time
  map of who wants to go where — these are *teaching* tools that appear when a
  lesson is live and vanish afterwards. Scoping them here is cheaper and truer
  than shipping them as permanent HUD (which is what §3.3 and §3.4 were about to
  do).
- **That makes this item the home for the demand map.** §3.3 is demoted precisely
  because its content belongs in a tutorial, and a tutorial is what this item
  builds.

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

### 3.3 A demand-plan screen · **M** · *ours, not parity — demoted 2026-07-27*

**Corrected.** This item used to open *"Train Valley shows a greyscale map of the
level with a coloured line from each origin to its destination and the fare on
each — a plan of the demand, shown before you start."* **That is wrong.** The map
is a **tutorial illustration**, shown in the tutorial world to teach a player what
a demand *is*. Train Valley does not brief every level that way.

What TV shows before every level is its **goal list**, and we ship that already
(goals on the Ready card, 2026-07-27). So the parity gap this item was tracking
does not exist — M11 in the design doc is now marked accordingly.

The idea survives on its own merit, at lower priority: is a player who reads
`lakevalley-open`'s three demands off a map better prepared than one who reads
them off the board? Probably yes on a big board, probably noise on a small one —
which makes this a **later** item, and one to test on `demoworld` rather than on a
three-station level.

- **Where.** `src/levels/test/thumb.ts` + `src/components/ScenarioThumb.vue`
  already render a sim-free map of any board. That is the renderer; this item is
  the overlay around it.
- **Cheaper alternative to try first.** §3.2's destination badge puts the same
  information on the board itself, live, and TV's own answer to "which station is
  which" is a **letter on each station** (its colourblind mode) — an afternoon,
  and it also fixes colour accessibility.
- **If built, it goes inside the Ready card**, not before it. One screen before
  the level, never two.

### 3.4 Clearing scenery, a demolition cap, and the gap hint · **M**

The remains of phase 3. The *prices* already exist — `TERRAIN_BUILD_FACTOR` in
`src/tiles/terrain.ts` (the per-ground build surcharge, applied in `game.ts`) and
`CLEARING_COST_PER_TILE` in `src/sim/economy.ts` — what is missing is the reading
and the verbs:

- **clearing scenery** as an action with a price (forest and town are buildable
  but should cost to clear). TV charges **$5,000–$20,000 to displace a building**
  against $1,000 for a plain piece, so the surcharge is not a rounding error —
  it is the thing that makes the long way round the cheap way;
- a **per-level cap on how much scenery may be demolished** — TV does this as an
  *Advanced Objective* ("destroy at most N trees/houses"), not as a hard rule, so
  the cheap version here is a **star predicate over a counter**, not a build-time
  refusal. We have no equivalent either way. It shapes the *route* rather than the
  budget, and it is cheaper than any rendering work here;
- a **hint that names the gap** — today a gap is visible only as absent rails.

**Corrected 2026-07-27:** this item used to lead with *"a green buildable mask —
Train Valley marks where you may build, we only refuse where you may not."*
Train Valley does no such thing. The green plots in the screenshots are the
**tutorial** coaching one specific gap; there is no standing buildable overlay in
TV1. Build a mask if we decide we want one, but budget it as our own idea — the
parity items in this area are the two above.

### 3.5 Bridges · **M–L**, or **S–M** for the authored version · the only engine work the level arc needs

A `bridge` role carrying **two independent port pairs** on one cell, so road can
cross rail (or rail cross water) without a level crossing. The connection model
already supports two non-interacting pairs; design it as an *exception inside
`canBuildOn`*, not as a second rule beside it.

This is what level 7 of the designed arc ("The Bypass" — cross the road, or fly
over it) needs, and nothing else in the arc does.

**Split it in two, 2026-07-27.** This item silently assumed a *build tool*, because
the design doc had TV1 down as a flat valley with no bridges. It is not: **TV1 has
bridges and tunnels as authored chokepoints** you must route through and cannot
place (*"a bridge or tunnel whose location you don't control"*) — building them is
a TV2 feature. So:

- **The authored role** (*S–M*) — a `bridge` cell a level designer places, with the
  two-pair connection behaviour. Ships the mechanic, ships "The Bypass" if the
  level's choice is *route over vs route round*, and needs no pricing, no preview
  and no new gesture.
- **The build tool** (*M–L*) — placing one in play for money. That is the version
  that makes it a *money decision*, and it is the one to defer until the authored
  role has been played.

### 3.6 The push half of the loop (M5/M15) · **M–L** · *a fork — decide before you build*

**New 2026-07-27, and by weight it belongs second in this list.** Re-researching
Train Valley turned up a whole half of its loop that our teardown missed, because
it cannot appear in the tutorial level the teardown was read from:

- trains **spawn on a timer** rather than being placed once at setup — the
  developer's own name for the bottom-right dial is the *"train-soon-meter"*;
- a train you sit on **leaves without you**, on a visible 5-second countdown. The
  usual player explanation is capacity (the meter fires, every station is full, so
  one gets pushed out), but the same thread has reports of it firing with stations
  free — so treat the *trigger* as unsettled and the *countdown* as certain;
- **new stations open mid-level**, each demanding to be connected to what you
  already built: *"levels start out with just one train and a station or three,
  but then things heat up and soon you have trains waiting to go and more stations
  to hook up."*

Our boards do none of this. A Tycoon level hands the player a fixed cast and then
waits for them, so the fare decay is the only thing that ever pushes.

**Why it is a fork and not a chore.** With the push half, a level is a *shift you
work* and the enemy is falling behind; without it, a level is a *board you solve*
and the enemy is your own indecision. Both are good games. But the eight designed
levels in the campaign spec are authored against the second reading, so this is
cheaper to decide now than after they exist.

- **The cheap probe, before committing to anything:** one board where a second
  wave of trains arrives on a timer — no new stations, no ejection. If that reads
  as pressure, the rest is worth building; if it reads as noise, close the fork
  and write down why.
- **What exists.** The `Spawner` contract (Time Attack) and `game.ts`'s
  `injectTrain` cover timed *trains*. A new *depot* mid-run does not exist and is
  G6-shaped: colours (`utils/colorAssignment.ts`) and sprite lengths resolve once
  at setup, and `matchHomeDepots` guarantees solvability over a fixed set.
- **Design doc:** `…2026-07-25-train-valley-mode-design.md` §1.2 M5/M15, §2.2 G3
  and "What remains" item 11.

### 3.7 Player-called extra trains (M10) · **M**

A button that spends money and pays a premium. The `Spawner` contract exists
(Time Attack uses it) and `game.ts` can inject a train mid-run.

**The constraint:** `PlayView` renders `<Train v-for="t in trains">` from a fixed
list resolved at setup, so genuinely dynamic sprites are an *L*. A **pre-declared
pool** — say twenty trains, hidden until called — is the cheap path and is enough
for a campaign level. Take that first.

**Numbers to copy** (TV1, from a developer's own forum reply, 2026-07-27): the buy
costs roughly a **quarter** of what the train pays — *"train that will give you
$6k can be scheduled for about $1.5k"* — and it does not shift the spawn timer.
Players report extra trains are only ever *needed* for a level's optional goals,
which is the role to give ours too: a star mechanic, never a requirement.

**The one thing not to copy:** in TV the bought train's value is *rolled*, so a
$1,000 summon can produce an $800 train and reviewers hate it — the early game
becomes a restart lottery. Price ours off the demand, like every other fare.
`R` is TV's hotkey for this, if we want the parity.

### 3.8 The road layer joins the economy · **M–L** · the differentiator

Neither Train Valley game simulates road traffic; ours does. Where rail meets
road the player should choose: a **level crossing** (cheap, but every closure
queues cars) or a **bridge** (expensive, no interaction), with congestion costing
money.

The counters already exist and are already scored by Crossing Keeper —
`maxCarWaitSec`, `carsDelivered` on `Counters`. A cheap first step that needs no
new engine work at all: make a Tycoon **star** read `maxCarWaitSec`, so the fast
route through town costs you a star. See level 5 of the designed arc.

### 3.9 The eight campaign levels · content, not engine

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

### 3.10 Smaller, whenever

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
  obvious missing level-design dial. (The $1,000 is not arbitrary — it is TV1's
  own flat rate per piece, confirmed 2026-07-27. TV's *other* price is the one we
  lack: $5,000–$20,000 to displace a building. See §3.4.)
- **Letters on the depots** (*S*) — TV1's colourblind mode replaces each station's
  symbol with a letter, and puts the target's letter on the train. Ours is a pure
  colour match today, which is the one accessibility hole in the board. An
  afternoon, and it makes §3.2's badge legible. **Do it better than TV**: its own
  reviewer calls the letters unreadable mid-run ("too little contrast"), with
  overlapping icons making it worse. Copy instead the bit TV gets right — origins
  are **circles**, destinations **squares** — so shape carries the meaning even
  when the glyph is too small, and check it at our smallest camera zoom.
- **A levy floor that rises across the campaign** (*S*) — TV's minimum tax "becomes
  bigger from one season to another". Ours can do the same with **no new code**:
  raise `taxPerTrackPiecePerYear` board by board in `TycoonTuning` as the campaign
  progresses, so the squeeze arrives on schedule without a new mechanic.
- **Hotkeys for the tool modes** (*S*) — TV binds Switch `Q` / Build `W` /
  Demolish `E` / new train `R` / pause `Space` / 1×–4×. We have the modes on
  toggles and no keys. Worth more than it sounds: TV's own reviewers say the real
  difficulty late on is clicking small moving targets, and a keyboard mode switch
  is how you avoid building that same problem.

---

## 4. If you only do one thing

§3.1. The campaign made the game finishable; the teaching is what makes it
learnable, and every level in Part B assumes a player who was taught the verbs in
level 1. The 2026-07-27 research sharpened this rather than changing it: almost
everything we admired about Train Valley's level 1 and mistook for a mechanic was
its tutorial, working so well it was invisible.

**And if you do a second thing, make it a decision rather than a build:** §3.6,
the push half of the loop. It is the one open question that would change what the
other items are *for*, and it costs an hour of playtest to answer.
