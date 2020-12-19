import Vue from "vue";
import App from "./App.vue";
import store from "./store";

Vue.config.productionTip = false;

import TileRail from "@/components/TileRail.vue";
Vue.component("TileRail", TileRail);
import TileStraight from "@/components/TileStraight.vue";
Vue.component("TileStraight", TileStraight);
import TileCurve from "@/components/TileCurve.vue";
Vue.component("TileCurve", TileCurve);
import Train from "@/components/Train.vue";
Vue.component("Train", Train);
import DebugShowRoutes from "@/components/DebugShowRoutes.vue";
Vue.component("DebugShowRoutes", DebugShowRoutes);
import TileIntersection from "@/components/TileIntersection.vue";
Vue.component("TileIntersection", TileIntersection);

new Vue({
  data: {
    tileSize: 100,
    levelSizeX: 7,
    debug: true,
    automaticTrafficLights: true,
    railDistanceFromPath: 7,
  },
  store,
  render: h => h(App),
}).$mount("#app");
