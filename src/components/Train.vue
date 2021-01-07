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
  TrainDirection,
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

  created() {
    this.id = this.trainObject.id;
    this.wagons = this.trainObject.wagons;
    this.type = this.trainObject.type;
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
    const tile = (this.$parent.$refs[coordId] as any)[0];
    this.route = tile.getTrainRoute(this.trainObject);

    this.initialRotation = tile.currentRotation;
    this.trainInitialyVertical =
      this.initialRotation === Rotations.Top ||
      this.initialRotation === Rotations.Bottom
        ? true
        : false;
    debugger;

    // Check for planned Destination
    await this.doRoutePlanning();

    // Move train to first tile
    tile.incomingTrain(this.id);

    // Start of long trains(with wagons)
    if (this.trainObject.status === TrainStatus.Init) {
      this.initTrain();
    }
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
      const tile = (this.$parent.$refs[tilePosition] as any)[0];
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
    this.trainStopping();
    gsap.to(this.trainObject.animation, {
      duration: 10,
      timeScale: 0.2,
      onComplete: () => this.trainStopped(),
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

  initTrain() {
    this.trainStarted();
    const trainObject = { ...this.trainObject };
    const trainRoute = this.route;
    if (trainRoute) {
      const trainPath = trainRoute.path;
      // Animate train out of the box, and add all wagons accordingly
      trainObject.animation
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
          trainObject.id
        )
        .addLabel(trainObject.id, ">");
      // Wagon trial
      if (trainObject.wagons) {
        trainObject.wagons!.map((wagon, index) => {
          trainObject.animation
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
      gsap.to(trainObject.animation, {
        duration: 20,
        timeScale: 1,
      });
    }
  }

  updateTrain(train: TrainObject | any) {
    this.trains[train.id] = Object.assign({}, this.trains[train.id], train);
  }

  trainStopping() {
    this.updateTrain({ id: this.id, status: TrainStatus.Stopping });
  }

  trainStopped() {
    this.updateTrain({ id: this.id, status: TrainStatus.Stopped });
  }

  trainStarted() {
    this.updateTrain({ id: this.id, status: TrainStatus.Started });
  }

  trainRunning() {
    this.updateTrain({ id: this.id, status: TrainStatus.Running });
  }

  trainLeavesTile(train: TrainObject = this.trainObject) {
    const tilePosition: string = getCoordinatesId(train);
    const tile = (this.$parent.$refs[tilePosition] as any)[0];
    tile.trainLeavesTile(train);

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

    // CHECK Important that we take the newest train from the train object, not just the one from the leaves function
    this.trainEntersTile(this.trains[train.id]);
  }

  trainEntersTile(train: TrainObject) {
    const tilePosition: string = getCoordinatesId(train);
    if (this.level[tilePosition]) {
      const tile = (this.$parent.$refs[tilePosition] as any)[0];
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

  getRandom(list: any[]) {
    return list[Math.floor(Math.random() * list.length)];
  }

  get getWagonImage() {
    if (this.type === "people") {
      return this.trainVisuals.wagons.people.wagonPeople;
    } else {
      const wagons = Object.values(this.trainVisuals.wagons.fraight);
      return this.getRandom(wagons);
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
}
</script>

<template>
  <div class="train-composition">
    <div
      :id="trainObject.id"
      class="train train-locomotive clickable"
      :class="{ 'init-vertical': trainInitialyVertical }"
      :style="[initialPosition, locoImage]"
      @click.stop="startStopTrain"
    >
      <span v-if="$root.debug" class="train-debug"
        >{{ trainObject.x }}, {{ trainObject.y }}</span
      >
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
  }
  &.train-wagon--people {
    width: 100px;
    height: 30px;
  }

  &.train-wagon--fraight {
    width: 30px;
    height: 81px;
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
