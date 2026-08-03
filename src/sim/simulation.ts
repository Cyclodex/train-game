import { ActiveIntersection, Coordinates, Position } from "@/types";
import {
  Level,
  armExit,
  claimKey,
  claimKeysOf,
  heightOf,
  parseCoordId,
  tileIdOfClaim,
} from "@/tiles/model";
import { Port, neighborCoord, oppositePort } from "./topology";
import {
  SwitchResolver,
  resolveExitPort,
  traverse,
  routeToNextSignal,
} from "./network";
import { RailPlan, planRailRoute, reachableStations } from "./railRouter";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { segmentLength } from "./pathGeometry";
import { gradeSpeedFactor, trainDynamics } from "./physics";

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
  // The station tile ids this train serves, in order (see SimTrain.line).
  line?: string[];
  // Passenger seats. Defaults to PASSENGERS_PER_WAGON per wagon for "people"
  // trains and 0 for "fraight" — a goods train calls at stations but boards
  // nobody (typed cargo is a later phase).
  capacity?: number;
}

// "waiting" is a train sitting in its depot with the brake on, waiting for the
// player to send it (Train Valley's "Zug wartet. Per Klick losschicken."). It is
// OPT-IN — `SimConfig.waitForDispatch` — so every board authored before dispatch
// existed still departs the moment the level starts.
// "parking" is the transient glide where a train that has matched a depot keeps
// moving forward so its whole body slides into the depot (clearing the approach
// tiles) before it freezes as "parked".
// "dwelling" is a timed stop at a station platform (role: "station"): the train
// draws up so its CARRIAGES stand beside the platform (see platformStopDistance)
// — which for anything longer than a lone loco means pulling the loco clear of
// the far end of the slab — waits STATION_DWELL_SEC, then runs on. It keeps
// occupying its tiles (trains behind wait) for the whole stop.
export type TrainState = "waiting" | "running" | "parking" | "parked" | "dwelling";

// How long a train stands at a station platform, in sim seconds, and where the
// platform's MIDDLE is on the station tile's segment (0..1 progress).
// Exported so tests and the renderer agree with the sim on both.
export const STATION_DWELL_SEC = 3;
export const PLATFORM_CENTRE_PROGRESS = 0.5;
// The old name for the platform centre, when the sim stopped the LOCO there and
// left every carriage trailing off the back of the slab. Kept as an alias for
// callers that only ever meant "the middle of the platform".
export const STATION_STOP_PROGRESS = PLATFORM_CENTRE_PROGRESS;
// A stop nobody could align: when a train is brought to a stand short of its
// platform stop line (a dead end, a red signal, a train in the way) it opens its
// doors where it stands, provided it has at least reached the platform centre.
// Without this a station one tile from the buffers would never be served.
const MIN_PLATFORM_REACH = PLATFORM_CENTRE_PROGRESS;
// Passenger model (phase 2, typeless): seats per PEOPLE wagon (the loco carries
// none), and the extra stop time each boarding passenger adds to the dwell.
export const PASSENGERS_PER_WAGON = 6;
export const BOARDING_SEC_PER_PASSENGER = 0.4;

// Deterministic per-station passenger demand: every `intervalSec` of sim time
// one passenger joins the queue, holding at `max` waiting (a full platform
// pauses the schedule rather than banking a backlog); `initial` seeds the
// queue at t=0. A pure schedule — no randomness — so replays and tests are
// exact. WHAT the rates should be is the mode layer's business (and later the
// terrain catchment's); the sim only executes the schedule it is handed.
export interface StationDemand {
  intervalSec: number;
  max: number;
  initial?: number;
}

// The most a platform holds when passengers are INJECTED (park & ride) at a
// station with no demand schedule of its own — the schedule's `max` caps a
// scheduled station the same way.
export const STATION_QUEUE_HARD_CAP = 16;

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
  // Station dwell: seconds left standing at the platform (only meaningful in
  // state "dwelling"), and the path index of the last station segment this
  // train dwelled at — so it stops once per pass, but again on a later visit
  // (a revisit is a new, higher path index).
  dwellRemaining: number;
  dwelledAtIndex: number;
  // Passengers: seats on this train, and WHERE each rider is going (one entry
  // per person, the tile id of the station they asked for). A rider gets off
  // when the train calls at their destination — not at the next stop — which
  // is what makes the shape of a line matter. A train with no line carries
  // anyone and sets them down at its next call (the old one-hop service).
  capacity: number;
  manifest: string[];
  // LINE (the network mode): the station tile ids this train serves, in order,
  // cycling forever. A train with a line drives ITSELF — it plans a route to
  // its next stop and prefers that route at every tile boundary, instead of
  // going wherever the points happen to be set. Absent = the classic train,
  // which follows the switches exactly as before.
  line?: string[];
  // Which stop of `line` the train is currently heading for.
  lineIndex: number;
  // The route being driven right now (this leg only). Recomputed at every call,
  // so a level edited mid-run is routed over on the very next leg.
  plan?: RailPlan;
  // Withdrawn from service and running to a depot to be stabled. It keeps its
  // stops-worth of passengers to the end of the leg but takes no new ones, and
  // it is removed from the sim the moment it reaches the shed.
  retiring?: boolean;
}

export interface ArrivedEvent {
  type: "arrived";
  trainId: string;
  tileId: string;
  matched: boolean;
  // Passengers who ended their ride here (matched arrivals only — a bounced
  // train keeps its riders aboard). Absent when nobody was riding, so every
  // fixture written before passengers existed still compares equal.
  alighted?: number;
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

// A train came to rest at a station platform and began its dwell. `alighted`
// riders got off (they ride one hop), then `boarded` joined from the queue —
// each boarding passenger stretches the dwell a little.
export interface DwellEvent {
  type: "dwell";
  trainId: string;
  tileId: string;
  boarded: number;
  alighted: number;
}

// A retiring train reached a depot and was stabled: it is gone from the sim.
export interface RetiredEvent {
  type: "retired";
  trainId: string;
  tileId: string;
}

// A dwelling train's stop time elapsed and it pulled away from the platform.
export interface DepartedEvent {
  type: "departed";
  trainId: string;
  tileId: string;
}

export type SimEvent =
  | ArrivedEvent
  | ReservedEvent
  | BlockedEvent
  | ProceedingEvent
  | DwellEvent
  | DepartedEvent
  | RetiredEvent;

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
  // Per-station passenger demand, keyed by tile id. Only station tiles are
  // meaningful; omitted stations spawn nobody (trains still call and dwell).
  stationDemand?: Record<string, StationDemand>;
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
  // The stops this train serves, in order (empty when it has no line).
  trainLine(id: string): string[];
  // The stop it is heading for right now, or undefined without a line.
  trainNextStop(id: string): string | undefined;
  // Put a train into service on a line (or take it out again with []). The
  // route to the first stop is planned immediately, so the train turns toward
  // it on the next tick — this is the verb a "assign train to line" UI calls.
  // Returns false for an unknown train.
  assignLine(id: string, stops: string[]): boolean;
  // WITHDRAW a train from service the orderly way: it finishes nothing, takes
  // no new passengers, and runs to the nearest depot, where it is stabled and
  // leaves the sim (a `retired` event says when). False for an unknown train
  // or when no depot is reachable from where it stands — the caller can then
  // offer the emergency verb instead.
  retireTrain(id: string): boolean;
  // True while a train is on its way to be stabled.
  isRetiring(id: string): boolean;
  // SCRAP a train where it stands: gone this instant, its reservations
  // released. The emergency verb — nothing about it is realistic, which is
  // exactly why it is separate from `retireTrain`.
  removeTrain(id: string): boolean;
  // Passengers waiting on the platform at a station tile (0 for any other id).
  stationQueue(tileId: string): number;
  // WHERE each of them is going, in queue order — what the platform draws so
  // a player can see which service a crowd is actually waiting for.
  stationWaiting(tileId: string): string[];
  // Inject passengers ONTO a station's platform outside the schedule — the
  // park-and-ride edge (game.ts adds one per car that parks within walking
  // reach). Capped at the station's schedule `max` (or STATION_QUEUE_HARD_CAP
  // without a schedule); returns how many were actually accepted. A no-op 0
  // for any tile that is not a station.
  addStationPassengers(tileId: string, count: number): number;
  // Passengers currently riding this train.
  trainPassengers(id: string): number;
  // Total passengers whose ride ended (at a station call or a matched depot
  // arrival) since the sim was created. The mode layer scores off the event
  // deltas; this absolute exists for tests and debugging.
  passengersDelivered(): number;
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
  // Block boundaries: signals, depots — and stations. A station bounds the
  // block exactly the way a signal does, so an approaching train reserves only
  // UP TO the platform, and a train standing there in its dwell holds nothing
  // beyond its own tiles. Without this, a dwelling train would pin the whole
  // route to the next real signal for the length of its stop.
  function isBoundary(tileId: string): boolean {
    if (isSignalTile(tileId)) return true;
    const tile = level[tileId];
    return !!tile && (tile.role === "depot" || tile.role === "station");
  }

  const isStationTile = (tileId: string) => level[tileId]?.role === "station";

  // Platform queues + the spawn schedule cursors, per station tile id. Pure
  // counters advanced by step(dt) — deterministic, no randomness.
  const stationDemand: Record<string, StationDemand> = {
    ...(config.stationDemand ?? {}),
  };
  // Per station: WHO is waiting, as the tile id each of them asked for. A
  // count would have been enough while everybody got off at the next stop;
  // with destinations the queue has to remember what it wants.
  const queues = new Map<string, string[]>();
  const spawnClocks = new Map<string, number>();
  // Where the next person at each station will ask to go. A cursor walked in
  // order rather than an RNG draw: destinations must be deterministic like
  // everything else in here, and a round robin also spreads demand evenly
  // instead of clumping the way random would.
  const destCursors = new Map<string, number>();
  // The stations each station can be reached from BY RAIL, computed once. A
  // person only ever asks for somewhere the railway could take them — asking
  // for an island would be a passenger nothing can ever clear, and the
  // platform cap would turn that into a slow, unavoidable loss.
  const destChoices = new Map<string, string[]>();
  for (const tid of Object.keys(stationDemand)) {
    destChoices.set(
      tid,
      reachableStations(level, tid).filter(id => id !== tid)
    );
  }
  // The next destination for someone starting at `tid`, or null when the
  // railway connects this platform to nowhere.
  function nextDestination(tid: string): string | null {
    const choices = destChoices.get(tid) ?? [];
    if (choices.length === 0) return null;
    const at = destCursors.get(tid) ?? 0;
    destCursors.set(tid, at + 1);
    return choices[at % choices.length];
  }
  for (const [tid, d] of Object.entries(stationDemand)) {
    const seed = Math.min(d.initial ?? 0, d.max);
    const start: string[] = [];
    for (let i = 0; i < seed; i++) {
      const dest = nextDestination(tid);
      if (dest) start.push(dest);
    }
    queues.set(tid, start);
    spawnClocks.set(tid, 0);
  }
  let passengersDeliveredTotal = 0;

  function advanceDemand(dt: number): void {
    for (const [tid, d] of Object.entries(stationDemand)) {
      let clock = (spawnClocks.get(tid) ?? 0) + dt;
      const q = queues.get(tid) ?? [];
      while (clock >= d.intervalSec) {
        clock -= d.intervalSec;
        if (q.length < d.max) {
          const dest = nextDestination(tid);
          if (dest) q.push(dest);
        }
      }
      spawnClocks.set(tid, clock);
      queues.set(tid, q);
    }
  }

  // --- Lines: a train that drives itself ---------------------------------------
  //
  // A planned route names an EXIT PORT; the sim's one seam for "which way at
  // this tile" is a SwitchResolver, which names an ARM. Translating between
  // them here means the route flows through `traverse`/`resolveExitPort`
  // untouched — every existing rule (reservation, occupancy, signals, stop
  // lines) applies to a routed train exactly as to a hand-switched one.
  const ARMS: ActiveIntersection[] = [
    ActiveIntersection.Left,
    ActiveIntersection.Straight,
    ActiveIntersection.Right,
  ];
  function armForExit(entry: Port, exit: Port): ActiveIntersection | undefined {
    return ARMS.find(arm => armExit(entry, arm) === exit);
  }

  // The resolver a given train steers by: its own route where the route has an
  // opinion, the board's points everywhere else. A train with no line is
  // byte-for-byte the train this sim always had.
  function switchOf(train: SimTrain): SwitchResolver {
    if (!train.plan) return getSwitch;
    return (coordId, entryPort) => {
      const exit = train.plan?.exitAt.get(`${coordId}:${entryPort}`);
      if (exit === undefined) return getSwitch(coordId, entryPort);
      return armForExit(entryPort, exit) ?? getSwitch(coordId, entryPort);
    };
  }

  // Every depot on the board — where a withdrawn train can be stabled.
  // Derived from the LEVEL each time, so a depot built mid-run counts.
  function depotTiles(): string[] {
    return Object.keys(level).filter(id => level[id]?.role === "depot");
  }

  // Take a train out of the sim entirely and release everything it held.
  function dropTrain(id: string): void {
    delete trains[id];
    for (const [key, owner] of reservations) {
      if (owner === id) reservations.delete(key);
    }
    blockStates.delete(id);
  }

  // The stop this train is heading for, or undefined when it has no line.
  function currentStop(train: SimTrain): string | undefined {
    if (!train.line?.length) return undefined;
    return train.line[train.lineIndex % train.line.length];
  }

  // Plan the leg to the current stop from where the head is now. Called on
  // departure and after every call, so the route is always derived from the
  // live level — track laid mid-run is used on the next leg.
  function planLeg(train: SimTrain): void {
    const stop = currentStop(train);
    if (!stop) {
      train.plan = undefined;
      return;
    }
    const head = train.path[train.headIndex];
    train.plan =
      planRailRoute(level, { coord: head.coord, entryPort: head.entryPort }, [stop]) ??
      undefined;
  }

  // Move to the next stop on the line and plan the leg to it. A line is a
  // CYCLE: past the last stop it wraps to the first, which is what makes a
  // two-stop line a shuttle and a multi-stop line a circular service.
  function advanceLine(train: SimTrain): void {
    if (!train.line?.length) return;
    train.lineIndex = (train.lineIndex + 1) % train.line.length;
    planLeg(train);
  }

  // True when this train still owes a stop at its current (station) segment:
  // the head is on a station tile it has not yet dwelled at this pass.
  // Does this train CALL at that station, or run past it? A train on a line
  // serves its OWN stops and nothing else — that is what makes an express
  // express, and without it a line is only a suggestion about the order in
  // which a train visits everything. A train with no line stops everywhere,
  // which is the classic service every older board expects.
  function callsAt(train: SimTrain, tileId: string): boolean {
    if (!isStationTile(tileId)) return false;
    if (!train.line?.length) return true;
    return train.line.includes(tileId);
  }

  // How far past a station tile's ENTRY this train's head has to run before the
  // train stands correctly at the platform.
  //
  // A platform is one tile long; a train is not. Stopping the LOCO on the
  // platform (what this used to do) parked the one vehicle nobody boards beside
  // the slab and left every carriage trailing back over the plain track behind
  // it. So the alignment is on the CARRIAGES: the block from the nose of the
  // first wagon to the tail of the last one is centred on the platform, which
  // draws the loco past the far end of the slab — exactly what a real train does
  // at a platform too short for it. A lone loco has no carriages, so its own
  // body is the block and it comes to rest centred on the platform.
  function platformStopDistance(train: SimTrain): number {
    const last = train.unitLengths.length - 1;
    const first = last > 0 ? 1 : 0; // the first BOARDABLE unit
    // Distances back from the head to the nose of `first` and the tail of `last`.
    const nose = train.unitOffsets[first] - train.unitLengths[first] / 2;
    const tail = train.unitOffsets[last] + train.unitLengths[last] / 2;
    return PLATFORM_CENTRE_PROGRESS + (nose + tail) / 2;
  }

  // The stop this train still owes, if any: the path index of the station and
  // how much further the head has to run to be aligned with its platform.
  //
  // Derived from the path rather than latched on arrival, because the head ends
  // up BEYOND the station tile — by the time the train is standing correctly the
  // platform is behind it, so "is the head on an unserved station tile?" is no
  // longer the question. Segments are one progress unit each (the convention the
  // rest of the sim's distances use), so the head's distance from a station's
  // entry is simply the index gap plus the head's progress.
  function pendingPlatformStop(
    train: SimTrain
  ): { index: number; remaining: number } | null {
    const reach = platformStopDistance(train);
    const from = Math.max(0, train.headIndex - Math.ceil(reach) - 1);
    // The EARLIEST unserved station in reach: a train must work its platforms in
    // the order it passes them, and two stations can sit inside one train length.
    for (let i = Math.max(from, train.dwelledAtIndex + 1); i <= train.headIndex; i++) {
      const seg = train.path[i];
      if (!seg || !callsAt(train, getCoordinatesId(seg.coord))) continue;
      const travelled = train.headIndex - i + train.headProgress;
      return { index: i, remaining: Math.max(0, reach - travelled) };
    }
    return null;
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
    const capacity =
      init.capacity ??
      (init.type === "people" ? init.wagonCount * PASSENGERS_PER_WAGON : 0);
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
      dwellRemaining: 0,
      dwelledAtIndex: -1,
      capacity,
      manifest: [],
      ...(init.line?.length ? { line: [...init.line] } : {}),
      lineIndex: 0,
    };
  }

  const trains: Record<string, SimTrain> = {};
  for (const init of config.trains) {
    trains[init.id] = buildTrain(init);
  }
  // Trains on a line set off toward their first stop. Done after the roster is
  // built so a plan is always derived from the finished level.
  for (const train of Object.values(trains)) {
    if (train.line?.length) planLeg(train);
  }

  // The set of CLAIM KEYS a train's body currently covers (head back to tail).
  // A claim key is the tile id on every ordinary cell; on a flyover each level
  // claims separately, so a body on the deck never "occupies" the line running
  // underneath (tiles/model.ts).
  function bodyClaimKeys(train: SimTrain): Set<string> {
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
      if (!seg) continue;
      const id = getCoordinatesId(seg.coord);
      ids.add(claimKey(level[id], id, seg.entryPort));
    }
    return ids;
  }

  function isTileOccupiedByOther(key: string, selfId: string): boolean {
    for (const id of Object.keys(trains)) {
      if (id === selfId) continue;
      if (bodyClaimKeys(trains[id]).has(key)) return true;
    }
    return false;
  }

  // The train (if any) whose body physically covers a claim right now.
  function occupantOf(key: string): string | undefined {
    for (const id of Object.keys(trains)) {
      if (bodyClaimKeys(trains[id]).has(key)) return id;
    }
    return undefined;
  }

  function isTileOccupied(key: string): boolean {
    return occupantOf(key) !== undefined;
  }

  // A claim is enterable by a train if no other train has reserved or occupies it.
  function tileFreeForTrain(key: string, selfId: string): boolean {
    const owner = reservations.get(key);
    if (owner !== undefined && owner !== selfId) return false;
    return !isTileOccupiedByOther(key, selfId);
  }

  // Release reservations the train no longer needs: anything it has reserved that
  // is neither under its body nor in the block still ahead of it.
  function releaseStaleReservations(train: SimTrain): void {
    const keep = bodyClaimKeys(train);
    if (train.state === "running") {
      const head = train.path[train.headIndex];
      for (const tid of routeToNextSignal(
        level,
        switchOf(train),
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
    const outer = resolveExitPort(level, switchOf(train), depotCoord, Position.Center);
    train.path = [
      { coord: depotCoord, entryPort: Position.Center, exitPort: outer },
    ];
    train.headIndex = 0;
    train.headProgress = 0;
    train.velocity = 0; // it stopped in the depot; accelerate away from rest
    train.state = "running";
    // The path restarted at index 0, so a stale dwell index must not alias a
    // future station segment that happens to land on the same number.
    train.dwelledAtIndex = -1;
    // The old plan started from the far side of the depot; a train that has
    // just turned round needs the route to its stop re-derived from here, or
    // it would carry a plan whose tiles it will never enter again.
    if (train.line?.length) planLeg(train);
  }

  // The other train responsible for a claim not being free for `selfId`: its
  // reserver if reserved by someone else, otherwise whoever occupies it.
  function blockerOf(key: string, selfId: string): string | undefined {
    const owner = reservations.get(key);
    if (owner !== undefined && owner !== selfId) return owner;
    return occupantOf(key);
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
    const t = traverse(level, switchOf(train), head.coord, head.entryPort);
    if (!t.next) return false; // dead end, map edge, or depot arrival
    const headTileId = getCoordinatesId(head.coord);
    const nextTileId = getCoordinatesId(t.next.coord);
    const nextKey = claimKey(level[nextTileId], nextTileId, t.next.entryPort);

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

    if (reservations.get(nextKey) !== train.id) {
      const block = routeToNextSignal(
        level,
        switchOf(train),
        isBoundary,
        head.coord,
        head.entryPort
      );
      const reservable =
        block.length > 0 && block.every(tid => tileFreeForTrain(tid, train.id));
      if (!reservable && !forcedGreen) return false;
    }
    if (isTileOccupiedByOther(nextKey, train.id)) return false;
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
    const nextKey = t.next
      ? claimKey(level[nextTileId], nextTileId, t.next.entryPort)
      : headTileId;

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

    if (reservations.get(nextKey) !== train.id) {
      const block = routeToNextSignal(
        level,
        switchOf(train),
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
    // Otherwise the next claim is physically occupied by another train.
    return {
      reason: "occupancy",
      tileId: headTileId,
      blockedBy: occupantOf(nextKey),
    };
  }

  // Distance (in tiles) the head may roll before it must stop, scanning forward
  // along the live route and capped at the train's lookAhead. Read-only: it makes
  // no reservations (those happen only when the train physically crosses). The
  // scan accumulates the rest of the current tile plus one tile per crossable
  // boundary, stopping at the first boundary mayCross() refuses.
  function clearDistanceAhead(
    train: SimTrain,
    stop: { index: number; remaining: number } | null
  ): number {
    // A stop already owed (the head is on, or just past, an unserved platform)
    // fixes the stop line. It is a CAP, not the answer: drawing up at a platform
    // takes the loco over the boundary into the next tile, so the run still has
    // to be cleared tile by tile like any other.
    let limit = stop ? stop.remaining : Infinity;
    let dist = 1 - train.headProgress;
    let head: { coord: Coordinates; entryPort: Port } = train.path[
      train.headIndex
    ];
    while (dist < train.lookAhead && dist < limit) {
      if (!mayCross(train, head)) break;
      const t = traverse(level, switchOf(train), head.coord, head.entryPort);
      if (!t.next) break; // dead end / depot mouth: the metals stop here
      head = { coord: t.next.coord, entryPort: t.next.entryPort };
      // A station ahead sets the stop line at its platform, which lies part-way
      // through (and usually past) that tile. Only the FIRST one counts — the
      // train stops there before anything beyond it can matter. One this train
      // runs PAST is not a stop line at all, so it must not brake for it.
      if (limit === Infinity && callsAt(train, getCoordinatesId(head.coord))) {
        limit = dist + platformStopDistance(train);
      }
      dist += 1;
    }
    return Math.min(dist, limit, train.lookAhead);
  }

  // The height step the head segment is climbing: height of the tile its exit
  // points at minus the height of the tile under the head. 0 on a dead end, a
  // depot mouth (Center) or the map edge — nothing to climb into.
  function segmentGrade(train: SimTrain): number {
    const seg = train.path[train.headIndex];
    if (!seg || seg.exitPort === null || seg.exitPort === Position.Center) {
      return 0;
    }
    const nc = neighborCoord(seg.coord, seg.exitPort);
    if (!nc) return 0;
    const here = level[getCoordinatesId(seg.coord)];
    const ahead = level[getCoordinatesId(nc)];
    return heightOf(ahead) - heightOf(here);
  }

  function advance(train: SimTrain, dt: number, events: SimEvent[]): void {
    if (train.state === "parked") return;
    // Waiting for the player. It sits on its depot tile (so it still blocks that
    // tile, exactly like a train that has not pulled out yet) but claims no
    // block ahead — a waiting train must not hold a route it isn't using.
    if (train.state === "waiting") return;
    // Standing at a station platform. The body keeps occupying its tiles (a
    // train behind waits on the occupancy gate) while the stop time runs out;
    // then it pulls away from rest like any departure.
    if (train.state === "dwelling") {
      train.dwellRemaining -= dt;
      if (train.dwellRemaining <= 0) {
        train.dwellRemaining = 0;
        train.state = "running";
        // The STATION it is leaving, not the tile under the head — a train
        // drawn up at a platform has its loco past the far end of it, so the
        // head is usually a tile further on (see platformStopDistance).
        const served = train.path[train.dwelledAtIndex] ?? train.path[train.headIndex];
        events.push({
          type: "departed",
          trainId: train.id,
          tileId: getCoordinatesId(served.coord),
        });
      }
      return;
    }
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
    const stop = pendingPlatformStop(train);
    const clear = clearDistanceAhead(train, stop);
    const vSafe = Math.sqrt(2 * train.brake * clear);
    // A grade caps the cruise, by mass: while the head segment climbs into a
    // higher tile, a heavy train crawls where a light one keeps most of its
    // pace. Descending changes nothing (gradeSpeedFactor is exactly 1 there),
    // so the braking maths above stays honest.
    const gradeCap =
      train.speed *
      gradeSpeedFactor(train.type, train.wagonCount, segmentGrade(train));
    const vCap = Math.min(train.speed, vSafe, gradeCap);

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
    const blockInfo = crossBoundaries(train, events);
    // A depot at the end of the run can park, bounce or retire the train inside
    // that walk — none of which is a train that could be drawing up anywhere.
    if (!trains[train.id] || train.state !== "running") return;

    // Station stop. Two ways a train's doors open:
    //  1. It reached its stop line — the braking cap above collapses `clear`
    //     onto it, and each tick's move is clamped to what is left, so the head
    //     lands exactly on it in finite time.
    //  2. It was brought to a stand short of the line and cannot go on (buffers
    //     ahead, a red signal, a train in the way) but has at least drawn level
    //     with the platform. Better an untidy stop than a station never served.
    const landed = pendingPlatformStop(train);
    if (landed) {
      const stalled = blockInfo !== null || clear <= 1e-9;
      const drawnUp = train.headIndex - landed.index + train.headProgress;
      if (
        landed.remaining <= 1e-9 ||
        (stalled && drawnUp >= MIN_PLATFORM_REACH)
      ) {
        beginDwell(train, landed.index, events);
        return;
      }
    }

    if (blockInfo) noteBlocked(train, blockInfo, events);
    else noteProceeding(train, events);
  }

  // Open the doors: set the train dwelling at the platform on path segment
  // `stationIndex`, exchange passengers, and advance its line cursor.
  function beginDwell(
    train: SimTrain,
    stationIndex: number,
    events: SimEvent[]
  ): void {
    train.state = "dwelling";
      train.dwelledAtIndex = stationIndex;
      train.velocity = 0;
      const tileId = getCoordinatesId(train.path[stationIndex].coord);
      // Alight first (one-hop model: whoever is aboard ends their ride at the
      // next call), then board from the platform queue into the free seats.
      // Each boarding passenger stretches the stop a little, so a crowded
      // platform visibly costs time.
      // ALIGHT: whoever asked for THIS station is here. A train with no line
      // (the classic service) has no future stops to promise, so it sets
      // everyone down at its next call — the old one-hop behaviour, unchanged
      // for every board that never mentions a line. A retiring train does the
      // same: its riders are better off on a platform than in a shed.
      const onelegged = !train.line?.length || train.retiring;
      const staying: string[] = [];
      let alighted = 0;
      for (const dest of train.manifest) {
        if (onelegged || dest === tileId) alighted += 1;
        else staying.push(dest);
      }
      train.manifest = staying;
      passengersDeliveredTotal += alighted;

      // BOARD: only people this train can actually take — its line has to call
      // at where they are going. Everyone else waits for a service that does,
      // which is the whole reason a line's SHAPE matters. A lineless train
      // takes anyone (it is going to set them down next stop regardless).
      const queue = queues.get(tileId) ?? [];
      const serves = new Set(train.line ?? []);
      let boarded = 0;
      if (!train.retiring) {
        const left: string[] = [];
        for (const dest of queue) {
          const canTake =
            train.manifest.length < train.capacity &&
            (!train.line?.length || serves.has(dest));
          if (canTake) {
            train.manifest.push(dest);
            boarded += 1;
          } else left.push(dest);
        }
        queues.set(tileId, left);
      }
      train.dwellRemaining =
        STATION_DWELL_SEC + boarded * BOARDING_SEC_PER_PASSENGER;
      // On a line, calling anywhere on it moves the cursor PAST that stop —
      // not just at the one we were bound for. A line is an order to visit, and
      // arriving early at a later stop (a loop can bring one up sooner than the
      // cursor expects) should still count as having served it, or the train
      // would come back for a platform it just worked.
      if (train.line?.length) {
        const at = train.line.indexOf(tileId);
        if (at >= 0) {
          train.lineIndex = (at + 1) % train.line.length;
          planLeg(train);
        }
      }
      events.push({ type: "dwell", trainId: train.id, tileId, boarded, alighted });
  }

  // Walk the head over every tile boundary it has run past this tick, claiming
  // blocks as it goes. Returns why the train was held at a boundary it may not
  // cross, or null when nothing stopped it. May end the train's run (a depot
  // arrival parks, bounces or retires it), so callers must re-check its state.
  function crossBoundaries(
    train: SimTrain,
    events: SimEvent[]
  ): BlockInfo | null {
    let blockInfo: BlockInfo | null = null;
    while (train.headProgress >= 1) {
      const head = train.path[train.headIndex];
      const t = traverse(level, switchOf(train), head.coord, head.entryPort);
      if (!t.next) {
        if (t.exitPort === Position.Center) {
          // Arrived inside a depot. A matched arrival ends every rider's trip;
          // a bounce keeps them aboard for the ride back.
          const tileId = getCoordinatesId(head.coord);
          // A train IN SERVICE never terminates at a depot, whatever colour it
          // is: on a line the depot is where trains are ordered and stabled,
          // not a destination, so reaching one is a turn-back. (Transport
          // Fever's shape, and the reason a network board needs only ONE
          // depot.) Without a line, the classic colour-match rule stands.
          // A RETIRING train's journey ends here whatever the colours say: it
          // was sent to be stabled, and the shed is where it leaves the game.
          if (train.retiring) {
            events.push({ type: "retired", trainId: train.id, tileId });
            dropTrain(train.id);
            return null;
          }
          const matched = !train.line?.length && depotColors[tileId] === train.color;
          const alighted = matched ? train.manifest.length : 0;
          if (alighted > 0) {
            train.manifest = [];
            passengersDeliveredTotal += alighted;
          }
          events.push({
            type: "arrived",
            trainId: train.id,
            tileId,
            matched,
            ...(alighted > 0 && { alighted }),
          });
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
      const nextKey = claimKey(level[nextTileId], nextTileId, t.next.entryPort);
      if (reservations.get(nextKey) !== train.id) {
        const block = routeToNextSignal(
          level,
          switchOf(train),
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
          // The activity log speaks in tiles, not claim keys.
          events.push({
            type: "reserved",
            trainId: train.id,
            tiles: claimed.map(tileIdOfClaim),
          });
        }
      }

      const nextExit = resolveExitPort(
        level,
        switchOf(train),
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
    return blockInfo;
  }

  return {
    trains,
    step(dt: number) {
      const events: SimEvent[] = [];
      // Passengers arrive on the platforms first, so a train opening its doors
      // this very tick sees everyone due by now.
      advanceDemand(dt);
      // Deterministic order so tile reservation between trains is stable.
      for (const id of Object.keys(trains).sort()) {
        // A train can RETIRE inside advance() and leave the roster, so the
        // snapshot this loop walks may name one that no longer exists.
        const train = trains[id];
        if (!train) continue;
        advance(train, dt, events);
        if (trains[id]) releaseStaleReservations(train);
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
    trainLine(id: string) {
      return trains[id]?.line ? [...trains[id].line!] : [];
    },
    trainNextStop(id: string) {
      const train = trains[id];
      return train ? currentStop(train) : undefined;
    },
    assignLine(id: string, stops: string[]) {
      const train = trains[id];
      if (!train) return false;
      if (stops.length === 0) {
        delete train.line;
        train.plan = undefined;
        train.lineIndex = 0;
        return true;
      }
      train.line = [...stops];
      train.lineIndex = 0;
      planLeg(train);
      return true;
    },
    retireTrain(id: string) {
      const train = trains[id];
      if (!train) return false;
      const head = train.path[train.headIndex];
      const plan = planRailRoute(
        level,
        { coord: head.coord, entryPort: head.entryPort },
        depotTiles()
      );
      if (!plan) return false; // nowhere to stable it; scrap is the way out
      delete train.line;
      train.lineIndex = 0;
      train.plan = plan;
      train.retiring = true;
      return true;
    },
    isRetiring(id: string) {
      return trains[id]?.retiring === true;
    },
    removeTrain(id: string) {
      if (!trains[id]) return false;
      dropTrain(id);
      return true;
    },
    stationQueue(tileId: string) {
      return queues.get(tileId)?.length ?? 0;
    },
    stationWaiting(tileId: string) {
      return [...(queues.get(tileId) ?? [])];
    },
    addStationPassengers(tileId: string, count: number) {
      if (!isStationTile(tileId) || count <= 0) return 0;
      const cap = stationDemand[tileId]?.max ?? STATION_QUEUE_HARD_CAP;
      const q = queues.get(tileId) ?? [];
      const room = Math.max(0, Math.min(count, cap - q.length));
      let accepted = 0;
      for (let i = 0; i < room; i++) {
        // Someone who arrived by car or bus wants somewhere too. A station
        // with no schedule of its own has no destination cursor, so derive
        // the choices on demand for it.
        if (!destChoices.has(tileId)) {
          destChoices.set(
            tileId,
            reachableStations(level, tileId).filter(id => id !== tileId)
          );
        }
        // Nobody travels from a platform the railway connects to nothing —
        // there is nowhere to ask for. So the walker simply does not appear,
        // and the count says so.
        const dest = nextDestination(tileId);
        if (!dest) break;
        q.push(dest);
        accepted += 1;
      }
      queues.set(tileId, q);
      return accepted;
    },
    trainPassengers(id: string) {
      return trains[id]?.manifest.length ?? 0;
    },
    passengersDelivered() {
      return passengersDeliveredTotal;
    },
    signalAspect(tileId: string, exitPort: Port) {
      return aspect(tileId, exitPort);
    },
    reservedBy(tileId: string) {
      // A by-tile query answers for EITHER level of a flyover: the edit gate
      // and the debug overlay ask about the tile, not a deck.
      for (const key of claimKeysOf(tileId)) {
        const owner = reservations.get(key);
        if (owner !== undefined) return owner;
      }
      return undefined;
    },
    occupiedBy(tileId: string) {
      for (const key of claimKeysOf(tileId)) {
        const on = occupantOf(key);
        if (on !== undefined) return on;
      }
      return undefined;
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
        const t = traverse(level, switchOf(train), head.coord, head.entryPort);
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
      head.exitPort = resolveExitPort(level, switchOf(train), head.coord, head.entryPort);
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
