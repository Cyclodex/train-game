<template>
  <div class="tile tile-straight clickable" @click="rotate">
    <svg
      v-if="trafficLight"
      class="traffic-light"
      width="16"
      height="30"
      :class="trafficLightStatus"
      @click.stop="changeTrafficLight"
    >
      <circle class="bulb--red" cx="8" cy="8" r="6" />
      <circle class="bulb--green" cx="8" cy="22" r="6" />
    </svg>
    <div v-if="$root.debug" class="debug">
      <div>R: {{ currentRotation }}</div>
      <div>T enter: {{ incomingTrainPosition }}</div>
      <div v-if="trainRoute" class="">T Route:<br />{{ trainRoute.path }}</div>
      <debug-show-routes
        :possible-routes="allPossibleRoutesWithCurrentRotation"
      />
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
  TrafficLight,
  TrainObject,
} from "@/types";
import TileBase from "./TileBase.vue";

@Component
export default class TileStraight extends TileBase {
  trafficLight: TrafficLight = TrafficLight.Disabled;

  created() {
    if (this.$props.tile.trafficLight !== undefined) {
      this.trafficLight = this.$props.tile.trafficLight;
    }
  }

  get trafficLightStatus() {
    if (this.trafficLight === TrafficLight.Red) {
      return "red";
    }
    if (this.trafficLight === TrafficLight.Green) {
      return "green";
    }
    return "";
  }

  changeTrafficLight() {
    if (this.trafficLight === TrafficLight.Red) {
      this.trafficLight = TrafficLight.Green;
      // TODO: Animation should not start, when train is not stopped yet
      this.animateTrainFromTrafficLight();
    } else {
      this.trafficLight = TrafficLight.Red;
    }
  }

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

      if (this.trafficLight === TrafficLight.Red) {
        // Animate
        gsap.to(train, {
          ease: "power1.out",
          duration: 2,
          motionPath: {
            align: "self",
            autoRotate: 90,
            path: this.trainRoute.path,
            end: 0.5,
          },
        });
      } else {
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

  animateTrainFromTrafficLight() {
    const trainObject = this.tile.train;
    const train = document.getElementById(trainObject!.id);
    if (train && this.trainRoute) {
      // Animate away from traffic light
      gsap.to(train, {
        ease: "power1.in",
        duration: 2,
        motionPath: {
          align: "self",
          autoRotate: 90,
          path: this.trainRoute.path,
          end: 0.5,
        },
        onComplete: () => this.trainLeavesTile(trainObject!),
      });
    }
  }
}
</script>

<style lang="scss" scoped>
.tile-straight {
  position: relative;
  .traffic-light {
    z-index: 10;
    background-color: #999;
    position: absolute;
    top: 4px;
    right: 4px;

    ::v-deep circle {
      transition: all 0.5s cubic-bezier(0.89, 0.27, 0.78, 0.59);
    }

    &.red ::v-deep .bulb--red {
      fill: red;
    }

    &.green ::v-deep .bulb--green {
      fill: green;
    }
  }
}
</style>
