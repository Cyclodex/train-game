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
} from "vue-property-decorator";
import {
  CheckStatusFeedback,
  LevelDefinition,
  Position,
  PossibleRoutesPerRotation,
  Rotations,
  Route,
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
  tileSize!: number;
  currentRotation: Rotations = Rotations.Top;
  possibleRoutes!: PossibleRoutesPerRotation;
  status: TileStatus = TileStatus.Free;
  train!: TrainObject;

  created() {
    this.tileSize = this.$root.tileSize;
    if (this.$props.tile.rotation) {
      this.currentRotation = this.$props.tile.rotation;
    }
  }

  get tileStatusStyle() {
    if (!this.$root.debug) return "";
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

  incomingTrain(trainId: string) {
    this.train = this.trains[trainId];
    if (this.train.visual) {
      this.animateTrain({ ...this.train });
      this.status = TileStatus.Blocked;
    }
  }

  get allPossibleRoutesWithCurrentRotation() {
    return this.possibleRoutes[this.currentRotation];
  }

  get allDrawableRailRoutes(): Route[] {
    // Take the same rotation as position
    const route = this.possibleRoutes[this.currentRotation][
      this.currentRotation
    ];
    return Array(route);
  }

  getTrainRoute() {
    const trainPosition = this.getIncomingTrainPosition();
    if (trainPosition !== null) {
      return this.possibleRoutes[this.currentRotation][trainPosition];
    }
    return null;
  }

  getIncomingTrainPosition() {
    return this.getIncomingTrainLocation(this.train || null);
  }

  getIncomingTrainLocation(trainObject: TrainObject = this.train) {
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

  getLeavingTrainCoordinates() {
    const trainRoute = this.getTrainRoute();
    if (trainRoute) {
      return this.getRelativeCoordinatesOfNextTile(trainRoute.leavesAtPosition);
    }
    console.error("getLeavingTrainCoordinates: no route");
    debugger;
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
  animateTrain(trainObject: TrainObject) {
    // Define tile exit
    trainObject.y += 1;

    // Animate
    trainObject.animation.to(trainObject.visual, {
      duration: 2,
      y: `+=${this.tileSize}`,
      onComplete: () => this.trainLeavesTile(trainObject),
    });
  }

  get currentTrain() {
    return this.trains[this.train!.id] || null;
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

  getCoordinates(
    simplePath: string,
    xChange: "-" | "+" | string = "",
    yChange: "-" | "+" | string = ""
  ) {
    const center = this.tileSize / 2;
    const full = this.tileSize;
    const distance = this.$root.railDistanceFromPath;
    const centerX = Number(xChange + this.$root.railDistanceFromPath);
    const centerY = Number(yChange + this.$root.railDistanceFromPath);

    let coordinates;
    coordinates = simplePath.replaceAll("T-", `${center - distance} 0`);
    coordinates = coordinates.replaceAll("T+", `${center + distance} 0`);
    coordinates = coordinates.replaceAll("T", `${center} 0`);
    coordinates = coordinates.replaceAll("R-", `${full} ${center - distance}`);
    coordinates = coordinates.replaceAll("R+", `${full} ${center + distance}`);
    coordinates = coordinates.replaceAll("R", `${full} ${center}`);
    coordinates = coordinates.replaceAll("B-", `${center - distance} ${full}`);
    coordinates = coordinates.replaceAll("B+", `${center + distance} ${full}`);
    coordinates = coordinates.replaceAll("B", `${center} ${full}`);
    coordinates = coordinates.replaceAll("L-", `0 ${center - distance}`);
    coordinates = coordinates.replaceAll("L+", `0 ${center + distance}`);
    coordinates = coordinates.replaceAll("L", `0 ${center}`);
    coordinates = coordinates.replaceAll("CX", `${center + centerX}`);
    coordinates = coordinates.replaceAll("CY", `${center + centerY}`);
    coordinates = coordinates.replaceAll("C", `${center} ${center}`);
    return coordinates;
  }

  // Curve always through the center of the tile
  getPathCurve(from: "T" | "R" | "B" | "L", to: "T" | "R" | "B" | "L") {
    return this.getCoordinates(`M ${from} Q C ${to}`);
  }
  getPathStraight(from: "T" | "R" | "B" | "L", to: "T" | "R" | "B" | "L") {
    return this.getCoordinates(`M ${from} ${to}`);
  }

  // Rails are neg or pos off from the path, with special handling for the center
  getRailCurve(
    from: "T-" | "T+" | "R-" | "R+" | "B-" | "B+" | "L-" | "L+",
    to: "T-" | "T+" | "R-" | "R+" | "B-" | "B+" | "L-" | "L+"
  ) {
    let xChange, yChange;
    const fromLocation = from.substring(0, 1);
    const fromChange = from.substring(1);
    const toChange = to.substring(1);
    if (fromLocation === "T" || fromLocation === "B") {
      // from is X modifiers
      xChange = fromChange;
      yChange = toChange;
    } else {
      // from is Y modifiers
      xChange = toChange;
      yChange = fromChange;
    }
    return this.getCoordinates(`M ${from} Q CX CY ${to}`, xChange, yChange);
  }

  getRailStraight(
    from: "T-" | "T+" | "R-" | "R+" | "B-" | "B+" | "L-" | "L+",
    to: "T-" | "T+" | "R-" | "R+" | "B-" | "B+" | "L-" | "L+"
  ) {
    return this.getCoordinates(`M ${from} ${to}`);
  }
}
</script>

<style>
.tile {
  width: 100%;
  height: 100%;
  background-color: rgb(104, 185, 104);
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
