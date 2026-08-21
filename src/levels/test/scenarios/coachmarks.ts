import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// Coach-marks in isolation (src/coach.ts) — the teaching system's own
// scenario, per the project rule that every mechanic ships one.
//
// The smallest board on which "a hint appears on the thing, and doing the
// thing dismisses it" can be watched twice over: a waiting train whose fare
// pin the first mark points at, and a junction the second mark moves to once
// the train is sent. Flip the junction's arm and the coach falls silent.
//
// Only verbs the STAGE can perform are taught here: the build gesture lives in
// PlayView, so this board's hint list (COACH_BY_BOARD.coachmarks) is
// dispatch + switch. The build mark is taught where building exists — play
// /#/play?mode=tycoon&board=buildgap or lakevalley-open for the full set.
//
// The branch depot is deliberately a THIRD colour: if the junction's arm
// points south when the train is sent, the mismatch bounce is the switch
// lesson taught the hard way, not a soft-lock.
export const coachmarks: TestScenario = {
  id: "coachmarks",
  name: "Coach-marks",
  description:
    "The teaching system: a hint anchored to the waiting train, dismissed by " +
    "sending it; then one on the junction, dismissed by setting its arm.",
  modeId: "tycoon",
  size: { cols: 5, rows: 3 },
  level: {
    // The trunk: origin depot west, a T-junction mid-board, destination east.
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("straight", 1),
    // Trunk east-west, branch south (same rotation as lakevalley's 2,2).
    "2,1": expandKind("tjunction", 2),
    "3,1": expandKind("straight", 1),
    "4,1": expandKind("depot", 3),
    // The branch's own little station, one tile south of the junction.
    "2,2": expandKind("depot"),
  },
  trains: {
    t1: mkTrain("t1", 0, 1, "people", 1, "4,1"),
  },
  // Pinned so the lesson is deterministic: the train matches the east depot,
  // and the branch depot can never accidentally share its colour.
  colors: {
    depotColors: { "0,1": "blue", "4,1": "green", "2,2": "orange" },
    trainColors: { t1: "green" },
  },
};
