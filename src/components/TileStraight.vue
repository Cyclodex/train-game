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
      v-for="light in signalLights"
      :key="light.exitPort"
      class="signal"
      :class="`signal--${light.exitPort}`"
      width="12"
      height="20"
      @click.stop="toggleSignalHold(light.exitPort)"
    >
      <rect width="12" height="20" rx="3" fill="#222" />
      <circle
        cx="6"
        cy="6"
        r="4"
        :fill="light.aspect === 'stop' ? '#ff3b30' : '#5a1512'"
      />
      <circle
        cx="6"
        cy="14"
        r="4"
        :fill="light.aspect === 'proceed' ? '#34c759' : '#14361d'"
      />
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

  // One signal per exit direction of this (straight) tile, coloured by the
  // simulation's aspect for that direction.
  get signalLights() {
    if (!this.isSignalTile) return [];
    const exits =
      this.currentRotation % 2 === 0
        ? [Position.Top, Position.Bottom]
        : [Position.Right, Position.Left];
    return exits.map(exitPort => ({
      exitPort,
      aspect: this.signalAspectFor(exitPort),
    }));
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
.tile-straight {
  position: relative;
}
.signal {
  position: absolute;
  z-index: 14;
  cursor: pointer;
}
.signal--0 {
  // Top
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
}
.signal--1 {
  // Right
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
}
.signal--2 {
  // Bottom
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
}
.signal--3 {
  // Left
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
}
</style>
