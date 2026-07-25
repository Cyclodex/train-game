<template>
  <div class="test-stage" :class="{ debug: config.debug }">
    <div class="stage-controls">
      <button class="stage-button" @click="config.debug = !config.debug">
        Debug
      </button>
      <button
        class="stage-button"
        title="Hide the meadow backdrop for a flat neutral ground — makes lane markings, gores and kerbs easy to read while debugging geometry"
        @click="config.plainBackdrop = !config.plainBackdrop"
      >
        {{ config.plainBackdrop ? "🌳 BG off" : "🌳 BG on" }}
      </button>
      <button class="stage-button" @click="pausePlay">
        {{ paused ? "Start" : "Pause" }}
      </button>
      <button class="stage-button" @click="cycleSpeed">{{ speed }}x</button>
      <button
        class="stage-button stage-button--edit"
        title="Open this map in the editor to correct it, then Export the JSON back into the scenario file"
        @click="editInEditor"
      >
        ✏️ Edit
      </button>
      <label class="stage-cars">
        🚗 Cars
        <input
          class="stage-cars-range"
          type="range"
          min="0"
          max="100"
          step="1"
          v-model.number="config.maxCars"
        />
        <span class="stage-cars-val">{{ config.maxCars === 0 ? "off" : config.maxCars + "%" }}</span>
      </label>
      <span class="stage-deliveries">
        Delivered {{ delivered }} / {{ totalTrains }}
      </span>
    </div>

    <div
      ref="viewport"
      class="stage-viewport"
      :class="{ 'stage-viewport--panning': panning }"
      @pointerdown="onViewportPointerDown"
      @pointermove="onViewportPointerMove"
      @pointerup="onViewportPointerUp"
      @pointercancel="onViewportPointerUp"
      @wheel.prevent="onViewportWheel"
    >
    <div class="world-zoom" v-if="worldOverflows">
      <button class="zoom-btn" title="Zoom out" @click.stop="zoomBy(1 / 1.25)">−</button>
      <button class="zoom-btn zoom-btn--fit" title="Fit the whole world" @click.stop="fitWorld()">
        {{ Math.round(camera.zoom * 100) }}%
      </button>
      <button class="zoom-btn" title="Zoom in" @click.stop="zoomBy(1.25)">+</button>
    </div>
    <div
      class="level"
      :style="{
        gridTemplateColumns: `repeat(${cols}, ${config.tileSize}px)`,
        width: cols * config.tileSize + 'px',
        transform: levelTransform,
      }"
      @click="onBackgroundClick"
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
        :class="['road-car', `road-car--${car.part}`, { 'road-car--inspect': config.debug }]"
        :style="{
          background: carColor(car.id),
          width: `${car.widthPx}px`,
          transform: `translate(-50%, -50%) translate(${car.x}px, ${car.y}px) rotate(${car.angle}deg)`,
        }"
        @mouseenter="onCarEnter(car.id)"
        @mouseleave="onCarLeave()"
        @click.stop="onCarClick(car.id)"
      >
        <span v-if="car.part !== 'trailer'" class="road-car-glass"></span>
        <span
          v-if="config.debug && car.part !== 'trailer'"
          class="road-car-id"
          :style="{ transform: `translate(-50%, -50%) rotate(${-car.angle}deg)` }"
        >{{ car.id }}</span>
      </div>
      <CarRouteOverlay
        v-if="config.debug && carRoute"
        :segments="carRoute.segments"
        :color="carColor(carRoute.carId)"
      />
      <Crossing
        v-for="c in crossings"
        :key="`crossing-${c.key}`"
        :coord-id="c.key"
        :cell="c.cell"
      />
    </div>
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
import { sandboxMode } from "@/modes/sandbox";
import { modeById } from "@/modes/index";
import { TestScenario, scenarioGrid } from "@/levels/test/scenario";
import { setEditorSeed } from "@/editorSeed";
import Crossing from "@/components/Crossing.vue";
import { type Camera, type Size } from "@/camera";
import { createCameraController, type CameraController } from "@/cameraController";

function buildTrainDefs(trains: TrainsDefinition): TrainDef[] {
  return Object.values(trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
    spawnAtSec: t.spawnAtSec,
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

  // A scenario can name a mode (e.g. Time Attack for its scheduled spawner);
  // otherwise demos run in free-play Sandbox.
  private mode = this.scenario.modeId
    ? modeById(this.scenario.modeId)
    : sandboxMode;

  @Provide("game") game: Game = markRaw(
    createGame(
      this.scenario.level,
      buildTrainDefs(this.scenario.trains),
      gameConfig.tileSize,
      this.mode,
      gameConfig.colorSeed,
      this.scenario.colors,
      this.scenario.traffic,
      `test:${this.scenario.id}`,
      // Live car cap from the shared "Cars" setting — drag the slider to change
      // density in any scenario (overrides the scenario's pinned maxCars).
      () => gameConfig.maxCars
    )
  );

  // --- Camera ---------------------------------------------------------------
  // Same behaviour as the play board (shared controller): a scenario bigger than
  // the window — the demo world is 4000x2800px — is panned and zoomed rather than
  // clipped by the page.
  // Built in `created()`, NOT as a field initialiser: a field initialiser runs
  // while vue-facing-decorator is collecting data off a throwaway instance, so
  // the closures below would capture THAT `this` — one whose injected `config` is
  // still undefined. The first render calls `overflows` → `worldSize()` and dies
  // on it. `created()` runs on the real instance, before the first render.
  //
  // markRaw: a plain controller in component state must not be deep-proxied
  // (CLAUDE.md). Its own `state` is `reactive()`, so the camera still drives
  // re-renders.
  private cam!: CameraController;

  created() {
    this.cam = markRaw(
      createCameraController(
        () => this.worldSize,
        () => this.viewportSize,
      ),
    );
  }

  get camera(): Camera {
    return this.cam.state.camera;
  }
  get panning(): boolean {
    return this.cam.state.panning;
  }
  get levelTransform(): string {
    return this.cam.transform;
  }
  get worldOverflows(): boolean {
    return this.cam.overflows;
  }

  get worldSize(): Size {
    return {
      width: this.cols * this.config.tileSize,
      height: this.rows * this.config.tileSize,
    };
  }

  get viewportSize(): Size {
    const el = this.$refs.viewport as HTMLElement | undefined;
    return el
      ? { width: el.clientWidth, height: el.clientHeight }
      : { width: window.innerWidth, height: window.innerHeight };
  }

  fitWorld(): void {
    this.cam.fit();
  }
  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
  }
  onViewportWheel(e: WheelEvent): void {
    this.cam.onWheel(e, this.$refs.viewport as HTMLElement | undefined);
  }
  onViewportPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return; // left drag pans the board
    this.cam.onPointerDown(e);
  }
  onViewportPointerMove(e: PointerEvent): void {
    this.cam.onPointerMove(e);
  }
  onViewportPointerUp(e: PointerEvent): void {
    this.cam.onPointerUp(e);
  }

  get cols(): number {
    return scenarioGrid(this.scenario).cols;
  }
  get rows(): number {
    return scenarioGrid(this.scenario).rows;
  }

  mounted() {
    // Frame the board before the first paint: a scenario larger than the window
    // would otherwise open on its top-left corner and read as a broken map.
    this.$nextTick(() => this.fitWorld());
    window.addEventListener("resize", this.onWindowResize);
    this.game.start();
    // The test world has no start overlay, so drive the objective to Playing
    // immediately — this is what lets mode mechanics that only run while live
    // (e.g. Time Attack's scheduled spawner) actually fire.
    this.game.startObjective();
    (window as unknown as { __game?: Game }).__game = this.game;
  }
  beforeUnmount() {
    this.game.stop();
    window.removeEventListener("resize", this.onWindowResize);
  }

  onWindowResize(): void {
    this.cam.reclamp();
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

  // The hovered/pinned car's route for the debug overlay (null when none).
  get carRoute() {
    return this.game.carRoute.value;
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

  // Debug route inspection: hover previews a car's route, click pins it (click
  // again or click empty space to unpin). No-op unless the debug overlay is on.
  private baseCarId(id: string): string {
    return id.split("#")[0];
  }
  onCarEnter(id: string): void {
    if (this.config.debug) this.game.setHoveredCar(this.baseCarId(id));
  }
  onCarLeave(): void {
    if (this.config.debug) this.game.clearHoveredCar();
  }
  onCarClick(id: string): void {
    if (this.config.debug) this.game.togglePinnedCar(this.baseCarId(id));
  }
  onBackgroundClick(): void {
    if (this.config.debug) this.game.clearRouteCar();
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
  // Hand this scenario's map off to the editor for manual correction. Scenarios
  // live in source, so there's no auto-write-back: fix the map with the real
  // tools, then Export the JSON and paste it into scenarios/<id>.ts.
  editInEditor() {
    setEditorSeed(this.scenario.level);
    this.$router.push("/editor");
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
  // A column: controls on top, then the camera viewport taking the rest. The
  // board can be far bigger than the window (the demo world is 4000x2800px), so
  // the viewport clips and the camera moves the board inside it.
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  gap: 16px;
}
.stage-viewport {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  // The board is dragged to pan; without this the browser's own touch scrolling
  // and text selection race the pointer handlers.
  touch-action: none;
  cursor: grab;

  &--panning {
    cursor: grabbing;
    user-select: none;
  }
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
.stage-button--edit {
  background: #3a6b4f;

  &:hover {
    background: #468060;
  }
}
.stage-cars {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #cfd8e0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.stage-cars-range {
  width: 130px;
  accent-color: #5fd39a;
  cursor: pointer;
}
.stage-cars-val {
  min-width: 1.8em;
  color: #8fa3b3;
}
.stage-deliveries {
  color: #8fa3b3;
  font-size: 13px;
  font-weight: 600;
}
.level {
  display: grid;
  border: 1px solid green;
  // Positioned by the camera inside `.stage-viewport`; the camera owns the offset
  // (it centres a board smaller than the window itself) and `transform-origin`
  // must be the corner its `scale() translate()` maths is expressed from.
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
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
// In debug mode cars are clickable to inspect their route.
/* Debug: the car id pinned to the sprite (counter-rotated so it stays
   readable whatever way the car points). Identifies the cars the junction
   owner / hold chips talk about. */
.road-car-id {
  position: absolute;
  left: 50%;
  top: 50%;
  font-size: 8px;
  line-height: 1;
  font-weight: 700;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 3px;
  padding: 1px 2px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 7;
}
.road-car--inspect {
  cursor: pointer;
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
// A bus: a long, slightly taller coach with a row of side windows running nearly
// its whole length, so it reads as a passenger bus rather than a cargo truck.
.road-car--bus {
  height: 24px;
  border-radius: 6px;
  filter: brightness(1.08);
}
.road-car--bus .road-car-glass {
  top: 22%;
  bottom: 48%;
  left: 10%;
  width: 80%;
  border-radius: 2px;
  background: repeating-linear-gradient(
    90deg,
    rgba(185, 222, 255, 0.95) 0,
    rgba(185, 222, 255, 0.95) 7px,
    rgba(30, 44, 60, 0.55) 7px,
    rgba(30, 44, 60, 0.55) 10px
  );
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
