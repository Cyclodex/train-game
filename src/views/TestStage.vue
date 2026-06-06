<template>
  <div class="test-stage" :class="{ debug: config.debug }">
    <div class="stage-controls">
      <button class="stage-button" @click="config.debug = !config.debug">
        Debug
      </button>
      <button class="stage-button" @click="pausePlay">
        {{ paused ? "Start" : "Pause" }}
      </button>
      <button class="stage-button" @click="cycleSpeed">{{ speed }}x</button>
      <span class="stage-deliveries">
        Delivered {{ delivered }} / {{ totalTrains }}
      </span>
    </div>

    <div class="level" :style="{ width: cols * config.tileSize + 'px' }">
      <Train
        v-for="trainObject in trains"
        :key="trainObject.id"
        :train-object="trainObject"
      />
      <div
        v-for="cell in gridCells"
        :key="cell.key"
        class="level-tile"
        :style="{ width: config.tileSize + 'px', height: config.tileSize + 'px' }"
      >
        <Tile
          v-if="cell.tile"
          :tile="cell.tile"
          :coord-id="cell.key"
          class="tile-component"
        />
      </div>
      <div
        v-for="car in roadCars"
        :key="car.id"
        :class="['road-car', `road-car--${car.part}`]"
        :style="{
          background: carColor(car.id),
          width: `${car.widthPx}px`,
          transform: `translate(-50%, -50%) translate(${car.x}px, ${car.y}px) rotate(${car.angle}deg)`,
        }"
      >
        <span v-if="car.part !== 'trailer'" class="road-car-glass"></span>
      </div>
      <Crossing
        v-for="c in crossings"
        :key="`crossing-${c.key}`"
        :coord-id="c.key"
        :cell="c.cell"
      />
    </div>

    <div v-if="config.debug" class="event-log">
      <div class="event-log-title">Activity log</div>
      <ul class="event-log-list">
        <li v-if="recentLog.length === 0" class="event-log-empty">
          No events yet…
        </li>
        <li
          v-for="entry in recentLog"
          :key="entry.id"
          class="event-log-entry"
          :class="`log-${entry.kind}`"
        >
          <span class="log-time">{{ entry.time.toFixed(1) }}s</span>
          <span class="log-train" :style="{ color: trainColor(entry.trainId) }">
            {{ entry.trainId }}
          </span>
          <span class="log-text">{{ entry.text }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts">
import { markRaw } from "vue";
import { Component, Inject, Prop, Provide, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY, gameConfig } from "@/gameConfig";
import { TrainsDefinition } from "@/types";
import { Level, TileCell, isLevelCrossing } from "@/tiles/model";
import { createGame, Game, TrainDef } from "@/game";
import { TestScenario, scenarioGrid } from "@/levels/test/scenario";
import Crossing from "@/components/Crossing.vue";

function buildTrainDefs(trains: TrainsDefinition): TrainDef[] {
  return Object.values(trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
  }));
}

// Renders one scenario: it owns a fresh game and provides it (with markRaw, like
// PlayView). TestView keys this component on the scenario id, so switching
// scenarios destroys and recreates it — a clean teardown of the old game.
@Component({ components: { Crossing } })
class TestStage extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Prop({ required: true }) scenario!: TestScenario;
  speeds = [1, 2, 4];

  @Provide() trains: TrainsDefinition = this.scenario.trains;
  @Provide() level: Level = this.scenario.level;

  @Provide("game") game: Game = markRaw(
    createGame(
      this.scenario.level,
      buildTrainDefs(this.scenario.trains),
      gameConfig.tileSize,
      gameConfig.colorSeed,
      this.scenario.colors,
      this.scenario.traffic
    )
  );

  get cols(): number {
    return scenarioGrid(this.scenario).cols;
  }
  get rows(): number {
    return scenarioGrid(this.scenario).rows;
  }

  mounted() {
    this.game.start();
    (window as unknown as { __game?: Game }).__game = this.game;
  }
  beforeUnmount() {
    this.game.stop();
  }

  get gridCells(): { key: string; tile: TileCell | null }[] {
    const out: { key: string; tile: TileCell | null }[] = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const key = `${x},${y}`;
        out.push({ key, tile: this.level[key] ?? null });
      }
    }
    return out;
  }

  get crossings(): { key: string; cell: TileCell }[] {
    return Object.entries(this.level)
      .filter(([, cell]) => isLevelCrossing(cell))
      .map(([key, cell]) => ({ key, cell }));
  }

  // Live road-traffic cars, sampled to world positions by the game each frame —
  // the same source PlayView renders, so the /test world shows car spacing too.
  get roadCars() {
    return this.game.roadCars;
  }
  private carPalette = ["#d94c4c", "#3f7fd9", "#e0bc5c", "#e7e7e7", "#5fb37a"];
  // Stable colour per vehicle from the number in its base id (car0, car1, …). The
  // render id is `${carId}#${segment}`, so strip the segment suffix first — this
  // keeps a semi's cab and trailer in one livery.
  carColor(id: string): string {
    const base = id.split("#")[0];
    const n = parseInt(base.replace(/\D/g, ""), 10) || 0;
    return this.carPalette[n % this.carPalette.length];
  }

  get paused(): boolean {
    return this.game.paused.value;
  }
  get speed(): number {
    return this.game.speed.value;
  }
  get delivered(): number {
    return this.game.deliveries.value;
  }
  get totalTrains(): number {
    return Object.keys(this.trains).length;
  }
  get recentLog() {
    return this.game.eventLog.slice(-60).reverse();
  }
  trainColor(id: string): string {
    return this.game.trainColors[id] ?? "inherit";
  }

  pausePlay() {
    this.game.paused.value = !this.game.paused.value;
  }
  cycleSpeed() {
    const i = this.speeds.indexOf(this.game.speed.value);
    this.game.speed.value = this.speeds[(i + 1) % this.speeds.length];
  }
}

export default toNative(TestStage);
</script>

<style lang="scss" scoped>
.test-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.stage-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}
.stage-button {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: #2c3e50;
  color: #fff;
  cursor: pointer;

  &:hover {
    background: #34506a;
  }
}
.stage-deliveries {
  color: #8fa3b3;
  font-size: 13px;
  font-weight: 600;
}
.level {
  display: flex;
  border: 1px solid green;
  flex-wrap: wrap;
  position: relative;
}
.level-tile {
  position: relative;
  flex: 0 0 auto;
  .debug & {
    outline: 1px solid red;
  }
}
.road-car {
  position: absolute;
  z-index: 6; // above the road surface and trains; crossing booms sit above
  top: 0;
  left: 0;
  // width is set inline per vehicle segment (car/truck/cab/trailer lengths).
  height: 20px;
  border-radius: 4px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.45);
  will-change: transform;
  overflow: hidden;
}
// A semi's cab: a touch darker and boxier than the trailer it pulls.
.road-car--cab {
  filter: brightness(0.82);
  border-radius: 4px 3px 3px 4px;
}
// A semi's trailer: a long boxy container, squarer corners, no windscreen.
.road-car--trailer {
  border-radius: 2px;
  filter: brightness(1.05);
}
.road-car-glass {
  position: absolute;
  top: 20%;
  bottom: 20%;
  left: 60%; // toward the front (local +x is the direction of travel)
  width: 26%;
  background: rgba(185, 222, 255, 0.9);
  border-radius: 2px;
}
// A rigid truck's cab is only the front of its longer body, so its windscreen is
// a small pane right at the nose rather than a wide window like a car's.
.road-car--truck .road-car-glass {
  left: 76%;
  width: 13%;
}
.event-log {
  width: 320px;
  max-height: 40vh;
  overflow-y: auto;
  background: rgba(20, 24, 28, 0.92);
  color: #d7dde3;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  border-radius: 6px;
  padding: 6px 0;
}
.event-log-title {
  padding: 4px 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8fa3b3;
}
.event-log-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.event-log-empty {
  padding: 8px 10px;
  color: #6b7782;
  font-style: italic;
}
.event-log-entry {
  display: flex;
  gap: 6px;
  padding: 2px 10px;
  white-space: nowrap;
  border-left: 3px solid transparent;

  &.log-blocked {
    border-left-color: #e0564b;
  }
  &.log-proceeding {
    border-left-color: #4caf78;
  }
  &.log-reserved {
    border-left-color: #5b8dd6;
  }
  &.log-arrived {
    border-left-color: #d6b14c;
  }
}
.log-time {
  color: #6b7782;
  min-width: 38px;
}
.log-train {
  font-weight: 700;
}
</style>
