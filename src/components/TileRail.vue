<template>
  <svg xmlns="http://www.w3.org/2000/svg" class="tile-rail">
    <template v-for="(route, key) in possibleRoutes">
      <!-- Path-routes for train, showing rail -->
      <path
        :key="'path' + key + route.path"
        :d="route.path"
        fill="transparent"
        stroke="#693b3b"
        stroke-width="20"
        stroke-dasharray="5 7"
        stroke-linecap="but"
      />
      <!-- Draw rails -->
      <template v-if="route.rails">
        <path
          v-for="railPath in route.rails"
          :key="'rail' + key + railPath"
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
import { Vue, Component, Prop } from "vue-property-decorator";
import { PossibleRoutes, Route } from "@/types";

@Component
export default class TileRail extends Vue {
  @Prop({ type: Array, default: () => ({}) }) possibleRoutes!: Route[];
  @Prop({ type: Object, default: () => ({}) })
  switchableRoutes!: PossibleRoutes;
  @Prop({ type: Object, default: () => ({}) })
  activeRoute!: Route;
  created() {
    console.log(this.possibleRoutes);
  }
}
</script>

<style lang="scss" scoped>
.tile-rail {
  width: 100%;
  height: 100%;
}
</style>
