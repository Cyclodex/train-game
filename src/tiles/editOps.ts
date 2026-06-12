import { Position, ActiveIntersection } from "@/types";
import {
  Port,
  PortPair,
  TileCell,
  Level,
  samePair,
  armExit,
  partnersOf,
  defaultArmFor,
  parseCoordId,
} from "@/tiles/model";
import type { Lane, LaneKind } from "@/tiles/lanes";
import { isRoadJunction, lanesFrom, turnKind } from "@/tiles/lanes";
import { cycleJunctionSignal as nextJunctionSignal } from "@/sim/junctionSignal";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";

// Lanes for a SINGLE direction from -> to: `count` lanes at indices
// startIndex..startIndex+count-1, optionally tagged with a lane `kind`.
function directedLanes(
  from: Port,
  to: Port,
  count: number,
  startIndex: number,
  kind?: LaneKind,
): Lane[] {
  return Array.from({ length: count }, (_, i) => ({
    from,
    to: [to],
    index: startIndex + i,
    ...(kind != null ? { kind } : {}),
  }));
}

// Pure, immutable single-cell editing operations used by the level editor. Each
// returns a new TileCell so Vue's reactive Level can swap the entry in place.

export function emptyCell(): TileCell {
  return { connections: [] };
}

// Add the connection if absent, remove it if already present (order-independent).
export function toggleConnection(cell: TileCell, a: Port, b: Port): TileCell {
  const pair: PortPair = [a, b];
  const exists = cell.connections.some(c => samePair(c, pair));
  const connections = exists
    ? cell.connections.filter(c => !samePair(c, pair))
    : [...cell.connections, pair];
  return { ...cell, connections };
}

// Ensure a connection is present without ever removing one (unlike
// toggleConnection). Idempotent — used when laying a route so re-crossing a
// tile forms a junction instead of deleting the rail.
export function addConnection(cell: TileCell, a: Port, b: Port): TileCell {
  if (cell.connections.some(c => samePair(c, [a, b]))) return cell;
  return { ...cell, connections: [...cell.connections, [a, b]] };
}

export function removeConnection(cell: TileCell, a: Port, b: Port): TileCell {
  return {
    ...cell,
    connections: cell.connections.filter(c => !samePair(c, [a, b])),
  };
}

// Make the cell a depot facing `facing` (a single border<->Center connection).
export function setDepot(cell: TileCell, facing: Port): TileCell {
  return { connections: [[facing, Position.Center]], role: "depot" };
}

// The outer (non-Center) port of a depot, or null if the cell isn't a depot.
export function depotFacing(cell: TileCell): Port | null {
  if (cell.role !== "depot") return null;
  const conn = cell.connections[0];
  if (!conn) return null;
  return conn[0] === Position.Center ? conn[1] : conn[0];
}

const FACING_CYCLE: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

// Rotate a depot's facing N->E->S->W.
export function rotateDepot(cell: TileCell): TileCell {
  const cur = depotFacing(cell) ?? Position.Top;
  const next = FACING_CYCLE[(FACING_CYCLE.indexOf(cur) + 1) % 4];
  return setDepot(cell, next);
}

// Add/remove a per-direction signal on `port`.
export function toggleSignalPort(cell: TileCell, port: Port): TileCell {
  const cur = cell.signals ?? [];
  const signals = cur.includes(port)
    ? cur.filter(p => p !== port)
    : [...cur, port];
  return { ...cell, signals };
}

// Cycling order matches Tile.vue's runtime changeSwitch so the editor and play
// feel identical.
const ARMS: ActiveIntersection[] = [
  ActiveIntersection.Left,
  ActiveIntersection.Straight,
  ActiveIntersection.Right,
];

// The valid arms for an entry (those whose geometric exit is a real partner),
// in ARMS order. Empty unless `entry` is a switchable junction entry.
function validArms(cell: TileCell, entry: Port): ActiveIntersection[] {
  const partners = partnersOf(cell.connections, entry);
  if (partners.length <= 1) return []; // straight/curve/depot: no switch
  return ARMS.filter(a => {
    const exit = armExit(entry, a);
    return exit !== null && partners.includes(exit);
  });
}

// Advance the authored starting arm for `entry` to the next valid arm (cyclic),
// starting from the currently-effective arm (the authored arm if any, else the
// computed first-valid one — the same arm the editor displays). Writes it into a
// fresh cell's `defaultArms`. No-op if `entry` is not a switchable junction entry.
export function cycleDefaultArm(cell: TileCell, entry: Port): TileCell {
  const valid = validArms(cell, entry);
  if (valid.length === 0) return cell;
  const current = defaultArmFor(cell, entry) ?? valid[0];
  const idx = valid.indexOf(current);
  const next = valid[(idx + 1) % valid.length];
  return { ...cell, defaultArms: { ...cell.defaultArms, [entry]: next } };
}

// Cycle a road junction's traffic-signal mode (the editor's "Signalise" tool):
// off → two-phase → two-phase+bus → round-robin → round-robin+bus → off. Only a
// road junction (lanes touching >2 ports) can be signalised; a no-op otherwise.
// "off" is stored as an absent `signal` so a plain junction round-trips cleanly.
export function cycleJunctionSignalMode(cell: TileCell): TileCell {
  if (!isRoadJunction(cell.road)) return cell;
  const next = nextJunctionSignal(cell.signal);
  if (next.mode === "off") {
    const { signal: _drop, ...rest } = cell;
    return { ...rest };
  }
  return { ...cell, signal: next };
}

// --- Road layer editing -------------------------------------------------------
// The road layer (`cell.road`) is edited with the same reducer shape as rail
// `connections`, on a separate layer. A cell may carry road without rail (a plain
// road tile) or both (a level crossing).

// Add or remove a single directed movement (from -> to) on the cell's lanes,
// keeping one index-0 lane per approach.
function upsertMovement(road: Lane[], from: Port, to: Port): Lane[] {
  const lane = road.find(l => l.from === from && l.index === 0);
  if (lane) {
    if (lane.to.includes(to)) return road;
    return road.map(l => (l === lane ? { ...l, to: [...l.to, to] } : l));
  }
  return [...road, { from, to: [to], index: 0 }];
}

// Add the movement from -> to to EVERY car lane of the `from` approach, widening
// it to `count` car lanes when it has fewer. This is the multi-lane junction case:
// drawing a turn into a 2/3-lane junction must connect on all of its lanes, not
// just lane 0 (the bug that left higher lanes unable to turn). Bus lanes keep
// their own indices and are left untouched.
function addJunctionMovement(road: Lane[], from: Port, to: Port, count: number): Lane[] {
  const carLanes = road.filter(l => l.from === from && l.kind !== "bus");
  const maxIdx = carLanes.length ? Math.max(...carLanes.map(l => l.index)) : -1;
  const target = Math.max(count, maxIdx + 1); // never shrink an existing approach
  // Add the exit to existing car lanes of this approach.
  let out = road.map(l =>
    l.from === from && l.kind !== "bus" && !l.to.includes(to)
      ? { ...l, to: [...l.to, to] }
      : l,
  );
  // Create any car lanes missing below `target` (skip indices a bus lane holds).
  const present = new Set(road.filter(l => l.from === from).map(l => l.index));
  for (let i = 0; i < target; i++) {
    if (!present.has(i)) out = [...out, { from, to: [to], index: i }];
  }
  return out;
}

function dropMovement(road: Lane[], from: Port, to: Port): Lane[] {
  return road
    .map(l => (l.from === from ? { ...l, to: l.to.filter(t => t !== to) } : l))
    .filter(l => l.to.length > 0);
}

// True when both directions of the undirected edge a<->b are present.
function hasEdge(road: Lane[], a: Port, b: Port): boolean {
  const ab = road.some(l => l.from === a && l.to.includes(b));
  const ba = road.some(l => l.from === b && l.to.includes(a));
  return ab && ba;
}

// Toggle a two-way road edge: add both directions if absent, drop both if present.
export function toggleRoad(cell: TileCell, a: Port, b: Port): TileCell {
  const road = cell.road ?? [];
  if (hasEdge(road, a, b)) {
    return { ...cell, road: dropMovement(dropMovement(road, a, b), b, a) };
  }
  return { ...cell, road: upsertMovement(upsertMovement(road, a, b), b, a) };
}

// Set a road edge to exactly `carCount` car lanes + `busCount` bus lanes per
// direction. When `oneWay` is true the edge carries lanes only in the drawn
// direction (a -> b); otherwise both directions are laid (the default two-way
// road). For a plain straight or curve (no junction exits), the edge is fully
// replaced so drawing over an existing road upgrades/downgrades it in place —
// including flipping a two-way road to one-way (the reverse lanes are stripped).
// For a junction approach (the lane has exits beyond this edge), the additive
// merge is used instead to preserve the other movements.
// Bus lanes take the OUTER (kerb-side) slots — indices 0..busCount-1 — and the
// car lanes sit inboard of them at busCount..busCount+carCount-1, so a bus lane
// renders on the kerb edge of the road rather than between the car lanes and the
// centreline (index 0 = kerb, highest index = centre; see sim/laneOffset.ts).
export function addRoad(
  cell: TileCell,
  a: Port,
  b: Port,
  carCount = 1,
  busCount = 0,
  oneWay = false,
): TileCell {
  const road = cell.road ?? [];
  // Detect junction: an approach whose `to[]` includes exits other than the
  // partner port. Replacing such a lane would silently drop those movements.
  const aIsJunction = road.some(l => l.from === a && l.to.some(t => t !== b));
  const bIsJunction = road.some(l => l.from === b && l.to.some(t => t !== a));
  if (aIsJunction || bIsJunction) {
    // Wire the movement across every lane of the approach(es) at the picked lane
    // count, so a turn into a multi-lane junction connects on all its lanes. A
    // one-way road only wires the drawn direction.
    let next = addJunctionMovement(road, a, b, carCount);
    if (!oneWay) next = addJunctionMovement(next, b, a, carCount);
    return { ...cell, road: next };
  }
  // Simple edge: replace with the exact lane count (upgrade or downgrade).
  const stripped = dropMovement(dropMovement(road, a, b), b, a);
  // Bus lanes on the kerb-side slots, car lanes inboard, for one direction.
  const dir = (from: Port, to: Port): Lane[] => [
    ...directedLanes(from, to, busCount, 0, "bus"),
    ...directedLanes(from, to, carCount, busCount),
  ];
  return {
    ...cell,
    road: [...stripped, ...dir(a, b), ...(oneWay ? [] : dir(b, a))],
  };
}

export function removeRoad(cell: TileCell, a: Port, b: Port): TileCell {
  const road = cell.road ?? [];
  return { ...cell, road: dropMovement(dropMovement(road, a, b), b, a) };
}

// Toggle a single lane's BUS designation: flip its `kind` between "bus" and
// normal (undefined), identified by its approach `from` and physical `index`
// (0 = kerb). This is the editor's "mark a lane as a bus lane" tool — it changes
// only the lane's access class, keeping its geometry and movements, so a normal
// 2-lane road becomes "1 car + 1 bus" without re-laying it (and back). No-op if
// the cell has no such lane.
export function toggleLaneKind(cell: TileCell, from: Port, index: number): TileCell {
  const road = cell.road;
  if (!road || !road.some(l => l.from === from && l.index === index)) return cell;
  const next = road.map(l => {
    if (l.from !== from || l.index !== index) return l;
    if (l.kind === "bus") return { from: l.from, to: l.to, index: l.index }; // → normal
    return { ...l, kind: "bus" as LaneKind };
  });
  return { ...cell, road: next };
}

// Set a single lane's kind explicitly (rather than toggling): "bus" tags it as a
// bus-only lane, undefined makes it a normal lane. Same identity (from + index) as
// toggleLaneKind, but the target state is given, so a whole run can be painted to
// one uniform state in one pass. No-op (returns the same cell) when no such lane
// exists, so a missing tile in a run leaves it untouched.
export function setLaneKind(
  cell: TileCell,
  from: Port,
  index: number,
  kind: LaneKind | undefined,
): TileCell {
  const road = cell.road;
  if (!road || !road.some(l => l.from === from && l.index === index)) return cell;
  const next = road.map(l => {
    if (l.from !== from || l.index !== index) return l;
    if (kind == null) return { from: l.from, to: l.to, index: l.index }; // → normal
    return { ...l, kind };
  });
  return { ...cell, road: next };
}

// --- Street-run traversal -----------------------------------------------------
// A "street run" is the contiguous chain of one physical lane as it flows from
// tile to tile along a street — the unit the bus-lane tool paints in one click.
// Starting from a clicked lane it walks both ways, following the lane through
// straights and curves, and stops where the lane stops being a single continuous
// through-lane: at a junction tile (a real routing choice), the road's end, a
// neighbour that lacks the continuing lane, or a lane that itself has multiple
// exits (junction-style movement). The result is the set of (tile, approach,
// index) triples the click should treat as one street.

// One reference to a physical lane: the tile it lives on, the port a vehicle
// enters that lane through, and the lane's index within that approach.
export interface LaneRef {
  id: string;
  from: Port;
  index: number;
}

// Find the lane on `cell` entering through `from` at `index`, or null. A run only
// ever follows a lane that is a single continuous through-lane, so a lane with
// more than one exit (a junction movement) is treated as absent here — the walk
// stops rather than stepping through a fork.
function throughLane(cell: TileCell | undefined, from: Port, index: number): Lane | null {
  if (!cell || isRoadJunction(cell.road)) return null;
  const lane = lanesFrom(cell.road, from).find(l => l.index === index);
  if (!lane || lane.to.length !== 1) return null;
  return lane;
}

// Walk the run DOWNSTREAM from the lane `(id, from, index)` and append each
// further lane to `acc` (the seed lane is assumed already pushed by the caller).
// `seen` guards against revisiting a tile so a circular street terminates. The
// step rule: the current lane exits by `lane.to[0]`; the neighbour beyond that
// exit continues the run as the lane entering through `oppositePort(exit)` at the
// SAME index. A bend is followed because the next tile's entry port is derived
// from the exit, not assumed equal to `from`.
function walkRun(
  level: Level,
  start: LaneRef,
  acc: LaneRef[],
  seen: Set<string>,
): void {
  let id = start.id;
  let from = start.from;
  const index = start.index;
  // The seed tile is already in `seen`/`acc`; advance from it.
  for (;;) {
    const cell = level[id];
    const lane = throughLane(cell, from, index);
    if (!lane) return; // missing lane / junction / multi-exit: stop
    const exit = lane.to[0];
    const nextCoord = neighborCoord(parseCoordId(id), exit);
    if (!nextCoord) return; // exits off the map (e.g. toward Center): road end
    const nextId = getCoordinatesId(nextCoord);
    if (seen.has(nextId)) return; // loop guard: circular street closes
    const nextCell = level[nextId];
    const nextFrom = oppositePort(exit);
    // The continuing lane must exist on the neighbour at the same index, and be a
    // plain through-lane (the neighbour mustn't be a junction). Otherwise stop.
    if (!throughLane(nextCell, nextFrom, index)) return;
    seen.add(nextId);
    acc.push({ id: nextId, from: nextFrom, index });
    id = nextId;
    from = nextFrom;
  }
}

// Walk the run UPSTREAM from the lane `(id, from, index)` and append each further
// lane to `acc` (the seed lane is assumed already pushed by the caller). Stepping
// upstream means moving to the neighbour on the current lane's ENTRY side (`from`)
// and finding the through-lane there (at the same index) whose exit points back
// toward us (`to[0] === oppositePort(from)`) — that lane is the one that flows
// INTO the current tile, so it is the same physical street one tile back. Its own
// `from` becomes the next upstream entry port, which is how a bend is followed:
// on a curve the upstream tile's approach side differs from ours, so it is read
// off the lane found rather than assumed. Same stop conditions as walkRun
// (junction, road end, missing lane, fork, loop guard).
function walkRunBack(
  level: Level,
  start: LaneRef,
  acc: LaneRef[],
  seen: Set<string>,
): void {
  let id = start.id;
  let from = start.from;
  const index = start.index;
  for (;;) {
    const backCoord = neighborCoord(parseCoordId(id), from);
    if (!backCoord) return; // entry is off-map (e.g. Center): road end
    const backId = getCoordinatesId(backCoord);
    if (seen.has(backId)) return; // loop guard: circular street closes
    // The upstream lane enters the neighbour through some port and exits toward us
    // (oppositePort(from)) at the same index. We don't know its entry port a priori
    // (a bend changes it), so search the neighbour's through-lanes for the one that
    // exits back toward this tile.
    const wantExit = oppositePort(from);
    const upLane = throughLaneExiting(level[backId], wantExit, index);
    if (!upLane) return; // missing lane / junction / fork / not flowing toward us
    seen.add(backId);
    acc.push({ id: backId, from: upLane.from, index });
    id = backId;
    from = upLane.from;
  }
}

// The through-lane on `cell` at `index` whose single exit is `exit`, or null. Like
// throughLane but keyed by the EXIT port (we know where the lane must flow, not
// which side it enters) — used by the upstream walk, where a bend means the entry
// side is unknown until the lane is found.
function throughLaneExiting(
  cell: TileCell | undefined,
  exit: Port,
  index: number,
): Lane | null {
  if (!cell || isRoadJunction(cell.road)) return null;
  const lane = (cell.road ?? []).find(
    l => l.index === index && l.to.length === 1 && l.to[0] === exit,
  );
  return lane ?? null;
}

// The whole street run containing the clicked lane `(id, from, index)`: the lane
// itself plus every lane it flows into forward (following its exit) and backward
// (following the oncoming side), across straights and curves, stopping at
// junctions, road ends, missing lanes and forks (see walkRun). The result always
// contains at least the clicked lane and never visits a tile twice.
export function streetRunLanes(
  level: Level,
  id: string,
  from: Port,
  index: number,
): LaneRef[] {
  const seed = level[id];
  // No such lane to click: return just the requested ref so callers always get a
  // non-empty list (the editor's hit paths only fire on real lanes anyway).
  const lane = seed && !isRoadJunction(seed.road)
    ? lanesFrom(seed.road, from).find(l => l.index === index)
    : undefined;
  const out: LaneRef[] = [{ id, from, index }];
  if (!lane) return out;
  const seen = new Set<string>([id]);
  // Forward: follow the clicked lane's exit downstream.
  walkRun(level, { id, from, index }, out, seen);
  // Backward: step upstream tile by tile, following the physical lane that flows
  // INTO each tile (across bends), until the run stops (junction / road end /
  // missing lane / fork / loop). One loop sweeps the whole upstream street.
  walkRunBack(level, { id, from, index }, out, seen);
  return out;
}

// Paint a whole street run to one uniform lane kind: from the CLICKED lane decide
// the target (a bus lane becomes normal, anything else becomes bus), then SET that
// kind on every lane of the run. Returns the cells that changed, keyed by id, as
// fresh TileCells — the editor commits them in one go. A half-painted street
// therefore becomes uniform in a single click instead of inverting tile by tile.
export function setLaneKindRun(
  level: Level,
  id: string,
  from: Port,
  index: number,
): Record<string, TileCell> {
  const seed = level[id];
  const clicked = seed && !isRoadJunction(seed.road)
    ? lanesFrom(seed.road, from).find(l => l.index === index)
    : undefined;
  const target: LaneKind | undefined = clicked?.kind === "bus" ? undefined : "bus";
  const run = streetRunLanes(level, id, from, index);
  const out: Record<string, TileCell> = {};
  for (const ref of run) {
    // A run may touch the same tile twice (both directions of a two-way street use
    // the same physical lane only once, but be defensive): build on the latest
    // version so multiple lanes on one tile all land.
    const base = out[ref.id] ?? level[ref.id];
    if (!base) continue;
    out[ref.id] = setLaneKind(base, ref.from, ref.index, target);
  }
  return out;
}

// --- Junction bus gates ---------------------------------------------------------
// When a street becomes bus-only, the junctions at its ends must stop OFFERING
// cars the turn into it — not just rely on the router avoiding it. The gate is
// the lane model itself: on every NON-bus junction lane, the exit toward a
// bus-only arm moves from `to` (everyone) to `busTo` (buses only), and moves
// back when the street regains a car lane. Re-derived from the neighbours, so
// it is idempotent and self-healing: painting, unpainting and re-painting a
// street always converges to the same junction state.

// Does the street tile `n` admit CARS through the seam it shares with a
// junction arm? True when a car-usable lane enters `n` from that side (the
// continuing lane of the street). No road/tile → not gated (an open map edge
// stays drivable; gating is only for real bus-only streets).
function armAdmitsCars(n: TileCell | undefined, seamPort: Port): boolean {
  if (!n?.road?.length) return true;
  const entering = lanesFrom(n.road, seamPort);
  if (entering.length === 0) return true; // no lanes face the seam: not a bus street
  return entering.some(l => l.kind !== "bus");
}

// Recompute one junction cell's bus gates from its current neighbours. Returns
// the same cell when nothing changes (so callers can skip the commit).
export function syncJunctionBusGates(level: Level, id: string): TileCell {
  const cell = level[id];
  if (!cell?.road || !isRoadJunction(cell.road)) return cell;
  const coord = parseCoordId(id);
  // The arm ports whose street is bus-only at the seam.
  const busArms = new Set<Port>();
  for (const p of [Position.Top, Position.Right, Position.Bottom, Position.Left]) {
    const nc = neighborCoord(coord, p);
    const n = nc ? level[getCoordinatesId(nc)] : undefined;
    if (!armAdmitsCars(n, oppositePort(p))) busArms.add(p);
  }
  let changed = false;
  const road = cell.road.map(l => {
    if (l.kind === "bus") return l; // a bus lane's exits are already bus-only
    const to = l.to.filter(p => !busArms.has(p));
    const gated = l.to.filter(p => busArms.has(p));
    const kept = (l.busTo ?? []).filter(p => busArms.has(p));
    const restored = (l.busTo ?? []).filter(p => !busArms.has(p));
    if (gated.length === 0 && restored.length === 0) return l;
    changed = true;
    const busTo = [...kept, ...gated];
    const next: Lane = { ...l, to: [...to, ...restored] };
    if (busTo.length > 0) next.busTo = busTo;
    else delete next.busTo;
    return next;
  });
  return changed ? { ...cell, road } : cell;
}

// All junctions whose gates may be affected by edits to `ids`: the edited tiles
// themselves plus their direct neighbours. Returns the changed cells keyed by
// id (empty when every junction was already in sync). `level` must already
// contain the lane edits.
export function syncJunctionBusGatesAround(
  level: Level,
  ids: string[],
): Record<string, TileCell> {
  const candidates = new Set<string>(ids);
  for (const id of ids) {
    const coord = parseCoordId(id);
    for (const p of [Position.Top, Position.Right, Position.Bottom, Position.Left]) {
      const nc = neighborCoord(coord, p);
      if (nc) candidates.add(getCoordinatesId(nc));
    }
  }
  const out: Record<string, TileCell> = {};
  for (const id of candidates) {
    const cell = level[id];
    if (!cell) continue;
    const synced = syncJunctionBusGates(level, id);
    if (synced !== cell) out[id] = synced;
  }
  return out;
}

// --- Junction lane capacity ------------------------------------------------
// Derives WHICH lanes of a junction approach may turn where, from the
// receiving arms' widths (the real-world rule: never more turning lanes toward
// a destination than it has receiving lanes; everything lane-true). Design:
// docs/superpowers/specs/2026-06-12-junction-lane-capacity-design.md
//
// Like syncJunctionBusGates this is DERIVED state: the editor re-runs it on
// every road edit and on load, so junction movements always match the streets
// around them. It only re-distributes the exits an approach already reaches
// (the union of to+busTo over its lanes), so intentionally removed movements
// stay removed. Bus lanes are untouched; capacities count CAR lanes (a
// bus-only arm falls back to its total so the bus-gate sync can demote the
// movement to busTo right after).

function carLanesFrom(road: Lane[], from: Port): Lane[] {
  return road
    .filter(l => l.from === from && l.kind !== "bus")
    .sort((a, b) => a.index - b.index); // 0 = kerb side
}

function receivingCarCapacity(level: Level, id: string, exit: Port): number {
  const coord = parseCoordId(id);
  const nc = neighborCoord(coord, exit);
  const n = nc ? level[getCoordinatesId(nc)] : undefined;
  if (n?.road?.length) {
    const receiving = lanesFrom(n.road, oppositePort(exit));
    if (receiving.length > 0) {
      const cars = receiving.filter(l => l.kind !== "bus").length;
      return cars > 0 ? cars : receiving.length; // bus-only arm: gate sync demotes after
    }
  }
  // No neighbour street (map edge): the junction's own opposing approach is
  // the best width estimate; a one-way outbound arm has none, assume 1.
  const own = (level[id]?.road ?? []).filter(l => l.from === exit && l.kind !== "bus").length;
  return own > 0 ? own : 1;
}

export function deriveJunctionCarLanes(
  level: Level,
  id: string,
  // The EDITOR invariant: a drawn junction connects every arm to every other
  // arm (there is no tool that removes a single movement), so the editor's
  // self-heal passes `allArms` to RESTORE movements an older buggy sync may
  // have eaten (e.g. a straight-through that vanished next to a bus arm).
  // Hand-authored scenarios (which DO remove movements deliberately, like
  // noleftturn) keep the default: only re-distribute what a lane reaches.
  allArms = false,
): TileCell {
  const cell = level[id];
  if (!cell?.road || !isRoadJunction(cell.road)) return cell;
  let changed = false;
  const next: Lane[] = [];
  for (const lane of cell.road) if (lane.kind === "bus") next.push(lane);
  const armPorts = new Set<Port>();
  if (allArms) {
    for (const l of cell.road) {
      armPorts.add(l.from);
      for (const p of l.to) armPorts.add(p);
      for (const p of l.busTo ?? []) armPorts.add(p);
    }
  }
  for (const from of [Position.Top, Position.Right, Position.Bottom, Position.Left]) {
    const lanes = carLanesFrom(cell.road, from);
    const N = lanes.length;
    if (N === 0) continue;
    // The exits this approach reaches today (to + busTo union) — by default we
    // only re-distribute them across lanes, never invent or drop an arm. With
    // `allArms` (editor) every other arm of the junction is reachable.
    const allowed = new Set<Port>();
    for (const l of lanes) {
      for (const p of l.to) allowed.add(p);
      for (const p of l.busTo ?? []) allowed.add(p);
    }
    if (allArms) for (const p of armPorts) allowed.add(p);
    allowed.delete(from);
    const straightExit = oppositePort(from);
    const S: Port | null = allowed.has(straightExit) ? straightExit : null;
    let L: Port | null = null;
    let R: Port | null = null;
    for (const p of allowed) {
      if (p === straightExit) continue;
      if (turnKind(from, p) === "right") R = p;
      else L = p;
    }
    const assign: Port[][] = lanes.map(() => []);
    if (N === 1) {
      // A single lane gets every present movement (nearest-lane landings).
      assign[0] = [...allowed];
    } else {
      const cR = R !== null ? receivingCarCapacity(level, id, R) : 0;
      const cL = L !== null ? receivingCarCapacity(level, id, L) : 0;
      const cS = S !== null ? receivingCarCapacity(level, id, S) : 0;
      // Dedicated turn blocks: expand into receiving capacity but always
      // leave one lane per other movement; the max(1,..) floor marks a SHARED
      // lane when the approach is too narrow for a dedicated one.
      const nR = R !== null
        ? Math.min(N, Math.max(1, Math.min(cR, N - (L !== null ? 1 : 0) - (S !== null ? 1 : 0))))
        : 0;
      const nL = L !== null
        ? Math.min(N - nR, Math.max(1, Math.min(cL, N - nR - (S !== null ? 1 : 0))))
        : 0;
      for (let i = 0; i < nR; i++) assign[i].push(R as Port);
      for (let i = 0; i < nL; i++) assign[N - 1 - i].push(L as Port);
      if (S !== null) {
        // Straight: the middle block, kerb-side priority, capped at cS.
        let straights = 0;
        for (let i = nR; i <= N - 1 - nL && straights < cS; i++) {
          assign[i].push(S);
          straights++;
        }
        // A single right lane shares S+R (the standard kerb marking); dual
        // right turns stay exclusive (real dual-turn signage).
        if (nR === 1 && straights < cS) {
          assign[0].push(S);
          straights++;
        }
        // Small approaches (<=2 lanes) may share the inner lane L+S; on >=3
        // lanes the inner lane is LEFT-ONLY (a waiting left-turner must not
        // block a through lane).
        if (N <= 2 && nL >= 1 && straights < cS) {
          assign[N - 1].push(S);
          straights++;
        }
      }
      // No lane may end up unable to move: widen turns into leftover
      // capacity, else overflow straight (the validator's business).
      for (let i = 0; i < N; i++) {
        if (assign[i].length > 0) continue;
        if (L !== null && assign.filter(a => a.includes(L as Port)).length < cL) assign[i].push(L as Port);
        else if (R !== null && assign.filter(a => a.includes(R as Port)).length < cR) assign[i].push(R as Port);
        else if (S !== null) assign[i].push(S);
        else if (L !== null) assign[i].push(L as Port);
        else if (R !== null) assign[i].push(R as Port);
      }
    }
    for (let i = 0; i < N; i++) {
      const lane = lanes[i];
      const to = assign[i];
      const same =
        lane.to.length === to.length &&
        to.every(p => lane.to.includes(p)) &&
        !(lane.busTo?.length);
      if (!same) changed = true;
      const rebuilt: Lane = { from: lane.from, to, index: lane.index };
      if (lane.kind) rebuilt.kind = lane.kind;
      next.push(same ? lane : rebuilt);
    }
  }
  return changed ? { ...cell, road: next } : cell;
}

// Derive + re-gate every junction in `ids` and their direct neighbours.
// Replaces syncJunctionBusGatesAround as the editor's one-stop sync: car
// movements first (from arm widths), bus gates second (reading the result).
export function syncJunctionLanesAround(
  level: Level,
  ids: string[],
  allArms = false,
): Record<string, TileCell> {
  const candidates = new Set<string>(ids);
  for (const id of ids) {
    const coord = parseCoordId(id);
    for (const p of [Position.Top, Position.Right, Position.Bottom, Position.Left]) {
      const nc = neighborCoord(coord, p);
      if (nc) candidates.add(getCoordinatesId(nc));
    }
  }
  const out: Record<string, TileCell> = {};
  const work: Level = { ...level };
  for (const id of candidates) {
    const cell = work[id];
    if (!cell) continue;
    const derived = deriveJunctionCarLanes(work, id, allArms);
    if (derived !== cell) {
      work[id] = derived;
      out[id] = derived;
    }
  }
  for (const id of candidates) {
    const cell = work[id];
    if (!cell) continue;
    const gated = syncJunctionBusGates(work, id);
    if (gated !== cell) {
      work[id] = gated;
      out[id] = gated;
    }
  }
  return out;
}
