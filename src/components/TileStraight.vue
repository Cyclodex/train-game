<template>
  <div class="tile tile-straight"></div>
</template>

<script lang="ts">
import { Component } from "vue-property-decorator";
import { gsap } from "gsap";
import { TrainDirection, TrainObject } from "@/types";
import TileBase from "./TileBase.vue";

@Component
export default class TileStraight extends TileBase {
  animateTrain(trainObject: TrainObject, train: HTMLElement) {
    let minusOrPlus = "+";
    // Define tile exit
    if (trainObject.direction === TrainDirection.Down) {
      trainObject.y += 1;
    } else if (trainObject.direction === TrainDirection.Up) {
      trainObject.y -= 1;
      minusOrPlus = "-";
    }
    // Animate
    gsap.to(train, {
      duration: 2,
      y: `${minusOrPlus}=${this.tileSize}`,
      onComplete: () => this.trainLeavesTile(trainObject),
    });
  }
}
</script>

<style scoped>
.tile-straight {
}
</style>
