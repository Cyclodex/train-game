<template>
  <div class="tile" :class="tileStatusStyle">
    <debug-show-routes :routes="allPossibleRoutesWithCurrentRotation" />
  </div>
</template>

<script lang="ts">
import {
  Component,
  Emit,
  InjectReactive,
  Prop,
  Vue,
  Watch,
} from "vue-property-decorator";
import { gsap } from "gsap";
import {
  CheckStatusFeedback,
  LevelDefinition,
  Position,
  PossibleRoutesPerRotation,
  Rotations,
  TileObject,
  TileStatus,
  TrainDirection,
  TrainObject,
  TrainsDefinition,
  TrainStatus,
} from "@/types";

@Component
export default class TileBase extends Vue {
  @InjectReactive() level!: LevelDefinition;
  @InjectReactive() trains!: TrainsDefinition;

  @Prop({ type: Object, default: () => ({}) }) tile!: TileObject;
  tileSize = this.$root.tileSize;
  currentRotation: Rotations = Rotations.Top;
  possibleRoutes!: PossibleRoutesPerRotation;
  status: TileStatus = TileStatus.Free;

  created() {
    if (this.$props.tile.rotation) {
      this.currentRotation = this.$props.tile.rotation;
    }
  }

  get tileStatusStyle() {
    switch (this.status) {
      case TileStatus.Free:
        return "tile-status--free";
      case TileStatus.Reserved:
        return "tile-status--reserved";
      case TileStatus.Blocked:
        return "tile-status--blocked";
      default:
        return "";
    }
  }

  getRouteFromEntrancePosition(entrancePosition: Position) {
    return this.possibleRoutes[this.currentRotation][entrancePosition];
  }

  checkStatus(entrancePosition: Position): CheckStatusFeedback {
    const route = this.getRouteFromEntrancePosition(entrancePosition);
    const routeHasTrafficLight = !!route.trafficLight;
    const leaving = this.getRelativeCoordinatesOfNextTile(
      route.leavesAtPosition
    );
    return {
      status: this.status,
      hasTrafficLight: routeHasTrafficLight,
      nextCoordinates: {
        x: this.tile.x + leaving.x,
        y: this.tile.y + leaving.y,
      },
    };
  }

  reserveTile() {
    this.status = TileStatus.Reserved;
  }

  @Watch("tile.train", { immediate: true, deep: false })
  incomingTrain(incomingTrainObject: TrainObject, oldTrain: TrainObject) {
    if (incomingTrainObject?.id !== oldTrain?.id) {
      const train = document.getElementById(incomingTrainObject.id);
      if (train) {
        this.animateTrain(incomingTrainObject, train);
        this.status = TileStatus.Blocked;
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

  // Only example function, tiles need to override this logic
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

  get currentTrain() {
    return this.trains[this.tile.train!.id]!;
  }

  @Emit("updateTrain")
  trainStopping() {
    return { id: this.currentTrain.id, status: TrainStatus.Stopping };
  }

  @Emit("updateTrain")
  trainStopped() {
    return { id: this.currentTrain.id, status: TrainStatus.Stopped };
  }

  @Emit("updateTrain")
  trainStarted() {
    return { id: this.currentTrain.id, status: TrainStatus.Started };
  }

  @Emit("updateTrain")
  trainRunning() {
    return { id: this.currentTrain.id, status: TrainStatus.Running };
  }

  @Emit("trainLeavesTile")
  trainLeavesTile(trainObject: TrainObject) {
    // Clear Tile Status after a while
    setTimeout(() => {
      this.status = TileStatus.Free;
    }, 1000);
    return { ...trainObject };
  }
}
</script>

<style>
.tile {
  width: 100%;
  height: 100%;
}

.tile-status--unknown {
  background-color: white;
}
.tile-status--free {
  background-color: rgb(104, 185, 104);
}
.tile-status--reserved {
  background-color: yellow;
}
.tile-status--blocked {
  background-color: red;
}
</style>
