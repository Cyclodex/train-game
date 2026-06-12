import { Coordinates, Position } from "@/types";
import { Level, isLevelCrossing } from "@/tiles/model";
import { exitsForCar, isRoadJunction, laneCount, lanesAllowingExit, lanesAllowingExitFor, carLaneIndices, usableExits, usableLaneIndices, nearestUsableLaneIndex, busLaneIndices, junctionExitLane, approachPortsOf, type VehicleClass } from "@/tiles/lanes";
import { Port, neighborCoord, oppositePort } from "./topology";
import {
  JunctionSignal,
  JunctionSignalController,
  SignalAspect,
  createJunctionSignal,
  cycleJunctionSignal,
  BUS_PRIORITY_TILES,
} from "./junctionSignal";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { roadSegmentLength } from "./pathGeometry";
import { makeRng } from "@/utils/globalHelpers";
import { planRoute, RouteTurn } from "./roadRouter";
import { buildConflictMatrix, conflictKey, sameEntryConflict } from "./roadJunction";
import {
  ActiveMovement,
  WaitingCar,
  ConflictFn,
  fcfsWithPriorityArbiter,
  JunctionArbiter,
} from "./roadArbiter";

// Re-export so existing importers of isRoadJunction from "@/sim/road" keep working.
export { isRoadJunction } from "@/tiles/lanes";

// --- Vehicle kinds -----------------------------------------------------------
// A vehicle is described as data: a list of rendered body segments plus a
// coupling gap, all measured in tiles and scaled from a base car length `B`.
// A car is one box; a truck one longer box; a semi a short cab + long trailer
// (two chord segments, so the trailer articulates on curves like a train's
// loco + wagon). Everything downstream (following distance, lane occupancy,
// rendering) is derived from the spec, so adding a kind is a one-row change.

export type VehicleKind = "car" | "truck" | "semi" | "bus";

export interface VehicleSegment {
  length: number; // rendered box length, in tiles
  part: "car" | "truck" | "cab" | "trailer" | "bus"; // render style hint for the view
}

// The lane-access class of a vehicle kind: a bus may use bus lanes (and prefers
// them); every other kind is a general "car" confined to non-bus lanes.
export function vehicleClassOf(kind: VehicleKind): VehicleClass {
  return kind === "bus" ? "bus" : "car";
}

export interface VehicleSpec {
  segments: VehicleSegment[];
  gap: number; // coupling gap between consecutive segments, in tiles
}

// Length multipliers over the base car length `B` (the sim's `carLength`).
const TRUCK_LEN = 1.7;
const SEMI_CAB = 0.7;
const SEMI_TRAILER = 1.6;
const SEMI_GAP = 0.12;
// A bus is one rigid box, longer than a car but shorter than a rigid truck — it
// reads as a passenger coach rather than a cargo hauler (the renderer's `bus`
// part then paints a long side window-band so it looks distinct from a truck).
const BUS_LEN = 1.45;

export function vehicleSpec(kind: VehicleKind, base: number): VehicleSpec {
  switch (kind) {
    case "truck":
      return { segments: [{ length: base * TRUCK_LEN, part: "truck" }], gap: 0 };
    case "bus":
      return { segments: [{ length: base * BUS_LEN, part: "bus" }], gap: 0 };
    case "semi":
      return {
        segments: [
          { length: base * SEMI_CAB, part: "cab" },
          { length: base * SEMI_TRAILER, part: "trailer" },
        ],
        gap: base * SEMI_GAP,
      };
    case "car":
    default:
      return { segments: [{ length: base, part: "car" }], gap: 0 };
  }
}

// Total body length of a spec (the lane span used for following/queueing).
export function specLength(spec: VehicleSpec): number {
  const segs = spec.segments.reduce((s, seg) => s + seg.length, 0);
  return segs + spec.gap * Math.max(0, spec.segments.length - 1);
}

// Relative spawn weights per kind. Omitted/zero kinds never spawn; `{ car: 1 }`
// (the default) reproduces the original all-cars behaviour.
export type TrafficMix = { car?: number; truck?: number; semi?: number; bus?: number };

// Per-level road-traffic settings: how busy the roads are and what mix of
// vehicles drives them. All optional; each overlays the sim's defaults.
export interface TrafficConfig {
  spawnInterval?: number; // mean seconds between spawn attempts (smaller = busier)
  mix?: TrafficMix; // relative weights of car/truck/semi
  maxCars?: number; // cap on live vehicles
  overtakeFraction?: number; // fraction of drivers that overtake a slow leader (0..1)
  // Spawn cars only from these explicit entries instead of the game's default
  // map-edge detection. Lets a scenario model directed lanes (e.g. a divided road
  // where each lane is one-way in opposite directions) or bias one direction by
  // listing its entry more than once — entries are picked uniformly, so a
  // duplicated entry spawns proportionally more often.
  spawnEntries?: RoadEntry[];
}

// --- Road traversal ----------------------------------------------------------
// Cars walk the road port-graph exactly like trains walk the rail graph
// (network.ts traverse()), but reading a cell's `road` pairs instead of its
// `connections`. Roads have no switches in this first cut: a road tile is a
// straight or a curve (a single partner per entry); where a road port has
// several partners (a junction) we pick the first deterministically.

export interface RoadTraversal {
  // The port the car leaves the current tile through, or null if the road has
  // no pair using the entry port.
  exitPort: Port | null;
  // The next tile and the port the car enters it through, or null at a map edge
  // / road end (the car despawns there).
  next: { coord: Coordinates; entryPort: Port } | null;
}

function roadExitPort(
  level: Level,
  coord: Coordinates,
  entryPort: Port,
  cls: VehicleClass = "car",
): Port | null {
  const tile = level[getCoordinatesId(coord)];
  if (!tile || !tile.road || tile.road.length === 0) return null;
  const exits = usableExits(tile.road, entryPort, cls);
  if (exits.length === 0) return null;
  // Single exit (straight/curve/one-way) — or pick the first for a junction.
  // At a junction with multiple exits, prefer exits whose next tile actually
  // carries lanes this vehicle class can use. A car must never take a junction
  // arm whose neighbour is a bus-only road (it would immediately despawn there).
  if (exits.length > 1) {
    const traversable = exits.filter(exit => {
      const n = neighborCoord(coord, exit);
      if (!n) return true; // off-map edge — vehicle exits here
      const nTile = level[getCoordinatesId(n)];
      if (!nTile?.road?.length) return true; // no road neighbour — off-map
      return usableExits(nTile.road, oppositePort(exit), cls).length > 0;
    });
    if (traversable.length > 0) return traversable[0];
  }
  return exits[0];
}

export function roadTraverse(
  level: Level,
  coord: Coordinates,
  entryPort: Port,
  cls: VehicleClass = "car",
): RoadTraversal {
  const exitPort = roadExitPort(level, coord, entryPort, cls);
  if (exitPort === null) return { exitPort: null, next: null };

  const nextCoord = neighborCoord(coord, exitPort);
  if (!nextCoord) return { exitPort, next: null }; // Center has no neighbour

  const nextTile = level[getCoordinatesId(nextCoord)];
  if (!nextTile || !nextTile.road || nextTile.road.length === 0)
    return { exitPort, next: null }; // road runs off the map / dead-ends
  // The next tile must carry road back to us that this vehicle class may use.
  if (usableExits(nextTile.road, oppositePort(exitPort), cls).length === 0)
    return { exitPort, next: null };

  return { exitPort, next: { coord: nextCoord, entryPort: oppositePort(exitPort) } };
}

// --- Spawn points -------------------------------------------------------------
// A car spawns where a road opens onto the map edge: a road port that points off
// the grid (no in-grid road neighbour to continue onto). Cars enter there and
// drive inward.

export interface RoadEntry {
  coord: Coordinates;
  entryPort: Port; // the edge the vehicle enters through (an open road port)
  busOnly?: boolean; // only buses may spawn/route here (a bus-only street's open end)
}

const EDGES: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

export function roadEntries(level: Level, width: number, height: number): RoadEntry[] {
  const out: RoadEntry[] = [];
  for (const [id, tile] of Object.entries(level)) {
    if (!tile.road || tile.road.length === 0) continue;
    const [xs, ys] = id.split(",").map(Number);
    const coord = { x: xs, y: ys };
    for (const port of EDGES) {
      // Which classes could ENTER through this port: a car needs a car-usable
      // lane from it, a bus any lane (so a bus-only street's open end is a
      // BUS entry — previously it produced no entry at all and buses never
      // spawned on bus-only border streets).
      const carCan = exitsForCar(tile.road, port).length > 0;
      const busCan = usableExits(tile.road, port, "bus").length > 0;
      if (!carCan && !busCan) continue;
      const n = neighborCoord(coord, port)!;
      const offGrid = n.x < 0 || n.y < 0 || n.x >= width || n.y >= height;
      const neigh = level[getCoordinatesId(n)];
      // An entry is an OPEN end: no upstream lane of ANY class drives toward
      // the shared seam (the exit-toward test, not "has a lane entering from
      // it" — on a one-way road only the former holds; the latter wrongly
      // flagged every interior one-way tile as an open spawn edge).
      const back = oppositePort(port);
      const feedsAny =
        !offGrid && !!neigh?.road && neigh.road.some(l => l.to.includes(back));
      if (!offGrid && feedsAny) continue;
      out.push(carCan ? { coord, entryPort: port } : { coord, entryPort: port, busOnly: true });
    }
  }
  // Deterministic order (sorted by coord then port) so seeded spawns are stable.
  out.sort((a, b) => {
    const ka = `${a.coord.x},${a.coord.y},${a.entryPort}`;
    const kb = `${b.coord.x},${b.coord.y},${b.entryPort}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

// Off-map openings a car can drive OUT of: an edge port some car lane of the tile
// exits toward (`to` includes it) that leads off the grid (or to a tile with no
// road continuing the move). The mirror of roadEntries — for a two-way road the
// two coincide, but on a one-way road the inbound (entry) and outbound (exit)
// openings differ, so route destinations must be these. The `entryPort` field
// carries the EXIT port (RoadEntry shape is reused). Used as planRoute targets.
export function roadExits(level: Level, width: number, height: number): RoadEntry[] {
  const out: RoadEntry[] = [];
  for (const [id, tile] of Object.entries(level)) {
    if (!tile.road || tile.road.length === 0) continue;
    const [xs, ys] = id.split(",").map(Number);
    const coord = { x: xs, y: ys };
    for (const port of EDGES) {
      // Which classes can DRIVE OUT via this port: cars via a car lane, buses
      // via any lane (incl. busTo) — so a bus-only street's open end is a BUS
      // routing destination (previously missing: planRoute could never target
      // it and buses ignored bus-only streets at the map edge).
      const carOut = tile.road.some(l => l.kind !== "bus" && l.to.includes(port));
      const busOut = tile.road.some(
        l => l.to.includes(port) || (l.busTo ?? []).includes(port),
      );
      if (!carOut && !busOut) continue;
      const n = neighborCoord(coord, port)!;
      const offGrid = n.x < 0 || n.y < 0 || n.x >= width || n.y >= height;
      const neigh = level[getCoordinatesId(n)];
      const neighHasRoad = !offGrid && !!neigh?.road && neigh.road.length > 0;
      const back = oppositePort(port);
      const continuesCar = neighHasRoad && exitsForCar(neigh!.road, back).length > 0;
      const continuesBus =
        neighHasRoad && usableExits(neigh!.road, back, "bus").length > 0;
      // An exit for a class: it can drive out AND the road genuinely ends for
      // it there (off-grid, or a dead end with no continuing road). A car never
      // exits toward an in-grid bus-only road (it would despawn into it).
      const carExit = carOut && (offGrid || (!continuesCar && !neighHasRoad));
      const busExit = busOut && (offGrid || (!continuesBus && !neighHasRoad));
      if (carExit) out.push({ coord, entryPort: port });
      else if (busExit) out.push({ coord, entryPort: port, busOnly: true });
    }
  }
  out.sort((a, b) => {
    const ka = `${a.coord.x},${a.coord.y},${a.entryPort}`;
    const kb = `${b.coord.x},${b.coord.y},${b.entryPort}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

// --- Cars ---------------------------------------------------------------------

export interface RoadSegment {
  coord: Coordinates;
  entryPort: Port;
  exitPort: Port | null;
}

export interface Car {
  id: string;
  kind: VehicleKind; // car | truck | semi — drives length and render segments
  speed: number; // cruise (max) speed, tiles/sec — the velocity cap
  velocity: number; // current speed, ramps between 0 and `speed`
  accel: number; // acceleration rate, tiles/sec²
  brake: number; // deceleration rate, tiles/sec²
  length: number; // total body length in tiles (the lane span; from the spec)
  path: RoadSegment[];
  headIndex: number;
  headProgress: number; // 0..1 within path[headIndex]
  // Seconds of reaction time still to elapse before a stopped car may roll once
  // the way ahead has cleared. Re-armed to REACTION_DELAY whenever the car is
  // fully stopped, so a released queue launches staggered instead of as a block.
  launchTimer: number;
  // Route plan: which exit arm to take at each junction along the BFS path.
  routePlan: RouteTurn[];
  // Index into routePlan of the next unconsumed junction turn.
  routeStep: number;
  // How long this car has been stopped (seconds). Used by the arbiter's
  // starvation guard so a low-priority car on a busy main road eventually gets a
  // gap.
  waitSeconds: number;
  // Seconds this car has spent held specifically by a CLOSED CROSSING ahead (not
  // by a car queued in front of it, nor by an occupied junction). Accrues while
  // the crossing is the binding constraint and the car can't roll; resets to 0
  // once the car is moving freely again. The objective layer scores patience off
  // this — the longest a single car waited for a train to clear the crossing.
  waitedSec: number;
  // True once any part of this car's body has been on a level-crossing tile, so
  // the throughput counter (carsDelivered) only counts cars that actually used a
  // crossing — not cars that drove a road with no rail on it.
  crossedCrossing: boolean;
  // Continuous lateral lane position: 0 = rightmost (kerb-side), N-1 = innermost
  // (centre-adjacent). A FLOAT so a lane change eases across (e.g. 1.4 = mostly in
  // lane 1, drifting toward 2); `Math.round` gives the lane the car logically
  // occupies for following/conflict. Set at spawn; eased toward `targetLane`.
  laneIndex: number;
  // The integer lane the car wants to be in, recomputed each tick: a lane that
  // survives the next lane drop (merge) and that permits its next turn (F). The
  // car eases `laneIndex` toward this when the adjacent lane is clear (G).
  targetLane: number;
  // Current lateral speed (lanes/sec, signed) — how fast `laneIndex` is changing.
  // Drives the body lean: a coupler a distance behind the head sits where the car
  // was a moment ago, so its lateral position lags by `laneVel · (arc / speed)`,
  // angling the body into the change instead of sliding flat.
  laneVel: number;
  // Driver behaviour: an `overtaker` will pull into the lane to its left to pass a
  // slower leader when held below cruise; a disciplined driver (false) never does.
  overtaker: boolean;
  // Seconds spent held below cruise speed by a car ahead (resets when free). Once
  // it passes the patience threshold an overtaker looks to pass.
  heldSec: number;
  // Overtake state machine: "none" → "passing" (pulled into the left lane to get
  // past `overtakeOf`) → "returning" (back to `overtakeHomeLane` once clear ahead).
  overtakePhase: "none" | "passing" | "returning";
  overtakeOf: string | null; // id of the car being passed
  overtakeHomeLane: number; // lane to return to after the pass
  // The map-edge entry this car is heading toward (set at spawn via planRoute).
  // Null when the BFS found no path or no targets exist.
  destination: RoadEntry | null;
  // After crossing a junction, the exit-arm lane the vehicle should settle into so
  // it MATCHES the lane its movement implies (turn-aware, set from junctionExitLane
  // when lane counts differ across the cross). desiredLane eases toward this while
  // it's set — unless a nearer junction needs a different turn lane — and it clears
  // once reached. Null when the vehicle has no pending exit-lane to match.
  pendingExitLane: number | null;
}

// Driver behaviour tuning (same-direction overtaking).
const OVERTAKE = {
  // Fraction of drivers that will overtake (the rest stay disciplined in lane).
  fraction: 0.4,
  // Seconds held below cruise by a leader before an overtaker pulls out.
  patience: 1.2,
  // Min speed advantage over the leader (as a fraction of cruise) worth passing.
  gainFrac: 0.08,
  // Clear tiles needed ahead in the passing lane to commit to a pass.
  window: 2.5,
};

// A car sampled as its two anchor points along the recent path (front toward the
// direction of travel, rear behind), mirroring the train UnitChord so the
// renderer draws + angles it the same way.
export interface CarSample {
  coord: Coordinates;
  entryPort: Port;
  exitPort: Port | null;
  t: number; // 0..1 progress within the tile segment
  // Continuous lateral lane position at this coupler (set by sample()). Lags the
  // head during a lane change so the rendered body angles into it. Optional so
  // internal sampleAtArc callers that don't render can ignore it.
  lanePos?: number;
}
// One rendered body box of a vehicle (a car/truck is one unit; a semi is two:
// cab + trailer). `front`/`rear` are its two ends sampled along the car's path
// so the box angles along the road and articulates on curves; `lengthTiles` is
// its length and `part` the render style hint.
export interface CarUnit {
  front: CarSample;
  rear: CarSample;
  lengthTiles: number;
  part: VehicleSegment["part"];
}
export interface CarChord {
  id: string;
  units: CarUnit[];
  laneIndex: number;
  laneCount: number;
  destination: RoadEntry | null;
}

// Closed ⇔ this tile is a crossing reserved/occupied by a train. Supplied by the
// caller (simulation.ts) from the existing rail reservation/occupancy — no new
// interlocking lives here.
export type CrossingClosed = (tileId: string) => boolean;

// A per-tick snapshot of how well the roads are flowing through the crossings,
// assembled from the live cars. Pure data the objective layer scores: the worst
// current single-car wait (the live tension readout), the cumulative wait across
// all cars (a smoothness aggregate), and how many crossing-using cars have made
// it through and despawned. Deterministic — derived only from car state + dt.
export interface RoadFrame {
  // The longest a single live car has currently been held by a closed crossing
  // (resets per car when it gets moving), in seconds.
  maxCarWaitSec: number;
  // Sum of every live car's current crossing-wait, in seconds — a snapshot, not a
  // running integral, so it falls as cars are released.
  carWaitTotalSec: number;
  // Cars that used a level crossing and have since despawned at a map edge.
  carsDelivered: number;
}

export interface RoadSimConfig {
  level: Level;
  width: number;
  height: number;
  seed?: number;
  // Mean seconds between spawn attempts at each entry (a Poisson-ish gate via the
  // seeded RNG). Smaller = busier roads.
  spawnInterval?: number;
  // Car cruise speed in tiles/sec and base (car) body length in tiles. Trucks
  // and semis scale their length from `carLength` via vehicleSpec(). Defaults
  // below.
  carSpeed?: number;
  carLength?: number;
  // Per-car preferred-speed variation, as a fraction of `carSpeed`. Each spawned
  // car draws its cruise speed uniformly from
  // `[carSpeed*(1-speedSpread), carSpeed*(1+speedSpread)]` using the seeded RNG,
  // so some cars are naturally faster than others (a faster car then catches the
  // slower one ahead and follows it — the gap cap prevents overtaking, so the
  // slowest car sets the platoon pace). `0` makes every car the same speed (the
  // original behaviour). Default below is a small, subtle spread.
  speedSpread?: number;
  // Relative spawn weights per vehicle kind. Default `{ car: 1 }` → all cars.
  mix?: TrafficMix;
  // Fraction of drivers that will overtake a slow leader (same-direction, into
  // the lane to their left). The rest stay disciplined in lane. Default 0.4.
  overtakeFraction?: number;
  // Cap so a busy junction of entries can't spawn an unbounded number of cars.
  // A function is read live on every spawn attempt, so a game setting can change
  // the cap mid-game without removing cars already on the road.
  maxCars?: number | (() => number);
  // Spawn only from these entries instead of every map-edge road opening. Used to
  // make a single-lane road effectively one-way (spawn from one end only), which
  // avoids a head-on deadlock on a shared straight road until a direction model
  // exists. Defaults to all auto-detected entries.
  spawnEntries?: RoadEntry[];
  // Fill-fast mode: instead of one spawn per `spawnInterval`, attempt spawns at
  // every entry on each tick until the cap is reached (each placement still gated
  // by `clearAhead`, so cars never stack — they fill only as fast as the road
  // physically clears the entry edge). Used by the rendered game so the density
  // slider reaches its target quickly; the unit-test sims leave it off and keep
  // the deterministic per-interval trickle. Default false.
  fillFast?: boolean;
}

export interface RoadSim {
  step(dt: number, closed: CrossingClosed): void;
  // The crossing-flow snapshot for the objective layer (see RoadFrame).
  frame(): RoadFrame;
  cars(): {
    id: string;
    tileId: string;
    headIndex: number;
    headProgress: number;
    speed: number; // this car's preferred (cruise) speed — varies car-to-car
    velocity: number; // its current speed (capped by the leader when following)
    laneIndex: number; // continuous lateral lane position (float during a change)
    targetLane: number; // the integer lane it is easing toward
    overtakePhase: Car["overtakePhase"]; // "none" | "passing" | "returning"
  }[];
  // Each live car sampled as its rendered body units (one per segment) for the
  // renderer: a car/truck has one, a semi has a cab + a trailer.
  sample(): CarChord[];
  // The remaining route of the live car `carId`, as the ordered tile segments
  // from its current head tile to the map edge it is heading for. `[]` when no
  // such car exists. Pure/derived — the future path isn't stored, it is replayed
  // forward by following the car's `routePlan` at junctions (the same turns the
  // car will actually take) and the single straight/curve exit elsewhere. Used by
  // the renderer to draw a debug "where is this car going" overlay.
  routePath(carId: string): RoadSegment[];
  // Each live car's body sampled as occupancy points along its whole length —
  // the SAME points the following/conflict gates use internally: the tile id, the
  // integer lane the car occupies, the port it entered that tile through (so
  // same-direction bodies are comparable), and the progress `t` within the tile.
  // Exposed so a test can assert no two same-lane bodies physically overlap on any
  // tick of a deterministic run (a swept-body regression guard).
  bodies(): {
    id: string;
    points: { tileId: string; lane: number; entry: Port; t: number; lanePos: number }[];
  }[];
  // Road-junction tiles a car body currently occupies, keyed by tile id → car id.
  // There is no stored reservation for cars (unlike trains): occupancy is derived
  // live from car positions. The junction interlock keeps this at most one car per
  // junction tile, so the map is effectively tileId → the car that owns it now.
  // Exposed purely so the renderer can highlight a held junction in debug mode.
  junctionOccupancy(): Record<string, string>;
  // The current light an approach `arm` shows at the signalised road junction
  // `tileId` (green/amber/red), or null when that junction is not signalised. The
  // renderer reads this per arm to colour the signal heads.
  signalAspect(tileId: string, arm: Port, cls?: VehicleClass): SignalAspect | null;
  // The live signal of a road junction (mode + bus-priority), or null if the tile
  // is not a road junction. Used for the mode chip and to know whether to render
  // signal heads at all.
  signalOf(tileId: string): JunctionSignal | null;
  // Cycle a road junction's signal mode live in play (off → two-phase →
  // two-phase+bus → round-robin → round-robin+bus → off). Returns the new signal,
  // or null if the tile is not a road junction.
  cycleSignal(tileId: string): JunctionSignal | null;
}

const DEFAULT_SPAWN_INTERVAL = 2.5;
const DEFAULT_CAR_SPEED = 0.6;
// Default body length in tiles. Matches the rendered ~46px sprite at the 200px
// tile size (game.ts passes an exact value derived from CAR_SPRITE_PX); kept in
// sync so the simulated body never out-sizes the visible car.
const DEFAULT_CAR_LENGTH = 0.23;
const DEFAULT_MAX_CARS = 40;
// Default per-car preferred-speed spread (fraction of carSpeed). A subtle ±25%
// so the road feels alive — some cars cruise a little quicker and bunch up behind
// slower ones into platoons — without any car being conspicuously fast or slow.
const DEFAULT_SPEED_SPREAD = 0.25;
// Acceleration / braking rates (tiles/sec²). Cars ramp their velocity toward the
// cruise speed instead of snapping to it in one tick, and brake smoothly to the
// next stop line — the same model the train sim uses (simulation.ts). Tuned for a
// small, quick effect: from rest to a 0.5 tiles/sec cruise in ~0.5s, and a ~20px
// braking nose-down approaching a queue or closed gate, rather than a hard stop.
const DEFAULT_CAR_ACCEL = 1.0;
const DEFAULT_CAR_BRAKE = 1.2;

// Bumper gap a car keeps behind the obstacle ahead (the next car's rear, or an
// oncoming car's nose), in tiles. Tight so a queue at a closed crossing packs
// nearly nose-to-tail instead of the old whole-tile occupancy gate leaving ~a
// full tile of air between stopped cars. ~6px at tileSize 200. NB: the body
// length must match the rendered sprite (see CAR_SPRITE_PX in game.ts) or this
// gap sits on top of invisible extra body and looks far larger on screen.
// NB: this is measured bumper-to-bumper along the centerline arc, so on a curve
// the sprite corners pinch closer than the centerline gap — keep a touch of slack
// so following cars don't visibly touch through a bend.
const CAR_GAP = 0.06;
// Lane-change (lateral) motion. A car eases sideways toward its target lane on
// an S-curve: lateral velocity ramps up and back down under a bounded lateral
// acceleration (LANE_CHANGE_ACCEL) instead of snapping to full speed, capped at
// LANE_CHANGE_RATE lanes/sec at cruise. The acceleration limit is what makes a
// pull-out/return for an overtake glide (ease-in then ease-out) the same way a
// lane-count taper does, rather than kinking sideways at constant velocity. A
// car only commits to entering the next integer lane when that lane has at least
// LANE_CHANGE_GAP tiles of clear road both ahead of and behind it (gap
// acceptance) — so a lane change never overlaps another car. LANE_SETTLE is how
// close (in lanes) counts as "arrived".
const LANE_CHANGE_RATE = 2.2;
// Max lateral acceleration (lanes/sec²) for the lane-change S-curve. Tuned so the
// ramp-up/down each take ~LANE_CHANGE_RATE / LANE_CHANGE_ACCEL ≈ 0.4s, long
// enough to read as an eased glide but short enough that a one-lane change still
// finishes briskly.
const LANE_CHANGE_ACCEL = 5.5;
const LANE_CHANGE_GAP = 0.18;
const LANE_SETTLE = 1e-3;
// Lateral separation (in lanes) below which two same-direction bodies physically
// CLIP — a car's rendered width (~20px) over the lane width (~28px) is ~0.71 lane,
// so bodies whose lane centres are closer than this overlap sideways. Used by the
// swept-body overlap-recovery clamp in clearAhead: a car that ends up within this
// of another (a half-finished overtake pull-out/return, or two cars merged onto
// one lane) is held its following gap behind that body so the overlap can't
// persist. Set at the true body-width ratio so steady traffic a full lane apart is
// never gated, but anything closer is — this is also the threshold the swept-body
// test asserts against.
const CLIP_LANES = 0.72;
// How many tiles ahead a car looks for the junction it must be lane-sorted for,
// so it starts moving into its turn lane with room to spare (sub-project F).
const TURN_LANE_LOOKAHEAD = 4;
// How far ahead (in tiles) a car scans for the next car / closed crossing. Cars
// are short and slow, so a couple of tiles of look-ahead is plenty.
const CAR_LOOKAHEAD = 2;
// How long (seconds) a car honours "don't block the box" while held at a
// junction entry before it gives up and rolls in anyway. On a saturated ring
// every box-keep-clear hold waits on space that is itself behind another hold —
// the patience override breaks that circular wait.
const BOX_KEEP_CLEAR_PATIENCE = 4;
// A bound moving faster than this (tiles/sec; cruise is ~0.6) counts as a
// ROLLING queue for the box keep-clear rule — follow it through the junction.
// Deliberately strict (~40% of cruise): a COMPRESSING queue still creeps at
// low speed, and following a creeping leader strands the follower inside the
// box when the queue stalls right past it (the observed two-junction ring
// gridlock: a bus dies mid-box, its corridor never drains). Only a properly
// flowing platoon is worth following through.
const ROLLING_QUEUE_EPS = 0.25;
// Reaction time (seconds) a stopped car waits before it starts moving once the
// way ahead clears — the "wait a beat after the car in front pulls away" delay.
// This staggers a queue's release so cars spread out (e.g. don't bunch up nose-
// to-tail into a curve) instead of accelerating as one rigid block.
const REACTION_DELAY = 0.6;
// Below this clear distance (tiles) a car counts as fully stopped — it can't take
// a meaningful step, so it (re)arms its launch reaction timer.
const STOP_EPS = 1e-3;
// Arc spacing (tiles) at which a vehicle's body is sampled into occupancy points.
// A long trailer can span a whole junction tile with neither end on it; sampling
// the *whole* body at this step guarantees every tile any part of the vehicle
// covers gets at least one point, so a trailer straddling a crossing blocks cars
// from entering it. Cars are few, so the extra points are cheap.
const BODY_SAMPLE_STEP = 0.25;

export function createRoadSim(config: RoadSimConfig): RoadSim {
  const { level, width, height } = config;
  const rng = makeRng(config.seed ?? 1);
  // A second, independent RNG stream for route planning. Keeping routing off the
  // main `rng` means the per-car kind/speed draw sequence is unaffected by how
  // many routing choices a level offers — so seeded spawn/platoon behaviour stays
  // stable whether a map is a single straight or a branching junction network.
  const routeRng = makeRng((config.seed ?? 1) ^ 0x9e3779b9);
  // A third independent stream for driver-behaviour (overtaker?) draws, so adding
  // it doesn't shift the seeded speed/kind or route sequences.
  const driverRng = makeRng((config.seed ?? 1) ^ 0x517cc1b7);
  const overtakeFraction = Math.max(0, Math.min(1, config.overtakeFraction ?? OVERTAKE.fraction));
  const spawnInterval = config.spawnInterval ?? DEFAULT_SPAWN_INTERVAL;
  const fillFast = config.fillFast ?? false;
  const carSpeed = config.carSpeed ?? DEFAULT_CAR_SPEED;
  const carLength = config.carLength ?? DEFAULT_CAR_LENGTH;
  const speedSpread = Math.max(0, config.speedSpread ?? DEFAULT_SPEED_SPREAD);
  const maxCarsCfg = config.maxCars;
  const maxCarsOf = (): number =>
    typeof maxCarsCfg === "function" ? maxCarsCfg() : maxCarsCfg ?? DEFAULT_MAX_CARS;
  const mix = config.mix ?? { car: 1 };

  const entries = config.spawnEntries ?? roadEntries(level, width, height);
  // BFS routing targets: the off-map openings a car can drive OUT of. On one-way
  // roads these differ from the spawn entries, so a car can be routed to an
  // outbound arm that is not itself a spawn point.
  const allMapExits = roadExits(level, width, height);

  // Pre-compute the conflict matrix for every road-junction tile once, so
  // clearAhead doesn't rebuild it every frame.
  const junctionConflicts = new Map<string, Set<string>>();
  for (const [id, tile] of Object.entries(level)) {
    if (isRoadJunction(tile.road)) {
      junctionConflicts.set(id, buildConflictMatrix(tile.road!));
    }
  }
  const arbiter: JunctionArbiter = fcfsWithPriorityArbiter;

  // Per-junction traffic-signal controllers (#38). One for EVERY road junction so
  // a junction can be cycled from "off" to a timed mode live in play; an "off"
  // controller reports green for all arms, so the gate below is a no-op there. The
  // arms are the ports the junction's lanes touch (each is an approach). The phase
  // clock advances on sim time in step(), fed the set of arms with an approaching
  // bus for transit signal priority.
  const signals = new Map<string, JunctionSignalController>();
  for (const [id, tile] of Object.entries(level)) {
    if (isRoadJunction(tile.road)) {
      signals.set(
        id,
        createJunctionSignal(approachPortsOf(tile.road), tile.signal ?? { mode: "off" }),
      );
    }
  }
  const EMPTY_ARMS: ReadonlySet<Port> = new Set();

  // Do two movements merging onto the same exit arm LAND on the same lane
  // (junctionExitLane, class-aware)? Same-lane mergers can collide and must
  // coordinate; different-lane mergers (a bus onto the bus lane beside a car
  // onto the car lane) stay fully concurrent.
  function mergeLandsSameLane(
    junctionId: string,
    a: { entryArm: Port; exitArm: Port; lane: number; cls: VehicleClass },
    b: { entryArm: Port; exitArm: Port; lane: number; cls: VehicleClass },
  ): boolean {
    const jCoord = parseJunctionCoord(junctionId);
    const n = neighborCoord(jCoord, a.exitArm);
    if (!n) return false;
    const exitRoad = level[getCoordinatesId(n)]?.road;
    if (!exitRoad) return false;
    const road = level[junctionId]?.road;
    const approach = oppositePort(a.exitArm);
    const la = junctionExitLane(road, a.entryArm, Math.round(a.lane), a.exitArm, exitRoad, approach, a.cls);
    const lb = junctionExitLane(road, b.entryArm, Math.round(b.lane), b.exitArm, exitRoad, approach, b.cls);
    return la === lb;
  }

  // The lane-aware conflict predicate for one junction, used by the arbiter.
  // Conflicting movements EXCLUDE each other (the later one holds at the entry):
  //  • different entry + different exit — genuinely crossing streams: the
  //    pre-computed geometric matrix decides (port pairs suffice).
  //  • SAME entry — two vehicles side by side on one approach: they cross only
  //    when their lateral order inverts (an inner lane turning across a
  //    kerb-ward lane's straight/left path — e.g. a car's right turn through a
  //    straight-going bus on the kerb bus lane). Pure lane/turn-rank maths.
  //  • SAME exit (a merge) is NOT a conflict: merging is yield-and-slot, not
  //    exclusion — the later vehicle trails the earlier one through the merge
  //    point (see clearAhead's per-body merge clamp), so a feed road zippers
  //    into a busy loop instead of both streams blocking a tile early.
  const junctionConflictFns = new Map<string, ConflictFn>();
  function junctionConflictFn(junctionId: string): ConflictFn {
    let fn = junctionConflictFns.get(junctionId);
    if (fn) return fn;
    const pairs = junctionConflicts.get(junctionId);
    fn = (a, b) => {
      if (a.entryArm === b.entryArm) {
        return sameEntryConflict(a.entryArm, a.exitArm, Math.round(a.lane), b.exitArm, Math.round(b.lane));
      }
      if (a.exitArm === b.exitArm) return false; // merge: handled by trailing
      return (
        pairs?.has(
          conflictKey(
            { entry: a.entryArm, exit: a.exitArm },
            { entry: b.entryArm, exit: b.exitArm },
          ),
        ) ?? false
      );
    };
    junctionConflictFns.set(junctionId, fn);
    return fn;
  }

  const cars: Car[] = [];
  let nextId = 0;
  let spawnClock = 0;
  // Rotates the preferred spawn lane each successful spawn so multi-lane entries
  // fill their lanes evenly (deterministic, no RNG — keeps seeded order stable).
  let spawnLaneRot = 0;
  // Cars that crossed ≥1 level crossing and then drove off the map. The road
  // layer's throughput tally, surfaced via frame() for the objective layer.
  let carsDelivered = 0;

  // Draw a vehicle kind from the per-level mix using the seeded RNG, so spawns
  // stay deterministic. Kinds with no/zero weight never appear; an empty mix
  // falls back to a car.
  function pickKind(): VehicleKind {
    const weighted = (["car", "truck", "semi", "bus"] as VehicleKind[])
      .map(k => [k, Math.max(0, mix[k] ?? 0)] as const)
      .filter(([, w]) => w > 0);
    const total = weighted.reduce((s, [, w]) => s + w, 0);
    if (total <= 0) return "car";
    let r = rng() * total;
    for (const [k, w] of weighted) {
      r -= w;
      if (r < 0) return k;
    }
    return weighted[weighted.length - 1][0];
  }

  const tileIdOf = (c: Car): string => getCoordinatesId(c.path[c.headIndex].coord);

  // Parse a "x,y" tile id back to a Coordinates object.
  function parseJunctionCoord(id: string): Coordinates {
    const [x, y] = id.split(",").map(Number);
    return { x, y };
  }

  // Look up which exit arm this car's route plan prescribes at `coord` (without
  // consuming the step). Returns null when no turn for that junction exists.
  function carExitAt(car: Car, coord: Coordinates): Port | null {
    const jId = getCoordinatesId(coord);
    for (let i = car.routeStep; i < car.routePlan.length; i++) {
      if (car.routePlan[i].junctionId === jId) return car.routePlan[i].exitArm;
    }
    return null;
  }

  // Same as carExitAt, but also advances routeStep past this junction once found.
  function carExitAtConsume(car: Car, coord: Coordinates): Port | null {
    const jId = getCoordinatesId(coord);
    const idx = car.routePlan.findIndex((t, i) => i >= car.routeStep && t.junctionId === jId);
    if (idx < 0) return null;
    car.routeStep = idx + 1;
    return car.routePlan[idx].exitArm;
  }

  // The integer lane the car logically occupies (its continuous position rounded).
  function laneOf(car: Car): number {
    return Math.round(car.laneIndex);
  }

  // The lane-access class of a vehicle: a bus may use (and prefers) bus lanes;
  // every other kind is confined to car lanes.
  function clsOf(car: Car): VehicleClass {
    return vehicleClassOf(car.kind);
  }

  // The lane the car WANTS to be in on its current tile (sub-projects F + G):
  //  • Merge (G): if the next tile in its travel direction has fewer lanes than
  //    its current lane index, aim for the innermost lane that survives the drop,
  //    so it merges across BEFORE the lane ends instead of queueing at the taper.
  //  • Turn lane (F): if the next tile is a junction, aim for a lane whose `to`
  //    permits the exit the car's route takes there (nearest such lane to where
  //    it already is). With dedicated turn lanes a left-turner moves into the
  //    turn lane in advance; with no per-lane restriction every lane qualifies
  //    and it stays put.
  // Otherwise hold the current lane. Result is clamped to the current tile's lanes.
  // The first road junction within `maxTiles` ahead of the car along its straight
  // path, and the port it will enter that junction through. Walks the car's
  // committed exit then the straight continuation of each tile; stops at the first
  // junction (where the car has a turn choice). Null if none is near.
  function junctionAhead(
    startCoord: Coordinates,
    startEntry: Port,
    startExit: Port | null,
    maxTiles: number,
    cls: VehicleClass = "car",
  ): { coord: Coordinates; entry: Port } | null {
    let coord = startCoord;
    let entry = startEntry;
    let exit = startExit ?? roadExitPort(level, coord, entry, cls);
    for (let k = 0; k < maxTiles; k++) {
      if (exit == null) return null;
      const n = neighborCoord(coord, exit);
      if (!n) return null;
      const nTile = level[getCoordinatesId(n)];
      if (!nTile?.road?.length) return null;
      const nEntry = oppositePort(exit);
      if (isRoadJunction(nTile.road)) return { coord: n, entry: nEntry };
      coord = n;
      entry = nEntry;
      exit = roadExitPort(level, coord, entry, cls); // straight continuation
    }
    return null;
  }

  function desiredLane(car: Car): number {
    const head = car.path[car.headIndex];
    const tile = level[getCoordinatesId(head.coord)];
    const cls = clsOf(car);
    const curCount = laneCount(tile?.road, head.entryPort);
    const cur = laneOf(car);
    if (curCount <= 1) return 0;
    // On a junction tile the car is committed to its turn — its approach-lane
    // index maps to the exit through the movement, not laterally. Don't merge or
    // re-sort here (the exit arm being narrower must not drag the car sideways
    // mid-turn); lateral positioning is an approach-tile concern.
    if (isRoadJunction(tile?.road)) return clampLane(cur, curCount);

    // (G) Lane drop on the immediately next tile — our lane doesn't continue, so
    // merge to the innermost surviving lane (takes precedence: it's the urgent one).
    const exit = head.exitPort ?? roadExitPort(level, head.coord, head.entryPort, cls);
    if (exit != null) {
      const nCoord = neighborCoord(head.coord, exit);
      const nTile = nCoord ? level[getCoordinatesId(nCoord)] : undefined;
      if (nCoord && nTile?.road?.length) {
        const nCount = laneCount(nTile.road, oppositePort(exit));
        if (nCount > 0 && cur > nCount - 1) return clampLane(nCount - 1, curCount);
      }
    }

    // Overtaking (G+): while passing aim for the lane left of home; while
    // returning aim back toward the KERB-most legal lane (keep-right discipline),
    // not merely the lane we pulled out of — so on a 3-lane road a pass from the
    // middle lane tucks all the way back to the kerb instead of loitering inner.
    // Above turn-lane sorting, but the merge/junction guards above still win
    // (safety). considerOvertake drives the phase.
    if (car.overtakePhase === "passing") return clampLane(car.overtakeHomeLane + 1, curCount);
    if (car.overtakePhase === "returning")
      return clampLane(kerbMostLane(tile?.road, head.entryPort, cls), curCount);

    // (F) A junction is coming up — get into a lane that permits the turn the
    // route takes there, as early as a few tiles out so there's room to change.
    const ahead = junctionAhead(
      head.coord,
      head.entryPort,
      head.exitPort ?? roadExitPort(level, head.coord, head.entryPort, cls),
      TURN_LANE_LOOKAHEAD,
      cls,
    );
    if (ahead) {
      const jTile = level[getCoordinatesId(ahead.coord)];
      const myExit = carExitAt(car, ahead.coord);
      if (jTile?.road && myExit != null) {
        // Lanes that permit the upcoming turn for this vehicle class. A bus may
        // turn from a bus lane too, so this can include one; a car never can.
        const allow = lanesAllowingExitFor(jTile.road, ahead.entry, myExit, cls);
        if (allow.length > 0) {
          // A bus prefers a bus lane among the permitted lanes; otherwise pick the
          // nearest permitted lane to where we already are.
          const busAllowed = allow.filter(l =>
            busLaneIndices(jTile.road, ahead.entry).includes(l),
          );
          const pool = cls === "bus" && busAllowed.length > 0 ? busAllowed : allow;
          // Pick the nearest permitted lane (a bus prefers a permitted BUS lane).
          // This RETURNS even when we're already on a permitted lane (best === cur):
          // we must NOT fall through to the generic bus-lane preference below, or a
          // bus turning where the bus lane can't (e.g. a left turn off a kerb bus
          // lane) would be dragged back onto the bus lane every tick and oscillate.
          // A bus only stays on the bus lane here when the bus lane actually feeds
          // its turn (then busAllowed is non-empty and the bus lane is in `pool`).
          const best = pool.includes(cur)
            ? cur
            : pool.reduce((b, l) => (Math.abs(l - cur) < Math.abs(b - cur) ? l : b), pool[0]);
          return clampLane(best, curCount);
        }
      }
    }

    // Settle into the exit lane matched at the last junction crossing (turn-aware,
    // lane-count-aware). Skipped when a nearer junction needs a specific turn lane
    // (handled above) — that takes precedence. This is what spreads a 1→3 cross's
    // traffic into the correct exit lane rather than leaving everyone on the kerb.
    if (car.pendingExitLane != null && !ahead) {
      return clampLane(car.pendingExitLane, curCount);
    }

    // A bus with no turn to sort for prefers the bus lane on its current approach:
    // ease to the nearest bus lane (an empty list — no bus lane here — leaves it
    // in place). This is what makes a bus drift onto and ride the bus lane.
    if (cls === "bus") {
      const busLanes = busLaneIndices(tile?.road, head.entryPort);
      if (busLanes.length > 0) {
        const nearest = busLanes.reduce(
          (b, l) => (Math.abs(l - cur) < Math.abs(b - cur) ? l : b),
          busLanes[0],
        );
        return clampLane(nearest, curCount);
      }
    }
    return clampLane(cur, curCount);
  }

  function clampLane(lane: number, count: number): number {
    return Math.max(0, Math.min(count - 1, lane));
  }

  // The lane a freshly-spawned car should prefer so it STARTS in the turn lane for
  // its first junction (F) — avoiding a needless lane swap on the approach (and
  // the gridlock two cars wanting to swap into each other's lane would cause).
  // -1 = no preference (single lane, no junction near, or no per-lane restriction).
  function preferredSpawnLane(
    coord: Coordinates,
    entry: Port,
    exit: Port | null,
    routePlan: RouteTurn[],
    entryLaneCount: number,
  ): number {
    if (entryLaneCount <= 1) return -1;
    const ahead = junctionAhead(coord, entry, exit, TURN_LANE_LOOKAHEAD);
    if (!ahead) return -1;
    const jTile = level[getCoordinatesId(ahead.coord)];
    const turn = routePlan.find(t => t.junctionId === getCoordinatesId(ahead.coord));
    if (!jTile?.road || !turn) return -1;
    const allow = lanesAllowingExit(jTile.road, ahead.entry, turn.exitArm);
    if (allow.length === 0) return -1;
    // Only steer to a specific lane when the movement is a DEDICATED turn lane —
    // i.e. restricted to a subset of the approach's car lanes. When every lane
    // permits the move (an unrestricted junction where any lane can turn), there
    // is no turn lane to pre-sort into, so give no preference and let the rotating
    // spawn fill all lanes evenly (otherwise every car piles into lane 0 and the
    // multi-lane road drives like a single lane).
    if (allow.length >= carLaneIndices(jTile.road, ahead.entry).length) return -1;
    return allow[0];
  }

  // Is the integer lane `lane` clear of same-direction cars next to us on the same
  // tile (gap acceptance for a lane change)? Considers only cars on our head tile
  // travelling the same way; a car is "alongside" (blocking) unless it sits a full
  // LANE_CHANGE_GAP ahead of our nose or behind our tail.
  function laneClearForChange(car: Car, lane: number): boolean {
    const head = car.path[car.headIndex];
    const headId = getCoordinatesId(head.coord);
    const myFront = car.headProgress;
    const myRear = car.headProgress - car.length;
    for (const o of cars) {
      if (o === car) continue;
      const oh = o.path[o.headIndex];
      if (getCoordinatesId(oh.coord) !== headId) continue;
      if (oh.entryPort !== head.entryPort) continue; // same travel direction only
      if (laneOf(o) !== lane) continue;
      const oFront = o.headProgress;
      const oRear = o.headProgress - o.length;
      const clearAheadOfMe = oRear > myFront + LANE_CHANGE_GAP;
      const clearBehindMe = oFront < myRear - LANE_CHANGE_GAP;
      if (!clearAheadOfMe && !clearBehindMe) return false;
    }
    return true;
  }

  // Ease the car sideways toward its target lane (G). Only crosses into the next
  // integer lane when that lane is clear; otherwise it holds its current lateral
  // position and waits for a gap. Called once per car per tick.
  function updateLateral(car: Car, dt: number): void {
    // Once the vehicle has settled into the exit lane matched at the last junction,
    // drop the pending target so normal lane logic resumes.
    if (car.pendingExitLane != null && laneOf(car) === car.pendingExitLane) {
      car.pendingExitLane = null;
    }
    // Confine the vehicle to the lanes its class may use: snap the desired lane to
    // the nearest usable lane so a car's merge/overtake/turn target never lands it
    // on a bus lane (a bus may land on either). A no-op on roads with no bus lanes.
    const head = car.path[car.headIndex];
    car.targetLane = nearestUsableLaneIndex(
      level[getCoordinatesId(head.coord)]?.road,
      head.entryPort,
      desiredLane(car),
      clsOf(car),
    );
    const diff = car.targetLane - car.laneIndex;
    if (Math.abs(diff) <= LANE_SETTLE && Math.abs(car.laneVel) <= LANE_SETTLE) {
      // Settled in the target lane and no residual lateral motion — pin it.
      car.laneIndex = car.targetLane;
      car.laneVel = 0;
    } else if (car.velocity <= 0.001) {
      // Stopped: don't change lanes at a standstill (you change lanes while
      // driving, not while stopped at a queue/junction). Hold the lateral position
      // and kill any residual drift; the change resumes once the car rolls again.
      car.laneVel = 0;
    } else {
      const dir = Math.sign(diff);
      // Starting from a settled lane, only begin the change once the lane we'd
      // cross into is clear (gap acceptance). Once mid-crossing (fractional
      // position) we are committed and finish — the gap was checked when we set
      // off, and the longitudinal overlap-recovery clamp in clearAhead is the
      // backstop that drops us behind any body we would otherwise slide level with.
      const atInteger = Math.abs(car.laneIndex - Math.round(car.laneIndex)) <= LANE_SETTLE;
      const blocked = atInteger && !laneClearForChange(car, Math.round(car.laneIndex) + dir);
      // Desired lateral velocity follows an S-curve motion profile: cruise at
      // LANE_CHANGE_RATE but slow down approaching the target so we arrive with
      // zero speed (the decel cap √(2·a·d) is the fastest speed from which we can
      // still brake to a stop in the remaining distance `d` under LANE_CHANGE_ACCEL).
      // If the next lane is blocked, the target velocity is 0 — we brake to a hold
      // and wait for a gap. Either way the actual velocity ramps toward the target
      // under the acceleration cap, so the lean eases in and out instead of snapping.
      const decelCap = Math.sqrt(2 * LANE_CHANGE_ACCEL * Math.abs(diff));
      const vTarget = blocked ? 0 : dir * Math.min(LANE_CHANGE_RATE, decelCap);
      const dv = vTarget - car.laneVel;
      const maxDv = LANE_CHANGE_ACCEL * dt;
      car.laneVel += Math.max(-maxDv, Math.min(maxDv, dv));
      car.laneIndex += car.laneVel * dt;
      // Discrete-step guard: never coast past the target (would oscillate). If we
      // crossed it this tick, snap onto it and kill the lateral velocity.
      if ((car.targetLane - car.laneIndex) * dir < 0) {
        car.laneIndex = car.targetLane;
        car.laneVel = 0;
      }
    }
  }

  // The car's lateral lane position at a point `arc` tiles behind its head: it
  // lags the head's `laneIndex` by the lateral distance covered while the head
  // travelled that arc, so a mid-change body angles into the new lane.
  function lanePosAt(car: Car, arc: number, sample: CarSample): number {
    const count = laneCount(level[getCoordinatesId(sample.coord)]?.road, sample.entryPort);
    const lag = car.laneVel * (arc / Math.max(car.velocity, 1e-3));
    const pos = car.laneIndex - lag;
    if (count <= 1) return 0;
    return Math.max(0, Math.min(count - 1, pos));
  }

  // The nearest car ahead in the same lane and travel direction (the leader the
  // car is following), within the look-ahead. Used to decide whether to overtake.
  function leaderAhead(car: Car): { other: Car; dist: number } | null {
    const route = forwardRoute(car);
    const myLane = laneOf(car);
    let best: { other: Car; dist: number } | null = null;
    for (const other of cars) {
      if (other === car) continue;
      for (const p of bodyPoints(other)) {
        const proj = projectPoint(route, p);
        if (!proj || proj.d < 0 || proj.opposing || proj.perpendicular) continue;
        if (p.laneIndex !== myLane) continue;
        if (!best || proj.d < best.dist) best = { other, dist: proj.d };
      }
    }
    return best;
  }

  // Is the passing lane clear enough ahead to commit to an overtake? No car in
  // `lane` within the pass window that we'd just get stuck behind again.
  function passingWindowClear(car: Car, lane: number): boolean {
    const route = forwardRoute(car);
    for (const other of cars) {
      if (other === car) continue;
      for (const p of bodyPoints(other)) {
        const proj = projectPoint(route, p);
        if (!proj || proj.d < 0 || proj.d > OVERTAKE.window) continue;
        if (proj.opposing || proj.perpendicular) continue;
        if (p.laneIndex === lane && other.speed <= car.speed) return false;
      }
    }
    return true;
  }

  // True once the car being overtaken is fully behind us (its frontmost point is
  // behind our tail) — or it has despawned. Then we can pull back in.
  function isPast(car: Car, otherId: string | null): boolean {
    if (!otherId) return true;
    const other = cars.find(c => c.id === otherId);
    if (!other) return true;
    const route = forwardRoute(car);
    let maxD = -Infinity;
    for (const p of bodyPoints(other)) {
      const proj = projectPoint(route, p);
      if (proj) maxD = Math.max(maxD, proj.d);
    }
    if (maxD === -Infinity) return true; // off our route → behind us
    return maxD < -(car.length + CAR_GAP);
  }

  // True once our nose has drawn level with the leader being passed — its
  // rear-most point is at or behind our head. Past this point we are committed:
  // aborting the pass (swerving back behind it) would be a worse manoeuvre than
  // finishing, so the abort guard only fires BEFORE we reach alongside.
  function isAlongside(car: Car, otherId: string | null): boolean {
    if (!otherId) return false;
    const other = cars.find(c => c.id === otherId);
    if (!other) return false;
    const route = forwardRoute(car);
    let minD = Infinity;
    for (const p of bodyPoints(other)) {
      const proj = projectPoint(route, p);
      if (proj) minD = Math.min(minD, proj.d);
    }
    if (minD === Infinity) return true; // off our route → already past it
    return minD <= 0;
  }

  // The kerb-most lane a car of class `cls` may legally ride on this approach —
  // the lane an overtaker returns to (keep-right discipline) once a pass is done.
  // Lane 0 is the kerb; if the kerb lane is bus-only a car's home is the lowest
  // car lane instead. Falls back to lane 0 when the road carries no usable lane.
  function kerbMostLane(road: Level[string]["road"], entry: Port, cls: VehicleClass): number {
    const usable = usableLaneIndices(road, entry, cls);
    return usable.length > 0 ? Math.min(...usable) : 0;
  }

  // Same-direction overtaking (sub-project G+). An impatient/faster driver held
  // behind a slower leader pulls into the lane to its left to pass, then returns —
  // but only when the passing lane is clear and it isn't about to need its lane
  // for a turn. Disciplined drivers never do this. Runs the small state machine.
  function considerOvertake(car: Car, dt: number): void {
    const head = car.path[car.headIndex];
    const count = laneCount(level[getCoordinatesId(head.coord)]?.road, head.entryPort);

    if (car.overtakePhase === "passing") {
      const passLane = car.overtakeHomeLane + 1;
      // Bail out if the passing lane vanished (a drop) or we've cleared the car.
      if (passLane > count - 1 || isPast(car, car.overtakeOf)) {
        car.overtakePhase = "returning";
        return;
      }
      // Gap acceptance / graceful abort: BEFORE we draw level with the leader,
      // if the passing lane is no longer clear ahead (a slower car has appeared
      // in it that we'd only get stuck behind, i.e. the gap we pulled out for has
      // closed), give up on the pass and ease back to the kerb lane rather than
      // completing a marginal manoeuvre. Once alongside/ahead of the leader we
      // are committed — finishing is safer than swerving back behind it. The
      // return is the same eased, gap-gated lateral glide (updateLateral), so an
      // abort never snaps the car's lane position.
      if (!isAlongside(car, car.overtakeOf) && !passingWindowClear(car, passLane)) {
        car.overtakePhase = "returning";
      }
      return;
    }
    if (car.overtakePhase === "returning") {
      const home = kerbMostLane(level[getCoordinatesId(head.coord)]?.road, head.entryPort, clsOf(car));
      if (Math.abs(car.laneIndex - home) <= LANE_SETTLE) {
        car.overtakePhase = "none";
        car.overtakeOf = null;
      }
      return;
    }

    // phase "none": maybe start a pass.
    if (!car.overtaker || count <= 1) {
      car.heldSec = 0;
      return;
    }
    const lead = leaderAhead(car);
    const held = car.velocity < car.speed * 0.9 && lead != null;
    car.heldSec = held ? car.heldSec + dt : 0;
    if (!held || car.heldSec < OVERTAKE.patience) return;
    if (car.speed - lead!.other.speed < carSpeed * OVERTAKE.gainFrac) return;
    // Don't pull out when a junction we must sort/turn for is close.
    if (junctionAhead(head.coord, head.entryPort, head.exitPort, TURN_LANE_LOOKAHEAD)) return;
    const passLane = laneOf(car) + 1; // overtake on the left (higher index)
    if (passLane > count - 1) return;
    // Never pass by pulling into a bus lane — cars are confined to car lanes.
    if (!carLaneIndices(level[getCoordinatesId(head.coord)]?.road, head.entryPort).includes(passLane)) return;
    if (!laneClearForChange(car, passLane) || !passingWindowClear(car, passLane)) return;
    car.overtakePhase = "passing";
    car.overtakeOf = lead!.other.id;
    car.overtakeHomeLane = laneOf(car);
    car.heldSec = 0;
  }

  // Exit port for the very first tile on the spawn path: checks the route plan
  // for a junction turn; falls back to roadExitPort for plain tiles.
  function routeAwareExitForSpawn(
    coord: Coordinates,
    entry: Port,
    plan: RouteTurn[],
    cls: VehicleClass,
  ): Port | null {
    const jId = getCoordinatesId(coord);
    const turn = plan.find(t => t.junctionId === jId);
    return turn?.exitArm ?? roadExitPort(level, coord, entry, cls);
  }

  // Return the ActiveMovements currently held by cars *inside* `junctionId`.
  function activeMovementsAt(junctionId: string): ActiveMovement[] {
    const active: ActiveMovement[] = [];
    for (const other of cars) {
      if (!bodyTileIds(other).has(junctionId)) continue;
      const seg = other.path.find(s => getCoordinatesId(s.coord) === junctionId);
      if (!seg || seg.exitPort === null) continue;
      active.push({
        carId: other.id,
        entryArm: seg.entryPort,
        exitArm: seg.exitPort,
        lane: laneOf(other),
        cls: clsOf(other),
      });
    }
    return active;
  }

  // Return WaitingCars that are stopped and about to enter `junctionId`,
  // excluding `me`.
  function waitingCarsAt(junctionId: string, me: Car): WaitingCar[] {
    const waiting: WaitingCar[] = [];
    for (const other of cars) {
      if (other === me || other.velocity > 0.001) continue;
      const head = other.path[other.headIndex];
      const exitPort = head.exitPort ?? roadExitPort(level, head.coord, head.entryPort);
      if (exitPort === null) continue;
      const nCoord = neighborCoord(head.coord, exitPort);
      if (!nCoord || getCoordinatesId(nCoord) !== junctionId) continue;
      const entryArm = oppositePort(exitPort);
      const myExit = carExitAt(other, nCoord) ?? roadExitPort(level, nCoord, entryArm, clsOf(other));
      if (myExit === null) continue;
      waiting.push({
        entryArm,
        exitArm: myExit,
        lane: laneOf(other),
        cls: clsOf(other),
        priority: level[getCoordinatesId(head.coord)]?.roadPriority ?? 0,
        waitSeconds: other.waitSeconds,
      });
    }
    return waiting;
  }

  // Tiles a car's body currently covers (head tile back to wherever its tail is).
  // The body is short (< 1 tile by default), so this is the head tile plus the
  // previous one while the head is still near the boundary it just crossed.
  function bodyTileIds(car: Car): Set<string> {
    const headDistance = car.headIndex + car.headProgress;
    const tailDistance = headDistance - car.length;
    const tailIndex = Math.max(0, Math.floor(tailDistance + 1e-9));
    const ids = new Set<string>();
    for (let i = tailIndex; i <= car.headIndex; i++) {
      const seg = car.path[i];
      if (seg) ids.add(getCoordinatesId(seg.coord));
    }
    return ids;
  }

  // The upcoming tiles on a car's route, keyed by tile id, each with `lead` (the
  // tile-distance from the car's head to that tile's *entry* edge — the head
  // tile's entry sits headProgress behind the head, so its lead is negative) and
  // `entry` (the port the car enters that tile through). First occurrence wins,
  // so a tile a loop revisits is measured at its nearest pass. Used to project
  // other cars / a closed crossing onto this car's path for car-following.
  function forwardRoute(car: Car): Map<string, { lead: number; entry: Port }> {
    const cls = clsOf(car);
    const route = new Map<string, { lead: number; entry: Port }>();
    let coord = car.path[car.headIndex].coord;
    let entry = car.path[car.headIndex].entryPort;
    route.set(getCoordinatesId(coord), { lead: -car.headProgress, entry });
    let lead = 1 - car.headProgress; // head -> the next tile's entry edge
    while (lead <= CAR_LOOKAHEAD) {
      const tile = level[getCoordinatesId(coord)];
      const exits = usableExits(tile?.road, entry, cls);
      if (exits.length === 0) break;
      // At a junction use the route plan's prescribed exit; fall back to the
      // first exit for plain straights/curves (they have exactly one anyway).
      const junctionExit = isRoadJunction(tile?.road)
        ? (carExitAt(car, coord) ?? exits[0])
        : exits[0];
      const exitPort = junctionExit;
      const nextCoord = neighborCoord(coord, exitPort);
      if (!nextCoord) break;
      const nextTile = level[getCoordinatesId(nextCoord)];
      if (
        !nextTile?.road?.length ||
        usableExits(nextTile.road, oppositePort(exitPort), cls).length === 0
      )
        break;
      const id = getCoordinatesId(nextCoord);
      if (!route.has(id)) route.set(id, { lead, entry: oppositePort(exitPort) });
      lead += 1;
      coord = nextCoord;
      entry = oppositePort(exitPort);
    }
    return route;
  }

  // The anchor points along a car's whole body as { tileId, entry, t }, used as
  // obstacles other cars must not roll into. Sampling the entire body (head back
  // to the exact tail at BODY_SAMPLE_STEP spacing) — not just the two ends —
  // means a long trailer that spans a junction tile mid-body still puts a point
  // on it, so a crossing car sees it occupied and holds off the tile.
  function bodyPoints(
    car: Car
  ): { tileId: string; entry: Port; exit: Port | null; t: number; laneIndex: number; lanePos: number }[] {
    const pts: { tileId: string; entry: Port; exit: Port | null; t: number; laneIndex: number; lanePos: number }[] = [];
    // Lane identity for following/conflict is the integer lane the car occupies
    // (its continuous position rounded) — a mid-change car counts as in the lane
    // it is closest to. `lanePos` keeps the CONTINUOUS lateral position at that
    // body point (lagged like the rendered body) for swept-body overlap checks.
    const lane = laneOf(car);
    const add = (a: number, s: CarSample) =>
      pts.push({
        tileId: getCoordinatesId(s.coord),
        entry: s.entryPort,
        exit: s.exitPort,
        t: s.t,
        laneIndex: lane,
        lanePos: lanePosAt(car, a, s),
      });
    for (let a = 0; a < car.length; a += BODY_SAMPLE_STEP) add(a, sampleAtArc(car, a));
    add(car.length, sampleAtArc(car, car.length)); // always include the exact tail
    return pts;
  }

  // Project a point on another car's body onto this car's look-ahead route. Null
  // if the point's tile is not on the route. `d` is the forward tile-distance from
  // this car's head to the point; `lead` is the distance to that tile's entry
  // edge; `perpendicular` is true when the occupant crosses our path at right
  // angles (a junction) rather than sharing our lane. The point's progress `t` is
  // measured from how its own car entered the tile, so re-orient it to the
  // direction this car travels the tile before turning it into a scalar.
  function projectPoint(
    route: Map<string, { lead: number; entry: Port }>,
    p: { tileId: string; entry: Port; t: number }
  ): { d: number; lead: number; perpendicular: boolean; opposing: boolean } | null {
    const hit = route.get(p.tileId);
    if (!hit) return null;
    let within: number;
    let perpendicular = false;
    let opposing = false;
    if (p.entry === hit.entry) within = p.t;
    else if (!isRoadJunction(level[p.tileId]?.road)) {
      // A straight/curve tile has a single edge-pair, so any car not entering the
      // way we do is travelling it head-on (the oncoming lane). On a CURVE that
      // oncoming car enters through our EXIT port — an ADJACENT port that
      // oppositePort(entry) would miss, the bug that froze two streams nose-to-
      // nose in a bend. Two ports ⇒ it can never be perpendicular.
      within = 1 - p.t;
      opposing = true;
    } else {
      // ANY other-entry occupant of a JUNCTION tile is a junction occupant — not
      // just adjacent-arm ones. An opposite-entry vehicle here is NOT simply "the
      // oncoming lane": with turns it can MERGE onto our exit (T→R beside B→R) or
      // CROSS our path (a left turn over the oncoming straight), so it must flow
      // into the junction conflict/merge logic below rather than being skipped as
      // oncoming (the bug that let opposite-arm merges drive through each other).
      // Two parallel straights simply aren't in the conflict matrix and still
      // pass each other freely.
      within = 0.5; // junction occupant: treat as mid-tile
      perpendicular = true;
    }
    return { d: hit.lead + within, lead: hit.lead, perpendicular, opposing };
  }

  // The clear tile-distance the car's head may advance this tick before it must
  // stop: short of a closed crossing's entry edge, or a CAR_GAP behind the
  // nearest point of any other car's body that lies ahead on its route. Capped at
  // the look-ahead. Read-only. This replaces the old whole-tile occupancy gate so
  // cars pack bumper-to-bumper instead of stopping a full tile apart.
  //
  // `boundByCrossing` reports whether the nearest binding constraint is a CLOSED
  // crossing ahead (as opposed to a car/junction ahead), so the caller can
  // attribute a car's wait to the crossing specifically rather than to a queue.
  // It is true only when a closed crossing is *the* limiting stop — a car stalled
  // behind a queue that is itself stalled at the gate is bound by the car ahead,
  // not the crossing, so its wait isn't charged to the crossing's patience score.
  function clearAhead(
    car: Car,
    closed: CrossingClosed
  ): { clear: number; boundByCrossing: boolean } {
    const route = forwardRoute(car);
    // Start unbounded and track the nearest real stop (gate / car / junction).
    // Keeping it unbounded (rather than capped at the look-ahead) lets the
    // keep-crossing-clear step below tell "an obstacle sits exactly a look-ahead
    // away" apart from "open road", which matters when a jam is one tile past a
    // crossing that sits at the edge of the look-ahead.
    let clear = Number.POSITIVE_INFINITY;
    // The speed of whatever currently bounds `clear`. Only a SAME-DIRECTION
    // leader (the car ahead in our own stream) reports its velocity; everything
    // else — signals, the arbiter, closed crossings, merge partners, crossing
    // streams — counts as static (0). The box keep-clear rule reads it: a
    // rolling PLATOON LEADER means the queue is draining and the car may follow
    // it through the junction nose-to-tail (the whole green phase crosses);
    // a standing queue whose end would trap the body in the box holds it out.
    let boundVel = 0;
    const bind = (d: number, vel: number) => {
      if (d < clear) {
        clear = d;
        boundVel = vel;
      }
    };
    // The distance to the nearest closed crossing ahead, tracked separately so we
    // can tell whether the crossing is what ultimately binds the car's movement.
    let crossingClear = Number.POSITIVE_INFINITY;
    // Closed crossing ahead: stop at its entry edge (the car is already past the
    // entry of its own head tile, whose lead is negative, so it is never gated by
    // a crossing it is currently sitting on).
    for (const [tileId, { lead }] of route) {
      if (lead >= 0 && closed(tileId)) crossingClear = Math.min(crossingClear, lead);
    }
    bind(crossingClear, 0);
    // Junction arbiter: for each upcoming junction on the route, ask whether
    // this car may enter given the current conflict geometry and waiting cars.
    for (const [junctionId, { lead, entry: myEntry }] of route) {
      if (lead < 0) continue;
      if (!isRoadJunction(level[junctionId]?.road)) continue;
      const conflictPairs = junctionConflicts.get(junctionId);
      if (!conflictPairs) continue;
      const jCoord = parseJunctionCoord(junctionId);
      // Fall back to the road's default exit so the arbiter fires even when the
      // car has no planned turn (e.g. straight-through at a priority junction).
      const myExit = carExitAt(car, jCoord) ?? roadExitPort(level, jCoord, myEntry, clsOf(car));
      if (myExit === null) continue;
      // Traffic-signal gate (#38): an approach may only be ENTERED on green. On a
      // red / all-red hold at the stop line (the junction entry edge). On amber a
      // car that can still brake to the line stops; one already too close commits
      // (a real amber interval, decision 4). Green falls through to the conflict
      // arbiter below, which still keeps permitted movements from colliding. An
      // "off" junction reports green for every arm, so this is a no-op there.
      const signalCtrl = signals.get(junctionId);
      if (signalCtrl) {
        // Class-aware: during a bus HEAD START the arm is green for buses
        // (they roll first, clearing the bus lane) and still red for cars.
        const aspect = signalCtrl.aspect(myEntry, clsOf(car));
        if (aspect === "red") {
          bind(Math.max(0, lead - CAR_GAP), 0);
        } else if (aspect === "amber") {
          const stopDist =
            (car.velocity * car.velocity) / (2 * Math.max(car.brake, 1e-6));
          if (stopDist <= lead) bind(Math.max(0, lead - CAR_GAP), 0);
        }
      }
      const candidate: WaitingCar = {
        entryArm: myEntry,
        exitArm: myExit,
        lane: laneOf(car),
        cls: clsOf(car),
        priority: level[getCoordinatesId(car.path[car.headIndex].coord)]?.roadPriority ?? 0,
        waitSeconds: car.waitSeconds,
      };
      if (
        !arbiter.canEnter(
          candidate,
          activeMovementsAt(junctionId),
          waitingCarsAt(junctionId, car),
          junctionConflictFn(junctionId),
        )
      ) {
        bind(Math.max(0, lead - CAR_GAP), 0);
      }
    }

    // My own body's lateral (lanePos) extent — head plus the lagging tail — so the
    // swept following clamp below compares true body-to-body lateral separation
    // (which captures a leaning tail sweeping the lane it is leaving), not just the
    // head's lane index.
    const myTailLanePos = lanePosAt(car, car.length, sampleAtArc(car, car.length));
    const myLatLo = Math.min(car.laneIndex, myTailLanePos);
    const myLatHi = Math.max(car.laneIndex, myTailLanePos);

    // Car-following: stop a gap behind other cars' bodies.
    for (const other of cars) {
      if (other === car) continue;
      const otherPts = bodyPoints(other);
      // Swept-body following, overlap-RECOVERING: keep our head a gap behind the
      // REAR-most point of any same-direction body whose lateral extent is within a
      // body width of ours — even one we have wrongly drawn level with. The
      // per-point gate below stops at the nearest point AHEAD of us, so once a
      // follower's nose slips past a leader's tail (e.g. two cars merging onto one
      // lane, or a lane-change that drew level) it would keep nosing up THROUGH the
      // body to the head. Gating on the rear-most point — which sits behind us when
      // we overlap, giving a clear of 0 — instead drops us back behind the tail, so
      // an overlap can never persist or deepen. Skips opposing/perpendicular and
      // junction-tile points (handled by their own gates).
      {
        let dRear = Number.POSITIVE_INFINITY;
        let dFront = Number.NEGATIVE_INFINITY;
        let otherLatLo = Number.POSITIVE_INFINITY;
        let otherLatHi = Number.NEGATIVE_INFINITY;
        for (const p of otherPts) {
          if (isRoadJunction(level[p.tileId]?.road)) continue;
          const proj = projectPoint(route, p);
          if (!proj || proj.opposing || proj.perpendicular) continue;
          dRear = Math.min(dRear, proj.d);
          dFront = Math.max(dFront, proj.d);
          otherLatLo = Math.min(otherLatLo, p.lanePos);
          otherLatHi = Math.max(otherLatHi, p.lanePos);
        }
        // Fire only when the other body actually ABUTS or overlaps us (its rear is
        // within a gap of our nose, or behind it) — a genuine clip to recover from.
        // A leader comfortably ahead (dRear ≥ CAR_GAP) is left to the ordinary
        // per-point follow gate below, so this never adds caution to a normal
        // merge/follow (which would, e.g., keep a bus off its preferred lane).
        if (dFront >= 0 && dRear < CAR_GAP) {
          const latSep = Math.max(0, Math.max(myLatLo, otherLatLo) - Math.min(myLatHi, otherLatHi));
          if (latSep < CLIP_LANES) bind(Math.max(0, dRear - CAR_GAP), other.velocity);
        }
      }
      // Progress range of the other car's body per tile (min = tail-most point,
      // max = front-most), used by the merge clamp: the merge winner is decided
      // by its FRONT, but the loser must trail its TAIL.
      const tRange = new Map<string, { min: number; max: number }>();
      for (const q of otherPts) {
        const r = tRange.get(q.tileId);
        if (!r) tRange.set(q.tileId, { min: q.t, max: q.t });
        else {
          r.min = Math.min(r.min, q.t);
          r.max = Math.max(r.max, q.t);
        }
      }
      for (const p of otherPts) {
        const proj = projectPoint(route, p);
        if (!proj || proj.d < 0) continue;
        // Oncoming traffic rides its own lane (offset to its right — the far side
        // of the dashed centre from ours), so an opposite-direction car never
        // shares our lane and must not gate us. This is what lets two streams flow
        // past each other instead of freezing nose-to-nose on a single centreline.
        if (proj.opposing) continue;
        const junctionTile = isRoadJunction(level[p.tileId]?.road);
        // Our movement through that junction tile, lane-aware. When our head is
        // ALREADY ON it the path segment carries the exact committed exit — the
        // routePlan turn has been CONSUMED at entry, so carExitAt would return
        // null and the fallback would assume the default (straight) movement,
        // freezing a committed turner on phantom conflicts. Path segment first;
        // the plan (for junctions ahead) and the class-aware default fall back.
        const myJunctionExit = (): Port | null => {
          const myEntry = route.get(p.tileId)?.entry;
          if (myEntry == null) return null;
          const headSeg = car.path[car.headIndex];
          if (getCoordinatesId(headSeg.coord) === p.tileId) return headSeg.exitPort;
          const jCoord = parseJunctionCoord(p.tileId);
          return carExitAt(car, jCoord) ?? roadExitPort(level, jCoord, myEntry, clsOf(car));
        };
        // Shares the arbiter's lane-aware predicate (cross matrix + same-arm
        // lateral-order inversion + same-lane merge landing).
        const junctionConflictWith = (myExit: Port): boolean =>
          p.exit !== null &&
          junctionConflictFn(p.tileId)(
            { entryArm: route.get(p.tileId)!.entry, exitArm: myExit, lane: laneOf(car), cls: clsOf(car) },
            { entryArm: p.entry, exitArm: p.exit, lane: p.laneIndex, cls: clsOf(other) },
          );
        if (!proj.perpendicular && p.laneIndex !== laneOf(car)) {
          // Same travel direction, different lane: side-by-side traffic must not
          // gate each other — EXCEPT on a junction we are still approaching, where
          // a same-arm pair can CROSS (an inner lane turning over a kerb-ward
          // lane's straight path — e.g. a car's right turn through a straight-
          // going bus on the kerb bus lane). The arbiter alone misses side-by-side
          // SIMULTANEOUS arrivals (neither is active yet when both check), so hold
          // at the entry edge here too. Committed vehicles (lead < 0) never freeze.
          if (junctionTile && proj.lead >= 0) {
            const myExit = myJunctionExit();
            if (myExit !== null && junctionConflictWith(myExit)) {
              bind(Math.max(0, proj.lead - CAR_GAP), 0);
            }
          }
          continue;
        }
        if (proj.perpendicular && junctionTile) {
          const myExit = myJunctionExit();
          if (myExit === null || p.exit === null) continue;
          const myEntry = route.get(p.tileId)!.entry;
          if (p.exit === myExit) {
            // MERGE partner (different arm, same exit): yield-and-slot, not
            // exclusion. Both head for the same exit edge, so measure both in
            // distance-to-that-edge: their body point sits 1−t before it, my
            // head lead+1. If they reach it first, I may advance only to
            // CAR_GAP behind them in that shared coordinate — clear =
            // lead + t − GAP — which grows as they roll through, so I slip in
            // right behind them instead of holding a whole tile away. Only the
            // FOLLOWER (farther from the edge) is bound, so two committed
            // mergers never freeze each other. Different landing lanes (a bus
            // onto the bus lane beside a car) don't interact at all; once
            // merged, ordinary same-lane car-following takes over downstream.
            if (
              mergeLandsSameLane(
                p.tileId,
                { entryArm: myEntry, exitArm: myExit, lane: laneOf(car), cls: clsOf(car) },
                { entryArm: p.entry, exitArm: p.exit, lane: p.laneIndex, cls: clsOf(other) },
              )
            ) {
              const r = tRange.get(p.tileId)!;
              const otherFrontD = 1 - r.max; // their front's distance to the edge
              const myD = proj.lead + 1; // my head's (junction tile counts as 1)
              // Their TAIL on this junction: when their rear still hangs off the
              // junction onto their approach arm, the on-junction minimum t
              // understates the body (it ends at the entry edge, t = 0) — without
              // this the follower creeps up beside the leader's overhanging rear
              // and the roles flip into an overlap as the leader pulls away.
              const headHere = getCoordinatesId(other.path[other.headIndex].coord) === p.tileId;
              const rearOffTile = otherPts[otherPts.length - 1].tileId !== p.tileId;
              const tailT = headHere && rearOffTile ? 0 : r.min;
              // They won the merge (their FRONT is nearer the shared edge than my
              // head): trail their TAIL — clear = lead + tailT − GAP — so my nose
              // can never end up beside their body when the lanes converge. If
              // I'm ahead instead, no clamp: they trail me by the same rule. A
              // DEAD HEAT (bit-identical distances — mirrored arms of a symmetric
              // map produce them) would leave both unclamped and let them overlap
              // behind a common leader, so ties yield deterministically by id.
              const tie = Math.abs(otherFrontD - myD) <= 1e-9 && other.id < car.id;
              if (otherFrontD < myD - 1e-9 || tie) {
                bind(Math.max(0, proj.lead + tailT - CAR_GAP), 0);
              }
            }
          } else if (junctionConflictWith(myExit)) {
            // Genuinely CROSSING streams hold at the entry edge (even committed,
            // as a safety backstop). Non-conflicting movements (e.g.
            // perpendicular right turns) share the tile freely.
            // COMMITTED vs COMMITTED (both bodies already inside the box —
            // a same-tick double entry the arbiter race lets through): if both
            // held, they'd freeze each other forever. Deterministic tie-break:
            // the smaller id rolls through, the other holds until it has passed.
            const bothInside = proj.lead < 0;
            if (!(bothInside && car.id < other.id)) {
              bind(Math.max(0, proj.lead - CAR_GAP), 0);
            }
          }
        } else {
          bind(proj.d - CAR_GAP, other.velocity);
        }
      }
    }
    // Keep level crossings clear ("don't block the box"): never come to rest with
    // the body straddling a rail crossing because the road just past it is jammed.
    // If stopping at `clear` would leave any part of the body on a crossing ahead
    // (head past its entry but rear not yet past its far edge), hold short of that
    // crossing's entry instead, so the car waits off the tracks until it can pass
    // the whole crossing in one go. Only meaningful when a real obstacle bounds us
    // (clear is finite); on open road the car rolls straight through.
    if (Number.isFinite(clear)) {
      for (const [tileId, { lead, entry: keepEntry }] of route) {
        if (lead < 0) continue; // already on/past this tile — committed, can't undo
        const cell = level[tileId];
        const onCrossing = !!cell && isLevelCrossing(cell);
        const onBox = !!cell && isRoadJunction(cell.road);
        if (!onCrossing && !onBox) continue;
        const farEdge = lead + 1; // the crossing tile spans [lead, lead+1]
        if (!(clear > lead && clear - car.length < farEdge)) continue;
        // Junction boxes get the same rule ("don't block the box") — but only
        // when resting in the box would actually BLOCK someone: a waiting or
        // active movement from another arm that conflicts with ours. Plain
        // queueing through an empty-cross-traffic junction (a carousel loop,
        // a right-turn-only cross) keeps flowing bumper-to-bumper as before.
        // And a car already held back for a while enters anyway — when space
        // is scarce everywhere (saturated ring), insisting on an empty box
        // would itself gridlock the loop.
        if (onBox && !onCrossing) {
          if (car.waitSeconds > BOX_KEEP_CLEAR_PATIENCE) continue;
          // A ROLLING bound: the obstacle limiting us is itself moving, so the
          // queue ahead is draining — follow it through the box nose-to-tail
          // (the whole green-phase platoon crosses). Only a STANDING queue
          // whose end would trap our body in the box holds us at the entry.
          if (boundVel > ROLLING_QUEUE_EPS) continue;
          const pairs = junctionConflicts.get(tileId);
          if (!pairs) continue;
          const jCoord = parseJunctionCoord(tileId);
          const myExit =
            carExitAt(car, jCoord) ?? roadExitPort(level, jCoord, keepEntry, clsOf(car));
          if (myExit === null) continue;
          const me = { entryArm: keepEntry, exitArm: myExit, lane: laneOf(car), cls: clsOf(car) };
          const conflicts = junctionConflictFn(tileId);
          const blocked = [
            ...activeMovementsAt(tileId),
            ...waitingCarsAt(tileId, car),
          ].some(m => m.entryArm !== keepEntry && conflicts(me, m));
          if (!blocked) continue;
        }
        clear = Math.min(clear, Math.max(0, lead - CAR_GAP));
      }
    }
    const finalClear = Math.max(0, Math.min(clear, CAR_LOOKAHEAD));
    // The car is bound by the crossing when the closed crossing is the nearest
    // stop (its distance equals the overall clear, within epsilon) — i.e. nothing
    // closer (a car, a junction) is what's holding it.
    const boundByCrossing =
      Number.isFinite(crossingClear) &&
      crossingClear <= clear + STOP_EPS &&
      finalClear <= STOP_EPS;
    return { clear: finalClear, boundByCrossing };
  }

  function advance(car: Car, dt: number, closed: CrossingClosed): boolean {
    const { clear, boundByCrossing } = clearAhead(car, closed);
    // Patience bookkeeping: a car stopped specifically by a closed crossing ahead
    // accrues wait time; any other state (moving, or stopped behind a car/junction)
    // resets it. This is the deterministic measure the objective layer scores.
    if (clear <= STOP_EPS && boundByCrossing) car.waitedSec += dt;
    else car.waitedSec = 0;
    let move: number;
    if (clear <= STOP_EPS) {
      // Fully stopped (queue / closed gate / occupied junction ahead): hold, and
      // arm the launch reaction so the car waits a beat once the way reopens.
      car.launchTimer = REACTION_DELAY;
      car.velocity = 0;
      move = 0;
      car.waitSeconds += dt;
    } else if (car.launchTimer > 0) {
      // The way ahead just cleared but the driver hasn't reacted yet — sit still
      // while the leader pulls away, so the queue stretches out on release.
      car.launchTimer = Math.max(0, car.launchTimer - dt);
      car.velocity = 0;
      move = 0;
      car.waitSeconds += dt;
    } else {
      // Ramp the velocity toward the cap instead of snapping to cruise: accelerate
      // from rest, and brake smoothly so the car can still stop within `clear`
      // (vSafe is the fastest speed that still brakes to rest in that distance).
      // Same model as the train sim (simulation.ts).
      const vSafe = Math.sqrt(2 * car.brake * clear);
      const vCap = Math.min(car.speed, vSafe);
      if (car.velocity < vCap) {
        car.velocity = Math.min(vCap, car.velocity + car.accel * dt);
      } else if (car.velocity > vCap) {
        car.velocity = Math.max(vCap, car.velocity - car.brake * dt);
      }
      if (car.velocity < 0) car.velocity = 0;
      car.waitSeconds = 0; // reset: the car is moving
      move = Math.min(car.velocity * dt, clear); // never roll past the stop line
    }
    const cls = clsOf(car);
    car.headProgress += move;
    while (car.headProgress >= 1) {
      const head = car.path[car.headIndex];
      const exitPort = head.exitPort ?? roadExitPort(level, head.coord, head.entryPort, cls);
      if (exitPort === null) return false;
      const nextCoord = neighborCoord(head.coord, exitPort);
      if (!nextCoord) return false;
      const nextTile = level[getCoordinatesId(nextCoord)];
      if (
        !nextTile?.road?.length ||
        usableExits(nextTile.road, oppositePort(exitPort), cls).length === 0
      )
        return false;
      // Backstop: clearAhead caps movement at a closed crossing's entry, which
      // can land headProgress exactly on the boundary — never cross onto it.
      if (closed(getCoordinatesId(nextCoord))) {
        car.headProgress = 1;
        break;
      }
      const nextEntry = oppositePort(exitPort);
      let nextExit =
        carExitAtConsume(car, nextCoord) ?? roadExitPort(level, nextCoord, nextEntry, cls);
      // LANE DISCIPLINE at a junction: the turn-lane pre-sorting (F) is a
      // wish, not a guarantee — in traffic a car can reach the junction in a
      // lane that doesn't permit its planned movement (the gap for the lane
      // change never opened). A real driver doesn't swerve across the box:
      // they MISS the turn, take a movement their lane allows (straight when
      // possible), and re-plan the route from there.
      if (nextExit !== null && isRoadJunction(nextTile.road)) {
        const approachCount = laneCount(nextTile.road, nextEntry);
        const myLane = Math.max(0, Math.min(laneOf(car), approachCount - 1));
        const allowed = lanesAllowingExitFor(nextTile.road, nextEntry, nextExit, cls);
        if (allowed.length > 0 && !allowed.includes(myLane)) {
          const myExits = usableExits(nextTile.road, nextEntry, cls).filter(p =>
            lanesAllowingExitFor(nextTile.road, nextEntry, p, cls).includes(myLane),
          );
          if (myExits.length > 0) {
            const straightOn = oppositePort(nextEntry);
            nextExit = myExits.includes(straightOn) ? straightOn : myExits[0];
            // The remaining plan assumed the missed turn — re-plan from the
            // tile beyond the junction along the detour.
            const onward = neighborCoord(nextCoord, nextExit);
            if (onward) {
              const replan = planRoute(
                level, onward, oppositePort(nextExit), allMapExits, routeRng, cls,
              );
              car.routePlan = replan.turns;
              car.routeStep = 0;
              if (replan.destination) car.destination = replan.destination;
            } else {
              car.routePlan = [];
              car.routeStep = 0;
            }
          }
        }
      }
      car.path.push({ coord: nextCoord, entryPort: nextEntry, exitPort: nextExit });
      const prevRoad = level[getCoordinatesId(head.coord)]?.road; // the tile we leave
      const nextLaneCount = laneCount(nextTile.road, nextEntry);
      if (isRoadJunction(prevRoad)) {
        // Crossing OUT of a junction: choose the exit-arm lane that MATCHES this
        // movement (turn-aware, lane-count-aware), so a 1→3 fans out and a turn
        // lands in the lane its direction implies — instead of carrying the
        // approach index across and piling everyone into lane 0.
        const want = junctionExitLane(
          prevRoad, head.entryPort, laneOf(car), exitPort, nextTile.road, nextEntry, cls,
        );
        // A TURN's lateral glide (couplerOffset's turn branch) physically carries
        // the vehicle to `want` ACROSS the junction tile, so it must START there —
        // resetting to the carried approach index made it land on its lane, snap
        // back, then drift across again (an on-ramp car visibly dipping to the
        // kerb before returning to its inner landing lane). Straight-through
        // movements have no such glide (they keep the seam-taper branch), so they
        // start at the nearest usable carried lane and ease over (pendingExitLane).
        const turned = exitPort !== oppositePort(head.entryPort);
        const start = turned
          ? want
          : nearestUsableLaneIndex(
              nextTile.road, nextEntry,
              nextLaneCount > 0 ? Math.min(car.laneIndex, nextLaneCount - 1) : car.laneIndex,
              cls,
            );
        car.laneIndex = start;
        car.targetLane = want;
        car.laneVel = 0;
        car.pendingExitLane = want;
      } else if (nextLaneCount > 0) {
        // Straight / curve: keep the lane, only clamping down when the road narrows
        // (a backstop for a car that hadn't finished merging before the drop).
        car.laneIndex = Math.min(car.laneIndex, nextLaneCount - 1);
        car.targetLane = Math.min(car.targetLane, nextLaneCount - 1);
      }
      car.headIndex += 1;
      car.headProgress -= 1;
    }
    // Flag the car as a crossing-user the moment its head sits on a level-crossing
    // tile, so throughput (carsDelivered) counts only cars that actually traversed
    // a crossing — set once and sticky for the car's life.
    if (!car.crossedCrossing) {
      const cell = level[tileIdOf(car)];
      if (cell && isLevelCrossing(cell)) car.crossedCrossing = true;
    }
    // Driver behaviour: maybe start/continue an overtake (sets the phase that
    // desiredLane reads), then ease laterally toward the lane the car wants.
    considerOvertake(car, dt);
    updateLateral(car, dt);
    return true;
  }

  // Attempt one spawn at a randomly-chosen entry. Returns true iff a car was
  // placed, so the fill-fast loop knows whether the road still has room.
  function trySpawn(closed: CrossingClosed): boolean {
    if (entries.length === 0 || cars.length >= maxCarsOf()) return false;
    // Decide the vehicle kind FIRST (it fixes the lane-access class), then pick
    // a class-compatible entry: a car never draws a bus-only street's open end,
    // and buses can spawn there at all (previously such edges had no entry).
    const kind = pickKind();
    const cls = vehicleClassOf(kind);
    const pool = cls === "bus" ? entries : entries.filter(e => !e.busOnly);
    if (pool.length === 0) return false;
    const entry = pool[Math.floor(rng() * pool.length)];
    const id = getCoordinatesId(entry.coord);
    if (closed(id)) return false;
    // Spawn only into a lane with clear road at the entry. We probe each lane of
    // the approach with a zero-length car sitting at the entry edge and reuse
    // clearAhead: it returns ~0 when a same-lane car's body is right at the entry
    // (so we never spawn on top of it) and the look-ahead on open road otherwise.
    // The chosen lane MUST be the one probed — probing only lane 0 while spawning
    // into a random lane let cars pile up on a jammed lane that backed up to the
    // entry. Lanes are tried from a rotating start so multi-lane entries fill
    // evenly; if every lane is blocked at the edge, skip this spawn entirely
    // (the road is saturated — better to drop the spawn than stack cars). Two-lane
    // note: clearAhead skips oncoming-lane cars, so an opposing car on the entry
    // tile never blocks a spawn — right when both directions share the tile.
    const exit = roadExitPort(level, entry.coord, entry.entryPort, cls);
    // The lanes this vehicle class may start in. A car gets only car lanes (the
    // bus lane is off-limits); a bus gets every lane, and prefers the bus lane below.
    const entryRoad = level[getCoordinatesId(entry.coord)]?.road;
    const usable = usableLaneIndices(entryRoad, entry.entryPort, cls);
    if (usable.length === 0) return false; // no usable lane at this entry
    const probe: Car = {
      id: "",
      kind,
      speed: 0,
      velocity: 0,
      accel: 0,
      brake: 0,
      length: 0,
      path: [{ coord: entry.coord, entryPort: entry.entryPort, exitPort: exit }],
      headIndex: 0,
      headProgress: 0,
      launchTimer: 0,
      routePlan: [],
      routeStep: 0,
      waitSeconds: 0,
      waitedSec: 0,
      crossedCrossing: false,
      laneIndex: 0,
      targetLane: 0,
      laneVel: 0,
      overtaker: false,
      heldSec: 0,
      overtakePhase: "none",
      overtakeOf: null,
      overtakeHomeLane: 0,
      destination: null,
      pendingExitLane: null,
    };
    // Plan the route first so we can prefer the turn lane it will need (F). Routes
    // run on their own RNG stream, independent of the per-car speed/kind draws.
    const { turns: routePlan, destination } = planRoute(level, entry.coord, entry.entryPort, allMapExits, routeRng, cls);
    // Lane order to try at the entry, by class:
    //  • A bus prefers the bus lane(s) first (so it enters already on the bus lane),
    //    then the remaining lanes from a rotating start.
    //  • A car uses the turn-lane preference (F) when its first junction has a
    //    dedicated turn lane, else fills its car lanes evenly from a rotating start.
    // Either way, spawn ONLY into a probed-clear lane; if all are blocked at the
    // edge skip the spawn (saturated — better than stacking cars).
    let order: number[];
    if (cls === "bus") {
      const busLanes = busLaneIndices(entryRoad, entry.entryPort);
      const rest = usable.filter(l => !busLanes.includes(l));
      const rotatedRest = Array.from(
        { length: rest.length },
        (_, k) => rest[(spawnLaneRot + k) % rest.length],
      );
      order = [...busLanes, ...rotatedRest];
    } else {
      const preferred = preferredSpawnLane(entry.coord, entry.entryPort, exit, routePlan, usable.length);
      order =
        preferred >= 0
          ? [preferred]
          : Array.from({ length: usable.length }, (_, k) => usable[(spawnLaneRot + k) % usable.length]);
    }
    let chosenLane = -1;
    for (const lane of order) {
      probe.laneIndex = lane;
      if (clearAhead(probe, closed).clear > STOP_EPS) {
        chosenLane = lane;
        break;
      }
    }
    if (chosenLane < 0) return false; // preferred/all lanes blocked — wait, don't stack
    spawnLaneRot++;
    // Buses never overtake (they ride their lane, preferring the bus lane). Draw
    // from the driver RNG regardless so its stream stays stable across mixes.
    const overtaker = driverRng() < overtakeFraction && cls !== "bus";
    const length = specLength(vehicleSpec(kind, carLength));
    // Draw this car's preferred speed uniformly in [1-spread, 1+spread]·carSpeed
    // from the seeded RNG (per-car speed sequence stays reproducible for a seed).
    const speed = carSpeed * (1 - speedSpread + rng() * 2 * speedSpread);
    const spawnExit = routeAwareExitForSpawn(entry.coord, entry.entryPort, routePlan, cls);
    cars.push({
      id: `car${nextId++}`,
      kind,
      speed,
      // Enter the map already at cruise speed — a car drives in from off-screen, so
      // it's been rolling before it appears, not starting from a standstill at the
      // edge. (The accel ramp from rest still applies when a car has to STOP on the
      // map and then get going again — at a queue or a closed crossing.) clearAhead
      // caps the first step at the available room, so entering at speed can't make
      // it overrun a car just ahead.
      velocity: speed,
      accel: DEFAULT_CAR_ACCEL,
      brake: DEFAULT_CAR_BRAKE,
      length,
      path: [{ coord: entry.coord, entryPort: entry.entryPort, exitPort: spawnExit }],
      headIndex: 0,
      headProgress: 0,
      launchTimer: 0,
      routePlan,
      routeStep: 0,
      waitSeconds: 0,
      waitedSec: 0,
      crossedCrossing: false,
      laneIndex: chosenLane,
      targetLane: chosenLane,
      laneVel: 0,
      overtaker,
      heldSec: 0,
      overtakePhase: "none",
      overtakeOf: null,
      overtakeHomeLane: chosenLane,
      destination,
      pendingExitLane: null,
    });
    return true;
  }

  function segLen(seg: RoadSegment): number {
    return roadSegmentLength(seg.entryPort, seg.exitPort ?? seg.entryPort, 1);
  }

  function sampleAtArc(car: Car, arcBack: number): CarSample {
    let idx = car.headIndex;
    const withinHead = car.headProgress * segLen(car.path[idx]);
    let remaining = Math.max(0, arcBack);
    if (remaining <= withinHead) {
      const seg = car.path[idx];
      return {
        coord: seg.coord,
        entryPort: seg.entryPort,
        exitPort: seg.exitPort,
        t: (withinHead - remaining) / segLen(seg),
      };
    }
    remaining -= withinHead;
    idx -= 1;
    while (idx >= 0) {
      const L = segLen(car.path[idx]);
      const seg = car.path[idx];
      if (remaining <= L)
        return {
          coord: seg.coord,
          entryPort: seg.entryPort,
          exitPort: seg.exitPort,
          t: 1 - remaining / L,
        };
      remaining -= L;
      idx -= 1;
    }
    const seg = car.path[0];
    return { coord: seg.coord, entryPort: seg.entryPort, exitPort: seg.exitPort, t: 0 };
  }

  // Arms with an APPROACHING bus per signalised junction, for transit signal
  // priority (#38). For each bus, the first junction within BUS_PRIORITY_TILES
  // ahead along its committed path counts as an approach on the arm it will enter
  // through. Only junctions that have a controller are kept; the controllers use
  // it to extend / bring forward that arm's green.
  function busApproaches(): Map<string, Set<Port>> {
    const out = new Map<string, Set<Port>>();
    for (const car of cars) {
      if (clsOf(car) !== "bus") continue;
      const head = car.path[car.headIndex];
      const ahead = junctionAhead(
        head.coord,
        head.entryPort,
        head.exitPort,
        BUS_PRIORITY_TILES,
        "bus",
      );
      if (!ahead) continue;
      const id = getCoordinatesId(ahead.coord);
      if (!signals.has(id)) continue;
      let set = out.get(id);
      if (!set) {
        set = new Set();
        out.set(id, set);
      }
      set.add(ahead.entry);
    }
    return out;
  }

  return {
    step(dt: number, closed: CrossingClosed) {
      // Advance the junction signal phase clocks on sim time (deterministic),
      // feeding each its approaching buses for transit signal priority. Done
      // before cars move so this tick's aspects gate this tick's entries.
      const approaches = busApproaches();
      for (const [id, ctrl] of signals) {
        ctrl.step(dt, approaches.get(id) ?? EMPTY_ARMS);
      }
      if (fillFast) {
        // Fill toward the cap as fast as the road physically clears: each tick,
        // keep attempting spawns until the cap is hit or a run of attempts all
        // bounce (every entry blocked at its edge — the road is saturated).
        // clearAhead still gates each placement, so cars never stack; they fill
        // only as fast as room opens at the entries. Running every tick (~60Hz)
        // packs even a wide cap to its target within a fraction of a second.
        let misses = 0;
        const maxAttempts = Math.max(1, entries.length) * 4;
        for (let a = 0; a < maxAttempts && cars.length < maxCarsOf(); a++) {
          if (trySpawn(closed)) misses = 0;
          else if (++misses >= Math.max(1, entries.length)) break;
        }
      } else {
        spawnClock += dt;
        // One spawn attempt per spawnInterval of sim time (deterministic cadence).
        while (spawnClock >= spawnInterval) {
          spawnClock -= spawnInterval;
          trySpawn(closed);
        }
      }
      // Advance cars in a stable order; despawn any that drove off the map. A
      // despawning car that used a crossing en route counts toward throughput.
      for (let i = cars.length - 1; i >= 0; i--) {
        const alive = advance(cars[i], dt, closed);
        if (!alive) {
          if (cars[i].crossedCrossing) carsDelivered += 1;
          cars.splice(i, 1);
        }
      }
    },
    frame(): RoadFrame {
      let maxCarWaitSec = 0;
      let carWaitTotalSec = 0;
      for (const c of cars) {
        if (c.waitedSec > maxCarWaitSec) maxCarWaitSec = c.waitedSec;
        carWaitTotalSec += c.waitedSec;
      }
      return { maxCarWaitSec, carWaitTotalSec, carsDelivered };
    },
    cars() {
      return cars.map(c => ({
        id: c.id,
        tileId: tileIdOf(c),
        headIndex: c.headIndex,
        headProgress: c.headProgress,
        speed: c.speed,
        velocity: c.velocity,
        laneIndex: c.laneIndex,
        targetLane: c.targetLane,
        overtakePhase: c.overtakePhase,
      }));
    },
    sample() {
      return cars.map(c => {
        const spec = vehicleSpec(c.kind, carLength);
        const units: CarUnit[] = [];
        let lead = 0; // arc distance from the head to this segment's leading edge
        for (const seg of spec.segments) {
          const front = sampleAtArc(c, lead);
          const rear = sampleAtArc(c, lead + seg.length);
          front.lanePos = lanePosAt(c, lead, front);
          rear.lanePos = lanePosAt(c, lead + seg.length, rear);
          units.push({ front, rear, lengthTiles: seg.length, part: seg.part });
          lead += seg.length + spec.gap;
        }
        const headSeg = c.path[c.headIndex];
        const curLaneCount = laneCount(level[getCoordinatesId(headSeg.coord)]?.road, headSeg.entryPort);
        return { id: c.id, units, laneIndex: c.laneIndex, laneCount: Math.max(1, curLaneCount), destination: c.destination };
      });
    },
    bodies() {
      return cars.map(c => ({
        id: c.id,
        points: bodyPoints(c).map(p => ({
          tileId: p.tileId,
          lane: p.laneIndex,
          entry: p.entry,
          t: p.t,
          lanePos: p.lanePos,
        })),
      }));
    },
    junctionOccupancy() {
      const out: Record<string, string> = {};
      for (const c of cars) {
        for (const tileId of bodyTileIds(c)) {
          if (isRoadJunction(level[tileId]?.road)) out[tileId] = c.id;
        }
      }
      return out;
    },
    signalAspect(tileId: string, arm: Port, cls: VehicleClass = "car"): SignalAspect | null {
      const ctrl = signals.get(tileId);
      if (!ctrl || ctrl.signal().mode === "off") return null;
      return ctrl.aspect(arm, cls);
    },
    signalOf(tileId: string): JunctionSignal | null {
      const ctrl = signals.get(tileId);
      return ctrl ? ctrl.signal() : null;
    },
    cycleSignal(tileId: string): JunctionSignal | null {
      const ctrl = signals.get(tileId);
      if (!ctrl) return null;
      const next = cycleJunctionSignal(ctrl.signal());
      ctrl.setSignal(next);
      return next;
    },
    routePath(carId: string): RoadSegment[] {
      const car = cars.find(c => c.id === carId);
      if (!car) return [];
      const head = car.path[car.headIndex];
      const out: RoadSegment[] = [];
      const visited = new Set<string>();
      // Cap so a malformed (looping) map can never spin forever: a route visits
      // each tile/entry at most once, bounded by the grid size.
      const maxSteps = width * height + 1;
      let coord: Coordinates = head.coord;
      let entry: Port = head.entryPort;
      for (let i = 0; i < maxSteps; i++) {
        const stateId = `${getCoordinatesId(coord)}:${entry}`;
        if (visited.has(stateId)) break;
        visited.add(stateId);
        // At a junction take the route plan's prescribed turn (the car already
        // chose it); on a straight/curve there is a single car exit.
        const jExit = isRoadJunction(level[getCoordinatesId(coord)]?.road)
          ? carExitAt(car, coord)
          : null;
        const exitPort = jExit ?? roadExitPort(level, coord, entry);
        out.push({ coord, entryPort: entry, exitPort });
        if (exitPort === null) break;
        const nextCoord = neighborCoord(coord, exitPort);
        if (!nextCoord) break;
        const nextTile = level[getCoordinatesId(nextCoord)];
        if (
          !nextTile?.road?.length ||
          exitsForCar(nextTile.road, oppositePort(exitPort)).length === 0
        )
          break; // ran off the map / dead-ended — this exit is the destination edge
        coord = nextCoord;
        entry = oppositePort(exitPort);
      }
      return out;
    },
  };
}
