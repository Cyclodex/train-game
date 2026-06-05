<template>
  <div class="editor-view" :class="{ debug: config.debug }">
    <div class="toolbar">
      <router-link class="nav-link" to="/play">▶ Play</router-link>
      <span class="group">
        <button
          v-for="t in tools"
          :key="t"
          :class="{ active: tool === t }"
          @click="setTool(t)"
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
      @mouseup="pressFrom = null"
      @mouseleave="pressFrom = null"
    >
      <div
        v-for="cell in gridCells"
        :key="cell.key"
        class="level-tile editor-cell"
        :data-coord="cell.key"
        :class="{
          'editor-cell--issue': issueIds.has(cell.key),
          'editor-cell--armed': armed != null && armed.id === cell.key,
        }"
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
          <!-- Ghost preview of the rail an armed edge would lay to the hovered
               edge, so the builder sees what they're about to make. -->
          <path
            v-for="(d, i) in previewRails(cell.key)"
            :key="'pv' + i"
            :d="d"
            class="preview-rail"
          />

          <!-- Edge hit-zones: the whole tile is clickable, split into four
               triangles (one per edge) for big, kid-friendly targets. -->
          <template v-if="tool === 'connect' || tool === 'signal'">
            <path
              v-for="p in EDGES"
              :key="'z' + p"
              :data-port="p"
              :d="zonePath(p)"
              class="zone"
              :class="{
                'zone--armed': isArmed(cell.key, p),
                'zone--signal': tool === 'signal' && hasSignal(cell.tile, p),
              }"
              @mousedown.stop="onZoneDown(cell.key, p)"
              @mouseup.stop="onZoneUp(cell.key, p)"
              @click.stop="onZoneClick(cell.key, p)"
              @mouseenter="onZoneEnter(cell.key, p)"
              @mouseleave="onZoneLeave(cell.key, p)"
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

          <!-- Rail-delete handles (erase mode): a tappable ✕ near the middle of
               each rail removes just that connection (clicking elsewhere on the
               tile erases the whole tile). -->
          <template v-if="tool === 'erase' && cell.tile">
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
import { railPathsFor } from "@/tiles/geometry";
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
  connect:
    "Click one edge then another (or drag between them) to lay a rail.",
  depot: "Click a cell to place a depot. Click it again to rotate its facing.",
  signal: "Click an edge to toggle a signal for that direction.",
  erase: "Click a tile to clear it, or tap a rail's ✕ to remove just that connection.",
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
  // `pressFrom` tracks an in-progress drag gesture; `armed` is the first edge
  // picked in the two-click (click → click) connection flow.
  pressFrom: { id: string; port: Port } | null = null;
  armed: { id: string; port: Port } | null = null;
  // The edge currently hovered, used to ghost-preview the rail an armed edge
  // would connect to.
  hoverPort: { id: string; port: Port } | null = null;
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
    return this.armed?.id === id && this.armed?.port === port;
  }
  // The ghost rails to draw on `id`: only when an edge here is armed and a
  // different edge of the same tile is hovered.
  previewRails(id: string): string[] {
    const a = this.armed;
    const h = this.hoverPort;
    if (this.tool !== "connect" || !a || !h) return [];
    if (a.id !== id || h.id !== id || a.port === h.port) return [];
    return railPathsFor(
      a.port,
      h.port,
      this.config.tileSize,
      this.config.railDistanceFromPath
    );
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

  // --- connect tool: drag gesture ---
  // A drag starts here; if it ends on a different edge of the same tile
  // (onZoneUp) it lays a rail. The browser only fires `click` when down and up
  // share an element, so a drag never also triggers the click→click flow below.
  onZoneDown(id: string, port: Port) {
    if (this.tool !== "connect") return;
    this.pressFrom = { id, port };
  }
  onZoneUp(id: string, port: Port) {
    if (this.tool !== "connect") return;
    const from = this.pressFrom;
    this.pressFrom = null;
    if (from && from.id === id && from.port !== port) {
      this.commit(id, toggleConnection(this.cellOf(id), from.port, port));
      this.armed = null;
    }
  }
  // --- connect/signal tool: click ---
  onZoneClick(id: string, port: Port) {
    if (this.tool === "signal") {
      this.commit(id, toggleSignalPort(this.cellOf(id), port));
      return;
    }
    if (this.tool !== "connect") return;
    const a = this.armed;
    if (a && a.id === id && a.port === port) {
      this.armed = null; // tapping the armed edge again cancels
    } else if (a && a.id === id) {
      this.commit(id, toggleConnection(this.cellOf(id), a.port, port));
      this.armed = null;
    } else {
      this.armed = { id, port }; // arm this edge (or move the arm to a new tile)
    }
  }
  onZoneEnter(id: string, port: Port) {
    if (this.tool === "connect") this.hoverPort = { id, port };
  }
  onZoneLeave(id: string, port: Port) {
    if (this.hoverPort?.id === id && this.hoverPort?.port === port) {
      this.hoverPort = null;
    }
  }
  deleteConn(id: string, conn: PortPair) {
    this.commit(id, removeConnection(this.cellOf(id), conn[0], conn[1]));
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
  setTool(t: Tool) {
    this.tool = t;
    this.armed = null;
    this.pressFrom = null;
    this.hoverPort = null;
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
  fill: rgba(66, 184, 131, 0.06);
  stroke: rgba(44, 62, 80, 0.18);
  stroke-width: 1;
  cursor: pointer;
  transition: fill 0.08s;
  &:hover {
    fill: rgba(66, 184, 131, 0.28);
  }
}
.zone--armed,
.zone--armed:hover {
  fill: rgba(255, 179, 0, 0.45);
}
.zone--signal {
  fill: rgba(255, 59, 48, 0.28);
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
.del {
  cursor: pointer;
}
.del-bg {
  fill: rgba(255, 59, 48, 0.85);
  stroke: #fff;
  stroke-width: 1.5;
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
