import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// Route-inspection demo. A 7×7 road network designed so a car can NEVER cross the
// board in a straight line: the four corner intersections and the centre are
// **turn-only** (no straight-through movement), so every avenue is broken where it
// meets them. To get from one edge to another a car must weave — down a column,
// across a row, up again — producing S/Z shaped routes with several bends rather
// than a trivial straight or single-L. T-junctions on the central plus stay
// "normal" (they allow their straight-through) so the network stays well connected
// and offers alternate winding paths.
//
// There are exactly TWO map-edge exits on every side (8 in all), giving the BFS
// router plenty of distinct destinations. This is the test stage for the **car
// route debug overlay**: with debug on (default in /test), hover a car to preview
// its route and click to pin it — watch the line snake through the turn-only
// crosses on its way to the chosen edge. There is no rail — pure road.
const { Top, Right, Bottom, Left } = Position;
const road = (...pairs: [Position, Position][]) => ({ connections: [], road: fromPairs(pairs) });

// Tile builders (each call returns a fresh cell so no two grid keys share a ref).
const sH = () => road([Left, Right]); // straight, horizontal
const sV = () => road([Top, Bottom]); // straight, vertical
// Turn-only 4-way: all four turns but NO straight-through, so a car must change
// axis here — this is what forbids a straight crossing of the board.
const x4turn = () => road([Left, Top], [Left, Bottom], [Right, Top], [Right, Bottom]);
// Normal T-junctions (through-road + one branch), named by the arm they LACK.
const tNoTop = () => road([Left, Right], [Left, Bottom], [Right, Bottom]); // arms L,R,B
const tNoBottom = () => road([Left, Right], [Left, Top], [Right, Top]); // arms L,R,T
const tNoLeft = () => road([Top, Bottom], [Top, Right], [Bottom, Right]); // arms T,B,R
const tNoRight = () => road([Top, Bottom], [Top, Left], [Bottom, Left]); // arms T,B,L

export const carroute: TestScenario = {
  id: "carroute",
  name: "Car route: inspect a winding route",
  description:
    "A 7×7 network whose corner and centre crossings are turn-only, so a car can't drive straight across — it weaves into S/Z routes. With debug on, hover a car to preview its route and click to pin it.",
  level: {
    // Vertical avenue A (x=1): top & bottom edge exits; turn-only corners at y=1,5.
    "1,0": sV(),
    "1,1": x4turn(),
    "1,2": sV(),
    "1,3": tNoLeft(), // central row branches in here (normal T)
    "1,4": sV(),
    "1,5": x4turn(),
    "1,6": sV(),
    // Vertical avenue B (x=5): mirror of A.
    "5,0": sV(),
    "5,1": x4turn(),
    "5,2": sV(),
    "5,3": tNoRight(),
    "5,4": sV(),
    "5,5": x4turn(),
    "5,6": sV(),
    // Horizontal avenue D (y=1): left & right edge exits.
    "0,1": sH(),
    "2,1": sH(),
    "3,1": tNoTop(), // central column branches down (normal T)
    "4,1": sH(),
    "6,1": sH(),
    // Horizontal avenue E (y=5): mirror of D.
    "0,5": sH(),
    "2,5": sH(),
    "3,5": tNoBottom(),
    "4,5": sH(),
    "6,5": sH(),
    // Central plus (internal, no edge openings): a turn-only centre that links the
    // four avenues with extra winding paths but never offers a straight shortcut.
    "3,2": sV(),
    "3,3": x4turn(),
    "3,4": sV(),
    "2,3": sH(),
    "4,3": sH(),
  },
  trains: {},
  size: { cols: 7, rows: 7 },
  // Pace spawns so a few cars share the network without packing it (the test
  // world's Cars slider can still raise/lower density live).
  traffic: { spawnInterval: 1.5, maxCars: 8 },
};
