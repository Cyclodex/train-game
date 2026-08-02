# Bahnhof — stations & intermodal transfer: analysis and first steps

_Status: plan, nothing built. This doc consolidates every existing station note
in the repo, adds the intermodal (Transport-Fever-like) vision on top, and cuts
the work into phases where **phase 1 is buildable now** without deciding the
rest. Companion to `2026-07-28-industry-and-demand-design.md`, which owns the
"terrain chooses the cargo" rule this plan reuses for passengers._

## 0. The vision, in one paragraph

A passenger journey should eventually read like Transport Fever: people appear
where the houses are, **walk** a short distance, board a **bus** to the
**Bahnhof**, transfer to a **train**, ride, and walk the last stretch — and with
the parking idea, **cars drive to a P+R lot beside the station** and their
occupants continue by rail. The near-term commitment is deliberately smaller:
build the **station feature** (the tile, the dwell, the queue) first, and defer
person-level simulation and goods management until the station exists to hang
them on.

## 1. What we already have (survey — nothing here is new thinking)

The idea is well-documented; no code exists yet. The notes, strongest first:

| Where | What it says |
|---|---|
| `docs/road-future-improvements.md` §2.1 | Stations as through-track stops: queue, dwell, board. "Effort L, **impact: highest**." §2.2: cargo trucks feeding stations, blocked by §2.1. |
| `docs/brainstorm/02-terrain-and-tile-types.md` §2.4 | The design sketch: `role: "station"` on through-track (vs depot = dead-end terminus), `Dwelling` state, queue, platform render, waiting-crowd size = queue length. Sub-ideas: numbered/typed stations, platform length limiting train length. |
| `docs/brainstorm/03-trains-cargo-economy.md` §3.4 | Spawning demand as "the Mini Metro / OpenTTD heartbeat" — deterministic, seedable spawner adding to per-source queues; the engine behind an Endless/management mode. §3.3: typed cargo replacing colour luck. |
| `docs/superpowers/specs/2026-07-28-industry-and-demand-design.md` | The demand rule already decided for depots: **profile derived from neighbouring terrain, never stored** (`urban` → passengers, `industry` → freight, `farmland` → bulk). Sim stays terrain-blind; derivation lives in the mode layer. |
| `docs/brainstorm/99-open-questions.md` Q1 | The puzzle-vs-management fork. Stations + spawning demand ARE the management branch — building them is a (deliberate) step toward the hybrid: puzzle campaign + a living-network mode. |
| `IMPROVEMENTS.md` item 3 | "Stations as through-track stops (biggest design unlock)." |

What the engine already gives us, feature by feature:

- **Trains stop and glide today**: depots implement arrive → `parking` (glide
  into the shed) → `parked` (`src/sim/simulation.ts`, `TrainState`). A station
  dwell is the *pausing* sibling of that machinery: hold at a point on
  through-track for a time, then resume — no new movement math, the stop-line /
  braking model (`clearDistanceAhead`, look-ahead braking) already stops a train
  precisely at a target.
- **Roads, buses, bus lanes** exist (`src/sim/road.ts`, `tiles/lanes.ts` with
  per-class lane access). On **master** there are no stops — road vehicles
  spawn at edges, drive, and despawn at edges.
- **The parking branch changes that picture entirely.**
  `claude/auto-parking-system-b7d52c` (no PR yet; `docs/handoff-parking-branch.md`
  is its handover) ships a complete parking layer: kerbside/90°/echelon bays,
  garages with in/out ramps, **bus lay-bys and in-lane bus halts**, lorry bays,
  reserved bay classes, a facility-level capacity model the router reads, an
  editor tool and nine `/test` scenarios — the four follow-up pieces (pivot-arc
  reverse, no right of way when leaving, crawl-speed reversing, the echelon
  apron) are done too. That is most of the phase-4 substrate already built: a
  P+R is "a parking facility whose arrivals feed the adjacent station's
  queue", and bus stops exist rather than needing invention. As of 2026-08-01
  the branch is rebased on top of master (master is an ancestor), so bringing
  it to master is conflict-free — **this plan is based on that branch**, and
  phase 1's render work should happen on top of it, since both threads edit
  `Tile.vue`/`EditorView.vue` and the handoff plans a `TileParking.vue`
  extraction.
- **Objectives/modes/economy** are ready to score all of it: counters live in
  `src/sim/objectives.ts`, fares priced by cargo × distance in the Tycoon
  economy (`src/sim/economy.ts`), and a new mode is one file in `src/modes/`.
- **Terrain says where people are**: `urban` patches (and `generateTerrain`
  placing a town beside a depot) mean a station's catchment can be *derived
  from the map* — same rule, same reasons, as the industry doc.

## 2. Design decisions (proposed here, so phase 1 can start)

**D1 — A station is `role: "station"` on a through-track cell.** The existing
`role?: "depot"` widens to `"depot" | "station"`. Everything else stays derived
from `connections` (a station on a curve is legal; `kindOf` gains the label).
A depot remains the terminus that *ends* a journey; a station is a stop *along*
one. This is the §2.4 sketch, unchanged.

**D2 — Dwell is a sim behaviour, demand is not.** The sim gets
`TrainState: "dwelling"` + `dwellRemaining` (arrive at station centre → dwell →
resume) and, in phase 2, per-station queues + board/alight events — because
queues must be deterministic and unit-testable. But *what* spawns where and
*what it is worth* stays in the mode layer, exactly like the industry doc's
"no terrain rule in the simulation" boundary: the sim takes a spawn schedule,
it never reads terrain.

**D3 — Catchment is derived, never stored.** A station's passenger rate comes
from the `urban` terrain within a small radius (the "walking distance"),
mirroring `depotProfile(level, id)`. No editable demand numbers on the tile —
the map stays the single source of truth, and "people walk in a certain
distance" is modelled as a radius before it is ever modelled as agents.

**D4 — A dwelling train blocks its track: platforms want loops.** Dwelling on
the main line holds every train behind it (occupancy gate — this is realistic
and *good* tension), so level design answers it the railway way: passing loops
(`docs/brainstorm/02` §2.6) around platforms. No new sim rule needed; note it
in level-authoring guidance.

**D5 — Intermodal = queues meeting at a coordinate, not simulated pedestrians.**
A bus stop, a P+R lot, and a rail platform "connect" when adjacent: a bus
dwelling at a stop beside a station transfers its passengers into the station
queue; a car reaching a P+R despawns and adds passengers. Walking people as
rendered agents are polish, much later; the *radius* is the model.

**D6 — Passengers start typeless, become destination-typed later.** Phase 2
passengers are just counts (board up to capacity, deliver at the next
station/depot). Destination-typed units (Mini-Metro-style) arrive with the mode
work in phase 5 — starting typed would front-load routing UI (line assignment)
the game doesn't have yet.

## 3. The phases

### Phase 1 — the station tile + dwell (S–M) — **SHIPPED 2026-08-01**

Every train that passes a station stops for a fixed dwell, then continues. No
passengers yet — this lands the tile, the sim state, the render and the editor
in one reviewable slice.

1. `src/tiles/model.ts` — `role?: "depot" | "station"`; `kindOf` returns
   `"station"`; `validate.ts` accepts it (station must sit on through-track:
   ≥1 edge-to-edge pair, no Center connection).
2. `src/tiles/kinds.ts` — authoring sugar (`expandKind("station", …)`), and
   `editOps.ts` `setStation` for the editor; EditorView gains the tool.
3. `src/sim/simulation.ts` — arriving at a station-tile centre on through-track
   enters `dwelling` with `dwellRemaining = DWELL_SEC`; ticks down; resumes.
   Emits `{ type: "dwell" }` / departure events for the log. Reservation: the
   station tile counts as a block boundary in the `isBoundary` predicate
   (`routeToNextSignal`), so an approaching train reserves only up to the
   platform and a dwelling train holds only its own tile — see §4.
4. `src/components/Tile.vue` — platform render beside the track (theme-aware,
   modest: platform slab + small shelter; the crowd comes in phase 2).
5. `/test` scenario `scenarios/station.ts` (one line, one station, one train —
   watch it stop and go) + registry entry; unit tests for validate + dwell
   timing (`tests/unit/sim/…`).
6. Screenshot per the visual-verification rule.

### Phase 2 — queues, boarding, counters (M) — **SHIPPED 2026-08-01**

Deterministic spawner fills per-station queues (sim-side, schedule passed in);
trains have passenger capacity, board on dwell (dwell extends with boarding),
alight at depots/next station; `objectives.ts` gains `passengersDelivered`;
waiting-crowd render (queue length = crowd size). `/test`: two stations, one
shuttle.

### Phase 3 — catchment from terrain (S, pure derivation) — **SHIPPED 2026-08-01**

`stationProfile(level, coordId)` — passenger weight from `urban` tiles within
walking radius (freight weight from `industry`, for later) — headless, unit
tested, feeding phase 2's spawn schedule in the mode layer. Debug overlay draws
the radius so authors can see a station's reach.

### Phase 4 — intermodal edges (builds on the parking layer) — **transfer edges SHIPPED 2026-08-01**

Bus stops and car parking come from the parking branch (see §1); the transfer
wiring is in: whenever a vehicle takes a stall within a station's walking
reach (`parkAndRideTargets`, same radius as the catchment), its occupants join
that platform's queue via `sim.addStationPassengers` — one driver from an
ordinary bay, a busload from a bus stop (in-lane halt or bus-reserved lay-by).
The transfer runs in `game.advance()` (the headless world step, NOT the render
mirror), which is what makes it provable: `tests/unit/parkAndRide.spec.ts`
drives 60 headless seconds and shows more passengers than the schedule alone
could produce. `/test/parkandride` (kerb bays by the station) and
`/test/busfeeder` (a halt feeding the platform) are the demos.

Still open in this phase: buses as real passenger CARRIERS (today a stopping
bus *produces* a busload; riding a bus somewhere is not modelled) and people
riding rail→bus onward journeys — both want the destination-typed passengers
of phase 5.

### Phase 5 — the mode ("Network" / Transport-Fever-like) — **SHIPPED 2026-08-01**

`src/modes/network.ts`. The win is **passengers carried** (`ObjectiveSpec.
passengersRequired`, scaled per station), the loss is a **platform
overflowing** (`fail.maxStationQueue` over the new `peakStationQueue`
high-water counter), and the HUD swaps the delivery card for a passenger one
plus a live "n/12 waiting" readout that warms amber then red. Deliveries are
deliberately NOT required: a shuttle that keeps running forever is a good
service, not an unfinished level — so the board's two depots both MISMATCH the
train and it turns round by bouncing, which is what makes the service endless.

The mode immediately paid for itself as a consumer: phase 3's demand rates had
never been measured against what a train can actually carry, and the first
board was unwinnable in 19 seconds. `stationDemandOf` is now tuned against a
shuttle's round trip (a busy station turns out one passenger every 4s), and
`tests/unit/modes/network.spec.ts` drives the real board headlessly to prove it
stays winnable — the balance is a test, not a hope.

### Phase 6 — LINES: the train drives itself — **SHIPPED 2026-08-02**

The depot stops being a destination. In this mode it is only where a train is
ordered from and stabled — trains enter and leave the game there, colour means
nothing, and a train in service never terminates at one (a depot it reaches is
a turn-back). What a train follows instead is a **line**: an ordered list of
station stops, cycled for ever.

- `sim/railRouter.ts` plans the leg to the next stop — BFS over
  `(tile, entryPort)`, the editor's graph and the road layer's output shape.
- The plan enters the sim through the existing `SwitchResolver` seam, so a
  routed train obeys every signal, reservation and stop line exactly as a
  hand-switched one. No plan → the old behaviour, untouched.
- `sim.assignLine(id, stops)` is the run-time verb (`[]` retires the train) —
  the API an "assign this train to this line" UI will call.
- Boards are authored as a **ring** (one depot, no turn-back, each station once
  a lap) or a **there-and-back shuttle** (a turn-back at each end, intermediate
  stations served twice a round trip). `railRing()` + `mkLineTrain()` author
  both; every station test world was rebuilt on this shape.

### Phase 7 — the service panel: buy a train, draw a line — **SHIPPED 2026-08-02**

The interactive layer, and with it the mode's whole verb set:

- A **Service card** lists every train, its stops as numbered pips (the one it
  is heading for lit), and an **Edit** toggle.
- Editing is a **board gesture**: the stations light up, a click appends a stop,
  a click on an existing stop removes it. Click order is call order.
- **+ Train** orders another one at a free depot, in service on the line being
  edited — refused while a train is still standing in the depot, because the
  new one would be built on top of it.
- Platforms show the **liveries calling there**, so an unserved station is
  visible at a glance.
- **No manual points.** `ModeControls.switches` is false here: the train decides
  where it goes, so a switch the player can throw only sends a service off its
  line. The fans are not drawn either (a separate `switchesVisible` prop, since
  the editor's read-only fan is a different thing). Signals stay — they are
  about *when* a train goes, not where.

Verified in a real browser end to end: 4 stations highlighted, a stop removed
and re-appended, a train bought and immediately running the same line.

Still open beyond that: destination-typed passengers (ride A→B rather than one hop),
buses as carriers rather than feeders, and rising demand over time.

#### The original sketch (for reference)

A `src/modes/` file layering objectives + economy over the above: keep queues
under overflow, score journeys (fare by distance already exists), rising
demand — the Endless/management loop the brainstorm calls the genre fork. Goods
(trucks → freight stations, chains) only after this loop is fun with people.

## 4. Traps known in advance

- **Tycoon is the active thread** (`docs/handoff-tycoon-next.md`). Stations are
  complementary (Tycoon is depot-to-depot) — build phase 1 as engine work that
  no mode depends on yet, so the threads don't collide.
- **Sim purity**: queues/spawners must be deterministic + seedable (no
  `Math.random` in `src/sim/*`), or replays and unit tests die.
- **Don't reuse depot's Center connection** for stations: a depot's
  edge↔Center pair is what makes `traverse` end there. A station is
  through-track; the stop point is a *progress* on the segment, not a port.
- **Dwell + interlocking — solved by the existing signal machinery.** A train
  reserves its route only up to the next block boundary
  (`routeToNextSignal`'s `isBoundary`, inclusive). Make the station tile an
  implicit block boundary (one line in the boundary predicate — exactly what a
  signal is), and a train approaching a station reserves only *up to* the
  platform; while dwelling it holds nothing beyond it. No new release logic,
  no special dwell rule — and level authors can still add real signals at the
  platform ends for finer control. (Earlier draft proposed a bespoke
  release-on-dwell rule; the boundary reuse is strictly simpler.)
- **Feature-test rule**: every phase above ships its `/test` scenario in the
  same commit; the registry sweep validates it in CI.

## 5. First concrete step

Phase 1, items 1–3, as one PR: the role + validation + dwell with unit tests
and the `/test/station` scenario, platform render allowed to be crude. That is
the smallest slice that makes "Bahnhof" real on the board and unblocks every
later phase.
