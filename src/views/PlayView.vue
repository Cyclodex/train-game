<template>
  <div class="play-view" :class="{ debug: config.debug }">
    <div class="control-buttons">
      <router-link class="nav-link" to="/editor">Editor</router-link>
      <router-link class="nav-link" to="/test">Test world</router-link>
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
    </div>
    <div
      class="score-card"
      :class="{
        'score-card--pulse': pulsing,
        'score-card--complete': levelComplete,
      }"
    >
      <div class="score-head">
        <span class="score-icon">🚆</span>
        <span class="score-label">Deliveries</span>
        <span class="score-count">
          <span class="score-now">{{ delivered }}</span>
          <span class="score-sep">/</span>
          <span class="score-total">{{ totalTrains }}</span>
          <span v-if="levelComplete" class="score-check">✓</span>
        </span>
      </div>
      <div class="score-bar">
        <div class="score-bar-fill" :style="{ width: deliveredPct + '%' }"></div>
        <span class="score-pct">{{ deliveredPct }}%</span>
      </div>
      <div v-if="hud.timer" class="score-timer">⏱ {{ elapsedLabel }}</div>
      <div v-if="hud.stars" class="score-stars">
        <span
          v-for="s in stars"
          :key="s.id"
          class="star-pip"
          :class="{ 'star-pip--on': s.earned }"
          :title="s.label"
          >★</span
        >
      </div>
      <transition name="score-banner">
        <div v-if="levelComplete" class="score-complete-banner">
          ★ Level Complete ★
        </div>
      </transition>
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
      <div
        v-for="car in roadCars"
        :key="car.id"
        class="road-car"
        :style="{
          background: carColor(car.id),
          transform: `translate(-50%, -50%) translate(${car.x}px, ${car.y}px) rotate(${car.angle}deg)`,
        }"
      >
        <span class="road-car-glass"></span>
      </div>
      <Crossing
        v-for="c in crossings"
        :key="`crossing-${c.key}`"
        :coord-id="c.key"
        :cell="c.cell"
      />
    </div>
    <div v-if="hud.startOverlay && phase === 'ready'" class="game-overlay">
      <div class="overlay-card">
        <h2 class="overlay-title">{{ game.mode.label }}</h2>
        <p class="overlay-desc">{{ game.mode.description }}</p>
        <p v-if="best" class="overlay-best">
          Best: {{ best.stars }}★ · {{ best.timeSec.toFixed(1) }}s
        </p>
        <button class="overlay-btn" @click="startPlaying">Start</button>
      </div>
    </div>
    <div
      v-if="hud.endOverlay && (phase === 'won' || phase === 'lost')"
      class="game-overlay"
    >
      <div class="overlay-card">
        <h2 class="overlay-title">
          {{ phase === "won" ? "You win!" : "Failed" }}
        </h2>
        <div v-if="phase === 'won' && hud.stars" class="overlay-stars">
          <span
            v-for="s in stars"
            :key="s.id"
            class="star-pip star-pip--lg"
            :class="{ 'star-pip--on': s.earned }"
            :title="s.label"
            >★</span
          >
        </div>
        <p v-if="phase === 'won'" class="overlay-desc">
          {{ earnedStars }}/{{ stars.length }} stars · {{ elapsedLabel }}
        </p>
        <p v-else class="overlay-desc">{{ lostReason }}</p>
        <button class="overlay-btn" @click="retry">Retry</button>
      </div>
    </div>
    <div
      v-if="config.debug"
      class="event-log"
      :class="{ 'event-log--min': logMinimized }"
    >
      <div class="event-log-header">
        <span class="event-log-title">Activity log</span>
        <button
          class="event-log-toggle"
          :title="logMinimized ? 'Expand' : 'Minimize'"
          @click="logMinimized = !logMinimized"
        >
          {{ logMinimized ? "+" : "–" }}
        </button>
      </div>
      <ul v-show="!logMinimized" class="event-log-list">
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
import {
  Component,
  Inject,
  Provide,
  Vue,
  Watch,
  toNative,
} from "vue-facing-decorator";
import {
  GameConfig,
  GAME_CONFIG_KEY,
  gameConfig,
  SwitchLockMode,
} from "@/gameConfig";
import { TrainsDefinition } from "@/types";
import { Level, TileCell, isLevelCrossing } from "@/tiles/model";
import { createGame, Game, TrainDef } from "@/game";
import { DEFAULT_LEVEL, defaultTrains } from "@/levels/default";
import { takeCustomLevel } from "@/levelStore";
import { modeById } from "@/modes/index";
import { loadBest, recordResult, BestResult } from "@/objectiveStore";
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

// Hash history puts the route in location.hash, e.g. "#/play?mode=puzzle".
function modeIdFromUrl(): string | null {
  const hash = window.location.hash;
  const q = hash.indexOf("?");
  if (q === -1) return null;
  return new URLSearchParams(hash.slice(q + 1)).get("mode");
}

@Component({ components: { Crossing } })
class PlayView extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  speeds = [1, 2, 4];
  levelSizeY = 6;
  // Whether the debug activity-log panel is collapsed to just its header.
  logMinimized = false;

  // Read per instance (not at module load) so a level built in the editor and
  // handed over right before navigation is picked up on this mount.
  private custom = takeCustomLevel();

  @Provide() trains: TrainsDefinition = this.custom
    ? this.custom.trains
    : defaultTrains();

  @Provide() level: Level = this.custom ? this.custom.level : DEFAULT_LEVEL;

  private mode = modeById(modeIdFromUrl());
  private levelId = this.custom ? "custom" : "default";
  best: BestResult | null = null;

  @Provide("game") game: Game = markRaw(
    createGame(
      this.level,
      buildTrainDefs(this.trains),
      gameConfig.tileSize,
      this.mode,
      gameConfig.colorSeed,
      undefined,
      this.levelId
    )
  );

  mounted() {
    this.best = loadBest(this.levelId);
    this.game.start(); // start the rAF loop (rendering); objective stays Ready
    if (!this.game.mode.hud.startOverlay) this.game.startObjective();
    // Test hook: expose the live game so e2e can read simulation state without
    // depending on Vue's internal instance shape.
    (window as unknown as { __game?: Game }).__game = this.game;
  }

  startPlaying() {
    this.game.startObjective();
  }

  retry() {
    this.game.reset();
    this.game.startObjective();
  }

  @Watch("phase")
  onPhase(now: string) {
    if (now === "won") {
      const earned = this.game.objective.stars.filter(s => s.earned).length;
      this.best = recordResult(this.levelId, {
        stars: earned,
        timeSec: this.game.objective.counters.elapsedSec,
      });
    }
  }

  get phase(): string {
    return this.game.objective.phase;
  }
  get hud() {
    return this.game.mode.hud;
  }
  get stars() {
    return this.game.objective.stars;
  }
  get elapsedLabel(): string {
    const t =
      this.game.objective.timeLeftSec ??
      this.game.objective.counters.elapsedSec;
    return t.toFixed(1) + "s";
  }
  get earnedStars(): number {
    return this.stars.filter(s => s.earned).length;
  }
  get lostReason(): string {
    return this.game.objective.lostReason ?? "";
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

  // Level-crossing cells (rail + road on the same tile) — overlaid with the
  // crossing furniture + cars. Derived from the shared `road?` seam.
  get crossings(): { key: string; cell: TileCell }[] {
    return Object.entries(this.level)
      .filter(([, cell]) => isLevelCrossing(cell))
      .map(([key, cell]) => ({ key, cell }));
  }

  // Live road-traffic cars, sampled to world positions by the game each frame.
  get roadCars() {
    return this.game.roadCars;
  }

  private carPalette = ["#d94c4c", "#3f7fd9", "#e0bc5c", "#e7e7e7", "#5fb37a"];
  // Stable colour per car from the trailing number in its id (car0, car1, …).
  carColor(id: string): string {
    const n = parseInt(id.replace(/\D/g, ""), 10) || 0;
    return this.carPalette[n % this.carPalette.length];
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

  // Total trains in the level — the delivery goal, since each train parks once
  // it reaches its matching depot (so "all trains home" completes the level).
  get totalTrains(): number {
    return Object.keys(this.trains).length;
  }

  get deliveredPct(): number {
    return this.totalTrains
      ? Math.round((this.delivered / this.totalTrains) * 100)
      : 0;
  }

  get levelComplete(): boolean {
    return this.totalTrains > 0 && this.delivered >= this.totalTrains;
  }

  // Pop/glow the score card briefly whenever a new delivery lands.
  pulsing = false;
  private pulseTimer = 0;

  @Watch("delivered")
  onDelivered(now: number, prev: number) {
    if (now <= prev) return;
    // Restart the animation even on back-to-back deliveries: clear, then re-set
    // on the next frame so the CSS keyframes replay.
    this.pulsing = false;
    requestAnimationFrame(() => (this.pulsing = true));
    window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => (this.pulsing = false), 700);
  }

  // The most recent activity-log entries, newest first, for the debug panel.
  get recentLog() {
    return this.game.eventLog.slice(-60).reverse();
  }

  // Colour a train id in the log to match its sprite.
  trainColor(id: string): string {
    return this.game.trainColors[id] ?? "inherit";
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
.road-car {
  position: absolute;
  z-index: 6; // above the road surface and trains; booms (crossing) sit above
  top: 0;
  left: 0;
  width: 46px;
  height: 24px;
  border-radius: 5px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.45);
  will-change: transform;
  overflow: hidden;
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

.score-card {
  position: fixed;
  z-index: 2000;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  min-width: 340px;
  padding: 14px 22px 16px;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.92),
    rgba(18, 22, 28, 0.92)
  );
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  color: #eef2f6;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;

  &--pulse {
    animation: score-pop 0.6s ease;
  }
  &--complete {
    border-color: rgba(224, 188, 92, 0.55);
    animation: score-breathe 1.8s ease-in-out infinite;
  }
}
.score-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.score-icon {
  font-size: 26px;
  line-height: 1;
}
.score-label {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8fa3b3;
}
.score-count {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.score-now {
  font-size: 38px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  font-variant-numeric: tabular-nums;

  .score-card--complete & {
    color: #f0cf72;
    text-shadow: 0 0 16px rgba(240, 207, 114, 0.6);
  }
}
.score-sep {
  font-size: 22px;
  color: #5d6b77;
}
.score-total {
  font-size: 22px;
  font-weight: 700;
  color: #9aa7b2;
}
.score-check {
  margin-left: 4px;
  font-size: 22px;
  color: #5fd39a;
}
.score-bar {
  position: relative;
  height: 14px;
  margin-top: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.score-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2f9e6b, #5fd39a);
  box-shadow: 0 0 12px rgba(95, 211, 154, 0.5);
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  .score-card--complete & {
    background: linear-gradient(90deg, #d6a93c, #f5d97a);
    box-shadow: 0 0 14px rgba(245, 217, 122, 0.65);
  }
}
.score-pct {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.score-complete-banner {
  margin-top: 10px;
  text-align: center;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #f0cf72;
  text-shadow: 0 0 14px rgba(240, 207, 114, 0.55);
}
.score-banner-enter-active {
  transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.score-banner-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

@keyframes score-pop {
  0% {
    transform: translateX(-50%) scale(1);
  }
  35% {
    transform: translateX(-50%) scale(1.06);
  }
  100% {
    transform: translateX(-50%) scale(1);
  }
}
@keyframes score-breathe {
  0%,
  100% {
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45),
      0 0 16px rgba(224, 188, 92, 0.25);
  }
  50% {
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45),
      0 0 30px rgba(224, 188, 92, 0.5);
  }
}

.score-timer {
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #cdd7df;
}
.score-stars {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}
.star-pip {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.18);
  transition: color 0.3s ease, text-shadow 0.3s ease;
  &--on {
    color: #f0cf72;
    text-shadow: 0 0 10px rgba(240, 207, 114, 0.6);
  }
  &--lg {
    font-size: 34px;
  }
}
.game-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 11, 15, 0.62);
  backdrop-filter: blur(4px);
}
.overlay-card {
  min-width: 320px;
  padding: 28px 34px;
  text-align: center;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.97),
    rgba(18, 22, 28, 0.97)
  );
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  color: #eef2f6;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
}
.overlay-title {
  margin: 0 0 8px;
  font-size: 26px;
}
.overlay-desc {
  margin: 8px 0 18px;
  color: #9aa7b2;
  max-width: 360px;
}
.overlay-best {
  margin: 0 0 8px;
  color: #f0cf72;
  font-weight: 700;
}
.overlay-stars {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 8px 0;
}
.overlay-btn {
  padding: 12px 28px;
  font-size: 16px;
  font-weight: 700;
  color: #0d1117;
  background: linear-gradient(90deg, #5fd39a, #2f9e6b);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  &:hover {
    filter: brightness(1.08);
  }
}

.event-log {
  position: fixed;
  z-index: 2000;
  right: 0;
  top: 0;
  width: 320px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: rgba(20, 24, 28, 0.92);
  color: #d7dde3;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  border-bottom-left-radius: 6px;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.4);
}
.event-log--min {
  width: auto;
}
.event-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 6px 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);

  .event-log--min & {
    border-bottom: none;
  }
}
.event-log-title {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8fa3b3;
}
.event-log-toggle {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  line-height: 18px;
  padding: 0;
  min-width: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: #d7dde3;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.18);
  }
}
.event-log-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
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
  text-align: left;

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
  flex: 0 0 auto;
  min-width: 38px;
}
.log-train {
  font-weight: 700;
  flex: 0 0 auto;
}
.log-text {
  color: #d7dde3;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
