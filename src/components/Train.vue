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
// A composition is a pure wrapper — every unit inside it is absolutely positioned
// against the `.level` grid by the game loop, so the wrapper itself must generate
// NO box. Without this it is a plain static div and therefore a GRID ITEM, eating
// one 200px cell each: the whole board slid one tile to the right per train and
// wrapped its tail onto an extra row (2 trains on /play started the level at
// column 2). `display: contents` removes the box without changing the units'
// containing block, which stays `.level` — do not swap it for `position:
// absolute`, that would re-anchor every transform the game loop writes.
.train-composition {
  display: contents;
}

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
    // Layer order at a crossing: road (z1) < rails (z2) < wagons (z3) <
    // locomotive (z4). Both train units sit above the track so the train is
    // never hidden behind the rails it runs on.
    z-index: 4;

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
    z-index: 3; // above the rails (z2); see the locomotive note above
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
  // Cancel the unit's own rotation so the id stays upright and readable whichever
  // way the train is running (`--unit-angle` is published by the game loop next to
  // the transform it belongs to). Westbound trains sit at ~180deg, which used to
  // render their ids mirrored and upside down.
  transform: translate(-50%, -50%) rotate(calc(-1 * var(--unit-angle, 0deg)));
  top: 50%;
  left: 50%;
}
</style>
