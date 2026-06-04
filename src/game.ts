import { reactive, ref, Ref } from "vue";
import {
  LevelDefinition,
  Position,
  ActiveIntersection,
} from "@/types";
import {
  createSimulation,
  Simulation,
  SampledUnit,
  UnitChord,
  SimEvent,
} from "@/sim/simulation";
import { segmentPathD } from "@/sim/pathGeometry";
import { unitLengths, couplingTiles } from "@/sim/trainDimensions";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { Colors, getRandom } from "@/utils/globalHelpers";

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

// Initial intersection switch state, derived from the level's activeRoutes /
// disabledRoutes (mirrors TileIntersectionComplete's created() defaults).
function initialSwitches(
  level: LevelDefinition
): Record<string, Record<number, ActiveIntersection>> {
  const out: Record<string, Record<number, ActiveIntersection>> = {};
  for (const [id, tile] of Object.entries(level)) {
    if (tile.component !== "TileIntersectionComplete") continue;
    const disabled = (tile.disabledRoutes ?? {}) as Record<
      number,
      ActiveIntersection[]
    >;
    const active = (tile.activeRoutes ?? {}) as Record<
      number,
      ActiveIntersection
    >;
    const switches: Record<number, ActiveIntersection> = {};
    for (const port of ENTRY_PORTS) {
      const off = disabled[port] ?? [];
      if (active[port] !== undefined && !off.includes(active[port])) {
        switches[port] = active[port];
      } else {
        const arm = ALL_ARMS.find(a => !off.includes(a));
        if (arm !== undefined) switches[port] = arm;
      }
    }
    out[id] = switches;
  }
  return out;
}

const SVG_NS = "http://www.w3.org/2000/svg";

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
  level: LevelDefinition,
  trainDefs: TrainDef[],
  tileSize: number
): Game {
  const switches = reactive(initialSwitches(level)) as Record<
    string,
    Record<number, ActiveIntersection>
  >;

  // Tiles that carry a signal (block boundaries) — from the level's trafficLights.
  const signalTiles = Object.entries(level)
    .filter(([, tile]) => tile.trafficLights)
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
  // logic and the rendered colours always agree.
  const depotColors: Record<string, string> = {};
  for (const [id, tile] of Object.entries(level)) {
    if (tile.component === "TileDepot") depotColors[id] = getRandom(Colors);
  }
  const trainColors: Record<string, string> = {};
  for (const def of trainDefs) trainColors[def.id] = getRandom(Colors);

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

  // World point + path tangent for a single sampled coupler point.
  function sampleWorld(s: SampledUnit) {
    const exit = s.exitPort ?? s.entryPort;
    const path = pathFor(segmentPathD(s.entryPort, exit, tileSize));
    const len = path.getTotalLength();
    const d = s.t * len;
    const at = path.getPointAtLength(d);
    const ahead = path.getPointAtLength(Math.min(len, d + 1));
    return {
      x: s.coord.x * tileSize + at.x,
      y: s.coord.y * tileSize + at.y,
      tangent: (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI,
    };
  }

  // Draw a car as the chord between its two coupler points: centre at their
  // midpoint, angle along the chord. This keeps rigid sprites sitting correctly
  // on curves (the body leans into the curve) instead of overlapping. When the
  // chord collapses (a unit bunched at a depot exit before the train extends),
  // fall back to the front point's tangent to avoid an atan2(0,0) flip.
  function positionUnit(body: UnitChord) {
    const f = sampleWorld(body.front);
    const r = sampleWorld(body.rear);
    const dx = f.x - r.x;
    const dy = f.y - r.y;
    const chord = Math.hypot(dx, dy);
    const angle = chord > 0.5 ? (Math.atan2(dy, dx) * 180) / Math.PI : f.tangent;
    return { x: (f.x + r.x) / 2, y: (f.y + r.y) / 2, angle };
  }

  function renderTrains() {
    for (const def of trainDefs) {
      const units = sim.sampleTrain(def.id);
      const ids = unitIds[def.id];
      for (let i = 0; i < units.length; i++) {
        const el = document.getElementById(ids[i]);
        if (!el) continue;
        const { x, y, angle } = positionUnit(units[i]);
        el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${angle}deg)`;
      }
    }
  }

  // The two exit ports of a (straight) signal tile, from its live rotation.
  function signalExits(tileId: string): Position[] {
    const rotation = level[tileId]?.rotation ?? 0;
    return rotation % 2 === 0
      ? [Position.Top, Position.Bottom]
      : [Position.Right, Position.Left];
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

  function handleEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === "arrived" && e.matched) deliveries.value += 1;
    }
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
      handleEvents(sim.step(dt * speed.value));
    }
    renderTrains();
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
