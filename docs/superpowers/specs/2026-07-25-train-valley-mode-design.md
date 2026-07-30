# Train Valley as a target — teardown, gap analysis, game plan

**Date:** 2026-07-25 · **Status:** design / plan, nothing implemented yet
**Scope:** one mode (`tycoon`), modelled on *Train Valley* (Flazm, 2015), level 1
("See" / Lake). Source material: player screenshots of the German build plus
public write-ups (see Sources at the end).

> **§1 was re-researched and corrected on 2026-07-27** after the project owner
> flagged that M11 described a *tutorial* device as a per-level screen. The audit
> found the same mistake in three more rows and two mechanics missing entirely;
> corrections are marked **[corrected 2026-07-27]** in place, and §1.4 records the
> method error that produced them. Nothing downstream of §1 was invalidated —
> §§2–8's decisions all survive the corrections — but two of them now rest on
> better reasons, and one backlog item (§8/§3.3 of the handoff) changed shape.

This doc answers three questions:

1. What exactly does Train Valley do, mechanic by mechanic?
2. What do we already have that maps onto it, and what is genuinely missing?
3. In what order do we build it so every step ships something playable?

It deliberately does **not** re-open the brainstorm. `docs/brainstorm/99-open-questions.md`
already framed the puzzle-vs-management fork and named Train Valley 2 as the star
model (§1.3). This doc is the concrete follow-through for one branch of that fork.

---

## 1. Teardown — what Train Valley actually is

### 1.1 The loop

> Trains **arrive on a timer** at the stations you have connected, each carrying a
> **destination badge** and a **price that is already ticking down**. You **build
> track** (which costs money) so a route exists, **click the station** to send the
> train out, **flip switches** as it runs so it takes the right branch, and it pays
> out **whatever the price has decayed to** when it parks in the matching station.
> Money is the only resource; you win by clearing the level's quota of trains
> while staying solvent, and you lose by failing to pay the annual tax.

Everything else is a modifier on that sentence.

**[corrected 2026-07-27]** The first draft of this paragraph said "a station shows
a waiting train … click the train to dispatch it", which read the loop as
*pull* — nothing moves until the player acts. It is really *push*: a gauge in the
bottom-right corner counts down to the next train, a level's stations **open
progressively** as it runs, and a train left standing eventually leaves on its own.
The click is "send it **now**", not "send it **at all**". That distinction is the
difference between a dispatcher puzzle and a game that keeps handing you work,
and §2.2 G3 was written against the weaker reading.

### 1.2 Mechanic-by-mechanic

Read off the screenshots on 2026-07-25, then checked line by line against public
sources on 2026-07-27. Rows carrying **[corrected]** said something different in
the first draft; the old claim is quoted so the change is auditable.

| # | Mechanic | Evidence |
|---|---|---|
| M1 | **Money is the master resource.** Start capital shown top-left (100 000$), with an **annual tax** readout next to it. Charged at the December→January boundary; failing to cover it loses the mission on the spot. **The formula is `max(minimal_tax_value, annual_income × tax_rate)`, stated by the developers in their own forum** — so it is a **floor plus a cut of what you earned that year**, and the income part resets each January. Reviewers all call it "a tax on your rails"; it is not one. The floor "becomes bigger from one season to another" (flazm), i.e. it rises *per chapter of the campaign*, not within a level. | HUD screenshot; Steam thread with two dev replies; wccftech; TheSixthAxis |
| M2 | **Track costs money, priced per tile, previewed live.** A two-tile spur previews at `-2000$`; a long route round the lake previews at `-10 000$`. So ~1000$/tile, and the tag shows the *whole* pending route before you commit. **Confirmed independently: a flat $1,000 a piece, plus $5,000–$20,000 to displace a building.** Removing track costs money too — TV has no refund. | build screenshots ×2; wccftech; Geeky Hobbies |
| M3 | **[corrected]** ~~"You build from an existing open end into marked buildable land. Green translucent plots mark where building is allowed."~~ The green plots and the dashed white line are **the tutorial coaching one specific gap** (*"Vollende das Schienennetz, indem du Schienen von einem grünen Feld aus verlegst."*), not a standing buildable mask. No source describes a general green-plot overlay in TV1: you drag track across the grid, and what constrains you is terrain, the surcharge for displacing scenery, and on some levels a cap on how many objects you may demolish at all. (*Train Valley Origins*, 2025, does highlight valid placements — in blue.) | tutorial screenshot; Geeky Hobbies; Steam store copy |
| M4 | **Terrain blocks and shapes routes.** The long route bends around the lake because water is not buildable. Rocks, trees, farm plots, buildings are all in the way, and clearing scenery costs money — the store copy is explicit: railways are "cheap when laid across bare fields, but can be expensive when demolishing forests, villages and other existing structures". | lake build screenshot; Steam store copy |
| M5 | **[corrected]** ~~"Trains wait until dispatched — the train sits in the station until the player clicks it."~~ Trains **spawn on a timer** into whatever station is free — the dev calls the bottom-right dial the *"train-soon-meter"* — and *"Zug wartet. Per Klick losschicken."* means **send it now**, not *nothing happens until you click*. A train left standing gets a **5-second countdown and then departs by itself**. The usual community explanation is capacity (the timer fires, every station is occupied, so one waiting train is pushed out to make room), but the same thread carries credible reports of it firing with stations free, so **treat the exact trigger as unsettled** — what is certain is the countdown and that the player does not own the decision. You dispatch by clicking the **station**, not the train. | station screenshots; Steam threads ×2 (one with a dev reply); TheSixthAxis; Steam store copy (DE) |
| M6 | **Each train has one explicit destination**, shown as a small coloured station icon under the price badge (red station → blue destination). *"Schicke den Zug zur blauen Stadt."* Confirmed, and the **shape coding matters**: origin stations are the eight colours as **circles**, destinations the same eight as **slightly smaller squares**. TV1 also ships a **colourblind mode that replaces the symbols with letters** — but read the warning with it: *"it just replaces the pictures with letters that still have too little contrast to be clearly legible in a timely manner, which is pretty crucial in a time management game"*, and overlapping icons make it worse. So the idea is right and TV's execution is not; see §5. | station + wide screenshots; Save or Quit; Nintendo World Report |
| M7 | **The fare decays with time.** The same waiting train reads 2000$, then 1700$, then 1600$. Tutorial: *"Je eher der Zug sein Ziel erreicht, desto mehr Geld verdienst du."* Decay starts while it *waits*, so dispatching promptly matters as much as routing well. Confirmed as a **staircase** — it drops "every couple of seconds", and it has already ticked once before a promptly-sent train clears its own station: *"getting a train to even a close-by destination without at least three drops in value is basically impossible, so the nominal reward offered upon spawning a train is a pipe dream."* Payment lands only once **every car** has arrived. | 2000$ → 1700$ → 1600$ sequence; Save or Quit; Geeky Hobbies |
| M7b | **[new 2026-07-27] The base fare is RANDOM.** Not a modifier on M7 — a separate finding, and the single biggest divergence between TV and what we built. *"The actual rewards you get from making trains reach their destinations is blindly random, with no regard for distance to travel, length of train, speed of train, or any other factor."* Extra trains are rolled the same way, so a $1,000 summon can produce an $800 train. Reviewers name this as the game's worst flaw — it makes early levels a restart lottery ("the Random Number God"). **Our fare prices demand by consist and Manhattan distance, deliberately; keep it.** | Save or Quit; Steam thread (dev + players) |
| M8 | **Switches are the moment-to-moment verb.** A junction draws black arrows showing the currently-set path; clicking retargets it. | junction close-ups |
| M9 | **[corrected]** ~~"Three named objectives per level."~~ The level is **won by routing its quota of trains while staying solvent**; the three named goals are **optional** "Advanced Objectives" (DE *Experten-Ziele*), story-mode only, and each earns a cancellation stamp on a postage-stamp-themed level select. Not every level has them: a season is **5 mission levels (15 stamps) + 1 free-play level** — the dev's own term is *"the random levels (last levels on each page)"* — which is a score-attack map that runs until its timer expires. There are roughly **20 standard goals reused in combinations**, and the catalogue is worth reading as a menu: avoid crashes · no wrong-station arrivals · earn ≥ X · spend ≤ X · **destroy at most N trees/houses** · **never stop or reverse a train** · **never demolish track you laid** · run 5–10 extra trains. Level 1's three: dispatch ≥1 extra train, buy ≥46 more track pieces, earn ≥5000$. | start + end screenshots; Steam achievement guide; dev reply in the tax thread; Save or Quit; TheSixthAxis; tagn |
| M10 | **Extra trains are player-called and cost money** — goal 1 is *"Setze mindestens 1 zusätzlichen Zug ein"*, hotkey `R`. Quantified **by a developer**: *"train that will give you $6k can be scheduled for about $1.5k"*, so roughly a quarter of the payout — but the consist and value are **rolled at spawn** (M7b), so a $1,000 summon can produce an $800 train. Extra trains do **not** shift the spawn timer. Only ever *needed* for the optional objectives. | end screen; dev replies in the Steam tax thread; Save or Quit; Magic Game World |
| M11 | **[corrected — this is the row the owner flagged]** ~~"A briefing screen shows a greyscale map of the level with a coloured line from each origin to its destination and each fare. It is a plan of the demand, not a tutorial."~~ **It is exactly a tutorial.** That map is a teaching device in the tutorial world, shown to explain what a demand *is*; TV1 does not open every level with a plan of its demand. What every level does show before Start is its **Advanced Objectives** (M9), and the demand is read off the board itself — station symbols plus each train's destination badge. | owner correction, 2026-07-27 |
| M12 | **End screen offers three exits:** ∞ (keep playing freely), Abschließen (finish/next), ↻ (retry). | end screenshot |
| M13 | **A calendar clock, not a stopwatch.** "Feb 1832", with pause and a speed multiplier. Levels span decades — 50+ in-game years is normal — and taxes hit annually. Speeds are **1× / 2× / 4×** with pause on space, and **pause is fully actionable**: you can lay track and schedule trains while the world is stopped. There is no mid-level save. | HUD screenshot; Magic Game World (controls); Save or Quit |
| M14 | **Crashes.** Not in these screenshots (level 1 can barely crash) but core to the game: bad routing derails trains, and the bill is threefold — **the lost train, clearing the wreck, and rebuilding the track under it**. Bankruptcy ends the run, and it typically arrives as a *spiral*: a crash, then the repair bill, then the tax you can no longer cover. Note what TV does **not** do: *"nothing warns them they're spending almost all their money"* — our year-ahead `taxUnaffordable` warning is a straight improvement, not a nicety. | write-ups; Save or Quit; wccftech; tagn |
| M15 | **[new 2026-07-27] The level grows while you play.** *"Each one starts with **two stations** that need to be connected"*, and more open as it runs — *"extra cities pop up, extra routes via bridges or tunnels"* — each demanding to be joined to what you already built. tagn's player account is the clearest: *"Levels start out with just one train and a station or three, but then things heat up and soon you have trains waiting to go and more stations to hook up."* This is why building continues all the way through a TV level instead of being a one-off at the start. | TheSixthAxis; wccftech; tagn; Save or Quit |
| M16 | **[new 2026-07-27] Per-train manual control.** Click a running train to **stop** it, and you can **turn it around** — the implementation is a cheat worth knowing: *"engines teleport to the other side of the train"*. Combined with actionable pause, that is the whole collision-avoidance toolkit. Trains run at **different speeds** and are slow to stop, so a bullet train behind a freight is a real problem, and *"even trains you ordered stop may still ram each other if there isn't enough space"*. Two Advanced Objectives forbid using it. | Save or Quit; TheSixthAxis; Steam store copy |
| M17 | **[new 2026-07-27] Bridges and tunnels exist in TV1 — as terrain, not as a build tool.** Maps carry them as fixed chokepoints: *"many missions make you work around having to use a bridge or tunnel whose location you don't control"*, and a reviewer's wish-list asks for the ability *"to dig tunnels through mountains or bridge across water"*, which TV1 does not grant. TV2 made them buildable. Relevant because our own bridge item assumed a build tool; **an authored bridge is the cheaper first version and is what TV1 actually shipped.** | Save or Quit; TheSixthAxis; Steam store copy |
| M18 | **[new 2026-07-27] Three tool modes and a train button, on hotkeys.** Switch `Q` · Build `W` · Demolish `E` · **Schedule an additional train `R`** · pause `Space` · 1× / 2× / 4×. Our Build/Bulldoze toggles are the same shape; the missing verb is `R`. | Magic Game World controls |

### 1.3 Why it works (the design lesson worth stealing)

- **One resource, three sinks.** Track, clearing, calling trains all drain the same
  pool that deliveries fill. Every decision is comparable, so nothing needs a
  separate tutorial.
- **Two clocks, opposed.** The fare decays (hurry) while the tax accrues (build
  lean). Neither is a timer bar; both are money.
- **The build tool *is* the puzzle.** In a fixed-track dispatcher, the player only
  reacts. Here the player authors the constraint they then have to dispatch inside.
  That is what makes level 1 — a nearly empty map — a level at all.
- **Goals reward playing differently, not better.** "Buy ≥46 track pieces" pushes
  you to over-build; "earn ≥5000$" pushes you to be lean. You can't get both
  casually, so the level is replayable. And because they are *optional* (M9), a
  player who cannot get both still finishes the level and moves on — the tension
  is opt-in, which is why it does not become the TV2 grind §9 warns about.
- **The work arrives whether you are ready or not.** Trains spawn on a timer and
  new stations open mid-level (M5, M15), so the pressure is not "solve this board"
  but "keep up with a board that keeps growing". This is the piece our reading
  missed for two build days, and it is what makes the *same* mechanics feel like a
  live railway rather than a puzzle with a money theme.

### 1.4 The method error, recorded so it is not repeated

Every corrected row above has the same cause: **§1.2 was read off screenshots of a
tutorial level, and tutorial affordances were promoted into mechanics.** A tutorial
shows the game in a costume — extra scaffolding, hints pinned to things, a map
explaining what a demand is — and none of that survives into level 5.

- **M11** claimed a per-level briefing screen. It is a tutorial illustration.
- **M3** claimed a standing green buildable mask. It is the tutorial pointing at
  one gap.
- **M5** claimed trains never move until clicked. Level 1 is calm enough that the
  spawn timer never bites, so the push half of the loop was invisible.
- **M9** claimed the three goals *are* the level. They are optional stamps on top
  of a quota.

The tell in all four: the evidence column said "tutorial screenshot" or "HUD
screenshot" and the claim said "every level". **When the only evidence for a
mechanic is a tutorial frame, write down what the tutorial is teaching, not what
the mechanic is** — and go find a second source before building on it. The two
mechanics we missed entirely (M15, M16) were missed the same way: neither can
appear in level 1, so neither was in the screenshots.

**A second pass, 2026-07-27 (later the same day), with full network access.** The
first correction pass ran on web-search summaries only — `WebFetch` and `curl`
were both blocked — and one of its own claims did not survive being read at
source. It said the tax *"rises with inflation across a level's 50+ years"*. That
sentence came from a forum post whose author **retracted it in place** once a
developer replied; the summary had quoted the retracted paragraph and not the
retraction. The real formula, from the developers themselves, is in M1. Two
lessons, and the second is the sharper one: a search summary flattens a thread
into consensus and **loses the argument that thread was having**, so a forum claim
is worth exactly the amount of surrounding conversation you have read. And a
correction pass is not automatically more reliable than what it corrects — this
one shipped an error of its own within a day.

**The uncomfortable part: the answer was already in the repo.** Seven weeks
earlier, `specs/2026-06-06-game-modes-framework-and-puzzle-design.md` had a
one-line summary of TV1 that reads *"Real-time route trains that **keep
spawning**, avoid pile-up/crash → Time Attack"* — the push half, correctly
identified, and it even mapped it to the right mode. This doc contradicted it and
nobody noticed, because a fresh screenshot teardown feels more authoritative than
an old table. **Grep the specs folder for the subject before writing a new
teardown of it**; where the two disagree, that disagreement is the finding.

---

## 2. Gap analysis against our engine

### 2.1 What we already have that maps directly

| TV mechanic | We have | Where |
|---|---|---|
| M8 switches | Done, including default arms, interlocking, switch-lock modes | `game.ts` `initialSwitches`, `Tile.vue` |
| M6 destination matching | Colour matching with a *guaranteed solvable* seeded assignment, plus a mismatch bounce + event | `utils/colorAssignment.ts`, `sim/simulation.ts` |
| M9 three objectives | `StarSpec[]` predicates over `Counters`, evaluated live | `sim/objectives.ts` |
| M9/M12 start + end screens | `HudDescriptor.startOverlay/endOverlay`, deterministic `reset()` for a true Retry | `modes/types.ts`, `game.ts` |
| M11 briefing map | A sim-free static map renderer already exists for the test gallery | `levels/test/thumb.ts`, `ScenarioThumb.vue` |
| M13 clock, pause, speed | `paused` / `speed` refs scaling `dt`; `elapsedSec` counter | `game.ts` |
| M2/M3 route drawing | **A pure multi-tile route planner with a `passable` predicate already stubbed for blocked tiles** — this is the exact tool M2 needs | `tiles/routePlanner.ts` |
| M4 terrain | Designed, not built: `TileCell.terrain?` spec written today | `specs/2026-07-25-terrain-as-tile-data-design.md` |
| M10 extra trains | A `Spawner` contract exists (Time Attack) that injects trains mid-run | `modes/types.ts`, `game.ts` `injectTrain` |
| Level lifecycle | Per-level best result persisted; levels are data + a store | `objectiveStore.ts`, `levelStore.ts` |

That is a lot. The dispatcher half of Train Valley is essentially done and, in
places (interlocking, momentum, multi-lane roads), well past it.

### 2.2 What is missing — ordered by how much of the design it blocks

**G1 — No economy at all.** `grep -i money|budget|cash|revenue|price` over `src/`
returns nothing. There is no ledger, no cost, no fare, no tax. M1/M2/M7/M10/M14
all sit on this. *New:* `src/sim/economy.ts` (a pure ledger: `balance`, `earn`,
`spend`, entry log) + money fields on `Counters` so star predicates can read them.
**Size: S–M. Risk: low.** It is a plain reducer next to `objectives.ts`.

**G2 — The level is only partly immutable once the game starts.** Investigated
2026-07-26; the first draft of this doc called it "M–L, the highest risk in this
plan" and that was wrong. **The simulation already reads the level live:**
`traverse`, `resolveExitPort`, `routeToNextSignal` and `isBoundary` all index
`level[…]` on every call, against the object handed to `createSimulation`, which
is never copied. Track laid mid-run is routable on the next tick with no rebuild.
**Size: S–M.** What *is* frozen, and the traps:

- **`signalTiles`** — a `Set` snapshotted in the sim constructor. Best fix: drop
  the snapshot and derive it live from `level[id].signals`, which is exactly how
  `game.ts` computes it today. `config.signalTiles` survives as a test override.
- **The switch map** — and this one bites. `connectionsToExitPort` returns
  **`null`** when an entry has more than one partner and no arm is set
  (`tiles/model.ts`). A newly-built junction has no entry in `switches`, so its
  exit resolves to null and **the train stops dead on that tile**.
  `initialSwitches` must be re-run and *merged* per edit, so new junctions gain a
  default arm while the player's existing choices survive.
- **All road derivations** (`roadEntries`, lane geometry, capacity, junction list)
  are computed once in `createGame`. **Rail-only edits at first**; road editing
  belongs with phase 6.
- **The reactivity trap.** `createGame` receives the raw level object;
  `@Provide() level` is Vue's reactive proxy of that same target. Mutate the raw
  one and the sim sees it but the board never re-renders. Do **not** hand the game
  the proxy — every `level[…]` lookup in the hot loop would go through it,
  thousands per tick. Instead publish a `levelVersion` ref the game bumps per
  edit, which `gridCells` reads. Explicit invalidation, no proxy in the hot path,
  consistent with the existing `markRaw` discipline.
- **The safety invariant (a free win).** A train's `path[headIndex]` caches the
  `exitPort` from when it entered, and reservations cache tile ids; editing a tile
  a train occupies or has reserved makes both stale. `sim.occupiedBy` and
  `sim.reservedBy` already exist, so: **an edit touching an occupied or reserved
  tile is rejected** — which is also the rule a player expects (you cannot rip up
  track under a moving train). The correctness guard and the game rule are the
  same line of code.

**G3 — Trains never wait.** `TrainState` is `running | parking | parked`; a train
leaves its depot the moment it exists. M5 needs a `waiting` state and
`sim.dispatch(id)`, with the depot click wired through `Tile.vue`. **Size: S.**

> **[corrected 2026-07-27]** This is only *half* of M5, because M5 was misread —
> see §1.2. A `waiting` state plus a dispatch click gives the **pull** half (send
> it now); TV's **push** half is a spawn timer, a station-capacity rule that
> ejects a train you sat on, and stations that open mid-level (M15). The
> `waiting` state as built is still right and still the first thing to build —
> but "G3 done" does not mean "M5 done", and the scorecard in §8 has been
> re-marked accordingly. The push half is a real design fork, not an oversight:
> it turns Tycoon from a board you solve into a shift you work, and it is the
> single change that would most alter how the mode feels. Deciding it is §8's
> business, not this section's.

**G4 — Destinations are implicit.** Today a train parks in *any* colour-matching
depot. TV names *the* station, and the origin badge shows it. Add
`TrainDef.destination?: string` (tile id); keep colour as the visual encoding, so
`colorAssignment` still guarantees solvability. **Size: S.**

**G5 — No buildable/blocked mask, no scenery to clear.** M3/M4. The route planner's
`passable` hook is the whole integration point; what's absent is the terrain *data*
(spec exists) and a `buildable(coord)` predicate plus the green-plot render.
**Size: M**, and it is already the #1 item on `IMPROVEMENTS.md`.

**G6 — Trains are static DOM.** `PlayView.vue` renders `<Train v-for="t in trains">`
from the provided definition, and `createGame` resolves colours and sprite lengths
for that fixed list up front. Time Attack works around this by pre-declaring every
train and hiding it until spawn. Endless, player-called trains (M10) need genuinely
dynamic sprites. **Size: M.** Note: a fixed pool of 20 pre-declared trains gets us
M10 for a campaign level without touching this — take that shortcut first.

**G7 — No crash model, by design.** Our sim makes collisions *impossible* (path
reservation + occupancy backstop). This is Q3 in `99-open-questions.md`, still
open. **Recommendation: do not build crashes.** Money already supplies the stakes
(a bad route wastes fare decay and track spend), and crashes would fight the
interlocking that is one of our best pieces of engineering. Leave a
`collisions: "block" | "crash"` sim option as a later opt-in if playtesting says
the tension is missing. **Explicitly a fork — flagging, not deciding unilaterally.**

**G8 — No campaign.** Modes are a flat picker; there is no ordered level list, no
unlock, no "next level". `objectiveStore` persists per-level results already, so
this is an index + a screen. **Size: M**, mostly UI.

**G9 — Cosmetic/HUD gaps.** Money readout, floating price tags over stations, a
calendar clock rendering of `elapsedSec`, the briefing screen, tutorial coach-mark
tooltips. Each small; `MenuDrawer`/`ToolDock` chrome and `thumb.ts` cover most of
the hard parts. **[2026-07-27]** "Each small" was true of the readouts, all of
which shipped — and false of the coach-marks, which turned out to be the largest
remaining item in the mode (§8 item 8) once it became clear how much of what we
admired in TV's level 1 *was* its tutorial (§1.4). The briefing screen left this
list entirely; see the M11 row in §8's scorecard.

### 2.3 The one thing we have that Train Valley does not

**A real road layer.** Multi-lane roads, lane-aware routing, overtaking, junction
signals, bus priority, and level crossings — all simulated, all already shipping.
Train Valley's roads are scenery.

That is the obvious place to *not* clone. See §4.

---

## 3. The game plan

Seven phases. Each ends in something playable, and each ships its own `/test`
scenario (project rule) plus a before/after screenshot where it's visible.

> **Sequencing decision (2026-07-26).** Terrain — item 1 of `IMPROVEMENTS.md`,
> spec at `2026-07-25-terrain-as-tile-data-design.md` — goes **before** phases 0–2,
> not at phase 3. Reasons: (a) a build tool with nothing to route *around* is not a
> puzzle — Train Valley's level 1 is entirely "get round the lake"; (b) `terrain`
> is a field on `TileCell`, and every phase below eventually asks "what is here?"
> (build cost, buildable mask, clearing price, bridge vs level crossing, town
> demand), so adding it late means re-authoring whatever was built meanwhile;
> (c) it is the missing third axis of the tile model — a cell says what *crosses*
> it (`connections`, `road`) but not what it *is*. Phase 0 is parked until just
> before phase 2, which is the first thing that needs it; the analysis above is
> already banked, so nothing is lost by waiting.

### Phase 0 — Make the world mutable (G2) · S–M · *parked until phase 2*

`applyEdits(steps: RouteStep[]): EditResult` on the game: guard (reject any edit
touching an occupied or reserved tile, per G2) → mutate the level → merge new
switch entries → bump `levelVersion`. Plus `canEdit(tileIds)` so a build preview
can grey out illegal cells, and deriving `signalTiles` live in the sim instead of
snapshotting it. **Adding track only** — bulldozing waits for phase 3, where
clearing gets a price and the "what if a reserved block runs through the deleted
tile" question is worth answering.

Verify with unit tests (track laid under a running sim gets used; occupied and
reserved edits are rejected; a new junction does not stall a train) and a
`livebuild` scenario that closes a gap mid-run on a timer, so it is
screenshot-verifiable.

### Phase 1 — Economy + waiting trains + destinations (G1, G3, G4) · M

`sim/economy.ts` ledger; `Counters` gains `balance` / `earned` / `spent`;
`TrainState` gains `waiting` and `sim.dispatch(id)`; `TrainDef.destination`; the
fare decays from a per-train `baseFare` at a per-level rate. HUD: a money readout
and a price badge on each waiting station.

Two amendments from the TV2 review (§5): the load is a **cargo type** with a
derived colour, not a bare colour — same structure, but icons are legible where
colour is not, and retrofitting it after fares and goals reference it is
needlessly painful. And a train can be **held and resumed** mid-run (the cheap
half of TV2's train control; see §5 for why the other half is not in scope).

**Playable after this phase:** the level-1 loop minus building — click trains out,
route them, watch fares decay, watch the balance move. Worth playtesting on its own
before committing to phase 2.

### Phase 2 — Build in play (M2/M3, on top of G2) · M

Promote the editor's connect tool to an in-play build tool gated by
`ModeControls.build`: drag from an open end, `planRoute` previews the path, the
cost tag shows `tiles × costPerTile`, commit spends and calls `applyEdit`, and an
insufficient balance blocks the commit. Reuse the editor's ghost preview.

**Playable after this phase:** Train Valley level 1, on a flat map with no terrain.

### Phase 3 — Build rules over terrain: clearing (G5) · M

The terrain *data* landed ahead of phase 0 (see the sequencing decision above);
this phase adds the *rules*: `buildable(coord)` feeds `planRoute`'s
`passable`; non-buildable terrain renders as such; clearing scenery costs money.

**[amended 2026-07-27]** This phase used to include "green plots mark buildable
land". That was M3 misread — TV1 has no such mask (§1.2) — so the mask is optional
and ours; what replaces it in scope is a **per-level cap on how much scenery may
be demolished**, which TV does have and which shapes the route rather than the
budget.

**Playable after this phase:** the actual "See" level shape — routing around a lake.

### Phase 4 — Level lifecycle (M9/M12, G8, G9) · M

Goals listed before start and scored after; ∞ / Finish / Retry; a calendar
clock; annual tax; a three-level campaign with unlocks over `objectiveStore`.

**[amended 2026-07-27]** M11's briefing screen was dropped from this phase: TV1
shows a demand map only in its tutorial (§1.2), and the pre-level screen it really
shows — the goal list — is part of this phase already. `thumb.ts` remains the
renderer if we later want a demand plan of our own.

**Playable after this phase:** a small campaign, start to finish.

### Phase 5 — Living demand (M10, G6) · M

Player-called extra trains (a button that spends money and pays a premium) and
recurring demand from a fixed pre-declared pool, via the existing `Spawner`. Only
lift the dynamic-sprite limitation (G6) if an endless mode actually needs it.

**Non-goal: reversing.** Levels are authored as loops and through-stations so the
need never arises. See §5.

### Phase 6 — The twist: make the road layer part of the economy · M–L

Where rail meets road, the player chooses: a **level crossing** (cheap, but every
closure queues cars) or a **bridge** (expensive, no interaction). Congested road
traffic bleeds money or reputation. The counters exist already — `maxCarWaitSec`,
`carsDelivered` — and are barely used outside Crossing Keeper.

This is the phase that stops it being a clone, and it costs less than any of the
earlier ones because the hard simulation is done.

### Not planned

- **Crashes / bankruptcy-by-derailment** (G7) — see the recommendation above.
- **Production chains, cargo types, schedules** — `docs/brainstorm/03` territory;
  a different game than this mode.

---

## 4. Other ideas — where I'd deviate from Train Valley

1. **Phase 6 is the headline, not a bonus.** "Train Valley, but the town below the
   tracks is alive and your crossing decisions strangle it" is a pitch. A faithful
   clone is not.
2. **Build the fare curve as a designer dial, not a constant.** A steep decay makes
   a twitchy dispatch game; a shallow one makes a build-planning game. Same code,
   two genres — expose it in the mode spec and playtest both.
3. **Keep "no crashes" and sell it.** Our interlocking is genuinely better than the
   games we are copying. The failure mode we *do* have — deadlock (backlog item 4) —
   is more interesting, and unlike a crash it is the player's mistake to untangle.
4. **Let the campaign feed the editor.** We have an editor and procgen that Train
   Valley does not. A "beat the level, then keep building on it" (∞) button is
   almost free once phase 2 lands, and a player-shared level format falls out of
   `levelStore`'s export.
5. **Don't gate the demand behind money at first.** The first playtest should be
   phase 1 alone. If clicking trains out and watching fares decay isn't fun without
   the build tool, the build tool won't save it.

---

## 5. Train Valley 2 — what changed, and what we are deliberately not taking

Reviewed 2026-07-26 from screenshots of TV2's "Der Forstbetrieb" mission plus
public write-ups. The interaction verbs are identical to TV1 — build track, click
a station to send a train, click switches to steer. Everything around them changed.

| TV1 | TV2 |
|---|---|
| Procedural trains to randomised destinations — adapt on the fly | **Pre-set supply lines** planned in advance |
| Deliver N trains | **Production chains**: furniture ← glass + boards ← sand + logs |
| — | Nearly every industry also needs **workers**; some need **electricity** from a connected power plant |
| Coloured stations | **Typed cargo** with icons and demand counters (`0/4`, `7/10`) |
| "Call an extra train", bankruptcy, the spawn-timer gauge | **All removed**; replaced by a small owned **fleet** you buy and repair |
| Money as the master pressure | **Time limits** as the master pressure |
| Bridges and tunnels as **authored chokepoints** you must route through (M17) | The same, plus you can **build** them, at expense |
| Fares are **randomly rolled** per train (M7b) | A **fixed value** per delivery; the DLC drops decay too |
| Stations open mid-level, trains spawn on a timer (M15/M5) | **A fixed set of stations**; the player schedules departures from each |
| Per-train control: **stop and reverse** (M16) | The same, plus explicit orders |

**[corrected 2026-07-27]** Three rows above were wrong. The train-control row
previously read *"A dispatched train runs until it arrives or crashes | Per-train
control: stop, resume, reverse"* — but **TV1 already had stop and reverse**; the
store copy sells it (*"Vermeide Unglücke, indem du in kritischen Situationen selbst
die Kontrolle über die Züge übernimmst"*). The terrain row read *"Flat valley"* —
but **TV1 has bridges and tunnels** as authored chokepoints (M17); what TV2 added
was the ability to *build* them. And what TV2 removed was the **spawn-timer gauge**
(reviewers call it the "train pressure gauge"; the developer calls it the
"train-soon-meter"), not a boiler readout — same bottom-right dial, and it went
away because TV2 stopped spawning trains at you. The consequence for §5.2 is
spelled out there.

Scoring also changed: five stars per level (three time tiers + two task goals,
one of which is typically avoid-crashes), and the player *builds* industries (a
$10 000 "build production facility" button) rather than only track. Some levels
carry a star for finishing **without ever using pause**, which tells you how load-
bearing pause is in this genre.

### Not taking, and why

1. **Production chains.** In TV2 the hard part is deciding what to build in what
   order; trains degenerate into short shuttles on dedicated lines. It is a
   build-order puzzle in a train costume, and it exercises none of what this engine
   is good at (routing, blocks, interlocking). A later *mode*, sketched in
   `docs/brainstorm/03`.
2. **Reversing.** ★ the important one — and **the reasoning was rebuilt on
   2026-07-27, though the decision did not change.** The old argument was "TV2 did
   not add it for feel, it added it because its maps are dead-end industry spurs".
   Half of that is false: **TV1 had stop and reverse too** (M16), on maps that are
   *not* dead-end spurs, and it is sold as the collision-avoidance verb — the thing
   you do when two trains are converging and switching won't save you. So reversing
   is not a symptom of TV2's topology; it is what a game does when it has crashes
   and no interlocking.

   That is precisely why we still do not need it. **We removed the problem it
   solves.** Path reservation means two trains cannot converge onto the same block,
   so the emergency reverse has no emergency to answer (§2.2 G7). The costs are
   unchanged and still lopsided: **stopping is nearly free** (we have signal holds,
   and phase 1 adds a `waiting` state anyway) while **reversing is weeks** — `path`
   is append-only with a forward `headIndex`, reservations are directional, and the
   entire interlocking model assumes forward motion. So: take the stop, skip the
   reverse, and author loops and through-stations so the need never arises. What
   changed is the honesty of the sentence — we skip reversing because interlocking
   makes it redundant, not because TV only needed it for spurs.

   **One more thing worth knowing, in case the decision is ever revisited: TV
   cheats.** Reversing there does not reverse anything — *"engines teleport to the
   other side of the train"*. That is a legitimate trick and it is why the feature
   was affordable in a game with no reservation model. It would not be affordable
   here for the same trick: teleporting a loco past its own consist invalidates
   every reservation the train holds and every cached `exitPort` in its path, which
   is the expensive part regardless of how the sprite gets there. **The "weeks"
   estimate is about the interlocking, not about the animation** — so a cheap-looking
   demo of reversing is not evidence the estimate was wrong.
3. **Five-star scoring with three time tiers.** Makes every level a stopwatch and
   rewards grinding one level. Our three stars already reward *playing differently*
   (speedrun / hands-off / perfect match). Keep three, keep them orthogonal.
4. **A 24-level hand-authored campaign.** The hidden cost of both games, and the
   classic place a side project dies. We have procgen, an editor and shareable
   exports: 3–5 hand-made teaching levels, then generated content.
5. **TV2's HUD density.** Counters, cargo pins, demand badges, price tags and a
   roster panel all on screen at once. Our board is SVG tiles that now pan and zoom
   over unbounded worlds; that much chrome will not survive it. One badge per
   station, one per train, nothing else.
6. **Loco repair/purchase upkeep** ($5 000 wrench per engine). Clicks, not
   decisions.
7. **Crashes** — reaffirming §2.2 G7.

### Worth stealing

- **Typed cargo with icons instead of colour matching** — the best idea in TV2,
  and crucially it **does not require chains**. Fixes the colour-accessibility
  problem in `brainstorm/06` too. Folded into phase 1. **[amended 2026-07-27]**
  There is a *much* cheaper version of the same fix, and TV1 shipped it: a
  **colourblind mode that replaces each station's symbol with a letter** (M6).
  A letter on the depot and the same letter on the fare pin is an afternoon and
  needs no cargo model; typed cargo is then a design choice about *flavour*, not
  the only route to an accessible board. Take the letters first — **and take TV's
  mistake as the spec**: its own reviewer calls the letters unreadable in play
  ("too little contrast … pretty crucial in a time management game"), with
  overlapping icons compounding it. A glyph that is not legible at a glance, on a
  moving board, has not solved the accessibility problem — it has moved it. Pair
  the letter with the shape coding TV already gets right (origins circles,
  destinations squares) and check it at our smallest zoom.
- **Demand counters on buildings** (`0/4 logs`): all the readability of a supply
  chain with none of the simulation. A station wants four loads; deliver four.
- **Bridges and tunnels** — already backlog item 6, and what makes terrain pay off.
- **The fare pin over the train**, not only over the station. Phase 1 HUD.

### What we would be betting on instead

1. **The living city under the tracks.** Neither TV game simulates road traffic;
   ours does. "Your crossing decisions strangle the town" is a pitch neither can
   answer.
2. **A real railway under a casual skin.** TV1 and TV2 have switches and nothing
   else — no blocks, no aspects, no reservations. The hardcore end (OpenTTD, Rail
   Route) has those and is dry. We have both halves already; that gap is a
   position. **[amended 2026-07-27]** With one caveat that strengthens rather than
   weakens the bet: **Train Valley World added a "Signal Mode" in late 2024**, so
   the newest game in the series moved toward this position too — and shipped it
   badly enough that its forum filled with *"signals not working"* and *"two trains
   stuck at opposite sides of a signal"*. Signalling bolted onto a game whose
   trains reverse out of trouble is a deadlock generator. Ours is the other way
   round — reservations first, and no reverse to paper over them — which is the
   whole reason §5.2 can decline reversing without losing anything.
3. **A browser game with a deterministic sim.** Daily seeded puzzles, shareable
   level links, ghost replays and leaderboards are nearly free here (`levelStore`
   exports; the sim replays identically) and structurally impossible for a paid
   desktop title.
4. **The editor as content strategy**, so we never have to hand-build 24 levels.

---

## 6. Reception — what the market says, and what it does not

Researched 2026-07-26.

| Game | Year | Reviews | Positive | Label | Price now |
|---|---|---|---|---|---|
| Train Valley | 2015 | 3,446 | 89% | Very Positive | CHF 10 → 90% off |
| Train Valley 2 | 2019 | 3,017 (2,710/307) | 90% | Very Positive | $1.79; given away free more than once |
| Train Valley World | 2024 | **243** | **69%** | **Mixed** | CHF 22 → 75% off |

Metacritic gave TV1 a 69 against ~90% from users — the press shrugs at this genre,
its players don't. Flazm's pre-Steam casual titles (Railway Valley, 2008–12) were
downloaded 15 million times, which is portal downloads, not sales.

**Scale.** SteamSpy's owner estimates are broken post-2018 (it reports TV2 at
"0–20,000" while the game has 3,017 reviews), so the only usable method is the
review-multiplier rule of thumb, ~30–50 owners per review for that era: roughly
**100–150k units each** for TV1 and TV2, at a lifetime average price far below
list given permanent 80–90% discounting. A solid niche living, not a hit. Treat
those as an order of magnitude.

**The instructive data point: the newest, best-funded, publisher-backed entry did
worst.** Train Valley World had tinyBuild behind it and launched at $19.99. Player
complaints, in their own words:

1. *"The routes the game automatically chooses for trains sometimes create logjams
   unless you manually edit them."*
2. *"The lack of a solid challenge makes it seem like a game for beginners that
   don't want to suffer with a lack of money."*
3. It changed identity **again** — TV1 dispatch → TV2 chains → TVW tycoon — and
   players who came for TV2 said so.

What we take from that: **the economy has to bite** (complaint 2 is a direct
warning about phase 1 — fare decay and tax are the tension, not flavour), **pick
one identity and stay in it** (complaint 3 is market evidence for keeping chains
out of v1), and **don't design for critics**.

Complaint 1 needs a qualification, below.

---

## 7. Automation is a question of scale — a deliberate divergence

**Decision, 2026-07-26 (project owner's call; recorded because it cuts against the
obvious reading of §6.)**

The first take on TVW's complaint 1 was "watch `gameConfig.automaticRoutePlanning`
and `automaticTrafficLights`, they are the same mistake." That is too broad. The
complaint is valid **for a small, hand-routed puzzle map**, where automating the
routing removes the only thing the player came to do. It does not generalise to a
large world.

The rule we will actually design to:

> **Automation should scale with the world.** On a puzzle-sized board it is an
> assist and must never be the default. On a large, living world it is the *point*
> — nobody hand-routes two hundred trains, and the pleasure moves from "solve this
> junction" to "watch the network I built keep working, and extend it."

So the auto flags are not a smell. They are the seed of a different mode, and the
same simulation serves both: the puzzle mode leaves them off, the network mode
turns them on and adds more world.

### The mode to keep in mind: the chill network builder

Reference points: **Transport Fever**, OpenTTD. The fantasy is *build a large
network, watch it work, grow it, fix the bottleneck that appears* — not "solve
this board in 5:00". It wants, roughly in order:

- automatic routing and signalling as defaults, not assists (already in
  `gameConfig`);
- a world that keeps going rather than ending — unbounded worlds and the camera
  landed 2026-07-25, so the hard part is done;
- demand that grows over time, so the network needs *extending* rather than
  completing (the `Spawner` contract is the hook);
- the road/city layer as the demand generator rather than as scenery — which is
  the same bet as phase 6, pointed at a different mode;
- production chains, which are unwelcome in the puzzle mode (§5) and are a
  natural fit here.

**Not now.** It is a later mode, not a redirection of the plan above — noted so
that nothing in phases 0–6 forecloses it. Nothing currently does: the simulation
is mode-agnostic, `src/modes/` is a registry, and the auto flags already exist.

---

## 8. Where this stands, and what comes next (2026-07-26)

Updated at the end of the second build day (2026-07-26 evening). Local `master`
now holds the terrain-world merge; branch `claude/build-in-play` sits ahead of
it with the route-draw extraction, build-in-play, `lakevalley-open` and the
terrain blob relaxation. Still nothing pushed — `git log --oneline
origin/master..HEAD` before assuming otherwise. Renumbered from §6 because
there were two of those; §6 Reception and §7 Automation keep their numbers, so
every existing cross-reference still resolves.

**The one-line verdict.** The goal sentence is *"build rails, let trains go,
switch the route, including economics."* As of 2026-07-26 **all four verbs work
in one loop on `/#/play?mode=tycoon&board=lakevalley-open`** — the opening
state of Lake Valley, where the ring's south run is missing, the yellow station
is severed, and the $15,000 budget buys it back. That board is the deliverable
this whole document was aiming at; everything below it is polish or scope.

### Landed

| | |
|---|---|
| **Terrain as tile data** | `TileCell.terrain?`, ground + derived scatter, organic patch outlines whose corners and shores are seeded by the lattice point / edge so neighbours agree. `tiles/terrain.ts` |
| **Terrain authoring** | Drag-to-paint brush in the editor, grass as the eraser; a two-level tool dock so the brush is held, not toggled. |
| **The first rule** | `canBuildOn`: water, rock and mountain are unbuildable, enforced in `validateLevel` and in the editor's route planner from one predicate. |
| **`lakevalley`** | Our reconstruction of Train Valley level 1: three coloured stations, a ring around an unbuildable lake, a junction per spur. `/test/lakevalley`, also `/play?board=lakevalley`. |
| **Phase 0** | The world is editable mid-run: `game.applyEdits` / `canEdit`, live signal derivation, switch-arm merging, `levelVersion`. |
| **Phase 1** | The economy and the dispatch loop — see below. |
| **Solvability** | `matchHomeDepots` (Kuhn's) replaced greedy colour assignment; a derangement is exactly what "n trains, each in its own depot" needs, and `lakevalley` is the regression case. |
| **Retry is honest** | `game.sim` is a getter, so a probe or e2e run after `reset()` reads the live sim rather than the dead one. `tests/unit/gameReset.spec.ts`. |

#### Phase 1, as built (2026-07-26)

| | |
|---|---|
| **G1 economy** | `sim/economy.ts`: a pure ledger (signed entries, running totals, a capped log, `canAfford`/`spend` that refuses debt by default) plus a **fare book** — per-train decaying fares with an idempotent `settle`. Headless, deterministic, 23 unit tests. |
| **M7 decay** | The fare falls from `base` at `decayPerSec` down to a floor (25% of base by default), and it decays **while the train waits**, which is the point. It falls as a **staircase, not a slope** (`DEFAULT_FARE_STEP_SEC` = 4s): the pin holds a number and then drops it in one chunk, like TV's ~100$/3s, instead of trickling every frame. Measured on `lakevalley-open`: −$20 every 4.0s (was ~6 flickering 1$ decrements per second). |
| **Pricing (2026-07-26)** | A fare answers two questions with two terms. **Base** = the demand: `FARE_HANDLING 250 + FARE_PER_WAGON[type] (150 people / 200 freight, matching `physics.ts`' 1.6× freight weight) × wagons + FARE_PER_TILE 35 × demandTiles`, where `demandTiles` is **Manhattan between the paired depots** — not the route driven (a detour must not pay for itself) and not a rail query (on a build board the rail does not exist at setup). **Decay** = normalised: the decayable part spread over `fareGrace × idealTravelSec`, so a long haul is a bigger prize *and* burns slower per second, and every train bottoms out after the same number of ideal trips. Before this, distance was priced only as decay eaten in transit, i.e. a far delivery was strictly worse than a near one — which would have made a demoworld-sized board pay worst exactly where it is most interesting. The genre dial §4.2 asked for is now `fareGrace` (4 generic, 8 on `lakevalley-open` = the old hand-tuned 5/sec, but portable to any board size). |
| **G3 waiting** | `TrainState "waiting"` + `sim.dispatch(id)`, gated by `SimConfig.waitForDispatch`. **Default OFF** — every board and all pre-existing tests assume immediate departure, and the full suite is green unchanged. A waiting train occupies its depot tile but reserves nothing ahead. |
| **Counters** | `balance` / `earned` / `spent` on `Counters`, fed the ledger's absolutes, so a star predicate can score money. |
| **The mode** | `modes/tycoon.ts` — `controls.dispatch`, `hud.money`, an economy per setup, three orthogonal stars (Payday / Hands off / Perfect colours). Registered in `modes/index.ts`. |
| **HUD** | One balance line on the existing score card, and **one fare pin per train** floating over its loco — a waiting pin is the dispatch button. Nothing else, per §5.5. |
| **`/test/dispatch`** | Two identical lanes, two waiting trains: send one now and one late, and the pins show what waiting costs. Also covered end-to-end by an e2e test. |
| **`/test/faredistance`** | The pricing model in isolation: identical trains, a 2-tile job and an 8-tile job. Opens at $470 vs $680 (distance in the base) and then falls −$90 vs −$30 per 4s step (decay normalised to each trip), so the short fare is at its floor in 16s while the long one still reads $500 at 24s. |

Green at the end of the day: `npm run build` clean, **1 568 unit tests in 58
files passing**.

#### Phase 2, as built (2026-07-26)

| | |
|---|---|
| **The gesture** | `routeDrawController.ts` — the editor's route drawing extracted headless (edge press/drag one-shot, click chaining incl. the U-turn pending case, hover ghost), reused verbatim by PlayView. |
| **M2 build + cost** | A single Build toggle (gated by `ModeControls.build`); while armed the tiles grow the editor's edge zones, the ghost previews the route, and a floating tag prices it live. `TRACK_COST_PER_TILE` = $1,000 (economy.ts). Only NEW pieces are charged — re-laid anchors/termini are free. |
| **The commit** | `game.buildRoute`: canAfford → `applyEdits` → `spend`, in that order, so a refused edit (train moved in) spends nothing. Unaffordable routes preview red and abort on click. |
| **M3 half** | `planRoute`'s `passable` = `canBuildOn` ∧ `canEdit`, so water/rock and occupied/reserved tiles are unroutable at preview time. Green plots + clearing stay phase 3. |
| **Counter for M9** | `Counters.tilesBuilt` (pieces bought), for a "buy ≥ N track" star. |
| **Retry honesty** | `reset()` restores the level from a pristine snapshot alongside the capital — no free-track Retry. |
| **`/test/buildgap`** | The loop in isolation: a line two tiles short, a pond gating the route, the budget to close it. `allowIncomplete` is the authored validator opt-out §8 item 3 asked for. E2e drives the whole loop at `/#/play?mode=tycoon&board=buildgap`. |

**Playtest note for whoever picks this up:** §4.5 says test phase 1 *alone*
before building phase 2 on it. `/#/play?mode=tycoon&board=lakevalley` is the
board to do it on.

#### The opening level, as built (2026-07-26)

| | |
|---|---|
| **`lakevalley-open`** | The complete `lakevalley` minus exactly the ring's south run (`structuredClone` of the reference board with `2,5…6,5` deleted, so the two can never drift; the complete board stays the /test reference). The yellow station is severed outright; only the blue↔red trunk works on open. `allowIncomplete` extended to tolerate a severed depot. |
| **Why the ring matters** | Proved, not assumed: the seeded assignment is a 3-cycle, and a 3-cycle over a tree of single track deadlocks in every dispatch order (the B<Y<R<B contradiction at the 1,2–2,2 needle). The ring is the passing loop; closing it *is* the level. |
| **The economics** | Budget $15,000 against a designed 7-piece/$7,000 rebuild (5 ring + the station junction's two entries — the gesture prices a T-junction pair by pair). Deliberately ~2x the rebuild: an opening level teaches the verbs and steers with goals, not scarcity (TV1 gives 100,000$ against a ~10,000$ ring), a misdrag is recoverable (Bulldoze refunds what you bought) but there is still no bankruptcy state. Fares burn slowly here: `fareGrace` 8, twice the generic grace, which reproduces the 5/s this board carried before fares were normalised (per-board `TycoonTuning`, keyed off the levelId tail so /play and /test agree). |
| **M9 goals** | Three that pull apart, each verified reachable in a real browser: **Payday ($1,700)** — re-measured after fares were priced by distance (2026-07-26): the prompt full rebuild banks $2,040 of the $2,440 maximum, the same run sent 60s late banks $1,140, all-floor $611. (Earlier, cargo-only pricing at 5/s: $1,763 of $2,200, target $1,500.) **Under budget ($6,000)** — the ring + east-entry-only build, won via ordered dispatch + one switch flip, using the 4,2 signal as the waiting bay; **Rail baron (7 pieces)** — the full rebuild. Under budget and Rail baron are mutually exclusive by arithmetic, so the board is worth two runs (§1.3). |
| **The sim facts the goals rest on** | Trains route by the ARMS at reservation time (no destination pathfinding), an unsignalled departure reserves the whole route to its end, and a train stopped at a signal keeps ~a consist-length of stale rear reservations. The lean line works *because* yellow's short consist releases 6,2; the north-entry variant deadlocks on exactly that tile. Measured in scripted playtests, then pinned by the e2e. |
| **The e2e** | `tests/e2e/game.spec.ts` "tycoon: lakevalley-open" drives the whole loop through the UI: Start, three build gestures, the arm table, three pin dispatches, phase `won`, `balance = budget − spent + earned`, Payday + Rail baron earned / Under budget not. |

#### The second clock, as built (2026-07-26)

| | |
|---|---|
| **M13 calendar** | `sim/calendar.ts` — pure, headless, deterministic like the rest of `src/sim/`: `calendarAt` (a date off the scored `elapsedSec`), `leviesDue` (whole in-game years completed), `taxFor(spec, pieces)`. The HUD shows "Apr 1832", and it **replaces** the stopwatch on a board that has a calendar, because M13 is explicitly *not a stopwatch* and the two are the same seconds rendered twice. |
| **M1 tax** | Charged **per piece of track the PLAYER laid**, annually. This is the load-bearing choice: a flat levy is a steeper fare decay wearing a hat — it pushes the same way (hurry) and the player decides nothing about it, whereas upkeep on the network you chose to build is what makes §1.3's two clocks *opposed*. Taxing the authored board would be a constant nobody can act on; per-piece also means a dispatch-only board pays nothing without a special case. |
| **Where it books** | Through the same ledger, as `"tax"` (the reason `economy.ts` reserved). A `while` loop, not an `if`: one frame at 4x can cross several year boundaries and a skipped levy is silent free money. Gated on `phase === "playing"`, so nothing accrues behind the Ready card. A levy larger than the balance takes what is there — `spend` refuses an unaffordable amount, which would otherwise make being broke free. |
| **The trap it had to dodge** | `spend()` increments `spent`, and "Under budget ≤ $6,000" read `spent`. Booking tax there turns a **build-discipline** star into a **time** star — lost by dawdling, duplicating the axis Payday already scores. Fixed by splitting the counter, not the ledger: `Counters.trackSpent` (money on track, net of bulldoze refunds, netted by the same rule as `tilesBuilt`) and the star reads that. `spent` keeps meaning "all outgoings" and the log still sums to the balance. |
| **Tuning** | Per board (`TycoonTuning.calendar`), never mode-wide — the generic tuning has none, because the boards that fall through to it are one-mechanic test scenarios on a $3,000 budget where a levy both muddies the lesson and dominates it. `lakevalley-open`: a 15-second year, $150 per piece per year. Both numbers are the *second* guess, corrected by measurement: 20s/year let a winning run pay the levy exactly once (a fee, not a clock), and $200/piece ran the dawdling line to −$400 of capital, i.e. a silent soft-lock with no bankruptcy state to explain it. |
| **Measured** | Scripted playtest through the real UI. Prompt full rebuild: won 35s, $2,100 tax, banked $7,660, Payday + Rail baron. Dawdled 60s first: won 95s, $6,300 tax, banked $2,566, Payday lost. Upkeep on the prompt run exceeds its income — the sentence the mechanic exists to say. |
| **`/test/taxyear`** | The mechanic in isolation: a line with a two-tile gap, a 10-second year and $300 a piece, dialled for *watching* rather than for balance. Close the gap cheaply or scenically and the upkeep line remembers which; bulldoze and it falls. |
| **`game.advance(dt)`** | The frame body minus rendering, extracted so the loop is testable headlessly. `game.sim.step()` moves trains only — no fares, no levy, no tracker — and a hidden browser pane runs no `requestAnimationFrame` at all, so this is the only honest way to unit-test anything loop-shaped. |

#### Undo vs bulldoze, as built (2026-07-27)

Bulldoze used to refund in full. Raised by the player as unrealistic — *"das hat
ja nichts mit der richtigen Welt zu tun"* — and they were right, but the
interesting part is *why* the price had gone wrong: one button was doing two
jobs. It had to be the escape hatch for a **misdrag**, which is an input error,
and the removal of a **railway**, which is a world event. No single price can be
honest about both.

Every builder that solves the first one well solves it with **undo**, not with
economics (Cities: Skylines 2, Planet Coaster, Foundation). Refunds for
demolition are rare outside RollerCoaster Tycoon; SimCity charges to bulldoze,
Cities: Skylines returns nothing, Anno/Tropico take a small fee. So the fix was
to split the verb rather than to pick a compromise number.

| | |
|---|---|
| **Undo** | `game.undoBuild()` — reverses the last PURCHASE. Rails go, full price back as an `adjustment`, no fee; `trackSpent` and `tilesBuilt` both fall, because the buy never really happened. That is what lets "Under budget" survive a fumbled drag while still refusing to survive an over-build the player *kept*. `Ctrl+Z` or a button that only exists while there is something to take back. |
| **The window** | Closes on what the PLAYER does — the next build replaces it, a bulldoze or a **dispatch** drops it — and never on a clock. A window that closes by itself is an invisible timer, which is precisely what undo was chosen over. Only the LAST gesture is ever undoable, so "undo the level at the end" is not a strategy. |
| **Bulldoze** | Removes a RAILWAY for `CLEARING_COST_PER_TILE` ($300, 30% of the build price), booked under the `"clearing"` reason `economy.ts` had reserved for it. It never pays back, it costs the same for authored track as for bought track (the old "only what you bought pays back" guard is unnecessary once nothing pays back), and `trackSpent` does **not** fall — you spent that money, and a goal about build discipline must not be winnable by razing the evidence. |
| **The decision the two prices make** | Clearing is priced *above* a year's upkeep on the same piece ($300 vs $150 on `lakevalley-open`), so razing surplus track pays for itself only with years left to run. Early in a run it is worth it; late it is not. |
| **Why the insolvency warning changed its advice** | It used to say "bulldoze track you no longer need", which was reliable only while clearing paid. Now clearing costs money and `bulldoze` refuses a fee the balance cannot cover, so the warning names **delivering** first — fares are the income — and clearing second. It is also only an escape where there is *surplus*: razing part of a minimal link just re-opens the gap. |
| **Trap** | A gesture can buy nothing, and must then not replace the undo window. The Esc-finish whose terminus duplicates existing rail fires after *every* real gesture — recording it as "the last purchase" set the window to zero pieces and the undo control vanished the instant the drag ended. Only reproducible through the real gesture, so it is pinned by an e2e as well as a unit test. |

#### Bankruptcy, as built (2026-07-27)

The tax's other half, and the reason it was promoted from nicety to gap the day
the levy shipped: until then the only way to empty the purse was to over-spend
on track, i.e. to make a visible mistake. Now *time* drains it too, and a board
that silently stops responding to the build tool is the worst dead end this game
can offer.

| | |
|---|---|
| **The rule** | Bankrupt is **owing more than you have**, never "the balance reached zero". That distinction carries the design: measured lines finish flat broke with the railway built and the trains running, and that is a tight win. The failure is an annual levy the balance cannot cover — `Counters.unpaidTax`, gated by `ObjectiveSpec.fail.onBankruptcy`. Only the tax can produce it; an unaffordable build is refused up front, and a refusal is a choice, not insolvency. |
| **On the way down** | The company pays what it has (being broke must not be free), records the shortfall, and stops billing there. Piling every later levy on says nothing more — "$18,000 short" and "$600 short" end the same run — and would ruin the number as a diagnostic. |
| **The warning is the feature** | `money.taxUnaffordable` turns the calendar row red with *"can't pay next year"* a whole year before the bill lands, and it names the fix. Without that, a fail state the player cannot see coming is an ambush. Same shape as the gridlock nudge: name the failure and name the fix. (Written when bulldoze refunded, so the advice was "bulldoze"; since the undo/bulldoze split it names **delivering** first and clearing second — see that table's last two rows.) |
| **Declared mode-wide** | `fail: { onBankruptcy: true }` for all of Tycoon rather than per board, because it is self-gating — no calendar ⇒ no levy ⇒ no shortfall. `buildgap` and `/test/dispatch` carry the flag and never feel it. |
| **`/test/bankrupt`** | $6,000, an eight-second year, $600 a piece: the annual bill is a countdown, not a drip. Measured — prompt run won at 15.7s banking $3,315; relaxed won at 24.7s banking $855; dawdling folded at 32.0s, $800 short, warned from 24s. The exits are the ones M12 already gave us: Retry, or Keep playing. |
| **Knock-on** | A Tycoon board that *deadlocks* now eventually folds rather than stalling forever. The gridlock nudge still fires first and names the real cause, so the player is told the truth before the bank is. |

### Scorecard against §1.2 — mechanic by mechanic

| # | Mechanic | State | What is actually missing |
|---|---|---|---|
| M1 | Money is the master resource | **Done for the core** | Two sinks now: track, and the **annual upkeep** on the track you laid. On `lakevalley-open` a prompt full rebuild pays $2,100 of tax against $1,760 earned — the railway costs more to hold than it earns, so the balance is a decision rather than a readout. Still missing (and now merely additive): clearing, and calling trains. |
| M2 | Track costs money, per tile, previewed live | **Done** (2026-07-26) | In-play build tool in Tycoon: `TRACK_COST_PER_TILE` ($1,000), live cost tag on the ghost route, refusal preview when unaffordable, spend-after-lay ordering. See "Phase 2, as built". |
| M3 | Build into land you are allowed to build on | **Half+** | The authored opening gap now exists (`lakevalley-open`, `buildgap`): the level opens with dangling ends the player grows track from, and terrain gates the route. Still absent: a *rendered* buildable mask and a "close this gap" hint — the gap is only visible as missing rails. **[re-scoped 2026-07-27]** M3 was corrected (§1.2): TV1's green plots are tutorial coaching, not a standing mask, so **there is no parity item here to chase** — a green mask is *our* idea and should be judged as one. What TV actually has that we do not is the surcharge for building over scenery (M4) and, on some levels, a hard cap on how much scenery you may demolish. That cap is a genuinely good level-design dial and is cheaper than the mask. |
| M4 | Terrain blocks and shapes routes | **Done for blocking** | Water/rock/mountain block, one predicate, enforced in the validator and the planner. Missing: **clearing SCENERY for money** — forest and town are free to build over. (Clearing your own TRACK is priced as of 2026-07-27, `CLEARING_COST_PER_TILE`; the reason is reserved and the pattern is set.) |
| M5 | Trains wait until dispatched | **Half — was marked Done** | The *pull* half is done: `waitForDispatch`, `TrainState "waiting"`, `sim.dispatch(id)`, the fare pin as the button. **[re-marked 2026-07-27]** M5 was misread (§1.2) and this row inherited the mistake. TV's *push* half is missing entirely: a **spawn timer** that keeps handing you trains, a **5-second countdown** that takes a waiting train out of your hands, and stations that **open mid-level** (M15). We have the `Spawner` contract (Time Attack) and `injectTrain`, so the timer is not far — but this is a **fork, not a chore**: see the new item in "What remains". |
| M6 | Each train has one explicit destination | **Partial → load-bearing** | Colour matching guarantees a solvable, reachable pairing, and the authored destination now **prices the fare** (`TrainDef.destinations` → `demandTilesOf`), so it is real data rather than debug decoration. Still missing: the sim parks in *any* colour-matching depot, and there is no destination badge under the fare pin. That badge is G4, still S. |
| M7 | The fare decays with time, including while waiting | **Done** | — |
| M8 | Switches are the moment-to-moment verb | **Done**, and past TV | Interlocking, default arms, `switchLockMode`. |
| M9 | Three named objectives, shown before and after | **Done** (goals on the Ready card, 2026-07-27) | `lakevalley-open` names three goals that pull in different directions — Payday / Under budget / Rail baron — tuned per board (`TycoonTuning`), each verified reachable, and the lean/baron pair mutually exclusive exactly like TV1's own level 1. Counters exist for all of them (`earned`/`trackSpent`/`tilesBuilt`). **[amended 2026-07-27]** The structure was mis-stated in §1.2 and we got it right anyway: in TV the three goals are **optional stamps** over a win condition of "route the quota, stay solvent", and `modes/tycoon.ts` already separates those exactly — `deliveriesRequired: ctx.trains.length` wins the level, `fail.onBankruptcy` loses it, stars are extra. Worth knowing we match, because it means a star may be *hard*: it must never be a gate. |
| M10 | Extra trains are player-called and cost money | **Missing** | The `Spawner` contract exists (Time Attack uses it); Tycoon declares none, and there is no call-train button. Constrained by G6 (see below). **[amended 2026-07-27]** Now with numbers to copy: TV charges ~$1.5k for a train worth ~$6k, randomises the consist at spawn so the buy is a small gamble, and does **not** let it shift the spawn timer. Players report it is only ever *needed* for the optional goals — so it is a **star mechanic**, which is exactly how our `lakevalley-open` goal set already treats its outliers. |
| M11 | A briefing screen | **Not a parity item — was marked Missing** | **[corrected 2026-07-27]** TV1 has no per-level briefing; the greyscale demand map is a *tutorial* illustration (§1.2 M11). What every level shows before Start is its goals — and **we ship that already** (goals on the Ready card, 2026-07-27). So M11 is done in the only sense TV means it. A demand-plan screen is still a good idea *of ours*, and it survives in the backlog on its own merits, but it is no longer "the thing TV has that we lack". `levels/test/thumb.ts` + `ScenarioThumb.vue` remain the renderer if we build it. |
| M12 | End screen offers three exits | **Mostly done** | Retry ✓ and ∞ "Keep playing" ✓. The third exit is *Finish / next level*, which needs a campaign that does not exist (G8). "Change game mode" stands in for it. |
| M13 | A calendar clock, not a stopwatch; annual tax | **Done** (2026-07-26) | `sim/calendar.ts` renders `elapsedSec` as "Apr 1832" and schedules the annual levy; the calendar *replaces* the stopwatch where a board has one, as M13 literally asks. The levy is per piece of **player-laid** track, which is what makes §1.3's two clocks oppose each other rather than both shouting "hurry". Per-board, like every other Tycoon dial. See "The second clock, as built". **[amended 2026-07-27, corrected the same day]** TV's formula is now known from the developers' own forum replies, and it is **three different things from ours**: `max(minimal_tax_value, annual_income × tax_rate)`, charged at the Dec→Jan boundary, with the floor rising **per chapter of the campaign** (not per year — an earlier version of this note said "with inflation", which came from a forum post the poster retracted after a dev corrected him). **Keep ours, and now we can say exactly why**: of the three possible bases, the *floor* is the flat levy this design already rejected as "a steeper fare decay wearing a hat", the *income* term punishes the good run, and only **per-piece-you-laid** responds to a decision the player actually makes. The steal is the **rising floor**, and it maps onto our campaign more neatly than onto our clock: `taxPerTrackPiecePerYear` climbing board by board through `TycoonTuning` *is* TV's "bigger from one season to another", and it needs no new field. Two things we already match: the annual charge point, and losing the mission when it cannot be paid. |
| M14 | Crashes | **Not planned** | §2.2 G7, reaffirmed. Now with the bill TV charges, for the record: the lost train, clearing the wreck, **and** rebuilding the track under it. |
| M15 | The level grows while you play | **Missing** | **[new 2026-07-27]** TV levels open with ~two stations and open more as they run. Our boards are fixed at setup: `PlayView` renders `<Train v-for>` over a fixed list and `createGame` resolves depot colours once, so a *new depot* mid-run is the same class of problem as G6's dynamic sprites. This is the mechanic behind M15/M5's pressure and the reason TV's build tool stays useful for a whole level instead of only its first minute. |
| M16 | Per-train stop / reverse | **Stop: done. Reverse: not planned** | **[new 2026-07-27]** Holding a train is `toggleHold()` plus the `waiting` state. Reversing is declined with a better reason than before (§5.2): reservations mean trains cannot converge, so the emergency reverse has no emergency. Note TV's other half of this row — **trains at different speeds**, so a fast train catches a slow one — which our `physics.ts` mass model produces naturally and no board yet exploits. |
| M7b | The base fare is randomly rolled | **Deliberately not done** | **[new 2026-07-27]** Our fare prices the *demand* (handling + consist + Manhattan between the paired depots); TV rolls a die. This is the one place we should be loudest about diverging, because TV's own reviewers identify it as the game's worst flaw: with track costs fixed and rewards random, an early level becomes a restart lottery. Recorded so nobody "restores parity" here by mistake. |
| M17 | Bridges and tunnels | **Missing, and cheaper than we thought** | **[new 2026-07-27]** TV1 does not let the player *build* them — they are authored chokepoints you route through. Our backlog item assumed a build tool. **An authored bridge role is the shippable first version** and is all level 7 of the arc ("The Bypass") actually needs, if the choice is *route over vs route round* rather than *buy a bridge*. |
| M18 | Tool modes on hotkeys | **Mostly done** | **[new 2026-07-27]** TV: Switch `Q` / Build `W` / Demolish `E` / **new train `R`** / pause / 1×–4×. We have the same modes on toggles; missing are the keyboard bindings and `R` (which is M10). Cheap parity, and hotkeys matter here because TV's own reviewers complain that clicking small moving targets is the real difficulty. |

### What remains, ordered, with sizes

Done and struck from this list on 2026-07-26: the `routeDrawController`
extraction, phase 2 (build in play), the `lakevalley-open` re-cut, and — added
late the same day — BULLDOZE (refund-what-you-bought) and the GRIDLOCK nudge.
See the "as built" tables above and `KNOWHOW` → BULLDOZE + GRIDLOCK. The goal sentence itself is met; everything below is
what separates *the loop works* from *a finished mode*.

1. ~~**Annual tax + calendar**~~ **DONE** (2026-07-26) — see "The second clock, as built".
2. ~~**A bankruptcy state**~~ **DONE** (2026-07-27) — see "Bankruptcy, as built".
3. ~~**Goals on the Ready card**~~ **DONE** (2026-07-27) — both overlays list the board's goals through one `<GoalList>`, and the HUD pip row is gated on `phase !== "ready"` (it had been showing gold stars behind the Ready overlay, because a predicate over zeroed counters is true before the run). `KNOWHOW` → GOALS ON THE READY CARD.
4. **Phase 3 — build rules over terrain** — *M.* Clearing forest/town for money, and a hint that names the gap (M3/M4). The demolition PRICE landed early (2026-07-27, `CLEARING_COST_PER_TILE`) because bulldoze's full refund had to go; what is left here is clearing SCENERY, at the same reason code. **[re-scoped 2026-07-27]** The green-plot mask left this list as a *parity* item — TV1 has no such mask (§1.2 M3). Build it if we want it, but the TV-shaped items here are the **surcharge** (already priced as `TERRAIN_BUILD_FACTOR`) and a **per-level cap on how much scenery may be demolished**, which is a level-design dial we do not have at all.
5. **Explicit destinations + a destination badge** — *S–M.* Make `routeDestinations` authoritative in the sim, keep colour as the visual encoding (M6, G4). Cheap companion, straight from TV1: a **letter on each depot and its train** (M6's colourblind mode), which is the accessible-board fix §5 was going to spend a cargo model on.
6. **The demand plan screen** — *M*, and **demoted 2026-07-27 from "Phase 4 — briefing screen"**. It is not parity: TV1 shows no such screen outside its tutorial (§1.2 M11), and the goal list before Start — the thing TV *does* show — shipped on 2026-07-27. Keep it as our own idea, judged on whether a player reading `lakevalley-open`'s three demands off a map plays better than one reading them off the board.
7. ~~**Phase 4 — campaign / level lifecycle**~~ **DONE** (2026-07-27) — `src/campaign.ts` + `/campaign`: an ordered list, unlocks derived from `objectiveStore` (no new persisted key), and the "Next level" exit M12 wanted. Seeded with three boards proven winnable by an e2e; the eight designed levels are Part B of `…2026-07-27-campaign-and-levels-design.md`. `KNOWHOW` → CAMPAIGN.
8. **Coach-marks / a teaching system** — *M*, and now the largest gap in the
   mode. **We have no tutorial mechanism at all.** Train Valley pins a hint to
   the thing it is talking about — *"Zug wartet. Per Klick losschicken."*,
   *"Vollende das Schienennetz…"* — and our level 1 introduces build, dispatch
   AND switch at once while explaining none of them. With the campaign in place
   this is what stands between "three boards in a list" and a game that teaches
   you to play it. Detail: `…2026-07-27-campaign-and-levels-design.md` §A2.3
   and §A4 row 3.
9. **Phase 5 — player-called extra trains** — *M* with a pre-declared pool, *L* if it needs true dynamic sprites (M10, G6). Copy TV's shape: ~25% of the fare as the price, a randomised consist so the buy is a small gamble, and no effect on any spawn timer.
10. **Phase 6 — the road layer joins the economy** — *M–L.* Level crossing vs bridge, congestion costing money. The differentiator (§4.1).
11. **[new 2026-07-27] The push half of the loop — a spawn timer and stations that open mid-level (M5/M15)** — *M–L, and a fork before it is a task.* Today a Tycoon board hands the player a fixed cast at setup and waits. TV keeps handing you work: a "train-soon-meter" counts down to the next train, a train you sit on runs a 5-second countdown and then leaves without you, and new stations open as the level runs, so the build tool matters for the whole level rather than its first minute. **Decide before building**, because it changes the genre: with it, a level is a shift you work and lateness is the enemy; without it, a level is a board you solve and the fare decay is the only clock. The `Spawner` contract and `injectTrain` already cover the trains; a *new depot* mid-run is G6-shaped work (colours and sprites resolve once at setup). A cheap first probe: one board where a second wave of trains arrives on a timer, no new stations, and see whether it reads as pressure or as noise.

Not planned: crashes (M14 / G7), production chains (§5.1), reversing (§5.2 — reasoning rebuilt 2026-07-27, decision unchanged).

Carried forward from the last session and still open:

- **Dynamic trains (G6).** `PlayView` renders `<Train v-for="t in trains">` from a
  fixed list, so player-called trains need either a pre-declared pool (cheap,
  enough for a campaign level) or real dynamic sprites.
- ~~Removal / bulldozing~~ **DONE** (`game.bulldoze`), and re-priced 2026-07-27:
  it charges `CLEARING_COST_PER_TILE` and never refunds, with `undoBuild()`
  taking over the misdrag case. Refuses depots, any tile a train occupies or has
  reserved, and a fee the balance cannot cover.
- ~~`generateLevel` does not paint terrain~~ **DONE** (2026-07-27, `paintTerrain`),
  so a generated board is a place rather than a diagram. What is left for a
  procedural Tycoon board is a `TycoonTuning` entry that accepts a generated level.
- **`demoworld` has no terrain painted**, so `/play` still shows the old flat
  ground.

### Known warts in the build tool (documented, not fixed)

- ~~**A train stranded at a dead end sits on its own anchor.**~~ **FIXED**
  2026-07-27. A train that has run out of track has committed to no exit, so
  laying the rail it is waiting for contradicts nothing it is doing — the tile
  it stands on is now editable, and its head exit is re-derived on the spot.
  Everything else still blocks: a moving train, a train held at a red signal
  (it *has* somewhere to go), and a tile where only the TAIL lies. Reported from
  a real game, where the failure reads as "the train went into the depot but did
  not count" — on `lakevalley-open`, a ring-only build leaves 2,5 as [N,E] and
  the train leaving the yellow depot enters from the south, finds no partner and
  strands directly above its own station, with the depot sprite underneath
  making it look docked. See `KNOWHOW` → BUILDING UNDER A STRANDED TRAIN.
- **Esc-finishing a route into the side of an existing line** lays a charged
  $1,000 straight the cost tag never showed.
- **Branching off the side of a line** buys an unreachable crossing rather than a
  turnout. Open-end growth is the honest gesture; real turnouts are a phase-3
  question, and the reason the build targets were NOT narrowed to open ends only
  (lakevalley-open needs an interior-edge start to buy its station junction).

### Deferred with a trigger: loans

Raised while building bankruptcy — *"man kann ein Darlehen nehmen, das aber auch
kostet und zurückbezahlt werden kann"*. It is the classic answer, and the
classic answer to a different genre: OpenTTD starts you *with* a loan and
charges interest, Railroad Tycoon has bonds and a board that can fire you,
SimCity issues them annually. What those share is a **persistent company** whose
run lasts hours, where one bad quarter must not end everything.

Our Tycoon levels last 35–95 seconds and Retry is one click, so a loan would be
more mechanic than the thing it protects — and it would work against the tax.
Three concrete objections:

1. §1.3's virtue is **one resource**; principal, interest and repayment are a
   second money concept needing their own tutorial.
2. The tax says *finish*. A loan says *or don't, borrow instead*. They argue.
3. There are already two outs that cost nothing to maintain: the year-ahead
   warning, and Retry.

**The trigger for revisiting:** a campaign (G8) or an endless/sandbox Tycoon,
where a run spans many levels or many minutes. Then "a bad year must not end the
company" becomes true and the loan is the right answer.

### The next step, concretely

Items 1–3 and the campaign are executed; **`docs/handoff-tycoon-next.md` is the
live worklist** and supersedes this paragraph. The reasoning behind what shipped
survives in `sim/calendar.ts`, in the tuning block of `modes/tycoon.ts`, and in
`docs/KNOWHOW.md` → THE SECOND CLOCK, BANKRUPTCY and GOALS ON THE READY CARD.

**What the 2026-07-27 research changed about "finished".** The mode was called
finished in its own terms once the goal list reached the Ready card. That is still
true of the *pull* loop — build, dispatch, switch, bank, pay, fold — and two items
have now left the remainder as non-goals rather than gaps (the briefing screen and
the green-plot mask, both of which were tutorial artefacts read as mechanics).
What replaced them is one honest gap we had not seen at all: **the push half**
(item 11 — a spawn timer and stations that open mid-level). It is bigger than
either item it replaces, and unlike them it is a genuine question about what this
mode wants to be, so it should be *decided* before the next tranche of content is
authored against the current answer.

---

## 9. Progression — what changes level to level (2026-07-27)

Researched 2026-07-27. §8 says the mode's *mechanics* are nearly finished. This
section is the layer above them: what a campaign varies from level to level, why
Train Valley's own campaigns lose people, and the rules we adopt so ours does not.
(Numbered 9 because §8 was claimed by the status section while this was being
written; §§1–7 keep their numbers.)

### What Train Valley actually changes over a campaign

**TV1** — four "seasons", each a *time span* rather than a place: Europe
1830–1980, America 1840–1960, USSR 1880–1980, Japan 1900–2020 (Germany as a
sixth-chapter DLC, also on console). Rolling stock ages with the decades inside a
season. Levels hang on real events: the 1849 Gold Rush, the Florida Overseas
Railroad, WWII, the Cold War, Vostok 1.

**[verified 2026-07-27]** The shape of a season is worth copying exactly: **six
levels — five missions plus one free-play level that simply runs until its timer
expires** — and the five missions carry three Advanced Objectives each, so a
season is worth **15 stamps**. Four seasons = 24 levels, +6 for Germany = 30.
Two things fall out of that. **The chapter ends on a level with nothing to prove**,
which is a rest beat our eight-level arc does not have and could use. And **there
is no mid-level save**, which is the structural reason TV1 caps its levels at
5–10 minutes: a level you cannot put down must be short enough to finish. Our
§9 rule "levels stay 5–8 minutes" was arrived at independently and for the same
reason; it is now evidence rather than taste.

The difficulty curve is expressed almost entirely **in one currency**. Budget
management "starts to cause occasional bankruptcies on the US levels", becomes
"critical" on the USSR ones, and the Japan levels "were the original end game
where players started having to make multiple attempts."

Three modes, three session shapes: **story** (5–10 min levels), **random**
(15–20 min, procedurally different each launch), **sandbox** (no time or money).

**[refined 2026-07-27]** Two details from the store copy and a dev reply that
change how this maps onto `src/modes/`. **Sandbox is not a third mode — it is a
regime "turned on for both story and random modes"**, i.e. a *modifier* (no time,
no money limits) over any board, where ours is a separate mode with its own entry
in the registry. And **"random mode" is not a separate screen either**: the random
levels *are* the sixth level of each chapter (the dev: *"the random levels (last
levels on each page)"*), so the procedural content sits **inside** the campaign as
its chapter finale rather than beside it. Both are cheaper than what we built:
a flag on the objective spec, and a generated board seeded into the campaign list
— which is exactly the "procedural Tycoon board" item that is currently one
`TycoonTuning` entry away.

**TV2** — 50 levels over five ages (Steam, Industrial, Electrical, Globalization,
Space), each age adding a mechanic: cargo types, then workers, then electricity.

### What works

1. **The pressure that rises is one number the player already understands.** No
   new systems in the back half; money just gets tighter, so the late game tests
   the skill the early game taught.
2. **Era is a free novelty dial** — same mechanics, new look and new trains each
   chapter. Cheap to build, and it makes a run feel like it is going somewhere.
3. **5–10 minute levels.** The single biggest retention lever. Short enough that a
   failure costs nothing and "one more" is always cheap.
4. **Every level has a nameable hook.** "The Gold Rush one." "The Vostok one." A
   level with an identity is remembered; without one, twenty-four levels blur.
5. **Three modes for three moods** — authored, infinite, pressure-free. The same
   shape this project already has (puzzle / daily / sandbox).

### What leaks the interest — TV2 is the cautionary tale

1. **Difficulty by micromanagement instead of by decision.** Later levels add
   trains and switches, so the challenge becomes hand speed. Players report
   abandoning the 5-star chase **around level 10 of 50** because it "suddenly
   became a royal pain."
2. **Stars that punish instead of reward.** "Don't let any train enter a wrong
   station" across a 40-train level is a single-mistake fail spread over twenty
   minutes; stacked with three time tiers it becomes work.
3. **Level length inflation.** TV1's 5–10 minutes became TV2's long chain levels.
   A failed 30-minute run is a bad trade, so players stop retrying — and then stop.
4. **A same-y middle.** "Tedious once you're around one-third of the way in…
   almost all the same, with more or less the same difficulty." The level count
   kept rising after the dials stopped moving.
5. **Tone whiplash.** TV2 opens relaxed and methodical, then "ruins that
   relaxation by cramming in every stress-building challenge." It never decides.
6. **Nothing accumulates.** Every level starts from zero and stars only unlock the
   next one, so no thread pulls the player through fifty of them.

### The rules we adopt

- **Difficulty comes from decisions, not from hands.** The test: if a level gets
  harder at 4× speed but not when you think about it longer, it is the wrong kind
  of hard. This is the rule TV2 broke and the one this engine is best placed to
  keep — interlocking makes *which route do I set* a thinking problem, where
  *click forty switches faster* is a reflex problem.
- **Levels stay 5–8 minutes.** A hard cap. If a level needs longer, it is two
  levels.
- **Three orthogonal stars, never tiers of one axis** — and a perfection star
  ("no mismatches") only on a *short* level, where a retry costs a minute.
- **One new dial per level, then combine.** Never two.
- **Every level gets a name and a one-sentence hook.** TV1's historical
  set-pieces are this trick with a research budget; our map shapes can do it free.
- **The rising pressure is money, and it rises because of what the player built.**
  The annual levy already scales with the network (§8) — keep that as the curve,
  because a late-game squeeze that emerges from your own success beats one a
  designer typed in.
- **Something accumulates.** Cheapest version: tools unlock in teaching order —
  signals, then bridges, then crossings — so the campaign's progression *is* its
  tutorial.
- **One tone per mode.** The campaign is tight; the network builder (§7) is chill.
  Do not blend them.

### The dials

Board size · terrain hostility (how far the detour) · starting capital vs.
required spend · demand rate · **single-track sections that force interlocking** ·
**level crossings and road density** · fare-decay steepness.

The last two are ours alone, and they should carry the back half of the campaign —
that is where Train Valley has nothing to compare against.

**[added 2026-07-27]** Three more, all TV1's, all cheap because the mechanics
underneath them exist: **a cap on how much scenery a level lets you demolish**
(a spend limit that shapes the *route* rather than the budget) · **a levy rate
that climbs year on year** (§8 M13 — difficulty from the clock, not from a
designer's number) · **how many stations the level opens while you play** (item 11,
if the push half is adopted — this is TV's real difficulty dial and the one we
have no equivalent of).

### A first arc — eight levels, each 5–8 minutes

| # | Name | New dial |
|---|---|---|
| 1 | The Lake | Build around terrain. Two stations, generous money, no clock. |
| 2 | The Fork | Switches — one junction, two destinations. |
| 3 | The Squeeze | Money. A tight budget forces the short, awkward route. |
| 4 | Single Track | Signals and a passing loop. **The dial nobody else has.** |
| 5 | The Crossing | Road interaction — one level crossing, cars queue on the boom. |
| 6 | Rush Hour | Combine: demand up, two crossings, no new mechanic. |
| 7 | The Bypass | Bridge vs. crossing as a money decision. |
| 8 | The Valley | Everything, levy biting. No new mechanic — this one tests. |

Note the shape: nothing new after level 7, and the two hardest levels are
*combinations* rather than additions. That is the anti-TV2 move.

**Level 1 already exists**: `lakevalley-open` is exactly "The Lake" — a severed
ring around an unbuildable lake with a budget that buys it back.

### The content answer

TV1 already showed the right structure for a small team: a **short authored
campaign** plus **procgen** plus **sandbox**. Eight hand-made levels is a weekend
of design, not a year, and the daily seeded puzzle plus the chill network mode
(§7) carry everything after level 8. The procgen, the editor and a deterministic
sim that makes dailies comparable are all already here.

---

## Sources

- [The Challenge of Train Valley — The Ancient Gaming Noob](https://tagn.wordpress.com/2017/01/23/the-challenge-of-train-valley/)
- [Train Valley review — Geeky Hobbies](https://www.geekyhobbies.com/train-valley-indie-game-review/)
- [Train Valley review — GameSpew](https://www.gamespew.com/2015/10/train-valley-review/)
- [Train Valley 2 review — oprainfall](https://operationrainfall.com/2019/05/08/review-train-valley-2/)
- [Train Valley 2 — Wikipedia](https://en.wikipedia.org/wiki/Train_Valley_2)
- [Train Valley 2 review — Save or Quit](https://saveorquit.com/2019/04/19/review-train-valley-2/)
- [TV2 vs 1, pros and cons — Steam discussion](https://steamcommunity.com/app/602320/discussions/1/1812044473327192731/)
- [What's the difference to TV2 — Steam discussion](https://steamcommunity.com/app/2244470/discussions/0/4146194656549996098/)
- Player screenshots: TV1 level "See" (2026-07-25) and TV2 "Der Forstbetrieb"
  (2026-07-26).
- [Train Valley on Steam](https://store.steampowered.com/app/353640/Train_Valley/)
  and [Train Valley World on Steam](https://store.steampowered.com/app/2244470/Train_Valley_World/)
  (review counts, 2026-07-26).
- [Train Valley 2 reviews — Steambase](https://steambase.io/games/train-valley-2/reviews)
- [Train Valley — Metacritic](https://www.metacritic.com/game/train-valley/)
- [Train Valley World review — Geeky Hobbies](https://www.geekyhobbies.com/train-valley-world-indie-video-game-review/)
- [Flazm presskit — Train Valley](https://flazm.com/pr-train-valley) (seasons,
  eras, mode session lengths; §9)
- [TV2 Community Edition review — TheXboxHub](https://www.thexboxhub.com/train-valley-2-community-edition-review/)
- [Steam — "Disappointed" thread, TV2](https://steamcommunity.com/app/602320/discussions/1/1812044473321542242/)
  (the level-10 star abandonment; §9)

### Added by the 2026-07-27 correction pass (§1.2, §1.4, §5)

Each is cited inline in the row it corrects.

- [Before I Play — Train Valley](https://beforeiplay.com/index.php?title=Train_Valley)
  — **search summary only; the page would not load on the second pass**, so nothing
  rests on it alone: every claim it supported (tax failure at January,
  auto-departure, per-train stop/turn, the colourblind letters, "extra trains are
  only for the optional objectives") is carried first-hand by a source below
- [Train Valley review — wccftech](https://wccftech.com/review/train-valley-review-aboard/)
  — **$1,000 flat a piece, $5,000–$20,000 to displace a building**, end-of-year
  tax, bankruptcy (M2)
- [Steam discussion — "Getting 180000 points on stage 2-4"](https://steamcommunity.com/app/353640/discussions/0/412446292775819311/)
  — **superseded by the full-thread read above**; the summary of this page is what
  produced the retracted "inflation" claim. Cited here only so the trail is
  complete (M1, M5, M10, M13)
- [Steam discussion — "Trains which leave 'automatically'"](https://steamcommunity.com/app/353640/discussions/0/527274088401171757/)
  and [— "trains allways start on their own?"](https://steamcommunity.com/app/353640/discussions/0/2592234299566462400/)
  — the station-capacity ejection rule and its ~5s warning (M5)
- [Train Valley achievement guide — Steam](https://steamcommunity.com/sharedfiles/filedetails/?id=595783796)
  — seasons of 5 missions + 1 free-play level, 15 stamps a season, Advanced
  Objectives as optional cancellation stamps (M9, §9)
- [Train Valley review — Save or Quit](https://saveorquit.com/2019/10/26/review-train-valley/)
  — the win condition ("route N trains while solvent"), stop/reverse, actionable
  pause, mixed train speeds (M9, M13, M16)
- [Train Valley review — TheSixthAxis](https://www.thesixthaxis.com/2015/10/14/train-valley-review/)
  and [Train Valley: Console Edition review — LadiesGamers](https://ladiesgamers.com/train-valley-console-edition-review/)
  — **stations open during a mission** (M15)
- [Train Valley on Steam — German store page](https://store.steampowered.com/app/353640/Train_Valley/?l=german)
  — *"die zufällig spawnenden Züge"*, click the **station** to dispatch, take
  manual control of trains, pause to plan (M5, M16)
- [PC controls for Train Valley — Magic Game World](https://www.magicgameworld.com/pc-controls-for-train-valley/)
  — pause on space, speeds 1× / 2× / 4×, build and schedule while paused (M13)
- [Train Valley review — Nintendo World Report](http://www.nintendoworldreport.com/review/61084/train-valley-switch-review)
  — station symbols and the destination icon over a spawning train (M6)
- [Train Valley Origins review — Geeky Hobbies](https://www.geekyhobbies.com/train-valley-origins-review/)
  — the 2025 entry; blue valid-placement highlights, crashes no longer fatal (M3)
- [Train Valley World — Signal Mode update](https://store.steampowered.com/news/app/2244470/view/4375895494759814220)
  and the [signals-not-working](https://steamcommunity.com/app/2244470/discussions/0/603018753649697388/)
  threads — the series' own attempt at block signalling, and how it went (§5)

**The primary source, added on the second pass — read this one before the others:**

- [Steam thread "Getting 180000 points on stage 2-4"](https://steamcommunity.com/app/353640/discussions/0/412446292775819311/)
  — **two developers answer in it** (`flazm`, `sdvoynikov`). It is where the tax
  formula, the per-season rising floor, the "train-soon-meter", the randomised
  extra trains and the ~$1.5k-for-$6k figure all come from *first-hand*. It is also
  where the first correction pass went wrong: the top reply's tax paragraph is
  **retracted in place** by its own author after the devs answered, and a search
  summary reported the retracted text.
- [Wikipedia — Train Valley](https://en.wikipedia.org/wiki/Train_Valley) — the win
  condition and the chapter/level counts, verbatim: *"The main objective of each
  level is to deliver each train to its destination without going bankrupt, but
  every level also has three advanced objectives."* (On "every level" it is looser
  than the achievement guide, which counts 15 stamps per 6-level season; the guide
  and the dev's "random levels" remark agree with each other, so the sixth level
  of a chapter is treated here as having none.)
- [Train Valley on Steam — feature list](https://store.steampowered.com/app/353640/Train_Valley/)
  — the official phrasing of building costs, pause ("you can build railways and
  schedule trains while on pause"), the four seasons, and the mode/session shapes.

**Method note for whoever researches next.** The first pass (earlier the same day)
ran entirely on web-*search* summaries because `WebFetch` and `curl` were both
blocked; the second pass had direct network access and read the pages. `WebFetch`
is still blocked in this environment — the working recipe is `curl` with a browser
User-Agent plus a small HTML-to-text script, and Steam rate-limits, so space the
requests. **What the second pass proved is worth more than the recipe:** a search
summary flattens a forum thread into a single confident answer and silently drops
the disagreement inside it. Where a claim comes from a thread, read the thread.
