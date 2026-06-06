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
import { roadoneway } from "@/levels/test/scenarios/roadoneway";
import { roadtwolane } from "@/levels/test/scenarios/roadtwolane";
import { roadcross } from "@/levels/test/scenarios/roadcross";
import { roadjunction } from "@/levels/test/scenarios/roadjunction";
import { rightturncross } from "@/levels/test/scenarios/rightturncross";
import { noleftturn } from "@/levels/test/scenarios/noleftturn";
import { roadpriority } from "@/levels/test/scenarios/roadpriority";
import { trucks } from "@/levels/test/scenarios/trucks";
import { keepcrossingclear } from "@/levels/test/scenarios/keepcrossingclear";
import { crossingkeeper } from "@/levels/test/scenarios/crossingkeeper";
import { objectives } from "@/levels/test/scenarios/objectives";
import { timeattack } from "@/levels/test/scenarios/timeattack";

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
      carfollowing, carqueue, carcircle, carscurve,
      roadoneway, roadtwolane, roadcross, roadjunction,
      rightturncross, noleftturn, roadpriority, trucks,
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
    scenarios: [objectives, timeattack],
  },
];

// Flat registry, in picker order. Kept for lookup-by-id and the validation test
// that iterates every scenario; derived from the groups so there's one source.
export const SCENARIOS: TestScenario[] = SCENARIO_GROUPS.flatMap(g => g.scenarios);

export function scenarioById(id: string | undefined): TestScenario {
  return SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0];
}

export type { TestScenario } from "@/levels/test/scenario";
