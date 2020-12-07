<template>
  <div class="tile">
    <debug-show-routes :routes="allPossibleRoutesWithCurrentRotation" />
  </div>
</template>

<script lang="ts">
import { Component, Emit, Prop, Vue, Watch } from "vue-property-decorator";
import { gsap } from "gsap";
import {
  Position,
  PossibleRoutesPerRotation,
  Rotations,
  TileObject,
  TrainDirection,
  TrainObject,
} from "@/types";

@Component
export default class TileBase extends Vue {
  @Prop({ type: Object, default: () => ({}) }) tile!: TileObject;
  tileSize = this.$root.tileSize;
  currentRotation: Rotations = Rotations.Top;
  possibleRoutes!: PossibleRoutesPerRotation;

  created() {
    if (this.$props.tile.rotation) {
      this.currentRotation = this.$props.tile.rotation;
    }
  }

  @Watch("tile.train", { immediate: true, deep: false })
  incomingTrain(incomingTrainObject: TrainObject, oldTrain: TrainObject) {
    if (incomingTrainObject?.id !== oldTrain?.id) {
      const train = document.getElementById(incomingTrainObject.id);
      if (train) {
        this.animateTrain(incomingTrainObject, train);
      }
    }
  }

  get allPossibleRoutesWithCurrentRotation() {
    return this.possibleRoutes[this.currentRotation];
  }

  get trainRoute() {
    if (this.incomingTrainPosition !== null) {
      // TODO: This could return nothing -> Train crashes because no route attached
      return this.possibleRoutes[this.currentRotation][
        this.incomingTrainPosition
      ];
    }
    return null;
  }

  get incomingTrainPosition() {
    return this.getIncomingTrainLocation(this.tile.train || null);
  }

  getIncomingTrainLocation(trainObject: TrainObject | null) {
    if (trainObject === null) return null;

    switch (trainObject.direction) {
      case TrainDirection.Down:
        return Position.Top;
      case TrainDirection.Left:
        return Position.Right;
      case TrainDirection.Up:
        return Position.Bottom;
      case TrainDirection.Right:
        return Position.Left;
      default:
        return Position.Top;
    }
  }

  get getLeavingTrainCoordinates() {
    if (this.trainRoute) {
      return this.getRelativeCoordinatesOfNextTile(
        this.trainRoute.leavesAtPosition
      );
    }
    return { x: 0, y: 0 };
  }

  getRelativeCoordinatesOfNextTile(leavingPosition: Position) {
    switch (leavingPosition) {
      case Position.Top:
        return { x: 0, y: -1 };
      case Position.Right:
        return { x: 1, y: 0 };
      case Position.Bottom:
        return { x: 0, y: 1 };
      case Position.Left:
        return { x: -1, y: 0 };
      default:
        return { x: 0, y: 0 };
    }
  }

  animateTrain(trainObject: TrainObject, train: HTMLElement) {
    // Define tile exit
    trainObject.y += 1;

    // Animate
    gsap.to(train, {
      duration: 2,
      y: `+=${this.tileSize}`,
      onComplete: () => this.trainLeavesTile(trainObject),
    });
  }

  @Emit("trainLeavesTile")
  trainLeavesTile(trainObject: TrainObject) {
    console.log(trainObject);
    return { ...trainObject };
  }
}
</script>

<style>
.tile {
  background-color: lightgreen;
  width: 100%;
  height: 100%;
}
</style>
