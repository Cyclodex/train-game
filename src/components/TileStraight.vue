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
    :style="reservationStyle"
    @click="rotate"
  >
    <TileRail :possible-routes="allDrawableRailRoutes" />
    <svg
      v-for="light in signalLights"
      :key="light.exitPort"
      class="signal"
      :class="[
        `signal--${light.exitPort}`,
        {
          'signal--forced-green': light.override === 'green',
          'signal--forced-red': light.override === 'red',
        },
      ]"
      width="12"
      height="20"
      :title="
        light.override === 'green'
          ? 'Forced GREEN (click to force red)'
          : light.override === 'red'
          ? 'Forced RED (click for auto)'
          : 'Auto (click to force green)'
      "
      @click.stop="cycleSignal(light.exitPort)"
    >
      <!-- A coloured frame marks a manual override: green = forced proceed,
           red = forced stop. No frame means automatic interlocking. -->
      <rect
        width="12"
        height="20"
        rx="3"
        fill="#222"
        :stroke="
          light.override === 'green'
            ? '#34c759'
            : light.override === 'red'
            ? '#ff3b30'
            : 'none'
        "
        stroke-width="2"
      />
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
      override: this.signalOverrideFor(exitPort),
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
// Signals sit beside the track, not on it: each is offset to the right-hand
// side of its own direction of travel (railway convention), which also places
// the two signals of a straight tile on opposite sides of the rails.
$signal-offset: 20px;

.signal--0 {
  // Top exit (travelling up) -> signal to the right (east) of the track
  top: 2px;
  left: calc(50% + #{$signal-offset});
  transform: translateX(-50%);
}
.signal--1 {
  // Right exit (travelling right) -> signal below (south) the track
  right: 2px;
  top: calc(50% + #{$signal-offset});
  transform: translateY(-50%);
}
.signal--2 {
  // Bottom exit (travelling down) -> signal to the left (west) of the track
  bottom: 2px;
  left: calc(50% - #{$signal-offset});
  transform: translateX(-50%);
}
.signal--3 {
  // Left exit (travelling left) -> signal above (north) the track
  left: 2px;
  top: calc(50% - #{$signal-offset});
  transform: translateY(-50%);
}
</style>
