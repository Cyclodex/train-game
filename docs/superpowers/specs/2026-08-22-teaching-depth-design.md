# Teaching depth — from level lessons to a two-tier help system

**Date:** 2026-08-22 · **Status:** concept (step 1 built, steps 2–6 designed)
**Companion to:** `2026-07-25-train-valley-mode-design.md` §8 item 8,
`2026-07-27-campaign-and-levels-design.md` §A2.3/§A4.3

The question this answers: is the coach-mark system a **tutorial**, or is it
**contextual help** in the Transport-Fever sense — a hint that appears the
first time you meet a concept, anywhere, and never again once you have seen
it? The answer is: it is the first, and it should grow into carrying both,
because they teach different things and neither replaces the other.

---

## 1. Two kinds of teaching, one engine

### Tier 1 — scripted lessons (built, PR #130)

The Train Valley model: the LEVEL is the curriculum. A board's author knows
which verb the level exists to teach and in what order, so the hints are
authored per board (`COACH_BY_BOARD`), shown one at a time in that order, each
dismissed by the player performing the taught action. This is what campaign
levels need — "level 1 does not work without it" was the gap.

Properties: board-scoped · ordered · action-dismissed · remembered for the
session (Retry never re-teaches a performed verb) · deliberately NOT
persisted across reloads, because a lesson belongs to its level.

### Tier 2 — first-encounter hints (the TF model, to build)

Transport Fever's help is not a curriculum, it is an **encyclopedia that opens
itself**: the first time a SITUATION confronts the player — on any board, in
any mode — a short hint appears, anchored to the thing; once seen, it is
remembered per player and never shown again. This teaches everything a
curriculum cannot schedule, because the situations arise emergently:

- the first train that stands still because the block ahead is reserved,
- the first red signal, the first locked switch,
- the first annual levy, the first "can't pay next year" warning,
- the first board bigger than the screen.

Properties: global (not board-keyed) · trigger = a predicate over the same
per-tick observation the lessons read · dismissed by action where an action
exists, by dwell time where the hint is pure information · remembered **per
player** (localStorage), TF-style.

**The engine is shared.** `createCoach` already sequences specs against a
cumulative observation; tier 2 is the same machine with three additions: a
`trigger` (when a hint becomes eligible at all), a `tier` (where completion is
remembered), and a queue rule (lessons outrank hints; one bubble ever).

---

## 2. The rules that keep it from becoming noise

The §5.5 lesson from Train Valley 2 applies to teaching chrome more than to
any other chrome: a board that pans and zooms does not survive five
simultaneous bubbles.

1. **One bubble on screen, ever.** Tier 1's active lesson always wins; tier 2
   hints queue behind it and behind each other.
2. **A hint is at most two sentences**, and the second sentence names the
   action ("Click the pin to send it"), never lore.
3. **Frequency cap:** after any bubble is dismissed, the next tier-2 hint
   waits a cooldown (~8 s) — two firsts in one moment must not stack into a
   lecture.
4. **Anchored or absent.** A hint that cannot name a board object or a single
   HUD element does not ship (a hint in a corner is a manual).
5. **Never modal, never a close button.** Action-dismissal where possible;
   info-only hints fade after a dwell (~8 s on screen) and count as seen.
6. **`pointer-events: none` stays load-bearing** — the bubble never sits
   between the player and the thing it is asking them to click.

---

## 3. The catalog — tier-2 hints worth shipping

Each row: trigger (over the existing observation/game state — all of these
signals exist today) → anchor → dismissal. Ordered by how often the situation
is the player's first "is the game broken?" moment.

| id | Trigger (first time ever…) | Anchor | Dismissed by |
|---|---|---|---|
| `held-train` | a fare pin enters its HELD state (`badge.held`) | that train | the train moving again, or dwell. Text: the pin already names the blocker; the hint explains *reservations* — "a train reserves its whole path to the next signal; the ring is the passing loop". This is the #1 unexplained mechanic (FarePin.vue's own comment says an unexplained hold "reads as a broken game"). |
| `red-signal` | a train stops at a signal (`sim.trainBlock` reason signal) | the signal | the train proceeding, or the player clicking the signal. "A signal splits the line into blocks. Click it to hold or force." |
| `switch-locked` | a click on a locked switch is refused (`isSwitchLocked`) | the junction | dwell. "Locked while a train holds this path — it frees when the train has passed." Needs a small event from `Tile.vue` (the refusal is currently silent). |
| `first-levy` | the first annual levy books (`money.taxPaid` > 0) | HUD calendar row | dwell. "Every year you pay upkeep on each piece of track you laid." |
| `tax-warning` | `money.taxUnaffordable` turns true | HUD calendar row | the warning clearing, or dwell. "Next year's bill exceeds the balance — deliver fares, or bulldoze track you don't need." (The red row exists; this explains it once.) |
| `undo-window` | the first build purchase lands (`tilesBuilt` 0→1) | HUD undo button | the window closing (next action). "Misdragged? Ctrl+Z takes the last purchase back in full. Bulldozing later costs money." |
| `camera` | a board overflows the viewport (`worldOverflows`) | HUD zoom pill | the player panning or zooming. "Drag to pan, scroll to zoom." |
| `mismatch-bounce` | the first mismatched arrival (`mismatchedArrivals` 0→1) | the bounced train | dwell. "Wrong station — the train bounced and its fare keeps falling. Set the junction before it returns." |

Explicitly NOT hints: gridlock and bankruptcy — both already have dedicated,
louder UI (the nudge, the fail screen) that names failure and fix; a bubble on
top would be the stacking rule 3 forbids. Speed/pause chrome — discoverable,
not confusing, no hint.

Mode-specific catalogs (network's "draw a line, then buy a train", citizens'
inspector) follow the same shape and can be added per mode once the framework
is there; they are content, not architecture.

---

## 4. Architecture changes, step by step

### Step 2 — campaign coverage (content only, S per level)

As the Part B levels land, each authors its lesson list — under the campaign
rule that a level introduces ONE new dial, its list is usually one mark for
the new verb plus nothing (the earlier verbs were taught and, with tier 3
below, are known to be known). Level 2 The Fork: the switch mark. Level 4
Single Track: a signals mark ("the loop is the answer — the signals hold the
short train while the long one passes"). Level 5 The Crossing: the
good-neighbour star's cost. No engine work.

### Step 3 — the seen-store and tiers (S)

`CoachMarkSpec.tier: "run" | "session" | "player"` (default `session`, the
current behaviour). A `src/coachStore.ts` in the mould of `objectiveStore`:
one localStorage key holding the set of player-seen mark ids, read once,
written on completion. `createCoach` takes the store; `done`+`tier:"player"`
marks skip on construction. This alone upgrades nothing visibly — it is the
memory the TF model needs.

Decision recorded: lesson marks stay `session`. A player who reloads
mid-campaign gets level 1's three hints again, and that is correct — they
abandoned the run, not the lesson. Tier-2 hints are `player`.

### Step 4 — triggers + the queue (M, the core of tier 2)

- `CoachMarkSpec.trigger?(obs): boolean` — a hint is eligible once its trigger
  has fired (latched, like the other cumulative facts).
- `CoachObs` grows the signals the catalog needs: `heldTrainIds`,
  `signalStopped`, `taxPaid`, `taxUnaffordable`, `mismatchedArrivals`,
  `worldOverflows`. All exist in game state today; this is mirroring, not
  simulation work.
- A second spec list, `COACH_CONCEPTS` (global, not board-keyed), appended
  after the board's lesson list with lower priority; the controller shows the
  first undone LESSON, else the first triggered, off-cooldown CONCEPT.
- Dwell dismissal: `done` may be `{ dwellSec: 8 }` instead of a predicate —
  the controller counts on-screen time. This is the one place a hint is
  allowed to dismiss itself, and only because "seen" genuinely is the goal
  for info-only hints.

### Step 5 — HUD anchors (S–M)

`{ kind: "hud", slot: "calendar" | "undo" | "zoom" | "build" }`. World marks
live in `.level`; HUD marks cannot (the camera transform would carry them
away), so `CoachMark.vue` renders world anchors as today and HUD anchors into
a fixed-position layer, aimed at a `data-coach-slot="…"` attribute the views
put on the four chrome elements. Same bubble, same rules; the slot attribute
keeps the coach ignorant of view internals.

### Step 6 — player controls (S)

- MenuDrawer: **Hints on/off** (a `gameConfig.showHints`, persisted like
  `worldTheme`) and **Reset hints** (clears the seen-store) — the standard
  pair every game with TF-style help ships, and the escape hatch for a
  streamer or a second household player.
- `/test/coachmarks` stays the isolation board; `/test/heldby` becomes the
  natural demo for the `held-train` concept hint once step 4 lands.

### Step 7 — later, if wanted

- **Briefing screen interplay** (M11): the briefing tells the PLAN (demands,
  fares), the coach teaches the VERBS — they do not overlap. Build M11
  independently; no coupling.
- **Recall**: a small "?" on the HUD that re-shows the board's lesson list on
  demand (read-only walk, no seen-state change).
- **Localization hook**: texts already live in exactly one file (`coach.ts`);
  if the game ever grows a locale, a `t(id)` indirection there is the whole
  migration.

---

## 5. What to build first, and why

| Order | Step | Size | Why here |
|---|---|---|---|
| 1 | ~~Scripted lessons~~ | M | **DONE** (PR #130) |
| 2 | Seen-store + tiers (step 3) | S | The memory everything TF-like needs; invisible, riskless |
| 3 | Triggers + queue + `held-train`, `red-signal`, `first-levy`, `tax-warning` (step 4, four hints) | M | The four "is it broken?" moments; all world/HUD-row anchored, all signals exist |
| 4 | HUD anchors + `undo-window`, `camera` (step 5) | S–M | Needs the slot layer; the two chrome hints ride it |
| 5 | Hints on/off + reset (step 6) | S | Ships with the first tier-2 content, not before |
| 6 | Campaign level lessons (step 2) | S each | Content; lands with each Part B level, not ahead of them |

Testing per step stays the pattern PR #130 set: the controller logic headless
(`coach.spec.ts` grows trigger/cooldown/dwell/tier cases), the store like
`objectiveStore`'s tests, one e2e per new interaction shape (a `held-train`
hint appearing and clearing on `/test/heldby`), `npm run probe` after any
renderer change.

---

## 6. The decisions this document is recording

1. **Both tiers, one engine** — not "tutorial OR contextual help". The
   campaign teaches verbs on schedule; the TF layer catches concepts wherever
   they first happen. A mark is a mark; `tier` + `trigger` are the whole
   difference.
2. **Lessons are session-scoped, concepts are player-scoped.** A reloaded
   campaign level re-teaches; a concept once seen is seen for ever (until
   Reset hints).
3. **Dwell-dismissal exists but only for info-only hints** — the
   action-is-the-dismissal rule stays the default and the preference.
4. **Gridlock and bankruptcy keep their dedicated UI** and get no bubble.
5. **One bubble, cooldown between hints, two sentences max** — the TV2
   chrome-density lesson, applied to the teacher itself.
