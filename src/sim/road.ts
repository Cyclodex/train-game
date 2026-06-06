import { Coordinates, Position } from "@/types";
import { Level, PortPair, partnersOf } from "@/tiles/model";
import { Port, neighborCoord, oppositePort } from "./topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { segmentLength } from "./pathGeometry";
import { makeRng } from "@/utils/globalHelpers";

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
  speed: number; // cruise (max) speed, tiles/sec — the velocity cap
  velocity: number; // current speed, ramps between 0 and `speed`
  accel: number; // acceleration rate, tiles/sec²
  brake: number; // deceleration rate, tiles/sec²
  length: number; // body length in tiles (for the front/rear render chord)
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
export interface CarChord {
  id: string;
  front: CarSample;
  rear: CarSample;
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
  // Car cruise speed in tiles/sec and body length in tiles. Defaults below.
  carSpeed?: number;
  carLength?: number;
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
  cars(): { id: string; tileId: string; headIndex: number; headProgress: number }[];
  // Each live car sampled as a front/rear chord for the renderer.
  sample(): CarChord[];
}

const DEFAULT_SPAWN_INTERVAL = 2.5;
const DEFAULT_CAR_SPEED = 0.6;
// Default body length in tiles. Matches the rendered ~46px sprite at the 200px
// tile size (game.ts passes an exact value derived from CAR_SPRITE_PX); kept in
// sync so the simulated body never out-sizes the visible car.
const DEFAULT_CAR_LENGTH = 0.23;
const DEFAULT_MAX_CARS = 40;
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
  const maxCars = config.maxCars ?? DEFAULT_MAX_CARS;

  const entries = config.spawnEntries ?? roadEntries(level, width, height);
  const cars: Car[] = [];
  let nextId = 0;
  let spawnClock = 0;

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

  // A car's head and rear anchor points as { tileId, entry, t } — the two ends of
  // its body, used as obstacles other cars must not roll into.
  function bodyPoints(car: Car): { tileId: string; entry: Port; t: number }[] {
    const head = car.path[car.headIndex];
    const rearDist = Math.max(0, car.headIndex + car.headProgress - car.length);
    const rearIdx = Math.floor(rearDist + 1e-9);
    const rear = car.path[rearIdx];
    return [
      {
        tileId: getCoordinatesId(head.coord),
        entry: head.entryPort,
        t: car.headProgress,
      },
      {
        tileId: getCoordinatesId(rear.coord),
        entry: rear.entryPort,
        t: rearDist - rearIdx,
      },
    ];
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
    let clear = CAR_LOOKAHEAD;
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
    return Math.max(0, clear);
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
    cars.push({
      id: `car${nextId++}`,
      speed: carSpeed,
      velocity: 0,
      accel: DEFAULT_CAR_ACCEL,
      brake: DEFAULT_CAR_BRAKE,
      length: carLength,
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
      }));
    },
    sample() {
      return cars.map(c => ({
        id: c.id,
        front: sampleAtArc(c, 0),
        rear: sampleAtArc(c, c.length),
      }));
    },
  };
}
