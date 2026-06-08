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
      <!-- Road edge line where the tarmac meets the grass (per outer kerb). -->
      <template v-for="(r, i) in roadPaths" :key="'re' + i">
        <path
          v-for="(e, ei) in r.edges"
          :key="'re' + i + '_' + ei"
          :d="e"
          class="road-edge"
        />
      </template>
      <template v-for="(r, i) in roadPaths" :key="'rm' + i">
        <path
          v-for="(m, mi) in r.laneMarkings"
          :key="'lm' + i + '_' + mi"
          :d="m.d"
          :class="['road-marking-' + m.kind, { 'road-marking-merge': m.merge }]"
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
import { segmentPathD, portPoint } from "@/sim/pathGeometry";
import { railPathsFor } from "@/tiles/geometry";
import {
  roadSurfacePolygonPath,
  roadCurvePolygonPath,
  roadLaneBandPath,
  roadLaneMarkingPaths,
  roadKerbEdge,
  roadCurveKerbEdge,
  laneDropArrowPath,
  laneDropArrowPlan,
  laneDropGore,
  LaneMarkingPath,
  MergeArrowPath,
  LaneDropGore,
} from "@/tiles/roadGeometry";
import { roadEdges, laneCount, laneCountAt, seamPaintTotal, seamMismatch } from "@/tiles/lanes";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { seamBand, laneSeamOffsetPx, positioningBand } from "@/sim/laneOffset";
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
      const crossingA = na ? this.game.roadLaneCountAt(na, oppositePort(a)) : 0;
      const crossingB = nb ? this.game.roadLaneCountAt(nb, oppositePort(b)) : 0;
      return seamPaintTotal(selfTotal, crossingA) !== seamPaintTotal(selfTotal, crossingB);
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
  get roadPaths(): { surface: string; laneMarkings: LaneMarkingPath[]; edges: string[]; mismatch: boolean; mismatchTip: string }[] {
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
        // Width = the widest seam of this edge (min 2 so a one-way still reads as a
        // road), so the turn ribbon meets its arm flush.
        const widthTotal = Math.max(selfAtA, selfAtB, 2);
        // Edge lines on a *simple* curve (a single bend, 2 ports): both kerbs.
        // Junctions (T/cross, >1 road edge) are skipped — their outer outline is
        // the union of overlapping ribbons, which needs separate handling.
        const half = (widthTotal * LANE_W) / 2;
        const edges = roadEdges(this.tile.road).length === 1
          ? [roadCurveKerbEdge(a, b, size, half, 1), roadCurveKerbEdge(a, b, size, half, -1)]
          : [];
        return {
          surface: roadCurvePolygonPath(a, b, size, widthTotal * LANE_W),
          laneMarkings: roadLaneMarkingPaths(a, b, size, selfA, selfB),
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
      const totalA = seamPaintTotal(selfTotal, crossingA);
      const totalB = seamPaintTotal(selfTotal, crossingB);
      const widthA = totalA * LANE_W;
      const widthB = totalB * LANE_W;
      // Road edge line where the tarmac meets the grass — one per outer kerb,
      // tapering with the surface. Skip a side that has a lane-drop gore: its
      // gore border already draws the full-width kerb there (the tapered surface
      // kerb on that side is filled back to full by the paved gore). +n side has
      // a gore when the a→b direction narrows; -n side when b→a narrows.
      // A one-way road (the other direction has no lanes) has its band CENTRED,
      // so a drop is a symmetric squeeze split across both kerbs — a one-sided
      // gore would overshoot the narrower neighbour. We draw no gore there (both
      // kerbs taper instead), so neither side is suppressed.
      const oneWay = selfA === 0 || selfB === 0;
      const d1A = nb ? this.game.roadLaneCount(nb, oppositePort(b)) : 0;
      const d1B = na ? this.game.roadLaneCount(na, oppositePort(a)) : 0;
      const goreA = !oneWay && selfA > 0 && d1A > 0 && d1A < selfA;
      const goreB = !oneWay && selfB > 0 && d1B > 0 && d1B < selfB;
      const edges: string[] = [];
      if (!goreA) edges.push(roadKerbEdge(a, b, size, widthA / 2, widthB / 2, 1));
      if (!goreB) edges.push(roadKerbEdge(a, b, size, widthA / 2, widthB / 2, -1));
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
      const off = (selfBand - 0.5 - lane.index) * LANE_WIDTH_PX_FRAC * size;
      // One-way ⟺ no oncoming lanes exit through this approach: the band is
      // centred and a drop squeezes both kerbs symmetrically (see laneOffset).
      const centred = laneCount(road, lane.from) === laneCountAt(road, lane.from);

      for (const to of lane.to) {
        // Straight movement on a tapering tile: the painted surface narrows /
        // widens across the tile to meet a neighbour with a different lane count
        // (min-seam rule). Taper this lane's arrow the same way so it tracks the
        // tapering lane across the seam instead of sitting at a single offset and
        // jumping at the boundary — mirroring the per-car taper in game.ts.
        if (oppositePort(lane.from) === to) {
          const nEntry = neighborCoord(coord, lane.from);
          const nExit = neighborCoord(coord, to);
          const bandEntry = seamBand(
            selfBand,
            nEntry ? this.centeredRoadBand(nEntry, oppositePort(lane.from)) : 0,
          );
          const bandExit = seamBand(
            selfBand,
            nExit ? this.centeredRoadBand(nExit, oppositePort(to)) : 0,
          );
          // Bidirectional: clamp each end inward so the kerb lane merges and
          // inner lanes hold. One-way: scale symmetrically so the centred band
          // funnels evenly (see sim/laneOffset.ts laneSeamOffsetPx).
          const offA = laneSeamOffsetPx(lane.index, selfBand, bandEntry, size, centred);
          const offB = laneSeamOffsetPx(lane.index, selfBand, bandExit, size, centred);
          out.push({ ...this.laneArrow(lane.from, to, size, offA, offB), isBus });
        } else {
          out.push({ ...this.laneArrow(lane.from, to, size, off), isBus });
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
  private laneArrow(
    from: Position,
    to: Position,
    size: number,
    off: number,
    // Exit-end offset for a straight movement: when it differs from `off` the
    // arrow tapers across the tile to track a lane whose distance-from-centre
    // changes (the surface min-seam taper). Defaults to `off` (constant offset).
    offB: number = off,
  ): { shaft: string; head: string } {
    const a = portPoint(from, size);
    const b = portPoint(to, size);
    const r = (v: number) => Math.round(v * 100) / 100;

    // Right-of-travel unit vector for a heading (dx,dy) in screen space (y-down)
    // is (-dy, dx)/|..| — the same convention game.ts uses for the car offset.
    const rightUnit = (
      p: { x: number; y: number },
      q: { x: number; y: number }
    ) => {
      const dx = q.x - p.x, dy = q.y - p.y;
      const mag = Math.hypot(dx, dy) || 1;
      return { x: -dy / mag, y: dx / mag };
    };

    let shaft: string;
    let tip: { x: number; y: number }; // offset exit point (arrowhead apex)
    let dir: { x: number; y: number }; // unit travel direction at the tip

    if (oppositePort(from) === to || from === Position.Center || to === Position.Center) {
      // Straight / opposite / Center: offset the line perpendicular by `off` at
      // the entry and `offB` at the exit, so it tapers across a tile whose lane
      // count changes at a seam (offB === off → a constant-offset parallel).
      const n = rightUnit(a, b);
      const a2 = { x: a.x + n.x * off, y: a.y + n.y * off };
      const b2 = { x: b.x + n.x * offB, y: b.y + n.y * offB };
      shaft = `M ${r(a2.x)} ${r(a2.y)} L ${r(b2.x)} ${r(b2.y)}`;
      tip = b2;
      const mag = Math.hypot(b2.x - a2.x, b2.y - a2.y) || 1;
      dir = { x: (b2.x - a2.x) / mag, y: (b2.y - a2.y) / mag };
    } else {
      // Turn (adjacent ports): offset the quadratic Bézier whose control point is
      // the tile centre. Endpoint normals use the entry tangent (a→c) and exit
      // tangent (c→b); the control point is pushed out by off·k so the offset
      // curve keeps its lane distance through the apex (see controlOffsetFactor
      // in roadGeometry.ts: k = 2 − ½·|nA + nB|).
      const c = portPoint(Position.Center, size);
      const nA = rightUnit(a, c);
      const nB = rightUnit(c, b);
      const avgX = nA.x + nB.x, avgY = nA.y + nB.y;
      const avgMag = Math.hypot(avgX, avgY) || 1;
      const nC = { x: avgX / avgMag, y: avgY / avgMag };
      const k = 2 - 0.5 * avgMag;

      const a2 = { x: a.x + nA.x * off, y: a.y + nA.y * off };
      const c2 = { x: c.x + nC.x * off * k, y: c.y + nC.y * off * k };
      const b2 = { x: b.x + nB.x * off, y: b.y + nB.y * off };
      shaft = `M ${r(a2.x)} ${r(a2.y)} Q ${r(c2.x)} ${r(c2.y)} ${r(b2.x)} ${r(b2.y)}`;
      tip = b2;
      // Tangent of the quadratic at t=1 is 2·(b2 − c2); normalise for the head.
      const tx = b2.x - c2.x, ty = b2.y - c2.y;
      const mag = Math.hypot(tx, ty) || 1;
      dir = { x: tx / mag, y: ty / mag };
    }

    // Arrowhead: small open V-chevron at the offset exit, pointing along `dir`.
    const s = 7;
    const px = -dir.y, py = dir.x; // perpendicular for the chevron splay
    const head =
      `M${r(tip.x - dir.x * s + px * s * 0.55)} ${r(tip.y - dir.y * s + py * s * 0.55)} ` +
      `L${r(tip.x)} ${r(tip.y)} ` +
      `L${r(tip.x - dir.x * s - px * s * 0.55)} ${r(tip.y - dir.y * s - py * s * 0.55)}`;
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
      // One-way edges (the other direction has no lanes) have a CENTRED band, so
      // a lane drop is a symmetric squeeze split across both kerbs — the surface
      // taper + funneling dividers show it. A one-sided hatched gore would
      // overshoot the narrower neighbour, so skip gores/arrows here entirely.
      // The Swiss gore + advance arrows stay for genuinely bidirectional reducers.
      if (selfA === 0 || selfB === 0) continue;
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
