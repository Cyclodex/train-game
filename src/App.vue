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
      <div class="delivered-count">Delivered: {{ delivered }}</div>
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
import { TrainsDefinition, TrainStatus, Position } from "@/types";
import { Level } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
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

  @Provide() level: Level = {
    "0,0": expandKind("curve", 1),
    "1,0": expandKind("straight", 1, { signals: true }),
    "2,0": expandKind("cross", 0, {
      disable: [
        [Position.Top, Position.Bottom],
        [Position.Top, Position.Right],
        [Position.Left, Position.Top],
      ],
    }),
    "3,0": expandKind("cross", 0, {
      disable: [
        [Position.Top, Position.Bottom],
        [Position.Top, Position.Right],
        [Position.Left, Position.Top],
      ],
    }),
    "4,0": expandKind("straight", 1),
    "5,0": expandKind("depot", 3),
    "6,0": expandKind("depot", 2),
    "0,1": expandKind("cross", 0, {
      disable: [
        [Position.Left, Position.Right],
        [Position.Bottom, Position.Left],
        [Position.Left, Position.Top],
      ],
    }),
    "1,1": expandKind("depot", 3),
    "2,1": expandKind("straight", 0, { signals: true }),
    "3,1": expandKind("curve", 0),
    "4,1": expandKind("straight", 1, { signals: true }),
    "5,1": expandKind("straight", 1),
    "6,1": expandKind("cross", 0, {
      disable: [
        [Position.Left, Position.Right],
        [Position.Top, Position.Right],
        [Position.Right, Position.Bottom],
      ],
    }),
    "0,2": expandKind("straight", 0),
    "1,2": expandKind("depot", 1),
    "2,2": expandKind("cross", 0),
    "3,2": expandKind("straight", 1),
    "4,2": expandKind("straight", 1, { signals: true }),
    "5,2": expandKind("straight", 1),
    "6,2": expandKind("cross", 0, {
      disable: [
        [Position.Left, Position.Right],
        [Position.Top, Position.Right],
        [Position.Right, Position.Bottom],
      ],
    }),
    "0,3": expandKind("curve", 0),
    "1,3": expandKind("straight", 1),
    "2,3": expandKind("cross", 0, {
      disable: [
        [Position.Top, Position.Right],
        [Position.Left, Position.Top],
        [Position.Bottom, Position.Left],
        [Position.Right, Position.Bottom],
      ],
    }),
    "3,3": expandKind("straight", 1),
    "4,3": expandKind("cross", 0, {
      disable: [
        [Position.Top, Position.Bottom],
        [Position.Top, Position.Right],
        [Position.Left, Position.Top],
      ],
    }),
    "5,3": expandKind("cross", 0, {
      disable: [
        [Position.Top, Position.Bottom],
        [Position.Top, Position.Right],
        [Position.Left, Position.Top],
      ],
    }),
    "6,3": expandKind("cross", 0, {
      disable: [
        [Position.Left, Position.Right],
        [Position.Top, Position.Right],
        [Position.Right, Position.Bottom],
      ],
    }),
    "0,4": expandKind("depot", 1),
    "1,4": expandKind("straight", 1),
    "2,4": expandKind("cross", 0),
    "3,4": expandKind("straight", 1),
    "4,4": expandKind("curve", 3),
    "5,4": expandKind("depot", 0),
    "6,4": expandKind("straight", 0),
    "2,5": expandKind("curve", 0),
    "3,5": expandKind("straight", 1, { signals: true }),
    "4,5": expandKind("straight", 1),
    "5,5": expandKind("straight", 1),
    "6,5": expandKind("curve", 3),
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

  // The full rectangular grid (row-major), so empty coords still occupy a cell
  // and the flex-wrap layout keeps its shape even where the level has gaps.
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

  levelSizeY = 6;

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
</style>
