<template>
  <svg xmlns="http://www.w3.org/2000/svg" class="tile-rail">
    <!--
      The sleeper band: the track centreline stroked 20px wide and dashed, so
      each dash IS a sleeper and turns with the path for free. Its half-width
      (10px) is what `gameConfig.railDistanceFromPath` is measured against — see
      the note there for the real-track proportion the two are gauged by.

      The dash pitch is DELIBERATELY COARSER than reality (~"2.5 3" would be the
      true 600mm sleeper centres). Tried and rejected: at a macro crop the fine
      pitch looks right, but at the normal board zoom the sleepers blur into one
      solid dark band and the track loses its railway texture. Judge any change
      here at board scale (`npm run shot -- railcurves --scale 2`).
    -->
    <template v-for="(route, key) in possibleRoutes" :key="'path' + key">
      <path
        :d="route.path"
        fill="transparent"
        stroke="#693b3b"
        stroke-width="20"
        stroke-dasharray="4 5"
        stroke-dashoffset="2"
        stroke-linecap="butt"
      />
    </template>
    <!--
      Rails come in a separate loop, because otherwise the wood sleepers would
      cover some rails. 1.6px, not the 1px hairline this used to be: at the
      normal board zoom a 1px grey line all but disappears into the sleeper
      band, so the track read as bare sleepers with no metal on it.
    -->
    <template v-for="(route, key) in possibleRoutes" :key="'rail' + key">
      <!-- Draw rails -->
      <template v-if="route.rails">
        <path
          v-for="railPath in route.rails"
          :key="railPath"
          :d="railPath"
          fill="transparent"
          stroke="gray"
          stroke-width="1.6"
        />
      </template>
    </template>
  </svg>
</template>

<script lang="ts">
import { Vue, Component, Prop, toNative } from "vue-facing-decorator";
import { PossibleRoutes, Route } from "@/types";

@Component
class TileRail extends Vue {
  @Prop({ type: Array, default: () => ({}) }) possibleRoutes!: Route[];
  @Prop({ type: Object, default: () => ({}) })
  switchableRoutes!: PossibleRoutes;
}

export default toNative(TileRail);
</script>

<style lang="scss" scoped>
.tile-rail {
  width: 100%;
  height: 100%;
  /* Lift the rails above the road layer (z1) so the track crosses *over* the
  road surface at a level crossing. Stays below the crossing furniture (z15),
  trains (z10), signals (z14) and switches (z20). */
  position: relative;
  z-index: 2;
}
</style>
