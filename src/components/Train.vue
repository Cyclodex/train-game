<template>
  <div
    :id="trainData.ref"
    class="train"
    :style="[defaultStyle, initialPosition]"
  >
    <span class="train-debug">{{ trainData.x }}, {{ trainData.y }}</span>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";

@Component
export default class Train extends Vue {
  @Prop({ type: Object, default: {} }) trainData: any;
  defaultStyle = { color: "white" };
  initialPosition = {};

  created() {
    this.setInitialPosition();
  }

  setInitialPosition() {
    this.initialPosition = {
      left: this.trainData.x * 100 + 50 + "px",
      top: this.trainData.y * 100 + "px",
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
