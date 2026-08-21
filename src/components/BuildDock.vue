<template>
  <div class="build-dock-wrap" :class="{ 'build-dock-wrap--compact': compact }">
    <!-- One-line hint with a ? that opens the full help. The paragraph that used
         to float over the board permanently now only appears when asked for. -->
    <div v-if="showHelp" class="bd-help">
      <button class="bd-help__close" aria-label="Close help" @click="showHelp = false">✕</button>
      <div class="bd-help__title">{{ breadcrumb }}</div>
      <div class="bd-help__body">{{ help }}</div>
    </div>
    <!-- The hint floats above the dock in the editor, but in compact mode it
         moves INSIDE the items row: a play dock must not stack chrome over the
         board — every pixel above it is board a click can no longer reach. -->
    <transition name="bd-hint">
      <div v-if="hint && !compact" class="bd-hint">
        <span class="bd-hint__text">{{ hint }}</span>
        <button
          v-if="help"
          class="bd-hint__q"
          :class="{ on: showHelp }"
          title="Full help for this tool"
          @click="showHelp = !showHelp"
        >?</button>
      </div>
    </transition>

    <div class="build-dock" :style="{ '--cat-accent': activeCategory.accent }">
      <!-- Row 3: the open tab's tools, plus the one fixed options slot. The armed
           item is the ONLY filled accent pill anywhere in the dock. -->
      <div class="bd-row bd-row--items">
        <div class="bd-items">
          <button
            v-for="it in activeTab.items"
            :key="it.key"
            class="bd-item"
            :class="{ on: it.key === activeItemKey }"
            :title="it.title || it.label"
            :data-testid="'dock-item-' + it.key"
            @click="$emit('select-item', it.key)"
          >
            <span v-if="it.lanes" class="bd-item__icon bd-item__icon--svg">
              <svg width="30" height="26" viewBox="0 0 30 26" aria-hidden="true">
                <rect x="2" y="3" width="26" height="20" rx="4" class="xs-bed" />
                <line
                  v-for="i in it.lanes"
                  :key="i"
                  class="xs-lane"
                  x1="8"
                  :y1="laneY(i, it.lanes)"
                  x2="22"
                  :y2="laneY(i, it.lanes)"
                />
              </svg>
            </span>
            <span v-else class="bd-item__icon">{{ it.icon }}</span>
            <span class="bd-item__label">{{ it.label }}</span>
          </button>
        </div>
        <div v-if="hasOptions || !compact" class="bd-options">
          <template v-if="hasOptions">
            <div class="bd-options__label">Options</div>
            <slot name="options" />
          </template>
          <span v-else class="bd-options__none">no options for this tool</span>
        </div>
        <div v-if="hint && compact" class="bd-hint-inline">
          <span class="bd-hint-inline__text">{{ hint }}</span>
          <button
            v-if="help"
            class="bd-hint__q"
            :class="{ on: showHelp }"
            title="Full help for this tool"
            @click="showHelp = !showHelp"
          >?</button>
        </div>
        <!-- Host-provided actions (PlayView docks its Undo here) — actions live
             IN the dock so nothing stacks above it over the board. -->
        <slot name="actions" />
        <button
          v-if="closable"
          class="bd-close"
          data-testid="build-dock-close"
          title="Put the tools away (Esc)"
          aria-label="Close build tools"
          @click="$emit('close')"
        >✕</button>
      </div>

      <!-- Row 2: the open category's tabs. -->
      <div class="bd-row bd-row--tabs">
        <button
          v-for="t in activeCategory.tabs"
          :key="t.id"
          class="bd-tab"
          :class="{ on: t.id === tab }"
          @click="$emit('select-tab', t.id)"
        >{{ t.label }}</button>
      </div>

      <!-- Row 1: the categories — one fixed row, always in the same place. The
           active one gets an accent underline, never a filled pill (that cue
           belongs to the armed tool alone). -->
      <div class="bd-row bd-row--cats">
        <button
          v-for="c in categories"
          :key="c.id"
          class="bd-cat"
          :class="{ on: c.id === cat }"
          :style="{ '--cat-accent': c.accent }"
          :title="c.shortcut ? `${c.label} (${c.shortcut})` : c.label"
          :data-testid="'dock-cat-' + c.id"
          @click="$emit('select-cat', c.id)"
        >
          <span v-if="c.shortcut" class="bd-cat__key">{{ c.shortcut }}</span>
          <span class="bd-cat__icon">{{ c.icon }}</span>
          <span class="bd-cat__label">{{ c.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, Watch, toNative } from "vue-facing-decorator";

// The display shape of the dock: category → tabs → items. The EDITOR owns the
// full model (which tool an item arms, which brush it sets); this component
// only needs what it draws, so the fields here are the visual subset and the
// editor's richer items satisfy them structurally.
export interface BuildDockItemView {
  key: string;
  label: string;
  icon?: string; // emoji icon…
  lanes?: number; // …or a road cross-section glyph with this many lanes
  title?: string; // tooltip override (defaults to the label)
}
export interface BuildDockTabView {
  id: string;
  label: string;
  items: BuildDockItemView[];
}
export interface BuildDockCategoryView {
  id: string;
  icon: string;
  label: string;
  accent: string; // the category's colour: panel top border + underline + armed pill
  shortcut: string; // the key that selects it (shown on the button)
  tabs: BuildDockTabView[];
}

// The three-row build dock (items+options / tabs / categories), Transport-Fever
// style: categories never move, tabs separate the verbs within one, and the
// armed item is the only filled accent pill in the whole surface. Presentational:
// all state lives in the view that feeds it (EditorView), which also fills the
// fixed options slot.
@Component
class BuildDock extends Vue {
  @Prop({ required: true }) categories!: BuildDockCategoryView[];
  @Prop({ required: true }) cat!: string;
  @Prop({ required: true }) tab!: string;
  @Prop({ required: true }) activeItemKey!: string;
  @Prop({ default: "" }) hint!: string;
  @Prop({ default: "" }) help!: string;
  @Prop({ default: "" }) breadcrumb!: string;
  @Prop({ default: false }) hasOptions!: boolean;
  // Compact: size to content and position in normal flow (the caller places the
  // dock), instead of the editor's fixed-width bottom-center overlay. Used by
  // PlayView, whose dock carries a fraction of the editor's tool set.
  // (type: Boolean is load-bearing: without it a bare `compact` attribute
  // arrives as the falsy string "".)
  @Prop({ default: false, type: Boolean }) compact!: boolean;
  // Render a ✕ that emits `close` — for hosts where the dock is a temporary
  // surface over the game (PlayView) rather than the room itself (the editor).
  @Prop({ default: false, type: Boolean }) closable!: boolean;

  showHelp = false;

  // Arming a different tool closes the help — it explains the PREVIOUS tool.
  @Watch("activeItemKey")
  onItemChange() {
    this.showHelp = false;
  }

  get activeCategory(): BuildDockCategoryView {
    return this.categories.find(c => c.id === this.cat) ?? this.categories[0];
  }
  get activeTab(): BuildDockTabView {
    return (
      this.activeCategory.tabs.find(t => t.id === this.tab) ??
      this.activeCategory.tabs[0]
    );
  }

  // Y of the i-th (1-based) lane dash in the cross-section glyph, spread evenly
  // over the road bed.
  laneY(i: number, lanes: number): number {
    const top = 6;
    const span = 14;
    return top + ((i - 0.5) / lanes) * span;
  }
}

export default toNative(BuildDock);
</script>

<style lang="scss" scoped>
.build-dock-wrap {
  position: fixed;
  z-index: 1500;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none; // wrapper transparent; children re-enable
  max-width: calc(100vw - 24px);
}

// Compact: the host places the dock (normal flow) and it sizes to its content —
// the fixed editor width exists so the editor's category row never shifts
// between tabs of different widths, which a two-tool play dock cannot suffer.
.build-dock-wrap--compact {
  position: static;
  transform: none;
  max-width: 100%;

  .build-dock {
    position: relative;
    width: auto;
    min-width: 320px;
    // The play dock grows out of the screen edge (TF's slim-bar manner), so
    // only the top corners round.
    border-radius: 14px 14px 0 0;
  }
  .bd-row--items {
    min-height: 0;
    align-items: center;
    padding-right: 40px; // clear the anchored ✕
  }
  // Anchor the ✕ to the dock's corner, out of the row flow — on mobile the
  // items row goes column and an in-flow ✕ would wrap to its own line.
  .bd-close {
    position: absolute;
    top: 8px;
    right: 10px;
    margin: 0;
  }
}

// Compact mode's in-row hint (the floating pill is editor-only — see above).
.bd-hint-inline {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 300px;
  padding-left: 12px;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  font: 600 11px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #c6d1da;
  text-align: left;
}
.bd-hint-inline__text {
  overflow: hidden;
}

// ---- Hint (one line) + help popover ----------------------------------------
.bd-hint {
  @include glass($radius: 999px);
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 640px;
  padding: 6px 8px 6px 14px;
  font: 600 12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #eaf0f5;
  white-space: nowrap;
  overflow: hidden;
}
.bd-hint__text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.bd-hint__q {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: transparent;
  color: #eaf0f5;
  font: 700 11px/1 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;

  &:hover,
  &.on {
    background: rgba(255, 255, 255, 0.16);
  }
}
.bd-help {
  @include glass;
  pointer-events: auto;
  position: relative;
  width: min(560px, calc(100vw - 40px));
  padding: 12px 34px 12px 14px;
  font: 500 12px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #dbe3ea;
  text-align: left;
}
.bd-help__title {
  font-weight: 700;
  font-size: 12px;
  color: #fff;
  margin-bottom: 4px;
}
.bd-help__close {
  position: absolute;
  top: 8px;
  right: 10px;
  border: 0;
  background: none;
  color: #8fa3b3;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    color: #fff;
  }
}
.bd-hint-enter-active,
.bd-hint-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.bd-hint-enter-from,
.bd-hint-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

// ---- The dock itself: three fixed rows -------------------------------------
.build-dock {
  @include glass;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  // FIXED width, sized to the widest tab (Terrain's eight brushes + the options
  // slot): the categories row must never shift as tabs of different widths
  // open — the button you just pressed stays exactly where it was.
  width: min(880px, calc(100vw - 24px));
  border-top: 3px solid var(--cat-accent, #5fd39a);
  padding: 0;
  overflow: hidden;
  transition: border-color 0.2s ease;
}
.bd-row {
  display: flex;
  align-items: stretch;
}
.bd-row--items {
  gap: 10px;
  padding: 10px 12px 8px;
  min-height: 84px; // reserve the tallest tab's height so the dock never jumps
}
.bd-items {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}
.bd-item {
  @include glass-button;
  flex-direction: column;
  gap: 4px;
  min-width: 64px;
  padding: 8px 10px 7px;
  border-radius: 12px;
  font-size: 12px;

  // The one filled accent pill in the dock: the armed tool.
  &.on {
    background: var(--cat-accent, #5fd39a);
    color: #10150e;
    font-weight: 700;
    box-shadow: 0 0 12px color-mix(in srgb, var(--cat-accent, #5fd39a) 55%, transparent);

    &:hover {
      background: var(--cat-accent, #5fd39a);
      color: #10150e;
      filter: brightness(1.08);
    }
  }
}
.bd-item__icon {
  font-size: 22px;
  line-height: 1;

  &--svg {
    display: flex;
    align-items: center;
    height: 22px;
  }
}
.xs-bed {
  fill: rgba(255, 255, 255, 0.16);
}
.xs-lane {
  stroke: #e6e9e2;
  stroke-width: 2;
  stroke-dasharray: 3 2;
}
.bd-item.on .xs-bed {
  fill: rgba(0, 0, 0, 0.25);
}
.bd-item.on .xs-lane {
  stroke: #10150e;
}

// The fixed options slot: always the same place, same width — when the armed
// tool has none it says so instead of reflowing the row.
.bd-options {
  flex: none;
  width: 236px;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  padding-left: 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  text-align: left;
}
.bd-options__label {
  font: 500 9px/1 ui-monospace, "Cascadia Mono", monospace;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8fa3b3;
}
.bd-options__none {
  font: 500 11px/1.3 ui-sans-serif, system-ui, sans-serif;
  color: #5f6b76;
}

// The put-away ✕ (closable hosts only): top-right of the items row, the corner
// every window keeps its close button in.
.bd-close {
  flex: none;
  align-self: flex-start;
  width: 24px;
  height: 24px;
  margin: 2px 0 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #8fa3b3;
  font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }
}

.bd-row--tabs {
  gap: 4px;
  padding: 0 12px 8px;
}
.bd-tab {
  border: 0;
  background: transparent;
  color: #aeb9c2;
  font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.07);
  }
  &.on {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }
}

.bd-row--cats {
  justify-content: center;
  gap: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 7px 12px 9px;
}
.bd-cat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  border: 0;
  background: transparent;
  color: #cfd8e0;
  font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  padding: 6px 16px 5px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.07);
    color: #fff;
  }
  // Active category: accent underline + full colour, never a filled pill.
  &.on {
    color: #fff;
    font-weight: 700;

    &::after {
      content: "";
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 0;
      height: 3px;
      border-radius: 2px;
      background: var(--cat-accent, #5fd39a);
    }
  }
}
.bd-cat__key {
  position: absolute;
  top: 2px;
  right: 5px;
  font: 500 8px/1 ui-monospace, "Cascadia Mono", monospace;
  color: #6d7a86;
}
.bd-cat__icon {
  font-size: 24px;
  line-height: 1.15;
}

// ---- Options-slot widgets (global within the dock, filled via the slot) ----
// One chip pattern for every option everywhere: road modifiers, parking
// reservations. `:deep` because the chips arrive through the slot.
:deep(.bd-chips) {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
:deep(.bd-chip) {
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: transparent;
  color: #dfe6ec;
  border-radius: 8px;
  padding: 3px 9px;
  font: 600 11px/1.3 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.1s ease, color 0.1s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  &.on {
    background: rgba(255, 255, 255, 0.92);
    color: #1c2430;
    border-color: transparent;
  }
}
// The live road cross-section preview (Roads tab): what the next drag lays.
:deep(.bd-xsec) {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 158px;
  border-radius: 6px;
  overflow: hidden;
}
:deep(.bd-xsec__kerb) {
  height: 3px;
  background: #9aa19d;
}
:deep(.bd-xsec__lane) {
  height: 10px;
  background: #5d635f;
  color: #d8dcd4;
  font-size: 7px;
  line-height: 10px;
  letter-spacing: 5px;
  text-align: center;
  overflow: hidden;
  white-space: nowrap;
}
:deep(.bd-xsec__lane--bus) {
  background: #8a6a28;
}
:deep(.bd-facility-input) {
  width: 64px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

// ---- Mobile: the dock compresses instead of overflowing --------------------
@media (max-width: 700px), (max-height: 500px) {
  .build-dock-wrap {
    bottom: 8px;
    max-width: calc(100vw - 12px);
    width: calc(100vw - 12px);
  }
  .build-dock {
    width: 100%;
  }
  // Items scroll horizontally in one row; the options slot drops below them
  // full-width, so nothing is ever clipped off-screen.
  .bd-row--items {
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    padding: 8px 10px 6px;
  }
  .bd-items {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
      display: none;
    }
  }
  .bd-item {
    min-width: 58px;
    padding: 6px 8px 5px;
    flex: none;
  }
  .bd-options {
    width: auto;
    border-left: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding: 6px 0 0;
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .bd-options__label {
    display: none;
  }
  .bd-options__none {
    display: none;
  }
  .bd-row--tabs {
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }
  .bd-tab {
    flex: none;
  }
  // Categories go icon-only; the label is the tooltip.
  .bd-cat__label {
    display: none;
  }
  .bd-cat__key {
    display: none;
  }
  .bd-cat {
    padding: 5px 12px 4px;
  }
  .bd-hint {
    max-width: calc(100vw - 24px);
    font-size: 11px;
  }
  // The compact in-row hint loses its divider once the row goes column.
  .bd-hint-inline {
    border-left: 0;
    padding-left: 0;
    max-width: 100%;
  }
}
</style>
