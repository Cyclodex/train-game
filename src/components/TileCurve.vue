<template>
  <div class="tile tile-curve clickable" @click="rotate">
    <div v-if="$root.debug" class="debug">
      <div class="">R: {{ currentRotation }}</div>
      <div class="">T enter: {{ incomingTrainPosition }}</div>
      <div v-if="trainRoute" class="">T Route:<br />{{ trainRoute.path }}</div>
      <debug-show-routes :routes="allPossibleRoutesWithCurrentRotation" />
    </div>
  </div>
</template>

<script lang="ts">
import { Component } from "vue-property-decorator";
import {
  Position,
  PossibleRoutesPerRotation,
  Rotations,
  TrainObject,
} from "@/types";
import TileBase from "./TileBase.vue";

import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
gsap.registerPlugin(MotionPathPlugin);

// Info
// t=top, r=rigth, b=bottom, l=left

@Component
export default class TileCurve extends TileBase {
  possibleRoutes: PossibleRoutesPerRotation = {
    [Rotations.Top]: {
      [Position.Top]: {
        path: "M 50 0 q 0 50 50 50",
        leavesAtPosition: Position.Right,
      },
      [Position.Right]: {
        path: "M 100 50 q -50 0 -50 -50",
        leavesAtPosition: Position.Top,
      },
    },
    [Rotations.Right]: {
      [Position.Right]: {
        path: "M 100 50 q -50 0 -50 50",
        leavesAtPosition: Position.Bottom,
      },
      [Position.Bottom]: {
        path: "M 50 100 q 0 -50 50 -50",
        leavesAtPosition: Position.Right,
      },
    },
    [Rotations.Bottom]: {
      [Position.Bottom]: {
        path: "M 50 100 q 0 -50 -50 -50",
        leavesAtPosition: Position.Left,
      },
      [Position.Left]: {
        path: "M  0  50 q 50  0  50  50",
        leavesAtPosition: Position.Bottom,
      },
    },
    [Rotations.Left]: {
      [Position.Left]: {
        path: " M 0 50 q 50 0 50 -50",
        leavesAtPosition: Position.Top,
      },
      [Position.Top]: {
        path: "M 50 0 q 0 50 -50 50",
        leavesAtPosition: Position.Left,
      },
    },
  };

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.Left) {
      this.currentRotation = Rotations.Top;
    }
  }

  animateTrain(trainObject: TrainObject, train: HTMLElement) {
    // Identify route
    if (this.trainRoute) {
      // Define tile exit
      trainObject.x += this.getLeavingTrainCoordinates.x;
      trainObject.y += this.getLeavingTrainCoordinates.y;

      // Animate
      gsap.to(train, {
        ease: "none",
        duration: 2,
        motionPath: {
          align: "self",
          autoRotate: 90,
          path: this.trainRoute.path,
          curviness: 2,
        },
        onComplete: () => this.trainLeavesTile(trainObject),
      });
    }
  }
}
</script>

<style scoped>
.tile-curve {
  background-color: yellow;
}
</style>
