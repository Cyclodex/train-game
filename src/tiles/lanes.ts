import type { Port } from "@/tiles/model";

// A lane's vehicle class, for restrictions. v1 stores the field but does not
// enforce it; bus-lane / vehicle-class enforcement lands in a later sub-project.
export type LaneKind = "all" | "bus"; // extensible

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

// Like exitsFrom but only for non-bus vehicles: skips lanes whose kind is "bus".
export function exitsForCar(road: Lane[] | undefined, from: Port): Port[] {
  const out = new Set<Port>();
  for (const lane of lanesFrom(road, from)) {
    if (lane.kind === "bus") continue;
    for (const to of lane.to) out.add(to);
  }
  return [...out];
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

// Generate `count` index slots in both directions between ports `a` and `b`.
// Produces a multi-lane bidirectional road: indices 0..count-1 each way.
// Pass `kind` to mark all lanes with a restriction (e.g. "bus").
export function nWayLanes(a: Port, b: Port, count: number, kind?: LaneKind): Lane[] {
  return Array.from({ length: count }, (_, i) => [
    { from: a, to: [b], index: i, ...(kind != null ? { kind } : {}) },
    { from: b, to: [a], index: i, ...(kind != null ? { kind } : {}) },
  ]).flat();
}

// A road junction is a tile whose road touches more than two ports (so a car has
// a real routing choice / streams cross). Straights and one-ways touch exactly
// two ports.
export function isRoadJunction(road: Lane[] | undefined): boolean {
  return roadPortsOf(road).length > 2;
}
