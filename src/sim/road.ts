import { Coordinates, Position } from "@/types";
import { Level, PortPair, isLevelCrossing, partnersOf } from "@/tiles/model";
import { Port, neighborCoord, oppositePort } from "./topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { segmentLength } from "./pathGeometry";
import { makeRng } from "@/utils/globalHelpers";

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
  const partners = partnersOf(tile.road, entryPort);
  if (partners.length === 0) return null;
  // Single partner (straight/curve) — or pick the first for a road junction.
  return partners[0];
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
  // The next tile must actually carry road back to us, else it's not connected.
  if (partnersOf(nextTile.road, oppositePort(exitPort)).length === 0)
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
      // `port` is a road port of this tile and points off the grid (no in-grid
      // road neighbour continuing the road there) -> a spawn entry.
      if (partnersOf(tile.road, port).length === 0) continue;
      const n = neighborCoord(coord, port)!;
      const offGrid = n.x < 0 || n.y < 0 || n.x >= width || n.y >= height;
      const neigh = level[getCoordinatesId(n)];
      const neighRoad =
        !offGrid && neigh?.road && partnersOf(neigh.road, oppositePort(port)).length > 0;
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
}

// A car sampled as its two anchor points along the recent path (front toward the
// direction of travel, rear behind), mirroring the train UnitChord so the
// renderer draws + angles it the same way.
export interface CarSample {
  coord: Coordinates;
  entryPort: Port;
  exitPort: Port | null;
  t: number; // 0..1 progress within the tile segment
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
}

// Closed ⇔ this tile is a crossing reserved/occupied by a train. Supplied by the
// caller (simulation.ts) from the existing rail reservation/occupancy — no new
// interlocking lives here.
export type CrossingClosed = (tileId: string) => boolean;

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
  // Cap so a busy junction of entries can't spawn an unbounded number of cars.
  maxCars?: number;
  // Spawn only from these entries instead of every map-edge road opening. Used to
  // make a single-lane road effectively one-way (spawn from one end only), which
  // avoids a head-on deadlock on a shared straight road until a direction model
  // exists. Defaults to all auto-detected entries.
  spawnEntries?: RoadEntry[];
}

export interface RoadSim {
  step(dt: number, closed: CrossingClosed): void;
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
const CAR_GAP = 0.03;
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

// A road junction tile: two roads cross (or meet) here, so more than the two
// ports of a plain straight/curve are paved. Cars must claim such a tile
// exclusively — never roll into one another car already occupies — or two
// perpendicular streams gridlock in the middle of the intersection.
function isRoadJunction(road: PortPair[] | undefined): boolean {
  if (!road || road.length < 2) return false;
  const ports = new Set<Port>();
  for (const [a, b] of road) {
    ports.add(a);
    ports.add(b);
  }
  return ports.size > 2;
}

export function createRoadSim(config: RoadSimConfig): RoadSim {
  const { level, width, height } = config;
  const rng = makeRng(config.seed ?? 1);
  const spawnInterval = config.spawnInterval ?? DEFAULT_SPAWN_INTERVAL;
  const carSpeed = config.carSpeed ?? DEFAULT_CAR_SPEED;
  const carLength = config.carLength ?? DEFAULT_CAR_LENGTH;
  const speedSpread = Math.max(0, config.speedSpread ?? DEFAULT_SPEED_SPREAD);
  const maxCars = config.maxCars ?? DEFAULT_MAX_CARS;
  const mix = config.mix ?? { car: 1 };

  const entries = config.spawnEntries ?? roadEntries(level, width, height);
  const cars: Car[] = [];
  let nextId = 0;
  let spawnClock = 0;

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
      const t = roadTraverse(level, coord, entry);
      if (!t.next) break; // map edge / road end
      const id = getCoordinatesId(t.next.coord);
      if (!route.has(id)) route.set(id, { lead, entry: t.next.entryPort });
      lead += 1;
      coord = t.next.coord;
      entry = t.next.entryPort;
    }
    return route;
  }

  // The anchor points along a car's whole body as { tileId, entry, t }, used as
  // obstacles other cars must not roll into. Sampling the entire body (head back
  // to the exact tail at BODY_SAMPLE_STEP spacing) — not just the two ends —
  // means a long trailer that spans a junction tile mid-body still puts a point
  // on it, so a crossing car sees it occupied and holds off the tile.
  function bodyPoints(car: Car): { tileId: string; entry: Port; t: number }[] {
    const pts: { tileId: string; entry: Port; t: number }[] = [];
    for (let a = 0; a < car.length; a += BODY_SAMPLE_STEP) {
      const s = sampleAtArc(car, a);
      pts.push({ tileId: getCoordinatesId(s.coord), entry: s.entryPort, t: s.t });
    }
    const tail = sampleAtArc(car, car.length); // always include the exact tail
    pts.push({ tileId: getCoordinatesId(tail.coord), entry: tail.entryPort, t: tail.t });
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
  ): { d: number; lead: number; perpendicular: boolean } | null {
    const hit = route.get(p.tileId);
    if (!hit) return null;
    let within: number;
    let perpendicular = false;
    if (p.entry === hit.entry) within = p.t;
    else if (p.entry === oppositePort(hit.entry)) within = 1 - p.t;
    else {
      within = 0.5; // perpendicular junction occupant: treat as mid-tile
      perpendicular = true;
    }
    return { d: hit.lead + within, lead: hit.lead, perpendicular };
  }

  // The clear tile-distance the car's head may advance this tick before it must
  // stop: short of a closed crossing's entry edge, or a CAR_GAP behind the
  // nearest point of any other car's body that lies ahead on its route. Capped at
  // the look-ahead. Read-only. This replaces the old whole-tile occupancy gate so
  // cars pack bumper-to-bumper instead of stopping a full tile apart.
  function clearAhead(car: Car, closed: CrossingClosed): number {
    const route = forwardRoute(car);
    // Start unbounded and track the nearest real stop (gate / car / junction).
    // Keeping it unbounded (rather than capped at the look-ahead) lets the
    // keep-crossing-clear step below tell "an obstacle sits exactly a look-ahead
    // away" apart from "open road", which matters when a jam is one tile past a
    // crossing that sits at the edge of the look-ahead.
    let clear = Number.POSITIVE_INFINITY;
    // Closed crossing ahead: stop at its entry edge (the car is already past the
    // entry of its own head tile, whose lead is negative, so it is never gated by
    // a crossing it is currently sitting on).
    for (const [tileId, { lead }] of route) {
      if (lead >= 0 && closed(tileId)) clear = Math.min(clear, lead);
    }
    // Other cars: stop a gap behind the nearest body point ahead on the route.
    for (const other of cars) {
      if (other === car) continue;
      for (const p of bodyPoints(other)) {
        const proj = projectPoint(route, p);
        if (!proj || proj.d < 0) continue;
        if (proj.perpendicular && isRoadJunction(level[p.tileId]?.road)) {
          // The occupant is crossing our path inside a junction. Hold a gap short
          // of the junction's entry edge instead of rolling in (the mid-tile
          // projection is what lets two perpendicular streams jam in the middle of
          // the crossing; stopping *exactly* on the entry would still roll us onto
          // the boundary the same tick another car claimed it). One car owns the
          // junction at a time; everyone else waits clear of it.
          clear = Math.min(clear, Math.max(0, proj.lead - CAR_GAP));
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
    return Math.max(0, Math.min(clear, CAR_LOOKAHEAD));
  }

  function advance(car: Car, dt: number, closed: CrossingClosed): boolean {
    const clear = clearAhead(car, closed);
    let move: number;
    if (clear <= STOP_EPS) {
      // Fully stopped (queue / closed gate / occupied junction ahead): hold, and
      // arm the launch reaction so the car waits a beat once the way reopens.
      car.launchTimer = REACTION_DELAY;
      car.velocity = 0;
      move = 0;
    } else if (car.launchTimer > 0) {
      // The way ahead just cleared but the driver hasn't reacted yet — sit still
      // while the leader pulls away, so the queue stretches out on release.
      car.launchTimer = Math.max(0, car.launchTimer - dt);
      car.velocity = 0;
      move = 0;
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
      move = Math.min(car.velocity * dt, clear); // never roll past the stop line
    }
    car.headProgress += move;
    while (car.headProgress >= 1) {
      const head = car.path[car.headIndex];
      const t = roadTraverse(level, head.coord, head.entryPort);
      if (!t.next) {
        // Reached a road end / map edge: the car has driven its head off the
        // grid — signal the caller to despawn it.
        return false;
      }
      // Backstop: clearAhead caps movement at a closed crossing's entry, which
      // can land headProgress exactly on the boundary — never cross onto it.
      if (closed(getCoordinatesId(t.next.coord))) {
        car.headProgress = 1;
        break;
      }
      const exit = roadExitPort(level, t.next.coord, t.next.entryPort);
      car.path.push({
        coord: t.next.coord,
        entryPort: t.next.entryPort,
        exitPort: exit,
      });
      car.headIndex += 1;
      car.headProgress -= 1;
    }
    return true;
  }

  function trySpawn(closed: CrossingClosed): void {
    if (entries.length === 0 || cars.length >= maxCars) return;
    // Pick an entry deterministically; only spawn if its tile is free (no car on
    // it and not a closed crossing) so we never spawn into another car.
    const entry = entries[Math.floor(rng() * entries.length)];
    const id = getCoordinatesId(entry.coord);
    if (closed(id)) return;
    for (const c of cars) {
      if (bodyTileIds(c).has(id)) return; // entry tile occupied
    }
    const exit = roadExitPort(level, entry.coord, entry.entryPort);
    const kind = pickKind();
    const length = specLength(vehicleSpec(kind, carLength));
    // Draw this car's preferred speed uniformly in [1-spread, 1+spread]·carSpeed
    // from the seeded RNG, so the spawn order (and thus which car is the slow
    // leader of a forming platoon) stays reproducible for a given seed.
    const speed = carSpeed * (1 - speedSpread + rng() * 2 * speedSpread);
    cars.push({
      id: `car${nextId++}`,
      kind,
      speed,
      velocity: 0,
      accel: DEFAULT_CAR_ACCEL,
      brake: DEFAULT_CAR_BRAKE,
      length,
      path: [{ coord: entry.coord, entryPort: entry.entryPort, exitPort: exit }],
      headIndex: 0,
      headProgress: 0,
      launchTimer: 0,
    });
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
      spawnClock += dt;
      // One spawn attempt per spawnInterval of sim time (deterministic cadence).
      while (spawnClock >= spawnInterval) {
        spawnClock -= spawnInterval;
        trySpawn(closed);
      }
      // Advance cars in a stable order; despawn any that drove off the map.
      for (let i = cars.length - 1; i >= 0; i--) {
        const alive = advance(cars[i], dt, closed);
        if (!alive) cars.splice(i, 1);
      }
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
          units.push({
            front: sampleAtArc(c, lead),
            rear: sampleAtArc(c, lead + seg.length),
            lengthTiles: seg.length,
            part: seg.part,
          });
          lead += seg.length + spec.gap;
        }
        return { id: c.id, units };
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
