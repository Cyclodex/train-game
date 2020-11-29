<template>
  <div class="train" :style="[defaultStyle, getPosition]">
    <div class="debug">{{ train.x }}, {{ train.y }}</div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";

@Component
export default class Train extends Vue {
  @Prop({ type: Object, default: {} }) train: any;
  defaultStyle = { color: "white" };

  get getPosition() {
    return {
      left: this.$props.train.x * 100 + 50 + "px",
      top: this.$props.train.y * 100 + "px",
    };
  }
}
</script>

<style scoped>
.train {
  background-color: blue;
  border-radius: 25%;
  width: 25px;
  height: 25px;
  position: absolute;
  z-index: 10;
  transform: translate(-50%, -50%);
}
</style>
