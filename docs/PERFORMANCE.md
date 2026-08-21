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

## Baseline (2026-08-22, Windows dev machine, node 24, headless bench)

Steady-state ms per `advance(1/60)` tick (avg over the stated window):

| case | state | avg ms/tick | p95 | note |
| --- | --- | --- | --- | --- |
| demoworld (20x14, 3 trains, 26 cars) | steady | **1.0** | 1.9 | comfortable |
| perfworld, trains only (8 trains, 0 cars) | steady | **0.3** | 0.6 | rail is cheap |
| perfworld + traffic (fills to 160 cars) | filling→steady | **18–31** | 24–46 | 1–2x the whole frame budget |
| perfcity (everything, citizens mode) | normal day | **13–15** | ~20 | model alone ≈ frame budget |
| perfcity | citizens' morning rush (window ≥135s) | **27–37** | 50–70 | rush hour doubles the tick |
| road sim alone, crossings open | 50 cars | **1.0** | 1.2 | |
| road sim alone | 100 cars | **2.8** | 3.5 | |
| road sim alone | 200 cars | **12** | 16 | 2x cars ≈ 4x cost |
| road sim alone | ~357 cars | **120** | 256 | congestion collapse |

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
3. **The crossing-closed predicate.** `game.advance` hands the road sim
   `id => sim.reservedBy(id) || sim.occupiedBy(id) || claimed.includes(id)`
   (`src/game.ts` ~3385). Measured: ~630 calls/tick on perfworld, up to
   ~3.5ms/tick (~25% of the tick). Each `occupiedBy` is a full train scan that
   builds a fresh body-tile Set per train per call (`occupantOf`,
   `src/sim/simulation.ts:828`, `bodyClaimKeys` in the browser profile).
4. **The fill-fast spawn storm.** `fillFast` retries EVERY map entry EVERY tick
   until the cap is reached; each attempt plans a route (seeded BFS,
   `roadRouter.ts planRouteToGoals` — top of the browser profile). On a jammed
   board the cap is never reached and the storm runs for ever. Measured in the
   browser: car cap 0 → 18ms/tick, cap restored → 38–120ms/tick, same 23 live
   cars.
5. **Per-frame render mirrors that scale with the WORLD, not with activity.**
   `updateReservations` and `updateStationQueues` iterate every level tile
   every frame (`src/game.ts:2593/2640`) — 1120 tiles on the stress boards,
   each `occupiedBy(id)` a full train scan (see 3). `updateRoadCars` does
   `roadCars.find(...)` per body unit per frame on a reactive array
   (`src/game.ts:2771`) — O(cars²) proxy reads.
6. **SVG DOM path sampling.** Train/car placement measures positions with
   native `getTotalLength`/`getPointAtLength` on cached `<path>` elements,
   2–3 calls per coupler per frame (`src/game.ts:2361–2374`); it shows up in
   browser profiles and costs nothing headless (pure fallback). All tile paths
   are straights and quarter-arcs — closed-form math exists.
7. **DOM size.** 40x28 renders ~64k nodes (~55 per tile); every tile component
   is mounted whether or not the camera can see it.

## The improvement plan (in leverage order)

1. **Spatial index in the road sim.** Maintain `tileId → Set<vehicle>`
   incrementally as bodies move (the body memo already knows its tiles);
   `clearAhead`/junction/lane-change scans then look up only vehicles on their
   route tiles. Turns the quadratic column near-linear. Verify with the
   state-trace hash (KNOWHOW → SIM HOT PATH: `ed41e161…5723`) — this must be
   behaviour-neutral.
2. **Per-tick closed-crossing set.** Build the set of closed tile ids ONCE per
   `advance` (reservations map + an incrementally-maintained occupancy map in
   the sim) and hand the road sim a `Set.has` closure. Kills cost item 3; also
   fixes item 5's `occupiedBy` scans if the sim keeps `tileId → trainId` as
   trains move instead of deriving it per query.
3. **Spawn backoff.** When a fill-fast attempt at an entry fails, skip that
   entry for a second or two of sim time (per-entry cooldown) and cache the
   planned route per entry while the level is unchanged. Kills item 4 without
   changing spawn behaviour on an open map.
4. **Render mirrors keyed by activity.** Mirror reservations/occupancy from sim
   EVENTS (reserve/release already exist as events) instead of polling every
   tile per frame; index `roadCars` by id in a Map for O(1) reconciliation.
5. **Closed-form path sampling.** Replace `getPointAtLength` with the pure
   geometry used headless (straight lerp + arc parameterisation) so browser and
   headless run the same math — removes SVG DOM from the hot loop and one
   browser/headless behaviour difference.
6. **Camera culling.** Render only tiles intersecting the viewport (+margin);
   at typical zoom that is 10–20% of a 40x28 board. Biggest DOM win, most
   invasive change — measure 1–5 first.

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
