import { LevelDefinition, Coordinates, Position } from "@/types";
import { Port } from "./topology";
import { SwitchResolver, resolveExitPort, traverse } from "./network";
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

// Wagons sit a little under one tile apart, matching the rendered spacing.
const WAGON_SPACING = 0.9;

// Resolves a traffic signal gating a train leaving `coordId` through `exitPort`.
// "red" blocks; "green"/undefined allow.
export type SignalResolver = (
  coordId: string,
  exitPort: Port
) => "red" | "green" | undefined;

export interface SimConfig {
  level: LevelDefinition;
  trains: TrainInit[];
  getSwitch?: SwitchResolver;
  getSignal?: SignalResolver;
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
}

const DEFAULT_SPEED = 0.5;

export function createSimulation(config: SimConfig): Simulation {
  const { level } = config;
  const getSwitch: SwitchResolver = config.getSwitch ?? (() => undefined);
  const getSignal: SignalResolver = config.getSignal ?? (() => undefined);
  const depotColors: Record<string, string> = config.depotColors ?? {};

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
      if (
        t.exitPort !== null &&
        getSignal(getCoordinatesId(head.coord), t.exitPort) === "red"
      ) {
        // Red signal on this tile's exit: stop at the boundary, never cross.
        train.headProgress = 1;
        break;
      }
      const nextTileId = getCoordinatesId(t.next.coord);
      if (isTileOccupiedByOther(nextTileId, train.id)) {
        // Another train's body is on the next tile: stop at the boundary.
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
  };
}
