# Workplace parking — where the commuter's car goes

Date: 2026-08-04
Status: proposal + phase A/B implemented on this branch

## The question

Half of all citizen journeys are driven (`sim/citizens.ts`, `chooseMode`), and
since 2026-08-02 a driving citizen **is a real car** on the street
(`roadSim.requestTrip`). But that car is **deleted on arrival**: half way across
the destination tile, `settleRequestedTrips` splices it out of the fleet. The
commuter's car does not exist while its owner is at work.

So the town has a rush hour with no consequences. Nothing accumulates at the
factory gate, no street fills up, and the `parkPenaltySec: 8` in the mode chooser
is a made-up constant standing in for a physical fact the board never checks.

Meanwhile the game already has a full, tested parking layer — bays, aprons,
aim tokens, the four-phase pull-in — and **not one citizen has ever used it.**
Parking is authored by hand with the editor tool, so on a citizen board (three
towns, a hundred plots, no hand-drawn car parks anywhere) there is nowhere for a
commuter to stop even if the sim let them.

## The answer: a ladder, not a rule

There is no single right place for the car. What a real town does depends on how
much room the workplace has, and the interesting game is in that gradient. So:

### 1. The forecourt — every workplace has a few staff spaces (DERIVED)

`terrain: industry` already says "this is a works". A works has a handful of
spaces at its gate. So **derive** them: for every work/shop plot, lay a short
rank of kerb bays on the road tile its driveway joins, on the kerb facing the
plot. No authoring, no new tile axis — it is the existing `ParkingRow`, computed
from the zoning the map already carries.

**Three spaces, for a workplace that employs twelve to ninety-six.** That gap is
deliberate and it is the whole mechanic: the forecourt is never enough. It is
enough for the first arrivals, and everybody else has to find somewhere else.
This is the answer to "should industry buildings have 2-3 parkslots?" — yes,
exactly that few, and not as a convenience but as a bottleneck.

Three is also what physically fits: a `parallel` bay's pitch is 60px on a 200px
tile, so three bays fill the tile edge-to-edge. A rank of two reads as an
unfinished car park (canon, KNOWHOW → PARKING).

### 2. The street — kerbside parking, marked or not (AUTHORED)

When the forecourt is full the driver takes the kerb further down the street.
That already works: a `parallel` row is exactly it.

What did not exist is the **American wide street**: a carriageway with its normal
lane markings and a parking edge with **no bay lines at all** — you just stop
along the kerb. That is not a new stall kind (depth, pitch, manoeuvre and exit
style are all identical to `parallel`); it is one property of paint:

```ts
ParkingRow.marking?: "bays" | "none"   // default "bays"
```

`"none"` keeps the apron (the street reads as wider here, which is what it is)
and the outer kerb line, and drops the white boxes. A continuous unmarked run
down a whole street is a wide American arterial with kerb parking; the same run
with `"bays"` is a European marked bay rank. One field, one branch in the
painter, and the region flavour is an authoring choice per board.

Note the hard limit canon already established: **kerb parking caps at a 2+2
arterial.** At 3+3 the kerb sits 84px out and less than a car's width of tile
remains. An American arterial with kerb parking really is 2+2, so the model and
the world agree — but it means "just make the street wider" is not available as
an escape hatch. Two lanes each way and a parking edge is the widest street this
game has.

### 3. The car park — the player builds one (AUTHORED, the lever)

When neither is enough, the answer is a car park, and building it is the
player's move. That is what makes this a game mechanic rather than scenery: a
factory whose staff spend two minutes circling is a factory whose workers'
journeys are slow, whose mood falls, and who eventually move away — and the fix
is either a car park or a railway station.

## The mechanic

What makes any of the above matter is that the car has to still be there at 5pm.

- A commuting driver's trip is dispatched with a **parking destination**: the
  nearest facility with a free bay near the workplace, not the workplace tile.
- The car parks with the ordinary phase machine and **holds the bay for the whole
  working day** — dwell is owned by the citizen, not by a timer.
- The **walk from the bay to the desk** is charged to the journey, measured from
  where the car actually stopped. That replaces the flat `parkPenaltySec` with a
  real number, and it is what makes parking far away cost something.
- At going-home time the citizen **releases the car**, it pulls out of the bay
  and drives home, and is retired at the front door.
- If nothing has a space in reach, the trip still completes — the driver "found
  something down the road" — but pays a **search penalty**. Canon: a saturated
  network must slow people, never strand them.

## Why not the alternatives

**Park on the plot itself, no road tile involved.** A bay has to hang off a lane
— that is what the whole manoeuvre model is built on (`pathFor`, `startTOf`,
`servedLane`). A bay on a plot would need a driveway primitive: a new lane kind
into a non-road tile, which `roadPortsOf` would read as a junction (canon:
"NEVER model a bay as a `Lane` into `Position.Center`"). Not worth a new
primitive for what a kerb rank already says.

**Give every workplace a whole car-park tile.** A tile carrying parking is not a
plot (`isBuildableGround`), so every workplace would eat a neighbouring address
and an industry district would be half tarmac. Worse, it would have to be
authored, so no existing board would get it.

**Let the car just vanish, and keep the flat penalty.** That is today, and it is
why the board has a rush hour with nothing at stake.

## What ships on this branch

- **A** `tiles/workplaceParking.ts` — `deriveWorkplaceParking(level, grid)`:
  staff ranks at every work/shop plot's kerb, idempotent, validated (any row the
  parking validator rejects is dropped rather than shipped). Wired into the
  citizens mode's `setup`, so every citizen board grows staff parking.
- **B** `ParkingRow.marking` — the unmarked American kerb, plus the editor dock
  entry and `/test/wideStreet` showing the two side by side.
- **C** The commuter round trip: `requestTrip(..., { park: true })`, a held bay,
  a real walk-to-the-desk charge, `releaseTrip` and the drive home.
- **D** `/test/workparking` — one works, three staff bays, more drivers than
  bays, so the queue for a space is the thing you watch.

## Open ends

- The forecourt is derived **once, at setup**. A road built next to a workplace
  in play does not grow bays. Re-deriving on `applyEdits` is the follow-up; the
  pass is already idempotent for it.
- Nobody walks *on the pavement* from the bay to the desk yet — the walk is
  charged as time. Handing that leg to `pedestrianSim` is the next step, and is
  what would make a full car park visibly feed a stream of people to a factory.
- Parking charges (money) are not modelled. The tycoon ledger is the obvious
  home for it, and "paid parking pushes people onto the train" is the mode's
  most natural next dial.
