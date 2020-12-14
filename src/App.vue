<template>
  <div id="app">
    <div
      class="level"
      :style="{
        maxWidth: $root.tileSize * $root.levelSizeX + 'px',
      }"
    >
      <Train v-for="train in trains" :key="train.id" :train-object="train" />
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
          @checkRouteAhead="checkRouteAhead($event, tile)"
        ></component>
      </div>
    </div>
    <pre>
      {{ trains }}
      {{ level }}
    </pre>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
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
  Coordinates,
  Position,
  CheckStatusFeedback,
  TileStatus,
} from "@/types";
import Train from "./components/Train.vue";
import { RefSelector } from "@vue/test-utils";

@Component({
  components: {
    HelloWorld,
    Counter,
  },
})
export default class App extends Vue {
  trains: { [index: string]: TrainObject } = {
    train1: {
      id: "train1",
      x: 0,
      y: 0,
      direction: TrainDirection.Right,
    },
    train2: {
      id: "train2",
      x: 3,
      y: 2,
      direction: TrainDirection.Right,
    },
    trainCircle1: {
      id: "trainCircle1",
      x: 4,
      y: 1,
      direction: TrainDirection.Down,
    },
    trainCircle2: {
      id: "trainCircle2",
      x: 5,
      y: 0,
      direction: TrainDirection.Up,
    },
  };

  level: { [index: string]: TileObject } = {
    "0,0": {
      component: "TileStraight",
      x: 0,
      y: 0,
      train: null,
      rotation: 1,
      trafficLights: [
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Backward,
        },
      ],
    },
    "1,0": {
      component: "TileIntersection",
      x: 1,
      y: 0,
      train: null,
      rotation: 1,
      activeRoute: ActiveIntersection.Left,
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
      component: "TileCurve",
      x: 0,
      y: 1,
      train: null,
      rotation: 1,
    },
    "1,1": {
      component: "TileCurve",
      x: 1,
      y: 1,
      train: null,
      rotation: 3,
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
      component: "TileIntersection",
      x: 0,
      y: 2,
      train: null,
      rotation: 2,
      activeRoute: ActiveIntersection.Right,
    },
    "1,2": {
      component: "TileCurve",
      x: 1,
      y: 2,
      train: null,
      rotation: 2,
    },
    "2,2": {
      component: "TileIntersection",
      x: 2,
      y: 2,
      train: null,
      rotation: 1,
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
      component: "TileCurve",
      x: 0,
      y: 3,
      train: null,
    },
    "1,3": {
      component: "TileIntersection",
      x: 1,
      y: 3,
      train: null,
      rotation: 1,
      activeRoute: ActiveIntersection.Right,
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
      activeRoute: ActiveIntersection.Straight,
    },
    "6,3": {
      component: "TileCurve",
      x: 6,
      y: 3,
      train: null,
      rotation: 3,
    },
  };

  mounted() {
    Object.values(this.trains).map(train => {
      this.level[this.getCoordinatesId(train)].train = { ...train };
    });
  }

  // Helper funtion TODO: extract
  getCoordinatesId(
    options: TrainObject | TileObject | { x: number; y: number }
  ) {
    return `${options.x},${options.y}`;
  }

  updateTrain(train: TrainObject) {
    train.direction = this.getTrainDirection(train);
    this.trains[train.id] = Object.assign({}, this.trains[train.id], train);
  }

  getTrainDirection(train: TrainObject) {
    const trainOrigin = this.trains[train.id];
    const x = train.x - trainOrigin.x;
    const y = train.y - trainOrigin.y;
    const directionCode = this.getCoordinatesId({ x, y });
    console.log("train direction", { x, y }, directionCode);
    switch (directionCode) {
      case "0,1":
        return TrainDirection.Down;
      case "-1,0":
        return TrainDirection.Left;
      case "0,-1":
        return TrainDirection.Up;
      case "1,0":
      return TrainDirection.Right;
      default:
        console.error("getTrainDirection: failed");
        return TrainDirection.Down;
    }
  }

  getTileEntrancePosition(
    nextTileCoordinates: Coordinates,
    originCoordinates: Coordinates
  ) {
    const x = nextTileCoordinates.x - originCoordinates.x;
    const y = nextTileCoordinates.y - originCoordinates.y;
    const directionCode = this.getCoordinatesId({ x, y });
    console.log("getTileEntrancePosition", { x, y }, directionCode);
    switch (directionCode) {
      case "0,1":
        return Position.Top;
      case "-1,0":
        return Position.Right;
      case "0,-1":
        return Position.Bottom;
      case "1,0":
      return Position.Left;
      default:
        console.error("getTileEntrancePosition: failed");
        return Position.Top;
    }
  }

  trainLeavesTile(train: TrainObject, tile: TileObject) {
    console.log("trainLeavesTile", train, tile);
    this.updateTrain(train);
    this.trainEntersTile(train);
    // TODO delete the leaving train on the old tile (but only this train)
    // Currently we can only have 1 train
    this.level[this.getCoordinatesId(tile)].train = {} as any; // TODO fix also type
  }

  trainEntersTile(train: TrainObject) {
    const tilePosition: string = this.getCoordinatesId(train);
    if (this.level[tilePosition]) {
      this.level[tilePosition].train = { ...train };
    }
  }

  checkRouteAhead(nextTileCoordinates: Coordinates, tile: TileObject) {
    const status = this.checkStatusOnNextTile(nextTileCoordinates, {
      x: tile.x,
      y: tile.y,
    });
    debugger;
    if (Number(status) > TileStatus.Free) {
      // Route blocked, do nothing
      tile.trafficLights![0].signal = TrafficLightSignal.Red;
      tile.trafficLights![1].signal = TrafficLightSignal.Red;
      debugger;
    } else {
      // Route free, reserve path and give go
      // TODO: Reserve the path for the train!
      tile.trafficLights![0].signal = TrafficLightSignal.Green;
      tile.trafficLights![1].signal = TrafficLightSignal.Green;
    }
  }

  checkStatusOnNextTile(
    nextTileCoordinates: Coordinates,
    originCoordinates: Coordinates
  ): any {
    let status: number;
    const tilePosition: string = this.getCoordinatesId(nextTileCoordinates);
    const tileEntrancePosition = this.getTileEntrancePosition(
      nextTileCoordinates,
      originCoordinates
    );
    if (this.level[tilePosition]) {
      const tileStatus: CheckStatusFeedback = (this.$refs[
        tilePosition
      ] as any)[0].checkStatus(tileEntrancePosition);
      if (tileStatus.hasTrafficLight) {
        return tileStatus.status;
      } else {
        // Call next tile, as long as we don't have any traffic light on the route
        status = this.checkStatusOnNextTile(
          tileStatus.nextCoordinates,
          nextTileCoordinates
        );
      }
      debugger;
      return status + tileStatus.status;
    }
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
  outline: 1px solid red;
  flex: 0 0 auto;
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
.debug-arrow {
  z-index: 200;
  width: 100px;
  height: 100px;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.clickable {
  cursor: pointer;
  transition: background-color 0.4s ease;
  &:hover {
    background-color: pink !important;
  }
}
</style>
