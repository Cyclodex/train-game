import { reactive } from "vue";
import {
  DEFAULT_THEME,
  isWorldTheme,
  WorldTheme,
} from "./themes";

const THEME_KEY = "train-game:worldTheme";
const SOUND_KEY = "train-game:soundMuted";

// The persisted mute state. Absent (the default) means sound ON — audio is the
// feature, muting it is the opt-out.
function loadSoundMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

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
  // Half the rail gauge, in px: how far either rail sits from the track
  // centreline (the sleeper band's middle). Set from the real proportion —
  // see the default below.
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
  // Debug aid: strip the themed world backdrop (meadow trees / table grain) and
  // the board's drop-shadow framing for a flat neutral ground, so tile geometry
  // (lane markings, gores, kerbs) reads clearly while debugging. Not persisted.
  plainBackdrop: boolean;
  // Master mute for the game's sound layer (src/audio/). Persisted via
  // `setSoundMuted`, like the world theme. The audio engine reads this live, so
  // toggling it silences (or restores) everything at once, including the
  // ambient rolling loop.
  soundMuted: boolean;
}

export const GAME_CONFIG_KEY = "gameConfig";

export const gameConfig: GameConfig = reactive({
  tileSize: 200,
  levelSizeX: 7,
  debug: false,
  automaticTrafficLights: true,
  automaticRoutePlanning: false,
  // The sleeper band is 20px wide (TileRail.vue's stroke-width), so a sleeper
  // reaches 10px either side of the centreline. Real standard-gauge track puts
  // the rails at 1435mm on a 2600mm sleeper — 55% of its half-length — which is
  // 10 × 0.55 = 5.5px here. It was 7px (70%), which left barely a 3px sleeper
  // end beyond the rail and read as the track sitting on the sleeper tips.
  railDistanceFromPath: 5.5,
  switchLockMode: "off",
  colorSeed: 1,
  roads: true,
  roadScoring: false,
  maxCars: 5, // % of map capacity — a quiet default (few cars on screen)
  worldTheme: loadWorldTheme(),
  plainBackdrop: false,
  soundMuted: loadSoundMuted(),
});

// Set + persist the mute state. Views call this from the drawer's 🔊 button.
export function setSoundMuted(muted: boolean): void {
  gameConfig.soundMuted = muted;
  try {
    if (muted) localStorage.setItem(SOUND_KEY, "1");
    else localStorage.removeItem(SOUND_KEY);
  } catch {
    /* ignore */
  }
}

// Set + persist the world theme. Views call this from the drawer's 🎨 button.
export function setWorldTheme(theme: WorldTheme): void {
  gameConfig.worldTheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}
