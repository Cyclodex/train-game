<template>
  <div
    class="tile tile-curve clickable"
    :class="tileStatusStyle"
    @click="rotate"
  >
    <TileRail :possible-routes="allDrawableRailRoutes" />
    <div v-if="$root.debug" class="debug">
      <div class="">R: {{ currentRotation }}</div>
      <div class="">T enter: {{ incomingTrainPosition }}</div>
      <div v-if="trainRoute" class="">T Route:<br />{{ trainRoute.path }}</div>
      <debug-show-routes
        :possible-routes="allPossibleRoutesWithCurrentRotation"
      />
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
        path: this.getPathCurve("T", "R"),
        rails: [this.getRailCurve("T-", "R+"), this.getRailCurve("T+", "R-")],
        leavesAtPosition: Position.Right,
      },
      [Position.Right]: {
        path: this.getPathCurve("R", "T"),
        leavesAtPosition: Position.Top,
      },
    },
    [Rotations.Right]: {
      [Position.Right]: {
        path: this.getPathCurve("R", "B"),
        rails: [this.getRailCurve("R-", "B-"), this.getRailCurve("R+", "B+")],
        leavesAtPosition: Position.Bottom,
      },
      [Position.Bottom]: {
        path: this.getPathCurve("B", "R"),
        leavesAtPosition: Position.Right,
      },
    },
    [Rotations.Bottom]: {
      [Position.Bottom]: {
        path: this.getPathCurve("B", "L"),
        rails: [this.getRailCurve("B-", "L+"), this.getRailCurve("B+", "L-")],
        leavesAtPosition: Position.Left,
      },
      [Position.Left]: {
        path: this.getPathCurve("L", "B"),
        leavesAtPosition: Position.Bottom,
      },
    },
    [Rotations.Left]: {
      [Position.Left]: {
        path: this.getPathCurve("L", "T"),
        rails: [this.getRailCurve("L-", "T-"), this.getRailCurve("L+", "T+")],
        leavesAtPosition: Position.Top,
      },
      [Position.Top]: {
        path: this.getPathCurve("T", "L"),
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
        },
        onComplete: () => this.trainLeavesTile(trainObject),
      });
    }
  }
}
</script>
