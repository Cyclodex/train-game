<template>
  <div
    class="tile tile-curve clickable"
    @click.exact="rotate"
    @click.ctrl="changeSwitch"
  >
    <div v-if="$root.debug" class="debug">
      <div class="">R: {{ currentRotation }}</div>
      <div class="">T enter: {{ incomingTrainPosition }}</div>
      <div class="">Switch: {{ intersectionSwitch }}</div>
      <div v-if="trainRoute" class="">T Route:<br />{{ trainRoute.path }}</div>
      <DebugShowRoutes
        :possible-routes="allPossibleRoutesWithCurrentRotation"
        :switchable-routes="allSwitchableRoutes"
        :active-route="activeSwitchRoute"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { Component } from "vue-property-decorator";
import {
  ActiveIntersection,
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
export default class TileIntersection extends TileBase {
  intersectionSwitch: ActiveIntersection = ActiveIntersection.Left;

  created() {
    if (this.$props.tile.activeRoute) {
      this.intersectionSwitch = this.$props.tile.activeRoute;
    }
  }

  get allSwitchableRoutes() {
    return this.possibleRoutes[this.currentRotation][this.currentRotation];
  }

  get activeSwitchRoute() {
    return this.allSwitchableRoutes[this.intersectionSwitch];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  possibleRoutes: PossibleRoutesPerRotation | any = {
    [Rotations.Top]: {
      [Position.Top]: {
        [ActiveIntersection.Left]: {
          path: "M 50 0 q 0 50 50 50",
          leavesAtPosition: Position.Right,
        },
        [ActiveIntersection.Straight]: {
          path: "M 50 0 V 100",
          leavesAtPosition: Position.Bottom,
        },
        [ActiveIntersection.Right]: {
          path: "M 50 0 q 0 50 -50 50",
          leavesAtPosition: Position.Left,
        },
      },
      [Position.Right]: {
        path: "M 100 50 q -50 0 -50 -50",
        leavesAtPosition: Position.Top,
      },
      [Position.Bottom]: {
        path: "M 50 100 V 0",
        leavesAtPosition: Position.Top,
      },
      [Position.Left]: {
        path: " M 0 50 q 50 0 50 -50",
        leavesAtPosition: Position.Top,
      },
    },
    [Rotations.Right]: {
      [Position.Right]: {
        [ActiveIntersection.Left]: {
          path: "M 100 50 q -50 0 -50 50",
          leavesAtPosition: Position.Bottom,
        },
        [ActiveIntersection.Straight]: {
          path: "M 100 50 H 0",
          leavesAtPosition: Position.Left,
        },
        [ActiveIntersection.Right]: {
          path: "M 100 50 q -50 0 -50 -50",
          leavesAtPosition: Position.Top,
        },
      },
      [Position.Bottom]: {
        path: "M 50 100 q 0 -50 50 -50",
        leavesAtPosition: Position.Right,
      },
      [Position.Left]: {
        path: "M 0 50 H 100",
        leavesAtPosition: Position.Right,
      },
      [Position.Top]: {
        path: "M 50 0 q 0 50 50 50",
        leavesAtPosition: Position.Right,
      },
    },
    [Rotations.Bottom]: {
      [Position.Bottom]: {
        [ActiveIntersection.Left]: {
          path: "M 50 100 q 0 -50 -50 -50",
          leavesAtPosition: Position.Left,
        },
        [ActiveIntersection.Straight]: {
          path: "M 50 100 V 0",
          leavesAtPosition: Position.Top,
        },
        [ActiveIntersection.Right]: {
          path: "M 50 100 q 0 -50 50 -50",
          leavesAtPosition: Position.Right,
        },
      },
      [Position.Left]: {
        path: "M  0  50 q 50  0  50  50",
        leavesAtPosition: Position.Bottom,
      },
      [Position.Top]: {
        path: "M 50 0 V 100",
        leavesAtPosition: Position.Bottom,
      },
      [Position.Right]: {
        path: "M 100 50 q -50 0 -50 50",
        leavesAtPosition: Position.Bottom,
      },
    },
    [Rotations.Left]: {
      [Position.Left]: {
        [ActiveIntersection.Left]: {
          path: " M 0 50 q 50 0 50 -50",
          leavesAtPosition: Position.Top,
        },
        [ActiveIntersection.Straight]: {
          path: "M 0 50 H 100",
          leavesAtPosition: Position.Right,
        },
        [ActiveIntersection.Right]: {
          path: "M  0  50 q 50  0  50  50",
          leavesAtPosition: Position.Bottom,
        },
      },
      [Position.Top]: {
        path: "M 50 0 q 0 50 -50 50",
        leavesAtPosition: Position.Left,
      },
      [Position.Right]: {
        path: "M 100 50 H 0",
        leavesAtPosition: Position.Left,
      },
      [Position.Bottom]: {
        path: "M 50 100 q 0 -50 -50 -50",
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

  changeSwitch() {
    this.intersectionSwitch++;
    if (this.intersectionSwitch > ActiveIntersection.Right) {
      this.intersectionSwitch = ActiveIntersection.Left;
    }
  }

  get trainRoute() {
    // TODO: This could return nothing -> Train crashes because no route attached
    if (this.incomingTrainPosition !== null) {
      if (Number(this.incomingTrainPosition) === Number(this.currentRotation)) {
        return this.possibleRoutes[this.currentRotation][
          this.incomingTrainPosition
        ][this.intersectionSwitch];
      }
      return this.possibleRoutes[this.currentRotation][
        this.incomingTrainPosition
      ];
    }
    return null;
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
.tile-curve {
  background-color: rgb(245, 173, 17);
}
</style>
