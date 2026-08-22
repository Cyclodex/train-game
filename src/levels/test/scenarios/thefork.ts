import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// THE FORK — campaign level 4, and the first level authored as a TIMETABLE
// rather than as a pile of trains present at t=0.
//
// Design: `docs/superpowers/specs/2026-07-27-campaign-and-levels-design.md`
// Part B level 2 ("One line out of town, two towns to serve. The switch
// decides."), re-cut against the pacing analysis in
// `…2026-08-22-level-pacing-design.md` §5.
//
// WHAT THE LEVEL IS. One shed in the west, one junction in the middle, two
// towns — green to the east, orange to the south. Twelve trains come through
// the shed over two minutes, alternating which town they are for, and the
// junction's arm is the only thing that decides where each one goes. That is
// the whole level: one question, asked twelve times, with the answer changing
// every time.
//
// WHY A TIMETABLE. Under the old structure every train stood in its shed from
// t=0, so a level lasted `longest haul × 2s/tile` and nothing else — 35
// seconds on a board this size, with the pressure at its maximum in the first
// second and falling from there. Trains arriving over time is what every game
// in the genre does (Train Valley's spawn timer is its per-level difficulty
// dial), and it is what lets this 6x6 board run for over two minutes — nearly
// four times lakevalley-open, on a smaller map.
//
// THE SHED IS THE METER. Arrivals are 10s apart and a delivery takes ~10-14s,
// so the platform is only just free in time: a player who sends each train as
// it appears keeps the timetable running, and one who does not backs it up.
// Dawdle and the next arrival waits its turn in the shed (one train per shed —
// see game.ts), the level stretches, and the fares already on the board keep
// falling. Nobody is punished with a fail state; they are simply paid less and
// they lose the clock.
//
// THE GAP. The southern leg stops two tiles short, so the level opens with the
// build verb before it asks its own question — $2,000 of the $6,000 budget.
// Deliberately small: building is not the puzzle here, it is the price of
// admission. `allowIncomplete` covers the authored gap and the south-bound
// trains whose route does not exist until the player lays it.
//
// NO CALENDAR. Per the arc, the second clock arrives later; here the fare
// decay is the only clock, and the only real cost of a wrong arm is a train
// bouncing off the wrong town with its fare still burning.

// Depot rotations: 0 opens Top, 1 Right, 2 Bottom, 3 Left.
// The timetable, and the two numbers the level is tuned on. MEASURED, not
// chosen. At a 16-second spacing the SCHEDULE is the bottleneck and the level
// cannot tell a prompt player from a slow one — measured 127s against 137s,
// ten seconds apart after a whole level of dawdling. At ten seconds the SHED
// is the bottleneck, which is the point, and the same comparison is 125s
// against 183s.
export const THEFORK_SPACING_SEC = 10;
// Twelve trains, six per town. Enough that the same platform is used four
// times over — the case that was impossible until a delivered train started
// leaving the board.
export const THEFORK_TRAIN_COUNT = 12;

// One train every THEFORK_SPACING_SEC, alternating destination. The first is
// present at t=0 (spawnAtSec 0 means "not scheduled"), the rest arrive.
export function forkTrainIds(): { id: string; east: boolean }[] {
  return Array.from({ length: THEFORK_TRAIN_COUNT }, (_, i) => {
    const east = i % 2 === 0;
    return { id: `${east ? "e" : "s"}${Math.floor(i / 2) + 1}`, east };
  });
}

function forkTrains() {
  const trains: Record<string, ReturnType<typeof mkTrain>> = {};
  forkTrainIds().forEach(({ id, east }, i) => {
    trains[id] = mkTrain(
      id,
      0,
      2,
      east ? "people" : "fraight",
      1,
      east ? "5,2" : "3,5",
      i === 0 ? undefined : i * THEFORK_SPACING_SEC
    );
  });
  return trains;
}

export const thefork: TestScenario = {
  id: "thefork",
  name: "The Fork",
  description:
    "Twelve trains through one shed over two minutes, alternating between two towns. " +
    "The junction's arm is the only thing that decides where each one goes.",
  modeId: "tycoon",
  allowIncomplete: true,
  size: { cols: 6, rows: 6 },
  level: {
    // The shed and the trunk east.
    "0,2": expandKind("depot", 1),
    "1,2": expandKind("straight", 1),
    "2,2": expandKind("straight", 1),
    // The fork itself: trunk east-west, branch south (the same rotation
    // lakevalley's 2,2 carries).
    "3,2": expandKind("tjunction", 2),
    // East leg, complete: the green town.
    "4,2": expandKind("straight", 1),
    "5,2": expandKind("depot", 3),
    // South leg: 3,3 and 3,4 are THE GAP — two tiles of grass the player buys.
    // The orange town waits at the bottom, its northern seam opening onto
    // nothing until then.
    "3,5": expandKind("depot", 0),
  },
  trains: forkTrains(),
  // Pinned, because the whole level is "is the arm pointing where THIS train is
  // going": the two towns must be reliably different colours, and the shed must
  // be a third, or a train would count as delivered without leaving home.
  colors: {
    depotColors: { "0,2": "blue", "5,2": "green", "3,5": "orange" },
    // Derived from the roster, so the train count is a single knob: adding two
    // more trains must not mean remembering to colour them, or the new pair
    // would have no matching town and bounce for ever.
    trainColors: Object.fromEntries(
      forkTrainIds().map(({ id, east }) => [id, east ? "green" : "orange"])
    ),
  },
};
