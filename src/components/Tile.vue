<template>
  <div class="tile"></div>
</template>

<script lang="ts">
import { Component, Emit, Prop, Vue, Watch } from "vue-property-decorator";
import { gsap } from "gsap";

@Component
export default class Tile extends Vue {
  @Prop({ type: Object, default: () => ({}) }) tile: any;

  @Watch("tile.train", { immediate: true, deep: true })
  incomingTrain(newTrain: any, oldTrain: any) {
    console.warn(this.tile);
    if (newTrain?.ref !== oldTrain?.ref) {
      this.animateTrain(newTrain);
    }
  }

  animateTrain(trainData: any) {
    const train = document.getElementById(trainData.ref);
    gsap.to(train, {
      duration: 2,
      y: "+=100",
      onComplete: () => this.trainUpdate(trainData),
    });
  }

  @Emit("trainUpdate")
  trainUpdate(trainData: any) {
    // only return how much y+ x+
    return { ...trainData, y: trainData.y + 1 };
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
