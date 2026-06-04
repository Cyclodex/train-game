import { LevelDefinition, Coordinates, Position } from "@/types";
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

export type TrainState = "running" | "parked";

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

export type SimEvent = ArrivedEvent;

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
  level: LevelDefinition;
  trains: TrainInit[];
  getSwitch?: SwitchResolver;
  // Tile ids that carry a signal — block boundaries. Depots are boundaries too.
  signalTiles?: string[];
  depotColors?: Record<string, string>;
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
  // The signal aspect for leaving `tileId` through `exitPort` (for rendering).
  signalAspect(tileId: string, exitPort: Port): SignalAspect;
  // The train (if any) that has reserved `tileId` — for the debug overlay.
  reservedBy(tileId: string): string | undefined;
  // The train (if any) physically on `tileId` right now — for the switch lock.
  occupiedBy(tileId: string): string | undefined;
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

const DEFAULT_SPEED = 0.5;

export function createSimulation(config: SimConfig): Simulation {
  const { level } = config;
  const getSwitch: SwitchResolver = config.getSwitch ?? (() => undefined);
  const depotColors: Record<string, string> = config.depotColors ?? {};
  const signalTiles = new Set(config.signalTiles ?? []);

  // tileId -> trainId that has reserved it (route/block reservation).
  const reservations = new Map<string, string>();
  // `${tileId}:${exitPort}` of signals the player has forced to Stop.
  const manualHold = new Set<string>();
  // `${tileId}:${exitPort}` of signals the player has forced to Proceed (green).
  // A forced-green signal overrides the reservation-based red; the occupancy
  // backstop still applies. Mutually exclusive with `manualHold`.
  const manualProceed = new Set<string>();

  const isSignalTile = (tileId: string) => signalTiles.has(tileId);
  function isBoundary(tileId: string): boolean {
    if (signalTiles.has(tileId)) return true;
    const tile = level[tileId];
    return !!tile && tile.component === "TileDepot";
  }

  const trains: Record<string, SimTrain> = {};
  for (const init of config.trains) {
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
    trains[init.id] = {
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
      state: "running",
      path: [{ coord: init.coord, entryPort: init.entryPort, exitPort }],
      headIndex: 0,
      headProgress: 0,
    };
  }

  // The set of tile ids a train's body currently covers (head back to tail).
  function bodyTileIds(train: SimTrain): Set<string> {
    const headDistance = train.headIndex + Math.min(train.headProgress, 1);
    const tailIndex = Math.max(
      0,
      Math.floor(headDistance - train.bodyLength + 1e-9)
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
    if (train.state !== "parked") {
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
      { x: tile.x, y: tile.y },
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
            train.state = "parked";
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

      // Safety backstop: never cross a boundary mayCross() refuses, even if the
      // physics above rounded us a hair past it. Clamp at the stop line; the next
      // tick's clearDistance collapses to ~0 and the velocity brakes to rest.
      if (!mayCross(train, head)) {
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
        for (const tid of block) {
          if (tileFreeForTrain(tid, train.id)) reservations.set(tid, train.id);
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
    signalAspect(tileId: string, exitPort: Port) {
      return aspect(tileId, exitPort);
    },
    reservedBy(tileId: string) {
      return reservations.get(tileId);
    },
    occupiedBy(tileId: string) {
      return occupantOf(tileId);
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
