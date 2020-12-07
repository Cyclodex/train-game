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
          class="tile-component"
          :tile="tile"
          @trainLeavesTile="trainLeavesTile($event, tile)"
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
import { TrainObject, TileObject, TrainDirection } from "@/types";

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
      x: 1,
      y: 0,
      direction: TrainDirection.Down,
    },
    train2: {
      id: "train2",
      x: 2,
      y: 2,
      direction: TrainDirection.Up,
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
      component: "",
      x: 0,
      y: 0,
      train: null,
    },
    "1,0": {
      component: "TileStraight",
      x: 1,
      y: 0,
      train: null,
    },
    "2,0": {
      component: "TileStraight",
      x: 2,
      y: 0,
      train: null,
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
    },
    "1,2": {
      component: "",
      x: 1,
      y: 2,
      train: null,
    },
    "2,2": {
      component: "TileStraight",
      x: 2,
      y: 2,
      train: null,
    },
    "3,2": {
      component: "",
      x: 3,
      y: 2,
      train: null,
    },
    "4,2": {
      component: "",
      x: 4,
      y: 2,
      train: null,
    },
    "5,2": {
      component: "",
      x: 5,
      y: 2,
      train: null,
    },
    "6,2": {
      component: "",
      x: 6,
      y: 2,
      train: null,
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

  trainLeavesTile(train: TrainObject, tile: TileObject) {
    console.log("trainLeavesTile", train, tile);
    this.updateTrain(train);
    this.trainEntersTile(train);
    // TODO delete the leaving train on the old tile (but only this train)
    // Currently we can only have 1 train
    this.level[this.getCoordinatesId(tile)].train = {} as any; // TODO fix also type
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

  trainEntersTile(train: TrainObject) {
    const tilePosition: string = this.getCoordinatesId(train);
    if (this.level[tilePosition]) {
      this.level[tilePosition].train = { ...train };
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
