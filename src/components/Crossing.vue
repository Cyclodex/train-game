<template>
  <!-- Self-contained level-crossing (Bahnübergang) overlay. Positioned over its
  grid cell within `.level`; reads the gate state from the live game's
  reservation/occupancy (a crossing is CLOSED while a train reserves/occupies the
  tile). Cars, booms and lights are render-only here — this is the migratable stub
  that the full road system (src/sim/road.ts) later absorbs. -->
  <div class="crossing" :style="overlayStyle">
    <div class="crossing-rot" :style="rotStyle">
      <!-- road surface with a dashed centre line -->
      <div class="road"></div>

      <!-- cars queueing / crossing along the road -->
      <div
        v-for="car in cars"
        :key="car.id"
        class="car"
        :style="carStyle(car)"
      >
        <span class="car-glass"></span>
      </div>

      <!-- two boom barriers guarding the rail; down (horizontal) when closed -->
      <div class="boom boom--top" :class="{ closed }">
        <div class="boom-arm"></div>
        <div class="boom-post"></div>
      </div>
      <div class="boom boom--bottom" :class="{ closed }">
        <div class="boom-arm"></div>
        <div class="boom-post"></div>
      </div>

      <!-- roadside crossing signals: a classic warning triangle on a post with
      two alternating red lamps, active only while closed. One guards each
      approach, set diagonally just off the road edges. -->
      <div class="signal signal--top" :class="{ active: closed }">
        <div class="signal-tri"></div>
        <div class="signal-lamps">
          <span class="lamp lamp--a"></span>
          <span class="lamp lamp--b"></span>
        </div>
        <div class="signal-post"></div>
      </div>
      <div class="signal signal--bottom" :class="{ active: closed }">
        <div class="signal-tri"></div>
        <div class="signal-lamps">
          <span class="lamp lamp--a"></span>
          <span class="lamp lamp--b"></span>
        </div>
        <div class="signal-post"></div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { Position } from "@/types";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import { TileCell, parseCoordId, pairHas } from "@/tiles/model";
import type { Game } from "@/game";

interface Car {
  id: number;
  pos: number; // centre position along the road axis, in px (0 = top of tile)
  color: string;
}

const CAR_COLORS = ["#d94c4c", "#3f7fd9", "#e0bc5c", "#e7e7e7", "#5fb37a"];

// A pure-render crossing: the booms, lights and a small stream of cars. All
// movement is in a local rAF loop driven by the gate state; nothing here touches
// the simulation, so it stays decoupled from the road-system track.
@Component
class Crossing extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Inject({ from: "game" }) game!: Game;
  @Prop({ type: String, required: true }) coordId!: string;
  @Prop({ type: Object, required: true }) cell!: TileCell;

  cars: Car[] = [];
  private raf = 0;
  private last = 0;

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
    const road = this.cell.road ?? [];
    return road.some(p => pairHas(p, Position.Left) && pairHas(p, Position.Right));
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

  // Where a downward car must stop when the gate is closed (just before the rail).
  get stopLine(): number {
    return this.size * 0.3;
  }

  get carLen(): number {
    return this.size * 0.22;
  }

  get spacing(): number {
    return this.carLen + this.size * 0.06;
  }

  // Below this the car has fully cleared the tile and recycles to the back.
  get exitPoint(): number {
    return this.size + this.carLen;
  }

  mounted() {
    const n = 4;
    for (let i = 0; i < n; i++) {
      this.cars.push({
        id: i,
        pos: -this.spacing * (i + 1),
        color: CAR_COLORS[i % CAR_COLORS.length],
      });
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  beforeUnmount() {
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  private tick = (now: number) => {
    const dt = this.last ? (now - this.last) / 1000 : 0;
    this.last = now;
    this.advance(dt);
    this.raf = requestAnimationFrame(this.tick);
  };

  // Cars move downward at a steady speed, queue behind the car ahead, and hold at
  // the stop line while the gate is closed (unless already past it). Front-most
  // first so each car sees the updated car ahead.
  private advance(dt: number) {
    const speed = this.size * 0.55; // px per second
    const order = [...this.cars].sort((a, b) => b.pos - a.pos);
    let minPos = Infinity;
    for (let i = 0; i < order.length; i++) {
      const car = order[i];
      let limit = this.exitPoint;
      // Gate: a car still approaching (above the stop line) holds when closed; a
      // car already over the line keeps going so it doesn't freeze on the rail.
      if (this.closed && car.pos <= this.stopLine) limit = this.stopLine;
      // Queue behind the car ahead.
      const ahead = order[i - 1];
      if (ahead) limit = Math.min(limit, ahead.pos - this.spacing);
      car.pos = Math.min(car.pos + speed * dt, limit);
      minPos = Math.min(minPos, car.pos);
    }
    // Recycle any car that has cleared the bottom to the back of the queue.
    for (const car of this.cars) {
      if (car.pos >= this.exitPoint) car.pos = minPos - this.spacing;
    }
  }

  carStyle(car: Car) {
    const w = this.size * 0.16;
    return {
      width: `${w}px`,
      height: `${this.carLen}px`,
      left: `${this.size * 0.5 - w / 2}px`,
      top: `${car.pos - this.carLen / 2}px`,
      background: car.color,
    };
  }
}

export default toNative(Crossing);
</script>

<style lang="scss" scoped>
/* No stacking context on the root (no z-index) so the inner layers can straddle
   the train sprite, which is a sibling at z-index 2-3: the road surface sits
   UNDER the train (train visibly crosses over it) while booms, cars and signals
   sit above. NB: a horizontal-road crossing would rotate `.crossing-rot`, which
   creates a stacking context and re-traps these — fine for the current vertical
   crossing; revisit when horizontal road crossings are authored. */
.crossing {
  position: absolute;
  pointer-events: none;
}
.crossing-rot {
  position: absolute;
  inset: 0;
}

.road {
  position: absolute;
  z-index: 1; /* below the train (z 2-3) so the train shows crossing over it */
  left: 34%;
  top: 0;
  width: 32%;
  height: 100%;
  background: #3a3f44;
  box-shadow: inset 4px 0 0 rgba(0, 0, 0, 0.25),
    inset -4px 0 0 rgba(0, 0, 0, 0.25);
  background-image: repeating-linear-gradient(
    to bottom,
    #f2c84b 0 8%,
    transparent 8% 18%
  );
  background-size: 6% 100%;
  background-position: center;
  background-repeat: no-repeat;
}

.car {
  position: absolute;
  z-index: 6; /* above the train; cars never overlap it while the gate is closed */
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.car-glass {
  position: absolute;
  left: 12%;
  right: 12%;
  top: 18%;
  height: 26%;
  background: rgba(180, 220, 255, 0.85);
  border-radius: 2px;
}

/* boom barriers: an arm that pivots down across the road when closed */
.boom {
  position: absolute;
  z-index: 7; /* above the train */
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

/* roadside crossing signals: a classic up-pointing warning triangle on a post
   with two alternating red lamps. Placed diagonally just off the road edges. */
.signal {
  position: absolute;
  z-index: 8; /* furniture sits above everything at the crossing */
  display: flex;
  flex-direction: column;
  align-items: center;
}
.signal--top {
  left: 20%; /* left of the road, guarding the downward approach */
  top: 12%;
}
.signal--bottom {
  left: 72%; /* right of the road, guarding the upward approach */
  top: 60%;
}
/* up-pointing triangle sign: red outer, white inner */
.signal-tri {
  width: 0;
  height: 0;
  border-left: 9px solid transparent;
  border-right: 9px solid transparent;
  border-bottom: 16px solid #d23b3b;
  position: relative;
}
.signal-tri::after {
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
.signal-lamps {
  display: flex;
  gap: 4px;
  margin-top: 1px;
}
.signal-post {
  width: 3px;
  height: 16px;
  background: #555;
  border-radius: 1px;
}
.lamp {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #5a2a2a;
}
.signal.active .lamp--a {
  animation: lamp-blink 1s steps(1) infinite;
}
.signal.active .lamp--b {
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
