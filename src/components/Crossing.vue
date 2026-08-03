<template>
  <!-- Level-crossing (Bahnübergang) furniture overlay: boom barriers, warning
  lights and roadside triangle signals. The road surface is drawn by the tile's
  road layer and the cars by the road simulation; this component only adds the
  crossing furniture and reads the gate state (CLOSED while a train reserves or
  occupies the tile).

  Everything is POSITIONED FROM THE ROAD, not from tile percentages: see
  tiles/crossingFurniture.ts. A two-way street gets one half-barrier per
  approach — hinged on the verge outside its own kerb, reaching to the centre
  line, so a 3+3-lane street is guarded by a bar on the left AND one on the
  right instead of one short bar parked on the tarmac. -->
  <div class="crossing" :style="overlayStyle">
    <div class="crossing-rot" :style="rotStyle">
      <!-- one boom per guarded approach; arm down (across the road) when closed -->
      <div
        v-for="(b, i) in layout.booms"
        :key="'boom' + i"
        class="boom"
        :class="{ closed }"
        :style="boomStyle(b)"
      >
        <div class="boom-arm"></div>
        <div class="boom-post"></div>
      </div>

      <!-- roadside crossing signals: a classic up-pointing warning triangle on a
      post with two alternating red lamps, one guarding each approach. -->
      <div
        v-for="(s, i) in layout.signs"
        :key="'sign' + i"
        class="xing-signal"
        :class="{ active: closed }"
        :style="signStyle(s)"
      >
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
import { TileCell, Port, parseCoordId } from "@/tiles/model";
import { laneCount, roadPortsOf } from "@/tiles/lanes";
import { neighborCoord, oppositePort } from "@/sim/topology";
import {
  CrossingBoom,
  CrossingLayout,
  CrossingSign,
  crossingLayout,
  crossingRoadSpan,
} from "@/tiles/crossingFurniture";
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

  // The two ports of the road, named by the LOCAL (upright) frame the furniture
  // is drawn in: `down` is the port traffic enters from to travel local-down.
  // CSS rotate(90deg) maps local +y to screen −x, so for a horizontal road
  // "local down" is the Right→Left movement — hence Right, not Left.
  get roadPorts(): { down: Port; up: Port } {
    return this.horizontalRoad
      ? { down: Position.Right, up: Position.Left }
      : { down: Position.Top, up: Position.Bottom };
  }

  // Where the booms and signs stand, derived from the painted road width.
  get layout(): CrossingLayout {
    const road = this.cell.road;
    const coord = parseCoordId(this.coordId);
    const { down, up } = this.roadPorts;
    const seam = (port: Port) => {
      const n = neighborCoord(coord, port);
      return {
        cross: n ? this.game.roadLaneCountAt(n, oppositePort(port)) : 0,
        junction: n ? this.game.roadIsJunctionAt(n) : false,
      };
    };
    const d = seam(down);
    const u = seam(up);
    const downLanes = laneCount(road, down);
    const upLanes = laneCount(road, up);
    const span = crossingRoadSpan({
      size: this.size,
      downLanes,
      upLanes,
      crossDown: d.cross,
      crossUp: u.cross,
      downIsJunction: d.junction,
      upIsJunction: u.junction,
      runMax: this.game.roadOneWayRunMax(coord, downLanes > 0 ? down : up),
    });
    return crossingLayout(this.size, span);
  }

  // A boom is placed at its hinge and drawn as an arm reaching `length` px to
  // the right; the arm that reaches the other way is the mirror image, so the
  // one set of arm/post rules serves both.
  boomStyle(b: CrossingBoom) {
    return {
      left: `${this.size / 2 + b.hinge}px`,
      top: `${b.y}px`,
      width: `${b.length}px`,
      transform: b.dir === -1 ? "scaleX(-1)" : undefined,
    };
  }

  signStyle(s: CrossingSign) {
    return { left: `${this.size / 2 + s.x}px`, top: `${s.y}px` };
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

/* boom barriers: an arm that pivots down across the road when closed. The
element is anchored at the HINGE (the post) and is `length` px wide; a barrier
that sweeps the other way is the same element mirrored (scaleX(-1)), so the arm
geometry below is written once for a rightward sweep. */
.boom {
  position: absolute;
  z-index: 7; /* above the road surface, cars and the train */
  height: 0;
  /* Mirror about the HINGE, not the element's middle: `left` is placed at the
  hinge, so a centre-origin scaleX(-1) would slide the whole barrier one arm's
  length sideways. */
  transform-origin: left center;
}
.boom-post {
  position: absolute;
  left: -4px;
  top: -6px;
  width: 8px;
  height: 12px;
  background: #d23b3b;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
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
  transform: translate(-50%, -50%);
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
