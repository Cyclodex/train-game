<template>
  <div class="editor-view" :class="{ debug: config.debug }">
    <MenuDrawer id="editor" title="Editor">
      <button
        class="drawer-btn accent"
        :disabled="!canPlay"
        @click="playThis"
      >
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
      </div>
    </MenuDrawer>

    <ToolDock :hint="hint">
      <button
        v-for="t in tools"
        :key="t"
        class="dock-btn"
        :class="{ on: tool === t }"
        @click="setTool(t)"
      >
        <span class="dock-btn__icon">{{ toolMeta[t].icon }}</span>
        <span>{{ toolMeta[t].label }}</span>
      </button>
    </ToolDock>

    <div class="world">
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
          'editor-cell--armed': glowId === cell.key,
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
            <!-- Road-delete handles: a ✕ on each road pair removes just it. -->
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

          <!-- Junction switch zones: one clickable spot over each junction
               entry's switch widget. Painted after the edge zones so it sits in
               front and intercepts the click, cycling that entry's authored
               starting arm. Available in any tool — it only covers the widget. -->
          <circle
            v-for="entry in junctionEntries(cell.tile)"
            :key="'sw' + entry"
            :cx="switchPoint(entry).x"
            :cy="switchPoint(entry).y"
            r="15"
            class="switch-zone"
            @click.stop="onSwitchClick(cell.key, entry)"
          />
        </svg>
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
import { markRaw, reactive } from "vue";
import { Component, Inject, Provide, Vue, Watch, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY, setWorldTheme } from "@/gameConfig";
import { nextTheme, themeMeta } from "@/themes";
import MenuDrawer from "@/components/MenuDrawer.vue";
import ToolDock from "@/components/ToolDock.vue";
import type { Game } from "@/game";
import { initialSwitches } from "@/game";
import { Position } from "@/types";
import {
  Level,
  Port,
  PortPair,
  portsOf,
  isJunctionEntry,
  parseCoordId,
} from "@/tiles/model";
import {
  emptyCell,
  addConnection,
  removeConnection,
  addRoad,
  removeRoad,
  setDepot,
  rotateDepot,
  toggleSignalPort,
  cycleDefaultArm,
} from "@/tiles/editOps";
import { validateLevel, ValidationResult, TrainRoute } from "@/tiles/validate";
import { generateLevel } from "@/tiles/generate";
import { railPathsFor } from "@/tiles/geometry";
import { roadSurfacePath } from "@/tiles/roadGeometry";
import { planRoute, OpenEnd } from "@/tiles/routePlanner";
import { roadEdges as laneEdges } from "@/tiles/lanes";
import { neighborCoord, oppositePort } from "@/sim/topology";
import { getCoordinatesId } from "@/utils/tileHelpers";
import { setCustomLevel, trainsFromRoutes } from "@/levelStore";

type Tool = "connect" | "depot" | "signal" | "erase" | "road";

const LEVEL_KEY = "train-game:editor-level";
const EDGES: Port[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

const HINTS: Record<Tool, string> = {
  connect:
    "Click an edge, then click tiles to route a track (corner by corner). Click the start edge again or press Esc to finish. Drag for a quick single rail. Click a junction's switch to set its starting direction.",
  depot: "Click a cell to place a depot. Click it again to rotate its facing.",
  signal: "Click an edge to toggle a signal for that direction.",
  erase: "Click a tile to clear it, or tap a rail's ✕ to remove just that connection.",
  road: "Click an edge, then click tiles to route a road (corner by corner, curves and all). Click the start edge again or press Esc to finish. Drag for a quick single road. A road over track becomes a level crossing.",
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

@Component({ components: { MenuDrawer, ToolDock } })
class EditorView extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Provide("game") game: Game = markRaw(stubGame());

  EDGES = EDGES;
  levelSizeY = 6;
  // Build-tool order in the dock (rail + road grouped first). `setTool` logic is
  // unaffected by order.
  tools: Tool[] = ["connect", "road", "depot", "signal", "erase"];
  tool: Tool = "connect";
  // Big, kid-friendly icon + label for each build tool, shown in the dock.
  toolMeta: Record<Tool, { icon: string; label: string }> = {
    connect: { icon: "🚂", label: "Rail" },
    road: { icon: "🚗", label: "Road" },
    depot: { icon: "🏠", label: "Depot" },
    signal: { icon: "🚦", label: "Signal" },
    erase: { icon: "🧽", label: "Erase" },
  };
  level: Level = reactive(loadLevel());
  // `pressFrom` tracks an in-progress drag gesture; `armed` is the first edge
  // picked in the two-click (click → click) connection flow.
  pressFrom: { id: string; port: Port } | null = null;
  // `armed` is the route head: the open end the track grows from. In route mode
  // each click extends the route and advances the head; clicking the head edge
  // again (or Esc) finishes. `routeStarted` becomes true once the route's first
  // segment is laid, so the start tile is only laid once.
  armed: { id: string; port: Port } | null = null;
  routeStarted = false;
  // Set only in the U-turn case: the frontier tile is left undecided (blank)
  // because you're pointing at the edge the track entered through. The head
  // then trails one tile back, pointing at this pending tile.
  pendingId: string | null = null;
  // The edge currently hovered, used to ghost-preview the route.
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
    // Only the start edge shows the armed wedge; once routing the glow follows
    // the pending frontier tile instead.
    return !this.routeStarted && this.armed?.id === id && this.armed?.port === port;
  }
  // The open-end wedge that finishes the route when clicked again — highlighted
  // distinctly while routing so it's obvious where to stop.
  isFinish(id: string, port: Port): boolean {
    return this.routeStarted && this.armed?.id === id && this.armed?.port === port;
  }
  get routeOpts() {
    // `passable` is left default (everything passable); the future "blocked
    // tiles" feature plugs in here without touching the router.
    return { width: this.config.levelSizeX, height: this.levelSizeY };
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
    return this.drawing === "road"
      ? addRoad(cell, a, b)
      : addConnection(cell, a, b);
  }
  // The CSS class for the ghost preview, so a road previews as a road ribbon.
  get previewClass(): string {
    return this.drawing === "road" ? "preview-road" : "preview-rail";
  }
  // Ghost rails for the whole previewed route, keyed by cell id. Anchors on the
  // in-progress drag start if there is one, otherwise the route head — so the
  // preview spans every tile for both gestures.
  get previewByCell(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const from = this.pressFrom ?? this.armed;
    const to = this.hoverPort;
    if (!this.drawing || !from || !to) return out;
    const steps = planRoute(
      { id: from.id, edge: from.port },
      { id: to.id, edge: to.port },
      this.routeOpts
    );
    if (!steps) return out;
    const size = this.config.tileSize;
    const off = this.config.railDistanceFromPath;
    const add = (id: string, a: Port, b: Port) => {
      const paths =
        this.drawing === "road"
          ? [roadSurfacePath(a, b, size)]
          : railPathsFor(a, b, size, off);
      (out[id] ??= []).push(...paths);
    };
    // The start tile is laid as a straight only for the first segment of a
    // fresh route (drag is always a one-shot first segment).
    if ((this.pressFrom || !this.routeStarted) && from.id !== to.id) {
      add(from.id, oppositePort(from.port), from.port);
    }
    // The pointed-at tile draws `incoming -> hovered edge` for its three exit
    // edges; it's left blank only when you point at the edge the track enters
    // through (a U-turn). A one-shot drag always draws its whole route.
    const last = steps[steps.length - 1];
    const uTurn = !this.pressFrom && to.port === last.a;
    const count = uTurn ? steps.length - 1 : steps.length;
    for (let i = 0; i < count; i++) add(steps[i].id, steps[i].a, steps[i].b);
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
  // The centre of an entry's switch widget, in tile (overlay) coordinates, kept
  // in step with `.switch-box--N` in Tile.vue (a 24×18 box hugging that edge).
  switchPoint(entry: Port): { x: number; y: number } {
    const s = this.config.tileSize;
    const along = 0.57 * s + 12; // box offset (left/top:57%) + half its width
    switch (entry) {
      case Position.Top:
        return { x: along, y: 9 };
      case Position.Right:
        return { x: s - 12, y: along };
      case Position.Bottom:
        return { x: along, y: s - 9 };
      default:
        return { x: 12, y: along }; // Left
    }
  }
  // Clicking a switch zone cycles that entry's authored starting arm and persists.
  // The zone is painted in front of the edge zones, so it intercepts the click.
  onSwitchClick(id: string, entry: Port) {
    this.commit(id, cycleDefaultArm(this.cellOf(id), entry));
  }
  // Mirror the level's effective starting arms into the (stub) game so Tile.vue's
  // switch widget lights the authored bulb — the same seeding play uses.
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
    if (cell.connections.length === 0 && !cell.signals?.length && !cell.road?.length) {
      delete this.level[id];
    } else {
      this.level[id] = cell;
    }
    this.persist();
  }

  // Lay every connection of the route from `from` to `to`. For the first
  // segment of a route (and every one-shot drag) the anchor tile is also laid
  // as a straight in its clicked direction. Returns the route's new open end
  // (the last tile + the edge its rail actually exits) so the head can advance
  // there — which may differ from the clicked edge (e.g. a back-pointing click
  // becomes a straight-through). Null if no route fits.
  commitSegment(from: OpenEnd, to: OpenEnd, layAnchor: boolean): OpenEnd | null {
    const steps = planRoute(from, to, this.routeOpts);
    if (!steps || steps.length === 0) return null;
    if (layAnchor && from.id !== to.id) {
      this.commit(
        from.id,
        this.layPair(this.cellOf(from.id), oppositePort(from.edge), from.edge)
      );
    }
    for (const s of steps) {
      this.commit(s.id, this.layPair(this.cellOf(s.id), s.a, s.b));
    }
    const last = steps[steps.length - 1];
    return { id: last.id, edge: last.b };
  }
  // The tile to glow: the pending frontier tile (U-turn case) while routing,
  // otherwise the head/last tile, else the start.
  get glowId(): string | null {
    return this.pendingId ?? this.armed?.id ?? null;
  }
  finishRoute() {
    if (this.pendingId && this.armed) {
      // Lock the still-undecided frontier tile as a plain straight terminus.
      this.commit(
        this.pendingId,
        this.layPair(this.cellOf(this.pendingId), oppositePort(this.armed.port), this.armed.port)
      );
    }
    this.armed = null;
    this.routeStarted = false;
    this.pendingId = null;
  }

  // --- connect tool: drag gesture (one-shot single route) ---
  // A drag starts here; if it ends on a different zone (onZoneUp) it lays one
  // route. The browser only fires `click` when down and up share an element, so
  // a drag never also triggers the click→click chaining below.
  onZoneDown(id: string, port: Port) {
    if (!this.drawing) return;
    this.pressFrom = { id, port };
  }
  onZoneUp(id: string, port: Port) {
    if (!this.drawing) return;
    const from = this.pressFrom;
    this.pressFrom = null;
    if (from && (from.id !== id || from.port !== port)) {
      this.commitSegment({ id: from.id, edge: from.port }, { id, edge: port }, true);
    }
  }
  // --- connect/signal tool: click (route mode chaining) ---
  onZoneClick(id: string, port: Port) {
    if (this.tool === "signal") {
      this.commit(id, toggleSignalPort(this.cellOf(id), port));
      return;
    }
    if (!this.drawing) return;
    const head = this.armed;
    if (!head) {
      this.armed = { id, port }; // start a route at this open end
      this.routeStarted = false;
      return;
    }
    // Finish: click the start edge again, or click the pending frontier tile.
    if ((head.id === id && head.port === port) || this.pendingId === id) {
      this.finishRoute();
      return;
    }
    this.extendRoute(id, port);
  }
  // Plan the route to the clicked tile. The last tile is drawn `incoming ->
  // clicked edge` for any of its three exit edges; only if you click the edge
  // the track enters through (a U-turn) is it left blank and the head trails
  // one tile back so your next click decides its shape.
  extendRoute(targetId: string, targetPort: Port) {
    const head = this.armed!;
    const steps = planRoute(
      { id: head.id, edge: head.port },
      { id: targetId, edge: targetPort },
      this.routeOpts
    );
    if (!steps || steps.length === 0) return;
    if (!this.routeStarted && head.id !== targetId) {
      this.commit(
        head.id,
        this.layPair(this.cellOf(head.id), oppositePort(head.port), head.port)
      );
    }
    this.routeStarted = true;
    const last = steps[steps.length - 1];
    const uTurn = targetPort === last.a; // pointing at the incoming edge
    const count = uTurn ? steps.length - 1 : steps.length;
    for (let i = 0; i < count; i++) {
      this.commit(steps[i].id, this.layPair(this.cellOf(steps[i].id), steps[i].a, steps[i].b));
    }
    if (uTurn) {
      const penultId = steps.length >= 2 ? steps[steps.length - 2].id : head.id;
      this.armed = { id: penultId, port: oppositePort(last.a) };
      this.pendingId = last.id; // frontier tile stays undecided
    } else {
      this.armed = { id: last.id, port: last.b }; // exit = the clicked edge
      this.pendingId = null;
    }
  }
  onZoneEnter(id: string, port: Port) {
    if (this.drawing) this.hoverPort = { id, port };
  }
  onZoneLeave(id: string, port: Port) {
    if (this.hoverPort?.id === id && this.hoverPort?.port === port) {
      this.hoverPort = null;
    }
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
    this.commit(id, removeRoad(this.cellOf(id), road[0], road[1]));
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

  // --- drawer / dock actions ---
  get themeIcon(): string {
    return themeMeta(this.config.worldTheme).icon;
  }
  cycleTheme() {
    setWorldTheme(nextTheme(this.config.worldTheme));
  }
  setTool(t: Tool) {
    this.tool = t;
    this.pressFrom = null;
    this.hoverPort = null;
    this.finishRoute();
  }
  onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.finishRoute();
  };
  mounted() {
    window.addEventListener("keydown", this.onKeydown);
  }
  unmounted() {
    window.removeEventListener("keydown", this.onKeydown);
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
