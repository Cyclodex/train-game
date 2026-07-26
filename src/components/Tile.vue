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
      <g v-for="(r, i) in roadPaths" :key="'rs' + i">
        <title v-if="r.mismatch">{{ r.mismatchTip }}</title>
        <path
          :d="r.surface"
          class="road-surface"
          :class="{ 'road-surface--mismatch': r.mismatch }"
        />
      </g>
      <!-- Parking APRON: the strip of tarmac the bays stand on, painted right
           after the carriageway and before its kerb line and markings, so the
           two read as one continuous surface instead of bays floating on grass
           (the same trick `.road-gore-fill` uses for a hatched closure). -->
      <template v-for="(p, pi) in parkingPaths" :key="'pk' + pi">
        <path v-if="p.apron" :d="p.apron" class="parking-apron" />
        <path v-if="p.garage" :d="p.garage.apron" class="parking-apron" />
        <path v-if="p.garageOut" :d="p.garageOut.apron" class="parking-apron" />
      </template>
      <!-- Bus-lane tint: a gold strip over just the bus lane(s), not the whole
           ribbon, laterally aligned with the lane's cars/arrows. -->
      <path
        v-for="(b, bi) in busLaneBands"
        :key="'bus' + bi"
        :d="b"
        class="road-bus-band"
      />
      <!-- Road edge line where the tarmac meets the grass (per outer kerb).
           On a junction the real kerbs are SOLID corner fillets tracing the
           curved concrete (plus the flat side of a T); across the open box the
           kerb continues as a DASHED guide line for through traffic — like a
           real intersection. -->
      <template v-for="(r, i) in roadPaths" :key="'re' + i">
        <path
          v-for="(e, ei) in r.edges"
          :key="'re' + i + '_' + ei"
          :d="e.d"
          class="road-edge"
          :class="{ 'road-edge--dashed': e.dashed }"
        />
      </template>
      <template v-for="(r, i) in roadPaths" :key="'rm' + i">
        <!-- Inside a junction the solid centre line breaks into dashes (real
             intersections don't carry the solid divider across the box). -->
        <path
          v-for="(m, mi) in r.laneMarkings"
          :key="'lm' + i + '_' + mi"
          :d="m.d"
          :class="[
            'road-marking-' + m.kind,
            {
              'road-marking-merge': m.merge,
              'road-marking-solid': m.solid,
              'road-marking-junction': tileIsRoadJunction,
            },
          ]"
        />
      </template>
      <!-- Lane-drop gores (hatched closure triangles) and advance arrows -->
      <template v-if="laneDropOverlay.gores.length || laneDropOverlay.arrows.length">
        <defs>
          <clipPath
            v-for="g in laneDropOverlay.gores"
            :key="'gc' + g.clipId"
            :id="g.clipId"
          >
            <path :d="g.triangle" />
          </clipPath>
        </defs>
        <template v-for="g in laneDropOverlay.gores" :key="'g' + g.clipId">
          <!-- Pave the closing-lane triangle so it reads as road, not grass. -->
          <path :d="g.triangle" class="road-gore-fill" />
          <g :clip-path="`url(#${g.clipId})`">
            <path
              v-for="(h, hi) in g.hatch"
              :key="hi"
              :d="h"
              class="road-gore-hatch"
            />
          </g>
          <path :d="g.triangle" class="road-gore-border" />
        </template>
        <template v-for="(arr, ai) in laneDropOverlay.arrows" :key="'da' + ai">
          <path :d="arr.shaft" class="road-drop-arrow-shaft" />
          <path :d="arr.head" class="road-drop-arrow-head" />
        </template>
      </template>
      <!-- Per-lane direction arrows: white road arrows on a straight tile that
           feeds a junction, showing each lane's permitted turns (↑ ↰ ↱). Only
           painted when the lanes are sorted (their movement sets differ). -->
      <template v-for="(arr, ai) in laneDirectionArrows" :key="'lda' + ai">
        <path :d="arr.shaft" class="road-lane-arrow" :class="{ 'road-lane-arrow--bus': arr.bus }" />
        <path
          v-for="(h, hi) in arr.heads"
          :key="'ldah' + ai + '_' + hi"
          :d="h"
          class="road-lane-arrow"
          :class="{ 'road-lane-arrow--bus': arr.bus }"
        />
      </template>
      <!-- Parking BAY LINES, over the road's own markings: the outline of each
           space plus the outer kerb where the apron meets the verge. An occupied
           bay is tinted so a full car park reads at a glance even when the cars
           in it are small. -->
      <template v-for="(p, pi) in parkingPaths" :key="'pl' + pi">
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
      <!-- Signalised-junction STOP LINES live in the road layer (on the street,
           UNDER the cars and debug arrows). The signal heads + gantry are a
           separate overlay above the cars (see below). -->
      <path
        v-for="(arm, ai) in roadSignalArms"
        :key="'rsl' + ai"
        :d="arm.stopLine"
        class="road-stop-line"
      />
    </svg>

    <!-- Lane graph debug overlay: directed arrows from port→port for each road
         movement. Cyan = car lanes; amber = bus-only lanes. Only in debug mode. -->
    <svg
      v-if="config.debug && laneGraphOverlay.length"
      class="road-layer lane-graph-layer"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <template v-for="(m, mi) in laneGraphOverlay" :key="'lg' + mi">
        <path :d="m.shaft" class="lg-shaft" :class="m.isBus ? 'lg-bus' : 'lg-car'" />
        <path :d="m.head" class="lg-head" :class="m.isBus ? 'lg-bus' : 'lg-car'" />
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

    <!-- Road-junction traffic signals (#38): per-lane signal heads on a dark
         gantry bar, with a white stop line across each signalised approach. One
         head per incoming LANE (a bus lane gets its own, lit by the transit
         aspect during a head start). A small chip shows the live mode; clicking
         any of it cycles the mode live (off → two-phase → +bus → round-robin →
         +bus → off), mirroring the junction-switch's live toggle. -->
    <template v-if="config.roads && tileIsRoadJunction">
      <svg
        v-if="roadSignalArms.length"
        class="road-layer road-signal-layer"
        :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
        @click.stop="cycleRoadSignal"
      >
        <template v-for="(arm, ai) in roadSignalArms" :key="'rsa' + ai">
          <path :d="arm.gantry" class="road-signal-gantry" />
          <g
            v-for="(h, hi) in arm.heads"
            :key="'rsh' + ai + '_' + hi"
            :transform="`translate(${h.cx} ${h.cy}) rotate(${h.angle})`"
          >
            <rect
              class="road-signal-housing"
              :class="{ 'road-signal-housing--bus': h.bus }"
              x="-6.6" y="-3.4" width="13.2" height="6.8" rx="1.8"
            />
            <circle class="road-signal-lens-svg" :class="{ 'road-signal-lens-svg--lit-red':   h.aspect === 'red' }"   cx="-3.6" cy="0" r="2" />
            <circle class="road-signal-lens-svg" :class="{ 'road-signal-lens-svg--lit-amber': h.aspect === 'amber' }" cx="0"    cy="0" r="2" />
            <circle class="road-signal-lens-svg" :class="{ 'road-signal-lens-svg--lit-green': h.aspect === 'green' }" cx="3.6"  cy="0" r="2" />
            <circle v-if="h.bus" class="road-signal-bus-dot" cx="5.4" cy="-5.2" r="1.5" />
          </g>
        </template>
      </svg>
      <div
        class="road-signal-chip"
        :class="{ 'road-signal-chip--off': !roadSignalActive }"
        @click.stop="cycleRoadSignal"
      >
        {{ roadSignalLabel }}
      </div>
    </template>

    <!-- Depot -->
    <template v-if="isDepot">
      <svg
        class="depot-building"
        :viewBox="depotViewBox"
        v-html="depotArt"
      />
      <div class="depot-interaction" :style="depotColorStyle" />
    </template>

    <!-- Car-park sign: "P 3/12", or "P VOLL" when there is no space left. Drawn
         once per car park, above the cars, from the SAME live counts the router
         reads when it decides where to send a driver — so "cars avoid a full car
         park" is something a player can actually watch happen. -->
    <div
      v-if="parkingSign"
      class="parking-sign"
      :class="{ 'parking-sign--full': parkingSign.full }"
      :style="{ left: parkingSign.x + 'px', top: parkingSign.y + 'px' }"
    >
      <span class="parking-sign-count">{{ parkingSign.text }}</span>
      <span class="parking-sign-label">{{ parkingSign.label }}</span>
    </div>

    <!-- Car destination marker (debug): a car is currently heading to this tile. -->
    <div v-if="config.debug && carDestinationId" class="car-destination-marker">
      <span class="car-destination-label">→{{ carDestinationId }}</span>
    </div>

    <!-- Car-junction hold (debug): the road junction is currently owned by a car;
         perpendicular cars wait clear of it until the owner leaves. -->
    <div v-if="carJunctionOwner" class="car-junction-hold">
      <span class="car-junction-label">{{ carJunctionOwner }}</span>
    </div>

    <div v-if="config.debug" class="debug">
      <div class="debug-coordinates" v-text="coordId"></div>
      <div class="debug-kind">{{ displayKind }}{{ roadLaneLabel }}</div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import type { Game } from "@/game";
import { Position, ActiveIntersection, Route, type Coordinates } from "@/types";
import {
  TileCell,
  kindOf,
  partnersOf,
  portsOf,
  armExit,
  isJunctionEntry,
  parseCoordId,
} from "@/tiles/model";
import {
  segmentPathD,
  laneSegmentPathD,
  laneSegmentPointAt,
  laneRibbonPathD,
  arrowHeadD,
} from "@/sim/pathGeometry";
import { railPathsFor } from "@/tiles/geometry";
import {
  roadSurfacePolygonPath,
  roadRibbonPolygonPath,
  roadParallelLine,
  roadCurvePolygonPathTapered,
  roadLaneBandPath,
  roadLaneMarkingPaths,
  roadKerbEdge,
  roadCurveKerbEdgeTapered,
  flankPort,
  laneDropArrowPath,
  laneDropArrowPlan,
  laneDropGore,
  laneClosureGore,
  oneWayMergeArrowPath,
  junctionApproachSignalGeom,
  laneDirectionArrowPath,
  classifyMove,
  LaneMarkingPath,
  MergeArrowPath,
  LaneDropGore,
  LaneMove,
} from "@/tiles/roadGeometry";
import {
  roadEdges,
  laneCount,
  laneCountAt,
  roadSeamPaintTotal,
  junctionArmPaintTotal,
  seamMismatch,
  isRoadJunction,
  turnKind,
  lanesFrom,
  laneAllExits,
  approachPortsOf,
  isOneWayStraight,
} from "@/tiles/lanes";
import {
  parkingApronPath,
  parkingKerbPath,
  parkingSignAnchor,
  stallOutlinePath,
  garageGeometry,
  busStopGeometry,
} from "@/tiles/parkingGeometry";
import { rowsOf, rowSide, stallId, facilityOf } from "@/tiles/parking";
import { signalModeLabel } from "@/sim/junctionSignal";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { seamPositioningBand, laneSeamOffsetPx, oneWayLaneOffsetPx } from "@/sim/laneOffset";
import { depotSvg, depotViewBox } from "@/utils/trainArt";

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

  // The engine shed is drawn, not loaded: see utils/trainArt.ts. Constant per
  // tile, so it is a plain field rather than a getter.
  depotViewBox = depotViewBox;
  depotArt = depotSvg();

  get kind() {
    return kindOf(this.tile);
  }
  get kindClass() {
    return `tile-kind--${this.kind}`;
  }
  // The label shown in the debug overlay. A straight road tile that paints a
  // different width at each end — because a neighbour carries a different lane
  // count, so the ribbon visually narrows/widens across it — is a taper (the
  // lane-count transition tile). `kindOf` can't see this (it's a cross-tile
  // relationship); we derive it here from the same seam math the renderer uses.
  get displayKind(): string {
    return this.kind === "road-straight" && this.roadTapers ? "road-taper" : this.kind;
  }
  // True when this straight road tile changes painted width between its two
  // ends, i.e. it sits at a lane-count change against a neighbour. Mirrors the
  // per-seam width logic in `roadPaths` exactly. False in the editor (the stub
  // game reports 0 neighbour lanes, so every tile renders at its own width).
  get roadTapers(): boolean {
    const road = this.tile.road;
    if (!road?.length) return false;
    const coord = parseCoordId(this.coordId);
    return roadEdges(road).some(([a, b]) => {
      if (oppositePort(a) !== b) return false; // straight edges only
      const selfTotal = Math.max(laneCount(road, a) + laneCount(road, b), 2);
      const na = neighborCoord(coord, a);
      const nb = neighborCoord(coord, b);
      const jA = na ? this.game.roadIsJunctionAt(na) : false;
      const jB = nb ? this.game.roadIsJunctionAt(nb) : false;
      const crossingA = na ? this.game.roadLaneCountAt(na, oppositePort(a)) : 0;
      const crossingB = nb ? this.game.roadLaneCountAt(nb, oppositePort(b)) : 0;
      return (
        roadSeamPaintTotal(selfTotal, crossingA, jA) !==
        roadSeamPaintTotal(selfTotal, crossingB, jB)
      );
    });
  }
  // Debug suffix on the tile-kind label: the configured lane amount of a road
  // tile (the max lanes-per-direction across its edges), e.g. " 3L". Empty for
  // non-road tiles. Appended to the kind name in the debug overlay.
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
  // Whether THIS tile's road is a junction (its lanes touch >2 ports). The
  // centre-line marking dashes inside a junction box instead of running solid.
  get tileIsRoadJunction(): boolean {
    return isRoadJunction(this.tile.road);
  }

  // A ONE-WAY junction has no arm carrying oncoming traffic: every port it
  // touches is EITHER an entry OR an exit, never both (a bidirectional arm makes
  // it a normal two-way junction). This gates the lane-anchored turn-off paint
  // (slip-lane channels) so two-way junctions render exactly as before — same
  // detection junctionTurnGuides uses for the solid dedicated-lane guide.
  get isOneWayJunction(): boolean {
    const road = this.tile.road;
    if (!road || !isRoadJunction(road)) return false;
    const ports = new Set<Position>();
    for (const l of road) {
      ports.add(l.from);
      for (const e of laneAllExits(l)) ports.add(e);
    }
    for (const p of ports) {
      const enters = road.some(l => l.from === p);
      const exits = road.some(l => laneAllExits(l).includes(p));
      if (enters && exits) return false;
    }
    return true;
  }

  // The lane-anchored turn-off CHANNEL for a ONE-WAY junction edge {p1,p2}: a
  // concrete ribbon covering ONLY the lanes that actually make the turn, swept
  // along the exact car glide path (entry-lane offsets → landing-lane offsets) —
  // not the full-box arm-width fan. Resolves the one-way direction itself (the
  // entry port is whichever side has lanes exiting to the other). Returns the
  // surface polygon + ONE kerb edge on the bend's tight (corner-fillet) side, the
  // road edge between the slip lane and the now-grass box corner. null when no
  // lane uses either direction of the edge (caller falls back to the box paint).
  private oneWayTurnChannel(
    coord: ReturnType<typeof parseCoordId>,
    p1: Position,
    p2: Position,
    size: number,
  ): { surface: string; edges: { d: string; dashed: boolean }[] } | null {
    const road = this.tile.road ?? [];
    const W = LANE_WIDTH_PX_FRAC * size;
    let from = p1;
    let to = p2;
    let lanes = road.filter(l => l.from === from && laneAllExits(l).includes(to));
    if (!lanes.length) {
      from = p2;
      to = p1;
      lanes = road.filter(l => l.from === from && laneAllExits(l).includes(to));
    }
    if (!lanes.length) return null;
    const entryBand = this.positioningBandAt(coord, from);
    // Span the turning-lane GROUP's physical edges (centre ± half a lane) at both
    // ends, so the ribbon is exactly as wide as the lanes that turn, no wider.
    let loE = Infinity;
    let hiE = -Infinity;
    let loX = Infinity;
    let hiX = -Infinity;
    for (const lane of lanes) {
      const cEntry = (entryBand - 0.5 - lane.index) * W;
      const cls = lane.kind === "bus" || !lane.to.includes(to) ? "bus" : "car";
      const cExit = this.game.roadTurnExitOffsetPx(coord, from, to, lane.index, cls) ?? cEntry;
      loE = Math.min(loE, cEntry - W / 2);
      hiE = Math.max(hiE, cEntry + W / 2);
      loX = Math.min(loX, cExit - W / 2);
      hiX = Math.max(hiX, cExit + W / 2);
    }
    // The bend's tight (corner) side carries the kerb: +n (hi) for a right turn,
    // −n (lo) for a left turn. The corridor-facing side blends into the through
    // corridor / arm tarmac and needs no line.
    const tightHi = turnKind(from, to) === "right";
    const outerEntry = tightHi ? hiE : loE;
    const outerExit = tightHi ? hiX : loX;
    return {
      surface: laneRibbonPathD(from, to, size, loE, loX, hiE, hiX),
      edges: [{ d: laneSegmentPathD(from, to, size, outerEntry, outerExit), dashed: false }],
    };
  }

  get roadPaths(): { surface: string; laneMarkings: LaneMarkingPath[]; edges: { d: string; dashed: boolean }[]; mismatch: boolean; mismatchTip: string }[] {
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
        // Compare PER SEAM, not whole-tile totals: the lanes crossing THIS port
        // boundary (both directions). For a turn lane that is just the lanes
        // using that movement, so a 2-lane approach feeding two 1-lane turn arms
        // matches each arm and is not flagged — only a genuinely mismatched seam
        // (e.g. a 3-lane curve into a 2-lane road) goes red.
        const selfAtA = laneCountAt(this.tile.road, a);
        const selfAtB = laneCountAt(this.tile.road, b);
        // Measure the neighbour the same way (laneCountAt on its matching port),
        // so a curve↔curve seam isn't falsely flagged: the two-term sum
        // under-counts a curve neighbour (its opposite port carries no lanes).
        const nTotalA = na ? this.game.roadLaneCountAt(na, oppositePort(a)) : 0;
        const nTotalB = nb ? this.game.roadLaneCountAt(nb, oppositePort(b)) : 0;
        // Only a simple curve must preserve its lane count across a seam; a
        // junction fans/merges unequal arms by design and is never a mismatch —
        // on EITHER side of the seam. seamMismatch() handles this tile being a
        // junction; guard here for the NEIGHBOUR being one (whose laneCountAt
        // over-counts the lanes that can fan through the shared arm).
        const aJunction = na ? this.game.roadIsJunctionAt(na) : false;
        const bJunction = nb ? this.game.roadIsJunctionAt(nb) : false;
        const badA = !aJunction && seamMismatch(this.tile.road, a, nTotalA);
        const badB = !bJunction && seamMismatch(this.tile.road, b, nTotalB);
        const mismatch = badA || badB;
        const mismatchTip = mismatch
          ? `Lane-count mismatch: this side has ${badA ? selfAtA : selfAtB} lane(s), neighbour has ${badA ? nTotalA : nTotalB}. Draw over with a matching lane count to fix.`
          : "";
        // ONE-WAY junction: paint the turn-off as a lane-anchored slip CHANNEL —
        // only the lanes that actually turn, on the real car glide path — instead
        // of the full-box arm-width fan that paved the whole junction. The
        // straight corridor still paints full width (it is `isStraight`, handled
        // by the one-way highway branch below). Two-way junctions are untouched:
        // they keep the box-filling turn ribbon (the `roadCurvePolygonPathTapered`
        // path further down), so nothing there can break.
        if (this.tileIsRoadJunction && this.isOneWayJunction) {
          const ch = this.oneWayTurnChannel(coord, a, b, size);
          if (ch) {
            return {
              surface: ch.surface,
              laneMarkings: [],
              edges: ch.edges,
              mismatch,
              mismatchTip,
            };
          }
        }
        // Width PER END, each seam-matched to its own arm (seamPaintTotal against
        // the neighbour crossing that seam) — the ribbon tapers across the bend so
        // EACH end meets ITS arm flush. A junction's own laneCountAt deliberately
        // over-counts an arm (every approach lane that can fan onto it counts), so
        // the old constant max-of-both-ends width painted a narrow arm as wide as
        // the widest one: a 1-lane arm fed by 2-lane turn ribbons drew ~4 lanes of
        // tarmac at the entrance seam, twice the road it meets.
        // A JUNCTION arm adopts its adjoining road's width (junctionArmPaintTotal)
        // so the arm mouth — straight or turning — meets the road flush, no taper
        // at the seam (#30). A simple curve (not a junction) keeps the per-end
        // seam taper between unequal straights, but a junction neighbour never
        // pinches it (roadSeamPaintTotal) — the junction adopts the curve.
        //
        // NO min-2 FLOOR. It dates from when a 1-lane one-way road was itself drawn
        // 2 lanes wide; since the run-max kerb anchor (2026-07-25) a one-way
        // STRAIGHT is drawn its true 1 lane, and leaving the floor on curves made a
        // one-way single-lane BEND twice the width of the straights either side of
        // it — a visible bulge at every corner of a car-park aisle. `laneCountAt`
        // counts both directions, so anything two-way is already >= 2 and this
        // changes nothing for it; the only tiles affected are genuine one-way
        // single-lane bends. Guarded by `roadPaintWidth.spec.ts`.
        const widthEndA = this.tileIsRoadJunction
          ? junctionArmPaintTotal(selfAtA, nTotalA, aJunction)
          : roadSeamPaintTotal(selfAtA, nTotalA, aJunction);
        const widthEndB = this.tileIsRoadJunction
          ? junctionArmPaintTotal(selfAtB, nTotalB, bJunction)
          : roadSeamPaintTotal(selfAtB, nTotalB, bJunction);
        const widthA2 = widthEndA * LANE_W;
        const widthB2 = widthEndB * LANE_W;
        // Edge lines. A *simple* curve (a single bend, 2 ports): both kerbs,
        // tapering with the surface. On a JUNCTION a turn edge contributes its
        // CORNER FILLET kerb — the solid white line tracing the curved concrete
        // between two adjacent arms (the bend's inner side, toward the shared
        // tile corner: the left side of a left turn, right of a right turn).
        // The straight kerbs that used to run across the box are gone (see the
        // straight branch), so the box outline is exactly the real pavement
        // boundary: solid round corners, open arm mouths.
        const edges =
          roadEdges(this.tile.road).length === 1
            ? [
                { d: roadCurveKerbEdgeTapered(a, b, size, widthA2 / 2, widthB2 / 2, 1), dashed: false },
                { d: roadCurveKerbEdgeTapered(a, b, size, widthA2 / 2, widthB2 / 2, -1), dashed: false },
              ]
            : [
                {
                  d: roadCurveKerbEdgeTapered(
                    a, b, size, widthA2 / 2, widthB2 / 2,
                    turnKind(a, b) === "right" ? 1 : -1,
                  ),
                  dashed: false,
                },
              ];
        // Markings. A simple curve keeps its centre + parallel dividers. On a
        // JUNCTION the symmetric ribbon parallels looked wrong — the inner ones
        // dove almost through the middle of the box, crossing every corridor —
        // so a turn edge instead paints one guide per turning LANE, on the
        // exact lane-to-lane glide curve the cars drive (entry-lane offset →
        // landing-lane offset): a clean curve from one street's lane to the
        // other's, like real intersection guide lines.
        const laneMarkings = this.tileIsRoadJunction
          ? this.junctionTurnGuides(coord, a, b, size)
          : roadLaneMarkingPaths(a, b, size, selfA, selfB);
        return {
          surface: roadCurvePolygonPathTapered(a, b, size, widthA2, widthB2),
          laneMarkings,
          edges,
          mismatch,
          mismatchTip,
        };
      }

      // Straight tiles: taper at seams is valid (lane merge/diverge). No mismatch flag.
      const na = neighborCoord(coord, a);
      const nb = neighborCoord(coord, b);
      // The neighbour's total lanes crossing the shared seam. Use laneCountAt on
      // the neighbour's matching port (oppositePort) rather than summing both
      // approaches: a curve/junction neighbour carries no lanes on the opposite
      // port, so the two-term sum under-counts and the straight would taper down
      // to a false-narrow width at the seam (the bug this fixes).
      // seamPaintTotal floors the neighbour's crossing count at the painted
      // min-2 (a one-way road is drawn 2 lanes wide even when it physically
      // carries one, so two one-way tiles don't pinch to 1 at the seam) but ONLY
      // when a neighbour road exists. An off-map border edge (or a grass tile)
      // reports 0 crossing lanes — neighborCoord still returns a coord there, so
      // we cannot rely on na/nb being null — and the road must keep its own full
      // width rather than taper toward a phantom 2-lane neighbour (the bug that
      // narrowed 3+-lane roads as they ran off the play area).
      const crossingA = na ? this.game.roadLaneCountAt(na, oppositePort(a)) : 0;
      const crossingB = nb ? this.game.roadLaneCountAt(nb, oppositePort(b)) : 0;
      // A junction neighbour never pinches the straight (it adopts the road's
      // width inside its box, see the junction arm branch above): the road keeps
      // its own full width at that seam, so no taper is painted next to a
      // junction (#30). Off-map / real-road seams meet flush as before.
      const jA = na ? this.game.roadIsJunctionAt(na) : false;
      const jB = nb ? this.game.roadIsJunctionAt(nb) : false;

      // One-way HIGHWAY tile: anchor the run's widest lane count to the KERB (index
      // 0, +n right-of-travel) so the through lanes run dead straight and lanes are
      // added / dropped on the LEFT / centre side (−n). The right kerb is a constant
      // offset; the left (centre) kerb tapers. See sim/laneOffset.ts
      // oneWayLaneOffsetPx for the matching car offset (index 0 = kerb).
      if (selfA === 0 || selfB === 0) {
        const fwdA = selfA > 0; // carrying direction a→b?
        const entry = fwdA ? a : b;
        const exit = fwdA ? b : a;
        const m = Math.max(selfA, selfB);
        const crossEntry = fwdA ? crossingA : crossingB;
        const crossExit = fwdA ? crossingB : crossingA;
        // A junction seam keeps the run's full width m (the junction adopts the
        // road, no taper next to it, #30); a real-road seam meets flush.
        const jEntry = fwdA ? jA : jB;
        const jExit = fwdA ? jB : jA;
        const entryCount = !jEntry && crossEntry > 0 ? Math.min(m, crossEntry) : m;
        const exitCount = !jExit && crossExit > 0 ? Math.min(m, crossExit) : m;
        const R = this.game.roadOneWayRunMax(coord, entry);
        const kerbOff = (R / 2) * LANE_W; // constant kerb (right, +n, index 0 side)
        // The closing-lane tarmac stays FULL width across a narrowing tile (the
        // lane is closed by the hatched gore, not by the kerb tapering — a real
        // motorway lane drop); it only grows on a WIDENING. So the centre (left)
        // edge runs at the wider of the two seam counts and is straight on a narrowing.
        const innerEntry = kerbOff - entryCount * LANE_W;
        const innerExit = kerbOff - Math.max(entryCount, exitCount) * LANE_W;
        const owMarkings: LaneMarkingPath[] = [];
        // Survivor dividers — straight lines between through-lanes present at both
        // ends (lane k boundary at (R/2 − k)·W, measured from the kerb). The
        // boundary of the dropping lane is drawn by the closure gore
        // (laneDropOverlay), so stop before it.
        const survivors = Math.min(entryCount, exitCount);
        for (let k = 1; k < survivors; k++) {
          const d = (R / 2 - k) * LANE_W;
          owMarkings.push({ d: roadParallelLine(entry, exit, size, d, d), kind: "inner" });
        }
        // A widening opens new lanes on the LEFT (centre side): their dividers fan
        // out from the entry kerb-aligned edge to their straight line.
        for (let k = entryCount; k < exitCount; k++) {
          const dOpen = (R / 2 - entryCount) * LANE_W;
          const dStraight = (R / 2 - k) * LANE_W;
          owMarkings.push({ d: roadParallelLine(entry, exit, size, dOpen, dStraight), kind: "inner" });
        }
        return {
          surface: roadRibbonPolygonPath(entry, exit, size, innerEntry, kerbOff, innerExit, kerbOff),
          laneMarkings: owMarkings,
          edges: [
            { d: roadParallelLine(entry, exit, size, kerbOff, kerbOff), dashed: false },
            { d: roadParallelLine(entry, exit, size, innerEntry, innerExit), dashed: false },
          ],
          mismatch: false,
          mismatchTip: "",
        };
      }

      // Bidirectional straight road: centred symmetric taper (min-seam rule).
      // A junction seam keeps the road's full width (no taper next to a junction).
      // The JUNCTION's own through-corridor adopts each adjoining road's width at
      // its mouth (junctionArmPaintTotal), so the arm meets the road flush and the
      // width change (unequal arms) happens INSIDE the box, never at the seam (#30).
      const totalA = this.tileIsRoadJunction
        ? junctionArmPaintTotal(laneCountAt(this.tile.road, a), crossingA, jA)
        : roadSeamPaintTotal(selfTotal, crossingA, jA);
      const totalB = this.tileIsRoadJunction
        ? junctionArmPaintTotal(laneCountAt(this.tile.road, b), crossingB, jB)
        : roadSeamPaintTotal(selfTotal, crossingB, jB);
      const widthA = totalA * LANE_W;
      const widthB = totalB * LANE_W;
      // Road edge line where the tarmac meets the grass — one per outer kerb,
      // tapering with the surface. Skip a side that has a lane-drop gore: its gore
      // border already draws the full-width kerb there. +n side has a gore when the
      // a→b direction narrows; -n side when b→a narrows.
      const d1A = nb ? this.game.roadLaneCount(nb, oppositePort(b)) : 0;
      const d1B = na ? this.game.roadLaneCount(na, oppositePort(a)) : 0;
      const goreA = selfA > 0 && d1A > 0 && d1A < selfA;
      const goreB = selfB > 0 && d1B > 0 && d1B < selfB;
      const edges: { d: string; dashed: boolean }[] = [];
      if (this.tileIsRoadJunction) {
        // On a junction a straight edge keeps a SOLID kerb only on a side with
        // NO arm (a T-junction's flat side — a real, uninterrupted kerb). A
        // side with an arm is open: its real boundary is the corner fillets
        // (drawn by the turn edges), and the kerb line continues across the
        // box as a DASHED guide line for through traffic.
        for (const s of [1, -1] as const) {
          const open = laneCountAt(this.tile.road, flankPort(a, b, s)) > 0;
          edges.push({
            d: roadKerbEdge(a, b, size, widthA / 2, widthB / 2, s),
            dashed: open,
          });
        }
      } else {
        if (!goreA) edges.push({ d: roadKerbEdge(a, b, size, widthA / 2, widthB / 2, 1), dashed: false });
        if (!goreB) edges.push({ d: roadKerbEdge(a, b, size, widthA / 2, widthB / 2, -1), dashed: false });
      }
      return {
        surface: roadSurfacePolygonPath(a, b, size, widthA, widthB),
        laneMarkings: roadLaneMarkingPaths(a, b, size, selfA, selfB, widthA / 2, widthB / 2),
        edges,
        mismatch: false,
        mismatchTip: "",
      };
    });
  }

  // Where the kerb sits for a parking row's approach, in px. This mirrors
  // `tiles/parking.ts kerbOffsetAt` exactly, but resolves its neighbours through
  // the injected Game road API instead of the level: `Tile` deliberately sees only
  // its own cell (unlike `TileGround`), and the editor supplies a no-op Game that
  // this then keeps working against. Keep the two in lockstep — if the painted bay
  // and the sim's manoeuvre curve disagree about where the kerb is, cars park on
  // the road markings.
  //
  // A METHOD, not a getter: it takes arguments, and vue-facing-decorator turns a
  // getter into a cached computed (KNOWHOW → CAMERA).
  parkingKerbFor(coord: Coordinates, from: Position): number {
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

  // The parking layer's paint: the apron each row of bays stands on, its outer
  // kerb, and one outline per bay. Lives inside the road-layer SVG, ordered so the
  // apron goes UNDER the road's own kerb and markings (one continuous surface) and
  // the bay lines go over them.
  get parkingPaths(): {
    apron: string;
    kerb: string;
    reserved?: string;
    stalls: { d: string; key: string; occupied: boolean }[];
    garage: ReturnType<typeof garageGeometry> | null;
    garageOut: ReturnType<typeof garageGeometry> | null;
    bus: ReturnType<typeof busStopGeometry> | null;
    // A HALT stands in the lane and so needs a sign; a LAY-BY has a bay to mark.
    busHalt: boolean;
  }[] {
    if (!this.config.roads) return [];
    const rows = rowsOf(this.tile);
    if (rows.length === 0) return [];
    const size = this.config.tileSize;
    const coord = parseCoordId(this.coordId);
    const occupancy = this.game.parkingOccupancy;
    return rows.map(row => {
      const kerb = this.parkingKerbFor(coord, row.from);
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
        stalls,
        // A bus stop of either shape gets its yellow kerb marking, its legend and
        // its shelter. Without them a lay-by is indistinguishable from the lorry
        // bay beside it (same size, same outline) and a halt is invisible entirely.
        bus:
          row.kind === "busstop" || row.reserved === "bus"
            ? busStopGeometry(row, size, kerb)
            : null,
        busHalt: row.kind === "busstop",
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
  get parkingSign(): { x: number; y: number; label: string; text: string; full: boolean } | null {
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
    const anchor = parkingSignAnchor(row, size, this.parkingKerbFor(coord, row.from));
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

  // Tinted strips for bus lanes: one filled band per bus lane, laterally aligned
  // with that lane exactly like the debug arrows and the cars (positioningBand +
  // the per-lane offset), so only the bus lane is gold — not the whole ribbon.
  // Straight movements only (bus lanes are authored on straight road for now).
  // Always on (not debug-gated) — it marks a real road feature.
  get busLaneBands(): string[] {
    const road = this.tile.road;
    if (!this.config.roads || !road?.length) return [];
    const size = this.config.tileSize;
    const half = 0.5 * LANE_WIDTH_PX_FRAC * size;
    const out: string[] = [];
    const coord = parseCoordId(this.coordId);
    for (const lane of road) {
      if (lane.kind !== "bus") continue;
      // The JUNCTION-aware band, exactly like the cars and the markings: on a
      // junction tile the raw per-port lane counts are skewed by turn-only
      // movements, which shifted one direction's gold band off its lane (the
      // 3L T-junction bug: westbound band sat mid-road, eastbound was fine).
      const selfBand = this.positioningBandAt(coord, lane.from);
      const off = (selfBand - 0.5 - lane.index) * LANE_WIDTH_PX_FRAC * size;
      for (const to of laneAllExits(lane)) {
        if (oppositePort(lane.from) !== to) continue; // straight lanes only
        out.push(roadLaneBandPath(lane.from, to, size, off, half));
      }
    }
    return out;
  }

  // Lane node graph for the debug overlay: one directed arrow per *physical lane*
  // in the tile's road layer (one per `lane` × each permitted exit). Each arrow is
  // laterally offset to the exact position its cars drive — matching the renderer's
  // per-car offset in game.ts — so a multi-lane road shows one arrow per lane on its
  // own lane, not a single centre arrow. Each entry has a `shaft` path (offset
  // straight line or offset Bézier) and a `head` path (a chevron at the offset
  // exit). `isBus` is per-lane (`lane.kind === "bus"`) so only true bus lanes go amber.
  // Centred positioning band of a neighbour road tile entered via `port`: half its
  // combined both-direction lanes, so one-way seams taper to the centred band the
  // car renderer uses (see sim/laneOffset.ts positioningBand).
  private centeredRoadBand(coord: ReturnType<typeof parseCoordId>, port: Position): number {
    // Half the lanes crossing the seam (forward + backward). Correct on curves,
    // where the oncoming lanes enter from the adjacent port, not oppositePort
    // (which carries none) — see game.ts centeredBandAt.
    return this.game.roadLaneCountAt(coord, port) / 2;
  }

  // The junction-aware positioning band of THIS tile at `port` against the
  // neighbour there — mirrors game.ts positioningBandAt exactly (see
  // sim/laneOffset.ts seamPositioningBand: a junction adopts a road neighbour's
  // real band, a road keeps its own band at a junction, road↔road seams keep
  // the min-taper), so the overlay arrows and turn guides sit precisely where
  // the renderer puts the cars.
  private positioningBandAt(coord: ReturnType<typeof parseCoordId>, port: Position): number {
    const selfBand = laneCountAt(this.tile.road, port) / 2;
    const nb = neighborCoord(coord, port);
    if (!nb) return selfBand;
    return seamPositioningBand(
      selfBand,
      isRoadJunction(this.tile.road),
      this.centeredRoadBand(nb, oppositePort(port)),
      this.game.roadIsJunctionAt(nb),
    );
  }

  // The always-on turn guides inside a junction box for the turn edge [a, b]:
  // ONE dashed curve per turn MOVEMENT and direction, on the EXACT lane-to-lane
  // glide path the cars drive (seam-matched entry offset → landing-lane exit
  // offset, identical to couplerOffset's turn branch and the debug lane arrows).
  // The guide is drawn for the lane real signage would mark — the kerb-most
  // allowed lane of a right turn, the inner-most of a left — not for every lane
  // (a 2-lane cross would paint 16 curves, pure confetti). Replaces the old
  // symmetric ribbon parallels, whose inner lines dove through the middle of
  // the box instead of curving street-to-street.
  //
  // EXCEPT a plain 1+1 bend: when both directions cross the edge and each arm
  // is a single lane each way, the edge is just a two-way street turning
  // through the box. There is no lane to guide into, and the two per-movement
  // curves cross each other and the centre dash — reading as broken middle
  // lines. Real paint there is the street's centre divider continuing around
  // the bend (like the adjacent curve tile), so draw that ONE dashed curve.
  private junctionTurnGuides(
    coord: ReturnType<typeof parseCoordId>,
    a: Position,
    b: Position,
    size: number,
  ): LaneMarkingPath[] {
    const road = this.tile.road ?? [];
    // The SOLID dedicated-turn-lane guide is reserved for ONE-WAY junctions (no arm
    // carries oncoming traffic). One-way junctions now paint lane-anchored slip
    // channels and return before reaching here, so in practice this is a two-way
    // junction; the flag stays correct (and self-documenting) via the shared getter.
    const oneWayJunction = this.isOneWayJunction;
    // Per-direction glide offsets for the edge's two possible movements.
    // `dedicated` = the turning lane may ONLY turn here (no straight-through), so on
    // a ONE-WAY junction its guide is drawn SOLID — a line you don't cross.
    const moves = new Map<
      Position,
      { offEntry: number; offExit: number; dedicated: boolean }
    >();
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as [Position, Position][]) {
      const lanes = road.filter(l => l.from === from && laneAllExits(l).includes(to));
      if (lanes.length === 0) continue;
      const lane = lanes.reduce((best, l) =>
        turnKind(from, to) === "right"
          ? l.index < best.index ? l : best // right turn: the kerb-most lane
          : l.index > best.index ? l : best, // left turn: the inner-most lane
      );
      const entryBand = this.positioningBandAt(coord, from);
      const offEntry = (entryBand - 0.5 - lane.index) * LANE_WIDTH_PX_FRAC * size;
      // A movement reached only via busTo is bus-only even on a shared car lane.
      const cls = lane.kind === "bus" || !lane.to.includes(to) ? "bus" : "car";
      const offExit =
        this.game.roadTurnExitOffsetPx(coord, from, to, lane.index, cls) ?? offEntry;
      // Dedicated turn lane: the chosen lane does not also permit the straight
      // movement (oppositePort) — so it is a turn-only pocket, not a shared lane.
      const dedicated = !laneAllExits(lane).includes(oppositePort(from));
      moves.set(from, { offEntry, offExit, dedicated });
    }
    const ab = moves.get(a);
    const ba = moves.get(b);
    const isStraight = oppositePort(a) === b;
    if (!isStraight) {
      // A TURN corner. The yellow centre divider continues around the bend —
      // ONE line on the corridor centreline (offset 0 connects arm a's centre
      // line to arm b's; with equal entry/exit offsets the corner-fillet's
      // straight legs collapse to the pure concentric arc), exactly like a
      // simple curve tile. Drawn only for a two-way corridor (both directions
      // present); a one-way turn has no centre divider.
      const turn: LaneMarkingPath[] = [];
      if (ab && ba) turn.push({ d: laneSegmentPathD(a, b, size, 0, 0), kind: "centre" });
      // Then a WHITE DASHED guide per ALLOWED turning movement — like the
      // painted turn-guide lines in a real intersection. Only for movements a
      // lane permits; none where the turn is disallowed. And only when an arm
      // is MULTI-lane: a 1L↔1L corner has a single stream per direction with
      // nothing to guide into — the yellow divider says it all.
      // The guide continues the lane's divider on the THROUGH-LANE side through the
      // turn (real paint extends the lane EDGE, not the centre) — never the outer
      // kerb edge, which is already the solid road-edge line. So shift the driving
      // fillet half a lane AWAY from the bend's outer kerb: a right turn's lane is
      // kerb-most (kerb on the right) ⇒ shift left (−edge); a left turn's lane is
      // inner-most (median on the left) ⇒ shift right (+edge). A DEDICATED turn
      // lane's guide is SOLID (you may not leave a turn-only pocket); SHARED stays dashed.
      if (laneCount(road, a) > 1 || laneCount(road, b) > 1) {
        const edge = 0.5 * LANE_WIDTH_PX_FRAC * size;
        for (const [from, to] of [
          [a, b],
          [b, a],
        ] as [Position, Position][]) {
          const m = moves.get(from);
          if (!m) continue;
          const shift = turnKind(from, to) === "right" ? -edge : edge;
          turn.push({
            d: laneSegmentPathD(from, to, size, m.offEntry + shift, m.offExit + shift),
            kind: "inner",
            solid: m.dedicated && oneWayJunction,
          });
        }
      }
      return turn;
    }
    // A STRAIGHT-through edge: the centre line(s) continue across the box.
    const out: LaneMarkingPath[] = [];
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as [Position, Position][]) {
      const m = moves.get(from);
      if (m) out.push({ d: laneSegmentPathD(from, to, size, m.offEntry, m.offExit), kind: "centre" });
    }
    return out;
  }

  get laneGraphOverlay(): { shaft: string; head: string; isBus: boolean }[] {
    if (!this.config.debug || !this.tile.road?.length) return [];
    const size = this.config.tileSize;
    const road = this.tile.road;
    const coord = parseCoordId(this.coordId);
    const out: { shaft: string; head: string; isBus: boolean }[] = [];

    for (const lane of road) {
      const isBus = lane.kind === "bus";
      // Lateral offset (px) right-of-travel for this lane, identical to the car
      // renderer (game.ts): a lane `index` of an approach with `count` lanes sits
      // at (count - 0.5 - index) · LANE_WIDTH_PX_FRAC · tileSize. 0 = kerb side.
      // Centred band: half the lanes crossing this approach's boundary (forward +
      // backward). Correct on curves — the oncoming lanes enter from the adjacent
      // exit port, not oppositePort(from) (which carries none, the bug that halved
      // the curve band and crossed the same-direction lanes). For a straight/one-way
      // this equals (forward + backward)/2 — unchanged. See game.ts centeredBandAt.
      const selfBand = laneCountAt(road, lane.from) / 2;
      // One-way ⟺ no oncoming lanes exit through this approach. A one-way STRAIGHT
      // is a highway lane drop: lanes anchor (kerb, index 0) to the run's widest
      // count, dead straight (the through lanes don't move; the centre lane ends).
      // The offset is computed by the SAME `oneWayLaneOffsetPx` the car uses, so
      // the overlay can never drift from where a vehicle drives.
      const oneWay = laneCount(road, lane.from) === laneCountAt(road, lane.from);

      // busTo exits are movements only buses may take off a shared car lane —
      // drawn like any other movement but class "bus" (and amber).
      const moves = [
        ...lane.to.map(to => ({ to, busOnly: false })),
        ...(lane.busTo ?? []).map(to => ({ to, busOnly: true })),
      ];
      for (const { to, busOnly } of moves) {
        const cls = isBus || busOnly ? "bus" : "car";
        // Colour a movement amber only when it actually LANDS on a bus lane on the
        // exit arm. Through a junction a bus lane can fan onto a car-only arm (a
        // median bus turning right onto a kerb car lane); the sim drives it on that
        // car lane, so the overlay must read cyan there, not paint a phantom amber
        // line onto an arm with no bus lane. Off a junction the lane keeps its kind.
        const moveIsBus =
          (isBus || busOnly) && this.tileIsRoadJunction
            ? this.game.roadTurnExitIsBusLane(coord, lane.from, to, lane.index, cls)
            : isBus || busOnly;
        if (oppositePort(lane.from) === to) {
          if (oneWay) {
            const R = this.game.roadOneWayRunMax(coord, lane.from);
            // Seam-taper: at a lane-count change the dropping lane's arrow angles
            // into the last surviving lane, matching the car's easing lanePos.
            // Compute lane counts at each seam (min of this tile and its neighbour).
            const localCount = laneCount(road, lane.from);
            const nEntry = neighborCoord(coord, lane.from);
            const nExit = neighborCoord(coord, to);
            const nEntryFwd = nEntry
              ? this.game.roadLaneCountAt(nEntry, oppositePort(lane.from))
              : 0;
            const nExitFwd = nExit
              ? this.game.roadLaneCountAt(nExit, oppositePort(to))
              : 0;
            // A junction seam keeps the run's full count (the junction adopts
            // the road — no pinch next to a junction, matching roadPaths).
            const jEntry = nEntry ? this.game.roadIsJunctionAt(nEntry) : false;
            const jExit = nExit ? this.game.roadIsJunctionAt(nExit) : false;
            const entrySeam =
              !jEntry && nEntryFwd > 0 ? Math.min(localCount, nEntryFwd) : localCount;
            const exitSeam =
              !jExit && nExitFwd > 0 ? Math.min(localCount, nExitFwd) : localCount;
            const entryLane = Math.min(lane.index, Math.max(1, entrySeam) - 1);
            const exitLane = Math.min(lane.index, Math.max(1, exitSeam) - 1);
            const offEntry = oneWayLaneOffsetPx(entryLane, R, size);
            const offExit = oneWayLaneOffsetPx(exitLane, R, size);
            out.push({ ...this.laneArrow(lane.from, to, size, offEntry, offExit), isBus: moveIsBus });
            continue;
          }
          // Bidirectional straight on a tapering tile: clamp each end inward so the
          // kerb lane merges and inner lanes hold, tracking the surface taper.
          // Junction-aware bands (positioningBandAt): a junction neighbour never
          // pinches the road's lanes; a junction's own straight-through corridor
          // positions on each adjoining road's real band.
          const bandEntry = this.positioningBandAt(coord, lane.from);
          const bandExit = this.positioningBandAt(coord, to);
          // On a junction tile, laneCountAt/2 under-counts the seam when some lanes
          // turn off — use the arm's road-positioning band as selfBand so inner
          // straight-through lanes don't collapse to the centreline (the 3L+2L bug).
          const bandSelf = this.tileIsRoadJunction ? bandEntry : selfBand;
          const offA = laneSeamOffsetPx(lane.index, bandSelf, bandEntry, size);
          const offB = laneSeamOffsetPx(lane.index, bandSelf, bandExit, size);
          out.push({ ...this.laneArrow(lane.from, to, size, offA, offB), isBus: moveIsBus });
        } else {
          // Turn / junction movement: glide from this lane's approach offset to the
          // lane the vehicle lands in on the EXIT arm (game.roadTurnExitOffsetPx,
          // class-aware), identical to couplerOffsets' turn branch — so the arrow
          // ends on the same real lane the car drives to, never a phantom one.
          // The entry band is junction-aware (positioningBandAt): a junction's own
          // laneCountAt counts movements, not the arm's real width, so the arm
          // positions its lanes on the adjoining road's band and lines up at the
          // entrance seam (a 2-lane spur off a 3-lane road).
          const entryBand = this.positioningBandAt(coord, lane.from);
          const offEntry = (entryBand - 0.5 - lane.index) * LANE_WIDTH_PX_FRAC * size;
          const offExit = this.game.roadTurnExitOffsetPx(coord, lane.from, to, lane.index, cls);
          out.push({ ...this.laneArrow(lane.from, to, size, offEntry, offExit ?? offEntry), isBus: moveIsBus });
        }
      }
    }
    return out;
  }

  // One lane-offset arrow (shaft + arrowhead) for a movement `from`→`to`, pushed
  // `off` px right-of-travel so it sits on its lane rather than the centreline.
  // Straight / opposite / Center movements offset a straight line; turns (adjacent
  // ports) offset the quadratic Bézier through the tile centre, mirroring
  // roadGeometry.ts's `curvedParallelPath` so the arrow tracks its lane round the
  // bend. The arrowhead sits at the offset exit point, aimed along the offset path.
  // One lane-offset arrow (shaft + arrowhead) for a movement `from`→`to`, drawn
  // from the SHARED lane-path geometry (sim/pathGeometry.ts) so the overlay traces
  // the EXACT curve the car drives (game.ts samples the same centreline + offset).
  // `off` is the lateral offset (px, right-of-travel) at the entry; `offB` at the
  // exit — they differ for a seam taper or a turn gliding to its exit-arm lane.
  private laneArrow(
    from: Position,
    to: Position,
    size: number,
    off: number,
    offB: number = off,
  ): { shaft: string; head: string } {
    const shaft = laneSegmentPathD(from, to, size, off, offB);
    const end = laneSegmentPointAt(from, to, size, off, offB, 1);
    const head = arrowHeadD({ x: end.x, y: end.y }, end.tangentDeg, 7);
    return { shaft, head };
  }

  // Lane-drop gores and advance arrows for straight reducer tiles.
  // A gore is the hatched closed triangle painted over the lanes that end at
  // this tile's exit seam. Arrows warn drivers one tile in advance.
  //
  // JUNCTIONS ARE NOT REDUCERS. A junction's arms differ in width by design —
  // that is what the junction's own arm paint and turn geometry express — so it
  // must never be read as a road that narrows. Without this guard the loop below
  // sees a cross's opposite-port pairs (Top,Bottom) and (Left,Right) as an
  // ordinary straight edge and, on mixed-width arms, paints a Sperrfläche and
  // merge arrows straight across the middle of the crossroads (mixedcross: a
  // 3-lane south arm against a 1-lane north arm read as a "3->1 drop").
  get laneDropOverlay(): {
    gores: (LaneDropGore & { clipId: string })[];
    arrows: MergeArrowPath[];
  } {
    if (!this.tile.road?.length) return { gores: [], arrows: [] };
    if (isRoadJunction(this.tile.road)) return { gores: [], arrows: [] };
    const size = this.config.tileSize;
    const coord = parseCoordId(this.coordId);
    const gores: (LaneDropGore & { clipId: string })[] = [];
    const arrows: MergeArrowPath[] = [];

    for (const [a, b] of roadEdges(this.tile.road)) {
      if (oppositePort(a) !== b) continue;
      const selfA = laneCount(this.tile.road, a);
      const selfB = laneCount(this.tile.road, b);
      // One-way HIGHWAY edge: the road is kerb-anchored (index 0, +n) and sheds its
      // centre-most lane on the LEFT (−n). Paint the closing lane as a hatched
      // Sperrfläche island (between the survivors' divider and the tapering left /
      // centre edge) with merge arrows leaning right toward the kerb-side survivors.
      // See roadPaths for the matching kerb-anchored surface.
      if (selfA === 0 || selfB === 0) {
        const fwdA = selfA > 0;
        const entry = fwdA ? a : b;
        const exit = fwdA ? b : a;
        const m = Math.max(selfA, selfB);
        const nEntry = neighborCoord(coord, entry);
        const nExit = neighborCoord(coord, exit);
        const crossEntry = nEntry ? this.game.roadLaneCountAt(nEntry, oppositePort(entry)) : 0;
        const crossExit = nExit ? this.game.roadLaneCountAt(nExit, oppositePort(exit)) : 0;
        const entryCount = crossEntry > 0 ? Math.min(m, crossEntry) : m;
        const exitCount = crossExit > 0 ? Math.min(m, crossExit) : m;
        if (exitCount < entryCount) {
          const W = size * LANE_WIDTH_PX_FRAC;
          const R = this.game.roadOneWayRunMax(coord, entry);
          // The closing lane stays full-width drivable; the gore (Sperrfläche) is a
          // POINT upstream that WIDENS downstream to fill the lane where it ends —
          // a real motorway lane drop, not a tarmac that pinches. Bounded below by
          // the full-width kerb (straight) and above by a line diverging from that
          // kerb (upstream point) to the survivors' boundary (downstream).
          const kerbOff = (R / 2 - entryCount) * W; // full-width centre edge (closing-lane outer, −n)
          const innerOff = (R / 2 - exitCount) * W; // survivors' boundary (gore inner, downstream)
          gores.push({
            // Same primitive as the bidirectional lane drop — only the ANCHOR
            // differs (centre edge here, kerb there). A point at the centre edge
            // upstream (outer === inner), widening to outer..inner downstream.
            ...laneClosureGore(entry, exit, size, {
              outerEntry: kerbOff,
              innerEntry: kerbOff,
              outerExit: kerbOff,
              innerExit: innerOff,
            }),
            clipId: `gore-${this.coordId}-${entry}-${exit}`,
          });
          // Merge arrows in the still-open part of the closing lane, leaning toward
          // the through lanes (the merge direction).
          const laneOff = (R / 2 + 0.5 - entryCount) * W; // closing lane centre (−n side)
          // A kerb-anchored one-way sheds its CENTRE lane, so the survivors are
          // always kerb-side (+n) — never infer this from `laneOff`, which is 0
          // whenever the closing lane straddles the centreline.
          for (const alongT of [0.2, 0.42]) {
            arrows.push(oneWayMergeArrowPath(entry, exit, size, laneOff, alongT, 1));
          }
        } else if (exitCount === entryCount) {
          // ADVANCE warning: this tile doesn't drop, but the NEXT one does — paint
          // the merge arrows a tile early so a driver sees the closure before the
          // taper (the one-way counterpart of `laneDropArrowPlan`'s lookahead).
          // Spacing continues the taper tile's pair backwards at 0.4-tile gaps.
          const n2 = nExit ? neighborCoord(nExit, exit) : null;
          const cross2 = n2 ? this.game.roadLaneCountAt(n2, oppositePort(exit)) : 0;
          if (cross2 > 0 && cross2 < exitCount) {
            const W = size * LANE_WIDTH_PX_FRAC;
            const R = this.game.roadOneWayRunMax(coord, entry);
            const laneOff = (R / 2 + 0.5 - entryCount) * W; // the lane that will close
            for (const alongT of [0.4, 0.8]) {
              arrows.push(oneWayMergeArrowPath(entry, exit, size, laneOff, alongT, 1));
            }
          }
        }
        continue;
      }
      const nb = neighborCoord(coord, b);
      const na = neighborCoord(coord, a);
      const nb2 = nb ? neighborCoord(nb, b) : null;
      const na2 = na ? neighborCoord(na, a) : null;
      // Downstream lane counts in the a→b and b→a travel directions. A JUNCTION
      // downstream counts as 0 — the same as no road at all — because a junction
      // is not a narrowing: its arms are sized independently and it paints its own
      // transitions. Reading its count let a 3-lane approach to a junction whose
      // far arm is 1 lane paint advance merge arrows for a "drop" that the
      // junction, not the road, actually performs.
      const countAt = (c: ReturnType<typeof neighborCoord>, port: Position) =>
        c && !this.game.roadIsJunctionAt(c) ? this.game.roadLaneCount(c, port) : 0;
      const d1A = countAt(nb, oppositePort(b));
      const d2A = countAt(nb2, oppositePort(b));
      const d1B = countAt(na, oppositePort(a));
      const d2B = countAt(na2, oppositePort(a));

      if (selfA > 0 && d1A > 0 && d1A < selfA) {
        gores.push({ ...laneDropGore(a, b, size, d1A, selfA), clipId: `gore-${this.coordId}-${a}-${b}` });
      }
      if (selfB > 0 && d1B > 0 && d1B < selfB) {
        gores.push({ ...laneDropGore(b, a, size, d1B, selfB), clipId: `gore-${this.coordId}-${b}-${a}` });
      }
      for (const { laneIndex, alongT } of laneDropArrowPlan(selfA, d1A, d2A)) {
        arrows.push(laneDropArrowPath(a, b, size, laneIndex, alongT));
      }
      for (const { laneIndex, alongT } of laneDropArrowPlan(selfB, d1B, d2B)) {
        arrows.push(laneDropArrowPath(b, a, size, laneIndex, alongT));
      }
    }
    return { gores, arrows };
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

  // --- road-junction signals (#38) ---
  // The live signal of this junction from the running game, falling back to the
  // tile's AUTHORED signal so the editor's chip shows the mode being authored
  // (the editor's stub game carries no live signal state).
  get roadSignal() {
    return this.game.roadSignals?.[this.coordId] ?? this.tile.signal;
  }
  // Per approach arm: the white stop line, the dark gantry bar and one signal
  // head per incoming lane (a bus lane's head is lit by the transit aspect during
  // a head start). Only shown when the running game is driving live aspects (in
  // the editor there is no phase clock, so the chip alone indicates the mode).
  get roadSignalArms(): {
    stopLine: string;
    gantry: string;
    heads: { cx: number; cy: number; angle: number; aspect: string; bus: boolean }[];
  }[] {
    const sig = this.game.roadSignals?.[this.coordId];
    const road = this.tile.road;
    if (!sig || !road) return [];
    const size = this.config.tileSize;
    const coord = parseCoordId(this.coordId);
    const out: {
      stopLine: string;
      gantry: string;
      heads: { cx: number; cy: number; angle: number; aspect: string; bus: boolean }[];
    }[] = [];
    for (const arm of approachPortsOf(road)) {
      const lanes = lanesFrom(road, arm).map(l => ({
        index: l.index,
        kind: (l.kind === "bus" ? "bus" : "all") as "all" | "bus",
      }));
      if (!lanes.length) continue;
      const band = this.positioningBandAt(coord, arm);
      const geom = junctionApproachSignalGeom(arm, size, band, lanes);
      const carAspect = this.game.roadSignalAspects?.[`${this.coordId}:${arm}`] ?? "red";
      const busAspect = this.game.roadSignalAspects?.[`${this.coordId}:${arm}:bus`];
      out.push({
        stopLine: geom.stopLine,
        gantry: geom.gantry,
        heads: geom.heads.map(h => ({
          cx: h.cx,
          cy: h.cy,
          angle: h.angle,
          bus: h.kind === "bus",
          // A bus-lane head follows its own transit aspect when one is published
          // (bus priority / head start); otherwise it tracks the arm's aspect.
          aspect: h.kind === "bus" && busAspect ? busAspect : carAspect,
        })),
      });
    }
    return out;
  }

  // White per-lane direction arrows on a STRAIGHT road tile that feeds a junction:
  // each incoming lane is painted with the turns its downstream junction lane
  // permits (↑ ↰ ↱). Painted only when the lanes are SORTED — the lanes' movement
  // sets differ — so plain "any lane, any turn" roads stay clean (no confetti),
  // matching how real roads only mark dedicated turn lanes. Mirrors the lane-drop
  // arrows: guidance on the approach tile, one tile ahead of the junction.
  get laneDirectionArrows(): { shaft: string; heads: string[]; bus: boolean }[] {
    const road = this.tile.road;
    if (!this.config.roads || !road?.length) return [];
    // Only straight road tiles carry these (the lane-arrow approach geometry is
    // straight); a junction or curve is skipped.
    if (isRoadJunction(road)) return [];
    const size = this.config.tileSize;
    const coord = parseCoordId(this.coordId);
    const out: { shaft: string; heads: string[]; bus: boolean }[] = [];

    for (const [a, b] of roadEdges(road)) {
      if (oppositePort(a) !== b) continue; // straight edges only
      for (const [entry, exit] of [[a, b], [b, a]] as [Position, Position][]) {
        const nb = neighborCoord(coord, exit);
        if (!nb || !this.game.roadIsJunctionAt(nb)) continue;
        const jRoad = this.game.roadAt?.(nb);
        if (!jRoad) continue;
        const jEntry = oppositePort(exit); // the port the car enters the junction by
        // Each incoming lane's movement set at the junction ahead, by lane index.
        const byIndex = new Map<number, LaneMove[]>();
        for (const jl of lanesFrom(jRoad, jEntry)) {
          const moves: LaneMove[] = [];
          for (const e of laneAllExits(jl)) {
            const m = classifyMove(exit, e);
            if (m && !moves.includes(m)) moves.push(m);
          }
          if (moves.length) byIndex.set(jl.index, moves);
        }
        if (byIndex.size < 2) continue; // need ≥2 lanes to be "sorted"
        // Sorted only when the lanes don't all permit the identical movement set.
        const sig = (ms: LaneMove[]) => [...ms].sort().join(",");
        const sigs = new Set([...byIndex.values()].map(sig));
        if (sigs.size < 2) continue;

        const band = this.positioningBandAt(coord, exit);
        const W = LANE_WIDTH_PX_FRAC * size;
        for (const [index, moves] of byIndex) {
          // This tile must actually carry that lane in this travel direction.
          if (!lanesFrom(road, entry).some(l => l.index === index)) continue;
          const off = (band - 0.5 - index) * W;
          const { shaft, heads } = laneDirectionArrowPath(entry, exit, size, off, moves);
          out.push({ shaft, heads, bus: false });
        }
      }
    }
    return out;
  }
  // Whether this road junction is currently signalised (a mode other than off).
  get roadSignalActive(): boolean {
    const sig = this.roadSignal;
    return !!sig && sig.mode !== "off";
  }
  // The mode chip text, e.g. "two-phase +bus" or "off".
  get roadSignalLabel(): string {
    return signalModeLabel(this.roadSignal);
  }
  cycleRoadSignal() {
    this.game.cycleRoadSignal?.(this.coordId);
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
  // The car(s) whose bodies currently overlap this road junction (space-
  // separated ids). Derived live from car positions by the road sim. Debug-only:
  // makes visible WHO is physically inside the box — multiple non-conflicting
  // movements may share it, so this is occupancy, not exclusive ownership.
  get carJunctionOwner(): string | undefined {
    if (!this.config.debug) return undefined;
    return this.game.carJunctions?.[this.coordId];
  }

  // --- car destination overlay (debug) ---
  // The shortened id of a car whose planned destination is this tile, or undefined.
  // Shows which tile each car is heading toward in debug mode.
  get carDestinationId(): string | undefined {
    if (!this.config.debug) return undefined;
    const id = this.game.carDestinations?.[this.coordId];
    return id ? id.replace("car", "") : undefined;
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
.road-bus-band {
  // Gold tint over just the bus lane strip (laid over the grey tarmac), so a bus
  // lane reads at a glance without recolouring the whole road. z-index via paint
  // order: drawn after the surface, before the lane markings (which stay on top).
  fill: #5a4a00;
  stroke: none;
}

/* --- lane graph debug overlay --- */
.lane-graph-layer {
  z-index: 3; // above road surface, below rails and cars
}
.lg-shaft {
  fill: none;
  stroke-width: 2px;
  stroke-linecap: round;
  opacity: 0.75;
}
.lg-head {
  fill: none;
  stroke-width: 2px;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.9;
}
.lg-car {
  stroke: #00bcd4;
}
.lg-bus {
  stroke: #ff9800;
}
.road-marking-centre {
  fill: none;
  stroke: #f4d35e;
  stroke-width: 3px;
  stroke-linecap: butt;
}
/* Inside a junction the centre divider is interrupted, not solid — dash it with
   the same 25px period as the white dividers so the rhythm matches across the
   box (tile edges land mid-gap, like .road-marking-inner). */
.road-marking-centre.road-marking-junction {
  stroke-dasharray: 13 12;
  stroke-dashoffset: 19px;
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
/* A DEDICATED turn lane (turn-only pocket) is bounded by a SOLID line drivers may
   not cross — unlike the dashed divider of a lane that may ALSO go straight. The
   two-class selector overrides the dashed .road-marking-inner inside a junction. */
.road-marking-inner.road-marking-solid {
  stroke-dasharray: none;
  stroke: rgba(255, 255, 255, 0.85);
}
/* The closing-lane gore is paved (concrete), matching the road surface, with
   white diagonal hatching and a white closing edge — the real lane-drop look. */
.road-gore-fill {
  fill: #4a4a4a;
  stroke: none;
}
.road-gore-hatch {
  fill: none;
  stroke: rgba(255, 255, 255, 0.7);
  stroke-width: 1.5px;
}
.road-gore-border {
  fill: none;
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 2px;
}
/* Road edge line where the tarmac meets the grass — same stroke as the gore
   border so the road outline reads as one continuous painted edge. */
.road-edge {
  fill: none;
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 2px;
  stroke-linecap: round;
}
/* The kerb's continuation across an open junction box: a dashed guide line for
   through traffic, in the same 25px rhythm as the other markings (tile edges
   land mid-gap, like .road-marking-inner). The real kerbs — the corner fillets
   and a T's flat side — stay solid. */
.road-edge--dashed {
  stroke: rgba(255, 255, 255, 0.7);
  stroke-dasharray: 13 12;
  stroke-dashoffset: 19px;
  stroke-linecap: butt;
}
.road-drop-arrow-shaft {
  fill: none;
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 2px;
  stroke-linecap: round;
}
.road-drop-arrow-head {
  fill: none;
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 2px;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* Per-lane direction arrows (lane-turn guidance) painted on a straight approach
   tile: same slim white open-chevron style as the lane-drop arrows. A bus-lane
   arrow is tinted amber to match the bus-lane band / debug arrows. */
.road-lane-arrow {
  fill: none;
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 2.2px;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.road-lane-arrow--bus {
  stroke: rgba(255, 179, 64, 0.95);
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

/* --- road-junction traffic signals (#38) --- */
/* Per-lane signal heads live in an SVG overlay sized to the tile, so each head
   sits exactly on the lane its cars drive. A dark gantry bar threads the heads
   of an arm together; a solid white stop line is painted across the approach. */
.road-signal-layer {
  position: absolute;
  inset: 0;
  z-index: 15;
  pointer-events: none;
  overflow: visible;
}
.road-signal-layer > * { pointer-events: auto; cursor: pointer; }
/* Solid white stop bar across the incoming lanes. */
.road-stop-line {
  fill: none;
  stroke: rgba(255, 255, 255, 0.92);
  stroke-width: 6px;
  stroke-linecap: butt;
}
/* The gantry: a dark grey-black bar the heads hang on. */
.road-signal-gantry {
  fill: #15171b;
  stroke: #3a3f47;
  stroke-width: 1px;
}
/* Per-lane head: a dark rounded housing with three lenses; only the active one
   lights. The housing is rotated to face the oncoming driver (green forward). */
.road-signal-housing {
  fill: #0d0e10;
  stroke: #3a3f47;
  stroke-width: 1px;
}
.road-signal-housing--bus {
  stroke: #ffb340;
  stroke-width: 1.4px;
}
.road-signal-lens-svg {
  fill: #1a1a1a;
  stroke: #2a2a2a;
  stroke-width: 0.5px;
}
.road-signal-lens-svg--lit-red   { fill: #ff3b30; filter: drop-shadow(0 0 2px #ff3b30); }
.road-signal-lens-svg--lit-amber { fill: #ffcc00; filter: drop-shadow(0 0 2px #ffcc00); }
.road-signal-lens-svg--lit-green { fill: #34c759; filter: drop-shadow(0 0 2px #34c759); }
/* A small amber dot marking a bus-lane head. */
.road-signal-bus-dot {
  fill: #ffb340;
  stroke: none;
}
.road-signal-chip {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 16;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
  color: #fff;
  background: rgba(20, 20, 20, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  white-space: nowrap;
  pointer-events: auto;
}
.road-signal-chip--off {
  color: #aaa;
  background: rgba(20, 20, 20, 0.45);
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
    // Matches DEPOT_W / DEPOT_H in utils/trainArt.ts (the art's viewBox). An
    // inline <svg> has no intrinsic size to fall back on the way the old <img>
    // did, so both axes are stated here — keep them in step with those two
    // constants, and the per-rotation placement below keeps working unchanged.
    width: 156px;
    height: 70px;
    z-index: 10;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35));
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

/* Car destination marker (debug overlay): a small teal tag on a tile that a car
   is currently heading toward. Non-intrusive — sits in the top-right corner. */
/* --- Parking ------------------------------------------------------------- */
/* The apron reads as the SAME tarmac as the carriageway (matching
   `.road-surface`), so a kerbside bay looks like a widening of the street rather
   than a separate slab parked next to it. */
.parking-apron {
  fill: #4a4a4a;
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
/* A bus stop. Distinct from the lorry lay-by beside it, because they are the same
   SIZE and completely different traffic — telling them apart by shape alone is
   impossible, so the colour has to do it. */
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

.car-destination-marker {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 5;
  pointer-events: none;
}
.car-destination-label {
  font-size: 10px;
  font-weight: 700;
  color: #003030;
  background: rgba(0, 188, 212, 0.85);
  padding: 0 3px;
  border-radius: 3px;
}

/* Car-junction hold (debug overlay): an amber wash + dashed ring on a road
   junction a car currently owns. Sits above the road surface but below the cars
   (z6) so the owning car still reads on top of its own highlight. */
/* Just an anchor for the occupant-ids chip. The former full-tile amber wash
   (+ pulsing dashed border) is gone: since the car sprites carry their own id
   labels, the wash only drowned the board — the chip alone says which box is
   occupied and by whom. */
.car-junction-hold {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
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
</style>
