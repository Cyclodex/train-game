<template>
  <div
    class="tile tile-curve clickable"
    :class="tileStatusStyle"
    @click.exact="rotate"
    @click.ctrl="changeSwitch"
  >
    <TileRail :possible-routes="allDrawableRailRoutes" />
    <div v-if="$root.debug" class="debug">
      <div class="">R: {{ currentRotation }}</div>
      <div class="">Switch: {{ intersectionSwitch }}</div>
      <!-- <div v-if="getTrainRoute()" class="">
        T Route:<br />{{ getTrainRoute().path }}
      </div> -->
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
  Route,
  TrainObject,
} from "@/types";
import TileBase from "./TileBase.vue";
import { gsap } from "gsap";

// Info
// t=top, r=rigth, b=bottom, l=left

@Component
export default class TileIntersection extends TileBase {
  intersectionSwitch: ActiveIntersection = ActiveIntersection.Left;
  possibleRoutes!: PossibleRoutesPerRotation | any;

  created() {
    this.initRoutes();

    if (this.$props.tile.activeRoute) {
      this.intersectionSwitch = this.$props.tile.activeRoute;
    }
    this.initIntersection();
  }

  initIntersection() {
    // TODO: should be re-called when rotating the tile
    if (this.$props.tile.disabledRoutes) {
      this.$props.tile.disabledRoutes.map((disableRouteIndex: number) => {
        const disableRoute: Route = this.possibleRoutes[this.currentRotation][
          this.currentRotation
        ][disableRouteIndex];
        disableRoute.disabled = true;
        // Disable also the return route
        this.possibleRoutes[this.currentRotation][
          disableRoute.leavesAtPosition
        ].disabled = true;
      });
    }
  }

  initRoutes(): void {
    this.possibleRoutes = {
      [Rotations.Top]: {
        [Position.Top]: {
          [ActiveIntersection.Left]: {
            path: this.getPathCurve("T", "R"),
            rails: [
              this.getRailCurve("R-", "T+"),
              this.getRailCurve("R+", "T-"),
            ],
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
            rails: [
              this.getRailCurve("L-", "T-"),
              this.getRailCurve("L+", "T+"),
            ],
            leavesAtPosition: Position.Left,
          },
        },
        [Position.Right]: {
          path: this.getPathCurve("R", "T"),
          leavesAtPosition: Position.Top,
        },
        [Position.Bottom]: {
          path: this.getPathStraight("B", "T"),
          leavesAtPosition: Position.Top,
        },
        [Position.Left]: {
          path: this.getPathCurve("L", "T"),
          leavesAtPosition: Position.Top,
        },
      },
      [Rotations.Right]: {
        [Position.Right]: {
          [ActiveIntersection.Left]: {
            path: this.getPathCurve("R", "B"),
            rails: [
              this.getRailCurve("B-", "R-"),
              this.getRailCurve("B+", "R+"),
            ],
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
            rails: [
              this.getRailCurve("T-", "R+"),
              this.getRailCurve("T+", "R-"),
            ],

            leavesAtPosition: Position.Top,
          },
        },
        [Position.Bottom]: {
          path: this.getPathCurve("B", "R"),
          leavesAtPosition: Position.Right,
        },
        [Position.Left]: {
          path: this.getPathStraight("L", "R"),
          leavesAtPosition: Position.Right,
        },
        [Position.Top]: {
          path: this.getPathCurve("T", "R"),
          leavesAtPosition: Position.Right,
        },
      },
      [Rotations.Bottom]: {
        [Position.Bottom]: {
          [ActiveIntersection.Left]: {
            path: this.getPathCurve("B", "L"),
            rails: [
              this.getRailCurve("L-", "B+"),
              this.getRailCurve("L+", "B-"),
            ],

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
            rails: [
              this.getRailCurve("R-", "B-"),
              this.getRailCurve("R+", "B+"),
            ],

            leavesAtPosition: Position.Right,
          },
        },
        [Position.Left]: {
          path: this.getPathCurve("L", "B"),
          leavesAtPosition: Position.Bottom,
        },
        [Position.Top]: {
          path: this.getPathStraight("T", "B"),
          leavesAtPosition: Position.Bottom,
        },
        [Position.Right]: {
          path: this.getPathCurve("R", "B"),
          leavesAtPosition: Position.Bottom,
        },
      },
      [Rotations.Left]: {
        [Position.Left]: {
          [ActiveIntersection.Left]: {
            path: this.getPathCurve("L", "T"),
            rails: [
              this.getRailCurve("T-", "L-"),
              this.getRailCurve("T+", "L+"),
            ],
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
            rails: [
              this.getRailCurve("B-", "L+"),
              this.getRailCurve("B+", "L-"),
            ],
            leavesAtPosition: Position.Bottom,
          },
        },
        [Position.Top]: {
          path: this.getPathCurve("T", "L"),
          leavesAtPosition: Position.Left,
        },
        [Position.Right]: {
          path: this.getPathStraight("R", "L"),

          leavesAtPosition: Position.Left,
        },
        [Position.Bottom]: {
          path: this.getPathCurve("B", "L"),
          leavesAtPosition: Position.Left,
        },
      },
    };
  }

  getRouteFromEntrancePosition(entrancePosition: Position) {
    if (Number(entrancePosition) === Number(this.currentRotation)) {
      return this.possibleRoutes[this.currentRotation][entrancePosition][
        this.intersectionSwitch
      ];
    }
    return this.possibleRoutes[this.currentRotation][entrancePosition];
  }

  get allSwitchableRoutes() {
    return this.possibleRoutes[this.currentRotation][this.currentRotation];
  }

  get allDrawableRailRoutes() {
    // Take the same rotation as position
    const routes = this.possibleRoutes[this.currentRotation][
      this.currentRotation
    ] as Route[];
    const routesIteratable = Object.values(routes);
    const enabledRoutes: Route[] = routesIteratable.filter(
      route => !!route.path && !route.disabled
    );
    return enabledRoutes;
  }

  get activeSwitchRoute() {
    return this.allSwitchableRoutes[this.intersectionSwitch];
  }

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.Left) {
      this.currentRotation = Rotations.Top;
    }
    this.initIntersection();
  }

  changeSwitch() {
    this.intersectionSwitch++;
    if (this.intersectionSwitch > ActiveIntersection.Right) {
      this.intersectionSwitch = ActiveIntersection.Left;
    }
    // If route is disabled, jump to next route
    if (
      this.possibleRoutes[this.currentRotation][this.currentRotation][
        this.intersectionSwitch
      ].disabled
    ) {
      this.changeSwitch();
      return;
    }
  }

  getTrainRoute(trainObject: TrainObject) {
    const trainPosition = this.getIncomingTrainLocation(trainObject);
    if (trainPosition !== null) {
      // TODO: This could return nothing -> Train crashes because no route attached
      if (Number(trainPosition) === Number(this.currentRotation)) {
        return this.possibleRoutes[this.currentRotation][trainPosition][
          this.intersectionSwitch
        ];
      }
      return this.possibleRoutes[this.currentRotation][trainPosition];
    }
    return null;
  }
}
</script>

<style scoped></style>
