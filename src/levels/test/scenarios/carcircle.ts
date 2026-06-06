import { Position } from "@/types";
import { TestScenario } from "@/levels/test/scenario";

// Many cars circulating a rectangular road loop with proper curve corners.
//
// A 3×3 ring of road tiles: curve tiles at all four corners, straights on the
// sides. Four feed stubs (one stub tile per side) join the loop at T-junction
// tiles — a car entering the stub is injected into the clockwise flow and then
// circulates the loop indefinitely (it never reaches an open end). maxCars caps
// the density: once the loop is full, no new cars spawn until one eventually
// despawns (which doesn't happen on a closed loop, so the circuit fills once and
// stays full — a steady carousel).
//
// Tests: curve-gap spacing under sustained load; cars visible through all four
// 90° bends simultaneously.
const road = (...ports: [Position, Position][]) => ({ connections: [], road: ports });

export const carcircle: TestScenario = {
  id: "carcircle",
  name: "Cars circling (loop)",
  description:
    "Cars enter from four feed roads and circulate a rectangular loop with curve corners — a steady carousel that shows gap spacing through every bend.",
  level: {
    // --- Clockwise loop ring (inner 3×3, offset to row/col 1–3) ---
    // NW corner: northbound (left col) turns east (top row)
    "1,1": road([Position.Bottom, Position.Right]),
    // Top: T-junction — loop traffic flows Left→Right; north feed joins going east
    "2,1": road([Position.Left, Position.Right], [Position.Top, Position.Right]),
    // NE corner: eastbound turns south
    "3,1": road([Position.Left, Position.Bottom]),
    // Left: T-junction — loop traffic flows Bottom→Top; west feed joins going north
    "1,2": road([Position.Bottom, Position.Top], [Position.Left, Position.Top]),
    // Right: T-junction — loop traffic flows Top→Bottom; east feed joins going south
    "3,2": road([Position.Top, Position.Bottom], [Position.Right, Position.Bottom]),
    // SW corner: westbound turns north
    "1,3": road([Position.Right, Position.Top]),
    // Bottom: T-junction — loop traffic flows Right→Left; south feed joins going west
    "2,3": road([Position.Right, Position.Left], [Position.Bottom, Position.Left]),
    // SE corner: southbound turns west
    "3,3": road([Position.Top, Position.Left]),

    // --- Feed stubs (one tile each, open end faces map edge) ---
    "2,0": road([Position.Top, Position.Bottom]), // north feed → joins top T-junction
    "4,2": road([Position.Left, Position.Right]), // east feed  → joins right T-junction
    "2,4": road([Position.Top, Position.Bottom]), // south feed → joins bottom T-junction
    "0,2": road([Position.Left, Position.Right]), // west feed  → joins left T-junction
  },
  trains: {},
  size: { cols: 5, rows: 5 },
  // Moderate spawn so cars fill the loop from all four feeds simultaneously.
  // Once the loop is full (≈12 cars) it stays full — a perpetual carousel.
  traffic: {
    spawnInterval: 0.7,
    maxCars: 12,
    spawnEntries: [
      { coord: { x: 2, y: 0 }, entryPort: Position.Top },    // north feed
      { coord: { x: 4, y: 2 }, entryPort: Position.Right },  // east feed
      { coord: { x: 2, y: 4 }, entryPort: Position.Bottom }, // south feed
      { coord: { x: 0, y: 2 }, entryPort: Position.Left },   // west feed
    ],
  },
};
