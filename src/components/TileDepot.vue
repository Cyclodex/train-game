<template>
  <div
    class="tile tile-depot clickable"
    :class="[
      {
        'tile-rotation--top': currentRotation === 0,
        'tile-rotation--right': currentRotation === 1,
        'tile-rotation--bottom': currentRotation === 2,
        'tile-rotation--left': currentRotation === 3,
      },
      tileStatusStyle,
    ]"
    @click="rotate"
  >
    <TileRail :possible-routes="allDrawableRailRoutes" />
    <img class="depot-building" :src="depotBuildingImg" />
    <div class="depot-interaction" :style="depotColorStyle" />

    <div v-if="config.debug" class="debug">
      <div>R: {{ currentRotation }}</div>
      <!-- <div v-if="getTrainRoute()" class="">
        T Route:<br />{{ getTrainRoute().path }}
      </div> -->
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, toNative } from "vue-facing-decorator";
import {
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
import { TileStraight } from "./TileStraight.vue";
import { Colors, getRandom, resolveRef } from "@/utils/globalHelpers";
import { getCoordinatesId } from "@/utils/tileHelpers";
import depotBuildingImg from "@/assets/depot.png";

@Component
class TileDepot extends TileStraight {
  @Prop({ type: Boolean, default: true }) enableTrafficLight!: boolean;
  automaticTrafficLights = false;
  checkRouteInterval: any;
  possibleRoutes: PossibleRoutesPerRotation = {};
  depotColor = "";
  depotBuildingImg = depotBuildingImg;

  initRoutes(): void {
    this.possibleRoutes = {
      [Rotations.Top]: {
        [Position.Top]: {
          path: this.getPathStraight("T", "C"),
          rails: [
            this.getRailStraight("T-", "CX- CY"),
            this.getRailStraight("T+", "CX+ CY"),
          ],
          leavesAtPosition: Position.Center,
        },
        [Position.Center]: {
          path: this.getPathStraight("C", "T"),
          leavesAtPosition: Position.Top,
        },
      },
      [Rotations.Right]: {
        [Position.Right]: {
          path: this.getPathStraight("R", "C"),
          rails: [
            this.getRailStraight("R-", "CX CY-"),
            this.getRailStraight("R+", "CX CY+"),
          ],
          leavesAtPosition: Position.Center,
        },
        [Position.Center]: {
          path: this.getPathStraight("C", "R"),
          leavesAtPosition: Position.Right,
        },
      },
      [Rotations.Bottom]: {
        [Position.Bottom]: {
          path: this.getPathStraight("B", "C"),
          rails: [
            this.getRailStraight("B-", "CX- CY"),
            this.getRailStraight("B+", "CX+ CY"),
          ],
          leavesAtPosition: Position.Center,
        },
        [Position.Center]: {
          path: this.getPathStraight("C", "B"),
          leavesAtPosition: Position.Bottom,
        },
      },
      [Rotations.Left]: {
        [Position.Left]: {
          path: this.getPathStraight("L", "C"),
          rails: [
            this.getRailStraight("L-", "CX CY-"),
            this.getRailStraight("L+", "CX CY+"),
          ],
          leavesAtPosition: Position.Center,
        },
        [Position.Center]: {
          path: this.getPathStraight("C", "L"),
          leavesAtPosition: Position.Left,
        },
      },
    };
  }

  created() {
    this.initDepot();
    this.initRoutes();
    this.setTrafficLights();
    this.initTrafficLIghts();
  }

  initDepot() {
    this.depotColor = getRandom(Colors);
  }

  setTrafficLights() {
    if (this.enableTrafficLight) {
      this.tile.trafficLights = [
        {
          signal: TrafficLightSignal.Red,
          direction: TrafficLightDirection.Forward,
        },
      ];
    }
  }

  positionTrafficLights() {
    // Put traffic light also into the routes, to help other tiles with it.
    if (this.tile.trafficLights) {
      this.trafficLights.map(trafficLight => {
        const position = this.currentRotation;
        if (this.possibleRoutes[this.currentRotation][position] === undefined) {
          // TO CHECK: Depot has [Position.Center]: not opposite...
        } else {
          this.possibleRoutes[this.currentRotation][
            position
          ].trafficLight = trafficLight;
        }
      });
    }
  }

  getTrafficLightDirection(trainObject: TrainObject) {
    return (
      this.getTrainRoute(trainObject)!.trafficLight?.direction ||
      TrafficLightDirection.Disabled
    );
  }

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.Left) {
      this.currentRotation = Rotations.Top;
    }
    this.initTrafficLIghts();
  }

  incomingTrain(trainId: string) {
    this.status = TileStatus.Blocked;
    this.train = this.trains[trainId];
    this.checkAutomaticTrafficLight();

    if (
      this.train.status! === TrainStatus.Running ||
      this.train.status! === TrainStatus.Started
    ) {
      // Stop the train
      resolveRef(this.$parent!.$refs[trainId]).stopTrainInDepot();
    }
  }

  trainInDepot(trainObject: TrainObject) {
    if (trainObject.trainColor === this.depotColor) {
      // Matching colour: successful delivery. (A blocking `alert` used to live
      // here, which also froze automated browser tests.)
      console.log(
        `Train ${trainObject.id} delivered to matching ${this.depotColor} depot!`
      );
    } else {
      resolveRef(
        this.$parent!.$refs[trainObject.id]
      ).startTrainFromDepot();
    }
  }

  animateTrainOptions(trainObject: TrainObject) {
    return {
      duration: 1,
    };
  }

  animateTrainFromTrafficLight() {
    // Make sure that interval is canceled when train leaves
    clearInterval(this.checkRouteInterval);
    resolveRef(this.$parent!.$refs[this.currentTrain.id]).startTrain();
  }

  // Check every 2 seconds to continue travel if route is ok
  trainOnRedTrafficLight(trainObject: TrainObject) {
    this.checkRouteInterval = setInterval(() => {
      this.checkAutomaticTrafficLight(trainObject);
    }, 2000);
  }

  trainLeavesTile(trainObject: TrainObject) {
    if (trainObject.status !== TrainStatus.EnteringDepot) {
      // TODO There is no traffic light yet
      this.trainLeavesTrafficLight(trainObject);
      // Clear Tile Status after a while
      setTimeout(() => {
        this.status = TileStatus.Free;
      }, 1000);
      return true;
    }
    // Train does not leave
    return false;
  }

  trainLeavesTrafficLight(trainObject: TrainObject) {
    if (this.automaticTrafficLights) {
      this.updateTrafficLight({
        direction: this.getTrafficLightDirection(trainObject),
        signal: TrafficLightSignal.Red,
      });
    }
  }

  get depotColorStyle() {
    return {
      backgroundColor: this.game.depotColors[getCoordinatesId(this.tile)],
    };
  }
}

export default toNative(TileDepot);
</script>

<style lang="scss" scoped>
.tile-depot {
  position: relative;

  &.tile-rotation--right {
    .signal--forward {
      bottom: 52%;
      right: 0;
    }
  }

  &.tile-rotation--left {
    .signal--forward {
      top: 52%;
      left: 0;
    }
  }
  &.tile-rotation--bottom {
    .signal--forward {
      bottom: 0;
      left: 52%;
    }
  }
  &.tile-rotation--top {
    .signal--forward {
      right: 52%;
      top: 0;
    }
  }

  .traffic-light {
    z-index: 10;
    background-color: #999;
    position: absolute;

    :deep(circle) {
      transition: all 0.5s cubic-bezier(0.89, 0.27, 0.78, 0.59);
    }

    &.signal--red :deep(.bulb--red) {
      fill: red;
    }

    &.signal--green :deep(.bulb--green) {
      fill: green;
    }
  }

  .depot-building {
    position: absolute;
    height: 70px;
    z-index: 10;
  }

  .depot-interaction {
    position: absolute;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    z-index: 1000;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    border: 2px solid black;
  }
}
// TODO :::: correct values
.tile-rotation--top .depot-building {
  bottom: 0;
  left: 50%;
  transform: translate(-45%, -60%) rotate(-90deg);
}
.tile-rotation--right .depot-building {
  top: 50%;
  left: 0;
  transform: translate(0, -40%);
}
.tile-rotation--bottom .depot-building {
  top: 0;
  left: 50%;
  transform: translate(-45%, 60%) rotate(-90deg);
}
.tile-rotation--left .depot-building {
  top: 50%;
  right: 0;
  transform: translate(0, -40%);
}
</style>
