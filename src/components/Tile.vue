<template>
  <div
    class="tile"
    :class="[kindClass, { 'tile-depot': isDepot }, isDepot ? depotFacingClass : '']"
    :style="reservationStyle"
    @pointerleave="closeSwitchFan"
  >
    <!-- Bridge deck: the STRUCTURE carrying the line over what is under it.
         Drawn between the ground and everything the line is made of, so the
         water shows either side of the span while the road surface and the
         sleepers sit ON the deck rather than in the river. Derived from the
         same segment paths the rails and lanes follow, so a bridge on a curve
         bends with it and nothing has to be authored per shape.

         FIRST in the tile, before the road layer: both sit at z1, so DOM order
         is what decides, and drawn later the (opaque) deck painted the street
         out — a road bridge read as a gap in the road rather than as a bridge.
         The rails are z2 and cross it either way. -->
    <svg
      v-if="isBridge"
      class="bridge-deck"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <g v-for="(s, i) in bridgeSpans" :key="'bd' + i">
        <path :d="s.d" class="bridge-shadow" :stroke-width="s.width" />
        <path :d="s.d" class="bridge-span" :stroke-width="s.width" />
        <path :d="s.d" class="bridge-parapet" :stroke-width="s.width * 0.78" />
      </g>
    </svg>

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
      <!-- Parking APRON: under the road's own kerb line and markings, so the two
           read as one surface. See TileParking.vue for all three layers. -->
      <TileParking v-if="hasParking" :tile="tile" :coord-id="coordId" layer="apron" />
      <!-- Restricted-lane tint: a strip over just the bus lane(s) (gold) or
           cycle lane(s) (green), not the whole ribbon, laterally aligned with
           the lane's cars/arrows. -->
      <path
        v-for="(b, bi) in restrictedLaneBands"
        :key="'rl' + bi"
        :d="b.d"
        :class="b.kind === 'bus' ? 'road-bus-band' : 'road-cycle-band'"
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
      <!-- Parking BAY LINES + kerb + garage ramps + bus-stop markings, over the
           road's own markings. -->
      <TileParking v-if="hasParking" :tile="tile" :coord-id="coordId" layer="paint" />
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
        <path :d="m.shaft" class="lg-shaft" :class="m.isBus ? 'lg-bus' : m.isCycle ? 'lg-cycle' : 'lg-car'" />
        <path :d="m.head" class="lg-head" :class="m.isBus ? 'lg-bus' : m.isCycle ? 'lg-cycle' : 'lg-car'" />
      </template>
    </svg>

    <!-- Tunnel: the line is UNDERGROUND. No rails are drawn and the mountain's
         scatter stays unbroken over the bore (see cellCorridors) — only a faint
         dashed guide so the player can still read where the tunnel runs. -->
    <svg
      v-if="isTunnel"
      class="tunnel-guide"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <path v-for="(d, i) in tunnelGuides" :key="'tg' + i" :d="d" />
    </svg>

    <!-- The portal's OPENING, drawn UNDER the trains (z1) — the one layer of the
         structure that is not above them. A train therefore runs INTO the dark
         instead of being cut off by it, which is the whole reason the opening is
         a separate element from the masonry above.
         Above the ground patches (z0) though, including the halo the mountain
         spills onto its neighbour: what shows inside a portal is the bore, never
         a wash of hillside. The tile's own rails stop at the bore, but the
         NEIGHBOUR's run on over this and into it, which is exactly right. -->
    <svg
      v-if="isTunnel"
      class="tunnel-mouths"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <path
        v-for="p in tunnelPortals"
        :key="'tm' + p.port"
        class="portal-mouth"
        :d="portalArt.mouth"
        :transform="p.transform"
      />
    </svg>

    <!-- Tunnel portals, one per end of the bore that meets open ground (an
         internal seam between two tunnel tiles gets none). The MASONRY, over the
         trains and under the bore's mountain roof (TileGround's .tile-roof), so
         the structure disappears INTO the hillside rather than sitting on it.
         Shape: a slab with a U cut out of it — an open approach between two
         retaining walls, then the arch where the covered stretch begins. The
         covered stretch is what swallows a train, and it runs from the arch to
         the tile edge, where the roof takes over. Since a patch now keeps to its
         own tile (terrain.ts), that edge IS the rock face: the arch springs
         where the mountain starts and the gallery stands on open ground. -->
    <svg
      v-if="isTunnel"
      class="tunnel-portals"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <g v-for="p in tunnelPortals" :key="'tp' + p.port" :transform="p.transform">
        <!-- The shadow is shifted in its own nested group, by the ROTATION'S
             INVERSE of one SE step: the portal group is turned per port, so an
             offset baked into these coords would turn with it and three of the
             four orientations would throw their shadow at a different sun than
             the boulders beside them. See `tunnelPortals`. -->
        <g :transform="p.shadowShift">
          <path class="portal-shadow" :d="portalArt.wall" />
        </g>
        <path class="portal-wall" :d="portalArt.wall" />
        <!-- The outer face, lit or shaded by which way this portal points
             (`outerLit`) — the same one NW sun the shadow answers to. -->
        <polygon :class="p.outerLit ? 'portal-lit' : 'portal-shade'" :points="portalArt.faceA" />
        <polygon :class="p.outerLit ? 'portal-lit' : 'portal-shade'" :points="portalArt.faceB" />
        <!-- One flank in shade, the sun-facing one left in the body tone: a
             darker L down the away-from-sun corner is how the boulders next to
             it read as solid, and it stops four facets turning the block into a
             picture frame. -->
        <polygon class="portal-shade" :points="p.flankALit ? portalArt.flankB : portalArt.flankA" />
      </g>
    </svg>

    <TileRail v-if="!isTunnel" :possible-routes="railRoutes" />

    <!-- THE LINE ITSELF, drawn along the metals it actually runs over — the
         route comes from the same planner the trains drive, so the picture
         cannot disagree with where they will go. Only while a line is being
         edited; it would be noise the rest of the time. -->
    <svg
      v-if="lineRoutePaths.length"
      class="line-route-layer"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <path
        v-for="(d, i) in lineRoutePaths"
        :key="'lr' + i"
        :d="d"
        class="line-route"
        :style="{ stroke: lineRouteColour }"
      />
    </svg>

    <!-- Grade chevrons: where the line climbs into a HIGHER neighbour, two
         chevrons on the ballast point uphill — the classic map notation for a
         ramp, until painted hillsides arrive. -->
    <svg
      v-if="gradeMarks.length"
      class="grade-marks"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <g v-for="m in gradeMarks" :key="'gm' + m.port" :transform="m.transform">
        <path :d="`M ${-7 * u} ${22 * u} L 0 ${14 * u} L ${7 * u} ${22 * u}`" />
        <path :d="`M ${-7 * u} ${31 * u} L 0 ${23 * u} L ${7 * u} ${31 * u}`" />
      </g>
    </svg>

    <!-- Flyover: one line rides a deck OVER the other. The deck (z5) covers
         the at-grade copy of its own rails (z2) and carries fresh track on
         top; game.ts lifts a train's units to z6 while they ride the named
         pair, so the upper train visibly crosses the lower one — which stays
         an ordinary train at z3/z4, briefly passing under the deck strip. -->
    <svg
      v-if="isFlyover"
      class="flyover-deck"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <path :d="flyoverSpan.d" class="bridge-shadow" :stroke-width="flyoverSpan.width" />
      <path :d="flyoverSpan.d" class="bridge-span" :stroke-width="flyoverSpan.width" />
      <path :d="flyoverSpan.d" class="bridge-parapet" :stroke-width="flyoverSpan.width * 0.86" />
      <path :d="flyoverSpan.d" class="deck-sleepers" />
      <path v-for="(r, i) in flyoverRails" :key="'fr' + i" :d="r" class="deck-rail" />
    </svg>

    <!-- Station: platform slabs flanking the through-track, each with a bright
         edge line on the track side. Geometry only exists for a straight
         station (the standard); any other shape gets the name plate alone. -->
    <svg
      v-if="isStation"
      class="station-layer"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <g v-for="(p, pi) in stationPlatforms" :key="'stp' + pi">
        <rect :x="p.x" :y="p.y" :width="p.w" :height="p.h" rx="3" class="station-platform" />
        <line
          :x1="p.edge.x1"
          :y1="p.edge.y1"
          :x2="p.edge.x2"
          :y2="p.edge.y2"
          class="station-platform-edge"
        />
      </g>
      <!-- LINE EDITING: this platform's place in the line being drawn, big
           enough to read at a glance across the board (Transport Fever shows
           the order the same way). A station that is NOT on the line shows a
           hollow marker instead, so the ones you could still add are just as
           visible as the ones you have. -->
      <g v-if="lineBadge" class="station-order" :class="{ 'station-order--off': !lineBadge.on }">
        <circle :cx="config.tileSize / 2" :cy="config.tileSize / 2" r="21" />
        <text
          :x="config.tileSize / 2"
          :y="config.tileSize / 2 + 9"
          text-anchor="middle"
        >{{ lineBadge.label }}</text>
      </g>

      <!-- Debug: the walking catchment — the reach whose town tiles set this
           station's demand (tiles/catchment.ts). Overflows the tile on purpose. -->
      <circle
        v-if="config.debug"
        :cx="config.tileSize / 2"
        :cy="config.tileSize / 2"
        :r="(config.tileSize / 2) * (2 * catchmentRadiusTiles + 1)"
        class="station-catchment"
      />
      <!-- The waiting crowd: one dot per passenger in the platform queue, lined
           up from the platform end so the queue visibly grows and drains. -->
      <!-- One dot per waiting passenger, COLOURED BY WHERE THEY ARE GOING. A
           queue that never moves is then one colour piling up, which names
           the service the line is missing. -->
      <circle
        v-for="(p, ci) in stationCrowd"
        :key="'crowd' + ci"
        :cx="p.cx"
        :cy="p.cy"
        r="4.5"
        class="station-passenger"
        :style="{ fill: p.fill }"
      >
        <title>{{ p.title }}</title>
      </circle>
    </svg>

    <!-- The station BUILDING: a shelter or an Empfangsgebäude (which, is the
         walking catchment's call — see utils/stationArt.ts) standing in the
         strip between the outer platform and the tile edge, facing the track.
         Its own <svg> rather than a <g> in the layer above, because it is
         placed and rotated in TILE pixels while its art has a box of its own. -->
    <svg
      v-if="stationBuilding"
      class="station-building"
      :viewBox="stationBuilding.viewBox"
      :style="stationBuilding.style"
      v-html="stationBuilding.art"
    />

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

    <!-- Junction switches, Train Valley style: the control IS a marking on the
         track. One fan per switchable entry, one arrow per reachable exit, each
         anchored on the edge its trains ARRIVE by and running toward its exit
         along the exact rail curve a train would take. The gold arrow is where
         the points stand; point at it to unfold the alternatives and click the
         one you want. Geometry: src/tiles/switchFan.ts. -->
    <svg
      v-if="switchWidgets.length && switchesVisible"
      class="switch-layer"
      :class="{ 'switch-layer--static': !switchInteractive }"
      :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
    >
      <g
        v-for="sw in switchWidgets"
        :key="'sw' + sw.entry"
        class="switch-fan"
        :data-entry="sw.entry"
        :class="{
          'switch-fan--locked': isSwitchLocked,
          'switch-fan--armed': sw.armed,
          'switch-fan--open': sw.open,
          'switch-fan--muted': sw.muted,
        }"
      >
        <g v-for="a in sw.arms" :key="'a' + a.arm">
          <path class="switch-arm-casing" :class="{ 'is-on': a.on }" :d="a.shaft" />
          <path
            class="switch-arm"
            :class="{ 'is-on': a.on, 'is-hover': a.hover }"
            :d="a.shaft"
          />
          <path
            class="switch-arm-head"
            :class="{ 'is-on': a.on, 'is-hover': a.hover }"
            :d="a.head"
          />
          <!-- The target is the whole arrow, not a 3px bulb. -->
          <path
            class="switch-hit"
            :d="a.shaft"
            @click.stop="pickArm(sw.entry, a.arm)"
            @pointerenter="hoverArm(sw.entry, a.arm)"
            @pointerleave="hoverArm(null, null)"
            @pointerover="openSwitchFan(sw.entry)"
          />
        </g>
      </g>
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

    <!-- Car-park sign ("P 3/12" / "P VOLL"): an HTML chip above everything, so it
         is the one parking layer that lives outside the road SVG. -->
    <TileParking v-if="hasParking" :tile="tile" :coord-id="coordId" layer="sign" />

    <!-- The station's NAME, mounted on the building's street front. HTML rather
         than SVG text because a plate has to size itself to a word — "Nordstadt"
         does not fit in a fixed shield, which is what the first cut tried.
         The services calling here ride INSIDE the plate as colour dots: name +
         who stops = one thing to read, instead of a plate, a shield and a row
         of pips scattered over three corners of the tile. -->
    <div v-if="isStation" class="station-nameplate" :style="stationPlateStyle">
      <span class="station-nameplate-text">{{ stationLabel }}</span>
      <span
        v-for="(c, li) in servingLines"
        :key="'sl' + li"
        class="station-line-pip"
        :style="{ background: c }"
      />
    </div>

    <!-- LATENT DEMAND: what this platform would carry if anything called here.
         Only ever shown for a platform NO line reaches — since D10 such a
         platform is empty, so without this there is nothing on the board to
         say which places are waiting for a connection. It is a hint, not a
         score: nothing reads it but the eye. -->
    <div
      v-if="isStation && latentDemand > 0"
      class="station-latent"
      :style="stationLatentStyle"
    >
      <span class="station-latent-icon">🧍</span>
      {{ latentDemand }}/min — no service
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
      <div class="debug-kind">{{ displayKind }}{{ roadLaneLabel }}{{ heightLabel }}</div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import type { Game } from "@/game";
import type { SimTrain } from "@/sim/simulation";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { fanArms } from "@/tiles/switchFan";
import { Position, ActiveIntersection, Route } from "@/types";
import {
  Level,
  TileCell,
  heightOf,
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
  oneWayStraightMarkingPaths,
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
} from "@/tiles/lanes";
import { rowsOf } from "@/tiles/parking";
import TileParking from "./TileParking.vue";
import { signalModeLabel } from "@/sim/junctionSignal";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { seamPositioningBand, laneSeamOffsetPx, oneWayLaneOffsetPx } from "@/sim/laneOffset";
import { depotSvg, depotViewBox } from "@/utils/trainArt";
import {
  stationBuildingSvg,
  stationSizeFor,
  stationViewBox,
  type StationSize,
} from "@/utils/stationArt";
import { WALK_RADIUS_TILES, stationCatchment } from "@/tiles/catchment";

// A stable colour per DESTINATION tile, so a waiting passenger's dot says
// where they are going and the same platform is the same colour everywhere on
// the board. Hashed from the coordinate rather than looked up, so it needs no
// registry and never shifts when a station is added.
const DEST_COLOURS = [
  "#e2574c",
  "#f0b429",
  "#3fa796",
  "#5b8def",
  "#a05fd0",
  "#6aa84f",
];
function destinationColour(tileId: string | undefined): string {
  if (!tileId) return "#8a5a3b";
  let hash = 0;
  for (let i = 0; i < tileId.length; i++) {
    hash = (hash * 31 + tileId.charCodeAt(i)) >>> 0;
  }
  return DEST_COLOURS[hash % DEST_COLOURS.length];
}

// Physical width of one lane as a fraction of tile size. Must match the same
// constant in game.ts so the painted road, the per-car lateral offset, and the
// markings stay in agreement.
const LANE_WIDTH_PX_FRAC = 0.14;

@Component({ components: { TileParking } })
class Tile extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Inject({ from: "game" }) game!: Game;
  // The whole level, for the one derivation that needs NEIGHBOURS: a tunnel
  // portal exists only where the bore meets open ground, which the cell alone
  // cannot know. Same inject TileGround uses for patch fusing.
  @Inject() level!: Level;
  @Prop({ type: Object, required: true }) tile!: TileCell;
  @Prop({ type: String, required: true }) coordId!: string;
  // The editor paints its own switch hit-zones on top of the tile (they cycle
  // the AUTHORED starting arm and persist it), so there the fan is a read-only
  // picture of that authored state and must not swallow the editor's clicks.
  @Prop({ type: Boolean, default: true }) switchInteractive!: boolean;
  // Whether the points are DRAWN at all. The editor deliberately shows a
  // read-only fan (a picture of the authored arm), which is why this is a
  // second flag rather than `!switchInteractive`: a mode where the TRAIN
  // decides its route (network) has no points for the player to read either,
  // and an un-clickable arrow on the board is a control that lies.
  @Prop({ type: Boolean, default: true }) switchesVisible!: boolean;

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
  // Debug: the cell's height step, when it has one (" h2").
  get heightLabel() {
    return this.tile.height ? ` h${this.tile.height}` : "";
  }
  get isStation() {
    return this.tile.role === "station";
  }
  // Platform slabs beside the through-track: one each side, set clear of the
  // rails, with the track-facing long edge marked. Only a straight pair (the
  // standard station shape) gets slabs — a station on any other shape renders
  // just the halt sign, so an unusual author choice degrades, not breaks.
  get stationPlatforms(): {
    x: number;
    y: number;
    w: number;
    h: number;
    edge: { x1: number; y1: number; x2: number; y2: number };
  }[] {
    if (!this.isStation) return [];
    const size = this.config.tileSize;
    const c = size / 2;
    const inner = size * 0.13; // centreline → platform edge (clear of the rails)
    const depth = size * 0.15; // slab depth
    // Edge to edge, no inset: the train draws up with its carriages centred on
    // the tile (sim/simulation.ts → platformStopDistance) and a two-carriage
    // block is a shade LONGER than one tile, so an inset slab would leave the
    // ends of the train standing off the end of the platform. Full width also
    // lets two station tiles side by side read as one long platform.
    const margin = 0;
    const len = size - margin * 2;
    const has = (p: Position, q: Position) =>
      this.tile.connections.some(
        ([a, b]) => (a === p && b === q) || (a === q && b === p)
      );
    const out: {
      x: number;
      y: number;
      w: number;
      h: number;
      edge: { x1: number; y1: number; x2: number; y2: number };
    }[] = [];
    if (has(Position.Top, Position.Bottom)) {
      for (const side of [-1, 1]) {
        const ex = c + side * inner;
        out.push({
          x: side < 0 ? ex - depth : ex,
          y: margin,
          w: depth,
          h: len,
          edge: { x1: ex, y1: margin, x2: ex, y2: margin + len },
        });
      }
    } else if (has(Position.Left, Position.Right)) {
      for (const side of [-1, 1]) {
        const ey = c + side * inner;
        out.push({
          x: margin,
          y: side < 0 ? ey - depth : ey,
          w: len,
          h: depth,
          edge: { x1: margin, y1: ey, x2: margin + len, y2: ey },
        });
      }
    }
    return out;
  }
  // Which way the platform faces, from the through-connection the slabs were
  // derived from: "h" = track runs left-right (platforms above and below,
  // building in the TOP strip), "v" = track runs top-bottom (building in the
  // LEFT strip). Any other shape → null, and the tile shows plate and platforms
  // only, exactly as an unusual authoring choice should degrade.
  get stationAxis(): "h" | "v" | null {
    if (!this.isStation) return null;
    const has = (p: Position, q: Position) =>
      this.tile.connections.some(
        ([a, b]) => (a === p && b === q) || (a === q && b === p)
      );
    if (has(Position.Left, Position.Right)) return "h";
    if (has(Position.Top, Position.Bottom)) return "v";
    return null;
  }
  // Where the building sits, in tile px measured from the tile's outer edge.
  // `outer` is its street-side edge (and where the name plate hangs); the box
  // reaches from there PAST the platform's inner edge at tileSize * 0.22 (the
  // same centre − inner − depth `stationPlatforms` uses), because the canopy
  // belongs over the platform. The art is authored at these numbers for a 200px
  // tile, so the fractions here and STATION_ART_BOX must move together.
  get stationStrip(): { outer: number; w: number; d: number } | null {
    if (!this.stationAxis) return null;
    const size = this.config.tileSize;
    const big = this.stationSize === "station";
    return {
      outer: size * 0.03,
      d: size * (big ? 0.23 : 0.19),
      w: size * (big ? 0.75 : 0.4),
    };
  }
  // Halt or Empfangsgebäude — derived from the town in walking reach, never
  // stored (tiles/catchment.ts). Build houses beside a halt and it grows up on
  // the next render; there is no field to drift out of step with the map.
  get stationSize(): StationSize {
    return stationSizeFor(stationCatchment(this.level, this.coordId).urban);
  }
  // The building, placed onto the tile. The art is authored in its own frame
  // (x along the platform, y away from the track) and dropped on the strip with
  // one transform about its top-left corner: unrotated for a left-right
  // station, a quarter turn for a top-bottom one, which puts its platform side
  // against the rails either way.
  get stationBuilding(): {
    art: string;
    viewBox: string;
    style: Record<string, string>;
  } | null {
    const strip = this.stationStrip;
    if (!strip) return null;
    const size = this.config.tileSize;
    const kind = this.stationSize;
    const { outer, w, d } = strip;
    const transform =
      this.stationAxis === "h"
        ? `translate(${(size - w) / 2}px, ${outer}px)`
        : `translate(${outer}px, ${(size + w) / 2}px) rotate(-90deg)`;
    return {
      art: stationBuildingSvg(kind),
      viewBox: stationViewBox(kind),
      style: {
        width: `${w}px`,
        height: `${d}px`,
        transform,
      },
    };
  }
  // The name plate hangs on the building's street front: centred on its outer
  // edge for a left-right station (half on the roof, half on the grass, the way
  // a sign stands at a building's front), and at the head of the building for a
  // top-bottom one, where a horizontal plate laid across a rotated roof would
  // spill into the neighbouring tile.
  get stationPlateStyle(): Record<string, string> {
    const strip = this.stationStrip;
    if (!strip) return { top: "4px", left: "50%", transform: "translateX(-50%)" };
    return this.stationAxis === "h"
      ? { top: `${strip.outer}px`, left: "50%", transform: "translate(-50%, -50%)" }
      : {
          top: "3px",
          left: `${strip.outer + strip.d / 2}px`,
          transform: "translateX(-50%)",
        };
  }
  // The "no service" hint, placed just BELOW the name plate wherever that
  // landed — a fixed offset would have floated free the moment master moved
  // the plate onto the station building.
  get stationLatentStyle(): Record<string, string> {
    const plate = this.stationPlateStyle;
    const top = Number.parseFloat(plate.top ?? "0") || 0;
    return { ...plate, top: `${top + 20}px` };
  }
  catchmentRadiusTiles = WALK_RADIUS_TILES;
  // What to call this platform.
  get stationLabel(): string {
    return this.game.stationLabels?.[this.coordId] ?? "S";
  }
  // People per minute this platform would carry if a line ever reached it.
  // Zero (and therefore hidden) the moment one does.
  get latentDemand(): number {
    return this.game.stationLatent?.[this.coordId] ?? 0;
  }
  // While a line is being drawn: this station's place in it, or a hollow
  // marker when it is one you could still add.
  get lineBadge(): { label: string; on: boolean; colour: string } | null {
    const overlay = this.game.lineOverlay;
    if (!this.isStation || !overlay?.trainId) return null;
    const at = overlay.order[this.coordId];
    return at
      ? { label: String(at), on: true, colour: overlay.colour }
      : { label: "+", on: false, colour: overlay.colour };
  }
  // The rail paths on THIS tile that the line being edited runs over — the
  // SEGMENTS a train drives, not every connection the tile happens to carry.
  // On a junction the difference is the whole point: the depot spur is a
  // connection here and the line never takes it.
  get lineRoutePaths(): string[] {
    const overlay = this.game.lineOverlay;
    const segments = overlay?.trainId ? overlay.path[this.coordId] : undefined;
    if (!segments?.length) return [];
    const size = this.config.tileSize;
    return segments.map(([a, b]) => segmentPathD(a, b, size));
  }
  // Deliberately NOT the train's livery: only one line is drawn at a time, and
  // a grey or white loco (both legitimate liveries) drew a route nobody could
  // see against the ballast. One strong colour, the same as the badges.
  lineRouteColour = "#f0b429";
  // The liveries of the services calling at this platform (network mode).
  get servingLines(): string[] {
    if (!this.isStation) return [];
    return (this.game.stationLines?.[this.coordId] ?? []).slice(0, 4);
  }
  // One dot per waiting passenger, on the first platform slab at a fixed pitch
  // (the queue grows along the platform) with a small deterministic scatter
  // across its depth so it reads as people, not beads. The live count comes
  // from the game's reactive per-frame mirror of the sim queue.
  get stationCrowd(): { cx: number; cy: number; fill: string; title: string }[] {
    if (!this.isStation) return [];
    const slabs = this.stationPlatforms;
    if (!slabs.length) return [];
    const waiting = this.game.stationWaiting?.[this.coordId] ?? [];
    const count = Math.min(this.game.stationQueues?.[this.coordId] ?? 0, 12);
    const s = slabs[0];
    const horizontal = s.w >= s.h;
    const out: { cx: number; cy: number; fill: string; title: string }[] = [];
    for (let i = 0; i < count; i++) {
      const t = (i + 0.75) / 13; // fixed pitch from the platform end
      const scatter = (((i * 37) % 7) - 3) * (s.w >= s.h ? s.h : s.w) * 0.055;
      const dest = waiting[i];
      const fill = destinationColour(dest);
      const title = dest ? `waiting for ${dest}` : "waiting";
      if (horizontal) {
        out.push({ cx: s.x + t * s.w, cy: s.y + s.h / 2 + scatter, fill, title });
      } else {
        out.push({ cx: s.x + s.w / 2 + scatter, cy: s.y + t * s.h, fill, title });
      }
    }
    return out;
  }
  get isBridge() {
    return this.tile.bridge === true;
  }
  get isTunnel() {
    return this.tile.tunnel === true;
  }
  get isFlyover() {
    return this.tile.flyover !== undefined;
  }
  // The deck along the flyover pair — the same stroke-based structure as the
  // bridge, so a curved flyover bends for free. A touch wider than the river
  // span: it has to cover the pair's at-grade rails underneath it.
  get flyoverSpan(): { d: string; width: number } {
    const [a, b] = this.tile.flyover!;
    const size = this.config.tileSize;
    return { d: segmentPathD(a, b, size), width: size * 0.26 };
  }
  // Fresh track ON the deck (the z2 copy is covered by it).
  get flyoverRails(): string[] {
    const [a, b] = this.tile.flyover!;
    return railPathsFor(a, b, this.config.tileSize, this.config.railDistanceFromPath);
  }
  // Ground units (the 100-unit art box) in px, for authoring the portal.
  get u() {
    return this.config.tileSize / 100;
  }

  // The dashed guide along each bored connection — the same centreline the
  // train drives, so a curved bore reads correctly.
  get tunnelGuides(): string[] {
    if (!this.isTunnel) return [];
    const size = this.config.tileSize;
    return this.tile.connections.map(([a, b]) => segmentPathD(a, b, size));
  }

  // A chevron pair per connection end whose neighbour sits one step HIGHER —
  // the climb starts here. Oriented like the portals: authored pointing "up"
  // (outward through the port), so the same transform table serves both.
  get gradeMarks(): { port: Position; transform: string }[] {
    void this.game.levelVersion.value;
    const size = this.config.tileSize;
    const coord = parseCoordId(this.coordId);
    const here = heightOf(this.tile);
    const at: Record<number, string> = {
      [Position.Top]: `translate(${size / 2}, 0)`,
      [Position.Right]: `translate(${size}, ${size / 2}) rotate(90)`,
      [Position.Bottom]: `translate(${size / 2}, ${size}) rotate(180)`,
      [Position.Left]: `translate(0, ${size / 2}) rotate(270)`,
    };
    const out: { port: Position; transform: string }[] = [];
    for (const p of portsOf(this.tile.connections)) {
      if (p === Position.Center) continue;
      const nc = neighborCoord(coord, p);
      const n = nc ? this.level[getCoordinatesId(nc)] : undefined;
      if (heightOf(n) === here + 1) out.push({ port: p, transform: at[p] });
    }
    return out;
  }

  // One portal per port of the bore that faces NON-tunnel ground. An internal
  // seam (tunnel beside tunnel) gets none, so a ridge two tiles deep reads as
  // one mountain with one hole in each side. Oriented per port; every segment
  // path meets its edge at the midpoint, so the arch sits on the centreline.
  get tunnelPortals(): {
    port: Position;
    transform: string;
    shadowShift: string;
    outerLit: boolean;
    flankALit: boolean;
  }[] {
    if (!this.isTunnel) return [];
    // Register the edit counter: a bore EXTENDED next door must retire this
    // tile's portal at the now-internal seam, but `level` is the raw object in
    // play (see Game.levelVersion) so the neighbour read alone cannot notify.
    void this.game.levelVersion.value;
    const size = this.config.tileSize;
    const u = this.u;
    const coord = parseCoordId(this.coordId);
    const at: Record<number, string> = {
      [Position.Top]: `translate(${size / 2}, 0)`,
      [Position.Right]: `translate(${size}, ${size / 2}) rotate(90)`,
      [Position.Bottom]: `translate(${size / 2}, ${size}) rotate(180)`,
      [Position.Left]: `translate(0, ${size / 2}) rotate(270)`,
    };
    // One NW sun lights the whole board, so every shadow falls SE in TILE
    // space. These transforms turn the portal per port, and a child inherits
    // that turn — so the SE step has to be pre-rotated by the inverse here,
    // or the west portal throws its shadow north-east while the boulder next
    // to it throws one south-east.
    const shadowAt: Record<number, string> = {
      [Position.Top]: `translate(${3 * u}, ${3 * u})`,
      [Position.Right]: `translate(${3 * u}, ${-3 * u})`,
      [Position.Bottom]: `translate(${-3 * u}, ${-3 * u})`,
      [Position.Left]: `translate(${-3 * u}, ${3 * u})`,
    };
    // Which of the two long faces the sun reaches, for the same reason: a west-
    // or north-facing wall is lit, the east/south one is in shade. The art is
    // authored with the FRONT face outward, so this is just "does outward point
    // at the sun".
    const outerLit: Record<number, boolean> = {
      [Position.Top]: true,
      [Position.Left]: true,
      [Position.Right]: false,
      [Position.Bottom]: false,
    };
    // The same question for the other axis: does the art's -x flank end up
    // facing north/west once the group is turned?
    const flankALit: Record<number, boolean> = {
      [Position.Top]: true,
      [Position.Right]: true,
      [Position.Bottom]: false,
      [Position.Left]: false,
    };
    const out: {
      port: Position;
      transform: string;
      shadowShift: string;
      outerLit: boolean;
      flankALit: boolean;
    }[] = [];
    for (const p of portsOf(this.tile.connections)) {
      if (p === Position.Center) continue;
      const nc = neighborCoord(coord, p);
      const n = nc ? this.level[getCoordinatesId(nc)] : undefined;
      if (n?.tunnel) continue;
      out.push({
        port: p,
        transform: at[p],
        shadowShift: shadowAt[p],
        outerLit: outerLit[p],
        flankALit: flankALit[p],
      });
    }
    return out;
  }

  // The portal, authored once in the 100-unit art box and reused by every portal
  // on the tile (the per-port group supplies the turn). +y runs INTO the bore,
  // so the whole thing is authored at negative y — out over the open ground the
  // line arrives on.
  //
  // ONE SLAB WITH A U CUT OUT OF IT. The U is the open approach between two
  // retaining walls; where it rounds off is the arch, and from there inward the
  // line is covered to the tile edge, where the roof takes over. That covered
  // stretch is not decoration — it is the occluder, and the two must MEET or a
  // train shows through in the gap.
  //
  // SIZED AGAINST THE ROCK FACE, which is the tile edge: a terrain patch keeps
  // to its own tile (terrain.ts — it used to bow ~15u past it, and this portal
  // used to be twice as long to clear that). So the arch springs at the edge and
  // the gallery stands entirely on the open ground the line arrives on. If the
  // containment rule ever moves, this geometry moves with it.
  //
  // The rest follows the terrain art's rules: flat facets rather than gradients,
  // a lit face and a shaded flank for volume, no line work (nothing else in the
  // terrain art is stroked, and parallel lines on a block read as planking).
  get portalArt(): {
    wall: string;
    faceA: string;
    faceB: string;
    flankA: string;
    flankB: string;
    mouth: string;
  } {
    const u = this.u;
    const pts = (list: [number, number][]) => list.map(([x, y]) => `${x * u},${y * u}`).join(" ");
    const n = (v: number) => v * u;
    // FACE at y=-16, back edge at y=10 (inside the tile, under the roof). The U:
    // jambs at x=±9 running back from the face to y=-9, where the arch springs —
    // its crown lands on y=0, the tile edge, so the masonry hands the train over
    // to the roof with no seam.
    const face = -16;
    // Well past the tile edge, because the ROOF's own patch stops a few units
    // short of it (the shore is pulled in): the masonry has to cover that strip
    // or a nose shows through between the two.
    const back = 14;
    const halfOut = 15; // half-width of the slab
    const jamb = 9; // half-width of the opening
    const spring = -9; // where the arch springs from
    return {
      // Outline traced anticlockwise around the U so the opening is a hole.
      wall:
        `M ${n(-halfOut)} ${n(face)} L ${n(-jamb)} ${n(face)} L ${n(-jamb)} ${n(spring)} ` +
        `A ${n(jamb)} ${n(jamb)} 0 0 0 ${n(jamb)} ${n(spring)} ` +
        `L ${n(jamb)} ${n(face)} L ${n(halfOut)} ${n(face)} L ${n(halfOut)} ${n(back)} ` +
        `L ${n(-halfOut)} ${n(back)} Z`,
      // The outer face is split by the opening, so it takes two strips.
      faceA: pts([
        [-halfOut, face],
        [-jamb, face],
        [-jamb, face + 4],
        [-halfOut, face + 4],
      ]),
      faceB: pts([
        [halfOut, face],
        [jamb, face],
        [jamb, face + 4],
        [halfOut, face + 4],
      ]),
      flankA: pts([
        [-halfOut, face],
        [-halfOut + 3.5, face],
        [-halfOut + 3.5, back],
        [-halfOut, back],
      ]),
      flankB: pts([
        [halfOut, face],
        [halfOut - 3.5, face],
        [halfOut - 3.5, back],
        [halfOut, back],
      ]),
      // The opening itself — the piece that goes UNDER the trains. Reaches a
      // little past the arch (the masonry covers the overlap) so no sliver of
      // ground can show between the two layers.
      mouth:
        `M ${n(-jamb)} ${n(face)} L ${n(-jamb)} ${n(spring)} ` +
        `A ${n(jamb)} ${n(jamb)} 0 0 0 ${n(jamb)} ${n(spring)} ` +
        `L ${n(jamb)} ${n(face)} Z`,
    };
  }

  // The spans this cell carries: one per line crossing it, rail or road, as the
  // path a vehicle actually drives plus the deck width that line needs. Derived
  // from the same segment paths the rails and lanes follow, so a bridge on a
  // curve bends with it and nothing is authored per shape.
  //
  // Road AND rail, because nothing about a structure is rail-specific — a road
  // bridge over a river is the same object. The road deck has to be wider than
  // the carriageway or it vanishes under the (opaque) road surface, so it is
  // sized from the lane count rather than fixed.
  get bridgeSpans(): { d: string; width: number }[] {
    if (!this.isBridge) return [];
    const size = this.config.tileSize;
    const spans = this.tile.connections.map(([a, b]) => ({
      d: segmentPathD(a, b, size),
      width: size * 0.23,
    }));
    const road = this.tile.road;
    if (road?.length) {
      const laneW = size * LANE_WIDTH_PX_FRAC;
      for (const [a, b] of roadEdges(road)) {
        const lanes = Math.max(laneCount(road, a) + laneCount(road, b), 2);
        // Wide enough that BOTH deck strokes clear the carriageway: the road
        // surface is opaque and covers whatever it is laid on, so the parapet
        // (0.78 of this) has to stand outside it or a road bridge shows nothing
        // but a hairline of structure.
        spans.push({ d: segmentPathD(a, b, size), width: lanes * laneW + size * 0.18 });
      }
    }
    return spans;
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

  // Kerb-side cycle lanes of one direction (0 or 1 in practice) — feeds the
  // half-width cycle paint in roadLaneMarkingPaths.
  private cycleLanesFrom(p: Position): number {
    return (this.tile.road ?? []).filter(l => l.from === p && l.kind === "cycle").length;
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
          : roadLaneMarkingPaths(a, b, size, selfA, selfB, undefined, undefined, this.cycleLanesFrom(a), this.cycleLanesFrom(b));
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
        // Dividers — survivor lines between through-lanes present at both ends
        // (lane k boundary at (R/2 − k)·W, measured from the kerb), fan-out lines
        // for a widening, and the kerb cycle lane's SOLID half-width edge line in
        // place of its full-slot dash. The boundary of a DROPPING lane is drawn by
        // the closure gore (laneDropOverlay), so the survivor lines stop before it.
        // Kerb-anchored, hence its own builder rather than roadLaneMarkingPaths,
        // whose one-way branch is centred (right for a bend, not for a straight).
        const owMarkings: LaneMarkingPath[] = oneWayStraightMarkingPaths(
          entry,
          exit,
          size,
          R,
          entryCount,
          exitCount,
          this.cycleLanesFrom(entry),
        );
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
        laneMarkings: roadLaneMarkingPaths(a, b, size, selfA, selfB, widthA / 2, widthB / 2, this.cycleLanesFrom(a), this.cycleLanesFrom(b)),
        edges,
        mismatch: false,
        mismatchTip: "",
      };
    });
  }

  // Does this tile carry any parking at all? The gate on the three
  // <TileParking> layers, so a board of ordinary road tiles instantiates no
  // parking components at all rather than three empty ones per tile.
  get hasParking(): boolean {
    return this.config.roads && rowsOf(this.tile).length > 0;
  }

  // Tinted strips for restricted lanes: one filled band per bus/cycle lane,
  // laterally aligned with that lane exactly like the debug arrows and the cars
  // (positioningBand + the per-lane offset), so only the restricted lane is
  // tinted — not the whole ribbon (gold = bus, green = cycle).
  // Straights AND simple bends: a painted lane that vanished at the corner read
  // as a gap in the infrastructure, and on a cycle lane it disagreed with the
  // solid edge line, which roadLaneMarkingPaths DOES draw around a bend. A
  // JUNCTION is still skipped: inside the box the paint is the turn ribbons and
  // guides, and the raw per-lane offsets there belong to movements, not to a
  // continuous strip. Always on (not debug-gated) — it marks a real road feature.
  get restrictedLaneBands(): { d: string; kind: "bus" | "cycle" }[] {
    const road = this.tile.road;
    if (!this.config.roads || !road?.length) return [];
    const size = this.config.tileSize;
    // A cycle lane paints at HALF the lane width, KERB-ALIGNED — the real-world
    // proportion (a bike lane is ~1.5m against a ~3m car lane, hugging the
    // kerb). Its solid edge line (roadLaneMarkingPaths) sits on the band's
    // inner boundary and the bike rides the band's centre (sim/laneGeometry's
    // cycle-strip shift), so tint, line and rider agree. The slot's inner half
    // reads as carriageway. Bus lanes keep the full-width gold band.
    const halfOf = (kind: "bus" | "cycle") =>
      (kind === "cycle" ? 0.25 : 0.5) * LANE_WIDTH_PX_FRAC * size;
    const shiftOf = (kind: "bus" | "cycle") =>
      (kind === "cycle" ? 0.25 : 0) * LANE_WIDTH_PX_FRAC * size; // kerbward
    const out: { d: string; kind: "bus" | "cycle" }[] = [];
    const coord = parseCoordId(this.coordId);
    for (const lane of road) {
      if (lane.kind !== "bus" && lane.kind !== "cycle") continue;
      // The JUNCTION-aware band, exactly like the cars and the markings: on a
      // junction tile the raw per-port lane counts are skewed by turn-only
      // movements, which shifted one direction's gold band off its lane (the
      // 3L T-junction bug: westbound band sat mid-road, eastbound was fine).
      const selfBand = this.positioningBandAt(coord, lane.from);
      const off =
        (selfBand - 0.5 - lane.index) * LANE_WIDTH_PX_FRAC * size + shiftOf(lane.kind);
      const half = halfOf(lane.kind);
      for (const to of laneAllExits(lane)) {
        const straight = oppositePort(lane.from) === to;
        if (!straight && this.tileIsRoadJunction) continue; // the box paints its own
        out.push({
          d: straight
            ? roadLaneBandPath(lane.from, to, size, off, half)
            : // The bend's twin: a constant-offset ribbon between the strip's two
              // edges, on the same offset arc the cycle edge line is drawn at
              // (roadGeometry's curve branch), so line and tint agree round the corner.
              laneRibbonPathD(lane.from, to, size, off - half, off - half, off + half, off + half),
          kind: lane.kind,
        });
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

  get laneGraphOverlay(): { shaft: string; head: string; isBus: boolean; isCycle: boolean }[] {
    if (!this.config.debug || !this.tile.road?.length) return [];
    const size = this.config.tileSize;
    const road = this.tile.road;
    const coord = parseCoordId(this.coordId);
    const out: { shaft: string; head: string; isBus: boolean; isCycle: boolean }[] = [];

    for (const lane of road) {
      const isBus = lane.kind === "bus";
      // A cycle lane's arrows go green. No junction-fan refinement like the bus
      // branch below: cycle lanes are straight-authored for now.
      const isCycle = lane.kind === "cycle";
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
        const cls = isBus || busOnly ? "bus" : isCycle ? "bike" : "car";
        // Colour a movement amber only when it actually LANDS on a bus lane on the
        // exit arm. Through a junction a bus lane can fan onto a car-only arm (a
        // median bus turning right onto a kerb car lane); the sim drives it on that
        // car lane, so the overlay must read cyan there, not paint a phantom amber
        // line onto an arm with no bus lane. Off a junction the lane keeps its kind.
        const moveIsBus =
          (isBus || busOnly) && this.tileIsRoadJunction
            ? this.game.roadTurnExitIsBusLane(coord, lane.from, to, lane.index, cls)
            : isBus || busOnly;
        // A JUNCTION's straight-through is the zero-degree case of a turn, NOT a
        // road taper: its arms may differ in width, so the movement glides to the
        // lane `junctionExitLane` lands the vehicle in on the exit arm (the branch
        // below). Only a real straight/one-way ROAD tile tapers.
        if (oppositePort(lane.from) === to && !this.tileIsRoadJunction) {
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
            const cShift = isCycle ? 0.25 * LANE_WIDTH_PX_FRAC * size : 0;
            const offEntry = oneWayLaneOffsetPx(entryLane, R, size) + cShift;
            const offExit = oneWayLaneOffsetPx(exitLane, R, size) + cShift;
            out.push({ ...this.laneArrow(lane.from, to, size, offEntry, offExit), isBus: moveIsBus, isCycle });
            continue;
          }
          // Bidirectional straight on a tapering tile: clamp each end inward so the
          // kerb lane merges and inner lanes hold, tracking the surface taper.
          // Junction-aware bands (positioningBandAt): a junction neighbour never
          // pinches the road's lanes; a junction's own straight-through corridor
          // positions on each adjoining road's real band.
          const bandEntry = this.positioningBandAt(coord, lane.from);
          const bandExit = this.positioningBandAt(coord, to);
          // A cycle lane's arrow sits on the half-width green strip (a
          // quarter-lane kerbward), matching the bike's ride line.
          const cShift = isCycle ? 0.25 * LANE_WIDTH_PX_FRAC * size : 0;
          const offA = laneSeamOffsetPx(lane.index, selfBand, bandEntry, size) + cShift;
          const offB = laneSeamOffsetPx(lane.index, selfBand, bandExit, size) + cShift;
          out.push({ ...this.laneArrow(lane.from, to, size, offA, offB), isBus: moveIsBus, isCycle });
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
          out.push({ ...this.laneArrow(lane.from, to, size, offEntry, offExit ?? offEntry), isBus: moveIsBus, isCycle });
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

  // --- switches (the fan: see src/tiles/switchFan.ts) ---
  // The arm the pointer is currently over, so it can light up as a preview.
  hoveredArm: { entry: Position; arm: ActiveIntersection } | null = null;
  // The entry whose fan is OPEN (showing its alternatives). Held per-entry
  // rather than per-arm so the pointer can travel from the set arrow onto an
  // alternative without the fan collapsing out from under it; the tile's own
  // pointerleave closes it.
  openEntry: Position | null = null;

  switchArmEnabled(entry: Position, arm: ActiveIntersection): boolean {
    const exit = armExit(entry, arm);
    return exit !== null && partnersOf(this.tile.connections, entry).includes(exit);
  }
  activeArm(entry: Position): ActiveIntersection | undefined {
    return this.game.switches[this.coordId]?.[entry];
  }

  // The entry a train is about to arrive by: a train sitting on the neighbour
  // tile whose current exit port points at us. A 4-way cross carries four
  // independent settings and only ONE of them decides where the next train
  // goes — this is how the fan for that one gets promoted and the rest recede,
  // which is the whole answer to "which of these do I care about?".
  //
  // Keyed off the reactive `occupied` map, so it re-evaluates exactly when a
  // train changes tile (the raw sim behind it is markRaw'd and never proxied).
  get approachEntry(): Position | null {
    const entries = this.junctionEntries;
    if (!entries.length) return null;
    const occupied = this.game.occupied;
    const trains = (this.game.sim as { trains?: Record<string, SimTrain> } | undefined)
      ?.trains;
    if (!occupied || !trains) return null;
    const coord = parseCoordId(this.coordId);
    for (const entry of entries) {
      const nb = neighborCoord(coord, entry);
      if (!nb) continue;
      const trainId = occupied[getCoordinatesId(nb)];
      if (!trainId) continue;
      const train = trains[trainId];
      const seg = train?.path?.[train.headIndex];
      if (seg && seg.exitPort === oppositePort(entry)) return entry;
    }
    return null;
  }

  // One fan per switchable entry: its hub marker and its arms, already laid on
  // the rail curves in TILE coordinates — a single <svg> covers the whole tile,
  // so there is no per-entry rotated frame to keep in step with the geometry.
  get switchWidgets() {
    const size = this.config.tileSize;
    const approach = this.approachEntry;
    const hovered = this.hoveredArm;
    return this.junctionEntries.map(entry => {
      // A fan opens — showing the routes it is NOT set to — for the entry a
      // train is arriving by, or the one the pointer is on. Both are the moment
      // the player is choosing rather than reading, and only one opens at a time.
      const expanded = entry === approach || entry === this.openEntry;
      const arms = fanArms(
        this.tile.connections,
        entry,
        size,
        this.activeArm(entry),
        expanded
      ).map(a => ({
        ...a,
        hover: hovered?.entry === entry && hovered.arm === a.arm,
      }));
      return {
        entry,
        arms,
        // "Armed" is the TRAIN case only — it drives the glow. "Open" covers
        // both ways a fan expands (train due, or pointer on it) and drives the
        // full-strength paint.
        armed: entry === approach,
        open: expanded,
        muted: approach !== null && entry !== approach,
      };
    });
  }

  hoverArm(entry: Position | null, arm: ActiveIntersection | null) {
    if (!this.switchInteractive) return;
    this.hoveredArm = entry === null || arm === null ? null : { entry, arm };
  }
  openSwitchFan(entry: Position) {
    if (!this.switchInteractive) return;
    this.openEntry = entry;
  }
  closeSwitchFan() {
    this.openEntry = null;
    this.hoveredArm = null;
  }

  // Throw the points straight to the arm that was clicked. The old widget could
  // only cycle, so reaching a specific exit on a 4-way took up to three clicks
  // and a guess about which bulb meant what.
  pickArm(entry: Position, arm: ActiveIntersection) {
    if (!this.switchInteractive || this.isSwitchLocked) return;
    if (!this.switchArmEnabled(entry, arm)) return;
    if (!this.game.switches[this.coordId]) this.game.switches[this.coordId] = {};
    this.game.switches[this.coordId][entry] = arm;
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

/* --- bridge deck (under the rails, over the ground) ---
   Three strokes along the same curve the train drives: a shadow cast on
   whatever is beneath, the deck itself, and a lighter parapet line down the
   middle. Stroke-based rather than a shaped polygon so it follows a curve for
   free — the same reason the rails are strokes. */
.bridge-deck {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1; // above the ground/scatter (z0/z1 in their own cells), below TileRail (z2)
  pointer-events: none;
  overflow: visible;
}
.bridge-shadow {
  fill: none;
  // Offset toward the SE, matching the one sun every other object is lit by
  // (see tiles/terrain.ts). On water this is what makes the deck read as
  // standing ABOVE the surface rather than painted on it.
  transform: translate(5px, 5px);
  stroke: rgba(12, 30, 44, 0.35);
  stroke-linecap: butt;
}
.bridge-span {
  fill: none;
  stroke: #8d7d6b; // weathered timber/concrete, warm against the cool water
  stroke-linecap: butt;
}
.bridge-parapet {
  fill: none;
  stroke: #b7a992;
  stroke-linecap: butt;
}

/* --- grade chevrons (a climb starts here) ---
   On the ballast, above the rails (same z, later DOM), below the trains. */
.grade-marks {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
  path {
    fill: none;
    stroke: rgba(255, 244, 214, 0.85);
    stroke-width: 3px;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
}

/* --- flyover deck (over the at-grade rails, under its own train) ---
   Reuses the bridge stroke classes for shadow/deck/parapet. z5 sits above
   TileRail (z2) — hiding the pair's at-grade rail copy and briefly hiding the
   LOWER train (z3/z4) as it passes underneath, which is exactly what passing
   under a bridge looks like from above. The upper train is lifted to z6 by
   game.ts while it rides the pair. */
.flyover-deck {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 5;
  pointer-events: none;
  overflow: visible;
}
.deck-sleepers {
  fill: none;
  stroke: #693b3b;
  stroke-width: 20px;
  stroke-dasharray: 4 5;
  stroke-dashoffset: 2;
  stroke-linecap: butt;
}
.deck-rail {
  fill: none;
  stroke: gray;
  stroke-width: 1px;
}

/* --- tunnel (the line is underground) ---
   A bore's own mountain is a ROOF: TileGround lifts this cell's ground (z7) and
   scatter (z8) above the trains (loco z4 / wagons z3), so the rock OCCLUDES a
   consist rather than anything switching it off. Everything that must stay
   readable ON that roof therefore has to clear it: the dashed guide (the map
   notation for where the bore runs) at z9. The portal is the exception — it
   goes UNDER the roof (z6), so the mountain closes over the masonry. */
.tunnel-guide {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 9;
  pointer-events: none;
  path {
    fill: none;
    stroke: rgba(18, 16, 13, 0.4);
    stroke-width: 3px;
    stroke-dasharray: 7 9;
    stroke-linecap: round;
  }
}
.tunnel-mouths {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  // UNDER the trains (wagons z3 / loco z4) and under the rails (z2), over every
  // tile's ground patch (z0) — including the mountain's own overhang, which is
  // the point: no hillside is ever visible inside a portal. See the template.
  z-index: 1;
  pointer-events: none;
  overflow: visible;
}
.tunnel-portals {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  // Between the trains (loco z4) and the mountain roof (z7): the masonry covers
  // a consist, and the rock covers the masonry — so the structure disappears
  // INTO the hillside instead of being laid on top of it.
  z-index: 6;
  pointer-events: none;
  // The structure stands proud of the tile edge, out over the open ground the
  // line arrives on — that overhang is the whole point (see the template).
  overflow: visible;
}
.portal-shadow {
  // Offset SE in TILE space by the nested group in the template (the portal's
  // own group is rotated per port), matching the one NW sun.
  fill: rgba(12, 20, 30, 0.3);
}
.portal-wall {
  // Dressed stone against the slate mountain: close tones, per the terrain
  // rule that scatter sits near its ground rather than paper-cutout bright.
  // Warm GREY, not tan — at this size a saturated tan block reads as timber.
  fill: #8a857c;
  stroke: #5c5850;
  stroke-width: 1.5px;
}
.portal-lit {
  // The facet the NW sun reaches; its opposite number is .portal-shade. Flat
  // fills, no gradient — the boulders next to it are built the same way.
  fill: #a49f95;
}
.portal-shade {
  fill: #6d6961;
}
.portal-mouth {
  fill: #17140f;
}

/* --- station (platforms beside the rails + halt sign) ---
   Above TileRail so the slabs sit ON the ballast shoulder, laterally clear of
   the rails themselves; below the trains, which render in their own layer. */
.station-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 3;
  pointer-events: none;
  overflow: visible; // the debug catchment ring reaches into the neighbours
}
.station-catchment {
  fill: rgba(28, 91, 216, 0.05);
  stroke: rgba(28, 91, 216, 0.55);
  stroke-width: 2;
  stroke-dasharray: 8 6;
}
.station-platform {
  fill: #c3bcae; // paving, warm against the meadow, cooler than the town roofs
  stroke: #948b7a;
  stroke-width: 1;
}
.station-platform-edge {
  stroke: #f6f2e8; // the bright safety line along the track side
  stroke-width: 2.5;
  stroke-linecap: round;
}
/* The building, on the strip between the outer platform and the tile edge.
   Same z as the platforms it belongs to and declared after them, so it paints
   over the slab's outer edge where the canopy reaches across it; under the
   trains, which have a layer of their own. `transform-origin` is the art's own
   top-left corner, because `stationBuilding` reasons in that frame. */
.station-building {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 3;
  transform-origin: 0 0;
  pointer-events: none;
  overflow: visible;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.28));
}
.station-passenger {
  fill: #8a5a3b; // warm coats against the pale paving
  stroke: #fff;
  stroke-width: 1.2;
}
.line-route-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 4; // over the rails, under the trains
  pointer-events: none;
}
.line-route {
  fill: none;
  stroke-width: 13;
  stroke-linecap: round;
  opacity: 0.75;
}
/* The call-order badge: big, because it is read across the whole board. */
.station-order circle {
  fill: #f0b429;
  stroke: #221803;
  stroke-width: 3;
}
.station-order text {
  fill: #221803;
  font-family: sans-serif;
  font-size: 22px;
  font-weight: 800;
}
.station-order--off circle {
  fill: rgba(20, 24, 30, 0.55);
  stroke: rgba(255, 255, 255, 0.75);
  stroke-dasharray: 5 4;
}
.station-order--off text {
  fill: #fff;
  font-size: 20px;
}
/* The "nothing calls here" hint, under the name plate. Amber rather than red:
   it is an opportunity, not a failure — the player has not done anything
   wrong, there is simply a town here that would like a train. Positioned by
   `stationLatentStyle`, which follows the name plate down onto the building. */
.station-latent {
  position: absolute;
  top: 26px;
  left: 50%;
  transform: translateX(-50%);
  /* top/left/transform above are the fallback; `stationLatentStyle` overrides
     them so the hint follows the name plate. */
  z-index: 5;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(40, 30, 8, 0.78);
  color: #f0b429;
  font-family: sans-serif;
  font-size: 11px;
  font-weight: 700;
  pointer-events: none;
}
.station-latent-icon {
  font-size: 10px;
}
/* The name plate on the building's front, in the HUD's own chrome (MenuDrawer /
   ToolDock): a small dark tag, so a place name on the board and a place name in
   the panel are visibly the same kind of label. Placed by `stationPlateStyle` —
   the `top`/`left`/`transform` here are only the fallback for a station on a
   shape that has no platform strip. */
.station-nameplate {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 96%;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(18, 22, 28, 0.82);
  color: #f3f5f7;
  font-family: sans-serif;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
}
.station-nameplate-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
/* The services that call here, one dot per line livery, riding in the plate. A
   platform nobody serves shows none — exactly the thing a player needs to spot. */
.station-line-pip {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85);
}
.station-passenger--alt {
  fill: #4a6d8c; // a second coat colour so the crowd isn't a uniform string
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
.road-cycle-band {
  // Green tint for a cycle lane — the painted-lane convention (DE/US green),
  // clearly apart from the bus lane's gold and the mismatch red. Same paint
  // order as the bus band.
  fill: #2e5233;
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
.lg-cycle {
  stroke: #66d97a;
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

/* --- junction switches ------------------------------------------------------
   Train Valley's language: the control is a MARKING ON THE TRACK, not a widget
   beside it. Each arm is an arrow laid along the rail curve a train would take,
   headed at the edge it leaves by; gold = where the points stand.

   Replaces a 24x18 black box of three 3px bulbs at the tile edge — ~16px on
   screen at a fitted zoom, with nothing in it saying which bulb meant which way.

   The GEOMETRY scales with the board (these are track markings, and they must
   stay glued to the rails), but the WEIGHT does not: every stroke width is
   multiplied by `--switch-scale`, which the view derives from the camera zoom.
   That is what keeps them heavy on a zoomed-out world without letting them drift
   off the rail they belong to. */
.switch-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  // Above the rails (TileRail is z2 and earlier in the DOM), UNDER the trains
  // (wagons z3, loco z10): the arrows are paint on the track, and a train
  // physically rolls over paint. While a train covers a fan the tile is locked
  // anyway, so no clickable target is being buried.
  z-index: 2;
  overflow: visible;
  // Only the arrows take clicks — the layer covers the whole tile.
  pointer-events: none;
}
.switch-fan {
  // At rest the arrows are track markings, not the main event: translucent
  // enough to sit under the scenery's volume, opaque enough to read. They come
  // up to full strength exactly when they matter — a train approaching that
  // entry, or the pointer on it (and always in the editor, an editing surface).
  opacity: 0.55;
  transition: opacity 0.18s ease;
}
.switch-fan--open,
.switch-fan--armed,
.switch-layer--static .switch-fan {
  opacity: 1;
}
// A train is arriving by a different entry — that fan is the one that matters,
// so this one steps back rather than competing with it.
.switch-fan--muted {
  opacity: 0.28;
}

// The Train Valley arrow (the A1/A3 hybrid): a near-black body in a white
// casing, so it reads on grass, ballast, sand and water alike — the same
// two-pass trick TV itself uses. The SET arm is the solid black arrow;
// the alternatives (only visible while a fan is open) are the inverse ghost —
// white body, dark casing — so "current" and "available" are never confused.
.switch-arm-casing {
  fill: none;
  stroke: #f4f4f2;
  stroke-width: calc(19px * var(--switch-scale, 1));
  stroke-linecap: round;
  stroke-linejoin: round;
}
.switch-arm-casing:not(.is-on) {
  stroke: rgba(24, 24, 24, 0.55);
}
.switch-arm {
  fill: none;
  stroke: rgba(250, 250, 248, 0.82);
  stroke-width: calc(13px * var(--switch-scale, 1));
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: stroke 0.15s ease, opacity 0.15s ease;
}
.switch-arm.is-on {
  stroke: #232323;
}
.switch-arm-head {
  fill: rgba(250, 250, 248, 0.82);
  stroke: rgba(24, 24, 24, 0.55);
  stroke-width: calc(3px * var(--switch-scale, 1));
  stroke-linejoin: round;
  transition: fill 0.15s ease, opacity 0.15s ease;
}
.switch-arm-head.is-on {
  fill: #232323;
  stroke: #f4f4f2;
}
.switch-arm.is-hover:not(.is-on) {
  stroke: #ffffff;
}
.switch-arm-head.is-hover:not(.is-on) {
  fill: #ffffff;
}
.switch-fan--armed .switch-arm.is-on,
.switch-fan--armed .switch-arm-head.is-on {
  filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.85));
}

.switch-hit {
  fill: none;
  stroke: transparent;
  // Grows as the board zooms out, so the target stays tappable even though the
  // arrow it follows is shrinking with the tile.
  stroke-width: calc(26px * var(--switch-scale, 1));
  stroke-linecap: round;
  pointer-events: stroke;
  cursor: pointer;
}
// In the editor the arrows are a picture of the AUTHORED arm; the editor's own
// zones own the clicks.
.switch-layer--static .switch-hit {
  pointer-events: none;
  cursor: default;
}
// Interlocked: a train has this tile reserved or is standing on it, so the
// points are bolted. Still hoverable, so the cursor can say why.
.switch-fan--locked {
  filter: saturate(0.15);
}
.switch-fan--locked .switch-hit {
  cursor: not-allowed;
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
