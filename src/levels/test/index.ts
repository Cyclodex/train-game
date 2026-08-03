import { TestScenario } from "@/levels/test/scenario";
import { straight } from "@/levels/test/scenarios/straight";
import { curve } from "@/levels/test/scenarios/curve";
import { depot } from "@/levels/test/scenarios/depot";
import { station } from "@/levels/test/scenarios/station";
import { transfer } from "@/levels/test/scenarios/transfer";
import { platformstop } from "@/levels/test/scenarios/platformstop";
import { stationhouse } from "@/levels/test/scenarios/stationhouse";
import { boarding } from "@/levels/test/scenarios/boarding";
import { catchment } from "@/levels/test/scenarios/catchment";
import { parkandride } from "@/levels/test/scenarios/parkandride";
import { busfeeder } from "@/levels/test/scenarios/busfeeder";
import { threecities } from "@/levels/test/scenarios/threecities";
import { citizencars } from "@/levels/test/scenarios/citizencars";
import { citizenwalk } from "@/levels/test/scenarios/citizenwalk";
import { citizenzebra } from "@/levels/test/scenarios/citizenzebra";
import { citizenrail } from "@/levels/test/scenarios/citizenrail";
import { citizenchoice } from "@/levels/test/scenarios/citizenchoice";
import { rollingstock } from "@/levels/test/scenarios/rollingstock";
import { signals } from "@/levels/test/scenarios/signals";
import { junction } from "@/levels/test/scenarios/junction";
import { switchDefault } from "@/levels/test/scenarios/switch-default";
import { switchFan } from "@/levels/test/scenarios/switch-fan";
import { cross } from "@/levels/test/scenarios/cross";
import { crossing } from "@/levels/test/scenarios/crossing";
import { carfollowing } from "@/levels/test/scenarios/carfollowing";
import { carqueue } from "@/levels/test/scenarios/carqueue";
import { carcircle } from "@/levels/test/scenarios/carcircle";
import { carscurve } from "@/levels/test/scenarios/carscurve";
import { roadcurveloops } from "@/levels/test/scenarios/roadcurveloops";
import { roadcurvetraffic } from "@/levels/test/scenarios/roadcurvetraffic";
import { curvepace } from "@/levels/test/scenarios/curvepace";
import { roadoneway } from "@/levels/test/scenarios/roadoneway";
import { roadstraightlanes } from "@/levels/test/scenarios/roadstraightlanes";
import { roadlanemerge } from "@/levels/test/scenarios/roadlanemerge";
import { lanedrop } from "@/levels/test/scenarios/lanedrop";
import { lanechangegap } from "@/levels/test/scenarios/lanechangegap";
import { roadonewaylanes } from "@/levels/test/scenarios/roadonewaylanes";
import { roadcross } from "@/levels/test/scenarios/roadcross";
import {
  roadcross1lane,
  roadcross2lane,
  roadcross3lane,
} from "@/levels/test/scenarios/roadcrosslanes";
import { roadjunction } from "@/levels/test/scenarios/roadjunction";
import { signalturnlanes } from "@/levels/test/scenarios/signalturnlanes";
import {
  signaltwophase,
  signalroundrobin,
  signalbuspriority,
  signalbuslane1l,
  signalbuslane3l,
} from "@/levels/test/scenarios/signalcross";
import { crosslanes } from "@/levels/test/scenarios/crosslanes";
import { turnlanes } from "@/levels/test/scenarios/turnlanes";
import { turnfan } from "@/levels/test/scenarios/turnfan";
import { overtaketwolane } from "@/levels/test/scenarios/overtaketwolane";
import { overtakeloop } from "@/levels/test/scenarios/overtakeloop";
import { overtakeabort } from "@/levels/test/scenarios/overtakeabort";
import { rightturncross } from "@/levels/test/scenarios/rightturncross";
import { noleftturn } from "@/levels/test/scenarios/noleftturn";
import { laneDiscipline } from "@/levels/test/scenarios/laneDiscipline";
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
import { busshortcut } from "@/levels/test/scenarios/busshortcut";
import { busjunction } from "@/levels/test/scenarios/busjunction";
import { buslaneBoundary } from "@/levels/test/scenarios/buslane-boundary";
import { turnglide } from "@/levels/test/scenarios/turnglide";
import { cardestination } from "@/levels/test/scenarios/cardestination";
import { carroute } from "@/levels/test/scenarios/carroute";
import { bigjunction } from "@/levels/test/scenarios/bigjunction";
import { crossturns2lane, crossturns3lane } from "@/levels/test/scenarios/crossturns";
import { mixedcross, mixedtee, curvefeed } from "@/levels/test/scenarios/mixedjunction";
import { turngallery } from "@/levels/test/scenarios/turngallery";
import { keepcrossingclear } from "@/levels/test/scenarios/keepcrossingclear";
import { crossingkeeper } from "@/levels/test/scenarios/crossingkeeper";
import { objectives } from "@/levels/test/scenarios/objectives";
import { timeattack } from "@/levels/test/scenarios/timeattack";
import { dispatch } from "@/levels/test/scenarios/dispatch";
import { faredistance } from "@/levels/test/scenarios/faredistance";
import { heldby } from "@/levels/test/scenarios/heldby";
import { buildgap } from "@/levels/test/scenarios/buildgap";
import { taxyear } from "@/levels/test/scenarios/taxyear";
import { bankrupt } from "@/levels/test/scenarios/bankrupt";
import { daily } from "@/levels/test/scenarios/daily";
import { networkmode } from "@/levels/test/scenarios/networkmode";
import { demoworld } from "@/levels/test/scenarios/demoworld";
import { terrain } from "@/levels/test/scenarios/terrain";
import { townscape } from "@/levels/test/scenarios/townscape";
import { farmland } from "@/levels/test/scenarios/farmland";
import { bridge } from "@/levels/test/scenarios/bridge";
import { tunnel } from "@/levels/test/scenarios/tunnel";
import { flyover } from "@/levels/test/scenarios/flyover";
import { grades } from "@/levels/test/scenarios/grades";
import { mountainpass } from "@/levels/test/scenarios/mountainpass";
import { terraces } from "@/levels/test/scenarios/terraces";
import { hillsides } from "@/levels/test/scenarios/hillsides";
import { industry } from "@/levels/test/scenarios/industry";
import { clearing } from "@/levels/test/scenarios/clearing";
import { forestworld } from "@/levels/test/scenarios/forestworld";
import { landprices } from "@/levels/test/scenarios/landprices";
import { lakevalley } from "@/levels/test/scenarios/lakevalley";
import { lakevalleyOpen } from "@/levels/test/scenarios/lakevalley-open";
import { parkingkerb } from "@/levels/test/scenarios/parkingkerb";
import { parkinglot } from "@/levels/test/scenarios/parkinglot";
import { parkinglorry } from "@/levels/test/scenarios/parkinglorry";
import { busstops } from "@/levels/test/scenarios/busstops";
import { buslayby } from "@/levels/test/scenarios/buslayby";
import { parkvariants } from "@/levels/test/scenarios/parkvariants";
import { parkechelon } from "@/levels/test/scenarios/parkechelon";
import { parkcity } from "@/levels/test/scenarios/parkcity";
import { syncJunctionLanesAround } from "@/tiles/editOps";

// Every scenario level passes through the same junction sync the editor runs
// on save/load: car-lane movements derived from the arms' widths (the
// receiving-capacity rule), busTo gates second. Hand-authored maps thereby
// always match what the editor would build, and the /test gallery doubles as
// a visual regression test of the derivation. Movements an author removed
// stay removed (the derivation only re-distributes exits a lane already
// reaches — see docs/superpowers/specs/2026-06-12-junction-lane-capacity-design.md).
function deriveJunctions(s: TestScenario): TestScenario {
  const level = { ...s.level };
  const changed = syncJunctionLanesAround(level, Object.keys(level));
  if (Object.keys(changed).length === 0) return s;
  for (const [id, cell] of Object.entries(changed)) level[id] = cell;
  return { ...s, level };
}

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
      { id: "basics", label: "Basics", scenarios: [straight, curve, depot, rollingstock] },
      { id: "signals", label: "Signals & switches", scenarios: [signals, switchDefault, switchFan] },
      { id: "junctions", label: "Junctions", scenarios: [junction, cross, flyover] },
      { id: "grades", label: "Grades", scenarios: [grades, terraces, hillsides, mountainpass] },
      { id: "stations", label: "Stations", scenarios: [station, platformstop, stationhouse, boarding, transfer, catchment, parkandride, busfeeder, threecities, citizencars, citizenwalk, citizenzebra, citizenrail, citizenchoice] },
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
      { id: "curves", label: "Curves", scenarios: [roadcurveloops, roadcurvetraffic, curvepace] },
      {
        id: "lanes",
        label: "One-way & lanes",
        scenarios: [roadoneway, roadstraightlanes, roadlanemerge, lanedrop, roadonewaylanes, lanechangegap, crosslanes],
      },
      {
        id: "crosses",
        label: "Crosses & junctions",
        scenarios: [
          roadcross, roadcross1lane, roadcross2lane, roadcross3lane,
          crossturns2lane, crossturns3lane, mixedcross, mixedtee, curvefeed, turngallery, turnglide, roadjunction, bigjunction,
        ],
      },
      {
        id: "turning",
        label: "Turning rules",
        scenarios: [turnlanes, turnfan, laneDiscipline, rightturncross, noleftturn],
      },
      {
        id: "signals",
        label: "Traffic signals",
        scenarios: [signaltwophase, signalroundrobin, signalturnlanes, signalbuslane1l, signalbuspriority, signalbuslane3l],
      },
      { id: "overtaking", label: "Overtaking", scenarios: [overtaketwolane, overtakeloop, overtakeabort] },
      { id: "priority", label: "Priority", scenarios: [roadpriority] },
      {
        id: "vehicles",
        label: "Vehicles",
        scenarios: [trucks, buslane, buslaneBoundary, buses, buscross, buscrossboth, busmedian, busarterial, busmedianboth, busonewaycross, busmegacross, busjunction, busshortcut],
      },
      {
        id: "routing",
        label: "Destinations & routing",
        scenarios: [cardestination, carroute],
      },
      {
        id: "parking",
        label: "Parking",
        scenarios: [parkvariants, parkingkerb, parkinglot, parkechelon, parkinglorry, busstops, buslayby],
      },
    ],
  },
  {
    id: "challenges",
    label: "Challenges",
    categories: [
      { id: "modes", label: "Game modes", scenarios: [objectives, timeattack, dispatch, faredistance, heldby, buildgap, landprices, taxyear, bankrupt, daily, networkmode] },
      // Not an isolated mechanic like the rest of the gallery — a full-size board
      // that exercises rail, roads and their crossings together. It lives here so
      // it gets the same validation every scenario does, and so it is playable
      // straight from the picker or via /play?board=demoworld.
      { id: "worlds", label: "Worlds", scenarios: [terrain, farmland, bridge, tunnel, clearing, townscape, industry, forestworld, lakevalley, lakevalleyOpen, demoworld, parkcity] },
    ],
  },
];

// Flat registry, in picker order. Kept for lookup-by-id and the validation test
// that iterates every scenario; derived from the tree so there's one source.
// Apply the junction derivation to every scenario in the tree (in place, so
// the picker tree and the flat registry agree).
for (const d of DOMAINS) {
  for (const c of d.categories) {
    c.scenarios = c.scenarios.map(deriveJunctions);
  }
}

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
