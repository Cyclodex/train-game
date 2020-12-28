<template>
  <div
    class="tile tile-curve clickable"
    :class="tileStatusStyle"
    @click.exact="rotate"
  >
    <TileRail :possible-routes="allDrawableRailRoutes" />
    <svg
      v-for="(n, i) in 4"
      :key="n"
      :class="[
        `switch-box switch-box--${i}`,
        {
          'signal--left': intersectionSwitch[i] === 0,
          'signal--straight': intersectionSwitch[i] === 1,
          'signal--right': intersectionSwitch[i] === 2,
        },
      ]"
      width="24"
      height="18"
      @click.stop="changeSwitch(i)"
    >
      <circle class="bulb--base" cx="12" cy="13" r="3" />
      <circle class="bulp--direction bulb--straight" cx="12" cy="5" r="3" />
      <circle class="bulp--direction bulb--left" cx="4" cy="13" r="3" />
      <circle class="bulp--direction bulb--right" cx="20" cy="13" r="3" />
    </svg>
    <div>
      Switch
    </div>
    <div v-if="$root.debug" class="debug">
      <div class="">R: {{ currentRotation }}</div>
      <div class="">T enter: {{ getIncomingTrainPosition() }}</div>
      <div class="">Switch: {{ intersectionSwitch }}</div>
      <div v-if="getTrainRoute()" class="">
        T Route:<br />{{ getTrainRoute().path }}
      </div>
      <DebugShowRoutes
        :possible-routes="allSwitchableRoutes"
        :switchable-routes="allSwitchableRoutes"
        :active-routes="activeSwitchRoutes"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop } from "vue-property-decorator";
import {
  ActiveIntersection,
  ActiveIntersectionPerPosition,
  Position,
  PossibleRoutesPerRotation,
  Rotations,
  Route,
  TrainObject,
} from "@/types";
import TileBase from "./TileBase.vue";

// Info
// t=top, r=rigth, b=bottom, l=left

@Component
export default class TileIntersectionComplete extends TileBase {
  @Prop({ type: Object, default: () => ({}) })
  activeRoutes!: ActiveIntersectionPerPosition[];
  intersectionSwitch: ActiveIntersectionPerPosition = {
    0: ActiveIntersection.Left,
    1: ActiveIntersection.Left,
    2: ActiveIntersection.Left,
    3: ActiveIntersection.Left,
  };

  possibleRoutes!: PossibleRoutesPerRotation | any;

  created() {
    this.initRoutes();

    if (this.$props.tile.activeRoutes) {
      this.intersectionSwitch = this.$props.tile.activeRoutes;
    }
    this.initIntersection();
  }

  initIntersection() {
    // TODO: should be re-called when rotating the tile
    if (this.$props.tile.disabledRoutes) {
      console.log(
        Object.entries(
          this.$props.tile.disabledRoutes as ActiveIntersectionPerPosition
        )
      );

      Object.entries(
        this.$props.tile.disabledRoutes as ActiveIntersectionPerPosition
      ).map((entry: any) => {
        const position = entry[0];
        const disabledRoutes = entry[1];
        disabledRoutes.map((disableRouteIndex: number) => {
          const disableRoute: Route = this.possibleRoutes[this.currentRotation][
            position
          ][disableRouteIndex];
          disableRoute.disabled = true;
          // TODO Disable also the return route ?
          // Would need further logic (Left -> right)
          // this.possibleRoutes[this.currentRotation][position][
          //   disableRoute.leavesAtPosition
          // ].disabled = true;
        });
      });
    }
  }

  initRoutes(): void {
    const allRoutes = {
      [Position.Top]: {
        [ActiveIntersection.Left]: {
          path: this.getPathCurve("T", "R"),
          rails: [this.getRailCurve("R-", "T+"), this.getRailCurve("R+", "T-")],
          leavesAtPosition: Position.Right,
        },
        [ActiveIntersection.Straight]: {
          path: this.getPathStraight("T", "B"),
          rails: [
            this.getRailStraight("B-", "T-"),
            this.getRailStraight("B+", "T+"),
          ],
          leavesAtPosition: Position.Bottom,
        },
        [ActiveIntersection.Right]: {
          path: this.getPathCurve("T", "L"),
          rails: [this.getRailCurve("L-", "T-"), this.getRailCurve("L+", "T+")],
          leavesAtPosition: Position.Left,
        },
      },
      [Position.Right]: {
        [ActiveIntersection.Left]: {
          path: this.getPathCurve("R", "B"),
          rails: [this.getRailCurve("B-", "R-"), this.getRailCurve("B+", "R+")],
          leavesAtPosition: Position.Bottom,
        },
        [ActiveIntersection.Straight]: {
          path: this.getPathStraight("R", "L"),
          rails: [
            this.getRailStraight("L-", "R-"),
            this.getRailStraight("L+", "R+"),
          ],
          leavesAtPosition: Position.Left,
        },
        [ActiveIntersection.Right]: {
          path: this.getPathCurve("R", "T"),
          rails: [this.getRailCurve("T-", "R+"), this.getRailCurve("T+", "R-")],

          leavesAtPosition: Position.Top,
        },
      },
      [Position.Bottom]: {
        [ActiveIntersection.Left]: {
          path: this.getPathCurve("B", "L"),
          rails: [this.getRailCurve("L-", "B+"), this.getRailCurve("L+", "B-")],

          leavesAtPosition: Position.Left,
        },
        [ActiveIntersection.Straight]: {
          path: this.getPathStraight("B", "T"),
          rails: [
            this.getRailStraight("T-", "B-"),
            this.getRailStraight("T+", "B+"),
          ],
          leavesAtPosition: Position.Top,
        },
        [ActiveIntersection.Right]: {
          path: this.getPathCurve("B", "R"),
          rails: [this.getRailCurve("R-", "B-"), this.getRailCurve("R+", "B+")],

          leavesAtPosition: Position.Right,
        },
      },
      [Position.Left]: {
        [ActiveIntersection.Left]: {
          path: this.getPathCurve("L", "T"),
          rails: [this.getRailCurve("T-", "L-"), this.getRailCurve("T+", "L+")],
          leavesAtPosition: Position.Top,
        },
        [ActiveIntersection.Straight]: {
          path: this.getPathStraight("L", "R"),
          rails: [
            this.getRailStraight("R-", "L-"),
            this.getRailStraight("R+", "L+"),
          ],
          leavesAtPosition: Position.Right,
        },
        [ActiveIntersection.Right]: {
          path: this.getPathCurve("L", "B"),
          rails: [this.getRailCurve("B-", "L+"), this.getRailCurve("B+", "L-")],
          leavesAtPosition: Position.Bottom,
        },
      },
    };
    this.possibleRoutes = {
      [Position.Top]: allRoutes,
      [Position.Right]: allRoutes,
      [Position.Bottom]: allRoutes,
      [Position.Left]: allRoutes,
    };
  }

  getRouteFromEntrancePosition(entrancePosition: Position) {
    return this.possibleRoutes[this.currentRotation][entrancePosition][
      this.intersectionSwitch[entrancePosition]
    ];
  }

  get allSwitchableRoutes() {
    return this.possibleRoutes;
  }

  get allDrawableRailRoutes() {
    const routes: any[] = [];
    const possibleRoutes = this.possibleRoutes[this.currentRotation] as any[];
    const routesPositions = Object.values(possibleRoutes);
    routesPositions.map((position: Route[]) => {
      const routesPerPosition = Object.values(position);
      routes.push(routesPerPosition.flat());
    });
    const routesIteratable = routes.flat();
    // Flat all position arrays
    routesIteratable.filter(route => !!route.path && !route.disabled);
    const enabledRoutes: Route[] = routesIteratable.filter(
      route => !!route.path && !route.disabled
    );
    return enabledRoutes;
  }

  get activeSwitchRoutes() {
    return Object.values(this.allSwitchableRoutes).map((routes, position) => {
      this.intersectionSwitch[position];
    });
  }

  activeSwitchRoute(position: Position) {
    return this.allSwitchableRoutes[this.intersectionSwitch[position]];
  }

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.Left) {
      this.currentRotation = Rotations.Top;
    }
    this.initIntersection();
  }

  changeSwitch(position: Position) {
    this.intersectionSwitch[position]++;
    if (this.intersectionSwitch[position] > ActiveIntersection.Right) {
      this.intersectionSwitch[position] = ActiveIntersection.Left;
    }
    // If route is disabled, jump to next route
    if (
      this.possibleRoutes[this.currentRotation][position][
        this.intersectionSwitch[position]
      ].disabled
    ) {
      this.changeSwitch(position);
      return;
    }
  }

  getTrainRoute() {
    const trainPosition = this.getIncomingTrainPosition();
    if (trainPosition !== null) {
      return this.possibleRoutes[this.currentRotation][trainPosition][
        this.intersectionSwitch[trainPosition]
      ];
    }
    return null;
  }

  animationDuration() {
    const trainPosition = this.getIncomingTrainPosition();
    if (trainPosition !== null) {
      if (
        this.intersectionSwitch[trainPosition] === ActiveIntersection.Straight
      ) {
        return 2;
      } else {
        return 1.7;
      }
    }
    return 2;
  }

  animateTrain(trainObject: TrainObject) {
    // Identify route
    const trainRoute = this.getTrainRoute();
    console.warn("animateTrain", trainObject.id);
    if (trainRoute) {
      // Define tile exit
      trainObject.x += this.getLeavingTrainCoordinates().x;
      trainObject.y += this.getLeavingTrainCoordinates().y;

      // Animate
      const trainPath = trainRoute.path;
      trainObject.animation
        .to(
          trainObject.visual,
          {
            ease: "none",
            duration: this.animationDuration(),
            motionPath: {
              align: "self",
              autoRotate: 90,
              path: trainPath,
            },
            onComplete: () => this.trainLeavesTile(trainObject),
          },
          trainObject.id
        )
        .addLabel(trainObject.id, ">");
      // Wagon trial
      if (trainObject.wagons) {
        trainObject.wagons!.map((wagon, index) => {
          trainObject.animation
            .to(
              wagon.visual,
              {
                ease: "none",
                duration: this.animationDuration(),
                motionPath: {
                  align: "self",
                  autoRotate: 90,
                  path: trainPath,
                },
                // onComplete: () => this.trainLeavesTrafficLight(trainObject),
              },
              wagon.id
            )
            .addLabel(wagon.id, ">");
        });
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.switch-box {
  background-color: black;
  z-index: 20;
  position: absolute;

  ::v-deep circle {
    fill: white;
    transition: all 0.5s cubic-bezier(0.89, 0.27, 0.78, 0.59);
  }

  &.switch-box--0 {
    left: 57%;
    top: 0;
    transform: rotate(180deg);
  }
  &.switch-box--1 {
    right: 0;
    top: 57%;
    transform: rotate(-90deg);
  }
  &.switch-box--2 {
    left: 57%;
    bottom: 0;
  }
  &.switch-box--3 {
    left: 0;
    top: 57%;
    transform: rotate(90deg);
  }

  ::v-deep .bulp--direction {
    opacity: 0.4;
  }

  &.signal--straight {
    ::v-deep .bulb--straight {
      opacity: 1;
    }
  }
  &.signal--right {
    ::v-deep .bulb--right {
      opacity: 1;
    }
  }
  &.signal--left {
    ::v-deep .bulb--left {
      opacity: 1;
    }
  }
}
</style>
