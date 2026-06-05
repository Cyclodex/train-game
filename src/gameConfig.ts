import { reactive } from "vue";

// Switch-lock interlocking levels:
// - "off":      switches always throwable; the sim re-plans the affected train's
//               route on the next tick (forgiving "sandbox" behaviour).
// - "reserved": a switch can't be thrown while its tile is reserved OR occupied
//               by a train — strict interlocking, never moves points ahead of a
//               committed move.
// - "occupied": a switch is only locked while a train is physically ON the tile;
//               reserved-but-not-yet-occupied switches stay throwable.
export type SwitchLockMode = "off" | "reserved" | "occupied";

// Global, reactive game configuration. Provided once at the app level (see
// main.ts) and injected into components as `config`. Replaces the Vue 2 pattern
// of stashing these values on the root component's `data` and reading them via
// `this.$root.*`.
export interface GameConfig {
  tileSize: number;
  levelSizeX: number;
  debug: boolean;
  automaticTrafficLights: boolean;
  automaticRoutePlanning: boolean;
  railDistanceFromPath: number;
  switchLockMode: SwitchLockMode;
  // Seed for deterministic depot/train colour assignment (see colorAssignment.ts).
  colorSeed: number;
  // Road layer: simulate + render roads and cars at all. Off keeps the game
  // rail-only (current behaviour). Level crossings only matter when this is on.
  roads: boolean;
  // Optional, toggleable scoring layer over road traffic (throughput / wait
  // time at crossings). Independent of `roads` rendering; a game mode can enable
  // the road world without scoring it.
  roadScoring: boolean;
}

export const GAME_CONFIG_KEY = "gameConfig";

export const gameConfig: GameConfig = reactive({
  tileSize: 200,
  levelSizeX: 7,
  debug: true,
  automaticTrafficLights: true,
  automaticRoutePlanning: false,
  railDistanceFromPath: 7,
  switchLockMode: "off",
  colorSeed: 1,
  roads: true,
  roadScoring: false,
});
