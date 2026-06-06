import { reactive, ref, Ref } from "vue";
import { Position, ActiveIntersection } from "@/types";
import { Level, partnersOf, armExit, defaultArmFor, parseCoordId } from "@/tiles/model";
import {
  createSimulation,
  Simulation,
  SampledUnit,
  UnitChord,
  SimEvent,
} from "@/sim/simulation";
import { createRoadSim, roadEntries, TrafficConfig } from "@/sim/road";
import { segmentPathD } from "@/sim/pathGeometry";
import { unitLengths, couplingTiles } from "@/sim/trainDimensions";
import { makeRng } from "@/utils/globalHelpers";
import { assignColors, ColorAssignment } from "@/utils/colorAssignment";
import { GameLogEntry, toLogEntry } from "@/gameLog";
import { GameMode } from "@/modes/types";
import { ObjectiveState, Observation } from "@/sim/objectives";
import { RoadFrame } from "@/sim/road";

export interface TrainDef {
  id: string;
  x: number;
  y: number; // the depot the train starts in
  type: "people" | "fraight";
  wagonIds: string[];
  // When set (>0), the train is NOT present at init: it is injected by the
  // mode's spawner at this sim-time, departing its depot then (Time Attack's
  // predefined schedule). Omitted / 0 → present from the start, as before.
  spawnAtSec?: number;
}

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
const CAR_SPRITE_PX = 38;

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
const LANE_OFFSET_FRAC = 0.07;

// A single rendered body box of a road vehicle, sampled to a world position. A
// car/truck contributes one; a semi two (cab + trailer). The id is
// `${carId}#${segmentIndex}` so Vue reuses DOM nodes per box; `widthPx` sizes
// the sprite to the segment's length and `part` selects its style.
export interface RoadCar {
  id: string;
  x: number;
  y: number;
  angle: number;
  widthPx: number;
  part: string;
}

export interface Game {
  sim: Simulation;
  tileSize: number;
  depotColors: Record<string, string>;
  trainColors: Record<string, string>;
  switches: Record<string, Record<number, ActiveIntersection>>;
  signalTiles: string[];
  // Signal aspects for rendering, keyed `${tileId}:${exitPort}`.
  signalAspects: Record<string, "stop" | "proceed">;
  // Manual override state per signal, keyed `${tileId}:${exitPort}`.
  signalOverrides: Record<string, "auto" | "green" | "red">;
  // tileId -> trainId that currently reserves it (debug overlay).
  reservations: Record<string, string>;
  // tileId -> trainId physically on it right now (switch lock).
  occupied: Record<string, string>;
  // Road-traffic cars, sampled to world positions each frame for rendering.
  roadCars: RoadCar[];
  // Road-junction tile -> car id currently holding it (debug overlay). Derived
  // live from car positions each frame; cars carry no stored reservation.
  carJunctions: Record<string, string>;
  // Newest-last activity log of decision-level simulation events (reservations,
  // holds, deliveries) for the debug panel. Capped to the most recent entries.
  eventLog: GameLogEntry[];
  paused: Ref<boolean>;
  speed: Ref<number>;
  deliveries: Ref<number>;
  mode: GameMode;
  // Reactive snapshot of the objective tracker, refreshed each frame.
  objective: ObjectiveState;
  // Reactive live crossing-flow snapshot (the *current* worst car wait, not the
  // high-water mark the objective scores), for the HUD's live tension readout.
  roadFrame: RoadFrame;
  start(): void;
  stop(): void;
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
}

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
  levelId = "default"
): Game {
  const switches = reactive(initialSwitches(level)) as Record<
    string,
    Record<number, ActiveIntersection>
  >;

  // Tiles that carry a signal (block boundaries) — any cell with signal ports.
  const signalTiles = Object.entries(level)
    .filter(([, tile]) => tile.signals && tile.signals.length > 0)
    .map(([id]) => id);

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

  // Depot + train colours are owned here so the simulation's "matched delivery"
  // logic and the rendered colours always agree. A seeded RNG keeps the
  // assignment deterministic, and `assignColors` guarantees every train has a
  // reachable matching depot (see colorAssignment.ts).
  const { depotColors, trainColors } =
    colors ?? assignColors(level, trainDefs, makeRng(colorSeed));

  // Road traffic geometry (deterministic from the level): grid extents.
  let roadW = 0;
  let roadH = 0;
  for (const id of Object.keys(level)) {
    const { x, y } = parseCoordId(id);
    roadW = Math.max(roadW, x + 1);
    roadH = Math.max(roadH, y + 1);
  }
  const allRoadEntries = roadEntries(level, roadW, roadH);
  // The train + road sims are built together so `reset()` can rebuild both from
  // the same inputs (the simulation has no in-place reset), giving a true,
  // deterministic do-over for Retry. They're `let` so the rebuild reassigns them;
  // every closure below reads the current binding. The crossing gate is the train
  // reservation/occupancy on that tile — no new interlocking.
  let sim!: Simulation;
  let roadSim!: ReturnType<typeof createRoadSim>;
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
      // Real sprite lengths (in tiles) so the sim spaces units to fit them.
      unitLengths: unitLengths(def.type, def.wagonIds.length, tileSize),
      coupling: couplingTiles(tileSize),
    };
  }

  // Whether a def is present in the sim from the start (no schedule) or injected
  // later by the spawner at its spawnAtSec.
  const isScheduled = (def: TrainDef) => (def.spawnAtSec ?? 0) > 0;

  function buildSims() {
    sim = createSimulation({
      level,
      depotColors,
      // Only init (unscheduled) trains exist at t=0; scheduled trains are added
      // mid-run by the spawner via injectTrain().
      trains: trainDefs.filter(def => !isScheduled(def)).map(trainInit),
      getSwitch: (coordId, entryPort) => switches[coordId]?.[entryPort],
      signalTiles,
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
      maxCars: 8,
      // Per-level overrides (busyness + vehicle mix), if the level supplied any.
      ...(traffic?.spawnInterval !== undefined && {
        spawnInterval: traffic.spawnInterval,
      }),
      ...(traffic?.maxCars !== undefined && { maxCars: traffic.maxCars }),
      ...(traffic?.mix !== undefined && { mix: traffic.mix }),
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

  // World point + path tangent for a single sampled coupler point. `offsetRight`
  // (px) shifts the point perpendicular to its direction of travel, toward the
  // right-hand side — used so road cars drive in the right lane rather than on the
  // centreline. Trains pass 0 and stay on the rail centreline.
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
  function positionUnit(body: UnitChord, offsetRight = 0) {
    const f = sampleWorld(body.front, offsetRight);
    const r = sampleWorld(body.rear, offsetRight);
    const dx = f.x - r.x;
    const dy = f.y - r.y;
    const chord = Math.hypot(dx, dy);
    const angle = chord > 0.5 ? (Math.atan2(dy, dx) * 180) / Math.PI : f.tangent;
    return { x: (f.x + r.x) / 2, y: (f.y + r.y) / 2, angle };
  }

  function renderTrains() {
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
      const docked = sim.trainState(def.id) !== "running";
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
        el.style.visibility = inShed ? "hidden" : "visible";
        const { x, y, angle } = positionUnit(unit);
        el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${angle}deg)`;
      }
    }
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

  // Sample each live car to world positions (reusing the train chord placement)
  // and reconcile the reactive list by id so Vue reuses the car DOM nodes. A
  // vehicle contributes one render box per body segment (a semi → cab + trailer),
  // each keyed `${carId}#${i}` and sized to its segment length.
  function updateRoadCars() {
    const samples = roadSim.sample();
    const seen = new Set<string>();
    const laneOffset = tileSize * LANE_OFFSET_FRAC;
    for (const s of samples) {
      for (let u = 0; u < s.units.length; u++) {
        const unit = s.units[u];
        const id = `${s.id}#${u}`;
        seen.add(id);
        const { x, y, angle } = positionUnit(unit as unknown as UnitChord, laneOffset);
        const widthPx = unit.lengthTiles * tileSize;
        const existing = roadCars.find(c => c.id === id);
        if (existing) {
          existing.x = x;
          existing.y = y;
          existing.angle = angle;
          existing.widthPx = widthPx;
          existing.part = unit.part;
        } else {
          roadCars.push({ id, x, y, angle, widthPx, part: unit.part });
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
  }

  // Activity log: newest-last, capped to the most recent MAX_LOG entries so it
  // can't grow without bound over a long session.
  const MAX_LOG = 200;
  const eventLog = reactive([]) as GameLogEntry[];
  let logSeq = 0;
  let clock = 0; // accumulated sim time in seconds

  // The objective tracker for the active mode, driven by the per-tick observation.
  const setup = mode.setup({ level, trains: trainDefs, levelId });
  const tracker = mode.createObjective(setup);
  const spawner = mode.createSpawner?.(setup);

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

  function refreshObjective() {
    Object.assign(objective, tracker.state());
  }

  // Drain the sim's per-tick events into the log + delivery counter and return
  // the per-tick Observation (deltas) the objective tracker consumes.
  function handleEvents(events: SimEvent[]): Observation {
    let deliveredDelta = 0;
    let mismatchedDelta = 0;
    for (const e of events) {
      if (e.type === "arrived") {
        if (e.matched) deliveredDelta += 1;
        else mismatchedDelta += 1;
      }
      eventLog.push(toLogEntry(e, logSeq++, clock));
    }
    if (eventLog.length > MAX_LOG) eventLog.splice(0, eventLog.length - MAX_LOG);
    const manualHoldDelta = manualHoldTotal - lastHoldTotal;
    const manualGreenDelta = manualGreenTotal - lastGreenTotal;
    lastHoldTotal = manualHoldTotal;
    lastGreenTotal = manualGreenTotal;
    deliveries.value += deliveredDelta;
    return { deliveredDelta, mismatchedDelta, manualHoldDelta, manualGreenDelta };
  }

  const paused = ref(false);
  const speed = ref(1);
  const deliveries = ref(0);
  let raf = 0;
  let last = 0;

  function frame(now: number) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (!paused.value) {
      const scaled = dt * speed.value;
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
      }
      const obs = handleEvents(sim.step(scaled));
      obs.spawnedDelta = spawnedDelta;
      // A crossing is closed while a train reserves or sits on that tile.
      roadSim.step(scaled, id => !!(sim.reservedBy(id) || sim.occupiedBy(id)));
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
    }
    renderTrains();
    updateRoadCars();
    updateSignalAspects();
    updateReservations();
    raf = requestAnimationFrame(frame);
  }

  return {
    sim,
    tileSize,
    depotColors,
    trainColors,
    switches,
    signalTiles,
    signalAspects,
    signalOverrides,
    reservations,
    occupied,
    roadCars,
    carJunctions,
    eventLog,
    paused,
    speed,
    deliveries,
    mode,
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
    startObjective() {
      tracker.start();
      refreshObjective();
    },
    reset() {
      buildSims();
      // Re-arm the predefined schedule from the start; injected trains were
      // dropped by buildSims() (it seeds only the init trains).
      spawner?.reset();
      deliveries.value = 0;
      manualHoldTotal = 0;
      manualGreenTotal = 0;
      lastHoldTotal = 0;
      lastGreenTotal = 0;
      clock = 0;
      eventLog.splice(0, eventLog.length);
      for (const id of Object.keys(reservations)) delete reservations[id];
      for (const id of Object.keys(occupied)) delete occupied[id];
      roadCars.splice(0, roadCars.length);
      roadFrame.maxCarWaitSec = 0;
      roadFrame.carWaitTotalSec = 0;
      roadFrame.carsDelivered = 0;
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
  };
}
