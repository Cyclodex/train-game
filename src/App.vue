<template>
  <div
    id="app"
    :class="[`theme-${config.worldTheme}`, { debug: config.debug, 'bg-plain': config.plainBackdrop }]"
    :style="{ '--meadow-trees': meadowTrees }"
  >
    <router-view :key="$route.fullPath" />
  </div>
</template>

<script lang="ts">
import { Component, Inject, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import { meadowTreesUrl } from "@/utils/meadowBackdrop";

@Component
class App extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;

  // Generated once: the seamless scattered-tree tile for the meadow theme,
  // exposed as a CSS custom property the `.theme-meadow` backdrop consumes.
  readonly meadowTrees = meadowTreesUrl();
}

export default toNative(App);
</script>

<style lang="scss">
@import "@/scss/_main.scss";

html,
body {
  margin: 0;
  padding: 0;
}

#app {
  text-align: center;
  color: $vueBlack;
  min-height: 100vh;
  position: relative;
}

// A soft fog/vignette pinned to the viewport edges so the playable area reads
// as the focus, lifted off the themed backdrop. Sits above the board but below
// the HUD (drawer/dock z 1500, score-card z 2000).
#app::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  box-shadow: inset 0 0 150px 55px rgba(0, 0, 0, 0.3);
}
pre {
  text-align: left;
}

.debug {
  font-size: 12px;
  z-index: 1;
  text-align: left;
}
.debug-coordinates {
  position: absolute;
  bottom: 0;
  left: 0;
}

// Debug "plain background" mode: override the themed backdrop with a flat
// neutral ground and drop the board's framing glow, so tile geometry stands out.
#app.bg-plain {
  // A flat mid-green ground: clearly distinct from the dark tarmac so the kerb
  // edges read, while still letting the white markings stand out.
  background: #3f6b40 !important;
}
#app.bg-plain .level {
  box-shadow: none !important;
  border-radius: 0 !important;
}

.delivered-count {
  padding: 8px 0;
}
</style>
