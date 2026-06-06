import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";

// Variable car speeds with car-following (platooning).
//
// A single long one-way lane (row y=0, x=0..7) open at both map edges. Cars enter
// from the left and drive right. Each car draws its own preferred (cruise) speed
// from a seeded spread, so they are not all equally fast: a quicker car launched
// behind a slower one steadily closes the gap, then settles in behind it at a
// comfortable bumper distance and matches its pace — it never overtakes (the
// follow-gap cap forbids passing on a single lane). The slowest car in a group
// sets the platoon speed, exactly like real traffic on a one-lane road.
//
// There is no rail here — it's a pure road feature — so the scenario has no
// trains; the car simulation runs on its own. Watch a long enough run and you'll
// see faster cars reel in slower leaders and bunch into little platoons.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: ports });

export const carfollowing: TestScenario = {
  id: "carfollowing",
  name: "Variable car speeds + following",
  description:
    "Cars cruise at their own preferred speeds; a faster car catches the slower one ahead and tails it without overtaking, forming a platoon.",
  level: {
    "0,0": road([Position.Left, Position.Right]),
    "1,0": road([Position.Left, Position.Right]),
    "2,0": road([Position.Left, Position.Right]),
    "3,0": road([Position.Left, Position.Right]),
    "4,0": road([Position.Left, Position.Right]),
    "5,0": road([Position.Left, Position.Right]),
    "6,0": road([Position.Left, Position.Right]),
    "7,0": road([Position.Left, Position.Right]),
  },
  trains: {},
  size: { cols: 8, rows: 1 },
};
