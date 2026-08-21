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

**3. In the browser.** PlayView exposes the live game as `window.__game`. Real
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

## Baseline (2026-08-22 evening, Windows dev machine, node 24, headless bench)

Steady-state ms per `advance(1/60)` tick (avg over the stated window). "before"
is the same bench on the same machine earlier the same day, before the
crossing-gate and render-mirror work below.

| case | state | avg ms/tick | before | note |
| --- | --- | --- | --- | --- |
| demoworld (20x14, 3 trains, 26 cars) | steady | **1.2–1.9** | 1.0 | small-board wash, and a loaded machine — re-measure quiet |
| perfworld, trains only (8 trains, 0 cars) | steady | **0.3** | 0.3 | rail is cheap; unchanged, as expected |
| perfworld + traffic (fills to 160 cars) | steady | **8–11** | 18–31 | **~2.2x** |
| perfcity (everything, citizens mode) | normal day | **5.6–8** | 13–15 | **~2x** |
| perfcity | citizens' morning rush (window ≥135s) | **8.1** | 27–37 | **~4.5x** — the rush spike is gone |
| road sim alone, crossings open | 50 cars | 1.0 | 1.0 | not re-measured: these cases pass their own `() => false` gate, so the change cannot reach them |
| road sim alone | 100 cars | 2.8 | 2.8 | " |
| road sim alone | 200 cars | 12 | 12 | " |
| road sim alone | ~357 cars | 120 | 120 | " — congestion collapse |

Scaling law, unchanged: the road sim is still superlinear in live vehicles. What
changed is the constant — the per-tick cost the whole board paid for the
crossing gate is gone, which is why the citizens' rush (many more vehicles
against the same trains) no longer spikes.

The small-board rows are the ones to re-check on a quiet machine: a snapshot
costs a little more than the handful of queries a tiny board would have made,
so demoworld is expected to be a wash rather than a win, and the numbers above
were taken while other work was running.

Scaling law: the road sim is superlinear in live vehicles — roughly quadratic
at moderate density and worse under congestion (jammed cars re-scan their
blockers every tick). **Car count is the single biggest performance dial**; the
rail sim is negligible at any plausible train count.

Browser overhead on top of the tick (structure, from a throttled hidden tab, so
ratios not absolutes): the per-frame render mirror + DOM writes added ~25% on
perfworld and considerably more on perfcity; the page is ~64k DOM nodes at
40x28 (SVG-heavy tiles).

## Where the time goes (receipts)

Measured on the bench + browser profiles, in descending order of leverage:

1. **Road-sim pair scans.** `clearAhead`, `leaderAhead`, `passingWindowClear`,
   `laneClearForChange` each walk EVERY other vehicle per car per tick
   (`src/sim/road.ts` ~2634/1971/1987/1727). The 2026-08-01 memo + spatial
   prune (KNOWHOW → SIM HOT PATH) made each pair cheap, but the candidate set
   is still all-pairs — hence the quadratic column above.
2. **Junction arbitration scans.** Per approaching car per junction,
   `activeMovementsAt` and `waitingCarsAt` walk every vehicle again
   (`src/sim/road.ts:2116/2135`).
3. ~~**The crossing-closed predicate.**~~ **FIXED 2026-08-22.** `game.advance`
   handed the road sim `id => sim.reservedBy(id) || sim.occupiedBy(id) ||
   claimed.includes(id)`, and the road sim asks that per route tile per car per
   tick: ~630 calls/tick on perfworld, ~3.5ms/tick, about a quarter of the tick,
   because each `occupiedBy` is a full train scan rebuilding every train's body
   claim keys. It is now one `sim.claimSnapshot()` per tick behind a `Set`
   (`src/sim/simulation.ts`, `claimSnapshot`), measured at **0.021ms/tick and 0
   per-tile queries** — a 170x cut on that component.
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

## The improvement plan

**Done 2026-08-22** (all four provably behaviour-neutral, ~2x on the model tick):
the per-tick closed-crossing set (`claimSnapshot`), and the three render mirrors
— reservations/occupancy, station queues, and the `roadCars` id index. See items
3 and 5 above for what each was and how the neutrality is pinned.

**Next, in leverage order:**

1. **Spatial index in the road sim.** Maintain `tileId → Set<vehicle>`
   incrementally as bodies move (the body memo already knows its tiles);
   `clearAhead`/junction/lane-change scans then look up only vehicles on their
   route tiles. Turns the quadratic column near-linear — this is now the biggest
   remaining win by a distance. Verify with the state-trace hash (KNOWHOW → SIM
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
3. **Closed-form path sampling.** Replace `getPointAtLength` with the pure
   geometry used headless (straight lerp + arc parameterisation) so browser and
   headless run the same math — removes SVG DOM from the hot loop and one
   browser/headless behaviour difference.
4. **Camera culling.** Render only tiles intersecting the viewport (+margin);
   at typical zoom that is 10–20% of a 40x28 board. Biggest DOM win, most
   invasive change — measure the rest first.

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
| 2026-08-22 | baseline (this file) | 18–31ms | 13–15ms (rush 27–37ms) | 12ms |
| 2026-08-22 | per-tick `claimSnapshot` + render mirrors | **8–11ms** | **5.6–8ms** (rush 8.1ms) | 12ms (untouched) |
