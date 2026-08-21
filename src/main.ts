import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { gameConfig, GAME_CONFIG_KEY } from "./gameConfig";

import TileRail from "@/components/TileRail.vue";
import Tile from "@/components/Tile.vue";
import TileGround from "@/components/TileGround.vue";
import Train from "@/components/Train.vue";
import DebugShowRoutes from "@/components/DebugShowRoutes.vue";
import CarRouteOverlay from "@/components/CarRouteOverlay.vue";
import BackdropTrees from "@/components/BackdropTrees.vue";

const app = createApp(App);

// Global game configuration, injected into components as `config`.
app.provide(GAME_CONFIG_KEY, gameConfig);

app.component("TileRail", TileRail);
app.component("Tile", Tile);
app.component("TileGround", TileGround);
app.component("Train", Train);
app.component("DebugShowRoutes", DebugShowRoutes);
app.component("CarRouteOverlay", CarRouteOverlay);
app.component("BackdropTrees", BackdropTrees);

app.use(router);
app.mount("#app");

// Dev-only: expose the flat test-scenario id list so tooling can enumerate every
// /test scenario without importing the app graph (the e2e render sweep in
// tests/e2e/scenarios.spec.ts). The dynamic import keeps the scenario data out
// of the production bundle.
if (import.meta.env.DEV) {
  void import("@/levels/test").then(({ SCENARIOS }) => {
    (window as Window & { __scenarioIds?: string[] }).__scenarioIds =
      SCENARIOS.map(s => s.id);
  });
}
