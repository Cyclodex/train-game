<template>
  <div class="editor-view" :class="{ debug: config.debug }">
    <div class="toolbar">
      <router-link class="nav-link" to="/play">▶ Play</router-link>
      <span class="group">
        <button
          v-for="t in tools"
          :key="t"
          :class="{ active: tool === t }"
          @click="tool = t"
        >
          {{ t }}
        </button>
      </span>
      <span class="group">
        <button @click="randomMap">🎲 Random</button>
        <button @click="clearAll">Clear</button>
        <button :disabled="!canPlay" @click="playThis">Play this →</button>
      </span>
      <span class="group">
        <button @click="exportJson">Export</button>
        <button @click="importJson">Import</button>
      </span>
      <span class="status" :class="{ 'status--bad': !valid.ok }">
        {{ valid.ok ? "✓ valid" : valid.issues.length + " issue(s)" }}
        <template v-if="depotIds.length"> · {{ depotIds.length }} depots</template>
      </span>
    </div>

    <div class="hint">{{ hint }}</div>

    <div
      class="level editor-grid"
      :style="{ width: config.tileSize * config.levelSizeX + 'px' }"
      @mouseup="dragFrom = null"
      @mouseleave="dragFrom = null"
    >
      <div
        v-for="cell in gridCells"
        :key="cell.key"
        class="level-tile editor-cell"
        :data-coord="cell.key"
        :class="{ 'editor-cell--issue': issueIds.has(cell.key) }"
        :style="{
          width: config.tileSize + 'px',
          height: config.tileSize + 'px',
        }"
        @click="onCellClick(cell.key)"
      >
        <Tile
          v-if="cell.tile"
          :tile="cell.tile"
          :coord-id="cell.key"
          class="tile-component"
        />

        <svg
          class="overlay"
          :viewBox="`0 0 ${config.tileSize} ${config.tileSize}`"
        >
          <!-- Deletable connection hit-paths (connect mode) -->
          <template v-if="tool === 'connect' && cell.tile">
            <path
              v-for="(conn, i) in cell.tile.connections"
              :key="'c' + i"
              :d="connPath(conn)"
              class="conn-hit"
              @click.stop="deleteConn(cell.key, conn)"
            />
          </template>

          <!-- Port dots (connect + signal modes) -->
          <template v-if="tool === 'connect' || tool === 'signal'">
            <circle
              v-for="p in EDGES"
              :key="'p' + p"
              :data-port="p"
              :cx="dot(p).x"
              :cy="dot(p).y"
              r="12"
              class="port"
              :class="{
                'port--armed': isArmed(cell.key, p),
                'port--signal': hasSignal(cell.tile, p),
              }"
              @mousedown.stop="onPortDown(cell.key, p)"
              @mouseup.stop="onPortUp(cell.key, p)"
              @click.stop="onPortClick(cell.key, p)"
            />
          </template>
        </svg>
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
import { markRaw, reactive } from "vue";
import { Component, Inject, Provide, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import type { Game } from "@/game";
import { Position } from "@/types";
import { Level, Port, PortPair, portsOf, parseCoordId } from "@/tiles/model";
import {
  emptyCell,
  toggleConnection,
  removeConnection,
  setDepot,
  rotateDepot,
  toggleSignalPort,
} from "@/tiles/editOps";
import { validateLevel, ValidationResult, TrainRoute } from "@/tiles/validate";
import { generateLevel } from "@/tiles/generate";
import { segmentPathD } from "@/sim/pathGeometry";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { setCustomLevel, trainsFromRoutes } from "@/levelStore";

type Tool = "connect" | "depot" | "signal" | "erase";

const LEVEL_KEY = "train-game:editor-level";
const EDGES: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

const HINTS: Record<Tool, string> = {
  connect: "Drag between two edge dots to lay a rail. Click a rail to delete it.",
  depot: "Click a cell to place a depot. Click it again to rotate its facing.",
  signal: "Click an edge dot to toggle a signal for that direction.",
  erase: "Click a cell to clear it.",
};

// A no-op stand-in for the live Game so Tile.vue can render in the editor.
function stubGame(): Game {
  const empty: Record<string, never> = {};
  return {
    depotColors: {},
    trainColors: {},
    switches: reactive({}),
    reservations: empty,
    occupied: empty,
    signalAspects: empty,
    signalOverrides: empty,
    cycleSignal: () => {},
  } as unknown as Game;
}

@Component
class EditorView extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Provide("game") game: Game = markRaw(stubGame());

  EDGES = EDGES;
  levelSizeY = 6;
  tools: Tool[] = ["connect", "depot", "signal", "erase"];
  tool: Tool = "connect";
  level: Level = reactive(loadLevel());
  dragFrom: { id: string; port: Port } | null = null;
  showIo = false;
  ioText = "";

  get hint(): string {
    return HINTS[this.tool];
  }

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
  get canPlay(): boolean {
    return this.routes.length > 0 && this.valid.ok;
  }

  get gridCells(): { key: string; tile: Level[string] | null }[] {
    const out: { key: string; tile: Level[string] | null }[] = [];
    for (let y = 0; y < this.levelSizeY; y++) {
      for (let x = 0; x < this.config.levelSizeX; x++) {
        const key = `${x},${y}`;
        const tile = this.level[key];
        out.push({ key, tile: tile && tile.connections.length ? tile : null });
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
  connPath(conn: PortPair): string {
    return segmentPathD(conn[0], conn[1], this.config.tileSize);
  }
  isArmed(id: string, port: Port): boolean {
    return this.dragFrom?.id === id && this.dragFrom?.port === port;
  }
  hasSignal(tile: Level[string] | null, port: Port): boolean {
    return !!tile?.signals?.includes(port);
  }

  cellOf(id: string): Level[string] {
    return this.level[id] ?? emptyCell();
  }
  commit(id: string, cell: Level[string]) {
    if (cell.connections.length === 0 && !cell.signals?.length) {
      delete this.level[id];
    } else {
      this.level[id] = cell;
    }
    this.persist();
  }

  // --- connect tool ---
  onPortDown(id: string, port: Port) {
    if (this.tool !== "connect") return;
    this.dragFrom = { id, port };
  }
  onPortUp(id: string, port: Port) {
    if (this.tool !== "connect" || !this.dragFrom) return;
    if (this.dragFrom.id === id && this.dragFrom.port !== port) {
      this.commit(id, toggleConnection(this.cellOf(id), this.dragFrom.port, port));
    }
    this.dragFrom = null;
  }
  deleteConn(id: string, conn: PortPair) {
    this.commit(id, removeConnection(this.cellOf(id), conn[0], conn[1]));
  }

  // --- signal tool ---
  onPortClick(id: string, port: Port) {
    if (this.tool !== "signal") return;
    this.commit(id, toggleSignalPort(this.cellOf(id), port));
  }

  // --- depot / erase (cell-level click) ---
  onCellClick(id: string) {
    if (this.tool === "depot") {
      const cur = this.level[id];
      this.commit(id, cur?.role === "depot" ? rotateDepot(cur) : setDepot(emptyCell(), this.autoFacing(id)));
    } else if (this.tool === "erase") {
      delete this.level[id];
      this.persist();
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

  // --- toolbar actions ---
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
  playThis() {
    if (!this.canPlay) return;
    setCustomLevel({
      level: JSON.parse(JSON.stringify(this.level)),
      trains: trainsFromRoutes(this.routes),
    });
    this.$router.push("/play");
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
  try {
    const raw = localStorage.getItem(LEVEL_KEY);
    if (raw) return JSON.parse(raw) as Level;
  } catch {
    /* ignore */
  }
  return {};
}

export default toNative(EditorView);
</script>

<style lang="scss" scoped>
.editor-view {
  padding-top: 88px;
}
.toolbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  background: #f4f4f4;
  border-bottom: 1px solid #ccc;

  .group {
    display: inline-flex;
    gap: 4px;
  }
  button,
  .nav-link {
    padding: 8px 12px;
    cursor: pointer;
    text-transform: capitalize;
  }
  .nav-link {
    background: #2c3e50;
    color: #fff;
    text-decoration: none;
    border-radius: 3px;
  }
  button.active {
    background: #42b883;
    color: #fff;
  }
  .status {
    margin-left: auto;
    font-weight: bold;
    color: #2e7d32;
  }
  .status--bad {
    color: #c62828;
  }
}
.hint {
  position: fixed;
  top: 52px;
  left: 12px;
  z-index: 100;
  font-size: 12px;
  color: #555;
}
.level {
  display: flex;
  flex-wrap: wrap;
  margin: 0 auto;
  position: relative;
  border: 1px solid green;
}
.editor-grid .level-tile {
  position: relative;
  flex: 0 0 auto;
  outline: 1px solid #ddd;
  cursor: crosshair;
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
.port {
  fill: rgba(66, 184, 131, 0.35);
  stroke: #2c3e50;
  stroke-width: 1;
  cursor: pointer;
  &:hover {
    fill: rgba(66, 184, 131, 0.8);
  }
}
.port--armed {
  fill: #ffb300;
}
.port--signal {
  fill: #ff3b30;
}
.conn-hit {
  stroke: transparent;
  stroke-width: 24;
  fill: none;
  cursor: pointer;
  &:hover {
    stroke: rgba(255, 59, 48, 0.4);
  }
}
.io-box {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 100px;
  font-family: monospace;
  font-size: 11px;
}
</style>
