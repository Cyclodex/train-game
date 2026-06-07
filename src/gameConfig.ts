import { reactive } from "vue";
import {
  DEFAULT_THEME,
  isWorldTheme,
  WorldTheme,
} from "./themes";

const THEME_KEY = "train-game:worldTheme";

// The persisted world theme, falling back to the default when storage is
// unavailable or holds an unknown id.
function loadWorldTheme(): WorldTheme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (isWorldTheme(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

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
  // Road-traffic density as a percentage (0–100) of what the current map's roads
  // can physically hold: 0 = no cars, 100 = streets packed bumper-to-bumper. The
  // game scales this against the level's capacity (see roadCarCapacity in
  // game.ts), so the same setting fills a tiny test road and the full board
  // proportionally. Read live, so dragging the slider re-targets density at once
  // (raising it spawns more cars fast; lowering it stops new spawns until the
  // population falls under the new target — it doesn't despawn cars already
  // driving). 0 means no traffic at all.
  maxCars: number;
  // The world backdrop theme (see src/themes.ts). Applied as a `theme-<id>`
  // class on #app; persisted via `setWorldTheme`.
  worldTheme: WorldTheme;
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
  maxCars: 5, // % of map capacity — a quiet default (few cars on screen)
  worldTheme: loadWorldTheme(),
});

// Set + persist the world theme. Views call this from the drawer's 🎨 button.
export function setWorldTheme(theme: WorldTheme): void {
  gameConfig.worldTheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}
