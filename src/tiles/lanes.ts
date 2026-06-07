import type { Port } from "@/tiles/model";
import { Position } from "@/types";

// A lane's vehicle class, for restrictions. v1 stores the field but does not
// enforce it; bus-lane / vehicle-class enforcement lands in a later sub-project.
export type LaneKind = "all" | "bus"; // extensible

// A vehicle's lane-access class. A general road vehicle ("car": car/truck/semi)
// may not use bus-only lanes; a "bus" may use ANY lane (car lanes AND bus lanes).
// This is the single rule for "which lanes may this vehicle drive in", consumed by
// every lane query below so access logic lives in one place.
export type VehicleClass = "car" | "bus";

// May a vehicle of class `cls` drive in `lane`? Buses may use any lane; everything
// else is barred from bus-only lanes.
export function laneUsableBy(lane: Lane, cls: VehicleClass): boolean {
  return cls === "bus" || lane.kind !== "bus";
}

// One physical lane through a tile, directed. A car enters via `from` and may
// leave by any port listed in `to` (the permitted movements from this lane).
export interface Lane {
  from: Port; // approach edge the car enters through
  to: Port[]; // permitted exit edges (turn options); length 1 on a plain road / one-way
  index: number; // physical position within the `from` approach, 0 = kerb side
  kind?: LaneKind; // reserved for restrictions; default "all"
}

// --- Authoring helpers -------------------------------------------------------

// A single directed lane (one-way / one movement).
export function oneWay(from: Port, to: Port): Lane {
  return { from, to: [to], index: 0 };
}

// An approach lane with explicitly-listed permitted exits (turns / turn bans).
export function turns(from: Port, exits: Port[], index = 0): Lane {
  return { from, to: exits, index };
}

// A two-way single-lane road between two ports (one lane each direction).
export function twoWay(a: Port, b: Port): Lane[] {
  return [oneWay(a, b), oneWay(b, a)];
}

// Build the canonical lane set from undirected port pairs: one lane per approach
// port whose `to` is every partner of that port. This preserves the old
// undirected behaviour exactly (every pair is traversable both ways) while
// producing valid lanes (a single index-0 lane per approach). Used to migrate
// existing authored levels and to author plain two-way roads/junctions.
export function fromPairs(pairs: [Port, Port][]): Lane[] {
  const exits = new Map<Port, Set<Port>>();
  const add = (a: Port, b: Port) => {
    if (!exits.has(a)) exits.set(a, new Set());
    exits.get(a)!.add(b);
  };
  for (const [a, b] of pairs) {
    add(a, b);
    add(b, a);
  }
  return [...exits.entries()].map(([from, set]) => ({
    from,
    to: [...set],
    index: 0,
  }));
}

// --- Query helpers -----------------------------------------------------------

// The lanes of one approach (entering through `from`). Lane-count-agnostic: at
// one lane per direction this is a single-element array, but callers iterate so
// adding lanes later is additive.
export function lanesFrom(road: Lane[] | undefined, from: Port): Lane[] {
  return (road ?? []).filter(l => l.from === from);
}

// The union of permitted exit ports from an approach (across all its lanes).
export function exitsFrom(road: Lane[] | undefined, from: Port): Port[] {
  const out = new Set<Port>();
  for (const lane of lanesFrom(road, from)) for (const to of lane.to) out.add(to);
  return [...out];
}

// Like exitsFrom but only for lanes the vehicle class may use (a "car" skips
// bus-only lanes; a "bus" uses any).
export function usableExits(
  road: Lane[] | undefined,
  from: Port,
  cls: VehicleClass,
): Port[] {
  const out = new Set<Port>();
  for (const lane of lanesFrom(road, from)) {
    if (!laneUsableBy(lane, cls)) continue;
    for (const to of lane.to) out.add(to);
  }
  return [...out];
}

// Like exitsFrom but only for non-bus vehicles: skips lanes whose kind is "bus".
export function exitsForCar(road: Lane[] | undefined, from: Port): Port[] {
  return usableExits(road, from, "car");
}

// The lane indices of an approach a vehicle of class `cls` may use, ascending by
// index (0 = kerb).
export function usableLaneIndices(
  road: Lane[] | undefined,
  from: Port,
  cls: VehicleClass,
): number[] {
  return lanesFrom(road, from)
    .filter(l => laneUsableBy(l, cls))
    .map(l => l.index)
    .sort((a, b) => a - b);
}

// The car-accessible lane indices of an approach, ascending by index (0 = kerb).
export function carLaneIndices(road: Lane[] | undefined, from: Port): number[] {
  return usableLaneIndices(road, from, "car");
}

// The bus-only lane indices of an approach (kind === "bus"), ascending by index.
// A bus prefers these; empty when the approach has no bus lane.
export function busLaneIndices(road: Lane[] | undefined, from: Port): number[] {
  return lanesFrom(road, from)
    .filter(l => l.kind === "bus")
    .map(l => l.index)
    .sort((a, b) => a - b);
}

// The lane index of approach `from` usable by class `cls` nearest to `lane`
// (0 = kerb). Wherever lane logic would place a vehicle — a spawn slot, a merge
// target, an overtake lane — it is snapped to the closest lane it may use, so a
// car never ends up on a bus lane (a bus may land on either). Ties favour the
// kerb-side (lower) index. Returns `lane` unchanged if the approach has no usable
// lane at all (nothing to snap to).
export function nearestUsableLaneIndex(
  road: Lane[] | undefined,
  from: Port,
  lane: number,
  cls: VehicleClass,
): number {
  const usable = usableLaneIndices(road, from, cls);
  if (usable.length === 0) return lane;
  return usable.reduce((best, l) =>
    Math.abs(l - lane) < Math.abs(best - lane) ? l : best,
  );
}

// The car-accessible lane index of approach `from` nearest to `lane` (0 = kerb).
export function nearestCarLaneIndex(
  road: Lane[] | undefined,
  from: Port,
  lane: number,
): number {
  return nearestUsableLaneIndex(road, from, lane, "car");
}

// The lane indices of approach `from` usable by class `cls` that permit exiting
// toward `exit` (i.e. whose `to` lists it), ascending. Used by lane-aware routing
// to position a vehicle in a lane that allows its next turn. Empty when no usable
// lane permits the move.
export function lanesAllowingExitFor(
  road: Lane[] | undefined,
  from: Port,
  exit: Port,
  cls: VehicleClass,
): number[] {
  return lanesFrom(road, from)
    .filter(l => laneUsableBy(l, cls) && l.to.includes(exit))
    .map(l => l.index)
    .sort((a, b) => a - b);
}

// The car-accessible lane indices of approach `from` that permit exiting toward
// `exit`. Empty when no car lane permits the move.
export function lanesAllowingExit(
  road: Lane[] | undefined,
  from: Port,
  exit: Port,
): number[] {
  return lanesAllowingExitFor(road, from, exit, "car");
}

// --- Junction lane matching --------------------------------------------------
// Right-hand-traffic port order, clockwise. Index 0 = kerb side of an approach.
const PORT_CW: Partial<Record<Port, number>> = {
  [Position.Top]: 0,
  [Position.Right]: 1,
  [Position.Bottom]: 2,
  [Position.Left]: 3,
};

// Classify the movement entry→exit through a tile as a left/right turn or a
// straight-through, from the right-hand-traffic geometry. A car entering through
// `entryPort` travels toward `oppositePort(entryPort)`; the exit relative to that
// heading is a right turn (90° clockwise), a left turn (90° anticlockwise), or
// straight (same heading, or a U-turn which we treat as straight for alignment).
export type TurnKind = "left" | "right" | "straight";
export function turnKind(entryPort: Port, exitPort: Port): TurnKind {
  const e = PORT_CW[entryPort];
  const x = PORT_CW[exitPort];
  if (e == null || x == null) return "straight";
  const heading = (e + 2) % 4; // travel direction = opposite of the entry edge
  const delta = (x - heading + 4) % 4;
  if (delta === 1) return "right";
  if (delta === 3) return "left";
  return "straight"; // 0 = straight, 2 = U-turn (align like a straight)
}

// The lane a vehicle of class `cls` should land in on the EXIT arm of a junction,
// given the lane it occupied on the approach. This is what makes a cross with
// unequal lane counts route correctly: the index is chosen from the *exit* road's
// usable lanes (never the approach's), so a 1→3 fans out and a 3→1 merges, and a
// turn lands in the lane that matches its direction.
//
// Alignment: keep the vehicle's lateral RANK among the approach lanes that permit
// the movement, projected onto the exit arm's usable lanes — kerb-aligned for a
// straight or right turn (rank counted from the kerb, index 0), inner-aligned for
// a left turn (rank counted from the centre side). The result is always a lane the
// class may use (cars never land on a bus lane; a bus may, and for a straight/right
// onto a kerb-side bus lane it does — then prefers to stay there).
//
// `entryPort`/`entryIndex` = how/where the vehicle sat on the junction tile;
// `exitPort` = the arm it leaves by; `exitRoad`/`exitApproach` = the next tile's
// lanes and the port it enters that tile through (oppositePort(exitPort)).
export function junctionExitLane(
  junctionRoad: Lane[] | undefined,
  entryPort: Port,
  entryIndex: number,
  exitPort: Port,
  exitRoad: Lane[] | undefined,
  exitApproach: Port,
  cls: VehicleClass,
): number {
  const dst = usableLaneIndices(exitRoad, exitApproach, cls);
  if (dst.length === 0) return entryIndex; // exit arm offers this class no lane
  // Approach lanes that permit this exact movement; fall back to all usable
  // approach lanes, then to the raw entry index, so we always have a source set.
  let src = lanesAllowingExitFor(junctionRoad, entryPort, exitPort, cls);
  if (src.length === 0) src = usableLaneIndices(junctionRoad, entryPort, cls);
  if (src.length === 0) src = [entryIndex];
  // Rank of the vehicle's lane within the source set (nearest if it isn't exactly
  // one of them), 0 = kerb side.
  let rank = 0;
  let bestDelta = Infinity;
  src.forEach((l, i) => {
    const d = Math.abs(l - entryIndex);
    if (d < bestDelta) {
      bestDelta = d;
      rank = i;
    }
  });
  const S = src.length;
  const D = dst.length;
  let pos: number;
  if (turnKind(entryPort, exitPort) === "left") {
    // Inner-align: the innermost source lane maps to the innermost exit lane.
    const fromInner = S - 1 - rank;
    pos = D - 1 - fromInner;
  } else {
    // Kerb-align: the kerb source lane maps to the kerb exit lane.
    pos = rank;
  }
  pos = Math.max(0, Math.min(D - 1, pos));
  return dst[pos];
}

// Every port the road touches (as an approach or an exit).
export function roadPortsOf(road: Lane[] | undefined): Port[] {
  const out = new Set<Port>();
  for (const lane of road ?? []) {
    out.add(lane.from);
    for (const to of lane.to) out.add(to);
  }
  return [...out];
}

// Expand the road into directed movements (one per lane × permitted exit),
// deduplicated. Feeds the junction conflict matrix.
export function laneMovements(
  road: Lane[] | undefined
): { from: Port; to: Port }[] {
  const seen = new Set<string>();
  const out: { from: Port; to: Port }[] = [];
  for (const lane of road ?? []) {
    for (const to of lane.to) {
      const key = `${lane.from}:${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from: lane.from, to });
    }
  }
  return out;
}

// The unique undirected edges the road's lanes touch (order-normalised), one per
// physical road segment. Used by the renderer (one ribbon per edge) and the
// editor (one delete handle per edge), so the "lanes -> visual edges" rule lives
// in one place rather than being re-derived in each view.
export function roadEdges(road: Lane[] | undefined): [Port, Port][] {
  const seen = new Set<string>();
  const out: [Port, Port][] = [];
  for (const lane of road ?? []) {
    for (const to of lane.to) {
      const key = lane.from < to ? `${lane.from}-${to}` : `${to}-${lane.from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(lane.from < to ? [lane.from, to] : [to, lane.from]);
    }
  }
  return out;
}

// The number of physical lanes for a given approach direction: max(index)+1 across
// all lanes whose `from` equals `from`. Returns 0 if no lanes enter from that port.
export function laneCount(road: Lane[] | undefined, from: Port): number {
  const lanes = lanesFrom(road, from);
  return lanes.length === 0 ? 0 : Math.max(...lanes.map(l => l.index)) + 1;
}

// Total physical lanes crossing a port boundary: lanes entering FROM the port
// PLUS lanes exiting THROUGH it (whose `to` includes the port). Use this instead
// of laneCount(a) + laneCount(oppositePort(a)) when the tile is a curve or
// junction — there the opposite port carries no lanes, so the two-term formula
// under-counts and triggers false mismatch / taper errors. For a turn movement
// it counts only the lanes using that movement (e.g. one lane of a 2-lane
// approach turning off), so each seam is measured by what actually crosses it.
export function laneCountAt(road: Lane[] | undefined, port: Port): number {
  const entering = laneCount(road, port);
  // Count the DISTINCT physical exit lanes at this port. Not max(index)+1: with
  // turn lanes only some indices exit a given port (e.g. only lane 1 turns left).
  // But also not the raw lane count: at an all-turns junction several approaches
  // funnel into the same index-0 exit lane, so counting movements would over-count
  // the seam (3 turns sharing one lane != 3 lanes). Distinct indices handles both.
  const exitingCount = new Set(
    (road ?? []).filter(l => l.to.includes(port)).map(l => l.index),
  ).size;
  return entering + exitingCount;
}

// Generate `count` index slots in both directions between ports `a` and `b`.
// Produces a multi-lane bidirectional road: indices 0..count-1 each way.
// Pass `kind` to mark all lanes with a restriction (e.g. "bus").
export function nWayLanes(a: Port, b: Port, count: number, kind?: LaneKind): Lane[] {
  return Array.from({ length: count }, (_, i) => [
    { from: a, to: [b], index: i, ...(kind != null ? { kind } : {}) },
    { from: b, to: [a], index: i, ...(kind != null ? { kind } : {}) },
  ]).flat();
}

// Generate a one-way multi-lane road: `count` lanes all entering FROM `a` and
// exiting TOWARD `b`, indices 0..count-1 (0 = kerb side). The mirror direction
// is absent, so traffic only ever flows a→b. The single-lane case equals
// `[oneWay(a, b)]`; this is its multi-lane generalisation, parallel to
// `nWayLanes` for two-way roads.
export function oneWayLanes(a: Port, b: Port, count: number, kind?: LaneKind): Lane[] {
  return Array.from({ length: count }, (_, i) => ({
    from: a,
    to: [b],
    index: i,
    ...(kind != null ? { kind } : {}),
  }));
}

// The painted total lane count for one end of a straight road edge, given this
// tile's own painted total (`selfTotal`, already floored at the min-2 a one-way
// road draws) and the neighbour's lane count crossing the shared seam
// (`neighbourCrossing`, from `laneCountAt` on the neighbour's matching port; 0
// when there is no neighbour road — an off-map border edge or a grass tile).
//
// With a neighbour road the edge meets it flush: take the narrower of the two
// painted widths, flooring the neighbour at the same min-2 (so a one-way
// single-lane neighbour, painted 2 wide, doesn't pinch the seam to 1). With NO
// neighbour road the road simply ends at the map edge and keeps its own full
// width — it must NOT taper toward a phantom 2-lane neighbour, which is what
// made 3+-lane roads visibly narrow as they ran off the play area.
export function seamPaintTotal(selfTotal: number, neighbourCrossing: number): number {
  if (neighbourCrossing <= 0) return selfTotal;
  return Math.min(selfTotal, Math.max(neighbourCrossing, 2));
}

// A road junction is a tile whose road touches more than two ports (so a car has
// a real routing choice / streams cross). Straights and one-ways touch exactly
// two ports.
export function isRoadJunction(road: Lane[] | undefined): boolean {
  return roadPortsOf(road).length > 2;
}
