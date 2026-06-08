import { TestScenario } from "@/levels/test/scenario";
import { straight } from "@/levels/test/scenarios/straight";
import { curve } from "@/levels/test/scenarios/curve";
import { depot } from "@/levels/test/scenarios/depot";
import { signals } from "@/levels/test/scenarios/signals";
import { junction } from "@/levels/test/scenarios/junction";
import { switchDefault } from "@/levels/test/scenarios/switch-default";
import { cross } from "@/levels/test/scenarios/cross";
import { crossing } from "@/levels/test/scenarios/crossing";
import { carfollowing } from "@/levels/test/scenarios/carfollowing";
import { carqueue } from "@/levels/test/scenarios/carqueue";
import { carcircle } from "@/levels/test/scenarios/carcircle";
import { carscurve } from "@/levels/test/scenarios/carscurve";
import { roadcurveloops } from "@/levels/test/scenarios/roadcurveloops";
import { roadcurvetraffic } from "@/levels/test/scenarios/roadcurvetraffic";
import { roadoneway } from "@/levels/test/scenarios/roadoneway";
import { roadstraightlanes } from "@/levels/test/scenarios/roadstraightlanes";
import { roadlanemerge } from "@/levels/test/scenarios/roadlanemerge";
import { roadonewaylanes } from "@/levels/test/scenarios/roadonewaylanes";
import { roadcross } from "@/levels/test/scenarios/roadcross";
import {
  roadcross1lane,
  roadcross2lane,
  roadcross3lane,
} from "@/levels/test/scenarios/roadcrosslanes";
import { roadjunction } from "@/levels/test/scenarios/roadjunction";
import { crosslanes } from "@/levels/test/scenarios/crosslanes";
import { turnlanes } from "@/levels/test/scenarios/turnlanes";
import { overtaketwolane } from "@/levels/test/scenarios/overtaketwolane";
import { overtakeloop } from "@/levels/test/scenarios/overtakeloop";
import { rightturncross } from "@/levels/test/scenarios/rightturncross";
import { noleftturn } from "@/levels/test/scenarios/noleftturn";
import { roadpriority } from "@/levels/test/scenarios/roadpriority";
import { trucks } from "@/levels/test/scenarios/trucks";
import { buslane } from "@/levels/test/scenarios/buslane";
import { buses } from "@/levels/test/scenarios/buses";
import { buscross } from "@/levels/test/scenarios/buscross";
import { cardestination } from "@/levels/test/scenarios/cardestination";
import { carroute } from "@/levels/test/scenarios/carroute";
import { bigjunction } from "@/levels/test/scenarios/bigjunction";
import { crossturns2lane, crossturns3lane } from "@/levels/test/scenarios/crossturns";
import { keepcrossingclear } from "@/levels/test/scenarios/keepcrossingclear";
import { crossingkeeper } from "@/levels/test/scenarios/crossingkeeper";
import { objectives } from "@/levels/test/scenarios/objectives";
import { timeattack } from "@/levels/test/scenarios/timeattack";
import { daily } from "@/levels/test/scenarios/daily";

// A named group of scenarios in the picker, rendered as an <optgroup>.
export interface ScenarioGroup {
  id: string;
  label: string;
  scenarios: TestScenario[];
}

// The feature test world, grouped by domain so the picker stays readable as more
// mechanics land. Add a new feature by dropping a file in `scenarios/` and
// appending it to the matching group below (simplest first within a group).
export const SCENARIO_GROUPS: ScenarioGroup[] = [
  {
    id: "rail",
    label: "Rail",
    scenarios: [straight, curve, depot, signals, junction, switchDefault, cross],
  },
  {
    id: "road",
    label: "Road",
    scenarios: [
      carfollowing, carqueue, carcircle, carscurve, roadcurveloops, roadcurvetraffic,
      roadoneway, roadstraightlanes, roadlanemerge, roadonewaylanes,
      roadcross, roadcross1lane, roadcross2lane, roadcross3lane, crossturns2lane, crossturns3lane, crosslanes, roadjunction,
      turnlanes, overtaketwolane, overtakeloop, rightturncross, noleftturn, roadpriority, trucks, buslane, buses, buscross, cardestination,
      carroute, bigjunction,
    ],
  },
  {
    id: "crossing",
    label: "Rail × Road",
    scenarios: [crossing, keepcrossingclear, crossingkeeper],
  },
  {
    id: "objectives",
    label: "Objectives",
    scenarios: [objectives, timeattack, daily],
  },
];

// Flat registry, in picker order. Kept for lookup-by-id and the validation test
// that iterates every scenario; derived from the groups so there's one source.
export const SCENARIOS: TestScenario[] = SCENARIO_GROUPS.flatMap(g => g.scenarios);

export function scenarioById(id: string | undefined): TestScenario {
  return SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0];
}

export type { TestScenario } from "@/levels/test/scenario";
