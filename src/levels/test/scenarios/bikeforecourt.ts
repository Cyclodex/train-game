import { Position } from "@/types";
import { twoWay } from "@/tiles/lanes";
import { TileCell } from "@/tiles/model";
import { TestScenario } from "@/levels/test/scenario";
import { deriveWorkplaceParking } from "@/tiles/workplaceParking";
import { deriveWorkplaceBikeRacks } from "@/tiles/workplaceBikeRacks";

// THE BIKE FORECOURT — the works grows its own mini-rack, and it is too small.
//
// One street, one works, and nothing drawn by hand: the `terrain: "industry"`
// is all the map says. The car pass lays three staff bays on the gate kerb
// (they fill it edge to edge), and the bike pass — the subject here — lays SIX
// stands one tile along the same kerb, because the gate kerb is spoken for.
// That placement is the mechanic on display: two derived rows negotiating one
// frontage through the validator's own gates.
//
// Then the street delivers more cyclists than the rack can hold. Ambient
// traffic is bike-heavy and the stands keep a workday-ish dwell, so the rack
// FILLS and stays full — the 🚲 chip goes red — while later riders pass the
// works with nowhere to lean. That gap is deliberate (six stands against a
// workforce), and it is what task 3's wild parking will make visible on the
// pavement. The occasional car takes a staff bay, so the two ranks read side
// by side: cars lying along the kerb, bikes nosed into their hoops.
//
// Design: docs/superpowers/specs/2026-08-21-bike-destination-parking-design.md
const street = (): TileCell => ({
  connections: [],
  road: twoWay(Position.Left, Position.Right),
});

const works = (): TileCell => ({
  connections: [],
  terrain: "industry",
  city: "gateworks",
});

const base: Record<string, TileCell> = {};
for (let x = 0; x <= 6; x++) base[`${x},1`] = street();
base["3,0"] = works();

// Derived, not drawn — applied here, in the scenario's own data, so the board
// a test loads and the board a player sees are the same board. Car pass first,
// bike pass second: the order the citizens mode's setup runs them in.
const level = deriveWorkplaceBikeRacks(deriveWorkplaceParking(base));

export const bikeforecourt: TestScenario = {
  id: "bikeforecourt",
  name: "Bike forecourt",
  description:
    "A works derives six bike stands beside its three staff bays — and more " +
    "riders arrive than stands exist. Watch the rack fill and the late ones ride on.",
  level,
  trains: {},
  size: { cols: 7, rows: 3 },
  // Bike-heavy, and MORE of them than the six stands can hold: the fill-up is
  // the thing you watch. A car now and then takes a staff bay for contrast.
  traffic: { spawnInterval: 1.0, maxCars: 14, mix: { bike: 5, car: 1 } },
};
