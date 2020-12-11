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
    let tilePositionX = 0;
    let tilePositionY = 0;

    switch (this.trainObject.direction) {
    case TrainDirection.Up:
        tilePositionX = this.$root.tileSize / 2;
        tilePositionY = this.$root.tileSize;
      break;
    case TrainDirection.Right:
        tilePositionX = 0;
        tilePositionY = this.$root.tileSize / 2;
      break;
    case TrainDirection.Down:
        tilePositionX = this.$root.tileSize / 2;
        tilePositionY = 0;
      break;
    case TrainDirection.Left:
        tilePositionX = this.$root.tileSize;
        tilePositionY = this.$root.tileSize / 2;
      break;
    }
    this.initialPosition = {
      left: this.trainObject.x * this.$root.tileSize + tilePositionX + "px",
      top: this.trainObject.y * this.$root.tileSize + tilePositionY + "px",
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
