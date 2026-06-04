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
  SimEvent,
} from "@/sim/simulation";
import { segmentPathD } from "@/sim/pathGeometry";
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
  signals: Record<string, "red" | "green">; // key: coordId; a red light stops a
  // train leaving that tile. Empty/green allows it (collisions are handled by
  // the simulation's occupancy gate, not by signals).
  paused: Ref<boolean>;
  speed: Ref<number>;
  deliveries: Ref<number>;
  start(): void;
  stop(): void;
  toggleSignal(coordId: string): void;
  positionUnit(unit: SampledUnit): { x: number; y: number; angle: number };
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
  const signals = reactive({}) as Record<string, "red" | "green">;

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
    })),
    getSwitch: (coordId, entryPort) => switches[coordId]?.[entryPort],
    getSignal: coordId => signals[coordId],
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

  function positionUnit(unit: SampledUnit) {
    const exit = unit.exitPort ?? unit.entryPort;
    const path = pathFor(segmentPathD(unit.entryPort, exit, tileSize));
    const len = path.getTotalLength();
    const at = path.getPointAtLength(unit.t * len);
    const ahead = path.getPointAtLength(Math.min(len, unit.t * len + 1));
    const angle = (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI;
    return {
      x: unit.coord.x * tileSize + at.x,
      y: unit.coord.y * tileSize + at.y,
      angle,
    };
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
    raf = requestAnimationFrame(frame);
  }

  return {
    sim,
    tileSize,
    depotColors,
    trainColors,
    switches,
    signals,
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
    toggleSignal(coordId: string) {
      signals[coordId] = signals[coordId] === "red" ? "green" : "red";
    },
    positionUnit,
  };
}
