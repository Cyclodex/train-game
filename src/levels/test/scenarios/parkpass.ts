import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { twoWay } from "@/tiles/lanes";
import type { ParkingRow } from "@/tiles/parking";
import { citizensModeWith } from "@/modes/citizens";

// PARK & PASS — the informal kerb's isolation board, and nothing else.
//
// One 1+1 street, two stretches of BARE KERB (`informal: true` — no apron, no
// lines, no sign; with the debug overlay on they show as dashed ghost boxes),
// ambient traffic flowing both ways. A car parked informally stands HALF ON
// THE KERB, so its road-side half protrudes into the kerb lane and every
// passing car has to squeeze by (game.ts's renderer squeeze, capped below the
// centreline). This is where "cars drive through each other" reports get
// reproduced: one mechanic, the narrowest street it can happen on, and nothing
// competing for the eye.
//
// The 1+1 profile is DELIBERATE: it is the worst case. The kerb-lane centre is
// half a lane (14px) from the centreline, so the squeeze has the least room it
// ever gets; a board that passes here passes everywhere. The paired unit test
// (`tests/unit/roadBodyOverlap.spec.ts`) drives this exact level headless and
// asserts NO pair of rendered bodies ever overlaps — moving×moving and
// moving×parked alike — using the same offsets + squeeze the renderer runs.
const street = (terrain: "urban" | "industry" = "urban") => ({
  connections: [],
  road: twoWay(Position.Left, Position.Right),
  terrain,
});

// Two homes and a works, and DELIBERATELY no parking at either: no drives, no
// forecourt (none of the derive passes run here). The commuters' cars have
// exactly one place to stop — the bare kerb — so the board shows the squeeze
// within a working day instead of only when a test scripts a trip.
const home = () => ({ connections: [], terrain: "urban" as const, city: "passtown" });
const works = () => ({ connections: [], terrain: "industry" as const, city: "passworks" });

// Bare kerb on the south bank (right of eastbound travel): the exact rows
// `deriveKerbOverflow` lays, authored here so the board needs no derive pass.
const bareKerb = (): ParkingRow => ({
  from: Position.Left,
  side: "right",
  kind: "parallel",
  count: 2,
  align: "pack",
  informal: true,
  marking: "none",
});

export const parkpass: TestScenario = {
  id: "parkpass",
  name: "Park & pass",
  description:
    "A 1+1 street with two stretches of bare kerb. Commuters park half on the kerb, and the traffic squeezes past — nobody drives through anybody. Debug overlay shows the invisible spaces as dashed ghosts.",
  level: {
    "1,0": home(),
    "2,0": home(),
    "4,0": works(),
    "0,1": street(),
    "1,1": street(),
    "2,1": { ...street(), parking: { dwellSec: [30, 60] as [number, number], rows: [bareKerb()] } },
    "3,1": { ...street(), parking: { dwellSec: [30, 60] as [number, number], rows: [bareKerb()] } },
    "4,1": street("industry"),
    "5,1": street(),
  },
  trains: {},
  size: { cols: 6, rows: 3 },
  traffic: { spawnInterval: 0.9, maxCars: 8, mix: { car: 1 } },
  // A short working day, so the commute → park at the kerb → walk in → drive
  // home cycle plays out while somebody is watching.
  mode: citizensModeWith({ secPerDay: 240 }),
};
