import { TestScenario } from "@/levels/test/scenario";
import { dailyBoardFor, dailyModeFor } from "@/modes/daily";

// A pinned calendar date, so the board, the colours and the ruleset are all
// deterministic across runs and CI — the real Daily is exactly this scenario
// with todayString() as the date. Pinning the DATE (not a raw seed) means the
// scenario exercises the whole date→seed→board→colours pipeline the mode runs.
const DATE = "2026-06-15";
const board = dailyBoardFor(DATE);

export const daily: TestScenario = {
  id: "daily",
  name: "Daily Challenge (pinned date)",
  description:
    "The real Daily ruleset on the 2026-06-15 board: date-seeded procgen, pinned " +
    "colours, deliver all three trains — timer and stars live on the stage strip.",
  level: board.level,
  trains: board.trainsDef,
  // The mode's own deterministic assignment, pinned here because createGame
  // takes the view's colours and ignores the ones setup() returns.
  colors: board.colors,
  mode: dailyModeFor(DATE),
};
