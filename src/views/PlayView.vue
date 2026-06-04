<template>
  <div class="play-view" :class="{ debug: config.debug }">
    <div class="control-buttons">
      <router-link class="nav-link" to="/editor">Editor</router-link>
      <button class="debug-button" @click="switchDebugMode">Debug Mode</button>
      <button class="timeline-button" @click="pausePlayGame">
        {{ paused ? "Start" : "Pause" }}
      </button>
      <button class="timeline-button" @click="changeGlobalTimeScale">
        {{ globalTimeScale }} x Speed
      </button>
      <button class="timeline-button" @click="cycleSwitchLock">
        Switch lock: {{ switchLockLabel }}
      </button>
      <div class="delivered-count">Delivered: {{ delivered }}</div>
    </div>
    <div
      class="level"
      :style="{ width: config.tileSize * config.levelSizeX + 'px' }"
    >
      <Train
        v-for="trainObject in trains"
        :key="trainObject.id"
        :train-object="trainObject"
      />
      <div
        v-for="cell in gridCells"
        :key="cell.key"
        class="level-tile"
        :style="{
          width: config.tileSize + 'px',
          height: config.tileSize + 'px',
        }"
      >
        <Tile
          v-if="cell.tile"
          :tile="cell.tile"
          :coord-id="cell.key"
          class="tile-component"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { markRaw } from "vue";
import { Component, Inject, Provide, Vue, toNative } from "vue-facing-decorator";
import {
  GameConfig,
  GAME_CONFIG_KEY,
  gameConfig,
  SwitchLockMode,
} from "@/gameConfig";
import { TrainsDefinition } from "@/types";
import { Level } from "@/tiles/model";
import { createGame, Game, TrainDef } from "@/game";
import { DEFAULT_LEVEL, defaultTrains } from "@/levels/default";
import { takeCustomLevel } from "@/levelStore";

function buildTrainDefs(trains: TrainsDefinition): TrainDef[] {
  return Object.values(trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
  }));
}

@Component
class PlayView extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  speeds = [1, 2, 4];
  levelSizeY = 6;

  // Read per instance (not at module load) so a level built in the editor and
  // handed over right before navigation is picked up on this mount.
  private custom = takeCustomLevel();

  @Provide() trains: TrainsDefinition = this.custom
    ? this.custom.trains
    : defaultTrains();

  @Provide() level: Level = this.custom ? this.custom.level : DEFAULT_LEVEL;

  @Provide("game") game: Game = markRaw(
    createGame(
      this.level,
      buildTrainDefs(this.trains),
      gameConfig.tileSize,
      gameConfig.colorSeed
    )
  );

  mounted() {
    this.game.start();
    // Test hook: expose the live game so e2e can read simulation state without
    // depending on Vue's internal instance shape.
    (window as unknown as { __game?: Game }).__game = this.game;
  }

  beforeUnmount() {
    this.game.stop();
  }

  get gridCells(): { key: string; tile: Level[string] | null }[] {
    const out: { key: string; tile: Level[string] | null }[] = [];
    for (let y = 0; y < this.levelSizeY; y++) {
      for (let x = 0; x < this.config.levelSizeX; x++) {
        const key = `${x},${y}`;
        out.push({ key, tile: this.level[key] ?? null });
      }
    }
    return out;
  }

  get paused(): boolean {
    return this.game.paused.value;
  }
  get globalTimeScale(): number {
    return this.game.speed.value;
  }
  get delivered(): number {
    return this.game.deliveries.value;
  }
  switchDebugMode() {
    this.config.debug = !this.config.debug;
  }
  cycleSwitchLock() {
    const order: SwitchLockMode[] = ["off", "reserved", "occupied"];
    const next = (order.indexOf(this.config.switchLockMode) + 1) % order.length;
    this.config.switchLockMode = order[next];
  }
  get switchLockLabel(): string {
    switch (this.config.switchLockMode) {
      case "reserved":
        return "reserved";
      case "occupied":
        return "on train";
      default:
        return "off";
    }
  }
  pausePlayGame() {
    this.game.paused.value = !this.game.paused.value;
  }
  changeGlobalTimeScale() {
    const currentIndex = this.speeds.indexOf(this.game.speed.value);
    this.game.speed.value =
      this.speeds[(currentIndex + 1) % this.speeds.length];
  }
}

export default toNative(PlayView);
</script>

<style lang="scss" scoped>
.level {
  display: flex;
  border: 1px solid green;
  flex-wrap: wrap;
  margin: 0 auto;
  position: relative;
}
.level-tile {
  position: relative;
  flex: 0 0 auto;
  .debug & {
    outline: 1px solid red;
  }
}
.control-buttons {
  position: fixed;
  z-index: 100;
  top: 0;
  left: 0;

  > button,
  > .nav-link {
    display: block;
    padding: 15px;
    min-width: 150px;
    box-sizing: border-box;
  }
  > .nav-link {
    background: #2c3e50;
    color: white;
    text-decoration: none;
  }
}
</style>
