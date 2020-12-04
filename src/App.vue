<template>
  <div id="app">
    <div class="level">
      <Train :train-data="train1" />
      <div v-for="(tile, key) in level" :key="key" class="tile">
        <div class="debug">
          {{ key }}
        </div>
        <component
          :is="tile.component"
          :key="tile.key"
          class="component"
          :tile="tile"
          @trainUpdate="trainUpdate($event)"
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

@Component({
  components: {
    HelloWorld,
    Counter,
  },
})
export default class App extends Vue {
  train1 = {
    ref: "train1",
    x: 1,
    y: 0,
  };

  level: { [index: string]: any } = {
    "0,0": {
      component: "",
      key: 0,
      x: 0,
      y: 0,
      train: {},
    },
    "1,0": {
      component: "Tile",
      key: 1,
      x: 1,
      y: 0,
      train: {},
    },
    "2,0": {
      component: "",
      x: 2,
      y: 0,
      train: {},
    },
    "0,1": {
      component: "",
      x: 0,
      y: 1,
      train: {},
    },
    "1,1": {
      component: "Tile",
      key: 2,
      x: 1,
      y: 1,
      train: {},
    },
    "2,1": {
      component: "",
      x: 2,
      y: 1,
      train: {},
    },
    "0,2": {
      component: "",
      x: 0,
      y: 2,
      train: {},
    },
    "1,2": {
      component: "Tile",
      key: 3,
      x: 1,
      y: 2,
      train: {},
    },
    "2,2": {
      component: "",
      x: 2,
      y: 2,
      train: {},
    },
  };

  mounted() {
    this.level[`${this.train1.x},${this.train1.y}`].train = { ...this.train1 };
  }

  trainUpdate(train: any) {
    // Get the new and old X,Y, to also delete the old train on the level.
    console.log("trainUpdate", train);
    // TODO should we update the train?
    this.train1 = Object.assign({}, this.train1, train);
    this.giveTrainToTile(train);
  }

  giveTrainToTile(train: any) {
    const tilePosition: any = train.x + "," + train.y;
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
