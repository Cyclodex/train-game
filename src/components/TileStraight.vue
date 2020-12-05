<template>
  <div class="tile"></div>
</template>

<script lang="ts">
import { Component } from "vue-property-decorator";
import { gsap } from "gsap";
import { TrainObject } from "@/types";
import TileBase from "./TileBase.vue";

@Component
export default class TileStraight extends TileBase {
  animateTrain(trainObject: TrainObject, train: HTMLElement) {
    // Define tile exit
    trainObject.y += 1;

    // Animate
    gsap.to(train, {
      duration: 2,
      y: "+=100",
      onComplete: () => this.trainLeavesTile(trainObject),
    });
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
