<template>
  <!-- Level-crossing (Bahnübergang) furniture overlay: boom barriers, warning
  lights and roadside triangle signals. The road surface is drawn by the tile's
  road layer and the cars by the road simulation; this component only adds the
  crossing furniture and reads the gate state (CLOSED while a train reserves or
  occupies the tile). -->
  <div class="crossing" :style="overlayStyle">
    <div class="crossing-rot" :style="rotStyle">
      <!-- two boom barriers guarding the rail; down (horizontal) when closed -->
      <div class="boom boom--top" :class="{ closed }">
        <div class="boom-arm"></div>
        <div class="boom-post"></div>
      </div>
      <div class="boom boom--bottom" :class="{ closed }">
        <div class="boom-arm"></div>
        <div class="boom-post"></div>
      </div>

      <!-- roadside crossing signals: a classic up-pointing warning triangle on a
      post with two alternating red lamps, one guarding each approach. -->
      <div class="xing-signal xing-signal--top" :class="{ active: closed }">
        <div class="xing-tri"></div>
        <div class="xing-lamps">
          <span class="xing-lamp xing-lamp--a"></span>
          <span class="xing-lamp xing-lamp--b"></span>
        </div>
        <div class="xing-post"></div>
      </div>
      <div class="xing-signal xing-signal--bottom" :class="{ active: closed }">
        <div class="xing-tri"></div>
        <div class="xing-lamps">
          <span class="xing-lamp xing-lamp--a"></span>
          <span class="xing-lamp xing-lamp--b"></span>
        </div>
        <div class="xing-post"></div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { Position } from "@/types";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import { TileCell, parseCoordId } from "@/tiles/model";
import { roadPortsOf } from "@/tiles/lanes";
import type { Game } from "@/game";

// The crossing furniture is a pure view over the tile's gate state — no movement
// logic lives here. Booms/lamps animate purely off `closed`, which the game
// derives from the train reservation/occupancy on this tile.
@Component
class Crossing extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Inject({ from: "game" }) game!: Game;
  @Prop({ type: String, required: true }) coordId!: string;
  @Prop({ type: Object, required: true }) cell!: TileCell;

  get size(): number {
    return this.config.tileSize;
  }

  // Grid position of the tile -> pixel offset inside `.level`.
  get overlayStyle() {
    const { x, y } = parseCoordId(this.coordId);
    return {
      left: `${x * this.size}px`,
      top: `${y * this.size}px`,
      width: `${this.size}px`,
      height: `${this.size}px`,
    };
  }

  // The road runs Top<->Bottom by default; if it runs Left<->Right we draw the
  // same vertical layout and rotate the whole overlay a quarter turn.
  get horizontalRoad(): boolean {
    const ports = roadPortsOf(this.cell.road);
    return ports.includes(Position.Left) && ports.includes(Position.Right);
  }

  get rotStyle() {
    return this.horizontalRoad ? { transform: "rotate(90deg)" } : {};
  }

  // CLOSED while a train has reserved or is sitting on the crossing tile.
  get closed(): boolean {
    return (
      this.coordId in this.game.reservations || this.coordId in this.game.occupied
    );
  }
}

export default toNative(Crossing);
</script>

<style lang="scss" scoped>
.crossing {
  position: absolute;
  pointer-events: none;
  /* Establish the overlay's own stacking context above the road surface, road
  cars (z6), trains (z10) and tile signals (z14) so the crossing furniture is
  always drawn on top. This must live on `.crossing` (not the inner booms),
  otherwise the booms' z-index leaks into the level's stacking context only in
  the unrotated orientation — when the road is horizontal `.crossing-rot`'s
  `transform` creates a stacking context that would trap the furniture behind
  the street and train. Anchoring the context here makes both orientations
  identical. (Switches z20 / depot dots z1000 never share a crossing tile.) */
  z-index: 15;
}
.crossing-rot {
  position: absolute;
  inset: 0;
}

/* boom barriers: an arm that pivots down across the road when closed */
.boom {
  position: absolute;
  z-index: 7; /* above the road surface, cars and the train */
  left: 30%;
  width: 40%;
  height: 0;
}
.boom--top {
  top: 28%;
}
.boom--bottom {
  top: 72%;
}
.boom-post {
  position: absolute;
  left: -6px;
  top: -6px;
  width: 6px;
  height: 12px;
  background: #d23b3b;
  border-radius: 2px;
}
.boom-arm {
  position: absolute;
  left: 0;
  top: -3px;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  transform-origin: left center;
  transform: rotate(-72deg); /* raised (open) */
  transition: transform 0.5s cubic-bezier(0.4, 1.4, 0.5, 1);
  background: repeating-linear-gradient(
    to right,
    #e23b3b 0 18%,
    #f6f6f6 18% 36%
  );
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
.boom.closed .boom-arm {
  transform: rotate(0deg); /* lowered across the road */
}

/* roadside crossing signals: up-pointing warning triangle + alternating lamps */
.xing-signal {
  position: absolute;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.xing-signal--top {
  left: 20%;
  top: 12%;
}
.xing-signal--bottom {
  left: 72%;
  top: 60%;
}
.xing-tri {
  width: 0;
  height: 0;
  border-left: 9px solid transparent;
  border-right: 9px solid transparent;
  border-bottom: 16px solid #d23b3b;
  position: relative;
}
.xing-tri::after {
  content: "";
  position: absolute;
  left: -5px;
  top: 5px;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 9px solid #f6f6f6;
}
.xing-lamps {
  display: flex;
  gap: 4px;
  margin-top: 1px;
}
.xing-post {
  width: 3px;
  height: 16px;
  background: #555;
  border-radius: 1px;
}
.xing-lamp {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #5a2a2a;
}
.xing-signal.active .xing-lamp--a {
  animation: lamp-blink 1s steps(1) infinite;
}
.xing-signal.active .xing-lamp--b {
  animation: lamp-blink 1s steps(1) infinite;
  animation-delay: 0.5s;
}
@keyframes lamp-blink {
  0%,
  50% {
    background: #ff3b3b;
    box-shadow: 0 0 8px rgba(255, 59, 59, 0.9);
  }
  50.01%,
  100% {
    background: #5a2a2a;
    box-shadow: none;
  }
}
</style>
