<template>
  <div
    class="tile tile-curve clickable"
    :class="tileStatusStyle"
    :style="reservationStyle"
    @click="rotate"
  >
    <TileRail :possible-routes="allDrawableRailRoutes" />
    <div v-if="config.debug" class="debug">
      <div class="">R: {{ currentRotation }}</div>
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
import { Position, Rotations } from "@/types";
import TileBase from "./TileBase";

// Info
// t=top, r=rigth, b=bottom, l=left

@Component
class TileCurve extends TileBase {
  created() {
    this.initRoutes();
  }

  initRoutes(): void {
    this.possibleRoutes = {
      [Rotations.Top]: {
        [Position.Top]: {
          path: this.getPathCurve("T", "R"),
          rails: [this.getRailCurve("T-", "R+"), this.getRailCurve("T+", "R-")],
          leavesAtPosition: Position.Right,
        },
        [Position.Right]: {
          path: this.getPathCurve("R", "T"),
          leavesAtPosition: Position.Top,
        },
      },
      [Rotations.Right]: {
        [Position.Right]: {
          path: this.getPathCurve("R", "B"),
          rails: [this.getRailCurve("R-", "B-"), this.getRailCurve("R+", "B+")],
          leavesAtPosition: Position.Bottom,
        },
        [Position.Bottom]: {
          path: this.getPathCurve("B", "R"),
          leavesAtPosition: Position.Right,
        },
      },
      [Rotations.Bottom]: {
        [Position.Bottom]: {
          path: this.getPathCurve("B", "L"),
          rails: [this.getRailCurve("B-", "L+"), this.getRailCurve("B+", "L-")],
          leavesAtPosition: Position.Left,
        },
        [Position.Left]: {
          path: this.getPathCurve("L", "B"),
          leavesAtPosition: Position.Bottom,
        },
      },
      [Rotations.Left]: {
        [Position.Left]: {
          path: this.getPathCurve("L", "T"),
          rails: [this.getRailCurve("L-", "T-"), this.getRailCurve("L+", "T+")],
          leavesAtPosition: Position.Top,
        },
        [Position.Top]: {
          path: this.getPathCurve("T", "L"),
          leavesAtPosition: Position.Left,
        },
      },
    };
  }

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.Left) {
      this.currentRotation = Rotations.Top;
    }
    this.tile.rotation = this.currentRotation;
  }
}

export default toNative(TileCurve);
</script>
