# Train Valley as a target — teardown, gap analysis, game plan

**Date:** 2026-07-25 · **Status:** design / plan, nothing implemented yet
**Scope:** one mode (`tycoon`), modelled on *Train Valley* (Flazm, 2015), level 1
("See" / Lake). Source material: player screenshots of the German build plus
public write-ups (see Sources at the end).

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

> A station shows a **waiting train** with a **destination badge** and a **price
> that is ticking down**. You **build track** (which costs money) so a route
> exists, **click the train** to dispatch it, **flip switches** as it runs so it
> takes the right branch, and it pays out **whatever the price has decayed to**
> when it parks in the matching station. Money is the only resource; the level is
> a race against your own bank balance.

Everything else is a modifier on that sentence.

### 1.2 Mechanic-by-mechanic, as read off the screenshots

| # | Mechanic | Evidence |
|---|---|---|
| M1 | **Money is the master resource.** Start capital shown top-left (100 000$), with an **annual tax** readout next to it. | HUD screenshot |
| M2 | **Track costs money, priced per tile, previewed live.** A two-tile spur previews at `-2000$`; a long route round the lake previews at `-10 000$`. So ~1000$/tile, and the tag shows the *whole* pending route before you commit. | build screenshots ×2 |
| M3 | **You build from an existing open end into marked buildable land.** Green translucent plots mark where building is allowed; the tutorial says *"Vollende das Schienennetz, indem du Schienen von einem grünen Feld aus verlegst."* A dashed white line marks the gap to close. | HUD + build screenshots |
| M4 | **Terrain blocks and shapes routes.** The long route bends around the lake because water is not buildable. Rocks, trees, farm plots, buildings are all in the way; in TV, clearing scenery costs money too. | lake build screenshot |
| M5 | **Trains wait until dispatched.** *"Zug wartet. Per Klick losschicken."* — the train sits in the station until the player clicks it. | station screenshots |
| M6 | **Each train has one explicit destination**, shown as a small coloured station icon under the price badge (red station → blue destination). *"Schicke den Zug zur blauen Stadt."* | station + wide screenshots |
| M7 | **The fare decays with time.** The same waiting train reads 2000$, then 1700$, then 1600$. Tutorial: *"Je eher der Zug sein Ziel erreicht, desto mehr Geld verdienst du."* Decay starts while it *waits*, so dispatching promptly matters as much as routing well. | 2000$ → 1700$ → 1600$ sequence |
| M8 | **Switches are the moment-to-moment verb.** A junction draws black arrows showing the currently-set path; clicking retargets it. | junction close-ups |
| M9 | **Three named objectives per level**, shown *before* the level ("Experten-Ziele" + Start) and *after* it ("Mission erfolgreich", each goal green). Level 1's are: dispatch ≥1 extra train, buy ≥46 more track pieces, earn ≥5000$. | start + end screenshots |
| M10 | **Extra trains are player-called and cost money** — implied by goal 1 ("Setze mindestens 1 zusätzlichen Zug ein"); they pay more than scheduled ones. | end screen |
| M11 | **A briefing screen** shows a greyscale map of the level with a coloured line from each origin to its destination and each fare. It is a *plan of the demand*, not a tutorial. | briefing screenshot |
| M12 | **End screen offers three exits:** ∞ (keep playing freely), Abschließen (finish/next), ↻ (retry). | end screenshot |
| M13 | **A calendar clock, not a stopwatch.** "Feb 1832", with pause and a speed multiplier. Levels span decades; taxes hit annually. | HUD screenshot |
| M14 | **Crashes.** Not in these screenshots (level 1 can barely crash) but core to the game: bad routing derails trains, costs money to clear, and bankruptcy ends the run. | write-ups |

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
  casually, so the level is replayable.

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

**G2 — The level is immutable once the game starts.** This is the real work.
`createSimulation({ level, … })` snapshots derived state at construction:
`signalTiles`, `initialSwitches`, the road lane geometry (`createLaneGeometry`),
and road capacity are all computed once in `createGame`. Building a tile mid-run
must invalidate and rebuild those. *New:* a `game.applyEdit(edits)` that mutates
the level and re-derives, plus a `sim` API to accept new tiles without dropping
train positions. **Size: M–L. Risk: the highest in this plan** — it is the one
place where "levels are data" was true only at t=0. Do it first and alone.

**G3 — Trains never wait.** `TrainState` is `running | parking | parked`; a train
leaves its depot the moment it exists. M5 needs a `waiting` state and
`sim.dispatch(id)`, with the depot click wired through `Tile.vue`. **Size: S.**

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
the hard parts.

### 2.3 The one thing we have that Train Valley does not

**A real road layer.** Multi-lane roads, lane-aware routing, overtaking, junction
signals, bus priority, and level crossings — all simulated, all already shipping.
Train Valley's roads are scenery.

That is the obvious place to *not* clone. See §4.

---

## 3. The game plan

Seven phases. Each ends in something playable, and each ships its own `/test`
scenario (project rule) plus a before/after screenshot where it's visible.

### Phase 0 — Make the world mutable (G2) · M–L · **do this alone, first**

Rebuild-on-edit inside `createGame`: `applyEdit(edits: RouteStep[])` mutates
`level`, re-derives `signalTiles` / switches / lane geometry, and hands the sim the
new tiles without disturbing running trains. No player-facing change yet — verify
with a unit test that lays track under a running sim and with a scenario that grows
a spur mid-run.

*Why first:* every later phase depends on it, and it is the only item that could
force an architectural rethink. Find that out on day one, not in phase 4.

### Phase 1 — Economy + waiting trains + destinations (G1, G3, G4) · M

`sim/economy.ts` ledger; `Counters` gains `balance` / `earned` / `spent`;
`TrainState` gains `waiting` and `sim.dispatch(id)`; `TrainDef.destination`; the
fare decays from a per-train `baseFare` at a per-level rate. HUD: a money readout
and a price badge on each waiting station.

**Playable after this phase:** the level-1 loop minus building — click trains out,
route them, watch fares decay, watch the balance move. Worth playtesting on its own
before committing to phase 2.

### Phase 2 — Build in play (M2/M3, on top of G2) · M

Promote the editor's connect tool to an in-play build tool gated by
`ModeControls.build`: drag from an open end, `planRoute` previews the path, the
cost tag shows `tiles × costPerTile`, commit spends and calls `applyEdit`, and an
insufficient balance blocks the commit. Reuse the editor's ghost preview.

**Playable after this phase:** Train Valley level 1, on a flat map with no terrain.

### Phase 3 — Terrain, plots and clearing (G5) · M

Land the existing terrain spec, then: `buildable(coord)` feeds `planRoute`'s
`passable`; non-buildable terrain renders as such; green plots mark buildable land;
clearing scenery costs money.

**Playable after this phase:** the actual "See" level shape — routing around a lake.

### Phase 4 — Level lifecycle (M9/M11/M12, G8, G9) · M

Briefing screen built on `thumb.ts` (greyscale map + a coloured line per demand +
fares); goals listed before start and scored after; ∞ / Finish / Retry; a calendar
clock; annual tax; a three-level campaign with unlocks over `objectiveStore`.

**Playable after this phase:** a small campaign, start to finish.

### Phase 5 — Living demand (M10, G6) · M

Player-called extra trains (a button that spends money and pays a premium) and
recurring demand from a fixed pre-declared pool, via the existing `Spawner`. Only
lift the dynamic-sprite limitation (G6) if an endless mode actually needs it.

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

## Sources

- [The Challenge of Train Valley — The Ancient Gaming Noob](https://tagn.wordpress.com/2017/01/23/the-challenge-of-train-valley/)
- [Train Valley review — Geeky Hobbies](https://www.geekyhobbies.com/train-valley-indie-game-review/)
- [Train Valley review — GameSpew](https://www.gamespew.com/2015/10/train-valley-review/)
- [Train Valley 2 review — oprainfall](https://operationrainfall.com/2019/05/08/review-train-valley-2/)
- Player screenshots of the German build, level "See" (supplied 2026-07-25).
