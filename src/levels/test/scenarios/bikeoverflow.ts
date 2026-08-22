import { Position } from "@/types";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { deriveWorkplaceParking } from "@/tiles/workplaceParking";
import { deriveWorkplaceBikeRacks } from "@/tiles/workplaceBikeRacks";
import { citizensModeWith } from "@/modes/citizens";

// BIKE OVERFLOW — the mini-rack saturates, and the pavement shows it.
//
// `/test/bikeforecourt` is the rack filling; this is what happens NEXT. One
// works, six derived stands, and a town whose cycling workforce outnumbers
// them several times over — with ambient riders leaning on the same six. The
// first arrivals get the gate; everybody after rides up, finds every stand
// taken, and leaves the bike LEANING on the pavement by the driveway: the
// WILD PARK, the visible backstop of the destination-parking ladder
// (`Citizen.parkedBike.wild`, drawn by `game.ts → updateWildBikes`).
//
// What to watch:
//  1. **The morning.** Cyclists stream to the works; six rack, the rest lean.
//     Grey frames accumulate on the pavement either side of the gate, growing
//     outward and untidier with every arrival — clutter as a headcount.
//  2. **The cost.** Each wild park charges `bikeSearchSec` (+ a little per
//     bike already leaning there) to that rider's journey, so the clutter you
//     can see is the mood damage you cannot — same fact, two views. The fix
//     is the editor's rack tool, which is the whole point.
//  3. **The evening.** Everyone comes back for their OWN bike — the leaning
//     ones vanish one by one as their riders saddle up — and the pavement is
//     clear by nightfall. A cycle, not a sink.
//
// The clock runs a day in four minutes (the homeparking board's trick), so
// the fill-up and the clear-out both happen while somebody actually watches.
//
// Design: docs/superpowers/specs/2026-08-21-bike-destination-parking-design.md
const street = (): TileCell => ({
  connections: [],
  road: twoWay(Position.Left, Position.Right),
});

const works = (): TileCell => ({
  connections: [],
  terrain: "industry",
  city: "leanworks",
});

const home = (): TileCell => ({
  connections: [],
  terrain: "urban",
  // Pinned HOUSING, every plot: the derived shop-share would turn the centre
  // of the row into a parade of shops, and this board needs residents whose
  // one long trip is the ride to the works — not short hops to a shop next
  // door.
  zone: "home",
  city: "leanworks",
});

// One straight street, open at both ends so ambient riders roll through and
// compete for the same six stands the commuters want.
const base: Record<string, TileCell> = {};
for (let x = 0; x <= 9; x++) base[`${x},2`] = street();

// The works, mid-street, so doors on BOTH sides of it sit at riding distance
// — one gate, one six-stand rack, and the whole town's workforce converging
// on it from two directions.
base["5,1"] = works();

// The homes, staggered so every door is 4-6 MANHATTAN tiles from the works:
// at 4 the walk is a slog most people price away, at 5 the ordinary rider's
// range (`bikeRangeOf` typical) still reaches, and the 6s are for the keen
// tail. Further out the bike row refuses ("too-far") and the board goes
// quiet — measured, not guessed. The south row runs a step closer along the
// street because its people cross the road too (the quote is manhattan).
for (const id of ["0,1", "1,1", "9,1", "1,3", "2,3", "3,3", "7,3", "8,3", "9,3"]) {
  base[id] = home();
}

// Derived, not drawn — in the scenario's own data, so the board a test loads
// and the board a player sees are the same board (TestStage hands the level
// straight to createGame; the mode's setup pass is a no-op on it). Car pass
// first, bike pass second: the citizens mode's own order.
const level = deriveWorkplaceBikeRacks(deriveWorkplaceParking(base));

export const bikeoverflow: TestScenario = {
  id: "bikeoverflow",
  name: "Bike overflow",
  description:
    "More cyclists than the works' six stands can hold. The late ones lean the " +
    "bike at the gate — watch the pavement clutter grow, and empty again at night.",
  // The fast clock, because the subject is a daily cycle (see homeparking) —
  // and a CYCLING TOWN: nearly every shed has a bike and few households run a
  // car, so the works' six stands face the whole workforce at once. The dials
  // exist to demonstrate the overflow, the way homeparking's clock exists to
  // demonstrate the drive cycle; the shipped defaults stay untouched.
  mode: citizensModeWith({
    secPerDay: 240,
    bikeOwnership: 0.95,
    carOwnership: 0.25,
    // A workforce-heavy town: the morning peak at the gate is the subject, so
    // most of the population has a gate to be at.
    stageMix: { child: 0.05, worker: 0.7, shiftWorker: 0.1, tradesperson: 0.05, retired: 0.1 },
  }),
  level,
  trains: {},
  size: { cols: 10, rows: 5 },
  // Bike-heavy ambient traffic: passing riders take stands too (the rack keeps
  // an ambient dwell), so the mini-rack saturates early and STAYS saturated —
  // the wild park is the rule of this board, not the exception.
  traffic: { spawnInterval: 1.2, maxCars: 10, mix: { bike: 4, car: 1 } },
};
