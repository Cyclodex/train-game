import Vue from "vue";
import App from "./App.vue";
import store from "./store";

Vue.config.productionTip = false;

import TileStraight from "@/components/TileStraight.vue";
Vue.component("TileStraight", TileStraight);
import Train from "@/components/Train.vue";
Vue.component("Train", Train);

new Vue({
  data: {
    tileSize: 100,
    levelSizeX: 3,
  },
  store,
  render: h => h(App),
}).$mount("#app");
