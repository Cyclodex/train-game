import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// Variable car speeds with car-following (platooning), on a divided road.
//
// Two parallel one-way lanes: the top row (y=0) runs left→right, the bottom row
// (y=1) runs right→left. Each car draws its own preferred (cruise) speed from a
// seeded spread, so they are not all equally fast: a quicker car launched behind
// a slower one steadily closes the gap, then settles in behind it at a
// comfortable bumper distance and matches its pace — it never overtakes (the
// follow-gap cap forbids passing within a lane). The slowest car in a group sets
// the platoon speed, exactly like real traffic.
//
// The lanes are separate rows, so the opposing streams never meet head-on. The
// eastbound (top) entry is listed twice in spawnEntries so it carries roughly
// twice the traffic of the lighter westbound (bottom) lane.
//
// There is no rail here — it's a pure road feature — so the scenario has no
// trains; the car simulation runs on its own.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: fromPairs(ports) });

const lane: Record<string, ReturnType<typeof road>> = {};
for (let x = 0; x < 8; x++) {
  lane[`${x},0`] = road([Position.Left, Position.Right]); // eastbound lane
  lane[`${x},1`] = road([Position.Left, Position.Right]); // westbound lane
}

export const carfollowing: TestScenario = {
  id: "carfollowing",
  name: "Variable car speeds + following",
  description:
    "A divided road: faster cars catch slower ones ahead and tail them into platoons without overtaking. The top lane runs left→right (busier), the bottom lane right→left (lighter).",
  level: lane,
  trains: {},
  size: { cols: 8, rows: 2 },
  // Spawn briskly so plenty of cars share each lane and bunch into platoons behind
  // the slowest car. The eastbound entry is weighted x2, so the top lane carries
  // about twice as many cars as the lighter westbound lane.
  traffic: {
    spawnInterval: 0.9,
    maxCars: 18,
    spawnEntries: [
      { coord: { x: 0, y: 0 }, entryPort: Position.Left }, // eastbound (top), weighted…
      { coord: { x: 0, y: 0 }, entryPort: Position.Left }, // …x2 for ~twice the traffic
      { coord: { x: 7, y: 1 }, entryPort: Position.Right }, // westbound (bottom), lighter
    ],
  },
};
