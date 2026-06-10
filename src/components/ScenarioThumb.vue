<template>
  <svg
    class="scenario-thumb"
    :viewBox="thumb.viewBox"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
  >
    <!-- Map backdrop: a muted meadow so roads/rails read like a level. -->
    <rect class="thumb-bg" x="0" y="0" :width="cols * thumb.unit" :height="rows * thumb.unit" />
    <g v-for="(t, i) in thumb.tiles" :key="i" :transform="`translate(${t.tx},${t.ty})`">
      <path v-for="(d, ri) in t.roads" :key="'road' + ri" :d="d" class="thumb-road" />
      <path v-for="(d, bi) in t.bed" :key="'bed' + bi" :d="d" class="thumb-bed" />
      <path v-for="(d, li) in t.rails" :key="'rail' + li" :d="d" class="thumb-rail" />
      <rect
        v-if="t.depot"
        class="thumb-depot"
        :x="thumb.unit * 0.32"
        :y="thumb.unit * 0.32"
        :width="thumb.unit * 0.36"
        :height="thumb.unit * 0.36"
        :rx="thumb.unit * 0.06"
      />
    </g>
  </svg>
</template>

<script lang="ts">
import { Component, Prop, Vue, toNative } from "vue-facing-decorator";
import { TestScenario, scenarioGrid } from "@/levels/test/scenario";
import { ScenarioThumb as Thumb, scenarioThumb } from "@/levels/test/thumb";

// A static, non-interactive preview of a scenario's map (no game, no sim, no
// rAF). Pure view over `scenarioThumb()`; used as the background art on the
// gallery's image tiles.
@Component
class ScenarioThumb extends Vue {
  @Prop({ required: true }) scenario!: TestScenario;

  get grid() {
    return scenarioGrid(this.scenario);
  }
  get cols(): number {
    return this.grid.cols;
  }
  get rows(): number {
    return this.grid.rows;
  }
  get thumb(): Thumb {
    return scenarioThumb(this.scenario.level, this.grid);
  }
}

export default toNative(ScenarioThumb);
</script>

<style lang="scss" scoped>
.scenario-thumb {
  display: block;
  width: 100%;
  height: 100%;
}
.thumb-bg {
  fill: #41513f; // muted meadow
}
.thumb-road {
  fill: #56565a; // tarmac — a touch lighter than in-game so it pops on the small tile
  stroke: none;
}
.thumb-bed {
  fill: none;
  stroke: #6b5a44; // ballast brown under the rails
  stroke-width: 7;
  stroke-linecap: round;
}
.thumb-rail {
  fill: none;
  stroke: #c2c6cb; // steel
  stroke-width: 2.5;
  stroke-linecap: round;
}
.thumb-depot {
  fill: #d6b14c; // neutral amber (no game colour assignment in a static preview)
  stroke: rgba(0, 0, 0, 0.4);
  stroke-width: 2;
}
</style>
