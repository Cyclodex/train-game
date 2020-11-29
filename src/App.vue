<template>
  <div id="app">
    <div class="level">
      <Train ref="train1" :train="train" />
      <div v-for="(tile, key) in level" :key="key" class="tile">
        <div class="debug">
          {{ key }}
        </div>
        <component
          :is="tile.component"
          class="component"
          :train="tile.train"
          @train-update="trainUpdate($event)"
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
  train = {
    ref: "train1",
    x: 0,
    y: 0,
  };

  level = {
    "0,0": {
      component: "",
      x: 0,
      y: 0,
    },
    "1,0": {
      component: "Tile",
      x: 1,
      y: 0,
      train: {},
    },
    "2,0": {
      component: "",
      x: 2,
      y: 0,
    },
    "0,1": {
      component: "",
      x: 0,
      y: 1,
    },
    "1,1": {
      component: "Tile",
      x: 1,
      y: 1,
      train: {},
    },
    "2,1": {
      component: "",
      x: 2,
      y: 1,
    },
    "0,2": {
      component: "",
      x: 0,
      y: 2,
    },
    "1,2": {
      component: "",
      x: 1,
      y: 2,
    },
    "2,2": {
      component: "",
      x: 2,
      y: 2,
    },
  };

  mounted() {
    this.train.x = 1;
    this.level["1,0"].train = { ...this.train };
  }

  trainUpdate(train: any) {
    debugger;
    console.log(train);
    this.train = Object.assign({}, this, train, train);
    const tilePosition: any = train.x + "," + train.y;
    // this.level[tilePosition].train = { ...this.train };
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
