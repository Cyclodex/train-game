import { Position } from "@/types";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

const { Top, Right, Bottom, Left } = Position;

// "Held by …" — the answer to *why is my train not moving* (Tycoon).
//
// Our interlocking reserves the whole route to the next signal, so the train you
// just dispatched can refuse to leave its platform because of a stretch of track
// it is nowhere near. Train Valley never does this — there, trains simply go and
// the player is the safety system — so a player arriving from that game reads the
// stall as a broken button. The fix is not to stop holding the train, it is to
// SAY SO: a held pin names its blocker and rings itself in that train's livery.
//
// The board is `cross`'s geometry (two lanes meeting at a pure crossing, turns
// disabled so nobody can steer and the only variable is who got there first),
// re-run under Tycoon so both trains carry a fare pin. Send `east` first and then
// `south` immediately: east owns the crossing all the way to its depot, so south
// noses out of its shed and stops with a green-ringed "‖ east" over it — and
// starts rolling by itself the moment east parks and the block clears. Two trains
// is the minimum that means anything here; one train is never held by anyone.
export const heldby: TestScenario = {
  id: "heldby",
  name: "Held by — why a train waits",
  description:
    "Send both trains at once: the second one's pin names the train whose reserved block is holding it.",
  modeId: "tycoon",
  level: {
    // vertical lane (col 1)
    "1,0": expandKind("depot", 2), // opens Bottom — south's shed
    "1,2": expandKind("depot", 0), // opens Top — south's destination
    // horizontal lane (row 1)
    "0,1": expandKind("depot", 1), // opens Right — east's shed
    "2,1": expandKind("depot", 3), // opens Left — east's destination
    // the crossing — straight-throughs only, so neither train can turn
    "1,1": expandKind("cross", 0, {
      disable: [
        [Top, Right],
        [Right, Bottom],
        [Bottom, Left],
        [Left, Top],
      ],
    }),
  },
  trains: {
    // Named for the direction each one runs, because the held pin prints the
    // blocker's id verbatim — "held by east" has to read as a sentence.
    east: mkTrain("east", 0, 1, "people", 2, "2,1"),
    south: mkTrain("south", 1, 0, "people", 2, "1,2"),
  },
  // Pinned so both trains park on a real match: a mismatched arrival bounces and
  // keeps its fare decaying, which would leave a second pin shouting on the board
  // while the one this scenario is about is trying to make its point.
  colors: {
    depotColors: {
      "0,1": "blue", // east's start — deliberately NOT its own colour, or it parks at home
      "2,1": "green", // east's destination
      "1,0": "blue", // south's start
      "1,2": "red", // south's destination
    },
    trainColors: { east: "green", south: "red" },
  },
};
