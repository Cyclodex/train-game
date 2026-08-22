# Bike destination parking — where the bicycle stands all day

Date: 2026-08-21
Status: BUILT — all three tasks shipped on this branch. Task 1 (the return
half: `Citizen.parkedBike`, the held stand, the reversed B+R quote) and task 2
(`tiles/workplaceBikeRacks.ts`, `/test/bikeforecourt`) 2026-08-21/22; task 3
(wild parking: `parkedBike.wild`, `bikeSearchSec` charged to the journey, the
evidence-only quote surcharge, leaning-bike rendering, `/test/bikeoverflow`)
2026-08-22. Pins in `tests/unit/citizenBikes.spec.ts`.

## The question

A cycling citizen is a real bike on the road (bicycle spec phase C′), but at the
destination the bike **locks at the door and evaporates** (`citizens.ts` ~:1502:
"A BIKE: no. It locks at the door"). Nothing accumulates at the factory gate,
racks never fill outside the station, and the bike is not held between journeys
— the "return half" debt named in IMPROVEMENTS.md.

The cars answered the same question as **a ladder, not a rule**
(`2026-08-04-workplace-parking-design.md`): a derived forecourt that is
deliberately too small, authored parking as the player's lever, and an informal
kerb backstop so a saturated network slows people but never strands them
(`kerbOverflow.ts`). Bikes get the same ladder, scaled down.

## Decisions (user-approved 2026-08-21)

- **Ladder approach (variant A).** Derived mini-racks at work/shop plots; the
  player extends with the existing editor `bikerack` tool; wild parking is the
  visible backstop. No building-upgrade UI (variant B rejected for now); no
  abstract reputation stat (variant C rejected).
- **Reputation flows through the journey**, per canon ("the player cannot act
  on a mood, only on the journey that produced it", `citizens.ts` ~:262): a
  rider who must wild-park pays extra seconds; those seconds enter the existing
  journey scoring and mood. No fourth `CityHappiness` topic now (the code warns
  a fourth topic drags `recompute()`/HUD); an "Ortsbild"/streetscape topic is a
  possible later extension, out of scope here.
- **Home stays free.** The bike sleeps in the shed, as `bikeOwner` always
  implied. No home bike parking mechanic — there is no interesting scarcity.

## Task 1 — the return half (foundation, sim-only)

The bike persists at the far end, holds its stall through the dwell, and is
resumed for the ride home — the exact contract the commuter's car already has.

- `Citizen.parkedBike` sibling of `parkedCar` (`{ tripId, at }`); a bike mode
  never resumes the parked car and vice versa (different vehicle, existing
  comment ~:1463 stays true).
- Plain bike trip to work/shop: dispatch with a parking destination targeting
  **`BayClass "bike"` stalls** near the destination (small search radius, own
  tuning constant `bikeParkTiles` ≈ 2 — do NOT reuse `PARK_SEARCH_TILES`).
  If no rack stand is free at dispatch, fall back to today's lock-at-door
  (task 3 replaces that invisible fallback with visible wild parking).
- The stand is **held for the working day** — dwell owned by the citizen, not a
  timer, like the car's bay.
- Going home: `driving.resume` the parked bike (kind `"bike"`); the bike rides
  home and is retired at the door (the shed).
- Bike-and-ride: the racked bike at the station is held all day; the return
  trip rides the train back, walks platform→rack, resumes the bike, rides home.
  Scope is **bikes only** — the P+R car's return half is a separate ticket
  (shared machinery welcome if it falls out, no scope creep).
- Mode quoting **unchanged** in this task: the bike keeps its no-parking-cost
  edge until task 3 adds the search-seconds reality. The bicycle spec §6
  acceptance stands: bikes eat walk-or-drive share, never transit share.
- Departure-by-other-means: mirror the car's rules where they apply; the shed
  exemption at home mirrors the drive exemption.
- Tests: extend `tests/unit/citizenBikes.spec.ts` (held stand across the dwell,
  resume on the return leg, B+R round trip, no-rack fallback). Sim-only — no
  screenshots needed. Verify `/test/citizenbike` still passes validation.

## Task 2 — derived mini-racks at the gate (tiles pass)

Every work/shop plot grows a few bike stands, the way it grew three staff bays.

- New pass `tiles/workplaceBikeRacks.ts` — `deriveWorkplaceBikeRacks(level, …)`,
  the sibling of `deriveWorkplaceParking` (one pass per file, the repo pattern).
- **6 stands per plot** (a short `bikerack` row, not the full 16/tile): enough
  for the first arrivals, deliberately too small for the workforce — the gap is
  the mechanic, same as `STAFF_BAYS_PER_PLOT = 3`.
- Placement: on a road tile of the plot's frontage, class `bike`, walk-in as the
  stall kind already is. The 3 car staff bays fill their kerb run edge-to-edge,
  so the rack must land on a neighbouring frontage tile or another valid bank —
  resolve with the existing `bankFor`/`kerbRunClash`/`validateParking` gates;
  any row the validator rejects is dropped, the pass stays idempotent (both
  properties the car pass already has — copy its discipline).
- Ambient dwell like `STAFF_DWELL_SEC` so road-sim riders use the stands too.
- Wire into the citizens mode `setup` right after `deriveWorkplaceParking`.
- Scenario `/test/bikeforecourt`: one works, its mini-rack, more cyclists than
  stands — the fill-up is the thing you watch. Register in `DOMAINS`, add
  before/after screenshots (`npm run shot`).

## Task 3 — wild parking, the visible backstop (after 1+2)

Where every stand in reach is taken, the bike is left leaning — never stranded.

- Sim: the no-rack fallback from task 1 becomes a **wild park**: `parkedBike`
  gains `wild: true`; the bike stands near the destination plot's frontage and
  is resumed from there for the ride home.
- Cost: `bikeSearchSec` extra seconds charged to the journey (the
  canon-conform "reputation" — it lands in mood via the existing scoring), and
  the cost may rise mildly with the local wild count. Slow, never strand.
- Rendering: leaning bikes on the pavement band near the driveway — small
  rotated bike divs, seeded lean/scatter by id (determinism canon), clutter
  grows visibly with count. Renderer-only; pedestrians ignore them (the footway
  module refuses conflict modelling by design).
- Scenario `/test/bikeoverflow`: mini-rack saturated, wild bikes accumulating
  at the gate. Screenshots.
- KNOWHOW: add the facts (bike ladder, wild-park cost path); IMPROVEMENTS:
  strike the "return half" debt, note the Ortsbild follow-up.

## Why not the alternatives (recorded)

- **Building-upgrade UI**: new interaction axis (plots are derived data, never
  click-upgradeable); the street rack tool already gives the player the lever.
- **Reputation as a standing stat**: violates the journeys-not-moods canon and
  has no player lever; the journey-seconds path prices the same fact.
- **Home bike parking**: no scarcity, no game — the shed is free by design.
