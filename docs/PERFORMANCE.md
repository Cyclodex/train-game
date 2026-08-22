# PERFORMANCE — measuring, monitoring, where the time goes

How to measure this game's performance repeatably, what the numbers were when
this was written, and which code is responsible. Update the baseline table
whenever a change is supposed to move it — a perf claim without a bench row is
an anecdote.

## The instruments

**1. The stress boards.** Two registered scenarios exist purely to be measured
(and are valid, playable levels, so they measure the real game):

- `/test/perfworld` · `/#/play?board=perfworld` — 40x28 (4x demoworld's area):
  a signalled rail ring, 8 depot spurs, 8 trains, a 6x4 street grid (24 road
  junctions), 20 level crossings, authored traffic up to 160 cars
  (`src/levels/test/scenarios/perfworld.ts`). Measures the traffic + rail load.
- `/test/perfcity` · `/#/play?board=perfcity` — the same skeleton plus
  EVERYTHING: 6 stations, 3 passenger line trains + 4 freight, 4 citizen towns
  (pedestrians, commuter cars, citizens mode), 2 bus lines with halts, park &
  ride, a works car park, and a car/truck/semi/bus/bike/motorcycle mix
  (`src/levels/test/scenarios/perfcity.ts`). Measures the whole game at once.

**2. The headless bench** — the reliable meter. It times `game.advance(1/60)`
(the world tick without rendering) and the road sim alone, printing per-15s
windows (avg / p95 / max ms per tick):

```bash
PERF=1 npx vitest run tests/unit/perf/perfBench.spec.ts
```

(PowerShell: `$env:PERF='1'; npx vitest run tests/unit/perf/perfBench.spec.ts`.)
Without `PERF=1` every case skips, so CI never pays for it. Reading it: a 60fps
frame budget is 16.7ms and the tick is only the MODEL's share — rendering comes
on top — so **tick avg > ~4ms is a red flag, > 16ms is unplayable** before a
single DOM write happens.

**3. The frame meter** — `node scripts/frameperf.mjs [--board perfcity]
[--seconds 20] [--density 60] [--profile] [--ablate sim|cars|tiles|nomirror]`.
Launches a VISIBLE browser window (the only kind whose frame rate is real) and
reports fps, the game's own rAF-callback time, the share of long frames, and the
browser's script/style/layout split via CDP. `--ablate` removes one layer at a
time, which is how the table below was produced. THIS is the meter that matters
to a player; the headless bench above only sees the model.

**4. In the browser by hand.** PlayView exposes the live game as `window.__game`. Real
frame numbers need a VISIBLE window — a hidden/automation tab not only stops
rAF (KNOWHOW → VERIFY), Chrome also deprioritises the whole renderer, so
wall-clock timings taken there overstate cost several-fold; treat them as
structure, not as absolutes. The dev server sends `Document-Policy:
js-profiling` (vite.config.ts) so the JS Self-Profiling API works in dev:

```js
const p = new Profiler({ sampleInterval: 10, maxBufferSize: 100000 });
// ... let the game run ...
const trace = await p.stop(); // aggregate trace.samples by frame
```

## How to measure so the number means something

**Never compare two runs taken at different times.** This machine produced a
3.6x swing between two runs of IDENTICAL code (the simulation is deterministic,
so the WORK was byte-for-byte the same) — background load, thermal state and JIT
warmth all move it more than most optimisations do. A before/after pair taken an
hour apart measures the machine, not the change; that mistake was made here on
the first round and inflated a real 1.4x into a reported 2x.

The method that holds up:

1. **Alternate the variants back to back** in one sitting — new, old, new, old.
2. **Repeat at least three times** and compare the groups, not single runs.
3. Look for **separation**: three-and-three with no overlap is a result; two
   runs a minute apart are not.
4. Quiet machine, and say whether it was on AC. Battery throttling is real, but
   measured here it moved the numbers far less than background load did.

And beware isolating a component: the old crossing gate measured **3.5ms/tick**
in a tight microbenchmark of its 630 calls, but removing it from the real tick
saved **1.4ms**. In situ is the number that counts.

## Baseline (2026-08-22, quiet machine on AC, node 24, headless bench)

Steady-state ms per `advance(1/60)` tick, averaged over the 60–150s windows,
from the alternating A/B described above (3 reps per variant).

| case | before (old gate) | after | ratio |
| --- | --- | --- | --- |
| perfworld + traffic (160 cars) | 5.07 / 5.12 / 5.28 → **5.16** | 3.83 / 3.79 / 3.60 → **3.74** | **1.38x** |
| perfcity (everything, citizens mode) | 6.26 / 6.41 / 6.56 → **6.41** | 4.56 / 4.58 / 4.83 → **4.66** | **1.38x** |
| perfcity, the citizens rush windows | **6.39** | **4.74** | 1.35x |

Single-run figures for the cases not in the A/B (quiet AC, current code):

| case | avg ms/tick |
| --- | --- |
| demoworld (20x14, 3 trains, 26 cars) | 0.45 |
| perfworld, trains only (8 trains, 0 cars) | 0.17 |
| road sim alone, 50 cars | 0.73 |
| road sim alone, 100 cars | 2.08 |
| road sim alone, 200 cars | 7.4 |
| road sim alone, 357 cars | 24.8 |

**The road sim is the ceiling, and it is superlinear** — roughly cost ∝ cars^1.7
(twice the cars costs about three times as much). At 357 vehicles the road step
alone is 24.8ms, past the whole 16.7ms frame budget before anything is drawn.
Rail is noise by comparison: eight trains on a 40x28 board are 0.17ms.

**Corrections to the first version of this file.** It was written from
load-contaminated runs; the errors are kept visible so the numbers are not
trusted twice:

- The improvement is **1.4x, not the ~2x first reported**.
- "The citizens' morning rush doubles the tick" was **wrong** — that spike was
  background load. On a quiet machine perfcity's rush windows cost the same as
  its ordinary ones (4.74 vs 4.66ms).
- The road scaling curve was overstated at the top end: 357 cars is **24.8ms**,
  not the 120ms first recorded.
- The "small boards may be a wash" worry was also load: demoworld is 0.45ms.

## Where the time goes (receipts)

Measured on the bench + browser profiles, in descending order of leverage:

1. **Road-sim pair scans.** `clearAhead`, `leaderAhead`, `passingWindowClear`,
   `laneClearForChange` each walk EVERY other vehicle per car per tick
   (`src/sim/road.ts` ~2634/1971/1987/1727). The 2026-08-01 memo + spatial
   prune (KNOWHOW → SIM HOT PATH) made each pair cheap, but the candidate set
   is still all-pairs — hence the superlinear scaling above. With the gate
   fixed this is the biggest remaining cost by a distance.
2. **Junction arbitration scans.** Per approaching car per junction,
   `activeMovementsAt` and `waitingCarsAt` walk every vehicle again
   (`src/sim/road.ts:2116/2135`).
3. ~~**The crossing-closed predicate.**~~ **FIXED 2026-08-22.** `game.advance`
   handed the road sim `id => sim.reservedBy(id) || sim.occupiedBy(id) ||
   claimed.includes(id)`, and the road sim asks that per route tile per car per
   tick: **629 calls/tick** on perfworld, each `occupiedBy` a full train scan
   rebuilding every train's body claim keys. It is now one `sim.claimSnapshot()`
   per tick behind a `Set` (`src/sim/simulation.ts`, `claimSnapshot`), measured
   at **0.02ms/tick and 0 per-tile queries**.
   · WORTH **1.4ms/tick** in situ — a 1.38x tick, measured by alternating A/B
     (see the baseline). NOT the 3.5ms the same 630 calls cost in an isolated
     microbenchmark, and not the ~2x first claimed here from runs taken under
     different machine load. The component was expensive; the tick it sat in
     was not paying all of that.
   · Exact, not approximate: `sim.step()` runs BEFORE `roadSim.step()` in
     `advance`, so no train moves while the road sim is stepping and every one
     of those calls was already returning the same answer.
   · The snapshot reproduces the queries' flyover level precedence and
     first-train-wins tie-break, and `tests/unit/sim/claimSnapshot.spec.ts`
     pins that equivalence tile-by-tile across five boards — plus a budget guard
     that fails if per-tile polling ever comes back (nothing else in the suite
     would notice: correctness is unchanged, only the cost).
4. **The fill-fast spawn storm.** STILL OPEN, and deliberately so — see the
   note below, it is a decision rather than a free win. `fillFast` retries every
   map entry every tick until the cap is reached; each attempt plans a route
   (seeded BFS, `roadRouter.ts` — top of the browser profile) and only THEN
   probes whether the entry lane is clear, so on a jammed board it pays a
   discarded BFS per attempt, for ever, because the cap is never reached.
   Measured in the browser: car cap 0 → 18ms/tick, cap restored →
   38–120ms/tick, same 23 live cars.
5. ~~**Per-frame render mirrors that scale with the WORLD, not with activity.**~~
   **FIXED 2026-08-22.** `updateReservations` walked every level tile per frame
   asking `reservedBy`/`occupiedBy` about each (1120 tiles x trains on the
   stress boards); it now reads one `claimSnapshot` and is proportional to what
   is actually claimed. `updateStationQueues` walked every tile to reach the
   handful that are stops, for a "no longer a stop" cleanup branch that was
   dead (`transitStops` is derived once and never mutated); it iterates the
   stops. `updateRoadCars` did `roadCars.find(...)` per rendered body per frame
   over a REACTIVE array — quadratic, every probe through a Vue proxy — and now
   keeps an id→element Map beside it (`roadCarIndex`, holding the reactive
   element, never the raw pushed object, or writes would update nothing
   visible).
6. **SVG DOM path sampling.** Train/car placement measures positions with
   native `getTotalLength`/`getPointAtLength` on cached `<path>` elements,
   2–3 calls per coupler per frame (`src/game.ts:2361–2374`); it shows up in
   browser profiles and costs nothing headless (pure fallback). All tile paths
   are straights and quarter-arcs — closed-form math exists.
7. **DOM size.** 40x28 renders ~64k nodes (~55 per tile); every tile component
   is mounted whether or not the camera can see it.

## THE FRAME A PLAYER SEES — and why it is the real problem (2026-08-22)

The headless bench measures `advance()`, the model. It is blind to `frame()`,
where the mirrors, the DOM writes and Vue's re-renders live — and that is where
this game is actually slow. Measured with `node scripts/frameperf.mjs` in a
VISIBLE window (a hidden tab throttles rAF and would report fiction):

| board | fps | frame ms (mean / p95) | DOM nodes | cars |
| --- | --- | --- | --- | --- |
| perfcity, 60% density | **9.7–12.5** | 23–35 / 35–49 | 64 400 | ~190 |
| demoworld, 60% density | **80.7** | 3.5 / 4.3 | 16 500 | 69 |

Four times the area and 2.7x the cars costs ~7x the frame. **On the big board
the game runs at ten frames a second** — the model tick it was optimised for
(4.7ms) is a rounding error next to it.

### Where the frame goes

Ablations, each removing ONE layer (`--ablate`), 12s runs on perfcity:

| variant | fps | frame ms | reading |
| --- | --- | --- | --- |
| baseline | 9.7 | 35.0 | |
| **sim paused** (world still drawn) | **55.4** | 5.8 | drawing a STATIC 64k-node world is nearly free |
| cars hidden | 8.5 | 47.0 | the vehicles' PAINT is not the bill |
| whole world hidden | 20.2 | 29.8 | even with nothing shown, the frame callback still costs ~30ms |

And the browser's own split (CDP `Performance.getMetrics`, share of wall):
script ~26–30%, style ~5%, layout ~1%, while the main thread is busy ~100% of
the time. So roughly a third of the wall is JS, and most of the rest is paint
and raster of everything that moved.

The two findings that matter:

1. **The frame callback alone (~23–35ms) is already over the 16.7ms budget** —
   before the browser paints anything. About 5ms of that is the model; the rest
   is the render half: mirrors, per-sprite DOM writes, and Vue patching.
2. **A static world is cheap; a moving one is not.** Pausing the sim takes the
   same 64k nodes from 9.7 to 55 fps. The cost is proportional to what MOVES and
   to how much of the page has to be re-painted because of it.

The single biggest JS function in the profile is `sampleWorld` (`game.ts`), at
6% of all samples: the SVG `getTotalLength`/`getPointAtLength` path sampling,
called twice per coupler per unit per frame. Vue's own vnode/patch machinery
(`createVNodeWithArgsTransform`, `patchStyle`, `patchKeyedChildren`, …) makes up
roughly another 40% of the ATTRIBUTED samples.

### Is the browser the limit? No — the DOM is.

Same browser, same machine, same scene scale: a canvas 2D renderer drawing the
equivalent picture — all 1120 tiles blitted from pre-baked tile images with **no
culling**, plus 200 vehicles and 32 train units, all moving:

| renderer | fps | draw ms per frame |
| --- | --- | --- |
| DOM + SVG (the game today) | 12.5 | 23.4 |
| **canvas 2D (same scene)** | **132.7** | **0.92** |

**25x**, and the canvas version is running at the display's refresh cap with
zero long frames. The browser has ample headroom for this game; what has none is
putting a world of 64 000 nodes in the document and asking the browser to
re-style, re-layout and re-paint the parts of it that move, sixty times a second.

Caveats, stated honestly: the benchmark's tile art is simpler than the game's.
That does not change the conclusion, because the technique is bake-once-blit-
many — per-frame cost is independent of how elaborate a tile looks, which is
exactly the property the DOM version lacks. What canvas costs instead is
hit-testing (currently free via DOM events) and accessibility.

### The options, in order of effort

1. **Closed-form path sampling** (small, safe, do it anyway). Replace
   `getPointAtLength` with the arc/lerp math already used headless. ~6% of the
   frame, and it removes a browser/headless behaviour difference.
2. **Camera culling** (moderate). Mount only tiles in view. Cuts the DOM by ~90%
   when zoomed in — but note it buys NOTHING at fit zoom, which is exactly how a
   big board is looked at, so it is not the answer on its own.
3. **Canvas 2D for the world** (the real fix, contained). The architecture is
   already right for it: the simulation is headless and authoritative, and
   `game.ts` already samples every unit's position each frame — today it writes
   those into DOM transforms, and it would instead draw them. Tiles bake once per
   distinct appearance; sprites draw per frame. HUD, panels and the build dock
   stay DOM, where they belong.
4. **WebGL / a sprite batcher** (only if canvas 2D ever runs out). At 0.92ms for
   this scene there is no evidence it is needed.

Leaving the browser (Electron, Tauri) would change nothing: they ship the same
renderer. The problem is not where the game runs, it is what it asks the renderer
to do.

## The improvement plan

**Done 2026-08-22** — all four provably behaviour-neutral: the per-tick
closed-crossing set (`claimSnapshot`), and the three render mirrors
(reservations/occupancy, station queues, the `roadCars` id index). See items 3
and 5 above for what each was and how the neutrality is pinned.

Worth **1.38x on the model tick** (measured properly — alternating A/B, three
reps, see the baseline). Note the bench only calls `advance()`, so it measures
the crossing gate ALONE: the three mirror fixes live in `frame()` and are
invisible to it. Their effect is browser-side and still unquantified — a
visible-window frame measurement is the missing piece.

**The finding that reorders everything else** (see the frame section above): the
MODEL is not what makes this game slow on a big board. At 60% density perfcity
runs at 10 fps with a 4.7ms model tick, and a canvas 2D renderer draws the same
scene 25x cheaper in the same browser. Sim work still matters — it is half the
frame callback at high vehicle counts — but the render layer is now the headline.

**Next, in leverage order:**

0. **Move the world off the DOM (canvas 2D).** The one change that makes big
   boards playable. Contained: the sim is already headless and `game.ts` already
   samples every unit each frame; it would draw them instead of writing DOM
   transforms. HUD and panels stay DOM. See the frame section for the evidence
   and the caveats (hit-testing, accessibility).
0b. **Closed-form path sampling** — do this one regardless, it is small: replace
   `getPointAtLength` with the arc/lerp math already used headless. Measured at
   6% of all profile samples (`sampleWorld`), the biggest single JS function.
1. **Spatial index in the road sim.** Maintain `tileId → Set<vehicle>`
   incrementally as bodies move (the body memo already knows its tiles);
   `clearAhead`/junction/lane-change scans then look up only vehicles on their
   route tiles. Turns the superlinear curve near-linear — this is now the
   biggest remaining win by a distance (the road step alone is 24.8ms at 357
   vehicles). Verify with the state-trace hash (KNOWHOW → SIM
   HOT PATH: `ed41e161…5723`); it must be behaviour-neutral. The trap is that
   `step` advances cars one at a time, so a tick-scoped index goes stale
   mid-tick — key it on car STATE the way the body memo does, or not at all.
2. **Spawn backoff — A DECISION, NOT A FREE WIN.** The obvious fix (probe the
   entry lanes first, skip the BFS when the spawn cannot succeed) is *not*
   behaviour-neutral, and it is worth knowing why before someone "optimises" it:
   · The seeded RNG streams advance on a FAILED spawn today — `planRoute` draws
     its destination (`roadRouter.ts`, one `rng()` call before the search) and
     the parking branch draws `parkRng()`. Skip those and every later spawn on
     the board changes. Every seeded road test and the state-trace hash move.
   · A partial fix that keeps the draws and skips only the search is possible
     for the through-trip (the draw is cleanly separable from the BFS), but the
     parking branch's draws depend on its own search, so it cannot follow.
   · And the lane probe cannot simply be hoisted: for cars the probe ORDER comes
     from `preferredSpawnLane(…, routePlan, …)`, which returns a lane from the
     junction's approach — not provably a member of the entry's usable lanes.
     Probing "all usable lanes" first is therefore not equivalent to probing
     `order`, and could change which spawns succeed.
   · So the honest options are (a) accept a one-off re-baseline of the seeded
     road fixtures and take the win, or (b) memoise the BFS per
     (spawn, target, class) with an invalidation hook on level edits (build-in-
     play mutates the level the router reads). Pick deliberately; do not sneak
     either into a perf pass.
3. **Camera culling.** Render only tiles intersecting the viewport (+margin).
   Worth doing for the zoomed-in case, but note it buys NOTHING at fit zoom —
   where the whole world is on screen, which is how a big board gets looked at.
   A stopgap if the canvas move is deferred, not a substitute for it.

## Regression monitoring

- After any change to `src/sim/road.ts`, `src/sim/simulation.ts`, the citizen
  layer, or the frame loop: run the bench, compare against the baseline table,
  and append a dated row below if the numbers moved. `npm run test:unit:profile`
  still watches the SUITE's time; this file watches the GAME's.
- A change that is supposed to be behaviour-neutral must also reproduce the
  road-sim state-trace hash (KNOWHOW → SIM HOT PATH).
- When the game "feels slow" on a board: reproduce headless first
  (`gameFor(<board>)` in the bench takes any registered scenario id). The four
  cases isolate the layer — trains only / traffic / everything / road scaling.

### History

| date | change | perfworld+traffic avg | perfcity avg | road@200 |
| --- | --- | --- | --- | --- |
| 2026-08-22 | first baseline — LOAD-CONTAMINATED, do not trust | 18–31ms | 13–15ms | 12ms |
| 2026-08-22 | old gate, quiet AC, alternating A/B | 5.16ms | 6.41ms | 7.4ms |
| 2026-08-22 | per-tick `claimSnapshot` + render mirrors | **3.74ms** | **4.66ms** | 7.4ms (untouched) |
