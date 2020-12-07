<template>
  <div
    :id="trainObject.id"
    class="train"
    :style="[defaultStyle, initialPosition]"
  >
    <div class="train-front"></div>
    <span class="train-debug">{{ trainObject.x }}, {{ trainObject.y }}</span>
  </div>
</template>

<script lang="ts">
import { TrainDirection, TrainObject } from "@/types";
import { Component, Prop, Vue } from "vue-property-decorator";

@Component
export default class Train extends Vue {
  @Prop({ type: Object, default: {} }) trainObject!: TrainObject;
  defaultStyle = { color: "white" };
  initialPosition = {};

  created() {
    this.setInitialPosition();
  }

  setInitialPosition() {
    const pushToTileBottom =
      this.trainObject.direction === TrainDirection.Up
        ? this.$root.tileSize
        : 0;
    this.initialPosition = {
      left:
        this.trainObject.x * this.$root.tileSize +
        this.$root.tileSize / 2 +
        "px",
      top: this.trainObject.y * this.$root.tileSize + pushToTileBottom + "px",
    };
  }
}
</script>

<style scoped>
.train {
  background-color: #1f38c5;
  border-radius: 50% 50% 0 0;
  width: 40px;
  height: 100px;
  position: absolute;
  z-index: 10;
  transform: translate(-50%, -50%);
}
.train-debug {
  font-size: 14px;
  position: absolute;
  bottom: 0;
  left: 0;
}
</style>
