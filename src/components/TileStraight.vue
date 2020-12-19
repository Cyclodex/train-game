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
    <TileRail :possible-routes="allDrawableRailRoutes" />
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
          @click.exact.stop="changeTrafficLight(trafficLight)"
          @click.ctrl.stop="forceGreenTrafficLight(trafficLight)"
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
import { Component } from "vue-property-decorator";
import { gsap } from "gsap";
import {
  CheckStatusFeedback,
  Coordinates,
  Position,
  PossibleRoutesPerRotation,
  Rotations,
  TileStatus,
  TrafficLight,
  TrafficLightDirection,
  TrafficLightSignal,
  TrainObject,
  TrainStatus,
} from "@/types";
import TileBase from "./TileBase.vue";
import { getCoordinatesId, getTileEntrancePosition } from "@/utils/tileHelpers";

@Component
export default class TileStraight extends TileBase {
  trafficLights: TrafficLight[] = [];
  automaticTrafficLights = false;
  checkRouteInterval: any;

  created() {
    if (this.$props.tile.trafficLights !== undefined) {
      this.positionTrafficLights();
      if (this.$root.automaticTrafficLights) {
        this.automaticTrafficLights = this.$root.automaticTrafficLights;
      }
    }
  }

  updateTrafficLight(trafficLightUpdate: TrafficLight) {
    this.trafficLights.map((trafficLight, index) => {
      if (trafficLight.direction === trafficLightUpdate.direction) {
        this.trafficLights[index] = trafficLightUpdate;
      }
    });
  }

  get getActiveTrafficLight() {
    return (
      this.trafficLights.find(
        trafficLight => trafficLight.direction === this.trafficLightDirection
      ) || { signal: null }
    );
  }

  positionTrafficLights() {
    this.trafficLights = this.$props.tile.trafficLights;
    // Put traffic light also into the routes, to help other tiles with it.
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
      // TODO: Animation should not start, when train is not stopped yet
      this.checkAutomaticTrafficLight();
    } else {
      trafficLight.signal = TrafficLightSignal.Red;
    }
  }

  forceGreenTrafficLight(trafficLight: TrafficLight) {
    this.updateTrafficLight({
      direction: trafficLight.direction,
      signal: TrafficLightSignal.Green,
    });
    this.animateTrainFromTrafficLight();
  }

  possibleRoutes: PossibleRoutesPerRotation = {
    [Rotations.Top]: {
      [Position.Top]: {
        path: this.getPathStraight("T", "B"),
        rails: [
          this.getRailStraight("T-", "B-"),
          this.getRailStraight("T+", "B+"),
        ],
        leavesAtPosition: Position.Bottom,
      },
      [Position.Bottom]: {
        path: this.getPathStraight("B", "T"),
        leavesAtPosition: Position.Top,
      },
    },
    [Rotations.Right]: {
      [Position.Right]: {
        path: this.getPathStraight("R", "L"),
        rails: [
          this.getRailStraight("R-", "L-"),
          this.getRailStraight("R+", "L+"),
        ],
        leavesAtPosition: Position.Left,
      },
      [Position.Left]: {
        path: this.getPathStraight("L", "R"),
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

  // TODO: Use the correct signal, not both!
  checkRouteAhead() {
    const nextTileCoordinates = {
      x: this.tile.x + this.getLeavingTrainCoordinates.x,
      y: this.tile.y + this.getLeavingTrainCoordinates.y,
    };

    const status = this.checkStatusOnNextTile(nextTileCoordinates, {
      x: this.tile.x,
      y: this.tile.y,
    });

    return status;
  }

  checkStatusOnNextTile(
    nextTileCoordinates: Coordinates,
    originCoordinates: Coordinates
  ): any {
    let status: number;
    const tilePosition: string = getCoordinatesId(nextTileCoordinates);
    const tileEntrancePosition = getTileEntrancePosition(
      nextTileCoordinates,
      originCoordinates
    );
    if (this.level[tilePosition]) {
      const tileStatus: CheckStatusFeedback = (this.$parent.$refs[
        tilePosition
      ] as any)[0].checkStatus(tileEntrancePosition);
      // If Status is not free = The route is block, dont progress
      if (tileStatus.status !== TileStatus.Free) {
        return tileStatus.status;
      } else if (tileStatus.hasTrafficLight) {
        // If it has trafficLight, reserve it and return the status, the route is complete
        if (tileStatus.status === TileStatus.Free) {
          (this.$parent.$refs[tilePosition] as any)[0].reserveTile();
        }
        return tileStatus.status;
      } else {
        // Call next tile, as long as we don't have any traffic light on the route
        status = this.checkStatusOnNextTile(
          tileStatus.nextCoordinates,
          nextTileCoordinates
        );
      }
      // If route is free, reserve every tile
      if (status === TileStatus.Free) {
        (this.$parent.$refs[tilePosition] as any)[0].reserveTile();
      }
      return status + tileStatus.status;
    }
  }

  checkAutomaticTrafficLight() {
    // TODO: check if there is a traffic light on this route ?!
    // TODO: What if there is no train?
    console.log("checkAutomaticTrafficLight");
    // Automatic Traffic Light Checks
    if (this.automaticTrafficLights) {
      const routeStatus = this.checkRouteAhead();
      if (routeStatus > TileStatus.Free) {
        // Route reserved or blocked, stop train
        this.updateTrafficLight({
          direction: this.trafficLightDirection,
          signal: TrafficLightSignal.Red,
        });
      } else {
        // Route free, reserve path and give go
        this.updateTrafficLight({
          direction: this.trafficLightDirection,
          signal: TrafficLightSignal.Green,
        });

        // TODO: Green light not visible, reactivity issue, fix it.
        if (this.currentTrain.status === TrainStatus.Stopped) {
          this.animateTrainFromTrafficLight();
        }
      }
    }
  }

  get trafficLightDirection() {
    return this.trainRoute!.trafficLight!.direction;
  }

  animateTrain(trainObject: TrainObject, train: HTMLElement) {
    this.checkAutomaticTrafficLight();

    // Identify route
    if (this.trainRoute) {
      // Define tile exit
      trainObject.x += this.getLeavingTrainCoordinates.x;
      trainObject.y += this.getLeavingTrainCoordinates.y;

      if (this.getActiveTrafficLight.signal === TrafficLightSignal.Red) {
        // Stop the train
        this.trainStopping();
        gsap.to(train, {
          ease: "power1.out",
          duration: 2,
          motionPath: {
            align: "self",
            autoRotate: 90,
            path: this.trainRoute.path,
            end: 0.5,
          },
          onComplete: () => this.trainOnRedTrafficLight(),
        });
      } else {
        // Animate train through tile, no stop
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
    this.trainStarted();
    // Make sure that interval is canceled when train leaves
    clearInterval(this.checkRouteInterval);

    // TODO: Move to function
    const trainObject = { ...this.currentTrain };
    trainObject.x += this.getLeavingTrainCoordinates.x;
    trainObject.y += this.getLeavingTrainCoordinates.y;

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
        onComplete: () => this.trainLeavesTrafficLight(trainObject),
      });
    }
  }

  // Check every 2 seconds to continue travel if route is ok
  trainOnRedTrafficLight() {
    this.trainStopped();
    this.checkRouteInterval = setInterval(
      this.checkAutomaticTrafficLight,
      2000
    );
  }

  trainLeavesTrafficLight(trainObject: TrainObject) {
    this.trainRunning();
    if (this.automaticTrafficLights) {
      this.updateTrafficLight({
        direction: this.trafficLightDirection,
        signal: TrafficLightSignal.Red,
      });
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
