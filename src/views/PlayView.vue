<template>
  <div class="play-view" :class="{ debug: config.debug }">
    <MenuDrawer id="play" title="Menu">
      <button class="drawer-btn" @click="openPicker">
        <span>{{ modeIcon(currentModeId) }}</span><span>Game mode</span>
        <span class="drawer-btn__val">{{ game.mode.label }}</span>
      </button>
      <div class="drawer-divider"></div>
      <button class="drawer-btn" @click="pausePlayGame">
        <span>{{ paused ? "▶" : "⏸" }}</span>
        <span>{{ paused ? "Start" : "Pause" }}</span>
      </button>
      <button class="drawer-btn" @click="changeGlobalTimeScale">
        <span>⏩</span><span>Speed</span>
        <span class="drawer-btn__val">{{ globalTimeScale }}×</span>
      </button>
      <button class="drawer-btn" @click="cycleSwitchLock">
        <span>🔀</span><span>Switch lock</span>
        <span class="drawer-btn__val">{{ switchLockLabel }}</span>
      </button>
      <div class="drawer-slider">
        <span>🚗</span><span>Cars</span>
        <span class="drawer-btn__val">{{ carCountLabel }}</span>
        <input
          class="drawer-range"
          type="range"
          min="0"
          max="100"
          step="1"
          v-model.number="config.maxCars"
          @click.stop
        />
      </div>
      <div class="drawer-divider"></div>
      <button
        class="drawer-btn"
        :class="{ on: config.debug }"
        @click="switchDebugMode"
      >
        <span>🐞</span><span>Debug</span>
        <span class="drawer-btn__val">{{ config.debug ? "on" : "off" }}</span>
      </button>
      <button class="drawer-btn" @click="cycleTheme">
        <span>🎨</span><span>Theme</span>
        <span class="drawer-btn__val">{{ themeIcon }}</span>
      </button>
      <div class="drawer-divider"></div>
      <router-link class="drawer-btn" to="/editor">
        <span>✏️</span><span>Editor</span>
      </router-link>
      <router-link class="drawer-btn" to="/test">
        <span>🧪</span><span>Test world</span>
      </router-link>
    </MenuDrawer>
    <div
      v-if="!roadOnly"
      class="score-card"
      :class="{
        'score-card--pulse': pulsing,
        'score-card--complete': levelComplete,
      }"
    >
      <div class="score-head">
        <span class="score-icon">🚆</span>
        <span class="score-label">Deliveries</span>
        <span class="score-count">
          <span class="score-now">{{ delivered }}</span>
          <span class="score-sep">/</span>
          <span class="score-total">{{ totalTrains }}</span>
          <span v-if="levelComplete" class="score-check">✓</span>
        </span>
      </div>
      <div class="score-bar">
        <div class="score-bar-fill" :style="{ width: deliveredPct + '%' }"></div>
        <span class="score-pct">{{ deliveredPct }}%</span>
      </div>
      <!-- The stopwatch gives way to the calendar where there is one: M13 is
           explicitly "a calendar clock, NOT a stopwatch", and the two are the
           same elapsed seconds rendered twice — exactly the HUD density §5.5
           warns against. Boards with no calendar (every other mode, and every
           untuned Tycoon board) keep the timer unchanged. -->
      <div v-if="hud.timer && !dateLabel" class="score-timer">
        ⏱ {{ elapsedLabel }}
      </div>
      <!-- The whole money HUD off the board is this one line. The fares live on
           the board as pins over their trains; anything more and we are building
           TV2's chrome (design doc §5.5). -->
      <div v-if="hud.money" class="score-money" title="Balance">
        💰 {{ balanceLabel }}
      </div>
      <!-- The second clock (§1.3), and the whole of it: a date instead of a
           stopwatch, and what the railway costs to hold for a year. Keyed on
           the tax paid so the row flashes exactly once per levy — money leaving
           silently is the one thing a balance readout must not do. -->
      <div
        v-if="hud.money && dateLabel"
        :key="taxPaid"
        class="score-calendar"
        :class="{ 'score-calendar--broke': taxUnaffordable }"
        :title="calendarTitle"
      >
        📅 {{ dateLabel }}
        <span class="score-tax">🏛 {{ taxPerYearLabel }}/yr</span>
        <!-- The warning that keeps bankruptcy a decision rather than an
             ambush: while it shows, bulldozing surplus track both refunds now
             and lowers the bill. Same job as the gridlock nudge — name the
             failure before it lands, and name the fix. -->
        <span v-if="taxUnaffordable" class="score-tax-warn">
          ⚠ can't pay next year
        </span>
      </div>
      <div
        v-if="showCrossingFlow"
        class="score-crossing"
        :class="crossingFlowClass"
        title="Longest car wait at a crossing"
      >
        🚗 {{ crossingWaitLabel }}
      </div>
      <div v-if="hud.stars" class="score-stars">
        <span
          v-for="s in stars"
          :key="s.id"
          class="star-pip"
          :class="{ 'star-pip--on': s.earned }"
          :title="s.label"
          >★</span
        >
      </div>
      <transition name="score-banner">
        <div v-if="levelComplete" class="score-complete-banner">
          ★ Level Complete ★
        </div>
      </transition>
    </div>
    <!-- The build tool's ONE piece of chrome (design doc §5.5): a toggle. While
         armed, the tiles grow the editor's edge zones and the route gesture
         owns the left drag; the cost rides the ghost preview, not this button. -->
    <div v-if="canBuild" class="build-dock">
      <button
        class="build-toggle"
        :class="{ 'build-toggle--on': buildArmed }"
        data-testid="build-toggle"
        :title="buildToggleTitle"
        @click="toggleBuild"
      >
        <span class="build-toggle__icon">🛤️</span>
        <span>{{ buildArmed ? "Building — Esc finishes" : "Build" }}</span>
      </button>
      <!-- Bulldoze rides alongside Build rather than inside it: they are
           opposite verbs on the same board, and burying the undo in a sub-mode
           of the thing that caused the mistake is exactly where a player will
           not look for it. Only one can be armed at a time. -->
      <button
        class="build-toggle build-toggle--raze"
        :class="{ 'build-toggle--on': razeArmed }"
        data-testid="raze-toggle"
        :title="razeToggleTitle"
        @click="toggleRaze"
      >
        <span class="build-toggle__icon">🧨</span>
        <span>{{ razeArmed ? "Bulldozing — click track" : "Bulldoze" }}</span>
      </button>
    </div>
    <!-- The jam nudge. Collisions are impossible here by construction, so
         DEADLOCK is the failure this game actually has, and without a word it
         reads as the game having frozen. Not an overlay: the board stays live
         so the fix (flip a switch) is one click away. -->
    <div v-if="gridlocked" class="gridlock-nudge" data-testid="gridlock-nudge">
      <span class="gridlock-nudge__icon">{{ gridlockIcon }}</span>
      <span>{{ gridlockMessage }}</span>
    </div>
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
    <div class="world-zoom" v-if="worldOverflows()">
      <button class="zoom-btn" title="Zoom out" @click.stop="zoomBy(1 / 1.25)">−</button>
      <button class="zoom-btn zoom-btn--fit" title="Fit the whole world" @click.stop="fitWorld()">
        {{ Math.round(camera.zoom * 100) }}%
      </button>
      <button class="zoom-btn" title="Zoom in" @click.stop="zoomBy(1.25)">+</button>
    </div>
    <div
      class="level"
      :style="{
        gridTemplateColumns: `repeat(${bounds.cols}, ${config.tileSize}px)`,
        width: config.tileSize * bounds.cols + 'px',
        transform: levelTransform,
        '--switch-scale': switchScale,
      }"
      @click="onBackgroundClick"
      @mouseup="onLevelPointerGone"
      @mouseleave="onLevelPointerGone"
    >
      <Train
        v-for="trainObject in trains"
        :key="trainObject.id"
        :train-object="trainObject"
      />
      <div
        v-for="cell in gridCells"
        :key="cell.key"
        class="level-tile"
        :data-coord="cell.key"
        :class="{
          'level-tile--build-glow': buildArmed && buildGlowId === cell.key,
          'level-tile--razeable': razeArmed && canRaze(cell.key),
        }"
        :style="{
          width: config.tileSize + 'px',
          height: config.tileSize + 'px',
        }"
        @click="onTileRaze(cell.key)"
      >
        <TileGround :coord-id="cell.key" />
        <Tile
          v-if="cell.tile"
          :tile="cell.tile"
          :coord-id="cell.key"
          class="tile-component"
          :switch-interactive="!buildArmed && !razeArmed"
        />
        <!-- In-play building: the editor's triangular edge hit-zones + ghost
             preview, driven by the same extracted routeDrawController. Mounted
             only while the Build toggle is armed, so normal play is untouched.
             z-index sits ABOVE rails but BELOW cars and fare pins, so a waiting
             train can still be dispatched mid-build. -->
        <svg
          v-if="buildArmed"
          class="build-overlay"
          :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
        >
          <path
            v-for="(d, i) in previewRails(cell.key)"
            :key="'pv' + i"
            :d="d"
            class="preview-rail"
            :class="{ 'preview-rail--refused': previewRefused }"
          />
          <!-- The four edge wedges, unchanged: every edge stays reachable,
               because growing a branch off an existing line (which is how Lake
               Valley's station junction gets bought back) starts on an interior
               edge, not an open end. -->
          <path
            v-for="p in wedgePorts(cell.key)"
            :key="'z' + p"
            :data-port="p"
            :d="zonePath(p)"
            class="zone"
            :class="{
              'zone--armed': isBuildArmed(cell.key, p),
              'zone--finish': isBuildFinish(cell.key, p),
            }"
            @mousedown.stop="onZoneDown(cell.key, p)"
            @mouseup.stop="onZoneUp(cell.key, p)"
            @click.stop="onZoneClick(cell.key, p)"
            @mouseenter="onZoneEnter(cell.key, p)"
            @mouseleave="onZoneLeave(cell.key, p)"
          />
          <!-- The fix for aiming at the end of a line: a big disc ON TOP of the
               wedges, centred exactly on the open end. Drawn last, so it takes
               the click from the tapering triangle underneath.
               Both tiles either side draw one at the SAME world point — each
               clipped to its own half — so together they form one disc spanning
               the boundary, and both halves arm the same open end. That is what
               makes overshooting onto the empty neighbour harmless. Only while
               idle: once a gesture owns the board the wedges pick direction. -->
          <path
            v-for="t in openEndTargets(cell.key)"
            :key="'oe' + t.port"
            class="zone zone--open"
            :data-port="t.port"
            :d="edgeBandPath(t.port)"
            :class="{ 'zone--armed': isBuildArmed(t.end.id, t.end.edge) }"
            @mousedown.stop="onZoneDown(t.end.id, t.end.edge)"
            @mouseup.stop="onZoneUp(t.end.id, t.end.edge)"
            @click.stop="onZoneClick(t.end.id, t.end.edge)"
            @mouseenter="onZoneEnter(t.end.id, t.end.edge)"
            @mouseleave="onZoneLeave(t.end.id, t.end.edge)"
          />
          <!-- The knob that says "a line ends here". Owner-drawn only, or the
               facing pair would stack two. Never takes a click itself. -->
          <circle
            v-for="p in ownOpenEnds(cell.key)"
            :key="'oek' + p"
            class="open-end"
            :cx="edgeMid(p).x"
            :cy="edgeMid(p).y"
            :r="config.tileSize * 0.1"
          />
        </svg>
      </div>
      <div
        v-for="car in roadCars"
        :key="car.id"
        :class="['road-car', `road-car--${car.part}`, { 'road-car--inspect': config.debug }]"
        :style="{
          background: carColor(car.id),
          width: `${car.widthPx}px`,
          transform: `translate(-50%, -50%) translate(${car.x}px, ${car.y}px) rotate(${car.angle}deg)`,
        }"
        @mouseenter="onCarEnter(car.id)"
        @mouseleave="onCarLeave()"
        @click.stop="onCarClick(car.id)"
      >
        <span v-if="car.part !== 'trailer'" class="road-car-glass"></span>
        <span
          v-if="config.debug && car.part !== 'trailer'"
          class="road-car-id"
          :style="{ transform: `translate(-50%, -50%) rotate(${-car.angle}deg)` }"
        >{{ car.id }}</span>
      </div>
      <CarRouteOverlay
        v-if="config.debug && carRoute"
        :segments="carRoute.segments"
        :color="carColor(carRoute.carId)"
      />
      <!-- Fare pins. Absolutely positioned, like the road cars — a direct child
           of `.level` that generates a box becomes a GRID ITEM and eats a tile
           cell (see KNOWHOW → RENDER LAYOUT). A pin over a waiting train is its
           dispatch button; over a held one it names what it is waiting for; over
           a running one it just counts down. -->
      <FarePin
        v-for="badge in fareBadges"
        :key="`fare-${badge.trainId}`"
        :badge="badge"
        @send="onFareClick(badge)"
      />
      <!-- Build cost tag: rides the hovered tile while the ghost route is up —
           Train Valley's live "-2000$" (M2). Absolutely positioned like the
           fare pins (a box-generating direct child of .level would become a
           grid ITEM and eat a tile cell — KNOWHOW → RENDER LAYOUT). -->
      <div
        v-if="buildCostTag"
        class="build-cost-tag"
        :class="{ 'build-cost-tag--refused': buildCostTag.refused }"
        data-testid="build-cost"
        :style="{
          transform: `translate(-50%, -50%) translate(${buildCostTag.x}px, ${buildCostTag.y}px)`,
        }"
      >
        {{ buildCostTag.label }}
      </div>
      <Crossing
        v-for="c in crossings"
        :key="`crossing-${c.key}`"
        :coord-id="c.key"
        :cell="c.cell"
      />
    </div>
    </div>
    </div>
    <div v-if="hud.startOverlay && phase === 'ready'" class="game-overlay">
      <div class="overlay-card">
        <h2 class="overlay-title">{{ game.mode.label }}</h2>
        <p class="overlay-desc">{{ game.mode.description }}</p>
        <p v-if="best" class="overlay-best">
          Best: {{ best.stars }}★ · {{ best.timeSec.toFixed(1) }}s
        </p>
        <button class="overlay-btn" @click="startPlaying">Start</button>
        <button class="overlay-btn overlay-btn--ghost" @click="openPicker">
          Change game mode
        </button>
      </div>
    </div>
    <div
      v-if="hud.endOverlay && (phase === 'won' || phase === 'lost') && !endDismissed"
      class="game-overlay"
    >
      <div class="overlay-card">
        <h2 class="overlay-title">
          {{ phase === "won" ? "You win!" : "Failed" }}
        </h2>
        <div v-if="phase === 'won' && hud.stars" class="overlay-stars">
          <span
            v-for="s in stars"
            :key="s.id"
            class="star-pip star-pip--lg"
            :class="{ 'star-pip--on': s.earned }"
            :title="s.label"
            >★</span
          >
        </div>
        <p v-if="phase === 'won'" class="overlay-desc">
          {{ earnedStars }}/{{ stars.length }} stars · {{ elapsedLabel }}
        </p>
        <p v-else class="overlay-desc">{{ lostReason }}</p>
        <button class="overlay-btn" @click="retry">Retry</button>
        <!-- Train Valley's ∞: the result screen must not be a trap. Without it
             the overlay covers the whole board for good, and a level that
             completes on its own (or one you simply want to keep playing with)
             leaves every switch and signal unclickable. -->
        <button class="overlay-btn overlay-btn--ghost" @click="keepPlaying">
          Keep playing
        </button>
        <button class="overlay-btn overlay-btn--ghost" @click="openPicker">
          Change game mode
        </button>
      </div>
    </div>
    <div v-if="pickerOpen" class="game-overlay" @click.self="closePicker">
      <div class="picker-card">
        <h2 class="overlay-title">Choose a game mode</h2>
        <div class="mode-grid">
          <button
            v-for="m in modes"
            :key="m.id"
            class="mode-card"
            :class="{ 'mode-card--active': m.id === currentModeId }"
            @click="pickMode(m.id)"
          >
            <span class="mode-card__icon">{{ modeIcon(m.id) }}</span>
            <span class="mode-card__label">{{ m.label }}</span>
            <span class="mode-card__desc">{{ m.description }}</span>
            <span v-if="m.id === currentModeId" class="mode-card__badge"
              >Playing</span
            >
          </button>
        </div>
        <button class="overlay-btn overlay-btn--ghost" @click="closePicker">
          Close
        </button>
      </div>
    </div>
    <div
      v-if="config.debug"
      class="event-log"
      :class="{ 'event-log--min': logMinimized }"
    >
      <div class="event-log-header">
        <span class="event-log-title">Activity log</span>
        <button
          class="event-log-toggle"
          :title="logMinimized ? 'Expand' : 'Minimize'"
          @click="logMinimized = !logMinimized"
        >
          {{ logMinimized ? "+" : "–" }}
        </button>
      </div>
      <ul v-show="!logMinimized" class="event-log-list">
        <li v-if="recentLog.length === 0" class="event-log-empty">
          No events yet…
        </li>
        <li
          v-for="entry in recentLog"
          :key="entry.id"
          class="event-log-entry"
          :class="`log-${entry.kind}`"
        >
          <span class="log-time">{{ entry.time.toFixed(1) }}s</span>
          <span class="log-train" :style="{ color: trainColor(entry.trainId) }">
            {{ entry.trainId }}
          </span>
          <span class="log-text">{{ entry.text }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts">
import { markRaw } from "vue";
import {
  Component,
  Inject,
  Provide,
  Vue,
  Watch,
  toNative,
} from "vue-facing-decorator";
import {
  GameConfig,
  GAME_CONFIG_KEY,
  gameConfig,
  SwitchLockMode,
  setWorldTheme,
} from "@/gameConfig";
import { nextTheme, themeMeta } from "@/themes";
import { Coordinates, Position, TrainsDefinition, TrainStatus } from "@/types";
import {
  Level,
  Port,
  TileCell,
  isLevelCrossing,
  isRoadOnlyLevel,
  parseCoordId,
} from "@/tiles/model";
import { canBuildOn } from "@/tiles/terrain";
import { railPathsFor } from "@/tiles/geometry";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { TRACK_COST_PER_TILE } from "@/sim/economy";
import type { RouteOpts, RouteStep, OpenEnd } from "@/tiles/routePlanner";
import { buildTargetsAt, openEndPortsAt } from "@/tiles/openEnds";
import {
  createRouteDrawController,
  type RouteDrawController,
} from "@/routeDrawController";
import { createGame, FareBadge, Game, TrainDef } from "@/game";
import { DEFAULT_LEVEL, DEFAULT_TRAFFIC, defaultTrains } from "@/levels/default";
import { takeCustomLevel } from "@/levelStore";
import { modeById, MODES } from "@/modes/index";
import { GameMode, ModeSetup } from "@/modes/types";
import { loadLastModeId, saveLastModeId } from "@/modes/lastMode";
import { scenarioById, SCENARIOS } from "@/levels/test/index";
import { loadBest, recordResult, BestResult } from "@/objectiveStore";
import Crossing from "@/components/Crossing.vue";
import FarePin from "@/components/FarePin.vue";
import MenuDrawer from "@/components/MenuDrawer.vue";
import { levelBounds } from "@/tiles/bounds";
import { type Camera, type Size } from "@/camera";
import { switchFanScale } from "@/tiles/switchFan";
import { createCameraController, type CameraController } from "@/cameraController";

// The four tile edges, for the build tool's triangular hit-zones (same order as
// the editor's).
const EDGES: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

function buildTrainDefs(trains: TrainsDefinition): TrainDef[] {
  return Object.values(trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
    destinations: (t.routeDestinations ?? []).map(d => d.to),
    spawnAtSec: t.spawnAtSec,
  }));
}

// Hash history puts the route's query in location.hash, e.g.
// "#/play?mode=puzzle&board=objectives".
function hashParam(name: string): string | null {
  const hash = window.location.hash;
  const q = hash.indexOf("?");
  if (q === -1) return null;
  return new URLSearchParams(hash.slice(q + 1)).get(name);
}

// Modes that generate their own board (e.g. Daily) return a fully-populated
// ModeSetup from setup(); calling setup() here lets PlayView honour that board
// for rendering + createGame instead of the default/custom/board context.
// Other modes' setup() is called again inside createGame — safe because setup()
// is pure and cheap (no side effects, no DOM).
function resolveBoard(
  mode: ReturnType<typeof modeById>,
  fallbackLevel: Level,
  fallbackTrains: TrainsDefinition,
  fallbackLevelId: string
): { level: Level; trains: TrainsDefinition; levelId: string; setup: ModeSetup } {
  const trainDefs = buildTrainDefs(fallbackTrains);
  const setup = mode.setup({
    level: fallbackLevel,
    trains: trainDefs,
    levelId: fallbackLevelId,
  });
  // If the mode returned a different level (i.e. it generated its own board),
  // use that everywhere. Otherwise fall back to the view-resolved board.
  if (setup.level !== fallbackLevel) {
    // Reconstruct a TrainsDefinition from the TrainDef[] the mode produced.
    // The view only uses TrainsDefinition for `totalTrains` (key count) and
    // for @Provide(); the actual sim is driven from TrainDef[] in createGame.
    const genTrains: TrainsDefinition = {};
    for (const def of setup.trains) {
      genTrains[def.id] = {
        id: def.id,
        x: def.x,
        y: def.y,
        status: TrainStatus.LeavingDepot,
        type: def.type,
        wagons: def.wagonIds.map(wid => ({ id: wid, type: def.type })),
        routeDestinations: [],
        currentRouteDestination: 0,
      };
    }
    return { level: setup.level, trains: genTrains, levelId: setup.levelId, setup };
  }
  return { level: fallbackLevel, trains: fallbackTrains, levelId: fallbackLevelId, setup };
}

@Component({ components: { Crossing, FarePin, MenuDrawer } })
class PlayView extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  speeds = [1, 2, 4];
  levelSizeY = 6;
  // Whether the debug activity-log panel is collapsed to just its header.
  logMinimized = false;

  // An optional named board from `?board=<scenarioId>` — lets any test-world
  // scenario be played as a real game (e.g. a small, deterministic puzzle).
  // Returns null unless the id matches a registered scenario.
  private board = (() => {
    const id = hashParam("board");
    if (!id) return null;
    return SCENARIOS.some(s => s.id === id) ? scenarioById(id) : null;
  })();

  // Read per instance (not at module load) so a level built in the editor and
  // handed over right before navigation is picked up on this mount.
  private custom = this.board ? null : takeCustomLevel();

  // The active mode: an explicit ?mode= wins; otherwise reopen the mode the
  // player last used (persisted), falling back to the default.
  private mode = modeById(hashParam("mode") ?? loadLastModeId());

  // Resolve which board the view should use. Modes that generate their own board
  // (e.g. Daily) return a different level from setup(); resolveBoard detects this
  // and promotes the generated board so the renderer and sim agree.
  private _resolved = (() => {
    // CLONE the board before the game gets it. `this.board` is the scenario
    // registry's module-level singleton (and `this.custom` can be the editor's
    // live reactive level), while build-in-play writes through `applyEdits`
    // into whatever level object the game holds. Handing the singleton over
    // raw meant bought track was written INTO THE REGISTRY: browser Back /
    // re-entering the URL remounted onto the mutated board with a fresh
    // balance (free track), Retry's "pristine" snapshot was taken after the
    // mutation, and /test rendered the same corrupted object. A clone makes
    // the game's world private; the registry stays what the author wrote.
    const fallbackLevel = structuredClone(
      this.board ? this.board.level : this.custom ? this.custom.level : DEFAULT_LEVEL,
    );
    const fallbackTrains = structuredClone(
      this.board
        ? this.board.trains
        : this.custom
          ? this.custom.trains
          : defaultTrains(),
    );
    const fallbackLevelId = this.board
      ? `board:${this.board.id}`
      : this.custom
        ? "custom"
        : "default";
    return resolveBoard(this.mode, fallbackLevel, fallbackTrains, fallbackLevelId);
  })();

  @Provide() trains: TrainsDefinition = this._resolved.trains;
  @Provide() level: Level = this._resolved.level;

  private levelId = this._resolved.levelId;
  best: BestResult | null = null;

  @Provide("game") game: Game = markRaw(
    createGame(
      this._resolved.level,
      this._resolved.setup.trains,
      gameConfig.tileSize,
      this.mode,
      gameConfig.colorSeed,
      // When the mode pinned colours (Daily's deterministic assignment), honour
      // them so depot/train colours match the generated board exactly.
      this._resolved.setup.colors,
      DEFAULT_TRAFFIC,
      this._resolved.levelId,
      // Live car cap from the menu setting, read each spawn attempt.
      () => gameConfig.maxCars
    )
  );

  mounted() {
    // Frame the board before the first paint the player sees: a world larger
    // than the screen would otherwise open on its top-left corner, which looks
    // like a broken level rather than a big one.
    this.$nextTick(() => this.fitWorld());
    window.addEventListener("resize", this.onWindowResize);
    // Build-tool keys: Esc finishes an open route, Space is the pan modifier
    // while build owns the left drag. Both no-op unless build is armed. The
    // closures are created HERE so they capture the live component (see the
    // note on handleBuildKeydown).
    this.boundKeydown = e => this.handleBuildKeydown(e);
    this.boundKeyup = e => this.handleBuildKeyup(e);
    window.addEventListener("keydown", this.boundKeydown);
    window.addEventListener("keyup", this.boundKeyup);
    // Remember the mode we ended up in, so a later plain /play reopens it.
    saveLastModeId(this.mode.id);
    this.best = loadBest(this.levelId);
    this.game.start(); // start the rAF loop (rendering); objective stays Ready
    if (!this.game.mode.hud.startOverlay) this.game.startObjective();
    // Test hook: expose the live game so e2e can read simulation state without
    // depending on Vue's internal instance shape.
    (window as unknown as { __game?: Game }).__game = this.game;
  }

  // Set when the player dismisses the result screen to stay on the board. Reset
  // on any fresh run, so the next result is shown again.
  endDismissed = false;

  keepPlaying() {
    this.endDismissed = true;
  }

  startPlaying() {
    this.endDismissed = false;
    this.game.startObjective();
  }

  retry() {
    this.endDismissed = false;
    this.game.reset();
    this.game.startObjective();
  }

  // ---- Game-mode picker -------------------------------------------------
  // The card grid of game types. Opened from the menu drawer or the start
  // overlay; picking a card navigates to `#/play?mode=<id>`, which remounts the
  // view (router-view is keyed on the full path) so the chosen mode loads fresh.
  pickerOpen = false;
  modes: GameMode[] = MODES;

  get currentModeId(): string {
    return this.game.mode.id;
  }

  private modeIcons: Record<string, string> = {
    puzzle: "🧩",
    tycoon: "💰",
    "crossing-keeper": "🚧",
    "time-attack": "⏱️",
    daily: "📅",
    sandbox: "🏖️",
  };
  modeIcon(id: string): string {
    return this.modeIcons[id] ?? "🚆";
  }

  openPicker() {
    this.pickerOpen = true;
  }
  closePicker() {
    this.pickerOpen = false;
  }
  pickMode(id: string) {
    this.pickerOpen = false;
    if (id === this.currentModeId) return; // already playing this mode
    this.$router.push({ name: "play", query: { mode: id } });
  }

  @Watch("phase")
  onPhase(now: string) {
    if (now === "won") {
      const earned = this.game.objective.stars.filter(s => s.earned).length;
      this.best = recordResult(this.levelId, {
        stars: earned,
        timeSec: this.game.objective.counters.elapsedSec,
      });
    }
  }

  get phase(): string {
    return this.game.objective.phase;
  }
  get hud() {
    return this.game.mode.hud;
  }
  get stars() {
    return this.game.objective.stars;
  }
  get elapsedLabel(): string {
    const t =
      this.game.objective.timeLeftSec ??
      this.game.objective.counters.elapsedSec;
    return t.toFixed(1) + "s";
  }
  get earnedStars(): number {
    return this.stars.filter(s => s.earned).length;
  }
  // The crossing-flow readout (Crossing Keeper): the live worst car wait. Shown
  // only when the mode controls the crossing gate, so other modes' HUDs are
  // unchanged. The colour ramps amber→red as the wait climbs (the live tension).
  get showCrossingFlow(): boolean {
    return this.game.mode.controls.crossingGate;
  }
  get crossingWaitLabel(): string {
    return this.game.roadFrame.maxCarWaitSec.toFixed(0) + "s";
  }
  get crossingFlowClass(): string {
    const w = this.game.roadFrame.maxCarWaitSec;
    if (w >= 18) return "score-crossing--bad";
    if (w >= 8) return "score-crossing--warn";
    return "";
  }
  get lostReason(): string {
    return this.game.objective.lostReason ?? "";
  }

  // --- money (Tycoon) --------------------------------------------------------
  // The balance, and one fare pin per live train. Both are inert for every mode
  // that declares no economy: `hud.money` is false and `fareBadges` stays empty.
  get balanceLabel(): string {
    return this.game.money.balance.toLocaleString("en-US");
  }
  // The calendar row. Empty `dateLabel` = this board named no calendar, and the
  // row is not rendered at all — the pre-tax money HUD, unchanged.
  get dateLabel(): string {
    return this.game.money.dateLabel;
  }
  get taxPerYearLabel(): string {
    return "$" + this.game.money.taxPerYear.toLocaleString("en-US");
  }
  get taxPaid(): number {
    return this.game.money.taxPaid;
  }
  get taxUnaffordable(): boolean {
    return this.game.money.taxUnaffordable;
  }
  get calendarTitle(): string {
    return this.taxUnaffordable
      ? "Next year's upkeep is more than you have — bulldoze track you don't need, or finish first"
      : "The year, and this railway's annual upkeep";
  }
  get fareBadges(): FareBadge[] {
    return this.game.fareBadges;
  }
  onFareClick(badge: FareBadge): void {
    // A drag that ends over a pin still fires a click; ignore it, or panning the
    // board would dispatch whatever train the cursor happened to land on.
    if (this.panning) return;
    if (badge.waiting) this.game.dispatch(badge.trainId);
  }

  beforeUnmount() {
    this.game.stop();
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("keydown", this.boundKeydown);
    window.removeEventListener("keyup", this.boundKeyup);
  }

  // Re-clamp on resize: a window that grew could otherwise leave the board
  // stranded against an edge with empty space beside it.
  onWindowResize(): void {
    this.cam.reclamp();
  }

  // The board's extents come from the LEVEL, not from a fixed board size, so a
  // world is as big as its content. `gameConfig.levelSizeX`/`levelSizeY` are only
  // the default canvas a brand-new board starts on.
  get bounds(): { cols: number; rows: number } {
    // Touch the game's edit counter so this computed invalidates when track is
    // laid mid-run. `game.applyEdits` writes through the RAW level object (the
    // simulation reads it live and must not pay for a Proxy on every traverse),
    // which Vue cannot observe — the counter is the notification. See
    // `applyEdits` in game.ts.
    void this.game.levelVersion.value;
    return levelBounds(this.level, {
      cols: this.config.levelSizeX,
      rows: this.levelSizeY,
    });
  }

  get gridCells(): { key: string; tile: Level[string] | null }[] {
    void this.game.levelVersion.value; // see `bounds` above
    const out: { key: string; tile: Level[string] | null }[] = [];
    const { cols, rows } = this.bounds;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const key = `${x},${y}`;
        out.push({ key, tile: this.level[key] ?? null });
      }
    }
    return out;
  }

  // --- Camera ---------------------------------------------------------------
  // A world bigger than the screen is panned and zoomed rather than shrunk: the
  // board renders at its natural 200px tile (every piece of road geometry is in
  // those px) and this moves a window over it. The wiring is shared with the test
  // stage — see cameraController.ts.
  // Built in `created()`, NOT as a field initialiser: a field initialiser runs
  // while vue-facing-decorator is collecting data off a throwaway instance, so
  // the closures below would capture THAT `this` — one whose injected `config` is
  // still undefined. The first render calls `overflows` → `worldSize()` and dies
  // on it. `created()` runs on the real instance, before the first render.
  //
  // markRaw: a plain controller in component state must not be deep-proxied
  // (CLAUDE.md). Its own `state` is `reactive()`, so the camera still drives
  // re-renders.
  private cam!: CameraController;

  // The in-play build gesture: the exact controller the editor uses (edge
  // press/drag one-shot, click chaining incl. the U-turn pending case, hover
  // ghost), pointed at `game.buildRoute` instead of the editor's per-cell
  // writer. Built in `created()` and markRaw'd for the same reasons as `cam`.
  private routeCtrl!: RouteDrawController;

  created() {
    this.cam = markRaw(
      createCameraController(
        () => this.worldSize,
        () => this.viewportSize(),
      ),
    );
    this.routeCtrl = markRaw(
      createRouteDrawController({
        drawing: () => (this.buildArmed ? "rail" : null),
        planOpts: () => this.buildPlanOpts(),
        lay: steps => this.layBuild(steps),
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
  // Counter-scale for the junction switch fans, so a zoomed-out world does not
  // shrink them back to the unusable size the old widget had. See switchFan.ts.
  get switchScale(): number {
    return switchFanScale(this.camera.zoom);
  }
  // Also a method: it reads `viewportSize()`, which is not a reactive dependency.
  worldOverflows(): boolean {
    return this.cam.overflows;
  }

  get worldSize(): Size {
    const { cols, rows } = this.bounds;
    return { width: cols * this.config.tileSize, height: rows * this.config.tileSize };
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
  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
  }
  onViewportWheel(e: WheelEvent): void {
    this.cam.onWheel(e, this.$refs.viewport as HTMLElement | undefined);
  }
  onViewportPointerDown(e: PointerEvent): void {
    // Left drag pans — the gesture everyone already knows from a map, and the
    // only one available on a trackpad or a touchscreen. Middle drag pans too,
    // so the same muscle memory works here and in the editor (where left has to
    // stay with the drawing tools).
    if (e.button !== 0 && e.button !== 1) return;
    // …EXCEPT while the build tool is armed: then the left drag belongs to
    // drawing (edge → edge one-shot routes), exactly the editor's policy —
    // stealing it makes the board unbuildable (KNOWHOW → WORLD SIZE + CAMERA).
    // Pan stays on middle-drag or space+left, and left-pan returns the moment
    // build is disarmed.
    if (this.buildArmed && e.button === 0 && !this.spaceHeld) return;
    this.cam.onPointerDown(e);
  }
  onViewportPointerMove(e: PointerEvent): void {
    this.cam.onPointerMove(e);
  }
  onViewportPointerUp(e: PointerEvent): void {
    this.cam.onPointerUp(e);
  }

  // --- building during play (Tycoon phase 2) ---------------------------------
  // One toggle arms the tool; while armed, every tile grows the editor's
  // triangular edge zones and the shared routeDrawController drives the
  // gesture. Committing goes through `game.buildRoute`: affordability gate →
  // `applyEdits` → spend, so a refused edit costs nothing.
  EDGES = EDGES;
  buildArmed = false;
  spaceHeld = false;
  // Set by layBuild when game.buildRoute refuses (unaffordable, or a train
  // moved onto a route tile between preview and click). The controller advances
  // its head AFTER lay() returns, so the abort must run after the gesture
  // handler finishes — see settleBuildGesture.
  private buildRefusedFlag = false;

  get canBuild(): boolean {
    return this.game.mode.controls.build;
  }

  get buildToggleTitle(): string {
    const how =
      "Click an edge, then click tiles to route track; drag edge-to-edge for a quick link; Esc finishes.";
    return this.game.money.enabled
      ? `Build track — $${TRACK_COST_PER_TILE.toLocaleString("en-US")} per tile. ${how}`
      : `Build track. ${how}`;
  }

  toggleBuild(): void {
    if (!this.buildArmed) {
      // Both directions must disarm the other, or the exclusion is a half-rule:
      // this branch used to arm Build without clearing Bulldoze, so going
      // Bulldoze → Build left BOTH lit, with raze-hover highlights under live
      // build zones and a tile click meaning two different things.
      this.razeArmed = false;
      this.buildArmed = true;
      return;
    }
    // Disarm ABANDONS rather than finishes: finishing would lay (and charge
    // for) a terminus straight on the pending frontier tile that no cost tag
    // ever showed. The order is load-bearing — dropAnchors clears the head, so
    // the finishRoute after it cannot lay the pending tile, only forget it.
    this.routeCtrl.dropAnchors();
    this.routeCtrl.finishRoute();
    this.routeCtrl.state.hoverPort = null;
    this.buildArmed = false;
  }

  // --- bulldoze --------------------------------------------------------------
  // Armed separately from Build, and mutually exclusive with it: the two verbs
  // both claim the left click on a tile, so only one can own it at a time.
  razeArmed = false;

  get razeToggleTitle(): string {
    const how = "Click a piece of track to remove it.";
    return this.game.money.enabled
      ? `Bulldoze track — refunds what you paid for it. ${how}`
      : `Bulldoze track. ${how}`;
  }

  toggleRaze(): void {
    if (this.razeArmed) {
      this.razeArmed = false;
      return;
    }
    // Arming Bulldoze disarms Build through its own EXIT path (not by clearing
    // the flag), so a half-drawn route is abandoned rather than left pending
    // behind the other tool. toggleBuild clears `razeArmed` on the way in, so
    // set it after.
    if (this.buildArmed) this.toggleBuild();
    this.razeArmed = true;
  }

  // Clicking a tile while Bulldoze is armed. Refusals (a depot, or track a
  // train occupies or has reserved) are deliberately quiet on the board — the
  // tile simply does not go — because the honest signal is the one the player
  // can see: the train sitting on it.
  onTileRaze(tileId: string): void {
    if (!this.razeArmed || this.panning) return;
    this.game.bulldoze(tileId);
  }

  // Whether a click here would actually remove something — drives the hover
  // affordance, so the player can see which tiles are theirs to take back
  // before clicking. Cheap: it reads the level, not the sim's reservations,
  // because those change every frame and the truth is enforced by `bulldoze`.
  canRaze(tileId: string): boolean {
    const cell = this.level[tileId];
    return !!cell && cell.role !== "depot" && cell.connections.length > 0;
  }

  get gridlocked(): boolean {
    return this.game.gridlock.stuck;
  }

  get gridlockIcon(): string {
    return this.game.gridlock.reason === "dead-end" ? "🛤️" : "🚦";
  }

  // Name the actual fix, which differs by cause: a deadlock frees on a switch,
  // a dead end needs rails. Telling a player to flip switches at a severed line
  // would send them hunting for a junction that cannot help.
  get gridlockMessage(): string {
    if (this.game.gridlock.reason === "dead-end") {
      return this.canBuild
        ? "A train has run out of track. Build the missing link — or bulldoze a wrong turn and try again."
        : "A train has run out of track: the line does not reach its station.";
    }
    // Deliberately does NOT offer "build a passing loop": building grows a line
    // from its OPEN END, and a deadlock happens on a network that is already
    // joined up — so there is usually nothing to build from. Promising a fix
    // the tool cannot perform is worse than naming the one that works.
    // Branching a siding off the side of a line needs real turnouts first
    // (today it would buy an unreachable crossing — see KNOWHOW).
    return "Trains are waiting on each other. Flip a switch to let one through.";
  }

  // Live plan options for the route controller: the current world bounds and
  // the passable gate. Terrain (water/rock/mountain) AND tiles a train occupies
  // or has reserved are unplannable, so the preview can never offer a route
  // `applyEdits` would then refuse for a stationary reason — only a train
  // moving in AFTER the preview can still refuse the commit.
  buildPlanOpts(): RouteOpts {
    const { cols, rows } = this.bounds;
    return {
      width: cols,
      height: rows,
      passable: (c: Coordinates) => {
        const id = getCoordinatesId(c);
        return canBuildOn(this.level[id]) && this.game.canEdit([id]);
      },
    };
  }

  private layBuild(steps: RouteStep[]): void {
    const res = this.game.buildRoute(steps);
    if (!res.ok) this.buildRefusedFlag = true;
  }

  // Runs after a controller entry point returns. On a refused lay the gesture
  // is abandoned outright — without this the controller's head points at track
  // that was never laid and the finish wedge floats over empty ground. The
  // dropAnchors→finishRoute order matters (see toggleBuild).
  private settleBuildGesture(): void {
    if (!this.buildRefusedFlag) return;
    this.buildRefusedFlag = false;
    this.routeCtrl.dropAnchors();
    this.routeCtrl.finishRoute();
  }

  onZoneDown(id: string, port: Port): void {
    this.routeCtrl.onZoneDown(id, port);
  }
  onZoneUp(id: string, port: Port): void {
    this.routeCtrl.onZoneUp(id, port);
    this.settleBuildGesture();
  }
  onZoneClick(id: string, port: Port): void {
    this.routeCtrl.onZoneClick(id, port);
    this.settleBuildGesture();
  }
  onZoneEnter(id: string, port: Port): void {
    this.routeCtrl.onZoneEnter(id, port);
  }
  onZoneLeave(id: string, port: Port): void {
    this.routeCtrl.onZoneLeave(id, port);
  }
  // A press released off the zones (grid mouseup / mouseleave) is abandoned,
  // matching the editor's grid-level clearPress wiring.
  onLevelPointerGone(): void {
    if (this.buildArmed) this.routeCtrl.clearPress();
  }

  isBuildArmed(id: string, port: Port): boolean {
    return this.routeCtrl.isArmed(id, port);
  }
  isBuildFinish(id: string, port: Port): boolean {
    return this.routeCtrl.isFinish(id, port);
  }
  get buildGlowId(): string | null {
    return this.routeCtrl.glowId;
  }

  // The triangular hit-zone for one edge: edge corners to the tile centre, so
  // every point of the tile maps to exactly one edge (the editor's shape).
  // Which edges of this tile are build targets right now, and how big a shape
  // each gets. Idle: only open ends (this tile's own, or the facing neighbour's,
  // which is what makes clicking either side of a line's end work). Routing: all
  // four, unchanged — the click then chooses a direction, not an anchor.
  // True only before a gesture has begun. The narrowing applies to the click
  // that STARTS a route, not to the ones that steer it: `routeStarted` alone is
  // the wrong test, because it only flips once the first segment is actually
  // laid — so the second click of every gesture would still see the narrowed
  // set and land on a delegating open-end target instead of the tile it aimed
  // at. `armed` (and a live drag) is what says "a gesture owns the board now".
  get buildIdle(): boolean {
    const s = this.routeCtrl.state;
    // Deliberately NOT gated on `pressFrom`. Doing so swapped the band for a
    // wedge on MOUSEDOWN, so mouseup landed on a different element — and a
    // browser fires `click` on the nearest common ancestor of the two, which
    // carries no handler. The click silently never reached the controller and
    // nothing armed. Whatever decides this must not change mid-press.
    return !s.armed && !s.routeStarted;
  }

  // The open ends a click on THIS tile should be able to grab: its own, plus a
  // facing neighbour's (so the empty side of a line's end works too).
  openEndTargets(id: string): { port: Port; end: OpenEnd }[] {
    if (!this.buildIdle) return [];
    void this.game.levelVersion.value; // ends move when track is laid or razed
    return buildTargetsAt(this.level, id);
  }

  // Ports still served by the tapering wedge. An open-end port is served by the
  // disc INSTEAD — one element per port, so the two never overlap and neither
  // can intercept the other's click. Interior edges keep their wedge, because
  // branching a line (Lake Valley's station junction) starts on one.
  wedgePorts(id: string): Port[] {
    const taken = new Set(this.openEndTargets(id).map(t => t.port));
    return taken.size === 0 ? EDGES : EDGES.filter(p => !taken.has(p));
  }

  // The open ends this tile OWNS (rail on this side), for drawing the knob.
  ownOpenEnds(id: string): Port[] {
    if (!this.buildIdle) return [];
    void this.game.levelVersion.value;
    return openEndPortsAt(this.level, id);
  }

  edgeMid(port: Port): { x: number; y: number } {
    const s = this.config.tileSize;
    const c = s / 2;
    if (port === Position.Top) return { x: c, y: 0 };
    if (port === Position.Right) return { x: s, y: c };
    if (port === Position.Bottom) return { x: c, y: s };
    return { x: 0, y: c };
  }

  // The pinwheel wedge, one per edge, dividing the tile between the four ports.
  // Fine while a gesture is steering (the click picks a direction), and hopeless
  // as a way to grab the END of a line — it tapers to a point at the tile centre
  // and at a fitted zoom (30px tiles) is a few pixels wide. That case is served
  // by the open-end disc drawn on top of these.
  // The open-end target: the half-tile band along that edge, used INSTEAD of the
  // wedge for that port. Both tiles either side of a line's end draw their own
  // band, so together they form one tile-wide strip centred on the boundary and
  // both halves arm the same end — overshooting onto the empty neighbour is
  // harmless. A whole half-tile where there was a triangle tapering to a point.
  edgeBandPath(port: Port): string {
    const s = this.config.tileSize;
    const c = s / 2;
    switch (port) {
      case Position.Top:
        return `M0 0 L${s} 0 L${s} ${c} L0 ${c} Z`;
      case Position.Right:
        return `M${c} 0 L${s} 0 L${s} ${s} L${c} ${s} Z`;
      case Position.Bottom:
        return `M0 ${c} L${s} ${c} L${s} ${s} L0 ${s} Z`;
      default:
        return `M0 0 L${c} 0 L${c} ${s} L0 ${s} Z`;
    }
  }

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

  // The route the pointer is describing, priced. The controller decides WHICH
  // steps (anchor inclusion, U-turn trimming); the game prices only the NEW
  // pieces — the same filter the commit charges, so the tag never lies.
  get buildPreview(): { steps: RouteStep[]; cost: number; refused: boolean } | null {
    if (!this.buildArmed) return null;
    // The cost reads the RAW level (which connections already exist), which Vue
    // cannot observe — the edit counter is the notification (see `bounds`).
    void this.game.levelVersion.value;
    const steps = this.routeCtrl.previewSteps();
    if (steps.length === 0) return null;
    const cost = this.game.buildCostOf(steps);
    const refused = this.game.money.enabled && cost > this.game.money.balance;
    return { steps, cost, refused };
  }

  get previewRefused(): boolean {
    return this.buildPreview?.refused ?? false;
  }

  // Ghost rails per cell for the previewed route (the editor's rail-pair paint).
  get previewByCell(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const pv = this.buildPreview;
    if (!pv) return out;
    const size = this.config.tileSize;
    const off = this.config.railDistanceFromPath;
    for (const s of pv.steps) {
      (out[s.id] ??= []).push(...railPathsFor(s.a, s.b, size, off));
    }
    return out;
  }
  previewRails(id: string): string[] {
    return this.previewByCell[id] ?? [];
  }

  // The floating cost tag: Train Valley's live price on the pending route. On a
  // hover that plans NO route (blocked terrain in the way, or off the world) it
  // shows a refusal ✕ instead, so "can't build there" is visible rather than
  // just a missing ghost.
  get buildCostTag(): { x: number; y: number; label: string; refused: boolean } | null {
    if (!this.buildArmed) return null;
    const hover = this.routeCtrl.state.hoverPort;
    if (!hover) return null;
    const { x, y } = parseCoordId(hover.id);
    const px = (x + 0.5) * this.config.tileSize;
    const py = (y + 0.14) * this.config.tileSize;
    const pv = this.buildPreview;
    if (!pv) {
      const from = this.routeCtrl.state.pressFrom ?? this.routeCtrl.state.armed;
      // No route to show: only meaningful mid-gesture, over a different tile —
      // and never over the pending frontier tile, where a click FINISHES the
      // route rather than failing (its "no plan" is the U-turn trim, not a
      // refusal).
      if (!from || (from.id === hover.id && from.port === hover.port)) return null;
      if (hover.id === this.routeCtrl.state.pendingId) return null;
      return { x: px, y: py, label: "✕ no route", refused: true };
    }
    if (!this.game.money.enabled || pv.cost === 0) return null; // free — no tag
    return {
      x: px,
      y: py,
      label: `−$${pv.cost.toLocaleString("en-US")}`,
      refused: pv.refused,
    };
  }

  // Window key handlers. Bound in mounted() — NOT arrow-function fields: a
  // field initialiser's closure captures the data-collection `this` (the same
  // vue-facing-decorator trap as the camera), and here that bit for real — the
  // handler ran, read a forever-false `buildArmed` off the dead instance, and
  // Esc silently did nothing. `!:` fields keep the bound references stable so
  // removeEventListener matches.
  private boundKeydown!: (e: KeyboardEvent) => void;
  private boundKeyup!: (e: KeyboardEvent) => void;

  handleBuildKeydown(e: KeyboardEvent): void {
    if (!this.buildArmed) return;
    if (e.key === "Escape") {
      this.routeCtrl.finishRoute();
      this.settleBuildGesture();
    }
    if (e.code === "Space" && !this.spaceHeld) {
      this.spaceHeld = true;
      // Space is the pan modifier while building; keep the page still under it.
      e.preventDefault();
    }
  }
  handleBuildKeyup(e: KeyboardEvent): void {
    if (e.code === "Space") this.spaceHeld = false;
  }

  // Level-crossing cells (rail + road on the same tile) — overlaid with the
  // crossing furniture + cars. Derived from the shared `road?` seam.
  get crossings(): { key: string; cell: TileCell }[] {
    return Object.entries(this.level)
      .filter(([, cell]) => isLevelCrossing(cell))
      .map(([key, cell]) => ({ key, cell }));
  }

  // Live road-traffic cars, sampled to world positions by the game each frame.
  get roadCars() {
    return this.game.roadCars;
  }

  // The hovered/pinned car's route for the debug overlay (null when none).
  get carRoute() {
    return this.game.carRoute.value;
  }

  private carPalette = ["#d94c4c", "#3f7fd9", "#e0bc5c", "#e7e7e7", "#5fb37a"];
  // Stable colour per vehicle from the number in its base id (car0, car1, …). The
  // render id is `${carId}#${segment}`, so strip the segment suffix first — this
  // keeps a semi's cab and trailer in one livery.
  carColor(id: string): string {
    const base = id.split("#")[0];
    const n = parseInt(base.replace(/\D/g, ""), 10) || 0;
    return this.carPalette[n % this.carPalette.length];
  }

  // Debug route inspection: hover previews a car's route, click pins it (click
  // again or click empty space to unpin). No-op unless the debug overlay is on.
  // The render id is `${carId}#${unit}`; the sim wants the base car id.
  private baseCarId(id: string): string {
    return id.split("#")[0];
  }
  onCarEnter(id: string): void {
    if (this.config.debug) this.game.setHoveredCar(this.baseCarId(id));
  }
  onCarLeave(): void {
    if (this.config.debug) this.game.clearHoveredCar();
  }
  onCarClick(id: string): void {
    if (this.config.debug) this.game.togglePinnedCar(this.baseCarId(id));
  }
  onBackgroundClick(): void {
    // A drag that ends over the board still fires a click; ignore it, or panning
    // would clear the inspected car every time.
    if (this.panning) return;
    if (this.config.debug) this.game.clearRouteCar();
  }

  get paused(): boolean {
    return this.game.paused.value;
  }
  get globalTimeScale(): number {
    return this.game.speed.value;
  }
  get delivered(): number {
    return this.game.deliveries.value;
  }

  // True when the level has no depots and at least one road tile.
  get roadOnly(): boolean {
    return isRoadOnlyLevel(this.level);
  }

  // Total trains in the level — the delivery goal, since each train parks once
  // it reaches its matching depot (so "all trains home" completes the level).
  get totalTrains(): number {
    return Object.keys(this.trains).length;
  }

  get deliveredPct(): number {
    return this.totalTrains
      ? Math.round((this.delivered / this.totalTrains) * 100)
      : 0;
  }

  get levelComplete(): boolean {
    return this.totalTrains > 0 && this.delivered >= this.totalTrains;
  }

  // Pop/glow the score card briefly whenever a new delivery lands.
  pulsing = false;
  private pulseTimer = 0;

  @Watch("delivered")
  onDelivered(now: number, prev: number) {
    if (now <= prev) return;
    // Restart the animation even on back-to-back deliveries: clear, then re-set
    // on the next frame so the CSS keyframes replay.
    this.pulsing = false;
    requestAnimationFrame(() => (this.pulsing = true));
    window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => (this.pulsing = false), 700);
  }

  // The most recent activity-log entries, newest first, for the debug panel.
  get recentLog() {
    return this.game.eventLog.slice(-60).reverse();
  }

  // Colour a train id in the log to match its sprite.
  trainColor(id: string): string {
    return this.game.trainColors[id] ?? "inherit";
  }

  // The current world theme's icon, shown compactly on the drawer button.
  get themeIcon(): string {
    return themeMeta(this.config.worldTheme).icon;
  }
  cycleTheme() {
    setWorldTheme(nextTheme(this.config.worldTheme));
  }

  switchDebugMode() {
    this.config.debug = !this.config.debug;
  }
  cycleSwitchLock() {
    const order: SwitchLockMode[] = ["off", "reserved", "occupied"];
    const next = (order.indexOf(this.config.switchLockMode) + 1) % order.length;
    this.config.switchLockMode = order[next];
  }
  get switchLockLabel(): string {
    switch (this.config.switchLockMode) {
      case "reserved":
        return "reserved";
      case "occupied":
        return "on train";
      default:
        return "off";
    }
  }
  // Road-traffic density %, set by the "Cars" slider (0–100). The game scales it
  // against the map's capacity and reads it live, so dragging re-targets density
  // immediately (100% packs the streets).
  get carCountLabel(): string {
    return this.config.maxCars === 0 ? "off" : `${this.config.maxCars}%`;
  }
  pausePlayGame() {
    this.game.paused.value = !this.game.paused.value;
  }
  changeGlobalTimeScale() {
    const currentIndex = this.speeds.indexOf(this.game.speed.value);
    this.game.speed.value =
      this.speeds[(currentIndex + 1) % this.speeds.length];
  }
}

export default toNative(PlayView);
</script>

<style lang="scss" scoped>
.level {
  display: grid;
  border: 1px solid green;
  // Positioned by the camera inside `.world-viewport`, not by flow: the camera
  // owns the offset (it centres a world smaller than the window itself), so a
  // `margin: 0 auto` here would fight it. `transform-origin` must be the corner
  // the camera's `scale() translate()` maths is expressed from.
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}
.level-tile {
  position: relative;
  flex: 0 0 auto;
  .debug & {
    outline: 1px solid red;
  }
}
.road-car {
  position: absolute;
  z-index: 6; // above the road surface and trains; booms (crossing) sit above
  top: 0;
  left: 0;
  // width is set inline per vehicle segment (car/truck/cab/trailer lengths).
  height: 20px;
  border-radius: 4px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.45);
  will-change: transform;
  overflow: hidden;
}
// In debug mode cars are clickable to inspect their route.
/* Debug: the car id pinned to the sprite (counter-rotated so it stays
   readable whatever way the car points). Identifies the cars the junction
   owner / hold chips talk about. */
.road-car-id {
  position: absolute;
  left: 50%;
  top: 50%;
  font-size: 8px;
  line-height: 1;
  font-weight: 700;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 3px;
  padding: 1px 2px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 7;
}
.road-car--inspect {
  cursor: pointer;
}
// A semi's cab: a touch darker and boxier than the trailer it pulls.
.road-car--cab {
  filter: brightness(0.82);
  border-radius: 4px 3px 3px 4px;
}
// A semi's trailer: a long boxy container, squarer corners, no windscreen.
.road-car--trailer {
  border-radius: 2px;
  filter: brightness(1.05);
}
.road-car-glass {
  position: absolute;
  top: 20%;
  bottom: 20%;
  left: 60%; // toward the front (local +x is the direction of travel)
  width: 26%;
  background: rgba(185, 222, 255, 0.9);
  border-radius: 2px;
}
// A rigid truck's cab is only the front of its longer body, so its windscreen is
// a small pane right at the nose rather than a wide window like a car's.
.road-car--truck .road-car-glass {
  left: 76%;
  width: 13%;
}
// A bus: a long, slightly taller coach. A row of side windows runs nearly the
// whole length (a repeating glass/pillar band), so it reads as a passenger bus
// rather than a cargo truck even before you notice it riding the bus lane.
.road-car--bus {
  height: 24px;
  border-radius: 6px;
  filter: brightness(1.08);
}
.road-car--bus .road-car-glass {
  top: 22%;
  bottom: 48%;
  left: 10%;
  width: 80%;
  border-radius: 2px;
  background: repeating-linear-gradient(
    90deg,
    rgba(185, 222, 255, 0.95) 0,
    rgba(185, 222, 255, 0.95) 7px,
    rgba(30, 44, 60, 0.55) 7px,
    rgba(30, 44, 60, 0.55) 10px
  );
}
// The fare pin lives in `components/FarePin.vue` — markup and styles both, so the
// two views that draw it cannot drift apart.
// ---- the build tool (Tycoon phase 2) ----
// One floating toggle: the whole build HUD off the board. The cost lives on the
// ghost preview's tag, not here.
// Build and Bulldoze sit in one centred row. They used to be positioned
// individually, the second by a hand-guessed pixel offset from centre — which
// was too small for the wider Build label and overlapped it by 76px. Laying
// them out in a flex row makes the arrangement independent of either label's
// width, so nothing has to be re-guessed when the wording changes.
.build-dock {
  position: fixed;
  z-index: 2000;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  max-width: calc(100vw - 24px);
}
.build-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  font: 700 15px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  color: #eef2f6;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.92),
    rgba(18, 22, 28, 0.92)
  );
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  cursor: pointer;

  &:hover {
    border-color: rgba(95, 211, 154, 0.55);
  }
}
.build-toggle--on {
  color: #0d1117;
  background: linear-gradient(90deg, #f5d97a, #d6a93c);
  border-color: rgba(245, 217, 122, 0.8);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), 0 0 18px rgba(245, 217, 122, 0.45);
}
// Bulldoze differs from Build only in its armed livery — the row places it.
.build-toggle--raze.build-toggle--on {
  color: #1a0e0e;
  background: linear-gradient(90deg, #f2a488, #d9663f);
  border-color: rgba(242, 164, 136, 0.8);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), 0 0 18px rgba(217, 102, 63, 0.45);
}
// Only tiles that would actually go light up, so the affordance never promises
// a removal the guard will refuse.
.level-tile--razeable {
  cursor: pointer;

  &:hover::after {
    content: "";
    position: absolute;
    inset: 6px;
    border: 2px dashed rgba(217, 102, 63, 0.9);
    border-radius: 10px;
    background: rgba(217, 102, 63, 0.16);
    pointer-events: none;
    z-index: 5;
  }
}
// The jam nudge: a strip under the score card, deliberately NOT an overlay —
// the fix is a click on the board behind it.
.gridlock-nudge {
  position: fixed;
  z-index: 2000;
  top: 96px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 10px 18px;
  font: 600 14px/1.35 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  color: #2a1a06;
  background: linear-gradient(90deg, #ffd88a, #f5b942);
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
  animation: gridlock-in 0.25s ease-out;
}
.gridlock-nudge__icon {
  font-size: 18px;
}
@keyframes gridlock-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-6px);
  }
}
.build-toggle__icon {
  font-size: 18px;
  line-height: 1;
}
// The edge hit-zone overlay: above the rails, but BELOW the road cars (6) and
// the fare pins (8) so a waiting train stays dispatchable mid-build.
.build-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 5;
}
// Edge hit-zones + wedge cues, matching the editor's look so the gesture reads
// as the same tool (both stylesheets are scoped, so the rules can't be shared).
.zone {
  fill: rgba(66, 184, 131, 0.05);
  stroke: none;
  cursor: pointer;
  transition: fill 0.08s;
  &:hover {
    fill: rgba(66, 184, 131, 0.28);
  }
}
.level-tile:hover .zone {
  stroke: rgba(44, 62, 80, 0.25);
  stroke-width: 1;
}
// An open-end target is the only zone on its tile, so it can afford to be
// obvious — and it needs to be, because before this the player was aiming at an
// invisible triangle tapering to a point.
.zone--open {
  fill: rgba(66, 184, 131, 0.14);

  &:hover {
    fill: rgba(66, 184, 131, 0.34);
  }
}
// The knob that says "a line ends here, build from it". Not interactive itself
// — the zone under it takes the click, across the whole half-tile.
.open-end {
  fill: #ffd76a;
  stroke: rgba(60, 44, 8, 0.75);
  stroke-width: 2;
  pointer-events: none;
  animation: open-end-pulse 1.6s ease-in-out infinite alternate;
}
@keyframes open-end-pulse {
  from {
    opacity: 0.65;
  }
  to {
    opacity: 1;
  }
}
.zone--armed,
.zone--armed:hover {
  fill: rgba(255, 179, 0, 0.45);
}
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
// Translucent ghost of the rails a commit would lay; red when the route cannot
// be afforded (the tag says why) — a refusal you can see before you click.
.preview-rail {
  fill: none;
  stroke: #2c3e50;
  stroke-width: 4;
  opacity: 0.45;
  stroke-linecap: round;
  pointer-events: none;
}
.preview-rail--refused {
  stroke: #d32f2f;
  opacity: 0.6;
}
// The head/frontier tile of an in-progress route.
.level-tile--build-glow {
  outline: 3px solid rgba(255, 179, 0, 0.75);
  outline-offset: -3px;
}
// The live price tag riding the hovered tile (Train Valley's -2000$).
.build-cost-tag {
  position: absolute;
  z-index: 9; // above the fare pins — it is the thing being decided right now
  top: 0;
  left: 0;
  padding: 4px 11px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  background: rgba(18, 22, 28, 0.92);
  color: #f4d47a;
  font: 800 14px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
}
.build-cost-tag--refused {
  color: #ff6b5e;
  border-color: rgba(255, 107, 94, 0.6);
}
.score-card {
  position: fixed;
  z-index: 2000;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  min-width: 340px;
  padding: 14px 22px 16px;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.92),
    rgba(18, 22, 28, 0.92)
  );
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  color: #eef2f6;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;

  &--pulse {
    animation: score-pop 0.6s ease;
  }
  &--complete {
    border-color: rgba(224, 188, 92, 0.55);
    animation: score-breathe 1.8s ease-in-out infinite;
  }
}
.score-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.score-icon {
  font-size: 26px;
  line-height: 1;
}
.score-label {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8fa3b3;
}
.score-count {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.score-now {
  font-size: 38px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  font-variant-numeric: tabular-nums;

  .score-card--complete & {
    color: #f0cf72;
    text-shadow: 0 0 16px rgba(240, 207, 114, 0.6);
  }
}
.score-sep {
  font-size: 22px;
  color: #5d6b77;
}
.score-total {
  font-size: 22px;
  font-weight: 700;
  color: #9aa7b2;
}
.score-check {
  margin-left: 4px;
  font-size: 22px;
  color: #5fd39a;
}
.score-bar {
  position: relative;
  height: 14px;
  margin-top: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.score-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2f9e6b, #5fd39a);
  box-shadow: 0 0 12px rgba(95, 211, 154, 0.5);
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  .score-card--complete & {
    background: linear-gradient(90deg, #d6a93c, #f5d97a);
    box-shadow: 0 0 14px rgba(245, 217, 122, 0.65);
  }
}
.score-pct {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.score-complete-banner {
  margin-top: 10px;
  text-align: center;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #f0cf72;
  text-shadow: 0 0 14px rgba(240, 207, 114, 0.55);
}
.score-banner-enter-active {
  transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.score-banner-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

@keyframes score-pop {
  0% {
    transform: translateX(-50%) scale(1);
  }
  35% {
    transform: translateX(-50%) scale(1.06);
  }
  100% {
    transform: translateX(-50%) scale(1);
  }
}
@keyframes score-breathe {
  0%,
  100% {
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45),
      0 0 16px rgba(224, 188, 92, 0.25);
  }
  50% {
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45),
      0 0 30px rgba(224, 188, 92, 0.5);
  }
}

.score-timer {
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #cdd7df;
}
.score-money {
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  font-size: 17px;
  letter-spacing: 0.01em;
  color: #f4d47a;
}
.score-calendar {
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 13px;
  color: #b6c2cc;
  // Replayed on every levy: the element is keyed on the tax paid, so a new
  // total re-creates it and the animation runs once. A silent balance drop is
  // the failure this guards against.
  animation: tax-levy 1.1s ease-out;
}
.score-tax {
  margin-left: 6px;
  color: #d9a3a3;
}
// Insolvency warning: the bill outgrew the balance. Loud on purpose — this is
// the last moment bulldozing can still save the run.
.score-calendar--broke {
  color: #e2574c;

  .score-tax {
    color: #e2574c;
  }
}
.score-tax-warn {
  display: block;
  margin-top: 2px;
  color: #e2574c;
  font-size: 12px;
  animation: tax-warn-pulse 1.6s ease-in-out infinite;
}
@keyframes tax-warn-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
@keyframes tax-levy {
  0% {
    color: #e2574c;
    transform: translateX(0);
  }
  15% {
    transform: translateX(-2px);
  }
  30% {
    transform: translateX(2px);
  }
  45% {
    transform: translateX(0);
  }
}
.score-crossing {
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #8fd19e; // calm green while traffic flows
  transition: color 0.3s ease;
}
.score-crossing--warn {
  color: #e6c34a; // amber as a wait builds
}
.score-crossing--bad {
  color: #e2574c; // red when a car is stuck dangerously long
}
.score-stars {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}
.star-pip {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.18);
  transition: color 0.3s ease, text-shadow 0.3s ease;
  &--on {
    color: #f0cf72;
    text-shadow: 0 0 10px rgba(240, 207, 114, 0.6);
  }
  &--lg {
    font-size: 34px;
  }
}
.game-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 11, 15, 0.62);
  backdrop-filter: blur(4px);
}
.overlay-card {
  min-width: 320px;
  padding: 28px 34px;
  text-align: center;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.97),
    rgba(18, 22, 28, 0.97)
  );
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  color: #eef2f6;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
}
.overlay-title {
  margin: 0 0 8px;
  font-size: 26px;
}
.overlay-desc {
  margin: 8px 0 18px;
  color: #9aa7b2;
  max-width: 360px;
}
.overlay-best {
  margin: 0 0 8px;
  color: #f0cf72;
  font-weight: 700;
}
.overlay-stars {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 8px 0;
}
.overlay-btn {
  padding: 12px 28px;
  font-size: 16px;
  font-weight: 700;
  color: #0d1117;
  background: linear-gradient(90deg, #5fd39a, #2f9e6b);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  &:hover {
    filter: brightness(1.08);
  }
  &--ghost {
    margin-top: 10px;
    color: #cdd7df;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.18);
    font-weight: 600;
    &:hover {
      background: rgba(255, 255, 255, 0.08);
      filter: none;
    }
  }
}

// ---- Game-mode picker ----
.picker-card {
  width: min(720px, 92vw);
  max-height: 88vh;
  overflow-y: auto;
  padding: 26px 30px 22px;
  text-align: center;
  background: linear-gradient(
    160deg,
    rgba(28, 34, 42, 0.98),
    rgba(18, 22, 28, 0.98)
  );
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  color: #eef2f6;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
}
.mode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin: 18px 0 8px;
}
.mode-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  position: relative;
  padding: 16px 16px 18px;
  text-align: left;
  color: #eef2f6;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease,
    background 0.15s ease;
  &:hover {
    transform: translateY(-2px);
    border-color: rgba(95, 211, 154, 0.6);
    background: rgba(95, 211, 154, 0.08);
  }
  &--active {
    border-color: rgba(240, 207, 114, 0.7);
    background: rgba(240, 207, 114, 0.1);
  }
}
.mode-card__icon {
  font-size: 30px;
  line-height: 1;
}
.mode-card__label {
  font-size: 17px;
  font-weight: 800;
}
.mode-card__desc {
  font-size: 12.5px;
  line-height: 1.4;
  color: #9aa7b2;
}
.mode-card__badge {
  position: absolute;
  top: 10px;
  right: 10px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f0cf72;
}

.event-log {
  position: fixed;
  z-index: 2000;
  right: 0;
  top: 0;
  width: 320px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: rgba(20, 24, 28, 0.92);
  color: #d7dde3;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  border-bottom-left-radius: 6px;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.4);
}
.event-log--min {
  width: auto;
}
.event-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 6px 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);

  .event-log--min & {
    border-bottom: none;
  }
}
.event-log-title {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8fa3b3;
}
.event-log-toggle {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  line-height: 18px;
  padding: 0;
  min-width: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: #d7dde3;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.18);
  }
}
.event-log-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
}
.event-log-empty {
  padding: 8px 10px;
  color: #6b7782;
  font-style: italic;
}
.event-log-entry {
  display: flex;
  gap: 6px;
  padding: 2px 10px;
  white-space: nowrap;
  border-left: 3px solid transparent;
  text-align: left;

  &.log-blocked {
    border-left-color: #e0564b;
  }
  &.log-proceeding {
    border-left-color: #4caf78;
  }
  &.log-reserved {
    border-left-color: #5b8dd6;
  }
  &.log-arrived {
    border-left-color: #d6b14c;
  }
}
.log-time {
  color: #6b7782;
  flex: 0 0 auto;
  min-width: 38px;
}
.log-train {
  font-weight: 700;
  flex: 0 0 auto;
}
.log-text {
  color: #d7dde3;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
