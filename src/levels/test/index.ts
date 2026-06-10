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
import {
  buscrossboth,
  busmedian,
  busarterial,
  busmedianboth,
  busonewaycross,
  busmegacross,
} from "@/levels/test/scenarios/buscrosses";
import { turnglide } from "@/levels/test/scenarios/turnglide";
import { cardestination } from "@/levels/test/scenarios/cardestination";
import { carroute } from "@/levels/test/scenarios/carroute";
import { bigjunction } from "@/levels/test/scenarios/bigjunction";
import { crossturns2lane, crossturns3lane } from "@/levels/test/scenarios/crossturns";
import { mixedcross, mixedtee, curvefeed } from "@/levels/test/scenarios/mixedjunction";
import { keepcrossingclear } from "@/levels/test/scenarios/keepcrossingclear";
import { crossingkeeper } from "@/levels/test/scenarios/crossingkeeper";
import { objectives } from "@/levels/test/scenarios/objectives";
import { timeattack } from "@/levels/test/scenarios/timeattack";
import { daily } from "@/levels/test/scenarios/daily";

// The feature test world is a three-level tree: domain → category → scenario,
// rendered as a drill-down gallery at /test (see TestView.vue). Add a new feature
// by dropping a file in `scenarios/` and appending it to the matching category's
// `scenarios` array below (simplest first within a category).
export interface ScenarioCategory {
  id: string; // url slug within its domain, e.g. "lanes"
  label: string; // human label, e.g. "One-way & lanes"
  scenarios: TestScenario[];
}
export interface ScenarioDomain {
  id: string; // url slug, e.g. "streets"
  label: string; // human label, e.g. "Streets"
  categories: ScenarioCategory[];
}

export const DOMAINS: ScenarioDomain[] = [
  {
    id: "trains",
    label: "Trains",
    categories: [
      { id: "basics", label: "Basics", scenarios: [straight, curve, depot] },
      { id: "signals", label: "Signals & switches", scenarios: [signals, switchDefault] },
      { id: "junctions", label: "Junctions", scenarios: [junction, cross] },
      {
        id: "crossings",
        label: "Crossings",
        scenarios: [crossing, keepcrossingclear, crossingkeeper],
      },
    ],
  },
  {
    id: "streets",
    label: "Streets",
    categories: [
      {
        id: "basics",
        label: "Driving basics",
        scenarios: [carfollowing, carqueue, carcircle, carscurve],
      },
      { id: "curves", label: "Curves", scenarios: [roadcurveloops, roadcurvetraffic] },
      {
        id: "lanes",
        label: "One-way & lanes",
        scenarios: [roadoneway, roadstraightlanes, roadlanemerge, roadonewaylanes, crosslanes],
      },
      {
        id: "crosses",
        label: "Crosses & junctions",
        scenarios: [
          roadcross, roadcross1lane, roadcross2lane, roadcross3lane,
          crossturns2lane, crossturns3lane, mixedcross, mixedtee, curvefeed, turnglide, roadjunction, bigjunction,
        ],
      },
      {
        id: "turning",
        label: "Turning rules",
        scenarios: [turnlanes, rightturncross, noleftturn],
      },
      { id: "overtaking", label: "Overtaking", scenarios: [overtaketwolane, overtakeloop] },
      { id: "priority", label: "Priority", scenarios: [roadpriority] },
      {
        id: "vehicles",
        label: "Vehicles",
        scenarios: [trucks, buslane, buses, buscross, buscrossboth, busmedian, busarterial, busmedianboth, busonewaycross, busmegacross],
      },
      {
        id: "routing",
        label: "Destinations & routing",
        scenarios: [cardestination, carroute],
      },
    ],
  },
  {
    id: "challenges",
    label: "Challenges",
    categories: [
      { id: "modes", label: "Game modes", scenarios: [objectives, timeattack, daily] },
    ],
  },
];

// Flat registry, in picker order. Kept for lookup-by-id and the validation test
// that iterates every scenario; derived from the tree so there's one source.
export const SCENARIOS: TestScenario[] = DOMAINS.flatMap(d => d.categories).flatMap(
  c => c.scenarios
);

export function scenarioById(id: string | undefined): TestScenario {
  return SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0];
}

// Reverse lookup: the domain + category a scenario lives in. Used for breadcrumbs
// and the back-compat redirect from a bare `/test/:scenarioId` deep link.
export function locate(
  scenarioId: string
): { domain: ScenarioDomain; category: ScenarioCategory } | undefined {
  for (const domain of DOMAINS) {
    for (const category of domain.categories) {
      if (category.scenarios.some(s => s.id === scenarioId)) {
        return { domain, category };
      }
    }
  }
  return undefined;
}

export function domainById(id: string | undefined): ScenarioDomain | undefined {
  return DOMAINS.find(d => d.id === id);
}

// The representative scenario for a domain or category card (which have no level
// of their own): the first leaf scenario under it. Used to pick the preview art
// for the upper gallery levels.
export function firstScenarioOf(node: ScenarioDomain | ScenarioCategory): TestScenario {
  return "categories" in node ? node.categories[0].scenarios[0] : node.scenarios[0];
}

export type { TestScenario } from "@/levels/test/scenario";
