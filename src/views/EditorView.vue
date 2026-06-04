<template>
  <div class="editor-view" :class="{ debug: config.debug }">
    <div class="toolbar">
      <router-link class="nav-link" to="/play">▶ Play</router-link>
      <span class="group">
        <button :class="{ active: tool === 'track' }" @click="tool = 'track'">
          Track
        </button>
        <button :class="{ active: tool === 'depot' }" @click="tool = 'depot'">
          Depot
        </button>
        <button :class="{ active: tool === 'erase' }" @click="tool = 'erase'">
          Erase
        </button>
      </span>
      <span class="group">
        <button @click="randomMap">🎲 Random</button>
        <button @click="clearAll">Clear</button>
        <button @click="playThis" :disabled="!canPlay">Play this →</button>
      </span>
      <span class="group">
        <button @click="exportJson">Export</button>
        <button @click="importJson">Import</button>
      </span>
      <span class="status" :class="{ 'status--bad': !valid.ok }">
        {{ valid.ok ? "✓ valid" : valid.issues.length + " issue(s)" }}
        <template v-if="depotCount"> · {{ depotCount }} depots</template>
      </span>
    </div>

    <div
      class="level editor-grid"
      :style="{ width: config.tileSize * config.levelSizeX + 'px' }"
      @mouseleave="painting = false"
      @mouseup="painting = false"
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
        @mousedown="onDown(cell.key)"
        @mouseenter="onEnter(cell.key)"
      >
        <Tile
          v-if="cell.tile"
          :tile="cell.tile"
          :coord-id="cell.key"
          class="tile-component"
        />
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
import { Level } from "@/tiles/model";
import { PaintMap, deriveLevel } from "@/tiles/autotile";
import { validateLevel, ValidationResult, TrainRoute } from "@/tiles/validate";
import { generateLevel } from "@/tiles/generate";
import { setCustomLevel, trainsFromRoutes } from "@/levelStore";

type Tool = "track" | "depot" | "erase";

const PAINT_KEY = "train-game:editor-paint";

// A no-op stand-in for the live Game so Tile.vue can render in the editor
// without a running simulation. Tile only reads these maps + calls cycleSignal.
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

  levelSizeY = 6;
  tool: Tool = "track";
  painting = false;
  paint: PaintMap = reactive(loadPaint());
  showIo = false;
  ioText = "";

  get level(): Level {
    return deriveLevel(this.paint);
  }
  get valid(): ValidationResult {
    return validateLevel(this.level, this.routes);
  }
  get issueIds(): Set<string> {
    return new Set(
      this.valid.issues.map(i => i.tileId).filter((x): x is string => !!x)
    );
  }
  get depotIds(): string[] {
    return Object.keys(this.level).filter(id => this.level[id].role === "depot");
  }
  get depotCount(): number {
    return this.depotIds.length;
  }
  get routes(): TrainRoute[] {
    const d = this.depotIds;
    const out: TrainRoute[] = [];
    for (let i = 0; i + 1 < d.length; i += 2) out.push({ from: d[i], to: d[i + 1] });
    return out;
  }
  get canPlay(): boolean {
    return this.routes.length > 0 && this.valid.ok;
  }

  get gridCells(): { key: string; tile: Level[string] | null }[] {
    const lvl = this.level;
    const out: { key: string; tile: Level[string] | null }[] = [];
    for (let y = 0; y < this.levelSizeY; y++) {
      for (let x = 0; x < this.config.levelSizeX; x++) {
        const key = `${x},${y}`;
        out.push({ key, tile: lvl[key] ?? null });
      }
    }
    return out;
  }

  onDown(id: string) {
    this.painting = true;
    this.apply(id);
  }
  onEnter(id: string) {
    if (this.painting) this.apply(id);
  }

  apply(id: string) {
    if (this.tool === "erase") delete this.paint[id];
    else if (this.tool === "depot") this.paint[id] = { paint: "depot" };
    else this.paint[id] = { paint: "track" };
    this.persist();
  }

  clearAll() {
    for (const k of Object.keys(this.paint)) delete this.paint[k];
    this.persist();
  }

  randomMap() {
    const seed = Math.floor(Math.random() * 1e9);
    const { level } = generateLevel(seed, {
      width: this.config.levelSizeX,
      height: this.levelSizeY,
      depotPairs: 2,
    });
    // Load the generated level back into the paint model (track / depot), then
    // re-derive — the editor's source of truth stays the paint map.
    for (const k of Object.keys(this.paint)) delete this.paint[k];
    for (const [id, c] of Object.entries(level)) {
      this.paint[id] = c.role === "depot" ? { paint: "depot" } : { paint: "track" };
    }
    this.persist();
  }

  playThis() {
    if (!this.canPlay) return;
    setCustomLevel({
      level: this.level,
      trains: trainsFromRoutes(this.routes),
    });
    this.$router.push("/play");
  }

  exportJson() {
    this.ioText = JSON.stringify(this.paint);
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
      const parsed = JSON.parse(this.ioText) as PaintMap;
      for (const k of Object.keys(this.paint)) delete this.paint[k];
      Object.assign(this.paint, parsed);
      this.persist();
    } catch {
      // leave the box open so the user can fix invalid JSON
    }
  }

  persist() {
    try {
      localStorage.setItem(PAINT_KEY, JSON.stringify(this.paint));
    } catch {
      /* ignore */
    }
  }
}

function loadPaint(): PaintMap {
  try {
    const raw = localStorage.getItem(PAINT_KEY);
    if (raw) return JSON.parse(raw) as PaintMap;
  } catch {
    /* ignore */
  }
  return {};
}

export default toNative(EditorView);
</script>

<style lang="scss" scoped>
.editor-view {
  padding-top: 60px;
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
// Route all pointer events to the paint layer, not Tile's own handlers.
.editor-cell :deep(.tile) {
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
