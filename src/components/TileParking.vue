<template>
  <!-- THREE Z-LAYERS, ONE COMPONENT. The parking paint cannot be dropped in at a
       single point: the apron belongs UNDER the road's own kerb line and markings
       (so the two read as one continuous surface), the bay lines belong OVER
       them, and the facility sign is an HTML chip above the whole tile. So the
       caller places three instances and names which one it wants. Geometry is
       recomputed per instance — a handful of path strings per parking tile, and
       nothing at all on a tile with no bays, which is nearly all of them. -->
  <template v-if="layer === 'apron'">
    <!-- The strip of tarmac the bays stand on, painted right after the
         carriageway and before its kerb line and markings, so the two read as
         one continuous surface instead of bays floating on grass (the same trick
         `.road-gore-fill` uses for a hatched closure). -->
    <template v-for="(p, pi) in paths" :key="'pk' + pi">
      <path
        v-if="p.apron"
        :d="p.apron"
        class="parking-apron"
        :class="{ 'parking-apron--private': p.priv }"
      />
      <path v-if="p.garage" :d="p.garage.apron" class="parking-apron" />
      <path v-if="p.garageOut" :d="p.garageOut.apron" class="parking-apron" />
    </template>
  </template>

  <template v-else-if="layer === 'paint'">
    <!-- BAY LINES, over the road's own markings: the outline of each space plus
         the outer kerb where the apron meets the verge. An occupied bay is tinted
         so a full car park reads at a glance even when the cars in it are
         small. -->
    <template v-for="(p, pi) in paths" :key="'pl' + pi">
      <path
        v-for="s in p.stalls"
        :key="s.key"
        :d="s.d"
        class="parking-bay"
        :class="[
          { 'parking-bay--taken': s.occupied },
          p.reserved ? 'parking-bay--' + p.reserved : '',
        ]"
      />
      <path v-if="p.kerb" :d="p.kerb" class="parking-kerb" />
      <template v-if="p.bus">
        <path :d="p.bus.kerbLine" class="bus-stop-kerb" />
        <path
          v-for="(l, li) in p.bus.legend"
          :key="'bl' + pi + '_' + li"
          :d="l"
          class="bus-stop-legend"
        />
        <path :d="p.bus.shelter" class="bus-stop-shelter" />
        <path :d="p.bus.shelterRoof" class="bus-stop-roof" />
        <template v-if="p.busHalt">
          <path :d="p.bus.sign" class="bus-stop-pole" />
          <path :d="p.bus.signFlag" class="bus-stop-flag" />
        </template>
        <!-- THE PEOPLE WAITING HERE, in the colour of the line they are waiting
             for — the same dots a platform draws, because a kerb is a stop of
             the same network (#90). Without them a halt with six people looked
             exactly like an empty one: the HUD counted a crowd the board never
             showed. -->
        <circle
          v-for="(w, wi) in p.waiting"
          :key="'bw' + pi + '_' + wi"
          :cx="w.x"
          :cy="w.y"
          r="4.5"
          class="stop-passenger"
          :style="{ fill: w.fill }"
        >
          <title>{{ w.title }}</title>
        </circle>
      </template>
      <template v-if="p.garage">
        <path :d="p.garage.mouth" class="parking-garage-mouth" />
        <path :d="p.garage.arrow" class="parking-garage-arrow" />
      </template>
      <template v-if="p.garageOut">
        <path :d="p.garageOut.mouth" class="parking-garage-mouth" />
        <path :d="p.garageOut.arrow" class="parking-garage-arrow" />
      </template>
    </template>
  </template>

  <!-- Car-park sign: "P 3/12", or "P VOLL" when there is no space left. Drawn
       once per car park, above the cars, from the SAME live counts the router
       reads when it decides where to send a driver — so "cars avoid a full car
       park" is something a player can actually watch happen. -->
  <div
    v-else-if="sign"
    class="parking-sign"
    :class="{ 'parking-sign--full': sign.full }"
    :style="{ left: sign.x + 'px', top: sign.y + 'px' }"
  >
    <span class="parking-sign-count">{{ sign.text }}</span>
    <span class="parking-sign-label">{{ sign.label }}</span>
  </div>
</template>

<script lang="ts">
// The PARKING PAINT, lifted out of `Tile.vue`.
//
// It was ~350 lines spread over four places in a 2300-line component that also
// draws rails, switches, signals, depots and fare pins — so the next person to
// touch a bay line had to open all of it. Nothing here is new: the maths already
// lived in `tiles/parkingGeometry.ts` and this only assembles path strings, which
// is why the move is verifiable as pixel-identical rather than argued about.
//
// The one thing that is genuinely this component's own is `kerbFor` — see below.
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import type { Game } from "@/game";
import { Position, type Coordinates } from "@/types";
import { TileCell, parseCoordId } from "@/tiles/model";
import { laneCountAt, roadSeamPaintTotal, isOneWayStraight } from "@/tiles/lanes";
import { neighborCoord, oppositePort } from "@/sim/topology";
import {
  parkingApronPath,
  parkingKerbPath,
  parkingSignAnchor,
  stallOutlinePath,
  garageGeometry,
  busStopGeometry,
  busStopQueueSpots,
} from "@/tiles/parkingGeometry";
import { rowsOf, rowSide, stallId, facilityOf } from "@/tiles/parking";
import type { ParkingRow } from "@/tiles/parking";

// Anyone the network cannot help waits in plain clothes; see Tile.vue, which
// uses the same neutral for a platform queue.
const NEUTRAL_PASSENGER = "#8a5a3b";

// Physical width of one lane as a fraction of tile size. Must match the same
// constant in game.ts and Tile.vue so the painted road, the per-car lateral
// offset, and the markings stay in agreement.
const LANE_WIDTH_PX_FRAC = 0.14;

export type ParkingLayer = "apron" | "paint" | "sign";

@Component
class TileParking extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Inject({ from: "game" }) game!: Game;
  @Prop({ type: Object, required: true }) tile!: TileCell;
  @Prop({ type: String, required: true }) coordId!: string;
  @Prop({ type: String, required: true }) layer!: ParkingLayer;

  // Where the kerb sits for a parking row's approach, in px. This mirrors
  // `tiles/parking.ts kerbOffsetAt` exactly, but resolves its neighbours through
  // the injected Game road API instead of the level: a tile component deliberately
  // sees only its own cell (unlike `TileGround`), and the editor supplies a no-op
  // Game that this then keeps working against. Keep the two in lockstep — if the
  // painted bay and the sim's manoeuvre curve disagree about where the kerb is,
  // cars park on the road markings.
  //
  // A METHOD, not a getter: it takes arguments, and vue-facing-decorator turns a
  // getter into a cached computed (KNOWHOW → CAMERA).
  kerbFor(coord: Coordinates, from: Position): number {
    const size = this.config.tileSize;
    const road = this.tile.road;
    // A one-way aisle is kerb-anchored to its run's widest lane count and never
    // seam-tapers — measuring it by the two-way max(laneCountAt, 2) rule would put
    // the kerb 14px too far out and leave a car's width of grass under the bays.
    if (isOneWayStraight(road, from)) {
      return (this.game.roadOneWayRunMax(coord, from) / 2) * LANE_WIDTH_PX_FRAC * size;
    }
    const selfTotal = Math.max(laneCountAt(road, from), 2);
    let widest = 0;
    for (const port of [from, oppositePort(from)]) {
      const nb = neighborCoord(coord, port);
      const crossing = nb ? this.game.roadLaneCountAt(nb, oppositePort(port)) : 0;
      const total = roadSeamPaintTotal(
        selfTotal,
        crossing,
        nb ? this.game.roadIsJunctionAt(nb) : false,
      );
      widest = Math.max(widest, (total / 2) * LANE_WIDTH_PX_FRAC * size);
    }
    return widest;
  }

  // The queue at a halt: one dot per waiting passenger, coloured by the LINE
  // they will board (`game.stationWaitingColours`), capped so a swamped stop
  // crowds rather than paving the verge. Read from the same mirrors a platform
  // queue uses, so a kerb and a platform can never disagree about who is
  // standing where.
  waitingAt(
    row: ParkingRow,
    size: number,
    kerb: number,
  ): { x: number; y: number; fill: string; title: string }[] {
    const count = Math.min(this.game.stationQueues?.[this.coordId] ?? 0, 12);
    if (count === 0) return [];
    const dests = this.game.stationWaiting?.[this.coordId] ?? [];
    const colours = this.game.stationWaitingColours?.[this.coordId] ?? [];
    const labels = this.game.stationLabels ?? {};
    return busStopQueueSpots(row, size, kerb, count).map((p, i) => ({
      x: p.x,
      y: p.y,
      fill: colours[i] || NEUTRAL_PASSENGER,
      title: dests[i] ? `waiting for ${labels[dests[i]] ?? dests[i]}` : "waiting",
    }));
  }

  // The parking layer's paint: the apron each row of bays stands on, its outer
  // kerb, and one outline per bay.
  get paths(): {
    apron: string;
    kerb: string;
    reserved?: string;
    // Somebody's DRIVE rather than public parking. Paint, not behaviour — but
    // the paint is what tells a player at a glance which tarmac is theirs to
    // park on, and the rules are invisible without it.
    priv: boolean;
    stalls: { d: string; key: string; occupied: boolean }[];
    garage: ReturnType<typeof garageGeometry> | null;
    garageOut: ReturnType<typeof garageGeometry> | null;
    bus: ReturnType<typeof busStopGeometry> | null;
    // A HALT stands in the lane and so needs a sign; a LAY-BY has a bay to mark.
    busHalt: boolean;
    waiting: { x: number; y: number; fill: string; title: string }[];
  }[] {
    if (!this.config.roads) return [];
    const rows = rowsOf(this.tile);
    if (rows.length === 0) return [];
    const size = this.config.tileSize;
    const coord = parseCoordId(this.coordId);
    const occupancy = this.game.parkingOccupancy;
    return rows.map(row => {
      const kerb = this.kerbFor(coord, row.from);
      const side = rowSide(row);
      const stalls: { d: string; key: string; occupied: boolean }[] = [];
      if (row.kind !== "garage") {
        for (let i = 0; i < row.count; i++) {
          const key = stallId({ tileId: this.coordId, from: row.from, side, index: i });
          stalls.push({
            d: stallOutlinePath(row, i, size, kerb),
            key,
            occupied: !!occupancy?.[key],
          });
        }
      }
      return {
        apron: parkingApronPath(row, size, kerb),
        kerb: parkingKerbPath(row, size, kerb),
        reserved: row.reserved,
        priv: !!row.resident,
        stalls,
        // A bus stop of either shape gets its yellow kerb marking, its legend and
        // its shelter. Without them a lay-by is indistinguishable from the lorry
        // bay beside it (same size, same outline) and a halt is invisible entirely.
        bus:
          row.kind === "busstop" || row.reserved === "bus"
            ? busStopGeometry(row, size, kerb)
            : null,
        busHalt: row.kind === "busstop",
        waiting: row.kind === "busstop" ? this.waitingAt(row, size, kerb) : [],
        garage: row.kind === "garage" ? garageGeometry(row, size, kerb, "in") : null,
        // The second driveway. A garage a car can only reverse out of reads as a
        // dead end; the out-ramp is what makes it a building traffic flows THROUGH.
        garageOut: row.kind === "garage" ? garageGeometry(row, size, kerb, "out") : null,
      };
    });
  }

  // The "P 3/12" chip for a car park, drawn once per facility on its lowest tile.
  // Without it, "cars avoid a car park that is already full" is a behaviour no
  // player can ever see — the whole routing half of the feature would be
  // invisible work.
  get sign(): { x: number; y: number; label: string; text: string; full: boolean } | null {
    if (!this.config.roads) return null;
    const rows = rowsOf(this.tile);
    if (rows.length === 0) return null;
    const fid = facilityOf(this.tile, this.coordId);
    if (!fid) return null;
    const status = this.game.parkingStatus?.[fid];
    if (!status) return null;
    // Only the facility's own sign tile draws it, or a ten-tile car park would
    // carry ten identical signs.
    if (status.signTileId !== this.coordId) return null;
    const size = this.config.tileSize;
    const coord = parseCoordId(this.coordId);
    const row = rows[0];
    const anchor = parkingSignAnchor(row, size, this.kerbFor(coord, row.from));
    // A bus stop is an H, not a P. Both signs count the same way, but a car-park
    // P over a bus stop reads as somewhere to leave your car, which is the one
    // thing it is not.
    const isStop = rows.every(r => r.kind === "busstop" || r.reserved === "bus");
    const mark = isStop ? "H" : "P";
    return {
      x: anchor.x,
      y: anchor.y,
      label: status.label,
      text: status.free > 0 ? `${mark} ${status.free}/${status.capacity}` : `${mark} VOLL`,
      full: status.free <= 0,
    };
  }
}
export default toNative(TileParking);
</script>

<style lang="scss" scoped>
/* The apron reads as the SAME tarmac as the carriageway (matching
   `.road-surface`), so a kerbside bay looks like a widening of the street rather
   than a separate slab parked next to it. */
.parking-apron {
  fill: #4a4a4a;
}
/* ...EXCEPT A PRIVATE DRIVE, which is the one case where reading as the street
   is exactly wrong. A drive is not a widening of the carriageway, it is the
   householder's own hardstanding, and it is laid in whatever the householder
   laid it in — concrete, gravel, block paving — never in the road's tarmac.
   Painting it pale is the only thing on the board that tells a player which
   spaces are theirs to take and which belong to the house behind them; the rule
   itself (`ParkingRow.resident`) is otherwise completely invisible. */
.parking-apron--private {
  fill: #9c9187;
}
/* The outer kerb, where the parking strip meets the verge. The road's own kerb
   line is buried under the apron on this flank, so without this the tarmac would
   bleed straight into the grass. */
.parking-kerb {
  fill: none;
  stroke: #d9d9d9;
  stroke-width: 2;
  stroke-linecap: round;
}
/* One outline per space. Bay lines are what a player actually reads as
   "parking" — the shape alone says it before any car arrives. */
.parking-bay {
  fill: rgba(255, 255, 255, 0.02);
  stroke: #e8e8e8;
  stroke-width: 1.6;
  stroke-linejoin: round;
}
/* A taken bay. Tinted rather than hidden: at this zoom a small car does not by
   itself make a car park look full, and "is there space?" is the question the
   whole feature is about. */
.parking-bay--taken {
  fill: rgba(255, 255, 255, 0.08);
  stroke: rgba(232, 232, 232, 0.45);
}
/* Reserved bays, painted in their real-world colours so they read without a
   legend. Nothing may park in them yet — that is deliberate: a car park is never
   100% usable, and the empty blue bays are what make it look like one. */
.parking-bay--disabled {
  fill: rgba(60, 130, 220, 0.32);
  stroke: #cfe4ff;
}
.parking-bay--delivery {
  fill: rgba(230, 170, 40, 0.26);
  stroke: #ffe4a8;
}
.parking-bay--long {
  fill: rgba(255, 255, 255, 0.03);
  stroke-dasharray: 7 4;
}
/* Bus stops. A lay-by is the same SIZE and OUTLINE as the lorry bay beside it and
   a halt has no outline at all, so neither can be told apart by shape — the
   yellow kerb marking is what says "bus", exactly as it does on a real street. */
.bus-stop-kerb {
  fill: none;
  stroke: #ffd24a;
  stroke-width: 3;
  stroke-dasharray: 9 6;
  stroke-linecap: round;
}
/* Three bars standing in for the word BUS. Real lettering is unreadable at this
   size, and a glyph nobody can read is noise rather than information. */
.bus-stop-legend {
  fill: none;
  stroke: #ffd24a;
  stroke-width: 3.4;
  stroke-linecap: round;
  opacity: 0.85;
}
.bus-stop-shelter {
  fill: rgba(40, 48, 58, 0.9);
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 1;
}
.bus-stop-roof {
  fill: none;
  stroke: #dfe6ee;
  stroke-width: 3.5;
  stroke-linecap: round;
}
.bus-stop-pole {
  fill: none;
  stroke: #cfd6de;
  stroke-width: 2;
  stroke-linecap: round;
}
.bus-stop-flag {
  fill: #ffd24a;
  stroke: #6b5300;
  stroke-width: 1;
}

/* A person waiting at a halt. Same size and outline as the platform crowd in
   Tile.vue, so the two read as the same kind of thing. */
.stop-passenger {
  stroke: rgba(0, 0, 0, 0.55);
  stroke-width: 1;
}

.parking-bay--bus {
  fill: rgba(70, 190, 150, 0.22);
  stroke: #bff3e2;
  stroke-dasharray: 7 4;
}
/* The garage ramp: a dark mouth under the building, with a chevron pointing in.
   A car that drives to a bare kerb and vanishes reads as a despawn BUG — the
   ramp is what makes it read as a garage. */
.parking-garage-mouth {
  fill: #15181c;
}
.parking-garage-arrow {
  fill: none;
  stroke: #f0f0f0;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.8;
}
.parking-sign {
  position: absolute;
  z-index: 11; // above the cars (6) and the garage building (10)
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(18, 46, 96, 0.92);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  white-space: nowrap;
}
.parking-sign--full {
  background: rgba(120, 26, 26, 0.94);
}
.parking-sign-count {
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  letter-spacing: 0.02em;
}
.parking-sign-label {
  font-size: 7px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.72);
}
</style>
