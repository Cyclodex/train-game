<template>
  <svg xmlns="http://www.w3.org/2000/svg" class="tile-rail">
    <!-- Path-routes for train, showing sleepers along the path -->
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
    <!-- Rails come in a separate loop, because otherwise the wood sleepers would cover some rails -->
    <template v-for="(route, key) in possibleRoutes" :key="'rail' + key">
      <!-- Draw rails -->
      <template v-if="route.rails">
        <path
          v-for="railPath in route.rails"
          :key="railPath"
          :d="railPath"
          fill="transparent"
          stroke="gray"
          stroke-width="1"
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
}
</style>
