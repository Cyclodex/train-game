# 01 — Objectives & game modes

The headline gap: trains run, deliveries are detected, but **nothing is at stake**.
There is no score shown, no win, no loss, no reason to play on. Everything in this
doc is about giving the player a *reason* and a *shape* to a session. This is the
highest-value area in the whole brainstorm — most other features are only fun once
there's a loop to be fun *inside of*.

Already partly tracked in `IMPROVEMENTS.md` §1–2; this expands it.

---

## 1.1 — A real objective loop ★★★

**What.** Per-level objectives with explicit success/failure: e.g. "deliver 8
matching trains before the timer / before any depot overflows." Show progress in a
HUD (we now have a goal-based score card — recent commit `f837308` — so the bones
exist).

**Why it matters.** Without this, all the terrain and trains in the other docs are
a toy, not a game. A loop turns "watch trains move" into "solve this."

**How it builds on what we have.** The delivery hook already fires events
(`TileDepot` / sim depot events; `gameLog.ts` exists). Add a `GameState` /
objective module that subscribes to sim events and tracks `delivered / required`,
`timeRemaining`, `crashes`. Drive a HUD off it. The sim stays headless; the
objective layer lives beside `game.ts` or in a tiny store. Win when goals met;
lose on fail condition.

**Effort.** M. **Deps.** none (works on current `develop`).

---

## 1.2 — Win / lose states + start & end screens ★★★

**What.** A small game-state machine: `Menu → Playing → Won / Lost`. Start screen
(pick level), win screen (stars, time, "next"), lose screen (reason, retry).

**Why.** Closure. A game that can be *won* is a different object than a sandbox.

**How.** A `gamePhase` enum in `App.vue` (or a tiny Pinia-less store). With the
data-driven branch's vue-router (`/play`, `/editor`) already in place, these become
routes/overlays cleanly.

**Effort.** M. **Deps.** 1.1 for the conditions.

---

## 1.3 — Star ratings & optional objectives ★★★ (Train Valley 2 model)

**What.** Beyond "complete the level," award up to 3 stars for optional feats:
*no crashes*, *finish under N seconds*, *no manual signal holds*, *every delivery
colour-correct*, *X deliveries with one train*.

**Why.** This is the replayability engine in Train Valley 2 — the base level is
easy, the stars are the real game, and they teach mastery of the mechanics. Cheap
to author, huge longevity payoff.

**How.** Objectives are just predicates over the sim's event stream + counters
(crashes, elapsed, holds-used). Store per-level best in localStorage. Render as
3 star icons on the win screen and the level-select.

**Effort.** M (once 1.1 exists). **Deps.** 1.1, 1.2.

---

## 1.4 — Three modes: Puzzle / Endless / Sandbox ★★

**What.**
- **Puzzle** — fixed board, limited track pieces / switches, "route every train
  home." Discrete, solvable, Railbound-style. Pairs with a level editor.
- **Endless** — Mini Metro-style: demand rises over time, depots/stations
  periodically spawn passengers/cargo, you fail when something overflows. Score =
  survival / throughput.
- **Sandbox** — no fail state, all pieces unlocked; a playground (and the natural
  home of the level editor / procgen already built).

**Why.** Different players want different things; the same sim serves all three
with a different *objective layer* on top.

**How.** Each mode is a different objective/spawn module reading the same sim. The
sim doesn't change. Endless needs a spawner (see 3.x passengers) and an overflow
fail (see 1.6).

**Effort.** L overall, but each mode is independently M. **Deps.** 1.1; Endless
also needs 3.4 (passengers/demand) + 1.6.

---

## 1.5 — Campaign with one-mechanic-at-a-time worlds ★★★ (Railbound model)

**What.** A sequence of hand-made levels grouped into "worlds," each world
introducing exactly one new mechanic (curves → signals → switches → tunnels →
bridges → level crossings → stations → cargo), later worlds combining them. Bonus
"branch" levels off the main path.

**Why.** This is *the* lesson from Railbound's 150+ levels: never teach two things
at once. It also gives us a backlog spine — every terrain feature in doc 02 is "the
world that introduces it."

**How.** Levels are already data (`LevelDefinition`; the data-driven branch has an
editor + import/export + `levelStore.ts`). A campaign is an ordered list of level
JSON + unlock gating + which piece-palette is available. Authoring is the work, not
engineering.

**Effort.** L (mostly content/authoring). **Deps.** level loading (data-driven
branch), 1.1–1.3.

---

## 1.6 — Failure pressure: depot/station overflow & timeouts ★★

**What.** Cargo/passengers pile up at a source; if a queue exceeds capacity for too
long → fail (Mini Metro's core tension). Or a per-train deadline.

**Why.** Gives Endless and timed Puzzle their stakes; converts "no urgency" into
"keep up."

**How.** Each source tile gets a queue + capacity in sim state; the objective layer
watches it. Render a filling meter on the tile.

**Effort.** M. **Deps.** 3.4 (something to queue).

---

## 1.7 — Crash = game event, not a non-event ★★

**What.** Today collisions are *prevented* by reservation/occupancy. Optionally
allow crashes (e.g. when the player force-greens a held signal, or in a "no
signals" mode) and make them a scored failure with feedback.

**Why.** Risk. The possibility of a crash makes the signaling actually *matter*.
Train Valley 2's "avoid crashes" star only exists because crashes can happen.

**How.** The occupancy backstop currently makes this impossible by design — we'd
add an opt-in "crashes enabled" flag where a forced-green or unsignalled conflict
resolves to a crash event + game-over, instead of a silent wait. Careful: keep the
deterministic, testable model.

**Effort.** M. **Deps.** ties into 1.1 fail conditions; interacts with signaling.

---

## 1.8 — Daily / seed challenge ★

**What.** A shared daily seed (procgen already exists on the data-driven branch)
with a leaderboard score. Same board for everyone that day.

**Why.** Lightweight retention + social comparison, cheap given we already generate
maps from a seed.

**How.** Date → seed → `generate.ts`; score to localStorage (no backend) or a
simple shared store later.

**Effort.** S–M. **Deps.** procgen (data-driven branch), 1.1.

---

## Discussion seeds for tomorrow

- Is the core fantasy **puzzle** (Railbound: solve a fixed board) or **management**
  (OpenTTD/TV2: keep a living network flowing)? This fork decides almost everything
  downstream — see `99-open-questions.md`.
- Do we want crashes to be possible at all, or is "you can't crash, only stall" part
  of our identity?
- Minimum lovable loop: **1.1 + 1.2 + 1.3** on the current board is a real game in
  ~a few days, no new tiles required. Strong candidate for the first slice.
