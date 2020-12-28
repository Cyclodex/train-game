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
          @trainLeavesTile="trainLeavesTile($event, tile)"
          @updateTrain="updateTrain"
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
  TrainObject,
  TileObject,
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
import { getCoordinatesId } from "@/utils/tileHelpers";
import { getTrainDirection } from "@/utils/trainHelpers";
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
      wagons: [
        { id: "wagonA1", type: "people" },
        { id: "wagonA2", type: "people" },
        { id: "wagonA3", type: "people" },
        { id: "wagonA4", type: "people" },
      ],
    },
    train2: {
      id: "train2",
      x: 1,
      y: 2,
      test: "",
      direction: TrainDirection.Right,
      status: TrainStatus.Init,
      wagons: [
        { id: "wagonB1", type: "people" },
        { id: "wagonB2", type: "people" },
      ],
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
      component: "TileCurve",
      x: 2,
      y: 0,
      train: null,
      rotation: 2,
    },
    "3,0": {
      component: "TileCurve",
      x: 3,
      y: 0,
      train: null,
      rotation: 1,
    },
    "4,0": {
      component: "TileCurve",
      x: 4,
      y: 0,
      train: null,
      rotation: 2,
    },
    "5,0": {
      component: "TileCurve",
      x: 5,
      y: 0,
      train: null,
      rotation: 1,
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
      component: "TileCurve",
      x: 4,
      y: 1,
      train: null,
      rotation: 3,
    },
    "5,1": {
      component: "TileCurve",
      x: 5,
      y: 1,
      train: null,
      rotation: 0,
    },
    "6,1": {
      component: "TileCurve",
      x: 6,
      y: 1,
      train: null,
      rotation: 3,
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
    },
    "2,2": {
      component: "TileIntersectionComplete",
      x: 2,
      y: 2,
      train: null,
      rotation: 0,
      activeRoutes: {
        0: ActiveIntersection.Straight,
        1: ActiveIntersection.Straight,
        2: ActiveIntersection.Straight,
        3: ActiveIntersection.Straight,
      },
    },
    "3,2": {
      component: "TileStraight",
      x: 3,
      y: 2,
      train: null,
      rotation: Rotations.Right,
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
    "4,2": {
      component: "TileCurve",
      x: 4,
      y: 2,
      train: null,
      rotation: 2,
    },
    "5,2": {
      component: "TileCurve",
      x: 5,
      y: 2,
      train: null,
      rotation: 1,
    },
    "6,2": {
      component: "TileCurve",
      x: 6,
      y: 2,
      train: null,
      rotation: 2,
    },
    "0,3": {
      component: "TileIntersection",
      x: 0,
      y: 3,
      train: null,
      rotation: 1,
      activeRoute: ActiveIntersection.Right,
    },
    "1,3": {
      component: "TileStraight",
      x: 1,
      y: 3,
      train: null,
      rotation: 1,
    },
    "2,3": {
      component: "TileIntersection",
      x: 2,
      y: 3,
      train: null,
      rotation: 3,
      activeRoute: ActiveIntersection.Left,
    },
    "3,3": {
      component: "TileStraight",
      x: 3,
      y: 3,
      train: null,
      rotation: Rotations.Right,
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
    "4,3": {
      component: "TileIntersection",
      x: 4,
      y: 3,
      train: null,
      rotation: 1,
      activeRoute: ActiveIntersection.Straight,
    },
    "5,3": {
      component: "TileIntersection",
      x: 5,
      y: 3,
      train: null,
      rotation: 3,
      activeRoute: ActiveIntersection.Left,
    },
    "6,3": {
      component: "TileIntersection",
      x: 6,
      y: 3,
      train: null,
      rotation: 0,
      activeRoute: ActiveIntersection.Straight,
    },
    "0,4": {
      component: "TileCurve",
      x: 0,
      y: 4,
      train: null,
      rotation: 0,
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
          direction: TrafficLightDirection.Forward,
        },
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Backward,
        },
      ],
    },
    "2,4": {
      component: "TileStraight",
      x: 2,
      y: 4,
      train: null,
      rotation: 1,
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

  mounted() {
    // Init trains and move to first tile
    Object.values(this.trains).map(train => {
      // Initialize "visual" dom mapper for animations
      this.trains[train.id].visual = document.getElementById(train.id);
      if (this.trains[train.id].wagons !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.trains[train.id].wagons!.map(wagon => {
          wagon.visual = document.getElementById(wagon.id);
        });
      }

      // Move train to first tile
      (this.$refs[getCoordinatesId(train)] as any)[0].incomingTrain(train.id);
      // this.level[getCoordinatesId(train)].train = { ...train };
    });
  }

  // TODO: Train - move functions?
  updateTrain(train: TrainObject) {
    this.trains[train.id] = Object.assign({}, this.trains[train.id], train);
  }

  trainLeavesTile(train: TrainObject, tile: TileObject) {
    train.direction = getTrainDirection(train, { x: tile.x, y: tile.y });
    this.updateTrain({
      id: train.id,
      x: train.x,
      y: train.y,
      status: train.status,
      direction: train.direction,
    });
    // Important that we take the newest train from the train object, not just the one from the leaves function
    this.trainEntersTile(this.trains[train.id]);
  }

  trainEntersTile(train: TrainObject) {
    const tilePosition: string = getCoordinatesId(train);
    if (this.level[tilePosition]) {
      (this.$refs[getCoordinatesId(train)] as any)[0].incomingTrain(train.id);
    }
  }

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
