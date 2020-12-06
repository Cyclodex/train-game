import Vue from "vue";
declare module "vue/types/vue" {
  interface Vue {
    tileSize: number;
    levelSizeX: number;
    debug: boolean;
  }
}
