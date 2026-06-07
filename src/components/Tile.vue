<template>
  <div
    class="tile clickable"
    :class="[kindClass, { 'tile-depot': isDepot }, isDepot ? depotFacingClass : '']"
    :style="reservationStyle"
  >
    <!-- Road layer (under the rails): paved surface + dashed lane marking,
         derived from the cell's `road` pairs. Only when roads are enabled. -->
    <svg
      v-if="config.roads && roadPaths.length"
      class="road-layer"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <path
        v-for="(r, i) in roadPaths"
        :key="'rs' + i"
        :d="r.surface"
        class="road-surface"
        :class="{ 'road-surface--mismatch': r.mismatch }"
      />
      <!-- Lane-closure gores: hatched, bold-bordered no-drive area of an ending
           lane, painted on the (still paved) closing lane of a reducer tile. -->
      <template v-for="g in roadGores" :key="g.clipId">
        <clipPath :id="g.clipId">
          <path :d="g.triangle" />
        </clipPath>
        <g :clip-path="`url(#${g.clipId})`">
          <path
            v-for="(h, hi) in g.hatch"
            :key="'gh' + hi"
            :d="h"
            class="road-gore-hatch"
          />
        </g>
        <path :d="g.triangle" class="road-gore-border" />
      </template>
      <template v-for="(r, i) in roadPaths" :key="'rm' + i">
        <path
          v-for="(m, mi) in r.laneMarkings"
          :key="'lm' + i + '_' + mi"
          :d="m.d"
          :class="['road-marking-' + m.kind, { 'road-marking-merge': m.merge }]"
        />
      </template>
      <template v-for="(ar, ai) in roadArrows" :key="'ar' + ai">
        <path :d="ar.shaft" class="road-arrow" />
        <path :d="ar.head" class="road-arrow-head" />
      </template>
    </svg>

    <TileRail :possible-routes="railRoutes" />

    <!-- Signals (straights only) -->
    <svg
      v-for="light in signalLights"
      :key="'sig' + light.exitPort"
      class="signal"
      :class="[
        `signal--${light.exitPort}`,
        {
          'signal--forced-green': light.override === 'green',
          'signal--forced-red': light.override === 'red',
        },
      ]"
      width="12"
      height="20"
      @click.stop="cycleSignal(light.exitPort)"
    >
      <rect
        width="12"
        height="20"
        rx="3"
        fill="#222"
        :stroke="
          light.override === 'green'
            ? '#34c759'
            : light.override === 'red'
            ? '#ff3b30'
            : 'none'
        "
        stroke-width="2"
      />
      <circle
        cx="6"
        cy="6"
        r="4"
        :fill="light.aspect === 'stop' ? '#ff3b30' : '#5a1512'"
      />
      <circle
        cx="6"
        cy="14"
        r="4"
        :fill="light.aspect === 'proceed' ? '#34c759' : '#14361d'"
      />
    </svg>

    <!-- Junction switches -->
    <svg
      v-for="entry in junctionEntries"
      :key="'sw' + entry"
      :class="[
        `switch-box switch-box--${entry}`,
        { 'switch-box--locked': isSwitchLocked },
      ]"
      width="24"
      height="18"
      @click.stop="changeSwitch(entry)"
    >
      <circle class="bulb--base" cx="12" cy="13" r="3" />
      <circle
        v-if="switchArmEnabled(entry, 0)"
        class="bulp--direction bulb--left"
        :class="{ 'bulb--active': activeArm(entry) === 0 }"
        cx="4"
        cy="13"
        r="3"
      />
      <circle
        v-if="switchArmEnabled(entry, 1)"
        class="bulp--direction bulb--straight"
        :class="{ 'bulb--active': activeArm(entry) === 1 }"
        cx="12"
        cy="5"
        r="3"
      />
      <circle
        v-if="switchArmEnabled(entry, 2)"
        class="bulp--direction bulb--right"
        :class="{ 'bulb--active': activeArm(entry) === 2 }"
        cx="20"
        cy="13"
        r="3"
      />
    </svg>

    <!-- Depot -->
    <template v-if="isDepot">
      <img class="depot-building" :src="depotBuildingImg" />
      <div class="depot-interaction" :style="depotColorStyle" />
    </template>

    <!-- Car-junction hold (debug): the road junction is currently owned by a car;
         perpendicular cars wait clear of it until the owner leaves. -->
    <div v-if="carJunctionOwner" class="car-junction-hold">
      <span class="car-junction-label">{{ carJunctionOwner }}</span>
    </div>

    <div v-if="config.debug" class="debug">
      <div class="debug-coordinates" v-text="coordId"></div>
      <div class="debug-kind">{{ kind }}{{ roadLaneLabel }}</div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import type { Game } from "@/game";
import { Position, ActiveIntersection, Route } from "@/types";
import {
  TileCell,
  kindOf,
  partnersOf,
  portsOf,
  armExit,
  isJunctionEntry,
  parseCoordId,
} from "@/tiles/model";
import { segmentPathD } from "@/sim/pathGeometry";
import { railPathsFor } from "@/tiles/geometry";
import {
  roadSurfacePolygonPath,
  roadCurvePolygonPath,
  roadLaneMarkingPaths,
  laneDropArrowPath,
  laneDropArrowPlan,
  laneDropGore,
  LaneMarkingPath,
  MergeArrowPath,
} from "@/tiles/roadGeometry";
import { roadEdges, laneCount } from "@/tiles/lanes";
import { neighborCoord, oppositePort } from "@/sim/topology";
import depotBuildingImg from "@/assets/depot.png";

const ARMS = [
  ActiveIntersection.Left,
  ActiveIntersection.Straight,
  ActiveIntersection.Right,
];

// Physical width of one lane as a fraction of tile size. Must match the same
// constant in game.ts so the painted road, the per-car lateral offset, and the
// markings stay in agreement.
const LANE_WIDTH_PX_FRAC = 0.14;

@Component
class Tile extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Inject({ from: "game" }) game!: Game;
  @Prop({ type: Object, required: true }) tile!: TileCell;
  @Prop({ type: String, required: true }) coordId!: string;

  depotBuildingImg = depotBuildingImg;

  get kind() {
    return kindOf(this.tile);
  }
  get kindClass() {
    return `tile-kind--${this.kind}`;
  }
  get roadLaneLabel(): string {
    const road = this.tile.road;
    if (!road?.length) return "";
    const max = Math.max(...roadEdges(road).flatMap(([a, b]) => [laneCount(road, a), laneCount(road, b)]));
    return max > 0 ? ` ${max}L` : "";
  }
  get isDepot() {
    return this.tile.role === "depot";
  }

  // Rail/sleeper paths for every connection, in the shape TileRail expects.
  get railRoutes(): Route[] {
    const size = this.config.tileSize;
    const off = this.config.railDistanceFromPath;
    return this.tile.connections.map(([a, b]) => ({
      path: segmentPathD(a, b, size),
      rails: railPathsFor(a, b, size, off),
      leavesAtPosition: b,
    }));
  }

  // Road surface + lane-marking paths, one per undirected edge the lanes touch
  // (a two-way road is one ribbon, not two). The surface is a filled trapezoid
  // whose width tapers linearly from one end to the other so the road meets
  // its neighbour flush at every seam. The painted width at each end of the
  // edge = (this tile's total lanes, or the neighbour's total at the matching
  // seam, whichever is greater) × lane width. The wider side wins at the
  // seam, the narrower side tapers over the length of its tile. Off-map
  // edges use the tile's own count (no neighbour to match). Lane markings
  // are derived from this tile's per-direction lane counts: a lane that
  // exists on both ends is a straight parallel; a lane that only exists on
  // the wider end tapers to the narrow side's kerb.
  get roadPaths(): { surface: string; laneMarkings: LaneMarkingPath[]; mismatch: boolean }[] {
    const size = this.config.tileSize;
    const LANE_W = size * LANE_WIDTH_PX_FRAC;
    const coord = parseCoordId(this.coordId);
    return roadEdges(this.tile.road).map(([a, b]) => {
      const selfA = laneCount(this.tile.road, a);
      const selfB = laneCount(this.tile.road, b);
      // Minimum 2 so a one-way road still renders as a 2-lane-wide ribbon.
      const selfTotal = Math.max((selfA || 0) + (selfB || 0), 2);
      const isStraight = oppositePort(a) === b;

      // Curved, T-junction, and cross tiles: flag mismatches instead of tapering.
      // Mixed lane counts at non-straight connections cannot route traffic correctly;
      // render the edge red so the author knows to fix the layout.
      if (!isStraight) {
        const na = neighborCoord(coord, a);
        const nb = neighborCoord(coord, b);
        const nTotalA = na
          ? this.game.roadLaneCountAt(na, oppositePort(a))
          : 0;
        const nTotalB = nb
          ? this.game.roadLaneCountAt(nb, oppositePort(b))
          : 0;
        const mismatch =
          (na !== null && nTotalA > 0 && nTotalA !== selfTotal) ||
          (nb !== null && nTotalB > 0 && nTotalB !== selfTotal);
        return {
          surface: roadCurvePolygonPath(a, b, size, selfTotal * LANE_W),
          laneMarkings: roadLaneMarkingPaths(a, b, size, selfA, selfB),
          mismatch,
        };
      }

      // Straight tiles keep their FULL width — the tarmac never tapers to match a
      // narrower neighbour. A lane that ends stays paved (cars merge on it) and is
      // painted as a closure gore (see `roadGores`); the road simply steps down to
      // the narrow neighbour at the seam, which is exactly where the gore finishes
      // closing the lane.
      const width = selfTotal * LANE_W;
      return {
        surface: roadSurfacePolygonPath(a, b, size, width, width),
        laneMarkings: roadLaneMarkingPaths(a, b, size, selfA, selfB, width / 2, width / 2),
        mismatch: false,
      };
    });
  }

  // Swiss-style lane-drop arrows: painted in a lane that is about to end so the
  // driver knows to merge. For each straight edge and each travel direction, we
  // look 1 and 2 tiles downstream; `laneDropArrowPlan` decides whether this tile
  // is the narrowing tile (1 arrow) or the tile just before it (2 advance
  // arrows), and which ending lanes they sit in. Curves/junctions are skipped.
  get roadArrows(): MergeArrowPath[] {
    if (!this.tile.road?.length) return [];
    const size = this.config.tileSize;
    const coord = parseCoordId(this.coordId);
    const out: MergeArrowPath[] = [];
    for (const [a, b] of roadEdges(this.tile.road)) {
      if (oppositePort(a) !== b) continue; // straight tiles only
      for (const [entry, exit] of [[a, b], [b, a]] as [Position, Position][]) {
        const selfN = laneCount(this.tile.road, entry);
        const n1 = neighborCoord(coord, exit);
        if (!n1) continue; // map edge: the road ends, not a lane drop
        const d1 = this.game.roadLaneCount(n1, oppositePort(exit));
        const n2 = neighborCoord(n1, exit);
        const d2 = n2 ? this.game.roadLaneCount(n2, oppositePort(exit)) : 0;
        for (const { laneIndex, alongT } of laneDropArrowPlan(selfN, d1, d2)) {
          out.push(laneDropArrowPath(entry, exit, size, laneIndex, alongT));
        }
      }
    }
    return out;
  }

  // Lane-closure gores (Swiss Sperrfläche): on a reducer tile the lanes that end
  // stay paved (full-width tarmac) and are painted as a hatched, bold-bordered
  // triangle. One per travel direction whose immediate downstream neighbour has
  // fewer lanes. Each carries a unique clip id so its hatch stays inside the gore.
  get roadGores(): { triangle: string; hatch: string[]; clipId: string }[] {
    if (!this.tile.road?.length) return [];
    const size = this.config.tileSize;
    const coord = parseCoordId(this.coordId);
    const safe = this.coordId.replace(/[^a-z0-9]/gi, "_");
    const out: { triangle: string; hatch: string[]; clipId: string }[] = [];
    for (const [a, b] of roadEdges(this.tile.road)) {
      if (oppositePort(a) !== b) continue; // straight tiles only
      for (const [entry, exit] of [[a, b], [b, a]] as [Position, Position][]) {
        const selfN = laneCount(this.tile.road, entry);
        if (selfN < 1) continue;
        const n1 = neighborCoord(coord, exit);
        if (!n1) continue; // map edge: the road ends, not a lane drop
        const survivors = this.game.roadLaneCount(n1, oppositePort(exit));
        if (survivors <= 0 || survivors >= selfN) continue; // no drop here
        const gore = laneDropGore(entry, exit, size, survivors, selfN);
        out.push({ ...gore, clipId: `gore_${safe}_${entry}_${exit}` });
      }
    }
    return out;
  }

  // Entry ports that are junction entries (need a switch widget).
  get junctionEntries(): Position[] {
    return portsOf(this.tile.connections).filter(p =>
      isJunctionEntry(this.tile.connections, p)
    );
  }

  // --- signals ---
  get signalLights() {
    const exits = this.tile.signals ?? [];
    return exits.map(exitPort => ({
      exitPort,
      aspect:
        this.game.signalAspects[`${this.coordId}:${exitPort}`] ?? "proceed",
      override:
        this.game.signalOverrides[`${this.coordId}:${exitPort}`] ?? "auto",
    }));
  }
  cycleSignal(exitPort: Position) {
    this.game.cycleSignal(this.coordId, exitPort);
  }

  // --- switches ---
  switchArmEnabled(entry: Position, arm: ActiveIntersection): boolean {
    const exit = armExit(entry, arm);
    return exit !== null && partnersOf(this.tile.connections, entry).includes(exit);
  }
  activeArm(entry: Position): ActiveIntersection | undefined {
    return this.game.switches[this.coordId]?.[entry];
  }
  get isSwitchLocked(): boolean {
    switch (this.config.switchLockMode) {
      case "reserved":
        return (
          !!this.game.reservations[this.coordId] ||
          !!this.game.occupied[this.coordId]
        );
      case "occupied":
        return !!this.game.occupied[this.coordId];
      default:
        return false;
    }
  }
  changeSwitch(entry: Position) {
    if (this.isSwitchLocked) return;
    const partners = partnersOf(this.tile.connections, entry);
    const cur = this.activeArm(entry) ?? ActiveIntersection.Left;
    // Advance to the next arm whose geometric exit is an actual partner.
    for (let i = 1; i <= ARMS.length; i++) {
      const arm = ARMS[(ARMS.indexOf(cur) + i) % ARMS.length];
      const exit = armExit(entry, arm);
      if (exit !== null && partners.includes(exit)) {
        if (!this.game.switches[this.coordId])
          this.game.switches[this.coordId] = {};
        this.game.switches[this.coordId][entry] = arm;
        return;
      }
    }
  }

  // --- depot ---
  get depotFacingClass(): string {
    const conn = this.tile.connections[0];
    if (!conn) return "tile-rotation--top";
    const outer = conn[0] === Position.Center ? conn[1] : conn[0];
    return (
      {
        [Position.Top]: "tile-rotation--top",
        [Position.Right]: "tile-rotation--right",
        [Position.Bottom]: "tile-rotation--bottom",
        [Position.Left]: "tile-rotation--left",
      }[outer as number] ?? "tile-rotation--top"
    );
  }
  get depotColorStyle() {
    return { backgroundColor: this.game.depotColors[this.coordId] };
  }

  // --- reservation overlay ---
  get reservationStyle(): Record<string, string> {
    if (!this.config.debug) return {};
    const owner = this.game.reservations[this.coordId];
    if (!owner) return {};
    return { backgroundColor: this.game.trainColors[owner] ?? "yellow" };
  }

  // --- car junction overlay (debug) ---
  // The id of the car currently holding this road junction, if any. Cars have no
  // stored reservation (unlike trains): this is derived live from car positions
  // by the road sim. Shown only in debug to make the otherwise-invisible "one car
  // owns the junction at a time" interlock visible on the tile.
  get carJunctionOwner(): string | undefined {
    if (!this.config.debug) return undefined;
    return this.game.carJunctions?.[this.coordId];
  }
}

export default toNative(Tile);
</script>

<style lang="scss" scoped>
.tile {
  position: relative;
  width: 100%;
  height: 100%;
}

/* --- road layer (under the rails) --- */
.road-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1; // under TileRail; the rails cross over the road at a crossing
  pointer-events: none;
  overflow: visible;
}
.road-surface {
  fill: #4a4a4a;
  stroke: none;
}
.road-surface--mismatch {
  // Lane-count mismatch at a non-straight seam — invalid connection, cannot
  // route traffic correctly. Render red so the layout error is obvious.
  fill: #b03030;
}
.road-marking-centre {
  fill: none;
  stroke: #f4d35e;
  stroke-width: 3px;
  stroke-linecap: butt;
}
.road-marking-inner {
  fill: none;
  stroke: rgba(255, 255, 255, 0.7);
  stroke-width: 2px;
  /* Period (13 + 12 = 25) divides the 200px tile exactly (8 dashes/tile). The
     offset lands the tile edge in the MIDDLE of a gap: the gap occupies pattern
     positions [13, 25), whose centre is 19. So abutting tiles each contribute a
     half-gap at the seam, summing to one full gap — the dashes stay evenly
     spaced across tile boundaries. */
  stroke-dasharray: 13 12;
  stroke-dashoffset: 19px;
  stroke-linecap: butt;
}
/* Lane-drop divider (a lane ending at a 3→2 / 2→1 taper, where cars merge
   across): a tighter dash than ordinary dividers to read as the crossing line.
   Period (7 + 13 = 20) also divides 200 (10/tile); gap [7, 20) centre = 13.5. */
.road-marking-merge {
  stroke-dasharray: 7 13;
  stroke-dashoffset: 13.5px;
}
// Lane-drop ("merge ahead") arrow painted inside an ending lane: a slim shaft
// with an open chevron head, both stroked (the Swiss lane-reduction marking).
.road-arrow,
.road-arrow-head {
  fill: none;
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 3px;
  stroke-linecap: round;
  stroke-linejoin: round;
}
// Lane-closure gore (Sperrfläche): diagonal hatch inside a bold solid border,
// marking the no-drive area of a lane that ends on a reducer tile.
.road-gore-hatch {
  fill: none;
  stroke: rgba(255, 255, 255, 0.8);
  stroke-width: 3px;
  stroke-linecap: butt;
}
.road-gore-border {
  fill: none;
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 4px;
  stroke-linejoin: round;
}

/* --- signals (from TileStraight.vue) --- */
.signal {
  position: absolute;
  z-index: 14;
  cursor: pointer;
}
$signal-offset: 20px;
.signal--0 {
  top: 2px;
  left: calc(50% + #{$signal-offset});
  transform: translateX(-50%);
}
.signal--1 {
  right: 2px;
  top: calc(50% + #{$signal-offset});
  transform: translateY(-50%);
}
.signal--2 {
  bottom: 2px;
  left: calc(50% - #{$signal-offset});
  transform: translateX(-50%);
}
.signal--3 {
  left: 2px;
  top: calc(50% - #{$signal-offset});
  transform: translateY(-50%);
}

/* --- switches (from TileIntersectionComplete.vue) --- */
.switch-box {
  background-color: black;
  z-index: 20;
  position: absolute;

  :deep(circle) {
    fill: white;
    transition: all 0.5s cubic-bezier(0.89, 0.27, 0.78, 0.59);
  }

  &.switch-box--0 {
    left: 57%;
    top: 0;
    transform: rotate(180deg);
  }
  &.switch-box--1 {
    right: 0;
    top: 57%;
    transform: rotate(-90deg);
  }
  &.switch-box--2 {
    left: 57%;
    bottom: 0;
  }
  &.switch-box--3 {
    left: 0;
    top: 57%;
    transform: rotate(90deg);
  }

  :deep(.bulp--direction) {
    opacity: 0.4;
  }
  :deep(.bulb--active) {
    opacity: 1;
  }

  &.switch-box--locked {
    cursor: not-allowed;
    outline: 2px solid #ff3b30;
  }
}

/* --- depot (from TileDepot.vue) --- */
.tile-depot {
  .depot-building {
    position: absolute;
    height: 70px;
    z-index: 10;
  }
  .depot-interaction {
    position: absolute;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    z-index: 1000;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    border: 2px solid black;
  }
}
.tile-rotation--top .depot-building {
  bottom: 0;
  left: 50%;
  transform: translate(-45%, -60%) rotate(-90deg);
}
.tile-rotation--right .depot-building {
  top: 50%;
  left: 0;
  transform: translate(0, -40%);
}
.tile-rotation--bottom .depot-building {
  top: 0;
  left: 50%;
  transform: translate(-45%, 60%) rotate(-90deg);
}
.tile-rotation--left .depot-building {
  top: 50%;
  right: 0;
  transform: translate(0, -40%);
}

.debug {
  font-size: 12px;
  z-index: 1;
  text-align: left;
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.debug-coordinates {
  position: absolute;
  bottom: 0;
  left: 0;
}
.debug-kind {
  position: absolute;
  top: 0;
  right: 0;
  color: #1b3a1b;
}

/* Car-junction hold (debug overlay): an amber wash + dashed ring on a road
   junction a car currently owns. Sits above the road surface but below the cars
   (z6) so the owning car still reads on top of its own highlight. */
.car-junction-hold {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  background: rgba(255, 176, 32, 0.28);
  border: 3px dashed rgba(255, 176, 32, 0.95);
  box-sizing: border-box;
  animation: car-junction-pulse 0.9s ease-in-out infinite;
}
.car-junction-label {
  position: absolute;
  top: 2px;
  left: 2px;
  font-size: 11px;
  font-weight: 700;
  color: #5a3a00;
  background: rgba(255, 176, 32, 0.95);
  padding: 0 3px;
  border-radius: 3px;
}
@keyframes car-junction-pulse {
  0%,
  100% {
    background: rgba(255, 176, 32, 0.18);
  }
  50% {
    background: rgba(255, 176, 32, 0.38);
  }
}
</style>
