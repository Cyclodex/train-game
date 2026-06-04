import { LevelDefinition, Coordinates, Position } from "@/types";
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
}

export type TrainState = "running" | "parked";

export interface SimTrain {
  id: string;
  color: string;
  type: "people" | "fraight";
  wagonCount: number;
  speed: number;
  bodyLength: number; // length of loco + wagons, in tiles
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

// Spacing between coupled units (loco + wagons), in tiles. A unit sprite is
// ~half a tile wide, so ~0.5 keeps them coupled rather than strung far apart.
const WAGON_SPACING = 0.5;

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
  // Player-forced Stop hold on a signal.
  toggleHold(tileId: string, exitPort: Port): void;
  isHeld(tileId: string, exitPort: Port): boolean;
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

  const isSignalTile = (tileId: string) => signalTiles.has(tileId);
  function isBoundary(tileId: string): boolean {
    if (signalTiles.has(tileId)) return true;
    const tile = level[tileId];
    return !!tile && tile.component === "TileDepot";
  }

  const trains: Record<string, SimTrain> = {};
  for (const init of config.trains) {
    const exitPort = resolveExitPort(level, getSwitch, init.coord, init.entryPort);
    trains[init.id] = {
      id: init.id,
      color: init.color,
      type: init.type,
      wagonCount: init.wagonCount,
      speed: init.speed ?? DEFAULT_SPEED,
      bodyLength: 1 + init.wagonCount * WAGON_SPACING,
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

  function isTileOccupied(tileId: string): boolean {
    for (const id of Object.keys(trains)) {
      if (bodyTileIds(trains[id]).has(tileId)) return true;
    }
    return false;
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
    if (manualHold.has(`${tileId}:${exitPort}`)) return "stop";
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
    train.state = "running";
  }

  function advance(train: SimTrain, dt: number, events: SimEvent[]): void {
    if (train.state === "parked") return;
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
            train.state = "parked";
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

      // Entering a tile not already reserved by us means entering a new block:
      // reserve the whole route to the next signal, or hold (the signal is Stop).
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
        if (!reservable) {
          train.headProgress = 1;
          break;
        }
        for (const tid of block) reservations.set(tid, train.id);
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
      const units: SampledUnit[] = [sampleAt(headDistance)];
      for (let i = 0; i < train.wagonCount; i++) {
        units.push(sampleAt(headDistance - (i + 1) * WAGON_SPACING));
      }
      return units;
    },
    signalAspect(tileId: string, exitPort: Port) {
      return aspect(tileId, exitPort);
    },
    isHeld(tileId: string, exitPort: Port) {
      return manualHold.has(`${tileId}:${exitPort}`);
    },
    toggleHold(tileId: string, exitPort: Port) {
      const key = `${tileId}:${exitPort}`;
      if (manualHold.has(key)) manualHold.delete(key);
      else manualHold.add(key);
    },
  };
}
