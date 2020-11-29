<template>
  <div class="tile"></div>
</template>

<script lang="ts">
import { Component, Emit, Prop, Vue, Watch } from "vue-property-decorator";

@Component
export default class Tile extends Vue {
  @Prop({ type: Object, default: () => ({}) }) train: any;

  @Watch("train", { immediate: true, deep: true })
  incomingTrain(newTrain, oldTrain) {
    if (this.train?.y !== undefined) {
      this.$emit("train-update", { ...this.train, y: this.train.y + 1 });
    }
  }
}
</script>

<style scoped>
.tile {
  background-color: lightgreen;
  width: 100%;
  height: 100%;
}
</style>
