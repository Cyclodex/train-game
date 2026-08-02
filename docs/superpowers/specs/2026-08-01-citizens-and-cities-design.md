# Citizens & cities — the Transport-Fever mode, designed

_Status: design + phase A built (2026-08-01). This is the doc for the mode the
project is actually aiming at: several cities, people who live and work in them,
who choose how to travel, who judge the journey, and who move in or move out
because of it. It is the successor to
`2026-07-31-bahnhof-stations-intermodal-design.md` phase 5 ("the mode"), and it
consumes phases 1–4 of that plan wholesale._

---

## 0. The pitch, in one paragraph

Three towns sit on a map. Each town is made of **plots** — a tile of urban
ground with houses on it, a factory, a parade of shops. Every plot has a
**capacity** and holds some **people**. Each person lives in one plot and works
in another, possibly in a different town. Twice a day they need to make that
trip, plus errands in between. They will **walk** if it is close, **drive** if
they own a car and the roads are decent, **take the train** if there is a
station within walking reach of both ends, or **drive to the station and ride
in** if that is the least bad of the three. Whatever they choose, they time the
journey and compare it to what they think it should have taken. Consistently
bad journeys make them unhappy; unhappy people leave. A town people can move
around easily attracts newcomers, fills its plots, and its buildings grow
taller. **The player's job is to make the network that makes that happen.**

That is the whole game. Everything below is the definitions that make it
buildable.

---

## 1. What already exists (and what this may NOT re-invent)

This is not a green field. Six things are already load-bearing, and the design
below is shaped by them rather than around them.

| Exists today | Where | What it means for citizens |
|---|---|---|
| Stations with a timed dwell, per-platform **passenger queues**, boarding up to seat capacity, alighting at the next call | `src/sim/simulation.ts` (`role: "station"`, `TrainState "dwelling"`, `stationQueue`, `addStationPassengers`, `DwellEvent{boarded,alighted}`) | A citizen taking the train is a **real number in a real queue**. If your trains do not run, the queue grows and the journey time is measured for real. |
| **Catchment**: what the ground within walking reach of a station says | `src/tiles/catchment.ts` (`WALK_RADIUS_TILES = 2`, `stationCatchment`, `parkAndRideTargets`) | The walking radius is already the project's model of "people walk this far". Citizens reuse it verbatim — one number, one meaning. |
| **Park & ride**: a car taking a stall within walking reach of a station puts its occupants on the platform | `src/game.ts` `transferParkedArrivals()` | The P+R leg is already wired. Citizens replace the *anonymous* occupant with a named one. |
| A full **road + parking** layer: lanes, junctions, signals, kerb bays, car parks, bus stops, facility capacity | `src/sim/road.ts`, `src/sim/roadParking.ts`, `src/tiles/parking.ts` | Cars are real. What is missing is only **origin/destination spawning** (today cars enter at map edges) — see §9 phase B. |
| **Terrain as tile data**, including `urban` and `industry` | `src/tiles/terrain.ts`, `TileCell.terrain` | The map already says where a town is. Cities are derived from that, not authored a second time. |
| The **modes framework**, objectives, economy, calendar | `src/modes/*`, `src/sim/objectives.ts`, `economy.ts`, `calendar.ts` | The mode is one file. Scoring, stars, fail predicates and money are already there. |

Two canon rules constrain every decision below, and both come from
`2026-07-28-industry-and-demand-design.md`:

- **The simulation is terrain-blind.** `src/sim/*` never reads `TileCell.terrain`.
  Map-reading lives in `src/tiles/*`; the sim executes whatever description it is
  handed. (This is why the citizen sim takes a `CitizenWorld`, §4.)
- **Derived, never stored** — for anything the *map* determines. Where a town may
  exist is map data. How big it grew is **not**: that is live state, and it
  belongs to the sim. §2.2 is the reconciliation.

---

## 2. Definitions

### 2.1 Plot — the addressable building

> **A plot is one tile.** It is the address people live and work at.

Every tile-addressed thing in this engine — catchment, walking reach, road
access, parking — is a grid cell, so the citizen layer is too. What the renderer
draws on an `urban` tile today is a *scatter of two or three roofs*
(`terrain.ts` → `building()`); those roofs **are** that plot's buildings. The
plot is the group; the capacity is the group's.

This is the honest reading of "every building has a max amount of people": the
unit that has a capacity is the thing at an address, and on a 200px grid the
thing at an address is the tile.

A plot has:

| Field | Meaning |
|---|---|
| `id` | tile coord id, `"x,y"` |
| `city` | which city it belongs to (§2.3) |
| `kind` | `"home"` \| `"work"` \| `"shop"` |
| `density` | `0..3` — how built-up. **State, not map data.** |
| `capacity` | derived from `kind` + `density` (§2.2) |
| `people` | residents (a `home`) or filled jobs (`work`/`shop`) |

`kind` is derived from the map, and deliberately **without new tile data**:

- `terrain: "industry"` → **work** (a factory; the biggest employer).
- `terrain: "urban"` → **home**, except a deterministic minority near the city
  centre which become **shop**. Shops cluster in the middle because that is
  where towns put them, and because it makes the centre worth reaching. The
  choice is a seeded hash of the coord, so it is stable across reloads and
  identical in a replay.
- A tile carrying rail/road/parking is infrastructure and holds nobody — the
  street is not a house. (`connections.length || road || parking` → not a plot.)

> **Why not a `zone` field on the tile?** Because we would then have two sources
> of truth for "this is a town" and an author could paint urban ground that is
> not a plot. A `zone` override is a cheap later addition (§9 phase C) for
> hand-designed levels; the *default* must be free.

### 2.2 Density — how the map and the sim split ownership

This is the decision that makes growth possible without breaking "derived,
never stored".

- **The map says WHERE.** `terrain: "urban" | "industry"` is the zoning. Only the
  player (or the level) decides where a city may stand. There is no auto-sprawl
  onto grass — the user explicitly preferred this, and it is also the better
  game: painting the next neighbourhood is a *decision*, and infinite automatic
  sprawl is a mode with no player in it.
- **The sim says HOW MANY.** `density` and `people` are live state owned by
  `createCitizenSim`. They are seeded from the map at t=0 and evolve.

So growth has three stages, in order, and only the third asks anything of the
player:

1. **Fill** — free capacity in existing plots takes newcomers.
2. **Upgrade** — a full plot in a happy city raises its `density`: houses →
   terraces → blocks. Capacity roughly doubles per step, and the renderer will
   draw a taller archetype (§7).
3. **Ask** — a city at max density with no free capacity and high happiness
   raises *"Westfield needs room to grow"*. The player paints more urban ground.

| density | label | homes | jobs (work) | jobs (shop) |
|---:|---|---:|---:|---:|
| 0 | hamlet | 4 | 12 | 4 |
| 1 | houses | 8 | 24 | 8 |
| 2 | terraces | 16 | 48 | 16 |
| 3 | blocks | 32 | 96 | 32 |

Sized so a three-city board opens at roughly **250–350 citizens** — enough that
the aggregate statistics are meaningful, few enough that ticking every one of
them is free (§8).

### 2.3 City — a derived region

> **A city is a connected cluster of plot tiles.**

Derived by flood fill (8-neighbour) over `urban`/`industry` ground, so it works
on `townscape` and `demoworld` **today** with no authoring. An explicit
`TileCell.city` tag overrides the clustering when a level wants two towns that
happen to touch, or a specific name.

A city carries no geometry of its own — bounds, centre and capacity are all
derived from its tiles. What it *does* carry, as live state:

```ts
interface CityState {
  id: string; name: string;
  population: number;        // people living here
  jobs: { filled: number; total: number };
  happiness: {               // 0..1 each
    commute: number;         // getting to work
    errands: number;         // getting to the shops
    access: number;          // could the trip be made at all
    overall: number;
  };
  modeShare: Record<TravelMode, number>;  // of trips completed recently
  wantsRoom: boolean;        // the "paint me more ground" signal
}
```

The three happiness **topics** are the user's ask ("how happy they are about
different topics") and they are chosen to be *actionable*: each one names a
different failure the player can fix (slow commute → more/faster trains; slow
errands → local access; access → there is no route at all).

### 2.4 Citizen — the agent

```ts
interface Citizen {
  id: string;
  home: PlotId;              // where they live
  work: PlotId | null;       // where they work (may be in another city)
  profile: TravelProfile;    // their habits (§3.2)
  mood: number;              // 0..1, the thing that decides if they stay
  trip: Trip | null;         // what they are doing right now
}
```

A citizen is **not** a rendered sprite. Rendering pedestrians is polish, and the
Bahnhof design already ruled on it (D5: "queues meeting at a coordinate, not
simulated pedestrians"). What a citizen *is* is the thing that puts a number in
a real station queue, and the thing that leaves town when you fail them.

### 2.5 Trip — a purpose, a mode, and a stopwatch

```ts
type TripPurpose = "work" | "home" | "shop";       // sports/friends: phase C
type TravelMode = "walk" | "car" | "transit" | "parkAndRide";  // bike: phase C

interface Trip {
  purpose: TripPurpose;
  from: PlotId; to: PlotId;
  mode: TravelMode;
  startedAt: number;         // sim seconds
  expectedSec: number;       // what it *should* take (§3.3)
  leg: TripLeg;              // where in the journey they are
  transfers: number;
}
```

The stopwatch is the whole feedback loop. `expectedSec` is derived from the
straight-line distance at a reference speed — deliberately **not** from the
route the network offers, because then a bad network would lower its own bar and
nobody would ever be unhappy.

---

## 3. The three models that make it a game

### 3.1 The day

Commuting needs a clock, and the calendar (`src/sim/calendar.ts`) only counts
years. The citizen sim owns a **day clock**: `secPerDay` (default **120 sim
seconds** — two minutes at 1×), from which hour-of-day is derived.

- **07:00–09:00** — leave for work. Each citizen's departure minute is a fixed,
  seeded per-citizen offset, so the morning peak is a *spread*, not a spike, and
  it is identical every replay.
- **16:00–18:00** — go home.
- **10:00–20:00** — errands, on average one shopping trip every other day.
- **Night** — nobody travels. The board gets quiet, which is what makes the peak
  read as a peak.

The peaks are the point: they are when the network is under load, and therefore
when the player's design is tested. A flat 24h demand would make timetabling
meaningless.

### 3.2 Habits — the travel profile

The user asked for people who *differ*: walkers, drivers, transit riders, P+R
users. The design keeps the difference in **preferences**, not in fixed
assignments, because a fixed "this person is a driver" cannot respond to the
player building a railway — and responding to the player is the entire game.

```ts
interface TravelProfile {
  carOwner: boolean;      // ~55% — no car means no car and no P+R
  walkPatience: number;   // 1.5..4 tiles: the furthest they will walk end-to-end
  transitAffinity: number;// 0.7..1.4 — multiplier on PERCEIVED transit time
  carAffinity: number;    // 0.7..1.4 — same, for driving
}
```

A `transitAffinity` of 0.8 is a person who *likes* trains — an hour on a train
feels like 48 minutes to them. Someone with 1.4 will drive unless the train is
dramatically better. That is a habit, expressed in a way the mode choice can
actually consume.

### 3.3 Mode choice — where the game lives

For each trip, the citizen scores every mode that is **available** for that
origin/destination pair and takes the cheapest perceived one:

```
cost(mode) = (access + wait + ride + egress) × affinity(mode) + penalty(mode)
```

| Mode | Available when | Cost |
|---|---|---|
| `walk` | `dist ≤ walkPatience` | `dist / WALK_SPEED` |
| `car` | `carOwner` and both ends have road access | `dist / CAR_SPEED + PARK_PENALTY` (rising when the destination's car parks are full) |
| `transit` | a station within walk reach of **both** ends | `walk to station + headway wait + dist / TRAIN_SPEED + walk from station` |
| `parkAndRide` | `carOwner`, a station with parking reachable by road, a station in walk reach of the destination | `drive to P+R + wait + ride + walk` |

If **no** mode is available, the trip is **refused** — the strongest possible
signal, and it lands entirely on the `access` happiness topic. A town whose
people cannot get to work at all empties fast, and it should.

> **Why perceived cost and not a utility logit?** A logit (the transport-planning
> standard) would be more "correct" and completely opaque to a player. Argmin
> over perceived time is legible: *"they drive because the train is slower"* is a
> sentence the HUD can say, and a change the player can act on.

### 3.4 Satisfaction — the feedback the user asked for

On a completed trip:

```
ratio = actualSec / expectedSec
delta = clamp(1.4 - ratio, -0.35, +0.12)
```

Better than expected nudges the mood up a little; much worse pulls it down hard.
The asymmetry is on purpose — a good commute is *normal*, a bad one is an event.
A **refused** or **abandoned** trip (too many transfers, gave up waiting) is a
flat `-0.30`.

Mood feeds the topic it came from (`work`/`home` → commute, `shop` → errands,
refusals → access), and the city's happiness is the mean over its residents.

### 3.5 Migration and growth — the loop closing

Reviewed once per in-game **day**, so changes are legible rather than jittery:

- **Leaving.** A citizen whose mood has sat below `0.25` leaves, with a
  probability rising as the mood falls. Their plot loses a resident; their job
  opens up.
- **Arriving.** A city with `happiness.overall > 0.55`, free housing **and** free
  jobs attracts newcomers at a rate proportional to both. People move where
  there is work — a dormitory town with no jobs does not grow.
- **Upgrading.** One plot per city per day, at most: a full `home` plot in a city
  with `happiness.overall > 0.6` gains a density step.
- **Asking.** No free capacity, at max density, still happy → `wantsRoom`.

This is the user's "a good city will call more people from outside and the city
will grow / people might leave the city or the whole game".

---

## 4. Where the code lives

Two modules, split exactly on the terrain-blindness line:

```
src/tiles/cities.ts     MAP READING (pure, no state)
  plotsOf(level)              → PlotSpec[]      what/where, capacities at density 0
  citiesOf(level)             → CitySpec[]      clustering + names + centres
  buildCitizenWorld(level)    → CitizenWorld    the sim's whole input, incl. access facts

src/sim/citizens.ts     THE AGENTS (deterministic, seeded, terrain-blind)
  createCitizenSim({ world, seed, tuning, transit })
    .step(dt, simEvents)      advance the day, run trips, mirror boarding/alighting
    .cities() .plots() .citizens() .stats()
```

`CitizenWorld` is the contract between them — plots with capacities, city
membership, and the **access facts** the sim would otherwise need terrain for
(`hasRoad`, `stationsInReach[]`, `parkAndRideStations[]`). The sim never sees a
`TileCell`.

`game.ts` owns the wiring, as it already does for park & ride: it builds the
world once, creates the citizen sim, and each `advance()` passes the tick and
the frame's `SimEvent[]` in. The citizen sim's only *output* into the rail world
is `transit.enqueue(stationId, n)` → `sim.addStationPassengers`.

### 4.1 The transit leg, without rewriting the passenger model

The sim's passengers are **typeless counts** that ride **one hop** and are set
down at the next call (Bahnhof phase 2, D6). Destination-typed passengers were
deferred, and this design does **not** need them:

1. A citizen choosing transit is enqueued at their origin station — a real
   `addStationPassengers(origin, 1)`, capped by the real platform.
2. The citizen sim keeps its own **FIFO shadow queue** per station.
3. On a `DwellEvent{trainId, tileId, boarded}` it pops `boarded` citizens from
   that station's shadow queue onto `trainId`. Boarding is therefore gated by the
   actual train's actual capacity, which is the part that must be true.
4. At each subsequent call the citizen asks one question: **is my destination
   within walk reach of THIS station?** Yes → get off, walk, stop the clock.
   No → **stay in the seat**.
5. Carried past `maxTransfers` stations, they give up: `-0.30`, counted against
   the trip's topic and against `access`.

**Step 4 is the single most important line in this document, and the first
draft got it wrong.** Mirroring the sim's one-hop rule literally — everyone off
at every call, re-queue as a "transfer" — was catastrophic on a shuttle: a train
took sixteen people aboard at a platform, ran to the depot at the end of the
line, bounced, and set all sixteen back down at *the same platform*. On the
reference board that produced **~1% of journeys by rail and 83% of rail attempts
abandoned**, on a railway that was working perfectly. A person knows where they
are going; they stay in their seat.

The cost of the approximation: a through-rider keeps a seat the rail sim has
already freed, so the sim's own passenger count under-reads a multi-hop journey.
Destination-typed passengers in `simulation.ts` are the proper fix (§9 phase B).

Two more traps found while building this, both worth the same warning:

- **A bounce is not an arrival.** A colour-mismatched train emits
  `arrived{matched:false}` and reverses out *with its riders*. Treating every
  `arrived` as "the line terminated, everyone's journey failed" failed every
  passenger on a shuttle twice a lap. Only `matched` arrivals park.
- **The platform cap is not a difficulty dial.** Without a `stationDemand` entry
  every station falls back to `STATION_QUEUE_HARD_CAP` (16), which a morning
  peak in a town of forty exceeds — and a commuter who cannot even *join* the
  queue stands there until they give up, which reads as a broken railway. Under
  the citizen layer each station gets an entry with an infinite interval (so it
  spawns nobody) and a generous `max` (so it is a cap and nothing else).

---

## 5. What the player sees

- A **city card** per city: name, population (with the arrow of the last day's
  change), jobs filled/total, and the three happiness bars. This is the whole
  readout — the mode is judged by whether those bars go up.
- **Mode share** as a small stacked bar per city: walk / car / train / P+R. This
  is the sentence the player is trying to change. Watching the train slice grow
  after you open a line is the mode's payoff moment.
- The `wantsRoom` prompt on a city that has outgrown its ground.
- Nothing else. The Train Valley post-mortem (§5.5 of the tycoon doc) warns
  specifically against chrome density, and a citizen layer can generate an
  unbounded amount of it.

---

## 6. What this mode fails on

Endless, so the fail condition is a decline, not a clock: **total population
falls below 60% of its opening value**. Stars are population and happiness
thresholds at a review date. The objective tracker already supports all of it
(`src/sim/objectives.ts`) — the mode is genuinely one file.

---

## 7. Rendering (deliberately thin in phase A)

Density has to be *visible* or growth is a number with no picture. The
archetype picker in `terrain.ts` (`building()`) already chooses sheds, houses,
terraces, blocks and halls **by the room measured at the spot**. Phase B feeds
`density` in as a second input to that choice, so a plot that upgrades visibly
grows a bigger roof. Phase A ships the numbers and the city card; it does not
touch the ground art, because the ground art is a solved and delicate thing
(`KNOWHOW` → TOWN SCALE) and mixing the two would risk both.

---

## 8. Performance and determinism

- **~300 citizens**, most of them idle with a timer. A tick is a bounded loop
  over the active ones; the day review is once per 120 sim seconds. This is
  nothing next to the road sim's per-car following/conflict work.
- **Seeded throughout** (`makeRng`, `src/utils/globalHelpers.ts`), separate
  streams for placement / profiles / departures / trips, exactly as `road.ts`
  does. No `Math.random` anywhere in `src/sim/*` — replays and unit tests depend
  on it.
- **No Vue, no DOM.** Provided through `game.ts` under `markRaw` like every other
  controller.

---

## 9. Phases

### Phase A — the model (**BUILT 2026-08-01**)

`tiles/cities.ts` + `sim/citizens.ts` + `modes/citizens.ts` + `CityPanel.vue` +
the `threecities` board and its `/test` scenario, with 21 new unit tests.
Citizens live, work, choose a mode, ride real trains through real station
queues, judge the trip, and move in or out. Car trips are an **abstract timer**
in this phase (see B).

Measured on `threecities` over five in-game days:

| | trains running | no trains at all |
|---|---|---|
| journeys by rail | **56%** | 0% |
| abandoned | **0** | 221 |
| population | 111 → **153** | 111 → **59** |
| commute happiness | 0.67–0.90 | 0.45–0.58 |

That table is the mode working: the same board, the same people, and the only
difference is whether the railway runs.

**A calibration note that cost an afternoon.** Three numbers decide whether the
board is about transport at all, and all three failed silently at first:

1. **`walkMaxTiles`.** At the engine default of 6, the nearest factory to the
   nearest house was *exactly* 6 tiles away, so everyone walked past the station
   and rail carried 1% of journeys. The mode sets 4.
2. **Shop capacity.** A parade of shops employing as many people as a factory
   meant every resident found work on their own street. Shops are now [2,4,8,16]
   against a works' [12,24,48,96].
3. **Town spacing.** The gaps between towns on a citizen board are load-bearing
   level design, not scenery — they must exceed `walkMaxTiles`.

The lesson generalises: **a citizen board is only a transport game if the jobs
are genuinely out of walking reach of the houses.** Check the mode-share bar
first when a board feels inert.

### Phase B — real cars, real buildings

1. **Origin/destination car trips — BUILT 2026-08-02.** `roadSim.requestTrip(
   fromTileId, toTileId)` dispatches a real car from the road tile nearest the
   origin plot to the one nearest the destination, using the same goal-directed
   BFS parking already used (`planRouteToGoals`). The car is ordinary traffic in
   every other respect — same lanes, same queues, same junction arbitration, same
   level crossings — and it *stops being traffic* when it arrives rather than
   driving off the map. A driving citizen's leg is no longer on a clock at all:
   it ends when their car arrives, so **congestion is now paid for in the
   commuter's own journey time, and therefore in their mood**.

   Two properties worth keeping:
   - **The fallback is a feature.** `requestTrip` returns `null` when it cannot
     dispatch (no route, the street outside blocked, the requested-car cap hit),
     and the citizen falls back to the timer. A saturated road slows people down;
     it never strands them in a state with no way out.
   - **Requested cars are capped separately** from the ambient density slider.
     The slider is a scenery dial; a town's actual commuters are not scenery.

   `/test/citizencars` is the isolation board, and it is built on one property:
   **a closed ring road opens nowhere, so `roadEntries` is empty and ambient
   traffic cannot spawn at all.** Every vehicle on it is therefore provably a
   citizen — asserted directly in `tests/unit/sim/roadRequestTrip.spec.ts`.

   Its second lesson was not designed in, and is worth keeping: a town with only
   roads does not shrink, it **churns**. The residents without cars are refused
   their commute and leave, more arrive (the town reads as happy, because
   everyone still in it drives), and a car-only town quietly self-selects for
   drivers at a steady population. `access` shows the truth only as a dip.

2. **Buses as carriers.** Today a bus stop *produces* a busload; riding a bus is
   not modelled. The shadow-queue trick of §4.1 works identically for bus halts.
3. **Density in the ground art** (§7).
4. **Pedestrians you can see** — see §9.1.

### 9.2 Internal circulation — the last block is free (BUILT 2026-08-02)

The question this answers: does the player have to draw every street *inside* a
town, or do towns build their own?

**Neither.** The link between a plot and the street that serves it is
**derived** (`tiles/access.ts`), and rendered as a driveway/apron flaring to the
kerb. Reasoning:

- The model already assumed it. `ROAD_ACCESS_TILES = 1` has always meant "a plot
  with a street within one tile is reachable". The link was never missing — it
  was **invisible**, which is a rendering problem, not a modelling one.
- Making the player lay every driveway is busywork with no decision in it. The
  interesting decision is the **arterial** network: where the through-road runs,
  whether the town gets a station.
- Auto-generating real road *tiles* inside a town (the Transport Fever move)
  fights the player: generated lanes land in the level data, become editable and
  bulldozable, and must be regenerated on every growth step. That is a lot of
  machinery for something nobody chooses.

Two things fall out of it for free: the same derivation is the **pedestrian
graph** (§9.1) — plot → access apron → footway — and it re-derives the instant a
street is laid or bulldozed, with nothing stored to go stale.

And the street itself now runs **through** the town rather than beside it: put
the town's `terrain` on the road tiles and the built-up ground is continuous
(the keep-out corridors already step every roof back from a carriageway). That
needed one engine change — the city flood fill walks over town *ground*, while
only *addresses* hold people — because otherwise a road laid through a town split
it into two towns.

**When would real internal streets earn their keep?** When a town outgrows what
one frontage can serve. That belongs with the growth model as a *prompt*, not a
silent auto-build — the same shape as `wantsRoom`: "Brookfield needs a street."

### 9.1 Pedestrians and footways (designed, not built)

Walking is a timer today. To *see* people walk, they need somewhere to walk, and
the recommendation is:

**A footway is per-street data in the same family as lanes — but pedestrians are
NOT vehicles in the road sim.** Concretely, a fifth tile axis
`footway?: { sides?: ("left"|"right")[] }`, **derived by default** from `road`
(every street gets a pavement each side unless it opts out), so every existing
board gains pavements with zero authoring — the same trick city clustering uses.

Why not a `Lane` with `kind: "footway"`, which is the obvious first instinct:

- A pavement is **bidirectional on one strip**; a `Lane` is directed. Two lanes
  per pavement to fake it doubles the lane count every car query iterates.
- It sits **outside the kerb**, not in the carriageway. `laneOffset.ts` positions
  lanes *within* the road width; a pavement is beyond it.
- Pedestrians **may overlap** — two people occupy the same doorway. Every gate in
  `road.ts` (following, swept bodies, junction conflicts) exists to guarantee the
  opposite, and would have to learn an exception.
- They do not queue at junctions like traffic; they cross it.

The reuse the lane idea is reaching for is **routing**, and pedestrian routing is
the part that does not need it: walking is an undirected walk over adjacent
footway tiles, which is the `roadComponents` flood fill already in
`tiles/cities.ts`. So: footways as tile data, geometry beside the kerb from
`roadGeometry.ts`'s existing kerb positions, and a small `sim/pedestrians.ts`
that moves dots along that graph — reusing the citizen sim's walking leg
(`walkSpeed`, `walkMaxTiles`) rather than inventing a second one.

The genuinely new mechanic that falls out, and the reason this is worth doing as
a *game* feature rather than decoration: **a crossing.** Where a footway meets a
carriageway or a railway, somebody has to give way — and that is a decision the
player makes, exactly like a signal or a level crossing.

### Phase C — the rest of life

Purposes `sports` and `friends`; the **bike/moped** mode (no parking cost,
medium patience — it should be the winner for the 2–4 tile trips that are
currently walk-or-drive); an explicit `TileCell.zone` override for hand-designed
levels; school/university plots; freight demand from `work` plots reusing the
same machinery.

---

## 10. Traps recorded in advance

- **Do not let `expectedSec` come from the network.** It must be the straight-line
  yardstick, or a bad network grades itself.
- **Refused trips must be counted.** A citizen who cannot travel makes no trip
  event; if the loop only scores completed trips, the worst possible network
  scores perfectly. `access` exists for exactly this.
- **The shadow queue must be popped from the event, never from the queue count.**
  `stationQueue()` also moves under the *scheduled* demand from
  `stationDemandOf`; only `DwellEvent.boarded` says how many actually left.
  (Phase A therefore turns the synthetic schedule **off** on citizen boards — two
  sources of passengers would double-count.)
- **Day length is a genre dial, not a detail.** Short days make a twitchy
  throughput game; long days make a planning game. It is `secPerDay`, one number,
  and it belongs in the mode's tuning like `GENERIC_FARE_GRACE` does.
- **Clustering merges towns that touch.** Two towns one tile apart are one city
  to a flood fill. The `city` tag override exists for that; boards should keep
  towns two tiles apart or tag them.
