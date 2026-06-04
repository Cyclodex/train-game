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
    </div>
  </div>
</template>

<script lang="ts">
import { Component, toNative } from "vue-facing-decorator";
import { Position, PossibleRoutesPerRotation, Rotations } from "@/types";
import { TileStraight } from "./TileStraight.vue";
import { getCoordinatesId } from "@/utils/tileHelpers";
import depotBuildingImg from "@/assets/depot.png";

@Component
class TileDepot extends TileStraight {
  possibleRoutes: PossibleRoutesPerRotation = {};
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
    this.initRoutes();
  }

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.Left) {
      this.currentRotation = Rotations.Top;
    }
    this.tile.rotation = this.currentRotation;
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
