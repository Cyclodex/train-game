import { Coordinates, Position } from "@/types";
import { Level, isLevelCrossing } from "@/tiles/model";
import { exitsFrom, exitsForCar, isRoadJunction, laneCount, lanesAllowingExit } from "@/tiles/lanes";
import { Port, neighborCoord, oppositePort } from "./topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { segmentLength } from "./pathGeometry";
import { makeRng } from "@/utils/globalHelpers";
import { planRoute, RouteTurn } from "./roadRouter";
import { buildConflictMatrix, conflictKey } from "./roadJunction";
import { ActiveMovement, WaitingCar, fcfsWithPriorityArbiter, JunctionArbiter } from "./roadArbiter";

// Re-export so existing importers of isRoadJunction from "@/sim/road" keep working.
export { isRoadJunction } from "@/tiles/lanes";

// --- Vehicle kinds -----------------------------------------------------------
// A vehicle is described as data: a list of rendered body segments plus a
// coupling gap, all measured in tiles and scaled from a base car length `B`.
// A car is one box; a truck one longer box; a semi a short cab + long trailer
// (two chord segments, so the trailer articulates on curves like a train's
// loco + wagon). Everything downstream (following distance, lane occupancy,
// rendering) is derived from the spec, so adding a kind is a one-row change.

export type VehicleKind = "car" | "truck" | "semi";

export interface VehicleSegment {
  length: number; // rendered box length, in tiles
  part: "car" | "truck" | "cab" | "trailer"; // render style hint for the view
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

export function vehicleSpec(kind: VehicleKind, base: number): VehicleSpec {
  switch (kind) {
    case "truck":
      return { segments: [{ length: base * TRUCK_LEN, part: "truck" }], gap: 0 };
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
export type TrafficMix = { car?: number; truck?: number; semi?: number };

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

function roadExitPort(level: Level, coord: Coordinates, entryPort: Port): Port | null {
  const tile = level[getCoordinatesId(coord)];
  if (!tile || !tile.road || tile.road.length === 0) return null;
  const exits = exitsForCar(tile.road, entryPort);
  if (exits.length === 0) return null;
  // Single exit (straight/curve/one-way) — or pick the first for a junction.
  return exits[0];
}

export function roadTraverse(
  level: Level,
  coord: Coordinates,
  entryPort: Port
): RoadTraversal {
  const exitPort = roadExitPort(level, coord, entryPort);
  if (exitPort === null) return { exitPort: null, next: null };

  const nextCoord = neighborCoord(coord, exitPort);
  if (!nextCoord) return { exitPort, next: null }; // Center has no neighbour

  const nextTile = level[getCoordinatesId(nextCoord)];
  if (!nextTile || !nextTile.road || nextTile.road.length === 0)
    return { exitPort, next: null }; // road runs off the map / dead-ends
  // The next tile must carry car-accessible road back to us.
  if (exitsForCar(nextTile.road, oppositePort(exitPort)).length === 0)
    return { exitPort, next: null };

  return { exitPort, next: { coord: nextCoord, entryPort: oppositePort(exitPort) } };
}

// --- Spawn points -------------------------------------------------------------
// A car spawns where a road opens onto the map edge: a road port that points off
// the grid (no in-grid road neighbour to continue onto). Cars enter there and
// drive inward.

export interface RoadEntry {
  coord: Coordinates;
  entryPort: Port; // the edge the car enters through (an open road port)
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
      // `port` is a car-accessible road port and points off the grid -> a spawn entry.
      if (exitsForCar(tile.road, port).length === 0) continue;
      const n = neighborCoord(coord, port)!;
      const offGrid = n.x < 0 || n.y < 0 || n.x >= width || n.y >= height;
      const neigh = level[getCoordinatesId(n)];
      const neighRoad =
        !offGrid && neigh?.road && exitsForCar(neigh.road, oppositePort(port)).length > 0;
      if (offGrid || !neighRoad) {
        out.push({ coord, entryPort: port });
      }
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
      // Some car-accessible lane of this tile leaves via `port`.
      if (!tile.road.some(l => l.kind !== "bus" && l.to.includes(port))) continue;
      const n = neighborCoord(coord, port)!;
      const offGrid = n.x < 0 || n.y < 0 || n.x >= width || n.y >= height;
      const neigh = level[getCoordinatesId(n)];
      const continues =
        !offGrid && neigh?.road && exitsForCar(neigh.road, oppositePort(port)).length > 0;
      if (offGrid || !continues) out.push({ coord, entryPort: port });
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
  }[];
  // Each live car sampled as its rendered body units (one per segment) for the
  // renderer: a car/truck has one, a semi has a cab + a trailer.
  sample(): CarChord[];
  // Road-junction tiles a car body currently occupies, keyed by tile id → car id.
  // There is no stored reservation for cars (unlike trains): occupancy is derived
  // live from car positions. The junction interlock keeps this at most one car per
  // junction tile, so the map is effectively tileId → the car that owns it now.
  // Exposed purely so the renderer can highlight a held junction in debug mode.
  junctionOccupancy(): Record<string, string>;
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
// Lane-change (lateral) motion. A car eases sideways at LANE_CHANGE_RATE lanes
// per second toward its target lane, but only commits to entering the next lane
// when that lane has at least LANE_CHANGE_GAP tiles of clear road both ahead of
// and behind the car (gap acceptance) — so a lane change never overlaps another
// car. LANE_SETTLE is how close (in lanes) counts as "arrived".
const LANE_CHANGE_RATE = 2.2;
const LANE_CHANGE_GAP = 0.18;
const LANE_SETTLE = 1e-3;
// How many tiles ahead a car looks for the junction it must be lane-sorted for,
// so it starts moving into its turn lane with room to spare (sub-project F).
const TURN_LANE_LOOKAHEAD = 4;
// How far ahead (in tiles) a car scans for the next car / closed crossing. Cars
// are short and slow, so a couple of tiles of look-ahead is plenty.
const CAR_LOOKAHEAD = 2;
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
    const weighted = (["car", "truck", "semi"] as VehicleKind[])
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
  ): { coord: Coordinates; entry: Port } | null {
    let coord = startCoord;
    let entry = startEntry;
    let exit = startExit ?? roadExitPort(level, coord, entry);
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
      exit = roadExitPort(level, coord, entry); // straight continuation
    }
    return null;
  }

  function desiredLane(car: Car): number {
    const head = car.path[car.headIndex];
    const tile = level[getCoordinatesId(head.coord)];
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
    const exit = head.exitPort ?? roadExitPort(level, head.coord, head.entryPort);
    if (exit != null) {
      const nCoord = neighborCoord(head.coord, exit);
      const nTile = nCoord ? level[getCoordinatesId(nCoord)] : undefined;
      if (nCoord && nTile?.road?.length) {
        const nCount = laneCount(nTile.road, oppositePort(exit));
        if (nCount > 0 && cur > nCount - 1) return clampLane(nCount - 1, curCount);
      }
    }

    // Overtaking (G+): while passing aim for the lane left of home; while
    // returning aim back at home. Above turn-lane sorting, but the merge/junction
    // guards above still win (safety). considerOvertake drives the phase.
    if (car.overtakePhase === "passing") return clampLane(car.overtakeHomeLane + 1, curCount);
    if (car.overtakePhase === "returning") return clampLane(car.overtakeHomeLane, curCount);

    // (F) A junction is coming up — get into a lane that permits the turn the
    // route takes there, as early as a few tiles out so there's room to change.
    const ahead = junctionAhead(
      head.coord,
      head.entryPort,
      head.exitPort ?? roadExitPort(level, head.coord, head.entryPort),
      TURN_LANE_LOOKAHEAD,
    );
    if (ahead) {
      const jTile = level[getCoordinatesId(ahead.coord)];
      const myExit = carExitAt(car, ahead.coord);
      if (jTile?.road && myExit != null) {
        const allow = lanesAllowingExit(jTile.road, ahead.entry, myExit);
        if (allow.length > 0 && !allow.includes(cur)) {
          const best = allow.reduce(
            (b, l) => (Math.abs(l - cur) < Math.abs(b - cur) ? l : b),
            allow[0],
          );
          return clampLane(best, curCount);
        }
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
    return allow.length > 0 ? allow[0] : -1;
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
    const before = car.laneIndex;
    car.targetLane = desiredLane(car);
    const diff = car.targetLane - car.laneIndex;
    if (Math.abs(diff) <= LANE_SETTLE) {
      car.laneIndex = car.targetLane;
    } else {
      const dir = Math.sign(diff);
      // Starting from a settled lane, only begin the change once the lane we'd
      // cross into is clear (gap acceptance). Once mid-crossing (fractional
      // position) we are committed and finish — the gap was checked when we set off.
      const atInteger = Math.abs(car.laneIndex - Math.round(car.laneIndex)) <= LANE_SETTLE;
      const blocked = atInteger && !laneClearForChange(car, Math.round(car.laneIndex) + dir);
      if (!blocked) {
        const step = LANE_CHANGE_RATE * dt;
        car.laneIndex += dir * Math.min(step, Math.abs(diff));
      }
    }
    // Lateral speed this tick — drives the render lean (see Car.laneVel).
    car.laneVel = dt > 0 ? (car.laneIndex - before) / dt : 0;
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

  // Same-direction overtaking (sub-project G+). An impatient/faster driver held
  // behind a slower leader pulls into the lane to its left to pass, then returns —
  // but only when the passing lane is clear and it isn't about to need its lane
  // for a turn. Disciplined drivers never do this. Runs the small state machine.
  function considerOvertake(car: Car, dt: number): void {
    const head = car.path[car.headIndex];
    const count = laneCount(level[getCoordinatesId(head.coord)]?.road, head.entryPort);

    if (car.overtakePhase === "passing") {
      // Bail out if the passing lane vanished (a drop) or we've cleared the car.
      if (car.overtakeHomeLane + 1 > count - 1 || isPast(car, car.overtakeOf)) {
        car.overtakePhase = "returning";
      }
      return;
    }
    if (car.overtakePhase === "returning") {
      if (Math.abs(car.laneIndex - car.overtakeHomeLane) <= LANE_SETTLE) {
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
  ): Port | null {
    const jId = getCoordinatesId(coord);
    const turn = plan.find(t => t.junctionId === jId);
    return turn?.exitArm ?? roadExitPort(level, coord, entry);
  }

  // Return the ActiveMovements currently held by cars *inside* `junctionId`.
  function activeMovementsAt(junctionId: string): ActiveMovement[] {
    const active: ActiveMovement[] = [];
    for (const other of cars) {
      if (!bodyTileIds(other).has(junctionId)) continue;
      const seg = other.path.find(s => getCoordinatesId(s.coord) === junctionId);
      if (!seg || seg.exitPort === null) continue;
      active.push({ carId: other.id, entryArm: seg.entryPort, exitArm: seg.exitPort });
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
      const myExit = carExitAt(other, nCoord) ?? roadExitPort(level, nCoord, entryArm);
      if (myExit === null) continue;
      waiting.push({
        entryArm,
        exitArm: myExit,
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
    const route = new Map<string, { lead: number; entry: Port }>();
    let coord = car.path[car.headIndex].coord;
    let entry = car.path[car.headIndex].entryPort;
    route.set(getCoordinatesId(coord), { lead: -car.headProgress, entry });
    let lead = 1 - car.headProgress; // head -> the next tile's entry edge
    while (lead <= CAR_LOOKAHEAD) {
      const tile = level[getCoordinatesId(coord)];
      const exits = exitsForCar(tile?.road, entry);
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
        exitsForCar(nextTile.road, oppositePort(exitPort)).length === 0
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
  ): { tileId: string; entry: Port; exit: Port | null; t: number; laneIndex: number }[] {
    const pts: { tileId: string; entry: Port; exit: Port | null; t: number; laneIndex: number }[] = [];
    // Lane identity for following/conflict is the integer lane the car occupies
    // (its continuous position rounded) — a mid-change car counts as in the lane
    // it is closest to.
    const lane = laneOf(car);
    for (let a = 0; a < car.length; a += BODY_SAMPLE_STEP) {
      const s = sampleAtArc(car, a);
      pts.push({ tileId: getCoordinatesId(s.coord), entry: s.entryPort, exit: s.exitPort, t: s.t, laneIndex: lane });
    }
    const tail = sampleAtArc(car, car.length); // always include the exact tail
    pts.push({ tileId: getCoordinatesId(tail.coord), entry: tail.entryPort, exit: tail.exitPort, t: tail.t, laneIndex: lane });
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
    else if (p.entry === oppositePort(hit.entry)) {
      within = 1 - p.t;
      opposing = true; // travels this tile head-on to us — i.e. the oncoming lane
    } else {
      within = 0.5; // perpendicular junction occupant: treat as mid-tile
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
    // The distance to the nearest closed crossing ahead, tracked separately so we
    // can tell whether the crossing is what ultimately binds the car's movement.
    let crossingClear = Number.POSITIVE_INFINITY;
    // Closed crossing ahead: stop at its entry edge (the car is already past the
    // entry of its own head tile, whose lead is negative, so it is never gated by
    // a crossing it is currently sitting on).
    for (const [tileId, { lead }] of route) {
      if (lead >= 0 && closed(tileId)) crossingClear = Math.min(crossingClear, lead);
    }
    clear = Math.min(clear, crossingClear);
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
      const myExit = carExitAt(car, jCoord) ?? roadExitPort(level, jCoord, myEntry);
      if (myExit === null) continue;
      const candidate: WaitingCar = {
        entryArm: myEntry,
        exitArm: myExit,
        priority: level[getCoordinatesId(car.path[car.headIndex].coord)]?.roadPriority ?? 0,
        waitSeconds: car.waitSeconds,
      };
      if (
        !arbiter.canEnter(
          candidate,
          activeMovementsAt(junctionId),
          waitingCarsAt(junctionId, car),
          conflictPairs,
        )
      ) {
        clear = Math.min(clear, Math.max(0, lead - CAR_GAP));
      }
    }

    // Car-following: stop a gap behind other cars' bodies.
    for (const other of cars) {
      if (other === car) continue;
      for (const p of bodyPoints(other)) {
        const proj = projectPoint(route, p);
        if (!proj || proj.d < 0) continue;
        // Oncoming traffic rides its own lane (offset to its right — the far side
        // of the dashed centre from ours), so an opposite-direction car never
        // shares our lane and must not gate us. This is what lets two streams flow
        // past each other instead of freezing nose-to-nose on a single centreline.
        if (proj.opposing) continue;
        // Different lane, same travel direction: cars ride side-by-side and must not
        // gate each other. Perpendicular junction occupants are handled below.
        if (!proj.perpendicular && !proj.opposing && p.laneIndex !== laneOf(car)) continue;
        if (proj.perpendicular && isRoadJunction(level[p.tileId]?.road)) {
          // A car crossing our path at a junction only blocks us if its movement
          // actually conflicts with ours (same conflict matrix the arbiter uses).
          // Two non-conflicting movements — e.g. perpendicular right turns — may
          // share the junction tile, so a right-turn-only cross never blocks;
          // genuinely crossing streams (perpendicular straights, a left turn over
          // oncoming) still hold at the entry edge.
          const conflictPairs = junctionConflicts.get(p.tileId);
          const jCoord = parseJunctionCoord(p.tileId);
          const myEntry = route.get(p.tileId)?.entry;
          const myExit =
            myEntry != null ? carExitAt(car, jCoord) ?? roadExitPort(level, jCoord, myEntry) : null;
          const conflicts =
            conflictPairs != null &&
            myEntry != null &&
            myExit !== null &&
            p.exit !== null &&
            conflictPairs.has(
              conflictKey(
                { entry: myEntry, entryIndex: laneOf(car), exit: myExit },
                { entry: p.entry, entryIndex: p.laneIndex, exit: p.exit }
              )
            );
          if (conflicts) clear = Math.min(clear, Math.max(0, proj.lead - CAR_GAP));
        } else {
          clear = Math.min(clear, proj.d - CAR_GAP);
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
      for (const [tileId, { lead }] of route) {
        if (lead < 0) continue; // already on/past this tile — committed, can't undo
        const cell = level[tileId];
        if (!cell || !isLevelCrossing(cell)) continue;
        const farEdge = lead + 1; // the crossing tile spans [lead, lead+1]
        if (clear > lead && clear - car.length < farEdge) {
          clear = Math.min(clear, Math.max(0, lead - CAR_GAP));
        }
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
    car.headProgress += move;
    while (car.headProgress >= 1) {
      const head = car.path[car.headIndex];
      const exitPort = head.exitPort ?? roadExitPort(level, head.coord, head.entryPort);
      if (exitPort === null) return false;
      const nextCoord = neighborCoord(head.coord, exitPort);
      if (!nextCoord) return false;
      const nextTile = level[getCoordinatesId(nextCoord)];
      if (
        !nextTile?.road?.length ||
        exitsForCar(nextTile.road, oppositePort(exitPort)).length === 0
      )
        return false;
      // Backstop: clearAhead caps movement at a closed crossing's entry, which
      // can land headProgress exactly on the boundary — never cross onto it.
      if (closed(getCoordinatesId(nextCoord))) {
        car.headProgress = 1;
        break;
      }
      const nextEntry = oppositePort(exitPort);
      const nextExit =
        carExitAtConsume(car, nextCoord) ?? roadExitPort(level, nextCoord, nextEntry);
      car.path.push({ coord: nextCoord, entryPort: nextEntry, exitPort: nextExit });
      // Clamp lane position when the next tile has fewer lanes — a backstop for a
      // car that hadn't finished merging before the drop (it normally merges on
      // the wider tile via updateLateral, so this rarely bites).
      const nextLaneCount = laneCount(nextTile.road, nextEntry);
      if (nextLaneCount > 0) {
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
    // Pick an entry deterministically.
    const entry = entries[Math.floor(rng() * entries.length)];
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
    const exit = roadExitPort(level, entry.coord, entry.entryPort);
    const entryLaneCount = Math.max(
      1,
      laneCount(level[getCoordinatesId(entry.coord)]?.road, entry.entryPort)
    );
    const probe: Car = {
      id: "",
      kind: "car",
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
    };
    // Plan the route first so we can prefer the turn lane it will need (F). Routes
    // run on their own RNG stream, independent of the per-car speed/kind draws.
    const { turns: routePlan, destination } = planRoute(level, entry.coord, entry.entryPort, allMapExits, routeRng);
    const preferred = preferredSpawnLane(entry.coord, entry.entryPort, exit, routePlan, entryLaneCount);
    // Try the preferred (turn) lane first, then the rest from a rotating start so
    // unrestricted multi-lane entries still fill evenly. Skip the spawn if every
    // lane is blocked at the edge (saturated — better than stacking cars).
    // When the route dictates a turn lane, spawn ONLY into that lane — if it's
    // momentarily blocked, wait (skip this spawn) rather than start in the wrong
    // lane, which would force a swap with an oncoming lane-changer and leave the
    // car turning from a lane that doesn't permit it. Otherwise (no turn
    // preference) fill lanes from a rotating start so they fill evenly.
    let chosenLane = -1;
    const order: number[] =
      preferred >= 0
        ? [preferred]
        : Array.from({ length: entryLaneCount }, (_, k) => (spawnLaneRot + k) % entryLaneCount);
    for (const lane of order) {
      probe.laneIndex = lane;
      if (clearAhead(probe, closed).clear > STOP_EPS) {
        chosenLane = lane;
        break;
      }
    }
    if (chosenLane < 0) return false; // preferred/all lanes blocked — wait, don't stack
    spawnLaneRot++;
    const kind = pickKind();
    const length = specLength(vehicleSpec(kind, carLength));
    // Draw this car's preferred speed uniformly in [1-spread, 1+spread]·carSpeed
    // from the seeded RNG (per-car speed sequence stays reproducible for a seed).
    const speed = carSpeed * (1 - speedSpread + rng() * 2 * speedSpread);
    const spawnExit = routeAwareExitForSpawn(entry.coord, entry.entryPort, routePlan);
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
      overtaker: driverRng() < overtakeFraction,
      heldSec: 0,
      overtakePhase: "none",
      overtakeOf: null,
      overtakeHomeLane: chosenLane,
      destination,
    });
    return true;
  }

  function segLen(seg: RoadSegment): number {
    return segmentLength(seg.entryPort, seg.exitPort ?? seg.entryPort, 1);
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

  return {
    step(dt: number, closed: CrossingClosed) {
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
    junctionOccupancy() {
      const out: Record<string, string> = {};
      for (const c of cars) {
        for (const tileId of bodyTileIds(c)) {
          if (isRoadJunction(level[tileId]?.road)) out[tileId] = c.id;
        }
      }
      return out;
    },
  };
}
