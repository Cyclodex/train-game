# Level pacing — measured against the genre, and what to change

**Date:** 2026-08-22 · **Status:** analysis + the structural fix + the first
re-paced level, all built
**Amends:** `2026-07-27-campaign-and-levels-design.md` Part B — both its session
estimates and its build-order table are wrong, see §3 and §6

The question that started this: *are our levels too easy, or over too fast?*
Answer: **over too fast, by about an order of magnitude, and for a structural
reason rather than a tuning one.**

---

## 1. What we actually ship (measured, not estimated)

Every campaign board played by an optimal script — build the intended route,
dispatch everything the moment it can be dispatched, never dawdle:

| # | Level | Trains | **Measured win** | Part B claimed |
|---|---|---|---|---|
| 1 | `objectives` | 1 | **6.6 s** | — (placeholder) |
| 2 | `buildgap` | 1 | **14.6 s** | — (placeholder) |
| 3 | `lakevalley-open` | 3 | **34.6 s** | "~3 min" |
| | **whole campaign** | 5 | **~56 s** | |

The 34.6 s reproduces the 35 s already recorded in `modes/tycoon.ts`, so the
harness agrees with the earlier hand-measurement.

**The pressure curve runs backwards.** Sampled every 5 s on `lakevalley-open`:
three trains live from t=0, then two, then one, then won. The board holds its
maximum content in its first second and drains from there — the exact inverse
of every difficulty curve in §2.

---

## 2. What the genre does (researched, sourced)

| Game | Level length | Arrivals |
|---|---|---|
| **Train Valley** (2015) | **5–10 min** (developer presskit) | **Spawn timer**, tuned per level — the dev calls the interval the thing "balanced precisely to keep the pace" |
| Train Valley 2 | 20–30 min, some over an hour | Continuous production chains |
| Train Valley Origins (2025) | ~15 min | Back toward TV1 |
| Mini Metro | 10–20 min | Scheduled station spawns, then ramping density |
| Overcooked | 2:30–4:00 authored | Orders every 10–15 s, force-spawned when you are doing well |
| Papers, Please | day 1 = 3 min → day 13 = 8 min | Continuous queue against a shift clock |

**Not one game in the genre uses "every unit present at t=0."** Eight were
checked; all use timed or demand-driven arrivals. The closest analogue is a
Railroad Tycoon cargo quota — and even there the map generates cargo live and
the binding constraint is a year deadline.

**The empirical pacing pattern** — synthesised from shipped games, not a rule
anyone states: **first level 2.5–5 min, level 8 roughly 2× that, then
plateau.** Nothing surveyed opens below 2 minutes. Ours opens at **6.6
seconds**.

Two structural details worth stealing outright:

- **Train Valley's station capacity is one waiting train**, and an overflow
  spawn force-dispatches the squatter after a 5-second warning. The capacity
  *is* the pressure.
- **Overcooked pulls demand forward when you play well** (serving with only two
  orders up force-spawns another) but **caps the backlog at five**, so a
  struggling player does not spiral. Reward without a death spiral.

Sources at the foot of this file.

---

## 3. Why our levels cannot simply be "tuned longer"

Trains cruise at `DEFAULT_SPEED = 0.5` tiles/sec — **2 seconds per tile**. Our
campaign-scale boards are ~9×7, so the longest haul one can hold is ~16 tiles
≈ **32 seconds**.

> Under "N trains present at t=0, deliver them all", level length is bounded by
> *longest haul × 2 s/tile*. **No board that fits on a screen can produce a
> 3-minute level.** A 5-minute one would need a 150-tile haul.

So Part B's session estimates (3–8 min) were never reachable by the levels as
specified — they are 5–13× the arithmetic ceiling. The gap is not tuning.

One fair caveat: 34.6 s is the *optimal* line, not a first-time human's. A
newcomer on `lakevalley-open` genuinely spends 2–3 minutes, because they are
reading the board and learning the build gesture. But that is **learning time,
spent once.** The star structure explicitly asks for replay — Under budget and
Rail baron are arithmetically exclusive, so "the board is worth two runs" — and
on the second run there is no learning left. **The levels are learn-once, then
35 seconds.** The replay the stars demand has no content to sit on.

---

## 4. The fix: timed arrivals (BUILT 2026-08-22)

The machinery already existed and was never turned on. `spawnAtSec`,
`scheduleFor` and `createScheduleSpawner` have shipped since #113 — but only
Puzzle declared a spawner, and exactly one demo board (`timeattack`) carries a
schedule. **We built the pacing engine and then shipped levels that leave it
off.** The spawner and the fare book had therefore never once run together.

Turning it on for Tycoon needed four things, all now in place:

1. `tycoonMode.createSpawner` — the same helper Puzzle uses.
2. `initialActiveTrains` counts the **t=0** trains, not the roster: a scheduled
   train is not a backlog until it exists.
3. **The fare clock starts on arrival.** `FareBook.tick` ages every fare it
   holds, so a train due at t=120 s would have stepped onto the platform
   already at its 25 % floor — a silently unwinnable level, showing nothing but
   a small number on a pin. Its fare is now withheld until it arrives, and
   `FareBook.remove` takes it back out on Retry (`reset()` zeroes ages but
   keeps entries, so run 2 aged it from its own t=0: measured 126 instead of
   490 on the second attempt).
4. **One train per shed**, where trains wait: a due arrival whose depot still
   holds the last one joins the pending queue that ordered trains already use.
   Without it, three waiting trains stack on one tile — three sprites, three
   pins, identical coordinates, and nothing on screen saying there is more than
   one. This is Train Valley's "spawn at a *vacant* station", built out of a
   mechanic we already had. Scoped to `controls.dispatch`: where trains leave
   the instant they appear, the overlap lasts a frame, and a gate there would
   hold arrivals for ever on a shuttle demo whose origin depot never clears.

An arrival lands in the `waiting` state, so it appears at its platform with a
ticking fare and asks to be sent — the Train Valley move, in the mode that
charges for it.

**What this buys, one line each:** a clock that means something · a backlog
that can overflow · a difficulty dial independent of the map · level length
decoupled from board size · overlapping demands, where routing tension lives ·
and a level with a *shape* — rise, rest, spike.

---

### 4b. The second blocker, found by measuring the first level built on it

Turning the spawner on was not enough. The Fork was authored, measured — and
**2 of its 8 trains were delivered**; the other six stacked up the line and the
level could not be finished at all.

**A matched arrival parks in its depot and stays there for ever**, so a station
can receive exactly ONE train per run. That is invisible on a board with one
train per destination, which is every board we had, and it is a hard wall the
moment a timetable sends a second train to the same town.

Train Valley's answer is that the train enters the station and is gone. Ours
now: let it glide in and park (the animation is the reward), then take it out
of the sim a beat later. `renderTrains` already hides the units of any def the
sim does not hold — that is how a not-yet-spawned train stays invisible — so
the sprite disappears with no view change at all. Deliberately NOT
`forgetTrain`, which splices the def out of `trainDefs`: Retry rebuilds the run
from exactly that array, so the roster has to survive. Gated on
`controls.dispatch`, like the shed rule.

With that, The Fork delivers 12 of 12 and runs **125 seconds** — nearly four
times `lakevalley-open` on a **smaller** board (6×6 against 9×7).

---

## 5. The pacing targets to author against

Derived from §2's pattern and scaled to a browser game played in short sittings
rather than Train Valley 2's half-hour marathons:

| Campaign slot | Target | Trains | Shape |
|---|---|---|---|
| 1 First Delivery | 45–60 s | 2–3, staggered | pure onboarding, no fail |
| 2 Mind the Gap | 60–90 s | 3–4 | build once, then a small stream |
| 3 The Lake | **2–2.5 min** | 6–8 over ~2 min | the first real shift |
| 4 The Fork | 2.5–3 min | 12 alternating | **BUILT** — measured 125 s prompt |
| 5 The Squeeze | 3 min | 8 sharing a corridor | queueing is the lesson |
| 6 Single Track | 3.5–4 min | 8–10 from both ends | the passing loop |
| 7–8 | 4–5 min | 10–12 | combinations, no new dial |

Deliberately **below** Train Valley's 5–10 min floor at the start, reaching it
only at the end: this is a browser game, and §2's own numbers show the opening
level is the one nobody stretches.

**Sawtooth, not ramp.** The research is unanimous here, and it is the one thing
our current levels cannot express at all: interest curves are fractal, and rest
beats are a *designed artifact* — Plants vs Zombies puts a minigame at level 5
of every stage; Overcooked withholds the clock until the first dish on a
teaching level. With a timetable we can finally author a lull: a 20-second gap
in arrivals after a spike is now something a level can *say*.

**Keep the fail state as it is.** Train Valley fails on bankruptcy alone;
crashes cost money but never end the round. Ours is already exactly that
(`fail.onBankruptcy`), and it should stay the only one — an overflow fail on a
board where trains queue in sheds would punish the player for the shed rule
rather than for playing badly.

---

## 6. Corrections to the Part B arc

- **Its session estimates are unreachable** as the levels are specified (§3).
  Every level's roster wants re-cutting as a timetable against §5.
- **Its build-order table is wrong** where it calls levels 6 and 8 "buildable
  today": both specify staggered arrivals, which Tycoon could not do until
  today. They are buildable *now*.
- **Money-denominated star targets must be re-measured** per level once its
  timetable exists — Payday scales with the roster, and a longer roster moves
  it. That is the trap `LAKEVALLEY_OPEN_PAYDAY` already documents.
- **`starTimeFor` in `modes/puzzle.ts`** gives a 3-train board a **24-second**
  speedrun star. Against §5 that is a placeholder, not a target.

### What The Fork taught about tuning a timetable

The arrival spacing is the difficulty dial, and it works by deciding **who the
bottleneck is**. Measured on the same board, prompt play against ten seconds of
dawdle per train:

| Spacing | Prompt | Dawdling | Spread |
|---|---|---|---|
| 16 s | 127 s | 137 s | **10 s** — the schedule is the bottleneck; the level cannot tell the two players apart |
| 10 s | 125 s | 183 s | **58 s** — the shed is the bottleneck, and promptness is worth something |

So a timetable is not simply "spread the trains out". Spread them wider than
the round trip and the player's own speed stops mattering, because everyone is
waiting on the clock. **Author the spacing at or just under the round trip.**

The same measurement killed this level's third star. Part B specified Under
budget, but the gap is two tiles on a board with no alternative route, so
everyone who finishes at all earns it — the optimal line takes all three stars
without trying. It was replaced with **On time (145 s)**, which is the axis this
board actually has.

---

## Sources

Developer-primary: [Train Valley presskit](https://flazm.com/pr-train-valley)
(level durations) · [flazm on the spawn
timer](https://steamcommunity.com/app/353640/discussions/0/2592234299566462400/)
· [flazm on forced
departure](https://steamcommunity.com/app/353640/discussions/0/527274088401171757/)
· [Dinosaur Polo Club on the passenger
ramp](https://steamcommunity.com/app/287980/discussions/0/135507780428493386/)
· [Mini Metro modding
schema](https://steamcommunity.com/sharedfiles/filedetails/?id=2295902845)

Design craft: [Pacing — The Level Design
Book](https://book.leveldesignbook.com/process/preproduction/pacing) · [Doing
Difficulty Right: Fractal
Curves](https://www.gamedeveloper.com/design/doing-difficulty-right-fractal-curves)
· [George Fan, GDC
2012](https://www.gamedeveloper.com/design/gdc-2012-10-tutorial-tips-from-i-plants-vs-zombies-i-creator-george-fan)
· [Portal developer
commentary](https://theportalwiki.com/wiki/Portal_developer_commentary)

Lengths: [Overcooked levels](https://overcooked.fandom.com/wiki/Levels) ·
[Train Valley 2 — Wikipedia](https://en.wikipedia.org/wiki/Train_Valley_2) ·
[Transport Fever 2
campaign](https://wiki.transportfever2.com/doku.php?id=gamemanual%3Acampaign)

**Not found, and deliberately not invented:** trains-per-level for Train Valley
1 or 2 (undocumented); whether TV1's spawn rate accelerates *within* a level;
any designer's stated prescription for early-vs-late level length — §2's
pattern is a synthesis of shipped games, not a quoted rule.
