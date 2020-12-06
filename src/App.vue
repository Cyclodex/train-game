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
        <component
          :is="tile.component"
          :key="tile.id"
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
  };

  level: { [index: string]: TileObject } = {
    "0,0": {
      id: "0,0",
      component: "",
      x: 0,
      y: 0,
      train: null,
    },
    "1,0": {
      id: "1,0",
      component: "TileStraight",
      x: 1,
      y: 0,
      train: null,
    },
    "2,0": {
      id: "2,0",
      component: "TileStraight",
      x: 2,
      y: 0,
      train: null,
    },
    "0,1": {
      id: "0,1",
      component: "TileCurve",
      x: 0,
      y: 1,
      train: null,
    },
    "1,1": {
      id: "1,1",
      component: "TileCurve",
      x: 1,
      y: 1,
      train: null,
    },
    "2,1": {
      id: "2,1",
      component: "TileStraight",
      x: 2,
      y: 1,
      train: null,
    },
    "0,2": {
      id: "0,2",
      component: "TileStraight",
      x: 0,
      y: 2,
      train: null,
    },
    "1,2": {
      id: "1,2",
      component: "",
      x: 1,
      y: 2,
      train: null,
    },
    "2,2": {
      id: "2,2",
      component: "TileStraight",
      x: 2,
      y: 2,
      train: null,
    },
  };

  mounted() {
    Object.values(this.trains).map(train => {
      this.level[this.getCoordinatesId(train)].train = { ...train };
    });
  }

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
    // this.level[this.getCoordinatesId(tile)].train = null;
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
  position: absolute;
  z-index: 1;
}
</style>
