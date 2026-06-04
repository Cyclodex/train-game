<script lang="ts">
import { TrainObject } from "@/types";
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import type { Game } from "@/game";
import { getRandom } from "@/utils/globalHelpers";
import locomotivePeople from "@/assets/locomotivePeople.png";
import locomotiveFraight from "@/assets/locomotiveFraight.png";
import wagonPeople from "@/assets/wagonPeople.png";
import wagonFraight1 from "@/assets/wagonFraight1.png";
import wagonFraight2 from "@/assets/wagonFraight2.png";
import wagonFraight3 from "@/assets/wagonFraight3.png";
import wagonFraight4 from "@/assets/wagonFraight4.png";

// Train is now a pure renderer: it draws the locomotive + wagon sprites and the
// game loop (see game.ts) positions them each frame from the simulation. It owns
// no movement, animation, or pathfinding logic.
@Component
class Train extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Inject({ from: "game" }) game!: Game;
  @Prop({ type: Object, default: () => ({}) }) trainObject!: TrainObject;

  trainVisuals = {
    locos: {
      people: { backgroundImage: `url(${locomotivePeople})` },
      fraight: { backgroundImage: `url(${locomotiveFraight})` },
    },
    wagons: {
      people: { wagonPeople: { backgroundImage: `url(${wagonPeople})` } },
      fraight: {
        wagonFraight1: { backgroundImage: `url(${wagonFraight1})` },
        wagonFraight2: { backgroundImage: `url(${wagonFraight2})` },
        wagonFraight3: { backgroundImage: `url(${wagonFraight3})` },
        wagonFraight4: { backgroundImage: `url(${wagonFraight4})` },
      },
    },
  };

  get type(): "people" | "fraight" {
    return this.trainObject.type;
  }

  get trainColor(): string {
    return this.game.trainColors[this.trainObject.id] ?? "grey";
  }

  get locoImage() {
    return this.type === "people"
      ? this.trainVisuals.locos.people
      : this.trainVisuals.locos.fraight;
  }

  get getWagonImage() {
    if (this.type === "people") {
      return this.trainVisuals.wagons.people.wagonPeople;
    }
    return getRandom(Object.values(this.trainVisuals.wagons.fraight));
  }
}

export default toNative(Train);
</script>

<template>
  <div class="train-composition">
    <div
      :id="trainObject.id"
      class="train train-locomotive"
      :class="trainColor"
      :style="locoImage"
    >
      <span v-if="config.debug" class="train-debug">{{ trainObject.id }}</span>
    </div>
    <template v-if="trainObject.wagons">
      <div
        v-for="wagon in trainObject.wagons"
        :id="wagon.id"
        :key="wagon.id"
        class="train train-wagon"
        :class="`train-wagon--${type}`"
        :style="getWagonImage"
      >
        <span v-if="config.debug" class="train-debug">{{ wagon.id }}</span>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.train {
  position: absolute;
  z-index: 10;
  top: 0;
  left: 0;
  transform: translate(-50%, -50%);
  background-size: contain;
  background-position: center center;
  background-repeat: no-repeat;
  will-change: transform;

  // NOTE: these sprite widths are the on-screen unit lengths the simulation
  // uses to space coupled units. They MUST match UNIT_PX in
  // src/sim/trainDimensions.ts (the single source of truth the sim reads) —
  // keep the two in sync when changing a sprite size.
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
