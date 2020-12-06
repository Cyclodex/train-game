<template>
  <div class="tile tile-curve" @click="rotate">
    <div v-if="$root.debug" class="debug">
      <div class="">T-ID:{{ tile.id }}</div>
      <div class="">Rotation: {{ currentRotation }}</div>
      <div class="">Train incoming: {{ incomingTrainPosition }}</div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop } from "vue-property-decorator";
import { Possition, Rotations, TrainDirection, TrainObject } from "@/types";
import TileBase from "./TileBase.vue";

import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
gsap.registerPlugin(MotionPathPlugin);

// Info
// t=top, r=rigth, b=bottom, l=left

interface PossibleRoutes {
  [index: number]: {
    [index: string]: { path: string; leavesAtPosition: Possition };
  };
}

@Component
export default class TileCurve extends TileBase {
  currentRotation!: Rotations;

  possibleRoutes: PossibleRoutes = {
    [Rotations.tr]: {
      [Possition.Top]: {
        path: "M 50 0 q 0 50 50 50",
        leavesAtPosition: Possition.Right,
      },
      [Possition.Right]: {
        path: "M 100 50 q -50 0 -50 -50",
        leavesAtPosition: Possition.Top,
      },
    },
    [Rotations.rb]: {
      [Possition.Right]: {
        path: "M 100 50 q -50 0 -50 50",
        leavesAtPosition: Possition.Bottom,
      },
      [Possition.Bottom]: {
        path: "M 50 100 q 0 -50 50 -50",
        leavesAtPosition: Possition.Right,
      },
    },
    [Rotations.bl]: {
      [Possition.Bottom]: {
        path: "M 50 100 q 0 -50 -50 -50",
        leavesAtPosition: Possition.Left,
      },
      [Possition.Left]: {
        path: "M  0  50 q 50  0  50  50",
        leavesAtPosition: Possition.Bottom,
      },
    },
    [Rotations.lt]: {
      [Possition.Left]: {
        path: " M 0 50 q 50 0 50 -50",
        leavesAtPosition: Possition.Top,
      },
      [Possition.Top]: {
        path: "M 50 0 q 0 50 -50 50",
        leavesAtPosition: Possition.Left,
      },
    },
  };

  created() {
    this.currentRotation = this.$props.tile.rotation;
  }

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.lt) {
      this.currentRotation = Rotations.tr;
    }
  }

  // Helper (TODO extract)
  getRelativeCoordinatesOfNextTile(leavingPosition: Possition) {
    switch (leavingPosition) {
    case Possition.Top:
      return { x: 0, y: -1 };
    case Possition.Right:
      return { x: 1, y: 0 };
    case Possition.Bottom:
      return { x: 0, y: 1 };
    case Possition.Left:
      return { x: -1, y: 0 };
    default:
      return { x: 0, y: 0 };
    }
  }

  // Helper (TODO extract)
  getIncomingTrainLocation(trainObject: TrainObject | null) {
    if (trainObject === null) return null;

    switch (trainObject.direction) {
    case TrainDirection.Down:
      return Possition.Top;
    case TrainDirection.Left:
      return Possition.Right;
    case TrainDirection.Up:
      return Possition.Bottom;
    case TrainDirection.Right:
      return Possition.Left;
    default:
      return Possition.Top;
    }
  }

  get incomingTrainPosition() {
    return this.getIncomingTrainLocation(this.tile.train || null);
  }

  animateTrain(trainObject: TrainObject, train: HTMLElement) {
    // Identify route
    if (this.incomingTrainPosition !== null) {
      const route = this.possibleRoutes[this.currentRotation][
        this.incomingTrainPosition
      ];
      const coordinatesChange = this.getRelativeCoordinatesOfNextTile(
        route.leavesAtPosition
      );

      // Define tile exit
      trainObject.x += coordinatesChange.x;
      trainObject.y += coordinatesChange.y;

      // Animate
      gsap.to(train, {
        onComplete: () => this.trainLeavesTile(trainObject),
        duration: 2,
        ease: "none",
        motionPath: {
          align: "self",
          autoRotate: -90, // TODO: some need 90, others -90! Make it set on the route
          path: route.path,
          curviness: 2,
        },
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
