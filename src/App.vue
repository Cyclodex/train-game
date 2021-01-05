<template>
  <div id="app" :class="{ debug: $root.debug }">
    <div class="control-buttons">
      <button class="debug-button" @click="switchDebugMode">
        Debug Mode
      </button>
      <!-- TODO: Restarting doesnt work as expected. It will brake the animations.
      <button class="timeline-button" @click="startStopAnimations">
        Start/Stop
      </button> -->
    </div>
    <div
      class="level"
      :style="{
        width: $root.tileSize * $root.levelSizeX + 'px',
      }"
    >
      <Train
        v-for="train in trains"
        :key="train.id"
        :ref="train.id"
        :train-object.sync="train"
      />
      <div
        v-for="(tile, key) in level"
        :key="key"
        class="level-tile"
        :style="{
          width: $root.tileSize + 'px',
          height: $root.tileSize + 'px',
        }"
      >
        <div v-if="$root.debug" class="debug">
          <div class="debug-coordinates" v-text="`x${tile.x}y${tile.y}`"></div>
        </div>
        <component
          :is="tile.component"
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
import { Component, ProvideReactive, Vue } from "vue-property-decorator";
import HelloWorld from "./components/HelloWorld.vue";
import Counter from "@/modules/counterExample/views/Counter.vue";
import {
  TrainDirection,
  ActiveIntersection,
  Rotations,
  TrafficLightSignal,
  TrafficLightDirection,
  TrainsDefinition,
  LevelDefinition,
  TrainStatus,
  Position,
} from "@/types";
import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
gsap.registerPlugin(MotionPathPlugin);

@Component({
  components: {
    HelloWorld,
    Counter,
  },
})
export default class App extends Vue {
  timeScale = 1;
  globalAnimations!: any;
  @ProvideReactive() trains: TrainsDefinition = {
    train1: {
      id: "train1",
      x: 1,
      y: 1,
      direction: TrainDirection.Left,
      status: TrainStatus.Init,
      type: "people",
      wagons: [
        { id: "wagonA1", type: "people" },
        { id: "wagonA2", type: "people" },
        { id: "wagonA3", type: "people" },
        { id: "wagonA4", type: "people" },
      ],
      routeDestinations: [{ to: "4,3" }],
      currentRouteDestination: 0,
    },
    train2: {
      id: "train2",
      x: 1,
      y: 2,
      direction: TrainDirection.Right,
      status: TrainStatus.Init,
      type: "fraight",
      wagons: [
        { id: "wagonB1", type: "fraight" },
        { id: "wagonB2", type: "fraight" },
      ],
      routeDestinations: [{ to: "3,4" }],
      currentRouteDestination: 0,
    },
    train3: {
      id: "train3",
      x: 0,
      y: 4,
      direction: TrainDirection.Right,
      status: TrainStatus.Init,
      type: "fraight",
      wagons: [
        { id: "wagonC1", type: "fraight" },
        { id: "wagonC2", type: "fraight" },
      ],
      routeDestinations: [{ to: "4,2" }],
      currentRouteDestination: 0,
    },
    // trainCircle1: {
    //   id: "trainCircle1",
    //   x: 4,
    //   y: 1,
    //   direction: TrainDirection.Down,
    //   status: TrainStatus.Running,
    // },
    // trainCircle2: {
    //   id: "trainCircle2",
    //   x: 5,
    //   y: 0,
    //   direction: TrainDirection.Up,
    //   status: TrainStatus.Running,
    // },
  };

  @ProvideReactive() level: LevelDefinition = {
    "0,0": {
      component: "TileCurve",
      x: 0,
      y: 0,
      train: null,
      rotation: 1,
    },
    "1,0": {
      component: "TileStraight",
      x: 1,
      y: 0,
      train: null,
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
      train: null,
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
      train: null,
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
      train: null,
      rotation: 1,
    },
    "5,0": {
      component: "TileStraight",
      x: 5,
      y: 0,
      train: null,
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
    "6,0": {
      component: "TileCurve",
      x: 6,
      y: 0,
      train: null,
      rotation: 2,
    },
    "0,1": {
      component: "TileIntersectionComplete",
      x: 0,
      y: 1,
      train: null,
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
      component: "TileStraight",
      x: 1,
      y: 1,
      train: null,
      rotation: 1,
      trafficLights: [
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Forward,
        },
      ],
    },
    "2,1": {
      component: "TileStraight",
      x: 2,
      y: 1,
      train: null,
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
      train: null,
      rotation: 0,
    },
    "4,1": {
      component: "TileStraight",
      x: 4,
      y: 1,
      train: null,
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
      train: null,
      rotation: 1,
    },
    "6,1": {
      component: "TileIntersectionComplete",
      x: 6,
      y: 1,
      train: null,
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
      train: null,
      rotation: 0,
    },
    "1,2": {
      component: "TileStraight",
      x: 1,
      y: 2,
      train: null,
      rotation: 1,
      trafficLights: [
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Backward,
        },
      ],
    },
    "2,2": {
      component: "TileIntersectionComplete",
      x: 2,
      y: 2,
      train: null,
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
      train: null,
      rotation: Rotations.Right,
    },
    "4,2": {
      component: "TileStraight",
      x: 4,
      y: 2,
      train: null,
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
      train: null,
      rotation: 1,
    },
    "6,2": {
      component: "TileIntersectionComplete",
      x: 6,
      y: 2,
      train: null,
      disabledRoutes: {
        [Position.Right]: [
          ActiveIntersection.Left,
          ActiveIntersection.Straight,
          ActiveIntersection.Right,
        ],
      },
      activeRoutes: {
        [Position.Left]: ActiveIntersection.Left,
      },
    },
    "0,3": {
      component: "TileCurve",
      x: 0,
      y: 3,
      train: null,
    },
    "1,3": {
      component: "TileStraight",
      x: 1,
      y: 3,
      train: null,
      rotation: 1,
    },
    "2,3": {
      component: "TileIntersectionComplete",
      x: 2,
      y: 3,
      train: null,
      disabledRoutes: {
        [Position.Top]: [ActiveIntersection.Left, ActiveIntersection.Right],
        [Position.Bottom]: [ActiveIntersection.Left, ActiveIntersection.Right],
      },
    },
    "3,3": {
      component: "TileStraight",
      x: 3,
      y: 3,
      train: null,
      rotation: Rotations.Right,
    },
    "4,3": {
      component: "TileStraight",
      x: 4,
      y: 3,
      train: null,
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
    "5,3": {
      component: "TileStraight",
      x: 5,
      y: 3,
      train: null,
      rotation: 1,
    },
    "6,3": {
      component: "TileIntersectionComplete",
      x: 6,
      y: 3,
      train: null,
      disabledRoutes: {
        [Position.Right]: [
          ActiveIntersection.Left,
          ActiveIntersection.Straight,
          ActiveIntersection.Right,
        ],
      },
      activeRoutes: {
        [Position.Top]: ActiveIntersection.Right,
      },
    },
    "0,4": {
      component: "TileStraight",
      x: 0,
      y: 4,
      train: null,
      rotation: 1,
    },
    "1,4": {
      component: "TileStraight",
      x: 1,
      y: 4,
      train: null,
      rotation: 1,
      trafficLights: [
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Backward,
        },
      ],
    },
    "2,4": {
      component: "TileIntersectionComplete",
      x: 2,
      y: 4,
      train: null,
      disabledRoutes: {
        [Position.Bottom]: [
          ActiveIntersection.Left,
          ActiveIntersection.Right,
          ActiveIntersection.Straight,
        ],
      },
      activeRoutes: {
        [Position.Right]: ActiveIntersection.Right,
        [Position.Top]: ActiveIntersection.Left,
        [Position.Left]: ActiveIntersection.Left,
      },
    },
    "3,4": {
      component: "TileStraight",
      x: 3,
      y: 4,
      train: null,
      rotation: 1,
    },
    "4,4": {
      component: "TileStraight",
      x: 4,
      y: 4,
      train: null,
      rotation: 1,
    },
    "5,4": {
      component: "TileStraight",
      x: 5,
      y: 4,
      train: null,
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
    "6,4": {
      component: "TileCurve",
      x: 6,
      y: 4,
      train: null,
      rotation: 3,
    },
  };

  switchDebugMode() {
    this.$root.debug = !this.$root.debug;
  }

  startStopAnimations() {
    this.timeScale = this.timeScale === 1 ? 0 : 1;
    if (this.timeScale === 0) {
      this.globalAnimations = gsap.exportRoot();
      gsap.to(this.globalAnimations, 2, { timeScale: this.timeScale });
    } else {
      gsap.to(this.globalAnimations, 2, { timeScale: this.timeScale });
    }
  }

  get debugTrains() {
    const debugTrains = { ...this.trains };
    return Object.values(debugTrains).map(train => {
      return Object.assign({}, train, { animation: undefined });
    });
  }
}
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
