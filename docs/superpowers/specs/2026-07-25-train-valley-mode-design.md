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
| **The warning is the feature** | `money.taxUnaffordable` turns the calendar row red with *"can't pay next year"* a whole year before the bill lands, and the fix it names — **bulldoze** — works twice over: it refunds what you paid *and* lowers the next bill. Without that, a fail state the player cannot see coming is an ambush. Same shape as the gridlock nudge: name the failure and name the fix. |
| **Declared mode-wide** | `fail: { onBankruptcy: true }` for all of Tycoon rather than per board, because it is self-gating — no calendar ⇒ no levy ⇒ no shortfall. `buildgap` and `/test/dispatch` carry the flag and never feel it. |
| **`/test/bankrupt`** | $5,000, an eight-second year, $600 a piece: the annual bill is a countdown, not a drip. Measured — prompt run won at 15.7s banking $2,321; relaxed won at 22.7s banking $1,086; dawdling folded at 26.0s, $600 short. The exits are the ones M12 already gave us: Retry, or Keep playing. |
| **Knock-on** | A Tycoon board that *deadlocks* now eventually folds rather than stalling forever. The gridlock nudge still fires first and names the real cause, so the player is told the truth before the bank is. |

### Scorecard against §1.2 — mechanic by mechanic

| # | Mechanic | State | What is actually missing |
|---|---|---|---|
| M1 | Money is the master resource | **Done for the core** | Two sinks now: track, and the **annual upkeep** on the track you laid. On `lakevalley-open` a prompt full rebuild pays $2,100 of tax against $1,760 earned — the railway costs more to hold than it earns, so the balance is a decision rather than a readout. Still missing (and now merely additive): clearing, and calling trains. |
| M2 | Track costs money, per tile, previewed live | **Done** (2026-07-26) | In-play build tool in Tycoon: `TRACK_COST_PER_TILE` ($1,000), live cost tag on the ghost route, refusal preview when unaffordable, spend-after-lay ordering. See "Phase 2, as built". |
| M3 | Build from an open end into marked land | **Half+** | The authored opening gap now exists (`lakevalley-open`, `buildgap`): the level opens with dangling ends the player grows track from, and terrain gates the route. Still absent: the *green plot* mask (buildable land as an authored, rendered thing) and the dashed "close this gap" hint — the gap is only visible as missing rails. |
| M4 | Terrain blocks and shapes routes | **Done for blocking** | Water/rock/mountain block, one predicate, enforced in the validator and the planner. Missing: **clearing scenery for money** — forest and town are free to build over today, with no clearing action and no price. |
| M5 | Trains wait until dispatched | **Done** | — |
| M6 | Each train has one explicit destination | **Partial → load-bearing** | Colour matching guarantees a solvable, reachable pairing, and the authored destination now **prices the fare** (`TrainDef.destinations` → `demandTilesOf`), so it is real data rather than debug decoration. Still missing: the sim parks in *any* colour-matching depot, and there is no destination badge under the fare pin. That badge is G4, still S. |
| M7 | The fare decays with time, including while waiting | **Done** | — |
| M8 | Switches are the moment-to-moment verb | **Done**, and past TV | Interlocking, default arms, `switchLockMode`. |
| M9 | Three named objectives, shown before and after | **Mostly done** | `lakevalley-open` names three goals that pull in different directions — Payday $1,500 / Under budget $6,000 / Rail baron 7 pieces — tuned per board (`TycoonTuning`), each verified reachable, and the lean/baron pair mutually exclusive exactly like TV1's own level 1. Counters exist for all of them (`earned`/`spent`/`tilesBuilt`). Remaining gap: the Ready card still shows the *mode description*, not the goal list, so the targets are only readable as star-pip tooltips. |
| M10 | Extra trains are player-called and cost money | **Missing** | The `Spawner` contract exists (Time Attack uses it); Tycoon declares none, and there is no call-train button. Constrained by G6 (see below). |
| M11 | A briefing screen | **Missing** | `levels/test/thumb.ts` + `ScenarioThumb.vue` are the renderer it would be built on. |
| M12 | End screen offers three exits | **Mostly done** | Retry ✓ and ∞ "Keep playing" ✓. The third exit is *Finish / next level*, which needs a campaign that does not exist (G8). "Change game mode" stands in for it. |
| M13 | A calendar clock, not a stopwatch; annual tax | **Done** (2026-07-26) | `sim/calendar.ts` renders `elapsedSec` as "Apr 1832" and schedules the annual levy; the calendar *replaces* the stopwatch where a board has one, as M13 literally asks. The levy is per piece of **player-laid** track, which is what makes §1.3's two clocks oppose each other rather than both shouting "hurry". Per-board, like every other Tycoon dial. See "The second clock, as built". |
| M14 | Crashes | **Not planned** | §2.2 G7, reaffirmed. |

### What remains, ordered, with sizes

Done and struck from this list on 2026-07-26: the `routeDrawController`
extraction, phase 2 (build in play), the `lakevalley-open` re-cut, and — added
late the same day — BULLDOZE (refund-what-you-bought) and the GRIDLOCK nudge.
See the "as built" tables above and `KNOWHOW` → BULLDOZE + GRIDLOCK. The goal sentence itself is met; everything below is
what separates *the loop works* from *a finished mode*.

1. ~~**Annual tax + calendar**~~ **DONE** (2026-07-26) — see "The second clock, as built".
2. ~~**A bankruptcy state**~~ **DONE** (2026-07-27) — see "Bankruptcy, as built".
3. **Goals on the Ready card** — *S.* The counters and per-board goals exist (`tilesBuilt`, `TycoonTuning`); what's left of M9 is listing the star labels on the Ready card so the player can read the targets before starting. This is now the last sliver of the mode's own scope.
3. **Phase 3 — build rules over terrain** — *M.* Green buildable plots, clearing forest/town for money, and the dashed "close this gap" hint (M3/M4). Bulldoze exists already; what phase 3 adds here is a demolition/clearing PRICE.
4. **Explicit destinations + a destination badge** — *S–M.* Make `routeDestinations` authoritative in the sim, keep colour as the visual encoding (M6, G4).
5. **Phase 4 — briefing screen** — *M.* Greyscale map from `thumb.ts`, a coloured line per demand, the fare on each (M11).
6. **Phase 4 — campaign / level lifecycle** — *M*, mostly UI. An ordered list, unlocks over `objectiveStore`, and the "Finish → next" exit M12 wants (G8).
7. **Phase 5 — player-called extra trains** — *M* with a pre-declared pool, *L* if it needs true dynamic sprites (M10, G6).
8. **Phase 6 — the road layer joins the economy** — *M–L.* Level crossing vs bridge, congestion costing money. The differentiator (§4.1).

Not planned: crashes (M14 / G7), production chains (§5.1), reversing (§5.2).

Carried forward from the last session and still open:

- **Dynamic trains (G6).** `PlayView` renders `<Train v-for="t in trains">` from a
  fixed list, so player-called trains need either a pre-declared pool (cheap,
  enough for a campaign level) or real dynamic sprites.
- ~~Removal / bulldozing~~ **DONE** (`game.bulldoze`): refunds only pieces the
  player bought (`boughtPieces`), refuses depots and any tile a train occupies
  or has reserved — which is also the answer to "what if a reserved block runs
  through the deleted tile". A demolition FEE still belongs with phase 3.
- **`generateLevel` does not paint terrain yet**, so generated and daily boards
  are still bare grass. Contained work, and it is what makes procgen levels look
  like places.
- **`demoworld` has no terrain painted**, so `/play` still shows the old flat
  ground.

### Known warts in the build tool (documented, not fixed)

- **A train stranded at a dead end sits on its own anchor.** You cannot build or
  raze under a train, so the rescue must be drawn from the FAR side, ending one
  tile short of it (edge adjacency joins them). Recoverable but not
  discoverable; the honest fix is the nudge pointing at the tile to build FROM.
  Pinned by the "nowhere to go" e2e.
- **Esc-finishing a route into the side of an existing line** lays a charged
  $1,000 straight the cost tag never showed.
- **Branching off the side of a line** buys an unreachable crossing rather than a
  turnout. Open-end growth is the honest gesture; real turnouts are a phase-3
  question, and the reason the build targets were NOT narrowed to open ends only
  (lakevalley-open needs an interior-edge start to buy its station junction).

### The next step, concretely: goals on the Ready card

Items 1 and 2 are executed. The annual levy books off a calendar rendering of
the scored clock, and an unpayable levy now folds the railway with a warning a
year ahead of it; the reasoning survives in `sim/calendar.ts`, in the tuning
block of `modes/tycoon.ts`, and in `docs/KNOWHOW.md` → THE SECOND CLOCK and
BANKRUPTCY.

One sliver of the mode's own scope is left:

- **Goals on the Ready card** (*S*). The per-board star labels already exist;
  today they are only readable as star-pip tooltips, so the player cannot see
  the targets before starting. Pure HUD work, no sim hot path.

After that the mode is *finished* in its own terms, and everything remaining in
the ordered list above is new scope rather than unfinished business: clearing
costs over terrain, explicit destinations, the briefing screen, a campaign,
player-called trains, and the road layer joining the economy.

---

## 9. Progression — what changes level to level (2026-07-27)

Researched 2026-07-27. §8 says the mode's *mechanics* are nearly finished. This
section is the layer above them: what a campaign varies from level to level, why
Train Valley's own campaigns lose people, and the rules we adopt so ours does not.
(Numbered 9 because §8 was claimed by the status section while this was being
written; §§1–7 keep their numbers.)

### What Train Valley actually changes over a campaign

**TV1** — four "seasons", each a *time span* rather than a place: Europe
1830–1980, America 1840–1960, USSR 1880–1980, Japan 1900–2020 (Germany on
console). Rolling stock ages with the decades inside a season. Levels hang on real
events: the 1849 Gold Rush, the Florida Overseas Railroad, WWII, the Cold War,
Vostok 1.

The difficulty curve is expressed almost entirely **in one currency**. Budget
management "starts to cause occasional bankruptcies on the US levels", becomes
"critical" on the USSR ones, and the Japan levels "were the original end game
where players started having to make multiple attempts."

Three modes, three session shapes: **story** (5–10 min levels), **random**
(15–20 min, procedurally different each launch), **sandbox** (no time or money).

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
