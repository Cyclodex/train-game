import { TrainsDefinition, TrainStatus } from "@/types";
import { Level, parseCoordId } from "@/tiles/model";
import { TrainRoute } from "@/tiles/validate";

// A tiny cross-route hand-off + persistence for a player-built or generated
// level. The editor writes here (and to localStorage); the play view reads it.
export interface StoredLevel {
  level: Level;
  trains: TrainsDefinition;
}

const KEY = "train-game:custom-level";

let pending: StoredLevel | null = null;

export function setCustomLevel(stored: StoredLevel): void {
  pending = stored;
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // localStorage may be unavailable (private mode / SSR) — keep the in-memory
    // copy so the current session still works.
  }
}

export function takeCustomLevel(): StoredLevel | null {
  if (pending) return pending;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as StoredLevel;
  } catch {
    /* ignore */
  }
  return null;
}

export function clearCustomLevel(): void {
  pending = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// Build playable trains from generator routes: one train per route, starting in
// its `from` depot, alternating people/fraight with a couple of wagons.
export function trainsFromRoutes(routes: TrainRoute[]): TrainsDefinition {
  const trains: TrainsDefinition = {};
  routes.forEach((route, i) => {
    const { x, y } = parseCoordId(route.from);
    const type = i % 2 === 0 ? "people" : "fraight";
    const id = `train${i + 1}`;
    trains[id] = {
      id,
      x,
      y,
      status: TrainStatus.LeavingDepot,
      type,
      wagons: [
        { id: `${id}w1`, type },
        { id: `${id}w2`, type },
      ],
      routeDestinations: [{ to: route.to }],
      currentRouteDestination: 0,
    };
  });
  return trains;
}
