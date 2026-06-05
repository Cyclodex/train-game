# 99 — Open questions & where to start tomorrow

Read this first. These are the decisions that change what everything else means.
Pick answers here and the rest of the brainstorm sorts itself.

---

## The five questions that decide everything

### Q1. What *is* this game — puzzle or management? ★ the big fork

- **Puzzle** (Railbound / Train Valley early): fixed boards, limited pieces, "route
  every train correctly," discrete win, star objectives. Content = hand-made levels.
- **Management / living network** (OpenTTD / Mini Metro / TV2): demand spawns over
  time, you keep a network flowing, fail on overflow, score on throughput.

Almost every doc forks on this: stations, spawning demand (3.4), production chains
(3.5), schedules (5.6), economy (3.6) all belong to the *management* branch;
limited-piece levels, star ratings, one-mechanic worlds lean *puzzle*. **We can do a
hybrid** (puzzle campaign + an Endless mode), but we should *choose a primary* so
the first slice is coherent. My lean: **puzzle-first** (cheaper to ship a complete
loop, leverages the editor/procgen we already have), with Endless as a later mode.

### Q2. Do we merge `worktree-data-driven-tiles` first? ★ probably yes

The connection-based tile model + editor + procgen is done and verified (101 unit +
6 e2e green) but **unmerged**. Nearly every terrain/tile feature in doc 02 is cheap
*with* it and painful *without*. Counter-question: is there integration/review risk
in that branch we need to burn down first? **Recommended: review + merge it before
starting new tile work**, so tunnels/bridges/crossings/obstacles build on one model
instead of the old four-component hierarchy.

### Q3. Can trains crash, or only stall? ★ identity question

Today collisions are *impossible* by design (reservation + occupancy backstop).
"You can't crash, only deadlock" is a defensible identity (calm, Mini-Metro-ish).
But crashes enable real stakes and the "avoid crashes" star (1.7, 1.3). Decide
whether crash-as-fail is in scope at all — it colours signaling, scoring, and tone.

### Q4. How real is the railway? ★ realism dial

The signaling roadmap (doc 05) goes deep: momentum, braking, distant signals, PBS.
It's lovely but mostly invisible to casual players and gated behind the momentum
model (5.1, an L-sized core change). Are we making a *railway simulator* (lean in)
or a *game that happens to have trains* (stop at "trains stop at red, don't crash")?
This sets how much of doc 05 we ever build.

### Q5. What's the very first slice? ★ pick one

Candidates, each a coherent few-days deliverable:

- **A — "It's a game" loop** (doc 01 §§1.1–1.3): score, win/lose, star objectives on
  the *current* board. No new tiles. Highest value, lowest risk, works on `develop`
  today. **My recommended first slice.**
- **B — Terrain mini-world** (doc 02 §§2.2 + 2.7): bridges + obstacles on the
  data-driven model — the "cross the river / route round the forest" world. Needs
  the merge (Q2) but shows off the new model and directly answers the prompt.
- **C — Juice pass** (doc 04 §§4.3 + 4.6 + 4.8): day/night + sound + particles.
  Makes the current game *feel* finished; great morale/demo; independent of
  direction.
- **D — Bahnübergang vertical** (doc 04 §4.1 + doc 02 §2.3): the road + level-
  crossing the prompt asked about. Highest "wow," but the heaviest (a whole second
  actor system) — better as slice 2 or 3.

A sensible sequence: **A (loop) → merge data-driven (Q2) → B (terrain world) → C
(juice) → D (crossings)**. That front-loads the thing the game most lacks (a reason
to play), then layers the world features on a clean foundation.

---

## Smaller open questions, by area

- **Tunnels** (2.1): cosmetic "cover" or true teleport-warp? Different features.
- **Level crossings** (2.3): does the *player* manage the gate (crossing-game
  fantasy) or is it automatic atmosphere?
- **Road cars** (4.1): full actor system, or a cheap "abstract road actors" stub
  that still sells the crossing drama for a fraction of the work?
- **Colour matching** (3.3 / 6.6): keep pure colour, or move to typed cargo with
  icons/shapes? The latter fixes accessibility *and* enables production chains —
  feels like a clear yes.
- **Map size** (4.7): commit to bigger-than-one-screen boards (needs camera) or keep
  everything single-screen? Decides whether camera is near-term.
- **Procgen role**: is generation a *sandbox toy*, a *daily challenge* (1.8), or the
  *campaign content engine*? Changes how much we invest in it.

---

## A note on the "one mechanic per world" principle (Railbound)

If we go campaign, the single most important design discipline from the research:
**introduce exactly one new mechanic at a time, then combine.** Doc 02 already
sketches a teaching order (obstacles → bridges → tunnels → stations → crossings).
Whatever we build, slot it into that ramp rather than dumping mechanics together.

---

## Research sources (for tomorrow)

- **Train Valley 2** — objectives + optional star objectives, production chains,
  player-triggered departures, click switches:
  https://store.steampowered.com/app/602320/Train_Valley_2/ ,
  https://en.wikipedia.org/wiki/Train_Valley_2
- **Railbound** — one-mechanic-per-world, tunnels/switches/barriers/numbered
  stations, carriage-ordering puzzles:
  https://en.wikipedia.org/wiki/Railbound ,
  https://developer.apple.com/news/?id=0x08hncy (Behind the Design)
- **OpenTTD** — bridges/tunnels as terrain answers, drag-to-build stations, deep
  signals, distance-based cargo revenue:
  https://en.wikipedia.org/wiki/OpenTTD ,
  https://wiki.openttd.org/en/Manual/Building%20signals
- **Mini Metro** — shapes-to-shapes delivery, overcrowding fail state, weekly
  pick-an-upgrade (incl. bridges to cross rivers):
  https://en.wikipedia.org/wiki/Mini_Metro_(video_game)
- **Level-crossing games** — the Bahnübergang as its own gated mini-tension:
  https://play.google.com/store/apps/details?id=com.YOZHStudio.RailRoad

---

## Internal references

- `docs/signaling-design.md` — signaling phases (1 done; 2/3 deferred behind the
  momentum model).
- `IMPROVEMENTS.md` — the existing prioritised backlog (this brainstorm extends it).
- `docs/superpowers/specs/2026-06-05-data-driven-tiles-design.md` — the connection
  model these features build on (branch `worktree-data-driven-tiles`).
- `CLAUDE.md` — architecture + conventions (the sim/renderer split, the gotchas).
