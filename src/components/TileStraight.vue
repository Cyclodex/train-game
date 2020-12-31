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
import { Vue, Component } from "vue-property-decorator";
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
import TileBase from "./TileBase.vue";
import { getCoordinatesId, getTileEntrancePosition } from "@/utils/tileHelpers";
import { getLeavingTrainCoordinates } from "@/utils/trainHelpers";

@Component
export default class TileStraight extends TileBase {
  trafficLights: TrafficLight[] = [];
  automaticTrafficLights = false;
  checkRouteInterval: any;
  possibleRoutes!: PossibleRoutesPerRotation;

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
        // Reactivity!
        Vue.set(this.trafficLights, index, trafficLightUpdate);
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

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.Right) {
      this.currentRotation = Rotations.Top;
    }
    this.initTrafficLIghts();
  }

  // TODO: Use the correct signal, not both!
  checkRouteAhead(trainObject: TrainObject) {
    const nextTileCoordinates = getLeavingTrainCoordinates(
      this.getTrainRoute(trainObject)!,
      {
        x: this.tile.x,
        y: this.tile.y,
      }
    );

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
        // Route free, reserve path and give go
        this.updateTrafficLight({
          direction: this.getTrafficLightDirection(trainObject),
          signal: TrafficLightSignal.Green,
        });

        this.animateTrainFromTrafficLight();
      }
    }
  }

  getTrafficLightDirection(trainObject: TrainObject) {
    return this.getTrainRoute(trainObject)!.trafficLight!.direction;
  }

  incomingTrain(trainId: string) {
    this.train = this.trains[trainId];
    this.checkAutomaticTrafficLight();

    if (
      this.getActiveTrafficLight(this.train).signal === TrafficLightSignal.Red
    ) {
      // Stop the train
      (this.$parent.$refs[trainId] as any)[0].stopTrain();
      this.trainOnRedTrafficLight(this.train);
    }
  }

  animateTrainFromTrafficLight() {
    // Make sure that interval is canceled when train leaves
    clearInterval(this.checkRouteInterval);
    (this.$parent.$refs[this.currentTrain.id] as any)[0].startTrain();
  }

  // Check every 2 seconds to continue travel if route is ok
  trainOnRedTrafficLight(trainObject: TrainObject) {
    this.checkRouteInterval = setInterval(
      this.checkAutomaticTrafficLight,
      2000
    );
  }

  trainLeavesTile(trainObject: TrainObject) {
    // Clear Tile Status after a while
    this.trainLeavesTrafficLight(trainObject);
    setTimeout(() => {
      this.status = TileStatus.Free;
    }, 1000);
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
