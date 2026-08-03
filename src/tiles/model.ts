import { Position, Coordinates, ActiveIntersection } from "@/types";
import { oppositePort } from "@/sim/topology";
import type { Lane } from "./lanes";
import type { ParkingCell } from "./parking";
import type { JunctionSignal } from "@/sim/junctionSignal";

export type Port = Position;
export type PortPair = [Port, Port];

export type TileKind =
  | "straight"
  | "curve"
  | "tjunction"
  | "cross"
  | "flyover"
  | "depot"
  | "station"
  | "dead-end"
  | "road-straight"
  | "road-taper"
  | "road-curve"
  | "road-tjunction"
  | "road-cross"
  | "crossing"
  | "empty";

// The canonical, authoritative description of one grid cell. `connections` is
// the single source of truth; kind/geometry/routing are all derived from it.
// What a cell IS, as opposed to what crosses it. `connections` and `road` say
// what travels through a tile; terrain says what the tile is made of. Absent =
// "grass", so every level authored before terrain existed still means the same
// thing. One rule reads it today — `canBuildOn` (water, rock and mountain block
// building); the rest — bridges over water, tunnels through mountain — arrive
// one at a time as EXCEPTIONS to that predicate. See tiles/terrain.ts.
export type TerrainKind =
  | "grass"
  | "farmland"
  | "forest"
  | "water"
  | "rock"
  | "mountain"
  | "urban"
  | "industry";

export interface TileCell {
  connections: PortPair[];
  // What the cell DOES in the simulation, beyond carrying track. A depot is a
  // dead-end terminus (edge↔Center) that ends a journey; a station is a stop
  // ALONG one: through-track (edge↔edge) where every train pauses for a dwell
  // before continuing. Routing stays derived from `connections` either way —
  // the role only adds behaviour (park/bounce vs dwell) and render.
  role?: "depot" | "station";
  // What this station is CALLED. A line reads as a list of places, not a list
  // of coordinates, so a board that means anything names its platforms. Absent
  // → a derived letter (see tiles/stationNames.ts), which keeps every older
  // board working and still gives the panel something to print.
  stationName?: string;
  // The ground under this cell. Absent = grass. See tiles/terrain.ts and
  // docs/superpowers/specs/2026-07-25-terrain-as-tile-data-design.md.
  terrain?: TerrainKind;
  // A STRUCTURE carrying the line over what is under it. The designed exception
  // to `canBuildOn` — not a second rule beside it: a bridge cell is buildable
  // *because it is a bridge*, and the predicate says so in one place. Set
  // automatically wherever a line is laid on bridgeable ground (water), so a
  // river is crossed rather than routed around. See tiles/terrain.ts.
  bridge?: boolean;
  // A STRUCTURE carrying the line UNDER what is over it — the bridge's twin for
  // rock and mountain. The same designed exception to `canBuildOn`, set
  // automatically wherever a line is laid on tunnelable ground, so a ridge is
  // bored through rather than being a wall. The line is underground: the ground
  // art stays unbroken over it (no cleared right-of-way) and the renderer hides
  // a train between the portals. See tiles/terrain.ts.
  tunnel?: boolean;
  // GRADE SEPARATION: this cell's lines cross at two LEVELS, and the named port
  // pair rides a deck OVER the other. The two lines never interact — no switch,
  // no reservation conflict, no collision — which the sim expresses by giving
  // each level its own conflict key (see `claimKey`). Authored data (there is
  // deliberately no auto-flyover: crossing an existing line in the editor still
  // builds a flat junction); must name one of the cell's connections.
  flyover?: PortPair;
  // ELEVATION: the height step this cell sits on (absent = 0, the valley
  // floor). A rail may join two neighbours whose heights differ by AT MOST one
  // step — that one-step joint IS the ramp (validateLevel raises "grade-step"
  // beyond it). The simulation reads the step ahead as a grade and slows a
  // climbing train by its mass (physics.ts `gradeSpeedFactor`); descending
  // changes nothing — the brakes hold. Rendering marks a climb with chevrons
  // pointing uphill; painted hillsides/embankments are a follow-up.
  height?: number;
  // Exit ports that carry a signal (per-direction). Empty/undefined = none.
  signals?: Port[];
  // Road layer: port pairs describing a road crossing this cell, in the SAME
  // port space as rail `connections` but on a separate, non-connecting layer.
  // A cell may carry road without rail (a plain road tile) or both (a level
  // crossing). Cars traverse `road`; trains traverse `connections`; the two only
  // interact at a crossing via the gate (derived from rail reservation). See
  // docs/superpowers/specs/2026-06-05-roads-and-level-crossings-design.md.
  road?: Lane[];
  // Parking layer: where a road vehicle may STOP on this cell — kerbside bays, a
  // car-park row beside an aisle, or the ramp mouth of a garage. The fourth axis
  // of the tile model, derived exactly like `road` (see tiles/parking.ts). A car
  // park's AISLES are ordinary `road` lanes, so the router drives its rows for
  // free; `parking` only ever adds the stalls beside them.
  parking?: ParkingCell;
  // PAVEMENT (Fussweg / Trottoir): the footway alongside this cell's road.
  //
  // Absent means BOTH sides, which is what a street is — so every board written
  // before footways existed grows them for free, and the field is only ever an
  // OPT-OUT ("none" for a motorway, a service road, a runway). That is
  // deliberate: a pavement you have to remember to add is a pavement most
  // streets will not have.
  //
  // NOT a `Lane`, and the difference matters. A pavement is bidirectional on one
  // strip where a lane is directed; it sits OUTSIDE the kerb where lanes are
  // positioned within the carriageway; and its users may overlap, which every
  // gate in the road sim exists to prevent. Pedestrians therefore get their own
  // small simulation (`sim/pedestrians.ts`) over the same tile graph, not a seat
  // in the traffic model. See tiles/footway.ts.
  footway?: "both" | "none";
  // A PEDESTRIAN CROSSING on this road tile — the zebra.
  //
  // The one place people may cross the carriageway, and therefore the player's
  // decision: without one, somebody whose work is on the far pavement has to
  // walk to the nearest crossing and back, which costs them time and costs you
  // their mood. With one, the traffic stops for them. Where the crossings go is
  // the same kind of choice as where a signal goes.
  //
  // A crossing CLOSES its tile to traffic while somebody is on it — the road
  // sim already knows how to do that, because it is exactly what a level
  // crossing does to a car when a train is coming (`CrossingClosed`). See
  // tiles/footway.ts and sim/pedestrians.ts.
  footCrossing?: boolean;
  // Which CITY this ground belongs to. Optional, and normally absent: cities are
  // derived by clustering connected urban/industry ground (`tiles/cities.ts`),
  // so every board written before cities existed has them for free. The tag is
  // the escape hatch for two towns that happen to touch — a flood fill would
  // read those as one place — and for naming a town explicitly. Ignored on any
  // cell that is not plot ground.
  city?: string;
  // Road-priority for junction arbitration: 0 = side road (default), 1 = main road.
  roadPriority?: number;
  // Street-junction traffic signals (ROAD / cars only). When present and not
  // "off", the road junction is signalised: cars obey per-arm green/amber/red on
  // top of the conflict-matrix yield. Only meaningful on a road junction; ignored
  // elsewhere. Round-trips through level JSON like `road`/`signals`. See
  // src/sim/junctionSignal.ts and the issue #38 design.
  signal?: JunctionSignal;
  // Authored starting switch arm per junction entry port (keyed by Port). Absent
  // entries fall back to the auto-computed first-valid arm. Only meaningful on a
  // switchable junction (cross / T-junction); ignored elsewhere. Round-trips
  // through level JSON like `signals`/`road`. See
  // docs/superpowers/specs/2026-06-06-junction-default-direction-design.md.
  defaultArms?: Partial<Record<Port, ActiveIntersection>>;
}

export type Level = Record<string, TileCell>;

export function samePair(a: PortPair, b: PortPair): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

export function pairHas(pair: PortPair, port: Port): boolean {
  return pair[0] === port || pair[1] === port;
}

// The other end of every connection that touches `port`.
export function partnersOf(connections: PortPair[], port: Port): Port[] {
  const out: Port[] = [];
  for (const [a, b] of connections) {
    if (a === port) out.push(b);
    else if (b === port) out.push(a);
  }
  return out;
}

// Every distinct port used by the connection set.
export function portsOf(connections: PortPair[]): Port[] {
  const set = new Set<Port>();
  for (const [a, b] of connections) {
    set.add(a);
    set.add(b);
  }
  return [...set];
}

export function parseCoordId(id: string): Coordinates {
  const [x, y] = id.split(",").map(Number);
  return { x, y };
}

// Rotate a port clockwise by `steps` quarter-turns (T->R->B->L). Center is fixed.
export function rotatePort(port: Port, steps: number): Port {
  if (port === Position.Center) return port;
  return ((((port as number) + steps) % 4) + 4) % 4;
}

export function rotatePair(pair: PortPair, steps: number): PortPair {
  return [rotatePort(pair[0], steps), rotatePort(pair[1], steps)];
}

export function rotateConnections(
  connections: PortPair[],
  steps: number
): PortPair[] {
  return connections.map(p => rotatePair(p, steps));
}

// Entry-relative geometric arm -> exit port. Reproduces the legacy
// topology.INTERSECTION table verbatim (rotation-independent for a 4-way).
const ARM_EXIT: Record<number, Record<number, Port>> = {
  [Position.Top]: {
    [ActiveIntersection.Left]: Position.Right,
    [ActiveIntersection.Straight]: Position.Bottom,
    [ActiveIntersection.Right]: Position.Left,
  },
  [Position.Right]: {
    [ActiveIntersection.Left]: Position.Bottom,
    [ActiveIntersection.Straight]: Position.Left,
    [ActiveIntersection.Right]: Position.Top,
  },
  [Position.Bottom]: {
    [ActiveIntersection.Left]: Position.Left,
    [ActiveIntersection.Straight]: Position.Top,
    [ActiveIntersection.Right]: Position.Right,
  },
  [Position.Left]: {
    [ActiveIntersection.Left]: Position.Top,
    [ActiveIntersection.Straight]: Position.Right,
    [ActiveIntersection.Right]: Position.Bottom,
  },
};

export function armExit(entry: Port, arm: ActiveIntersection): Port | null {
  return ARM_EXIT[entry]?.[arm] ?? null;
}

// True when an entry port participates in more than one connection — i.e. a
// switchable junction (T or cross), where an arm is needed to choose the exit.
export function isJunctionEntry(connections: PortPair[], entry: Port): boolean {
  return partnersOf(connections, entry).length > 1;
}

// The port a train leaves through. For non-junction entries (straight/curve/
// depot) the single partner is returned and `arm` is ignored. For a junction
// entry the geometric `arm` selects the exit; null if that connection is absent
// (a disabled/non-existent route) or no arm was supplied.
export function connectionsToExitPort(
  connections: PortPair[],
  entry: Port,
  arm?: ActiveIntersection
): Port | null {
  const partners = partnersOf(connections, entry);
  if (partners.length === 0) return null;
  if (partners.length === 1) return partners[0];
  if (arm === undefined) return null;
  const want = armExit(entry, arm);
  return want !== null && partners.includes(want) ? want : null;
}

// The authored starting arm for a junction entry, but only when its geometric
// exit is still a real partner of that entry. Returns undefined for an
// unauthored entry OR for a stale arm whose exit was since deleted — so a
// left-over arm never drives routing to a connection that no longer exists.
export function defaultArmFor(
  cell: TileCell,
  entry: Port
): ActiveIntersection | undefined {
  const arm = cell.defaultArms?.[entry];
  if (arm === undefined) return undefined;
  const exit = armExit(entry, arm);
  if (exit === null) return undefined;
  return partnersOf(cell.connections, entry).includes(exit) ? arm : undefined;
}

// A human-readable label for the cell's shape. Derived purely from connections
// (+ the depot role). Used for sprite selection, debug, and the editor — never
// for routing.
export function kindOf(cell: TileCell): TileKind {
  if (cell.role === "depot") return "depot";
  // A flyover LOOKS like a crossing but routes like two independent lines —
  // its own kind, so the debug label never claims a junction where no switch
  // exists.
  if (cell.flyover) return "flyover";
  if (cell.role === "station") return "station";
  const conns = cell.connections;
  const hasRoadLayer = (cell.road?.length ?? 0) > 0;

  // Level crossing: has both rail edges and road.
  if (conns.length > 0 && hasRoadLayer) return "crossing";

  // Road-only tiles: derive kind from the road's port set.
  if (conns.length === 0 && hasRoadLayer) {
    const road = cell.road!;
    const ports = new Set<Port>();
    for (const lane of road) {
      ports.add(lane.from);
      for (const to of lane.to) ports.add(to);
      for (const to of lane.busTo ?? []) ports.add(to);
    }
    if (ports.size >= 4) return "road-cross";
    if (ports.size === 3) return "road-tjunction";
    if (ports.size === 2) {
      const [a, b] = [...ports] as [Port, Port];
      if (a !== oppositePort(b)) return "road-curve";
      // A straight whose two ends carry a different number of physical lanes is
      // a taper (the lane-count transition tile, e.g. 2L on one side, 3L on the
      // other). Distinct lane indices per approach = that approach's lane count.
      // Both ends must carry lanes — a one-way straight (lanes only one way) has
      // an empty opposite approach and is a road-straight, not a taper.
      const countFrom = (p: Port) =>
        new Set(road.filter(l => l.from === p).map(l => l.index)).size;
      const ca = countFrom(a);
      const cb = countFrom(b);
      return ca > 0 && cb > 0 && ca !== cb ? "road-taper" : "road-straight";
    }
    return "road-straight";
  }

  if (conns.length === 0) return "empty";
  const edges = portsOf(conns).filter(p => p !== Position.Center);
  if (edges.length >= 3) return conns.length >= 6 ? "cross" : "tjunction";
  if (conns.length === 1) {
    const [a, b] = conns[0];
    if (a === Position.Center || b === Position.Center) return "dead-end";
    return a === oppositePort(b) ? "straight" : "curve";
  }
  return "tjunction";
}

// --- Grade separation (flyover) ----------------------------------------------
// Everywhere the simulation keys occupancy/reservation, it keys by CLAIM KEY:
// the plain tile id on every ordinary cell, and a per-level key on a flyover —
// so the deck and the ground line contend for different "tiles" and two trains
// cross simultaneously without ever seeing each other. One derivation, used by
// the reserver, the occupancy scan, the block scan and the signal aspect, so
// they can never disagree about which level a train is on.

/** The conflict key a train entering this tile via `entry` claims. */
export function claimKey(
  cell: TileCell | null | undefined,
  tileId: string,
  entry: Port
): string {
  if (!cell?.flyover) return tileId;
  const partners = partnersOf(cell.connections, entry);
  // A switchable flyover is not a thing: with more than one partner the cell
  // is a junction and its lines DO interact — fall back to whole-tile conflict.
  if (partners.length !== 1) return tileId;
  const pair: PortPair = [entry, partners[0]];
  return samePair(pair, cell.flyover) ? `${tileId}#over` : `${tileId}#under`;
}

/**
 * Every key a claim on this tile could be stored under — for by-tile queries
 * (debug overlays, the edit gate) that don't know which level they ask about.
 */
export function claimKeysOf(tileId: string): string[] {
  return [tileId, `${tileId}#over`, `${tileId}#under`];
}

/** The tile id a claim key refers to. */
export function tileIdOfClaim(key: string): string {
  const i = key.indexOf("#");
  return i === -1 ? key : key.slice(0, i);
}

/** The height step a cell sits on. Missing cell (or field) = 0, the floor. */
export function heightOf(cell: TileCell | null | undefined): number {
  return cell?.height ?? 0;
}

// --- Road layer helpers ------------------------------------------------------
// The road layer reuses the same Port space and rotation helpers as rail; these
// are the small derivations both the crossing stub and the full road system
// share. Keep routing/geometry derived from `road` the same way rail derives
// from `connections`.

// True when the cell carries any road. A pure road tile has connections:[] and a
// non-empty road; a level crossing has both.
export function hasRoad(cell: TileCell): boolean {
  return (cell.road?.length ?? 0) > 0;
}

// True when rail and road both pass through this cell — i.e. a level crossing.
// Rail must be real edge track (not just a Center stub) and road must exist.
export function isLevelCrossing(cell: TileCell): boolean {
  if (!hasRoad(cell)) return false;
  const railEdges = portsOf(cell.connections).filter(p => p !== Position.Center);
  return railEdges.length > 0;
}

// True when the level has no depots and at least one road tile — a pure road map
// with no rail layer. Used to skip train/depot requirements in validation and UI.
export function isRoadOnlyLevel(level: Level): boolean {
  let hasAnyRoad = false;
  for (const cell of Object.values(level)) {
    if (cell.role === "depot") return false;
    if (hasRoad(cell)) hasAnyRoad = true;
  }
  return hasAnyRoad;
}
