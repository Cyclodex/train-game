# Economy × demand — converging Tycoon and Citizens into one game

_Status: design + phases 1-3 built (2026-08-21/22). The epic this document opens:
the Tycoon mode has an economy (fares, taxes, land prices, bankruptcy) whose
demand is synthetic colour-matching; the Citizens mode has real demand (people
who live in one place, work in another, choose a mode and time the journey)
and no money at all. Converged, citizens pay fares, their commuting IS the
income, and the road competes with the rail for it — the game the whole
codebase has been converging toward. Successor to
`2026-07-25-train-valley-mode-design.md` (the economy) and
`2026-08-01-citizens-and-cities-design.md` (the people); it consumes both and
re-opens neither._

Issues: **#117** (the architectural keystone — this phase 1), **#91** (trains
cost money in the network mode — phase 3), #111 (citizens on buses — step 1
of phase 1 here, by agreement of both plans), #110 (round-trip contract —
orthogonal, no interaction).

---

## 0. The pitch, in one paragraph

A town's people decide every morning how to get to work. Today that decision
costs the player nothing and earns the player nothing: the mood bars move, the
mode-share bar moves, and the bank — where there is one — is filled by
colour-matched trains whose "demand" is a spawn timer. Converged, the decision
IS the business: every commuter who boards pays a fare, every commuter who
drives is a fare the road took from you, and the network the player builds is
priced (track, upkeep, vehicles) against the custom it wins. The city grows
where the network is good, which grows the custom, which funds the network —
Transport Fever's loop, on an engine that already has every piece of it built
and none of them connected.

---

## 1. The two halves, and the wall between them

| | Tycoon (+ Network) | Citizens |
|---|---|---|
| demand | synthetic: a per-station spawn schedule derived from catchment (`stationDemandOf`), or per-train colour pairs | real: citizens with homes, jobs, habits and a stopwatch |
| money | `sim/economy.ts` ledger, decaying fares per TRAIN, track cost, annual tax, bankruptcy | none |
| carrier | trains (+ buses carrying the transit layer's abstract riders) | trains only — the citizen transit port binds to the rail sim |
| score | fares banked / passengers carried | population + happiness |

The wall is the **per-mode XOR** (#117): only `mode=citizens` passes
`citizens:` into setup, and that turns the synthetic per-station demand OFF —
`demandFor` (`src/game.ts`) answers an infinite interval, so the schedule
spawns nobody. Every other mode runs synthetic demand only. The XOR was built
as a double-counting guard, and the guard is obsolete: since the shared
transit layer (`sim/transit.ts`) queues are **tagged** — a citizen waits under
their own id, an anonymous rider has no tag, and `DwellEvent.boardedTags` /
`alightedTags` name exactly who moved — the two sources already coexist in one
queue without either being able to double-count the other. What remains of
the XOR is a **default**, wearing the costume of an architecture.

And one asymmetry deepens the wall: buses carry the transit layer's abstract
riders, but **citizens cannot ride buses** — their boarding points are rail
stations only (`stationsInReachOf` filters `role === "station"`), and bus
calls (`transit.exchange` in `game.ts`) are never handed to the citizen sim's
event mirror.

## 2. The position (from #117, adopted here as the epic's spine)

> Reinterpret synthetic demand as **EDGE demand** — people from off-map that a
> station imports — carried **on top of** its citizen catchment. Citizens =
> demand the map explains; edge = demand the map imports. One demand model;
> the modes become objective flavours over it.

That single move dissolves three standing forks at once:

- the Network-vs-Citizens split (#113 left it open): two objectives — scored
  passenger target vs endless population — over ONE demand architecture;
- the "does Tycoon get real demand" question: a Tycoon board with towns runs
  citizens + edge on the same stations and prices the fares off real journeys;
- the double-counting objection recorded at `modes/types.ts` (CitizenSetup):
  answered by tags, not by exclusion.

---

## 3. Decisions

### D1 — `edgeDemand` is a per-station dial on the TILE, and the XOR becomes two defaults

`TileCell.edgeDemand?: number` — the share (0..1, clamping above 1 allowed
but pointless) of the stop's catchment-derived schedule that arrives from
off-map. The derived schedule (`stationDemandOf` / `busStopDemandOf`) keeps
setting the SCALE — a stop in a town imports more than a halt in a meadow, so
"build the station nearer the houses" stays monotone — and `edgeDemand` sets
the SHARE of that scale which is edge traffic.

Defaults preserve every existing board bit-for-bit:

| board | default | meaning |
|---|---|---|
| no citizen layer | `1` | the full derived schedule — exactly today's synthetic demand |
| citizen layer on | `0` | the map explains all demand — exactly today's citizens boards |
| explicit value | itself | **additive**: citizens AND edge riders on one platform |

Why an authored tile field and not a mode flag or a game-config dial: the
issue's own words ("a board/station dial, not a mode flag"), and the "derived,
never stored" canon — which forbids storing what the map DETERMINES, and edge
demand is precisely what the map cannot determine: how much of the world
exists beyond its border at this stop. That is authored data of the same
species as `signals` or the `city` tag.

The queue cap stays what the citizen build made it: with citizens present,
`max` is at least `CITIZEN_PLATFORM_CAP` (a cap and nothing else); the edge
share scales `intervalSec` and `initial`, never the cap — a dial that could
silently lower the cap would re-introduce the "commuter cannot even join the
queue" failure the cap exists to prevent.

**No double-counting, by construction:** edge riders are anonymous `Waiting`
rows; citizens are tagged rows; `exchange` reports both, and the citizen
mirror touches only its own tags. The two compete for SEATS and PLATFORM ROOM
— which is not a bug but the game: an edge-heavy stop crowds the platform the
commuters also need.

### D2 — citizens ride the shared carrier layer, not the rail sim

Step 1 of #117's ordering (= step 1 of #111), done FIRST so that unifying
demand cannot deepen the rail/bus split.

- **Boarding points generalise**: a plot's reachable boarding points are rail
  stations AND bus stops (`boardingPointsInReachOf` — role `station` or a
  `busstop` row) within the same walk radius. The citizen model's
  `stationsInReach` carries them; every downstream question (`nearestStation`,
  `railPairFor`, enqueue, walking legs) already works on tile ids and needs no
  second code path.
- **Connectivity was already shared**: `sim.serves` delegates to
  `transit.serves`, whose line graph spans rail lines, bus lines and the
  authored walk links. The citizen quote asks the right question today; it was
  only ever offered the wrong stops.
- **Bus calls join the event mirror**: a bus call is already an `exchange`
  with tags; `game.ts` now records it WITH the bus's id and hands it to
  `citizenSim.step` in the same dwell-event shape a train emits (`trainId` =
  the bus id, `tileId` = the stop). The mirror needs no change: `riders` is
  keyed by vehicle id and never asks what species the vehicle is.
- **The quote prices a bus leg as a train leg** (speed, assumed headway) in
  this phase. Deliberate approximation: the perceived-cost model is a
  heuristic throughout, and a per-kind ride speed needs the pair to know what
  runs it, which is a line-graph question worth its own slice. Recorded as a
  refinement, not silently.

Out of scope here, recorded for #111 step 2: interchange targets
(`stationsWithParkingFor`) stay rail stations, so bus-stop B+R/P+R is not yet
offered; the round-trip contract (#110) is untouched.

### D3 — the fare moves from the TRAIN to the PASSENGER (phase 2)

Tycoon's decaying per-train fare stays what it is — the dispatch game's prize.
The converged income is different in kind: **a delivered passenger pays**, at
the moment the transit layer counts the delivery (its `delivered` counter is
already once-per-journey, at the final stop — the double-collection guard #91
asked for was built in phase 9). Priced like everything else in the economy:
a boarding fee plus per-tile distance (origin→destination straight line, so a
scenic route cannot pay for itself). Citizens and edge riders pay the same
fare — an edge rider is why importing demand is worth anything.

### D4 — vehicles cost money (#91, phase 3)

`buyTrain` / `buyBus` take a purchase price through the same ledger
(`spend` refuses what the balance cannot cover — an empty wallet reads
differently from a full shed, per #78's depot-queue rule), and a running cost
per vehicle-year books through the calendar exactly as track upkeep does.
"Add another train" becomes a decision; `retireTrain` becomes a verb worth
having.

### D5 — the modes become objective flavours over one model (phase 4)

- **Network** = the scored flavour: carry N, don't overcrowd — now with an
  economy (D3/D4) so the service must also pay for itself.
- **Citizens** = the endless flavour: population and happiness — now with a
  balance, so the answer to every problem costs something.
- **Tycoon** keeps its identity (the Train-Valley dispatch puzzle) and gains
  boards with towns where station demand is real.
- The road is already the competitor: every mode-choice a citizen makes
  against the railway is now a fare lost, and the mode-share bar becomes a
  revenue chart. Congestion pricing/tolls stay out of scope until a board
  proves the need.

## 4. Phases

- **Phase 1 — the keystone (#117): BUILT with this doc.** D2 then D1, in that
  order. Citizens quote and ride buses through the shared layer; `demandFor`
  becomes additive under the `edgeDemand` dial; the XOR survives only as the
  pair of defaults. Feature scenario: `/test/edgedemand`.
- **Phase 2 — passengers pay (D3): BUILT 2026-08-22.** The transit layer
  carries each journey's ORIGIN through every change and walk
  (`Waiting.from`/`Rider.from`) and reports finished, fare-worthy journeys
  (`collectDeliveries` — a walk-only journey is delivered for the score and
  earns nothing, `Waiting.rode`); a depot terminus reports the riders
  themselves (`deliverRiders`), paid for the distance carried. The game prices
  each journey (`passengerFare` in `economy.ts`: $2 flag fall + $3/tile
  Manhattan) and books ONE ledger entry per tick. Network gained
  `economy: { startingBalance: 0 }` (pure takings — no verbs to spend on
  until phase 3); Citizens gained `CITIZENS_TREASURY` ($40,000 — because an
  economy prices the BUILD verb, an empty purse would have killed the mode's
  whole answer; sized for one intercity line, refilled by the fares).
  `hud.money` on both. Scenario: `/test/farebox`.
- **Phase 3 — vehicles cost (D4, #91): BUILT 2026-08-22.** `VEHICLE_PRICE`
  charges for a train ($8,000) or a bus ($1,600) on any board with a ledger;
  `UpkeepSpec` bills the fleet per period, and `hud.money` grew one figure
  for it. Two refusals stay distinct, as the issue asked: a busy SHED delays
  the departure of an order it still takes, an empty WALLET refuses the
  order outright before anything is created. Network opens on capital for
  exactly one train (`NETWORK_CAPITAL`) and bills a minute; Citizens bills
  once per in-game day. Wages are deliberately NOT the calendar levy — same
  shape, different clock (see `UpkeepSpec`): forcing citizens onto a
  year-calendar would put a year-per-day date on the HUD. No bankruptcy
  either: these modes fail by an overflowing platform or an emptying town,
  and an unpayable fleet simply empties the purse.
  Scenario: `/test/vehiclecosts`. Measured there (one train): won at 382s,
  earned $2,688 against $720 of wages — a busy train clears its keep ~3.7x
  and does not repay its purchase in one run.

  A bug the phase surfaced and fixed: fares were booked ungated, so a WON
  board left running went on earning while its (gated) wages did not.
  Both now book only while the run is live.
- **Phase 4 — the roster reads the model** (D5): network/citizens differ only
  in objective + HUD; a tycoon town board prices fares off real demand.
- **Phase 5 — polish the competition**: per-kind ride speed in the quote,
  bus-stop interchanges (#111 step 2), road-side costs.

## 5. Phase 1, concretely

| file | change |
|---|---|
| `src/tiles/model.ts` | `TileCell.edgeDemand?: number` — authored, per stop tile |
| `src/tiles/cities.ts` | `boardingPointsInReachOf` (stations + bus stops); `WorldPlot.stationsInReach` carries both |
| `src/game.ts` | `demandFor` additive (share × derived schedule; cap preserved); bus calls carry the bus id and are fed to `citizenSim.step` as dwell events |
| `src/levels/test/scenarios/edgedemand.ts` | the mechanic in isolation: a town, a station pair, one stop dialled to import edge riders on top of its commuters |
| `src/levels/test/scenarios/busride.ts` | citizens riding a bus in isolation: homes and jobs joined by a bus line and nothing else |
| tests | unit: additive demand maths, citizens-quote-a-bus, bus mirror moves a citizen end to end |

## 6. Traps, recorded in advance

- **The mirror pops from the event, never the queue** — unchanged and still
  load-bearing (`docs/…citizens-and-cities…` §10). Edge riders move the queue
  too now, which is exactly why nothing may count the queue.
- **A bus dwell event must carry the BUS's id.** `busEvents` didn't; a
  tag-only mirror would strand riders on `arrived`-style terminations and
  could never keep a per-vehicle manifest view. The id costs nothing and keeps
  the mirror vehicle-agnostic.
- **Bus events are mirrored on the tick they happen.** `advanceBuses` runs
  after `citizenSim.step` in `advance()`; the citizen sim therefore receives
  the PREVIOUS tick's bus calls. One frame of lag on a dwell measured in
  seconds — but tests that step in large `dt` chunks must step once more
  before asserting a boarding.
- **`edgeDemand: 0` must mean OFF even where the default is 1** — the guard
  is `??`, never `||`.
- **The dial scales `intervalSec` by division.** A share of 0.25 means a
  4×-slower spawn, not a 4×-smaller crowd; `initial` scales multiplicatively
  and rounds down. Scaling `max` is forbidden (see D1).
- **`fits()` stays honest**: citizens still needs homes + workplaces; a
  citizens board whose stations all carry `edgeDemand` does not become a
  network board by accident — capabilities derive from the map, not the dial.
