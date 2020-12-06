<template>
  <div class="tile tile-curve">
    <div v-if="$root.debug" class="debug">
      <span class="debug">{{ tile.id }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import { Component } from "vue-property-decorator";
import { TrainDirection, TrainObject } from "@/types";
import TileBase from "./TileBase.vue";

import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
gsap.registerPlugin(MotionPathPlugin);

@Component
export default class TileCurve extends TileBase {
  animateTrain(trainObject: TrainObject, train: HTMLElement) {
    const yMinusOrPlus = "+";
    let xEase = "circ.in";
    let yEase = "power2.out";
    let xMinusOrPlus = "+";
    let rotate = "+";
    // Define tile exit
    if (trainObject.direction === TrainDirection.Down) {
      // Top-Left Curve
      trainObject.x -= 1;
      xMinusOrPlus = "-";
    } else if (trainObject.direction === TrainDirection.Left) {
      // Right-Bottom Curve
      trainObject.y += 1;
      xMinusOrPlus = "-";
      xEase = "power2.out";
      yEase = "circ.in";
      rotate = "-";
    }
    // gsap.to(train, {
    //   ease: "circ",
    //   duration: 2,
    //   y: `${yMinusOrPlus}=${this.tileSize / 2}`,
    //   onComplete: () => this.trainLeavesTile(trainObject),
    // });
    // gsap.to(train, {
    //   ease: "circ",
    //   duration: 2,
    //   x: `${xMinusOrPlus}=${this.tileSize / 2}`,
    //   onComplete: () => this.trainLeavesTile(trainObject),
    // });
    // const tl = gsap.timeline(); //create the timeline
    gsap.to(train, {
      keyframes: [
        {
          x: `${xMinusOrPlus}=${this.tileSize / 2}`,
          ease: xEase,
          duration: 2,
        },
        {
          y: `${yMinusOrPlus}=${this.tileSize / 2}`,
          ease: yEase,
          duration: 2,
          delay: -2,
        },
        {
          rotation: `${rotate}=90`,
          ease: "none",
          duration: 2,
          delay: -2,
        },
      ],
      onComplete: () => this.trainLeavesTile(trainObject),
    });
    // Animate
    // gsap.to(train, {
    //   onComplete: () => this.trainLeavesTile(trainObject),
    //   duration: 2,
    //   motionPath: {
    //     // type: "cubic",
    //     // autoRotate: 90,
    //     path: [
    //       { x: 0, y: 0 },
    //       { x: 200, y: 0 },
    //       { x: 300, y: 500 },
    //       { x: 500, y: 500 },
    //     ],
    //     type: "cubic",
    //     curviness: 1,
    //   },
    // });
  }
}
</script>

<style scoped>
.tile-curve {
  background-color: yellow;
}
</style>
