<template>
  <div>
    <svg xmlns="http://www.w3.org/2000/svg" class="debug-arrow">
      <defs>
        <marker
          id="endarrow"
          markerWidth="5"
          markerHeight="5"
          refX="6"
          refY="2.5"
          orient="auto"
          markerUnits="0.1"
        >
          <polygon points="0 0, 5 2.5, 0 5" fill="red" />
        </marker>
      </defs>

      <template v-for="route in routes">
        <path
          :key="route.path"
          :d="route.path"
          stroke="black"
          stroke-width="2"
          stroke-dasharray="4 10"
          stroke-opacity="0.5"
          fill="transparent"
          marker-end="url(#endarrow)"
        />
        <!-- marker-start="url(#startarrow)" -->
      </template>
    </svg>
  </div>
</template>

<script lang="ts">
import { Vue, Component, Prop } from "vue-property-decorator";
import { PossibleRoutes } from "@/types";

@Component
export default class DebugShowRoutes extends Vue {
  @Prop({ type: Object, default: () => ({}) }) routes!: PossibleRoutes;
}
</script>
