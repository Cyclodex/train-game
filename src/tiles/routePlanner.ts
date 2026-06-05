import { Coordinates, Position } from "@/types";
import { Port, parseCoordId } from "@/tiles/model";
import { neighborCoord, oppositePort } from "@/sim/topology";

// A pure, headless router for the editor's multi-tile route builder. Given an
// open end (`from`: a tile + the edge the track grows out of) and a target
// (`to`: a tile + the edge the track will continue out of), it returns the
// per-cell connections to lay along the shortest, turn-minimising path — or
// `null` if no route fits. `passable` gates which cells may be entered, so a
// future "blocked tiles" feature is just that predicate returning false.

export type OpenEnd = { id: string; edge: Port };
export type RouteStep = { id: string; a: Port; b: Port };

export interface RouteOpts {
  width: number;
  height: number;
  passable?: (c: Coordinates) => boolean;
}

const DIRS: Port[] = [Position.Top, Position.Right, Position.Bottom, Position.Left];
const idOf = (c: Coordinates) => `${c.x},${c.y}`;

// Cost weights: length dominates (each move), turns break ties between equal-
// length routes so previews bend cleanly with as few curves as possible.
const MOVE = 1000;
const TURN = 1;

export function planRoute(
  from: OpenEnd,
  to: OpenEnd,
  o: RouteOpts
): RouteStep[] | null {
  const passable = o.passable ?? (() => true);
  const ok = (c: Coordinates) =>
    c.x >= 0 && c.y >= 0 && c.x < o.width && c.y < o.height && passable(c);

  // Degenerate: both ends in the same tile -> one intra-tile connection.
  if (from.id === to.id) {
    if (from.edge === to.edge) return null;
    return [{ id: from.id, a: from.edge, b: to.edge }];
  }

  const firstDir = from.edge;
  const lastDir = to.edge;
  if (firstDir === Position.Center || lastDir === Position.Center) return null;

  const A = parseCoordId(from.id);
  const T = parseCoordId(to.id);
  if (!ok(A) || !ok(T)) return null;

  // The route is forced to leave the anchor through `firstDir`.
  const c1 = neighborCoord(A, firstDir);
  if (!c1 || !ok(c1)) return null;

  // Dijkstra over (cell, enterDir). State key includes the travel direction used
  // to enter the cell so a turn can be priced. Start: we have just stepped from
  // A into c1 travelling firstDir.
  type Key = string;
  const skey = (c: Coordinates, d: Port): Key => `${c.x},${c.y},${d}`;
  const start = skey(c1, firstDir);
  const dist = new Map<Key, number>();
  const prev = new Map<Key, Key | null>();
  const cellOf = new Map<Key, Coordinates>();
  const dirOf = new Map<Key, Port>();
  dist.set(start, 0);
  prev.set(start, null);
  cellOf.set(start, c1);
  dirOf.set(start, firstDir);
  const open = new Set<Key>([start]);

  while (open.size) {
    let bk: Key | null = null;
    let bd = Infinity;
    for (const k of open) {
      const d = dist.get(k)!;
      if (d < bd) {
        bd = d;
        bk = k;
      }
    }
    open.delete(bk!);
    const c = cellOf.get(bk!)!;
    const dir = dirOf.get(bk!)!;
    if (c.x === T.x && c.y === T.y) continue; // terminal cell, never expand past T
    for (const nd of DIRS) {
      const nc = neighborCoord(c, nd);
      if (!nc || !ok(nc)) continue;
      if (nc.x === A.x && nc.y === A.y) continue; // don't loop back through the anchor
      const k = skey(nc, nd);
      const cost = bd + MOVE + (nd !== dir ? TURN : 0);
      if (cost < (dist.get(k) ?? Infinity)) {
        dist.set(k, cost);
        prev.set(k, bk!);
        cellOf.set(k, nc);
        dirOf.set(k, nd);
        open.add(k);
      }
    }
  }

  // Cheapest arrival at T, including the final corner (enter dir vs the requested
  // continue dir). Skip arrivals from the continue side (they'd be degenerate).
  let best: Key | null = null;
  let bestCost = Infinity;
  for (const nd of DIRS) {
    if (nd === oppositePort(lastDir)) continue;
    const k = skey(T, nd);
    if (!dist.has(k)) continue;
    const cost = dist.get(k)! + (nd !== lastDir ? TURN : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = k;
    }
  }
  if (!best) return null;

  // Reconstruct cell + enterDir from c1 .. T.
  const chain: { c: Coordinates; enter: Port }[] = [];
  let k: Key | null = best;
  while (k) {
    chain.push({ c: cellOf.get(k)!, enter: dirOf.get(k)! });
    k = prev.get(k)!;
  }
  chain.reverse();

  // Each cell connects the edge it was entered from to the edge it exits toward
  // (the next cell's enter dir, or `lastDir` at the destination).
  return chain.map(({ c, enter }, i) => ({
    id: idOf(c),
    a: oppositePort(enter),
    b: i + 1 < chain.length ? chain[i + 1].enter : lastDir,
  }));
}
