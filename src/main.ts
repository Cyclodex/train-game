import { createApp } from "vue";
import App from "./App.vue";
import { gameConfig, GAME_CONFIG_KEY } from "./gameConfig";

import TileRail from "@/components/TileRail.vue";
import TileStraight from "@/components/TileStraight.vue";
import TileDepot from "@/components/TileDepot.vue";
import TileCurve from "@/components/TileCurve.vue";
import Train from "@/components/Train.vue";
import DebugShowRoutes from "@/components/DebugShowRoutes.vue";
import TileIntersectionComplete from "@/components/TileIntersectionComplete.vue";

const app = createApp(App);

// Global game configuration, injected into components as `config`.
app.provide(GAME_CONFIG_KEY, gameConfig);

app.component("TileRail", TileRail);
app.component("TileStraight", TileStraight);
app.component("TileDepot", TileDepot);
app.component("TileCurve", TileCurve);
app.component("Train", Train);
app.component("DebugShowRoutes", DebugShowRoutes);
app.component("TileIntersectionComplete", TileIntersectionComplete);

app.mount("#app");
