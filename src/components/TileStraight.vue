<template>
  <div class="tile tile-straight">
    <div v-if="$root.debug" class="debug">
      <span class="debug">{{ tile.id }}</span>
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker
            id="startarrow"
            markerWidth="5"
            markerHeight="5"
            refX="-1"
            refY="2.5"
            orient="auto"
          >
            <polygon points="5 0, 5 5, 0 2.5" fill="red" />
          </marker>
          <marker
            id="endarrow"
            markerWidth="5"
            markerHeight="5"
            refX="6"
            refY="2.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <polygon points="0 0, 5 2.5, 0 5" fill="red" />
          </marker>
        </defs>
        <line
          x1="50"
          y1="0"
          x2="50"
          y2="100"
          stroke="#000"
          stroke-width="4"
          marker-end="url(#endarrow)"
          marker-start="url(#startarrow)"
        />
      </svg>
    </div>
  </div>
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
      ease: "none",
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
