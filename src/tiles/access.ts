import { Position } from "@/types";
import type { Level, Port } from "@/tiles/model";
import { parseCoordId } from "@/tiles/model";
import { makeRng } from "@/utils/globalHelpers";
import { GROUND_UNITS } from "@/tiles/terrain";

// LOCAL ACCESS — the last block, and why nobody has to draw it.
//
// A plot is reachable when there is a street within `ROAD_ACCESS_TILES` of it
// (tiles/cities.ts). That rule has always implied a link between the two — the
// driveway, the footpath, the bit of pavement outside the door — and the model
// has always used it. What it never did was SHOW it, so a town read as houses
// marooned beside a road they had no visible relationship to.
//
// The design decision this file embodies: **the last block is derived, never
// drawn by the player.**
//
//  · Making the player lay every driveway is busywork with no decision in it.
//    The interesting decision is the arterial network — where the through-road
//    runs, whether the town gets a station.
//  · Auto-generating real road TILES inside a town (the Transport Fever move)
//    fights the player instead: generated lanes land in the level data, become
//    editable and bulldozable, and have to be re-generated every time the town
//    grows. That is a lot of machinery for something nobody chooses.
//  · So the link is a DERIVATION, exactly like the walking radius and the
//    catchment: no level data, nothing to keep in sync, and it re-derives the
//    moment the player lays or bulldozes a street.
//
// The same derivation is the pedestrian graph when walking people arrive: plot
// → access path → the footway along the street. See the citizens design doc
// §9.1.

// How far a plot looks for its street. Matches `ROAD_ACCESS_TILES` in
// tiles/cities.ts — the two are the same rule seen from opposite ends, and a
// mismatch would draw a path to a road the model does not think is reachable.
const ACCESS_REACH = 1;

function hasRoad(level: Level, id: string): boolean {
  const cell = level[id];
  return !!cell?.road && cell.road.length > 0;
}

// Only ground people are actually on: a tile carrying road or rail is the
// infrastructure itself and needs no path drawn across it.
function isAddress(level: Level, id: string): boolean {
  const cell = level[id];
  if (!cell) return false;
  if (cell.terrain !== "urban" && cell.terrain !== "industry") return false;
  if (cell.connections.length > 0) return false;
  if (cell.road && cell.road.length > 0) return false;
  return true;
}

const SIDES: [Port, number, number][] = [
  [Position.Top, 0, -1],
  [Position.Right, 1, 0],
  [Position.Bottom, 0, 1],
  [Position.Left, -1, 0],
];

/**
 * Which way ONE plot's local access runs: the edge its path leaves by, toward
 * the street that serves it, or null when nothing does.
 *
 * O(1) — it looks only at this tile's own neighbours. The renderer asks this
 * per tile on every frame, so a whole-level scan per cell would be quadratic in
 * the board.
 *
 * Sides before diagonals (a path leaves by an edge, not a corner) and then in a
 * fixed port order, so a plot with streets on two sides always picks the same
 * one and the board looks identical on every reload.
 */
export function accessPortOf(level: Level, id: string): Port | null {
  if (!isAddress(level, id)) return null;
  const { x, y } = parseCoordId(id);
  // A street straight across the boundary is the frontage: take it.
  for (const [port, dx, dy] of SIDES) {
    if (hasRoad(level, `${x + dx},${y + dy}`)) return port;
  }
  // Otherwise a street on the diagonal still serves the plot (the reach is a
  // square ring); the path leaves by whichever edge points at it.
  if (ACCESS_REACH >= 1) {
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      if (hasRoad(level, `${x + dx},${y + dy}`)) {
        return dx < 0 ? Position.Left : Position.Right;
      }
    }
  }
  return null;
}

/**
 * Every plot's local access on the board: tile id → the edge its path leaves
 * by. The whole-board view of `accessPortOf`, for tests and for the pedestrian
 * graph when walking people arrive.
 */
export function localAccessOf(level: Level): Record<string, Port> {
  const out: Record<string, Port> = {};
  for (const id of Object.keys(level)) {
    const port = accessPortOf(level, id);
    if (port !== null) out[id] = port;
  }
  return out;
}

// --- the drawing -------------------------------------------------------------

// A driveway is a WEDGE, not a stick. It starts narrow at the frontage and
// flares out where it meets the kerb, which is both what a real crossover looks
// like from above and what stops a row of them reading as planks dropped on the
// grass — the first attempt was a constant-width quad and that is exactly how it
// looked.
const PATH_NEAR = 7; // width at the plot end
const PATH_FAR = 20; // width where it meets the street

// Hard-standing: LIGHTER and less saturated than the ground it crosses, so it
// reads as gravel or concrete rather than as an object lying on the ground.
// Darker was tried first and every path read as a timber plank.
// Two tones, because the town's warm tan and the works' cool concrete are
// deliberately different (`GROUND` in tiles/terrain.ts) and one path colour
// cannot sit on both.
const PATH_FILL: Record<"urban" | "industry", string> = {
  urban: "hsl(36 14% 76%)",
  industry: "hsl(212 5% 67%)",
};

/**
 * A short apron from the middle of the plot out to the edge that meets the
 * street, in the tile's own 0..GROUND_UNITS space. Drawn on the GROUND layer,
 * so the road art and every building sit on top of it and it reads as the
 * ground between them rather than as another road.
 *
 * Seeded per tile so the flare wanders a little: a row of identical stubs reads
 * as a diagram, and the point is that this looks like somewhere people come and
 * go from.
 */
export function accessPathSvg(
  port: Port,
  coordId: string,
  kind: "urban" | "industry" = "urban"
): string {
  const u = GROUND_UNITS;
  const mid = u / 2;
  const { x, y } = parseCoordId(coordId);
  const rng = makeRng((0x9e37 ^ (x * 374761393) ^ (y * 668265263)) >>> 0);
  // Where it meets the kerb, wandered off dead-centre.
  const drift = (rng() - 0.5) * u * 0.16;
  const near = PATH_NEAR / 2;
  const far = PATH_FAR / 2;
  // Start a little short of the middle, and overshoot the edge so the tile seam
  // never shows as a step in the path.
  const OVER = 2;

  // Corner points as (along, across): `along` runs from the plot end out to the
  // edge, `across` is the half-width at each end. One quad, mapped per port.
  const pts: [number, number][] = [
    [mid, -near],
    [mid, near],
    [-OVER, drift + far],
    [-OVER, drift - far],
  ];
  const map = (along: number, across: number): [number, number] => {
    if (port === Position.Top) return [mid + across, along];
    if (port === Position.Bottom) return [mid + across, u - along];
    if (port === Position.Left) return [along, mid + across];
    return [u - along, mid + across];
  };
  const d =
    pts
      .map(([a, c], i) => {
        const [px, py] = map(a, c);
        return `${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`;
      })
      .join(" ") + " Z";
  return `<path d="${d}" fill="${PATH_FILL[kind]}" />`;
}
