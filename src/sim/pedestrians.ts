import { Position } from "@/types";
import type { Level, Port } from "@/tiles/model";
import { parseCoordId } from "@/tiles/model";
import { makeRng } from "@/utils/globalHelpers";
import { laneSegmentPointAt } from "@/sim/pathGeometry";
import { oppositePort } from "@/sim/topology";
import { hasFootway, pavementOffsetFor, planWalk, roadThrough, sideOfPlot } from "@/tiles/footway";

// PEOPLE ON THE PAVEMENT — the walking half of the citizen layer.
//
// Deliberately NOT part of the road simulation. A pedestrian has no following
// distance, claims no junction, and may stand in the same doorway as somebody
// else: every gate in `road.ts` exists to guarantee the opposite of all three.
// What they share with cars is the tile graph and the tile GEOMETRY — and the
// geometry is shared by calling the same sampler cars use
// (`laneSegmentPointAt`) at a bigger lateral offset, not by pretending a
// pavement is a lane.
//
// That sampler is why a walker rounds a bend. The first version lerped between
// tile CENTRES with a fixed perpendicular offset, which is right on a straight
// and wrong everywhere else: on a corner tile the walker cut across the inside
// of the curve, left the drawn pavement entirely, and turned through a sharp V
// at the tile centre. Same curve as the paint, or it is not a pavement.
//
// Deterministic and seeded like every other module in `src/sim/`; positions come
// out in TILE units so a headless test can read them and the renderer only has
// to multiply.
//
// Design: docs/superpowers/specs/2026-08-01-citizens-and-cities-design.md §9.1

// One leg of a walk.
//  · "stub"  — the driveway between somebody's door and the kerb. Straight,
//              because the driveway art is straight.
//  · "along" — across a tile on one pavement, following the offset curve.
//  · "cross" — the ZEBRA: sideways over the carriageway, half way along the
//              tile, and only where the level put a crossing.
type StepKind = "stub" | "along" | "cross";

interface WalkStep {
  kind: StepKind;
  tileId: string;
  x: number;
  y: number;
  side: 1 | -1;
  // along / cross
  entry?: Port;
  exit?: Port;
  // along: the slice of the tile crossing this step covers (a tile that is
  // crossed half way along is walked in two halves, with the zebra between).
  tFrom?: number;
  tTo?: number;
  // cross: the pavement being crossed to.
  toSide?: 1 | -1;
  // stub: the two ends, in world tile units.
  from?: { x: number; y: number };
  to?: { x: number; y: number };
}

export interface Walker {
  id: string;
  steps: WalkStep[];
  index: number;
  progress: number; // 0..1 across the current step
  speed: number; // tiles/sec
  // How long they have been held at the kerb of the crossing they are on.
  waitedSec: number;
}

// A walker sampled for drawing: where they are, in TILE units from the world
// origin, which way they are facing, and whether they are held at a kerb.
export interface WalkerSample {
  id: string;
  x: number;
  y: number;
  headingDeg: number;
  waiting: boolean;
}

export interface PedestrianSim {
  // Send somebody walking from one plot to another. Returns a trip id, or null
  // when there is no pavement route — the caller then falls back to its clock,
  // so a board with no footways behaves exactly as it did before they existed.
  request(fromPlot: string, toPlot: string): string | null;
  step(dt: number): void;
  status(id: string): "walking" | "arrived";
  release(id: string): void;
  sample(): WalkerSample[];
  count(): number;
  // Tiles a pedestrian is on, or waiting to step onto, a crossing at. The road
  // sim treats these as CLOSED — the very same predicate a level crossing uses
  // when a train is coming. That is the whole yielding rule: people claim the
  // zebra, traffic stops for it.
  claimedCrossings(): string[];
  // How many are held at a kerb waiting for the road to clear — the number that
  // says a crossing is doing something.
  waitingCount(): number;
}

export interface PedestrianSimConfig {
  level: Level;
  seed?: number;
  // Tiles per second. Matches the citizen sim's `walkSpeed` so the person on
  // screen and the person in the model are the same speed — otherwise a walker
  // arrives visibly before or after their journey is scored.
  speed?: number;
  // Is a vehicle physically on this tile right now? A walker claims the zebra
  // (stopping anything else entering) and then waits for whatever is already on
  // it to clear before stepping out. Omitted → the road is always clear, which
  // is right for a headless test with no traffic in it.
  roadBusy?: (tileId: string) => boolean;
}

// How many people may be on the pavements at once. Walkers are cheap (no
// following, no conflicts) but the DOM is not.
const MAX_WALKERS = 120;

// A little variation so a crowd does not march in lockstep.
const SPEED_SPREAD = 0.2;

// Crossing the road is a few strides sideways, not a tile of walking: it takes
// this fraction of the time a tile does.
const CROSS_PACE = 2.5;

// The longest anybody stands at a kerb before going anyway. A backstop, not a
// behaviour: the tile is already claimed, so nothing new drives onto it, and
// this only matters if something contrives to sit on the crossing for ever. A
// pedestrian frozen at a kerb is a deadlock, and a deadlock is worse than a
// jaywalker.
const CROSS_WAIT_MAX = 8;

// The port of `from` that faces `to`, for two tiles sharing an edge.
function portToward(from: string, to: string): Port | null {
  const a = parseCoordId(from);
  const b = parseCoordId(to);
  if (b.x === a.x && b.y === a.y - 1) return Position.Top;
  if (b.x === a.x + 1 && b.y === a.y) return Position.Right;
  if (b.x === a.x && b.y === a.y + 1) return Position.Bottom;
  if (b.x === a.x - 1 && b.y === a.y) return Position.Left;
  return null;
}

export function createPedestrianSim(config: PedestrianSimConfig): PedestrianSim {
  const { level } = config;
  const baseSpeed = config.speed ?? 0.25;
  const roadBusy = config.roadBusy ?? (() => false);
  const rng = makeRng(config.seed ?? 1);

  const walkers = new Map<string, Walker>();
  let nextId = 1;

  // Where the pavement puts somebody at `t` across a tile: the SAME offset curve
  // the paint follows, from the sampler the cars use.
  function pavePoint(
    tileId: string,
    entry: Port,
    exit: Port,
    side: 1 | -1,
    t: number
  ): { x: number; y: number; headingDeg: number } {
    const { x, y } = parseCoordId(tileId);
    // Defensive: a tile entered and left by the same edge has no crossing to
    // follow. Treat it as a straight through so the walker still moves sanely.
    const to = exit === entry ? oppositePort(entry) : exit;
    // A side is fixed to the street; this offset is relative to the walker's
    // direction of travel. Walking the street back the other way flips it — see
    // `pavementOffsetFor`.
    const off = pavementOffsetFor(level[tileId], side, entry, to) / 100;
    const p = laneSegmentPointAt(entry, to, 1, off, off, t);
    return { x: x + p.x, y: y + p.y, headingDeg: p.tangentDeg };
  }

  function pointOf(step: WalkStep, t: number): { x: number; y: number; headingDeg: number } {
    if (step.kind === "along") {
      const tt = (step.tFrom as number) + ((step.tTo as number) - (step.tFrom as number)) * t;
      return pavePoint(step.tileId, step.entry as Port, step.exit as Port, step.side, tt);
    }
    if (step.kind === "cross") {
      const a = pavePoint(step.tileId, step.entry as Port, step.exit as Port, step.side, 0.5);
      const b = pavePoint(step.tileId, step.entry as Port, step.exit as Port, step.toSide as 1 | -1, 0.5);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        headingDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
    }
    const a = step.from as { x: number; y: number };
    const b = step.to as { x: number; y: number };
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      headingDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    };
  }

  // Turn a (tiles, sides) route plus its two plots into per-leg steps.
  //
  // The subtlety that got this wrong first time: a footway step's entry and exit
  // are the ROAD's ports, never the direction of the plot it came from. A house
  // south of an east-west street is reached by walking ALONG the street and
  // turning up the driveway — not by walking north across the carriageway. Take
  // the ports from the plot and the walker crosses the road to get to a pavement
  // that runs the other way, which is exactly the "steps onto the zebra and
  // comes back out of the middle of the street" this produced.
  //
  // A driveway meets the pavement at the MIDDLE of the tile (the access apron
  // runs from the plot centre to the shared edge, whose midpoint is t = 0.5), so
  // a tile that adjoins a plot is only half walked.
  function buildSteps(
    fromPlot: string,
    toPlot: string,
    tiles: string[],
    sides: (1 | -1)[]
  ): WalkStep[] | null {
    const steps: WalkStep[] = [];
    interface Run {
      tileId: string;
      sides: (1 | -1)[];
    }
    const runs: Run[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const last = runs[runs.length - 1];
      if (last && last.tileId === tiles[i]) last.sides.push(sides[i]);
      else runs.push({ tileId: tiles[i], sides: [sides[i]] });
    }

    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const { x, y } = parseCoordId(run.tileId);
      const prevTile = r > 0 ? runs[r - 1].tileId : null;
      const nextTile = r < runs.length - 1 ? runs[r + 1].tileId : null;

      // The ports the walker actually travels between on THIS tile's pavement.
      let entry = prevTile ? portToward(run.tileId, prevTile) : null;
      let exit = nextTile ? portToward(run.tileId, nextTile) : null;
      if (entry === null && exit === null) {
        // Neither neighbour is a pavement: the whole walk happens on this one
        // tile (across the road, or in and out of the same street). Follow the
        // road's own direction.
        const through = roadThrough(level[run.tileId]);
        if (!through) return null;
        entry = through.from;
        exit = through.to;
      } else if (entry === null) entry = oppositePort(exit as Port);
      else if (exit === null) exit = oppositePort(entry);

      // Half a tile where a driveway joins, a whole tile where the pavement runs on.
      const tStart = prevTile ? 0 : 0.5;
      const tEnd = nextTile ? 1 : 0.5;

      const along = (from: number, to: number, side: 1 | -1) => {
        if (from === to) return; // a zero-length leg is not a step
        steps.push({
          kind: "along",
          tileId: run.tileId,
          x,
          y,
          side,
          entry: entry as Port,
          exit: exit as Port,
          tFrom: from,
          tTo: to,
        });
      };

      if (run.sides.length === 1) {
        along(tStart, tEnd, run.sides[0]);
        continue;
      }
      // Crossed here: up to the zebra at the middle of the tile, over, and on.
      along(tStart, 0.5, run.sides[0]);
      for (let k = 1; k < run.sides.length; k++) {
        steps.push({
          kind: "cross",
          tileId: run.tileId,
          x,
          y,
          side: run.sides[k - 1],
          toSide: run.sides[k],
          entry: entry as Port,
          exit: exit as Port,
        });
      }
      along(0.5, tEnd, run.sides[run.sides.length - 1]);
    }
    if (steps.length === 0) return null;

    // The driveway stubs at each end aim at the pavement's own start/end point,
    // so the path meets the kerb exactly rather than stopping at the bare tile
    // edge and making the walker jump sideways at the seam.
    const head = parseCoordId(fromPlot);
    const tail = parseCoordId(toPlot);
    steps.unshift({
      kind: "stub",
      tileId: fromPlot,
      x: head.x,
      y: head.y,
      side: sides[0],
      from: { x: head.x + 0.5, y: head.y + 0.5 },
      to: pointOf(steps[0], 0),
    });
    steps.push({
      kind: "stub",
      tileId: toPlot,
      x: tail.x,
      y: tail.y,
      side: sides[sides.length - 1],
      from: pointOf(steps[steps.length - 1], 1),
      to: { x: tail.x + 0.5, y: tail.y + 0.5 },
    });
    return steps;
  }

  // Somebody AT a zebra: standing at its kerb about to step out, or on it. Both
  // claim the tile, which is what stops the traffic.
  //
  // The claim is deliberately no wider than that. Claiming a step EARLIER — from
  // the moment a walker starts the leg that ends at the crossing — was tried, to
  // give cars more warning; on a busy road with a town's worth of people using
  // one zebra it holds the tile almost continuously and the traffic never moves
  // again (measured: a 589-second queue). Cars brake for a closed tile from
  // wherever they are, so the kerb is early enough.
  function atCrossing(w: Walker): WalkStep | null {
    const here = w.steps[w.index];
    return here && here.kind === "cross" ? here : null;
  }

  const onCrossing = atCrossing;

  function isWaiting(w: Walker): boolean {
    const s = onCrossing(w);
    return (
      !!s && w.progress === 0 && w.waitedSec < CROSS_WAIT_MAX && roadBusy(s.tileId)
    );
  }

  return {
    request(fromPlot: string, toPlot: string): string | null {
      if (walkers.size >= MAX_WALKERS) return null;
      const route = planWalk(level, fromPlot, toPlot);
      if (!route || route.tiles.length === 0) return null;
      const steps = buildSteps(fromPlot, toPlot, route.tiles, route.sides);
      if (!steps) return null;
      const id = `walk${nextId++}`;
      walkers.set(id, {
        id,
        steps,
        index: 0,
        progress: 0,
        speed: baseSpeed * (1 - SPEED_SPREAD + rng() * 2 * SPEED_SPREAD),
        waitedSec: 0,
      });
      return id;
    },

    step(dt: number) {
      if (!(dt > 0)) return;
      for (const w of [...walkers.values()]) {
        // Held at the kerb. The tile is already claimed (see claimedCrossings),
        // so nothing new drives onto it; this waits for whatever was already
        // there to clear, which is what makes the wait terminate.
        if (isWaiting(w)) {
          w.waitedSec += dt;
          continue;
        }
        const cur = w.steps[w.index];
        w.progress += w.speed * dt * (cur.kind === "cross" ? CROSS_PACE : 1);
        while (w.progress >= 1) {
          w.progress -= 1;
          w.index += 1;
          if (w.index >= w.steps.length) {
            walkers.delete(w.id);
            break;
          }
          // Arriving at a zebra STOPS you at the kerb: progress snaps to 0
          // rather than carrying the remainder of the last stride over. Without
          // this a walker is essentially never at exactly 0 on the crossing
          // step, so `isWaiting` never fires and they stroll into the traffic.
          if (w.steps[w.index].kind === "cross") {
            w.progress = 0;
            w.waitedSec = 0;
            break;
          }
        }
      }
    },

    status(id: string) {
      return walkers.has(id) ? "walking" : "arrived";
    },

    release(id: string) {
      walkers.delete(id);
    },

    sample() {
      return [...walkers.values()].map(w => {
        const p = pointOf(w.steps[w.index], w.progress);
        return { id: w.id, x: p.x, y: p.y, headingDeg: p.headingDeg, waiting: isWaiting(w) };
      });
    },

    count: () => walkers.size,

    claimedCrossings() {
      const out = new Set<string>();
      for (const w of walkers.values()) {
        const s = atCrossing(w);
        if (s) out.add(s.tileId);
      }
      return [...out];
    },

    waitingCount() {
      let n = 0;
      for (const w of walkers.values()) if (isWaiting(w)) n += 1;
      return n;
    },
  };
}

// Re-exported so the game layer can ask which pavement a plot stands on without
// importing the tiles module twice.
export { sideOfPlot, hasFootway };
