<template>
  <svg xmlns="http://www.w3.org/2000/svg" class="car-route">
    <defs>
      <marker
        :id="markerId"
        markerWidth="6"
        markerHeight="6"
        refX="5"
        refY="3"
        orient="auto"
      >
        <polygon points="0 0, 6 3, 0 6" :fill="color" />
      </marker>
    </defs>
    <path
      v-for="(seg, i) in segments"
      :key="i"
      :d="seg.d"
      :transform="`translate(${seg.x}, ${seg.y})`"
      :stroke="color"
      stroke-width="6"
      stroke-linecap="round"
      fill="transparent"
      :marker-end="i === segments.length - 1 ? `url(#${markerId})` : undefined"
    />
  </svg>
</template>

<script lang="ts">
import { Vue, Component, Prop, toNative } from "vue-facing-decorator";
import { CarRouteSeg } from "@/game";

// A debug overlay drawing the hovered/pinned car's centreline route as a coloured
// line with an arrowhead at the destination edge. Placed full-size over the level
// grid; each segment is a tile-local path translated to its tile's screen origin.
@Component
class CarRouteOverlay extends Vue {
  @Prop({ type: Array, default: () => [] }) segments!: CarRouteSeg[];
  @Prop({ type: String, default: "#000" }) color!: string;

  // A unique-enough marker id so two overlays (e.g. across hot reloads) don't
  // clash on the shared SVG defs id.
  get markerId(): string {
    return "car-route-arrow";
  }
}

export default toNative(CarRouteOverlay);
</script>

<style lang="scss" scoped>
.car-route {
  // Above the road surface / tile art but below the car sprites (z-index 6), so
  // the car drives over its own highlighted route line.
  z-index: 5;
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  opacity: 0.85;
}
</style>
