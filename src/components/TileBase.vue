<template>
  <div class="tile"></div>
</template>

<script lang="ts">
import { Component, Emit, Prop, Vue, Watch } from "vue-property-decorator";
import { gsap } from "gsap";
import { TileObject, TrainObject } from "@/types";

@Component
export default class TileBase extends Vue {
  @Prop({ type: Object, default: () => ({}) }) tile!: TileObject;
  tileSize = this.$root.tileSize;

  @Watch("tile.train", { immediate: true, deep: true })
  incomingTrain(incomingTrainObject: TrainObject, oldTrain: TrainObject) {
    if (incomingTrainObject?.id !== oldTrain?.id) {
      const train = document.getElementById(incomingTrainObject.id);
      if (train) {
        this.animateTrain(incomingTrainObject, train);
      }
    }
  }

  animateTrain(trainObject: TrainObject, train: HTMLElement) {
    // Define tile exit
    trainObject.y += 1;

    // Animate
    gsap.to(train, {
      duration: 2,
      y: `+=${this.tileSize}`,
      onComplete: () => this.trainLeavesTile(trainObject),
    });
  }

  @Emit("trainLeavesTile")
  trainLeavesTile(trainObject: TrainObject) {
    return { ...trainObject };
  }
}
</script>

<style>
.tile {
  background-color: lightgreen;
  width: 100%;
  height: 100%;
}
</style>
