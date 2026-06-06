<template>
  <div id="app" :class="[`theme-${config.worldTheme}`, { debug: config.debug }]">
    <router-view />
  </div>
</template>

<script lang="ts">
import { Component, Inject, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";

@Component
class App extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
}

export default toNative(App);
</script>

<style lang="scss">
@import "@/scss/_main.scss";

#app {
  text-align: center;
  color: $vueBlack;
  min-height: 100vh;
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

.clickable {
  cursor: pointer;
  transition: background-color 0.4s ease;
  &:hover {
    background-color: pink !important;
  }
}
.delivered-count {
  padding: 8px 0;
}
</style>
