import { markRaw, reactive, ref, Ref } from "vue";
import { Position, ActiveIntersection, Coordinates } from "@/types";
import { Level, partnersOf, armExit, defaultArmFor, parseCoordId, samePair, PortPair, Port } from "@/tiles/model";
import {
  stationDemandOf,
  busStopDemandOf,
  busStopTiles,
  parkAndRideTargets,
  walkLinksOf,
} from "@/tiles/catchment";
import { stationNames } from "@/tiles/stationNames";
import { planRailRoute } from "@/sim/railRouter";
import { addConnection, isBlankCell, removeConnection } from "@/tiles/editOps";
import type { RouteStep } from "@/tiles/routePlanner";
import {
  createSimulation,
  Simulation,
  SampledUnit,
  UnitChord,
  SimEvent,
  TrainState,
  BlockReason,
} from "@/sim/simulation";
import { Rider, StationDemand, TransitLayer, createTransit } from "@/sim/transit";
import { createRoadSim, roadEntries, TrafficConfig, CarSample } from "@/sim/road";
import { buildCitizenWorld, PlotKind } from "@/tiles/cities";
import { createPedestrianSim, PedestrianSim, WalkerSample } from "@/sim/pedestrians";
import {
  DEFAULT_TUNING,
  Citizen,
  CityState,
  CitizenSim,
  LifeStage,
  TravelMode,
  TripOutcome,
  TripPurpose,
  createCitizenSim,
} from "@/sim/citizens";
import { facilityOf, rowFor } from "@/tiles/parking";
import { JunctionSignal } from "@/sim/junctionSignal";
import {
  laneCount,
  laneCountAt,
  carLaneIndices,
  roadPortsOf,
  isRoadJunction,
  turnLandsOnBusLane,
  VehicleClass,
  type Lane,
} from "@/tiles/lanes";
import {
  buildSqueezeBanks,
  createLaneGeometry,
  informalSqueeze,
  type LaneOffsets,
} from "@/sim/laneGeometry";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { segmentPathD, roadSegmentPathD, laneSegmentPointAt } from "@/sim/pathGeometry";
import { unitLengths, couplingTiles } from "@/sim/trainDimensions";
// How many carriages a train ordered into service is built with. A PLATFORM IS
// ONE TILE LONG and a carriage is half of one, so two is what actually stands
// beside the slab when the train draws up (see platformStopDistance in
// sim/simulation.ts). Three overhung the platform at both ends: passengers
// boarded a carriage parked on plain track. Raise this only alongside longer
// (multi-tile) platforms.
export const SERVICE_TRAIN_WAGONS = 2;
import { Colors, makeRng } from "@/utils/globalHelpers";
import { assignColors, ColorAssignment } from "@/utils/colorAssignment";
import { GameLogEntry, toLogEntry } from "@/gameLog";
import { GameMode } from "@/modes/types";
import {
  GoalSpec,
  ObjectiveState,
  Observation,
  goalsOf,
} from "@/sim/objectives";
import {
  createEconomy,
  createFareBook,
  CLEARING_COST_PER_TILE,
  TRACK_COST_PER_TILE,
} from "@/sim/economy";
import { terrainBuildFactor } from "@/tiles/terrain";
import {
  CalendarSetup,
  calendarAt,
  leviesDue,
  levyYear,
  taxFor,
} from "@/sim/calendar";
import { RoadFrame } from "@/sim/road";

export interface TrainDef {
  id: string;
  x: number;
  y: number; // the depot the train starts in
  type: "people" | "fraight";
  wagonIds: string[];
  // The depots this train is asked to reach, as `"x,y"` coord ids, in order
  // (`TrainObject.routeDestinations`). The SIM does not read this — it still
  // parks on any colour match — but the DEMAND is what a fare is priced against
  // (`modes/tycoon.ts`), so the mode needs the pairing the level authored.
  destinations?: string[];
  // When set (>0), the train is NOT present at init: it is injected by the
  // mode's spawner at this sim-time, departing its depot then (Time Attack's
  // predefined schedule). Omitted / 0 → present from the start, as before.
  spawnAtSec?: number;
  // The LINE this train serves (network mode): station tile ids, in order,
  // cycled forever. Unlike `destinations` — which is metadata the sim never
  // reads — a line IS read by the sim: the train routes itself to each stop in
  // turn. Absent = a classic train that follows the points.
  line?: string[];
}

// A line as the VIEW needs it: the sim's plan plus who is running it and what
// colour it wears. The colour belongs to the LINE, not to a train's livery —
// a service has to be identifiable on the platform before anything is running
// it, and two trains on one line must not paint it two colours.
export interface LineView {
  id: string;
  name: string;
  stops: string[];
  trains: string[];
  // The buses running it. A line does not care what serves it (#90), so the
  // panel counts both and "nothing runs this" means neither.
  buses: string[];
  colour: string;
  // WHAT CAN RUN IT, from the stops on it: platforms make a rail line, kerbs a
  // bus line, and an empty line has no kind yet — the first stop decides.
  //
  // A line must never mix the two. No train can call at a kerb and no bus can
  // drive to a platform, so a mixed line is one its own vehicle silently fails
  // to run (`requestTrip` from a platform returns null, for ever). The
  // intermodal journey is TWO lines meeting at a walk link (D5), never one line
  // pretending to be both — so this is the model's word on it, and the panel
  // and the board both read it rather than each deciding for themselves.
  kind: "rail" | "road" | null;
}

// A bus as the panel sees it.
export interface BusView {
  id: string;
  lineId?: string;
  passengers: number;
  // Its seats, so the panel can read "3/12" rather than a bare count.
  seats: number;
  // The ROAD CAR it is driving right now, when it is on the board. A bus has two
  // ids — its own in the panel, its car's on the tarmac — and this is the join
  // between them: the load gauge is keyed by the car, because that is what the
  // renderer holds.
  carId?: string;
  // Where it is standing, when it is on the board at all.
  tileId?: string;
}

// Strong, well-separated hues that read against ballast and grass alike. Not
// the depot/train palette (`Colors`), which includes grey and white.
const LINE_COLOURS = [
  "#f0b429",
  "#2f9e44",
  "#1c7ed6",
  "#e03131",
  "#9c36b5",
  "#0ca678",
];

const ALL_ARMS = [
  ActiveIntersection.Left,
  ActiveIntersection.Straight,
  ActiveIntersection.Right,
];
const ENTRY_PORTS = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

// Default switch arm per entry port of every junction tile: the editor-authored
// `defaultArms` arm when present and still valid, else the first arm whose
// geometric exit is an actual connection of that tile. Non-junction tiles need
// no switch entry. (Player clicks and interlocking mutate this map later.)
export function initialSwitches(
  level: Level
): Record<string, Record<number, ActiveIntersection>> {
  const out: Record<string, Record<number, ActiveIntersection>> = {};
  for (const [id, tile] of Object.entries(level)) {
    const switches: Record<number, ActiveIntersection> = {};
    let isJunction = false;
    for (const port of ENTRY_PORTS) {
      const partners = partnersOf(tile.connections, port);
      if (partners.length <= 1) continue; // straight/curve/depot entry
      isJunction = true;
      const authored = defaultArmFor(tile, port);
      const arm =
        authored ??
        ALL_ARMS.find(a => {
          const exit = armExit(port, a);
          return exit !== null && partners.includes(exit);
        });
      if (arm !== undefined) switches[port] = arm;
    }
    if (isJunction) out[id] = switches;
  }
  return out;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Rendered width of a road car in px — must match the `.road-car` CSS width in
// PlayView/TestStage. The road sim's car body length is set from this so the
// simulated body matches the visible sprite (keeps queues packing tight).
// What a car park's roadside sign shows. Derived per frame from the road sim's
// live occupancy, so "P 3/12" and "P VOLL" are the same numbers the router reads
// when it decides whether to send a car there.
export interface ParkingSignState {
  // The one tile of the facility that draws the sign — its lowest-sorted tile
  // that actually carries bays. A ten-tile car park must not carry ten signs.
  signTileId: string;
  label: string;
  capacity: number;
  free: number;
}

const CAR_SPRITE_PX = 38;
// The lane offsets of a coupler that has an absolute pose instead of a lane
// position (a parked / manoeuvring car). Shared frozen object — it is read on the
// hot per-frame path and never mutated.
const ZERO_LANE_OFFSET = Object.freeze({ offEntry: 0, offExit: 0 });

// Jam spacing between car centres when a road is packed bumper-to-bumper, in px:
// the sprite body plus a small standing gap. Used only to estimate how many cars
// a map can physically hold (the density slider's 100% target) — not by the sim,
// which spaces cars dynamically via clearAhead.
const JAM_SPACING_PX = CAR_SPRITE_PX * 1.7;

// The number of cars a level's roads can physically hold bumper-to-bumper: every
// road tile contributes (its distinct car lanes) × (cars that fit along one tile
// length). The density slider (0–100%) scales against this, so 100% means "pack
// the streets" on any map, large or small, rather than a fixed absolute count.
function roadCarCapacity(level: Level, tileSize: number): number {
  const carsPerLaneTile = Math.max(1, Math.floor(tileSize / JAM_SPACING_PX));
  let laneTiles = 0;
  for (const tile of Object.values(level)) {
    const road = tile.road;
    if (!road) continue;
    // Distinct car lanes through this tile = sum of each approach's car lanes
    // (one directed lane per entry direction; a two-way straight counts 2).
    for (const port of roadPortsOf(road)) {
      laneTiles += carLaneIndices(road, port).length;
    }
  }
  return laneTiles * carsPerLaneTile;
}

// Right-hand-traffic lane model. A road tile is a single centreline; a car drives
// in a lane offset to the *right* of its direction of travel, so oncoming traffic
// rides the opposite side of the dashed centre and the two streams pass instead of
// meeting head-on. The paved ribbon is ~0.28·tile wide (see `.road-surface`), split
// into two ~0.14·tile lanes; a car sits at the centre of its lane, ~0.07·tile from
// the centreline. Scaled by the actual tileSize.
//
// Extending to >1 lane per direction later: widen `.road-surface` to
// `2 · lanesPerDirection` lane-widths and offset a car in lane L (0 = rightmost,
// nearest the kerb) by `(L + 0.5) · laneWidthFrac`. The sim's lane separation
// (opposing traffic never shares a lane) already generalises; only lane *assignment*
// (which of several same-direction lanes a car picks) would be new work.
// Physical width of one lane as a fraction of tile size (28px at 200px) lives in
// sim/laneOffset.ts alongside the lateral-offset math; both the car renderer here
// and the debug overlay import from there so the painted road, the per-car offset,
// and the markings stay in agreement.

// A single rendered body box of a road vehicle, sampled to a world position. A
// car/truck contributes one; a semi two (cab + trailer). The id is
// `${carId}#${segmentIndex}` so Vue reuses DOM nodes per box; `widthPx` sizes
// the sprite to the segment's length and `part` selects its style.
export interface RoadCar {
  // The drawn UNIT's id, `<vehicleId>#<unit>` — a semi is two of these.
  id: string;
  // The vehicle the unit belongs to, which is what the sim knows it as. The
  // load gauge hangs off this: it belongs to the bus, not to a segment of it.
  vehicleId: string;
  // Which unit of that vehicle this is; 0 is the leading one.
  unit: number;
  x: number;
  y: number;
  angle: number;
  widthPx: number;
  part: string;
}

// One tile-local segment of a car's drawn route: the SVG path `d` (from
// segmentPathD) plus the tile's screen origin so the overlay can place it with a
// translate. The last segment in a route carries the arrowhead at the
// destination edge.
export interface CarRouteSeg {
  d: string;
  x: number; // tile origin px (coord.x * tileSize)
  y: number;
}

// The active car's route for the debug overlay: the car id (so the view can
// colour the line to match the car) and its centreline path as tile segments.
export interface CarRoute {
  carId: string;
  segments: CarRouteSeg[];
}

// What happened to an attempted edit. `blocked` lists the tiles that refused it
// (occupied or reserved), so a caller can tell the player which ones to wait for
// rather than silently doing nothing.
export interface EditResult {
  ok: boolean;
  blocked: string[];
}

// The HUD's reactive mirror of the ledger in `sim/economy.ts`. `enabled` is
// false for every mode that declares no economy, and that single flag is what
// the money HUD gates on — so a mode without money renders no money chrome at
// all rather than a zeroed card.
export interface MoneyState {
  enabled: boolean;
  balance: number;
  earned: number;
  spent: number;
  // Of `spent`, the part that went on TRACK (net of bulldoze refunds). Split out
  // because `spent` also carries the annual tax now, and "how disciplined was
  // the build" must not become "how fast were you" — see Counters.trackSpent.
  trackSpent: number;
  // The second clock (design doc §1.3), all inert when the mode's economy names
  // no calendar: `dateLabel` is "" and the HUD renders no calendar row at all.
  dateLabel: string; // "Feb 1832"
  // What one year's upkeep costs at the CURRENT network size — the figure Train
  // Valley shows beside the capital. Falls when you bulldoze.
  taxPerYear: number;
  // Lifetime tax paid this run. Also the HUD's flash key: a levy changes it, so
  // keying the calendar row on it replays the animation exactly once per levy
  // (and a zero levy, on a board where nothing was built, correctly does not).
  taxPaid: number;
  // Upkeep the company could not pay. Non-zero ⟺ bankrupt.
  unpaidTax: number;
  // Next year's bill is more than there is in hand — i.e. unless something
  // changes, the railway folds when the year turns. The HUD's warning, and the
  // reason bankruptcy is a decision rather than an ambush: the player can still
  // bulldoze (refund now, lower the bill) or hurry a delivery. Literal, not
  // predictive: it does not try to guess what the fares will bring in.
  taxUnaffordable: boolean;
}

// Whether the board has jammed. `sec` is how long every runnable train has been
// held by the network (not by the player) — `stuck` is that having passed the
// threshold worth interrupting for. Reactive, refreshed each frame.
export interface GridlockState {
  sec: number;
  stuck: boolean;
  // What KIND of stuck, because the fix differs: "deadlock" means the trains are
  // waiting on each other and a switch will free one; "dead-end" means the rails
  // simply stop and no amount of switching helps.
  reason: "deadlock" | "dead-end";
}

// How long the board must be motionless before we call it gridlock. Long enough
// that ordinary signal queuing at a junction never trips it, short enough that a
// player does not sit wondering whether the game is broken.
export const GRIDLOCK_AFTER_SEC = 6;

// One train, as the jam test sees it.
export interface GridlockSample {
  state: TrainState;
  velocity: number;
  block?: { reason: BlockReason } | undefined;
}

/**
 * Is the board jammed, and in what way? Pure so it can be tested without a
 * running frame loop — the loop only supplies the samples and the clock.
 *
 * Rules, each earned the hard way:
 *  - A train WAITING for dispatch, or PARKED, is not part of the question.
 *  - A train held by a signal the PLAYER is holding is them playing, and is not
 *    counted as active either — otherwise holding one train on a two-train board
 *    would read as half the railway being permanently stuck.
 *  - A train stopped at a DEAD END carries no block record at all: the sim only
 *    notes a block when `mayCross` refuses, while running out of rails takes the
 *    "map edge / dead end" branch and reports proceeding. Absent block info is
 *    therefore the severed-track case — exactly what a half-built route leaves —
 *    so it must count, or the situation the nudge exists for is the one it stays
 *    silent about.
 */
export function assessGridlock(samples: GridlockSample[]): {
  jammed: boolean;
  reason: "deadlock" | "dead-end";
} {
  let active = 0;
  let stuck = 0;
  let waitingOnEachOther = 0;
  for (const s of samples) {
    // Dwelling counts as deliberately stopped, like parked/waiting: a station
    // stop is scheduled rest, not a jam (and it clears itself in seconds).
    if (s.state === "parked" || s.state === "waiting" || s.state === "dwelling")
      continue;
    if (s.block?.reason === "signal-hold") continue;
    active += 1;
    if (s.velocity > 1e-3) continue;
    stuck += 1;
    if (s.block) waitingOnEachOther += 1;
  }
  return {
    jammed: active > 0 && stuck === active,
    reason: waitingOnEachOther > 0 ? "deadlock" : "dead-end",
  };
}

// Why a train is standing still, if it is — the fare pin's third state. `by` is
// the train that owns the block ahead (with its livery, so the pin can point at
// the culprit in the board's own colour language); it is absent when the thing
// holding this train is the player's own signal hold.
export interface FareHold {
  reason: BlockReason;
  by?: string;
  color?: string;
}

// One fare pin, drawn over a train's loco. EXACTLY one per train and nothing
// else: the design doc's §5.5 lesson from Train Valley 2 is that counters,
// cargo pins, demand badges and price tags all at once do not survive a board
// that pans and zooms. A pin over a WAITING train is also its dispatch button;
// a pin over a HELD one names what it is waiting for.
export interface FareBadge {
  trainId: string;
  x: number; // world px — the loco's current position
  y: number;
  amount: number; // what the fare is worth at this instant
  waiting: boolean; // sitting in its station, click to send
  color: string; // the train's livery, so a pin names its train without text
  held?: FareHold; // stopped by traffic — undefined while it is rolling
}

// Whether two hold records say the same thing. The pin's state is rebuilt every
// frame; without this, a fresh object each tick would re-patch the DOM 60 times
// a second for a train that is simply standing still.
function sameHold(a: FareHold | undefined, b: FareHold | undefined): boolean {
  if (!a || !b) return a === b;
  return a.reason === b.reason && a.by === b.by && a.color === b.color;
}

// How far above the loco a fare pin floats, as a fraction of the tile. Enough to
// clear the sprite and the depot roof without leaving the tile.
const FARE_BADGE_LIFT = 0.34;

export interface Game {
  sim: Simulation;
  tileSize: number;
  depotColors: Record<string, string>;
  trainColors: Record<string, string>;
  switches: Record<string, Record<number, ActiveIntersection>>;
  signalTiles: string[];
  // Incremented on every accepted edit. Views deriving from the level (grid
  // cells, bounds) must read this so they re-render: the game mutates the RAW
  // level object, which Vue's proxy cannot observe. See `applyEdits`.
  levelVersion: Ref<number>;
  // Lay track while the game runs. Rejects any edit touching a tile a train is
  // standing on or has reserved — see the guard's note in createGame.
  applyEdits(steps: RouteStep[]): EditResult;
  // Whether those tiles could be edited right now, for greying out a preview.
  canEdit(tileIds: string[]): boolean;
  // The in-play BUILD verb (Tycoon phase 2): what a route would cost, and the
  // buy itself — affordability gate, then applyEdits, then the spend, in that
  // order so a refused edit (a train moved in) spends NOTHING. Only NEW pieces
  // are priced; a step whose connection the tile already carries is free, so
  // extending from an open end (whose anchor straight is re-laid) costs only
  // the tiles that actually gain rail. Modes without an economy build free.
  buildCostOf(steps: RouteStep[]): number;
  buildRoute(steps: RouteStep[]): EditResult;
  // Signal aspects for rendering, keyed `${tileId}:${exitPort}`.
  signalAspects: Record<string, "stop" | "proceed">;
  // Manual override state per signal, keyed `${tileId}:${exitPort}`.
  signalOverrides: Record<string, "auto" | "green" | "red">;
  // tileId -> trainId that currently reserves it (debug overlay).
  reservations: Record<string, string>;
  // tileId -> trainId physically on it right now (switch lock).
  occupied: Record<string, string>;
  // tileId -> passengers waiting at that station (the platform crowd).
  stationQueues: Record<string, number>;
  // tileId -> the destination each of them asked for, in queue order.
  stationWaiting: Record<string, string[]>;
  // Aligned with `stationWaiting`: the colour of the LINE each waiting person
  // boards next, "" when no service can carry them. A crowd is then read as
  // "which line is short of vehicles", not as an anonymous pile of dots.
  stationWaitingColours: Record<string, string[]>;
  // HOW FULL EACH VEHICLE IS, keyed by the id the board draws it under: a
  // train's own id, a bus's road-car id. `colour` is its line's, so a full bar
  // names the service that needs another vehicle.
  vehicleLoads: Record<string, { aboard: number; seats: number; colour: string }>;
  // tileId -> people per minute an UNSERVED platform would carry. Zero as soon
  // as a line reaches it. The "build here" hint on a board with no citizen
  // layer to be unhappy at you; never part of a score.
  stationLatent: Record<string, number>;
  // The citizen layer (Citizens mode). Empty for every other mode, which is how
  // the HUD knows not to draw the city cards at all.
  cities: CityState[];
  citizenStats: CitizenHud;
  // People on the pavements, sampled to world PIXELS each frame for rendering.
  // Empty for every mode without a citizen layer.
  pedestrians: PedestrianDot[];
  // THE INSPECTOR. All built on demand — nothing is stepped or stored, so a
  // closed panel costs nothing. Null/empty on every mode without citizens.
  inspectPlot(plotId: string): PlotCard | null;
  inspectPerson(id: string): PersonCard | null;
  compareModes(id: string): ModeCompare[];
  // A journey length on the town's clock ("14 min", "1h 24m"), using THIS
  // game's day length — so a view never has to know `secPerDay`.
  durationLabel(sec: number): string;
  // Ticks once per drawn frame. Read it from any getter that samples the sims
  // on demand, or Vue will cache the first answer for ever — see the note where
  // it is declared.
  renderTick: Ref<number>;
  // Where somebody is on the board right now, for the PIN that follows them.
  // Null when they no longer exist. Sampled from the SIMS, not read off the
  // DOM, so the pin is right on its first frame and a headless test can prove
  // it tracks a moving person.
  locatePerson(id: string): PersonFix | null;
  // The person behind a figure on the pavement / behind a car on the road.
  personWalking(walkerId: string): string | null;
  personDriving(carTripId: string): string | null;
  // trainId -> the stops it serves (the service panel's model). A view copy of
  // what the SIM owns; changes only on a player action.
  trainLines: Record<string, string[]>;
  // stationTileId -> the liveries calling there, so a platform can show its
  // services. Derived from `trainLines`.
  stationLines: Record<string, string[]>;
  // Trains ordered but still waiting in the shed, oldest first.
  queuedTrains: string[];
  // Every station on the board, in a stable order — the stops a line can pick
  // from, and what the panel offers.
  stationTiles: string[];
  // Every depot: where a train can be ordered.
  depotTiles: string[];
  // Put a train onto a line, or take it out of service with []. False for an
  // unknown train.
  setLine(trainId: string, stops: string[]): boolean;
  // Order a new train at a depot and put it straight into service. Returns the
  // new train's id, or null when there is no free depot to build it in.
  buyTrain(stops: string[], depotId?: string): TrainDef | null;
  // Withdraw a train the orderly way: it leaves its line and runs to the
  // nearest depot, where it is stabled and leaves the game. False when there
  // is no depot it can reach — offer `scrapTrain` then.
  retireTrain(trainId: string): boolean;
  // Scrap a train where it stands (the emergency verb). Always succeeds for a
  // train that exists, including one still queued in the shed.
  scrapTrain(trainId: string): boolean;
  // Trains gone from the game — retired or scrapped. The board reads this to
  // stop drawing them.
  removedTrains: string[];
  // trainId -> the stop it is heading for, and the ids being withdrawn. View
  // copies of sim state, refreshed each frame (the sim itself is not reactive).
  trainNextStops: Record<string, string>;
  retiringTrains: string[];
  // stationTileId -> its display name.
  stationLabels: Record<string, string>;
  // The line currently being shown on the board (call-order badges + the route
  // along the metals), or a cleared one. Set by the view via setLineOverlay.
  lineOverlay: {
    lineId: string | null;
    trainId: string | null;
    // What can run the line being drawn (LineView.kind), so a tile can tell
    // whether it is a stop this line could still take.
    kind: "rail" | "road" | null;
    colour: string;
    // stationTileId -> its call position(s) as the badge's label. A line may
    // call at a stop twice (A→C→B→C), and then the badge carries both places
    // ("2·4") — one number would hide the revisit the player just drew.
    order: Record<string, string>;
    path: Record<string, [Port, Port][]>;
  };
  setLineOverlay(what: { lineId?: string; trainId?: string } | null): void;
  // Every line on the board, in creation order — the plans, independent of the
  // trains running them. A line with `trains: []` is drawn but unserved.
  lines: LineView[];
  // Draw a line before buying anything; returns its id.
  createLine(stops: string[], name?: string): string;
  setLineStops(lineId: string, stops: string[]): boolean;
  renameLine(lineId: string, name: string): boolean;
  // Delete a line. Its trains survive as classic lineless services.
  deleteLine(lineId: string): boolean;
  // Put a train onto an existing line, or take it off with null.
  assignTrain(trainId: string, lineId: string | null): boolean;
  // BUSES (#90). Planned exactly like trains: draw a line, buy a bus, assign
  // it. Bought INTO service — with a line it starts running at once, without
  // one it waits. There is no garage: a bus lives on its line and appears at
  // its first stop.
  buyBus(lineId?: string): string;
  assignBus(busId: string, lineId: string | null): boolean;
  removeBus(busId: string): boolean;
  // Every bus, mirrored for the panel.
  busServices: BusView[];
  // Every bus stop on the board. The panel offers a bus only where one could
  // actually appear.
  busStopTiles: string[];
  // Road-traffic cars, sampled to world positions each frame for rendering.
  roadCars: RoadCar[];
  // Road-junction tile -> car id currently holding it (debug overlay). Derived
  // live from car positions each frame; cars carry no stored reservation.
  carJunctions: Record<string, string>;
  // In debug mode: destination tile id -> car id for cars heading there.
  carDestinations: Record<string, string>;
  // Live parking occupancy: stall id -> the car sitting in it. The renderer paints
  // a taken bay differently; refreshed each frame in place so Vue only notifies on
  // a real change.
  parkingOccupancy: Record<string, string>;
  // Per car park, what its sign says: which tile carries the sign, its name, and
  // how full it is. Keyed by facility id.
  parkingStatus: Record<string, ParkingSignState>;
  // Street-junction traffic signals (#38). Per-arm aspect of each signalised road
  // junction, keyed `${tileId}:${arm}` → green/amber/red, refreshed each frame.
  roadSignalAspects: Record<string, "green" | "amber" | "red">;
  // The live signal (mode + bus-priority) of each road junction whose mode is not
  // "off", keyed by tile id. Absent ⟺ not signalised. The renderer reads this to
  // decide whether to draw signal heads + a mode chip.
  roadSignals: Record<string, JunctionSignal>;
  // In debug mode: the route of the hovered/pinned car (null when none). The view
  // sets the active car via the methods below (only while debug is on) and draws
  // this as a highlighted line. Pinned takes precedence over hovered.
  carRoute: Ref<CarRoute | null>;
  // Newest-last activity log of decision-level simulation events (reservations,
  // holds, deliveries) for the debug panel. Capped to the most recent entries.
  eventLog: GameLogEntry[];
  paused: Ref<boolean>;
  speed: Ref<number>;
  deliveries: Ref<number>;
  // Reactive mirror of the mode's ledger (all zeros + enabled:false when the
  // mode declares no economy).
  money: MoneyState;
  // Live jam state, for the "your trains are stuck" nudge. See GridlockState.
  gridlock: GridlockState;
  // Clear a tile's rails for a DEMOLITION FEE (never a refund — see
  // CLEARING_COST_PER_TILE). Refuses on a depot, on a tile a train occupies or
  // has reserved, and on a fee the balance cannot cover.
  bulldoze(tileId: string): EditResult;
  // What bulldozing that tile would COST — for the preview, so what is shown is
  // what is charged.
  bulldozeCostOf(tileId: string): number;
  // Take back the last build gesture: rails gone, money back in full, nothing
  // charged. This is the answer to a MISDRAG, which is an input error rather
  // than a world event — keeping it separate from `bulldoze` is what lets the
  // demolition price be honest. Available until the player does something else
  // (another build replaces it; a bulldoze or a dispatch drops it).
  undoBuild(): EditResult;
  canUndoBuild(): boolean;
  // What undo would hand back, and 0 when there is nothing to take back.
  undoValue(): number;
  // Reactive mirror of the above, for the view. `pieces > 0` ⟺ there is a
  // purchase to take back (Sandbox builds free, so `value` can be 0 and the
  // undo still real).
  undoable: Ref<{ pieces: number; value: number }>;
  // One fare pin per live, unpaid train, refreshed each frame beside the sprites.
  fareBadges: FareBadge[];
  // Send a waiting train (Tycoon). Returns false when the train isn't waiting —
  // no mode without `controls.dispatch` ever has one, so this is a no-op there.
  dispatch(trainId: string): boolean;
  mode: GameMode;
  // The board's goals as TARGETS, readable before the run starts. A plain
  // field, not a getter: mode.setup() runs exactly once (reset() rebuilds the
  // sims and the tracker but never re-runs setup), so this cannot go stale.
  // Deliberately not `objective.stars`, which is re-projected every frame and
  // whose `earned` flags are true-by-default over zeroed counters.
  goals: GoalSpec[];
  // Reactive snapshot of the objective tracker, refreshed each frame.
  objective: ObjectiveState;
  // Reactive live crossing-flow snapshot (the *current* worst car wait, not the
  // high-water mark the objective scores), for the HUD's live tension readout.
  roadFrame: RoadFrame;
  start(): void;
  stop(): void;
  // Step the world by `dt` SIM seconds without rendering — what the rAF frame
  // calls, exposed so behaviour can be driven headlessly. `game.sim.step()`
  // moves the trains alone; this also runs the fares, the annual levy, the
  // objective tracker and the road, so anything that only happens in the loop
  // (the second clock, most of all) is testable without a browser.
  advance(dt: number): void;
  // Move Ready -> Playing (the Start button).
  startObjective(): void;
  // Win/Lose -> Ready with the same seed, for Retry (a true do-over).
  reset(): void;
  toggleHold(tileId: string, exitPort: Position): void;
  isHeld(tileId: string, exitPort: Position): boolean;
  forceProceed(tileId: string, exitPort: Position): void;
  isProceedForced(tileId: string, exitPort: Position): boolean;
  // Cycle a signal's manual state: Auto -> Force Green -> Force Red -> Auto.
  cycleSignal(tileId: string, exitPort: Position): void;
  // The manual override state of a signal, for the renderer's indicator.
  signalOverride(tileId: string, exitPort: Position): "auto" | "green" | "red";
  positionUnit(body: UnitChord): { x: number; y: number; angle: number };
  // The number of road lanes entering the tile at `coord` from `port`, or 0
  // if there is no road tile there / no lanes from that port. Used by the
  // tile renderer to taper the road surface at lane-count transitions
  // (the wider of this tile and the neighbour dictates the painted width
  // at the shared edge).
  roadLaneCount(coord: Coordinates, port: Position): number;
  // The total physical lanes crossing the tile's `port` boundary (both
  // directions), counting lanes entering FROM the port plus distinct lanes
  // exiting THROUGH it. Unlike summing roadLaneCount(port)+roadLaneCount(opposite),
  // this is correct for curves/junctions where the opposite port carries no
  // lanes — so a straight tapers to meet a curve neighbour at its true width.
  roadLaneCountAt(coord: Coordinates, port: Position): number;
  // Whether the tile at `coord` is a road junction (its road touches more than
  // two ports). The renderer uses this so a seam touching a junction is never
  // flagged as a lane-count mismatch — a junction fans/merges unequal arms by
  // design, on either side of the seam.
  roadIsJunctionAt(coord: Coordinates): boolean;
  // The directed lanes of the road tile at `coord` (undefined if none). Lets the
  // renderer read a neighbour junction's per-lane turns to paint lane-direction
  // arrows on the approach tile.
  roadAt(coord: Coordinates): Lane[] | undefined;
  // The widest lane count along the contiguous one-way straight run through this
  // tile in the travel direction entered via `entry`. One-way roads kerb-anchor
  // (index 0) to this width (highway lane drop): the through lanes run straight and
  // the centre lane ends. Returns this tile's own one-way count when not a one-way run.
  roadOneWayRunMax(coord: Coordinates, entry: Position): number;
  // The lateral offset (px, right-of-travel) a class-`cls` vehicle in approach
  // lane `entryLane` lands at on the EXIT arm of a TURN through `coord` (a curve /
  // junction movement, entry→exit adjacent). null for a dead-end / map edge. The
  // debug lane overlay uses this so a turn arrow ends on the SAME lane the car
  // glides to (couplerOffset's turn branch), never on a phantom lane.
  roadTurnExitOffsetPx(
    coord: Coordinates,
    entry: Position,
    exit: Position,
    entryLane: number,
    cls: VehicleClass,
  ): number | null;
  // Whether a class-`cls` vehicle making the TURN entry→exit through `coord` lands
  // on a BUS lane on the exit arm. The debug overlay paints a movement amber only
  // when this holds, so an amber arrow always ends on a real bus lane (a bus
  // falling back to a car lane renders cyan — overlay == where it drives).
  roadTurnExitIsBusLane(
    coord: Coordinates,
    entry: Position,
    exit: Position,
    entryLane: number,
    cls: VehicleClass,
  ): boolean;
  // Debug route overlay — the view drives these on car hover/click (debug only):
  setHoveredCar(carId: string): void; // preview this car's route while hovering
  clearHoveredCar(): void; // hover left a car
  togglePinnedCar(carId: string): void; // click: pin this car's route (or unpin)
  clearRouteCar(): void; // click empty space: drop hover + pin
  // Cycle a road junction's traffic-signal mode live in play (off → two-phase →
  // two-phase+bus → round-robin → round-robin+bus → off). No-op off a road junction.
  cycleRoadSignal(tileId: string): void;
}

// The whole-board citizen readout: the numbers the HUD shows above the per-city
// cards. `enabled` is the one flag a view needs — false means this mode has no
// citizen layer and the panel should not exist.
export interface CitizenHud {
  enabled: boolean;
  population: number;
  travelling: number;
  // How many of this board's people are a car on the road at this instant.
  driving: number;
  // ...how many are a bike on the road — the trade against `driving` is the
  // bicycle phase's whole point, so both numbers show.
  cycling: number;
  // ...and how many are a figure on a pavement.
  onFoot: number;
  // ...and how many have a car standing in a bay right now, holding it against
  // everyone else. The observable that says commuter parking is happening.
  carsParked: number;
  // ...and how many of those are on their own drive at home rather than out at
  // a workplace. The two swap over across a day, which is the cycle itself.
  carsAtHome: number;
  tripsCompleted: number;
  tripsRefused: number;
  tripsAbandoned: number;
  clock: string; // "07:35" — the citizens' day, not the calendar's year
  day: number;
  modeShare: Record<TravelMode, number>;
  // Who this town is made of. `travelling` says how busy the board is right now;
  // this says WHY it is busy at this hour rather than some other one.
  byStage: Record<LifeStage, number>;
}

// THE INSPECTOR — one person's day, and the choice behind it.
//
// A view model, built on demand: nothing here is stepped, stored or reactive,
// so opening a panel costs a click and closing it costs nothing. The numbers
// come straight from `CitizenSim.quoteFor`, which is the same call the model
// makes when it decides — a panel that re-derived the comparison would drift
// from the decision and be confidently wrong.
//
// JOURNEY TIMES ARE BOARD SECONDS, not in-game minutes, and that is deliberate.
// The citizens' day is `secPerDay` sim seconds wide (300 in Citizens mode), so
// converting a journey to the in-game clock makes a cross-town rail commute read
// as EIGHT HOURS — internally consistent, and useless to plan with. Board
// seconds are what a player can check against a stopwatch while they watch, and
// the comparison between modes is what the panel is for. Times of DAY (when
// somebody leaves, when they come back) stay on the in-game clock, because that
// is the clock the HUD shows and they are read against it.

/** One person, as the panel shows them. */
export interface PersonCard {
  id: string;
  name: string;
  home: string;
  work: string | null;
  mood: number;
  carOwner: boolean;
  /** What stage of life they are at, and that stage in words for the panel. */
  stage: LifeStage;
  stageLabel: string;
  /**
   * Their day, in order, on the in-game clock. Rolled once when they move in and
   * never re-rolled — a schedule is a clock, not a planner.
   *
   * A LIST rather than the three fixed fields it replaces, because a day is no
   * longer three fixed things: a tradesperson has six, a retired resident four,
   * and a child's afternoon happens every other day.
   */
  schedule: ScheduleLine[];
  // Right now.
  at: string;
  doing: string;
  travellingTo: string | null;
  mode: TravelMode | null;
  // How long the journey in progress has run, and how long they think it OUGHT
  // to take — the two numbers their mood is about to be scored on. The
  // expectation is a straight-line yardstick, never what the network offers, so
  // a bad network cannot grade itself. Board seconds.
  elapsedSec: number | null;
  expectedSec: number | null;
  unhappyDays: number;
  /**
   * WHY they feel that way: their last few journeys, newest first, already put
   * into words. "Thinking of leaving" with nothing beside it is the least
   * useful thing a panel can say — a player cannot act on a mood, only on the
   * journey that caused it.
   */
  recent: TripNote[];
}

/** One line of somebody's day, as the panel prints it. */
export interface ScheduleLine {
  /** "07:35" — when the window opens, on the in-game clock. */
  at: string;
  /** "leaves for work", "drives out to a job". */
  what: string;
  /** False for the every-other-day entries, which the panel marks as such. */
  daily: boolean;
}

/** One remembered journey, as a line the panel prints. */
export interface TripNote {
  text: string;
  /** Negative for a grievance, positive for a journey that went well. */
  delta: number;
  good: boolean;
}

/** Where a pinned person is right now, in world pixels, and what they are on. */
export interface PersonFix {
  id: string;
  x: number;
  y: number;
  /** What is carrying them — the pin labels itself with this. */
  on: "foot" | "car" | "train" | "platform" | "indoors";
}

/** One row of the "what would each way take?" table. */
export interface ModeCompare {
  mode: TravelMode;
  /** The honest door-to-door estimate in board seconds. Null when not on offer. */
  seconds: number | null;
  /** "14 min" / "1h 24m" — the same number on the town's clock, ready to render. */
  label: string;
  /** The same journey in raw board seconds. A tooltip, not the headline. */
  boardLabel: string;
  /**
   * The same journey after this person's habits: the walk inflated past their
   * patience, the car scaled by how much they like driving, the train by how
   * much they trust it. THIS is what decides, and the gap between it and
   * `seconds` is a person choosing against their own stopwatch.
   */
  perceivedSeconds: number | null;
  chosen: boolean;
  /** Plain-English reason it is not on offer, or null when it is. */
  why: string | null;
}

/**
 * A journey length on the TOWN'S OWN CLOCK: "14 min", "1h 24m".
 *
 * Board seconds were the wrong unit and it took fixing the day length to see
 * why. They were chosen when a day was 300 board seconds, which made a
 * cross-city commute convert to eight and a half in-game hours — so the
 * in-game clock was nonsense and seconds were the only honest thing to print.
 * Calibrating the day (`secPerDay`, measured) removed that problem, and left
 * the real one exposed: the card MIXED TWO UNITS. "Leaves at 07:08" and "took
 * 1m 23s" do not compose — a player cannot work out when she gets there. One
 * clock, and the arithmetic works.
 */
export function inGameDuration(sec: number, secPerDay: number): string {
  if (!isFinite(sec)) return "—";
  const mins = Math.round((sec / secPerDay) * 24 * 60);
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

/** "1m 35s" / "42s" — raw board seconds, for debugging and tooltips. */
export function boardDuration(sec: number): string {
  if (!isFinite(sec)) return "—";
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Everything the panel needs for one plot: what it is, and who is on it. */
export interface PlotCard {
  id: string;
  city: string;
  kind: PlotKind;
  density: number;
  people: number;
  capacity: number;
  residents: PersonCard[];
}

const REFUSAL_TEXT: Record<string, string> = {
  // "too-far" is shared by walking AND cycling: each mode's own reach ran out.
  "too-far": "further than they will go",
  "no-car": "no car",
  "no-bike": "no bike",
  "no-road-link": "no road joins the two ends",
  "no-railway": "no railway",
  "no-station-in-reach": "no station within reach",
  "no-park-and-ride": "no park & ride in reach",
  "no-rack": "no bike rack at a station in reach",
  "same-station": "same station both ends",
};

// One walking person, positioned for the renderer.
export interface PedestrianDot {
  id: string;
  x: number; // world px
  y: number;
  // Held at a kerb waiting for the road to clear. The view dims them, so a queue
  // at a crossing reads as a queue.
  waiting: boolean;
}

// How many people a platform holds under the citizen layer. Generous on
// purpose: this is a physical cap on the CROWD, not a difficulty dial, and the
// interesting pressure is meant to come from the train's seats and its
// timetable — not from a queue that silently refuses to form.
const CITIZEN_PLATFORM_CAP = 60;

export function createGame(
  level: Level,
  trainDefs: TrainDef[],
  tileSize: number,
  mode: GameMode,
  colorSeed = 1,
  // When provided, these depot/train colours are used verbatim (the test world
  // pins them, e.g. to force a depot colour-mismatch bounce); otherwise the
  // seeded `assignColors` guarantees every train a reachable matching depot.
  colors?: ColorAssignment,
  // Per-level road-traffic settings (busyness + vehicle mix). Overlays the
  // sim's defaults; omitted → the all-cars default behaviour.
  traffic?: TrafficConfig,
  // Identifies the board for per-level best-score persistence.
  levelId = "default",
  // Live road-traffic density as a percentage (0–100) of what the map's roads can
  // physically hold. A callback so the slider can change density without
  // restarting the game; scaled to an absolute car cap against the level's
  // capacity below. Overrides traffic.maxCars.
  densityPct?: () => number,
): Game {
  const switches = reactive(initialSwitches(level)) as Record<
    string,
    Record<number, ActiveIntersection>
  >;

  // Tiles that carry a signal (block boundaries) — any cell with signal ports.
  // For RENDERING only: the simulation derives its own boundaries from the level
  // live (see `isSignalTile` there), so this list going stale can't affect
  // routing. `applyEdits` refreshes it anyway.
  let signalTiles = Object.entries(level)
    .filter(([, tile]) => tile.signals && tile.signals.length > 0)
    .map(([id]) => id);

  // The board's opening state, for Retry. `applyEdits`/`buildRoute` mutate the
  // live level in place; reset() restores this snapshot so a Tycoon Retry that
  // hands back the starting capital does not also keep the track that capital
  // already bought (a free-track exploit otherwise). Plain data, so a JSON
  // round-trip is a faithful deep copy.
  const pristineLevel: Level = JSON.parse(JSON.stringify(level));

  // Bumped whenever the level itself changes, so views can re-derive from it.
  // Vue can NOT see these mutations on its own: `level` here is the raw object,
  // while the view holds a reactive proxy of the same target — writing through
  // the raw one updates the simulation (which reads it live) but notifies
  // nobody. Handing the game the proxy instead would put a Proxy in the hot
  // path, where `traverse` indexes the level thousands of times a tick. An
  // explicit version counter keeps the sim fast and the view correct.
  const levelVersion = ref(0);

  // Reactive signal aspects for rendering, keyed `${tileId}:${exitPort}`. The
  // game loop refreshes these from the simulation each frame.
  const signalAspects = reactive({}) as Record<string, "stop" | "proceed">;

  // Reactive manual-override state per signal for the renderer's indicator,
  // refreshed from the simulation each frame alongside the aspects.
  const signalOverrides = reactive({}) as Record<
    string,
    "auto" | "green" | "red"
  >;

  function overrideState(
    tileId: string,
    exitPort: Position
  ): "auto" | "green" | "red" {
    if (sim.isProceedForced(tileId, exitPort)) return "green";
    if (sim.isHeld(tileId, exitPort)) return "red";
    return "auto";
  }

  // Reactive reservation map for the debug overlay, refreshed each frame.
  const reservations = reactive({}) as Record<string, string>;

  // Reactive occupancy map (train physically on a tile) for the switch lock,
  // refreshed each frame alongside the reservations.
  const occupied = reactive({}) as Record<string, string>;
  // tileId -> passengers waiting on that station's platform, mirrored from the
  // sim each frame so Tile.vue can draw the crowd reactively.
  const stationQueues = reactive({}) as Record<string, number>;
  // tileId -> where each of them is going, in queue order. The crowd is drawn
  // from this, so a dot's colour says which platform its person asked for —
  // a queue nobody serves is then visible as one colour piling up.
  const stationWaiting = reactive({}) as Record<string, string[]>;
  // Aligned with `stationWaiting`: the colour of the LINE each of those people
  // will board next, or "" when nothing can carry them. See updateStationQueues.
  const stationWaitingColours = reactive({}) as Record<string, string[]>;
  // trainId -> the stops it serves, mirrored from the sim so the service panel
  // renders reactively. The SIM owns the line; this is a view copy, refreshed
  // whenever a line changes (it changes on player action, not per frame).
  const trainLines = reactive({}) as Record<string, string[]>;
  // stationTileId -> the COLOURS of the lines calling there. Derived from the
  // lines, not from the trains running them: a line the player has drawn but
  // not yet bought a train for still serves this platform, and a passenger
  // planning around it is entitled to see it (D11).
  const stationLines = reactive({}) as Record<string, string[]>;
  // Every line, mirrored from the sim for the panel and the board.
  const lines = reactive([]) as LineView[];
  // stationTileId -> people per minute this platform WOULD carry if anything
  // called there. Zero once a service does. See `latentDemandAt`.
  const stationLatent = reactive({}) as Record<string, number>;
  // Ids of trains ordered but still waiting in the shed, oldest first — the
  // panel shows them so a queue is visible rather than a button that seems to
  // have done nothing.
  const queuedTrains = reactive([]) as string[];
  // Ids of trains that have left the game (stabled or scrapped). The view
  // keeps its own roster keyed by id and cannot know when a RETIRING train
  // finally reaches its shed, so it reads this instead.
  const removedTrains = reactive([]) as string[];
  // The stop each train is heading for, and which are being withdrawn. These
  // live in the SIM, which is markRaw and therefore invisible to Vue — a view
  // getter that read them directly never re-ran and the panel froze on whatever it
  // showed first. Mirrored per frame like every other live readout.
  const trainNextStops = reactive({}) as Record<string, string>;
  // How full each vehicle is — see updateVehicleLoads.
  const vehicleLoads = reactive({}) as Record<
    string,
    { aboard: number; seats: number; colour: string }
  >;
  const retiringTrains = reactive([]) as string[];

  // What each stop is CALLED — platforms and kerbs alike. Level data, so
  // computed once.
  const stationLabels = stationNames(level);


  // THE LINE OVERLAY: while a line is being edited the board shows it the way
  // Transport Fever does — a big call-order number on each stop and the route
  // itself drawn along the metals. Held here rather than in the view because
  // the ROUTE has to be planned (the same router the trains use), and that is
  // engine work, not rendering.
  const lineOverlay = reactive({
    // A LINE is what is drawn, not a train's copy of one — so the picture is
    // available for a service nothing is running yet, which is the state a
    // player is in for as long as it takes them to buy the first train.
    lineId: null as string | null,
    // The train whose panel row opened it, when one did. Only used to keep the
    // row highlighted; the drawing itself never needs it.
    trainId: null as string | null,
    // The line's kind (LineView.kind), so a tile can tell whether it is a stop
    // this line could still take. Without it every platform invites a click
    // while a BUS line is open — a hollow "+" on something the click refuses.
    kind: null as "rail" | "road" | null,
    colour: "",
    // stationTileId -> its 1-based place(s) in the line, joined for the badge.
    order: {} as Record<string, string>,
    // The SEGMENTS the line runs over, per tile: the (entry, exit) pairs a
    // train actually drives. Not merely the tile ids — on a junction that
    // would light every arm, including the depot spur the line never takes.
    path: {} as Record<string, [Port, Port][]>,
  });

  function clearLineOverlay(): void {
    lineOverlay.lineId = null;
    lineOverlay.trainId = null;
    lineOverlay.kind = null;
    lineOverlay.colour = "";
    for (const k of Object.keys(lineOverlay.order)) delete lineOverlay.order[k];
    for (const k of Object.keys(lineOverlay.path)) delete lineOverlay.path[k];
  }

  // Show (or re-show, after an edit) a line on the board. Null clears it.
  // Either name the line directly, or name a train and get whatever it runs.
  function setLineOverlay(what: { lineId?: string; trainId?: string } | null): void {
    clearLineOverlay();
    if (!what) return;
    const lineId = what.lineId ?? (what.trainId ? sim.lineOf(what.trainId) : undefined);
    if (!lineId) return;
    lineOverlay.lineId = lineId;
    lineOverlay.trainId = what.trainId ?? null;
    lineOverlay.colour = lines.find(l => l.id === lineId)?.colour ?? "#f0b429";
    const stops = sim.lines().find(l => l.id === lineId)?.stops ?? [];
    lineOverlay.kind = lineKindOf(stops);
    stops.forEach((id, i) => {
      // A stop listed twice carries BOTH places ("2·4"): a revisit is a fact
      // about the line the player just drew, and a badge showing only the
      // first call would make the second look like it never registered.
      const place = String(i + 1);
      lineOverlay.order[id] = lineOverlay.order[id]
        ? `${lineOverlay.order[id]}·${place}`
        : place;
    });
    const addSegment = (tileId: string, a: Port, b: Port) => {
      const at = (lineOverlay.path[tileId] ??= []);
      if (!at.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) {
        at.push([a, b]);
      }
    };
    // The metals between each pair of stops, planned with the router the
    // trains themselves use — so the drawn line is the line they will drive,
    // not a straight guess between platforms.
    for (let i = 0; i < stops.length; i++) {
      const from = stops[i];
      const to = stops[(i + 1) % stops.length];
      if (stops.length < 2 || from === to) continue;
      const coord = parseCoordId(from);
      // Try each way out of the station; take the shorter route that arrives.
      let best: { tileId: string; entryPort: Port; exitPort: Port }[] | null = null;
      for (const entry of [Position.Left, Position.Right, Position.Top, Position.Bottom]) {
        const plan = planRailRoute(level, { coord, entryPort: entry }, [to]);
        if (plan && (!best || plan.steps.length < best.length)) best = plan.steps;
      }
      for (const step of best ?? []) {
        addSegment(step.tileId, step.entryPort, step.exitPort);
      }
    }
  }

  // Depot + train colours are owned here so the simulation's "matched delivery"
  // logic and the rendered colours always agree. A seeded RNG keeps the
  // assignment deterministic, and `assignColors` guarantees every train has a
  // reachable matching depot (see colorAssignment.ts).
  const assignedColors =
    colors ?? assignColors(level, trainDefs, makeRng(colorSeed));
  const depotColors = assignedColors.depotColors;
  // The train roster is REACTIVE, and a COPY. Reactive because `trainColors`
  // is not just paint — its key set IS the list of trains that exist, which is
  // what the service panel iterates to draw its rows. `game` is provided
  // markRaw, so a plain record here gives that computed nothing to track: it
  // caches its first answer and a bought train never appears in the panel. On
  // a board that starts with no trains the list then stays empty for ever.
  // (Same trap as `trainNextStops`/`retiringTrains` — see docs/KNOWHOW.md.)
  // A copy because `buyTrain` writes into this record, and `colors` may be a
  // scenario's own object shared across runs — proxying and mutating it would
  // leak bought trains from one game into the next.
  const trainColors = reactive({ ...assignedColors.trainColors }) as Record<
    string,
    string
  >;

  // Road traffic geometry (deterministic from the level): grid extents.
  let roadW = 0;
  let roadH = 0;
  for (const id of Object.keys(level)) {
    const { x, y } = parseCoordId(id);
    roadW = Math.max(roadW, x + 1);
    roadH = Math.max(roadH, y + 1);
  }
  const allRoadEntries = roadEntries(level, roadW, roadH);
  // How many cars this map's roads can physically hold. The density slider is a
  // percentage of this, so 100% packs the streets on any map (a tiny test road
  // and the full play board both fill proportionally). Clamped to ≥1 so a road
  // map is never capped to zero by rounding.
  const roadCapacity = Math.max(1, roadCarCapacity(level, tileSize));
  // Resolve the live density% → an absolute car cap for the sim. Falls back to
  // the scenario's pinned traffic.maxCars (absolute) when no slider is wired.
  const carCapOf = (): number =>
    densityPct
      ? Math.round((Math.max(0, Math.min(100, densityPct())) / 100) * roadCapacity)
      : traffic?.maxCars ?? 8;
  // The train + road sims are built together so `reset()` can rebuild both from
  // the same inputs (the simulation has no in-place reset), giving a true,
  // deterministic do-over for Retry. They're `let` so the rebuild reassigns them;
  // every closure below reads the current binding. The crossing gate is the train
  // reservation/occupancy on that tile — no new interlocking.
  let sim!: Simulation;
  let roadSim!: ReturnType<typeof createRoadSim>;
  // Resolved BEFORE the sims are built, because what the mode asks for changes
  // how they are built: a mode that populates the board with citizens supplies
  // its own passengers, so the synthetic per-station schedule must not also run.
  const setup = mode.setup({ level, trains: trainDefs, levelId });
  const citizenSetup = setup.citizens;
  // The TrainInit for a def, with the colour + real sprite lengths resolved here
  // (the single place those are known). Used both to seed the sim at init and to
  // inject a scheduled train mid-run, so a spawned train is byte-for-byte the
  // same as one present from the start.
  function trainInit(def: TrainDef) {
    return {
      id: def.id,
      coord: { x: def.x, y: def.y },
      entryPort: Position.Center, // leaves its depot outward
      color: trainColors[def.id],
      type: def.type,
      wagonCount: def.wagonIds.length,
      // In service on a line (network mode): the train drives itself between
      // these stops instead of following the points. Absent = the classic
      // train, unchanged.
      ...(def.line?.length ? { line: def.line } : {}),
      // Real sprite lengths (in tiles) so the sim spaces units to fit them.
      unitLengths: unitLengths(def.type, def.wagonIds.length, tileSize),
      coupling: couplingTiles(tileSize),
    };
  }

  // Whether a def is present in the sim from the start (no schedule) or injected
  // later by the spawner at its spawnAtSec.
  const isScheduled = (def: TrainDef) => (def.spawnAtSec ?? 0) > 0;

  // Every place a passenger can WAIT: rail platforms and bus stops alike. Since
  // #90 a bus is planned like a train, so a stop is a node of the same network —
  // which is why this is one list and not two, and why the transit layer below
  // is handed it rather than reading tiles itself.
  const busStops = busStopTiles(level);
  const transitStops = new Set<string>([
    ...Object.keys(level).filter(id => level[id]?.role === "station"),
    ...busStops,
  ]);

  // The kind of vehicle a stop takes — and therefore a line's kind, which is
  // the kind of the stops on it. See LineView.kind for why a line must not mix.
  function stopKindOf(tileId: string): "rail" | "road" | null {
    if (level[tileId]?.role === "station") return "rail";
    return busStops.includes(tileId) ? "road" : null;
  }
  function lineKindOf(stops: readonly string[]): "rail" | "road" | null {
    for (const s of stops) {
      const kind = stopKindOf(s);
      if (kind) return kind;
    }
    return null;
  }

  // Who turns up where. DERIVED from the ground within walking reach
  // (tiles/catchment.ts): a town nearby means faster arrivals and a fuller
  // platform; a lonely halt sees a trickle. The sim only executes the schedule
  // it is handed — it stays terrain-blind. Snapshotted at construction, so a
  // stop built mid-run queues nobody until reset.
  //
  // Demand is ADDITIVE (#117): a stop carries EDGE demand — the derived spawn
  // schedule, reinterpreted as travellers the map imports from off-board — on
  // top of whatever citizens the map explains. The two share one queue and are
  // told apart by tags (a citizen waits under their own id; an edge rider is
  // anonymous), so neither can double-count the other; they compete only for
  // seats and platform room, which is the game.
  //
  // `TileCell.edgeDemand` is the per-stop dial: the share of the derived
  // schedule that is edge traffic. The DEFAULT is what dissolves the old
  // per-mode XOR without moving a single existing board: 1 (the full schedule
  // — the old synthetic demand) where there is no citizen layer, 0 (the map
  // explains everything) where there is one.
  //
  // Whatever the share, `max` survives as the CAP: under the citizen layer it
  // is at least CITIZEN_PLATFORM_CAP, because without one every stop falls
  // back to the hard cap (16), which a morning peak in a town of forty exceeds
  // — and a commuter who cannot even JOIN the queue stands there until they
  // give up, which reads as a broken railway when the railway is fine.
  function demandFor(id: string): StationDemand {
    // A kerb serves the houses around it; a station gathers a district. Giving
    // a stop a platform's numbers makes the bus the main line and the railway
    // an afterthought, which is backwards for a board where it is the feeder.
    const derived =
      level[id]?.role === "station"
        ? stationDemandOf(level, id)
        : busStopDemandOf(level, id);
    // `??`, never `||`: an authored 0 must mean OFF even where the default is 1.
    const share = level[id]?.edgeDemand ?? (citizenSetup ? 0 : 1);
    const max = citizenSetup
      ? Math.max(CITIZEN_PLATFORM_CAP, derived.max)
      : derived.max;
    if (!(share > 0)) {
      return { intervalSec: Number.POSITIVE_INFINITY, max, initial: 0 };
    }
    return {
      // The share scales the RATE by division — half the share, twice the gap
      // between arrivals — and the opening crowd multiplicatively. Never the
      // cap: a dial that could quietly lower `max` would re-introduce the
      // queue-join failure the cap exists to prevent.
      intervalSec: derived.intervalSec / share,
      max,
      initial: Math.min(Math.round((derived.initial ?? 0) * share), max),
    };
  }

  // Rebuilt with the sims, never before them: a Retry has to give back the same
  // empty platforms and the same lines the board opened with, and a layer that
  // survived the rebuild would hand the new sim the old crowd.
  let transit!: TransitLayer;

  function buildSims() {
    transit = createTransit({
      demand: Object.fromEntries([...transitStops].map(id => [id, demandFor(id)])),
      isStop: (tileId: string) => transitStops.has(tileId),
      // The intermodal edge: a bus stop and the platform beside it are one
      // interchange, joined by a short walk (D5). Without it a kerb and a
      // platform are separate islands however close they are drawn.
      walkLinks: walkLinksOf(level),
    });
    sim = createSimulation({
      level,
      depotColors,
      // Only init (unscheduled) trains exist at t=0; scheduled trains are added
      // mid-run by the spawner via injectTrain().
      trains: trainDefs.filter(def => !isScheduled(def)).map(trainInit),
      getSwitch: (coordId, entryPort) => switches[coordId]?.[entryPort],
      signalTiles,
      // Each station's demand is DERIVED from the ground within walking reach
      // (tiles/catchment.ts): a town nearby means faster arrivals and a fuller
      // platform; a lonely halt sees a trickle. The sim only executes the
      // schedule it is handed — it stays terrain-blind. Snapshotted at sim
      // creation, so a station built mid-run queues nobody until reset.
      //
      // Under the citizen layer the SPAWNER is off — the people on the platform
      // are actual citizens with homes, jobs and a stopwatch running, and a
      // second synthetic source would both double-count the crowd and let the
      // shadow queue drift out of step with the real one (design doc §10).
      //
      // But the entry is still supplied, because `max` is also what caps the
      // platform: without one, every station falls back to
      // STATION_QUEUE_HARD_CAP (16), which a morning peak in a town of forty
      // exceeds — and a commuter who cannot even JOIN the queue stands there
      // until they give up, which reads as a broken railway when the railway is
      // fine. An infinite interval spawns nobody (`advanceDemand`'s loop never
      // runs), so this is a cap and nothing else.
      // THE SHARED TRANSIT LAYER (sim/transit.ts). Made here, not inside the
      // sim, because the ROAD sim needs the same one: a bus is planned like a
      // train and a bus-then-train journey is ONE journey, so it must run
      // against one set of queues and one line registry (#90).
      transit,
      // Off for every mode but Tycoon — see ModeControls.dispatch. With it off
      // the sim builds trains in state "running" exactly as it always has.
      waitForDispatch: mode.controls.dispatch,
    });
    roadSim = createRoadSim({
      level,
      width: roadW,
      height: roadH,
      seed: colorSeed,
      // Directed lane model: every edge opening is a valid spawn point; the Lane[]
      // from/to fields handle one-way and turn restrictions so no external filter needed.
      spawnEntries: allRoadEntries,
      spawnInterval: 1.6, // a steady trickle so a small queue forms at a closed gate
      carSpeed: 0.5, // tiles/sec — slow enough to read on screen
      // Match the logical (car) body to the rendered sprite (.road-car is 38px wide
      // in PlayView/TestStage CSS). Trucks and semis scale their length from this in
      // the sim and size their sprite from it in the view, so the two stay in step.
      // If the model body is longer than the sprite, a queue looks gappy: the bumper
      // gap then sits on top of invisible extra body.
      carLength: CAR_SPRITE_PX / tileSize,
      maxCars: carCapOf,
      // Fill toward the density target quickly so dragging the slider up packs the
      // streets without waiting out a slow trickle — the rendered game wants this;
      // the unit-test sims leave it off for a deterministic per-interval cadence.
      fillFast: true,
      // Per-level overrides (busyness + vehicle mix), if the level supplied any.
      ...(traffic?.spawnInterval !== undefined && {
        spawnInterval: traffic.spawnInterval,
      }),
      // A level that contains bus lanes must carry buses in play — a bus line
      // drawn in the editor may never stay empty. PlayView always passes
      // DEFAULT_TRAFFIC (cars/trucks/semis, no bus), so merely defaulting when
      // no mix is given was not enough: when the supplied mix has NO bus entry
      // at all, add one (~20% of the total weight). An explicit bus weight —
      // including a deliberate bus: 0 — always wins untouched.
      ...(() => {
        const hasBusLanes = Object.values(level).some(t =>
          t.road?.some(l => l.kind === "bus"),
        );
        const mixIn = traffic?.mix;
        if (mixIn !== undefined) {
          if (!hasBusLanes || mixIn.bus !== undefined) return { mix: mixIn };
          const total = Object.values(mixIn).reduce((a, b) => a + (b ?? 0), 0);
          return { mix: { ...mixIn, bus: Math.max(1, total * 0.25) } };
        }
        return hasBusLanes ? { mix: { car: 1, bus: 0.3 } } : {};
      })(),
      ...(traffic?.overtakeFraction !== undefined && { overtakeFraction: traffic.overtakeFraction }),
      // A level may pin exact spawn entries (e.g. a divided road with each lane
      // one-way in opposite directions), overriding the default edge detection.
      ...(traffic?.spawnEntries !== undefined && {
        spawnEntries: traffic.spawnEntries,
      }),
    });
  }
  buildSims();
  const roadCars = reactive([]) as RoadCar[];
  // Road-junction tiles a car currently holds (tileId → car id), refreshed each
  // frame from the road sim. Cars have no stored reservation like trains, so this
  // is derived live; the renderer reads it to highlight a held junction in debug.
  const carJunctions = reactive({}) as Record<string, string>;
  const carDestinations = reactive({}) as Record<string, string>;
  // Parking, refreshed each frame in place (Vue notifies only on real changes).
  const parkingOccupancy = reactive({}) as Record<string, string>;
  const parkingStatus = reactive({}) as Record<string, ParkingSignState>;
  // Which tile of each car park draws its sign: the lowest-sorted tile that
  // actually carries bays. Computed once — the facilities are level data.
  const parkingSignTiles = new Map<string, string>();
  for (const [tileId, cell] of Object.entries(level).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const fid = facilityOf(cell, tileId);
    if (fid && !parkingSignTiles.has(fid)) parkingSignTiles.set(fid, tileId);
  }

  // --- the citizen layer -------------------------------------------------------
  //
  // Present only when the mode asked for it (`ModeSetup.citizens`), so every
  // existing mode and every /test scenario keeps the board it had. When it IS
  // present, the people standing on the platforms are the town's own residents
  // on their way to work, and the trains they are waiting for are yours.
  //
  // Built here rather than inside `buildSims()` for one reason: it must be
  // rebuilt on reset the same way the sims are, and it needs the level as it
  // stands then. `rebuildCitizens()` below is what reset() calls.
  let citizenSim: CitizenSim | null = null;
  let pedestrianSim: PedestrianSim | null = null;
  // Tiles a car body is on, refreshed each tick. Read by the pedestrian sim to
  // decide whether a zebra is clear to step onto.
  const carTiles = new Set<string>();
  // Tiles somebody has claimed a crossing on. Fed into the ROAD sim's `closed`
  // predicate — the identical mechanism a level crossing uses when a train is
  // coming, so cars brake, queue and resume with no new traffic rule at all.
  let pedestrianClaims: string[] = [];
  const pedestrians = reactive([]) as PedestrianDot[];
  const cities = reactive([]) as CityState[];
  const citizenStats = reactive({
    enabled: false,
    population: 0,
    travelling: 0,
    driving: 0,
    cycling: 0,
    onFoot: 0,
    carsParked: 0,
    carsAtHome: 0,
    tripsCompleted: 0,
    tripsRefused: 0,
    tripsAbandoned: 0,
    clock: "00:00",
    day: 0,
    modeShare: { walk: 0, car: 0, bike: 0, transit: 0, parkAndRide: 0, bikeAndRide: 0 },
    byStage: { child: 0, worker: 0, shiftWorker: 0, tradesperson: 0, retired: 0 },
  }) as CitizenHud;

  function rebuildCitizens() {
    if (!citizenSetup) {
      citizenSim = null;
      pedestrianSim = null;
      return;
    }
    pedestrians.splice(0, pedestrians.length);
    pedestrianClaims = [];
    carTiles.clear();
    // The people ON the pavements. Its own little sim, NOT part of the road
    // model: a pedestrian has no following distance, claims no junction and may
    // share a doorway, all of which road.ts exists to forbid.
    pedestrianSim = markRaw(
      createPedestrianSim({
        level,
        seed: citizenSetup.seed ?? colorSeed,
        // The same walking speed the citizen model scores journeys at, so the
        // person on screen and the person in the model arrive together.
        speed: citizenSetup.tuning?.walkSpeed,
        // Is a vehicle physically on this tile? A walker claims the zebra (see
        // the closed predicate in advance()) and then waits for whatever was
        // already on it to drive clear — which is what makes the wait finite.
        roadBusy: (tileId: string) => carTiles.has(tileId),
        // And the RAILWAY half of it. The very same predicate the road sim gets
        // for a level crossing — a train reserving or standing on the tile —
        // handed to the people on the pavement, so the booms that stop the cars
        // stop the pedestrians too. One-way, unlike the zebra: this reads the
        // railway and never writes to it, because a train does not wait.
        railBusy: (tileId: string) => !!(sim.reservedBy(tileId) || sim.occupiedBy(tileId)),
      })
    );
    citizenSim = markRaw(
      createCitizenSim({
        world: buildCitizenWorld(level, citizenSetup.seed ?? colorSeed),
        seed: citizenSetup.seed ?? colorSeed,
        tuning: citizenSetup.tuning,
        // The two things the citizen sim pushes back into the world: a person
        // who chose transit becomes a passenger at a real boarding point —
        // a platform or a bus kerb, under their own name and bound for where
        // THEY are going. Bound to the SHARED transit layer, not the rail sim
        // (#117 step 1): the queues, the line graph and the walk links span
        // rail and bus alike, so `connects` answers over the whole network and
        // whichever carrier calls says on its dwell events who it moved. One
        // ledger, not two.
        transit: {
          enqueue: (stationId, dest, tag) => transit.enqueue(stationId, dest, tag),
          connects: (from, to) => transit.serves(from, to),
        },
        // ...and a person who chose to drive becomes an actual car on the
        // actual street, subject to every queue, junction and level crossing on
        // the way. Their journey time is whatever the traffic gives them.
        driving: {
          // `kind` is which vehicle this citizen becomes out there — a cycling
          // citizen is a real bike in traffic, the way a driving one is a car.
          request: (fromTileId, toTileId, park, kind) =>
            roadSim.requestTrip(fromTileId, toTileId, kind ?? "car", {
              // The PRESENCE of the object is the ask. A commuter going to work
              // passes `{}` — park anywhere near the office; somebody going home
              // passes their address and a short radius, which is what opens
              // their own drive to them and closes everyone else's.
              park: !!park,
              permit: park?.permit,
              parkSearchTiles: park?.searchTiles,
            }),
          status: tripId => roadSim.tripStatus(tripId),
          parkedAt: tripId => roadSim.tripParkedAt(tripId),
          wantedSpace: tripId => roadSim.tripWantedSpace(tripId),
          resume: (tripId, toTileId, park) =>
            roadSim.releaseTrip(tripId, toTileId, {
              park: !!park,
              permit: park?.permit,
              parkSearchTiles: park?.searchTiles,
            }),
          abandon: tripId => roadSim.abandonTrip(tripId),
          release: tripId => roadSim.clearFinishedTrip(tripId),
        },
        // ...and a person who walks becomes an actual figure on the pavement.
        walking: {
          request: (from, to) => pedestrianSim?.request(from, to) ?? null,
          // The car's own trip names where its driver is standing. Resolving the
          // kerb HERE — rather than handing the citizen layer a bank to carry —
          // is what keeps bays and pavement sides on this side of the port.
          // `kerb.at` is the CAR: pass it, or the walker is placed at the middle
          // of the road tile and the driver materialises in the traffic.
          requestFromKerb: (carTripId, toPlot) => {
            const kerb = roadSim.tripParkedKerb(carTripId);
            if (!kerb) return null;
            return (
              pedestrianSim?.requestFromKerb(kerb.tileId, kerb.bank, toPlot, kerb.at) ?? null
            );
          },
          status: id => pedestrianSim?.status(id) ?? "arrived",
          release: id => pedestrianSim?.release(id),
        },
      })
    );
    citizenStats.enabled = true;
    refreshCitizens();
  }

  function refreshCitizens() {
    if (!citizenSim) return;
    const next = citizenSim.cities();
    cities.splice(0, cities.length, ...next);
    const s = citizenSim.stats();
    citizenStats.population = s.population;
    citizenStats.travelling = s.travelling;
    citizenStats.driving = s.driving;
    citizenStats.cycling = s.cycling;
    citizenStats.onFoot = s.onFoot;
    citizenStats.carsParked = s.carsParked;
    citizenStats.carsAtHome = s.carsAtHome;
    citizenStats.tripsCompleted = s.tripsCompleted;
    citizenStats.tripsRefused = s.tripsRefused;
    citizenStats.tripsAbandoned = s.tripsAbandoned;
    citizenStats.clock = s.clock;
    citizenStats.day = s.day;
    citizenStats.modeShare = s.modeShare;
    citizenStats.byStage = s.byStage;
  }

  // --- the inspector ----------------------------------------------------------

  // Journey lengths, on the same clock the times of day use. Bound to this
  // game's day length so a caller never has to know it.
  function durationLabel(sec: number): string {
    return inGameDuration(sec, citizenSetup?.tuning?.secPerDay ?? DEFAULT_TUNING.secPerDay);
  }

  function clockOf(hour: number): string {
    const h = Math.floor(hour) % 24;
    const m = Math.floor((hour - Math.floor(hour)) * 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // A name, so a row reads as a person and not as a row. Deterministic from the
  // id — no RNG, because two calls a frame apart must not rename anybody.
  const FIRST_NAMES = [
    "Anna", "Bruno", "Clara", "Dario", "Elin", "Felix", "Greta", "Hugo",
    "Ida", "Jonas", "Kata", "Liam", "Mira", "Noah", "Olga", "Piet",
    "Rosa", "Samu", "Tilda", "Uwe", "Vera", "Wim", "Yara", "Zeno",
  ];
  function nameOf(id: string): string {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    return FIRST_NAMES[(h >>> 0) % FIRST_NAMES.length];
  }

  // Where a trip is HEADING, in the words the panel uses for it. One record, so
  // "walking to school" and "driving to school" cannot drift apart.
  const DESTINATION_TEXT: Record<TripPurpose, string> = {
    home: "home",
    work: "to work",
    shop: "to the shops",
    school: "to school",
    leisure: "to the café",
    callout: "out to a job",
  };

  function doingOf(c: Citizen): string {
    if (!c.trip) {
      if (c.at === c.home) return "at home";
      if (c.work && c.at === c.work) return "at work";
      return "out";
    }
    const dest = DESTINATION_TEXT[c.trip.purpose] ?? "out";
    // On a transit trip the first timed leg is the APPROACH to the platform, not
    // the journey. Calling it "walking to work" while the chosen mode is the
    // train reads as the panel contradicting itself.
    const rail = c.trip.mode === "transit" || c.trip.mode === "parkAndRide";
    switch (c.trip.leg) {
      case "walking":
        return rail ? "walking to the station" : `walking ${dest}`;
      case "driving":
        return rail ? "driving to the station" : `driving ${dest}`;
      case "waiting":
        return "waiting on the platform";
      case "riding":
        return "on the train";
      case "egress":
        return `walking ${dest} from the station`;
      default:
        return `travelling ${dest}`;
    }
  }

  // What each stage is, in two or three words. The panel says who somebody is
  // before it says where they are going, because the routine below only makes
  // sense once you know which life it belongs to.
  const STAGE_LABEL: Record<LifeStage, string> = {
    child: "School child",
    worker: "Day job",
    shiftWorker: "Shift work",
    tradesperson: "Trade, on the road",
    retired: "Retired",
  };

  // One routine entry, in words. Phrased from the person's side ("sets off for
  // school") rather than the model's ("activity: school"), and it reads the
  // ACTUAL routine — so a stage whose day is retuned needs nothing changed here.
  const ACTIVITY_TEXT: Record<TripPurpose, string> = {
    home: "heads home",
    work: "leaves for work",
    shop: "runs an errand",
    school: "sets off for school",
    leisure: "goes to the café",
    callout: "drives out to a job",
  };

  function scheduleOf(c: Citizen): ScheduleLine[] {
    return c.routine.map(a => ({
      at: clockOf(a.hour),
      // A trip to work that does NOT start at home is a tradesperson coming back
      // between call-outs. "Leaves for work" at half eleven and again at four
      // reads as a person with three jobs; what they are doing is returning to
      // the yard, and the routine already says so — the activity has no `from`.
      what:
        a.target === "work" && a.from !== "home"
          ? "back to the yard"
          : (ACTIVITY_TEXT[a.target] ?? "goes out"),
      daily: a.everyNDays <= 1,
    }));
  }

  function personCard(c: Citizen): PersonCard {
    const now = citizenSim?.now() ?? 0;
    return {
      id: c.id,
      name: nameOf(c.id),
      home: c.home,
      work: c.work,
      mood: c.mood,
      carOwner: c.profile.carOwner,
      stage: c.stage,
      stageLabel: STAGE_LABEL[c.stage],
      schedule: scheduleOf(c),
      at: c.at,
      doing: doingOf(c),
      travellingTo: c.trip?.to ?? null,
      mode: c.trip?.mode ?? null,
      elapsedSec: c.trip ? now - c.trip.startedAt : null,
      expectedSec: c.trip ? c.trip.expectedSec : null,
      unhappyDays: c.unhappyDays,
      recent: c.recent.map(noteOf),
    };
  }

  const PURPOSE_TEXT: Record<TripPurpose, string> = {
    work: "The trip to work",
    home: "The trip home",
    shop: "The errand",
    school: "The school run",
    leisure: "The trip to the café",
    callout: "The call-out",
  };

  // One remembered journey, in words. The two numbers ARE the verdict — how
  // long it took against how long they thought it should — so the sentence
  // leads with them rather than with an adjective.
  function noteOf(o: TripOutcome): TripNote {
    const what = PURPOSE_TEXT[o.purpose] ?? "A trip";
    if (o.failed === "refused")
      return { text: `${what} was impossible — no way to make it at all.`, delta: o.delta, good: false };
    if (o.failed === "abandoned")
      return { text: `${what} was given up on after ${durationLabel(o.actualSec)}.`, delta: o.delta, good: false };
    const over = o.actualSec / Math.max(o.expectedSec, 0.001);
    const verdict =
      over > 1.6 ? "far longer than they expected" : over > 1.05 ? "longer than they expected" : "about as expected";
    return {
      text: `${what} took ${durationLabel(o.actualSec)} — ${verdict} (${durationLabel(o.expectedSec)}).`,
      delta: o.delta,
      good: o.delta >= 0,
    };
  }

  // Everyone who lives or works on a plot. The panel's way in from the board:
  // click a house, see the household.
  function inspectPlot(plotId: string): PlotCard | null {
    if (!citizenSim) return null;
    const plot = citizenSim.plots().find(p => p.id === plotId);
    if (!plot) return null;
    return {
      id: plot.id,
      city: plot.city,
      kind: plot.kind,
      density: plot.density,
      people: plot.people,
      capacity: plot.capacity,
      residents: citizenSim.citizensOf(plotId).map(personCard),
    };
  }

  function inspectPerson(id: string): PersonCard | null {
    const c = citizenSim?.citizen(id);
    return c ? personCard(c) : null;
  }

  // The comparison table: what each way of making this journey would take.
  // Defaults to their commute; while they are actually travelling it prices the
  // journey they are ON, so the panel answers "and what else could they have
  // done?" about the trip in front of you.
  function compareModes(id: string): ModeCompare[] {
    const c = citizenSim?.citizen(id);
    if (!c || !citizenSim) return [];
    const quotes = c.trip
      ? citizenSim.quoteFor(id, c.trip.from, c.trip.to)
      : citizenSim.quoteFor(id);
    return (quotes ?? []).map(q => ({
      mode: q.mode,
      seconds: q.unavailable ? null : q.estimateSec,
      label: q.unavailable ? "—" : durationLabel(q.estimateSec),
      // The raw board seconds, for a tooltip: the town's clock is the honest
      // unit to read, and this is the one you can check with a stopwatch.
      boardLabel: q.unavailable ? "—" : boardDuration(q.estimateSec),
      perceivedSeconds: q.unavailable ? null : q.cost,
      chosen: q.chosen,
      why: q.unavailable ? (REFUSAL_TEXT[q.unavailable] ?? q.unavailable) : null,
    }));
  }

  // WHERE IS THIS PERSON? One answer per leg, every one of them sampled from a
  // simulation rather than read off the render mirror — a pin built from
  // `roadCars` would be a frame late and empty in a headless test.
  //
  // A person is only ever in one of five places, and the pin says which:
  //  · on foot     — the walker's live position on the pavement
  //  · in a car    — the car's live position (the trip id IS the car id, see
  //                  road.ts `trips.set(id, "driving")`, so this is a lookup)
  //  · on a train  — the loco of the train they boarded
  //  · on a platform / indoors — the middle of the tile they are standing in,
  //    which is as precise as the model gets and precise enough to point at.
  function locatePerson(id: string): PersonFix | null {
    const c = citizenSim?.citizen(id);
    if (!c) return null;
    const centreOf = (tileId: string) => {
      const { x, y } = parseCoordId(tileId);
      return { x: (x + 0.5) * tileSize, y: (y + 0.5) * tileSize };
    };
    const trip = c.trip;

    if (trip?.walkTrip) {
      const w = pedestrianSim?.sample().find(sample => sample.id === trip.walkTrip);
      if (w) return { id, x: w.x * tileSize, y: w.y * tileSize, on: "foot" };
    }
    if (trip?.carTrip) {
      for (const car of roadSim.sample()) {
        if (car.id !== trip.carTrip) continue;
        const unit = car.units[0];
        if (!unit) break;
        const cls: VehicleClass =
          unit.part === "bus" ? "bus" : unit.part === "bike" ? "bike" : "car";
        const p = positionRoadUnit(
          unit,
          unit.front.pose ? ZERO_LANE_OFFSET : couplerOffsets(unit.front, car.laneIndex, cls),
          unit.rear.pose ? ZERO_LANE_OFFSET : couplerOffsets(unit.rear, car.laneIndex, cls)
        );
        return { id, x: p.x, y: p.y, on: "car" };
      }
    }
    if (trip?.trainId && sim.trains[trip.trainId]) {
      const units = sim.sampleTrain(trip.trainId);
      if (units.length) {
        // The one sampler here that is NOT pure: rail geometry is measured off
        // an SVG path (`getPointAtLength`), so the exact loco position needs a
        // document. In the browser that is always true and the pin rides the
        // engine. Headless, fall back to the tile the loco is on — coarser by
        // half a tile, still tracks the train across the map, and testable.
        if (typeof document !== "undefined") {
          const { x, y } = positionUnit(units[0]);
          return { id, x, y, on: "train" };
        }
        const { x: cx, y: cy } = units[0].front.coord;
        return {
          id,
          x: (cx + 0.5) * tileSize,
          y: (cy + 0.5) * tileSize,
          on: "train",
        };
      }
    }
    if (trip?.leg === "waiting" && trip.station)
      return { id, ...centreOf(trip.station), on: "platform" };
    // Not moving, or on a leg with no body on the board yet: they are at an
    // address. `at` stays their home while they travel home, which is exactly
    // where the pin belongs for somebody who has not set off.
    return { id, ...centreOf(c.at), on: "indoors" };
  }

  // The person behind a figure on the pavement — so clicking a dot on the board
  // opens their day. `walkTrip` is the pedestrian sim's own id, which is what
  // `PedestrianDot.id` carries, so this is a lookup and not a guess.
  function personWalking(walkerId: string): string | null {
    for (const c of citizenSim?.citizens() ?? [])
      if (c.trip?.walkTrip === walkerId) return c.id;
    return null;
  }

  // ...and the person behind a car. Same contract via `carTrip`.
  function personDriving(carTripId: string): string | null {
    for (const c of citizenSim?.citizens() ?? [])
      if (c.trip?.carTrip === carTripId) return c.id;
    return null;
  }

  // Sampled in `advance()` rather than in the render mirror, for the same
  // reason the park & ride transfer is: a headless test must be able to see
  // where people are.
  function updatePedestrians() {
    const next = pedestrianSim?.sample() ?? [];
    pedestrians.length = next.length;
    for (let i = 0; i < next.length; i++) {
      const w: WalkerSample = next[i];
      const cur = pedestrians[i];
      const x = w.x * tileSize;
      const y = w.y * tileSize;
      if (cur && cur.id === w.id && cur.x === x && cur.y === y && cur.waiting === w.waiting)
        continue;
      pedestrians[i] = { id: w.id, x, y, waiting: w.waiting };
    }
  }

  rebuildCitizens();

  // Park & ride: the station (if any) within walking reach of each tile,
  // computed once — stations and stalls are both level data. When a stall goes
  // from free to taken, the car's occupant walks to that station and joins the
  // platform queue (the sim caps the platform; an overfull one just turns the
  // walker away).
  const prTargets = parkAndRideTargets(level);

  // How many people walk to the platform when a vehicle stops here: a busload
  // from a bus stop (an in-lane halt or a bus-reserved lay-by — only buses can
  // take either), one driver from any ordinary bay.
  const BUS_STOP_TRANSFER = 4;
  function transferSizeOf(stallKey: string): number {
    const [tileId, fromStr, side, indexStr] = stallKey.split("|");
    const row = rowFor(level[tileId], {
      tileId,
      from: Number(fromStr) as Port,
      side: side as "right" | "left",
      index: Number(indexStr),
    });
    if (!row) return 1;
    return row.kind === "busstop" || row.reserved === "bus"
      ? BUS_STOP_TRANSFER
      : 1;
  }

  // The transfer itself runs in advance() (the headless world step), NOT in the
  // render mirror below — model logic in an animation callback is the exact
  // trap the sim/renderer split exists to avoid, and it would be invisible to
  // headless tests. Stall ids lead with their tile id (tiles/parking.ts
  // stallId: `${tileId}|…`), which locates both the station in reach and the
  // row that says who got out.
  let prevStalls = new Set<string>();
  function transferParkedArrivals() {
    const cur = new Set(Object.keys(roadSim.parkingOccupancy()));
    for (const id of cur) {
      if (!prevStalls.has(id)) {
        const station = prTargets[id.split("|")[0]];
        if (station) sim.addStationPassengers(station, transferSizeOf(id));
      }
    }
    prevStalls = cur;
  }

  // --- BUS SERVICES (#90) ------------------------------------------------
  //
  // A bus is planned exactly like a train: you draw a LINE, you buy a bus, you
  // assign it. What differs is only how it gets from one stop to the next —
  // rails and interlocking there, lanes and junctions here — so the movement is
  // the road sim's (`requestTrip` / `retarget`, which plan a real route through
  // real traffic) and the passengers are the shared transit layer's, the same
  // one the trains use.
  //
  // This runs in `advance()`, the headless world step. Not the render frame:
  // model logic in an animation callback is invisible to a hidden tab and to
  // every test.
  const BUS_SEATS = 12;
  const BUS_DWELL_SEC = 4;
  // How long a bus may fail to get back on the road before the log says so. A
  // busy street clears in a tick or two; a stop it can never be driven to does
  // not, and that is the one worth a line.
  const STRANDED_REPORT_SEC = 10;

  interface BusService {
    id: string;
    lineId?: string;
    // Which stop of its line it is heading for.
    stopIndex: number;
    // The road sim's id for the vehicle, while one is on the board.
    carId?: string;
    // Seconds of dwell left at the stop it is standing at.
    dwellLeft: number;
    manifest: Rider[];
    // The last stop it worked. Where its riders are set down if it is withdrawn:
    // a bus that leaves the board must not take its passengers with it.
    lastStopId?: string;
    // Doors closed, waiting to pull away. The dwell is OVER — so the exchange
    // must not run again — but the road sim has not accepted the onward leg yet.
    departing?: boolean;
    // The stop it has failed to plan a route to, so the failure is reported once
    // rather than every tick it retries, and how long the failure has lasted —
    // a busy street clears in a tick or two, an unreachable stop never does.
    strandedFor?: string;
    strandedSec?: number;
    // The stop it has just turned round at. It worked that stop before the
    // turn, so the respawn there must not work it again.
    turnedRoundAt?: string;
  }
  const buses: BusService[] = [];
  let busSeq = 0;
  // The panel's copy. The sim objects are markRaw-adjacent plain state, so a
  // getter reading `buses` directly would never re-run — the same trap that
  // froze the train panel's next-stop pip. Refreshed per world step.
  const busServices = reactive([]) as BusView[];

  function syncBuses(): void {
    busServices.splice(0, busServices.length);
    for (const b of buses) {
      busServices.push({
        id: b.id,
        ...(b.lineId ? { lineId: b.lineId } : {}),
        passengers: b.manifest.length,
        seats: BUS_SEATS,
        ...(b.carId ? { carId: b.carId } : {}),
        ...(b.carId ? { tileId: roadSim.carTile(b.carId) } : {}),
      });
    }
  }

  // HOW FULL EVERY VEHICLE IS, trains and buses in one book, keyed by the id the
  // BOARD draws it under — a train's own id, a bus's road-car id. The load bar
  // rides the vehicle, so the renderer needs to look up by what it is holding.
  //
  // Refreshed from the world step rather than the render frame: a hidden tab
  // must not freeze it, and a headless test has to be able to read it (KNOWHOW →
  // the hidden-tab trap).
  function updateVehicleLoads(): void {
    const seen = new Set<string>();
    const put = (id: string, aboard: number, seats: number, colour: string) => {
      seen.add(id);
      const cur = vehicleLoads[id];
      if (!cur || cur.aboard !== aboard || cur.seats !== seats || cur.colour !== colour) {
        vehicleLoads[id] = { aboard, seats, colour };
      }
    };
    const colourOfLine = (lineId: string | undefined) =>
      (lineId && lines.find(l => l.id === lineId)?.colour) || "";
    for (const id of Object.keys(sim.trains)) {
      const seats = sim.trainCapacity(id);
      // A freight train has no seats and gets no bar: an empty gauge on
      // something that was never going to carry anybody is noise.
      if (seats <= 0) continue;
      put(id, sim.trainPassengers(id), seats, colourOfLine(sim.lineOf(id)));
    }
    for (const b of buses) {
      if (!b.carId) continue;
      put(b.carId, b.manifest.length, BUS_SEATS, colourOfLine(b.lineId));
    }
    for (const id of Object.keys(vehicleLoads)) {
      if (!seen.has(id)) delete vehicleLoads[id];
    }
  }

  function busStopsOf(bus: BusService): string[] {
    return (bus.lineId ? transit.stopsOfLine(bus.lineId) : undefined) ?? [];
  }

  function advanceBuses(dt: number): void {
    for (const bus of buses) {
      const stops = busStopsOf(bus);
      // An unassigned bus is not a service: it sits out of the way rather than
      // wandering, because a bus with no line has nowhere to be.
      if (stops.length < 2) {
        if (bus.carId) {
          roadSim.despawn(bus.carId);
          bus.carId = undefined;
        }
        continue;
      }
      // Not on the board yet: it starts at the line's first stop and sets off
      // for the second. `requestTrip` spawns it there, so no separate garage
      // machinery is needed — the line IS where a bus lives.
      if (!bus.carId || !roadSim.hasCar(bus.carId)) {
        const from = stops[bus.stopIndex % stops.length];
        const to = stops[(bus.stopIndex + 1) % stops.length];
        const id = roadSim.requestTrip(from, to, "bus", { service: true });
        if (!id) {
          // Usually the street is simply busy and the next tick does it, which
          // is why this is not reported at once. But a stop the line can NEVER
          // be driven to (a road edited away under it, a line redrawn through
          // somewhere with no road at all) fails here for ever, and a bus
          // silently off the board with people aboard is not something to leave
          // the player guessing at. Reported once it has lasted long enough to
          // mean something, and once per stranded stop — the retry runs every
          // tick, and a line in the log every tick is noise, not a report.
          bus.strandedSec = (bus.strandedSec ?? 0) + dt;
          if (bus.strandedSec > STRANDED_REPORT_SEC && bus.strandedFor !== to) {
            bus.strandedFor = to;
            logBusHold(bus, to, from);
          }
          continue;
        }
        bus.carId = id;
        bus.strandedFor = undefined;
        bus.strandedSec = 0;
        bus.departing = false;
        // It is standing at the first stop with its doors open, so it works it
        // before pulling away. Without this the origin stop is served only on
        // the second lap — and on a two-stop line that is every other call.
        // Unless it has just TURNED ROUND here: it worked this stop a moment
        // ago, and a second exchange would board the same queue twice.
        if (bus.turnedRoundAt !== from) callAt(bus, from);
        bus.turnedRoundAt = undefined;
        bus.stopIndex = (bus.stopIndex + 1) % stops.length;
        continue;
      }
      if (roadSim.tripStatus(bus.carId) !== "arrived") {
        bus.departing = false;
        continue;
      }

      // Standing at a stop. Dwell first — the doors take time and a crowded
      // kerb takes longer, exactly as a platform does.
      if (!bus.departing) {
        if (bus.dwellLeft <= 0) {
          const at = roadSim.carTile(bus.carId);
          if (!at) continue;
          const r = callAt(bus, at);
          bus.dwellLeft = BUS_DWELL_SEC + r.boarded * 0.4;
          continue;
        }
        bus.dwellLeft -= dt;
        if (bus.dwellLeft > 0) continue;
        // Doors closed. From here on it is LEAVING, whatever the road says — so
        // a failed departure retries the route and never re-opens the doors.
        bus.departing = true;
      }

      // On to the next stop. The cursor steps forward only when the bus is
      // standing AT the stop it was bound for — the same in-order rule a train
      // follows. NEVER recompute it from `indexOf`: a line may name the same
      // stop twice (A→C→B→C), and the first occurrence would swallow the
      // second. Still idempotent for the retry below: once advanced, the kerb
      // under the bus no longer matches the new target (the transit layer
      // normalises doubled calls away), so a failed departure cannot advance
      // it again.
      const at = roadSim.carTile(bus.carId);
      const arrivedAtTarget = !!at && at === stops[bus.stopIndex % stops.length];
      if (arrivedAtTarget) {
        bus.stopIndex = (bus.stopIndex + 1) % stops.length;
      }
      const next = stops[bus.stopIndex % stops.length];
      // `retarget` REFUSES rather than teleporting the bus, and that answer has
      // to be acted on: the trip stays "arrived" with the dwell run out, so a
      // bus that ignored it re-ran the exchange at the same kerb every
      // BUS_DWELL_SEC — boarding the queue again, logging a call that never
      // happened.
      if (roadSim.retarget(bus.carId, next)) {
        bus.strandedFor = undefined;
        bus.departing = false;
        continue;
      }

      // NO WAY ONWARD FROM THE LANE IT IS STANDING IN — a terminus. The router
      // plans lane by lane and there is no U-turn, so a line that ends in a
      // dead end leaves the bus facing a wall.
      //
      // It TURNS ROUND AT THE STOP: taken off the board here and put back on
      // here, facing whichever way the next leg needs. What it must not do is
      // what it used to: keep driving with a stale plan, off the end of the
      // map, to be re-spawned at the FAR stop — the bus appeared to sit at the
      // halt for ever and then teleport across the board. Reported as "buses
      // move super slowly at a bus station", which is what a vanishing act
      // looks like from the outside.
      //
      // The stop cursor goes back to the stop it is standing at, so the respawn
      // above starts THIS leg rather than skipping to the next one — and the
      // respawn is told the stop has just been WORKED, or turning round would
      // open the doors a second time at a kerb the bus never left.
      roadSim.despawn(bus.carId);
      bus.carId = undefined;
      // Step the cursor BACK to the stop it is standing at (undoing the
      // advance above), never via `indexOf` — with a stop named twice on the
      // line, indexOf finds the first occurrence and the second leg vanishes.
      if (arrivedAtTarget) {
        bus.stopIndex = (bus.stopIndex - 1 + stops.length) % stops.length;
      }
      bus.turnedRoundAt = at;
    }
  }

  // The bus works a stop: everyone off who wanted here, everyone on who this
  // line can help. `lastStopId` is remembered because a withdrawn bus has to set
  // its riders down SOMEWHERE, and this is the last place it stood.
  function callAt(bus: BusService, stopId: string) {
    const r = transit.exchange({
      stopId,
      lineId: bus.lineId,
      capacity: BUS_SEATS,
      manifest: bus.manifest,
    });
    bus.lastStopId = stopId;
    busEvents.push({ busId: bus.id, stopId, ...r });
    return r;
  }

  // Set a withdrawn bus's riders down instead of deleting them, exactly as a
  // RETIRING train does (`dumpAll` in simulation.ts): they are better off at a
  // stop than in a shed, and passengers who simply vanish are a loss the player
  // never sees and the delivery count never explains.
  //
  // Also on a REASSIGNMENT: a rider's `off` was decided from the line the bus
  // was running (D7), so a bus that changes line would carry them to a stop it
  // no longer calls at — for ever.
  function setDownAll(bus: BusService): void {
    if (bus.manifest.length === 0) return;
    const at = stopUnder(bus) ?? bus.lastStopId;
    if (!at) return; // it has never called anywhere, so nobody is aboard
    const r = transit.exchange({
      stopId: at,
      lineId: bus.lineId,
      capacity: BUS_SEATS,
      manifest: bus.manifest,
      dumpAll: true,
    });
    busEvents.push({ busId: bus.id, stopId: at, ...r });
  }

  // The stop the bus is standing at, if it is standing at one at all.
  function stopUnder(bus: BusService): string | undefined {
    if (!bus.carId || !roadSim.hasCar(bus.carId)) return undefined;
    const at = roadSim.carTile(bus.carId);
    return at && busStopsOf(bus).includes(at) ? at : undefined;
  }

  // A stop the line can no longer reach, said ONCE per hold: the retry runs
  // every tick and a line in the log every tick is noise, not a report.
  function logBusHold(bus: BusService, to: string, at: string | undefined): void {
    const where = at ? ` at ${stationLabels[at] ?? at}` : "";
    eventLog.push({
      id: logSeq++,
      time: clock,
      kind: "blocked",
      trainId: bus.id,
      text: `held${where} — no route to ${stationLabels[to] ?? to}`,
    });
  }

  // Order a bus. Like a train it is bought INTO service — with a line it
  // starts running it at once, without one it waits to be assigned. There is no
  // garage to queue in: a bus lives on its line, and appears at its first stop.
  function buyBus(lineId?: string): string {
    busSeq += 1;
    const id = `bus${busSeq}`;
    buses.push({ id, lineId, stopIndex: 0, dwellLeft: 0, manifest: [] });
    syncLines();
    syncBuses();
    return id;
  }

  function assignBus(busId: string, lineId: string | null): boolean {
    const bus = buses.find(b => b.id === busId);
    if (!bus) return false;
    if (lineId !== null && !transit.lines().some(l => l.id === lineId)) return false;
    const had = bus.lineId;
    // Everyone off first, while it is still on the line they boarded for and
    // still standing where they can be set down.
    if (had !== (lineId ?? undefined)) setDownAll(bus);
    bus.lineId = lineId ?? undefined;
    bus.stopIndex = 0;
    bus.departing = false;
    bus.strandedFor = undefined;
    // It re-plans from wherever it is on its next tick; taking it off a line
    // takes it off the road, because a bus with no line has nowhere to be.
    if (bus.carId && !bus.lineId) {
      roadSim.despawn(bus.carId);
      bus.carId = undefined;
    }
    transit.touch();
    if (had && had !== bus.lineId) pruneLineIfUnused(had);
    syncLines();
    syncBuses();
    return true;
  }

  // Scrap a bus. There is no orderly "run to the depot" verb yet — a bus has no
  // shed to run to — so this is the only one, and it is not the emergency the
  // train's `scrapTrain` is.
  function removeBus(busId: string): boolean {
    const at = buses.findIndex(b => b.id === busId);
    if (at < 0) return false;
    const bus = buses[at];
    // Its riders get off at the kerb rather than disappearing with the vehicle.
    setDownAll(bus);
    if (bus.carId) roadSim.despawn(bus.carId);
    buses.splice(at, 1);
    if (bus.lineId) pruneLineIfUnused(bus.lineId);
    syncLines();
    syncBuses();
    return true;
  }

  // A line is only swept when NOTHING runs it — and "nothing" now has to count
  // buses as well as trains, or withdrawing the last train would delete a line
  // a bus is still working.
  function pruneLineIfUnused(lineId: string): void {
    if (sim.trainsOnLine(lineId).length > 0) return;
    if (buses.some(b => b.lineId === lineId)) return;
    transit.pruneLine(lineId);
  }

  // What the buses did this tick, so the log and the citizen layer see a bus
  // call exactly as they see a train's dwell. `busId` is load-bearing: the
  // citizen mirror keeps who-is-aboard per VEHICLE id and never asks what
  // species the vehicle is, so a call without one could strand its riders.
  const busEvents: { busId: string; stopId: string; boarded: number; alighted: number; changing: number; boardedTags: string[]; alightedTags: string[] }[] = [];

  // This tick's bus calls, in the dwell-event shape the citizen sim already
  // mirrors (`trainId` = the bus id). One event language for every carrier —
  // the citizen layer learns nothing new to learn the buses.
  function busDwells(): SimEvent[] {
    return busEvents.map(e => ({
      type: "dwell" as const,
      trainId: e.busId,
      tileId: e.stopId,
      boarded: e.boarded,
      alighted: e.alighted,
      changing: e.changing,
      boardedTags: e.boardedTags,
      alightedTags: e.alightedTags,
    }));
  }

  function updateParking() {
    const held = roadSim.parkingOccupancy();
    for (const id of Object.keys(held)) parkingOccupancy[id] = held[id];
    for (const id of Object.keys(parkingOccupancy)) {
      if (!(id in held)) delete parkingOccupancy[id];
    }
    for (const s of roadSim.parkingStatus()) {
      const signTileId = parkingSignTiles.get(s.id);
      if (!signTileId) continue;
      const cur = parkingStatus[s.id];
      if (cur && cur.free === s.free && cur.capacity === s.capacity && cur.label === s.label)
        continue;
      parkingStatus[s.id] = {
        signTileId,
        label: s.label,
        capacity: s.capacity,
        free: s.free,
      };
    }
  }
  // Street-junction traffic signals (#38). The road junction tile ids (computed
  // once), and the reactive per-arm aspect + live-signal maps the renderer reads.
  const roadJunctionTiles = Object.entries(level)
    .filter(([, tile]) => isRoadJunction(tile.road))
    .map(([id, tile]) => ({ id, arms: roadPortsOf(tile.road) }));
  const roadSignalAspects = reactive({}) as Record<
    string,
    "green" | "amber" | "red"
  >;
  const roadSignals = reactive({}) as Record<string, JunctionSignal>;

  // Refresh the road-signal aspects + live signals from the road sim each frame
  // (in place, so Vue only notifies on real changes).
  function updateRoadSignals() {
    for (const { id, arms } of roadJunctionTiles) {
      const sig = roadSim.signalOf(id);
      if (sig && sig.mode !== "off") roadSignals[id] = sig;
      else if (id in roadSignals) delete roadSignals[id];
      for (const arm of arms) {
        const key = `${id}:${arm}`;
        const aspect = roadSim.signalAspect(id, arm);
        if (aspect) roadSignalAspects[key] = aspect;
        else if (key in roadSignalAspects) delete roadSignalAspects[key];
        // The separate transit signal: during a bus HEAD START this is green
        // while the car aspect is still red. Rendered as a small bus lens.
        const busKey = `${key}:bus`;
        const busAspect = roadSim.signalAspect(id, arm, "bus");
        if (busAspect) roadSignalAspects[busKey] = busAspect;
        else if (busKey in roadSignalAspects) delete roadSignalAspects[busKey];
      }
    }
  }
  // Debug route overlay: which car's route to draw. `pinned` (a click) wins over
  // `hovered`; the per-frame updateRoadCars resolves the active id to `carRoute`.
  let hoveredCarId: string | null = null;
  let pinnedCarId: string | null = null;
  const carRoute = ref<CarRoute | null>(null);

  const unitIds: Record<string, string[]> = {};
  for (const def of trainDefs) unitIds[def.id] = [def.id, ...def.wagonIds];

  // A detached, hidden <svg> used purely to sample points along segment paths.
  let sampler: SVGSVGElement | null = null;
  const pathCache = new Map<string, SVGPathElement>();
  function pathFor(d: string): SVGPathElement {
    let p = pathCache.get(d);
    if (!p) {
      if (!sampler) {
        sampler = document.createElementNS(SVG_NS, "svg");
        sampler.setAttribute("width", "0");
        sampler.setAttribute("height", "0");
        sampler.style.position = "absolute";
        sampler.style.visibility = "hidden";
        document.body.appendChild(sampler);
      }
      p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      sampler.appendChild(p);
      pathCache.set(d, p);
    }
    return p;
  }

  // World point + path tangent for a single sampled TRAIN coupler point.
  // `offsetRight` (px) shifts the point perpendicular to its direction of travel,
  // toward the right-hand side; trains pass 0 and stay on the rail centreline.
  // (Road cars use sampleRoadWorld below — the shared lane path, not the rail quad.)
  function sampleWorld(s: SampledUnit, offsetRight = 0) {
    const exit = s.exitPort ?? s.entryPort;
    const path = pathFor(segmentPathD(s.entryPort, exit, tileSize));
    const len = path.getTotalLength();
    const here = s.t * len;
    const at = path.getPointAtLength(here);
    const ahead = path.getPointAtLength(Math.min(len, here + 1));
    let dx = ahead.x - at.x;
    let dy = ahead.y - at.y;
    if (dx === 0 && dy === 0) {
      // At the very end of a path the look-ahead point coincides with `at`, so
      // the heading would degenerate to 0° (facing east) — this is what made a
      // loco parked at a depot's dead-end centre appear to turn and look out.
      // Derive the heading from the point just behind instead.
      const behind = path.getPointAtLength(Math.max(0, here - 1));
      dx = at.x - behind.x;
      dy = at.y - behind.y;
    }
    let px = at.x;
    let py = at.y;
    if (offsetRight) {
      // Right-of-travel unit vector. In screen space (y down) the right hand of a
      // heading (dx,dy) is (-dy, dx): east→south, north→east, etc.
      const mag = Math.hypot(dx, dy) || 1;
      px += (-dy / mag) * offsetRight;
      py += (dx / mag) * offsetRight;
    }
    return {
      x: s.coord.x * tileSize + px,
      y: s.coord.y * tileSize + py,
      tangent: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  }

  // Draw a car as the chord between its two coupler points: centre at their
  // midpoint, angle along the chord. This keeps rigid sprites sitting correctly
  // on curves (the body leans into the curve) instead of overlapping. When the
  // chord collapses (a unit bunched at a depot exit before the train extends),
  // fall back to the front point's tangent to avoid an atan2(0,0) flip.
  function positionUnit(body: UnitChord, offsetFront = 0, offsetRear = offsetFront) {
    const f = sampleWorld(body.front, offsetFront);
    const r = sampleWorld(body.rear, offsetRear);
    const dx = f.x - r.x;
    const dy = f.y - r.y;
    const chord = Math.hypot(dx, dy);
    const angle = chord > 0.5 ? (Math.atan2(dy, dx) * 180) / Math.PI : f.tangent;
    return { x: (f.x + r.x) / 2, y: (f.y + r.y) / 2, angle };
  }

  // World point + travel heading for one ROAD coupler: the shared lane path
  // (sim/pathGeometry.ts laneSegmentPointAt — straights, seam tapers and the
  // corner-fillet turns, all one geometry), placed in world coordinates. This
  // replaces the old centreline DOM sample + pre-lerped sideways push, so a car
  // drives EXACTLY the curve the debug overlay and the painted turn guides draw
  // — including the tangent-continuous fillet through a turn between arms of
  // different widths. A dead-end (no exit) holds the entry seam point.
  function sampleRoadWorld(s: CarSample, off: { offEntry: number; offExit: number }) {
    // A PARKED or MANOEUVRING vehicle carries an absolute tile-local pose instead
    // of a place on a lane. The lane model can express exactly one shape — a
    // port-to-port path pushed sideways — which is every position a driving car
    // can hold and nothing else; a car standing square in a 90° bay simply is not
    // in its vocabulary. The pose arrives in TILE units (the sim builds its lane
    // geometry at size 1, the renderer at `tileSize`), so it scales here.
    if (s.pose) {
      return {
        x: (s.coord.x + s.pose.tx) * tileSize,
        y: (s.coord.y + s.pose.ty) * tileSize,
        tangent: s.pose.headingDeg,
      };
    }
    const exit = s.exitPort !== null && s.exitPort !== s.entryPort ? s.exitPort : null;
    const p =
      exit === null
        ? laneSegmentPointAt(s.entryPort, oppositePort(s.entryPort), tileSize, off.offEntry, off.offEntry, 0)
        : laneSegmentPointAt(s.entryPort, exit, tileSize, off.offEntry, off.offExit, s.t);
    return {
      x: s.coord.x * tileSize + p.x,
      y: s.coord.y * tileSize + p.y,
      tangent: p.tangentDeg,
    };
  }

  // Chord positioning for one road vehicle body, mirroring positionUnit: centre
  // at the couplers' midpoint, angle along the chord (the body leans into bends
  // and lane changes), falling back to the front tangent on a collapsed chord.
  function positionRoadUnit(
    unit: { front: CarSample; rear: CarSample },
    offFront: { offEntry: number; offExit: number },
    offRear: { offEntry: number; offExit: number },
  ) {
    const f = sampleRoadWorld(unit.front, offFront);
    const r = sampleRoadWorld(unit.rear, offRear);
    const dx = f.x - r.x;
    const dy = f.y - r.y;
    const chord = Math.hypot(dx, dy);
    const angle = chord > 0.5 ? (Math.atan2(dy, dx) * 180) / Math.PI : f.tangent;
    return { x: (f.x + r.x) / 2, y: (f.y + r.y) / 2, angle };
  }

  // Fare pins, reconciled from the loco positions the sprite pass just computed
  // (re-sampling here would be the same maths twice a frame). A pin exists only
  // while the train is live and unpaid: it disappears the moment the train
  // starts gliding into its shed, rather than hanging over the depot roof.
  function updateFareBadges(locoPos: Record<string, { x: number; y: number }>) {
    if (!fares) return;
    const seen = new Set<string>();
    for (const def of trainDefs) {
      const train = sim.trains[def.id];
      const pos = locoPos[def.id];
      if (!train || !pos) continue;
      if (!fares.has(def.id) || fares.isSettled(def.id)) continue;
      if (train.state === "parking" || train.state === "parked") continue;
      seen.add(def.id);
      const amount = fares.valueOf(def.id);
      const waiting = train.state === "waiting";
      const y = pos.y - tileSize * FARE_BADGE_LIFT;
      // A WAITING train is not "held": it is the player's turn, and its pin is
      // already the Send button. A train stopped at a DEAD END carries no block
      // record either — the sim reports proceeding there (see assessGridlock),
      // so the pin stays silent and the gridlock nudge covers that case.
      const block = waiting ? undefined : sim.trainBlock(def.id);
      const held: FareHold | undefined = block
        ? {
            reason: block.reason,
            by: block.blockedBy,
            color: block.blockedBy ? trainColors[block.blockedBy] : undefined,
          }
        : undefined;
      const existing = fareBadges.find(b => b.trainId === def.id);
      if (existing) {
        existing.x = pos.x;
        existing.y = y;
        existing.amount = amount;
        existing.waiting = waiting;
        if (!sameHold(existing.held, held)) existing.held = held;
      } else {
        fareBadges.push({
          trainId: def.id,
          x: pos.x,
          y,
          amount,
          waiting,
          color: trainColors[def.id] ?? "#ffffff",
          held,
        });
      }
    }
    for (let i = fareBadges.length - 1; i >= 0; i--) {
      if (!seen.has(fareBadges[i].trainId)) fareBadges.splice(i, 1);
    }
  }

  // Whether a sampled anchor rides a flyover DECK: its tile names a flyover
  // pair and the anchor travels that pair. The at-grade line of the same cell
  // fails the pair test and stays at its normal z.
  function anchorOnDeck(p: SampledUnit): boolean {
    const cell = level[getCoordinatesId(p.coord)];
    if (!cell?.flyover || p.exitPort === null) return false;
    return samePair([p.entryPort, p.exitPort], cell.flyover);
  }

  function renderTrains() {
    const locoPos: Record<string, { x: number; y: number }> = {};
    for (const def of trainDefs) {
      // A scheduled train has DOM (so colours/sprites exist up front) but is not
      // in the sim until its spawn time — keep its units hidden until then.
      if (!sim.trains[def.id]) {
        for (const uid of unitIds[def.id]) {
          const el = document.getElementById(uid);
          if (el) el.style.visibility = "hidden";
        }
        continue;
      }
      const units = sim.sampleTrain(def.id);
      const state = sim.trainState(def.id);
      // A waiting train has not moved yet, so its units still sit stacked at the
      // depot centre exactly as they do on the first frame of any level — it is
      // "docked" for the shed-hiding test below only once it is actually parking.
      const docked = state === "parking" || state === "parked";
      const ids = unitIds[def.id];
      for (let i = 0; i < units.length; i++) {
        const el = document.getElementById(ids[i]);
        if (!el) continue;
        const unit = units[i];
        // A docked train's units reach the depot's dead-end centre one by one as
        // the consist slides in; once a unit's rear coupler is at the centre the
        // whole car has driven into the shed, so hide it (the building "swallows"
        // the train) rather than leaving sprites stacked on the roof.
        const inShed =
          docked &&
          unit.rear.exitPort === Position.Center &&
          unit.rear.t >= 0.999;
        const { x, y, angle } = positionUnit(unit);
        // NOTE: going underground is NOT handled here. A unit on a tunnel tile
        // used to be switched to `visibility: hidden` once its CENTRE crossed
        // the tile edge, which popped half a locomotive (100px of a 200px tile)
        // out of existence on the rock face. The bore's mountain now renders
        // above the trains and simply covers them (TileGround's .tile-over-bore
        // roof + the portal mouth in Tile.vue), so the consist slides out of
        // sight — and back out — continuously, with no state to flip.
        el.style.visibility = inShed ? "hidden" : "visible";
        // Riding a flyover deck lifts the unit above the deck (z5): either
        // anchor on it keeps the sprite raised while it straddles the seams,
        // so it never flickers under the parapet mid-crossing. Clearing the
        // inline z restores the class default (loco z4 / wagon z3).
        const onDeck = anchorOnDeck(unit.front) || anchorOnDeck(unit.rear);
        el.style.zIndex = onDeck ? "6" : "";
        if (i === 0) locoPos[def.id] = { x, y };
        el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${angle}deg)`;
        // Publish the angle so the debug label inside can cancel it out. A train
        // running right-to-left is rotated ~180deg, which rendered its id upside
        // down and mirrored — unreadable exactly when you most want to read it.
        el.style.setProperty("--unit-angle", `${angle}deg`);
      }
    }
    updateFareBadges(locoPos);
  }

  // The exit ports a signal tile carries a signal for (per-direction).
  function signalExits(tileId: string): Position[] {
    return level[tileId]?.signals ?? [];
  }

  function updateSignalAspects() {
    for (const tileId of signalTiles) {
      for (const exitPort of signalExits(tileId)) {
        const key = `${tileId}:${exitPort}`;
        signalAspects[key] = sim.signalAspect(tileId, exitPort);
        signalOverrides[key] = overrideState(tileId, exitPort);
      }
    }
  }

  function updateReservations() {
    for (const id of Object.keys(level)) {
      const owner = sim.reservedBy(id);
      // Vue's reactive set is no-op when the value is unchanged, so this is
      // cheap on the frames where reservations don't move.
      if (owner) reservations[id] = owner;
      else if (id in reservations) delete reservations[id];

      const on = sim.occupiedBy(id);
      if (on) occupied[id] = on;
      else if (id in occupied) delete occupied[id];
    }
  }

  // The station tiles, computed once — the crowd mirror and the overcrowding
  // observation both walk them every tick, and a level's roles are data.
  const stationTiles = Object.keys(level).filter(
    id => level[id]?.role === "station"
  );

  // Mirror the per-train facts the service panel shows. Cheap: a handful of
  // trains, and Vue only notifies on a real change.
  function updateTrainStatus() {
    for (const def of trainDefs) {
      const stop = sim.trainNextStop(def.id);
      if (stop) trainNextStops[def.id] = stop;
      else if (def.id in trainNextStops) delete trainNextStops[def.id];
      const retiring = sim.isRetiring(def.id);
      const at = retiringTrains.indexOf(def.id);
      if (retiring && at < 0) retiringTrains.push(def.id);
      else if (!retiring && at >= 0) retiringTrains.splice(at, 1);
    }
  }

  // How many people an hour this platform's catchment would produce if a
  // service ever called here. Derived from the same catchment the real spawn
  // rate comes from, so the readout and the demand cannot disagree.
  function latentDemandAt(tileId: string): number {
    const d = stationDemandOf(level, tileId);
    if (!Number.isFinite(d.intervalSec) || d.intervalSec <= 0) return 0;
    return Math.max(1, Math.round(60 / d.intervalSec));
  }

  // Mirror each STOP's live queue for the crowd render — platforms and kerbs
  // alike, because since #90 a bus stop is a node of the same network and its
  // waiting people are just as real. Vue's reactive set is a no-op while the
  // count is unchanged, so this is cheap.
  function updateStationQueues() {
    for (const id of Object.keys(level)) {
      if (!transitStops.has(id)) {
        if (id in stationQueues) delete stationQueues[id];
        if (id in stationWaiting) delete stationWaiting[id];
        if (id in stationWaitingColours) delete stationWaitingColours[id];
        continue;
      }
      stationQueues[id] = sim.stationQueue(id);
      const waiting = sim.stationWaiting(id);
      // Replace in place only when it really changed, so Vue does not
      // re-render every platform on every frame.
      const cur = stationWaiting[id];
      if (!cur || cur.length !== waiting.length || waiting.some((d, i) => cur[i] !== d)) {
        stationWaiting[id] = waiting;
      }
      // THE COLOUR OF THE LINE THEY ARE WAITING FOR, one per person. Computed
      // here rather than in the view: the answer comes from the line graph,
      // which is engine work. Recomputed even when the QUEUE is unchanged,
      // because redrawing a line changes what these people are waiting for
      // without anybody joining or leaving the queue — and written back only on
      // a real difference, so Vue still re-renders a platform only when its
      // crowd actually looks different. A person no service can carry gets ""
      // and is drawn neutral.
      const colours = waiting.map(dest => {
        const lineId = dest ? sim.lineFrom(id, dest) : undefined;
        return (lineId && lines.find(l => l.id === lineId)?.colour) || "";
      });
      const curC = stationWaitingColours[id];
      if (!curC || curC.length !== colours.length || colours.some((c, i) => curC[i] !== c)) {
        stationWaitingColours[id] = colours;
      }
    }
  }

  // The fullest platform right now — the absolute the objective tracker folds
  // into its peak. Read from the SIM, not the render mirror: the mirror only
  // refreshes inside the rAF frame, so a headless run (or a hidden tab) would
  // score a permanently empty station.
  function worstStationQueue(): number {
    let worst = 0;
    for (const id of stationTiles) {
      const q = sim.stationQueue(id);
      if (q > worst) worst = q;
    }
    return worst;
  }

  // Sample each live car to world positions (reusing the train chord placement)
  // and reconcile the reactive list by id so Vue reuses the car DOM nodes. A
  // vehicle contributes one render box per body segment (a semi → cab + trailer),
  // each keyed `${carId}#${i}` and sized to its segment length.
  // Lane-offset geometry — where a car body sits laterally on each tile (seam
  // tapers, the one-way highway kerb-anchor, the corner-fillet turn glide). Shared
  // Vue-free with the road sim (sim/laneGeometry.ts) so the renderer and the sim
  // draw/measure the EXACT same offset path; built with the px `tileSize` here.
  const { couplerOffsets, turnExitOffsetPx, oneWayRunMaxAt } = createLaneGeometry(
    level,
    tileSize,
  );

  // Does a class-`cls` vehicle in approach lane `entryLane` LAND on a bus lane on
  // the EXIT arm of a TURN through `coord` (entry→exit adjacent)? The debug
  // overlay colours an arrow amber only when this is true, so an arrow is amber
  // iff it ends on a real bus lane — a bus whose movement falls back to a car lane
  // (e.g. a median bus turning right onto a car-only arm) renders cyan, matching
  // where the vehicle actually drives (junctionExitLane), never a phantom amber
  // line onto an arm with no bus lane. False at a dead-end / map edge.
  function turnExitOnBusLane(
    coord: Coordinates,
    entry: Position,
    exit: Position,
    entryLane: number,
    cls: VehicleClass,
  ): boolean {
    const here = level[getCoordinatesId(coord)]?.road;
    const next = neighborCoord(coord, exit);
    if (!next) return false;
    const exitRoad = level[getCoordinatesId(next)]?.road;
    return turnLandsOnBusLane(
      here,
      entry,
      entryLane,
      exit,
      exitRoad,
      oppositePort(exit),
      cls,
    );
  }

  function updateRoadCars() {
    const samples = roadSim.sample();
    const seen = new Set<string>();
    // THE SQUEEZE — passing traffic eases around informally parked cars. The
    // maths (and its never-into-oncoming-traffic proof) live in
    // sim/laneGeometry.ts, where the body-overlap oracle tests the exact
    // function the renderer runs here.
    const squeezeBanks = buildSqueezeBanks(roadSim.informalParked());
    const squeezed = (
      c: { coord: Coordinates; entryPort: Position; exitPort: Position | null },
      off: LaneOffsets,
      lanePos: number,
    ): LaneOffsets => informalSqueeze(squeezeBanks, c, off, lanePos, tileSize);
    for (const s of samples) {
      const curIndex = s.laneIndex;
      for (let u = 0; u < s.units.length; u++) {
        const unit = s.units[u];
        const id = `${s.id}#${u}`;
        seen.add(id);

        // Lateral lane offset, right-of-travel, computed PER COUPLER from its own
        // continuous lane position (`lanePos`) AND its own tile, so a coupler on a
        // tapering tile glides as the painted kerb shifts (seam-aware taper). During
        // a lane change the rear coupler's position lags the front's, so the body
        // angles into the new lane (the lean) instead of sliding flat. The sim eases
        // the lane positions for merges/turns; off-change they're equal.
        const cls: VehicleClass =
          unit.part === "bus" ? "bus" : unit.part === "bike" ? "bike" : "car";
        // A posed coupler ignores lane offsets entirely, and asking for them is
        // not merely wasted work: `couplerOffsets` returns 0/0 for a tile whose
        // road has no lanes from that entry, which would read as a meaningful
        // offset rather than as "not applicable".
        const offsetFront = unit.front.pose
          ? ZERO_LANE_OFFSET
          : squeezed(unit.front, couplerOffsets(unit.front, curIndex, cls), unit.front.lanePos ?? curIndex);
        const offsetRear = unit.rear.pose
          ? ZERO_LANE_OFFSET
          : squeezed(unit.rear, couplerOffsets(unit.rear, curIndex, cls), unit.rear.lanePos ?? curIndex);

        const { x, y, angle } = positionRoadUnit(unit, offsetFront, offsetRear);
        const widthPx = unit.lengthTiles * tileSize;
        const existing = roadCars.find(c => c.id === id);
        if (existing) {
          existing.x = x;
          existing.y = y;
          existing.angle = angle;
          existing.widthPx = widthPx;
          existing.part = unit.part;
        } else {
          roadCars.push({ id, vehicleId: s.id, unit: u, x, y, angle, widthPx, part: unit.part });
        }
      }
    }
    for (let i = roadCars.length - 1; i >= 0; i--) {
      if (!seen.has(roadCars[i].id)) roadCars.splice(i, 1);
    }

    // Refresh the live junction occupancy (in-place so Vue's reactive map only
    // notifies on real changes): set currently-held junctions, drop stale ones.
    const held = roadSim.junctionOccupancy();
    for (const id of Object.keys(held)) carJunctions[id] = held[id];
    for (const id of Object.keys(carJunctions)) {
      if (!(id in held)) delete carJunctions[id];
    }

    // Refresh car destination markers (debug): destination tile id -> car id.
    const newDest: Record<string, string> = {};
    for (const s of samples) {
      if (s.destination) newDest[getCoordinatesId(s.destination.coord)] = s.id;
    }
    for (const id of Object.keys(newDest)) carDestinations[id] = newDest[id];
    for (const id of Object.keys(carDestinations)) {
      if (!(id in newDest)) delete carDestinations[id];
    }

    // Debug route overlay: resolve the active car (pinned wins) to its centreline
    // path. Recomputed each frame so the line shrinks as the car drives. A stale
    // pin/hover (the car despawned at its destination) drops to null.
    const activeId = pinnedCarId ?? hoveredCarId;
    if (activeId) {
      const segs = roadSim.routePath(activeId);
      if (segs.length === 0) {
        if (pinnedCarId === activeId) pinnedCarId = null;
        if (hoveredCarId === activeId) hoveredCarId = null;
        carRoute.value = null;
      } else {
        carRoute.value = {
          carId: activeId,
          segments: segs.map(s => ({
            d: roadSegmentPathD(s.entryPort, s.exitPort ?? s.entryPort, tileSize),
            x: s.coord.x * tileSize,
            y: s.coord.y * tileSize,
          })),
        };
      }
    } else if (carRoute.value) {
      carRoute.value = null;
    }
  }

  // Activity log: newest-last, capped to the most recent MAX_LOG entries so it
  // can't grow without bound over a long session.
  const MAX_LOG = 200;
  const eventLog = reactive([]) as GameLogEntry[];
  let logSeq = 0;
  let clock = 0; // accumulated sim time in seconds

  // The objective tracker for the active mode, driven by the per-tick observation.
  const tracker = mode.createObjective(setup);
  const goals = goalsOf(setup.objective);
  const spawner = mode.createSpawner?.(setup);

  // --- the economy -----------------------------------------------------------
  // A mode that declares no `economy` gets NEITHER object, so every money code
  // path below is a null check away from doing nothing — which is what keeps
  // Puzzle/Daily/Sandbox byte-for-byte as they were.
  const economySetup = setup.economy;
  const economy = economySetup ? createEconomy(economySetup) : null;
  const fares = economySetup ? createFareBook(economySetup.fares ?? {}) : null;
  // The second clock. Present only when the mode's tuning named one, so every
  // untuned board (and every mode without an economy) keeps exactly the HUD and
  // the ledger it had before the calendar existed.
  const calendar: CalendarSetup | null = economySetup?.calendar ?? null;
  const money = reactive({
    enabled: !!economy,
    balance: economy?.balance ?? 0,
    earned: 0,
    spent: 0,
    trackSpent: 0,
    dateLabel: calendar ? calendarAt(calendar, 0).label : "",
    taxPerYear: 0,
    taxPaid: 0,
    unpaidTax: 0,
    taxUnaffordable: false,
  }) as MoneyState;
  const fareBadges = reactive([]) as FareBadge[];
  // How long the board has been jammed, and whether that has passed the point
  // where it is worth telling the player. See `updateGridlock`.
  const gridlock = reactive({
    sec: 0,
    stuck: false,
    reason: "deadlock",
  }) as GridlockState;

  function refreshMoney() {
    if (!economy) return;
    money.balance = economy.balance;
    money.earned = economy.earned;
    money.spent = economy.spent;
    money.trackSpent = trackSpentTotal;
    money.taxPaid = taxPaidTotal;
    money.unpaidTax = unpaidTaxTotal;
    if (calendar) {
      money.dateLabel = calendarAt(calendar, economy.clock).label;
      money.taxPerYear = taxFor(calendar, tilesBuiltTotal);
      money.taxUnaffordable =
        money.taxPerYear > 0 && money.taxPerYear > economy.balance;
    }
  }

  // --- the annual levy (the second clock) ------------------------------------
  //
  // Charged in whole years off the LEDGER's clock, which only advances while the
  // objective is live — so nothing accrues behind the Ready card, where dt is 0
  // anyway. A `while` rather than an `if` because one frame at 4x speed (or a
  // headless `advance()` with a big dt) can cross more than one year boundary,
  // and a skipped levy would be silent free money.
  //
  // The amount is read at the moment the levy falls due, so track bought during
  // the year is taxed for that year and track bulldozed before year end is not.
  //
  // A levy the balance cannot cover is BANKRUPTCY (design doc §8, M14's
  // survivable half). The company pays what it has — `spend` refuses an
  // unaffordable amount outright, which would make being broke FREE — and the
  // shortfall is recorded, which is what the objective's `onBankruptcy` fails
  // on. Note the condition is OWING MORE THAN YOU HAVE, not "the balance
  // reached zero": finishing a level flat broke with the railway built and the
  // trains running is a tight win, and measured lines do exactly that.
  //
  // Billing STOPS at the first shortfall. Carrying on would pile the whole of
  // every later levy onto the total, and "you were $18,000 short" says nothing
  // more than "you were $600 short" — the run is over either way.
  function collectTax() {
    if (!economy || !calendar) return;
    const due = leviesDue(calendar, economy.clock);
    while (leviesBilled < due) {
      leviesBilled += 1;
      const owed = taxFor(calendar, tilesBuiltTotal);
      const paid = Math.min(owed, economy.balance);
      if (paid > 0) {
        economy.spend(paid, "tax", `${levyYear(calendar, leviesBilled)} upkeep`);
        taxPaidTotal += paid;
      }
      if (owed > paid) {
        unpaidTaxTotal += owed - paid;
        return;
      }
    }
  }

  // Inject a scheduled train into the live sim. The colour/sprite resolution is
  // identical to the init path (trainInit), so a spawned train departs its depot
  // exactly like one present at t=0. Guards against a double-spawn (the spawner
  // is edge-driven, but be defensive across speed changes / reset races).
  function injectTrain(def: TrainDef) {
    if (sim.trains[def.id]) return;
    sim.addTrain(trainInit(def));
  }
  const defById: Record<string, TrainDef> = {};
  for (const def of trainDefs) defById[def.id] = def;

  // --- the service: lines, and buying the trains to run them -----------------
  // Refresh the view copy of a train's line from whoever owns it right now: the
  // SIM for a train on the metals, its DEFINITION for one still queued in the
  // shed. A queued train has no sim entry at all (see `pendingTrains`), so
  // asking the sim alone reports "no line" for a train the player has just
  // routed — and `trainInit` carries `def.line` over when it finally rolls out,
  // so the definition is the honest answer until then.
  // A VEHICLE WEARS ITS LINE'S COLOUR — on a board where a line is the plan.
  //
  // The liveries used to come from the depot-matching palette, which on a
  // service board says nothing: `/test/transfer` had a yellow train working the
  // green line and a green train working the yellow one, each collecting dots of
  // the OTHER colour. The dots are already coloured by the line somebody is
  // waiting for, so tying the vehicle to the same colour makes the board read at
  // a glance: green train, green dots, green row in the panel.
  //
  // Only where lines ARE the game (`hud.passengers`). In the classic modes a
  // train's colour is a RULE — it has to match the depot it delivers to — and
  // repainting it would break the mechanic rather than explain it. A vehicle
  // with no line keeps its own livery either way: that is the only identity it
  // has.
  function liveryOf(trainId: string): string {
    const own = assignedColors.trainColors[trainId] ?? trainColors[trainId];
    if (!mode.hud.passengers) return own;
    const lineId = sim.trains[trainId] ? sim.lineOf(trainId) : undefined;
    const line = lineId ? lines.find(l => l.id === lineId) : undefined;
    return line?.colour ?? own;
  }

  function syncLiveries(): void {
    for (const id of Object.keys(trainColors)) {
      const want = liveryOf(id);
      if (trainColors[id] !== want) trainColors[id] = want;
    }
  }

  function syncLine(trainId: string): void {
    const stops = sim.trains[trainId]
      ? sim.trainLine(trainId)
      : (defById[trainId]?.line ?? []);
    if (stops.length) trainLines[trainId] = [...stops];
    else delete trainLines[trainId];
    syncLines();
  }

  // Mirror the whole line registry, and with it the reverse index the BOARD
  // needs: which services call at each station. Both are derived from the LINES
  // so that a line with no train on it is still a service the platform shows —
  // the plan exists whether or not anything is running it yet.
  function syncLines(): void {
    lines.splice(0, lines.length);
    for (const [i, line] of sim.lines().entries()) {
      lines.push({
        id: line.id,
        name: line.name,
        stops: [...line.stops],
        trains: sim.trainsOnLine(line.id),
        buses: buses.filter(b => b.lineId === line.id).map(b => b.id),
        colour: LINE_COLOURS[i % LINE_COLOURS.length],
        kind: lineKindOf(line.stops),
      });
    }
    // The lines have just been rebuilt, so the liveries that follow them can be
    // brought into step — after `lines`, because that is what liveryOf reads.
    syncLiveries();
    for (const id of Object.keys(stationLines)) delete stationLines[id];
    for (const line of lines) {
      for (const stop of line.stops) {
        const at = (stationLines[stop] ??= []);
        if (!at.includes(line.colour)) at.push(line.colour);
      }
    }
    // LATENT DEMAND: what a platform would carry if it were served. Refreshed
    // HERE rather than per frame, because it changes exactly when the services
    // do — a player action, never a tick — and because a per-frame mirror is
    // invisible to a headless test (the hidden-tab trap: `frame()` does not run
    // without a browser, so a rule proved only there is not proved at all).
    //
    // On a board with a citizen layer an unhappy town says this better. A plain
    // network board has no moods to read, and since D10 an unserved platform is
    // EMPTY — so without this there is nothing at all to tell the player which
    // places are waiting for a connection. Read-only, and deliberately not in
    // any fail predicate: punishing someone for demand they were never given
    // the chance to serve is the thing D10 exists to remove.
    for (const id of Object.keys(level)) {
      if (level[id]?.role !== "station") continue;
      const want = sim.servedFrom(id).length > 0 ? 0 : latentDemandAt(id);
      if (stationLatent[id] !== want) stationLatent[id] = want;
    }
  }
  for (const def of trainDefs) syncLine(def.id);

  // Draw a line without buying anything: the plan first, the vehicles after.
  function createLine(stops: string[], name?: string): string {
    const id = sim.createLine(stops, name);
    syncLines();
    return id;
  }

  function setLineStops(lineId: string, stops: string[]): boolean {
    if (!sim.setLineStops(lineId, stops)) return false;
    // Every train running it now serves the new stops; their view copies and
    // their defs (which a reset re-seeds from) have to follow.
    for (const trainId of sim.trainsOnLine(lineId)) {
      const def = defById[trainId];
      if (def) def.line = stops.length ? [...stops] : undefined;
      syncLine(trainId);
    }
    syncLines();
    if (lineOverlay.lineId === lineId) setLineOverlay({ lineId });
    return true;
  }

  function renameLine(lineId: string, name: string): boolean {
    if (!sim.renameLine(lineId, name)) return false;
    syncLines();
    return true;
  }

  function deleteLine(lineId: string): boolean {
    const running = sim.trainsOnLine(lineId);
    if (!sim.deleteLine(lineId)) return false;
    for (const trainId of running) {
      const def = defById[trainId];
      if (def) def.line = undefined;
      syncLine(trainId);
    }
    syncLines();
    if (lineOverlay.lineId === lineId) setLineOverlay(null);
    return true;
  }

  // Put a train onto an existing line, or take it off with null.
  function assignTrain(trainId: string, lineId: string | null): boolean {
    if (!sim.assignTrain(trainId, lineId)) return false;
    const def = defById[trainId];
    if (def) {
      const stops = sim.trainLine(trainId);
      def.line = stops.length ? [...stops] : undefined;
    }
    syncLine(trainId);
    return true;
  }

  // Where a train can be ordered: every depot on the board, in a stable order.
  const depotTiles = Object.keys(level)
    .filter(id => level[id]?.role === "depot")
    .sort();

  // Trains ordered but not yet out of the shed, oldest first. A depot holds
  // ONE train at a time on the metals, so ordering three at once is fine —
  // they roll out one after another as the mouth clears. Until then a queued
  // train has DOM and a livery but no sim entry, which is exactly the state
  // `renderTrains` already keeps a scheduled train in (hidden, not drawn).
  const pendingTrains: TrainDef[] = [];

  // Release whatever can leave: the head of the queue whose depot is clear.
  // Called every world step, so a queue drains by itself in order.
  function releasePendingTrains(): void {
    for (let i = 0; i < pendingTrains.length; i++) {
      const def = pendingTrains[i];
      const depot = getCoordinatesId({ x: def.x, y: def.y });
      if (sim.occupiedBy(depot)) continue; // its shed is still blocked
      pendingTrains.splice(i, 1);
      i -= 1;
      const at = queuedTrains.indexOf(def.id);
      if (at >= 0) queuedTrains.splice(at, 1);
      injectTrain(def);
      syncLine(def.id);
    }
  }

  // A new train, ordered at a depot and put into service on `stops`. Ordering
  // NEVER fails for want of room: a depot is where trains are built and they
  // queue there, exactly as they do in Transport Fever — what a full depot
  // delays is the departure, not the purchase. Returns the def (so the view
  // can give it a sprite) or null only when the board has no depot at all.
  let boughtCount = 0;
  function buyTrain(stops: string[], depotId?: string): TrainDef | null {
    const depot = depotId ?? depotTiles[0];
    if (!depot || !level[depot]) return null;
    const { x, y } = parseCoordId(depot);
    boughtCount += 1;
    const id = `bought${boughtCount}`;
    const def: TrainDef = {
      id,
      x,
      y,
      type: "people",
      wagonIds: Array.from(
        { length: SERVICE_TRAIN_WAGONS },
        (_, i) => `${id}w${i + 1}`
      ),
      ...(stops.length ? { line: [...stops] } : {}),
    };
    // The renderer draws from `trainDefs`/`unitIds`, so the roster has to learn
    // about the new train before the sim does anything with it.
    trainDefs.push(def);
    defById[id] = def;
    unitIds[id] = [id, ...def.wagonIds];
    // A livery off the standard palette, walked in order so two trains bought
    // in a row are told apart at a glance. Colour is decoration in this mode —
    // nothing matches on it — so any distinct one will do.
    trainColors[id] = Colors[boughtCount % Colors.length];
    if (sim.occupiedBy(depot)) {
      // The shed is busy: it waits its turn on the metals.
      pendingTrains.push(def);
      queuedTrains.push(def.id);
    } else {
      injectTrain(def);
    }
    // Mirror the line either way. A train ordered ONTO a line while the shed is
    // busy still has that line — it is in `def` — and the panel and the
    // platforms have to say so now, not when it eventually rolls out. Syncing
    // only in the inject branch made an order placed into a busy depot read
    // "no line", which is the state that says "your click did nothing".
    syncLine(def.id);
    return def;
  }

  // Everything the game keeps about a train, forgotten in one place. Called
  // when the sim tells us one is gone (retired) and when we scrap one.
  function forgetTrain(trainId: string): void {
    const at = trainDefs.findIndex(d => d.id === trainId);
    if (at >= 0) trainDefs.splice(at, 1);
    delete defById[trainId];
    delete unitIds[trainId];
    delete trainLines[trainId];
    const queuedAt = queuedTrains.indexOf(trainId);
    if (queuedAt >= 0) queuedTrains.splice(queuedAt, 1);
    const pendingAt = pendingTrains.findIndex(d => d.id === trainId);
    if (pendingAt >= 0) pendingTrains.splice(pendingAt, 1);
    if (!removedTrains.includes(trainId)) removedTrains.push(trainId);
    syncLines();
  }

  function retireTrain(trainId: string): boolean {
    // One still queued in the shed never left it: there is nothing to run to
    // a depot, so withdrawing it is simply cancelling the order.
    if (queuedTrains.includes(trainId)) {
      forgetTrain(trainId);
      return true;
    }
    if (!sim.retireTrain(trainId)) return false;
    syncLine(trainId); // it has dropped its line; the panel should show that
    return true;
  }

  function scrapTrain(trainId: string): boolean {
    const queued = queuedTrains.includes(trainId);
    if (!queued && !sim.removeTrain(trainId)) return false;
    forgetTrain(trainId);
    return true;
  }

  // Put a train onto a line (or take it out of service with []). Thin wrapper
  // over the sim verb that keeps the view copy honest.
  //
  // A train QUEUED IN THE SHED can be routed too, and must be: `buyTrain`
  // queues every order made while the depot mouth is busy, which is the normal
  // case right after you buy one — and the sim has no entry for it yet, so
  // deferring to `sim.assignLine` alone refused the assignment and every click
  // on a station vanished silently. Its line waits on the definition, which
  // `trainInit` reads when the train finally rolls out.
  //
  // The DEFINITION is therefore the test for "does this train exist" — not the
  // sim, which only knows the ones already on the metals.
  function setLine(trainId: string, stops: string[]): boolean {
    const def = defById[trainId];
    if (!def) return false;
    if (sim.trains[trainId]) {
      if (!sim.assignLine(trainId, stops)) return false;
    } else if (stops.length) {
      // Routing a train that is still in the shed. The LINE is created now,
      // not when the train rolls out: a plan does not wait on a vehicle (D11),
      // and the platforms are entitled to announce the service the player has
      // just drawn. When the train is injected, `assignLine` finds this same
      // line by its stops and puts it on it.
      sim.createLine(stops);
    }
    def.line = stops.length ? [...stops] : undefined;
    syncLine(trainId);
    // The picture on the board is of THIS line; redraw it as it is edited.
    if (lineOverlay.trainId === trainId) setLineOverlay({ trainId });
    return true;
  }
  const objective = reactive(tracker.state()) as ObjectiveState;
  // Live crossing-flow snapshot, refreshed each tick from the road sim (the HUD
  // reads this for the falling-when-released wait readout).
  const roadFrame = reactive({
    maxCarWaitSec: 0,
    carWaitTotalSec: 0,
    carsDelivered: 0,
  }) as RoadFrame;

  // Raw running totals of player signal overrides. The loop diffs these against
  // the last-observed totals to feed the tracker manual-control deltas. They are
  // incremented in the control handlers below (toggleHold/forceProceed/cycle).
  let manualHoldTotal = 0;
  let manualGreenTotal = 0;
  let lastHoldTotal = 0;
  let lastGreenTotal = 0;

  // Track pieces bought in play (buildRoute), diffed into the observation the
  // same way the manual-signal totals are.
  let tilesBuiltTotal = 0;
  let lastTilesBuiltTotal = 0;
  // Money committed to track, net of bulldoze refunds — kept beside the piece
  // count it moves with, and reported as an ABSOLUTE (see Observation).
  let trackSpentTotal = 0;
  // The second clock's bookkeeping: how many annual levies have been billed,
  // what they came to, and what the company could not cover (bankruptcy). All
  // zeroed by reset(), like the ledger itself.
  let leviesBilled = 0;
  let taxPaidTotal = 0;
  let unpaidTaxTotal = 0;

  function refreshObjective() {
    Object.assign(objective, tracker.state());
  }

  // Drain the sim's per-tick events into the log + delivery counter and return
  // the per-tick Observation (deltas) the objective tracker consumes.
  function handleEvents(events: SimEvent[]): Observation {
    let deliveredDelta = 0;
    let mismatchedDelta = 0;
    let passengersDeliveredDelta = 0;
    for (const e of events) {
      // A train that reached its shed is gone from the sim; forget it here too
      // so the board stops drawing it and the panel stops listing it.
      if (e.type === "retired") forgetTrain(e.trainId);
      // Passenger rides end at station calls and at matched depot arrivals.
      if (e.type === "dwell") passengersDeliveredDelta += e.alighted;
      if (e.type === "arrived") passengersDeliveredDelta += e.alighted ?? 0;
      if (e.type === "arrived") {
        if (e.matched) {
          deliveredDelta += 1;
          // The fare is settled at the value it has decayed to right now, and
          // `settle` is idempotent — a repeated arrival event can never pay
          // twice. A mismatched (bounced) arrival pays nothing and keeps
          // decaying, which is exactly the cost of routing a train wrongly.
          const fare = fares?.settle(e.trainId) ?? 0;
          economy?.earn(fare, "fare", e.trainId);
        } else mismatchedDelta += 1;
      }
      eventLog.push(toLogEntry(e, logSeq++, clock));
    }
    if (eventLog.length > MAX_LOG) eventLog.splice(0, eventLog.length - MAX_LOG);
    const manualHoldDelta = manualHoldTotal - lastHoldTotal;
    const manualGreenDelta = manualGreenTotal - lastGreenTotal;
    lastHoldTotal = manualHoldTotal;
    lastGreenTotal = manualGreenTotal;
    const tilesBuiltDelta = tilesBuiltTotal - lastTilesBuiltTotal;
    lastTilesBuiltTotal = tilesBuiltTotal;
    deliveries.value += deliveredDelta;
    return {
      deliveredDelta,
      mismatchedDelta,
      manualHoldDelta,
      manualGreenDelta,
      tilesBuiltDelta,
      passengersDeliveredDelta,
      // The fullest platform right now (absolute; the tracker keeps the peak).
      // Only reported on a board that HAS stations, so every other mode leaves
      // the counter at its zero default.
      ...(stationTiles.length > 0 && { maxStationQueue: worstStationQueue() }),
      // Absolutes off the ledger, so the counters can never drift from it. Left
      // out entirely when there is no economy, which keeps the money counters at
      // their zero defaults for every other mode.
      ...(economy && {
        balance: economy.balance,
        earned: economy.earned,
        spent: economy.spent,
        trackSpent: trackSpentTotal,
        unpaidTax: unpaidTaxTotal,
      }),
    };
  }

  const paused = ref(false);
  const speed = ref(1);
  // A reactive heartbeat for views that read the SIMS on demand rather than a
  // mirrored array. `locatePerson` (the pin) and the inspector panel both walk
  // the markRaw'd simulations directly — which is right, because mirroring a
  // whole population per frame to serve one open panel would be absurd — but it
  // means Vue sees no dependency and caches the computed for ever. The pin
  // appeared in the correct place and then never moved again. Touch this and a
  // getter re-runs each drawn frame; anything that does NOT touch it stays as
  // cheap as it was.
  const renderTick = ref(0);
  const deliveries = ref(0);
  let raf = 0;
  let last = 0;

  // One step of the WORLD, in already-scaled sim seconds — everything the rAF
  // frame does except drawing. Extracted so behaviour can be driven headlessly
  // (unit tests, probes): a hidden browser pane runs no requestAnimationFrame,
  // so anything that only happens inside `frame()` cannot be observed there at
  // all (KNOWHOW → the rAF/hidden-tab trap). Purely a split of the old frame
  // body; the order of operations is unchanged.
  function advance(scaled: number) {
    clock += scaled;
    // Advance the predefined spawn schedule only while the objective is live,
    // so the schedule clock aligns with the scored elapsed time (and nothing
    // spawns on the Ready screen). Each due train is injected into the sim.
    let spawnedDelta = 0;
    if (objective.phase === "playing") {
      for (const def of spawner?.step(scaled) ?? []) {
        injectTrain(def);
        spawnedDelta += 1;
      }
      // Fares decay in sim time, and — the point of the whole mode — they
      // decay while a train is still WAITING in its station, not only in
      // transit. Gated on the objective being live so nothing ticks away
      // behind the Ready screen (dt is already 0 there, this is belt and braces
      // for a mode with no start overlay).
      economy?.tick(scaled);
      fares?.tick(scaled);
      // The other clock, on the same gate and for the same reason: no upkeep
      // accrues on a level the player has not started.
      collectTax();
    }
    const simEvents = sim.step(scaled);
    const obs = handleEvents(simEvents);
    obs.spawnedDelta = spawnedDelta;
    // The citizens' day, advanced on the SAME events the railway just emitted:
    // a dwell says exactly who boarded and who got off, which is how a waiting
    // person becomes a rider and a rider becomes someone who arrived (or who
    // has to change trains). Headless, so a unit test can drive it.
    if (citizenSim) {
      // Walkers first: a citizen's leg ends on the walker having arrived, so
      // stepping the pavement after the people would report every arrival one
      // tick late.
      pedestrianSim?.step(scaled);
      pedestrianClaims = pedestrianSim?.claimedCrossings() ?? [];
      // The bus calls join the railway's events in the same dwell shape, so a
      // citizen on a bus is mirrored exactly like one on a train. `busEvents`
      // still holds the PREVIOUS tick's calls here (advanceBuses runs below),
      // so a bus boarding reaches the citizen one frame late — one frame of a
      // dwell measured in seconds, and the price of not reordering the frame
      // around it. Tests that step in large chunks step once more.
      citizenSim.step(scaled, [...simEvents, ...busDwells()]);
      refreshCitizens();
      updatePedestrians();
    }
    // A crossing is closed while a train reserves or sits on that tile — and,
    // now, while somebody is crossing the road on a zebra there. One predicate,
    // two reasons: the road sim already knows how to brake for a closed tile, so
    // yielding to a pedestrian needed no new rule in the traffic model.
    const claimed = pedestrianClaims;
    roadSim.step(
      scaled,
      id => !!(sim.reservedBy(id) || sim.occupiedBy(id)) || claimed.includes(id)
    );
    // Where the cars ended up, for the walkers waiting at a kerb.
    //
    // Only bodies WELL INSIDE a tile count. A car held at a closed crossing
    // stops at its entry edge, and its nose still registers a body point on that
    // tile — so counting every point deadlocked the pair of them: the walker
    // waited for a car that was waiting for the walker, and the road never moved
    // again (measured: a 1078-second queue). The margin is what tells "stopped
    // at the kerb giving way" from "actually on the crossing".
    if (pedestrianSim) {
      carTiles.clear();
      for (const body of roadSim.bodies()) {
        for (const pt of body.points) {
          if (pt.t > 0.15 && pt.t < 0.85) carTiles.add(pt.tileId);
        }
      }
    }
    // Park & ride: whoever just pulled into a stall within walking reach of a
    // station is now standing on its platform.
    transferParkedArrivals();
    // The bus services: dwell, exchange passengers, drive on to the next stop.
    busEvents.length = 0;
    advanceBuses(scaled);
    syncBuses();
    // How full each vehicle is: a MODEL fact (who is aboard, how many seats),
    // so it is refreshed with the world and not with the render frame. Put in
    // `frame()` it would freeze in a hidden tab and be invisible to a headless
    // test — which is exactly what happened on the first cut, and what the
    // comment on updateVehicleLoads claimed it had avoided.
    updateVehicleLoads();
    // Ordered trains roll out of the shed as it clears, in the order bought.
    releasePendingTrains();
    // Fold the road's crossing-flow snapshot into the observation so the
    // objective layer can score patience + throughput (Crossing Keeper). The
    // automatic crossing can't produce an incident, so the delta stays 0.
    const rf = roadSim.frame();
    obs.maxCarWaitSec = rf.maxCarWaitSec;
    obs.carsDelivered = rf.carsDelivered;
    obs.crossingIncidentDelta = 0;
    roadFrame.maxCarWaitSec = rf.maxCarWaitSec;
    roadFrame.carWaitTotalSec = rf.carWaitTotalSec;
    roadFrame.carsDelivered = rf.carsDelivered;
    tracker.observe(obs, scaled);
    refreshObjective();
    refreshMoney();
    updateGridlock(scaled);
  }

  function frame(now: number) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (!paused.value) {
      // Hold the whole world still while a Ready screen is up. The spawner was
      // already gated on the objective being live ("nothing spawns on the Ready
      // screen"), but the TRAINS were not: they drove off behind the overlay, and
      // any delivery made before the player pressed Start landed before
      // `tracker.start()` — so it was never counted and the level could not be
      // won. Freezing dt keeps sampling and rendering intact, and stops the
      // scored clock running on a screen the player has not answered yet.
      const waitingToStart = mode.hud.startOverlay && objective.phase === "ready";
      advance(waitingToStart ? 0 : dt * speed.value);
    }
    renderTrains();
    updateRoadCars();
    updateParking();
    updateSignalAspects();
    updateRoadSignals();
    updateReservations();
    updateStationQueues();
    updateTrainStatus();
    // LAST: a getter woken by the heartbeat must see a fully-mirrored frame,
    // not one halfway through being updated.
    renderTick.value += 1;
    raf = requestAnimationFrame(frame);
  }

  // --- editing the world while it runs ---------------------------------------
  //
  // The simulation reads the level live on every `traverse`, so track laid mid-
  // run is routable on the next tick with no rebuild. Only three things are
  // derived rather than read, and this keeps them honest.
  //
  // The guard is the interesting part. A train's path caches the exit port of
  // the tile it is standing on, and reservations cache tile ids, so editing a
  // tile that is occupied or reserved makes both stale — the train would jump,
  // or hold against a block that no longer looks the way it did. Rejecting
  // those edits is also exactly the rule a player expects: you cannot rip up
  // track under a moving train. The correctness guard and the game rule are the
  // same line.
  // Tiles an edit may not touch: any a train occupies or has reserved, because
  // a train's segment caches the exit it committed to and its reservations name
  // tiles by id — change the track under either and both go stale.
  //
  // With ONE exception, and it is the difference between a rescue and a dead
  // board: a train that has RUN OUT OF TRACK has committed to no exit at all.
  // Nothing it is doing can be contradicted by laying the rail it is waiting
  // for. Without this, the tile a stranded train stands on is exactly the tile
  // the player needs to build on, and the tool refuses — the rescue has to be
  // drawn from the far side, which is neither obvious nor always possible.
  // Lake Valley reaches this state honestly: buy the ring but not the station
  // entry, and the yellow train leaves its own depot onto a tile with no way
  // out and sits there.
  function editBlockers(tileIds: string[]): string[] {
    return tileIds.filter(id => {
      const claimants = new Set<string>();
      const occupant = sim.occupiedBy(id);
      const reserver = sim.reservedBy(id);
      if (occupant) claimants.add(occupant);
      if (reserver) claimants.add(reserver);
      if (claimants.size === 0) return false;
      // Editable only if EVERY train laying claim to this tile is stranded on
      // it. A train whose tail merely lies here still blocks: the segment under
      // its wagons carries a committed exit.
      const stranded = sim.strandedOn(id);
      return ![...claimants].every(t => stranded.includes(t));
    });
  }

  function canEdit(tileIds: string[]): boolean {
    return editBlockers(tileIds).length === 0;
  }

  function applyEdits(steps: RouteStep[]): EditResult {
    const ids = [...new Set(steps.map(s => s.id))];
    const blocked = editBlockers(ids);
    if (blocked.length > 0) return { ok: false, blocked };

    // Whoever was stranded on these tiles BEFORE the edit. Collected first,
    // because once the rail is laid they are no longer stranded by the test
    // above — and they are exactly the trains whose dead-ended head segment
    // still points nowhere.
    const rescued = new Set(ids.flatMap(id => sim.strandedOn(id)));

    for (const s of steps) {
      level[s.id] = addConnection(level[s.id] ?? { connections: [] }, s.a, s.b);
    }

    // A tile that just became a junction has no switch arm, and
    // `connectionsToExitPort` returns NULL for a multi-partner entry with no arm
    // — the train would stop dead on it. Merge in arms for the new entries while
    // keeping every arm the player has already set. (Additive edits only, so an
    // existing arm can never be left pointing at a connection that went away.)
    const fresh = initialSwitches(level);
    for (const id of ids) {
      if (fresh[id]) switches[id] = { ...fresh[id], ...(switches[id] ?? {}) };
      else delete switches[id];
    }

    signalTiles = Object.entries(level)
      .filter(([, tile]) => tile.signals && tile.signals.length > 0)
      .map(([id]) => id);

    // Point the rescued trains at the track that now exists. Their head segment
    // was built when the tile had no way out, so without this they would move
    // off while still being DRAWN along the stub they dead-ended on.
    for (const id of rescued) sim.releaseStranded(id);

    levelVersion.value++;
    return { ok: true, blocked: [] };
  }

  // --- buying track (the in-play build verb, Tycoon phase 2) -----------------
  //
  // Only NEW pieces cost money. The route gesture re-lays the anchor straight
  // of the open end it grows from, and closing a gap into existing track plans
  // straight through the far tile — both are duplicates of connections the
  // level already has, and `addConnection` makes them no-ops. Charging for them
  // would price a two-tile gap at five tiles, so the cost (and the `tilesBuilt`
  // counter a "buy ≥ N pieces" star reads) counts only steps that actually add
  // a connection. Same filter feeds the preview tag, so what's shown = what's
  // charged.
  function newBuildSteps(steps: RouteStep[]): RouteStep[] {
    const seen = new Set<string>();
    const out: RouteStep[] = [];
    for (const s of steps) {
      const key = `${s.id}:${Math.min(s.a, s.b)}-${Math.max(s.a, s.b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pair: PortPair = [s.a, s.b];
      if (level[s.id]?.connections.some(c => samePair(c, pair))) continue;
      out.push(s);
    }
    return out;
  }

  // One tile's price: the base rate times its ground's factor (felling a wood,
  // buying town land — see TERRAIN_BUILD_FACTOR). Rounded per PIECE so the sum
  // of the preview tags always equals the total charged.
  function pricePerPiece(tileId: string): number {
    return Math.round(TRACK_COST_PER_TILE * terrainBuildFactor(level[tileId]));
  }

  function buildCostOf(steps: RouteStep[]): number {
    if (!economy) return 0; // no ledger, no price (Sandbox builds free)
    return newBuildSteps(steps).reduce((sum, s) => sum + pricePerPiece(s.id), 0);
  }

  // --- taking track back: TWO different verbs --------------------------------
  //
  // They were one verb once, and that is why it felt wrong. Bulldoze refunded
  // in full, because it had to double as the escape hatch for a MISDRAG — and a
  // misdrag is an input error, not a world event. Conflating them forced a
  // price that could not be honest: money back for demolition.
  //
  //   UNDO      reverses a PURCHASE. The gesture never happened: the rails go,
  //             the money comes back in full, nothing is charged. It exists
  //             outside the fiction, like Ctrl+Z anywhere else, so it costs the
  //             world nothing to explain.
  //   BULLDOZE  removes a RAILWAY. Somebody has to pull the rails up, so it
  //             costs CLEARING_COST_PER_TILE and never pays.
  //
  // Split like that, each price is the truthful one.

  // Every connection the player has actually PAID for, keyed the same way
  // `newBuildSteps` de-duplicates. Undo only ever gives money back for pieces
  // in here — a board arrives with authored track nobody bought, and it must
  // stay impossible to turn `lakevalley-open`'s pre-existing ring into income.
  const boughtPieces = new Set<string>();
  const pieceKey = (id: string, a: Port, b: Port) =>
    `${id}:${Math.min(a, b)}-${Math.max(a, b)}`;

  // The last build gesture, for as long as it is still undoable. Cleared by the
  // next thing the PLAYER does — another build replaces it, a bulldoze or a
  // dispatch drops it. Deliberately not by anything the WORLD does (a levy, a
  // fare): a window that closes on its own is an invisible timer, and the whole
  // reason undo beat a timed grace period is that it has none. Only the LAST
  // gesture is ever undoable, so "undo the level at the end" is not a strategy.
  let lastBuild: { steps: RouteStep[]; cost: number } | null = null;
  // The view's reactive window onto it. `game` is markRaw'd and `lastBuild` is a
  // plain closure variable, so a getter reading it would never re-evaluate —
  // and unlike an edit, DISPATCHING clears it without touching `levelVersion`,
  // so there is nothing else to hang the reactivity on. `pieces` rather than
  // `value` decides whether the control shows, because Sandbox builds free and
  // an undo worth $0 is still an undo.
  const undoable = ref({ pieces: 0, value: 0 });
  function setLastBuild(b: { steps: RouteStep[]; cost: number } | null) {
    lastBuild = b;
    undoable.value = { pieces: b?.steps.length ?? 0, value: b?.cost ?? 0 };
  }

  function bulldozeCostOf(tileId: string): number {
    if (!economy) return 0; // no ledger, no price (Sandbox clears free)
    return CLEARING_COST_PER_TILE * (level[tileId]?.connections.length ?? 0);
  }

  // What undoing the last purchase would hand back. 0 when there is nothing to
  // undo, which is also how the view knows to hide the control.
  function undoValue(): number {
    return lastBuild?.cost ?? 0;
  }
  function canUndoBuild(): boolean {
    return lastBuild !== null && canEdit([...new Set(lastBuild.steps.map(s => s.id))]);
  }

  // Shared by both verbs: drop these connections and put the world back in a
  // consistent state. Removal is the case additive edits never had — an arm can
  // be left pointing at an exit that no longer exists, and
  // `connectionsToExitPort` answers NULL for that, so the train stops dead on
  // the tile. Re-derive the arms from scratch rather than merging, so no stale
  // arm survives.
  function stripConnections(pieces: { id: string; a: Port; b: Port }[]) {
    const touched = new Set<string>();
    for (const p of pieces) {
      const cell = level[p.id];
      if (!cell) continue;
      const next = removeConnection(cell, p.a, p.b);
      // Keep the cell if it still carries road or terrain — taking track out
      // must not erase the ground under it.
      if (isBlankCell(next)) delete level[p.id];
      else level[p.id] = next;
      touched.add(p.id);
    }
    const fresh = initialSwitches(level);
    for (const id of touched) {
      for (const n of [id, ...neighbourIds(id)]) {
        if (fresh[n]) switches[n] = fresh[n];
        else delete switches[n];
      }
    }
    signalTiles = Object.entries(level)
      .filter(([, tile]) => tile.signals && tile.signals.length > 0)
      .map(([id]) => id);
    levelVersion.value++;
  }

  // Take back the last purchase. The money returns as an `adjustment` that
  // CANCELS the build entry rather than as income: `trackSpent` and
  // `tilesBuilt` both fall back, because the pieces were never really bought —
  // which is exactly what makes "Under budget" survive a fumbled drag while
  // still refusing to survive an over-build the player kept.
  function undoBuild(): EditResult {
    if (!lastBuild) return { ok: true, blocked: [] };
    const ids = [...new Set(lastBuild.steps.map(s => s.id))];
    const blocked = editBlockers(ids);
    if (blocked.length > 0) return { ok: false, blocked };

    const { steps, cost } = lastBuild;
    setLastBuild(null);
    stripConnections(steps);
    for (const s of steps) boughtPieces.delete(pieceKey(s.id, s.a, s.b));
    if (economy && cost > 0) {
      economy.earn(cost, "adjustment", `undo ${steps.length} tile${steps.length === 1 ? "" : "s"}`);
    }
    tilesBuiltTotal = Math.max(0, tilesBuiltTotal - steps.length);
    trackSpentTotal = Math.max(0, trackSpentTotal - cost);
    refreshMoney();
    return { ok: true, blocked: [] };
  }

  // Clear a tile's rails, for a fee. Note what does NOT happen: `trackSpent`
  // stays where it was. You spent that money; taking the rails out again does
  // not un-spend it, and a "win while spending at most $X" goal must not be
  // winnable by building wide and razing the evidence. `tilesBuilt` DOES fall,
  // because it counts the railway you kept.
  //
  // Guarded by the same `editBlockers` as building — you cannot rip up track a
  // train stands on or has reserved. That is also the answer to the question
  // additive-only edits were deferred over ("what if a reserved block runs
  // through the deleted tile"): it cannot, because the tile refuses.
  function bulldoze(tileId: string): EditResult {
    const cell = level[tileId];
    if (!cell || cell.connections.length === 0) return { ok: true, blocked: [] };
    // A depot is the level's furniture, not the player's track: removing one
    // would strand its train's route with no way to put it back.
    if (cell.role === "depot") return { ok: false, blocked: [tileId] };
    const blocked = editBlockers([tileId]);
    if (blocked.length > 0) return { ok: false, blocked };
    // A demolition you cannot pay for does not happen — the same rule as an
    // unaffordable build, and it is why the insolvency warning names DELIVERING
    // first: clearing track is an out that itself needs money.
    const fee = bulldozeCostOf(tileId);
    if (economy && fee > 0 && !economy.canAfford(fee)) {
      return { ok: false, blocked: [] };
    }

    const pieces = cell.connections.map(c => ({ id: tileId, a: c[0], b: c[1] }));
    let owned = 0;
    for (const p of pieces) {
      if (boughtPieces.delete(pieceKey(p.id, p.a, p.b))) owned += 1;
    }
    // Razing anything ends the undo window: the layout the player is taking
    // back is no longer the one they bought.
    setLastBuild(null);
    stripConnections(pieces);

    if (economy && fee > 0) {
      economy.spend(fee, "clearing", `${pieces.length} tile${pieces.length === 1 ? "" : "s"}`);
    }
    // Net, so "buy >= N pieces" counts the railway you kept, not the churn —
    // and so a levy is charged on the railway that is still standing.
    tilesBuiltTotal = Math.max(0, tilesBuiltTotal - owned);
    // After the totals, not before: the mirror carries `trackSpent` and the
    // upkeep rate now, and both are derived from what was just written.
    refreshMoney();
    return { ok: true, blocked: [] };
  }

  // --- gridlock detection ----------------------------------------------------
  //
  // Collisions are impossible here by construction (path reservation), so the
  // failure mode this game actually has is DEADLOCK: two trains reserve into
  // each other and both wait forever. From outside that is indistinguishable
  // from a quiet moment — nothing errors, no train crashes, the board just stops
  // — and with no fail state the player is left staring at it. Hence a nudge.
  //
  // The rule: every train that could be moving is blocked, and none of them is
  // blocked by something the PLAYER chose. A held signal is not a deadlock, it
  // is someone playing; so is a train still waiting in its station for dispatch.
  // Only once the board has been motionless for GRIDLOCK_AFTER_SEC of game time
  // do we say so — a train braking for a signal it is about to get is normal.
  function updateGridlock(dt: number): void {
    const { jammed, reason } = assessGridlock(
      Object.keys(sim.trains).map(id => ({
        state: sim.trainState(id),
        velocity: sim.trainVelocity(id),
        block: sim.trainBlock(id),
      }))
    );
    gridlock.sec = jammed ? gridlock.sec + dt : 0;
    gridlock.stuck = jammed && gridlock.sec >= GRIDLOCK_AFTER_SEC;
    if (jammed) gridlock.reason = reason;
  }

  function neighbourIds(tileId: string): string[] {
    const coord = parseCoordId(tileId);
    const out: string[] = [];
    for (const p of [Position.Top, Position.Right, Position.Bottom, Position.Left]) {
      const n = neighborCoord(coord, p);
      if (n) out.push(getCoordinatesId(n));
    }
    return out;
  }

  // ORDER IS THE POINT: affordability gate → applyEdits → spend. applyEdits can
  // refuse (a train moved onto a route tile between preview and click), and a
  // refused buy must cost nothing — so the money moves only after the edit has
  // actually landed. Nothing runs between the canAfford check and the spend
  // (one synchronous call), so the spend cannot fail after the lay succeeded.
  function buildRoute(steps: RouteStep[]): EditResult {
    if (steps.length === 0) return { ok: true, blocked: [] }; // reachable: a 1-step U-turn plans an empty batch
    // Capture the chargeable steps BEFORE the edit lands: `newBuildSteps` asks
    // the level which connections are missing, and after `applyEdits` the
    // answer is "none" — reading it afterwards would record nothing as bought
    // and silently make every piece unrefundable.
    const newSteps = newBuildSteps(steps);
    const pieces = newSteps.length;
    const cost = buildCostOf(steps);
    if (economy && cost > 0 && !economy.canAfford(cost)) {
      return { ok: false, blocked: [] };
    }
    const res = applyEdits(steps);
    if (!res.ok) return res; // refused — nothing spent, nothing counted
    if (economy && cost > 0) {
      economy.spend(cost, "build", `${pieces} tile${pieces === 1 ? "" : "s"}`);
      trackSpentTotal += cost;
    }
    tilesBuiltTotal += pieces;
    // AFTER the totals: the mirror derives `trackSpent` and the annual upkeep
    // from them, so refreshing first would publish a rate for the railway that
    // existed a line ago. (Headless callers — unit tests, probes — see the
    // balance move without waiting for a frame.)
    refreshMoney();
    // Record what was PAID for, so only that can ever be handed back.
    for (const s of newSteps) boughtPieces.add(pieceKey(s.id, s.a, s.b));
    // This gesture is now the undoable one, replacing whatever came before —
    // only the LAST purchase can be taken back.
    //
    // ONLY IF IT BOUGHT SOMETHING. A gesture can lay nothing chargeable — an
    // Esc-finish whose terminus duplicates rail the tile already has is the
    // common one, and it fires immediately after every real gesture. Recording
    // that as "the last purchase" replaced a live window with an empty one and
    // the undo control vanished the moment the player let go. Nothing happened,
    // so nothing changes: the previous purchase stays the undoable one.
    if (pieces > 0) setLastBuild({ steps: newSteps, cost });
    return res;
  }

  return {
    // A GETTER, not a snapshot. `reset()` calls `buildSims()`, which REPLACES
    // the simulation object; `sim,` captured the one that existed when
    // createGame returned, so after a Retry the handle answered from the dead
    // sim while the game ran a new one. Nothing in `src/` reads it, which is
    // why it went unnoticed — but the e2e tests and the live `window.__game`
    // probe do, and they were reading a corpse (wrong answers, never an error).
    // Same reason `signalTiles` below is a getter.
    get sim() {
      return sim;
    },
    tileSize,
    depotColors,
    trainColors,
    switches,
    get signalTiles() {
      return signalTiles;
    },
    levelVersion,
    canEdit,
    applyEdits,
    buildCostOf,
    buildRoute,
    bulldoze,
    bulldozeCostOf,
    undoBuild,
    canUndoBuild,
    undoValue,
    undoable,
    signalAspects,
    signalOverrides,
    reservations,
    occupied,
    stationQueues,
    stationWaiting,
    stationWaitingColours,
    vehicleLoads,
    stationLatent,
    cities,
    citizenStats,
    pedestrians,
    inspectPlot,
    inspectPerson,
    compareModes,
    durationLabel,
    renderTick,
    locatePerson,
    personWalking,
    personDriving,
    trainLines,
    stationLines,
    queuedTrains,
    stationTiles,
    depotTiles,
    setLine,
    buyTrain,
    retireTrain,
    scrapTrain,
    removedTrains,
    trainNextStops,
    retiringTrains,
    stationLabels,
    lineOverlay,
    setLineOverlay,
    lines,
    buyBus,
    assignBus,
    removeBus,
    busServices,
    busStopTiles: busStops,
    createLine,
    setLineStops,
    renameLine,
    deleteLine,
    assignTrain,
    roadCars,
    carJunctions,
    carDestinations,
    parkingOccupancy,
    parkingStatus,
    roadSignalAspects,
    roadSignals,
    carRoute,
    eventLog,
    paused,
    speed,
    deliveries,
    money,
    gridlock,
    fareBadges,
    dispatch(trainId: string) {
      const sent = sim.dispatch(trainId);
      // Sending a train puts the railway into service: the layout stops being a
      // draft, so the last purchase is no longer a draft either. From here,
      // taking track out is a demolition job.
      if (sent) setLastBuild(null);
      return sent;
    },
    mode,
    goals,
    objective,
    roadFrame,
    start() {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    advance,
    startObjective() {
      tracker.start();
      refreshObjective();
    },
    reset() {
      // Un-buy the track first, so buildSims() below reads the board's opening
      // state: Retry restores the starting capital, and keeping the laid track
      // alongside it would let every Retry re-spend the same money. Writes go
      // through the RAW level (the same object the sim indexes); the
      // levelVersion bump at the end is what tells the views.
      for (const id of Object.keys(level)) delete level[id];
      Object.assign(level, JSON.parse(JSON.stringify(pristineLevel)));
      // Junctions the build created are gone again: drop their switch entries
      // (and pick up the pristine board's own), keeping the player's existing
      // arm choices for junctions that survive — the same merge applyEdits does.
      const fresh = initialSwitches(level);
      for (const id of Object.keys(switches)) {
        if (!fresh[id]) delete switches[id];
      }
      for (const id of Object.keys(fresh)) {
        switches[id] = { ...fresh[id], ...(switches[id] ?? {}) };
      }
      signalTiles = Object.entries(level)
        .filter(([, tile]) => tile.signals && tile.signals.length > 0)
        .map(([id]) => id);
      levelVersion.value++;
      buildSims();
      // Re-arm the predefined schedule from the start; injected trains were
      // dropped by buildSims() (it seeds only the init trains).
      spawner?.reset();
      deliveries.value = 0;
      manualHoldTotal = 0;
      manualGreenTotal = 0;
      lastHoldTotal = 0;
      lastGreenTotal = 0;
      tilesBuiltTotal = 0;
      lastTilesBuiltTotal = 0;
      trackSpentTotal = 0;
      setLastBuild(null);
      // Retry re-opens the level on 1 January of its starting year: the levies
      // already billed are forgotten with the capital they were paid out of.
      leviesBilled = 0;
      taxPaidTotal = 0;
      unpaidTaxTotal = 0;
      clock = 0;
      eventLog.splice(0, eventLog.length);
      for (const id of Object.keys(reservations)) delete reservations[id];
      for (const id of Object.keys(occupied)) delete occupied[id];
      for (const id of Object.keys(stationQueues)) delete stationQueues[id];
      for (const id of Object.keys(stationWaiting)) delete stationWaiting[id];
      for (const id of Object.keys(stationLatent)) delete stationLatent[id];
      // buildSims() made a fresh line registry from the train defs, so the view
      // copies have to come from the NEW sim or they would name dead line ids.
      clearLineOverlay();
      for (const def of trainDefs) syncLine(def.id);
      syncLines();
      // The town starts over too: same seed, same people, same jobs.
      rebuildCitizens();
      prevStalls = new Set();
      roadCars.splice(0, roadCars.length);
      roadFrame.maxCarWaitSec = 0;
      roadFrame.carWaitTotalSec = 0;
      roadFrame.carsDelivered = 0;
      // A true do-over needs the money back too: the balance to its starting
      // capital and every fare un-settled at full value.
      economy?.reset();
      fares?.reset();
      fareBadges.splice(0, fareBadges.length);
      refreshMoney();
      tracker.reset();
      refreshObjective();
    },
    toggleHold(tileId: string, exitPort: Position) {
      const wasHeld = sim.isHeld(tileId, exitPort);
      sim.toggleHold(tileId, exitPort);
      if (!wasHeld && sim.isHeld(tileId, exitPort)) manualHoldTotal += 1;
    },
    isHeld(tileId: string, exitPort: Position) {
      return sim.isHeld(tileId, exitPort);
    },
    forceProceed(tileId: string, exitPort: Position) {
      const wasForced = sim.isProceedForced(tileId, exitPort);
      sim.forceProceed(tileId, exitPort);
      if (!wasForced && sim.isProceedForced(tileId, exitPort))
        manualGreenTotal += 1;
    },
    isProceedForced(tileId: string, exitPort: Position) {
      return sim.isProceedForced(tileId, exitPort);
    },
    signalOverride(tileId: string, exitPort: Position) {
      return overrideState(tileId, exitPort);
    },
    // Tri-state click cycle: Auto -> Force Green -> Force Red -> Auto.
    // forceProceed/toggleHold are mutually exclusive in the sim, so we drive the
    // transitions explicitly here to make the cycle deterministic.
    cycleSignal(tileId: string, exitPort: Position) {
      const state = overrideState(tileId, exitPort);
      if (state === "auto") {
        sim.forceProceed(tileId, exitPort); // -> green
        manualGreenTotal += 1;
      } else if (state === "green") {
        // green -> red: clear the forced green, then apply the stop hold.
        sim.forceProceed(tileId, exitPort); // toggle off green
        sim.toggleHold(tileId, exitPort); // -> red
        manualHoldTotal += 1;
      } else {
        sim.toggleHold(tileId, exitPort); // red -> auto
      }
    },
    positionUnit,
    roadLaneCount(coord: Coordinates, port: Position): number {
      const id = getCoordinatesId(coord);
      return laneCount(level[id]?.road, port);
    },
    roadLaneCountAt(coord: Coordinates, port: Position): number {
      const id = getCoordinatesId(coord);
      return laneCountAt(level[id]?.road, port);
    },
    roadIsJunctionAt(coord: Coordinates): boolean {
      return isRoadJunction(level[getCoordinatesId(coord)]?.road);
    },
    roadAt(coord: Coordinates): Lane[] | undefined {
      return level[getCoordinatesId(coord)]?.road;
    },
    roadOneWayRunMax(coord: Coordinates, entry: Position): number {
      return oneWayRunMaxAt(coord, entry);
    },
    roadTurnExitOffsetPx(
      coord: Coordinates,
      entry: Position,
      exit: Position,
      entryLane: number,
      cls: VehicleClass,
    ): number | null {
      return turnExitOffsetPx(coord, entry, exit, entryLane, cls);
    },
    roadTurnExitIsBusLane(
      coord: Coordinates,
      entry: Position,
      exit: Position,
      entryLane: number,
      cls: VehicleClass,
    ): boolean {
      return turnExitOnBusLane(coord, entry, exit, entryLane, cls);
    },
    setHoveredCar(carId: string) {
      hoveredCarId = carId;
    },
    clearHoveredCar() {
      hoveredCarId = null;
    },
    togglePinnedCar(carId: string) {
      pinnedCarId = pinnedCarId === carId ? null : carId;
    },
    clearRouteCar() {
      hoveredCarId = null;
      pinnedCarId = null;
    },
    cycleRoadSignal(tileId: string) {
      roadSim.cycleSignal(tileId);
      updateRoadSignals();
    },
  };
}
