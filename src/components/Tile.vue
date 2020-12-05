<template>
  <div class="tile"></div>
</template>

<script lang="ts">
import { Component, Emit, Prop, Vue, Watch } from "vue-property-decorator";
import { gsap } from "gsap";
import { TileObject, TrainObject } from "@/types";

@Component
export default class Tile extends Vue {
  @Prop({ type: Object, default: () => ({}) }) tile!: TileObject;

  @Watch("tile.train", { immediate: true, deep: true })
  incomingTrain(newTrain: TrainObject, oldTrain: TrainObject) {
    if (newTrain?.id !== oldTrain?.id) {
      this.animateTrain(newTrain);
    }
  }

  animateTrain(trainObject: TrainObject) {
    const train = document.getElementById(trainObject.id);
    gsap.to(train, {
      duration: 2,
      y: "+=100",
      onComplete: () => this.trainLeavesTile(trainObject),
    });
  }

  @Emit("trainLeavesTile")
  trainLeavesTile(trainObject: TrainObject) {
    return { ...trainObject, y: trainObject.y + 1 };
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
