# Home parking — where the car sleeps

Date: 2026-08-05
Status: implemented
Follows: `2026-08-04-workplace-parking-design.md` (the day half of the same question)

## The question

> "die meisten die ein haus haben, parkieren ihr auto in der einfahrt, garage
> oder so. müssten wir das evtl. berücksichtigen?"

Yes — and the interesting part is not that it is true, it is that the model was
already **relying** on it being true without modelling it.

Workplace parking shipped with an explicit carve-out. A citizen driving home did
not compete for a space; their car was deleted at the front door, and the comment
in `sim/citizens.ts` said why:

> "Going HOME: no. A house has a driveway (which is exactly why homes get no
> forecourt derived outside them), so arriving home does not consume a public
> space."

That reasoning is correct and the carve-out was the right call at the time — the
alternative, measured, was residents silently converting every public bay on the
board into permanent overnight parking (12 of 12 held at 03:00 on
`/test/workparking`, rising to the cap over four days). But it left the model
resting on a fact nothing on the board expressed:

- **Nobody could see it.** A town's cars vanished every evening. At 03:00 the
  board was empty, which is the one thing a real town at 03:00 is not.
- **Nothing counted it.** "A house has a driveway" is not a quantity. It cannot
  be full, so it cannot be a constraint, so it cannot be a mechanic.
- **It is only true up to a point.** A bungalow's drive holds the household's
  cars. A block of flats' does not, and the street outside a terraced row is
  lined with cars for exactly that reason.

## The answer: the drive is real, private, and fixed

`tiles/homeParking.ts` derives, for every home plot with a frontage,
**two spaces of its own hardstanding** on the road tile the house fronts onto.
Nobody draws them; the map already said somebody lives there.

### 1. It is PRIVATE, and that is a new axis

`ParkingRow.resident` names the address a row belongs to. A row with it set is
not public parking that happens to be near a house — a stranger may not use it
however empty it is.

This is deliberately **not** a `StallReservation`. A reservation is a painted
class of bay in a public facility (disabled, delivery, loading) and it answers
"what sort of vehicle may stop here". Ownership answers "whose tarmac is this",
which no paint decides. Keeping them apart is also what lets two houses facing
the same road tile put two rows on it and each keep their own — a facility-level
permit could not have told them apart, and a facility per drive would have
fragmented every street into one-tile car parks.

The gate is `permitAdmits(row, permit)` in `sim/parking.ts`, and the permit — the
driver's home plot id — is threaded through every counting question the registry
answers (`openFacilities`, `capacity`, `freeCount`, `availableFor`,
`pickStallOn`). It has to be: a street of houses is genuinely **full to a
stranger and empty to the people who live there**, and a router that could not
see both would either send every passing car onto somebody's drive or send the
residents past their own.

### 2. It is FIXED, and the household is not

Two spaces per house, always. A home plot holds four people at density 0 and up
to thirty-two at density 3 (`cities.ts` CAPACITY) while its frontage stays
exactly as wide as it always was.

**That gap is the mechanic, and nobody authored it.** It falls out of a building
that grows taller on ground that does not grow wider — which is also the real
reason terraced streets are the ones lined with parked cars. At ~55% car
ownership a bungalow's drive covers its household outright and a built-up plot
covers a quarter of it.

Not one space: two cars per household is the ordinary case, and starting everyone
short would flatten the gradient to nothing. Not four: two 90° bays are 56px of a
200px frontage, four are 112px — most of the house's width, and it reads as a
small car park rather than as somebody's drive.

### 3. The overspill goes on the street

A resident whose drive is full takes ordinary public kerb, competed for on the
same terms as everybody else — and **that is the player's lever**. If it were
private-or-nothing, building a car park in a residential street would fix
nothing, and the whole ladder would stop one rung short.

The fence that keeps the old failure out is `homeParkTiles: 2`. A commuter will
walk six tiles from a bay to the office; nobody does that from their own front
door every night, with the shopping. Your street and the next one is the whole of
it, and a workplace forecourt across town is simply out of reach.

The measured difference from the rejected version is not that residents keep off
public bays — they use them, which is what a street with no drives really looks
like — but that they **give them back every morning**. `/test/workparking` now
runs at ~11 cars parked at home overnight and ~0–1 by mid-morning, with 490+
journeys completed. The old failure was a ratchet; this is a cycle.

## What it took beyond the derivation

Three things that were not obvious until the board was watched rather than
reasoned about:

- **The drive home is a parking trip too, and it could not be planned when it was
  asked for.** `requestTrip` plans from a standing start, but the evening leg
  begins with the car already in a bay outside the office — the route out of that
  bay is built later, by `resumeFromStall`, from wherever the car actually is. So
  the wish is recorded on the car (`Car.parkWish`) and honoured then. Without it,
  the one leg of the day that still deleted the vehicle was the drive home, and
  the drives stood empty all night while the works' bays filled.

- **"Released" had to become "released from WHICH bay".** A car keeps phase
  `parked` while it waits in its space for a gap in the traffic, so the settle
  test needed to know not to re-park it. A boolean said "released" for the rest
  of the journey — including when it reached its own drive, which was therefore
  never recorded. Comparing the stall id is exact and drops the flag.

- **A car parked at home must not follow its owner around.** The rule that sends
  a left-behind car after its owner is right at a workplace (a held public bay
  with nobody coming back is a space nobody can use) and inverts at home: every
  resident who walked to the shops would send their car driving off after them,
  so a town of pedestrians would empty its own drives and fill its streets with
  cars going nowhere.

And two consequences elsewhere:

- **The requested-car cap had to stop counting parked cars.** Counting them was
  right while only commuters parked — their cars were gone by evening, so the cap
  turned over. Once the car also comes home, a car owner's vehicle is on the
  board for good, and all sixty slots would be taken by whoever commuted first,
  after which nobody else could ever be dispatched a car. Nothing is unbounded as
  a result, for a physical rather than an arithmetic reason: a car only counts as
  parked while it holds a real stall, so parked cars are bounded by the number of
  spaces the board has.

- **A facility with no public capacity draws no sign.** The renderer showed
  "P VOLL" over an empty drive — a car park, standing empty, announcing that it
  is full — because `capacity` correctly reported zero public spaces. Nobody puts
  a P sign on their own driveway.

## Why not the alternatives

**Park on the plot itself.** A bay hangs off a lane; that is what the whole
manoeuvre model is built on. A bay on a plot needs a driveway primitive — a lane
into a non-road tile, which `roadPortsOf` reads as a junction. The frontage tile
says the same thing with nothing new. (Same answer as the workplace pass.)

**Give the drive to the household as capacity, not geometry** ("residents just
always park, invisibly"). That is the hand-wave this replaces. It cannot be full,
cannot be seen, and cannot be built.

**Scale the drive with density.** Tempting, and wrong twice over: the map only
ever opens plots at density 0–2 (the sim owns growth from there), so it would
have no gradient at setup; and a drive that grows with the building is a drive
that is never short, which is the whole point.

**Let residents park anywhere at night.** Measured, rejected, documented above.

## What ships

- `ParkingRow.resident` + `BayClass "resident"` + `permitAdmits`, and the permit
  threaded through the registry's counting questions.
- `tiles/homeParking.ts` — `deriveHomeParking(level)`: one drive per house, at
  its frontage, validated and idempotent **per address** (not per kerb — a corner
  house whose first frontage is taken by its own drive would otherwise grow a
  second one on the next street on every run).
- `TripRequest.permit`, `Car.parkPermit`, `Car.parkWish`, and `releaseTrip`
  taking a park request so the evening commute ends on the drive.
- `CitizenTuning.homeParkTiles`, `CitizenStats.carsAtHome`.
- A pale hardstanding fill, so which tarmac is private is visible rather than
  merely true.
- `/test/homeparking`, under a four-minute day so the cycle is watchable.

## Open ends

- **The drive is derived at setup, like the forecourt.** A house built next to a
  road in play does not grow one. Both passes are idempotent and ready for a
  re-derive on `applyEdits`.
- **A garage is not distinguished from a drive.** `StallKind: "garage"` already
  exists (the car is hidden inside the building) and is the obvious flavour for a
  block of flats with parking underneath — which would also give the densest
  plots a lever they currently lack.
- **Nobody walks the drive-to-door leg on a pavement**; it is charged as time,
  the same as the workplace half.
- **Resident permits are per address, and per household would be sharper.** Two
  houses on one road tile keep separate rows today, which is right; a household
  that owns three cars still has no way to hold a third space anywhere.
