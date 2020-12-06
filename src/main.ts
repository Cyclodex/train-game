import Vue from "vue";
import App from "./App.vue";
import store from "./store";

Vue.config.productionTip = false;

import TileStraight from "@/components/TileStraight.vue";
Vue.component("TileStraight", TileStraight);
import TileCurve from "@/components/TileCurve.vue";
Vue.component("TileCurve", TileCurve);
import Train from "@/components/Train.vue";
Vue.component("Train", Train);

new Vue({
  data: {
    tileSize: 100,
    levelSizeX: 3,
    debug: true,
  },
  store,
  render: h => h(App),
}).$mount("#app");
