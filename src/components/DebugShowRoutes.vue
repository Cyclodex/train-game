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
      >
        <polygon points="0 0, 5 2.5, 0 5" fill="black" />
      </marker>
      <marker
        id="midarrow"
        markerWidth="5"
        markerHeight="5"
        refX="5"
        refY="2.5"
        orient="auto"
      >
        <polygon points="0 0, 5 2.5, 0 5" fill="black" />
      </marker>
    </defs>

    <template v-for="(route, key) in possibleRoutes">
      <path
        :key="key + route.path"
        :d="route.path"
        :stroke="route.disabled ? 'red' : 'black'"
        stroke-width="1"
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

<style lang="scss" scoped>
.debug-arrow {
  z-index: 200;
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
</style>
