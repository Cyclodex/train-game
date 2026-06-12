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
            { 'road-marking-merge': m.merge, 'road-marking-junction': tileIsRoadJunction },
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

    <!-- Road-junction traffic signals (#38): one head per approach arm, coloured
         by that arm's current aspect; a small chip shows the live mode. Clicking
         either cycles the mode live in play (off → two-phase → +bus → round-robin
         → +bus → off), mirroring the junction-switch's live toggle. -->
    <template v-if="config.roads && tileIsRoadJunction">
      <div
        v-for="h in roadSignalHeads"
        :key="'rsig' + h.arm"
        class="road-signal"
        :class="`road-signal--${h.arm}`"
        @click.stop="cycleRoadSignal"
      >
        <span class="road-signal-lens road-signal-lens--red"   :class="{ 'road-signal-lens--lit': h.aspect === 'red' }" />
        <span class="road-signal-lens road-signal-lens--amber" :class="{ 'road-signal-lens--lit': h.aspect === 'amber' }" />
        <span class="road-signal-lens road-signal-lens--green" :class="{ 'road-signal-lens--lit': h.aspect === 'green' }" />
        <span
          v-if="h.busAspect"
          class="road-signal-lens road-signal-lens--transit"
          :class="{ 'road-signal-lens--lit': h.busAspect === 'green' }"
        >B</span>
      </div>
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
      <img class="depot-building" :src="depotBuildingImg" />
      <div class="depot-interaction" :style="depotColorStyle" />
    </template>

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
import {
  segmentPathD,
  laneSegmentPathD,
  laneSegmentPointAt,
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
  oneWayClosingGore,
  oneWayMergeArrowPath,
  LaneMarkingPath,
  MergeArrowPath,
  LaneDropGore,
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
  laneAllExits,
  roadPortsOf,
  approachPortsOf,
  busLaneIndices,
} from "@/tiles/lanes";
import { signalModeLabel } from "@/sim/junctionSignal";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { seamPositioningBand, laneSeamOffsetPx, positioningBand } from "@/sim/laneOffset";
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
        // Width PER END, each seam-matched to its own arm (seamPaintTotal against
        // the neighbour crossing that seam, min 2 so a one-way still reads as a
        // road) — the ribbon tapers across the bend so EACH end meets ITS arm
        // flush. A junction's own laneCountAt deliberately over-counts an arm
        // (every approach lane that can fan onto it counts), so the old constant
        // max-of-both-ends width painted a narrow arm as wide as the widest one:
        // a 1-lane arm fed by 2-lane turn ribbons drew ~4 lanes of tarmac at the
        // entrance seam, twice the road it meets.
        // A JUNCTION arm adopts its adjoining road's width (junctionArmPaintTotal)
        // so the arm mouth — straight or turning — meets the road flush, no taper
        // at the seam (#30). A simple curve (not a junction) keeps the per-end
        // seam taper between unequal straights, but a junction neighbour never
        // pinches it (roadSeamPaintTotal) — the junction adopts the curve.
        const widthEndA = this.tileIsRoadJunction
          ? junctionArmPaintTotal(selfAtA, nTotalA, aJunction)
          : roadSeamPaintTotal(Math.max(selfAtA, 2), nTotalA, aJunction);
        const widthEndB = this.tileIsRoadJunction
          ? junctionArmPaintTotal(selfAtB, nTotalB, bJunction)
          : roadSeamPaintTotal(Math.max(selfAtB, 2), nTotalB, bJunction);
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

      // One-way HIGHWAY tile: left-align to the run's widest lane count so the
      // through lanes run dead straight and lanes are added / dropped on the RIGHT
      // (+n). The left kerb is a constant offset; the right kerb tapers. See
      // sim/laneOffset.ts oneWayLaneOffsetPx for the matching car offset.
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
        const leftOff = -(R / 2) * LANE_W; // constant through-side kerb
        // The closing-lane tarmac stays FULL width across a narrowing tile (the
        // lane is closed by the hatched gore, not by the kerb tapering — a real
        // motorway lane drop); it only grows on a WIDENING. So the right kerb runs
        // at the wider of the two seam counts and is straight on a narrowing.
        const rightEntry = leftOff + entryCount * LANE_W;
        const rightExit = leftOff + Math.max(entryCount, exitCount) * LANE_W;
        const owMarkings: LaneMarkingPath[] = [];
        // Survivor dividers — straight lines between through-lanes present at both
        // ends (lane k boundary at (k − R/2)·W). The boundary of the dropping lane
        // is drawn by the closure gore (laneDropOverlay), so stop before it.
        const survivors = Math.min(entryCount, exitCount);
        for (let k = 1; k < survivors; k++) {
          const d = (k - R / 2) * LANE_W;
          owMarkings.push({ d: roadParallelLine(entry, exit, size, d, d), kind: "inner" });
        }
        // A widening opens new lanes on the right: their dividers fan out from the
        // entry kerb to their straight line.
        for (let k = entryCount; k < exitCount; k++) {
          const dOpen = (entryCount - R / 2) * LANE_W;
          const dStraight = (k - R / 2) * LANE_W;
          owMarkings.push({ d: roadParallelLine(entry, exit, size, dOpen, dStraight), kind: "inner" });
        }
        return {
          surface: roadRibbonPolygonPath(entry, exit, size, leftOff, rightEntry, leftOff, rightExit),
          laneMarkings: owMarkings,
          edges: [
            { d: roadParallelLine(entry, exit, size, leftOff, leftOff), dashed: false },
            { d: roadParallelLine(entry, exit, size, rightEntry, rightExit), dashed: false },
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
    for (const lane of road) {
      if (lane.kind !== "bus") continue;
      const selfBand = positioningBand(
        laneCount(road, lane.from),
        laneCount(road, oppositePort(lane.from)),
      );
      const off = (selfBand - 0.5 - lane.index) * LANE_WIDTH_PX_FRAC * size;
      for (const to of lane.to) {
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
    // Per-direction glide offsets for the edge's two possible movements.
    const moves = new Map<Position, { offEntry: number; offExit: number }>();
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
      moves.set(from, { offEntry, offExit });
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
      // The guide continues the lane's RIGHT dashed divider line through the
      // turn (real paint extends the lane EDGE, not the lane centre), so shift
      // the driving fillet half a lane right-of-travel.
      if (laneCount(road, a) > 1 || laneCount(road, b) > 1) {
        const edge = 0.5 * LANE_WIDTH_PX_FRAC * size;
        for (const [from, to] of [
          [a, b],
          [b, a],
        ] as [Position, Position][]) {
          const m = moves.get(from);
          if (m) turn.push({ d: laneSegmentPathD(from, to, size, m.offEntry + edge, m.offExit + edge), kind: "inner" });
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
      // is a highway lane drop: lanes left-align to the run's widest count and the
      // offset is (index + 0.5 − R/2)·W, dead straight (the through lanes don't
      // move; the right lane ends). See sim/laneOffset.ts oneWayLaneOffsetPx.
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
            const offEntry = (entryLane + 0.5 - R / 2) * LANE_WIDTH_PX_FRAC * size;
            const offExit = (exitLane + 0.5 - R / 2) * LANE_WIDTH_PX_FRAC * size;
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
          const offA = laneSeamOffsetPx(lane.index, selfBand, bandEntry, size, false);
          const offB = laneSeamOffsetPx(lane.index, selfBand, bandExit, size, false);
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
  get laneDropOverlay(): {
    gores: (LaneDropGore & { clipId: string })[];
    arrows: MergeArrowPath[];
  } {
    if (!this.tile.road?.length) return { gores: [], arrows: [] };
    const size = this.config.tileSize;
    const coord = parseCoordId(this.coordId);
    const gores: (LaneDropGore & { clipId: string })[] = [];
    const arrows: MergeArrowPath[] = [];

    for (const [a, b] of roadEdges(this.tile.road)) {
      if (oppositePort(a) !== b) continue;
      const selfA = laneCount(this.tile.road, a);
      const selfB = laneCount(this.tile.road, b);
      // One-way HIGHWAY edge: the road left-aligns and sheds its outermost lane on
      // the RIGHT (+n). Paint the closing lane as a hatched Sperrfläche island
      // (between the survivors' divider and the tapering right kerb) with merge
      // arrows leaning left. See roadPaths for the matching left-aligned surface.
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
          const kerbOff = (entryCount - R / 2) * W; // full-width kerb (closing-lane outer)
          const innerOff = (exitCount - R / 2) * W; // survivors' boundary (gore inner, downstream)
          gores.push({
            // (innerEntry, kerbEntry, innerExit, kerbExit): point at the kerb
            // upstream (inner==kerb), widening to inner..kerb downstream.
            ...oneWayClosingGore(entry, exit, size, kerbOff, kerbOff, innerOff, kerbOff),
            clipId: `gore-${this.coordId}-${entry}-${exit}`,
          });
          // Merge arrows in the still-open part of the closing lane, leaning toward
          // the through lanes (the merge direction).
          const laneOff = (entryCount - 0.5 - R / 2) * W; // closing lane centre
          for (const alongT of [0.2, 0.42]) {
            arrows.push(oneWayMergeArrowPath(entry, exit, size, laneOff, alongT));
          }
        }
        continue;
      }
      const nb = neighborCoord(coord, b);
      const na = neighborCoord(coord, a);
      const nb2 = nb ? neighborCoord(nb, b) : null;
      const na2 = na ? neighborCoord(na, a) : null;
      // Downstream lane counts in the a→b and b→a travel directions.
      const d1A = nb ? this.game.roadLaneCount(nb, oppositePort(b)) : 0;
      const d2A = nb2 ? this.game.roadLaneCount(nb2, oppositePort(b)) : 0;
      const d1B = na ? this.game.roadLaneCount(na, oppositePort(a)) : 0;
      const d2B = na2 ? this.game.roadLaneCount(na2, oppositePort(a)) : 0;

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
  // One head per approach arm, coloured by that arm's live aspect. Only shown when
  // the running game is driving live aspects (in the editor there is no phase
  // clock, so the chip alone indicates the authored mode).
  get roadSignalHeads(): { arm: Position; aspect: string; busAspect?: string }[] {
    const sig = this.game.roadSignals?.[this.coordId];
    if (!sig) return [];
    return approachPortsOf(this.tile.road).map(arm => {
      const head: { arm: Position; aspect: string; busAspect?: string } = {
        arm,
        aspect: this.game.roadSignalAspects?.[`${this.coordId}:${arm}`] ?? "red",
      };
      // The separate TRANSIT lens: only with bus priority, and only on arms
      // that actually carry a bus lane. During the head start it is green
      // while the car lenses still show red — the bus pulls away first.
      if (sig.busPriority && busLaneIndices(this.tile.road, arm).length > 0) {
        head.busAspect =
          this.game.roadSignalAspects?.[`${this.coordId}:${arm}:bus`] ?? "red";
      }
      return head;
    });
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
// Black housing containing three stacked lenses (R/A/G). Each head sits at
// the stop-line of its arm, offset to the right-hand incoming lane
// (right-hand traffic: right of travel = kerb side). One lane = 14% of
// tileSize, so lane centre is 7% from tile centre; signal (5px half-width)
// centre sits at 50% ± 12px.
.road-signal {
  position: absolute;
  z-index: 15;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  width: 10px;
  height: 28px;
  background: #111;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 2px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
}
.road-signal-lens {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.road-signal-lens--red   { background: #3a0000; }
.road-signal-lens--amber { background: #1e1000; }
.road-signal-lens--green { background: #001400; }
.road-signal-lens--lit.road-signal-lens--red   { background: #ff3b30; box-shadow: 0 0 5px #ff3b30; }
.road-signal-lens--lit.road-signal-lens--amber { background: #ffcc00; box-shadow: 0 0 5px #ffcc00; }
.road-signal-lens--lit.road-signal-lens--green { background: #34c759; box-shadow: 0 0 5px #34c759; }
/* The separate transit (bus) lens: a tiny "B" below the car lenses. Lit white-
   green during the bus head start / green; dark otherwise. */
.road-signal-lens--transit {
  background: #101010;
  color: #444;
  font-size: 5px;
  line-height: 6px;
  text-align: center;
  font-weight: 700;
}
.road-signal-lens--lit.road-signal-lens--transit {
  background: #c8f7d0;
  color: #0a5a1f;
  box-shadow: 0 0 5px #c8f7d0;
}
// N arm: near top edge, incoming lane is west of centre (cars drive south)
.road-signal--0 {
  top: 7%;
  left: calc(50% - 19px);
}
// E arm: near right edge, incoming lane is north of centre (cars drive west);
// housing rotates horizontal so lenses read along the kerb
.road-signal--1 {
  right: 7%;
  top: calc(50% - 19px);
  flex-direction: row;
  width: 28px;
  height: 10px;
}
// S arm: near bottom edge, incoming lane is east of centre (cars drive north)
.road-signal--2 {
  bottom: 7%;
  left: calc(50% + 9px);
}
// W arm: near left edge, incoming lane is south of centre (cars drive east);
// housing rotates horizontal so lenses read along the kerb
.road-signal--3 {
  left: 7%;
  top: calc(50% + 9px);
  flex-direction: row;
  width: 28px;
  height: 10px;
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

/* Car destination marker (debug overlay): a small teal tag on a tile that a car
   is currently heading toward. Non-intrusive — sits in the top-right corner. */
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
