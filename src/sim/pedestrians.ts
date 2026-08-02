import type { Level } from "@/tiles/model";
import { parseCoordId } from "@/tiles/model";
import { makeRng } from "@/utils/globalHelpers";
import { pavementOffsets, planWalk } from "@/tiles/footway";

// PEOPLE ON THE PAVEMENT — the walking half of the citizen layer.
//
// Deliberately NOT part of the road simulation. A pedestrian has no following
// distance, claims no junction, and may stand in the same doorway as somebody
// else: every gate in `road.ts` exists to guarantee the opposite of all three.
// What they share with cars is the tile graph, and that is shared by walking it
// (`tiles/footway.ts`), not by pretending a pavement is a lane.
//
// So this is small on purpose: a route of tile ids, a distance along it, and a
// side of the street. Deterministic and seeded like every other module in
// `src/sim/`; positions come out in TILE units so a headless test can read them
// and the renderer only has to multiply.
//
// Design: docs/superpowers/specs/2026-08-01-citizens-and-cities-design.md §9.1

export interface Walker {
  id: string;
  route: string[]; // tile ids, origin plot → destination plot
  index: number; // which leg of the route
  progress: number; // 0..1 along that leg
  speed: number; // tiles/sec
  side: 1 | -1; // which pavement they keep to
}

// A walker sampled for drawing: where they are, in TILE units from the world
// origin, and which way they are facing.
export interface WalkerSample {
  id: string;
  x: number;
  y: number;
  headingDeg: number;
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
}

export interface PedestrianSimConfig {
  level: Level;
  seed?: number;
  // Tiles per second. Matches the citizen sim's `walkSpeed` so the person on
  // screen and the person in the model are the same speed — otherwise a walker
  // arrives visibly before or after their journey is scored.
  speed?: number;
}

// How many people may be on the pavements at once. Walkers are cheap (no
// following, no conflicts) but the DOM is not.
const MAX_WALKERS = 120;

// A little variation so a crowd does not march in lockstep.
const SPEED_SPREAD = 0.2;

export function createPedestrianSim(config: PedestrianSimConfig): PedestrianSim {
  const { level } = config;
  const baseSpeed = config.speed ?? 0.25;
  const rng = makeRng(config.seed ?? 1);

  const walkers = new Map<string, Walker>();
  const arrived = new Set<string>();
  let nextId = 1;

  // The centre of a tile, in tile units (a tile is 1 unit across, so the centre
  // of "3,2" is at 3.5, 2.5).
  function centre(id: string): { x: number; y: number } {
    const { x, y } = parseCoordId(id);
    return { x: x + 0.5, y: y + 0.5 };
  }

  // Where a walker stands on a leg: along the line between two tile centres,
  // pushed sideways onto the pavement.
  //
  // The offset is taken from the tile they are ON, so a walk that turns off a
  // wide road onto a narrow one steps in as the carriageway narrows, instead of
  // walking down the middle of the smaller street.
  function positionOn(w: Walker): WalkerSample {
    const a = centre(w.route[w.index]);
    const b = centre(w.route[w.index + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Right-hand perpendicular in screen space (y down).
    const nx = -dy / len;
    const ny = dx / len;
    // Pavement offset in TILE units (the geometry is in 0..100 ground units).
    const onTile = w.progress < 0.5 ? w.route[w.index] : w.route[w.index + 1];
    const off = (pavementOffsets(level[onTile])[0] / 100) * w.side;
    return {
      id: w.id,
      x: a.x + dx * w.progress + nx * off,
      y: a.y + dy * w.progress + ny * off,
      headingDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  }

  return {
    request(fromPlot: string, toPlot: string): string | null {
      if (walkers.size >= MAX_WALKERS) return null;
      const route = planWalk(level, fromPlot, toPlot);
      if (!route || route.length < 2) return null;
      const id = `walk${nextId++}`;
      walkers.set(id, {
        id,
        route,
        index: 0,
        progress: 0,
        speed: baseSpeed * (1 - SPEED_SPREAD + rng() * 2 * SPEED_SPREAD),
        // Which pavement. Seeded rather than derived from the direction of
        // travel, so both sides of a street are used and the board does not read
        // as a one-way conveyor of people.
        side: rng() < 0.5 ? 1 : -1,
      });
      return id;
    },

    step(dt: number) {
      if (!(dt > 0)) return;
      for (const w of [...walkers.values()]) {
        // Each leg is one tile of ground, so progress is simply speed × time.
        w.progress += w.speed * dt;
        while (w.progress >= 1) {
          w.progress -= 1;
          w.index += 1;
          if (w.index >= w.route.length - 1) {
            walkers.delete(w.id);
            arrived.add(w.id);
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
      arrived.delete(id);
    },

    sample() {
      return [...walkers.values()].map(positionOn);
    },

    count: () => walkers.size,
  };
}
