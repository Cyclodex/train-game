import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { type Lane, nWayLanes } from "@/tiles/lanes";

// A T-junction where a 2-lane main road meets a 1-lane side spur, built to show
// the TURN GLIDE: a car turning from the wide main road onto the narrow spur
// eases laterally from its approach lane to the spur's single lane ACROSS the
// junction tile, instead of holding the wide-road offset and snapping sideways at
// the boundary (which used to leave the car — and the debug arrow — pointing at a
// lane that doesn't exist). Enable Debug: the cyan lane arrows now end exactly on
// the lane the car drives to. A car merging the other way (spur → main) fans out
// to a real main-road lane the same way.
const T = Position.Top;
const B = Position.Bottom;
const L = Position.Left;
const R = Position.Right;

// A 2-lane (each direction) east–west arm of the main road.
const ewArm = () => ({ connections: [] as [], road: nWayLanes(L, R, 2) });
// The 1-lane (each direction) side spur.
const spur = () => ({ connections: [] as [], road: nWayLanes(T, B, 1) });

// The T centre: 2-lane main road L↔R plus a 1-lane spur down to B. The kerb lane
// of each main-road direction may turn onto the spur (right turn for eastbound
// L→B, left turn for westbound R→B); the inner lane stays straight. The spur (B)
// feeds both main-road directions.
function centre(): { connections: []; road: Lane[] } {
  return {
    connections: [],
    road: [
      { from: L, to: [R, B], index: 0 }, // kerb: straight + turn onto the spur
      { from: L, to: [R], index: 1 }, // inner: straight only
      { from: R, to: [L, B], index: 0 }, // kerb: straight + turn onto the spur
      { from: R, to: [L], index: 1 }, // inner: straight only
      { from: B, to: [L, R], index: 0 }, // spur joins the main road both ways
    ],
  };
}

export const turnglide: TestScenario = {
  id: "turnglide",
  name: "Turn glide: 2-lane road onto a 1-lane spur",
  description:
    "A T-junction where a 2-lane main road meets a 1-lane spur. A car turning off " +
    "the main road eases to the spur's single lane across the junction instead of " +
    "snapping at the boundary, and a car joining from the spur fans out to a real " +
    "main-road lane. Enable Debug: the cyan lane arrows end exactly where cars drive.",
  level: {
    "0,1": ewArm(),
    "1,1": centre(),
    "2,1": ewArm(),
    "1,2": spur(),
  },
  trains: {},
  size: { cols: 3, rows: 3 },
  traffic: { mix: { car: 1 }, spawnInterval: 0.8, maxCars: 10 },
};
