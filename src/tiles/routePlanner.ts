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
  // Cells a line may cross only ON A STRUCTURE — water, which a bridge spans.
  // Passable, but at BRIDGE_MOVE per tile instead of MOVE, so a route takes the
  // dry way round whenever one is remotely comparable and crosses only where
  // crossing is genuinely the shorter answer. That trade-off IS the feature: a
  // lake gets routed around, a river gets bridged.
  bridgeable?: (c: Coordinates) => boolean;
  // Cells a line may cross only UNDERGROUND — rock/mountain, which a tunnel
  // bores. Same gate as `bridgeable`, priced at TUNNEL_MOVE: dearer per tile
  // than a span because a ridge is usually several tiles deep, so a bore only
  // wins where the way round is genuinely far.
  tunnelable?: (c: Coordinates) => boolean;
}

const DIRS: Port[] = [Position.Top, Position.Right, Position.Bottom, Position.Left];
const idOf = (c: Coordinates) => `${c.x},${c.y}`;

// Cost weights: length dominates (each move), turns break ties between equal-
// length routes so previews bend cleanly with as few curves as possible.
const MOVE = 1000;
const TURN = 1;
// A span costs about six tiles of plain track to route through. Tuned against
// the shape of the problem rather than the price list: a 1-wide river is worth
// crossing from anywhere within ~6 tiles of a detour, a lake several tiles
// across never is. (The MONEY price is separate — BRIDGE_BUILD_FACTOR.)
const BRIDGE_MOVE = MOVE * 6;
// A bore costs about nine tiles of plain track to route through, per tile of
// ridge. Dearer than a span: a river is one tile of structure, a ridge stacks
// this per tile — a 2-wide ridge is only worth boring when the way round is
// ~18 tiles of detour.
const TUNNEL_MOVE = MOVE * 9;

export function planRoute(
  from: OpenEnd,
  to: OpenEnd,
  o: RouteOpts
): RouteStep[] | null {
  const passable = o.passable ?? (() => true);
  const bridgeable = o.bridgeable ?? (() => false);
  const tunnelable = o.tunnelable ?? (() => false);
  const inGrid = (c: Coordinates) =>
    c.x >= 0 && c.y >= 0 && c.x < o.width && c.y < o.height;
  const ok = (c: Coordinates) =>
    inGrid(c) && (passable(c) || bridgeable(c) || tunnelable(c));
  // What entering this cell costs: a plain move, a span, or a bore.
  const moveCost = (c: Coordinates) =>
    passable(c) ? MOVE : bridgeable(c) ? BRIDGE_MOVE : TUNNEL_MOVE;

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
      const cost = bd + moveCost(nc) + (nd !== dir ? TURN : 0);
      if (cost < (dist.get(k) ?? Infinity)) {
        dist.set(k, cost);
        prev.set(k, bk!);
        cellOf.set(k, nc);
        dirOf.set(k, nd);
        open.add(k);
      }
    }
  }

  // Cheapest arrival at T from any side. The hovered edge (`lastDir`) is the
  // *desired* exit/continue direction, applied after the search — it never
  // forces a longer approach. When it would coincide with the approach edge
  // (degenerate), the tile becomes a straight-through instead.
  const exitFor = (nd: Port): Port => {
    const entry = oppositePort(nd); // edge the route entered T through
    return lastDir !== entry ? lastDir : oppositePort(entry);
  };
  let best: Key | null = null;
  let bestCost = Infinity;
  for (const nd of DIRS) {
    const k = skey(T, nd);
    if (!dist.has(k)) continue;
    const cost = dist.get(k)! + (nd !== exitFor(nd) ? TURN : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = k;
    }
  }
  if (!best) return null;
  const destExit = exitFor(dirOf.get(best)!);

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
    b: i + 1 < chain.length ? chain[i + 1].enter : destExit,
  }));
}
