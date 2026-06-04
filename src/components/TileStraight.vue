<template>
  <div
    class="tile tile-straight clickable"
    :class="[
      tileStatusStyle,
      {
        'tile-rotation--top-down': currentRotation === 0,
        'tile-rotation--left-right': currentRotation === 1,
      },
    ]"
    @click="rotate"
  >
    <TileRail :possible-routes="allDrawableRailRoutes" />
    <svg
      v-if="hasSignal"
      class="signal-light"
      width="18"
      height="18"
      @click.stop="toggleSignal"
    >
      <circle cx="9" cy="9" r="7" :fill="signalColor" stroke="#222" />
    </svg>
    <div v-if="config.debug" class="debug">
      <div>R: {{ currentRotation }}</div>
      <!-- <div v-if="getTrainRoute()" class="">
        T Route:<br />{{ getTrainRoute().path }}
      </div> -->
      <debug-show-routes
        :possible-routes="allPossibleRoutesWithCurrentRotation"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { Component, toNative } from "vue-facing-decorator";
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
} from "@/types";
import TileBase from "./TileBase";
import { getCoordinatesId, getTileEntrancePosition } from "@/utils/tileHelpers";
import { getLeavingTrainCoordinates } from "@/utils/trainHelpers";
import { resolveRef } from "@/utils/globalHelpers";

@Component
class TileStraight extends TileBase {
  trafficLights: TrafficLight[] = [];
  automaticTrafficLights = false;
  checkRouteInterval: any;

  initRoutes(): void {
    this.possibleRoutes = {
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
  }

  created() {
    this.initRoutes();
    this.initTrafficLIghts();
  }

  initTrafficLIghts() {
    if (this.tile.trafficLights !== undefined) {
      this.trafficLights = this.tile.trafficLights;
    }
    if (this.trafficLights !== undefined) {
      this.positionTrafficLights();
      if (this.config.automaticTrafficLights) {
        this.automaticTrafficLights = this.config.automaticTrafficLights;
      }
    }
  }

  updateTrafficLight(trafficLightUpdate: TrafficLight) {
    this.trafficLights.map((trafficLight, index) => {
      if (trafficLight.direction === trafficLightUpdate.direction) {
        // Vue 3 arrays are deeply reactive, so a direct index assignment is
        // tracked (replaces the Vue 2 `Vue.set`).
        this.trafficLights[index] = trafficLightUpdate;
      }
    });
  }

  getActiveTrafficLight(trainObject: TrainObject) {
    return (
      this.trafficLights.find(
        trafficLight =>
          trafficLight.direction === this.getTrafficLightDirection(trainObject)
      ) || { signal: null }
    );
  }

  positionTrafficLights() {
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
      this.checkAutomaticTrafficLight();
    } else {
      trafficLight.signal = TrafficLightSignal.Red;
    }
  }

  forceGreenTrafficLight(
    trafficLight: TrafficLight,
    trainObject: TrainObject = this.train
  ) {
    this.updateTrafficLight({
      direction: trafficLight.direction,
      signal: TrafficLightSignal.Green,
    });
    // Force path reservation
    this.checkRouteAhead(trainObject, true);
    //Force go train
    this.animateTrainFromTrafficLight();
  }

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.Right) {
      this.currentRotation = Rotations.Top;
    }
    this.initTrafficLIghts();
  }

  // TODO: Use the correct signal, not both!
  checkRouteAhead(trainObject: TrainObject, forced = false) {
    const nextTileCoordinates = getLeavingTrainCoordinates(
      this.getTrainRoute(trainObject)!,
      {
        x: this.tile.x,
        y: this.tile.y,
      }
    );

    const status = this.checkStatusOnNextTile(
      nextTileCoordinates,
      {
        x: this.tile.x,
        y: this.tile.y,
      },
      trainObject,
      forced
    );

    return status;
  }

  checkStatusOnNextTile(
    nextTileCoordinates: Coordinates,
    originCoordinates: Coordinates,
    trainObject: TrainObject,
    forced = false
  ): any {
    let status: number;
    const tilePosition: string = getCoordinatesId(nextTileCoordinates);
    const tileEntrancePosition = getTileEntrancePosition(
      nextTileCoordinates,
      originCoordinates
    );
    if (this.level[tilePosition]) {
      const tileStatus: CheckStatusFeedback = resolveRef(
        this.$parent!.$refs[tilePosition]
      ).checkStatus(tileEntrancePosition, trainObject);
      // If Status is not free = The route is block, dont progress
      if (tileStatus.status !== TileStatus.Free && !forced) {
        return tileStatus.status;
      } else if (tileStatus.hasTrafficLight) {
        // If it has trafficLight, reserve it and return the status, the route is complete
        if (tileStatus.status === TileStatus.Free) {
          resolveRef(this.$parent!.$refs[tilePosition]).reserveTile();
        }
        return tileStatus.status;
      } else {
        // Call next tile, as long as we don't have any traffic light on the route
        status = this.checkStatusOnNextTile(
          tileStatus.nextCoordinates,
          nextTileCoordinates,
          trainObject,
          forced
        );
      }
      // If route is free, reserve every tile
      if (status === TileStatus.Free || forced) {
        resolveRef(this.$parent!.$refs[tilePosition]).reserveTile(
          tileEntrancePosition,
          trainObject
        );
      }
      return status + tileStatus.status;
    }
  }

  checkAutomaticTrafficLight(trainObject: TrainObject = this.train) {
    // TODO: check if there is a traffic light on this route ?!
    // TODO: What if there is no train?
    // Automatic Traffic Light Checks
    if (this.automaticTrafficLights) {
      const routeStatus = this.checkRouteAhead(trainObject);
      if (routeStatus > TileStatus.Free) {
        // Route reserved or blocked, stop train
        this.updateTrafficLight({
          direction: this.getTrafficLightDirection(trainObject),
          signal: TrafficLightSignal.Red,
        });
      } else {
        // Route free, give go
        this.updateTrafficLight({
          direction: this.getTrafficLightDirection(trainObject),
          signal: TrafficLightSignal.Green,
        });

        this.animateTrainFromTrafficLight();
      }
    }
  }

  getTrafficLightDirection(trainObject: TrainObject) {
    return (
      this.getTrainRoute(trainObject)?.trafficLight?.direction ||
      TrafficLightDirection.Disabled
    );
  }

  incomingTrain(trainId: string) {
    this.status = TileStatus.Blocked;
    this.train = this.trains[trainId];
    this.checkAutomaticTrafficLight();

    if (
      this.getActiveTrafficLight(this.train).signal === TrafficLightSignal.Red
    ) {
      // Stop the train
      resolveRef(this.$parent!.$refs[trainId]).stopTrain();
      this.trainOnRedTrafficLight(this.train);
    }
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
    // Clear Tile Status after a while
    this.trainLeavesTrafficLight(trainObject);
    setTimeout(() => {
      this.status = TileStatus.Free;
    }, 1000);
    return true;
  }

  trainLeavesTrafficLight(trainObject: TrainObject) {
    if (this.automaticTrafficLights) {
      this.updateTrafficLight({
        direction: this.getTrafficLightDirection(trainObject),
        signal: TrafficLightSignal.Red,
      });
    }
  }
}

// Raw decorated class is exported for `TileDepot` to extend; the native
// component is the default export used for registration.
export { TileStraight };
export default toNative(TileStraight);
</script>

<style lang="scss" scoped>
.signal-light {
  position: absolute;
  z-index: 12;
  top: 4px;
  right: 4px;
  cursor: pointer;
}
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
}
</style>
