<template>
  <div class="tile tile-straight clickable" @click="rotate">
    <div v-if="$root.debug" class="debug">
      <div>R: {{ currentRotation }}</div>
      <div>T enter: {{ incomingTrainPosition }}</div>
      <div v-if="trainRoute" class="">T Route:<br />{{ trainRoute.path }}</div>
      <debug-show-routes :routes="allPossibleRoutesWithCurrentRotation" />
    </div>
  </div>
</template>

<script lang="ts">
import { Component } from "vue-property-decorator";
import { gsap } from "gsap";
import {
  Position,
  PossibleRoutesPerRotation,
  Rotations,
  TrainObject,
} from "@/types";
import TileBase from "./TileBase.vue";

@Component
export default class TileStraight extends TileBase {
  possibleRoutes: PossibleRoutesPerRotation = {
    [Rotations.Top]: {
      [Position.Top]: {
        path: "M 50 0 V 100",
        leavesAtPosition: Position.Bottom,
      },
      [Position.Bottom]: {
        path: "M 50 100 V 0",
        leavesAtPosition: Position.Top,
      },
    },
    [Rotations.Right]: {
      [Position.Right]: {
        path: "M 100 50 H 0",
        leavesAtPosition: Position.Left,
      },
      [Position.Left]: {
        path: "M 0 50 H 100",
        leavesAtPosition: Position.Right,
      },
    },
  };

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.Right) {
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
        },
        onComplete: () => this.trainLeavesTile(trainObject),
      });
    }
  }
}
</script>

<style scoped>
.tile-straight {
}
</style>
