import { Coordinates, Position } from "@/types";
import { Level, parseCoordId } from "@/tiles/model";
import { Port, oppositePort } from "./topology";
import {
  SwitchResolver,
  resolveExitPort,
  traverse,
  routeToNextSignal,
} from "./network";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { segmentLength } from "./pathGeometry";
import { trainDynamics } from "./physics";

export interface Segment {
  coord: Coordinates;
  entryPort: Port;
  exitPort: Port | null;
}

export interface TrainInit {
  id: string;
  coord: Coordinates;
  entryPort: Port;
  color: string;
  type: "people" | "fraight";
  wagonCount: number;
  speed?: number; // cruise (max) speed, tiles per second
  // Acceleration / braking rates in tiles/sec². When omitted they are derived
  // from the train's type + wagonCount (heavier trains ramp more gently) via
  // trainDynamics() in physics.ts.
  accel?: number;
  brake?: number;
  // Per-unit lengths in tiles: index 0 is the loco, then one entry per wagon.
  // Derived from sprite pixel widths / tileSize (see trainDimensions.ts). When
  // omitted, every unit falls back to DEFAULT_UNIT_LENGTH.
  unitLengths?: number[];
  // Gap between coupled units, in tiles. Defaults to DEFAULT_COUPLING.
  coupling?: number;
}

// "waiting" is a train sitting in its depot with the brake on, waiting for the
// player to send it (Train Valley's "Zug wartet. Per Klick losschicken."). It is
// OPT-IN — `SimConfig.waitForDispatch` — so every board authored before dispatch
// existed still departs the moment the level starts.
// "parking" is the transient glide where a train that has matched a depot keeps
// moving forward so its whole body slides into the depot (clearing the approach
// tiles) before it freezes as "parked".
export type TrainState = "waiting" | "running" | "parking" | "parked";

export interface SimTrain {
  id: string;
  color: string;
  type: "people" | "fraight";
  wagonCount: number;
  speed: number; // cruise (max) speed, tiles/sec — the velocity cap
  // Momentum model (all tiles & tiles/sec / tiles/sec²):
  velocity: number; // current speed, ramps between 0 and `speed`
  accel: number; // acceleration rate
  brake: number; // deceleration rate
  lookAhead: number; // how far ahead to scan for stop points (braking distance + 1)
  // Per-unit lengths (loco first, then wagons) and the coupling gap, in tiles.
  unitLengths: number[];
  coupling: number;
  // Center-to-center distance from the loco head to each unit's centre, in
  // tiles (unitOffsets[0] = half the loco). Precomputed from unitLengths.
  unitOffsets: number[];
  bodyLength: number; // head-to-tail length of loco + wagons, in tiles
  state: TrainState;
  path: Segment[];
  headIndex: number;
  headProgress: number; // 0..1 within path[headIndex]
}

export interface ArrivedEvent {
  type: "arrived";
  trainId: string;
  tileId: string;
  matched: boolean;
}

// A train claimed a block (the route up to the next signal). `tiles` are the
// tile ids it reserved on this crossing.
export interface ReservedEvent {
  type: "reserved";
  trainId: string;
  tiles: string[];
}

// Why a train is held at a tile boundary.
//  - "signal-hold": the player forced this signal to Stop.
//  - "reservation": the block ahead is reserved/occupied by another train.
//  - "occupancy":   the very next tile is physically occupied (backstop).
export type BlockReason = "signal-hold" | "reservation" | "occupancy";

// A train transitioned from moving to held (edge-triggered: emitted once when
// it becomes blocked, not every tick it stays blocked). `blockedBy` is the
// other train responsible, when there is one.
export interface BlockedEvent {
  type: "blocked";
  trainId: string;
  tileId: string;
  reason: BlockReason;
  blockedBy?: string;
}

// A previously-blocked train started moving again (edge-triggered).
export interface ProceedingEvent {
  type: "proceeding";
  trainId: string;
  tileId: string;
}

export type SimEvent =
  | ArrivedEvent
  | ReservedEvent
  | BlockedEvent
  | ProceedingEvent;

// Internal record of why a train is currently held, used to edge-trigger the
// blocked/proceeding events (only emit on a change of state).
export interface BlockInfo {
  reason: BlockReason;
  tileId: string;
  blockedBy?: string;
}

// Fallbacks when a train doesn't supply real per-unit dimensions: a unit sprite
// is ~half a tile wide, with a small coupling gap. The renderer passes true
// lengths derived from the sprite pixel widths (see trainDimensions.ts) so
// couplings line up regardless of wagon type/width.
const DEFAULT_UNIT_LENGTH = 0.5;
const DEFAULT_COUPLING = 0;

// Each car is positioned/angled on two anchor points (its "bogies") set in from
// the body ends by this fraction of the car's length, like real wheels. Anchoring
// at the very tips made long sprites swing off the rail on tight curves; insetting
// the anchors lets the body hug the track (with a natural overhang at the ends).
// Visual only — tune to taste; 0 = anchor at the tips (old behaviour).
export const BOGIE_INSET_FRAC = 0.2;

// Per-unit centre offsets (from the loco head) and the head-to-tail body length,
// all in tiles. The loco head sits at the train's headDistance; unit i's centre
// trails by half the loco + (full lengths + gaps of the units between) + half
// of unit i. The body length is the head of the loco to the tail of the last
// unit: sum of all unit lengths plus a coupling gap between each pair.
function computeBody(unitLengths: number[], coupling: number): {
  unitOffsets: number[];
  bodyLength: number;
} {
  const unitOffsets: number[] = [];
  let cursor = 0; // running distance from the loco's head to the current edge
  for (let i = 0; i < unitLengths.length; i++) {
    if (i > 0) cursor += coupling;
    unitOffsets.push(cursor + unitLengths[i] / 2);
    cursor += unitLengths[i];
  }
  return { unitOffsets, bodyLength: cursor };
}

export type SignalAspect = "stop" | "proceed";

export interface SimConfig {
  level: Level;
  trains: TrainInit[];
  getSwitch?: SwitchResolver;
  // Tile ids that carry a signal — block boundaries. Depots are boundaries too.
  signalTiles?: string[];
  depotColors?: Record<string, string>;
  // Opt-in dispatch: trains are created in state "waiting" and stay put — no
  // movement, no reservations — until `dispatch(id)` sends them.
  //
  // DEFAULT OFF, and it must stay that way. Every level, /test scenario and unit
  // test written before this assumes a train leaves its depot on the first tick;
  // flipping the default would silently freeze all of them. Only a mode that
  // asks for it (`ModeControls.dispatch`) turns it on.
  waitForDispatch?: boolean;
}

export interface SampledUnit {
  coord: Coordinates;
  entryPort: Port;
  exitPort: Port | null;
  t: number; // 0..1 progress within the tile segment
}

// A unit (loco or wagon) sampled as its two anchor ("bogie") points on the path:
// `front` toward the loco head, `rear` toward the tail, each set in from the body
// ends by BOGIE_INSET_FRAC. The renderer draws the car centred on their midpoint
// and angled along their chord (full sprite length, overhanging the anchors), so a
// rigid sprite hugs the rail on curves like a real car on its wheels.
export interface UnitChord {
  front: SampledUnit;
  rear: SampledUnit;
}

export interface Simulation {
  trains: Record<string, SimTrain>;
  step(dt: number): SimEvent[];
  trainTileId(id: string): string;
  trainProgress(id: string): number;
  trainState(id: string): TrainState;
  // Current speed of a train in tiles/sec (0 when stopped). Exposed for tests
  // and future speed-aware signalling.
  trainVelocity(id: string): number;
  // The loco (index 0) and each wagon sampled as front/rear coupler points along
  // the recent path, for the renderer to draw each car as a chord.
  sampleTrain(id: string): UnitChord[];
  // Inject a new train mid-run. Builds the same SimTrain structure the init
  // path builds, so the train departs its depot exactly like one present at t=0.
  // Deterministic and side-effect-free for existing trains: it touches no
  // reservations/occupancy (the new train claims its block on its first
  // crossing, like any other). Throws if a train with that id already exists.
  addTrain(init: TrainInit): void;
  // Send a waiting train (only meaningful under `waitForDispatch`). Returns true
  // if this call actually released it — false for an unknown train or one that
  // is already running/parking/parked, so a double click cannot restart anything.
  dispatch(id: string): boolean;
  // The trains currently waiting for the player, in a stable (sorted) order.
  waitingTrains(): string[];
  // Why this train is currently held, or undefined if it is free to move. The
  // sim already tracks this to edge-trigger blocked/proceeding events; exposing
  // it lets the view tell a DEADLOCK (everything waiting on everything) apart
  // from the player deliberately holding a signal, which look identical from
  // outside — both are trains standing still.
  trainBlock(id: string): Readonly<BlockInfo> | undefined;
  // The signal aspect for leaving `tileId` through `exitPort` (for rendering).
  signalAspect(tileId: string, exitPort: Port): SignalAspect;
  // The train (if any) that has reserved `tileId` — for the debug overlay.
  reservedBy(tileId: string): string | undefined;
  // The train (if any) physically on `tileId` right now — for the switch lock.
  occupiedBy(tileId: string): string | undefined;
  // Trains STRANDED on this tile: the head sits here and there is no onward
  // connection from the port it came in through. Such a train has committed to
  // no exit, which is precisely what makes it safe to lay track under it — the
  // editor's "you cannot build where a train is" rule would otherwise make a
  // dead-ended train unrescuable from the side it is stuck on.
  strandedOn(tileId: string): string[];
  // Re-derive a stranded train's head exit after the level gained the track it
  // was waiting for, so it can leave — and so the renderer stops drawing it
  // along the stub it dead-ended on. Never rewrites a committed exit.
  releaseStranded(trainId: string): void;
  // Player-forced Stop hold on a signal.
  toggleHold(tileId: string, exitPort: Port): void;
  isHeld(tileId: string, exitPort: Port): boolean;
  // Player-forced Proceed (green) override on a signal. Bypasses the
  // reservation-based red so a train can break a reservation standoff, but the
  // physical occupancy backstop still applies (no driving into another body).
  // Mutually exclusive with the Stop hold.
  forceProceed(tileId: string, exitPort: Port): void;
  isProceedForced(tileId: string, exitPort: Port): boolean;
}

// Cruise speed in tiles/sec. Exported because the fare model prices a delivery
// against its IDEAL travel time (`modes/tycoon.ts`), and a second copy of this
// number would silently mis-price every fare the day it is retuned here.
export const DEFAULT_SPEED = 0.5;

export function createSimulation(config: SimConfig): Simulation {
  const { level } = config;
  const getSwitch: SwitchResolver = config.getSwitch ?? (() => undefined);
  const depotColors: Record<string, string> = config.depotColors ?? {};
  // Signals are read from the LEVEL, not snapshotted, so a signal built or
  // removed while the game runs is seen on the very next tick — the same way
  // `traverse` already reads `level` live. `config.signalTiles` stays as an
  // additive override for tests that mark boundaries on cells which carry no
  // `signals` of their own; the two are unioned rather than either winning.
  const explicitSignalTiles = new Set(config.signalTiles ?? []);

  // tileId -> trainId that has reserved it (route/block reservation).
  const reservations = new Map<string, string>();
  // `${tileId}:${exitPort}` of signals the player has forced to Stop.
  const manualHold = new Set<string>();
  // `${tileId}:${exitPort}` of signals the player has forced to Proceed (green).
  // A forced-green signal overrides the reservation-based red; the occupancy
  // backstop still applies. Mutually exclusive with `manualHold`.
  const manualProceed = new Set<string>();

  // trainId -> why it is currently held (or absent if it is moving). Used to
  // edge-trigger blocked/proceeding events so they fire once per state change.
  const blockStates = new Map<string, BlockInfo>();

  const isSignalTile = (tileId: string) =>
    explicitSignalTiles.has(tileId) || (level[tileId]?.signals?.length ?? 0) > 0;
  function isBoundary(tileId: string): boolean {
    if (isSignalTile(tileId)) return true;
    const tile = level[tileId];
    return !!tile && tile.role === "depot";
  }

  // Build the SimTrain for an init descriptor. The single source of truth for a
  // train's runtime shape, used both at construction and by addTrain() so a
  // mid-run injection is byte-for-byte the same as an init train (same segments,
  // body, placement and starting state). Pure: it reads the level/switch state
  // but mutates nothing, so it can't disturb existing trains.
  function buildTrain(init: TrainInit): SimTrain {
    const exitPort = resolveExitPort(level, getSwitch, init.coord, init.entryPort);
    const unitLengths =
      init.unitLengths ??
      Array.from({ length: 1 + init.wagonCount }, () => DEFAULT_UNIT_LENGTH);
    const coupling = init.coupling ?? DEFAULT_COUPLING;
    const { unitOffsets, bodyLength } = computeBody(unitLengths, coupling);
    const maxSpeed = init.speed ?? DEFAULT_SPEED;
    // Per-train accel/brake: explicit if supplied, else derived from mass.
    const derived = trainDynamics(init.type, init.wagonCount);
    const accel = init.accel ?? derived.accel;
    const brake = init.brake ?? derived.brake;
    // Scan far enough ahead to cover the braking distance from cruise (so a
    // train never brakes for something beyond where it could matter, and never
    // brakes spuriously on open track), plus a one-tile margin.
    const lookAhead = brake > 0 ? maxSpeed ** 2 / (2 * brake) + 1 : 1;
    return {
      id: init.id,
      color: init.color,
      type: init.type,
      wagonCount: init.wagonCount,
      speed: maxSpeed,
      velocity: 0,
      accel,
      brake,
      lookAhead,
      unitLengths,
      coupling,
      unitOffsets,
      bodyLength,
      state: config.waitForDispatch ? "waiting" : "running",
      path: [{ coord: init.coord, entryPort: init.entryPort, exitPort }],
      headIndex: 0,
      headProgress: 0,
    };
  }

  const trains: Record<string, SimTrain> = {};
  for (const init of config.trains) {
    trains[init.id] = buildTrain(init);
  }

  // The set of tile ids a train's body currently covers (head back to tail).
  function bodyTileIds(train: SimTrain): Set<string> {
    // While parking, headProgress runs past 1 so the tail advances into the
    // depot and the approach tiles it used to cover are freed for other trains.
    // The dock glide pushes headProgress well past the body length (the depot
    // segment is only half a tile of real arc, so headProgress over-counts there),
    // which would drive tailIndex past the head and report an empty body; clamp it
    // so a fully-swallowed train still occupies exactly its depot tile.
    const headDistance = train.headIndex + train.headProgress;
    const tailIndex = Math.min(
      train.headIndex,
      Math.max(0, Math.floor(headDistance - train.bodyLength + 1e-9))
    );
    const ids = new Set<string>();
    for (let i = tailIndex; i <= train.headIndex; i++) {
      const seg = train.path[i];
      if (seg) ids.add(getCoordinatesId(seg.coord));
    }
    return ids;
  }

  function isTileOccupiedByOther(tileId: string, selfId: string): boolean {
    for (const id of Object.keys(trains)) {
      if (id === selfId) continue;
      if (bodyTileIds(trains[id]).has(tileId)) return true;
    }
    return false;
  }

  // The train (if any) whose body physically covers a tile right now.
  function occupantOf(tileId: string): string | undefined {
    for (const id of Object.keys(trains)) {
      if (bodyTileIds(trains[id]).has(tileId)) return id;
    }
    return undefined;
  }

  function isTileOccupied(tileId: string): boolean {
    return occupantOf(tileId) !== undefined;
  }

  // A tile is enterable by a train if no other train has reserved or occupies it.
  function tileFreeForTrain(tileId: string, selfId: string): boolean {
    const owner = reservations.get(tileId);
    if (owner !== undefined && owner !== selfId) return false;
    return !isTileOccupiedByOther(tileId, selfId);
  }

  // Release reservations the train no longer needs: anything it has reserved that
  // is neither under its body nor in the block still ahead of it.
  function releaseStaleReservations(train: SimTrain): void {
    const keep = bodyTileIds(train);
    if (train.state === "running") {
      const head = train.path[train.headIndex];
      for (const tid of routeToNextSignal(
        level,
        getSwitch,
        isBoundary,
        head.coord,
        head.entryPort
      )) {
        keep.add(tid);
      }
    }
    for (const [tid, owner] of reservations) {
      if (owner === train.id && !keep.has(tid)) reservations.delete(tid);
    }
  }

  // The aspect shown by the signal guarding the block beyond `exitPort`.
  function aspect(tileId: string, exitPort: Port): SignalAspect {
    const key = `${tileId}:${exitPort}`;
    if (manualHold.has(key)) return "stop";
    // Forced green: report proceed even if the block ahead is reserved. (The
    // sim still refuses to enter a physically occupied tile — see advance.)
    if (manualProceed.has(key)) return "proceed";
    const tile = level[tileId];
    if (!tile) return "proceed";
    const block = routeToNextSignal(
      level,
      getSwitch,
      isBoundary,
      parseCoordId(tileId),
      oppositePort(exitPort)
    );
    for (const tid of block) {
      if (reservations.has(tid) || isTileOccupied(tid)) return "stop";
    }
    return "proceed";
  }

  // Restart a train at a depot, heading back out the way it came in.
  function bounceOutOfDepot(train: SimTrain, depotCoord: Coordinates): void {
    const outer = resolveExitPort(level, getSwitch, depotCoord, Position.Center);
    train.path = [
      { coord: depotCoord, entryPort: Position.Center, exitPort: outer },
    ];
    train.headIndex = 0;
    train.headProgress = 0;
    train.velocity = 0; // it stopped in the depot; accelerate away from rest
    train.state = "running";
  }

  // The other train responsible for a tile not being free for `selfId`: its
  // reserver if reserved by someone else, otherwise whoever occupies it.
  function blockerOf(tileId: string, selfId: string): string | undefined {
    const owner = reservations.get(tileId);
    if (owner !== undefined && owner !== selfId) return owner;
    return occupantOf(tileId);
  }

  // Record that a train is held this tick. Edge-triggered: emits a `blocked`
  // event only when the train newly becomes blocked or the cause changes.
  function noteBlocked(
    train: SimTrain,
    info: BlockInfo,
    events: SimEvent[]
  ): void {
    const prev = blockStates.get(train.id);
    if (
      !prev ||
      prev.reason !== info.reason ||
      prev.tileId !== info.tileId ||
      prev.blockedBy !== info.blockedBy
    ) {
      blockStates.set(train.id, info);
      events.push({
        type: "blocked",
        trainId: train.id,
        tileId: info.tileId,
        reason: info.reason,
        blockedBy: info.blockedBy,
      });
    }
  }

  // Record that a train is moving freely this tick. Edge-triggered: emits a
  // `proceeding` event only if it was previously blocked.
  function noteProceeding(train: SimTrain, events: SimEvent[]): void {
    if (blockStates.has(train.id)) {
      blockStates.delete(train.id);
      events.push({
        type: "proceeding",
        trainId: train.id,
        tileId: getCoordinatesId(train.path[train.headIndex].coord),
      });
    }
  }

  // Whether `train` may cross the boundary leaving the tile at `head` (a path
  // segment: coord + entryPort) into the next tile. This is the single source of
  // truth for "can I move on?" — both the look-ahead braking scan and the actual
  // crossing in advance() consult it, so they can never disagree. A dead end /
  // map edge / depot arrival, a manual Stop hold, an unreservable block (without
  // a forced green), or a tile physically occupied by another train all block
  // the crossing. Pure: it reads state but writes nothing (no reservations).
  function mayCross(
    train: SimTrain,
    head: { coord: Coordinates; entryPort: Port }
  ): boolean {
    const t = traverse(level, getSwitch, head.coord, head.entryPort);
    if (!t.next) return false; // dead end, map edge, or depot arrival
    const headTileId = getCoordinatesId(head.coord);
    const nextTileId = getCoordinatesId(t.next.coord);

    if (
      t.exitPort !== null &&
      isSignalTile(headTileId) &&
      manualHold.has(`${headTileId}:${t.exitPort}`)
    ) {
      return false;
    }
    const forcedGreen =
      t.exitPort !== null &&
      isSignalTile(headTileId) &&
      manualProceed.has(`${headTileId}:${t.exitPort}`);

    if (reservations.get(nextTileId) !== train.id) {
      const block = routeToNextSignal(
        level,
        getSwitch,
        isBoundary,
        head.coord,
        head.entryPort
      );
      const reservable =
        block.length > 0 && block.every(tid => tileFreeForTrain(tid, train.id));
      if (!reservable && !forcedGreen) return false;
    }
    if (isTileOccupiedByOther(nextTileId, train.id)) return false;
    return true;
  }

  // When mayCross() refuses a crossing, classify *why* for the activity log,
  // mirroring mayCross's checks in the same order. Only called once a train is
  // actually held (the head boundary has a `next`, so the dead-end/depot cases
  // are handled by the caller before this runs).
  function blockReason(
    train: SimTrain,
    head: { coord: Coordinates; entryPort: Port },
    t: ReturnType<typeof traverse>
  ): BlockInfo {
    const headTileId = getCoordinatesId(head.coord);
    const nextTileId = t.next ? getCoordinatesId(t.next.coord) : headTileId;

    if (
      t.exitPort !== null &&
      isSignalTile(headTileId) &&
      manualHold.has(`${headTileId}:${t.exitPort}`)
    ) {
      return { reason: "signal-hold", tileId: headTileId };
    }
    const forcedGreen =
      t.exitPort !== null &&
      isSignalTile(headTileId) &&
      manualProceed.has(`${headTileId}:${t.exitPort}`);

    if (reservations.get(nextTileId) !== train.id) {
      const block = routeToNextSignal(
        level,
        getSwitch,
        isBoundary,
        head.coord,
        head.entryPort
      );
      const reservable =
        block.length > 0 && block.every(tid => tileFreeForTrain(tid, train.id));
      if (!reservable && !forcedGreen) {
        const taken = block.find(tid => !tileFreeForTrain(tid, train.id));
        return {
          reason: "reservation",
          tileId: headTileId,
          blockedBy: taken ? blockerOf(taken, train.id) : undefined,
        };
      }
    }
    // Otherwise the next tile is physically occupied by another train.
    return {
      reason: "occupancy",
      tileId: headTileId,
      blockedBy: occupantOf(nextTileId),
    };
  }

  // Distance (in tiles) the head may roll before it must stop, scanning forward
  // along the live route and capped at the train's lookAhead. Read-only: it makes
  // no reservations (those happen only when the train physically crosses). The
  // scan accumulates the rest of the current tile plus one tile per crossable
  // boundary, stopping at the first boundary mayCross() refuses.
  function clearDistanceAhead(train: SimTrain): number {
    let dist = 1 - train.headProgress;
    let head: { coord: Coordinates; entryPort: Port } = train.path[
      train.headIndex
    ];
    while (dist < train.lookAhead) {
      if (!mayCross(train, head)) break;
      const t = traverse(level, getSwitch, head.coord, head.entryPort);
      if (!t.next) break; // defensive: mayCross already returns false here
      head = { coord: t.next.coord, entryPort: t.next.entryPort };
      dist += 1;
    }
    return Math.min(dist, train.lookAhead);
  }

  function advance(train: SimTrain, dt: number, events: SimEvent[]): void {
    if (train.state === "parked") return;
    // Waiting for the player. It sits on its depot tile (so it still blocks that
    // tile, exactly like a train that has not pulled out yet) but claims no
    // block ahead — a waiting train must not hold a route it isn't using.
    if (train.state === "waiting") return;
    if (train.state === "parking") {
      // The loco is already at the depot centre. Keep driving the whole consist
      // forward — sampling clamps every unit to the centre as it catches up, and
      // the renderer hides each unit once it reaches the centre, so the train
      // slides into the shed instead of halting (loco-first) at the entrance and
      // blocking trains behind it. We're fully docked once the rearmost unit's
      // *rear coupler* reaches the depot centre — the exact point the renderer
      // waits for to hide the car (game.ts: rear.exitPort === Center &&
      // rear.t >= 0.999). Two subtleties:
      //  1. The renderer hides on the REAR bogie, inset by BOGIE_INSET_FRAC, not
      //     the unit centre — so glide until that rear point, not the centre.
      //  2. headProgress is normalised per segment, but the depot segment is only
      //     `depotSegLen` tiles of real arc (half a tile, edge↔centre). Advancing
      //     the rear bogie `rearArc` of real arc up to the centre needs
      //     headProgress to grow by rearArc / depotSegLen. Omitting that divide
      //     (the old `1 + unitOffsets[last]`) left long consists short of the shed.
      const depotSeg = train.path[train.headIndex];
      const depotSegLen = segmentLength(
        depotSeg.entryPort,
        depotSeg.exitPort ?? depotSeg.entryPort,
        1
      );
      const last = train.unitLengths.length - 1;
      const rearArc =
        train.unitOffsets[last] +
        train.unitLengths[last] / 2 -
        train.unitLengths[last] * BOGIE_INSET_FRAC;
      const dockDistance = 1 + rearArc / depotSegLen;
      train.headProgress += train.speed * dt;
      if (train.headProgress >= dockDistance) {
        train.headProgress = dockDistance;
        train.state = "parked";
        train.velocity = 0;
      }
      return;
    }

    // How far we may go before the next stop line, and the fastest we may be
    // travelling now to still brake to rest within it.
    const clear = clearDistanceAhead(train);
    const vSafe = Math.sqrt(2 * train.brake * clear);
    const vCap = Math.min(train.speed, vSafe);

    // Ramp the velocity toward the cap: accelerate below it, brake above it.
    if (train.velocity < vCap) {
      train.velocity = Math.min(vCap, train.velocity + train.accel * dt);
    } else if (train.velocity > vCap) {
      train.velocity = Math.max(vCap, train.velocity - train.brake * dt);
    }
    if (train.velocity < 0) train.velocity = 0;

    // Distance this tick, never past the stop line. We do NOT snap onto the
    // line: velocity is held >= sqrt(2*brake*clear) by the cap above, so the
    // clamp below lands the train on the line within ~2*brake*dt² (sub-pixel)
    // in finite time. An earlier fixed-distance snap teleported a visible few
    // pixels on the final frame while the train still carried speed.
    let move = train.velocity * dt;
    if (move > clear) move = clear;

    train.headProgress += move;

    // Why the train is held at the end of this tick, if it is. Stays null while
    // the train keeps moving; set just before a traffic break below.
    let blockInfo: BlockInfo | null = null;
    while (train.headProgress >= 1) {
      const head = train.path[train.headIndex];
      const t = traverse(level, getSwitch, head.coord, head.entryPort);
      if (!t.next) {
        if (t.exitPort === Position.Center) {
          // Arrived inside a depot.
          const tileId = getCoordinatesId(head.coord);
          const matched = depotColors[tileId] === train.color;
          events.push({ type: "arrived", trainId: train.id, tileId, matched });
          if (matched) {
            // Loco at the depot centre; glide the rest of the body in (see the
            // "parking" branch above) instead of stopping dead at the entrance.
            train.state = "parking";
            train.headProgress = 1;
            train.velocity = 0;
          } else {
            bounceOutOfDepot(train, head.coord);
          }
          break;
        }
        // Map edge / dead end: hold at the end of the current tile.
        train.headProgress = 1;
        break;
      }

      // Single crossing gate (see mayCross). It is also the safety backstop:
      // even if the physics above rounded us a hair past the line, we never
      // actually cross a boundary mayCross() refuses. When it refuses, classify
      // *why* for the activity log, clamp at the stop line and stop scanning;
      // the next tick's clearDistance collapses to ~0 and the velocity brakes.
      if (!mayCross(train, head)) {
        blockInfo = blockReason(train, head, t);
        train.headProgress = 1;
        break;
      }

      // Crossing into a tile not yet reserved by us claims the whole block ahead
      // (route to the next signal), re-derived from the live switch state. Under
      // a forced green some tiles may belong to another train — we take only the
      // ones free for us; the occupancy check in mayCross guards each step.
      const nextTileId = getCoordinatesId(t.next.coord);
      if (reservations.get(nextTileId) !== train.id) {
        const block = routeToNextSignal(
          level,
          getSwitch,
          isBoundary,
          head.coord,
          head.entryPort
        );
        // mayCross already verified this block is enterable. Reserve whatever
        // is free for us; under a forced green some tiles may belong to another
        // train — we do not steal those, the occupancy check in mayCross guards
        // each step.
        const claimed: string[] = [];
        for (const tid of block) {
          if (tileFreeForTrain(tid, train.id)) {
            reservations.set(tid, train.id);
            claimed.push(tid);
          }
        }
        if (claimed.length > 0) {
          events.push({ type: "reserved", trainId: train.id, tiles: claimed });
        }
      }

      const nextExit = resolveExitPort(
        level,
        getSwitch,
        t.next.coord,
        t.next.entryPort
      );
      train.path.push({
        coord: t.next.coord,
        entryPort: t.next.entryPort,
        exitPort: nextExit,
      });
      train.headIndex += 1;
      train.headProgress -= 1;
    }

    // Edge-trigger the blocked/proceeding events from this tick's outcome.
    if (blockInfo) noteBlocked(train, blockInfo, events);
    else noteProceeding(train, events);
  }

  return {
    trains,
    step(dt: number) {
      const events: SimEvent[] = [];
      // Deterministic order so tile reservation between trains is stable.
      for (const id of Object.keys(trains).sort()) {
        advance(trains[id], dt, events);
        releaseStaleReservations(trains[id]);
      }
      return events;
    },
    trainTileId(id: string) {
      const train = trains[id];
      return getCoordinatesId(train.path[train.headIndex].coord);
    },
    trainProgress(id: string) {
      return trains[id].headProgress;
    },
    trainState(id: string) {
      return trains[id].state;
    },
    trainVelocity(id: string) {
      return trains[id].velocity;
    },
    sampleTrain(id: string) {
      const train = trains[id];
      const segLen = (idx: number): number => {
        const s = train.path[idx];
        return segmentLength(s.entryPort, s.exitPort ?? s.entryPort, 1);
      };
      const point = (idx: number, t: number): SampledUnit => {
        const seg = train.path[idx];
        return { coord: seg.coord, entryPort: seg.entryPort, exitPort: seg.exitPort, t };
      };
      // Sample the point that lies `arcBack` of *true path arc length* behind the
      // head, walking segment by segment and subtracting each segment's real
      // length. Curve tiles are ~0.81× a straight, so this keeps coupled cars the
      // intended pixel distance apart instead of bunching up on curves (which
      // happened when distance was counted in normalised per-tile units).
      const sampleAtArc = (arcBack: number): SampledUnit => {
        let idx = train.headIndex;
        // Arc length from the current segment's start up to the head.
        const withinHead = train.headProgress * segLen(idx);
        let remaining = Math.max(0, arcBack);
        if (remaining <= withinHead) {
          return point(idx, (withinHead - remaining) / segLen(idx));
        }
        remaining -= withinHead;
        idx -= 1;
        while (idx >= 0) {
          const L = segLen(idx);
          if (remaining <= L) return point(idx, 1 - remaining / L);
          remaining -= L;
          idx -= 1;
        }
        return point(0, 0); // before the start of the recorded path
      };
      // Each unit is sampled as its two bogie anchor points, set in from the body
      // ends by BOGIE_INSET_FRAC of its length: front bogie at (offset − half +
      // inset) of arc behind the head, rear bogie at (offset + half − inset).
      // Distances are real arc length, so the anchors (and thus the car centres)
      // stay correctly spaced on curves; insetting them keeps the body on the rail.
      return train.unitOffsets.map((offset, i) => {
        const half = train.unitLengths[i] / 2;
        const inset = train.unitLengths[i] * BOGIE_INSET_FRAC;
        return {
          front: sampleAtArc(offset - half + inset),
          rear: sampleAtArc(offset + half - inset),
        };
      });
    },
    addTrain(init: TrainInit) {
      if (trains[init.id]) {
        throw new Error(`addTrain: train "${init.id}" already exists`);
      }
      trains[init.id] = buildTrain(init);
    },
    dispatch(id: string) {
      const train = trains[id];
      if (!train || train.state !== "waiting") return false;
      train.state = "running";
      // Departs from rest like any train leaving a depot — the momentum model
      // ramps it up from 0, so dispatch is a release, not a shove.
      train.velocity = 0;
      return true;
    },
    waitingTrains() {
      return Object.keys(trains)
        .filter(id => trains[id].state === "waiting")
        .sort();
    },
    trainBlock(id: string) {
      return blockStates.get(id);
    },
    signalAspect(tileId: string, exitPort: Port) {
      return aspect(tileId, exitPort);
    },
    reservedBy(tileId: string) {
      return reservations.get(tileId);
    },
    occupiedBy(tileId: string) {
      return occupantOf(tileId);
    },
    strandedOn(tileId: string) {
      const out: string[] = [];
      for (const id of Object.keys(trains)) {
        const train = trains[id];
        if (train.state !== "running") continue; // parking/parked = docking, not stuck
        const head = train.path[train.headIndex];
        if (getCoordinatesId(head.coord) !== tileId) continue;
        // Ask the LEVEL, not the cached exit — the cache is the thing a rescue
        // is about to make stale, and a train held at a red signal (which has
        // somewhere to go) must not be mistaken for one that has nowhere.
        const t = traverse(level, getSwitch, head.coord, head.entryPort);
        if (t.next === null && t.exitPort !== Position.Center) out.push(id);
      }
      return out;
    },
    releaseStranded(trainId: string) {
      const train = trains[trainId];
      if (!train) return;
      const head = train.path[train.headIndex];
      // Only a segment with NO exit is re-derived. A committed exit is the port
      // the train visibly travelled along, and rewriting it would teleport the
      // body onto a different curve.
      if (head.exitPort !== null) return;
      head.exitPort = resolveExitPort(level, getSwitch, head.coord, head.entryPort);
    },
    isHeld(tileId: string, exitPort: Port) {
      return manualHold.has(`${tileId}:${exitPort}`);
    },
    toggleHold(tileId: string, exitPort: Port) {
      const key = `${tileId}:${exitPort}`;
      if (manualHold.has(key)) manualHold.delete(key);
      else {
        manualHold.add(key);
        manualProceed.delete(key); // hold and force-green are mutually exclusive
      }
    },
    isProceedForced(tileId: string, exitPort: Port) {
      return manualProceed.has(`${tileId}:${exitPort}`);
    },
    forceProceed(tileId: string, exitPort: Port) {
      const key = `${tileId}:${exitPort}`;
      if (manualProceed.has(key)) manualProceed.delete(key);
      else {
        manualProceed.add(key);
        manualHold.delete(key); // force-green and hold are mutually exclusive
      }
    },
  };
}
