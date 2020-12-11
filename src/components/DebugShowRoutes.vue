<template>
  <svg xmlns="http://www.w3.org/2000/svg" class="debug-arrow">
    <defs>
      <marker
        id="endarrow"
        markerWidth="5"
        markerHeight="5"
        refX="5"
        refY="2.5"
        orient="auto"
        markerUnits="0.1"
      >
        <polygon points="0 0, 5 2.5, 0 5" fill="black" />
      </marker>
    </defs>

    <template v-for="route in possibleRoutes">
      <path
        :key="route.path"
        :d="route.path"
        stroke="black"
        stroke-width="1"
        fill="transparent"
        marker-end="url(#endarrow)"
      />
      <!-- marker-start="url(#startarrow)" -->
    </template>
    <template v-for="route in switchableRoutes">
      <path
        :key="route.path"
        :d="route.path"
        stroke="red"
        stroke-width="2"
        fill="transparent"
        marker-end="url(#endarrow)"
      />
      <!-- marker-start="url(#startarrow)" -->
    </template>
    <template v-if="activeRoute">
      <path
        :key="activeRoute.path"
        :d="activeRoute.path"
        stroke="green"
        stroke-width="4"
        fill="transparent"
        marker-end="url(#endarrow)"
      />
    </template>
  </svg>
</template>

<script lang="ts">
import { Vue, Component, Prop } from "vue-property-decorator";
import { PossibleRoutes, Route } from "@/types";

@Component
export default class DebugShowRoutes extends Vue {
  @Prop({ type: Object, default: () => ({}) }) possibleRoutes!: PossibleRoutes;
  @Prop({ type: Object, default: () => ({}) })
  switchableRoutes!: PossibleRoutes;
  @Prop({ type: Object, default: () => ({}) })
  activeRoute!: Route;
}
</script>
