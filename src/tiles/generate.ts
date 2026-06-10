import { Position } from "@/types";
import { Level, Port } from "@/tiles/model";
import { Connectable, deriveConnections } from "@/tiles/autotile";
import { neighborCoord } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { makeRng } from "@/utils/globalHelpers";
import { TrainRoute, validateLevel } from "@/tiles/validate";

export interface GenerateOptions {
  width: number;
  height: number;
  depotPairs: number;
}

export interface GeneratedLevel {
  level: Level;
  depots: string[]; // depot coord ids, paired (0,1),(2,3),...
  routes: TrainRoute[]; // from/to per pair
}

const EDGES: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Generate a solvable random level: a rectangular track loop (guaranteed
// connected) with colour-matched depot spurs hanging off it. Deterministic for a
// given seed; gated by validateLevel with a retry safety net.
export function generateLevel(
  seed: number,
  opts: GenerateOptions
): GeneratedLevel {
  const width = Math.max(4, opts.width);
  const height = Math.max(4, opts.height);

  for (let attempt = 0; attempt < 50; attempt++) {
    const result = build(seed + attempt, width, height, opts.depotPairs);
    if (result && validateLevel(result.level, result.routes).ok) return result;
  }
  // Fallback: the smallest always-valid level (a 2-depot line) so callers never
  // get null. (In practice the loop above succeeds on the first attempt.)
  return tinyFallback();
}

function build(
  seed: number,
  width: number,
  height: number,
  depotPairs: number
): GeneratedLevel | null {
  const rand = makeRng(seed);

  // Loop rectangle, inset by 1 so depots fit in the margin around it.
  const rx0 = 1;
  const ry0 = 1;
  const rx1 = width - 2;
  const ry1 = height - 2;
  if (rx1 - rx0 < 1 || ry1 - ry0 < 1) return null;

  // Perimeter coords of the rectangle.
  const perim: { x: number; y: number }[] = [];
  const perimSet = new Set<string>();
  const add = (x: number, y: number) => {
    const id = `${x},${y}`;
    if (!perimSet.has(id)) {
      perimSet.add(id);
      perim.push({ x, y });
    }
  };
  for (let x = rx0; x <= rx1; x++) {
    add(x, ry0);
    add(x, ry1);
  }
  for (let y = ry0; y <= ry1; y++) {
    add(rx0, y);
    add(rx1, y);
  }

  const inGrid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height;

  // Connectable edges per cell. Ring cells link to orthogonally-adjacent ring
  // cells; depot spurs are added below.
  const connectable: Record<string, Connectable> = {};
  for (const c of perim) {
    const id = getCoordinatesId(c);
    connectable[id] = {};
    for (const e of EDGES) {
      const n = neighborCoord(c, e)!;
      if (perimSet.has(getCoordinatesId(n))) connectable[id][e] = true;
    }
  }

  // Choose ring cells to host depots: each needs a free outward (non-ring,
  // in-grid, unused) neighbour cell.
  const wanted = Math.max(1, depotPairs) * 2;
  const used = new Set<string>();
  const depots: string[] = [];
  const depotCells: { id: string; facing: Port }[] = [];

  for (const host of shuffle(perim, rand)) {
    if (depots.length >= wanted) break;
    const hostId = getCoordinatesId(host);
    for (const e of shuffle(EDGES, rand)) {
      const n = neighborCoord(host, e)!;
      const nId = getCoordinatesId(n);
      if (
        inGrid(n.x, n.y) &&
        !perimSet.has(nId) &&
        !used.has(nId) &&
        !connectable[hostId][e]
      ) {
        // depot at n faces back toward the host (opposite of e from host = the
        // depot's facing toward host is `oppositePort(e)`... but the depot sits
        // at n and faces the host which is in direction -e, i.e. opposite e).
        const facing = oppositeEdge(e);
        used.add(nId);
        depots.push(nId);
        depotCells.push({ id: nId, facing });
        // The host ring cell gains a connectable edge toward the depot.
        connectable[hostId][e] = true;
        break;
      }
    }
  }

  if (depots.length < 2) return null; // need at least one pair

  // Build the level: ring cells (track) + depot cells.
  const level: Level = {};
  for (const c of perim) {
    const id = getCoordinatesId(c);
    level[id] = deriveConnections({ paint: "track" }, connectable[id]);
  }
  for (const d of depotCells) {
    level[d.id] = deriveConnections({ paint: "depot", facing: d.facing }, {});
  }

  // Pair depots up; drop an odd leftover.
  const paired = depots.slice(0, depots.length - (depots.length % 2));
  const routes: TrainRoute[] = [];
  for (let i = 0; i + 1 < paired.length; i += 2) {
    routes.push({ from: paired[i], to: paired[i + 1] });
  }

  return { level, depots: paired, routes };
}

function oppositeEdge(e: Port): Port {
  switch (e) {
    case Position.Top:
      return Position.Bottom;
    case Position.Bottom:
      return Position.Top;
    case Position.Left:
      return Position.Right;
    case Position.Right:
      return Position.Left;
    default:
      return Position.Center;
  }
}

function tinyFallback(): GeneratedLevel {
  const level: Level = {
    "0,0": { connections: [[Position.Right, Position.Center]], role: "depot" },
    "1,0": { connections: [[Position.Left, Position.Right]] },
    "2,0": { connections: [[Position.Left, Position.Center]], role: "depot" },
  };
  return {
    level,
    depots: ["0,0", "2,0"],
    routes: [{ from: "0,0", to: "2,0" }],
  };
}
