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
  speed?: number; // tiles per second
  // Per-unit lengths in tiles: index 0 is the loco, then one entry per wagon.
  // Derived from sprite pixel widths / tileSize (see trainDimensions.ts). When
  // omitted, every unit falls back to DEFAULT_UNIT_LENGTH.
  unitLengths?: number[];
  // Gap between coupled units, in tiles. Defaults to DEFAULT_COUPLING.
  coupling?: number;
}

// "parking" is the transient glide where a train that has matched a depot keeps
// moving forward so its whole body slides into the depot (clearing the approach
// tiles) before it freezes as "parked".
export type TrainState = "running" | "parking" | "parked";

export interface SimTrain {
  id: string;
  color: string;
  type: "people" | "fraight";
  wagonCount: number;
  speed: number;
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
}

export interface SampledUnit {
  coord: Coordinates;
  entryPort: Port;
  exitPort: Port | null;
  t: number; // 0..1 progress within the tile segment
}

export interface Simulation {
  trains: Record<string, SimTrain>;
  step(dt: number): SimEvent[];
  trainTileId(id: string): string;
  trainProgress(id: string): number;
  trainState(id: string): TrainState;
  // Positions of the loco (index 0) and each wagon along the recent path,
  // for the renderer to map to screen points.
  sampleTrain(id: string): SampledUnit[];
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
    return !!tile && tile.role === "depot";
  }

  const trains: Record<string, SimTrain> = {};
  for (const init of config.trains) {
    const exitPort = resolveExitPort(level, getSwitch, init.coord, init.entryPort);
    const unitLengths =
      init.unitLengths ??
      Array.from({ length: 1 + init.wagonCount }, () => DEFAULT_UNIT_LENGTH);
    const coupling = init.coupling ?? DEFAULT_COUPLING;
    const { unitOffsets, bodyLength } = computeBody(unitLengths, coupling);
    trains[init.id] = {
      id: init.id,
      color: init.color,
      type: init.type,
      wagonCount: init.wagonCount,
      speed: init.speed ?? DEFAULT_SPEED,
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
    // While parking, headProgress runs past 1 so the tail advances into the
    // depot and the approach tiles it used to cover are freed for other trains.
    const headDistance = train.headIndex + train.headProgress;
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
    train.state = "running";
  }

  function advance(train: SimTrain, dt: number, events: SimEvent[]): void {
    if (train.state === "parked") return;
    if (train.state === "parking") {
      // The loco is already at the depot centre. Keep driving the whole consist
      // forward — sampling clamps every unit to the centre as it catches up —
      // until the tail has slid off the approach tiles (headProgress reaches the
      // body length), then freeze. This is what stops the loco from halting at
      // the entrance and blocking trains behind it.
      train.headProgress += train.speed * dt;
      if (train.headProgress >= train.bodyLength) {
        train.headProgress = train.bodyLength;
        train.state = "parked";
      }
      return;
    }
    train.headProgress += train.speed * dt;
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
          } else {
            bounceOutOfDepot(train, head.coord);
          }
          break;
        }
        // Map edge / dead end: hold at the end of the current tile.
        train.headProgress = 1;
        break;
      }
      const headTileId = getCoordinatesId(head.coord);
      const nextTileId = getCoordinatesId(t.next.coord);

      // Manual hold forces a signal to Stop.
      if (
        t.exitPort !== null &&
        isSignalTile(headTileId) &&
        manualHold.has(`${headTileId}:${t.exitPort}`)
      ) {
        train.headProgress = 1;
        break;
      }

      // A player-forced green at the signal we're leaving overrides the
      // reservation-based red: we may enter even if the block is reserved by
      // another train. The occupancy backstop below still applies.
      const forcedGreen =
        t.exitPort !== null &&
        isSignalTile(headTileId) &&
        manualProceed.has(`${headTileId}:${t.exitPort}`);

      // Entering a tile not already reserved by us means entering a new block:
      // reserve the whole route to the next signal, or hold (the signal is Stop).
      // We always (re)derive the block from the *current* switch state, so a
      // switch change re-plans the route even for a train re-checking each tick.
      if (reservations.get(nextTileId) !== train.id) {
        const block = routeToNextSignal(
          level,
          getSwitch,
          isBoundary,
          head.coord,
          head.entryPort
        );
        const reservable =
          block.length > 0 &&
          block.every(tid => tileFreeForTrain(tid, train.id));
        if (!reservable && !forcedGreen) {
          train.headProgress = 1;
          break;
        }
        // Reserve whatever we can (tiles free for us); under a forced green some
        // tiles may be reserved by another train — we do not steal those, we
        // just proceed, and the occupancy backstop guards each step.
        for (const tid of block) {
          if (tileFreeForTrain(tid, train.id)) reservations.set(tid, train.id);
        }
      }

      // Occupancy backstop (covers unsignalled adjacency).
      if (isTileOccupiedByOther(nextTileId, train.id)) {
        train.headProgress = 1;
        break;
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
    sampleTrain(id: string) {
      const train = trains[id];
      const headDistance = train.headIndex + train.headProgress;
      const sampleAt = (distance: number): SampledUnit => {
        const clamped = Math.max(0, Math.min(distance, headDistance));
        let idx = Math.floor(clamped);
        let t = clamped - idx;
        if (idx >= train.path.length) {
          idx = train.path.length - 1;
          t = 1;
        }
        const seg = train.path[idx];
        return {
          coord: seg.coord,
          entryPort: seg.entryPort,
          exitPort: seg.exitPort,
          t,
        };
      };
      // Each unit's centre trails the loco head by its precomputed offset, so
      // spacing reflects real sprite lengths (+ coupling gap), not a constant.
      return train.unitOffsets.map(offset => sampleAt(headDistance - offset));
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
