<template>
  <!-- Level-crossing (Bahnübergang) furniture overlay: boom barriers and their
  Blinklichtsignale. The road surface is drawn by the tile's road layer and the
  cars by the road simulation; this component only adds the crossing furniture
  and reads the gate state (CLOSED while a train reserves or occupies the tile).

  Everything is POSITIONED FROM THE ROAD, not from tile percentages: see
  tiles/crossingFurniture.ts. A BIG street is guarded on both sides of the rails
  and from both verges — four bars, each hinged outside its own kerb — instead of
  one short bar parked on the tarmac. A narrow 1+1 street keeps the classic
  diagonal pair. Every mast carries its own signal, and facing arms stop short of
  each other, so a closed crossing reads as the pair of barriers it is. -->
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

      <!-- Blinklichtsignal — one on EVERY barrier mast: a red-bordered triangular
      panel, white inside the red, with a black face carrying two red lights side
      by side at the same height, alternating while the crossing is closed. The
      mast is banded red/white like the barrier arm it stands on. -->
      <div
        v-for="(s, i) in layout.signs"
        :key="'sign' + i"
        class="xing-signal"
        :class="{ active: closed }"
        :style="signStyle(s)"
      >
        <div class="xing-panel">
          <!-- ONE triangle painted three times. A round-joined stroke grows the
          silhouette outward by half its width, so a wide red stroke, a narrow
          white one and the bare fill give three CONCENTRIC rounded-corner rings
          from a single path — which `clip-path` polygons cannot do (they have no
          radius, and each ring would need its own hand-inset triangle). The
          viewBox is 1:1 with the panel's pixels, so the lamp offsets in the CSS
          below can be read straight against these coordinates. -->
          <svg class="xing-plate" viewBox="0 0 26 22" width="26" height="22">
            <path class="xing-rim" :d="panelTri" />
            <path class="xing-edge" :d="panelTri" />
            <path class="xing-face" :d="panelTri" />
          </svg>
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

// The signal panel's triangle, in its own 26x22 viewBox. Inset from every edge by
// the WIDEST half-stroke it is painted with (2.9, the red rim), so the outermost
// silhouette lands exactly on the panel's bounds instead of overflowing them.
const PANEL_TRIANGLE = "M13 2.9 L23.1 19.1 L2.9 19.1 Z";

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

  get panelTri(): string {
    return PANEL_TRIANGLE;
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

  // A sign is PLACED in the local frame (so it follows the road like the booms
  // do) but DRAWN in the screen frame: the panel is a triangle read as a glyph,
  // and the quarter turn `.crossing-rot` applies for a horizontal road would lay
  // it on its side, pointing at the verge with its mast sticking out sideways.
  // Cancelling the turn keeps every crossing signal upright, whichever way the
  // road runs. The rotation is about the element's centre, which `translate` has
  // already put on the layout point, so undoing it does not move the sign.
  signStyle(s: CrossingSign) {
    return {
      left: `${this.size / 2 + s.x}px`,
      top: `${s.y}px`,
      transform: this.horizontalRoad
        ? "translate(-50%, -50%) rotate(-90deg)"
        : undefined,
    };
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

/* Blinklichtsignal: a RED-bordered triangular panel — red rim, white inside it,
black face — carrying two red lights side by side at the same height, on a short
red/white banded mast. One per barrier mast. */
.xing-signal {
  position: absolute;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translate(-50%, -50%);
}
/* The panel is the <svg> plate; the lamps are real children of the UNCLIPPED
wrapper beside it, because an <svg> clips to its viewBox and would eat the lights
sitting near the triangle's edges. */
.xing-panel {
  position: relative;
  width: 26px;
  height: 22px;
}
.xing-plate {
  position: absolute;
  inset: 0;
  overflow: visible;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
}
/* Three rings from one path: each stroke is painted UNDER the next, and a stroke
grows the shape outward by half its width — so the widths are the ring radii, and
their DIFFERENCES are the visible ring thicknesses (red 1.9, white 1.0). */
.xing-rim,
.xing-edge,
.xing-face {
  stroke-linejoin: round;
}
.xing-rim {
  fill: #d81f26;
  stroke: #d81f26;
  stroke-width: 5.8;
}
.xing-edge {
  fill: #f2f2f2;
  stroke: #f2f2f2;
  stroke-width: 2;
}
.xing-face {
  fill: #1d1d1d;
  stroke: none;
}
/* The mast is banded like the barrier arm it stands beside; the hairline keeps a
white band from vanishing into a light road marking. */
.xing-post {
  width: 4px;
  height: 14px;
  border-radius: 1px;
  background: repeating-linear-gradient(
    to bottom,
    #e23b3b 0 3.5px,
    #f6f6f6 3.5px 7px
  );
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.35);
}
/* The two lenses sit low on the panel, where the triangle is widest — centred on
(8.6, 15.6) and (17.4, 15.6) of the viewBox above, which keeps a 6px circle clear
of the white ring. Dark red when off — a lens, not a hole — so the signal still
reads as TWO lights while only one of them is lit. */
.xing-lamp {
  position: absolute;
  z-index: 1;
  top: 12.6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6b3030;
}
.xing-lamp--a {
  left: 5.6px;
}
.xing-lamp--b {
  left: 14.4px;
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
    background: #6b3030;
    box-shadow: none;
  }
}
</style>
