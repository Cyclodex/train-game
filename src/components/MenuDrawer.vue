<template>
  <aside class="menu-drawer" :class="{ 'menu-drawer--collapsed': collapsed }">
    <button
      class="menu-drawer__tab"
      :title="collapsed ? 'Show menu' : 'Hide menu'"
      @click="toggle"
    >
      {{ collapsed ? "›" : "‹" }}
    </button>
    <div v-if="title" class="menu-drawer__title">{{ title }}</div>
    <div class="menu-drawer__body">
      <slot />
    </div>
  </aside>
</template>

<script lang="ts">
import { Component, Prop, Vue, toNative } from "vue-facing-decorator";

// The style-A left drawer: a frosted-glass panel that holds the view's controls
// (passed in via the default slot) and can be collapsed off-screen via its side
// tab. The collapsed state persists per drawer `id` so it survives navigation.
@Component
class MenuDrawer extends Vue {
  @Prop({ default: "Menu" }) title!: string;
  // Distinct storage key per drawer (e.g. "play" / "editor").
  @Prop({ default: "default" }) id!: string;

  collapsed = false;

  private get storageKey(): string {
    return `train-game:drawer:${this.id}`;
  }

  created() {
    try {
      this.collapsed = localStorage.getItem(this.storageKey) === "1";
    } catch {
      /* ignore */
    }
  }

  toggle() {
    this.collapsed = !this.collapsed;
    try {
      localStorage.setItem(this.storageKey, this.collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

export default toNative(MenuDrawer);
</script>
