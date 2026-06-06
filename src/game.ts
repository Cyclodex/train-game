import { reactive, ref, Ref } from "vue";
import { Position, ActiveIntersection } from "@/types";
import { Level, partnersOf, armExit, parseCoordId } from "@/tiles/model";
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

export interface TrainDef {
  id: string;
  x: number;
  y: number; // the depot the train starts in
  type: "people" | "fraight";
  wagonIds: string[];
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

// Default switch arm per entry port of every junction tile: the first arm whose
// geometric exit is an actual connection of that tile. Non-junction tiles need
// no switch entry. (Player clicks and interlocking mutate this map later.)
function initialSwitches(
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
      const arm = ALL_ARMS.find(a => {
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

// How far (px at the default 200px tile) to push a car off the road centreline
// toward its right-hand side, so cars drive in the right lane instead of straddling
// the dashed centre. The paved ribbon is ~0.28·tile wide (see `.road-surface`),
// so ~0.07·tile centres the car in the right half. Scaled by the actual tileSize.
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
  start(): void;
  stop(): void;
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
  colorSeed = 1,
  // When provided, these depot/train colours are used verbatim (the test world
  // pins them, e.g. to force a depot colour-mismatch bounce); otherwise the
  // seeded `assignColors` guarantees every train a reachable matching depot.
  colors?: ColorAssignment,
  // Per-level road-traffic settings (busyness + vehicle mix). Overlays the
  // sim's defaults; omitted → the all-cars default behaviour.
  traffic?: TrafficConfig
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

  const sim = createSimulation({
    level,
    depotColors,
    trains: trainDefs.map(def => ({
      id: def.id,
      coord: { x: def.x, y: def.y },
      entryPort: Position.Center, // leaves its depot outward
      color: trainColors[def.id],
      type: def.type,
      wagonCount: def.wagonIds.length,
      // Real sprite lengths (in tiles) so the sim spaces units to fit them.
      unitLengths: unitLengths(def.type, def.wagonIds.length, tileSize),
      coupling: couplingTiles(tileSize),
    })),
    getSwitch: (coordId, entryPort) => switches[coordId]?.[entryPort],
    signalTiles,
  });

  // Road traffic: a deterministic car simulation over the level's `road` layer,
  // running alongside the train sim. Cars spawn one-way (from Bottom/Left
  // openings only) so a single-lane road can't head-on deadlock until a road
  // direction model exists. The crossing gate is the train reservation/occupancy
  // on that tile — no new interlocking.
  let roadW = 0;
  let roadH = 0;
  for (const id of Object.keys(level)) {
    const { x, y } = parseCoordId(id);
    roadW = Math.max(roadW, x + 1);
    roadH = Math.max(roadH, y + 1);
  }
  const allRoadEntries = roadEntries(level, roadW, roadH);
  const oneWayEntries = allRoadEntries.filter(
    e => e.entryPort === Position.Bottom || e.entryPort === Position.Left
  );
  const roadSim = createRoadSim({
    level,
    width: roadW,
    height: roadH,
    seed: colorSeed,
    spawnEntries: oneWayEntries.length ? oneWayEntries : allRoadEntries,
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
    ...(traffic?.spawnInterval !== undefined && { spawnInterval: traffic.spawnInterval }),
    ...(traffic?.maxCars !== undefined && { maxCars: traffic.maxCars }),
    ...(traffic?.mix !== undefined && { mix: traffic.mix }),
  });
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

  function handleEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === "arrived" && e.matched) deliveries.value += 1;
      eventLog.push(toLogEntry(e, logSeq++, clock));
    }
    if (eventLog.length > MAX_LOG) eventLog.splice(0, eventLog.length - MAX_LOG);
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
      handleEvents(sim.step(scaled));
      // A crossing is closed while a train reserves or sits on that tile.
      roadSim.step(scaled, id => !!(sim.reservedBy(id) || sim.occupiedBy(id)));
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
    start() {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    toggleHold(tileId: string, exitPort: Position) {
      sim.toggleHold(tileId, exitPort);
    },
    isHeld(tileId: string, exitPort: Position) {
      return sim.isHeld(tileId, exitPort);
    },
    forceProceed(tileId: string, exitPort: Position) {
      sim.forceProceed(tileId, exitPort);
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
      } else if (state === "green") {
        // green -> red: clear the forced green, then apply the stop hold.
        sim.forceProceed(tileId, exitPort); // toggle off green
        sim.toggleHold(tileId, exitPort); // -> red
      } else {
        sim.toggleHold(tileId, exitPort); // red -> auto
      }
    },
    positionUnit,
  };
}
