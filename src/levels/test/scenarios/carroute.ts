import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";
import { fromPairs } from "@/tiles/lanes";

// Route-inspection demo. A 7×7 road network with a mix of intersection types —
// 4-way crosses (+), T-junctions, and curved corners — plus a couple of small
// loops, so a routed car winds through several turns on its way across the board.
// There are exactly TWO map-edge exits on every side (8 in all), giving the BFS
// router plenty of distinct destinations to pick from — which is what makes the
// route overlay worth looking at.
//
// This is the test stage for the **car route debug overlay**: with debug on (it
// is on by default in /test), hover a car to preview its route and click to pin
// it — watch the coloured line bend through the crosses, T-junctions and curves
// as the car drives to its chosen edge. There is no rail — pure road.
const { Top, Right, Bottom, Left } = Position;
const road = (...pairs: [Position, Position][]) => ({ connections: [], road: fromPairs(pairs) });

// Tile builders (each call returns a fresh cell so no two grid keys share a ref).
const sH = () => road([Left, Right]); // straight, horizontal
const sV = () => road([Top, Bottom]); // straight, vertical
// 4-way cross: every straight + every turn, so the router has a full set of moves.
const x4 = () =>
  road([Left, Right], [Top, Bottom], [Left, Top], [Left, Bottom], [Right, Top], [Right, Bottom]);
// T-junctions, named by the arm they LACK (the through-road plus one branch).
const tNoTop = () => road([Left, Right], [Left, Bottom], [Right, Bottom]); // arms L,R,B
const tNoBottom = () => road([Left, Right], [Left, Top], [Right, Top]); // arms L,R,T
const tNoLeft = () => road([Top, Bottom], [Top, Right], [Bottom, Right]); // arms T,B,R
const tNoRight = () => road([Top, Bottom], [Top, Left], [Bottom, Left]); // arms T,B,L
// Curved corners (a single 90° bend, degree-2 — not a junction).
const cTL = () => road([Top, Left]);
const cBR = () => road([Bottom, Right]);

export const carroute: TestScenario = {
  id: "carroute",
  name: "Car route: inspect a winding route",
  description:
    "A 7×7 network of crosses, T-junctions and curves with two exits per side. With debug on, hover a car to preview its route and click to pin it — the line winds through several turns to its chosen edge.",
  level: {
    // Vertical avenue A (x=1): edge exits top & bottom; crosses at y=1,5.
    "1,0": sV(),
    "1,1": x4(),
    "1,2": tNoLeft(), // branches right into the top-left loop
    "1,3": tNoLeft(), // branches right into the central connector F
    "1,4": sV(),
    "1,5": x4(),
    "1,6": sV(),
    // Vertical avenue B (x=5): mirror of A.
    "5,0": sV(),
    "5,1": x4(),
    "5,2": sV(),
    "5,3": tNoRight(), // branches left into connector F
    "5,4": tNoRight(), // branches left into the bottom-right loop
    "5,5": x4(),
    "5,6": sV(),
    // Vertical connector C (x=3, y=1..5): T-junctions at its ends, cross in the middle.
    "3,1": tNoTop(),
    "3,2": sV(),
    "3,3": x4(),
    "3,4": sV(),
    "3,5": tNoBottom(),
    // Horizontal avenue D (y=1): edge exits left & right.
    "0,1": sH(),
    "2,1": tNoTop(), // branches down into the top-left loop
    "4,1": sH(),
    "6,1": sH(),
    // Horizontal avenue E (y=5): mirror of D.
    "0,5": sH(),
    "4,5": tNoBottom(), // branches up into the bottom-right loop
    "2,5": sH(),
    "6,5": sH(),
    // Horizontal connector F (y=3, x=1..5).
    "2,3": sH(),
    "4,3": sH(),
    // Top-left loop: D ↘ curve ↙ back to A — an alternate winding path.
    "2,2": cTL(),
    // Bottom-right loop: E ↖ curve ↗ back to B.
    "4,4": cBR(),
  },
  trains: {},
  size: { cols: 7, rows: 7 },
  // Pace spawns so a few cars share the network without packing it (the test
  // world's Cars slider can still raise/lower density live).
  traffic: { spawnInterval: 1.5, maxCars: 8 },
};
