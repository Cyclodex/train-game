import Vue from "vue";
import App from "./App.vue";
import store from "./store";

Vue.config.productionTip = false;

import Tile from "@/components/Tile.vue";
Vue.component("Tile", Tile);
import Train from "@/components/Train.vue";
Vue.component("Train", Train);

new Vue({
  store,
  render: h => h(App),
}).$mount("#app");
