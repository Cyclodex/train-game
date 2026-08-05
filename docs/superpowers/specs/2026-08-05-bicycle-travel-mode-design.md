# Bicycles — a travel mode, a vehicle, a lane kind, designed

_Status: plan (2026-08-05). Nothing here is built. This is the impact survey and
phased design for bringing bicycles into the game: on the carriageway, in their
own lanes, at the station, in the citizen's mode choice. It is the "phase C"
that `2026-08-01-citizens-and-cities-design.md` §9 promised in one parenthesis
("the bike/moped mode — no parking cost, medium patience — it should be the
winner for the 2–4 tile trips that are currently walk-or-drive"), expanded into
a real plan against the code that exists today._

---

## 0. The pitch, in one paragraph

A bicycle is the missing middle of the mode choice: faster than walking,
slower than driving, cheap to park, and the natural feeder for a countryside
station that has no town at its door. On the road it is a slow vehicle that
makes cars queue — which is exactly the point, because the player's answer to
that queue is **cycle infrastructure**: a painted cycle lane that lifts the
bikes out of the car stream, a rack at the station that turns riders into rail
passengers, a shared foot-and-bike path where there is no road at all. Bikes
give the citizens mode-choice model its fifth option and give the road layer
its first genuinely slow vehicle — and both pressures produce new things for
the player to build.

---

## 1. What already exists (and what this may NOT re-invent)

Nothing bicycle-shaped exists in `src/` today (verified: zero hits for
bike/bicycle/cyclist anywhere in code). But every surface a bicycle needs is
already load-bearing for someone else, and the design below threads those
seams rather than adding parallel ones.

| Exists today | Where | What it means for bikes |
|---|---|---|
| Vehicle kinds as **data** (`vehicleSpec`), "adding a kind is a one-row change" | `src/sim/road.ts:46-98` (`VehicleKind`, `VehicleSpec`, length multipliers) | A bike is a new row: `"bike"`, one short segment, small gap. |
| Lane-access **classes** with one gate | `src/tiles/lanes.ts:8-20` (`LaneKind = "all"\|"bus"`, `VehicleClass = "car"\|"bus"`, `laneUsableBy`) | The literal extension point for cycle lanes. `LaneKind` says "extensible" in its own comment. |
| Bus-lane machinery end to end: routing, lane preference, spawn filtering, signal priority, painted surface | `roadRouter.ts` (class-aware BFS), `road.ts:1404-1413` (drift to bus lane), `junctionSignal.ts:36-46` (bus headstart) | The template for every per-class behaviour a bike needs. |
| **Bus stops as a parking stall kind** — zero depth, no manoeuvre, class-gated, on-lane halt | `src/tiles/parking.ts:49-66` (`StallKind "busstop"`, `stallOnLane`), `src/sim/parking.ts:55-100` (`BayClass`, `bayAdmits`), `roadParking.ts:415-425` | The proof that a stall kind with no car-shaped manoeuvre fits the parking model. A bike rack is the same trick with the opposite sign (off-lane, walked in). |
| **Pedestrians**: pavements as a tile axis, a walker sim, zebra + rail crossings | `src/tiles/footway.ts`, `src/sim/pedestrians.ts`, `TileCell.footway` (model.ts:104) | The precedent for people-not-cars — and the axis a shared foot/bike path extends. |
| **Citizens** who price every mode and pick the cheapest | `src/sim/citizens.ts:28-29` (`TravelMode`), `:643-749` (`quoteModes`), `:1003-1011` (`arriveFromDrive`, the park-and-ride hinge) | The bike mode is one more branch in `quoteModes` and one more member in `TravelMode`. The spec already reserves it. |
| **Park & ride**, both the ambient and the citizen path | `game.ts:1552-1588` (`transferParkedArrivals`), `citizens.ts:614-628`/`720-746` | Bike-and-ride is park-and-ride with a cheaper vehicle and a cheaper stall. |
| **Terrain** as the urban/rural axis | `src/tiles/terrain.ts` (`TerrainKind "urban"`), `tiles/catchment.ts` | The city-vs-countryside question is already answerable per tile. Themes are cosmetic; terrain is the real axis. |

Canon rules that constrain everything below:

- **The sim is terrain-blind** — map reading lives in `tiles/`, the sim executes
  a description (`citizens.ts:14-26`, KNOWHOW "CITIZENS & CITIES").
- **A pavement is NOT a Lane** (`tiles/footway.ts:9-35`): bidirectional, one
  strip, users may overlap. Every following/conflict gate in `road.ts` exists to
  forbid exactly those three properties.
- **Never model a stall as a Lane into Center** (KNOWHOW "PARKING") — the tile
  becomes a junction and the sim despawns whatever exits through it.
- **Availability is never gated on a preference** (`citizens.ts:43-48`) — a
  patience field shapes cost, ownership shapes availability.
- **Determinism**: every traffic stream is seeded. Anything that adds an RNG
  draw re-rolls every seeded board (the generated-terrain lesson: own stream or
  zero-impact defaults).

---

## 2. What kinds of cycling exist on earth — and which we support

The user question "what differences exist so we know what we want to support",
answered as a taxonomy. Real-world cycle infrastructure comes in roughly six
shapes:

| # | Real-world form | Example | Supported? |
|---|---|---|---|
| 1 | **Mixed traffic** — bikes ride the carriageway with cars | every side street on earth | **Yes — phase A.** This is the default and needs no authoring. |
| 2 | **Painted cycle lane on the carriageway** (Radstreifen / Schutzstreifen) | the yellow-striped lane in CH cities | **Yes — phase B.** `LaneKind "cycle"`, the bus-lane twin. |
| 3 | **Bikes admitted to bus lanes** | standard practice in CH/DE/UK | **Yes — phase B**, one row in the access matrix. |
| 4 | **Shared foot/bike path** (Fussweg "Velos gestattet", shared-use path) | countryside paths, park routes | **Yes — phase D**, on the footway axis, after the standalone-footpath blocker falls. |
| 5 | **Fully separated cycle track on its own alignment** (Radweg, NL-style) | Dutch protected intersections | **Not now.** On a 200px tile a separate parallel carriageway per direction is a rendering and junction-geometry project of its own. The painted lane (2) plus the shared path (4) cover the gameplay. Revisit if bikes earn a bigger role. |
| 6 | **Contraflow cycling on one-way streets** | "cyclists excepted" signs | **Not now.** The lane model can express it (a single opposing `kind: "cycle"` lane), but the seam/taper painting and `oneWayRunMax` assume one direction; defer until a board wants it. |

E-bikes, mopeds, cargo bikes: **one kind**. The citizens spec says
"bike/moped" in one breath; per-variant speeds are the same dial as driver
profiles (IMPROVEMENTS road item 10) and can wait.

---

## 3. Phase A — the bike as a road vehicle (mixed traffic)

**Goal:** bikes exist, ride the carriageway, are slow, and make cars queue.
No new lane kinds yet; this phase is deliberately the smallest thing that puts
a bicycle on screen.

### 3.1 Kind, class, spec

- `VehicleKind` gains `"bike"` (`road.ts:46`); `VehicleSegment.part` gains
  `"bike"` (`road.ts:48-51`).
- `BIKE_LEN ≈ 0.45` of a car body (≈17px at the 200px tile) beside the existing
  multipliers (`road.ts:65-72`); `vehicleSpec` gets its promised one-row case.
- `vehicleClassOf`: **bikes get a new `VehicleClass "bike"`** even in phase A
  (rather than temporarily riding as `"car"` and migrating later) — the class
  threads ~15 lane queries and two sims, and doing the rename twice is the
  expensive path. In phase A the access matrix simply grants `"bike"` the same
  lanes as `"car"`, so behaviour is identical until cycle lanes land.

### 3.2 Speed — the first genuinely slow vehicle

Today **no** vehicle kind is slower than another: every spawn draws from the
same `carSpeed ± 25%` band (`road.ts:3271`, `3100`); only length differs. Bikes
introduce a per-kind speed factor at the two places speed is drawn:

- `KIND_SPEED: Record<VehicleKind, number>` — car/truck/semi/bus `1`, bike
  `≈ 0.45`. (Trucks arguably want `0.9`; out of scope, but the table makes it a
  one-line follow-up — this resolves IMPROVEMENTS road item 10's "truck
  slowdown" half for free.)
- Accel/brake scale similarly (`DEFAULT_CAR_ACCEL`/`BRAKE`, `road.ts:791-792`)
  so a bike pulls away gently.

**Consequences, all intended:**

- On a one-lane road a car **queues behind the bike** (the follower model does
  this for free). That friction is the phase-B incentive; do not "fix" it.
- On multi-lane roads the existing overtaking machinery passes bikes already:
  the trigger is purely speed-differential (`considerOvertake`,
  `road.ts:1888-1908`), and a 0.45× leader trips it immediately. Bikes
  themselves never overtake: extend the existing `cls !== "bus"` overtaker
  exclusion (`road.ts:3262`) to bikes.
- **Same-lane squeezing past a bike is NOT modelled.** Width is a single global
  constant (`CLIP_LANES = 0.72`, `road.ts:854-863`), not per-vehicle. Making it
  per-vehicle so a car can share a lane band with a bike is the one structural
  cost in the whole plan, and phase A deliberately skips it — queue or change
  lane, like a law-abiding driver. Revisit only if boards feel wrong.
- Oncoming-lane overtaking stays deferred (IMPROVEMENTS road item 8); bikes
  raise its value but do not change its design.

### 3.3 Spawning, mix, determinism

- `TrafficMix` (`road.ts:102`) gains `bike?`; `pickKind`'s hard-coded array
  (`road.ts:1086-1098`) gains the kind. **Default weight 0**: a zero-weight
  entry changes no cumulative threshold, so every existing seeded board replays
  byte-identically. Bikes appear only where a scenario or level opts in
  (`traffic.mix: { car: 1, bike: 0.6 }`).
- Bikes spawn in the kerb-most usable lane (already what the class-filtered
  spawn does, `road.ts:3227-3249`) and are subject to the same entry probing.
- `maxCars` density (`game.ts:172-189`) counts vehicles, not lane-metres; a
  bike counts 1 like everything else. Fine at v1 — flagged in §9.

### 3.4 What works with zero changes

Verified kind-agnostic, so free: **level crossings** (`CrossingClosed`,
`road.ts:2319-2325` — bikes stop for trains and for claimed zebras), the
junction **conflict matrix** (keyed `entry:exit` only, `roadJunction.ts:130-134`),
the **arbiter** (priority is the tile's, not the vehicle's), routing
(`planRoute` just takes the class), and `carsDelivered` scoring.

One small seam: junction signals type their aspect query as `cls: "car"|"bus"`
(`junctionSignal.ts:212-219`). Bikes read the car aspect in phase A; the type
widens to `VehicleClass` when the class lands.

### 3.5 Rendering — how a bike is displayed

Road vehicles are **plain DOM divs + CSS**, not SVG sprites (`.road-car`,
`PlayView.vue:2039-2115`, duplicated in `TestStage.vue:690-760` — both must
change, a known trap). A bike is:

- a new `road-car--bike` modifier: ~17px long × **8px high** (CSS height is the
  lateral width; cars are 20, buses 24), higher `border-radius` so it reads as
  a slim capsule, **no `road-car-glass`** (the windscreen span is already
  skipped per-part for trailers — same branch).
- the rider read: a small dark head-dot pseudo-element amidships, and the car's
  `carColor(id)` as the rider's jersey so bikes stay individually trackable.
- same `z-index: 6` as cars, same transform pipeline (`updateRoadCars`,
  `game.ts:2018-2062`). The renderer's class re-derivation
  (`unit.part === "bus" ? "bus" : "car"`, `game.ts:2034`) must learn the new
  part — this is exactly the kind of silent seam the plan exists to list.
- At 8px, livery-first (the rolling-stock lesson, KNOWHOW "ROLLING STOCK ART"):
  one saturated colour, one dark dot, nothing else.

Debug overlays: `CarRouteOverlay` needs nothing; the lane-arrow colouring rule
(`turnLandsOnBusLane`, amber-vs-cyan) gets a third colour when cycle lanes land
(phase B), e.g. green for "lands on a cycle lane".

---

## 4. Phase B — cycle lanes (and bikes in bus lanes)

**Goal:** the player's answer to "bikes are slowing my street": paint a cycle
lane, the bikes move over, the cars flow.

### 4.1 The access matrix

`laneUsableBy` (`lanes.ts:18-20`) is today a one-liner ("bus may use
anything"). It becomes a small explicit matrix — the single source of truth
the codebase already routes every query through:

| lane kind ↓ / class → | car | bus | bike |
|---|---|---|---|
| `all` | ✓ | ✓ | ✓ |
| `bus` | ✗ | ✓ | **✓** (real-world default; see §2 form 3) |
| `cycle` | ✗ | ✗ | ✓ |

- `LaneKind` gains `"cycle"`; `VehicleClass` gains `"bike"` (if not already in
  phase A). Every class-filtered query (`usableExits`, `usableLaneIndices`,
  `junctionExitLane`, `nearestUsableLaneIndex`, …) works unchanged — they all
  call the one gate.
- Lane preference mirrors the bus pattern: a bike with no pending turn drifts
  to the nearest cycle lane (`road.ts:1404-1413` twin), preferring cycle over
  bus over general when several are usable.
- A cycle lane is authored kerb-side (index 0) by convention; `validateLevel` /
  the editor need not enforce it, but the drift rule assumes it.

### 4.2 Capacity and editor

- `deriveJunctionCarLanes` / junction lane capacities are **per class** already
  ("skip bus lanes for cars", KNOWHOW; spec `2026-06-12-junction-lane-capacity`)
  — cycle lanes join the same table.
- `roadCarCapacity` (`game.ts:176-189`) counts `carLaneIndices` only — cycle
  lanes are excluded from car capacity exactly as bus lanes are today (same
  decision, same line).
- Editor: the bus-lane click cycle (`editOps.ts`, spec
  `2026-06-10-buslane-lane-click-design.md`) becomes a three-state cycle
  all → bus → cycle → all. Rendering: cycle lanes get a tinted surface like the
  bus lane's, plus the standard bike pictogram from `roadGeometry.ts`'s
  marking machinery (a small path stamp, same layer as merge arrows).

### 4.3 Junction behaviour

No new conflict logic: a cycle lane's movements enter the same conflict matrix
by `entry:exit`, and `sameEntryConflict`'s lane-order rule already covers
"kerb cycle lane going straight vs inner lane turning right" — the classic
right-hook — because their lateral order inverts. That the model already
catches the right-hook geometrically is a happy accident worth a dedicated
scenario (§8).

---

## 5. Phase C — bike parking and the station (bike-and-ride)

**Goal:** a rack at the station turns cyclists into rail passengers; the
citizen model prices "cycle to the station, ride in".

### 5.1 The rack (`StallKind "bikerack"`)

The `busstop` precedent proves a stall kind can opt out of car geometry. A rack
is the mirror image — off-lane, no manoeuvre, high density:

- `StallKind` gains `"bikerack"` (`tiles/parking.ts:53-58`); NOT `stallOnLane`.
- Own `DEPTH_FRAC` (~0.08) and `PITCH_FRAC` (~0.09): a rack row packs ~10
  stalls where 3 cars fit. `maxStallsPerTile` derives from pitch as today.
- **No manoeuvre**: `beginEntering` short-circuits exactly as the halt does
  (`roadParking.ts:415-425`) — the bike stops at the kerb and is "walked in"
  (phase = `parked`, zero body points, out of every gate — the `parked`
  invariant, KNOWHOW "CAR PHASES"). The whole Bézier/pivot/courtesy machinery
  (`TURN_IN_CLEARANCE_FRAC`, `pivotReverseLegs`, pull-out arbitration) is
  bypassed, not extended.
- `BayClass` gains `"bike"`; `bayAdmits` is an **exhaustive switch by design**
  ("adding a bay class without deciding who may use it should not compile",
  `sim/parking.ts:78-100`) — bike → bike only, and every other class refuses
  bikes. The size gate would pass a bike into any car bay; the class gate is
  the only fence. Do not weaken it.
- Rendering (`parkingGeometry.ts`): a row of small hoop/stand ticks instead of
  bay boxes; sign glyph a bike pictogram (the sign already switches H/P by
  facility class — same switch, third arm).
- Optionally later: a covered "Velostation" as the garage twin
  (`stallIsHidden`, count = capacity) for city-scale racks. The garage
  machinery already supports hidden high-capacity stalls; v1 ships open racks
  only.

### 5.2 The transfer — and the two predicates that must learn bay class

- `transferParkedArrivals` (`game.ts:1579-1588`) works unchanged: a rack stall
  going free→taken within `WALK_RADIUS_TILES` of a station injects
  `transferSizeOf` passengers. A rack row returns **1** (the "anything else"
  arm already does) — correct, one rider per bike.
- **Trap found by this survey:** `parkAndRideStationsOf` qualifies a station on
  *any* parking row in walking reach (`cities.ts:416`). Add bike racks and
  every station with a rack silently becomes a car park-and-ride target. The
  predicate must filter by bay class: car-admitting rows ⇒ P+R,
  bike-admitting rows ⇒ bike-and-ride (`bikeAndRideStationsOf`, the sibling).
- **Catchment radius:** `WALK_RADIUS_TILES = 2` is one constant shared by
  station demand, P+R targeting, and stations-in-reach (`catchment.ts:18`). A
  cycling range must be its **own constant** (`BIKE_RADIUS_TILES ≈ 5`,
  Chebyshev, used only for bike-and-ride targeting) — raising the shared one
  would inflate every station's demand schedule.

### 5.3 City vs countryside (the bus-station question)

The user's instinct — "bus stations only countryside, not in the city" — maps
onto machinery that already exists, and needs **no hard gate**:

- The urban/rural axis is **terrain** (`TerrainKind "urban"`), not the theme.
  Station demand, station architecture, and citizen plots all read it already.
- In the citizen model the split falls out **economically**: in town, stations
  are near plots, so walk + transit wins and a bike quote rarely beats it; in
  the countryside, plots sit beyond `walkMaxTiles` and the bike (range ~2×
  walking) or the bus feeder is the only access mode that reaches the station.
  Pricing does the gating; authoring does the rest (put bus halts on rural
  boards, racks at rural stations).
- Guidance, not enforcement: `/test` boards should demonstrate the pattern
  (§8), and a validator warning ("bus halt on dense urban ground") is possible
  later but not planned — the model is meant to punish it with queues, not
  forbid it.

---

## 6. Phase C′ — citizens ride bikes (`TravelMode "bike"` and `"bikeAndRide"`)

The citizens spec reserved this. The seams, verified against the live code:

- `TravelMode` union + `TRAVEL_MODES` (`citizens.ts:28-29`) gain `"bike"` and
  `"bikeAndRide"`. **Every hand-written `Record<TravelMode, number>` sum must
  follow** — `CityState.modeShare` (:188), `modeCounts` (:441/:452/:456),
  `modeTotals` (:476-481), `recompute()` (:1296-1308), `stats()` (:1346-1367),
  `CitizenHud` (`game.ts:1213`), and the mode-share bar in the HUD. These sums
  under-report silently rather than fail — the mechanical risk of the whole
  phase, worth a unit test that iterates `TRAVEL_MODES` against each record.
- `TravelProfile` (:40-49) gains `bikeOwner` (drawn against a
  `tuning.bikeOwnership ≈ 0.7`) and `bikeAffinity`. Ownership gates
  availability; affinity shapes cost — never the reverse (:43-48).
- `CitizenTuning` gains `bikeSpeed ≈ 0.45` tiles/s (walk 0.25, car 0.6),
  `bikeMaxTiles`, `bikeAccessSec`-nothing — the flat `walkAccessTiles`
  door-to-kerb charge stays charged to every mode equally (the :223-242
  lesson; a bike leg inherits it, never re-prices it).
- `quoteModes` (:643-749) gains two branches: BIKE (template: the WALK branch's
  patience/impatience curve, but `bikeSpeed`, `roadDetour`, and the road-
  component requirement of the CAR branch — a bike needs a connected road/lane
  network); BIKE-AND-RIDE (template: the P+R branch verbatim —
  `nearestBikeAndRide` on the same road component, blended affinity, then
  ride + egress). New `ModeRefusal` members: `"no-bike"`, `"no-rack"`.
- **A cycling citizen is a bike**, the way a driving citizen is a car
  (KNOWHOW: `roadSim.requestTrip` dispatches a real vehicle, no clock while
  the trip lives, timer fallback when the road refuses). `requestTrip` takes
  the kind; the bike despawns at the address or racks at the station, and
  `arriveFromDrive` (:1003-1011) is the exact hinge where "locked the bike,
  now wait for the train" already lives for cars.
- `stats().driving`/`onFoot` (:333-337) gain a `cycling` sibling; HUD follows.

**The one number that can break the game** (KNOWHOW "THREE NUMBERS DECIDE
WHETHER A BOARD IS ABOUT TRANSPORT AT ALL"): `walkMaxTiles = 4` was tuned so
rail carries commuters at all. A bike range of 10–12 tiles re-creates that
failure — every 2–8 tile trip cycles and the mode-share bar flatlines rail.
**Start `bikeMaxTiles ≈ 7`** (comfortably above walking, below town spacing on
the reference boards), tune against `/test/citizenchoice`'s mode-share bar,
and treat the citizens spec's promise — "the winner for the 2–4 tile trips" —
as the acceptance test: bikes should eat *walk-or-drive* share, not *transit*
share.

---

## 7. Phase D — shared foot/bike paths (Fussweg, Velos gestattet)

Deferred behind a named blocker, not forgotten:

- The footway axis is **derived from `road`** today (`TileCell.footway` is an
  opt-out on road tiles). The citizens spec (:740-741) already flags the open
  item: *"a footpath that crosses the railway with no road at all — a pure
  footpath needs the axis to stand on its own."* A shared-use path in the
  countryside is exactly that standalone axis plus a `"shared"` marking, so
  this phase queues behind that structural change and should be designed with
  it.
- When it lands: a shared path admits bikes as **fast walkers** on the
  existing walk graph (`planWalk`/`walkMoves`), at `bikeSpeed`, keeping the
  footway module's founding refusals — no following distance, users may
  overlap (`footway.ts:17-31`). A bike on a path is a moving dot at 2× walker
  speed; zebra and rail-crossing claims are reused unchanged. No conflict
  model between walkers and cyclists — that is a simulation the pavement
  module explicitly refuses to host, and at this art scale it would be
  invisible anyway.
- What this phase does NOT do: put `Lane`s on paths. If a future board wants a
  high-capacity segregated cycle *track* (§2 form 5), that is carriageway
  machinery, not footway machinery — the two must not blur (the "a pavement is
  not a Lane" canon cuts both ways).
- `MAX_WALKERS = 120` (`pedestrians.ts:133`) becomes a shared budget for
  walkers + path cyclists; probably fine, listed for the tuning pass.

---

## 8. "Allow people to drive a bike" — two readings

1. **Citizens ride bikes** — that is phase C′, the core of this plan.
2. **The player steers a bike** — there is no direct-control precedent
   anywhere: every `ModeControls` verb is infrastructure (switches, signal
   holds, crossing gate, build, dispatch); trains, cars and walkers are all
   autonomous. A player-steered vehicle is a new input model, camera-follow,
   and collision contract — a separate game. **Recommendation: out of scope.**
   If a board ever wants it, the cheap forerunner is a "bike messenger"
   objective (deliver N parcels by requested bike trips the player *routes*,
   not steers) — which reuses `requestTrip` and the objective tracker as-is.

---

## 9. Impact map — every file this touches

The verification the user asked for: where additions land, phase by phase.

| Phase | File | Change |
|---|---|---|
| A | `src/sim/road.ts` | `VehicleKind`/`part` + `"bike"`; `BIKE_LEN`; `vehicleSpec` row; `KIND_SPEED` factor at both speed draws (:3271, :3100); overtaker exclusion (:3262); `TrafficMix.bike`; `pickKind` array (:1086) |
| A | `src/tiles/lanes.ts` | `VehicleClass "bike"` (matrix grants = car until B) |
| A | `src/sim/junctionSignal.ts` | `aspect` cls type widens to `VehicleClass` |
| A | `src/game.ts` | renderer class derivation (:2034, :1474); nothing else |
| A | `PlayView.vue` + `TestStage.vue` | `.road-car--bike` CSS (duplicated on purpose — both) |
| B | `src/tiles/lanes.ts` | `LaneKind "cycle"`; `laneUsableBy` matrix; drift preference |
| B | `src/tiles/editOps.ts` | lane-kind click cycle gains cycle; `deriveJunctionCarLanes` class table |
| B | `src/tiles/roadGeometry.ts` | cycle-lane tint + pictogram stamp |
| B | `src/sim/road.ts` | bike drift-to-cycle-lane (bus-lane twin, :1404-1413) |
| C | `src/tiles/parking.ts` | `StallKind "bikerack"`, `DEPTH/PITCH_FRAC` rows, `validateParking` |
| C | `src/sim/parking.ts` | `BayClass "bike"`, `bayAdmits` arm, `CAPACITY_PROBES` |
| C | `src/sim/roadParking.ts` | rack short-circuit in `beginEntering` (busstop twin) |
| C | `src/tiles/parkingGeometry.ts` | rack hoops + sign glyph |
| C | `src/tiles/catchment.ts` / `cities.ts` | `BIKE_RADIUS_TILES`; bay-class-aware `parkAndRideStationsOf` + `bikeAndRideStationsOf` sibling |
| C′ | `src/sim/citizens.ts` | `TravelMode` + both new members; profile/tuning fields; `quoteModes` branches; refusals; `stats().cycling` |
| C′ | `src/game.ts` | `CitizenHud` modeShare; trip phrasing switch (:1333-1346); `transferSizeOf` untouched (rack = 1 is right) |
| D | `src/tiles/footway.ts` + `model.ts` | standalone path axis (pre-existing open item) + `"shared"` designation |
| D | `src/sim/pedestrians.ts` | speed-per-walker (exists: `SPEED_SPREAD`) stretched to bike speed; budget check |

**Deliberately unchanged:** conflict matrix, arbiter, crossings, `planRoute`,
`CAR_GAP`/following model, `CLIP_LANES` (per-vehicle width is the one deferred
structural item), `transferSizeOf`, station demand schedule.

---

## 10. Test scenarios (the project rule: one per mechanic)

| Phase | Scenario id | Registry slot | What it demonstrates |
|---|---|---|---|
| A | `bikemix` | streets → vehicles | one bike, two cars, single-lane loop: cars queue behind the bike |
| A | `bikeovertake` | streets → overtaking | two-lane road: cars pass the bike, bike keeps kerb lane |
| B | `cyclelane` | streets → vehicles (or a new `cycling` category once ≥3 scenarios) | the `bikemix` street with a painted cycle lane: queue dissolves — the before/after pair IS the pitch |
| B | `bikebuslane` | streets → vehicles | bikes and buses sharing a bus lane; cars excluded |
| B | `bikerighthook` | streets → crosses | kerb cycle lane straight vs car turning right: the conflict matrix holds the car |
| C | `bikerack` | streets → parking | rack row fills, bikes vanish into stalls, sign + hoops render |
| C | `bikeandride` | trains → stations | the `parkandride` twin: rural station, rack, riders become passengers |
| C′ | `citizenbike` | trains → stations | citizens choose bikes for mid-range trips; mode-share bar shows walk/drive share shrinking, rail intact |
| D | `sharedpath` | trains → stations | a car-free path to a halt; walkers and bikes on one ribbon |

Each visual scenario ships with `npm run shot` before/after pairs per the
workflow; `tests/unit/levels/testScenarios.spec.ts` validates all of them for
free.

---

## 11. Answers to "did I forget something?" — the survey's extra findings

Things not in the original question that the code walk surfaced:

- **Determinism of existing boards**: adding a kind to `pickKind` with default
  weight 0 keeps every seeded board byte-identical. Any other default breaks
  replay everywhere. (§3.3)
- **The exhaustive-sum trap**: the `Record<TravelMode, …>` sums fail *silently*
  when a mode is missing; ship a completeness unit test with C′. (§6)
- **The P+R predicate trap**: bike racks would silently turn stations into car
  P+R targets without bay-class filtering. (§5.2)
- **The catchment-constant trap**: `WALK_RADIUS_TILES` is shared by three
  consumers; the bike radius must be a new constant. (§5.2)
- **The mode-balance trap**: `bikeMaxTiles` is the fourth of KNOWHOW's "three
  numbers that decide whether a board is about transport at all". (§6)
- **Junction signals with bike priority** (green-wave for bikes, as some cities
  do): the bus-priority machinery generalises, but no phase needs it — noted as
  a possible later polish, not planned.
- **`maxCars` counts vehicles, not road-metres**: a bike-heavy mix slightly
  under-uses capacity; acceptable, revisit only if boards feel empty.
- **Weather/night/helmets/bell**: no. The game has no weather axis and the art
  scale (8px) carries none of it.
- **KNOWHOW upkeep**: each phase that lands must add its facts (the per-kind
  speed table, the access matrix, the rack short-circuit) in the same commit.

---

## 12. Build order and why

**A → B** ship together or back-to-back (A alone adds friction with no remedy;
B alone has nothing to move out of the way). **C** next (racks are small and
unlock the intermodal loop). **C′** rides on C and is where the gameplay value
concentrates. **D** queues behind the standalone-footpath axis, which the
citizens roadmap wants anyway.

Estimated shape: A+B is one focused PR (sim + lanes + editor + art + three
scenarios); C one PR (parking + catchment + two scenarios); C′ one PR
(citizens + HUD + one scenario + the completeness test); D lands with the
footpath-axis project.
