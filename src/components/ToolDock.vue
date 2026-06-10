<template>
  <div class="tool-dock-wrap">
    <transition name="dock-hint">
      <div v-if="hint" class="tool-dock__hint">{{ hint }}</div>
    </transition>
    <div class="tool-dock">
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, toNative } from "vue-facing-decorator";

// The style-B bottom dock: a frosted-glass bar of big, kid-friendly buttons
// (the view supplies them via the default slot, using `.dock-btn`). An optional
// `hint` string floats above the dock as a pill.
@Component
class ToolDock extends Vue {
  @Prop({ default: "" }) hint!: string;
}

export default toNative(ToolDock);
</script>

<style lang="scss" scoped>
.dock-hint-enter-active,
.dock-hint-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.dock-hint-enter-from,
.dock-hint-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
