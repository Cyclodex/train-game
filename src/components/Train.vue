<template>
  <div
    :id="trainObject.id"
    class="train"
    :style="[defaultStyle, initialPosition]"
  >
    <span class="train-debug">{{ trainObject.x }}, {{ trainObject.y }}</span>
  </div>
</template>

<script lang="ts">
import { TrainObject } from "@/types";
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
    this.initialPosition = {
      left: this.trainObject.x * this.$root.tileSize * 1.5 + "px",
      top: this.trainObject.y * this.$root.tileSize + "px",
    };
  }
}
</script>

<style scoped>
.train {
  background-color: blue;
  border-radius: 25%;
  width: 40px;
  height: 100px;
  position: absolute;
  z-index: 10;
  transform: translate(-50%, -50%);
}
.train-debug {
  font-size: 14px;
}
</style>
