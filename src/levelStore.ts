import { TrainsDefinition, TrainStatus } from "@/types";
import { Level, parseCoordId } from "@/tiles/model";
import { TrainRoute } from "@/tiles/validate";
import { fromPairs } from "@/tiles/lanes";
import type { Lane } from "@/tiles/lanes";

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

// Migrate a level's road tiles from the old PortPair[][] format to Lane[].
// Old format: road = [[0, 1], [1, 0]] (array of 2-element number arrays)
// New format: road = [{ from, to[], index }, ...]
// Safe to call on already-migrated levels: the check is a no-op.
export function migrateLevel(level: Level): Level {
  const out: Level = {};
  for (const [id, tile] of Object.entries(level)) {
    const road = tile.road;
    if (road && road.length > 0 && Array.isArray(road[0])) {
      out[id] = { ...tile, road: fromPairs(road as unknown as [number, number][]) as Lane[] };
    } else {
      out[id] = tile;
    }
  }
  return out;
}

export function takeCustomLevel(): StoredLevel | null {
  if (pending) return pending;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as StoredLevel;
      return { ...stored, level: migrateLevel(stored.level) };
    }
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
