<template>
  <div class="train-composition">
    <div
      :id="trainObject.id"
      class="train loco clickable"
      :style="[initialPosition, trainVisuals.loco]"
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
        class="train wagon"
        :style="[initialPosition, trainVisuals.loco]"
      >
        <span v-if="$root.debug" class="train-debug">{{ wagon.id }}</span>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import {
  LevelDefinition,
  Position,
  Route,
  TrainDirection,
  TrainObject,
  TrainsDefinition,
  TrainStatus,
  Wagon,
} from "@/types";
import { getCoordinatesId } from "@/utils/tileHelpers";
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
    loco: {
      backgroundImage: `url(${require("@/assets/locomotivePeople.png")})`,
    },
  };
  id!: string;
  visual!: HTMLElement | null;
  wagons?: Wagon[];
  route?: Route;

  created() {
    this.id = this.trainObject.id;
    this.wagons = this.trainObject.wagons;

    this.setInitialPosition();

    // Creating the trains animation timeline
    const trainTimeline = gsap
      .timeline({
        id: this.trainObject.id,
      })
      .timeScale(0);
    this.trainObject.animation = trainTimeline;
  }

  mounted() {
    // Init train and move to first tile
    // Initialize "visual" dom mapper for animations
    this.visual = document.getElementById(this.id);
    if (this.trainObject.wagons !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.wagons!.map(wagon => {
        wagon.visual = document.getElementById(wagon.id);
      });
    }

    // Move train to first tile
    // TODO: Get route of tile
    const coordId = getCoordinatesId(this.trainObject);
    const tile = (this.$parent.$refs[coordId] as any)[0];
    tile.incomingTrain(this.id);
    this.route = tile.getTrainRoute(this.trainObject);
    // Start of long trains(with wagons)
    if (this.trainObject.status === TrainStatus.Init) {
      this.initTrain();
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

  setInitialPosition() {
    let tilePositionX = 0;
    let tilePositionY = 0;

    switch (this.trainObject.direction) {
      case TrainDirection.Up:
      tilePositionX = this.$root.tileSize / 2;
      tilePositionY = this.$root.tileSize;
        break;
      case TrainDirection.Right:
      tilePositionX = 0;
      tilePositionY = this.$root.tileSize / 2;
        break;
      case TrainDirection.Down:
      tilePositionX = this.$root.tileSize / 2;
      tilePositionY = 0;
        break;
      case TrainDirection.Left:
      tilePositionX = this.$root.tileSize;
      tilePositionY = this.$root.tileSize / 2;
        break;
    }
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
            duration: 2,
            motionPath: {
              align: "self",
              autoRotate: 90,
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
                duration: 2,
                motionPath: {
                  align: "self",
                  autoRotate: 90,
                  path: trainPath,
                },
              },
              (index + 1) * 0.95
            )
            .addLabel(wagon.id, ">");
        });
      }
      // Start the whole timeline scale from 0 to 1
      gsap.to(trainObject.animation, {
        duration: 10,
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
      const animationOptions = tile.animateTrainOptions();

      // Animate the train!
      this.animateTrain(this.route!, animationOptions);
    }
  }

  animateTrain(route: Route, options?: object) {
    // Animate
    const trainPath = route.path;
    this.trainObject.animation
      .to(
        this.visual,
        {
          ease: "none",
          duration: 2, //this.animationDuration(trainObject),
          motionPath: {
            align: "self",
            autoRotate: 90,
            path: trainPath,
          },
          onComplete: () => this.trainLeavesTile(),
        },
        this.trainObject.id
      )
      .addLabel(this.trainObject.id, ">");
    // Wagon animation
    if (this.trainObject.wagons) {
      this.trainObject.wagons!.map((wagon, index) => {
        this.trainObject.animation
          .to(
            wagon.visual,
            {
              ease: "none",
              duration: 2, //this.animationDuration(),
              motionPath: {
                align: "self",
                autoRotate: 90,
                path: trainPath,
              },
              // onComplete: () => this.trainLeavesTrafficLight(trainObject),
            },
            wagon.id
          )
          .addLabel(wagon.id, ">");
      });
    }
  }
}
</script>

<style scoped>
.train {
  width: 26px;
  height: 100px;
  position: absolute;
  z-index: 10;
  transform: translate(-50%, -50%);
  background-size: contain;
  background-position: center center;
  background-repeat: no-repeat;
}
.train-debug {
  font-size: 14px;
  font-weight: bold;
  position: absolute;
  color: black;
  width: 100%;
  transform: rotate(-90deg) translate(30%, -70%);
  top: 50%;
  left: 50%;
}
</style>
