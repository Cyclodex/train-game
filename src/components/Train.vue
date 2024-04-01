<script lang="ts">
import {
  CheckedRoutesObject,
  CheckedRoutesString,
  CheckStatusFeedback,
  Coordinates,
  LevelDefinition,
  Rotations,
  Route,
  RouteDestinations,
  TrainObject,
  TrainsDefinition,
  TrainStatus,
  Wagon,
} from "@/types";
import { getCoordinatesId, getTileEntrancePosition } from "@/utils/tileHelpers";
import {
  getLeavingTrainCoordinates,
  getTrainDirection,
} from "@/utils/trainHelpers";
import gsap from "gsap";
import { Component, InjectReactive, Prop, Vue } from "vue-property-decorator";
import { Colors, getRandom } from "@/utils/globalHelpers";

@Component
export default class Train extends Vue {
  @InjectReactive() trains!: TrainsDefinition;
  @InjectReactive() level!: LevelDefinition;

  @Prop({ type: Object, default: {} }) trainObject!: TrainObject;
  initialPosition = {};
  timeScale = 1;
  trainVisuals = {
    locos: {
      people: {
        backgroundImage: `url(${require("@/assets/locomotivePeople.png")})`,
      },
      fraight: {
        backgroundImage: `url(${require("@/assets/locomotiveFraight.png")})`,
      },
    },
    wagons: {
      people: {
        wagonPeople: {
          backgroundImage: `url(${require("@/assets/wagonPeople.png")})`,
        },
      },
      fraight: {
        wagonFraight1: {
          backgroundImage: `url(${require("@/assets/wagonFraight1.png")})`,
        },
        wagonFraight2: {
          backgroundImage: `url(${require("@/assets/wagonFraight2.png")})`,
        },
        wagonFraight3: {
          backgroundImage: `url(${require("@/assets/wagonFraight3.png")})`,
        },
        wagonFraight4: {
          backgroundImage: `url(${require("@/assets/wagonFraight4.png")})`,
        },
      },
    },
  };
  id = "";
  visual!: HTMLElement | null;
  wagons?: Wagon[] = [];
  route?: Route;
  routeDestinations?: RouteDestinations[] = [];
  currentRouteDestination = 0;
  type: "people" | "fraight" = "people";
  wagonAnimationDistance = 0.95;
  initialRotation = 0;
  trainInitialyVertical = false;
  trainColor = "";

  created() {
    this.id = this.trainObject.id;
    this.wagons = this.trainObject.wagons;
    this.type = this.trainObject.type;

    // Random color generater
    this.trainColor = this.trainObject.trainColor = getRandom(Colors);

    if (this.type === "fraight") {
      this.wagonAnimationDistance = 0.8;
    }
    this.routeDestinations = this.trainObject.routeDestinations;

    this.setInitialPosition();

    // Creating the trains animation timeline
    const trainTimeline = gsap
      .timeline({
        id: this.trainObject.id,
      })
      .timeScale(0);
    this.trainObject.animation = trainTimeline;
  }

  async mounted() {
    // Init train and move to first tile
    // Initialize "visual" dom mapper for animations
    this.visual = document.getElementById(this.id);
    if (this.trainObject.wagons !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.wagons!.map(wagon => {
        wagon.visual = document.getElementById(wagon.id);
      });
    }

    const coordId = getCoordinatesId(this.trainObject);
    const tile = (this.$parent!.$refs[coordId] as any)[0];
    this.route = tile.getTrainRoute(this.trainObject);

    this.initialRotation = tile.currentRotation;
    this.trainInitialyVertical =
      this.initialRotation === Rotations.Top ||
      this.initialRotation === Rotations.Bottom
        ? true
        : false;

    // Check for planned Destination
    if (this.$root.automaticRoutePlanning) {
      await this.doRoutePlanning();
    }

    // Move train to first tile
    tile.incomingTrain(this.id);

    // Start train from depot
    if (this.trainObject.status === TrainStatus.LeavingDepot) {
      this.startTrainFromDepot();
    } else if (this.trainObject.status === TrainStatus.Init) {
      this.trainReadyOnDepot();
    }
  }

  trainReadyOnDepot() {
    // do soemthing
  }

  doRoutePlanning() {
    return new Promise<void>((resolve, reject) => {
      if (this.trainObject.routeDestinations) {
        const originCoordinates = {
          x: this.trainObject.x,
          y: this.trainObject.y,
        };
        const nextTileCoordinates = getLeavingTrainCoordinates(
          this.route!,
          originCoordinates
        );

        this.trainObject.routeDestinations.map(routeToNextDestination => {
          const destination = routeToNextDestination.to;
          const possibleRoutes = this.checkRoutesOnNextTile(
            nextTileCoordinates,
            originCoordinates,
            destination
          );
          // Remove all routes that do not end on the destination
          const possibleRoutesWithDestinationMatch: any = Object.values(
            possibleRoutes
          ).filter((route: any) => route[route.length - 1] === destination);

          // Get the shortes route
          const shortest = possibleRoutesWithDestinationMatch.reduce(
            function(p: any, c: any) {
              return p.length > c.length ? c : p;
            },
            { length: Infinity }
          );

          routeToNextDestination.routes = possibleRoutesWithDestinationMatch;
          routeToNextDestination.selectedRoute = shortest;
        });
      }
      resolve();
    });
  }

  currentRouteIndex = 0;

  checkRoutesOnNextTile(
    nextTileCoordinates: Coordinates,
    originCoordinates: Coordinates,
    destination: string,
    checkedRoutes: CheckedRoutesString | CheckedRoutesObject | any = {},
    currentRouteIndex = ""
  ): any {
    const tilePosition: string = getCoordinatesId(nextTileCoordinates);
    const tileEntrancePosition = getTileEntrancePosition(
      nextTileCoordinates,
      originCoordinates
    );
    const routeTileId = tilePosition + "-" + tileEntrancePosition;
    let tileAlreadyVisited = false;

    // Create route array for new RouteIndex
    if (!checkedRoutes[currentRouteIndex]) {
      checkedRoutes[currentRouteIndex] = [];
    }
    // Check if it already has route elements
    if (checkedRoutes[currentRouteIndex].length > 0) {
      const alreadyVisited = checkedRoutes[currentRouteIndex].indexOf(
        tilePosition
      );
      if (alreadyVisited !== -1) {
        tileAlreadyVisited = true;
      }
    }

    // Check on tile
    if (this.level[tilePosition]) {
      const tile = (this.$parent!.$refs[tilePosition] as any)[0];
      // Check tile status
      const tileStatus = tile.checkStatus(tileEntrancePosition) as
        | CheckStatusFeedback
        | false;

      // Stop if destination matches, is already visited or status is false (broken connection)
      // TODO: we might not stop when tile was visited, but the exact path!
      if (
        tilePosition === destination ||
        tileAlreadyVisited ||
        tileStatus === false
      ) {
        // Add current tile to route
        checkedRoutes[currentRouteIndex].push(tilePosition);
        return;
      } else if (!tileStatus.possibleRoutes.path) {
        // No direct path
        // Check multiple paths and remove disabled ones:
        const iterableRoutes = Object.values(tileStatus.possibleRoutes).filter(
          route => !!route.path && !route.disabled
        );

        // Create copies of current path for possible routes
        iterableRoutes.map(route => {
          // Index = x,y-P1,P2
          const newRouteIndex =
            getCoordinatesId(nextTileCoordinates) +
            "-" +
            tileEntrancePosition +
            "," +
            route.leavesAtPosition;

          // If this exact path was already visited and checked, dont do it again
          if (checkedRoutes[newRouteIndex]) {
            return false;
          }

          // Make copy of current path, as base for the new splitted route
          checkedRoutes[newRouteIndex] = checkedRoutes[
            currentRouteIndex
          ].slice();

          // Add current tile to route
          checkedRoutes[newRouteIndex].push({
            routeTileId: routeTileId,
            entrancePosition: tileEntrancePosition,
            leavesAtPosition: route.leavesAtPosition,
            intersectionSwitchPosition: route.intersectionSwitchPosition,
          });

          this.checkRoutesOnNextTile(
            route.nextCoordinates,
            nextTileCoordinates,
            destination,
            checkedRoutes,
            newRouteIndex
          );
        });
      } else {
        // Add current tile to route
        checkedRoutes[currentRouteIndex].push(tilePosition);
        // Call next tile
        this.checkRoutesOnNextTile(
          tileStatus.nextCoordinates,
          nextTileCoordinates,
          destination,
          checkedRoutes,
          currentRouteIndex
        );
      }
      return checkedRoutes;
    }
  }

  startStopTrain() {
    this.timeScale = this.timeScale === 1 ? 0 : 1;
    if (this.timeScale === 0) {
      this.stopTrain();
    } else {
      this.startTrain();
    }
  }

  startTrain() {
    this.trainStarted();
    gsap.to(this.trainObject.animation, {
      duration: 10,
      timeScale: 1,
    });
  }

  stopTrain() {
    this.trainStopping();
    gsap.to(this.trainObject.animation, {
      duration: 4,
      timeScale: 0,
      onComplete: () => this.trainStopped(),
    });
  }

  stopTrainInDepot() {
    this.trainStoppingInDepot();
    gsap.to(this.trainObject.animation, {
      duration: 10,
      timeScale: 0.5,
      onComplete: () => this.trainStoppedInDepot(),
    });
  }

  setInitialPosition() {
    const tilePositionX = this.$root.tileSize / 2;
    const tilePositionY = this.$root.tileSize / 2;
    this.initialPosition = {
      left: this.trainObject.x * this.$root.tileSize + tilePositionX + "px",
      top: this.trainObject.y * this.$root.tileSize + tilePositionY + "px",
    };
  }

  // TODO Check if this can be done with animateTrain()
  startTrainFromDepot() {
    this.trainStarted();
    // const trainObject = { ...this.trainObject };
    const trainRoute = this.route;
    if (trainRoute) {
      const trainPath = trainRoute.path;
      // Animate train out of the box, and add all wagons accordingly
      this.trainObject.animation
        .to(
          this.visual,
          {
            ease: "none",
            duration: 1,
            motionPath: {
              align: "self",
              autoRotate: "auto",
              path: trainPath,
            },
            onComplete: () => this.trainLeavesTile(),
          },
          this.trainObject.id
        )
        .addLabel(this.trainObject.id, ">");
      // Wagon trial
      if (this.trainObject.wagons) {
        this.trainObject.wagons!.map((wagon, index) => {
          this.trainObject.animation
            .to(
              wagon.visual,
              {
                ease: "none",
                duration: 1,
                motionPath: {
                  align: "self",
                  autoRotate: "auto",
                  path: trainPath,
                },
              },
              (index + 1) * this.wagonAnimationDistance
            )
            .addLabel(wagon.id, ">");
        });
      }
      // Start the whole timeline scale from 0 to 1
      gsap.to(this.trainObject.animation, {
        duration: 20,
        timeScale: 1,
      });
    }
  }

  updateTrain(train: TrainObject | any) {
    // this.trains[this.id] = Object.assign({}, this.trains[this.id], train);
    this.$emit("update", train);
  }

  trainStopping() {
    this.updateTrain({ id: this.id, status: TrainStatus.Stopping });
  }

  trainStoppingInDepot() {
    this.updateTrain({ id: this.id, status: TrainStatus.EnteringDepot });
  }

  trainStopped() {
    this.updateTrain({ id: this.id, status: TrainStatus.Stopped });
  }
  trainStoppedInDepot() {
    this.updateTrain({ id: this.id, status: TrainStatus.Stopped });
    const tilePosition: string = getCoordinatesId(this.trainObject);
    const tile = (this.$parent!.$refs[tilePosition] as any)[0];
    this.route = tile.getTrainRoute(this.trainObject);

    this.trainObject.animation.clear();
    tile.trainInDepot(this.trainObject);
  }

  trainStarted() {
    this.updateTrain({ id: this.id, status: TrainStatus.Started });
  }

  trainRunning() {
    this.updateTrain({ id: this.id, status: TrainStatus.Running });
  }

  trainLeavesTile(train: TrainObject = this.trainObject) {
    const tilePosition: string = getCoordinatesId(train);
    const tile = (this.$parent!.$refs[tilePosition] as any)[0];
    const trainLeavesTile = tile.trainLeavesTile(train);

    const nextTileCoordinates = getLeavingTrainCoordinates(this.route!, {
      x: train.x,
      y: train.y,
    });
    train.direction = getTrainDirection(nextTileCoordinates, {
      x: train.x,
      y: train.y,
    });
    this.updateTrain({
      id: train.id,
      x: nextTileCoordinates.x,
      y: nextTileCoordinates.y,
      status: train.status,
      direction: train.direction,
    });

    // Don't forward train to next tile, if entering depot
    if (trainLeavesTile) {
      this.trainEntersNextTile(this.trains[train.id]);
    }
  }

  trainEntersNextTile(train: TrainObject) {
    const tilePosition: string = getCoordinatesId(train);
    if (this.level[tilePosition]) {
      const tile = (this.$parent!.$refs[tilePosition] as any)[0];
      tile.incomingTrain(this.id);
      this.route = tile.getTrainRoute(this.trainObject);
      const animationOptions = tile.animateTrainOptions(this.trainObject);

      // Animate the train!
      this.animateTrain(this.route!, animationOptions);
    }
  }

  animateTrain(route: Route, tileAnimationOptions?: object) {
    // Animate
    const trainPath = route.path;
    const animationOptions = Object.assign(
      {},
      {
        ease: "none",
        duration: 2,
        motionPath: {
          align: "self",
          autoRotate: "auto",
          path: trainPath,
        },
      },
      tileAnimationOptions
    );
    this.trainObject.animation
      .to(
        this.visual,
        { ...animationOptions, onComplete: () => this.trainLeavesTile() },
        this.trainObject.id
      )
      .addLabel(this.trainObject.id, ">");
    // Wagon animation
    if (this.trainObject.wagons) {
      this.trainObject.wagons!.map((wagon, index) => {
        this.trainObject.animation
          .to(wagon.visual, animationOptions, wagon.id)
          .addLabel(wagon.id, ">");
      });
    }
  }

  get getWagonImage() {
    if (this.type === "people") {
      return this.trainVisuals.wagons.people.wagonPeople;
    } else {
      const wagons = Object.values(this.trainVisuals.wagons.fraight);
      return getRandom(wagons);
    }
  }

  get locoImage() {
    if (this.type === "people") {
      return this.trainVisuals.locos.people;
    } else if (this.type === "fraight") {
      return this.trainVisuals.locos.fraight;
    }
    return this.trainVisuals.locos.fraight;
  }

  get trainColorStyle() {
    return { backgroundColor: this.trainColor };
  }
}
</script>

<template>
  <div class="train-composition">
    <div
      :id="trainObject.id"
      class="train train-locomotive clickable"
      :class="[trainColor, { 'init-vertical': trainInitialyVertical }]"
      :style="[initialPosition, locoImage]"
      @click.stop="startStopTrain"
    >
      <span v-if="$root.debug" class="train-debug">{{ trainObject.id }}</span>
    </div>
    <template v-if="trainObject.wagons">
      <div
        v-for="wagon in trainObject.wagons"
        :id="wagon.id"
        :key="wagon.id"
        class="train train-wagon"
        :class="[
          `train-wagon--${type}`,
          { 'init-vertical': trainInitialyVertical },
        ]"
        :style="[initialPosition, getWagonImage]"
      >
        <span v-if="$root.debug" class="train-debug">{{ wagon.id }}</span>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.train {
  position: absolute;
  z-index: 10;
  transform: translate(-50%, -50%);
  background-size: contain;
  background-position: center center;
  background-repeat: no-repeat;

  &.init-vertical {
    transform: translate(-50%, -50%) rotate(90deg);
  }

  &.train-locomotive {
    width: 100px;
    height: 26px;
    z-index: 3;

    &.green {
      filter: grayscale(100%) brightness(40%) sepia(100%) hue-rotate(50deg)
        saturate(1000%) contrast(0.8);
    }
    &.yellow {
      filter: grayscale(100%) brightness(120%) sepia(90%) hue-rotate(5deg)
        saturate(500%) contrast(0.7);
    }
    &.red {
      filter: grayscale(100%) brightness(40%) sepia(100%) hue-rotate(-50deg)
        saturate(600%) contrast(0.8);
    }
    &.blue {
      filter: grayscale(100%) brightness(30%) sepia(100%) hue-rotate(-180deg)
        saturate(700%) contrast(0.8);
    }
    &.grey {
      filter: grayscale(100%) brightness(110%) contrast(0.9);
    }
    &.black {
      filter: invert(30%) grayscale(100%) brightness(70%) contrast(4);
    }
  }
  &.train-wagon {
    z-index: 2;
  }
  &.train-wagon--people {
    width: 100px;
    height: 30px;
  }

  &.train-wagon--fraight {
    width: 81px;
    height: 30px;
  }
}

.train-debug {
  font-size: 14px;
  font-weight: bold;
  position: absolute;
  color: black;
  width: 100%;
  transform: translate(-50%, -50%);
  top: 50%;
  left: 50%;
}
</style>
