<template>
  <div
    class="tile tile-straight clickable"
    :class="[
      {
        'tile-rotation--top-down': currentRotation === 0,
        'tile-rotation--left-right': currentRotation === 1,
      },
      tileStatusStyle,
    ]"
    @click="rotate"
  >
    <template v-if="trafficLights">
      <template v-for="trafficLight in trafficLights">
        <svg
          v-if="trafficLight"
          :key="trafficLight.direction"
          class="traffic-light"
          width="16"
          height="30"
          :class="{
            'signal--forward': trafficLight.direction === 1,
            'signal--backward': trafficLight.direction === 2,
            'signal--red': trafficLight.signal === 1,
            'signal--green': trafficLight.signal === 2,
          }"
          @click.stop="changeTrafficLight(trafficLight)"
        >
          <circle class="bulb--red" cx="8" cy="8" r="6" />
          <circle class="bulb--green" cx="8" cy="22" r="6" />
          <text
            v-if="automaticTrafficLights"
            id="automatic"
            x="3"
            y="20"
            style="fill: white"
          >
            A
          </text>
        </svg>
      </template>
    </template>
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
import { Component, Emit } from "vue-property-decorator";
import { gsap } from "gsap";
import {
  Coordinates,
  Position,
  PossibleRoutesPerRotation,
  Rotations,
  TrafficLight,
  TrafficLightDirection,
  TrafficLightSignal,
  TrainObject,
} from "@/types";
import TileBase from "./TileBase.vue";

@Component
export default class TileStraight extends TileBase {
  trafficLights: TrafficLight[] = [];
  automaticTrafficLights = false;

  created() {
    if (this.$props.tile.trafficLights !== undefined) {
      this.positionTrafficLights();
      if (this.$root.automaticTrafficLights) {
        this.automaticTrafficLights = this.$root.automaticTrafficLights;
      }
    }
  }

  positionTrafficLights() {
    this.trafficLights = this.$props.tile.trafficLights;
    if (this.trafficLights) {
      this.trafficLights.map(trafficLight => {
        let position;
        if (
          Number(trafficLight.direction) ===
          Number(TrafficLightDirection.Forward)
        ) {
          position = this.currentRotation;
        } else {
          position = this.currentRotation + 2;
        }
        this.possibleRoutes[this.currentRotation][
          position
        ].trafficLight = trafficLight;
      });
    }
  }

  changeTrafficLight(trafficLight: TrafficLight) {
    if (trafficLight.signal === TrafficLightSignal.Red) {
      trafficLight.signal = TrafficLightSignal.Green;
      // TODO: Animation should not start, when train is not stopped yet
      this.animateTrainFromTrafficLight();
    } else {
      trafficLight.signal = TrafficLightSignal.Red;
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

  // TODO: Why not let this function do the checking?
  @Emit("checkRouteAhead")
  checkRouteAhead(coordinates: Coordinates) {
    return coordinates;
  }

  animateTrain(trainObject: TrainObject, train: HTMLElement) {
    // Automatic Traffic Light Checks
    if (this.automaticTrafficLights) {
      this.checkRouteAhead({
        x: this.tile.x + this.getLeavingTrainCoordinates.x,
        y: this.tile.y + this.getLeavingTrainCoordinates.y,
      });
    }

    // Identify route
    if (this.trainRoute) {
      // Define tile exit
      trainObject.x += this.getLeavingTrainCoordinates.x;
      trainObject.y += this.getLeavingTrainCoordinates.y;

      if (this.trainRoute.trafficLight?.signal === TrafficLightSignal.Red) {
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
          onComplete: () => this.trainLeavesTrafficLight(trainObject),
        });
      }
    }
  }

  animateTrainFromTrafficLight() {
    const trainObject = this.tile.train;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        onComplete: () => this.trainLeavesTrafficLight(trainObject!),
      });
    }
  }

  trainLeavesTrafficLight(trainObject: TrainObject) {
    if (this.automaticTrafficLights) {
      // TODO: We make all red for now, we need to know which traffic light...
      this.trafficLights.map(
        trafficLight => (trafficLight.signal = TrafficLightSignal.Red)
      );
    }
    this.trainLeavesTile(trainObject);
  }
}
</script>

<style lang="scss" scoped>
.tile-straight {
  position: relative;

  &.tile-rotation--left-right {
    .signal--backward {
      bottom: 52%;
      right: 0;
    }

    .signal--forward {
      top: 52%;
      left: 0;
    }
  }
  &.tile-rotation--top-down {
    .signal--backward {
      right: 52%;
      top: 0;
    }

    .signal--forward {
      bottom: 0;
      left: 52%;
    }
  }

  .traffic-light {
    z-index: 10;
    background-color: #999;
    position: absolute;

    ::v-deep circle {
      transition: all 0.5s cubic-bezier(0.89, 0.27, 0.78, 0.59);
    }

    &.signal--red ::v-deep .bulb--red {
      fill: red;
    }

    &.signal--green ::v-deep .bulb--green {
      fill: green;
    }
  }
}
</style>
