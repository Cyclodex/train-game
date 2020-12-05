<template>
  <div class="tile tile-straight"></div>
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
      y: `+=${this.tileSize}`,
      onComplete: () => this.trainLeavesTile(trainObject),
    });
  }
}
</script>

<style scoped>
.tile-straight {
}
</style>
