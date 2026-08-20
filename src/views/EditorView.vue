<template>
  <div class="editor-view" :class="{ debug: config.debug }">
    <MenuDrawer id="editor" title="Editor">
      <!-- Never disabled: starting is the USER's call. A level with no depots,
           an odd one out, or an open-ended stub is a perfectly good thing to go
           and look at — the drawer status below still says what is off, but it
           does not hold the door shut. -->
      <button class="drawer-btn accent" @click="playThis">
        <span>▶</span><span>Play this</span>
      </button>
      <button class="drawer-btn" @click="randomMap">
        <span>🎲</span><span>Random</span>
      </button>
      <button class="drawer-btn" @click="clearAll">
        <span>🧹</span><span>Clear</span>
      </button>
      <div class="drawer-divider"></div>
      <button class="drawer-btn" @click="exportJson">
        <span>📤</span><span>Export</span>
      </button>
      <button class="drawer-btn" @click="importJson">
        <span>📥</span><span>Import</span>
      </button>
      <div class="drawer-divider"></div>
      <button class="drawer-btn" @click="cycleTheme">
        <span>🎨</span><span>Theme</span>
        <span class="drawer-btn__val">{{ themeIcon }}</span>
      </button>
      <router-link class="drawer-btn" to="/play">
        <span>🎮</span><span>Back to game</span>
      </router-link>
      <div class="drawer-status" :class="{ 'drawer-status--bad': !valid.ok }">
        {{ valid.ok ? "✓ valid" : valid.issues.length + " issue(s)" }}
        <template v-if="depotIds.length"> · {{ depotIds.length }} depots</template>
        <template v-else-if="roadOnly"> · road only</template>
      </div>
    </MenuDrawer>

    <!-- The three-row build dock (see BuildDock.vue): items+options / tabs /
         categories, Transport-Fever style. The editor owns every piece of state;
         the dock draws it and reports clicks. -->
    <BuildDock
      :categories="dockCategories"
      :cat="cat"
      :tab="activeTabId"
      :active-item-key="activeItemKey"
      :hint="hint"
      :help="help"
      :breadcrumb="breadcrumb"
      :has-options="hasOptions"
      @select-cat="selectCategory"
      @select-tab="selectTab"
      @select-item="selectItemByKey"
    >
      <template #options>
        <!-- Roads tab: the two modifiers plus a live cross-section of the road
             the next drag will lay — the "what am I about to draw" readout that
             replaces composing 1L/2L/3L × 🚌 × ➡️ in your head. -->
        <template v-if="tool === 'road'">
          <div class="bd-chips">
            <button
              class="bd-chip"
              :class="{ on: roadOneWay }"
              title="One-way road (lanes only in the drawn direction)"
              @click="roadOneWay = !roadOneWay"
            >➡️ one-way</button>
            <button
              class="bd-chip"
              :class="{ on: roadIsBus }"
              title="Add a kerb-side bus lane per direction (cars cannot use it)"
              @click="roadIsBus = !roadIsBus"
            >🚌 bus lane</button>
          </div>
          <div class="bd-xsec" :title="xsecTitle">
            <div class="bd-xsec__kerb"></div>
            <template v-if="!roadOneWay">
              <div v-if="roadIsBus" class="bd-xsec__lane bd-xsec__lane--bus">◂◂◂◂◂◂</div>
              <div v-for="i in roadLaneCount" :key="'l' + i" class="bd-xsec__lane">◂◂◂◂◂◂</div>
            </template>
            <div v-for="i in roadLaneCount" :key="'r' + i" class="bd-xsec__lane">▸▸▸▸▸▸</div>
            <div v-if="roadIsBus" class="bd-xsec__lane bd-xsec__lane--bus">▸▸▸▸▸▸</div>
            <div class="bd-xsec__kerb"></div>
          </div>
        </template>
        <!-- Parking bays: the reservation the laid bays carry. Reserved ones
             stay empty in play — nothing issues a permit — which is what makes
             a car park read as a real one, never 100% usable. -->
        <div v-else-if="tool === 'parking'" class="bd-chips">
          <button
            class="bd-chip"
            :class="{ on: !parkReserved }"
            title="Ordinary bays"
            @click="parkReserved = undefined"
          >—</button>
          <button
            class="bd-chip"
            :class="{ on: parkReserved === 'disabled' }"
            title="Disabled bays (stay empty — no permit system yet)"
            @click="parkReserved = parkReserved === 'disabled' ? undefined : 'disabled'"
          >♿</button>
          <button
            class="bd-chip"
            :class="{ on: parkReserved === 'delivery' }"
            title="Delivery bay (stays empty)"
            @click="parkReserved = parkReserved === 'delivery' ? undefined : 'delivery'"
          >📦</button>
          <button
            class="bd-chip"
            :class="{ on: parkReserved === 'long' }"
            title="Lorry lay-by — lorries and coaches; cars may not use it"
            @click="parkReserved = parkReserved === 'long' ? undefined : 'long'"
          >🚛</button>
          <button
            class="bd-chip"
            :class="{ on: parkReserved === 'bus' }"
            title="Bus stop — coaches only. Give it a short dwell: a halt is not parking."
            @click="parkReserved = parkReserved === 'bus' ? undefined : 'bus'"
          >🚌</button>
        </div>
        <!-- Which car park the facility brush sweeps tiles into. -->
        <div v-else-if="tool === 'facility'" class="bd-chips">
          <input v-model="facilityId" class="bd-facility-input" maxlength="12" />
          <button class="bd-chip" title="Next car park" @click="nextFacilityId()">＋</button>
        </div>
      </template>
    </BuildDock>

    <div class="world">
    <div
      ref="viewport"
      class="world-viewport"
      :class="{ 'world-viewport--panning': panning }"
      @pointerdown="onViewportPointerDown"
      @pointermove="onViewportPointerMove"
      @pointerup="onViewportPointerUp"
      @pointercancel="onViewportPointerUp"
      @wheel.prevent="onViewportWheel"
    >
    <!-- Board chrome, all in one corner: the world grows right/down by drawing
         into the margin; these two grow it before the origin. They live with the
         zoom cluster because they are WORLD controls, not build tools. -->
    <div class="world-zoom">
      <button
        class="zoom-btn"
        title="Add a column before the left edge (shifts the world right)"
        @click.stop="growLeft"
      >⬅︎+</button>
      <button
        class="zoom-btn"
        title="Add a row above the top edge (shifts the world down)"
        @click.stop="growUp"
      >⬆︎+</button>
      <span class="zoom-size" :title="`World size: ${gridCols - 2} x ${gridRows - 2} tiles`">
        {{ gridCols - 2 }}×{{ gridRows - 2 }}
      </span>
      <button class="zoom-btn" title="Zoom out" @click.stop="zoomBy(1 / 1.25)">−</button>
      <button class="zoom-btn zoom-btn--fit" title="Fit the whole world" @click.stop="fitWorld()">
        {{ Math.round(camera.zoom * 100) }}%
      </button>
      <button class="zoom-btn" title="Zoom in" @click.stop="zoomBy(1.25)">+</button>
    </div>
    <div
      class="level editor-grid"
      :style="{
        gridTemplateColumns: `repeat(${gridCols}, ${config.tileSize}px)`,
        width: config.tileSize * gridCols + 'px',
        transform: levelTransform,
      }"
      @mouseup="clearPress()"
      @mouseleave="clearPress()"
    >
      <div
        v-for="cell in gridCells"
        :key="cell.key"
        class="level-tile editor-cell"
        :data-coord="cell.key"
        :class="{
          'editor-cell--issue': issueIds.has(cell.key),
          'editor-cell--armed': glowId === cell.key,
        }"
        :style="{
          width: config.tileSize + 'px',
          height: config.tileSize + 'px',
        }"
        @click="onCellClick(cell.key)"
        @mousedown="onTerrainDown($event, cell.key); onFacilityDown($event, cell.key); onHeightDown($event, cell.key)"
        @mouseenter="onTerrainEnter($event, cell.key); onFacilityEnter($event, cell.key); onHeightEnter($event, cell.key)"
      >
        <TileGround :coord-id="cell.key" />
        <!-- Driveways and pavements, above EVERY tile's ground patch so a
             neighbour's jittered patch cannot chew a notch out of them at the
             seam. See TileGround.vue. -->
        <TileGround :coord-id="cell.key" layer="paving" />
        <!-- Which car park this tile belongs to. Read straight off the cell, not
             through facilitiesOf: while a stroke is in progress the level is
             mid-edit and a derived grouping would lag a tile behind the cursor. -->
        <div
          v-if="tool === 'facility' && cell.tile && cell.tile.parking && cell.tile.parking.facility"
          class="facility-tint"
          :style="{ background: facilityTint(cell.tile.parking.facility) }"
        >{{ cell.tile.parking.facility }}</div>
        <!-- Standing scenery on its own layer above every patch fill, so a
             canopy overhanging the seam isn't cut by the next tile. -->
        <TileGround :coord-id="cell.key" layer="scatter" />
        <Tile
          v-if="cell.tile"
          :tile="cell.tile"
          :coord-id="cell.key"
          class="tile-component"
          :switch-interactive="false"
        />
        <!-- Canopies overhanging a line (see TileGround.vue). The editor's own
             overlay sits at z30, so every handle stays clickable and visible. -->
        <TileGround :coord-id="cell.key" layer="canopy" />

        <svg
          class="overlay"
          :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
        >
          <!-- Ghost preview of the rail/road an armed edge would lay to the
               hovered edge, so the builder sees what they're about to make. -->
          <path
            v-for="(d, i) in previewRails(cell.key)"
            :key="'pv' + i"
            :d="d"
            :class="previewClass"
          />

          <!-- Edge hit-zones: the whole tile is clickable, split into four
               triangles (one per edge) for big, kid-friendly targets. -->
          <template v-if="tool === 'connect' || tool === 'road' || tool === 'signal'">
            <path
              v-for="p in EDGES"
              :key="'z' + p"
              :data-port="p"
              :d="zonePath(p)"
              class="zone"
              :class="{
                'zone--armed': isArmed(cell.key, p),
                'zone--finish': isFinish(cell.key, p),
                'zone--signal': tool === 'signal' && hasSignal(cell.tile, p),
              }"
              @mousedown.stop="onZoneDown(cell.key, p)"
              @mouseup.stop="onZoneUp(cell.key, p)"
              @click.stop="onZoneClick(cell.key, p)"
              @mouseenter="onZoneEnter(cell.key, p)"
              @mouseleave="onZoneLeave(cell.key, p)"
            />
          </template>

          <!-- Bus-lane mode: one invisible wide-stroke hit path along each road
               lane's real centreline, so the author clicks the exact lane they
               want (hover highlights it). This replaces the edge zones for the
               buslane tool — a lane, not a tile edge, is the thing being toggled. -->
          <template v-if="laneToolActive && cell.tile">
            <path
              v-for="(hl, i) in laneHits(cell.key)"
              :key="'lh' + i"
              :d="hl.d"
              class="lane-hit"
              :class="{ 'lane-hit--bus': hl.isBus, 'lane-hit--cycle': hl.isCycle }"
              @click.stop="onLaneClick($event, cell.key, hl.from, hl.index)"
            />
          </template>

          <!-- Parking mode: one invisible hit strip per physical KERB — literally
               the pixels the bays will cover, so you click where the parking
               goes. A greyed strip cannot take the armed kind (a bend, a
               junction, a street too wide for 90 degree bays). Hovering shows the
               bays that would be laid, drawn by the same function that paints the
               real ones. -->
          <template v-if="tool === 'parking' && cell.tile">
            <path
              v-for="(k, i) in kerbHits(cell.key)"
              :key="'kh' + i"
              :d="k.d"
              class="kerb-hit"
              :class="{ 'kerb-hit--has': k.has, 'kerb-hit--bad': !k.ok }"
              @click.stop="onKerbClick($event, cell.key, k)"
              @mouseenter="hoverKerb = { id: cell.key, bank: k.bank }"
              @mouseleave="hoverKerb = null"
            />
            <path
              v-for="(d, i) in ghostBays(cell.key)"
              :key="'gb' + i"
              :d="d"
              class="preview-parking"
            />
          </template>

          <!-- Edge markers (signal mode only): show where a signal sits and its
               clickable edge. The connect triangles need no dots. -->
          <template v-if="tool === 'signal'">
            <circle
              v-for="p in EDGES"
              :key="'d' + p"
              :cx="dot(p).x"
              :cy="dot(p).y"
              r="10"
              class="zone-dot"
              :class="{ 'zone-dot--signal': hasSignal(cell.tile, p) }"
            />
          </template>

          <!-- Rail-delete handles (bulldozer): a tappable ✕ near the middle of
               each rail removes just that connection (clicking elsewhere on the
               tile applies the armed layer filter). Shown only when the filter
               includes rail, so a road-scoped bulldozer never offers a rail ✕. -->
          <template v-if="tool === 'erase' && cell.tile">
            <template v-if="eraseScope === 'all' || eraseScope === 'rail'">
              <g
                v-for="(conn, i) in cell.tile.connections"
                :key="'x' + i"
                class="del"
                @click.stop="deleteConn(cell.key, conn)"
              >
                <circle
                  :cx="delPos(conn).x"
                  :cy="delPos(conn).y"
                  r="13"
                  class="del-bg"
                />
                <path :d="delMark(conn)" class="del-mark" />
              </g>
            </template>
            <!-- Road-delete handles: a ✕ on each road pair removes just it. -->
            <template v-if="eraseScope === 'all' || eraseScope === 'road'">
              <g
                v-for="(road, i) in roadEdges(cell.tile)"
                :key="'xr' + i"
                class="del del--road"
                @click.stop="deleteRoad(cell.key, road)"
              >
                <circle
                  :cx="delPos(road).x"
                  :cy="delPos(road).y"
                  r="13"
                  class="del-bg"
                />
                <path :d="delMark(road)" class="del-mark" />
              </g>
            </template>
          </template>

          <!-- Lane-count badge: shown on road tiles when the road tool is
               active, so the author can see each tile's current lane count
               without switching to a debug overlay. -->
          <g
            v-if="tool === 'road' && roadTileLaneCount(cell.tile) > 0"
            class="lane-badge"
            pointer-events="none"
          >
            <rect
              :x="config.tileSize / 2 - 14"
              :y="config.tileSize - 20"
              width="28"
              height="14"
              rx="3"
              class="lane-badge-bg"
            />
            <text
              :x="config.tileSize / 2"
              :y="config.tileSize - 9"
              class="lane-badge-text"
            >{{ roadTileLaneCount(cell.tile) }}L</text>
          </g>

          <!-- Junction switch zones: one clickable spot over each junction
               entry's switch widget. Painted after the edge zones so it sits in
               front and intercepts the click, cycling that entry's authored
               starting arm. Available in any tool — it only covers the widget. -->
          <circle
            v-for="entry in junctionEntries(cell.tile)"
            :key="'sw' + entry"
            :cx="switchPoint(entry).x"
            :cy="switchPoint(entry).y"
            r="22"
            class="switch-zone"
            @click.stop="onSwitchClick(cell.key, entry)"
          />
        </svg>
      </div>
    </div>
    </div>
    </div>

    <textarea
      v-if="showIo"
      v-model="ioText"
      class="io-box"
      spellcheck="false"
      @blur="onIoBlur"
    ></textarea>
  </div>
</template>

<script lang="ts">
import { markRaw, reactive, ref } from "vue";
import { Component, Inject, Provide, Vue, Watch, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY, gameConfig, setWorldTheme } from "@/gameConfig";
import { nextTheme, themeMeta } from "@/themes";
import MenuDrawer from "@/components/MenuDrawer.vue";
import BuildDock from "@/components/BuildDock.vue";
import type { BuildDockCategoryView } from "@/components/BuildDock.vue";
import type { JunctionSignal } from "@/sim/junctionSignal";
import type { Game } from "@/game";
import { initialSwitches } from "@/game";
import { Position, Coordinates } from "@/types";
import {
  Level,
  Port,
  PortPair,
  portsOf,
  isJunctionEntry,
  parseCoordId,
  isRoadOnlyLevel,
  TerrainKind,
} from "@/tiles/model";
import { SWITCH_INSET as SWITCH_HUB_INSET } from "@/tiles/switchFan";
import { levelBounds, translateLevel } from "@/tiles/bounds";
import { CHROME_INSETS, type Camera, type Size } from "@/camera";
import { createCameraController, type CameraController } from "@/cameraController";
import {
  emptyCell,
  addConnection,
  removeConnection,
  addRoad,
  removeRoad,
  setDepot,
  rotateDepot,
  toggleStation,
  toggleSignalPort,
  cycleDefaultArm,
  toggleBusLane,
  setBusLaneRun,
  toggleCycleLane,
  toggleCycleLaneRun,
  addStreetLane,
  addStreetLaneRun,
  removeStreetLane,
  removeStreetLaneRun,
  syncJunctionLanesAround,
  setTerrain,
  shiftHeight,
  cycleFlyover,
  setJunctionSignalMode,
  eraseLayer,
  type EraseLayer,
  isBlankCell,
  canParkOn,
  parkingRowAt,
  toggleParkingRow,
  setParkingRowRun,
  setFacility,
  pruneParkingRows,
  type RowSpec,
} from "@/tiles/editOps";
import {
  bankFor,
  kerbOffsetAt,
  kerbOffsetEnds,
  maxStallsPerTile,
  needsBigBay,
  stallDepthPx,
  type StallKind,
  type StallReservation,
} from "@/tiles/parking";
import { stallOutlinePath, garageGeometry, rowFrame } from "@/tiles/parkingGeometry";
import { canBuildOn, needsBridge, needsTunnel } from "@/tiles/terrain";
import { validateLevel, ValidationResult, TrainRoute } from "@/tiles/validate";
import { generateLevel } from "@/tiles/generate";
import { railPathsFor } from "@/tiles/geometry";
import { roadSurfacePath } from "@/tiles/roadGeometry";
import {
  createRouteDrawController,
  type RouteDrawController,
} from "@/routeDrawController";
import {
  roadEdges as laneEdges,
  laneCount,
  laneCountAt,
  turnSeamBand,
  isRoadJunction,
  oneWayRunMax,
  junctionExitOffsetPx,
  turnLandsOnBusLane,
} from "@/tiles/lanes";
import type { VehicleClass } from "@/tiles/lanes";
import { laneSegmentPathD } from "@/sim/pathGeometry";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { setCustomLevel, trainsFromRoutes, migrateLevel } from "@/levelStore";
import { takeEditorSeed } from "@/editorSeed";

type Tool =
  | "connect"
  | "depot"
  | "station"
  | "signal"
  | "flyover"
  | "erase"
  | "road"
  | "buslane"
  | "bikelane"
  | "laneadd"
  | "laneremove"
  | "signalise"
  | "terrain"
  | "height"
  | "parking"
  | "facility";

// The dock is THREE levels (see BuildDock.vue and the design spec
// docs/superpowers/specs/2026-08-21-build-ui-redesign-design.md): pick the
// CATEGORY you are working on (train / car / terrain / demolish), the TAB that
// separates the verbs within it (build the way / stations / signalling;
// roads / upgrade / traffic lights / parking), then the tool. Brush-like tools
// (terrain kinds, stall kinds, road widths, signal modes, bulldozer scopes)
// are ITEMS carrying their parameter — selecting one arms the tool AND sets
// what it lays, so several items can share one Tool.
type CategoryId = "rail" | "road" | "terrain" | "raze";

// What the bulldozer removes: the whole tile, or one layer of it.
type EraseScope = "all" | EraseLayer;

interface DockItem {
  key: string;
  label: string;
  icon?: string; // emoji…
  lanes?: number; // …or the road cross-section glyph with this many lanes
  title?: string; // tooltip override
  tool: Tool;
  terrain?: TerrainKind;
  stall?: StallKind;
  heightDelta?: 1 | -1;
  // The road tool's width — 1L/2L/3L are separate catalog items, not a picker.
  laneCount?: 1 | 2 | 3;
  // The traffic-light tool's mode: pick it here, click junctions to apply.
  signalMode?: JunctionSignal;
  // The bulldozer's layer filter.
  erase?: EraseScope;
  // One-line hint (shown over the board) and the full help behind the ? button.
  hint: string;
  help: string;
}

interface DockTab {
  id: string;
  label: string;
  items: DockItem[];
}

interface DockCategory {
  id: CategoryId;
  icon: string;
  label: string;
  accent: string;
  shortcut: string;
  tabs: DockTab[];
}

// Long help texts shared by every item of a tool (the ? popover). The one-line
// `hint` is per item; this is the manual it condenses.
const HELP = {
  connect:
    "Routes a track corner by corner: click an edge, then click tiles; click the start edge again or press Esc to finish. Drag for a quick single rail. Click a junction's switch to set its starting direction. Crossing water builds a bridge, rock or mountain a tunnel — priced accordingly.",
  depot: "Trains start and end at depots. Click a cell to place one; click it again to rotate its facing.",
  station:
    "Click a tile with through-track (edge-to-edge rails) to make it a station — every train calls there briefly. Click it again to remove the station.",
  signal:
    "Click an edge to toggle a signal for that direction. At a signal a train reserves the whole route to the next signal before entering — signals are what keep trains apart.",
  flyover:
    "Click a diamond crossing (two rails crossing without switches) to cycle which line rides the bridge deck: flat → first line over → other line over → flat. Grade-separated lines never wait for each other — no junction, no conflict.",
  road:
    "Click an edge, then click tiles to route a road; click the start edge again or Esc to finish. Drag for a quick single road. Draw over an existing road with a different width to repaint it. The options set one-way (lanes only in the drawn direction) and a kerb-side bus lane per direction; the cross-section shows exactly what the next drag lays. Road over track = level crossing.",
  laneadd:
    "Click a street to add one car lane EACH WAY along the whole street (1L → 2L → 3L — a one-way street gains its one direction). 3L is the ceiling. Stops at junctions. New lanes go on the centre side, so a kerb-side bus or bike lane stays on the kerb. Ctrl+click changes just that one tile.",
  laneremove:
    "Click a street to remove the innermost car lane EACH WAY along the whole street (3L → 2L → 1L). Bus and bike lanes are never taken — use the bus/bike tools for those — and each direction keeps its last car lane. Ctrl+click changes just that one tile.",
  buslane:
    "Click a lane to toggle it BUS-only ↔ normal along the whole street (through straights and curves, stopping at junctions). An in-place conversion: the lane keeps its place, only who may use it changes (buses and bikes; cars not). Ctrl+click toggles just that one tile's lane.",
  bikelane:
    "Click a street to ADD a green bike lane on EACH kerb — a NEW lane per direction; the street widens and keeps every car lane it had. Click again (any lane) to remove them. Runs the whole street, stopping at junctions, where bikes merge in. Only bikes may ride green (they may use bus lanes too). Ctrl+click toggles just that one tile.",
  signalise:
    "Applies the armed mode to the clicked road junction. Cars then obey per-arm green/amber/red on top of the give-way rules. Two-phase pairs opposite arms; round-robin gives each arm green in turn. +Bus lets an approaching bus call or extend its green. Off returns the junction to give-way rules.",
  parking:
    "Click a kerb to line the whole street with bays — the clicked kerb decides the new state, so a half-painted street goes uniform in one click; Ctrl+click does one tile. A greyed kerb cannot take the picked kind (90° bays need a narrow street; nothing parks in a bend or junction). 🏢 places a garage, 🚏 a bus stop IN the running lane. The reservation chips mark bays for one vehicle class: 🚛 lorries and coaches, 🚌 coaches only, 📦 the delivery lorry, ♿ nobody yet — reserved bays stay empty, which is what makes a car park look real.",
  facility:
    "Drag across tiles to sweep them into ONE car park, so its capacity and its P sign count together. Include the AISLE tiles, not just the ones with bays. Drag over the same car park again to remove those tiles from it.",
  terrain:
    "Drag across the board to paint ground — woods, water, rock, mountains and towns are areas, and the trees, boulders and buildings on them follow automatically. Grass is the eraser. Water, rock and mountain cannot be built on; routing across water builds a bridge, across rock a tunnel. Woods and towns can be built through (you clear them).",
  height:
    "Drag to raise or lower the ground one step per stroke — paint a hill as an AREA. Track may climb ONE step per tile boundary (that joint is the ramp); anything steeper is flagged as a cliff. Climbs slow heavy trains.",
  raze:
    "The armed filter decides which layer the click removes; everything else on the tile stays. Everything clears the whole tile. With Rail or Road armed, a ✕ handle removes one single connection instead. A tile left carrying nothing disappears from the level.",
};

const DOCK: DockCategory[] = [
  {
    id: "rail",
    icon: "🚆",
    label: "Rail",
    accent: "#e3a63e",
    shortcut: "1",
    tabs: [
      {
        id: "track",
        label: "Track",
        items: [
          {
            key: "connect", icon: "🛤️", label: "Track", tool: "connect",
            hint: "Click an edge, then click tiles to route track — Esc finishes.",
            help: HELP.connect,
          },
        ],
      },
      {
        id: "stations",
        label: "Stations",
        items: [
          {
            key: "station", icon: "🚉", label: "Station", tool: "station",
            hint: "Click through-track to toggle a station.",
            help: HELP.station,
          },
          {
            key: "depot", icon: "🏠", label: "Depot", tool: "depot",
            hint: "Click a cell to place a depot — click again to rotate.",
            help: HELP.depot,
          },
        ],
      },
      {
        id: "signalling",
        label: "Signalling",
        items: [
          {
            key: "signal", icon: "🚦", label: "Signal", tool: "signal",
            hint: "Click an edge to toggle a signal for that direction.",
            help: HELP.signal,
          },
          {
            key: "flyover", icon: "🌉", label: "Flyover", tool: "flyover",
            hint: "Click a diamond crossing to cycle which line rides the bridge.",
            help: HELP.flyover,
          },
        ],
      },
    ],
  },
  {
    id: "road",
    icon: "🚗",
    label: "Road",
    accent: "#5f9fe8",
    shortcut: "2",
    tabs: [
      {
        id: "roads",
        label: "Roads",
        items: [
          {
            key: "road1", lanes: 1, label: "1-lane", tool: "road", laneCount: 1,
            title: "Street — one lane per direction",
            hint: "Click an edge, then click tiles to route the road — Esc finishes.",
            help: HELP.road,
          },
          {
            key: "road2", lanes: 2, label: "2-lane", tool: "road", laneCount: 2,
            title: "Street — two lanes per direction",
            hint: "Click an edge, then click tiles to route the road — Esc finishes.",
            help: HELP.road,
          },
          {
            key: "road3", lanes: 3, label: "3-lane", tool: "road", laneCount: 3,
            title: "Street — three lanes per direction",
            hint: "Click an edge, then click tiles to route the road — Esc finishes.",
            help: HELP.road,
          },
        ],
      },
      {
        id: "upgrade",
        label: "Upgrade",
        items: [
          {
            key: "laneadd", icon: "➕", label: "Add lane", tool: "laneadd",
            hint: "Click a street to add a car lane each way along the run.",
            help: HELP.laneadd,
          },
          {
            key: "laneremove", icon: "➖", label: "Remove lane", tool: "laneremove",
            hint: "Click a street to remove the innermost car lane each way.",
            help: HELP.laneremove,
          },
          {
            key: "buslane", icon: "🚌", label: "Bus lane", tool: "buslane",
            hint: "Click a lane to toggle it bus-only along the street.",
            help: HELP.buslane,
          },
          {
            key: "bikelane", icon: "🚲", label: "Bike lane", tool: "bikelane",
            hint: "Click a street to add green bike lanes on both kerbs.",
            help: HELP.bikelane,
          },
        ],
      },
      {
        id: "lights",
        label: "Traffic lights",
        items: [
          {
            key: "sig-off", icon: "⭘", label: "Off", tool: "signalise",
            signalMode: { mode: "off" },
            hint: "Click a junction to remove its traffic lights.",
            help: HELP.signalise,
          },
          {
            key: "sig-2p", icon: "🚥", label: "Two-phase", tool: "signalise",
            signalMode: { mode: "two-phase" },
            hint: "Click a junction to give it two-phase lights.",
            help: HELP.signalise,
          },
          {
            key: "sig-2pb", icon: "🚥", label: "2-ph +Bus", tool: "signalise",
            signalMode: { mode: "two-phase", busPriority: true },
            title: "Two-phase with bus priority",
            hint: "Click a junction — two-phase lights with bus priority.",
            help: HELP.signalise,
          },
          {
            key: "sig-rr", icon: "🔄", label: "Round-robin", tool: "signalise",
            signalMode: { mode: "round-robin" },
            hint: "Click a junction to give each arm green in turn.",
            help: HELP.signalise,
          },
          {
            key: "sig-rrb", icon: "🔄", label: "R-robin +Bus", tool: "signalise",
            signalMode: { mode: "round-robin", busPriority: true },
            title: "Round-robin with bus priority",
            hint: "Click a junction — round-robin lights with bus priority.",
            help: HELP.signalise,
          },
        ],
      },
      {
        id: "parking",
        label: "Parking",
        items: [
          {
            key: "park-parallel", icon: "🚗", label: "Kerb", tool: "parking", stall: "parallel",
            hint: "Click a kerb to line the street with parking bays.",
            help: HELP.parking,
          },
          {
            key: "park-angled", icon: "↗️", label: "Angled", tool: "parking", stall: "angled",
            hint: "Click a kerb to lay angled bays.",
            help: HELP.parking,
          },
          {
            key: "park-perp", icon: "🅿️", label: "90°", tool: "parking", stall: "perpendicular",
            hint: "Click a kerb for 90° bays — needs a narrow street.",
            help: HELP.parking,
          },
          {
            key: "park-garage", icon: "🏢", label: "Garage", tool: "parking", stall: "garage",
            hint: "Click a kerb to place a garage with a ramp.",
            help: HELP.parking,
          },
          {
            key: "park-busstop", icon: "🚏", label: "Halt", tool: "parking", stall: "busstop",
            hint: "Click a kerb — the bus halts in the running lane.",
            help: HELP.parking,
          },
          {
            key: "park-facility", icon: "#️⃣", label: "Car park", tool: "facility",
            hint: "Drag tiles into one car park — aisles included.",
            help: HELP.facility,
          },
        ],
      },
    ],
  },
  {
    id: "terrain",
    icon: "🏔️",
    label: "Terrain",
    accent: "#63b568",
    shortcut: "3",
    tabs: [
      {
        id: "ground",
        label: "Ground",
        items: [
          { key: "farmland", icon: "🌾", label: "Fields", tool: "terrain", terrain: "farmland", hint: "Drag across the board to paint fields.", help: HELP.terrain },
          { key: "forest", icon: "🌲", label: "Forest", tool: "terrain", terrain: "forest", hint: "Drag across the board to paint woods.", help: HELP.terrain },
          { key: "water", icon: "💧", label: "Water", tool: "terrain", terrain: "water", hint: "Drag to paint water — routes across it bridge it.", help: HELP.terrain },
          { key: "rock", icon: "🪨", label: "Rock", tool: "terrain", terrain: "rock", hint: "Drag to paint rock — routes across it tunnel it.", help: HELP.terrain },
          { key: "mountain", icon: "⛰️", label: "Mountain", tool: "terrain", terrain: "mountain", hint: "Drag to paint mountains — routes tunnel under them.", help: HELP.terrain },
          { key: "urban", icon: "🏘️", label: "Town", tool: "terrain", terrain: "urban", hint: "Drag across the board to paint town.", help: HELP.terrain },
          { key: "industry", icon: "🏭", label: "Works", tool: "terrain", terrain: "industry", hint: "Drag across the board to paint industry.", help: HELP.terrain },
          { key: "grass", icon: "🟩", label: "Grass", tool: "terrain", terrain: "grass", hint: "Drag to erase ground back to grass.", help: HELP.terrain },
        ],
      },
      {
        id: "height",
        label: "Height",
        items: [
          { key: "raise", icon: "🔼", label: "Raise", tool: "height", heightDelta: 1, hint: "Drag to raise the ground one step — paint hills as areas.", help: HELP.height },
          { key: "lower", icon: "🔽", label: "Lower", tool: "height", heightDelta: -1, hint: "Drag to lower the ground one step.", help: HELP.height },
        ],
      },
    ],
  },
  {
    id: "raze",
    icon: "🧨",
    label: "Bulldozer",
    accent: "#e0705e",
    shortcut: "4",
    tabs: [
      {
        id: "raze",
        label: "Demolish",
        items: [
          { key: "raze-all", icon: "💥", label: "Everything", tool: "erase", erase: "all", hint: "Click a tile to clear it completely.", help: HELP.raze },
          { key: "raze-rail", icon: "🛤️", label: "Rail", tool: "erase", erase: "rail", hint: "Click a tile to remove only its rails.", help: HELP.raze },
          { key: "raze-road", icon: "🛣️", label: "Road", tool: "erase", erase: "road", hint: "Click a tile to remove only its road (parking goes with it).", help: HELP.raze },
          { key: "raze-parking", icon: "🅿️", label: "Parking", tool: "erase", erase: "parking", hint: "Click a tile to remove only its parking.", help: HELP.raze },
          { key: "raze-terrain", icon: "🏞️", label: "Terrain", tool: "erase", erase: "terrain", hint: "Click a tile to flatten its ground back to grass.", help: HELP.raze },
        ],
      },
    ],
  },
];

// Where a tool lives in the dock (category + tab of its FIRST occurrence), so
// arming a tool any other way (a hand-off, a shortcut) still opens the right
// tab. Tools armed by several items (road widths, signal modes, brushes) all
// live on one tab, so first-occurrence is exact.
const LOCATION_OF_TOOL = new Map<Tool, { cat: CategoryId; tab: string }>();
for (const c of DOCK) {
  for (const t of c.tabs) {
    for (const it of t.items) {
      if (!LOCATION_OF_TOOL.has(it.tool)) {
        LOCATION_OF_TOOL.set(it.tool, { cat: c.id, tab: t.id });
      }
    }
  }
}

const LEVEL_KEY = "train-game:editor-level";
const LANE_COUNT_KEY = "train-game:editor-road-lane-count";
const ROAD_BUS_KEY = "train-game:editor-road-is-bus";
const ROAD_ONEWAY_KEY = "train-game:editor-road-one-way";
const PARK_KIND_KEY = "train-game:editor-park-kind";
const PARK_RESERVED_KEY = "train-game:editor-park-reserved";
const PARK_FACILITY_KEY = "train-game:editor-park-facility";
const EDGES: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];
// Lane width as a fraction of the tile, matching Tile.vue's LANE_WIDTH_PX_FRAC so
// the editor's lane hit paths sit on the same centrelines the renderer draws.
const LANE_WIDTH_PX_FRAC = 0.14;

// Empty cells kept beyond the level's content so there is always somewhere to
// draw. Two is enough to see where you are going without a sea of blank grid.
const GROW_MARGIN = 2;

// A no-op stand-in for the live Game so Tile.vue can render in the editor.
// `getLevel` lets the road lane-count lookups read the live editor level, so the
// editor tapers road ribbons at lane-count transitions and labels taper tiles
// exactly like play (rather than rendering every tile at its own flat width).
function stubGame(getLevel: () => Level, getTileSize: () => number): Game {
  const empty: Record<string, never> = {};
  const roadOf = (coord: Coordinates) => getLevel()[getCoordinatesId(coord)]?.road;
  return {
    depotColors: {},
    trainColors: {},
    // Tile.vue's neighbour-aware getters (tunnel portals, grade chevrons) read
    // this to register the play-mode edit counter; the editor's level is fully
    // reactive so the counter never needs to tick here — but it must EXIST, or
    // the first tunnel or hillside drawn in the editor throws.
    levelVersion: ref(0),
    switches: reactive({}),
    reservations: empty,
    occupied: empty,
    // No sim in the editor, so no crowd: a station renders its platforms with
    // an empty queue (Tile.vue optional-chains the lookup).
    stationQueues: empty,
    stationWaiting: empty,
    stationLatent: empty,
    // No service in the editor: platforms show their name, no line overlay.
    stationLabels: empty,
    lineOverlay: { trainId: null, colour: "", order: empty, path: empty },
    // No service in the editor: a station draws its platform with no line pips.
    stationLines: empty,
    signalAspects: empty,
    signalOverrides: empty,
    roadSignalAspects: empty,
    roadSignals: empty,
    // Parking is level DATA, so the editor draws the bays; only the live
    // occupancy and the "P n/total" sign belong to a running game. Empty here
    // means every bay renders free and no sign is drawn — which is exactly right
    // for a level that is not being played. (Omitting them would make Tile.vue's
    // parkingPaths read `undefined[key]` the moment a bay was drawn.)
    parkingOccupancy: empty,
    parkingStatus: empty,
    cycleSignal: () => {},
    cycleRoadSignal: () => {},
    // roadLaneCount / roadLaneCountAt are both called by Tile.vue's roadPaths
    // computed when a road tile is present. Read the live level (same as the play
    // game) so neighbour-aware tapering and the road-taper label work in-editor.
    roadLaneCount: (coord: Coordinates, port: Position) => laneCount(roadOf(coord), port),
    roadLaneCountAt: (coord: Coordinates, port: Position) => laneCountAt(roadOf(coord), port),
    roadIsJunctionAt: (coord: Coordinates) => isRoadJunction(roadOf(coord)),
    // Tile.vue calls this for every ONE-WAY straight (surface + overlay); without
    // it, drawing a one-way road in the editor threw. Shares the game's walk.
    roadOneWayRunMax: (coord: Coordinates, entry: Position) =>
      oneWayRunMax(roadOf, coord, entry),
    // Tile.vue's laneGraphOverlay (the debug lane-arrow overlay, on by default)
    // calls this for every TURN/junction movement to glide the arrow to the lane
    // the car lands in on the exit arm. Mirrors game.ts's turnExitOffsetPx exactly
    // so a junction drawn in the editor doesn't crash the render (omitting it threw
    // "roadTurnExitOffsetPx is not a function" the moment a road junction existed).
    roadTurnExitOffsetPx: (
      coord: Coordinates,
      entry: Position,
      exit: Position,
      entryLane: number,
      cls: VehicleClass,
    ): number | null => {
      const here = roadOf(coord);
      const next = neighborCoord(coord, exit);
      if (!next) return null;
      const exitRoad = roadOf(next);
      if (!exitRoad) return null;
      const exitApproach = oppositePort(exit);
      const exitBand = turnSeamBand(here, exit, exitRoad, exitApproach);
      if (exitBand <= 0) return null;
      return junctionExitOffsetPx(
        here,
        entry,
        entryLane,
        exit,
        exitRoad,
        exitApproach,
        exitBand,
        getTileSize(),
        cls,
      );
    },
    // Mirrors game.ts so the overlay colours a turn arrow amber only when the
    // movement lands on a real bus lane on the exit arm (else cyan) — in-editor too.
    roadTurnExitIsBusLane: (
      coord: Coordinates,
      entry: Position,
      exit: Position,
      entryLane: number,
      cls: VehicleClass,
    ): boolean => {
      const next = neighborCoord(coord, exit);
      if (!next) return false;
      return turnLandsOnBusLane(
        roadOf(coord),
        entry,
        entryLane,
        exit,
        roadOf(next),
        oppositePort(exit),
        cls,
      );
    },
  } as unknown as Game;
}

@Component({ components: { MenuDrawer, BuildDock } })
class EditorView extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Provide("game") game: Game = markRaw(
    // Read the gameConfig singleton directly (not this.config): the inject isn't
    // populated yet on the `this` captured by this field initializer.
    stubGame(
      () => this.level,
      () => gameConfig.tileSize,
    ),
  );

  EDGES = EDGES;
  levelSizeY = 6;
  tool: Tool = "connect";
  // Which dock category is open, which tab each category last showed, and which
  // item each tab last armed. The tool and the dock position are separate
  // state: the dock decides what the rows OFFER, the tool is what is armed —
  // and the per-category/per-tab memory means switching Rail → Road → Rail
  // restores your track tool rather than resetting to the first item.
  cat: CategoryId = "rail";
  tabByCat: Record<CategoryId, string> = {
    rail: "track",
    road: "roads",
    terrain: "ground",
    raze: "raze",
  };
  // Pre-seeded where the FIRST item is not the sensible default: opening the
  // traffic-lights tab should arm a mode that BUILDS lights, not Off (which is
  // listed first as the mode scale's zero).
  itemByTab: Record<string, string> = { "road/lights": "sig-2p" };
  // The bulldozer's armed layer filter, and the traffic-light tool's armed mode.
  eraseScope: EraseScope = "all";
  signalModeArmed: JunctionSignal = { mode: "two-phase" };
  // The kind the terrain brush paints. "grass" is the eraser: it clears the
  // field rather than storing a value, since absent means grass everywhere else.
  terrainBrush: TerrainKind = "forest";
  // The height tool's armed direction (raise or lower), and its drag state. A
  // stroke must touch each cell ONCE — unlike the terrain brush (idempotent
  // repaint), re-applying ±1 on every mouseenter would staircase a wobbling
  // drag — so the stroke remembers where it has been.
  heightBrush: 1 | -1 = 1;
  heightPainting = false;
  heightStroke = new Set<string>();
  // Terrain is the one tool where drag-to-paint is the natural verb (you paint
  // an AREA of wood, not a tile of it), so it tracks its own press state instead
  // of going through the edge-based gesture the connect tool uses.
  terrainPainting = false;
  // --- Parking -------------------------------------------------------------
  // The kind of bay the parking tool lays, and an optional reservation on it.
  // Armed by the dock item, exactly as terrain's brush is.
  stallKind: StallKind = (localStorage.getItem(PARK_KIND_KEY) as StallKind) || "parallel";
  parkReserved: StallReservation | undefined =
    (localStorage.getItem(PARK_RESERVED_KEY) as StallReservation) || undefined;
  // The car park the facility tool sweeps tiles into.
  facilityId = localStorage.getItem(PARK_FACILITY_KEY) || "P1";
  facilityPainting = false;
  // What the current drag decided on its FIRST tile, applied to the whole stroke —
  // so dragging across a mixed row makes it uniform instead of inverting each tile.
  facilityTarget: string | undefined = undefined;
  // The kerb under the cursor, so only that one draws its ghost bays.
  hoverKerb: { id: string; bank: Port } | null = null;

  // The dock's display data. BuildDock only reads the visual subset of each
  // item; the richer DockItem satisfies its view types structurally.
  dockCategories: BuildDockCategoryView[] = DOCK;

  get activeCategory(): DockCategory {
    return DOCK.find(c => c.id === this.cat) ?? DOCK[0];
  }
  get activeTabId(): string {
    return this.tabByCat[this.cat];
  }
  get activeTab(): DockTab {
    return (
      this.activeCategory.tabs.find(t => t.id === this.activeTabId) ??
      this.activeCategory.tabs[0]
    );
  }

  // A brush-like item is "active" by its PARAMETER, not just by its tool —
  // otherwise every ground button (or road width, or signal mode) would light
  // up together whenever the shared tool is armed.
  private isActiveItem(item: DockItem): boolean {
    if (item.terrain !== undefined) {
      return this.tool === "terrain" && this.terrainBrush === item.terrain;
    }
    if (item.stall !== undefined) {
      return this.tool === "parking" && this.stallKind === item.stall;
    }
    if (item.heightDelta !== undefined) {
      return this.tool === "height" && this.heightBrush === item.heightDelta;
    }
    if (item.laneCount !== undefined) {
      return this.tool === "road" && this.roadLaneCount === item.laneCount;
    }
    if (item.signalMode !== undefined) {
      return (
        this.tool === "signalise" &&
        this.signalModeArmed.mode === item.signalMode.mode &&
        !!this.signalModeArmed.busPriority === !!item.signalMode.busPriority
      );
    }
    if (item.erase !== undefined) {
      return this.tool === "erase" && this.eraseScope === item.erase;
    }
    return this.tool === item.tool;
  }

  // The armed item of the OPEN tab (the dock's one filled pill), or "" while a
  // tool from another tab is armed.
  get activeItem(): DockItem | undefined {
    return this.activeTab.items.find(i => this.isActiveItem(i));
  }
  get activeItemKey(): string {
    return this.activeItem?.key ?? "";
  }

  get hint(): string {
    return this.activeItem?.hint ?? "";
  }
  get help(): string {
    return this.activeItem?.help ?? "";
  }
  get breadcrumb(): string {
    const it = this.activeItem;
    if (!it) return "";
    return `${this.activeCategory.label} → ${this.activeTab.label} → ${it.label}`;
  }
  // Whether the armed tool fills the options slot (see the template's #options).
  get hasOptions(): boolean {
    return this.tool === "road" || this.tool === "parking" || this.tool === "facility";
  }
  get xsecTitle(): string {
    const dir = this.roadOneWay ? "one-way" : "per direction";
    const bus = this.roadIsBus ? " + bus lane" : "";
    return `Next drag lays: ${this.roadLaneCount} car lane${this.roadLaneCount > 1 ? "s" : ""} ${dir}${bus}`;
  }

  selectCategory(id: CategoryId) {
    this.cat = id;
    // Re-arm the tab's remembered item (or its first), so the highlighted dock
    // position always matches the armed tool.
    this.selectTab(this.tabByCat[id]);
  }

  selectTab(id: string) {
    this.tabByCat[this.cat] = id;
    const tab = this.activeTab;
    const remembered = this.itemByTab[`${this.cat}/${tab.id}`];
    const item = tab.items.find(i => i.key === remembered) ?? tab.items[0];
    if (item) this.selectItem(item);
  }

  selectItemByKey(key: string) {
    const item = this.activeTab.items.find(i => i.key === key);
    if (item) this.selectItem(item);
  }

  selectItem(item: DockItem) {
    if (item.terrain !== undefined) this.terrainBrush = item.terrain;
    if (item.stall !== undefined) this.stallKind = item.stall;
    if (item.heightDelta !== undefined) this.heightBrush = item.heightDelta;
    if (item.laneCount !== undefined) this.roadLaneCount = item.laneCount;
    if (item.signalMode !== undefined) this.signalModeArmed = item.signalMode;
    if (item.erase !== undefined) this.eraseScope = item.erase;
    this.itemByTab[`${this.cat}/${this.activeTabId}`] = item.key;
    this.setTool(item.tool);
  }
  // Provided so tile-level children (TileGround) can read their neighbours'
  // terrain without every view threading it through props.
  @Provide() level: Level = reactive(loadLevel());
  // Number of lanes per direction when the road tool is active (1/2/3).
  // Persisted in localStorage so it survives tool switches and page reloads.
  roadLaneCount = loadRoadLaneCount();
  // Whether the road tool draws bus-only lanes (cars cannot use them).
  roadIsBus = loadRoadIsBus();
  // Whether the road tool draws one-way roads (lanes only in the drawn
  // direction) rather than the default two-way road.
  roadOneWay = loadRoadOneWay();
  showIo = false;
  ioText = "";

  get routes(): TrainRoute[] {
    const d = this.depotIds;
    const out: TrainRoute[] = [];
    for (let i = 0; i + 1 < d.length; i += 2) out.push({ from: d[i], to: d[i + 1] });
    return out;
  }
  get depotIds(): string[] {
    return Object.keys(this.level).filter(id => this.level[id].role === "depot");
  }
  get valid(): ValidationResult {
    return validateLevel(this.level, this.routes);
  }
  get issueIds(): Set<string> {
    return new Set(
      this.valid.issues.map(i => i.tileId).filter((x): x is string => !!x)
    );
  }
  // True when the level has no depots and at least one road tile.
  get roadOnly(): boolean {
    return isRoadOnlyLevel(this.level);
  }
  // --- Camera ---------------------------------------------------------------
  // Same shared controller as the play board and the test stage. Built in
  // `created()` (a field initialiser would capture a throwaway `this`, see
  // cameraController.ts) and markRaw'd per CLAUDE.md.
  //
  // The editor draws with the mouse, so panning is deliberately kept to the
  // MIDDLE button and space-drag: a left-drag belongs to the connect tool
  // (edge dot -> edge dot), and stealing it would make the board unbuildable.
  private cam!: CameraController;

  // The route-drawing gesture (edge press/drag one-shot, click chaining with
  // the U-turn pending case, hover ghost preview) lives in a shared headless
  // controller so PlayView's in-play building reuses the exact same gesture.
  // Built in `created()` and markRaw'd for the same reasons as the camera.
  private routeCtrl!: RouteDrawController;

  created() {
    this.cam = markRaw(
      createCameraController(
        () => this.worldSize,
        () => this.viewportSize(),
        // The board is full-bleed; the drawer and the dock float over it. These
        // keep the GRID clear of them (see camera.ts). The bottom inset is
        // MEASURED off the live dock (three rows now, and taller again on a
        // phone) rather than assumed; the top only has the zoom cluster on a
        // narrow screen, so the board gets the space the play view spends on
        // its score card.
        () => {
          const wrap = document.querySelector(
            ".editor-view .build-dock-wrap",
          ) as HTMLElement | null;
          const bottom = wrap
            ? Math.min(Math.round(window.innerHeight * 0.5), wrap.offsetHeight + 26)
            : CHROME_INSETS.bottom;
          const narrow = window.matchMedia("(max-width: 700px)").matches;
          return {
            top: narrow ? 56 : 60,
            right: narrow ? 12 : CHROME_INSETS.right,
            bottom,
            left: narrow ? 12 : CHROME_INSETS.left,
          };
        },
      ),
    );
    this.routeCtrl = markRaw(
      createRouteDrawController({
        drawing: () => this.drawing,
        planOpts: () => this.routeOpts,
        // The editor commits CELL BY CELL — each step goes through `commit` so
        // bus gates re-derive and the level persists per tile, exactly as the
        // pre-extraction gesture did. (Play instead lays a whole route
        // atomically via `game.applyEdits`.)
        lay: steps => {
          for (const s of steps) {
            this.commit(s.id, this.layPair(this.cellOf(s.id), s.a, s.b));
          }
        },
      }),
    );
  }

  get camera(): Camera {
    return this.cam.state.camera;
  }
  get panning(): boolean {
    return this.cam.state.panning;
  }
  get levelTransform(): string {
    return this.cam.transform;
  }
  get worldSize(): Size {
    return {
      width: this.gridCols * this.config.tileSize,
      height: this.gridRows * this.config.tileSize,
    };
  }
  // A METHOD, not a getter: vue-facing-decorator turns a class getter into a
  // CACHED computed, and `$refs` is not reactive — so as a getter this was
  // evaluated once during the first render (before mount, `$refs` still empty),
  // cached the window fallback, and never invalidated. The camera then clamped
  // against the whole window instead of the viewport, and the bottom of a big
  // world became unreachable by exactly the chrome's height.
  viewportSize(): Size {
    const el = this.$refs.viewport as HTMLElement | undefined;
    return el
      ? { width: el.clientWidth, height: el.clientHeight }
      : { width: window.innerWidth, height: window.innerHeight };
  }

  fitWorld(): void {
    this.cam.fit();
  }
  onWindowResize(): void {
    this.cam.reclamp();
  }
  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
  }
  onViewportWheel(e: WheelEvent): void {
    this.cam.onWheel(e, this.$refs.viewport as HTMLElement | undefined);
  }
  // Space held = "pan mode", the convention every drawing tool uses.
  spaceHeld = false;

  onViewportPointerDown(e: PointerEvent): void {
    if (e.button !== 1 && !(e.button === 0 && this.spaceHeld)) return;
    e.preventDefault();
    this.cam.onPointerDown(e);
  }

  onEditorKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space" && !this.spaceHeld) {
      this.spaceHeld = true;
      // Stop the page scrolling under the board while space is the pan modifier.
      e.preventDefault();
    }
  }
  onEditorKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") this.spaceHeld = false;
  }
  onViewportPointerMove(e: PointerEvent): void {
    this.cam.onPointerMove(e);
  }
  onViewportPointerUp(e: PointerEvent): void {
    this.cam.onPointerUp(e);
  }

  // The editor grid sizes to the level's own content (so a larger loaded level —
  // a /test scenario handed over for correction, or the 20x14 demo world — stays
  // fully editable), plus a margin of empty cells to draw into.
  //
  // That margin is what makes the world unbounded: paint into it and the content
  // grows, so next render the margin has moved out again. There is no maximum
  // board size anywhere — the old 7x6 was a rendering cap, not an engine one.
  // Growing UP and LEFT is `growLeft`/`growUp` below, since the engine anchors
  // the world at 0,0.
  get gridCols(): number {
    return levelBounds(this.level, { cols: this.config.levelSizeX, rows: this.levelSizeY }).cols + GROW_MARGIN;
  }
  get gridRows(): number {
    return levelBounds(this.level, { cols: this.config.levelSizeX, rows: this.levelSizeY }).rows + GROW_MARGIN;
  }

  // Make room before the origin by shifting everything that is already there.
  // The alternative — negative coordinates — would have to be understood by
  // `roadEntries`' off-grid test, the generator and the validator alike, so the
  // world is re-based instead and they keep their "the world starts at 0,0"
  // assumption. Trains move with it or they end up off their depots.
  growLeft(): void {
    this.growBy(1, 0);
  }
  growUp(): void {
    this.growBy(0, 1);
  }
  private growBy(dx: number, dy: number): void {
    const moved = translateLevel(this.level, dx, dy);
    for (const key of Object.keys(this.level)) delete this.level[key];
    Object.assign(this.level, moved);
    // The re-base moved every tile out from under the gesture's ids.
    this.routeCtrl.dropAnchors();
  }

  get gridCells(): { key: string; tile: Level[string] | null }[] {
    const out: { key: string; tile: Level[string] | null }[] = [];
    for (let y = 0; y < this.gridRows; y++) {
      for (let x = 0; x < this.gridCols; x++) {
        const key = `${x},${y}`;
        const tile = this.level[key];
        const drawable = tile && (tile.connections.length || tile.road?.length);
        out.push({ key, tile: drawable ? tile : null });
      }
    }
    return out;
  }

  // --- geometry helpers (overlay) ---
  dot(port: Port): { x: number; y: number } {
    const size = this.config.tileSize;
    const c = size / 2;
    const inset = 16;
    switch (port) {
      case Position.Top:
        return { x: c, y: inset };
      case Position.Right:
        return { x: size - inset, y: c };
      case Position.Bottom:
        return { x: c, y: size - inset };
      default:
        return { x: inset, y: c };
    }
  }
  // The triangular hit-zone for one edge: from that edge's two corners to the
  // tile centre, so every point in the tile maps to exactly one edge.
  zonePath(port: Port): string {
    const s = this.config.tileSize;
    const c = s / 2;
    switch (port) {
      case Position.Top:
        return `M0 0 L${s} 0 L${c} ${c} Z`;
      case Position.Right:
        return `M${s} 0 L${s} ${s} L${c} ${c} Z`;
      case Position.Bottom:
        return `M${s} ${s} L0 ${s} L${c} ${c} Z`;
      default:
        return `M0 ${s} L0 0 L${c} ${c} Z`;
    }
  }
  // A port's reference point: the edge dot, or the tile centre for Center.
  portPoint(port: Port): { x: number; y: number } {
    const c = this.config.tileSize / 2;
    return port === Position.Center ? { x: c, y: c } : this.dot(port);
  }
  // Place a rail's delete handle between its two ports, nudged toward the first
  // port so crossing rails (e.g. a cross tile) get separate, tappable handles.
  delPos(conn: PortPair): { x: number; y: number } {
    const a = this.portPoint(conn[0]);
    const b = this.portPoint(conn[1]);
    return { x: (a.x + b.x) / 2 + 0.3 * (a.x - b.x) / 2, y: (a.y + b.y) / 2 + 0.3 * (a.y - b.y) / 2 };
  }
  delMark(conn: PortPair): string {
    const { x, y } = this.delPos(conn);
    const r = 6;
    return `M${x - r} ${y - r} L${x + r} ${y + r} M${x + r} ${y - r} L${x - r} ${y + r}`;
  }
  isArmed(id: string, port: Port): boolean {
    return this.routeCtrl.isArmed(id, port);
  }
  // The open-end wedge that finishes the route when clicked again — highlighted
  // distinctly while routing so it's obvious where to stop.
  isFinish(id: string, port: Port): boolean {
    return this.routeCtrl.isFinish(id, port);
  }
  // In-progress press released off the zones (grid mouseup / mouseleave).
  clearPress(): void {
    this.routeCtrl.clearPress();
  }
  get routeOpts() {
    // Water and rock are not buildable, so the planner routes AROUND them —
    // which is the whole point of terrain having rules. One predicate
    // (`canBuildOn`) is shared with the validator so a preview can never offer
    // a route the level would then be flagged for.
    return {
      width: this.gridCols,
      height: this.gridRows,
      passable: (c: Coordinates) => canBuildOn(this.level[getCoordinatesId(c)]),
      // Water is crossable on a structure: the route may span it, and
      // `addConnection` marks what it lays as a bridge.
      bridgeable: (c: Coordinates) => needsBridge(this.level[getCoordinatesId(c)]),
      // Rock and mountain are borable: the route may pass under them, and
      // `addConnection` marks what it lays as a tunnel.
      tunnelable: (c: Coordinates) => needsTunnel(this.level[getCoordinatesId(c)]),
    };
  }

  // The layer the route-builder is currently drawing on. `connect` lays rail
  // `connections`, `road` lays the `road` layer — both share the exact same
  // edge-zone routing (planRoute, curves, drag/click chaining); only the lay
  // function and the preview style differ.
  get drawing(): "rail" | "road" | null {
    return this.tool === "connect" ? "rail" : this.tool === "road" ? "road" : null;
  }
  // Lay a port pair on the active layer, returning the new cell.
  layPair(cell: Level[string], a: Port, b: Port): Level[string] {
    if (this.drawing === "road") {
      // Same reason as deleteRoad: redrawing a two-way street as one-way (or over
      // a straight to make it a bend) can leave a row on an approach that no
      // longer supports it.
      return pruneParkingRows(
        addRoad(
          cell,
          a,
          b,
          this.roadLaneCount,
          this.roadIsBus ? 1 : 0,
          this.roadOneWay,
        ),
      );
    }
    return addConnection(cell, a, b);
  }
  // The CSS class for the ghost preview, so a road previews as a road ribbon.
  get previewClass(): string {
    return this.drawing === "road" ? "preview-road" : "preview-rail";
  }
  // Ghost rails for the whole previewed route, keyed by cell id. The
  // controller decides WHICH connections the pointer is describing (anchor
  // inclusion, U-turn trimming); mapping them to paint — rail pair vs road
  // ribbon — is this view's layer choice, like `layPair`.
  get previewByCell(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const size = this.config.tileSize;
    const off = this.config.railDistanceFromPath;
    for (const s of this.routeCtrl.previewSteps()) {
      const paths =
        this.drawing === "road"
          ? [roadSurfacePath(s.a, s.b, size)]
          : railPathsFor(s.a, s.b, size, off);
      (out[s.id] ??= []).push(...paths);
    }
    return out;
  }
  previewRails(id: string): string[] {
    return this.previewByCell[id] ?? [];
  }
  hasSignal(tile: Level[string] | null, port: Port): boolean {
    return !!tile?.signals?.includes(port);
  }

  // --- junction switches (authored starting direction) ---
  // Entry ports of a junction tile that carry a switch. Empty for plain track.
  junctionEntries(tile: Level[string] | null): Port[] {
    if (!tile) return [];
    return portsOf(tile.connections).filter(p =>
      isJunctionEntry(tile.connections, p)
    );
  }
  // The hub of an entry's switch fan, in tile (overlay) coordinates. Must track
  // `SWITCH_INSET` in Tile.vue: the fan's hub sits that far inside its own edge,
  // centred on it. This is where the editor paints its own zone — Tile.vue's fan
  // is passed `switch-interactive="false"` here, so it draws the authored arm
  // and this zone owns the click.
  switchPoint(entry: Port): { x: number; y: number } {
    const s = this.config.tileSize;
    const c = s / 2;
    const d = SWITCH_HUB_INSET;
    switch (entry) {
      case Position.Top:
        return { x: c, y: d };
      case Position.Right:
        return { x: s - d, y: c };
      case Position.Bottom:
        return { x: c, y: s - d };
      default:
        return { x: d, y: c }; // Left
    }
  }
  // Clicking a switch zone cycles that entry's authored starting arm and persists.
  // The zone is painted in front of the edge zones, so it intercepts the click.
  onSwitchClick(id: string, entry: Port) {
    this.commit(id, cycleDefaultArm(this.cellOf(id), entry));
  }
  // Mirror the level's effective starting arms into the (stub) game so Tile.vue's
  // switch widget lights the authored bulb — the same seeding play uses.
  @Watch("roadLaneCount")
  saveRoadLaneCount(v: number) {
    try { localStorage.setItem(LANE_COUNT_KEY, String(v)); } catch { /* ignore */ }
  }

  @Watch("roadIsBus")
  saveRoadIsBus(v: boolean) {
    try { localStorage.setItem(ROAD_BUS_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  }

  @Watch("roadOneWay")
  saveRoadOneWay(v: boolean) {
    try { localStorage.setItem(ROAD_ONEWAY_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  }

  // Max per-direction lane count across all edges of a tile (for the badge).
  roadTileLaneCount(tile: Level[string] | null): number {
    if (!tile?.road?.length) return 0;
    const counts = laneEdges(tile.road).flatMap(([a, b]) => [
      laneCount(tile.road, a),
      laneCount(tile.road, b),
    ]).filter(n => n > 0);
    return counts.length ? Math.max(...counts) : 0;
  }

  @Watch("level", { deep: true, immediate: true })
  syncSwitches() {
    const next = initialSwitches(this.level);
    const switches = this.game.switches;
    for (const k of Object.keys(switches)) delete switches[k];
    Object.assign(switches, next);
  }

  cellOf(id: string): Level[string] {
    return this.level[id] ?? emptyCell();
  }
  commit(id: string, cell: Level[string]) {
    // `isBlankCell` rather than "no connections/signals/road": a cell carrying
    // only TERRAIN is a real cell (a lake tile has no track and no road), and
    // the older test deleted it the instant the brush painted it.
    if (isBlankCell(cell)) {
      delete this.level[id];
    } else {
      this.level[id] = cell;
    }
    // Bus gates are DERIVED state: whatever the edit was (road tool, lane click,
    // a delete), the junctions around it re-derive their busTo gates so they can
    // never go stale against the streets they face.
    this.syncBusGates([id]);
    this.persist();
  }
  // Re-derive every junction around `ids` — car lane movements from the
  // arms' widths (capacity rule) first, busTo gates second — and write the
  // changed cells straight into the level (not via commit — no recursion).
  syncBusGates(ids: string[]) {
    const synced = syncJunctionLanesAround(this.level, ids, true);
    for (const [gid, gcell] of Object.entries(synced)) this.level[gid] = gcell;
  }

  // The tile to glow: the pending frontier tile (U-turn case) while routing,
  // otherwise the head/last tile, else the start.
  get glowId(): string | null {
    return this.routeCtrl.glowId;
  }
  finishRoute() {
    this.routeCtrl.finishRoute();
  }

  // --- connect/road tool: the route-drawing gesture ---
  // Drag one-shot, click chaining (with the U-turn pending case) and the hover
  // ghost all live in routeDrawController; the view only forwards the edge-zone
  // events. The signal tool shares the zones, so its click is peeled off here.
  onZoneDown(id: string, port: Port) {
    this.routeCtrl.onZoneDown(id, port);
  }
  onZoneUp(id: string, port: Port) {
    this.routeCtrl.onZoneUp(id, port);
  }
  onZoneClick(id: string, port: Port) {
    if (this.tool === "signal") {
      this.commit(id, toggleSignalPort(this.cellOf(id), port));
      return;
    }
    this.routeCtrl.onZoneClick(id, port);
  }
  onZoneEnter(id: string, port: Port) {
    this.routeCtrl.onZoneEnter(id, port);
  }
  onZoneLeave(id: string, port: Port) {
    this.routeCtrl.onZoneLeave(id, port);
  }
  deleteConn(id: string, conn: PortPair) {
    this.commit(id, removeConnection(this.cellOf(id), conn[0], conn[1]));
  }
  // Undirected road edges of a cell (one PortPair per a<->b edge the lanes
  // touch), so the editor shows a single delete handle per road segment.
  roadEdges(tile: Level[string]): PortPair[] {
    return laneEdges(tile.road);
  }
  deleteRoad(id: string, road: PortPair) {
    // Prune any parking row the removed road no longer supports. A row is keyed
    // to an approach, so ripping out the street under it would otherwise orphan
    // it — and the validator would then fire on a tile the author never touched
    // with the parking tool.
    this.commit(id, pruneParkingRows(removeRoad(this.cellOf(id), road[0], road[1])));
  }

  // --- bus-lane tool: per-lane hit paths -------------------------------------
  // One invisible, wide-stroke hit path per road lane of a tile, traced along the
  // lane's real centreline (offset right-of-travel so adjacent lanes are
  // distinguishable), with the lane's identity (approach `from` + `index`) and
  // current bus state. Mirrors Tile.vue's lane overlay closely enough to click the
  // right lane; an exact-geometry trace isn't needed for hit-testing. Junction
  // tiles are excluded — a run never paints through one, so their lanes aren't
  // individually clickable here (Ctrl-click a straight/curve lane instead).
  laneHits(id: string): { d: string; from: Port; index: number; isBus: boolean; isCycle: boolean }[] {
    const tile = this.level[id];
    if (!tile?.road?.length || isRoadJunction(tile.road)) return [];
    const size = this.config.tileSize;
    const out: { d: string; from: Port; index: number; isBus: boolean; isCycle: boolean }[] = [];
    const seen = new Set<string>();
    for (const lane of tile.road) {
      // One hit path per physical lane (its single through exit). A lane with
      // several exits is a junction movement and is skipped above; defensively
      // take the first exit as the centreline to trace.
      const to = lane.to[0];
      if (to == null) continue;
      const key = `${lane.from}:${lane.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Lateral offset (px, right-of-travel) for this lane: same formula as the
      // renderer/overlay — (band - 0.5 - index)·LANE·size, 0 = kerb. Using the
      // tile's own both-direction band keeps the path on the lane the car drives.
      const band = laneCountAt(tile.road, lane.from) / 2;
      // A cycle lane's visible strip is half-width, kerb-aligned — put the hover
      // highlight on the green, a quarter-lane kerbward of the slot centre.
      const cycleShift = lane.kind === "cycle" ? 0.25 * LANE_WIDTH_PX_FRAC * size : 0;
      const off = (band - 0.5 - lane.index) * LANE_WIDTH_PX_FRAC * size + cycleShift;
      out.push({
        d: laneSegmentPathD(lane.from, to, size, off, off),
        from: lane.from,
        index: lane.index,
        isBus: lane.kind === "bus",
        isCycle: lane.kind === "cycle",
      });
    }
    return out;
  }
  // Click a lane: Ctrl/Meta toggles only this tile's lane; a plain click paints
  // the whole street run to one uniform kind, committed as one level update.

  // --- Parking tool ----------------------------------------------------------

  // What the parking tool lays: the armed stall kind plus any reservation.
  get rowSpec(): RowSpec {
    return {
      kind: this.stallKind,
      ...(this.parkReserved ? { reserved: this.parkReserved } : {}),
    };
  }

  // One invisible hit strip per physical KERB of a straight road tile — literally
  // the pixels the bays will cover, so you click where the parking goes.
  //
  // Not a tile edge and not a lane: a kerb. An edge wedge names a DIRECTION and
  // covers the carriageway too, and on a two-way street the two kerbs are reached
  // from different approaches — so `(approach, side)` is the natural key, and
  // deduplicating by `bankFor` is what stops a two-way street offering four hits
  // for its two kerbs (and with them, two rows painted into one strip of tarmac).
  kerbHits(id: string): {
    d: string;
    from: Port;
    side: "right" | "left";
    bank: Port;
    ok: boolean;
    has: boolean;
  }[] {
    const tile = this.level[id];
    if (!tile?.road?.length || isRoadJunction(tile.road)) return [];
    const size = this.config.tileSize;
    const coord = parseCoordId(id);
    const out: {
      d: string;
      from: Port;
      side: "right" | "left";
      bank: Port;
      ok: boolean;
      has: boolean;
    }[] = [];
    const byBank = new Map<Port, number>();
    for (const from of EDGES) {
      if (!tile.road.some(l => l.from === from)) continue;
      for (const side of ["right", "left"] as const) {
        if (!canParkOn(tile, from, side) && !parkingRowAt(tile, from, side)) continue;
        const bank = bankFor(from, side);
        const ok = canParkOn(tile, from, side) && this.kerbFits(id, from);
        const has = !!parkingRowAt(tile, from, side);
        const kerb = kerbOffsetAt(this.level, coord, from, size);
        const depth = stallDepthPx(this.stallKind, size, needsBigBay(this.parkReserved));
        const f = rowFrame({ from, side, kind: this.stallKind, count: 1 }, size);
        const d =
          "M " +
          [
            f.at(0, kerb),
            f.at(size, kerb),
            f.at(size, kerb + Math.max(depth, size * 0.11)),
            f.at(0, kerb + Math.max(depth, size * 0.11)),
          ]
            .map(p => `${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`)
            .join(" L ") +
          " Z";
        // One hit per physical kerb, preferring the legal spelling of it.
        const prev = byBank.get(bank);
        if (prev !== undefined) {
          if (ok && !out[prev].ok) out[prev] = { d, from, side, bank, ok, has };
          continue;
        }
        byBank.set(bank, out.length);
        out.push({ d, from, side, bank, ok, has });
      }
    }
    return out;
  }

  // The half of legality that needs the NEIGHBOURS, mirroring validateParking's
  // own arithmetic so the editor can never author a level it would then flag.
  kerbFits(id: string, from: Port): boolean {
    const coord = parseCoordId(id);
    const size = this.config.tileSize;
    // A tapering tile moves its kerb across its own length, so a row sized against
    // one end sits under the running lane at the other.
    const [a, b] = kerbOffsetEnds(this.level, coord, from, size);
    if (Math.abs(a - b) > 0.5) return false;
    // And the bays have to land on the tile rather than in the neighbour's garden.
    // This is what greys both kerbs of a wide street when 90° bays are armed —
    // the honest teaching moment: kerb parking caps at a 2+2 arterial.
    const kerb = kerbOffsetAt(this.level, coord, from, size);
    return kerb + stallDepthPx(this.stallKind, size, needsBigBay(this.parkReserved))
      <= size / 2 + 0.5;
  }

  onKerbClick(
    ev: MouseEvent,
    id: string,
    k: { from: Port; side: "right" | "left"; ok: boolean; has: boolean },
  ) {
    // A greyed kerb refuses rather than silently doing nothing — except to CLEAR
    // a row that is already there, which must always be possible.
    if (!k.ok && !k.has) return;
    const size = this.config.tileSize;
    // Ctrl/Cmd narrows the edit to this one tile. `toggleParkingRow` rather than a
    // bare set, so it behaves like the run does: a DIFFERENT kind replaces what is
    // there, and only clicking the kind already on the kerb takes it off. Clearing
    // on any repeat click would mean two clicks to change a single tile's kind.
    const changed =
      ev.ctrlKey || ev.metaKey
        ? { [id]: toggleParkingRow(this.cellOf(id), k.from, k.side, this.rowSpec, size) }
        : setParkingRowRun(this.level, id, k.from, k.side, this.rowSpec, size);
    for (const [cid, cell] of Object.entries(changed)) this.commit(cid, cell);
  }

  // The bays the armed kind WOULD lay on the hovered kerb, drawn with the very
  // function that paints the real thing — so the ghost can never promise a shape
  // the tile would not actually get.
  ghostBays(id: string): string[] {
    if (this.tool !== "parking" || this.hoverKerb?.id !== id) return [];
    const hit = this.kerbHits(id).find(k => k.bank === this.hoverKerb!.bank);
    if (!hit || !hit.ok || hit.has) return [];
    const size = this.config.tileSize;
    const kerb = kerbOffsetAt(this.level, parseCoordId(id), hit.from, size);
    const row = {
      from: hit.from,
      side: hit.side,
      kind: this.stallKind,
      count: maxStallsPerTile(this.stallKind, size, needsBigBay(this.parkReserved)),
      ...(this.parkReserved ? { reserved: this.parkReserved } : {}),
    } as const;
    if (this.stallKind === "garage") {
      const g = garageGeometry(row, size, kerb, "in");
      const o = garageGeometry(row, size, kerb, "out");
      return [g.apron, o.apron];
    }
    return Array.from({ length: row.count }, (_, i) =>
      stallOutlinePath(row, i, size, kerb),
    );
  }

  // --- Facility tool ---------------------------------------------------------

  onFacilityDown(ev: MouseEvent, id: string) {
    if (this.tool !== "facility") return;
    this.facilityPainting = true;
    const cur = this.level[id]?.parking?.facility;
    // The first tile decides the whole stroke: already this car park → remove,
    // otherwise add. Dragging over a mixed row then makes it uniform rather than
    // inverting each tile under the cursor.
    this.facilityTarget = cur === this.facilityId ? undefined : this.facilityId;
    this.paintFacility(id);
  }

  onFacilityEnter(ev: MouseEvent, id: string) {
    if (this.tool !== "facility" || !this.facilityPainting) return;
    // Live re-check of the button: a mouseup swallowed by another element (the
    // kerb hits stop propagation) would otherwise leave the brush stuck down.
    if (!(ev.buttons & 1)) {
      this.facilityPainting = false;
      return;
    }
    this.paintFacility(id);
  }

  stopFacilityPainting = () => {
    this.facilityPainting = false;
  };

  paintFacility(id: string) {
    const cell = this.level[id];
    if (!cell) return;
    const next = setFacility(cell, this.facilityTarget);
    if (next !== cell) this.commit(id, next);
  }

  // A stable colour per car park, so two adjacent ones read as different.
  facilityTint(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return `hsla(${h % 360}, 70%, 55%, 0.32)`;
  }

  // Bump P1 → P2 → … so a second car park is one click away.
  nextFacilityId() {
    const m = /^(.*?)(\d+)$/.exec(this.facilityId);
    this.facilityId = m ? `${m[1]}${Number(m[2]) + 1}` : `${this.facilityId}2`;
  }

  // The four lane tools share the per-lane hit paths.
  get laneToolActive(): boolean {
    return (
      this.tool === "buslane" ||
      this.tool === "bikelane" ||
      this.tool === "laneadd" ||
      this.tool === "laneremove"
    );
  }

  onLaneClick(ev: MouseEvent, id: string, from: Port, index: number) {
    // Four lane tools share the hit paths: 🚌 toggles bus ↔ normal in place;
    // 🚲 adds/removes the kerb-side green lane and ➕/➖ step the STREET's
    // car-lane count (1L ↔ 2L ↔ 3L) — both of those act on BOTH directions
    // together, because the road markings cannot draw an asymmetric street.
    // Ctrl/Meta acts on one tile, a plain click on the whole street run.
    const single = ev.ctrlKey || ev.metaKey;
    const changed =
      this.tool === "bikelane"
        ? single
          ? { [id]: toggleCycleLane(this.cellOf(id), from) }
          : toggleCycleLaneRun(this.level, id, from, index)
        : this.tool === "laneadd"
          ? single
            ? { [id]: addStreetLane(this.cellOf(id), from) }
            : addStreetLaneRun(this.level, id, from, index)
          : this.tool === "laneremove"
            ? single
              ? { [id]: removeStreetLane(this.cellOf(id), from) }
              : removeStreetLaneRun(this.level, id, from, index)
            : single
              ? { [id]: toggleBusLane(this.cellOf(id), from, index) }
              : setBusLaneRun(this.level, id, from, index);
    // commit re-derives the adjoining junctions' busTo gates per tile.
    for (const [cid, cell] of Object.entries(changed)) this.commit(cid, cell);
  }

  // --- terrain brush (cell-level drag-to-paint) ---
  // Painting an AREA is the natural gesture for ground, so the brush tracks its
  // own press instead of the edge-to-edge gesture the connect tool uses. Space
  // is the pan modifier everywhere in this editor, so it wins over the brush.
  onTerrainDown(ev: MouseEvent, id: string) {
    if (this.tool !== "terrain" || ev.button !== 0 || this.spaceHeld) return;
    this.terrainPainting = true;
    this.paintTerrain(id);
  }
  onTerrainEnter(ev: MouseEvent, id: string) {
    if (this.tool !== "terrain" || !this.terrainPainting) return;
    // `buttons` is the LIVE state of the physical mouse buttons, so this paints
    // only while one is actually held. The flag alone was not enough: a mouseup
    // swallowed by another handler (the edge zones use `@mouseup.stop`, and the
    // camera takes pointer capture) leaves it stuck true, and from then on every
    // tile the cursor merely passes over gets painted.
    if ((ev.buttons & 1) === 0) {
      this.terrainPainting = false;
      return;
    }
    this.paintTerrain(id);
  }
  // An arrow-function FIELD, not a method: it is handed to window.addEventListener,
  // where a prototype method would be invoked with `this` bound to the window.
  // Same pattern as `onKeydown` below, and it keeps the reference stable so
  // removeEventListener actually matches.
  @Watch("stallKind")
  onStallKindChange(v: StallKind) {
    localStorage.setItem(PARK_KIND_KEY, v);
  }
  @Watch("parkReserved")
  onParkReservedChange(v: StallReservation | undefined) {
    if (v) localStorage.setItem(PARK_RESERVED_KEY, v);
    else localStorage.removeItem(PARK_RESERVED_KEY);
  }
  @Watch("facilityId")
  onFacilityIdChange(v: string) {
    localStorage.setItem(PARK_FACILITY_KEY, v);
  }

  stopTerrainPainting = () => {
    this.terrainPainting = false;
  };
  stopHeightPainting = () => {
    this.heightPainting = false;
    this.heightStroke.clear();
  };

  // --- height brush (cell-level drag-to-paint, once per cell per stroke) ---
  onHeightDown(ev: MouseEvent, id: string) {
    if (this.tool !== "height" || ev.button !== 0 || this.spaceHeld) return;
    this.heightPainting = true;
    this.heightStroke.clear();
    this.paintHeight(id);
  }
  onHeightEnter(ev: MouseEvent, id: string) {
    if (this.tool !== "height" || !this.heightPainting) return;
    // Same live-buttons guard as the terrain brush: a swallowed mouseup must
    // not leave the brush stuck on.
    if ((ev.buttons & 1) === 0) {
      this.stopHeightPainting();
      return;
    }
    this.paintHeight(id);
  }
  paintHeight(id: string) {
    if (this.heightStroke.has(id)) return;
    this.heightStroke.add(id);
    const cur = this.level[id] ?? emptyCell();
    const next = shiftHeight(cur, this.heightBrush);
    if (next === cur || next.height === cur.height) return; // clamped: no-op
    // Lowering the last thing a cell carried removes it entirely, exactly like
    // painting grass over bare terrain.
    if (isBlankCell(next)) {
      delete this.level[id];
      this.persist();
      return;
    }
    this.commit(id, next);
  }
  paintTerrain(id: string) {
    const cur = this.level[id] ?? emptyCell();
    if ((cur.terrain ?? "grass") === this.terrainBrush) return; // no-op repaint
    const next = setTerrain(cur, this.terrainBrush);
    // Refuse to flood a tile that already carries a line. Allowing it would let
    // a single drag quietly invalidate half a level, and the validator would
    // then report a problem the player never chose to create. Clear the track
    // first if you really want water there.
    const carriesLine = cur.connections.length > 0 || (cur.road?.length ?? 0) > 0;
    if (carriesLine && !canBuildOn(next)) return;
    // Painting grass over a cell that carried nothing else removes it entirely,
    // rather than leaving a blank entry behind that still counts towards the
    // level's bounds.
    if (isBlankCell(next)) {
      delete this.level[id];
      this.persist();
      return;
    }
    this.commit(id, next);
  }

  // --- depot / erase (cell-level click) ---
  onCellClick(id: string) {
    if (this.tool === "depot") {
      const cur = this.level[id];
      this.commit(id, cur?.role === "depot" ? rotateDepot(cur) : setDepot(emptyCell(), this.autoFacing(id)));
    } else if (this.tool === "station") {
      // Toggle the station role on through-track. toggleStation hands back the
      // SAME cell when it can't apply (no track, or a depot), so nothing is
      // committed for a click that changed nothing.
      const cur = this.level[id];
      if (cur) {
        const next = toggleStation(cur);
        if (next !== cur) this.commit(id, next);
      }
    } else if (this.tool === "erase") {
      if (this.eraseScope === "all") {
        delete this.level[id];
        this.syncBusGates([id]); // an erased bus street un-gates its junctions
        this.persist();
        return;
      }
      // Layer-scoped bulldozer: remove one layer, keep the rest standing.
      // commit() drops the cell when nothing is left and re-derives bus gates.
      const cur = this.level[id];
      if (cur) {
        const next = eraseLayer(cur, this.eraseScope);
        if (next !== cur) this.commit(id, next);
      }
    } else if (this.tool === "signalise") {
      // Apply the ARMED traffic-light mode to the junction (no-op off a
      // junction, and a repeat application changes nothing).
      const cur = this.level[id];
      if (cur) {
        const next = setJunctionSignalMode(cur, this.signalModeArmed);
        if (next !== cur) this.commit(id, next);
      }
    } else if (this.tool === "flyover") {
      // Cycle which line rides the deck (no-op off a diamond crossing).
      const cur = this.level[id];
      if (cur) this.commit(id, cycleFlyover(cur));
    }
  }
  // Face the first neighbour that already has track on the shared border.
  autoFacing(id: string): Port {
    const coord = parseCoordId(id);
    for (const e of EDGES) {
      const n = this.level[getCoordinatesId(neighborCoord(coord, e)!)];
      if (n && portsOf(n.connections).includes(oppositePort(e))) return e;
    }
    return Position.Top;
  }

  // --- drawer / dock actions ---
  get themeIcon(): string {
    return themeMeta(this.config.worldTheme).icon;
  }
  cycleTheme() {
    setWorldTheme(nextTheme(this.config.worldTheme));
  }
  setTool(t: Tool) {
    this.tool = t;
    // Keep the open category + tab honest even when a tool is armed without
    // going through the dock (a hand-off, a shortcut).
    const loc = LOCATION_OF_TOOL.get(t);
    if (loc) {
      this.cat = loc.cat;
      this.tabByCat[loc.cat] = loc.tab;
    }
    this.routeCtrl.toolChanged();
  }
  onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      this.finishRoute();
      return;
    }
    // 1–4 switch dock categories. Not while typing (the facility id, the
    // import box) and not under a modifier (browser shortcuts stay theirs).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const idx = ["1", "2", "3", "4"].indexOf(e.key);
    if (idx >= 0) this.selectCategory(DOCK[idx].id);
  };
  mounted() {
    window.addEventListener("keydown", this.onKeydown);
    window.addEventListener("keydown", this.onEditorKeyDown);
    window.addEventListener("keyup", this.onEditorKeyUp);
    window.addEventListener("resize", this.onWindowResize);
    // On WINDOW, not the board: a paint drag that ends off the grid (or outside
    // the app) must still release the brush, or the next hover keeps painting.
    window.addEventListener("mouseup", this.stopTerrainPainting);
    window.addEventListener("mouseup", this.stopFacilityPainting);
    window.addEventListener("mouseup", this.stopHeightPainting);
    // Frame the board before the first paint: a big level would otherwise open
    // on its top-left corner.
    this.$nextTick(() => this.fitWorld());
    // Self-heal: levels saved before a gate-affecting edit path existed (or
    // edited externally) may carry stale busTo gates — re-derive them all once.
    this.syncBusGates(Object.keys(this.level));
    this.persist();
  }
  unmounted() {
    window.removeEventListener("keydown", this.onKeydown);
    window.removeEventListener("keydown", this.onEditorKeyDown);
    window.removeEventListener("keyup", this.onEditorKeyUp);
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("mouseup", this.stopTerrainPainting);
    window.removeEventListener("mouseup", this.stopHeightPainting);
  }
  clearAll() {
    for (const k of Object.keys(this.level)) delete this.level[k];
    this.persist();
  }
  randomMap() {
    const seed = Math.floor(Math.random() * 1e9);
    const { level } = generateLevel(seed, {
      width: this.config.levelSizeX,
      height: this.levelSizeY,
      depotPairs: 2,
    });
    for (const k of Object.keys(this.level)) delete this.level[k];
    Object.assign(this.level, level);
    this.persist();
  }
  // Hand the level over and go. No gate: a board with no depot pair simply
  // starts with no trains (a road-only or half-built world is still playable to
  // walk around), and validation issues are shown in the drawer, not enforced.
  playThis() {
    setCustomLevel({
      level: JSON.parse(JSON.stringify(this.level)),
      trains: trainsFromRoutes(this.routes),
    });
    // Pin the mode rather than reopening the last one played. /play otherwise
    // runs whatever mode was used last, and a board-GENERATING mode (Daily
    // derives its map from the date and ignores the context board) would throw
    // the level away — you press Play on your own world and land on someone
    // else's. Sandbox is the mode whose job is "this board, no objective".
    this.$router.push({ path: "/play", query: { mode: "sandbox" } });
  }
  exportJson() {
    this.ioText = JSON.stringify(this.level);
    this.showIo = true;
  }
  importJson() {
    this.ioText = "";
    this.showIo = true;
  }
  onIoBlur() {
    if (!this.ioText.trim()) {
      this.showIo = false;
      return;
    }
    try {
      const parsed = JSON.parse(this.ioText) as Level;
      for (const k of Object.keys(this.level)) delete this.level[k];
      Object.assign(this.level, parsed);
      this.syncBusGates(Object.keys(this.level)); // imported gates may be stale
      this.persist();
      this.showIo = false;
    } catch {
      // leave the box open so the user can fix invalid JSON
    }
  }
  persist() {
    try {
      localStorage.setItem(LEVEL_KEY, JSON.stringify(this.level));
    } catch {
      /* ignore */
    }
  }
}

function loadLevel(): Level {
  // A scenario "Edit" hand-off takes priority over the saved editor level: open
  // straight onto the map being corrected (consumed once, so a later plain visit
  // restores the user's own work).
  const seed = takeEditorSeed();
  if (seed) return seed;
  try {
    const raw = localStorage.getItem(LEVEL_KEY);
    if (raw) return migrateLevel(JSON.parse(raw) as Level);
  } catch {
    /* ignore */
  }
  return {};
}

function loadRoadLaneCount(): number {
  try {
    const v = parseInt(localStorage.getItem(LANE_COUNT_KEY) ?? "1");
    return [1, 2, 3].includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

function loadRoadIsBus(): boolean {
  try {
    return localStorage.getItem(ROAD_BUS_KEY) === "1";
  } catch {
    return false;
  }
}

function loadRoadOneWay(): boolean {
  try {
    return localStorage.getItem(ROAD_ONEWAY_KEY) === "1";
  } catch {
    return false;
  }
}

export default toNative(EditorView);
</script>

<style lang="scss" scoped>
.level {
  display: grid;
  border: 1px solid green;
  // Positioned by the camera inside `.world-viewport` (see cameraController.ts):
  // the camera owns the offset, so no `margin: auto` to fight it, and the
  // transform origin must be the corner its maths is expressed from.
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}
.editor-grid {
  // A very light green ground so empty cells read as part of the board rather
  // than stark white (which made the armed-tile cue invisible on fresh cells).
  background: #eef7f0;
}
.editor-grid .level-tile {
  position: relative;
  flex: 0 0 auto;
  outline: 1px solid #ddd;
  cursor: crosshair;
  transition: box-shadow 0.15s ease;
}
// While an edge is armed, give just that tile a soft, gently pulsing glow so
// the child sees which one they're building on — no dimming of the rest.
.editor-cell--armed {
  z-index: 5;
  animation: armed-pulse 1.3s ease-in-out infinite alternate;
}
@keyframes armed-pulse {
  from {
    box-shadow:
      0 0 0 2px rgba(255, 179, 0, 0.55),
      0 0 9px 2px rgba(255, 179, 0, 0.28);
  }
  to {
    box-shadow:
      0 0 0 3px rgba(255, 179, 0, 0.85),
      0 0 16px 4px rgba(255, 179, 0, 0.5);
  }
}
.editor-cell--issue {
  outline: 2px solid #ff3b30 !important;
}
// Tile is visual only; the overlay handles all interaction.
.editor-cell :deep(.tile) {
  pointer-events: none;
}
.overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 30;
}
// Edge hit-zones: faint by default so the rail art shows through, brighter on
// hover, solid amber when armed for the click → click connection flow.
.zone {
  // Near-invisible fill keeps the wedge clickable; the inner-edge outlines are
  // hidden by default and only revealed while hovering the tile (below).
  fill: rgba(66, 184, 131, 0.05);
  stroke: none;
  cursor: pointer;
  transition: fill 0.08s;
  &:hover {
    fill: rgba(66, 184, 131, 0.28);
  }
}
// Show the wedge (inner-edge) outlines only for the tile under the cursor.
.editor-cell:hover .zone {
  stroke: rgba(44, 62, 80, 0.25);
  stroke-width: 1;
}
.zone--armed,
.zone--armed:hover {
  fill: rgba(255, 179, 0, 0.45);
}
// The "click again to stop here" wedge: a distinct, gently pulsing red so the
// finish point stands out from the amber start and green hover.
.zone--finish,
.zone--finish:hover {
  fill: rgba(255, 82, 82, 0.55);
  stroke: #d32f2f;
  stroke-width: 2;
  animation: finish-pulse 1s ease-in-out infinite alternate;
}
@keyframes finish-pulse {
  from {
    fill: rgba(255, 82, 82, 0.3);
  }
  to {
    fill: rgba(255, 82, 82, 0.65);
  }
}
.zone--signal {
  fill: rgba(255, 59, 48, 0.28);
}
// Bus-lane hit paths: a wide, near-invisible stroke along each lane's centreline,
// so the whole lane is an easy click target. Hover paints it amber (the bus-lane
// colour) so the author sees exactly which lane a click will flip; a lane that is
// already a bus lane shows a faint amber tint at rest.
.lane-hit {
  fill: none;
  stroke: rgba(255, 179, 0, 0.001); // effectively invisible but still hit-tested
  stroke-width: 22;
  stroke-linecap: round;
  cursor: pointer;
  transition: stroke 0.08s;
}
.lane-hit--bus {
  stroke: rgba(255, 179, 0, 0.22);
}
.lane-hit--cycle {
  stroke: rgba(102, 217, 122, 0.25);
}
.lane-hit:hover {
  stroke: rgba(255, 179, 0, 0.55);
}
// The parking tool's kerb strips. Invisible at rest, because the tile already
// shows what is there; the point of the affordance is that the hit target IS the
// tarmac the bays will cover.
.kerb-hit {
  fill: rgba(120, 190, 255, 0.06);
  stroke: none;
  cursor: pointer;
  transition: fill 0.08s;
}
// A kerb that already carries bays reads as "on" at rest, so a half-painted
// street is visible before you hover it.
.kerb-hit--has {
  fill: rgba(120, 190, 255, 0.2);
}
.kerb-hit:hover {
  fill: rgba(120, 190, 255, 0.4);
}
// The armed kind cannot go here — a bend, a junction, or a street too wide for
// it. Refused rather than silently ignored.
.kerb-hit--bad {
  cursor: not-allowed;
}
.kerb-hit--bad:hover {
  fill: rgba(255, 90, 90, 0.34);
}
// Ghost of the bays the click would lay, drawn by the same function that paints
// the real ones.
.preview-parking {
  fill: rgba(255, 255, 255, 0.1);
  stroke: rgba(255, 255, 255, 0.75);
  stroke-width: 2;
  stroke-dasharray: 5 4;
  pointer-events: none;
}
// The facility tool: a wash over every tile of the car park being swept, tinted
// per car-park id so two adjacent ones are visibly different.
.facility-tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
}

// Junction switch zone: an invisible-but-clickable spot over the switch widget
// (a transparent fill still receives pointer events). A soft amber wash on hover
// signals it cycles the junction's starting direction.
.switch-zone {
  fill: rgba(0, 0, 0, 0);
  cursor: pointer;
}
.switch-zone:hover {
  fill: rgba(255, 179, 0, 0.4);
}
.zone-dot {
  fill: rgba(66, 184, 131, 0.9);
  stroke: #2c3e50;
  stroke-width: 1;
  pointer-events: none;
}
.zone-dot--signal {
  fill: #ff3b30;
}
// Translucent ghost of the rail that will be laid, shown on hover while armed.
.preview-rail {
  fill: none;
  stroke: #2c3e50;
  stroke-width: 4;
  opacity: 0.35;
  stroke-linecap: round;
  pointer-events: none;
}
/* A road ghost previews as the wide paved ribbon the route would lay. */
.preview-road {
  fill: none;
  stroke: #3a3f44;
  stroke-width: 48;
  opacity: 0.3;
  stroke-linecap: butt;
  pointer-events: none;
}
.del {
  cursor: pointer;
}
.del-bg {
  fill: rgba(255, 59, 48, 0.85);
  stroke: #fff;
  stroke-width: 1.5;
}
/* Road delete handles use a neutral slate so they read apart from rail ✕. */
.del--road .del-bg {
  fill: rgba(58, 63, 68, 0.9);
}
.del--road:hover .del-bg {
  fill: #3a3f44;
}
.del:hover .del-bg {
  fill: #ff3b30;
}
.del-mark {
  stroke: #fff;
  stroke-width: 2.5;
  fill: none;
  stroke-linecap: round;
  pointer-events: none;
}
// The world-size readout in the zoom cluster (the grow controls live there:
// world chrome with world chrome).
.zoom-size {
  font-size: 12px;
  font-weight: 700;
  color: #17331a;
  font-variant-numeric: tabular-nums;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 8px;
  padding: 0 7px;
  height: 34px;
  display: inline-flex;
  align-items: center;
}
// On a phone the full-width dock owns the bottom edge, so the board chrome
// moves to the top-right corner instead of vanishing behind it.
@media (max-width: 700px), (max-height: 500px) {
  .editor-view .world-zoom {
    top: 10px;
    right: 10px;
    bottom: auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    max-width: 60vw;
  }
}
// Per-tile lane-count badge (road tool only): a small pill at the tile bottom.
.lane-badge-bg {
  fill: rgba(30, 30, 30, 0.72);
}
.lane-badge-text {
  fill: #fff;
  font-size: 9px;
  font-weight: 700;
  text-anchor: middle;
  font-family: monospace;
}
.io-box {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  width: min(680px, 90vw);
  height: 150px;
  z-index: 1600; // above the drawer/dock so Export/Import is usable
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.25);
  font-family: monospace;
  font-size: 11px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
</style>
