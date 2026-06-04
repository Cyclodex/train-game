import { reactive } from "vue";

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
}

export const GAME_CONFIG_KEY = "gameConfig";

export const gameConfig: GameConfig = reactive({
  tileSize: 200,
  levelSizeX: 7,
  debug: true,
  automaticTrafficLights: true,
  automaticRoutePlanning: false,
  railDistanceFromPath: 7,
});
