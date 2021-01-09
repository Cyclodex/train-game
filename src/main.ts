import Vue from "vue";
import App from "./App.vue";
import store from "./store";

Vue.config.productionTip = false;

import TileRail from "@/components/TileRail.vue";
Vue.component("TileRail", TileRail);
import TileStraight from "@/components/TileStraight.vue";
Vue.component("TileStraight", TileStraight);
import TileDepot from "@/components/TileDepot.vue";
Vue.component("TileDepot", TileDepot);
import TileCurve from "@/components/TileCurve.vue";
Vue.component("TileCurve", TileCurve);
import Train from "@/components/Train.vue";
Vue.component("Train", Train);
import DebugShowRoutes from "@/components/DebugShowRoutes.vue";
Vue.component("DebugShowRoutes", DebugShowRoutes);
import TileIntersection from "@/components/TileIntersection.vue";
Vue.component("TileIntersection", TileIntersection);
import TileIntersectionComplete from "@/components/TileIntersectionComplete.vue";
Vue.component("TileIntersectionComplete", TileIntersectionComplete);

new Vue({
  data: {
    tileSize: 200,
    levelSizeX: 7,
    debug: true,
    automaticTrafficLights: true,
    automaticRoutePlanning: false,
    railDistanceFromPath: 7,
  },
  store,
  render: h => h(App),
}).$mount("#app");
