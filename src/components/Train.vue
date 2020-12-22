<template>
  <div class="train-composition">
    <div
      :id="trainObject.id"
      class="train loco clickable"
      :style="[initialPosition, trainVisuals.loco]"
      @click.stop="startStopTrain"
    >
      <span class="train-debug">{{ trainObject.x }}, {{ trainObject.y }}</span>
    </div>
    <template v-if="trainObject.wagons">
      <div
        v-for="wagon in trainObject.wagons"
        :key="wagon.id"
        class="train wagon"
        :style="[initialPosition, trainVisuals.loco]"
      ></div>
    </template>
  </div>
</template>

<script lang="ts">
import { TrainDirection, TrainObject, TrainsDefinition } from "@/types";
import gsap from "gsap";
import { Component, InjectReactive, Prop, Vue } from "vue-property-decorator";

@Component
export default class Train extends Vue {
  @InjectReactive() trains!: TrainsDefinition;

  @Prop({ type: Object, default: {} }) trainObject!: TrainObject;
  initialPosition = {};
  timeScale = 1;
  trainVisuals = {
    loco: {
      backgroundImage: `url(${require("@/assets/locomotivePeople.png")})`,
    },
  };

  created() {
    this.setInitialPosition();
    const trainTimeline = gsap
      .timeline({ id: this.trainObject.id })
      .addLabel(this.trainObject.id);
    this.trainObject.animation = trainTimeline;
  }

  startStopTrain() {
    this.timeScale = this.timeScale === 1 ? 0 : 1;
    if (this.timeScale === 0) {
      this.trainObject.animation.pause();
    } else {
      this.trainObject.animation.resume();
    }
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
