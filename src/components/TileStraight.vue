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

@Component
class TileStraight extends TileBase {
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
  }

  rotate() {
    this.currentRotation++;
    if (this.currentRotation > Rotations.Right) {
      this.currentRotation = Rotations.Top;
    }
    // Publish the live rotation to the level so the simulation routes through it.
    this.tile.rotation = this.currentRotation;
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
}
</style>
