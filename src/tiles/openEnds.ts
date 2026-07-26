import { Level, Port, portsOf, parseCoordId } from "@/tiles/model";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { Position } from "@/types";
import type { OpenEnd } from "@/tiles/routePlanner";

// Where a line STOPS — the only places building in play may start from.
//
// An open end is a tile edge that carries rail on one side and nothing joining
// it on the other. It is the same condition `validateLevel` reports as
// "dangling-track"; what the validator calls a fault in a finished level is
// exactly the handle a player grows the network from.
//
// This exists because the play board offered every edge of every tile as a
// build target: on the buildgap board that is 168 targets of which 2 are legal
// starts, each a thin triangle tapering to a point. The player aiming at the
// end of a line would land one pixel over the boundary and arm a different
// anchor on an empty tile. Narrowing the targets to the open ends removes the
// wrong answers rather than asking for a steadier hand.

const EDGE_PORTS: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

/** The tile across `port`, or null at the world edge. */
function neighbourId(id: string, port: Port): string | null {
  const n = neighborCoord(parseCoordId(id), port);
  return n ? getCoordinatesId(n) : null;
}

/**
 * Does this tile's rail stop at this edge? True when the tile carries a
 * connection to `port` and the neighbour does not reach back — including when
 * there is no neighbour at all (the world edge).
 */
export function isOpenEnd(level: Level, id: string, port: Port): boolean {
  const cell = level[id];
  if (!cell || !portsOf(cell.connections).includes(port)) return false;
  const nid = neighbourId(id, port);
  if (nid === null) return true; // rail running off the map is still an end
  const nb = level[nid];
  if (!nb) return true;
  return !portsOf(nb.connections).includes(oppositePort(port));
}

/** Every edge of this tile where its rail stops. */
export function openEndPortsAt(level: Level, id: string): Port[] {
  const cell = level[id];
  if (!cell || cell.connections.length === 0) return [];
  return EDGE_PORTS.filter(p => isOpenEnd(level, id, p));
}

/**
 * The build targets reachable from a tile, as `{ port, end }`.
 *
 * The `end` may belong to a NEIGHBOUR: an open end is one physical place but
 * sits on the boundary between two tiles, so the empty side is offered as a
 * target too and delegates to the tile that owns the rail. That is what makes
 * the gesture forgiving — clicking either side of the line's end arms the same
 * open end, instead of one side working and the other silently arming
 * something else.
 */
export function buildTargetsAt(
  level: Level,
  id: string
): { port: Port; end: OpenEnd }[] {
  const out: { port: Port; end: OpenEnd }[] = [];
  for (const port of EDGE_PORTS) {
    if (isOpenEnd(level, id, port)) {
      out.push({ port, end: { id, edge: port } });
      continue;
    }
    // Nothing of ours here — but the tile across this edge may end against it.
    const nid = neighbourId(id, port);
    if (nid === null) continue;
    const back = oppositePort(port);
    if (isOpenEnd(level, nid, back)) {
      out.push({ port, end: { id: nid, edge: back } });
    }
  }
  return out;
}

/** Every open end on the board, for drawing handles. */
export function allOpenEnds(level: Level): OpenEnd[] {
  const out: OpenEnd[] = [];
  for (const id of Object.keys(level)) {
    for (const edge of openEndPortsAt(level, id)) out.push({ id, edge });
  }
  return out;
}
