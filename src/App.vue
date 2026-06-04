<template>
  <div id="app" :class="{ debug: config.debug }">
    <div class="control-buttons">
      <button class="debug-button" @click="switchDebugMode">
        Debug Mode
      </button>
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
      <transition name="score-banner">
        <div v-if="levelComplete" class="score-complete-banner">
          ★ Level Complete ★
        </div>
      </transition>
    </div>
    <div
      class="level"
      :style="{
        width: config.tileSize * config.levelSizeX + 'px',
      }"
    >
      <Train
        v-for="trainObject in trains"
        :key="trainObject.id"
        :train-object="trainObject"
      />
      <div
        v-for="(tile, key) in level"
        :key="key"
        class="level-tile"
        :style="{
          width: config.tileSize + 'px',
          height: config.tileSize + 'px',
        }"
      >
        <div v-if="config.debug" class="debug">
          <div class="debug-coordinates" v-text="`x${tile.x}y${tile.y}`"></div>
        </div>
        <component
          :is="tile.component"
          v-if="tile.component"
          :key="`${tile.x},${tile.y}`"
          :ref="`${tile.x},${tile.y}`"
          class="tile-component"
          :tile="tile"
        ></component>
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
import {
  ActiveIntersection,
  Rotations,
  TrafficLightSignal,
  TrafficLightDirection,
  TrainsDefinition,
  LevelDefinition,
  TrainStatus,
  Position,
} from "@/types";
import { createGame, Game, TrainDef } from "@/game";

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
class App extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  speeds = [1, 2, 4];
  // Whether the debug activity-log panel is collapsed to just its header.
  logMinimized = false;

  @Provide() trains: TrainsDefinition = {
    train1: {
      id: "train1",
      x: 0,
      y: 4,
      status: TrainStatus.LeavingDepot,
      type: "people",
      wagons: [
        { id: "wagonA1", type: "people" },
        { id: "wagonA2", type: "people" },
        { id: "wagonA3", type: "people" },
        { id: "wagonA4", type: "people" },
      ],
      routeDestinations: [{ to: "5,0" }],
      currentRouteDestination: 0,
    },
    train2: {
      id: "train2",
      x: 1,
      y: 2,
      status: TrainStatus.LeavingDepot,
      type: "fraight",
      wagons: [
        { id: "wagonB1", type: "fraight" },
        { id: "wagonB2", type: "fraight" },
      ],
      routeDestinations: [{ to: "5,4" }],
      currentRouteDestination: 0,
    },
    // train3: {
    //   id: "train3",
    //   x: 5,
    //   y: 4,
    //   status: TrainStatus.LeavingDepot,
    //   type: "fraight",
    //   wagons: [
    //     { id: "wagonC1", type: "fraight" },
    //     { id: "wagonC2", type: "fraight" },
    //   ],
    //   routeDestinations: [{ to: "4,2" }],
    //   currentRouteDestination: 0,
    // },
    // train4: {
    //   id: "train4",
    //   x: 6,
    //   y: 0,
    //   status: TrainStatus.LeavingDepot,
    //   type: "fraight",
    //   wagons: [
    //     { id: "wagonD1", type: "fraight" },
    //     { id: "wagonD2", type: "fraight" },
    //     { id: "wagonD3", type: "fraight" },
    //     { id: "wagonD4", type: "fraight" },
    //     { id: "wagonD5", type: "fraight" },
    //     { id: "wagonD6", type: "fraight" },
    //   ],
    //   routeDestinations: [{ to: "6,0" }],
    //   currentRouteDestination: 0,
    // },
  };

  @Provide() level: LevelDefinition = {
    "0,0": {
      component: "TileCurve",
      x: 0,
      y: 0,
      rotation: 1,
    },
    "1,0": {
      component: "TileStraight",
      x: 1,
      y: 0,
      rotation: 1,
      trafficLights: [
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Forward,
        },
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Backward,
        },
      ],
    },
    "2,0": {
      component: "TileIntersectionComplete",
      x: 2,
      y: 0,
      disabledRoutes: {
        [Position.Top]: [
          ActiveIntersection.Left,
          ActiveIntersection.Straight,
          ActiveIntersection.Right,
        ],
      },
      activeRoutes: {
        [Position.Right]: ActiveIntersection.Left,
      },
    },
    "3,0": {
      component: "TileIntersectionComplete",
      x: 3,
      y: 0,
      disabledRoutes: {
        [Position.Top]: [
          ActiveIntersection.Left,
          ActiveIntersection.Straight,
          ActiveIntersection.Right,
        ],
      },
      activeRoutes: {
        [Position.Bottom]: ActiveIntersection.Left,
      },
    },
    "4,0": {
      component: "TileStraight",
      x: 4,
      y: 0,
      rotation: 1,
    },
    "5,0": {
      component: "TileDepot",
      x: 5,
      y: 0,
      rotation: 3,
    },
    "6,0": {
      component: "TileDepot",
      x: 6,
      y: 0,
      rotation: 2,
    },
    "0,1": {
      component: "TileIntersectionComplete",
      x: 0,
      y: 1,

      rotation: 0,
      activeRoutes: {
        [Position.Top]: ActiveIntersection.Straight,
        [Position.Right]: ActiveIntersection.Right,
        [Position.Bottom]: ActiveIntersection.Straight,
        [Position.Left]: ActiveIntersection.Straight,
      },
      disabledRoutes: {
        [Position.Left]: [
          ActiveIntersection.Left,
          ActiveIntersection.Straight,
          ActiveIntersection.Right,
        ],
      },
    },
    "1,1": {
      component: "TileDepot",
      x: 1,
      y: 1,
      rotation: 3,
      enableTrafficLight: true,
    },
    "2,1": {
      component: "TileStraight",
      x: 2,
      y: 1,
      rotation: 0,
      trafficLights: [
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Forward,
        },
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Backward,
        },
      ],
    },
    "3,1": {
      component: "TileCurve",
      x: 3,
      y: 1,
      rotation: 0,
    },
    "4,1": {
      component: "TileStraight",
      x: 4,
      y: 1,
      rotation: 1,
      trafficLights: [
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Forward,
        },
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Backward,
        },
      ],
    },
    "5,1": {
      component: "TileStraight",
      x: 5,
      y: 1,
      rotation: 1,
    },
    "6,1": {
      component: "TileIntersectionComplete",
      x: 6,
      y: 1,
      disabledRoutes: {
        [Position.Right]: [
          ActiveIntersection.Left,
          ActiveIntersection.Straight,
          ActiveIntersection.Right,
        ],
      },
      activeRoutes: {
        [Position.Bottom]: ActiveIntersection.Left,
      },
    },
    "0,2": {
      component: "TileStraight",
      x: 0,
      y: 2,
      rotation: 0,
    },
    "1,2": {
      component: "TileDepot",
      x: 1,
      y: 2,
      rotation: 1,
    },
    "2,2": {
      component: "TileIntersectionComplete",
      x: 2,
      y: 2,
      rotation: 0,
      activeRoutes: {
        [Position.Bottom]: ActiveIntersection.Right,
        [Position.Right]: ActiveIntersection.Left,
        [Position.Top]: ActiveIntersection.Left,
      },
    },
    "3,2": {
      component: "TileStraight",
      x: 3,
      y: 2,
      rotation: Rotations.Right,
    },
    "4,2": {
      component: "TileStraight",
      x: 4,
      y: 2,
      rotation: 1,
      trafficLights: [
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Forward,
        },
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Backward,
        },
      ],
    },
    "5,2": {
      component: "TileStraight",
      x: 5,
      y: 2,
      rotation: 1,
    },
    "6,2": {
      component: "TileIntersectionComplete",
      x: 6,
      y: 2,
      disabledRoutes: {
        [Position.Right]: [
          ActiveIntersection.Left,
          ActiveIntersection.Straight,
          ActiveIntersection.Right,
        ],
      },
      activeRoutes: {
        [Position.Left]: ActiveIntersection.Right,
      },
    },
    "0,3": {
      component: "TileCurve",
      x: 0,
      y: 3,
    },
    "1,3": {
      component: "TileStraight",
      x: 1,
      y: 3,
      rotation: 1,
    },
    "2,3": {
      component: "TileIntersectionComplete",
      x: 2,
      y: 3,
      disabledRoutes: {
        [Position.Top]: [ActiveIntersection.Left, ActiveIntersection.Right],
        [Position.Bottom]: [ActiveIntersection.Left, ActiveIntersection.Right],
      },
    },
    "3,3": {
      component: "TileStraight",
      x: 3,
      y: 3,
      rotation: Rotations.Right,
    },
    "4,3": {
      component: "TileIntersectionComplete",
      x: 4,
      y: 3,
      disabledRoutes: {
        [Position.Top]: [
          ActiveIntersection.Left,
          ActiveIntersection.Right,
          ActiveIntersection.Straight,
        ],
      },
    },
    "5,3": {
      component: "TileIntersectionComplete",
      x: 5,
      y: 3,
      activeRoutes: {
        [Position.Bottom]: ActiveIntersection.Left,
      },
      disabledRoutes: {
        [Position.Top]: [
          ActiveIntersection.Left,
          ActiveIntersection.Right,
          ActiveIntersection.Straight,
        ],
      },
    },
    "6,3": {
      component: "TileIntersectionComplete",
      x: 6,
      y: 3,
      disabledRoutes: {
        [Position.Right]: [
          ActiveIntersection.Left,
          ActiveIntersection.Straight,
          ActiveIntersection.Right,
        ],
      },
      activeRoutes: {
        [Position.Top]: ActiveIntersection.Straight,
      },
    },
    "0,4": {
      component: "TileDepot",
      x: 0,
      y: 4,
      rotation: 1,
      enableTrafficLight: true,
    },
    "1,4": {
      component: "TileStraight",
      x: 1,
      y: 4,
      rotation: 1,
    },
    "2,4": {
      component: "TileIntersectionComplete",
      x: 2,
      y: 4,
      activeRoutes: {
        [Position.Right]: ActiveIntersection.Right,
        [Position.Top]: ActiveIntersection.Left,
        [Position.Left]: ActiveIntersection.Left,
        [Position.Bottom]: ActiveIntersection.Straight,
      },
    },
    "3,4": {
      component: "TileStraight",
      x: 3,
      y: 4,
      rotation: 1,
    },
    "4,4": {
      component: "TileCurve",
      x: 4,
      y: 4,
      rotation: 3,
    },
    "5,4": {
      component: "TileDepot",
      x: 5,
      y: 4,
      rotation: 0,
    },
    "6,4": {
      component: "TileStraight",
      x: 6,
      y: 4,
    },
    "0,5": {
      component: "",
      x: 0,
      y: 5,
      rotation: 1,
    },
    "1,5": {
      component: "",
      x: 1,
      y: 5,
    },
    "2,5": {
      component: "TileCurve",
      x: 2,
      y: 5,
    },
    "3,5": {
      component: "TileStraight",
      x: 3,
      y: 5,
      rotation: 1,
      trafficLights: [
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Forward,
        },
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Backward,
        },
      ],
    },
    "4,5": {
      component: "TileStraight",
      x: 4,
      y: 5,
      rotation: 1,
    },
    "5,5": {
      component: "TileStraight",
      x: 5,
      y: 5,
      rotation: 1,
    },
    "6,5": {
      component: "TileCurve",
      x: 6,
      y: 5,
      rotation: 3,
    },
  };

  // The authoritative game model + render loop (see game.ts), provided to the
  // train/tile components.
  // markRaw so Vue does not deep-proxy the game: its refs must stay refs (not be
  // auto-unwrapped) and its simulation must keep object identity.
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
  }

  beforeUnmount() {
    this.game.stop();
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

  // Switch lock cycles: off -> reserved (reserved+occupied) -> occupied -> off.
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

export default toNative(App);
</script>

<style lang="scss">
@import "@/scss/_main.scss";

#app {
  text-align: center;
  color: $vueBlack;
  margin-top: 60px;
}
pre {
  text-align: left;
}

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
.debug {
  font-size: 12px;
  z-index: 1;
  text-align: left;
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
}
.debug-coordinates {
  position: absolute;
  bottom: 0;
  left: 0;
}

.clickable {
  cursor: pointer;
  transition: background-color 0.4s ease;
  &:hover {
    background-color: pink !important;
  }
}
.control-buttons {
  position: fixed;
  z-index: 100;
  top: 0;
  left: 0;

  > button {
    display: block;
    padding: 15px;
    min-width: 150px;
  }
}

.score-card {
  position: fixed;
  z-index: 100;
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

.event-log {
  position: fixed;
  z-index: 100;
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
