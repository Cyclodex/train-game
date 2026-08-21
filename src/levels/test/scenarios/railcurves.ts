import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// A serpentine of six curves — every rotation, and every kind of seam a curve
// can have: curve↔curve, curve↔straight, curve↔depot. This is the board for the
// RAIL CURVE GEOMETRY itself: the two rails must hold a constant gauge all the
// way round each bend (they used to pinch to half-gauge at the apex, because
// only the curve's ENDPOINTS were offset and the Bézier control point was left
// at the tile centre), and they must line up with the neighbour's rails at every
// tile edge (they used to jog ~5px sideways, since the endpoint offset was taken
// perpendicular to the CHORD rather than to the travel direction).
//
// Curve rotations: 0 = Top+Right (└), 1 = Right+Bottom (┌), 2 = Bottom+Left (┐),
// 3 = Left+Top (┘). Depot 1 opens Right, 3 opens Left.
export const railcurves: TestScenario = {
  id: "railcurves",
  name: "Curve geometry",
  description:
    "Six curves in a row: constant rail gauge round every bend, rails flush at every seam.",
  level: {
    "0,1": expandKind("depot", 1),
    "1,1": expandKind("curve", 3), // ┘ up out of the depot
    "1,0": expandKind("curve", 1), // ┌ and away to the right
    "2,0": expandKind("straight", 1), // a straight seam on both sides
    "3,0": expandKind("curve", 2), // ┐ back down
    "3,1": expandKind("curve", 0), // └ and on to the right — a curve↔curve seam
    "4,1": expandKind("straight", 1),
    "5,1": expandKind("curve", 3), // ┘ up again
    "5,0": expandKind("curve", 1), // ┌ into the far depot
    "6,0": expandKind("depot", 3),
  },
  trains: {
    train1: mkTrain("train1", 0, 1, "people", 2, "6,0"),
  },
};
