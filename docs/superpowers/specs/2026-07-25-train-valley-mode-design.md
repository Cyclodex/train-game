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

### Phase 3 — Build rules over terrain: plots and clearing (G5) · M

The terrain *data* landed ahead of phase 0 (see the sequencing decision above);
this phase adds the *rules*: `buildable(coord)` feeds `planRoute`'s
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
| "Call an extra train", bankruptcy, boiler-pressure gauge | **All removed**; replaced by a small owned **fleet** you buy and repair |
| Money as the master pressure | **Time limits** as the master pressure |
| Flat valley | **Bridges and tunnels**, limited in scope |
| A dispatched train runs until it arrives or crashes | **Per-train control: stop, resume, reverse** |

Scoring also changed: five stars per level (three time tiers + an earnings target
+ avoid-crashes), and the player *builds* industries (a $10 000 "build production
facility" button) rather than only track.

### Not taking, and why

1. **Production chains.** In TV2 the hard part is deciding what to build in what
   order; trains degenerate into short shuttles on dedicated lines. It is a
   build-order puzzle in a train costume, and it exercises none of what this engine
   is good at (routing, blocks, interlocking). A later *mode*, sketched in
   `docs/brainstorm/03`.
2. **Reversing.** ★ the important one. TV2 did not add it for feel — it added it
   because its maps are dead-end industry spurs, so a train must back out of the
   sawmill. The mechanic is a *consequence of level topology*, not a feature. The
   two halves cost wildly different amounts here: **stopping is nearly free** (we
   have signal holds, and phase 1 adds a `waiting` state anyway) while **reversing
   is weeks** — `path` is append-only with a forward `headIndex`, reservations are
   directional, and the entire interlocking model assumes forward motion. So: take
   the stop, skip the reverse, and author loops and through-stations so the need
   never arises. Avoiding a mechanic by level design is cheaper than building it.
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
  problem in `brainstorm/06` too. Folded into phase 1.
- **Demand counters on buildings** (`0/4 logs`): all the readability of a supply
  chain with none of the simulation. A station wants four loads; deliver four.
- **Bridges and tunnels** — already backlog item 6, and what makes terrain pay off.
- **The fare pin over the train**, not only over the station. Phase 1 HUD.

### What we would be betting on instead

1. **The living city under the tracks.** Neither TV game simulates road traffic;
   ours does. "Your crossing decisions strangle the town" is a pitch neither can
   answer.
2. **A real railway under a casual skin.** TV has switches and nothing else — no
   blocks, no aspects, no reservations. The hardcore end (OpenTTD, Rail Route) has
   those and is dry. We have both halves already; that gap is a position.
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
