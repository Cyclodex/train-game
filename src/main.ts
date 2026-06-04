import { createApp } from "vue";
import App from "./App.vue";
import { gameConfig, GAME_CONFIG_KEY } from "./gameConfig";

import TileRail from "@/components/TileRail.vue";
import Tile from "@/components/Tile.vue";
import Train from "@/components/Train.vue";
import DebugShowRoutes from "@/components/DebugShowRoutes.vue";

const app = createApp(App);

// Global game configuration, injected into components as `config`.
app.provide(GAME_CONFIG_KEY, gameConfig);

app.component("TileRail", TileRail);
app.component("Tile", Tile);
app.component("Train", Train);
app.component("DebugShowRoutes", DebugShowRoutes);

app.mount("#app");
