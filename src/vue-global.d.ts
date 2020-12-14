import Vue from "vue";
import { Position } from "./types";
declare module "vue/types/vue" {
  interface Vue {
    tileSize: number;
    levelSizeX: number;
    debug: boolean;
    automaticTrafficLights: boolean;
    checkStatus(entrancePosition: Position): CheckStatusFeedback;
  }
}
