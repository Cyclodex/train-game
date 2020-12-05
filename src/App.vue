<template>
  <div id="app">
    <div class="level">
      <Train v-for="train in trains" :key="train.id" :train-object="train" />
      <div v-for="(tile, key) in level" :key="key" class="tile">
        <div class="debug">
          {{ key }}
        </div>
        <component
          :is="tile.component"
          :key="tile.id"
          class="component"
          :tile="tile"
          @trainLeavesTile="trainLeavesTile($event, tile)"
        ></component>
      </div>
    </div>
    <pre>
      {{ level }}
    </pre>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import HelloWorld from "./components/HelloWorld.vue";
import Counter from "@/modules/counterExample/views/Counter.vue";
import { TrainObject, TileObject } from "@/types";

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
    },
    train2: {
      id: "train2",
      x: 1,
      y: 1,
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
      component: "",
      x: 2,
      y: 0,
      train: null,
    },
    "0,1": {
      id: "0,1",
      component: "",
      x: 0,
      y: 1,
      train: null,
    },
    "1,1": {
      id: "1,1",
      component: "TileStraight",
      x: 1,
      y: 1,
      train: null,
    },
    "2,1": {
      id: "2,1",
      component: "",
      x: 2,
      y: 1,
      train: null,
    },
    "0,2": {
      id: "0,2",
      component: "",
      x: 0,
      y: 2,
      train: null,
    },
    "1,2": {
      id: "1,2",
      component: "TileStraight",
      x: 1,
      y: 2,
      train: null,
    },
    "2,2": {
      id: "2,2",
      component: "",
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

  getCoordinatesId(options: TrainObject | TileObject) {
    return `${options.x},${options.y}`;
  }

  trainLeavesTile(train: any, tile: any) {
    console.log("trainLeavesTile", train, tile);
    this.trains[train.id] = Object.assign({}, this.trains[train.id], train);
    this.trainEntersTile(train);
    // TODO delete the leaving train on the old tile (but only this train)
    // this.level[this.getCoordinatesId(tile)].train = null;
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
  max-width: 300px;
  flex-wrap: wrap;
  margin: 0 auto;
  position: relative;
}
.tile {
  position: relative;
  outline: 1px solid red;
  flex: 0 0 auto;
  width: 100px;
  height: 100px;
}
.debug {
  position: absolute;
  z-index: 1;
}
</style>
