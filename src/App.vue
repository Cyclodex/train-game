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
        :ref="trainObject.id"
        :train-object="trainObject"
        @update="onUpdateTrain"
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
  </div>
</template>

<script lang="ts">
import { Component, Inject, Provide, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import {
  ActiveIntersection,
  Rotations,
  TrafficLightSignal,
  TrafficLightDirection,
  TrainsDefinition,
  LevelDefinition,
  TrainStatus,
  Position,
  TrainObject,
} from "@/types";
import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
gsap.registerPlugin(MotionPathPlugin);

@Component
class App extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  paused = false;
  globalAnimations!: any;
  globalTimeScale = 1;
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

  onUpdateTrain(train: TrainObject) {
    this.trains[train.id] = Object.assign({}, this.trains[train.id], train);
  }

  switchDebugMode() {
    this.config.debug = !this.config.debug;
  }

  pausePlayGame() {
    this.paused = !this.paused;
    if (this.paused) {
      gsap.globalTimeline.pause();
    } else {
      gsap.globalTimeline.play();
    }
  }

  changeGlobalTimeScale() {
    const currentSpeed = this.globalTimeScale;
    const currentIndex = this.speeds.indexOf(currentSpeed);
    let newSpeedIndex = currentIndex + 1;
    if (newSpeedIndex === this.speeds.length) {
      newSpeedIndex = 0;
    }
    this.globalTimeScale = this.speeds[newSpeedIndex];
    gsap.globalTimeline.timeScale(this.globalTimeScale);
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
