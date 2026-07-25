import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// The rolling-stock gallery: every unit the renderer can draw, in four liveries,
// side by side. This is the scenario to open when changing `utils/trainArt.ts` —
// the art is procedural, so a regression shows up here before anywhere else.
//
// Four lanes, top to bottom:
//   green passenger  — express loco + three coaches
//   red freight      — shunter + four wagons (box van / tanker / timber / hopper,
//                      picked from each wagon's id, so this consist is identical
//                      on every load)
//   blue freight     — the same bodies in another livery
//   yellow passenger — a short two-coach set
//
// Every depot is grey and no train is, so nothing ever matches: each train
// bounces at the far end, runs home, bounces again and shuttles forever. That is
// deliberate — a train that parks is swallowed by its shed (game.ts hides units
// once they reach the depot centre), which would leave the gallery empty exactly
// when a screenshot is taken.
const lane = (row: number): Record<string, ReturnType<typeof expandKind>> => ({
  [`0,${row}`]: expandKind("depot", 1),
  [`1,${row}`]: expandKind("straight", 1),
  [`2,${row}`]: expandKind("straight", 1),
  [`3,${row}`]: expandKind("straight", 1),
  [`4,${row}`]: expandKind("straight", 1),
  [`5,${row}`]: expandKind("depot", 3),
});

export const rollingstock: TestScenario = {
  id: "rollingstock",
  name: "Rolling stock",
  description:
    "Every locomotive, coach and freight wagon body, in four liveries.",
  level: {
    ...lane(0),
    ...lane(1),
    ...lane(2),
    ...lane(3),
  },
  trains: {
    express: mkTrain("express", 0, 0, "people", 3, "5,0"),
    freightRed: mkTrain("freightRed", 0, 1, "fraight", 4, "5,1"),
    freightBlue: mkTrain("freightBlue", 0, 2, "fraight", 4, "5,2"),
    local: mkTrain("local", 0, 3, "people", 2, "5,3"),
  },
  colors: {
    depotColors: {
      "0,0": "grey",
      "5,0": "grey",
      "0,1": "grey",
      "5,1": "grey",
      "0,2": "grey",
      "5,2": "grey",
      "0,3": "grey",
      "5,3": "grey",
    },
    trainColors: {
      express: "green",
      freightRed: "red",
      freightBlue: "blue",
      local: "yellow",
    },
  },
};
